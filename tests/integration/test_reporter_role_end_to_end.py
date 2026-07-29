"""``arpi_reporter`` can answer every MVP question, and can reach nothing else.

The security model ARPI claims is one sentence: Power BI must never be able to read the
raw layer. This module proves both halves of it as the reporter role itself, connecting
with ``SET ROLE`` rather than inspecting a privilege catalogue -- a grant that looks
correct and a query that actually succeeds are different facts, and only the second one
matters.

The isolation half is asserted object by object over whatever exists right now, rather
than against a hand-written list, so a table added by a later increment is covered
without anyone remembering to extend this file.
"""

from __future__ import annotations

from typing import Any

import pytest

from arpi.constants import REPORTING_VIEWS

pytestmark = pytest.mark.integration


#: Representative MVP queries, one per analytical domain, run as the reporter.
#:
#: These are not smoke tests: each one is the shape of a real report page's query, joining
#: a fact view to its dimensions exactly as a semantic model would. If the reporting layer
#: were missing a key, a grain or a grant, one of these would fail rather than a catalogue
#: assertion passing while the model stayed unbuildable.
MVP_QUERIES: tuple[tuple[str, str], ...] = (
    (
        "sales and gross by store and month",
        """
        SELECT d.store_short_name, c.year_month_label,
               sum(s.retail_unit_count)      AS retail_units,
               sum(s.retail_total_gross)     AS total_gross,
               sum(s.retail_total_gross) / nullif(sum(s.retail_unit_count), 0) AS gross_per_unit
        FROM reporting.vw_vehicle_sales AS s
        JOIN reporting.vw_dealership AS d ON d.dealership_key = s.dealership_key
        JOIN reporting.vw_calendar   AS c ON c.date_key       = s.sale_date_key
        GROUP BY d.store_short_name, c.year_month_label
        """,
    ),
    (
        "new versus used mix by model line",
        """
        SELECT m.make_model_label, v.condition_group,
               sum(s.retail_unit_count) AS units
        FROM reporting.vw_vehicle_sales  AS s
        JOIN reporting.vw_vehicle        AS v ON v.vehicle_key       = s.vehicle_key
        JOIN reporting.vw_vehicle_model  AS m ON m.vehicle_model_key = v.vehicle_model_key
        GROUP BY m.make_model_label, v.condition_group
        """,
    ),
    (
        "inventory health at the latest as-of date",
        """
        SELECT d.store_short_name, h.condition_group,
               h.active_inventory_units, h.inventory_investment,
               h.median_inventory_age, h.aged_inventory_percentage
        FROM reporting.vw_inventory_health AS h
        JOIN reporting.vw_dealership AS d ON d.dealership_key = h.dealership_key
        WHERE h.snapshot_date_key = (
            SELECT max(snapshot_date_key) FROM reporting.vw_inventory_health)
        """,
    ),
    (
        "inventory age distribution",
        """
        SELECT a.age_bucket, a.age_bucket_sort_order, sum(a.units_in_bucket) AS units
        FROM reporting.vw_inventory_aging AS a
        WHERE a.snapshot_date_key = (
            SELECT max(snapshot_date_key) FROM reporting.vw_inventory_aging)
        GROUP BY a.age_bucket, a.age_bucket_sort_order
        ORDER BY a.age_bucket_sort_order
        """,
    ),
    (
        "days to sale, median and mean, new against used",
        """
        SELECT t.condition_group, t.median_days_to_sale, t.mean_days_to_sale
        FROM reporting.vw_days_to_sale AS t
        JOIN reporting.vw_calendar AS c ON c.date_key = t.sale_month_date_key
        """,
    ),
    (
        "inventory turn and days supply",
        """
        SELECT d.store_short_name, t.condition_group, t.inventory_turn, s.days_supply
        FROM reporting.vw_inventory_turn AS t
        JOIN reporting.vw_dealership AS d ON d.dealership_key = t.dealership_key
        LEFT JOIN reporting.vw_days_supply AS s
               ON  s.dealership_key  = t.dealership_key
               AND s.condition_group = t.condition_group
               AND s.as_of_date_key  = (SELECT max(as_of_date_key) FROM reporting.vw_days_supply)
        """,
    ),
    (
        "lead funnel by source",
        """
        SELECT ls.lead_source_name,
               sum(f.leads_received)        AS leads,
               sum(f.contacted_leads)       AS contacted,
               sum(f.appointment_set_leads) AS appointments_set,
               sum(f.sold_leads)            AS sold,
               sum(f.duplicate_leads_excluded) AS duplicates_excluded
        FROM reporting.vw_lead_funnel AS f
        JOIN reporting.vw_lead_source AS ls ON ls.lead_source_key = f.lead_source_key
        GROUP BY ls.lead_source_name
        """,
    ),
    (
        "appointment funnel, both date bases",
        """
        SELECT d.store_short_name,
               sum(a.eligible_appointments)            AS eligible,
               sum(a.shown_appointments)               AS shown_scheduled_basis,
               sum(a.cancelled_in_advance_appointments) AS cancelled,
               sum(a.shown_appointments_on_show_date)  AS shown_show_basis,
               sum(a.shown_and_sold_appointments)      AS sold
        FROM reporting.vw_appointment_funnel AS a
        JOIN reporting.vw_dealership AS d ON d.dealership_key = a.dealership_key
        GROUP BY d.store_short_name
        """,
    ),
    (
        "lead response, median from row level",
        """
        SELECT ls.lead_source_name,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds) / 60.0
                   AS median_minutes,
               count(*) FILTER (WHERE l.unresponded_lead_count = 1) AS ignored_leads
        FROM reporting.vw_leads AS l
        JOIN reporting.vw_lead_source AS ls ON ls.lead_source_key = l.lead_source_key
        GROUP BY ls.lead_source_name
        """,
    ),
    (
        "marketing performance at month grain",
        """
        SELECT ca.campaign_name, ls.lead_source_name, c.year_month_label,
               m.spend_amount, m.attributed_leads, m.attributed_retail_units,
               m.cost_per_lead, m.cost_per_sale, m.gross_return_on_ad_spend
        FROM reporting.vw_marketing_performance AS m
        JOIN reporting.vw_lead_source AS ls ON ls.lead_source_key = m.lead_source_key
        JOIN reporting.vw_calendar    AS c  ON c.date_key         = m.month_date_key
        LEFT JOIN reporting.vw_marketing_campaign AS ca ON ca.campaign_key = m.campaign_key
        """,
    ),
    (
        "employee performance with fairness context",
        """
        SELECT e.employee_code, e.job_role, e.tenure_band,
               sum(s.retail_unit_count)  AS units,
               sum(s.retail_total_gross) / nullif(sum(s.retail_unit_count), 0) AS gross_per_unit,
               sum(s.new_unit_count)     AS new_units,
               sum(s.used_unit_count)    AS used_units
        FROM reporting.vw_vehicle_sales AS s
        JOIN reporting.vw_employee AS e ON e.employee_key = s.salesperson_key
        GROUP BY e.employee_code, e.job_role, e.tenure_band
        """,
    ),
    (
        "data quality and reconciliation status",
        """
        SELECT t.run_date, t.check_category, t.pass_rate, t.evaluation_coverage,
               r.reconciliation_id, r.status, r.is_critical
        FROM reporting.vw_data_quality_trend AS t
        FULL OUTER JOIN reporting.vw_reconciliation_status AS r
               ON r.pipeline_run_id = t.pipeline_run_id
        """,
    ),
)

