"""Integration tests for the ``DASH.3`` dashboard reporting views.

Three views are asserted here, against a real PostgreSQL server holding a real
pipeline run:

* ``reporting.vw_sales_gross_trend`` -- store x sale date, and the claim that it
  agrees with the two governed views it sits beside rather than quietly disagreeing
  with them.
* ``reporting.vw_gross_change_bridge`` -- the decomposition, and the claim that it
  reconciles EXACTLY rather than to the cent.
* ``reporting.vw_deal_explorer`` -- deal grain, and the claim that four joins did not
  widen it and that no prohibited field reached a public lane.

WHY THE BRIDGE IS ASSERTED ON NUMERATORS
----------------------------------------
The view publishes each effect as an exact numerator over a shared denominator and
never divides. Asserting on ``effect_amount`` would assert on a quotient, and a
quotient of numerics is rounded -- the test would then be checking PostgreSQL's
rounding rather than the decomposition. The numerator identity is exact in integer-
scaled numeric arithmetic, so ``IS DISTINCT FROM`` is the right comparison and any
failure is a real failure of the bridge.

A SEEDED-DEFECT TEST IS INCLUDED
--------------------------------
``test_a_mutated_component_breaks_the_bridge_reconciliation`` proves the
reconciliation assertion can fail. Without it, an identity test that happens to be
vacuous -- comparing a value with itself, or running over zero rows -- looks exactly
like a passing one. The mutation happens inside the per-test transaction that
``loaded_db`` rolls back, so no committed data is touched.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

pytestmark = pytest.mark.integration

#: The views this module owns.
TREND_VIEW = "reporting.vw_sales_gross_trend"
BRIDGE_VIEW = "reporting.vw_gross_change_bridge"
EXPLORER_VIEW = "reporting.vw_deal_explorer"

#: Fields that must never appear in a public deal lane, in any spelling.
#: Checked against column NAMES; the value-level scan is the exporter's privacy check.
PROHIBITED_DEAL_COLUMNS = (
    "customer_key",
    "customer_id",
    "customer_name",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "address",
    "postal_code",
    "date_of_birth",
    "ssn",
    "credit_score",
    "drivers_license",
    "account_number",
    "sale_key",
    "employee_name",
    "notes",
    "comments",
    "message",
)


def _scalar(cursor: Any, sql: str, params: tuple[Any, ...] = ()) -> Any:
    cursor.execute(sql, params)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _columns(cursor: Any, view: str) -> set[str]:
    schema, name = view.split(".", 1)
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        """,
        (schema, name),
    )
    return {row[0] for row in cursor.fetchall()}


# ======================================================================================
# All three views: existence, documentation, reporter access
# ======================================================================================


@pytest.mark.parametrize("view", [TREND_VIEW, BRIDGE_VIEW, EXPLORER_VIEW])
def test_the_view_exists_and_is_a_view(loaded_cursor: Any, view: str) -> None:
    """No dashboard view may be a table or a materialised view.

    Reporting-layer rule 1: a materialised view must be justified by a MEASURED
    performance problem. None has been measured, so none exists.
    """
    schema, name = view.split(".", 1)
    kind = _scalar(
        loaded_cursor,
        """
        SELECT c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %s AND c.relname = %s
        """,
        (schema, name),
    )
    assert kind == "v", f"{view} has relkind {kind!r}; expected an ordinary view"


@pytest.mark.parametrize("view", [TREND_VIEW, BRIDGE_VIEW, EXPLORER_VIEW])
def test_the_view_declares_its_grain_and_date_basis(loaded_cursor: Any, view: str) -> None:
    comment = _scalar(loaded_cursor, "SELECT obj_description(%s::regclass, 'pg_class')", (view,))
    assert comment, f"{view} carries no COMMENT ON VIEW"
    assert "Grain:" in comment, f"{view} does not declare its grain"
    assert "Date basis:" in comment or "date basis" in comment.lower(), (
        f"{view} does not declare its date basis"
    )
    assert "Export-eligible" in comment, f"{view} does not declare its export eligibility"


@pytest.mark.parametrize("view", [TREND_VIEW, BRIDGE_VIEW, EXPLORER_VIEW])
def test_every_column_is_documented(loaded_cursor: Any, view: str) -> None:
    schema, name = view.split(".", 1)
    loaded_cursor.execute(
        """
        SELECT c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = %s AND c.table_name = %s
          AND col_description((c.table_schema || '.' || c.table_name)::regclass,
                              c.ordinal_position) IS NULL
        ORDER BY c.ordinal_position
        """,
        (schema, name),
    )
    undocumented = [row[0] for row in loaded_cursor.fetchall()]
    assert undocumented == [], f"{view} has undocumented column(s): {undocumented}"


