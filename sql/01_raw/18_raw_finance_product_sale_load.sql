-- =============================================================================
-- File:            sql/01_raw/18_raw_finance_product_sale_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for finance_product_sale.csv (fact_finance_product_sale in natural-key form). All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_finance_product_sale reads it.
-- Idempotency:     Fully idempotent DDL. Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-019-fact-finance-product-sale.md.
-- Delivery increment: DASH.6.
--
-- WHAT THIS ENTITY IS. One row per finance product contract written on a finalized
-- vehicle transaction. It is what makes a deal's back-end gross explainable: before
-- DASH.6, ARPI knew the aggregate and nothing beneath it, and SQ-21 was recorded on the
-- stakeholder register as unanswerable for exactly that reason.
--
-- DEAL-DATE BASIS ONLY. A contract row records what was written on the day it was
-- written and is NEVER rewritten. A later cancellation or chargeback is a separate event
-- in raw.finance_product_adjustment_load.
--
-- NO RATE, PAYMENT OR CREDIT FIELD EXISTS HERE. contract_term_months is the term of the
-- PRODUCT CONTRACT -- how long the coverage lasts -- and is not a loan term.

CREATE TABLE IF NOT EXISTS raw.finance_product_sale_load (
    raw_record_id           bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    product_sale_id         text         NULL,
    sale_id                 text         NULL,
    sale_date               text         NULL,
    dealership_id           text         NULL,
    finance_manager_id      text         NULL,
    finance_product_id      text         NULL,
    lender_id               text         NULL,
    finance_structure       text         NULL,
    product_category        text         NULL,
    eligibility_rule_id     text         NULL,
    line_ordinal            text         NULL,
    product_sale_count      text         NULL,
    product_retail_price    text         NULL,
    product_dealer_cost     text         NULL,
    original_product_gross  text         NULL,
    contract_term_months    text         NULL,
    source_system           text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_finance_product_sale_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_finance_product_sale_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

CREATE INDEX IF NOT EXISTS ix_finance_product_sale_load_load_batch_id
    ON raw.finance_product_sale_load (load_batch_id);

COMMENT ON TABLE raw.finance_product_sale_load IS
    'Grain: one row per data row of a finance_product_sale.csv file within one load batch. Raw landing
table; business columns are untyped text and are cast in staging.stg_finance_product_sale. Carries
SYNTHETIC product prices for INVENTED products -- never a market price, never a recommended price and
never a real dealership''s F&I menu. Never read by Power BI or Excel and explicitly revoked from
arpi_reporter.';

COMMENT ON COLUMN raw.finance_product_sale_load.raw_record_id IS 'Surrogate key of the landed row; also the deduplication tie-breaker and the newest-batch resolver.';
COMMENT ON COLUMN raw.finance_product_sale_load.product_sale_id IS 'Untyped source value. Natural key, FPS-########. The stable business identifier an adjustment references.';
COMMENT ON COLUMN raw.finance_product_sale_load.sale_id IS 'Untyped source value. The parent finalized transaction, SLE-########.';
COMMENT ON COLUMN raw.finance_product_sale_load.sale_date IS 'Untyped source value. The parent deal''s date. THE ONLY DATE THIS ENTITY CARRIES.';
COMMENT ON COLUMN raw.finance_product_sale_load.dealership_id IS 'Untyped source value. Selling store, carried from the parent deal.';
COMMENT ON COLUMN raw.finance_product_sale_load.finance_manager_id IS 'Untyped source value. The F&I manager credited on the parent deal; empty when the deal was written with nobody on the desk, which is a modelled state and not a missing value.';
COMMENT ON COLUMN raw.finance_product_sale_load.finance_product_id IS 'Untyped source value. The catalogued product, FP-###.';
COMMENT ON COLUMN raw.finance_product_sale_load.lender_id IS 'Untyped source value. The parent deal''s fictional lender; empty when NO LENDER EXISTS (a cash deal borrows nothing). Never means "lender unknown".';
COMMENT ON COLUMN raw.finance_product_sale_load.finance_structure IS 'Untyped source value. Cash, Retail Finance or Lease, DERIVED from the parent deal''s sale type and financed amount.';
COMMENT ON COLUMN raw.finance_product_sale_load.product_category IS 'Untyped source value. One of the ten governed categories, denormalised from the catalogue.';
COMMENT ON COLUMN raw.finance_product_sale_load.eligibility_rule_id IS 'Untyped source value. The ELIG-* rule the parent deal satisfied for this category.';
COMMENT ON COLUMN raw.finance_product_sale_load.line_ordinal IS 'Untyped source value. 1-based position within the deal, in catalogue-category order.';
COMMENT ON COLUMN raw.finance_product_sale_load.product_sale_count IS 'Untyped source value. Always 1. A column rather than a count(*), so a contract count cannot be inflated by a join fan-out.';
COMMENT ON COLUMN raw.finance_product_sale_load.product_retail_price IS 'Untyped source value. SYNTHETIC price charged, exact to the cent. Never a market or recommended price.';
COMMENT ON COLUMN raw.finance_product_sale_load.product_dealer_cost IS 'Untyped source value. SYNTHETIC cost to the store, exact to the cent.';
COMMENT ON COLUMN raw.finance_product_sale_load.original_product_gross IS 'Untyped source value. retail price minus dealer cost, exact. THE DEAL-DATE PRODUCTION FIGURE; later adjustments never change it.';
COMMENT ON COLUMN raw.finance_product_sale_load.contract_term_months IS 'Untyped source value. The PRODUCT CONTRACT''s term in months. NOT a finance loan term: ARPI models none.';
COMMENT ON COLUMN raw.finance_product_sale_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN raw.finance_product_sale_load.load_batch_id IS 'UUID identifying one ingestion batch.';
COMMENT ON COLUMN raw.finance_product_sale_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.finance_product_sale_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.finance_product_sale_load.ingested_at IS 'UTC instant the row was landed.';
