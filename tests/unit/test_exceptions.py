"""Exception hierarchy and message quality."""

from __future__ import annotations

from pathlib import Path

import pytest

from arpi.exceptions import (
    ArpiError,
    ConfigurationError,
    DatabaseLoadError,
    DatabaseUnavailableError,
    DataQualityError,
    GenerationError,
    ProfileNotFoundError,
    ValidationError,
)

ALL_ERRORS = [
    ConfigurationError,
    ProfileNotFoundError,
    ValidationError,
    DataQualityError,
    GenerationError,
    DatabaseUnavailableError,
    DatabaseLoadError,
]


@pytest.mark.parametrize("error_type", ALL_ERRORS)
def test_every_error_derives_from_arpi_error(error_type: type[Exception]) -> None:
    assert issubclass(error_type, ArpiError)


def test_arpi_error_is_not_a_value_error() -> None:
    # pydantic v2 wraps ValueError raised inside validators, which would swallow the
    # actionable message; ArpiError must therefore stay outside that hierarchy.
    assert not issubclass(ArpiError, ValueError)


def test_base_error_renders_details() -> None:
    error = ArpiError("something broke", entity="dim_date", rows=3)
    assert "something broke" in str(error)
    assert "entity='dim_date'" in str(error)
    assert "rows=3" in str(error)
    assert error.details == {"entity": "dim_date", "rows": 3}


def test_base_error_without_details_is_just_the_message() -> None:
    assert str(ArpiError("plain")) == "plain"


def test_configuration_error_records_path_and_keys() -> None:
    error = ConfigurationError("bad", config_path=Path("/x/config"), keys=["a.b"])
    assert error.config_path == Path("/x/config")
    assert error.keys == ("a.b",)
    assert "/x/config" in str(error)


def test_profile_not_found_lists_alternatives() -> None:
    error = ProfileNotFoundError("staging", ["development", "test"], Path("/x/config"))
    assert error.profile == "staging"
    assert error.available == ("development", "test")
    assert "development, test" in str(error)
    assert "--profile" in str(error)


def test_profile_not_found_handles_an_empty_directory() -> None:
    assert "<none found>" in str(ProfileNotFoundError("x", [], Path("/x")))


def test_validation_error_records_the_field() -> None:
    error = ValidationError("bad value", field="random_seed")
    assert error.field == "random_seed"
    assert "random_seed" in str(error)


def test_data_quality_error_records_failed_checks() -> None:
    error = DataQualityError("2 checks failed", failed_check_ids=["DQ-DATE-001"])
    assert error.failed_check_ids == ("DQ-DATE-001",)
    assert "DQ-DATE-001" in str(error)


def test_generation_error_records_the_entity() -> None:
    error = GenerationError("cannot build", entity="dim_dealership", defined=3)
    assert error.entity == "dim_dealership"
    assert "defined=3" in str(error)


def test_database_unavailable_carries_remediation() -> None:
    error = DatabaseUnavailableError("no psycopg", reason="psycopg_missing", remediation="pip")
    assert error.reason == "psycopg_missing"
    assert error.remediation == "pip"
    assert "psycopg_missing" in str(error)


def test_database_unavailable_without_remediation() -> None:
    error = DatabaseUnavailableError("nope", reason="database_disabled")
    assert error.remediation is None
    assert "remediation" not in str(error)


def test_database_load_error_names_missing_paths() -> None:
    error = DatabaseLoadError(
        "missing sql",
        entity="dim_date",
        missing_paths=[Path("sql/03_dimensions")],
        context={"batch": "abc"},
    )
    assert error.missing_paths == (Path("sql/03_dimensions"),)
    assert "sql/03_dimensions" in str(error)
    assert "batch" in str(error)
