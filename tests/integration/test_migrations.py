"""The forward-migration mechanism in ``sql/09_migrations``.

Two paths must both work and must converge on the same schema:

* **fresh** -- a database built from nothing by the whole ``sql/0*/*.sql`` sequence,
  where ``sql/00_database/03_audit_tables.sql`` already declares every column;
* **upgrade** -- a database built from the *previous* revision's audit DDL, where the
  column does not exist and the migration has to add and backfill it.

The upgrade path is the one that matters and the one that is easy to leave untested:
a migration that only ever runs against an empty database proves nothing about the
deployed database it was written for.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from tests.integration.conftest import base_connection_kwargs, run_init_sequence

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION_DIR = REPO_ROOT / "sql" / "09_migrations"
CHECKSUM_FILE = MIGRATION_DIR / "checksums.json"

#: Filename pattern every migration must follow, so ordering is lexicographic and total.
MIGRATION_NAME = re.compile(r"^\d{4}_[a-z0-9_]+$")


def migration_files() -> list[Path]:
    """Every migration, in the order the deployment sequence applies them."""
    return sorted(MIGRATION_DIR.glob("*.sql"))


def _released_checksums() -> dict[str, str]:
    return dict(json.loads(CHECKSUM_FILE.read_text())["migrations"])


# --------------------------------------------------------------------------------------
# Repository-level invariants. These need no database.
# --------------------------------------------------------------------------------------


def test_every_migration_is_named_for_ordering() -> None:
    """``NNNN_description``. A four-digit prefix keeps filename order numeric order.

    Regression: a first attempt named the ledger ``00_migration_history.sql`` and the
    first migration ``0001_...``. String sort puts ``0001_`` *before* ``00_`` because
    ``'0' < '_'``, so the migration ran before the table it records itself in existed.
    """
    for path in migration_files():
        assert MIGRATION_NAME.match(path.stem), (
            f"{path.name} must be named NNNN_lower_snake_case.sql"
        )


def test_migration_identifiers_are_unique() -> None:
    stems = [path.stem for path in migration_files()]
    assert len(stems) == len(set(stems)), f"duplicate migration identifier in {stems}"


def test_released_migrations_are_immutable() -> None:
    """A migration that reached main is never edited again.

    Editing one silently gives databases built before and after the edit different
    schemas with no way to tell them apart. Fix a released migration with a NEW one.
    """
    released = _released_checksums()
    for path in migration_files():
        assert path.stem in released, (
            f"{path.name} has no recorded checksum. Add it to {CHECKSUM_FILE.name} "
            "when the migration is first written."
        )
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        assert actual == released[path.stem], (
            f"{path.name} has changed since it was released. Released migrations are "
            "immutable -- write a new migration instead of editing this one."
        )


def test_the_checksum_manifest_has_no_orphans() -> None:
    """A recorded checksum with no file means a released migration was deleted."""
    on_disk = {path.stem for path in migration_files()}
    assert set(_released_checksums()) <= on_disk, (
        f"checksums.json names migrations that no longer exist: "
        f"{sorted(set(_released_checksums()) - on_disk)}"
    )


def test_every_migration_records_itself() -> None:
    """A migration that does not write to the ledger cannot be tracked as applied."""
    for path in migration_files():
        if path.stem == "0000_migration_history":
            continue  # creates the ledger; cannot insert into it before it exists
        text = path.read_text()
        assert "INSERT INTO audit.schema_migration" in text, (
            f"{path.name} must record itself in audit.schema_migration as its last step"
        )


def test_no_migration_pretends_to_roll_back() -> None:
    """Forward-only is a decision, not an omission. A DROP here would be fiction."""
    for path in migration_files():
        body = "\n".join(
            line for line in path.read_text().splitlines() if not line.strip().startswith("--")
        )
        assert "DROP TABLE" not in body.upper(), f"{path.name} drops a table"
        assert "DROP COLUMN" not in body.upper(), f"{path.name} drops a column"


# --------------------------------------------------------------------------------------
# Fresh-install path.
# --------------------------------------------------------------------------------------


def test_a_fresh_database_records_every_migration_as_applied(cursor: Any) -> None:
    """The session database was built by the full sequence, so the ledger is complete."""
    cursor.execute("SELECT migration_id FROM audit.schema_migration ORDER BY migration_id")
    applied = {row[0] for row in cursor.fetchall()}
    expected = {path.stem for path in migration_files() if path.stem != "0000_migration_history"}
    assert applied == expected, f"applied {applied}, expected {expected}"


def test_a_fresh_database_has_the_logical_run_key_column(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'pipeline_run'
          AND column_name = 'logical_run_key'
        """
    )
    row = cursor.fetchone()
    assert row is not None, "logical_run_key is missing from a freshly built database"
    assert row[0] == "NO", "logical_run_key must be NOT NULL"
    assert row[1] == "uuid"


