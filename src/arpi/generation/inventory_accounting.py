"""Generator for ``warehouse.fact_inventory_accounting_snapshot`` -- the book, not the lot.

WHAT THIS ENTITY IS
-------------------
One row per carried vehicle, per store, per **accounting snapshot date**, carrying what
the unit is worth *on the books* and what the store owes against it. It is the first
accounting domain in ARPI and it is promoted by delivery increment ``DASH.8``.

ARPI IS BUILDING A FOCUSED INVENTORY CONTROL SCHEDULE. IT IS NOT BUILDING A GENERAL
LEDGER. There is no journal, no posting, no trial balance, no financial statement, and
there will not be one. What exists is the schedule a controller reconciles against a
handful of inventory control accounts, and the reconciliation itself.

SIX CONCEPTS THAT ARE NOT THE SAME NUMBER
-----------------------------------------
The single most available way to get this domain wrong is to collapse these into one
"inventory cost". They are kept apart here, in the DDL, in the reporting views and in
the tests:

  inventory book value       what the unit is carried at, on the asset side
  floorplan principal        what is owed against it, on the liability side
  GL control balance         what the control account says, independently
  front-gross cost basis     what the sale's gross calculation deducts
  reconciliation variance    GL minus subledger, signed
  data-quality exception     a record that is structurally wrong

THE BOOK-VALUE IDENTITY, EXACTLY
--------------------------------
::

    current_book_value = acquisition_cost
                       + capitalized_transportation
                       + capitalized_reconditioning
                       + capitalized_accessories
                       + other_capitalized_costs
                       - write_down_amount

Exact ``Decimal`` throughout. No float reaches this module, and the warehouse enforces
the identity as a CHECK constraint so a defect cannot survive a load.

**Pack is not in it.** Pack is a front-gross deduction (``KPI-GRS-001``) and an internal
allocation, not a capitalized cost of the vehicle. Moving it into book value would
redefine the front-gross identity on every deal, which ``DASH.8`` is forbidden to touch.

**Floorplan principal is not in it either.** It is a liability position. It is never
added, never subtracted, and never netted against inventory value to manufacture a "net
inventory" figure that means nothing. A unit with ``floorplan_principal = 0.00`` is an
owned, unfloored unit -- a legitimate synthetic position, not missing data.

ONE SOURCE OF TRUTH FOR THE ECONOMICS
-------------------------------------
The accounting schedule does **not** invent a second acquisition cost. It is built from
the same :func:`build_acquisition_records` sequence and the same :func:`snapshot_span`
that ``arpi.generation.inventory_snapshot`` uses, so:

  * ``acquisition_cost`` is the acquisition event's own figure, to the cent;
  * ``capitalized_reconditioning`` is the acquisition event's own reconditioning spend;
  * the carried population matches the operational inventory population exactly, at
    every matched date, which is what makes the missing-row exception classes mean
    something rather than being an artefact of two different populations.

The accounting book value may still legitimately differ from the sale's front-gross cost
basis, because the schedule capitalizes freight, accessories and certification that the
gross formula does not deduct. That difference is real and documented; it is not a
discrepancy to be smoothed away.

MONTH-END, NOT DAILY
--------------------
Operational inventory is snapshotted every day. The accounting schedule is produced at
**month end**, which is when a controller actually reconciles a control account, and
every month-end date is already a day in the inventory calendar -- so the two populations
are comparable at matched dates without inventing an accounting calendar of its own.

NO FUTURE-OUTCOME LEAKAGE
-------------------------
Nothing here may depend on what eventually happened to the unit. Control-account
classification comes from ``condition_type``, which is a property of the vehicle;
write-downs come from days in stock, which is knowable on the snapshot date; floorplan
state comes from the acquisition source and the store. None of them consults the sale.

The unit's carrying SPAN is bounded by its disposition date, exactly as the operational
inventory fact already bounds it -- that is the population, not a classification, and a
schedule that kept booking a car after it was sold would be the defect.
``tests/unit/test_inventory_accounting_generation.py`` walks this module's import graph
and asserts no path reaches the sale generator.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

import pandas as pd

from arpi.config import ArpiConfig
from arpi.constants import CONDITION_TO_CONTROL_CATEGORY
from arpi.generation.acquisition import AcquisitionRecord, build_acquisition_records
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.inventory_snapshot import snapshot_span
from arpi.generation.sale import disposition_dates
from arpi.utilities.seeding import rng_for

LOGGER: Final = logging.getLogger(__name__)

ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT: Final = "inventory_accounting_snapshot"
INVENTORY_ACCOUNTING_NAMESPACE: Final = "inventory_accounting"
ACCOUNTING_ID_DIGITS: Final = 8
ACCOUNTING_SOURCE_SYSTEM: Final = "SYNTHETIC-DMS-ACCOUNTING"

#: The last month of a calendar year, named so the month-end walk reads as a calendar
#: rule rather than as an unexplained integer.
DECEMBER: Final = 12

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
INVENTORY_ACCOUNTING_COLUMNS: Final[tuple[str, ...]] = (
    "inventory_accounting_id",
    "dealership_id",
    "vehicle_id",
    "accounting_date",
    "acquisition_date",
    "control_account_category",
    "acquisition_cost",
    "capitalized_transportation",
    "capitalized_reconditioning",
    "capitalized_accessories",
    "other_capitalized_costs",
    "write_down_amount",
    "current_book_value",
    "floorplan_principal",
    "days_in_stock",
    "source_system",
)

INVENTORY_ACCOUNTING_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "acquisition_cost",
    "capitalized_transportation",
    "capitalized_reconditioning",
    "capitalized_accessories",
    "other_capitalized_costs",
    "write_down_amount",
    "current_book_value",
    "floorplan_principal",
)

INVENTORY_ACCOUNTING_DTYPES: Final[dict[str, str]] = {
    "inventory_accounting_id": "string",
    "dealership_id": "string",
    "vehicle_id": "string",
    "accounting_date": "datetime64[s]",
    "acquisition_date": "datetime64[s]",
    "control_account_category": "string",
    "acquisition_cost": "object",
    "capitalized_transportation": "object",
    "capitalized_reconditioning": "object",
    "capitalized_accessories": "object",
    "other_capitalized_costs": "object",
    "write_down_amount": "object",
    "current_book_value": "object",
    "floorplan_principal": "object",
    "days_in_stock": "int32",
    "source_system": "string",
}

# ---------------------------------------------------------------------------------------
# Capitalization policy -- declared once, here
# ---------------------------------------------------------------------------------------
#: Inbound freight, by acquisition source.
#:
#: A unit the store bought at auction or took on a dealer trade was transported in, and a
#: factory allocation arrives on a truck whose freight the store capitalizes. A customer
#: trade, an off-street purchase and a lease return are DRIVEN IN: there is no freight to
#: capitalize, and a nonzero figure there would be invented complexity. Zero is the honest
#: value for those three, and it is a modelled zero rather than an absence.
TRANSPORTATION_BY_SOURCE: Final[Mapping[str, Decimal]] = {
    "Manufacturer Allocation": Decimal("895.00"),
    "Auction": Decimal("450.00"),
    "Dealer Trade": Decimal("325.00"),
    "Customer Trade": Decimal("0.00"),
    "Off-street Purchase": Decimal("0.00"),
    "Lease Return": Decimal("0.00"),
}

#: The certification inspection a certified pre-owned unit carries, capitalized.
#:
#: This is the only ``other_capitalized_costs`` the model populates, and it is the reason
#: Certified is its own control account rather than a label on a used car: the unit
#: genuinely carries a cost the others do not.
CERTIFICATION_COST: Final = Decimal("425.00")

#: Accessories are fitted to a minority of units. Drawn deterministically per vehicle.
ACCESSORY_RATE: Final = 0.18
ACCESSORY_AMOUNTS: Final[tuple[Decimal, ...]] = (
    Decimal("249.00"),
    Decimal("395.00"),
    Decimal("575.00"),
    Decimal("880.00"),
)

#: Days in stock at which an aged unit is written down, and by how much.
#:
#: Knowable on the snapshot date from the acquisition date alone. A write-down is a
#: synthetic accounting adjustment against an aged unit -- it is NOT a market-value
#: estimate, and nothing in this project supports calling it one.
WRITE_DOWN_AGE_DAYS: Final = 120
WRITE_DOWN_RATE: Final = Decimal("0.04")

#: The share of eligible units carried on floorplan.
#:
#: New units are floored as a matter of course -- the factory allocation is financed on
#: arrival. Used units are floored on a deterministic subset; the rest are owned outright,
#: which is a real position and the reason ``floorplan_principal = 0.00`` must not be read
#: as missing.
USED_FLOORPLAN_RATE: Final = 0.62


def _cents(value: Decimal) -> Decimal:
    """Quantize to exact cents. Every monetary value in this module passes through here."""
    return value.quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class InventoryAccountingRecord:
    """One unit's accounting position on one accounting date."""

    inventory_accounting_id: str
    dealership_id: str
    vehicle_id: str
    accounting_date: date
    acquisition_date: date
    control_account_category: str
    acquisition_cost: Decimal
    capitalized_transportation: Decimal
    capitalized_reconditioning: Decimal
    capitalized_accessories: Decimal
    other_capitalized_costs: Decimal
    write_down_amount: Decimal
    current_book_value: Decimal
    floorplan_principal: Decimal
    days_in_stock: int
    source_system: str


