-- =============================================================================
-- File:            sql/01_raw/16_raw_finance_product_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for dim_finance_product.csv, the governed F&I product catalogue. All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_finance_product reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-017-dim-finance-product.md.
-- Delivery increment: DASH.6 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. The catalogue of finance-and-insurance products the fictional
-- Granite Auto Group sells. EVERY PRODUCT AND EVERY ADMINISTRATOR IS INVENTED. No real
-- F&I product, program, administrator, underwriter or vendor is named anywhere in ARPI,
-- and none may be added: the catalogue carries synthetic economics and synthetic
-- cancellation behaviour, and attaching those to a real company's name would be a
-- fabricated claim about that company.
--
-- CATEGORIES ARE ROWS. product_category holds one of ten governed values. There is no
-- vsc_gross column and there never will be one; a category-per-column model makes the
-- eleventh category a migration instead of a catalogue row.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_finance_product and reported through
-- staging.stg_finance_product_rejected, not lost silently.

CREATE TABLE IF NOT EXISTS raw.finance_product_load (
    raw_record_id                bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    finance_product_key          text         NULL,
    finance_product_id           text         NULL,
    product_name                 text         NULL,
    product_category             text         NULL,
    provider_name                text         NULL,
    eligibility_rule_id          text         NULL,
    eligible_finance_structures  text         NULL,
    eligible_vehicle_conditions  text         NULL,
    default_contract_term_months text         NULL,
    cancellation_sensitive       text         NULL,
    chargeback_sensitive         text         NULL,
    active_start_date            text         NULL,
    active_end_date              text         NULL,
    is_active                    text         NULL,
    source_system                text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_finance_product_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_finance_product_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

CREATE INDEX IF NOT EXISTS ix_finance_product_load_load_batch_id
    ON raw.finance_product_load (load_batch_id);

COMMENT ON TABLE raw.finance_product_load IS
    'Grain: one row per data row of a dim_finance_product.csv file within one load batch. Raw landing
table; business columns are untyped text and are cast in staging.stg_finance_product. Carries an
INVENTED F&I product catalogue for a fictional dealer group -- no real product, program or
administrator is named. Never read by Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.finance_product_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.finance_product_load.finance_product_key IS 'Untyped source value. Generator-assigned ordinal; the warehouse assigns its own surrogate key and ignores this.';
COMMENT ON COLUMN raw.finance_product_load.finance_product_id IS 'Untyped source value. Natural key, FP-###.';
COMMENT ON COLUMN raw.finance_product_load.product_name IS 'Untyped source value. Fictional product label. Names a product, never a person, and never a real F&I program.';
COMMENT ON COLUMN raw.finance_product_load.product_category IS 'Untyped source value. One of the ten governed categories.';
COMMENT ON COLUMN raw.finance_product_load.provider_name IS 'Untyped source value. Fictional administrator label. Provider is an ATTRIBUTE of the product; warehouse.dim_finance_product_provider stays Deferred (DASH.6-01).';
COMMENT ON COLUMN raw.finance_product_load.eligibility_rule_id IS 'Untyped source value. The ELIG-* rule the product''s category owns, stamped from config/reference/fi_product_eligibility.yaml.';
COMMENT ON COLUMN raw.finance_product_load.eligible_finance_structures IS 'Untyped source value. Pipe-delimited descriptive metadata DERIVED from the governed rule, never a second authority for it.';
COMMENT ON COLUMN raw.finance_product_load.eligible_vehicle_conditions IS 'Untyped source value. Pipe-delimited descriptive metadata DERIVED from the governed rule.';
COMMENT ON COLUMN raw.finance_product_load.default_contract_term_months IS 'Untyped source value. The PRODUCT CONTRACT''s default term in months. NOT a finance loan term: ARPI models none.';
COMMENT ON COLUMN raw.finance_product_load.cancellation_sensitive IS 'Untyped source value. Whether the contract can be cancelled for a refund. Read by the adjustment generator.';
COMMENT ON COLUMN raw.finance_product_load.chargeback_sensitive IS 'Untyped source value. Whether the store''s income is charged back when the contract ends early.';
COMMENT ON COLUMN raw.finance_product_load.active_start_date IS 'Untyped source value. First date the product was offered.';
COMMENT ON COLUMN raw.finance_product_load.active_end_date IS 'Untyped source value. Last date offered, or the 9999-12-31 open-ended sentinel.';
COMMENT ON COLUMN raw.finance_product_load.is_active IS 'Untyped source value. Whether the product is currently offered; must agree with active_end_date.';
COMMENT ON COLUMN raw.finance_product_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN raw.finance_product_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.finance_product_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.finance_product_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.finance_product_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
