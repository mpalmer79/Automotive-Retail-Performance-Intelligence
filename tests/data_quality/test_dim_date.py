"""Data-quality assertions over the generated calendar dimension.

These tests run the real generator. They never touch a database.
"""

from __future__ import annotations

from datetime import date, timedelta
from itertools import pairwise
from typing import Any, cast

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    DAY_NAMES,
    DIM_DATE_COLUMNS,
    DIM_DATE_REQUIRED_COLUMNS,
    MONTH_NAMES,
    PROHIBITED_PII_FIELD_NAMES,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.utilities.dates import date_key

pytestmark = pytest.mark.data_quality


def _records(frame: pd.DataFrame) -> list[dict[Any, Any]]:
    """Iterate rows as plain dictionaries, which keeps the value types simple."""
    return frame.to_dict(orient="records")


def _as_date(value: Any) -> date:
    """Narrow a pandas timestamp cell to a plain :class:`datetime.date`."""
    return cast(pd.Timestamp, value).date()


@pytest.fixture(scope="module")
def calendar_2025() -> pd.DataFrame:
    """A full calendar year, so every holiday rule is exercised."""
    from pathlib import Path

    config = load_config(
        profile="development",
        config_dir=Path(__file__).resolve().parents[2] / "config",
        env={
            "ARPI_REPORTING__START_DATE": "2025-01-01",
            "ARPI_REPORTING__END_DATE": "2025-12-31",
        },
    )
    return generate_date_dataset(config).frame


def test_column_set_and_order_match_the_contract(date_dataset: GeneratedDataset) -> None:
    assert tuple(date_dataset.frame.columns) == DIM_DATE_COLUMNS
    assert len(DIM_DATE_COLUMNS) == 26


def test_dtypes_match_the_contract(date_dataset: GeneratedDataset) -> None:
    dtypes = date_dataset.frame.dtypes
    assert str(dtypes["date_key"]) == "int32"
    assert str(dtypes["full_date"]) == "datetime64[ns]"
    assert str(dtypes["day_of_month"]) == "int16"
    assert str(dtypes["day_name"]) == "string"
    assert str(dtypes["is_weekend"]) == "bool"
    assert str(dtypes["holiday_name"]) == "string"


def test_date_key_is_unique(date_dataset: GeneratedDataset) -> None:
    keys = date_dataset.frame["date_key"]
    assert keys.is_unique
    assert len(keys) == date_dataset.row_count


