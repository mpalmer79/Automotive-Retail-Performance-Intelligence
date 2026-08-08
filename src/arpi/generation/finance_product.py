"""Generator for ``warehouse.dim_finance_product`` (Slowly Changing Dimension Type 1).

WHAT THIS DIMENSION IS
----------------------
The governed catalogue of F&I products the fictional Granite Auto Group sells. One row
per product definition. Promoted by delivery increment ``DASH.6``; mapping document
``docs/source-to-target/STM-017-dim-finance-product.md``.

EVERY PRODUCT AND EVERY ADMINISTRATOR IS FICTIONAL
--------------------------------------------------
No real F&I product, program, administrator, underwriter or vendor is named anywhere in
ARPI, and none may be added. This is not cosmetic. The catalogue carries synthetic
economics -- a relative gross weight, a dealer-cost ratio, a cancellation and chargeback
sensitivity -- and attaching invented commercial behaviour to a **named real company**
would be a fabricated claim about that company. ``DQ-FPD-004`` asserts every provider is
one of the four invented administrators declared here, so a real name cannot arrive by
accident.

CATEGORIES ARE ROWS
-------------------
The ten governed categories in :data:`arpi.constants.FINANCE_PRODUCT_CATEGORIES` are
values of ``product_category``, never columns. There is no ``vsc_gross`` and there never
will be: a category-per-column model makes the eleventh category a migration instead of a
catalogue row, and it cannot answer "which categories exist?" without reading the schema.

THE ECONOMICS ARE GENERATION INPUTS, NOT DIMENSION COLUMNS
-----------------------------------------------------------
:class:`FinanceProductDefinition` carries four latent parameters -- ``gross_weight``,
``dealer_cost_ratio``, ``attach_affinity`` and ``term_variation`` -- that shape the draws
in :mod:`arpi.generation.finance_deal`. None of them is a dimension column, for the same
reason ``arpi.generation.lead_source`` keeps its conversion latents off
``dim_lead_source``: a stored "expected gross" would be an assumption masquerading as a
measured fact, and any report reading it would be reporting the generator's own inputs
back to itself. Measured product gross is computed downstream from
``warehouse.fact_finance_product_sale``.

TWO FLAGS THAT MUST EARN THEIR PLACE
------------------------------------
``cancellation_sensitive`` and ``chargeback_sensitive`` are dimension columns, and they
are only defensible because they genuinely drive behaviour:
:mod:`arpi.generation.finance_product_adjustment` reads them and emits no cancellation
for a product that is not cancellation-sensitive and no chargeback for one that is not
chargeback-sensitive. ``tests/unit/test_generation_finance_product_adjustment.py``
asserts exactly that, so the flags cannot decay into decoration.

WHAT IS DELIBERATELY ABSENT
---------------------------
No price, no cost, no rate, no commission, no remittance schedule and no reserve
formula. A price on the dimension would be a second authority beside the price actually
struck on the contract, and the day they disagreed nobody could say which was the sale.

SEEDING
-------
The catalogue is fixed reference data declared in this module, so the generator draws no
random numbers and is seed-independent. The namespace is still declared so a future
variant that does draw cannot perturb another entity's determinism digest.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    FINANCE_PRODUCT_CATEGORIES,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.fi_eligibility import eligibility_configuration
from arpi.validation.checks import (
    check_column_schema,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

__all__ = [
    "ACTIVE_START_DATE",
    "DIM_FINANCE_PRODUCT_COLUMNS",
    "ENTITY_DIM_FINANCE_PRODUCT",
    "FINANCE_PRODUCT_DEFINITIONS",
    "FINANCE_PRODUCT_NAMESPACE",
    "FICTIONAL_PROVIDERS",
    "FinanceProductDefinition",
    "finance_products_by_category",
    "generate_finance_product_dataset",
    "validate_finance_product_dataset",
]

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
ENTITY_DIM_FINANCE_PRODUCT: Final = "dim_finance_product"
FINANCE_PRODUCT_NAMESPACE: Final = "dim_finance_product"

_WAREHOUSE_DIM_FINANCE_PRODUCT: Final = "warehouse.dim_finance_product"

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_FINANCE_PRODUCT_COLUMNS: Final[tuple[str, ...]] = (
    "finance_product_key",
    "finance_product_id",
    "product_name",
    "product_category",
    "provider_name",
    "eligibility_rule_id",
    "eligible_finance_structures",
    "eligible_vehicle_conditions",
    "default_contract_term_months",
    "cancellation_sensitive",
    "chargeback_sensitive",
    "active_start_date",
    "active_end_date",
    "is_active",
    "source_system",
)

#: ``datetime64[s]`` on both dates so the 9999-12-31 open-ended sentinel round-trips: it
#: overflows ``datetime64[ns]``, whose maximum is 2262-04-11.
DIM_FINANCE_PRODUCT_DTYPES: Final[dict[str, str]] = {
    "finance_product_key": "int32",
    "finance_product_id": "string",
    "product_name": "string",
    "product_category": "string",
    "provider_name": "string",
    "eligibility_rule_id": "string",
    "eligible_finance_structures": "string",
    "eligible_vehicle_conditions": "string",
    "default_contract_term_months": "int16",
    "cancellation_sensitive": "bool",
    "chargeback_sensitive": "bool",
    "active_start_date": "datetime64[s]",
    "active_end_date": "datetime64[s]",
    "is_active": "bool",
    "source_system": "string",
}

#: Every column is NOT NULL. Absence is modelled by the sentinel expiration date rather
#: than by a null, so "still offered" and "we do not know" cannot be confused.
DIM_FINANCE_PRODUCT_REQUIRED_COLUMNS: Final[tuple[str, ...]] = DIM_FINANCE_PRODUCT_COLUMNS

#: The catalogue's opening date. Before the earliest reporting window, so no generated
#: deal can carry a product the catalogue had not yet opened.
ACTIVE_START_DATE: Final = date(2015, 1, 1)

# ---------------------------------------------------------------------------------------
# The four fictional administrators
# ---------------------------------------------------------------------------------------
#: THE PROVIDER DECISION (DASH.6-01): provider is an ATTRIBUTE of the product, not a
#: dimension of its own. ``warehouse.dim_finance_product_provider`` and ``STM-021`` stay
#: reserved and Deferred. The reasoning is recorded in
#: ``docs/source-to-target/STM-017-dim-finance-product.md`` section 6 and in
#: ``docs/dashboard/DATA_CONTRACT.md``: a provider dimension buys nothing an attribute
#: cannot do here, because in this model a provider has no behaviour independent of the
#: product it administers -- cancellation and chargeback sensitivity belong to the
#: product, the provider mix IS the product mix, and no fact needs a provider foreign key
#: that the product key does not already resolve. A dimension would add a join, a merge
#: script, an STM and a DQ family in exchange for an attribute lookup.
#:
#: Every name is invented. No real administrator, underwriter or vendor is named.
FICTIONAL_PROVIDERS: Final[tuple[str, ...]] = (
    "Granite Shield Administrators",
    "Northbridge Protection Services",
    "Keystone Vehicle Programs",
    "Summit Assurance Group",
)


# ---------------------------------------------------------------------------------------
# Catalogue definitions
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class FinanceProductDefinition:
    """One catalogued product, plus the latent economics that shape its generation.

    Attributes:
        finance_product_id: Natural key, ``FP-###``.
        product_name: Fictional product label.
        product_category: One of the ten governed categories.
        provider_name: One of :data:`FICTIONAL_PROVIDERS`.
        default_contract_term_months: The PRODUCT CONTRACT's term. This is the length of
            the coverage, and it is **not** the finance loan term: ARPI models no loan
            term anywhere, and conflating the two is the ambiguity this attribute's name
            and its column comment exist to prevent.
        cancellation_sensitive: Whether a customer can cancel the contract for a refund.
            Read by the adjustment generator, which emits no Cancellation without it.
        chargeback_sensitive: Whether the store's income is charged back when the
            contract ends early. Read by the adjustment generator, which emits no
            Chargeback without it.
        gross_weight: Relative share of a deal's product gross this product attracts when
            it is in the basket. A generation input, never a column.
        dealer_cost_ratio: ``dealer_cost / original_gross`` for this product. A generation
            input; the cost actually struck on a contract is a fact column.
        attach_affinity: Relative likelihood this product is chosen when its category is
            selected for a basket. A generation input, never a column.
    """

    finance_product_id: str
    product_name: str
    product_category: str
    provider_name: str
    default_contract_term_months: int
    cancellation_sensitive: bool
    chargeback_sensitive: bool
    gross_weight: Decimal
    dealer_cost_ratio: Decimal
    attach_affinity: float


def _product(
    ordinal: int,
    name: str,
    category: str,
    provider: str,
    term: int,
    *,
    cancellable: bool,
    chargeback: bool,
    gross_weight: str,
    cost_ratio: str,
    affinity: float,
) -> FinanceProductDefinition:
    """Build one catalogue entry, applying the ``FP-###`` identifier convention."""
    return FinanceProductDefinition(
        finance_product_id=f"FP-{ordinal:03d}",
        product_name=name,
        product_category=category,
        provider_name=provider,
        default_contract_term_months=term,
        cancellation_sensitive=cancellable,
        chargeback_sensitive=chargeback,
        gross_weight=Decimal(gross_weight),
        dealer_cost_ratio=Decimal(cost_ratio),
        attach_affinity=affinity,
    )


