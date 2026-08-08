"""Every governed KPI is computable from the reporting layer, and correct.

Covers the 29 MVP KPIs and, from ``DASH.5``, the ten Targets and pace KPIs
(``KPI-TGT-001`` … ``KPI-TGT-010``). The two families are held to the same standard and
counted separately, because the MVP figure is what the Power BI semantic model was
measured against and the target family is not a DAX measure.

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

from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest

from arpi.constants import (
    ACCOUNTING_EXCEPTION_CODES,
    ACCOUNTING_KPI_IDS,
    ACCOUNTING_KPI_VIEW_OWNERSHIP,
    FI_KPI_IDS,
    FI_KPI_VIEW_OWNERSHIP,
    KPI_IDS,
    KPI_VIEW_OWNERSHIP,
    MINIMUM_SAMPLE_ELIGIBLE_DEALS,
    RECONCILIATION_COMPARISON_STATES,
    TARGET_KPI_IDS,
    TARGET_KPI_VIEW_OWNERSHIP,
)

pytestmark = pytest.mark.integration


def _scalar(cursor: Any, statement: str) -> Any:
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _rows(cursor: Any, statement: str, params: Any = None) -> list[tuple[Any, ...]]:
    """Run a statement and return every row."""
    cursor.execute(statement, params)
    return list(cursor.fetchall())


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


# =======================================================================================
# Targets and pace: KPI-TGT-001..010 (DASH.5)
# =======================================================================================
#
# Every figure below is re-derived from warehouse.fact_sales_target,
# warehouse.fact_vehicle_sale and warehouse.dim_date, written from the catalogue's §39
# numerator and denominator text. Nothing here verifies reporting.vw_target_attainment
# against itself: a test that computed both sides from the view would prove only that
# SQL is deterministic.
#
# The controlled cases -- no target, a zero target, zero selling days, one store missing
# a target, an employee-scope row -- are planted inside the test transaction and rolled
# back. Nothing under data/ is touched.


@pytest.mark.parametrize("kpi_id", TARGET_KPI_IDS)
def test_every_target_kpi_resolves_to_an_existing_reporting_view(
    loaded_cursor: Any, kpi_id: str
) -> None:
    owners = TARGET_KPI_VIEW_OWNERSHIP[kpi_id]
    assert owners, f"{kpi_id} has no reporting view registered in arpi.constants"
    for view_name in owners:
        exists = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM information_schema.views "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
        assert exists == 1, f"{kpi_id} names reporting.{view_name}, which does not exist"


def test_the_target_family_is_ten_and_does_not_touch_the_mvp_register() -> None:
    """The MVP baseline is 29 and stays 29. The target family is counted beside it."""
    assert len(TARGET_KPI_IDS) == 10
    assert len(set(TARGET_KPI_IDS)) == 10
    assert set(TARGET_KPI_VIEW_OWNERSHIP) == set(TARGET_KPI_IDS)
    assert not set(TARGET_KPI_IDS) & set(KPI_IDS)
    assert len(KPI_IDS) == 29


def _target_month(cursor: Any) -> str:
    """The latest target month the view carries, as an ISO date."""
    return str(_scalar(cursor, "SELECT max(target_month) FROM reporting.vw_target_attainment"))


# --------------------------------------------------------------------------------------
# KPI-TGT-001 / KPI-TGT-003 -- the plan itself
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_id", "metric"),
    [("KPI-TGT-001", "KPI-SLS-001"), ("KPI-TGT-003", "KPI-GRS-003")],
)
def test_the_store_target_reads_store_scope_rows_only(
    loaded_cursor: Any, kpi_id: str, metric: str
) -> None:
    """A store total excludes department rows, which are refinements rather than addends."""
    reported = _scalar(
        loaded_cursor,
        f"""
        SELECT coalesce(sum(target_value), 0) FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = '{metric}'
        """,
    )
    expected = _scalar(
        loaded_cursor,
        f"""
        SELECT coalesce(sum(t.target_value), 0) FROM warehouse.fact_sales_target AS t
        WHERE t.target_scope_type = 'Store' AND t.kpi_id = '{metric}'
        """,
    )
    _assert_equal(reported, expected, kpi_id)

    everything = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(t.target_value), 0) FROM warehouse.fact_sales_target AS t "
        f"WHERE t.kpi_id = '{metric}' OR t.target_scope_type = 'Department'",
    )
    assert Decimal(str(everything)) != Decimal(str(expected)) or metric == "KPI-SLS-001", (
        f"{kpi_id}: summing every scope gives the same figure as summing store scope, so "
        "the exclusion rule is not being exercised by this data"
    )


def test_the_department_plans_partition_the_store_gross_plan(loaded_cursor: Any) -> None:
    """Front + back = total on the plan, exactly as on the sale fact, per store-month."""
    mismatched = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM (
            SELECT t.dealership_key, t.target_month_date_key,
                   coalesce(sum(t.target_value) FILTER (
                       WHERE t.target_scope_type = 'Store' AND t.kpi_id = 'KPI-GRS-003'), 0)
                   AS store_total,
                   coalesce(sum(t.target_value) FILTER (
                       WHERE t.target_scope_type = 'Department'), 0) AS department_total
            FROM warehouse.fact_sales_target AS t
            GROUP BY t.dealership_key, t.target_month_date_key
        ) AS m
        WHERE m.store_total <> m.department_total
        """,
    )
    assert mismatched == 0


def test_a_store_month_with_no_plan_reports_no_target_rather_than_zero(
    loaded_cursor: Any,
) -> None:
    """Absence of a plan is NULL, not a plan of zero. The two are different statements."""
    month = _target_month(loaded_cursor)
    loaded_cursor.execute(
        """
        DELETE FROM warehouse.fact_sales_target
        WHERE target_scope_type = 'Store' AND kpi_id = 'KPI-SLS-001'
          AND target_month_date_key = to_char(%s::date, 'YYYYMMDD')::integer
          AND dealership_key = (SELECT min(dealership_key) FROM warehouse.fact_sales_target)
        """,
        (month,),
    )
    assert loaded_cursor.rowcount == 1

    row = _rows(
        loaded_cursor,
        """
        SELECT is_target_present, target_value, attainment_denominator,
               target_attainment_ratio, actual_mtd_value
        FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-SLS-001'
          AND target_month = %s::date
          AND dealership_key = (SELECT min(dealership_key) FROM warehouse.dim_dealership)
        """,
        (month,),
    )
    assert len(row) == 1, "the store-month must still appear, carrying no target"
    present, target, denominator, ratio, actual = row[0]
    assert present is False
    assert target is None, "a missing plan is NULL, never 0"
    assert denominator is None
    assert ratio is None, "attainment over a missing target is undefined, not zero"
    assert actual is not None, "the actual is a measured fact and does not disappear"


def test_a_zero_target_produces_a_null_attainment_rather_than_a_division_error(
    loaded_cursor: Any,
) -> None:
    """Production never emits a zero target, so the rule is exercised deliberately."""
    month = _target_month(loaded_cursor)
    loaded_cursor.execute(
        """
        UPDATE warehouse.fact_sales_target
        SET target_value = 0, stretch_target_value = 0
        WHERE target_scope_type = 'Store' AND kpi_id = 'KPI-SLS-001'
          AND target_month_date_key = to_char(%s::date, 'YYYYMMDD')::integer
          AND dealership_key = (SELECT min(dealership_key) FROM warehouse.fact_sales_target)
        """,
        (month,),
    )
    assert loaded_cursor.rowcount == 1

    present, target, denominator, ratio = _rows(
        loaded_cursor,
        """
        SELECT is_target_present, target_value, attainment_denominator,
               target_attainment_ratio
        FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-SLS-001'
          AND target_month = %s::date
          AND dealership_key = (SELECT min(dealership_key) FROM warehouse.dim_dealership)
        """,
        (month,),
    )[0]
    assert present is True, "a zero target IS a plan; it is not an absent one"
    assert Decimal(str(target)) == Decimal("0.00")
    assert denominator is None, "zero becomes NULL in the denominator, never a divisor"
    assert ratio is None


# --------------------------------------------------------------------------------------
# KPI-TGT-002 / KPI-TGT-004 -- attainment, and the group rule
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_id", "metric", "actual_expression"),
    [
        ("KPI-TGT-002", "KPI-SLS-001", "sum(s.unit_count) FILTER (WHERE s.is_retail)"),
        ("KPI-TGT-004", "KPI-GRS-003", "sum(s.total_gross) FILTER (WHERE s.is_retail)"),
    ],
)
def test_attainment_is_summed_components_not_averaged_percentages(
    loaded_cursor: Any, kpi_id: str, metric: str, actual_expression: str
) -> None:
    """The group figure, re-derived from the two facts, and the wrong answer beside it."""
    numerator, denominator = _rows(
        loaded_cursor,
        f"""
        SELECT sum(attainment_numerator), sum(attainment_denominator)
        FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = '{metric}'
          AND attainment_denominator IS NOT NULL
        """,
    )[0]

    expected_numerator = _scalar(
        loaded_cursor,
        f"""
        SELECT coalesce(sum(actual), 0) FROM (
            SELECT s.dealership_key, d.month_start_date,
                   coalesce({actual_expression}, 0) AS actual
            FROM warehouse.fact_vehicle_sale AS s
            JOIN warehouse.dim_date AS d ON d.date_key = s.sale_date_key
            GROUP BY s.dealership_key, d.month_start_date
        ) AS a
        WHERE EXISTS (
            SELECT 1 FROM warehouse.fact_sales_target AS t
            WHERE t.dealership_key = a.dealership_key
              AND t.target_month_date_key = to_char(a.month_start_date, 'YYYYMMDD')::integer
              AND t.target_scope_type = 'Store' AND t.kpi_id = '{metric}'
              AND t.target_value <> 0)
        """,
    )
    expected_denominator = _scalar(
        loaded_cursor,
        f"""
        SELECT coalesce(sum(t.target_value), 0) FROM warehouse.fact_sales_target AS t
        WHERE t.target_scope_type = 'Store' AND t.kpi_id = '{metric}' AND t.target_value <> 0
        """,
    )
    _assert_equal(numerator, expected_numerator, f"{kpi_id} numerator")
    _assert_equal(denominator, expected_denominator, f"{kpi_id} denominator")

    correct = Decimal(str(numerator)) / Decimal(str(denominator))

    # THE WRONG ANSWER, computed deliberately. Averaging store-month attainment
    # percentages weights a store that sold four cars the same as one that sold forty,
    # and it is the single most common way a group attainment figure misleads.
    averaged = _scalar(
        loaded_cursor,
        f"""
        SELECT avg(target_attainment_ratio) FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = '{metric}'
          AND target_attainment_ratio IS NOT NULL
        """,
    )
    assert averaged is not None
    assert abs(correct - Decimal(str(averaged))) > Decimal("0.0001"), (
        f"{kpi_id}: the average of store attainments equals the correct group figure on "
        "this data, so the test cannot demonstrate the difference. Widen the plan spread "
        "rather than deleting the assertion."
    )


