-- =============================================================================
-- File:            sql/05_reporting/22_vw_inventory_health.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed inventory-health aggregate at store, snapshot date and condition group, owning the SQL side of KPI-INV-001..006.
-- Execution order: Reporting layer, after reporting.vw_inventory_snapshots exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per snapshot date per condition group (New / Used).
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-INV-001  Active inventory count       active_inventory_units      SEMI-ADDITIVE
--   KPI-INV-002  Inventory investment         inventory_investment        SEMI-ADDITIVE
--   KPI-INV-003  Average inventory age        days_in_stock_total / active_inventory_units
--   KPI-INV-004  Median inventory age         median_inventory_age
--   KPI-INV-005  Aged inventory count         aged_inventory_units
--   KPI-INV-006  Aged inventory percentage    aged_inventory_units / active_inventory_units
--
-- SEMI-ADDITIVITY
-- ---------------
-- active_inventory_units and inventory_investment are additive across store,
-- condition group, vehicle and model, and are NOT additive across dates. Every row
-- of this view is a single as-of date. Summing a month of rows produces unit-days,
-- which is a different quantity that looks like a plausible inventory count and is
-- wrong by roughly a factor of thirty.
--
-- MEAN AND MEDIAN TOGETHER
-- ------------------------
-- Inventory age is right-skewed, so the MEDIAN is the headline and the mean is the
-- companion. The gap between them is itself the diagnostic: a mean well above the
-- median is direct evidence of an aged tail, which is what aged_inventory_units and
-- the aged percentage then quantify. Both are published on every row so neither can
-- be reported alone. The median cannot be recomputed from this aggregate at any
-- other grain -- for that, use row-level days_in_stock on
-- reporting.vw_inventory_snapshots.
--
-- THE THRESHOLD IS A CONVENTION
-- -----------------------------
-- aged_inventory_units uses 60 days, the ARPI project default from
-- ARCHITECTURE.md section 18.2. It is NOT an industry benchmark. Operators use 30,
-- 45, 60 or 90 days and the right threshold varies by vehicle class and market, so
-- any finding that depends on it must state it in the same sentence.
--
-- WHAT THIS IS NOT
-- ----------------
-- inventory_investment is cost invested. It is not market value and it is not
-- floor-plan exposure: ARPI models no floor-plan interest, no holding cost and no
-- carrying cost. "What aged inventory is costing us per day" is not supportable
-- from this data. The honest statement is how much capital is committed.

CREATE OR REPLACE VIEW reporting.vw_inventory_health AS
SELECT
    i.dealership_key                                             AS dealership_key,
    i.snapshot_date_key                                          AS snapshot_date_key,
    i.condition_group                                            AS condition_group,

    -- Semi-additive stock measures.
    sum(i.inventory_unit_count)::bigint                          AS active_inventory_units,
    sum(i.inventory_investment)                                  AS inventory_investment,

    -- Age numerator and denominator, kept separate.
    sum(i.days_in_stock)::bigint                                 AS days_in_stock_total,
    sum(i.days_in_stock)::numeric
        / nullif(sum(i.inventory_unit_count), 0)                 AS average_inventory_age,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY i.days_in_stock) AS median_inventory_age,

    -- Aged tail at the ARPI default 60-day threshold.
    sum(i.aged_unit_count)::bigint                               AS aged_inventory_units,
    sum(i.aged_inventory_investment)                             AS aged_inventory_investment,
    sum(i.aged_unit_count)::numeric
        / nullif(sum(i.inventory_unit_count), 0)                 AS aged_inventory_percentage,

    60::integer                                                  AS aged_threshold_days,
    max(i.days_in_stock)                                         AS oldest_unit_days_in_stock
FROM reporting.vw_inventory_snapshots AS i
GROUP BY i.dealership_key, i.snapshot_date_key, i.condition_group;

COMMENT ON VIEW reporting.vw_inventory_health IS
    'Grain: one row per dealership per snapshot date per condition group (New / Used). Governed SQL owner '
    'of KPI-INV-001..006 and the left-hand side of RECON-INV-001. SEMI-ADDITIVE: active_inventory_units '
    'and inventory_investment are additive across store, condition group, vehicle and model but NOT across '
    'dates -- every row is a single as-of date and summing a month of them yields unit-days. Mean and '
    'median inventory age are both published on every row so neither can be reported alone; the median is '
    'the headline because the distribution is right-skewed, and the mean-minus-median gap is itself '
    'evidence of an aged tail. The median cannot be recomputed from this aggregate at another grain -- use '
    'row-level days_in_stock on reporting.vw_inventory_snapshots. The 60-day aged threshold is the ARPI '
    'project default from ARCHITECTURE.md section 18.2 and is NOT an industry benchmark. '
    'inventory_investment is cost invested, not market value and not floor-plan exposure; ARPI models no '
    'floor-plan interest or carrying cost.';

COMMENT ON COLUMN reporting.vw_inventory_health.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_inventory_health.snapshot_date_key IS 'The single as-of date. Relationship column into vw_calendar. Every measure in this view is evaluated at one date.';
COMMENT ON COLUMN reporting.vw_inventory_health.condition_group IS 'New or Used. New and used inventory age and turn differently and are reported separately by default.';
COMMENT ON COLUMN reporting.vw_inventory_health.active_inventory_units IS 'KPI-INV-001. Units physically in stock on the date. SEMI-ADDITIVE across dates. Absence of a row means no snapshot exists for that date, which is missing data rather than an empty lot.';
COMMENT ON COLUMN reporting.vw_inventory_health.inventory_investment IS 'KPI-INV-002. Acquisition plus reconditioning cost of the units in stock. SEMI-ADDITIVE across dates. Cost invested, not market value and not floor-plan exposure.';
COMMENT ON COLUMN reporting.vw_inventory_health.days_in_stock_total IS 'KPI-INV-003 numerator: total days in stock across the active lot.';
COMMENT ON COLUMN reporting.vw_inventory_health.average_inventory_age IS 'KPI-INV-003 at this view''s grain. NULL on an empty lot -- an empty lot has no average age, it does not have an average age of zero. The wrong headline for a right-skewed distribution; use the median.';
COMMENT ON COLUMN reporting.vw_inventory_health.median_inventory_age IS 'KPI-INV-004, the headline inventory-age figure. Linear-interpolated PERCENTILE_CONT, fixed so SQL and DAX agree. Not decomposable: the median of a group is not derivable from the medians of its subgroups.';
COMMENT ON COLUMN reporting.vw_inventory_health.aged_inventory_units IS 'KPI-INV-005 at the default 60-day threshold. Can never exceed active_inventory_units. Returns 0, which is a genuine and good business answer, when no unit is aged.';
COMMENT ON COLUMN reporting.vw_inventory_health.aged_inventory_investment IS 'Capital committed to units past the threshold. The dollar figure is what turns an aging count into a management priority.';
COMMENT ON COLUMN reporting.vw_inventory_health.aged_inventory_percentage IS 'KPI-INV-006 at this view''s grain, expressed as a fraction of 1. NULL on an empty lot. This ratio can improve for a bad reason: wholesaling aged units removes them from the numerator, so read it beside inventory_investment and wholesale volume.';
COMMENT ON COLUMN reporting.vw_inventory_health.aged_threshold_days IS 'The threshold applied to aged_inventory_units, published on every row so a finding can state it. 60 days is the ARPI default from ARCHITECTURE.md section 18.2, not an industry benchmark.';
COMMENT ON COLUMN reporting.vw_inventory_health.oldest_unit_days_in_stock IS 'Age of the oldest unit on the lot. The tail the median is deliberately insensitive to.';
