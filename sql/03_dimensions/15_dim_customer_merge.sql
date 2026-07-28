-- =============================================================================
-- File:            sql/03_dimensions/15_dim_customer_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_customer into warehouse.dim_customer.
-- Execution order: 44 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per synthetic customer (warehouse.dim_customer grain).
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
-- dim_customer carries no history requirement: a correction to one of its
-- attributes describes what was always true, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no fact could meaningfully
-- point at. The merge therefore overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- customer_key is assigned as
--     (SELECT coalesce(max(customer_key), 0) FROM warehouse.dim_customer)
--     + row_number() OVER (ORDER BY customer_id)
-- over the rows that are NEW to the dimension, rather than from a sequence:
--   * On a first load into an empty dimension this yields 1..N in customer_id
--     order, which is the contract's 'deterministic ordinal by natural id'.
--   * Rebuilding a database from the same CSVs reproduces identical keys. A
--     sequence would drift after any rolled-back load, because sequences are
--     non-transactional.
--   * Rows already present keep the key they were given, so a key is never
--     reused and never reassigned. Only genuinely new rows are numbered, so the
--     assignment leaves no gaps on a first load.
-- The generator-supplied key is deliberately ignored: staging exposes it as
-- source_customer_key, lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.

WITH src AS (
    SELECT
        s.customer_id AS customer_id,
        s.household_id AS household_id,
        s.age_band AS age_band,
        s.county AS county,
        s.state_code AS state_code,
        s.market_area AS market_area,
        s.customer_type AS customer_type,
        s.is_prior_customer AS is_prior_customer,
        s.is_service_customer AS is_service_customer,
        s.first_interaction_date AS first_interaction_date,
        s.source_system AS source_system
    FROM staging.stg_customer AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.customer_key), 0) FROM warehouse.dim_customer AS x)
            + row_number() OVER (ORDER BY s.customer_id) AS customer_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_customer AS d WHERE d.customer_id = s.customer_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.customer_key, s.*
    FROM src AS s
    JOIN warehouse.dim_customer AS d ON d.customer_id = s.customer_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_customer AS d (
    customer_key,
    customer_id,
    household_id,
    age_band,
    county,
    state_code,
    market_area,
    customer_type,
    is_prior_customer,
    is_service_customer,
    first_interaction_date,
    source_system
)
SELECT
    k.customer_key,
    k.customer_id,
    k.household_id,
    k.age_band,
    k.county,
    k.state_code,
    k.market_area,
    k.customer_type,
    k.is_prior_customer,
    k.is_service_customer,
    k.first_interaction_date,
    k.source_system
FROM merged AS k
ON CONFLICT (customer_id) DO UPDATE
SET household_id             = EXCLUDED.household_id,
    age_band                 = EXCLUDED.age_band,
    county                   = EXCLUDED.county,
    state_code               = EXCLUDED.state_code,
    market_area              = EXCLUDED.market_area,
    customer_type            = EXCLUDED.customer_type,
    is_prior_customer        = EXCLUDED.is_prior_customer,
    is_service_customer      = EXCLUDED.is_service_customer,
    first_interaction_date   = EXCLUDED.first_interaction_date,
    source_system            = EXCLUDED.source_system
WHERE (
    d.household_id,
    d.age_band,
    d.county,
    d.state_code,
    d.market_area,
    d.customer_type,
    d.is_prior_customer,
    d.is_service_customer,
    d.first_interaction_date,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.household_id,
    EXCLUDED.age_band,
    EXCLUDED.county,
    EXCLUDED.state_code,
    EXCLUDED.market_area,
    EXCLUDED.customer_type,
    EXCLUDED.is_prior_customer,
    EXCLUDED.is_service_customer,
    EXCLUDED.first_interaction_date,
    EXCLUDED.source_system
);
