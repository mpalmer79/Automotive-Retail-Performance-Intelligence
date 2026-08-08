"""The dashboard export contract: one authority for every field the console may see.

WHY THIS FILE IS THE ONLY PLACE THE ANSWER LIVES
------------------------------------------------
``docs/dashboard/DATA_CONTRACT.md`` is the human-readable specification; this module is
its machine-readable form, and a unit test asserts the two agree. Without that pairing the
allowlist would exist in three hand-synchronised places -- prose, Python, TypeScript -- and
the first divergence would be invisible. Instead:

* Python declares the contract here.
* The exporter emits the declaration into ``data/dashboard/manifest.json``.
* The portfolio transformer validates against the manifest plus a small pinned registry,
  so TypeScript never restates a column list.
* ``tests/unit/test_export_dashboard_dataset.py`` checks the Markdown against this module.

WHAT A DATASET CONTRACT MAY AND MAY NOT DO
------------------------------------------
It may select approved columns, resolve a warehouse surrogate key to its business code
through an allowlisted dimension view, filter to the export's own pipeline run, and declare
a deterministic sort. It may **not** aggregate, divide, round, coalesce a null to zero, or
introduce an expression that computes a KPI. ``reporting`` owns the arithmetic
(ADR-0013 condition 2); this file owns the selection.

Key resolution is a lookup, never a fan-out: every dimension view relates one-to-one on a
unique key, and :func:`arpi.dashboard.export` asserts the exported row count equals the
primary view's own row count, so a join that widened the grain fails the export.

CURRENCY AND PRECISION
----------------------
Money is a PostgreSQL ``numeric`` that reaches JSON as an exact decimal **string** with two
places (``"-2529.18"``). Unbounded-scale ratios reach JSON as exact decimal strings too,
unrounded, carrying :attr:`ColumnContract.display_precision` so the UI can round for
display without the export ever discarding the exact value. Order statistics computed by
``percentile_cont`` are IEEE-754 doubles in PostgreSQL and stay doubles here, rendered by
their shortest round-tripping representation. No float ever touches a monetary path.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal

from arpi.constants import (
    ADJUSTMENT_TYPES,
    ALLOWED_STORE_TYPES,
    ARPI_VERSION,
    ELIGIBILITY_RULE_IDS,
    FINANCE_PRODUCT_CATEGORIES,
    LENDER_CATEGORIES,
    LENDER_PROGRAM_TIERS,
    PIPELINE_STATUSES,
)

__all__ = [
    "ALLOWED_SOURCE_SCHEMA",
    "CONTRACT_VERSION",
    "DATASETS",
    "DATASET_NAMES",
    "EXPORTER_VERSION",
    "MANIFEST_FILE_NAME",
    "MONETARY_DECIMAL_PLACES",
    "PUBLIC_CLASSIFICATION",
    "QUERY_NORMALISATION",
    "RECONCILIATION_TOTALS",
    "SCHEMA_ID",
    "SOURCE_VIEW_ALLOWLIST",
    "ColumnContract",
    "ColumnType",
    "DatasetContract",
    "ReconciliationTotal",
    "dataset",
    "dataset_sql",
    "referenced_views",
    "source_grain_columns",
]

# ---------------------------------------------------------------------------------------
# Identity and invariants
# ---------------------------------------------------------------------------------------

#: The manifest schema. A consumer refuses an unknown major version outright.
SCHEMA_ID: Final = "arpi.dashboard_export/1"

#: The contract's own version, bumped when a dataset's shape changes.
#:
#: Held separate from ``SCHEMA_ID``: the schema names the manifest's envelope, this names
#: the field-level declaration inside it. A column added to a dataset bumps this; a change
#: to the envelope bumps the schema.
CONTRACT_VERSION: Final = 1

#: The exporter's version, recorded in every manifest so an artifact names its producer.
EXPORTER_VERSION: Final = ARPI_VERSION

#: The only schema the exporter may read. ``raw``, ``staging``, ``warehouse`` and ``audit``
#: are unreachable by construction: ``arpi_reporter`` holds no privilege on them, and this
#: constant is asserted against every object reference in every generated query.
ALLOWED_SOURCE_SCHEMA: Final = "reporting"

#: The privilege boundary the exporter operates inside. ``arpi_reporter`` is a NOLOGIN
#: group role (``sql/07_security/00_roles.sql``), so the exporter connects as its
#: configured login role and immediately ``SET ROLE``s into this one. A failure to do so
#: aborts the export -- reading the reporting layer with more privilege than the console's
#: identity has would make the boundary a claim rather than a control.
REPORTER_ROLE: Final = "arpi_reporter"

#: The manifest's file name inside the export directory.
MANIFEST_FILE_NAME: Final = "manifest.json"

#: The only privacy classification eligible for public export.
PUBLIC_CLASSIFICATION: Final = "non-personal"

#: Decimal places every monetary value carries. The reporting layer's monetary columns are
#: ``numeric(12,2)`` and sums of them, so a value arriving with more places is schema drift
#: and fails the export rather than being rounded into shape.
MONETARY_DECIMAL_PLACES: Final = 2

#: The query-hash normalisation algorithm, recorded in the manifest so a reader can
#: reproduce a hash without reading this source.
#:
#: The steps are deliberately transparent rather than clever: no SQL parser is involved,
#: because a hand-rolled parser that mis-handles one construct silently changes a hash that
#: is supposed to be evidence.
#:
#:   1. Decode as UTF-8.
#:   2. Normalise CRLF and lone CR to LF, so a Windows checkout hashes identically.
#:   3. Split on LF, strip each line, drop empty lines.
#:   4. Join the surviving lines with a single space and collapse internal whitespace runs
#:      to one space, so reindenting a query cannot change its hash.
#:   5. SHA-256 the UTF-8 bytes of that single-line form.
#:
#: Comments are **not** stripped -- removing them safely needs a parser. Instead the query
#: builder refuses to emit a comment marker at all, so the question cannot arise; that
#: refusal is asserted by a unit test.
QUERY_NORMALISATION: Final = "arpi.sql_whitespace_canonical/1"

# ---------------------------------------------------------------------------------------
# Column and dataset declarations
# ---------------------------------------------------------------------------------------

#: How a value crosses the JSON boundary.
#:
#: ``currency``  PostgreSQL ``numeric`` money -> exact decimal string, exactly 2 places.
#: ``exact``     PostgreSQL ``numeric`` ratio/rate/derived -> exact decimal string,
#:               unrounded at whatever scale the view produced.
#: ``double``    PostgreSQL ``double precision`` order statistic -> JSON number, shortest
#:               round-tripping representation.
#: ``integer``   PostgreSQL integer family -> JSON number.
#: ``date``      PostgreSQL ``date`` -> ``YYYY-MM-DD`` string.
#: ``string``    text -> JSON string.
#: ``boolean``   -> JSON boolean.
ColumnType = Literal["currency", "exact", "double", "integer", "date", "string", "boolean"]


@dataclass(frozen=True, slots=True)
class ColumnContract:
    """One exportable field.

    Attributes:
        name: The exported column name. Business-facing, ``lower_snake_case``.
        type: How the value crosses the JSON boundary.
        nullable: Whether ``null`` is a legitimate value. ``null`` always means "not
            applicable or not observed" and never zero.
        expression: The SQL expression producing the value, qualified by a table alias.
        source_column: The reporting column the value comes from, for lineage. For a
            resolved key this is the dimension's business-code column.
        unit: The measure's unit, for the console's label. ``None`` for identifiers and
            descriptive text.
        display_precision: Decimal places the UI should render. The export never applies
            it; carrying it is what lets the exact value survive alongside a sane display.
        enumeration: The closed set of permitted values. An out-of-set value fails the
            export.
        classification: Privacy class. Only ``non-personal`` is exportable.
    """

    name: str
    type: ColumnType
    nullable: bool
    expression: str
    source_column: str
    unit: str | None = None
    display_precision: int | None = None
    enumeration: tuple[str, ...] | None = None
    classification: str = PUBLIC_CLASSIFICATION


@dataclass(frozen=True, slots=True)
class DatasetContract:
    """One exported dataset.

    Attributes:
        name: The dataset identifier, also its file stem.
        source_view: The approved ``reporting`` view that owns the grain and the
            arithmetic.
        join_views: Allowlisted dimension views joined solely to resolve surrogate keys to
            business codes. Never a source of measures.
        grain: One row per what, in words.
        business_key: The columns that uniquely identify a row. Duplicates fail the export.
        date_basis: Which of the repository's date bases this dataset is measured on, or
            ``None`` for a dataset with no date grain.
        columns: Every exported column, in file order.
        sort_keys: The deterministic sort. Must uniquely order the rows.
        where: An optional row filter. A selection, never an aggregation.
        chunked: Whether the portfolio transformer partitions this dataset by store and
            month. Set for the date-grained datasets large enough to warrant it.
        kpi_ids: The governed KPIs whose SQL owner is this dataset's source view.
        notes: As-built commentary carried into the manifest.
    """

    name: str
    source_view: str
    grain: str
    business_key: tuple[str, ...]
    date_basis: str | None
    columns: tuple[ColumnContract, ...]
    sort_keys: tuple[str, ...]
    join_views: tuple[str, ...] = ()
    where: str | None = None
    chunked: bool = False
    kpi_ids: tuple[str, ...] = ()
    notes: str = ""

    @property
    def file_name(self) -> str:
        """The dataset's file name inside the export directory."""
        return f"{self.name}.json"

    @property
    def column_names(self) -> tuple[str, ...]:
        """Every exported column name, in file order."""
        return tuple(column.name for column in self.columns)

    def column(self, name: str) -> ColumnContract:
        """Return the named column's contract.

        Args:
            name: Exported column name.

        Returns:
            The matching :class:`ColumnContract`.

        Raises:
            KeyError: If the dataset declares no such column.
        """
        for candidate in self.columns:
            if candidate.name == name:
                return candidate
        raise KeyError(f"{self.name} declares no column {name!r}")


@dataclass(frozen=True, slots=True)
class ReconciliationTotal:
    """A group-level total the exporter computes and the transformer re-derives.

    Only additive columns appear here. A ratio is expressed as a numerator/denominator
    pair so the group figure is computed from summed components -- never as an average of
    already-averaged store values, which is a different and wrong number.

    Attributes:
        name: The total's key in the manifest's reconciliation block.
        dataset: The dataset the total is computed over.
        numerator: The additive column summed for the numerator.
        denominator: The additive column summed for the denominator, or ``None`` for a
            plain total.
        type: ``currency``, ``exact`` or ``integer``, matching the resulting value.
        unit: The unit, for the console's label.
        display_precision: Decimal places the UI should render.
        kpi_id: The governed KPI this total evidences, where one owns it.
        subset: Column/value pairs, ANDed, restricting the rows the total is computed
            over. Empty for a total over the whole dataset.

            DECLARED, NEVER IMPLICIT. ``target-attainment`` carries unit targets and
            currency targets in the same column, distinguished by ``target_kpi_id``, and
            it carries store plans beside department refinements of them. A total over
            the whole dataset would add units to dollars and count the same gross twice,
            so the subset is part of the declaration and therefore part of the contract
            fingerprint: changing it changes the hash, exactly as changing a column list
            does.
    """

    name: str
    dataset: str
    numerator: str
    denominator: str | None = None
    type: Literal["currency", "exact", "integer"] = "currency"
    unit: str | None = None
    display_precision: int | None = None
    kpi_id: str | None = None
    subset: tuple[tuple[str, str], ...] = ()


# ---------------------------------------------------------------------------------------
# Shared enumerations
# ---------------------------------------------------------------------------------------

#: The two condition groups every inventory and days-to-sale view reports on.
_CONDITION_GROUPS: Final[tuple[str, ...]] = ("New", "Used")

#: The governed age buckets, exactly as ``vw_inventory_aging`` defines them.
_AGE_BUCKETS: Final[tuple[str, ...]] = ("0-30", "31-60", "61-90", "91-120", "Over 120")

#: The reconciliation outcome vocabulary (``sql/08_validation/05_reconciliation_helpers.sql``).
_RECONCILIATION_STATUSES: Final[tuple[str, ...]] = ("passed", "failed", "skipped")

#: The SQL files that create the dashboard program's own reporting views.
#:
#: Declared here for the same reason ``INVENTORY_LANE_SQL_FILES`` is declared in
#: ``arpi.inventory.spec``: ``powerbi/validation/sql_baseline_metadata.json`` records
#: that the SQL baseline was measured against 28 reporting views, and the portfolio's
#: manifest generator counts the files in ``sql/05_reporting/`` to prove that claim is
#: still true. A lane that is not part of the semantic model must therefore be
#: subtractable from that count, or adding a view to it would look like drift in a
#: number that has nothing to do with it.
#:
#: The generator READS this tuple rather than restating the list, because a second
#: hand-written copy is exactly what would drift away from the first.
#: ``DASH.5`` adds the first dashboard-program WAREHOUSE FACT as well as a view, so the
#: lane now also carries a ``04_facts/`` entry. That entry is what keeps the historical
#: "five MVP facts" baseline true: the tree holds six fact DDL scripts and the MVP count
#: is still five, because the sixth belongs to a lane the semantic model never measured.
DASHBOARD_LANE_SQL_FILES: Final[tuple[str, ...]] = (
    "01_raw/15_raw_sales_target_load.sql",
    "01_raw/16_raw_finance_product_load.sql",
    "01_raw/17_raw_lender_load.sql",
    "01_raw/18_raw_finance_product_sale_load.sql",
    "01_raw/19_raw_finance_product_adjustment_load.sql",
    "02_staging/16_stg_sales_target.sql",
    "02_staging/17_stg_finance_product.sql",
    "02_staging/18_stg_lender.sql",
    "02_staging/19_stg_finance_product_sale.sql",
    "02_staging/20_stg_finance_product_adjustment.sql",
    "03_dimensions/19_dim_finance_product.sql",
    "03_dimensions/20_dim_lender.sql",
    "03_dimensions/21_dim_finance_product_merge.sql",
    "03_dimensions/22_dim_lender_merge.sql",
    "03_dimensions/23_fi_governed_functions.sql",
    "04_facts/06_fact_sales_target.sql",
    "04_facts/07_fact_finance_product_sale.sql",
    "04_facts/08_fact_finance_product_adjustment.sql",
    "04_facts/16_fact_sales_target_load.sql",
    "04_facts/17_fact_finance_product_sale_load.sql",
    "04_facts/18_fact_finance_product_adjustment_load.sql",
    "05_reporting/40_vw_sales_gross_trend.sql",
    "05_reporting/41_vw_gross_change_bridge.sql",
    "05_reporting/42_vw_deal_explorer.sql",
    "05_reporting/43_vw_deal_jacket.sql",
    "05_reporting/44_vw_target_attainment.sql",
    "05_reporting/45_vw_deal_product_detail.sql",
    "05_reporting/46_vw_fi_summary.sql",
    "05_reporting/47_vw_fi_product_penetration.sql",
    "05_reporting/48_vw_fi_adjustment_summary.sql",
    "06_indexes/03_fi_indexes.sql",
    "08_validation/11_recon_target.sql",
    "08_validation/13_recon_fi.sql",
)

