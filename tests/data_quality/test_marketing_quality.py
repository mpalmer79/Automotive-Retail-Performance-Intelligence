"""Data-quality assertions over the campaign dimension and the marketing-spend fact source.

The assertions that carry the most weight:

* ``month_date_key`` is the **first** day of its month on every row, at every scale;
* the grain ``(month_date_key, dealership_id, campaign_id)`` is unique;
* ``spend_amount`` is an exact cent-quantized :class:`~decimal.Decimal`, never negative;
* the vendor's reported lead count **systematically exceeds** the true underlying count,
  which is the intended analytical finding rather than a defect;
* the same seed produces byte-identical output, and neither entity moves another entity's
  digest.

Every statistical assertion runs against a fixed seed with a direction-and-band check, so
none of them can fail randomly.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import STORE_DEFINITIONS, generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.lead_source import (
    ALL_LEAD_SOURCE_IDS,
    generate_lead_source_dataset,
)
from arpi.generation.marketing import (
    ALLOWED_CHANNELS,
    ALLOWED_TARGET_DEPARTMENTS,
    ALLOWED_TARGET_VEHICLE_CATEGORIES,
    CAMPAIGN_CHECK_IDS,
    DIM_MARKETING_CAMPAIGN_COLUMNS,
    MARKETING_SPEND_CHECK_IDS,
    MARKETING_SPEND_COLUMNS,
    MARKETING_SPEND_GRAIN_COLUMNS,
    VENDOR_NAMES_BY_CHANNEL,
    campaign_month_demand,
    campaign_records,
    generate_marketing_campaign_dataset,
    generate_marketing_spend_dataset,
    validate_marketing_campaign_dataset,
    validate_marketing_spend_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered
from arpi.validation.results import CheckResult

pytestmark = pytest.mark.data_quality

#: Spelled out verbatim so a future refactor of the shared privacy module cannot silently
#: narrow what these entities are checked against. Marketing data is where audience and
#: targeting attributes creep in, so the protected characteristics are listed explicitly.
PROHIBITED_COLUMN_NAMES = (
    "first_name",
    "last_name",
    "full_name",
    "customer_name",
    "email",
    "phone",
    "address",
    "street_address",
    "date_of_birth",
    "ssn",
    "credit_score",
    "commission",
    "race",
    "ethnicity",
    "gender",
    "religion",
    "marital_status",
    "notes",
    "comments",
    "transcript",
)

#: The row-count band the backlog sets for the spend fact at portfolio scale.
PORTFOLIO_SPEND_ROW_BAND = (500, 2_000)


@pytest.fixture
def campaign_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_marketing_campaign`` dataset for the ``test`` profile."""
    return generate_marketing_campaign_dataset(test_config)


@pytest.fixture
def spend_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``marketing_spend_event`` dataset for the ``test`` profile."""
    return generate_marketing_spend_dataset(test_config)


@pytest.fixture
def development_spend_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated spend dataset for the ``development`` profile."""
    return generate_marketing_spend_dataset(development_config)


# --------------------------------------------------------------------------------------
# Column contracts
# --------------------------------------------------------------------------------------
def test_the_campaign_column_order_is_exactly_the_contract(
    campaign_dataset: GeneratedDataset,
) -> None:
    assert campaign_dataset.actual_columns == DIM_MARKETING_CAMPAIGN_COLUMNS
    assert len(DIM_MARKETING_CAMPAIGN_COLUMNS) == 11


def test_the_spend_column_order_is_exactly_the_contract(
    spend_dataset: GeneratedDataset,
) -> None:
    assert spend_dataset.actual_columns == MARKETING_SPEND_COLUMNS
    assert len(MARKETING_SPEND_COLUMNS) == 12


def test_the_column_sets_are_exactly_the_contracts(
    campaign_dataset: GeneratedDataset, spend_dataset: GeneratedDataset
) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(campaign_dataset.actual_columns) == set(DIM_MARKETING_CAMPAIGN_COLUMNS)
    assert set(spend_dataset.actual_columns) == set(MARKETING_SPEND_COLUMNS)


def test_end_date_is_the_only_nullable_campaign_column(
    campaign_dataset: GeneratedDataset,
) -> None:
    frame = campaign_dataset.frame
    for column in DIM_MARKETING_CAMPAIGN_COLUMNS:
        if column == "end_date":
            continue
        assert not frame[column].isna().any(), column


