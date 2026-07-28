"""Generator for ``warehouse.dim_date``.

The calendar dimension is **not stochastic**. Every column is a pure function of the
calendar date and of the holiday rules in :mod:`arpi.utilities.dates`, so the output
depends only on ``reporting.start_date`` and ``reporting.end_date`` -- never on
``random_seed``. The seed is still recorded in the generation manifest so that a
manifest fully describes the run that produced it.
"""

from __future__ import annotations

import calendar as stdlib_calendar
from datetime import date
from typing import TYPE_CHECKING, Any

import pandas as pd

from arpi.constants import (
    DAY_NAMES,
    DIM_DATE_COLUMNS,
    DIM_DATE_DTYPES,
    ENTITY_DIM_DATE,
    MONTH_NAMES,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.utilities.dates import Holiday, date_key, holidays_for_year, iter_dates

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

#: Seeding namespace recorded for this entity (unused: the calendar is deterministic).
CALENDAR_NAMESPACE = "dim_date"

_QUARTER_END_MONTHS = frozenset({3, 6, 9, 12})
_DECEMBER = 12
_NEW_YEARS_EVE_DAY = 31
_FIRST_WEEKEND_WEEKDAY = 5


class CalendarDateGenerator(BaseGenerator):
    """Build one ``dim_date`` row per calendar date in the reporting window."""

    entity_name = ENTITY_DIM_DATE
    declared_columns = DIM_DATE_COLUMNS
    namespace = CALENDAR_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the calendar frame for the configured reporting window.

        Args:
            config: Resolved configuration supplying the inclusive reporting window.

        Returns:
            A frame with the 26 contract columns, in order, one row per date.
        """
        start = config.reporting.start_date
        end = config.reporting.end_date
        holidays = _holiday_lookup(start.year, end.year)
        records = [_build_row(day, holidays.get(day)) for day in iter_dates(start, end)]
        frame = pd.DataFrame.from_records(records, columns=list(DIM_DATE_COLUMNS))
        return frame.astype(DIM_DATE_DTYPES)


def generate_date_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_date`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return CalendarDateGenerator().generate(config)


def _holiday_lookup(first_year: int, last_year: int) -> dict[date, Holiday]:
    """Build one holiday table spanning every year touched by the reporting window."""
    lookup: dict[date, Holiday] = {}
    for year in range(first_year, last_year + 1):
        lookup.update(holidays_for_year(year))
    return lookup


def _build_row(day: date, holiday: Holiday | None) -> dict[str, Any]:
    """Derive every contract column for a single calendar date."""
    iso_year, iso_week, iso_weekday = day.isocalendar()
    days_in_month = stdlib_calendar.monthrange(day.year, day.month)[1]
    month_start = date(day.year, day.month, 1)
    month_end = date(day.year, day.month, days_in_month)
    quarter = (day.month - 1) // 3 + 1
    is_month_end = day == month_end
    is_closure_holiday = holiday is not None and holiday.closure

    return {
        "date_key": date_key(day),
        "full_date": day,
        "day_of_month": day.day,
        "day_name": DAY_NAMES[day.weekday()],
        "day_of_week": iso_weekday,
        "day_of_year": day.timetuple().tm_yday,
        "week_of_year": iso_week,
        "iso_year": iso_year,
        "month_number": day.month,
        "month_name": MONTH_NAMES[day.month - 1],
        "month_start_date": month_start,
        "month_end_date": month_end,
        "quarter_number": quarter,
        "quarter_name": f"Q{quarter}",
        "calendar_year": day.year,
        "fiscal_month": day.month,
        "fiscal_quarter": quarter,
        "fiscal_year": day.year,
        "is_weekend": day.weekday() >= _FIRST_WEEKEND_WEEKDAY,
        "is_month_end": is_month_end,
        "is_quarter_end": is_month_end and day.month in _QUARTER_END_MONTHS,
        "is_year_end": day.month == _DECEMBER and day.day == _NEW_YEARS_EVE_DAY,
        "is_holiday": holiday is not None,
        "holiday_name": holiday.name if holiday is not None else None,
        "is_closure_holiday": is_closure_holiday,
        "is_selling_day": not is_closure_holiday,
    }
