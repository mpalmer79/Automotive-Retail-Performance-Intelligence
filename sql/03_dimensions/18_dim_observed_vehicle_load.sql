-- =============================================================================
-- File:            sql/03_dimensions/18_dim_observed_vehicle_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_inventory_listing_snapshot into warehouse.dim_observed_vehicle, widening the observation window rather than restating it.
-- Execution order: Run by the inventory listing importer, before the listing fact load. NOT part of the ordinary pipeline run.
-- Idempotency:     Rerunning with unchanged source writes zero rows. The UPDATE fires only when a descriptive attribute actually changed or the observation window genuinely widened.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per sanitized physical vehicle identity observed through a public listing source.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- Executed by arpi.inventory.importer through psycopg's cursor.execute() on the
-- file's whole text. Plain SQL only: no psql meta-commands, no BEGIN/COMMIT (the
-- importer owns the transaction), statements separated by semicolons. Safe against an
-- empty database and against an empty staging view.
--
-- WHY THIS FILE IS NAMED _load AND NOT _merge
-- -------------------------------------------
-- The suffix is load-bearing. arpi.ingestion.loader globs
-- sql/03_dimensions/*_merge.sql and runs EVERY match on EVERY pipeline run. That is
-- correct for the eight generated dimensions, whose source is produced by the same
-- run. This dimension's source is a workbook a human commits on a cadence nobody
-- schedules, and a pipeline run that finds no workbook has not failed -- it has
-- nothing to do.
--
-- Naming this file *_merge.sql would sweep it into that set. It would be harmless
-- today, because an empty staging view makes it a no-op, and it would become a lie
-- the moment somebody read a green pipeline run as evidence that the listing lane had
-- been loaded. The importer runs this file explicitly, by name, from
-- arpi.inventory.spec.INVENTORY_LISTING_SOURCE.dimension_merge_script.
--
-- THE OBSERVATION WINDOW ONLY EVER WIDENS
-- ---------------------------------------
-- first_observed_at takes the LEAST of what is known and what has arrived;
-- last_observed_at takes the GREATEST. Importing an older snapshot after a newer one
-- therefore extends the window backwards and leaves the newer end alone, which is
-- what "we have now seen this vehicle over a longer period" means. Nothing here can
-- narrow a window, because narrowing one would be forgetting an observation that
-- actually happened.
--
-- DESCRIPTIVE ATTRIBUTES FOLLOW THE MOST RECENT OBSERVATION
-- ---------------------------------------------------------
-- When two snapshots describe one vehicle differently -- a corrected trim, a
-- re-listed condition -- the LATER capture wins, and the earlier fact rows are left
-- exactly as they were. That is the Type 1 bargain stated in the table header: the
-- dimension describes the vehicle as last seen, the fact describes each observation.

WITH source AS (
    -- One row per observed vehicle within this batch, carrying the attributes of its
    -- latest capture and the window the batch itself observed.
    SELECT DISTINCT ON (s.synthetic_vehicle_id)
        s.synthetic_vehicle_id,
        s.synthetic_vin,
        s.condition_type,
        s.model_year::smallint AS model_year,
        s.make,
        s.model,
        s.trim,
        s.vehicle_display,
        min(s.captured_at) OVER (PARTITION BY s.synthetic_vehicle_id) AS batch_first_observed_at,
        max(s.captured_at) OVER (PARTITION BY s.synthetic_vehicle_id) AS batch_last_observed_at
    FROM staging.stg_inventory_listing_snapshot AS s
    ORDER BY s.synthetic_vehicle_id, s.captured_at DESC, s.raw_record_id DESC
),
new_rows AS (
    -- Vehicles the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.observed_vehicle_key), 0)
         FROM warehouse.dim_observed_vehicle AS x)
            + row_number() OVER (ORDER BY s.synthetic_vehicle_id) AS observed_vehicle_key,
        s.*
    FROM source AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.dim_observed_vehicle AS d
        WHERE d.synthetic_vehicle_id = s.synthetic_vehicle_id
    )
)
INSERT INTO warehouse.dim_observed_vehicle (
    observed_vehicle_key,
    synthetic_vehicle_id,
    synthetic_vin,
    condition_type,
    model_year,
    make,
    model,
    trim,
    vehicle_display,
    source_system,
    first_observed_at,
    last_observed_at
)
SELECT
    n.observed_vehicle_key,
    n.synthetic_vehicle_id,
    n.synthetic_vin,
    n.condition_type,
    n.model_year,
    n.make,
    n.model,
    n.trim,
    n.vehicle_display,
    'arpi_sanitized_public_reference',
    n.batch_first_observed_at,
    n.batch_last_observed_at
FROM new_rows AS n;

-- Existing vehicles: refresh the descriptive attributes from the latest capture and
-- widen the observation window. Guarded, so an unchanged rerun updates nothing at all
-- and the row's contents are proof of that rather than a claim about it.
WITH source AS (
    SELECT DISTINCT ON (s.synthetic_vehicle_id)
        s.synthetic_vehicle_id,
        s.synthetic_vin,
        s.condition_type,
        s.model_year::smallint AS model_year,
        s.make,
        s.model,
        s.trim,
        s.vehicle_display,
        min(s.captured_at) OVER (PARTITION BY s.synthetic_vehicle_id) AS batch_first_observed_at,
        max(s.captured_at) OVER (PARTITION BY s.synthetic_vehicle_id) AS batch_last_observed_at
    FROM staging.stg_inventory_listing_snapshot AS s
    ORDER BY s.synthetic_vehicle_id, s.captured_at DESC, s.raw_record_id DESC
)
UPDATE warehouse.dim_observed_vehicle AS d
SET synthetic_vin     = s.synthetic_vin,
    condition_type    = s.condition_type,
    model_year        = s.model_year,
    make              = s.make,
    model             = s.model,
    trim              = s.trim,
    vehicle_display   = s.vehicle_display,
    first_observed_at = least(d.first_observed_at, s.batch_first_observed_at),
    last_observed_at  = greatest(d.last_observed_at, s.batch_last_observed_at)
FROM source AS s
WHERE d.synthetic_vehicle_id = s.synthetic_vehicle_id
  AND (
        d.synthetic_vin,
        d.condition_type,
        d.model_year,
        d.make,
        d.model,
        d.trim,
        d.vehicle_display,
        d.first_observed_at,
        d.last_observed_at
      ) IS DISTINCT FROM (
        s.synthetic_vin,
        s.condition_type,
        s.model_year,
        s.make,
        s.model,
        s.trim,
        s.vehicle_display,
        least(d.first_observed_at, s.batch_first_observed_at),
        greatest(d.last_observed_at, s.batch_last_observed_at)
      );
