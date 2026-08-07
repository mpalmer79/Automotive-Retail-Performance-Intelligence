-- =============================================================================
-- File:            sql/04_facts/16_fact_sales_target_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_sales_target into warehouse.fact_sales_target, resolving every surrogate key by natural-key join.
-- Execution order: After every dimension merge, and at runtime by the Python loader.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per dealership per target scope per targeted KPI per calendar month.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL only:
-- no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction), statements
-- separated by semicolons. Safe against an empty database.
--
-- THE GRAIN IS THE CONFLICT TARGET
-- --------------------------------
-- sales_target_id is the source system's identifier and does NOT appear on the fact:
-- the fact's identity is (store, month, KPI, scope type, scope id), enforced by
-- uq_fact_sales_target_grain, and that constraint is the conflict target below. Two
-- planning revisions for one store-month-scope-metric are one fact row, not two --
-- and the later revision wins, because a plan is a current statement rather than an
-- event log. Plan history is Out of scope; DATA_DICTIONARY records that.
--
-- WHY THE STORE IS RESOLVED AS AT THE FIRST OF THE TARGET MONTH
-- -------------------------------------------------------------
-- dim_dealership is SCD Type 2, so the store is resolved as it stood on the first day
-- of the month being planned rather than as at today. A plan belongs to the store that
-- existed when it was written.
--
-- WHY THE EMPLOYEE JOIN IS A LEFT JOIN AND THE OTHERS ARE NOT
-- -----------------------------------------------------------
-- target_month_date_key and dealership_key are NOT NULL by contract: a target for a
-- month the calendar does not contain has no selling-day denominator, and a target for
-- a store that does not exist can never be attained. Both are inner joins, so such a
-- row is excluded here and recorded as a REJ-REF-001 rejection by the loader rather
-- than being defaulted to a nearby month or store.
--
-- employee_key is nullable, and an Employee-scope row whose employee does not resolve
-- must NOT silently become a store-scope-looking row with a NULL key: the fact's
-- ck_fact_sales_target_employee_scope_coupling would reject it, which is the intended
-- outcome. The LEFT JOIN is therefore paired with an explicit filter that drops an
-- Employee-scope row with no resolvable employee, so the failure is a rejection rather
-- than a constraint violation that aborts the whole load.
--
-- NOTHING IS CALCULATED HERE. No attainment, no pace, no projection: those belong to
-- reporting.vw_target_attainment. This script moves the plan and resolves keys.

WITH src AS (
    SELECT
        d.date_key                 AS target_month_date_key,
        store.dealership_key,
        s.target_scope_type,
        s.target_scope_id,
        s.department_name,
        employee.employee_key,
        s.kpi_id,
        s.target_value,
        s.stretch_target_value,
        s.source_system
    FROM staging.stg_sales_target AS s
    -- Required: the calendar. A month the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d
      ON d.date_key = s.target_month_date_key
    -- Required: the store, as it stood on the first day of the target month.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND d.full_date BETWEEN store.effective_date AND store.expiration_date
    -- Optional: the employee, on an Employee-scope row only.
    LEFT JOIN warehouse.dim_employee AS employee
      ON employee.employee_id = s.employee_id
    WHERE s.target_scope_type <> 'Employee'
       OR employee.employee_key IS NOT NULL
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.sales_target_key), 0)
         FROM warehouse.fact_sales_target AS x)
            + row_number() OVER (
                ORDER BY s.dealership_key, s.target_month_date_key,
                         s.target_scope_type, s.target_scope_id, s.kpi_id
              ) AS sales_target_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_sales_target AS f
        WHERE f.dealership_key = s.dealership_key
          AND f.target_month_date_key = s.target_month_date_key
          AND f.kpi_id = s.kpi_id
          AND f.target_scope_type = s.target_scope_type
          AND f.target_scope_id = s.target_scope_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.sales_target_key, s.*
    FROM src AS s
    JOIN warehouse.fact_sales_target AS f
      ON f.dealership_key = s.dealership_key
     AND f.target_month_date_key = s.target_month_date_key
     AND f.kpi_id = s.kpi_id
     AND f.target_scope_type = s.target_scope_type
     AND f.target_scope_id = s.target_scope_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_sales_target AS f (
    sales_target_key,
    target_month_date_key,
    dealership_key,
    target_scope_type,
    target_scope_id,
    department_name,
    employee_key,
    kpi_id,
    target_value,
    stretch_target_value,
    source_system
)
SELECT
    k.sales_target_key,
    k.target_month_date_key,
    k.dealership_key,
    k.target_scope_type,
    k.target_scope_id,
    k.department_name,
    k.employee_key,
    k.kpi_id,
    k.target_value,
    k.stretch_target_value,
    k.source_system
FROM merged AS k
ON CONFLICT (dealership_key, target_month_date_key, kpi_id,
             target_scope_type, target_scope_id) DO UPDATE
SET department_name      = EXCLUDED.department_name,
    employee_key         = EXCLUDED.employee_key,
    target_value         = EXCLUDED.target_value,
    stretch_target_value = EXCLUDED.stretch_target_value,
    source_system        = EXCLUDED.source_system
WHERE (
    f.department_name,
    f.employee_key,
    f.target_value,
    f.stretch_target_value,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.department_name,
    EXCLUDED.employee_key,
    EXCLUDED.target_value,
    EXCLUDED.stretch_target_value,
    EXCLUDED.source_system
);
