-- =============================================================================
-- File:            sql/05_reporting/44_vw_target_attainment.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Publish the monthly operating plan beside the month-to-date actual, with the governed selling-day arithmetic KPI-TGT-001..010 are computed from.
-- Execution order: Reporting layer, after every warehouse fact and dimension it reads.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql. Read by arpi_reporter.
-- Grain:           One row per dealership per target scope (type + identity) per targeted KPI per calendar month.
-- =============================================================================
--
-- Delivery increment: DASH.5. KPI owners: KPI-TGT-001 .. KPI-TGT-010 (KPI_CATALOG.md).
-- Stakeholder question: SQ-31.
--
-- WHAT THIS VIEW IS FOR
-- ---------------------
-- A dealer principal, general manager or GSM opens the console in the morning and
-- wants five things at once: what the store committed to, what it has actually done,
-- how much of the month's selling capacity is used, the current run rate, and where
-- the month lands if that rate holds. Every one of those is arithmetic over two facts
-- and the governed calendar, and every one of them is published here so no consumer
-- has to reconstruct it. A console that divided two columns of its own would be a
-- second implementation of a KPI (ADR-0013 condition 2).
--
-- FIVE THINGS THAT ARE NOT THE SAME, AND ARE NEVER CONFLATED
-- ----------------------------------------------------------
--   ACTUAL      what happened, month to date, on the sale-date basis
--   TARGET      what was planned, from warehouse.fact_sales_target
--   ATTAINMENT  actual / target, NULL when there is no target or the target is zero
--   PACE        actual / selling days elapsed, NULL before the first selling day
--   SELLING-DAY PACE PROJECTION
--               pace x selling days in the month
--
-- THE PROJECTION IS ARITHMETIC, NOT A FORECAST. It is linear extrapolation of a run
-- rate over a calendar. It is not a forecast, not a prediction, not AI, not machine
-- learning, not a probability and not an industry benchmark, and every surface that
-- renders it must label it "Selling-day pace projection". It deliberately ignores
-- within-month seasonality -- the generator weights Saturdays heavily and Sundays
-- almost to nothing -- so an early-month projection is structurally more volatile
-- than a late-month one.
--
-- WHY THE PROJECTION IS PUBLISHED AS A NUMERATOR AND A DENOMINATOR
-- ----------------------------------------------------------------
-- projected_month_end_value is the convenience quotient. The authority is the pair
-- (projection_numerator, projection_denominator), which is
-- (actual x selling days in month, selling days elapsed): one division, at the point
-- of display, rather than a rounded pace multiplied by a day count, which would round
-- twice. DATA_CONTRACT.md section 12 requires the same of every ratio the export
-- reconciles.
--
-- THE AS-OF DATE IS THE DATASET'S, NEVER THE CLOCK
-- ------------------------------------------------
-- as_of_date is the last day any measured thing happened -- the maximum calendar date
-- over the sale, snapshot and lead-creation bases -- which is the same definition
-- scripts/export_dashboard_dataset.py uses for the manifest's as_of_date, and
-- tests/integration/test_target_reporting_view.py asserts the two agree. now() and
-- current_date appear nowhere in this file. A console rendered in 2031 must show the
-- same December 2025 arithmetic it showed on the day it was built.
--
-- effective_as_of_date is that date CONSTRAINED TO THE ROW'S MONTH, so a completed
-- historical month is not treated as though it were still running and a month that has
-- not started does not pretend to have elapsed selling days.
--
-- SELLING DAYS COME FROM dim_date AND NOWHERE ELSE
-- ------------------------------------------------
-- warehouse.dim_date.is_selling_day is the only selling-day authority in ARPI
-- (ADR-0002). This view counts it; it does not re-derive weekends or holidays, and no
-- consumer may. All three stores share the calendar, which is a documented
-- simplification: real stores keep different hours.
--
-- THE FRAME: WHY EVERY APPLICABLE STORE-MONTH APPEARS, TARGET OR NOT
-- ------------------------------------------------------------------
-- The view is NOT driven by fact_sales_target alone. It is driven by the governed
-- applicable set -- every current store, every month of the calendar, every scope and
-- metric the domain supports -- UNIONed with whatever scopes the fact actually holds,
-- so a scope that exists in data but not in the governed set cannot be silently
-- dropped. A store-month with no plan therefore appears with is_target_present false
-- and a NULL target, which is what lets a consumer render "No target set". THE ABSENCE
-- OF A PLAN IS NOT A PLAN OF ZERO, and a zero target is not an absent one: both are
-- representable and they are different rows.
--
-- SCOPE ROWS ARE REFINEMENTS, NOT ADDENDS
-- ---------------------------------------
-- A store total reads Store-scope rows only. Department rows carry the two components
-- that partition total gross (Sales owns the front end, Finance the back end), and
-- summing them together with the store row would count the same gross twice. The
-- exported dataset carries target_scope_type on every row so the filter is the
-- consumer's to apply and cannot be forgotten silently.
--
-- GRAIN NOTE (as-built divergence, recorded)
-- ------------------------------------------
-- DASHBOARD_PROGRAM.md section 12 reserved this view at "store x KPI x month". The
-- as-built grain adds the target scope, because SQ-31 asks for attainment BY STORE AND
-- BY DEPARTMENT and a department row cannot exist at a store-only grain. Restricting
-- the view to target_scope_type = 'Store' reproduces the reserved grain exactly. The
-- divergence is recorded in docs/dashboard/KPI_EXTENSION_PLAN.md section 3.0 and in
-- docs/requirements/DASHBOARD_BACKLOG.md under DASH.5-02.

