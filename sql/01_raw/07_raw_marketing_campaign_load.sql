-- =============================================================================
-- File:            sql/01_raw/07_raw_marketing_campaign_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_marketing_campaign.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 11 of 66 — after the audit tables, before staging.stg_marketing_campaign reads it.
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
-- governed type is dropped by staging.stg_marketing_campaign and reported through
-- staging.stg_marketing_campaign_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.marketing_campaign_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    campaign_key             text         NULL,
    campaign_id              text         NULL,
    campaign_name            text         NULL,
    channel                  text         NULL,
    vendor_name              text         NULL,
    lead_source_id           text         NULL,
    start_date               text         NULL,
    end_date                 text         NULL,
    target_department        text         NULL,
    target_vehicle_category  text         NULL,
    source_system            text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_marketing_campaign_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_marketing_campaign_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_load_load_batch_id
    ON raw.marketing_campaign_load (load_batch_id);

COMMENT ON TABLE raw.marketing_campaign_load IS
    'Grain: one row per data row of a dim_marketing_campaign.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_marketing_campaign. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.marketing_campaign_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.marketing_campaign_load.campaign_key IS 'Untyped source value. Generator-assigned campaign_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/17_dim_marketing_campaign_merge.sql, so staging exposes this as source_campaign_key.';
COMMENT ON COLUMN raw.marketing_campaign_load.campaign_id IS 'Untyped source value. Natural key, CMP-##### (contract section 5).';
COMMENT ON COLUMN raw.marketing_campaign_load.campaign_name IS 'Untyped source value. Fictional campaign label. Names a campaign, never a person.';
COMMENT ON COLUMN raw.marketing_campaign_load.channel IS 'Untyped source value. Delivery channel the campaign runs on.';
COMMENT ON COLUMN raw.marketing_campaign_load.vendor_name IS 'Untyped source value. Fictional vendor label. No real vendor is referenced.';
COMMENT ON COLUMN raw.marketing_campaign_load.lead_source_id IS 'Untyped source value. Lead source the campaign attributes its leads to.';
COMMENT ON COLUMN raw.marketing_campaign_load.start_date IS 'Untyped source value. First day the campaign is live.';
COMMENT ON COLUMN raw.marketing_campaign_load.end_date IS 'Untyped source value. Last day the campaign is live; NULL means still running.';
COMMENT ON COLUMN raw.marketing_campaign_load.target_department IS 'Untyped source value. Sales | Service | Both.';
COMMENT ON COLUMN raw.marketing_campaign_load.target_vehicle_category IS 'Untyped source value. New | Used | Both.';
COMMENT ON COLUMN raw.marketing_campaign_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.marketing_campaign_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.marketing_campaign_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.marketing_campaign_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.marketing_campaign_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
