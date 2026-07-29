"""The reporting layer is complete, documented, grain-preserving and star-shaped.

This module answers the question Gate 1 actually asks about the reporting layer: can a
semantic model be built on ``reporting`` alone, without touching a warehouse table, and
does every object in it say what it is?

The checks fall into four groups:

* **Inventory** -- every MVP dimension and fact has a view, every governed analytical
  view exists, and nothing else lives in the schema. The expected set comes from
  :mod:`arpi.constants`, so a view added to the SQL tree without being declared there is
  a failure rather than a silent addition.
* **Documentation** -- every view and every column carries a comment, and every view
  comment declares its grain. A reporting layer nobody can read is not a deliverable.
* **Grain preservation** -- each fact view returns exactly the rows of the warehouse fact
  it projects. Two of them join a dimension to derive a column, and an inner join is the
  standard way a view silently loses rows.
* **Star-schema shape** -- every relationship column resolves to its dimension, so a
  one-directional model is possible and no view needs a bidirectional filter to make its
  measures work.
"""

from __future__ import annotations

from typing import Any

import pytest

from arpi.constants import (
    ANALYTICAL_VIEWS,
    MVP_DIMENSION_VIEWS,
    MVP_FACT_VIEWS,
    REPORTING_VIEWS,
)

pytestmark = pytest.mark.integration


#: Each fact view and the warehouse fact whose grain it must preserve exactly.
FACT_VIEW_SOURCES: tuple[tuple[str, str], ...] = (
    ("vw_vehicle_sales", "fact_vehicle_sale"),
    ("vw_inventory_snapshots", "fact_vehicle_inventory_snapshot"),
    ("vw_leads", "fact_lead"),
    ("vw_appointments", "fact_appointment"),
    ("vw_marketing_spend", "fact_marketing_spend"),
)

#: Every relationship column on a fact view, and the dimension view it must resolve to.
#:
#: This is the star schema written down. A one-directional model works only if every one
#: of these resolves; where a column is nullable the unresolved rows are the NULLs, and
#: the assertion allows exactly those.
RELATIONSHIP_COLUMNS: tuple[tuple[str, str, str, str], ...] = (
    ("vw_vehicle_sales", "sale_date_key", "vw_calendar", "date_key"),
    ("vw_vehicle_sales", "delivery_date_key", "vw_calendar", "date_key"),
    ("vw_vehicle_sales", "dealership_key", "vw_dealership", "dealership_key"),
    ("vw_vehicle_sales", "vehicle_key", "vw_vehicle", "vehicle_key"),
    ("vw_vehicle_sales", "vehicle_model_key", "vw_vehicle_model", "vehicle_model_key"),
    ("vw_vehicle_sales", "customer_key", "vw_customer", "customer_key"),
    ("vw_vehicle_sales", "salesperson_key", "vw_employee", "employee_key"),
    ("vw_vehicle_sales", "desk_manager_key", "vw_employee", "employee_key"),
    ("vw_vehicle_sales", "finance_manager_key", "vw_employee", "employee_key"),
    ("vw_vehicle_sales", "lead_source_key", "vw_lead_source", "lead_source_key"),
    ("vw_inventory_snapshots", "snapshot_date_key", "vw_calendar", "date_key"),
    ("vw_inventory_snapshots", "dealership_key", "vw_dealership", "dealership_key"),
    ("vw_inventory_snapshots", "vehicle_key", "vw_vehicle", "vehicle_key"),
    ("vw_inventory_snapshots", "vehicle_model_key", "vw_vehicle_model", "vehicle_model_key"),
    ("vw_leads", "lead_created_date_key", "vw_calendar", "date_key"),
    ("vw_leads", "dealership_key", "vw_dealership", "dealership_key"),
    ("vw_leads", "customer_key", "vw_customer", "customer_key"),
    ("vw_leads", "vehicle_model_key", "vw_vehicle_model", "vehicle_model_key"),
    ("vw_leads", "lead_source_key", "vw_lead_source", "lead_source_key"),
    ("vw_leads", "campaign_key", "vw_marketing_campaign", "campaign_key"),
    ("vw_leads", "assigned_employee_key", "vw_employee", "employee_key"),
    ("vw_leads", "sale_key", "vw_vehicle_sales", "sale_key"),
    ("vw_appointments", "created_date_key", "vw_calendar", "date_key"),
    ("vw_appointments", "scheduled_date_key", "vw_calendar", "date_key"),
    ("vw_appointments", "show_date_key", "vw_calendar", "date_key"),
    ("vw_appointments", "dealership_key", "vw_dealership", "dealership_key"),
    ("vw_appointments", "lead_key", "vw_leads", "lead_key"),
    ("vw_appointments", "customer_key", "vw_customer", "customer_key"),
    ("vw_appointments", "salesperson_key", "vw_employee", "employee_key"),
    ("vw_appointments", "bdc_employee_key", "vw_employee", "employee_key"),
    ("vw_appointments", "vehicle_model_key", "vw_vehicle_model", "vehicle_model_key"),
    ("vw_appointments", "sale_key", "vw_vehicle_sales", "sale_key"),
    ("vw_marketing_spend", "month_date_key", "vw_calendar", "date_key"),
    ("vw_marketing_spend", "dealership_key", "vw_dealership", "dealership_key"),
    ("vw_marketing_spend", "campaign_key", "vw_marketing_campaign", "campaign_key"),
    ("vw_marketing_spend", "lead_source_key", "vw_lead_source", "lead_source_key"),
)

