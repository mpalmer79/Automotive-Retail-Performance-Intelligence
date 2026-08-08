-- =============================================================================
-- File:            sql/09_migrations/0003_add_fi_domain_objects.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Add the two DASH.6 columns to warehouse.fact_vehicle_sale on an already-deployed database, and assert that an upgraded database really holds the whole F&I lane.
-- Execution order: Runs inside the sql/0*/*.sql sequence, after 0002_add_inventory_listing_objects.sql.
-- Idempotency:     Fully idempotent. ADD COLUMN IF NOT EXISTS, guarded ALTER TABLE for each constraint, assertions that create nothing, and a ledger insert with ON CONFLICT DO NOTHING.
-- Ownership:       Applied by the bootstrap superuser or arpi_admin.
-- Grain:           Not applicable (migration ledger entry, one ALTER TABLE, and assertions).
-- =============================================================================
--
-- WHY THIS MIGRATION CONTAINS DDL WHERE 0002 DID NOT
-- ---------------------------------------------------
-- 0002 was purely additive: every object it recorded is created by an ordered
-- `CREATE TABLE IF NOT EXISTS` script that runs on the fresh path and the upgrade path
-- alike. DASH.6 is ALMOST that -- the four raw tables, the four staging view sets, the
-- two dimensions, the two facts, the four reporting views, the three governed functions
-- and audit.vw_recon_fi are all created by ordered idempotent scripts.
--
-- Two things are not, and they are the reason this file has DDL in it:
--
--     warehouse.fact_vehicle_sale.finance_reserve_gross
--     warehouse.fact_vehicle_sale.lender_key
--
-- `CREATE TABLE IF NOT EXISTS` on a table that already exists is a NO-OP, so on a
-- deployed database those two columns would never appear, and every F&I reconciliation
-- would fail against a schema that looked complete. This is exactly the situation
-- 0001_add_logical_run_key was written for, and it is handled the same way.
--
-- THE BACKFILL, AND WHY IT IS 0.00 RATHER THAN NULL
-- --------------------------------------------------
-- finance_reserve_gross arrives NOT NULL DEFAULT 0.00. On an existing database every row
-- is backfilled to 0.00 by that default, which is the honest value: the deals already in
-- the table were generated before reserve was modelled, so the correct statement about
-- them is "no reserve is recorded", and the very next pipeline run replaces every row
-- with its real decomposition. A NULLable column would have made "earned no reserve" and
-- "predates the model" indistinguishable forever.
--
-- lender_key is nullable because NULL means NO LENDER EXISTS, which is a real state for
-- every cash deal and every disposal. Rows that predate DASH.6 therefore carry a value
-- that is legitimate rather than a sentinel.
--
-- FORWARD ONLY. There is no down-migration, by the policy in
-- sql/09_migrations/0000_migration_history.sql.

-- -----------------------------------------------------------------------------
-- 1. The two columns, and the constraints that govern them.
-- -----------------------------------------------------------------------------
ALTER TABLE warehouse.fact_vehicle_sale
    ADD COLUMN IF NOT EXISTS finance_reserve_gross numeric(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE warehouse.fact_vehicle_sale
    ADD COLUMN IF NOT EXISTS lender_key integer NULL;

DO $ck$
DECLARE
    v_ck record;
BEGIN
    FOR v_ck IN
        SELECT *
        FROM (VALUES
            ('ck_fact_vehicle_sale_finance_reserve_nonnegative',
             'finance_reserve_gross >= 0'),
            ('ck_fact_vehicle_sale_reserve_requires_financing',
             'finance_reserve_gross = 0 OR (sale_type NOT IN (''Lease'', ''Wholesale'', ''Dealer Trade'') AND amount_financed > 0)'),
            ('ck_fact_vehicle_sale_lender_requires_funding',
             'lender_key IS NULL OR sale_type = ''Lease'' OR (is_retail AND amount_financed > 0)')
        ) AS t(constraint_name, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_ck.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_vehicle_sale ADD CONSTRAINT %I CHECK (%s)',
                v_ck.constraint_name, v_ck.definition);
        END IF;
    END LOOP;
END
$ck$;

DO $fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        WHERE n.nspname = 'warehouse' AND c.conname = 'fk_fact_vehicle_sale_lender'
    ) THEN
        ALTER TABLE warehouse.fact_vehicle_sale
            ADD CONSTRAINT fk_fact_vehicle_sale_lender
            FOREIGN KEY (lender_key) REFERENCES warehouse.dim_lender (lender_key)
            ON DELETE RESTRICT;
    END IF;
END
$fk$;

-- -----------------------------------------------------------------------------
-- 2. Assert the rest of the lane exists.
-- -----------------------------------------------------------------------------
-- An upgrade that skipped or failed one of the new ordered scripts would otherwise leave
-- a database that LOOKS complete -- the migration recorded, the sequence green -- and is
-- missing a fact table. The assertion fails the deployment at the point of the omission
-- instead of at the first query.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_object  record;
BEGIN
    FOR v_object IN
        SELECT *
        FROM (VALUES
            ('raw',        'finance_product_load',                       'r'),
            ('raw',        'lender_load',                                'r'),
            ('raw',        'finance_product_sale_load',                  'r'),
            ('raw',        'finance_product_adjustment_load',            'r'),
            ('staging',    'stg_finance_product',                        'v'),
            ('staging',    'stg_finance_product_rejected',               'v'),
            ('staging',    'stg_lender',                                 'v'),
            ('staging',    'stg_lender_rejected',                        'v'),
            ('staging',    'stg_finance_product_sale',                   'v'),
            ('staging',    'stg_finance_product_sale_rejected',          'v'),
            ('staging',    'stg_finance_product_adjustment',             'v'),
            ('staging',    'stg_finance_product_adjustment_rejected',    'v'),
            ('warehouse',  'dim_finance_product',                        'r'),
            ('warehouse',  'dim_lender',                                 'r'),
            ('warehouse',  'fact_finance_product_sale',                  'r'),
            ('warehouse',  'fact_finance_product_adjustment',            'r'),
            ('reporting',  'vw_deal_product_detail',                     'v'),
            ('reporting',  'vw_fi_summary',                              'v'),
            ('reporting',  'vw_fi_product_penetration',                  'v'),
            ('reporting',  'vw_fi_adjustment_summary',                   'v'),
            ('audit',      'vw_recon_fi',                                'v')
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
            'The ARPI F&I domain (DASH.6) is incomplete: % object(s) are missing (%). Run the '
            'ordered sql/0*/*.sql sequence from the repository root; this migration adds the two '
            'fact_vehicle_sale columns that CREATE TABLE IF NOT EXISTS cannot, and asserts that '
            'the remaining scripts ran.',
            cardinality(v_missing), array_to_string(v_missing, ', ');
    END IF;
