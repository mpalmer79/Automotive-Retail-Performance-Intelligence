-- =============================================================================
-- File:            sql/05_reporting/27_vw_lead_funnel.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed lead-funnel aggregate at store, source, campaign and lead-creation date, with every rate's numerator and denominator kept as separate additive columns.
-- Execution order: Reporting layer, after reporting.vw_leads exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per lead source per campaign (nullable) per lead-creation date.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-FUN-001  Leads received           leads_received
--   KPI-FUN-002  Contact rate             contacted_leads / leads_received
--   KPI-FUN-003  Appointment-set rate     appointment_set_leads / contacted_leads
--   KPI-FUN-006  Lead-to-sale conversion  sold_leads / leads_received
--
-- THE FUNNEL IS A CHAIN
-- ---------------------
-- Each rate's denominator is the previous stage's numerator, so the stages
-- multiply: contact rate x appointment-set rate x show rate x show-to-sale
-- conversion should approximate lead-to-sale conversion. Where it does not, leads
-- are converting by a path the model does not capture -- a walk-in later matched to
-- a lead, for example -- which is itself worth knowing and must be explained rather
-- than suppressed. The two middle terms live in reporting.vw_appointment_funnel,
-- because show rate and show-to-sale conversion are computed over APPOINTMENTS, not
-- leads. That grain shift is the reason the chain check is a reconciliation
-- (RECON-FUNNEL-CHAIN) rather than an assertion.
--
-- THE APPOINTMENT-SET DENOMINATOR IS CONTACTED LEADS
-- --------------------------------------------------
-- Not all leads. An appointment cannot be set with someone who was never reached,
-- so a store with a very poor contact rate can show a healthy appointment-set rate.
-- That is correct behaviour, and it is exactly why the two rates must be reported
-- side by side -- appointment_set_rate alone lets a store reaching 20% of its leads
-- look better than one reaching 70%.
--
-- BOTH SIDES ANCHOR TO LEAD CREATION
-- ----------------------------------
-- Every numerator and denominator here uses lead_created_date_key, never a contact
-- or sale date. A lead created in March that sells in May counts in MARCH. That is
-- the only basis on which a source's conversion is meaningful, and it is the reason
-- recent periods always appear to convert poorly: those cohorts have not finished
-- converting. Any trend visual must restrict to matured cohorts or label the tail.
--
-- DUPLICATES
-- ----------
-- Excluded from every numerator and denominator, and published separately as
-- duplicate_leads_excluded so RECON-LEAD-001 can explain the difference rather than
-- tolerate it.

CREATE OR REPLACE VIEW reporting.vw_lead_funnel AS
SELECT
    l.dealership_key                                           AS dealership_key,
    l.lead_source_key                                          AS lead_source_key,
    l.campaign_key                                             AS campaign_key,
    l.lead_created_date_key                                    AS lead_created_date_key,

    -- Additive numerators and denominators, all on the same population.
    sum(l.valid_lead_count)::bigint                            AS leads_received,
    sum(l.contacted_lead_count)::bigint                        AS contacted_leads,
    sum(l.appointment_set_lead_count)::bigint                  AS appointment_set_leads,
    sum(l.appointment_shown_lead_count)::bigint                AS appointment_shown_leads,
    sum(l.sold_lead_count)::bigint                             AS sold_leads,
    sum(l.duplicate_lead_count)::bigint                        AS duplicate_leads_excluded,
    sum(l.lead_count)::bigint                                  AS leads_before_exclusions,

    -- Rates at this view's grain. NULL, never zero, on an empty denominator.
    sum(l.contacted_lead_count)::numeric
        / nullif(sum(l.valid_lead_count), 0)                   AS contact_rate,
    sum(l.appointment_set_lead_count)::numeric
        / nullif(sum(l.contacted_lead_count), 0)               AS appointment_set_rate,
    sum(l.sold_lead_count)::numeric
        / nullif(sum(l.valid_lead_count), 0)                   AS lead_to_sale_conversion,
    sum(l.duplicate_lead_count)::numeric
        / nullif(sum(l.lead_count), 0)                         AS duplicate_lead_rate
FROM reporting.vw_leads AS l
GROUP BY l.dealership_key, l.lead_source_key, l.campaign_key, l.lead_created_date_key;

