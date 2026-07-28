-- =============================================================================
-- File:            sql/01_raw/01_raw_dealership_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_dealership.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 5 of 25 — after raw.calendar_date_load, before the staging views that read it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Contract reference: ARPI cross-agent contract section 10 (raw layer) and
-- section 8 (dim_dealership column contract). Column names and order match the
-- generator CSV header exactly.
--
-- Privacy: the ARPI dealership entity deliberately contains no street address,
-- telephone number or e-mail address. Check DQ-DLR-004 in
-- sql/08_validation/02_dim_dealership_checks.sql asserts that no such column is
-- ever added by accident.

CREATE TABLE IF NOT EXISTS raw.dealership_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract section 8, exact names and order, all text)
    dealership_key      text         NULL,
    dealership_id       text         NULL,
    store_name          text         NULL,
    store_short_name    text         NULL,
    store_type          text         NULL,
    franchise_brand     text         NULL,
    city                text         NULL,
    state_code          text         NULL,
    market_region       text         NULL,
    opened_date         text         NULL,
    is_active           text         NULL,
    effective_date      text         NULL,
    expiration_date     text         NULL,
    is_current          text         NULL,
    attribute_hash      text         NULL,
    source_system       text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_dealership_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_dealership_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging view resolves the newest load_batch_id and then reads
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_dealership_load_load_batch_id
    ON raw.dealership_load (load_batch_id);

COMMENT ON TABLE raw.dealership_load IS
    'Grain: one row per data row of a dim_dealership CSV file within one load batch. Raw landing table; '
    'business columns are untyped text and are cast in staging.stg_dealership. Never read by Power BI or '
    'Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.dealership_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when resolving the newest load batch.';
COMMENT ON COLUMN raw.dealership_load.dealership_key IS 'Untyped source value for the generator-assigned dealership_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/11_dim_dealership_merge.sql, so staging renames this to source_dealership_key.';
COMMENT ON COLUMN raw.dealership_load.dealership_id IS 'Untyped source value for the natural key, for example GSA-001.';
COMMENT ON COLUMN raw.dealership_load.store_name IS 'Untyped source value for the full store name.';
COMMENT ON COLUMN raw.dealership_load.store_short_name IS 'Untyped source value for the short store name used on dashboards.';
COMMENT ON COLUMN raw.dealership_load.store_type IS 'Untyped source value: Franchise New and Used | Independent Used.';
COMMENT ON COLUMN raw.dealership_load.franchise_brand IS 'Untyped source value for the franchise brand; empty for independent used stores.';
COMMENT ON COLUMN raw.dealership_load.city IS 'Untyped source value for the store city. Geography stops at city/market region by design.';
COMMENT ON COLUMN raw.dealership_load.state_code IS 'Untyped source value for the two-letter state code.';
COMMENT ON COLUMN raw.dealership_load.market_region IS 'Untyped source value for the market region.';
COMMENT ON COLUMN raw.dealership_load.opened_date IS 'Untyped source value for the date the store opened.';
COMMENT ON COLUMN raw.dealership_load.is_active IS 'Untyped source value (true/false) for whether the store is currently trading.';
COMMENT ON COLUMN raw.dealership_load.effective_date IS 'Untyped source value for the SCD Type 2 version start date.';
COMMENT ON COLUMN raw.dealership_load.expiration_date IS 'Untyped source value for the SCD Type 2 version end date; 9999-12-31 for current rows.';
COMMENT ON COLUMN raw.dealership_load.is_current IS 'Untyped source value (true/false) for the SCD Type 2 current-row flag.';
COMMENT ON COLUMN raw.dealership_load.attribute_hash IS 'Untyped source value: 64-character lower-case SHA-256 hex digest of the Type 2 tracked attributes.';
COMMENT ON COLUMN raw.dealership_load.source_system IS 'Untyped source value; constant arpi_synthetic_generator in Phase 0.';
COMMENT ON COLUMN raw.dealership_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.dealership_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.dealership_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.dealership_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
