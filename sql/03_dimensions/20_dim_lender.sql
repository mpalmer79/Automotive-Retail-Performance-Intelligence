-- =============================================================================
-- File:            sql/03_dimensions/20_dim_lender.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_lender, the fictional lender classification dimension.
-- Execution order: Dimension layer, after the conformed dimensions, before sql/03_dimensions/22_dim_lender_merge.sql and before the sale fact resolves lender_key.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per fictional lender definition.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-018-dim-lender.md.
-- Delivery increment: DASH.6.
--
-- THIS IS AN ANALYTICAL CLASSIFICATION. IT IS NOT A LENDING MODEL.
-- ----------------------------------------------------------------
-- ARPI does not approve, decline, tier, price, desk or recommend anything. Nowhere in
-- this lane is there an APR, a buy rate, a sell rate, a rate spread, a money factor, a
-- payment, a loan term, an approval status, a stipulation, an adverse-action reason, a
-- credit score, a credit file, an income figure or a debt-to-income ratio -- not as a
-- column, not as a generation parameter, and not as a value derived from one. DQ-LND-007
-- inspects the SCHEMA for that vocabulary, so adding one fails the run rather than the
-- code review, and the platform-wide privacy tripwire was extended by DASH.6 with the
-- same names.
--
-- WHAT program_tier MEANS, AND WHAT IT DOES NOT
-- ---------------------------------------------
-- It describes the kind of business a FICTIONAL LENDER'S PROGRAM is written for, in
-- exactly the way "Credit Union" does. IT IS NOT A CUSTOMER'S CREDIT TIER and cannot
-- become one: no ARPI entity carries a customer credit attribute of any kind, so there
-- is nothing for a tier to be derived from. Lender assignment depends on the store, the
-- derived finance structure and seeded randomness, and on nothing about any person.
--
-- EVERY IDENTITY IS FICTIONAL
-- ---------------------------
-- No real bank, captive finance arm, credit union or finance company is named, and no
-- name may be chosen to resemble one. DQ-LND-002 closes the set to the generated
-- catalogue, and tests/unit/test_fi_privacy.py additionally asserts that no committed
-- lender name collides with a list of real institutions -- a synthetic-catalogue contract
-- test, deliberately NOT a claim to detect every real lender in the world.
--
-- SCD POLICY: TYPE 1 (ADR-0006), for the same reason as dim_finance_product.
--
-- PRIVACY: no personal data. A lender row describes an institution that does not exist.

CREATE TABLE IF NOT EXISTS warehouse.dim_lender (
    lender_key         integer      NOT NULL,
    lender_id          varchar(16)  NOT NULL,
    lender_name        varchar(80)  NOT NULL,
    lender_category    varchar(40)  NOT NULL,
    program_tier       varchar(20)  NOT NULL,
    active_start_date  date         NOT NULL,
    active_end_date    date         NOT NULL,
    is_active          boolean      NOT NULL,
    source_system      varchar(40)  NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_lender
        PRIMARY KEY (lender_key),
    CONSTRAINT uq_dim_lender_lender_id
        UNIQUE (lender_id),
    CONSTRAINT uq_dim_lender_lender_name
        UNIQUE (lender_name),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_lender_key_positive
        CHECK (lender_key > 0),
    CONSTRAINT ck_dim_lender_id_not_blank
        CHECK (btrim(lender_id) <> ''),
    CONSTRAINT ck_dim_lender_category_domain
        CHECK (lender_category IN
            ('Captive', 'Bank', 'Credit Union', 'Independent Finance Company')),
    -- Closed deliberately: an open vocabulary would eventually admit a value that reads
    -- like a credit grade -- 'A+', 'Tier 3' -- and a reader would take it for one.
    CONSTRAINT ck_dim_lender_program_tier_domain
        CHECK (program_tier IN ('Prime', 'Near-prime', 'Subprime')),
    CONSTRAINT ck_dim_lender_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_dim_lender_active_window_ordered
        CHECK (active_end_date >= active_start_date),
    CONSTRAINT ck_dim_lender_is_active_derivation
        CHECK (is_active = (active_end_date = DATE '9999-12-31'))
);

CREATE INDEX IF NOT EXISTS ix_dim_lender_category
    ON warehouse.dim_lender (lender_category);

COMMENT ON TABLE warehouse.dim_lender IS
    'Grain: one row per FICTIONAL lender definition. SCD TYPE 1 (ADR-0006). AN ANALYTICAL '
    'CLASSIFICATION, NOT A LENDING MODEL: ARPI approves nothing, declines nothing, tiers no customer, '
    'prices nothing and recommends nothing, and this lane carries NO apr, buy rate, sell rate, rate '
    'spread, money factor, payment, loan term, approval status, stipulation, adverse-action reason, '
    'credit score, credit file, income or debt-to-income figure -- DQ-LND-007 checks the schema for that '
    'vocabulary. program_tier classifies the FICTIONAL LENDER''S PROGRAM and is NEVER a customer''s '
    'credit tier: no ARPI entity carries a customer credit attribute, so there is nothing for a tier to '
    'be derived from. EVERY LENDER NAME IS INVENTED and no real financial institution is named. Lender '
    'assignment on a deal depends on the store, the derived finance structure and seeded randomness, '
    'and on nothing about any person. Loaded exclusively by sql/03_dimensions/22_dim_lender_merge.sql. '
    'Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_lender.lender_key IS 'Primary key. Warehouse-assigned surrogate key, assigned by the merge as max(key) + row_number() ordered by lender_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_lender.lender_id IS 'Natural key, LND-###. Unique. What warehouse.fact_vehicle_sale.lender_key resolves through.';
COMMENT ON COLUMN warehouse.dim_lender.lender_name IS 'INVENTED institution label. Names a fictional business that does not exist -- never a person, and never a real bank, captive, credit union or finance company. DQ-LND-002 closes the set to the generated catalogue.';
COMMENT ON COLUMN warehouse.dim_lender.lender_category IS 'Captive, Bank, Credit Union or Independent Finance Company. Classifies the fictional institution.';
COMMENT ON COLUMN warehouse.dim_lender.program_tier IS 'Prime, Near-prime or Subprime. CLASSIFIES THE FICTIONAL LENDER''S PROGRAM AND NEVER A CUSTOMER. It is not a credit score, not a credit tier, not an approval result and not an adverse-action reason, and nothing in ARPI derives it from any credit datum, because none exists.';
COMMENT ON COLUMN warehouse.dim_lender.active_start_date IS 'First date the lender''s program was available. An attribute of the lender, NOT an SCD Type 2 effective date: this table keeps no row history.';
COMMENT ON COLUMN warehouse.dim_lender.active_end_date IS 'Last date available, or the 9999-12-31 open-ended sentinel.';
COMMENT ON COLUMN warehouse.dim_lender.is_active IS 'DERIVED from active_end_date by ck_dim_lender_is_active_derivation, never assigned independently.';
COMMENT ON COLUMN warehouse.dim_lender.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops an invented lender panel being read as a real one.';
