-- =============================================================================
-- File:            sql/01_raw/13_raw_inventory_snapshot_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for inventory_snapshot_event.csv (fact_vehicle_inventory_snapshot in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: 17 of 73 — after the audit tables and the other raw landing tables, before staging.stg_inventory_snapshot reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================

--
-- Contract reference: ARPI Phase 1 cross-agent contract section 7
-- (warehouse.fact_vehicle_inventory_snapshot). Column names and order match the
-- generator CSV header exactly -- src/arpi/generation/inventory_snapshot.py,
-- INVENTORY_SNAPSHOT_EVENT_COLUMNS -- so the loader's COPY column list is the
-- generated frame's column list plus the load metadata.
--
-- WHY THIS TABLE IS THE LARGEST IN raw
-- ------------------------------------
-- The snapshot grain is one row per vehicle per store per day in stock, so this
-- landing table holds roughly (units in stock) x (days in the window) rows: about
-- 46,000 at the development profile against 900 rows for the acquisitions that
-- produced them. That is inherent to a periodic snapshot fact and is the reason
-- the reporting window, not the acquisition warm-up, bounds the emitted dates.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_inventory_snapshot and reported through
-- staging.stg_inventory_snapshot_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.inventory_snapshot_load (
    raw_record_id           bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    snapshot_date           text         NULL,
    dealership_id           text         NULL,
    vehicle_id              text         NULL,
    vehicle_model_id        text         NULL,
    current_asking_price    text         NULL,
    original_asking_price   text         NULL,
    msrp                    text         NULL,
    acquisition_cost        text         NULL,
    reconditioning_cost     text         NULL,
    inventory_investment    text         NULL,
    days_in_stock           text         NULL,
    age_bucket              text         NULL,
    markdown_count_to_date  text         NULL,
    inventory_unit_count    text         NULL,
    source_system           text         NULL,

    -- Load metadata
    load_batch_id           uuid         NOT NULL,
    source_file_name        text         NOT NULL,
    source_row_number       integer      NOT NULL,
    ingested_at             timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_inventory_snapshot_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_inventory_snapshot_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column. On the largest raw
-- table in the database this index is the difference between a sequential scan of
-- every batch ever loaded and a read of the current one.
CREATE INDEX IF NOT EXISTS ix_inventory_snapshot_load_load_batch_id
    ON raw.inventory_snapshot_load (load_batch_id);

COMMENT ON TABLE raw.inventory_snapshot_load IS
    'Grain: one row per data row of an inventory_snapshot_event.csv file within one load batch. Raw landing
table; business columns are untyped text and are cast in staging.stg_inventory_snapshot. Never read by
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.inventory_snapshot_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.inventory_snapshot_load.snapshot_date IS 'Untyped source value. As-of date of the snapshot; part of the declared grain.';
COMMENT ON COLUMN raw.inventory_snapshot_load.dealership_id IS 'Untyped source value. Store holding the unit; part of the declared grain.';
COMMENT ON COLUMN raw.inventory_snapshot_load.vehicle_id IS 'Untyped source value. The unit in stock; part of the declared grain.';
COMMENT ON COLUMN raw.inventory_snapshot_load.vehicle_model_id IS 'Untyped source value. Model of the unit, denormalised onto the snapshot.';
COMMENT ON COLUMN raw.inventory_snapshot_load.current_asking_price IS 'Untyped source value. Advertised price on the snapshot date, after age-driven markdowns.';
COMMENT ON COLUMN raw.inventory_snapshot_load.original_asking_price IS 'Untyped source value. First advertised price.';
COMMENT ON COLUMN raw.inventory_snapshot_load.msrp IS 'Untyped source value. Manufacturer suggested retail price; absent for a used unit.';
COMMENT ON COLUMN raw.inventory_snapshot_load.acquisition_cost IS 'Untyped source value. What the store paid for the unit.';
COMMENT ON COLUMN raw.inventory_snapshot_load.reconditioning_cost IS 'Untyped source value. Reconditioning spend booked against the unit.';
COMMENT ON COLUMN raw.inventory_snapshot_load.inventory_investment IS 'Untyped source value. acquisition_cost + reconditioning_cost; the warehouse enforces the identity.';
COMMENT ON COLUMN raw.inventory_snapshot_load.days_in_stock IS 'Untyped source value. Days since acquisition, measured from the acquisition date and not from the first snapshot date.';
COMMENT ON COLUMN raw.inventory_snapshot_load.age_bucket IS 'Untyped source value. Banded days_in_stock: 0-30 | 31-60 | 61-90 | 91-120 | Over 120.';
COMMENT ON COLUMN raw.inventory_snapshot_load.markdown_count_to_date IS 'Untyped source value. Price reductions taken to date; never decreases for a unit.';
COMMENT ON COLUMN raw.inventory_snapshot_load.inventory_unit_count IS 'Untyped source value. Always 1.';
COMMENT ON COLUMN raw.inventory_snapshot_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.inventory_snapshot_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.inventory_snapshot_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.inventory_snapshot_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.inventory_snapshot_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
