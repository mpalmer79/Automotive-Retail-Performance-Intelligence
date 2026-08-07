-- =============================================================================
-- File:            sql/08_validation/11_recon_target.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-TGT-* family: the target domain's chain, grain, total and reporting reconciliations.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 13_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHAT A TARGET RECONCILIATION HAS TO PROVE
-- -----------------------------------------
-- A target is a DENOMINATOR. A lost target row does not make a number look empty --
-- it makes every attainment percentage on the console larger, and larger looks like
-- good news. So the chain from staging to warehouse to reporting is reconciled on row
-- counts, on the distinct logical grain, and on the totals themselves, per KPI, per
-- store and per month. Counts are exact (tolerance 0). Currency comparisons use
-- validation.numeric_absolute_tolerance = 0.01, the project-wide currency tolerance,
-- and unit comparisons are exact because a unit target is a whole number.
--
-- WHY THE DEPARTMENT SPLIT IS RECONCILED AND NOT MERELY DOCUMENTED
-- ----------------------------------------------------------------
-- The Sales and Finance department gross targets are a PARTITION of the store's
-- total-gross target, mirroring the fact_vehicle_sale identity total = front + back.
-- If they ever stopped summing, a department view and a store view would disagree
-- about the same month and neither would be obviously wrong. RECON-TGT-DEPT-SPLIT is
-- what makes that impossible to ship.
--
-- WHY THE REPORTING VIEW IS RECONCILED FOR FAN-OUT
-- ------------------------------------------------
-- reporting.vw_target_attainment joins four aggregates and a LEFT JOIN to the plan. A
-- duplicated join key would fan a row out and double both the target and the actual,
-- which is invisible in a percentage. RECON-REPORT-TARGET-ROWS compares the view's row
-- count against its distinct declared grain, so a fan-out fails rather than renders.