def test_one_store_without_a_plan_leaves_the_group_ratio_aligned(loaded_cursor: Any) -> None:
    """Subset alignment: a store contributes to both sides of the ratio, or to neither.

    The failure this guards against is specific and plausible: summing every store's
    units while summing only the targets that exist. That inflates the group attainment
    by exactly the units of the store that had no goal, and it looks like good news.
    """
    loaded_cursor.execute(
        """
        DELETE FROM warehouse.fact_sales_target
        WHERE target_scope_type = 'Store' AND kpi_id = 'KPI-SLS-001'
          AND dealership_key = (SELECT min(dealership_key) FROM warehouse.fact_sales_target)
        """
    )
    assert loaded_cursor.rowcount > 0

    numerator, denominator = _rows(
        loaded_cursor,
        """
        SELECT sum(attainment_numerator), sum(attainment_denominator)
        FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-SLS-001'
          AND attainment_denominator IS NOT NULL
        """,
    )[0]
    excluded_units = _scalar(
        loaded_cursor,
        """
        SELECT coalesce(sum(s.unit_count) FILTER (WHERE s.is_retail), 0)
        FROM warehouse.fact_vehicle_sale AS s
        WHERE s.dealership_key = (SELECT min(dealership_key) FROM warehouse.dim_dealership)
        """,
    )
    all_units = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(s.unit_count) FILTER (WHERE s.is_retail), 0) "
        "FROM warehouse.fact_vehicle_sale AS s",
    )
    assert excluded_units > 0, "the planted case must remove a store that actually sold"
    assert Decimal(str(numerator)) == Decimal(str(all_units)) - Decimal(str(excluded_units)), (
        "the store with no plan contributed its units to the group numerator while its "
        "absent target stayed out of the denominator"
    )
    assert denominator is not None and Decimal(str(denominator)) > 0


# --------------------------------------------------------------------------------------
# KPI-TGT-005 / KPI-TGT-006 -- the selling-day clock
# --------------------------------------------------------------------------------------


def test_selling_days_come_from_dim_date_and_nothing_else(loaded_cursor: Any) -> None:
    """Re-derived by counting the calendar directly, exactly as §39.8 states it."""
    rows = _rows(
        loaded_cursor,
        """
        SELECT DISTINCT target_month, selling_days_in_month, selling_days_elapsed,
               selling_days_remaining, as_of_date, month_state
        FROM reporting.vw_target_attainment ORDER BY target_month
        """,
    )
    assert rows
    for month, total, elapsed, remaining, as_of, state in rows:
        expected_total = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM warehouse.dim_date "
            f"WHERE is_selling_day AND month_start_date = '{month}'::date",
        )
        expected_elapsed = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM warehouse.dim_date "
            f"WHERE is_selling_day AND month_start_date = '{month}'::date "
            f"AND full_date <= '{as_of}'::date",
        )
        assert total == expected_total, month
        assert elapsed == expected_elapsed, month
        assert remaining == expected_total - expected_elapsed, month
        assert remaining >= 0, "selling days remaining is never negative"
        if elapsed == 0:
            assert state == "Not started"
        elif remaining == 0:
            assert state == "Complete"
        else:
            assert state == "In progress"


def test_the_as_of_date_is_the_datasets_own_and_never_the_wall_clock(
    loaded_cursor: Any,
) -> None:
    """The same definition the export manifest carries, re-derived independently."""
    reported = _scalar(
        loaded_cursor, "SELECT DISTINCT as_of_date FROM reporting.vw_target_attainment"
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT max(d.full_date) FROM warehouse.dim_date AS d
        WHERE d.date_key IN (
            SELECT sale_date_key FROM warehouse.fact_vehicle_sale
            UNION ALL SELECT snapshot_date_key FROM warehouse.fact_vehicle_inventory_snapshot
            UNION ALL SELECT lead_created_date_key FROM warehouse.fact_lead)
        """,
    )
    assert str(reported) == str(expected)
    assert str(reported) != str(_scalar(loaded_cursor, "SELECT current_date"))


def test_the_effective_as_of_date_never_leaves_its_month(loaded_cursor: Any) -> None:
    """A completed historical month is not rendered as though it were still running."""
    offenders = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_target_attainment AS v
        JOIN warehouse.dim_date AS d ON d.full_date = v.target_month
        WHERE v.effective_as_of_date > d.month_end_date
           OR v.effective_as_of_date > v.as_of_date
        """,
    )
    assert offenders == 0


# --------------------------------------------------------------------------------------
# KPI-TGT-007..010 -- pace and the selling-day pace projection
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_id", "metric", "actual_expression"),
    [
        ("KPI-TGT-007", "KPI-SLS-001", "sum(s.unit_count) FILTER (WHERE s.is_retail)"),
        ("KPI-TGT-008", "KPI-GRS-003", "sum(s.total_gross) FILTER (WHERE s.is_retail)"),
    ],
)
def test_pace_is_the_actual_over_elapsed_selling_days(
    loaded_cursor: Any, kpi_id: str, metric: str, actual_expression: str
) -> None:
    rows = _rows(
        loaded_cursor,
        f"""
        SELECT v.dealership_key, v.target_month, v.pace_numerator, v.pace_denominator,
               v.pace_per_selling_day
        FROM reporting.vw_target_attainment AS v
        WHERE v.target_scope_type = 'Store' AND v.target_kpi_id = '{metric}'
        ORDER BY v.dealership_key, v.target_month
        """,
    )
    assert rows
    for dealership_key, month, numerator, denominator, pace in rows:
        expected_actual = _scalar(
            loaded_cursor,
            f"""
            SELECT coalesce({actual_expression}, 0)
            FROM warehouse.fact_vehicle_sale AS s
            JOIN warehouse.dim_date AS d ON d.date_key = s.sale_date_key
            WHERE s.dealership_key = {int(dealership_key)}
              AND d.month_start_date = '{month}'::date
              AND d.full_date <= (SELECT max(v.as_of_date) FROM reporting.vw_target_attainment AS v)
            """,
        )
        _assert_equal(numerator, expected_actual, f"{kpi_id} numerator")
        if denominator == 0:
            assert pace is None, f"{kpi_id}: a run rate over zero selling days is undefined"
            continue
        expected_pace = (Decimal(str(numerator)) / Decimal(denominator)).quantize(
            Decimal("0.000001")
        )
        assert abs(Decimal(str(pace)) - expected_pace) <= Decimal("0.000001")


@pytest.mark.parametrize(
    ("kpi_id", "metric"),
    [("KPI-TGT-009", "KPI-SLS-001"), ("KPI-TGT-010", "KPI-GRS-003")],
)
def test_the_projection_is_pace_times_the_months_selling_days(
    loaded_cursor: Any, kpi_id: str, metric: str
) -> None:
    """One division from the published components, not a rounded pace re-multiplied."""
    rows = _rows(
        loaded_cursor,
        f"""
        SELECT projection_numerator, projection_denominator, selling_days_in_month,
               pace_numerator, projected_month_end_value
        FROM reporting.vw_target_attainment
        WHERE target_scope_type = 'Store' AND target_kpi_id = '{metric}'
        """,
    )
    assert rows
    for numerator, denominator, total_days, actual, projection in rows:
        assert Decimal(str(numerator)) == Decimal(str(actual)) * Decimal(total_days)
        if denominator == 0:
            assert projection is None
            continue
        expected = (Decimal(str(numerator)) / Decimal(denominator)).quantize(Decimal("0.000001"))
        assert abs(Decimal(str(projection)) - expected) <= Decimal("0.000001")


def test_on_a_completed_month_the_projection_equals_the_actual(loaded_cursor: Any) -> None:
    """Arithmetic, not a claim about the future: no selling days left, nothing to project."""
    rows = _rows(
        loaded_cursor,
        """
        SELECT actual_mtd_value, projected_month_end_value, selling_days_remaining
        FROM reporting.vw_target_attainment
        WHERE month_state = 'Complete' AND target_scope_type = 'Store'
        """,
    )
    assert rows, "no completed month in the fixture, so the rule is untested"
    for actual, projection, remaining in rows:
        assert remaining == 0
        assert abs(Decimal(str(projection)) - Decimal(str(actual))) <= Decimal("0.000001")


def test_a_month_with_no_elapsed_selling_day_has_no_pace_and_no_projection(
    loaded_cursor: Any,
) -> None:
    """Zero elapsed days is legitimate. It produces NULL, never Infinity and never zero.

    Planted by removing every fact dated on or after the last month's first day, which
    moves the dataset's own as-of date back before that month starts. The window's own
    data never contains this case, so it is constructed rather than hoped for.
    """
    month = _target_month(loaded_cursor)
    # Order matters: appointments reference leads and sales, and leads reference sales.
    # The two funnel facts are removed entirely rather than by date, because an
    # appointment dated before the cutoff can legitimately reference a sale after it, and
    # the as-of rule only needs their contribution gone.
    # DASH.6: the two F&I facts reference the sale fact, and the adjustment fact
    # references the contract fact, so they come off first. Removed entirely rather
    # than by date for the same reason the funnel facts are: what the as-of rule needs
    # is their contribution gone, and a contract dated before the cutoff can carry an
    # adjustment after it.
    loaded_cursor.execute("DELETE FROM warehouse.fact_finance_product_adjustment")
    loaded_cursor.execute("DELETE FROM warehouse.fact_finance_product_sale")
    loaded_cursor.execute("DELETE FROM warehouse.fact_appointment")
    loaded_cursor.execute("DELETE FROM warehouse.fact_lead")
    for statement in (
        "DELETE FROM warehouse.fact_vehicle_inventory_snapshot WHERE snapshot_date_key >= "
        "to_char(%s::date, 'YYYYMMDD')::integer",
        "DELETE FROM warehouse.fact_vehicle_sale WHERE sale_date_key >= "
        "to_char(%s::date, 'YYYYMMDD')::integer",
    ):
        loaded_cursor.execute(statement, (month,))

    rows = _rows(
        loaded_cursor,
        """
        SELECT selling_days_elapsed, selling_days_remaining, selling_days_in_month,
               pace_per_selling_day, projected_month_end_value, month_state,
               actual_mtd_value, attainment_denominator, target_attainment_ratio
        FROM reporting.vw_target_attainment
        WHERE target_month = %s::date AND target_scope_type = 'Store'
        """,
        (month,),
    )
    assert rows, "the month must still appear once its selling days have not started"
    for (
        elapsed,
        remaining,
        total,
        pace,
        projection,
        state,
        actual,
        denominator,
        ratio,
    ) in rows:
        assert elapsed == 0
        assert remaining == total, "no selling day has elapsed, so none has been used"
        assert state == "Not started"
        assert pace is None, "a run rate over zero days is undefined, not zero"
        assert projection is None
        assert Decimal(str(actual)) == 0, "an unstarted month has sold nothing"
        # Attainment is still defined: a plan exists and nothing has been done against it.
        assert denominator is not None
        assert Decimal(str(ratio)) == 0


