"""Data-quality assertions over the generated appointment source entity.

The assertions that carry the most weight:

* **an advance cancellation is a different event from a no-show**, both populations exist,
  and the two flags are mutually exclusive -- so a show rate has to declare which
  denominator it means instead of picking the flattering one;
* ``minutes_early_or_late`` is ``NULL`` when nobody showed, never ``0``;
* one lead genuinely produces several appointments, so the grain difference against
  ``fact_lead`` is exercised rather than asserted;
* sold appointments resolve to finalized **retail** sales -- the only kind a funnel can
  link to, because only a retail sale has a customer at all;
* the same seed produces byte-identical output, and generating appointments moves no other
  entity's digest.

Distributional assertions run at the **development** profile. The ``test`` profile is used
for structure and reproducibility only, and says so.
"""

from __future__ import annotations

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.appointment import (
    APPOINTMENT_CHECK_IDS,
    APPOINTMENT_EVENT_COLUMNS,
    build_appointment_records,
    generate_appointment_dataset,
    validate_appointment_dataset,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import STORE_DEFINITIONS, generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.lead import build_lead_records, generate_lead_dataset
from arpi.generation.lead_source import (
    TOTAL_LEAD_COUNT_BY_SCALE,
    generate_lead_source_dataset,
)
from arpi.generation.sale import sale_links
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered
from arpi.validation.results import CheckResult

pytestmark = pytest.mark.data_quality

#: Spelled out verbatim so a future refactor of the shared privacy module cannot silently
#: narrow what this entity is checked against. Appointment records in a real CRM carry
#: confirmation-call notes and reminder message text, so the communication vocabulary is
#: listed alongside the identifying one.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "customer_name",
    "salesperson_name",
    "email",
    "phone",
    "address",
    "date_of_birth",
    "age",
    "ssn",
    "credit_score",
    "commission",
    "gender",
    "race",
    "marital_status",
    "message",
    "message_body",
    "transcript",
    "recording",
    "note",
    "notes",
    "comment",
    "comments",
    "reminder_text",
    "confirmation_note",
)

#: The `P1.4-03` acceptance band for appointment volume at portfolio scale.
PORTFOLIO_APPOINTMENT_BAND = (10_000, 25_000)

#: Inclusive bands measured at development scale.
APPOINTMENTS_PER_SETTING_LEAD_BOUNDS = (1.10, 1.80)
MULTI_APPOINTMENT_LEAD_SHARE_BOUNDS = (0.12, 0.48)
SHOWN_SHARE_BOUNDS = (0.30, 0.65)
ADVANCE_CANCELLATION_SHARE_BOUNDS = (0.10, 0.40)
NO_SHOW_SHARE_BOUNDS = (0.10, 0.45)
SHOW_RATE_EXCLUDING_CANCELLATIONS_BOUNDS = (0.45, 0.80)
TEST_DRIVE_OF_SHOWN_BOUNDS = (0.45, 0.80)
WRITE_UP_OF_SHOWN_BOUNDS = (0.40, 0.85)


@pytest.fixture(scope="module")
def development_config() -> ArpiConfig:
    """The ``development`` profile, resolved hermetically for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="development", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def quality_config() -> ArpiConfig:
    """The ``test`` profile, resolved hermetically for the whole module."""
    from tests.conftest import REPO_CONFIG_DIR

    return load_config(profile="test", config_dir=REPO_CONFIG_DIR, env={})


@pytest.fixture(scope="module")
def appointment_dataset(quality_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``appointment_event`` dataset at ``test`` scale."""
    return generate_appointment_dataset(quality_config)


@pytest.fixture(scope="module")
def development_appointments(development_config: ArpiConfig) -> pd.DataFrame:
    """The generated ``appointment_event`` frame at development scale."""
    return generate_appointment_dataset(development_config).frame


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(
    appointment_dataset: GeneratedDataset,
) -> None:
    assert appointment_dataset.actual_columns == APPOINTMENT_EVENT_COLUMNS
    assert len(APPOINTMENT_EVENT_COLUMNS) == 20


