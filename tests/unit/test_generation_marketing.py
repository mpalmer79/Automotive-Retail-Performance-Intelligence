"""Unit tests for the marketing campaign dimension and the marketing-spend fact source.

Two properties get the most attention here, because they are the two that quietly ruin a
monthly fact: ``month_date_key`` must be the **first** day of its month, and
``spend_amount`` must be an exact cent-quantized :class:`~decimal.Decimal` rather than a
float that merely looks like money.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.exceptions import GenerationError
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.lead_source import ALL_LEAD_SOURCE_IDS, PAID_LEAD_SOURCE_IDS
from arpi.generation.marketing import (
    ALLOWED_CHANNELS,
    ALLOWED_TARGET_DEPARTMENTS,
    ALLOWED_TARGET_VEHICLE_CATEGORIES,
    CAMPAIGN_CHECK_IDS,
    CAMPAIGN_COUNT_BY_SCALE,
    CAMPAIGN_LEAD_SOURCE_CHANNELS,
    DIM_MARKETING_CAMPAIGN_COLUMNS,
    INDEPENDENT_USED_DEALERSHIP_ID,
    MARKETING_SPEND_CHECK_IDS,
    MARKETING_SPEND_COLUMNS,
    MARKETING_SPEND_GRAIN_COLUMNS,
    VEHICLE_CATEGORY_NEW,
    VENDOR_NAMES_BY_CHANNEL,
    VENDOR_OVER_REPORT_FACTOR,
    CampaignRecord,
    active_fraction_of_month,
    campaign_count,
    campaign_month_demand,
    campaign_records,
    generate_marketing_campaign_dataset,
    generate_marketing_spend_dataset,
    month_end,
    month_start_key,
    month_starts_between,
    monthly_group_lead_volume,
    validate_marketing_campaign_dataset,
    validate_marketing_spend_dataset,
)

CAMPAIGN_ID_PATTERN = re.compile(r"^CMP-\d{5}$")
SPEND_ID_PATTERN = re.compile(r"^MKT-\d{8}$")

ALL_VENDOR_NAMES = {vendor for vendors in VENDOR_NAMES_BY_CHANNEL.values() for vendor in vendors}
ALL_DEALERSHIP_IDS = {store.dealership_id for store in STORE_DEFINITIONS}


@pytest.fixture
def campaigns(test_config: ArpiConfig) -> tuple[CampaignRecord, ...]:
    """The campaign population for the ``test`` profile."""
    return campaign_records(test_config)


# --------------------------------------------------------------------------------------
# Calendar derivations
# --------------------------------------------------------------------------------------
def test_the_month_key_encodes_the_first_day_of_the_month() -> None:
    assert month_start_key(date(2025, 7, 1)) == 20250701
    assert month_start_key(date(2024, 1, 1)) == 20240101
    assert month_start_key(date(2025, 12, 1)) == 20251201


def test_the_month_key_refuses_any_day_but_the_first() -> None:
    """20250731 is the single most common way a month-grain fact goes wrong."""
    with pytest.raises(GenerationError, match="FIRST day of the month"):
        month_start_key(date(2025, 7, 31))
    with pytest.raises(GenerationError, match="FIRST day of the month"):
        month_start_key(date(2025, 7, 2))


def test_month_starts_cover_the_window_inclusively() -> None:
    months = month_starts_between(date(2025, 7, 15), date(2025, 10, 2))
    assert months == (date(2025, 7, 1), date(2025, 8, 1), date(2025, 9, 1), date(2025, 10, 1))


def test_month_starts_roll_over_a_year_end() -> None:
    months = month_starts_between(date(2024, 11, 1), date(2025, 2, 28))
    assert months == (
        date(2024, 11, 1),
        date(2024, 12, 1),
        date(2025, 1, 1),
        date(2025, 2, 1),
    )


def test_month_starts_are_empty_for_an_inverted_window() -> None:
    assert month_starts_between(date(2025, 7, 1), date(2025, 6, 30)) == ()


def test_month_end_handles_february_in_a_leap_year() -> None:
    assert month_end(date(2024, 2, 1)) == date(2024, 2, 29)
    assert month_end(date(2025, 2, 1)) == date(2025, 2, 28)
    assert month_end(date(2025, 7, 1)) == date(2025, 7, 31)


def _campaign(start: date, end: date | None) -> CampaignRecord:
    """Build a minimal campaign for the active-window arithmetic tests."""
    return CampaignRecord(
        campaign_id="CMP-00001",
        campaign_name="Fixture Campaign 2025 - Paid Search",
        channel="Paid Search",
        vendor_name="Granite Ridge Digital",
        lead_source_id="LDS-006",
        start_date=start,
        end_date=end,
        target_department="Sales",
        target_vehicle_category="Both",
        dealership_ids=("GSA-001",),
        source_share=1.0,
    )


def test_a_campaign_running_all_month_funds_the_whole_month() -> None:
    campaign = _campaign(date(2025, 1, 1), None)
    assert active_fraction_of_month(campaign, date(2025, 7, 1), date(2025, 12, 31)) == 1.0


def test_a_campaign_starting_mid_month_funds_part_of_it() -> None:
    campaign = _campaign(date(2025, 7, 15), date(2025, 8, 31))
    fraction = active_fraction_of_month(campaign, date(2025, 7, 1), date(2025, 12, 31))
    assert fraction == pytest.approx(17 / 31)


def test_a_campaign_outside_the_month_funds_none_of_it() -> None:
    campaign = _campaign(date(2025, 9, 1), date(2025, 9, 30))
    assert active_fraction_of_month(campaign, date(2025, 7, 1), date(2025, 12, 31)) == 0.0
    assert active_fraction_of_month(campaign, date(2025, 11, 1), date(2025, 12, 31)) == 0.0


def test_an_open_ended_campaign_stops_at_the_window_end() -> None:
    campaign = _campaign(date(2025, 1, 1), None)
    assert active_fraction_of_month(
        campaign, date(2025, 12, 1), date(2025, 12, 15)
    ) == pytest.approx(15 / 31)


def test_is_active_on_respects_both_bounds() -> None:
    campaign = _campaign(date(2025, 7, 10), date(2025, 7, 20))
    assert not campaign.is_active_on(date(2025, 7, 9))
    assert campaign.is_active_on(date(2025, 7, 10))
    assert campaign.is_active_on(date(2025, 7, 20))
    assert not campaign.is_active_on(date(2025, 7, 21))
    assert _campaign(date(2025, 7, 10), None).is_active_on(date(2030, 1, 1))


# --------------------------------------------------------------------------------------
# Campaign population
# --------------------------------------------------------------------------------------
def test_the_campaign_count_matches_the_declared_scale() -> None:
    for profile, expected in (("test", 8), ("development", 24)):
        config = load_config(profile=profile)
        assert campaign_count(config) == expected
        assert generate_marketing_campaign_dataset(config).row_count == expected
    assert CAMPAIGN_COUNT_BY_SCALE["portfolio"] == 60


def test_every_campaign_identifier_matches_the_declared_format(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert CAMPAIGN_ID_PATTERN.match(campaign.campaign_id), campaign.campaign_id


def test_the_campaign_key_is_a_deterministic_ordinal(test_config: ArpiConfig) -> None:
    frame = generate_marketing_campaign_dataset(test_config).frame
    ordered = frame.sort_values("campaign_id")
    assert list(ordered["campaign_key"]) == list(range(1, frame.shape[0] + 1))


def test_end_date_is_null_or_on_or_after_start_date(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        if campaign.end_date is not None:
            assert campaign.end_date >= campaign.start_date, campaign.campaign_id


def test_every_campaign_resolves_to_a_governed_paid_lead_source(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert campaign.lead_source_id in ALL_LEAD_SOURCE_IDS
        assert campaign.lead_source_id in PAID_LEAD_SOURCE_IDS


def test_the_channel_follows_from_the_lead_source(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert campaign.channel == CAMPAIGN_LEAD_SOURCE_CHANNELS[campaign.lead_source_id]
        assert campaign.channel in ALLOWED_CHANNELS


def test_every_vendor_name_comes_from_the_fictional_list(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert campaign.vendor_name in ALL_VENDOR_NAMES
        assert campaign.vendor_name in VENDOR_NAMES_BY_CHANNEL[campaign.channel]


def test_targeting_values_are_inside_their_enumerations(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert campaign.target_department in ALLOWED_TARGET_DEPARTMENTS
        assert campaign.target_vehicle_category in ALLOWED_TARGET_VEHICLE_CATEGORIES


def test_every_campaign_funds_at_least_one_real_store(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    for campaign in campaigns:
        assert campaign.dealership_ids
        assert set(campaign.dealership_ids) <= ALL_DEALERSHIP_IDS


def test_the_independent_used_store_never_funds_a_new_vehicle_campaign() -> None:
    """GSA-003 stocks no new inventory, so it cannot be buying new-vehicle advertising."""
    for profile in ("test", "development"):
        for campaign in campaign_records(load_config(profile=profile)):
            if campaign.target_vehicle_category == VEHICLE_CATEGORY_NEW:
                assert INDEPENDENT_USED_DEALERSHIP_ID not in campaign.dealership_ids


def test_the_source_shares_sum_to_one_within_each_lead_source(
    campaigns: tuple[CampaignRecord, ...],
) -> None:
    totals: dict[str, float] = {}
    for campaign in campaigns:
        totals[campaign.lead_source_id] = (
            totals.get(campaign.lead_source_id, 0.0) + campaign.source_share
        )
    for lead_source_id, total in totals.items():
        assert total == pytest.approx(1.0, abs=1e-9), lead_source_id


def test_the_campaign_frame_matches_the_declared_contract(test_config: ArpiConfig) -> None:
    dataset = generate_marketing_campaign_dataset(test_config)
    assert dataset.actual_columns == DIM_MARKETING_CAMPAIGN_COLUMNS
    assert dataset.column_count == 11
    assert dataset.namespace == "dim_marketing_campaign"


def test_campaign_regeneration_produces_an_identical_frame(test_config: ArpiConfig) -> None:
    first = generate_marketing_campaign_dataset(test_config).frame
    second = generate_marketing_campaign_dataset(test_config).frame
    assert first.equals(second)


def test_a_different_seed_moves_the_campaign_population(test_config: ArpiConfig) -> None:
    """The campaigns are drawn, not fixed reference data, so the seed must matter."""
    reseeded = test_config.model_copy(update={"random_seed": test_config.random_seed + 7})
    assert not generate_marketing_campaign_dataset(test_config).frame.equals(
        generate_marketing_campaign_dataset(reseeded).frame
    )


def test_an_unknown_scale_mode_is_refused(test_config: ArpiConfig) -> None:
    broken = test_config.model_copy(
        update={"generation": test_config.generation.model_copy(update={"scale_mode": "huge"})}
    )
    with pytest.raises(GenerationError, match="No campaign count is declared"):
        campaign_count(broken)


# --------------------------------------------------------------------------------------
# Marketing spend source
# --------------------------------------------------------------------------------------
def test_the_spend_frame_matches_the_declared_contract(test_config: ArpiConfig) -> None:
    dataset = generate_marketing_spend_dataset(test_config)
    assert dataset.actual_columns == MARKETING_SPEND_COLUMNS
    assert dataset.column_count == 12
    assert dataset.namespace == "marketing_spend_event"


def test_every_spend_identifier_matches_the_declared_format(test_config: ArpiConfig) -> None:
    frame = generate_marketing_spend_dataset(test_config).frame
    for value in frame["marketing_spend_id"]:
        assert SPEND_ID_PATTERN.match(str(value)), value
    assert frame["marketing_spend_id"].nunique() == frame.shape[0]


def test_every_month_key_is_the_first_day_of_its_month(test_config: ArpiConfig) -> None:
    frame = generate_marketing_spend_dataset(test_config).frame
    for value in frame["month_date_key"]:
        assert int(value) % 100 == 1, value


def test_the_grain_is_unique(test_config: ArpiConfig) -> None:
    frame = generate_marketing_spend_dataset(test_config).frame
    assert not frame.duplicated(subset=list(MARKETING_SPEND_GRAIN_COLUMNS)).any()


def test_spend_is_an_exact_cent_quantized_decimal(test_config: ArpiConfig) -> None:
    """Money is Decimal, never float: a float here would reintroduce binary rounding."""
    frame = generate_marketing_spend_dataset(test_config).frame
    for value in frame["spend_amount"]:
        assert isinstance(value, Decimal), type(value)
        assert value.as_tuple().exponent == -2, value


def test_no_amount_or_count_is_ever_negative(test_config: ArpiConfig) -> None:
    frame = generate_marketing_spend_dataset(test_config).frame
    assert all(value >= Decimal("0.00") for value in frame["spend_amount"])
    for column in ("impressions", "clicks", "calls", "form_submissions", "vendor_reported_leads"):
        assert int(frame[column].min()) >= 0, column


def test_the_vendors_reported_split_never_exceeds_its_own_total(
    test_config: ArpiConfig,
) -> None:
    frame = generate_marketing_spend_dataset(test_config).frame
    assert bool(
        (frame["calls"] + frame["form_submissions"] <= frame["vendor_reported_leads"]).all()
    )


def test_only_months_inside_the_campaign_window_receive_spend(
    test_config: ArpiConfig,
) -> None:
    by_id = {campaign.campaign_id: campaign for campaign in campaign_records(test_config)}
    frame = generate_marketing_spend_dataset(test_config).frame
    for record in frame.to_dict(orient="records"):
        campaign = by_id[str(record["campaign_id"])]
        key = int(record["month_date_key"])
        month_start = date(key // 10_000, key // 100 % 100, 1)
        finish = month_end(month_start)
        assert campaign.start_date <= finish, campaign.campaign_id
        if campaign.end_date is not None:
            assert campaign.end_date >= month_start, campaign.campaign_id


def test_spend_only_lands_on_stores_that_fund_the_campaign(test_config: ArpiConfig) -> None:
    by_id = {campaign.campaign_id: campaign for campaign in campaign_records(test_config)}
    frame = generate_marketing_spend_dataset(test_config).frame
    for record in frame.to_dict(orient="records"):
        campaign = by_id[str(record["campaign_id"])]
        assert str(record["dealership_id"]) in campaign.dealership_ids


def test_the_lead_source_is_carried_from_the_campaign(test_config: ArpiConfig) -> None:
    by_id = {campaign.campaign_id: campaign for campaign in campaign_records(test_config)}
    frame = generate_marketing_spend_dataset(test_config).frame
    for record in frame.to_dict(orient="records"):
        campaign = by_id[str(record["campaign_id"])]
        assert str(record["lead_source_id"]) == campaign.lead_source_id


def test_spend_regeneration_produces_an_identical_frame(test_config: ArpiConfig) -> None:
    first = generate_marketing_spend_dataset(test_config).frame
    second = generate_marketing_spend_dataset(test_config).frame
    assert first.equals(second)


def test_the_monthly_lead_volume_follows_the_configured_scale(
    test_config: ArpiConfig,
) -> None:
    """The test window is two months long and the test scale declares 200 leads."""
    assert monthly_group_lead_volume(test_config) == pytest.approx(100.0)


def test_an_unknown_scale_mode_is_refused_by_the_volume_helper(
    test_config: ArpiConfig,
) -> None:
    broken = test_config.model_copy(
        update={"generation": test_config.generation.model_copy(update={"scale_mode": "huge"})}
    )
    with pytest.raises(GenerationError, match="No lead count is declared"):
        monthly_group_lead_volume(broken)


# --------------------------------------------------------------------------------------
# The vendor-versus-CRM gap
# --------------------------------------------------------------------------------------
def test_the_vendor_never_reports_fewer_leads_than_the_crm_will_record(
    test_config: ArpiConfig,
) -> None:
    """Over-reporting is systematic, not noise in both directions."""
    for demand in campaign_month_demand(test_config):
        assert demand.vendor_reported_leads >= demand.true_lead_count, demand.campaign_id


def test_the_published_vendor_count_is_the_demand_helpers_count(
    test_config: ArpiConfig,
) -> None:
    """The fact and the helper the lead generator reads must not drift apart."""
    frame = generate_marketing_spend_dataset(test_config).frame
    published = {
        (
            int(record["month_date_key"]),
            str(record["dealership_id"]),
            str(record["campaign_id"]),
        ): int(record["vendor_reported_leads"])
        for record in frame.to_dict(orient="records")
    }
    helper = {
        (demand.month_date_key, demand.dealership_id, demand.campaign_id): (
            demand.vendor_reported_leads
        )
        for demand in campaign_month_demand(test_config)
    }
    assert helper == published


def test_the_inflation_factor_is_the_documented_one() -> None:
    assert VENDOR_OVER_REPORT_FACTOR == 1.28


# --------------------------------------------------------------------------------------
# Validation suites
# --------------------------------------------------------------------------------------
def test_the_campaign_suite_emits_every_declared_check_in_order(
    test_config: ArpiConfig,
) -> None:
    report = validate_marketing_campaign_dataset(generate_marketing_campaign_dataset(test_config))
    assert [result.check_id for result in report.results] == list(CAMPAIGN_CHECK_IDS)
    assert not report.failures, [result.message for result in report.failures]


def test_the_spend_suite_emits_every_declared_check_in_order(test_config: ArpiConfig) -> None:
    dataset = generate_marketing_spend_dataset(test_config)
    report = validate_marketing_spend_dataset(dataset, test_config)
    assert [result.check_id for result in report.results] == list(MARKETING_SPEND_CHECK_IDS)
    assert not report.failures, [result.message for result in report.failures]


def test_the_date_order_check_fails_on_an_inverted_campaign(test_config: ArpiConfig) -> None:
    dataset = generate_marketing_campaign_dataset(test_config)
    tampered = dataset.frame.copy()
    first = tampered.index[0]
    tampered.loc[first, "end_date"] = tampered.loc[first, "start_date"] - timedelta(days=1)
    results = {
        result.check_id: result
        for result in validate_marketing_campaign_dataset(
            type(dataset)(
                entity_name=dataset.entity_name,
                frame=tampered,
                declared_columns=dataset.declared_columns,
                namespace=dataset.namespace,
            )
        ).results
    }
    assert results["DQ-CMP-003"].is_failure