def test_the_logical_run_key_index_exists(cursor: Any) -> None:
    cursor.execute(
        "SELECT 1 FROM pg_indexes WHERE schemaname = 'audit' "
        "AND indexname = 'ix_pipeline_run_logical_run_key'"
    )
    assert cursor.fetchone() is not None


# --------------------------------------------------------------------------------------
# Upgrade path.
# --------------------------------------------------------------------------------------

#: The audit DDL exactly as it stood before ADR-0010: no logical_run_key, no ledger.
#: Held verbatim rather than generated, so that a future edit to the current DDL cannot
#: silently change what "the previous revision" means.
PREVIOUS_REVISION_DDL = """
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.pipeline_run (
    pipeline_run_id         bigserial       NOT NULL,
    run_uuid                uuid            NOT NULL,
    pipeline_name           text            NOT NULL,
    profile_name            text            NOT NULL,
    run_mode                text            NOT NULL,
    random_seed             bigint          NOT NULL,
    arpi_version            text            NOT NULL,
    started_at              timestamptz     NOT NULL,
    completed_at            timestamptz     NULL,
    status                  text            NOT NULL,
    critical_failure_count  integer         NOT NULL DEFAULT 0,
    warning_count           integer         NOT NULL DEFAULT 0,
    notes                   text            NULL,
    CONSTRAINT pk_pipeline_run PRIMARY KEY (pipeline_run_id),
    CONSTRAINT uq_pipeline_run_run_uuid UNIQUE (run_uuid),
    CONSTRAINT ck_pipeline_run_status
        CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
    CONSTRAINT ck_pipeline_run_counts_nonnegative
        CHECK (critical_failure_count >= 0 AND warning_count >= 0),
    CONSTRAINT ck_pipeline_run_completion_not_before_start
        CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE IF NOT EXISTS audit.pipeline_run_row_count (
    pipeline_run_id  bigint       NOT NULL,
    entity_name      text         NOT NULL,
    layer            text         NOT NULL,
    row_count        bigint       NOT NULL,
    recorded_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_pipeline_run_row_count
        PRIMARY KEY (pipeline_run_id, entity_name, layer),
    CONSTRAINT fk_pipeline_run_row_count_pipeline_run
        FOREIGN KEY (pipeline_run_id) REFERENCES audit.pipeline_run (pipeline_run_id)
        ON DELETE RESTRICT
);
"""

#: Two rows written by the previous revision, holding the deterministic UUIDv5 that
#: `run_uuid` used to carry. The backfill has to preserve them.
LEGACY_ROWS = (
    ("9d5c6f4a-1111-5111-8111-111111111111", "development"),
    ("9d5c6f4a-2222-5222-8222-222222222222", "test"),
)


