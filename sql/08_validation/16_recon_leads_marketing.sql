-- =============================================================================
-- File:            sql/08_validation/16_recon_leads_marketing.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-APPT-SOURCE-*, RECON-LEAD-STAGE-* and RECON-LEAD-RESPONSE-DIST-* families: prove the three DASH.10 presentation-grain views agree with the governed authorities they re-grain.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 17_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- DASH.10 adds three reporting views that re-grain existing facts for the console:
--
--   vw_appointment_source_funnel    appointment measures, plus source and campaign
--   vw_lead_stage_loss              the lead cohort partitioned by furthest stage reached
--   vw_lead_response_distribution   the first-response population as counted bins
--
-- None of them adds a fact and none adds a KPI. Every one of them is therefore a claim
-- that some existing authority's numbers survive being cut a different way -- and a
-- re-grain that silently fans out, drops rows or double-counts produces output that is
-- entirely plausible and wrong. These rules are what makes the claim checkable on every
-- database run rather than at review time.
--
-- WHAT RECON-APPT-SOURCE-ROLLUP PROVES
-- -------------------------------------
-- Rolled up across lead source and campaign, the source-aware appointment view reproduces
-- reporting.vw_appointment_funnel COMPONENT BY COMPONENT on every store and date: all nine
-- additive columns, on both date bases. Comparing only the rates would be insufficient --
-- an inflated numerator and an inflated denominator divide back to a correct-looking rate,
-- which is precisely how a fan-out hides.
--
-- The join it protects is appointment -> lead. fact_appointment.lead_key is NOT NULL and
-- references fact_lead's primary key, so the relationship is many-to-one and cannot fan
-- out today. This rule is what notices if that ever stops being true.
--
-- WHAT RECON-LEAD-STAGE-PARTITION PROVES
-- --------------------------------------
-- The five furthest-stage columns sum EXACTLY to leads_received on every row, and none is
-- negative. That identity holds because each term is a FILTER over a disjoint predicate
-- rather than a difference of two sums -- which is the whole reason the view is shaped
-- that way. fact_lead does not enforce that a sale implies a show, so the natural-looking
-- `appointment_shown_leads - sold_leads` is not the count of leads that showed without
-- buying and can go negative; this rule fails if anyone reintroduces that subtraction.
--
-- It also proves the view carries exactly the grain of reporting.vw_lead_funnel, so the
-- console can place a stage-loss count beside a funnel count without a join that invents
-- or drops a combination.
--
-- WHAT RECON-LEAD-RESPONSE-DIST-ROLLUP PROVES
-- -------------------------------------------
-- Rolled up to store x lead source x lead-creation date, the distribution reproduces
-- reporting.vw_lead_response's population, its four band counts and its total response
-- seconds. The equality is stated in the form that is actually true: the distribution
-- emits no row for a group whose only leads are duplicates, because a histogram bin
-- holding no leads is not a bin, so the rows present only in vw_lead_response are exactly
-- those with valid_leads = 0. A row present only in the DISTRIBUTION would be a defect and
-- fails the rule.
--
-- WHAT RECON-LEAD-RESPONSE-DIST-MEDIAN PROVES
-- -------------------------------------------
-- The median recomputed from the bins equals the median over the underlying lead rows, to
-- the cent of a second. This is the rule the whole view exists to earn: KPI-FUN-008 is an
-- order statistic, order statistics are not decomposable, and the console may only
-- recompute one if the population it holds is the governed population. Expanding each bin
-- by lead_count and taking percentile_cont over the result must be indistinguishable from
-- taking percentile_cont over reporting.vw_leads directly.
--
-- WHAT THESE RULES ARE NOT
-- ------------------------
-- They are technical agreement between layers of this project. They say nothing about
-- whether a store answers its leads well, whether a source is worth its cost, or whether
-- any of this resembles a real dealer group. It does not: the data is synthetic. See
-- LIMITATIONS.md.