CREATE OR REPLACE VIEW reporting.vw_target_attainment AS
WITH governed_as_of AS (
    -- The dataset's own as-of date: the last day any measured thing happened. The same
    -- definition the export manifest carries, so the console and the view agree.
    SELECT max(d.full_date) AS as_of_date
    FROM warehouse.dim_date AS d
    WHERE d.date_key IN (
        SELECT s.sale_date_key FROM warehouse.fact_vehicle_sale AS s
        UNION ALL
        SELECT i.snapshot_date_key FROM warehouse.fact_vehicle_inventory_snapshot AS i
        UNION ALL
        SELECT l.lead_created_date_key FROM warehouse.fact_lead AS l
    )
),
month_calendar AS (
    -- The selling-day arithmetic, once per month, from dim_date alone.
    SELECT
        d.month_start_date,
        d.month_end_date,
        to_char(d.month_start_date, 'YYYYMMDD')::integer            AS target_month_date_key,
        a.as_of_date,
        least(a.as_of_date, d.month_end_date)                       AS effective_as_of_date,
        count(*) FILTER (WHERE d.is_selling_day)::integer           AS selling_days_in_month,
        count(*) FILTER (
            WHERE d.is_selling_day AND d.full_date <= a.as_of_date
        )::integer                                                  AS selling_days_elapsed
    FROM warehouse.dim_date AS d
    CROSS JOIN governed_as_of AS a
    GROUP BY d.month_start_date, d.month_end_date, a.as_of_date
),
governed_scopes AS (
    -- The scope and metric combinations the target domain supports. Mirrors
    -- arpi.constants.TARGET_SCOPE_METRICS and the fact's ck_fact_sales_target_scope_metric.
    -- Employee scope is absent here on purpose: no governed employee planning frame
    -- exists in DASH.5, so an employee row is carried only when the fact holds one.
    SELECT *
    FROM (VALUES
        ('Store'::varchar(12),      NULL::varchar(20), 'KPI-SLS-001'::varchar(16), 'Retail units',   'units'),
        ('Store'::varchar(12),      NULL::varchar(20), 'KPI-GRS-003'::varchar(16), 'Total gross',    'USD'),
        ('Department'::varchar(12), 'Sales'::varchar(20), 'KPI-GRS-001'::varchar(16), 'Front-end gross', 'USD'),
        ('Department'::varchar(12), 'Finance'::varchar(20), 'KPI-GRS-002'::varchar(16), 'Back-end gross',  'USD')
    ) AS v(target_scope_type, department_name, kpi_id, target_kpi_label, measure_unit)
),
frame AS (
    -- Every applicable store-month-scope-metric, whether or not a plan exists for it.
    SELECT
        store.dealership_key,
        mc.month_start_date,
        g.target_scope_type,
        CASE WHEN g.target_scope_type = 'Store'
             THEN store.dealership_id::varchar(40)
             ELSE g.department_name::varchar(40)
        END                                       AS target_scope_id,
        g.department_name,
        NULL::integer                             AS employee_key,
        g.kpi_id
    FROM month_calendar AS mc
    CROSS JOIN governed_scopes AS g
    JOIN warehouse.dim_dealership AS store
      ON mc.month_start_date BETWEEN store.effective_date AND store.expiration_date
     AND store.is_active
    UNION
    -- Anything the fact holds that the governed frame does not enumerate -- an
    -- employee-scope plan, or a scope a later increment adds -- still appears.
    SELECT
        t.dealership_key,
        d.month_start_date,
        t.target_scope_type,
        t.target_scope_id,
        t.department_name,
        t.employee_key,
        t.kpi_id
    FROM warehouse.fact_sales_target AS t
    JOIN warehouse.dim_date AS d ON d.date_key = t.target_month_date_key
),
store_actuals AS (
    -- Month-to-date actuals, sale-date basis, bounded by the governed as-of date.
    -- FILTER (WHERE is_retail) everywhere: KPI-SLS-001 and KPI-GRS-003 are retail
    -- measures, and a wholesale disposal is not a retail delivery.
    SELECT
        s.dealership_key,
        sd.month_start_date,
        coalesce(sum(s.unit_count)      FILTER (WHERE s.is_retail), 0)::numeric AS retail_units_mtd,
        coalesce(sum(s.total_gross)     FILTER (WHERE s.is_retail), 0)          AS total_gross_mtd,
        coalesce(sum(s.front_end_gross) FILTER (WHERE s.is_retail), 0)          AS front_end_gross_mtd,
        coalesce(sum(s.back_end_gross)  FILTER (WHERE s.is_retail), 0)          AS back_end_gross_mtd
    FROM warehouse.fact_vehicle_sale AS s
    JOIN warehouse.dim_date AS sd ON sd.date_key = s.sale_date_key
    CROSS JOIN governed_as_of AS a
    WHERE sd.full_date <= a.as_of_date
    GROUP BY s.dealership_key, sd.month_start_date
),
employee_actuals AS (
    -- The employee-scope numerator: units the salesperson delivered. Computed even
    -- though DASH.5 generates no employee-scope plan, so that a row added later is
    -- attained against the right actual rather than against a silent zero.
    SELECT
        s.dealership_key,
        sd.month_start_date,
        s.salesperson_key AS employee_key,
        coalesce(sum(s.unit_count) FILTER (WHERE s.is_retail), 0)::numeric AS retail_units_mtd
    FROM warehouse.fact_vehicle_sale AS s
    JOIN warehouse.dim_date AS sd ON sd.date_key = s.sale_date_key
    CROSS JOIN governed_as_of AS a
    WHERE sd.full_date <= a.as_of_date
      AND s.salesperson_key IS NOT NULL
    GROUP BY s.dealership_key, sd.month_start_date, s.salesperson_key
),
assembled AS (
    SELECT
        f.dealership_key,
        mc.month_start_date                                  AS target_month,
        mc.target_month_date_key,
        f.target_scope_type,
        f.target_scope_id,
        f.department_name,
        f.employee_key,
        f.kpi_id                                             AS target_kpi_id,
        coalesce(g.target_kpi_label,
                 CASE WHEN f.kpi_id = 'KPI-SLS-001' THEN 'Retail units' END,
                 f.kpi_id)                                   AS target_kpi_label,
        coalesce(g.measure_unit,
                 CASE WHEN f.kpi_id = 'KPI-SLS-001' THEN 'units' ELSE 'USD' END)
                                                             AS measure_unit,
        (t.sales_target_key IS NOT NULL)                     AS is_target_present,
        t.target_value,
        t.stretch_target_value,
        -- The comparable actual for this scope and metric. Every branch is exact
        -- numeric; the unit count is cast rather than divided so no float appears.
        CASE
            WHEN f.target_scope_type = 'Store' AND f.kpi_id = 'KPI-SLS-001'
                THEN coalesce(sa.retail_units_mtd, 0)
            WHEN f.target_scope_type = 'Store' AND f.kpi_id = 'KPI-GRS-003'
                THEN coalesce(sa.total_gross_mtd, 0)
            WHEN f.target_scope_type = 'Department' AND f.kpi_id = 'KPI-GRS-001'
                THEN coalesce(sa.front_end_gross_mtd, 0)
            WHEN f.target_scope_type = 'Department' AND f.kpi_id = 'KPI-GRS-002'
                THEN coalesce(sa.back_end_gross_mtd, 0)
            WHEN f.target_scope_type = 'Employee' AND f.kpi_id = 'KPI-SLS-001'
                THEN coalesce(ea.retail_units_mtd, 0)
        END                                                  AS actual_mtd_value,
        mc.selling_days_in_month,
        mc.selling_days_elapsed,
        (mc.selling_days_in_month - mc.selling_days_elapsed)  AS selling_days_remaining,
        mc.as_of_date,
        mc.effective_as_of_date
    FROM frame AS f
    JOIN month_calendar AS mc ON mc.month_start_date = f.month_start_date
    LEFT JOIN governed_scopes AS g
           ON g.target_scope_type = f.target_scope_type
          AND g.kpi_id = f.kpi_id
          AND g.department_name IS NOT DISTINCT FROM f.department_name
    LEFT JOIN warehouse.fact_sales_target AS t
           ON t.dealership_key = f.dealership_key
          AND t.target_month_date_key = mc.target_month_date_key
          AND t.kpi_id = f.kpi_id
          AND t.target_scope_type = f.target_scope_type
          AND t.target_scope_id = f.target_scope_id
    LEFT JOIN store_actuals AS sa
           ON sa.dealership_key = f.dealership_key
          AND sa.month_start_date = f.month_start_date
    LEFT JOIN employee_actuals AS ea
           ON ea.dealership_key = f.dealership_key
          AND ea.month_start_date = f.month_start_date
          AND ea.employee_key = f.employee_key
)
SELECT
    a.dealership_key,
    a.target_month,
    a.target_scope_type,
    a.target_scope_id,
    a.department_name,
    a.target_kpi_id,
    a.target_kpi_label,
    a.measure_unit,
    'sale date'::text                                        AS actual_date_basis,
    a.is_target_present,
    a.target_value,
    a.stretch_target_value,
    a.actual_mtd_value,

    -- Attainment. numerator / denominator published separately so a group figure is
    -- SUM(numerator) / SUM(denominator) and never an average of store percentages.
    -- nullif(target, 0) is what turns "the target is zero" into NULL rather than into
    -- a division error, and a target that is absent is already NULL.
    a.actual_mtd_value                                       AS attainment_numerator,
    nullif(a.target_value, 0)                                AS attainment_denominator,
    round(a.actual_mtd_value / nullif(a.target_value, 0), 6) AS target_attainment_ratio,

    -- The selling-day clock.
    a.selling_days_in_month,
    a.selling_days_elapsed,
    a.selling_days_remaining,

    -- Pace: actual per selling day elapsed. NULL before the first selling day, never
    -- zero and never a division error: a month that has not started has no run rate.
    a.actual_mtd_value                                       AS pace_numerator,
    a.selling_days_elapsed                                   AS pace_denominator,
    round(a.actual_mtd_value / nullif(a.selling_days_elapsed, 0), 6)
                                                             AS pace_per_selling_day,

    -- Selling-day pace projection. ONE division, from the two published components, so
    -- the projection is not a rounded pace multiplied by a day count.
    (a.actual_mtd_value * a.selling_days_in_month)           AS projection_numerator,
    a.selling_days_elapsed                                   AS projection_denominator,
    round(
        (a.actual_mtd_value * a.selling_days_in_month) / nullif(a.selling_days_elapsed, 0), 6
    )                                                        AS projected_month_end_value,

    a.as_of_date,
    a.effective_as_of_date,
    CASE
        WHEN a.selling_days_elapsed = 0 THEN 'Not started'
        WHEN a.selling_days_remaining = 0 THEN 'Complete'
        ELSE 'In progress'
    END                                                      AS month_state
