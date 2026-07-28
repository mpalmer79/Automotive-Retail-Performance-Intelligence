-- =============================================================================
-- File:            sql/07_security/01_grants.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Move object ownership to arpi_admin and apply the least-privilege grant model for arpi_loader and arpi_reporter.
-- Execution order: 19 of 25, and again as step 25 (a final privilege-normalisation pass after the validation objects are created).
-- Idempotency:     Fully idempotent. Ownership changes are no-ops when already correct; GRANT and REVOKE are declarative and may be repeated indefinitely.
-- Ownership:       Makes arpi_admin the owner of all five schemas and of every table, view, sequence and function inside them.
-- Grain:           n/a (privileges)
-- =============================================================================
--
-- SECURITY MODEL
-- --------------
-- The whole point of this script is one sentence: Power BI must never be able to
-- read the raw layer. That is achieved structurally, not by convention.
--
--   * arpi_admin owns every object, including the reporting views AND the
--     warehouse and audit tables those views read.
--   * A PostgreSQL view executes with the privileges of its owner, so
--     arpi_reporter can read reporting.vw_calendar without holding any privilege
--     at all on warehouse.dim_date.
--   * arpi_reporter is therefore granted USAGE on the reporting schema only.
--     Without USAGE on raw, no grant on a raw table can ever be exercised, and
--     the explicit REVOKEs below make the intent unmissable to a reviewer.
--
-- Verify the result with sql/07_security/02_role_verification.sql, and note that
-- tests/integration/test_security_roles.py asserts the deny path rather than
-- trusting it.
--
-- PREREQUISITE
-- ------------
-- Run as a superuser, or as a role that is a member of arpi_admin and owns the
-- objects. Reassigning ownership requires that.
--
-- WHY THIS RUNS TWICE
-- -------------------
-- Objects created after this script (the data-quality views and function in
-- sql/08_validation) would otherwise be owned by the bootstrap role and carry no
-- grants. Two mechanisms cover that: ALTER DEFAULT PRIVILEGES is applied for the
-- bootstrap role as well as for arpi_admin, and sql/README.md prescribes running
-- this file once more as the final step. Because it is idempotent, running it
-- twice costs nothing.

-- -----------------------------------------------------------------------------
-- 1. Ownership: everything belongs to arpi_admin.
-- -----------------------------------------------------------------------------
DO $ownership$
DECLARE
    v_schema  text;
    v_obj     record;
    v_schemas text[] := ARRAY['raw', 'staging', 'warehouse', 'reporting', 'audit'];
BEGIN
    FOREACH v_schema IN ARRAY v_schemas LOOP
        EXECUTE format('ALTER SCHEMA %I OWNER TO arpi_admin', v_schema);

        FOR v_obj IN
            SELECT c.relkind, c.relname
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = v_schema
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
            ORDER BY c.relkind, c.relname
        LOOP
            CASE v_obj.relkind
                WHEN 'r', 'p' THEN
                    EXECUTE format('ALTER TABLE %I.%I OWNER TO arpi_admin', v_schema, v_obj.relname);
                WHEN 'v' THEN
                    EXECUTE format('ALTER VIEW %I.%I OWNER TO arpi_admin', v_schema, v_obj.relname);
                WHEN 'm' THEN
                    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO arpi_admin', v_schema, v_obj.relname);
                WHEN 'S' THEN
                    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO arpi_admin', v_schema, v_obj.relname);
                ELSE
                    NULL;
            END CASE;
        END LOOP;

        FOR v_obj IN
            SELECT p.oid::regprocedure AS signature
            FROM pg_proc AS p
            JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = v_schema
              AND p.prokind = 'f'
            ORDER BY 1
        LOOP
            EXECUTE format('ALTER FUNCTION %s OWNER TO arpi_admin', v_obj.signature);
        END LOOP;
    END LOOP;
END
$ownership$;

-- -----------------------------------------------------------------------------
-- 2. Baseline: deny by default.
-- -----------------------------------------------------------------------------
-- PostgreSQL grants CREATE on the public schema to PUBLIC in older clusters and
-- keeps USAGE there in all of them. ARPI stores nothing in public, so nobody
-- needs to create anything there.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- No ARPI schema is open to PUBLIC. Every privilege below is granted explicitly.
REVOKE ALL ON SCHEMA raw, staging, warehouse, reporting, audit FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA raw, staging, warehouse, reporting, audit FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raw, staging, warehouse, reporting, audit FROM PUBLIC;
-- Functions are EXECUTE-able by PUBLIC by default; that default is not wanted.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA audit FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. arpi_loader: read and write the pipeline layers, create nothing.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA raw, staging, warehouse, audit TO arpi_loader;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA raw, staging, warehouse, audit
    TO arpi_loader;

