"""Unit tests for the ``dim_vehicle`` generator."""

from __future__ import annotations

import re

import pytest

from arpi.config import ArpiConfig
from arpi.constants import SOURCE_SYSTEM
from arpi.exceptions import GenerationError
from arpi.generation import vehicle as vehicle_module
from arpi.generation.vehicle import (
    ALLOWED_ACQUISITION_SOURCES,
    ALLOWED_CONDITION_TYPES,
    ALLOWED_ODOMETER_BANDS,
    CERTIFIED_MAX_AGE_YEARS,
    CERTIFIED_MAX_ODOMETER,
    CERTIFIED_MIN_AGE_YEARS,
    CERTIFIED_MIN_ODOMETER,
    CONDITION_CERTIFIED,
    CONDITION_NEW,
    CONDITION_USED,
    DIM_VEHICLE_COLUMNS,
    NEW_ODOMETER_MAX,
    ODOMETER_BAND_NEW,
    SOURCE_MANUFACTURER_ALLOCATION,
    STORE_IDS,
    STORE_INDEPENDENT_USED,
    VEHICLE_SCALE,
    VIN_ALPHABET,
    VIN_LENGTH,
    VIN_PREFIX,
    build_vehicle_records,
    generate_vehicle_dataset,
    intended_store_assignments,
    is_well_formed_synthetic_vin,
    odometer_band_for,
    vehicle_count_for,
    vehicle_id_for,
)
from arpi.generation.vehicle_model import CATALOGUE_REFERENCE_YEAR, catalogued_models_for
from arpi.utilities.seeding import rng_for

VEHICLE_ID_PATTERN = re.compile(r"^VEH-\d{7}$")
CERTIFIED_SOURCES = frozenset(
    {"Customer Trade", "Lease Return", "Auction", "Dealer Trade"},
)


# ---------------------------------------------------------------------------------------
# Identifiers
# ---------------------------------------------------------------------------------------


def test_vehicle_id_format() -> None:
    assert vehicle_id_for(1) == "VEH-0000001"
    assert vehicle_id_for(1337) == "VEH-0001337"
    assert VEHICLE_ID_PATTERN.match(vehicle_id_for(9_999_999))


@pytest.mark.parametrize("ordinal", [0, -3, 10_000_000])
def test_vehicle_id_rejects_out_of_range_ordinals(ordinal: int) -> None:
    with pytest.raises(GenerationError):
        vehicle_id_for(ordinal)


def test_ids_and_keys_are_a_dense_ordered_sequence(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_dataset(test_config).frame
    assert list(frame["vehicle_key"]) == list(range(1, len(frame) + 1))
    assert list(frame["vehicle_id"]) == [
        vehicle_id_for(ordinal) for ordinal in range(1, len(frame) + 1)
    ]
    assert list(frame["vehicle_id"]) == sorted(frame["vehicle_id"])


# ---------------------------------------------------------------------------------------
# Synthetic VIN
# ---------------------------------------------------------------------------------------


def test_every_vin_is_well_formed_and_unique(test_config: ArpiConfig) -> None:
    vins = list(generate_vehicle_dataset(test_config).frame["synthetic_vin"])
    assert len(set(vins)) == len(vins)
    for vin in vins:
        assert len(vin) == VIN_LENGTH == 17
        assert vin.startswith(VIN_PREFIX)
        assert set(vin[len(VIN_PREFIX) :]) <= set(VIN_ALPHABET)


def test_the_vin_alphabet_excludes_the_ambiguous_letters() -> None:
    assert not {"I", "O", "Q"} & set(VIN_ALPHABET)
    assert len(VIN_ALPHABET) == 33


@pytest.mark.parametrize(
    "candidate",
    [
        "",
        "ARPI",
        "ARPI7K2M9XQ00000",
        "ARPI7K2M9X000000000",
        "XXXX7K2M9XA00B0C1",
        "ARPIIOQ0000000000",
    ],
)
def test_malformed_vins_are_rejected(candidate: str) -> None:
    assert not is_well_formed_synthetic_vin(candidate)


def test_vin_collisions_are_resolved_deterministically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vehicle_module, "VIN_ALPHABET", "AB")
    monkeypatch.setattr(vehicle_module, "VIN_RANDOM_LENGTH", 1)
    rng = rng_for(11, "probe")
    used: set[str] = set()
    drawn = {vehicle_module._draw_vin(rng, used) for _ in range(2)}
    assert drawn == {"ARPIA", "ARPIB"}


