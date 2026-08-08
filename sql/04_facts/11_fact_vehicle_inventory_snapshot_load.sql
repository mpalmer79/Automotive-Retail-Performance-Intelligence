-- =============================================================================
-- File:            sql/04_facts/11_fact_vehicle_inventory_snapshot_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_inventory_snapshot into warehouse.fact_vehicle_inventory_snapshot, resolving every surrogate key by natural-key join.
-- Execution order: 55 of 73 in the initialisation sequence, and at runtime by the Python loader after every dimension merge.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one measure actually differs, so a historical snapshot is reproduced and never restated. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per vehicle per dealership per snapshot date while the vehicle is in stock.
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. Safe against an empty database.
--
-- THE GRAIN IS THE CONFLICT TARGET
-- --------------------------------
-- The inventory snapshot has no single-column identifier: contract section 5
-- allocates none because the fact's identity IS (snapshot date, store, vehicle).
-- The conflict target below is therefore
-- uq_fact_vehicle_inventory_snapshot_grain itself, so the database -- not this
-- script's good intentions -- is what makes a second row for one vehicle on one day
-- impossible.
--
-- HISTORICAL SNAPSHOTS ARE REPRODUCED, NOT RESTATED
-- -------------------------------------------------
-- The table's own documentation requires historical snapshots to be immutable. The
-- guarded DO UPDATE delivers exactly that: the generator is deterministic, so a
-- rerun produces byte-identical measures, the IS DISTINCT FROM guard finds nothing
-- to change, and yesterday's aged inventory is left precisely as it was. The update
-- path exists so a genuine correction can be applied deliberately, not so that
-- every rerun rewrites history.
--
-- WHY THE DATE JOIN IS INNER
-- --------------------------
-- snapshot_date_key is NOT NULL and references warehouse.dim_date, which covers the
-- reporting window and nothing else. The generator already clips the emitted dates
-- to that window; a row outside it is excluded here and recorded as a REJ-REF-001
-- rejection in audit.rejected_record by the loader, never silently dropped and
-- never defaulted.
--
-- WHY dim_dealership IS JOINED ON THE SNAPSHOT DATE
-- -------------------------------------------------
-- dim_dealership is SCD Type 2. A snapshot describes where a unit stood on a given
-- day, so it resolves the store version whose [effective_date, expiration_date]
-- contains that day rather than the current one.
--
-- SEMI-ADDITIVITY IS A PROPERTY OF THE DATA, NOT OF THIS SCRIPT
-- -------------------------------------------------------------
-- inventory_investment, acquisition_cost, reconditioning_cost, current_asking_price
-- and inventory_unit_count are semi-additive: additive across vehicle, store and
-- model, never across time. Nothing here can enforce that; it is enforced by the
-- reporting layer and stated on every column comment of the fact table.

WITH src AS (
    SELECT
        d.date_key                     AS snapshot_date_key,
        store.dealership_key,
        veh.vehicle_key,
        model.vehicle_model_key,
        s.current_asking_price,
        s.original_asking_price,
        s.msrp,
        s.acquisition_cost,
        s.reconditioning_cost,
        s.inventory_investment,
        s.market_price_estimate,
        s.days_in_stock,
        s.age_bucket,
        s.markdown_count_to_date,
        s.inventory_unit_count,
        s.source_system
    FROM staging.stg_inventory_snapshot AS s
    -- Required: the calendar. A date the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.snapshot_date
    -- Required: the store, as it stood on the snapshot date.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.snapshot_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the unit and its model. The model key is denormalised onto the fact
    -- so a model-level aging report needs no second hop through dim_vehicle.
    JOIN warehouse.dim_vehicle AS veh
      ON veh.vehicle_id = s.vehicle_id
    JOIN warehouse.dim_vehicle_model AS model
      ON model.vehicle_model_id = s.vehicle_model_id
),
new_rows AS (
    -- Rows the fact has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.inventory_snapshot_key), 0)
         FROM warehouse.fact_vehicle_inventory_snapshot AS x)
            + row_number() OVER (
                ORDER BY s.snapshot_date_key, s.dealership_key, s.vehicle_key
              ) AS inventory_snapshot_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_vehicle_inventory_snapshot AS f
        WHERE f.snapshot_date_key = s.snapshot_date_key
          AND f.dealership_key = s.dealership_key
          AND f.vehicle_key = s.vehicle_key
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.inventory_snapshot_key, s.*
    FROM src AS s
    JOIN warehouse.fact_vehicle_inventory_snapshot AS f
      ON f.snapshot_date_key = s.snapshot_date_key
     AND f.dealership_key = s.dealership_key
     AND f.vehicle_key = s.vehicle_key
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_vehicle_inventory_snapshot AS f (
    inventory_snapshot_key,
    snapshot_date_key,
    dealership_key,
    vehicle_key,
    vehicle_model_key,
    current_asking_price,
    original_asking_price,
    msrp,
    acquisition_cost,
    reconditioning_cost,
    inventory_investment,
    market_price_estimate,
    days_in_stock,
    age_bucket,
    markdown_count_to_date,
    inventory_unit_count,
    source_system
)
SELECT
    k.inventory_snapshot_key,
    k.snapshot_date_key,
    k.dealership_key,
    k.vehicle_key,
    k.vehicle_model_key,
    k.current_asking_price,
    k.original_asking_price,
    k.msrp,
    k.acquisition_cost,
    k.reconditioning_cost,
    k.inventory_investment,
    k.market_price_estimate,
    k.days_in_stock,
    k.age_bucket,
    k.markdown_count_to_date,
    k.inventory_unit_count,
    k.source_system
FROM merged AS k
ON CONFLICT (snapshot_date_key, dealership_key, vehicle_key) DO UPDATE
SET vehicle_model_key      = EXCLUDED.vehicle_model_key,
    current_asking_price   = EXCLUDED.current_asking_price,
    original_asking_price  = EXCLUDED.original_asking_price,
    msrp                   = EXCLUDED.msrp,
    acquisition_cost       = EXCLUDED.acquisition_cost,
    reconditioning_cost    = EXCLUDED.reconditioning_cost,
    inventory_investment   = EXCLUDED.inventory_investment,
    market_price_estimate  = EXCLUDED.market_price_estimate,
    days_in_stock          = EXCLUDED.days_in_stock,
    age_bucket             = EXCLUDED.age_bucket,
    markdown_count_to_date = EXCLUDED.markdown_count_to_date,
    inventory_unit_count   = EXCLUDED.inventory_unit_count,
    source_system          = EXCLUDED.source_system
WHERE (
    f.vehicle_model_key,
    f.current_asking_price,
    f.original_asking_price,
    f.msrp,
    f.acquisition_cost,
    f.reconditioning_cost,
    f.inventory_investment,
    f.market_price_estimate,
    f.days_in_stock,
    f.age_bucket,
    f.markdown_count_to_date,
    f.inventory_unit_count,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.vehicle_model_key,
    EXCLUDED.current_asking_price,
    EXCLUDED.original_asking_price,
    EXCLUDED.msrp,
    EXCLUDED.acquisition_cost,
    EXCLUDED.reconditioning_cost,
    EXCLUDED.inventory_investment,
    EXCLUDED.market_price_estimate,
    EXCLUDED.days_in_stock,
    EXCLUDED.age_bucket,
    EXCLUDED.markdown_count_to_date,
    EXCLUDED.inventory_unit_count,
    EXCLUDED.source_system
);
