-- =============================================================================
-- File:            sql/04_facts/01_fact_vehicle_inventory_snapshot.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_vehicle_inventory_snapshot, the daily inventory periodic-snapshot fact.
-- Execution order: @@ORDER@@ — after every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per vehicle per dealership per snapshot date, while the vehicle is in stock.
-- =============================================================================
--
-- Column contract: ARPI Phase 1 cross-agent contract section 7 — 16 columns, exact
-- names, exact order, exact types. Mapping document:
-- docs/source-to-target/STM-009-fact-vehicle-inventory-snapshot.md.
--
-- STATUS
-- ------
-- The table exists and is constrained; **no row has ever been loaded into it.** The
-- generator (Agents E/F) and the load script arrive in a later Phase 1.2 increment.
--
-- THE GRAIN IS THE CONSTRAINT
-- ---------------------------
-- uq_fact_vehicle_inventory_snapshot_grain is not a performance index that happens
-- to be unique. It IS the declared grain: one row per vehicle per store per day. A
-- periodic snapshot that admits two rows for the same vehicle on the same day
-- double-counts inventory investment and halves nothing that would reveal it, so the
-- grain is enforced by the database rather than by the loader's good intentions.
--
-- WHAT A ROW MEANS, AND WHAT ITS ABSENCE MEANS
-- --------------------------------------------
--   * A row exists for a date only while the vehicle is genuinely in stock at that
--     store. There is no snapshot on or after the disposition date: a sold vehicle
--     stops appearing the day it is delivered, it does not appear with zeroed
--     measures. "No row" is the representation of "not in inventory".
--   * Historical snapshots are immutable. Yesterday's aged inventory is what it was;
--     a reload must reproduce it exactly, never restate it. The load script inserts
--     only dates it has not already written.
--
-- SEMI-ADDITIVE MEASURES — THE MOST COMMON WAY A DASHBOARD LIES
-- ------------------------------------------------------------
--   Semi-additive (additive across vehicle, store and model; NEVER across time):
--     inventory_unit_count, current_asking_price, acquisition_cost,
--     reconditioning_cost, inventory_investment. Summing inventory_investment across
--     30 days reports thirty times the money the group actually has on the ground.
--     Aggregate these with a last-non-empty or as-of-date rule, never with SUM over
--     a date range.
--   Non-additive: days_in_stock and markdown_count_to_date (average or take the
--     latest; a sum of ages is meaningless).
--
-- PRIVACY: contains no personal data of any kind.

CREATE TABLE IF NOT EXISTS warehouse.fact_vehicle_inventory_snapshot (
    inventory_snapshot_key  bigint         NOT NULL,
    snapshot_date_key       integer        NOT NULL,
    dealership_key          integer        NOT NULL,
    vehicle_key             integer        NOT NULL,
    vehicle_model_key       integer        NOT NULL,
    current_asking_price    numeric(12,2)  NOT NULL,
    original_asking_price   numeric(12,2)  NOT NULL,
    msrp                    numeric(12,2)  NULL,
    acquisition_cost        numeric(12,2)  NOT NULL,
    reconditioning_cost     numeric(12,2)  NOT NULL,
    inventory_investment    numeric(12,2)  NOT NULL,
    days_in_stock           integer        NOT NULL,
    age_bucket              varchar(16)    NOT NULL,
    markdown_count_to_date  smallint       NOT NULL,
    inventory_unit_count    smallint       NOT NULL,
    source_system           varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_vehicle_inventory_snapshot
        PRIMARY KEY (inventory_snapshot_key),
    -- THE declared grain, enforced.
    CONSTRAINT uq_fact_vehicle_inventory_snapshot_grain
        UNIQUE (snapshot_date_key, dealership_key, vehicle_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_key_positive
        CHECK (inventory_snapshot_key > 0),
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_days_in_stock_nonnegative
        CHECK (days_in_stock >= 0),
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_age_bucket_domain
        CHECK (age_bucket IN ('0-30', '31-60', '61-90', '91-120', 'Over 120')),
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_markdown_count_nonnegative
        CHECK (markdown_count_to_date >= 0),
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_unit_count_is_one
        CHECK (inventory_unit_count = 1),
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- The stored investment identity, enforced rather than merely documented.
    CONSTRAINT ck_fact_vehicle_inventory_snapshot_investment_identity
        CHECK (inventory_investment = acquisition_cost + reconditioning_cost)
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_inventory_snapshot_date',       'snapshot_date_key', 'dim_date',          'date_key'),
            ('fk_fact_inventory_snapshot_dealership', 'dealership_key',    'dim_dealership',    'dealership_key'),
            ('fk_fact_inventory_snapshot_vehicle',    'vehicle_key',       'dim_vehicle',       'vehicle_key'),
            ('fk_fact_inventory_snapshot_model',      'vehicle_model_key', 'dim_vehicle_model', 'vehicle_model_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_vehicle_inventory_snapshot ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_vehicle_inventory_snapshot IS
    'Grain: one row per vehicle per dealership per snapshot date, and only while the vehicle is actually in '
    'stock. Periodic snapshot fact. No snapshot exists on or after the disposition date, so the absence of a '
    'row is how "not in inventory" is represented. Historical snapshots are immutable. Every money measure is '
    'SEMI-ADDITIVE: never sum it across time. Currently EMPTY: the generator and load script arrive in a '
    'later Phase 1.2 increment.';

COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.inventory_snapshot_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by (snapshot_date_key, dealership_key, vehicle_key).';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.snapshot_date_key IS 'Foreign key to warehouse.dim_date: the as-of date of the snapshot. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store holding the vehicle. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.vehicle_key IS 'Foreign key to warehouse.dim_vehicle: the vehicle in stock. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.vehicle_model_key IS 'Foreign key to warehouse.dim_vehicle_model. Denormalised onto the fact so model-level inventory reports need no second join through dim_vehicle.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.current_asking_price IS 'Advertised asking price on the snapshot date. SEMI-ADDITIVE: never sum across dates.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.original_asking_price IS 'First advertised asking price, carried on every snapshot so markdown depth needs no self-join. Non-additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.msrp IS 'Manufacturer suggested retail price. NULL means the vehicle has no MSRP, typically a used unit. Non-additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.acquisition_cost IS 'What the store paid for the vehicle. SEMI-ADDITIVE: never sum across dates.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.reconditioning_cost IS 'Reconditioning spend to date. SEMI-ADDITIVE: never sum across dates.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.inventory_investment IS 'acquisition_cost + reconditioning_cost, enforced by ck_fact_vehicle_inventory_snapshot_investment_identity. SEMI-ADDITIVE: summing it across a date range reports the money many times over.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.days_in_stock IS 'Days since acquisition as at the snapshot date. NON-ADDITIVE: average it, never sum it.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.age_bucket IS '0-30 | 31-60 | 61-90 | 91-120 | Over 120. Banded days_in_stock, stored so every aging report bands identically.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.markdown_count_to_date IS 'Number of price reductions taken to date. NON-ADDITIVE across time: take the latest, do not sum.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count IS 'Always 1. SEMI-ADDITIVE: sum it across vehicles on one date to get units in stock; summing across dates counts the same car repeatedly.';
COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
