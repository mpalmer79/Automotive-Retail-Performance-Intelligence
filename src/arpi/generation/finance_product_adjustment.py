"""Generator for ``finance_product_adjustment`` -- what happens to a contract afterwards.

Grain: **one row per product adjustment event.** Mapping document
``docs/source-to-target/STM-020-fact-finance-product-adjustment.md``.

THE ORIGINAL CONTRACT IS NEVER REWRITTEN
----------------------------------------
This is the whole design. A cancellation, a chargeback, a reinstatement or an approved
adjustment is an EVENT with its own business date; the ``fact_finance_product_sale`` row
it refers to keeps the gross it was written with, forever. A June contract charged back
in August stays a June contract with June's gross, and August carries the chargeback.

Restating the June row instead would be easier and would be wrong twice over: it would
move production out of the month it happened in, so every historical month would change
whenever a later event posted; and it would destroy the distinction between what the F&I
office PRODUCED and what the store RETAINED, which is the distinction the whole domain
exists to make.

THREE DATE BASES, NEVER BLENDED SILENTLY
----------------------------------------
1. **Deal-date gross.** ``original_product_gross`` by the parent deal's sale date.
2. **As-of net gross.** Original minus cumulative adjustments through a stated as-of
   date. Always displayed with that date.
3. **Adjustment-period impact.** Adjustment rows grouped by ``adjustment_date``.

Every reporting view and every KPI names which of the three it is on.

THE SIGN CONVENTION
-------------------
Declared once in :data:`arpi.constants.ADJUSTMENT_SIGN_CONVENTION` and implemented here::

    net_product_gross_as_of = original_product_gross
                            - SUM(adjustment_amount WHERE adjustment_date <= as_of)

A POSITIVE amount REDUCES retained gross; a NEGATIVE one restores it. Cancellation and
Chargeback are constrained positive, Reinstatement negative, and Approved Adjustment is
signed with a governed reason category that says which way it went.

THE CAP
-------
Cumulative net reduction stays inside ``[0, original_product_gross]`` after **every**
event in a contract's sequence, not merely at the end. An ordinary adjustment cannot take
back more than was produced, and a reinstatement cannot restore more than was taken. The
default is capped behaviour and this generator produces nothing else; the cap is enforced
here, asserted by ``DQ-FPA-007``, constrained in the warehouse by
``RECON-FI-ADJUSTMENT-CAP``, and exercised by a seeded corruption case.

WHAT THE SENSITIVITY FLAGS DO
-----------------------------
``dim_finance_product.cancellation_sensitive`` and ``chargeback_sensitive`` are read
here and nowhere else. A product that is not cancellation-sensitive produces **no**
Cancellation row, ever; a product that is not chargeback-sensitive produces **no**
Chargeback row. That is what stops the two columns from being decoration.

NOTHING HERE IS ABOUT A PERSON
------------------------------
Reason categories are a closed vocabulary describing what happened to a CONTRACT. No
free-text field exists, because a free-text reason is a place somebody eventually writes
something about a customer.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    ADJUSTMENT_REASON_CATEGORIES,
    ADJUSTMENT_REASON_CATEGORY_VALUES,
    ADJUSTMENT_SIGN_CONVENTION,
    ADJUSTMENT_TYPE_APPROVED,
    ADJUSTMENT_TYPE_CANCELLATION,
    ADJUSTMENT_TYPE_CHARGEBACK,
    ADJUSTMENT_TYPE_REINSTATEMENT,
    ADJUSTMENT_TYPES,
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.finance_product_sale import (
    FinanceProductSaleRecord,
    build_finance_product_sale_records,
)
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import check_column_schema, check_unique_column
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from pathlib import Path

    from arpi.config import ArpiConfig

__all__ = [
    "ADJUSTMENT_COLUMNS",
    "ADJUSTMENT_NAMESPACE",
    "ENTITY_FINANCE_PRODUCT_ADJUSTMENT",
    "FinanceProductAdjustmentRecord",
    "build_finance_product_adjustment_records",
    "generate_finance_product_adjustment_dataset",
    "net_product_gross_as_of",
    "validate_finance_product_adjustment_dataset",
]

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
ENTITY_FINANCE_PRODUCT_ADJUSTMENT: Final = "finance_product_adjustment"
ADJUSTMENT_NAMESPACE: Final = "finance_product_adjustment"

ADJUSTMENT_ID_PREFIX: Final = "FPA-"
ADJUSTMENT_ID_DIGITS: Final = 8

_WAREHOUSE_FACT: Final = "warehouse.fact_finance_product_adjustment"
_ZERO: Final = Decimal("0.00")
_CENTS: Final = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    """Quantize to the cent, half-up."""
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
ADJUSTMENT_COLUMNS: Final[tuple[str, ...]] = (
    "adjustment_id",
    "product_sale_id",
    "sale_id",
    "adjustment_date",
    "dealership_id",
    "finance_manager_id",
    "finance_product_id",
    "product_category",
    "adjustment_type",
    "adjustment_amount",
    "adjustment_reason_category",
    "sequence_ordinal",
    "source_system",
)

ADJUSTMENT_DTYPES: Final[dict[str, str]] = {
    "adjustment_id": "string",
    "product_sale_id": "string",
    "sale_id": "string",
    "adjustment_date": "datetime64[s]",
    "dealership_id": "string",
    "finance_manager_id": "string",
    "finance_product_id": "string",
    "product_category": "string",
    "adjustment_type": "string",
    "adjustment_amount": "object",
    "adjustment_reason_category": "string",
    "sequence_ordinal": "int16",
    "source_system": "string",
}

#: The one column that may be NULL: the parent deal was written with nobody on the F&I
#: desk. Attribution follows the CONTRACT's manager, so an adjustment is credited to
#: whoever wrote the original deal rather than to whoever processed the cancellation --
#: the latter is not modelled and inventing it would attribute a loss to a person on no
#: evidence.
ADJUSTMENT_NULLABLE_COLUMNS: Final[tuple[str, ...]] = ("finance_manager_id",)


# ---------------------------------------------------------------------------------------
# Generation parameters -- PROJECT DEFAULTS FOR A FICTIONAL GROUP
# ---------------------------------------------------------------------------------------
# Synthetic distributions for a fictional dealer group. None is an industry rate, a market
# observation or a benchmark, and no reader may treat a resulting cancellation or
# chargeback rate as one.

#: Probability that a CANCELLATION-SENSITIVE contract is cancelled, by category. A
#: category absent here contributes nothing even if its product carries the flag.
CANCELLATION_BASE: Final[dict[str, float]] = {
    "Vehicle Service Contract": 0.085,
    "GAP": 0.070,
    "Tire & Wheel": 0.055,
    "Prepaid Maintenance": 0.065,
    "Lease Wear Protection": 0.040,
}

#: Probability that a CHARGEBACK-SENSITIVE contract is charged back, by category.
CHARGEBACK_BASE: Final[dict[str, float]] = {
    "Vehicle Service Contract": 0.070,
    "GAP": 0.095,
    "Prepaid Maintenance": 0.055,
}

#: Share of cancellations that are later rescinded, producing a Reinstatement.
REINSTATEMENT_SHARE: Final = 0.14

#: Share of contracts that carry an Approved Adjustment, independently of any reduction.
APPROVED_ADJUSTMENT_SHARE: Final = 0.012

#: Days between the deal and the event, drawn ``(low, high, mode)``.
#:
#: The modes sit early in the range because a cancellation or a chargeback that is going
#: to happen usually happens in the first months of a contract. The long right tails are
#: kept: a contract cancelled a year in is a real event, and the generator produces some.
#:
#: THE REPORTING WINDOW TRUNCATES THIS DISTRIBUTION, AND THAT IS A REAL PROPERTY OF THE
#: DATASET, NOT A DEFECT. An event dated past the window's end has no ``dim_date`` row to
#: resolve and is not emitted, so the most recent months of sales carry structurally
#: fewer adjustments than the earliest ones -- exactly as a real store's most recent
#: cohort does, because those contracts have not had time to fail. Any comparison of
#: adjustment volume between an early month and a late one is reading that truncation.
#: ``LIMITATIONS.md`` records it.
CANCELLATION_LAG_DAYS: Final[tuple[float, float, float]] = (8.0, 300.0, 40.0)
CHARGEBACK_LAG_DAYS: Final[tuple[float, float, float]] = (12.0, 280.0, 55.0)
REINSTATEMENT_LAG_DAYS: Final[tuple[float, float, float]] = (5.0, 90.0, 20.0)
APPROVED_LAG_DAYS: Final[tuple[float, float, float]] = (3.0, 150.0, 25.0)

#: Share of the original gross a reduction takes back, drawn ``(low, high, mode)``.
CANCELLATION_FRACTION: Final[tuple[float, float, float]] = (0.30, 1.00, 0.75)
CHARGEBACK_FRACTION: Final[tuple[float, float, float]] = (0.45, 1.00, 0.85)

#: Share of the prior reduction a reinstatement restores.
REINSTATEMENT_FRACTION: Final[tuple[float, float, float]] = (0.35, 1.00, 0.70)

#: Share of the original gross an approved adjustment moves, in either direction.
APPROVED_FRACTION: Final[tuple[float, float, float]] = (0.02, 0.15, 0.06)

#: Probability that an Approved Adjustment restores gross rather than reducing it. A
#: restoring adjustment is only emitted when there is a prior reduction to restore: net
#: retained gross may never exceed the original gross, and an "administrative correction"
#: is not a governed exception to that.
APPROVED_RESTORES_SHARE: Final = 0.45


@dataclass(frozen=True, slots=True)
class FinanceProductAdjustmentRecord:
    """One adjustment event.

    Attributes:
        adjustment_id: Identifier in the reserved ``FPA-########`` scheme.
        product_sale_id: The contract this event acts on. Never NULL: an adjustment with
            no contract is a number with nothing to reduce.
        sale_id: The contract's parent deal, denormalised for store-and-period reads.
        adjustment_date: THE EVENT'S OWN BUSINESS DATE. Never the deal date.
        dealership_id: The store, carried from the contract.
        finance_manager_id: The manager credited on the original deal, or ``None``.
        finance_product_id: The product, carried from the contract.
        product_category: Its governed category, carried from the contract.
        adjustment_type: One of :data:`arpi.constants.ADJUSTMENT_TYPES`.
        adjustment_amount: Signed. POSITIVE REDUCES retained gross; negative restores it.
        adjustment_reason_category: A governed reason for this type. Never free text.
        sequence_ordinal: 1-based position within the contract's own event sequence,
            ordered by date. What makes "a reinstatement follows a reduction" checkable.
    """

    adjustment_id: str
    product_sale_id: str
    sale_id: str
    adjustment_date: date
    dealership_id: str
    finance_manager_id: str | None
    finance_product_id: str
    product_category: str
    adjustment_type: str
    adjustment_amount: Decimal
    adjustment_reason_category: str
    sequence_ordinal: int


def adjustment_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as an ``FPA-########`` identifier.

    Args:
        ordinal: 1-based position in the ordered adjustment population.

    Returns:
        The zero-padded identifier.

    Raises:
        GenerationError: If ``ordinal`` is not positive or overflows the reserved width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"adjustment_id ordinals start at 1, got {ordinal}.",
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
        )
    if ordinal >= 10**ADJUSTMENT_ID_DIGITS:
        raise GenerationError(
            f"adjustment_id ordinal {ordinal} does not fit the reserved "
            f"{ADJUSTMENT_ID_PREFIX}{'#' * ADJUSTMENT_ID_DIGITS} scheme.",
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
        )
    return f"{ADJUSTMENT_ID_PREFIX}{ordinal:0{ADJUSTMENT_ID_DIGITS}d}"


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
def build_finance_product_adjustment_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[FinanceProductAdjustmentRecord, ...]:
    """Build every adjustment event for the active profile.

    Args:
        config: Resolved configuration supplying the master seed and the window. The
            window's end bounds every event: an adjustment dated beyond it would have no
            ``dim_date`` row to resolve, and dropping such an event is the honest
            outcome -- the contract simply has not been adjusted yet in this dataset.
        catalogue_path: Explicit vehicle model catalogue path.

    Returns:
        The events, ordered by ``adjustment_id``, which is assigned over
        ``(product_sale_id, adjustment_date, sequence_ordinal)``.
    """
    contracts = build_finance_product_sale_records(config, catalogue_path)
    rng = rng_for(config.random_seed, ADJUSTMENT_NAMESPACE)
    window_end = config.reporting.end_date

    drafts: list[tuple[str, date, int, dict[str, Any]]] = []
    for contract in contracts:
        for ordinal, event in enumerate(_events_for(contract, rng, window_end), start=1):
            drafts.append((contract.product_sale_id, event["adjustment_date"], ordinal, event))

    drafts.sort(key=lambda item: (item[0], item[1], item[2]))
    return tuple(
        FinanceProductAdjustmentRecord(
            adjustment_id=adjustment_id_for(index),
            sequence_ordinal=ordinal,
            **event,
        )
        for index, (_, _, ordinal, event) in enumerate(drafts, start=1)
    )


@dataclass(frozen=True, slots=True)
class _ContractVariates:
    """Every random value one contract consumes, drawn before any branch is taken.

    The class exists so the draw order is stated in one place and cannot drift. Its
    fields are deliberately in draw order.
    """

    primary_draw: float
    cancel_lag: int
    chargeback_lag: int
    cancel_fraction: Decimal
    chargeback_fraction: Decimal
    cancel_reason: str
    chargeback_reason: str
    reinstatement_draw: float
    reinstatement_lag: int
    reinstatement_fraction: Decimal
    reinstatement_reason: str
    approved_draw: float
    approved_lag: int
    approved_fraction: Decimal
    approved_restores: bool
    approved_reason: str


def _draw_contract_variates(rng: random.Random) -> _ContractVariates:
    """Consume the contract's whole variate budget, in a fixed order, unconditionally.

    THE RANDOM STREAM IS FIXED per contract regardless of which branch is taken later:
    the primary-event variate, its lag, its fraction, the reinstatement variate and its
    two parameters, and the approved-adjustment variate and its three parameters are all
    drawn every time. Consuming a variable number of variates would make one contract's
    outcome depend on the previous contract's branch, and a change to any probability
    would then reshuffle the whole population.
    """
    return _ContractVariates(
        primary_draw=rng.random(),
        cancel_lag=int(rng.triangular(*CANCELLATION_LAG_DAYS)),
        chargeback_lag=int(rng.triangular(*CHARGEBACK_LAG_DAYS)),
        cancel_fraction=Decimal(str(round(rng.triangular(*CANCELLATION_FRACTION), 6))),
        chargeback_fraction=Decimal(str(round(rng.triangular(*CHARGEBACK_FRACTION), 6))),
        cancel_reason=_reason(rng, ADJUSTMENT_TYPE_CANCELLATION),
        chargeback_reason=_reason(rng, ADJUSTMENT_TYPE_CHARGEBACK),
        reinstatement_draw=rng.random(),
        reinstatement_lag=int(rng.triangular(*REINSTATEMENT_LAG_DAYS)),
        reinstatement_fraction=Decimal(str(round(rng.triangular(*REINSTATEMENT_FRACTION), 6))),
        reinstatement_reason=_reason(rng, ADJUSTMENT_TYPE_REINSTATEMENT),
        approved_draw=rng.random(),
        approved_lag=int(rng.triangular(*APPROVED_LAG_DAYS)),
        approved_fraction=Decimal(str(round(rng.triangular(*APPROVED_FRACTION), 6))),
        approved_restores=rng.random() < APPROVED_RESTORES_SHARE,
        approved_reason=_reason(rng, ADJUSTMENT_TYPE_APPROVED),
    )


def _primary_event(
    contract: FinanceProductSaleRecord,
    drawn: _ContractVariates,
    window_end: date,
) -> dict[str, Any] | None:
    """The contract's first reduction, if one happens and it lands inside the window.

    Cancellation and Chargeback share one variate and are therefore mutually exclusive:
    a contract is cancelled or charged back, never both on the same draw. The
    probabilities are zero wherever the product's sensitivity flag is false, which is
    what stops the two catalogue columns being decoration.
    """
    cancel_probability = (
        CANCELLATION_BASE.get(contract.product_category, 0.0)
        if contract.cancellation_sensitive
        else 0.0
    )
    chargeback_probability = (
        CHARGEBACK_BASE.get(contract.product_category, 0.0)
        if contract.chargeback_sensitive
        else 0.0
    )
    if drawn.primary_draw < cancel_probability:
        event_type = ADJUSTMENT_TYPE_CANCELLATION
        lag, fraction, reason = drawn.cancel_lag, drawn.cancel_fraction, drawn.cancel_reason
    elif drawn.primary_draw < cancel_probability + chargeback_probability:
        event_type = ADJUSTMENT_TYPE_CHARGEBACK
        lag = drawn.chargeback_lag
        fraction = drawn.chargeback_fraction
        reason = drawn.chargeback_reason
    else:
        return None

    posted = contract.sale_date + timedelta(days=lag)
    if posted > window_end:
        # THE WINDOW TRUNCATION, and it is a modelled property rather than a defect: an
        # event with no dim_date row to resolve is not emitted, so recent cohorts carry
        # structurally fewer adjustments. LIMITATIONS.md section 15.10 records it.
        return None
    amount = _capped_reduction(
        contract.original_product_gross, _ZERO, _money(contract.original_product_gross * fraction)
    )
    if amount <= _ZERO:
        return None
    return _event(contract, posted, event_type, amount, reason)


def _reinstatement_event(
    contract: FinanceProductSaleRecord,
    drawn: _ContractVariates,
    window_end: date,
    *,
    prior: dict[str, Any],
    cumulative: Decimal,
) -> dict[str, Any] | None:
    """A rescinded cancellation, which restores part of what the cancellation took.

    Only a Cancellation is rescindable, and only up to what it removed: a reinstatement
    that restored more than was taken would create gross the deal never produced.
    """
    if prior["adjustment_type"] != ADJUSTMENT_TYPE_CANCELLATION:
        return None
    if drawn.reinstatement_draw >= REINSTATEMENT_SHARE:
        return None
    posted = prior["adjustment_date"] + timedelta(days=drawn.reinstatement_lag)
    if posted > window_end:
        return None
    restored = min(_money(cumulative * drawn.reinstatement_fraction), cumulative)
    if restored <= _ZERO:
        return None
    return _event(
        contract, posted, ADJUSTMENT_TYPE_REINSTATEMENT, -restored, drawn.reinstatement_reason
    )


def _approved_event(
    contract: FinanceProductSaleRecord,
    drawn: _ContractVariates,
    window_end: date,
    *,
    cumulative: Decimal,
) -> dict[str, Any] | None:
    """An administrative, pricing or remittance correction, drawn independently.

    It may move gross either way. A RESTORING correction is bounded by the reductions
    that precede it: net retained gross may never exceed the original gross, and an
    "administrative correction" is not a governed exception to that.
    """
    if drawn.approved_draw >= APPROVED_ADJUSTMENT_SHARE:
        return None
    posted = contract.sale_date + timedelta(days=drawn.approved_lag)
    if posted > window_end:
        return None
    magnitude = _money(contract.original_product_gross * drawn.approved_fraction)
    amount = (
        -min(magnitude, cumulative)
        if drawn.approved_restores
        else _capped_reduction(contract.original_product_gross, cumulative, magnitude)
    )
    if amount == _ZERO:
        return None
    return _event(contract, posted, ADJUSTMENT_TYPE_APPROVED, amount, drawn.approved_reason)


def _events_for(
    contract: FinanceProductSaleRecord, rng: random.Random, window_end: date
) -> list[dict[str, Any]]:
    """Draw the event sequence for one contract.

    Every variate is consumed first, unconditionally, by
    :func:`_draw_contract_variates`; the three helpers above only decide which of the
    drawn values are *used*, and none of them touches the generator. That is what makes
    the stream independent of which branch a contract takes.

    The running ``cumulative`` is threaded through deliberately: THE CAP HOLDS AFTER
    EVERY EVENT, not merely at the end of the sequence.
    """
    if contract.original_product_gross <= _ZERO:
        # Nothing to take back. A zero-gross contract is possible in principle and no
        # adjustment against it could satisfy the cap, so none is emitted.
        _draw_contract_variates(rng)
        return []

    drawn = _draw_contract_variates(rng)
    events: list[dict[str, Any]] = []
    cumulative = _ZERO

    primary = _primary_event(contract, drawn, window_end)
    if primary is not None:
        cumulative += primary["adjustment_amount"]
        events.append(primary)

        reinstatement = _reinstatement_event(
            contract, drawn, window_end, prior=primary, cumulative=cumulative
        )
        if reinstatement is not None:
            cumulative += reinstatement["adjustment_amount"]
            events.append(reinstatement)

    approved = _approved_event(contract, drawn, window_end, cumulative=cumulative)
    if approved is not None:
        cumulative += approved["adjustment_amount"]
        events.append(approved)

    events.sort(key=lambda event: (event["adjustment_date"], event["adjustment_type"]))
    return events


def _capped_reduction(original: Decimal, cumulative: Decimal, proposed: Decimal) -> Decimal:
    """Trim a proposed reduction so cumulative reductions never exceed the original gross."""
    remaining = original - cumulative
    if remaining <= _ZERO:
        return _ZERO
    return min(proposed, remaining)


def _reason(rng: random.Random, adjustment_type: str) -> str:
    """Draw a governed reason category for one adjustment type."""
    return rng.choice(ADJUSTMENT_REASON_CATEGORIES[adjustment_type])


def _event(
    contract: FinanceProductSaleRecord,
    posted: date,
    adjustment_type: str,
    amount: Decimal,
    reason: str,
) -> dict[str, Any]:
    """Assemble one event, without the identifier and ordinal assigned after sorting."""
    return {
        "product_sale_id": contract.product_sale_id,
        "sale_id": contract.sale_id,
        "adjustment_date": posted,
        "dealership_id": contract.dealership_id,
        "finance_manager_id": contract.finance_manager_id,
        "finance_product_id": contract.finance_product_id,
        "product_category": contract.product_category,
        "adjustment_type": adjustment_type,
        "adjustment_amount": amount,
        "adjustment_reason_category": reason,
    }


def net_product_gross_as_of(
    original_product_gross: Decimal,
    adjustments: tuple[FinanceProductAdjustmentRecord, ...],
    as_of: date,
) -> Decimal:
    """Compute a contract's retained gross as at a stated date.

    THE ONE PYTHON IMPLEMENTATION of the as-of arithmetic, mirrored in SQL by
    ``reporting.vw_deal_product_detail``.

    Args:
        original_product_gross: The contract's deal-date gross.
        adjustments: Every event on that contract, in any order.
        as_of: The governed as-of date. AN EXPLICIT ARGUMENT: there is no wall-clock
            default, because a figure whose as-of date is "now" changes meaning between
            two readings of the same dataset.

    Returns:
        ``original - SUM(amount WHERE adjustment_date <= as_of)``, exact. Events after
        ``as_of`` are excluded, which is the entire point of the basis.
    """
    applied = sum(
        (event.adjustment_amount for event in adjustments if event.adjustment_date <= as_of),
        start=_ZERO,
    )
    return _money(original_product_gross - applied)


class FinanceProductAdjustmentGenerator(BaseGenerator):
    """Build one row per F&I product adjustment event."""

    entity_name = ENTITY_FINANCE_PRODUCT_ADJUSTMENT
    declared_columns = ADJUSTMENT_COLUMNS
    namespace = ADJUSTMENT_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the adjustment frame.

        Args:
            config: Resolved configuration supplying the seed and the window.

        Returns:
            A frame with the thirteen contract columns, ordered by ``adjustment_id``.
        """
        rows = [
            {
                "adjustment_id": record.adjustment_id,
                "product_sale_id": record.product_sale_id,
                "sale_id": record.sale_id,
                "adjustment_date": record.adjustment_date,
                "dealership_id": record.dealership_id,
                "finance_manager_id": record.finance_manager_id,
                "finance_product_id": record.finance_product_id,
                "product_category": record.product_category,
                "adjustment_type": record.adjustment_type,
                "adjustment_amount": record.adjustment_amount,
                "adjustment_reason_category": record.adjustment_reason_category,
                "sequence_ordinal": record.sequence_ordinal,
                "source_system": SOURCE_SYSTEM,
            }
            for record in build_finance_product_adjustment_records(config)
        ]
        frame = pd.DataFrame.from_records(rows, columns=list(ADJUSTMENT_COLUMNS))
        return frame.astype(ADJUSTMENT_DTYPES)