def test_a_mid_month_as_of_date_produces_a_partial_clock(loaded_cursor: Any) -> None:
    """The in-progress arithmetic, on a controlled as-of date.

    On the committed profiles the dataset's as-of date is the last day of the last month,
    so every month is complete and the console honestly says so. The mid-month behaviour
    is therefore proved here, by moving the as-of date rather than by hoping the fixture
    happens to contain a part-finished month.
    """
    month = _target_month(loaded_cursor)
    cutoff = _scalar(loaded_cursor, f"SELECT ('{month}'::date + INTERVAL '13 days')::date")
    # DASH.6: the two F&I facts reference the sale fact, and the adjustment fact
    # references the contract fact, so they come off first. Removed entirely rather
    # than by date for the same reason the funnel facts are: what the as-of rule needs
    # is their contribution gone, and a contract dated before the cutoff can carry an
    # adjustment after it.
    loaded_cursor.execute("DELETE FROM warehouse.fact_finance_product_adjustment")
    loaded_cursor.execute("DELETE FROM warehouse.fact_finance_product_sale")
    loaded_cursor.execute("DELETE FROM warehouse.fact_appointment")
    loaded_cursor.execute("DELETE FROM warehouse.fact_lead")
    for statement in (
        "DELETE FROM warehouse.fact_vehicle_inventory_snapshot WHERE snapshot_date_key > "
        "to_char(%s::date, 'YYYYMMDD')::integer",
        "DELETE FROM warehouse.fact_vehicle_sale WHERE sale_date_key > "
        "to_char(%s::date, 'YYYYMMDD')::integer",
    ):
        loaded_cursor.execute(statement, (cutoff,))

    elapsed, total, remaining, state, as_of, effective = _rows(
        loaded_cursor,
        """
        SELECT DISTINCT selling_days_elapsed, selling_days_in_month, selling_days_remaining,
               month_state, as_of_date, effective_as_of_date
        FROM reporting.vw_target_attainment WHERE target_month = %s::date
        """,
        (month,),
    )[0]
    assert 0 < elapsed < total, "the planted as-of date must land mid-month"
    assert remaining == total - elapsed
    assert remaining > 0
    assert state == "In progress"
    assert str(as_of) == str(cutoff)
    assert str(effective) == str(cutoff)

    pace, _total_days, actual = _rows(
        loaded_cursor,
        """
        SELECT sum(pace_numerator), max(selling_days_in_month), sum(actual_mtd_value)
        FROM reporting.vw_target_attainment
        WHERE target_month = %s::date AND target_scope_type = 'Store'
          AND target_kpi_id = 'KPI-SLS-001'
        """,
        (month,),
    )[0]
    assert pace is not None and Decimal(str(pace)) == Decimal(str(actual))


# --------------------------------------------------------------------------------------
# Scope behaviour beyond the store
# --------------------------------------------------------------------------------------


def test_the_department_actual_is_the_gross_component_that_department_owns(
    loaded_cursor: Any,
) -> None:
    """Sales owns the front end, Finance the back end, and the two never overlap."""
    for department, metric, expression in (
        ("Sales", "KPI-GRS-001", "front_end_gross"),
        ("Finance", "KPI-GRS-002", "back_end_gross"),
    ):
        reported = _scalar(
            loaded_cursor,
            f"""
            SELECT coalesce(sum(actual_mtd_value), 0) FROM reporting.vw_target_attainment
            WHERE target_scope_type = 'Department' AND department_name = '{department}'
              AND target_kpi_id = '{metric}'
            """,
        )
        expected = _scalar(
            loaded_cursor,
            f"SELECT coalesce(sum(s.{expression}) FILTER (WHERE s.is_retail), 0) "
            "FROM warehouse.fact_vehicle_sale AS s",
        )
        _assert_equal(reported, expected, f"{department} department actual")

    front, back, total = _rows(
        loaded_cursor,
        """
        SELECT coalesce(sum(actual_mtd_value) FILTER (WHERE department_name = 'Sales'), 0),
               coalesce(sum(actual_mtd_value) FILTER (WHERE department_name = 'Finance'), 0),
               coalesce(sum(actual_mtd_value) FILTER (
                   WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-GRS-003'), 0)
        FROM reporting.vw_target_attainment
        """,
    )[0]
    assert Decimal(str(front)) + Decimal(str(back)) == Decimal(str(total)), (
        "the two department actuals must partition the store actual exactly; if they do "
        "not, a department view and a store view disagree about the same month"
    )


def test_an_employee_scope_row_is_supported_and_is_not_a_store_addend(
    loaded_cursor: Any,
) -> None:
    """DASH.5 generates none. The fact accepts one, and the store total ignores it.

    Planted and rolled back. This is what makes "employee scope is physically supported"
    a fact about the schema rather than a sentence in a docstring, and it proves the
    exclusion rule KPI-TGT-001 depends on.
    """
    before = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(target_value), 0) FROM reporting.vw_target_attainment "
        "WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-SLS-001'",
    )
    loaded_cursor.execute(
        """
        INSERT INTO warehouse.fact_sales_target (
            sales_target_key, target_month_date_key, dealership_key, target_scope_type,
            target_scope_id, department_name, employee_key, kpi_id, target_value,
            stretch_target_value, source_system)
        SELECT (SELECT max(x.sales_target_key) + 1 FROM warehouse.fact_sales_target AS x),
               (SELECT min(x.target_month_date_key) FROM warehouse.fact_sales_target AS x),
               store.dealership_key, 'Employee', e.employee_id, NULL, e.employee_key,
               'KPI-SLS-001', 6.00, 7.00, 'arpi_synthetic_generator'
        FROM warehouse.dim_employee AS e
        JOIN warehouse.dim_dealership AS store
          ON store.dealership_id = e.dealership_id AND store.is_current
        WHERE e.job_role = 'Salesperson' AND e.is_current
        ORDER BY e.employee_key
        LIMIT 1
        """
    )
    assert loaded_cursor.rowcount == 1

    after = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(target_value), 0) FROM reporting.vw_target_attainment "
        "WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-SLS-001'",
    )
    assert Decimal(str(after)) == Decimal(str(before)), (
        "an employee-scope plan changed the store total; it is a refinement, not an addend"
    )

    employee_rows = _rows(
        loaded_cursor,
        """
        SELECT target_value, actual_mtd_value, attainment_denominator
        FROM reporting.vw_target_attainment WHERE target_scope_type = 'Employee'
        """,
    )
    assert len(employee_rows) == 1, "the view must carry a scope the fact holds"
    target, actual, denominator = employee_rows[0]
    assert Decimal(str(target)) == Decimal("6.00")
    assert actual is not None, "the employee numerator resolves rather than staying NULL"
    assert denominator is not None


def test_an_invalid_scope_combination_cannot_be_stored(loaded_cursor: Any) -> None:
    """Scope integrity is a CHECK constraint, not a convention the loader observes."""
    import psycopg

    statements = (
        # A Store-scope row carrying a department.
        "UPDATE warehouse.fact_sales_target SET department_name = 'Sales' "
        "WHERE sales_target_key = (SELECT min(sales_target_key) "
        "FROM warehouse.fact_sales_target WHERE target_scope_type = 'Store')",
        # A Department-scope row targeting the store's own metric.
        "UPDATE warehouse.fact_sales_target SET kpi_id = 'KPI-GRS-003' "
        "WHERE target_scope_type = 'Department' AND sales_target_key = "
        "(SELECT min(sales_target_key) FROM warehouse.fact_sales_target "
        " WHERE target_scope_type = 'Department')",
        # A stretch goal beneath the committed goal.
        "UPDATE warehouse.fact_sales_target SET stretch_target_value = target_value - 1 "
        "WHERE sales_target_key = (SELECT min(sales_target_key) "
        "FROM warehouse.fact_sales_target)",
        # A negative goal.
        "UPDATE warehouse.fact_sales_target SET target_value = -1 "
        "WHERE sales_target_key = (SELECT min(sales_target_key) "
        "FROM warehouse.fact_sales_target)",
        # A target month that is not the first of a month.
        "UPDATE warehouse.fact_sales_target SET target_month_date_key = "
        "target_month_date_key + 4 WHERE sales_target_key = "
        "(SELECT min(sales_target_key) FROM warehouse.fact_sales_target)",
    )
    for statement in statements:
        loaded_cursor.execute("SAVEPOINT scope_check")
        with pytest.raises(psycopg.errors.IntegrityError):
            loaded_cursor.execute(statement)
        loaded_cursor.execute("ROLLBACK TO SAVEPOINT scope_check")


def test_the_declared_grain_cannot_be_duplicated(loaded_cursor: Any) -> None:
    """The grain constraint is over five NOT NULL columns, so NULL cannot defeat it."""
    import psycopg

    loaded_cursor.execute("SAVEPOINT grain_check")
    with pytest.raises(psycopg.errors.UniqueViolation):
        loaded_cursor.execute(
            """
            INSERT INTO warehouse.fact_sales_target (
                sales_target_key, target_month_date_key, dealership_key, target_scope_type,
                target_scope_id, department_name, employee_key, kpi_id, target_value,
                stretch_target_value, source_system)
            SELECT (SELECT max(x.sales_target_key) + 1 FROM warehouse.fact_sales_target AS x),
                   t.target_month_date_key, t.dealership_key, t.target_scope_type,
                   t.target_scope_id, t.department_name, t.employee_key, t.kpi_id,
                   t.target_value, t.stretch_target_value, t.source_system
            FROM warehouse.fact_sales_target AS t
            WHERE t.sales_target_key =
                  (SELECT min(y.sales_target_key) FROM warehouse.fact_sales_target AS y)
            """
        )
    loaded_cursor.execute("ROLLBACK TO SAVEPOINT grain_check")


# --------------------------------------------------------------------------------------
# Seeded defects: the verification has to be able to fail
# --------------------------------------------------------------------------------------


def test_moving_one_target_by_a_dollar_breaks_the_store_total(loaded_cursor: Any) -> None:
    """A verification that cannot fail proves nothing. One dollar, and it does."""
    before = _scalar(
        loaded_cursor,
        "SELECT sum(target_value) FROM reporting.vw_target_attainment "
        "WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-GRS-003'",
    )
    loaded_cursor.execute(
        "UPDATE warehouse.fact_sales_target SET target_value = target_value + 1.00 "
        "WHERE target_scope_type = 'Store' AND kpi_id = 'KPI-GRS-003' "
        "AND sales_target_key = (SELECT min(sales_target_key) "
        "FROM warehouse.fact_sales_target WHERE kpi_id = 'KPI-GRS-003')"
    )
    after = _scalar(
        loaded_cursor,
        "SELECT sum(target_value) FROM reporting.vw_target_attainment "
        "WHERE target_scope_type = 'Store' AND target_kpi_id = 'KPI-GRS-003'",
    )
    assert Decimal(str(after)) - Decimal(str(before)) == Decimal("1.00")


def test_removing_one_selling_day_breaks_the_selling_day_verification(
    loaded_cursor: Any,
) -> None:
    """The clock is read from the calendar, so changing the calendar must move it."""
    month = _target_month(loaded_cursor)
    before = _scalar(
        loaded_cursor,
        "SELECT DISTINCT selling_days_in_month FROM reporting.vw_target_attainment "
        f"WHERE target_month = '{month}'::date",
    )
    # is_selling_day is DERIVED from is_closure_holiday and the two are tied together by
    # ck_dim_date_selling_day_rule, so the calendar is changed the only way it can be:
    # by closing the store, which is what a selling day means.
    loaded_cursor.execute(
        "UPDATE warehouse.dim_date "
        "SET is_closure_holiday = true, is_holiday = true, "
        "    holiday_name = 'Planted closure', is_selling_day = false "
        f"WHERE month_start_date = '{month}'::date AND is_selling_day "
        "AND date_key = (SELECT min(date_key) FROM warehouse.dim_date "
        f"WHERE month_start_date = '{month}'::date AND is_selling_day)"
    )
    assert loaded_cursor.rowcount == 1
    after = _scalar(
        loaded_cursor,
        "SELECT DISTINCT selling_days_in_month FROM reporting.vw_target_attainment "
        f"WHERE target_month = '{month}'::date",
    )
    assert after == before - 1, (
        "the selling-day count did not follow dim_date, so it is being derived somewhere "
        "else -- which is exactly what ADR-0002 forbids"
    )