-- bigserial primary keys on raw and audit tables need their sequences.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA raw, staging, warehouse, audit TO arpi_loader;

-- The loader records validation results through audit.fn_record_validation_result.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA audit TO arpi_loader;

-- Deliberately NOT granted to arpi_loader: CREATE on any schema, TRUNCATE on any
-- table, and any privilege on the reporting schema. The loader transforms data;
-- it does not define structures and does not serve reports.

-- -----------------------------------------------------------------------------
-- 4. arpi_reporter: the reporting schema, read-only, and nothing else.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA reporting TO arpi_reporter;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO arpi_reporter;

-- Explicit denials. Revoking a privilege that was never granted is a no-op, so
-- these statements cost nothing at runtime; they exist so that the deny decision
-- is visible in the file a reviewer reads, and so that an accidental grant added
-- later is undone the next time this script runs.
REVOKE ALL ON SCHEMA raw FROM arpi_reporter;
REVOKE ALL ON ALL TABLES    IN SCHEMA raw FROM arpi_reporter;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA raw FROM arpi_reporter;

REVOKE ALL ON SCHEMA staging, warehouse, audit FROM arpi_reporter;
REVOKE ALL ON ALL TABLES    IN SCHEMA staging, warehouse, audit FROM arpi_reporter;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA staging, warehouse, audit FROM arpi_reporter;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA audit FROM arpi_reporter;

-- Read-only means read-only: no write privilege on the reporting views either.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA reporting FROM arpi_reporter;

-- -----------------------------------------------------------------------------
-- 5. Default privileges, so future objects inherit the same model.
-- -----------------------------------------------------------------------------
-- ALTER DEFAULT PRIVILEGES applies only to objects created by the named role, so
-- it is applied both for arpi_admin (the intended owner) and for whichever role
-- is bootstrapping this database right now. Without the second one, a table
-- created by the superuser in a later migration would silently have no grants.
DO $defaults$
DECLARE
    v_creator text;
    v_creators text[] := ARRAY['arpi_admin', current_user];
BEGIN
    FOREACH v_creator IN ARRAY v_creators LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA raw, staging, warehouse, audit '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arpi_loader', v_creator);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA raw, staging, warehouse, audit '
            'GRANT USAGE, SELECT ON SEQUENCES TO arpi_loader', v_creator);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA audit '
            'GRANT EXECUTE ON FUNCTIONS TO arpi_loader', v_creator);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA reporting '
            'GRANT SELECT ON TABLES TO arpi_reporter', v_creator);
        -- Future objects are never exposed to PUBLIC.
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA raw, staging, warehouse, reporting, audit '
            'REVOKE ALL ON TABLES FROM PUBLIC', v_creator);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA audit '
            'REVOKE ALL ON FUNCTIONS FROM PUBLIC', v_creator);
    END LOOP;
END
$defaults$;

-- -----------------------------------------------------------------------------
-- 6. Post-condition assertions. Fail loudly rather than ship a hole.
-- -----------------------------------------------------------------------------
DO $assert$
BEGIN
    IF has_schema_privilege('arpi_reporter', 'raw', 'USAGE') THEN
        RAISE EXCEPTION 'SECURITY INVARIANT VIOLATED: arpi_reporter holds USAGE on schema raw.';
    END IF;

    IF has_schema_privilege('arpi_reporter', 'warehouse', 'USAGE') THEN
        RAISE EXCEPTION 'SECURITY INVARIANT VIOLATED: arpi_reporter holds USAGE on schema warehouse.';
    END IF;

    IF NOT has_schema_privilege('arpi_reporter', 'reporting', 'USAGE') THEN
        RAISE EXCEPTION 'GRANT FAILED: arpi_reporter does not hold USAGE on schema reporting.';
    END IF;

    IF NOT has_table_privilege('arpi_reporter', 'reporting.vw_calendar', 'SELECT') THEN
        RAISE EXCEPTION 'GRANT FAILED: arpi_reporter cannot SELECT reporting.vw_calendar.';
    END IF;

    IF NOT has_schema_privilege('arpi_loader', 'warehouse', 'USAGE') THEN
        RAISE EXCEPTION 'GRANT FAILED: arpi_loader does not hold USAGE on schema warehouse.';
    END IF;

    IF NOT has_table_privilege('arpi_loader', 'warehouse.dim_date', 'INSERT') THEN
        RAISE EXCEPTION 'GRANT FAILED: arpi_loader cannot INSERT into warehouse.dim_date.';
    END IF;

    RAISE NOTICE 'ARPI privilege model verified: reporter is confined to the reporting schema.';
END
$assert$;