CREATE OR REPLACE VIEW audit.vw_recon_leads_marketing AS
WITH appointment_rollup AS (
    SELECT
        count(*)::numeric AS disagreeing_rows
    FROM (
        SELECT
            dealership_key,
            date_key,
            sum(scheduled_appointments)             AS scheduled_appointments,
            sum(eligible_appointments)              AS eligible_appointments,
            sum(cancelled_in_advance_appointments)  AS cancelled_in_advance_appointments,
            sum(confirmed_appointments)             AS confirmed_appointments,
            sum(shown_appointments)                 AS shown_appointments,
            sum(shown_appointments_on_show_date)    AS shown_appointments_on_show_date,
            sum(shown_and_sold_appointments)        AS shown_and_sold_appointments,
            sum(test_drive_appointments)            AS test_drive_appointments,
            sum(write_up_appointments)              AS write_up_appointments
        FROM reporting.vw_appointment_source_funnel
        GROUP BY dealership_key, date_key
    ) AS rolled
    FULL OUTER JOIN reporting.vw_appointment_funnel AS base
           USING (dealership_key, date_key)
    WHERE rolled.scheduled_appointments            IS DISTINCT FROM base.scheduled_appointments
       OR rolled.eligible_appointments             IS DISTINCT FROM base.eligible_appointments
       OR rolled.cancelled_in_advance_appointments IS DISTINCT FROM base.cancelled_in_advance_appointments
       OR rolled.confirmed_appointments            IS DISTINCT FROM base.confirmed_appointments
       OR rolled.shown_appointments                IS DISTINCT FROM base.shown_appointments
       OR rolled.shown_appointments_on_show_date   IS DISTINCT FROM base.shown_appointments_on_show_date
       OR rolled.shown_and_sold_appointments       IS DISTINCT FROM base.shown_and_sold_appointments
       OR rolled.test_drive_appointments           IS DISTINCT FROM base.test_drive_appointments
       OR rolled.write_up_appointments             IS DISTINCT FROM base.write_up_appointments
),
stage_partition AS (
    SELECT
        count(*) FILTER (
            WHERE leads_received <> not_contacted
                                  + contacted_not_appointment_set
                                  + appointment_set_not_shown
                                  + shown_not_sold
                                  + shown_and_sold
        )::numeric AS identity_violations,
        count(*) FILTER (
            WHERE least(not_contacted,
                        contacted_not_appointment_set,
                        appointment_set_not_shown,
                        shown_not_sold,
                        shown_and_sold,
                        sold_without_modelled_showroom_visit) < 0
        )::numeric AS negative_rows
    FROM reporting.vw_lead_stage_loss
),
stage_grain AS (
    SELECT
        (
            SELECT count(*) FROM (
                SELECT dealership_key, lead_source_key, campaign_key, lead_created_date_key
                FROM reporting.vw_lead_stage_loss
                EXCEPT
                SELECT dealership_key, lead_source_key, campaign_key, lead_created_date_key
                FROM reporting.vw_lead_funnel
            ) AS only_in_stage_loss
        )::numeric AS only_in_stage_loss,
        (
            SELECT count(*) FROM (
                SELECT dealership_key, lead_source_key, campaign_key, lead_created_date_key
                FROM reporting.vw_lead_funnel
                EXCEPT
                SELECT dealership_key, lead_source_key, campaign_key, lead_created_date_key
                FROM reporting.vw_lead_stage_loss
            ) AS only_in_funnel
        )::numeric AS only_in_funnel
),
response_rollup AS (
    SELECT
        -- A component disagreement wherever the base view holds a real population.
        count(*) FILTER (
            WHERE rolled.dealership_key IS NOT NULL
              AND (   rolled.lead_count             IS DISTINCT FROM base.valid_leads
                   OR rolled.responded_lead_count   IS DISTINCT FROM base.responded_leads
                   OR rolled.unresponded_lead_count IS DISTINCT FROM base.unresponded_leads
                   OR rolled.response_seconds_total IS DISTINCT FROM base.response_seconds_total
                   OR rolled.under_5                IS DISTINCT FROM base.responses_under_5_minutes
                   OR rolled.from_5_to_15           IS DISTINCT FROM base.responses_5_to_15_minutes
                   OR rolled.from_15_to_60          IS DISTINCT FROM base.responses_15_to_60_minutes
                   OR rolled.over_60                IS DISTINCT FROM base.responses_over_60_minutes)
        )::numeric AS disagreeing_rows,
        -- A group the base view holds and the distribution does not, carrying real leads.
        -- Groups with valid_leads = 0 are duplicate-only and legitimately absent.
        count(*) FILTER (
            WHERE rolled.dealership_key IS NULL AND coalesce(base.valid_leads, 0) <> 0
        )::numeric AS missing_populated_groups,
        -- A group the distribution invented. Always a defect.
        count(*) FILTER (WHERE base.dealership_key IS NULL)::numeric AS invented_groups
    FROM (
        SELECT
            dealership_key,
            lead_source_key,
            lead_created_date_key,
            sum(lead_count)             AS lead_count,
            sum(responded_lead_count)   AS responded_lead_count,
            sum(unresponded_lead_count) AS unresponded_lead_count,
            sum(response_seconds_total) AS response_seconds_total,
            coalesce(sum(lead_count) FILTER (WHERE response_time_band = 'Under 5 minutes'), 0) AS under_5,
            coalesce(sum(lead_count) FILTER (WHERE response_time_band = '5-15 minutes'), 0)    AS from_5_to_15,
            coalesce(sum(lead_count) FILTER (WHERE response_time_band = '15-60 minutes'), 0)   AS from_15_to_60,
            coalesce(sum(lead_count) FILTER (WHERE response_time_band = 'Over 60 minutes'), 0) AS over_60
        FROM reporting.vw_lead_response_distribution
        GROUP BY dealership_key, lead_source_key, lead_created_date_key
    ) AS rolled
    FULL OUTER JOIN reporting.vw_lead_response AS base
           USING (dealership_key, lead_source_key, lead_created_date_key)
),
response_median AS (
    SELECT
        (
            SELECT round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY expanded.first_response_seconds)::numeric,
                6)
            FROM (
                SELECT d.first_response_seconds
                FROM reporting.vw_lead_response_distribution AS d,
                     LATERAL generate_series(1, d.lead_count::integer)
                WHERE d.first_response_seconds IS NOT NULL
            ) AS expanded
        ) AS distribution_median,
        (
            SELECT round(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds)::numeric,
                6)
            FROM reporting.vw_leads AS l
            WHERE NOT l.is_duplicate AND l.first_response_seconds IS NOT NULL
        ) AS lead_row_median
)

