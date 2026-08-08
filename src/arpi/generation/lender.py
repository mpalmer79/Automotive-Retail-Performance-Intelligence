"""Generator for ``warehouse.dim_lender`` (Slowly Changing Dimension Type 1).

WHAT THIS DIMENSION IS -- AND, MORE IMPORTANTLY, IS NOT
------------------------------------------------------
An **analytical classification of a fictional lender**. One row per invented finance
source, carrying a category (Captive, Bank, Credit Union, Independent Finance Company)
and a broad program tier (Prime, Near-prime, Subprime). Promoted by ``DASH.6``; mapping
document ``docs/source-to-target/STM-018-dim-lender.md``.

**ARPI IS NOT A LENDING MODEL AND THIS DIMENSION DOES NOT MAKE IT ONE.** Nothing here
approves, declines, tiers, prices or recommends anything. There is no APR, no buy rate,
no sell rate, no rate spread, no money factor, no payment, no loan term, no approval
status, no stipulation, no adverse-action reason, no credit score, no credit file, no
income and no debt-to-income figure -- not as a column, not as a latent generation
parameter, and not as a value derived from one. ``DQ-LND-007`` inspects the schema for
that vocabulary, so an attempt to add one fails the run rather than the review.

WHAT A PROGRAM TIER MEANS HERE
------------------------------
It describes the kind of business a fictional lender's **program** is written for. It is
an attribute of the invented institution, in the same way that "Credit Union" is. It is
**not** a customer's credit tier, and it cannot become one: no ARPI entity carries a
customer credit attribute of any kind, so there is nothing for a tier to be derived from.
:func:`assign_lender` chooses a lender from the store, the finance structure and seeded
randomness -- never from anything about a person. ``tests/unit/test_generation_lender.py``
asserts the assignment's inputs.

EVERY IDENTITY IS FICTIONAL
---------------------------
No real bank, captive finance arm, credit union or finance company is named anywhere in
ARPI, and no name may be chosen to resemble one. ``DQ-LND-002`` closes the set to the
catalogue declared here, and ``tests/unit/test_fi_privacy.py`` additionally asserts that
no committed lender name collides with a list of real institutions -- a synthetic-catalogue
contract test, deliberately **not** a claim to detect every real lender in the world.

SEEDING
-------
The catalogue is fixed reference data, so this generator draws nothing and is
seed-independent. :func:`assign_lender` does draw, and it is called by
:mod:`arpi.generation.finance_deal` from that module's own namespace.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    FINANCE_STRUCTURE_LEASE,
    FINANCE_STRUCTURE_RETAIL_FINANCE,
    LENDER_CATEGORIES,
    LENDER_PROGRAM_TIERS,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
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
    "DIM_LENDER_COLUMNS",
    "ENTITY_DIM_LENDER",
    "LENDER_ACTIVE_START_DATE",
    "LENDER_DEFINITIONS",
    "LENDER_NAMESPACE",
    "LenderDefinition",
    "assign_lender",
    "generate_lender_dataset",
    "validate_lender_dataset",
]

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
ENTITY_DIM_LENDER: Final = "dim_lender"
LENDER_NAMESPACE: Final = "dim_lender"

_WAREHOUSE_DIM_LENDER: Final = "warehouse.dim_lender"

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_LENDER_COLUMNS: Final[tuple[str, ...]] = (
    "lender_key",
    "lender_id",
    "lender_name",
    "lender_category",
    "program_tier",
    "active_start_date",
    "active_end_date",
    "is_active",
    "source_system",
)

DIM_LENDER_DTYPES: Final[dict[str, str]] = {
    "lender_key": "int32",
    "lender_id": "string",
    "lender_name": "string",
    "lender_category": "string",
    "program_tier": "string",
    "active_start_date": "datetime64[s]",
    "active_end_date": "datetime64[s]",
    "is_active": "bool",
    "source_system": "string",
}

#: Every column of ``dim_lender`` is NOT NULL.
DIM_LENDER_REQUIRED_COLUMNS: Final[tuple[str, ...]] = DIM_LENDER_COLUMNS

#: The catalogue's opening date, before the earliest reporting window.
LENDER_ACTIVE_START_DATE: Final = date(2015, 1, 1)


@dataclass(frozen=True, slots=True)
class LenderDefinition:
    """One fictional lender.

    Attributes:
        lender_id: Natural key, ``LND-###``.
        lender_name: Invented institution label. Never a real institution.
        lender_category: One of :data:`arpi.constants.LENDER_CATEGORIES`.
        program_tier: One of :data:`arpi.constants.LENDER_PROGRAM_TIERS`. Classifies the
            LENDER'S PROGRAM, never a customer.
        retail_weight: Relative share of Retail Finance deals routed here. A generation
            input, never a column.
        lease_weight: Relative share of Lease deals routed here. Zero for a lender whose
            program does not write leases. A generation input, never a column.
        franchise_affinity: Store identifiers whose franchise the lender's captive
            relationship favours, or an empty tuple for a lender with no captive tie. A
            generation input, never a column.
    """

    lender_id: str
    lender_name: str
    lender_category: str
    program_tier: str
    retail_weight: float
    lease_weight: float
    franchise_affinity: tuple[str, ...]


def _lender(
    ordinal: int,
    name: str,
    category: str,
    tier: str,
    *,
    retail_weight: float,
    lease_weight: float,
    franchise_affinity: tuple[str, ...] = (),
) -> LenderDefinition:
    """Build one catalogue entry, applying the ``LND-###`` identifier convention."""
    return LenderDefinition(
        lender_id=f"LND-{ordinal:03d}",
        lender_name=name,
        lender_category=category,
        program_tier=tier,
        retail_weight=retail_weight,
        lease_weight=lease_weight,
        franchise_affinity=franchise_affinity,
    )


