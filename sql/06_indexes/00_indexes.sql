-- =============================================================================
-- File:            sql/06_indexes/00_indexes.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the small set of secondary indexes that are justified by queries that exist today.
-- Execution order: 17 of 25 — after every table and view is in place.
-- Idempotency:     Fully idempotent. CREATE INDEX IF NOT EXISTS only.
-- Ownership:       Indexes follow their table, so ownership moves to arpi_admin with the table in sql/07_security/01_grants.sql.
-- Grain:           n/a (physical access structures)
-- =============================================================================
--
-- POLICY
-- ------
-- An index is created here only when a query that exists today needs it. Indexes
-- are not free: they slow every write, they consume space, and a speculative
-- index for a table that does not exist yet is just a lie about the workload.
-- Facts arrive in Phase 1.2 and will bring their own indexes in the same change.
--
-- DELIBERATELY NOT CREATED
-- ------------------------
--   warehouse.dim_date (full_date)
--       Already indexed. uq_dim_date_full_date is a UNIQUE constraint, which
--       PostgreSQL implements as a unique btree index on exactly that column. A
--       second index would be pure overhead with no possible benefit.
--   warehouse.dim_dealership (dealership_id) WHERE is_current
--       Already created as uix_dim_dealership_current_dealership_id alongside the
--       table, because it enforces a grain rule rather than merely accelerating a
--       query.
--   raw.calendar_date_load (load_batch_id), raw.dealership_load (load_batch_id)
--       Already created alongside their tables in sql/01_raw, because the staging
--       views cannot function without them.
--   Anything on is_selling_day, status or severity
--       Low-cardinality boolean and enumeration columns on tables of a few
--       hundred to a few thousand rows. A sequential scan is faster.

-- -----------------------------------------------------------------------------
-- warehouse.dim_date
-- -----------------------------------------------------------------------------
-- Every period-over-period report and every Excel operating-report tab filters or
-- groups by year and month. This is the one dim_date access path that is not
-- already served by the primary key or the full_date unique constraint.
CREATE INDEX IF NOT EXISTS ix_dim_date_calendar_year_month_number
    ON warehouse.dim_date (calendar_year, month_number);

COMMENT ON INDEX warehouse.ix_dim_date_calendar_year_month_number IS
    'Supports year and year+month filtering and grouping, the dominant dim_date access pattern in '
    'reporting.vw_calendar consumers. Leading column alone also serves year-only filters.';

-- -----------------------------------------------------------------------------
-- warehouse.dim_dealership
-- -----------------------------------------------------------------------------
-- The Type 2 merge resolves the latest version of each store with
-- DISTINCT ON (dealership_id) ORDER BY dealership_id, effective_date DESC, and
-- point-in-time joins will look up a store's version history by natural key. The
-- partial index on current rows cannot serve either, because both need expired
-- versions too.
CREATE INDEX IF NOT EXISTS ix_dim_dealership_id_effective_date
    ON warehouse.dim_dealership (dealership_id, effective_date DESC);

COMMENT ON INDEX warehouse.ix_dim_dealership_id_effective_date IS
    'Supports the latest-version lookup in sql/03_dimensions/11_dim_dealership_merge.sql and future '
    'point-in-time joins across all versions of a store. The partial current-row unique index cannot '
    'serve these because they must see expired versions.';

-- -----------------------------------------------------------------------------
-- audit
-- -----------------------------------------------------------------------------
-- Every child audit table is read "give me everything for this run", by
-- reporting.vw_pipeline_run_summary, reporting.vw_data_quality_summary and by
-- operators triaging a failure. The foreign keys also need these for efficient
-- referential checks on delete.
CREATE INDEX IF NOT EXISTS ix_validation_result_pipeline_run_id
    ON audit.validation_result (pipeline_run_id);

COMMENT ON INDEX audit.ix_validation_result_pipeline_run_id IS
    'Supports per-run validation aggregation in reporting.vw_pipeline_run_summary and per-run detail in '
    'reporting.vw_data_quality_summary, and backs the foreign key to audit.pipeline_run.';

CREATE INDEX IF NOT EXISTS ix_rejected_record_pipeline_run_id
    ON audit.rejected_record (pipeline_run_id);

COMMENT ON INDEX audit.ix_rejected_record_pipeline_run_id IS
    'Supports per-run rejected-record counting and triage, and backs the foreign key to audit.pipeline_run.';

CREATE INDEX IF NOT EXISTS ix_reconciliation_result_pipeline_run_id
    ON audit.reconciliation_result (pipeline_run_id);

COMMENT ON INDEX audit.ix_reconciliation_result_pipeline_run_id IS
    'Supports per-run reconciliation roll-up in reporting.vw_pipeline_run_summary, and backs the foreign '
    'key to audit.pipeline_run.';

-- audit.pipeline_run_row_count needs no separate index: pipeline_run_id is the
-- leading column of its primary key.

-- "What happened recently?" is the first question an operator asks. DESC matches
-- the ORDER BY that answers it, and NULLS LAST is not needed because started_at
-- is NOT NULL.
CREATE INDEX IF NOT EXISTS ix_pipeline_run_started_at
    ON audit.pipeline_run (started_at DESC);

COMMENT ON INDEX audit.ix_pipeline_run_started_at IS
    'Supports the most-recent-runs listing used by operators and by the run history page of any report.';
