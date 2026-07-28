-- =============================================================================
-- File:            sql/01_raw/03_raw_vehicle_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_vehicle.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 7 of 66 — after the audit tables, before staging.stg_vehicle reads it.
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
-- governed type is dropped by staging.stg_vehicle and reported through
-- staging.stg_vehicle_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.vehicle_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    vehicle_key         text         NULL,
    vehicle_id          text         NULL,
    synthetic_vin       text         NULL,
    vehicle_model_key   text         NULL,
    vehicle_model_id    text         NULL,
    condition_type      text         NULL,
    exterior_color      text         NULL,
    interior_color      text         NULL,
    odometer_reading    text         NULL,
    odometer_band       text         NULL,
    acquisition_source  text         NULL,
    source_system       text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_vehicle_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_vehicle_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_vehicle_load_load_batch_id
    ON raw.vehicle_load (load_batch_id);

COMMENT ON TABLE raw.vehicle_load IS
    'Grain: one row per data row of a dim_vehicle.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_vehicle. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.vehicle_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.vehicle_load.vehicle_key IS 'Untyped source value. Generator-assigned vehicle_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/13_dim_vehicle_merge.sql, so staging exposes this as source_vehicle_key.';
COMMENT ON COLUMN raw.vehicle_load.vehicle_id IS 'Untyped source value. Natural key, VEH-####### (contract section 5).';
COMMENT ON COLUMN raw.vehicle_load.synthetic_vin IS 'Untyped source value. 17-character synthetic vehicle identifier with the ARPI prefix. Deliberately NOT a valid VIN and never resolvable to a real vehicle or owner.';
COMMENT ON COLUMN raw.vehicle_load.vehicle_model_key IS 'Untyped source value. Generator-assigned vehicle_model_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/13_dim_vehicle_merge.sql, so staging exposes this as source_vehicle_model_key.';
COMMENT ON COLUMN raw.vehicle_load.vehicle_model_id IS 'Untyped source value. Model this vehicle is an instance of; resolved to a surrogate key by the merge.';
COMMENT ON COLUMN raw.vehicle_load.condition_type IS 'Untyped source value. New | Used | Certified.';
COMMENT ON COLUMN raw.vehicle_load.exterior_color IS 'Untyped source value. Exterior colour label.';
COMMENT ON COLUMN raw.vehicle_load.interior_color IS 'Untyped source value. Interior colour label.';
COMMENT ON COLUMN raw.vehicle_load.odometer_reading IS 'Untyped source value. Odometer reading in miles; never negative.';
COMMENT ON COLUMN raw.vehicle_load.odometer_band IS 'Untyped source value. Banded odometer reading used for reporting.';
COMMENT ON COLUMN raw.vehicle_load.acquisition_source IS 'Untyped source value. How the store came to own the vehicle.';
COMMENT ON COLUMN raw.vehicle_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.vehicle_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.vehicle_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.vehicle_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.vehicle_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
