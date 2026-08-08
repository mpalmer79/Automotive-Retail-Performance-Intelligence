-- =============================================================================
-- File:            sql/09_migrations/0004_add_accounting_control_objects.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Record the DASH.8 inventory accounting and GL control objects as an applied migration, and assert that an upgraded database actually holds them.
-- Execution order: Runs inside the sql/0*/*.sql sequence, after 0003_add_fi_domain_objects.sql.
-- Idempotency:     Fully idempotent. Creates nothing; asserts what the ordered scripts already created, then records itself once.
-- Ownership:       Applied by the bootstrap superuser or arpi_admin.
-- Grain:           Not applicable (migration ledger entry plus assertions).
-- =============================================================================
--
-- WHY THIS MIGRATION CREATES NOTHING
-- ----------------------------------
-- 0001 and 0003 had to contain their own DDL because they CHANGED objects that already
-- existed: `CREATE TABLE IF NOT EXISTS` on a live table is a no-op, so a new column would
-- never have appeared on a deployed database.
--
-- DASH.8 is purely ADDITIVE. It changes no existing table. Every object it introduces --
-- the three raw landing tables, the three staging view sets, warehouse.dim_gl_account,
-- warehouse.fact_inventory_accounting_snapshot, warehouse.fact_gl_control_balance, the
-- three reporting views, the accounting indexes and audit.vw_recon_accounting -- is
-- created by an ordered, idempotent script in sql/01_raw through sql/08_validation, which
-- runs on the fresh path and the upgrade path alike. Repeating that DDL here would
-- produce two definitions of one object, and the day they disagreed the database would
-- depend on which ran last.
--
-- That `fact_vehicle_sale` is untouched is itself part of the increment's contract: pack
-- stays a front-gross deduction, KPI-GRS-001 is unchanged, and nothing about the sale fact
-- needed to move for an inventory control schedule to reconcile.
--
-- WHAT IT DOES INSTEAD, AND WHY THAT IS WORTH A MIGRATION
-- -------------------------------------------------------
-- The same two things 0002 does:
--
--   1. IT ASSERTS. An upgrade that skipped or failed one of the new scripts would
--      otherwise leave a database that looks complete -- migration recorded, sequence
--      green -- and is missing the fact the whole reconciliation rests on. Worse than a
--      missing fact is a PRESENT fact with a missing constraint: the assertions below
--      check the two that carry the domain, because a schedule without its book-value
--      identity would load nonsense quietly and reconcile against it.
--   2. IT DATES THE CHANGE. audit.schema_migration is where an operator looks to ask
--      "when did this database gain the accounting control lane?". An additive increment
--      that recorded nothing would be invisible there.
--
-- FORWARD ONLY, by the policy in sql/09_migrations/0000_migration_history.sql.

DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_object  record;
BEGIN
    FOR v_object IN
        SELECT *
        FROM (VALUES
            ('raw',        'inventory_accounting_load',                  'r'),
            ('raw',        'gl_account_load',                            'r'),
            ('raw',        'gl_control_balance_load',                    'r'),
            ('staging',    'stg_inventory_accounting_typed',             'v'),
            ('staging',    'stg_inventory_accounting',                   'v'),
            ('staging',    'stg_inventory_accounting_rejected',          'v'),
            ('staging',    'stg_gl_account_typed',                       'v'),
            ('staging',    'stg_gl_account',                             'v'),
            ('staging',    'stg_gl_account_rejected',                    'v'),
            ('staging',    'stg_gl_control_balance_typed',               'v'),
            ('staging',    'stg_gl_control_balance',                     'v'),
            ('staging',    'stg_gl_control_balance_rejected',            'v'),
            ('warehouse',  'dim_gl_account',                             'r'),
            ('warehouse',  'fact_inventory_accounting_snapshot',         'r'),
            ('warehouse',  'fact_gl_control_balance',                    'r'),
            ('reporting',  'vw_inventory_accounting',                    'v'),
            ('reporting',  'vw_inventory_gl_reconciliation',             'v'),
            ('reporting',  'vw_accounting_exceptions',                   'v'),
            ('audit',      'vw_recon_accounting',                        'v')
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
            'The ARPI inventory accounting and GL control lane is incomplete: % object(s) '
            'are missing (%). Run the ordered sql/0*/*.sql sequence from the repository '
            'root; this migration asserts those scripts ran and does not create their '
            'objects.',
            cardinality(v_missing), array_to_string(v_missing, ', ');
    END IF;
END
$$;

-- The two constraints the domain rests on, asserted rather than trusted.
--
-- The book-value identity is the whole reason a subledger balance means anything: a
-- schedule loaded without it would carry carrying values that agree with no components,
-- and the GL reconciliation would compare a real balance against a fictional one and
-- report `Reconciled`. The grain constraints are the second half of the same point --
-- a duplicated schedule line counts a unit's carrying amount twice and manufactures a
-- variance that is not there.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_constraint record;
BEGIN
    FOR v_constraint IN
        SELECT *
        FROM (VALUES
            ('ck_fact_inventory_accounting_book_value_identity'),
            ('uq_fact_inventory_accounting_snapshot_grain'),
            ('uq_fact_gl_control_balance_grain'),
            ('ck_dim_gl_account_category_domain')
        ) AS t(constraint_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse'
              AND c.conname = v_constraint.constraint_name
        ) THEN
            v_missing := v_missing || v_constraint.constraint_name;
        END IF;
    END LOOP;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'The accounting control tables exist without % of their governing '
            'constraint(s) (%). The book-value identity, both declared grains and the '
            'control-account category domain are enforced by the database, not by the '
            'loader''s good intentions.',
            cardinality(v_missing), array_to_string(v_missing, ', ');
    END IF;
END
$$;

INSERT INTO audit.schema_migration (migration_id)
VALUES ('0004_add_accounting_control_objects')
ON CONFLICT (migration_id) DO NOTHING;
