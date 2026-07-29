-- =============================================================================
-- File:            sql/05_reporting/09_vw_lead_source.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly lead-source view over warehouse.dim_lead_source, including the cost-attributability rule.
-- Execution order: Reporting layer, after warehouse.dim_lead_source exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per normalised lead source.
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table. One-to-many into vw_leads, vw_vehicle_sales, vw_marketing_spend
-- and vw_marketing_performance on lead_source_key, single direction.
--
-- is_cost_attributable is the governed expression of a rule that KPI_CATALOG.md
-- states three times: the marketing cost-per measures (KPI-MKT-001, KPI-MKT-002)
-- and gross return on advertising spend (KPI-MKT-003) are UNDEFINED, not zero, for
-- organic and internal sources. A walk-in has no cost per lead. Publishing the rule
-- as a column means every consumer applies the same test rather than each report
-- re-deriving "which sources count as paid".

CREATE OR REPLACE VIEW reporting.vw_lead_source AS
SELECT
    s.lead_source_key                                    AS lead_source_key,
    s.lead_source_id                                     AS lead_source_code,
    s.lead_source_name                                   AS lead_source_name,
    s.source_category                                    AS source_category,
    s.is_paid                                            AS is_paid,
    s.is_digital                                         AS is_digital,
    s.is_third_party                                     AS is_third_party,
    s.is_internal                                        AS is_internal,
    s.is_paid                                            AS is_cost_attributable,
    CASE WHEN s.is_paid THEN 'Paid' ELSE 'Organic or internal' END  AS cost_basis_label,
    s.source_system                                      AS source_system
FROM warehouse.dim_lead_source AS s;

COMMENT ON VIEW reporting.vw_lead_source IS
    'Grain: one row per normalised lead source. Dimension table; relates one-to-many to vw_leads, '
    'vw_vehicle_sales, vw_marketing_spend and vw_marketing_performance on lead_source_key, single '
    'direction. is_cost_attributable is the governed rule that marketing cost-per and gross-return '
    'measures are undefined -- NULL, never zero -- for organic and internal sources (KPI_CATALOG.md '
    'KPI-MKT-001, KPI-MKT-002, KPI-MKT-003). Contains no personal data.';

COMMENT ON COLUMN reporting.vw_lead_source.lead_source_key IS 'Warehouse surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_lead_source.lead_source_code IS 'Stable business identifier of the source.';
COMMENT ON COLUMN reporting.vw_lead_source.lead_source_name IS 'Normalised, generic source label such as Dealer Website. Names a channel, never a person.';
COMMENT ON COLUMN reporting.vw_lead_source.source_category IS 'Governed category: Owned Digital, Third Party, Paid Search, Paid Social, Traditional Media, Walk-in, Referral, Internal or Organic Web.';
COMMENT ON COLUMN reporting.vw_lead_source.is_paid IS 'True when the source carries marketing spend.';
COMMENT ON COLUMN reporting.vw_lead_source.is_digital IS 'True for a digital channel.';
COMMENT ON COLUMN reporting.vw_lead_source.is_third_party IS 'True for a third-party lead provider.';
COMMENT ON COLUMN reporting.vw_lead_source.is_internal IS 'True for an internally generated source. Internal sources are never paid.';
COMMENT ON COLUMN reporting.vw_lead_source.is_cost_attributable IS 'True when a cost-per-lead, cost-per-sale or gross-return figure is defined for this source. False means those measures must return NULL, not zero.';
COMMENT ON COLUMN reporting.vw_lead_source.cost_basis_label IS 'Readable form of is_cost_attributable, for use on a visual that must state why a cost measure is blank.';
COMMENT ON COLUMN reporting.vw_lead_source.source_system IS 'Originating system. Present so no reader mistakes this for real vendor data.';
