-- =============================================================================
-- File:            sql/05_reporting/12_vw_inventory_snapshots.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Row-grain reporting projection of warehouse.fact_vehicle_inventory_snapshot, exposing row-level days_in_stock so the median inventory age stays computable.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_inventory_snapshot and warehouse.dim_vehicle exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per vehicle per dealership per daily snapshot date, while the unit is active in inventory.
-- =============================================================================
--
-- KPIs OWNED (row-level inputs)
-- -----------------------------
--   KPI-INV-001  Active inventory count      SUM(inventory_unit_count)   -- SEMI-ADDITIVE
--   KPI-INV-002  Inventory investment        SUM(inventory_investment)   -- SEMI-ADDITIVE
--   KPI-INV-003  Average inventory age       SUM(days_in_stock) / SUM(inventory_unit_count)
--   KPI-INV-004  Median inventory age        MEDIAN(days_in_stock)
--   KPI-INV-005  Aged inventory count        SUM(aged_unit_count), or SUM(inventory_unit_count)
--                                            filtered on days_in_stock > threshold
--   KPI-INV-006  Aged inventory percentage   SUM(aged_unit_count) / SUM(inventory_unit_count)
--   KPI-INV-008  Inventory turn (denominator)
--   KPI-INV-009  Dealer days supply (numerator)
--
-- SEMI-ADDITIVITY IS THE HAZARD
-- -----------------------------
-- KPI-INV-001 and KPI-INV-002 are additive across store, vehicle and model, and are
-- NOT additive across dates. Summing a daily count over a month yields unit-days,
-- not units, and is wrong by roughly a factor of thirty while looking entirely
-- plausible. Every measure built on these columns must use explicit semi-additive
-- handling (LASTNONBLANKVALUE or an average of daily values) and must state its
-- time-aggregation rule on the visual.
--
-- WHY ROW LEVEL
-- -------------
-- KPI-INV-004 is an order statistic. A median cannot be recomputed from a
-- pre-aggregated view, so days_in_stock is published at row level. This is the
-- deliberate exception to the aggregate-in-the-view pattern that KPI_CATALOG.md
-- requires for KPI-INV-004.
--
-- THE AGE THRESHOLD
-- -----------------
-- aged_unit_count applies the ARPI project default of 60 days, sourced from
-- ARCHITECTURE.md section 18.2. It is NOT an industry benchmark and is not
-- presented as one. days_in_stock stays at row level precisely so a reviewer can
-- move the threshold and watch the answer move.

CREATE OR REPLACE VIEW reporting.vw_inventory_snapshots AS
SELECT
    i.inventory_snapshot_key                                   AS inventory_snapshot_key,

    -- Date key. This fact has exactly one date role.
    i.snapshot_date_key                                        AS snapshot_date_key,

    -- Relationship keys.
    i.dealership_key                                           AS dealership_key,
    i.vehicle_key                                              AS vehicle_key,
    i.vehicle_model_key                                        AS vehicle_model_key,

    -- Descriptive attributes.
    CASE WHEN v.condition_type = 'New' THEN 'New' ELSE 'Used' END  AS condition_group,
    v.condition_type                                           AS vehicle_condition_type,
    i.age_bucket                                               AS age_bucket,

    -- Price and investment.
    i.current_asking_price                                     AS current_asking_price,
    i.original_asking_price                                    AS original_asking_price,
    i.msrp                                                     AS msrp,
    i.acquisition_cost                                         AS acquisition_cost,
    i.reconditioning_cost                                      AS reconditioning_cost,
    i.inventory_investment                                     AS inventory_investment,
    i.market_price_estimate                                    AS market_price_estimate,

    -- WHERE price_to_market_ratio IS DEFINED.
    --
    -- It is derived here rather than stored on the fact, because a stored copy would be an
    -- answer able to disagree with its own components the day somebody restamped one of them.
    --
    -- ONE OTHER FILE COMPUTES THIS EXPRESSION: reporting.vw_inventory_units, which reads the
    -- fact directly -- it needs window functions over a narrowed set of dates that this view
    -- does not publish -- and therefore cannot select a column its source does not carry. That
    -- duplication is deliberate and is not left to care: RECON-INV-UNIT-RATIO re-proves the
    -- two are equal on every database run, comparing NULL as a value so that an absent
    -- estimate must give an absent ratio on both sides and a zero on neither. A THIRD copy of
    -- this division is a defect; see sql/08_validation/14_recon_inventory_units.sql.
    --
    -- NULL propagates deliberately. A unit with no estimate has no ratio -- not a ratio of
    -- zero, and not an imputed one. The NULLIF guards the denominator a second time even
    -- though the fact's CHECK already forbids a non-positive estimate, because a view that
    -- divides by a column is one dropped constraint away from a division error.
    CASE
        WHEN i.market_price_estimate IS NULL THEN NULL
        ELSE round(i.current_asking_price / NULLIF(i.market_price_estimate, 0), 4)
    END                                                        AS price_to_market_ratio,

    -- Age. Row level for the median; also the additive numerator of the mean.
    i.days_in_stock                                            AS days_in_stock,
    (i.days_in_stock > 60)                                     AS is_aged_over_default_threshold,
    CASE WHEN i.days_in_stock > 60
         THEN i.inventory_unit_count ELSE 0 END::smallint      AS aged_unit_count,
    CASE WHEN i.days_in_stock > 60
         THEN i.inventory_investment ELSE 0 END                AS aged_inventory_investment,

    i.markdown_count_to_date                                   AS markdown_count_to_date,
    i.inventory_unit_count                                     AS inventory_unit_count,
    i.source_system                                            AS source_system
