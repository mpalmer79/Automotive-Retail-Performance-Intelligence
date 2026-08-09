-- =============================================================================
-- File:            sql/05_reporting/52_vw_inventory_units.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Unit-grain operational inventory surface for the web operating console: business identifiers, vehicle description, price-to-market context and snapshot-derived markdown activity.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_inventory_snapshot, warehouse.dim_vehicle, warehouse.dim_vehicle_model, warehouse.dim_dealership and warehouse.dim_date exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per vehicle per dealership per REPORTABLE snapshot date -- every month end, plus the most recent snapshot date in the warehouse. Identical to the fact; no aggregation, no filtering.
-- =============================================================================
--
-- WHY THIS VIEW EXISTS WHEN vw_inventory_snapshots ALREADY DOES
-- --------------------------------------------------------------
-- They have the same grain and different jobs, and neither can do the other's.
--
-- reporting.vw_inventory_snapshots is the SEMANTIC MODEL fact view. It publishes
-- surrogate keys -- vehicle_key, dealership_key, vehicle_model_key -- because Power BI
-- needs them to form relationships, and it publishes nothing that would duplicate a
-- conformed dimension, because in a star schema that is the dimension's job.
--
-- This view is the OPERATING CONSOLE surface. The console has no relationship engine and
-- no dimension tables: it receives flat exported rows and renders them. It therefore needs
-- the business identifiers a URL can carry (`?unit=VEH-0000013`) and the descriptive
-- attributes a human reads, denormalised onto the row. A surrogate key is exactly what it
-- must NOT receive -- ADR-0013 and the dashboard data contract forbid one crossing the
-- browser boundary, because a warehouse key in a URL is both meaningless to a reader and a
-- promise about internal identity the project has no intention of keeping.
--
-- Publishing this as a second view rather than widening the first is the cheaper mistake.
-- Widening vw_inventory_snapshots would push console-shaped columns into the semantic
-- model, and the two consumers would then constrain each other forever.
--
-- WHY MONTH ENDS AND THE LATEST DATE, RATHER THAN ALL 184 DAYS
-- -------------------------------------------------------------
-- The fact is daily, and this view is not. Three reasons, in order of weight:
--
--   1. IT HAS TO FIT. The console's datasets are committed files with a declared ceiling
--      (DATA_CONTRACT.md section 10: 3 MB per file). Measured, the daily grain exports at
--      31.3 MB for a single file and takes the whole export to 46 MB against a 20 MB
--      ceiling. That is not a budget to be raised; 184 near-identical rows per unit is
--      simply the wrong thing to publish.
--   2. IT MAKES THE ACCOUNTING JOIN REAL. warehouse.fact_inventory_accounting_snapshot is
--      month-end grain. At daily grain, an operational unit row lines up with an accounting
--      row on roughly one day in thirty and the console would show "no accounting position"
--      for a unit that plainly has one. At month-end grain the two agree by construction,
--      which is what DASH.9-01's "accounting position where DASH.8 data exists" needs.
--   3. IT MAKES THE MARKDOWN QUESTION THE ONE ANYBODY ASKS. See below.
--
-- The latest snapshot date is unioned in because "what is on my lot right now" must be
-- complete and current, and the most recent date is usually not a month end.
--
-- WHAT THIS COSTS, STATED PLAINLY: a unit acquired and sold entirely between two month ends
-- appears here only if it is still in stock on the latest snapshot date. That unit is
-- absent rather than misreported, and it is absent from the accounting schedule for exactly
-- the same reason.
--
-- MARKDOWN ACTIVITY IS DERIVED, NOT STORED
-- -----------------------------------------
-- There is no fact_inventory_price_history in ARPI, and DASH.9 deliberately does not add
-- one (it remains deferred under DASH.O-2). Markdown activity here is derived from
-- consecutive REPORTABLE snapshots of the SAME unit, which is the only honest source
-- available:
--
--   prior_asking_price   the unit's advertised price on its previous REPORTABLE snapshot
--   asking_price_change  current minus prior; NEGATIVE is a markdown
--
-- The window runs over the month-end set, NOT over the underlying daily rows, and that is
-- deliberate. Computed daily and then filtered to month ends, prior_asking_price would be
-- YESTERDAY'S price on every published row: nearly every change would be zero, the column
-- would look broken, and the real month-over-month reductions would be invisible.
-- prior_snapshot_date is published so a reader sees the interval rather than assuming one.
--
-- The change belongs to the LATER snapshot date. It is not restated backward onto the date
-- the price was still higher, because on that date the reduction had not happened.
--
-- A unit's first snapshot has no prior row and therefore NULL movement -- not zero. Zero
-- would assert "the price did not change", which is a different and unsupported claim.
--
-- WHAT A PRICE DECREASE IS NOT
-- -----------------------------
-- It is an observed price decrease between two snapshots. It is not evidence of a manager
-- decision, a pricing strategy, a repricing action or a successful markdown, because ARPI
-- models no causal mechanism for any of those. Consuming surfaces must describe it as a
-- price reduction and never as a recommendation or an outcome.
--
-- THE AGED THRESHOLD IS 60 DAYS AND IT IS A PROJECT DEFAULT
-- ----------------------------------------------------------
-- Published on every row rather than assumed, so a console can state the threshold it
-- applied instead of hardcoding one. 60 days is the ARPI convention from ARCHITECTURE.md
-- section 18.2. It is NOT an industry benchmark, an OEM target or good practice, and no
-- surface may present it as one. Note that it is a different number from the 120-day top
-- age-bucket boundary; the two are unrelated and conflating them overstates aged stock.
--
-- SEMI-ADDITIVITY
-- ---------------
-- inventory_investment and inventory_unit_count are additive across store, vehicle and
-- model and NOT across dates. This view is at daily grain, so a consumer that sums either
-- over a date range reports unit-days rather than units, wrong by roughly the number of
-- days while looking entirely plausible. Select one snapshot date.