END
$$;

-- The three governed functions, asserted separately: they are not relations, so the
-- pg_class walk above cannot see them, and a database missing them would fail every
-- eligibility and structure read in the reporting layer.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_name    text;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'fn_finance_structure',
        'fn_product_category_is_eligible',
        'fn_minimum_sample_floor'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_proc AS p
            JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'warehouse' AND p.proname = v_name
        ) THEN
            v_missing := v_missing || format('warehouse.%s', v_name);
        END IF;
    END LOOP;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'The governed F&I functions are missing (%). They are the SQL layer''s single '
            'authority for the finance-structure derivation, the eligibility predicate and the '
            'minimum-sample floor; without them the reporting views cannot be created.',
            array_to_string(v_missing, ', ');
    END IF;
END
$$;

-- The two declared grains, asserted as constraints rather than trusted. A deployment
-- that created the facts without them would admit a duplicate contract on one deal and a
-- duplicate adjustment event, each of which double-counts everything built on it.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_name    text;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'uq_fact_finance_product_sale_grain',
        'uq_fact_finance_product_adjustment_adjustment_id',
        'ck_fact_finance_product_sale_gross_identity'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_name
        ) THEN
            v_missing := v_missing || v_name;
        END IF;
    END LOOP;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'The F&I facts exist without their declared grain or price identity (%). The grain is '
            'enforced by the database, not by the loader''s good intentions.',
            array_to_string(v_missing, ', ');
    END IF;
END
$$;

INSERT INTO audit.schema_migration (migration_id)
VALUES ('0003_add_fi_domain_objects')
ON CONFLICT (migration_id) DO NOTHING;