#: Objects the reporter must be unable to read, one representative per pipeline layer.
FORBIDDEN_OBJECTS: tuple[str, ...] = (
    "raw.sale_event_load",
    "raw.lead_load",
    "staging.stg_sale_event",
    "staging.stg_lead",
    "warehouse.dim_customer",
    "warehouse.dim_employee",
    "warehouse.fact_vehicle_sale",
    "warehouse.fact_lead",
    "audit.pipeline_run",
    "audit.validation_result",
    "audit.reconciliation_result",
    "audit.rejected_record",
)


#: Reporting columns the privacy vocabulary flags that are not personal data.
#:
#: The tripwire treats ``notes`` as communication content, which is the right default: a
#: customer note or a call transcript must never reach a report. ``pipeline_run.notes`` is
#: machine-written operational text about a load -- "database load completed", or the
#: reason the database step was skipped -- and describes no person at all. The exception
#: is listed here, one row per column, rather than by weakening the vocabulary, so it
#: stays visible in a diff and a reviewer can challenge it.
#:
#: Inventory-age columns are NOT listed here. They are handled by
#: ``arpi.constants.APPROVED_ASSET_AGE_COLUMNS``, because an asset's age is a general
#: distinction the tripwire itself should draw rather than a one-off exemption.
JUSTIFIED_PRIVACY_EXCEPTIONS: frozenset[tuple[str, str]] = frozenset(
    {("vw_pipeline_run_summary", "notes")}
)


