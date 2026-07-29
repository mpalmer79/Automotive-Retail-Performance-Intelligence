-- =============================================================================
-- File:            sql/05_reporting/25_vw_inventory_turn.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed inventory-turn aggregate at store, month and condition group, with the seven method choices that make a turn figure comparable published on the row.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales and reporting.vw_inventory_snapshots exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per calendar month per condition group (New / Used).
-- =============================================================================
--
-- KPI OWNED
-- ---------
--   KPI-INV-008  Inventory turn
--                annualized_retail_units / average_daily_active_inventory
--
-- TWO DATE COLUMNS, ONE PERIOD WINDOW
-- -----------------------------------
-- The numerator is driven by sale_date_key and the denominator by
-- snapshot_date_key. They are different columns on different facts, and both must
-- be driven by the SAME period selection. That is the subtlety that makes this
-- measure easy to get wrong, and it is why the two sides are computed here against
-- one month key rather than left to a report author to align.
--
-- ARPI'S SEVEN METHOD CHOICES
-- ---------------------------
-- Turn and days-supply calculations vary across vendors, so the method must be
-- documented. ARPI's is:
--   1. calendar-day annualization (365 / days in the month), not selling days
--   2. retail-only numerator -- wholesale and dealer trades dispose of inventory
--      but are not retail turn
--   3. daily-average active denominator, computed as unit-days / snapshot days,
--      NOT a beginning-plus-ending-divided-by-two approximation
--   4. new and used reported separately, because their turn rates are not comparable
--   5. sold units excluded from the denominator on and after their sale date --
--      snapshots stop at disposition, so this is true by construction
--   6. no rolling average
--   7. month as the minimum window; annualizing a 7-day window produces a number
--      but not an informative one
-- An ARPI turn figure is NOT comparable to a turn figure from any other system
-- unless that system makes the same seven choices.

CREATE OR REPLACE VIEW reporting.vw_inventory_turn AS
WITH calendar_month AS (
    SELECT
        c.date_key                                                    AS date_key,
        (extract(year  FROM c.month_start_date)::integer * 10000)
          + (extract(month FROM c.month_start_date)::integer * 100)
          +  extract(day   FROM c.month_start_date)::integer          AS month_date_key
    FROM reporting.vw_calendar AS c
),
sales AS (
    SELECT
        s.dealership_key                                              AS dealership_key,
        cm.month_date_key                                             AS month_date_key,
        s.condition_group                                             AS condition_group,
        sum(s.retail_unit_count)::bigint                              AS retail_units_sold
    FROM reporting.vw_vehicle_sales AS s
    JOIN calendar_month AS cm ON cm.date_key = s.sale_date_key
    GROUP BY s.dealership_key, cm.month_date_key, s.condition_group
),
inventory AS (
    SELECT
        i.dealership_key                                              AS dealership_key,
        cm.month_date_key                                             AS month_date_key,
        i.condition_group                                             AS condition_group,
        sum(i.inventory_unit_count)::bigint                           AS inventory_unit_days,
        count(DISTINCT i.snapshot_date_key)::integer                  AS snapshot_day_count
    FROM reporting.vw_inventory_snapshots AS i
    JOIN calendar_month AS cm ON cm.date_key = i.snapshot_date_key
    GROUP BY i.dealership_key, cm.month_date_key, i.condition_group
),
period AS (
    SELECT
        cm.month_date_key                                             AS month_date_key,
        count(*)::integer                                             AS calendar_days_in_period
    FROM calendar_month AS cm
    GROUP BY cm.month_date_key
)
SELECT
    coalesce(sales.dealership_key,  inventory.dealership_key)         AS dealership_key,
    coalesce(sales.month_date_key,  inventory.month_date_key)         AS month_date_key,
    coalesce(sales.condition_group, inventory.condition_group)        AS condition_group,

    -- Numerator side.
    coalesce(sales.retail_units_sold, 0)                              AS retail_units_sold,
    period.calendar_days_in_period                                    AS calendar_days_in_period,
    coalesce(sales.retail_units_sold, 0)::numeric
        * 365.0 / nullif(period.calendar_days_in_period, 0)           AS annualized_retail_units,

    -- Denominator side.
    inventory.inventory_unit_days                                     AS inventory_unit_days,
    inventory.snapshot_day_count                                      AS snapshot_day_count,
    inventory.inventory_unit_days::numeric
        / nullif(inventory.snapshot_day_count, 0)                     AS average_daily_active_inventory,

    -- The measure.
    (coalesce(sales.retail_units_sold, 0)::numeric
        * 365.0 / nullif(period.calendar_days_in_period, 0))
      / nullif(
            inventory.inventory_unit_days::numeric
              / nullif(inventory.snapshot_day_count, 0), 0)           AS inventory_turn
