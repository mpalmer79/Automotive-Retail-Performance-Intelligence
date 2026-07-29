-- =============================================================================
-- File:            sql/05_reporting/24_vw_days_to_sale.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed days-to-sale distribution at store, sale month and condition group, publishing median and mean together as KPI-INV-007 requires.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per sale month per condition group (New / Used).
-- =============================================================================
--
-- KPI OWNED
-- ---------
--   KPI-INV-007  Days to sale
--                median (headline)  median_days_to_sale
--                mean   (companion) days_in_inventory_total / retail_units_sold
--
-- WHY MONTH GRAIN
-- ---------------
-- A median over one store-day is typically an order statistic of two or three
-- values, which is noise rather than a measure. Month is the finest grain at which
-- this distribution says anything, and it is the grain the catalogue's aggregation
-- rule describes. Day-level values are still available: the row-level population is
-- reporting.vw_vehicle_sales.retail_days_in_inventory, and a semantic model should
-- compute MEDIAN over that column so it recomputes under any filter context.
--
-- WHY NEW AND USED ARE SEPARATE
-- -----------------------------
-- Their distributions differ materially. A blended figure describes neither, and
-- docs/research.md section 4.4 requires the new-versus-used treatment to be stated.
--
-- SURVIVORSHIP BIAS IS THE DOMINANT CAUTION
-- -----------------------------------------
-- This measure describes only units that SOLD. A lot full of 300-day units that
-- never sell can show an excellent days-to-sale figure, because those units never
-- enter the population at all. Days to sale must always be read with KPI-INV-004
-- (the age of what is still there) and KPI-INV-006. Wholesale disposals and dealer
-- trades are excluded, because their timing reflects a disposal decision rather
-- than retail demand.
--
-- Units are attributed to the period in which they SOLD, not the period in which
-- they were acquired: a unit acquired in January and sold in April counts entirely
-- in April.

CREATE OR REPLACE VIEW reporting.vw_days_to_sale AS
SELECT
    s.dealership_key                                                     AS dealership_key,
    d.month_start_date_key                                               AS sale_month_date_key,
    s.condition_group                                                    AS condition_group,

    -- Additive mean components.
    sum(s.retail_unit_count)::bigint                                     AS retail_units_sold,
    sum(s.retail_days_in_inventory_total)::bigint                        AS days_in_inventory_total,
    sum(s.retail_days_in_inventory_total)::numeric
        / nullif(sum(s.retail_unit_count), 0)                            AS mean_days_to_sale,

    -- Order statistics over the retail population only. retail_days_in_inventory is
    -- NULL on a non-retail row, so those rows are excluded from the percentile
    -- rather than pulling it towards zero.
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY s.retail_days_in_inventory)
                                                                         AS median_days_to_sale,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY s.retail_days_in_inventory)
                                                                         AS p25_days_to_sale,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY s.retail_days_in_inventory)
                                                                         AS p75_days_to_sale,
    max(s.retail_days_in_inventory)                                      AS max_days_to_sale
FROM reporting.vw_vehicle_sales AS s
JOIN (
        SELECT
            c.date_key                                                   AS date_key,
            (extract(year FROM c.month_start_date)::integer * 10000)
              + (extract(month FROM c.month_start_date)::integer * 100)
              +  extract(day FROM c.month_start_date)::integer           AS month_start_date_key
        FROM reporting.vw_calendar AS c
     ) AS d
       ON d.date_key = s.sale_date_key
WHERE s.is_retail
GROUP BY s.dealership_key, d.month_start_date_key, s.condition_group;

COMMENT ON VIEW reporting.vw_days_to_sale IS
    'Grain: one row per dealership per sale month per condition group (New / Used). Governed SQL owner of '
    'KPI-INV-007, publishing the median (headline) and the mean (companion) together so neither can be '
    'reported alone -- a chart titled only "days to sale" is not acceptable. Month is the finest grain at '
    'which the median says anything; for any other grain use MEDIAN over row-level '
    'reporting.vw_vehicle_sales.retail_days_in_inventory. New and used are separated because their '
    'distributions differ materially. Retail only: wholesale disposals and dealer trades reflect a '
    'disposal decision, not retail demand. SURVIVORSHIP BIAS is the dominant caution -- this describes '
    'only units that sold, so a lot full of unsellable 300-day units can still show an excellent figure. '
    'Always read with KPI-INV-004 and KPI-INV-006. Units are attributed to the month they SOLD in, not '
    'the month they were acquired. sale_month_date_key joins to vw_calendar on the first day of the month.';

COMMENT ON COLUMN reporting.vw_days_to_sale.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_days_to_sale.sale_month_date_key IS 'First day of the sale month, as a YYYYMMDD key. Relationship column into vw_calendar. The date basis is the sale, not the acquisition.';
COMMENT ON COLUMN reporting.vw_days_to_sale.condition_group IS 'New or Used. Certified units are Used. Never blend the two: their distributions differ materially.';
COMMENT ON COLUMN reporting.vw_days_to_sale.retail_units_sold IS 'The mean denominator, and the size of the population the median is taken over. Must match KPI-SLS-001 in the same context (RECON-UNITS-001).';
COMMENT ON COLUMN reporting.vw_days_to_sale.days_in_inventory_total IS 'The mean numerator: total days in inventory across the retail units that sold.';
COMMENT ON COLUMN reporting.vw_days_to_sale.mean_days_to_sale IS 'KPI-INV-007 mean at this view''s grain. NULL when no retail unit sold. Published to one decimal; label it explicitly as the mean.';
COMMENT ON COLUMN reporting.vw_days_to_sale.median_days_to_sale IS 'KPI-INV-007 median, the headline figure. Linear-interpolated PERCENTILE_CONT, fixed so SQL and DAX agree. NULL when no retail unit sold. Not decomposable across grains.';
COMMENT ON COLUMN reporting.vw_days_to_sale.p25_days_to_sale IS 'Lower quartile of days to sale. Published so the spread, not just the centre, is visible.';
COMMENT ON COLUMN reporting.vw_days_to_sale.p75_days_to_sale IS 'Upper quartile of days to sale.';
COMMENT ON COLUMN reporting.vw_days_to_sale.max_days_to_sale IS 'Slowest retail unit sold in the period.';