def test_no_spend_column_is_ever_null(spend_dataset: GeneratedDataset) -> None:
    assert not spend_dataset.frame.isna().to_numpy().any()


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(
    campaign_dataset: GeneratedDataset, spend_dataset: GeneratedDataset, prohibited: str
) -> None:
    for dataset in (campaign_dataset, spend_dataset):
        columns = {str(column).lower() for column in dataset.frame.columns}
        assert prohibited not in columns
        assert not any(prohibited in column for column in columns)


def test_no_audience_or_targeting_attribute_is_materialised(
    campaign_dataset: GeneratedDataset,
) -> None:
    """Campaign targeting stops at department and vehicle category. No audience columns."""
    columns = {str(column).lower() for column in campaign_dataset.frame.columns}
    for token in ("audience", "segment_definition", "postal", "zip", "radius", "geofence"):
        assert not any(token in column for column in columns), token


def test_both_privacy_checks_are_registered_as_critical() -> None:
    for check_id in ("DQ-CMP-006", "DQ-MKT-007"):
        definition = require_registered(check_id)
        assert definition.category == "privacy", check_id
        assert str(definition.severity) == "critical", check_id


def test_the_campaign_tripwire_trips(campaign_dataset: GeneratedDataset) -> None:
    tampered = campaign_dataset.frame.copy()
    tampered["contact_phone"] = ""
    results = _campaign_results(campaign_dataset, tampered)
    assert results["DQ-CMP-006"].is_failure


def test_the_spend_tripwire_trips(spend_dataset: GeneratedDataset, test_config: ArpiConfig) -> None:
    tampered = spend_dataset.frame.copy()
    tampered["recipient_email"] = ""
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-007"].is_failure


# --------------------------------------------------------------------------------------
# Campaign content
# --------------------------------------------------------------------------------------
def test_every_campaign_vendor_is_one_of_the_fictional_names(
    campaign_dataset: GeneratedDataset,
) -> None:
    declared = {vendor for vendors in VENDOR_NAMES_BY_CHANNEL.values() for vendor in vendors}
    assert set(campaign_dataset.frame["vendor_name"].tolist()) <= declared


def test_every_campaign_enumeration_is_in_domain(campaign_dataset: GeneratedDataset) -> None:
    frame = campaign_dataset.frame
    assert set(frame["channel"].tolist()) <= set(ALLOWED_CHANNELS)
    assert set(frame["target_department"].tolist()) <= set(ALLOWED_TARGET_DEPARTMENTS)
    assert set(frame["target_vehicle_category"].tolist()) <= set(ALLOWED_TARGET_VEHICLE_CATEGORIES)


def test_every_campaign_lead_source_resolves(campaign_dataset: GeneratedDataset) -> None:
    assert set(campaign_dataset.frame["lead_source_id"].tolist()) <= set(ALL_LEAD_SOURCE_IDS)


def test_campaign_dates_are_ordered(campaign_dataset: GeneratedDataset) -> None:
    frame = campaign_dataset.frame
    ended = frame[frame["end_date"].notna()]
    assert bool((ended["end_date"] >= ended["start_date"]).all())


def test_the_population_mixes_always_on_and_seasonal_campaigns(
    development_config: ArpiConfig,
) -> None:
    """Some run the whole period, some are bursts. Neither shape may be absent."""
    frame = generate_marketing_campaign_dataset(development_config).frame
    open_ended = int(frame["end_date"].isna().sum())
    ended = int(frame["end_date"].notna().sum())
    assert open_ended > 0
    assert ended > 0
    assert 0.15 < open_ended / frame.shape[0] < 0.90


def test_campaign_start_dates_are_staggered(development_config: ArpiConfig) -> None:
    frame = generate_marketing_campaign_dataset(development_config).frame
    assert frame["start_date"].nunique() >= 4


def test_several_channels_are_represented(development_config: ArpiConfig) -> None:
    frame = generate_marketing_campaign_dataset(development_config).frame
    assert frame["channel"].nunique() >= 5


def test_every_campaign_starts_inside_the_reporting_window(
    development_config: ArpiConfig,
) -> None:
    frame = generate_marketing_campaign_dataset(development_config).frame
    start = development_config.reporting.start_date
    end = development_config.reporting.end_date
    assert bool((frame["start_date"].dt.date >= start).all())
    assert bool((frame["start_date"].dt.date <= end).all())


# --------------------------------------------------------------------------------------
# Spend grain, month key and amounts
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("profile", ["test", "development"])
def test_the_month_key_is_always_the_first_of_the_month(profile: str) -> None:
    frame = generate_marketing_spend_dataset(load_config(profile=profile)).frame
    assert all(int(value) % 100 == 1 for value in frame["month_date_key"])


