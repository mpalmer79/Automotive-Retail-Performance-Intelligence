-- =============================================================================
-- File:            sql/01_raw/00_raw_calendar_date_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_date.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 4 of 25 — after the schemas and audit tables, before the staging views that read it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Contract reference: ARPI cross-agent contract section 10 (raw layer) and
-- section 7 (dim_date column contract). The business column names and their
-- order match the CSV header emitted by the generator exactly, so the loader can
-- COPY with an explicit column list taken straight from that header.
--
-- Raw-layer rules applied here:
--   * Every business column is `text` and nullable. Type problems are detected in
--     staging and reported as validation failures, not as an ingestion crash.
--   * Load metadata gives full lineage back to the file and line that produced
--     each row.
--   * Rows are never updated in place. A rerun writes a new load_batch_id and the
--     staging views expose only the newest batch.

CREATE TABLE IF NOT EXISTS raw.calendar_date_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract section 7, exact names and order, all text)
    date_key            text         NULL,
    full_date           text         NULL,
    day_of_month        text         NULL,
    day_name            text         NULL,
    day_of_week         text         NULL,
    day_of_year         text         NULL,
    week_of_year        text         NULL,
    iso_year            text         NULL,
    month_number        text         NULL,
    month_name          text         NULL,
    month_start_date    text         NULL,
    month_end_date      text         NULL,
    quarter_number      text         NULL,
    quarter_name        text         NULL,
    calendar_year       text         NULL,
    fiscal_month        text         NULL,
    fiscal_quarter      text         NULL,
    fiscal_year         text         NULL,
    is_weekend          text         NULL,
    is_month_end        text         NULL,
    is_quarter_end      text         NULL,
    is_year_end         text         NULL,
    is_holiday          text         NULL,
    holiday_name        text         NULL,
    is_closure_holiday  text         NULL,
    is_selling_day      text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_date_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_calendar_date_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging view resolves the newest load_batch_id and then reads
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_calendar_date_load_load_batch_id
    ON raw.calendar_date_load (load_batch_id);

COMMENT ON TABLE raw.calendar_date_load IS
    'Grain: one row per data row of a dim_date CSV file within one load batch. Raw landing table; '
    'business columns are untyped text and are cast in staging.stg_calendar_date. Never read by '
    'Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.calendar_date_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when resolving the newest load batch.';
COMMENT ON COLUMN raw.calendar_date_load.date_key IS 'Untyped source value for dim_date.date_key (YYYYMMDD integer).';
COMMENT ON COLUMN raw.calendar_date_load.full_date IS 'Untyped source value for dim_date.full_date (ISO-8601 date).';
COMMENT ON COLUMN raw.calendar_date_load.day_of_month IS 'Untyped source value for dim_date.day_of_month (1-31).';
COMMENT ON COLUMN raw.calendar_date_load.day_name IS 'Untyped source value for dim_date.day_name (Monday..Sunday).';
COMMENT ON COLUMN raw.calendar_date_load.day_of_week IS 'Untyped source value for dim_date.day_of_week (ISO 1=Monday..7=Sunday).';
COMMENT ON COLUMN raw.calendar_date_load.day_of_year IS 'Untyped source value for dim_date.day_of_year (1-366).';
COMMENT ON COLUMN raw.calendar_date_load.week_of_year IS 'Untyped source value for dim_date.week_of_year (ISO week 1-53).';
COMMENT ON COLUMN raw.calendar_date_load.iso_year IS 'Untyped source value for dim_date.iso_year (ISO week-numbering year).';
COMMENT ON COLUMN raw.calendar_date_load.month_number IS 'Untyped source value for dim_date.month_number (1-12).';
COMMENT ON COLUMN raw.calendar_date_load.month_name IS 'Untyped source value for dim_date.month_name (January..December).';
COMMENT ON COLUMN raw.calendar_date_load.month_start_date IS 'Untyped source value for dim_date.month_start_date.';
COMMENT ON COLUMN raw.calendar_date_load.month_end_date IS 'Untyped source value for dim_date.month_end_date.';
COMMENT ON COLUMN raw.calendar_date_load.quarter_number IS 'Untyped source value for dim_date.quarter_number (1-4).';
COMMENT ON COLUMN raw.calendar_date_load.quarter_name IS 'Untyped source value for dim_date.quarter_name (Q1..Q4).';
COMMENT ON COLUMN raw.calendar_date_load.calendar_year IS 'Untyped source value for dim_date.calendar_year.';
COMMENT ON COLUMN raw.calendar_date_load.fiscal_month IS 'Untyped source value for dim_date.fiscal_month (fiscal year aligned to calendar year).';
COMMENT ON COLUMN raw.calendar_date_load.fiscal_quarter IS 'Untyped source value for dim_date.fiscal_quarter.';
COMMENT ON COLUMN raw.calendar_date_load.fiscal_year IS 'Untyped source value for dim_date.fiscal_year.';
COMMENT ON COLUMN raw.calendar_date_load.is_weekend IS 'Untyped source value for dim_date.is_weekend (true/false).';
COMMENT ON COLUMN raw.calendar_date_load.is_month_end IS 'Untyped source value for dim_date.is_month_end (true/false).';
COMMENT ON COLUMN raw.calendar_date_load.is_quarter_end IS 'Untyped source value for dim_date.is_quarter_end (true/false).';
COMMENT ON COLUMN raw.calendar_date_load.is_year_end IS 'Untyped source value for dim_date.is_year_end (true/false).';
COMMENT ON COLUMN raw.calendar_date_load.is_holiday IS 'Untyped source value for dim_date.is_holiday (true/false).';
COMMENT ON COLUMN raw.calendar_date_load.holiday_name IS 'Untyped source value for dim_date.holiday_name; empty string is mapped to NULL in staging.';
COMMENT ON COLUMN raw.calendar_date_load.is_closure_holiday IS 'Untyped source value for dim_date.is_closure_holiday (showroom closed).';
COMMENT ON COLUMN raw.calendar_date_load.is_selling_day IS 'Untyped source value for dim_date.is_selling_day (NOT is_closure_holiday).';
COMMENT ON COLUMN raw.calendar_date_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.calendar_date_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.calendar_date_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.calendar_date_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
