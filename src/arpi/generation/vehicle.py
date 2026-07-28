"""Generator for ``warehouse.dim_vehicle``.

Grain: **one row per unique physical vehicle**. Every vehicle resolves to exactly one
``dim_vehicle_model`` row, which is what makes "a sale with no vehicle record" — a
prohibited synthetic pattern — structurally impossible.

Synthetic VIN policy
--------------------
``synthetic_vin`` is 17 characters: the literal prefix ``ARPI`` followed by 13 characters
drawn from ``ABCDEFGHJKLMNPRSTUVWXYZ0123456789``. The alphabet excludes ``I``, ``O`` and
``Q``, matching real VIN character rules, while the ``ARPI`` prefix makes the value
**deliberately not a valid VIN**: no real vehicle identification number begins with a
World Manufacturer Identifier of ``ARP``, and the ninth character is not a valid ISO 3779
check digit. **No real VIN data is held, read, or derived from**, no lookup is performed,
and no owner relationship exists anywhere in ARPI.

Store assignment
----------------
Which store holds a vehicle is a property of the **acquisition event**, not of the
vehicle dimension, so ``dim_vehicle`` carries no ``dealership_id``. The generator still
decides a deterministic intended store per vehicle — a used-only store cannot be allocated
a new unit — and exposes it through :func:`intended_store_assignments` for the
acquisition generator to consume.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.vehicle_model import (
    CATALOGUE_REFERENCE_YEAR,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_UNIQUENESS,
    FRANCHISE_ALIGNMENT_CHEVROLET,
    FRANCHISE_ALIGNMENT_INDEPENDENT,
    FRANCHISE_ALIGNMENT_SUBARU,
    NEW_MODEL_YEAR_FLOOR,
    CataloguedModel,
    CheckDefinition,
    catalogued_models_for,
)
from arpi.logging_config import get_logger
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import (
    check_column_schema,
    check_no_prohibited_pii_columns,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

    from arpi.config import ArpiConfig

_LOGGER = get_logger(__name__)

# ---------------------------------------------------------------------------------------
# Entity identity
# ---------------------------------------------------------------------------------------
ENTITY_DIM_VEHICLE: Final = "dim_vehicle"

#: Seeding namespace for this entity, distinct from ``dim_vehicle_model``'s. Adding this
#: generator therefore cannot perturb the model catalogue's digest, or any other entity's.
VEHICLE_NAMESPACE: Final = "dim_vehicle"

VEHICLE_ID_PREFIX: Final = "VEH-"
VEHICLE_ID_DIGITS: Final = 7

# ---------------------------------------------------------------------------------------
# Synthetic VIN
# ---------------------------------------------------------------------------------------
VIN_PREFIX: Final = "ARPI"
VIN_LENGTH: Final = 17
#: Real VIN character rules exclude I, O and Q to avoid confusion with 1 and 0.
VIN_ALPHABET: Final = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
VIN_RANDOM_LENGTH: Final = VIN_LENGTH - len(VIN_PREFIX)
#: Redraw budget per vehicle before a collision is treated as a generator defect.
VIN_MAX_ATTEMPTS: Final = 64

# ---------------------------------------------------------------------------------------
# Enumerations (exact spellings; shared verbatim with the SQL DDL and the data dictionary)
# ---------------------------------------------------------------------------------------
CONDITION_NEW: Final = "New"
CONDITION_USED: Final = "Used"
CONDITION_CERTIFIED: Final = "Certified"
ALLOWED_CONDITION_TYPES: Final[tuple[str, ...]] = (
    CONDITION_NEW,
    CONDITION_USED,
    CONDITION_CERTIFIED,
)

ODOMETER_BAND_NEW: Final = "New"
ALLOWED_ODOMETER_BANDS: Final[tuple[str, ...]] = (
    ODOMETER_BAND_NEW,
    "Under 10k",
    "10k-30k",
    "30k-60k",
    "60k-100k",
    "Over 100k",
)

SOURCE_MANUFACTURER_ALLOCATION: Final = "Manufacturer Allocation"
SOURCE_CUSTOMER_TRADE: Final = "Customer Trade"
SOURCE_AUCTION: Final = "Auction"
SOURCE_OFF_STREET_PURCHASE: Final = "Off-street Purchase"
SOURCE_LEASE_RETURN: Final = "Lease Return"
SOURCE_DEALER_TRADE: Final = "Dealer Trade"
ALLOWED_ACQUISITION_SOURCES: Final[tuple[str, ...]] = (
    SOURCE_CUSTOMER_TRADE,
    SOURCE_AUCTION,
    SOURCE_OFF_STREET_PURCHASE,
    SOURCE_LEASE_RETURN,
    SOURCE_DEALER_TRADE,
    SOURCE_MANUFACTURER_ALLOCATION,
)

# ---------------------------------------------------------------------------------------
# Consistency bounds
# ---------------------------------------------------------------------------------------
#: A new unit may carry delivery and lot miles only.
NEW_ODOMETER_MAX: Final = 50
NEW_ODOMETER_MIN: Final = 2
#: Manufacturer certification requires a unit that is neither brand new nor worn out.
CERTIFIED_MIN_AGE_YEARS: Final = 1
CERTIFIED_MAX_AGE_YEARS: Final = 8
CERTIFIED_MIN_ODOMETER: Final = 500
CERTIFIED_MAX_ODOMETER: Final = 80_000
USED_MIN_ODOMETER: Final = 200
#: Upper bound applied to every generated reading, so no unit is implausibly worn.
MAX_ODOMETER: Final = 260_000

ODOMETER_BAND_BOUNDARIES: Final[tuple[tuple[int, str], ...]] = (
    (10_000, "Under 10k"),
    (30_000, "10k-30k"),
    (60_000, "30k-60k"),
    (100_000, "60k-100k"),
)

# ---------------------------------------------------------------------------------------
# Store mix
# ---------------------------------------------------------------------------------------
STORE_CHEVROLET: Final = "GSA-001"
STORE_SUBARU: Final = "GSA-002"
STORE_INDEPENDENT_USED: Final = "GSA-003"
STORE_IDS: Final[tuple[str, ...]] = (STORE_CHEVROLET, STORE_SUBARU, STORE_INDEPENDENT_USED)

#: Share of the vehicle population held by each store.
STORE_SHARE: Final[dict[str, float]] = {
    STORE_CHEVROLET: 0.40,
    STORE_SUBARU: 0.35,
    STORE_INDEPENDENT_USED: 0.25,
}

#: Condition mix by store. ``GSA-003`` is an independent used operation: it takes no
#: factory allocation and can certify nothing, so it stocks used units only.
STORE_CONDITION_WEIGHTS: Final[dict[str, dict[str, float]]] = {
    STORE_CHEVROLET: {CONDITION_NEW: 0.45, CONDITION_USED: 0.38, CONDITION_CERTIFIED: 0.17},
    STORE_SUBARU: {CONDITION_NEW: 0.42, CONDITION_USED: 0.36, CONDITION_CERTIFIED: 0.22},
    STORE_INDEPENDENT_USED: {CONDITION_USED: 1.0},
}

#: Franchise alignment mix of the **used** inventory each store carries. New and certified
#: units are always aligned to the store's own franchise brand.
STORE_USED_ALIGNMENT_WEIGHTS: Final[dict[str, dict[str, float]]] = {
    STORE_CHEVROLET: {
        FRANCHISE_ALIGNMENT_CHEVROLET: 0.62,
        FRANCHISE_ALIGNMENT_INDEPENDENT: 0.30,
        FRANCHISE_ALIGNMENT_SUBARU: 0.08,
    },
    STORE_SUBARU: {
        FRANCHISE_ALIGNMENT_SUBARU: 0.62,
        FRANCHISE_ALIGNMENT_INDEPENDENT: 0.30,
        FRANCHISE_ALIGNMENT_CHEVROLET: 0.08,
    },
    STORE_INDEPENDENT_USED: {
        FRANCHISE_ALIGNMENT_INDEPENDENT: 0.62,
        FRANCHISE_ALIGNMENT_CHEVROLET: 0.20,
        FRANCHISE_ALIGNMENT_SUBARU: 0.18,
    },
}

#: The franchise brand each store may sell new and certify.
STORE_FRANCHISE_ALIGNMENT: Final[dict[str, str]] = {
    STORE_CHEVROLET: FRANCHISE_ALIGNMENT_CHEVROLET,
    STORE_SUBARU: FRANCHISE_ALIGNMENT_SUBARU,
}

#: Acquisition source mix by condition. ``New`` is fixed, not drawn.
CERTIFIED_SOURCE_WEIGHTS: Final[dict[str, float]] = {
    SOURCE_CUSTOMER_TRADE: 0.45,
    SOURCE_LEASE_RETURN: 0.35,
    SOURCE_AUCTION: 0.15,
    SOURCE_DEALER_TRADE: 0.05,
}
USED_SOURCE_WEIGHTS: Final[dict[str, float]] = {
    SOURCE_CUSTOMER_TRADE: 0.34,
    SOURCE_AUCTION: 0.30,
    SOURCE_OFF_STREET_PURCHASE: 0.14,
    SOURCE_LEASE_RETURN: 0.12,
    SOURCE_DEALER_TRADE: 0.10,
}

# ---------------------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------------------
EXTERIOR_COLOR_WEIGHTS: Final[dict[str, float]] = {
    "Summit White": 0.15,
    "Mosaic Black": 0.14,
    "Silver Ice": 0.12,
    "Magnetite Gray": 0.11,
    "Crystal Black Silica": 0.09,
    "Northsky Blue": 0.08,
    "Cherry Red": 0.07,
    "Ice Silver": 0.06,
    "Autumn Green": 0.05,
    "Sandstone Beige": 0.05,
    "Cayenne Orange": 0.04,
    "Sunlit Yellow": 0.04,
}
INTERIOR_COLOR_WEIGHTS: Final[dict[str, float]] = {
    "Jet Black": 0.32,
    "Medium Ash Gray": 0.22,
    "Slate Gray": 0.16,
    "Warm Ivory": 0.12,
    "Saddle Tan": 0.10,
    "Titanium": 0.08,
}

#: Relative popularity applied to a model when drawing which one a vehicle is. Weights are
#: derived from a stable hash of the model identifier, so the mix is non-uniform without
#: hand-maintaining a weight per catalogue row.
MODEL_POPULARITY_WEIGHTS: Final[tuple[float, ...]] = (0.5, 0.8, 1.0, 1.4, 2.0, 3.0)

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order) -- PHASE1_CONTRACT.md §6
# ---------------------------------------------------------------------------------------
DIM_VEHICLE_COLUMNS: Final[tuple[str, ...]] = (
    "vehicle_key",
    "vehicle_id",
    "synthetic_vin",
    "vehicle_model_key",
    "vehicle_model_id",
    "condition_type",
    "exterior_color",
    "interior_color",
    "odometer_reading",
    "odometer_band",
    "acquisition_source",
    "source_system",
)

DIM_VEHICLE_DTYPES: Final[dict[str, str]] = {
    "vehicle_key": "int32",
    "vehicle_id": "string",
    "synthetic_vin": "string",
    "vehicle_model_key": "int32",
    "vehicle_model_id": "string",
    "condition_type": "string",
    "exterior_color": "string",
    "interior_color": "string",
    "odometer_reading": "int32",
    "odometer_band": "string",
    "acquisition_source": "string",
    "source_system": "string",
}

#: Row counts per scale profile -- PHASE1_CONTRACT.md §11.
VEHICLE_SCALE: Final[dict[str, int]] = {
    "test": 60,
    "development": 900,
    "portfolio": 9_000,
}

# ---------------------------------------------------------------------------------------
# Data-quality checks emitted for this entity
# ---------------------------------------------------------------------------------------
CHECK_VEHICLE_UNIQUE_ID: Final = "DQ-VEH-001"
CHECK_VEHICLE_UNIQUE_VIN: Final = "DQ-VEH-002"
CHECK_VEHICLE_SCHEMA_MATCHES: Final = "DQ-VEH-003"
CHECK_VEHICLE_MODEL_RESOLVES: Final = "DQ-VEH-004"
CHECK_VEHICLE_CONDITION_CONSISTENCY: Final = "DQ-VEH-005"
CHECK_VEHICLE_NO_PROHIBITED_PII: Final = "DQ-VEH-006"
CHECK_VEHICLE_VIN_FORMAT: Final = "DQ-VEH-007"

VEHICLE_CHECK_DEFINITIONS: Final[tuple[CheckDefinition, ...]] = (
    CheckDefinition(
        check_id=CHECK_VEHICLE_UNIQUE_ID,
        check_name="dim_vehicle.vehicle_id is unique",
        category=CHECK_CATEGORY_UNIQUENESS,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="No two vehicles share a vehicle_id.",
        applies_to="vehicle_id",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_UNIQUE_VIN,
        check_name="dim_vehicle.synthetic_vin is unique",
        category=CHECK_CATEGORY_UNIQUENESS,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="No two vehicles share a synthetic VIN.",
        applies_to="synthetic_vin",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_SCHEMA_MATCHES,
        check_name="dim_vehicle matches its declared schema",
        category=CHECK_CATEGORY_STRUCTURAL,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="Column names, order and count match the declared contract.",
        applies_to="all columns",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_RESOLVES,
        check_name="every dim_vehicle row resolves to a known vehicle model",
        category=CHECK_CATEGORY_REFERENTIAL,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="Every (vehicle_model_key, vehicle_model_id) pair exists in "
        "dim_vehicle_model and the two agree.",
        applies_to="vehicle_model_key, vehicle_model_id",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_CONDITION_CONSISTENCY,
        check_name="dim_vehicle condition, source and odometer are consistent",
        category=CHECK_CATEGORY_BUSINESS_RULE,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="New units carry a manufacturer allocation, the New odometer band "
        "and at most 50 miles; every band agrees with its reading.",
        applies_to="condition_type, acquisition_source, odometer_reading, odometer_band",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_NO_PROHIBITED_PII,
        check_name="dim_vehicle declares no prohibited PII column",
        category=CHECK_CATEGORY_PRIVACY,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="No column name matches the prohibited personal-data vocabulary; no "
        "owner relationship exists.",
        applies_to="all columns",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_VIN_FORMAT,
        check_name="dim_vehicle.synthetic_vin is well formed",
        category=CHECK_CATEGORY_BUSINESS_RULE,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE,
        description="17 characters, ARPI prefix, remaining characters drawn from the "
        "VIN alphabet with I, O and Q excluded.",
        applies_to="synthetic_vin",
    ),
)


@dataclass(frozen=True, slots=True)
class VehicleRecord:
    """One physical vehicle, plus the store that is intended to hold it.

    ``intended_dealership_id`` is **not** a column of ``dim_vehicle``. It is carried here
    because the acquisition generator needs it, and exposed through
    :func:`intended_store_assignments`.

    Attributes:
        vehicle_key: Deterministic ordinal, ``1..N`` by ``vehicle_id``.
        vehicle_id: Identifier in the reserved ``VEH-#######`` scheme.
        synthetic_vin: 17-character synthetic VIN; see the module docstring.
        vehicle_model_key: Surrogate key of the resolved ``dim_vehicle_model`` row.
        vehicle_model_id: Natural key of the resolved ``dim_vehicle_model`` row.
        condition_type: ``New``, ``Used`` or ``Certified``.
        exterior_color: Exterior paint description.
        interior_color: Interior trim colour description.
        odometer_reading: Miles showing, always ``>= 0``.
        odometer_band: Reporting band agreeing with ``odometer_reading``.
        acquisition_source: How the unit entered inventory.
        intended_dealership_id: Store the acquisition generator should place it at.
    """

    vehicle_key: int
    vehicle_id: str
    synthetic_vin: str
    vehicle_model_key: int
    vehicle_model_id: str
    condition_type: str
    exterior_color: str
    interior_color: str
    odometer_reading: int
    odometer_band: str
    acquisition_source: str
    intended_dealership_id: str


def vehicle_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as a ``VEH-#######`` identifier.

    Args:
        ordinal: 1-based position in the generated population.

    Returns:
        The zero-padded identifier, e.g. ``"VEH-0001337"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive, or is too large for the reserved
            seven-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"vehicle_id ordinals start at 1, got {ordinal}.", entity=ENTITY_DIM_VEHICLE
        )
    if ordinal >= 10**VEHICLE_ID_DIGITS:
        raise GenerationError(
            f"vehicle_id ordinal {ordinal} does not fit the reserved "
            f"{VEHICLE_ID_PREFIX}{'#' * VEHICLE_ID_DIGITS} scheme. Widen the identifier "
            "scheme in PHASE1_CONTRACT.md §5 before generating this many vehicles.",
            entity=ENTITY_DIM_VEHICLE,
        )
    return f"{VEHICLE_ID_PREFIX}{ordinal:0{VEHICLE_ID_DIGITS}d}"


def odometer_band_for(odometer_reading: int, condition_type: str) -> str:
    """Derive the reporting band a reading falls into.

    A new unit is always reported in the ``New`` band. Every other unit is banded purely
    by its reading, with each boundary belonging to the band above it: 9,999 miles is
    ``Under 10k`` and 10,000 miles is ``10k-30k``.

    Args:
        odometer_reading: Miles showing.
        condition_type: ``New``, ``Used`` or ``Certified``.

    Returns:
        One of :data:`ALLOWED_ODOMETER_BANDS`.

    Raises:
        GenerationError: If the reading is negative, the condition is unknown, or a new
            unit shows more than :data:`NEW_ODOMETER_MAX` miles.
    """
    if odometer_reading < 0:
        raise GenerationError(
            f"odometer_reading must be non-negative, got {odometer_reading}.",
            entity=ENTITY_DIM_VEHICLE,
        )
    if condition_type not in ALLOWED_CONDITION_TYPES:
        raise GenerationError(
            f"condition_type must be one of {', '.join(ALLOWED_CONDITION_TYPES)}, got "
            f"{condition_type!r}.",
            entity=ENTITY_DIM_VEHICLE,
        )
    if condition_type == CONDITION_NEW:
        if odometer_reading > NEW_ODOMETER_MAX:
            raise GenerationError(
                f"A New unit may show at most {NEW_ODOMETER_MAX} miles, got {odometer_reading}.",
                entity=ENTITY_DIM_VEHICLE,
            )
        return ODOMETER_BAND_NEW
    for boundary, band in ODOMETER_BAND_BOUNDARIES:
        if odometer_reading < boundary:
            return band
    return "Over 100k"


def vehicle_count_for(config: ArpiConfig) -> int:
    """Return the number of vehicles the active profile asks for.

    Args:
        config: Resolved configuration; ``generation.scale_mode`` selects the profile.

    Returns:
        The target row count from :data:`VEHICLE_SCALE`.

    Raises:
        GenerationError: If the scale mode has no declared target.
    """
    scale_mode = config.generation.scale_mode
    try:
        return VEHICLE_SCALE[scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No dim_vehicle row target is declared for scale mode {scale_mode!r}. "
            f"Known modes: {', '.join(sorted(VEHICLE_SCALE))}.",
            entity=ENTITY_DIM_VEHICLE,
            scale_mode=scale_mode,
        ) from error


def build_vehicle_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[VehicleRecord, ...]:
    """Build the full vehicle population, including each unit's intended store.

    Args:
        config: Resolved configuration.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        One record per vehicle, ordered by ``vehicle_id``.
    """
    models = catalogued_models_for(config, catalogue_path)
    rng = rng_for(config.random_seed, VEHICLE_NAMESPACE)
    pools = _build_model_pools(models)
    used_vins: set[str] = set()
    records: list[VehicleRecord] = []
    for ordinal in range(1, vehicle_count_for(config) + 1):
        records.append(_build_record(ordinal, rng, pools, used_vins))
    return tuple(records)


def intended_store_assignments(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> dict[str, str]:
    """Map every ``vehicle_id`` to the store that is intended to acquire it.

    Which store holds a unit is an acquisition property, so it is deliberately absent from
    ``dim_vehicle``. This helper is the supported way for the inventory-acquisition
    generator to obtain the same deterministic assignment the vehicle generator used when
    it decided condition and model — a used-only store is never assigned a new unit.

    Args:
        config: Resolved configuration. The same configuration always yields the same
            assignment.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A mapping of ``vehicle_id`` to ``dealership_id``, ordered by ``vehicle_id``.
    """
    return {
        record.vehicle_id: record.intended_dealership_id
        for record in build_vehicle_records(config, catalogue_path)
    }


class VehicleGenerator(BaseGenerator):
    """Build one ``warehouse.dim_vehicle`` row per unique physical vehicle."""

    entity_name = ENTITY_DIM_VEHICLE
    declared_columns = DIM_VEHICLE_COLUMNS
    namespace = VEHICLE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the vehicle frame.

        Args:
            config: Resolved configuration; ``generation.scale_mode`` sets the row target
                and ``random_seed`` seeds this entity's dedicated generator.

        Returns:
            A frame with the contract columns, in order, ordered by ``vehicle_key``.
        """
        records = build_vehicle_records(config)
        frame = pd.DataFrame.from_records(
            [_build_row(record) for record in records], columns=list(DIM_VEHICLE_COLUMNS)
        )
        typed = frame.astype(DIM_VEHICLE_DTYPES)
        _log_declared_distributions(typed, records)
        return typed


