"""Generator for the ``inventory_snapshot_event`` source entity.

Grain: **one row per vehicle per dealership per day, while the vehicle is genuinely
in stock**. This is the source entity behind
``warehouse.fact_vehicle_inventory_snapshot``, the only periodic-snapshot fact in the
Phase 1 model.

Nothing here is drawn at random. Every value is *derived* from two entities that were
already generated:

* :mod:`arpi.generation.acquisition` says when a unit entered stock, what it cost, what
  it was reconditioned for and what it was first advertised at.
* :func:`arpi.generation.sale.disposition_dates` says when it left. A vehicle absent
  from that mapping never sold inside the reporting window and is therefore still in
  stock on the last day of it.

A generator with no random draws is deliberate: an inventory snapshot is a *restatement*
of facts that already exist, and drawing it independently would let the snapshot
disagree with the acquisition and the sale it is derived from. The module therefore
consumes no seeded stream at all, and adding it cannot perturb any other entity's
content digest.

Why the window is clipped
-------------------------
``dim_date`` covers the reporting window and nothing else, so a snapshot dated before
``reporting.start_date`` could not resolve a date key and would be rejected at load
time. Acquisitions may precede the window by up to
:data:`~arpi.generation.acquisition.ACQUISITION_WARM_UP_DAYS` days, and that warm-up is
the whole point: a unit acquired 140 days before the window opens shows up on day one
already 140 days old, in the ``Over 120`` bucket. **The age is measured from the
acquisition date, not from the first snapshot date** -- clipping the emitted dates does
not reset the clock.

What "no row" means
-------------------
The absence of a row *is* the representation of "not in inventory". A sold unit stops
appearing on its disposition date; it never appears with zeroed measures. The last
snapshot of a unit sold on day ``d`` is therefore dated ``d - 1``.

Money
-----
Every monetary value is a :class:`decimal.Decimal` carried through unrounded from the
acquisition, and ``inventory_investment`` is ``acquisition_cost + reconditioning_cost``
exactly -- the database enforces that identity as a CHECK constraint, so an approximate
cent here is a load failure rather than a silent inaccuracy.

Volume
------
The row count is roughly *units in stock x days in the window*. At the ``development``
profile it is about 46,000 rows; the contract's ceiling is 200,000. At ``portfolio``
scale (9,000 vehicles over a two-year window) it would be far larger, which is one more
reason ``portfolio`` is never generated in CI.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.generation.acquisition import (
    AcquisitionRecord,
    build_acquisition_records,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.sale import (
    MARKDOWN_INTERVAL_DAYS,
    MAXIMUM_MARKDOWN_STEPS,
    disposition_dates,
    markdown_to_asking_price,
)
from arpi.logging_config import get_logger
from arpi.validation.checks import check_column_schema
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Iterator, Mapping, Sequence
    from pathlib import Path

    from arpi.config import ArpiConfig

_LOGGER = get_logger(__name__)

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
#: Source entity produced by this module; it feeds ``fact_vehicle_inventory_snapshot``.
ENTITY_INVENTORY_SNAPSHOT_EVENT: Final = "inventory_snapshot_event"

#: Seeding namespace reserved for this entity. It is declared for traceability and for
#: symmetry with every other generator, but no stream is ever drawn from it: this entity
#: is derived, not drawn.
INVENTORY_SNAPSHOT_NAMESPACE: Final = "inventory_snapshot_event"

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
#: The declared columns, mirroring ``warehouse.fact_vehicle_inventory_snapshot`` minus
#: the surrogate keys and using natural identifiers and a real date.
INVENTORY_SNAPSHOT_EVENT_COLUMNS: Final[tuple[str, ...]] = (
    "snapshot_date",
    "dealership_id",
    "vehicle_id",
    "vehicle_model_id",
    "current_asking_price",
    "original_asking_price",
    "msrp",
    "acquisition_cost",
    "reconditioning_cost",
    "inventory_investment",
    "days_in_stock",
    "age_bucket",
    "markdown_count_to_date",
    "inventory_unit_count",
    "source_system",
)

#: The declared grain, and the natural key the staging view deduplicates on.
INVENTORY_SNAPSHOT_GRAIN_COLUMNS: Final[tuple[str, ...]] = (
    "snapshot_date",
    "dealership_id",
    "vehicle_id",
)

#: ``msrp`` is the only nullable column: a used unit has no manufacturer sticker.
INVENTORY_SNAPSHOT_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in INVENTORY_SNAPSHOT_EVENT_COLUMNS if column != "msrp"
)

#: Monetary columns, all carried as :class:`decimal.Decimal` in an ``object`` column.
INVENTORY_SNAPSHOT_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "current_asking_price",
    "original_asking_price",
    "msrp",
    "acquisition_cost",
    "reconditioning_cost",
    "inventory_investment",
)

INVENTORY_SNAPSHOT_EVENT_DTYPES: Final[dict[str, str]] = {
    "snapshot_date": "datetime64[s]",
    "dealership_id": "string",
    "vehicle_id": "string",
    "vehicle_model_id": "string",
    "current_asking_price": "object",
    "original_asking_price": "object",
    "msrp": "object",
    "acquisition_cost": "object",
    "reconditioning_cost": "object",
    "inventory_investment": "object",
    "days_in_stock": "int32",
    "age_bucket": "string",
    "markdown_count_to_date": "int16",
    "inventory_unit_count": "int16",
    "source_system": "string",
}

# ---------------------------------------------------------------------------------------
# Aging bands
# ---------------------------------------------------------------------------------------
AGE_BUCKET_0_30: Final = "0-30"
AGE_BUCKET_31_60: Final = "31-60"
AGE_BUCKET_61_90: Final = "61-90"
AGE_BUCKET_91_120: Final = "91-120"
AGE_BUCKET_OVER_120: Final = "Over 120"

#: Inclusive upper bound of each band, in ascending order. Anything above the last bound
#: falls into :data:`AGE_BUCKET_OVER_120`. Stored on the fact so that every aging report
#: bands identically rather than each one re-deriving the boundaries.
AGE_BUCKET_LADDER: Final[tuple[tuple[int, str], ...]] = (
    (30, AGE_BUCKET_0_30),
    (60, AGE_BUCKET_31_60),
    (90, AGE_BUCKET_61_90),
    (120, AGE_BUCKET_91_120),
)

ALLOWED_AGE_BUCKETS: Final[tuple[str, ...]] = (
    AGE_BUCKET_0_30,
    AGE_BUCKET_31_60,
    AGE_BUCKET_61_90,
    AGE_BUCKET_91_120,
    AGE_BUCKET_OVER_120,
)

#: Every snapshot describes exactly one unit. Additive across vehicles on one date,
#: never across dates.
INVENTORY_UNIT_COUNT: Final = 1

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (prefix reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_SNAPSHOT_GRAIN_UNIQUE: Final = "DQ-INV-001"
CHECK_SNAPSHOT_SCHEMA_MATCHES: Final = "DQ-INV-002"
CHECK_SNAPSHOT_NOT_AFTER_DISPOSITION: Final = "DQ-INV-003"
CHECK_SNAPSHOT_DAYS_IN_STOCK: Final = "DQ-INV-004"
CHECK_SNAPSHOT_INVESTMENT_IDENTITY: Final = "DQ-INV-005"
CHECK_SNAPSHOT_AGE_BUCKET: Final = "DQ-INV-006"
CHECK_SNAPSHOT_NO_PROHIBITED_PII: Final = "DQ-INV-007"

#: Every check identifier this module emits, in identifier order.
INVENTORY_SNAPSHOT_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_SNAPSHOT_GRAIN_UNIQUE,
    CHECK_SNAPSHOT_SCHEMA_MATCHES,
    CHECK_SNAPSHOT_NOT_AFTER_DISPOSITION,
    CHECK_SNAPSHOT_DAYS_IN_STOCK,
    CHECK_SNAPSHOT_INVESTMENT_IDENTITY,
    CHECK_SNAPSHOT_AGE_BUCKET,
    CHECK_SNAPSHOT_NO_PROHIBITED_PII,
)

_SOURCE_INVENTORY_SNAPSHOT: Final = "source.inventory_snapshot_event"
_WAREHOUSE_FACT_SNAPSHOT: Final = "warehouse.fact_vehicle_inventory_snapshot"

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_GRAIN_UNIQUE,
            check_name="inventory snapshot holds one row per vehicle per store per day",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "The declared grain. A periodic snapshot that admits two rows for one "
                "vehicle on one day double-counts inventory investment, and nothing "
                "downstream would reveal it: both rows look entirely plausible."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT, _WAREHOUSE_FACT_SNAPSHOT),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_SCHEMA_MATCHES,
            check_name="inventory snapshot matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "so a reordered column would land an acquisition cost in an asking price."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT,),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_NOT_AFTER_DISPOSITION,
            check_name="no inventory snapshot exists on or after the disposition date",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "A sold unit leaves inventory. Snapshotting it afterwards would report "
                "money the group no longer has on the ground and would inflate every "
                "aging bucket with cars that are already on somebody's driveway."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT, _WAREHOUSE_FACT_SNAPSHOT),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_DAYS_IN_STOCK,
            check_name="days_in_stock is non-negative and rises by one per day per vehicle",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "Inventory age only ever moves forward. A negative or non-monotonic age "
                "would mean the snapshot was measured from the wrong origin, which is "
                "exactly the defect that makes a warm-up unit look new on day one."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT, _WAREHOUSE_FACT_SNAPSHOT),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_INVESTMENT_IDENTITY,
            check_name="inventory_investment equals acquisition_cost plus reconditioning_cost",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "A stored derived measure that can disagree with its inputs is the most "
                "common way a dashboard lies. The identity is exact to the cent here and "
                "is a CHECK constraint in the warehouse, so the two cannot drift."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT, _WAREHOUSE_FACT_SNAPSHOT),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_AGE_BUCKET,
            check_name="age_bucket agrees with days_in_stock",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "The band is stored so every aging report bands identically. A band that "
                "disagrees with the age it was derived from silently moves money between "
                "buckets on the one report a used-car manager runs daily."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT, _WAREHOUSE_FACT_SNAPSHOT),
        ),
        CheckDefinition(
            check_id=CHECK_SNAPSHOT_NO_PROHIBITED_PII,
            check_name="inventory snapshot declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            description=(
                "The snapshot is about metal, not people, and must stay that way. The "
                "check inspects the schema, so an empty prohibited column still fails "
                "the run."
            ),
            applies_to=(_SOURCE_INVENTORY_SNAPSHOT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class InventorySnapshotRecord:
    """One vehicle's inventory position on one day at one store.

    Attributes:
        snapshot_date: The as-of date. Always inside the reporting window.
        dealership_id: Store holding the unit.
        vehicle_id: The unit.
        vehicle_model_id: Natural key of the unit's model, denormalised so a
            model-level aging report needs no second join.
        current_asking_price: Advertised price on this date, after age-driven markdowns.
        original_asking_price: The first advertised price.
        msrp: Manufacturer's suggested retail price, or ``None`` for a used unit.
        acquisition_cost: What the store paid.
        reconditioning_cost: Reconditioning spend booked against the unit.
        inventory_investment: ``acquisition_cost + reconditioning_cost``, exactly.
        days_in_stock: Days since acquisition, measured from the acquisition date and
            not from the first snapshot date.
        age_bucket: Banded ``days_in_stock``; see :data:`ALLOWED_AGE_BUCKETS`.
        markdown_count_to_date: Price reductions taken so far, never decreasing.
        inventory_unit_count: Always 1.
    """

    snapshot_date: date
    dealership_id: str
    vehicle_id: str
    vehicle_model_id: str
    current_asking_price: Decimal
    original_asking_price: Decimal
    msrp: Decimal | None
    acquisition_cost: Decimal
    reconditioning_cost: Decimal
    inventory_investment: Decimal
    days_in_stock: int
    age_bucket: str
    markdown_count_to_date: int
    inventory_unit_count: int


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def age_bucket_for(days_in_stock: int) -> str:
    """Return the aging band a unit falls into.

    Args:
        days_in_stock: Days since acquisition, as at the snapshot date.

    Returns:
        One of :data:`ALLOWED_AGE_BUCKETS`.
    """
    for upper_bound, bucket in AGE_BUCKET_LADDER:
        if days_in_stock <= upper_bound:
            return bucket
    return AGE_BUCKET_OVER_120


def markdown_count_for(days_in_stock: int) -> int:
    """Return the number of price reductions a unit has taken by a given age.

    Uses exactly the schedule :func:`arpi.generation.sale.markdown_to_asking_price`
    applies, so a unit's advertised price on its last snapshot and the ``final_asking_price``
    on its sale are computed from the same number of steps rather than from two
    independent rules that could disagree.

    Args:
        days_in_stock: Days since acquisition, as at the snapshot date.

    Returns:
        A count between zero and
        :data:`~arpi.generation.sale.MAXIMUM_MARKDOWN_STEPS`, non-decreasing in
        ``days_in_stock``.
    """
    return min(max(days_in_stock, 0) // MARKDOWN_INTERVAL_DAYS, MAXIMUM_MARKDOWN_STEPS)


def snapshot_span(
    acquisition_date: date,
    disposition_date: date | None,
    *,
    window_start: date,
    window_end: date,
) -> tuple[date, date] | None:
    """Return the inclusive dates one unit is snapshotted on, or ``None`` for none.

    The span opens on the acquisition date and closes the day *before* disposition,
    because the absence of a row is how "no longer in inventory" is represented. Both
    ends are then clipped to the reporting window: ``dim_date`` covers that window and
    nothing else, so a snapshot outside it could not resolve a date key.

    Args:
        acquisition_date: When the unit entered stock; may precede ``window_start``.
        disposition_date: When it left, or ``None`` when it never sold in the window.
        window_start: First day of the reporting window.
        window_end: Last day of the reporting window.

    Returns:
        ``(first, last)`` inclusive, or ``None`` when the unit is never in stock on a
        reportable day -- a unit acquired and sold on the same day, for instance.
    """
    first = max(acquisition_date, window_start)
    last = window_end if disposition_date is None else disposition_date - timedelta(days=1)
    last = min(last, window_end)
    if last < first:
        return None
    return first, last


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
def build_inventory_snapshot_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[InventorySnapshotRecord, ...]:
    """Build every daily inventory snapshot for the active profile.

    Args:
        config: Resolved configuration supplying the reporting window, the master seed
            and the scale mode.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The snapshots, ordered by ``(snapshot_date, dealership_id, vehicle_id)`` -- the
        declared grain, so the ordering is both stable and the one a reviewer reading
        the CSV expects.
    """
    acquisitions = build_acquisition_records(config, catalogue_path)
    dispositions = disposition_dates(config, catalogue_path)
    records = sorted(
        _records_for_population(
            acquisitions,
            dispositions,
            window_start=config.reporting.start_date,
            window_end=config.reporting.end_date,
        ),
        key=lambda record: (record.snapshot_date, record.dealership_id, record.vehicle_id),
    )
    _log_declared_distributions(records, len(acquisitions))
    return tuple(records)


def _records_for_population(
    acquisitions: Sequence[AcquisitionRecord],
    dispositions: Mapping[str, date],
    *,
    window_start: date,
    window_end: date,
) -> Iterator[InventorySnapshotRecord]:
    """Yield every snapshot of every unit, unordered."""
    for acquisition in acquisitions:
        span = snapshot_span(
            acquisition.acquisition_date,
            dispositions.get(acquisition.vehicle_id),
            window_start=window_start,
            window_end=window_end,
        )
        if span is None:
            continue
        first, last = span
        for offset in range((last - first).days + 1):
            yield _record_for_day(acquisition, first + timedelta(days=offset))


def _record_for_day(acquisition: AcquisitionRecord, snapshot_date: date) -> InventorySnapshotRecord:
    """Build one unit's snapshot for one day."""
    days_in_stock = (snapshot_date - acquisition.acquisition_date).days
    return InventorySnapshotRecord(
        snapshot_date=snapshot_date,
        dealership_id=acquisition.dealership_id,
        vehicle_id=acquisition.vehicle_id,
        vehicle_model_id=acquisition.vehicle_model_id,
        current_asking_price=markdown_to_asking_price(
            acquisition.original_asking_price, days_in_stock, acquisition.condition_type
        ),
        original_asking_price=acquisition.original_asking_price,
        msrp=acquisition.msrp,
        acquisition_cost=acquisition.acquisition_cost,
        reconditioning_cost=acquisition.reconditioning_cost,
        # Exactly, not approximately: warehouse.fact_vehicle_inventory_snapshot enforces
        # this identity as a CHECK constraint.
        inventory_investment=acquisition.acquisition_cost + acquisition.reconditioning_cost,
        days_in_stock=days_in_stock,
        age_bucket=age_bucket_for(days_in_stock),
        markdown_count_to_date=markdown_count_for(days_in_stock),
        inventory_unit_count=INVENTORY_UNIT_COUNT,
    )