-- RECON-APPT-SOURCE-ROLLUP ----------------------------------------------------
SELECT
    'RECON-APPT-SOURCE-ROLLUP'::text                             AS reconciliation_id,
    format('reporting.vw_appointment_source_funnel rolled up across lead source and campaign '
           'reproduces reporting.vw_appointment_funnel on every store and date: %s disagreeing '
           'rows across all nine additive columns and both date bases. Every component is '
           'compared rather than the rates, because an inflated numerator over an inflated '
           'denominator divides back to a correct-looking rate -- which is how a fan-out on the '
           'appointment-to-lead join would hide.',
           a.disagreeing_rows)::text                             AS description,
    'reporting.vw_appointment_source_funnel'::text               AS left_source,
    a.disagreeing_rows                                           AS left_value,
    'reporting.vw_appointment_funnel'::text                      AS right_source,
    0::numeric                                                   AS right_value,
    0::numeric                                                   AS tolerance,
    CASE WHEN a.disagreeing_rows = 0 THEN 'passed' ELSE 'failed' END::text AS status
FROM appointment_rollup AS a

UNION ALL

-- RECON-LEAD-STAGE-PARTITION --------------------------------------------------
SELECT
    'RECON-LEAD-STAGE-PARTITION'::text,
    format('reporting.vw_lead_stage_loss partitions the lead cohort exactly: %s rows where the '
           'five furthest-stage counts do not sum to leads_received, and %s rows carrying a '
           'negative count. Each term is a FILTER over a disjoint predicate rather than a '
           'difference of sums, which is what makes both figures structurally zero -- fact_lead '
           'does not enforce that a sale implies a show, so appointment_shown_leads minus '
           'sold_leads is not the count of leads that showed without buying and can go negative.',
           s.identity_violations, s.negative_rows)::text,
    'reporting.vw_lead_stage_loss'::text,
    s.identity_violations + s.negative_rows,
    'partition identity and non-negativity'::text,
    0::numeric,
    0::numeric,
    CASE
        WHEN s.identity_violations = 0 AND s.negative_rows = 0 THEN 'passed'
        ELSE 'failed'
    END::text
FROM stage_partition AS s

UNION ALL

