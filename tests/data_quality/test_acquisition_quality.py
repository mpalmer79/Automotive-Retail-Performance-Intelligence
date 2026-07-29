"""Data-quality assertions over the generated acquisition source entity.

The distributional assertions in this module run at the **development** profile (900
vehicles). At the ``test`` profile the population is 60 units spread over a two-month
window, which is far too small for a correlation or a seasonality claim to mean anything;
asserting one there would produce a flaky test rather than a strong one. Every assertion
is a direction and a band, never a point value, and the seed is fixed by the profile.
"""

from __future__ import annotations

from decimal import Decimal

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.acquisition import (
    ACQUISITION_CHECK_IDS,
    ACQUISITION_EVENT_COLUMNS,
    ACQUISITION_EVENT_REQUIRED_COLUMNS,
    ACQUISITION_MONEY_COLUMNS,
    CLASS_BASE_MSRP,
    DAY_OF_WEEK_ACQUISITION_WEIGHT,
    MONTH_ACQUISITION_WEIGHT,
    NEW_RECONDITIONING_RANGE,
    build_acquisition_records,
    generate_acquisition_dataset,
    validate_acquisition_dataset,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.vehicle import (
    CONDITION_NEW,
    SOURCE_MANUFACTURER_ALLOCATION,
    STORE_INDEPENDENT_USED,
    VEHICLE_SCALE,
    generate_vehicle_dataset,
)
from arpi.generation.vehicle_model import generate_vehicle_model_dataset
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered

pytestmark = pytest.mark.data_quality

#: Prohibited column names spelled out verbatim. A trade-in is where a real dealer system
#: holds the seller's identity, so this entity is inspected against the full vocabulary
#: rather than trusting that the shared privacy module will always cover it.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "seller_name",
    "customer_name",
    "email",
    "phone",
    "address",
    "street_address",
    "ssn",
    "date_of_birth",
    "drivers_license",
    "bank_account",
    "credit_score",
    "commission",
    "pay_plan",
    "notes",
    "comments",
)


@pytest.fixture(scope="module")
def development_config() -> ArpiConfig:
    """The ``development`` profile, resolved hermetically for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="development", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def development_acquisitions(development_config: ArpiConfig) -> pd.DataFrame:
    """Acquisition records at development scale, flattened for analysis."""
    return pd.DataFrame(
        [
            {
                "vehicle_id": record.vehicle_id,
                "dealership_id": record.dealership_id,
                "acquisition_date": record.acquisition_date,
                "acquisition_source": record.acquisition_source,
                "condition_type": record.condition_type,
                "model_year": record.model_year,
                "vehicle_class": record.vehicle_class,
                "class_base_msrp": float(CLASS_BASE_MSRP[record.vehicle_class]),
                "odometer_reading": record.odometer_reading,
                "acquisition_cost": float(record.acquisition_cost),
                "reconditioning_cost": float(record.reconditioning_cost),
                "original_asking_price": float(record.original_asking_price),
                "aging_propensity": record.aging_propensity,
            }
            for record in build_acquisition_records(development_config)
        ]
    )


@pytest.fixture(scope="module")
def development_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``acquisition_event`` dataset at development scale."""
    return generate_acquisition_dataset(development_config)