#: THE CATALOGUE. Nineteen products across the ten governed categories.
#:
#: Deliberately compact. Hundreds of near-identical SKUs would make the category mix look
#: sophisticated and would tell a reader nothing: what the model needs is that every
#: category is represented, that several categories can appear on one deal, that category
#: economics genuinely differ, and that cancellation and chargeback sensitivity vary. All
#: four hold here, and every row is readable in one screen.
#:
#: The sensitivity flags are set from what the product IS. A service contract, a GAP
#: waiver, a tyre-and-wheel plan, a maintenance plan and a lease-wear waiver are all
#: cancellable for a pro-rata refund; a one-off appearance treatment, a key registration,
#: a theft registration and a windscreen plan are not. Chargeback exposure is narrower
#: still: it follows the products whose income is remitted over the life of a contract
#: that can end early.
FINANCE_PRODUCT_DEFINITIONS: Final[tuple[FinanceProductDefinition, ...]] = (
    # Vehicle Service Contract -- the widest denominator and the largest gross weight.
    _product(1, "Granite Shield Powertrain Plus", "Vehicle Service Contract",
             FICTIONAL_PROVIDERS[0], 60, cancellable=True, chargeback=True,
             gross_weight="1.00", cost_ratio="1.10", affinity=0.42),
    _product(2, "Northbridge Comprehensive Coverage", "Vehicle Service Contract",
             FICTIONAL_PROVIDERS[1], 72, cancellable=True, chargeback=True,
             gross_weight="1.22", cost_ratio="1.05", affinity=0.36),
    _product(3, "Summit Certified Extended Coverage", "Vehicle Service Contract",
             FICTIONAL_PROVIDERS[3], 84, cancellable=True, chargeback=True,
             gross_weight="1.35", cost_ratio="1.18", affinity=0.22),
    # GAP -- financed deals only, thin cost, high chargeback exposure on early payoff.
    _product(4, "Keystone GAP Advantage", "GAP",
             FICTIONAL_PROVIDERS[2], 72, cancellable=True, chargeback=True,
             gross_weight="0.46", cost_ratio="0.42", affinity=0.58),
    _product(5, "Northbridge Deficiency Waiver", "GAP",
             FICTIONAL_PROVIDERS[1], 60, cancellable=True, chargeback=True,
             gross_weight="0.40", cost_ratio="0.48", affinity=0.42),
    # Tire & Wheel -- cancellable, but the income is earned at sale rather than remitted.
    _product(6, "Granite Shield Road Hazard Tire and Wheel", "Tire & Wheel",
             FICTIONAL_PROVIDERS[0], 36, cancellable=True, chargeback=False,
             gross_weight="0.52", cost_ratio="0.86", affinity=0.55),
    _product(7, "Summit Wheel and Tire Care", "Tire & Wheel",
             FICTIONAL_PROVIDERS[3], 48, cancellable=True, chargeback=False,
             gross_weight="0.61", cost_ratio="0.80", affinity=0.45),
    # Prepaid Maintenance -- New and Certified only (ELIG-PPM), thin margin.
    _product(8, "Keystone Scheduled Maintenance Plan", "Prepaid Maintenance",
             FICTIONAL_PROVIDERS[2], 36, cancellable=True, chargeback=True,
             gross_weight="0.34", cost_ratio="1.26", affinity=0.60),
    _product(9, "Granite Shield Maintenance Essentials", "Prepaid Maintenance",
             FICTIONAL_PROVIDERS[0], 24, cancellable=True, chargeback=True,
             gross_weight="0.27", cost_ratio="1.34", affinity=0.40),
    # Appearance Protection -- a one-off treatment: not cancellable, no chargeback.
    _product(10, "Northbridge Interior and Exterior Shield", "Appearance Protection",
             FICTIONAL_PROVIDERS[1], 60, cancellable=False, chargeback=False,
             gross_weight="0.58", cost_ratio="0.50", affinity=0.56),
    _product(11, "Summit Surface Guard", "Appearance Protection",
             FICTIONAL_PROVIDERS[3], 48, cancellable=False, chargeback=False,
             gross_weight="0.49", cost_ratio="0.56", affinity=0.44),
    # Key Replacement.
    _product(12, "Keystone Key Replacement Plan", "Key Replacement",
             FICTIONAL_PROVIDERS[2], 48, cancellable=False, chargeback=False,
             gross_weight="0.23", cost_ratio="0.62", affinity=1.00),
    # Theft or Security Product.
    _product(13, "Granite Shield Theft Deterrent Registration", "Theft or Security Product",
             FICTIONAL_PROVIDERS[0], 60, cancellable=False, chargeback=False,
             gross_weight="0.31", cost_ratio="0.46", affinity=1.00),
    # Paintless Dent Protection.
    _product(14, "Northbridge Dent Care", "Paintless Dent Protection",
             FICTIONAL_PROVIDERS[1], 60, cancellable=False, chargeback=False,
             gross_weight="0.36", cost_ratio="0.54", affinity=0.52),
    _product(15, "Summit Dent and Ding Plan", "Paintless Dent Protection",
             FICTIONAL_PROVIDERS[3], 36, cancellable=False, chargeback=False,
             gross_weight="0.30", cost_ratio="0.58", affinity=0.48),
    # Lease Wear Protection -- lease only (ELIG-LWP).
    _product(16, "Keystone Lease Wear and Tear Waiver", "Lease Wear Protection",
             FICTIONAL_PROVIDERS[2], 36, cancellable=True, chargeback=False,
             gross_weight="0.44", cost_ratio="0.68", affinity=0.57),
    _product(17, "Northbridge Lease End Protection", "Lease Wear Protection",
             FICTIONAL_PROVIDERS[1], 39, cancellable=True, chargeback=False,
             gross_weight="0.50", cost_ratio="0.64", affinity=0.43),
    # Other Aftermarket Product.
    _product(18, "Summit Windshield Protection Plan", "Other Aftermarket Product",
             FICTIONAL_PROVIDERS[3], 36, cancellable=False, chargeback=False,
             gross_weight="0.26", cost_ratio="0.60", affinity=0.53),
    _product(19, "Granite Shield Roadside Assistance Plus", "Other Aftermarket Product",
             FICTIONAL_PROVIDERS[0], 60, cancellable=False, chargeback=False,
             gross_weight="0.21", cost_ratio="0.52", affinity=0.47),
)