@pytest.mark.parametrize("view", [TREND_VIEW, BRIDGE_VIEW, EXPLORER_VIEW])
def test_the_reporter_role_can_read_it_and_cannot_write_it(loaded_cursor: Any, view: str) -> None:
    readable = _scalar(
        loaded_cursor, "SELECT has_table_privilege('arpi_reporter', %s, 'SELECT')", (view,)
    )
    assert readable is True, f"arpi_reporter cannot SELECT {view}"
    for privilege in ("INSERT", "UPDATE", "DELETE"):
        granted = _scalar(
            loaded_cursor,
            "SELECT has_table_privilege('arpi_reporter', %s, %s)",
            (view, privilege),
        )
        assert granted is False, f"arpi_reporter holds {privilege} on {view}"


@pytest.mark.parametrize("view", [TREND_VIEW, BRIDGE_VIEW, EXPLORER_VIEW])
def test_the_view_returns_rows(loaded_cursor: Any, view: str) -> None:
    """A view that is correct but empty would satisfy every other test here."""
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {view}") > 0


# ======================================================================================
# vw_sales_gross_trend
# ======================================================================================


def test_the_trend_view_holds_its_declared_store_day_grain(loaded_cursor: Any) -> None:
    duplicates = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM (
            SELECT dealership_key, sale_date_key FROM {TREND_VIEW}
            GROUP BY dealership_key, sale_date_key HAVING count(*) > 1
        ) AS d
        """,
    )
    assert duplicates == 0, "vw_sales_gross_trend is not one row per store per sale date"


def test_the_trend_view_agrees_with_the_governed_gross_view(loaded_cursor: Any) -> None:
    """It sits beside vw_gross_summary; it may not disagree with it.

    Both sum the same pre-filtered additive columns of vw_vehicle_sales, so any
    difference is a defect in one of them rather than a modelling choice.
    """
    mismatches = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM {TREND_VIEW} AS t
        FULL OUTER JOIN reporting.vw_gross_summary AS g
               ON g.dealership_key = t.dealership_key
              AND g.sale_date_key = t.sale_date_key
        WHERE t.dealership_key IS NULL
           OR g.dealership_key IS NULL
           OR t.retail_units_sold IS DISTINCT FROM g.retail_units_sold
           OR t.front_end_gross   IS DISTINCT FROM g.front_end_gross
           OR t.back_end_gross    IS DISTINCT FROM g.back_end_gross
           OR t.total_gross       IS DISTINCT FROM g.total_gross
           OR t.negative_front_gross_units IS DISTINCT FROM g.negative_front_gross_units
        """,
    )
    assert mismatches == 0, "vw_sales_gross_trend disagrees with vw_gross_summary"


def test_the_trend_view_agrees_with_the_governed_sales_view(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM {TREND_VIEW} AS t
        FULL OUTER JOIN reporting.vw_sales_summary AS s
               ON s.dealership_key = t.dealership_key
              AND s.sale_date_key = t.sale_date_key
        WHERE t.dealership_key IS NULL
           OR s.dealership_key IS NULL
           OR t.retail_units_sold IS DISTINCT FROM s.retail_units_sold
           OR t.new_units_sold    IS DISTINCT FROM s.new_units_sold
           OR t.used_units_sold   IS DISTINCT FROM s.used_units_sold
           OR t.wholesale_units   IS DISTINCT FROM s.wholesale_units
        """,
    )
    assert mismatches == 0, "vw_sales_gross_trend disagrees with vw_sales_summary"


def test_the_unit_identity_holds_on_every_row(loaded_cursor: Any) -> None:
    """RECON-UNITS-001 at this view's grain."""
    breaks = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {TREND_VIEW} "
        "WHERE new_units_sold + used_units_sold <> retail_units_sold",
    )
    assert breaks == 0


