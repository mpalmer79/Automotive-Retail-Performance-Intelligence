-- =============================================================================
-- File:            sql/05_reporting/54_vw_lead_stage_loss.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Partition the lead-created cohort by the furthest modelled funnel stage each lead reached, so the console can show where leads stop progressing without inventing a reason or a KPI.
-- Execution order: Reporting layer, after reporting.vw_leads exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per lead source per campaign (nullable) per lead-creation date.
-- Lane:            Dashboard program (DASH.10). NOT part of the 28-view MVP reporting baseline.
-- =============================================================================
--
-- THESE ARE DIAGNOSTICS, NOT KPIs
-- -------------------------------
-- No column here carries a KPI identifier and none is a governed measure. They are exact
-- counts derived from the same flags vw_lead_funnel uses, published in SQL so the
-- arithmetic has one owner: computing "leads that did not reach contact" by subtracting
-- two exported columns in TypeScript would be a second implementation of a funnel, which
-- is what ADR-0013 condition 2 exists to prevent.
--
-- WHAT THE PHYSICAL MODEL ACTUALLY GUARANTEES
-- -------------------------------------------
-- warehouse.fact_lead enforces exactly three implications as CHECK constraints:
--
--     is_appointment_set   implies is_contacted
--     is_appointment_shown implies is_appointment_set
--     is_sold              implies sale_key IS NOT NULL
--
-- It does NOT enforce that a sold lead showed, and the data bears that out: in the
-- development profile 175 of 400 sold leads have is_appointment_shown = false. Those are
-- the leads vw_lead_funnel's header calls "converting by a path the model does not
-- capture" -- a walk-in later matched to a lead -- and they are the reason RECON-FUNNEL-CHAIN
-- is a reconciliation rather than an assertion.
--
-- The consequence is concrete: `appointment_shown_leads - sold_leads` is NOT the count of
-- leads that showed and did not buy, and on a store-day where more leads sold than showed
-- it goes NEGATIVE. This view therefore does not publish that subtraction. It publishes a
-- PARTITION by furthest stage reached, with the sale outcome applied only inside the stage
-- that can carry it:
--
--     not_contacted                 NOT is_contacted
--     contacted_not_appointment_set is_contacted        AND NOT is_appointment_set
--     appointment_set_not_shown     is_appointment_set  AND NOT is_appointment_shown
--     shown_not_sold                is_appointment_shown AND NOT is_sold
--     shown_and_sold                is_appointment_shown AND is_sold
--
-- Those five are mutually exclusive and exhaustive over valid leads, so
--
--     leads_received = not_contacted
--                    + contacted_not_appointment_set
--                    + appointment_set_not_shown
--                    + shown_not_sold
--                    + shown_and_sold
--
-- holds EXACTLY, on every row, and RECON-LEAD-STAGE-001 asserts it. Every count is
-- non-negative by construction, because each is a FILTER over a disjoint predicate rather
-- than a difference of two sums.
--
-- THE SALE THAT SKIPPED THE MODELLED PATH
-- ---------------------------------------
-- sold_without_modelled_showroom_visit counts valid leads with is_sold and NOT
-- is_appointment_shown. It is deliberately NOT one of the five partition terms and must
-- never be added to them: those leads are ALREADY counted in whichever of the first three
-- terms they belong to. It is an overlay that makes the gap visible instead of letting it
-- silently widen the "did not progress" counts, and it is the lead-side measure of what
-- RECON-FUNNEL-CHAIN reconciles.
--
-- DUPLICATES
-- ----------
-- Excluded from every count, structurally: vw_leads zeroes every *_lead_count column on a
-- duplicate row, and every measure here is built from those columns or from the same
-- NOT is_duplicate predicate.
--
-- LANGUAGE
-- --------
-- These counts say a lead did not REACH a stage. They do not say why, and nothing in ARPI
-- can: there is no communication-content, activity-detail or disposition fact anywhere in
-- the warehouse. Any consumer that labels one of these counts with a cause is asserting
-- something the data cannot support.

CREATE OR REPLACE VIEW reporting.vw_lead_stage_loss AS
SELECT
    l.dealership_key                                              AS dealership_key,
    l.lead_source_key                                             AS lead_source_key,
    l.campaign_key                                                AS campaign_key,
    l.lead_created_date_key                                       AS lead_created_date_key,

    -- The cohort this partitions.
    sum(l.valid_lead_count)::bigint                               AS leads_received,

    -- The five mutually exclusive furthest-stage terms. FILTER over disjoint predicates,
    -- never a difference of sums, so none of them can be negative.
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND NOT l.is_contacted
    )::bigint                                                     AS not_contacted,
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND l.is_contacted AND NOT l.is_appointment_set
    )::bigint                                                     AS contacted_not_appointment_set,
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND l.is_appointment_set AND NOT l.is_appointment_shown
    )::bigint                                                     AS appointment_set_not_shown,
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND l.is_appointment_shown AND NOT l.is_sold
    )::bigint                                                     AS shown_not_sold,
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND l.is_appointment_shown AND l.is_sold
    )::bigint                                                     AS shown_and_sold,

    -- The overlay. NOT a partition term.
    count(*) FILTER (
        WHERE NOT l.is_duplicate AND l.is_sold AND NOT l.is_appointment_shown
    )::bigint                                                     AS sold_without_modelled_showroom_visit
