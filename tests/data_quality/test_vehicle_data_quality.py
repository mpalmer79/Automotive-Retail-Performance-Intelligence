"""Data-quality assertions over the generated vehicle dimension.

Every distribution assertion is a **band** with a documented threshold. The point is to
prove the population is neither uniform nor degenerate, not to freeze a particular draw.
"""

from __future__ import annotations

from collections import Counter

import pytest

from arpi.config import ArpiConfig
from arpi.constants import PROHIBITED_PII_FIELD_NAMES, SOURCE_SYSTEM
from arpi.generation import vehicle as vehicle_module
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.vehicle import (
    ALLOWED_ACQUISITION_SOURCES,
    ALLOWED_CONDITION_TYPES,
    ALLOWED_ODOMETER_BANDS,
    CONDITION_CERTIFIED,
    CONDITION_NEW,
    CONDITION_USED,
    DIM_VEHICLE_COLUMNS,
    ENTITY_DIM_VEHICLE,
    SOURCE_MANUFACTURER_ALLOCATION,
    STORE_CHEVROLET,
    STORE_IDS,
    STORE_INDEPENDENT_USED,
    STORE_SHARE,
    STORE_SUBARU,
    VEHICLE_CHECK_DEFINITIONS,
    VEHICLE_NAMESPACE,
    VEHICLE_SCALE,
    build_vehicle_records,
    generate_vehicle_dataset,
    intended_store_assignments,
    validate_vehicle_dataset,
)
from arpi.generation.vehicle_model import catalogued_models_for, generate_vehicle_model_dataset
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest

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

# Documented non-degeneracy thresholds: no single value of these columns may hold more
# than this share of the population.
MAX_EXTERIOR_COLOR_SHARE = 0.30
MAX_INTERIOR_COLOR_SHARE = 0.45
MAX_CONDITION_SHARE = 0.70
MAX_ACQUISITION_SOURCE_SHARE = 0.50
MAX_MODEL_SHARE = 0.15
MIN_DISTINCT_EXTERIOR_COLORS = 8
MIN_DISTINCT_INTERIOR_COLORS = 5
#: Tolerance applied to each store's declared share of the population.
STORE_SHARE_TOLERANCE = 0.07


@pytest.fixture
def vehicle_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_vehicle`` dataset for the ``test`` profile."""
    return generate_vehicle_dataset(test_config)


@pytest.fixture
def development_vehicle_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_vehicle`` dataset for the ``development`` profile."""
    return generate_vehicle_dataset(development_config)


# ---------------------------------------------------------------------------------------
# Schema and scale
# ---------------------------------------------------------------------------------------


