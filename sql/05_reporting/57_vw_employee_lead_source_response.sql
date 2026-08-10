-- =============================================================================
-- File:            sql/05_reporting/57_vw_employee_lead_source_response.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Publish the assigned-lead population beneath the employee grain -- by lead source and by distinct first-response value -- so lead-source mix and a true response median exist per employee without either being forced into reporting.vw_employee_performance.
-- Execution order: Reporting layer, after reporting.vw_leads and warehouse.fn_employee_role_family exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership, per lead-creation date, per role family, per employee VERSION, per lead source, per distinct first-response value -- including the never-responded bin.
-- Lane:            Dashboard program (DASH.11). NOT part of the 28-view MVP reporting baseline.
-- =============================================================================
--
-- Delivery increment: DASH.11. Anchoring questions SQ-08 and SQ-28.
--
-- WHY A SECOND VIEW EXISTS AT ALL, AND WHAT WAS TRIED FIRST
-- ---------------------------------------------------------
-- The DASH.11 plan expected ONE reporting view. Two required pieces of fairness context --
-- lead-source mix (SQ-08) and a response median (SQ-28) -- are both grained BENEATH
-- employee x role x store x date, and neither can be carried on the employee row honestly:
--
--   * Adding the lead source to reporting.vw_employee_performance's grain would repeat
--     that employee-day's units, gross, reserve and appointment counts on every source row,
--     and anything that summed the result would multiply all of them by the number of
--     sources the person worked. That is the single most consequential mistake available
--     here, and it is the same one reporting.vw_fi_summary refuses by keeping the product
--     category out of its grain.
--   * Pivoting the nine source categories into nine columns would encode a dimension's
--     membership in the schema, so a new source would need a migration to become visible,
--     and every per-source funnel measure would need its own nine columns.
--   * A median is not decomposable. The median of a period is not the average of daily
--     medians, not the average of per-source medians and not a blend of either; all three
--     are different numbers and all three are wrong. An order statistic can only be
--     recomputed from the POPULATION, so the population has to exist somewhere.
--
-- Correct grain outranks preserving a planning count. The divergence is recorded as an
-- as-built note in docs/requirements/DASHBOARD_BACKLOG.md and in
-- docs/dashboard/DATA_CONTRACT.md rather than being quietly absorbed.
--
-- ONE VIEW RATHER THAN TWO
-- -------------------------
-- Source mix and the response distribution are the SAME population cut two ways, so they
-- share one grain instead of costing two views: summing across first_response_seconds
-- gives the exact source mix, and summing across lead_source_key gives the exact response
-- distribution. On the development profile that is 5,686 rows against 4,384 for a
-- mix-only view -- 1,302 rows for an exact median rather than an approximate one.
--
-- WHY A COUNTED DISTRIBUTION RATHER THAN LEAD ROWS
-- ------------------------------------------------
-- A median needs the multiset of values, not the identities carrying them. Grouping by the
-- response value and counting preserves the multiset EXACTLY -- percentile_cont over this
-- view expanded by lead_count is identical to percentile_cont over the lead rows -- while
-- removing lead identity entirely. There is no lead key, no lead code, no customer, no
-- sale and no vehicle here, so the export this feeds cannot leak one even in principle.
-- The rows are histogram bins; a bin with lead_count = 1 is still a bin, and nothing
-- downstream may render one as a lead. This is not a drill-through and this route is not
-- a CRM screen.
--
-- NULL IS NOT ZERO
-- ----------------
-- first_response_seconds IS NULL means the lead was NEVER RESPONDED TO. Zero seconds means
-- an instant response and is a real, valid, included observation. The never-responded
-- population is carried on its own row with a NULL value and a NULL band, counted by
-- unresponded_lead_count and EXCLUDED from responded_lead_count. Any consumer computing a
-- median must restrict to rows where first_response_seconds IS NOT NULL, and must show the
-- unresponded count beside the result -- a person who ignores half their leads can
-- otherwise report an excellent median.
--
-- THE DUPLICATE EXCLUSION IS INHERITED, NOT REIMPLEMENTED
-- -------------------------------------------------------
-- Every measure comes from reporting.vw_leads, where a duplicate row carries zero in every
-- valid measure and a NULL first response. So duplicates cannot enter one side of a ratio
-- here while leaving the other alone, and they cannot enter the response population at
-- all. duplicate_lead_count keeps them visible as the excluded population.
--
-- SOURCE MIX IS CONTEXT, NEVER A JUDGEMENT
-- -----------------------------------------
-- The mix describes what kind of opportunity a person was given. It is not a lead-quality
-- score, not a difficulty index and not an excuse: no ordering, weighting or scoring of
-- sources exists anywhere in ARPI, and nothing may invent one. It is published because
-- comparing two people's contact rates without it compares two different jobs.
--
-- THIS IS A LEAD POPULATION AND ONLY A LEAD POPULATION. It carries no unit, no gross and
-- no appointment measure, so joining it to reporting.vw_employee_performance cannot fan
-- any of those out -- there is nothing here to multiply them by.
--
-- EXPORT BOUNDARY: DASH.11 exports this view as the `employee-lead-source` dataset.