@pytest.mark.parametrize("profile", ["test", "development"])
def test_the_grain_is_unique(profile: str) -> None:
    frame = generate_marketing_spend_dataset(load_config(profile=profile)).frame
    assert not frame.duplicated(subset=list(MARKETING_SPEND_GRAIN_COLUMNS)).any()


@pytest.mark.parametrize("profile", ["test", "development"])
def test_no_amount_or_count_is_negative(profile: str) -> None:
    frame = generate_marketing_spend_dataset(load_config(profile=profile)).frame
    assert all(value >= Decimal("0.00") for value in frame["spend_amount"])
    for column in ("impressions", "clicks", "calls", "form_submissions", "vendor_reported_leads"):
        assert int(frame[column].min()) >= 0, column


def test_every_amount_is_an_exact_cent_quantized_decimal(
    development_spend_dataset: GeneratedDataset,
) -> None:
    for value in development_spend_dataset.frame["spend_amount"]:
        assert isinstance(value, Decimal)
        assert value.as_tuple().exponent == -2, value


def test_the_month_keys_stay_inside_the_reporting_window(
    development_config: ArpiConfig, development_spend_dataset: GeneratedDataset
) -> None:
    keys = {int(value) for value in development_spend_dataset.frame["month_date_key"]}
    lowest = date(
        development_config.reporting.start_date.year,
        development_config.reporting.start_date.month,
        1,
    )
    highest = date(
        development_config.reporting.end_date.year,
        development_config.reporting.end_date.month,
        1,
    )
    assert min(keys) >= lowest.year * 10_000 + lowest.month * 100 + 1
    assert max(keys) <= highest.year * 10_000 + highest.month * 100 + 1


def test_every_reference_resolves(
    development_config: ArpiConfig, development_spend_dataset: GeneratedDataset
) -> None:
    frame = development_spend_dataset.frame
    known_campaigns = {record.campaign_id for record in campaign_records(development_config)}
    known_stores = {store.dealership_id for store in STORE_DEFINITIONS}
    assert set(frame["campaign_id"].tolist()) <= known_campaigns
    assert set(frame["dealership_id"].tolist()) <= known_stores
    assert set(frame["lead_source_id"].tolist()) <= set(ALL_LEAD_SOURCE_IDS)


# --------------------------------------------------------------------------------------
# Scale
# --------------------------------------------------------------------------------------
def test_the_spend_volume_is_plausible_at_test_and_development_scale(
    spend_dataset: GeneratedDataset, development_spend_dataset: GeneratedDataset
) -> None:
    assert 5 <= spend_dataset.row_count <= 200
    assert 60 <= development_spend_dataset.row_count <= 800


def test_the_spend_volume_is_inside_the_portfolio_target_band() -> None:
    """The `P1.5-01` acceptance band: 500 to 2,000 spend rows at portfolio scale.

    Only the campaign and spend entities are generated here -- no vehicles, customers or
    leads -- so this stays a sub-second test rather than a portfolio-scale data run.
    """
    row_count = generate_marketing_spend_dataset(load_config(profile="portfolio")).row_count
    lower, upper = PORTFOLIO_SPEND_ROW_BAND
    assert lower <= row_count <= upper, row_count


def test_every_store_receives_spend_at_development_scale(
    development_spend_dataset: GeneratedDataset,
) -> None:
    stores = {store.dealership_id for store in STORE_DEFINITIONS}
    assert set(development_spend_dataset.frame["dealership_id"].tolist()) == stores


def test_every_month_of_the_window_receives_spend(
    development_spend_dataset: GeneratedDataset,
) -> None:
    assert development_spend_dataset.frame["month_date_key"].nunique() == 6


# --------------------------------------------------------------------------------------
# The vendor-versus-CRM divergence
# --------------------------------------------------------------------------------------
def test_the_vendor_over_reports_in_aggregate(development_config: ArpiConfig) -> None:
    """Direction and band, never a point value."""
    demand = campaign_month_demand(development_config)
    true_total = sum(item.true_lead_count for item in demand)
    vendor_total = sum(item.vendor_reported_leads for item in demand)
    assert true_total > 0
    assert vendor_total > true_total
    assert 1.15 < vendor_total / true_total < 1.45


def test_the_over_reporting_is_systematic_not_noise(development_config: ArpiConfig) -> None:
    """Not one row in the dataset reports fewer leads than the CRM will record."""
    demand = campaign_month_demand(development_config)
    assert all(item.vendor_reported_leads >= item.true_lead_count for item in demand)
    strictly_higher = sum(1 for item in demand if item.vendor_reported_leads > item.true_lead_count)
    assert strictly_higher / len(demand) > 0.50


