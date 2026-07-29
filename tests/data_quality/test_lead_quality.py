"""Data-quality assertions over the generated CRM lead source entity.

The assertions that carry the most weight:

* a **never-responded population exists**, and its ``first_response_seconds`` is ``NULL``
  rather than ``0`` -- the single most common way response-time reporting goes wrong;
* the response-time distribution is **right-skewed**, so the median sits materially below
  the mean;
* response time **influences** contact without determining it, and contact influences the
  appointment, and a shown appointment converts better -- each a direction with residual
  variance, never a rule;
* a **duplicate population** exists, carries a resolvable original, and is excluded from
  every funnel numerator and denominator;
* **no communication-content column exists anywhere in the schema**;
* the same seed produces byte-identical output, and generating leads moves no other
  entity's digest.

Distributional assertions run at the **development** profile (6,000 leads over six months).
The ``test`` profile's 200 leads are enough for structure, identifiers and reproducibility
but not for a claim about a conditional rate, and where this module uses it, it says so.
Every band is a direction plus a range against a seed the profile pins, so nothing here can
fail randomly.
"""

from __future__ import annotations

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.appointment import generate_appointment_dataset
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import STORE_DEFINITIONS, generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.lead import (
    LEAD_CHECK_IDS,
    LEAD_EVENT_COLUMNS,
    NEVER_RESPONDED_SHARE_BOUNDS,
    SKEW_RATIO_BOUNDS,
    build_lead_records,
    funnel_population,
    generate_lead_dataset,
    lead_count_for,
    validate_lead_dataset,
)
from arpi.generation.lead_source import (
    ALL_LEAD_SOURCE_IDS,
    TOTAL_LEAD_COUNT_BY_SCALE,
    generate_lead_source_dataset,
)
from arpi.generation.marketing import campaign_records, generate_marketing_campaign_dataset
from arpi.generation.sale import sale_links
from arpi.generation.vehicle_model import catalogued_models_for
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered
from arpi.validation.results import CheckResult

pytestmark = pytest.mark.data_quality

#: Spelled out verbatim rather than imported, so a future refactor of the shared privacy
#: module cannot silently narrow what this entity is checked against. A CRM lead record is
#: the richest source of free-text personal data in a dealership, so the communication
#: vocabulary is listed in full alongside the identifying one.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "first_name",
    "last_name",
    "full_name",
    "customer_name",
    "salesperson_name",
    "email",
    "email_address",
    "phone",
    "phone_number",
    "mobile",
    "address",
    "street_address",
    "postal_code",
    "date_of_birth",
    "age",
    "ssn",
    "drivers_license",
    "bank_account",
    "credit_card",
    "credit_score",
    "commission",
    "pay_plan",
    "race",
    "ethnicity",
    "gender",
    "religion",
    "marital_status",
)

#: The communication-content vocabulary specifically. **None of this may exist**, and the
#: check inspects the schema rather than the values, so an empty column still fails.
PROHIBITED_CONTENT_COLUMN_NAMES = (
    "message",
    "message_body",
    "body",
    "subject",
    "transcript",
    "recording",
    "call_recording",
    "recording_url",
    "note",
    "notes",
    "comment",
    "comments",
    "chat_log",
    "conversation",
    "voicemail",
    "sms_text",
)

#: The `P1.4-02` acceptance band for lead volume at portfolio scale.
PORTFOLIO_LEAD_BAND = (40_000, 80_000)