def month_end_dates(window_start: date, window_end: date) -> tuple[date, ...]:
    """Every month-end inside the reporting window, ascending.

    The accounting calendar is a SUBSET of the inventory calendar rather than a calendar
    of its own, so a subledger balance and an operational snapshot are always comparable
    at a matched date.

    Args:
        window_start: First day of the reporting window.
        window_end: Last day of the reporting window.

    Returns:
        The last day of each month that falls wholly inside the window.
    """
    ends: list[date] = []
    cursor = date(window_start.year, window_start.month, 1)
    while cursor <= window_end:
        following = (
            date(cursor.year + 1, 1, 1)
            if cursor.month == DECEMBER
            else date(cursor.year, cursor.month + 1, 1)
        )
        month_end = following - timedelta(days=1)
        if window_start <= month_end <= window_end:
            ends.append(month_end)
        cursor = following
    return tuple(ends)


def control_category_for(condition_type: str) -> str:
    """The inventory control account a unit's condition schedules it to.

    Args:
        condition_type: ``New``, ``Used`` or ``Certified``.

    Returns:
        The governed control-account category.

    Raises:
        ValueError: On an unmodelled condition. A silent default would put a unit into
            the wrong control balance, which is worse than a failed run.
    """
    try:
        return CONDITION_TO_CONTROL_CATEGORY[condition_type]
    except KeyError as error:  # pragma: no cover - guarded by dim_vehicle's CHECK
        raise ValueError(
            f"no inventory control account is defined for condition {condition_type!r}; "
            "a unit may not be scheduled into a category that does not exist"
        ) from error


