"""Generator for ``warehouse.dim_vehicle_model`` and its reference catalogue.

The model catalogue is **source-controlled reference data**, not a random draw:
``config/reference/vehicle_model_catalogue.yaml`` declares the model lines, their trims
and their model years, and this module expands that file into one row per
``(model_year, make, model, trim)`` — the declared grain of the dimension.

The catalogue is a *representative synthetic subset*. It is hand-authored for ARPI, it is
not sourced from any manufacturer feed, and it is neither complete nor current. **No
network call is made at any point**: ``features.enable_public_vehicle_enrichment`` stays
``false`` and is never read here.

Every catalogue row is validated before generation. An unknown enumerated value, a
missing field or a duplicate natural key raises :class:`~arpi.exceptions.GenerationError`
naming the offending row, so a bad edit fails loudly rather than producing quietly wrong
reference data.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final

import pandas as pd
import yaml

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    DEFAULT_CONFIG_DIR_NAME,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.logging_config import get_logger
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import (
    check_column_schema,
    check_no_prohibited_pii_columns,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

    from arpi.config import ArpiConfig

_LOGGER = get_logger(__name__)

# ---------------------------------------------------------------------------------------
# Entity identity
# ---------------------------------------------------------------------------------------
ENTITY_DIM_VEHICLE_MODEL: Final = "dim_vehicle_model"

#: Seeding namespace for this entity. Distinct from every other entity's namespace, so
#: adding or removing another generator never perturbs this one's output.
VEHICLE_MODEL_NAMESPACE: Final = "dim_vehicle_model"

VEHICLE_MODEL_ID_PREFIX: Final = "VMD-"
VEHICLE_MODEL_ID_DIGITS: Final = 5

#: Directory (relative to the project root) holding source-controlled reference data.
REFERENCE_DIR_NAME: Final = "reference"
CATALOGUE_FILE_NAME: Final = "vehicle_model_catalogue.yaml"

# ---------------------------------------------------------------------------------------
# Enumerations (exact spellings; shared verbatim with the SQL DDL and the data dictionary)
# ---------------------------------------------------------------------------------------
ALLOWED_BODY_STYLES: Final[tuple[str, ...]] = (
    "Sedan",
    "Coupe",
    "Hatchback",
    "Wagon",
    "SUV",
    "Crossover",
    "Pickup",
    "Van",
    "Convertible",
)
ALLOWED_VEHICLE_CLASSES: Final[tuple[str, ...]] = (
    "Compact",
    "Midsize",
    "Fullsize",
    "Luxury",
    "Sports",
    "Truck",
    "SUV",
    "Van",
)
ALLOWED_FUEL_TYPES: Final[tuple[str, ...]] = (
    "Gasoline",
    "Diesel",
    "Hybrid",
    "Plug-in Hybrid",
    "Electric",
)
ALLOWED_DRIVETRAINS: Final[tuple[str, ...]] = ("FWD", "RWD", "AWD", "4WD")
ALLOWED_TRANSMISSIONS: Final[tuple[str, ...]] = ("Automatic", "Manual", "CVT")

FRANCHISE_ALIGNMENT_CHEVROLET: Final = "Chevrolet"
FRANCHISE_ALIGNMENT_SUBARU: Final = "Subaru"
FRANCHISE_ALIGNMENT_INDEPENDENT: Final = "Independent Used"
ALLOWED_FRANCHISE_ALIGNMENTS: Final[tuple[str, ...]] = (
    FRANCHISE_ALIGNMENT_CHEVROLET,
    FRANCHISE_ALIGNMENT_SUBARU,
    FRANCHISE_ALIGNMENT_INDEPENDENT,
)

MIN_MODEL_YEAR: Final = 1990
MAX_MODEL_YEAR: Final = 2030
MIN_DOORS: Final = 2
MAX_DOORS: Final = 5
MIN_SEATING_CAPACITY: Final = 2
MAX_SEATING_CAPACITY: Final = 8

#: Model year treated as "now" when deciding what counts as a current-model-year unit.
CATALOGUE_REFERENCE_YEAR: Final = 2026

#: A model line is new-eligible from this model year onwards, provided it is still current.
NEW_MODEL_YEAR_FLOOR: Final = CATALOGUE_REFERENCE_YEAR - 2

#: Model years at or below this are treated as the legacy stratum for subset selection.
LEGACY_MODEL_YEAR_CEILING: Final = 2017

#: Every non-empty stratum contributes at least this many rows to the selected subset, so
#: no profile can lose a franchise or an era entirely to proportional rounding.
MIN_ROWS_PER_STRATUM: Final = 2

ERA_CURRENT_NEW: Final = "current_new"
ERA_RECENT: Final = "recent"
ERA_LEGACY: Final = "legacy"

# ---------------------------------------------------------------------------------------
# Column contract (exact names, exact order) -- PHASE1_CONTRACT.md §6
# ---------------------------------------------------------------------------------------
DIM_VEHICLE_MODEL_COLUMNS: Final[tuple[str, ...]] = (
    "vehicle_model_key",
    "vehicle_model_id",
    "model_year",
    "make",
    "model",
    "trim",
    "body_style",
    "vehicle_class",
    "fuel_type",
    "drivetrain",
    "transmission",
    "doors",
    "seating_capacity",
    "franchise_alignment",
    "is_current_model_line",
    "source_system",
)

DIM_VEHICLE_MODEL_DTYPES: Final[dict[str, str]] = {
    "vehicle_model_key": "int32",
    "vehicle_model_id": "string",
    "model_year": "int16",
    "make": "string",
    "model": "string",
    "trim": "string",
    "body_style": "string",
    "vehicle_class": "string",
    "fuel_type": "string",
    "drivetrain": "string",
    "transmission": "string",
    "doors": "int16",
    "seating_capacity": "int16",
    "franchise_alignment": "string",
    "is_current_model_line": "bool",
    "source_system": "string",
}

#: Row counts per scale profile -- PHASE1_CONTRACT.md §11.
VEHICLE_MODEL_SCALE: Final[dict[str, int]] = {
    "test": 40,
    "development": 120,
    "portfolio": 240,
}

# ---------------------------------------------------------------------------------------
# Data-quality checks emitted for this entity
# ---------------------------------------------------------------------------------------
CHECK_VEHICLE_MODEL_UNIQUE_ID: Final = "DQ-VMD-001"
CHECK_VEHICLE_MODEL_UNIQUE_NATURAL_KEY: Final = "DQ-VMD-002"
CHECK_VEHICLE_MODEL_SCHEMA_MATCHES: Final = "DQ-VMD-003"
CHECK_VEHICLE_MODEL_ENUMERATIONS: Final = "DQ-VMD-004"
CHECK_VEHICLE_MODEL_FRANCHISE_ALIGNMENT: Final = "DQ-VMD-005"
CHECK_VEHICLE_MODEL_NO_PROHIBITED_PII: Final = "DQ-VMD-006"

#: Natural key of ``dim_vehicle_model``, in contract order.
VEHICLE_MODEL_NATURAL_KEY: Final[tuple[str, ...]] = ("model_year", "make", "model", "trim")

#: The make each franchise alignment is allowed to carry. ``Independent Used`` accepts any
#: make that is not a franchise brand of the fictional group.
FRANCHISE_ALIGNMENT_MAKES: Final[dict[str, str]] = {
    FRANCHISE_ALIGNMENT_CHEVROLET: "Chevrolet",
    FRANCHISE_ALIGNMENT_SUBARU: "Subaru",
}


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    """Metadata for one data-quality check.

    Field names mirror the cross-agent registry contract exactly, so registering a check
    with the shared registry is a one-line change once that module exists.

    Attributes:
        check_id: Stable identifier, e.g. ``"DQ-VMD-001"``.
        check_name: Short human-readable name.
        category: One of the seven canonical validation categories.
        severity: ``critical``, ``warning`` or ``info``.
        layer: Pipeline layer the check is evaluated in.
        entity: Entity the check applies to.
        description: What the check asserts, in one sentence.
        applies_to: Column or column tuple the check inspects.
    """

    check_id: str
    check_name: str
    category: str
    severity: str
    layer: str
    entity: str
    description: str
    applies_to: str


VEHICLE_MODEL_CHECK_DEFINITIONS: Final[tuple[CheckDefinition, ...]] = (
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_UNIQUE_ID,
        check_name="dim_vehicle_model.vehicle_model_id is unique",
        category=CHECK_CATEGORY_UNIQUENESS,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="No two model rows share a vehicle_model_id.",
        applies_to="vehicle_model_id",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_UNIQUE_NATURAL_KEY,
        check_name="dim_vehicle_model natural key is unique",
        category=CHECK_CATEGORY_UNIQUENESS,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="(model_year, make, model, trim) identifies exactly one row.",
        applies_to="model_year, make, model, trim",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_SCHEMA_MATCHES,
        check_name="dim_vehicle_model matches its declared schema",
        category=CHECK_CATEGORY_STRUCTURAL,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="Column names, order and count match the 16-column contract.",
        applies_to="all columns",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_ENUMERATIONS,
        check_name="dim_vehicle_model enumerated values are valid",
        category=CHECK_CATEGORY_BUSINESS_RULE,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="body_style, vehicle_class, fuel_type, drivetrain and transmission "
        "come from their declared enumerations.",
        applies_to="body_style, vehicle_class, fuel_type, drivetrain, transmission",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_FRANCHISE_ALIGNMENT,
        check_name="dim_vehicle_model franchise alignment agrees with make",
        category=CHECK_CATEGORY_BUSINESS_RULE,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="Chevrolet and Subaru alignments carry that make; every other make "
        "is aligned to Independent Used.",
        applies_to="franchise_alignment, make",
    ),
    CheckDefinition(
        check_id=CHECK_VEHICLE_MODEL_NO_PROHIBITED_PII,
        check_name="dim_vehicle_model declares no prohibited PII column",
        category=CHECK_CATEGORY_PRIVACY,
        severity="critical",
        layer="source",
        entity=ENTITY_DIM_VEHICLE_MODEL,
        description="No column name matches the prohibited personal-data vocabulary.",
        applies_to="all columns",
    ),
)


@dataclass(frozen=True, slots=True)
class VehicleModelDefinition:
    """One catalogue row: a single model year of a single trim of a single model line.

    Attributes:
        model_year: Model year, ``1990``..``2030``.
        make: Manufacturer name, e.g. ``"Chevrolet"``.
        model: Model line name, e.g. ``"Silverado 1500"``.
        trim: Trim name, e.g. ``"High Country"``.
        body_style: One of :data:`ALLOWED_BODY_STYLES`.
        vehicle_class: One of :data:`ALLOWED_VEHICLE_CLASSES`.
        fuel_type: One of :data:`ALLOWED_FUEL_TYPES`.
        drivetrain: One of :data:`ALLOWED_DRIVETRAINS`.
        transmission: One of :data:`ALLOWED_TRANSMISSIONS`.
        doors: Door count, ``2``..``5``.
        seating_capacity: Seat count, ``2``..``8``.
        franchise_alignment: One of :data:`ALLOWED_FRANCHISE_ALIGNMENTS`.
        is_current_model_line: Whether the line is still sold new.
    """

    model_year: int
    make: str
    model: str
    trim: str
    body_style: str
    vehicle_class: str
    fuel_type: str
    drivetrain: str
    transmission: str
    doors: int
    seating_capacity: int
    franchise_alignment: str
    is_current_model_line: bool

    @property
    def natural_key(self) -> tuple[int, str, str, str]:
        """The declared natural key ``(model_year, make, model, trim)``."""
        return (self.model_year, self.make, self.model, self.trim)

    @property
    def era(self) -> str:
        """Selection stratum: current-new, recent or legacy.

        Returns:
            :data:`ERA_CURRENT_NEW` for a current line at or after
            :data:`NEW_MODEL_YEAR_FLOOR`, :data:`ERA_LEGACY` at or below
            :data:`LEGACY_MODEL_YEAR_CEILING`, and :data:`ERA_RECENT` otherwise.
        """
        if self.is_current_model_line and self.model_year >= NEW_MODEL_YEAR_FLOOR:
            return ERA_CURRENT_NEW
        if self.model_year <= LEGACY_MODEL_YEAR_CEILING:
            return ERA_LEGACY
        return ERA_RECENT

    @property
    def stratum(self) -> tuple[str, str]:
        """Selection stratum key ``(franchise_alignment, era)``."""
        return (self.franchise_alignment, self.era)


@dataclass(frozen=True, slots=True)
class CataloguedModel:
    """A selected catalogue row with the surrogate identifiers assigned to it.

    Attributes:
        vehicle_model_key: Deterministic ordinal, ``1..N`` by ``vehicle_model_id``.
        vehicle_model_id: Identifier in the reserved ``VMD-#####`` scheme.
        definition: The catalogue row itself.
    """

    vehicle_model_key: int
    vehicle_model_id: str
    definition: VehicleModelDefinition


def vehicle_model_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as a ``VMD-#####`` identifier.

    Args:
        ordinal: 1-based position in the ordered catalogue subset.

    Returns:
        The zero-padded identifier, e.g. ``"VMD-00042"``.

    Raises:
        GenerationError: If ``ordinal`` is not a positive integer, or is too large for
            the reserved five-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"vehicle_model_id ordinals start at 1, got {ordinal}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    if ordinal >= 10**VEHICLE_MODEL_ID_DIGITS:
        raise GenerationError(
            f"vehicle_model_id ordinal {ordinal} does not fit the reserved "
            f"{VEHICLE_MODEL_ID_PREFIX}{'#' * VEHICLE_MODEL_ID_DIGITS} scheme. Widen the "
            "identifier scheme in PHASE1_CONTRACT.md §5 before generating this many models.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return f"{VEHICLE_MODEL_ID_PREFIX}{ordinal:0{VEHICLE_MODEL_ID_DIGITS}d}"


def default_catalogue_paths() -> tuple[Path, ...]:
    """Return the locations searched for the catalogue when none is supplied.

    Returns:
        The working directory's ``config/reference/`` copy first, then the copy alongside
        an editable source checkout of the package.
    """
    suffix = Path(DEFAULT_CONFIG_DIR_NAME) / REFERENCE_DIR_NAME / CATALOGUE_FILE_NAME
    cwd_candidate = Path.cwd() / suffix
    checkout_candidate = Path(__file__).resolve().parents[3] / suffix
    if checkout_candidate == cwd_candidate:
        return (cwd_candidate,)
    return (cwd_candidate, checkout_candidate)


def resolve_catalogue_path(path: Path | None = None) -> Path:
    """Resolve the catalogue file to read.

    Args:
        path: Explicit catalogue path. When omitted, :func:`default_catalogue_paths` is
            searched in order.

    Returns:
        A path that exists.

    Raises:
        GenerationError: If no catalogue file can be found.
    """
    if path is not None:
        candidate = Path(path)
        if not candidate.is_file():
            raise GenerationError(
                f"Vehicle model catalogue not found: {candidate}.",
                entity=ENTITY_DIM_VEHICLE_MODEL,
            )
        return candidate

    candidates = default_catalogue_paths()
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    rendered = ", ".join(str(candidate) for candidate in candidates)
    raise GenerationError(
        f"No vehicle model catalogue found. Looked in: {rendered}. Run ARPI from the "
        "repository root, or pass an explicit catalogue path.",
        entity=ENTITY_DIM_VEHICLE_MODEL,
    )


def load_vehicle_model_catalogue(path: Path | None = None) -> tuple[VehicleModelDefinition, ...]:
    """Load and validate the vehicle model catalogue.

    Every model line is expanded into one definition per ``(trim, model year)`` pair, and
    every expanded row is validated before any of them is used.

    Args:
        path: Explicit catalogue path; defaults to the source-controlled copy.

    Returns:
        The expanded catalogue rows, in file order.

    Raises:
        GenerationError: If the file cannot be read or parsed, a field is missing, an
            enumerated value is unknown, a numeric value is out of range, or two rows
            share a natural key. The message names the offending row.
    """
    resolved = resolve_catalogue_path(path)
    payload = _read_catalogue_document(resolved)
    model_lines = payload.get("model_lines")
    if not isinstance(model_lines, list) or not model_lines:
        raise GenerationError(
            f"{resolved}: 'model_lines' must be a non-empty list of model line mappings.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )

    definitions: list[VehicleModelDefinition] = []
    for position, line in enumerate(model_lines, start=1):
        definitions.extend(_expand_model_line(line, position, resolved))
    _reject_duplicate_natural_keys(definitions, resolved)
    return tuple(definitions)


def vehicle_model_count_for(config: ArpiConfig) -> int:
    """Return the number of model rows the active profile asks for.

    Args:
        config: Resolved configuration; ``generation.scale_mode`` selects the profile.

    Returns:
        The target row count from :data:`VEHICLE_MODEL_SCALE`.

    Raises:
        GenerationError: If the scale mode has no declared target.
    """
    scale_mode = config.generation.scale_mode
    try:
        return VEHICLE_MODEL_SCALE[scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No dim_vehicle_model row target is declared for scale mode {scale_mode!r}. "
            f"Known modes: {', '.join(sorted(VEHICLE_MODEL_SCALE))}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
            scale_mode=scale_mode,
        ) from error


def select_catalogue_subset(
    catalogue: Sequence[VehicleModelDefinition],
    target_count: int,
    rng: random.Random,
) -> tuple[VehicleModelDefinition, ...]:
    """Choose a deterministic, stratified subset of the catalogue.

    Rows are stratified by ``(franchise_alignment, era)``. Every non-empty stratum
    receives at least :data:`MIN_ROWS_PER_STRATUM` rows, and the remaining budget is
    allocated proportionally to stratum size by the largest-remainder method. Within a
    stratum, rows are drawn from a deterministic shuffle. Stratification is what
    guarantees that every profile — including the 40-row ``test`` profile — still contains
    new-eligible franchise rows, certified-eligible franchise rows and long-tail rows.

    Args:
        catalogue: Validated catalogue rows.
        target_count: Number of rows to select.
        rng: Seeded generator; the same seed always yields the same subset.

    Returns:
        The selected rows, sorted by natural key.

    Raises:
        GenerationError: If the catalogue holds fewer rows than ``target_count``.
    """
    if target_count < 1:
        raise GenerationError(
            f"The dim_vehicle_model row target must be positive, got {target_count}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    if len(catalogue) < target_count:
        raise GenerationError(
            f"The vehicle model catalogue holds {len(catalogue)} row(s) but the active "
            f"profile asks for {target_count}. Add model lines, trims or model years to "
            f"{CATALOGUE_FILE_NAME}, or lower the profile's target.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
            catalogue_size=len(catalogue),
            target_count=target_count,
        )

    strata = _group_by_stratum(catalogue)
    quotas = _allocate_quotas({key: len(rows) for key, rows in strata.items()}, target_count)
    selected: list[VehicleModelDefinition] = []
    for key in sorted(strata):
        rows = sorted(strata[key], key=lambda row: row.natural_key)
        rng.shuffle(rows)
        selected.extend(rows[: quotas[key]])
    return tuple(sorted(selected, key=lambda row: row.natural_key))


def catalogued_models_for(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[CataloguedModel, ...]:
    """Build the ordered, identified model subset for a configuration.

    This is the entry point other generators use: the returned tuple is ordered by
    ``vehicle_model_id``, so a caller can reference ``vehicle_model_key`` and
    ``vehicle_model_id`` without rebuilding the dimension frame.

    Args:
        config: Resolved configuration.
        catalogue_path: Explicit catalogue path; defaults to the source-controlled copy.

    Returns:
        One :class:`CataloguedModel` per selected row, ordered by ``vehicle_model_id``.
    """
    catalogue = load_vehicle_model_catalogue(catalogue_path)
    rng = rng_for(config.random_seed, VEHICLE_MODEL_NAMESPACE)
    selected = select_catalogue_subset(catalogue, vehicle_model_count_for(config), rng)
    return tuple(
        CataloguedModel(
            vehicle_model_key=ordinal,
            vehicle_model_id=vehicle_model_id_for(ordinal),
            definition=definition,
        )
        for ordinal, definition in enumerate(selected, start=1)
    )


class VehicleModelGenerator(BaseGenerator):
    """Expand the source-controlled catalogue into ``warehouse.dim_vehicle_model`` rows."""

    entity_name = ENTITY_DIM_VEHICLE_MODEL
    declared_columns = DIM_VEHICLE_MODEL_COLUMNS
    namespace = VEHICLE_MODEL_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the vehicle model frame.

        Args:
            config: Resolved configuration; ``generation.scale_mode`` sets the row target
                and ``random_seed`` seeds the deterministic subset selection.

        Returns:
            A frame with the 16 contract columns, in order, ordered by
            ``vehicle_model_key``.
        """
        models = catalogued_models_for(config)
        records = [_build_row(model) for model in models]
        frame = pd.DataFrame.from_records(records, columns=list(DIM_VEHICLE_MODEL_COLUMNS))
        typed = frame.astype(DIM_VEHICLE_MODEL_DTYPES)
        _log_declared_distributions(typed)
        return typed


