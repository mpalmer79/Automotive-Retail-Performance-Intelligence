"""End-to-end integration tests that drive the real pipeline against PostgreSQL.

The rest of the integration suite exercises the SQL layer directly: it seeds ``raw.*``
with hand-written statements and runs the merge scripts itself. That leaves the entire
Python load path untested against a real server, which is how a defect that left every
persisted run at status ``running`` reached review.

These tests call :func:`arpi.pipeline.run_foundation` exactly as the CLI does, so the
COPY path, the batch identifier, the merge invocation, the audit writes, and the
reconciliation emission are all covered by the real database rather than by mocks.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from tests.integration.conftest import base_connection_kwargs, run_init_sequence

from arpi.config import ArpiConfig, load_config
from arpi.pipeline import run_foundation

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]
REPO_CONFIG_DIR = REPO_ROOT / "config"


@pytest.fixture()
def scratch_output_dir() -> Iterator[Path]:
    """A throwaway output directory inside the repository.

    ``resolve_output_dir`` deliberately refuses to write outside the project root, so
    pytest's ``tmp_path`` cannot be used here. ``data/raw/`` is gitignored, so a
    subdirectory of it is both writable and safe to leave out of version control.
    """
    base = REPO_ROOT / "data" / "raw" / f"_pytest_{uuid4().hex}"
    base.mkdir(parents=True, exist_ok=True)
    try:
        yield base
    finally:
        shutil.rmtree(base, ignore_errors=True)


@pytest.fixture(scope="module")
def isolated_database(maintenance_connection: Any) -> Iterator[str]:
    """A database used only by this module.

    These tests commit real rows through the production load path, so they cannot share
    the session-scoped database with tests that assert on a clean warehouse.
    """
    database_name = f"arpi_e2e_{uuid4().hex[:12]}"
    with maintenance_connection.cursor() as cursor:
        cursor.execute(f'CREATE DATABASE "{database_name}"')
    try:
        with psycopg.connect(dbname=database_name, **base_connection_kwargs()) as conn:
            run_init_sequence(conn)
        yield database_name
    finally:
        with maintenance_connection.cursor() as cursor:
            cursor.execute(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')


@pytest.fixture(autouse=True)
def clean_state(committed_connection: Any) -> Iterator[None]:
    """Truncate everything this module writes, before and after each test."""
    _truncate_all(committed_connection)
    yield
    _truncate_all(committed_connection)


def _truncate_all(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "TRUNCATE warehouse.dim_date, warehouse.dim_dealership, "
            "raw.calendar_date_load, raw.dealership_load, audit.pipeline_run "
            "RESTART IDENTITY CASCADE"
        )
    connection.commit()


@pytest.fixture()
def loadable_config(isolated_database: str, scratch_output_dir: Path) -> ArpiConfig:
    """A test-profile configuration pointed at the throwaway integration database."""
    connection = base_connection_kwargs()
    config = load_config(profile="test", config_dir=REPO_CONFIG_DIR)
    return config.model_copy(
        update={
            "database": config.database.model_copy(
                update={
                    "enabled": True,
                    "host": connection.get("host") or os.environ.get("PGHOST"),
                    "port": connection.get("port", 5432),
                    "name": isolated_database,
                    "user": connection.get("user") or os.environ.get("PGUSER"),
                }
            ),
            "paths": config.paths.model_copy(update={"raw_output_dir": scratch_output_dir}),
        }
    )


@pytest.fixture()
def committed_connection(isolated_database: str) -> Iterator[Any]:
    """Non-transactional connection used to observe what the pipeline committed."""
    with psycopg.connect(dbname=isolated_database, **base_connection_kwargs()) as conn:
        yield conn


def _scalar(connection: Any, statement: str) -> Any:
    with connection.cursor() as cursor:
        cursor.execute(statement)
        row = cursor.fetchone()
    return None if row is None else row[0]


def test_run_foundation_loads_the_warehouse(
    loadable_config: ArpiConfig, committed_connection: Any
) -> None:
    """A full run populates both dimensions and reports the load as performed."""
    result = run_foundation(loadable_config, load_database=True)

    assert result.database_loaded is True
    assert result.database_skip_reason is None
    assert not result.report.has_critical_failure

    date_rows = _scalar(committed_connection, "SELECT count(*) FROM warehouse.dim_date")
    store_rows = _scalar(committed_connection, "SELECT count(*) FROM warehouse.dim_dealership")
    assert date_rows == loadable_config.reporting.date_count
    assert store_rows == 3


def test_pipeline_run_reaches_a_terminal_status(
    loadable_config: ArpiConfig, committed_connection: Any
) -> None:
    """The persisted run records a terminal status and a completion timestamp.

    Regression test. The run previously reached ``finish()`` only after the audit row had
    already been written, so a successful run was stored as ``running`` with a null
    ``completed_at``, and the reporting view reported a null duration for completed work.
    """
    run_foundation(loadable_config, load_database=True)

    with committed_connection.cursor() as cursor:
        cursor.execute(
            "SELECT status, completed_at, notes FROM audit.pipeline_run ORDER BY pipeline_run_id"
        )
        rows = cursor.fetchall()

    assert rows, "the run must persist an audit.pipeline_run row"
    for status, completed_at, notes in rows:
        assert status == "succeeded", f"expected a terminal status, found {status!r}"
        assert completed_at is not None, "completed_at must be set once the run finishes"
        assert notes, "the run should record why the database step ran or was skipped"

    duration = _scalar(
        committed_connection,
        "SELECT duration_seconds FROM reporting.vw_pipeline_run_summary LIMIT 1",
    )
    assert duration is not None, "the reporting view must expose a duration for a finished run"


def test_rerunning_is_idempotent(loadable_config: ArpiConfig, committed_connection: Any) -> None:
    """Running twice leaves the warehouse and the audit trail unchanged.

    ARCHITECTURE.md section 17.3 requires a rerun with the same source data to avoid
    creating duplicate warehouse rows.
    """
    run_foundation(loadable_config, load_database=True)
    first = _snapshot(committed_connection)

    run_foundation(loadable_config, load_database=True)
    second = _snapshot(committed_connection)

    assert first == second, f"a rerun changed persisted state: {first} then {second}"


def test_reconciliations_are_recorded(
    loadable_config: ArpiConfig, committed_connection: Any
) -> None:
    """Every reconciliation the run emits is persisted and passing."""
    run_foundation(loadable_config, load_database=True)

    with committed_connection.cursor() as cursor:
        cursor.execute(
            "SELECT reconciliation_id, left_value, right_value, status "
            "FROM audit.reconciliation_result ORDER BY reconciliation_id"
        )
        rows = cursor.fetchall()

    assert rows, "the run must record at least one reconciliation"
    for reconciliation_id, left_value, right_value, status in rows:
        assert status == "passed", f"{reconciliation_id} did not pass"
        assert left_value == right_value, (
            f"{reconciliation_id} compared {left_value} against {right_value}"
        )


def test_run_without_database_still_generates(loadable_config: ArpiConfig) -> None:
    """Declining the database step is a skip, not a failure."""
    result = run_foundation(loadable_config, load_database=False)

    assert result.database_loaded is False
    assert result.database_skip_reason is not None
    assert not result.report.has_critical_failure
    assert result.raw_files, "generation must still write output when the load is skipped"


def _snapshot(connection: Any) -> dict[str, int]:
    """Count every table a rerun could duplicate rows in."""
    return {
        table: _scalar(connection, f"SELECT count(*) FROM {table}")
        for table in (
            "warehouse.dim_date",
            "warehouse.dim_dealership",
            "audit.pipeline_run",
            "audit.pipeline_run_row_count",
            "audit.validation_result",
            "audit.reconciliation_result",
        )
    }
