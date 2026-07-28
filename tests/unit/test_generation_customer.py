"""Unit tests for the customer generator and its downstream selection helpers."""

from __future__ import annotations

import random
import re
from datetime import date, timedelta
from types import SimpleNamespace
from typing import cast

import pandas as pd
import pytest

from arpi.config import ArpiConfig
from arpi.constants import SOURCE_SYSTEM
from arpi.exceptions import GenerationError
from arpi.generation.base import GeneratedDataset
from arpi.generation.customer import (
    ACQUISITION_WARM_UP_DAYS,
    ALLOWED_AGE_BANDS,
    ALLOWED_COUNTIES,
    ALLOWED_CUSTOMER_TYPES,
    ALLOWED_MARKET_AREAS,
    ALLOWED_STATE_CODES,
    COUNTY_GEOGRAPHY,
    CUSTOMER_TYPE_BUSINESS,
    CUSTOMER_TYPE_RETAIL,
    DIM_CUSTOMER_COLUMNS,
    MAXIMUM_HOUSEHOLD_SIZE,
    customer_count,
    customer_selection_pool,
    first_interaction_window,
    generate_customer_dataset,
    geography_for_county,
    select_customer_for_sale,
)

CUSTOMER_ID_PATTERN = re.compile(r"^CUS-\d{8}$")
HOUSEHOLD_ID_PATTERN = re.compile(r"^HH-\d{8}$")


