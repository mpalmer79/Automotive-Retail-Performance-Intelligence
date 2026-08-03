-- =============================================================================
-- File:            sql/05_reporting/02_vw_dealership.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly store view exposing only the current SCD Type 2 version of each dealership.
-- Execution order: 14 of 25 — after warehouse.dim_dealership exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership store (the current version only).
-- =============================================================================
--
-- Why current rows only: a report slicer must offer each store exactly once. The
-- Type 2 plumbing (expiration_date, attribute_hash, historical versions) is a
-- warehouse concern and is deliberately not exposed here — a report author who
-- filtered on it by accident would double-count every store. When point-in-time
-- store attributes are needed, facts will join to warehouse.dim_dealership on the
-- surrogate key that was in force at the time, not to this view.
--
-- attribute_hash is intentionally omitted: it is an ETL change-detection value
-- with no business meaning.
--
-- Privacy: this view exposes no street address, telephone number or e-mail
-- address, because no such column exists anywhere in the model.

CREATE OR REPLACE VIEW reporting.vw_dealership AS
SELECT
    d.dealership_key                                     AS dealership_key,
    d.dealership_id                                      AS dealership_code,
    d.store_name                                         AS store_name,
    d.store_short_name                                   AS store_short_name,
    d.store_type                                         AS store_type,
    d.franchise_brand                                    AS franchise_brand,
    coalesce(d.franchise_brand, 'Independent')           AS brand_label,
    (d.store_type = 'Franchise New and Used')            AS is_franchise_store,
    d.city                                               AS city,
    d.state_code                                         AS state_code,
    d.market_region                                      AS market_region,
    d.city || ', ' || d.state_code                       AS location_label,
    d.opened_date                                        AS opened_date,
    d.is_active                                          AS is_active,
    d.effective_date                                     AS version_effective_date,
    d.source_system                                      AS source_system
FROM warehouse.dim_dealership AS d
WHERE d.is_current;

COMMENT ON VIEW reporting.vw_dealership IS
    'Grain: one row per dealership store, restricted to the current SCD Type 2 version '
    '(warehouse.dim_dealership.is_current). Exactly three rows in Phase 0, one per Granite Auto '
    'Group store. SCD plumbing (expiration_date, is_current, attribute_hash, superseded versions) is '
    'deliberately not exposed so that a report cannot double-count a store. Contains no personal data.';

COMMENT ON COLUMN reporting.vw_dealership.dealership_key IS 'Warehouse surrogate key of the current version. Join key for facts that carry the current store key.';
COMMENT ON COLUMN reporting.vw_dealership.dealership_code IS 'Stable store code from the source system, for example GSA-001.';
COMMENT ON COLUMN reporting.vw_dealership.store_name IS 'Full store name.';
COMMENT ON COLUMN reporting.vw_dealership.store_short_name IS 'Short store name. Preferred label for slicers, chart axes and Excel headers.';
COMMENT ON COLUMN reporting.vw_dealership.store_type IS 'Franchise New and Used, or Independent Used.';
COMMENT ON COLUMN reporting.vw_dealership.franchise_brand IS 'Franchise brand, or NULL for an independent used store.';
COMMENT ON COLUMN reporting.vw_dealership.brand_label IS 'Never-NULL display label: the franchise brand, or the word Independent.';
COMMENT ON COLUMN reporting.vw_dealership.is_franchise_store IS 'True for a franchise new-and-used store. Convenience flag so reports do not compare store_type strings.';
COMMENT ON COLUMN reporting.vw_dealership.city IS 'Store city.';
COMMENT ON COLUMN reporting.vw_dealership.state_code IS 'Two-letter state code.';
COMMENT ON COLUMN reporting.vw_dealership.market_region IS 'Market region the store competes in.';
COMMENT ON COLUMN reporting.vw_dealership.location_label IS 'Readable location, for example Nashua, NH.';
COMMENT ON COLUMN reporting.vw_dealership.opened_date IS 'Date the store opened for business.';
COMMENT ON COLUMN reporting.vw_dealership.is_active IS 'True while the store is trading.';
COMMENT ON COLUMN reporting.vw_dealership.version_effective_date IS 'Start date of the current attribute version. Exposed so an analyst can see when the store record last changed.';
COMMENT ON COLUMN reporting.vw_dealership.source_system IS 'Originating system; arpi_synthetic_generator in Phase 0. Present so no reader mistakes this for real dealer data.';
