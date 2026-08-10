-- =============================================================================
-- File:            sql/08_validation/17_recon_employee_performance.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-EMP-* family: prove the two DASH.11 employee-performance views agree with every authority they re-grain, that historical attribution is not rewritten, and that no credited population is dropped.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 18_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- DASH.11 adds no fact, no dimension and no KPI. It adds two reporting views that cut
-- existing facts by the role-playing employee keys those facts already carry:
--
--   vw_employee_performance            role-aware components at store x date x family x
--                                      employee VERSION
--   vw_employee_lead_source_response   the assigned-lead population beneath that grain
--
-- Both are therefore pure claims that existing numbers survive a new cut. Employee cuts
-- are unusually easy to get plausibly wrong: one delivery is credited to three different
-- people, one person can hold several historical versions, and three role keys are
-- nullable. Every failure mode below produces output that looks entirely reasonable.
--
-- WHAT RECON-EMP-SALES-ROLLUP PROVES, AND WHY IT NEEDS NO FAMILY FILTER
-- ---------------------------------------------------------------------
-- The sale columns are named per credit relationship -- sold_*, desked_*, financed_* --
-- precisely so that each one sums correctly over the WHOLE view. If they had shared one
-- "retail units" column disambiguated by role_family, this rule would have had to filter
-- by family to mean anything, and the unfiltered sum would have silently tripled every
-- delivery. That it does not need a filter is the property the naming buys.
--
-- WHAT RECON-EMP-SCD2-ATTRIBUTION PROVES
-- ---------------------------------------
-- Every row's employee context comes from the version the FACT points at, so the store on
-- the row and the store the version was assigned to must agree. A view that resolved
-- employee_id to its CURRENT row instead would move a salesperson's August units to the
-- store they transferred to in December and relabel them with the title they hold now --
-- and it would look correct, because the totals would still add up. This rule is what
-- notices. It is deliberately an equality over every row rather than a spot check.
--
-- WHAT RECON-EMP-UNASSIGNED PROVES
-- ---------------------------------
-- Three role keys are nullable and the development profile exercises all three: 135
-- deliveries with no finance manager, 296 leads assigned to nobody, 521 appointments with
-- no BDC employee. The tempting defect is an inner join that makes employee totals look
-- tidy by losing those rows. This rule compares the Unassigned family's components against
-- the fact populations directly, so a dropped row fails here even though every other
-- rollup would still balance if the row were dropped from both sides.
--
-- WHAT RECON-EMP-ROLE-COMPAT PROVES
-- ----------------------------------
-- Two things. First, that warehouse.fn_employee_role_family() maps every job role that
-- actually appears on a credited fact -- an unmapped title yields NULL, which would put a
-- real person in the Unassigned bucket beside genuinely uncredited activity. Second, that
-- each role-playing key resolves only to a job role that key is allowed to carry: a
-- finance manager key pointing at a service advisor, or a desk key pointing at a
-- salesperson, would quietly move production between families. The allowed sets are the
-- ones the DASH.11 audit observed, recorded in docs/reviews/DASH-11-REVIEW.md section 2.
--
-- WHAT RECON-EMP-SOURCE-MEDIAN PROVES
-- ------------------------------------
-- A median is not decomposable, so the console may only recompute one from the population.
-- Expanding the supporting view's bins by responded_lead_count must be indistinguishable
-- from reading the leads themselves -- per employee, not merely in total, because a
-- per-employee median is what the BDC surface publishes.
--
-- Every tolerance is 0 except the two monetary comparisons, which use the project's
-- documented 0.01. Nothing here compares a rate: compensating inflation of a numerator and
-- a denominator divides back to a plausible rate, which is exactly how a fan-out hides.