@pytest.fixture
def customer_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_customer`` dataset for the ``test`` profile."""
    return generate_customer_dataset(test_config)


# --------------------------------------------------------------------------------------
# Identifiers, schema and determinism
# --------------------------------------------------------------------------------------
def test_every_customer_id_matches_the_reserved_scheme(
    customer_dataset: GeneratedDataset,
) -> None:
    identifiers = customer_dataset.frame["customer_id"].tolist()
    assert identifiers
    assert all(CUSTOMER_ID_PATTERN.match(str(value)) for value in identifiers)


def test_every_household_id_matches_the_reserved_scheme(
    customer_dataset: GeneratedDataset,
) -> None:
    identifiers = customer_dataset.frame["household_id"].tolist()
    assert all(HOUSEHOLD_ID_PATTERN.match(str(value)) for value in identifiers)


def test_customer_ids_are_unique_and_dense(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    identifiers = customer_dataset.frame["customer_id"].tolist()
    expected = [f"CUS-{index:08d}" for index in range(1, customer_count(test_config) + 1)]
    assert identifiers == expected


def test_customer_key_is_a_dense_ordinal(customer_dataset: GeneratedDataset) -> None:
    frame = customer_dataset.frame
    assert frame["customer_key"].tolist() == list(range(1, frame.shape[0] + 1))


def test_the_frame_declares_the_contract_columns_in_order(
    customer_dataset: GeneratedDataset,
) -> None:
    assert customer_dataset.actual_columns == DIM_CUSTOMER_COLUMNS
    assert customer_dataset.schema_matches()


def test_source_system_is_constant(customer_dataset: GeneratedDataset) -> None:
    assert set(customer_dataset.frame["source_system"].tolist()) == {SOURCE_SYSTEM}


def test_generation_is_deterministic(test_config: ArpiConfig) -> None:
    first = generate_customer_dataset(test_config).frame
    second = generate_customer_dataset(test_config).frame
    pd.testing.assert_frame_equal(first, second)


def test_a_different_seed_produces_a_different_population(test_config: ArpiConfig) -> None:
    other = test_config.model_copy(update={"random_seed": test_config.random_seed + 1})
    assert not generate_customer_dataset(test_config).frame.equals(
        generate_customer_dataset(other).frame
    )


def test_no_column_is_null(customer_dataset: GeneratedDataset) -> None:
    assert not customer_dataset.frame.isna().to_numpy().any()


# --------------------------------------------------------------------------------------
# Geography is derived, never drawn
# --------------------------------------------------------------------------------------
def test_state_and_market_area_follow_from_the_county(
    customer_dataset: GeneratedDataset,
) -> None:
    frame = customer_dataset.frame
    expected_state = frame["county"].map({key: value[0] for key, value in COUNTY_GEOGRAPHY.items()})
    expected_market = frame["county"].map(
        {key: value[1] for key, value in COUNTY_GEOGRAPHY.items()}
    )
    assert (frame["state_code"] == expected_state).all()
    assert (frame["market_area"] == expected_market).all()


def test_geography_stays_inside_the_declared_vocabularies(
    customer_dataset: GeneratedDataset,
) -> None:
    frame = customer_dataset.frame
    assert set(frame["county"].tolist()) <= set(ALLOWED_COUNTIES)
    assert set(frame["state_code"].tolist()) <= set(ALLOWED_STATE_CODES)
    assert set(frame["market_area"].tolist()) <= set(ALLOWED_MARKET_AREAS)


@pytest.mark.parametrize(
    ("county", "expected"),
    [
        ("Hillsborough", ("NH", "Southern New Hampshire")),
        ("Strafford", ("NH", "Southern New Hampshire")),
        ("Middlesex", ("MA", "Northern Massachusetts")),
        ("Essex", ("MA", "Northern Massachusetts")),
    ],
)
def test_geography_for_county(county: str, expected: tuple[str, str]) -> None:
    assert geography_for_county(county) == expected


def test_geography_for_county_rejects_an_unknown_county() -> None:
    with pytest.raises(GenerationError, match="outside the declared trading area"):
        geography_for_county("Suffolk")


def test_no_finer_geography_than_county_exists(customer_dataset: GeneratedDataset) -> None:
    """County is the finest geography ARPI stores anywhere."""
    columns = {str(column).lower() for column in customer_dataset.frame.columns}
    for token in ("street", "address", "postal", "zip", "latitude", "longitude", "city"):
        assert not any(token in column for column in columns)


# --------------------------------------------------------------------------------------
# Households
# --------------------------------------------------------------------------------------
def test_every_household_shares_one_geography(customer_dataset: GeneratedDataset) -> None:
    grouped = customer_dataset.frame.groupby("household_id")[
        ["county", "state_code", "market_area"]
    ].nunique()
    assert (grouped == 1).all().all()


def test_some_households_hold_more_than_one_customer(
    customer_dataset: GeneratedDataset,
) -> None:
    sizes = customer_dataset.frame["household_id"].value_counts()
    assert int((sizes > 1).sum()) > 0


def test_no_household_exceeds_the_declared_maximum(customer_dataset: GeneratedDataset) -> None:
    sizes = customer_dataset.frame["household_id"].value_counts()
    assert int(sizes.max()) <= MAXIMUM_HOUSEHOLD_SIZE


def test_household_ids_are_dense(customer_dataset: GeneratedDataset) -> None:
    distinct = sorted(set(customer_dataset.frame["household_id"].tolist()))
    expected = [f"HH-{index:08d}" for index in range(1, len(distinct) + 1)]
    assert distinct == expected


# --------------------------------------------------------------------------------------
# Banded and enumerated attributes
# --------------------------------------------------------------------------------------
def test_age_band_stays_inside_the_declared_bands(customer_dataset: GeneratedDataset) -> None:
    assert set(customer_dataset.frame["age_band"].tolist()) <= set(ALLOWED_AGE_BANDS)


def test_the_age_distribution_is_not_uniform(customer_dataset: GeneratedDataset) -> None:
    """A flat age distribution is a prohibited synthetic pattern."""
    shares = customer_dataset.frame["age_band"].value_counts(normalize=True)
    assert float(shares.max() - shares.min()) > 0.03


def test_customer_type_stays_inside_the_declared_enumeration(
    customer_dataset: GeneratedDataset,
) -> None:
    assert set(customer_dataset.frame["customer_type"].tolist()) <= set(ALLOWED_CUSTOMER_TYPES)


def test_both_customer_types_are_represented(customer_dataset: GeneratedDataset) -> None:
    assert set(customer_dataset.frame["customer_type"].tolist()) == set(ALLOWED_CUSTOMER_TYPES)


def test_a_population_of_repeat_buyers_exists(customer_dataset: GeneratedDataset) -> None:
    prior = customer_dataset.frame["is_prior_customer"]
    assert 0 < int(prior.sum()) < len(prior)


def test_a_population_of_service_customers_exists(customer_dataset: GeneratedDataset) -> None:
    service = customer_dataset.frame["is_service_customer"]
    assert 0 < int(service.sum()) < len(service)


# --------------------------------------------------------------------------------------
# First interaction
# --------------------------------------------------------------------------------------
def test_the_first_interaction_window_opens_at_the_warm_up_period(
    test_config: ArpiConfig,
) -> None:
    earliest, latest = first_interaction_window(test_config)
    assert earliest == test_config.reporting.start_date - timedelta(days=ACQUISITION_WARM_UP_DAYS)
    assert latest == test_config.reporting.end_date


def test_every_first_interaction_falls_inside_the_window(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    earliest, latest = first_interaction_window(test_config)
    dates = customer_dataset.frame["first_interaction_date"]
    assert (dates >= pd.Timestamp(earliest)).all()
    assert (dates <= pd.Timestamp(latest)).all()


def test_prior_customers_first_interacted_before_the_window_opened(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = customer_dataset.frame
    prior = frame.loc[frame["is_prior_customer"], "first_interaction_date"]
    assert not prior.empty
    assert (prior < pd.Timestamp(test_config.reporting.start_date)).all()


def test_customers_exist_before_the_first_day_of_the_window(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A sale on day one of the window must have somebody to attach to."""
    dates = customer_dataset.frame["first_interaction_date"]
    assert int((dates < pd.Timestamp(test_config.reporting.start_date)).sum()) > 0


