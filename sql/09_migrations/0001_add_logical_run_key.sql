-- =============================================================================
-- File:            sql/09_migrations/0001_add_logical_run_key.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Add audit.pipeline_run.logical_run_key and backfill it, separating logical-run identity from execution identity (ADR-0010).
-- Execution order: Runs inside the sql/0*/*.sql sequence, after 0000_migration_history.sql.
-- Idempotency:     Fully idempotent. Guarded on the column's existence; a fresh database built from sql/00_database/03_audit_tables.sql already has the column and this migration only records itself.
-- Ownership:       Applied by the bootstrap superuser or arpi_admin.
-- Grain:           Not applicable (DDL).
-- =============================================================================
--
-- WHAT THIS CORRECTS
-- ------------------
-- Phase 0 derived audit.pipeline_run.run_uuid deterministically from the run's inputs
-- and upserted on it. Two executions with identical inputs therefore shared one row,
-- which meant:
--
--   * completed_at was overwritten by the later attempt while started_at survived from
--     the earlier one, so the recorded duration belonged to no real execution;
--   * arpi_version and run_mode kept the first attempt's values;
--   * a failed attempt followed by a successful retry collapsed into one 'succeeded'
--     row, erasing the failure;
--   * child audit rows were deleted and reinserted, destroying attempt lineage.
--
-- run_uuid now identifies ONE EXECUTION ATTEMPT and is random per execution.
-- logical_run_key carries the deterministic fingerprint that run_uuid used to hold.
--
-- WHY THE BACKFILL IS EXACT RATHER THAN APPROXIMATE
-- -------------------------------------------------
-- Existing rows already hold the deterministic UUIDv5 in run_uuid -- that is precisely
-- what it was. The backfill therefore copies run_uuid into logical_run_key rather than
-- recomputing a hash in SQL. The value is correct by construction, matches what
-- arpi.audit.run.build_logical_run_key() would produce for the same inputs, and needs
-- no uuid_generate_v5() extension.
--
-- Historical rows keep their run_uuid as their execution identity. That is a compromise
-- the data forces: those rows may each represent several collapsed attempts, and the
-- attempts that were overwritten CANNOT BE RECOVERED. This migration does not invent
-- them. LIMITATIONS.md records the gap.

DO $$
DECLARE
    column_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit'
          AND table_name = 'pipeline_run'
          AND column_name = 'logical_run_key'
    ) INTO column_exists;

    IF NOT column_exists THEN
        -- 1. Additive, nullable, so the statement cannot fail on existing rows.
        ALTER TABLE audit.pipeline_run ADD COLUMN logical_run_key uuid NULL;

        -- 2. Backfill every existing row from the identifier it already carries.
        UPDATE audit.pipeline_run
           SET logical_run_key = run_uuid
         WHERE logical_run_key IS NULL;

        -- 3. Only now can the column be made mandatory. If step 2 had missed a row this
        --    would fail loudly and the migration would not record itself, rather than
        --    leaving a half-applied schema that looks complete.
        ALTER TABLE audit.pipeline_run ALTER COLUMN logical_run_key SET NOT NULL;
    END IF;
END
$$;

-- 4. Grouping attempts of one logical run is the query this column exists to serve, and
--    it is always ordered newest-first.
--
--    The index and the column COMMENT both live here rather than in
--    sql/00_database/03_audit_tables.sql, and this migration is the only owner of both.
--    On an upgrade path that file is a complete no-op (CREATE TABLE IF NOT EXISTS on an
--    existing table), so the column does not exist when it runs; an index or a COMMENT on
--    a missing column raises rather than skipping, and would abort the deployment before
--    reaching this file. Placing them here makes the fresh and upgrade paths converge.
--
--    Both statements run OUTSIDE the guard above, because a fresh database gets the column
--    from 03_audit_tables.sql and would otherwise never get its index or its comment.
CREATE INDEX IF NOT EXISTS ix_pipeline_run_logical_run_key
    ON audit.pipeline_run (logical_run_key, started_at DESC);

COMMENT ON COLUMN audit.pipeline_run.logical_run_key IS
    'LOGICAL-RUN IDENTITY. A deterministic UUIDv5 over (pipeline_name, profile_name, random_seed, '
    'reporting start, reporting end). Shared by every execution asked to do the same thing, and '
    'therefore deliberately NOT unique here. Group by it to compare attempts. Never a conflict target.';

-- 5. Record the migration last, so a failure above leaves it unrecorded and retryable.
INSERT INTO audit.schema_migration (migration_id)
VALUES ('0001_add_logical_run_key')
ON CONFLICT (migration_id) DO NOTHING;
