"""Unit tests for the CRM lead generator.

The assertions that carry the most weight here are the two encoding rules, because both are
silent failures rather than loud ones:

* a lead nobody responded to carries ``NULL``, **never** ``0``;
* the funnel implication chain nests, so a later stage can never exceed an earlier one.

Everything statistical lives in ``tests/data_quality/test_lead_quality.py``. This module
asserts structure, identifiers, determinism and the implications, all at the ``test``
profile so it stays fast.
"""

from __future__ import annotations

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.exceptions import GenerationError
from arpi.generation.base import GeneratedDataset
from arpi.generation.employee import employee_performance_profiles
from arpi.generation.lead import (
    DISCIPLINE_BOUNDS,
    LEAD_CHECK_IDS,
    LEAD_EVENT_COLUMNS,
    LEAD_EVENT_NULLABLE_COLUMNS,
    LEAD_ID_DIGITS,
    LEAD_ID_PREFIX,
    LEAD_NAMESPACE,
    MEAN_CRM_DISCIPLINE_INDEX,
    MINIMUM_RESPONSE_SECONDS,
    RESPONSE_INFLUENCE_BOUNDS,
    SOURCE_PROPENSITY_BOUNDS,
    LeadGenerator,
    build_lead_records,
    discipline_multiplier,
    funnel_population,
    generate_lead_dataset,
    lead_count_for,
    lead_id_for,
    response_time_influence,
    source_propensity,
)
from arpi.generation.lead_source import (
    TOTAL_LEAD_COUNT_BY_SCALE,
    lead_source_behaviour,
    lead_source_behaviours,
)
from arpi.generation.writer import dataframe_to_csv_bytes


@pytest.fixture(scope="module")
def unit_config() -> ArpiConfig:
    """The ``test`` profile, resolved hermetically once for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="test", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def lead_dataset(unit_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``lead_event`` dataset for the ``test`` profile."""
    return generate_lead_dataset(unit_config)


# --------------------------------------------------------------------------------------
# Identifiers
# --------------------------------------------------------------------------------------
def test_the_identifier_scheme_is_the_reserved_one() -> None:
    assert lead_id_for(1) == "LED-000000001"
    assert lead_id_for(42199) == "LED-000042199"
    assert lead_id_for(10**LEAD_ID_DIGITS - 1).startswith(LEAD_ID_PREFIX)


@pytest.mark.parametrize("ordinal", [0, -1])
def test_a_non_positive_ordinal_is_refused(ordinal: int) -> None:
    with pytest.raises(GenerationError, match="ordinals start at 1"):
        lead_id_for(ordinal)


def test_an_ordinal_too_wide_for_the_scheme_is_refused() -> None:
    with pytest.raises(GenerationError, match="does not fit the reserved"):
        lead_id_for(10**LEAD_ID_DIGITS)


def test_every_generated_identifier_matches_the_scheme(lead_dataset: GeneratedDataset) -> None:
    identifiers = lead_dataset.frame["lead_id"].tolist()
    assert all(value.startswith(LEAD_ID_PREFIX) for value in identifiers)
    assert all(len(value) == len(LEAD_ID_PREFIX) + LEAD_ID_DIGITS for value in identifiers)
    assert all(value[len(LEAD_ID_PREFIX) :].isdigit() for value in identifiers)


def test_identifiers_are_assigned_in_arrival_order(lead_dataset: GeneratedDataset) -> None:
    frame = lead_dataset.frame
    assert frame["lead_id"].is_monotonic_increasing
    assert frame["lead_created_date"].is_monotonic_increasing


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_declared_contract_is_nineteen_columns_in_order(
    lead_dataset: GeneratedDataset,
) -> None:
    assert lead_dataset.actual_columns == LEAD_EVENT_COLUMNS
    assert len(LEAD_EVENT_COLUMNS) == 19
    assert lead_dataset.schema_matches()


def test_the_generator_declares_its_own_namespace() -> None:
    assert LeadGenerator.namespace == LEAD_NAMESPACE
    assert LeadGenerator.declared_columns == LEAD_EVENT_COLUMNS


