-- =============================================================================
-- File:            sql/03_dimensions/16_dim_lead_source_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_lead_source into warehouse.dim_lead_source.
-- Execution order: 45 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per normalised lead source (warehouse.dim_lead_source grain).
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file
-- name and executes each file's whole text through psycopg's cursor.execute().
-- Plain SQL only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the
-- transaction), statements separated by semicolons. The script must also be safe
-- to run inside the ordinary initialisation sequence against an empty database:
-- with no raw rows the staging view yields nothing and every statement affects
-- zero rows.
--
-- WHY TYPE 1
-- ----------
-- dim_lead_source carries no history requirement: a correction to one of its
-- attributes describes what was always true, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no fact could meaningfully
-- point at. The merge therefore overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- lead_source_key is assigned as
--     (SELECT coalesce(max(lead_source_key), 0) FROM warehouse.dim_lead_source)
--     + row_number() OVER (ORDER BY lead_source_id)
-- over the rows that are NEW to the dimension, rather than from a sequence:
--   * On a first load into an empty dimension this yields 1..N in lead_source_id
--     order, which is the contract's 'deterministic ordinal by natural id'.
--   * Rebuilding a database from the same CSVs reproduces identical keys. A
--     sequence would drift after any rolled-back load, because sequences are
--     non-transactional.
--   * Rows already present keep the key they were given, so a key is never
--     reused and never reassigned. Only genuinely new rows are numbered, so the
--     assignment leaves no gaps on a first load.
-- The generator-supplied key is deliberately ignored: staging exposes it as
-- source_lead_source_key, lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.

WITH src AS (
    SELECT
        s.lead_source_id AS lead_source_id,
        s.lead_source_name AS lead_source_name,
        s.source_category AS source_category,
        s.is_paid AS is_paid,
        s.is_digital AS is_digital,
        s.is_third_party AS is_third_party,
        s.is_internal AS is_internal,
        s.source_system AS source_system
    FROM staging.stg_lead_source AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.lead_source_key), 0) FROM warehouse.dim_lead_source AS x)
            + row_number() OVER (ORDER BY s.lead_source_id) AS lead_source_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_lead_source AS d WHERE d.lead_source_id = s.lead_source_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.lead_source_key, s.*
    FROM src AS s
    JOIN warehouse.dim_lead_source AS d ON d.lead_source_id = s.lead_source_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_lead_source AS d (
    lead_source_key,
    lead_source_id,
    lead_source_name,
    source_category,
    is_paid,
    is_digital,
    is_third_party,
    is_internal,
    source_system
)
SELECT
    k.lead_source_key,
    k.lead_source_id,
    k.lead_source_name,
    k.source_category,
    k.is_paid,
    k.is_digital,
    k.is_third_party,
    k.is_internal,
    k.source_system
FROM merged AS k
ON CONFLICT (lead_source_id) DO UPDATE
SET lead_source_name         = EXCLUDED.lead_source_name,
    source_category          = EXCLUDED.source_category,
    is_paid                  = EXCLUDED.is_paid,
    is_digital               = EXCLUDED.is_digital,
    is_third_party           = EXCLUDED.is_third_party,
    is_internal              = EXCLUDED.is_internal,
    source_system            = EXCLUDED.source_system
WHERE (
    d.lead_source_name,
    d.source_category,
    d.is_paid,
    d.is_digital,
    d.is_third_party,
    d.is_internal,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.lead_source_name,
    EXCLUDED.source_category,
    EXCLUDED.is_paid,
    EXCLUDED.is_digital,
    EXCLUDED.is_third_party,
    EXCLUDED.is_internal,
    EXCLUDED.source_system
);
