-- =============================================================================
-- File:            sql/06_indexes/04_accounting_indexes.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Secondary indexes the inventory accounting and GL control reads actually need.
-- Execution order: Index layer, after the two DASH.8 facts exist.
-- Idempotency:     Fully idempotent. CREATE INDEX IF NOT EXISTS only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           Not applicable.
-- =============================================================================
--
-- ONE INDEX PER QUERY THAT EXISTS TODAY, not per column that might one day be filtered.
-- Every entry below is justified by a read the reporting or validation layer performs on
-- every refresh. The primary keys and the UNIQUE grain constraints on both facts already
-- index their identities, and sql/04_facts/10_fact_gl_control_balance.sql already carries
-- its (balance date, store) index, so neither is repeated here.

-- reporting.vw_inventory_gl_reconciliation aggregates the schedule to (date, store,
-- account) on every read, and RECON-ACC-CATEGORY-TOTALS groups on the same triple. The
-- grain UNIQUE leads on (date, store, vehicle) and cannot serve an account-led grouping.
CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_date_store_account
    ON warehouse.fact_inventory_accounting_snapshot
       (accounting_date_key, dealership_key, gl_account_key);

-- KPI-ACC-011 partitions by vehicle to find each unit's FIRST schedule appearance, and
-- reporting.vw_inventory_accounting computes is_first_accounting_appearance as a window
-- over the same partition on every read.
CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_vehicle_date
    ON warehouse.fact_inventory_accounting_snapshot
       (vehicle_key, accounting_date_key);

-- The ACC-MISSING-BOOK-ROW and ACC-ORPHAN-BOOK-ROW branches of
-- reporting.vw_accounting_exceptions join the operational inventory snapshot to the
-- schedule on (date, store, vehicle) in both directions. The snapshot fact's own grain
-- constraint serves one side; this serves the other.
CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_store_vehicle
    ON warehouse.fact_inventory_accounting_snapshot
       (dealership_key, vehicle_key, accounting_date_key);

-- reporting.vw_inventory_gl_reconciliation joins the control side on the account, and
-- RECON-GLB-GRAIN groups on it. The (balance date, store) index on the fact leads on the
-- date and cannot serve an account-led read.
CREATE INDEX IF NOT EXISTS ix_fact_gl_control_balance_account_date
    ON warehouse.fact_gl_control_balance (gl_account_key, balance_date_key);