def snapshot_row(record: InventorySnapshotRecord) -> dict[str, Any]:
    """Render one snapshot record as its declared row.

    Args:
        record: The record to render.

    Returns:
        A mapping keyed by :data:`INVENTORY_SNAPSHOT_EVENT_COLUMNS`.
    """
    return {
        "snapshot_date": record.snapshot_date,
        "dealership_id": record.dealership_id,
        "vehicle_id": record.vehicle_id,
        "vehicle_model_id": record.vehicle_model_id,
        "current_asking_price": record.current_asking_price,
        "original_asking_price": record.original_asking_price,
        "msrp": record.msrp,
        "acquisition_cost": record.acquisition_cost,
        "reconditioning_cost": record.reconditioning_cost,
        "inventory_investment": record.inventory_investment,
        "days_in_stock": record.days_in_stock,
        "age_bucket": record.age_bucket,
        "markdown_count_to_date": record.markdown_count_to_date,
        "inventory_unit_count": record.inventory_unit_count,
        "source_system": SOURCE_SYSTEM,
    }


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class InventorySnapshotGenerator(BaseGenerator):
    """Build one ``inventory_snapshot_event`` row per vehicle per store per stocked day."""

    entity_name = ENTITY_INVENTORY_SNAPSHOT_EVENT
    declared_columns = INVENTORY_SNAPSHOT_EVENT_COLUMNS
    namespace = INVENTORY_SNAPSHOT_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the inventory snapshot frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 15 contract columns, in order, ordered by the declared
            grain.
        """
        records = build_inventory_snapshot_records(config)
        frame = pd.DataFrame.from_records(
            [snapshot_row(record) for record in records],
            columns=list(INVENTORY_SNAPSHOT_EVENT_COLUMNS),
        )
        return frame.astype(INVENTORY_SNAPSHOT_EVENT_DTYPES)


def generate_inventory_snapshot_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``inventory_snapshot_event`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return InventorySnapshotGenerator().generate(config)


def _log_declared_distributions(
    records: Sequence[InventorySnapshotRecord], vehicle_count: int
) -> None:
    """Log the row count and the aging mix actually produced."""
    total = len(records)
    if total == 0:  # pragma: no cover - the population is never empty in any profile
        return
    buckets: dict[str, int] = {}
    for record in records:
        buckets[record.age_bucket] = buckets.get(record.age_bucket, 0) + 1
    _LOGGER.info(
        "inventory_snapshot_event distributions: rows=%d vehicles=%d rows_per_vehicle=%.2f "
        "age_bucket=%s",
        total,
        vehicle_count,
        total / vehicle_count if vehicle_count else 0.0,
        {bucket: round(count / total, 4) for bucket, count in sorted(buckets.items())},
    )


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_inventory_snapshot_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-INV-001`` through ``DQ-INV-007`` against the inventory snapshot source.

    Args:
        dataset: The generated ``inventory_snapshot_event`` dataset.
        config: Resolved configuration, used to rebuild the disposition mapping the
            snapshots must stop at.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A report containing seven results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            _check_grain_is_unique(frame),
            check_column_schema(
                frame,
                INVENTORY_SNAPSHOT_EVENT_COLUMNS,
                check_id=CHECK_SNAPSHOT_SCHEMA_MATCHES,
                check_name="inventory snapshot matches its declared column contract",
                target_object=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            ),
            _check_not_after_disposition(frame, disposition_dates(config, catalogue_path)),
            _check_days_in_stock(frame),
            _check_investment_identity(frame),
            _check_age_bucket(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_SNAPSHOT_NO_PROHIBITED_PII,
                check_name="inventory snapshot declares no prohibited personal-data column",
                target_object=ENTITY_INVENTORY_SNAPSHOT_EVENT,
            ),
        )
    )


def _base_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_INVENTORY_SNAPSHOT_EVENT,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _as_date(value: Any) -> date:
    """Coerce a frame cell holding a date or timestamp to a plain :class:`datetime.date`."""
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, date):
        return value
    return pd.Timestamp(value).date()


def _check_grain_is_unique(frame: pd.DataFrame) -> CheckResult:
    """``DQ-INV-001`` -- one row per vehicle per store per snapshot date."""
    base = _base_result(
        CHECK_SNAPSHOT_GRAIN_UNIQUE,
        "inventory snapshot holds one row per vehicle per store per day",
        CHECK_CATEGORY_UNIQUENESS,
    )
    missing = [column for column in INVENTORY_SNAPSHOT_GRAIN_COLUMNS if column not in frame.columns]
    if missing:
        return base.failed(
            f"{ENTITY_INVENTORY_SNAPSHOT_EVENT} is missing grain column(s): {', '.join(missing)}."
        )
    duplicates = int(frame.duplicated(subset=list(INVENTORY_SNAPSHOT_GRAIN_COLUMNS)).sum())
    result = replace(base, observed_value=float(duplicates))
    if duplicates == 0:
        return result
    return result.failed(
        f"{duplicates} row(s) repeat the declared grain "
        f"{INVENTORY_SNAPSHOT_GRAIN_COLUMNS}. A repeated grain double-counts inventory "
        "investment on the day it repeats.",
        failed_record_count=duplicates,
    )


def _check_not_after_disposition(
    frame: pd.DataFrame, dispositions: Mapping[str, date]
) -> CheckResult:
    """``DQ-INV-003`` -- no snapshot exists on or after a unit's disposition date."""
    base = _base_result(
        CHECK_SNAPSHOT_NOT_AFTER_DISPOSITION,
        "no inventory snapshot exists on or after the disposition date",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = [
        f"{vehicle_id}@{_as_date(snapshot_date).isoformat()}"
        for vehicle_id, snapshot_date in zip(
            frame["vehicle_id"], frame["snapshot_date"], strict=True
        )
        if (disposed := dispositions.get(str(vehicle_id))) is not None
        and _as_date(snapshot_date) >= disposed
    ]
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} snapshot(s) are dated on or after their vehicle's disposition "
        f"date, for example {', '.join(sorted(offending)[:5])}. A sold unit leaves "
        "inventory; the absence of a row is how that is represented.",
        failed_record_count=len(offending),
    )