def accessories_for(vehicle_id: str, seed: int) -> Decimal:
    """The accessories capitalized on one unit, deterministically.

    Args:
        vehicle_id: The unit's stable business identifier.
        seed: The ARPI master seed.

    Returns:
        An exact amount, or ``0.00`` for the majority that carry none.
    """
    rng = rng_for(seed, f"{INVENTORY_ACCOUNTING_NAMESPACE}:accessories:{vehicle_id}")
    if rng.random() >= ACCESSORY_RATE:
        return Decimal("0.00")
    return rng.choice(ACCESSORY_AMOUNTS)


def floorplan_principal_for(
    acquisition: AcquisitionRecord, capitalized_base: Decimal, seed: int
) -> Decimal:
    """What is owed against one unit, if anything.

    A LIABILITY, and the caller must never add it to book value. Modelled as principal
    only: ARPI models no rate, no interest, no curtailment, no maturity and no lender
    terms, so nothing here can be read as floorplan cost analysis.

    Args:
        acquisition: The unit's acquisition event.
        capitalized_base: Acquisition cost, which is what a floorplan advance is drawn
            against. Reconditioning and freight are the store's own money.
        seed: The ARPI master seed.

    Returns:
        The principal outstanding, or ``0.00`` for an owned, unfloored unit.
    """
    if acquisition.condition_type == "New":
        return _cents(capitalized_base)
    rng = rng_for(seed, f"{INVENTORY_ACCOUNTING_NAMESPACE}:floorplan:{acquisition.vehicle_id}")
    if rng.random() >= USED_FLOORPLAN_RATE:
        return Decimal("0.00")
    return _cents(capitalized_base)


def write_down_for(acquisition_cost: Decimal, days_in_stock: int) -> Decimal:
    """The cumulative write-down carried at a given age.

    Knowable from the snapshot date and the acquisition date alone -- no sale, no eventual
    price, no disposal type. A unit younger than the threshold carries ``0.00``, and that
    zero is a modelled state rather than an absence.

    Args:
        acquisition_cost: The unit's acquisition cost.
        days_in_stock: Age at the accounting date.

    Returns:
        The cumulative write-down amount as at that date.
    """
    if days_in_stock < WRITE_DOWN_AGE_DAYS:
        return Decimal("0.00")
    return _cents(acquisition_cost * WRITE_DOWN_RATE)