def test_the_condition_components_sum_to_the_retail_totals(loaded_cursor: Any) -> None:
    """The breakdown is columns, not rows, and that is only safe if it adds up."""
    breaks = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {TREND_VIEW}
        WHERE new_front_end_gross + used_front_end_gross <> front_end_gross
           OR new_back_end_gross  + used_back_end_gross  <> back_end_gross
           OR new_total_gross     + used_total_gross     <> total_gross
        """,
    )
    assert breaks == 0, "the condition components do not sum to the retail totals"


def test_the_gross_identity_holds_on_every_row(loaded_cursor: Any) -> None:
    breaks = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {TREND_VIEW} WHERE front_end_gross + back_end_gross <> total_gross",
    )
    assert breaks == 0


def test_a_zero_denominator_yields_null_and_never_zero(loaded_cursor: Any) -> None:
    """Per-unit gross on a day with no retail units is undefined, not $0.00."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {TREND_VIEW}
        WHERE retail_units_sold = 0
          AND (front_gross_per_retail_unit IS NOT NULL
               OR back_gross_per_retail_unit IS NOT NULL
               OR total_gross_per_retail_unit IS NOT NULL)
        """,
    )
    assert wrong == 0, "a zero-unit row published a per-unit rate instead of NULL"

    wrong_other_way = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {TREND_VIEW}
        WHERE retail_units_sold > 0 AND total_gross_per_retail_unit IS NULL
        """,
    )
    assert wrong_other_way == 0, "a row with units published a NULL rate"


def test_the_three_per_unit_rates_share_one_denominator(loaded_cursor: Any) -> None:
    """KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005 is an identity only if they do."""
    breaks = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {TREND_VIEW}
        WHERE retail_units_sold > 0
          AND front_gross_per_retail_unit + back_gross_per_retail_unit
              <> total_gross_per_retail_unit
        """,
    )
    assert breaks == 0


def test_the_msrp_discount_has_its_own_smaller_denominator(loaded_cursor: Any) -> None:
    """A used unit has no MSRP; dividing its discount by all retail units understates it."""
    over = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {TREND_VIEW} WHERE msrp_eligible_units > retail_units_sold",
    )
    assert over == 0, "msrp_eligible_units exceeds retail_units_sold on some row"

    total_eligible = _scalar(loaded_cursor, f"SELECT sum(msrp_eligible_units) FROM {TREND_VIEW}")
    total_retail = _scalar(loaded_cursor, f"SELECT sum(retail_units_sold) FROM {TREND_VIEW}")
    assert 0 < total_eligible < total_retail, (
        "the MSRP denominator is either empty or equal to the retail denominator; "
        "the development profile contains used units without an MSRP, so it should be "
        "strictly between"
    )


# ======================================================================================
# vw_gross_change_bridge
# ======================================================================================


def test_the_bridge_publishes_exactly_three_components_per_store_month(loaded_cursor: Any) -> None:
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM (
            SELECT dealership_key, month_start_date, count(*) AS n,
                   count(DISTINCT component_code) AS distinct_codes
            FROM {BRIDGE_VIEW}
            GROUP BY dealership_key, month_start_date
        ) AS t WHERE n <> 3 OR distinct_codes <> 3
        """,
    )
    assert wrong == 0, "a store-month does not carry exactly three distinct components"


def test_the_bridge_component_codes_are_the_declared_three(loaded_cursor: Any) -> None:
    loaded_cursor.execute(f"SELECT DISTINCT component_code FROM {BRIDGE_VIEW} ORDER BY 1")
    codes = [row[0] for row in loaded_cursor.fetchall()]
    assert codes == ["back_pvr", "front_pvr", "volume"], (
        f"unexpected bridge components {codes}; a mix effect may not be added until its "
        "position in the sequence and its exact reconciliation are documented"
    )


