-- =============================================================================
-- File:            sql/05_reporting/37_vw_vehicle_listing_observation_span.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         How long each observed vehicle has been seen online, owning the SQL side of KPI-LST-019..021.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per observed vehicle.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-LST-019  First observed date    first_observed_at
--   KPI-LST-020  Last observed date     last_observed_at
--   KPI-LST-021  Days observed online   days_observed_online
--
-- DAYS OBSERVED ONLINE IS NOT DAYS IN STOCK
-- -----------------------------------------
-- This is the single most important sentence about this view, and the column is named
-- to make the substitution hard to make by accident.
--
--   days_observed_online = last_observed_at - first_observed_at
--
-- It measures the span between the FIRST and LAST captures in which a listing was
-- visible. It is bounded below by the capture cadence -- a vehicle seen in exactly
-- one snapshot has a span of zero days, which means "seen once", not "listed for no
-- time" -- and bounded above by when observation started, which is not when the
-- vehicle arrived.
--
-- Days in stock is a different measure entirely: it runs from ACQUISITION, it is
-- recorded by the DMS, and ARPI's owned-inventory fact carries it as
-- warehouse.fact_vehicle_inventory_snapshot.days_in_stock. Nothing in this lane can
-- produce it, because nothing in this lane knows when the store bought the vehicle.
--
-- snapshot_count IS PUBLISHED BESIDE THE SPAN, AND MUST BE READ WITH IT
-- ---------------------------------------------------------------------
-- A span of 30 days built from two captures 30 days apart tells you almost nothing
-- about the 29 days between them: the listing may have vanished and returned. A span
-- of 30 days built from 30 daily captures is a genuine continuous observation. The
-- two are indistinguishable from the span alone, so snapshot_count and
-- observation_gap_days sit next to it and any report using one must show the others.
--
-- A VEHICLE THAT STOPPED APPEARING WAS REMOVED FROM LISTING
-- ---------------------------------------------------------
-- is_currently_listed is true when the vehicle appeared in the store's newest
-- capture. False means REMOVED FROM LISTING as at that capture. It does not mean
-- sold, and there is deliberately no column on this view that could be read as a
-- sale.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_observation_span AS
WITH store_latest AS (
    SELECT
        f.dealership_key,
        max(f.captured_at) AS latest_captured_at
    FROM warehouse.fact_vehicle_listing_snapshot AS f
    GROUP BY f.dealership_key
),
spans AS (
    SELECT
        f.dealership_key,
        f.observed_vehicle_key,
        min(f.captured_at)                     AS first_observed_at,
        max(f.captured_at)                     AS last_observed_at,
        count(*)::integer                      AS snapshot_count,
        count(DISTINCT f.captured_at)::integer AS distinct_capture_dates,
        min(f.advertised_price)                AS lowest_advertised_price,
        max(f.advertised_price)                AS highest_advertised_price,
        count(*) FILTER (WHERE f.pricing_status = 'Call for price')::integer
                                               AS call_for_price_snapshots
    FROM warehouse.fact_vehicle_listing_snapshot AS f
    GROUP BY f.dealership_key, f.observed_vehicle_key
)
SELECT
    s.dealership_key                                          AS dealership_key,
    s.observed_vehicle_key                                    AS observed_vehicle_key,
    v.synthetic_vehicle_id                                    AS synthetic_vehicle_id,
    v.condition_type                                          AS condition_type,
    v.make                                                    AS make,
    v.model                                                   AS model,
    v.trim                                                    AS trim,
    v.vehicle_display                                         AS vehicle_display,

    s.first_observed_at                                       AS first_observed_at,
    s.last_observed_at                                        AS last_observed_at,
    s.snapshot_count                                          AS snapshot_count,
    s.distinct_capture_dates                                  AS distinct_capture_dates,
    (s.last_observed_at - s.first_observed_at)                AS days_observed_online,
    (s.last_observed_at - s.first_observed_at)
        - (s.distinct_capture_dates - 1)                      AS observation_gap_days,

    (s.last_observed_at = sl.latest_captured_at)              AS is_currently_listed,
    (sl.latest_captured_at - s.last_observed_at)              AS days_since_last_observed,

    s.lowest_advertised_price                                 AS lowest_advertised_price,
    s.highest_advertised_price                                AS highest_advertised_price,
    s.call_for_price_snapshots                                AS call_for_price_snapshots
FROM spans AS s
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = s.observed_vehicle_key
JOIN store_latest AS sl
  ON sl.dealership_key = s.dealership_key;

COMMENT ON VIEW reporting.vw_vehicle_listing_observation_span IS
    'Grain: one row per dealership per observed vehicle. How long each vehicle has been SEEN ONLINE, over
SANITIZED PUBLIC REFERENCE data. days_observed_online IS NOT DAYS IN STOCK: it is the span between the first
and last captures in which a listing was visible, it starts when observation started rather than when the
vehicle arrived, and it is bounded by the capture cadence. Read it only together with snapshot_count and
observation_gap_days. is_currently_listed false means REMOVED FROM LISTING, never sold.';

COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listings were assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.observed_vehicle_key IS 'Foreign key to the observed physical vehicle. Not warehouse.dim_vehicle: this source cannot prove ownership.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.synthetic_vehicle_id IS 'Group-stable ARPI vehicle identity. The same value at every store, so the same vehicle observed at two stores produces two rows that can be matched.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.condition_type IS 'New or Used, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.make IS 'Make, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.model IS 'Model, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.trim IS 'Trim, as most recently advertised. NULL means the listing carried none.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.vehicle_display IS 'Year/make/model/trim as the listing worded it.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.first_observed_at IS 'KPI-LST-019. Earliest capture in which this vehicle was seen at this store. NOT an acquisition date and NOT the date the vehicle arrived; it is bounded below by when observation began.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.last_observed_at IS 'KPI-LST-020. Latest capture in which this vehicle was seen at this store. NOT a sale date and NOT a disposition date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.snapshot_count IS 'Number of fact rows behind this span. A span built from two captures is not the same evidence as a span built from thirty, and this is how a reader tells them apart.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.distinct_capture_dates IS 'Distinct capture dates on which this vehicle was seen. Equals snapshot_count unless one capture produced two rows, which the fact grain forbids.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.days_observed_online IS 'KPI-LST-021. last_observed_at minus first_observed_at, in days. THIS IS NOT DAYS IN STOCK. Days in stock runs from acquisition and lives on warehouse.fact_vehicle_inventory_snapshot; this lane cannot produce it. Zero means the vehicle was seen in exactly one capture.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.observation_gap_days IS 'Days inside the span on which no capture saw this vehicle. Greater than zero means the observation is not continuous and the span overstates how long the listing was actually visible.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.is_currently_listed IS 'True when the vehicle appeared in the store''s newest capture. FALSE MEANS REMOVED FROM LISTING AS AT THAT CAPTURE -- it does not mean sold, traded, wholesaled or anything else this data cannot distinguish.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.days_since_last_observed IS 'Days between this vehicle''s last observation and the store''s newest capture. Zero when still listed.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.lowest_advertised_price IS 'Lowest price ever ADVERTISED for this vehicle across its observations. NULL when it was always call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.highest_advertised_price IS 'Highest price ever ADVERTISED for this vehicle across its observations. NULL when it was always call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_observation_span.call_for_price_snapshots IS 'Number of this vehicle''s observations that displayed no price. A vehicle that moves between priced and call-for-price is visible here rather than hidden in a NULL.';