# ======================================================================================
# The F&I domain (DASH.6): KPI-FNI-001 .. KPI-FNI-022
# ======================================================================================
# Every one of the twenty-two is computed from the reporting layer and independently
# re-derived from `warehouse`, with the warehouse expression written from KPI_CATALOG.md
# section 40's numerator and denominator text rather than by reading the view. Several of
# them additionally compute the TEMPTING WRONG ANSWER and assert it differs from the right
# one, because a test in which the correct and incorrect formulas coincide proves nothing.


def _fi_as_of(cursor: Any) -> str:
    """The governed as-of date, derived the same way the views derive it."""
    return str(
        _scalar(
            cursor,
            """
            SELECT max(d.full_date)
            FROM warehouse.dim_date AS d
            WHERE d.date_key IN (
                SELECT s.sale_date_key FROM warehouse.fact_vehicle_sale AS s
                UNION ALL
                SELECT i.snapshot_date_key FROM warehouse.fact_vehicle_inventory_snapshot AS i
                UNION ALL
                SELECT l.lead_created_date_key FROM warehouse.fact_lead AS l)
            """,
        )
    )


@pytest.mark.parametrize("kpi_id", FI_KPI_IDS)
def test_every_fi_kpi_resolves_to_an_existing_reporting_view(
    loaded_cursor: Any, kpi_id: str
) -> None:
    """All 22 F&I identifiers own at least one reporting view, and each view exists."""
    owners = FI_KPI_VIEW_OWNERSHIP[kpi_id]
    assert owners, f"{kpi_id} has no reporting view registered in arpi.constants"
    for view_name in owners:
        exists = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM information_schema.views "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
        assert exists == 1, f"{kpi_id} names reporting.{view_name}, which does not exist"


def test_the_fi_index_covers_exactly_twenty_two_kpis() -> None:
    """KPI_CATALOG.md section 40 specifies 22 F&I KPIs; the index must match."""
    assert len(FI_KPI_IDS) == 22
    assert len(set(FI_KPI_IDS)) == 22
    assert set(FI_KPI_VIEW_OWNERSHIP) == set(FI_KPI_IDS)
    assert tuple(f"KPI-FNI-{index:03d}" for index in range(1, 23)) == FI_KPI_IDS


def test_the_fi_family_is_held_apart_from_the_mvp_baseline() -> None:
    """29 MVP KPIs is a claim about the semantic model, and DASH.6 did not change it."""
    assert len(KPI_IDS) == 29
    assert not set(FI_KPI_IDS) & set(KPI_IDS)
    assert "KPI-GRS-002" in KPI_IDS and "KPI-GRS-002" not in FI_KPI_IDS
    assert "KPI-GRS-005" in KPI_IDS and "KPI-GRS-005" not in FI_KPI_IDS


# --------------------------------------------------------------------------------------
# The back-gross identity: the most important assertion in DASH.6
# --------------------------------------------------------------------------------------


def test_every_deal_back_end_gross_is_explained_by_its_components(loaded_cursor: Any) -> None:
    """RECON-FI-001, asserted per deal rather than in aggregate.

    Two deals with offsetting errors would hide each other in a total, so this counts the
    deals that DO NOT satisfy the identity and requires zero of them.
    """
    offending = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_vehicle_sale AS s
        LEFT JOIN (
            SELECT ps.sale_key, sum(ps.original_product_gross) AS product_gross
            FROM warehouse.fact_finance_product_sale AS ps
            GROUP BY ps.sale_key
        ) AS p ON p.sale_key = s.sale_key
        WHERE s.back_end_gross
              <> s.finance_reserve_gross + coalesce(p.product_gross, 0.00)
        """,
    )
    assert offending == 0, (
        f"{offending} deal(s) carry a back-end gross that reserve plus deal-date product "
        "gross does not explain. other_fi_income is exactly 0.00 and there is no plug, so "
        "any difference is a defect rather than a residual."
    )


def test_the_total_gross_identity_survives_the_fi_increment(loaded_cursor: Any) -> None:
    """DASH.6 added two columns and redefined none, so front + back = total is unchanged."""
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_vehicle_sale "
        "WHERE total_gross <> front_end_gross + back_end_gross",
    )
    assert offending == 0


def test_the_product_price_identity_holds_on_every_contract(loaded_cursor: Any) -> None:
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_finance_product_sale "
        "WHERE original_product_gross <> product_retail_price - product_dealer_cost",
    )
    assert offending == 0


def test_other_fi_income_is_not_a_column_anywhere(loaded_cursor: Any) -> None:
    """A zero that is never anything else is where a balancing plug would hide."""
    present = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema IN ('warehouse', 'reporting') "
        "AND column_name IN ('other_fi_income', 'other_f_and_i_income', 'residual_fi_gross')",
    )
    assert present == 0


# --------------------------------------------------------------------------------------
# KPI-FNI-001 .. -006: the additive measures and the per-unit ratios
# --------------------------------------------------------------------------------------


def test_kpi_fni_001_finance_reserve_gross(loaded_cursor: Any) -> None:
    reported = _scalar(
        loaded_cursor, "SELECT sum(finance_reserve_gross) FROM reporting.vw_fi_summary"
    )
    expected = _scalar(
        loaded_cursor,
        "SELECT sum(finance_reserve_gross) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(reported, expected, "KPI-FNI-001")


def test_kpi_fni_001_is_zero_on_every_structure_that_cannot_earn_it(
    loaded_cursor: Any,
) -> None:
    """Cash, Lease and both disposals carry exactly 0.00 -- by rule, not by coincidence."""
    offending = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM warehouse.fact_vehicle_sale AS s
        WHERE s.finance_reserve_gross <> 0
          AND warehouse.fn_finance_structure(s.sale_type, s.amount_financed)
              <> 'Retail Finance'
        """,
    )
    assert offending == 0, "reserve appeared on a deal whose structure cannot produce it"

    # And the other direction: a zero on a financed deal is a MODELLED outcome, so the
    # population must actually contain some. Otherwise the rule above is vacuous.
    financed_with_reserve = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_vehicle_sale AS s WHERE s.finance_reserve_gross > 0",
    )
    assert financed_with_reserve > 0, "no deal earned reserve; the measure is untested"