CREATE OR REPLACE VIEW audit.vw_recon_employee_performance AS
-- BOTH DASH.11 VIEWS ARE MATERIALISED ONCE, DELIBERATELY.
-- Twelve rules read reporting.vw_employee_performance and three read
-- reporting.vw_employee_lead_source_response. Inlined, PostgreSQL re-plans the whole
-- eight-way join behind each reference and the combined view stops returning in any
-- useful time -- measured at over three minutes against 0.2 seconds for one scan. AS
-- MATERIALIZED evaluates each source exactly once and hands every rule the same rows,
-- which is also the stronger guarantee: no rule can disagree with another because the
-- planner chose a different path for it.
WITH employee_performance AS MATERIALIZED (
    SELECT * FROM reporting.vw_employee_performance
),
employee_lead_source AS MATERIALIZED (
    SELECT * FROM reporting.vw_employee_lead_source_response
),
grain_uniqueness AS (
    SELECT
        (
            SELECT count(*) - count(DISTINCT (dealership_key, activity_date_key,
                                              role_family, employee_grain_key))
            FROM employee_performance
        )::numeric AS performance_duplicates,
        (
            SELECT count(*) - count(DISTINCT (dealership_key, lead_created_date_key,
                                              role_family, employee_grain_key,
                                              lead_source_key,
                                              coalesce(first_response_seconds, -1)))
            FROM employee_lead_source
        )::numeric AS source_duplicates
),
role_compatibility AS (
    SELECT
        -- A credited employee whose job role the family map does not cover.
        (
            SELECT count(*)
            FROM employee_performance
            WHERE employee_key IS NOT NULL AND role_family = 'Unassigned'
        )::numeric AS unmapped_credited_rows,
        -- A role-playing key resolving to a job role that key may not carry.
        (
            SELECT count(*) FROM (
                SELECT 1 FROM warehouse.fact_vehicle_sale AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.salesperson_key
                WHERE warehouse.fn_employee_role_family(e.job_role)
                      IS DISTINCT FROM 'Salesperson'
                UNION ALL
                SELECT 1 FROM warehouse.fact_vehicle_sale AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.desk_manager_key
                WHERE warehouse.fn_employee_role_family(e.job_role)
                      IS DISTINCT FROM 'Desk Management'
                UNION ALL
                SELECT 1 FROM warehouse.fact_vehicle_sale AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.finance_manager_key
                WHERE warehouse.fn_employee_role_family(e.job_role)
                      IS DISTINCT FROM 'Finance'
                UNION ALL
                SELECT 1 FROM warehouse.fact_finance_product_sale AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.finance_manager_key
                WHERE warehouse.fn_employee_role_family(e.job_role)
                      IS DISTINCT FROM 'Finance'
                UNION ALL
                SELECT 1 FROM warehouse.fact_appointment AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.bdc_employee_key
                WHERE warehouse.fn_employee_role_family(e.job_role) IS DISTINCT FROM 'BDC'
                UNION ALL
                SELECT 1 FROM warehouse.fact_lead AS f
                JOIN warehouse.dim_employee AS e ON e.employee_key = f.assigned_employee_key
                WHERE warehouse.fn_employee_role_family(e.job_role)
                      NOT IN ('Salesperson', 'Desk Management', 'BDC')
            ) AS incompatible
        )::numeric AS incompatible_role_keys
),
scd2_attribution AS (
    SELECT
        count(*) FILTER (
            WHERE employee_key IS NOT NULL
              AND employee_version_dealership_id IS DISTINCT FROM dealership_id
        )::numeric AS store_divergences,
        count(*) FILTER (
            WHERE employee_key IS NOT NULL AND employee_code IS NULL
        )::numeric AS unresolved_versions
    FROM employee_performance
),
sales_rollup AS (
    -- ONE aggregate pass over each side rather than a scalar subquery per column. The
    -- scalar form planned to a query whose estimated cost crossed jit_above_cost, and
    -- PostgreSQL then spent twenty-four seconds JIT-compiling an expression tree that
    -- executes in under half of one. Two passes and a cross join is the same arithmetic.
    SELECT ep.*, auth.*
    FROM (
        SELECT
            sum(sold_retail_units)::numeric        AS sold_units,
            sum(desked_retail_units)::numeric      AS desked_units,
            sum(sold_front_end_gross)::numeric     AS sold_front,
            sum(desked_front_end_gross)::numeric   AS desked_front,
            sum(sold_total_gross)::numeric         AS sold_total,
            sum(desked_total_gross)::numeric       AS desked_total,
            sum(sold_non_retail_units)::numeric    AS sold_non_retail
        FROM employee_performance
    ) AS ep
    CROSS JOIN (
        SELECT
            sum(retail_unit_count)::numeric        AS authority_units,
            sum(retail_front_end_gross)::numeric   AS authority_front,
            sum(retail_total_gross)::numeric       AS authority_total,
            sum(wholesale_unit_count + dealer_trade_unit_count)::numeric
                                                   AS authority_non_retail
        FROM reporting.vw_vehicle_sales
    ) AS auth
),
finance_rollup AS (
    -- Compared at the FULL GRAIN the two views share -- store, sale date, manager -- not
    -- merely in total, because two managers' figures could be swapped and still total.
    SELECT
        count(*) FILTER (
            WHERE ep.financed_retail_units IS DISTINCT FROM fi.retail_units
               OR ep.financed_cash_deals IS DISTINCT FROM fi.cash_deal_count
               OR ep.financed_retail_finance_deals IS DISTINCT FROM fi.retail_finance_deal_count
               OR ep.financed_lease_deals IS DISTINCT FROM fi.lease_deal_count
               OR ep.financed_reserve_gross IS DISTINCT FROM fi.finance_reserve_gross
               OR ep.financed_back_end_gross IS DISTINCT FROM fi.back_end_gross_deal_date
               OR ep.financed_product_gross IS DISTINCT FROM fi.original_product_gross
               OR ep.financed_contract_count IS DISTINCT FROM fi.contract_count
               OR ep.financed_deals_with_a_product IS DISTINCT FROM fi.deals_with_a_product
        )::numeric AS disagreeing_groups,
        count(*) FILTER (WHERE ep.dealership_key IS NULL)::numeric AS missing_from_employee_view,
        count(*) FILTER (WHERE fi.dealership_key IS NULL)::numeric AS invented_groups
    FROM (
        SELECT dealership_key, activity_date_key AS sale_date_key, employee_grain_key,
               sum(financed_retail_units) AS financed_retail_units,
               sum(financed_cash_deals) AS financed_cash_deals,
               sum(financed_retail_finance_deals) AS financed_retail_finance_deals,
               sum(financed_lease_deals) AS financed_lease_deals,
               sum(financed_reserve_gross) AS financed_reserve_gross,
               sum(financed_back_end_gross) AS financed_back_end_gross,
               sum(financed_product_gross) AS financed_product_gross,
               sum(financed_contract_count) AS financed_contract_count,
               sum(financed_deals_with_a_product) AS financed_deals_with_a_product
        FROM employee_performance
        WHERE financed_retail_units > 0 OR financed_contract_count > 0
        GROUP BY dealership_key, activity_date_key, employee_grain_key
    ) AS ep
    FULL OUTER JOIN (
        SELECT dealership_key, sale_date_key,
               finance_manager_grain_key AS employee_grain_key,
               retail_units, cash_deal_count, retail_finance_deal_count, lease_deal_count,
               finance_reserve_gross, back_end_gross_deal_date, original_product_gross,
               contract_count, deals_with_a_product
        FROM reporting.vw_fi_summary
    ) AS fi USING (dealership_key, sale_date_key, employee_grain_key)
),
lead_rollup AS (
    SELECT ep.*, auth.*
    FROM (
        SELECT
            sum(assigned_lead_count)::numeric        AS ep_assigned,
            sum(valid_lead_count)::numeric           AS ep_valid,
            sum(duplicate_lead_count)::numeric       AS ep_dupe,
            sum(contacted_lead_count)::numeric       AS ep_contacted,
            sum(appointment_set_lead_count)::numeric AS ep_apptset,
            sum(sold_lead_count)::numeric            AS ep_sold,
            sum(responded_lead_count)::numeric       AS ep_resp,
            sum(unresponded_lead_count)::numeric     AS ep_unresp,
            sum(response_seconds_total)::numeric     AS ep_secs
        FROM employee_performance
    ) AS ep
    CROSS JOIN (
        SELECT
            sum(lead_count)::numeric                 AS auth_assigned,
            sum(valid_lead_count)::numeric           AS auth_valid,
            sum(duplicate_lead_count)::numeric       AS auth_dupe,
            sum(contacted_lead_count)::numeric       AS auth_contacted,
            sum(appointment_set_lead_count)::numeric AS auth_apptset,
            sum(sold_lead_count)::numeric            AS auth_sold,
            sum(responded_lead_count)::numeric       AS auth_resp,
            sum(unresponded_lead_count)::numeric     AS auth_unresp,
            sum(response_seconds_total)::numeric     AS auth_secs
        FROM reporting.vw_leads
    ) AS auth
),
appointment_rollup AS (
    SELECT ep.*, auth.*
    FROM (
        SELECT
            sum(bdc_scheduled_appointments)::numeric             AS ep_scheduled,
            sum(bdc_eligible_appointments)::numeric              AS ep_eligible,
            sum(bdc_cancelled_in_advance_appointments)::numeric  AS ep_cancelled,
            sum(bdc_shown_appointments_scheduled_basis)::numeric AS ep_shown_sched,
            sum(bdc_shown_appointments_show_basis)::numeric      AS ep_shown_show,
            sum(bdc_shown_and_sold_appointments)::numeric        AS ep_shown_sold
        FROM employee_performance
    ) AS ep
    CROSS JOIN (
        SELECT
            sum(appointment_count)::numeric                 AS auth_scheduled,
            sum(eligible_appointment_count)::numeric        AS auth_eligible,
            sum(cancelled_in_advance_count)::numeric        AS auth_cancelled,
            sum(shown_appointment_count)::numeric           AS auth_shown,
            sum(shown_and_sold_appointment_count)::numeric  AS auth_shown_sold
        FROM reporting.vw_appointments
    ) AS auth
),
unassigned_population AS (
    SELECT ep.*, sales.*, leads.*, appts.*
    FROM (
        SELECT
            coalesce(sum(financed_retail_units) FILTER (WHERE role_family = 'Unassigned'), 0)::numeric
                AS ep_unassigned_finance_units,
            coalesce(sum(valid_lead_count) FILTER (WHERE role_family = 'Unassigned'), 0)::numeric
                AS ep_unassigned_leads,
            coalesce(sum(bdc_eligible_appointments) FILTER (WHERE role_family = 'Unassigned'), 0)::numeric
                AS ep_unassigned_appointments
        FROM employee_performance
    ) AS ep
    CROSS JOIN (
        SELECT coalesce(sum(retail_unit_count) FILTER (WHERE finance_manager_key IS NULL), 0)::numeric
                   AS auth_unassigned_finance_units
        FROM reporting.vw_vehicle_sales
    ) AS sales
    CROSS JOIN (
        SELECT coalesce(sum(valid_lead_count) FILTER (WHERE assigned_employee_key IS NULL), 0)::numeric
                   AS auth_unassigned_leads
        FROM reporting.vw_leads
    ) AS leads
    CROSS JOIN (
        SELECT coalesce(sum(eligible_appointment_count) FILTER (WHERE bdc_employee_key IS NULL), 0)::numeric
                   AS auth_unassigned_appointments
        FROM reporting.vw_appointments
    ) AS appts
),
mix_partition AS (
    SELECT
        count(*) FILTER (WHERE sold_new_units + sold_used_units <> sold_retail_units)::numeric
            AS sold_mix_violations,
        count(*) FILTER (WHERE desked_new_units + desked_used_units <> desked_retail_units)::numeric
            AS desked_mix_violations,
        count(*) FILTER (WHERE sold_certified_units > sold_used_units
                            OR desked_certified_units > desked_used_units)::numeric
            AS certified_violations,
        count(*) FILTER (WHERE financed_cash_deals + financed_retail_finance_deals
                             + financed_lease_deals <> financed_retail_units)::numeric
            AS structure_violations,
        count(*) FILTER (WHERE sold_retail_units_with_desk_manager > sold_retail_units)::numeric
            AS involvement_violations
    FROM employee_performance
),
source_rollup AS (
    -- The supporting view rolled across lead source and response bin must reproduce the
    -- primary view's lead columns at the employee grain -- not merely in total.
    SELECT
        count(*) FILTER (
            WHERE src.valid_lead_count IS DISTINCT FROM ep.valid_lead_count
               OR src.duplicate_lead_count IS DISTINCT FROM ep.duplicate_lead_count
               OR src.contacted_lead_count IS DISTINCT FROM ep.contacted_lead_count
               OR src.appointment_set_lead_count IS DISTINCT FROM ep.appointment_set_lead_count
               OR src.sold_lead_count IS DISTINCT FROM ep.sold_lead_count
               OR src.responded_lead_count IS DISTINCT FROM ep.responded_lead_count
               OR src.unresponded_lead_count IS DISTINCT FROM ep.unresponded_lead_count
               OR src.response_seconds_total IS DISTINCT FROM ep.response_seconds_total
        )::numeric AS disagreeing_groups,
        count(*) FILTER (WHERE src.dealership_key IS NULL)::numeric AS missing_groups,
        count(*) FILTER (WHERE ep.dealership_key IS NULL)::numeric AS invented_groups
    FROM (
        SELECT dealership_key, lead_created_date_key AS date_key, employee_grain_key,
               sum(valid_lead_count) AS valid_lead_count,
               sum(duplicate_lead_count) AS duplicate_lead_count,
               sum(contacted_lead_count) AS contacted_lead_count,
               sum(appointment_set_lead_count) AS appointment_set_lead_count,
               sum(sold_lead_count) AS sold_lead_count,
               sum(responded_lead_count) AS responded_lead_count,
               sum(unresponded_lead_count) AS unresponded_lead_count,
               sum(response_seconds_total) AS response_seconds_total
        FROM employee_lead_source
        GROUP BY dealership_key, lead_created_date_key, employee_grain_key
    ) AS src
    FULL OUTER JOIN (
        SELECT dealership_key, activity_date_key AS date_key, employee_grain_key,
               sum(valid_lead_count) AS valid_lead_count,
               sum(duplicate_lead_count) AS duplicate_lead_count,
               sum(contacted_lead_count) AS contacted_lead_count,
               sum(appointment_set_lead_count) AS appointment_set_lead_count,
               sum(sold_lead_count) AS sold_lead_count,
               sum(responded_lead_count) AS responded_lead_count,
               sum(unresponded_lead_count) AS unresponded_lead_count,
               sum(response_seconds_total) AS response_seconds_total
        FROM employee_performance
        WHERE assigned_lead_count > 0
        GROUP BY dealership_key, activity_date_key, employee_grain_key
    ) AS ep USING (dealership_key, date_key, employee_grain_key)
),
source_median AS (
    -- Per employee, not merely in total: a per-employee median is what the BDC surface
    -- publishes, and a total-only equality would not protect it.
    SELECT count(*) FILTER (
        WHERE bins.median_seconds IS DISTINCT FROM leads.median_seconds
    )::numeric AS disagreeing_employees
    FROM (
        SELECT employee_grain_key,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS median_seconds
        FROM (
            SELECT employee_grain_key, first_response_seconds AS s
            FROM employee_lead_source,
                 generate_series(1, responded_lead_count)
            WHERE first_response_seconds IS NOT NULL
        ) AS expanded
        GROUP BY employee_grain_key
    ) AS bins
    FULL OUTER JOIN (
        SELECT coalesce(l.assigned_employee_key, 0) AS employee_grain_key,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds)
                   AS median_seconds
        FROM reporting.vw_leads AS l
        WHERE l.first_response_seconds IS NOT NULL
        GROUP BY coalesce(l.assigned_employee_key, 0)
    ) AS leads USING (employee_grain_key)
),
sample_floor AS (
    SELECT
        (SELECT count(DISTINCT minimum_sample_floor)
         FROM employee_performance)::numeric AS distinct_published_floors,
        (SELECT coalesce(max(minimum_sample_floor), 0)
         FROM employee_performance)::numeric AS published_floor,
        warehouse.fn_minimum_sample_floor()::numeric AS authority_floor
)