COMMENT ON VIEW reporting.vw_lead_funnel IS
    'Grain: one row per dealership per lead source per campaign (nullable) per lead-creation date. '
    'Governed SQL owner of KPI-FUN-001, KPI-FUN-002, KPI-FUN-003 and KPI-FUN-006, and the left-hand side '
    'of RECON-LEAD-001. Every numerator and denominator is a separate additive column so each side '
    'reconciles independently -- reconciling only the ratio is insufficient, because two compensating '
    'errors produce a correct ratio. Every rate returns NULL on a zero denominator, never 0. The '
    'appointment-set denominator is CONTACTED leads, not all leads, so this rate cannot be read without '
    'contact_rate beside it. Both sides of every rate anchor to lead_created_date_key: a lead created in '
    'March that sells in May counts in March, which is why recent cohorts always look worst and why trend '
    'visuals must restrict to matured cohorts or label the tail. Duplicates are excluded from every '
    'measure and published as duplicate_leads_excluded. Show rate and show-to-sale conversion are computed '
    'over appointments and live in reporting.vw_appointment_funnel; that grain shift is why the funnel '
    'chain is checked by RECON-FUNNEL-CHAIN rather than assumed. Attribution is single-source and '
    'first-touch; multi-touch is out of scope.';

COMMENT ON COLUMN reporting.vw_lead_funnel.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_lead_funnel.lead_source_key IS 'Lead source, single-source first-touch. Relationship column into vw_lead_source. Sources differ in lead quality, so no rate here is comparable across sources without controlling for source.';
COMMENT ON COLUMN reporting.vw_lead_funnel.campaign_key IS 'Campaign credited with the lead, or NULL where none applies. Relationship column into vw_marketing_campaign.';
COMMENT ON COLUMN reporting.vw_lead_funnel.lead_created_date_key IS 'Lead creation date. The governed date basis for every numerator and denominator in this view. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_lead_funnel.leads_received IS 'KPI-FUN-001, and the denominator of KPI-FUN-002 and KPI-FUN-006. Valid non-duplicate leads. Returns 0, not NULL, in an empty context. Vendor-reported lead counts will not match this and are not expected to.';
COMMENT ON COLUMN reporting.vw_lead_funnel.contacted_leads IS 'KPI-FUN-002 numerator and the KPI-FUN-003 denominator. Can never exceed leads_received.';
COMMENT ON COLUMN reporting.vw_lead_funnel.appointment_set_leads IS 'KPI-FUN-003 numerator. Can never exceed contacted_leads, because setting an appointment implies contact.';
COMMENT ON COLUMN reporting.vw_lead_funnel.appointment_shown_leads IS 'Leads that reached a showroom visit. Published for funnel-chain diagnosis. The governed show rate is KPI-FUN-004, computed over appointments in vw_appointment_funnel.';
COMMENT ON COLUMN reporting.vw_lead_funnel.sold_leads IS 'KPI-FUN-006 numerator. Leads linked to a finalized retail sale. Can never exceed leads_received.';
COMMENT ON COLUMN reporting.vw_lead_funnel.duplicate_leads_excluded IS 'The excluded duplicate population. Published so RECON-LEAD-001 explains the gap between raw lead volume and KPI-FUN-001 instead of tolerating it.';
COMMENT ON COLUMN reporting.vw_lead_funnel.leads_before_exclusions IS 'Every lead row, duplicates included. leads_received + duplicate_leads_excluded by construction.';
COMMENT ON COLUMN reporting.vw_lead_funnel.contact_rate IS 'KPI-FUN-002 at this view''s grain, as a fraction of 1. NULL on zero leads. Right-censored: leads created near the period end may not yet have been contacted, so a period-to-date figure is not comparable to a complete prior period.';
COMMENT ON COLUMN reporting.vw_lead_funnel.appointment_set_rate IS 'KPI-FUN-003 at this view''s grain, as a fraction of 1. NULL on zero contacted leads. Must never be shown without contact_rate.';
COMMENT ON COLUMN reporting.vw_lead_funnel.lead_to_sale_conversion IS 'KPI-FUN-006 at this view''s grain, as a fraction of 1. NULL on zero leads. Cohort maturity dominates this measure: the most recent months always look worst.';
COMMENT ON COLUMN reporting.vw_lead_funnel.duplicate_lead_rate IS 'Duplicates as a share of all lead rows. The measure duplicates belong in; folding them into volume would inflate the top of the funnel and depress every rate below it at once.';
