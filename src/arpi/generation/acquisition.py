"""Generator for the ``acquisition_event`` source entity.

Grain: **exactly one acquisition event per physical vehicle**. This event is where a
unit's inventory life begins, so it is the origin of inventory age, days to sale,
inventory investment and every gross measure that subtracts a cost.

Warm-up period
--------------
Acquisitions are **not** confined to the reporting window. An acquisition date may fall
anywhere in::

    [reporting.start_date - ACQUISITION_WARM_UP_DAYS, reporting.end_date]

with :data:`ACQUISITION_WARM_UP_DAYS` fixed at 180 (``PHASE1_CONTRACT.md`` §8). Without
that warm-up the warehouse would start empty: every unit would be zero days old on day
one, average inventory age would climb artificially from nothing, and the aged-inventory
buckets (``61-90``, ``91-120``, ``Over 120``) would be unreachable for the first four
months of any window.

Warm-up volume is **tapered** rather than flat: a day ``k`` days before the window opens
is drawn at ``exp(-k / WARM_UP_TAPER_DAYS)`` of the in-window daily rate. A flat rate
would hand day one a uniform age profile in which most standing units are already older
than the average days-to-sale, so they would all clear in the first fortnight -- an
artefact of the generator rather than a business. The taper approximates the age profile
of a store that was already trading, and puts a substantial minority of the fleet --
roughly 28% at the ``development`` profile -- into inventory before the window opens,
with a real but thin tail of units over 120 days old on day one.

The warm-up is a **generation** window, not a reporting window. ``dim_date`` covers the
reporting window only, so nothing that happens before ``reporting.start_date`` is
reported; the warm-up exists purely so that day one has plausible standing inventory.
ARPI therefore models no disposition before ``reporting.start_date``: a unit acquired
during the warm-up is, by construction, still in stock when the window opens, because a
sale on a date the calendar does not contain could not be reported at all.

Money
-----
Every monetary value is a :class:`decimal.Decimal`, quantized to ``0.01`` with
``ROUND_HALF_UP`` at the point it becomes an output. Intermediate arithmetic stays in
full ``Decimal`` precision and no monetary value is ever a float, because a float cent is
a defect that only shows up when a downstream identity fails to reconcile.

Costs relate to model year, vehicle class and condition **probabilistically**. Every
draw retains residual variance, so no cost is a deterministic function of its inputs:
a perfect correlation is a prohibited synthetic pattern ([ARCHITECTURE.md §15.4]).

Per-model aging propensity
--------------------------
:func:`model_aging_propensity` assigns each **model line** -- ``make`` plus ``model``,
not each trim or model year -- a stable multiplier on how long its units take to move.
Identical vehicle-aging behaviour across models is likewise prohibited, so the sale and
inventory-snapshot generators both consume this rather than a single global constant.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.vehicle import (
    ALLOWED_ACQUISITION_SOURCES,
    CONDITION_CERTIFIED,
    CONDITION_NEW,
    SOURCE_MANUFACTURER_ALLOCATION,
    STORE_INDEPENDENT_USED,
    VehicleRecord,
    build_vehicle_records,
)
from arpi.generation.vehicle_model import (
    CataloguedModel,
    VehicleModelDefinition,
    catalogued_models_for,
)
from arpi.logging_config import get_logger
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import check_column_schema, check_unique_column
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    import random
    from collections.abc import Sequence
    from pathlib import Path

    from arpi.config import ArpiConfig

_LOGGER = get_logger(__name__)

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
#: Source entity produced by this module. It is pre-warehouse: it feeds
#: ``fact_vehicle_inventory_snapshot`` and ``fact_vehicle_sale`` rather than being loaded
#: as a dimension of its own.
ENTITY_ACQUISITION_EVENT: Final = "acquisition_event"

#: Seeding namespace for this entity, and this entity only. Because
#: :func:`arpi.utilities.seeding.rng_for` hashes the namespace instead of consuming a
#: shared stream, generating acquisitions cannot perturb one value -- or one content
#: digest -- in ``dim_vehicle``, ``dim_employee`` or ``dim_customer``.
ACQUISITION_NAMESPACE: Final = "acquisition_event"

ACQUISITION_ID_PREFIX: Final = "ACQ-"
ACQUISITION_ID_DIGITS: Final = 8

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order) -- PHASE1_CONTRACT.md §8
# ---------------------------------------------------------------------------------------
ACQUISITION_EVENT_COLUMNS: Final[tuple[str, ...]] = (
    "acquisition_id",
    "vehicle_id",
    "dealership_id",
    "acquisition_date",
    "acquisition_source",
    "acquisition_cost",
    "reconditioning_cost",
    "original_asking_price",
    "msrp",
    "initial_inventory_status",
    "source_system",
)

#: ``msrp`` is the only nullable column: it is the manufacturer's suggested retail price of
#: a **new** unit, and ARPI does not model the original window sticker of a pre-owned one.
ACQUISITION_EVENT_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in ACQUISITION_EVENT_COLUMNS if column != "msrp"
)

#: Monetary columns, all carried as :class:`decimal.Decimal` in an ``object`` column.
ACQUISITION_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "acquisition_cost",
    "reconditioning_cost",
    "original_asking_price",
    "msrp",
)

ACQUISITION_EVENT_DTYPES: Final[dict[str, str]] = {
    "acquisition_id": "string",
    "vehicle_id": "string",
    "dealership_id": "string",
    "acquisition_date": "datetime64[s]",
    "acquisition_source": "string",
    "acquisition_cost": "object",
    "reconditioning_cost": "object",
    "original_asking_price": "object",
    "msrp": "object",
    "initial_inventory_status": "string",
    "source_system": "string",
}

# ---------------------------------------------------------------------------------------
# Warm-up and seasonality
# ---------------------------------------------------------------------------------------
#: Acquisitions may precede ``reporting.start_date`` by at most this many days.
ACQUISITION_WARM_UP_DAYS: Final = 180

#: Relative daily acquisition rate on the **last** day of the warm-up, compared with the
#: reporting window, before the taper below is applied.
WARM_UP_WEIGHT_FACTOR: Final = 1.0

#: Decay constant, in days, applied to warm-up acquisition volume as it recedes from the
#: window. A flat warm-up rate would hand day one a uniform age profile, in which most
#: standing units are older than the average days-to-sale and therefore all dump in the
#: first fortnight -- an artefact, not a business. Tapering approximates the survival
#: profile of a store that was already trading: plenty of recently-acquired stock, a real
#: but thin tail of genuinely aged units.
WARM_UP_TAPER_DAYS: Final = 65.0

#: Month-of-year multiplier on acquisition volume. Spring and late summer are the strong
#: acquisition months in the north-east; January and February are the weakest. Flat
#: monthly activity is a prohibited synthetic pattern ([ARCHITECTURE.md §15.4]).
MONTH_ACQUISITION_WEIGHT: Final[dict[int, float]] = {
    1: 0.74,
    2: 0.80,
    3: 1.12,
    4: 1.20,
    5: 1.30,
    6: 1.14,
    7: 1.02,
    8: 1.18,
    9: 1.00,
    10: 0.92,
    11: 0.84,
    12: 0.96,
}

#: Day-of-week multiplier, indexed by :meth:`datetime.date.weekday` (Monday is 0).
#: Physical auctions run mid-week, trades arrive with retail traffic, and almost nothing
#: is booked into stock on a Sunday.
DAY_OF_WEEK_ACQUISITION_WEIGHT: Final[tuple[float, ...]] = (
    1.00,  # Monday
    1.26,  # Tuesday
    1.32,  # Wednesday
    1.20,  # Thursday
    1.05,  # Friday
    0.55,  # Saturday
    0.06,  # Sunday
)

# ---------------------------------------------------------------------------------------
# Inventory status
# ---------------------------------------------------------------------------------------
INVENTORY_STATUS_IN_STOCK: Final = "In Stock"
INVENTORY_STATUS_IN_TRANSIT: Final = "In Transit"
INVENTORY_STATUS_IN_RECONDITIONING: Final = "In Reconditioning"

ALLOWED_INITIAL_INVENTORY_STATUSES: Final[tuple[str, ...]] = (
    INVENTORY_STATUS_IN_STOCK,
    INVENTORY_STATUS_IN_TRANSIT,
    INVENTORY_STATUS_IN_RECONDITIONING,
)

#: A unit carrying at least this much reconditioning is booked in as ``In Reconditioning``;
#: lighter work is done on the lot and the unit goes straight to ``In Stock``.
#: ``initial_inventory_status`` is **derived** from the reconditioning spend and the
#: condition, never drawn independently, so it cannot contradict them.
RECONDITIONING_STATUS_THRESHOLD: Final = Decimal("1200.00")

# ---------------------------------------------------------------------------------------
# Valuation model
# ---------------------------------------------------------------------------------------
#: Typical new-unit manufacturer's suggested retail price by vehicle class, at the
#: catalogue reference year. Deliberately class-level rather than model-level: uniform
#: pricing is a prohibited synthetic pattern, and every draw below adds dispersion.
CLASS_BASE_MSRP: Final[dict[str, Decimal]] = {
    "Compact": Decimal("25500"),
    "Midsize": Decimal("31500"),
    "Fullsize": Decimal("38500"),
    "Luxury": Decimal("54500"),
    "Sports": Decimal("43500"),
    "Truck": Decimal("48500"),
    "SUV": Decimal("39500"),
    "Van": Decimal("36500"),
}

#: Fallback used if the catalogue ever grows a class this module has not been told about.
DEFAULT_BASE_MSRP: Final = Decimal("32000")

#: Model-year uplift: a 2026 sticker is higher than a 2020 sticker for the same class.
#: Applied as ``(1 + rate) ** (model_year - MSRP_REFERENCE_YEAR)``.
MSRP_YEAR_INFLATION_RATE: Final = Decimal("0.028")
MSRP_REFERENCE_YEAR: Final = 2026

#: Share of value retained per year of age, applied to used and certified units.
ANNUAL_RETENTION_RATE: Final = Decimal("0.855")

#: Value lost per 10,000 miles, on top of calendar depreciation.
RETENTION_LOSS_PER_10K_MILES: Final = Decimal("0.021")

#: Floor on retained value, so a very old high-mileage unit still books a plausible price
#: rather than trending to zero.
MINIMUM_RETAINED_VALUE_SHARE: Final = Decimal("0.11")

#: New-unit dealer cost as a share of MSRP, drawn ``(low, high, mode)``. The spread is the
#: residual variance: holdback, floor-plan credits and volume bonuses genuinely differ
#: unit to unit.
NEW_INVOICE_SHARE: Final[tuple[float, float, float]] = (0.882, 0.940, 0.914)

#: New-unit asking price as a share of MSRP.
NEW_ASKING_SHARE: Final[tuple[float, float, float]] = (0.982, 1.030, 1.004)

#: Share of retail market value paid to acquire a used unit, by acquisition source. A
#: customer trade is bought furthest below market; a dealer trade closest to it.
SOURCE_COST_SHARE: Final[dict[str, tuple[float, float, float]]] = {
    "Customer Trade": (0.70, 0.86, 0.780),
    "Auction": (0.74, 0.89, 0.815),
    "Off-street Purchase": (0.72, 0.88, 0.795),
    "Lease Return": (0.76, 0.90, 0.835),
    "Dealer Trade": (0.82, 0.96, 0.890),
}

#: Fallback share if a future acquisition source arrives without its own band.
DEFAULT_SOURCE_COST_SHARE: Final[tuple[float, float, float]] = (0.74, 0.90, 0.82)

#: Retail mark-up applied over total inventory investment when the asking price is set.
USED_MARKUP: Final[tuple[float, float, float]] = (1.17, 1.46, 1.30)
CERTIFIED_MARKUP: Final[tuple[float, float, float]] = (1.20, 1.50, 1.34)

# ---------------------------------------------------------------------------------------
# Reconditioning
# ---------------------------------------------------------------------------------------
#: A new unit is only ever prepped: wash, fuel, plate and delivery inspection. Near zero
#: by construction, and materially below every used band.
NEW_RECONDITIONING_RANGE: Final[tuple[int, int]] = (0, 165)

#: Base used reconditioning, drawn ``(low, high, mode)`` before age and mileage uplift.
USED_RECONDITIONING_BASE: Final[tuple[float, float, float]] = (285.0, 2650.0, 890.0)

#: Certification adds a manufacturer inspection and a warranty, so certified spend is
#: higher and much less variable at the bottom end.
CERTIFIED_RECONDITIONING_BASE: Final[tuple[float, float, float]] = (780.0, 3900.0, 1650.0)

#: Reconditioning uplift per year of age and per 10,000 miles.
RECONDITIONING_AGE_UPLIFT: Final = 0.085
RECONDITIONING_MILEAGE_UPLIFT: Final = 0.052

#: Reconditioning is capped at this share of acquisition cost plus this floor. No store
#: spends four thousand dollars fixing a two-thousand-dollar auction unit; without the cap
#: the age and mileage uplifts compound into spend the unit could never recover.
RECONDITIONING_CAP_SHARE: Final = Decimal("0.26")
RECONDITIONING_CAP_FLOOR: Final = Decimal("320.00")

# ---------------------------------------------------------------------------------------
# Per-model aging propensity
# ---------------------------------------------------------------------------------------
#: Multipliers on expected days to sale, selected by a stable hash of the model line.
#: Below 1.0 is a fast mover, above 1.0 a slow one.
AGING_PROPENSITY_LADDER: Final[tuple[float, ...]] = (
    0.68,
    0.79,
    0.88,
    0.97,
    1.06,
    1.18,
    1.34,
    1.52,
)

#: Additional propensity applied by condition: a new unit turns faster than an ageing
#: off-brand trade, which is what stops every model behaving identically.
CONDITION_AGING_FACTOR: Final[dict[str, float]] = {
    "New": 0.92,
    "Certified": 0.98,
    "Used": 1.10,
}

_CENT: Final = Decimal("0.01")

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (prefix reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_ACQUISITION_UNIQUE_ID: Final = "DQ-ACQ-001"
CHECK_ACQUISITION_ONE_PER_VEHICLE: Final = "DQ-ACQ-002"
CHECK_ACQUISITION_SCHEMA_MATCHES: Final = "DQ-ACQ-003"
CHECK_ACQUISITION_NO_NEGATIVE_MONEY: Final = "DQ-ACQ-004"
CHECK_ACQUISITION_RESOLVES: Final = "DQ-ACQ-005"
CHECK_ACQUISITION_NO_ALLOCATION_AT_USED_STORE: Final = "DQ-ACQ-006"
CHECK_ACQUISITION_NO_PROHIBITED_PII: Final = "DQ-ACQ-007"

#: Every check identifier this module emits, in identifier order.
ACQUISITION_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_ACQUISITION_UNIQUE_ID,
    CHECK_ACQUISITION_ONE_PER_VEHICLE,
    CHECK_ACQUISITION_SCHEMA_MATCHES,
    CHECK_ACQUISITION_NO_NEGATIVE_MONEY,
    CHECK_ACQUISITION_RESOLVES,
    CHECK_ACQUISITION_NO_ALLOCATION_AT_USED_STORE,
    CHECK_ACQUISITION_NO_PROHIBITED_PII,
)

_SOURCE_ACQUISITION_EVENT: Final = "source.acquisition_event"

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_ACQUISITION_UNIQUE_ID,
            check_name="acquisition_event.acquisition_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "acquisition_id is the natural key the inventory snapshot and the sale "
                "fact both resolve costs through. A duplicate would let one unit carry "
                "two inventory investments."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_ONE_PER_VEHICLE,
            check_name="acquisition_event holds exactly one event per vehicle",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "The declared grain. Two acquisitions for one vehicle would double its "
                "inventory investment and make days-in-stock ambiguous; none would leave "
                "a sale with no cost basis, which is the prohibited 'sale without "
                "inventory' pattern."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_SCHEMA_MATCHES,
            check_name="acquisition_event matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "so a reordered column would land a cost in a price field."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_NO_NEGATIVE_MONEY,
            check_name="acquisition_event carries no negative monetary value",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "A negative cost, reconditioning spend or asking price is impossible and "
                "would silently turn into positive gross downstream, because front-end "
                "gross subtracts these values."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_RESOLVES,
            check_name="every acquisition resolves to a known vehicle and a known store",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "An acquisition of a vehicle that does not exist, or at a store that does "
                "not exist, breaks the foreign key at load time and orphans every "
                "inventory measure derived from it."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_NO_ALLOCATION_AT_USED_STORE,
            check_name="the independent used store takes no manufacturer allocation",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "GSA-003 holds no franchise, so it cannot be allocated a factory unit. "
                "An allocation there would make the store's new-versus-used mix, and its "
                "whole cost structure, fictional in the wrong way."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
        CheckDefinition(
            check_id=CHECK_ACQUISITION_NO_PROHIBITED_PII,
            check_name="acquisition_event declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_ACQUISITION_EVENT,
            description=(
                "A trade-in is where a real dealer system holds the seller's name, "
                "address and licence. ARPI holds none: the check inspects the schema, so "
                "an empty prohibited column still fails the run."
            ),
            applies_to=(_SOURCE_ACQUISITION_EVENT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class AcquisitionRecord:
    """One acquisition event, plus the vehicle context downstream generators need.

    The first ten attributes are the declared columns. The remainder are **not** columns:
    they are carried so the sale and inventory-snapshot generators do not have to
    re-derive them from the vehicle and catalogue populations.

    Attributes:
        acquisition_id: Identifier in the reserved ``ACQ-########`` scheme.
        vehicle_id: The unit acquired; unique across the whole population.
        dealership_id: Store that acquired it.
        acquisition_date: Date it was booked into stock; may precede the reporting window
            by up to :data:`ACQUISITION_WARM_UP_DAYS`.
        acquisition_source: How the unit entered inventory.
        acquisition_cost: What the store paid, exclusive of reconditioning.
        reconditioning_cost: Spend to make the unit front-line ready.
        original_asking_price: The first advertised price.
        msrp: Manufacturer's suggested retail price, or ``None`` for a used or certified
            unit.
        initial_inventory_status: Status the unit was booked in at.
        condition_type: ``New``, ``Used`` or ``Certified``.
        vehicle_model_id: Natural key of the resolved model.
        vehicle_model_key: Surrogate key of the resolved model.
        model_year: Model year of the resolved model.
        vehicle_class: Vehicle class of the resolved model.
        odometer_reading: Miles showing at acquisition.
        aging_propensity: Multiplier on expected days to sale for this unit's model line
            and condition. Above 1.0 is a slow mover.
    """

    acquisition_id: str
    vehicle_id: str
    dealership_id: str
    acquisition_date: date
    acquisition_source: str
    acquisition_cost: Decimal
    reconditioning_cost: Decimal
    original_asking_price: Decimal
    msrp: Decimal | None
    initial_inventory_status: str
    condition_type: str
    vehicle_model_id: str
    vehicle_model_key: int
    model_year: int
    vehicle_class: str
    odometer_reading: int
    aging_propensity: float

    @property
    def inventory_investment(self) -> Decimal:
        """Total cash in the unit: acquisition cost plus reconditioning."""
        return self.acquisition_cost + self.reconditioning_cost


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def acquisition_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as an ``ACQ-########`` identifier.

    Args:
        ordinal: 1-based position in the generated population.

    Returns:
        The zero-padded identifier, e.g. ``"ACQ-00012044"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive, or is too large for the reserved
            eight-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"acquisition_id ordinals start at 1, got {ordinal}.",
            entity=ENTITY_ACQUISITION_EVENT,
        )
    if ordinal >= 10**ACQUISITION_ID_DIGITS:
        raise GenerationError(
            f"acquisition_id ordinal {ordinal} does not fit the reserved "
            f"{ACQUISITION_ID_PREFIX}{'#' * ACQUISITION_ID_DIGITS} scheme. Widen the "
            "identifier scheme in PHASE1_CONTRACT.md §5 before generating this many "
            "acquisitions.",
            entity=ENTITY_ACQUISITION_EVENT,
        )
    return f"{ACQUISITION_ID_PREFIX}{ordinal:0{ACQUISITION_ID_DIGITS}d}"


def money(value: Decimal) -> Decimal:
    """Quantize a monetary value to two decimal places, half up.

    This is the single governed boundary at which a monetary value is rounded. Callers
    keep full ``Decimal`` precision until the value becomes an output.

    Args:
        value: The unrounded amount.

    Returns:
        The amount quantized to ``0.01`` using ``ROUND_HALF_UP``.
    """
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def acquisition_window(config: ArpiConfig) -> tuple[date, date]:
    """Return the inclusive dates an acquisition may fall on.

    The window opens :data:`ACQUISITION_WARM_UP_DAYS` before ``reporting.start_date`` so
    that inventory already exists, and already carries age, on day one of the reporting
    window.

    Args:
        config: Resolved configuration.

    Returns:
        ``(earliest, latest)`` as inclusive bounds.
    """
    return (
        config.reporting.start_date - timedelta(days=ACQUISITION_WARM_UP_DAYS),
        config.reporting.end_date,
    )


def model_aging_propensity(make: str, model: str) -> float:
    """Return the aging multiplier for one model line.

    Keyed on ``make`` and ``model`` rather than on the trim or model year, so every unit
    of a line ages alike and different lines genuinely do not. Identical vehicle-aging
    behaviour across models is a prohibited synthetic pattern
    ([ARCHITECTURE.md §15.4]).

    Args:
        make: Manufacturer name.
        model: Model line name.

    Returns:
        A multiplier on expected days to sale, from :data:`AGING_PROPENSITY_LADDER`.
    """
    key = f"{make}|{model}"
    index = sum(ord(character) * (position + 1) for position, character in enumerate(key))
    return AGING_PROPENSITY_LADDER[index % len(AGING_PROPENSITY_LADDER)]


def initial_status_for(condition_type: str, reconditioning_cost: Decimal) -> str:
    """Derive the status a unit is booked into stock at.

    ``initial_inventory_status`` is never drawn independently: a unit carrying real
    reconditioning spend is in the shop, a factory unit that needs no work is still on
    the truck, and everything else is on the lot.

    Args:
        condition_type: ``New``, ``Used`` or ``Certified``.
        reconditioning_cost: Reconditioning spend booked against the unit.

    Returns:
        One of :data:`ALLOWED_INITIAL_INVENTORY_STATUSES`.
    """
    if reconditioning_cost >= RECONDITIONING_STATUS_THRESHOLD:
        return INVENTORY_STATUS_IN_RECONDITIONING
    if condition_type == CONDITION_NEW:
        return INVENTORY_STATUS_IN_TRANSIT
    return INVENTORY_STATUS_IN_STOCK


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
def build_acquisition_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[AcquisitionRecord, ...]:
    """Build one acquisition event for every vehicle in the population.

    This is the public entry point the sale and inventory-snapshot generators call.

    Args:
        config: Resolved configuration supplying the master seed, the scale mode and the
            reporting window.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        One record per vehicle, ordered by ``acquisition_id``, which is assigned in
        ``vehicle_id`` order so the mapping is stable.
    """
    vehicles = build_vehicle_records(config, catalogue_path)
    models = {
        model.vehicle_model_id: model for model in catalogued_models_for(config, catalogue_path)
    }
    rng = rng_for(config.random_seed, ACQUISITION_NAMESPACE)
    dates = _draw_acquisition_dates(rng, config, len(vehicles))
    records = tuple(
        _build_record(ordinal, vehicle, models, acquisition_date, rng)
        for ordinal, (vehicle, acquisition_date) in enumerate(
            zip(vehicles, dates, strict=True), start=1
        )
    )
    _log_declared_distributions(records, config)
    return records


def _draw_acquisition_dates(rng: random.Random, config: ArpiConfig, count: int) -> tuple[date, ...]:
    """Draw one acquisition date per vehicle, with seasonality and day-of-week structure."""
    earliest, latest = acquisition_window(config)
    window_start = config.reporting.start_date
    span = (latest - earliest).days + 1
    candidates = [earliest + timedelta(days=offset) for offset in range(span)]
    weights = [
        MONTH_ACQUISITION_WEIGHT[candidate.month]
        * DAY_OF_WEEK_ACQUISITION_WEIGHT[candidate.weekday()]
        * _warm_up_factor(candidate, window_start)
        for candidate in candidates
    ]
    return tuple(rng.choices(candidates, weights=weights, k=count))


def _warm_up_factor(candidate: date, window_start: date) -> float:
    """Return the warm-up taper applied to one candidate acquisition date."""
    if candidate >= window_start:
        return 1.0
    days_before = (window_start - candidate).days
    return WARM_UP_WEIGHT_FACTOR * math.exp(-days_before / WARM_UP_TAPER_DAYS)


def _build_record(
    ordinal: int,
    vehicle: VehicleRecord,
    models: dict[str, CataloguedModel],
    acquisition_date: date,
    rng: random.Random,
) -> AcquisitionRecord:
    """Build one acquisition event for one vehicle."""
    model = models.get(vehicle.vehicle_model_id)
    if model is None:
        raise GenerationError(
            f"Vehicle {vehicle.vehicle_id} references vehicle model "
            f"{vehicle.vehicle_model_id!r}, which is not in the catalogue subset for this "
            "profile. The vehicle and acquisition generators must read the same catalogue.",
            entity=ENTITY_ACQUISITION_EVENT,
            vehicle_id=vehicle.vehicle_id,
            vehicle_model_id=vehicle.vehicle_model_id,
        )
    definition = model.definition
    # Cost is drawn first because reconditioning is capped against it: nobody spends four
    # thousand dollars reconditioning a two-thousand-dollar auction unit.
    msrp, acquisition_cost = _draw_cost(rng, vehicle, definition, acquisition_date)
    reconditioning = _draw_reconditioning(
        rng, vehicle, definition.model_year, acquisition_date, acquisition_cost
    )
    asking = _draw_asking_price(rng, vehicle, msrp, acquisition_cost, reconditioning)
    return AcquisitionRecord(
        acquisition_id=acquisition_id_for(ordinal),
        vehicle_id=vehicle.vehicle_id,
        dealership_id=vehicle.intended_dealership_id,
        acquisition_date=acquisition_date,
        acquisition_source=vehicle.acquisition_source,
        acquisition_cost=acquisition_cost,
        reconditioning_cost=reconditioning,
        original_asking_price=asking,
        msrp=msrp,
        initial_inventory_status=initial_status_for(vehicle.condition_type, reconditioning),
        condition_type=vehicle.condition_type,
        vehicle_model_id=vehicle.vehicle_model_id,
        vehicle_model_key=vehicle.vehicle_model_key,
        model_year=definition.model_year,
        vehicle_class=definition.vehicle_class,
        odometer_reading=vehicle.odometer_reading,
        aging_propensity=round(
            model_aging_propensity(definition.make, definition.model)
            * CONDITION_AGING_FACTOR[vehicle.condition_type],
            4,
        ),
    )


def _vehicle_age_years(model_year: int, acquisition_date: date) -> int:
    """Return the whole years of age a unit carries when it is acquired."""
    return max(acquisition_date.year - model_year, 0)


def _base_msrp(vehicle_class: str, model_year: int) -> Decimal:
    """Return the class-and-year sticker a unit's valuation is anchored to."""
    base = CLASS_BASE_MSRP.get(vehicle_class, DEFAULT_BASE_MSRP)
    exponent = model_year - MSRP_REFERENCE_YEAR
    return base * (Decimal(1) + MSRP_YEAR_INFLATION_RATE) ** exponent


