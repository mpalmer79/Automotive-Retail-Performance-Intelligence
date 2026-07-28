"""Unit tests for the ``acquisition_event`` source generator.

Everything here runs at the ``test`` profile (60 vehicles), because these are structural
assertions -- identifier formats, exact decimal arithmetic, derived values and date
boundaries -- rather than distributional ones. The distributional assertions live in
``tests/data_quality/test_acquisition_quality.py`` and run at ``development`` scale.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

import pytest

from arpi.config import ArpiConfig
from arpi.exceptions import GenerationError
from arpi.generation.acquisition import (
    ACQUISITION_EVENT_COLUMNS,
    ACQUISITION_WARM_UP_DAYS,
    AGING_PROPENSITY_LADDER,
    ALLOWED_INITIAL_INVENTORY_STATUSES,
    CONDITION_AGING_FACTOR,
    INVENTORY_STATUS_IN_RECONDITIONING,
    INVENTORY_STATUS_IN_STOCK,
    INVENTORY_STATUS_IN_TRANSIT,
    NEW_RECONDITIONING_RANGE,
    RECONDITIONING_STATUS_THRESHOLD,
    AcquisitionRecord,
    acquisition_id_for,
    acquisition_window,
    build_acquisition_records,
    generate_acquisition_dataset,
    initial_status_for,
    model_aging_propensity,
    money,
)
from arpi.generation.vehicle import (
    CONDITION_NEW,
    SOURCE_MANUFACTURER_ALLOCATION,
    STORE_INDEPENDENT_USED,
    build_vehicle_records,
)

MONEY_COLUMNS = ("acquisition_cost", "reconditioning_cost", "original_asking_price")


@pytest.fixture
def acquisitions(test_config: ArpiConfig) -> tuple[AcquisitionRecord, ...]:
    """The acquisition population for the ``test`` profile."""
    return build_acquisition_records(test_config)


# --------------------------------------------------------------------------------------
# Identifiers
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("ordinal", "expected"),
    [
        (1, "ACQ-00000001"),
        (42, "ACQ-00000042"),
        (12_044, "ACQ-00012044"),
        (99_999_999, "ACQ-99999999"),
    ],
)
def test_acquisition_id_is_zero_padded_to_eight_digits(ordinal: int, expected: str) -> None:
    assert acquisition_id_for(ordinal) == expected


@pytest.mark.parametrize("ordinal", [0, -1, 100_000_000])
def test_acquisition_id_rejects_ordinals_outside_the_reserved_width(ordinal: int) -> None:
    with pytest.raises(GenerationError):
        acquisition_id_for(ordinal)


def test_identifiers_are_sequential_and_unique(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    identifiers = [record.acquisition_id for record in acquisitions]
    assert identifiers == [acquisition_id_for(index) for index in range(1, len(identifiers) + 1)]
    assert len(set(identifiers)) == len(identifiers)


# --------------------------------------------------------------------------------------
# Grain
# --------------------------------------------------------------------------------------
def test_exactly_one_acquisition_exists_per_vehicle(
    acquisitions: tuple[AcquisitionRecord, ...], test_config: ArpiConfig
) -> None:
    vehicles = build_vehicle_records(test_config)
    assert len(acquisitions) == len(vehicles)
    assert {record.vehicle_id for record in acquisitions} == {
        vehicle.vehicle_id for vehicle in vehicles
    }


def test_every_acquisition_is_placed_at_the_vehicles_intended_store(
    acquisitions: tuple[AcquisitionRecord, ...], test_config: ArpiConfig
) -> None:
    intended = {
        vehicle.vehicle_id: vehicle.intended_dealership_id
        for vehicle in build_vehicle_records(test_config)
    }
    assert all(intended[record.vehicle_id] == record.dealership_id for record in acquisitions)


def test_the_independent_used_store_books_no_manufacturer_allocation(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    at_used_store = [
        record for record in acquisitions if record.dealership_id == STORE_INDEPENDENT_USED
    ]
    assert at_used_store, "the test profile must place some units at GSA-003"
    assert all(
        record.acquisition_source != SOURCE_MANUFACTURER_ALLOCATION for record in at_used_store
    )


# --------------------------------------------------------------------------------------
# Warm-up boundary
# --------------------------------------------------------------------------------------
def test_the_warm_up_window_opens_exactly_180_days_before_the_reporting_window(
    test_config: ArpiConfig,
) -> None:
    earliest, latest = acquisition_window(test_config)
    assert earliest == test_config.reporting.start_date - timedelta(days=180)
    assert ACQUISITION_WARM_UP_DAYS == 180
    assert latest == test_config.reporting.end_date


def test_no_acquisition_falls_outside_the_warm_up_window(
    acquisitions: tuple[AcquisitionRecord, ...], test_config: ArpiConfig
) -> None:
    earliest, latest = acquisition_window(test_config)
    assert all(earliest <= record.acquisition_date <= latest for record in acquisitions)


def test_some_units_are_already_ageing_when_the_window_opens(
    acquisitions: tuple[AcquisitionRecord, ...], test_config: ArpiConfig
) -> None:
    """Without this the warehouse starts empty and day-one inventory age is a fiction."""
    warm_up = [
        record
        for record in acquisitions
        if record.acquisition_date < test_config.reporting.start_date
    ]
    assert warm_up
    assert len(warm_up) < len(acquisitions)


# --------------------------------------------------------------------------------------
# Money
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.005", "1.01"),
        ("1.004", "1.00"),
        ("-1.005", "-1.01"),
        ("2.675", "2.68"),
        ("0", "0.00"),
    ],
)
def test_money_quantizes_to_the_cent_half_up(raw: str, expected: str) -> None:
    assert money(Decimal(raw)) == Decimal(expected)
    assert money(Decimal(raw)) == Decimal(raw).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def test_every_monetary_value_is_a_quantized_decimal(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    for record in acquisitions:
        for column in MONEY_COLUMNS:
            value = getattr(record, column)
            assert isinstance(value, Decimal), column
            assert value.as_tuple().exponent == -2, (record.acquisition_id, column, value)
        if record.msrp is not None:
            assert isinstance(record.msrp, Decimal)
            assert record.msrp.as_tuple().exponent == -2


def test_no_monetary_value_is_ever_a_float(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    for record in acquisitions:
        for column in (*MONEY_COLUMNS, "msrp"):
            assert not isinstance(getattr(record, column), float), column


def test_no_monetary_value_is_negative(acquisitions: tuple[AcquisitionRecord, ...]) -> None:
    for record in acquisitions:
        assert record.acquisition_cost >= 0
        assert record.reconditioning_cost >= 0
        assert record.original_asking_price >= 0
        assert record.msrp is None or record.msrp >= 0


def test_inventory_investment_is_the_exact_sum_of_its_parts(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    for record in acquisitions:
        assert record.inventory_investment == (record.acquisition_cost + record.reconditioning_cost)


def test_msrp_is_populated_for_new_units_and_absent_for_the_rest(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    for record in acquisitions:
        if record.condition_type == CONDITION_NEW:
            assert record.msrp is not None
            assert record.acquisition_cost < record.msrp
        else:
            assert record.msrp is None


# --------------------------------------------------------------------------------------
# Reconditioning
# --------------------------------------------------------------------------------------
def test_new_units_carry_only_prep_money(acquisitions: tuple[AcquisitionRecord, ...]) -> None:
    ceiling = Decimal(NEW_RECONDITIONING_RANGE[1])
    for record in acquisitions:
        if record.condition_type == CONDITION_NEW:
            assert record.reconditioning_cost <= ceiling


def test_reconditioning_never_exceeds_the_declared_cap(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    """The cap is what stops a cheap auction unit carrying more repair than it is worth."""
    for record in acquisitions:
        if record.condition_type != CONDITION_NEW:
            assert record.reconditioning_cost <= record.acquisition_cost


# --------------------------------------------------------------------------------------
# Derived values
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("condition", "reconditioning", "expected"),
    [
        ("New", Decimal("0.00"), INVENTORY_STATUS_IN_TRANSIT),
        ("New", Decimal("120.00"), INVENTORY_STATUS_IN_TRANSIT),
        ("New", RECONDITIONING_STATUS_THRESHOLD, INVENTORY_STATUS_IN_RECONDITIONING),
        ("Used", Decimal("0.00"), INVENTORY_STATUS_IN_STOCK),
        ("Used", RECONDITIONING_STATUS_THRESHOLD, INVENTORY_STATUS_IN_RECONDITIONING),
        ("Certified", RECONDITIONING_STATUS_THRESHOLD - Decimal("0.01"), INVENTORY_STATUS_IN_STOCK),
    ],
)
def test_initial_status_is_derived_not_drawn(
    condition: str, reconditioning: Decimal, expected: str
) -> None:
    assert initial_status_for(condition, reconditioning) == expected


def test_every_status_is_inside_the_declared_enumeration(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    assert {record.initial_inventory_status for record in acquisitions} <= set(
        ALLOWED_INITIAL_INVENTORY_STATUSES
    )


def test_the_status_on_every_record_agrees_with_its_own_reconditioning(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    for record in acquisitions:
        assert record.initial_inventory_status == initial_status_for(
            record.condition_type, record.reconditioning_cost
        )


# --------------------------------------------------------------------------------------
# Per-model aging propensity
# --------------------------------------------------------------------------------------
def test_aging_propensity_is_stable_for_one_model_line() -> None:
    first = model_aging_propensity("Chevrolet", "Equinox")
    assert first == model_aging_propensity("Chevrolet", "Equinox")
    assert first in AGING_PROPENSITY_LADDER


def test_aging_propensity_differs_across_model_lines() -> None:
    """Identical vehicle-aging behaviour across models is a prohibited pattern."""
    lines = (
        ("Chevrolet", "Equinox"),
        ("Chevrolet", "Silverado 1500"),
        ("Subaru", "Outback"),
        ("Subaru", "Forester"),
        ("Chevrolet", "Malibu"),
        ("Subaru", "Crosstrek"),
    )
    assert len({model_aging_propensity(make, model) for make, model in lines}) > 1


def test_the_population_carries_more_than_one_aging_propensity(
    acquisitions: tuple[AcquisitionRecord, ...],
) -> None:
    assert len({record.aging_propensity for record in acquisitions}) > 1


def test_condition_shifts_aging_propensity_in_the_expected_direction() -> None:
    assert CONDITION_AGING_FACTOR["New"] < CONDITION_AGING_FACTOR["Certified"]
    assert CONDITION_AGING_FACTOR["Certified"] < CONDITION_AGING_FACTOR["Used"]


# --------------------------------------------------------------------------------------
# Determinism
# --------------------------------------------------------------------------------------
def test_the_same_configuration_produces_the_identical_population(
    test_config: ArpiConfig,
) -> None:
    assert build_acquisition_records(test_config) == build_acquisition_records(test_config)


def test_the_dataset_declares_the_contract_columns_in_order(test_config: ArpiConfig) -> None:
    dataset = generate_acquisition_dataset(test_config)
    assert dataset.actual_columns == ACQUISITION_EVENT_COLUMNS
    assert dataset.schema_matches()
    assert dataset.entity_name == "acquisition_event"
    assert dataset.namespace == "acquisition_event"