-- RECON-EMP-GRAIN --------------------------------------------------------------
SELECT
    'RECON-EMP-GRAIN'::text AS reconciliation_id,

    format('Both DASH.11 views carry exactly their declared grain: %s duplicate rows in '
           'reporting.vw_employee_performance over store x date x role family x employee version, '
           'and %s in reporting.vw_employee_lead_source_response over that grain plus lead source '
           'and response bin. employee_grain_key and the coalesced response bin exist so these '
           'counts are computable at all -- PostgreSQL treats NULLs as distinct, so a grain '
           'expressed over the nullable keys could not be checked for uniqueness.',
           g.performance_duplicates, g.source_duplicates)::text AS description,

    'reporting.vw_employee_performance'::text AS left_source,

    g.performance_duplicates + g.source_duplicates AS left_value,

    'declared grain'::text AS right_source,

    0::numeric AS right_value,

    0::numeric AS tolerance,

    CASE WHEN g.performance_duplicates = 0 AND g.source_duplicates = 0
         THEN 'passed' ELSE 'failed' END::text AS status
FROM grain_uniqueness AS g

UNION ALL

-- RECON-EMP-ROLE-COMPAT --------------------------------------------------------
SELECT
    'RECON-EMP-ROLE-COMPAT'::text,
    format('Every credited job role is mapped and every role-playing key carries a compatible '
           'role: %s rows credit a real employee whose job role warehouse.fn_employee_role_family() '
           'does not map -- which would file a real person into the Unassigned bucket beside '
           'genuinely uncredited activity -- and %s facts point a role-playing key at a job role '
           'that key may not carry, which would move production between families silently.',
           r.unmapped_credited_rows, r.incompatible_role_keys)::text,
    'warehouse.fn_employee_role_family'::text,
    r.unmapped_credited_rows + r.incompatible_role_keys,
    'observed role-playing keys'::text,
    0::numeric,
    0::numeric,
    CASE WHEN r.unmapped_credited_rows = 0 AND r.incompatible_role_keys = 0
         THEN 'passed' ELSE 'failed' END::text
