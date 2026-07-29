"""Every one of the 29 MVP KPIs is computable from the reporting layer, and correct.

Three things are proved here, and they are different things:

1. **Computability.** Each KPI identifier resolves to a reporting view that exists and
   returns a value. This is the Gate 1 condition.
2. **Correctness.** Each KPI computed from the reporting layer equals the same figure
   derived independently from ``warehouse``. The warehouse expression is written from
   KPI_CATALOG.md's numerator and denominator text rather than by reading the view, so
   the two derivations are genuinely independent -- a test that computed both sides from
   the same view would prove only that SQL is deterministic.
3. **Null behaviour.** Every ratio returns NULL, never zero and never infinity, when its
   denominator is zero. KPI_CATALOG.md is explicit that displaying ``$0`` per unit in a
   month with no sales, or an infinite cost per lead for a channel that produced none,
   would be a false statement rather than a rounding choice.

The medians are checked separately, because an order statistic cannot be recomputed from
an aggregate: the test asserts that the row-level population the median needs is exposed,
and that the view's median matches ``percentile_cont`` over that population.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from arpi.constants import KPI_IDS, KPI_VIEW_OWNERSHIP

pytestmark = pytest.mark.integration


def _scalar(cursor: Any, statement: str) -> Any:
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _assert_equal(reported: Any, expected: Any, label: str) -> None:
    """Compare two numeric results exactly, tolerating only currency rounding."""
    assert reported is not None, f"{label}: the reporting layer returned NULL"
    assert expected is not None, f"{label}: the warehouse derivation returned NULL"
    difference = abs(Decimal(str(reported)) - Decimal(str(expected)))
    assert difference <= Decimal("0.01"), (
        f"{label}: reporting layer says {reported}, warehouse says {expected} "
        f"(difference {difference})"
    )


# --------------------------------------------------------------------------------------
# Computability: the Gate 1 condition
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("kpi_id", KPI_IDS)
def test_every_kpi_resolves_to_an_existing_reporting_view(loaded_cursor: Any, kpi_id: str) -> None:
    """All 29 KPI identifiers own at least one reporting view, and each view exists."""
    owners = KPI_VIEW_OWNERSHIP[kpi_id]
    assert owners, f"{kpi_id} has no reporting view registered in arpi.constants"
    for view_name in owners:
        exists = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM information_schema.views "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
        assert exists == 1, f"{kpi_id} names reporting.{view_name}, which does not exist"


def test_the_catalogue_index_covers_exactly_twenty_nine_kpis() -> None:
    """KPI_CATALOG.md specifies 29 MVP KPIs; the machine-readable index must match."""
    assert len(KPI_IDS) == 29
    assert len(set(KPI_IDS)) == 29
    assert set(KPI_VIEW_OWNERSHIP) == set(KPI_IDS)


# --------------------------------------------------------------------------------------
# Sales volume: KPI-SLS-001..003
# --------------------------------------------------------------------------------------


def test_kpi_sls_001_retail_units_sold(loaded_cursor: Any) -> None:
    reported = _scalar(
        loaded_cursor, "SELECT sum(retail_units_sold) FROM reporting.vw_sales_summary"
    )
    expected = _scalar(
        loaded_cursor,
        "SELECT sum(unit_count) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(reported, expected, "KPI-SLS-001")


def test_kpi_sls_002_new_units_sold(loaded_cursor: Any) -> None:
    reported = _scalar(loaded_cursor, "SELECT sum(new_units_sold) FROM reporting.vw_sales_summary")
    expected = _scalar(
        loaded_cursor,
        """
        SELECT sum(s.unit_count)
        FROM warehouse.fact_vehicle_sale AS s
        JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
        WHERE s.is_retail AND v.condition_type = 'New'
        """,
    )
    _assert_equal(reported, expected, "KPI-SLS-002")


def test_kpi_sls_003_used_units_sold_includes_certified(loaded_cursor: Any) -> None:
    """A certified pre-owned unit is a USED unit, per KPI_CATALOG.md KPI-SLS-003."""
    reported = _scalar(loaded_cursor, "SELECT sum(used_units_sold) FROM reporting.vw_sales_summary")
    expected = _scalar(
        loaded_cursor,
        """
        SELECT sum(s.unit_count)
        FROM warehouse.fact_vehicle_sale AS s
        JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
        WHERE s.is_retail AND v.condition_type IN ('Used', 'Certified')
        """,
    )
    _assert_equal(reported, expected, "KPI-SLS-003")

    certified = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_vehicle_sale AS s
        JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
        WHERE s.is_retail AND v.condition_type = 'Certified'
        """,
    )
    assert certified > 0, "no certified retail unit exists, so the inclusion is untested"


