"""Generator for the ``finance_product_sale`` source entity behind the product fact.

Grain: **one row per finance product contract sold on a finalized vehicle transaction.**
The columns mirror ``warehouse.fact_finance_product_sale`` with the surrogate keys
replaced by the natural identifiers a source system would carry and the date keys
replaced by real dates. Mapping document
``docs/source-to-target/STM-019-fact-finance-product-sale.md``.

WHAT THIS FACT MAKES POSSIBLE
-----------------------------
Before ``DASH.6``, ARPI knew a deal's back-end gross and nothing beneath it. ``SQ-21``
-- *"Which finance products have weak or inconsistent penetration, and what do
cancellations cost us?"* -- was recorded on the register as unanswerable for exactly that
reason. These rows are the answer's first half; the adjustment fact is its second.

THE IDENTITY, STRUCK ONE WAY ONLY
---------------------------------
``original_product_gross = product_retail_price - product_dealer_cost``, exactly, on
every row. :mod:`arpi.generation.finance_deal` allocates the gross first and derives the
cost from it, so the identity holds by construction rather than by a subtraction that
could round. Every value is a :class:`decimal.Decimal`; no float ever touches one.

DEAL DATE IS THE ONLY DATE HERE
-------------------------------
A product row is a DEAL-DATE fact. It records what was written, on the day it was
written, and it is **never** rewritten. A cancellation or a chargeback three months later
is a separate event in ``warehouse.fact_finance_product_adjustment`` and leaves this row
untouched: restating a June contract because of an August chargeback would move gross out
of the month it was produced in and make every historical month unstable.

WHAT IS DELIBERATELY ABSENT
---------------------------
No APR, buy rate, sell rate, rate spread, money factor, payment, loan term, credit datum
or customer attribute of any kind. ``contract_term_months`` is the term of the PRODUCT
CONTRACT -- how long the coverage lasts -- and is not a loan term; ARPI has none.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    FINANCE_PRODUCT_CATEGORIES,
    FINANCE_STRUCTURES,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.fi_eligibility import (
    eligibility_configuration,
    is_category_eligible,
)
from arpi.generation.finance_product import (
    CONTRACT_TERM_BOUNDS,
    FINANCE_PRODUCTS_BY_ID,
)
from arpi.generation.sale import build_sale_records, deal_finance_records
from arpi.validation.checks import check_column_schema, check_unique_column
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from pathlib import Path

    from arpi.config import ArpiConfig

__all__ = [
    "ENTITY_FINANCE_PRODUCT_SALE",
    "FINANCE_PRODUCT_SALE_COLUMNS",
    "FINANCE_PRODUCT_SALE_NAMESPACE",
    "FinanceProductSaleRecord",
    "build_finance_product_sale_records",
    "generate_finance_product_sale_dataset",
    "validate_finance_product_sale_dataset",
]

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
ENTITY_FINANCE_PRODUCT_SALE: Final = "finance_product_sale"
FINANCE_PRODUCT_SALE_NAMESPACE: Final = "finance_product_sale"

PRODUCT_SALE_ID_PREFIX: Final = "FPS-"
PRODUCT_SALE_ID_DIGITS: Final = 8

_WAREHOUSE_FACT: Final = "warehouse.fact_finance_product_sale"
_ZERO: Final = Decimal("0.00")

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
FINANCE_PRODUCT_SALE_COLUMNS: Final[tuple[str, ...]] = (
    "product_sale_id",
    "sale_id",
    "sale_date",
    "dealership_id",
    "finance_manager_id",
    "finance_product_id",
    "lender_id",
    "finance_structure",
    "product_category",
    "eligibility_rule_id",
    "line_ordinal",
    "product_sale_count",
    "product_retail_price",
    "product_dealer_cost",
    "original_product_gross",
    "contract_term_months",
    "source_system",
)

FINANCE_PRODUCT_SALE_DTYPES: Final[dict[str, str]] = {
    "product_sale_id": "string",
    "sale_id": "string",
    "sale_date": "datetime64[s]",
    "dealership_id": "string",
    "finance_manager_id": "string",
    "finance_product_id": "string",
    "lender_id": "string",
    "finance_structure": "string",
    "product_category": "string",
    "eligibility_rule_id": "string",
    "line_ordinal": "int16",
    "product_sale_count": "int16",
    "product_retail_price": "object",
    "product_dealer_cost": "object",
    "original_product_gross": "object",
    "contract_term_months": "int16",
    "source_system": "string",
}

#: The two columns that may be NULL, and what NULL means on each.
#:
#: * ``finance_manager_id`` -- the deal was written with nobody on the F&I desk. A real
#:   and modelled state, not a missing value: the store still delivered the car.
#: * ``lender_id`` -- the parent deal borrowed nothing. NO LENDER EXISTS, never unknown.
FINANCE_PRODUCT_SALE_NULLABLE_COLUMNS: Final[tuple[str, ...]] = (
    "finance_manager_id",
    "lender_id",
)

#: Monetary columns, all carried as :class:`decimal.Decimal` in an ``object`` column.
FINANCE_PRODUCT_SALE_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "product_retail_price",
    "product_dealer_cost",
    "original_product_gross",
)

#: The declared logical grain, enforced physically by ``uq_fact_finance_product_sale_grain``.
#:
#: ONE CONTRACT PER PRODUCT DEFINITION PER DEAL. A customer does not buy the identical
#: contract twice, so a repeat is a duplicate rather than a second sale. Two DIFFERENT
#: products inside one category are permitted and are generated -- a windscreen plan and
#: a roadside plan are both Other Aftermarket Products -- which is precisely why every
#: penetration measure counts DISTINCT DEALS rather than contract rows. If the model
#: forbade that, "count the deal once" would be an identity and the rule would be
#: untestable.
FINANCE_PRODUCT_SALE_GRAIN_COLUMNS: Final[tuple[str, ...]] = ("sale_id", "finance_product_id")


@dataclass(frozen=True, slots=True)
class FinanceProductSaleRecord:
    """One product contract, plus the lineage the adjustment generator needs.

    Attributes:
        product_sale_id: Identifier in the reserved ``FPS-########`` scheme. The stable
            business identifier: the adjustment fact references THIS, not a warehouse
            surrogate, so an adjustment can be traced to its contract in the source data.
        sale_id: The parent finalized transaction.
        sale_date: The parent deal's date. The only date this fact carries.
        dealership_id: Selling store, carried from the parent deal.
        finance_manager_id: The F&I manager credited on the parent deal, or ``None``.
        finance_product_id: The catalogued product.
        lender_id: The parent deal's fictional lender, or ``None``.
        finance_structure: The parent deal's derived structure.
        product_category: The product's governed category.
        eligibility_rule_id: The rule the parent deal satisfied for this category.
        line_ordinal: 1-based position within the deal.
        product_retail_price: What the customer was charged, exact.
        product_dealer_cost: What the product cost the store, exact.
        original_product_gross: ``retail_price - dealer_cost``, exact, deal-date basis.
        contract_term_months: The PRODUCT CONTRACT's term. Not a loan term.
        cancellation_sensitive: Catalogue flag, carried for the adjustment generator.
        chargeback_sensitive: Catalogue flag, carried for the adjustment generator.
    """

    product_sale_id: str
    sale_id: str
    sale_date: date
    dealership_id: str
    finance_manager_id: str | None
    finance_product_id: str
    lender_id: str | None
    finance_structure: str
    product_category: str
    eligibility_rule_id: str
    line_ordinal: int
    product_retail_price: Decimal
    product_dealer_cost: Decimal
    original_product_gross: Decimal
    contract_term_months: int
    cancellation_sensitive: bool
    chargeback_sensitive: bool


def product_sale_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as an ``FPS-########`` identifier.

    Args:
        ordinal: 1-based position in the ordered product-sale population.

    Returns:
        The zero-padded identifier, e.g. ``"FPS-00000421"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive or does not fit the reserved
            eight-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"product_sale_id ordinals start at 1, got {ordinal}.",
            entity=ENTITY_FINANCE_PRODUCT_SALE,
        )
    if ordinal >= 10**PRODUCT_SALE_ID_DIGITS:
        raise GenerationError(
            f"product_sale_id ordinal {ordinal} does not fit the reserved "
            f"{PRODUCT_SALE_ID_PREFIX}{'#' * PRODUCT_SALE_ID_DIGITS} scheme.",
            entity=ENTITY_FINANCE_PRODUCT_SALE,
        )
    return f"{PRODUCT_SALE_ID_PREFIX}{ordinal:0{PRODUCT_SALE_ID_DIGITS}d}"


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
def build_finance_product_sale_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[FinanceProductSaleRecord, ...]:
    """Build every product contract for the active profile.

    The public entry point the adjustment generator calls. It reads the SAME
    decomposition ``sale_event`` published its ``finance_reserve_gross`` from, so the
    back-gross identity is one computation observed twice rather than two computations
    that happen to agree.

    Args:
        config: Resolved configuration supplying the master seed and the window.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The contracts, ordered by ``product_sale_id``, which is assigned over
        ``(sale_id, line_ordinal)`` so the ordering is stable and follows the deals.
    """
    sales = {record.sale_id: record for record in build_sale_records(config, catalogue_path)}
    finance = deal_finance_records(config, catalogue_path)
    records: list[FinanceProductSaleRecord] = []
    ordinal = 0
    for sale_id in sorted(finance):
        deal = finance[sale_id]
        parent = sales[sale_id]
        for line in deal.products:
            ordinal += 1
            definition = FINANCE_PRODUCTS_BY_ID[line.finance_product_id]
            records.append(
                FinanceProductSaleRecord(
                    product_sale_id=product_sale_id_for(ordinal),
                    sale_id=sale_id,
                    sale_date=parent.sale_date,
                    dealership_id=parent.dealership_id,
                    finance_manager_id=parent.finance_manager_id,
                    finance_product_id=line.finance_product_id,
                    lender_id=deal.lender_id,
                    finance_structure=deal.finance_structure,
                    product_category=line.product_category,
                    eligibility_rule_id=line.eligibility_rule_id,
                    line_ordinal=line.line_ordinal,
                    product_retail_price=line.product_retail_price,
                    product_dealer_cost=line.product_dealer_cost,
                    original_product_gross=line.original_product_gross,
                    contract_term_months=line.contract_term_months,
                    cancellation_sensitive=definition.cancellation_sensitive,
                    chargeback_sensitive=definition.chargeback_sensitive,
                )
            )
    return tuple(records)


class FinanceProductSaleGenerator(BaseGenerator):
    """Build one row per finance product contract sold on a finalized transaction."""

    entity_name = ENTITY_FINANCE_PRODUCT_SALE
    declared_columns = FINANCE_PRODUCT_SALE_COLUMNS
    namespace = FINANCE_PRODUCT_SALE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the product-sale frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the seventeen contract columns, in order, ordered by
            ``product_sale_id``.
        """
        rows = [_row(record) for record in build_finance_product_sale_records(config)]
        frame = pd.DataFrame.from_records(rows, columns=list(FINANCE_PRODUCT_SALE_COLUMNS))
        return frame.astype(FINANCE_PRODUCT_SALE_DTYPES)