CREATE OR REPLACE VIEW audit.vw_recon_target AS
WITH chain AS (
    SELECT
        (SELECT count(*) FROM staging.stg_sales_target)::numeric        AS staging_rows,
        (SELECT count(*) FROM warehouse.fact_sales_target)::numeric     AS warehouse_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, target_month_date_key, kpi_id,
                            target_scope_type, target_scope_id
            FROM warehouse.fact_sales_target
        ) AS g)::numeric                                                AS distinct_grain_rows
),
store_scope_totals AS (
    SELECT
        coalesce(sum(t.target_value) FILTER (WHERE t.kpi_id = 'KPI-SLS-001'), 0) AS fact_unit_target,
        coalesce(sum(t.target_value) FILTER (WHERE t.kpi_id = 'KPI-GRS-003'), 0) AS fact_gross_target
    FROM warehouse.fact_sales_target AS t
    WHERE t.target_scope_type = 'Store'
),
view_scope_totals AS (
    SELECT
        coalesce(sum(v.target_value) FILTER (WHERE v.target_kpi_id = 'KPI-SLS-001'), 0) AS view_unit_target,
        coalesce(sum(v.target_value) FILTER (WHERE v.target_kpi_id = 'KPI-GRS-003'), 0) AS view_gross_target,
        coalesce(sum(v.actual_mtd_value) FILTER (WHERE v.target_kpi_id = 'KPI-SLS-001'), 0) AS view_unit_actual,
        coalesce(sum(v.actual_mtd_value) FILTER (WHERE v.target_kpi_id = 'KPI-GRS-003'), 0) AS view_gross_actual
    FROM reporting.vw_target_attainment AS v
    WHERE v.target_scope_type = 'Store'
),
fact_actuals AS (
    SELECT
        coalesce(sum(s.unit_count)  FILTER (WHERE s.is_retail), 0)::numeric AS fact_retail_units,
        coalesce(sum(s.total_gross) FILTER (WHERE s.is_retail), 0)          AS fact_total_gross
    FROM warehouse.fact_vehicle_sale AS s
),
department_split AS (
    -- Per store-month: do the two department gross targets sum to the store's
    -- total-gross target? Compared per group rather than in total, so two offsetting
    -- store-months cannot hide each other.
    SELECT
        count(*)::numeric AS store_months,
        count(*) FILTER (WHERE abs(department_total - store_total) <= 0.01)::numeric
                          AS conforming_store_months
    FROM (
        SELECT
            t.dealership_key,
            t.target_month_date_key,
            coalesce(sum(t.target_value) FILTER (
                WHERE t.target_scope_type = 'Store' AND t.kpi_id = 'KPI-GRS-003'), 0) AS store_total,
            coalesce(sum(t.target_value) FILTER (
                WHERE t.target_scope_type = 'Department'), 0)                          AS department_total
        FROM warehouse.fact_sales_target AS t
        GROUP BY t.dealership_key, t.target_month_date_key
    ) AS per_month
),
store_totals AS (
    -- Per store: the view's store-scope target totals against the warehouse's.
    SELECT
        count(*)::numeric AS stores,
        count(*) FILTER (
            WHERE abs(view_total - fact_total) <= 0.01
        )::numeric        AS conforming_stores
    FROM (
        SELECT
            coalesce(f.dealership_key, v.dealership_key) AS dealership_key,
            coalesce(f.total, 0) AS fact_total,
            coalesce(v.total, 0) AS view_total
        FROM (
            SELECT t.dealership_key, sum(t.target_value) AS total
            FROM warehouse.fact_sales_target AS t
            WHERE t.target_scope_type = 'Store'
            GROUP BY t.dealership_key
        ) AS f
        FULL JOIN (
            SELECT a.dealership_key, sum(a.target_value) AS total
            FROM reporting.vw_target_attainment AS a
            WHERE a.target_scope_type = 'Store'
            GROUP BY a.dealership_key
        ) AS v ON v.dealership_key = f.dealership_key
    ) AS per_store
),
month_totals AS (
    -- Per month: the same comparison, so a month lost in the reporting frame fails.
    SELECT
        count(*)::numeric AS months,
        count(*) FILTER (
            WHERE abs(view_total - fact_total) <= 0.01
        )::numeric        AS conforming_months
    FROM (
        SELECT
            coalesce(f.month_key, v.month_key) AS month_key,
            coalesce(f.total, 0) AS fact_total,
            coalesce(v.total, 0) AS view_total
        FROM (
            SELECT t.target_month_date_key AS month_key, sum(t.target_value) AS total
            FROM warehouse.fact_sales_target AS t
            WHERE t.target_scope_type = 'Store'
            GROUP BY t.target_month_date_key
        ) AS f
        FULL JOIN (
            SELECT to_char(a.target_month, 'YYYYMMDD')::integer AS month_key,
                   sum(a.target_value) AS total
            FROM reporting.vw_target_attainment AS a
            WHERE a.target_scope_type = 'Store'
            GROUP BY 1
        ) AS v ON v.month_key = f.month_key
    ) AS per_month
),
view_shape AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_target_attainment)::numeric AS view_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, target_month, target_scope_type,
                            target_scope_id, target_kpi_id
            FROM reporting.vw_target_attainment
        ) AS g)::numeric                                               AS view_distinct_grain,
        (SELECT count(*) FROM reporting.vw_target_attainment WHERE is_target_present)::numeric
                                                                       AS view_rows_with_target
)

-- RECON-FACT-SALES-TARGET-WAREHOUSE -- the staging-to-warehouse chain -------------
SELECT
    'RECON-FACT-SALES-TARGET-WAREHOUSE'::text AS reconciliation_id,
    format('Every accepted staging target row reaches the warehouse: %s staging row(s) against %s '
           'warehouse row(s). A lost target row is a lost DENOMINATOR, which makes every attainment '
           'percentage larger rather than making a number look missing.',
           c.staging_rows, c.warehouse_rows)                       AS description,
    'staging.stg_sales_target'::text                               AS left_source,
    c.staging_rows                                                 AS left_value,
    'warehouse.fact_sales_target'::text                            AS right_source,
    c.warehouse_rows                                               AS right_value,
    0::numeric                                                     AS tolerance,
    CASE WHEN c.staging_rows = c.warehouse_rows THEN 'passed' ELSE 'failed' END AS status
FROM chain AS c

