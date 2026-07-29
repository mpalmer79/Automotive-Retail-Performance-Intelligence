-- =============================================================================
-- File:            sql/05_reporting/13_vw_leads.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Row-grain reporting projection of warehouse.fact_lead, with the duplicate exclusion applied to every funnel numerator and denominator.
-- Execution order: Reporting layer, after warehouse.fact_lead exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per CRM lead, including duplicates.
-- =============================================================================
--
-- KPIs OWNED (row-level inputs)
-- -----------------------------
--   KPI-FUN-001  Leads received            SUM(valid_lead_count)
--   KPI-FUN-002  Contact rate              SUM(contacted_lead_count)        / SUM(valid_lead_count)
--   KPI-FUN-003  Appointment-set rate      SUM(appointment_set_lead_count)  / SUM(contacted_lead_count)
--   KPI-FUN-006  Lead-to-sale conversion   SUM(sold_lead_count)             / SUM(valid_lead_count)
--   KPI-FUN-007  Average response time     SUM(response_seconds_total) / SUM(responded_lead_count) / 60
--   KPI-FUN-008  Median response time      MEDIAN(first_response_seconds) / 60
--   KPI-MKT-001  Cost per lead (denominator, through campaign_key and lead_source_key)
--
-- THE DUPLICATE EXCLUSION
-- -----------------------
-- Duplicates are the single most important exclusion in the funnel: they inflate
-- volume and depress every conversion rate at the same time, which makes a source
-- look both busy and bad. Every *_lead_count column below is ZERO on a duplicate
-- row, so the exclusion is applied once, structurally, and cannot be forgotten in
-- one measure and remembered in another. duplicate_lead_count publishes the
-- excluded population so the difference is explained rather than merely tolerated,
-- which is what RECON-LEAD-001 requires.
--
-- The raw rows are NOT filtered out of this view. A funnel measure must never see
-- them, and a duplicate-rate measure must; both are served by publishing every row
-- with pre-filtered numerators.
--
-- NULL VERSUS ZERO ON RESPONSE TIME
-- ---------------------------------
-- first_response_seconds IS NULL means "never responded", which is analytically
-- different from a very slow response and from an instant auto-response of zero
-- seconds. Both response-time KPIs exclude never-responded leads from their
-- denominator, so a store that ignores half its leads can report an excellent
-- average -- which is exactly why unresponded_lead_count is published here and must
-- appear on the same visual.
--
-- PRIVACY
-- -------
-- No communication content of any kind exists: no message body, transcript,
-- recording, note or comment column exists in fact_lead and none is created here.