FROM reporting.vw_leads AS l
GROUP BY l.dealership_key, l.lead_source_key, l.campaign_key, l.lead_created_date_key;

COMMENT ON VIEW reporting.vw_lead_stage_loss IS
    'Grain: one row per dealership per lead source per campaign (nullable) per lead-creation date -- the same '
    'grain as reporting.vw_lead_funnel. DASH.10 dashboard-program lane; NOT part of the 28-view MVP reporting '
    'baseline and NOT bound by the Power BI semantic model. Owns the lost-stage arithmetic so it has one '
    'implementation rather than one per consumer. NO COLUMN HERE IS A KPI: these are diagnostics and no KPI '
    'identifier is created by this view. The five stage columns partition the valid lead cohort by the '
    'FURTHEST modelled stage each lead reached -- not_contacted, contacted_not_appointment_set, '
    'appointment_set_not_shown, shown_not_sold, shown_and_sold -- and are mutually exclusive and exhaustive, '
    'so they sum EXACTLY to leads_received on every row (RECON-LEAD-STAGE-001). Each is a FILTER over a '
    'disjoint predicate rather than a difference of two sums, so none can be negative. The partition is shaped '
    'this way because warehouse.fact_lead enforces that an appointment implies contact and a show implies an '
    'appointment, but does NOT enforce that a sale implies a show: sold leads that never showed exist, so '
    'appointment_shown_leads minus sold_leads is not the count of leads that showed without buying and can go '
    'negative. Those leads are counted by sold_without_modelled_showroom_visit, which is an OVERLAY and never '
    'a sixth partition term -- they are already inside one of the first three columns, and adding it to the '
    'five would double-count them. That column is the lead-side measure of what RECON-FUNNEL-CHAIN '
    'reconciles. Date basis is lead creation on every column: a lead created in March that sells in May counts '
    'in March, so recent cohorts always show more leads at earlier stages and any trend must label the '
    'immature tail. Duplicates are excluded from every count. Attribution is single-source and first-touch. '
    'These counts state that a lead did not REACH a stage; they state nothing about why, and ARPI models no '
    'communication content, activity detail or disposition that could. Export eligibility: exported to the '
    'browser as the lead-stage-loss dataset under DASH.10; it publishes no customer, employee or vehicle '
    'relationship and no free text.';

COMMENT ON COLUMN reporting.vw_lead_stage_loss.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.lead_source_key IS 'Lead source, single-source first-touch. Relationship column into vw_lead_source.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.campaign_key IS 'Campaign credited with the lead, or NULL where none applies. NULL is a distinct grain component, not an absence of data. Relationship column into vw_marketing_campaign.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.lead_created_date_key IS 'Lead creation date. The governed date basis for every column in this view. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.leads_received IS 'Valid non-duplicate leads created on the date. Identical to vw_lead_funnel.leads_received in the same context, and the total the five stage columns must sum to. Not published as KPI-FUN-001 here: the governed owner of that KPI is vw_lead_funnel.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.not_contacted IS 'Diagnostic. Valid leads that never reached two-way contact. Says nothing about why; ARPI models no follow-up activity or disposition.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.contacted_not_appointment_set IS 'Diagnostic. Valid leads reached but for which no appointment was booked. Some of these still bought -- see sold_without_modelled_showroom_visit -- so this is not a count of lost sales.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.appointment_set_not_shown IS 'Diagnostic. Valid leads with an appointment booked at which the customer did not arrive. This is a LEAD-grain count and is not KPI-FUN-004: show rate is computed over APPOINTMENTS, on the scheduled-date basis, in vw_appointment_funnel and vw_appointment_source_funnel.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.shown_not_sold IS 'Diagnostic. Valid leads that reached a showroom visit and are not linked to a finalized retail sale. This is a LEAD-grain count and is not KPI-FUN-005, which is computed over appointments on the show-date basis.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.shown_and_sold IS 'Diagnostic. Valid leads that reached a showroom visit and produced a finalized retail sale. The terminal term of the partition. Not KPI-FUN-006: lead-to-sale conversion counts ALL sold leads, including those that never showed.';
COMMENT ON COLUMN reporting.vw_lead_stage_loss.sold_without_modelled_showroom_visit IS 'Diagnostic OVERLAY, never a partition term: these leads are already counted in one of the first three columns and adding this to the five would double-count them. Valid leads linked to a finalized retail sale that have no modelled showroom visit -- the walk-in-later-matched path. The lead-side measure of the gap RECON-FUNNEL-CHAIN reconciles, and the reason that reconciliation is informational rather than an equality.';
