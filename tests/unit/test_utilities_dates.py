"""Calendar helpers: computus, weekday arithmetic, holidays and date keys."""

from __future__ import annotations

from datetime import date

import pytest

from arpi.exceptions import ValidationError
from arpi.utilities.dates import (
    FRIDAY,
    MONDAY,
    SUNDAY,
    THURSDAY,
    Holiday,
    add_years,
    date_from_key,
    date_key,
    easter_sunday,
    holidays_for_year,
    iter_dates,
    last_weekday_of_month,
    merge_holidays,
    nth_weekday_of_month,
)

# Independently verifiable Gregorian Easter dates.
EASTER_GOLDEN = {
    1900: date(1900, 4, 15),
    2000: date(2000, 4, 23),
    2020: date(2020, 4, 12),
    2021: date(2021, 4, 4),
    2022: date(2022, 4, 17),
    2023: date(2023, 4, 9),
    2024: date(2024, 3, 31),
    2025: date(2025, 4, 20),
    2026: date(2026, 4, 5),
    2038: date(2038, 4, 25),
}

HOLIDAYS_2025 = {
    date(2025, 1, 1): ("New Year's Day", True),
    date(2025, 1, 20): ("Martin Luther King Jr. Day", False),
    date(2025, 2, 17): ("Presidents Day", False),
    date(2025, 4, 20): ("Easter Sunday", True),
    date(2025, 5, 26): ("Memorial Day", False),
    date(2025, 6, 19): ("Juneteenth National Independence Day", False),
    date(2025, 7, 4): ("Independence Day", True),
    date(2025, 9, 1): ("Labor Day", False),
    date(2025, 10, 13): ("Columbus Day", False),
    date(2025, 11, 11): ("Veterans Day", False),
    date(2025, 11, 27): ("Thanksgiving Day", True),
    date(2025, 12, 25): ("Christmas Day", True),
}


@pytest.mark.parametrize(("year", "expected"), sorted(EASTER_GOLDEN.items()))
def test_easter_sunday_golden_values(year: int, expected: date) -> None:
    assert easter_sunday(year) == expected


def test_easter_sunday_always_falls_on_a_sunday() -> None:
    assert all(easter_sunday(year).weekday() == SUNDAY for year in range(1990, 2060))


def test_easter_sunday_rejects_a_non_gregorian_year() -> None:
    with pytest.raises(ValidationError, match="positive Gregorian year"):
        easter_sunday(0)


def test_nth_weekday_of_month() -> None:
    assert nth_weekday_of_month(2025, 1, MONDAY, 1) == date(2025, 1, 6)
    assert nth_weekday_of_month(2025, 1, MONDAY, 3) == date(2025, 1, 20)
    assert nth_weekday_of_month(2025, 11, THURSDAY, 4) == date(2025, 11, 27)
    assert nth_weekday_of_month(2024, 2, THURSDAY, 5) == date(2024, 2, 29)


def test_nth_weekday_of_month_rejects_an_impossible_occurrence() -> None:
    with pytest.raises(ValidationError, match="fewer than 5"):
        nth_weekday_of_month(2025, 2, MONDAY, 5)


@pytest.mark.parametrize(
    ("year", "month", "weekday", "n", "match"),
    [
        (2025, 13, MONDAY, 1, "month must be"),
        (2025, 0, MONDAY, 1, "month must be"),
        (2025, 1, 7, 1, "weekday must be"),
        (2025, 1, MONDAY, 0, "n must be"),
    ],
)
def test_nth_weekday_of_month_argument_validation(
    year: int, month: int, weekday: int, n: int, match: str
) -> None:
    with pytest.raises(ValidationError, match=match):
        nth_weekday_of_month(year, month, weekday, n)


def test_last_weekday_of_month() -> None:
    assert last_weekday_of_month(2025, 5, MONDAY) == date(2025, 5, 26)
    assert last_weekday_of_month(2025, 12, FRIDAY) == date(2025, 12, 26)
    assert last_weekday_of_month(2024, 2, THURSDAY) == date(2024, 2, 29)


