"""Unit tests for the vehicle model catalogue and ``dim_vehicle_model`` generator."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from arpi.config import ArpiConfig
from arpi.constants import SOURCE_SYSTEM
from arpi.exceptions import GenerationError
from arpi.generation.vehicle_model import (
    ALLOWED_BODY_STYLES,
    ALLOWED_DRIVETRAINS,
    ALLOWED_FRANCHISE_ALIGNMENTS,
    ALLOWED_FUEL_TYPES,
    ALLOWED_TRANSMISSIONS,
    ALLOWED_VEHICLE_CLASSES,
    DIM_VEHICLE_MODEL_COLUMNS,
    FRANCHISE_ALIGNMENT_INDEPENDENT,
    MAX_DOORS,
    MAX_MODEL_YEAR,
    MAX_SEATING_CAPACITY,
    MIN_DOORS,
    MIN_MODEL_YEAR,
    MIN_SEATING_CAPACITY,
    VEHICLE_MODEL_SCALE,
    catalogued_models_for,
    generate_vehicle_model_dataset,
    load_vehicle_model_catalogue,
    resolve_catalogue_path,
    select_catalogue_subset,
    vehicle_model_count_for,
    vehicle_model_id_for,
)
from arpi.utilities.seeding import rng_for

VEHICLE_MODEL_ID_PATTERN = re.compile(r"^VMD-\d{5}$")
FRANCHISE_MAKES = {"Chevrolet", "Subaru"}


def _catalogue_document() -> dict[str, Any]:
    """Read the committed catalogue as a plain YAML document."""
    return dict(yaml.safe_load(resolve_catalogue_path().read_text(encoding="utf-8")))


def _write_catalogue(path: Path, document: dict[str, Any]) -> Path:
    """Write a catalogue document to disk and return its path."""
    target = path / "vehicle_model_catalogue.yaml"
    target.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return target


def _minimal_document() -> dict[str, Any]:
    """A two-trim catalogue used as the base for the rejection cases."""
    return {
        "catalogue_version": 1,
        "model_lines": [
            {
                "make": "Chevrolet",
                "model": "Equinox",
                "franchise_alignment": "Chevrolet",
                "body_style": "Crossover",
                "vehicle_class": "SUV",
                "doors": 5,
                "seating_capacity": 5,
                "is_current_model_line": True,
                "model_years": [2024, 2025],
                "trims": [
                    {
                        "trim": "LS",
                        "fuel_type": "Gasoline",
                        "drivetrain": "FWD",
                        "transmission": "Automatic",
                    }
                ],
            }
        ],
    }


# ---------------------------------------------------------------------------------------
# Catalogue loading and validation
# ---------------------------------------------------------------------------------------


def test_committed_catalogue_loads_and_covers_every_profile() -> None:
    catalogue = load_vehicle_model_catalogue()
    assert len(catalogue) >= max(VEHICLE_MODEL_SCALE.values())


def test_every_catalogue_row_uses_declared_enumerations() -> None:
    for definition in load_vehicle_model_catalogue():
        assert definition.body_style in ALLOWED_BODY_STYLES
        assert definition.vehicle_class in ALLOWED_VEHICLE_CLASSES
        assert definition.fuel_type in ALLOWED_FUEL_TYPES
        assert definition.drivetrain in ALLOWED_DRIVETRAINS
        assert definition.transmission in ALLOWED_TRANSMISSIONS
        assert definition.franchise_alignment in ALLOWED_FRANCHISE_ALIGNMENTS
        assert MIN_MODEL_YEAR <= definition.model_year <= MAX_MODEL_YEAR
        assert MIN_DOORS <= definition.doors <= MAX_DOORS
        assert MIN_SEATING_CAPACITY <= definition.seating_capacity <= MAX_SEATING_CAPACITY


def test_catalogue_natural_keys_are_unique() -> None:
    catalogue = load_vehicle_model_catalogue()
    keys = [definition.natural_key for definition in catalogue]
    assert len(keys) == len(set(keys))


def test_catalogue_franchise_alignment_agrees_with_make() -> None:
    for definition in load_vehicle_model_catalogue():
        if definition.franchise_alignment == FRANCHISE_ALIGNMENT_INDEPENDENT:
            assert definition.make not in FRANCHISE_MAKES
        else:
            assert definition.make == definition.franchise_alignment


def test_a_trim_level_override_is_honoured() -> None:
    catalogue = load_vehicle_model_catalogue()
    tahoe = [row for row in catalogue if row.model == "Tahoe"]
    assert {row.seating_capacity for row in tahoe} == {7, 8}


def test_unknown_enumerated_value_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    document["model_lines"][0]["trims"][0]["drivetrain"] = "SixWD"
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "'drivetrain'" in str(error.value)
    assert "Chevrolet Equinox" in str(error.value)
    assert "trim 'LS'" in str(error.value)


def test_missing_required_field_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    del document["model_lines"][0]["trims"][0]["fuel_type"]
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "'fuel_type'" in str(error.value)
    assert "Chevrolet Equinox" in str(error.value)


def test_missing_model_line_field_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    del document["model_lines"][0]["body_style"]
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "'body_style'" in str(error.value)


def test_duplicate_natural_key_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    line = document["model_lines"][0]
    line["trims"].append(dict(line["trims"][0]))
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    message = str(error.value)
    assert "duplicate vehicle model natural key" in message
    assert "model_year=2024" in message
    assert "trim='LS'" in message


def test_repeated_model_year_within_one_trim_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    document["model_lines"][0]["model_years"] = [2024, 2024]
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "listed more than once" in str(error.value)


def test_out_of_range_model_year_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    document["model_lines"][0]["model_years"] = [1899]
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "outside the allowed range" in str(error.value)


def test_out_of_range_seating_capacity_is_rejected(tmp_path: Path) -> None:
    document = _minimal_document()
    document["model_lines"][0]["seating_capacity"] = 12
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "'seating_capacity'" in str(error.value)


def test_discontinued_line_may_not_carry_a_current_model_year(tmp_path: Path) -> None:
    document = _minimal_document()
    document["model_lines"][0]["is_current_model_line"] = False
    document["model_lines"][0]["model_years"] = [2024, 2026]
    path = _write_catalogue(tmp_path, document)
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "is_current_model_line=false" in str(error.value)


def test_a_non_mapping_document_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "vehicle_model_catalogue.yaml"
    path.write_text("- not a mapping\n", encoding="utf-8")
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "must be a YAML mapping" in str(error.value)


def test_an_empty_model_line_list_is_rejected(tmp_path: Path) -> None:
    path = _write_catalogue(tmp_path, {"model_lines": []})
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(path)
    assert "non-empty list" in str(error.value)


def test_a_missing_catalogue_file_is_reported(tmp_path: Path) -> None:
    with pytest.raises(GenerationError) as error:
        load_vehicle_model_catalogue(tmp_path / "absent.yaml")
    assert "not found" in str(error.value)


# ---------------------------------------------------------------------------------------
# Identifiers, keys and subset selection
# ---------------------------------------------------------------------------------------


def test_vehicle_model_id_format() -> None:
    assert vehicle_model_id_for(1) == "VMD-00001"
    assert vehicle_model_id_for(42) == "VMD-00042"
    assert VEHICLE_MODEL_ID_PATTERN.match(vehicle_model_id_for(99999))


@pytest.mark.parametrize("ordinal", [0, -1, 100_000])
def test_vehicle_model_id_rejects_out_of_range_ordinals(ordinal: int) -> None:
    with pytest.raises(GenerationError):
        vehicle_model_id_for(ordinal)


def test_generated_ids_and_keys_are_a_dense_ordered_sequence(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_model_dataset(test_config).frame
    assert list(frame["vehicle_model_key"]) == list(range(1, len(frame) + 1))
    assert list(frame["vehicle_model_id"]) == [
        vehicle_model_id_for(ordinal) for ordinal in range(1, len(frame) + 1)
    ]
    assert list(frame["vehicle_model_id"]) == sorted(frame["vehicle_model_id"])


def test_ids_are_assigned_by_sorted_natural_key(test_config: ArpiConfig) -> None:
    models = catalogued_models_for(test_config)
    keys = [model.definition.natural_key for model in models]
    assert keys == sorted(keys)


def test_key_assignment_is_stable_across_regeneration(test_config: ArpiConfig) -> None:
    first = generate_vehicle_model_dataset(test_config).frame
    second = generate_vehicle_model_dataset(test_config).frame
    assert first.equals(second)


def test_subset_selection_is_deterministic_for_a_seed(test_config: ArpiConfig) -> None:
    catalogue = load_vehicle_model_catalogue()
    first = select_catalogue_subset(catalogue, 40, rng_for(test_config.random_seed, "probe"))
    second = select_catalogue_subset(catalogue, 40, rng_for(test_config.random_seed, "probe"))
    assert first == second


def test_subset_selection_responds_to_the_seed() -> None:
    catalogue = load_vehicle_model_catalogue()
    first = select_catalogue_subset(catalogue, 40, rng_for(1, "probe"))
    second = select_catalogue_subset(catalogue, 40, rng_for(2, "probe"))
    assert first != second


def test_subset_selection_covers_every_franchise_alignment() -> None:
    catalogue = load_vehicle_model_catalogue()
    for target in sorted(VEHICLE_MODEL_SCALE.values()):
        selected = select_catalogue_subset(catalogue, target, rng_for(7, "probe"))
        assert len(selected) == target
        assert {row.franchise_alignment for row in selected} == set(ALLOWED_FRANCHISE_ALIGNMENTS)


def test_a_catalogue_smaller_than_the_target_fails_clearly() -> None:
    catalogue = load_vehicle_model_catalogue()[:10]
    with pytest.raises(GenerationError) as error:
        select_catalogue_subset(catalogue, 40, rng_for(1, "probe"))
    assert "holds 10 row(s)" in str(error.value)
    assert "asks for 40" in str(error.value)


def test_a_non_positive_target_fails_clearly() -> None:
    with pytest.raises(GenerationError):
        select_catalogue_subset(load_vehicle_model_catalogue(), 0, rng_for(1, "probe"))


# ---------------------------------------------------------------------------------------
# Generated frame
# ---------------------------------------------------------------------------------------


def test_scale_matches_the_declared_profile_target(
    test_config: ArpiConfig, development_config: ArpiConfig
) -> None:
    assert vehicle_model_count_for(test_config) == VEHICLE_MODEL_SCALE["test"]
    assert vehicle_model_count_for(development_config) == VEHICLE_MODEL_SCALE["development"]
    assert generate_vehicle_model_dataset(test_config).row_count == VEHICLE_MODEL_SCALE["test"]


def test_declared_columns_are_produced_in_order(test_config: ArpiConfig) -> None:
    dataset = generate_vehicle_model_dataset(test_config)
    assert dataset.actual_columns == DIM_VEHICLE_MODEL_COLUMNS
    assert dataset.schema_matches()


def test_every_row_carries_the_synthetic_source_system(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_model_dataset(test_config).frame
    assert set(frame["source_system"]) == {SOURCE_SYSTEM}


def test_no_column_is_null(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_model_dataset(test_config).frame
    assert not frame.isna().to_numpy().any()


def test_generation_does_not_read_the_enrichment_feature_flag(test_config: ArpiConfig) -> None:
    assert test_config.features.enable_public_vehicle_enrichment is False
    generate_vehicle_model_dataset(test_config)
