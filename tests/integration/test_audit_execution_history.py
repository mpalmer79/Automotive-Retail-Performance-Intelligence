"""Integration regression tests for execution history in ``audit.pipeline_run``.

This module replaces ``test_audit_rerun_idempotency.py``, which asserted the behaviour
ADR-0010 identifies as the defect: that rerunning a pipeline with identical inputs reuses
one audit row and replaces its child rows.

That design collapsed real history. ``run_uuid`` was a UUIDv5 over the run's parameters,
the loader upserted on it, and ``started_at`` was absent from the ``DO UPDATE SET`` list.
So a second attempt inherited the first attempt's start timestamp, application version and
run mode while overwriting its completion timestamp and status. The recorded duration
belonged to no execution, and a failed attempt followed by a successful retry left a
single ``succeeded`` row with the failure erased.

``run_uuid`` is now execution identity -- random, one per attempt -- and
``logical_run_key`` carries the deterministic fingerprint. The tests below assert the
guarantees that split makes possible.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from psycopg import errors

pytestmark = pytest.mark.integration

#: One logical run, executed several times. Shared by the attempts in each test.
LOGICAL_KEY = "44444444-4444-5444-8444-444444444444"


def _insert_attempt(
    cursor: Any,
    *,
    logical_run_key: str = LOGICAL_KEY,
    status: str = "succeeded",
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    arpi_version: str = "0.1.0",
    run_mode: str = "cli",
    profile: str = "test",
) -> tuple[int, str]:
    """Insert one execution attempt the way the loader now does: a plain INSERT.

    Returns:
        The generated ``pipeline_run_id`` and the attempt's ``run_uuid``.
    """
    run_uuid = str(uuid.uuid4())
    started = started_at or datetime.now(UTC)
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, logical_run_key, pipeline_name, profile_name, run_mode,
            random_seed, arpi_version, started_at, completed_at, status
        )
        VALUES (%s, %s, 'phase0_foundation', %s, %s, 20250701, %s, %s, %s, %s)
        RETURNING pipeline_run_id
        """,
        (
            run_uuid,
            logical_run_key,
            profile,
            run_mode,
            arpi_version,
            started,
            completed_at,
            status,
        ),
    )
    row = cursor.fetchone()
    assert row is not None
    return int(row[0]), run_uuid


def test_two_equivalent_executions_produce_two_rows(cursor: Any) -> None:
    """The central guarantee: equivalent inputs do not collapse into one row."""
    first_id, first_uuid = _insert_attempt(cursor)
    second_id, second_uuid = _insert_attempt(cursor)

    assert first_id != second_id
    assert first_uuid != second_uuid

    cursor.execute(
        "SELECT count(*) FROM audit.pipeline_run WHERE logical_run_key = %s", (LOGICAL_KEY,)
    )
    assert cursor.fetchone()[0] == 2, "both attempts must remain visible"


def test_a_failure_followed_by_a_success_preserves_both(cursor: Any) -> None:
    """The failure must not be erased by the retry that succeeded after it."""
    failed_at = datetime.now(UTC) - timedelta(minutes=10)
    _insert_attempt(
        cursor,
        status="failed",
        started_at=failed_at,
        completed_at=failed_at + timedelta(seconds=30),
    )
    retry_at = datetime.now(UTC)
    _insert_attempt(
        cursor,
        status="succeeded",
        started_at=retry_at,
        completed_at=retry_at + timedelta(seconds=45),
    )

    cursor.execute(
        "SELECT status FROM audit.pipeline_run WHERE logical_run_key = %s ORDER BY started_at",
        (LOGICAL_KEY,),
    )
    assert [row[0] for row in cursor.fetchall()] == ["failed", "succeeded"]


def test_each_attempt_keeps_its_own_duration(cursor: Any) -> None:
    """A duration must describe one attempt, not span two.

    This is the assertion the old upsert could not satisfy: ``started_at`` survived from
    the first attempt while ``completed_at`` came from the second.
    """
    first_start = datetime.now(UTC) - timedelta(hours=1)
    _insert_attempt(
        cursor, started_at=first_start, completed_at=first_start + timedelta(seconds=20)
    )
    second_start = datetime.now(UTC)
    _insert_attempt(
        cursor, started_at=second_start, completed_at=second_start + timedelta(seconds=25)
    )

    cursor.execute(
        """
        SELECT extract(epoch FROM (completed_at - started_at))
        FROM audit.pipeline_run WHERE logical_run_key = %s ORDER BY started_at
        """,
        (LOGICAL_KEY,),
    )
    durations = [float(row[0]) for row in cursor.fetchall()]
    assert durations == [20.0, 25.0], (
        "each row's duration must be its own; a value near 3600 would mean the first "
        "attempt's start was paired with the second attempt's completion"
    )


def test_each_attempt_records_its_own_version_and_run_mode(cursor: Any) -> None:
    """Version and run mode are execution-specific, not inherited from an earlier row."""
    _insert_attempt(cursor, arpi_version="0.1.0", run_mode="cli")
    _insert_attempt(cursor, arpi_version="0.2.0", run_mode="library")

    cursor.execute(
        "SELECT arpi_version, run_mode FROM audit.pipeline_run "
        "WHERE logical_run_key = %s ORDER BY pipeline_run_id",
        (LOGICAL_KEY,),
    )
    assert cursor.fetchall() == [("0.1.0", "cli"), ("0.2.0", "library")]


