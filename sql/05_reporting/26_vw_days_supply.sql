-- =============================================================================
-- File:            sql/05_reporting/26_vw_days_supply.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed dealer days-supply aggregate at store, as-of date and condition group, returning NULL rather than infinity when the selling pace is zero.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales and reporting.vw_inventory_snapshots exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per snapshot (as-of) date per condition group (New / Used).
-- =============================================================================
--
-- KPI OWNED
-- ---------
--   KPI-INV-009  Dealer days supply
--                active_inventory_units / average_daily_retail_sales
--
-- ARPI'S METHOD
-- -------------
--   * numerator: active units at the SINGLE as-of date
--   * denominator: retail units sold over the trailing 30 CALENDAR days ending on
--     the as-of date, divided by 30
--   * 30 days is the ARPI project default from ARCHITECTURE.md section 18.2. It is
--     NOT an industry benchmark and is published on every row so a finding can
--     state it.
--   * calendar days, not selling days -- the alternative is defensible but produces
--     different numbers, so the choice is fixed here
--   * retail only; wholesale and dealer trades are excluded from the denominator
--   * new and used reported separately
--   * no rolling average
--
-- ZERO PACE RETURNS NULL
-- ----------------------
-- Days supply is genuinely UNDEFINED when the trailing window contains no retail
-- sales. It is not infinite and it is not 9999. Rendering either on an executive
-- card would be worse than rendering nothing, so the measure is NULL and the visual
-- must say "insufficient sales history".
--
-- SENSITIVITY
-- -----------
-- Days supply is extremely sensitive to the trailing window and to seasonality: a
-- 30-day window ending in a slow month makes a normal lot look overstocked. ARPI
-- publishes no target days supply, because it has no benchmark data.

CREATE OR REPLACE VIEW reporting.vw_days_supply AS
WITH as_of AS (
    SELECT
        i.dealership_key                                          AS dealership_key,
        i.snapshot_date_key                                       AS snapshot_date_key,
        c.calendar_date                                           AS as_of_date,
        i.condition_group                                         AS condition_group,
        sum(i.inventory_unit_count)::bigint                       AS active_inventory_units
    FROM reporting.vw_inventory_snapshots AS i
    JOIN reporting.vw_calendar AS c ON c.date_key = i.snapshot_date_key
    GROUP BY i.dealership_key, i.snapshot_date_key, c.calendar_date, i.condition_group
),
retail_sales AS (
    SELECT
        s.dealership_key                                          AS dealership_key,
        c.calendar_date                                           AS sale_date,
        s.condition_group                                         AS condition_group,
        sum(s.retail_unit_count)::bigint                           AS retail_units_sold
    FROM reporting.vw_vehicle_sales AS s
    JOIN reporting.vw_calendar AS c ON c.date_key = s.sale_date_key
    WHERE s.is_retail
    GROUP BY s.dealership_key, c.calendar_date, s.condition_group
)
SELECT
    a.dealership_key                                              AS dealership_key,
    a.snapshot_date_key                                           AS as_of_date_key,
    a.condition_group                                             AS condition_group,

    a.active_inventory_units                                      AS active_inventory_units,
    30::integer                                                   AS trailing_days,
    coalesce(t.trailing_retail_units, 0)                          AS trailing_retail_units,
    coalesce(t.trailing_retail_units, 0)::numeric / 30.0          AS average_daily_retail_sales,
    a.active_inventory_units::numeric
        / nullif(coalesce(t.trailing_retail_units, 0)::numeric / 30.0, 0)
                                                                  AS days_supply
FROM as_of AS a
LEFT JOIN LATERAL (
        SELECT sum(r.retail_units_sold)::bigint                   AS trailing_retail_units
        FROM retail_sales AS r
        WHERE r.dealership_key  = a.dealership_key
          AND r.condition_group = a.condition_group
          AND r.sale_date BETWEEN a.as_of_date - 29 AND a.as_of_date
     ) AS t ON true;

COMMENT ON VIEW reporting.vw_days_supply IS
    'Grain: one row per dealership per snapshot (as-of) date per condition group (New / Used). Governed '
    'SQL owner of KPI-INV-009. Numerator: active units at the single as-of date. Denominator: retail units '
    'sold over the trailing 30 CALENDAR days ending on that date, divided by 30. The 30-day window is the '
    'ARPI project default from ARCHITECTURE.md section 18.2, is NOT an industry benchmark, and is '
    'published on every row so a finding can state it. Calendar days, not selling days; retail only; new '
    'and used separated; no rolling average. days_supply is NULL when the trailing window contains no '
    'retail sales -- the measure is genuinely undefined at a zero selling pace, never infinite and never a '
    'large sentinel, and the visual must say "insufficient sales history". Extremely sensitive to the '
    'window and to seasonality: 30 days ending in a slow month makes a normal lot look overstocked. ARPI '
    'publishes no target days supply, because it has no benchmark data.';

COMMENT ON COLUMN reporting.vw_days_supply.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_days_supply.as_of_date_key IS 'The single as-of date, taken from the inventory snapshot. Relationship column into vw_calendar. The trailing sales window ends on this date.';
COMMENT ON COLUMN reporting.vw_days_supply.condition_group IS 'New or Used. Reported separately; a blended days supply describes neither.';
COMMENT ON COLUMN reporting.vw_days_supply.active_inventory_units IS 'KPI-INV-009 numerator: units in stock on the as-of date. Equals KPI-INV-001 in the same context.';
COMMENT ON COLUMN reporting.vw_days_supply.trailing_days IS 'The trailing window in calendar days, published on every row. 30 is the ARPI default from ARCHITECTURE.md section 18.2, not an industry benchmark.';
COMMENT ON COLUMN reporting.vw_days_supply.trailing_retail_units IS 'Retail units delivered in the trailing window. Wholesale and dealer trades are excluded. Must match KPI-SLS-001 over the same window (RECON-UNITS-001).';
COMMENT ON COLUMN reporting.vw_days_supply.average_daily_retail_sales IS 'KPI-INV-009 denominator: trailing_retail_units / trailing_days. Zero when the store sold nothing in the window, which is what makes the measure undefined rather than large.';
COMMENT ON COLUMN reporting.vw_days_supply.days_supply IS 'KPI-INV-009 at this view''s grain, in days. NULL when average_daily_retail_sales is zero -- never infinity, never a sentinel. State the trailing window on any visual, for example "days supply, 30-day pace".';