CREATE OR REPLACE VIEW reporting.vw_employee_lead_source_response AS
SELECT
    -- Grain -------------------------------------------------------------------
    l.dealership_key                                                AS dealership_key,
    store.dealership_id                                             AS dealership_id,
    l.lead_created_date_key                                         AS lead_created_date_key,
    ld.full_date                                                    AS lead_created_date,
    coalesce(
        warehouse.fn_employee_role_family(ev.job_role),
        'Unassigned'
    )::varchar                                                      AS role_family,
    l.assigned_employee_key                                         AS employee_key,
    coalesce(l.assigned_employee_key, 0)                            AS employee_grain_key,
    ev.employee_id                                                  AS employee_code,
    ev.job_role                                                     AS job_role,
    ev.tenure_band                                                  AS tenure_band,
    l.lead_source_key                                               AS lead_source_key,
    src.lead_source_code                                            AS lead_source_code,
    l.first_response_seconds                                        AS first_response_seconds,
    max(l.response_time_band)                                       AS response_time_band,

    -- Counted population ------------------------------------------------------
    sum(l.lead_count)::integer                                      AS lead_count,
    sum(l.valid_lead_count)::integer                                AS valid_lead_count,
    sum(l.duplicate_lead_count)::integer                            AS duplicate_lead_count,
    sum(l.contacted_lead_count)::integer                            AS contacted_lead_count,
    sum(l.appointment_set_lead_count)::integer                      AS appointment_set_lead_count,
    sum(l.sold_lead_count)::integer                                 AS sold_lead_count,
    sum(l.responded_lead_count)::integer                            AS responded_lead_count,
    sum(l.unresponded_lead_count)::integer                          AS unresponded_lead_count,
    sum(l.response_seconds_total)::bigint                           AS response_seconds_total
FROM reporting.vw_leads AS l
JOIN warehouse.dim_dealership AS store ON store.dealership_key = l.dealership_key
JOIN warehouse.dim_date AS ld ON ld.date_key = l.lead_created_date_key
JOIN reporting.vw_lead_source AS src ON src.lead_source_key = l.lead_source_key
LEFT JOIN warehouse.dim_employee AS ev ON ev.employee_key = l.assigned_employee_key
GROUP BY
    l.dealership_key,
    store.dealership_id,
    l.lead_created_date_key,
    ld.full_date,
    coalesce(warehouse.fn_employee_role_family(ev.job_role), 'Unassigned'),
    l.assigned_employee_key,
    ev.employee_id,
    ev.job_role,
    ev.tenure_band,
    l.lead_source_key,
    src.lead_source_code,
    l.first_response_seconds;

COMMENT ON VIEW reporting.vw_employee_lead_source_response IS
    'Grain: ONE ROW PER DEALERSHIP, PER LEAD-CREATION DATE, PER ROLE FAMILY, PER EMPLOYEE VERSION, PER LEAD '
    'SOURCE, PER DISTINCT FIRST-RESPONSE VALUE -- including the never-responded bin, whose '
    'first_response_seconds is NULL. THE SECOND DASH.11 VIEW, and the increment''s one deliberate divergence '
    'from a single-view plan: lead-source mix and a response median are both grained BENEATH the employee '
    'row, and carrying either on it would repeat that employee-day''s units, gross and reserve on every '
    'source row for anything that summed them. THE SAME POPULATION CUT TWO WAYS: summing across '
    'first_response_seconds gives the exact source mix, summing across lead_source_key gives the exact '
    'response distribution, which is why one view serves both. A COUNTED DISTRIBUTION, NOT LEAD ROWS: '
    'percentile_cont over these bins expanded by lead_count is identical to percentile_cont over the leads, '
    'while no lead key, lead code, customer, sale or vehicle exists here at all -- the rows are histogram '
    'bins and a bin with lead_count = 1 is still a bin, never a drill-through. NULL IS NOT ZERO: NULL means '
    'never responded and must be excluded from any order statistic and never coalesced to zero, while zero '
    'seconds is a real instant response; the unresponded count must be shown beside any median. Duplicates '
    'are excluded structurally, inherited from reporting.vw_leads, and stay visible in duplicate_lead_count. '
    'SOURCE MIX IS CONTEXT, NEVER A JUDGEMENT -- no lead-quality score, difficulty index or source weighting '
    'exists anywhere in ARPI and none may be invented; it is published because comparing two people''s '
    'contact rates without it compares two different jobs. Carries NO unit, gross or appointment measure, so '
    'joining it to reporting.vw_employee_performance cannot fan one out. Every value is SYNTHETIC. Exported '
    'by DASH.11 as `employee-lead-source`.';