#: THE CATALOGUE. Ten fictional lenders across the four governed categories and the three
#: governed program tiers.
#:
#: The two captives carry a franchise affinity, which is the one respect in which lender
#: assignment is not uniform across the group: a captive writes the franchise it belongs
#: to. That is a property of the STORE, not of any customer, which is the whole point --
#: it gives lender mix a genuine store-to-store difference without any consumer attribute
#: participating in the draw.
#:
#: Only the captives and the two largest banks write leases. A credit union and an
#: independent finance company writing no lease is a modelling choice, recorded here and
#: visible as a zero weight rather than hidden in a branch.
LENDER_DEFINITIONS: Final[tuple[LenderDefinition, ...]] = (
    _lender(
        1,
        "Granite Motors Acceptance",
        "Captive",
        "Prime",
        retail_weight=0.30,
        lease_weight=0.46,
        franchise_affinity=("GSA-001",),
    ),
    _lender(
        2,
        "Northstar Automotive Credit",
        "Captive",
        "Prime",
        retail_weight=0.22,
        lease_weight=0.38,
        franchise_affinity=("GSA-002",),
    ),
    _lender(3, "Merrimack Valley Bank", "Bank", "Prime", retail_weight=0.34, lease_weight=0.10),
    _lender(4, "Pinnacle Ridge Bank", "Bank", "Prime", retail_weight=0.26, lease_weight=0.06),
    _lender(5, "Harborline Bank", "Bank", "Near-prime", retail_weight=0.18, lease_weight=0.00),
    _lender(
        6,
        "Granite State Members Credit Union",
        "Credit Union",
        "Prime",
        retail_weight=0.24,
        lease_weight=0.00,
    ),
    _lender(
        7,
        "Riverbend Community Credit Union",
        "Credit Union",
        "Prime",
        retail_weight=0.16,
        lease_weight=0.00,
    ),
    _lender(
        8,
        "Kearsarge Federal Credit Union",
        "Credit Union",
        "Near-prime",
        retail_weight=0.11,
        lease_weight=0.00,
    ),
    _lender(
        9,
        "Sablewood Acceptance Company",
        "Independent Finance Company",
        "Near-prime",
        retail_weight=0.14,
        lease_weight=0.00,
    ),
    _lender(
        10,
        "Ledgemont Finance Company",
        "Independent Finance Company",
        "Subprime",
        retail_weight=0.09,
        lease_weight=0.00,
    ),
)

#: The catalogue keyed by lender id.
LENDERS_BY_ID: Final[dict[str, LenderDefinition]] = {
    definition.lender_id: definition for definition in LENDER_DEFINITIONS
}