def _record_for(
    acquisition: AcquisitionRecord, accounting_date: date, ordinal: int, seed: int
) -> InventoryAccountingRecord:
    """Build one unit's accounting position on one accounting date."""
    days_in_stock = (accounting_date - acquisition.acquisition_date).days
    transportation = _cents(TRANSPORTATION_BY_SOURCE[acquisition.acquisition_source])
    reconditioning = _cents(acquisition.reconditioning_cost)
    accessories = _cents(accessories_for(acquisition.vehicle_id, seed))
    other = _cents(
        CERTIFICATION_COST if acquisition.condition_type == "Certified" else Decimal("0.00")
    )
    acquisition_cost = _cents(acquisition.acquisition_cost)
    write_down = write_down_for(acquisition_cost, days_in_stock)
    book_value = _cents(
        acquisition_cost + transportation + reconditioning + accessories + other - write_down
    )
    return InventoryAccountingRecord(
        inventory_accounting_id=f"IAS-{ordinal:0{ACCOUNTING_ID_DIGITS}d}",
        dealership_id=acquisition.dealership_id,
        vehicle_id=acquisition.vehicle_id,
        accounting_date=accounting_date,
        acquisition_date=acquisition.acquisition_date,
        control_account_category=control_category_for(acquisition.condition_type),
        acquisition_cost=acquisition_cost,
        capitalized_transportation=transportation,
        capitalized_reconditioning=reconditioning,
        capitalized_accessories=accessories,
        other_capitalized_costs=other,
        write_down_amount=write_down,
        current_book_value=book_value,
        floorplan_principal=floorplan_principal_for(acquisition, acquisition_cost, seed),
        days_in_stock=days_in_stock,
        source_system=ACCOUNTING_SOURCE_SYSTEM,
    )


def _records_for_population(
    acquisitions: Sequence[AcquisitionRecord],
    dispositions: Mapping[str, date],
    accounting_dates: Sequence[date],
    *,
    window_start: date,
    window_end: date,
) -> Iterator[tuple[date, str, str, AcquisitionRecord]]:
    """Yield every (accounting date, unit) pair the store was carrying."""
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
        for accounting_date in accounting_dates:
            if first <= accounting_date <= last:
                yield (
                    accounting_date,
                    acquisition.dealership_id,
                    acquisition.vehicle_id,
                    acquisition,
                )


def build_inventory_accounting_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[InventoryAccountingRecord, ...]:
    """Build every accounting snapshot for the active profile.

    Args:
        config: Resolved configuration supplying the reporting window and the master seed.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The snapshots, ordered by the declared grain.
    """
    acquisitions = build_acquisition_records(config, catalogue_path)
    dispositions = disposition_dates(config, catalogue_path)
    accounting_dates = month_end_dates(config.reporting.start_date, config.reporting.end_date)
    carried = sorted(
        _records_for_population(
            acquisitions,
            dispositions,
            accounting_dates,
            window_start=config.reporting.start_date,
            window_end=config.reporting.end_date,
        ),
        key=lambda entry: (entry[0], entry[1], entry[2]),
    )
    records = tuple(
        _record_for(acquisition, accounting_date, ordinal, config.random_seed)
        for ordinal, (accounting_date, _, _, acquisition) in enumerate(carried, start=1)
    )
    LOGGER.info(
        "inventory accounting: %d snapshot(s) over %d accounting date(s)",
        len(records),
        len(accounting_dates),
    )
    return records


def accounting_row(record: InventoryAccountingRecord) -> dict[str, Any]:
    """Render one record as a contract-ordered row."""
    return {
        "inventory_accounting_id": record.inventory_accounting_id,
        "dealership_id": record.dealership_id,
        "vehicle_id": record.vehicle_id,
        "accounting_date": record.accounting_date,
        "acquisition_date": record.acquisition_date,
        "control_account_category": record.control_account_category,
        "acquisition_cost": record.acquisition_cost,
        "capitalized_transportation": record.capitalized_transportation,
        "capitalized_reconditioning": record.capitalized_reconditioning,
        "capitalized_accessories": record.capitalized_accessories,
        "other_capitalized_costs": record.other_capitalized_costs,
        "write_down_amount": record.write_down_amount,
        "current_book_value": record.current_book_value,
        "floorplan_principal": record.floorplan_principal,
        "days_in_stock": record.days_in_stock,
        "source_system": record.source_system,
    }


class InventoryAccountingGenerator(BaseGenerator):
    """Build one accounting snapshot per carried unit per month-end."""

    entity_name = ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT
    declared_columns = INVENTORY_ACCOUNTING_COLUMNS
    namespace = INVENTORY_ACCOUNTING_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the accounting snapshot frame.

        Args:
            config: Resolved configuration.

        Returns:
            A frame with the contract columns, in order, ordered by the declared grain.
        """
        records = build_inventory_accounting_records(config)
        frame = pd.DataFrame.from_records(
            [accounting_row(record) for record in records],
            columns=list(INVENTORY_ACCOUNTING_COLUMNS),
        )
        return frame.astype(INVENTORY_ACCOUNTING_DTYPES)


def generate_inventory_accounting_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the dataset feeding ``warehouse.fact_inventory_accounting_snapshot``.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return InventoryAccountingGenerator().generate(config)
