-- =============================================================================
-- File:            sql/03_dimensions/06_dim_lead_source.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_lead_source, the conformed lead source dimension.
-- Execution order: 37 of 66 — after the dimensions it references, before sql/03_dimensions/16_dim_lead_source_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per normalised lead source.
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 9 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.

CREATE TABLE IF NOT EXISTS warehouse.dim_lead_source (
    lead_source_key   integer       NOT NULL,
    lead_source_id    varchar(16)   NOT NULL,
    lead_source_name  varchar(60)   NOT NULL,
    source_category   varchar(30)   NOT NULL,
    is_paid           boolean       NOT NULL,
    is_digital        boolean       NOT NULL,
    is_third_party    boolean       NOT NULL,
    is_internal       boolean       NOT NULL,
    source_system     varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_lead_source
        PRIMARY KEY (lead_source_key),
    CONSTRAINT uq_dim_lead_source_lead_source_id
        UNIQUE (lead_source_id),
    CONSTRAINT uq_dim_lead_source_lead_source_name
        UNIQUE (lead_source_name),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_lead_source_key_positive
        CHECK (lead_source_key > 0),
    CONSTRAINT ck_dim_lead_source_source_category_domain
        CHECK (source_category IN ('Owned Digital', 'Third Party', 'Paid Search', 'Paid Social', 'Traditional Media', 'Walk-in', 'Referral', 'Internal', 'Organic Web')),
    CONSTRAINT ck_dim_lead_source_lead_source_id_not_blank
        CHECK (btrim(lead_source_id) <> ''),
    CONSTRAINT ck_dim_lead_source_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_dim_lead_source_internal_not_paid
        CHECK (NOT is_internal OR NOT is_paid)
);

COMMENT ON TABLE warehouse.dim_lead_source IS
    'Grain: one row per normalised lead source. Loaded exclusively by 
sql/03_dimensions/16_dim_lead_source_merge.sql from staging.stg_lead_source. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_lead_source.lead_source_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(lead_source_key) + row_number() ordered by lead_source_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_lead_source.lead_source_id IS 'Natural key, LDS-### (contract section 5).';
COMMENT ON COLUMN warehouse.dim_lead_source.lead_source_name IS 'Generic, fictional lead-source label. Names a channel, never a person or a real vendor.';
COMMENT ON COLUMN warehouse.dim_lead_source.source_category IS 'Normalised channel category.';
COMMENT ON COLUMN warehouse.dim_lead_source.is_paid IS 'Whether the source costs money per lead or per impression.';
COMMENT ON COLUMN warehouse.dim_lead_source.is_digital IS 'Whether the source is a digital channel.';
COMMENT ON COLUMN warehouse.dim_lead_source.is_third_party IS 'Whether the source is operated by a third party rather than the group.';
COMMENT ON COLUMN warehouse.dim_lead_source.is_internal IS 'Whether the source originates inside the group, for example a repeat customer.';
COMMENT ON COLUMN warehouse.dim_lead_source.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