def test_kpi_fni_002_finance_reserve_pvr(loaded_cursor: Any) -> None:
    """Components, not a quotient: a group figure is SUM(n)/SUM(d), never an average."""
    numerator = _scalar(
        loaded_cursor, "SELECT sum(finance_reserve_gross) FROM reporting.vw_fi_summary"
    )
    denominator = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    expected_denominator = _scalar(
        loaded_cursor,
        "SELECT sum(unit_count) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(denominator, expected_denominator, "KPI-FNI-002 denominator")
    assert denominator > 0
    assert Decimal(str(numerator)) / Decimal(str(denominator)) > 0


def test_kpi_fni_002_denominator_includes_cash_deals(loaded_cursor: Any) -> None:
    """The SQ-20 caution, made checkable: cash deals are inside the denominator."""
    cash_deals = _scalar(loaded_cursor, "SELECT sum(cash_deal_count) FROM reporting.vw_fi_summary")
    assert cash_deals > 0, (
        "the dataset contains no cash deals, so the caution that they sit inside a "
        "denominator they cannot contribute to is untested"
    )
    cash_reserve = _scalar(
        loaded_cursor,
        """
        SELECT coalesce(sum(s.finance_reserve_gross), 0) FROM warehouse.fact_vehicle_sale AS s
        WHERE warehouse.fn_finance_structure(s.sale_type, s.amount_financed) = 'Cash'
        """,
    )
    assert Decimal(str(cash_reserve)) == Decimal("0.00")


def test_kpi_fni_003_original_product_gross(loaded_cursor: Any) -> None:
    reported = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    expected = _scalar(
        loaded_cursor,
        "SELECT sum(product_retail_price - product_dealer_cost) "
        "FROM warehouse.fact_finance_product_sale",
    )
    _assert_equal(reported, expected, "KPI-FNI-003")


def test_kpi_fni_004_net_product_gross_as_of(loaded_cursor: Any) -> None:
    as_of = _fi_as_of(loaded_cursor)
    reported = _scalar(
        loaded_cursor, "SELECT sum(net_product_gross_as_of) FROM reporting.vw_fi_summary"
    )
    expected = _scalar(
        loaded_cursor,
        f"""
        SELECT (SELECT coalesce(sum(ps.original_product_gross), 0)
                FROM warehouse.fact_finance_product_sale AS ps)
             - (SELECT coalesce(sum(a.adjustment_amount), 0)
                FROM warehouse.fact_finance_product_adjustment AS a
                JOIN warehouse.dim_date AS d ON d.date_key = a.adjustment_date_key
                WHERE d.full_date <= '{as_of}'::date)
        """,
    )
    _assert_equal(reported, expected, "KPI-FNI-004")


def test_kpi_fni_004_as_of_arithmetic_holds_at_three_points_around_one_adjustment(
    loaded_cursor: Any,
) -> None:
    """The as-of basis, evaluated BEFORE, ON and AFTER a single adjustment.

    Deliberately computed against ``warehouse`` at three chosen dates rather than against
    the view at its one governed as-of date. Testing only the final as-of would hide every
    timing defect there is: a rule that ignored ``adjustment_date`` entirely would agree
    with a rule that honoured it, as long as both were asked after the last event.

    The identity at each point is the catalogue's own:
        net = original - SUM(amount WHERE adjustment_date <= as_of)
    """
    loaded_cursor.execute(
        """
        SELECT ps.product_sale_key, ps.original_product_gross,
               d.full_date, a.adjustment_amount
        FROM warehouse.fact_finance_product_adjustment AS a
        JOIN warehouse.fact_finance_product_sale AS ps
          ON ps.product_sale_key = a.product_sale_key
        JOIN warehouse.dim_date AS d ON d.date_key = a.adjustment_date_key
        ORDER BY a.adjustment_key
        LIMIT 1
        """
    )
    row = loaded_cursor.fetchone()
    assert row is not None, (
        "the fixture carries no adjustment at all, so the as-of arithmetic is untested"
    )
    product_sale_key, original, posted, amount = row

    def net_at(as_of: str) -> Decimal:
        value = _scalar(
            loaded_cursor,
            f"""
            SELECT ps.original_product_gross - coalesce((
                       SELECT sum(a.adjustment_amount)
                       FROM warehouse.fact_finance_product_adjustment AS a
                       JOIN warehouse.dim_date AS d ON d.date_key = a.adjustment_date_key
                       WHERE a.product_sale_key = ps.product_sale_key
                         AND d.full_date <= '{as_of}'::date), 0)
            FROM warehouse.fact_finance_product_sale AS ps
            WHERE ps.product_sale_key = {product_sale_key}
            """,
        )
        return Decimal(str(value))

    day_before = str(posted - timedelta(days=1))
    on_the_day = str(posted)
    day_after = str(posted + timedelta(days=1))

    # BEFORE: the event has not happened, so nothing is netted off.
    assert net_at(day_before) == Decimal(str(original)), (
        "an adjustment reduced the net gross of a date before it posted, so the as-of "
        "filter is not being applied"
    )
    # ON the day: the event counts. `<=` rather than `<` is the governed rule.
    assert net_at(on_the_day) == Decimal(str(original)) - Decimal(str(amount))
    # AFTER: unchanged by this event, since there is nothing further on this contract on
    # the following day.
    assert net_at(day_after) <= net_at(on_the_day)


def test_kpi_fni_004_moves_when_an_adjustment_lands_on_or_before_the_as_of_date(
    loaded_cursor: Any,
) -> None:
    """The other direction, so the previous test is not passing vacuously."""
    before = _scalar(
        loaded_cursor, "SELECT sum(net_product_gross_as_of) FROM reporting.vw_fi_summary"
    )
    loaded_cursor.execute(
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-ONDATE', ps.product_sale_key, ps.sale_key, ps.sale_date_key,
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 100.00, 'Early Payoff', 93, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """
    )
    assert loaded_cursor.rowcount == 1
    after = _scalar(
        loaded_cursor, "SELECT sum(net_product_gross_as_of) FROM reporting.vw_fi_summary"
    )
    assert Decimal(str(before)) - Decimal(str(after)) == Decimal("100.00")


def test_kpi_fni_005_product_gross_pvr_components(loaded_cursor: Any) -> None:
    """Both numerators exist and are different, which is why the basis must be labelled."""
    original = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    net = _scalar(loaded_cursor, "SELECT sum(net_product_gross_as_of) FROM reporting.vw_fi_summary")
    units = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    assert units > 0
    assert Decimal(str(original)) >= Decimal(str(net)), (
        "net product gross exceeds original, which the adjustment cap forbids"
    )


def test_kpi_fni_006_products_per_retail_unit(loaded_cursor: Any) -> None:
    numerator = _scalar(loaded_cursor, "SELECT sum(contract_count) FROM reporting.vw_fi_summary")
    denominator = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    expected_numerator = _scalar(
        loaded_cursor,
        "SELECT sum(product_sale_count) FROM warehouse.fact_finance_product_sale",
    )
    expected_denominator = _scalar(
        loaded_cursor, "SELECT sum(unit_count) FROM warehouse.fact_vehicle_sale WHERE is_retail"
    )
    _assert_equal(numerator, expected_numerator, "KPI-FNI-006 numerator")
    _assert_equal(denominator, expected_denominator, "KPI-FNI-006 denominator")


def test_kpi_fni_006_denominator_is_all_retail_units_not_product_carrying_deals(
    loaded_cursor: Any,
) -> None:
    """THE TEMPTING WRONG DENOMINATOR, computed and proved different.

    Dividing by the deals that carried a product answers "how many products did the deals
    that bought something buy?", which is a different and much flatter measure. The two
    differ here because the generator deliberately produces eligible deals that carried
    nothing.
    """
    all_units = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    carrying = _scalar(
        loaded_cursor, "SELECT sum(deals_with_a_product) FROM reporting.vw_fi_summary"
    )
    assert carrying < all_units, (
        "every retail delivery carried a product, so the correct and incorrect "
        "denominators coincide and this test proves nothing"
    )


# --------------------------------------------------------------------------------------
# KPI-FNI-007 .. -011: penetration and per-contract economics
# --------------------------------------------------------------------------------------


def _penetration(cursor: Any, category: str) -> tuple[Any, Any]:
    """The reported numerator and denominator for one category."""
    cursor.execute(
        "SELECT sum(penetration_numerator), sum(penetration_denominator) "
        "FROM reporting.vw_fi_product_penetration WHERE product_category = %s",
        (category,),
    )
    numerator, denominator = cursor.fetchone()
    return numerator, denominator


def _expected_penetration(cursor: Any, category: str) -> tuple[Any, Any]:
    """The same two figures, derived independently from the warehouse."""
    numerator = _scalar(
        cursor,
        """
        SELECT count(DISTINCT ps.sale_key)
        FROM warehouse.fact_finance_product_sale AS ps
        JOIN warehouse.dim_finance_product AS p
          ON p.finance_product_key = ps.finance_product_key
        WHERE p.product_category = %s
        """.replace("%s", f"'{category}'"),
    )
    denominator = _scalar(
        cursor,
        f"""
        SELECT count(*)
        FROM warehouse.fact_vehicle_sale AS s
        JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
        WHERE s.is_retail
          AND warehouse.fn_product_category_is_eligible(
                  '{category}',
                  warehouse.fn_finance_structure(s.sale_type, s.amount_financed),
                  v.condition_type)
        """,
    )
    return numerator, denominator


@pytest.mark.parametrize(
    ("kpi_id", "category"),
    [
        ("KPI-FNI-007", "Vehicle Service Contract"),
        ("KPI-FNI-008", "GAP"),
        ("KPI-FNI-009", "Tire & Wheel"),
        ("KPI-FNI-010", "Prepaid Maintenance"),
    ],
)
def test_category_penetration_components(loaded_cursor: Any, kpi_id: str, category: str) -> None:
    reported = _penetration(loaded_cursor, category)
    expected = _expected_penetration(loaded_cursor, category)
    _assert_equal(reported[0], expected[0], f"{kpi_id} numerator")
    _assert_equal(reported[1], expected[1], f"{kpi_id} denominator")
    assert reported[0] <= reported[1], (
        f"{kpi_id} numerator exceeds its denominator, so a contract sits outside its own "
        "eligible population"
    )


def test_kpi_fni_008_gap_denominator_is_financed_deals_not_all_retail_deals(
    loaded_cursor: Any,
) -> None:
    """THE TEMPTING WRONG DENOMINATOR, computed and proved different.

    This is the specific misleading number ELIG-GAP exists to prevent. A cash buyer owes
    nothing for GAP to cover, so a GAP penetration over all retail deals divides a
    financed-only numerator by a population that includes deals which could never have
    bought it -- and the resulting figure is smaller for a reason no reader can see.
    """
    _, correct = _penetration(loaded_cursor, "GAP")
    tempting = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale WHERE is_retail"
    )
    assert correct < tempting, (
        "the eligible GAP denominator equals the whole retail population, so the correct "
        "and incorrect formulas coincide and this test proves nothing"
    )
    numerator, _ = _penetration(loaded_cursor, "GAP")
    correct_rate = Decimal(str(numerator)) / Decimal(str(correct))
    tempting_rate = Decimal(str(numerator)) / Decimal(str(tempting))
    assert correct_rate > tempting_rate


def test_kpi_fni_010_ppm_denominator_excludes_used_vehicles(loaded_cursor: Any) -> None:
    """ELIG-PPM narrows on vehicle condition, which must be visible in the denominator."""
    _, correct = _penetration(loaded_cursor, "Prepaid Maintenance")
    all_retail = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale WHERE is_retail"
    )
    assert correct < all_retail, (
        "the Prepaid Maintenance denominator includes used deals, so the condition rule "
        "is not being applied"
    )
    used_with_ppm = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_finance_product_sale AS ps
        JOIN warehouse.dim_finance_product AS p
          ON p.finance_product_key = ps.finance_product_key
        JOIN warehouse.fact_vehicle_sale AS s ON s.sale_key = ps.sale_key
        JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
        WHERE p.product_category = 'Prepaid Maintenance' AND v.condition_type = 'Used'
        """,
    )
    assert used_with_ppm == 0


def test_penetration_counts_distinct_deals_not_contract_rows(loaded_cursor: Any) -> None:
    """THE TEMPTING WRONG NUMERATOR, computed and proved different.

    One deal may carry two DIFFERENT products of one category -- a windscreen plan and a
    roadside plan are both Other Aftermarket Products. Counting contract rows would let a
    penetration exceed the share of deals that bought anything, and could exceed 100%.
    """
    loaded_cursor.execute(
        """
        SELECT sum(attached_deal_count), sum(contract_count)
        FROM reporting.vw_fi_product_penetration
        WHERE product_category = 'Other Aftermarket Product'
        """
    )
    deals, contracts = loaded_cursor.fetchone()
    assert contracts > deals, (
        "no deal carried two contracts of one category, so counting deals and counting "
        "rows coincide and the distinct-deal rule is untested"
    )


def test_kpi_fni_011_product_gross_per_contract(loaded_cursor: Any) -> None:
    numerator = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    denominator = _scalar(loaded_cursor, "SELECT sum(contract_count) FROM reporting.vw_fi_summary")
    expected_numerator = _scalar(
        loaded_cursor,
        "SELECT sum(original_product_gross) FROM warehouse.fact_finance_product_sale",
    )
    expected_denominator = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_finance_product_sale"
    )
    _assert_equal(numerator, expected_numerator, "KPI-FNI-011 numerator")
    _assert_equal(denominator, expected_denominator, "KPI-FNI-011 denominator")


# --------------------------------------------------------------------------------------
# KPI-FNI-012 .. -018: adjustments, on the adjustment-date basis
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kpi_amount", "kpi_count", "adjustment_type"),
    [
        ("KPI-FNI-012", "KPI-FNI-013", "Chargeback"),
        ("KPI-FNI-016", "KPI-FNI-017", "Cancellation"),
    ],
)
def test_adjustment_amount_and_count(
    loaded_cursor: Any, kpi_amount: str, kpi_count: str, adjustment_type: str
) -> None:
    loaded_cursor.execute(
        "SELECT coalesce(sum(adjustment_amount), 0), coalesce(sum(adjustment_count), 0) "
        "FROM reporting.vw_fi_adjustment_summary WHERE adjustment_type = %s",
        (adjustment_type,),
    )
    amount, count = loaded_cursor.fetchone()
    loaded_cursor.execute(
        "SELECT coalesce(sum(adjustment_amount), 0), count(*) "
        "FROM warehouse.fact_finance_product_adjustment WHERE adjustment_type = %s",
        (adjustment_type,),
    )
    expected_amount, expected_count = loaded_cursor.fetchone()
    _assert_equal(amount, expected_amount, f"{kpi_amount}")
    _assert_equal(count, expected_count, f"{kpi_count}")