#: The vehicle condition vocabulary, exactly as ``warehouse.dim_vehicle`` constrains it.
#: Distinct from :data:`_CONDITION_GROUPS`: a certified unit is its own condition and a
#: Used condition *group*, and collapsing the two would lose the distinction the deal lane
#: needs in order to show a Certified Retail deal as what it is.
_VEHICLE_CONDITION_TYPES: Final[tuple[str, ...]] = ("New", "Used", "Certified")

#: The sale-type vocabulary, exactly as ``warehouse.fact_vehicle_sale`` constrains it.
_SALE_TYPES: Final[tuple[str, ...]] = (
    "New Retail",
    "Used Retail",
    "Certified Retail",
    "Lease",
    "Wholesale",
    "Dealer Trade",
)

#: The three RETAIL finance structures. What an F&I dataset may carry: a disposal has no
#: consumer, so no product and no consumer lender can attach to one, and it is not part of
#: the structure mix KPI-FNI-019 publishes.
_RETAIL_FINANCE_STRUCTURES: Final[tuple[str, ...]] = ("Cash", "Retail Finance", "Lease")

#: Every value ``warehouse.fn_finance_structure`` returns, which is what the Deal Jacket
#: now carries. DASH.7 widened this from the three retail structures: the jacket covers
#: every finalized transaction including wholesale and dealer-trade disposals, and its
#: previous inline derivation had no non-retail branch, so it labelled 92 disposals on the
#: development profile as ``Cash``. The enumeration is the guard that would have caught it.
_FINANCE_STRUCTURES: Final[tuple[str, ...]] = (
    "Cash",
    "Retail Finance",
    "Lease",
    "Wholesale",
    "Dealer Trade",
)

#: The ten governed F&I product categories, verbatim from ``arpi.constants``. Closed: the
#: eleventh category is a catalogue row, and an undeclared one fails the export rather than
#: reaching a penetration table nobody declared a denominator for.
_FI_PRODUCT_CATEGORIES: Final[tuple[str, ...]] = FINANCE_PRODUCT_CATEGORIES

#: The six governed eligibility rules. Every penetration row names one.
_FI_ELIGIBILITY_RULES: Final[tuple[str, ...]] = ELIGIBILITY_RULE_IDS

#: The four governed adjustment event types.
_FI_ADJUSTMENT_TYPES: Final[tuple[str, ...]] = ADJUSTMENT_TYPES

#: The lender vocabularies. ``program_tier`` classifies the LENDER'S PROGRAM and never a
#: customer: it is not a credit grade and is assigned to no person.
_LENDER_CATEGORIES: Final[tuple[str, ...]] = LENDER_CATEGORIES
_LENDER_PROGRAM_TIERS: Final[tuple[str, ...]] = LENDER_PROGRAM_TIERS

#: The bridge's three components. A fourth (a mix effect) may not be added until its
#: position in the sequence and its exact reconciliation are documented, so the closed
#: enumeration is the guard: an undeclared component fails the export rather than
#: appearing in a decomposition whose remaining terms silently changed meaning.
_BRIDGE_COMPONENTS: Final[tuple[str, ...]] = ("volume", "front_pvr", "back_pvr")

#: Why a bridge row carries no decomposition. Two distinct facts, never collapsed: the
#: comparison month may precede the reporting window, or it may be inside it and have sold
#: nothing.
_BRIDGE_NOT_COMPARABLE_REASONS: Final[tuple[str, ...]] = (
    "comparison-period-outside-window",
    "comparison-period-no-retail-units",
)


# ---------------------------------------------------------------------------------------
# Key resolution helpers
# ---------------------------------------------------------------------------------------
# Every surrogate key stops at this boundary (DATA_CONTRACT.md section 4). These helpers
# are the only way a dataset obtains a business code, so a dataset cannot accidentally
# publish a `dealership_key`.


def _store_id() -> ColumnContract:
    """The store's business code, resolved from ``dealership_key``."""
    return ColumnContract(
        name="dealership_id",
        type="string",
        nullable=False,
        expression="store.dealership_code",
        source_column="vw_dealership.dealership_code",
    )


def _resolved_date(name: str, alias: str, *, basis: str) -> ColumnContract:
    """A calendar date resolved from a ``*_date_key`` surrogate.

    Args:
        name: The exported column name.
        alias: The calendar join alias carrying the date.
        basis: The date basis, for the column's unit label.

    Returns:
        The column contract.
    """
    return ColumnContract(
        name=name,
        type="date",
        nullable=False,
        expression=f"{alias}.calendar_date",
        source_column="vw_calendar.calendar_date",
        unit=basis,
    )


def _lead_source_code() -> ColumnContract:
    """The lead source's business code, resolved from ``lead_source_key``."""
    return ColumnContract(
        name="lead_source_code",
        type="string",
        nullable=False,
        expression="lead_source.lead_source_code",
        source_column="vw_lead_source.lead_source_code",
    )


def _campaign_code() -> ColumnContract:
    """The campaign's business code, resolved from a nullable ``campaign_key``.

    Nullable because a lead can arrive against a source with no campaign attached; ``null``
    means "no campaign", never "unknown campaign".
    """
    return ColumnContract(
        name="campaign_code",
        type="string",
        nullable=True,
        expression="campaign.campaign_code",
        source_column="vw_marketing_campaign.campaign_code",
    )


def _measure(
    name: str,
    type_: ColumnType,
    *,
    nullable: bool = False,
    unit: str | None = None,
    precision: int | None = None,
    view: str,
) -> ColumnContract:
    """A measure passed through from the source view unchanged.

    Args:
        name: The column name, identical in the view and the export.
        type_: How the value crosses the JSON boundary.
        nullable: Whether the view can produce ``null``.
        unit: The measure's unit.
        precision: Decimal places the UI should render.
        view: The owning view, for the lineage string.

    Returns:
        The column contract.
    """
    return ColumnContract(
        name=name,
        type=type_,
        nullable=nullable,
        expression=f"base.{name}",
        source_column=f"{view}.{name}",
        unit=unit,
        display_precision=precision,
    )


def _attribute(
    name: str,
    type_: ColumnType,
    *,
    nullable: bool = False,
    view: str,
    enumeration: tuple[str, ...] | None = None,
) -> ColumnContract:
    """A descriptive attribute passed through from the source view unchanged.

    Args:
        name: The column name.
        type_: How the value crosses the JSON boundary.
        nullable: Whether the view can produce ``null``.
        view: The owning view, for the lineage string.
        enumeration: The closed set of permitted values, where the vocabulary is governed.

    Returns:
        The column contract.
    """
    return ColumnContract(
        name=name,
        type=type_,
        nullable=nullable,
        expression=f"base.{name}",
        source_column=f"{view}.{name}",
        enumeration=enumeration,
    )


def _condition_group(view: str) -> ColumnContract:
    """The New/Used condition group, as a closed enumeration."""
    return _attribute("condition_group", "string", view=view, enumeration=_CONDITION_GROUPS)


# ---------------------------------------------------------------------------------------
# The datasets
# ---------------------------------------------------------------------------------------
# Ordered as DATA_CONTRACT.md section 3 orders them: dimensions the console needs in order
# to render a business code, then the governed analytical views, then the trust surface.

_STORES = DatasetContract(
    name="stores",
    source_view="vw_dealership",
    grain="One row per dealership store, current version only.",
    business_key=("dealership_id",),
    date_basis=None,
    sort_keys=("dealership_id",),
    columns=(
        _store_id(),
        _attribute("store_name", "string", view="vw_dealership"),
        _attribute("store_short_name", "string", view="vw_dealership"),
        _attribute("store_type", "string", view="vw_dealership", enumeration=ALLOWED_STORE_TYPES),
        _attribute("franchise_brand", "string", nullable=True, view="vw_dealership"),
        _attribute("brand_label", "string", view="vw_dealership"),
        _attribute("is_franchise_store", "boolean", view="vw_dealership"),
        _attribute("city", "string", view="vw_dealership"),
        _attribute("state_code", "string", view="vw_dealership"),
        _attribute("market_region", "string", view="vw_dealership"),
        _attribute("location_label", "string", view="vw_dealership"),
        _attribute("opened_date", "date", view="vw_dealership"),
        _attribute("is_active", "boolean", view="vw_dealership"),
        _attribute("version_effective_date", "date", view="vw_dealership"),
    ),
    notes=(
        "franchise_brand is null for the independent pre-owned store, which is an operating "
        "model rather than missing data: the console renders 'Not applicable', never a blank "
        "or a placeholder brand. source_system is deliberately not exported -- it names an "
        "internal producer and tells a public reader nothing."
    ),
)

_CALENDAR = DatasetContract(
    name="calendar",
    source_view="vw_calendar",
    grain="One row per calendar date in the reporting window.",
    business_key=("calendar_date",),
    date_basis="calendar date",
    sort_keys=("calendar_date",),
    columns=(
        _attribute("calendar_date", "date", view="vw_calendar"),
        _attribute("day_name", "string", view="vw_calendar"),
        _measure("iso_day_of_week", "integer", view="vw_calendar"),
        _attribute("month_start_date", "date", view="vw_calendar"),
        _attribute("month_end_date", "date", view="vw_calendar"),
        _measure("year_month_number", "integer", view="vw_calendar"),
        _attribute("year_month_label", "string", view="vw_calendar"),
        _attribute("quarter_year_label", "string", view="vw_calendar"),
        _measure("calendar_year", "integer", view="vw_calendar"),
        _attribute("is_weekend", "boolean", view="vw_calendar"),
        _attribute("is_month_end", "boolean", view="vw_calendar"),
        _attribute("is_quarter_end", "boolean", view="vw_calendar"),
        _attribute("is_year_end", "boolean", view="vw_calendar"),
        _attribute("is_holiday", "boolean", view="vw_calendar"),
        _attribute("holiday_name", "string", nullable=True, view="vw_calendar"),
        _attribute("is_showroom_closed", "boolean", view="vw_calendar"),
        _attribute("is_selling_day", "boolean", view="vw_calendar"),
    ),
    notes=(
        "The selling-day and period-boundary fields only, per DATA_CONTRACT.md section 3. "
        "Period filters resolve against this dataset rather than against a date library in "
        "the browser, so the console and the warehouse cannot disagree about which days a "
        "month contains or which of them a showroom was open."
    ),
)

_LEAD_SOURCES = DatasetContract(
    name="lead-sources",
    source_view="vw_lead_source",
    grain="One row per normalised lead source.",
    business_key=("lead_source_code",),
    date_basis=None,
    sort_keys=("lead_source_code",),
    columns=(
        _attribute("lead_source_code", "string", view="vw_lead_source"),
        _attribute("lead_source_name", "string", view="vw_lead_source"),
        _attribute("source_category", "string", view="vw_lead_source"),
        _attribute("is_paid", "boolean", view="vw_lead_source"),
        _attribute("is_digital", "boolean", view="vw_lead_source"),
        _attribute("is_third_party", "boolean", view="vw_lead_source"),
        _attribute("is_internal", "boolean", view="vw_lead_source"),
        _attribute("is_cost_attributable", "boolean", view="vw_lead_source"),
        _attribute("cost_basis_label", "string", view="vw_lead_source"),
    ),
    notes=(
        "Required so the funnel and marketing datasets can carry a business code instead of "
        "a lead_source_key. is_cost_attributable is the RECON-MKT-COST-RULE flag: an organic "
        "source has no spend, and a cost-per-lead over it would be a fabricated number."
    ),
)

_CAMPAIGNS = DatasetContract(
    name="campaigns",
    source_view="vw_marketing_campaign",
    grain="One row per marketing campaign.",
    business_key=("campaign_code",),
    date_basis=None,
    sort_keys=("campaign_code",),
    join_views=("vw_lead_source",),
    columns=(
        _attribute("campaign_code", "string", view="vw_marketing_campaign"),
        _attribute("campaign_name", "string", view="vw_marketing_campaign"),
        _attribute("channel", "string", view="vw_marketing_campaign"),
        _attribute("vendor_name", "string", view="vw_marketing_campaign"),
        _lead_source_code(),
        _attribute("is_cost_attributable", "boolean", view="vw_marketing_campaign"),
        _attribute("start_date", "date", view="vw_marketing_campaign"),
        _attribute("end_date", "date", nullable=True, view="vw_marketing_campaign"),
        _attribute("is_open_ended", "boolean", view="vw_marketing_campaign"),
        _attribute("target_department", "string", view="vw_marketing_campaign"),
        _attribute("target_vehicle_category", "string", view="vw_marketing_campaign"),
    ),
    notes=(
        "vendor_name is a fictional vendor: no real advertising vendor is named anywhere in "
        "ARPI. end_date is null exactly when is_open_ended is true."
    ),
)