# ---------------------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------------------
def assign_lender(rng: random.Random, *, dealership_id: str, finance_structure: str) -> str | None:
    """Choose the fictional lender behind one transaction, or ``None`` where none exists.

    THE ASSIGNMENT'S ENTIRE INPUT SET is the store, the derived finance structure and
    seeded randomness. No customer attribute participates, and none may: a lender chosen
    from anything about a person would be a credit decision wearing an analytics costume.

    Args:
        rng: The caller's dedicated generator, consumed in a fixed order.
        dealership_id: Selling store. Decides which captive's affinity applies.
        finance_structure: A value from
            :func:`arpi.generation.fi_eligibility.finance_structure_for`.

    Returns:
        A ``lender_id``, or ``None`` when the structure has no consumer lender: a Cash
        deal borrows nothing, and a Wholesale or Dealer Trade disposal has no consumer at
        all. ``None`` here means NO LENDER EXISTS, never "lender unknown".
    """
    if finance_structure == FINANCE_STRUCTURE_LEASE:
        weights = [
            definition.lease_weight * _affinity(definition, dealership_id)
            for definition in LENDER_DEFINITIONS
        ]
    elif finance_structure == FINANCE_STRUCTURE_RETAIL_FINANCE:
        weights = [
            definition.retail_weight * _affinity(definition, dealership_id)
            for definition in LENDER_DEFINITIONS
        ]
    else:
        return None
    if sum(weights) <= 0.0:  # pragma: no cover - the catalogue always offers one
        return None
    return rng.choices(LENDER_DEFINITIONS, weights=weights, k=1)[0].lender_id


def _affinity(definition: LenderDefinition, dealership_id: str) -> float:
    """Weight multiplier for a captive's own franchise.

    A captive at its own store is heavily favoured and elsewhere is nearly absent, which
    is what a captive relationship actually looks like. A lender with no captive tie is
    unaffected.
    """
    if not definition.franchise_affinity:
        return 1.0
    return 3.2 if dealership_id in definition.franchise_affinity else 0.05


# ---------------------------------------------------------------------------------------
# Data-quality check identifiers
# ---------------------------------------------------------------------------------------
CHECK_LND_UNIQUE_ID: Final = "DQ-LND-001"
CHECK_LND_NAME_FICTIONAL: Final = "DQ-LND-002"
CHECK_LND_SCHEMA_MATCHES: Final = "DQ-LND-003"
CHECK_LND_CATEGORY_DOMAIN: Final = "DQ-LND-004"
CHECK_LND_PROGRAM_TIER_DOMAIN: Final = "DQ-LND-005"
CHECK_LND_ACTIVE_DATES: Final = "DQ-LND-006"
CHECK_LND_NO_LENDING_MECHANICS: Final = "DQ-LND-007"
CHECK_LND_CATEGORY_COVERAGE: Final = "DQ-LND-008"
CHECK_LND_SOURCE_SYSTEM: Final = "DQ-LND-009"
CHECK_LND_NO_PROHIBITED_PII: Final = "DQ-LND-010"

LENDER_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_LND_UNIQUE_ID,
    CHECK_LND_NAME_FICTIONAL,
    CHECK_LND_SCHEMA_MATCHES,
    CHECK_LND_CATEGORY_DOMAIN,
    CHECK_LND_PROGRAM_TIER_DOMAIN,
    CHECK_LND_ACTIVE_DATES,
    CHECK_LND_NO_LENDING_MECHANICS,
    CHECK_LND_CATEGORY_COVERAGE,
    CHECK_LND_SOURCE_SYSTEM,
    CHECK_LND_NO_PROHIBITED_PII,
)