UNION ALL

-- RECON-TGT-GRAIN -- the declared grain is the real grain -------------------------
SELECT
    'RECON-TGT-GRAIN'::text,
    format('warehouse.fact_sales_target holds %s row(s) over %s distinct (store, month, KPI, scope '
           'type, scope id) combination(s). The declared grain is enforced by '
           'uq_fact_sales_target_grain; this reconciliation proves the constraint is still on the '
           'table rather than trusting that it is.',
           c.warehouse_rows, c.distinct_grain_rows),
    'warehouse.fact_sales_target row count',
    c.warehouse_rows,
    'warehouse.fact_sales_target distinct declared grain',
    c.distinct_grain_rows,
    0::numeric,
    CASE WHEN c.warehouse_rows = c.distinct_grain_rows THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-TGT-UNITS -- store-scope unit targets, warehouse against reporting --------
SELECT
    'RECON-TGT-UNITS'::text,
    format('Store-scope retail-unit target (KPI-SLS-001 rows, the source of KPI-TGT-001): %s in the '
           'warehouse against %s in reporting.vw_target_attainment. Exact: a unit target is a whole '
           'number and no rounding stands between the two.',
           f.fact_unit_target, v.view_unit_target),
    'warehouse.fact_sales_target (Store scope, KPI-SLS-001)',
    f.fact_unit_target,
    'reporting.vw_target_attainment (Store scope, KPI-SLS-001)',
    v.view_unit_target,
    0::numeric,
    CASE WHEN f.fact_unit_target = v.view_unit_target THEN 'passed' ELSE 'failed' END
FROM store_scope_totals AS f CROSS JOIN view_scope_totals AS v

UNION ALL

-- RECON-TGT-GROSS -- store-scope gross targets, warehouse against reporting -------
SELECT
    'RECON-TGT-GROSS'::text,
    format('Store-scope total-gross target (KPI-GRS-003 rows, the source of KPI-TGT-003): %s in the '
           'warehouse against %s in reporting.vw_target_attainment, within the 0.01 currency '
           'tolerance.',
           f.fact_gross_target, v.view_gross_target),
    'warehouse.fact_sales_target (Store scope, KPI-GRS-003)',
    f.fact_gross_target,
    'reporting.vw_target_attainment (Store scope, KPI-GRS-003)',
    v.view_gross_target,
    0.01::numeric,
    CASE WHEN abs(f.fact_gross_target - v.view_gross_target) <= 0.01 THEN 'passed' ELSE 'failed' END
FROM store_scope_totals AS f CROSS JOIN view_scope_totals AS v

UNION ALL

-- RECON-TGT-DEPT-SPLIT -- the department partition of the store gross target ------
SELECT
    'RECON-TGT-DEPT-SPLIT'::text,
    format('The Sales and Finance department gross targets sum to the store total-gross target on %s '
           'of %s store-month(s), within the 0.01 currency tolerance. They are a PARTITION of the '
           'store plan, mirroring total_gross = front_end_gross + back_end_gross on the sale fact; if '
           'they stopped summing, a department view and a store view would disagree and neither would '
           'be obviously wrong.',
           d.conforming_store_months, d.store_months),
    'warehouse.fact_sales_target (Department scope) store-months conforming',
    d.conforming_store_months,
    'warehouse.fact_sales_target store-months',
    d.store_months,
    0::numeric,
    CASE WHEN d.conforming_store_months = d.store_months THEN 'passed' ELSE 'failed' END
FROM department_split AS d

UNION ALL

-- RECON-TGT-STORE-TOTALS -- per store, not merely in total ------------------------
SELECT
    'RECON-TGT-STORE-TOTALS'::text,
    format('Store-scope target totals agree between the warehouse and reporting for %s of %s '
           'store(s). Compared per store rather than in total, so two offsetting stores cannot hide '
           'each other.',
           s.conforming_stores, s.stores),
    'stores whose warehouse and reporting target totals agree',
    s.conforming_stores,
    'stores carrying a target',
    s.stores,
    0::numeric,
    CASE WHEN s.conforming_stores = s.stores THEN 'passed' ELSE 'failed' END
