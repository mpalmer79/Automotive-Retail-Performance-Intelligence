-- =============================================================================
-- File:            sql/01_raw/12_raw_marketing_spend_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for marketing_spend.csv (fact_marketing_spend in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: 16 of 66 — after the audit tables, before staging.stg_marketing_spend reads it.
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
-- governed type is dropped by staging.stg_marketing_spend and reported through
-- staging.stg_marketing_spend_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.marketing_spend_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    marketing_spend_id     text         NULL,
    month_date_key         text         NULL,
    dealership_id          text         NULL,
    campaign_id            text         NULL,
    lead_source_id         text         NULL,
    spend_amount           text         NULL,
    impressions            text         NULL,
    clicks                 text         NULL,
    calls                  text         NULL,
    form_submissions       text         NULL,
    vendor_reported_leads  text         NULL,
    source_system          text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_marketing_spend_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_marketing_spend_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_marketing_spend_load_load_batch_id
    ON raw.marketing_spend_load (load_batch_id);

COMMENT ON TABLE raw.marketing_spend_load IS
    'Grain: one row per data row of a marketing_spend.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_marketing_spend. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.marketing_spend_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.marketing_spend_load.marketing_spend_id IS 'Untyped source value. Natural key, MKT-######## (contract section 5).';
COMMENT ON COLUMN raw.marketing_spend_load.month_date_key IS
    'Untyped source value. Date key of the first day of the spend month, YYYYMM01.';
COMMENT ON COLUMN raw.marketing_spend_load.dealership_id IS 'Untyped source value. Store the spend belongs to.';
COMMENT ON COLUMN raw.marketing_spend_load.campaign_id IS 'Untyped source value. Campaign the spend belongs to.';
COMMENT ON COLUMN raw.marketing_spend_load.lead_source_id IS 'Untyped source value. Lead source the campaign attributes to.';
COMMENT ON COLUMN raw.marketing_spend_load.spend_amount IS 'Untyped source value. Money spent in the month, exact to the cent.';
COMMENT ON COLUMN raw.marketing_spend_load.impressions IS 'Untyped source value. Vendor-reported impressions.';
COMMENT ON COLUMN raw.marketing_spend_load.clicks IS 'Untyped source value. Vendor-reported clicks.';
COMMENT ON COLUMN raw.marketing_spend_load.calls IS 'Untyped source value. Vendor-reported inbound calls.';
COMMENT ON COLUMN raw.marketing_spend_load.form_submissions IS 'Untyped source value. Vendor-reported form submissions.';
COMMENT ON COLUMN raw.marketing_spend_load.vendor_reported_leads IS 'Untyped source value. Leads the vendor claims. Intentionally differs from the CRM lead count; the gap is the point of the measure, not a defect.';
COMMENT ON COLUMN raw.marketing_spend_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.marketing_spend_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.marketing_spend_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.marketing_spend_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.marketing_spend_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
