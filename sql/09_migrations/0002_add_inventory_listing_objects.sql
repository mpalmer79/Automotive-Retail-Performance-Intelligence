-- =============================================================================
-- File:            sql/09_migrations/0002_add_inventory_listing_objects.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Record the ARPI Inventory Operations objects as an applied migration, and assert that an upgraded database actually holds them (ADR-0011).
-- Execution order: Runs inside the sql/0*/*.sql sequence, after 0001_add_logical_run_key.sql.
-- Idempotency:     Fully idempotent. Creates nothing; asserts what the ordered scripts already created, then records itself once.
-- Ownership:       Applied by the bootstrap superuser or arpi_admin.
-- Grain:           Not applicable (migration ledger entry plus assertions).
-- =============================================================================
--
-- WHY THIS MIGRATION CREATES NOTHING
-- ----------------------------------
-- 0001 had to contain its own DDL because it CHANGED an object that already existed:
-- `CREATE TABLE IF NOT EXISTS` on a live table is a no-op, so a new column would never
-- have appeared on a deployed database.
--
-- This increment is purely ADDITIVE. Every object it introduces --
-- raw.inventory_listing_snapshot_load, the three staging views,
-- warehouse.dim_observed_vehicle, warehouse.fact_vehicle_listing_snapshot, the six
-- reporting views, the listing indexes and audit.vw_recon_inventory_listing -- is
-- created by an ordered, idempotent script in sql/01_raw through sql/08_validation.
-- Those scripts run on the fresh path and the upgrade path alike, because
-- `CREATE TABLE IF NOT EXISTS` on a table that does not exist creates it. Repeating
-- the DDL here would produce two definitions of one object, and the day they
-- disagreed the database would depend on which ran last.
--
-- WHAT IT DOES INSTEAD, AND WHY THAT IS WORTH A MIGRATION
-- -------------------------------------------------------
-- Two things a ledger entry alone would not give:
--
--   1. IT ASSERTS. An upgrade that skipped or failed one of the new scripts would
--      otherwise leave a database that looks complete -- the migration recorded, the
--      sequence green -- and is missing a fact table. The assertions below fail the
--      deployment at the point of the omission instead.
--   2. IT DATES THE CHANGE. audit.schema_migration is where an operator looks to ask
--      "when did this database gain the listing lane?". An additive increment that
--      recorded nothing would be invisible there.
--
-- FORWARD ONLY. There is no down-migration, by the policy in
-- sql/09_migrations/0000_migration_history.sql. Removing the listing lane from a
-- deployed database is a documented removal procedure in data/reference/README.md
-- section 8, not a script that has never been executed.

DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_object  record;
BEGIN
    FOR v_object IN
        SELECT *
        FROM (VALUES
            ('raw',        'inventory_listing_snapshot_load',            'r'),
            ('staging',    'stg_inventory_listing_snapshot_typed',       'v'),
            ('staging',    'stg_inventory_listing_snapshot',             'v'),
            ('staging',    'stg_inventory_listing_snapshot_rejected',    'v'),
            ('warehouse',  'dim_observed_vehicle',                       'r'),
            ('warehouse',  'fact_vehicle_listing_snapshot',              'r'),
            ('reporting',  'vw_vehicle_listing_current',                 'v'),
            ('reporting',  'vw_vehicle_listing_summary',                 'v'),
            ('reporting',  'vw_vehicle_listing_model_mix',               'v'),
            ('reporting',  'vw_vehicle_listing_price_completeness',      'v'),
            ('reporting',  'vw_vehicle_listing_observation_span',        'v'),
            ('reporting',  'vw_vehicle_listing_change',                  'v'),
            ('audit',      'vw_recon_inventory_listing',                 'v')
        ) AS t(schema_name, object_name, object_kind)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = v_object.schema_name
              AND c.relname = v_object.object_name
              AND c.relkind = v_object.object_kind
        ) THEN
            v_missing := v_missing || format('%s.%s', v_object.schema_name, v_object.object_name);
        END IF;
    END LOOP;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'ARPI Inventory Operations is incomplete: % object(s) are missing (%). Run the '
            'ordered sql/0*/*.sql sequence from the repository root; this migration asserts '
            'those scripts ran and does not create their objects.',
            cardinality(v_missing), array_to_string(v_missing, ', ');
    END IF;
END
$$;

-- The declared grain of the listing fact, asserted as a constraint rather than trusted.
-- A deployment that created the table without its grain constraint would admit two rows
-- for one vehicle on one capture, which double-counts every listing measure built on it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        WHERE n.nspname = 'warehouse'
          AND c.conname = 'uq_fact_vehicle_listing_snapshot_grain'
    ) THEN
        RAISE EXCEPTION
            'warehouse.fact_vehicle_listing_snapshot exists without '
            'uq_fact_vehicle_listing_snapshot_grain. The declared grain is enforced by the '
            'database, not by the importer''s good intentions.';
    END IF;
END
$$;

INSERT INTO audit.schema_migration (migration_id)
VALUES ('0002_add_inventory_listing_objects')
ON CONFLICT (migration_id) DO NOTHING;