-- RECON-LEAD-STAGE-GRAIN ------------------------------------------------------
SELECT
    'RECON-LEAD-STAGE-GRAIN'::text,
    format('reporting.vw_lead_stage_loss carries exactly the grain of reporting.vw_lead_funnel: '
           '%s combinations present only in the stage-loss view and %s present only in the funnel. '
           'The console places a stage-loss count beside a funnel count, so an invented or dropped '
           'store-source-campaign-date would misalign the two without either looking wrong.',
           g.only_in_stage_loss, g.only_in_funnel)::text,
    'reporting.vw_lead_stage_loss'::text,
    g.only_in_stage_loss + g.only_in_funnel,
    'reporting.vw_lead_funnel'::text,
    0::numeric,
    0::numeric,
    CASE
        WHEN g.only_in_stage_loss = 0 AND g.only_in_funnel = 0 THEN 'passed'
        ELSE 'failed'
    END::text
FROM stage_grain AS g

UNION ALL

-- RECON-LEAD-RESPONSE-DIST-ROLLUP ---------------------------------------------
SELECT
    'RECON-LEAD-RESPONSE-DIST-ROLLUP'::text,
    format('reporting.vw_lead_response_distribution rolled up to store x lead source x '
           'lead-creation date reproduces reporting.vw_lead_response: %s groups disagreeing on '
           'population, band counts or response seconds, %s populated groups missing from the '
           'distribution, and %s groups the distribution invented. A group whose only leads are '
           'duplicates carries valid_leads = 0 and legitimately has no histogram bin, so it is '
           'not counted as missing; a group present only in the distribution always is.',
           r.disagreeing_rows, r.missing_populated_groups, r.invented_groups)::text,
    'reporting.vw_lead_response_distribution'::text,
    r.disagreeing_rows + r.missing_populated_groups + r.invented_groups,
    'reporting.vw_lead_response'::text,
    0::numeric,
    0::numeric,
    CASE
        WHEN r.disagreeing_rows = 0
         AND r.missing_populated_groups = 0
         AND r.invented_groups = 0 THEN 'passed'
        ELSE 'failed'
    END::text
FROM response_rollup AS r

UNION ALL

-- RECON-LEAD-RESPONSE-DIST-MEDIAN ---------------------------------------------
SELECT
    'RECON-LEAD-RESPONSE-DIST-MEDIAN'::text,
    format('KPI-FUN-008 recomputed from reporting.vw_lead_response_distribution equals the median '
           'over the governed lead population: %s seconds from the bins against %s seconds from '
           'reporting.vw_leads. This is the rule the view exists to earn -- a median is not '
           'decomposable, so the console may only recompute one from the population itself, and '
           'expanding each bin by lead_count must be indistinguishable from reading the leads.',
           coalesce(m.distribution_median::text, 'no responded leads'),
           coalesce(m.lead_row_median::text, 'no responded leads'))::text,
    'reporting.vw_lead_response_distribution'::text,
    coalesce(m.distribution_median, 0),
    'reporting.vw_leads'::text,
    coalesce(m.lead_row_median, 0),
    0::numeric,
    CASE
        WHEN m.distribution_median IS NOT DISTINCT FROM m.lead_row_median THEN 'passed'
        ELSE 'failed'
    END::text
FROM response_median AS m;

COMMENT ON VIEW audit.vw_recon_leads_marketing IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'Covers the three DASH.10 presentation-grain reporting views, none of which adds a fact or a KPI and '
    'each of which therefore claims that an existing authority''s numbers survive a different cut. '
    'RECON-APPT-SOURCE-ROLLUP proves vw_appointment_source_funnel rolls up across source and campaign to '
    'vw_appointment_funnel on all nine additive columns and both date bases, comparing components rather '
    'than rates because compensating inflation divides back to a plausible rate. RECON-LEAD-STAGE-PARTITION '
    'proves the five furthest-stage counts sum exactly to leads_received and none is negative. '
    'RECON-LEAD-STAGE-GRAIN proves the stage-loss view carries exactly vw_lead_funnel''s grain. '
    'RECON-LEAD-RESPONSE-DIST-ROLLUP proves the response distribution rolls up to vw_lead_response''s '
    'population, bands and response seconds, allowing for the duplicate-only groups that legitimately have '
    'no histogram bin. RECON-LEAD-RESPONSE-DIST-MEDIAN proves KPI-FUN-008 recomputed from the bins equals '
    'the median over reporting.vw_leads, which is the property that makes a true median at an arbitrary '
    'filter scope possible at all. Every tolerance is 0: all five compare integer counts or the same '
    'order statistic computed two ways, so anything a tolerance would absorb is a defect.';
