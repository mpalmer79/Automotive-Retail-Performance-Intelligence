-- =============================================================================
-- File:            sql/05_reporting/10_vw_marketing_campaign.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly campaign view over warehouse.dim_marketing_campaign, with its lead source resolved to a surrogate key.
-- Execution order: Reporting layer, after warehouse.dim_marketing_campaign and warehouse.dim_lead_source exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per marketing campaign.
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table. One-to-many into vw_marketing_spend, vw_leads and
-- vw_marketing_performance on campaign_key, single direction. campaign_key is
-- nullable on vw_leads (a walk-in belongs to no campaign), so the model needs a
-- blank-row policy rather than a bidirectional filter.
--
-- lead_source_key is resolved here from the campaign's lead_source_id so that a
-- campaign can be filtered by source category without a second lookup. The
-- warehouse dimension carries only the business identifier.
--
-- Every campaign name and vendor name in ARPI is fictional. No real vendor,
-- agency, platform or campaign is referenced.

CREATE OR REPLACE VIEW reporting.vw_marketing_campaign AS
SELECT
    c.campaign_key                                            AS campaign_key,
    c.campaign_id                                             AS campaign_code,
    c.campaign_name                                           AS campaign_name,
    c.channel                                                 AS channel,
    c.vendor_name                                             AS vendor_name,
    s.lead_source_key                                         AS lead_source_key,
    c.lead_source_id                                          AS lead_source_code,
    s.lead_source_name                                        AS lead_source_name,
    s.is_paid                                                 AS is_cost_attributable,
    c.start_date                                              AS start_date,
    c.end_date                                                AS end_date,
    (c.end_date IS NULL)                                      AS is_open_ended,
    c.target_department                                       AS target_department,
    c.target_vehicle_category                                 AS target_vehicle_category,
    c.source_system                                           AS source_system
FROM warehouse.dim_marketing_campaign AS c
JOIN warehouse.dim_lead_source AS s
       ON s.lead_source_id = c.lead_source_id;

COMMENT ON VIEW reporting.vw_marketing_campaign IS
    'Grain: one row per marketing campaign. Dimension table; relates one-to-many to vw_marketing_spend, '
    'vw_leads and vw_marketing_performance on campaign_key, single direction. campaign_key is nullable on '
    'vw_leads, so the model needs a blank-row policy rather than a bidirectional filter. lead_source_key '
    'is resolved here so a campaign can be sliced by source category. Every campaign and vendor name is '
    'fictional; no real vendor, agency or platform is referenced. Contains no personal data.';

COMMENT ON COLUMN reporting.vw_marketing_campaign.campaign_key IS 'Warehouse surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.campaign_code IS 'Stable business identifier of the campaign.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.campaign_name IS 'Fictional campaign label. Names a campaign, never a person.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.channel IS 'Marketing channel the campaign runs on.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.vendor_name IS 'Fictional vendor label. Names a business, never a person, and references no real vendor.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.lead_source_key IS 'Surrogate key of the lead source the campaign feeds. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.lead_source_code IS 'Business identifier of the lead source the campaign feeds.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.lead_source_name IS 'Lead-source label, denormalised so a campaign slicer can group by source.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.is_cost_attributable IS 'True when cost-per and gross-return measures are defined for this campaign''s source. Mirrors vw_lead_source.is_cost_attributable.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.start_date IS 'First date the campaign ran.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.end_date IS 'Last date the campaign ran, or NULL while it is still running.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.is_open_ended IS 'True while the campaign has no end date.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.target_department IS 'Sales, Service or Both.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.target_vehicle_category IS 'New, Used or Both. Campaigns do generate leads outside their target segment; attribution must not assume perfect targeting.';
COMMENT ON COLUMN reporting.vw_marketing_campaign.source_system IS 'Originating system. Present so no reader mistakes this for real campaign data.';