def generate_vehicle_model_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_vehicle_model`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return VehicleModelGenerator().generate(config)


def validate_vehicle_model_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-VMD-001`` through ``DQ-VMD-006`` against the vehicle model dimension.

    Args:
        dataset: The generated ``dim_vehicle_model`` dataset.

    Returns:
        A report containing six results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            replace(
                check_unique_column(
                    frame,
                    "vehicle_model_id",
                    check_id=CHECK_VEHICLE_MODEL_UNIQUE_ID,
                    check_name="dim_vehicle_model.vehicle_model_id is unique",
                    target_object=ENTITY_DIM_VEHICLE_MODEL,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            _check_natural_key_unique(frame),
            check_column_schema(
                frame,
                DIM_VEHICLE_MODEL_COLUMNS,
                check_id=CHECK_VEHICLE_MODEL_SCHEMA_MATCHES,
                check_name="dim_vehicle_model matches its declared schema",
                target_object=ENTITY_DIM_VEHICLE_MODEL,
            ),
            _check_enumerations(frame),
            _check_franchise_alignment(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_VEHICLE_MODEL_NO_PROHIBITED_PII,
                check_name="dim_vehicle_model declares no prohibited PII column",
                target_object=ENTITY_DIM_VEHICLE_MODEL,
            ),
        )
    )


def _build_row(model: CataloguedModel) -> dict[str, Any]:
    """Render one catalogued model as a ``dim_vehicle_model`` row."""
    definition = model.definition
    return {
        "vehicle_model_key": model.vehicle_model_key,
        "vehicle_model_id": model.vehicle_model_id,
        "model_year": definition.model_year,
        "make": definition.make,
        "model": definition.model,
        "trim": definition.trim,
        "body_style": definition.body_style,
        "vehicle_class": definition.vehicle_class,
        "fuel_type": definition.fuel_type,
        "drivetrain": definition.drivetrain,
        "transmission": definition.transmission,
        "doors": definition.doors,
        "seating_capacity": definition.seating_capacity,
        "franchise_alignment": definition.franchise_alignment,
        "is_current_model_line": definition.is_current_model_line,
        "source_system": SOURCE_SYSTEM,
    }


def _log_declared_distributions(frame: pd.DataFrame) -> None:
    """Log the drivetrain and body-style shares actually produced."""
    total = int(frame.shape[0])
    if total == 0:  # pragma: no cover - the generator never produces an empty frame
        return
    drivetrain = frame["drivetrain"].value_counts().to_dict()
    body_style = frame["body_style"].value_counts().to_dict()
    _LOGGER.info(
        "dim_vehicle_model distributions: rows=%d drivetrain=%s body_style=%s",
        total,
        {str(key): round(int(value) / total, 4) for key, value in drivetrain.items()},
        {str(key): round(int(value) / total, 4) for key, value in body_style.items()},
    )


def _read_catalogue_document(path: Path) -> dict[str, Any]:
    """Read the catalogue YAML and confirm it is a mapping."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        raise GenerationError(
            f"Could not parse the vehicle model catalogue at {path}: {error}",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        ) from error
    except OSError as error:
        raise GenerationError(
            f"Could not read the vehicle model catalogue at {path}: {error}",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        ) from error
    if not isinstance(raw, dict):
        raise GenerationError(
            f"{path}: the vehicle model catalogue must be a YAML mapping, found "
            f"{type(raw).__name__}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return raw


def _expand_model_line(line: Any, position: int, path: Path) -> list[VehicleModelDefinition]:
    """Validate one model line and expand it into per-trim, per-year definitions."""
    label = f"{path.name} model_lines[{position}]"
    if not isinstance(line, dict):
        raise GenerationError(
            f"{label}: each model line must be a mapping, found {type(line).__name__}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )

    make = _require_text(line, "make", label)
    model = _require_text(line, "model", label)
    label = f"{label} ({make} {model})"
    shared = _line_attributes(line, label)
    trims = line.get("trims")
    if not isinstance(trims, list) or not trims:
        raise GenerationError(
            f"{label}: 'trims' must be a non-empty list.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )

    definitions: list[VehicleModelDefinition] = []
    for trim_position, trim in enumerate(trims, start=1):
        definitions.extend(
            _expand_trim(trim, f"{label} trims[{trim_position}]", make, model, shared)
        )
    return definitions


def _line_attributes(line: dict[str, Any], label: str) -> dict[str, Any]:
    """Validate and collect the attributes shared by every trim of a model line."""
    is_current = _require_bool(line, "is_current_model_line", label)
    model_years = _require_year_list(line, "model_years", label)
    if not is_current and max(model_years) > CATALOGUE_REFERENCE_YEAR - 1:
        raise GenerationError(
            f"{label}: a model line with is_current_model_line=false must not carry a "
            f"model year later than {CATALOGUE_REFERENCE_YEAR - 1}, found "
            f"{max(model_years)}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return {
        "body_style": _require_enum(line, "body_style", ALLOWED_BODY_STYLES, label),
        "vehicle_class": _require_enum(line, "vehicle_class", ALLOWED_VEHICLE_CLASSES, label),
        "franchise_alignment": _require_enum(
            line, "franchise_alignment", ALLOWED_FRANCHISE_ALIGNMENTS, label
        ),
        "doors": _require_int(line, "doors", label, MIN_DOORS, MAX_DOORS),
        "seating_capacity": _require_int(
            line, "seating_capacity", label, MIN_SEATING_CAPACITY, MAX_SEATING_CAPACITY
        ),
        "is_current_model_line": is_current,
        "model_years": model_years,
    }


def _expand_trim(
    trim: Any,
    label: str,
    make: str,
    model: str,
    shared: dict[str, Any],
) -> list[VehicleModelDefinition]:
    """Validate one trim and expand it across its model years."""
    if not isinstance(trim, dict):
        raise GenerationError(
            f"{label}: each trim must be a mapping, found {type(trim).__name__}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    trim_name = _require_text(trim, "trim", label)
    label = f"{label} (trim {trim_name!r})"
    doors = (
        _require_int(trim, "doors", label, MIN_DOORS, MAX_DOORS)
        if "doors" in trim
        else int(shared["doors"])
    )
    seating = (
        _require_int(trim, "seating_capacity", label, MIN_SEATING_CAPACITY, MAX_SEATING_CAPACITY)
        if "seating_capacity" in trim
        else int(shared["seating_capacity"])
    )
    model_years = (
        _require_year_list(trim, "model_years", label)
        if "model_years" in trim
        else list(shared["model_years"])
    )
    template = VehicleModelDefinition(
        model_year=model_years[0],
        make=make,
        model=model,
        trim=trim_name,
        body_style=str(shared["body_style"]),
        vehicle_class=str(shared["vehicle_class"]),
        fuel_type=_require_enum(trim, "fuel_type", ALLOWED_FUEL_TYPES, label),
        drivetrain=_require_enum(trim, "drivetrain", ALLOWED_DRIVETRAINS, label),
        transmission=_require_enum(trim, "transmission", ALLOWED_TRANSMISSIONS, label),
        doors=doors,
        seating_capacity=seating,
        franchise_alignment=str(shared["franchise_alignment"]),
        is_current_model_line=bool(shared["is_current_model_line"]),
    )
    return [replace(template, model_year=year) for year in model_years]


def _reject_duplicate_natural_keys(
    definitions: Sequence[VehicleModelDefinition], path: Path
) -> None:
    """Fail if two expanded catalogue rows share ``(model_year, make, model, trim)``."""
    seen: set[tuple[int, str, str, str]] = set()
    for definition in definitions:
        key = definition.natural_key
        if key in seen:
            raise GenerationError(
                f"{path.name}: duplicate vehicle model natural key "
                f"(model_year={key[0]}, make={key[1]!r}, model={key[2]!r}, trim={key[3]!r}). "
                "Each (model_year, make, model, trim) combination may appear only once.",
                entity=ENTITY_DIM_VEHICLE_MODEL,
            )
        seen.add(key)


def _group_by_stratum(
    catalogue: Sequence[VehicleModelDefinition],
) -> dict[tuple[str, str], list[VehicleModelDefinition]]:
    """Bucket catalogue rows by ``(franchise_alignment, era)``."""
    strata: dict[tuple[str, str], list[VehicleModelDefinition]] = {}
    for definition in catalogue:
        strata.setdefault(definition.stratum, []).append(definition)
    return strata


def _allocate_quotas(
    sizes: dict[tuple[str, str], int], target_count: int
) -> dict[tuple[str, str], int]:
    """Split ``target_count`` across strata with a floor and largest-remainder rounding.

    Every stratum first receives :data:`MIN_ROWS_PER_STRATUM` rows (or its whole size, or
    as many as the target affords). The balance is shared out in proportion to the rows
    each stratum still has spare, with fractional entitlements resolved largest remainder
    first. Ties break on the stratum key, so the split is fully deterministic.
    """
    keys = sorted(sizes)
    floor = min(MIN_ROWS_PER_STRATUM, target_count // max(len(keys), 1))
    quotas = {key: min(floor, sizes[key]) for key in keys}
    while sum(quotas.values()) > target_count:
        largest = max(keys, key=lambda candidate: (quotas[candidate], candidate))
        quotas[largest] -= 1
    remaining = target_count - sum(quotas.values())
    if remaining > 0:
        _distribute_remainder(quotas, sizes, keys, remaining)
    return quotas


def _distribute_remainder(
    quotas: dict[tuple[str, str], int],
    sizes: dict[tuple[str, str], int],
    keys: Sequence[tuple[str, str]],
    remaining: int,
) -> None:
    """Share ``remaining`` rows across strata in proportion to their spare capacity."""
    target_total = sum(quotas.values()) + remaining
    headroom = {key: sizes[key] - quotas[key] for key in keys}
    total_headroom = sum(headroom.values())
    entitlement = {
        key: (remaining * headroom[key] / total_headroom) if total_headroom else 0.0 for key in keys
    }
    for key in keys:
        quotas[key] += min(int(entitlement[key]), headroom[key])
    order = sorted(keys, key=lambda candidate: (-(entitlement[candidate] % 1.0), candidate))
    position = 0
    while sum(quotas.values()) < target_total:
        key = order[position % len(order)]
        if quotas[key] < sizes[key]:
            quotas[key] += 1
        position += 1


def _require_text(payload: dict[str, Any], key: str, label: str) -> str:
    """Read a required non-empty text field."""
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise GenerationError(
            f"{label}: {key!r} is required and must be non-empty text, got {value!r}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return value.strip()


def _require_bool(payload: dict[str, Any], key: str, label: str) -> bool:
    """Read a required boolean field."""
    value = payload.get(key)
    if not isinstance(value, bool):
        raise GenerationError(
            f"{label}: {key!r} is required and must be true or false, got {value!r}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return value


def _require_int(payload: dict[str, Any], key: str, label: str, minimum: int, maximum: int) -> int:
    """Read a required integer field inside an inclusive range."""
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise GenerationError(
            f"{label}: {key!r} is required and must be an integer, got {value!r}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    if not minimum <= value <= maximum:
        raise GenerationError(
            f"{label}: {key!r} must be between {minimum} and {maximum}, got {value}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return value


def _require_enum(payload: dict[str, Any], key: str, allowed: Sequence[str], label: str) -> str:
    """Read a required field whose value must come from a declared enumeration."""
    value = payload.get(key)
    if value not in allowed:
        raise GenerationError(
            f"{label}: {key!r} must be one of {', '.join(allowed)}, got {value!r}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    return str(value)


def _require_year_list(payload: dict[str, Any], key: str, label: str) -> list[int]:
    """Read a required non-empty list of in-range, non-repeating model years."""
    value = payload.get(key)
    if not isinstance(value, list) or not value:
        raise GenerationError(
            f"{label}: {key!r} is required and must be a non-empty list of model years, "
            f"got {value!r}.",
            entity=ENTITY_DIM_VEHICLE_MODEL,
        )
    years: list[int] = []
    for entry in value:
        if not isinstance(entry, int) or isinstance(entry, bool):
            raise GenerationError(
                f"{label}: every entry of {key!r} must be an integer model year, got {entry!r}.",
                entity=ENTITY_DIM_VEHICLE_MODEL,
            )
        if not MIN_MODEL_YEAR <= entry <= MAX_MODEL_YEAR:
            raise GenerationError(
                f"{label}: model year {entry} is outside the allowed range "
                f"{MIN_MODEL_YEAR}..{MAX_MODEL_YEAR}.",
                entity=ENTITY_DIM_VEHICLE_MODEL,
            )
        if entry in years:
            raise GenerationError(
                f"{label}: model year {entry} is listed more than once in {key!r}.",
                entity=ENTITY_DIM_VEHICLE_MODEL,
            )
        years.append(entry)
    return years


def _check_natural_key_unique(frame: pd.DataFrame) -> CheckResult:
    """``DQ-VMD-002`` -- the declared natural key identifies exactly one row."""
    base = CheckResult(
        check_id=CHECK_VEHICLE_MODEL_UNIQUE_NATURAL_KEY,
        check_name="dim_vehicle_model natural key is unique",
        target_object=ENTITY_DIM_VEHICLE_MODEL,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_UNIQUENESS,
    )
    missing = [column for column in VEHICLE_MODEL_NATURAL_KEY if column not in frame.columns]
    if missing:
        return base.failed(
            f"Natural-key column(s) absent from {ENTITY_DIM_VEHICLE_MODEL}: {', '.join(missing)}."
        )
    total = int(frame.shape[0])
    distinct = int(frame[list(VEHICLE_MODEL_NATURAL_KEY)].drop_duplicates().shape[0])
    result = replace(base, observed_value=float(distinct), expected_value=float(total))
    if distinct == total:
        return result
    return result.failed(
        f"(model_year, make, model, trim) has {total - distinct} duplicate combination(s) "
        f"across {total} row(s).",
        failed_record_count=total - distinct,
    )


def _check_enumerations(frame: pd.DataFrame) -> CheckResult:
    """``DQ-VMD-004`` -- every enumerated column draws from its declared domain."""
    domains = {
        "body_style": ALLOWED_BODY_STYLES,
        "vehicle_class": ALLOWED_VEHICLE_CLASSES,
        "fuel_type": ALLOWED_FUEL_TYPES,
        "drivetrain": ALLOWED_DRIVETRAINS,
        "transmission": ALLOWED_TRANSMISSIONS,
        "franchise_alignment": ALLOWED_FRANCHISE_ALIGNMENTS,
    }
    failures: list[str] = []
    offending = 0
    for column, allowed in domains.items():
        result = check_values_in_allowed_set(
            frame,
            column,
            allowed,
            check_id=CHECK_VEHICLE_MODEL_ENUMERATIONS,
            check_name="dim_vehicle_model enumerated values are valid",
            target_object=ENTITY_DIM_VEHICLE_MODEL,
        )
        if result.is_failure:
            failures.append(result.message or column)
            offending += result.failed_record_count
    base = CheckResult(
        check_id=CHECK_VEHICLE_MODEL_ENUMERATIONS,
        check_name="dim_vehicle_model enumerated values are valid",
        target_object=ENTITY_DIM_VEHICLE_MODEL,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        observed_value=float(offending),
        expected_value=0.0,
    )
    if not failures:
        return base
    return base.failed(" ".join(failures), failed_record_count=offending)


def _check_franchise_alignment(frame: pd.DataFrame) -> CheckResult:
    """``DQ-VMD-005`` -- franchise alignment agrees with the make it claims."""
    base = CheckResult(
        check_id=CHECK_VEHICLE_MODEL_FRANCHISE_ALIGNMENT,
        check_name="dim_vehicle_model franchise alignment agrees with make",
        target_object=ENTITY_DIM_VEHICLE_MODEL,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        expected_value=0.0,
    )
    if not {"franchise_alignment", "make"} <= set(frame.columns):
        return base.failed(
            f"{ENTITY_DIM_VEHICLE_MODEL} is missing 'franchise_alignment' or 'make'."
        )

    franchise_makes = set(FRANCHISE_ALIGNMENT_MAKES.values())
    offending: list[str] = []
    for alignment, make in zip(frame["franchise_alignment"], frame["make"], strict=True):
        expected = FRANCHISE_ALIGNMENT_MAKES.get(str(alignment))
        aligned = (
            str(make) == expected if expected is not None else str(make) not in franchise_makes
        )
        if not aligned:
            offending.append(f"{alignment}/{make}")
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        "franchise_alignment disagrees with make for "
        f"{len(offending)} row(s): {', '.join(sorted(set(offending)))}.",
        failed_record_count=len(offending),
    )