def _row(record: FinanceProductSaleRecord) -> dict[str, Any]:
    """Render one contract as its declared row."""
    return {
        "product_sale_id": record.product_sale_id,
        "sale_id": record.sale_id,
        "sale_date": record.sale_date,
        "dealership_id": record.dealership_id,
        "finance_manager_id": record.finance_manager_id,
        "finance_product_id": record.finance_product_id,
        "lender_id": record.lender_id,
        "finance_structure": record.finance_structure,
        "product_category": record.product_category,
        "eligibility_rule_id": record.eligibility_rule_id,
        "line_ordinal": record.line_ordinal,
        # Always 1, and a COLUMN rather than a count(*): a contract count that is summed
        # like any other measure cannot be broken by a join fan-out, and count(*) can.
        "product_sale_count": 1,
        "product_retail_price": record.product_retail_price,
        "product_dealer_cost": record.product_dealer_cost,
        "original_product_gross": record.original_product_gross,
        "contract_term_months": record.contract_term_months,
        "source_system": SOURCE_SYSTEM,
    }


def generate_finance_product_sale_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``finance_product_sale`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return FinanceProductSaleGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality check identifiers
# ---------------------------------------------------------------------------------------
CHECK_FPS_UNIQUE_ID: Final = "DQ-FPS-001"
CHECK_FPS_SCHEMA_MATCHES: Final = "DQ-FPS-002"
CHECK_FPS_PARENT_SALE_RESOLVES: Final = "DQ-FPS-003"
CHECK_FPS_PARENT_CONTEXT_MATCHES: Final = "DQ-FPS-004"
CHECK_FPS_PRODUCT_RESOLVES: Final = "DQ-FPS-005"
CHECK_FPS_MANAGER_MATCHES_PARENT: Final = "DQ-FPS-006"
CHECK_FPS_LENDER_MATCHES_PARENT: Final = "DQ-FPS-007"
CHECK_FPS_PRODUCT_SALE_COUNT: Final = "DQ-FPS-008"
CHECK_FPS_NONNEGATIVE_MONEY: Final = "DQ-FPS-009"
CHECK_FPS_GROSS_IDENTITY: Final = "DQ-FPS-010"
CHECK_FPS_ELIGIBILITY: Final = "DQ-FPS-011"
CHECK_FPS_CONTRACT_TERM: Final = "DQ-FPS-012"
CHECK_FPS_NO_DUPLICATE_CONTRACT: Final = "DQ-FPS-013"
CHECK_FPS_BACK_GROSS_DECOMPOSITION: Final = "DQ-FPS-014"
CHECK_FPS_SOURCE_SYSTEM: Final = "DQ-FPS-015"
CHECK_FPS_NO_PROHIBITED_PII: Final = "DQ-FPS-016"

FINANCE_PRODUCT_SALE_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_FPS_UNIQUE_ID,
    CHECK_FPS_SCHEMA_MATCHES,
    CHECK_FPS_PARENT_SALE_RESOLVES,
    CHECK_FPS_PARENT_CONTEXT_MATCHES,
    CHECK_FPS_PRODUCT_RESOLVES,
    CHECK_FPS_MANAGER_MATCHES_PARENT,
    CHECK_FPS_LENDER_MATCHES_PARENT,
    CHECK_FPS_PRODUCT_SALE_COUNT,
    CHECK_FPS_NONNEGATIVE_MONEY,
    CHECK_FPS_GROSS_IDENTITY,
    CHECK_FPS_ELIGIBILITY,
    CHECK_FPS_CONTRACT_TERM,
    CHECK_FPS_NO_DUPLICATE_CONTRACT,
    CHECK_FPS_BACK_GROSS_DECOMPOSITION,
    CHECK_FPS_SOURCE_SYSTEM,
    CHECK_FPS_NO_PROHIBITED_PII,
)

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_FPS_UNIQUE_ID,
            check_name="finance_product_sale.product_sale_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The business identifier is what an adjustment references. A duplicate "
                "would make one cancellation reduce two contracts, and every product "
                "gross measure built on the row would double."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_SCHEMA_MATCHES,
            check_name="finance_product_sale matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The raw loader maps positionally, and this entity has three adjacent "
                "monetary columns that would be silently interchangeable if the order "
                "drifted -- swapping price and cost inverts every product margin."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_PARENT_SALE_RESOLVES,
            check_name="every contract resolves to one finalized vehicle transaction",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "A contract on a deal that does not exist is product gross with no deal "
                "to attribute it to, and it would break the back-gross identity in a way "
                "that looks like a rounding problem."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_vehicle_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_PARENT_CONTEXT_MATCHES,
            check_name="store, sale date and finance structure match the parent deal",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The three are denormalised onto the contract so the fact is usable "
                "without a join. Denormalised values that can disagree with their source "
                "are the classic way a store total and a group total stop reconciling."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_vehicle_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_PRODUCT_RESOLVES,
            check_name="every contract resolves to a catalogued finance product",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "An uncatalogued product has no category, therefore no eligibility rule "
                "and no penetration denominator, and its gross would appear in a category "
                "mix as a share of a total it was never counted into."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.dim_finance_product"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_MANAGER_MATCHES_PARENT,
            check_name="the credited finance manager is the parent deal's own",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "Manager attribution is what KPI-FNI-021 and KPI-FNI-022 are computed "
                "over. A contract credited to somebody who did not write the deal would "
                "move production between people, which is the one error in this domain "
                "that is about a person rather than a number."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_vehicle_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_LENDER_MATCHES_PARENT,
            check_name="the lender carried on a contract is the parent deal's own",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "One deal has one funding source. A contract naming a different lender "
                "would put the same deal in two lenders' books."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_vehicle_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_PRODUCT_SALE_COUNT,
            check_name="product_sale_count is 1 on every contract",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The grain is one contract, so the additive contract measure is 1. Any "
                "other value means the grain was violated upstream."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_NONNEGATIVE_MONEY,
            check_name="retail price and dealer cost are never negative",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "A negative price or cost is not a thin deal, it is a defect. Product "
                "GROSS is a different matter and is not constrained here: a product sold "
                "below cost is a real event, even though this generator does not produce "
                "one."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_GROSS_IDENTITY,
            check_name="original_product_gross = product_retail_price - product_dealer_cost",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "Exact to the cent on every row. This is the arithmetic every product "
                "gross measure depends on; a cent of drift means a float reached a "
                "monetary value."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_ELIGIBILITY,
            check_name="every contract satisfies its category's governed eligibility rule",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "GAP on a cash deal, or Lease Wear Protection on a purchase, would put a "
                "numerator outside its own denominator and make the penetration figure "
                "exceed 100% for reasons a reader could not see. An ineligible row is a "
                "CRITICAL failure, never a silent exclusion."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.dim_finance_product"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_CONTRACT_TERM,
            check_name="contract_term_months is a plausible PRODUCT contract term",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The length of the COVERAGE, not of a loan. ARPI models no loan term, and "
                "the bound is what keeps the two from being conflated by a value that "
                "only makes sense as financing."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_NO_DUPLICATE_CONTRACT,
            check_name="one deal never carries the same product definition twice",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "A customer does not buy the identical contract twice, so a repeat is a "
                "duplicate rather than a second sale. Two DIFFERENT products in one "
                "category are permitted and generated, which is what makes 'penetration "
                "counts distinct deals' a rule with teeth instead of an identity."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_BACK_GROSS_DECOMPOSITION,
            check_name="reserve plus product gross equals the deal's stored back-end gross",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "THE HEADLINE IDENTITY of the whole increment, and the Python side of "
                "RECON-FI-001. Every cent of a deal's back-end gross is explained by "
                "finance reserve plus deal-date product gross, with other_fi_income "
                "exactly 0.00 and no balancing plug anywhere."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_vehicle_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_SOURCE_SYSTEM,
            check_name="finance_product_sale.source_system is the synthetic generator",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "The lineage marker that stops an invented product price being read as a "
                "market price or a recommended price."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPS_NO_PROHIBITED_PII,
            check_name="finance_product_sale declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_SALE,
            description=(
                "An F&I contract is the richest source of personal and credit data in a "
                "real dealership. ARPI's carries none: no customer, no credit datum, no "
                "rate and no payment. The check inspects the SCHEMA, so an empty apr "
                "column still fails the run."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_finance_product_sale_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-FPS-001`` through ``DQ-FPS-016`` against the product-sale entity.

    Args:
        dataset: The generated ``finance_product_sale`` dataset.
        config: Resolved configuration, used to rebuild the parent deals and their F&I
            decomposition independently of the frame under test.
        catalogue_path: Explicit vehicle model catalogue path.

    Returns:
        A report containing sixteen results, in check-id order.
    """
    frame = dataset.frame
    parents = {record.sale_id: record for record in build_sale_records(config, catalogue_path)}
    finance = deal_finance_records(config, catalogue_path)
    rules = eligibility_configuration()
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "product_sale_id",
                check_id=CHECK_FPS_UNIQUE_ID,
                check_name="finance_product_sale.product_sale_id is unique",
                target_object=ENTITY_FINANCE_PRODUCT_SALE,
            ),
            check_column_schema(
                frame,
                FINANCE_PRODUCT_SALE_COLUMNS,
                check_id=CHECK_FPS_SCHEMA_MATCHES,
                check_name="finance_product_sale matches its declared column contract",
                target_object=ENTITY_FINANCE_PRODUCT_SALE,
            ),
            _check_parent_resolves(frame, parents),
            _check_parent_context(frame, parents, finance),
            _check_product_resolves(frame),
            _check_manager_matches(frame, parents),
            _check_lender_matches(frame, finance),
            _check_product_sale_count(frame),
            _check_nonnegative_money(frame),
            _check_gross_identity(frame),
            _check_eligibility(frame, parents, finance, rules),
            _check_contract_term(frame),
            _check_no_duplicate_contract(frame),
            _check_back_gross_decomposition(frame, parents, finance),
            _check_source_system(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_FPS_NO_PROHIBITED_PII,
                check_name="finance_product_sale declares no prohibited personal-data column",
                target_object=ENTITY_FINANCE_PRODUCT_SALE,
            ),
        )
    )


def _base(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_FINANCE_PRODUCT_SALE,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _fail(base: CheckResult, offending: list[str], message: str) -> CheckResult:
    """Render a bespoke failure with a capped sample of the offending rows."""
    if not offending:
        return base
    return base.failed(
        f"{len(offending)} {message}: {'; '.join(offending[:5])}.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_parent_resolves(frame: pd.DataFrame, parents: dict[str, Any]) -> CheckResult:
    """``DQ-FPS-003`` -- every contract names a finalized transaction that exists."""
    base = _base(
        CHECK_FPS_PARENT_SALE_RESOLVES,
        "every contract resolves to one finalized vehicle transaction",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending = [
        f"{product_sale_id}: sale {sale_id} does not exist"
        for product_sale_id, sale_id in zip(frame["product_sale_id"], frame["sale_id"], strict=True)
        if str(sale_id) not in parents
    ]
    return _fail(base, offending, "contract(s) name a transaction that does not exist")


def _check_parent_context(
    frame: pd.DataFrame, parents: dict[str, Any], finance: dict[str, Any]
) -> CheckResult:
    """``DQ-FPS-004`` -- the denormalised deal context agrees with the parent deal."""
    base = _base(
        CHECK_FPS_PARENT_CONTEXT_MATCHES,
        "store, sale date and finance structure match the parent deal",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for product_sale_id, sale_id, sale_date, store, structure in zip(
        frame["product_sale_id"],
        frame["sale_id"],
        frame["sale_date"],
        frame["dealership_id"],
        frame["finance_structure"],
        strict=True,
    ):
        parent = parents.get(str(sale_id))
        deal = finance.get(str(sale_id))
        if parent is None or deal is None:
            continue  # DQ-FPS-003 owns the missing-parent case.
        if pd.Timestamp(sale_date).date() != parent.sale_date:
            offending.append(f"{product_sale_id}: sale_date disagrees with {sale_id}")
        if str(store) != parent.dealership_id:
            offending.append(f"{product_sale_id}: dealership disagrees with {sale_id}")
        if str(structure) != deal.finance_structure:
            offending.append(f"{product_sale_id}: finance_structure disagrees with {sale_id}")
    return _fail(base, offending, "contract(s) disagree with their parent deal")


def _check_product_resolves(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-005`` -- the product and its denormalised category are catalogued."""
    base = _base(
        CHECK_FPS_PRODUCT_RESOLVES,
        "every contract resolves to a catalogued finance product",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for product_sale_id, product_id, category in zip(
        frame["product_sale_id"],
        frame["finance_product_id"],
        frame["product_category"],
        strict=True,
    ):
        definition = FINANCE_PRODUCTS_BY_ID.get(str(product_id))
        if definition is None:
            offending.append(f"{product_sale_id}: product {product_id} is not catalogued")
        elif str(category) != definition.product_category:
            offending.append(f"{product_sale_id}: category {category} disagrees with the catalogue")
        elif str(category) not in FINANCE_PRODUCT_CATEGORIES:  # pragma: no cover
            offending.append(f"{product_sale_id}: category {category} is not governed")
    return _fail(base, offending, "contract(s) name an uncatalogued product or category")


def _check_manager_matches(frame: pd.DataFrame, parents: dict[str, Any]) -> CheckResult:
    """``DQ-FPS-006`` -- the credited manager is the parent deal's own, or absent on both."""
    base = _base(
        CHECK_FPS_MANAGER_MATCHES_PARENT,
        "the credited finance manager is the parent deal's own",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for product_sale_id, sale_id, manager in zip(
        frame["product_sale_id"],
        frame["sale_id"],
        frame["finance_manager_id"],
        strict=True,
    ):
        parent = parents.get(str(sale_id))
        if parent is None:
            continue
        observed = None if manager is None or pd.isna(manager) else str(manager)
        if observed != parent.finance_manager_id:
            offending.append(
                f"{product_sale_id}: credited {observed}, deal credited {parent.finance_manager_id}"
            )
    return _fail(base, offending, "contract(s) credit a manager who did not write the deal")


def _check_lender_matches(frame: pd.DataFrame, finance: dict[str, Any]) -> CheckResult:
    """``DQ-FPS-007`` -- the lender on a contract is the parent deal's own."""
    base = _base(
        CHECK_FPS_LENDER_MATCHES_PARENT,
        "the lender carried on a contract is the parent deal's own",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for product_sale_id, sale_id, lender in zip(
        frame["product_sale_id"], frame["sale_id"], frame["lender_id"], strict=True
    ):
        deal = finance.get(str(sale_id))
        if deal is None:
            continue
        observed = None if lender is None or pd.isna(lender) else str(lender)
        if observed != deal.lender_id:
            offending.append(f"{product_sale_id}: names {observed}, deal names {deal.lender_id}")
    return _fail(base, offending, "contract(s) name a lender the deal did not use")


def _check_product_sale_count(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-008`` -- the additive contract measure is 1 on every row."""
    base = _base(
        CHECK_FPS_PRODUCT_SALE_COUNT,
        "product_sale_count is 1 on every contract",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int((frame["product_sale_count"] != 1).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} contract(s) carry a product_sale_count other than 1. The grain is "
        "one contract per row.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_nonnegative_money(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-009`` -- price and cost are never negative."""
    base = _base(
        CHECK_FPS_NONNEGATIVE_MONEY,
        "retail price and dealer cost are never negative",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_sale_id, price, cost in zip(
        frame["product_sale_id"],
        frame["product_retail_price"],
        frame["product_dealer_cost"],
        strict=True,
    ):
        if Decimal(str(price)) < 0:
            offending.append(f"{product_sale_id}: retail price {price}")
        if Decimal(str(cost)) < 0:
            offending.append(f"{product_sale_id}: dealer cost {cost}")
    return _fail(base, offending, "contract(s) carry a negative price or cost")


def _check_gross_identity(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-010`` -- the price identity holds exactly, to the cent."""
    base = _base(
        CHECK_FPS_GROSS_IDENTITY,
        "original_product_gross = product_retail_price - product_dealer_cost",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_sale_id, price, cost, gross in zip(
        frame["product_sale_id"],
        frame["product_retail_price"],
        frame["product_dealer_cost"],
        frame["original_product_gross"],
        strict=True,
    ):
        expected = Decimal(str(price)) - Decimal(str(cost))
        if Decimal(str(gross)) != expected:
            offending.append(f"{product_sale_id}: gross {gross} != {expected}")
    return _fail(base, offending, "contract(s) break the product price identity")


def _check_eligibility(
    frame: pd.DataFrame,
    parents: dict[str, Any],
    finance: dict[str, Any],
    rules: Any,
) -> CheckResult:
    """``DQ-FPS-011`` -- every contract satisfies its category's governed rule.

    The rule is re-evaluated through the SAME authority the generator asked, from the
    parent deal's structure and its vehicle's condition. Re-deriving it here rather than
    trusting the stored ``eligibility_rule_id`` is the point: a row that carries the
    right rule id and violates the rule is exactly the defect this check exists for.
    """
    base = _base(
        CHECK_FPS_ELIGIBILITY,
        "every contract satisfies its category's governed eligibility rule",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_sale_id, sale_id, category, rule_id in zip(
        frame["product_sale_id"],
        frame["sale_id"],
        frame["product_category"],
        frame["eligibility_rule_id"],
        strict=True,
    ):
        parent = parents.get(str(sale_id))
        deal = finance.get(str(sale_id))
        if parent is None or deal is None:
            continue
        owning = rules.rule_by_category.get(str(category))
        if owning is None:
            offending.append(f"{product_sale_id}: category {category} owns no rule")
            continue
        if str(rule_id) != owning.rule_id:
            offending.append(
                f"{product_sale_id}: carries {rule_id}, category owns {owning.rule_id}"
            )
            continue
        if not is_category_eligible(
            str(category),
            finance_structure=deal.finance_structure,
            vehicle_condition=parent.condition_type,
            config=rules,
        ):
            offending.append(
                f"{product_sale_id}: {category} on a {deal.finance_structure} "
                f"{parent.condition_type} deal violates {owning.rule_id}"
            )
    return _fail(base, offending, "contract(s) violate their governed eligibility rule")


def _check_contract_term(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-012`` -- the PRODUCT contract term is inside its plausible band."""
    minimum, maximum = CONTRACT_TERM_BOUNDS
    base = _base(
        CHECK_FPS_CONTRACT_TERM,
        "contract_term_months is a plausible PRODUCT contract term",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    terms = frame["contract_term_months"]
    offending = int(((terms < minimum) | (terms > maximum)).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} contract(s) declare a term outside [{minimum}, {maximum}] months. "
        "This is the length of the COVERAGE, not of a loan.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_no_duplicate_contract(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-013`` -- one deal never carries the same product definition twice."""
    base = _base(
        CHECK_FPS_NO_DUPLICATE_CONTRACT,
        "one deal never carries the same product definition twice",
        CHECK_CATEGORY_UNIQUENESS,
    )
    duplicated = int(frame.duplicated(subset=list(FINANCE_PRODUCT_SALE_GRAIN_COLUMNS)).sum())
    if duplicated == 0:
        return base
    return base.failed(
        f"{duplicated} contract(s) repeat the declared grain "
        f"({', '.join(FINANCE_PRODUCT_SALE_GRAIN_COLUMNS)}). A customer does not buy the "
        "identical contract twice.",
        observed_value=float(duplicated),
        failed_record_count=duplicated,
    )


def _check_back_gross_decomposition(
    frame: pd.DataFrame, parents: dict[str, Any], finance: dict[str, Any]
) -> CheckResult:
    """``DQ-FPS-014`` -- reserve plus product gross equals the deal's back-end gross.

    Evaluated over EVERY finalized deal, not only the deals this frame carries rows for.
    A deal whose contracts all went missing would otherwise pass silently -- there would
    be nothing left in the frame to disagree with anything.
    """
    base = _base(
        CHECK_FPS_BACK_GROSS_DECOMPOSITION,
        "reserve plus product gross equals the deal's stored back-end gross",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    observed: dict[str, Decimal] = {}
    for sale_id, gross in zip(frame["sale_id"], frame["original_product_gross"], strict=True):
        key = str(sale_id)
        observed[key] = observed.get(key, _ZERO) + Decimal(str(gross))

    offending: list[str] = []
    for sale_id, parent in parents.items():
        deal = finance.get(sale_id)
        if deal is None:  # pragma: no cover - deal_finance_records covers every sale
            offending.append(f"{sale_id}: no F&I decomposition")
            continue
        total = deal.finance_reserve_gross + observed.get(sale_id, _ZERO)
        if total != parent.back_end_gross:
            offending.append(
                f"{sale_id}: reserve {deal.finance_reserve_gross} + product "
                f"{observed.get(sale_id, _ZERO)} = {total} != back_end_gross "
                f"{parent.back_end_gross}"
            )
    return _fail(
        base,
        offending,
        "deal(s) whose back-end gross is not explained by reserve plus product gross",
    )


def _check_source_system(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPS-015`` -- the lineage marker is present on every row."""
    base = _base(
        CHECK_FPS_SOURCE_SYSTEM,
        "finance_product_sale.source_system is the synthetic generator",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int((frame["source_system"] != SOURCE_SYSTEM).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} row(s) do not carry source_system = {SOURCE_SYSTEM!r}.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


#: The governed structure vocabulary, re-exported for the staging DDL's CHECK domain.
GOVERNED_FINANCE_STRUCTURES: Final[tuple[str, ...]] = FINANCE_STRUCTURES
