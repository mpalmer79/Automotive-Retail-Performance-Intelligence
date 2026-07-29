#!/usr/bin/env python3
"""Static structural check of the ARPI Power BI semantic model.

THIS IS A TEXT CHECK, NOT A POWER BI ENGINE.
--------------------------------------------
It parses the PBIP project's TMDL as text and asserts the structure that
`powerbi/model_documentation/` specifies: which tables exist, which
relationships exist and which of them are active, which columns are hidden,
which measures exist and how they are written. It never opens Power BI Desktop,
never connects to PostgreSQL, and never evaluates a DAX expression. A model that
passes this check can still be wrong in ways only a refresh will show, which is
what `scripts/check_desktop_validation_freshness.py` and the Desktop validation
evidence exist for.

The TMDL parser here is deliberately small. TMDL is a real language with real
edge cases; this reads the subset ARPI actually writes -- tab-indented objects,
`///` descriptions, `key: value` properties, bare flags, annotations and
expression bodies -- and would need extending before it could read anything
else. That is the intended trade: a parser small enough to review beats a
parser general enough to be trusted blindly.

What it enforces, in order:

* project structure -- the five JSON files, their schemas, the TMDL layout, no
  PBIX, no report visual content, no local Power BI state;
* tables -- exactly 26, twenty imported from `reporting` and six calculated
  measure tables, each partitioned, annotated and described;
* privacy and least privilege -- no PII-bearing column, no schema other than
  `reporting`, no credential material, only the two non-secret parameters;
* relationships -- exactly the 42-row register, 32 active and 10 inactive, none
  bidirectional, none many-to-many, every column resolvable;
* columns -- data types, hidden keys, hidden numerators, sort-by pairings, no
  implicit measures;
* measures -- exactly 49, the 29 governed KPI identifiers, format strings from
  the approved set, `DIVIDE` on every ratio, and no Deferred-domain measure.

Standard library only, so CI can run it without installing the package.

Usage
-----
    python scripts/check_powerbi_model.py
    python scripts/check_powerbi_model.py --quiet

Exit codes
----------
    0  the model matches the specification
    1  at least one finding
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent

PROJECT_DIR: Path = REPO_ROOT / "powerbi" / "ARPI_Performance_Intelligence"
SEMANTIC_MODEL_DIR: Path = PROJECT_DIR / "ARPI_Performance_Intelligence.SemanticModel"
REPORT_DIR: Path = PROJECT_DIR / "ARPI_Performance_Intelligence.Report"
DEFINITION_DIR: Path = SEMANTIC_MODEL_DIR / "definition"
TABLES_DIR: Path = DEFINITION_DIR / "tables"

PBIP_FILE: Path = PROJECT_DIR / "ARPI_Performance_Intelligence.pbip"
PBISM_FILE: Path = SEMANTIC_MODEL_DIR / "definition.pbism"
PBIR_FILE: Path = REPORT_DIR / "definition.pbir"
SEMANTIC_MODEL_PLATFORM: Path = SEMANTIC_MODEL_DIR / ".platform"
REPORT_PLATFORM: Path = REPORT_DIR / ".platform"

SCHEMA_HOST: str = "https://developer.microsoft.com/json-schemas"
PBIP_SCHEMA: str = f"{SCHEMA_HOST}/fabric/pbip/pbipProperties/1.0.0/schema.json"
PBISM_SCHEMA: str = (
    f"{SCHEMA_HOST}/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json"
)
PBIR_SCHEMA: str = f"{SCHEMA_HOST}/fabric/item/report/definitionProperties/2.0.0/schema.json"
PLATFORM_SCHEMA: str = f"{SCHEMA_HOST}/fabric/gitIntegration/platformProperties/2.0.0/schema.json"

MINIMUM_PBISM_VERSION: tuple[int, int] = (4, 0)

#: Directories never walked when looking for stray artefacts.
SKIPPED_DIRECTORY_NAMES: frozenset[str] = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "env",
        "ENV",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        "htmlcov",
        "build",
        "dist",
    }
)

# ---------------------------------------------------------------------------
# The specification, hard-coded
# ---------------------------------------------------------------------------
# Everything below is the register from powerbi/model_documentation/. It is
# duplicated here on purpose: a check that read its expectations out of the same
# tree it is checking would pass by construction.

#: The twenty tables imported from the `reporting` schema, in model order.
IMPORTED_TABLES: tuple[str, ...] = (
    "vw_calendar",
    "vw_dealership",
    "vw_employee",
    "vw_customer",
    "vw_vehicle_model",
    "vw_vehicle",
    "vw_lead_source",
    "vw_marketing_campaign",
    "vw_vehicle_sales",
    "vw_inventory_snapshots",
    "vw_leads",
    "vw_appointments",
    "vw_marketing_spend",
    "vw_inventory_turn",
    "vw_days_supply",
    "vw_marketing_performance",
    "vw_data_quality_trend",
    "vw_reconciliation_status",
    "vw_pipeline_run_summary",
    "vw_data_quality_summary",
)

#: The six calculated tables that carry the measures.
MEASURE_TABLES: tuple[str, ...] = (
    "Sales Measures",
    "Gross Measures",
    "Inventory Measures",
    "Lead Funnel Measures",
    "Marketing Measures",
    "Data Quality Measures",
)

#: The five grain-preserving facts plus the three imported analytical views. No
#: active relationship may join two of these to each other.
FACT_TABLES: frozenset[str] = frozenset(
    {
        "vw_vehicle_sales",
        "vw_inventory_snapshots",
        "vw_leads",
        "vw_appointments",
        "vw_marketing_spend",
        "vw_inventory_turn",
        "vw_days_supply",
        "vw_marketing_performance",
    }
)

#: Annotations every imported table must carry.
REQUIRED_TABLE_ANNOTATIONS: tuple[str, ...] = (
    "ARPI_SourceView",
    "ARPI_Grain",
    "ARPI_TableRole",
)

#: Schemas the reporter holds no privilege on. None may be named in any M query.
FORBIDDEN_SCHEMA_PREFIXES: tuple[str, ...] = ("raw.", "staging.", "warehouse.", "audit.")

#: The only schema the model is allowed to read.
PERMITTED_SCHEMA: str = "reporting"

#: Column-name fragments that would mean personal data reached the model.
#: `age_band`, `county` and `tenure_band` are banded or coarse and are allowed;
#: these are the raw forms that must be absent.
FORBIDDEN_COLUMN_FRAGMENTS: tuple[str, ...] = (
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "address",
    "street",
    "postal",
    "zip_code",
    "ssn",
    "date_of_birth",
    "dob",
    "pay_plan",
    "salary",
    "commission",
)

#: The only two M parameters the model may declare, and the metadata each needs.
PERMITTED_PARAMETERS: tuple[str, ...] = ("ArpiServer", "ArpiDatabase")

#: Credential material. None of it belongs anywhere under `powerbi/`: the
#: database identity lives in the Power BI credential store on the refreshing
#: machine, never in this repository.
CREDENTIAL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("password-assignment", re.compile(r"\b(?:password|pwd|passwd)\s*=", re.IGNORECASE)),
    ("sslmode-in-connection-string", re.compile(r"\bsslmode\s*=", re.IGNORECASE)),
    ("secret-assignment", re.compile(r"\b(?:secret|api[_-]?key|access[_-]?key)\s*[:=]", re.I)),
    ("bearer-or-auth-token", re.compile(r"\b(?:token|authorization|bearer)\s*[:=]", re.I)),
    ("credentialed-uri", re.compile(r"://[^\s:@/]+:[^\s:@/]+@")),
    ("private-key-block", re.compile(r"-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----")),
)


@dataclass(frozen=True)
class RelationshipSpec:
    """One row of the relationship register."""

    name: str
    from_table: str
    from_column: str
    to_table: str
    to_column: str
    is_active: bool


def _active(name: str, from_ref: str, to_ref: str) -> RelationshipSpec:
    """Build an active register row from `table.column` references."""
    from_table, from_column = from_ref.split(".")
    to_table, to_column = to_ref.split(".")
    return RelationshipSpec(name, from_table, from_column, to_table, to_column, True)


def _inactive(name: str, from_ref: str, to_ref: str) -> RelationshipSpec:
    """Build an inactive register row from `table.column` references."""
    from_table, from_column = from_ref.split(".")
    to_table, to_column = to_ref.split(".")
    return RelationshipSpec(name, from_table, from_column, to_table, to_column, False)


#: The complete relationship register. `fromColumn` is always the many side.
RELATIONSHIP_REGISTER: tuple[RelationshipSpec, ...] = (
    # Calendar
    _active(
        "cal_to_vehicle_sales_sale_date",
        "vw_vehicle_sales.sale_date_key",
        "vw_calendar.date_key",
    ),
    _active(
        "cal_to_inventory_snapshots_snapshot_date",
        "vw_inventory_snapshots.snapshot_date_key",
        "vw_calendar.date_key",
    ),
    _active("cal_to_leads_created_date", "vw_leads.lead_created_date_key", "vw_calendar.date_key"),
    _active(
        "cal_to_appointments_scheduled_date",
        "vw_appointments.scheduled_date_key",
        "vw_calendar.date_key",
    ),
    _active(
        "cal_to_marketing_spend_month",
        "vw_marketing_spend.month_date_key",
        "vw_calendar.date_key",
    ),
    # Store
    _active(
        "dealership_to_vehicle_sales",
        "vw_vehicle_sales.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active(
        "dealership_to_inventory_snapshots",
        "vw_inventory_snapshots.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active("dealership_to_leads", "vw_leads.dealership_key", "vw_dealership.dealership_key"),
    _active(
        "dealership_to_appointments",
        "vw_appointments.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active(
        "dealership_to_marketing_spend",
        "vw_marketing_spend.dealership_key",
        "vw_dealership.dealership_key",
    ),
    # Vehicle
    _active(
        "vehicle_model_to_vehicle",
        "vw_vehicle.vehicle_model_key",
        "vw_vehicle_model.vehicle_model_key",
    ),
    _active("vehicle_to_vehicle_sales", "vw_vehicle_sales.vehicle_key", "vw_vehicle.vehicle_key"),
    _active(
        "vehicle_to_inventory_snapshots",
        "vw_inventory_snapshots.vehicle_key",
        "vw_vehicle.vehicle_key",
    ),
    # Customer
    _active(
        "customer_to_vehicle_sales",
        "vw_vehicle_sales.customer_key",
        "vw_customer.customer_key",
    ),
    _active("customer_to_leads", "vw_leads.customer_key", "vw_customer.customer_key"),
    _active(
        "customer_to_appointments",
        "vw_appointments.customer_key",
        "vw_customer.customer_key",
    ),
    # Employee
    _active(
        "employee_to_vehicle_sales_salesperson",
        "vw_vehicle_sales.salesperson_key",
        "vw_employee.employee_key",
    ),
    _active(
        "employee_to_leads_assigned",
        "vw_leads.assigned_employee_key",
        "vw_employee.employee_key",
    ),
    _active(
        "employee_to_appointments_salesperson",
        "vw_appointments.salesperson_key",
        "vw_employee.employee_key",
    ),
    # Marketing
    _active("lead_source_to_leads", "vw_leads.lead_source_key", "vw_lead_source.lead_source_key"),
    _active(
        "lead_source_to_vehicle_sales",
        "vw_vehicle_sales.lead_source_key",
        "vw_lead_source.lead_source_key",
    ),
    _active(
        "lead_source_to_marketing_spend",
        "vw_marketing_spend.lead_source_key",
        "vw_lead_source.lead_source_key",
    ),
    _active("campaign_to_leads", "vw_leads.campaign_key", "vw_marketing_campaign.campaign_key"),
    _active(
        "campaign_to_marketing_spend",
        "vw_marketing_spend.campaign_key",
        "vw_marketing_campaign.campaign_key",
    ),
    # The three imported analytical views
    _active(
        "cal_to_inventory_turn_month",
        "vw_inventory_turn.month_date_key",
        "vw_calendar.date_key",
    ),
    _active(
        "dealership_to_inventory_turn",
        "vw_inventory_turn.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active(
        "cal_to_days_supply_as_of_date",
        "vw_days_supply.as_of_date_key",
        "vw_calendar.date_key",
    ),
    _active(
        "dealership_to_days_supply",
        "vw_days_supply.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active(
        "cal_to_marketing_performance_month",
        "vw_marketing_performance.month_date_key",
        "vw_calendar.date_key",
    ),
    _active(
        "dealership_to_marketing_performance",
        "vw_marketing_performance.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _active(
        "lead_source_to_marketing_performance",
        "vw_marketing_performance.lead_source_key",
        "vw_lead_source.lead_source_key",
    ),
    _active(
        "campaign_to_marketing_performance",
        "vw_marketing_performance.campaign_key",
        "vw_marketing_campaign.campaign_key",
    ),
    # Inactive: role-playing dates
    _inactive(
        "cal_to_vehicle_sales_delivery_date",
        "vw_vehicle_sales.delivery_date_key",
        "vw_calendar.date_key",
    ),
    _inactive(
        "cal_to_appointments_created_date",
        "vw_appointments.created_date_key",
        "vw_calendar.date_key",
    ),
    _inactive(
        "cal_to_appointments_show_date",
        "vw_appointments.show_date_key",
        "vw_calendar.date_key",
    ),
    # Inactive: dimension to dimension, and the role-playing employee keys
    _inactive(
        "dealership_to_employee",
        "vw_employee.dealership_key",
        "vw_dealership.dealership_key",
    ),
    _inactive(
        "employee_to_vehicle_sales_desk_manager",
        "vw_vehicle_sales.desk_manager_key",
        "vw_employee.employee_key",
    ),
    _inactive(
        "employee_to_vehicle_sales_finance_manager",
        "vw_vehicle_sales.finance_manager_key",
        "vw_employee.employee_key",
    ),
    _inactive(
        "employee_to_appointments_bdc",
        "vw_appointments.bdc_employee_key",
        "vw_employee.employee_key",
    ),
    # Inactive: fact to fact
    _inactive("vehicle_sales_to_leads", "vw_leads.sale_key", "vw_vehicle_sales.sale_key"),
    _inactive(
        "vehicle_sales_to_appointments",
        "vw_appointments.sale_key",
        "vw_vehicle_sales.sale_key",
    ),
    _inactive("leads_to_appointments", "vw_appointments.lead_key", "vw_leads.lead_key"),
)

EXPECTED_ACTIVE_RELATIONSHIPS: int = 32
EXPECTED_INACTIVE_RELATIONSHIPS: int = 10

#: The marked date table and its date column.
DATE_TABLE: str = "vw_calendar"
DATE_TABLE_KEY_COLUMN: str = "calendar_date"

#: 02-relationship-plan.md section 6: pre-filtered numerators and materialised
#: ratio columns, which exist to be summed or recomputed by a measure and are
#: hidden so no report author puts one on a visual beside the measure.
HIDDEN_NUMERATOR_COLUMNS: tuple[tuple[str, str], ...] = (
    ("vw_vehicle_sales", "retail_unit_count"),
    ("vw_vehicle_sales", "new_unit_count"),
    ("vw_vehicle_sales", "used_unit_count"),
    ("vw_vehicle_sales", "wholesale_unit_count"),
    ("vw_vehicle_sales", "dealer_trade_unit_count"),
    ("vw_vehicle_sales", "retail_front_end_gross"),
    ("vw_vehicle_sales", "retail_back_end_gross"),
    ("vw_vehicle_sales", "retail_total_gross"),
    ("vw_vehicle_sales", "retail_days_in_inventory_total"),
    ("vw_inventory_snapshots", "aged_unit_count"),
    ("vw_inventory_snapshots", "aged_inventory_investment"),
    ("vw_leads", "valid_lead_count"),
    ("vw_leads", "duplicate_lead_count"),
    ("vw_leads", "contacted_lead_count"),
    ("vw_leads", "appointment_set_lead_count"),
    ("vw_leads", "appointment_shown_lead_count"),
    ("vw_leads", "sold_lead_count"),
    ("vw_leads", "response_seconds_total"),
    ("vw_leads", "responded_lead_count"),
    ("vw_leads", "unresponded_lead_count"),
    ("vw_appointments", "eligible_appointment_count"),
    ("vw_appointments", "cancelled_in_advance_count"),
    ("vw_appointments", "shown_appointment_count"),
    ("vw_appointments", "shown_and_sold_appointment_count"),
    ("vw_appointments", "confirmed_appointment_count"),
    ("vw_appointments", "test_drive_count"),
    ("vw_appointments", "write_up_count"),
    ("vw_marketing_performance", "cost_per_lead"),
    ("vw_marketing_performance", "cost_per_sale"),
    ("vw_marketing_performance", "gross_return_on_ad_spend"),
    ("vw_inventory_turn", "inventory_turn"),
    ("vw_days_supply", "days_supply"),
)

#: The column that says the data is synthetic. It appears on every table and is
#: never hidden: hiding it would remove the one column that says so.
NEVER_HIDDEN_COLUMN: str = "source_system"


@dataclass(frozen=True)
class SortBySpec:
    """One required `sortByColumn` pairing and whether the target is visible."""

    table: str
    column: str
    sort_by: str
    target_is_visible: bool = False


#: Every sort-by pairing the model declares, and the only ones it may declare.
#: The sort-by target is hidden except on vw_calendar, where month_number,
#: iso_day_of_week and quarter_number are business columns in their own right.
#:
#: vw_reconciliation_status is deliberately absent. It has no `severity` column:
#: sql/05_reporting/32_vw_reconciliation_status.sql projects `status`
#: (passed/failed) and `severity_rank` (0 passing, 1 failing informational, 2
#: failing critical). `severity_rank` is a combined status-and-criticality rank,
#: not an ordering of `status` -- `failed` maps to both 1 and 2 -- and Power BI
#: rejects a sort-by column that is not single-valued per label. Pairing them
#: would break the model rather than order it.
SORT_BY_REGISTER: tuple[SortBySpec, ...] = (
    SortBySpec("vw_calendar", "year_month_label", "year_month_number"),
    SortBySpec("vw_calendar", "month_year_label", "year_month_number"),
    SortBySpec("vw_calendar", "month_name", "month_number", target_is_visible=True),
    SortBySpec("vw_calendar", "day_name", "iso_day_of_week", target_is_visible=True),
    SortBySpec("vw_calendar", "quarter_name", "quarter_number", target_is_visible=True),
    SortBySpec("vw_inventory_snapshots", "age_bucket", "age_bucket_sort_order"),
    SortBySpec("vw_leads", "response_time_band", "response_time_band_sort_order"),
    SortBySpec("vw_customer", "age_band", "age_band_sort_order"),
    SortBySpec("vw_employee", "tenure_band", "tenure_band_sort_order"),
    SortBySpec("vw_vehicle", "odometer_band", "odometer_band_sort_order"),
    SortBySpec("vw_data_quality_trend", "severity", "severity_sort_order"),
    SortBySpec("vw_data_quality_summary", "severity", "severity_sort_order"),
)

#: The table that must declare no sort-by pairing at all, and why.
NO_SORT_BY_TABLE: str = "vw_reconciliation_status"

#: The 29 governed KPI identifiers, from KPI_CATALOG.md.
EXPECTED_KPI_IDS: tuple[str, ...] = (
    *(f"KPI-SLS-{n:03d}" for n in range(1, 4)),
    *(f"KPI-GRS-{n:03d}" for n in range(1, 7)),
    *(f"KPI-INV-{n:03d}" for n in range(1, 10)),
    *(f"KPI-FUN-{n:03d}" for n in range(1, 9)),
    *(f"KPI-MKT-{n:03d}" for n in range(1, 4)),
)

EXPECTED_MEASURE_COUNT: int = 49
EXPECTED_SUPPORTING_MEASURE_COUNT: int = 20
EXPECTED_EXECUTIVE_CARD_COUNT: int = 11

#: Every format string a measure may carry. A format string outside this set is
#: a presentation decision that was never reviewed.
APPROVED_FORMAT_STRINGS: frozenset[str] = frozenset(
    {
        "#,0",
        "$#,0;($#,0);-",
        "0.0%",
        '0.0 "min"',
        '0.0 "days"',
        '0 "days"',
        '0.0"x"',
        "0.00",
        "#,0.00",
        "yyyy-mm-dd hh:nn",
    }
)

#: The one measure that is text, so the one measure with no format string.
TEXT_MEASURE: str = "Pipeline Status"

#: Every ratio in the model. Each must divide with DIVIDE, so an empty
#: denominator renders as a gap rather than as an error or a zero.
RATIO_MEASURES: tuple[str, ...] = (
    "Front Gross per Retail Unit",
    "Back Gross per Retail Unit",
    "Total Gross per Retail Unit",
    "Average Inventory Age",
    "Aged Inventory Percentage",
    "Days to Sale (Mean)",
    "Inventory Turn",
    "Dealer Days Supply",
    "Contact Rate",
    "Appointment-Set Rate",
    "Show Rate",
    "Show-to-Sale Conversion",
    "Lead-to-Sale Conversion",
    "Average Response Time",
    "Median Response Time",
    "Cancellation Rate",
    "Cost per Lead",
    "Cost per Sale",
    "Gross Return on Advertising Spend",
    "Pass Rate",
    "Evaluation Coverage",
)

#: Inventory stocks. A stock is not additive across dates, so every one of these
#: is evaluated at the last date in the filter context rather than summed.
SEMI_ADDITIVE_MEASURES: tuple[str, ...] = (
    "Active Inventory Count",
    "Inventory Investment",
    "Average Inventory Age",
    "Median Inventory Age",
    "Aged Inventory Count",
    "Aged Inventory Percentage",
    "Aged Inventory Investment",
    "Dealer Days Supply",
)

#: Seven of the eight anchor with LASTNONBLANKVALUE, which takes the last date
#: at which the inner EXPRESSION is non-blank. For these the expression is
#: non-blank whenever a row exists, so that is the same date as "the last date
#: with data".
LASTNONBLANKVALUE_MEASURES: tuple[str, ...] = tuple(
    name for name in SEMI_ADDITIVE_MEASURES if name != "Dealer Days Supply"
)

#: Dealer Days Supply is the exception, and the exception is the point.
#: Its ratio is legitimately BLANK on an as-of date whose trailing 30-day window
#: contains no retail sale. LASTNONBLANKVALUE would walk backwards past that
#: date and report an earlier day's days supply as though it were current; the
#: SQL baseline takes max(as_of_date_key) unconditionally, so the two would
#: disagree. Anchoring on LASTNONBLANK over COUNTROWS pins the last date that
#: has a ROW, blank ratio included.
LASTNONBLANK_ROW_ANCHORED_MEASURES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "Dealer Days Supply",
        ("LASTNONBLANK", "COUNTROWS", "'vw_days_supply'"),
    ),
)

#: The order statistics, each recomputed over a row-level column, because the
#: median of a group is not derivable from the medians of its subgroups.
MEDIAN_MEASURES: tuple[tuple[str, str], ...] = (
    ("Median Inventory Age", "'vw_inventory_snapshots'[days_in_stock]"),
    ("Days to Sale (Median)", "'vw_vehicle_sales'[retail_days_in_inventory]"),
    ("Median Response Time", "'vw_leads'[first_response_seconds]"),
)

#: Marketing cost is UNDEFINED, not zero, for a source with no spend row. Each
#: of these must test ISBLANK before dividing, or an organic source reports a
#: free lead.
ISBLANK_GUARDED_MEASURES: tuple[str, ...] = (
    "Cost per Lead",
    "Cost per Sale",
    "Gross Return on Advertising Spend",
)

#: The show-to-sale measure and the relationship it must activate.
SHOW_TO_SALE_MEASURE: str = "Show-to-Sale Conversion"
SHOW_TO_SALE_USERELATIONSHIP: str = (
    "USERELATIONSHIP ( 'vw_calendar'[date_key], 'vw_appointments'[show_date_key] )"
)

#: Deferred domains. Nothing in the model may imply ARPI holds the data for
#: them: warehouse.fact_finance_product_sale, service and target data do not
#: exist, so a measure that named one would be a claim about data ARPI has not
#: got.
DEFERRED_DOMAIN_PHRASES: tuple[str, ...] = (
    "f&i product penetration",
    "products per retail unit",
    "repeat-customer rate",
    "repeat customer rate",
    "service-to-sales conversion",
    "service to sales conversion",
    "target attainment",
)

DEFERRED_DOMAIN_TABLES: tuple[str, ...] = (
    "F&I Measures",
    "Customer Retention Measures",
    "Service to Sales Measures",
    "Target Attainment Measures",
)

#: Report authoring is delivery increment P2.2 and has not started. None of
#: these may exist under the report item yet.
FORBIDDEN_REPORT_ENTRIES: tuple[str, ...] = (
    "definition",
    "report.json",
    "pages",
    "mobileState.json",
    "bookmarks",
    "CustomVisuals",
)


# ---------------------------------------------------------------------------
# A small TMDL reader
# ---------------------------------------------------------------------------


@dataclass
class TmdlObject:
    """One TMDL object: a table, a column, a measure, a partition or a model."""

    kind: str
    name: str
    description: str = ""
    expression: str = ""
    properties: dict[str, str] = field(default_factory=dict)
    flags: set[str] = field(default_factory=set)
    annotations: dict[str, str] = field(default_factory=dict)
    children: list[TmdlObject] = field(default_factory=list)
    line_number: int = 0

    def child(self, kind: str, name: str) -> TmdlObject | None:
        """Return the named child of the given kind, or None."""
        for candidate in self.children:
            if candidate.kind == kind and candidate.name == name:
                return candidate
        return None

    def children_of(self, kind: str) -> list[TmdlObject]:
        """Return every child of the given kind, in file order."""
        return [candidate for candidate in self.children if candidate.kind == kind]


#: Object headers the reader understands. Anything else at object level is left
#: as an unrecognised line, which the structural checks then notice.
OBJECT_KEYWORDS: frozenset[str] = frozenset(
    {"table", "column", "measure", "partition", "model", "database", "relationship", "expression"}
)

_HEADER_RE = re.compile(r"^(?P<keyword>[A-Za-z]+)\s+(?P<rest>.*)$")
_PROPERTY_RE = re.compile(r"^(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?P<value>.*)$")
_ANNOTATION_RE = re.compile(r"^annotation\s+(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<value>.*)$")


#: The shortest string that can be a pair of quotes around a name.
MINIMUM_QUOTED_LENGTH: int = 2


def _unquote(name: str) -> str:
    """Strip the single quotes TMDL puts around a name containing a space."""
    stripped = name.strip()
    if (
        len(stripped) >= MINIMUM_QUOTED_LENGTH
        and stripped.startswith("'")
        and stripped.endswith("'")
    ):
        return stripped[1:-1]
    return stripped


def _indent_of(line: str) -> int:
    """Return the number of leading tabs on *line*."""
    return len(line) - len(line.lstrip("\t"))


class _TmdlReader:
    """Line-at-a-time reader for the subset of TMDL that ARPI writes.

    Objects are introduced by a keyword at some indentation; their properties,
    flags and annotations sit one level deeper; an expression body sits two or
    more levels deeper. Consecutive `///` lines immediately above an object are
    its description.
    """

    def __init__(self) -> None:
        """Start with an empty tree and nothing open."""
        self.roots: list[TmdlObject] = []
        # Stack of (indent, object). The object on top owns what comes next.
        self._stack: list[tuple[int, TmdlObject]] = []
        self._description: list[str] = []
        self._body_owner: TmdlObject | None = None
        self._body_property: str | None = None
        self._body_indent: int = 0
        self._body_lines: list[str] = []

    # -- expression bodies ------------------------------------------------

    def _open_body(self, owner: TmdlObject, prop: str | None, indent: int, first: str) -> None:
        self._body_owner = owner
        self._body_property = prop
        self._body_indent = indent
        self._body_lines = [first] if first else []

    def _close_body(self) -> None:
        owner, prop, lines = self._body_owner, self._body_property, self._body_lines
        self._body_owner = None
        self._body_property = None
        self._body_lines = []
        if owner is None or not lines:
            return
        body = "\n".join(lines).strip()
        if prop is None:
            owner.expression = body
            return
        existing = owner.properties.get(prop, "")
        owner.properties[prop] = f"{existing}\n{body}".strip() if existing else body

    # -- one line ---------------------------------------------------------

    def feed(self, number: int, raw_line: str) -> None:
        """Consume one physical line."""
        if not raw_line.strip():
            return
        indent = _indent_of(raw_line)
        content = raw_line.strip()

        if self._body_owner is not None and indent >= self._body_indent:
            self._body_lines.append(content)
            return
        self._close_body()

        if content.startswith("///"):
            self._description.append(content[3:].strip())
            return

        while self._stack and self._stack[-1][0] >= indent:
            self._stack.pop()

        # A line at column zero that is not an object header still belongs to
        # the object opened at column zero: model.tmdl writes the model's own
        # annotations and `ref table` lines that way.
        owner = self._stack[-1][1] if self._stack else (self.roots[-1] if self.roots else None)

        annotation = _ANNOTATION_RE.match(content)
        if annotation is not None and owner is not None:
            owner.annotations[annotation.group("key")] = annotation.group("value").strip()
            self._description = []
            return

        keyword = self._object_keyword(content)
        if keyword:
            self._open_object(keyword, content, indent, number)
            return

        self._description = []
        if owner is not None:
            self._assign(owner, content, indent)

    def _object_keyword(self, content: str) -> str:
        header = _HEADER_RE.match(content)
        if header is None:
            return ""
        keyword = header.group("keyword")
        if keyword not in OBJECT_KEYWORDS:
            return ""
        # A property wins when the line parses as one: `mode: import` and the
        # like never collide with a keyword, but the guard costs nothing.
        if self._stack and _PROPERTY_RE.match(content):
            return ""
        return keyword

    def _open_object(self, keyword: str, content: str, indent: int, number: int) -> None:
        header = _HEADER_RE.match(content)
        assert header is not None
        rest = header.group("rest")
        name_part, _, inline = rest.partition("=") if "=" in rest else (rest, "", "")
        obj = TmdlObject(
            kind=keyword,
            name=_unquote(name_part),
            description=" ".join(self._description).strip(),
            expression=inline.strip(),
            line_number=number,
        )
        self._description = []
        if self._stack:
            self._stack[-1][1].children.append(obj)
        else:
            self.roots.append(obj)
        self._stack.append((indent, obj))
        if "=" in rest and not inline.strip():
            self._open_body(obj, None, indent + 2, "")

    def _assign(self, owner: TmdlObject, content: str, indent: int) -> None:
        prop = _PROPERTY_RE.match(content)
        if prop is not None:
            owner.properties[prop.group("key")] = prop.group("value").strip()
            return
        if content.endswith("=") or " = " in content:
            key, _, value = content.partition("=")
            key = key.strip()
            if key == "source":
                owner.properties["source"] = ""
                self._open_body(owner, "source", indent + 1, value.strip())
                return
            owner.properties[key] = value.strip()
            return
        # Anything else at property level is a bare flag: `isHidden`, `isKey`.
        owner.flags.add(content)

    def finish(self) -> list[TmdlObject]:
        """Close any open body and return the parsed roots."""
        self._close_body()
        return self.roots


def parse_tmdl(text: str) -> list[TmdlObject]:
    """Parse the subset of TMDL that ARPI writes into a shallow object tree."""
    reader = _TmdlReader()
    for number, raw_line in enumerate(text.splitlines(), start=1):
        reader.feed(number, raw_line)
    return reader.finish()


def partition_source(partition: TmdlObject) -> str:
    """Return the M or DAX body of *partition* as a single string.

    A partition's `expression` holds its kind (`m` or `calculated`); the body
    is the `source` property.
    """
    return partition.properties.get("source", "")


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Finding:
    """One thing that is wrong, named by file and by what is wrong with it."""

    path: str
    message: str

    def render(self) -> str:
        """Return the one-finding report line."""
        return f"{self.path}: {self.message}"


def relative_posix(path: Path) -> str:
    """Return *path* as a repository-relative POSIX string."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