FROM store_totals AS s

UNION ALL

-- RECON-TGT-MONTH-TOTALS -- per month, for the same reason -----------------------
SELECT
    'RECON-TGT-MONTH-TOTALS'::text,
    format('Store-scope target totals agree between the warehouse and reporting for %s of %s '
           'month(s). A month dropped by the reporting frame fails here rather than rendering as a '
           'month with no plan.',
           m.conforming_months, m.months),
    'months whose warehouse and reporting target totals agree',
    m.conforming_months,
    'months carrying a target',
    m.months,
    0::numeric,
    CASE WHEN m.conforming_months = m.months THEN 'passed' ELSE 'failed' END
FROM month_totals AS m

UNION ALL

-- RECON-REPORT-TARGET-ROWS -- the reporting view does not fan out -----------------
SELECT
    'RECON-REPORT-TARGET-ROWS'::text,
    format('reporting.vw_target_attainment returns %s row(s) over %s distinct declared-grain '
           'combination(s), and carries a plan on %s of them against %s warehouse target row(s). The '
           'view joins four aggregates and a LEFT JOIN to the plan: a duplicated join key would '
           'double both the target and the actual, which is invisible in a percentage.',
           w.view_rows, w.view_distinct_grain, w.view_rows_with_target, c.warehouse_rows),
    'reporting.vw_target_attainment row count',
    w.view_rows,
    'reporting.vw_target_attainment distinct declared grain',
    w.view_distinct_grain,
    0::numeric,
    CASE
        WHEN w.view_rows = w.view_distinct_grain
         AND w.view_rows_with_target = c.warehouse_rows
        THEN 'passed' ELSE 'failed'
    END
FROM view_shape AS w CROSS JOIN chain AS c

UNION ALL

-- RECON-TGT-ACTUAL-UNITS -- the attainment numerator is the governed actual -------
SELECT
    'RECON-TGT-ACTUAL-UNITS'::text,
    format('The store-scope unit numerator in reporting.vw_target_attainment totals %s against %s '
           'retail units in warehouse.fact_vehicle_sale. The attainment numerator must BE '
           'KPI-SLS-001, not a second count that resembles it.',
           v.view_unit_actual, a.fact_retail_units),
    'reporting.vw_target_attainment attainment_numerator (Store scope, KPI-SLS-001)',
    v.view_unit_actual,
    'warehouse.fact_vehicle_sale retail units',
    a.fact_retail_units,
    0::numeric,
    CASE WHEN v.view_unit_actual = a.fact_retail_units THEN 'passed' ELSE 'failed' END
FROM view_scope_totals AS v CROSS JOIN fact_actuals AS a

UNION ALL

-- RECON-TGT-ACTUAL-GROSS -- the same, for gross ----------------------------------
SELECT
    'RECON-TGT-ACTUAL-GROSS'::text,
    format('The store-scope gross numerator in reporting.vw_target_attainment totals %s against %s '
           'retail total gross in warehouse.fact_vehicle_sale, within the 0.01 currency tolerance.',
           v.view_gross_actual, a.fact_total_gross),
    'reporting.vw_target_attainment attainment_numerator (Store scope, KPI-GRS-003)',
    v.view_gross_actual,
    'warehouse.fact_vehicle_sale retail total gross',
    a.fact_total_gross,
    0.01::numeric,
    CASE WHEN abs(v.view_gross_actual - a.fact_total_gross) <= 0.01 THEN 'passed' ELSE 'failed' END
FROM view_scope_totals AS v CROSS JOIN fact_actuals AS a;

COMMENT ON VIEW audit.vw_recon_target IS
    'Grain: one row per RECON-TGT-* / target-domain reconciliation rule, in the uniform shape of '
    'audit.vw_recon_result_template. Proves the target chain (staging to warehouse), the declared '
    'grain, the department partition of the store gross plan, the store and month totals through the '
    'reporting layer, that reporting.vw_target_attainment does not fan out, and that its attainment '
    'numerators ARE the governed actuals rather than a second count that resembles them. Counts and '
    'unit targets are exact; currency comparisons use the 0.01 project tolerance.';