FROM role_compatibility AS r

UNION ALL

-- RECON-EMP-SCD2-ATTRIBUTION ---------------------------------------------------
SELECT
    'RECON-EMP-SCD2-ATTRIBUTION'::text,
    format('Historical attribution is not rewritten: %s rows where the credited store differs '
           'from the store the FACT-LINKED employee version was assigned to, and %s rows whose '
           'employee key resolves to no dimension version at all. A view that resolved employee_id '
           'to its CURRENT row would move a salesperson''s August units to the store they '
           'transferred to in December and relabel them with the title they hold now, and every '
           'total would still balance while it did so.',
           s.store_divergences, s.unresolved_versions)::text,
    'reporting.vw_employee_performance'::text,
    s.store_divergences + s.unresolved_versions,
    'warehouse.dim_employee (fact-linked version)'::text,
    0::numeric,
    0::numeric,
    CASE WHEN s.store_divergences = 0 AND s.unresolved_versions = 0
         THEN 'passed' ELSE 'failed' END::text
FROM scd2_attribution AS s

UNION ALL

-- RECON-EMP-SALES-UNITS --------------------------------------------------------
SELECT
    'RECON-EMP-SALES-UNITS'::text,
    format('Both sale credits reproduce the governed retail-unit population with no family '
           'filter: %s salesperson-credited and %s desk-credited retail units against %s in '
           'reporting.vw_vehicle_sales, and %s non-retail units against %s. The sale columns are '
           'named per credit relationship precisely so each sums correctly over the whole view; a '
           'shared column would have tripled every delivery here.',
           v.sold_units, v.desked_units, v.authority_units,
           v.sold_non_retail, v.authority_non_retail)::text,
    'reporting.vw_employee_performance'::text,
    v.sold_units + v.desked_units + v.sold_non_retail,
    'reporting.vw_vehicle_sales'::text,
    v.authority_units * 2 + v.authority_non_retail,
    0::numeric,
    CASE WHEN v.sold_units = v.authority_units
          AND v.desked_units = v.authority_units
          AND v.sold_non_retail = v.authority_non_retail
         THEN 'passed' ELSE 'failed' END::text
