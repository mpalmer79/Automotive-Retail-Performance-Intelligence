-- =============================================================================
-- File:            sql/05_reporting/40_vw_sales_gross_trend.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed sales-and-gross trend at store and sale date, publishing volume, gross, per-unit rates and their condition and sale-type components as additive columns.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per sale date on which at least one transaction was finalized.
-- =============================================================================
--
-- KPIs OWNED (jointly with vw_sales_summary and vw_gross_summary, at the same grain)
-- ---------------------------------------------------------------------------------
--   KPI-SLS-001  Retail units sold             retail_units_sold
--   KPI-SLS-002  New units sold                new_units_sold
--   KPI-SLS-003  Used units sold               used_units_sold
--   KPI-GRS-001  Front-end gross               front_end_gross
--   KPI-GRS-002  Back-end gross                back_end_gross
--   KPI-GRS-003  Total gross                   total_gross
--   KPI-GRS-004  Front gross per retail unit   front_end_gross / retail_units_sold
--   KPI-GRS-005  Back gross per retail unit    back_end_gross  / retail_units_sold
--   KPI-GRS-006  Total gross per retail unit   total_gross     / retail_units_sold
--
-- WHY THIS VIEW EXISTS BESIDE vw_sales_summary AND vw_gross_summary
-- -----------------------------------------------------------------
-- Those two views are the governed owners of volume and gross respectively, and
-- neither is changed by this increment. What neither publishes is the pair of things
-- the Sales and Gross page needs on one row: volume and gross together, and their
-- split by vehicle condition and by sale type.
--
-- The alternative was to join the two views in the console and add the breakdown
-- there. That would have put a join and a set of CASE expressions in TypeScript,
-- which is precisely the second arithmetic engine ADR-0013 condition 2 forbids. A
-- third governed view at the SAME grain, reading the SAME row-grain fact view, costs
-- one file and keeps every figure a plain SUM of an exported column.
--
-- The overlap is deliberate and is not duplication of arithmetic: all three views
-- read reporting.vw_vehicle_sales and sum its pre-filtered additive columns, so
-- front_end_gross here is the same expression, over the same rows, as
-- vw_gross_summary.front_end_gross. The integration suite asserts the two agree on
-- every store-day rather than trusting that they do.
--
-- GRAIN INFLATION IS AVOIDED BY COLUMNS, NOT BY ROWS
-- --------------------------------------------------
-- The obvious way to add a condition or sale-type breakdown is to put those
-- attributes in the GROUP BY. That would multiply the row count, change the grain,
-- and make every existing store-day consumer wrong the moment it forgot to
-- re-aggregate -- the exact failure the repository calls grain inflation.
--
-- Instead every breakdown is published as its own additive column that is ZERO on a
-- row the measure excludes, the same technique vw_vehicle_sales uses for its
-- retail_* columns. new_front_end_gross + used_front_end_gross = front_end_gross on
-- every row, by construction, and the grain stays exactly one row per store per sale
-- date. A consumer that wants new-vehicle gross sums one column; it never re-filters.
--
-- WHY NOT A LEAD-SOURCE BREAKDOWN
-- -------------------------------
-- Lead source is not a component of this grain. Adding it as columns would need one
-- pair of columns per source (nineteen in the development profile) and would break
-- the moment a source was added; adding it to the GROUP BY would inflate the grain.
-- Lead-source mix is therefore read from the deal-grain projection
-- reporting.vw_deal_explorer, which carries the attribute at the grain that owns it.
--
-- RATIOS ARE VALID AT THIS GRAIN ONLY
-- -----------------------------------
-- The three per-unit rates are materialised because a single store-day is a
-- legitimate place to read them. They are NOT re-aggregatable: averaging a month of
-- daily PVRs is not the month's PVR. Any consumer working at another grain must
-- recompute SUM(numerator) / SUM(denominator) from the additive columns, which is
-- why both are published. A zero denominator yields NULL, never zero -- per-unit
-- gross on a day with no retail units is undefined, and rendering $0.00 would be a
-- false statement about a real day.
--
-- DISCOUNT COMPONENTS
-- -------------------
-- Discount is published as additive numerators plus their own eligible-unit
-- denominators, never as an average. The MSRP denominator is separate and smaller:
-- a used unit legitimately has no MSRP, and dividing an MSRP discount by all retail
-- units would understate it by silently counting units the measure cannot apply to.
-- msrp_eligible_units is that measure's own denominator, and it is the column a
-- consumer must divide by.