@pytest.fixture
def acquisition_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``acquisition_event`` dataset for the ``test`` profile."""
    return generate_acquisition_dataset(test_config)


def _replace_cell(frame: pd.DataFrame, column: str, position: int, value: object) -> None:
    """Overwrite one cell of a ``Decimal``-bearing object column, in place.

    ``DataFrame.loc`` assignment of a ``Decimal`` is rejected by the pandas type stubs,
    so the column is rebuilt instead. Only tests need this: the generator never mutates
    a frame.
    """
    values = list(frame[column])
    values[position] = value
    frame[column] = pd.Series(values, index=frame.index, dtype=object)


def _tampered(dataset: GeneratedDataset, frame: pd.DataFrame) -> GeneratedDataset:
    """Wrap a modified frame so the gating suite can be run against it."""
    return GeneratedDataset(
        entity_name=dataset.entity_name,
        frame=frame,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(
    acquisition_dataset: GeneratedDataset,
) -> None:
    assert acquisition_dataset.actual_columns == ACQUISITION_EVENT_COLUMNS
    assert len(ACQUISITION_EVENT_COLUMNS) == 11


def test_the_column_set_is_exactly_the_contract(
    acquisition_dataset: GeneratedDataset,
) -> None:
    """Deny by default: anything outside the contract is, by construction, not generated."""
    assert set(acquisition_dataset.actual_columns) == set(ACQUISITION_EVENT_COLUMNS)


def test_only_msrp_is_ever_null(acquisition_dataset: GeneratedDataset) -> None:
    frame = acquisition_dataset.frame
    assert not frame[list(ACQUISITION_EVENT_REQUIRED_COLUMNS)].isna().to_numpy().any()
    assert frame["msrp"].isna().any()


def test_msrp_is_present_exactly_on_the_new_units(
    acquisition_dataset: GeneratedDataset,
) -> None:
    frame = acquisition_dataset.frame
    records = build_acquisition_records(load_config(profile="test"))
    is_new = pd.Series([record.condition_type == CONDITION_NEW for record in records])
    assert (frame["msrp"].notna().to_numpy() == is_new.to_numpy()).all()


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(
    acquisition_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in acquisition_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-ACQ-007")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


# --------------------------------------------------------------------------------------
# Scale
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("profile", ["test", "development"])
def test_one_acquisition_exists_per_vehicle_at_every_generated_scale(profile: str) -> None:
    dataset = generate_acquisition_dataset(load_config(profile=profile))
    assert dataset.row_count == VEHICLE_SCALE[profile]
    assert dataset.frame["vehicle_id"].nunique() == VEHICLE_SCALE[profile]


# --------------------------------------------------------------------------------------
# Warm-up
# --------------------------------------------------------------------------------------
def test_a_substantial_minority_of_the_fleet_is_acquired_before_the_window_opens(
    development_acquisitions: pd.DataFrame, development_config: ArpiConfig
) -> None:
    share = float(
        (
            development_acquisitions["acquisition_date"] < development_config.reporting.start_date
        ).mean()
    )
    assert 0.15 < share < 0.55, share


def test_day_one_inventory_spans_more_than_one_age_bucket(
    development_acquisitions: pd.DataFrame, development_config: ArpiConfig
) -> None:
    """Aged units must exist on day one, or every ageing measure starts from a fiction."""
    start = development_config.reporting.start_date
    warm_up = development_acquisitions[development_acquisitions["acquisition_date"] < start]
    ages = warm_up["acquisition_date"].map(lambda value: (start - value).days)
    assert int((ages > 30).sum()) > 0
    assert int((ages > 90).sum()) > 0
    assert int(ages.max()) <= 180


# --------------------------------------------------------------------------------------
# Seasonality and day-of-week structure
# --------------------------------------------------------------------------------------
def test_the_declared_month_weights_are_not_flat() -> None:
    weights = list(MONTH_ACQUISITION_WEIGHT.values())
    assert len(MONTH_ACQUISITION_WEIGHT) == 12
    assert max(weights) / min(weights) > 1.25


def test_in_window_monthly_acquisition_volume_is_not_flat(
    development_acquisitions: pd.DataFrame, development_config: ArpiConfig
) -> None:
    """Flat monthly activity is a prohibited synthetic pattern."""
    in_window = development_acquisitions[
        development_acquisitions["acquisition_date"] >= development_config.reporting.start_date
    ]
    counts = in_window["acquisition_date"].map(lambda value: value.month).value_counts()
    assert len(counts) >= 6
    assert float(counts.max() / counts.min()) > 1.12


def test_acquisition_volume_carries_day_of_week_structure(
    development_acquisitions: pd.DataFrame,
) -> None:
    weekday = development_acquisitions["acquisition_date"].map(lambda value: value.weekday())
    counts = weekday.value_counts()
    assert int(counts.get(6, 0)) < int(counts.get(2, 0)) / 4, "Sunday must be near-dormant"
    weekdays = sum(int(counts.get(day, 0)) for day in range(5))
    weekend = sum(int(counts.get(day, 0)) for day in (5, 6))
    assert weekdays > weekend * 2


def test_the_declared_day_of_week_weights_cover_the_whole_week() -> None:
    assert len(DAY_OF_WEEK_ACQUISITION_WEIGHT) == 7
    assert DAY_OF_WEEK_ACQUISITION_WEIGHT[6] < min(DAY_OF_WEEK_ACQUISITION_WEIGHT[:5])


# --------------------------------------------------------------------------------------
# Cost relationships: direction and band, never a point value
# --------------------------------------------------------------------------------------
def test_used_acquisition_cost_rises_with_model_year_without_being_determined_by_it(
    development_acquisitions: pd.DataFrame,
) -> None:
    used = development_acquisitions[development_acquisitions["condition_type"] != CONDITION_NEW]
    correlation = float(used["model_year"].corr(used["acquisition_cost"]))
    assert 0.30 < correlation < 0.99, correlation


def test_acquisition_cost_rises_with_vehicle_class_without_being_determined_by_it(
    development_acquisitions: pd.DataFrame,
) -> None:
    correlation = float(
        development_acquisitions["class_base_msrp"].corr(
            development_acquisitions["acquisition_cost"]
        )
    )
    assert 0.15 < correlation < 0.95, correlation


def test_used_acquisition_cost_falls_as_the_odometer_rises(
    development_acquisitions: pd.DataFrame,
) -> None:
    used = development_acquisitions[development_acquisitions["condition_type"] != CONDITION_NEW]
    correlation = float(used["odometer_reading"].corr(used["acquisition_cost"]))
    assert -0.95 < correlation < -0.10, correlation


def test_residual_variance_survives_within_every_model_year(
    development_acquisitions: pd.DataFrame,
) -> None:
    """A cost that is a function of its inputs would collapse to one value per group."""
    used = development_acquisitions[development_acquisitions["condition_type"] != CONDITION_NEW]
    spread = used.groupby(["model_year", "vehicle_class"])["acquisition_cost"].nunique()
    assert float((spread > 1).mean()) > 0.5


# --------------------------------------------------------------------------------------
# Reconditioning
# --------------------------------------------------------------------------------------
def test_used_reconditioning_materially_exceeds_new(
    development_acquisitions: pd.DataFrame,
) -> None:
    grouped = development_acquisitions.assign(
        is_new=development_acquisitions["condition_type"] == CONDITION_NEW
    ).groupby("is_new")["reconditioning_cost"]
    new_mean = float(grouped.mean()[True])
    used_mean = float(grouped.mean()[False])
    assert new_mean <= NEW_RECONDITIONING_RANGE[1]
    assert used_mean > new_mean * 5, (new_mean, used_mean)
    assert used_mean > 800


def test_new_reconditioning_is_near_zero(development_acquisitions: pd.DataFrame) -> None:
    new = development_acquisitions[development_acquisitions["condition_type"] == CONDITION_NEW]
    assert float(new["reconditioning_cost"].max()) <= NEW_RECONDITIONING_RANGE[1]


def test_reconditioning_rises_with_age_among_used_units(
    development_acquisitions: pd.DataFrame,
) -> None:
    used = development_acquisitions[development_acquisitions["condition_type"] != CONDITION_NEW]
    correlation = float(used["odometer_reading"].corr(used["reconditioning_cost"]))
    assert -0.60 < correlation < 0.95, correlation


# --------------------------------------------------------------------------------------
# Aging propensity
# --------------------------------------------------------------------------------------
def test_aging_propensity_is_not_uniform_across_the_fleet(
    development_acquisitions: pd.DataFrame,
) -> None:
    """Identical vehicle-aging behaviour across models is a prohibited pattern."""
    assert development_acquisitions["aging_propensity"].nunique() >= 8


# --------------------------------------------------------------------------------------
# Referential and business rules
# --------------------------------------------------------------------------------------
def test_no_manufacturer_allocation_reaches_the_independent_used_store(
    development_acquisitions: pd.DataFrame,
) -> None:
    at_used_store = development_acquisitions[
        development_acquisitions["dealership_id"] == STORE_INDEPENDENT_USED
    ]
    assert not at_used_store.empty
    assert SOURCE_MANUFACTURER_ALLOCATION not in set(at_used_store["acquisition_source"])


def test_no_monetary_column_holds_a_negative_value(
    development_dataset: GeneratedDataset,
) -> None:
    for column in ACQUISITION_MONEY_COLUMNS:
        values = [
            Decimal(str(value))
            for value in development_dataset.frame[column]
            if value is not None and not pd.isna(value)
        ]
        assert min(values) >= 0, column


def test_every_acquisition_resolves_to_a_generated_vehicle(
    development_dataset: GeneratedDataset, development_config: ArpiConfig
) -> None:
    known = set(generate_vehicle_dataset(development_config).frame["vehicle_id"])
    assert set(development_dataset.frame["vehicle_id"]) == known


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_acquisition_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_acquisition_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_generating_acquisitions_does_not_perturb_any_other_entity(
    test_config: ArpiConfig,
) -> None:
    """One namespace per entity: adding an entity must never move another's digest."""

    def digests() -> dict[str, str]:
        return {
            "dim_date": content_digest(
                dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
            ),
            "dim_dealership": content_digest(
                dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
            ),
            "dim_vehicle_model": content_digest(
                dataframe_to_csv_bytes(generate_vehicle_model_dataset(test_config).frame)
            ),
            "dim_vehicle": content_digest(
                dataframe_to_csv_bytes(generate_vehicle_dataset(test_config).frame)
            ),
            "dim_employee": content_digest(
                dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
            ),
            "dim_customer": content_digest(
                dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
            ),
        }

    before = digests()
    generate_acquisition_dataset(test_config)
    assert digests() == before