class Checker:
    """Accumulates findings while walking the project."""

    def __init__(self) -> None:
        """Start with no findings and no parsed model."""
        self.findings: list[Finding] = []
        self.tables: dict[str, TmdlObject] = {}
        self.relationships: list[TmdlObject] = []
        self.model: TmdlObject | None = None
        self.expressions: list[TmdlObject] = []
        self.checks_run: int = 0

    # -- helpers ---------------------------------------------------------

    def fail(self, path: Path | str, message: str) -> None:
        """Record one finding against *path*."""
        located = path if isinstance(path, str) else relative_posix(path)
        self.findings.append(Finding(located, message))

    def check(self, condition: bool, path: Path | str, message: str) -> bool:
        """Record a finding when *condition* is false; return the condition."""
        self.checks_run += 1
        if not condition:
            self.fail(path, message)
        return condition

    def measures(self) -> list[tuple[str, TmdlObject]]:
        """Return every (table name, measure) pair in the model."""
        pairs: list[tuple[str, TmdlObject]] = []
        for table_name, table in self.tables.items():
            for measure in table.children_of("measure"):
                pairs.append((table_name, measure))
        return pairs

    def measure_by_name(self, name: str) -> TmdlObject | None:
        """Return the measure with *name*, or None."""
        for _, measure in self.measures():
            if measure.name == name:
                return measure
        return None

    def column_names(self, table_name: str) -> set[str]:
        """Return the column names declared on *table_name*."""
        table = self.tables.get(table_name)
        if table is None:
            return set()
        return {column.name for column in table.children_of("column")}

    # -- 1. project structure --------------------------------------------

    def check_project_structure(self) -> None:
        """The PBIP layout, the five JSON files and their declared schemas."""
        required = {
            PBIP_FILE: "the PBIP project file",
            SEMANTIC_MODEL_PLATFORM: "the semantic model's git-integration metadata",
            PBISM_FILE: "the semantic model definition properties",
            REPORT_PLATFORM: "the report's git-integration metadata",
            PBIR_FILE: "the report definition properties",
        }
        for path, description in required.items():
            self.check(path.is_file(), path, f"{description} does not exist")
        self.check(
            DEFINITION_DIR.is_dir(),
            DEFINITION_DIR,
            "the semantic model definition directory does not exist",
        )

        if DEFINITION_DIR.is_dir():
            expected_entries = {
                "database.tmdl",
                "model.tmdl",
                "expressions.tmdl",
                "relationships.tmdl",
                "tables",
            }
            actual_entries = {entry.name for entry in DEFINITION_DIR.iterdir()}
            unexpected = sorted(actual_entries - expected_entries)
            missing = sorted(expected_entries - actual_entries)
            self.check(
                not missing,
                DEFINITION_DIR,
                f"the definition directory is missing {missing}",
            )
            self.check(
                not unexpected,
                DEFINITION_DIR,
                f"the definition directory holds entries the model does not declare: {unexpected}",
            )
            self.check(
                TABLES_DIR.is_dir(),
                TABLES_DIR,
                "the tables directory does not exist",
            )

        self._check_json_schemas()

    def _load_json(self, path: Path) -> dict[str, object] | None:
        """Parse *path* as JSON, recording a finding if it will not parse."""
        if not path.is_file():
            return None
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            self.fail(path, f"is not valid JSON: {error}")
            return None
        if not isinstance(loaded, dict):
            self.fail(path, "does not hold a JSON object at the top level")
            return None
        return loaded

    def _check_schema(self, path: Path, document: dict[str, object], expected: str) -> None:
        declared = document.get("$schema")
        self.check(
            declared == expected,
            path,
            f"declares $schema {declared!r}, expected {expected!r}",
        )

    def _check_json_schemas(self) -> None:
        pbip = self._load_json(PBIP_FILE)
        if pbip is not None:
            self._check_schema(PBIP_FILE, pbip, PBIP_SCHEMA)

        pbism = self._load_json(PBISM_FILE)
        if pbism is not None:
            self._check_schema(PBISM_FILE, pbism, PBISM_SCHEMA)
            version = str(pbism.get("version", ""))
            self.check(
                _version_tuple(version) >= MINIMUM_PBISM_VERSION,
                PBISM_FILE,
                f"declares version {version!r}; TMDL requires 4.0 or higher",
            )

        pbir = self._load_json(PBIR_FILE)
        if pbir is not None:
            self._check_schema(PBIR_FILE, pbir, PBIR_SCHEMA)
            reference = pbir.get("datasetReference")
            by_path = reference.get("byPath") if isinstance(reference, dict) else None
            declared_path = by_path.get("path") if isinstance(by_path, dict) else None
            self.check(
                declared_path == "../ARPI_Performance_Intelligence.SemanticModel",
                PBIR_FILE,
                (
                    "datasetReference.byPath.path is "
                    f"{declared_path!r}, expected "
                    "'../ARPI_Performance_Intelligence.SemanticModel'"
                ),
            )

        for platform_file in (SEMANTIC_MODEL_PLATFORM, REPORT_PLATFORM):
            platform = self._load_json(platform_file)
            if platform is not None:
                self._check_schema(platform_file, platform, PLATFORM_SCHEMA)

    # -- 2. artefacts that must not exist --------------------------------

    def check_forbidden_artefacts(self) -> None:
        """No PBIX, no report visual content, no local Power BI state."""
        for pattern, reason in (
            ("*.pbix", "a PBIX is a binary artefact; ARPI is a PBIP/TMDL project (policy P2.1)"),
            ("*.abf", "an ABF is a local model cache and is never committed"),
        ):
            for path in _walk(REPO_ROOT, pattern):
                self.fail(path, reason)
        self.checks_run += 2

        for path in _walk(REPO_ROOT, "localSettings.json"):
            if path.parent.name == ".pbi":
                self.fail(path, "local Power BI settings are machine state and are never committed")
        for path in _walk(REPO_ROOT, "cache.abf"):
            if path.parent.name == ".pbi":
                self.fail(path, "a local Power BI model cache is never committed")
        self.checks_run += 2

        if REPORT_DIR.is_dir():
            present = {entry.name for entry in REPORT_DIR.iterdir()}
            for forbidden in FORBIDDEN_REPORT_ENTRIES:
                self.check(
                    forbidden not in present,
                    REPORT_DIR / forbidden,
                    (
                        f"report visual content {forbidden!r} exists; report authoring is "
                        "delivery increment P2.2 and has not started"
                    ),
                )

    # -- 3. the model file ------------------------------------------------

    def load_model(self) -> None:
        """Parse model.tmdl, expressions.tmdl, relationships.tmdl and tables/."""
        model_file = DEFINITION_DIR / "model.tmdl"
        if model_file.is_file():
            roots = parse_tmdl(model_file.read_text(encoding="utf-8"))
            for root in roots:
                if root.kind == "model":
                    self.model = root

        expressions_file = DEFINITION_DIR / "expressions.tmdl"
        if expressions_file.is_file():
            self.expressions = [
                root
                for root in parse_tmdl(expressions_file.read_text(encoding="utf-8"))
                if root.kind == "expression"
            ]

        relationships_file = DEFINITION_DIR / "relationships.tmdl"
        if relationships_file.is_file():
            self.relationships = [
                root
                for root in parse_tmdl(relationships_file.read_text(encoding="utf-8"))
                if root.kind == "relationship"
            ]

        if TABLES_DIR.is_dir():
            for table_file in sorted(TABLES_DIR.glob("*.tmdl")):
                for root in parse_tmdl(table_file.read_text(encoding="utf-8")):
                    if root.kind == "table":
                        self.tables[root.name] = root

    def check_model_settings(self) -> None:
        """Implicit measures discouraged, auto date/time off, tables declared."""
        model_file = DEFINITION_DIR / "model.tmdl"
        if self.model is None:
            self.check(False, model_file, "declares no model object")
            return
        self.check(
            "discourageImplicitMeasures" in self.model.flags,
            model_file,
            "does not declare discourageImplicitMeasures, so a report author can drag a "
            "column onto a visual and get an ungoverned aggregate",
        )
        self.check(
            self.model.annotations.get("__PBI_TimeIntelligenceEnabled") == "0",
            model_file,
            "does not declare annotation __PBI_TimeIntelligenceEnabled = 0, so Power BI "
            "would build a hidden auto date table per date column",
        )

    # -- 4. tables --------------------------------------------------------

    def check_tables(self) -> None:
        """Exactly 26 tables, each partitioned, annotated and described."""
        expected = set(IMPORTED_TABLES) | set(MEASURE_TABLES)
        actual = set(self.tables)
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        self.check(not missing, TABLES_DIR, f"the model does not declare table(s) {missing}")
        self.check(
            not unexpected,
            TABLES_DIR,
            f"the model declares table(s) the specification does not list: {unexpected}",
        )
        self.check(
            len(self.tables) == len(expected),
            TABLES_DIR,
            f"the model declares {len(self.tables)} tables, expected {len(expected)}",
        )

        for name in DEFERRED_DOMAIN_TABLES:
            self.check(
                name not in self.tables,
                TABLES_DIR,
                f"table {name!r} exists; that domain is Deferred and ARPI holds no data for it",
            )

        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            self.check(bool(table.description), path, f"table {name} carries no /// description")
            partitions = table.children_of("partition")
            self.check(
                len(partitions) == 1,
                path,
                f"table {name} declares {len(partitions)} partitions, expected exactly one",
            )
            if not partitions:
                continue
            partition = partitions[0]
            if name in MEASURE_TABLES:
                self.check(
                    partition.expression.strip() == "calculated"
                    or partition.name.endswith("calculated"),
                    path,
                    f"measure table {name} partition is not '= calculated'",
                )
                continue
            self._check_imported_table(name, table, partition, path)

    def _check_imported_table(
        self, name: str, table: TmdlObject, partition: TmdlObject, path: Path
    ) -> None:
        self.check(
            partition.expression.strip() == "m",
            path,
            f"table {name} partition is not an M partition ('= m')",
        )
        self.check(
            partition.properties.get("mode") == "import",
            path,
            f"table {name} partition declares mode "
            f"{partition.properties.get('mode')!r}, expected 'import'",
        )
        source = partition_source(partition)
        expected_item = f'Source{{[Schema = "{PERMITTED_SCHEMA}", Item = "{name}"]}}[Data]'
        self.check(
            _normalise_whitespace(expected_item) in _normalise_whitespace(source),
            path,
            f"table {name} partition does not read {expected_item}",
        )
        for missing in [
            annotation
            for annotation in REQUIRED_TABLE_ANNOTATIONS
            if annotation not in table.annotations
        ]:
            self.check(False, path, f"table {name} carries no annotation {missing}")

    def check_source_schemas(self) -> None:
        """No partition may name a schema the reporting role cannot read."""
        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            for partition in table.children_of("partition"):
                source = partition_source(partition)
                for prefix in FORBIDDEN_SCHEMA_PREFIXES:
                    self.check(
                        prefix not in source,
                        path,
                        f"table {name} partition names schema {prefix.rstrip('.')!r}; "
                        "arpi_reporter holds no privilege on it",
                    )
                for schema in re.findall(r'Schema\s*=\s*"([^"]*)"', source):
                    self.check(
                        schema == PERMITTED_SCHEMA,
                        path,
                        f"table {name} partition reads schema {schema!r}, "
                        f"expected {PERMITTED_SCHEMA!r}",
                    )

    def check_no_personal_data(self) -> None:
        """No column may name or contain a direct personal identifier."""
        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            for column in table.children_of("column"):
                lowered = column.name.lower()
                for fragment in FORBIDDEN_COLUMN_FRAGMENTS:
                    self.check(
                        fragment not in lowered,
                        path,
                        f"column {name}[{column.name}] carries personal data: its name "
                        f"contains {fragment!r}, which ARPI does not hold",
                    )

    # -- 5. credentials ---------------------------------------------------

    def check_credentials(self) -> None:
        """No credential material anywhere under powerbi/, and two parameters."""
        powerbi_root = REPO_ROOT / "powerbi"
        for path in sorted(powerbi_root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            if any(part in SKIPPED_DIRECTORY_NAMES for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for line_number, line in enumerate(text.splitlines(), start=1):
                for detector, pattern in CREDENTIAL_PATTERNS:
                    if pattern.search(line):
                        self.fail(
                            f"{relative_posix(path)}:{line_number}",
                            f"[{detector}] credential material must never appear under powerbi/; "
                            "the database identity lives in the Power BI credential store",
                        )
        self.checks_run += 1

        expressions_file = DEFINITION_DIR / "expressions.tmdl"
        declared = [expression.name for expression in self.expressions]
        self.check(
            declared == list(PERMITTED_PARAMETERS),
            expressions_file,
            f"declares parameters {declared}, expected {list(PERMITTED_PARAMETERS)}",
        )
        for expression in self.expressions:
            self.check(
                "IsParameterQuery=true"
                in _normalise_whitespace(expression.expression).replace(" ", ""),
                expressions_file,
                f"parameter {expression.name} is not marked IsParameterQuery=true",
            )
            self.check(
                'Type="Text"' in _normalise_whitespace(expression.expression).replace(" ", ""),
                expressions_file,
                f'parameter {expression.name} is not typed Type="Text"',
            )

    # -- 6. relationships -------------------------------------------------

    def check_relationships(self) -> None:
        """The 42-row register, exactly, with no bidirectional or many-to-many."""
        path = DEFINITION_DIR / "relationships.tmdl"
        declared = {relationship.name: relationship for relationship in self.relationships}
        self.check(
            len(self.relationships) == len(RELATIONSHIP_REGISTER),
            path,
            f"declares {len(self.relationships)} relationships, "
            f"expected {len(RELATIONSHIP_REGISTER)}",
        )
        self.check(
            len(declared) == len(self.relationships),
            path,
            "declares two relationships with the same name",
        )

        expected_names = {spec.name for spec in RELATIONSHIP_REGISTER}
        missing = sorted(expected_names - set(declared))
        unexpected = sorted(set(declared) - expected_names)
        self.check(not missing, path, f"does not declare relationship(s) {missing}")
        self.check(
            not unexpected,
            path,
            f"declares relationship(s) the register does not list: {unexpected}",
        )

        active_count = 0
        inactive_count = 0
        for spec in RELATIONSHIP_REGISTER:
            relationship = declared.get(spec.name)
            if relationship is None:
                continue
            self._check_relationship_columns(path, spec, relationship)
            is_active = relationship.properties.get("isActive", "true").strip().lower() != "false"
            self.check(
                is_active == spec.is_active,
                path,
                f"relationship {spec.name} is "
                f"{'active' if is_active else 'inactive'}, expected "
                f"{'active' if spec.is_active else 'inactive'}",
            )
            if is_active:
                active_count += 1
            else:
                inactive_count += 1

        self.check(
            active_count == EXPECTED_ACTIVE_RELATIONSHIPS,
            path,
            f"declares {active_count} active relationships, "
            f"expected {EXPECTED_ACTIVE_RELATIONSHIPS}",
        )
        self.check(
            inactive_count == EXPECTED_INACTIVE_RELATIONSHIPS,
            path,
            f"declares {inactive_count} inactive relationships, "
            f"expected {EXPECTED_INACTIVE_RELATIONSHIPS}",
        )

        for relationship in self.relationships:
            behaviour = relationship.properties.get("crossFilteringBehavior", "").strip()
            self.check(
                behaviour not in {"bothDirections", "automatic"},
                path,
                f"relationship {relationship.name} declares crossFilteringBehavior "
                f"{behaviour!r}; no relationship in this model filters in two directions",
            )
            to_cardinality = relationship.properties.get("toCardinality", "one").strip()
            from_cardinality = relationship.properties.get("fromCardinality", "many").strip()
            self.check(
                to_cardinality != "many",
                path,
                f"relationship {relationship.name} declares toCardinality 'many'; "
                "every dimension key in this model is unique, so no relationship is many-to-many",
            )
            self.check(
                not (from_cardinality == "one" and to_cardinality == "many"),
                path,
                f"relationship {relationship.name} is many-to-many",
            )

        self._check_no_active_fact_to_fact(path, declared)

    def _check_relationship_columns(
        self, path: Path, spec: RelationshipSpec, relationship: TmdlObject
    ) -> None:
        for role, expected_table, expected_column in (
            ("fromColumn", spec.from_table, spec.from_column),
            ("toColumn", spec.to_table, spec.to_column),
        ):
            declared_reference = relationship.properties.get(role, "")
            expected_reference = f"{expected_table}.{expected_column}"
            if not self.check(
                declared_reference == expected_reference,
                path,
                f"relationship {spec.name} declares {role} {declared_reference!r}, "
                f"expected {expected_reference!r}",
            ):
                continue
            self.check(
                expected_column in self.column_names(expected_table),
                path,
                f"relationship {spec.name} names {expected_reference}, but column "
                f"{expected_column!r} does not exist on table {expected_table}",
            )

    def _check_no_active_fact_to_fact(self, path: Path, declared: dict[str, TmdlObject]) -> None:
        for spec in RELATIONSHIP_REGISTER:
            relationship = declared.get(spec.name)
            if relationship is None:
                continue
            is_active = relationship.properties.get("isActive", "true").strip().lower() != "false"
            both_facts = spec.from_table in FACT_TABLES and spec.to_table in FACT_TABLES
            self.check(
                not (is_active and both_facts),
                path,
                f"relationship {spec.name} is an ACTIVE join between two fact tables "
                f"({spec.from_table} and {spec.to_table}); a fact-to-fact join must be "
                "inactive, or one fact's period silently filters the other",
            )

    def check_marked_date_table(self) -> None:
        """Exactly one table is marked as the date table, and it is vw_calendar."""
        marked = [
            name
            for name, table in self.tables.items()
            if table.properties.get("dataCategory") == "Time"
        ]
        self.check(
            marked == [DATE_TABLE],
            TABLES_DIR,
            f"tables marked dataCategory: Time are {sorted(marked)}, expected ['{DATE_TABLE}']",
        )
        calendar = self.tables.get(DATE_TABLE)
        if calendar is None:
            return
        path = TABLES_DIR / f"{DATE_TABLE}.tmdl"
        date_column = calendar.child("column", DATE_TABLE_KEY_COLUMN)
        if not self.check(
            date_column is not None,
            path,
            f"{DATE_TABLE} declares no column {DATE_TABLE_KEY_COLUMN}",
        ):
            return
        assert date_column is not None
        self.check(
            "isKey" in date_column.flags,
            path,
            f"{DATE_TABLE}[{DATE_TABLE_KEY_COLUMN}] does not declare isKey, so the model "
            "is not a marked date table",
        )

    # -- 7. columns -------------------------------------------------------

    def check_columns(self) -> None:
        """Data types, hidden keys, hidden numerators and summarizeBy: none."""
        for name in IMPORTED_TABLES:
            table = self.tables.get(name)
            if table is None:
                continue
            path = TABLES_DIR / f"{name}.tmdl"
            for column in table.children_of("column"):
                reference = f"{name}[{column.name}]"
                self.check(
                    "dataType" in column.properties,
                    path,
                    f"column {reference} declares no dataType",
                )
                self.check(
                    column.properties.get("summarizeBy") == "none",
                    path,
                    f"column {reference} declares summarizeBy "
                    f"{column.properties.get('summarizeBy')!r}, expected 'none'; anything "
                    "else is an implicit measure",
                )
                is_calculated = bool(column.expression)
                if is_calculated:
                    self.check(
                        "isHidden" in column.flags,
                        path,
                        f"calculated sort-order column {reference} is not hidden",
                    )
                else:
                    self.check(
                        "sourceColumn" in column.properties,
                        path,
                        f"column {reference} declares no sourceColumn",
                    )

        self._check_hidden_keys()
        self._check_hidden_numerators()
        self._check_source_system_visible()
        self._check_no_implicit_measures()

    def _check_hidden_keys(self) -> None:
        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            for column in table.children_of("column"):
                if not column.name.endswith("_key"):
                    continue
                self.check(
                    "isHidden" in column.flags,
                    path,
                    f"column {name}[{column.name}] is a surrogate key and is not hidden; "
                    "a report author who groups by one gets a meaningless axis",
                )

    def _check_hidden_numerators(self) -> None:
        for table_name, column_name in HIDDEN_NUMERATOR_COLUMNS:
            table = self.tables.get(table_name)
            path = TABLES_DIR / f"{table_name}.tmdl"
            if table is None:
                self.check(False, path, f"table {table_name} does not exist")
                continue
            column = table.child("column", column_name)
            if not self.check(
                column is not None,
                path,
                f"column {table_name}[{column_name}] does not exist",
            ):
                continue
            assert column is not None
            self.check(
                "isHidden" in column.flags,
                path,
                f"column {table_name}[{column_name}] is a pre-filtered numerator or a "
                "materialised ratio and is not hidden",
            )

    def _check_source_system_visible(self) -> None:
        for name, table in sorted(self.tables.items()):
            column = table.child("column", NEVER_HIDDEN_COLUMN)
            if column is None:
                continue
            self.check(
                "isHidden" not in column.flags,
                TABLES_DIR / f"{name}.tmdl",
                f"column {name}[{NEVER_HIDDEN_COLUMN}] is hidden; it is the one column that "
                "says the data is synthetic and must stay visible",
            )

    def _check_no_implicit_measures(self) -> None:
        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            for column in table.children_of("column"):
                summarize_by = column.properties.get("summarizeBy", "none")
                self.check(
                    summarize_by == "none",
                    path,
                    f"column {name}[{column.name}] declares summarizeBy {summarize_by!r}; "
                    "every column in this model must be summarizeBy: none",
                )

    def check_sort_by_columns(self) -> None:
        """The documented sort-by pairings, and the visibility of each target."""
        for spec in SORT_BY_REGISTER:
            path = TABLES_DIR / f"{spec.table}.tmdl"
            table = self.tables.get(spec.table)
            if table is None:
                self.check(False, path, f"table {spec.table} does not exist")
                continue
            column = table.child("column", spec.column)
            if not self.check(
                column is not None,
                path,
                f"column {spec.table}[{spec.column}] does not exist, so its sort order "
                f"cannot be set to {spec.sort_by}",
            ):
                continue
            assert column is not None
            self.check(
                column.properties.get("sortByColumn") == spec.sort_by,
                path,
                f"column {spec.table}[{spec.column}] declares sortByColumn "
                f"{column.properties.get('sortByColumn')!r}, expected {spec.sort_by!r}",
            )
            target = table.child("column", spec.sort_by)
            if not self.check(
                target is not None,
                path,
                f"sort-by target {spec.table}[{spec.sort_by}] does not exist",
            ):
                continue
            assert target is not None
            hidden = "isHidden" in target.flags
            if spec.target_is_visible:
                self.check(
                    not hidden,
                    path,
                    f"sort-by target {spec.table}[{spec.sort_by}] is hidden; it is a "
                    "business column in its own right and must stay visible",
                )
            else:
                self.check(
                    hidden,
                    path,
                    f"sort-by target {spec.table}[{spec.sort_by}] is not hidden; a sort-by "
                    "column exists to order another column, not to be put on a visual",
                )
        self._check_no_unregistered_sort_by()
        self._check_reconciliation_status_has_no_sort_order()

    def _check_no_unregistered_sort_by(self) -> None:
        """The register is exhaustive: no other column may declare a sort order."""
        registered = {(spec.table, spec.column, spec.sort_by) for spec in SORT_BY_REGISTER}
        for name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{name}.tmdl"
            for column in table.children_of("column"):
                sort_by = column.properties.get("sortByColumn")
                if sort_by is None:
                    continue
                self.check(
                    (name, column.name, sort_by) in registered,
                    path,
                    f"column {name}[{column.name}] declares sortByColumn {sort_by!r}, which "
                    "the sort-by register does not list; a sort-by column must be "
                    "single-valued per label or Power BI rejects it",
                )

    def _check_reconciliation_status_has_no_sort_order(self) -> None:
        """`severity_rank` is not an ordering of `status`, so nothing sorts by it."""
        table = self.tables.get(NO_SORT_BY_TABLE)
        if table is None:
            return
        path = TABLES_DIR / f"{NO_SORT_BY_TABLE}.tmdl"
        for column in table.children_of("column"):
            self.check(
                "sortByColumn" not in column.properties,
                path,
                f"column {NO_SORT_BY_TABLE}[{column.name}] declares a sort order. "
                "severity_rank is a combined status-and-criticality rank, not an ordering "
                "of status -- 'failed' maps to both 1 and 2 -- so no column on this table "
                "may be sorted by it",
            )

    # -- 8. measures ------------------------------------------------------

    def check_measures(self) -> None:
        """Counts, KPI identifiers, descriptions, folders and format strings."""
        pairs = self.measures()
        names = [measure.name for _, measure in pairs]
        self.check(
            len(pairs) == EXPECTED_MEASURE_COUNT,
            TABLES_DIR,
            f"the model declares {len(pairs)} measures, expected {EXPECTED_MEASURE_COUNT}",
        )
        duplicates = sorted({name for name in names if names.count(name) > 1})
        self.check(
            not duplicates,
            TABLES_DIR,
            f"measure name(s) declared more than once: {duplicates}",
        )

        kpi_ids: list[str] = []
        supporting = 0
        executive_cards = 0
        for table_name, measure in pairs:
            path = TABLES_DIR / f"{table_name}.tmdl"
            reference = f"{table_name}[{measure.name}]"
            kpi_id = measure.annotations.get("ARPI_KpiId")
            role = measure.annotations.get("ARPI_MeasureRole")
            if kpi_id is not None:
                kpi_ids.append(kpi_id)
            elif role == "Supporting":
                supporting += 1
            else:
                self.check(
                    False,
                    path,
                    f"measure {reference} carries neither ARPI_KpiId nor "
                    "ARPI_MeasureRole = Supporting",
                )
            if measure.annotations.get("ARPI_ExecutiveCard") == "true":
                executive_cards += 1

            self.check(
                bool(measure.description),
                path,
                f"measure {reference} carries no /// description",
            )
            self.check(
                "displayFolder" in measure.properties,
                path,
                f"measure {reference} declares no displayFolder",
            )
            format_string = measure.properties.get("formatString")
            if measure.name == TEXT_MEASURE:
                self.check(
                    format_string is None,
                    path,
                    f"measure {reference} is a text measure and must declare no formatString",
                )
            else:
                if not self.check(
                    format_string is not None,
                    path,
                    f"measure {reference} declares no formatString",
                ):
                    continue
                self.check(
                    format_string in APPROVED_FORMAT_STRINGS,
                    path,
                    f"measure {reference} declares formatString {format_string!r}, which is "
                    "not in the approved set",
                )

        self.check(
            sorted(kpi_ids) == sorted(EXPECTED_KPI_IDS),
            TABLES_DIR,
            f"the KPI identifiers carried by measures are {sorted(kpi_ids)}, expected "
            f"{sorted(EXPECTED_KPI_IDS)}",
        )
        self.check(
            len(kpi_ids) == len(set(kpi_ids)),
            TABLES_DIR,
            f"a KPI identifier is carried by more than one measure: "
            f"{sorted({kpi for kpi in kpi_ids if kpi_ids.count(kpi) > 1})}",
        )
        self.check(
            supporting == EXPECTED_SUPPORTING_MEASURE_COUNT,
            TABLES_DIR,
            f"the model declares {supporting} supporting measures, expected "
            f"{EXPECTED_SUPPORTING_MEASURE_COUNT}",
        )
        self.check(
            executive_cards == EXPECTED_EXECUTIVE_CARD_COUNT,
            TABLES_DIR,
            f"{executive_cards} measures carry ARPI_ExecutiveCard = true, expected "
            f"{EXPECTED_EXECUTIVE_CARD_COUNT}",
        )

    def check_measure_expressions(self) -> None:
        """DIVIDE on every ratio, the right anchor on every stock, MEDIAN, ISBLANK."""
        self._check_ratio_measures()
        self._check_semi_additive_measures()
        self._check_median_measures()
        self._check_marketing_measures()
        self._check_show_to_sale_measure()

    def _check_ratio_measures(self) -> None:
        """Every ratio divides with DIVIDE, so an empty denominator renders as a gap."""
        for name in RATIO_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if not self.check(measure is not None, path, f"measure {name!r} does not exist"):
                continue
            assert measure is not None
            expression = measure.expression
            self.check(
                re.search(r"\bDIVIDE\s*\(", expression) is not None,
                path,
                f"measure {name!r} is a ratio and does not use DIVIDE; a bare division "
                "returns infinity or an error where DIVIDE returns blank",
            )
            self.check(
                re.search(r"\bSUM\s*\([^()]*\([^()]*\)[^()]*\)\s*/\s*SUM\s*\(", expression) is None
                and re.search(r"\bSUM\s*\([^()]*\)\s*/\s*SUM\s*\(", expression) is None,
                path,
                f"measure {name!r} divides one SUM by another with a bare '/'",
            )

    def _check_semi_additive_measures(self) -> None:
        """Every inventory stock is anchored on the last date in the filter context."""
        for name in SEMI_ADDITIVE_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if not self.check(measure is not None, path, f"measure {name!r} does not exist"):
                continue
            assert measure is not None
            self.check(
                "LASTNONBLANK" in measure.expression,
                path,
                f"measure {name!r} is a stock and is not anchored on the last date in "
                "context; summing a stock across dates overstates it by roughly the "
                "number of days",
            )

        for name in LASTNONBLANKVALUE_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if measure is None:
                continue
            self.check(
                "LASTNONBLANKVALUE" in measure.expression,
                path,
                f"measure {name!r} is a stock whose inner expression is non-blank wherever "
                "a row exists, so it must anchor with LASTNONBLANKVALUE",
            )

        for name, required_terms in LASTNONBLANK_ROW_ANCHORED_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if measure is None:
                continue
            expression = measure.expression
            self.check(
                "LASTNONBLANKVALUE" not in expression,
                path,
                f"measure {name!r} anchors with LASTNONBLANKVALUE, which walks back past an "
                "as-of date whose ratio is legitimately blank and reports a stale figure as "
                "current; it must anchor on the last date with a ROW",
            )
            for term in required_terms:
                self.check(
                    term in expression,
                    path,
                    f"measure {name!r} does not contain {term!r}; it must anchor on "
                    "LASTNONBLANK over COUNTROWS of its own table, so a blank ratio still "
                    "counts as the last date in context",
                )

    def _check_median_measures(self) -> None:
        """Every order statistic is recomputed over a row-level column."""
        for name, column_reference in MEDIAN_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if not self.check(measure is not None, path, f"measure {name!r} does not exist"):
                continue
            assert measure is not None
            normalised = _normalise_whitespace(measure.expression)
            expected = _normalise_whitespace(f"MEDIAN ( {column_reference} )")
            alternative = _normalise_whitespace(f"MEDIAN({column_reference})")
            self.check(
                expected in normalised or alternative in normalised,
                path,
                f"measure {name!r} does not compute MEDIAN over {column_reference}; the "
                "median of a group is not derivable from the medians of its subgroups",
            )

    def _check_marketing_measures(self) -> None:
        """Marketing cost is undefined, not zero, for a source with no spend row."""
        for name in ISBLANK_GUARDED_MEASURES:
            measure = self.measure_by_name(name)
            path = self._measure_path(name)
            if not self.check(measure is not None, path, f"measure {name!r} does not exist"):
                continue
            assert measure is not None
            self.check(
                "ISBLANK" in measure.expression,
                path,
                f"measure {name!r} does not guard with ISBLANK; without it an organic "
                "source with no spend row reports a free lead rather than a blank",
            )

    def _check_show_to_sale_measure(self) -> None:
        """KPI-FUN-005 is evaluated on the show date, not the scheduled date."""
        measure = self.measure_by_name(SHOW_TO_SALE_MEASURE)
        path = self._measure_path(SHOW_TO_SALE_MEASURE)
        if self.check(
            measure is not None, path, f"measure {SHOW_TO_SALE_MEASURE!r} does not exist"
        ):
            assert measure is not None
            self.check(
                _normalise_whitespace(SHOW_TO_SALE_USERELATIONSHIP)
                in _normalise_whitespace(measure.expression),
                path,
                f"measure {SHOW_TO_SALE_MEASURE!r} does not activate "
                f"{SHOW_TO_SALE_USERELATIONSHIP}; on the scheduled-date basis its numerator "
                "and denominator fall in different months",
            )

    def check_no_deferred_domain_measures(self) -> None:
        """Nothing in the model may claim a Deferred domain ARPI has no data for."""
        for table_name, table in sorted(self.tables.items()):
            path = TABLES_DIR / f"{table_name}.tmdl"
            haystacks = [(f"table {table_name}", table.description)]
            for measure in table.children_of("measure"):
                haystacks.append((f"measure {table_name}[{measure.name}]", measure.name))
            for subject, text in haystacks:
                lowered = text.lower()
                for phrase in DEFERRED_DOMAIN_PHRASES:
                    self.check(
                        phrase not in lowered,
                        path,
                        f"{subject} names the Deferred domain {phrase!r}; ARPI holds no "
                        "data behind it, so no measure may imply otherwise",
                    )

    def _measure_path(self, name: str) -> Path | str:
        for table_name, measure in self.measures():
            if measure.name == name:
                return TABLES_DIR / f"{table_name}.tmdl"
        return relative_posix(TABLES_DIR)

    # -- driver -----------------------------------------------------------

    def run(self) -> None:
        """Run every check, in the order the module docstring lists them."""
        self.check_project_structure()
        self.check_forbidden_artefacts()
        self.load_model()
        self.check_model_settings()
        self.check_tables()
        self.check_source_schemas()
        self.check_no_personal_data()
        self.check_credentials()
        self.check_relationships()
        self.check_marked_date_table()
        self.check_columns()
        self.check_sort_by_columns()
        self.check_measures()
        self.check_measure_expressions()
        self.check_no_deferred_domain_measures()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _normalise_whitespace(text: str) -> str:
    """Collapse every run of whitespace to a single space."""
    return re.sub(r"\s+", " ", text).strip()


def _version_tuple(version: str) -> tuple[int, ...]:
    """Turn a dotted version string into a comparable tuple; () when unparsable."""
    parts: list[int] = []
    for part in version.split("."):
        if not part.isdigit():
            return ()
        parts.append(int(part))
    return tuple(parts)


def _walk(root: Path, pattern: str) -> Iterable[Path]:
    """Yield every file under *root* matching *pattern*, skipping tool caches."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob(pattern)):
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in SKIPPED_DIRECTORY_NAMES for part in path.parts):
            continue
        yield path


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description=(
            "Static structural check of the ARPI Power BI semantic model. "
            "Power BI Desktop is never launched."
        ),
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only findings and the final summary line.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the model check and return a process exit code."""
    args = build_parser().parse_args(argv)

    checker = Checker()
    checker.run()

    if not args.quiet:
        print("ARPI Power BI model check (static; Power BI Desktop is never launched)")
        print(f"  project        : {relative_posix(PROJECT_DIR)}")
        print(f"  tables         : {len(checker.tables)}")
        print(f"  relationships  : {len(checker.relationships)}")
        print(f"  measures       : {len(checker.measures())}")
        print(f"  assertions     : {checker.checks_run}")
        print()

    if checker.findings:
        print(f"Findings ({len(checker.findings)}):")
        for finding in checker.findings:
            print(f"  {finding.render()}")
        print()
        print(
            f"FAIL: {len(checker.findings)} departure(s) from "
            "powerbi/model_documentation/. Either the model is wrong or the specification "
            "moved; fix whichever is wrong, and do not relax this check to match."
        )
        return 1

    if not args.quiet:
        print("OK: the semantic model matches powerbi/model_documentation/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
