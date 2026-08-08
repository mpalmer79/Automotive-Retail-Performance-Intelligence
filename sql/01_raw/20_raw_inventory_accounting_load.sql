-- =============================================================================
-- File:            sql/01_raw/20_raw_inventory_accounting_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Landing table for inventory_accounting_snapshot.csv. All business columns are text so ingestion never fails on a bad value.
-- Execution order: After the audit tables, before staging.stg_inventory_accounting reads it.
-- Idempotency:     Fully idempotent DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Existing rows are never modified.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One row per source CSV data row per load batch (source_file_name + source_row_number within load_batch_id).
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-022-fact-inventory-accounting-snapshot.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. The stock-level accounting schedule: what each carried unit is
-- worth on the books at a month-end, and what is owed against it. It is a focused
-- inventory control schedule and NOT a general ledger -- there is no journal, no posting
-- and no financial statement anywhere in this project.
--
-- Book value is acquisition cost plus capitalized transportation, reconditioning,
-- accessories and other costs, less any write-down. Pack is deliberately absent: it is a
-- front-gross deduction, not a capitalized cost of the vehicle. Floorplan principal is
-- carried but is a LIABILITY and never enters book value.
--
-- Typing happens in staging, never here. A value that cannot be represented in the
-- governed type is dropped by staging.stg_inventory_accounting and reported through
-- staging.stg_inventory_accounting_rejected, not lost silently.
--
-- RAW IS NOT SKIPPED BECAUSE THE DATA IS SYNTHETIC. Every ARPI entity travels the same
-- four layers. An accounting schedule that entered the warehouse by a private door would
-- have no rejected-record path, no row-count chain and no lineage columns -- and the one
-- table a controller is asked to trust is the last one that should be exempt.

CREATE TABLE IF NOT EXISTS raw.inventory_accounting_load (
    raw_record_id       bigserial    NOT NULL,

    -- Business columns (contract order, all untyped text)
    inventory_accounting_id      text         NULL,
    dealership_id                text         NULL,
    vehicle_id                   text         NULL,
    accounting_date              text         NULL,
    acquisition_date             text         NULL,
    control_account_category     text         NULL,
    acquisition_cost             text         NULL,
    capitalized_transportation   text         NULL,
    capitalized_reconditioning   text         NULL,
    capitalized_accessories      text         NULL,
    other_capitalized_costs      text         NULL,
    write_down_amount            text         NULL,
    current_book_value           text         NULL,
    floorplan_principal          text         NULL,
    days_in_stock                text         NULL,
    source_system                text         NULL,

    -- Load metadata
    load_batch_id       uuid         NOT NULL,
    source_file_name    text         NOT NULL,
    source_row_number   integer      NOT NULL,
    ingested_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_inventory_accounting_load
        PRIMARY KEY (raw_record_id),
    CONSTRAINT ck_inventory_accounting_load_source_row_number_positive
        CHECK (source_row_number > 0)
);

-- Batch lookup: the staging views resolve the newest load_batch_id and then read only
-- that batch, so every staging read filters on this column.
CREATE INDEX IF NOT EXISTS ix_inventory_accounting_load_load_batch_id
    ON raw.inventory_accounting_load (load_batch_id);

COMMENT ON TABLE raw.inventory_accounting_load IS
    'Grain: one row per data row of an inventory_accounting_snapshot.csv file within one load batch. Raw
landing table; business columns are untyped text and are cast in staging.stg_inventory_accounting.
Carries the synthetic stock-level accounting schedule for a fictional dealer group -- a focused
inventory control schedule, never a general ledger. Never read by Power BI or Excel and explicitly
revoked from arpi_reporter.';

COMMENT ON COLUMN raw.inventory_accounting_load.inventory_accounting_id IS 'Untyped source value. Natural key, IAS-########.';
COMMENT ON COLUMN raw.inventory_accounting_load.dealership_id IS 'Untyped source value. Store carrying the unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.vehicle_id IS 'Untyped source value. The carried unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.accounting_date IS 'Untyped source value. Month-end the position is stated as at.';
COMMENT ON COLUMN raw.inventory_accounting_load.acquisition_date IS 'Untyped source value. Date the store took the unit into stock. Drives the posting lag.';
COMMENT ON COLUMN raw.inventory_accounting_load.control_account_category IS 'Untyped source value. New, Used or Certified Vehicle Inventory.';
COMMENT ON COLUMN raw.inventory_accounting_load.acquisition_cost IS 'Untyped source value. What the store paid. Shared with the acquisition event, to the cent.';
COMMENT ON COLUMN raw.inventory_accounting_load.capitalized_transportation IS 'Untyped source value. Inbound freight capitalized into the unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.capitalized_reconditioning IS 'Untyped source value. Reconditioning capitalized into the unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.capitalized_accessories IS 'Untyped source value. Accessories fitted and capitalized.';
COMMENT ON COLUMN raw.inventory_accounting_load.other_capitalized_costs IS 'Untyped source value. Other capitalized cost; certification inspection on a certified unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.write_down_amount IS 'Untyped source value. Cumulative synthetic accounting write-down as at this date. Never a market-value estimate.';
COMMENT ON COLUMN raw.inventory_accounting_load.current_book_value IS 'Untyped source value. The carrying value. Equals its components exactly.';
COMMENT ON COLUMN raw.inventory_accounting_load.floorplan_principal IS 'Untyped source value. Principal owed against the unit. A LIABILITY POSITION, never netted into book value. 0.00 is an owned, unfloored unit.';
COMMENT ON COLUMN raw.inventory_accounting_load.days_in_stock IS 'Untyped source value. Accounting date less acquisition date.';
COMMENT ON COLUMN raw.inventory_accounting_load.source_system IS 'Untyped source value. Originating system; constant SYNTHETIC-DMS-ACCOUNTING.';
COMMENT ON COLUMN raw.inventory_accounting_load.raw_record_id IS 'Surrogate key of the landed row; also the deterministic tie-breaker when deduplicating a natural key and when resolving the newest load batch.';
COMMENT ON COLUMN raw.inventory_accounting_load.load_batch_id IS 'UUID identifying one ingestion batch. Every row written by a single load shares this value.';
COMMENT ON COLUMN raw.inventory_accounting_load.source_file_name IS 'File name the row was read from, for lineage.';
COMMENT ON COLUMN raw.inventory_accounting_load.source_row_number IS 'One-based data-row number within the source file, excluding the header.';
COMMENT ON COLUMN raw.inventory_accounting_load.ingested_at IS 'UTC instant the row was landed. Used with raw_record_id to pick the newest batch deterministically.';
