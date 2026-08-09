-- =============================================================================
-- File:            sql/09_migrations/0005_add_inventory_market_price_estimate.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Add the DASH.9 synthetic market price estimate to warehouse.fact_vehicle_inventory_snapshot on an already-deployed database, and assert that an upgraded database really carries it and its guard.
-- Execution order: Runs inside the sql/0*/*.sql sequence, after 0004_add_accounting_control_objects.sql.
-- Idempotency:     Fully idempotent. ADD COLUMN IF NOT EXISTS, a guarded ALTER TABLE for the constraint, assertions that create nothing, and a ledger insert with ON CONFLICT DO NOTHING.
-- Ownership:       Applied by the bootstrap superuser or arpi_admin.
-- Grain:           Not applicable (migration ledger entry, one ALTER TABLE, and assertions).
-- =============================================================================
--
-- WHY THIS MIGRATION CONTAINS DDL
-- -------------------------------
-- Same reason as 0001 and 0003, and not 0002 or 0004. DASH.9 adds one column to a table
-- that already exists:
--
--     warehouse.fact_vehicle_inventory_snapshot.market_price_estimate
--
-- `CREATE TABLE IF NOT EXISTS` on a live table is a no-op, so on a deployed database the
-- column would never appear. reporting.vw_inventory_snapshots would then fail to create --
-- it selects the column and derives price_to_market_ratio from it -- and the failure would
-- surface as a broken reporting layer rather than as the missing column it actually is.
--
-- WHY THE COLUMN IS NULLABLE, AND WHY THAT IS NOT A SENTINEL
-- -----------------------------------------------------------
-- NULL means NO ESTIMATE EXISTS FOR THIS UNIT. That is a real, permanent state: the
-- synthetic estimator declines to price a minority of units on purpose, so that
-- price_to_market_ratio has a genuinely exercised NULL branch rather than a theoretical
-- one. Rows that predate DASH.9 therefore carry a value that is legitimate rather than a
-- placeholder, and the very next pipeline run restates every row with its real estimate.
--
-- A DEFAULT of 0.00 would have been actively wrong here, which is the difference between
-- this column and finance_reserve_gross in 0003. Zero is not "no estimate": zero is a
-- denominator, and price_to_market_ratio divides by this column. The CHECK below refuses
-- it outright.
--
-- WHAT IS NOT HERE
-- ----------------
-- price_to_market_ratio is NOT a column. It is derived once, in
-- reporting.vw_inventory_snapshots, from current_asking_price and this column. Storing it
-- would create a second answer able to disagree with its own components, and the ratio has
-- no meaning independent of them.
--
-- FORWARD ONLY, by the policy in sql/09_migrations/0000_migration_history.sql.

ALTER TABLE warehouse.fact_vehicle_inventory_snapshot
    ADD COLUMN IF NOT EXISTS market_price_estimate numeric(12,2) NULL;

-- Guarded rather than unconditional: ADD CONSTRAINT has no IF NOT EXISTS, and a rerun
-- must not fail on a constraint the previous run already created.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        WHERE n.nspname = 'warehouse'
          AND c.conname = 'ck_fact_vehicle_inventory_snapshot_market_estimate_positive'
    ) THEN
        ALTER TABLE warehouse.fact_vehicle_inventory_snapshot
            ADD CONSTRAINT ck_fact_vehicle_inventory_snapshot_market_estimate_positive
            CHECK (market_price_estimate IS NULL OR market_price_estimate > 0);
    END IF;
END
$$;

COMMENT ON COLUMN warehouse.fact_vehicle_inventory_snapshot.market_price_estimate IS
    'SYNTHETIC market price reference for the unit, constant across its snapshots and '
    'anchored to the first advertised price so that a marking-down unit moves BELOW its '
    'estimate rather than dragging the estimate down with it. NULL where the estimator '
    'declined to price the unit; strictly positive otherwise, because it is the '
    'denominator of price_to_market_ratio. NOT a market valuation: no auction result, '
    'guidebook, licensed benchmark or observed transaction is consulted anywhere in this '
    'project. Never present it as a real market value.';

-- The column and its guard, asserted rather than trusted.
--
-- A present column with a missing CHECK is the worse of the two failures: the estimator
-- would be free to land a zero, price_to_market_ratio would divide by it, and the reporting
-- layer would surface a division error as though the data were malformed rather than the
-- constraint absent.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'warehouse'
          AND table_name   = 'fact_vehicle_inventory_snapshot'
          AND column_name  = 'market_price_estimate'
    ) THEN
        v_missing := v_missing || 'warehouse.fact_vehicle_inventory_snapshot.market_price_estimate';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        WHERE n.nspname = 'warehouse'
          AND c.conname = 'ck_fact_vehicle_inventory_snapshot_market_estimate_positive'
    ) THEN
        v_missing := v_missing || 'ck_fact_vehicle_inventory_snapshot_market_estimate_positive';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'reporting'
          AND table_name   = 'vw_inventory_snapshots'
          AND column_name  = 'price_to_market_ratio'
    ) THEN
        v_missing := v_missing || 'reporting.vw_inventory_snapshots.price_to_market_ratio';
    END IF;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'The ARPI synthetic market price estimate is incompletely applied: % item(s) '
            'are missing (%). Run the ordered sql/0*/*.sql sequence from the repository '
            'root; this migration adds the column and its guard, and the reporting view '
            'that derives price_to_market_ratio is created by sql/05_reporting.',
            cardinality(v_missing), array_to_string(v_missing, ', ');
    END IF;
END
$$;

INSERT INTO audit.schema_migration (migration_id)
VALUES ('0005_add_inventory_market_price_estimate')
ON CONFLICT (migration_id) DO NOTHING;
