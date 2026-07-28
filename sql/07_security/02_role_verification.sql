-- =============================================================================
-- File:            sql/07_security/02_role_verification.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Read-only operator report on the effective ARPI privilege model. Proves who can reach what.
-- Execution order: NOT part of the initialisation sequence. Run on demand, and after any privilege change.
-- Idempotency:     Trivially idempotent. Every statement is a SELECT; nothing is created, altered or dropped.
-- Ownership:       n/a (creates no objects). Run as any role that can read the system catalogues.
-- Grain:           One grain per query; each result set is labelled in its report_section column.
-- =============================================================================
--
-- HOW TO RUN
--     psql -d arpi_dev -f sql/07_security/02_role_verification.sql
--
-- Add -P pager=off for a clean capture, or -A -F'|' for machine-readable output.
-- This file is plain SQL with no psql meta-commands, so it is equally safe to run
-- through psycopg. Every result set carries a report_section label and, where a
-- rule applies, an assessment column that must read `ok`.
-- The rows that matter most are in sections 2 and 3: arpi_reporter must show
-- false for every raw, staging, warehouse and audit privilege.

-- =============================================================================
-- ARPI ROLE VERIFICATION REPORT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section 1 — do the roles exist, and are they safely NOLOGIN?
-- -----------------------------------------------------------------------------
SELECT
    '1. role definitions'      AS report_section,
    r.rolname                  AS role_name,
    r.rolcanlogin              AS can_login,
    r.rolsuper                 AS is_superuser,
    r.rolcreaterole            AS can_create_role,
    r.rolcreatedb              AS can_create_database,
    r.rolbypassrls             AS bypasses_row_security,
    CASE WHEN r.rolcanlogin THEN 'FAIL - group roles must be NOLOGIN' ELSE 'ok' END AS assessment
FROM pg_roles AS r
WHERE r.rolname IN ('arpi_admin', 'arpi_loader', 'arpi_reporter')
ORDER BY r.rolname;

-- -----------------------------------------------------------------------------
-- Section 2 — schema-level reachability. This is the security boundary.
-- -----------------------------------------------------------------------------
SELECT
    '2. schema privileges'                                  AS report_section,
    g.role_name                                             AS role_name,
    s.schema_name                                           AS schema_name,
    has_schema_privilege(g.role_name, s.schema_name, 'USAGE')  AS has_usage,
    has_schema_privilege(g.role_name, s.schema_name, 'CREATE') AS has_create,
    CASE
        WHEN g.role_name = 'arpi_reporter' AND s.schema_name <> 'reporting'
             AND has_schema_privilege(g.role_name, s.schema_name, 'USAGE')
            THEN 'FAIL - reporter must not reach this schema'
        WHEN g.role_name = 'arpi_reporter' AND s.schema_name = 'reporting'
             AND NOT has_schema_privilege(g.role_name, s.schema_name, 'USAGE')
            THEN 'FAIL - reporter cannot reach the reporting schema'
        WHEN g.role_name = 'arpi_loader' AND s.schema_name <> 'reporting'
             AND NOT has_schema_privilege(g.role_name, s.schema_name, 'USAGE')
            THEN 'FAIL - loader cannot reach a pipeline schema'
        WHEN g.role_name = 'arpi_loader'
             AND has_schema_privilege(g.role_name, s.schema_name, 'CREATE')
            THEN 'FAIL - loader must not be able to create objects'
        ELSE 'ok'
    END                                                     AS assessment
FROM (VALUES ('arpi_admin'), ('arpi_loader'), ('arpi_reporter')) AS g(role_name)
CROSS JOIN (VALUES ('raw'), ('staging'), ('warehouse'), ('reporting'), ('audit')) AS s(schema_name)
ORDER BY g.role_name, s.schema_name;

-- -----------------------------------------------------------------------------
-- Section 3 — the explicit deny path. arpi_reporter versus the raw layer.
-- -----------------------------------------------------------------------------
SELECT
    '3. reporter cannot read raw'                                   AS report_section,
    c.table_schema || '.' || c.table_name                           AS object_name,
    has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'SELECT')
                                                                    AS reporter_can_select,
    CASE
        WHEN has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'SELECT')
            THEN 'FAIL - reporter can read a raw table'
        ELSE 'ok - denied'
    END                                                             AS assessment
FROM information_schema.tables AS c
WHERE c.table_schema = 'raw'
ORDER BY object_name;

