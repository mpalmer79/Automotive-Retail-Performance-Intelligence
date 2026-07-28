-- =============================================================================
-- File:            sql/01_raw/10_raw_lead_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for lead.csv (fact_lead in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: 14 of 66 — after the audit tables, before staging.stg_lead reads it.
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
-- governed type is dropped by staging.stg_lead and reported through
-- staging.stg_lead_rejected, not lost silently.
--
-- PRIVACY: no communication content column exists on this entity, by design.

CREATE TABLE IF NOT EXISTS raw.lead_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    lead_id                 text         NULL,
    lead_created_date       text         NULL,
    dealership_id           text         NULL,
    customer_id             text         NULL,
    vehicle_model_id        text         NULL,
    lead_source_id          text         NULL,
    campaign_id             text         NULL,
    assigned_employee_id    text         NULL,
    sale_id                 text         NULL,
    lead_count              text         NULL,
    first_response_seconds  text         NULL,
    is_contacted            text         NULL,
    is_appointment_set      text         NULL,
    is_appointment_shown    text         NULL,
    is_sold                 text         NULL,
    is_duplicate            text         NULL,
    original_lead_id        text         NULL,
    days_to_sale            text         NULL,
    source_system           text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_lead_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_lead_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_lead_load_load_batch_id
    ON raw.lead_load (load_batch_id);

COMMENT ON TABLE raw.lead_load IS
    'Grain: one row per data row of a lead.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_lead. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.lead_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.lead_load.lead_id IS 'Untyped source value. Natural key, LED-######### (contract section 5).';
COMMENT ON COLUMN raw.lead_load.lead_created_date IS 'Untyped source value. Date the lead was created in the CRM.';
COMMENT ON COLUMN raw.lead_load.dealership_id IS 'Untyped source value. Store the lead belongs to.';
COMMENT ON COLUMN raw.lead_load.customer_id IS 'Untyped source value. Customer the lead resolved to; NULL when it never resolved to one.';
COMMENT ON COLUMN raw.lead_load.vehicle_model_id IS 'Untyped source value. Model of interest; NULL when the lead expressed none.';
COMMENT ON COLUMN raw.lead_load.lead_source_id IS 'Untyped source value. Source the lead arrived from.';
COMMENT ON COLUMN raw.lead_load.campaign_id IS 'Untyped source value. Campaign the lead is attributed to; NULL when unattributed.';
COMMENT ON COLUMN raw.lead_load.assigned_employee_id IS 'Untyped source value. Employee the lead was assigned to; NULL when unassigned.';
COMMENT ON COLUMN raw.lead_load.sale_id IS 'Untyped source value. Sale the lead converted to; NULL when it did not convert.';
COMMENT ON COLUMN raw.lead_load.lead_count IS 'Untyped source value. Always exactly 1; the additive count measure.';
COMMENT ON COLUMN raw.lead_load.first_response_seconds IS 'Untyped source value. Seconds to first response. NULL means never responded to; 0 is a real value, never a stand-in for missing.';
COMMENT ON COLUMN raw.lead_load.is_contacted IS 'Untyped source value. Whether anyone made contact.';
COMMENT ON COLUMN raw.lead_load.is_appointment_set IS 'Untyped source value. Whether an appointment was set.';
COMMENT ON COLUMN raw.lead_load.is_appointment_shown IS 'Untyped source value. Whether the appointment was kept.';
COMMENT ON COLUMN raw.lead_load.is_sold IS 'Untyped source value. Whether the lead converted to a sale.';
COMMENT ON COLUMN raw.lead_load.is_duplicate IS 'Untyped source value. Whether the lead duplicates an earlier one.';
COMMENT ON COLUMN raw.lead_load.original_lead_id IS 'Untyped source value. Lead this one duplicates; NULL when it is not a duplicate.';
COMMENT ON COLUMN raw.lead_load.days_to_sale IS 'Untyped source value. Days from lead creation to sale; NULL when it never sold.';
COMMENT ON COLUMN raw.lead_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.lead_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.lead_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.lead_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.lead_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
