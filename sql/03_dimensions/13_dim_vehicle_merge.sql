-- =============================================================================
-- File:            sql/03_dimensions/13_dim_vehicle_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_vehicle into warehouse.dim_vehicle.
-- Execution order: 42 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per unique physical vehicle (warehouse.dim_vehicle grain).
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
-- dim_vehicle carries no history requirement: a correction to one of its
-- attributes describes what was always true, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no fact could meaningfully
-- point at. The merge therefore overwrites in place.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- vehicle_key is assigned as
--     (SELECT coalesce(max(vehicle_key), 0) FROM warehouse.dim_vehicle)
--     + row_number() OVER (ORDER BY vehicle_id)
-- over the rows that are NEW to the dimension, rather than from a sequence:
--   * On a first load into an empty dimension this yields 1..N in vehicle_id
--     order, which is the contract's 'deterministic ordinal by natural id'.
--   * Rebuilding a database from the same CSVs reproduces identical keys. A
--     sequence would drift after any rolled-back load, because sequences are
--     non-transactional.
--   * Rows already present keep the key they were given, so a key is never
--     reused and never reassigned. Only genuinely new rows are numbered, so the
--     assignment leaves no gaps on a first load.
-- The generator-supplied key is deliberately ignored: staging exposes it as
-- source_vehicle_key, lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.
--
-- FOREIGN KEY RESOLUTION
-- ----------------------
-- vehicle_model_key is resolved by joining warehouse.dim_vehicle_model on
-- vehicle_model_id; the generator's own value is never used. The join is an
-- INNER join, so a vehicle whose model has not been loaded is not inserted.
-- That is visible rather than silent: the loader's
-- RECON-INGEST-VEHICLE-WAREHOUSE reconciliation compares the distinct natural
-- keys in staging with those that reached the warehouse and fails when they
-- differ. Execution order guarantees the model dimension is merged first
-- (13 runs after 12).

WITH src AS (
    SELECT
        s.vehicle_id AS vehicle_id,
        s.synthetic_vin AS synthetic_vin,
        m.vehicle_model_key AS vehicle_model_key,
        s.vehicle_model_id AS vehicle_model_id,
        s.condition_type AS condition_type,
        s.exterior_color AS exterior_color,
        s.interior_color AS interior_color,
        s.odometer_reading AS odometer_reading,
        s.odometer_band AS odometer_band,
        s.acquisition_source AS acquisition_source,
        s.source_system AS source_system
    FROM staging.stg_vehicle AS s
    JOIN warehouse.dim_vehicle_model AS m
      ON m.vehicle_model_id = s.vehicle_model_id
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.vehicle_key), 0) FROM warehouse.dim_vehicle AS x)
            + row_number() OVER (ORDER BY s.vehicle_id) AS vehicle_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_vehicle AS d WHERE d.vehicle_id = s.vehicle_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.vehicle_key, s.*
    FROM src AS s
    JOIN warehouse.dim_vehicle AS d ON d.vehicle_id = s.vehicle_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_vehicle AS d (
    vehicle_key,
    vehicle_id,
    synthetic_vin,
    vehicle_model_key,
    vehicle_model_id,
    condition_type,
    exterior_color,
    interior_color,
    odometer_reading,
    odometer_band,
    acquisition_source,
    source_system
)
SELECT
    k.vehicle_key,
    k.vehicle_id,
    k.synthetic_vin,
    k.vehicle_model_key,
    k.vehicle_model_id,
    k.condition_type,
    k.exterior_color,
    k.interior_color,
    k.odometer_reading,
    k.odometer_band,
    k.acquisition_source,
    k.source_system
FROM merged AS k
ON CONFLICT (vehicle_id) DO UPDATE
SET synthetic_vin            = EXCLUDED.synthetic_vin,
    vehicle_model_key        = EXCLUDED.vehicle_model_key,
    vehicle_model_id         = EXCLUDED.vehicle_model_id,
    condition_type           = EXCLUDED.condition_type,
    exterior_color           = EXCLUDED.exterior_color,
    interior_color           = EXCLUDED.interior_color,
    odometer_reading         = EXCLUDED.odometer_reading,
    odometer_band            = EXCLUDED.odometer_band,
    acquisition_source       = EXCLUDED.acquisition_source,
    source_system            = EXCLUDED.source_system
WHERE (
    d.synthetic_vin,
    d.vehicle_model_key,
    d.vehicle_model_id,
    d.condition_type,
    d.exterior_color,
    d.interior_color,
    d.odometer_reading,
    d.odometer_band,
    d.acquisition_source,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.synthetic_vin,
    EXCLUDED.vehicle_model_key,
    EXCLUDED.vehicle_model_id,
    EXCLUDED.condition_type,
    EXCLUDED.exterior_color,
    EXCLUDED.interior_color,
    EXCLUDED.odometer_reading,
    EXCLUDED.odometer_band,
    EXCLUDED.acquisition_source,
    EXCLUDED.source_system
);