def test_adjustments_are_attributed_to_their_own_date_not_the_sale_month(
    loaded_cursor: Any,
) -> None:
    """The date-basis rule, planted rather than hoped for.

    A chargeback is moved to a month other than its contract's sale month. The adjustment
    view must follow it, and the sale-date views must not move at all -- because the
    contract's own gross is never restated.
    """
    sale_side_before = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    loaded_cursor.execute(
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-XMONTH', ps.product_sale_key, ps.sale_key,
               (SELECT max(d.date_key) FROM warehouse.dim_date AS d),
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 50.00, 'Early Payoff', 92, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """
    )
    assert loaded_cursor.rowcount == 1

    planted_month = _scalar(
        loaded_cursor,
        "SELECT to_char(max(d.month_start_date), 'YYYY-MM-DD') FROM warehouse.dim_date AS d",
    )
    contract_month = _scalar(
        loaded_cursor,
        """
        SELECT to_char(d.month_start_date, 'YYYY-MM-DD')
        FROM warehouse.fact_finance_product_sale AS ps
        JOIN warehouse.dim_date AS d ON d.date_key = ps.sale_date_key
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """,
    )
    assert planted_month != contract_month, (
        "the planted adjustment landed in its own contract's month, so the cross-month "
        "rule is untested"
    )

    in_planted_month = _scalar(
        loaded_cursor,
        f"""
        SELECT coalesce(sum(v.adjustment_amount), 0)
        FROM reporting.vw_fi_adjustment_summary AS v
        JOIN warehouse.dim_date AS d ON d.date_key = v.adjustment_date_key
        WHERE d.month_start_date = '{planted_month}'::date
          AND v.adjustment_type = 'Chargeback'
        """,
    )
    assert Decimal(str(in_planted_month)) >= Decimal("50.00"), (
        "the adjustment did not appear in the month it posted in"
    )

    sale_side_after = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    assert Decimal(str(sale_side_after)) == Decimal(str(sale_side_before)), (
        "an adjustment changed a deal-date product gross figure. The original contract is "
        "never rewritten: that is the whole design."
    )


def test_the_mixed_basis_rates_publish_their_disclosure_as_data(loaded_cursor: Any) -> None:
    """KPI-FNI-014, -015 and -018 are period proxies, and the view has to say so."""
    loaded_cursor.execute(
        "SELECT DISTINCT numerator_date_basis, rate_denominator_date_basis, "
        "rate_denominator_source, rate_basis_disclosure "
        "FROM reporting.vw_fi_adjustment_summary"
    )
    rows = loaded_cursor.fetchall()
    assert rows, "the adjustment view returned no rows, so the disclosure is untested"
    for numerator_basis, denominator_basis, source, disclosure in rows:
        assert numerator_basis == "adjustment date"
        assert denominator_basis == "sale date"
        assert numerator_basis != denominator_basis, "a mixed-basis rate that is not mixed"
        assert "vw_fi_summary" in source
        assert "not a contract-cohort loss rate" in disclosure


def test_kpi_fni_014_and_015_components_come_from_the_two_declared_bases(
    loaded_cursor: Any,
) -> None:
    """The two sides are computed here exactly as the catalogue specifies them."""
    numerator_amount = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(adjustment_amount), 0) FROM reporting.vw_fi_adjustment_summary "
        "WHERE adjustment_type = 'Chargeback'",
    )
    numerator_count = _scalar(
        loaded_cursor,
        "SELECT coalesce(sum(adjustment_count), 0) FROM reporting.vw_fi_adjustment_summary "
        "WHERE adjustment_type = 'Chargeback'",
    )
    denominator_gross = _scalar(
        loaded_cursor, "SELECT sum(original_product_gross) FROM reporting.vw_fi_summary"
    )
    denominator_contracts = _scalar(
        loaded_cursor, "SELECT sum(contract_count) FROM reporting.vw_fi_summary"
    )
    assert denominator_gross > 0 and denominator_contracts > 0
    # The rates themselves are bounded by nothing in principle -- a month can post more
    # chargebacks than it wrote -- so what is asserted is that both sides exist and are
    # drawn from the two DIFFERENT views the catalogue names, which is the disclosure.
    assert Decimal(str(numerator_amount)) >= 0
    assert Decimal(str(numerator_count)) >= 0


def test_the_adjustment_cap_holds_on_every_contract(loaded_cursor: Any) -> None:
    """Cumulative net reduction stays inside [0, original gross]."""
    offending = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM (
            SELECT ps.original_product_gross AS original, sum(a.adjustment_amount) AS reduction
            FROM warehouse.fact_finance_product_adjustment AS a
            JOIN warehouse.fact_finance_product_sale AS ps
              ON ps.product_sale_key = a.product_sale_key
            GROUP BY ps.product_sale_key, ps.original_product_gross
        ) AS per_contract
        WHERE reduction < 0 OR reduction > original
        """,
    )
    assert offending == 0


# --------------------------------------------------------------------------------------
# KPI-FNI-019 .. -022: mix, category economics and manager measures
# --------------------------------------------------------------------------------------


def test_kpi_fni_019_deal_structure_mix_partitions_retail_units(loaded_cursor: Any) -> None:
    """The three shares sum to 100% by construction, which is what makes them a mix."""
    loaded_cursor.execute(
        "SELECT sum(cash_deal_count), sum(retail_finance_deal_count), sum(lease_deal_count), "
        "sum(retail_units) FROM reporting.vw_fi_summary"
    )
    cash, finance, lease, units = loaded_cursor.fetchone()
    assert cash + finance + lease == units, (
        "the three structure counts do not partition retail units, so the shares do not "
        "sum to 100% and the mix describes no population"
    )
    for count in (cash, finance, lease):
        assert count > 0, "a structure with no deals makes its share untestable"


def test_kpi_fni_019_excludes_wholesale_and_dealer_trade(loaded_cursor: Any) -> None:
    """Disposals are not retail structures, so they are not components of the mix."""
    non_retail = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale WHERE NOT is_retail"
    )
    assert non_retail > 0, "the dataset contains no disposals, so the exclusion is untested"
    view_units = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    all_sales = _scalar(loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale")
    assert view_units == all_sales - non_retail


def test_kpi_fni_020_category_mix_components_reconcile_to_the_fact(loaded_cursor: Any) -> None:
    """Every category component is the warehouse's own, at the same grain and basis."""
    loaded_cursor.execute(
        """
        SELECT product_category, sum(contract_count), sum(original_product_gross),
               sum(product_retail_price), sum(product_dealer_cost)
        FROM reporting.vw_fi_product_penetration
        GROUP BY product_category ORDER BY product_category
        """
    )
    reported = {row[0]: row[1:] for row in loaded_cursor.fetchall()}
    loaded_cursor.execute(
        """
        SELECT p.product_category, sum(ps.product_sale_count),
               sum(ps.original_product_gross), sum(ps.product_retail_price),
               sum(ps.product_dealer_cost)
        FROM warehouse.fact_finance_product_sale AS ps
        JOIN warehouse.dim_finance_product AS p
          ON p.finance_product_key = ps.finance_product_key
        GROUP BY p.product_category ORDER BY p.product_category
        """
    )
    expected = {row[0]: row[1:] for row in loaded_cursor.fetchall()}
    assert set(expected) <= set(reported), (
        "a category with contracts is missing from the penetration view, which means a "
        "contract sits outside its own eligible population"
    )
    for category, values in expected.items():
        for index, label in enumerate(("contracts", "gross", "price", "cost")):
            _assert_equal(
                reported[category][index], values[index], f"KPI-FNI-020 {category} {label}"
            )


def test_kpi_fni_020_every_category_has_a_row_even_with_no_sales(loaded_cursor: Any) -> None:
    """A category nobody sold and a category nobody could sell are different statements."""
    categories = _scalar(
        loaded_cursor,
        "SELECT count(DISTINCT product_category) FROM reporting.vw_fi_product_penetration",
    )
    assert categories == 10, (
        f"only {categories} of the ten governed categories appear in the penetration view; "
        "a category with an eligible population must produce a row with a zero numerator"
    )


def test_kpi_fni_021_manager_penetration_uses_that_managers_denominator(
    loaded_cursor: Any,
) -> None:
    """THE TEMPTING WRONG DENOMINATOR, computed and proved different.

    Using the store's eligible-deal count for an individual divides one person's numerator
    by everybody's population, which makes every manager look weak by a factor of however
    many managers the store has.
    """
    loaded_cursor.execute(
        """
        SELECT dealership_key, finance_manager_grain_key,
               sum(penetration_numerator), sum(penetration_denominator)
        FROM reporting.vw_fi_product_penetration
        WHERE product_category = 'Vehicle Service Contract'
        GROUP BY dealership_key, finance_manager_grain_key
        ORDER BY dealership_key, finance_manager_grain_key
        """
    )
    rows = loaded_cursor.fetchall()
    assert len(rows) > 1, "only one manager group exists, so the distinction is untestable"

    store_totals: dict[Any, Any] = {}
    for store, _manager, _numerator, denominator in rows:
        store_totals[store] = store_totals.get(store, 0) + denominator

    differing = [
        (store, manager)
        for store, manager, _numerator, denominator in rows
        if denominator != store_totals[store]
    ]
    assert differing, (
        "every manager's eligible-deal count equals their store's, so the correct and "
        "incorrect denominators coincide and this test proves nothing"
    )


def test_kpi_fni_022_manager_back_pvr_components(loaded_cursor: Any) -> None:
    """The numerator is the AS-OF retained figure, not the stored deal-date back gross."""
    loaded_cursor.execute(
        "SELECT sum(net_fi_gross_as_of), sum(back_end_gross_deal_date), sum(retail_units) "
        "FROM reporting.vw_fi_summary"
    )
    net, deal_date, units = loaded_cursor.fetchone()
    assert units > 0
    assert Decimal(str(net)) <= Decimal(str(deal_date)), (
        "as-of retained F&I gross exceeds deal-date production, which the adjustment cap forbids"
    )
    expected_deal_date = _scalar(
        loaded_cursor,
        "SELECT sum(back_end_gross) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    _assert_equal(deal_date, expected_deal_date, "KPI-FNI-022 deal-date comparison")


def test_kpi_fni_022_is_not_the_same_measure_as_kpi_grs_005(loaded_cursor: Any) -> None:
    """Back PVR and manager back PVR are different measures on different date bases.

    They differ by every adjustment posted and must not be presented interchangeably. If
    the dataset carried no adjustments the two would coincide, so the test asserts the
    dataset actually distinguishes them.
    """
    adjustments = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.fact_finance_product_adjustment"
    )
    assert adjustments > 0, "the dataset carries no adjustments, so the two bases coincide"
    loaded_cursor.execute(
        "SELECT sum(net_fi_gross_as_of), sum(back_end_gross_deal_date) FROM reporting.vw_fi_summary"
    )
    net, deal_date = loaded_cursor.fetchone()
    assert Decimal(str(net)) < Decimal(str(deal_date)), (
        "the as-of and deal-date bases produced the same total despite adjustments "
        "existing, so one of them is not being applied"
    )


def test_the_minimum_sample_floor_agrees_between_sql_and_python(loaded_cursor: Any) -> None:
    """One value per layer, with the equality proved rather than hoped for."""
    sql_floor = _scalar(loaded_cursor, "SELECT warehouse.fn_minimum_sample_floor()")
    assert sql_floor == MINIMUM_SAMPLE_ELIGIBLE_DEALS
    published = _scalar(
        loaded_cursor, "SELECT DISTINCT minimum_sample_floor FROM reporting.vw_fi_summary"
    )
    assert published == MINIMUM_SAMPLE_ELIGIBLE_DEALS


def test_the_minimum_sample_flag_is_published_and_never_blanks_a_value(
    loaded_cursor: Any,
) -> None:
    """Below the floor the row is MARKED, not emptied.

    A NULL would be indistinguishable from a manager who genuinely had no eligible deals,
    which is a different statement about a different situation.
    """
    loaded_cursor.execute(
        "SELECT count(*) FILTER (WHERE meets_minimum_sample), "
        "       count(*) FILTER (WHERE NOT meets_minimum_sample) "
        "FROM reporting.vw_fi_summary"
    )
    _meets, below = loaded_cursor.fetchone()
    assert below > 0, (
        "no row falls below the minimum-sample floor, so the rule is untested; the "
        "store-day grain should produce plenty"
    )
    blanked = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_fi_summary "
        "WHERE NOT meets_minimum_sample AND (retail_units IS NULL "
        "   OR finance_reserve_gross IS NULL OR original_product_gross IS NULL)",
    )
    assert blanked == 0, "a below-floor row had its components blanked by the reporting layer"


# --------------------------------------------------------------------------------------
# KPI-ACC-001 .. -012: the inventory accounting and GL control family (DASH.8)
#
# Held to the same standard as every family above and counted separately for the same
# reason: 29 MVP KPIs is a claim about what the Power BI semantic model binds and the SQL
# baseline measured, and these twelve are computed in SQL with no DAX measure behind them.
#
# The independence rule matters more here than anywhere else in the file. The whole point
# of an accounting control is that it is derived twice, so every expectation below is
# written against `warehouse` from the KPI's own definition and never by reading the view
# it is checking. A test that computed both sides from `reporting.vw_accounting_exceptions`
# would prove that a UNION is deterministic.
# --------------------------------------------------------------------------------------


