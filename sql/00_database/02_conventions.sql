-- =============================================================================
-- File:            sql/00_database/02_conventions.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Record the database naming, typing, timezone and SCD conventions as durable in-database documentation.
-- Execution order: 2 of 25 — immediately after the schemas exist.
-- Idempotency:     Fully idempotent. Comments only; no object is created, altered or dropped.
-- Ownership:       n/a (the COMMENT ON DATABASE is applied by the bootstrap superuser).
-- Grain:           n/a (documentation only)
-- =============================================================================
--
-- NOTE ON THE MISSING 01_extensions.sql
-- -------------------------------------
-- There is deliberately no sql/00_database/01_extensions.sql. The Phase 0 slice
-- needs no PostgreSQL extension:
--   * SHA-256 attribute hashes are produced by the Python generator
--     (src/arpi/utilities/hashing.py) and arrive as text, so pgcrypto is not
--     required to compute or verify them in SQL.
--   * Surrogate keys are plain integers, so uuid-ossp is not required.
--   * No trigram, full-text or spatial search exists.
-- Shipping an empty extensions script would imply a dependency that does not
-- exist, so the file is absent rather than empty. The numbering gap is
-- intentional and is documented in sql/README.md.
--
--
-- =============================================================================
-- 1. NAMING CONVENTIONS
-- =============================================================================
--   * All identifiers are lower_snake_case and unquoted. No mixed-case or
--     space-bearing identifiers exist anywhere in the physical model.
--   * Schemas:      raw | staging | warehouse | reporting | audit
--   * Raw tables:   <entity>_load                 e.g. raw.dealership_load
--   * Staging views: stg_<entity>                 e.g. staging.stg_dealership
--   * Dimensions:   dim_<entity>                  e.g. warehouse.dim_date
--   * Facts:        fact_<business_process>       (Phase 1.2 — see sql/04_facts/README.md)
--   * Reporting:    vw_<subject>                  e.g. reporting.vw_calendar
--   * Data-quality views: audit.vw_dq_<subject>
--   * Surrogate keys: <entity>_key   (integer, warehouse-assigned)
--   * Natural keys:   <entity>_id    (text/varchar, source-assigned)
--   * Booleans:       is_<predicate> / has_<predicate>
--   * Constraints:    pk_<table> | uq_<table>_<cols> | fk_<table>_<referenced>
--                     ck_<table>_<rule> | ix_<table>_<cols>
--   * Every object carries a COMMENT. Tables and views state their grain.
--
-- =============================================================================
-- 2. TIMESTAMP AND TIMEZONE POLICY
-- =============================================================================
--   * Every point-in-time column is `timestamptz` (timestamp with time zone).
--     `timestamp without time zone` is prohibited.
--   * All stored instants are interpreted as UTC. Sessions that write to ARPI
--     should run with `SET TIME ZONE 'UTC'`; readers may convert for display.
--   * Business calendar columns are plain `date`. A calendar date in this model
--     is a business fact, not an instant, and must never be given a timezone.
--   * The generator emits no wall-clock timestamp into its manifest so that
--     output stays byte-for-byte reproducible; audit timestamps are the only
--     non-deterministic values in the system.
--
-- =============================================================================
-- 3. SCD TYPE 2 SENTINEL AND RULES
-- =============================================================================
--   * The open-ended expiration sentinel is DATE '9999-12-31'. NULL is never
--     used to mean "still current".
--   * Invariant enforced by CHECK constraint on every Type 2 dimension:
--         is_current = (expiration_date = DATE '9999-12-31')
--   * A superseded version is expired by setting
--         expiration_date = (new version's effective_date - 1 day)
--         is_current      = false
--     so that versions tile the timeline with no gap and no overlap.
--   * Change detection uses `attribute_hash`: a SHA-256 hex digest (64 lower-case
--     hex characters) of the Type 2 tracked attributes joined with '|' in UTF-8.
--     Equal hash means no change and therefore no new version.
--   * Surrogate keys are never reused and never renumbered.
--
-- =============================================================================
-- 4. NUMERIC, TEXT AND NULL POLICY
-- =============================================================================
--   * Money and ratios use `numeric`; `float`/`real`/`double precision` are
--     prohibited in the warehouse and reporting layers.
--   * Raw-layer business columns are always `text` and always nullable.
--   * Staging casts text to the warehouse type and maps the empty string to NULL.
--   * A dimension attribute that is unknown is NULL; it is never a magic string
--     such as 'N/A' or 'UNKNOWN' unless a documented default member is added.
--
-- =============================================================================
-- 5. EXECUTION AND SECURITY POLICY
-- =============================================================================
--   * Every object reference in every script is schema-qualified. No script
--     relies on `search_path`.
--   * No script contains a credential, password or connection string.
--   * The only destructive script in the repository is sql/99_local_reset.sql,
--     which refuses to run outside a development database.
--
-- -----------------------------------------------------------------------------
-- Persist a short version of the above onto the database object itself so that
-- an operator inspecting an unfamiliar ARPI database with \l+ sees the policy.
-- current_database() is used so that the script is portable across arpi_dev,
-- throwaway integration-test databases and any managed instance.
-- -----------------------------------------------------------------------------
DO $conventions$
BEGIN
    EXECUTE format(
        'COMMENT ON DATABASE %I IS %L',
        current_database(),
        'Automotive Retail Performance Intelligence (ARPI). Layers: raw -> staging -> warehouse -> reporting, '
        'with audit recording every run. Identifiers are lower_snake_case. All instants are timestamptz in UTC; '
        'business calendar values are date. SCD Type 2 open-ended expiration sentinel is 9999-12-31 and '
        'is_current = (expiration_date = 9999-12-31). Change detection uses a 64-character lower-case SHA-256 '
        'attribute_hash. 100% synthetic data - see PRIVACY_AND_ETHICS.md. Conventions: sql/00_database/02_conventions.sql.'
    );
END
$conventions$;