def test_no_column_outside_the_nullable_list_is_ever_null(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame
    for column in LEAD_EVENT_COLUMNS:
        if column in LEAD_EVENT_NULLABLE_COLUMNS:
            continue
        assert not frame[column].isna().any(), column


def test_lead_count_is_one_on_every_row(lead_dataset: GeneratedDataset) -> None:
    assert set(lead_dataset.frame["lead_count"].tolist()) == {1}


# --------------------------------------------------------------------------------------
# NULL is not zero
# --------------------------------------------------------------------------------------
def test_a_genuine_never_responded_population_exists(lead_dataset: GeneratedDataset) -> None:
    missing = int(lead_dataset.frame["first_response_seconds"].isna().sum())
    assert missing > 0


def test_no_response_time_is_ever_zero(lead_dataset: GeneratedDataset) -> None:
    """Zero would mean an instantaneous answer, which is the opposite of never answering."""
    present = lead_dataset.frame["first_response_seconds"].dropna()
    assert not present.empty
    assert int(present.min()) >= MINIMUM_RESPONSE_SECONDS


def test_never_responded_leads_are_never_contacted(lead_dataset: GeneratedDataset) -> None:
    frame = lead_dataset.frame
    never = frame[frame["first_response_seconds"].isna()]
    assert not never["is_contacted"].astype(bool).any()


def test_every_contacted_lead_carries_a_response_time(lead_dataset: GeneratedDataset) -> None:
    frame = lead_dataset.frame
    contacted = frame[frame["is_contacted"].astype(bool)]
    assert not contacted["first_response_seconds"].isna().any()


def test_days_to_sale_is_null_exactly_when_the_lead_did_not_sell(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame
    sold = frame["is_sold"].astype(bool)
    assert not frame.loc[sold, "days_to_sale"].isna().any()
    assert frame.loc[~sold, "days_to_sale"].isna().all()
    assert int(frame.loc[sold, "days_to_sale"].min()) >= 0


# --------------------------------------------------------------------------------------
# The funnel implication chain
# --------------------------------------------------------------------------------------
def test_an_appointment_is_never_set_without_contact(lead_dataset: GeneratedDataset) -> None:
    frame = lead_dataset.frame
    assert not (
        frame["is_appointment_set"].astype(bool) & ~frame["is_contacted"].astype(bool)
    ).any()


def test_an_appointment_is_never_shown_without_being_set(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame
    assert not (
        frame["is_appointment_shown"].astype(bool) & ~frame["is_appointment_set"].astype(bool)
    ).any()


def test_a_sold_lead_always_names_a_sale(lead_dataset: GeneratedDataset) -> None:
    frame = lead_dataset.frame
    sold = frame["is_sold"].astype(bool)
    assert not frame.loc[sold, "sale_id"].isna().any()
    assert frame.loc[~sold, "sale_id"].isna().all()


def test_every_funnel_stage_is_non_empty(lead_dataset: GeneratedDataset) -> None:
    """A stage nobody reaches cannot exercise the implication it participates in."""
    frame = lead_dataset.frame
    for column in ("is_contacted", "is_appointment_set", "is_appointment_shown", "is_sold"):
        assert int(frame[column].astype(bool).sum()) > 0, column


# --------------------------------------------------------------------------------------
# Duplicates
# --------------------------------------------------------------------------------------
def test_duplicates_exist_and_name_an_earlier_non_duplicate_lead(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame
    duplicate = frame["is_duplicate"].astype(bool)
    assert int(duplicate.sum()) > 0
    assert not frame.loc[duplicate, "original_lead_id"].isna().any()
    assert frame.loc[~duplicate, "original_lead_id"].isna().all()

    non_duplicates = set(frame.loc[~duplicate, "lead_id"])
    for row in frame[duplicate].to_dict(orient="records"):
        original = str(row["original_lead_id"])
        assert original in non_duplicates
        assert original < str(row["lead_id"])


def test_a_duplicate_shares_the_shopper_and_the_store_of_its_original(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame.set_index("lead_id")
    duplicates = frame[frame["is_duplicate"].astype(bool)]
    for lead_id, row in duplicates.iterrows():
        original = frame.loc[str(row["original_lead_id"])]
        assert row["customer_id"] == original["customer_id"], lead_id
        assert row["dealership_id"] == original["dealership_id"], lead_id


def test_no_duplicate_is_ever_credited_with_a_sale(lead_dataset: GeneratedDataset) -> None:
    """A duplicate is excluded from the funnel, so a sale on one would vanish from it."""
    frame = lead_dataset.frame
    assert not frame.loc[frame["is_duplicate"].astype(bool), "is_sold"].astype(bool).any()


def test_the_funnel_population_drops_duplicates_and_nothing_else(
    lead_dataset: GeneratedDataset,
) -> None:
    frame = lead_dataset.frame
    graded = funnel_population(frame)
    assert not graded["is_duplicate"].astype(bool).any()
    assert len(graded) == len(frame) - int(frame["is_duplicate"].astype(bool).sum())


# --------------------------------------------------------------------------------------
# Influences
# --------------------------------------------------------------------------------------
def test_the_response_influence_falls_as_the_response_slows() -> None:
    values = [response_time_influence(seconds) for seconds in (60, 600, 3_600, 86_400, 259_200)]
    assert values == sorted(values, reverse=True)
    assert values[0] > values[-1]


def test_the_response_influence_never_leaves_its_declared_band() -> None:
    low, high = RESPONSE_INFLUENCE_BOUNDS
    for seconds in (0, 1, 60, 3_600, 259_200, 10**7):
        assert low <= response_time_influence(seconds) <= high


def test_the_response_influence_never_reaches_zero() -> None:
    """A slow response reduces the odds of contact; it never makes contact impossible."""
    assert response_time_influence(10**9) > 0.0


def test_a_negative_response_time_is_refused() -> None:
    with pytest.raises(GenerationError, match="non-negative"):
        response_time_influence(-1)


def test_source_propensity_orders_sources_by_their_close_rate() -> None:
    referral = source_propensity(lead_source_behaviour("LDS-016"))
    paid_social = source_propensity(lead_source_behaviour("LDS-009"))
    assert referral > paid_social
    low, high = SOURCE_PROPENSITY_BOUNDS
    for behaviour in lead_source_behaviours():
        assert low <= source_propensity(behaviour) <= high


def test_the_discipline_normaliser_matches_the_employee_generator(
    unit_config: ArpiConfig,
) -> None:
    """The declared mean must track the latent it normalises, or every draw shifts."""
    indices = [
        profile.crm_discipline_index
        for profile in employee_performance_profiles(unit_config).values()
    ]
    measured = sum(indices) / len(indices)
    assert abs(measured - MEAN_CRM_DISCIPLINE_INDEX) < 0.08


def test_an_unowned_lead_gets_the_neutral_discipline_multiplier() -> None:
    assert discipline_multiplier(None) == 1.0


def test_the_discipline_multiplier_stays_inside_its_band(unit_config: ArpiConfig) -> None:
    from arpi.generation.lead import employee_role_intervals

    low, high = DISCIPLINE_BOUNDS
    for interval in employee_role_intervals(unit_config):
        assert low <= discipline_multiplier(interval) <= high


# --------------------------------------------------------------------------------------
# Scale and determinism
# --------------------------------------------------------------------------------------
def test_the_row_count_is_exactly_the_declared_scale(
    unit_config: ArpiConfig, lead_dataset: GeneratedDataset
) -> None:
    assert lead_dataset.row_count == lead_count_for(unit_config)
    assert lead_count_for(unit_config) == TOTAL_LEAD_COUNT_BY_SCALE["test"]


def test_an_undeclared_scale_mode_is_refused(unit_config: ArpiConfig) -> None:
    broken = unit_config.model_copy(
        update={"generation": unit_config.generation.model_copy(update={"scale_mode": "huge"})}
    )
    with pytest.raises(GenerationError, match="No lead count is declared"):
        lead_count_for(broken)


def test_the_same_seed_produces_byte_identical_output(unit_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_lead_dataset(unit_config).frame)
    second = dataframe_to_csv_bytes(generate_lead_dataset(unit_config).frame)
    assert first == second


def test_a_different_seed_produces_different_output(unit_config: ArpiConfig) -> None:
    other = unit_config.model_copy(update={"random_seed": unit_config.random_seed + 1})
    assert dataframe_to_csv_bytes(
        generate_lead_dataset(unit_config).frame
    ) != dataframe_to_csv_bytes(generate_lead_dataset(other).frame)


def test_the_record_view_and_the_frame_agree(
    unit_config: ArpiConfig, lead_dataset: GeneratedDataset
) -> None:
    records = build_lead_records(unit_config)
    assert [record.lead_id for record in records] == lead_dataset.frame["lead_id"].tolist()
    assert all((record.sale_date is None) == (record.sale_id is None) for record in records)


def test_every_check_identifier_is_declared_once() -> None:
    assert len(set(LEAD_CHECK_IDS)) == len(LEAD_CHECK_IDS)
    assert LEAD_CHECK_IDS == tuple(sorted(LEAD_CHECK_IDS))
