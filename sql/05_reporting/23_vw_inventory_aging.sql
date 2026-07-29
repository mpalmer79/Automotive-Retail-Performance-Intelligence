-- =============================================================================
-- File:            sql/05_reporting/23_vw_inventory_aging.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed inventory-age distribution at store, snapshot date, condition group and age bucket, so the aged tail is visible rather than summarised away.
-- Execution order: Reporting layer, after reporting.vw_inventory_snapshots exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per snapshot date per condition group per age bucket.
-- =============================================================================
--
-- KPIs SUPPORTED
-- --------------
--   KPI-INV-004  Median inventory age  bucket_median_days_in_stock, and the
--                distribution the median summarises
--   KPI-INV-005  Aged inventory count  (any threshold, by summing the buckets above it)
--   KPI-INV-006  Aged inventory percentage (units_in_bucket / units_on_lot)
--
-- WHY A DISTRIBUTION VIEW EXISTS AT ALL
-- -------------------------------------
-- A single age statistic cannot describe a right-skewed lot. The median says what
-- the typical unit looks like and is deliberately insensitive to the tail; the mean
-- is dominated by the tail. Neither shows the SHAPE, and the shape is what a used-car
-- manager acts on: twelve units over 120 days is a different problem from forty
-- units at 65 days, and both can produce the same median.
--
-- The buckets are the warehouse's own age_bucket values -- 0-30, 31-60, 61-90,
-- 91-120, Over 120 -- so the distribution here and the bucket on any individual
-- snapshot row can never disagree.
--
-- units_on_lot repeats the store-and-date total on every bucket row so that a share
-- can be computed without a self-join, and so the denominator is visibly identical
-- across buckets. bucket_share is valid at this view's grain only.

CREATE OR REPLACE VIEW reporting.vw_inventory_aging AS
SELECT
    i.dealership_key                                              AS dealership_key,
    i.snapshot_date_key                                           AS snapshot_date_key,
    i.condition_group                                             AS condition_group,
    i.age_bucket                                                  AS age_bucket,
    CASE i.age_bucket
        WHEN '0-30'     THEN 1
        WHEN '31-60'    THEN 2
        WHEN '61-90'    THEN 3
        WHEN '91-120'   THEN 4
        WHEN 'Over 120' THEN 5
    END                                                           AS age_bucket_sort_order,

    sum(i.inventory_unit_count)::bigint                           AS units_in_bucket,
    sum(i.inventory_investment)                                   AS investment_in_bucket,
    sum(i.days_in_stock)::bigint                                  AS days_in_stock_total,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY i.days_in_stock)  AS bucket_median_days_in_stock,
    min(i.days_in_stock)                                          AS bucket_min_days_in_stock,
    max(i.days_in_stock)                                          AS bucket_max_days_in_stock,

    -- Store-and-date denominator, repeated on every bucket row.
    sum(sum(i.inventory_unit_count)) OVER (
        PARTITION BY i.dealership_key, i.snapshot_date_key, i.condition_group
    )::bigint                                                     AS units_on_lot,
    sum(i.inventory_unit_count)::numeric
        / nullif(sum(sum(i.inventory_unit_count)) OVER (
              PARTITION BY i.dealership_key, i.snapshot_date_key, i.condition_group
          ), 0)                                                   AS bucket_share
FROM reporting.vw_inventory_snapshots AS i
GROUP BY i.dealership_key, i.snapshot_date_key, i.condition_group, i.age_bucket;

COMMENT ON VIEW reporting.vw_inventory_aging IS
    'Grain: one row per dealership per snapshot date per condition group per age bucket. The governed '
    'inventory-age distribution, published because no single statistic can describe a right-skewed lot: '
    'twelve units over 120 days and forty units at 65 days are different problems that can share a median. '
    'Buckets are the warehouse''s own age_bucket values, so this distribution and any individual snapshot '
    'row can never disagree. Supports KPI-INV-004, and KPI-INV-005 and KPI-INV-006 at any threshold that '
    'falls on a bucket boundary. units_in_bucket is SEMI-ADDITIVE across dates, exactly like '
    'KPI-INV-001. bucket_share is valid at this view''s grain only; recompute it from units in DAX. '
    'ARPI publishes no benchmark for a healthy age distribution -- this supports comparison across stores, '
    'models and time, not against the industry.';

COMMENT ON COLUMN reporting.vw_inventory_aging.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_inventory_aging.snapshot_date_key IS 'The single as-of date. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_inventory_aging.condition_group IS 'New or Used. Certified units are Used.';
COMMENT ON COLUMN reporting.vw_inventory_aging.age_bucket IS 'Age bucket: 0-30, 31-60, 61-90, 91-120 or Over 120 days.';
COMMENT ON COLUMN reporting.vw_inventory_aging.age_bucket_sort_order IS 'Sort key so age_bucket orders by age rather than alphabetically. Set this as the sort-by column for age_bucket in the semantic model.';
COMMENT ON COLUMN reporting.vw_inventory_aging.units_in_bucket IS 'Units in the bucket on the date. SEMI-ADDITIVE across dates.';
COMMENT ON COLUMN reporting.vw_inventory_aging.investment_in_bucket IS 'Capital committed to the units in the bucket. Cost invested, not market value.';
COMMENT ON COLUMN reporting.vw_inventory_aging.days_in_stock_total IS 'Additive age numerator within the bucket.';
COMMENT ON COLUMN reporting.vw_inventory_aging.bucket_median_days_in_stock IS 'Median age within the bucket. Not decomposable and not summable across buckets; the lot-level median lives in vw_inventory_health.';
COMMENT ON COLUMN reporting.vw_inventory_aging.bucket_min_days_in_stock IS 'Youngest unit in the bucket.';
COMMENT ON COLUMN reporting.vw_inventory_aging.bucket_max_days_in_stock IS 'Oldest unit in the bucket. On the Over 120 bucket this is the tail a median will never show.';
COMMENT ON COLUMN reporting.vw_inventory_aging.units_on_lot IS 'Total active units for the same store, date and condition group. Repeated on every bucket row so the share denominator is visibly identical across buckets. Equals KPI-INV-001.';
COMMENT ON COLUMN reporting.vw_inventory_aging.bucket_share IS 'units_in_bucket / units_on_lot as a fraction of 1, at this view''s grain only. NULL on an empty lot.';
