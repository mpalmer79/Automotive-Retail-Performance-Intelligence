-- =============================================================================
-- File:            sql/05_reporting/33_vw_vehicle_listing_current.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         The latest observed listing for each dealership and observed vehicle, at the listing fact's own grain.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot and warehouse.dim_observed_vehicle exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per observed vehicle: the most recent capture of that vehicle at that store.
-- =============================================================================
--
-- "CURRENT" MEANS "MOST RECENTLY OBSERVED", NOT "IN STOCK"
-- --------------------------------------------------------
-- This view answers "what did we last see advertised?". It does not answer "what is
-- on the ground today". A vehicle whose last capture was three months ago still
-- appears here, with last_captured_at three months old, because that IS the last
-- observation. snapshot_age_days is published on every row so a reader cannot mistake
-- a stale observation for a current one, and is_latest_snapshot marks the rows that
-- came from the newest capture the store has.
--
-- WHY THE ADVERTISED PRICE IS NOT TOTALLED HERE
-- ---------------------------------------------
-- Rows on this view can come from different capture dates, so their advertised
-- prices belong to different moments. Summing them produces a number with no as-of
-- date. Use reporting.vw_vehicle_listing_summary, which is grained by capture date
-- and can be totalled honestly.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_current AS
WITH latest AS (
    SELECT
        f.*,
        row_number() OVER (
            PARTITION BY f.dealership_key, f.observed_vehicle_key
            ORDER BY f.captured_at DESC, f.vehicle_listing_snapshot_key DESC
        ) AS recency_rank,
        max(f.captured_at) OVER (PARTITION BY f.dealership_key) AS store_latest_captured_at
    FROM warehouse.fact_vehicle_listing_snapshot AS f
)
SELECT
    l.dealership_key                                             AS dealership_key,
    l.observed_vehicle_key                                       AS observed_vehicle_key,
    l.snapshot_date_key                                          AS snapshot_date_key,
    l.captured_at                                                AS last_captured_at,
    (l.store_latest_captured_at - l.captured_at)                 AS snapshot_age_days,
    (l.captured_at = l.store_latest_captured_at)                 AS is_latest_snapshot,
    v.synthetic_vehicle_id                                       AS synthetic_vehicle_id,
    v.synthetic_vin                                              AS synthetic_vin,
    v.condition_type                                             AS condition_type,
    v.model_year                                                 AS model_year,
    v.make                                                       AS make,
    v.model                                                      AS model,
    v.trim                                                       AS trim,
    v.vehicle_display                                            AS vehicle_display,
    l.odometer_miles                                             AS odometer_miles,
    l.advertised_price                                           AS advertised_price,
    l.pricing_status                                             AS pricing_status,
    l.inventory_unit_count                                       AS inventory_unit_count,
    v.first_observed_at                                          AS first_observed_at,
    v.last_observed_at                                           AS last_observed_at,
    l.source_batch_id                                            AS source_batch_id,
    l.source_file_name                                           AS source_file_name,
    l.source_system                                              AS source_system
FROM latest AS l
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = l.observed_vehicle_key
WHERE l.recency_rank = 1;

COMMENT ON VIEW reporting.vw_vehicle_listing_current IS
    'Grain: one row per dealership per observed vehicle -- the MOST RECENT capture of that vehicle at that
store. "Current" means most recently OBSERVED, not in stock and not owned: a vehicle whose last capture is
old still appears, and snapshot_age_days says how old. Do not total advertised_price here; rows can come
from different capture dates. Sanitized public reference data.';

COMMENT ON COLUMN reporting.vw_vehicle_listing_current.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listing was assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.observed_vehicle_key IS 'Foreign key to the observed physical vehicle. Not warehouse.dim_vehicle: this source cannot prove ownership.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.snapshot_date_key IS 'Foreign key to reporting.vw_calendar: the date of the most recent capture of this vehicle at this store.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.last_captured_at IS 'Date of the most recent capture of this vehicle at this store. Not a sale date and not a disposition date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.snapshot_age_days IS 'Days between this row''s capture and the store''s newest capture. Zero means the row came from the newest snapshot. NOT days in stock and NOT days on lot.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.is_latest_snapshot IS 'True when this observation came from the store''s newest capture. Filter on it to answer "what was advertised at the last look".';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.synthetic_vehicle_id IS 'Group-stable ARPI vehicle identity. The same physical vehicle carries the same value at every store.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.synthetic_vin IS 'ARPI-prefixed synthetic VIN. Never a real VIN.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.condition_type IS 'New or Used, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.model_year IS 'Model year, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.make IS 'Make, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.model IS 'Model, as most recently advertised.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.trim IS 'Trim, as most recently advertised. NULL means the listing carried none.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.vehicle_display IS 'Year/make/model/trim as the listing worded it.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.odometer_miles IS 'Advertised odometer reading at the most recent capture. NULL means the listing published no mileage, which is not a zero reading. NON-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.advertised_price IS 'Advertised price at the most recent capture. NOT transaction price, acquisition cost, inventory investment, MSRP or gross. NULL for a call-for-price listing.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.pricing_status IS 'Listed, Call for price, or Price not exposed at the most recent capture. The last two both mean advertised_price is NULL and are not interchangeable: one records a displayed merchandising choice, the other records that the source published no price field.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.inventory_unit_count IS 'Always 1. Sum it across vehicles to count observed listings at one store; never sum across capture dates.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.first_observed_at IS 'Earliest capture on which this vehicle appeared anywhere. NOT an acquisition date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.last_observed_at IS 'Latest capture on which this vehicle appeared anywhere. NOT a sale date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.source_batch_id IS 'Capture-batch identifier of the most recent observation.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.source_file_name IS 'The committed workbook file name the observation came from, exactly as it appears in the repository.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_current.source_system IS 'Originating system; arpi_sanitized_public_reference for this lane.';
