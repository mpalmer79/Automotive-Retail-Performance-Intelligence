-- =============================================================================
-- File:            sql/01_raw/06_raw_lead_source_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_lead_source.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 10 of 66 — after the audit tables, before staging.stg_lead_source reads it.
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
-- governed type is dropped by staging.stg_lead_source and reported through
-- staging.stg_lead_source_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.lead_source_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    lead_source_key   text         NULL,
    lead_source_id    text         NULL,
    lead_source_name  text         NULL,
    source_category   text         NULL,
    is_paid           text         NULL,
    is_digital        text         NULL,
    is_third_party    text         NULL,
    is_internal       text         NULL,
    source_system     text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_lead_source_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_lead_source_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_lead_source_load_load_batch_id
    ON raw.lead_source_load (load_batch_id);

COMMENT ON TABLE raw.lead_source_load IS
    'Grain: one row per data row of a dim_lead_source.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_lead_source. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.lead_source_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.lead_source_load.lead_source_key IS 'Untyped source value. Generator-assigned lead_source_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/16_dim_lead_source_merge.sql, so staging exposes this as source_lead_source_key.';
COMMENT ON COLUMN raw.lead_source_load.lead_source_id IS 'Untyped source value. Natural key, LDS-### (contract section 5).';
COMMENT ON COLUMN raw.lead_source_load.lead_source_name IS 'Untyped source value. Generic, fictional lead-source label. Names a channel, never a person or a real vendor.';
COMMENT ON COLUMN raw.lead_source_load.source_category IS 'Untyped source value. Normalised channel category.';
COMMENT ON COLUMN raw.lead_source_load.is_paid IS 'Untyped source value. Whether the source costs money per lead or per impression.';
COMMENT ON COLUMN raw.lead_source_load.is_digital IS 'Untyped source value. Whether the source is a digital channel.';
COMMENT ON COLUMN raw.lead_source_load.is_third_party IS 'Untyped source value. Whether the source is operated by a third party rather than the group.';
COMMENT ON COLUMN raw.lead_source_load.is_internal IS 'Untyped source value. Whether the source originates inside the group, for example a repeat customer.';
COMMENT ON COLUMN raw.lead_source_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.lead_source_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.lead_source_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.lead_source_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.lead_source_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
