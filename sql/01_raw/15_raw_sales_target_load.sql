-- =============================================================================
-- File:            sql/01_raw/15_raw_sales_target_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for sales_target.csv (fact_sales_target in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_sales_target reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-016-fact-sales-target.md.
--
-- WHAT THIS ENTITY IS. The monthly operating PLAN, not the result: what a store
-- committed to sell and to produce in a calendar month, at store, department or
-- employee scope. Every value is a synthetic internal operating goal for the
-- fictional Granite Auto Group. None of them is an industry benchmark, a
-- manufacturer objective or a real dealership's plan.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_sales_target and reported through
-- staging.stg_sales_target_rejected, not lost silently.
--
-- RAW IS NOT SKIPPED BECAUSE THE DATA IS SYNTHETIC. Every ARPI entity travels the
-- same four layers; a plan that entered the warehouse by a private door would have
-- no rejected-record path, no row-count chain and no lineage columns, and the one
-- table whose numbers become a denominator is the last one that should be exempt.

CREATE TABLE IF NOT EXISTS raw.sales_target_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    sales_target_id        text         NULL,
    target_month_date_key  text         NULL,
    dealership_id          text         NULL,
    target_scope_type      text         NULL,
    target_scope_id        text         NULL,
    department_name        text         NULL,
    employee_id            text         NULL,
    kpi_id                 text         NULL,
    target_value           text         NULL,
    stretch_target_value   text         NULL,
    source_system          text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_sales_target_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_sales_target_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_sales_target_load_load_batch_id
    ON raw.sales_target_load (load_batch_id);

COMMENT ON TABLE raw.sales_target_load IS
    'Grain: one row per data row of a sales_target.csv file within one load batch. Raw landing table;
business columns are untyped text and are cast in staging.stg_sales_target. Carries the monthly
operating PLAN, which is a synthetic internal goal for a fictional dealer group and never an industry
benchmark. Never read by Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.sales_target_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.sales_target_load.sales_target_id IS 'Untyped source value. Natural key, TGT-########.';
COMMENT ON COLUMN raw.sales_target_load.target_month_date_key IS 'Untyped source value. Date key of the first day of the target month, YYYYMM01.';
COMMENT ON COLUMN raw.sales_target_load.dealership_id IS 'Untyped source value. Store the target belongs to.';
COMMENT ON COLUMN raw.sales_target_load.target_scope_type IS 'Untyped source value. Store, Department or Employee.';
COMMENT ON COLUMN raw.sales_target_load.target_scope_id IS 'Untyped source value. Business identity of the scope: the dealership_id, the department name, or the employee_id.';
COMMENT ON COLUMN raw.sales_target_load.department_name IS 'Untyped source value. Populated only by a Department-scope row; empty otherwise.';
COMMENT ON COLUMN raw.sales_target_load.employee_id IS 'Untyped source value. Populated only by an Employee-scope row; empty otherwise. A synthetic identifier, never a name.';
COMMENT ON COLUMN raw.sales_target_load.kpi_id IS 'Untyped source value. The metric BEING TARGETED (KPI-SLS-001, KPI-GRS-001, KPI-GRS-002 or KPI-GRS-003). Never a KPI-TGT id: those are computed FROM these rows.';
COMMENT ON COLUMN raw.sales_target_load.target_value IS 'Untyped source value. The month''s committed goal, exact to two decimal places.';
COMMENT ON COLUMN raw.sales_target_load.stretch_target_value IS 'Untyped source value. The month''s stretch goal, never below target_value.';
COMMENT ON COLUMN raw.sales_target_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN raw.sales_target_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.sales_target_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.sales_target_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.sales_target_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
