"""Calendar helpers: holiday computation, weekday arithmetic and date-key conversion.

Holidays are computed from first principles rather than pulled from a third-party
package, so the calendar dimension is fully deterministic, offline-reproducible and
auditable from this source file alone.
"""

from __future__ import annotations

import calendar
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from arpi.exceptions import ValidationError

MONDAY: Final = 0
TUESDAY: Final = 1
WEDNESDAY: Final = 2
THURSDAY: Final = 3
FRIDAY: Final = 4
SATURDAY: Final = 5
SUNDAY: Final = 6

DAYS_PER_WEEK: Final = 7
_MIN_DATE_KEY: Final = 10_000_101
_MAX_DATE_KEY: Final = 99_991_231


@dataclass(frozen=True, slots=True)
class Holiday:
    """An observed holiday.

    Attributes:
        name: Display name written to ``dim_date.holiday_name``.
        closure: ``True`` when the showroom is closed, which makes the date a
            non-selling day.
    """

    name: str
    closure: bool


def easter_sunday(year: int) -> date:
    """Compute Easter Sunday using the anonymous Gregorian computus.

    The "anonymous Gregorian algorithm" (also published as Meeus/Jones/Butcher) is a
    closed-form arithmetic method valid for every year in the Gregorian calendar. It
    requires no tables and no external dependency.

    Args:
        year: Gregorian year, must be positive.

    Returns:
        The date of Easter Sunday in ``year``.

    Raises:
        ValidationError: If ``year`` is not a positive Gregorian year.
    """
    if year < 1:
        raise ValidationError(
            f"year must be a positive Gregorian year, got {year}.", field="year"
        )
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> date:
    """Return the ``n``-th occurrence of ``weekday`` in a month.

    Args:
        year: Gregorian year.
        month: Month number, 1-12.
        weekday: Weekday using the :meth:`datetime.date.weekday` convention
            (0 = Monday ... 6 = Sunday).
        n: Occurrence number, 1-5 (``1`` is the first occurrence).

    Returns:
        The date of the ``n``-th ``weekday`` in the given month.

    Raises:
        ValidationError: If any argument is out of range, or the month has fewer than
            ``n`` occurrences of ``weekday``.
    """
    _validate_month(month)
    _validate_weekday(weekday)
    if n < 1:
        raise ValidationError(f"n must be 1 or greater, got {n}.", field="n")
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % DAYS_PER_WEEK
    day = 1 + offset + (n - 1) * DAYS_PER_WEEK
    days_in_month = calendar.monthrange(year, month)[1]
    if day > days_in_month:
        raise ValidationError(
            f"{year}-{month:02d} has fewer than {n} occurrences of weekday {weekday}.",
            field="n",
        )
    return date(year, month, day)


def last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    """Return the final occurrence of ``weekday`` in a month.

    Args:
        year: Gregorian year.
        month: Month number, 1-12.
        weekday: Weekday using the :meth:`datetime.date.weekday` convention
            (0 = Monday ... 6 = Sunday).

    Returns:
        The date of the last ``weekday`` in the given month.
    """
    _validate_month(month)
    _validate_weekday(weekday)
    days_in_month = calendar.monthrange(year, month)[1]
    last = date(year, month, days_in_month)
    return last - timedelta(days=(last.weekday() - weekday) % DAYS_PER_WEEK)