#: The catalogue keyed by product id, for the fact generators and the DQ suites.
FINANCE_PRODUCTS_BY_ID: Final[dict[str, FinanceProductDefinition]] = {
    definition.finance_product_id: definition for definition in FINANCE_PRODUCT_DEFINITIONS
}


def finance_products_by_category() -> dict[str, tuple[FinanceProductDefinition, ...]]:
    """Group the catalogue by governed category, in catalogue order.

    Returns:
        A mapping from each of the ten governed categories to its products. Every
        category is present and none maps to an empty tuple: a category that existed
        only as a placeholder would make its penetration measure permanently zero and
        indistinguishable from a category nobody sold.
    """
    grouped: dict[str, list[FinanceProductDefinition]] = {
        category: [] for category in FINANCE_PRODUCT_CATEGORIES
    }
    for definition in FINANCE_PRODUCT_DEFINITIONS:
        grouped[definition.product_category].append(definition)
    return {category: tuple(products) for category, products in grouped.items()}


# ---------------------------------------------------------------------------------------
# Data-quality check identifiers
# ---------------------------------------------------------------------------------------
CHECK_FPD_UNIQUE_ID: Final = "DQ-FPD-001"
CHECK_FPD_SCHEMA_MATCHES: Final = "DQ-FPD-002"
CHECK_FPD_CATEGORY_DOMAIN: Final = "DQ-FPD-003"
CHECK_FPD_PROVIDER_FICTIONAL: Final = "DQ-FPD-004"
CHECK_FPD_EVERY_CATEGORY_PRESENT: Final = "DQ-FPD-005"
CHECK_FPD_ELIGIBILITY_RULE_RESOLVES: Final = "DQ-FPD-006"
CHECK_FPD_ACTIVE_DATES: Final = "DQ-FPD-007"
CHECK_FPD_CONTRACT_TERM_RANGE: Final = "DQ-FPD-008"
CHECK_FPD_SENSITIVITY_FLAGS_BOOLEAN: Final = "DQ-FPD-009"
CHECK_FPD_TYPE_1_NO_HISTORY: Final = "DQ-FPD-010"
CHECK_FPD_SOURCE_SYSTEM: Final = "DQ-FPD-011"
CHECK_FPD_NO_PROHIBITED_PII: Final = "DQ-FPD-012"

