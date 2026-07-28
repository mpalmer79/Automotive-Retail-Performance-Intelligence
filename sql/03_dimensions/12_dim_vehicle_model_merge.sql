-- =============================================================================
-- File:            sql/03_dimensions/12_dim_vehicle_model_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_vehicle_model into warehouse.dim_vehicle_model.
-- Execution order: 41 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per vehicle model, identified by model_year + make + model + trim (warehouse.dim_vehicle_model grain).
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
-- dim_vehicle_model carries no history requirement: a correction to one of its
-- attributes describes what was always true, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no fact could meaningfully
-- point at. The merge therefore overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- vehicle_model_key is assigned as
--     (SELECT coalesce(max(vehicle_model_key), 0) FROM warehouse.dim_vehicle_model)
--     + row_number() OVER (ORDER BY vehicle_model_id)
-- over the rows that are NEW to the dimension, rather than from a sequence:
--   * On a first load into an empty dimension this yields 1..N in vehicle_model_id
--     order, which is the contract's 'deterministic ordinal by natural id'.
--   * Rebuilding a database from the same CSVs reproduces identical keys. A
--     sequence would drift after any rolled-back load, because sequences are
--     non-transactional.
--   * Rows already present keep the key they were given, so a key is never
--     reused and never reassigned. Only genuinely new rows are numbered, so the
--     assignment leaves no gaps on a first load.
-- The generator-supplied key is deliberately ignored: staging exposes it as
-- source_vehicle_model_key, lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.
--
-- SECOND UNIQUE CONSTRAINT
-- ------------------------
-- The contract declares UNIQUE (model_year, make, model, trim) in addition to
-- the natural id. Staging deduplicates on vehicle_model_id, so two different
-- ids describing the same model_year+make+model+trim would raise a unique
-- violation here and fail the load. That is deliberate: it is a generator
-- defect, not a data-supplier problem, and Phase 1 rejection tolerance for
-- generator defects is zero.

WITH src AS (
    SELECT
        s.vehicle_model_id AS vehicle_model_id,
        s.model_year AS model_year,
        s.make AS make,
        s.model AS model,
        s."trim" AS "trim",
        s.body_style AS body_style,
        s.vehicle_class AS vehicle_class,
        s.fuel_type AS fuel_type,
        s.drivetrain AS drivetrain,
        s.transmission AS transmission,
        s.doors AS doors,
        s.seating_capacity AS seating_capacity,
        s.franchise_alignment AS franchise_alignment,
        s.is_current_model_line AS is_current_model_line,
        s.source_system AS source_system
    FROM staging.stg_vehicle_model AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.vehicle_model_key), 0) FROM warehouse.dim_vehicle_model AS x)
            + row_number() OVER (ORDER BY s.vehicle_model_id) AS vehicle_model_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_vehicle_model AS d WHERE d.vehicle_model_id = s.vehicle_model_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.vehicle_model_key, s.*
    FROM src AS s
    JOIN warehouse.dim_vehicle_model AS d ON d.vehicle_model_id = s.vehicle_model_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_vehicle_model AS d (
    vehicle_model_key,
    vehicle_model_id,
    model_year,
    make,
    model,
    "trim",
    body_style,
    vehicle_class,
    fuel_type,
    drivetrain,
    transmission,
    doors,
    seating_capacity,
    franchise_alignment,
    is_current_model_line,
    source_system
)
SELECT
    k.vehicle_model_key,
    k.vehicle_model_id,
    k.model_year,
    k.make,
    k.model,
    k."trim",
    k.body_style,
    k.vehicle_class,
    k.fuel_type,
    k.drivetrain,
    k.transmission,
    k.doors,
    k.seating_capacity,
    k.franchise_alignment,
    k.is_current_model_line,
    k.source_system
FROM merged AS k
ON CONFLICT (vehicle_model_id) DO UPDATE
SET model_year               = EXCLUDED.model_year,
    make                     = EXCLUDED.make,
    model                    = EXCLUDED.model,
    "trim"                   = EXCLUDED."trim",
    body_style               = EXCLUDED.body_style,
    vehicle_class            = EXCLUDED.vehicle_class,
    fuel_type                = EXCLUDED.fuel_type,
    drivetrain               = EXCLUDED.drivetrain,
    transmission             = EXCLUDED.transmission,
    doors                    = EXCLUDED.doors,
    seating_capacity         = EXCLUDED.seating_capacity,
    franchise_alignment      = EXCLUDED.franchise_alignment,
    is_current_model_line    = EXCLUDED.is_current_model_line,
    source_system            = EXCLUDED.source_system
WHERE (
    d.model_year,
    d.make,
    d.model,
    d."trim",
    d.body_style,
    d.vehicle_class,
    d.fuel_type,
    d.drivetrain,
    d.transmission,
    d.doors,
    d.seating_capacity,
    d.franchise_alignment,
    d.is_current_model_line,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.model_year,
    EXCLUDED.make,
    EXCLUDED.model,
    EXCLUDED."trim",
    EXCLUDED.body_style,
    EXCLUDED.vehicle_class,
    EXCLUDED.fuel_type,
    EXCLUDED.drivetrain,
    EXCLUDED.transmission,
    EXCLUDED.doors,
    EXCLUDED.seating_capacity,
    EXCLUDED.franchise_alignment,
    EXCLUDED.is_current_model_line,
    EXCLUDED.source_system
);
