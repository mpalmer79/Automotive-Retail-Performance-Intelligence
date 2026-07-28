"""Data-quality assertions over the generated customer dimension.

The privacy assertions in this module are the highest-value tests in the file. They
inspect the **schema**, not the values, so a prohibited column fails the run even when it
is entirely empty.
"""

from __future__ import annotations

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import (
    ALLOWED_AGE_BANDS,
    ALLOWED_COUNTIES,
    ALLOWED_CUSTOMER_TYPES,
    ALLOWED_MARKET_AREAS,
    ALLOWED_STATE_CODES,
    CUSTOMER_CHECK_IDS,
    CUSTOMER_COUNT_BY_SCALE,
    DIM_CUSTOMER_COLUMNS,
    MAXIMUM_HOUSEHOLD_SIZE,
    generate_customer_dataset,
    validate_customer_dataset,
)
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered

pytestmark = pytest.mark.data_quality

#: The prohibited vocabulary spelled out verbatim, so that a future refactor of the shared
#: privacy module cannot silently narrow what this entity is checked against.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "address",
    "street_address",
    "ssn",
    "social_security_number",
    "date_of_birth",
    "dob",
    "drivers_license",
    "bank_account",
    "credit_card",
    "credit_score",
    "salary",
    "compensation",
    "commission",
    "pay_plan",
    "race",
    "ethnicity",
    "gender",
    "religion",
    "marital_status",
    "veteran_status",
    "notes",
    "comments",
)