CREATE OR REPLACE VIEW reporting.vw_leads AS
SELECT
    l.lead_key                                                       AS lead_key,
    l.lead_id                                                        AS lead_code,

    -- Date key. This fact has exactly one date role: the lead's creation date.
    l.lead_created_date_key                                          AS lead_created_date_key,

    -- Relationship keys.
    l.dealership_key                                                 AS dealership_key,
    l.customer_key                                                   AS customer_key,
    l.vehicle_model_key                                              AS vehicle_model_key,
    l.lead_source_key                                                AS lead_source_key,
    l.campaign_key                                                   AS campaign_key,
    l.assigned_employee_key                                          AS assigned_employee_key,
    l.sale_key                                                       AS sale_key,

    -- Funnel flags, kept for row inspection and for slicers.
    l.is_contacted                                                   AS is_contacted,
    l.is_appointment_set                                             AS is_appointment_set,
    l.is_appointment_shown                                           AS is_appointment_shown,
    l.is_sold                                                        AS is_sold,
    l.is_duplicate                                                   AS is_duplicate,
    l.original_lead_id                                               AS original_lead_code,

    -- Additive funnel measures. Zero on a duplicate row, so the exclusion is
    -- structural and every numerator and denominator shares it.
    l.lead_count                                                     AS lead_count,
    CASE WHEN NOT l.is_duplicate THEN l.lead_count ELSE 0 END::smallint
                                                                     AS valid_lead_count,
    CASE WHEN l.is_duplicate THEN l.lead_count ELSE 0 END::smallint  AS duplicate_lead_count,
    CASE WHEN NOT l.is_duplicate AND l.is_contacted
         THEN l.lead_count ELSE 0 END::smallint                      AS contacted_lead_count,
    CASE WHEN NOT l.is_duplicate AND l.is_appointment_set
         THEN l.lead_count ELSE 0 END::smallint                      AS appointment_set_lead_count,
    CASE WHEN NOT l.is_duplicate AND l.is_appointment_shown
         THEN l.lead_count ELSE 0 END::smallint                      AS appointment_shown_lead_count,
    CASE WHEN NOT l.is_duplicate AND l.is_sold
         THEN l.lead_count ELSE 0 END::smallint                      AS sold_lead_count,

    -- Response time. Row level for the median, additive for the mean.
    CASE WHEN NOT l.is_duplicate THEN l.first_response_seconds ELSE NULL END
                                                                     AS first_response_seconds,
    CASE WHEN NOT l.is_duplicate AND l.first_response_seconds IS NOT NULL
         THEN l.first_response_seconds / 60.0 ELSE NULL END          AS first_response_minutes,
    CASE WHEN NOT l.is_duplicate AND l.first_response_seconds IS NOT NULL
         THEN l.first_response_seconds ELSE 0 END                    AS response_seconds_total,
    CASE WHEN NOT l.is_duplicate AND l.first_response_seconds IS NOT NULL
         THEN l.lead_count ELSE 0 END::smallint                      AS responded_lead_count,
    CASE WHEN NOT l.is_duplicate AND l.first_response_seconds IS NULL
         THEN l.lead_count ELSE 0 END::smallint                      AS unresponded_lead_count,
    CASE
        WHEN l.is_duplicate OR l.first_response_seconds IS NULL THEN NULL
        WHEN l.first_response_seconds <   300 THEN 'Under 5 minutes'
        WHEN l.first_response_seconds <   900 THEN '5-15 minutes'
        WHEN l.first_response_seconds <  3600 THEN '15-60 minutes'
        ELSE 'Over 60 minutes'
    END                                                              AS response_time_band,

    l.days_to_sale                                                   AS days_to_sale,
    l.source_system                                                  AS source_system
FROM warehouse.fact_lead AS l;

COMMENT ON VIEW reporting.vw_leads IS
    'Grain: one row per CRM lead, duplicates included -- identical to warehouse.fact_lead, with no '
    'aggregation and no filtering. Fact table for the semantic model. Owns the row-level inputs to '
    'KPI-FUN-001, 002, 003, 006, 007 and 008, and the KPI-MKT-001 denominator. Duplicate leads are not '
    'removed from the view; instead every funnel numerator and denominator column is zero on a duplicate '
    'row, so the exclusion is structural and identical across measures, while duplicate_lead_count keeps '
    'the excluded population visible as RECON-LEAD-001 requires. first_response_seconds is published at '
    'row level because KPI-FUN-008 is a median; NULL means never responded, which is different from zero, '
    'and unresponded_lead_count must be shown beside any response-time figure because both response-time '
    'KPIs are blind to ignored leads. Contains no communication content of any kind. Surrogate keys '
    'should be hidden in the semantic model.';

