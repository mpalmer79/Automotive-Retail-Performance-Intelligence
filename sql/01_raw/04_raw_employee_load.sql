-- =============================================================================
-- File:            sql/01_raw/04_raw_employee_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_employee.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 8 of 66 — after the audit tables, before staging.stg_employee reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================

--
-- Contract reference: ARPI Phase 1 cross-agent contract sections 6, 7 and 8.
-- Column names and order match the generator CSV header exactly, so the loader's
-- COPY column list is the generated frame's column list plus the load metadata.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_employee and reported through
-- staging.stg_employee_rejected, not lost silently.
--
-- PRIVACY: this entity carries no name, contact detail, compensation, commission,
-- pay plan or protected characteristic. Tenure is banded, not exact.

CREATE TABLE IF NOT EXISTS raw.employee_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    employee_key      text         NULL,
    employee_id       text         NULL,
    dealership_id     text         NULL,
    department        text         NULL,
    job_role          text         NULL,
    hire_date         text         NULL,
    termination_date  text         NULL,
    is_active         text         NULL,
    is_manager        text         NULL,
    tenure_band       text         NULL,
    effective_date    text         NULL,
    expiration_date   text         NULL,
    is_current        text         NULL,
    attribute_hash    text         NULL,
    source_system     text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_employee_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_employee_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_employee_load_load_batch_id
    ON raw.employee_load (load_batch_id);

COMMENT ON TABLE raw.employee_load IS
    'Grain: one row per data row of a dim_employee.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_employee. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.employee_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.employee_load.employee_key IS 'Untyped source value. Generator-assigned employee_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/14_dim_employee_merge.sql, so staging exposes this as source_employee_key.';
COMMENT ON COLUMN raw.employee_load.employee_id IS 'Untyped source value. Natural key, EMP-##### (contract section 5). Stable across versions.';
COMMENT ON COLUMN raw.employee_load.dealership_id IS 'Untyped source value. Store the employee is assigned to in this version. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.department IS 'Untyped source value. Department. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.job_role IS 'Untyped source value. Job role. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.hire_date IS 'Untyped source value. Date the employee was hired. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.termination_date IS 'Untyped source value. Date the employee left; NULL means still employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.is_active IS 'Untyped source value. Whether the employee is currently employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.is_manager IS 'Untyped source value. Whether the role carries management responsibility. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN raw.employee_load.tenure_band IS 'Untyped source value. Banded tenure. Banded rather than exact so no precise personal timeline is published.';
COMMENT ON COLUMN raw.employee_load.effective_date IS 'Untyped source value. Inclusive start date of this version.';
COMMENT ON COLUMN raw.employee_load.expiration_date IS 'Untyped source value. Source expiration date. Informational: the merge derives the stored value from the successor version.';
COMMENT ON COLUMN raw.employee_load.is_current IS 'Untyped source value. Source current flag. Informational: the merge derives the stored value.';
COMMENT ON COLUMN raw.employee_load.attribute_hash IS 'Untyped source value. 64-character lower-case SHA-256 hex digest of tracked attributes 3-11 joined with ''|''. Computed by the generator (Agent D) and carried through unchanged; the merge compares it and never recomputes it.';
COMMENT ON COLUMN raw.employee_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.employee_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.employee_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.employee_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.employee_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