FROM warehouse.fact_vehicle_inventory_snapshot AS i
JOIN warehouse.dim_vehicle AS v
       ON v.vehicle_key = i.vehicle_key;

COMMENT ON VIEW reporting.vw_inventory_snapshots IS
    'Grain: one row per vehicle per dealership per daily snapshot date while the unit is active -- '
    'identical to warehouse.fact_vehicle_inventory_snapshot, with no aggregation and no filtering. Fact '
    'table for the semantic model. Owns the row-level inputs to KPI-INV-001..006, the KPI-INV-008 '
    'denominator and the KPI-INV-009 numerator. SEMI-ADDITIVE: inventory_unit_count and '
    'inventory_investment are additive across store, vehicle and model but NOT across dates -- summing '
    'them over a date range yields unit-days, not units. Use LASTNONBLANKVALUE or an average of daily '
    'values and state the rule on the visual. days_in_stock is published at row level because KPI-INV-004 '
    'is a median and cannot be recomputed from a pre-aggregated view. aged_unit_count uses the ARPI '
    'default 60-day threshold from ARCHITECTURE.md section 18.2, which is a project convention and not an '
    'industry benchmark. Surrogate keys should be hidden in the semantic model.';

COMMENT ON COLUMN reporting.vw_inventory_snapshots.inventory_snapshot_key IS 'Warehouse surrogate key of the snapshot row. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.snapshot_date_key IS 'The as-of date of the snapshot. Single active relationship to vw_calendar. Every inventory measure is evaluated at ONE selected date.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.vehicle_key IS 'Vehicle surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.vehicle_model_key IS 'Model-line surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.condition_group IS 'Governed new/used split taken from the vehicle. New and used inventory turn at different rates and are reported separately by default.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.vehicle_condition_type IS 'New, Used or Certified as recorded on the vehicle.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.age_bucket IS 'Pre-computed age bucket: 0-30, 31-60, 61-90, 91-120 or Over 120 days.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.market_price_estimate IS 'SYNTHETIC market price reference for the unit, constant across its snapshots. NULL where the estimator declined to price the unit. NOT a market valuation and never to be presented as one; no guidebook, auction or licensed benchmark exists anywhere in this project.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.price_to_market_ratio IS 'current_asking_price / market_price_estimate, rounded to 4 decimals. Where this ratio is defined; reporting.vw_inventory_units repeats the identical expression because it reads the fact directly, and RECON-INV-UNIT-RATIO re-proves the two agree on every run. NULL where there is no estimate -- never zero and never imputed. Above 1.0 means the unit is advertised above its synthetic estimate; below 1.0 means beneath it. It is a descriptive comparison against a generated reference, not evidence that a price is right or wrong.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.current_asking_price IS 'Advertised price on the snapshot date.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.original_asking_price IS 'First advertised price.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.msrp IS 'Manufacturer suggested retail price where one applies, otherwise NULL.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.acquisition_cost IS 'What the unit cost to acquire.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.reconditioning_cost IS 'What the unit cost to recondition.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.inventory_investment IS 'KPI-INV-002 numerator: acquisition_cost + reconditioning_cost. SEMI-ADDITIVE across dates. This is cost invested, not market value and not floor-plan exposure -- ARPI models no floor-plan interest or carrying cost.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.days_in_stock IS 'KPI-INV-003 numerator and the KPI-INV-004 median population. Calendar days between acquisition and the snapshot date. Published at row level because a median cannot be recomputed from an aggregate.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.is_aged_over_default_threshold IS 'True when days_in_stock exceeds the ARPI default of 60 days. A project convention from ARCHITECTURE.md section 18.2, not an industry benchmark.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.aged_unit_count IS 'KPI-INV-005 numerator and the KPI-INV-006 numerator at the default 60-day threshold. 1 when aged, 0 otherwise. For any other threshold, filter days_in_stock instead.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.aged_inventory_investment IS 'Capital committed to units past the default threshold. The honest statement is how much capital is committed, not what the aging is costing per day.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.markdown_count_to_date IS 'Number of price reductions applied to the unit so far.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.inventory_unit_count IS 'KPI-INV-001 numerator and the KPI-INV-003/006 denominator. Always 1. SEMI-ADDITIVE across dates.';
COMMENT ON COLUMN reporting.vw_inventory_snapshots.source_system IS 'Originating system. Present so no reader mistakes this for real inventory data.';