def holidays_for_year(year: int) -> dict[date, Holiday]:
    """Build the observed-holiday table for a single calendar year.

    The rules, and their precedence, are fixed by the Phase 0 contract:

    ===================================== ================================== =======
    Holiday                               Rule                               Closure
    ===================================== ================================== =======
    New Year's Day                        January 1                          yes
    Martin Luther King Jr. Day            3rd Monday in January              no
    Presidents Day                        3rd Monday in February             no
    Easter Sunday                         Anonymous Gregorian computus       yes
    Memorial Day                          last Monday in May                 no
    Juneteenth National Independence Day  June 19                            no
    Independence Day                      July 4                             yes
    Labor Day                             1st Monday in September            no
    Columbus Day                          2nd Monday in October              no
    Veterans Day                          November 11                        no
    Thanksgiving Day                      4th Thursday in November           yes
    Christmas Day                         December 25                        yes
    ===================================== ================================== =======

    When two holidays land on the same date the ``holiday_name`` of the **first** match
    in the table above wins, and ``closure`` is the logical OR of every match.

    Args:
        year: Gregorian year to compute.

    Returns:
        Mapping of date to :class:`Holiday`, containing one entry per observed date.
    """
    ordered: list[tuple[date, Holiday]] = [
        (date(year, 1, 1), Holiday("New Year's Day", closure=True)),
        (
            nth_weekday_of_month(year, 1, MONDAY, 3),
            Holiday("Martin Luther King Jr. Day", closure=False),
        ),
        (nth_weekday_of_month(year, 2, MONDAY, 3), Holiday("Presidents Day", closure=False)),
        (easter_sunday(year), Holiday("Easter Sunday", closure=True)),
        (last_weekday_of_month(year, 5, MONDAY), Holiday("Memorial Day", closure=False)),
        (
            date(year, 6, 19),
            Holiday("Juneteenth National Independence Day", closure=False),
        ),
        (date(year, 7, 4), Holiday("Independence Day", closure=True)),
        (nth_weekday_of_month(year, 9, MONDAY, 1), Holiday("Labor Day", closure=False)),
        (nth_weekday_of_month(year, 10, MONDAY, 2), Holiday("Columbus Day", closure=False)),
        (date(year, 11, 11), Holiday("Veterans Day", closure=False)),
        (
            nth_weekday_of_month(year, 11, THURSDAY, 4),
            Holiday("Thanksgiving Day", closure=True),
        ),
        (date(year, 12, 25), Holiday("Christmas Day", closure=True)),
    ]

    observed: dict[date, Holiday] = {}
    for observed_date, holiday in ordered:
        existing = observed.get(observed_date)
        if existing is None:
            observed[observed_date] = holiday
        elif holiday.closure and not existing.closure:
            observed[observed_date] = Holiday(existing.name, closure=True)
    return observed


def date_key(value: date) -> int:
    """Convert a date to its ``YYYYMMDD`` integer surrogate key.

    Args:
        value: Calendar date.

    Returns:
        The ``YYYYMMDD`` integer key, e.g. ``20250704``.
    """
    return value.year * 10_000 + value.month * 100 + value.day


def date_from_key(key: int) -> date:
    """Convert a ``YYYYMMDD`` integer surrogate key back to a date.

    Args:
        key: Integer key produced by :func:`date_key`.

    Returns:
        The corresponding calendar date.

    Raises:
        ValidationError: If ``key`` is out of range or does not describe a real date.
    """
    if not _MIN_DATE_KEY <= key <= _MAX_DATE_KEY:
        raise ValidationError(
            f"date_key {key} is outside the supported range "
            f"[{_MIN_DATE_KEY}, {_MAX_DATE_KEY}].",
            field="date_key",
        )
    year, remainder = divmod(key, 10_000)
    month, day = divmod(remainder, 100)
    try:
        return date(year, month, day)
    except ValueError as error:
        raise ValidationError(
            f"date_key {key} does not describe a real calendar date: {error}.",
            field="date_key",
        ) from error


def iter_dates(start: date, end: date) -> Iterator[date]:
    """Yield every calendar date from ``start`` to ``end`` inclusive.

    Args:
        start: First date to yield.
        end: Last date to yield, inclusive.

    Yields:
        Consecutive calendar dates.

    Raises:
        ValidationError: If ``end`` precedes ``start``.
    """
    if end < start:
        raise ValidationError(
            f"end date {end.isoformat()} must not precede start date {start.isoformat()}.",
            field="end_date",
        )
    current = start
    step = timedelta(days=1)
    while current <= end:
        yield current
        current += step


def add_years(value: date, years: int) -> date:
    """Add whole years to a date, clamping 29 February onto 1 March.

    Args:
        value: Starting date.
        years: Number of whole years to add (may be negative).

    Returns:
        The shifted date.
    """
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        return date(value.year + years, 3, 1)


def _validate_month(month: int) -> None:
    """Raise if ``month`` is not a valid month number."""
    if not 1 <= month <= 12:
        raise ValidationError(f"month must be between 1 and 12, got {month}.", field="month")


def _validate_weekday(weekday: int) -> None:
    """Raise if ``weekday`` is not a valid ``date.weekday()`` value."""
    if not MONDAY <= weekday <= SUNDAY:
        raise ValidationError(
            f"weekday must be between 0 (Monday) and 6 (Sunday), got {weekday}.",
            field="weekday",
        )
