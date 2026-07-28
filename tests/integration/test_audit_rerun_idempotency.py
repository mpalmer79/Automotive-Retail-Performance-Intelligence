"""Integration regression tests for audit-row idempotency across pipeline reruns.

These cover a defect found during Phase 0 integration: the run identifier is derived
deterministically from the run parameters, so rerunning the pipeline with the same
profile and seed reuses the same ``audit.pipeline_run`` row. The child audit rows were
inserted unconditionally, which made the second run abort on the
``pipeline_run_row_count`` primary key.

The architecture requires a rerun to be repeatable (ARCHITECTURE.md section 17.3), so a
rerun must leave exactly one run recorded with one set of child rows, and must not
disturb any other run's history.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

pytestmark = pytest.mark.integration


def _insert_run(cursor: Any, run_uuid: str, *, profile: str) -> int:
    """Insert a pipeline run and return its generated identifier."""
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, completed_at, status
        )
        VALUES (%s, 'phase0_foundation', %s, 'full', 20250701, '0.1.0', %s, %s, 'succeeded')
        ON CONFLICT (run_uuid) DO UPDATE SET status = EXCLUDED.status
        RETURNING pipeline_run_id
        """,
        (run_uuid, profile, datetime.now(UTC), datetime.now(UTC)),
    )
    row = cursor.fetchone()
    assert row is not None
    return int(row[0])


def _upsert_row_count(cursor: Any, run_id: int, entity: str, layer: str, count: int) -> None:
    """Record an entity row count the way the loader does, tolerating a rerun."""
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run_row_count (
            pipeline_run_id, entity_name, layer, row_count, recorded_at
        )
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (pipeline_run_id, entity_name, layer) DO UPDATE
        SET row_count = EXCLUDED.row_count, recorded_at = EXCLUDED.recorded_at
        """,
        (run_id, entity, layer, count, datetime.now(UTC)),
    )


def test_row_count_upsert_survives_a_rerun(cursor: Any) -> None:
    """Recording the same entity and layer twice updates rather than failing."""
    run_id = _insert_run(cursor, "11111111-1111-5111-8111-111111111111", profile="test")

    _upsert_row_count(cursor, run_id, "dim_date", "source", 184)
    _upsert_row_count(cursor, run_id, "dim_date", "source", 190)

    cursor.execute(
        """
        SELECT row_count FROM audit.pipeline_run_row_count
        WHERE pipeline_run_id = %s AND entity_name = 'dim_date' AND layer = 'source'
        """,
        (run_id,),
    )
    rows = cursor.fetchall()
    assert len(rows) == 1, "a rerun must update the row count, not add a second row"
    assert rows[0][0] == 190, "the row count must reflect the most recent execution"


def test_replacing_child_rows_leaves_other_runs_untouched(cursor: Any) -> None:
    """Clearing one run's validation results must not delete another run's history."""
    kept_id = _insert_run(cursor, "22222222-2222-5222-8222-222222222222", profile="test")
    replaced_id = _insert_run(cursor, "33333333-3333-5333-8333-333333333333", profile="development")

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

    # Simulate the loader replacing only the rerun's child rows.
    cursor.execute(
        "DELETE FROM audit.validation_result WHERE pipeline_run_id = %s",
        (replaced_id,),
    )

    cursor.execute(
        "SELECT count(*) FROM audit.validation_result WHERE pipeline_run_id = %s",
        (kept_id,),
    )
    kept_count = cursor.fetchone()[0]
    assert kept_count == 1, "prior run history must be preserved"

    cursor.execute(
        "SELECT count(*) FROM audit.validation_result WHERE pipeline_run_id = %s",
        (replaced_id,),
    )
    assert cursor.fetchone()[0] == 0, "the rerun's own child rows must be cleared"
