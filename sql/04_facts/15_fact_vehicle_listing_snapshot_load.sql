-- =============================================================================
-- File:            sql/04_facts/15_fact_vehicle_listing_snapshot_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Insert-only load of staging.stg_inventory_listing_snapshot into warehouse.fact_vehicle_listing_snapshot, resolving every surrogate key by natural-key join.
-- Execution order: Run by the inventory listing importer, after 03_dimensions/18_dim_observed_vehicle_load.sql. NOT part of the ordinary pipeline run.
-- Idempotency:     Rerunning the same workbook writes zero rows. ON CONFLICT DO NOTHING on the declared grain, and no UPDATE path exists at all.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One observed vehicle listing per dealership per captured_at value.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- Executed by arpi.inventory.importer through psycopg's cursor.execute() on the
-- file's whole text. Plain SQL only: no psql meta-commands, no BEGIN/COMMIT (the
-- importer owns the transaction), statements separated by semicolons. Safe against an
-- empty database and an empty staging view.
--
-- WHY THE PIPELINE DOES NOT RUN THIS
-- ----------------------------------
-- arpi.ingestion.loader executes only the fact-load scripts its registry names, and
-- this lane is registered in arpi.inventory.spec instead -- because its source is a
-- workbook a human commits, not a CSV the run just generated. A stray file in this
-- directory is never executed, which is exactly the property that lets this one live
-- beside the five MVP fact loads without joining them.
--
-- INSERT ONLY. THERE IS NO UPDATE PATH, AND THAT IS THE DESIGN
-- ------------------------------------------------------------
-- Every other ARPI fact load carries a guarded ON CONFLICT DO UPDATE, because its
-- source is a deterministic generator: a rerun reproduces byte-identical measures, so
-- the guard finds nothing to change and the update path exists for a deliberate
-- correction.
--
-- This source is not deterministic and not regenerable. A capture is a record of what
-- somebody observed at a moment that has passed, and it cannot be recomputed. An
-- UPDATE here would let a second workbook silently restate what the first one
-- observed, with no record that the number ever changed -- which is the difference
-- between a historical snapshot and a mutable current-state table.
--
-- ON CONFLICT DO NOTHING is therefore the whole conflict policy. A corrected workbook
-- for a batch already loaded is REFUSED by the importer, which checks the source file
-- digest before it lands a single raw row, and is handled through the supersession
-- procedure in data/reference/README.md section 8.
--
-- WHY dim_dealership IS JOINED ON THE CAPTURE DATE
-- ------------------------------------------------
-- dim_dealership is SCD Type 2. A capture describes what a store advertised on a
-- given day, so it resolves the store version whose [effective_date,
-- expiration_date] contains that day rather than the current one.
--
-- WHY THE DATE JOIN IS INNER
-- --------------------------
-- snapshot_date_key is NOT NULL and references warehouse.dim_date, which covers the
-- reporting window and nothing else. A capture outside that window is excluded here
-- and recorded as a REJ-REF-001 rejection by the importer, never silently dropped and
-- never defaulted. The importer's reconciliation compares staging rows against
-- inserted rows, so an unresolved date fails the import rather than shrinking it
-- quietly.

WITH src AS (
    SELECT
        d.date_key                     AS snapshot_date_key,
        store.dealership_key,
        veh.observed_vehicle_key,
        s.captured_at,
        s.odometer_miles,
        s.advertised_price,
        s.pricing_status,
        s.inventory_unit_count,
        s.source_batch_id,
        s.source_file_name,
        s.source_file_digest
    FROM staging.stg_inventory_listing_snapshot AS s
    -- Required: the calendar. A capture the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.captured_at
    -- Required: the store, as it stood on the capture date.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.captured_at BETWEEN store.effective_date AND store.expiration_date
    -- Required: the observed vehicle, merged immediately before this script ran.
    JOIN warehouse.dim_observed_vehicle AS veh
      ON veh.synthetic_vehicle_id = s.synthetic_vehicle_id
),
new_rows AS (
    -- Observations the fact has never seen. Only these consume a surrogate key, and
    -- only these are written at all.
    SELECT
        (SELECT coalesce(max(x.vehicle_listing_snapshot_key), 0)
         FROM warehouse.fact_vehicle_listing_snapshot AS x)
            + row_number() OVER (
                ORDER BY s.snapshot_date_key, s.dealership_key, s.observed_vehicle_key
              ) AS vehicle_listing_snapshot_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_vehicle_listing_snapshot AS f
        WHERE f.snapshot_date_key = s.snapshot_date_key
          AND f.dealership_key = s.dealership_key
          AND f.observed_vehicle_key = s.observed_vehicle_key
    )
)
INSERT INTO warehouse.fact_vehicle_listing_snapshot (
    vehicle_listing_snapshot_key,
    snapshot_date_key,
    dealership_key,
    observed_vehicle_key,
    captured_at,
    odometer_miles,
    advertised_price,
    pricing_status,
    inventory_unit_count,
    source_batch_id,
    source_file_name,
    source_file_digest,
    source_system
)
SELECT
    n.vehicle_listing_snapshot_key,
    n.snapshot_date_key,
    n.dealership_key,
    n.observed_vehicle_key,
    n.captured_at,
    n.odometer_miles,
    n.advertised_price,
    n.pricing_status,
    n.inventory_unit_count,
    n.source_batch_id,
    n.source_file_name,
    n.source_file_digest,
    'arpi_sanitized_public_reference'
FROM new_rows AS n
-- The second line of defence. new_rows already excludes what the fact holds; this
-- makes a concurrent import a no-op rather than a constraint violation, and it is
-- DO NOTHING rather than DO UPDATE because a historical observation is never
-- restated.
ON CONFLICT (snapshot_date_key, dealership_key, observed_vehicle_key) DO NOTHING;