#: Dimension views whose key must be unique, so every relationship is one-to-many.
#:
#: A duplicated key turns a one-to-many relationship into many-to-many, which Power BI
#: either refuses or resolves with a bidirectional bridge -- the exact thing this
#: reporting layer is designed not to need.
DIMENSION_KEYS: tuple[tuple[str, str], ...] = (
    ("vw_calendar", "date_key"),
    ("vw_dealership", "dealership_key"),
    ("vw_employee", "employee_key"),
    ("vw_customer", "customer_key"),
    ("vw_vehicle", "vehicle_key"),
    ("vw_vehicle_model", "vehicle_model_key"),
    ("vw_lead_source", "lead_source_key"),
    ("vw_marketing_campaign", "campaign_key"),
)


def _scalar(cursor: Any, statement: str) -> Any:
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


def test_the_reporting_schema_contains_exactly_the_declared_views(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        """
        SELECT table_name FROM information_schema.views
        WHERE table_schema = 'reporting' ORDER BY table_name
        """
    )
    assert [row[0] for row in loaded_cursor.fetchall()] == list(REPORTING_VIEWS)


@pytest.mark.parametrize("view_name", MVP_DIMENSION_VIEWS)
def test_every_mvp_dimension_has_a_view_with_rows(loaded_cursor: Any, view_name: str) -> None:
    # view_name comes from the literal tuple in arpi.constants, never from input.
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}") > 0


@pytest.mark.parametrize("view_name", MVP_FACT_VIEWS)
def test_every_mvp_fact_has_a_view_with_rows(loaded_cursor: Any, view_name: str) -> None:
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}") > 0


@pytest.mark.parametrize("view_name", ANALYTICAL_VIEWS)
def test_every_analytical_view_returns_rows(loaded_cursor: Any, view_name: str) -> None:
    """A governed analytical view that returns nothing owns a KPI nobody can compute."""
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}") > 0


@pytest.mark.parametrize("view_name", REPORTING_VIEWS)
def test_every_view_declares_its_grain(loaded_cursor: Any, view_name: str) -> None:
    loaded_cursor.execute(
        "SELECT obj_description(%s::regclass, 'pg_class')", (f"reporting.{view_name}",)
    )
    comment = loaded_cursor.fetchone()[0]
    assert comment, f"reporting.{view_name} has no COMMENT ON VIEW"
    assert "grain" in comment.lower(), f"reporting.{view_name} does not declare its grain"


@pytest.mark.parametrize("view_name", REPORTING_VIEWS)
def test_every_reporting_column_is_documented(loaded_cursor: Any, view_name: str) -> None:
    loaded_cursor.execute(
        """
        SELECT a.attname, col_description(a.attrelid, a.attnum)
        FROM pg_attribute AS a
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        """,
        (f"reporting.{view_name}",),
    )
    undocumented = [name for name, comment in loaded_cursor.fetchall() if not comment]
    assert not undocumented, f"reporting.{view_name} columns without a comment: {undocumented}"