-- -----------------------------------------------------------------------------
-- Section 4 — the allow path. arpi_reporter and the four reporting views.
-- -----------------------------------------------------------------------------
SELECT
    '4. reporter can read reporting'                                AS report_section,
    c.table_schema || '.' || c.table_name                           AS object_name,
    has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'SELECT')
                                                                    AS reporter_can_select,
    has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'INSERT')
                                                                    AS reporter_can_insert,
    CASE
        WHEN NOT has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'SELECT')
            THEN 'FAIL - reporter cannot read an approved view'
        WHEN has_table_privilege('arpi_reporter', format('%I.%I', c.table_schema, c.table_name), 'INSERT')
            THEN 'FAIL - reporter must be read-only'
        ELSE 'ok'
    END                                                             AS assessment
FROM information_schema.tables AS c
WHERE c.table_schema = 'reporting'
ORDER BY object_name;

-- -----------------------------------------------------------------------------
-- Section 5 — arpi_loader write access to the pipeline layers.
-- -----------------------------------------------------------------------------
SELECT
    '5. loader table privileges'                                    AS report_section,
    c.table_schema || '.' || c.table_name                           AS object_name,
    has_table_privilege('arpi_loader', format('%I.%I', c.table_schema, c.table_name), 'SELECT') AS can_select,
    has_table_privilege('arpi_loader', format('%I.%I', c.table_schema, c.table_name), 'INSERT') AS can_insert,
    has_table_privilege('arpi_loader', format('%I.%I', c.table_schema, c.table_name), 'UPDATE') AS can_update,
    has_table_privilege('arpi_loader', format('%I.%I', c.table_schema, c.table_name), 'DELETE') AS can_delete
FROM information_schema.tables AS c
WHERE c.table_schema IN ('raw', 'staging', 'warehouse', 'audit')
ORDER BY c.table_schema, c.table_name;

-- -----------------------------------------------------------------------------
-- Section 6 — every explicit table grant currently in force, from the catalogue.
-- -----------------------------------------------------------------------------
SELECT
    '6. granted table privileges'  AS report_section,
    g.grantee                      AS grantee,
    g.table_schema                 AS schema_name,
    g.table_name                   AS object_name,
    g.privilege_type               AS privilege,
    g.is_grantable                 AS is_grantable
FROM information_schema.role_table_grants AS g
WHERE g.grantee IN ('arpi_admin', 'arpi_loader', 'arpi_reporter', 'PUBLIC')
  AND g.table_schema IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
ORDER BY g.grantee, g.table_schema, g.table_name, g.privilege_type;

-- -----------------------------------------------------------------------------
-- Section 7 — object ownership. Everything should belong to arpi_admin.
-- -----------------------------------------------------------------------------
SELECT
    '7. object ownership'                                  AS report_section,
    n.nspname                                              AS schema_name,
    c.relname                                              AS object_name,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'S' THEN 'sequence'
        WHEN 'i' THEN 'index'
        ELSE c.relkind::text
    END                                                    AS object_type,
    pg_get_userbyid(c.relowner)                            AS owner_name,
    CASE WHEN pg_get_userbyid(c.relowner) = 'arpi_admin' THEN 'ok'
         ELSE 'review - not owned by arpi_admin' END       AS assessment
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
ORDER BY n.nspname, c.relname;

-- -----------------------------------------------------------------------------
-- Section 8 — default privileges for objects that do not exist yet.
-- -----------------------------------------------------------------------------
SELECT
    '8. default privileges'                        AS report_section,
    pg_get_userbyid(d.defaclrole)                  AS creating_role,
    coalesce(n.nspname, '(all schemas)')           AS schema_name,
    CASE d.defaclobjtype
        WHEN 'r' THEN 'tables'
        WHEN 'S' THEN 'sequences'
        WHEN 'f' THEN 'functions'
        WHEN 'T' THEN 'types'
        WHEN 'n' THEN 'schemas'
        ELSE d.defaclobjtype::text
    END                                            AS object_type,
    d.defaclacl::text                              AS access_control_list
FROM pg_default_acl AS d
LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
ORDER BY creating_role, schema_name, object_type;

-- -----------------------------------------------------------------------------
-- Section 9 — role memberships. Which login roles inherit ARPI privileges?
-- -----------------------------------------------------------------------------
SELECT
    '9. role memberships'                  AS report_section,
    parent.rolname                         AS group_role,
    member.rolname                         AS member_role,
    member.rolcanlogin                     AS member_can_login,
    m.admin_option                         AS has_admin_option
FROM pg_auth_members AS m
JOIN pg_roles AS parent ON parent.oid = m.roleid
JOIN pg_roles AS member ON member.oid = m.member
WHERE parent.rolname IN ('arpi_admin', 'arpi_loader', 'arpi_reporter')
ORDER BY parent.rolname, member.rolname;

-- =============================================================================
-- Every assessment column should read `ok`. Any FAIL means the privilege model
-- has drifted: re-run sql/07_security/01_grants.sql and investigate what changed.
-- =============================================================================