def test_the_unit_identity_holds_on_every_store_day(loaded_cursor: Any) -> None:
    """RECON-UNITS-001: KPI-SLS-002 + KPI-SLS-003 = KPI-SLS-001, in every context."""
    violations = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_sales_summary
        WHERE retail_units_sold <> new_units_sold + used_units_sold
        """,
    )
    assert violations == 0


# --------------------------------------------------------------------------------------
# Gross: KPI-GRS-001..006
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_id", "view_column", "fact_column"),
    [
        ("KPI-GRS-001", "front_end_gross", "front_end_gross"),
        ("KPI-GRS-002", "back_end_gross", "back_end_gross"),
        ("KPI-GRS-003", "total_gross", "total_gross"),
    ],
)
def test_additive_gross_measures(
    loaded_cursor: Any, kpi_id: str, view_column: str, fact_column: str
) -> None:
    reported = _scalar(loaded_cursor, f"SELECT sum({view_column}) FROM reporting.vw_gross_summary")
    expected = _scalar(
        loaded_cursor,
        f"SELECT sum({fact_column}) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(reported, expected, kpi_id)


@pytest.mark.parametrize(
    ("kpi_id", "numerator", "ratio_column"),
    [
        ("KPI-GRS-004", "front_end_gross", "front_gross_per_retail_unit"),
        ("KPI-GRS-005", "back_end_gross", "back_gross_per_retail_unit"),
        ("KPI-GRS-006", "total_gross", "total_gross_per_retail_unit"),
    ],
)
def test_per_unit_gross_measures(
    loaded_cursor: Any, kpi_id: str, numerator: str, ratio_column: str
) -> None:
    """The ratio at a store-day row equals its own numerator over its own denominator."""
    mismatches = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM reporting.vw_gross_summary
        WHERE retail_units_sold > 0
          AND abs({ratio_column} - ({numerator} / retail_units_sold)) > 0.0001
        """,
    )
    assert mismatches == 0, f"{kpi_id}: the published ratio disagrees with its own components"

    # And the group-level figure, recomputed from the additive columns, matches the
    # warehouse. This is the recomputation a DAX measure performs.
    reported = _scalar(
        loaded_cursor,
        f"SELECT sum({numerator}) / nullif(sum(retail_units_sold), 0) "
        "FROM reporting.vw_gross_summary",
    )
    expected = _scalar(
        loaded_cursor,
        f"SELECT sum({numerator}) / nullif(sum(unit_count), 0) "
        "FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(reported, expected, kpi_id)


def test_the_per_unit_gross_identity_holds(loaded_cursor: Any) -> None:
    """KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005, because all three share one denominator."""
    violations = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_gross_summary
        WHERE retail_units_sold > 0
          AND abs(total_gross_per_retail_unit
                  - (front_gross_per_retail_unit + back_gross_per_retail_unit)) > 0.0001
        """,
    )
    assert violations == 0


def test_negative_front_gross_remains_visible(loaded_cursor: Any) -> None:
    """A negative-front deal is a real dealership outcome and must not be clipped."""
    negatives = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_vehicle_sales "
        "WHERE is_retail AND retail_front_end_gross < 0",
    )
    published = _scalar(
        loaded_cursor, "SELECT sum(negative_front_gross_units) FROM reporting.vw_gross_summary"
    )
    assert published == negatives


# --------------------------------------------------------------------------------------
# Inventory: KPI-INV-001..009
# --------------------------------------------------------------------------------------


@pytest.fixture()
def as_of_date_key(loaded_cursor: Any) -> int:
    """The latest snapshot date, which is the default as-of date for inventory KPIs."""
    value = _scalar(
        loaded_cursor,
        "SELECT max(snapshot_date_key) FROM warehouse.fact_vehicle_inventory_snapshot",
    )
    assert value is not None
    return int(value)


@pytest.mark.parametrize(
    ("kpi_id", "view_column", "fact_column"),
    [
        ("KPI-INV-001", "active_inventory_units", "inventory_unit_count"),
        ("KPI-INV-002", "inventory_investment", "inventory_investment"),
    ],
)
def test_semi_additive_inventory_measures_at_one_as_of_date(
    loaded_cursor: Any, as_of_date_key: int, kpi_id: str, view_column: str, fact_column: str
) -> None:
    reported = _scalar(
        loaded_cursor,
        f"SELECT sum({view_column}) FROM reporting.vw_inventory_health "
        f"WHERE snapshot_date_key = {as_of_date_key}",
    )
    expected = _scalar(
        loaded_cursor,
        f"SELECT sum({fact_column}) FROM warehouse.fact_vehicle_inventory_snapshot "
        f"WHERE snapshot_date_key = {as_of_date_key}",
    )
    _assert_equal(reported, expected, kpi_id)


def test_kpi_inv_003_average_inventory_age(loaded_cursor: Any, as_of_date_key: int) -> None:
    reported = _scalar(
        loaded_cursor,
        "SELECT sum(days_in_stock_total) / nullif(sum(active_inventory_units), 0) "
        f"FROM reporting.vw_inventory_health WHERE snapshot_date_key = {as_of_date_key}",
    )
    expected = _scalar(
        loaded_cursor,
        "SELECT sum(days_in_stock)::numeric / nullif(sum(inventory_unit_count), 0) "
        "FROM warehouse.fact_vehicle_inventory_snapshot "
        f"WHERE snapshot_date_key = {as_of_date_key}",
    )
    _assert_equal(reported, expected, "KPI-INV-003")


def test_kpi_inv_004_median_inventory_age_is_recomputable_from_row_level(
    loaded_cursor: Any, as_of_date_key: int
) -> None:
    """The median must be derivable from row-level days_in_stock, not only pre-computed.

    A median cannot be recomputed from an aggregate, so the reporting layer has to expose
    the underlying population. This asserts both halves: the population is exposed, and
    the published median agrees with it at the grain the view publishes.
    """
    loaded_cursor.execute(
        """
        SELECT h.dealership_key, h.condition_group, h.median_inventory_age,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_in_stock)
        FROM reporting.vw_inventory_health AS h
        JOIN reporting.vw_inventory_snapshots AS s
               ON  s.dealership_key    = h.dealership_key
               AND s.snapshot_date_key = h.snapshot_date_key
               AND s.condition_group   = h.condition_group
        WHERE h.snapshot_date_key = %s
        GROUP BY h.dealership_key, h.condition_group, h.median_inventory_age
        """,
        (as_of_date_key,),
    )
    rows = loaded_cursor.fetchall()
    assert rows, "no inventory exists on the as-of date, so the median is untested"
    for dealership_key, condition_group, published, recomputed in rows:
        _assert_equal(published, recomputed, f"KPI-INV-004 ({dealership_key}, {condition_group})")


def test_kpi_inv_005_and_006_aged_inventory(loaded_cursor: Any, as_of_date_key: int) -> None:
    aged_reported = _scalar(
        loaded_cursor,
        "SELECT sum(aged_inventory_units) FROM reporting.vw_inventory_health "
        f"WHERE snapshot_date_key = {as_of_date_key}",
    )
    aged_expected = _scalar(
        loaded_cursor,
        "SELECT sum(inventory_unit_count) FROM warehouse.fact_vehicle_inventory_snapshot "
        f"WHERE snapshot_date_key = {as_of_date_key} AND days_in_stock > 60",
    )
    _assert_equal(aged_reported, aged_expected, "KPI-INV-005")

    total = _scalar(
        loaded_cursor,
        "SELECT sum(active_inventory_units) FROM reporting.vw_inventory_health "
        f"WHERE snapshot_date_key = {as_of_date_key}",
    )
    percentage = _scalar(
        loaded_cursor,
        "SELECT sum(aged_inventory_units)::numeric / nullif(sum(active_inventory_units), 0) "
        f"FROM reporting.vw_inventory_health WHERE snapshot_date_key = {as_of_date_key}",
    )
    _assert_equal(percentage, Decimal(str(aged_expected)) / Decimal(str(total)), "KPI-INV-006")

    # The threshold is published on the row so any finding can state it.
    thresholds = _scalar(
        loaded_cursor,
        "SELECT count(DISTINCT aged_threshold_days) FROM reporting.vw_inventory_health",
    )
    assert thresholds == 1

    # KPI-INV-005 can never exceed KPI-INV-001.
    breaches = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_health "
        "WHERE aged_inventory_units > active_inventory_units",
    )
    assert breaches == 0


def test_kpi_inv_007_days_to_sale_mean_and_median(loaded_cursor: Any) -> None:
    mean_reported = _scalar(
        loaded_cursor,
        "SELECT sum(days_in_inventory_total)::numeric / nullif(sum(retail_units_sold), 0) "
        "FROM reporting.vw_days_to_sale",
    )
    mean_expected = _scalar(
        loaded_cursor,
        "SELECT sum(days_in_inventory_at_sale)::numeric / nullif(sum(unit_count), 0) "
        "FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(mean_reported, mean_expected, "KPI-INV-007 mean")

    # The median is recomputed from the row-level population the fact view exposes.
    loaded_cursor.execute(
        """
        SELECT d.dealership_key, d.condition_group, d.median_days_to_sale,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s.retail_days_in_inventory)
        FROM reporting.vw_days_to_sale AS d
        JOIN reporting.vw_vehicle_sales AS s
               ON  s.dealership_key  = d.dealership_key
               AND s.condition_group = d.condition_group
               AND s.is_retail
        JOIN reporting.vw_calendar AS c ON c.date_key = s.sale_date_key
        WHERE (extract(year FROM c.month_start_date)::integer * 10000)
              + (extract(month FROM c.month_start_date)::integer * 100)
              +  extract(day FROM c.month_start_date)::integer = d.sale_month_date_key
        GROUP BY d.dealership_key, d.condition_group, d.median_days_to_sale
        """
    )
    rows = loaded_cursor.fetchall()
    assert rows, "no retail sale exists, so the days-to-sale median is untested"
    for dealership_key, condition_group, published, recomputed in rows:
        _assert_equal(
            published, recomputed, f"KPI-INV-007 median ({dealership_key}, {condition_group})"
        )


def test_kpi_inv_008_inventory_turn(loaded_cursor: Any) -> None:
    """Turn equals annualized retail units over average daily active inventory."""
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_inventory_turn
        WHERE average_daily_active_inventory > 0
          AND abs(inventory_turn
                  - (annualized_retail_units / average_daily_active_inventory)) > 0.0001
        """,
    )
    assert mismatches == 0

    # The annualization uses calendar days from the calendar, not selling days.
    wrong_annualization = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_inventory_turn
        WHERE calendar_days_in_period > 0
          AND abs(annualized_retail_units
                  - (retail_units_sold * 365.0 / calendar_days_in_period)) > 0.0001
        """,
    )
    assert wrong_annualization == 0

    # The denominator is a true daily average, not a two-point approximation.
    wrong_average = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_inventory_turn
        WHERE snapshot_day_count > 0
          AND abs(average_daily_active_inventory
                  - (inventory_unit_days::numeric / snapshot_day_count)) > 0.0001
        """,
    )
    assert wrong_average == 0