FINANCE_PRODUCT_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_FPD_UNIQUE_ID,
    CHECK_FPD_SCHEMA_MATCHES,
    CHECK_FPD_CATEGORY_DOMAIN,
    CHECK_FPD_PROVIDER_FICTIONAL,
    CHECK_FPD_EVERY_CATEGORY_PRESENT,
    CHECK_FPD_ELIGIBILITY_RULE_RESOLVES,
    CHECK_FPD_ACTIVE_DATES,
    CHECK_FPD_CONTRACT_TERM_RANGE,
    CHECK_FPD_SENSITIVITY_FLAGS_BOOLEAN,
    CHECK_FPD_TYPE_1_NO_HISTORY,
    CHECK_FPD_SOURCE_SYSTEM,
    CHECK_FPD_NO_PROHIBITED_PII,
)

#: Bounds on a PRODUCT CONTRACT term, in months. Not a loan term: ARPI has none.
CONTRACT_TERM_BOUNDS: Final[tuple[int, int]] = (12, 120)

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_FPD_UNIQUE_ID,
            check_name="dim_finance_product.finance_product_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The product id is the dimension's natural key and the join every "
                "product-sale row resolves through. A duplicate would fan a contract out "
                "into two and double the product gross behind a deal's back-end gross."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_SCHEMA_MATCHES,
            check_name="dim_finance_product matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The raw loader maps positionally, and two adjacent boolean columns would "
                "be silently interchangeable if the order drifted."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_CATEGORY_DOMAIN,
            check_name="every product_category is one of the ten governed categories",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "An ungoverned category has no eligibility rule, therefore no penetration "
                "denominator, and would appear in the category mix as a share of a total "
                "it was never counted into."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_PROVIDER_FICTIONAL,
            check_name="every provider is one of the declared fictional administrators",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The catalogue attaches invented economics and invented cancellation "
                "behaviour to every provider. Attaching that to a real administrator's "
                "name would be a fabricated claim about a real company, so the provider "
                "set is closed rather than merely conventional."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_EVERY_CATEGORY_PRESENT,
            check_name="all ten governed categories are represented by at least one product",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "A category with no product has a permanently empty numerator, which "
                "renders exactly like a category nobody sold. The two are different "
                "statements and the data must be able to tell them apart."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_ELIGIBILITY_RULE_RESOLVES,
            check_name="every product's eligibility_rule_id is its category's governed rule",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The rule id is stamped from config/reference/fi_product_eligibility.yaml "
                "and is what the penetration view names as its denominator. A product "
                "carrying a rule its category does not own would publish a numerator and "
                "a denominator drawn from two different populations."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_ACTIVE_DATES,
            check_name="active_end_date is never before active_start_date, and is_active agrees",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "A product withdrawn before it opened cannot have been sold, and an "
                "is_active flag that contradicts the dates would let a withdrawn product "
                "appear in a current menu."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_CONTRACT_TERM_RANGE,
            check_name="default_contract_term_months is a plausible PRODUCT contract term",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "This is the length of the coverage, not the length of a loan: ARPI "
                "models no loan term. The bound keeps the two from being confused by a "
                "value that only makes sense as financing."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_SENSITIVITY_FLAGS_BOOLEAN,
            check_name="cancellation_sensitive and chargeback_sensitive are booleans and vary",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "Both flags drive the adjustment generator. A catalogue in which every "
                "product carried the same value would make them decorative, and a "
                "decorative attribute is one a reader will eventually read as a finding."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_TYPE_1_NO_HISTORY,
            check_name="dim_finance_product carries no Type 2 history columns",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The SCD policy is Type 1 (ADR-0006): a corrected product name is a "
                "correction, not a new version of the product. An effective_date or an "
                "is_current column would imply history the merge does not keep, and a "
                "consumer would filter on it and silently lose every row."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_SOURCE_SYSTEM,
            check_name="dim_finance_product.source_system is the synthetic generator",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The lineage marker is what stops a reader mistaking an invented product "
                "catalogue for a real dealership's F&I menu."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPD_NO_PROHIBITED_PII,
            check_name="dim_finance_product declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_FINANCE_PRODUCT,
            description=(
                "The tripwire's vocabulary was extended by DASH.6 with the lending and "
                "credit mechanics ARPI does not model, so a future apr, buy_rate or "
                "credit_tier column fails the run on the schema alone."
            ),
            applies_to=(_WAREHOUSE_DIM_FINANCE_PRODUCT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------------------
class FinanceProductGenerator(BaseGenerator):
    """Build one ``dim_finance_product`` row per catalogued product definition."""

    entity_name = ENTITY_DIM_FINANCE_PRODUCT
    declared_columns = DIM_FINANCE_PRODUCT_COLUMNS
    namespace = FINANCE_PRODUCT_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the finance-product frame.

        Args:
            config: Resolved configuration. Unused: the catalogue is fixed reference
                data and this generator draws nothing, so its output is identical under
                every seed. The parameter is part of the shared generator contract.

        Returns:
            A frame with the fifteen contract columns, in order, ordered by
            ``finance_product_id`` so the output is byte-stable.
        """
        del config  # The catalogue is reference data; no draw depends on the seed.
        rules = eligibility_configuration()
        rows = [
            _row(definition, rules.rule_by_category[definition.product_category], ordinal)
            for ordinal, definition in enumerate(
                sorted(FINANCE_PRODUCT_DEFINITIONS, key=lambda item: item.finance_product_id),
                start=1,
            )
        ]
        frame = pd.DataFrame.from_records(rows, columns=list(DIM_FINANCE_PRODUCT_COLUMNS))
        return frame.astype(DIM_FINANCE_PRODUCT_DTYPES)


def _row(definition: FinanceProductDefinition, rule: Any, ordinal: int) -> dict[str, Any]:
    """Render one catalogue entry as its declared row.

    ``eligible_finance_structures`` and ``eligible_vehicle_conditions`` are DERIVED from
    the governed rule rather than declared beside it. They are descriptive metadata for a
    consumer that wants to render "which deals could carry this?" without loading the
    configuration -- they are never the authority, and because they are derived they
    cannot disagree with it.
    """
    return {
        "finance_product_key": ordinal,
        "finance_product_id": definition.finance_product_id,
        "product_name": definition.product_name,
        "product_category": definition.product_category,
        "provider_name": definition.provider_name,
        "eligibility_rule_id": rule.rule_id,
        "eligible_finance_structures": " | ".join(sorted(rule.finance_structures)),
        "eligible_vehicle_conditions": " | ".join(sorted(rule.vehicle_conditions)),
        "default_contract_term_months": definition.default_contract_term_months,
        "cancellation_sensitive": definition.cancellation_sensitive,
        "chargeback_sensitive": definition.chargeback_sensitive,
        "active_start_date": ACTIVE_START_DATE,
        "active_end_date": SENTINEL_EXPIRATION_DATE,
        "is_active": True,
        "source_system": SOURCE_SYSTEM,
    }


def generate_finance_product_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_finance_product`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return FinanceProductGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_finance_product_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-FPD-001`` through ``DQ-FPD-012`` against the product catalogue.

    Args:
        dataset: The generated ``dim_finance_product`` dataset.

    Returns:
        A report containing twelve results, in check-id order.
    """
    frame = dataset.frame
    rules = eligibility_configuration()
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "finance_product_id",
                check_id=CHECK_FPD_UNIQUE_ID,
                check_name="dim_finance_product.finance_product_id is unique",
                target_object=ENTITY_DIM_FINANCE_PRODUCT,
            ),
            check_column_schema(
                frame,
                DIM_FINANCE_PRODUCT_COLUMNS,
                check_id=CHECK_FPD_SCHEMA_MATCHES,
                check_name="dim_finance_product matches its declared column contract",
                target_object=ENTITY_DIM_FINANCE_PRODUCT,
            ),
            check_values_in_allowed_set(
                frame,
                "product_category",
                FINANCE_PRODUCT_CATEGORIES,
                check_id=CHECK_FPD_CATEGORY_DOMAIN,
                check_name="every product_category is one of the ten governed categories",
                target_object=ENTITY_DIM_FINANCE_PRODUCT,
            ),
            check_values_in_allowed_set(
                frame,
                "provider_name",
                FICTIONAL_PROVIDERS,
                check_id=CHECK_FPD_PROVIDER_FICTIONAL,
                check_name="every provider is one of the declared fictional administrators",
                target_object=ENTITY_DIM_FINANCE_PRODUCT,
            ),
            _check_every_category_present(frame),
            _check_eligibility_rule_resolves(frame, rules),
            _check_active_dates(frame),
            _check_contract_term_range(frame),
            _check_sensitivity_flags(frame),
            _check_type_1_no_history(frame),
            _check_source_system(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_FPD_NO_PROHIBITED_PII,
                check_name="dim_finance_product declares no prohibited personal-data column",
                target_object=ENTITY_DIM_FINANCE_PRODUCT,
            ),
        )
    )


