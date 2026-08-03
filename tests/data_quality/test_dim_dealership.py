"""Data-quality assertions over the generated dealership dimension."""

from __future__ import annotations

from datetime import date
from typing import cast

import pandas as pd
import pytest

from arpi.config import ArpiConfig
from arpi.constants import (
    DIM_DEALERSHIP_COLUMNS,
    DIM_DEALERSHIP_REQUIRED_COLUMNS,
    PROHIBITED_PII_FIELD_NAMES,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
    STORE_TYPE_FRANCHISE,
    STORE_TYPE_INDEPENDENT,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.dealership import STORE_DEFINITIONS as STORES
from arpi.generation.dealership import dealership_attribute_hash

pytestmark = pytest.mark.data_quality

# The authoritative store list, restated here so a silent edit to the generator fails.
EXPECTED_STORES = [
    (
        1,
        "GSA-001",
        "Granite Chevrolet of Nashua",
        "Granite Chevrolet",
        STORE_TYPE_FRANCHISE,
        "Chevrolet",
        "Nashua",
        "NH",
        "Southern New Hampshire",
        date(2009, 4, 6),
    ),
    (
        2,
        "GSA-002",
        "Granite Subaru of Manchester",
        "Granite Subaru",
        STORE_TYPE_FRANCHISE,
        "Subaru",
        "Manchester",
        "NH",
        "Southern New Hampshire",
        date(2013, 8, 19),
    ),
    (
        3,
        "GSA-003",
        "Granite Pre-Owned Center of Merrimack",
        "Granite Pre-Owned",
        STORE_TYPE_INDEPENDENT,
        None,
        "Merrimack",
        "NH",
        "Southern New Hampshire",
        date(2017, 3, 13),
    ),
]


def test_column_set_and_order_match_the_contract(
    dealership_dataset: GeneratedDataset,
) -> None:
    assert tuple(dealership_dataset.frame.columns) == DIM_DEALERSHIP_COLUMNS
    assert len(DIM_DEALERSHIP_COLUMNS) == 16


def test_exactly_three_stores(
    dealership_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    assert dealership_dataset.row_count == 3
    assert dealership_dataset.row_count == test_config.generation.store_count
    assert len(STORES) == 3


def test_every_store_matches_the_contract_verbatim(
    dealership_dataset: GeneratedDataset,
) -> None:
    frame = dealership_dataset.frame
    for index, expected in enumerate(EXPECTED_STORES):
        row = frame.iloc[index]
        assert int(row["dealership_key"]) == expected[0]
        assert row["dealership_id"] == expected[1]
        assert row["store_name"] == expected[2]
        assert row["store_short_name"] == expected[3]
        assert row["store_type"] == expected[4]
        if expected[5] is None:
            assert pd.isna(row["franchise_brand"])
        else:
            assert row["franchise_brand"] == expected[5]
        assert row["city"] == expected[6]
        assert row["state_code"] == expected[7]
        assert row["market_region"] == expected[8]
        assert cast(pd.Timestamp, row["opened_date"]).date() == expected[9]


def test_keys_are_unique_and_ordered_by_natural_key(
    dealership_dataset: GeneratedDataset,
) -> None:
    frame = dealership_dataset.frame
    assert frame["dealership_key"].is_unique
    assert frame["dealership_id"].is_unique
    assert list(frame["dealership_key"]) == [1, 2, 3]
    assert list(frame["dealership_id"]) == sorted(frame["dealership_id"])


def test_no_nulls_in_required_columns(dealership_dataset: GeneratedDataset) -> None:
    frame = dealership_dataset.frame
    assert not frame[list(DIM_DEALERSHIP_REQUIRED_COLUMNS)].isna().to_numpy().any()


def test_only_the_independent_store_has_a_null_brand(
    dealership_dataset: GeneratedDataset,
) -> None:
    frame = dealership_dataset.frame
    missing = frame[frame["franchise_brand"].isna()]
    assert list(missing["dealership_id"]) == ["GSA-003"]
    assert (missing["store_type"] == STORE_TYPE_INDEPENDENT).all()


def test_scd_columns_describe_one_open_version_per_store(
    dealership_dataset: GeneratedDataset,
) -> None:
    frame = dealership_dataset.frame
    assert (frame["effective_date"] == frame["opened_date"]).all()
    assert (frame["expiration_date"] == pd.Timestamp(SENTINEL_EXPIRATION_DATE)).all()
    assert frame["is_current"].all()
    assert frame["is_active"].all()
    assert (frame["source_system"] == SOURCE_SYSTEM).all()


def test_effective_date_uniqueness_per_store(dealership_dataset: GeneratedDataset) -> None:
    frame = dealership_dataset.frame
    pairs = list(zip(frame["dealership_id"], frame["effective_date"], strict=True))
    assert len(set(pairs)) == len(pairs)


def test_attribute_hash_is_a_sha256_of_the_tracked_attributes(
    dealership_dataset: GeneratedDataset,
) -> None:
    frame = dealership_dataset.frame
    assert frame["attribute_hash"].is_unique
    by_id = {store.dealership_id: store for store in STORES}
    for row in frame.to_dict(orient="records"):
        digest = str(row["attribute_hash"])
        assert len(digest) == 64
        assert set(digest) <= set("0123456789abcdef")
        assert digest == dealership_attribute_hash(by_id[str(row["dealership_id"])])


def test_no_prohibited_pii_columns(dealership_dataset: GeneratedDataset) -> None:
    columns = {column.lower() for column in dealership_dataset.frame.columns}
    assert not columns & PROHIBITED_PII_FIELD_NAMES


def test_no_contact_details_in_any_value(dealership_dataset: GeneratedDataset) -> None:
    rendered = dealership_dataset.frame.astype("string").to_string()
    assert "@" not in rendered
    assert "Street" not in rendered
    assert "Ave" not in rendered