FROM sales
FULL OUTER JOIN inventory
       ON  inventory.dealership_key  = sales.dealership_key
       AND inventory.month_date_key  = sales.month_date_key
       AND inventory.condition_group = sales.condition_group
JOIN period
       ON period.month_date_key = coalesce(sales.month_date_key, inventory.month_date_key);

COMMENT ON VIEW reporting.vw_inventory_turn IS
    'Grain: one row per dealership per calendar month per condition group (New / Used). Governed SQL owner '
    'of KPI-INV-008. The numerator is driven by sale_date_key and the denominator by snapshot_date_key -- '
    'two different columns on two different facts -- and both are aligned to one month key here rather '
    'than left to a report author. ARPI''s method, which must be quoted with any figure: calendar-day '
    'annualization (365 / days in month), retail-only numerator, daily-average active denominator computed '
    'as unit-days / snapshot days rather than a beginning-plus-ending approximation, new and used '
    'separated, sold units excluded from the denominator after disposition, no rolling average, month as '
    'the minimum window. An ARPI turn figure is NOT comparable to one from another system unless that '
    'system makes the same seven choices. inventory_turn is NULL when the period has no snapshot rows, '
    'never 0. ARPI publishes no target turn rate, because it has no benchmark data.';

COMMENT ON COLUMN reporting.vw_inventory_turn.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_inventory_turn.month_date_key IS 'First day of the month, as a YYYYMMDD key. Relationship column into vw_calendar. Drives BOTH the sale-date numerator and the snapshot-date denominator.';
COMMENT ON COLUMN reporting.vw_inventory_turn.condition_group IS 'New or Used. Their turn rates are not comparable and are never blended.';
COMMENT ON COLUMN reporting.vw_inventory_turn.retail_units_sold IS 'Retail units delivered in the month, before annualization. Wholesale and dealer trades are excluded: they dispose of inventory but are not retail turn.';
COMMENT ON COLUMN reporting.vw_inventory_turn.calendar_days_in_period IS 'Calendar days in the month, taken from vw_calendar. Calendar days, not selling days -- the choice is fixed and must be stated on the visual.';
COMMENT ON COLUMN reporting.vw_inventory_turn.annualized_retail_units IS 'KPI-INV-008 numerator: retail_units_sold x 365 / calendar_days_in_period.';
COMMENT ON COLUMN reporting.vw_inventory_turn.inventory_unit_days IS 'Sum of daily active unit counts across the month. Unit-DAYS, not units; this is the quantity that makes the daily average exact.';
COMMENT ON COLUMN reporting.vw_inventory_turn.snapshot_day_count IS 'Distinct snapshot dates observed in the month. A value below calendar_days_in_period means snapshot coverage is incomplete and the average is taken over the dates that exist.';
COMMENT ON COLUMN reporting.vw_inventory_turn.average_daily_active_inventory IS 'KPI-INV-008 denominator: inventory_unit_days / snapshot_day_count. A true daily average, not a beginning-plus-ending-divided-by-two approximation. NULL when the period has no snapshot rows.';
COMMENT ON COLUMN reporting.vw_inventory_turn.inventory_turn IS 'KPI-INV-008 at this view''s grain, in turns per year to two decimals. NULL when the denominator is zero or the period has no snapshot rows, never 0. Unstable over short periods; one calendar month is the minimum recommended window.';