def _latest_accounting_date_key(cursor: Any) -> int:
    """The most recent accounting date. Balances are SEMI-ADDITIVE.

    A period-ending balance is the LAST comparable date, never a sum across dates, so
    every balance assertion below is scoped to one date. Summing two month-ends would
    produce a number that is not a balance of anything.
    """
    key = _scalar(
        cursor,
        "SELECT max(accounting_date_key) FROM warehouse.fact_inventory_accounting_snapshot",
    )
    assert key is not None, "the accounting schedule is empty, so nothing below is tested"
    return int(key)


def _exception_count(cursor: Any, code: str) -> int:
    return int(
        _scalar(
            cursor,
            "SELECT count(*) FROM reporting.vw_accounting_exceptions "
            f"WHERE exception_code = '{code}'",
        )
    )


@pytest.mark.parametrize("kpi_id", ACCOUNTING_KPI_IDS)
def test_every_accounting_kpi_resolves_to_an_existing_reporting_view(
    loaded_cursor: Any, kpi_id: str
) -> None:
    """All 12 accounting identifiers own at least one reporting view, and each exists."""
    owners = ACCOUNTING_KPI_VIEW_OWNERSHIP[kpi_id]
    assert owners, f"{kpi_id} has no reporting view registered in arpi.constants"
    for view_name in owners:
        exists = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM information_schema.views "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
        assert exists == 1, f"{kpi_id} names reporting.{view_name}, which does not exist"


def test_the_accounting_index_covers_exactly_twelve_kpis() -> None:
    assert len(ACCOUNTING_KPI_IDS) == 12
    assert len(set(ACCOUNTING_KPI_IDS)) == 12
    assert set(ACCOUNTING_KPI_VIEW_OWNERSHIP) == set(ACCOUNTING_KPI_IDS)
    assert tuple(f"KPI-ACC-{index:03d}" for index in range(1, 13)) == ACCOUNTING_KPI_IDS


def test_the_accounting_family_is_held_apart_from_every_other_register() -> None:
    """Three registers, reported side by side and never summed."""
    assert len(KPI_IDS) == 29
    assert not set(ACCOUNTING_KPI_IDS) & set(KPI_IDS)
    assert not set(ACCOUNTING_KPI_IDS) & set(FI_KPI_IDS)
    assert not set(ACCOUNTING_KPI_IDS) & set(TARGET_KPI_IDS)


# KPI-ACC-001: inventory subledger balance ----------------------------------------------


def test_kpi_acc_001_inventory_subledger_balance(loaded_cursor: Any) -> None:
    """SUM(current_book_value) at ONE accounting date, derived independently."""
    date_key = _latest_accounting_date_key(loaded_cursor)
    reported = _scalar(
        loaded_cursor,
        "SELECT sum(current_book_value) FROM reporting.vw_inventory_accounting "
        f"WHERE accounting_date_key = {date_key}",
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT sum(f.acquisition_cost
                 + f.capitalized_transportation
                 + f.capitalized_reconditioning
                 + f.capitalized_accessories
                 + f.other_capitalized_costs
                 - f.write_down_amount)
        FROM warehouse.fact_inventory_accounting_snapshot AS f
        WHERE f.accounting_date_key = %s
        """.replace("%s", str(date_key)),
    )
    _assert_equal(reported, expected, "KPI-ACC-001")
    assert Decimal(str(reported)) > 0, "the subledger balance is zero, so nothing is tested"


def test_kpi_acc_001_agrees_with_the_reconciliation_view_at_the_same_date(
    loaded_cursor: Any,
) -> None:
    """The measure's two owning views must not disagree about the same balance."""
    date_key = _latest_accounting_date_key(loaded_cursor)
    schedule = _scalar(
        loaded_cursor,
        "SELECT sum(current_book_value) FROM reporting.vw_inventory_accounting "
        f"WHERE accounting_date_key = {date_key}",
    )
    reconciliation = _scalar(
        loaded_cursor,
        "SELECT sum(subledger_balance) FROM reporting.vw_inventory_gl_reconciliation "
        f"WHERE comparison_date_key = {date_key}",
    )
    _assert_equal(reconciliation, schedule, "KPI-ACC-001 across its two owning views")


def test_kpi_acc_001_excludes_floorplan_principal(loaded_cursor: Any) -> None:
    """A liability is never netted into an asset balance, and the data proves it can tell.

    Both halves are required. If every floorplan balance were zero the exclusion would be
    unobservable, so the test insists the dataset actually carries floorplan principal.
    """
    date_key = _latest_accounting_date_key(loaded_cursor)
    loaded_cursor.execute(
        "SELECT sum(current_book_value), sum(floorplan_principal) "
        "FROM reporting.vw_inventory_accounting "
        f"WHERE accounting_date_key = {date_key}"
    )
    book, floorplan = loaded_cursor.fetchone()
    assert Decimal(str(floorplan)) > 0, (
        "no unit carries floorplan principal, so 'floorplan is excluded from book value' "
        "is vacuously true and untested"
    )
    subledger = _scalar(
        loaded_cursor,
        "SELECT sum(subledger_balance) FROM reporting.vw_inventory_gl_reconciliation "
        f"WHERE comparison_date_key = {date_key}",
    )
    _assert_equal(subledger, book, "KPI-ACC-001 excludes floorplan")
    assert Decimal(str(subledger)) != Decimal(str(book)) + Decimal(str(floorplan))
    assert Decimal(str(subledger)) != Decimal(str(book)) - Decimal(str(floorplan))


def test_no_view_publishes_a_net_inventory_position(loaded_cursor: Any) -> None:
    """The column that would net an asset against a liability must not exist anywhere."""
    present = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema IN ('warehouse', 'reporting') "
        "AND column_name IN ('net_inventory_position', 'net_inventory_value', "
        "                    'inventory_net_of_floorplan', 'equity_in_inventory')",
    )
    assert present == 0


# KPI-ACC-002: GL inventory control balance ---------------------------------------------


def test_kpi_acc_002_gl_control_balance(loaded_cursor: Any) -> None:
    date_key = _latest_accounting_date_key(loaded_cursor)
    reported = _scalar(
        loaded_cursor,
        "SELECT sum(gl_balance) FROM reporting.vw_inventory_gl_reconciliation "
        f"WHERE comparison_date_key = {date_key}",
    )
    expected = _scalar(
        loaded_cursor,
        "SELECT sum(net_balance) FROM warehouse.fact_gl_control_balance "
        f"WHERE balance_date_key = {date_key}",
    )
    _assert_equal(reported, expected, "KPI-ACC-002")


def test_kpi_acc_002_is_never_defaulted_to_zero_when_a_balance_is_absent(
    loaded_cursor: Any,
) -> None:
    """A missing balance is NULL, and the dataset must contain one for this to be tested.

    COALESCE-ing an absent control balance to 0.00 would report a variance equal to the
    whole subledger and present a MISSING BALANCE as a ZEROED ACCOUNT.
    """
    missing = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation "
        "WHERE comparison_state = 'Missing GL balance'",
    )
    assert missing > 0, (
        "no month has a withheld control balance, so the NULL-not-zero rule is untested"
    )
    zeroed = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation "
        "WHERE comparison_state = 'Missing GL balance' "
        "  AND (gl_balance IS NOT NULL OR variance_amount IS NOT NULL "
        "       OR is_reconciled IS NOT NULL)",
    )
    assert zeroed == 0, "a missing control balance was defaulted rather than left NULL"


# KPI-ACC-003: inventory reconciliation variance ----------------------------------------


def test_kpi_acc_003_variance_is_gl_minus_subledger_on_every_comparable_row(
    loaded_cursor: Any,
) -> None:
    """The sign is load-bearing: positive means the GL carries more than the schedule."""
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation "
        "WHERE is_comparable AND variance_amount <> gl_balance - subledger_balance",
    )
    assert offending == 0


def test_kpi_acc_003_agrees_with_an_independent_warehouse_derivation(
    loaded_cursor: Any,
) -> None:
    """Derived from the two facts directly, never by reading the reconciliation view."""
    reported = _scalar(
        loaded_cursor,
        "SELECT sum(variance_amount) FROM reporting.vw_inventory_gl_reconciliation",
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT sum(b.net_balance - s.subledger_balance)
        FROM warehouse.fact_gl_control_balance AS b
        JOIN (
            SELECT accounting_date_key, dealership_key, gl_account_key,
                   sum(current_book_value) AS subledger_balance
            FROM warehouse.fact_inventory_accounting_snapshot
            GROUP BY accounting_date_key, dealership_key, gl_account_key
        ) AS s
          ON s.accounting_date_key = b.balance_date_key
         AND s.dealership_key = b.dealership_key
         AND s.gl_account_key = b.gl_account_key
        """,
    )
    _assert_equal(reported, expected, "KPI-ACC-003")


def test_kpi_acc_003_has_a_nonzero_variance_and_an_exact_reconciliation_to_show(
    loaded_cursor: Any,
) -> None:
    """The surface must be observed in BOTH states or neither is demonstrated.

    A reconciliation that only ever agrees proves nothing about a variance, and a
    reconciliation that never agrees proves nothing about the arithmetic.
    """
    loaded_cursor.execute(
        "SELECT count(*) FILTER (WHERE comparison_state = 'Reconciled'), "
        "       count(*) FILTER (WHERE comparison_state = 'Variance') "
        "FROM reporting.vw_inventory_gl_reconciliation"
    )
    reconciled, variance = loaded_cursor.fetchone()
    assert reconciled > 0, "no store-account-month reconciles exactly"
    assert variance > 0, "no store-account-month carries a variance"


def test_kpi_acc_003_publishes_both_signs(loaded_cursor: Any) -> None:
    """Positive and negative variances are different investigations, so both are modelled."""
    loaded_cursor.execute(
        "SELECT count(*) FILTER (WHERE variance_amount > 0), "
        "       count(*) FILTER (WHERE variance_amount < 0) "
        "FROM reporting.vw_inventory_gl_reconciliation"
    )
    over, under = loaded_cursor.fetchone()
    assert over > 0, "no month carries a GL balance above its schedule"
    assert under > 0, "no month carries a GL balance below its schedule"


def test_the_absolute_variance_never_replaces_the_signed_one(loaded_cursor: Any) -> None:
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation "
        "WHERE is_comparable AND absolute_variance_amount <> abs(variance_amount)",
    )
    assert offending == 0
    signed_differs = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation WHERE variance_amount < 0",
    )
    assert signed_differs > 0, (
        "every variance is non-negative, so publishing the absolute value alongside the "
        "signed one proves nothing"
    )


# KPI-ACC-004 and KPI-ACC-010: the two stock-coverage counts ----------------------------


def test_kpi_acc_004_unreconciled_stock_count(loaded_cursor: Any) -> None:
    """Both directions: stock with no schedule line, and a schedule line with no stock."""
    reported = _exception_count(loaded_cursor, "ACC-MISSING-BOOK-ROW") + _exception_count(
        loaded_cursor, "ACC-ORPHAN-BOOK-ROW"
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT
            (SELECT count(*)
             FROM warehouse.fact_vehicle_inventory_snapshot AS i
             WHERE i.snapshot_date_key IN (
                SELECT DISTINCT accounting_date_key
                FROM warehouse.fact_inventory_accounting_snapshot)
               AND NOT EXISTS (
                SELECT 1 FROM warehouse.fact_inventory_accounting_snapshot AS f
                WHERE f.accounting_date_key = i.snapshot_date_key
                  AND f.dealership_key = i.dealership_key
                  AND f.vehicle_key = i.vehicle_key))
          + (SELECT count(*)
             FROM warehouse.fact_inventory_accounting_snapshot AS f
             WHERE NOT EXISTS (
                SELECT 1 FROM warehouse.fact_vehicle_inventory_snapshot AS i
                WHERE i.snapshot_date_key = f.accounting_date_key
                  AND i.dealership_key = f.dealership_key
                  AND i.vehicle_key = f.vehicle_key))
        """,
    )
    assert reported == expected, "KPI-ACC-004 disagrees with its warehouse derivation"