CREATE OR REPLACE VIEW reporting.vw_sales_gross_trend AS
SELECT
    s.dealership_key                                          AS dealership_key,
    s.sale_date_key                                           AS sale_date_key,

    -- Additive volume measures -------------------------------------------------
    sum(s.unit_count)::bigint                                 AS units_sold_all_types,
    sum(s.retail_unit_count)::bigint                          AS retail_units_sold,
    sum(s.new_unit_count)::bigint                             AS new_units_sold,
    sum(s.used_unit_count)::bigint                            AS used_units_sold,
    sum(s.wholesale_unit_count)::bigint                       AS wholesale_units,
    sum(s.dealer_trade_unit_count)::bigint                    AS dealer_trade_units,
    count(*) FILTER (WHERE s.sale_type = 'Lease')::bigint     AS lease_units,
    count(*) FILTER (WHERE s.sale_type = 'Certified Retail')::bigint
                                                              AS certified_retail_units,

    -- Additive revenue ---------------------------------------------------------
    sum(CASE WHEN s.is_retail THEN s.sale_price ELSE 0 END)   AS retail_sale_price_total,

    -- Additive gross numerators, retail only -----------------------------------
    sum(s.retail_front_end_gross)                             AS front_end_gross,
    sum(s.retail_back_end_gross)                              AS back_end_gross,
    sum(s.retail_total_gross)                                 AS total_gross,

    -- The same three over every transaction, so a wholesale-inclusive figure is
    -- available as a separate, separately named measure rather than by relaxing a
    -- retail one.
    sum(s.front_end_gross)                                    AS front_end_gross_all_types,
    sum(s.back_end_gross)                                     AS back_end_gross_all_types,
    sum(s.total_gross)                                        AS total_gross_all_types,

    -- Condition components. Each is zero on an excluded row, so
    -- new_* + used_* = the retail total on every row, by construction.
    sum(CASE WHEN s.new_unit_count = 1 THEN s.front_end_gross ELSE 0 END)
                                                              AS new_front_end_gross,
    sum(CASE WHEN s.new_unit_count = 1 THEN s.back_end_gross ELSE 0 END)
                                                              AS new_back_end_gross,
    sum(CASE WHEN s.new_unit_count = 1 THEN s.total_gross ELSE 0 END)
                                                              AS new_total_gross,
    sum(CASE WHEN s.used_unit_count = 1 THEN s.front_end_gross ELSE 0 END)
                                                              AS used_front_end_gross,
    sum(CASE WHEN s.used_unit_count = 1 THEN s.back_end_gross ELSE 0 END)
                                                              AS used_back_end_gross,
    sum(CASE WHEN s.used_unit_count = 1 THEN s.total_gross ELSE 0 END)
                                                              AS used_total_gross,

    -- Ratios at THIS grain only. NULL, never zero, on an empty denominator.
    sum(s.retail_front_end_gross) / nullif(sum(s.retail_unit_count), 0)
                                                              AS front_gross_per_retail_unit,
    sum(s.retail_back_end_gross)  / nullif(sum(s.retail_unit_count), 0)
                                                              AS back_gross_per_retail_unit,
    sum(s.retail_total_gross)     / nullif(sum(s.retail_unit_count), 0)
                                                              AS total_gross_per_retail_unit,

    -- Deal-mix context. A negative-front deal is a real dealership outcome and must
    -- stay countable rather than being averaged away.
    count(*) FILTER (WHERE s.is_retail AND s.front_end_gross < 0)::bigint
                                                              AS negative_front_gross_units,

    -- Discount numerators, with their own denominators. Never an average.
    sum(CASE WHEN s.is_retail THEN s.original_asking_price - s.sale_price ELSE 0 END)
                                                              AS discount_from_original_total,
    sum(CASE WHEN s.is_retail THEN s.final_asking_price - s.sale_price ELSE 0 END)
                                                              AS discount_from_final_total,
    sum(CASE WHEN s.is_retail AND s.msrp IS NOT NULL
             THEN s.msrp - s.sale_price ELSE 0 END)           AS discount_from_msrp_total,
    count(*) FILTER (WHERE s.is_retail AND s.msrp IS NOT NULL)::bigint
                                                              AS msrp_eligible_units
FROM reporting.vw_vehicle_sales AS s
GROUP BY s.dealership_key, s.sale_date_key;

COMMENT ON VIEW reporting.vw_sales_gross_trend IS
    'Grain: one row per dealership per sale date on which at least one transaction was finalized. Date '
    'basis: sale date. Governed trend surface for the console''s Sales and Gross page, publishing volume '
    'and gross together with their condition and sale-type components. Exists beside vw_sales_summary and '
    'vw_gross_summary rather than replacing them: those own volume and gross separately and are unchanged, '
    'and joining them in the console would put a join and a set of CASE expressions in TypeScript, which '
    'ADR-0013 condition 2 forbids. All three read reporting.vw_vehicle_sales and sum the same pre-filtered '
    'additive columns, and the integration suite asserts this view agrees with both on every store-day. '
    'BREAKDOWNS ARE COLUMNS, NOT ROWS: every condition and sale-type component is an additive column that '
    'is zero on an excluded row, so new_* + used_* equals the retail total on every row and the grain is '
    'never inflated. Lead-source mix is deliberately absent -- it is not a component of this grain and is '
    'read from vw_deal_explorer, which carries it at the grain that owns it. The three per-unit rates are '
    'valid at THIS grain ONLY and are not re-aggregatable: recompute SUM(numerator) / SUM(denominator) at '
    'any other level, which is why both are published. A zero denominator yields NULL, never zero. '
    'Discount is published as numerators with their own denominators; msrp_eligible_units is the MSRP '
    'measure''s own denominator because a used unit legitimately has no MSRP. Export-eligible: yes, as '
    'dashboard dataset sales-gross-trend.';