#: Column names that would turn this dimension into a lending model. Checked as a
#: SUBSTRING of a normalised column name, so ``lender_buy_rate`` fails as surely as
#: ``buy_rate``. This list is narrower than the platform-wide privacy vocabulary on
#: purpose: it is the F&I-specific statement of what this dimension may not become, and
#: ``DQ-LND-010`` still applies the whole tripwire on top of it.
PROHIBITED_LENDING_MECHANIC_TOKENS: Final[tuple[str, ...]] = (
    "adverse_action",
    "apr",
    "approval",
    "buy_rate",
    "credit_score",
    "credit_tier",
    "debt_to_income",
    "decision",
    "fico",
    "income",
    "interest",
    "loan_to_value",
    "money_factor",
    "payment",
    "rate_spread",
    "sell_rate",
    "stipulation",
)

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_LND_UNIQUE_ID,
            check_name="dim_lender.lender_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "The lender id is the natural key every financed deal resolves through. "
                "A duplicate would split one lender's book into two and make the lender "
                "mix describe a group that does not exist."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_NAME_FICTIONAL,
            check_name="every lender name is one of the declared fictional institutions",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "ARPI attaches invented lender mix and an invented program tier to every "
                "row here. Attaching that to a real financial institution's name would be "
                "a fabricated claim about a real company, so the set is closed rather "
                "than merely conventional."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_SCHEMA_MATCHES,
            check_name="dim_lender matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "The raw loader maps positionally; a reordered column loads silently wrong."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_CATEGORY_DOMAIN,
            check_name="lender_category is in the governed four-value vocabulary",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_LENDER,
            description=(
                "Captive, Bank, Credit Union and Independent Finance Company are the "
                "whole vocabulary. An unknown category would appear in a lender mix as a "
                "share of a total it was never counted into."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_PROGRAM_TIER_DOMAIN,
            check_name="program_tier is in the governed three-value vocabulary",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_LENDER,
            description=(
                "A tier classifies the FICTIONAL LENDER'S PROGRAM and never a customer. "
                "Closing the vocabulary is what stops a future value that reads like a "
                "credit grade -- 'A+', 'Tier 3' -- from arriving and being mistaken for "
                "one."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_ACTIVE_DATES,
            check_name="dim_lender's active window is ordered and is_active agrees with it",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_LENDER,
            description=(
                "A lender withdrawn before it opened cannot have funded anything, and an "
                "is_active flag contradicting the dates would put a withdrawn program "
                "back into a current lender mix."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_NO_LENDING_MECHANICS,
            check_name="dim_lender declares no rate, payment, credit or decisioning column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "ARPI is not a lending model. This check inspects the SCHEMA, so an empty "
                "apr or buy_rate column fails the run: the defect is that the platform "
                "claims to model a mechanic it does not have, not that a value is wrong."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_CATEGORY_COVERAGE,
            check_name="every governed lender category is represented",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "A category with no lender makes its share of the lender mix permanently "
                "zero, which reads exactly like a category nobody used."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_SOURCE_SYSTEM,
            check_name="dim_lender.source_system is the synthetic generator",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "The lineage marker is what stops a reader mistaking an invented lender "
                "catalogue for a real dealership's lender panel."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
        CheckDefinition(
            check_id=CHECK_LND_NO_PROHIBITED_PII,
            check_name="dim_lender declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LENDER,
            description=(
                "The platform-wide tripwire, applied on top of the F&I-specific check "
                "above. A lender row describes an institution and never a person."
            ),
            applies_to=(_WAREHOUSE_DIM_LENDER,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------------------
class LenderGenerator(BaseGenerator):
    """Build one ``dim_lender`` row per fictional lender definition."""

    entity_name = ENTITY_DIM_LENDER
    declared_columns = DIM_LENDER_COLUMNS
    namespace = LENDER_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the lender frame.

        Args:
            config: Resolved configuration. Unused: the catalogue is reference data and
                this generator draws nothing.

        Returns:
            A frame with the nine contract columns, in order, ordered by ``lender_id``.
        """
        del config  # Reference data; no draw depends on the seed.
        rows = [
            {
                "lender_key": ordinal,
                "lender_id": definition.lender_id,
                "lender_name": definition.lender_name,
                "lender_category": definition.lender_category,
                "program_tier": definition.program_tier,
                "active_start_date": LENDER_ACTIVE_START_DATE,
                "active_end_date": SENTINEL_EXPIRATION_DATE,
                "is_active": True,
                "source_system": SOURCE_SYSTEM,
            }
            for ordinal, definition in enumerate(
                sorted(LENDER_DEFINITIONS, key=lambda item: item.lender_id), start=1
            )
        ]
        frame = pd.DataFrame.from_records(rows, columns=list(DIM_LENDER_COLUMNS))
        return frame.astype(DIM_LENDER_DTYPES)


def generate_lender_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_lender`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return LenderGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_lender_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-LND-001`` through ``DQ-LND-010`` against the lender catalogue.

    Args:
        dataset: The generated ``dim_lender`` dataset.

    Returns:
        A report containing ten results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "lender_id",
                check_id=CHECK_LND_UNIQUE_ID,
                check_name="dim_lender.lender_id is unique",
                target_object=ENTITY_DIM_LENDER,
            ),
            check_values_in_allowed_set(
                frame,
                "lender_name",
                tuple(definition.lender_name for definition in LENDER_DEFINITIONS),
                check_id=CHECK_LND_NAME_FICTIONAL,
                check_name="every lender name is one of the declared fictional institutions",
                target_object=ENTITY_DIM_LENDER,
            ),
            check_column_schema(
                frame,
                DIM_LENDER_COLUMNS,
                check_id=CHECK_LND_SCHEMA_MATCHES,
                check_name="dim_lender matches its declared column contract",
                target_object=ENTITY_DIM_LENDER,
            ),
            check_values_in_allowed_set(
                frame,
                "lender_category",
                LENDER_CATEGORIES,
                check_id=CHECK_LND_CATEGORY_DOMAIN,
                check_name="lender_category is in the governed four-value vocabulary",
                target_object=ENTITY_DIM_LENDER,
            ),
            check_values_in_allowed_set(
                frame,
                "program_tier",
                LENDER_PROGRAM_TIERS,
                check_id=CHECK_LND_PROGRAM_TIER_DOMAIN,
                check_name="program_tier is in the governed three-value vocabulary",
                target_object=ENTITY_DIM_LENDER,
            ),
            _check_active_dates(frame),
            _check_no_lending_mechanics(frame),
            _check_category_coverage(frame),
            _check_source_system(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_LND_NO_PROHIBITED_PII,
                check_name="dim_lender declares no prohibited personal-data column",
                target_object=ENTITY_DIM_LENDER,
            ),
        )
    )


def _base(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_DIM_LENDER,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_active_dates(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LND-006`` -- the active window is ordered and ``is_active`` agrees."""
    base = _base(
        CHECK_LND_ACTIVE_DATES,
        "dim_lender's active window is ordered and is_active agrees with it",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for lender_id, start, end, is_active in zip(
        frame["lender_id"],
        frame["active_start_date"],
        frame["active_end_date"],
        frame["is_active"],
        strict=True,
    ):
        start_date = pd.Timestamp(start).date()
        end_date = pd.Timestamp(end).date()
        if end_date < start_date:
            offending.append(f"{lender_id}: withdrawn {end_date} before it opened {start_date}")
            continue
        if bool(is_active) is not (end_date == SENTINEL_EXPIRATION_DATE):
            offending.append(f"{lender_id}: is_active={is_active} contradicts end {end_date}")
    if not offending:
        return base
    return base.failed(
        f"{len(offending)} lender(s) carry an inconsistent active window: "
        f"{'; '.join(offending[:5])}.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_no_lending_mechanics(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LND-007`` -- the SCHEMA carries no rate, payment, credit or decisioning column."""
    base = _base(
        CHECK_LND_NO_LENDING_MECHANICS,
        "dim_lender declares no rate, payment, credit or decisioning column",
        CHECK_CATEGORY_PRIVACY,
    )
    offending: list[str] = []
    for column in frame.columns:
        normalised = str(column).strip().lower().replace("-", "_").replace(" ", "_")
        for token in PROHIBITED_LENDING_MECHANIC_TOKENS:
            if token in normalised:
                offending.append(f"{column} (contains {token!r})")
                break
    if not offending:
        return base
    return base.failed(
        f"{len(offending)} column(s) declare a lending mechanic ARPI does not model: "
        f"{', '.join(offending)}. ARPI is not a lending model: it approves nothing, "
        "prices nothing and recommends nothing.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_category_coverage(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LND-008`` -- every governed lender category is represented."""
    base = _base(
        CHECK_LND_CATEGORY_COVERAGE,
        "every governed lender category is represented",
        CHECK_CATEGORY_COMPLETENESS,
    )
    present = {str(value) for value in frame["lender_category"]}
    missing = tuple(name for name in LENDER_CATEGORIES if name not in present)
    if not missing:
        return base
    return base.failed(
        f"{len(missing)} governed lender category/categories carry no lender: "
        f"{', '.join(missing)}.",
        observed_value=float(len(missing)),
        failed_record_count=len(missing),
    )


def _check_source_system(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LND-009`` -- the lineage marker is present on every row."""
    base = _base(
        CHECK_LND_SOURCE_SYSTEM,
        "dim_lender.source_system is the synthetic generator",
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
