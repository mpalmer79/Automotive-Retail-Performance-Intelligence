-- =============================================================================
-- File:            sql/03_dimensions/05_dim_customer.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_customer, the conformed customer dimension.
-- Execution order: 36 of 66 — after the dimensions it references, before sql/03_dimensions/15_dim_customer_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per synthetic customer.
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 12 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.
--
-- PRIVACY: no name, date of birth, street address, e-mail, telephone number,
-- social security number, driving licence, bank account, payment card, credit
-- score, protected characteristic or free-text note exists on this entity.

CREATE TABLE IF NOT EXISTS warehouse.dim_customer (
    customer_key            integer       NOT NULL,
    customer_id             varchar(16)   NOT NULL,
    household_id            varchar(16)   NOT NULL,
    age_band                varchar(20)   NOT NULL,
    county                  varchar(40)   NOT NULL,
    state_code              char(2)       NOT NULL,
    market_area             varchar(40)   NOT NULL,
    customer_type           varchar(20)   NOT NULL,
    is_prior_customer       boolean       NOT NULL,
    is_service_customer     boolean       NOT NULL,
    first_interaction_date  date          NOT NULL,
    source_system           varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_customer
        PRIMARY KEY (customer_key),
    CONSTRAINT uq_dim_customer_customer_id
        UNIQUE (customer_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_customer_key_positive
        CHECK (customer_key > 0),
    CONSTRAINT ck_dim_customer_age_band_domain
        CHECK (age_band IN ('18-24', '25-34', '35-44', '45-54', '55-64', '65+')),
    CONSTRAINT ck_dim_customer_county_domain
        CHECK (county IN ('Hillsborough', 'Rockingham', 'Merrimack', 'Strafford', 'Middlesex', 'Essex')),
    CONSTRAINT ck_dim_customer_state_code_format
        CHECK (state_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_dim_customer_market_area_domain
        CHECK (market_area IN ('Southern New Hampshire', 'Northern Massachusetts')),
    CONSTRAINT ck_dim_customer_customer_type_domain
        CHECK (customer_type IN ('Retail', 'Business')),
    CONSTRAINT ck_dim_customer_customer_id_not_blank
        CHECK (btrim(customer_id) <> ''),
    CONSTRAINT ck_dim_customer_source_system_not_blank
        CHECK (btrim(source_system) <> '')
);

COMMENT ON TABLE warehouse.dim_customer IS
    'Grain: one row per synthetic customer. Loaded exclusively by 
sql/03_dimensions/15_dim_customer_merge.sql from staging.stg_customer. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_customer.customer_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(customer_key) + row_number() ordered by customer_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_customer.customer_id IS 'Natural key, CUS-######## (contract section 5).';
COMMENT ON COLUMN warehouse.dim_customer.household_id IS 'Synthetic household grouping, HH-########. Links related customers without naming anybody.';
COMMENT ON COLUMN warehouse.dim_customer.age_band IS 'Banded age cohort. Exact age and date of birth are prohibited.';
COMMENT ON COLUMN warehouse.dim_customer.county IS 'County of residence. Geography deliberately stops here; no street address exists.';
COMMENT ON COLUMN warehouse.dim_customer.state_code IS 'Two-letter state code; NH or MA.';
COMMENT ON COLUMN warehouse.dim_customer.market_area IS 'Coarse market area the county belongs to.';
COMMENT ON COLUMN warehouse.dim_customer.customer_type IS 'Retail | Business.';
COMMENT ON COLUMN warehouse.dim_customer.is_prior_customer IS 'Whether the customer had transacted with the group before.';
COMMENT ON COLUMN warehouse.dim_customer.is_service_customer IS 'Whether the customer is known to the service department.';
COMMENT ON COLUMN warehouse.dim_customer.first_interaction_date IS 'Date of the first recorded interaction with the group.';
COMMENT ON COLUMN warehouse.dim_customer.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