#: Inclusive bands for the funnel, measured at development scale. Wide enough that a
#: modelling tweak does not break them, narrow enough that "everything converts" or
#: "nothing converts" does.
DUPLICATE_SHARE_BOUNDS = (0.02, 0.20)
CONTACT_RATE_BOUNDS = (0.45, 0.90)
APPOINTMENT_SET_OF_CONTACTED_BOUNDS = (0.20, 0.60)
SHOWN_OF_SET_BOUNDS = (0.35, 0.85)
LEAD_TO_SALE_BOUNDS = (0.02, 0.18)


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
def lead_dataset(quality_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``lead_event`` dataset at ``test`` scale."""
    return generate_lead_dataset(quality_config)


@pytest.fixture(scope="module")
def development_leads(development_config: ArpiConfig) -> pd.DataFrame:
    """The generated ``lead_event`` frame at development scale."""
    return generate_lead_dataset(development_config).frame


@pytest.fixture(scope="module")
def graded_leads(development_leads: pd.DataFrame) -> pd.DataFrame:
    """The development leads that belong in a funnel numerator or denominator."""
    return funnel_population(development_leads)


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(lead_dataset: GeneratedDataset) -> None:
    assert lead_dataset.actual_columns == LEAD_EVENT_COLUMNS
    assert len(LEAD_EVENT_COLUMNS) == 19


def test_the_column_set_is_exactly_the_contract(lead_dataset: GeneratedDataset) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(lead_dataset.actual_columns) == set(LEAD_EVENT_COLUMNS)


def test_the_column_order_is_stable_across_profiles(
    lead_dataset: GeneratedDataset, development_leads: pd.DataFrame
) -> None:
    assert tuple(str(column) for column in development_leads.columns) == LEAD_EVENT_COLUMNS
    assert lead_dataset.actual_columns == LEAD_EVENT_COLUMNS


# --------------------------------------------------------------------------------------
# Privacy: no personal data, and no communication content of any kind
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_personal_column_name_exists(
    lead_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in lead_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


@pytest.mark.parametrize("prohibited", PROHIBITED_CONTENT_COLUMN_NAMES)
def test_no_communication_content_column_exists(
    lead_dataset: GeneratedDataset, prohibited: str
) -> None:
    """No message body, transcript, recording, note or comment -- at any layer, ever."""
    columns = {str(column).lower() for column in lead_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_no_column_holds_free_text_at_all(lead_dataset: GeneratedDataset) -> None:
    """Every text column is an identifier or a governed constant, so nothing is prose."""
    frame = lead_dataset.frame
    identifier_columns = {
        "lead_id",
        "dealership_id",
        "customer_id",
        "vehicle_model_id",
        "lead_source_id",
        "campaign_id",
        "assigned_employee_id",
        "sale_id",
        "original_lead_id",
        "source_system",
    }
    for column in frame.columns:
        if str(frame[column].dtype) != "string":
            continue
        assert str(column) in identifier_columns, column
        values = frame[column].dropna()
        assert all(" " not in str(value) for value in values), column


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-LED-007")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


def test_the_privacy_tripwire_trips_on_a_message_body(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    tampered["message_body"] = ""
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-007"].is_failure


def test_the_privacy_tripwire_trips_on_a_transcript(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    tampered["call_transcript"] = ""
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-007"].is_failure


# --------------------------------------------------------------------------------------
# Scale
# --------------------------------------------------------------------------------------
def test_the_row_count_matches_the_declared_scale(
    quality_config: ArpiConfig,
    development_config: ArpiConfig,
    lead_dataset: GeneratedDataset,
    development_leads: pd.DataFrame,
) -> None:
    assert lead_dataset.row_count == lead_count_for(quality_config) == 200
    assert len(development_leads) == lead_count_for(development_config) == 6_000


def test_the_portfolio_lead_volume_is_inside_the_target_band() -> None:
    """The `P1.4-02` acceptance band: 40,000 to 80,000 leads at portfolio scale.

    Read from the declared scale constant rather than generated: ``PHASE1_CONTRACT.md`` §11
    forbids running a portfolio-scale generation in CI or routine tests.
    """
    lower, upper = PORTFOLIO_LEAD_BAND
    assert lower <= TOTAL_LEAD_COUNT_BY_SCALE["portfolio"] <= upper


def test_every_store_and_every_source_receives_leads(development_leads: pd.DataFrame) -> None:
    stores = {store.dealership_id for store in STORE_DEFINITIONS}
    assert set(development_leads["dealership_id"]) == stores
    assert set(development_leads["lead_source_id"]) == set(ALL_LEAD_SOURCE_IDS)


# --------------------------------------------------------------------------------------
# Arrival shape
# --------------------------------------------------------------------------------------
def test_leads_arrive_across_the_whole_reporting_window(
    development_config: ArpiConfig, development_leads: pd.DataFrame
) -> None:
    dates = development_leads["lead_created_date"].dt.date
    assert dates.min() >= development_config.reporting.start_date
    assert dates.max() <= development_config.reporting.end_date
    span = (development_config.reporting.end_date - development_config.reporting.start_date).days
    assert dates.nunique() > span * 0.95


def test_arrival_carries_a_day_of_week_shape(development_leads: pd.DataFrame) -> None:
    """Weekdays out-produce Sunday, but Sunday is far from empty: the website never shuts."""
    by_weekday = development_leads.groupby(development_leads["lead_created_date"].dt.weekday).size()
    assert by_weekday.loc[0] > by_weekday.loc[6]
    assert by_weekday.loc[6] > 0
    assert by_weekday.max() / by_weekday.min() < 3.0


def test_arrival_carries_a_month_shape(development_leads: pd.DataFrame) -> None:
    by_month = development_leads.groupby(development_leads["lead_created_date"].dt.month).size()
    assert by_month.nunique() > 1
    assert by_month.max() > by_month.min()


# --------------------------------------------------------------------------------------
# Response time: NULL is not zero, and the distribution is right-skewed
# --------------------------------------------------------------------------------------
def test_the_never_responded_share_is_inside_its_band(development_leads: pd.DataFrame) -> None:
    share = float(development_leads["first_response_seconds"].isna().mean())
    low, high = NEVER_RESPONDED_SHARE_BOUNDS
    assert low <= share <= high


def test_never_responded_leads_carry_null_and_never_zero(
    development_leads: pd.DataFrame,
) -> None:
    responses = development_leads["first_response_seconds"]
    assert int(responses.isna().sum()) > 0
    assert int((responses.dropna() <= 0).sum()) == 0


def test_the_response_time_distribution_is_right_skewed(
    development_leads: pd.DataFrame,
) -> None:
    """Direction and band, never a point value."""
    responses = development_leads["first_response_seconds"].dropna().astype("float64")
    median = float(responses.median())
    mean = float(responses.mean())
    low, high = SKEW_RATIO_BOUNDS
    assert median > 0
    assert mean > median
    assert low <= mean / median <= high


def test_the_skew_is_produced_by_a_long_tail_not_by_outliers_alone(
    development_leads: pd.DataFrame,
) -> None:
    responses = development_leads["first_response_seconds"].dropna().astype("float64")
    assert float(responses.quantile(0.90)) > 4 * float(responses.quantile(0.50))
    assert float(responses.quantile(0.25)) < float(responses.median())


def test_response_time_is_slower_on_a_sunday(development_leads: pd.DataFrame) -> None:
    """The showroom is shut but the website is not, so the Sunday enquiry waits."""
    responded = development_leads[development_leads["first_response_seconds"].notna()]
    weekday = responded["lead_created_date"].dt.weekday
    sunday = responded.loc[weekday == 6, "first_response_seconds"].median()
    midweek = responded.loc[weekday.isin([1, 2]), "first_response_seconds"].median()
    assert float(sunday) > float(midweek)


# --------------------------------------------------------------------------------------
# Influence, not determination
# --------------------------------------------------------------------------------------
def test_a_faster_response_raises_the_contact_rate_without_determining_it(
    development_leads: pd.DataFrame,
) -> None:
    responded = development_leads[development_leads["first_response_seconds"].notna()]
    quartiles = pd.qcut(responded["first_response_seconds"].astype("float64"), 4, labels=False)
    fastest = responded.loc[quartiles == 0, "is_contacted"].astype(bool)
    slowest = responded.loc[quartiles == 3, "is_contacted"].astype(bool)
    assert float(fastest.mean()) > float(slowest.mean())
    # Residual variance retained: neither quartile is all-or-nothing, so response time
    # influences contact rather than deciding it.
    for group in (fastest, slowest):
        assert 0.05 < float(group.mean()) < 0.99


def test_contact_influences_the_appointment_without_determining_it(
    graded_leads: pd.DataFrame,
) -> None:
    contacted = graded_leads[graded_leads["is_contacted"].astype(bool)]
    uncontacted = graded_leads[~graded_leads["is_contacted"].astype(bool)]
    assert float(contacted["is_appointment_set"].astype(bool).mean()) > 0.0
    assert float(uncontacted["is_appointment_set"].astype(bool).mean()) == 0.0
    assert 0.05 < float(contacted["is_appointment_set"].astype(bool).mean()) < 0.95


def test_a_shown_appointment_converts_better_than_one_that_was_only_set(
    graded_leads: pd.DataFrame,
) -> None:
    shown = graded_leads[graded_leads["is_appointment_shown"].astype(bool)]
    set_only = graded_leads[
        graded_leads["is_appointment_set"].astype(bool)
        & ~graded_leads["is_appointment_shown"].astype(bool)
    ]
    no_appointment = graded_leads[~graded_leads["is_appointment_set"].astype(bool)]
    shown_rate = float(shown["is_sold"].astype(bool).mean())
    set_rate = float(set_only["is_sold"].astype(bool).mean())
    none_rate = float(no_appointment["is_sold"].astype(bool).mean())
    assert shown_rate > set_rate > none_rate
    # Still probabilistic at both ends: showing does not guarantee a sale, and a lead that
    # never booked can still buy.
    assert shown_rate < 0.95
    assert none_rate > 0.0


def test_sources_differ_in_contact_and_conversion(graded_leads: pd.DataFrame) -> None:
    by_source = graded_leads.groupby("lead_source_id")[["is_contacted", "is_sold"]].mean()
    assert float(by_source["is_contacted"].max() - by_source["is_contacted"].min()) > 0.15
    assert float(by_source["is_sold"].max() - by_source["is_sold"].min()) > 0.05


def test_the_walk_in_source_outperforms_paid_social(graded_leads: pd.DataFrame) -> None:
    """The declared latents say so, so the generated funnel must say so too."""
    by_source = graded_leads.groupby("lead_source_id")["is_contacted"].mean()
    assert float(by_source.loc["LDS-015"]) > float(by_source.loc["LDS-009"])


# --------------------------------------------------------------------------------------
# The funnel, and the duplicate-exclusion rule
# --------------------------------------------------------------------------------------
def test_the_duplicate_share_is_inside_its_band(
    development_leads: pd.DataFrame, lead_dataset: GeneratedDataset
) -> None:
    low, high = DUPLICATE_SHARE_BOUNDS
    for frame in (development_leads, lead_dataset.frame):
        share = float(frame["is_duplicate"].astype(bool).mean())
        assert low <= share <= high


def test_duplicates_are_excluded_from_the_funnel_population(
    development_leads: pd.DataFrame, graded_leads: pd.DataFrame
) -> None:
    duplicates = int(development_leads["is_duplicate"].astype(bool).sum())
    assert duplicates > 0
    assert len(graded_leads) == len(development_leads) - duplicates
    assert not graded_leads["is_duplicate"].astype(bool).any()


def test_excluding_duplicates_raises_every_conversion_rate(
    development_leads: pd.DataFrame, graded_leads: pd.DataFrame
) -> None:
    """The point of the exclusion: leaving duplicates in understates every rate."""
    for column in ("is_contacted", "is_appointment_set", "is_sold"):
        inflated = float(development_leads[column].astype(bool).mean())
        honest = float(graded_leads[column].astype(bool).mean())
        assert honest > inflated, column


def test_the_funnel_rates_are_inside_their_bands(graded_leads: pd.DataFrame) -> None:
    contacted = graded_leads["is_contacted"].astype(bool)
    appointment_set = graded_leads["is_appointment_set"].astype(bool)
    shown = graded_leads["is_appointment_shown"].astype(bool)
    sold = graded_leads["is_sold"].astype(bool)

    _assert_inside(float(contacted.mean()), CONTACT_RATE_BOUNDS, "contact rate")
    _assert_inside(
        float(appointment_set.sum()) / float(contacted.sum()),
        APPOINTMENT_SET_OF_CONTACTED_BOUNDS,
        "appointment set rate",
    )
    _assert_inside(
        float(shown.sum()) / float(appointment_set.sum()), SHOWN_OF_SET_BOUNDS, "show rate"
    )
    _assert_inside(float(sold.mean()), LEAD_TO_SALE_BOUNDS, "lead-to-sale conversion")


def test_the_funnel_stages_nest(graded_leads: pd.DataFrame) -> None:
    contacted = int(graded_leads["is_contacted"].astype(bool).sum())
    appointment_set = int(graded_leads["is_appointment_set"].astype(bool).sum())
    shown = int(graded_leads["is_appointment_shown"].astype(bool).sum())
    assert len(graded_leads) > contacted > appointment_set > shown > 0


# --------------------------------------------------------------------------------------
# Referential integrity of the populated references
# --------------------------------------------------------------------------------------
def test_every_sold_lead_resolves_to_a_finalized_retail_sale(
    development_config: ArpiConfig, development_leads: pd.DataFrame
) -> None:
    links = {
        link.sale_id: link
        for link in sale_links(development_config)
        if link.is_retail and link.customer_id is not None
    }
    sold = development_leads[development_leads["is_sold"].astype(bool)]
    assert len(sold) > 0
    assert len(sold) <= len(links)
    for record in sold.to_dict(orient="records"):
        link = links[str(record["sale_id"])]
        assert link.dealership_id == record["dealership_id"]
        assert link.customer_id == record["customer_id"]
        assert link.sale_date >= pd.Timestamp(record["lead_created_date"]).date()


def test_no_sale_is_credited_to_two_leads(development_leads: pd.DataFrame) -> None:
    sold = development_leads.loc[development_leads["is_sold"].astype(bool), "sale_id"]
    assert sold.nunique() == len(sold)


def test_every_populated_reference_resolves(
    development_config: ArpiConfig, development_leads: pd.DataFrame
) -> None:
    known_customers = {record.customer_id for record in _customer_ids(development_config)}
    known_models = {model.vehicle_model_id for model in catalogued_models_for(development_config)}
    known_campaigns = {record.campaign_id for record in campaign_records(development_config)}
    assert set(development_leads["customer_id"].dropna()) <= known_customers
    assert set(development_leads["vehicle_model_id"].dropna()) <= known_models
    assert set(development_leads["campaign_id"].dropna()) <= known_campaigns


def test_a_campaign_is_only_attached_when_it_was_running(
    development_config: ArpiConfig, development_leads: pd.DataFrame
) -> None:
    campaigns = {record.campaign_id: record for record in campaign_records(development_config)}
    attributed = development_leads[development_leads["campaign_id"].notna()]
    assert len(attributed) > 0
    for record in attributed.to_dict(orient="records"):
        campaign = campaigns[str(record["campaign_id"])]
        arrival = pd.Timestamp(record["lead_created_date"]).date()
        assert campaign.is_active_on(arrival)
        assert campaign.lead_source_id == record["lead_source_id"]
        assert record["dealership_id"] in campaign.dealership_ids


def test_an_anonymous_lead_population_exists(development_leads: pd.DataFrame) -> None:
    """An enquiry that never identifies the shopper carries NULL, not an invented customer."""
    anonymous = float(development_leads["customer_id"].isna().mean())
    assert 0.01 < anonymous < 0.30


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(quality_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame)
    second = dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_the_digest_is_stable_across_reruns(quality_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


def test_generating_leads_does_not_perturb_any_other_entity(
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
            "dim_marketing_campaign": content_digest(
                dataframe_to_csv_bytes(generate_marketing_campaign_dataset(quality_config).frame)
            ),
        }

    before = digests()
    generate_lead_dataset(quality_config)
    assert digests() == before


def test_generating_appointments_does_not_move_the_lead_digest(
    quality_config: ArpiConfig,
) -> None:
    before = content_digest(dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame))
    generate_appointment_dataset(quality_config)
    after = content_digest(dataframe_to_csv_bytes(generate_lead_dataset(quality_config).frame))
    assert after == before


def test_the_record_view_is_stable_across_reruns(quality_config: ArpiConfig) -> None:
    first = build_lead_records(quality_config)
    second = build_lead_records(quality_config)
    assert first == second


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    report = validate_lead_dataset(lead_dataset, quality_config)
    assert not report.failures, [result.message for result in report.failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    emitted = [
        result.check_id for result in validate_lead_dataset(lead_dataset, quality_config).results
    ]
    assert emitted == list(LEAD_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    for result in validate_lead_dataset(lead_dataset, quality_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id
        assert definition.entity == "lead_event", result.check_id


def test_the_uniqueness_check_fails_on_a_duplicated_row(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = pd.concat([lead_dataset.frame, lead_dataset.frame.head(1)], ignore_index=True)
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-001"].is_failure


def test_the_schema_check_fails_on_a_reordered_contract(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    columns = list(LEAD_EVENT_COLUMNS)
    columns[1], columns[2] = columns[2], columns[1]
    results = _lead_results(lead_dataset, lead_dataset.frame[columns], quality_config)
    assert results["DQ-LED-002"].is_failure


def test_the_funnel_check_fails_when_a_stage_does_not_nest(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    tampered.loc[tampered.index[0], "is_appointment_set"] = True
    tampered.loc[tampered.index[0], "is_contacted"] = False
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-003"].is_failure


def test_the_null_check_fails_when_a_never_responded_lead_is_written_as_zero(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    """The defect this entity exists to prevent, injected deliberately."""
    tampered = lead_dataset.frame.copy()
    tampered["first_response_seconds"] = tampered["first_response_seconds"].fillna(0)
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-004"].is_failure


def test_the_null_check_fails_when_no_never_responded_population_exists(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    tampered["first_response_seconds"] = tampered["first_response_seconds"].fillna(600)
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-004"].is_failure


def test_the_sale_check_fails_on_an_unknown_sale(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    index = tampered.index[tampered["is_sold"].astype(bool)][0]
    tampered.loc[index, "sale_id"] = "SLE-99999999"
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-005"].is_failure


def test_the_duplicate_check_fails_on_a_missing_original(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    index = tampered.index[tampered["is_duplicate"].astype(bool)][0]
    tampered.loc[index, "original_lead_id"] = None
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-006"].is_failure


def test_the_duplicate_check_fails_on_an_unresolvable_original(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    index = tampered.index[tampered["is_duplicate"].astype(bool)][0]
    tampered.loc[index, "original_lead_id"] = "LED-999999999"
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-006"].is_failure


def test_the_skew_check_fails_on_a_flat_distribution(
    lead_dataset: GeneratedDataset, quality_config: ArpiConfig
) -> None:
    tampered = lead_dataset.frame.copy()
    responded = tampered["first_response_seconds"].notna()
    tampered.loc[responded, "first_response_seconds"] = 900
    results = _lead_results(lead_dataset, tampered, quality_config)
    assert results["DQ-LED-008"].is_failure


def _assert_inside(observed: float, bounds: tuple[float, float], label: str) -> None:
    """Assert a measured rate falls inside an inclusive band."""
    low, high = bounds
    assert low <= observed <= high, f"{label} is {observed:.4f}, outside [{low}, {high}]"


def _customer_ids(config: ArpiConfig) -> tuple:  # type: ignore[type-arg]
    """The governed customer population, as selection records."""
    from arpi.generation.customer import customer_selection_pool

    return customer_selection_pool(config)


def _lead_results(
    dataset: GeneratedDataset, frame: pd.DataFrame, config: ArpiConfig
) -> dict[str, CheckResult]:
    """Re-run the lead suite over a tampered frame, keyed by check id."""
    report = validate_lead_dataset(
        GeneratedDataset(
            entity_name=dataset.entity_name,
            frame=frame,
            declared_columns=dataset.declared_columns,
            namespace=dataset.namespace,
        ),
        config,
    )
    return {result.check_id: result for result in report.results}
