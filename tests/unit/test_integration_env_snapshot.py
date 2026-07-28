"""Regression tests for the integration suite's credential snapshot.

``tests/conftest.py`` installs an autouse fixture that deletes every ``ARPI_*`` variable
and ``PGPASSWORD`` before each test, so unit tests cannot inherit ambient configuration.
That is correct and must stay.

It also means anything reading ``os.environ`` from inside a fixture sees the stripped
environment. The integration suite needs the real credentials, so it captures them at
import time instead. This was not hypothetical: reading at fixture time built a
password-less connection, which passes locally over a peer-authenticated Unix socket and
fails in CI with ``fe_sendauth: no password supplied`` against a TCP service container.

These tests need no database. They assert the snapshot mechanism itself, so the bug
cannot return silently once a contributor no longer remembers why it exists.
"""

from __future__ import annotations

import os

import pytest
from tests.integration import conftest as integration_conftest


def test_password_is_read_from_the_snapshot_not_the_live_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The password survives even when the environment no longer holds it."""
    monkeypatch.delenv("PGPASSWORD", raising=False)
    monkeypatch.delenv("ARPI_DATABASE__PASSWORD", raising=False)
    monkeypatch.setitem(integration_conftest._CONNECTION_ENV, "PGPASSWORD", "from-snapshot")

    assert "PGPASSWORD" not in os.environ
    assert integration_conftest.connection_password() == "from-snapshot"


def test_arpi_prefixed_password_takes_precedence() -> None:
    """``ARPI_DATABASE__PASSWORD`` wins over ``PGPASSWORD``.

    CI supplies both. The ARPI contract's own variable is the more specific of the two,
    so it must be the one that decides.
    """
    snapshot = dict(integration_conftest._CONNECTION_ENV)
    snapshot.update({"PGPASSWORD": "standard", "ARPI_DATABASE__PASSWORD": "arpi"})

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(integration_conftest, "_CONNECTION_ENV", snapshot)
        assert integration_conftest.connection_password() == "arpi"


def test_connection_kwargs_carry_the_password() -> None:
    """A password in the snapshot reaches the libpq keyword arguments.

    The failure this guards against was not a missing value but a value that never made
    it into the connection call.
    """
    snapshot = dict(integration_conftest._CONNECTION_ENV)
    snapshot.update({"PGHOST": "localhost", "PGPORT": "5432", "PGUSER": "postgres"})
    snapshot["PGPASSWORD"] = "supplied"

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(integration_conftest, "_CONNECTION_ENV", snapshot)
        kwargs = integration_conftest.base_connection_kwargs()

    assert kwargs["password"] == "supplied"
    assert kwargs["host"] == "localhost"
    assert kwargs["port"] == 5432
    assert kwargs["user"] == "postgres"


def test_absent_password_stays_absent() -> None:
    """With no password configured, none is invented.

    libpq must fall through to its own defaults so a local Unix-socket run keeps working
    without any credentials at all.
    """
    snapshot = {
        key: value
        for key, value in integration_conftest._CONNECTION_ENV.items()
        if key not in {"PGPASSWORD", "ARPI_DATABASE__PASSWORD"}
    }

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(integration_conftest, "_CONNECTION_ENV", snapshot)
        assert integration_conftest.connection_password() is None
        assert "password" not in integration_conftest.base_connection_kwargs()


def test_snapshot_excludes_non_connection_configuration() -> None:
    """Only credentials are snapshotted, never general configuration.

    An integration test must still be unable to inherit an ambient ``ARPI_PROFILE`` or
    feature flag; the exemption is deliberately narrow.
    """
    captured = set(integration_conftest._CONNECTION_ENV)
    assert "ARPI_PROFILE" not in captured
    assert not any(key.startswith("ARPI_FEATURES__") for key in captured)
    assert not any(key.startswith("ARPI_GENERATION__") for key in captured)