def test_date_range_is_contiguous_and_correctly_sized(
    date_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    dates = [value.date() for value in pd.to_datetime(date_dataset.frame["full_date"])]
    assert dates[0] == test_config.reporting.start_date
    assert dates[-1] == test_config.reporting.end_date
    assert len(dates) == test_config.reporting.date_count == 59
    gaps = {second - first for first, second in pairwise(dates)}
    assert gaps == {timedelta(days=1)}


def test_date_key_encodes_full_date(date_dataset: GeneratedDataset) -> None:
    frame = date_dataset.frame
    expected = [date_key(value.date()) for value in pd.to_datetime(frame["full_date"])]
    assert list(frame["date_key"]) == expected


def test_no_nulls_in_required_columns(date_dataset: GeneratedDataset) -> None:
    frame = date_dataset.frame
    assert not frame[list(DIM_DATE_REQUIRED_COLUMNS)].isna().to_numpy().any()


def test_holiday_name_is_null_exactly_when_not_a_holiday(calendar_2025: pd.DataFrame) -> None:
    assert (calendar_2025["holiday_name"].isna() != calendar_2025["is_holiday"]).all()


def test_iso_weekday_and_day_name_agree(calendar_2025: pd.DataFrame) -> None:
    for row in _records(calendar_2025):
        value = _as_date(row["full_date"])
        assert row["day_of_week"] == value.isoweekday()
        assert row["day_name"] == DAY_NAMES[value.weekday()]
        assert row["is_weekend"] == (value.isoweekday() >= 6)


def test_month_and_quarter_attributes(calendar_2025: pd.DataFrame) -> None:
    for row in _records(calendar_2025):
        value = _as_date(row["full_date"])
        assert row["month_name"] == MONTH_NAMES[value.month - 1]
        assert row["quarter_number"] == (value.month - 1) // 3 + 1
        assert row["quarter_name"] == f"Q{int(row['quarter_number'])}"
        assert _as_date(row["month_start_date"]) == value.replace(day=1)
        assert _as_date(row["month_end_date"]) >= value
        assert row["fiscal_month"] == row["month_number"]
        assert row["fiscal_quarter"] == row["quarter_number"]
        assert row["fiscal_year"] == row["calendar_year"]


def test_iso_week_and_iso_year(calendar_2025: pd.DataFrame) -> None:
    for row in _records(calendar_2025):
        iso = _as_date(row["full_date"]).isocalendar()
        assert row["iso_year"] == iso.year
        assert row["week_of_year"] == iso.week


def test_month_end_flags(calendar_2025: pd.DataFrame) -> None:
    month_ends = {
        value.date()
        for value in pd.to_datetime(calendar_2025.loc[calendar_2025["is_month_end"], "full_date"])
    }
    assert len(month_ends) == 12
    assert date(2025, 2, 28) in month_ends
    assert date(2025, 4, 30) in month_ends
    assert date(2025, 12, 31) in month_ends


def test_quarter_end_flags(calendar_2025: pd.DataFrame) -> None:
    quarter_ends = {
        value.date()
        for value in pd.to_datetime(calendar_2025.loc[calendar_2025["is_quarter_end"], "full_date"])
    }
    assert quarter_ends == {
        date(2025, 3, 31),
        date(2025, 6, 30),
        date(2025, 9, 30),
        date(2025, 12, 31),
    }


def test_year_end_flag(calendar_2025: pd.DataFrame) -> None:
    year_ends = calendar_2025.loc[calendar_2025["is_year_end"], "full_date"]
    assert len(year_ends) == 1
    assert year_ends.iloc[0].date() == date(2025, 12, 31)


def test_leap_day_is_present_and_correct() -> None:
    from pathlib import Path

    config = load_config(
        profile="portfolio",
        config_dir=Path(__file__).resolve().parents[2] / "config",
        env={
            "ARPI_REPORTING__START_DATE": "2024-02-01",
            "ARPI_REPORTING__END_DATE": "2024-03-01",
        },
    )
    frame = generate_date_dataset(config).frame
    leap = frame[frame["date_key"] == 20240229]
    assert len(leap) == 1
    assert bool(leap.iloc[0]["is_month_end"]) is True
    assert int(leap.iloc[0]["day_of_year"]) == 60


@pytest.mark.parametrize(
    ("day", "name", "closure"),
    [
        (20250101, "New Year's Day", True),
        (20250120, "Martin Luther King Jr. Day", False),
        (20250217, "Presidents Day", False),
        (20250420, "Easter Sunday", True),
        (20250526, "Memorial Day", False),
        (20250619, "Juneteenth National Independence Day", False),
        (20250704, "Independence Day", True),
        (20250901, "Labor Day", False),
        (20251013, "Columbus Day", False),
        (20251111, "Veterans Day", False),
        (20251127, "Thanksgiving Day", True),
        (20251225, "Christmas Day", True),
    ],
)
def test_known_holidays(calendar_2025: pd.DataFrame, day: int, name: str, closure: bool) -> None:
    row = calendar_2025[calendar_2025["date_key"] == day].iloc[0]
    assert bool(row["is_holiday"]) is True
    assert row["holiday_name"] == name
    assert bool(row["is_closure_holiday"]) is closure
    assert bool(row["is_selling_day"]) is not closure


def test_memorial_day_remains_a_selling_day(calendar_2025: pd.DataFrame) -> None:
    row = calendar_2025[calendar_2025["date_key"] == 20250526].iloc[0]
    assert bool(row["is_selling_day"]) is True


def test_weekends_are_selling_days(calendar_2025: pd.DataFrame) -> None:
    # New Hampshire permits Sunday vehicle sales, so a weekend is a selling day
    # unless it also happens to be a closure holiday.
    weekends = calendar_2025[calendar_2025["is_weekend"] & ~calendar_2025["is_closure_holiday"]]
    assert weekends["is_selling_day"].all()
    assert len(weekends) > 100


def test_selling_day_is_the_negation_of_closure(calendar_2025: pd.DataFrame) -> None:
    assert (calendar_2025["is_selling_day"] != calendar_2025["is_closure_holiday"]).all()


def test_only_five_closure_days_per_year(calendar_2025: pd.DataFrame) -> None:
    assert int(calendar_2025["is_closure_holiday"].sum()) == 5
    assert int(calendar_2025["is_holiday"].sum()) == 12


def test_selling_day_ratio_sits_inside_the_configured_band(
    calendar_2025: pd.DataFrame, test_config: ArpiConfig
) -> None:
    ratio = float(calendar_2025["is_selling_day"].mean())
    assert test_config.validation.min_selling_day_ratio <= ratio
    assert ratio <= test_config.validation.max_selling_day_ratio


def test_no_prohibited_pii_columns(date_dataset: GeneratedDataset) -> None:
    columns = {column.lower() for column in date_dataset.frame.columns}
    assert not columns & PROHIBITED_PII_FIELD_NAMES


def test_the_calendar_is_not_stochastic(repo_config_dir: object) -> None:
    from arpi.generation.writer import dataframe_to_csv_bytes

    baseline = load_config(profile="test", config_dir=repo_config_dir)  # type: ignore[arg-type]
    reseeded = load_config(
        profile="test",
        config_dir=repo_config_dir,  # type: ignore[arg-type]
        env={"ARPI_RANDOM_SEED": "999999"},
    )
    assert baseline.random_seed != reseeded.random_seed
    assert dataframe_to_csv_bytes(generate_date_dataset(baseline).frame) == (
        dataframe_to_csv_bytes(generate_date_dataset(reseeded).frame)
    )