@pytest.mark.parametrize(("view_name", "fact_table"), FACT_VIEW_SOURCES)
def test_fact_views_preserve_the_fact_grain(
    loaded_cursor: Any, view_name: str, fact_table: str
) -> None:
    """One view row per fact row, exactly.

    vw_vehicle_sales and vw_inventory_snapshots join dim_vehicle to derive the new/used
    split. Both fact columns are NOT NULL with a foreign key, so the join cannot drop a
    row today; this is what notices the day that stops being true.
    """
    view_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}")
    fact_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM warehouse.{fact_table}")
    assert view_rows == fact_rows, (
        f"reporting.{view_name} returns {view_rows} rows for {fact_rows} rows in "
        f"warehouse.{fact_table}; the view is not grain-preserving"
    )


@pytest.mark.parametrize(("view_name", "key_column"), DIMENSION_KEYS)
def test_dimension_keys_are_unique(loaded_cursor: Any, view_name: str, key_column: str) -> None:
    """Every dimension relates one-to-many, so no bidirectional bridge is ever needed."""
    total = _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}")
    distinct = _scalar(
        loaded_cursor, f"SELECT count(DISTINCT {key_column}) FROM reporting.{view_name}"
    )
    assert total == distinct, (
        f"reporting.{view_name}.{key_column} is not unique ({distinct} distinct of {total}); "
        "a duplicated dimension key forces a many-to-many relationship"
    )


@pytest.mark.parametrize(
    ("fact_view", "fact_column", "dimension_view", "dimension_column"), RELATIONSHIP_COLUMNS
)
def test_every_relationship_column_resolves(
    loaded_cursor: Any,
    fact_view: str,
    fact_column: str,
    dimension_view: str,
    dimension_column: str,
) -> None:
    """A one-directional star schema is possible only if every key resolves.

    NULL is permitted -- an anonymous lead has no customer, a wholesale disposal has no
    retail customer, a walk-in has no campaign -- and is what the semantic model's
    blank-row policy handles. A non-NULL key that resolves to nothing is not permitted.
    """
    orphans = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM reporting.{fact_view} AS f
        WHERE f.{fact_column} IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM reporting.{dimension_view} AS d
              WHERE d.{dimension_column} = f.{fact_column}
          )
        """,
    )
    assert orphans == 0, (
        f"{orphans} row(s) of reporting.{fact_view}.{fact_column} do not resolve to "
        f"reporting.{dimension_view}.{dimension_column}"
    )


def test_no_reporting_view_is_a_materialised_view_or_a_table(loaded_cursor: Any) -> None:
    """Every reporting object is a view; a physical one would need a measured reason."""
    loaded_cursor.execute(
        """
        SELECT c.relname, c.relkind
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'reporting' AND c.relkind <> 'v'
        ORDER BY c.relname
        """
    )
    assert loaded_cursor.fetchall() == []


def test_role_playing_dates_are_exposed_as_distinct_columns(loaded_cursor: Any) -> None:
    """Role-playing is handled with several date keys, never a duplicated calendar view.

    A duplicated calendar is the other way to model a role-playing date, and it is the
    wrong one here: it doubles the date table, breaks a marked date table, and makes
    time intelligence silently disagree between roles.
    """
    loaded_cursor.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'reporting' AND column_name LIKE '%%date_key'
        ORDER BY table_name, column_name
        """
    )
    by_view: dict[str, list[str]] = {}
    for table_name, column_name in loaded_cursor.fetchall():
        by_view.setdefault(table_name, []).append(column_name)

    assert by_view["vw_vehicle_sales"] == ["delivery_date_key", "sale_date_key"]
    assert by_view["vw_appointments"] == [
        "created_date_key",
        "scheduled_date_key",
        "show_date_key",
    ]
    assert by_view["vw_leads"] == ["lead_created_date_key"]
    assert by_view["vw_inventory_snapshots"] == ["snapshot_date_key"]
    assert by_view["vw_marketing_spend"] == ["month_date_key"]

    # And there is exactly one calendar view, not one per role.
    calendars = [name for name in REPORTING_VIEWS if "calendar" in name]
    assert calendars == ["vw_calendar"]