FROM assembled AS a;

COMMENT ON VIEW reporting.vw_target_attainment IS
    'Grain: one row per dealership per target scope (type and identity) per targeted KPI per calendar '
    'month, with the governed as-of context. Publishes the monthly operating PLAN beside the '
    'month-to-date ACTUAL and the selling-day arithmetic that KPI-TGT-001..010 are computed from. '
    'EVERY TARGET IS A SYNTHETIC INTERNAL OPERATING GOAL FOR THE FICTIONAL GRANITE AUTO GROUP AND IS '
    'NEVER AN INDUSTRY BENCHMARK, A MANUFACTURER OBJECTIVE OR A REAL DEALERSHIP TARGET. Date basis: '
    'sale date for every actual; target month for every plan; the selling-day clock is calendar date '
    'from warehouse.dim_date.is_selling_day (ADR-0002), which is the only selling-day authority in ARPI '
    'and is shared by all three stores. Additive: target_value and the numerator columns, WITHIN one '
    'target_scope_type and one target_kpi_id -- Department rows are refinements of the store plan, not '
    'addends, and summing across scope types double-counts gross. Non-additive: every *_ratio, '
    'pace_per_selling_day and projected_month_end_value, which must be recomputed from summed '
    'numerators and denominators at every level of aggregation. NULL behaviour: a store-month with no '
    'plan carries is_target_present false and NULL target_value -- NO TARGET SET IS NOT A TARGET OF '
    'ZERO -- attainment is NULL when the target is absent or zero, and pace and projection are NULL '
    'before the first selling day. projected_month_end_value is a SELLING-DAY PACE PROJECTION: linear '
    'arithmetic over the calendar, never a forecast, a prediction, AI, machine learning or a '
    'probability, and every surface that renders it must say so. It ignores within-month seasonality by '
    'construction. Export eligibility: fully exportable, privacy class non-personal; the only person '
    'reference is a surrogate key into warehouse.dim_employee, which holds no name, pay plan or contact '
    'detail, and the dashboard export publishes no employee column at all.';

