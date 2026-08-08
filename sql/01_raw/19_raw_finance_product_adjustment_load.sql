-- =============================================================================
-- File:            sql/01_raw/19_raw_finance_product_adjustment_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for finance_product_adjustment.csv (fact_finance_product_adjustment in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_finance_product_adjustment reads it.
-- Idempotency:     Fully idempotent DDL. Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-020-fact-finance-product-adjustment.md.
-- Delivery increment: DASH.6.
--
-- WHAT THIS ENTITY IS. One row per product adjustment EVENT: a Cancellation, a
-- Chargeback, a Reinstatement or an Approved Adjustment. Each carries its OWN business
-- date. An August chargeback on a June contract belongs to August for adjustment-period
-- analysis, and the June contract row keeps June's gross unchanged -- restating it would
-- move production out of the month it happened in and make every historical month
-- unstable.
--
-- THE SIGN CONVENTION, stated once:
--     net_product_gross_as_of = original_product_gross
--                             - SUM(adjustment_amount WHERE adjustment_date <= as_of)
-- A POSITIVE amount REDUCES retained gross; a NEGATIVE one restores it.
--
-- adjustment_reason_category IS A CLOSED VOCABULARY AND THERE IS NO FREE-TEXT FIELD. A
-- free-text reason is where somebody eventually writes something about a customer.

CREATE TABLE IF NOT EXISTS raw.finance_product_adjustment_load (
    raw_record_id               bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    adjustment_id               text         NULL,
    product_sale_id             text         NULL,
    sale_id                     text         NULL,
    adjustment_date             text         NULL,
    dealership_id               text         NULL,
    finance_manager_id          text         NULL,
    finance_product_id          text         NULL,
    product_category            text         NULL,
    adjustment_type             text         NULL,
    adjustment_amount           text         NULL,
    adjustment_reason_category  text         NULL,
    sequence_ordinal            text         NULL,
    source_system               text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_finance_product_adjustment_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_finance_product_adjustment_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

CREATE INDEX IF NOT EXISTS ix_finance_product_adjustment_load_load_batch_id
    ON raw.finance_product_adjustment_load (load_batch_id);

COMMENT ON TABLE raw.finance_product_adjustment_load IS
    'Grain: one row per data row of a finance_product_adjustment.csv file within one load batch. Raw
landing table; business columns are untyped text and are cast in
staging.stg_finance_product_adjustment. Every event carries its OWN business date and never restates
the contract it acts on. Chargeback and cancellation timing is a SYNTHETIC configured distribution and
is never an observed loss rate. Never read by Power BI or Excel and explicitly revoked from
arpi_reporter.';

COMMENT ON COLUMN raw.finance_product_adjustment_load.raw_record_id IS 'Surrogate key of the landed row; also the deduplication tie-breaker and the newest-batch resolver.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.adjustment_id IS 'Untyped source value. Natural key, FPA-########.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.product_sale_id IS 'Untyped source value. The contract this event acts on, FPS-########. An adjustment with no contract is a number with nothing to reduce.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.sale_id IS 'Untyped source value. The contract''s parent deal, denormalised for store-and-period reads.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.adjustment_date IS 'Untyped source value. THE EVENT''S OWN BUSINESS DATE. Never the deal date, and never restated into the original sale month.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.dealership_id IS 'Untyped source value. The store, carried from the contract.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.finance_manager_id IS 'Untyped source value. The manager credited on the ORIGINAL deal; empty where none was. Attribution follows the contract, not whoever processed the cancellation, which is not modelled.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.finance_product_id IS 'Untyped source value. The product, carried from the contract.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.product_category IS 'Untyped source value. The governed category, carried from the contract.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.adjustment_type IS 'Untyped source value. Cancellation, Chargeback, Reinstatement or Approved Adjustment.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.adjustment_amount IS 'Untyped source value. SIGNED, exact to the cent. POSITIVE REDUCES retained gross; negative restores it.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.adjustment_reason_category IS 'Untyped source value. A governed reason category belonging to the event''s type. Never free text.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.sequence_ordinal IS 'Untyped source value. 1-based position within the contract''s own event sequence, ordered by date. What makes "a reinstatement follows a reduction" checkable.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.load_batch_id IS 'UUID identifying one ingestion batch.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.finance_product_adjustment_load.ingested_at IS 'UTC instant the row was landed.';
