-- =============================================================================
-- File:            sql/01_raw/08_raw_acquisition_event_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for acquisition_event.csv (contract section 8). All business columns are text so ingestion never fails on a bad value.
-- Execution order: 12 of 66 — after the audit tables, before staging.stg_acquisition_event reads it.
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
-- governed type is dropped by staging.stg_acquisition_event and reported through
-- staging.stg_acquisition_event_rejected, not lost silently.
--
-- WARM-UP WINDOW: acquisitions may precede reporting.start_date by up to 180 days
-- so that inventory exists on the first reporting day. This is deliberate and is
-- documented in the contract section 8.

CREATE TABLE IF NOT EXISTS raw.acquisition_event_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    acquisition_id            text         NULL,
    vehicle_id                text         NULL,
    dealership_id             text         NULL,
    acquisition_date          text         NULL,
    acquisition_source        text         NULL,
    acquisition_cost          text         NULL,
    reconditioning_cost       text         NULL,
    original_asking_price     text         NULL,
    msrp                      text         NULL,
    initial_inventory_status  text         NULL,
    source_system             text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_acquisition_event_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_acquisition_event_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_acquisition_event_load_load_batch_id
    ON raw.acquisition_event_load (load_batch_id);

COMMENT ON TABLE raw.acquisition_event_load IS
    'Grain: one row per data row of a acquisition_event.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_acquisition_event. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.acquisition_event_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.acquisition_event_load.acquisition_id IS 'Untyped source value. Natural key, ACQ-######## (contract section 5).';
COMMENT ON COLUMN raw.acquisition_event_load.vehicle_id IS 'Untyped source value. Vehicle acquired. Exactly one acquisition exists per vehicle.';
COMMENT ON COLUMN raw.acquisition_event_load.dealership_id IS 'Untyped source value. Store that acquired the vehicle.';
COMMENT ON COLUMN raw.acquisition_event_load.acquisition_date IS 'Untyped source value. Date the store took the vehicle into stock. May precede reporting.start_date by up to 180 warm-up days.';
COMMENT ON COLUMN raw.acquisition_event_load.acquisition_source IS 'Untyped source value. How the vehicle was acquired.';
COMMENT ON COLUMN raw.acquisition_event_load.acquisition_cost IS 'Untyped source value. What the store paid for the vehicle, exact to the cent.';
COMMENT ON COLUMN raw.acquisition_event_load.reconditioning_cost IS 'Untyped source value. Reconditioning spend before the vehicle went on sale. Materially higher for used than for new.';
COMMENT ON COLUMN raw.acquisition_event_load.original_asking_price IS 'Untyped source value. First advertised asking price.';
COMMENT ON COLUMN raw.acquisition_event_load.msrp IS 'Untyped source value. Manufacturer suggested retail price; NULL when the vehicle has no MSRP.';
COMMENT ON COLUMN raw.acquisition_event_load.initial_inventory_status IS 'Untyped source value. Inventory status the vehicle entered stock with.';
COMMENT ON COLUMN raw.acquisition_event_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.acquisition_event_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.acquisition_event_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.acquisition_event_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.acquisition_event_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