def _check_days_in_stock(frame: pd.DataFrame) -> CheckResult:
    """``DQ-INV-004`` -- age is non-negative and rises by exactly one day per day."""
    base = _base_result(
        CHECK_SNAPSHOT_DAYS_IN_STOCK,
        "days_in_stock is non-negative and rises by one per day per vehicle",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    negative = int((frame["days_in_stock"] < 0).sum())
    ordered = frame.sort_values(["vehicle_id", "snapshot_date"])
    ages = ordered["days_in_stock"].astype("int64")
    same_vehicle = ordered["vehicle_id"].eq(ordered["vehicle_id"].shift())
    # Within one vehicle's run of snapshots the age must move forward by exactly the
    # number of days that elapsed. Comparing against the elapsed days rather than merely
    # asserting "not smaller" catches an age that was reset to the first snapshot date.
    elapsed = (
        ordered["snapshot_date"].diff().dt.days.fillna(0).astype("int64")
        if pd.api.types.is_datetime64_any_dtype(ordered["snapshot_date"])
        else pd.Series(0, index=ordered.index, dtype="int64")
    )
    drift = int((same_vehicle & (ages.diff().fillna(0).astype("int64") != elapsed)).sum())
    offending = negative + drift
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{negative} snapshot(s) carry a negative days_in_stock and {drift} do not "
        "advance in step with the calendar. Inventory age is measured from the "
        "acquisition date and only ever moves forward.",
        failed_record_count=offending,
    )


