-- =============================================================================
-- File:            sql/05_reporting/36_vw_vehicle_listing_price_completeness.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         The listed versus call-for-price distribution by store, condition, make and model, owning the SQL side of KPI-LST-006 at merchandising grain.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per capture date per condition, make and model.
-- =============================================================================
--
-- WHY THIS EXISTS SEPARATELY FROM THE MODEL MIX
-- ---------------------------------------------
-- The mix view answers "what is on the lot"; this one answers "where are we not
-- showing a price". They are the same underlying rows at almost the same grain, and
-- separating them is deliberate: pricing completeness is a MERCHANDISING action item,
-- and an operator asking it does not want to scroll past nine price statistics to
-- find two counts. Trim is dropped from the grain here for the same reason -- the
-- question is answered at model level and answering it at trim level splinters four
-- vehicles into four rows of one.
--
-- WHAT A LOW COMPLETENESS PERCENTAGE MEANS, AND WHAT IT DOES NOT
-- --------------------------------------------------------------
-- It means the public listing showed no price for those vehicles on that capture
-- date. It does NOT mean the store has no price, that the vehicles are unpriced in
-- the DMS, that they are not for sale, or that anything is wrong. Call-for-price is a
-- legitimate merchandising choice for pre-order units, fleet and chassis-cab
-- configurations, and vehicles in transit. The number is a prompt to look, not a
-- finding.
--
-- THE PERCENTAGE IS PUBLISHED AS A RATIO OF TWO PUBLISHED COUNTS
-- --------------------------------------------------------------
-- pricing_completeness_pct is convenience only. listed_price_units and
-- observed_listing_units are both columns, so a consumer aggregating several rows
-- recomputes the ratio from the sums rather than averaging percentages -- which is
-- the single most common way a completeness figure goes wrong.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_price_completeness AS
SELECT
    f.dealership_key                                                    AS dealership_key,
    f.snapshot_date_key                                                 AS snapshot_date_key,
    f.captured_at                                                       AS captured_at,
    v.condition_type                                                    AS condition_type,
    v.make                                                              AS make,
    v.model                                                             AS model,

    sum(f.inventory_unit_count)::bigint                                 AS observed_listing_units,
    count(*) FILTER (WHERE f.pricing_status = 'Listed')::bigint         AS listed_price_units,
    count(*) FILTER (WHERE f.pricing_status = 'Call for price')::bigint AS call_for_price_units,

    -- Convenience only. The two counts above are the authority.
    round(
        100.0 * count(*) FILTER (WHERE f.pricing_status = 'Listed')
        / nullif(sum(f.inventory_unit_count), 0),
        1
    )::numeric(5,1)                                                     AS pricing_completeness_pct,

    coalesce(sum(f.advertised_price), 0)::numeric(14,2)                 AS total_advertised_value,
    avg(f.advertised_price)::numeric(12,2)                              AS average_advertised_price
FROM warehouse.fact_vehicle_listing_snapshot AS f
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = f.observed_vehicle_key
GROUP BY
    f.dealership_key,
    f.snapshot_date_key,
    f.captured_at,
    v.condition_type,
    v.make,
    v.model;

COMMENT ON VIEW reporting.vw_vehicle_listing_price_completeness IS
    'Grain: one row per dealership per capture date per condition, make and model. The listed versus
call-for-price distribution over SANITIZED PUBLIC REFERENCE data. A low percentage means the PUBLIC LISTING
showed no price; it does not mean the store has no price, that the vehicle is not for sale, or that anything
is wrong. Aggregate by summing listed_price_units and observed_listing_units and recomputing the ratio --
never by averaging pricing_completeness_pct.';

COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listings were assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.snapshot_date_key IS 'Foreign key to reporting.vw_calendar: the capture date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.captured_at IS 'The capture date, carried as a date so a report can filter one snapshot without joining the calendar.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.condition_type IS 'New or Used, as advertised. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.make IS 'Advertised make. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.model IS 'Advertised model. Part of the declared grain. Trim is deliberately not part of it: the merchandising question is answered at model level.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.observed_listing_units IS 'Listings observed in this group on this capture date. Denominator of the completeness ratio. SEMI-ADDITIVE: never sum across capture dates.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.listed_price_units IS 'Listings in this group that displayed a price. Numerator of the completeness ratio.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.call_for_price_units IS 'Listings in this group that displayed no price. A legitimate merchandising choice, not a defect.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.pricing_completeness_pct IS 'KPI-LST-006 at this grain, to one decimal place. CONVENIENCE ONLY: recompute from the two counts when aggregating, because averaging percentages across groups of different sizes is wrong.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.total_advertised_value IS 'Sum of the prices ADVERTISED in this group. NOT inventory investment. SEMI-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_price_completeness.average_advertised_price IS 'Mean ADVERTISED price over the priced listings only. NULL when every listing in the group was call-for-price.';