@pytest.fixture()
def reporter_cursor(loaded_db: Any) -> Any:
    """A cursor whose session role is ``arpi_reporter``.

    ``SET ROLE`` is reverted by the transaction rollback the ``loaded_db`` fixture
    performs, so no other test inherits it.
    """
    with loaded_db.cursor() as cursor:
        cursor.execute("SET ROLE arpi_reporter")
        yield cursor


@pytest.mark.parametrize(("label", "statement"), MVP_QUERIES, ids=[q[0] for q in MVP_QUERIES])
def test_the_reporter_can_run_every_mvp_query(
    reporter_cursor: Any, label: str, statement: str
) -> None:
    """Each representative MVP query runs as the reporter and returns rows."""
    reporter_cursor.execute(statement)
    rows = reporter_cursor.fetchall()
    assert rows, f"the MVP query {label!r} returned no rows as arpi_reporter"


@pytest.mark.parametrize("view_name", REPORTING_VIEWS)
def test_the_reporter_can_select_every_reporting_view(reporter_cursor: Any, view_name: str) -> None:
    reporter_cursor.execute(f"SELECT count(*) FROM reporting.{view_name}")
    assert reporter_cursor.fetchone() is not None


@pytest.mark.parametrize("qualified_name", FORBIDDEN_OBJECTS)
def test_the_reporter_cannot_read_the_pipeline_layers(
    reporter_cursor: Any, qualified_name: str
) -> None:
    """The deny path is asserted by running the query, not by trusting a grant."""
    import psycopg

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        reporter_cursor.execute(f"SELECT count(*) FROM {qualified_name}")


def test_the_reporter_holds_no_privilege_on_any_pipeline_object(loaded_cursor: Any) -> None:
    """Asserted over every object that exists, not against a hand-written list.

    A hand-written list goes stale the moment an increment adds a table. This loop covers
    whatever the schema holds right now, so a new raw table or audit table is included
    without anyone remembering to extend the test.
    """
    loaded_cursor.execute(
        """
        SELECT n.nspname, c.relname, p.privilege
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES'])
              AS p(privilege)
        WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND has_table_privilege('arpi_reporter', c.oid, p.privilege)
        ORDER BY 1, 2, 3
        """
    )
    assert loaded_cursor.fetchall() == []


def test_the_reporter_holds_no_usage_on_any_pipeline_schema(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        """
        SELECT s.schema_name
        FROM unnest(ARRAY['raw', 'staging', 'warehouse', 'audit']) AS s(schema_name)
        WHERE has_schema_privilege('arpi_reporter', s.schema_name, 'USAGE')
        ORDER BY 1
        """
    )
    assert loaded_cursor.fetchall() == []


def test_the_reporter_is_read_only_on_reporting(reporter_cursor: Any) -> None:
    """Read-only means read-only, including on the views themselves."""
    import psycopg

    with pytest.raises(
        (psycopg.errors.InsufficientPrivilege, psycopg.errors.ObjectNotInPrerequisiteState)
    ):
        reporter_cursor.execute(
            "INSERT INTO reporting.vw_dealership (dealership_key) VALUES (999999)"
        )


def test_reporting_views_expose_no_prohibited_field(loaded_cursor: Any) -> None:
    """No name, contact detail, precise age, precise geography or pay field is published.

    The vocabulary is the project's own privacy tripwire, applied to the reporting layer
    rather than to a generated frame. Column names that legitimately end in ``name`` --
    store_name, model_name, campaign_name -- are allowed by the same explicit allowlist
    the generators use, so a future ``salesperson_name`` fails without anyone having to
    remember to add it to a blocklist first.
    """
    from arpi.validation.privacy import prohibited_columns

    loaded_cursor.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'reporting'
        ORDER BY table_name, ordinal_position
        """
    )
    by_view: dict[str, list[str]] = {}
    for table_name, column_name in loaded_cursor.fetchall():
        by_view.setdefault(table_name, []).append(column_name)

    offences = {
        view_name: tuple(
            column
            for column in prohibited_columns(columns)
            if (view_name, column) not in JUSTIFIED_PRIVACY_EXCEPTIONS
        )
        for view_name, columns in by_view.items()
    }
    offences = {view_name: found for view_name, found in offences.items() if found}
    assert not offences, f"prohibited fields reached the reporting layer: {offences}"