def _base(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_DIM_FINANCE_PRODUCT,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_every_category_present(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-005`` -- all ten governed categories carry at least one product."""
    base = _base(
        CHECK_FPD_EVERY_CATEGORY_PRESENT,
        "all ten governed categories are represented by at least one product",
        CHECK_CATEGORY_COMPLETENESS,
    )
    present = {str(value) for value in frame["product_category"]}
    missing = tuple(name for name in FINANCE_PRODUCT_CATEGORIES if name not in present)
    if not missing:
        return base
    return base.failed(
        f"{len(missing)} governed category/categories carry no product: "
        f"{', '.join(missing)}. An empty category's penetration renders exactly like a "
        "category nobody sold, and the two are different statements.",
        observed_value=float(len(missing)),
        failed_record_count=len(missing),
    )


def _check_eligibility_rule_resolves(frame: pd.DataFrame, rules: Any) -> CheckResult:
    """``DQ-FPD-006`` -- the stamped rule is the one its category owns."""
    base = _base(
        CHECK_FPD_ELIGIBILITY_RULE_RESOLVES,
        "every product's eligibility_rule_id is its category's governed rule",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for product_id, category, rule_id, structures, conditions in zip(
        frame["finance_product_id"],
        frame["product_category"],
        frame["eligibility_rule_id"],
        frame["eligible_finance_structures"],
        frame["eligible_vehicle_conditions"],
        strict=True,
    ):
        owning = rules.rule_by_category.get(str(category))
        if owning is None:
            offending.append(f"{product_id}: category {category} owns no rule")
            continue
        if str(rule_id) != owning.rule_id:
            offending.append(f"{product_id}: carries {rule_id}, category owns {owning.rule_id}")
            continue
        if str(structures) != " | ".join(sorted(owning.finance_structures)):
            offending.append(f"{product_id}: eligible_finance_structures disagree with {rule_id}")
        if str(conditions) != " | ".join(sorted(owning.vehicle_conditions)):
            offending.append(f"{product_id}: eligible_vehicle_conditions disagree with {rule_id}")
    if not offending:
        return base
    return base.failed(
        f"{len(offending)} product(s) carry eligibility metadata that contradicts the "
        f"governed rule: {'; '.join(offending[:5])}.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_active_dates(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-007`` -- the active window is ordered and ``is_active`` agrees with it."""
    base = _base(
        CHECK_FPD_ACTIVE_DATES,
        "active_end_date is never before active_start_date, and is_active agrees",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_id, start, end, is_active in zip(
        frame["finance_product_id"],
        frame["active_start_date"],
        frame["active_end_date"],
        frame["is_active"],
        strict=True,
    ):
        start_date = pd.Timestamp(start).date()
        end_date = pd.Timestamp(end).date()
        if end_date < start_date:
            offending.append(f"{product_id}: withdrawn {end_date} before it opened {start_date}")
            continue
        if bool(is_active) is not (end_date == SENTINEL_EXPIRATION_DATE):
            offending.append(f"{product_id}: is_active={is_active} contradicts end {end_date}")
    if not offending:
        return base
    return base.failed(
        f"{len(offending)} product(s) carry an inconsistent active window: "
        f"{'; '.join(offending[:5])}.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_contract_term_range(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-008`` -- the PRODUCT contract term is inside its plausible band."""
    minimum, maximum = CONTRACT_TERM_BOUNDS
    base = _base(
        CHECK_FPD_CONTRACT_TERM_RANGE,
        "default_contract_term_months is a plausible PRODUCT contract term",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    terms = frame["default_contract_term_months"]
    offending = int(((terms < minimum) | (terms > maximum)).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} product(s) declare a contract term outside [{minimum}, {maximum}] "
        "months. This is the length of the COVERAGE, not of a loan; ARPI models no loan "
        "term at all.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_sensitivity_flags(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-009`` -- both sensitivity flags are booleans and both genuinely vary."""
    base = _base(
        CHECK_FPD_SENSITIVITY_FLAGS_BOOLEAN,
        "cancellation_sensitive and chargeback_sensitive are booleans and vary",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    problems: list[str] = []
    for column in ("cancellation_sensitive", "chargeback_sensitive"):
        values = {bool(value) for value in frame[column]}
        if not values <= {True, False}:  # pragma: no cover - dtype forbids it
            problems.append(f"{column} is not boolean")
        elif len(values) < 2:
            problems.append(f"{column} takes only the value {values.pop()!r}")
    if not problems:
        return base
    return base.failed(
        f"{len(problems)} sensitivity flag problem(s): {'; '.join(problems)}. Both flags "
        "drive the adjustment generator; a constant flag is decorative, and a decorative "
        "attribute is one a reader will eventually read as a finding.",
        observed_value=float(len(problems)),
        failed_record_count=len(problems),
    )


def _check_type_1_no_history(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-010`` -- no Type 2 history column is present."""
    base = _base(
        CHECK_FPD_TYPE_1_NO_HISTORY,
        "dim_finance_product carries no Type 2 history columns",
        CHECK_CATEGORY_STRUCTURAL,
    )
    forbidden = ("effective_date", "expiration_date", "is_current", "attribute_hash")
    present = tuple(name for name in forbidden if name in frame.columns)
    if not present:
        return base
    return base.failed(
        f"dim_finance_product declares Type 2 history column(s) {', '.join(present)} "
        "while its SCD policy is Type 1. A consumer would filter on is_current and lose "
        "every row.",
        observed_value=float(len(present)),
        failed_record_count=len(present),
    )


def _check_source_system(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPD-011`` -- the lineage marker is present on every row."""
    base = _base(
        CHECK_FPD_SOURCE_SYSTEM,
        "dim_finance_product.source_system is the synthetic generator",
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
