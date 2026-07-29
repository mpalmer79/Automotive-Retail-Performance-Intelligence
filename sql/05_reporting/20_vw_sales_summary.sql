-- =============================================================================
-- File:            sql/05_reporting/20_vw_sales_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed sales-volume aggregate at store and sale date, owning the SQL side of KPI-SLS-001..003 and the days-to-sale mean components.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per sale date on which at least one transaction was finalized.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-SLS-001  Retail units sold             retail_units_sold
--   KPI-SLS-002  New units sold                new_units_sold
--   KPI-SLS-003  Used units sold               used_units_sold
--   KPI-INV-007  Days to sale (mean components)
--                retail_days_in_inventory_total / retail_units_sold
--
-- WHAT THIS VIEW IS FOR
-- ---------------------
-- This is the governed SQL owner of the sales volume measures: the object a SQL or
-- Excel consumer reads, and the left-hand side of RECON-UNITS-001 and
-- RECON-REPORT-SALES. A Power BI semantic model should bind to
-- reporting.vw_vehicle_sales instead, because a row-grain fact recomputes under any
-- filter context while this aggregate is fixed at store and day.
--
-- THE UNIT IDENTITY
-- -----------------
-- retail_units_sold = new_units_sold + used_units_sold holds on every row, because
-- the new/used split is taken from the vehicle's condition rather than from
-- sale_type. That is RECON-UNITS-001, and it is asserted rather than assumed.
--
-- Every measure here is additive across store and date. No ratio is materialised
-- except average_days_to_sale, which is valid ONLY at this view's grain; recompute
-- it as SUM(numerator) / SUM(denominator) at any other level.

CREATE OR REPLACE VIEW reporting.vw_sales_summary AS
SELECT
    s.dealership_key                                         AS dealership_key,
    s.sale_date_key                                          AS sale_date_key,

    -- Additive volume measures.
    sum(s.unit_count)::bigint                                AS units_sold_all_types,
    sum(s.retail_unit_count)::bigint                         AS retail_units_sold,
    sum(s.new_unit_count)::bigint                            AS new_units_sold,
    sum(s.used_unit_count)::bigint                           AS used_units_sold,
    sum(s.wholesale_unit_count)::bigint                      AS wholesale_units,
    sum(s.dealer_trade_unit_count)::bigint                   AS dealer_trade_units,

    -- Additive value measures, retail only, carried so a volume report can show
    -- revenue beside units without a second query.
    sum(CASE WHEN s.is_retail THEN s.sale_price ELSE 0 END)  AS retail_sale_price_total,

    -- Days-to-sale mean components, kept as separate additive columns.
    sum(s.retail_days_in_inventory_total)::bigint            AS retail_days_in_inventory_total,
    sum(s.retail_days_in_inventory_total)::numeric
        / nullif(sum(s.retail_unit_count), 0)                AS average_days_to_sale
FROM reporting.vw_vehicle_sales AS s
GROUP BY s.dealership_key, s.sale_date_key;

COMMENT ON VIEW reporting.vw_sales_summary IS
    'Grain: one row per dealership per sale date on which at least one transaction was finalized. '
    'Governed SQL owner of KPI-SLS-001, KPI-SLS-002, KPI-SLS-003 and the KPI-INV-007 mean components, and '
    'the left-hand side of RECON-UNITS-001 and RECON-REPORT-SALES. A Power BI model should bind to '
    'reporting.vw_vehicle_sales rather than to this aggregate, because a row-grain fact recomputes under '
    'any filter context. retail_units_sold = new_units_sold + used_units_sold holds on every row: the '
    'new/used split comes from the vehicle condition, not from sale_type, so leases do not fall outside '
    'both halves of the identity. average_days_to_sale is valid at this view''s grain only -- recompute it '
    'as SUM(retail_days_in_inventory_total) / SUM(retail_units_sold) at any other level.';

COMMENT ON COLUMN reporting.vw_sales_summary.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_sales_summary.sale_date_key IS 'Sale date. The governed date basis for every measure in this view. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_sales_summary.units_sold_all_types IS 'Every finalized transaction, retail and non-retail. Never the headline volume figure.';
COMMENT ON COLUMN reporting.vw_sales_summary.retail_units_sold IS 'KPI-SLS-001. Retail and lease deliveries. Excludes wholesale and dealer trades. Returns 0, not NULL, in a period with no sales -- "no cars sold" is a meaningful answer.';
COMMENT ON COLUMN reporting.vw_sales_summary.new_units_sold IS 'KPI-SLS-002. Retail deliveries of new vehicles, leases of new vehicles included. Structurally 0 for an independent used store, which is correct rather than missing.';
COMMENT ON COLUMN reporting.vw_sales_summary.used_units_sold IS 'KPI-SLS-003. Retail deliveries of used and certified vehicles, leases of used vehicles included. Certified pre-owned units are used units.';
COMMENT ON COLUMN reporting.vw_sales_summary.wholesale_units IS 'Wholesale disposals. A different measure with a different meaning; never folded into retail volume.';
COMMENT ON COLUMN reporting.vw_sales_summary.dealer_trade_units IS 'Dealer trades. Never folded into retail volume.';
COMMENT ON COLUMN reporting.vw_sales_summary.retail_sale_price_total IS 'Total retail selling price. Revenue, not gross: it contains the cost of the vehicle and must never be used as a profitability measure.';
COMMENT ON COLUMN reporting.vw_sales_summary.retail_days_in_inventory_total IS 'KPI-INV-007 mean numerator: total days in inventory across retail units sold.';
COMMENT ON COLUMN reporting.vw_sales_summary.average_days_to_sale IS 'KPI-INV-007 mean at this view''s grain. NULL when no retail unit sold. The median is the headline figure and lives in vw_days_to_sale; this mean describes only units that SOLD, so it carries survivorship bias and must be read with KPI-INV-004.';
