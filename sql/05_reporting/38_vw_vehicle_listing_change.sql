-- =============================================================================
-- File:            sql/05_reporting/38_vw_vehicle_listing_change.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         What changed between two consecutive capture dates, owning the SQL side of KPI-LST-014..018.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per capture date per observed vehicle present in that capture or the one before it.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-LST-014  New listings since prior snapshot        change_type = 'New Listing'
--   KPI-LST-015  Removed listings since prior snapshot    change_type = 'Removed From Listing'
--   KPI-LST-016  Price reductions since prior snapshot    change_type = 'Price Reduction'
--   KPI-LST-017  Price increases since prior snapshot     change_type = 'Price Increase'
--   KPI-LST-018  Average price change                     avg(price_change)
--
-- REMOVED FROM LISTING IS NEVER SOLD
-- ----------------------------------
-- This is the rule this whole view exists to hold. The six labels are:
--
--     New Listing            in this capture, not in the previous one
--     Still Listed           in both, price unchanged or absent from both
--     Removed From Listing   in the previous capture, not in this one
--     Price Reduction        in both, this capture's price is lower
--     Price Increase         in both, this capture's price is higher
--     Price Unchanged        in both, prices equal
--
-- There is no 'Sold' label, no 'Delivered', no 'Disposed', and no column that could be
-- renamed into one. A listing disappears because the vehicle sold, or was traded to
-- another store, or was wholesaled, or the feed suppressed it, or somebody made a
-- mistake -- and this data cannot tell those apart. Labelling any of them a sale would
-- invent a transaction that may never have happened, in a project whose whole claim is
-- that it does not do that.
--
-- Note also that 'New Listing' means NEWLY OBSERVED, not newly acquired, and not a new
-- vehicle. A vehicle appearing for the first time may have been on the lot for months
-- before observation began.
--
-- THE FIRST SNAPSHOT IS A REAL STATE, NOT AN ERROR
-- ------------------------------------------------
-- When a store has exactly one capture, there is no prior snapshot to compare against.
-- This view stays queryable and returns one row per vehicle with
-- change_type = 'New Listing', has_prior_snapshot = false and prior_captured_at NULL.
-- That is the truthful answer -- everything is newly observed because observation just
-- started -- and it is deliberately not an empty result set, because an empty result
-- reads as "nothing changed" rather than "there is nothing to compare".
--
-- WHY THE COMPARISON IS AGAINST THE IMMEDIATELY PRECEDING CAPTURE
-- ---------------------------------------------------------------
-- lag() over the store's own ordered capture dates, so a store captured weekly
-- compares week to week and a store captured twice compares its two captures. The
-- interval between them is published as days_between_snapshots, because "eleven price
-- reductions" means something different over one day than over one quarter.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_change AS
WITH capture_dates AS (
    -- Every capture a store has, and the one immediately before it.
    SELECT
        f.dealership_key,
        f.captured_at,
        lag(f.captured_at) OVER (
            PARTITION BY f.dealership_key ORDER BY f.captured_at
        ) AS prior_captured_at
    FROM warehouse.fact_vehicle_listing_snapshot AS f
    GROUP BY f.dealership_key, f.captured_at
),
candidates AS (
    -- The union of the two captures' vehicles, built explicitly rather than with a
    -- FULL OUTER JOIN. The two interesting cases are exactly the ones an inner join
    -- drops -- a vehicle only in the current capture, and a vehicle only in the prior
    -- one -- and a full outer join between the fact and itself would additionally
    -- null out the capture columns it was joined through, which silently discards the
    -- removed rows. Enumerating the candidate keys first keeps every row anchored to
    -- its (store, capture, prior capture) triple.
    SELECT DISTINCT
        c.dealership_key,
        c.captured_at,
        c.prior_captured_at,
        f.observed_vehicle_key
    FROM capture_dates AS c
    JOIN warehouse.fact_vehicle_listing_snapshot AS f
      ON f.dealership_key = c.dealership_key
     AND (f.captured_at = c.captured_at OR f.captured_at = c.prior_captured_at)
),
paired AS (
    SELECT
        c.dealership_key,
        c.captured_at,
        c.prior_captured_at,
        c.observed_vehicle_key,
        cur.advertised_price      AS advertised_price,
        prv.advertised_price      AS prior_advertised_price,
        cur.pricing_status        AS pricing_status,
        prv.pricing_status        AS prior_pricing_status,
        cur.odometer_miles        AS odometer_miles,
        (cur.observed_vehicle_key IS NOT NULL) AS in_current,
        (prv.observed_vehicle_key IS NOT NULL) AS in_prior
    FROM candidates AS c
    LEFT JOIN warehouse.fact_vehicle_listing_snapshot AS cur
           ON cur.dealership_key = c.dealership_key
          AND cur.captured_at = c.captured_at
          AND cur.observed_vehicle_key = c.observed_vehicle_key
    LEFT JOIN warehouse.fact_vehicle_listing_snapshot AS prv
           ON prv.dealership_key = c.dealership_key
          AND prv.captured_at = c.prior_captured_at
          AND prv.observed_vehicle_key = c.observed_vehicle_key
)
SELECT
    p.dealership_key                                    AS dealership_key,
    d.date_key                                          AS snapshot_date_key,
    p.captured_at                                       AS captured_at,
    p.prior_captured_at                                 AS prior_captured_at,
    (p.prior_captured_at IS NOT NULL)                   AS has_prior_snapshot,
    (p.captured_at - p.prior_captured_at)               AS days_between_snapshots,
    p.observed_vehicle_key                              AS observed_vehicle_key,
    v.synthetic_vehicle_id                              AS synthetic_vehicle_id,
    v.condition_type                                    AS condition_type,
    v.make                                              AS make,
    v.model                                             AS model,
    v.trim                                              AS trim,
    v.vehicle_display                                   AS vehicle_display,
    p.odometer_miles                                    AS odometer_miles,
    p.advertised_price                                  AS advertised_price,
    p.prior_advertised_price                            AS prior_advertised_price,
    (p.advertised_price - p.prior_advertised_price)     AS price_change,
    p.pricing_status                                    AS pricing_status,
    p.prior_pricing_status                              AS prior_pricing_status,
    CASE
        -- Newly observed. NOT newly acquired, and NOT a new vehicle.
        WHEN NOT p.in_prior                              THEN 'New Listing'
        -- Gone from the public listing. NOT sold. There is no sale in this data.
        WHEN NOT p.in_current                            THEN 'Removed From Listing'
        WHEN p.advertised_price IS NULL
          OR p.prior_advertised_price IS NULL            THEN 'Still Listed'
        WHEN p.advertised_price < p.prior_advertised_price THEN 'Price Reduction'
        WHEN p.advertised_price > p.prior_advertised_price THEN 'Price Increase'
        ELSE 'Price Unchanged'
    END                                                 AS change_type
