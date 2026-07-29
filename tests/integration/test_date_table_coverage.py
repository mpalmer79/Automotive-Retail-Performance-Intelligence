"""``reporting.vw_calendar`` is a valid marked date table for every fact date key.

A Power BI date table has to satisfy three conditions before time intelligence works at
all: one row per date, no gaps, and full coverage of every date the facts reference. A
model marked as a date table that violates any of them produces wrong answers silently --
year-to-date figures that skip a week, or a fact row that falls outside the calendar and
disappears from every time-based visual.

Every role-playing date key is checked separately. It is the ones nobody thinks about --
``delivery_date_key``, ``show_date_key`` -- that fall outside the calendar first, because
they can point past the end of the fact's own date range.
"""

from __future__ import annotations

from typing import Any

import pytest

pytestmark = pytest.mark.integration


#: Every date key on every fact view, with the role it plays.
FACT_DATE_KEYS: tuple[tuple[str, str, str], ...] = (
    ("vw_vehicle_sales", "sale_date_key", "the date the deal was finalized"),
    ("vw_vehicle_sales", "delivery_date_key", "the date the vehicle was delivered"),
    ("vw_inventory_snapshots", "snapshot_date_key", "the as-of date of the snapshot"),
    ("vw_leads", "lead_created_date_key", "the date the lead arrived"),
    ("vw_appointments", "created_date_key", "the date the appointment was booked"),
    ("vw_appointments", "scheduled_date_key", "the date the appointment was due"),
    ("vw_appointments", "show_date_key", "the date the customer arrived"),
    ("vw_marketing_spend", "month_date_key", "the first day of the spend month"),
)


def _scalar(cursor: Any, statement: str) -> Any:
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


def test_the_calendar_holds_exactly_one_row_per_date(loaded_cursor: Any) -> None:
    total = _scalar(loaded_cursor, "SELECT count(*) FROM reporting.vw_calendar")
    distinct_keys = _scalar(
        loaded_cursor, "SELECT count(DISTINCT date_key) FROM reporting.vw_calendar"
    )
    distinct_dates = _scalar(
        loaded_cursor, "SELECT count(DISTINCT calendar_date) FROM reporting.vw_calendar"
    )
    assert total == distinct_keys == distinct_dates


def test_the_calendar_is_contiguous(loaded_cursor: Any) -> None:
    """No gaps. A missing date silently drops a day out of every time calculation."""
    span = _scalar(
        loaded_cursor,
        "SELECT max(calendar_date) - min(calendar_date) + 1 FROM reporting.vw_calendar",
    )
    total = _scalar(loaded_cursor, "SELECT count(*) FROM reporting.vw_calendar")
    assert total == span


def test_the_date_key_and_the_date_agree(loaded_cursor: Any) -> None:
    """date_key is the integer YYYYMMDD form of calendar_date, on every row."""
    mismatches = _scalar(
        loaded_cursor,
        """
        SELECT count(*) FROM reporting.vw_calendar
        WHERE date_key <> (extract(year  FROM calendar_date)::integer * 10000)
                        + (extract(month FROM calendar_date)::integer * 100)
                        +  extract(day   FROM calendar_date)::integer
        """,
    )
    assert mismatches == 0


@pytest.mark.parametrize(
    ("view_name", "date_column", "role"),
    FACT_DATE_KEYS,
    ids=[f"{v}.{c}" for v, c, _ in FACT_DATE_KEYS],
)
def test_every_fact_date_key_resolves_to_the_calendar(
    loaded_cursor: Any, view_name: str, date_column: str, role: str
) -> None:
    unresolved = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM reporting.{view_name} AS f
        WHERE f.{date_column} IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM reporting.vw_calendar AS c WHERE c.date_key = f.{date_column})
        """,
    )
    assert unresolved == 0, (
        f"{unresolved} row(s) of reporting.{view_name}.{date_column} ({role}) fall outside "
        "reporting.vw_calendar; those rows would vanish from every time-based visual"
    )


def test_the_calendar_spans_the_full_range_of_every_fact(loaded_cursor: Any) -> None:
    """The calendar spans every fact date, on every role-playing key.

    It starts no later than the earliest fact date and ends no earlier than the latest,
    across every fact and every role at once.
    """
    calendar_min = _scalar(loaded_cursor, "SELECT min(date_key) FROM reporting.vw_calendar")
    calendar_max = _scalar(loaded_cursor, "SELECT max(date_key) FROM reporting.vw_calendar")

    for view_name, date_column, role in FACT_DATE_KEYS:
        bounds = _scalar(
            loaded_cursor,
            f"SELECT min({date_column}) FROM reporting.{view_name} WHERE {date_column} IS NOT NULL",
        )
        upper = _scalar(
            loaded_cursor,
            f"SELECT max({date_column}) FROM reporting.{view_name} WHERE {date_column} IS NOT NULL",
        )
        if bounds is None:
            continue
        assert bounds >= calendar_min, (
            f"reporting.{view_name}.{date_column} ({role}) starts at {bounds}, before the "
            f"calendar's first date {calendar_min}"
        )
        assert upper <= calendar_max, (
            f"reporting.{view_name}.{date_column} ({role}) ends at {upper}, after the "
            f"calendar's last date {calendar_max}"
        )


def test_every_marketing_spend_month_key_is_a_month_start(loaded_cursor: Any) -> None:
    """The one date key that carries a structural rule beyond resolving.

    Cost-per measures are valid only at month grain, and the guarantee is that spend can
    only ever be selected by a month-start date. A key that were not a month start would
    both break the join semantics and let a day-grain cost figure be computed.
    """
    offenders = _scalar(
        loaded_cursor,
        """
        SELECT count(*)
        FROM reporting.vw_marketing_spend AS m
        JOIN reporting.vw_calendar AS c ON c.date_key = m.month_date_key
        WHERE c.calendar_date <> c.month_start_date
        """,
    )
    assert offenders == 0


def test_the_calendar_carries_the_attributes_a_marked_date_table_needs(
    loaded_cursor: Any,
) -> None:
    """Year, quarter, month and a chronological sort key for the month label.

    Without year_month_number a report sorts "2025-10" before "2025-2" and nobody notices
    until a trend line is read backwards.
    """
    loaded_cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'reporting' AND table_name = 'vw_calendar'
        """
    )
    columns = {row[0] for row in loaded_cursor.fetchall()}
    required = {
        "date_key",
        "calendar_date",
        "calendar_year",
        "quarter_number",
        "quarter_name",
        "month_number",
        "month_name",
        "month_start_date",
        "month_end_date",
        "year_month_number",
        "year_month_label",
        "is_selling_day",
    }
    assert required <= columns, f"vw_calendar is missing {sorted(required - columns)}"
