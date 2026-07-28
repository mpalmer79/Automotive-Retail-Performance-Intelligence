"""Unit tests for the appointment generator.

Two distinctions carry the weight here, and both are the kind that fail quietly:

* **an advance cancellation is not a no-show.** The flags are mutually exclusive, and a
  no-show is neither of them;
* ``minutes_early_or_late`` is ``NULL`` when nobody arrived, **never** ``0``.

Everything statistical lives in ``tests/data_quality/test_appointment_quality.py``.
"""

from __future__ import annotations

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.exceptions import GenerationError
from arpi.generation.appointment import (
    APPOINTMENT_CHECK_IDS,
    APPOINTMENT_EVENT_COLUMNS,
    APPOINTMENT_EVENT_NULLABLE_COLUMNS,
    APPOINTMENT_ID_DIGITS,
    APPOINTMENT_ID_PREFIX,
    APPOINTMENT_NAMESPACE,
    MINUTES_EARLY_OR_LATE_BOUNDS,
    AppointmentGenerator,
    appointment_id_for,
    build_appointment_records,
    generate_appointment_dataset,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.lead import build_lead_records
from arpi.generation.writer import dataframe_to_csv_bytes


@pytest.fixture(scope="module")
def unit_config() -> ArpiConfig:
    """The ``test`` profile, resolved hermetically once for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="test", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def appointment_dataset(unit_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``appointment_event`` dataset for the ``test`` profile."""
    return generate_appointment_dataset(unit_config)


# --------------------------------------------------------------------------------------
# Identifiers and contract
# --------------------------------------------------------------------------------------
def test_the_identifier_scheme_is_the_reserved_one() -> None:
    assert appointment_id_for(1) == "APT-00000001"
    assert appointment_id_for(11882) == "APT-00011882"


@pytest.mark.parametrize("ordinal", [0, -3])
def test_a_non_positive_ordinal_is_refused(ordinal: int) -> None:
    with pytest.raises(GenerationError, match="ordinals start at 1"):
        appointment_id_for(ordinal)


def test_an_ordinal_too_wide_for_the_scheme_is_refused() -> None:
    with pytest.raises(GenerationError, match="does not fit the reserved"):
        appointment_id_for(10**APPOINTMENT_ID_DIGITS)


def test_every_generated_identifier_matches_the_scheme(
    appointment_dataset: GeneratedDataset,
) -> None:
    identifiers = appointment_dataset.frame["appointment_id"].tolist()
    assert all(value.startswith(APPOINTMENT_ID_PREFIX) for value in identifiers)
    assert all(
        len(value) == len(APPOINTMENT_ID_PREFIX) + APPOINTMENT_ID_DIGITS for value in identifiers
    )
    assert len(set(identifiers)) == len(identifiers)


def test_the_declared_contract_is_twenty_columns_in_order(
    appointment_dataset: GeneratedDataset,
) -> None:
    assert appointment_dataset.actual_columns == APPOINTMENT_EVENT_COLUMNS
    assert len(APPOINTMENT_EVENT_COLUMNS) == 20
    assert appointment_dataset.schema_matches()


def test_the_generator_declares_its_own_namespace() -> None:
    assert AppointmentGenerator.namespace == APPOINTMENT_NAMESPACE
    assert AppointmentGenerator.declared_columns == APPOINTMENT_EVENT_COLUMNS


def test_no_column_outside_the_nullable_list_is_ever_null(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    for column in APPOINTMENT_EVENT_COLUMNS:
        if column in APPOINTMENT_EVENT_NULLABLE_COLUMNS:
            continue
        assert not frame[column].isna().any(), column


def test_appointment_count_is_one_on_every_row(appointment_dataset: GeneratedDataset) -> None:
    assert set(appointment_dataset.frame["appointment_count"].tolist()) == {1}


# --------------------------------------------------------------------------------------
# Date ordering
# --------------------------------------------------------------------------------------
def test_no_appointment_is_scheduled_before_it_was_created(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    assert bool((frame["scheduled_date"] >= frame["created_date"]).all())


def test_no_show_date_precedes_creation(appointment_dataset: GeneratedDataset) -> None:
    frame = appointment_dataset.frame
    shown = frame[frame["show_date"].notna()]
    assert bool((shown["show_date"] >= shown["created_date"]).all())


def test_a_show_date_exists_exactly_when_the_shopper_showed(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    shown = frame["is_shown"].astype(bool)
    assert not frame.loc[shown, "show_date"].isna().any()
    assert frame.loc[~shown, "show_date"].isna().all()


def test_appointments_are_created_on_or_after_their_lead_arrived(
    unit_config: ArpiConfig,
) -> None:
    arrivals = {
        record.lead_id: record.lead_created_date for record in build_lead_records(unit_config)
    }
    for record in build_appointment_records(unit_config):
        assert record.created_date >= arrivals[record.lead_id], record.appointment_id


def test_no_appointment_falls_outside_the_reporting_window(
    unit_config: ArpiConfig, appointment_dataset: GeneratedDataset
) -> None:
    frame = appointment_dataset.frame
    start = pd.Timestamp(unit_config.reporting.start_date)
    end = pd.Timestamp(unit_config.reporting.end_date)
    assert bool((frame["created_date"] >= start).all())
    assert bool((frame["scheduled_date"] <= end).all())


# --------------------------------------------------------------------------------------
# An advance cancellation is not a no-show
# --------------------------------------------------------------------------------------
def test_shown_and_cancelled_in_advance_are_mutually_exclusive(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    assert not (
        frame["is_shown"].astype(bool) & frame["is_cancelled_in_advance"].astype(bool)
    ).any()


def test_all_three_outcomes_are_present_and_distinguishable(
    appointment_dataset: GeneratedDataset,
) -> None:
    """Shown, cancelled in advance, and a no-show that is neither."""
    frame = appointment_dataset.frame
    shown = frame["is_shown"].astype(bool)
    cancelled = frame["is_cancelled_in_advance"].astype(bool)
    no_show = ~shown & ~cancelled
    assert int(shown.sum()) > 0
    assert int(cancelled.sum()) > 0
    assert int(no_show.sum()) > 0
    assert int(shown.sum()) + int(cancelled.sum()) + int(no_show.sum()) == len(frame)


# --------------------------------------------------------------------------------------
# NULL is not zero
# --------------------------------------------------------------------------------------
def test_punctuality_is_null_exactly_when_nobody_showed(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    shown = frame["is_shown"].astype(bool)
    assert frame.loc[~shown, "minutes_early_or_late"].isna().all()
    assert not frame.loc[shown, "minutes_early_or_late"].isna().any()


def test_punctuality_reaches_both_signs_and_stays_in_band(
    appointment_dataset: GeneratedDataset,
) -> None:
    minutes = appointment_dataset.frame["minutes_early_or_late"].dropna()
    low, high = MINUTES_EARLY_OR_LATE_BOUNDS
    assert int(minutes.min()) >= low
    assert int(minutes.max()) <= high
    assert int((minutes < 0).sum()) > 0
    assert int((minutes > 0).sum()) > 0


# --------------------------------------------------------------------------------------
# Write-up and sale implications
# --------------------------------------------------------------------------------------
def test_a_write_up_implies_a_show(appointment_dataset: GeneratedDataset) -> None:
    frame = appointment_dataset.frame
    assert not (frame["is_write_up"].astype(bool) & ~frame["is_shown"].astype(bool)).any()


def test_a_sale_implies_a_show_a_write_up_and_a_sale_reference(
    appointment_dataset: GeneratedDataset,
) -> None:
    frame = appointment_dataset.frame
    sold = frame["is_sold"].astype(bool)
    assert int(sold.sum()) > 0
    assert frame.loc[sold, "is_shown"].astype(bool).all()
    assert frame.loc[sold, "is_write_up"].astype(bool).all()
    assert not frame.loc[sold, "sale_id"].isna().any()
    assert frame.loc[~sold, "sale_id"].isna().all()


def test_a_test_drive_implies_a_show(appointment_dataset: GeneratedDataset) -> None:
    frame = appointment_dataset.frame
    assert not (frame["is_test_drive"].astype(bool) & ~frame["is_shown"].astype(bool)).any()


# --------------------------------------------------------------------------------------
# The grain difference against fact_lead
# --------------------------------------------------------------------------------------
def test_one_lead_can_produce_several_appointments(
    appointment_dataset: GeneratedDataset,
) -> None:
    counts = appointment_dataset.frame.groupby("lead_id").size()
    assert int(counts.max()) > 1
    assert len(counts) < appointment_dataset.row_count


def test_a_lead_shows_for_at_most_one_of_its_appointments(
    appointment_dataset: GeneratedDataset,
) -> None:
    shown = appointment_dataset.frame.groupby("lead_id")["is_shown"].sum()
    assert int(shown.max()) <= 1


def test_appointments_exist_for_exactly_the_leads_that_set_one(
    unit_config: ArpiConfig, appointment_dataset: GeneratedDataset
) -> None:
    leads = build_lead_records(unit_config)
    expected = {record.lead_id for record in leads if record.is_appointment_set}
    assert set(appointment_dataset.frame["lead_id"]) == expected


def test_a_lead_that_showed_has_exactly_one_shown_appointment(unit_config: ArpiConfig) -> None:
    """The two facts must not disagree about whether the shopper ever arrived."""
    shown_leads = {
        record.lead_id for record in build_lead_records(unit_config) if record.is_appointment_shown
    }
    appointments = build_appointment_records(unit_config)
    observed = {record.lead_id for record in appointments if record.is_shown}
    assert observed == shown_leads


# --------------------------------------------------------------------------------------
# Determinism
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(unit_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_appointment_dataset(unit_config).frame)
    second = dataframe_to_csv_bytes(generate_appointment_dataset(unit_config).frame)
    assert first == second


def test_a_different_seed_produces_different_output(unit_config: ArpiConfig) -> None:
    other = unit_config.model_copy(update={"random_seed": unit_config.random_seed + 1})
    assert dataframe_to_csv_bytes(
        generate_appointment_dataset(unit_config).frame
    ) != dataframe_to_csv_bytes(generate_appointment_dataset(other).frame)


def test_every_check_identifier_is_declared_once() -> None:
    assert len(set(APPOINTMENT_CHECK_IDS)) == len(APPOINTMENT_CHECK_IDS)
    assert APPOINTMENT_CHECK_IDS == tuple(sorted(APPOINTMENT_CHECK_IDS))