_SALES_SUMMARY = DatasetContract(
    name="sales-summary",
    source_view="vw_sales_summary",
    grain="One row per store per sale date on which at least one transaction was finalized.",
    business_key=("dealership_id", "sale_date"),
    date_basis="sale date",
    sort_keys=("dealership_id", "sale_date"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=("KPI-SLS-001", "KPI-SLS-002", "KPI-SLS-003", "KPI-INV-007"),
    columns=(
        _store_id(),
        _resolved_date("sale_date", "sale_date", basis="sale date"),
        _measure("units_sold_all_types", "integer", unit="units", view="vw_sales_summary"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_sales_summary"),
        _measure("new_units_sold", "integer", unit="units", view="vw_sales_summary"),
        _measure("used_units_sold", "integer", unit="units", view="vw_sales_summary"),
        _measure("wholesale_units", "integer", unit="units", view="vw_sales_summary"),
        _measure("dealer_trade_units", "integer", unit="units", view="vw_sales_summary"),
        _measure("retail_sale_price_total", "currency", unit="USD", view="vw_sales_summary"),
        _measure("retail_days_in_inventory_total", "integer", unit="days", view="vw_sales_summary"),
        _measure(
            "average_days_to_sale",
            "exact",
            nullable=True,
            unit="days",
            precision=1,
            view="vw_sales_summary",
        ),
    ),
    notes=(
        "average_days_to_sale is null when no retail unit sold that day: zero units means the "
        "average is undefined, not zero. new_units_sold + used_units_sold = retail_units_sold "
        "is the RECON-UNITS-001 identity and is asserted row by row on export."
    ),
)

_GROSS_SUMMARY = DatasetContract(
    name="gross-summary",
    source_view="vw_gross_summary",
    grain="One row per store per sale date on which at least one transaction was finalized.",
    business_key=("dealership_id", "sale_date"),
    date_basis="sale date",
    sort_keys=("dealership_id", "sale_date"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=(
        "KPI-GRS-001",
        "KPI-GRS-002",
        "KPI-GRS-003",
        "KPI-GRS-004",
        "KPI-GRS-005",
        "KPI-GRS-006",
    ),
    columns=(
        _store_id(),
        _resolved_date("sale_date", "sale_date", basis="sale date"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_gross_summary"),
        _measure("front_end_gross", "currency", unit="USD", view="vw_gross_summary"),
        _measure("back_end_gross", "currency", unit="USD", view="vw_gross_summary"),
        _measure("total_gross", "currency", unit="USD", view="vw_gross_summary"),
        _measure("front_end_gross_all_types", "currency", unit="USD", view="vw_gross_summary"),
        _measure("back_end_gross_all_types", "currency", unit="USD", view="vw_gross_summary"),
        _measure("total_gross_all_types", "currency", unit="USD", view="vw_gross_summary"),
        _measure(
            "front_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_gross_summary",
        ),
        _measure(
            "back_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_gross_summary",
        ),
        _measure(
            "total_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_gross_summary",
        ),
        _measure("negative_front_gross_units", "integer", unit="units", view="vw_gross_summary"),
    ),
    notes=(
        "Negative front gross is a real dealership outcome and is exported with its sign "
        "intact. The three per-unit ratios share one denominator column, which is what makes "
        "KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005 an identity; they are valid at this grain "
        "only, and the exporter never re-derives them at another level."
    ),
)

_INVENTORY_HEALTH = DatasetContract(
    name="inventory-health",
    source_view="vw_inventory_health",
    grain="One row per store per snapshot date per condition group.",
    business_key=("dealership_id", "snapshot_date", "condition_group"),
    date_basis="snapshot date",
    sort_keys=("dealership_id", "snapshot_date", "condition_group"),
    join_views=("vw_dealership", "vw_calendar"),
    chunked=True,
    kpi_ids=(
        "KPI-INV-001",
        "KPI-INV-002",
        "KPI-INV-003",
        "KPI-INV-004",
        "KPI-INV-005",
        "KPI-INV-006",
    ),
    columns=(
        _store_id(),
        _resolved_date("snapshot_date", "snapshot_date", basis="snapshot date"),
        _condition_group("vw_inventory_health"),
        _measure("active_inventory_units", "integer", unit="units", view="vw_inventory_health"),
        _measure("inventory_investment", "currency", unit="USD", view="vw_inventory_health"),
        _measure("days_in_stock_total", "integer", unit="days", view="vw_inventory_health"),
        _measure(
            "average_inventory_age",
            "exact",
            unit="days",
            precision=1,
            view="vw_inventory_health",
        ),
        _measure(
            "median_inventory_age",
            "double",
            unit="days",
            precision=0,
            view="vw_inventory_health",
        ),
        _measure("aged_inventory_units", "integer", unit="units", view="vw_inventory_health"),
        _measure("aged_inventory_investment", "currency", unit="USD", view="vw_inventory_health"),
        _measure(
            "aged_inventory_percentage",
            "exact",
            unit="ratio",
            precision=3,
            view="vw_inventory_health",
        ),
        _measure("aged_threshold_days", "integer", unit="days", view="vw_inventory_health"),
        _measure("oldest_unit_days_in_stock", "integer", unit="days", view="vw_inventory_health"),
    ),
    notes=(
        "aged_inventory_percentage is published as a ratio in 0..1, not as a pre-multiplied "
        "percentage, and unrounded: display_precision tells the UI how to render it. "
        "aged_threshold_days is a labelled project default, never an industry benchmark. "
        "median_inventory_age is a percentile_cont result and is therefore a double, exported "
        "by its shortest round-tripping representation rather than converted to a decimal it "
        "never had."
    ),
)

_INVENTORY_AGING = DatasetContract(
    name="inventory-aging",
    source_view="vw_inventory_aging",
    grain="One row per store per snapshot date per condition group per age bucket.",
    business_key=("dealership_id", "snapshot_date", "condition_group", "age_bucket"),
    date_basis="snapshot date",
    sort_keys=("dealership_id", "snapshot_date", "condition_group", "age_bucket_sort_order"),
    join_views=("vw_dealership", "vw_calendar"),
    chunked=True,
    kpi_ids=("KPI-INV-004",),
    columns=(
        _store_id(),
        _resolved_date("snapshot_date", "snapshot_date", basis="snapshot date"),
        _condition_group("vw_inventory_aging"),
        _attribute("age_bucket", "string", view="vw_inventory_aging", enumeration=_AGE_BUCKETS),
        _measure("age_bucket_sort_order", "integer", view="vw_inventory_aging"),
        _measure("units_in_bucket", "integer", unit="units", view="vw_inventory_aging"),
        _measure("investment_in_bucket", "currency", unit="USD", view="vw_inventory_aging"),
        _measure("days_in_stock_total", "integer", unit="days", view="vw_inventory_aging"),
        _measure(
            "bucket_median_days_in_stock",
            "double",
            unit="days",
            precision=0,
            view="vw_inventory_aging",
        ),
        _measure("bucket_min_days_in_stock", "integer", unit="days", view="vw_inventory_aging"),
        _measure("bucket_max_days_in_stock", "integer", unit="days", view="vw_inventory_aging"),
        _measure("units_on_lot", "integer", unit="units", view="vw_inventory_aging"),
        _measure("bucket_share", "exact", unit="ratio", precision=3, view="vw_inventory_aging"),
    ),
    notes=(
        "The bucket boundaries are the governed set and are exported as a closed "
        "enumeration: a sixth bucket would fail the export rather than appear as an "
        "unlabelled category. age_bucket_sort_order carries the display order so the console "
        "never sorts '91-120' before 'Over 120' alphabetically."
    ),
)

_DAYS_TO_SALE = DatasetContract(
    name="days-to-sale",
    source_view="vw_days_to_sale",
    grain="One row per store per sale month per condition group.",
    business_key=("dealership_id", "sale_month_start_date", "condition_group"),
    date_basis="sale date",
    sort_keys=("dealership_id", "sale_month_start_date", "condition_group"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=("KPI-INV-007",),
    columns=(
        _store_id(),
        _resolved_date("sale_month_start_date", "sale_month", basis="sale month start"),
        _condition_group("vw_days_to_sale"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_days_to_sale"),
        _measure("days_in_inventory_total", "integer", unit="days", view="vw_days_to_sale"),
        _measure("mean_days_to_sale", "exact", unit="days", precision=1, view="vw_days_to_sale"),
        _measure("median_days_to_sale", "double", unit="days", precision=0, view="vw_days_to_sale"),
        _measure("p25_days_to_sale", "double", unit="days", precision=0, view="vw_days_to_sale"),
        _measure("p75_days_to_sale", "double", unit="days", precision=0, view="vw_days_to_sale"),
        _measure("max_days_to_sale", "integer", unit="days", view="vw_days_to_sale"),
    ),
    notes=(
        "Median and mean travel together because KPI_CATALOG.md section 5 requires the pair: "
        "days-to-sale is right-skewed, and a mean alone hides the aged tail that matters."
    ),
)

_INVENTORY_TURN = DatasetContract(
    name="inventory-turn",
    source_view="vw_inventory_turn",
    grain="One row per store per calendar month per condition group.",
    business_key=("dealership_id", "month_start_date", "condition_group"),
    date_basis="snapshot date",
    sort_keys=("dealership_id", "month_start_date", "condition_group"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=("KPI-INV-008",),
    columns=(
        _store_id(),
        _resolved_date("month_start_date", "month", basis="month start"),
        _condition_group("vw_inventory_turn"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_inventory_turn"),
        _measure("calendar_days_in_period", "integer", unit="days", view="vw_inventory_turn"),
        _measure(
            "annualized_retail_units",
            "exact",
            unit="units",
            precision=2,
            view="vw_inventory_turn",
        ),
        _measure("inventory_unit_days", "integer", unit="unit-days", view="vw_inventory_turn"),
        _measure("snapshot_day_count", "integer", unit="days", view="vw_inventory_turn"),
        _measure(
            "average_daily_active_inventory",
            "exact",
            unit="units",
            precision=2,
            view="vw_inventory_turn",
        ),
        _measure(
            "inventory_turn",
            "exact",
            nullable=True,
            unit="turns per year",
            precision=2,
            view="vw_inventory_turn",
        ),
    ),
    notes=(
        "Turn is annualised inside the view, at this grain only. The console must not average "
        "monthly turn values to obtain a quarterly one; a period figure needs the view "
        "evaluated over that period."
    ),
)

_DAYS_SUPPLY = DatasetContract(
    name="days-supply",
    source_view="vw_days_supply",
    grain="One row per store per snapshot (as-of) date per condition group.",
    business_key=("dealership_id", "as_of_date", "condition_group"),
    date_basis="as-of date",
    sort_keys=("dealership_id", "as_of_date", "condition_group"),
    join_views=("vw_dealership", "vw_calendar"),
    chunked=True,
    kpi_ids=("KPI-INV-009",),
    columns=(
        _store_id(),
        _resolved_date("as_of_date", "as_of_date", basis="as-of date"),
        _condition_group("vw_days_supply"),
        _measure("active_inventory_units", "integer", unit="units", view="vw_days_supply"),
        _measure("trailing_days", "integer", unit="days", view="vw_days_supply"),
        _measure("trailing_retail_units", "integer", unit="units", view="vw_days_supply"),
        _measure(
            "average_daily_retail_sales",
            "exact",
            unit="units per day",
            precision=2,
            view="vw_days_supply",
        ),
        _measure(
            "days_supply",
            "exact",
            nullable=True,
            unit="days",
            precision=0,
            view="vw_days_supply",
        ),
    ),
    notes=(
        "days_supply is null when the trailing window sold nothing: dividing by zero sales "
        "does not yield an infinite supply, it yields an undefined figure, and the console "
        "renders 'No data' rather than a bar at the axis maximum."
    ),
)

_LEAD_FUNNEL = DatasetContract(
    name="lead-funnel",
    source_view="vw_lead_funnel",
    grain="One row per store per lead source per campaign (nullable) per lead-creation date.",
    business_key=("dealership_id", "lead_source_code", "campaign_code", "lead_created_date"),
    date_basis="lead creation date",
    sort_keys=("dealership_id", "lead_created_date", "lead_source_code", "campaign_code"),
    join_views=("vw_dealership", "vw_calendar", "vw_lead_source", "vw_marketing_campaign"),
    chunked=True,
    kpi_ids=("KPI-FUN-001", "KPI-FUN-002", "KPI-FUN-003", "KPI-FUN-006"),
    columns=(
        _store_id(),
        _resolved_date("lead_created_date", "lead_date", basis="lead creation date"),
        _lead_source_code(),
        _campaign_code(),
        _measure("leads_received", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("contacted_leads", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("appointment_set_leads", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("appointment_shown_leads", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("sold_leads", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("duplicate_leads_excluded", "integer", unit="leads", view="vw_lead_funnel"),
        _measure("leads_before_exclusions", "integer", unit="leads", view="vw_lead_funnel"),
        _measure(
            "contact_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_lead_funnel",
        ),
        _measure(
            "appointment_set_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_lead_funnel",
        ),
        _measure(
            "lead_to_sale_conversion",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_lead_funnel",
        ),
        _measure(
            "duplicate_lead_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_lead_funnel",
        ),
    ),
    notes=(
        "campaign_code is null when the source carries no campaign; the business key treats "
        "that null as a distinct key component, which is why the export asserts uniqueness "
        "over the four-column tuple rather than over the three non-null ones. Every rate is "
        "null on an empty denominator and is exported unrounded."
    ),
)

_APPOINTMENT_FUNNEL = DatasetContract(
    name="appointment-funnel",
    source_view="vw_appointment_funnel",
    grain=(
        "One row per store per calendar date on which the store had at least one appointment "
        "scheduled or shown."
    ),
    business_key=("dealership_id", "appointment_date"),
    date_basis="appointment date",
    sort_keys=("dealership_id", "appointment_date"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=("KPI-FUN-004", "KPI-FUN-005"),
    columns=(
        _store_id(),
        _resolved_date("appointment_date", "appointment_date", basis="appointment date"),
        _measure(
            "scheduled_appointments", "integer", unit="appointments", view="vw_appointment_funnel"
        ),
        _measure(
            "eligible_appointments", "integer", unit="appointments", view="vw_appointment_funnel"
        ),
        _measure(
            "cancelled_in_advance_appointments",
            "integer",
            unit="appointments",
            view="vw_appointment_funnel",
        ),
        _measure(
            "confirmed_appointments", "integer", unit="appointments", view="vw_appointment_funnel"
        ),
        _measure(
            "shown_appointments", "integer", unit="appointments", view="vw_appointment_funnel"
        ),
        _measure(
            "show_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_appointment_funnel",
        ),
        _measure(
            "cancellation_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_appointment_funnel",
        ),
        _measure(
            "shown_appointments_on_show_date",
            "integer",
            unit="appointments",
            view="vw_appointment_funnel",
        ),
        _measure(
            "shown_and_sold_appointments",
            "integer",
            unit="appointments",
            view="vw_appointment_funnel",
        ),
        _measure(
            "test_drive_appointments",
            "integer",
            unit="appointments",
            view="vw_appointment_funnel",
        ),
        _measure(
            "write_up_appointments", "integer", unit="appointments", view="vw_appointment_funnel"
        ),
        _measure(
            "show_to_sale_conversion",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_appointment_funnel",
        ),
    ),
    notes=(
        "The show-rate denominator is eligible appointments -- scheduled less those cancelled "
        "in advance -- because an appointment the customer cancelled the day before was never "
        "a no-show. Both columns travel with the rate so the console can show either side."
    ),
)

_LEAD_RESPONSE = DatasetContract(
    name="lead-response",
    source_view="vw_lead_response",
    grain="One row per store per lead source per lead-creation date.",
    business_key=("dealership_id", "lead_source_code", "lead_created_date"),
    date_basis="lead creation date",
    sort_keys=("dealership_id", "lead_created_date", "lead_source_code"),
    join_views=("vw_dealership", "vw_calendar", "vw_lead_source"),
    chunked=True,
    kpi_ids=("KPI-FUN-007", "KPI-FUN-008"),
    columns=(
        _store_id(),
        _resolved_date("lead_created_date", "lead_date", basis="lead creation date"),
        _lead_source_code(),
        _measure("valid_leads", "integer", unit="leads", view="vw_lead_response"),
        _measure("responded_leads", "integer", unit="leads", view="vw_lead_response"),
        _measure("unresponded_leads", "integer", unit="leads", view="vw_lead_response"),
        _measure(
            "response_coverage_rate",
            "exact",
            nullable=True,
            unit="ratio",
            precision=3,
            view="vw_lead_response",
        ),
        _measure("response_seconds_total", "integer", unit="seconds", view="vw_lead_response"),
        _measure(
            "average_response_seconds",
            "exact",
            nullable=True,
            unit="seconds",
            precision=1,
            view="vw_lead_response",
        ),
        _measure(
            "average_response_minutes",
            "exact",
            nullable=True,
            unit="minutes",
            precision=1,
            view="vw_lead_response",
        ),
        _measure(
            "median_response_seconds",
            "double",
            nullable=True,
            unit="seconds",
            precision=0,
            view="vw_lead_response",
        ),
        _measure(
            "median_response_minutes",
            "double",
            nullable=True,
            unit="minutes",
            precision=0,
            view="vw_lead_response",
        ),
        _measure(
            "p90_response_minutes",
            "double",
            nullable=True,
            unit="minutes",
            precision=0,
            view="vw_lead_response",
        ),
        _measure("responses_under_5_minutes", "integer", unit="leads", view="vw_lead_response"),
        _measure("responses_5_to_15_minutes", "integer", unit="leads", view="vw_lead_response"),
        _measure("responses_15_to_60_minutes", "integer", unit="leads", view="vw_lead_response"),
        _measure("responses_over_60_minutes", "integer", unit="leads", view="vw_lead_response"),
    ),
    notes=(
        "response_seconds_total is the additive numerator behind the average, published "
        "separately so a group-level average is computed from summed seconds over summed "
        "responded leads rather than by averaging store averages. The median is a "
        "percentile_cont double and cannot be recomputed from any aggregate, which is why the "
        "distribution buckets travel with it."
    ),
)

_MARKETING_PERFORMANCE = DatasetContract(
    name="marketing-performance",
    source_view="vw_marketing_performance",
    grain="One row per store per calendar month per lead source per campaign (nullable).",
    business_key=("dealership_id", "month_start_date", "lead_source_code", "campaign_code"),
    date_basis="spend month",
    sort_keys=("dealership_id", "month_start_date", "lead_source_code", "campaign_code"),
    join_views=("vw_dealership", "vw_calendar", "vw_lead_source", "vw_marketing_campaign"),
    kpi_ids=("KPI-MKT-001", "KPI-MKT-002", "KPI-MKT-003"),
    columns=(
        _store_id(),
        _resolved_date("month_start_date", "month", basis="month start"),
        _lead_source_code(),
        _campaign_code(),
        _attribute("is_cost_attributable", "boolean", view="vw_marketing_performance"),
        _measure(
            "spend_amount", "currency", nullable=True, unit="USD", view="vw_marketing_performance"
        ),
        _measure("impressions", "integer", unit="impressions", view="vw_marketing_performance"),
        _measure("clicks", "integer", unit="clicks", view="vw_marketing_performance"),
        _measure("vendor_reported_leads", "integer", unit="leads", view="vw_marketing_performance"),
        _measure("attributed_leads", "integer", unit="leads", view="vw_marketing_performance"),
        _measure("attributed_sold_leads", "integer", unit="leads", view="vw_marketing_performance"),
        _measure(
            "attributed_retail_units", "integer", unit="units", view="vw_marketing_performance"
        ),
        _measure("attributed_total_gross", "currency", unit="USD", view="vw_marketing_performance"),
        _measure(
            "attributed_front_end_gross", "currency", unit="USD", view="vw_marketing_performance"
        ),
        _measure("attributed_revenue", "currency", unit="USD", view="vw_marketing_performance"),
        _measure(
            "cost_per_lead",
            "exact",
            nullable=True,
            unit="USD per lead",
            precision=2,
            view="vw_marketing_performance",
        ),
        _measure(
            "cost_per_sale",
            "exact",
            nullable=True,
            unit="USD per sale",
            precision=2,
            view="vw_marketing_performance",
        ),
        _measure(
            "gross_return_on_ad_spend",
            "exact",
            nullable=True,
            unit="ratio",
            precision=2,
            view="vw_marketing_performance",
        ),
        _measure(
            "spend_with_no_attributed_leads",
            "boolean",
            nullable=True,
            view="vw_marketing_performance",
        ),
        _measure(
            "spend_with_no_attributed_sales",
            "boolean",
            nullable=True,
            view="vw_marketing_performance",
        ),
        _measure("leads_with_no_spend", "boolean", view="vw_marketing_performance"),
    ),
    notes=(
        "spend_amount is null, not zero, for an organic or internal source: that source has "
        "no advertising cost, and a zero would put it in the same bucket as a paid campaign "
        "that spent nothing (RECON-MKT-COST-RULE). The three exception flags are null on the "
        "same rows for the same reason -- 'spend with no attributed leads' is not a question "
        "that has an answer where there is no spend."
    ),
)

_RECONCILIATION_STATUS = DatasetContract(
    name="reconciliation-status",
    source_view="vw_reconciliation_status",
    grain="One row per reconciliation identifier, for the pipeline run this export describes.",
    business_key=("reconciliation_id",),
    date_basis=None,
    sort_keys=("reconciliation_id",),
    where=(
        "base.pipeline_run_id = "
        "(SELECT max(pipeline_run_id) FROM reporting.vw_reconciliation_status)"
    ),
    columns=(
        _attribute("reconciliation_id", "string", view="vw_reconciliation_status"),
        _measure("left_value", "exact", unit="count or USD", view="vw_reconciliation_status"),
        _measure("right_value", "exact", unit="count or USD", view="vw_reconciliation_status"),
        _measure("difference", "exact", unit="count or USD", view="vw_reconciliation_status"),
        _measure(
            "absolute_difference", "exact", unit="count or USD", view="vw_reconciliation_status"
        ),
        _measure("tolerance", "exact", unit="count or USD", view="vw_reconciliation_status"),
        _attribute(
            "status",
            "string",
            view="vw_reconciliation_status",
            enumeration=_RECONCILIATION_STATUSES,
        ),
        _attribute("is_passing", "boolean", view="vw_reconciliation_status"),
        _attribute("is_critical", "boolean", view="vw_reconciliation_status"),
        _measure("severity_rank", "integer", view="vw_reconciliation_status"),
    ),
    notes=(
        "The source view's grain is reconciliation x run; this dataset selects the export's "
        "own run, so the console shows the evidence belonging to the data it is rendering. "
        "Three of the view's columns are deliberately NOT exported -- the two source columns "
        "and the prose description -- because all three embed schema-qualified names of "
        "internal warehouse and audit objects, which ADR-0013 condition 8 keeps out of the "
        "public lane. The governed reconciliation_id is the public handle: KPI_CATALOG.md "
        "section 36 documents what each identifier compares, so the console links to the "
        "definition instead of restating an internal object path. The values, the tolerance "
        "and the outcome are what make a reconciliation public evidence."
    ),
)

_PIPELINE_RUN = DatasetContract(
    name="pipeline-run",
    source_view="vw_pipeline_run_summary",
    grain="One row: the pipeline run this export was taken from.",
    business_key=("run_uuid",),
    date_basis=None,
    sort_keys=("run_uuid",),
    where=(
        "base.pipeline_run_id = "
        "(SELECT max(pipeline_run_id) FROM reporting.vw_pipeline_run_summary)"
    ),
    columns=(
        _attribute("run_uuid", "string", view="vw_pipeline_run_summary"),
        _attribute("profile_name", "string", view="vw_pipeline_run_summary"),
        _attribute("run_mode", "string", view="vw_pipeline_run_summary"),
        _attribute("arpi_version", "string", view="vw_pipeline_run_summary"),
        _measure("random_seed", "integer", view="vw_pipeline_run_summary"),
        _attribute(
            "run_status", "string", view="vw_pipeline_run_summary", enumeration=PIPELINE_STATUSES
        ),
        _measure("source_row_count", "integer", unit="rows", view="vw_pipeline_run_summary"),
        _measure("raw_row_count", "integer", unit="rows", view="vw_pipeline_run_summary"),
        _measure("staging_row_count", "integer", unit="rows", view="vw_pipeline_run_summary"),
        _measure("warehouse_row_count", "integer", unit="rows", view="vw_pipeline_run_summary"),
        _measure("rejected_row_count", "integer", unit="rows", view="vw_pipeline_run_summary"),
        _measure(
            "validation_check_count", "integer", unit="checks", view="vw_pipeline_run_summary"
        ),
        _measure(
            "validation_passed_count", "integer", unit="checks", view="vw_pipeline_run_summary"
        ),
        _measure(
            "validation_failed_count", "integer", unit="checks", view="vw_pipeline_run_summary"
        ),
        _measure(
            "validation_skipped_count", "integer", unit="checks", view="vw_pipeline_run_summary"
        ),
        _measure(
            "critical_failed_check_count",
            "integer",
            unit="checks",
            view="vw_pipeline_run_summary",
        ),
        _measure("reconciliation_count", "integer", unit="checks", view="vw_pipeline_run_summary"),
        _measure(
            "reconciliation_failed_count",
            "integer",
            unit="checks",
            view="vw_pipeline_run_summary",
        ),
        _attribute(
            "reconciliation_status",
            "string",
            view="vw_pipeline_run_summary",
            enumeration=_RECONCILIATION_STATUSES,
        ),
    ),
    notes=(
        "run_uuid is the ONE declared varying field in any dataset: a rebuilt warehouse is a "
        "new run and this value changes with it. Everything else in every dataset is a "
        "function of the data alone, which is what makes byte-comparison a usable check. "
        "started_at, completed_at and duration_seconds are excluded because they are wall-clock "
        "and machine-dependent, and notes is excluded because the privacy tripwire prohibits a "
        "free-text column in a public artifact."
    ),
)

# ---------------------------------------------------------------------------------------
# DASH.3 datasets
# ---------------------------------------------------------------------------------------
# Three datasets over the dashboard-program views. They add no measure the reporting layer
# did not already own: the trend dataset is volume and gross on one row with their
# condition components, the bridge dataset is a decomposition whose arithmetic order is
# fixed in SQL, and the deal dataset is the first deal-grain export in the project.

_SALES_GROSS_TREND = DatasetContract(
    name="sales-gross-trend",
    source_view="vw_sales_gross_trend",
    grain="One row per store per sale date on which at least one transaction was finalized.",
    business_key=("dealership_id", "sale_date"),
    date_basis="sale date",
    sort_keys=("dealership_id", "sale_date"),
    join_views=("vw_dealership", "vw_calendar"),
    kpi_ids=(
        "KPI-SLS-001",
        "KPI-SLS-002",
        "KPI-SLS-003",
        "KPI-GRS-001",
        "KPI-GRS-002",
        "KPI-GRS-003",
        "KPI-GRS-004",
        "KPI-GRS-005",
        "KPI-GRS-006",
    ),
    columns=(
        _store_id(),
        _resolved_date("sale_date", "sale_date", basis="sale date"),
        _measure("units_sold_all_types", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("new_units_sold", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("used_units_sold", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("wholesale_units", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("dealer_trade_units", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("lease_units", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("certified_retail_units", "integer", unit="units", view="vw_sales_gross_trend"),
        _measure("retail_sale_price_total", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("front_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("back_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("total_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("front_end_gross_all_types", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("back_end_gross_all_types", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("total_gross_all_types", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("new_front_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("new_back_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("new_total_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("used_front_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("used_back_end_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("used_total_gross", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure(
            "front_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_sales_gross_trend",
        ),
        _measure(
            "back_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_sales_gross_trend",
        ),
        _measure(
            "total_gross_per_retail_unit",
            "exact",
            nullable=True,
            unit="USD per unit",
            precision=2,
            view="vw_sales_gross_trend",
        ),
        _measure(
            "negative_front_gross_units", "integer", unit="units", view="vw_sales_gross_trend"
        ),
        _measure(
            "discount_from_original_total", "currency", unit="USD", view="vw_sales_gross_trend"
        ),
        _measure("discount_from_final_total", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("discount_from_msrp_total", "currency", unit="USD", view="vw_sales_gross_trend"),
        _measure("msrp_eligible_units", "integer", unit="units", view="vw_sales_gross_trend"),
    ),
    notes=(
        "The condition breakdown is columns, not rows: new_* + used_* equals the retail total "
        "on every row, so the store-day grain is never inflated by a dimension. lease_units and "
        "certified_retail_units are sale-type mix components already counted inside "
        "retail_units_sold, not additional units, and summing them with it would double-count. "
        "discount_from_msrp_total divides by msrp_eligible_units and never by retail_units_sold, "
        "because a used unit legitimately has no MSRP."
    ),
)

_GROSS_CHANGE_BRIDGE = DatasetContract(
    name="gross-change-bridge",
    source_view="vw_gross_change_bridge",
    grain="One row per store per comparison-period pair per bridge component.",
    business_key=("dealership_id", "month_start_date", "component_code"),
    date_basis="sale date, aggregated to calendar month",
    sort_keys=("dealership_id", "month_start_date", "component_ordinal"),
    join_views=("vw_dealership",),
    kpi_ids=("KPI-GRS-003", "KPI-GRS-004", "KPI-GRS-005", "KPI-GRS-006"),
    columns=(
        _store_id(),
        _attribute("month_start_date", "date", view="vw_gross_change_bridge"),
        _attribute("comparison_month_start_date", "date", view="vw_gross_change_bridge"),
        _measure("component_ordinal", "integer", view="vw_gross_change_bridge"),
        _attribute(
            "component_code",
            "string",
            view="vw_gross_change_bridge",
            enumeration=_BRIDGE_COMPONENTS,
        ),
        _attribute("component_label", "string", view="vw_gross_change_bridge"),
        _measure("retail_units_sold", "integer", unit="units", view="vw_gross_change_bridge"),
        _measure(
            "comparison_retail_units_sold", "integer", unit="units", view="vw_gross_change_bridge"
        ),
        _measure("front_end_gross", "currency", unit="USD", view="vw_gross_change_bridge"),
        _measure(
            "comparison_front_end_gross", "currency", unit="USD", view="vw_gross_change_bridge"
        ),
        _measure("back_end_gross", "currency", unit="USD", view="vw_gross_change_bridge"),
        _measure(
            "comparison_back_end_gross", "currency", unit="USD", view="vw_gross_change_bridge"
        ),
        _measure("total_gross", "currency", unit="USD", view="vw_gross_change_bridge"),
        _measure("comparison_total_gross", "currency", unit="USD", view="vw_gross_change_bridge"),
        _measure("total_gross_change", "currency", unit="USD", view="vw_gross_change_bridge"),
        _attribute("is_comparable", "boolean", view="vw_gross_change_bridge"),
        _attribute(
            "not_comparable_reason",
            "string",
            nullable=True,
            view="vw_gross_change_bridge",
            enumeration=_BRIDGE_NOT_COMPARABLE_REASONS,
        ),
        _measure(
            "effect_numerator",
            "currency",
            nullable=True,
            unit="USD x units",
            view="vw_gross_change_bridge",
        ),
        _measure(
            "effect_denominator",
            "integer",
            nullable=True,
            unit="units",
            view="vw_gross_change_bridge",
        ),
        _measure(
            "effect_amount",
            "exact",
            nullable=True,
            unit="USD",
            precision=2,
            view="vw_gross_change_bridge",
        ),
    ),
    notes=(
        "ATTRIBUTION UNDER A DOCUMENTED ORDER, NOT CAUSATION. The three effect_numerator values "
        "for one store-month sum identically to effect_denominator * total_gross_change, in "
        "exact arithmetic with no division on either side; that identity is what a consumer "
        "must verify. effect_amount is the convenience quotient and carries the rounding "
        "division implies, so three rounded amounts need not sum to a rounded "
        "total_gross_change and a consumer displaying dollars must show the residual rather "
        "than hiding it. A row with is_comparable false has NULL components and a populated "
        "total_gross_change: the period change stays well defined when its decomposition is "
        "not."
    ),
)

#: The target-scope vocabulary, exactly as ``warehouse.fact_sales_target`` constrains it.
_TARGET_SCOPE_TYPES: Final[tuple[str, ...]] = ("Store", "Department", "Employee")

#: The departments the target domain supports. Sales owns front-end gross and Finance owns
#: back-end gross, which partition total gross exactly.
_TARGET_DEPARTMENTS: Final[tuple[str, ...]] = ("Sales", "Finance")

#: The metrics a target row may name. NEVER a ``KPI-TGT`` id: those are computed FROM
#: these rows, and exporting one here would let a consumer mistake the plan for its own
#: measure.
_TARGET_METRIC_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-SLS-001",
    "KPI-GRS-001",
    "KPI-GRS-002",
    "KPI-GRS-003",
)

#: The month states ``vw_target_attainment`` publishes.
_TARGET_MONTH_STATES: Final[tuple[str, ...]] = ("Not started", "In progress", "Complete")

#: The two units a target row can be measured in.
_TARGET_MEASURE_UNITS: Final[tuple[str, ...]] = ("units", "USD")

_TARGET_ATTAINMENT = DatasetContract(
    name="target-attainment",
    source_view="vw_target_attainment",
    grain=(
        "One row per store per target scope (type and identity) per targeted KPI per "
        "calendar month, with the governed as-of context."
    ),
    business_key=(
        "dealership_id",
        "target_month",
        "target_scope_type",
        "target_scope_id",
        "target_kpi_id",
    ),
    date_basis="target month for the plan; sale date for every actual",
    sort_keys=(
        "dealership_id",
        "target_month",
        "target_scope_type",
        "target_scope_id",
        "target_kpi_id",
    ),
    join_views=("vw_dealership",),
    # Deliberately NOT chunked. 3 stores x 6 months x 4 scope-metric combinations is 72
    # rows; the whole file is two orders of magnitude inside the size ceiling, and a
    # partitioned dataset would add eighteen files and a chunk table to save nothing.
    # DATA_CONTRACT.md section 9 requires the measurement, not the reflex.
    chunked=False,
    kpi_ids=(
        "KPI-TGT-001",
        "KPI-TGT-002",
        "KPI-TGT-003",
        "KPI-TGT-004",
        "KPI-TGT-005",
        "KPI-TGT-006",
        "KPI-TGT-007",
        "KPI-TGT-008",
        "KPI-TGT-009",
        "KPI-TGT-010",
    ),
    columns=(
        _store_id(),
        _attribute("target_month", "date", view="vw_target_attainment"),
        _attribute(
            "target_scope_type",
            "string",
            view="vw_target_attainment",
            enumeration=_TARGET_SCOPE_TYPES,
        ),
        _attribute("target_scope_id", "string", view="vw_target_attainment"),
        _attribute(
            "department_name",
            "string",
            nullable=True,
            view="vw_target_attainment",
            enumeration=_TARGET_DEPARTMENTS,
        ),
        _attribute(
            "target_kpi_id",
            "string",
            view="vw_target_attainment",
            enumeration=_TARGET_METRIC_KPI_IDS,
        ),
        _attribute("target_kpi_label", "string", view="vw_target_attainment"),
        _attribute(
            "measure_unit",
            "string",
            view="vw_target_attainment",
            enumeration=_TARGET_MEASURE_UNITS,
        ),
        _attribute("actual_date_basis", "string", view="vw_target_attainment"),
        _attribute("is_target_present", "boolean", view="vw_target_attainment"),
        _measure(
            "target_value",
            "exact",
            nullable=True,
            unit="units or USD",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure(
            "actual_mtd_value",
            "exact",
            unit="units or USD",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure(
            "attainment_numerator",
            "exact",
            unit="units or USD",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure(
            "attainment_denominator",
            "exact",
            nullable=True,
            unit="units or USD",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure("selling_days_in_month", "integer", unit="days", view="vw_target_attainment"),
        _measure("selling_days_elapsed", "integer", unit="days", view="vw_target_attainment"),
        _measure("selling_days_remaining", "integer", unit="days", view="vw_target_attainment"),
        _measure(
            "pace_numerator",
            "exact",
            unit="units or USD",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure("pace_denominator", "integer", unit="days", view="vw_target_attainment"),
        _measure(
            "projection_numerator",
            "exact",
            unit="units or USD x days",
            precision=2,
            view="vw_target_attainment",
        ),
        _measure("projection_denominator", "integer", unit="days", view="vw_target_attainment"),
        _attribute("as_of_date", "date", view="vw_target_attainment"),
        _attribute("effective_as_of_date", "date", view="vw_target_attainment"),
        _attribute(
            "month_state",
            "string",
            view="vw_target_attainment",
            enumeration=_TARGET_MONTH_STATES,
        ),
    ),
    notes=(
        "TARGETS ARE SYNTHETIC INTERNAL OPERATING GOALS FOR THE FICTIONAL GRANITE AUTO "
        "GROUP. They are not industry benchmarks, manufacturer objectives, market "
        "standards or any real dealership's plan, and no surface may describe one as "
        "good, average, standard or recommended. target_kpi_id names the metric BEING "
        "TARGETED and is never a KPI-TGT identifier: those ten are computed FROM these "
        "rows. Department rows are REFINEMENTS of the store plan, never addends -- a "
        "store total reads target_scope_type = 'Store' only, and summing across scopes "
        "double-counts gross, because Sales owns the front end and Finance the back end "
        "of the same total. Retail units are store-scope only: a unit is delivered once. "
        "NO QUOTIENT IS PUBLISHED. target_attainment_ratio, pace_per_selling_day and "
        "projected_month_end_value exist in the view and are deliberately NOT exported: "
        "the export carries their numerators and denominators so a group figure is "
        "SUM(numerator) / SUM(denominator) and an average of store percentages cannot be "
        "formed from this data. attainment_denominator is NULL when the target is absent "
        "OR zero -- NO TARGET SET IS NOT A TARGET OF ZERO, and is_target_present is the "
        "column that tells them apart. pace_denominator is zero before the first selling "
        "day, which is legitimate and must render as 'pace not available', never as a "
        "division. A projected month-end figure derived from projection_numerator / "
        "projection_denominator is a SELLING-DAY PACE PROJECTION: linear arithmetic over "
        "the governed selling-day calendar, never a forecast, a prediction, AI, machine "
        "learning or a probability. Once a month is complete it equals the final actual. "
        "stretch_target_value exists on the fact and is deliberately not exported: no "
        "DASH.5 surface renders it, and exporting an unused planning figure would invite "
        "a consumer to invent a meaning for it."
    ),
)

_DEAL_EXPLORER = DatasetContract(
    name="deal-explorer",
    source_view="vw_deal_explorer",
    grain="One row per finalized vehicle transaction.",
    business_key=("sale_id",),
    date_basis="sale date",
    sort_keys=("sale_id",),
    join_views=("vw_dealership",),
    chunked=True,
    kpi_ids=("KPI-SLS-001", "KPI-GRS-001", "KPI-GRS-002", "KPI-GRS-003", "KPI-INV-007"),
    columns=(
        _attribute("sale_id", "string", view="vw_deal_explorer"),
        # sale_date must remain the FIRST date column: the portfolio transformer
        # partitions a chunked dataset by the first one it finds, and the governed
        # partition key is the sale month, never the delivery month.
        _attribute("sale_date", "date", view="vw_deal_explorer"),
        _attribute("delivery_date", "date", view="vw_deal_explorer"),
        _store_id(),
        _attribute("vehicle_code", "string", view="vw_deal_explorer"),
        _measure("model_year", "integer", unit="year", view="vw_deal_explorer"),
        _attribute("make", "string", view="vw_deal_explorer"),
        _attribute("model_name", "string", view="vw_deal_explorer"),
        _attribute("trim_level", "string", view="vw_deal_explorer"),
        _attribute("vehicle_display", "string", view="vw_deal_explorer"),
        _attribute("body_style", "string", view="vw_deal_explorer"),
        _attribute(
            "condition_type",
            "string",
            view="vw_deal_explorer",
            enumeration=_VEHICLE_CONDITION_TYPES,
        ),
        _condition_group("vw_deal_explorer"),
        _attribute("sale_type", "string", view="vw_deal_explorer", enumeration=_SALE_TYPES),
        _attribute("is_retail", "boolean", view="vw_deal_explorer"),
        _measure("sale_price", "currency", unit="USD", view="vw_deal_explorer"),
        _measure("msrp", "currency", nullable=True, unit="USD", view="vw_deal_explorer"),
        _measure("original_asking_price", "currency", unit="USD", view="vw_deal_explorer"),
        _measure("final_asking_price", "currency", unit="USD", view="vw_deal_explorer"),
        _measure("front_end_gross", "currency", unit="USD", view="vw_deal_explorer"),
        _measure("back_end_gross", "currency", unit="USD", view="vw_deal_explorer"),
        _measure("total_gross", "currency", unit="USD", view="vw_deal_explorer"),
        _attribute("is_negative_front_gross", "boolean", view="vw_deal_explorer"),
        _measure("days_in_inventory_at_sale", "integer", unit="days", view="vw_deal_explorer"),
        _attribute("has_trade", "boolean", view="vw_deal_explorer"),
        _attribute("is_lead_attributed", "boolean", view="vw_deal_explorer"),
        _attribute("lead_source_code", "string", nullable=True, view="vw_deal_explorer"),
        _attribute("lead_source_name", "string", nullable=True, view="vw_deal_explorer"),
        _attribute("salesperson_code", "string", nullable=True, view="vw_deal_explorer"),
        _attribute("desk_manager_code", "string", nullable=True, view="vw_deal_explorer"),
        _attribute("finance_manager_code", "string", nullable=True, view="vw_deal_explorer"),
    ),
    notes=(
        "The project's first deal-grain export, and the first chunked dataset whose business "
        "key is not a date. Identity is the business code sale_id; the surrogate sale_key is "
        "absent, so no URL can carry warehouse load order. Deliberately compact -- no "
        "acquisition, reconditioning, pack, trade or finance amount appears, because an index "
        "carrying them would ship the whole deal population's cost structure to render a list. "
        "No customer attribute is exported at any grain, banded or otherwise, and staff appear "
        "as synthetic employee codes with no name. lead_source_code is resolved through the "
        "linked lead rather than through fact_vehicle_sale.lead_source_key, which the generator "
        "never populates; is_lead_attributed distinguishes genuine walk-in business from "
        "missing data. vehicle_code is NOT a stock number -- the model contains none -- and is "
        "never captioned as one."
    ),
)

_DEAL_JACKET = DatasetContract(
    name="deal-jacket",
    source_view="vw_deal_jacket",
    grain="One row per finalized vehicle transaction.",
    business_key=("sale_id",),
    date_basis="sale date",
    sort_keys=("sale_id",),
    join_views=("vw_dealership",),
    chunked=True,
    kpi_ids=("KPI-SLS-001", "KPI-GRS-001", "KPI-GRS-002", "KPI-GRS-003", "KPI-INV-007"),
    columns=(
        _attribute("sale_id", "string", view="vw_deal_jacket"),
        # sale_date must remain the FIRST date column: the transformer partitions a
        # chunked dataset by the first one it finds, and the governed partition key
        # is the sale month.
        _attribute("sale_date", "date", view="vw_deal_jacket"),
        _attribute("delivery_date", "date", view="vw_deal_jacket"),
        _store_id(),
        _attribute("sale_type", "string", view="vw_deal_jacket", enumeration=_SALE_TYPES),
        _attribute("is_retail", "boolean", view="vw_deal_jacket"),
        _attribute(
            "finance_structure",
            "string",
            view="vw_deal_jacket",
            enumeration=_FINANCE_STRUCTURES,
        ),
        _attribute("finance_structure_basis", "string", view="vw_deal_jacket"),
        # Vehicle
        _attribute("vehicle_code", "string", view="vw_deal_jacket"),
        _attribute("synthetic_vin", "string", view="vw_deal_jacket"),
        _measure("model_year", "integer", unit="year", view="vw_deal_jacket"),
        _attribute("make", "string", view="vw_deal_jacket"),
        _attribute("model_name", "string", view="vw_deal_jacket"),
        _attribute("trim_level", "string", view="vw_deal_jacket"),
        _attribute("vehicle_display", "string", view="vw_deal_jacket"),
        _attribute("body_style", "string", view="vw_deal_jacket"),
        _attribute(
            "condition_type",
            "string",
            view="vw_deal_jacket",
            enumeration=_VEHICLE_CONDITION_TYPES,
        ),
        _condition_group("vw_deal_jacket"),
        _attribute("odometer_band", "string", view="vw_deal_jacket"),
        _attribute("acquisition_source", "string", view="vw_deal_jacket"),
        _measure("days_in_inventory_at_sale", "integer", unit="days", view="vw_deal_jacket"),
        # Price
        _measure("sale_price", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("msrp", "currency", nullable=True, unit="USD", view="vw_deal_jacket"),
        _measure("original_asking_price", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("final_asking_price", "currency", unit="USD", view="vw_deal_jacket"),
        # The front-gross components, in formula order
        _measure("acquisition_cost", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("reconditioning_cost", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("pack_amount", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("front_end_gross", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("discount_from_original", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("discount_from_final", "currency", unit="USD", view="vw_deal_jacket"),
        _measure(
            "discount_from_msrp", "currency", nullable=True, unit="USD", view="vw_deal_jacket"
        ),
        # Trade
        _attribute("has_trade", "boolean", view="vw_deal_jacket"),
        _measure("trade_allowance", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("trade_acv", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("trade_variance", "currency", unit="USD", view="vw_deal_jacket"),
        # Finance amounts
        _measure("cash_down", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("amount_financed", "currency", unit="USD", view="vw_deal_jacket"),
        # Gross
        _measure("back_end_gross", "currency", unit="USD", view="vw_deal_jacket"),
        _measure("total_gross", "currency", unit="USD", view="vw_deal_jacket"),
        # Staff, synthetic codes and roles only
        _attribute("salesperson_code", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("salesperson_role", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("desk_manager_code", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("desk_manager_role", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("finance_manager_code", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("finance_manager_role", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("bdc_employee_code", "string", nullable=True, view="vw_deal_jacket"),
        # Lead timeline
        _attribute("is_lead_attributed", "boolean", view="vw_deal_jacket"),
        _attribute("lead_id", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("lead_created_date", "date", nullable=True, view="vw_deal_jacket"),
        _attribute("lead_source_code", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("lead_source_name", "string", nullable=True, view="vw_deal_jacket"),
        _measure(
            "first_response_seconds",
            "integer",
            nullable=True,
            unit="seconds",
            view="vw_deal_jacket",
        ),
        _attribute("lead_contacted", "boolean", nullable=True, view="vw_deal_jacket"),
        _attribute("lead_appointment_set", "boolean", nullable=True, view="vw_deal_jacket"),
        _measure("lead_days_to_sale", "integer", nullable=True, unit="days", view="vw_deal_jacket"),
        # Appointment
        _attribute("has_appointment", "boolean", view="vw_deal_jacket"),
        _attribute("appointment_id", "string", nullable=True, view="vw_deal_jacket"),
        _attribute("appointment_scheduled_date", "date", nullable=True, view="vw_deal_jacket"),
        _attribute("appointment_show_date", "date", nullable=True, view="vw_deal_jacket"),
        _attribute("appointment_shown", "boolean", nullable=True, view="vw_deal_jacket"),
        _attribute("appointment_test_drive", "boolean", nullable=True, view="vw_deal_jacket"),
        _attribute("appointment_write_up", "boolean", nullable=True, view="vw_deal_jacket"),
        # Supporting fact for the page's integrity checklist
        _attribute("delivery_on_or_after_sale", "boolean", view="vw_deal_jacket"),
        _measure("inventory_snapshot_count", "integer", unit="snapshots", view="vw_deal_jacket"),
    ),
    notes=(
        "The presentation-complete record of ONE deal, and the second deal-grain dataset. "
        "It carries the cost components deal-explorer deliberately omits, because a jacket "
        "must show the arithmetic behind its front gross and an index must not ship the "
        "whole population's cost structure. The two ARITHMETIC identities are NOT exported "
        "as flags: the route recomputes front gross, total gross and the back-gross "
        "decomposition from the displayed components with exact-decimal arithmetic, because "
        "a verification that reads a flag verifies nothing. trade_variance is published "
        "beside the front-gross components and is deliberately not one of them. "
        "DASH.7 MADE THE BACK END REAL: back_end_gross is no longer an unexplained "
        "aggregate, because finance_reserve_gross + original_product_gross equals it to the "
        "cent on every deal with other_fi_income exactly 0.00, and the contract itemization "
        "is the deal-product-detail dataset partitioned by the SAME store and sale month so "
        "one jacket opens one product partition. original_product_gross is the DEAL-DATE sum "
        "and is the one the identity uses; net_product_gross_as_of is the retained figure "
        "through the governed as-of date, and substituting it would make the identity fail on "
        "every adjusted deal. DASH.7 ALSO CORRECTED finance_structure: the view derived it "
        "with an inline CASE that had no non-retail branch and labelled 92 wholesale and "
        "dealer-trade disposals as Cash; it now calls the governed derivation function, the one "
        "authority, the enumeration widened to five values, and is_retail_structure separates "
        "them. The lender is FICTIONAL and null means NO LENDER EXISTS; lender_program_tier "
        "classifies the LENDER'S PROGRAM and never a customer; no APR, term, payment, buy "
        "rate, sell rate or spread is exported because none is modelled. "
        "No customer attribute is exported at any "
        "grain; staff are synthetic codes and roles with no name; the lead timeline is "
        "flags and dates with no message, note or free text, because none exists in the "
        "model."
    ),
)


# ---------------------------------------------------------------------------------------
# The F&I lane (DASH.7)
# ---------------------------------------------------------------------------------------
# DASH.6 built four reporting views and exported NONE of them: the domain existed in SQL
# and had no presentation surface. DASH.7 promotes all four across the boundary, and the
# thing that matters most about them is that they DO NOT SHARE A GRAIN.
#
#   fi-summary                 store x sale date x finance manager, no category
#   fi-product-penetration     the same, PLUS category, and no reserve or retail units
#   fi-adjustment-summary      store x ADJUSTMENT date x manager x category x type
#   deal-product-detail        one contract
#
# That separation is DASH.6's, it is deliberate, and it is what stops a category join from
# multiplying finance reserve and retail units across ten rows. The export preserves it
# rather than flattening the four into one convenient shape, because the convenient shape
# is the one that double-counts.
#
# THREE DATE BASES CROSS THE BOUNDARY AND EACH SAYS SO IN THE ROW. Deal date is what the
# F&I office produced. As-of net is what the store retained through the governed as-of
# date. Adjustment period groups events by their OWN date -- an August chargeback on a June
# contract belongs to August, and no consumer may restate it into June.
#
# NO QUOTIENT IS EXPORTED. Penetration, PVR, products per unit and the period-proxy rates
# all cross as numerator and denominator, so a group figure is SUM(numerator) /
# SUM(denominator) and an average of store percentages cannot be formed from this data.


def _fi_store_id(view: str) -> ColumnContract:
    """The store's business code, already resolved by the F&I view.

    Every F&I reporting view publishes ``dealership_id`` itself, so these datasets take it
    from the view rather than joining ``vw_dealership`` the way the older ones do. Same
    exported name, same value, one join fewer -- and a join that resolves a key the source
    has already resolved is a join that can only introduce a defect.
    """
    return ColumnContract(
        name="dealership_id",
        type="string",
        nullable=False,
        expression="base.dealership_id",
        source_column=f"{view}.dealership_id",
    )


def _fi_manager_code(view: str) -> ColumnContract:
    """The finance manager's synthetic code, or ``null`` for the unstaffed group.

    ``null`` here means NOBODY WAS ON THE F&I DESK -- a real population of real
    deliveries -- and never "manager unknown". The views carry a NOT NULL
    ``finance_manager_grain_key`` for uniqueness, and it is deliberately NOT exported:
    it is ``coalesce(employee_key, 0)`` over a warehouse surrogate, and surrogates stop
    at this boundary. ``finance_manager_code`` plus the store and date are what identify
    a row publicly, with ``null`` as a legitimate member of the key.
    """
    return ColumnContract(
        name="finance_manager_code",
        type="string",
        nullable=True,
        expression="base.finance_manager_id",
        source_column=f"{view}.finance_manager_id",
    )


_FI_SUMMARY = DatasetContract(
    name="fi-summary",
    source_view="vw_fi_summary",
    grain=(
        "One row per store, per sale date, per finance manager -- including the "
        "'nobody on the F&I desk' group. NO PRODUCT CATEGORY: this dataset carries "
        "finance reserve and retail units, both properties of a DEAL."
    ),
    business_key=("dealership_id", "sale_date", "finance_manager_code"),
    date_basis="sale date for every production measure; as-of for the retained ones",
    sort_keys=("dealership_id", "sale_date", "finance_manager_code"),
    chunked=False,
    kpi_ids=(
        "KPI-FNI-001",
        "KPI-FNI-002",
        "KPI-FNI-003",
        "KPI-FNI-004",
        "KPI-FNI-005",
        "KPI-FNI-006",
        "KPI-FNI-011",
        "KPI-FNI-014",
        "KPI-FNI-015",
        "KPI-FNI-018",
        "KPI-FNI-019",
        "KPI-FNI-022",
    ),
    columns=(
        _fi_store_id("vw_fi_summary"),
        _attribute("store_short_name", "string", view="vw_fi_summary"),
        _attribute("sale_date", "date", view="vw_fi_summary"),
        _fi_manager_code("vw_fi_summary"),
        _measure("retail_units", "integer", unit="units", view="vw_fi_summary"),
        _measure("cash_deal_count", "integer", unit="deals", view="vw_fi_summary"),
        _measure("retail_finance_deal_count", "integer", unit="deals", view="vw_fi_summary"),
        _measure("lease_deal_count", "integer", unit="deals", view="vw_fi_summary"),
        _measure(
            "finance_reserve_gross", "currency", unit="USD", precision=2, view="vw_fi_summary"
        ),
        _measure(
            "back_end_gross_deal_date", "currency", unit="USD", precision=2, view="vw_fi_summary"
        ),
        _measure("contract_count", "integer", unit="contracts", view="vw_fi_summary"),
        _measure("deals_with_a_product", "integer", unit="deals", view="vw_fi_summary"),
        _measure("product_retail_price", "currency", unit="USD", precision=2, view="vw_fi_summary"),
        _measure("product_dealer_cost", "currency", unit="USD", precision=2, view="vw_fi_summary"),
        _measure(
            "original_product_gross", "currency", unit="USD", precision=2, view="vw_fi_summary"
        ),
        _measure("original_fi_gross", "currency", unit="USD", precision=2, view="vw_fi_summary"),
        _measure("adjustment_event_count", "integer", unit="events", view="vw_fi_summary"),
        _measure(
            "cumulative_adjustment_amount",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_summary",
        ),
        _measure(
            "net_product_gross_as_of", "currency", unit="USD", precision=2, view="vw_fi_summary"
        ),
        _measure("net_fi_gross_as_of", "currency", unit="USD", precision=2, view="vw_fi_summary"),
        _measure("minimum_sample_floor", "integer", unit="deals", view="vw_fi_summary"),
        _attribute("meets_minimum_sample", "boolean", view="vw_fi_summary"),
        _attribute("as_of_date", "date", view="vw_fi_summary"),
        _attribute("deal_date_basis", "string", view="vw_fi_summary"),
        _attribute("net_gross_date_basis", "string", view="vw_fi_summary"),
    ),
    notes=(
        "THE F&I PRODUCTION SUMMARY, and the dataset that deliberately has NO CATEGORY "
        "COLUMN. finance_reserve_gross and retail_units are properties of a DEAL; adding a "
        "category would repeat both on every category row and multiply them for anything "
        "that summed the result. Category-grain measures are fi-product-penetration's, "
        "which carries neither. NO QUOTIENT IS EXPORTED: reserve PVR, product gross PVR "
        "and products per retail unit all cross as components, so a group figure is "
        "SUM(numerator) / SUM(denominator) and never an average of store rates. "
        "retail_units is the denominator of KPI-FNI-002, -005, -006 and -022 and INCLUDES "
        "CASH DEALS, which cannot generate reserve -- the SQ-20 caution -- so "
        "cash_deal_count is published beside it to make that checkable rather than merely "
        "stated. deals_with_a_product exists so a reader can see how many deliveries "
        "carried nothing, and is NOT the denominator of products per retail unit. "
        "back_end_gross_deal_date is KPI-GRS-002 restricted to this group and is NEVER "
        "rewritten by a later adjustment: original_fi_gross is the produced figure and "
        "net_fi_gross_as_of the retained one, and the difference between them is the "
        "point of the distinction rather than an error. meets_minimum_sample is PUBLISHED, "
        "NOT APPLIED: no component is ever blanked, because a null would be "
        "indistinguishable from a manager with no deals at all, and the consumer renders "
        "'insufficient sample (n = X)' from the flag. finance_manager_code is null for the "
        "'nobody on the F&I desk' group, which is a real population and never dropped."
    ),
)

_FI_PRODUCT_PENETRATION = DatasetContract(
    name="fi-product-penetration",
    source_view="vw_fi_product_penetration",
    grain=(
        "One row per store, per sale date, per finance manager, per governed product "
        "category that was ELIGIBLE on at least one of that group's retail deals. NO "
        "RESERVE AND NO RETAIL-UNIT COLUMN."
    ),
    business_key=("dealership_id", "sale_date", "finance_manager_code", "product_category"),
    date_basis="sale date for the population and the production; as-of for the retained gross",
    sort_keys=("dealership_id", "sale_date", "finance_manager_code", "product_category"),
    # CHUNKED, on the measurement rather than the reflex. At 3,012 rows and 2.17 MB in the
    # root export it is the second-largest dataset in the lane -- ten category rows per
    # store-day-manager group -- and DATA_CONTRACT.md section 9 asks for the number before
    # the decision. fi-summary (354 rows, 267 kB) and fi-adjustment-summary (57 rows) stay
    # in one file each for the same reason inverted: partitioning them would add files and
    # a chunk table to save nothing.
    chunked=True,
    kpi_ids=(
        "KPI-FNI-007",
        "KPI-FNI-008",
        "KPI-FNI-009",
        "KPI-FNI-010",
        "KPI-FNI-011",
        "KPI-FNI-020",
        "KPI-FNI-021",
    ),
    columns=(
        _fi_store_id("vw_fi_product_penetration"),
        _attribute("store_short_name", "string", view="vw_fi_product_penetration"),
        _attribute("sale_date", "date", view="vw_fi_product_penetration"),
        _fi_manager_code("vw_fi_product_penetration"),
        _attribute(
            "product_category",
            "string",
            view="vw_fi_product_penetration",
            enumeration=_FI_PRODUCT_CATEGORIES,
        ),
        _attribute(
            "eligibility_rule_id",
            "string",
            view="vw_fi_product_penetration",
            enumeration=_FI_ELIGIBILITY_RULES,
        ),
        _measure(
            "penetration_numerator", "integer", unit="deals", view="vw_fi_product_penetration"
        ),
        _measure(
            "penetration_denominator", "integer", unit="deals", view="vw_fi_product_penetration"
        ),
        _measure("attached_deal_count", "integer", unit="deals", view="vw_fi_product_penetration"),
        _measure("eligible_deal_count", "integer", unit="deals", view="vw_fi_product_penetration"),
        _measure("contract_count", "integer", unit="contracts", view="vw_fi_product_penetration"),
        _measure(
            "product_retail_price",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_product_penetration",
        ),
        _measure(
            "product_dealer_cost",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_product_penetration",
        ),
        _measure(
            "original_product_gross",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_product_penetration",
        ),
        _measure(
            "adjustment_event_count", "integer", unit="events", view="vw_fi_product_penetration"
        ),
        _measure(
            "cumulative_adjustment_amount",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_product_penetration",
        ),
        _measure(
            "net_product_gross_as_of",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_product_penetration",
        ),
        _measure("minimum_sample_floor", "integer", unit="deals", view="vw_fi_product_penetration"),
        _attribute("meets_minimum_sample", "boolean", view="vw_fi_product_penetration"),
        _attribute("as_of_date", "date", view="vw_fi_product_penetration"),
        _attribute("deal_date_basis", "string", view="vw_fi_product_penetration"),
        _attribute("net_gross_date_basis", "string", view="vw_fi_product_penetration"),
    ),
    notes=(
        "THE CATEGORY-GRAIN DATASET, and the one that carries NO finance reserve and NO "
        "retail-unit column -- the other half of the rule fi-summary states. ROWS ARE "
        "BUILT FROM THE DEALS, NOT THE CONTRACTS: a category with an eligible population "
        "and no sales produces a row with a ZERO NUMERATOR, which is a finding; building "
        "from the contracts would make that row vanish and a category nobody sold would "
        "render identically to one nobody COULD have sold. THE DENOMINATOR IS THE POINT: "
        "penetration_numerator, penetration_denominator and the ELIG-* rule that produced "
        "the denominator are on every row and the ratio itself is left to the consumer, "
        "because GAP penetration is over FINANCED eligible deals and computing it over all "
        "retail deals is the single most available way to get this number wrong. "
        "penetration_numerator counts DISTINCT ATTACHED DEALS and contract_count counts "
        "CONTRACTS: one deal may legitimately carry two different products in one category "
        "-- a windscreen plan and a roadside plan are both Other Aftermarket Products -- "
        "so the two differ and are never interchangeable. eligibility_rule_id is stamped "
        "from config/reference/fi_product_eligibility.yaml, the one authority; no consumer "
        "may restate the predicate. EVERY VALUE IS SYNTHETIC: no penetration here is an "
        "industry benchmark, and no surface may describe one as good, bad, standard or "
        "recommended."
    ),
)

_FI_ADJUSTMENT_SUMMARY = DatasetContract(
    name="fi-adjustment-summary",
    source_view="vw_fi_adjustment_summary",
    grain=(
        "One row per store, per ADJUSTMENT date, per finance manager, per product "
        "category, per adjustment type."
    ),
    business_key=(
        "dealership_id",
        "adjustment_date",
        "finance_manager_code",
        "product_category",
        "adjustment_type",
    ),
    date_basis="adjustment date -- the event's OWN business date, never the parent sale's",
    sort_keys=(
        "dealership_id",
        "adjustment_date",
        "finance_manager_code",
        "product_category",
        "adjustment_type",
    ),
    chunked=False,
    kpi_ids=(
        "KPI-FNI-012",
        "KPI-FNI-013",
        "KPI-FNI-014",
        "KPI-FNI-015",
        "KPI-FNI-016",
        "KPI-FNI-017",
        "KPI-FNI-018",
    ),
    columns=(
        _fi_store_id("vw_fi_adjustment_summary"),
        _attribute("store_short_name", "string", view="vw_fi_adjustment_summary"),
        _attribute("adjustment_date", "date", view="vw_fi_adjustment_summary"),
        _fi_manager_code("vw_fi_adjustment_summary"),
        _attribute(
            "product_category",
            "string",
            view="vw_fi_adjustment_summary",
            enumeration=_FI_PRODUCT_CATEGORIES,
        ),
        _attribute(
            "adjustment_type",
            "string",
            view="vw_fi_adjustment_summary",
            enumeration=_FI_ADJUSTMENT_TYPES,
        ),
        _measure("adjustment_count", "integer", unit="events", view="vw_fi_adjustment_summary"),
        _measure(
            "adjustment_amount",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_adjustment_summary",
        ),
        _measure(
            "distinct_adjusted_contract_count",
            "integer",
            unit="contracts",
            view="vw_fi_adjustment_summary",
        ),
        _measure(
            "adjusted_contract_original_gross",
            "currency",
            unit="USD",
            precision=2,
            view="vw_fi_adjustment_summary",
        ),
        _attribute("numerator_date_basis", "string", view="vw_fi_adjustment_summary"),
        _attribute("rate_denominator_date_basis", "string", view="vw_fi_adjustment_summary"),
        _attribute("rate_denominator_source", "string", view="vw_fi_adjustment_summary"),
        _attribute("rate_basis_disclosure", "string", view="vw_fi_adjustment_summary"),
    ),
    notes=(
        "THE ONLY F&I DATASET ON THE ADJUSTMENT-DATE BASIS, which is why it is a separate "
        "dataset rather than more columns on fi-summary: an August chargeback on a June "
        "contract belongs to AUGUST, the June contract keeps June's gross, and two date "
        "bases inside one grain would put two populations behind one row with nothing "
        "failing. NO CONSUMER MAY RESTATE AN EVENT INTO ITS PARENT SALE'S MONTH. THE "
        "MIXED-BASIS RATES: KPI-FNI-014, -015 and -018 divide a figure from here by one "
        "from fi-summary -- the numerator's period is POSTING time and the denominator's is "
        "SELLING time -- so the result is a PERIOD PROXY and NOT a contract-cohort loss "
        "rate, because the contracts charged back in a month are mostly not the ones "
        "written in it. numerator_date_basis, rate_denominator_date_basis, "
        "rate_denominator_source and rate_basis_disclosure are published AS DATA so a "
        "consumer renders that disclosure from the row rather than from a sentence "
        "somebody remembered. The sale-date denominator is deliberately NOT copied onto "
        "these rows: a sale-date figure on an adjustment-date row is exactly the silent "
        "blend this design avoids. SIGN: a positive amount REDUCES retained gross and a "
        "negative one RESTORES it, so Reinstatement amounts are negative by construction "
        "and summing across types is legitimate arithmetic rather than a mistake. The "
        "reporting window truncates the adjustment lag distribution, so recent sale months "
        "carry structurally fewer events -- a property of the dataset, not a finding."
    ),
)

_DEAL_PRODUCT_DETAIL = DatasetContract(
    name="deal-product-detail",
    source_view="vw_deal_product_detail",
    grain="One row per F&I product contract sold on a finalized vehicle transaction.",
    business_key=("product_sale_id",),
    date_basis="sale date for the contract; as-of for its retained gross",
    sort_keys=("sale_id", "line_ordinal", "product_sale_id"),
    chunked=True,
    kpi_ids=("KPI-FNI-003", "KPI-FNI-004", "KPI-FNI-011"),
    columns=(
        _attribute("product_sale_id", "string", view="vw_deal_product_detail"),
        _attribute("sale_id", "string", view="vw_deal_product_detail"),
        # sale_date must remain the FIRST date column: the transformer partitions a
        # chunked dataset by the first one it finds, and the governed partition key is the
        # sale month -- the same one deal-jacket uses, so a jacket page opens exactly one
        # product partition and it is the one it already opened for the deal row.
        _attribute("sale_date", "date", view="vw_deal_product_detail"),
        _fi_store_id("vw_deal_product_detail"),
        _attribute("store_short_name", "string", view="vw_deal_product_detail"),
        _fi_manager_code("vw_deal_product_detail"),
        _attribute(
            "finance_structure",
            "string",
            view="vw_deal_product_detail",
            enumeration=_RETAIL_FINANCE_STRUCTURES,
        ),
        _attribute("lender_id", "string", nullable=True, view="vw_deal_product_detail"),
        _attribute(
            "lender_category",
            "string",
            nullable=True,
            view="vw_deal_product_detail",
            enumeration=_LENDER_CATEGORIES,
        ),
        _attribute(
            "lender_program_tier",
            "string",
            nullable=True,
            view="vw_deal_product_detail",
            enumeration=_LENDER_PROGRAM_TIERS,
        ),
        _attribute("finance_product_id", "string", view="vw_deal_product_detail"),
        _attribute("product_name", "string", view="vw_deal_product_detail"),
        _attribute(
            "product_category",
            "string",
            view="vw_deal_product_detail",
            enumeration=_FI_PRODUCT_CATEGORIES,
        ),
        _attribute("provider_name", "string", view="vw_deal_product_detail"),
        _attribute(
            "eligibility_rule_id",
            "string",
            view="vw_deal_product_detail",
            enumeration=_FI_ELIGIBILITY_RULES,
        ),
        _measure("line_ordinal", "integer", unit="position", view="vw_deal_product_detail"),
        _measure("contract_term_months", "integer", unit="months", view="vw_deal_product_detail"),
        _measure("product_sale_count", "integer", unit="contracts", view="vw_deal_product_detail"),
        _measure(
            "product_retail_price",
            "currency",
            unit="USD",
            precision=2,
            view="vw_deal_product_detail",
        ),
        _measure(
            "product_dealer_cost",
            "currency",
            unit="USD",
            precision=2,
            view="vw_deal_product_detail",
        ),
        _measure(
            "original_product_gross",
            "currency",
            unit="USD",
            precision=2,
            view="vw_deal_product_detail",
        ),
        _measure("adjustment_event_count", "integer", unit="events", view="vw_deal_product_detail"),
        _measure(
            "cumulative_adjustment_amount",
            "currency",
            unit="USD",
            precision=2,
            view="vw_deal_product_detail",
        ),
        _measure(
            "net_product_gross_as_of",
            "currency",
            unit="USD",
            precision=2,
            view="vw_deal_product_detail",
        ),
        _attribute("as_of_date", "date", view="vw_deal_product_detail"),
        _attribute("gross_date_basis", "string", view="vw_deal_product_detail"),
        _attribute("net_gross_date_basis", "string", view="vw_deal_product_detail"),
    ),
    notes=(
        "THE ITEMIZATION BEHIND ONE DEAL'S BACK GROSS, and the third deal-grain dataset. "
        "It exists for /dashboard/deals/[saleId] and NOT for the Deal Explorer index: the "
        "index stays compact, and this is chunked by store and SALE MONTH -- the same "
        "partition key deal-jacket uses -- so opening one jacket loads one product "
        "partition and never the whole population's contract detail. contract_term_months "
        "IS THE COVERAGE'S TERM AND NOT A LOAN TERM: ARPI models no loan term, no APR, no "
        "payment and no rate of any kind, and the two must never be conflated. "
        "original_product_gross is the DEAL-DATE figure and is never rewritten by a later "
        "cancellation; net_product_gross_as_of is the retained figure through the governed "
        "as-of date. A page verifies original_product_gross = product_retail_price - "
        "product_dealer_cost and net = original - cumulative from these components with "
        "exact-decimal arithmetic, which is a verification rather than a second definition. "
        "finance_structure carries only the three RETAIL values here, because a disposal "
        "has no consumer and can carry no contract. lender_id is null on a Cash contract "
        "and means NO LENDER EXISTS. EVERY PRODUCT, PROVIDER AND LENDER IS FICTIONAL and "
        "every price is synthetic: none is a market price, a recommended price or a real "
        "company's program. NO CUSTOMER REFERENCE OF ANY KIND, and no free-text field."
    ),
)

#: Every dataset, in export order. This tuple is the allowlist.
DATASETS: Final[tuple[DatasetContract, ...]] = (
    _STORES,
    _CALENDAR,
    _LEAD_SOURCES,
    _CAMPAIGNS,
    _SALES_SUMMARY,
    _GROSS_SUMMARY,
    _INVENTORY_HEALTH,
    _INVENTORY_AGING,
    _DAYS_TO_SALE,
    _INVENTORY_TURN,
    _DAYS_SUPPLY,
    _LEAD_FUNNEL,
    _APPOINTMENT_FUNNEL,
    _LEAD_RESPONSE,
    _MARKETING_PERFORMANCE,
    _SALES_GROSS_TREND,
    _GROSS_CHANGE_BRIDGE,
    _TARGET_ATTAINMENT,
    _DEAL_EXPLORER,
    _DEAL_JACKET,
    _FI_SUMMARY,
    _FI_PRODUCT_PENETRATION,
    _FI_ADJUSTMENT_SUMMARY,
    _DEAL_PRODUCT_DETAIL,
    _RECONCILIATION_STATUS,
    _PIPELINE_RUN,
)

#: Dataset names, in export order.
DATASET_NAMES: Final[tuple[str, ...]] = tuple(entry.name for entry in DATASETS)

#: Every ``reporting`` view the exporter may read, primary or joined.
#:
#: A view absent from here is unreadable even though ``arpi_reporter`` could select it:
#: allowlist, not discovery (DATA_CONTRACT.md section 1).
SOURCE_VIEW_ALLOWLIST: Final[tuple[str, ...]] = tuple(
    sorted({entry.source_view for entry in DATASETS} | {v for e in DATASETS for v in e.join_views})
)

_DATASETS_BY_NAME: Final[Mapping[str, DatasetContract]] = MappingProxyType(
    {entry.name: entry for entry in DATASETS}
)


def dataset(name: str) -> DatasetContract:
    """Return the named dataset's contract.

    Args:
        name: The dataset identifier.

    Returns:
        The matching :class:`DatasetContract`.

    Raises:
        KeyError: If no dataset carries that name.
    """
    try:
        return _DATASETS_BY_NAME[name]
    except KeyError:
        known = ", ".join(DATASET_NAMES)
        raise KeyError(
            f"unknown dashboard dataset {name!r}; the contract declares: {known}"
        ) from None


# ---------------------------------------------------------------------------------------
# Group-level reconciliation totals
# ---------------------------------------------------------------------------------------
# Every entry is a sum over an additive column, or a pair of sums. There is deliberately
# no entry for a median, a days-supply or a turn: those are not additive, a group figure
# for them is not the average of the store figures, and inventing one here would be the
# exact error DATA_CONTRACT.md section 12 exists to prevent. Their evidence is row-level
# equality between the export and the view, asserted by
# tests/integration/test_dashboard_export.py.

RECONCILIATION_TOTALS: Final[tuple[ReconciliationTotal, ...]] = (
    ReconciliationTotal(
        "retail_units",
        "sales-summary",
        "retail_units_sold",
        type="integer",
        unit="units",
        kpi_id="KPI-SLS-001",
    ),
    ReconciliationTotal(
        "new_units",
        "sales-summary",
        "new_units_sold",
        type="integer",
        unit="units",
        kpi_id="KPI-SLS-002",
    ),
    ReconciliationTotal(
        "used_units",
        "sales-summary",
        "used_units_sold",
        type="integer",
        unit="units",
        kpi_id="KPI-SLS-003",
    ),
    ReconciliationTotal(
        "front_end_gross",
        "gross-summary",
        "front_end_gross",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-GRS-001",
    ),
    ReconciliationTotal(
        "back_end_gross",
        "gross-summary",
        "back_end_gross",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-GRS-002",
    ),
    ReconciliationTotal(
        "total_gross",
        "gross-summary",
        "total_gross",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-GRS-003",
    ),
    ReconciliationTotal(
        "front_gross_per_retail_unit",
        "gross-summary",
        "front_end_gross",
        "retail_units_sold",
        type="exact",
        unit="USD per unit",
        display_precision=2,
        kpi_id="KPI-GRS-004",
    ),
    ReconciliationTotal(
        "back_gross_per_retail_unit",
        "gross-summary",
        "back_end_gross",
        "retail_units_sold",
        type="exact",
        unit="USD per unit",
        display_precision=2,
        kpi_id="KPI-GRS-005",
    ),
    ReconciliationTotal(
        "total_gross_per_retail_unit",
        "gross-summary",
        "total_gross",
        "retail_units_sold",
        type="exact",
        unit="USD per unit",
        display_precision=2,
        kpi_id="KPI-GRS-006",
    ),
    ReconciliationTotal(
        "leads_received",
        "lead-funnel",
        "leads_received",
        type="integer",
        unit="leads",
        kpi_id="KPI-FUN-001",
    ),
    ReconciliationTotal(
        "contacted_leads",
        "lead-funnel",
        "contacted_leads",
        type="integer",
        unit="leads",
    ),
    ReconciliationTotal(
        "appointment_set_leads",
        "lead-funnel",
        "appointment_set_leads",
        type="integer",
        unit="leads",
    ),
    ReconciliationTotal(
        "sold_leads",
        "lead-funnel",
        "sold_leads",
        type="integer",
        unit="leads",
    ),
    ReconciliationTotal(
        "contact_rate",
        "lead-funnel",
        "contacted_leads",
        "leads_received",
        type="exact",
        unit="ratio",
        display_precision=3,
        kpi_id="KPI-FUN-002",
    ),
    ReconciliationTotal(
        "appointment_set_rate",
        "lead-funnel",
        "appointment_set_leads",
        "leads_received",
        type="exact",
        unit="ratio",
        display_precision=3,
        kpi_id="KPI-FUN-003",
    ),
    ReconciliationTotal(
        "lead_to_sale_conversion",
        "lead-funnel",
        "sold_leads",
        "leads_received",
        type="exact",
        unit="ratio",
        display_precision=3,
        kpi_id="KPI-FUN-006",
    ),
    ReconciliationTotal(
        "shown_appointments",
        "appointment-funnel",
        "shown_appointments",
        type="integer",
        unit="appointments",
    ),
    ReconciliationTotal(
        "show_rate",
        "appointment-funnel",
        "shown_appointments",
        "eligible_appointments",
        type="exact",
        unit="ratio",
        display_precision=3,
        kpi_id="KPI-FUN-004",
    ),
    ReconciliationTotal(
        "show_to_sale_conversion",
        "appointment-funnel",
        "shown_and_sold_appointments",
        "shown_appointments_on_show_date",
        type="exact",
        unit="ratio",
        display_precision=3,
        kpi_id="KPI-FUN-005",
    ),
    ReconciliationTotal(
        "average_response_seconds",
        "lead-response",
        "response_seconds_total",
        "responded_leads",
        type="exact",
        unit="seconds",
        display_precision=1,
        kpi_id="KPI-FUN-007",
    ),
    ReconciliationTotal(
        "marketing_spend",
        "marketing-performance",
        "spend_amount",
        unit="USD",
        display_precision=2,
    ),
    ReconciliationTotal(
        "attributed_total_gross",
        "marketing-performance",
        "attributed_total_gross",
        unit="USD",
        display_precision=2,
    ),
    ReconciliationTotal(
        "cost_per_lead",
        "marketing-performance",
        "spend_amount",
        "attributed_leads",
        type="exact",
        unit="USD per lead",
        display_precision=2,
        kpi_id="KPI-MKT-001",
    ),
    ReconciliationTotal(
        "cost_per_sale",
        "marketing-performance",
        "spend_amount",
        "attributed_retail_units",
        type="exact",
        unit="USD per sale",
        display_precision=2,
        kpi_id="KPI-MKT-002",
    ),
    ReconciliationTotal(
        "gross_return_on_ad_spend",
        "marketing-performance",
        "attributed_total_gross",
        "spend_amount",
        type="exact",
        unit="ratio",
        display_precision=2,
        kpi_id="KPI-MKT-003",
    ),
    # ---------------------------------------------------------------------------------
    # Targets and pace (DASH.5)
    # ---------------------------------------------------------------------------------
    # Every entry names its subset. `target-attainment` carries unit targets and currency
    # targets in one column and store plans beside department refinements of them, so a
    # total over the whole dataset would add units to dollars AND count the same gross
    # twice. There is deliberately no attainment, pace or projection total: each is a
    # ratio, its group value is SUM(numerator) / SUM(denominator), and publishing the two
    # sums is what makes an average of store percentages impossible to form.
    ReconciliationTotal(
        "retail_unit_target",
        "target-attainment",
        "target_value",
        type="exact",
        unit="units",
        display_precision=0,
        kpi_id="KPI-TGT-001",
        subset=(("target_scope_type", "Store"), ("target_kpi_id", "KPI-SLS-001")),
    ),
    ReconciliationTotal(
        "total_gross_target",
        "target-attainment",
        "target_value",
        type="exact",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-TGT-003",
        subset=(("target_scope_type", "Store"), ("target_kpi_id", "KPI-GRS-003")),
    ),
    ReconciliationTotal(
        "retail_unit_target_attainment",
        "target-attainment",
        "attainment_numerator",
        "attainment_denominator",
        type="exact",
        unit="ratio",
        display_precision=4,
        kpi_id="KPI-TGT-002",
        subset=(("target_scope_type", "Store"), ("target_kpi_id", "KPI-SLS-001")),
    ),
    ReconciliationTotal(
        "total_gross_target_attainment",
        "target-attainment",
        "attainment_numerator",
        "attainment_denominator",
        type="exact",
        unit="ratio",
        display_precision=4,
        kpi_id="KPI-TGT-004",
        subset=(("target_scope_type", "Store"), ("target_kpi_id", "KPI-GRS-003")),
    ),
    ReconciliationTotal(
        "front_end_gross_target",
        "target-attainment",
        "target_value",
        type="exact",
        unit="USD",
        display_precision=2,
        subset=(("target_scope_type", "Department"), ("department_name", "Sales")),
    ),
    ReconciliationTotal(
        "back_end_gross_target",
        "target-attainment",
        "target_value",
        type="exact",
        unit="USD",
        display_precision=2,
        subset=(("target_scope_type", "Department"), ("department_name", "Finance")),
    ),
    # The F&I lane (DASH.7). Only ADDITIVE components appear, and the two ratios are
    # numerator/denominator pairs -- a group penetration is SUM(numerator) /
    # SUM(denominator), never an average of store rates.
    ReconciliationTotal(
        "finance_reserve_gross",
        "fi-summary",
        "finance_reserve_gross",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-FNI-001",
    ),
    ReconciliationTotal(
        "original_product_gross",
        "fi-summary",
        "original_product_gross",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-FNI-003",
    ),
    ReconciliationTotal(
        "net_product_gross_as_of",
        "fi-summary",
        "net_product_gross_as_of",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-FNI-004",
    ),
    ReconciliationTotal(
        "fi_contract_count",
        "fi-summary",
        "contract_count",
        type="integer",
        unit="contracts",
    ),
    ReconciliationTotal(
        "products_per_retail_unit",
        "fi-summary",
        "contract_count",
        "retail_units",
        type="exact",
        unit="ratio",
        display_precision=4,
        kpi_id="KPI-FNI-006",
    ),
    # THE PENETRATION PAIR, subset to one rule so the denominator means something. GAP is
    # the case worth reconciling: its denominator is FINANCED eligible deals, and computing
    # it over all retail deals is the single most available way to get this number wrong.
    ReconciliationTotal(
        "gap_penetration",
        "fi-product-penetration",
        "penetration_numerator",
        "penetration_denominator",
        type="exact",
        unit="ratio",
        display_precision=4,
        kpi_id="KPI-FNI-008",
        subset=(("eligibility_rule_id", "ELIG-GAP"),),
    ),
    ReconciliationTotal(
        "vsc_penetration",
        "fi-product-penetration",
        "penetration_numerator",
        "penetration_denominator",
        type="exact",
        unit="ratio",
        display_precision=4,
        kpi_id="KPI-FNI-007",
        subset=(("eligibility_rule_id", "ELIG-VSC"),),
    ),
    ReconciliationTotal(
        "chargeback_amount",
        "fi-adjustment-summary",
        "adjustment_amount",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-FNI-012",
        subset=(("adjustment_type", "Chargeback"),),
    ),
    ReconciliationTotal(
        "cancellation_amount",
        "fi-adjustment-summary",
        "adjustment_amount",
        unit="USD",
        display_precision=2,
        kpi_id="KPI-FNI-016",
        subset=(("adjustment_type", "Cancellation"),),
    ),
)


# ---------------------------------------------------------------------------------------
# Query construction
# ---------------------------------------------------------------------------------------
# The SQL is generated from the contract rather than written out per dataset, so a column
# cannot appear in a query without appearing in the declaration -- which is what makes the
# query hash a hash OF THE CONTRACT and not merely of some text beside it.

#: The join clause each key resolution needs, keyed by the alias it introduces.
_JOINS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "store": (
            "JOIN reporting.vw_dealership AS store ON store.dealership_key = base.dealership_key"
        ),
        "lead_source": (
            "JOIN reporting.vw_lead_source AS lead_source "
            "ON lead_source.lead_source_key = base.lead_source_key"
        ),
        "campaign": (
            "LEFT JOIN reporting.vw_marketing_campaign AS campaign "
            "ON campaign.campaign_key = base.campaign_key"
        ),
        "sale_date": (
            "JOIN reporting.vw_calendar AS sale_date ON sale_date.date_key = base.sale_date_key"
        ),
        "snapshot_date": (
            "JOIN reporting.vw_calendar AS snapshot_date "
            "ON snapshot_date.date_key = base.snapshot_date_key"
        ),
        "as_of_date": (
            "JOIN reporting.vw_calendar AS as_of_date ON as_of_date.date_key = base.as_of_date_key"
        ),
        "sale_month": (
            "JOIN reporting.vw_calendar AS sale_month "
            "ON sale_month.date_key = base.sale_month_date_key"
        ),
        "month": "JOIN reporting.vw_calendar AS month ON month.date_key = base.month_date_key",
        "lead_date": (
            "JOIN reporting.vw_calendar AS lead_date "
            "ON lead_date.date_key = base.lead_created_date_key"
        ),
        "appointment_date": (
            "JOIN reporting.vw_calendar AS appointment_date "
            "ON appointment_date.date_key = base.date_key"
        ),
    }
)


def _aliases(entry: DatasetContract) -> tuple[str, ...]:
    """Return the join aliases a dataset's expressions require, in declaration order."""
    seen: list[str] = []
    for column in entry.columns:
        alias = column.expression.split(".", 1)[0]
        if alias != "base" and alias not in seen:
            seen.append(alias)
    return tuple(seen)


def dataset_sql(entry: DatasetContract) -> str:
    """Build the exact SQL text for a dataset.

    The text is deterministic for a given contract, which is what makes its hash
    meaningful: a changed column list, a changed sort or a changed filter changes the hash,
    and reindenting this function's output does not.

    Args:
        entry: The dataset contract.

    Returns:
        The SQL ``SELECT`` statement, with ``base`` as the primary view's alias.
    """
    select = ",\n".join(f"    {column.expression} AS {column.name}" for column in entry.columns)
    lines = [
        "SELECT",
        select,
        f"FROM {ALLOWED_SOURCE_SCHEMA}.{entry.source_view} AS base",
    ]
    lines.extend(_JOINS[alias] for alias in _aliases(entry))
    if entry.where is not None:
        lines.append(f"WHERE {entry.where}")
    lines.append("ORDER BY " + ", ".join(entry.sort_keys))
    return "\n".join(lines)


def source_grain_columns(entry: DatasetContract) -> tuple[str, ...]:
    """Return the source-view columns that fix a dataset's grain.

    A dataset's business key is written in exported terms -- ``dealership_id``,
    ``snapshot_date`` -- but those are business codes resolved through a dimension join. The
    grain the *view* has is fixed by the surrogate columns behind them, and an integration
    test that wants to prove the declared grain is the real one has to ask about those.

    So each business-key column is mapped back: a ``base.x`` expression contributes ``x``,
    and an ``alias.y`` expression contributes whichever ``base.*`` column that alias joins
    on.

    Args:
        entry: The dataset contract.

    Returns:
        The source column names, in business-key order, without duplicates.
    """
    resolved: list[str] = []
    for name in entry.business_key:
        expression = entry.column(name).expression
        alias, _, _ = expression.partition(".")
        if alias == "base":
            candidate = expression.split(".", 1)[1]
        else:
            match = re.search(r"base\.(\w+)", _JOINS[alias])
            if match is None:  # pragma: no cover - every join is keyed on a base column
                raise KeyError(f"join alias {alias!r} does not key on a base column")
            candidate = match.group(1)
        if candidate not in resolved:
            resolved.append(candidate)
    return tuple(resolved)


def referenced_views(sql: str) -> tuple[str, ...]:
    """Return every ``schema.object`` reference in a query, as ``schema.object`` strings.

    Used to enforce the allowlist against the query that will actually run, rather than
    against the declaration that was supposed to produce it. A reference to any schema
    other than ``reporting``, or to a ``reporting`` view outside
    :data:`SOURCE_VIEW_ALLOWLIST`, aborts the export.

    Args:
        sql: The query text.

    Returns:
        Distinct references in first-appearance order.
    """
    pattern = re.compile(r"\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b")
    aliases = {"base", *_JOINS}
    found: list[str] = []
    for schema, obj in pattern.findall(sql):
        if schema in aliases:
            continue
        reference = f"{schema}.{obj}"
        if reference not in found:
            found.append(reference)
    return tuple(found)
