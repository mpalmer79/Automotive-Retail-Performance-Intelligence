-- =============================================================================
-- File:            sql/01_raw/11_raw_appointment_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for appointment.csv (fact_appointment in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: 15 of 66 — after the audit tables, before staging.stg_appointment reads it.
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
-- governed type is dropped by staging.stg_appointment and reported through
-- staging.stg_appointment_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.appointment_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    appointment_id           text         NULL,
    created_date             text         NULL,
    scheduled_date           text         NULL,
    show_date                text         NULL,
    dealership_id            text         NULL,
    lead_id                  text         NULL,
    customer_id              text         NULL,
    salesperson_id           text         NULL,
    bdc_employee_id          text         NULL,
    vehicle_model_id         text         NULL,
    sale_id                  text         NULL,
    appointment_count        text         NULL,
    is_confirmed             text         NULL,
    is_cancelled_in_advance  text         NULL,
    is_shown                 text         NULL,
    is_test_drive            text         NULL,
    is_write_up              text         NULL,
    is_sold                  text         NULL,
    minutes_early_or_late    text         NULL,
    source_system            text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_appointment_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_appointment_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_appointment_load_load_batch_id
    ON raw.appointment_load (load_batch_id);

COMMENT ON TABLE raw.appointment_load IS
    'Grain: one row per data row of a appointment.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_appointment. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.appointment_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.appointment_load.appointment_id IS 'Untyped source value. Natural key, APT-######## (contract section 5).';
COMMENT ON COLUMN raw.appointment_load.created_date IS 'Untyped source value. Date the appointment was created.';
COMMENT ON COLUMN raw.appointment_load.scheduled_date IS 'Untyped source value. Date the appointment was scheduled for; never before created_date.';
COMMENT ON COLUMN raw.appointment_load.show_date IS 'Untyped source value. Date the customer actually attended; NULL when they did not.';
COMMENT ON COLUMN raw.appointment_load.dealership_id IS 'Untyped source value. Store the appointment belongs to.';
COMMENT ON COLUMN raw.appointment_load.lead_id IS 'Untyped source value. Lead the appointment was set from.';
COMMENT ON COLUMN raw.appointment_load.customer_id IS 'Untyped source value. Customer expected; NULL when the lead never resolved to one.';
COMMENT ON COLUMN raw.appointment_load.salesperson_id IS 'Untyped source value. Salesperson assigned; NULL when none.';
COMMENT ON COLUMN raw.appointment_load.bdc_employee_id IS 'Untyped source value. BDC representative who set the appointment; NULL when none.';
COMMENT ON COLUMN raw.appointment_load.vehicle_model_id IS 'Untyped source value. Model of interest; NULL when none was expressed.';
COMMENT ON COLUMN raw.appointment_load.sale_id IS 'Untyped source value. Sale the appointment produced; NULL when it produced none.';
COMMENT ON COLUMN raw.appointment_load.appointment_count IS 'Untyped source value. Always exactly 1; the additive count measure.';
COMMENT ON COLUMN raw.appointment_load.is_confirmed IS 'Untyped source value. Whether the appointment was confirmed in advance.';
COMMENT ON COLUMN raw.appointment_load.is_cancelled_in_advance IS 'Untyped source value. Whether the customer cancelled before the slot.';
COMMENT ON COLUMN raw.appointment_load.is_shown IS 'Untyped source value. Whether the customer attended.';
COMMENT ON COLUMN raw.appointment_load.is_test_drive IS 'Untyped source value. Whether a test drive took place.';
COMMENT ON COLUMN raw.appointment_load.is_write_up IS 'Untyped source value. Whether the visit produced a written deal.';
COMMENT ON COLUMN raw.appointment_load.is_sold IS 'Untyped source value. Whether the visit produced a sale.';
COMMENT ON COLUMN raw.appointment_load.minutes_early_or_late IS 'Untyped source value. Signed minutes early (negative) or late (positive). NULL when the customer did not attend.';
COMMENT ON COLUMN raw.appointment_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.appointment_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.appointment_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.appointment_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.appointment_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
