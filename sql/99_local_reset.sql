-- =============================================================================
-- File:            sql/99_local_reset.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         LOCAL DEVELOPMENT ONLY. Destroy all five ARPI schemas and everything in them so the database can be rebuilt from scratch.
-- Execution order: NEVER part of the initialisation sequence. Run manually, deliberately, and only against a local development database.
-- Idempotency:     Idempotent in effect (DROP SCHEMA IF EXISTS), but NOT harmless: every row of data is destroyed each time it runs.
-- Ownership:       Run as a superuser or as arpi_admin. Cluster-wide roles are deliberately NOT dropped.
-- Grain:           n/a (destructive maintenance)
-- =============================================================================
--
--
--         #####################################################################
--         #####################################################################
--         ###                                                               ###
--         ###   ####    ###   #   #  ####  ##### #####                      ###
--         ###   #   #  #   #  ##  # #      #     #   #                      ###
--         ###   #   #  #####  # # # #  ### ####  #####                      ###
--         ###   #   #  #   #  #  ## #    # #     #  #                       ###
--         ###   ####   #   #  #   #  ####  ##### #   #                      ###
--         ###                                                               ###
--         ###          T H I S   S C R I P T   D E S T R O Y S              ###
--         ###                 A L L   A R P I   D A T A                     ###
--         ###                                                               ###
--         #####################################################################
--         #####################################################################
--
--
-- WHAT IT DOES
--   DROP SCHEMA ... CASCADE on raw, staging, warehouse, reporting and audit.
--   That removes every table, view, function, sequence, index and constraint in
--   those schemas, and every row they contain — including the entire audit
--   history of every pipeline run ever recorded in this database. There is no
--   undo, no backup taken, and no confirmation prompt.
--
-- WHAT IT DOES NOT DO
--   * It does not drop the database itself.
--   * It does not drop the arpi_admin, arpi_loader or arpi_reporter roles. Roles
--     are cluster-wide: dropping them could break a different database on the
--     same server. Re-running sql/07_security/00_roles.sql after a reset is a
--     no-op precisely because they survive.
--   * It does not drop login roles or their passwords.
--
-- WHEN TO USE IT
--   Only to rebuild a local scratch database after changing the schema, when
--   migrating the change forward is not worth the effort. Never on anything
--   anybody else depends on.
--
-- IT IS EXCLUDED FROM THE INITIALISATION SEQUENCE ON PURPOSE
--   sql/README.md lists the 25 ordered steps of the init sequence; this file is
--   not one of them and must never be added. It sits at the repository root of
--   sql/ rather than inside a numbered directory so that the canonical
--   `sql/0*/*.sql` glob cannot pick it up by accident.
--
-- AFTER RUNNING IT
--   Re-run the initialisation sequence from step 1. See sql/README.md.
--
-- =============================================================================
-- GUARD — refuse to run anywhere that is not obviously a development database.
-- =============================================================================
-- The database name must start with `arpi_` and must not contain `prod`. This is
-- a guard rail, not a security control: it stops the ordinary accident of running
-- the wrong -f against the wrong -d. It cannot stop a determined operator, and it
-- is not a substitute for not having production credentials in your shell.
DO $guard$
DECLARE
    v_database_name text := current_database();
BEGIN
    IF NOT (v_database_name LIKE 'arpi\_%' AND v_database_name NOT LIKE '%prod%') THEN
        RAISE EXCEPTION
            'REFUSING TO RESET DATABASE "%". sql/99_local_reset.sql destroys all ARPI data and only runs '
            'against a local development database whose name starts with "arpi_" and does not contain '
            '"prod". If you genuinely meant to wipe this database, do it explicitly by hand and think '
            'about it first.', v_database_name;
    END IF;

    RAISE WARNING
        'sql/99_local_reset.sql is dropping every ARPI schema in database "%". All data, including the '
        'complete audit history, is being destroyed.', v_database_name;
END
$guard$;

-- =============================================================================
-- DESTRUCTION — dropped in reverse dependency order for legibility. CASCADE makes
-- the order technically irrelevant, but a reader should still see the intent.
-- =============================================================================
DROP SCHEMA IF EXISTS reporting CASCADE;
DROP SCHEMA IF EXISTS warehouse CASCADE;
DROP SCHEMA IF EXISTS staging   CASCADE;
DROP SCHEMA IF EXISTS raw       CASCADE;
DROP SCHEMA IF EXISTS audit     CASCADE;

-- =============================================================================
-- CONFIRMATION — report what survived, so the operator can see the reset worked.
-- =============================================================================
DO $confirm$
DECLARE
    v_remaining integer;
BEGIN
    SELECT count(*) INTO v_remaining
    FROM information_schema.schemata
    WHERE schema_name IN ('raw', 'staging', 'warehouse', 'reporting', 'audit');

    IF v_remaining = 0 THEN
        RAISE NOTICE
            'ARPI reset complete in database "%": all five schemas dropped. Roles arpi_admin, arpi_loader '
            'and arpi_reporter were left in place. Rebuild with the sequence in sql/README.md.',
            current_database();
    ELSE
        RAISE EXCEPTION
            'ARPI reset incomplete in database "%": % ARPI schema(s) still exist. Investigate before '
            'rebuilding.', current_database(), v_remaining;
    END IF;
END
$confirm$;
