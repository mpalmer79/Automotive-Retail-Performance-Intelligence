-- =============================================================================
-- File:            sql/05_reporting/15_vw_marketing_spend.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Row-grain reporting projection of warehouse.fact_marketing_spend, whose month grain is the structural floor under every cost-per measure.
-- Execution order: Reporting layer, after warehouse.fact_marketing_spend exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership, campaign and calendar month.
-- =============================================================================
--
-- KPIs OWNED (row-level inputs)
-- -----------------------------
--   KPI-MKT-001  Cost per lead                       SUM(spend_amount) numerator
--   KPI-MKT-002  Cost per sale                       SUM(spend_amount) numerator
--   KPI-MKT-003  Gross return on advertising spend   SUM(spend_amount) denominator
--
-- MONTH GRAIN IS A STRUCTURAL GUARANTEE, NOT A CONVENTION
-- -------------------------------------------------------
-- KPI_CATALOG.md states that cost per lead and cost per sale must never be computed
-- at day grain: dividing a monthly spend figure by one day's leads produces a
-- number that is meaningless and looks fine. In ARPI that is not left to
-- discipline. This fact carries exactly one date key, month_date_key, which always
-- points at the FIRST DAY of the month (enforced by a check constraint on the
-- warehouse table). A day-grain cost-per computation is therefore structurally
-- impossible: filtering vw_calendar to a single day that is not a month start
-- selects no spend at all, and filtering to a month start selects the whole
-- month's spend, which is the correct figure. Month is the finest valid grain and
-- the model cannot express a finer one.
--
-- ATTRIBUTION
-- -----------
-- Attribution is single-source and first-touch. A customer who arrived through
-- three channels is credited to one. Multi-touch attribution is out of scope.
--
-- VENDOR-REPORTED LEADS WILL NOT MATCH THE CRM
-- --------------------------------------------
-- vendor_reported_leads is what the vendor claims; it deliberately differs from
-- KPI-FUN-001, because vendors count differently and typically count duplicates.
-- That discrepancy is an analytical finding to report, not a defect to hide, and
-- the two must never be substituted for one another.

CREATE OR REPLACE VIEW reporting.vw_marketing_spend AS
SELECT
    m.marketing_spend_key                                    AS marketing_spend_key,

    -- The only date key on this fact, and always a month start.
    m.month_date_key                                         AS month_date_key,

    -- Relationship keys.
    m.dealership_key                                         AS dealership_key,
    m.campaign_key                                           AS campaign_key,
    m.lead_source_key                                        AS lead_source_key,

    -- Additive measures.
    m.spend_amount                                           AS spend_amount,
    m.impressions                                            AS impressions,
    m.clicks                                                 AS clicks,
    m.calls                                                  AS calls,
    m.form_submissions                                       AS form_submissions,
    m.calls + m.form_submissions                             AS vendor_reported_responses,
    m.vendor_reported_leads                                  AS vendor_reported_leads,

    m.source_system                                          AS source_system
FROM warehouse.fact_marketing_spend AS m;

COMMENT ON VIEW reporting.vw_marketing_spend IS
    'Grain: one row per dealership, campaign and calendar month -- identical to '
    'warehouse.fact_marketing_spend, with no aggregation and no filtering. Fact table for the semantic '
    'model; owns the spend numerator of KPI-MKT-001 and KPI-MKT-002 and the spend denominator of '
    'KPI-MKT-003. month_date_key always points at the first day of the month, enforced by a warehouse '
    'check constraint, which makes a day-grain cost-per computation structurally impossible rather than '
    'merely discouraged: month is the finest valid grain and the model cannot express a finer one. '
    'Attribution is single-source and first-touch; multi-touch is out of scope. vendor_reported_leads '
    'deliberately differs from KPI-FUN-001 because vendors count differently and typically count '
    'duplicates -- that gap is a finding to report, never a substitution to make. Surrogate keys should be '
    'hidden in the semantic model.';

COMMENT ON COLUMN reporting.vw_marketing_spend.marketing_spend_key IS 'Warehouse surrogate key of the spend row. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_spend.month_date_key IS 'First day of the spend month. The only date key on this fact, and the reason cost-per measures cannot be computed below month grain. Active relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_marketing_spend.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_spend.campaign_key IS 'Campaign the spend belongs to. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_spend.lead_source_key IS 'Lead source the campaign feeds. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_marketing_spend.spend_amount IS 'Marketing spend for the store, campaign and month. Non-negative. Numerator of KPI-MKT-001 and KPI-MKT-002; denominator of KPI-MKT-003.';
COMMENT ON COLUMN reporting.vw_marketing_spend.impressions IS 'Vendor-reported impressions.';
COMMENT ON COLUMN reporting.vw_marketing_spend.clicks IS 'Vendor-reported clicks.';
COMMENT ON COLUMN reporting.vw_marketing_spend.calls IS 'Vendor-reported inbound calls.';
COMMENT ON COLUMN reporting.vw_marketing_spend.form_submissions IS 'Vendor-reported form submissions.';
COMMENT ON COLUMN reporting.vw_marketing_spend.vendor_reported_responses IS 'Calls plus form submissions, as the vendor counts them.';
COMMENT ON COLUMN reporting.vw_marketing_spend.vendor_reported_leads IS 'Leads as the VENDOR counts them. Deliberately differs from KPI-FUN-001 and must never be substituted for it; the gap is the finding.';
COMMENT ON COLUMN reporting.vw_marketing_spend.source_system IS 'Originating system. Present so no reader mistakes this for real vendor billing data.';