def test_the_acquisition_digest_is_stable_across_reruns(test_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_acquisition_dataset(test_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_acquisition_dataset(acquisition_dataset, test_config)
    assert not report.failures, [result.message for result in report.failures]


def test_every_gating_check_passes_at_development_scale(
    development_dataset: GeneratedDataset, development_config: ArpiConfig
) -> None:
    report = validate_acquisition_dataset(development_dataset, development_config)
    assert not report.failures, [result.message for result in report.failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    emitted = [
        result.check_id
        for result in validate_acquisition_dataset(acquisition_dataset, test_config).results
    ]
    assert emitted == list(ACQUISITION_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    for result in validate_acquisition_dataset(acquisition_dataset, test_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id


# --------------------------------------------------------------------------------------
# The tripwires have to actually trip
# --------------------------------------------------------------------------------------
def _failed_ids(dataset: GeneratedDataset, config: ArpiConfig) -> set[str]:
    return {result.check_id for result in validate_acquisition_dataset(dataset, config).failures}


def test_a_duplicate_acquisition_id_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    frame.loc[frame.index[1], "acquisition_id"] = frame.loc[frame.index[0], "acquisition_id"]
    assert "DQ-ACQ-001" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_a_second_acquisition_for_one_vehicle_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    frame.loc[frame.index[1], "vehicle_id"] = frame.loc[frame.index[0], "vehicle_id"]
    assert "DQ-ACQ-002" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_a_reordered_column_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    columns = list(ACQUISITION_EVENT_COLUMNS)
    columns[0], columns[1] = columns[1], columns[0]
    frame = acquisition_dataset.frame[columns]
    assert "DQ-ACQ-003" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_a_negative_cost_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    _replace_cell(frame, "acquisition_cost", 0, Decimal("-1.00"))
    assert "DQ-ACQ-004" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_a_vehicle_placed_at_the_wrong_store_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    frame.loc[frame.index[0], "vehicle_id"] = "VEH-9999999"
    assert "DQ-ACQ-005" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_an_allocation_at_the_independent_used_store_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    at_used_store = frame.index[frame["dealership_id"] == STORE_INDEPENDENT_USED][0]
    frame.loc[at_used_store, "acquisition_source"] = SOURCE_MANUFACTURER_ALLOCATION
    assert "DQ-ACQ-006" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)


def test_a_prohibited_column_fails_the_run(
    acquisition_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = acquisition_dataset.frame.copy()
    frame["seller_email"] = ""
    assert "DQ-ACQ-007" in _failed_ids(_tampered(acquisition_dataset, frame), test_config)