FROM paired AS p
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = p.observed_vehicle_key
-- The capture date's calendar key, resolved from the capture rather than carried from
-- the current fact row, so a Removed From Listing row -- which has no current fact
-- row -- still carries the date the comparison was made on instead of a NULL.
JOIN warehouse.dim_date AS d
  ON d.full_date = p.captured_at;

COMMENT ON VIEW reporting.vw_vehicle_listing_change IS
    'Grain: one row per dealership per capture date per observed vehicle present in that capture or the one
immediately before it. Labels every vehicle New Listing, Still Listed, Removed From Listing, Price Increase,
Price Reduction or Price Unchanged. REMOVED FROM LISTING IS NEVER SOLD -- a listing can disappear because
the vehicle sold, was traded, was wholesaled, the feed suppressed it, or somebody erred, and this data
cannot tell those apart, so no sale label exists. New Listing means NEWLY OBSERVED, not newly acquired. When
a store has only one capture the view stays queryable and returns has_prior_snapshot = false rather than an
empty result, because empty reads as "nothing changed".';

COMMENT ON COLUMN reporting.vw_vehicle_listing_change.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listings were assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.snapshot_date_key IS 'Foreign key to reporting.vw_calendar: the capture date the comparison was made on. Resolved from the capture rather than from the current fact row, so a Removed From Listing row -- which has no current observation -- still carries a date rather than a NULL.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.captured_at IS 'The capture date being compared.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.prior_captured_at IS 'The store''s immediately preceding capture date. NULL on the store''s first capture.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.has_prior_snapshot IS 'False on the store''s first capture, where every vehicle is labelled New Listing because observation has just begun. Read it before reading change_type.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.days_between_snapshots IS 'Days between the two captures. NULL on the first capture. Eleven price reductions means something different over one day than over one quarter, so any change count must be read with this.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.observed_vehicle_key IS 'Foreign key to the observed physical vehicle.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.synthetic_vehicle_id IS 'Group-stable ARPI vehicle identity.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.condition_type IS 'New or Used, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.make IS 'Make, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.model IS 'Model, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.trim IS 'Trim, as most recently advertised. NULL means the listing carried none.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.vehicle_display IS 'Year/make/model/trim as the listing worded it.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.odometer_miles IS 'Advertised odometer reading in the current capture. NULL on a Removed From Listing row.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.advertised_price IS 'Advertised price in the current capture. NULL for a call-for-price listing and on a Removed From Listing row.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.prior_advertised_price IS 'Advertised price in the prior capture. NULL for a call-for-price listing and on a New Listing row.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.price_change IS 'KPI-LST-018 input: advertised_price minus prior_advertised_price. Negative is a reduction. NULL whenever either side is absent, so a vehicle moving to or from call-for-price never fabricates a change of the full price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.pricing_status IS 'Listed or Call for price in the current capture.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.prior_pricing_status IS 'Listed or Call for price in the prior capture. A move between the two is visible here rather than hidden in a NULL price_change.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_change.change_type IS 'New Listing | Still Listed | Removed From Listing | Price Increase | Price Reduction | Price Unchanged. THERE IS NO SOLD LABEL AND THERE MUST NEVER BE ONE: this data cannot distinguish a sale from a trade, a wholesale, a feed suppression or an error.';
