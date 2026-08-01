"""Global logger state must not leak between tests.

`arpi.logging_config.configure_logging` is a process-global side effect: it installs a
stderr handler on the `arpi` logger, sets its level, and sets `propagate = False` so
records are not emitted twice. All three are correct in production and none of them may
survive a test.

The leak was real and reproducible before `tests/conftest.py` grew the `_isolated_logging`
fixture. A probe test appended to a run showed:

    probe alone           handlers=[]       level=0   propagate=True
    after test_logging_config.py  handlers=[Stream, Capture, Capture]  level=30  propagate=False
    after test_cli.py             handlers=[Stream, Capture, Capture]  level=30  propagate=False

and the user-visible consequence was a `caplog` assertion that passed on its own and
failed after the CLI tests, with `caplog.text` empty.

These tests assert the isolation itself. They deliberately do the leaking rather than
depending on another module having done it, so they fail if the fixture is removed rather
than merely if some other test changes.
"""

from __future__ import annotations

import logging

import pytest

from arpi.config import ArpiConfig
from arpi.logging_config import (
    HANDLER_MARKER,
    ROOT_LOGGER_NAME,
    configure_logging,
    get_logger,
)


def _arpi() -> logging.Logger:
    return logging.getLogger(ROOT_LOGGER_NAME)


def _managed_handlers(logger: logging.Logger) -> list[logging.Handler]:
    return [h for h in logger.handlers if getattr(h, HANDLER_MARKER, False)]


# --------------------------------------------------------------------------------------
# The leak, and its repair
# --------------------------------------------------------------------------------------
#
# These two run in file order. The first configures logging the way a CLI test does; the
# second asserts the state it left behind is gone. Together they are the regression for
# the reported failure, in one process, without depending on any other module.


def test_configuring_logging_changes_global_state(test_config: ArpiConfig) -> None:
    """Establish the side effect. This is production behaviour and must not change."""
    configure_logging(test_config)

    logger = _arpi()
    assert _managed_handlers(logger), "configure_logging must install its handler"
    assert logger.propagate is False, "the ARPI logger must not double-emit through root"
    assert logger.level == logging.getLevelName(test_config.logging.level)


def test_the_previous_test_left_no_trace() -> None:
    """The repair. Everything the previous test set must have been restored."""
    logger = _arpi()
    assert _managed_handlers(logger) == [], "a handler survived the test that installed it"
    assert logger.propagate is True, "propagate = False leaked out of the previous test"
    assert logger.level == logging.NOTSET, "a raised level leaked out of the previous test"
    assert logger.disabled is False


def test_caplog_still_sees_info_records_after_logging_was_configured(
    test_config: ArpiConfig, caplog: pytest.LogCaptureFixture
) -> None:
    """The exact assertion that used to fail depending on what ran first.

    Before the fixture, a preceding `configure_logging` left `arpi` at WARNING with
    `propagate = False`, so this `caplog.text` was empty.
    """
    with caplog.at_level(logging.INFO):
        get_logger("arpi.probe").info("hello-from-probe")

    assert "hello-from-probe" in caplog.text


def test_handlers_do_not_accumulate_across_repeated_configuration(
    test_config: ArpiConfig,
) -> None:
    """Two configure calls in one test leave one handler, not two.

    This is `configure_logging`'s own guarantee -- it removes its previous handler before
    installing a new one -- and it is asserted here so the isolation fixture cannot be
    credited for it.
    """
    configure_logging(test_config)
    configure_logging(test_config)

    assert len(_managed_handlers(_arpi())) == 1


def test_a_test_that_disables_a_logger_does_not_silence_the_next_one() -> None:
    """`Logger.disabled` is per-logger global state and is restored."""
    _arpi().disabled = True
    assert _arpi().disabled is True


def test_the_logger_is_enabled_again() -> None:
    assert _arpi().disabled is False


def test_a_test_that_raises_the_manager_disable_level_is_undone() -> None:
    """`logging.Logger.manager.disable` suppresses records across every logger.

    Nothing in ARPI sets it, but a future test or a dependency might, and it is invisible
    from any individual logger object.
    """
    logging.disable(logging.CRITICAL)
    assert logging.Logger.manager.disable == logging.CRITICAL


def test_the_manager_disable_level_is_restored(caplog: pytest.LogCaptureFixture) -> None:
    assert logging.Logger.manager.disable == logging.NOTSET
    with caplog.at_level(logging.INFO):
        get_logger("arpi.probe").info("still-logging")
    assert "still-logging" in caplog.text


def test_a_child_logger_left_at_a_custom_level_is_restored() -> None:
    """Child loggers such as `arpi.ingestion.database` are snapshotted too."""
    child = get_logger("arpi.ingestion.database")
    child.setLevel(logging.CRITICAL)
    assert child.level == logging.CRITICAL


def test_the_child_logger_level_did_not_leak(caplog: pytest.LogCaptureFixture) -> None:
    child = get_logger("arpi.ingestion.database")
    assert child.level != logging.CRITICAL
    with caplog.at_level(logging.INFO):
        child.info("child-record")
    assert "child-record" in caplog.text


# --------------------------------------------------------------------------------------
# Production behaviour is unchanged
# --------------------------------------------------------------------------------------


def test_the_fixture_does_not_weaken_production_logging(test_config: ArpiConfig) -> None:
    """The isolation is a test-only concern.

    `configure_logging` must still do exactly what it did: install a marked handler with a
    redaction filter, set the level, and stop propagation. If the fix had been applied to
    production code instead -- for instance by leaving `propagate = True` -- this would
    fail, and ARPI would emit every record twice whenever a root handler exists.
    """
    logger = configure_logging(test_config)

    assert logger.name == ROOT_LOGGER_NAME
    assert logger.propagate is False
    handlers = _managed_handlers(logger)
    assert len(handlers) == 1
    assert handlers[0].filters, "the redaction filter must still be attached"