FROM sales_rollup AS v

UNION ALL

-- RECON-EMP-SALES-GROSS --------------------------------------------------------
SELECT
    'RECON-EMP-SALES-GROSS'::text,
    format('Both sale credits reproduce the governed retail gross: front %s and %s against %s, '
           'total %s and %s against %s. Components are compared rather than per-unit gross, '
           'because an inflated numerator over an inflated denominator divides back to a '
           'plausible figure.',
           v.sold_front, v.desked_front, v.authority_front,
           v.sold_total, v.desked_total, v.authority_total)::text,
    'reporting.vw_employee_performance'::text,
    v.sold_front + v.desked_front + v.sold_total + v.desked_total,
    'reporting.vw_vehicle_sales'::text,
    v.authority_front * 2 + v.authority_total * 2,
    0.01::numeric,
    CASE WHEN abs(v.sold_front - v.authority_front) <= 0.01
          AND abs(v.desked_front - v.authority_front) <= 0.01
          AND abs(v.sold_total - v.authority_total) <= 0.01
          AND abs(v.desked_total - v.authority_total) <= 0.01
         THEN 'passed' ELSE 'failed' END::text
FROM sales_rollup AS v

UNION ALL

-- RECON-EMP-FINANCE ------------------------------------------------------------
SELECT
    'RECON-EMP-FINANCE'::text,
    format('The finance credit agrees with reporting.vw_fi_summary at the full grain the two '
           'share -- store, sale date, manager: %s groups disagreeing on units, structure mix, '
           'reserve, back gross, product gross or contract counts, %s groups the F&I authority '
           'holds and the employee view does not, and %s the employee view invented. Compared at '
           'grain rather than in total, because two managers'' figures could be swapped and still '
           'sum correctly.',
           f.disagreeing_groups, f.missing_from_employee_view, f.invented_groups)::text,
    'reporting.vw_employee_performance'::text,
    f.disagreeing_groups + f.missing_from_employee_view + f.invented_groups,
    'reporting.vw_fi_summary'::text,
    0::numeric,
    0::numeric,
    CASE WHEN f.disagreeing_groups = 0
          AND f.missing_from_employee_view = 0
          AND f.invented_groups = 0
         THEN 'passed' ELSE 'failed' END::text
