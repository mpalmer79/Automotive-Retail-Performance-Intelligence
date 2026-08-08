"""Data-quality assertions over the generated sale source entity.

Every distributional assertion runs at the **development** profile (900 acquired units,
roughly 650 finalized sales over a six-month window). The ``test`` profile produces
around thirty sales across two months, which is not enough to make a claim about a
correlation, a variance ratio or a seasonal shape without the test becoming flaky; where
this module uses the ``test`` profile it is for structural or reproducibility assertions
only, and it says so.

Assertions are directions and bands. Nothing here asserts a point value, and nothing here
depends on a random seed other than the one the profile pins.
"""

from __future__ import annotations

from decimal import Decimal

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.acquisition import build_acquisition_records, generate_acquisition_dataset
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.sale import (
    ALLOWED_SALE_TYPES,
    NEGATIVE_GROSS_SHARE_BOUNDS,
    RETAIL_SALE_TYPES,
    SALE_CHECK_IDS,
    SALE_DAY_OF_WEEK_WEIGHT,
    SALE_EVENT_COLUMNS,
    SALE_EVENT_NULLABLE_COLUMNS,
    SALE_MONTH_WEIGHT,
    SALE_NON_NEGATIVE_MONEY_COLUMNS,
    SALE_TYPE_WHOLESALE,
    build_sale_records,
    generate_sale_dataset,
    validate_sale_dataset,
)
from arpi.generation.vehicle import CONDITION_NEW, generate_vehicle_dataset
from arpi.generation.vehicle_model import generate_vehicle_model_dataset
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered

pytestmark = pytest.mark.data_quality

#: The deal jacket is the richest source of personal data in a real dealership. This
#: entity is inspected against the vocabulary verbatim rather than trusting that a future
#: refactor of the shared privacy module will keep covering it.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "customer_name",
    "buyer_name",
    "salesperson_name",
    "email",
    "phone",
    "address",
    "street_address",
    "ssn",
    "date_of_birth",
    "drivers_license",
    "bank_account",
    "credit_card",
    "credit_score",
    "credit_application",
    "salary",
    "commission",
    "pay_plan",
    "notes",
    "comments",
)

#: Inclusive sell-through band at development scale. Wide enough that a modelling tweak
#: does not break it, narrow enough that "everything sells" or "nothing sells" does.
DEVELOPMENT_SELL_THROUGH_BOUNDS = (0.55, 0.88)

#: The ``test`` profile's window is two months, so far fewer units get the chance to sell.
TEST_SELL_THROUGH_BOUNDS = (0.25, 0.80)


@pytest.fixture(scope="module")
def development_config() -> ArpiConfig:
    """The ``development`` profile, resolved hermetically for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="development", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def development_sales(development_config: ArpiConfig) -> pd.DataFrame:
    """Sale records at development scale, flattened for analysis."""
    return pd.DataFrame(
        [
            {
                "sale_id": record.sale_id,
                "sale_date": record.sale_date,
                "dealership_id": record.dealership_id,
                "sale_type": record.sale_type,
                "is_retail": record.is_retail,
                "condition_type": record.condition_type,
                "customer_id": record.customer_id,
                "salesperson_id": record.salesperson_id,
                "days_in_inventory_at_sale": record.days_in_inventory_at_sale,
                "sale_price": float(record.sale_price),
                "front_end_gross": float(record.front_end_gross),
                "back_end_gross": float(record.back_end_gross),
                "total_gross": float(record.total_gross),
            }
            for record in build_sale_records(development_config)
        ]
    )


@pytest.fixture(scope="module")
def development_acquired_count(development_config: ArpiConfig) -> int:
    """How many units were acquired at development scale."""
    return len(build_acquisition_records(development_config))


@pytest.fixture(scope="module")
def development_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``sale_event`` dataset at development scale."""
    return generate_sale_dataset(development_config)


