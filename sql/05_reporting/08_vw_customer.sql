-- =============================================================================
-- File:            sql/05_reporting/08_vw_customer.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly customer view over warehouse.dim_customer, minimised to banded and regional attributes only.
-- Execution order: Reporting layer, after warehouse.dim_customer exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per customer.
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table. One-to-many into vw_vehicle_sales, vw_leads and vw_appointments
-- on customer_key, single direction. customer_key is nullable on those facts (an
-- anonymous lead and a wholesale disposal have no customer), so the semantic model
-- needs a blank-row policy on the relationship rather than a bidirectional filter.
--
-- PRIVACY
-- -------
-- ARPI generates no customer name, address, telephone number, e-mail address,
-- postal code, date of birth, credit score or financial identifier -- not here and
-- not anywhere upstream. Age is published only as a BAND, geography only as county
-- and market area. household_code groups related customers for repeat-purchase
-- analysis; it identifies nobody and is not derived from any real household.
-- PRIVACY_AND_ETHICS.md is the governing document.

CREATE OR REPLACE VIEW reporting.vw_customer AS
SELECT
    c.customer_key                                       AS customer_key,
    c.customer_id                                        AS customer_code,
    c.household_id                                       AS household_code,
    c.age_band                                           AS age_band,
    c.county                                             AS county,
    c.state_code                                         AS state_code,
    c.county || ', ' || c.state_code                     AS county_label,
    c.market_area                                        AS market_area,
    c.customer_type                                      AS customer_type,
    (c.customer_type = 'Business')                       AS is_business,
    c.is_prior_customer                                  AS is_prior_customer,
    c.is_service_customer                                AS is_service_customer,
    c.first_interaction_date                             AS first_interaction_date,
    c.source_system                                      AS source_system
FROM warehouse.dim_customer AS c;

COMMENT ON VIEW reporting.vw_customer IS
    'Grain: one row per customer. Dimension table; relates one-to-many to vw_vehicle_sales, vw_leads and '
    'vw_appointments on customer_key, single direction. customer_key is nullable on those facts, so the '
    'model needs a blank-row policy rather than a bidirectional filter. Deliberately minimised: age is a '
    'band, geography is county and market area, and no name, address, postal code, telephone number, '
    'e-mail address, date of birth, credit score or financial identifier exists anywhere in ARPI. See '
    'PRIVACY_AND_ETHICS.md.';

COMMENT ON COLUMN reporting.vw_customer.customer_key IS 'Warehouse surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_customer.customer_code IS 'Stable, non-identifying customer code. The only customer label ARPI publishes.';
COMMENT ON COLUMN reporting.vw_customer.household_code IS 'Non-identifying grouping code for related customers, used for repeat-purchase analysis. Derived from no real household.';
COMMENT ON COLUMN reporting.vw_customer.age_band IS 'Banded age cohort. The minimised form ARPI publishes; no precise age or date of birth exists.';
COMMENT ON COLUMN reporting.vw_customer.county IS 'County of residence. The finest geography ARPI holds; no street address or postal code exists.';
COMMENT ON COLUMN reporting.vw_customer.state_code IS 'Two-letter state code.';
COMMENT ON COLUMN reporting.vw_customer.county_label IS 'Readable county and state, for example Hillsborough, NH.';
COMMENT ON COLUMN reporting.vw_customer.market_area IS 'Market area the customer falls in.';
COMMENT ON COLUMN reporting.vw_customer.customer_type IS 'Retail or Business.';
COMMENT ON COLUMN reporting.vw_customer.is_business IS 'True for a business buyer. Convenience flag so reports do not compare customer_type strings.';
COMMENT ON COLUMN reporting.vw_customer.is_prior_customer IS 'True when the customer had a prior relationship with the group.';
COMMENT ON COLUMN reporting.vw_customer.is_service_customer IS 'True when the customer is also a service customer.';
COMMENT ON COLUMN reporting.vw_customer.first_interaction_date IS 'Date of the first recorded interaction with the group.';
COMMENT ON COLUMN reporting.vw_customer.source_system IS 'Originating system. Present so no reader mistakes this for real customer data.';
