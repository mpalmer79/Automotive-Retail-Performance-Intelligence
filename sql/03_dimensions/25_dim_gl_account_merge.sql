-- =============================================================================
-- File:            sql/03_dimensions/25_dim_gl_account_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_gl_account into warehouse.dim_gl_account.
-- Execution order: Dimension layer, after sql/03_dimensions/24_dim_gl_account.sql, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per selected synthetic GL control account (warehouse.dim_gl_account grain).
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file name
-- and executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. The script must also be safe inside the ordinary
-- initialisation sequence against an empty database.
--
-- WHY TYPE 1 (ADR-0006)
-- ---------------------
-- An account's number, name and category are properties of the invented account, and a
-- correction to any of them describes what was always true. No fact points at a
-- historical version of an account definition -- fact_gl_control_balance resolves the
-- account as it is -- so there is no history requirement and the merge overwrites in
-- place. The active window is carried as attributes for the same reason.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- gl_account_key is assigned as max(existing) + row_number() OVER (ORDER BY gl_account_id)
-- over the rows that are NEW to the dimension, rather than from a sequence: rebuilding a
-- database from the same CSVs reproduces identical keys, and a sequence would drift after
-- any rolled-back load because sequences are non-transactional. Rows already present keep
-- the key they were given, so a key is never reused and never reassigned.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE every rerun would rewrite every row, producing
-- dead tuples, pointless WAL and a misleading row count. The comparison uses IS DISTINCT
-- FROM so that a NULL on both sides counts as equal -- active_end_date is NULL on every
-- open account, so an unguarded comparison would rewrite the whole catalogue every run.


WITH src AS (
    SELECT
        s.gl_account_id AS gl_account_id,
        s.account_number AS account_number,
        s.account_name AS account_name,
        s.account_category AS account_category,
        s.account_type AS account_type,
        s.normal_balance AS normal_balance,
        s.inventory_control_flag AS inventory_control_flag,
        s.active_start_date AS active_start_date,
        s.active_end_date AS active_end_date,
        s.source_system AS source_system
    FROM staging.stg_gl_account AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.gl_account_key), 0) FROM warehouse.dim_gl_account AS x)
            + row_number() OVER (ORDER BY s.gl_account_id) AS gl_account_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_gl_account AS d WHERE d.gl_account_id = s.gl_account_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.gl_account_key, s.*
    FROM src AS s
    JOIN warehouse.dim_gl_account AS d ON d.gl_account_id = s.gl_account_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_gl_account AS d (
    gl_account_key,
    gl_account_id,
    account_number,
    account_name,
    account_category,
    account_type,
    normal_balance,
    inventory_control_flag,
    active_start_date,
    active_end_date,
    source_system
)
SELECT
    k.gl_account_key,
    k.gl_account_id,
    k.account_number,
    k.account_name,
    k.account_category,
    k.account_type,
    k.normal_balance,
    k.inventory_control_flag,
    k.active_start_date,
    k.active_end_date,
    k.source_system
FROM merged AS k
ON CONFLICT (gl_account_id) DO UPDATE
SET account_number         = EXCLUDED.account_number,
    account_name           = EXCLUDED.account_name,
    account_category       = EXCLUDED.account_category,
    account_type           = EXCLUDED.account_type,
    normal_balance         = EXCLUDED.normal_balance,
    inventory_control_flag = EXCLUDED.inventory_control_flag,
    active_start_date      = EXCLUDED.active_start_date,
    active_end_date        = EXCLUDED.active_end_date,
    source_system          = EXCLUDED.source_system
WHERE (
    d.account_number,
    d.account_name,
    d.account_category,
    d.account_type,
    d.normal_balance,
    d.inventory_control_flag,
    d.active_start_date,
    d.active_end_date,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.account_number,
    EXCLUDED.account_name,
    EXCLUDED.account_category,
    EXCLUDED.account_type,
    EXCLUDED.normal_balance,
    EXCLUDED.inventory_control_flag,
    EXCLUDED.active_start_date,
    EXCLUDED.active_end_date,
    EXCLUDED.source_system
);