def generate_finance_product_adjustment_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``finance_product_adjustment`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return FinanceProductAdjustmentGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality check identifiers
# ---------------------------------------------------------------------------------------
CHECK_FPA_UNIQUE_ID: Final = "DQ-FPA-001"
CHECK_FPA_SCHEMA_MATCHES: Final = "DQ-FPA-002"
CHECK_FPA_CONTRACT_RESOLVES: Final = "DQ-FPA-003"
CHECK_FPA_NOT_BEFORE_SALE: Final = "DQ-FPA-004"
CHECK_FPA_TYPE_DOMAIN: Final = "DQ-FPA-005"
CHECK_FPA_SIGN_CONVENTION: Final = "DQ-FPA-006"
CHECK_FPA_CUMULATIVE_CAP: Final = "DQ-FPA-007"
CHECK_FPA_REINSTATEMENT_INTEGRITY: Final = "DQ-FPA-008"
CHECK_FPA_REASON_VOCABULARY: Final = "DQ-FPA-009"
CHECK_FPA_CONTEXT_MATCHES_CONTRACT: Final = "DQ-FPA-010"
CHECK_FPA_SENSITIVITY_RESPECTED: Final = "DQ-FPA-011"
CHECK_FPA_SOURCE_SYSTEM: Final = "DQ-FPA-012"
CHECK_FPA_NO_PROHIBITED_PII: Final = "DQ-FPA-013"

ADJUSTMENT_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_FPA_UNIQUE_ID,
    CHECK_FPA_SCHEMA_MATCHES,
    CHECK_FPA_CONTRACT_RESOLVES,
    CHECK_FPA_NOT_BEFORE_SALE,
    CHECK_FPA_TYPE_DOMAIN,
    CHECK_FPA_SIGN_CONVENTION,
    CHECK_FPA_CUMULATIVE_CAP,
    CHECK_FPA_REINSTATEMENT_INTEGRITY,
    CHECK_FPA_REASON_VOCABULARY,
    CHECK_FPA_CONTEXT_MATCHES_CONTRACT,
    CHECK_FPA_SENSITIVITY_RESPECTED,
    CHECK_FPA_SOURCE_SYSTEM,
    CHECK_FPA_NO_PROHIBITED_PII,
)

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_FPA_UNIQUE_ID,
            check_name="finance_product_adjustment.adjustment_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "A duplicated event applies the same reduction twice, which drives net "
                "retained gross below what any cancellation actually took back."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_SCHEMA_MATCHES,
            check_name="finance_product_adjustment matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "The raw loader maps positionally; a reordered column loads silently wrong."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_CONTRACT_RESOLVES,
            check_name="every adjustment resolves to an existing product contract",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "AN ORPHANED ADJUSTMENT IS A NUMBER WITH NOTHING TO REDUCE. It would "
                "appear in the adjustment-period total and in no contract's net gross, "
                "so the two reads of the same domain would silently disagree."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_finance_product_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_NOT_BEFORE_SALE,
            check_name="no adjustment predates the contract it adjusts",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "Cancelling a contract before it was written is an impossible sequence, "
                "and it would make a month's net gross depend on an event that had not "
                "happened when the month closed."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_finance_product_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_TYPE_DOMAIN,
            check_name="adjustment_type is one of the four governed event types",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "Cancellation, Chargeback, Reinstatement and Approved Adjustment are the "
                "whole vocabulary. An unknown type has no sign rule, so its effect on net "
                "gross would be undefined."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_SIGN_CONVENTION,
            check_name="each adjustment type moves net gross in its declared direction",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "Cancellation and Chargeback are positive reductions; Reinstatement is "
                "negative because it reverses one. A mixed convention would make the "
                "as-of identity ambiguous rather than merely wrong."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_CUMULATIVE_CAP,
            check_name="cumulative net reduction stays inside [0, original product gross]",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "Checked after EVERY event in a contract's sequence, not only at the end: "
                "a pair of events that breached the cap and then came back inside it "
                "would otherwise pass, and the net gross between them would have been a "
                "figure the model says is impossible."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_finance_product_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_REINSTATEMENT_INTEGRITY,
            check_name="a reinstatement follows a reduction and never exceeds it",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "A reinstatement with nothing to reinstate would create gross the deal "
                "never produced. The state model forbids it, so it is a defect rather "
                "than an unusual sequence."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_REASON_VOCABULARY,
            check_name="the reason category is governed and belongs to its adjustment type",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "The vocabulary is closed because a free-text reason is where somebody "
                "eventually writes something about a customer. It is checked against the "
                "TYPE as well as the vocabulary, so a Repossession cannot be recorded as "
                "a reinstatement's reason."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_CONTEXT_MATCHES_CONTRACT,
            check_name="store, manager, product and deal match the adjusted contract",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "The context is denormalised so adjustment-period analysis needs no join. "
                "A denormalised value that can disagree with its source is how a store's "
                "adjustment total stops matching the group's."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.fact_finance_product_sale"),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_SENSITIVITY_RESPECTED,
            check_name="cancellations and chargebacks respect the product's sensitivity flags",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "This is what makes dim_finance_product.cancellation_sensitive and "
                "chargeback_sensitive behavioural rather than decorative. A cancellation "
                "on a product the catalogue says cannot be cancelled means one of the two "
                "is lying, and a reader cannot tell which."
            ),
            applies_to=(_WAREHOUSE_FACT, "warehouse.dim_finance_product"),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_SOURCE_SYSTEM,
            check_name="finance_product_adjustment.source_system is the synthetic generator",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "The lineage marker that stops a synthetic chargeback distribution being "
                "read as an observed loss rate."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
        CheckDefinition(
            check_id=CHECK_FPA_NO_PROHIBITED_PII,
            check_name="finance_product_adjustment declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            description=(
                "A cancellation record in a real store carries a reason somebody typed. "
                "ARPI's carries a governed category and nothing else, and the schema check "
                "is what keeps a free-text note column from ever being added."
            ),
            applies_to=(_WAREHOUSE_FACT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_finance_product_adjustment_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-FPA-001`` through ``DQ-FPA-013`` against the adjustment entity.

    Args:
        dataset: The generated ``finance_product_adjustment`` dataset.
        config: Resolved configuration, used to rebuild the contracts independently.
        catalogue_path: Explicit vehicle model catalogue path.

    Returns:
        A report containing thirteen results, in check-id order.
    """
    frame = dataset.frame
    contracts = {
        record.product_sale_id: record
        for record in build_finance_product_sale_records(config, catalogue_path)
    }
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "adjustment_id",
                check_id=CHECK_FPA_UNIQUE_ID,
                check_name="finance_product_adjustment.adjustment_id is unique",
                target_object=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            ),
            check_column_schema(
                frame,
                ADJUSTMENT_COLUMNS,
                check_id=CHECK_FPA_SCHEMA_MATCHES,
                check_name="finance_product_adjustment matches its declared column contract",
                target_object=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            ),
            _check_contract_resolves(frame, contracts),
            _check_not_before_sale(frame, contracts),
            _check_type_domain(frame),
            _check_sign_convention(frame),
            _check_cumulative_cap(frame, contracts),
            _check_reinstatement_integrity(frame, contracts),
            _check_reason_vocabulary(frame),
            _check_context_matches(frame, contracts),
            _check_sensitivity_respected(frame, contracts),
            _check_source_system(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_FPA_NO_PROHIBITED_PII,
                check_name=(
                    "finance_product_adjustment declares no prohibited personal-data column"
                ),
                target_object=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
            ),
        )
    )


def _base(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
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


def _sequences(
    frame: pd.DataFrame,
) -> dict[str, list[tuple[date, int, str, Decimal]]]:
    """Group the frame into per-contract event sequences, ordered by date then ordinal."""
    grouped: dict[str, list[tuple[date, int, str, Decimal]]] = {}
    for product_sale_id, adjustment_date, ordinal, adjustment_type, amount in zip(
        frame["product_sale_id"],
        frame["adjustment_date"],
        frame["sequence_ordinal"],
        frame["adjustment_type"],
        frame["adjustment_amount"],
        strict=True,
    ):
        grouped.setdefault(str(product_sale_id), []).append(
            (
                pd.Timestamp(adjustment_date).date(),
                int(ordinal),
                str(adjustment_type),
                Decimal(str(amount)),
            )
        )
    for events in grouped.values():
        events.sort(key=lambda item: (item[0], item[1]))
    return grouped


def _check_contract_resolves(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-003`` -- no adjustment is an orphan."""
    base = _base(
        CHECK_FPA_CONTRACT_RESOLVES,
        "every adjustment resolves to an existing product contract",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending = [
        f"{adjustment_id}: contract {product_sale_id} does not exist"
        for adjustment_id, product_sale_id in zip(
            frame["adjustment_id"], frame["product_sale_id"], strict=True
        )
        if str(product_sale_id) not in contracts
    ]
    return _fail(base, offending, "adjustment(s) reference a contract that does not exist")


def _check_not_before_sale(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-004`` -- no adjustment predates its contract."""
    base = _base(
        CHECK_FPA_NOT_BEFORE_SALE,
        "no adjustment predates the contract it adjusts",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for adjustment_id, product_sale_id, adjustment_date in zip(
        frame["adjustment_id"], frame["product_sale_id"], frame["adjustment_date"], strict=True
    ):
        contract = contracts.get(str(product_sale_id))
        if contract is None:
            continue
        posted = pd.Timestamp(adjustment_date).date()
        if posted < contract.sale_date:
            offending.append(
                f"{adjustment_id}: posted {posted.isoformat()} before the contract was "
                f"written on {contract.sale_date.isoformat()}"
            )
    return _fail(base, offending, "adjustment(s) predate their own contract")


def _check_type_domain(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPA-005`` -- every type is governed."""
    base = _base(
        CHECK_FPA_TYPE_DOMAIN,
        "adjustment_type is one of the four governed event types",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    unknown = sorted(
        {str(value) for value in frame["adjustment_type"] if str(value) not in ADJUSTMENT_TYPES}
    )
    if not unknown:
        return base
    return base.failed(
        f"Unknown adjustment type(s): {', '.join(unknown)}. The governed vocabulary is "
        f"{', '.join(ADJUSTMENT_TYPES)}.",
        observed_value=float(len(unknown)),
        failed_record_count=len(unknown),
    )


def _check_sign_convention(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPA-006`` -- each type moves net gross in its declared direction."""
    base = _base(
        CHECK_FPA_SIGN_CONVENTION,
        "each adjustment type moves net gross in its declared direction",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for adjustment_id, adjustment_type, amount in zip(
        frame["adjustment_id"], frame["adjustment_type"], frame["adjustment_amount"], strict=True
    ):
        required = ADJUSTMENT_SIGN_CONVENTION.get(str(adjustment_type))
        value = Decimal(str(amount))
        if required == "positive" and value <= 0:
            offending.append(f"{adjustment_id}: {adjustment_type} carries {value}, must reduce")
        elif required == "negative" and value >= 0:
            offending.append(f"{adjustment_id}: {adjustment_type} carries {value}, must restore")
        elif required is None and value == 0:
            offending.append(f"{adjustment_id}: {adjustment_type} carries 0.00, which is no event")
    return _fail(base, offending, "adjustment(s) breach the governed sign convention")


def _check_cumulative_cap(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-007`` -- the running reduction stays inside its bounds after every event."""
    base = _base(
        CHECK_FPA_CUMULATIVE_CAP,
        "cumulative net reduction stays inside [0, original product gross]",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_sale_id, events in _sequences(frame).items():
        contract = contracts.get(product_sale_id)
        if contract is None:
            continue
        original = contract.original_product_gross
        cumulative = _ZERO
        for posted, ordinal, adjustment_type, amount in events:
            cumulative += amount
            if cumulative < _ZERO:
                offending.append(
                    f"{product_sale_id} step {ordinal} ({adjustment_type} on "
                    f"{posted.isoformat()}): cumulative {cumulative} restores more than was taken"
                )
                break
            if cumulative > original:
                offending.append(
                    f"{product_sale_id} step {ordinal} ({adjustment_type} on "
                    f"{posted.isoformat()}): cumulative {cumulative} exceeds original {original}"
                )
                break
    return _fail(base, offending, "contract(s) breach the cumulative adjustment cap")


def _check_reinstatement_integrity(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-008`` -- a reinstatement follows a reduction and never exceeds it."""
    base = _base(
        CHECK_FPA_REINSTATEMENT_INTEGRITY,
        "a reinstatement follows a reduction and never exceeds it",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for product_sale_id, events in _sequences(frame).items():
        if contracts.get(product_sale_id) is None:
            continue
        cumulative = _ZERO
        for posted, ordinal, adjustment_type, amount in events:
            if adjustment_type == ADJUSTMENT_TYPE_REINSTATEMENT:
                if cumulative <= _ZERO:
                    offending.append(
                        f"{product_sale_id} step {ordinal} on {posted.isoformat()}: "
                        "reinstatement with no prior reduction to reinstate"
                    )
                    break
                if -amount > cumulative:
                    offending.append(
                        f"{product_sale_id} step {ordinal} on {posted.isoformat()}: "
                        f"reinstatement of {-amount} exceeds the {cumulative} reduced"
                    )
                    break
            cumulative += amount
    return _fail(base, offending, "contract(s) carry an invalid reinstatement sequence")


def _check_reason_vocabulary(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPA-009`` -- the reason is governed and belongs to its type."""
    base = _base(
        CHECK_FPA_REASON_VOCABULARY,
        "the reason category is governed and belongs to its adjustment type",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for adjustment_id, adjustment_type, reason in zip(
        frame["adjustment_id"],
        frame["adjustment_type"],
        frame["adjustment_reason_category"],
        strict=True,
    ):
        if str(reason) not in ADJUSTMENT_REASON_CATEGORY_VALUES:
            offending.append(f"{adjustment_id}: reason {reason!r} is not governed")
            continue
        permitted = ADJUSTMENT_REASON_CATEGORIES.get(str(adjustment_type), ())
        if str(reason) not in permitted:
            offending.append(
                f"{adjustment_id}: reason {reason!r} does not belong to {adjustment_type}"
            )
    return _fail(base, offending, "adjustment(s) carry an ungoverned or mismatched reason")


def _check_context_matches(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-010`` -- the denormalised context agrees with the adjusted contract."""
    base = _base(
        CHECK_FPA_CONTEXT_MATCHES_CONTRACT,
        "store, manager, product and deal match the adjusted contract",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for adjustment_id, product_sale_id, sale_id, store, manager, product_id, category in zip(
        frame["adjustment_id"],
        frame["product_sale_id"],
        frame["sale_id"],
        frame["dealership_id"],
        frame["finance_manager_id"],
        frame["finance_product_id"],
        frame["product_category"],
        strict=True,
    ):
        contract = contracts.get(str(product_sale_id))
        if contract is None:
            continue
        observed_manager = None if manager is None or pd.isna(manager) else str(manager)
        mismatches = {
            "sale_id": str(sale_id) != contract.sale_id,
            "dealership_id": str(store) != contract.dealership_id,
            "finance_manager_id": observed_manager != contract.finance_manager_id,
            "finance_product_id": str(product_id) != contract.finance_product_id,
            "product_category": str(category) != contract.product_category,
        }
        broken = sorted(name for name, wrong in mismatches.items() if wrong)
        if broken:
            offending.append(f"{adjustment_id}: {', '.join(broken)} disagree with the contract")
    return _fail(base, offending, "adjustment(s) disagree with their own contract")


def _check_sensitivity_respected(frame: pd.DataFrame, contracts: dict[str, Any]) -> CheckResult:
    """``DQ-FPA-011`` -- the catalogue's sensitivity flags actually govern the events."""
    base = _base(
        CHECK_FPA_SENSITIVITY_RESPECTED,
        "cancellations and chargebacks respect the product's sensitivity flags",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    for adjustment_id, product_sale_id, adjustment_type in zip(
        frame["adjustment_id"], frame["product_sale_id"], frame["adjustment_type"], strict=True
    ):
        contract = contracts.get(str(product_sale_id))
        if contract is None:
            continue
        if (
            str(adjustment_type) == ADJUSTMENT_TYPE_CANCELLATION
            and not contract.cancellation_sensitive
        ):
            offending.append(
                f"{adjustment_id}: cancellation on {contract.finance_product_id}, which the "
                "catalogue says cannot be cancelled"
            )
        if str(adjustment_type) == ADJUSTMENT_TYPE_CHARGEBACK and not contract.chargeback_sensitive:
            offending.append(
                f"{adjustment_id}: chargeback on {contract.finance_product_id}, which the "
                "catalogue says carries no chargeback exposure"
            )
    return _fail(base, offending, "adjustment(s) contradict the catalogue's sensitivity flags")


def _check_source_system(frame: pd.DataFrame) -> CheckResult:
    """``DQ-FPA-012`` -- the lineage marker is present on every row."""
    base = _base(
        CHECK_FPA_SOURCE_SYSTEM,
        "finance_product_adjustment.source_system is the synthetic generator",
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
