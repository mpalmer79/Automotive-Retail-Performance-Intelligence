-- =============================================================================
-- File:            sql/03_dimensions/22_dim_lender_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_lender into warehouse.dim_lender.
-- Execution order: Dimension layer, after sql/03_dimensions/20_dim_lender.sql, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per fictional lender definition (warehouse.dim_lender grain).
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
-- A lender's category and program tier are properties of the invented institution,
-- and a correction to either describes what was always true. There is no history
-- requirement a fact could point at, so the merge overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- lender_key is assigned as max(existing) + row_number() OVER (ORDER BY lender_id) over the rows
-- that are NEW to the dimension, rather than from a sequence: rebuilding a database from
-- the same CSVs reproduces identical keys, and a sequence would drift after any
-- rolled-back load because sequences are non-transactional. Rows already present keep
-- the key they were given, so a key is never reused and never reassigned. The
-- generator-supplied ordinal is deliberately ignored; staging exposes it as lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE every rerun would rewrite every row, producing
-- dead tuples, pointless WAL and a misleading row count. The comparison uses IS DISTINCT
-- FROM so that a NULL on both sides counts as equal.


WITH src AS (
    SELECT
        s.lender_id AS lender_id,
        s.lender_name AS lender_name,
        s.lender_category AS lender_category,
        s.program_tier AS program_tier,
        s.active_start_date AS active_start_date,
        s.active_end_date AS active_end_date,
        s.is_active AS is_active,
        s.source_system AS source_system
    FROM staging.stg_lender AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.lender_key), 0) FROM warehouse.dim_lender AS x)
            + row_number() OVER (ORDER BY s.lender_id) AS lender_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_lender AS d WHERE d.lender_id = s.lender_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.lender_key, s.*
    FROM src AS s
    JOIN warehouse.dim_lender AS d ON d.lender_id = s.lender_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_lender AS d (
    lender_key,
    lender_id,
    lender_name,
    lender_category,
    program_tier,
    active_start_date,
    active_end_date,
    is_active,
    source_system
)
SELECT
    k.lender_key,
    k.lender_id,
    k.lender_name,
    k.lender_category,
    k.program_tier,
    k.active_start_date,
    k.active_end_date,
    k.is_active,
    k.source_system
FROM merged AS k
ON CONFLICT (lender_id) DO UPDATE
SET lender_name       = EXCLUDED.lender_name,
    lender_category   = EXCLUDED.lender_category,
    program_tier      = EXCLUDED.program_tier,
    active_start_date = EXCLUDED.active_start_date,
    active_end_date   = EXCLUDED.active_end_date,
    is_active         = EXCLUDED.is_active,
    source_system     = EXCLUDED.source_system
WHERE (
    d.lender_name,
    d.lender_category,
    d.program_tier,
    d.active_start_date,
    d.active_end_date,
    d.is_active,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.lender_name,
    EXCLUDED.lender_category,
    EXCLUDED.program_tier,
    EXCLUDED.active_start_date,
    EXCLUDED.active_end_date,
    EXCLUDED.is_active,
    EXCLUDED.source_system
);
