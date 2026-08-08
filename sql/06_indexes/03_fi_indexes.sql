-- =============================================================================
-- File:            sql/06_indexes/03_fi_indexes.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Secondary indexes the F&I reporting views actually need.
-- Execution order: Index layer, after the F&I facts exist.
-- Idempotency:     Fully idempotent. CREATE INDEX IF NOT EXISTS only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           Not applicable.
-- =============================================================================
--
-- ONE INDEX PER QUERY THAT EXISTS TODAY, not per column that might one day be filtered.
-- Every entry below is justified by a read the reporting layer performs on every
-- refresh; nothing is here speculatively. The primary keys and the UNIQUE constraints on
-- the two facts already index their identities, so those are not repeated.

-- reporting.vw_fi_summary and reporting.vw_fi_product_penetration both group contracts
-- by store, sale date and finance manager. That triple is the leading edge of both.
CREATE INDEX IF NOT EXISTS ix_fact_fi_product_sale_store_date_manager
    ON warehouse.fact_finance_product_sale
       (dealership_key, sale_date_key, finance_manager_key);

-- RECON-FI-001 and RECON-FI-DEAL-LEVEL aggregate product gross per parent deal, and
-- reporting.vw_deal_product_detail joins back to the deal on every row.
CREATE INDEX IF NOT EXISTS ix_fact_fi_product_sale_sale_key
    ON warehouse.fact_finance_product_sale (sale_key);

-- The category slice of the penetration and mix measures resolves through the product.
CREATE INDEX IF NOT EXISTS ix_fact_fi_product_sale_product_key
    ON warehouse.fact_finance_product_sale (finance_product_key);

-- reporting.vw_fi_adjustment_summary groups on the ADJUSTMENT date -- a different basis
-- from every other F&I read, which is exactly why it needs its own index.
CREATE INDEX IF NOT EXISTS ix_fact_fi_adjustment_store_date_manager
    ON warehouse.fact_finance_product_adjustment
       (dealership_key, adjustment_date_key, finance_manager_key);

-- The as-of net gross of one contract is the sum of its own events. Every net-gross read
-- and every cap reconciliation walks a contract's events, so this is the hottest index in
-- the F&I lane.
CREATE INDEX IF NOT EXISTS ix_fact_fi_adjustment_product_sale_key
    ON warehouse.fact_finance_product_adjustment (product_sale_key, adjustment_date_key);

-- warehouse.fact_vehicle_sale gained lender_key in DASH.6; the lender mix reads it.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_sale_lender_key
    ON warehouse.fact_vehicle_sale (lender_key);