def test_different_inputs_produce_a_different_logical_key(cursor: Any) -> None:
    """Grouping must not merge runs that were asked to do different things."""
    other_key = "55555555-5555-5555-8555-555555555555"
    _insert_attempt(cursor)
    _insert_attempt(cursor, logical_run_key=other_key, profile="development")

    cursor.execute(
        "SELECT count(DISTINCT logical_run_key) FROM audit.pipeline_run "
        "WHERE logical_run_key IN (%s, %s)",
        (LOGICAL_KEY, other_key),
    )
    assert cursor.fetchone()[0] == 2


def test_the_logical_run_key_is_deliberately_not_unique(cursor: Any) -> None:
    """A unique constraint here would reintroduce the collapse this ADR removed."""
    _insert_attempt(cursor)
    _insert_attempt(cursor)  # must not raise

    cursor.execute(
        """
        SELECT count(*) FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'audit' AND t.relname = 'pipeline_run'
          AND c.contype IN ('u', 'p')
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
                 FROM unnest(c.conkey) k
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k)
              @> ARRAY['logical_run_key']::text[]
        """
    )
    assert cursor.fetchone()[0] == 0, "logical_run_key must not be unique or a primary key"


def test_run_uuid_remains_unique(cursor: Any) -> None:
    """Execution identity is still enforced by the database, not merely by convention."""
    _, run_uuid = _insert_attempt(cursor)
    with pytest.raises(errors.UniqueViolation):
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run (
                run_uuid, logical_run_key, pipeline_name, profile_name, run_mode,
                random_seed, arpi_version, started_at, status
            )
            VALUES (%s, %s, 'phase0_foundation', 'test', 'cli', 1, '0.1.0', now(), 'running')
            """,
            (run_uuid, LOGICAL_KEY),
        )


def test_child_rows_of_two_attempts_do_not_collide(cursor: Any) -> None:
    """The row-count primary key is per attempt, so no delete-before-insert is needed.

    Before ADR-0010 both attempts shared one ``pipeline_run_id``, so recording the same
    ``(entity, layer)`` twice violated the primary key -- which is why the loader deleted
    child rows first, and why attempt lineage was lost.
    """
    first_id, _ = _insert_attempt(cursor)
    second_id, _ = _insert_attempt(cursor)

    for run_id, count in ((first_id, 184), (second_id, 190)):
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run_row_count (
                pipeline_run_id, entity_name, layer, row_count, recorded_at
            )
            VALUES (%s, 'dim_date', 'source', %s, %s)
            """,
            (run_id, count, datetime.now(UTC)),
        )

    cursor.execute(
        """
        SELECT r.pipeline_run_id, c.row_count
        FROM audit.pipeline_run r
        JOIN audit.pipeline_run_row_count c ON c.pipeline_run_id = r.pipeline_run_id
        WHERE r.logical_run_key = %s
        ORDER BY r.pipeline_run_id
        """,
        (LOGICAL_KEY,),
    )
    assert [row[1] for row in cursor.fetchall()] == [184, 190]


def test_replacing_child_rows_leaves_other_runs_untouched(cursor: Any) -> None:
    """Clearing one attempt's results must not delete another attempt's history.

    Carried over from the module this replaces. It matters more now, not less: the rows
    being protected can belong to an earlier attempt at the *same* logical run.
    """
    kept_id, _ = _insert_attempt(cursor)
    replaced_id, _ = _insert_attempt(cursor)

    for run_id in (kept_id, replaced_id):
        cursor.execute(
            """
            INSERT INTO audit.validation_result (
                pipeline_run_id, check_id, check_name, check_category, target_object,
                severity, status, failed_record_count, evaluated_at
            )
            VALUES (%s, 'DQ-DATE-001', 'unique date key', 'structural',
                    'warehouse.dim_date', 'critical', 'passed', 0, %s)
            """,
            (run_id, datetime.now(UTC)),
        )

    cursor.execute("DELETE FROM audit.validation_result WHERE pipeline_run_id = %s", (replaced_id,))

    cursor.execute(
        "SELECT count(*) FROM audit.validation_result WHERE pipeline_run_id = %s", (kept_id,)
    )
    assert cursor.fetchone()[0] == 1, "the earlier attempt's history must be preserved"


def test_concurrent_equivalent_attempts_do_not_collide(cursor: Any) -> None:
    """Two simultaneous equivalent runs must both insert, not deadlock or conflict.

    The logical key carries no uniqueness, so there is no conflict target to serialise
    on. This asserts the property directly rather than simulating threads: many attempts
    sharing one logical key all insert successfully.
    """
    ids = [_insert_attempt(cursor, status="running", completed_at=None)[0] for _ in range(5)]
    assert len(set(ids)) == 5

    cursor.execute(
        "SELECT count(*) FROM audit.pipeline_run WHERE logical_run_key = %s", (LOGICAL_KEY,)
    )
    assert cursor.fetchone()[0] == 5
