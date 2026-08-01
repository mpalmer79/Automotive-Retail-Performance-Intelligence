"""Shared pytest fixtures.

Tests never require PostgreSQL. Anything that would need a live database lives in
``tests/integration`` behind the ``integration`` marker.
"""

from __future__ import annotations

import logging
import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import ENV_PASSWORD_FALLBACK_VAR, ENV_PREFIX
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.logging_config import ROOT_LOGGER_NAME

REPO_ROOT = Path(__file__).resolve().parents[1]
REPO_CONFIG_DIR = REPO_ROOT / "config"


@pytest.fixture(autouse=True)
def _hermetic_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Strip stray ``ARPI_*``/``PGPASSWORD`` variables so tests never inherit state."""
    import os

    for name in list(os.environ):
        if name.startswith(ENV_PREFIX) or name == ENV_PASSWORD_FALLBACK_VAR:
            monkeypatch.delenv(name, raising=False)


#: Loggers whose state a test may change and must not leave changed.
#:
#: The root logger is included because ``caplog`` attaches its capture handler there, and
#: because a test that reconfigures the root affects every other test in the process.
_ISOLATED_LOGGERS: Final = ("", ROOT_LOGGER_NAME)


@dataclass(frozen=True, slots=True)
class _LoggerState:
    """Everything about one logger that a test can change."""

    level: int
    propagate: bool
    disabled: bool
    handlers: tuple[logging.Handler, ...]
    filters: tuple[Any, ...]

    @classmethod
    def capture(cls, logger: logging.Logger) -> _LoggerState:
        """Snapshot ``logger``. Handler and filter lists are copied, not aliased."""
        return cls(
            level=logger.level,
            propagate=logger.propagate,
            disabled=logger.disabled,
            handlers=tuple(logger.handlers),
            filters=tuple(logger.filters),
        )

    def restore(self, logger: logging.Logger) -> None:
        """Put ``logger`` back exactly as it was.

        Handlers are restored by assigning the saved list back rather than by removing
        what the test added. Removing would also strip handlers pytest installed for its
        own reporting, and closing them would break the rest of the session.
        """
        logger.setLevel(self.level)
        logger.propagate = self.propagate
        logger.disabled = self.disabled
        logger.handlers[:] = list(self.handlers)
        logger.filters[:] = list(self.filters)


#: The state of a logger nothing has configured: inherit the level, propagate to the
#: parent, no handlers, no filters, enabled.
_PRISTINE: Final = _LoggerState(
    level=logging.NOTSET, propagate=True, disabled=False, handlers=(), filters=()
)


def _arpi_child_loggers() -> dict[str, logging.Logger]:
    """Every existing logger inside the ``arpi`` hierarchy, by name.

    A snapshot of the manager's dictionary, so iterating it cannot observe a logger
    created while the fixture is tearing down.
    """
    return {
        name: logger
        for name, logger in list(logging.Logger.manager.loggerDict.items())
        if isinstance(logger, logging.Logger) and name.startswith(f"{ROOT_LOGGER_NAME}.")
    }


@pytest.fixture(autouse=True)
def _isolated_logging() -> Iterator[None]:
    """Restore global logger state after every test.

    ``arpi.logging_config.configure_logging`` is a process-global side effect, and
    correctly so: it installs the stderr handler, sets the level and sets
    ``propagate = False`` on the ``arpi`` logger so records are not also emitted by the
    root handler. That is right in production and wrong to leave behind in a test.

    Without this fixture the leak is real and measurable. After ``tests/unit/test_cli.py``
    the ``arpi`` logger is left with:

        handlers = [StreamHandler, LogCaptureHandler, LogCaptureHandler]
        level    = 30   (was NOTSET)
        propagate = False  (was True)

    and any later test asserting on an INFO message through ``caplog`` sees an empty
    ``caplog.text`` -- the level check drops the record, and ``propagate = False`` stops
    what survives from reaching the handler ``caplog`` installed on the root. The same
    test passes on its own and fails after the CLI tests, which is the definition of an
    order-dependent suite.

    The fix belongs here rather than in ``logging_config``: production behaviour is not
    the defect, missing test isolation is.

    ``logging.Logger.manager.disable`` is restored too. It is a module-level integer that
    suppresses records below its value across every logger, so a test that raises it
    would silence unrelated tests without touching any logger object.

    RESTORING AFTERWARDS IS NOT ENOUGH ON ITS OWN
    ---------------------------------------------
    Restoring only guarantees that a test leaves nothing behind. It does not guarantee
    that a test *starts* from a known state, and the difference is not academic here:
    ``tests/integration`` sorts before ``tests/unit``, and its session-scoped
    ``loaded_database`` fixture calls ``run_foundation``, which calls
    ``configure_logging``. Session-scoped setup runs *outside* any one test's function
    scope, so from that point on the whole session's baseline is "ARPI logging is
    configured, ``propagate`` is False" -- and every later ``caplog`` assertion against an
    ``arpi`` logger is blind, exactly as in the original defect but sourced from a fixture
    rather than from a test.

    So the ``arpi`` hierarchy is also reset to a pristine state *before* the test body.
    Every test then begins identically whether or not the integration suite ran first,
    which is what order-independence actually requires.

    The root logger is deliberately NOT reset: ``caplog`` and pytest's own reporting
    install handlers there, and clearing them would break capture and output for the rest
    of the session. Root is snapshotted and restored, nothing more.
    """
    manager_disable = logging.Logger.manager.disable
    captured = [
        (logging.getLogger(name), _LoggerState.capture(logging.getLogger(name)))
        for name in _ISOLATED_LOGGERS
    ]
    # Child loggers such as `arpi.ingestion.database` are created on demand and inherit
    # from `arpi`, so which of them exist depends on what has been imported and called.
    # Those already present are snapshotted and restored like any other logger.
    existing_children = {
        name: _LoggerState.capture(logger) for name, logger in _arpi_child_loggers().items()
    }

    logging.Logger.manager.disable = logging.NOTSET
    _PRISTINE.restore(logging.getLogger(ROOT_LOGGER_NAME))
    for child in _arpi_child_loggers().values():
        _PRISTINE.restore(child)

    try:
        yield
    finally:
        for logger, state in captured:
            state.restore(logger)
        for name, child in _arpi_child_loggers().items():
            before = existing_children.get(name)
            if before is not None:
                before.restore(child)
            else:
                # The test created this logger. It cannot be removed -- entries are never
                # deleted from the logging manager -- so it is reset to the state a
                # never-touched logger has, which is what the next test would have seen
                # had this one not run. Without this, a level set on a logger the test
                # itself created survives for the rest of the process.
                _PRISTINE.restore(child)
        logging.Logger.manager.disable = manager_disable


@pytest.fixture
def repo_config_dir() -> Path:
    """The repository's real ``config/`` directory."""
    return REPO_CONFIG_DIR


@pytest.fixture
def tmp_config_dir(tmp_path: Path) -> Path:
    """A writable copy of the repository's profile YAML files."""
    destination = tmp_path / "config"
    destination.mkdir()
    for source in sorted(REPO_CONFIG_DIR.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    return destination


@pytest.fixture
def test_config(repo_config_dir: Path) -> ArpiConfig:
    """The ``test`` profile: a tiny two-month window that writes no sample outputs."""
    return load_config(profile="test", config_dir=repo_config_dir)


@pytest.fixture
def development_config(repo_config_dir: Path) -> ArpiConfig:
    """The ``development`` profile: the one that produces ``data/sample``."""
    return load_config(profile="development", config_dir=repo_config_dir)


@pytest.fixture
def date_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_date`` dataset for the ``test`` profile."""
    return generate_date_dataset(test_config)


@pytest.fixture
def dealership_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_dealership`` dataset for the ``test`` profile."""
    return generate_dealership_dataset(test_config)


@pytest.fixture
def working_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Run the test inside an empty directory, so writes cannot touch the repository."""
    monkeypatch.chdir(tmp_path)
    yield tmp_path
