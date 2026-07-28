-- =============================================================================
-- File:            sql/03_dimensions/17_dim_marketing_campaign_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_marketing_campaign into warehouse.dim_marketing_campaign.
-- Execution order: 46 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per marketing campaign (warehouse.dim_marketing_campaign grain).
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
-- dim_marketing_campaign carries no history requirement: a correction to one of its
-- attributes describes what was always true, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no fact could meaningfully
-- point at. The merge therefore overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- campaign_key is assigned as
--     (SELECT coalesce(max(campaign_key), 0) FROM warehouse.dim_marketing_campaign)
--     + row_number() OVER (ORDER BY campaign_id)
-- over the rows that are NEW to the dimension, rather than from a sequence:
--   * On a first load into an empty dimension this yields 1..N in campaign_id
--     order, which is the contract's 'deterministic ordinal by natural id'.
--   * Rebuilding a database from the same CSVs reproduces identical keys. A
--     sequence would drift after any rolled-back load, because sequences are
--     non-transactional.
--   * Rows already present keep the key they were given, so a key is never
--     reused and never reassigned. Only genuinely new rows are numbered, so the
--     assignment leaves no gaps on a first load.
-- The generator-supplied key is deliberately ignored: staging exposes it as
-- source_campaign_key, lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.

WITH src AS (
    SELECT
        s.campaign_id AS campaign_id,
        s.campaign_name AS campaign_name,
        s.channel AS channel,
        s.vendor_name AS vendor_name,
        s.lead_source_id AS lead_source_id,
        s.start_date AS start_date,
        s.end_date AS end_date,
        s.target_department AS target_department,
        s.target_vehicle_category AS target_vehicle_category,
        s.source_system AS source_system
    FROM staging.stg_marketing_campaign AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.campaign_key), 0) FROM warehouse.dim_marketing_campaign AS x)
            + row_number() OVER (ORDER BY s.campaign_id) AS campaign_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_marketing_campaign AS d WHERE d.campaign_id = s.campaign_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.campaign_key, s.*
    FROM src AS s
    JOIN warehouse.dim_marketing_campaign AS d ON d.campaign_id = s.campaign_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_marketing_campaign AS d (
    campaign_key,
    campaign_id,
    campaign_name,
    channel,
    vendor_name,
    lead_source_id,
    start_date,
    end_date,
    target_department,
    target_vehicle_category,
    source_system
)
SELECT
    k.campaign_key,
    k.campaign_id,
    k.campaign_name,
    k.channel,
    k.vendor_name,
    k.lead_source_id,
    k.start_date,
    k.end_date,
    k.target_department,
    k.target_vehicle_category,
    k.source_system
FROM merged AS k
ON CONFLICT (campaign_id) DO UPDATE
SET campaign_name            = EXCLUDED.campaign_name,
    channel                  = EXCLUDED.channel,
    vendor_name              = EXCLUDED.vendor_name,
    lead_source_id           = EXCLUDED.lead_source_id,
    start_date               = EXCLUDED.start_date,
    end_date                 = EXCLUDED.end_date,
    target_department        = EXCLUDED.target_department,
    target_vehicle_category  = EXCLUDED.target_vehicle_category,
    source_system            = EXCLUDED.source_system
WHERE (
    d.campaign_name,
    d.channel,
    d.vendor_name,
    d.lead_source_id,
    d.start_date,
    d.end_date,
    d.target_department,
    d.target_vehicle_category,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.campaign_name,
    EXCLUDED.channel,
    EXCLUDED.vendor_name,
    EXCLUDED.lead_source_id,
    EXCLUDED.start_date,
    EXCLUDED.end_date,
    EXCLUDED.target_department,
    EXCLUDED.target_vehicle_category,
    EXCLUDED.source_system
);
