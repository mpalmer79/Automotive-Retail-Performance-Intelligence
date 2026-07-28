"""The canonical check-category vocabulary, as the database enforces it.

DOC-24: ``audit.validation_result.check_category`` carried four mutually inconsistent
vocabularies and no constrained domain, so nothing failed when a fifth spelling appeared.
These tests assert the three things that make that stay fixed:

1. the constraint exists and admits exactly the seven canonical categories;
2. the Python authority and the SQL constraint agree, read from ``pg_constraint`` rather
   than restated here;
3. the DDL is migration-safe -- an existing database with historical rows in the retired
   spellings is brought up to the constrained vocabulary by re-running the file, without
   losing a single audit row.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from arpi.constants import CHECK_CATEGORIES, RETIRED_CHECK_CATEGORIES

psycopg = pytest.importorskip("psycopg")
errors = psycopg.errors

pytestmark = pytest.mark.integration

CONSTRAINT_NAME = "ck_validation_result_check_category"
AUDIT_TABLES_SQL = Path("00_database/03_audit_tables.sql")


def _insert_run(cursor: Any) -> int:
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (gen_random_uuid(), 'phase0_foundation', 'test', 'cli', 20240101, '0.1.0',
                now(), 'running')
        RETURNING pipeline_run_id
        """
    )
    run_id: int = cursor.fetchone()[0]
    return run_id


def _insert_result(cursor: Any, run_id: int, category: str, *, check_id: str = "DQ-DATE-001") -> None:
    cursor.execute(
        """
        INSERT INTO audit.validation_result (
            pipeline_run_id, check_id, check_name, check_category, target_object,
            severity, status, evaluated_at
        )
        VALUES (%s, %s, 'category probe', %s, 'warehouse.dim_date', 'critical', 'passed', now())
        """,
        (run_id, check_id, category),
    )


def _constraint_definition(cursor: Any) -> str | None:
    cursor.execute(
        """
        SELECT pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conname = %s
          AND conrelid = 'audit.validation_result'::regclass
        """,
        (CONSTRAINT_NAME,),
    )
    row = cursor.fetchone()
    return None if row is None else str(row[0])


def test_the_constraint_exists(cursor: Any) -> None:
    assert _constraint_definition(cursor) is not None, (
        "audit.validation_result.check_category has no CHECK constraint; describing the "
        "domain in a COMMENT is what allowed four vocabularies to accumulate"
    )


def test_the_sql_constraint_and_the_python_authority_agree(cursor: Any) -> None:
    """Read the domain out of the catalogue; do not restate it in the test."""
    definition = _constraint_definition(cursor)
    assert definition is not None
    literals = frozenset(re.findall(r"'([a-z_]+)'::text", definition))
    assert literals == CHECK_CATEGORIES, (
        f"the database admits {sorted(literals)} but src/arpi/constants.py declares "
        f"{sorted(CHECK_CATEGORIES)}"
    )


@pytest.mark.parametrize("category", sorted(CHECK_CATEGORIES))
def test_every_canonical_category_is_accepted(cursor: Any, category: str) -> None:
    run_id = _insert_run(cursor)
    _insert_result(cursor, run_id, category)
    cursor.execute(
        "SELECT count(*) FROM audit.validation_result WHERE pipeline_run_id = %s", (run_id,)
    )
    assert cursor.fetchone()[0] == 1


@pytest.mark.parametrize(
    "category",
    [*sorted(RETIRED_CHECK_CATEGORIES), "reconciliation", "Structural", "", "anything_else"],
)
def test_a_non_canonical_category_is_rejected(cursor: Any, category: str) -> None:
    """Including the retired spellings: they may exist in history, never in new rows."""
    run_id = _insert_run(cursor)
    with pytest.raises(errors.CheckViolation):
        _insert_result(cursor, run_id, category)


def test_every_sql_check_view_emits_a_canonical_category(cursor: Any) -> None:
    cursor.execute("SELECT DISTINCT check_category FROM audit.vw_dq_all ORDER BY 1")
    emitted = {row[0] for row in cursor.fetchall()}
    assert emitted, "audit.vw_dq_all returned no checks at all"
    assert emitted <= CHECK_CATEGORIES, f"non-canonical categories emitted: {sorted(emitted)}"


