-- =============================================================================
-- File:            sql/01_raw/14_raw_inventory_listing_snapshot_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for a sanitized public inventory listing workbook. All business columns are text so ingestion never fails on a bad value.
-- Execution order: Raw layer, after the twelve generator landing tables and before staging.stg_inventory_listing_snapshot reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per Inventory-sheet data row of one sanitized workbook within one load batch.
-- =============================================================================
--
-- WHY THIS IS NOT raw.inventory_snapshot_load
-- -------------------------------------------
-- raw.inventory_snapshot_load lands OWNED inventory: acquisition cost,
-- reconditioning cost, inventory investment, days in stock, markdown counts. A
-- public listing snapshot can supply none of those. Forcing this source into that
-- table would mean inventing the financial columns or leaving them NULL on a
-- NOT NULL contract, and either one would let an inventory-investment report read
-- a number that has no source. Two sources, two landing tables, two honest grains.
--
-- WHAT A ROW MEANS
-- ----------------
-- A row records that ONE VEHICLE LISTING WAS VISIBLE in a de-identified public
-- source at one moment. It does not record that the vehicle was on the ground, that
-- the dealership owned it, what it cost, or what it sold for.
--
-- WHAT MAY NEVER APPEAR HERE
-- --------------------------
-- There is no original VIN column and no source URL column, and there never may be.
-- The sanitizer removes both before an artifact is committed
-- (src/arpi/inventory/sanitizer.py), the validator refuses a workbook that carries
-- either (DQ-LST-005, DQ-LST-006), and the importer refuses to COPY a column this
-- table does not declare. Three independent controls, and the absence of the column
-- is the last of them.
--
-- Column names and order match the sanitized Inventory sheet contract declared in
-- config/reference/inventory_listing_contract.yaml, so the importer's COPY column
-- list is the contract's column list plus the load metadata.

CREATE TABLE IF NOT EXISTS raw.inventory_listing_snapshot_load (
    raw_record_id           bigserial    NOT NULL,

    -- Business columns (sanitized contract order, all untyped text)
    source_record_id        text         NULL,
    dealership_id           text         NULL,
    store_name              text         NULL,
    captured_at             text         NULL,
    source_batch_id         text         NULL,
    source_feed             text         NULL,
    condition_type          text         NULL,
    model_year              text         NULL,
    make                    text         NULL,
    model                   text         NULL,
    trim                    text         NULL,
    vehicle_display         text         NULL,
    odometer_miles          text         NULL,
    advertised_price        text         NULL,
    pricing_status          text         NULL,
    synthetic_vehicle_id    text         NULL,
    synthetic_vin           text         NULL,
    inventory_unit_count    text         NULL,
    data_classification     text         NULL,

    -- Load metadata
    load_batch_id           uuid         NOT NULL,
    source_file_name        text         NOT NULL,
    source_file_digest      char(64)     NOT NULL,
    source_row_number       integer      NOT NULL,
    ingested_at             timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_inventory_listing_snapshot_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_inventory_listing_snapshot_load_source_row_number_positive
        CHECK (source_row_number > 0),
    -- The digest is lineage that must be present, not an optional nicety: it is what
    -- lets a reviewer prove which bytes produced which warehouse rows, and it is the
    -- evidence DQ-LST-014 asserts.
    CONSTRAINT ck_inventory_listing_snapshot_load_digest_shape
        CHECK (source_file_digest ~ '^[0-9a-f]{64}$')
);

-- The staging views resolve the newest load_batch_id and then read only that batch.
CREATE INDEX IF NOT EXISTS ix_inventory_listing_snapshot_load_load_batch_id
    ON raw.inventory_listing_snapshot_load (load_batch_id);

-- Idempotency is decided by asking whether this exact file has already been landed,
-- which is a lookup on the digest.
CREATE INDEX IF NOT EXISTS ix_inventory_listing_snapshot_load_source_file_digest
    ON raw.inventory_listing_snapshot_load (source_file_digest);

COMMENT ON TABLE raw.inventory_listing_snapshot_load IS
    'Grain: one row per Inventory-sheet data row of one sanitized public inventory listing workbook within
one load batch. Raw landing table; business columns are untyped text and are cast in
staging.stg_inventory_listing_snapshot. Sanitized public reference data, NOT synthetic and NOT confidential
DMS data. Contains no original VIN and no source URL, by contract and by the absence of the columns. Never
read by Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.inventory_listing_snapshot_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_record_id IS 'Untyped source value. Deterministic per-row identifier assigned by the sanitizer.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.dealership_id IS 'Untyped source value. Fictional store the listing was assigned to; part of the declared grain.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.store_name IS 'Untyped source value. Store name, cross-checked against the dealership registry in staging.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.captured_at IS 'Untyped source value. Observation date of the listing snapshot; part of the declared grain.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_batch_id IS 'Untyped source value. Deterministic capture-batch identifier; one workbook is one batch.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_feed IS 'Untyped source value. Neutral feed label that replaced the row-level source URL. Names the lane, never the origin.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.condition_type IS 'Untyped source value. New or Used.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.model_year IS 'Untyped source value. Model year as advertised.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.make IS 'Untyped source value. Advertised make.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.model IS 'Untyped source value. Advertised model.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.trim IS 'Untyped source value. Advertised trim; legitimately absent.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.vehicle_display IS 'Untyped source value. Year/make/model/trim as one advertised string.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.odometer_miles IS 'Untyped source value. Advertised odometer reading.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.advertised_price IS 'Untyped source value. ADVERTISED price only. Not transaction price, not acquisition cost, not inventory investment, not MSRP, not gross. Absent for a call-for-price listing.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.pricing_status IS 'Untyped source value. Listed or Call for price.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.synthetic_vehicle_id IS 'Untyped source value. Group-stable ARPI vehicle identity derived from the original identifier by SHA-256. The original is not recoverable from it.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.synthetic_vin IS 'Untyped source value. ARPI-prefixed synthetic VIN. The prefix contains I, which no real VIN may, so the value can never be a real VIN.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.inventory_unit_count IS 'Untyped source value. Always 1.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.data_classification IS 'Untyped source value. Must be the approved classification; staging rejects any other value.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single import shares this value.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_file_name IS 'File name the rows were read from, preserved EXACTLY as committed, underscores and capitalisation included.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_file_digest IS 'SHA-256 of the workbook bytes. Lineage evidence, and the key the importer uses to decide that a rerun of the same file has nothing to do.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.source_row_number IS 'One-based data-row number on the Inventory sheet, excluding the header.';
COMMENT ON COLUMN raw.inventory_listing_snapshot_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