def test_customer_count_rejects_an_undeclared_scale_mode() -> None:
    stand_in = cast("ArpiConfig", SimpleNamespace(generation=SimpleNamespace(scale_mode="huge")))
    with pytest.raises(GenerationError, match="No customer count"):
        customer_count(stand_in)


# --------------------------------------------------------------------------------------
# Selection helpers used by the fact generators
# --------------------------------------------------------------------------------------
def test_the_selection_pool_covers_every_customer(
    test_config: ArpiConfig, customer_dataset: GeneratedDataset
) -> None:
    pool = customer_selection_pool(test_config)
    assert len(pool) == customer_dataset.row_count
    assert {item.customer_id for item in pool} == set(
        customer_dataset.frame["customer_id"].tolist()
    )


def test_the_selection_pool_is_sorted_by_first_interaction_date(
    test_config: ArpiConfig,
) -> None:
    pool = customer_selection_pool(test_config)
    keys = [(item.first_interaction_date, item.customer_id) for item in pool]
    assert keys == sorted(keys)


def test_the_selection_pool_can_be_restricted_to_one_customer_type(
    test_config: ArpiConfig,
) -> None:
    retail = customer_selection_pool(test_config, customer_type=CUSTOMER_TYPE_RETAIL)
    business = customer_selection_pool(test_config, customer_type=CUSTOMER_TYPE_BUSINESS)
    assert {item.customer_type for item in retail} == {CUSTOMER_TYPE_RETAIL}
    assert {item.customer_type for item in business} == {CUSTOMER_TYPE_BUSINESS}
    assert len(retail) + len(business) == len(customer_selection_pool(test_config))


def test_the_selection_pool_rejects_an_unknown_customer_type(test_config: ArpiConfig) -> None:
    with pytest.raises(GenerationError, match="outside the declared enumeration"):
        customer_selection_pool(test_config, customer_type="Wholesale Buyer")


def test_the_selection_pool_is_deterministic(test_config: ArpiConfig) -> None:
    assert customer_selection_pool(test_config) == customer_selection_pool(test_config)


def test_a_selected_customer_already_existed_on_the_sale_date(
    test_config: ArpiConfig,
) -> None:
    pool = customer_selection_pool(test_config, customer_type=CUSTOMER_TYPE_RETAIL)
    rng = random.Random(7)
    start = test_config.reporting.start_date
    for offset in range(0, 56, 7):
        sale_date = start + timedelta(days=offset)
        for _ in range(20):
            selected = select_customer_for_sale(pool, sale_date, rng)
            assert selected is not None
            assert selected.first_interaction_date <= sale_date


def test_no_customer_is_offered_before_anybody_has_interacted(
    test_config: ArpiConfig,
) -> None:
    pool = customer_selection_pool(test_config)
    earliest, _ = first_interaction_window(test_config)
    assert select_customer_for_sale(pool, earliest - timedelta(days=1), random.Random(1)) is None


def test_selection_is_reproducible_for_a_given_generator(test_config: ArpiConfig) -> None:
    pool = customer_selection_pool(test_config)
    sale_date = date(2025, 2, 1)
    first = [select_customer_for_sale(pool, sale_date, random.Random(3)) for _ in range(5)]
    second = [select_customer_for_sale(pool, sale_date, random.Random(3)) for _ in range(5)]
    assert first == second