COMMENT ON COLUMN reporting.vw_target_attainment.dealership_key IS 'Store surrogate key. Relationship column; hide in a semantic model. Resolved to the GSA-00# business code by the dashboard export.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_month IS 'First day of the planned calendar month. The plan''s date basis, and the export''s partition key would be this column if the dataset were ever chunked.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_scope_type IS 'Store, Department or Employee. Part of the grain. A STORE TOTAL READS Store ROWS ONLY: Department and Employee rows are refinements of the store plan and are never added to it.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_scope_id IS 'Business identity of the scope: the store''s dealership_id, the department name, or the employee''s synthetic identifier. Never NULL, on any scope type.';
COMMENT ON COLUMN reporting.vw_target_attainment.department_name IS 'Sales or Finance on a Department-scope row; NULL on every other scope. Sales owns front-end gross and Finance owns back-end gross, which partition total gross exactly because fact_vehicle_sale enforces total = front + back.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_kpi_id IS 'The metric BEING TARGETED: KPI-SLS-001, KPI-GRS-001, KPI-GRS-002 or KPI-GRS-003. NEVER a KPI-TGT identifier -- those are the measures computed FROM these rows.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_kpi_label IS 'Display label for the targeted metric, so a consumer need not keep a second copy of the KPI vocabulary.';
COMMENT ON COLUMN reporting.vw_target_attainment.measure_unit IS 'units or USD. Decides how the row''s target, actual, pace and projection are formatted, and is read from the data rather than inferred from the KPI id by a consumer.';
COMMENT ON COLUMN reporting.vw_target_attainment.actual_date_basis IS 'The date basis of every actual on the row: sale date, never delivery date. Published as a column so the basis travels with the figure.';
COMMENT ON COLUMN reporting.vw_target_attainment.is_target_present IS 'True when a plan row exists for this store, month, scope and metric. False means NO TARGET SET, which a consumer must render as such and never as a target of zero, a gross of $0 or an attainment of 0%.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_value IS 'The month''s committed goal, exact numeric(14,2); NULL when no plan exists. A unit target is a whole number carried at cent scale. A SYNTHETIC INTERNAL OPERATING GOAL, never a benchmark. Additive within one scope type and one KPI.';
COMMENT ON COLUMN reporting.vw_target_attainment.stretch_target_value IS 'The month''s stretch goal; NULL when no plan exists. Never below target_value. Published for completeness; no DASH.5 surface renders it.';
COMMENT ON COLUMN reporting.vw_target_attainment.actual_mtd_value IS 'The comparable actual, month to date through as_of_date, on the sale-date basis: retail units for a unit target, total gross for a store gross target, front-end gross for the Sales department, back-end gross for the Finance department, salesperson units for an employee target. Exact numeric. Additive.';
COMMENT ON COLUMN reporting.vw_target_attainment.attainment_numerator IS 'The attainment numerator: actual_mtd_value, republished under its role so a group figure is SUM(numerator) / SUM(denominator). Additive.';
COMMENT ON COLUMN reporting.vw_target_attainment.attainment_denominator IS 'The attainment denominator: target_value, or NULL when the target is absent OR zero. Zero becomes NULL here so a group denominator can be summed without a zero-target store silently contributing a division by zero. Additive.';
COMMENT ON COLUMN reporting.vw_target_attainment.target_attainment_ratio IS 'KPI-TGT-002 / KPI-TGT-004 at this row''s grain: actual / target, exact to six places, NULL when the denominator is NULL. NON-ADDITIVE. A group attainment is SUM(attainment_numerator) / SUM(attainment_denominator) over the SAME subset -- never the average of store ratios, and never a numerator whose store contributed no denominator.';
COMMENT ON COLUMN reporting.vw_target_attainment.selling_days_in_month IS 'KPI-TGT-005''s companion: governed selling days in the whole month, counted from warehouse.dim_date.is_selling_day (ADR-0002). Store-invariant: all three stores share the calendar, which is a documented simplification.';
COMMENT ON COLUMN reporting.vw_target_attainment.selling_days_elapsed IS 'KPI-TGT-005: governed selling days in the month up to and including as_of_date. ZERO IS LEGITIMATE and means the month has not started; it is never converted to NULL.';
COMMENT ON COLUMN reporting.vw_target_attainment.selling_days_remaining IS 'KPI-TGT-006: selling_days_in_month minus selling_days_elapsed. Never negative. Zero on a completed month, which is the honest statement that nothing is left to sell.';
COMMENT ON COLUMN reporting.vw_target_attainment.pace_numerator IS 'The pace numerator: actual_mtd_value. Additive, so a group pace is SUM(pace_numerator) / selling days elapsed rather than an average of store paces.';
COMMENT ON COLUMN reporting.vw_target_attainment.pace_denominator IS 'The pace denominator: selling_days_elapsed. Store-invariant, so it is NOT summed across stores when forming a group pace.';
COMMENT ON COLUMN reporting.vw_target_attainment.pace_per_selling_day IS 'KPI-TGT-007 / KPI-TGT-008: actual per governed selling day elapsed, exact to six places. NULL when no selling day has elapsed -- a run rate over zero days is undefined, not zero. NON-ADDITIVE. A run rate, NEVER a forecast.';
COMMENT ON COLUMN reporting.vw_target_attainment.projection_numerator IS 'actual_mtd_value multiplied by selling_days_in_month. Published so the selling-day pace projection is one division at the point of display rather than a rounded pace multiplied by a day count. Additive across stores within one month.';
COMMENT ON COLUMN reporting.vw_target_attainment.projection_denominator IS 'selling_days_elapsed, republished under its projection role. Store-invariant.';
COMMENT ON COLUMN reporting.vw_target_attainment.projected_month_end_value IS 'KPI-TGT-009 / KPI-TGT-010, the SELLING-DAY PACE PROJECTION: where the month lands if the current selling-day rate holds, exact to six places, NULL when no selling day has elapsed. LINEAR ARITHMETIC OVER THE CALENDAR. It is not a forecast, not a prediction, not AI, not machine learning, not a probability and not a benchmark, and it ignores within-month seasonality by construction. Once the month is complete it EQUALS the final actual, and a consumer must say so rather than presenting it as forward-looking. NON-ADDITIVE.';
COMMENT ON COLUMN reporting.vw_target_attainment.as_of_date IS 'The dataset''s own as-of date: the last day any measured thing happened, over the sale, snapshot and lead-creation bases. The same definition the dashboard export manifest carries. NEVER the wall clock.';
COMMENT ON COLUMN reporting.vw_target_attainment.effective_as_of_date IS 'as_of_date constrained to the row''s month: the month end for a completed month, as_of_date inside the current one. What stops a historical month being rendered as though it were still running.';
COMMENT ON COLUMN reporting.vw_target_attainment.month_state IS 'Not started (no selling day elapsed), In progress, or Complete (every selling day elapsed). Published so a consumer states the month''s state rather than inferring it from a day count.';
