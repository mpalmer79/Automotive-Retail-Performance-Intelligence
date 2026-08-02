-- =============================================================================
-- File:            sql/05_reporting/35_vw_vehicle_listing_model_mix.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Observed listing mix by condition, make, model and trim, owning the SQL side of KPI-LST-009..013.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_listing_snapshot exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per capture date per condition, make, model and trim.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-LST-009  Average advertised price   total_advertised_value / listed_price_units
--   KPI-LST-010  Minimum advertised price   minimum_advertised_price
--   KPI-LST-011  Maximum advertised price   maximum_advertised_price
--   KPI-LST-012  Model mix percentage       observed_listing_units / snapshot_listing_units
--   KPI-LST-013  Trim mix percentage        observed_listing_units / model_listing_units
--
-- MIX PERCENTAGES CARRY THEIR OWN DENOMINATORS
-- --------------------------------------------
-- A mix percentage is only meaningful against a stated whole, and the two wholes a
-- reader actually wants are different: "what share of the store's listings is this
-- model" and "what share of this model's listings is this trim". Both denominators
-- are published as columns -- snapshot_listing_units and model_listing_units -- so
-- neither ratio can be computed against the wrong one, and neither can be averaged
-- across rows into a number that means nothing.
--
-- TRIM IS A GRAIN COLUMN AND IS NULLABLE
-- --------------------------------------
-- A listing may carry no trim. Those rows group together under a NULL trim rather
-- than being folded into the model total or dropped, because "twelve of these have no
-- advertised trim" is itself a merchandising observation.
--
-- AVERAGE PRICE EXCLUDES CALL-FOR-PRICE UNITS, DELIBERATELY
-- ---------------------------------------------------------
-- average_advertised_price divides by listed_price_units, not by observed_listing_units.
-- Dividing by the larger number would silently treat a call-for-price vehicle as
-- costing zero and pull every average down. Both counts are published so the exclusion
-- is visible on the row rather than buried in a formula.

CREATE OR REPLACE VIEW reporting.vw_vehicle_listing_model_mix AS
SELECT
    f.dealership_key                                                    AS dealership_key,
    f.snapshot_date_key                                                 AS snapshot_date_key,
    f.captured_at                                                       AS captured_at,
    v.condition_type                                                    AS condition_type,
    v.make                                                              AS make,
    v.model                                                             AS model,
    v.trim                                                              AS trim,

    sum(f.inventory_unit_count)::bigint                                 AS observed_listing_units,
    count(*) FILTER (WHERE f.pricing_status = 'Listed')::bigint         AS listed_price_units,
    count(*) FILTER (WHERE f.pricing_status = 'Call for price')::bigint AS call_for_price_units,

    coalesce(sum(f.advertised_price), 0)::numeric(14,2)                 AS total_advertised_value,
    avg(f.advertised_price)::numeric(12,2)                              AS average_advertised_price,
    min(f.advertised_price)                                             AS minimum_advertised_price,
    max(f.advertised_price)                                             AS maximum_advertised_price,
    avg(f.odometer_miles)::numeric(12,1)                                AS average_odometer_miles,

    -- The two denominators, published rather than left to the consumer to guess.
    sum(sum(f.inventory_unit_count)) OVER (
        PARTITION BY f.dealership_key, f.snapshot_date_key
    )::bigint                                                           AS snapshot_listing_units,
    sum(sum(f.inventory_unit_count)) OVER (
        PARTITION BY f.dealership_key, f.snapshot_date_key,
                     v.condition_type, v.make, v.model
    )::bigint                                                           AS model_listing_units
FROM warehouse.fact_vehicle_listing_snapshot AS f
JOIN warehouse.dim_observed_vehicle AS v
  ON v.observed_vehicle_key = f.observed_vehicle_key
GROUP BY
    f.dealership_key,
    f.snapshot_date_key,
    f.captured_at,
    v.condition_type,
    v.make,
    v.model,
    v.trim;

COMMENT ON VIEW reporting.vw_vehicle_listing_model_mix IS
    'Grain: one row per dealership per capture date per condition, make, model and trim. Observed listing
mix over SANITIZED PUBLIC REFERENCE data. Both mix denominators are published as columns
(snapshot_listing_units, model_listing_units) so a percentage cannot be computed against the wrong whole.
average_advertised_price divides by listed_price_units, so a call-for-price unit is excluded rather than
counted as zero. Unit counts are SEMI-ADDITIVE: never sum across capture dates.';

COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.dealership_key IS 'Foreign key to reporting.vw_dealership: the store the listings were assigned to.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.snapshot_date_key IS 'Foreign key to reporting.vw_calendar: the capture date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.captured_at IS 'The capture date, carried as a date so a report can filter one snapshot without joining the calendar.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.condition_type IS 'New or Used, as advertised. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.make IS 'Advertised make. Part of the declared grain. A franchise store legitimately lists used units of other makes.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.model IS 'Advertised model. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.trim IS 'Advertised trim. Part of the declared grain, and NULLABLE: a listing carrying no trim groups under NULL rather than being folded into the model total.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.observed_listing_units IS 'Listings observed in this group on this capture date. Numerator of KPI-LST-012 and KPI-LST-013. SEMI-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.listed_price_units IS 'Listings in this group that displayed a price. Denominator of KPI-LST-009.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.call_for_price_units IS 'Listings in this group that displayed no price, and are therefore excluded from every price statistic on this row.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.total_advertised_value IS 'Sum of the prices ADVERTISED in this group. NOT inventory investment and NOT asset value. SEMI-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.average_advertised_price IS 'KPI-LST-009. Mean of the ADVERTISED prices, over listed_price_units only. NULL when every listing in the group was call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.minimum_advertised_price IS 'KPI-LST-010. Lowest advertised price in the group. NULL when every listing was call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.maximum_advertised_price IS 'KPI-LST-011. Highest advertised price in the group. NULL when every listing was call-for-price.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.average_odometer_miles IS 'Mean ADVERTISED odometer reading in the group. Not a verified reading and not a title record.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.snapshot_listing_units IS 'Denominator of KPI-LST-012: every listing the store showed on this capture date.';
COMMENT ON COLUMN reporting.vw_vehicle_listing_model_mix.model_listing_units IS 'Denominator of KPI-LST-013: every listing of this condition, make and model on this capture date, across all trims.';
