-- =============================================================================
-- File:            sql/07_security/00_roles.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the three ARPI group roles (arpi_admin, arpi_loader, arpi_reporter) as NOLOGIN roles.
-- Execution order: 18 of 25 — after all objects exist, immediately before sql/07_security/01_grants.sql.
-- Idempotency:     Fully idempotent. Each role is created only if pg_roles does not already contain it; existing roles and their memberships are left untouched.
-- Ownership:       Roles are cluster-wide objects owned by the bootstrap superuser. They are NOT dropped by sql/99_local_reset.sql.
-- Grain:           n/a (role definitions)
-- =============================================================================
--
-- =============================================================================
-- NO PASSWORDS. EVER. ANYWHERE IN THIS REPOSITORY.
-- =============================================================================
-- All three roles are NOLOGIN group roles. They carry privileges; they cannot
-- open a connection. A human or a service connects as a separate LOGIN role that
-- is granted membership in exactly one of them:
--
--     -- run interactively, out of band, never from a committed script:
--     CREATE ROLE arpi_app LOGIN;
--     \password arpi_app                 -- psql prompts; nothing is echoed or logged
--     GRANT arpi_loader TO arpi_app;
--
-- or, from a shell:
--
--     createuser --pwprompt --no-createdb --no-createrole --no-superuser arpi_app
--     psql -c "GRANT arpi_loader TO arpi_app"
--
-- This separation exists so that:
--   * no credential can ever be committed — there is no CREATE ROLE ... PASSWORD
--     statement in the repository to accidentally fill in;
--   * privileges can be reviewed and changed in version control while the
--     credentials that use them live only in the operator's secret store;
--   * a leaked login can be revoked with a single REVOKE without touching the
--     privilege model.
--
-- ARPI reads its own password only from the ARPI_DATABASE__PASSWORD environment
-- variable (PGPASSWORD is accepted as a fallback). It is never written to YAML,
-- never logged, and is redacted as ***REDACTED*** in every configuration
-- representation. See docs/database-setup.md.
--
-- ROLE MODEL (ARCHITECTURE.md section 22.3)
-- -----------------------------------------
--   arpi_admin     owns every ARPI object; used only for schema administration.
--   arpi_loader    reads and writes raw, staging, warehouse and audit; cannot
--                  administer security and cannot create objects.
--   arpi_reporter  read-only on the reporting schema and nothing else. Used by
--                  Power BI and Excel. Explicitly denied the raw layer.
--
-- None of the roles is granted membership in another. arpi_loader is deliberately
-- not a member of arpi_admin, so a compromised loader cannot alter the schema.
--
-- CLUSTER SCOPE. Roles are cluster-wide, not per-database. Running this script
-- against a second ARPI database on the same cluster reuses the existing roles,
-- which is why every statement below is guarded rather than unconditional.

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arpi_admin') THEN
        CREATE ROLE arpi_admin NOLOGIN;
        RAISE NOTICE 'Created role arpi_admin.';
    ELSE
        RAISE NOTICE 'Role arpi_admin already exists; leaving it unchanged.';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arpi_loader') THEN
        CREATE ROLE arpi_loader NOLOGIN;
        RAISE NOTICE 'Created role arpi_loader.';
    ELSE
        RAISE NOTICE 'Role arpi_loader already exists; leaving it unchanged.';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arpi_reporter') THEN
        CREATE ROLE arpi_reporter NOLOGIN;
        RAISE NOTICE 'Created role arpi_reporter.';
    ELSE
        RAISE NOTICE 'Role arpi_reporter already exists; leaving it unchanged.';
    END IF;
END
$roles$;

-- Assert the roles cannot log in, in case an earlier operator created one by hand
-- with LOGIN. This is a security invariant, not a convenience.
DO $nologin$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('arpi_admin', 'arpi_loader', 'arpi_reporter') AND rolcanlogin) THEN
        RAISE EXCEPTION
            'One of arpi_admin / arpi_loader / arpi_reporter has LOGIN. These must be NOLOGIN group '
            'roles. Fix with: ALTER ROLE <role> NOLOGIN; and connect through a separate login role that '
            'is granted membership instead.';
    END IF;
END
$nologin$;

COMMENT ON ROLE arpi_admin IS
    'ARPI administration group role (NOLOGIN). Owns every ARPI schema, table, view, sequence and '
    'function. Used only for schema administration. Grant membership to a separate login role.';

COMMENT ON ROLE arpi_loader IS
    'ARPI ETL group role (NOLOGIN). SELECT/INSERT/UPDATE/DELETE on raw, staging, warehouse and audit, '
    'plus sequence usage. Cannot create objects and cannot administer security. Grant membership to a '
    'separate login role used by the pipeline.';

COMMENT ON ROLE arpi_reporter IS
    'ARPI read-only reporting group role (NOLOGIN). USAGE on the reporting schema and SELECT on its '
    'views only. Explicitly denied raw, staging, warehouse and audit. Used by Power BI and Excel. Grant '
    'membership to a separate login role.';