def _check_investment_identity(frame: pd.DataFrame) -> CheckResult:
    """``DQ-INV-005`` -- ``inventory_investment`` is exactly the sum of its two inputs."""
    base = _base_result(
        CHECK_SNAPSHOT_INVESTMENT_IDENTITY,
        "inventory_investment equals acquisition_cost plus reconditioning_cost",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = sum(
        1
        for investment, cost, reconditioning in zip(
            frame["inventory_investment"],
            frame["acquisition_cost"],
            frame["reconditioning_cost"],
            strict=True,
        )
        if Decimal(str(investment)) != Decimal(str(cost)) + Decimal(str(reconditioning))
    )
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{offending} snapshot(s) carry an inventory_investment that is not exactly "
        "acquisition_cost + reconditioning_cost. The warehouse enforces the identity as "
        "a CHECK constraint, so these rows would fail the load rather than load wrong.",
        failed_record_count=offending,
    )


def _check_age_bucket(frame: pd.DataFrame) -> CheckResult:
    """``DQ-INV-006`` -- the stored band is the band its own age falls into."""
    base = _base_result(
        CHECK_SNAPSHOT_AGE_BUCKET,
        "age_bucket agrees with days_in_stock",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = sum(
        1
        for days, bucket in zip(frame["days_in_stock"], frame["age_bucket"], strict=True)
        if str(bucket) != age_bucket_for(int(days))
    )
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{offending} snapshot(s) carry an age_bucket that disagrees with their "
        "days_in_stock. A stored band that contradicts its own input silently moves "
        "money between aging buckets.",
        failed_record_count=offending,
    )