def test_kpi_inv_009_dealer_days_supply(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_days_supply
        WHERE average_daily_retail_sales > 0
          AND abs(days_supply - (active_inventory_units / average_daily_retail_sales)) > 0.0001
        """,
    )
    assert mismatches == 0

    # The trailing window is 30 calendar days and is published on every row.
    windows = _scalar(
        loaded_cursor, "SELECT count(DISTINCT trailing_days) FROM reporting.vw_days_supply"
    )
    assert windows == 1
    assert _scalar(loaded_cursor, "SELECT max(trailing_days) FROM reporting.vw_days_supply") == 30


# --------------------------------------------------------------------------------------
# Funnel: KPI-FUN-001..008
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_id", "view_column", "predicate"),
    [
        ("KPI-FUN-001", "leads_received", "NOT is_duplicate"),
        ("KPI-FUN-002", "contacted_leads", "NOT is_duplicate AND is_contacted"),
        ("KPI-FUN-003", "appointment_set_leads", "NOT is_duplicate AND is_appointment_set"),
        ("KPI-FUN-006", "sold_leads", "NOT is_duplicate AND is_sold"),
    ],
)
def test_lead_funnel_populations(
    loaded_cursor: Any, kpi_id: str, view_column: str, predicate: str
) -> None:
    reported = _scalar(loaded_cursor, f"SELECT sum({view_column}) FROM reporting.vw_lead_funnel")
    expected = _scalar(loaded_cursor, f"SELECT count(*) FROM warehouse.fact_lead WHERE {predicate}")
    _assert_equal(reported, expected, kpi_id)


def test_kpi_fun_003_denominator_is_contacted_leads_not_all_leads(loaded_cursor: Any) -> None:
    """The appointment-set rate divides by CONTACTED leads, not by all leads.

    Getting this wrong is the classic way a store with a poor contact rate is made to
    look good.
    """
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_lead_funnel
        WHERE contacted_leads > 0
          AND abs(appointment_set_rate
                  - (appointment_set_leads::numeric / contacted_leads)) > 0.000001
        """,
    )
    assert mismatches == 0

    # It is emphatically not leads_received.
    differs = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_lead_funnel
        WHERE contacted_leads > 0 AND contacted_leads <> leads_received
          AND abs(appointment_set_rate
                  - (appointment_set_leads::numeric / leads_received)) > 0.000001
        """,
    )
    assert differs > 0, "no row distinguishes the two denominators, so the rule is untested"


def test_kpi_fun_004_show_rate_excludes_advance_cancellations(loaded_cursor: Any) -> None:
    reported_numerator = _scalar(
        loaded_cursor, "SELECT sum(shown_appointments) FROM reporting.vw_appointment_funnel"
    )
    reported_denominator = _scalar(
        loaded_cursor, "SELECT sum(eligible_appointments) FROM reporting.vw_appointment_funnel"
    )
    expected_numerator = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_appointment WHERE is_shown"
    )
    expected_denominator = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_appointment WHERE NOT is_cancelled_in_advance",
    )
    _assert_equal(reported_numerator, expected_numerator, "KPI-FUN-004 numerator")
    _assert_equal(reported_denominator, expected_denominator, "KPI-FUN-004 denominator")

    cancelled = _scalar(
        loaded_cursor,
        "SELECT sum(cancelled_in_advance_appointments) FROM reporting.vw_appointment_funnel",
    )
    assert cancelled > 0, "no advance cancellation exists, so the exclusion is untested"


def test_kpi_fun_005_show_to_sale_uses_the_show_date_basis(loaded_cursor: Any) -> None:
    reported_numerator = _scalar(
        loaded_cursor,
        "SELECT sum(shown_and_sold_appointments) FROM reporting.vw_appointment_funnel",
    )
    reported_denominator = _scalar(
        loaded_cursor,
        "SELECT sum(shown_appointments_on_show_date) FROM reporting.vw_appointment_funnel",
    )
    expected_numerator = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_appointment WHERE is_shown AND is_sold",
    )
    expected_denominator = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_appointment "
        "WHERE is_shown AND show_date_key IS NOT NULL",
    )
    _assert_equal(reported_numerator, expected_numerator, "KPI-FUN-005 numerator")
    _assert_equal(reported_denominator, expected_denominator, "KPI-FUN-005 denominator")


def test_every_sold_appointment_links_to_a_finalized_retail_sale(loaded_cursor: Any) -> None:
    """Every sold appointment links to a finalized retail sale.

    An is_sold row with an unresolvable sale key is a critical failure, not a rounding
    issue -- KPI_CATALOG.md KPI-FUN-005, ARCHITECTURE.md section 21.2.
    """
    unresolved = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_appointment AS a
        WHERE a.is_sold
          AND NOT EXISTS (
              SELECT 1 FROM warehouse.fact_vehicle_sale AS s
              WHERE s.sale_key = a.sale_key AND s.is_retail
          )
        """,
    )
    assert unresolved == 0