def test_the_bridge_grain_has_no_duplicates(loaded_cursor: Any) -> None:
    duplicates = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM (
            SELECT dealership_key, month_start_date, component_code
            FROM {BRIDGE_VIEW}
            GROUP BY dealership_key, month_start_date, component_code
            HAVING count(*) > 1
        ) AS d
        """,
    )
    assert duplicates == 0


def test_the_bridge_reconciles_exactly_on_every_comparable_store_month(
    loaded_cursor: Any,
) -> None:
    """The load-bearing assertion of the whole increment.

    The three numerators must sum to ``effect_denominator * total_gross_change``
    IDENTICALLY -- not to the cent, not within a tolerance. No division occurs in
    either side of this comparison, so exact equality is the correct assertion and
    ``IS DISTINCT FROM`` catches a NULL that a plain ``<>`` would let through.
    """
    loaded_cursor.execute(
        f"""
        SELECT dealership_key, month_start_date,
               sum(effect_numerator) AS numerator_sum,
               max(effect_denominator) * max(total_gross_change) AS expected
        FROM {BRIDGE_VIEW}
        WHERE is_comparable
        GROUP BY dealership_key, month_start_date
        HAVING sum(effect_numerator)
               IS DISTINCT FROM max(effect_denominator) * max(total_gross_change)
        """
    )
    failures = loaded_cursor.fetchall()
    assert failures == [], (
        f"the bridge does not reconcile on {len(failures)} store-month(s): {failures}"
    )


def test_the_bridge_reconciliation_actually_ran_over_rows(loaded_cursor: Any) -> None:
    """An identity test over zero rows passes and proves nothing."""
    comparable = _scalar(loaded_cursor, f"SELECT count(*) FROM {BRIDGE_VIEW} WHERE is_comparable")
    assert comparable >= 3, (
        f"only {comparable} comparable bridge row(s); the reconciliation assertion above "
        "would be close to vacuous"
    )


def test_a_mutated_component_breaks_the_bridge_reconciliation(loaded_db: Any) -> None:
    """Seeded defect: prove the reconciliation assertion can fail.

    A view cannot be UPDATEd, so the mutation is applied to the reconciliation query
    itself -- one cent added to a single component -- which is exactly what a defective
    bridge would produce. The transaction is rolled back by the fixture regardless.
    """
    with loaded_db.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT count(*) FROM (
                SELECT dealership_key, month_start_date,
                       sum(effect_numerator
                           + CASE WHEN component_code = 'volume' THEN 0.01 ELSE 0 END) AS mutated,
                       max(effect_denominator) * max(total_gross_change) AS expected
                FROM {BRIDGE_VIEW}
                WHERE is_comparable
                GROUP BY dealership_key, month_start_date
            ) AS t WHERE mutated IS DISTINCT FROM expected
            """
        )
        broken = cursor.fetchone()[0]
    assert broken > 0, (
        "adding a cent to one component did not break the reconciliation; the identity "
        "assertion is not actually testing anything"
    )


def test_a_non_comparable_row_withholds_components_and_keeps_the_period_change(
    loaded_cursor: Any,
) -> None:
    """When there is no baseline rate, the decomposition is absent and says why."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {BRIDGE_VIEW}
        WHERE NOT is_comparable
          AND (effect_numerator IS NOT NULL
               OR effect_denominator IS NOT NULL
               OR effect_amount IS NOT NULL
               OR not_comparable_reason IS NULL
               OR total_gross_change IS NULL)
        """,
    )
    assert wrong == 0, (
        "a non-comparable bridge row either published components, omitted its reason, "
        "or dropped the period change"
    )


def test_comparability_is_exactly_the_presence_of_baseline_units(loaded_cursor: Any) -> None:
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {BRIDGE_VIEW}
        WHERE is_comparable <> (comparison_retail_units_sold > 0)
        """,
    )
    assert wrong == 0


def test_the_two_non_comparable_reasons_are_the_declared_ones(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        f"SELECT DISTINCT not_comparable_reason FROM {BRIDGE_VIEW} "
        "WHERE not_comparable_reason IS NOT NULL ORDER BY 1"
    )
    reasons = [row[0] for row in loaded_cursor.fetchall()]
    allowed = {"comparison-period-outside-window", "comparison-period-no-retail-units"}
    assert set(reasons) <= allowed, f"unexpected non-comparable reason(s): {reasons}"
    assert reasons, (
        "no non-comparable row exists; the first month of the reporting window has no "
        "in-window prior month, so at least one was expected"
    )


def test_the_first_month_of_the_window_is_not_comparable(loaded_cursor: Any) -> None:
    """It has no prior month in the window, and saying so is different from saying zero."""
    first_month = _scalar(loaded_cursor, f"SELECT min(month_start_date) FROM {BRIDGE_VIEW}")
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {BRIDGE_VIEW}
        WHERE month_start_date = %s
          AND (is_comparable OR not_comparable_reason <> 'comparison-period-outside-window')
        """,
        (first_month,),
    )
    assert wrong == 0