COMMENT ON COLUMN reporting.vw_sales_gross_trend.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model. Resolved to the GSA-00# business code by the dashboard export.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.sale_date_key IS 'Date key of the sale date. The governed date basis for every measure on this row.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.units_sold_all_types IS 'Every finalized transaction on the day, retail and not. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.retail_units_sold IS 'KPI-SLS-001, and the shared denominator of KPI-GRS-004/005/006. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.new_units_sold IS 'KPI-SLS-002. Retail deliveries of new vehicles, leases included. Additive. new_units_sold + used_units_sold = retail_units_sold (RECON-UNITS-001).';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.used_units_sold IS 'KPI-SLS-003. Retail deliveries of used or certified vehicles, leases included. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.wholesale_units IS 'Wholesale disposals. Never part of a retail measure. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.dealer_trade_units IS 'Dealer trades. Never part of a retail measure. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.lease_units IS 'Transactions whose sale type is Lease. A lease is a retail unit and is already inside retail_units_sold; this column is the sale-type mix component, not an additional unit.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.certified_retail_units IS 'Transactions whose sale type is Certified Retail. Already inside retail_units_sold and inside used_units_sold; this column is the sale-type mix component, not an additional unit.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.retail_sale_price_total IS 'Sum of selling price over retail transactions. Additive revenue, carried so a volume report shows revenue without a second query.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.front_end_gross IS 'KPI-GRS-001. Retail-only front-end gross. Additive. May legitimately be negative.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.back_end_gross IS 'KPI-GRS-002. Retail-only finance-office gross. Additive. Aggregate until the F&I model itemizes it.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.total_gross IS 'KPI-GRS-003. front_end_gross + back_end_gross on every row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.front_end_gross_all_types IS 'Front-end gross over every transaction including wholesale and dealer trades. A separately named measure, never a relaxation of KPI-GRS-001.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.back_end_gross_all_types IS 'Back-end gross over every transaction including wholesale and dealer trades.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.total_gross_all_types IS 'Total gross over every transaction including wholesale and dealer trades.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.new_front_end_gross IS 'Front-end gross on retail deliveries of new vehicles. Zero on every other row, so new_front_end_gross + used_front_end_gross = front_end_gross. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.new_back_end_gross IS 'Back-end gross on retail deliveries of new vehicles. Zero on every other row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.new_total_gross IS 'Total gross on retail deliveries of new vehicles. Zero on every other row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.used_front_end_gross IS 'Front-end gross on retail deliveries of used or certified vehicles. Zero on every other row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.used_back_end_gross IS 'Back-end gross on retail deliveries of used or certified vehicles. Zero on every other row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.used_total_gross IS 'Total gross on retail deliveries of used or certified vehicles. Zero on every other row. Additive.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.front_gross_per_retail_unit IS 'KPI-GRS-004 at THIS grain only. NULL when no retail unit sold: per-unit gross is undefined on a day with no units, not zero. Not re-aggregatable -- recompute SUM(front_end_gross) / SUM(retail_units_sold) at any other level.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.back_gross_per_retail_unit IS 'KPI-GRS-005 at THIS grain only. NULL on a zero denominator. Not re-aggregatable.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.total_gross_per_retail_unit IS 'KPI-GRS-006 at THIS grain only. NULL on a zero denominator. Not re-aggregatable. Equals front_gross_per_retail_unit + back_gross_per_retail_unit wherever the denominator is non-zero, because all three share one denominator.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.negative_front_gross_units IS 'Retail transactions closed at a front-end loss. A real dealership outcome; published so it stays countable instead of disappearing into an average.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.discount_from_original_total IS 'Sum of original asking price less selling price over retail transactions. Additive numerator; its denominator is retail_units_sold. Negative on a unit that sold above its first advertised price.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.discount_from_final_total IS 'Sum of final asking price less selling price over retail transactions. Additive numerator; its denominator is retail_units_sold.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.discount_from_msrp_total IS 'Sum of MSRP less selling price over retail transactions that HAVE an MSRP. Additive numerator; its denominator is msrp_eligible_units, never retail_units_sold.';
COMMENT ON COLUMN reporting.vw_sales_gross_trend.msrp_eligible_units IS 'Retail transactions carrying an MSRP. The denominator of discount_from_msrp_total. Smaller than retail_units_sold because a used unit legitimately has none; dividing the MSRP discount by all retail units would understate it.';