def test_the_divergence_is_visible_at_campaign_level(development_config: ArpiConfig) -> None:
    """A reconciliation done per campaign, not only in total, must still show the gap."""
    totals: dict[str, list[int]] = {}
    for item in campaign_month_demand(development_config):
        bucket = totals.setdefault(item.campaign_id, [0, 0])
        bucket[0] += item.true_lead_count
        bucket[1] += item.vendor_reported_leads
    diverging = [campaign_id for campaign_id, (true, vendor) in totals.items() if vendor > true]
    assert len(diverging) / len(totals) > 0.80


# --------------------------------------------------------------------------------------
# Spend behaviour
# --------------------------------------------------------------------------------------
def test_spend_correlates_with_lead_volume_without_being_a_function_of_it(
    development_config: ArpiConfig, development_spend_dataset: GeneratedDataset
) -> None:
    """Correlated, but with residual variance: cost per lead must not be constant."""
    demand = {
        (item.month_date_key, item.dealership_id, item.campaign_id): item
        for item in campaign_month_demand(development_config)
    }
    ratios: list[float] = []
    for record in development_spend_dataset.frame.to_dict(orient="records"):
        item = demand[
            (
                int(record["month_date_key"]),
                str(record["dealership_id"]),
                str(record["campaign_id"]),
            )
        ]
        if item.true_lead_count > 0:
            ratios.append(float(record["spend_amount"]) / item.true_lead_count)
    assert len(ratios) > 50
    assert len(set(ratios)) > len(ratios) * 0.9
    average = sum(ratios) / len(ratios)
    spread = (sum((value - average) ** 2 for value in ratios) / len(ratios)) ** 0.5
    assert spread / average > 0.05


def test_offline_channels_report_no_clicks(
    development_config: ArpiConfig, development_spend_dataset: GeneratedDataset
) -> None:
    offline = {"Radio", "Television", "Direct Mail"}
    channels = {
        record.campaign_id: record.channel for record in campaign_records(development_config)
    }
    for record in development_spend_dataset.frame.to_dict(orient="records"):
        if channels[str(record["campaign_id"])] in offline:
            assert int(record["clicks"]) == 0, record["campaign_id"]


def test_digital_channels_report_impressions_and_clicks(
    development_config: ArpiConfig, development_spend_dataset: GeneratedDataset
) -> None:
    channels = {
        record.campaign_id: record.channel for record in campaign_records(development_config)
    }
    digital_rows = [
        record
        for record in development_spend_dataset.frame.to_dict(orient="records")
        if channels[str(record["campaign_id"])]
        in {"Paid Search", "Paid Social", "Third-Party Listings"}
    ]
    assert digital_rows
    with_clicks = sum(1 for record in digital_rows if int(record["clicks"]) > 0)
    assert with_clicks / len(digital_rows) > 0.80


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    for generate in (generate_marketing_campaign_dataset, generate_marketing_spend_dataset):
        first = dataframe_to_csv_bytes(generate(test_config).frame)
        second = dataframe_to_csv_bytes(generate(test_config).frame)
        assert first == second
        assert content_digest(first) == content_digest(second)


def test_the_digests_are_stable_across_reruns(test_config: ArpiConfig) -> None:
    for generate in (generate_marketing_campaign_dataset, generate_marketing_spend_dataset):
        digests = {
            content_digest(dataframe_to_csv_bytes(generate(test_config).frame)) for _ in range(3)
        }
        assert len(digests) == 1


def test_generating_marketing_data_does_not_perturb_any_other_entity(
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
            "dim_employee": content_digest(
                dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
            ),
            "dim_customer": content_digest(
                dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
            ),
            "dim_lead_source": content_digest(
                dataframe_to_csv_bytes(generate_lead_source_dataset(test_config).frame)
            ),
        }

    before = digests()
    generate_marketing_campaign_dataset(test_config)
    generate_marketing_spend_dataset(test_config)
    assert digests() == before


def test_the_two_marketing_entities_do_not_perturb_each_other(
    test_config: ArpiConfig,
) -> None:
    campaign_digest = content_digest(
        dataframe_to_csv_bytes(generate_marketing_campaign_dataset(test_config).frame)
    )
    generate_marketing_spend_dataset(test_config)
    assert (
        content_digest(
            dataframe_to_csv_bytes(generate_marketing_campaign_dataset(test_config).frame)
        )
        == campaign_digest
    )