def _retained_value_share(age_years: int, odometer_reading: int) -> Decimal:
    """Return the share of original sticker a used unit still commands."""
    calendar = ANNUAL_RETENTION_RATE**age_years
    mileage_loss = RETENTION_LOSS_PER_10K_MILES * (Decimal(odometer_reading) / Decimal(10_000))
    return max(calendar - mileage_loss, MINIMUM_RETAINED_VALUE_SHARE)


def _draw_cost(
    rng: random.Random,
    vehicle: VehicleRecord,
    definition: VehicleModelDefinition,
    acquisition_date: date,
) -> tuple[Decimal | None, Decimal]:
    """Draw ``(msrp, acquisition_cost)`` for one unit.

    ``msrp`` is populated for a new unit only: it is the manufacturer's suggested retail
    price of a car nobody has owned, and ARPI does not model the original window sticker
    of a pre-owned one. Every share below is drawn rather than fixed, so cost is related
    to class, model year and condition without being determined by them.
    """
    sticker = _base_msrp(definition.vehicle_class, definition.model_year)
    if vehicle.condition_type == CONDITION_NEW:
        msrp = money(sticker * _decimal_triangular(rng, 0.97, 1.06, 1.0))
        return msrp, money(msrp * _decimal_triangular(rng, *NEW_INVOICE_SHARE))

    age_years = _vehicle_age_years(definition.model_year, acquisition_date)
    market_value = (
        sticker
        * _retained_value_share(age_years, vehicle.odometer_reading)
        * _decimal_triangular(rng, 0.93, 1.09, 1.0)
    )
    share = SOURCE_COST_SHARE.get(vehicle.acquisition_source, DEFAULT_SOURCE_COST_SHARE)
    return None, money(market_value * _decimal_triangular(rng, *share))


