-- =============================================================================
-- File:            sql/01_raw/17_raw_lender_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_lender.csv, the fictional lender catalogue. All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_lender reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-018-dim-lender.md.
-- Delivery increment: DASH.6.
--
-- WHAT THIS ENTITY IS -- AND IS NOT. An analytical classification of INVENTED finance
-- sources. ARPI IS NOT A LENDING MODEL: there is no APR, buy rate, sell rate, rate
-- spread, money factor, payment, loan term, approval status, stipulation, adverse-action
-- reason, credit score, credit file, income or debt-to-income figure anywhere in this
-- lane -- not as a column, not as a generation parameter and not as a derived value.
--
-- program_tier CLASSIFIES THE FICTIONAL LENDER'S PROGRAM, NEVER A CUSTOMER. It is not a
-- credit tier and cannot become one: no ARPI entity carries a customer credit attribute,
-- so there is nothing for a tier to be derived from.

CREATE TABLE IF NOT EXISTS raw.lender_load (
    raw_record_id      bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    lender_key         text         NULL,
    lender_id          text         NULL,
    lender_name        text         NULL,
    lender_category    text         NULL,
    program_tier       text         NULL,
    active_start_date  text         NULL,
    active_end_date    text         NULL,
    is_active          text         NULL,
    source_system      text         NULL,

    -- Load metadata
    load_batch_id      uuid         NOT NULL,
    source_file_name   text         NOT NULL,
    source_row_number  integer      NOT NULL,
    ingested_at        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_lender_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_lender_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

CREATE INDEX IF NOT EXISTS ix_lender_load_load_batch_id
    ON raw.lender_load (load_batch_id);

COMMENT ON TABLE raw.lender_load IS
    'Grain: one row per data row of a dim_lender.csv file within one load batch. Raw landing table;
business columns are untyped text and are cast in staging.stg_lender. EVERY LENDER IS FICTIONAL and no
real financial institution is named. Carries no rate, payment, credit or decisioning field of any kind.
Never read by Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.lender_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.lender_load.lender_key IS 'Untyped source value. Generator-assigned ordinal; the warehouse assigns its own surrogate key and ignores this.';
COMMENT ON COLUMN raw.lender_load.lender_id IS 'Untyped source value. Natural key, LND-###.';
COMMENT ON COLUMN raw.lender_load.lender_name IS 'Untyped source value. INVENTED institution label. Names a fictional business, never a person and never a real financial institution.';
COMMENT ON COLUMN raw.lender_load.lender_category IS 'Untyped source value. Captive, Bank, Credit Union or Independent Finance Company.';
COMMENT ON COLUMN raw.lender_load.program_tier IS 'Untyped source value. Prime, Near-prime or Subprime. Classifies the FICTIONAL LENDER''S PROGRAM, never a customer, and is never a credit tier or an approval result.';
COMMENT ON COLUMN raw.lender_load.active_start_date IS 'Untyped source value. First date the lender''s program was available.';
COMMENT ON COLUMN raw.lender_load.active_end_date IS 'Untyped source value. Last date available, or the 9999-12-31 open-ended sentinel.';
COMMENT ON COLUMN raw.lender_load.is_active IS 'Untyped source value. Whether the program is current; must agree with active_end_date.';
COMMENT ON COLUMN raw.lender_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN raw.lender_load.load_batch_id IS 'UUID identifying one ingestion batch.';
COMMENT ON COLUMN raw.lender_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.lender_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.lender_load.ingested_at IS 'UTC instant the row was landed.';