def test_column_set_and_order_match_the_contract(vehicle_dataset: GeneratedDataset) -> None:
    assert vehicle_dataset.actual_columns == DIM_VEHICLE_COLUMNS
    assert DIM_VEHICLE_COLUMNS == (
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


def test_row_count_matches_the_profile_scale(
    vehicle_dataset: GeneratedDataset, development_vehicle_dataset: GeneratedDataset
) -> None:
    assert vehicle_dataset.row_count == VEHICLE_SCALE["test"] == 60
    assert development_vehicle_dataset.row_count == VEHICLE_SCALE["development"] == 900


def test_every_row_is_synthetic_and_fully_populated(
    vehicle_dataset: GeneratedDataset,
) -> None:
    frame = vehicle_dataset.frame
    assert set(frame["source_system"]) == {SOURCE_SYSTEM}
    assert not frame.isna().to_numpy().any()
    assert (frame["odometer_reading"] >= 0).all()


def test_identifiers_and_vins_are_unique_at_development_scale(
    development_vehicle_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_dataset.frame
    assert frame["vehicle_id"].nunique() == len(frame)
    assert frame["synthetic_vin"].nunique() == len(frame)


def test_no_prohibited_pii_column_is_declared(vehicle_dataset: GeneratedDataset) -> None:
    for column in DIM_VEHICLE_COLUMNS:
        assert column not in PROHIBITED_PII_FIELD_NAMES
        assert not column.endswith("_name")
    report = validate_vehicle_dataset(vehicle_dataset, ())
    privacy = next(result for result in report.results if result.check_id == "DQ-VEH-006")
    assert not privacy.is_failure


def test_the_dimension_holds_no_owner_or_store_relationship() -> None:
    assert "dealership_id" not in DIM_VEHICLE_COLUMNS
    assert "dealership_key" not in DIM_VEHICLE_COLUMNS
    assert "customer_id" not in DIM_VEHICLE_COLUMNS
    assert "customer_key" not in DIM_VEHICLE_COLUMNS


# ---------------------------------------------------------------------------------------
# Store mix
# ---------------------------------------------------------------------------------------


def test_all_three_stores_are_represented(test_config: ArpiConfig) -> None:
    assignments = intended_store_assignments(test_config)
    assert set(assignments.values()) == set(STORE_IDS)


def test_store_shares_sit_inside_the_declared_band(development_config: ArpiConfig) -> None:
    assignments = intended_store_assignments(development_config)
    counts = Counter(assignments.values())
    total = len(assignments)
    for store, declared in STORE_SHARE.items():
        assert abs(counts[store] / total - declared) <= STORE_SHARE_TOLERANCE


def test_the_independent_used_store_never_holds_a_new_unit(
    development_config: ArpiConfig,
) -> None:
    records = build_vehicle_records(development_config)
    independent = [
        record for record in records if record.intended_dealership_id == STORE_INDEPENDENT_USED
    ]
    assert independent
    assert CONDITION_NEW not in {record.condition_type for record in independent}
    assert CONDITION_CERTIFIED not in {record.condition_type for record in independent}
    assert SOURCE_MANUFACTURER_ALLOCATION not in {
        record.acquisition_source for record in independent
    }


def test_condition_mix_differs_between_stores(development_config: ArpiConfig) -> None:
    records = build_vehicle_records(development_config)
    totals = Counter(record.intended_dealership_id for record in records)
    new_counts = Counter(
        record.intended_dealership_id for record in records if record.condition_type == CONDITION_NEW
    )
    chevrolet_share = new_counts[STORE_CHEVROLET] / totals[STORE_CHEVROLET]
    subaru_share = new_counts[STORE_SUBARU] / totals[STORE_SUBARU]
    assert chevrolet_share > 0
    assert subaru_share > 0
    assert chevrolet_share != subaru_share
    assert new_counts[STORE_INDEPENDENT_USED] == 0


# ---------------------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------------------


def test_colour_distributions_are_non_degenerate(
    development_vehicle_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_dataset.frame
    exterior = frame["exterior_color"].value_counts(normalize=True)
    interior = frame["interior_color"].value_counts(normalize=True)
    assert len(exterior) >= MIN_DISTINCT_EXTERIOR_COLORS
    assert exterior.max() <= MAX_EXTERIOR_COLOR_SHARE
    assert len(interior) >= MIN_DISTINCT_INTERIOR_COLORS
    assert interior.max() <= MAX_INTERIOR_COLOR_SHARE


def test_condition_and_source_distributions_are_non_degenerate(
    development_vehicle_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_dataset.frame
    condition = frame["condition_type"].value_counts(normalize=True)
    source = frame["acquisition_source"].value_counts(normalize=True)
    assert set(condition.index) == set(ALLOWED_CONDITION_TYPES)
    assert condition.max() <= MAX_CONDITION_SHARE
    assert set(source.index) == set(ALLOWED_ACQUISITION_SOURCES)
    assert source.max() <= MAX_ACQUISITION_SOURCE_SHARE


def test_model_and_band_distributions_are_non_degenerate(
    development_vehicle_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_dataset.frame
    assert frame["vehicle_model_id"].value_counts(normalize=True).max() <= MAX_MODEL_SHARE
    assert set(frame["odometer_band"]) == set(ALLOWED_ODOMETER_BANDS)


def test_used_units_are_materially_more_worn_than_new_units(
    development_vehicle_dataset: GeneratedDataset,
) -> None:
    frame = development_vehicle_dataset.frame
    new_units = frame[frame["condition_type"] == CONDITION_NEW]["odometer_reading"]
    used_units = frame[frame["condition_type"] == CONDITION_USED]["odometer_reading"]
    assert new_units.max() <= 50
    assert used_units.median() > 10_000


# ---------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# ---------------------------------------------------------------------------------------


def test_output_is_byte_identical_for_the_same_seed(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_generating_the_model_entity_does_not_perturb_this_one(
    test_config: ArpiConfig,
) -> None:
    baseline = content_digest(dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame))
    generate_vehicle_model_dataset(test_config)
    generate_date_dataset(test_config)
    after = content_digest(dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame))
    assert after == baseline


def test_changing_the_vehicle_sub_seed_leaves_the_foundation_entities_alone(
    test_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    date_digest = content_digest(dataframe_to_csv_bytes(generate_date_dataset(test_config).frame))
    store_digest = content_digest(
        dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
    )
    baseline = content_digest(dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame))

    monkeypatch.setattr(vehicle_module, "VEHICLE_NAMESPACE", "dim_vehicle_variant")
    changed = content_digest(dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame))
    assert changed != baseline
    assert content_digest(
        dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
    ) == date_digest
    assert content_digest(
        dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
    ) == store_digest


def test_the_vehicle_namespace_is_its_own(test_config: ArpiConfig) -> None:
    assert VEHICLE_NAMESPACE == ENTITY_DIM_VEHICLE
    assert VEHICLE_NAMESPACE != "dim_vehicle_model"


# ---------------------------------------------------------------------------------------
# Declared checks
# ---------------------------------------------------------------------------------------


def test_every_declared_check_passes_on_generated_data(
    development_config: ArpiConfig, development_vehicle_dataset: GeneratedDataset
) -> None:
    report = validate_vehicle_dataset(
        development_vehicle_dataset, catalogued_models_for(development_config)
    )
    assert not report.has_critical_failure
    assert len(report) == len(VEHICLE_CHECK_DEFINITIONS)


def test_every_emitted_check_is_declared(
    test_config: ArpiConfig, vehicle_dataset: GeneratedDataset
) -> None:
    report = validate_vehicle_dataset(vehicle_dataset, catalogued_models_for(test_config))
    emitted = [result.check_id for result in report.results]
    declared = [definition.check_id for definition in VEHICLE_CHECK_DEFINITIONS]
    assert emitted == declared
    assert len(set(declared)) == len(declared)


def test_declared_checks_use_canonical_metadata() -> None:
    for definition in VEHICLE_CHECK_DEFINITIONS:
        assert definition.check_id.startswith("DQ-VEH-")
        assert definition.category in CANONICAL_CATEGORIES
        assert definition.entity == ENTITY_DIM_VEHICLE
        assert definition.severity == "critical"


def test_emitted_results_carry_canonical_categories(
    test_config: ArpiConfig, vehicle_dataset: GeneratedDataset
) -> None:
    report = validate_vehicle_dataset(vehicle_dataset, catalogued_models_for(test_config))
    declared = {
        definition.check_id: definition.category for definition in VEHICLE_CHECK_DEFINITIONS
    }
    for result in report.results:
        assert result.check_category in CANONICAL_CATEGORIES
        assert result.check_category == declared[result.check_id]


def test_the_referential_check_detects_an_unknown_model(
    test_config: ArpiConfig, vehicle_dataset: GeneratedDataset
) -> None:
    report = validate_vehicle_dataset(vehicle_dataset, ())
    referential = next(result for result in report.results if result.check_id == "DQ-VEH-004")
    assert referential.is_failure


def test_the_consistency_check_detects_a_broken_row(
    test_config: ArpiConfig, vehicle_dataset: GeneratedDataset
) -> None:
    frame = vehicle_dataset.frame.copy()
    frame.loc[frame.index[0], "condition_type"] = CONDITION_NEW
    frame.loc[frame.index[0], "acquisition_source"] = "Auction"
    broken = GeneratedDataset(
        entity_name=ENTITY_DIM_VEHICLE,
        frame=frame,
        declared_columns=DIM_VEHICLE_COLUMNS,
        namespace=VEHICLE_NAMESPACE,
    )
    report = validate_vehicle_dataset(broken, catalogued_models_for(test_config))
    consistency = next(result for result in report.results if result.check_id == "DQ-VEH-005")
    assert consistency.is_failure


def test_the_vin_check_detects_a_malformed_vin(
    test_config: ArpiConfig, vehicle_dataset: GeneratedDataset
) -> None:
    frame = vehicle_dataset.frame.copy()
    frame.loc[frame.index[0], "synthetic_vin"] = "1HGCM82633A004352"
    broken = GeneratedDataset(
        entity_name=ENTITY_DIM_VEHICLE,
        frame=frame,
        declared_columns=DIM_VEHICLE_COLUMNS,
        namespace=VEHICLE_NAMESPACE,
    )
    report = validate_vehicle_dataset(broken, catalogued_models_for(test_config))
    vin = next(result for result in report.results if result.check_id == "DQ-VEH-007")
    assert vin.is_failure
