-- =============================================================================
-- File:            sql/05_reporting/34_vw_vehicle_listing_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed listing aggregate at store and capture date, owning the SQL side of KPI-LST-001..008 and KPI-LST-022.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per capture date.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-LST-001  Observed listing units            observed_listing_units
--   KPI-LST-002  New listing units                 new_listing_units
--   KPI-LST-003  Used listing units                used_listing_units
--   KPI-LST-004  Vehicles with listed price        listed_price_units
--   KPI-LST-005  Call-for-price units              call_for_price_units
--   KPI-LST-006  Pricing completeness percentage   listed_price_units / observed_listing_units
--   KPI-LST-007  Total advertised listing value    total_advertised_value
--   KPI-LST-008  Average advertised price          total_advertised_value / listed_price_units
--   KPI-LST-022  Snapshot freshness                latest_capture_age_days
--
-- EVERY ROW IS ONE AS-OF DATE
-- ---------------------------
-- observed_listing_units and total_advertised_value are additive across store, make,
-- model and vehicle, and are NOT additive across capture dates. Summing a month of
-- rows produces listing-days, which is a different quantity that looks like a
-- plausible unit count and is wrong by roughly the number of captures. Every row here
-- is a single capture date, and a report that spans several must pick one.
--
-- THE NUMERATOR AND THE DENOMINATOR ARE BOTH PUBLISHED
-- -----------------------------------------------------
-- Pricing completeness is listed_price_units over observed_listing_units. Both are
-- columns, so the ratio can be recomputed at any grain the consumer chooses, and a
-- percentage can never be averaged into nonsense.
--
-- WHAT total_advertised_value IS NOT
-- ----------------------------------
-- It is the sum of the prices that were ADVERTISED at one moment. It is not inventory
-- investment, not the value of the assets, not floor-plan exposure and not money the
-- store has. Call-for-price units contribute nothing to it, which is why
-- call_for_price_units sits beside it: a total that excludes some vehicles must show
-- how many it excluded.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_summary AS
WITH store_latest AS (
    SELECT
        f.dealership_key,
        max(f.captured_at) AS latest_captured_at
    FROM warehouse.fact_vehicle_listing_snapshot AS f
    GROUP BY f.dealership_key
)
SELECT
    f.dealership_key                                                    AS dealership_key,
    f.snapshot_date_key                                                 AS snapshot_date_key,
    f.captured_at                                                       AS captured_at,

    -- Semi-additive stock measures. One capture date each.
    sum(f.inventory_unit_count)::bigint                                 AS observed_listing_units,
    sum(f.inventory_unit_count) FILTER (WHERE v.condition_type = 'New')::bigint
                                                                        AS new_listing_units,
    sum(f.inventory_unit_count) FILTER (WHERE v.condition_type = 'Used')::bigint
                                                                        AS used_listing_units,

    -- Pricing completeness, numerator and denominator both published.
    count(*) FILTER (WHERE f.pricing_status = 'Listed')::bigint         AS listed_price_units,
    count(*) FILTER (WHERE f.pricing_status = 'Call for price')::bigint AS call_for_price_units,

    -- Advertised value. NOT inventory investment.
    coalesce(sum(f.advertised_price), 0)::numeric(14,2)                 AS total_advertised_value,
    min(f.advertised_price)                                             AS minimum_advertised_price,
    max(f.advertised_price)                                             AS maximum_advertised_price,

    -- Freshness, so a stale snapshot cannot be read as a current one.
    (max(sl.latest_captured_at) - f.captured_at)                        AS latest_capture_age_days,
    bool_or(f.captured_at = sl.latest_captured_at)                      AS is_latest_snapshot,

    count(DISTINCT f.source_batch_id)::integer                          AS source_batch_count,
    min(f.source_file_name)                                             AS source_file_name
FROM warehouse.fact_vehicle_listing_snapshot AS f
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = f.observed_vehicle_key
JOIN store_latest AS sl
  ON sl.dealership_key = f.dealership_key
GROUP BY f.dealership_key, f.snapshot_date_key, f.captured_at;

COMMENT ON VIEW reporting.vw_vehicle_listing_summary IS
    'Grain: one row per dealership per capture date. Governed listing aggregate over SANITIZED PUBLIC
REFERENCE data. observed_listing_units and total_advertised_value are SEMI-ADDITIVE: additive across store,
make, model and vehicle, never across capture dates. total_advertised_value is the sum of prices ADVERTISED
at one moment -- not inventory investment, not asset value, not money the store has. Pricing completeness is
listed_price_units over observed_listing_units, both published as columns.';

COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listings were assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.snapshot_date_key IS 'Foreign key to reporting.vw_calendar: the capture date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.captured_at IS 'The capture date, carried as a date so a report can filter one snapshot without joining the calendar.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.observed_listing_units IS 'KPI-LST-001. Listings OBSERVED at this store on this capture date. Not units in stock and not units owned. SEMI-ADDITIVE: never sum across capture dates.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.new_listing_units IS 'KPI-LST-002. Observed listings whose advertised condition is New. SEMI-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.used_listing_units IS 'KPI-LST-003. Observed listings whose advertised condition is Used. SEMI-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.listed_price_units IS 'KPI-LST-004, and the numerator of KPI-LST-006. Observed listings that displayed a price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.call_for_price_units IS 'KPI-LST-005. Observed listings that displayed no price. These contribute nothing to total_advertised_value, which is why the count sits beside it.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.total_advertised_value IS 'KPI-LST-007. Sum of the prices ADVERTISED on this capture date. NOT inventory investment, NOT asset value, NOT floor-plan exposure, NOT gross. SEMI-ADDITIVE: never sum across capture dates.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.minimum_advertised_price IS 'Lowest advertised price on this capture date. NULL when every listing was call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.maximum_advertised_price IS 'Highest advertised price on this capture date. NULL when every listing was call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.latest_capture_age_days IS 'KPI-LST-022. Days between this capture date and the store''s newest capture. Zero on the newest row. This is SNAPSHOT FRESHNESS -- it is not days in stock and not days on lot.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.is_latest_snapshot IS 'True on the store''s newest capture date. Filter on it to report one honest as-of position.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.source_batch_count IS 'Distinct capture batches contributing to this row. One workbook is one batch, so anything but 1 means a snapshot was assembled from several files.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_summary.source_file_name IS 'The committed workbook file name behind this capture, exactly as it appears in the repository.';
