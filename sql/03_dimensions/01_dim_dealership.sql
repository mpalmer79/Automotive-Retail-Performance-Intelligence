-- =============================================================================
-- File:            sql/03_dimensions/01_dim_dealership.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_dealership, the SCD Type 2 store dimension for Granite State Auto Group.
-- Execution order: 9 of 25 — after warehouse.dim_date, before sql/03_dimensions/11_dim_dealership_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE UNIQUE INDEX IF NOT EXISTS and COMMENTs.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per dealership store version (SCD Type 2). Exactly one row per store has is_current = true.
-- =============================================================================
--
-- Column contract: ARPI cross-agent contract section 8 — 16 columns, exact names,
-- exact order, exact types.
--
-- SCD Type 2 model (ARCHITECTURE.md section 14):
--   * Versions tile the timeline: effective_date .. expiration_date inclusive,
--     with no gap and no overlap for a given dealership_id.
--   * The open-ended sentinel is 9999-12-31 and is_current is kept in lock step
--     with it by ck_dim_dealership_current_flag_matches_sentinel. is_current is a
--     convenience flag, never an independent source of truth.
--   * Change detection uses attribute_hash over the Type 2 tracked attributes
--     (columns 3-11: store_name, store_short_name, store_type, franchise_brand,
--     city, state_code, market_region, opened_date, is_active).
--
-- Privacy: no street address, telephone number or e-mail address exists on this
-- dimension, by design. Geography stops at city and market region.

CREATE TABLE IF NOT EXISTS warehouse.dim_dealership (
    dealership_key    integer      NOT NULL,
    dealership_id     varchar(16)  NOT NULL,
    store_name        varchar(120) NOT NULL,
    store_short_name  varchar(40)  NOT NULL,
    store_type        varchar(40)  NOT NULL,
    franchise_brand   varchar(40)  NULL,
    city              varchar(60)  NOT NULL,
    state_code        char(2)      NOT NULL,
    market_region     varchar(60)  NOT NULL,
    opened_date       date         NOT NULL,
    is_active         boolean      NOT NULL,
    effective_date    date         NOT NULL,
    expiration_date   date         NOT NULL,
    is_current        boolean      NOT NULL,
    attribute_hash    char(64)     NOT NULL,
    source_system     varchar(40)  NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_dealership
        PRIMARY KEY (dealership_key),
    CONSTRAINT uq_dim_dealership_id_effective_date
        UNIQUE (dealership_id, effective_date),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_dealership_key_positive
        CHECK (dealership_key > 0),
    CONSTRAINT ck_dim_dealership_state_code_format
        CHECK (state_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_dim_dealership_store_type_domain
        CHECK (store_type IN ('Franchise New and Used', 'Independent Used')),
    CONSTRAINT ck_dim_dealership_attribute_hash_length
        CHECK (char_length(attribute_hash) = 64),
    CONSTRAINT ck_dim_dealership_attribute_hash_hex
        CHECK (attribute_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_dim_dealership_id_not_blank
        CHECK (btrim(dealership_id) <> ''),
    CONSTRAINT ck_dim_dealership_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- A franchise store must name its brand; an independent used store must not.
    CONSTRAINT ck_dim_dealership_franchise_brand_rule
        CHECK ((store_type = 'Independent Used' AND franchise_brand IS NULL)
               OR (store_type <> 'Independent Used' AND franchise_brand IS NOT NULL)),

    -- SCD Type 2 constraints --------------------------------------------------
    CONSTRAINT ck_dim_dealership_expiration_not_before_effective
        CHECK (expiration_date >= effective_date),
    CONSTRAINT ck_dim_dealership_current_flag_matches_sentinel
        CHECK (is_current = (expiration_date = DATE '9999-12-31')),
    CONSTRAINT ck_dim_dealership_effective_not_before_opened
        CHECK (effective_date >= opened_date)
);

-- Exactly one live version per store. This is the operational grain guarantee
-- that reporting.vw_dealership and every future fact join depend on, and it is
-- what makes the Type 2 merge safe to rerun.
CREATE UNIQUE INDEX IF NOT EXISTS uix_dim_dealership_current_dealership_id
    ON warehouse.dim_dealership (dealership_id)
    WHERE is_current;

COMMENT ON TABLE warehouse.dim_dealership IS
    'Grain: one row per dealership store version (SCD Type 2). A store has exactly one row with '
    'is_current = true, guaranteed by the partial unique index uix_dim_dealership_current_dealership_id; '
    'superseded versions carry expiration_date = (successor effective_date - 1 day). In Phase 0 the '
    'fictional Granite State Auto Group has three stores and therefore three current rows. Loaded '
    'exclusively by sql/03_dimensions/11_dim_dealership_merge.sql. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_dealership.dealership_key IS 'Primary key. Warehouse-assigned surrogate key, unique per store VERSION. Assigned by the merge as max(dealership_key) + row_number() ordered by (dealership_id, effective_date); never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_dealership.dealership_id IS 'Natural key from the source system, for example GSA-001. Stable across all versions of a store.';
COMMENT ON COLUMN warehouse.dim_dealership.store_name IS 'Full legal-style store name. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.store_short_name IS 'Short store name used on dashboards and in Excel. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.store_type IS 'Franchise New and Used | Independent Used. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.franchise_brand IS 'Franchise brand, for example Chevrolet. NULL exactly for Independent Used stores. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.city IS 'Store city. Geography deliberately stops here; no street address is stored. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.state_code IS 'Two-letter upper-case state code. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.market_region IS 'Market region the store competes in. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.opened_date IS 'Date the store opened for business. Type 2 tracked attribute and the lower bound for effective_date.';
COMMENT ON COLUMN warehouse.dim_dealership.is_active IS 'Whether the store is currently trading. Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_dealership.effective_date IS 'Inclusive start date of this version. Unique with dealership_id.';
COMMENT ON COLUMN warehouse.dim_dealership.expiration_date IS 'Inclusive end date of this version, or the 9999-12-31 sentinel while current. NULL is never used to mean current.';
COMMENT ON COLUMN warehouse.dim_dealership.is_current IS 'True exactly when expiration_date is the 9999-12-31 sentinel. Enforced by ck_dim_dealership_current_flag_matches_sentinel.';
COMMENT ON COLUMN warehouse.dim_dealership.attribute_hash IS '64-character lower-case SHA-256 hex digest of the Type 2 tracked attributes (columns 3-11) joined with the pipe character in UTF-8. Equal hash means no change and therefore no new version.';
COMMENT ON COLUMN warehouse.dim_dealership.source_system IS 'Originating system. Constant arpi_synthetic_generator in Phase 0; retained for lineage when a second source appears.';
