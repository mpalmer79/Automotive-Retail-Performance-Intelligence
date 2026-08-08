-- =============================================================================
-- File:            sql/01_raw/09_raw_sale_event_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for sale_event.csv (contract section 8): fact_vehicle_sale in natural-key form. All business columns are text so ingestion never fails on a bad value.
-- Execution order: 13 of 66 — after the audit tables, before staging.stg_sale_event reads it.
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
-- governed type is dropped by staging.stg_sale_event and reported through
-- staging.stg_sale_event_rejected, not lost silently.
--
-- Cancelled deals never appear in this file: only finalized transactions are
-- emitted. Manufacturer incentives are excluded from every gross measure and that
-- exclusion is documented in docs/source-to-target/STM-008-fact-vehicle-sale.md.

CREATE TABLE IF NOT EXISTS raw.sale_event_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    sale_id                    text         NULL,
    sale_date                  text         NULL,
    delivery_date              text         NULL,
    dealership_id              text         NULL,
    vehicle_id                 text         NULL,
    customer_id                text         NULL,
    salesperson_id             text         NULL,
    desk_manager_id            text         NULL,
    finance_manager_id         text         NULL,
    lead_source_id             text         NULL,
    sale_type                  text         NULL,
    is_retail                  text         NULL,
    unit_count                 text         NULL,
    sale_price                 text         NULL,
    msrp                       text         NULL,
    original_asking_price      text         NULL,
    final_asking_price         text         NULL,
    acquisition_cost           text         NULL,
    reconditioning_cost        text         NULL,
    pack_amount                text         NULL,
    front_end_gross            text         NULL,
    back_end_gross             text         NULL,
    total_gross                text         NULL,
    trade_allowance            text         NULL,
    trade_acv                  text         NULL,
    cash_down                  text         NULL,
    amount_financed            text         NULL,
    finance_reserve_gross      text         NULL,
    lender_id                  text         NULL,
    days_in_inventory_at_sale  text         NULL,
    source_system              text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_sale_event_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_sale_event_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read
-- only that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_sale_event_load_load_batch_id
    ON raw.sale_event_load (load_batch_id);

COMMENT ON TABLE raw.sale_event_load IS
    'Grain: one row per data row of a sale_event.csv file within one load batch. Raw landing 
table; business columns are untyped text and are cast in staging.stg_sale_event. Never read by 
Power BI or Excel and explicitly revoked from arpi_reporter.';

COMMENT ON COLUMN raw.sale_event_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.sale_event_load.sale_id IS 'Untyped source value. Natural key, SLE-######## (contract section 5).';
COMMENT ON COLUMN raw.sale_event_load.sale_date IS 'Untyped source value. Date the deal was finalized.';
COMMENT ON COLUMN raw.sale_event_load.delivery_date IS 'Untyped source value. Date the vehicle was delivered; never before sale_date.';
COMMENT ON COLUMN raw.sale_event_load.dealership_id IS 'Untyped source value. Selling store.';
COMMENT ON COLUMN raw.sale_event_load.vehicle_id IS 'Untyped source value. Vehicle sold.';
COMMENT ON COLUMN raw.sale_event_load.customer_id IS 'Untyped source value. Buying customer; NULL only for non-retail deals (wholesale, dealer trade).';
COMMENT ON COLUMN raw.sale_event_load.salesperson_id IS 'Untyped source value. Selling salesperson; NULL when the deal had none.';
COMMENT ON COLUMN raw.sale_event_load.desk_manager_id IS 'Untyped source value. Desk manager who structured the deal; NULL when none.';
COMMENT ON COLUMN raw.sale_event_load.finance_manager_id IS 'Untyped source value. Finance manager who delivered the back end; NULL when none.';
COMMENT ON COLUMN raw.sale_event_load.lead_source_id IS 'Untyped source value. Attributed lead source; populated in P1.4.';
COMMENT ON COLUMN raw.sale_event_load.sale_type IS 'Untyped source value. Deal type; determines is_retail.';
COMMENT ON COLUMN raw.sale_event_load.is_retail IS 'Untyped source value. Derived from sale_type, never random.';
COMMENT ON COLUMN raw.sale_event_load.unit_count IS 'Untyped source value. Always exactly 1; the additive unit measure.';
COMMENT ON COLUMN raw.sale_event_load.sale_price IS 'Untyped source value. Selling price of the vehicle.';
COMMENT ON COLUMN raw.sale_event_load.msrp IS 'Untyped source value. Manufacturer suggested retail price; NULL when the vehicle has none.';
COMMENT ON COLUMN raw.sale_event_load.original_asking_price IS 'Untyped source value. First advertised asking price.';
COMMENT ON COLUMN raw.sale_event_load.final_asking_price IS 'Untyped source value. Advertised asking price at the time of sale.';
COMMENT ON COLUMN raw.sale_event_load.acquisition_cost IS 'Untyped source value. What the store paid for the vehicle.';
COMMENT ON COLUMN raw.sale_event_load.reconditioning_cost IS 'Untyped source value. Reconditioning spend on the vehicle.';
COMMENT ON COLUMN raw.sale_event_load.pack_amount IS 'Untyped source value. Internal pack withheld from front-end gross.';
COMMENT ON COLUMN raw.sale_event_load.front_end_gross IS 'Untyped source value. sale_price - acquisition_cost - reconditioning_cost - pack_amount.';
COMMENT ON COLUMN raw.sale_event_load.back_end_gross IS 'Untyped source value. Finance and insurance gross on the deal.';
COMMENT ON COLUMN raw.sale_event_load.total_gross IS 'Untyped source value. front_end_gross + back_end_gross.';
COMMENT ON COLUMN raw.sale_event_load.trade_allowance IS 'Untyped source value. Allowance credited to the customer for a trade-in.';
COMMENT ON COLUMN raw.sale_event_load.trade_acv IS 'Untyped source value. Actual cash value the store assigned to the trade-in.';
COMMENT ON COLUMN raw.sale_event_load.cash_down IS 'Untyped source value. Cash the customer put down.';
COMMENT ON COLUMN raw.sale_event_load.amount_financed IS 'Untyped source value. Amount financed on the deal.';
COMMENT ON COLUMN raw.sale_event_load.finance_reserve_gross IS 'Untyped source value. The finance-office income earned on the financing itself, exact to the cent. 0.00 on every Cash, Lease, Wholesale and Dealer Trade deal by rule, and legitimately 0.00 on a Retail Finance deal that earned none. NEVER NULL: a null would make "no reserve" and "not modelled" indistinguishable. DASH.6.'
;
COMMENT ON COLUMN raw.sale_event_load.lender_id IS 'Untyped source value. The fictional lender behind the deal, LND-###; empty when NO LENDER EXISTS, which is what a cash deal and a disposal carry. Never means "lender unknown". No APR, rate, term or payment accompanies it: ARPI models none. DASH.6.'
;
COMMENT ON COLUMN raw.sale_event_load.days_in_inventory_at_sale IS 'Untyped source value. Days the vehicle had been in stock when it sold.';
COMMENT ON COLUMN raw.sale_event_load.source_system IS 'Untyped source value. Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN raw.sale_event_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.sale_event_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.sale_event_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.sale_event_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