CREATE OR REPLACE VIEW reporting.vw_inventory_units AS
WITH reportable_dates AS (
    -- Every month end the warehouse holds a snapshot on, plus the most recent snapshot
    -- date. Derived from the fact rather than from dim_date alone, so a month end with no
    -- inventory rows never becomes a date the console offers and then finds empty.
    SELECT d.date_key
    FROM warehouse.dim_date AS d
    WHERE d.is_month_end
      AND EXISTS (
          SELECT 1
          FROM warehouse.fact_vehicle_inventory_snapshot AS f
          WHERE f.snapshot_date_key = d.date_key
      )
    UNION
    SELECT max(f.snapshot_date_key)
    FROM warehouse.fact_vehicle_inventory_snapshot AS f
),
reportable AS (
    SELECT i.*
    FROM warehouse.fact_vehicle_inventory_snapshot AS i
    JOIN reportable_dates AS r ON r.date_key = i.snapshot_date_key
)
SELECT
    -- Business identity. No surrogate key crosses this boundary.
    d.full_date                                                AS snapshot_date,
    dl.dealership_id                                           AS dealership_id,
    dl.store_name                                              AS store_name,
    v.vehicle_id                                               AS vehicle_id,
    v.synthetic_vin                                            AS synthetic_vin,

    -- Vehicle description, denormalised so the console needs no second join.
    v.condition_type                                           AS condition_type,
    CASE WHEN v.condition_type = 'New' THEN 'New' ELSE 'Used' END  AS condition_group,
    m.model_year                                               AS model_year,
    m.make                                                     AS make,
    m.model                                                    AS model_name,
    m.trim                                                     AS trim_level,
    m.body_style                                               AS body_style,
    v.exterior_color                                           AS exterior_color,
    v.odometer_reading                                         AS odometer_reading,
    v.acquisition_source                                       AS acquisition_source,

    -- Age.
    i.days_in_stock                                            AS days_in_stock,
    i.age_bucket                                               AS age_bucket,
    60::integer                                                AS aged_threshold_days,
    (i.days_in_stock > 60)                                     AS is_aged_over_default_threshold,

    -- Price and investment.
    i.current_asking_price                                     AS current_asking_price,
    i.original_asking_price                                    AS original_asking_price,
    i.msrp                                                     AS msrp,
    i.acquisition_cost                                         AS acquisition_cost,
    i.reconditioning_cost                                      AS reconditioning_cost,
    i.inventory_investment                                     AS inventory_investment,

    -- Synthetic market context. The ratio is derived in exactly one place in this project
    -- -- reporting.vw_inventory_snapshots -- and is repeated here by the identical
    -- expression rather than by a second rule, so the two cannot disagree without the
    -- expression itself being edited twice. RECON-INV-UNIT-RATIO re-proves the equality on
    -- every run.
    i.market_price_estimate                                    AS market_price_estimate,
    CASE
        WHEN i.market_price_estimate IS NULL THEN NULL
        ELSE round(i.current_asking_price / NULLIF(i.market_price_estimate, 0), 4)
    END                                                        AS price_to_market_ratio,

    -- Snapshot-derived markdown activity. LAG partitions by the unit and its store so a
    -- unit that moved between stores cannot inherit the other store's price as its prior.
    i.markdown_count_to_date                                   AS markdown_count_to_date,
    lag(i.current_asking_price) OVER unit_history              AS prior_asking_price,
    lag(d.full_date)            OVER unit_history              AS prior_snapshot_date,
    i.current_asking_price - lag(i.current_asking_price) OVER unit_history
                                                               AS asking_price_change,
    CASE
        WHEN lag(i.current_asking_price) OVER unit_history IS NULL THEN NULL
        ELSE (i.current_asking_price < lag(i.current_asking_price) OVER unit_history)
    END                                                        AS is_price_reduced_since_prior,

    i.inventory_unit_count                                     AS inventory_unit_count,
    i.source_system                                            AS source_system