def test_an_exhausted_vin_keyspace_fails_loudly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vehicle_module, "VIN_ALPHABET", "A")
    monkeypatch.setattr(vehicle_module, "VIN_RANDOM_LENGTH", 1)
    rng = rng_for(11, "probe")
    used: set[str] = set()
    vehicle_module._draw_vin(rng, used)
    with pytest.raises(GenerationError) as error:
        vehicle_module._draw_vin(rng, used)
    assert "unique synthetic VIN" in str(error.value)


# ---------------------------------------------------------------------------------------
# Odometer bands
# ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("reading", "expected"),
    [
        (0, "Under 10k"),
        (9_999, "Under 10k"),
        (10_000, "10k-30k"),
        (29_999, "10k-30k"),
        (30_000, "30k-60k"),
        (59_999, "30k-60k"),
        (60_000, "60k-100k"),
        (99_999, "60k-100k"),
        (100_000, "Over 100k"),
        (250_000, "Over 100k"),
    ],
)
def test_used_odometer_band_boundaries(reading: int, expected: str) -> None:
    assert odometer_band_for(reading, CONDITION_USED) == expected
    assert odometer_band_for(reading, CONDITION_CERTIFIED) == expected


@pytest.mark.parametrize("reading", [0, 1, 50])
def test_a_new_unit_always_bands_as_new(reading: int) -> None:
    assert odometer_band_for(reading, CONDITION_NEW) == ODOMETER_BAND_NEW


def test_a_new_unit_over_the_delivery_allowance_is_rejected() -> None:
    with pytest.raises(GenerationError) as error:
        odometer_band_for(NEW_ODOMETER_MAX + 1, CONDITION_NEW)
    assert "at most 50 miles" in str(error.value)


def test_a_negative_reading_is_rejected() -> None:
    with pytest.raises(GenerationError):
        odometer_band_for(-1, CONDITION_USED)


def test_an_unknown_condition_is_rejected() -> None:
    with pytest.raises(GenerationError):
        odometer_band_for(1_000, "Refurbished")


# ---------------------------------------------------------------------------------------
# Consistency rules over generated data
# ---------------------------------------------------------------------------------------