FROM finance_rollup AS f

UNION ALL

-- RECON-EMP-LEADS --------------------------------------------------------------
SELECT
    'RECON-EMP-LEADS'::text,
    format('The lead credit reproduces every governed lead component: assigned %s/%s, valid '
           '%s/%s, duplicate %s/%s, contacted %s/%s, appointment-set %s/%s, sold %s/%s, responded '
           '%s/%s, unresponded %s/%s, response seconds %s/%s. The duplicate and unresponded '
           'populations are reconciled explicitly rather than assumed: both are exclusions, and an '
           'exclusion applied to one side of a ratio and not the other is the defect this family '
           'exists to catch.',
           l.ep_assigned, l.auth_assigned, l.ep_valid, l.auth_valid, l.ep_dupe, l.auth_dupe,
           l.ep_contacted, l.auth_contacted, l.ep_apptset, l.auth_apptset, l.ep_sold, l.auth_sold,
           l.ep_resp, l.auth_resp, l.ep_unresp, l.auth_unresp, l.ep_secs, l.auth_secs)::text,
    'reporting.vw_employee_performance'::text,
    l.ep_assigned + l.ep_valid + l.ep_dupe + l.ep_contacted + l.ep_apptset + l.ep_sold
        + l.ep_resp + l.ep_unresp + l.ep_secs,
    'reporting.vw_leads'::text,
    l.auth_assigned + l.auth_valid + l.auth_dupe + l.auth_contacted + l.auth_apptset
        + l.auth_sold + l.auth_resp + l.auth_unresp + l.auth_secs,
    0::numeric,
    CASE WHEN l.ep_assigned = l.auth_assigned AND l.ep_valid = l.auth_valid
          AND l.ep_dupe = l.auth_dupe AND l.ep_contacted = l.auth_contacted
          AND l.ep_apptset = l.auth_apptset AND l.ep_sold = l.auth_sold
          AND l.ep_resp = l.auth_resp AND l.ep_unresp = l.auth_unresp
          AND l.ep_secs = l.auth_secs
         THEN 'passed' ELSE 'failed' END::text
