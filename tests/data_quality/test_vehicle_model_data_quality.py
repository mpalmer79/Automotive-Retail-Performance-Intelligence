"""Data-quality assertions over the generated vehicle model dimension.

Distribution assertions are stated as **bands**, never as exact figures: the catalogue
subset is a deterministic draw, and pinning an exact share would turn any future catalogue
edit into a false failure. The thresholds below are the documented tolerances.
"""

from __future__ import annotations

import pytest

from arpi.config import ArpiConfig
from arpi.constants import SOURCE_SYSTEM
from arpi.generation import vehicle_model as vehicle_model_module
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.vehicle import generate_vehicle_dataset
from arpi.generation.vehicle_model import (
    ALLOWED_BODY_STYLES,
    ALLOWED_DRIVETRAINS,
    ALLOWED_FRANCHISE_ALIGNMENTS,
    ALLOWED_FUEL_TYPES,
    ALLOWED_TRANSMISSIONS,
    ALLOWED_VEHICLE_CLASSES,
    DIM_VEHICLE_MODEL_COLUMNS,
    ENTITY_DIM_VEHICLE_MODEL,
    FRANCHISE_ALIGNMENT_SUBARU,
    VEHICLE_MODEL_CHECK_DEFINITIONS,
    VEHICLE_MODEL_NAMESPACE,
    VEHICLE_MODEL_SCALE,
    generate_vehicle_model_dataset,
    validate_vehicle_model_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.utilities.seeding import derive_seed

pytestmark = pytest.mark.data_quality

#: The seven canonical validation categories (PHASE1_CONTRACT.md §2).
CANONICAL_CATEGORIES = frozenset(
    {
        "structural",
        "completeness",
        "uniqueness",
        "referential",
        "business_rule",
        "privacy",
        "reproducibility",
    }
)

# Documented distribution tolerances.
MIN_AWD_SHARE = 0.32
MAX_AWD_SHARE = 0.68
MIN_SUBARU_AWD_SHARE = 0.80
MAX_DRIVETRAIN_SHARE = 0.70
MAX_BODY_STYLE_SHARE = 0.60
MAX_TRIM_SHARE = 0.20
MAX_MODEL_YEAR_SHARE = 0.30
# Gasoline legitimately dominates a 2016-2026 catalogue; the band records that rather
# than pretending the fuel mix is balanced.
MAX_FUEL_TYPE_SHARE = 0.95
MIN_DISTINCT_BODY_STYLES = 6
MIN_DISTINCT_MODEL_YEARS = 8


@pytest.fixture
def vehicle_model_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_vehicle_model`` dataset for the ``test`` profile."""
    return generate_vehicle_model_dataset(test_config)


@pytest.fixture
def development_vehicle_model_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_vehicle_model`` dataset for the ``development`` profile."""
    return generate_vehicle_model_dataset(development_config)


# ---------------------------------------------------------------------------------------
# Schema and scale
# ---------------------------------------------------------------------------------------


def test_column_set_and_order_match_the_contract(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    assert vehicle_model_dataset.actual_columns == DIM_VEHICLE_MODEL_COLUMNS
    assert len(DIM_VEHICLE_MODEL_COLUMNS) == 16


def test_row_count_matches_the_profile_scale(
    vehicle_model_dataset: GeneratedDataset,
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    assert vehicle_model_dataset.row_count == VEHICLE_MODEL_SCALE["test"] == 40
    assert development_vehicle_model_dataset.row_count == VEHICLE_MODEL_SCALE["development"] == 120


def test_every_row_is_synthetic_and_fully_populated(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    frame = vehicle_model_dataset.frame
    assert set(frame["source_system"]) == {SOURCE_SYSTEM}
    assert not frame.isna().to_numpy().any()


def test_natural_key_is_unique(development_vehicle_model_dataset: GeneratedDataset) -> None:
    frame = development_vehicle_model_dataset.frame
    natural_key = frame[["model_year", "make", "model", "trim"]]
    assert len(natural_key.drop_duplicates()) == len(frame)


def test_no_prohibited_pii_column_is_declared(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    report = validate_vehicle_model_dataset(vehicle_model_dataset)
    privacy = next(result for result in report.results if result.check_id == "DQ-VMD-006")
    assert not privacy.is_failure
    for column in DIM_VEHICLE_MODEL_COLUMNS:
        assert not column.endswith("_name")


# ---------------------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------------------


def test_drivetrain_is_awd_elevated_but_not_universal(
    vehicle_model_dataset: GeneratedDataset,
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    for dataset in (vehicle_model_dataset, development_vehicle_model_dataset):
        shares = dataset.frame["drivetrain"].value_counts(normalize=True)
        assert MIN_AWD_SHARE <= shares["AWD"] <= MAX_AWD_SHARE
        assert len(shares) >= 3
        assert shares.max() <= MAX_DRIVETRAIN_SHARE


def test_subaru_is_heavily_but_not_entirely_awd(
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_model_dataset.frame
    subaru = frame[frame["franchise_alignment"] == FRANCHISE_ALIGNMENT_SUBARU]
    awd_share = (subaru["drivetrain"] == "AWD").mean()
    assert MIN_SUBARU_AWD_SHARE <= awd_share < 1.0


def test_every_franchise_alignment_is_represented(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    alignments = set(vehicle_model_dataset.frame["franchise_alignment"])
    assert alignments == set(ALLOWED_FRANCHISE_ALIGNMENTS)


def test_body_style_and_trim_distributions_are_non_degenerate(
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_model_dataset.frame
    body_style = frame["body_style"].value_counts(normalize=True)
    assert len(body_style) >= MIN_DISTINCT_BODY_STYLES
    assert body_style.max() <= MAX_BODY_STYLE_SHARE
    assert frame["trim"].value_counts(normalize=True).max() <= MAX_TRIM_SHARE


def test_model_years_span_the_reporting_window_and_prior_years(
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    years = development_vehicle_model_dataset.frame["model_year"]
    assert years.min() <= 2017
    assert years.max() >= 2025
    assert years.nunique() >= MIN_DISTINCT_MODEL_YEARS
    assert years.value_counts(normalize=True).max() <= MAX_MODEL_YEAR_SHARE


def test_fuel_type_and_transmission_stay_inside_their_declared_domains(
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_model_dataset.frame
    assert set(frame["fuel_type"]) <= set(ALLOWED_FUEL_TYPES)
    assert set(frame["transmission"]) <= set(ALLOWED_TRANSMISSIONS)
    assert set(frame["body_style"]) <= set(ALLOWED_BODY_STYLES)
    assert set(frame["vehicle_class"]) <= set(ALLOWED_VEHICLE_CLASSES)
    assert set(frame["drivetrain"]) <= set(ALLOWED_DRIVETRAINS)
    assert frame["fuel_type"].nunique() >= 3
    assert frame["fuel_type"].value_counts(normalize=True).max() <= MAX_FUEL_TYPE_SHARE


# ---------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# ---------------------------------------------------------------------------------------


def test_output_is_byte_identical_for_the_same_seed(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_the_model_namespace_is_distinct_from_every_other_entity(
    test_config: ArpiConfig,
) -> None:
    seed = test_config.random_seed
    namespaces = ("dim_date", "dim_dealership", "dim_vehicle", VEHICLE_MODEL_NAMESPACE)
    derived = {derive_seed(seed, namespace) for namespace in namespaces}
    assert len(derived) == len(namespaces)


def test_generating_the_vehicle_entity_does_not_perturb_this_one(
    test_config: ArpiConfig,
) -> None:
    baseline = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )
    generate_vehicle_dataset(test_config)
    after = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )
    assert after == baseline


def test_changing_the_vehicle_sub_seed_leaves_the_model_digest_alone(
    test_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )
    monkeypatch.setattr("arpi.generation.vehicle.VEHICLE_NAMESPACE", "dim_vehicle_variant")
    generate_vehicle_dataset(test_config)
    after = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )
    assert after == baseline


def test_changing_the_model_sub_seed_leaves_the_foundation_entities_alone(
    test_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    date_digest = content_digest(dataframe_to_csv_bytes(generate_date_dataset(test_config).frame))
    store_digest = content_digest(
        dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
    )
    baseline = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )

    monkeypatch.setattr(
        vehicle_model_module, "VEHICLE_MODEL_NAMESPACE", "dim_vehicle_model_variant"
    )
    changed = content_digest(
        dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
    )
    assert changed != baseline
    assert (
        content_digest(dataframe_to_csv_bytes(generate_date_dataset(test_config).frame))
        == date_digest
    )
    assert (
        content_digest(dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame))
        == store_digest
    )


# ---------------------------------------------------------------------------------------
# Declared checks
# ---------------------------------------------------------------------------------------


def test_every_declared_check_passes_on_generated_data(
    development_vehicle_model_dataset: GeneratedDataset,
) -> None:
    report = validate_vehicle_model_dataset(development_vehicle_model_dataset)
    assert not report.has_critical_failure
    assert len(report) == len(VEHICLE_MODEL_CHECK_DEFINITIONS)


def test_every_emitted_check_is_declared(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    report = validate_vehicle_model_dataset(vehicle_model_dataset)
    emitted = [result.check_id for result in report.results]
    declared = [definition.check_id for definition in VEHICLE_MODEL_CHECK_DEFINITIONS]
    assert emitted == declared
    assert len(set(declared)) == len(declared)


def test_declared_checks_use_canonical_metadata() -> None:
    for definition in VEHICLE_MODEL_CHECK_DEFINITIONS:
        assert definition.check_id.startswith("DQ-VMD-")
        assert definition.category in CANONICAL_CATEGORIES
        assert definition.entity == ENTITY_DIM_VEHICLE_MODEL
        assert definition.severity == "critical"


def test_emitted_results_carry_canonical_categories(
    vehicle_model_dataset: GeneratedDataset,
) -> None:
    report = validate_vehicle_model_dataset(vehicle_model_dataset)
    declared = {
        definition.check_id: definition.category for definition in VEHICLE_MODEL_CHECK_DEFINITIONS
    }
    for result in report.results:
        assert result.check_category in CANONICAL_CATEGORIES
        assert result.check_category == declared[result.check_id]