def test_the_column_set_is_exactly_the_contract(
    appointment_dataset: GeneratedDataset, development_appointments: pd.DataFrame
) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(appointment_dataset.actual_columns) == set(APPOINTMENT_EVENT_COLUMNS)
    assert tuple(str(column) for column in development_appointments.columns) == (
        APPOINTMENT_EVENT_COLUMNS
    )


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_or_content_column_name_exists(
    appointment_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in appointment_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-APT-008")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


def test_the_privacy_tripwire_trips_on_a_confirmation_note(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = appointment_dataset.frame.copy()
    tampered["confirmation_notes"] = ""
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-008"].is_failure


# --------------------------------------------------------------------------------------
# Scale
# --------------------------------------------------------------------------------------
def test_the_volume_scales_with_the_profile(
    appointment_dataset: GeneratedDataset, development_appointments: pd.DataFrame
) -> None:
    ratio = TOTAL_LEAD_COUNT_BY_SCALE["development"] / TOTAL_LEAD_COUNT_BY_SCALE["test"]
    assert len(development_appointments) > appointment_dataset.row_count * ratio * 0.5
    assert len(development_appointments) < appointment_dataset.row_count * ratio * 2.0


def test_the_projected_portfolio_volume_is_inside_the_target_band(
    development_appointments: pd.DataFrame,
) -> None:
    """The `P1.4-03` acceptance band: 10,000 to 25,000 appointments at portfolio scale.

    This is a **projection** from the development profile scaled by the declared lead
    counts, not a measurement: ``PHASE1_CONTRACT.md`` §11 forbids generating portfolio scale
    in CI or routine tests, so no portfolio-scale run is claimed here.
    """
    scale = TOTAL_LEAD_COUNT_BY_SCALE["portfolio"] / TOTAL_LEAD_COUNT_BY_SCALE["development"]
    projected = len(development_appointments) * scale
    lower, upper = PORTFOLIO_APPOINTMENT_BAND
    assert lower <= projected <= upper, projected


def test_every_store_books_appointments(development_appointments: pd.DataFrame) -> None:
    stores = {store.dealership_id for store in STORE_DEFINITIONS}
    assert set(development_appointments["dealership_id"]) == stores


# --------------------------------------------------------------------------------------
# The grain difference against fact_lead
# --------------------------------------------------------------------------------------
def test_one_lead_produces_several_appointments(
    development_appointments: pd.DataFrame,
) -> None:
    counts = development_appointments.groupby("lead_id").size()
    average = float(len(development_appointments)) / float(len(counts))
    low, high = APPOINTMENTS_PER_SETTING_LEAD_BOUNDS
    assert low <= average <= high
    assert int(counts.max()) >= 2

    multi_share = float((counts > 1).mean())
    low, high = MULTI_APPOINTMENT_LEAD_SHARE_BOUNDS
    assert low <= multi_share <= high


def test_the_appointment_population_matches_the_leads_that_set_one(
    development_config: ArpiConfig, development_appointments: pd.DataFrame
) -> None:
    leads = build_lead_records(development_config)
    expected = {record.lead_id for record in leads if record.is_appointment_set}
    assert set(development_appointments["lead_id"]) == expected
    shown_leads = {record.lead_id for record in leads if record.is_appointment_shown}
    observed = set(
        development_appointments.loc[development_appointments["is_shown"].astype(bool), "lead_id"]
    )
    assert observed == shown_leads


# --------------------------------------------------------------------------------------
# Advance cancellation is not a no-show
# --------------------------------------------------------------------------------------
def test_all_three_outcomes_form_a_partition(development_appointments: pd.DataFrame) -> None:
    shown = development_appointments["is_shown"].astype(bool)
    cancelled = development_appointments["is_cancelled_in_advance"].astype(bool)
    no_show = ~shown & ~cancelled
    assert int((shown & cancelled).sum()) == 0
    assert int(shown.sum()) + int(cancelled.sum()) + int(no_show.sum()) == len(
        development_appointments
    )

    total = float(len(development_appointments))
    _assert_inside(int(shown.sum()) / total, SHOWN_SHARE_BOUNDS, "shown share")
    _assert_inside(
        int(cancelled.sum()) / total,
        ADVANCE_CANCELLATION_SHARE_BOUNDS,
        "advance cancellation share",
    )
    _assert_inside(int(no_show.sum()) / total, NO_SHOW_SHARE_BOUNDS, "no-show share")


def test_the_two_show_rate_denominators_genuinely_differ(
    development_appointments: pd.DataFrame,
) -> None:
    """If they agreed, keeping the flags apart would be decorative."""
    shown = int(development_appointments["is_shown"].astype(bool).sum())
    cancelled = int(development_appointments["is_cancelled_in_advance"].astype(bool).sum())
    total = len(development_appointments)
    naive = shown / total
    honest = shown / (total - cancelled)
    assert honest > naive
    _assert_inside(honest, SHOW_RATE_EXCLUDING_CANCELLATIONS_BOUNDS, "show rate")


def test_confirmation_predicts_attendance_without_determining_it(
    development_appointments: pd.DataFrame,
) -> None:
    confirmed = development_appointments[development_appointments["is_confirmed"].astype(bool)]
    unconfirmed = development_appointments[~development_appointments["is_confirmed"].astype(bool)]
    confirmed_rate = float(confirmed["is_shown"].astype(bool).mean())
    unconfirmed_rate = float(unconfirmed["is_shown"].astype(bool).mean())
    assert confirmed_rate > unconfirmed_rate
    assert 0.05 < unconfirmed_rate < confirmed_rate < 0.95


# --------------------------------------------------------------------------------------
# NULL is not zero
# --------------------------------------------------------------------------------------
def test_punctuality_is_null_exactly_when_nobody_showed(
    development_appointments: pd.DataFrame,
) -> None:
    shown = development_appointments["is_shown"].astype(bool)
    assert development_appointments.loc[~shown, "minutes_early_or_late"].isna().all()
    assert not development_appointments.loc[shown, "minutes_early_or_late"].isna().any()


def test_a_punctual_zero_is_still_possible_for_a_shopper_who_did_show(
    development_appointments: pd.DataFrame,
) -> None:
    """Zero is a real value meaning bang on time; it is only absent that must be NULL."""
    minutes = development_appointments["minutes_early_or_late"].dropna()
    assert int((minutes == 0).sum()) > 0
    assert int((minutes < 0).sum()) > 0
    assert int((minutes > 0).sum()) > 0
    assert float(minutes.mean()) > 0.0


# --------------------------------------------------------------------------------------
# Date ordering
# --------------------------------------------------------------------------------------
def test_no_appointment_is_scheduled_or_shown_before_it_was_created(
    development_appointments: pd.DataFrame,
) -> None:
    assert bool(
        (
            development_appointments["scheduled_date"] >= development_appointments["created_date"]
        ).all()
    )
    shown = development_appointments[development_appointments["show_date"].notna()]
    assert bool((shown["show_date"] >= shown["created_date"]).all())


def test_the_booking_lead_time_is_plausible(development_appointments: pd.DataFrame) -> None:
    lead_time = (
        development_appointments["scheduled_date"] - development_appointments["created_date"]
    ).dt.days
    assert int(lead_time.min()) >= 0
    assert int(lead_time.max()) <= 30
    assert float(lead_time.mean()) > 0.0


def test_every_appointment_falls_inside_the_reporting_window(
    development_config: ArpiConfig, development_appointments: pd.DataFrame
) -> None:
    start = pd.Timestamp(development_config.reporting.start_date)
    end = pd.Timestamp(development_config.reporting.end_date)
    for column in ("created_date", "scheduled_date"):
        assert bool((development_appointments[column] >= start).all()), column
        assert bool((development_appointments[column] <= end).all()), column


# --------------------------------------------------------------------------------------
# Outcome implications and sale linkage
# --------------------------------------------------------------------------------------
def test_write_up_and_test_drive_imply_a_show(development_appointments: pd.DataFrame) -> None:
    shown = development_appointments["is_shown"].astype(bool)
    for column in ("is_write_up", "is_test_drive", "is_sold"):
        assert not (development_appointments[column].astype(bool) & ~shown).any(), column


def test_the_shown_outcome_shares_are_plausible(
    development_appointments: pd.DataFrame,
) -> None:
    shown = development_appointments[development_appointments["is_shown"].astype(bool)]
    _assert_inside(
        float(shown["is_test_drive"].astype(bool).mean()),
        TEST_DRIVE_OF_SHOWN_BOUNDS,
        "test-drive share of shown",
    )
    _assert_inside(
        float(shown["is_write_up"].astype(bool).mean()),
        WRITE_UP_OF_SHOWN_BOUNDS,
        "write-up share of shown",
    )
    assert float(shown["is_sold"].astype(bool).mean()) < float(
        shown["is_write_up"].astype(bool).mean()
    )


def test_every_sold_appointment_resolves_to_a_finalized_retail_sale(
    development_config: ArpiConfig, development_appointments: pd.DataFrame
) -> None:
    links = {
        link.sale_id: link
        for link in sale_links(development_config)
        if link.is_retail and link.customer_id is not None
    }
    sold = development_appointments[development_appointments["is_sold"].astype(bool)]
    assert len(sold) > 0
    for record in sold.to_dict(orient="records"):
        link = links[str(record["sale_id"])]
        assert link.dealership_id == record["dealership_id"]
        assert link.sale_date >= pd.Timestamp(record["show_date"]).date()


def test_no_sale_is_credited_to_two_appointments(
    development_appointments: pd.DataFrame,
) -> None:
    sold = development_appointments.loc[development_appointments["is_sold"].astype(bool), "sale_id"]
    assert sold.nunique() == len(sold)


def test_the_lead_and_the_appointment_agree_about_the_sale(
    development_config: ArpiConfig, development_appointments: pd.DataFrame
) -> None:
    leads = {record.lead_id: record for record in build_lead_records(development_config)}
    sold = development_appointments[development_appointments["is_sold"].astype(bool)]
    for record in sold.to_dict(orient="records"):
        lead = leads[str(record["lead_id"])]
        assert lead.is_sold
        assert lead.sale_id == record["sale_id"]


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(quality_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_appointment_dataset(quality_config).frame)
    second = dataframe_to_csv_bytes(generate_appointment_dataset(quality_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_the_digest_is_stable_across_reruns(quality_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_appointment_dataset(quality_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


def test_generating_appointments_does_not_perturb_any_other_entity(
    quality_config: ArpiConfig,
) -> None:
    """One namespace per entity: adding an entity must never move another's digest."""

    def digests() -> dict[str, str]:
        return {
            "dim_date": content_digest(
                dataframe_to_csv_bytes(generate_date_dataset(quality_config).frame)
            ),
            "dim_dealership": content_digest(
                dataframe_to_csv_bytes(generate_dealership_dataset(quality_config).frame)
            ),
            "dim_employee": content_digest(
                dataframe_to_csv_bytes(generate_employee_dataset(quality_config).frame)
            ),
            "dim_customer": content_digest(
                dataframe_to_csv_bytes(generate_customer_dataset(quality_config).frame)
            ),
            "dim_lead_source": content_digest(
                dataframe_to_csv_bytes(generate_lead_source_dataset(quality_config).frame)
            ),
            "lead_event": content_digest(
                dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame)
            ),
        }

    before = digests()
    generate_appointment_dataset(quality_config)
    assert digests() == before


def test_the_record_view_is_stable_across_reruns(quality_config: ArpiConfig) -> None:
    assert build_appointment_records(quality_config) == build_appointment_records(quality_config)


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    report = validate_appointment_dataset(appointment_dataset, quality_config)
    assert not report.failures, [result.message for result in report.failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    emitted = [
        result.check_id
        for result in validate_appointment_dataset(appointment_dataset, quality_config).results
    ]
    assert emitted == list(APPOINTMENT_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    for result in validate_appointment_dataset(appointment_dataset, quality_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id
        assert definition.entity == "appointment_event", result.check_id


def test_the_uniqueness_check_fails_on_a_duplicated_row(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = pd.concat(
        [appointment_dataset.frame, appointment_dataset.frame.head(1)], ignore_index=True
    )
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-001"].is_failure


def test_the_schema_check_fails_on_a_reordered_contract(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    columns = list(APPOINTMENT_EVENT_COLUMNS)
    columns[13], columns[14] = columns[14], columns[13]
    results = _appointment_results(
        appointment_dataset, appointment_dataset.frame[columns], quality_config
    )
    assert results["DQ-APT-002"].is_failure


def test_the_date_check_fails_when_a_slot_precedes_its_booking(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = appointment_dataset.frame.copy()
    index = tampered.index[0]
    tampered.loc[index, "scheduled_date"] = tampered.loc[index, "created_date"] - pd.Timedelta(
        days=1
    )
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-003"].is_failure


def test_the_cancellation_check_fails_when_a_show_is_also_a_cancellation(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    """Conflating the two is the defect this entity exists to prevent."""
    tampered = appointment_dataset.frame.copy()
    index = tampered.index[tampered["is_shown"].astype(bool)][0]
    tampered.loc[index, "is_cancelled_in_advance"] = True
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-004"].is_failure


def test_the_write_up_check_fails_on_a_write_up_without_a_show(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = appointment_dataset.frame.copy()
    index = tampered.index[~tampered["is_shown"].astype(bool)][0]
    tampered.loc[index, "is_write_up"] = True
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-005"].is_failure


def test_the_sale_check_fails_on_an_unknown_sale(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = appointment_dataset.frame.copy()
    index = tampered.index[tampered["is_sold"].astype(bool)][0]
    tampered.loc[index, "sale_id"] = "SLE-99999999"
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-006"].is_failure


def test_the_minutes_check_fails_when_a_no_show_is_written_as_zero(
    appointment_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = appointment_dataset.frame.copy()
    tampered["minutes_early_or_late"] = tampered["minutes_early_or_late"].fillna(0)
    results = _appointment_results(appointment_dataset, tampered, quality_config)
    assert results["DQ-APT-007"].is_failure


def _assert_inside(observed: float, bounds: tuple[float, float], label: str) -> None:
    """Assert a measured rate falls inside an inclusive band."""
    low, high = bounds
    assert low <= observed <= high, f"{label} is {observed:.4f}, outside [{low}, {high}]"


def _appointment_results(
    dataset: GeneratedDataset, frame: pd.DataFrame, config: ArpiConfig
) -> dict[str, CheckResult]:
    """Re-run the appointment suite over a tampered frame, keyed by check id."""
    report = validate_appointment_dataset(
        GeneratedDataset(
            entity_name=dataset.entity_name,
            frame=frame,
            declared_columns=dataset.declared_columns,
            namespace=dataset.namespace,
        ),
        config,
    )
    return {result.check_id: result for result in report.results}