def test_last_weekday_of_month_argument_validation() -> None:
    with pytest.raises(ValidationError, match="weekday must be"):
        last_weekday_of_month(2025, 5, -1)


def test_holidays_for_2025_match_the_contract() -> None:
    holidays = holidays_for_year(2025)
    assert {day: (holiday.name, holiday.closure) for day, holiday in holidays.items()} == (
        HOLIDAYS_2025
    )


def test_closure_holidays_are_exactly_the_documented_five() -> None:
    closures = {day for day, holiday in holidays_for_year(2025).items() if holiday.closure}
    assert closures == {
        date(2025, 1, 1),
        date(2025, 4, 20),
        date(2025, 7, 4),
        date(2025, 11, 27),
        date(2025, 12, 25),
    }


def test_every_year_recognises_twelve_or_fewer_dates() -> None:
    for year in range(2020, 2035):
        holidays = holidays_for_year(year)
        assert 11 <= len(holidays) <= 12
        assert all(day.year == year for day in holidays)


def test_a_collision_keeps_the_first_name_and_ors_the_closure() -> None:
    # No pair of contract rules can actually collide, so the precedence rule is proved
    # against the merge helper directly.
    day = date(2025, 3, 17)
    merged = merge_holidays(
        [
            (day, Holiday("First Named", closure=False)),
            (day, Holiday("Second Named", closure=True)),
            (day, Holiday("Third Named", closure=False)),
        ]
    )
    assert merged[day] == Holiday("First Named", closure=True)


def test_a_collision_between_open_holidays_stays_open() -> None:
    day = date(2025, 3, 17)
    merged = merge_holidays(
        [(day, Holiday("First", closure=False)), (day, Holiday("Second", closure=False))]
    )
    assert merged[day] == Holiday("First", closure=False)


def test_a_collision_after_a_closure_keeps_the_closure() -> None:
    day = date(2025, 3, 17)
    merged = merge_holidays(
        [(day, Holiday("First", closure=True)), (day, Holiday("Second", closure=False))]
    )
    assert merged[day] == Holiday("First", closure=True)


def test_holiday_is_frozen() -> None:
    holiday = Holiday("Test Day", closure=False)
    with pytest.raises(AttributeError):
        holiday.name = "Other"  # type: ignore[misc]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (date(2025, 7, 4), 20250704),
        (date(1999, 12, 31), 19991231),
        (date(9999, 12, 31), 99991231),
    ],
)
def test_date_key(value: date, expected: int) -> None:
    assert date_key(value) == expected


def test_date_key_round_trip() -> None:
    for offset in range(0, 4000, 7):
        value = date(2020, 1, 1).toordinal() + offset
        original = date.fromordinal(value)
        assert date_from_key(date_key(original)) == original


@pytest.mark.parametrize("key", [0, 9, 100000000, 20250230, 20251301])
def test_date_from_key_rejects_bad_keys(key: int) -> None:
    with pytest.raises(ValidationError):
        date_from_key(key)


def test_iter_dates_is_inclusive() -> None:
    days = list(iter_dates(date(2025, 1, 30), date(2025, 2, 2)))
    assert days == [
        date(2025, 1, 30),
        date(2025, 1, 31),
        date(2025, 2, 1),
        date(2025, 2, 2),
    ]


def test_iter_dates_rejects_an_inverted_range() -> None:
    with pytest.raises(ValidationError, match="must not precede"):
        list(iter_dates(date(2025, 2, 1), date(2025, 1, 1)))


def test_add_years_clamps_the_leap_day() -> None:
    assert add_years(date(2024, 2, 29), 1) == date(2025, 3, 1)
    assert add_years(date(2024, 2, 29), 4) == date(2028, 2, 29)
    assert add_years(date(2025, 7, 1), 40) == date(2065, 7, 1)
