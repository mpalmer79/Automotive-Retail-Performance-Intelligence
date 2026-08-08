-- =============================================================================
-- File:            sql/01_raw/22_raw_gl_control_balance_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for gl_control_balance.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_gl_control_balance reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-024-fact-gl-control-balance.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. One control-account balance per store per account per month-end.
-- These balances are GENERATED from the same subledger they are reconciled against, plus
-- a governed table of deliberate variances, so the reconciliation surface can be seen
-- working in both states. They are NOT an independently ingested second accounting
-- system: an exact reconciliation proves the arithmetic, not that two sources agree.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_gl_control_balance and reported through
-- staging.stg_gl_control_balance_rejected, not lost silently.
--
-- RAW IS NOT SKIPPED BECAUSE THE DATA IS SYNTHETIC. Every ARPI entity travels the same
-- four layers. An accounting schedule that entered the warehouse by a private door would
-- have no rejected-record path, no row-count chain and no lineage columns -- and the one
-- table a controller is asked to trust is the last one that should be exempt.

CREATE TABLE IF NOT EXISTS raw.gl_control_balance_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    gl_control_balance_id   text         NULL,
    dealership_id           text         NULL,
    gl_account_id           text         NULL,
    balance_date            text         NULL,
    net_balance             text         NULL,
    source_system           text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_gl_control_balance_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_gl_control_balance_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read only
-- that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_gl_control_balance_load_load_batch_id
    ON raw.gl_control_balance_load (load_batch_id);

COMMENT ON TABLE raw.gl_control_balance_load IS
    'Grain: one row per data row of a gl_control_balance.csv file within one load batch. Raw landing
table; business columns are untyped text and are cast in staging.stg_gl_control_balance. Synthetic
control-account balances for a fictional dealer group, generated to demonstrate reconciliation
mechanics rather than ingested from a second system. Never read by Power BI or Excel and explicitly
revoked from arpi_reporter.';

COMMENT ON COLUMN raw.gl_control_balance_load.gl_control_balance_id IS 'Untyped source value. Natural key, GLB-########.';
COMMENT ON COLUMN raw.gl_control_balance_load.dealership_id IS 'Untyped source value. Store the balance belongs to.';
COMMENT ON COLUMN raw.gl_control_balance_load.gl_account_id IS 'Untyped source value. The control account.';
COMMENT ON COLUMN raw.gl_control_balance_load.balance_date IS 'Untyped source value. Month-end the balance is stated as at.';
COMMENT ON COLUMN raw.gl_control_balance_load.net_balance IS 'Untyped source value. The control-account balance, exact to two decimal places.';
COMMENT ON COLUMN raw.gl_control_balance_load.source_system IS 'Untyped source value. Originating system; constant SYNTHETIC-DMS-GL.';
COMMENT ON COLUMN raw.gl_control_balance_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.gl_control_balance_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.gl_control_balance_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.gl_control_balance_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.gl_control_balance_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