FROM reportable AS i
JOIN warehouse.dim_date        AS d  ON d.date_key         = i.snapshot_date_key
JOIN warehouse.dim_dealership  AS dl ON dl.dealership_key  = i.dealership_key
JOIN warehouse.dim_vehicle     AS v  ON v.vehicle_key      = i.vehicle_key
JOIN warehouse.dim_vehicle_model AS m ON m.vehicle_model_key = i.vehicle_model_key
WINDOW unit_history AS (
    PARTITION BY i.vehicle_key, i.dealership_key
    ORDER BY i.snapshot_date_key
);

COMMENT ON VIEW reporting.vw_inventory_units IS
    'Grain: one row per vehicle per dealership per daily snapshot date while the unit is '
    'active -- identical to warehouse.fact_vehicle_inventory_snapshot, with no aggregation '
    'and no filtering. The OPERATING CONSOLE surface for unit-level inventory: business '
    'identifiers and denormalised vehicle description, so no surrogate key crosses the '
    'browser boundary. Distinct from reporting.vw_inventory_snapshots, which is the '
    'semantic-model fact view and publishes surrogate keys instead. SEMI-ADDITIVE: '
    'inventory_investment and inventory_unit_count are additive across store, vehicle and '
    'model but NOT across dates -- select one snapshot date rather than summing a range. '
    'Markdown activity is derived from consecutive snapshots of the same unit and belongs '
    'to the later date; it is an observed price movement and never evidence of a manager '
    'decision or a repricing action. market_price_estimate is SYNTHETIC and is not a market '
    'valuation. aged_threshold_days is the ARPI 60-day project default from ARCHITECTURE.md '
    'section 18.2, not an industry benchmark, and is a different number from the 120-day '
    'top age-bucket boundary.';