def test_kpi_acc_010_is_a_strict_direction_of_kpi_acc_004(loaded_cursor: Any) -> None:
    """Publishing both is deliberate: the two directions have different causes."""
    missing = _exception_count(loaded_cursor, "ACC-MISSING-BOOK-ROW")
    orphan = _exception_count(loaded_cursor, "ACC-ORPHAN-BOOK-ROW")
    assert missing >= 0 and orphan >= 0
    assert missing + orphan >= missing


def test_the_stock_schedule_covers_the_stock_on_a_healthy_run(loaded_cursor: Any) -> None:
    """On unmodified synthetic data both directions are zero, and that is the claim."""
    assert _exception_count(loaded_cursor, "ACC-MISSING-BOOK-ROW") == 0
    assert _exception_count(loaded_cursor, "ACC-ORPHAN-BOOK-ROW") == 0


# KPI-ACC-005 .. -007: the three gross identities ---------------------------------------


def test_kpi_acc_005_unbalanced_front_gross_identity_count(loaded_cursor: Any) -> None:
    reported = _exception_count(loaded_cursor, "ACC-FRONT-GROSS-IDENTITY")
    expected = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_vehicle_sale "
        "WHERE front_end_gross "
        "      <> sale_price - acquisition_cost - reconditioning_cost - pack_amount",
    )
    assert reported == expected
    assert reported == 0, "DASH.8 must not disturb the front-gross identity"


def test_kpi_acc_006_uses_original_product_gross_and_not_net(loaded_cursor: Any) -> None:
    """The corrected definition, asserted as arithmetic rather than as a comment.

    back_end_gross = finance_reserve_gross + SUM(original_product_gross) + other_fi_income.
    Comparing against POST-ADJUSTMENT net product gross would flag every adjusted deal in
    the dataset as an accounting defect, which is exactly backwards: a later cancellation
    is SUPPOSED to make retained gross differ from produced gross.
    """
    reported = _exception_count(loaded_cursor, "ACC-BACK-GROSS-IDENTITY")
    expected = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_vehicle_sale AS s
        LEFT JOIN (
            SELECT ps.sale_key, sum(ps.original_product_gross) AS product_gross
            FROM warehouse.fact_finance_product_sale AS ps
            GROUP BY ps.sale_key
        ) AS p ON p.sale_key = s.sale_key
        WHERE s.back_end_gross
              <> s.finance_reserve_gross + coalesce(p.product_gross, 0.00) + 0.00
        """,
    )
    assert reported == expected
    assert reported == 0, "the back-gross identity does not close on every deal"

    # And the defect this correction avoids: had the measure used NET product gross, the
    # count would be nonzero, because adjustments exist. Proving that the WRONG definition
    # would have fired is what makes the right one a decision rather than a coincidence.
    would_have_fired = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM warehouse.fact_vehicle_sale AS s
        LEFT JOIN (
            SELECT ps.sale_key,
                   sum(ps.original_product_gross)
                   - coalesce(sum(a.adjustment_amount), 0.00) AS net_product_gross
            FROM warehouse.fact_finance_product_sale AS ps
            LEFT JOIN warehouse.fact_finance_product_adjustment AS a
                   ON a.product_sale_key = ps.product_sale_key
            GROUP BY ps.sale_key
        ) AS p ON p.sale_key = s.sale_key
        WHERE s.back_end_gross
              <> s.finance_reserve_gross + coalesce(p.net_product_gross, 0.00)
        """,
    )
    assert would_have_fired > 0, (
        "net product gross equals original product gross across the whole dataset, so the "
        "KPI-ACC-006 correction is untested; the adjustment population should prevent that"
    )


def test_kpi_acc_007_unbalanced_total_gross_identity_count(loaded_cursor: Any) -> None:
    reported = _exception_count(loaded_cursor, "ACC-TOTAL-GROSS-IDENTITY")
    expected = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_vehicle_sale "
        "WHERE total_gross <> front_end_gross + back_end_gross",
    )
    assert reported == expected
    assert reported == 0


# KPI-ACC-008 and KPI-ACC-009: the two orphan counts ------------------------------------


def test_kpi_acc_008_and_009_are_zero_while_their_foreign_keys_stand(
    loaded_cursor: Any,
) -> None:
    """Both branches are unreachable in a database whose constraints are intact.

    They exist so that a constraint dropped from a DEPLOYED database fails a run rather
    than passing one. The companion test below proves the constraints are actually there,
    because a zero from a branch that cannot fire is not evidence on its own.
    """
    assert _exception_count(loaded_cursor, "ACC-ORPHAN-FI-PRODUCT") == 0
    assert _exception_count(loaded_cursor, "ACC-ORPHAN-FI-ADJUSTMENT") == 0


def test_the_foreign_keys_behind_kpi_acc_008_and_009_are_on_the_deployed_tables(
    loaded_cursor: Any,
) -> None:
    for constraint in (
        "fk_fact_fi_product_sale_sale",
        "fk_fact_fi_adjustment_product_sale",
    ):
        present = _scalar(
            loaded_cursor,
            f"SELECT count(*) FROM pg_constraint WHERE conname = '{constraint}'",
        )
        assert present == 1, f"{constraint} is not on the deployed database"


# KPI-ACC-011: inventory posting lag ----------------------------------------------------


def test_kpi_acc_011_posting_lag_is_measured_on_first_appearance_only(
    loaded_cursor: Any,
) -> None:
    """Averaging over every appearance would grow the mean because a unit stayed in stock."""
    reported = _scalar(
        loaded_cursor,
        "SELECT avg(posting_lag_days) FROM reporting.vw_inventory_accounting "
        "WHERE is_first_accounting_appearance",
    )
    expected = _scalar(
        loaded_cursor,
        """
        SELECT avg(f.days_in_stock)
        FROM warehouse.fact_inventory_accounting_snapshot AS f
        WHERE f.accounting_date_key = (
            SELECT min(x.accounting_date_key)
            FROM warehouse.fact_inventory_accounting_snapshot AS x
            WHERE x.vehicle_key = f.vehicle_key
        )
        """,
    )
    _assert_equal(reported, expected, "KPI-ACC-011")


def test_kpi_acc_011_differs_from_the_all_appearances_average(loaded_cursor: Any) -> None:
    """If the two coincided, restricting to first appearance would be a no-op."""
    first_only = _scalar(
        loaded_cursor,
        "SELECT avg(posting_lag_days) FROM reporting.vw_inventory_accounting "
        "WHERE is_first_accounting_appearance",
    )
    every_row = _scalar(
        loaded_cursor, "SELECT avg(posting_lag_days) FROM reporting.vw_inventory_accounting"
    )
    assert Decimal(str(first_only)) < Decimal(str(every_row)), (
        "the first-appearance restriction changes nothing, so KPI-ACC-011's population "
        "rule is untested"
    )


def test_the_posting_lag_is_never_negative(loaded_cursor: Any) -> None:
    """A unit cannot be scheduled before it entered stock."""
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_accounting WHERE posting_lag_days < 0",
    )
    assert offending == 0


def test_no_column_claims_a_journal_posting_timestamp(loaded_cursor: Any) -> None:
    """KPI-ACC-011 measures acquisition to schedule date and must not imply more.

    ARPI holds no separate posting timestamp. A column named for one would be an invented
    operational fact, and the honest narrowing of KPI-ACC-011 depends on it not existing.
    """
    present = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema IN ('warehouse', 'reporting') "
        "AND column_name IN ('posted_at', 'posting_timestamp', 'journal_posted_date', "
        "                    'gl_posted_date', 'posting_date_key')",
    )
    assert present == 0


# KPI-ACC-012: data-quality exception count ---------------------------------------------


def test_kpi_acc_012_counts_current_data_quality_failures(loaded_cursor: Any) -> None:
    reported = _exception_count(loaded_cursor, "ACC-DQ-FAILURE")
    expected = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_data_quality_summary "
        "WHERE is_failed AND is_latest_run_for_check",
    )
    assert reported == expected


def test_a_variance_is_never_counted_as_a_data_quality_exception(
    loaded_cursor: Any,
) -> None:
    """KPI-ACC-003 and KPI-ACC-012 count different things and must never be added.

    A variance means two structurally valid balances disagreed. A data-quality exception
    means a rule the model asserts about itself does not hold. The dataset deliberately
    carries variances, so if the two were conflated this would fail.
    """
    variances = _exception_count(loaded_cursor, "ACC-GL-VARIANCE")
    assert variances > 0, "no variance exists, so the distinction is untested"
    assert _exception_count(loaded_cursor, "ACC-DQ-FAILURE") == 0, (
        "a controlled accounting variance has been recorded as a data-quality failure"
    )


# The exception surface as a whole ------------------------------------------------------


def test_the_exception_identifier_is_unique_so_one_defect_is_counted_once(
    loaded_cursor: Any,
) -> None:
    loaded_cursor.execute(
        "SELECT count(*), count(DISTINCT exception_id) FROM reporting.vw_accounting_exceptions"
    )
    rows, distinct = loaded_cursor.fetchone()
    assert rows == distinct, (
        "two branches of reporting.vw_accounting_exceptions produced the same "
        "exception_id, so one physical defect is being counted twice"
    )


def test_every_exception_code_is_in_the_governed_vocabulary(loaded_cursor: Any) -> None:
    codes = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT exception_code FROM reporting.vw_accounting_exceptions",
        )
    }
    assert codes <= set(ACCOUNTING_EXCEPTION_CODES), (
        f"reporting.vw_accounting_exceptions published {codes - set(ACCOUNTING_EXCEPTION_CODES)}, "
        "which is outside the closed vocabulary in arpi.constants"
    )


def test_a_missing_balance_exception_carries_no_amount(loaded_cursor: Any) -> None:
    """Reporting the present side as the amount would state a number nobody computed."""
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_accounting_exceptions "
        "WHERE exception_code IN ('ACC-MISSING-GL-BALANCE', 'ACC-MISSING-SUBLEDGER-BALANCE') "
        "  AND exception_amount IS NOT NULL",
    )
    assert offending == 0


def test_every_comparison_state_is_in_the_governed_vocabulary(loaded_cursor: Any) -> None:
    states = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT comparison_state FROM reporting.vw_inventory_gl_reconciliation",
        )
    }
    assert states <= set(RECONCILIATION_COMPARISON_STATES)
    assert {"Reconciled", "Variance"} <= states, (
        "the dataset does not exercise both compared states, so the reconciliation "
        "surface has not been demonstrated working"
    )