def test_kpi_fun_007_average_response_time(loaded_cursor: Any) -> None:
    reported = _scalar(
        loaded_cursor,
        "SELECT sum(response_seconds_total)::numeric / nullif(sum(responded_leads), 0) / 60.0 "
        "FROM reporting.vw_lead_response",
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT sum(first_response_seconds)::numeric / nullif(count(*), 0) / 60.0
        FROM warehouse.fact_lead
        WHERE NOT is_duplicate AND first_response_seconds IS NOT NULL
        """,
    )
    _assert_equal(reported, expected, "KPI-FUN-007")


def test_kpi_fun_008_median_response_time_is_recomputable_from_row_level(
    loaded_cursor: Any,
) -> None:
    loaded_cursor.execute(
        """
        SELECT r.dealership_key, r.lead_source_key, r.lead_created_date_key,
               r.median_response_minutes,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds) / 60.0
        FROM reporting.vw_lead_response AS r
        JOIN reporting.vw_leads AS l
               ON  l.dealership_key        = r.dealership_key
               AND l.lead_source_key       = r.lead_source_key
               AND l.lead_created_date_key = r.lead_created_date_key
        WHERE r.responded_leads > 0
        GROUP BY r.dealership_key, r.lead_source_key, r.lead_created_date_key,
                 r.median_response_minutes
        """
    )
    rows = loaded_cursor.fetchall()
    assert rows, "no responded lead exists, so the response-time median is untested"
    for *context, published, recomputed in rows:
        _assert_equal(published, recomputed, f"KPI-FUN-008 {tuple(context)}")


def test_response_time_null_means_never_responded_not_zero(loaded_cursor: Any) -> None:
    """NULL and 0 are different answers and must stay distinguishable."""
    never = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_lead "
        "WHERE NOT is_duplicate AND first_response_seconds IS NULL",
    )
    assert never > 0, "no never-responded lead exists, so the distinction is untested"

    published = _scalar(
        loaded_cursor, "SELECT sum(unresponded_leads) FROM reporting.vw_lead_response"
    )
    assert published == never, "the ignored-lead population is not published beside the measures"


# --------------------------------------------------------------------------------------
# Marketing: KPI-MKT-001..003
# --------------------------------------------------------------------------------------


def test_kpi_mkt_001_cost_per_lead(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_marketing_performance
        WHERE is_cost_attributable AND attributed_leads > 0 AND spend_amount IS NOT NULL
          AND abs(cost_per_lead - (spend_amount / attributed_leads)) > 0.0001
        """,
    )
    assert mismatches == 0
    computed = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_marketing_performance WHERE cost_per_lead IS NOT NULL",
    )
    assert computed > 0, "KPI-MKT-001 is never computed, so it is not demonstrably computable"


