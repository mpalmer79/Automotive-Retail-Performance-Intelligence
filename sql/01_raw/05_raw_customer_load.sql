-- =============================================================================
-- File:            sql/01_raw/05_raw_customer_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_customer.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 9 of 66 — after the audit tables, before staging.stg_customer reads it.
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
-- governed type is dropped by staging.stg_customer and reported through
-- staging.stg_customer_rejected, not lost silently.
--
-- PRIVACY: no name, date of birth, street address, e-mail, telephone number,
-- social security number, driving licence, bank account, payment card, credit
-- score, protected characteristic or free-text note exists on this entity.

CREATE TABLE IF NOT EXISTS raw.customer_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    customer_key            text         NULL,
    customer_id             text         NULL,
    household_id            text         NULL,
    age_band                text         NULL,
    county                  text         NULL,
    state_code              text         NULL,
    market_area             text         NULL,
    customer_type           text         NULL,
    is_prior_customer       text         NULL,
    is_service_customer     text         NULL,
    first_interaction_date  text         NULL,
    source_system           text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_customer_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_customer_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_customer_load_load_batch_id
    ON raw.customer_load (load_batch_id);

COMMENT ON TABLE raw.customer_load IS
    'Grain: one row per data row of a dim_customer.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_customer. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.customer_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.customer_load.customer_key IS 'Untyped source value. Generator-assigned customer_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/15_dim_customer_merge.sql, so staging exposes this as source_customer_key.';
COMMENT ON COLUMN raw.customer_load.customer_id IS 'Untyped source value. Natural key, CUS-######## (contract section 5).';
COMMENT ON COLUMN raw.customer_load.household_id IS 'Untyped source value. Synthetic household grouping, HH-########. Links related customers without naming anybody.';
COMMENT ON COLUMN raw.customer_load.age_band IS 'Untyped source value. Banded age cohort. Exact age and date of birth are prohibited.';
COMMENT ON COLUMN raw.customer_load.county IS 'Untyped source value. County of residence. Geography deliberately stops here; no street address exists.';
COMMENT ON COLUMN raw.customer_load.state_code IS 'Untyped source value. Two-letter state code; NH or MA.';
COMMENT ON COLUMN raw.customer_load.market_area IS 'Untyped source value. Coarse market area the county belongs to.';
COMMENT ON COLUMN raw.customer_load.customer_type IS 'Untyped source value. Retail | Business.';
COMMENT ON COLUMN raw.customer_load.is_prior_customer IS 'Untyped source value. Whether the customer had transacted with the group before.';
COMMENT ON COLUMN raw.customer_load.is_service_customer IS 'Untyped source value. Whether the customer is known to the service department.';
COMMENT ON COLUMN raw.customer_load.first_interaction_date IS 'Untyped source value. Date of the first recorded interaction with the group.';
COMMENT ON COLUMN raw.customer_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.customer_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.customer_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.customer_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.customer_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