COMMENT ON COLUMN reporting.vw_inventory_units.snapshot_date IS 'The as-of date of the snapshot. THE date basis of every column on this row; every inventory measure is evaluated at one selected date.';
COMMENT ON COLUMN reporting.vw_inventory_units.dealership_id IS 'Store business identifier. Safe to carry in a URL; no surrogate key is published by this view.';
COMMENT ON COLUMN reporting.vw_inventory_units.store_name IS 'Store display name, denormalised for the console.';
COMMENT ON COLUMN reporting.vw_inventory_units.vehicle_id IS 'Vehicle business identifier in the reserved VEH-####### scheme. The drill-through key the console carries as ?unit=. It is NOT a stock number: ARPI governs no stock number.';
COMMENT ON COLUMN reporting.vw_inventory_units.synthetic_vin IS 'Synthetic VIN-style identifier under ADR-0005. Structurally VIN-shaped and entirely fictional; it identifies no real vehicle.';
COMMENT ON COLUMN reporting.vw_inventory_units.condition_type IS 'New, Used or Certified as recorded on the vehicle.';
COMMENT ON COLUMN reporting.vw_inventory_units.condition_group IS 'Governed new/used split. Certified groups with Used here, which is the SALES rule; the accounting domain deliberately separates Certified into its own control account.';
COMMENT ON COLUMN reporting.vw_inventory_units.model_year IS 'Model year of the resolved model line.';
COMMENT ON COLUMN reporting.vw_inventory_units.make IS 'Make of the resolved model line.';
COMMENT ON COLUMN reporting.vw_inventory_units.model_name IS 'Model of the resolved model line.';
COMMENT ON COLUMN reporting.vw_inventory_units.trim_level IS 'Trim of the resolved model line.';
COMMENT ON COLUMN reporting.vw_inventory_units.body_style IS 'Body style of the resolved model line.';
COMMENT ON COLUMN reporting.vw_inventory_units.exterior_color IS 'Exterior colour of the unit.';
COMMENT ON COLUMN reporting.vw_inventory_units.odometer_reading IS 'Miles showing on the unit, as recorded at acquisition.';
COMMENT ON COLUMN reporting.vw_inventory_units.acquisition_source IS 'How the unit entered inventory. Operational context; it is not a disposition and says nothing about how the unit will leave.';
COMMENT ON COLUMN reporting.vw_inventory_units.days_in_stock IS 'Calendar days between the acquisition date and this snapshot date. Non-negative by rule. Published at row level because the median inventory age is an order statistic and cannot be recomputed from an aggregate.';
COMMENT ON COLUMN reporting.vw_inventory_units.age_bucket IS 'Pre-computed age bucket: 0-30, 31-60, 61-90, 91-120 or Over 120 days. The boundaries are a CHECK constraint on the fact; this view consumes them and does not re-encode them.';
COMMENT ON COLUMN reporting.vw_inventory_units.aged_threshold_days IS 'The threshold applied to is_aged_over_default_threshold, published on every row so a console can state the threshold it used. 60 days is the ARPI PROJECT DEFAULT from ARCHITECTURE.md section 18.2 -- not an industry benchmark, not an OEM target, and not the same number as the 120-day top age bucket.';
COMMENT ON COLUMN reporting.vw_inventory_units.is_aged_over_default_threshold IS 'Whether days_in_stock exceeds aged_threshold_days. Descriptive classification, not a judgement that the unit is mispriced or unsellable.';
COMMENT ON COLUMN reporting.vw_inventory_units.current_asking_price IS 'Advertised price on this snapshot date, after age-driven markdowns.';
COMMENT ON COLUMN reporting.vw_inventory_units.original_asking_price IS 'First advertised price for the unit. Constant across its snapshots.';
COMMENT ON COLUMN reporting.vw_inventory_units.msrp IS 'Manufacturer suggested retail price. NULL for a used unit with no sticker. It is a list price and is NOT the synthetic market estimate.';
COMMENT ON COLUMN reporting.vw_inventory_units.acquisition_cost IS 'What the store paid for the unit, exclusive of reconditioning.';
COMMENT ON COLUMN reporting.vw_inventory_units.reconditioning_cost IS 'Reconditioning spend booked against the unit to date.';
COMMENT ON COLUMN reporting.vw_inventory_units.inventory_investment IS 'acquisition_cost + reconditioning_cost; the capital tied up in the unit on this date. SEMI-ADDITIVE across dates. This is the OPERATIONAL investment figure and is not the accounting book value, which lives on warehouse.fact_inventory_accounting_snapshot at month-end grain and carries capitalised components this column does not.';
COMMENT ON COLUMN reporting.vw_inventory_units.market_price_estimate IS 'SYNTHETIC market price reference for the unit, constant across its snapshots. NULL where the estimator declined to price it. NOT a market valuation: no auction result, guidebook, licensed benchmark or observed transaction is consulted anywhere in this project. Every surface displaying it must say synthetic estimate.';
COMMENT ON COLUMN reporting.vw_inventory_units.price_to_market_ratio IS 'current_asking_price / market_price_estimate, to 4 decimals. NULL where there is no estimate -- never zero and never imputed. Above 1.0 is advertised above the synthetic estimate, below 1.0 beneath it. A descriptive comparison against a generated reference; it is not evidence that a price is right or wrong and must never drive a repricing recommendation.';
COMMENT ON COLUMN reporting.vw_inventory_units.markdown_count_to_date IS 'Price reductions taken by this unit so far; never decreases as the unit ages.';
COMMENT ON COLUMN reporting.vw_inventory_units.prior_asking_price IS 'The same unit''s advertised price on its previous snapshot at this store. NULL on the unit''s first snapshot, because no prior observation exists -- not zero.';
COMMENT ON COLUMN reporting.vw_inventory_units.prior_snapshot_date IS 'The date of that previous snapshot, so a consumer can state the interval the movement spans rather than assume it is one day.';
COMMENT ON COLUMN reporting.vw_inventory_units.asking_price_change IS 'current_asking_price minus prior_asking_price. NEGATIVE is a price reduction. NULL on the unit''s first snapshot. Belongs to THIS snapshot date and is never restated backward onto the date the price was still higher.';
COMMENT ON COLUMN reporting.vw_inventory_units.is_price_reduced_since_prior IS 'Whether the advertised price fell since the previous snapshot. NULL where there is no prior observation. An observed movement only: ARPI models no manager decision, pricing strategy or repricing action, and no surface may describe it as one.';
COMMENT ON COLUMN reporting.vw_inventory_units.inventory_unit_count IS 'Additive unit counter, always 1. SEMI-ADDITIVE across dates.';
COMMENT ON COLUMN reporting.vw_inventory_units.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