def test_the_comparison_month_is_always_the_prior_calendar_month(loaded_cursor: Any) -> None:
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {BRIDGE_VIEW}
        WHERE comparison_month_start_date
              <> (month_start_date - interval '1 month')::date
        """,
    )
    assert wrong == 0


def test_the_bridge_period_figures_agree_with_the_trend_view(loaded_cursor: Any) -> None:
    """The bridge's own month totals must be the trend view's, re-aggregated."""
    mismatches = _scalar(
        loaded_cursor,
        f"""
        WITH monthly AS (
            SELECT t.dealership_key, c.month_start_date,
                   sum(t.retail_units_sold) AS units,
                   sum(t.front_end_gross)   AS front,
                   sum(t.back_end_gross)    AS back,
                   sum(t.total_gross)       AS total
            FROM {TREND_VIEW} AS t
            JOIN reporting.vw_calendar AS c ON c.date_key = t.sale_date_key
            GROUP BY t.dealership_key, c.month_start_date
        )
        SELECT count(*)
        FROM (SELECT DISTINCT dealership_key, month_start_date, retail_units_sold,
                     front_end_gross, back_end_gross, total_gross
              FROM {BRIDGE_VIEW}) AS b
        JOIN monthly AS m
               ON m.dealership_key = b.dealership_key
              AND m.month_start_date = b.month_start_date
        WHERE b.retail_units_sold IS DISTINCT FROM m.units
           OR b.front_end_gross   IS DISTINCT FROM m.front
           OR b.back_end_gross    IS DISTINCT FROM m.back
           OR b.total_gross       IS DISTINCT FROM m.total
        """,
    )
    assert mismatches == 0, "the bridge's month figures disagree with the trend view"


def test_the_effect_amount_is_the_numerator_over_the_denominator(loaded_cursor: Any) -> None:
    """The convenience quotient must be the quotient it claims to be."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {BRIDGE_VIEW}
        WHERE is_comparable
          AND effect_amount IS DISTINCT FROM (effect_numerator / effect_denominator)
        """,
    )
    assert wrong == 0


# ======================================================================================
# vw_deal_explorer
# ======================================================================================


def test_the_explorer_is_one_row_per_finalized_sale(loaded_cursor: Any) -> None:
    """Four joins resolve attributes; none of them may widen the grain."""
    explorer_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW}")
    fact_rows = _scalar(loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale")
    assert explorer_rows == fact_rows, (
        f"vw_deal_explorer has {explorer_rows} rows against {fact_rows} in the fact -- "
        "a join fanned out or dropped rows"
    )


def test_the_explorer_sale_id_is_unique(loaded_cursor: Any) -> None:
    distinct = _scalar(loaded_cursor, f"SELECT count(DISTINCT sale_id) FROM {EXPLORER_VIEW}")
    total = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW}")
    assert distinct == total, "sale_id is not unique in vw_deal_explorer"


def test_the_lead_relationship_is_still_at_most_one_per_sale(loaded_cursor: Any) -> None:
    """The only join that COULD fan out. Asserted rather than assumed.

    If the generator ever links two leads to one deal, this fails here -- in the view's
    own suite, naming the cause -- rather than showing up as a duplicated deal row.
    """
    worst = _scalar(
        loaded_cursor,
        """
        SELECT coalesce(max(n), 0) FROM (
            SELECT count(*) AS n FROM warehouse.fact_lead
            WHERE sale_key IS NOT NULL GROUP BY sale_key
        ) AS t
        """,
    )
    assert worst <= 1, (
        f"a sale carries {worst} leads; vw_deal_explorer's LEFT JOIN on fact_lead would "
        "duplicate that deal"
    )


def test_the_explorer_exposes_no_prohibited_field(loaded_cursor: Any) -> None:
    columns = _columns(loaded_cursor, EXPLORER_VIEW)
    leaked = sorted(columns & set(PROHIBITED_DEAL_COLUMNS))
    assert leaked == [], f"vw_deal_explorer exposes prohibited column(s): {leaked}"


def test_the_explorer_does_not_expose_the_surrogate_sale_key(loaded_cursor: Any) -> None:
    """The route parameter is the business code. A surrogate would leak load order."""
    assert "sale_key" not in _columns(loaded_cursor, EXPLORER_VIEW)


def test_the_explorer_does_not_expose_deal_cost_structure(loaded_cursor: Any) -> None:
    """Acquisition, reconditioning and pack belong to the Deal Jacket, not the index."""
    columns = _columns(loaded_cursor, EXPLORER_VIEW)
    cost_columns = {"acquisition_cost", "reconditioning_cost", "pack_amount"}
    assert columns & cost_columns == set(), (
        "vw_deal_explorer carries deal cost structure; the index would ship the whole "
        "deal population's costs to render a list"
    )


def test_the_explorer_gross_matches_the_fact_on_every_deal(loaded_cursor: Any) -> None:
    mismatches = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM {EXPLORER_VIEW} AS e
        JOIN warehouse.fact_vehicle_sale AS f ON f.sale_id = e.sale_id
        WHERE e.front_end_gross IS DISTINCT FROM f.front_end_gross
           OR e.back_end_gross  IS DISTINCT FROM f.back_end_gross
           OR e.total_gross     IS DISTINCT FROM f.total_gross
           OR e.sale_price      IS DISTINCT FROM f.sale_price
        """,
    )
    assert mismatches == 0