FROM lead_rollup AS l

UNION ALL

-- RECON-EMP-APPOINTMENTS -------------------------------------------------------
SELECT
    'RECON-EMP-APPOINTMENTS'::text,
    format('The BDC appointment credit reproduces reporting.vw_appointments on BOTH date bases: '
           'scheduled %s/%s, eligible %s/%s, advance cancellations %s/%s, shown on the '
           'SCHEDULED basis %s and on the SHOW basis %s against %s, shown-and-sold %s/%s. The two '
           'shown columns are reconciled separately because they count different populations, and '
           'a single column would have served one of the two governed ratios wrongly.',
           a.ep_scheduled, a.auth_scheduled, a.ep_eligible, a.auth_eligible,
           a.ep_cancelled, a.auth_cancelled, a.ep_shown_sched, a.ep_shown_show, a.auth_shown,
           a.ep_shown_sold, a.auth_shown_sold)::text,
    'reporting.vw_employee_performance'::text,
    a.ep_scheduled + a.ep_eligible + a.ep_cancelled + a.ep_shown_sched + a.ep_shown_show
        + a.ep_shown_sold,
    'reporting.vw_appointments'::text,
    a.auth_scheduled + a.auth_eligible + a.auth_cancelled + a.auth_shown * 2
        + a.auth_shown_sold,
    0::numeric,
    CASE WHEN a.ep_scheduled = a.auth_scheduled AND a.ep_eligible = a.auth_eligible
          AND a.ep_cancelled = a.auth_cancelled
          AND a.ep_shown_sched = a.auth_shown AND a.ep_shown_show = a.auth_shown
          AND a.ep_shown_sold = a.auth_shown_sold
         THEN 'passed' ELSE 'failed' END::text
FROM appointment_rollup AS a

UNION ALL

-- RECON-EMP-UNASSIGNED ---------------------------------------------------------
SELECT
    'RECON-EMP-UNASSIGNED'::text,
    format('Activity credited to nobody is preserved, not tidied away: %s/%s retail units with no '
           'finance manager, %s/%s valid leads assigned to nobody, %s/%s eligible appointments '
           'with no BDC employee. Three role keys are nullable and the tempting defect is an inner '
           'join that makes employee totals look clean by losing these rows -- which every other '
           'rollup would survive, because the row would be missing from both sides.',
           u.ep_unassigned_finance_units, u.auth_unassigned_finance_units,
           u.ep_unassigned_leads, u.auth_unassigned_leads,
           u.ep_unassigned_appointments, u.auth_unassigned_appointments)::text,
    'reporting.vw_employee_performance (role_family = Unassigned)'::text,
    u.ep_unassigned_finance_units + u.ep_unassigned_leads + u.ep_unassigned_appointments,
    'the nullable role keys on the governed facts'::text,
    u.auth_unassigned_finance_units + u.auth_unassigned_leads + u.auth_unassigned_appointments,
    0::numeric,
    CASE WHEN u.ep_unassigned_finance_units = u.auth_unassigned_finance_units
          AND u.ep_unassigned_leads = u.auth_unassigned_leads
          AND u.ep_unassigned_appointments = u.auth_unassigned_appointments
         THEN 'passed' ELSE 'failed' END::text
FROM unassigned_population AS u

UNION ALL

-- RECON-EMP-MIX-PARTITION ------------------------------------------------------
SELECT
    'RECON-EMP-MIX-PARTITION'::text,
    format('Every published mix is a genuine partition of its own denominator: %s rows where new '
           'plus used does not equal salesperson-credited retail units, %s where it does not for '
           'the desk credit, %s where certified exceeds used -- certified units ARE used units and '
           'must never become a third measure -- %s where the three finance structures do not sum '
           'to financed retail units, and %s where management participation exceeds the units it '
           'is drawn from.',
           m.sold_mix_violations, m.desked_mix_violations, m.certified_violations,
           m.structure_violations, m.involvement_violations)::text,
    'reporting.vw_employee_performance'::text,
    m.sold_mix_violations + m.desked_mix_violations + m.certified_violations
        + m.structure_violations + m.involvement_violations,
    'the partition identities'::text,
    0::numeric,
    0::numeric,
    CASE WHEN m.sold_mix_violations = 0 AND m.desked_mix_violations = 0
          AND m.certified_violations = 0 AND m.structure_violations = 0
          AND m.involvement_violations = 0
         THEN 'passed' ELSE 'failed' END::text
FROM mix_partition AS m

UNION ALL