def _draw_reconditioning(
    rng: random.Random,
    vehicle: VehicleRecord,
    model_year: int,
    acquisition_date: date,
    acquisition_cost: Decimal,
) -> Decimal:
    """Draw the reconditioning spend booked against one unit.

    A new unit is only ever prepped -- washed, fuelled, plated and inspected -- so its
    spend is near zero. A used unit is reconditioned in proportion to how hard its life
    has been, which is why the used population sits materially above the new one. The
    spend is then capped against the unit's own cost, because no store spends more
    fixing a car than the car is worth.
    """
    if vehicle.condition_type == CONDITION_NEW:
        return money(Decimal(rng.randint(*NEW_RECONDITIONING_RANGE)))

    low, high, mode = (
        CERTIFIED_RECONDITIONING_BASE
        if vehicle.condition_type == CONDITION_CERTIFIED
        else USED_RECONDITIONING_BASE
    )
    base = rng.triangular(low, high, mode)
    age_years = _vehicle_age_years(model_year, acquisition_date)
    uplift = (
        1.0
        + RECONDITIONING_AGE_UPLIFT * age_years
        + RECONDITIONING_MILEAGE_UPLIFT * (vehicle.odometer_reading / 10_000)
    )
    drawn = money(Decimal(str(round(base * uplift, 2))))
    cap = money(acquisition_cost * RECONDITIONING_CAP_SHARE + RECONDITIONING_CAP_FLOOR)
    return min(drawn, cap)