def test_recording_every_sql_check_satisfies_the_constraint(cursor: Any) -> None:
    """The end-to-end proof: what the views emit is what the column will accept."""
    run_id = _insert_run(cursor)
    cursor.execute("SELECT audit.fn_record_all_dq_checks(%s)", (run_id,))
    recorded = cursor.fetchone()[0]
    assert recorded == 20, "the four SQL check views define twenty checks between them"

    cursor.execute(
        "SELECT DISTINCT check_category FROM audit.validation_result WHERE pipeline_run_id = %s",
        (run_id,),
    )
    assert {row[0] for row in cursor.fetchall()} <= CHECK_CATEGORIES


def test_the_privacy_check_is_categorised_as_privacy(cursor: Any) -> None:
    """DQ-DLR-004 used to spell its category `schema` in SQL and `privacy` in Python."""
    cursor.execute("SELECT check_category FROM audit.vw_dq_all WHERE check_id = 'DQ-DLR-004'")
    assert cursor.fetchone()[0] == "privacy"


# --------------------------------------------------------------------------------------
# Migration safety: both paths of the guarded DO block
# --------------------------------------------------------------------------------------


def test_rerunning_the_ddl_with_the_constraint_present_is_a_no_op(
    cursor: Any, sql_root: Path
) -> None:
    """Path (b), already-migrated database: re-running must not error or duplicate."""
    before = _constraint_definition(cursor)
    assert before is not None

    cursor.execute((sql_root / AUDIT_TABLES_SQL).read_text(encoding="utf-8"))

    assert _constraint_definition(cursor) == before
    cursor.execute(
        """
        SELECT count(*) FROM pg_constraint
        WHERE conname = %s AND conrelid = 'audit.validation_result'::regclass
        """,
        (CONSTRAINT_NAME,),
    )
    assert cursor.fetchone()[0] == 1, "re-running added a second copy of the constraint"


def test_rerunning_the_ddl_migrates_a_legacy_database(cursor: Any, sql_root: Path) -> None:
    """Path (a), pre-existing database: retired spellings are rewritten, then constrained.

    ``CREATE TABLE IF NOT EXISTS`` means a constraint declared in the table body would
    never reach a database created before this change. This reproduces that database --
    constraint dropped, historical rows in the old vocabulary -- and proves that running
    the file brings it up to the canonical domain without deleting evidence.
    """
    cursor.execute(f"ALTER TABLE audit.validation_result DROP CONSTRAINT {CONSTRAINT_NAME}")
    assert _constraint_definition(cursor) is None

    run_id = _insert_run(cursor)
    legacy = {
        "DQ-REF-004": "schema",
        "DQ-DLR-004": "schema",
        "DQ-TEST-001": "domain",
        "DQ-GEN-002": "determinism",
        "DQ-DATE-001": "uniqueness",
    }
    for check_id, category in legacy.items():
        _insert_result(cursor, run_id, category, check_id=check_id)

    cursor.execute((sql_root / AUDIT_TABLES_SQL).read_text(encoding="utf-8"))

    cursor.execute(
        """
        SELECT check_id, check_category
        FROM audit.validation_result
        WHERE pipeline_run_id = %s
        ORDER BY check_id
        """,
        (run_id,),
    )
    migrated = dict(cursor.fetchall())
    assert migrated == {
        # `schema` normally becomes `structural` ...
        "DQ-REF-004": "structural",
        # ... except for the privacy tripwire, which is a privacy check, not a
        # structural one, and whose Python implementation always said so.
        "DQ-DLR-004": "privacy",
        "DQ-TEST-001": "business_rule",
        "DQ-GEN-002": "reproducibility",
        # Already canonical: left exactly as it was.
        "DQ-DATE-001": "uniqueness",
    }
    assert len(migrated) == len(legacy), "the migration must not delete audit evidence"
    assert _constraint_definition(cursor) is not None, "the constraint was not restored"

    with pytest.raises(errors.CheckViolation):
        _insert_result(cursor, run_id, "schema")


def test_an_unknown_legacy_spelling_fails_loudly(cursor: Any, sql_root: Path) -> None:
    """A category nobody mapped is a defect to look at, not something to guess at."""
    cursor.execute(f"ALTER TABLE audit.validation_result DROP CONSTRAINT {CONSTRAINT_NAME}")
    run_id = _insert_run(cursor)
    _insert_result(cursor, run_id, "freestyle")

    with pytest.raises(errors.CheckViolation):
        cursor.execute((sql_root / AUDIT_TABLES_SQL).read_text(encoding="utf-8"))