@pytest.fixture
def customer_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_customer`` dataset for the ``test`` profile."""
    return generate_customer_dataset(test_config)


@pytest.fixture
def development_customer_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_customer`` dataset for the ``development`` profile."""
    return generate_customer_dataset(development_config)


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(
    customer_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in customer_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_the_column_set_is_exactly_the_contract(customer_dataset: GeneratedDataset) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(customer_dataset.actual_columns) == set(DIM_CUSTOMER_COLUMNS)


def test_age_is_banded_and_never_exact(customer_dataset: GeneratedDataset) -> None:
    columns = {str(column).lower() for column in customer_dataset.frame.columns}
    assert "age_band" in columns
    assert "age" not in columns
    assert set(customer_dataset.frame["age_band"].tolist()) <= set(ALLOWED_AGE_BANDS)


def test_geography_stops_at_county_and_market_area(
    customer_dataset: GeneratedDataset,
) -> None:
    columns = {str(column).lower() for column in customer_dataset.frame.columns}
    for token in ("street", "address", "postal", "zip", "latitude", "longitude", "geocode"):
        assert not any(token in column for column in columns)
    assert {"county", "state_code", "market_area"} <= columns


def test_no_free_form_text_column_exists(customer_dataset: GeneratedDataset) -> None:
    columns = {str(column).lower() for column in customer_dataset.frame.columns}
    for token in ("note", "comment", "memo", "remark", "transcript", "recording"):
        assert not any(token in column for column in columns)


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-CUS-003")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(customer_dataset: GeneratedDataset) -> None:
    assert customer_dataset.actual_columns == DIM_CUSTOMER_COLUMNS
    assert len(DIM_CUSTOMER_COLUMNS) == 12


def test_no_column_is_ever_null(customer_dataset: GeneratedDataset) -> None:
    assert not customer_dataset.frame.isna().to_numpy().any()


# --------------------------------------------------------------------------------------
# Scale and distribution
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("profile", ["test", "development"])
def test_the_population_matches_the_declared_scale(profile: str) -> None:
    dataset = generate_customer_dataset(load_config(profile=profile))
    assert dataset.row_count == CUSTOMER_COUNT_BY_SCALE[profile]


def test_every_declared_county_is_represented_at_development_scale(
    development_customer_dataset: GeneratedDataset,
) -> None:
    assert set(development_customer_dataset.frame["county"].tolist()) == set(ALLOWED_COUNTIES)


def test_both_market_areas_are_represented(
    development_customer_dataset: GeneratedDataset,
) -> None:
    frame = development_customer_dataset.frame
    assert set(frame["market_area"].tolist()) == set(ALLOWED_MARKET_AREAS)
    assert set(frame["state_code"].tolist()) == set(ALLOWED_STATE_CODES)


def test_the_home_county_dominates(development_customer_dataset: GeneratedDataset) -> None:
    """All three stores sit in Hillsborough County; the customer base must reflect that."""
    shares = development_customer_dataset.frame["county"].value_counts(normalize=True)
    assert shares.idxmax() == "Hillsborough"
    assert float(shares.max()) > 0.30


def test_every_age_band_is_represented_at_development_scale(
    development_customer_dataset: GeneratedDataset,
) -> None:
    assert set(development_customer_dataset.frame["age_band"].tolist()) == set(ALLOWED_AGE_BANDS)


def test_the_age_distribution_is_not_uniform(
    development_customer_dataset: GeneratedDataset,
) -> None:
    shares = development_customer_dataset.frame["age_band"].value_counts(normalize=True)
    assert float(shares.max() - shares.min()) > 0.05


def test_business_buyers_are_a_minority(
    development_customer_dataset: GeneratedDataset,
) -> None:
    frame = development_customer_dataset.frame
    assert set(frame["customer_type"].tolist()) == set(ALLOWED_CUSTOMER_TYPES)
    business_share = float(frame["customer_type"].eq("Business").mean())
    assert 0.01 < business_share < 0.20


def test_households_group_some_customers_but_not_all(
    development_customer_dataset: GeneratedDataset,
) -> None:
    sizes = development_customer_dataset.frame["household_id"].value_counts()
    assert int((sizes == 1).sum()) > 0
    assert int((sizes > 1).sum()) > 0
    assert int(sizes.max()) <= MAXIMUM_HOUSEHOLD_SIZE


def test_every_household_shares_one_geography(
    development_customer_dataset: GeneratedDataset,
) -> None:
    grouped = development_customer_dataset.frame.groupby("household_id")[
        ["county", "state_code", "market_area"]
    ].nunique()
    assert (grouped == 1).all().all()


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_generating_customers_does_not_perturb_any_other_entity(
    test_config: ArpiConfig,
) -> None:
    """One namespace per entity: adding an entity must never move another's digest."""
    before = {
        "dim_date": content_digest(
            dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
        ),
        "dim_dealership": content_digest(
            dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
        ),
        "dim_employee": content_digest(
            dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
        ),
    }
    generate_customer_dataset(test_config)
    after = {
        "dim_date": content_digest(
            dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
        ),
        "dim_dealership": content_digest(
            dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
        ),
        "dim_employee": content_digest(
            dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
        ),
    }
    assert before == after


def test_the_customer_digest_is_stable_across_reruns(test_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_customer_dataset(customer_dataset, test_config)
    failures = [result for result in report.results if result.is_failure]
    assert not failures, [result.message for result in failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_customer_dataset(customer_dataset, test_config)
    emitted = [result.check_id for result in report.results]
    assert emitted == list(CUSTOMER_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    for result in validate_customer_dataset(customer_dataset, test_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id


def test_the_gating_suite_fails_when_a_prohibited_column_appears(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The tripwire has to actually trip, so assert the failure rather than the pass."""
    tampered = customer_dataset.frame.copy()
    tampered["customer_email"] = ""
    dataset = GeneratedDataset(
        entity_name=customer_dataset.entity_name,
        frame=tampered,
        declared_columns=customer_dataset.declared_columns,
        namespace=customer_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_customer_dataset(dataset, test_config).results
    }
    assert results["DQ-CUS-003"].is_failure


def test_the_gating_suite_fails_on_an_inconsistent_geography(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = customer_dataset.frame.copy()
    tampered.loc[tampered.index[0], "state_code"] = "MA"
    tampered.loc[tampered.index[0], "county"] = "Hillsborough"
    dataset = GeneratedDataset(
        entity_name=customer_dataset.entity_name,
        frame=tampered,
        declared_columns=customer_dataset.declared_columns,
        namespace=customer_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_customer_dataset(dataset, test_config).results
    }
    assert results["DQ-CUS-004"].is_failure


def test_the_gating_suite_fails_on_a_household_spanning_two_counties(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = customer_dataset.frame.copy()
    first_household = str(tampered.iloc[0]["household_id"])
    tampered.loc[tampered.index[1], "household_id"] = first_household
    tampered.loc[tampered.index[1], "county"] = "Strafford"
    dataset = GeneratedDataset(
        entity_name=customer_dataset.entity_name,
        frame=tampered,
        declared_columns=customer_dataset.declared_columns,
        namespace=customer_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_customer_dataset(dataset, test_config).results
    }
    assert results["DQ-CUS-006"].is_failure


def test_the_gating_suite_fails_on_a_first_interaction_outside_the_window(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = customer_dataset.frame.copy()
    tampered.loc[tampered.index[0], "first_interaction_date"] = pd.Timestamp("2000-01-01")
    dataset = GeneratedDataset(
        entity_name=customer_dataset.entity_name,
        frame=tampered,
        declared_columns=customer_dataset.declared_columns,
        namespace=customer_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_customer_dataset(dataset, test_config).results
    }
    assert results["DQ-CUS-007"].is_failure


def test_the_gating_suite_fails_on_a_prohibited_finance_column(
    customer_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The finance-and-insurance prohibitions are entity-specific, so assert them here."""
    tampered = customer_dataset.frame.copy()
    tampered["credit_application_status"] = ""
    dataset = GeneratedDataset(
        entity_name=customer_dataset.entity_name,
        frame=tampered,
        declared_columns=customer_dataset.declared_columns,
        namespace=customer_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_customer_dataset(dataset, test_config).results
    }
    assert results["DQ-CUS-003"].is_failure