@pytest.fixture()
def upgraded_database(maintenance_connection: Any) -> Iterator[str]:
    """A database built from the previous revision, holding rows, then migrated."""
    name = f"arpi_upgrade_{uuid4().hex[:12]}"
    with maintenance_connection.cursor() as cursor:
        cursor.execute(f'CREATE DATABASE "{name}"')
    try:
        with psycopg.connect(dbname=name, **base_connection_kwargs()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(PREVIOUS_REVISION_DDL)
                for run_uuid, profile in LEGACY_ROWS:
                    cursor.execute(
                        """
                        INSERT INTO audit.pipeline_run (
                            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
                            arpi_version, started_at, completed_at, status
                        )
                        VALUES (%s, 'phase0_foundation', %s, 'cli', 424242, '0.1.0',
                                now(), now(), 'succeeded')
                        """,
                        (run_uuid, profile),
                    )
            conn.commit()
            # The whole documented sequence, exactly as deployment runs it.
            run_init_sequence(conn)
        yield name
    finally:
        with maintenance_connection.cursor() as cursor:
            cursor.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _query(database: str, statement: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    with psycopg.connect(dbname=database, **base_connection_kwargs()) as conn, conn.cursor() as c:
        c.execute(statement, params)
        return list(c.fetchall())


def test_upgrading_adds_the_column_as_not_null(upgraded_database: str) -> None:
    rows = _query(
        upgraded_database,
        """
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'pipeline_run'
          AND column_name = 'logical_run_key'
        """,
    )
    assert rows == [("NO",)], "the upgrade must add logical_run_key and make it mandatory"


def test_upgrading_backfills_existing_rows(upgraded_database: str) -> None:
    """Existing rows keep the deterministic identifier they already held.

    They carried the UUIDv5 in ``run_uuid``, which is exactly what ``logical_run_key``
    now means, so the backfill copies it across rather than inventing a value.
    """
    rows = _query(
        upgraded_database,
        "SELECT run_uuid::text, logical_run_key::text FROM audit.pipeline_run "
        "ORDER BY pipeline_run_id",
    )
    assert len(rows) == len(LEGACY_ROWS), "the upgrade must not delete or merge history"
    for (expected_uuid, _profile), (run_uuid, logical_key) in zip(LEGACY_ROWS, rows, strict=True):
        assert run_uuid == expected_uuid, "existing execution identity must be preserved"
        assert logical_key == expected_uuid, "the backfill must reproduce the old identifier"


def test_upgrading_records_the_migration(upgraded_database: str) -> None:
    rows = _query(upgraded_database, "SELECT migration_id FROM audit.schema_migration")
    assert ("0001_add_logical_run_key",) in rows


def test_upgrading_preserves_the_primary_key_and_unique_constraint(
    upgraded_database: str,
) -> None:
    rows = _query(
        upgraded_database,
        """
        SELECT conname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'audit' AND t.relname = 'pipeline_run'
          AND conname IN ('pk_pipeline_run', 'uq_pipeline_run_run_uuid')
        """,
    )
    assert {row[0] for row in rows} == {"pk_pipeline_run", "uq_pipeline_run_run_uuid"}


def test_upgrading_preserves_the_child_foreign_key(upgraded_database: str) -> None:
    rows = _query(
        upgraded_database,
        "SELECT conname FROM pg_constraint WHERE conname = "
        "'fk_pipeline_run_row_count_pipeline_run'",
    )
    assert rows, "the child foreign key must survive the migration"


def test_reapplying_the_sequence_is_a_no_op(upgraded_database: str) -> None:
    """Deployment re-runs the whole sequence. The second pass must change nothing."""
    before = _query(
        upgraded_database,
        "SELECT run_uuid::text, logical_run_key::text FROM audit.pipeline_run "
        "ORDER BY pipeline_run_id",
    )
    with psycopg.connect(dbname=upgraded_database, **base_connection_kwargs()) as conn:
        run_init_sequence(conn)
    after = _query(
        upgraded_database,
        "SELECT run_uuid::text, logical_run_key::text FROM audit.pipeline_run "
        "ORDER BY pipeline_run_id",
    )
    assert before == after

    applied = _query(
        upgraded_database,
        "SELECT migration_id, count(*) FROM audit.schema_migration GROUP BY migration_id",
    )
    assert all(count == 1 for _identifier, count in applied), (
        "re-running must not record a migration twice"
    )


def test_a_partial_migration_is_not_recorded(upgraded_database: str) -> None:
    """A migration that fails part-way must remain unrecorded, and so retryable.

    Proven by executing the migration inside a transaction that is then rolled back:
    the ledger insert is the last statement in the same transaction as the DDL, so
    neither survives. A migration recorded as applied while its schema change was rolled
    back is the failure mode this ordering exists to prevent.
    """
    migration = (MIGRATION_DIR / "0001_add_logical_run_key.sql").read_text()
    with psycopg.connect(dbname=upgraded_database, **base_connection_kwargs()) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM audit.schema_migration WHERE migration_id = %s",
                ("0001_add_logical_run_key",),
            )
            cursor.execute(migration)
            cursor.execute(
                "SELECT count(*) FROM audit.schema_migration WHERE migration_id = %s",
                ("0001_add_logical_run_key",),
            )
            recorded = cursor.fetchone()
            assert recorded is not None
            assert recorded[0] == 1, "the migration records itself when it completes"
        conn.rollback()

    rows = _query(
        upgraded_database,
        "SELECT count(*) FROM audit.schema_migration WHERE migration_id = %s",
        ("0001_add_logical_run_key",),
    )
    assert rows[0][0] == 1, (
        "the rollback must restore the previously recorded state, not leave the ledger "
        "claiming an unapplied migration"
    )
