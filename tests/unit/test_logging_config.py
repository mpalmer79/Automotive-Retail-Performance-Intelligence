"""Structured logging and secret redaction."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import REDACTED_PLACEHOLDER
from arpi.logging_config import (
    HANDLER_MARKER,
    ROOT_LOGGER_NAME,
    JsonFormatter,
    SecretRedactingFilter,
    configure_logging,
    get_logger,
    installed_redaction_filter,
    redact,
)


@pytest.fixture(autouse=True)
def _restore_root_logger() -> None:
    """Remove ARPI handlers before each test so assertions start from a clean slate."""
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    for handler in [h for h in logger.handlers if getattr(h, HANDLER_MARKER, False)]:
        logger.removeHandler(handler)


@pytest.mark.parametrize(
    ("text", "expected_absent"),
    [
        ("connecting with password=hunter2 now", "hunter2"),
        ("env ARPI_DATABASE__PASSWORD=hunter2", "hunter2"),
        ("PGPASSWORD=hunter2", "hunter2"),
        ("postgresql://arpi_loader:hunter2@db.internal:5432/arpi", "hunter2"),
        ("postgres://arpi_loader:hunter2@db.internal/arpi", "hunter2"),
        ('{"password": "hunter2"}', "hunter2"),
    ],
)
def test_redact_removes_credentials(text: str, expected_absent: str) -> None:
    result = redact(text)
    assert expected_absent not in result
    assert REDACTED_PLACEHOLDER in result


def test_redact_removes_registered_literals() -> None:
    assert redact("token is s3cret", ["s3cret"]) == f"token is {REDACTED_PLACEHOLDER}"


def test_redact_ignores_empty_secrets() -> None:
    assert redact("nothing to hide", ["", None or ""]) == "nothing to hide"


def test_redact_preserves_the_surrounding_uri() -> None:
    result = redact("postgresql://arpi_loader:hunter2@db.internal:5432/arpi")
    assert result.startswith("postgresql://arpi_loader:")
    assert result.endswith("@db.internal:5432/arpi")


def test_filter_rewrites_the_record_and_clears_args() -> None:
    log_filter = SecretRedactingFilter(["s3cret"])
    record = logging.LogRecord(
        "arpi.test", logging.INFO, __file__, 1, "value=%s", ("s3cret",), None
    )
    assert log_filter.filter(record) is True
    assert record.getMessage() == f"value={REDACTED_PLACEHOLDER}"
    assert record.args == ()


def test_filter_add_secret_and_count() -> None:
    log_filter = SecretRedactingFilter()
    assert log_filter.secret_count == 0
    log_filter.add_secret(None)
    log_filter.add_secret("")
    assert log_filter.secret_count == 0
    log_filter.add_secret("s3cret")
    assert log_filter.secret_count == 1


def test_configure_logging_is_idempotent(test_config: ArpiConfig) -> None:
    configure_logging(test_config)
    configure_logging(test_config)
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    managed = [h for h in logger.handlers if getattr(h, HANDLER_MARKER, False)]
    assert len(managed) == 1


def test_configure_logging_writes_to_stderr(
    test_config: ArpiConfig, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(test_config)
    get_logger("arpi.demo").warning("hello from arpi")
    captured = capsys.readouterr()
    assert "hello from arpi" in captured.err
    assert captured.out == ""


def test_configured_logger_redacts_the_configured_password(
    repo_config_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_DATABASE__PASSWORD": "s3cret"}
    )
    configure_logging(config)
    get_logger("demo").warning("dsn uses %s", "s3cret")
    captured = capsys.readouterr()
    assert "s3cret" not in captured.err
    assert REDACTED_PLACEHOLDER in captured.err


def test_json_format_emits_one_json_object_per_line(
    repo_config_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    config = load_config(
        profile="test",
        config_dir=repo_config_dir,
        env={"ARPI_LOGGING__FORMAT": "json", "ARPI_LOGGING__LEVEL": "INFO"},
    )
    configure_logging(config)
    get_logger("demo").info("structured message")
    payload = json.loads(capsys.readouterr().err.strip())
    assert payload["message"] == "structured message"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "arpi.demo"
    assert "timestamp" in payload


def test_json_formatter_includes_extras_and_exceptions() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("arpi.demo", logging.ERROR, __file__, 1, "boom", None, None)
    record.entity = "dim_date"
    payload = json.loads(formatter.format(record))
    assert payload["extra"]["entity"] == "dim_date"

    try:
        raise RuntimeError("kaboom")
    except RuntimeError:
        import sys

        failed = logging.LogRecord(
            "arpi.demo", logging.ERROR, __file__, 1, "boom", None, sys.exc_info()
        )
    assert "kaboom" in json.loads(formatter.format(failed))["exception"]


def test_json_formatter_stringifies_unserialisable_extras() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("arpi.demo", logging.INFO, __file__, 1, "x", None, None)
    record.path = Path("/tmp/example")
    assert json.loads(formatter.format(record))["extra"]["path"] == "/tmp/example"


@pytest.mark.parametrize(
    ("requested", "expected"),
    [("arpi", "arpi"), ("arpi.demo", "arpi.demo"), ("demo", "arpi.demo")],
)
def test_get_logger_stays_inside_the_arpi_hierarchy(requested: str, expected: str) -> None:
    assert get_logger(requested).name == expected


def test_installed_redaction_filter_is_none_before_configuration() -> None:
    assert installed_redaction_filter() is None


def test_installed_redaction_filter_is_found_after_configuration(
    repo_config_dir: Path,
) -> None:
    config = load_config(
        profile="test", config_dir=repo_config_dir, env={"ARPI_DATABASE__PASSWORD": "s3cret"}
    )
    configure_logging(config)
    found = installed_redaction_filter()
    assert found is not None
    assert found.secret_count == 1