def test_the_explorer_gross_identity_holds_on_every_deal(loaded_cursor: Any) -> None:
    breaks = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {EXPLORER_VIEW} "
        "WHERE front_end_gross + back_end_gross <> total_gross",
    )
    assert breaks == 0


def test_the_explorer_retail_totals_equal_the_trend_view(loaded_cursor: Any) -> None:
    """Deal grain re-aggregated must equal the store-day view, or one of them is wrong."""
    explorer_units = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE is_retail")
    explorer_gross = _scalar(
        loaded_cursor, f"SELECT sum(total_gross) FROM {EXPLORER_VIEW} WHERE is_retail"
    )
    trend_units = _scalar(loaded_cursor, f"SELECT sum(retail_units_sold) FROM {TREND_VIEW}")
    trend_gross = _scalar(loaded_cursor, f"SELECT sum(total_gross) FROM {TREND_VIEW}")
    assert explorer_units == trend_units
    assert Decimal(explorer_gross) == Decimal(trend_gross)


def test_negative_front_gross_is_flagged_and_present(loaded_cursor: Any) -> None:
    """A negative front is a real dealership outcome and must stay visible."""
    inconsistent = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {EXPLORER_VIEW} "
        "WHERE is_negative_front_gross <> (front_end_gross < 0)",
    )
    assert inconsistent == 0
    negatives = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE is_negative_front_gross"
    )
    assert negatives > 0, "no negative-front deal exists; the rendering rule is untestable"


def test_lead_attribution_distinguishes_walk_in_from_missing(loaded_cursor: Any) -> None:
    """`is_lead_attributed` must agree with the presence of a source, both ways."""
    inconsistent = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {EXPLORER_VIEW}
        WHERE (is_lead_attributed AND lead_source_code IS NULL)
           OR (NOT is_lead_attributed AND lead_source_code IS NOT NULL)
        """,
    )
    assert inconsistent == 0, "is_lead_attributed disagrees with lead_source_code"

    attributed = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE is_lead_attributed"
    )
    unattributed = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE NOT is_lead_attributed"
    )
    assert attributed > 0 and unattributed > 0, (
        "the profile must contain both attributed and walk-in deals for the console's two "
        "states to be exercised"
    )


def test_the_sale_fact_lead_source_column_is_still_unpopulated(loaded_cursor: Any) -> None:
    """The reason attribution is resolved through fact_lead, asserted rather than assumed.

    If the generator ever starts populating ``fact_vehicle_sale.lead_source_key``, this
    fails and the view's documented rationale needs revisiting -- rather than the console
    silently reporting attribution from two disagreeing places.
    """
    populated = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM warehouse.fact_vehicle_sale WHERE lead_source_key IS NOT NULL",
    )
    assert populated == 0, (
        f"{populated} sale(s) now carry lead_source_key directly; vw_deal_explorer resolves "
        "lead source through fact_lead because this column has always been empty, and that "
        "rationale must be re-examined"
    )


def test_non_retail_deals_are_present_and_flagged(loaded_cursor: Any) -> None:
    """Wholesale and dealer trades must be representable, not filtered out."""
    non_retail = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE NOT is_retail")
    assert non_retail > 0, "no wholesale or dealer-trade deal exists to render"
    inconsistent = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {EXPLORER_VIEW}
        WHERE is_retail <> (sale_type IN ('New Retail', 'Used Retail', 'Certified Retail', 'Lease'))
        """,
    )
    assert inconsistent == 0


def test_used_units_without_msrp_carry_null_and_not_zero(loaded_cursor: Any) -> None:
    zeros = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE msrp = 0")
    assert zeros == 0, "an MSRP of 0.00 was published; absence must be NULL"
    nulls = _scalar(loaded_cursor, f"SELECT count(*) FROM {EXPLORER_VIEW} WHERE msrp IS NULL")
    assert nulls > 0, "no unit without an MSRP exists; the Not-applicable rule is untestable"


def test_every_deal_resolves_to_exactly_one_store(loaded_cursor: Any) -> None:
    orphans = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {EXPLORER_VIEW} AS e
        LEFT JOIN reporting.vw_dealership AS d ON d.dealership_key = e.dealership_key
        WHERE d.dealership_key IS NULL
        """,
    )
    assert orphans == 0
