-- =============================================================================
-- File:            sql/03_dimensions/07_dim_marketing_campaign.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_marketing_campaign, the conformed marketing campaign dimension.
-- Execution order: 38 of 66 — after the dimensions it references, before sql/03_dimensions/17_dim_marketing_campaign_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per marketing campaign.
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 11 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.

CREATE TABLE IF NOT EXISTS warehouse.dim_marketing_campaign (
    campaign_key             integer       NOT NULL,
    campaign_id              varchar(16)   NOT NULL,
    campaign_name            varchar(80)   NOT NULL,
    channel                  varchar(30)   NOT NULL,
    vendor_name              varchar(60)   NOT NULL,
    lead_source_id           varchar(16)   NOT NULL,
    start_date               date          NOT NULL,
    end_date                 date          NULL    ,
    target_department        varchar(30)   NOT NULL,
    target_vehicle_category  varchar(30)   NOT NULL,
    source_system            varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_marketing_campaign
        PRIMARY KEY (campaign_key),
    CONSTRAINT uq_dim_marketing_campaign_campaign_id
        UNIQUE (campaign_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_marketing_campaign_key_positive
        CHECK (campaign_key > 0),
    CONSTRAINT ck_dim_marketing_campaign_target_department_domain
        CHECK (target_department IN ('Sales', 'Service', 'Both')),
    CONSTRAINT ck_dim_marketing_campaign_target_vehicle_category_domain
        CHECK (target_vehicle_category IN ('New', 'Used', 'Both')),
    CONSTRAINT ck_dim_marketing_campaign_campaign_id_not_blank
        CHECK (btrim(campaign_id) <> ''),
    CONSTRAINT ck_dim_marketing_campaign_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_dim_marketing_campaign_end_not_before_start
        CHECK (end_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE warehouse.dim_marketing_campaign IS
    'Grain: one row per marketing campaign. Loaded exclusively by 
sql/03_dimensions/17_dim_marketing_campaign_merge.sql from staging.stg_marketing_campaign. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_marketing_campaign.campaign_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(campaign_key) + row_number() ordered by campaign_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.campaign_id IS 'Natural key, CMP-##### (contract section 5).';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.campaign_name IS 'Fictional campaign label. Names a campaign, never a person.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.channel IS 'Delivery channel the campaign runs on.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.vendor_name IS 'Fictional vendor label. No real vendor is referenced.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.lead_source_id IS 'Lead source the campaign attributes its leads to.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.start_date IS 'First day the campaign is live.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.end_date IS 'Last day the campaign is live; NULL means still running.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.target_department IS 'Sales | Service | Both.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.target_vehicle_category IS 'New | Used | Both.';
COMMENT ON COLUMN warehouse.dim_marketing_campaign.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
