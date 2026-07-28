-- =============================================================================
-- File:            sql/01_raw/02_raw_vehicle_model_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_vehicle_model.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 6 of 66 — after the audit tables, before staging.stg_vehicle_model reads it.
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
-- governed type is dropped by staging.stg_vehicle_model and reported through
-- staging.stg_vehicle_model_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.vehicle_model_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    vehicle_model_key      text         NULL,
    vehicle_model_id       text         NULL,
    model_year             text         NULL,
    make                   text         NULL,
    model                  text         NULL,
    "trim"                 text         NULL,
    body_style             text         NULL,
    vehicle_class          text         NULL,
    fuel_type              text         NULL,
    drivetrain             text         NULL,
    transmission           text         NULL,
    doors                  text         NULL,
    seating_capacity       text         NULL,
    franchise_alignment    text         NULL,
    is_current_model_line  text         NULL,
    source_system          text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_vehicle_model_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_vehicle_model_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_vehicle_model_load_load_batch_id
    ON raw.vehicle_model_load (load_batch_id);

COMMENT ON TABLE raw.vehicle_model_load IS
    'Grain: one row per data row of a dim_vehicle_model.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_vehicle_model. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.vehicle_model_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.vehicle_model_load.vehicle_model_key IS 'Untyped source value. Generator-assigned vehicle_model_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/12_dim_vehicle_model_merge.sql, so staging exposes this as source_vehicle_model_key.';
COMMENT ON COLUMN raw.vehicle_model_load.vehicle_model_id IS 'Untyped source value. Natural key, VMD-##### (contract section 5).';
COMMENT ON COLUMN raw.vehicle_model_load.model_year IS 'Untyped source value. Model year; 1990..2030.';
COMMENT ON COLUMN raw.vehicle_model_load.make IS 'Untyped source value. Vehicle make, for example Chevrolet. Names a product, never a person.';
COMMENT ON COLUMN raw.vehicle_model_load.model IS 'Untyped source value. Vehicle model line, for example Equinox.';
COMMENT ON COLUMN raw.vehicle_model_load."trim" IS 'Untyped source value. Trim level, for example LT.';
COMMENT ON COLUMN raw.vehicle_model_load.body_style IS 'Untyped source value. Body style.';
COMMENT ON COLUMN raw.vehicle_model_load.vehicle_class IS 'Untyped source value. Marketing size/class band.';
COMMENT ON COLUMN raw.vehicle_model_load.fuel_type IS 'Untyped source value. Propulsion type.';
COMMENT ON COLUMN raw.vehicle_model_load.drivetrain IS 'Untyped source value. Driven axles.';
COMMENT ON COLUMN raw.vehicle_model_load.transmission IS 'Untyped source value. Transmission type.';
COMMENT ON COLUMN raw.vehicle_model_load.doors IS 'Untyped source value. Door count; 2..5.';
COMMENT ON COLUMN raw.vehicle_model_load.seating_capacity IS 'Untyped source value. Factory seating capacity; 2..8.';
COMMENT ON COLUMN raw.vehicle_model_load.franchise_alignment IS 'Untyped source value. Which Granite State Auto Group franchise sells this model line.';
COMMENT ON COLUMN raw.vehicle_model_load.is_current_model_line IS 'Untyped source value. Whether the model line is still in production.';
COMMENT ON COLUMN raw.vehicle_model_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.vehicle_model_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.vehicle_model_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.vehicle_model_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.vehicle_model_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