# --------------------------------------------------------------------------------------
# The gating suites
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    campaign_dataset: GeneratedDataset, spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    campaign_report = validate_marketing_campaign_dataset(campaign_dataset)
    spend_report = validate_marketing_spend_dataset(spend_dataset, test_config)
    assert not campaign_report.failures, [r.message for r in campaign_report.failures]
    assert not spend_report.failures, [r.message for r in spend_report.failures]


def test_the_suites_emit_every_declared_check_exactly_once(
    campaign_dataset: GeneratedDataset, spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    campaign_ids = [
        result.check_id for result in validate_marketing_campaign_dataset(campaign_dataset).results
    ]
    spend_ids = [
        result.check_id
        for result in validate_marketing_spend_dataset(spend_dataset, test_config).results
    ]
    assert campaign_ids == list(CAMPAIGN_CHECK_IDS)
    assert spend_ids == list(MARKETING_SPEND_CHECK_IDS)
    assert len(set(campaign_ids + spend_ids)) == len(campaign_ids + spend_ids)


def test_every_emitted_check_is_registered(
    campaign_dataset: GeneratedDataset, spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    reports = (
        validate_marketing_campaign_dataset(campaign_dataset),
        validate_marketing_spend_dataset(spend_dataset, test_config),
    )
    for report in reports:
        for result in report.results:
            definition = require_registered(result.check_id)
            assert result.check_category == definition.category, result.check_id
            assert result.severity == definition.severity, result.check_id


def test_the_grain_check_fails_on_a_duplicated_row(
    spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = pd.concat([spend_dataset.frame, spend_dataset.frame.head(1)], ignore_index=True)
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-001"].is_failure


def test_the_month_key_check_fails_on_a_month_end_key(
    spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The check must catch 20250131, the classic month-grain defect."""
    tampered = spend_dataset.frame.copy()
    tampered.loc[tampered.index[0], "month_date_key"] = 20250131
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-003"].is_failure


def test_the_amount_check_fails_on_negative_spend(
    spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = spend_dataset.frame.copy()
    amounts = list(tampered["spend_amount"])
    amounts[0] = Decimal("-1.00")
    tampered["spend_amount"] = amounts
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-004"].is_failure


def test_the_reference_check_fails_on_an_unknown_campaign(
    spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = spend_dataset.frame.copy()
    tampered.loc[tampered.index[0], "campaign_id"] = "CMP-99999"
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-005"].is_failure


def test_the_vendor_lead_check_fails_on_a_negative_count(
    spend_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = spend_dataset.frame.copy()
    tampered.loc[tampered.index[0], "vendor_reported_leads"] = -3
    results = _spend_results(spend_dataset, tampered, test_config)
    assert results["DQ-MKT-006"].is_failure


def test_the_campaign_reference_check_fails_on_an_unknown_lead_source(
    campaign_dataset: GeneratedDataset,
) -> None:
    tampered = campaign_dataset.frame.copy()
    tampered.loc[tampered.index[0], "lead_source_id"] = "LDS-404"
    results = _campaign_results(campaign_dataset, tampered)
    assert results["DQ-CMP-004"].is_failure


def test_the_campaign_enumeration_check_fails_on_an_ungoverned_channel(
    campaign_dataset: GeneratedDataset,
) -> None:
    tampered = campaign_dataset.frame.copy()
    tampered.loc[tampered.index[0], "channel"] = "Skywriting"
    results = _campaign_results(campaign_dataset, tampered)
    assert results["DQ-CMP-005"].is_failure


def _campaign_results(dataset: GeneratedDataset, frame: pd.DataFrame) -> dict[str, CheckResult]:
    """Re-run the campaign suite over a tampered frame, keyed by check id."""
    report = validate_marketing_campaign_dataset(
        GeneratedDataset(
            entity_name=dataset.entity_name,
            frame=frame,
            declared_columns=dataset.declared_columns,
            namespace=dataset.namespace,
        )
    )
    return {result.check_id: result for result in report.results}


def _spend_results(
    dataset: GeneratedDataset, frame: pd.DataFrame, config: ArpiConfig
) -> dict[str, CheckResult]:
    """Re-run the spend suite over a tampered frame, keyed by check id."""
    report = validate_marketing_spend_dataset(
        GeneratedDataset(
            entity_name=dataset.entity_name,
            frame=frame,
            declared_columns=dataset.declared_columns,
            namespace=dataset.namespace,
        ),
        config,
    )
    return {result.check_id: result for result in report.results}