def _draw_asking_price(
    rng: random.Random,
    vehicle: VehicleRecord,
    msrp: Decimal | None,
    acquisition_cost: Decimal,
    reconditioning: Decimal,
) -> Decimal:
    """Draw the first advertised price for one unit.

    A new unit is priced off its sticker; a used unit is priced off what the store has in
    it, at a mark-up that is drawn rather than fixed -- uniform pricing is a prohibited
    synthetic pattern ([ARCHITECTURE.md §15.4]).
    """
    if msrp is not None:
        return money(msrp * _decimal_triangular(rng, *NEW_ASKING_SHARE))
    markup = CERTIFIED_MARKUP if vehicle.condition_type == CONDITION_CERTIFIED else USED_MARKUP
    return money((acquisition_cost + reconditioning) * _decimal_triangular(rng, *markup))


def _decimal_triangular(rng: random.Random, low: float, high: float, mode: float) -> Decimal:
    """Draw a triangular variate and return it as an exact ``Decimal`` multiplier.

    The float is rendered through :func:`str` before it becomes a ``Decimal``, so the
    multiplier is the six-figure number that was drawn rather than a binary
    approximation of it. No float ever reaches a monetary value.
    """
    return Decimal(str(round(rng.triangular(low, high, mode), 6)))


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class AcquisitionGenerator(BaseGenerator):
    """Build exactly one ``acquisition_event`` row per physical vehicle."""

    entity_name = ENTITY_ACQUISITION_EVENT
    declared_columns = ACQUISITION_EVENT_COLUMNS
    namespace = ACQUISITION_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the acquisition frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 11 contract columns, in order, ordered by
            ``acquisition_id``.
        """
        records = build_acquisition_records(config)
        frame = pd.DataFrame.from_records(
            [acquisition_row(record) for record in records],
            columns=list(ACQUISITION_EVENT_COLUMNS),
        )
        return frame.astype(ACQUISITION_EVENT_DTYPES)


def acquisition_row(record: AcquisitionRecord) -> dict[str, Any]:
    """Render one acquisition record as its declared row.

    Args:
        record: The record to render.

    Returns:
        A mapping keyed by :data:`ACQUISITION_EVENT_COLUMNS`.
    """
    return {
        "acquisition_id": record.acquisition_id,
        "vehicle_id": record.vehicle_id,
        "dealership_id": record.dealership_id,
        "acquisition_date": record.acquisition_date,
        "acquisition_source": record.acquisition_source,
        "acquisition_cost": record.acquisition_cost,
        "reconditioning_cost": record.reconditioning_cost,
        "original_asking_price": record.original_asking_price,
        "msrp": record.msrp,
        "initial_inventory_status": record.initial_inventory_status,
        "source_system": SOURCE_SYSTEM,
    }


def generate_acquisition_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``acquisition_event`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return AcquisitionGenerator().generate(config)


def _log_declared_distributions(records: Sequence[AcquisitionRecord], config: ArpiConfig) -> None:
    """Log the warm-up share and the condition mix actually produced."""
    total = len(records)
    if total == 0:  # pragma: no cover - the generator never produces an empty population
        return
    window_start = config.reporting.start_date
    warm_up = sum(1 for record in records if record.acquisition_date < window_start)
    stores: dict[str, int] = {}
    for record in records:
        stores[record.dealership_id] = stores.get(record.dealership_id, 0) + 1
    _LOGGER.info(
        "acquisition_event distributions: rows=%d warm_up_share=%.4f store=%s",
        total,
        warm_up / total,
        {store: round(count / total, 4) for store, count in sorted(stores.items())},
    )


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_acquisition_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-ACQ-001`` through ``DQ-ACQ-007`` against the acquisition source entity.

    Args:
        dataset: The generated ``acquisition_event`` dataset.
        config: Resolved configuration, used to rebuild the authoritative vehicle-to-store
            assignment the acquisitions must agree with.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A report containing seven results, in check-id order.
    """
    frame = dataset.frame
    assignments = {
        vehicle.vehicle_id: vehicle.intended_dealership_id
        for vehicle in build_vehicle_records(config, catalogue_path)
    }
    return ValidationReport(
        (
            replace(
                check_unique_column(
                    frame,
                    "acquisition_id",
                    check_id=CHECK_ACQUISITION_UNIQUE_ID,
                    check_name="acquisition_event.acquisition_id is unique",
                    target_object=ENTITY_ACQUISITION_EVENT,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            _check_one_event_per_vehicle(frame, len(assignments)),
            check_column_schema(
                frame,
                ACQUISITION_EVENT_COLUMNS,
                check_id=CHECK_ACQUISITION_SCHEMA_MATCHES,
                check_name="acquisition_event matches its declared column contract",
                target_object=ENTITY_ACQUISITION_EVENT,
            ),
            _check_no_negative_money(frame),
            _check_resolves(frame, assignments),
            _check_no_allocation_at_used_store(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_ACQUISITION_NO_PROHIBITED_PII,
                check_name="acquisition_event declares no prohibited personal-data column",
                target_object=ENTITY_ACQUISITION_EVENT,
            ),
        )
    )


def _base_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_ACQUISITION_EVENT,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_one_event_per_vehicle(frame: pd.DataFrame, vehicle_count: int) -> CheckResult:
    """``DQ-ACQ-002`` -- exactly one acquisition exists for every vehicle."""
    base = _base_result(
        CHECK_ACQUISITION_ONE_PER_VEHICLE,
        "acquisition_event holds exactly one event per vehicle",
        CHECK_CATEGORY_UNIQUENESS,
    )
    duplicates = int(frame.duplicated(subset=["vehicle_id"]).sum())
    distinct = int(frame["vehicle_id"].nunique())
    missing = max(vehicle_count - distinct, 0)
    offending = duplicates + missing
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{duplicates} vehicle(s) carry more than one acquisition and {missing} vehicle(s) "
        f"carry none, against a population of {vehicle_count}. The declared grain is one "
        "acquisition per vehicle.",
        failed_record_count=offending,
    )


def _check_no_negative_money(frame: pd.DataFrame) -> CheckResult:
    """``DQ-ACQ-004`` -- no monetary column carries a negative value."""
    base = _base_result(
        CHECK_ACQUISITION_NO_NEGATIVE_MONEY,
        "acquisition_event carries no negative monetary value",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    counts: dict[str, int] = {}
    for column in ACQUISITION_MONEY_COLUMNS:
        if column not in frame.columns:
            return base.failed(f"{ENTITY_ACQUISITION_EVENT} is missing {column!r}.")
        offending = sum(
            1 for value in frame[column] if value is not None and Decimal(str(value)) < 0
        )
        if offending:
            counts[column] = offending
    total = sum(counts.values())
    result = replace(base, observed_value=float(total))
    if total == 0:
        return result
    detail = ", ".join(f"{column}={count}" for column, count in sorted(counts.items()))
    return result.failed(
        f"{total} negative monetary value(s) found: {detail}. Front-end gross subtracts "
        "cost and reconditioning, so a negative one silently becomes profit.",
        failed_record_count=total,
    )


def _check_resolves(frame: pd.DataFrame, assignments: dict[str, str]) -> CheckResult:
    """``DQ-ACQ-005`` -- every acquisition names a known vehicle at its intended store."""
    base = _base_result(
        CHECK_ACQUISITION_RESOLVES,
        "every acquisition resolves to a known vehicle and a known store",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending = [
        f"{vehicle_id}@{dealership_id}"
        for vehicle_id, dealership_id in zip(
            frame["vehicle_id"], frame["dealership_id"], strict=True
        )
        if assignments.get(str(vehicle_id)) != str(dealership_id)
    ]
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} acquisition(s) name a vehicle that does not exist, or place a "
        f"vehicle at a store it was never assigned to: {', '.join(sorted(offending)[:5])}.",
        failed_record_count=len(offending),
    )


def _check_no_allocation_at_used_store(frame: pd.DataFrame) -> CheckResult:
    """``DQ-ACQ-006`` -- ``GSA-003`` books no manufacturer allocation."""
    base = _base_result(
        CHECK_ACQUISITION_NO_ALLOCATION_AT_USED_STORE,
        "the independent used store takes no manufacturer allocation",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    unknown_sources = sorted(
        {
            str(value)
            for value in frame["acquisition_source"]
            if str(value) not in ALLOWED_ACQUISITION_SOURCES
        }
    )
    offending = int(
        (
            (frame["dealership_id"] == STORE_INDEPENDENT_USED)
            & (frame["acquisition_source"] == SOURCE_MANUFACTURER_ALLOCATION)
        ).sum()
    )
    total = offending + len(unknown_sources)
    result = replace(base, observed_value=float(total))
    if total == 0:
        return result
    return result.failed(
        f"{offending} acquisition(s) book a {SOURCE_MANUFACTURER_ALLOCATION!r} at "
        f"{STORE_INDEPENDENT_USED}, which holds no franchise"
        + (
            f"; unrecognised acquisition source(s): {', '.join(unknown_sources)}"
            if unknown_sources
            else ""
        )
        + ".",
        failed_record_count=total,
    )