def generate_vehicle_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_vehicle`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return VehicleGenerator().generate(config)


def validate_vehicle_dataset(
    dataset: GeneratedDataset, models: Sequence[CataloguedModel]
) -> ValidationReport:
    """Run ``DQ-VEH-001`` through ``DQ-VEH-007`` against the vehicle dimension.

    Args:
        dataset: The generated ``dim_vehicle`` dataset.
        models: The catalogued models the vehicles must resolve to.

    Returns:
        A report containing seven results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            replace(
                check_unique_column(
                    frame,
                    "vehicle_id",
                    check_id=CHECK_VEHICLE_UNIQUE_ID,
                    check_name="dim_vehicle.vehicle_id is unique",
                    target_object=ENTITY_DIM_VEHICLE,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            replace(
                check_unique_column(
                    frame,
                    "synthetic_vin",
                    check_id=CHECK_VEHICLE_UNIQUE_VIN,
                    check_name="dim_vehicle.synthetic_vin is unique",
                    target_object=ENTITY_DIM_VEHICLE,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            check_column_schema(
                frame,
                DIM_VEHICLE_COLUMNS,
                check_id=CHECK_VEHICLE_SCHEMA_MATCHES,
                check_name="dim_vehicle matches its declared schema",
                target_object=ENTITY_DIM_VEHICLE,
            ),
            _check_model_resolves(frame, models),
            _check_condition_consistency(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_VEHICLE_NO_PROHIBITED_PII,
                check_name="dim_vehicle declares no prohibited PII column",
                target_object=ENTITY_DIM_VEHICLE,
            ),
            _check_vin_format(frame),
        )
    )


def is_well_formed_synthetic_vin(value: str) -> bool:
    """Report whether a value satisfies the synthetic VIN contract.

    Args:
        value: Candidate VIN.

    Returns:
        ``True`` when the value is exactly 17 characters, starts with ``ARPI`` and draws
        every remaining character from :data:`VIN_ALPHABET`.
    """
    if len(value) != VIN_LENGTH or not value.startswith(VIN_PREFIX):
        return False
    return all(character in VIN_ALPHABET for character in value[len(VIN_PREFIX) :])


def _build_model_pools(
    models: Sequence[CataloguedModel],
) -> dict[tuple[str, str], tuple[tuple[CataloguedModel, ...], tuple[float, ...]]]:
    """Pre-compute the weighted model pool for every (store, condition) combination."""
    pools: dict[tuple[str, str], tuple[tuple[CataloguedModel, ...], tuple[float, ...]]] = {}
    for store, conditions in STORE_CONDITION_WEIGHTS.items():
        for condition in conditions:
            candidates = _eligible_models(models, store, condition)
            if not candidates:
                raise GenerationError(
                    f"No catalogue model is eligible for condition {condition!r} at store "
                    f"{store}. Add qualifying model years or trims to the vehicle model "
                    "catalogue, or lower the profile's model target.",
                    entity=ENTITY_DIM_VEHICLE,
                    store=store,
                    condition_type=condition,
                )
            weights = tuple(_model_popularity(model) for model in candidates)
            pools[(store, condition)] = (candidates, weights)
    return pools


def _eligible_models(
    models: Sequence[CataloguedModel], store: str, condition: str
) -> tuple[CataloguedModel, ...]:
    """Return the models a store may stock in a given condition."""
    if condition == CONDITION_NEW:
        alignment = STORE_FRANCHISE_ALIGNMENT[store]
        return tuple(
            model
            for model in models
            if model.definition.franchise_alignment == alignment
            and model.definition.is_current_model_line
            and model.definition.model_year >= NEW_MODEL_YEAR_FLOOR
        )
    if condition == CONDITION_CERTIFIED:
        alignment = STORE_FRANCHISE_ALIGNMENT[store]
        return tuple(
            model
            for model in models
            if model.definition.franchise_alignment == alignment
            and CERTIFIED_MIN_AGE_YEARS
            <= CATALOGUE_REFERENCE_YEAR - model.definition.model_year
            <= CERTIFIED_MAX_AGE_YEARS
        )
    return tuple(models)


def _model_popularity(model: CataloguedModel) -> float:
    """Assign a stable, non-uniform popularity weight to a catalogue model."""
    index = sum(ord(character) for character in model.vehicle_model_id) % len(
        MODEL_POPULARITY_WEIGHTS
    )
    return MODEL_POPULARITY_WEIGHTS[index]


def _build_record(
    ordinal: int,
    rng: random.Random,
    pools: dict[tuple[str, str], tuple[tuple[CataloguedModel, ...], tuple[float, ...]]],
    used_vins: set[str],
) -> VehicleRecord:
    """Draw one complete vehicle."""
    store = _weighted_choice(rng, STORE_SHARE)
    condition = _weighted_choice(rng, STORE_CONDITION_WEIGHTS[store])
    model = _choose_model(rng, pools, store, condition)
    odometer = _draw_odometer(rng, condition, model.definition.model_year)
    return VehicleRecord(
        vehicle_key=ordinal,
        vehicle_id=vehicle_id_for(ordinal),
        synthetic_vin=_draw_vin(rng, used_vins),
        vehicle_model_key=model.vehicle_model_key,
        vehicle_model_id=model.vehicle_model_id,
        condition_type=condition,
        exterior_color=_weighted_choice(rng, EXTERIOR_COLOR_WEIGHTS),
        interior_color=_weighted_choice(rng, INTERIOR_COLOR_WEIGHTS),
        odometer_reading=odometer,
        odometer_band=odometer_band_for(odometer, condition),
        acquisition_source=_draw_acquisition_source(rng, condition),
        intended_dealership_id=store,
    )


def _choose_model(
    rng: random.Random,
    pools: dict[tuple[str, str], tuple[tuple[CataloguedModel, ...], tuple[float, ...]]],
    store: str,
    condition: str,
) -> CataloguedModel:
    """Pick the model a vehicle is, honouring the store's used-inventory alignment mix."""
    candidates, weights = pools[(store, condition)]
    if condition != CONDITION_USED:
        return rng.choices(candidates, weights=weights, k=1)[0]

    alignment = _weighted_choice(rng, STORE_USED_ALIGNMENT_WEIGHTS[store])
    aligned = [
        (model, weight)
        for model, weight in zip(candidates, weights, strict=True)
        if model.definition.franchise_alignment == alignment
    ]
    if not aligned:
        return rng.choices(candidates, weights=weights, k=1)[0]
    return rng.choices(
        [model for model, _ in aligned], weights=[weight for _, weight in aligned], k=1
    )[0]


def _draw_odometer(rng: random.Random, condition: str, model_year: int) -> int:
    """Draw a plausible reading for a unit's condition and age."""
    if condition == CONDITION_NEW:
        return rng.randint(NEW_ODOMETER_MIN, NEW_ODOMETER_MAX)

    age = max(CATALOGUE_REFERENCE_YEAR - model_year, 0)
    if condition == CONDITION_CERTIFIED:
        reading = rng.randint(7_000, 13_000) * max(age, 1) + rng.randint(-2_000, 2_000)
        return int(min(max(reading, CERTIFIED_MIN_ODOMETER), CERTIFIED_MAX_ODOMETER))

    if age == 0:
        return rng.randint(1_500, 14_000)
    reading = rng.randint(6_000, 18_000) * age + rng.randint(-3_000, 4_000)
    return int(min(max(reading, USED_MIN_ODOMETER), MAX_ODOMETER))


def _draw_acquisition_source(rng: random.Random, condition: str) -> str:
    """Draw how a unit entered inventory, consistent with its condition."""
    if condition == CONDITION_NEW:
        return SOURCE_MANUFACTURER_ALLOCATION
    if condition == CONDITION_CERTIFIED:
        return _weighted_choice(rng, CERTIFIED_SOURCE_WEIGHTS)
    return _weighted_choice(rng, USED_SOURCE_WEIGHTS)


def _draw_vin(rng: random.Random, used_vins: set[str]) -> str:
    """Draw a unique synthetic VIN, redrawing deterministically on collision."""
    for _ in range(VIN_MAX_ATTEMPTS):
        suffix = "".join(rng.choice(VIN_ALPHABET) for _ in range(VIN_RANDOM_LENGTH))
        candidate = f"{VIN_PREFIX}{suffix}"
        if candidate not in used_vins:
            used_vins.add(candidate)
            return candidate
    raise GenerationError(
        f"Could not draw a unique synthetic VIN in {VIN_MAX_ATTEMPTS} attempts after "
        f"{len(used_vins)} vehicles. The VIN keyspace is "
        f"{len(VIN_ALPHABET)}^{VIN_RANDOM_LENGTH}, so this indicates a generator defect "
        "rather than exhaustion.",
        entity=ENTITY_DIM_VEHICLE,
    )


def _weighted_choice(rng: random.Random, weights: dict[str, float]) -> str:
    """Draw one key from a weight mapping, iterating in a stable declared order."""
    keys = list(weights)
    return rng.choices(keys, weights=[weights[key] for key in keys], k=1)[0]


def _build_row(record: VehicleRecord) -> dict[str, Any]:
    """Render one vehicle record as a ``dim_vehicle`` row."""
    return {
        "vehicle_key": record.vehicle_key,
        "vehicle_id": record.vehicle_id,
        "synthetic_vin": record.synthetic_vin,
        "vehicle_model_key": record.vehicle_model_key,
        "vehicle_model_id": record.vehicle_model_id,
        "condition_type": record.condition_type,
        "exterior_color": record.exterior_color,
        "interior_color": record.interior_color,
        "odometer_reading": record.odometer_reading,
        "odometer_band": record.odometer_band,
        "acquisition_source": record.acquisition_source,
        "source_system": SOURCE_SYSTEM,
    }


def _log_declared_distributions(frame: pd.DataFrame, records: Sequence[VehicleRecord]) -> None:
    """Log the condition and store shares actually produced."""
    total = int(frame.shape[0])
    if total == 0:  # pragma: no cover - the generator never produces an empty frame
        return
    condition = frame["condition_type"].value_counts().to_dict()
    stores: dict[str, int] = {}
    for record in records:
        stores[record.intended_dealership_id] = stores.get(record.intended_dealership_id, 0) + 1
    _LOGGER.info(
        "dim_vehicle distributions: rows=%d condition=%s intended_store=%s",
        total,
        {str(key): round(int(value) / total, 4) for key, value in condition.items()},
        {key: round(value / total, 4) for key, value in sorted(stores.items())},
    )


def _check_model_resolves(frame: pd.DataFrame, models: Sequence[CataloguedModel]) -> CheckResult:
    """``DQ-VEH-004`` -- every vehicle resolves to a known, self-consistent model."""
    base = CheckResult(
        check_id=CHECK_VEHICLE_MODEL_RESOLVES,
        check_name="every dim_vehicle row resolves to a known vehicle model",
        target_object=ENTITY_DIM_VEHICLE,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_REFERENTIAL,
        expected_value=0.0,
    )
    required = {"vehicle_model_key", "vehicle_model_id"}
    if not required <= set(frame.columns):
        return base.failed(
            f"{ENTITY_DIM_VEHICLE} is missing {', '.join(sorted(required - set(frame.columns)))}."
        )

    known = {(model.vehicle_model_key, model.vehicle_model_id) for model in models}
    offending = [
        f"{key}/{identifier}"
        for key, identifier in zip(
            frame["vehicle_model_key"], frame["vehicle_model_id"], strict=True
        )
        if (int(key), str(identifier)) not in known
    ]
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} vehicle(s) reference a model that is not in dim_vehicle_model: "
        f"{', '.join(sorted(set(offending))[:5])}.",
        failed_record_count=len(offending),
    )


def _check_condition_consistency(frame: pd.DataFrame) -> CheckResult:
    """``DQ-VEH-005`` -- condition, acquisition source and odometer agree."""
    base = CheckResult(
        check_id=CHECK_VEHICLE_CONDITION_CONSISTENCY,
        check_name="dim_vehicle condition, source and odometer are consistent",
        target_object=ENTITY_DIM_VEHICLE,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        expected_value=0.0,
    )
    required = {"condition_type", "acquisition_source", "odometer_reading", "odometer_band"}
    if not required <= set(frame.columns):
        return base.failed(
            f"{ENTITY_DIM_VEHICLE} is missing {', '.join(sorted(required - set(frame.columns)))}."
        )

    domain_failures = [
        result.message or "domain violation"
        for result in (
            check_values_in_allowed_set(
                frame,
                "condition_type",
                ALLOWED_CONDITION_TYPES,
                check_id=CHECK_VEHICLE_CONDITION_CONSISTENCY,
                check_name="dim_vehicle condition, source and odometer are consistent",
                target_object=ENTITY_DIM_VEHICLE,
            ),
            check_values_in_allowed_set(
                frame,
                "acquisition_source",
                ALLOWED_ACQUISITION_SOURCES,
                check_id=CHECK_VEHICLE_CONDITION_CONSISTENCY,
                check_name="dim_vehicle condition, source and odometer are consistent",
                target_object=ENTITY_DIM_VEHICLE,
            ),
            check_values_in_allowed_set(
                frame,
                "odometer_band",
                ALLOWED_ODOMETER_BANDS,
                check_id=CHECK_VEHICLE_CONDITION_CONSISTENCY,
                check_name="dim_vehicle condition, source and odometer are consistent",
                target_object=ENTITY_DIM_VEHICLE,
            ),
        )
        if result.is_failure
    ]
    offending = _consistency_violations(frame)
    result = replace(base, observed_value=float(len(offending) + len(domain_failures)))
    if not offending and not domain_failures:
        return result
    detail = " ".join([*domain_failures, *offending[:5]])
    return result.failed(
        f"{len(offending)} row(s) violate the condition/source/odometer rules. {detail}",
        failed_record_count=len(offending) + len(domain_failures),
    )


def _consistency_violations(frame: pd.DataFrame) -> list[str]:
    """List the per-row condition, source and odometer violations found."""
    offending: list[str] = []
    columns = ("vehicle_id", "condition_type", "acquisition_source", "odometer_reading")
    for identifier, condition, source, reading in zip(
        *(frame[column] for column in columns), strict=True
    ):
        miles = int(reading)
        if miles < 0:
            offending.append(f"{identifier}: negative odometer_reading {miles}")
            continue
        if str(condition) == CONDITION_NEW and (
            str(source) != SOURCE_MANUFACTURER_ALLOCATION or miles > NEW_ODOMETER_MAX
        ):
            offending.append(f"{identifier}: New unit with source {source!r} and {miles} mile(s)")
            continue
        if str(condition) != CONDITION_NEW and str(source) == SOURCE_MANUFACTURER_ALLOCATION:
            offending.append(f"{identifier}: {condition!r} unit with a manufacturer allocation")
    offending.extend(_band_violations(frame))
    return offending


def _band_violations(frame: pd.DataFrame) -> list[str]:
    """List rows whose ``odometer_band`` disagrees with their reading."""
    offending: list[str] = []
    columns = ("vehicle_id", "condition_type", "odometer_reading", "odometer_band")
    for identifier, condition, reading, band in zip(
        *(frame[column] for column in columns), strict=True
    ):
        miles = int(reading)
        if miles < 0 or (str(condition) == CONDITION_NEW and miles > NEW_ODOMETER_MAX):
            continue
        expected = odometer_band_for(miles, str(condition))
        if str(band) != expected:
            offending.append(
                f"{identifier}: odometer_band {band!r} but {miles} mile(s) band as {expected!r}"
            )
    return offending


def _check_vin_format(frame: pd.DataFrame) -> CheckResult:
    """``DQ-VEH-007`` -- every synthetic VIN satisfies the declared format."""
    base = CheckResult(
        check_id=CHECK_VEHICLE_VIN_FORMAT,
        check_name="dim_vehicle.synthetic_vin is well formed",
        target_object=ENTITY_DIM_VEHICLE,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        expected_value=0.0,
    )
    if "synthetic_vin" not in frame.columns:
        return base.failed(f"{ENTITY_DIM_VEHICLE} is missing 'synthetic_vin'.")

    offending = [
        str(value)
        for value in frame["synthetic_vin"]
        if not is_well_formed_synthetic_vin(str(value))
    ]
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} synthetic VIN(s) are malformed: "
        f"{', '.join(sorted(set(offending))[:5])}. Expected {VIN_LENGTH} characters, the "
        f"{VIN_PREFIX!r} prefix and characters drawn from {VIN_ALPHABET}.",
        failed_record_count=len(offending),
    )