COMMENT ON COLUMN reporting.vw_employee_lead_source_response.dealership_key IS 'Surrogate key of the store the lead belongs to. Part of the declared grain. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.dealership_id IS 'Business identifier of the store, GSA-###.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.lead_created_date_key IS 'Date key of the lead-creation date. Part of the declared grain. THE ONLY DATE BASIS IN THIS VIEW -- there is no appointment or sale basis here to confuse it with.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.lead_created_date IS 'Calendar date the lead arrived.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.role_family IS 'Role family of the assignee, from warehouse.fn_employee_role_family() applied to the FACT-LINKED version''s job_role, or Unassigned where no employee is credited. Matches reporting.vw_employee_performance.role_family for the same employee version, which is what lets the two be read together without a second role rule.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.employee_key IS 'Surrogate key of the employee VERSION the lead was assigned to -- the version current when the lead arrived -- or NULL where the lead was assigned to nobody. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.employee_grain_key IS 'coalesce(employee_key, 0), NOT NULL. Part of the declared grain so uniqueness is testable. 0 is the 296 leads assigned to nobody on the development profile: a real population of real opportunity, kept outside the employee comparison and inside the store total.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.employee_code IS 'Stable synthetic person identity, EMP-#####, or NULL where nobody is credited. The only employee label ARPI publishes.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.job_role IS 'Job role AS AT THE LEAD, from the fact-linked SCD Type 2 version. Carried here as well as on reporting.vw_employee_performance because the BDC surface reads its people from this view, and without it their role could only come from the CURRENT-version roster -- which is the substitution this increment refuses everywhere else. Functionally determines role_family.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.tenure_band IS 'Banded tenure carried by the fact-linked version, for the same reason. A BAND FROM THE VERSION RECORD -- not recomputed as at the lead date, and nothing may present it as the person''s exact tenure on that day.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.lead_source_key IS 'Surrogate key of the lead source. Part of the declared grain. Resolve the category through reporting.vw_lead_source rather than re-deriving one here.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.lead_source_code IS 'Business code of the lead source, so a consumer can group by category through the lead-source dimension without carrying a surrogate key.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.first_response_seconds IS 'The observed seconds to first outbound response shared by every lead in this bin. NULL identifies the NEVER-RESPONDED bin and is NOT a value: it must be excluded from any order statistic and must never be coalesced to zero, which would sort ignored leads to the fastest end and improve the median. Zero is a distinct, valid observation meaning an instant response. Part of the declared grain, NULL included.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.response_time_band IS 'The governed band the bin falls in, or NULL for the never-responded bin. Functionally determined by first_response_seconds; carried for display only, and a median must never be estimated from bands.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.lead_count IS 'Leads in this bin, duplicates included. Additive. Never a funnel denominator; valid_lead_count is.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.valid_lead_count IS 'Leads in this bin excluding duplicates. Additive. The governed denominator of contact rate at this grain, and the source-mix numerator and denominator.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.duplicate_lead_count IS 'Leads excluded as duplicates. Additive. Visible as an excluded population; enters no numerator, no denominator and no response statistic.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.contacted_lead_count IS 'Valid leads in this bin that were contacted. Additive. Numerator of contact rate and DENOMINATOR of appointment-set rate -- never all valid leads.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.appointment_set_lead_count IS 'Valid leads in this bin that produced an appointment. Additive. Lead grain, not appointment grain.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.sold_lead_count IS 'Valid leads in this bin that became a delivery. Additive. Attributed to the lead''s created date, never the sale''s.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.responded_lead_count IS 'Valid leads in this bin with a recorded first response. Additive. Zero on the never-responded bin by construction. THE WEIGHT for the order statistic: expand the bins by this count.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.unresponded_lead_count IS 'Valid leads never responded to. Additive. Non-zero only on the NULL bin. Must be shown beside any median or mean, because both statistics are blind to this population by definition.';
COMMENT ON COLUMN reporting.vw_employee_lead_source_response.response_seconds_total IS 'first_response_seconds multiplied by responded_lead_count for this bin. Additive. Numerator of MEAN response time only; a median must come from the bins, never from this sum.';