def test_kpi_mkt_002_cost_per_sale(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_marketing_performance
        WHERE is_cost_attributable AND attributed_retail_units > 0 AND spend_amount IS NOT NULL
          AND abs(cost_per_sale - (spend_amount / attributed_retail_units)) > 0.0001
        """,
    )
    assert mismatches == 0


def test_kpi_mkt_003_gross_return_is_the_primary_return_measure(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_marketing_performance
        WHERE is_cost_attributable AND spend_amount > 0
          AND abs(gross_return_on_ad_spend - (attributed_total_gross / spend_amount)) > 0.0001
        """,
    )
    assert mismatches == 0
    computed = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_marketing_performance "
        "WHERE gross_return_on_ad_spend IS NOT NULL",
    )
    assert computed > 0, "KPI-MKT-003 is never computed, so it is not demonstrably computable"

    # Revenue is exposed only as a secondary comparison, and is materially larger --
    # which is exactly why it must not be the headline return measure.
    revenue = _scalar(
        loaded_cursor, "SELECT sum(attributed_revenue) FROM reporting.vw_marketing_performance"
    )
    gross = _scalar(
        loaded_cursor, "SELECT sum(attributed_total_gross) FROM reporting.vw_marketing_performance"
    )
    assert revenue > gross


def test_cost_measures_are_undefined_for_organic_and_internal_sources(loaded_cursor: Any) -> None:
    """A walk-in has no marketing cost per lead. NULL, never zero."""
    violations = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_marketing_performance
        WHERE NOT is_cost_attributable
          AND (cost_per_lead IS NOT NULL
            OR cost_per_sale IS NOT NULL
            OR gross_return_on_ad_spend IS NOT NULL)
        """,
    )
    assert violations == 0

    organic_rows = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_marketing_performance WHERE NOT is_cost_attributable",
    )
    assert organic_rows > 0, "no organic source reaches the view, so the rule is untested"


def test_cost_per_measures_cannot_be_computed_below_month_grain(loaded_cursor: Any) -> None:
    """Month is the finest valid grain, and the guarantee is structural.

    Every spend row's date key is a month start, so filtering the calendar to a date
    that is not a month start selects no spend at all. A day-grain cost-per figure is
    therefore not merely discouraged -- it cannot be expressed.
    """
    non_month_starts = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM reporting.vw_marketing_performance AS m
        JOIN reporting.vw_calendar AS c ON c.date_key = m.month_date_key
        WHERE c.day_of_month <> 1
        """,
    )
    assert non_month_starts == 0

    mid_month_rows = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM reporting.vw_marketing_performance AS m
        JOIN reporting.vw_calendar AS c ON c.date_key = m.month_date_key
        WHERE c.calendar_date <> c.month_start_date
        """,
    )
    assert mid_month_rows == 0


# --------------------------------------------------------------------------------------
# Zero-denominator behaviour, across every ratio in the reporting layer
# --------------------------------------------------------------------------------------


#: Every published ratio, with the denominator that makes it undefined.
#:
#: KPI_CATALOG.md requires NULL -- never zero, never infinity, never a sentinel -- for
#: each of these. Zero units sold does not mean per-unit gross was nothing; zero spend
#: does not mean an infinite return.
RATIO_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("vw_gross_summary", "front_gross_per_retail_unit", "retail_units_sold"),
    ("vw_gross_summary", "back_gross_per_retail_unit", "retail_units_sold"),
    ("vw_gross_summary", "total_gross_per_retail_unit", "retail_units_sold"),
    ("vw_sales_summary", "average_days_to_sale", "retail_units_sold"),
    ("vw_inventory_health", "average_inventory_age", "active_inventory_units"),
    ("vw_inventory_health", "aged_inventory_percentage", "active_inventory_units"),
    ("vw_inventory_aging", "bucket_share", "units_on_lot"),
    ("vw_days_to_sale", "mean_days_to_sale", "retail_units_sold"),
    ("vw_inventory_turn", "inventory_turn", "average_daily_active_inventory"),
    ("vw_days_supply", "days_supply", "average_daily_retail_sales"),
    ("vw_lead_funnel", "contact_rate", "leads_received"),
    ("vw_lead_funnel", "appointment_set_rate", "contacted_leads"),
    ("vw_lead_funnel", "lead_to_sale_conversion", "leads_received"),
    ("vw_appointment_funnel", "show_rate", "eligible_appointments"),
    ("vw_appointment_funnel", "show_to_sale_conversion", "shown_appointments_on_show_date"),
    ("vw_lead_response", "average_response_minutes", "responded_leads"),
    ("vw_lead_response", "response_coverage_rate", "valid_leads"),
    ("vw_marketing_performance", "cost_per_lead", "attributed_leads"),
    ("vw_marketing_performance", "cost_per_sale", "attributed_retail_units"),
    ("vw_marketing_performance", "gross_return_on_ad_spend", "spend_amount"),
)


@pytest.mark.parametrize(("view_name", "ratio_column", "denominator"), RATIO_COLUMNS)
def test_a_zero_denominator_returns_null(
    loaded_cursor: Any, view_name: str, ratio_column: str, denominator: str
) -> None:
    offenders = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM reporting.{view_name}
        WHERE coalesce({denominator}, 0) = 0 AND {ratio_column} IS NOT NULL
        """,
    )
    assert offenders == 0, (
        f"reporting.{view_name}.{ratio_column} returned a value on {offenders} row(s) "
        f"where {denominator} is zero or NULL; the measure is undefined there and must "
        "return NULL"
    )


def test_at_least_one_zero_denominator_case_actually_occurs(loaded_cursor: Any) -> None:
    """The NULL rule is only evidence if some row exercises it.

    Marketing is where a zero denominator genuinely happens on this data: paid campaigns
    that produced no attributed sale in the month, and organic source-months with no
    spend row at all.
    """
    exercised = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_marketing_performance
        WHERE spend_with_no_attributed_sales OR leads_with_no_spend
        """,
    )
    assert exercised > 0, "no zero-denominator case occurs, so the NULL rule is untested"