-- RECON-EMP-SOURCE-ROLLUP ------------------------------------------------------
SELECT
    'RECON-EMP-SOURCE-ROLLUP'::text,
    format('reporting.vw_employee_lead_source_response rolled across lead source and response bin '
           'reproduces the primary view''s lead columns at store x date x employee: %s groups '
           'disagreeing, %s missing from the source view, %s the source view invented. This is '
           'what proves the second view re-cuts the same population rather than a different one -- '
           'and, because it carries no unit, gross or appointment measure, that reading the two '
           'together cannot fan any of those out.',
           sr.disagreeing_groups, sr.missing_groups, sr.invented_groups)::text,
    'reporting.vw_employee_lead_source_response'::text,
    sr.disagreeing_groups + sr.missing_groups + sr.invented_groups,
    'reporting.vw_employee_performance'::text,
    0::numeric,
    0::numeric,
    CASE WHEN sr.disagreeing_groups = 0 AND sr.missing_groups = 0 AND sr.invented_groups = 0
         THEN 'passed' ELSE 'failed' END::text
FROM source_rollup AS sr

UNION ALL

-- RECON-EMP-SOURCE-MEDIAN ------------------------------------------------------
SELECT
    'RECON-EMP-SOURCE-MEDIAN'::text,
    format('A response median recomputed per employee from the counted bins equals the median '
           'over the governed lead population: %s employees disagreeing. A median is not '
           'decomposable -- the median of a period is not the average of daily medians and not a '
           'blend of per-source medians -- so the console may only recompute one from the '
           'population, and expanding each bin by responded_lead_count must be indistinguishable '
           'from reading the leads.',
           sm.disagreeing_employees)::text,
    'reporting.vw_employee_lead_source_response'::text,
    sm.disagreeing_employees,
    'reporting.vw_leads'::text,
    0::numeric,
    0::numeric,
    CASE WHEN sm.disagreeing_employees = 0 THEN 'passed' ELSE 'failed' END::text
FROM source_median AS sm

UNION ALL

-- RECON-EMP-SAMPLE-FLOOR -------------------------------------------------------
SELECT
    'RECON-EMP-SAMPLE-FLOOR'::text,
    format('The minimum-sample floor published on every employee row comes from the one authority '
           'and from nowhere else: %s distinct value(s) published, %s against '
           'warehouse.fn_minimum_sample_floor() = %s. A hard-coded floor in SQL, Python, '
           'TypeScript or React would drift from the function the moment either changed, and the '
           'floor is a PUBLICATION DISCIPLINE rather than a performance threshold.',
           sf.distinct_published_floors, sf.published_floor, sf.authority_floor)::text,
    'reporting.vw_employee_performance.minimum_sample_floor'::text,
    sf.published_floor,
    'warehouse.fn_minimum_sample_floor()'::text,
    sf.authority_floor,
    0::numeric,
    CASE WHEN sf.distinct_published_floors <= 1 AND sf.published_floor = sf.authority_floor
         THEN 'passed' ELSE 'failed' END::text
FROM sample_floor AS sf;

COMMENT ON VIEW audit.vw_recon_employee_performance IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'Covers the two DASH.11 employee-performance views, neither of which adds a fact, a dimension or a KPI '
    'and each of which therefore claims that existing numbers survive being cut by the role-playing employee '
    'keys the facts already carry. RECON-EMP-GRAIN proves both declared grains. RECON-EMP-ROLE-COMPAT proves '
    'every credited job role is mapped and every role-playing key carries a role it is allowed to carry. '
    'RECON-EMP-SCD2-ATTRIBUTION proves historical attribution is not rewritten by a current-version join -- '
    'the defect that moves August units to a December store while every total still balances. '
    'RECON-EMP-SALES-UNITS and RECON-EMP-SALES-GROSS prove both sale credits reproduce '
    'reporting.vw_vehicle_sales with no family filter, which is the property the per-credit column naming '
    'buys. RECON-EMP-FINANCE compares against reporting.vw_fi_summary at full grain rather than in total. '
    'RECON-EMP-LEADS and RECON-EMP-APPOINTMENTS reconcile every funnel component, the latter on both date '
    'bases with the two shown-appointment populations kept separate. RECON-EMP-UNASSIGNED proves activity '
    'credited to nobody is preserved -- the one defect every other rollup would survive. '
    'RECON-EMP-MIX-PARTITION proves each published mix partitions its own denominator and that certified '
    'units never escape used. RECON-EMP-SOURCE-ROLLUP and RECON-EMP-SOURCE-MEDIAN prove the supporting view '
    're-cuts the same lead population and yields a TRUE median per employee. RECON-EMP-SAMPLE-FLOOR proves '
    'the floor comes from warehouse.fn_minimum_sample_floor() and from nowhere else. Nothing here compares a '
    'rate: compensating inflation of a numerator and a denominator divides back to a plausible rate, which '
    'is exactly how a fan-out hides. Tolerances are 0 everywhere except the two monetary comparisons, which '
    'use the documented 0.01.';