def test_every_generated_row_uses_declared_enumerations(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_dataset(test_config).frame
    assert set(frame["condition_type"]) <= set(ALLOWED_CONDITION_TYPES)
    assert set(frame["acquisition_source"]) <= set(ALLOWED_ACQUISITION_SOURCES)
    assert set(frame["odometer_band"]) <= set(ALLOWED_ODOMETER_BANDS)
    assert set(frame["source_system"]) == {SOURCE_SYSTEM}


def test_new_units_carry_a_manufacturer_allocation_and_delivery_miles(
    development_config: ArpiConfig,
) -> None:
    frame = generate_vehicle_dataset(development_config).frame
    new_units = frame[frame["condition_type"] == CONDITION_NEW]
    assert not new_units.empty
    assert set(new_units["acquisition_source"]) == {SOURCE_MANUFACTURER_ALLOCATION}
    assert set(new_units["odometer_band"]) == {ODOMETER_BAND_NEW}
    assert new_units["odometer_reading"].max() <= NEW_ODOMETER_MAX


def test_only_new_units_carry_a_manufacturer_allocation(
    development_config: ArpiConfig,
) -> None:
    frame = generate_vehicle_dataset(development_config).frame
    allocated = frame[frame["acquisition_source"] == SOURCE_MANUFACTURER_ALLOCATION]
    assert set(allocated["condition_type"]) == {CONDITION_NEW}


def test_certified_units_are_used_derived_and_bounded(
    development_config: ArpiConfig,
) -> None:
    records = build_vehicle_records(development_config)
    models = {model.vehicle_model_id: model for model in catalogued_models_for(development_config)}
    certified = [record for record in records if record.condition_type == CONDITION_CERTIFIED]
    assert certified
    for record in certified:
        assert record.acquisition_source in CERTIFIED_SOURCES
        assert CERTIFIED_MIN_ODOMETER <= record.odometer_reading <= CERTIFIED_MAX_ODOMETER
        age = CATALOGUE_REFERENCE_YEAR - models[record.vehicle_model_id].definition.model_year
        assert CERTIFIED_MIN_AGE_YEARS <= age <= CERTIFIED_MAX_AGE_YEARS


def test_odometer_band_agrees_with_the_reading_on_every_row(
    development_config: ArpiConfig,
) -> None:
    frame = generate_vehicle_dataset(development_config).frame
    for reading, condition, band in zip(
        frame["odometer_reading"],
        frame["condition_type"],
        frame["odometer_band"],
        strict=True,
    ):
        assert band == odometer_band_for(int(reading), str(condition))


def test_every_vehicle_resolves_to_a_catalogued_model(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_dataset(test_config).frame
    known = {
        (model.vehicle_model_key, model.vehicle_model_id)
        for model in catalogued_models_for(test_config)
    }
    pairs = {
        (int(key), str(identifier))
        for key, identifier in zip(
            frame["vehicle_model_key"], frame["vehicle_model_id"], strict=True
        )
    }
    assert pairs <= known


def test_the_independent_used_store_holds_used_units_only(
    development_config: ArpiConfig,
) -> None:
    records = build_vehicle_records(development_config)
    independent = [
        record for record in records if record.intended_dealership_id == STORE_INDEPENDENT_USED
    ]
    assert independent
    assert {record.condition_type for record in independent} == {CONDITION_USED}
    assert SOURCE_MANUFACTURER_ALLOCATION not in {
        record.acquisition_source for record in independent
    }


def test_new_and_certified_units_match_their_store_franchise(
    development_config: ArpiConfig,
) -> None:
    records = build_vehicle_records(development_config)
    models = {model.vehicle_model_id: model for model in catalogued_models_for(development_config)}
    expected = {"GSA-001": "Chevrolet", "GSA-002": "Subaru"}
    for record in records:
        if record.condition_type == CONDITION_USED:
            continue
        alignment = models[record.vehicle_model_id].definition.franchise_alignment
        assert alignment == expected[record.intended_dealership_id]


# ---------------------------------------------------------------------------------------
# Determinism and the public store-assignment helper
# ---------------------------------------------------------------------------------------


def test_generation_is_reproducible_from_a_fixed_seed(test_config: ArpiConfig) -> None:
    first = generate_vehicle_dataset(test_config).frame
    second = generate_vehicle_dataset(test_config).frame
    assert first.equals(second)


def test_store_assignments_cover_every_vehicle_and_only_known_stores(
    test_config: ArpiConfig,
) -> None:
    assignments = intended_store_assignments(test_config)
    frame = generate_vehicle_dataset(test_config).frame
    assert list(assignments) == list(frame["vehicle_id"])
    assert set(assignments.values()) <= set(STORE_IDS)


def test_store_assignments_are_deterministic(test_config: ArpiConfig) -> None:
    assert intended_store_assignments(test_config) == intended_store_assignments(test_config)


def test_the_dimension_carries_no_store_column(test_config: ArpiConfig) -> None:
    dataset = generate_vehicle_dataset(test_config)
    assert dataset.actual_columns == DIM_VEHICLE_COLUMNS
    assert "dealership_id" not in dataset.actual_columns
    assert "dealership_key" not in dataset.actual_columns


def test_scale_matches_the_declared_profile_target(
    test_config: ArpiConfig, development_config: ArpiConfig
) -> None:
    assert vehicle_count_for(test_config) == VEHICLE_SCALE["test"]
    assert vehicle_count_for(development_config) == VEHICLE_SCALE["development"]
    assert generate_vehicle_dataset(test_config).row_count == VEHICLE_SCALE["test"]


def test_no_column_is_null(test_config: ArpiConfig) -> None:
    frame = generate_vehicle_dataset(test_config).frame
    assert not frame.isna().to_numpy().any()