COMMENT ON COLUMN reporting.vw_leads.lead_key IS 'Warehouse surrogate key of the lead. Relationship column for vw_appointments; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_leads.lead_code IS 'Stable business identifier of the lead.';
COMMENT ON COLUMN reporting.vw_leads.lead_created_date_key IS 'The date the lead was created. The governed date basis for every funnel KPI on this fact: a lead counts in the period it arrived, whatever happens later. Single active relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_leads.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_leads.customer_key IS 'Customer surrogate key. NULL for an anonymous lead; no customer record is synthesised to fill it.';
COMMENT ON COLUMN reporting.vw_leads.vehicle_model_key IS 'Model line the lead expressed interest in, or NULL. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_leads.lead_source_key IS 'Lead source, single-source first-touch attribution. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_leads.campaign_key IS 'Campaign credited with the lead, or NULL where none applies. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_leads.assigned_employee_key IS 'Role-playing employee key: the person the lead was assigned to.';
COMMENT ON COLUMN reporting.vw_leads.sale_key IS 'The finalized sale the lead produced, or NULL. Relationship column into vw_vehicle_sales.';
COMMENT ON COLUMN reporting.vw_leads.is_contacted IS 'True when two-way contact was established.';
COMMENT ON COLUMN reporting.vw_leads.is_appointment_set IS 'True when an appointment was booked. Implies is_contacted.';
COMMENT ON COLUMN reporting.vw_leads.is_appointment_shown IS 'True when the customer arrived. Implies is_appointment_set.';
COMMENT ON COLUMN reporting.vw_leads.is_sold IS 'True when the lead produced a finalized retail sale. Implies sale_key is populated.';
COMMENT ON COLUMN reporting.vw_leads.is_duplicate IS 'True when the lead duplicates an earlier one. Every funnel measure excludes these.';
COMMENT ON COLUMN reporting.vw_leads.original_lead_code IS 'Business identifier of the lead this row duplicates, or NULL.';
COMMENT ON COLUMN reporting.vw_leads.lead_count IS 'Always 1. Counts every lead, duplicates included. Use valid_lead_count for any funnel measure.';
COMMENT ON COLUMN reporting.vw_leads.valid_lead_count IS 'KPI-FUN-001 numerator, and the denominator of KPI-FUN-002 and KPI-FUN-006. 1 on a non-duplicate lead, 0 otherwise.';
COMMENT ON COLUMN reporting.vw_leads.duplicate_lead_count IS 'The excluded duplicate population, published so RECON-LEAD-001 can explain the difference between raw lead volume and KPI-FUN-001 rather than tolerating it.';
COMMENT ON COLUMN reporting.vw_leads.contacted_lead_count IS 'KPI-FUN-002 numerator and the KPI-FUN-003 denominator. Note the denominator of appointment-set rate is CONTACTED leads, not all leads.';
COMMENT ON COLUMN reporting.vw_leads.appointment_set_lead_count IS 'KPI-FUN-003 numerator. Can never exceed contacted_lead_count.';
COMMENT ON COLUMN reporting.vw_leads.appointment_shown_lead_count IS 'Leads that reached a showroom visit. Published for funnel-chain diagnosis; the governed show rate KPI-FUN-004 is computed over APPOINTMENTS, not leads.';
COMMENT ON COLUMN reporting.vw_leads.sold_lead_count IS 'KPI-FUN-006 numerator. Leads linked to a finalized retail sale.';
COMMENT ON COLUMN reporting.vw_leads.first_response_seconds IS 'KPI-FUN-008 median population. Seconds to first outbound response, NULL when the lead was never responded to and on a duplicate row. Zero is a valid value: an instant auto-response.';
COMMENT ON COLUMN reporting.vw_leads.first_response_minutes IS 'first_response_seconds expressed in minutes, the unit both response-time KPIs are published in.';
COMMENT ON COLUMN reporting.vw_leads.response_seconds_total IS 'KPI-FUN-007 numerator: response seconds on a responded, non-duplicate lead, 0 otherwise.';
COMMENT ON COLUMN reporting.vw_leads.responded_lead_count IS 'KPI-FUN-007 denominator. Never-responded leads are excluded by design.';
COMMENT ON COLUMN reporting.vw_leads.unresponded_lead_count IS 'Valid leads that were never responded to. Must be shown beside any response-time figure: both response-time KPIs are blind to this population.';
COMMENT ON COLUMN reporting.vw_leads.response_time_band IS 'Banded response time -- under 5 minutes, 5-15, 15-60, over 60. The recommended primary visual, with the median as the summary card.';
COMMENT ON COLUMN reporting.vw_leads.days_to_sale IS 'Calendar days from lead creation to the finalized sale, or NULL.';
COMMENT ON COLUMN reporting.vw_leads.source_system IS 'Originating system. Present so no reader mistakes this for real CRM data.';
