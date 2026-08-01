-- =============================================================================
-- File:            sql/09_migrations/0000_migration_history.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the applied-migration ledger that every forward migration records itself in.
-- Execution order: Runs inside the sql/0*/*.sql sequence, after the validation layer and before the final grants pass. First file in this directory, so the ledger exists before any migration needs it.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per applied migration identifier.
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- The rest of sql/ is a set of ordered, idempotent CREATE ... IF NOT EXISTS scripts.
-- That is the right shape for building a database from nothing, and it is what
-- sql/README.md documents. It cannot express a *change* to an object that already
-- exists in a deployed database: `CREATE TABLE IF NOT EXISTS` on a table that is
-- already there is a no-op, so a new column never appears.
--
-- ADR-0010 needs exactly that -- a new column on audit.pipeline_run, in databases that
-- already hold rows. This directory is the smallest mechanism that supports it safely.
--
-- THE RULES
-- ---------
--   1. ORDERED.      Files are named NNNN_description.sql and applied in filename order.
--   2. IMMUTABLE.    A migration that has reached main is never edited again. Its
--                    checksum is recorded in sql/09_migrations/checksums.json and
--                    tests/integration/test_migrations.py fails if the file changes.
--                    Fix a released migration with a NEW migration, never in place.
--   3. IDEMPOTENT.   Every migration guards its own work, so re-running the whole
--                    sql/0*/*.sql sequence -- which is how ARPI deploys -- changes
--                    nothing on the second pass.
--   4. RECORDED.     Every migration inserts its identifier here on success.
--   5. FORWARD ONLY. There is no down-migration. ARPI's operational scope is a
--                    rebuildable synthetic warehouse; a rollback script that has never
--                    been executed is fiction, and writing one would imply a guarantee
--                    this project does not test. Recovery is restore-from-backup or
--                    rebuild, both of which are documented in the runbook.
--
-- WHAT THIS IS NOT
-- ----------------
-- This is not a general-purpose migration framework and does not pretend to support
-- zero-downtime deployment. ARPI loads a synthetic warehouse in batch; there is no
-- online reader to keep serving during a schema change.

CREATE TABLE IF NOT EXISTS audit.schema_migration (
    migration_id   text         NOT NULL,
    applied_at     timestamptz  NOT NULL DEFAULT now(),
    applied_by     text         NOT NULL DEFAULT current_user,
    CONSTRAINT pk_schema_migration PRIMARY KEY (migration_id)
);

COMMENT ON TABLE audit.schema_migration IS
    'Grain: one row per applied forward migration. Written by the migration itself as its last '
    'statement, so a migration that failed part-way is not recorded and will be reattempted. '
    'Forward only -- there is no down-migration by design (see the header of this file).';
COMMENT ON COLUMN audit.schema_migration.migration_id IS 'Migration filename stem, for example 0001_add_logical_run_key.';
COMMENT ON COLUMN audit.schema_migration.applied_at IS 'UTC instant the migration completed.';
COMMENT ON COLUMN audit.schema_migration.applied_by IS 'Database role that applied it.';
