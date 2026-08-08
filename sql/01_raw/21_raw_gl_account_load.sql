-- =============================================================================
-- File:            sql/01_raw/21_raw_gl_account_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_gl_account.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_gl_account reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-023-dim-gl-account.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. The SELECTED synthetic control-account catalogue: the handful of
-- inventory control accounts a controller reconciles the stock schedule against. It is
-- not a chart of accounts, and it deliberately contains no Cash, Revenue, Cost of Sales,
-- Payroll, Parts, Service, Payables or Receivables. Every account is invented.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_gl_account and reported through
-- staging.stg_gl_account_rejected, not lost silently.
--
-- RAW IS NOT SKIPPED BECAUSE THE DATA IS SYNTHETIC. Every ARPI entity travels the same
-- four layers. An accounting schedule that entered the warehouse by a private door would
-- have no rejected-record path, no row-count chain and no lineage columns -- and the one
-- table a controller is asked to trust is the last one that should be exempt.

CREATE TABLE IF NOT EXISTS raw.gl_account_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    gl_account_id            text         NULL,
    account_number           text         NULL,
    account_name             text         NULL,
    account_category         text         NULL,
    account_type             text         NULL,
    normal_balance           text         NULL,
    inventory_control_flag   text         NULL,
    active_start_date        text         NULL,
    active_end_date          text         NULL,
    source_system            text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_gl_account_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_gl_account_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read only
-- that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_gl_account_load_load_batch_id
    ON raw.gl_account_load (load_batch_id);

COMMENT ON TABLE raw.gl_account_load IS
    'Grain: one row per data row of a dim_gl_account.csv file within one load batch. Raw landing table;
business columns are untyped text and are cast in staging.stg_gl_account. A SELECTED synthetic
control-account catalogue for a fictional dealer group, never a chart of accounts and never a real
dealer group's. Never read by Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.gl_account_load.gl_account_id IS 'Untyped source value. Natural key, GLA-####.';
COMMENT ON COLUMN raw.gl_account_load.account_number IS 'Untyped source value. Synthetic account number in a conventional inventory block. Invented.';
COMMENT ON COLUMN raw.gl_account_load.account_name IS 'Untyped source value. Human-readable account name. Invented.';
COMMENT ON COLUMN raw.gl_account_load.account_category IS 'Untyped source value. The governed inventory control category the account schedules.';
COMMENT ON COLUMN raw.gl_account_load.account_type IS 'Untyped source value. Asset or Liability.';
COMMENT ON COLUMN raw.gl_account_load.normal_balance IS 'Untyped source value. Debit or Credit.';
COMMENT ON COLUMN raw.gl_account_load.inventory_control_flag IS 'Untyped source value. Whether the account is an inventory control account.';
COMMENT ON COLUMN raw.gl_account_load.active_start_date IS 'Untyped source value. First date the account is active.';
COMMENT ON COLUMN raw.gl_account_load.active_end_date IS 'Untyped source value. Last date the account is active; empty while open.';
COMMENT ON COLUMN raw.gl_account_load.source_system IS 'Untyped source value. Originating system; constant SYNTHETIC-DMS-GL.';
COMMENT ON COLUMN raw.gl_account_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.gl_account_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.gl_account_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.gl_account_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.gl_account_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