@pytest.fixture
def sale_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``sale_event`` dataset for the ``test`` profile."""
    return generate_sale_dataset(test_config)


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
def test_the_column_order_is_exactly_the_contract(sale_dataset: GeneratedDataset) -> None:
    assert sale_dataset.actual_columns == SALE_EVENT_COLUMNS
    # 29 through DASH.5; DASH.6 added finance_reserve_gross and lender_id, which are
    # the two columns that make back-end gross explainable rather than merely stored.
    assert len(SALE_EVENT_COLUMNS) == 31


def test_the_column_set_is_exactly_the_contract(sale_dataset: GeneratedDataset) -> None:
    """Deny by default: anything outside the contract is, by construction, not generated."""
    assert set(sale_dataset.actual_columns) == set(SALE_EVENT_COLUMNS)


def test_only_the_declared_nullable_columns_are_ever_null(
    development_dataset: GeneratedDataset,
) -> None:
    required = [
        column for column in SALE_EVENT_COLUMNS if column not in SALE_EVENT_NULLABLE_COLUMNS
    ]
    assert not development_dataset.frame[required].isna().to_numpy().any()


def test_the_source_entity_uses_natural_ids_rather_than_surrogate_keys(
    sale_dataset: GeneratedDataset,
) -> None:
    columns = set(sale_dataset.actual_columns)
    assert not any(column.endswith("_key") for column in columns)
    assert {"vehicle_id", "dealership_id", "customer_id", "salesperson_id"} <= columns
    assert {"sale_date", "delivery_date"} <= columns


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(sale_dataset: GeneratedDataset, prohibited: str) -> None:
    columns = {str(column).lower() for column in sale_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_no_latent_performance_parameter_leaks_into_the_fact(
    sale_dataset: GeneratedDataset,
) -> None:
    """The employee performance indices are generation inputs, never facts."""
    columns = {str(column).lower() for column in sale_dataset.frame.columns}
    for token in ("closing_rate", "gross_retention", "volume_index", "crm_discipline"):
        assert not any(token in column for column in columns)


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-SLE-009")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


# --------------------------------------------------------------------------------------
# Sell-through: not everything sells
# --------------------------------------------------------------------------------------
def test_sell_through_at_development_scale_is_inside_its_band(
    development_sales: pd.DataFrame, development_acquired_count: int
) -> None:
    minimum, maximum = DEVELOPMENT_SELL_THROUGH_BOUNDS
    observed = len(development_sales) / development_acquired_count
    assert minimum < observed < maximum, observed


def test_sell_through_at_test_scale_is_inside_its_band(test_config: ArpiConfig) -> None:
    minimum, maximum = TEST_SELL_THROUGH_BOUNDS
    observed = len(build_sale_records(test_config)) / len(build_acquisition_records(test_config))
    assert minimum < observed < maximum, observed


def test_unsold_units_remain_for_the_inventory_snapshot_to_find(
    development_sales: pd.DataFrame, development_acquired_count: int
) -> None:
    assert development_acquired_count - len(development_sales) > 50


def test_every_sold_vehicle_appears_exactly_once(development_sales: pd.DataFrame) -> None:
    assert development_sales["sale_id"].is_unique
    assert development_sales.shape[0] == development_sales["sale_id"].nunique()


# --------------------------------------------------------------------------------------
# Deal mix
# --------------------------------------------------------------------------------------
def test_every_declared_deal_type_occurs_at_development_scale(
    development_sales: pd.DataFrame,
) -> None:
    assert set(development_sales["sale_type"]) == set(ALLOWED_SALE_TYPES)


def test_retail_dominates_but_wholesale_genuinely_exists(
    development_sales: pd.DataFrame,
) -> None:
    retail_share = float(development_sales["is_retail"].mean())
    assert 0.70 < retail_share < 0.97, retail_share


def test_is_retail_agrees_with_sale_type_on_every_row(
    development_sales: pd.DataFrame,
) -> None:
    derived = development_sales["sale_type"].isin(RETAIL_SALE_TYPES)
    assert (development_sales["is_retail"] == derived).all()


def test_a_new_unit_is_never_sold_as_a_used_retail_deal(
    development_sales: pd.DataFrame,
) -> None:
    new_units = development_sales[development_sales["condition_type"] == CONDITION_NEW]
    assert "Used Retail" not in set(new_units["sale_type"])
    assert "Certified Retail" not in set(new_units["sale_type"])


def test_wholesale_carries_no_customer_and_retail_always_does(
    development_sales: pd.DataFrame,
) -> None:
    retail = development_sales[development_sales["is_retail"]]
    non_retail = development_sales[~development_sales["is_retail"]]
    assert retail["customer_id"].notna().all()
    assert non_retail["customer_id"].isna().all()
    assert not non_retail.empty


# --------------------------------------------------------------------------------------
# Gross
# --------------------------------------------------------------------------------------
def test_a_negative_front_end_gross_population_exists_and_is_a_minority(
    development_sales: pd.DataFrame,
) -> None:
    """Real dealerships lose money on some units. A dataset without losses is a fiction."""
    share = float((development_sales["front_end_gross"] < 0).mean())
    minimum, maximum = NEGATIVE_GROSS_SHARE_BOUNDS
    assert minimum <= share <= maximum, share
    assert share < 0.5, share


def test_the_negative_population_is_not_confined_to_one_deal_type(
    development_sales: pd.DataFrame,
) -> None:
    losing = development_sales[development_sales["front_end_gross"] < 0]
    assert losing["sale_type"].nunique() >= 3


def test_wholesale_is_where_most_of_the_loss_lives(
    development_sales: pd.DataFrame,
) -> None:
    wholesale = development_sales[development_sales["sale_type"] == SALE_TYPE_WHOLESALE]
    assert float(wholesale["front_end_gross"].mean()) < float(
        development_sales["front_end_gross"].mean()
    )


def test_used_gross_varies_more_than_new_gross(development_sales: pd.DataFrame) -> None:
    """New pricing is anchored to a sticker; used pricing is not, so its spread is wider."""
    is_new = development_sales["condition_type"] == CONDITION_NEW
    new_variance = float(development_sales.loc[is_new, "front_end_gross"].var())
    used_variance = float(development_sales.loc[~is_new, "front_end_gross"].var())
    assert used_variance > new_variance * 2.0, (new_variance, used_variance)


def test_gross_weakens_as_age_at_sale_rises_without_being_determined_by_it(
    development_sales: pd.DataFrame,
) -> None:
    correlation = float(
        development_sales["days_in_inventory_at_sale"].corr(development_sales["front_end_gross"])
    )
    assert -0.70 < correlation < -0.02, correlation


def test_aged_units_hold_less_gross_than_fresh_ones_on_average(
    development_sales: pd.DataFrame,
) -> None:
    fresh = development_sales[development_sales["days_in_inventory_at_sale"] <= 30]
    aged = development_sales[development_sales["days_in_inventory_at_sale"] > 90]
    assert not fresh.empty
    assert not aged.empty
    assert float(aged["front_end_gross"].mean()) < float(fresh["front_end_gross"].mean())


def test_back_end_gross_only_ever_arrives_on_a_retail_deal(
    development_sales: pd.DataFrame,
) -> None:
    non_retail = development_sales[~development_sales["is_retail"]]
    assert float(non_retail["back_end_gross"].abs().max()) == 0.0
    assert float(development_sales.loc[development_sales["is_retail"], "back_end_gross"].mean()) > 0


def test_the_gross_identities_hold_to_the_cent_on_every_row(
    development_dataset: GeneratedDataset,
) -> None:
    frame = development_dataset.frame
    for price, cost, recon, pack, front, back, total in zip(
        frame["sale_price"],
        frame["acquisition_cost"],
        frame["reconditioning_cost"],
        frame["pack_amount"],
        frame["front_end_gross"],
        frame["back_end_gross"],
        frame["total_gross"],
        strict=True,
    ):
        assert front == price - cost - recon - pack
        assert total == front + back


def test_no_column_outside_the_gross_pair_is_ever_negative(
    development_dataset: GeneratedDataset,
) -> None:
    for column in SALE_NON_NEGATIVE_MONEY_COLUMNS:
        values = [
            Decimal(str(value))
            for value in development_dataset.frame[column]
            if value is not None and not pd.isna(value)
        ]
        assert min(values) >= 0, column


# --------------------------------------------------------------------------------------
# Seasonality
# --------------------------------------------------------------------------------------
def test_the_declared_month_weights_are_not_flat() -> None:
    weights = list(SALE_MONTH_WEIGHT.values())
    assert len(SALE_MONTH_WEIGHT) == 12
    assert max(weights) / min(weights) > 1.25


def test_monthly_sales_volume_is_not_flat(development_sales: pd.DataFrame) -> None:
    """Flat monthly activity is a prohibited synthetic pattern."""
    counts = development_sales["sale_date"].map(lambda value: value.month).value_counts()
    assert len(counts) >= 6
    assert float(counts.max() / counts.min()) > 1.15


def test_saturday_is_the_biggest_selling_day_and_sunday_the_smallest(
    development_sales: pd.DataFrame,
) -> None:
    counts = development_sales["sale_date"].map(lambda value: value.weekday()).value_counts()
    assert counts.idxmax() == 5
    assert counts.idxmin() == 6
    weekday_average = sum(int(counts.get(day, 0)) for day in range(5)) / 5
    assert int(counts.get(6, 0)) < weekday_average / 4
    assert SALE_DAY_OF_WEEK_WEIGHT[5] == max(SALE_DAY_OF_WEEK_WEIGHT)
    assert SALE_DAY_OF_WEEK_WEIGHT[6] == min(SALE_DAY_OF_WEEK_WEIGHT)


def test_days_in_inventory_spans_a_plausible_range(development_sales: pd.DataFrame) -> None:
    days = development_sales["days_in_inventory_at_sale"]
    assert int(days.min()) >= 0
    assert 20 < float(days.mean()) < 150
    assert int(days.max()) > 120


# --------------------------------------------------------------------------------------
# Employee participation
# --------------------------------------------------------------------------------------
def test_more_than_one_salesperson_writes_business_at_every_store(
    development_sales: pd.DataFrame,
) -> None:
    """Identical employee performance is a prohibited pattern; so is a one-person floor."""
    per_store = development_sales.groupby("dealership_id")["salesperson_id"].nunique()
    assert int(per_store.min()) > 1


def test_salespeople_do_not_all_sell_the_same_number_of_units(
    development_sales: pd.DataFrame,
) -> None:
    counts = development_sales["salesperson_id"].value_counts()
    assert counts.nunique() > 1


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_sale_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_sale_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_generating_sales_does_not_perturb_any_other_entity(test_config: ArpiConfig) -> None:
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
            "acquisition_event": content_digest(
                dataframe_to_csv_bytes(generate_acquisition_dataset(test_config).frame)
            ),
        }

    before = digests()
    generate_sale_dataset(test_config)
    assert digests() == before


def test_the_sale_digest_is_stable_across_reruns(test_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_sale_dataset(test_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(sale_dataset: GeneratedDataset, test_config: ArpiConfig) -> None:
    report = validate_sale_dataset(sale_dataset, test_config)
    assert not report.failures, [result.message for result in report.failures]


def test_every_gating_check_passes_at_development_scale(
    development_dataset: GeneratedDataset, development_config: ArpiConfig
) -> None:
    report = validate_sale_dataset(development_dataset, development_config)
    assert not report.failures, [result.message for result in report.failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    emitted = [
        result.check_id for result in validate_sale_dataset(sale_dataset, test_config).results
    ]
    assert emitted == list(SALE_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    for result in validate_sale_dataset(sale_dataset, test_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id


def test_the_negative_gross_check_is_a_warning_rather_than_a_gate() -> None:
    definition = require_registered("DQ-SLE-010")
    assert str(definition.severity) == "warning"


# --------------------------------------------------------------------------------------
# The tripwires have to actually trip
# --------------------------------------------------------------------------------------
def _failed_ids(dataset: GeneratedDataset, config: ArpiConfig) -> set[str]:
    return {result.check_id for result in validate_sale_dataset(dataset, config).failures}


def test_a_duplicate_sale_id_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame.loc[frame.index[1], "sale_id"] = frame.loc[frame.index[0], "sale_id"]
    assert "DQ-SLE-001" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_reordered_column_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    columns = list(SALE_EVENT_COLUMNS)
    columns[0], columns[1] = columns[1], columns[0]
    assert "DQ-SLE-002" in _failed_ids(
        _tampered(sale_dataset, sale_dataset.frame[columns]), test_config
    )


def test_a_sale_before_its_own_acquisition_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame.loc[frame.index[0], "sale_date"] = pd.Timestamp("2000-01-01")
    assert "DQ-SLE-003" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_broken_gross_identity_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    original = Decimal(str(frame["front_end_gross"].iloc[0]))
    _replace_cell(frame, "front_end_gross", 0, original + Decimal("0.01"))
    assert "DQ-SLE-004" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_retail_sale_with_no_customer_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    retail = frame.index[frame["is_retail"]][0]
    frame.loc[retail, "customer_id"] = None
    assert "DQ-SLE-005" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_an_invented_customer_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame.loc[frame.index[0], "customer_id"] = "CUS-99999999"
    assert "DQ-SLE-005" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_an_independently_drawn_retail_flag_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame.loc[frame.index[0], "is_retail"] = not bool(frame.loc[frame.index[0], "is_retail"])
    assert "DQ-SLE-006" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_unit_count_other_than_one_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame.loc[frame.index[0], "unit_count"] = 2
    assert "DQ-SLE-007" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_finance_manager_credited_as_the_salesperson_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    with_finance = frame.index[frame["finance_manager_id"].notna()][0]
    frame.loc[with_finance, "salesperson_id"] = frame.loc[with_finance, "finance_manager_id"]
    assert "DQ-SLE-008" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_prohibited_column_fails_the_run(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = sale_dataset.frame.copy()
    frame["buyer_credit_score"] = 0
    assert "DQ-SLE-009" in _failed_ids(_tampered(sale_dataset, frame), test_config)


def test_a_dataset_with_no_losing_deal_at_all_is_reported(
    sale_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """Unrealistically clean data is itself a defect, so the absence must be visible."""
    frame = sale_dataset.frame.copy()
    frame["front_end_gross"] = pd.Series(
        [Decimal("1000.00")] * len(frame), index=frame.index, dtype=object
    )
    assert "DQ-SLE-010" in _failed_ids(_tampered(sale_dataset, frame), test_config)
