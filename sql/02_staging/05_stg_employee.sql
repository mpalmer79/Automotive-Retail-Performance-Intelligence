-- =============================================================================
-- File:            sql/02_staging/05_stg_employee.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.employee_load batch, plus its rejected-row companion.
-- Execution order: 22 of 66 — after raw.employee_load and the staging cast helpers, before anything reads staging.stg_employee.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_employee: one accepted row per employee_id + effective_date in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_employee_typed     every row of the newest batch, cast and classified
--   staging.stg_employee           the accepted rows only (what the warehouse loads)
--   staging.stg_employee_rejected  the dropped rows, with a REJ-* code and a payload
--
-- The three are derived from one another, so the accepted set and the rejected set
-- cannot drift apart: every row of the newest batch appears in exactly one of them.
-- That is the identity the ingestion row-count chain reconciliation depends on
-- (RECON-INGEST-*-CHAIN in src/arpi/ingestion/loader.py).
--
-- STAGING GENUINELY DROPS ROWS
-- ----------------------------
-- A staging count that is unconditionally equal to the raw count proves nothing
-- (DOC-23). Four things drop a row here, and each is reported rather than hidden:
--   REJ-TYPE-001    a value is present but cannot be represented in its governed
--                   type (unparseable date, non-numeric money, over-length string)
--   REJ-NULL-001    a required value is absent
--   REJ-DOMAIN-001  a value is outside its enumerated domain or numeric range
--   REJ-KEY-001     a duplicate natural key; the highest raw_record_id survives
--
-- Every cast below is non-throwing: staging.fn_try_* returns NULL instead of
-- raising, and the string casts are length-guarded. A single malformed row
-- therefore quarantines itself rather than failing the whole load.
--
-- NEWEST-BATCH RULE
-- -----------------
-- Identical to staging.stg_calendar_date and staging.stg_dealership: greatest
-- max(ingested_at), ties broken by greatest max(raw_record_id).
--
-- DELIBERATE RENAME
-- -----------------
-- Generator-supplied surrogate keys are exposed as source_*_key. The warehouse
-- surrogate key is assigned by the merge and must never be taken from the source.

CREATE OR REPLACE VIEW staging.stg_employee_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.employee_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.employee_key), '')                                      AS src_source_employee_key,
        nullif(btrim(r.employee_id), '')                                       AS src_employee_id,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.department), '')                                        AS src_department,
        nullif(btrim(r.job_role), '')                                          AS src_job_role,
        nullif(btrim(r.hire_date), '')                                         AS src_hire_date,
        nullif(btrim(r.termination_date), '')                                  AS src_termination_date,
        nullif(btrim(r.is_active), '')                                         AS src_is_active,
        nullif(btrim(r.is_manager), '')                                        AS src_is_manager,
        nullif(btrim(r.tenure_band), '')                                       AS src_tenure_band,
        nullif(btrim(r.effective_date), '')                                    AS src_effective_date,
        nullif(btrim(r.expiration_date), '')                                   AS src_expiration_date,
        nullif(btrim(r.is_current), '')                                        AS src_is_current,
        lower(nullif(btrim(r.attribute_hash), ''))                             AS src_attribute_hash,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.employee_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_source_employee_key) AS source_employee_key,
        CASE WHEN length(t.src_employee_id) <= 16 THEN t.src_employee_id::varchar(16) END AS employee_id,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_department) <= 30 THEN t.src_department::varchar(30) END AS department,
        CASE WHEN length(t.src_job_role) <= 40 THEN t.src_job_role::varchar(40) END AS job_role,
        staging.fn_try_date(t.src_hire_date) AS hire_date,
        staging.fn_try_date(t.src_termination_date) AS termination_date,
        staging.fn_try_boolean(t.src_is_active) AS is_active,
        staging.fn_try_boolean(t.src_is_manager) AS is_manager,
        CASE WHEN length(t.src_tenure_band) <= 20 THEN t.src_tenure_band::varchar(20) END AS tenure_band,
        staging.fn_try_date(t.src_effective_date) AS effective_date,
        staging.fn_try_date(t.src_expiration_date) AS expiration_date,
        staging.fn_try_boolean(t.src_is_current) AS is_current,
        CASE WHEN length(t.src_attribute_hash) = 64 THEN t.src_attribute_hash::char(64) END AS attribute_hash,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_source_employee_key,
        t.src_employee_id,
        t.src_dealership_id,
        t.src_department,
        t.src_job_role,
        t.src_hire_date,
        t.src_termination_date,
        t.src_is_active,
        t.src_is_manager,
        t.src_tenure_band,
        t.src_effective_date,
        t.src_expiration_date,
        t.src_is_current,
        t.src_attribute_hash,
        t.src_source_system,
        t.raw_record_id,
        t.load_batch_id,
        t.source_file_name,
        t.source_row_number,
        t.ingested_at,
        t.record_payload
    FROM trimmed AS t
),
flagged AS (
    SELECT
        c.*,
        -- Present in the source but not representable in the governed type.
        array_remove(ARRAY[
            CASE WHEN c.src_source_employee_key IS NOT NULL AND c.source_employee_key IS NULL THEN 'source_employee_key' END,
            CASE WHEN c.src_employee_id IS NOT NULL AND c.employee_id IS NULL THEN 'employee_id' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_department IS NOT NULL AND c.department IS NULL THEN 'department' END,
            CASE WHEN c.src_job_role IS NOT NULL AND c.job_role IS NULL THEN 'job_role' END,
            CASE WHEN c.src_hire_date IS NOT NULL AND c.hire_date IS NULL THEN 'hire_date' END,
            CASE WHEN c.src_termination_date IS NOT NULL AND c.termination_date IS NULL THEN 'termination_date' END,
            CASE WHEN c.src_is_active IS NOT NULL AND c.is_active IS NULL THEN 'is_active' END,
            CASE WHEN c.src_is_manager IS NOT NULL AND c.is_manager IS NULL THEN 'is_manager' END,
            CASE WHEN c.src_tenure_band IS NOT NULL AND c.tenure_band IS NULL THEN 'tenure_band' END,
            CASE WHEN c.src_effective_date IS NOT NULL AND c.effective_date IS NULL THEN 'effective_date' END,
            CASE WHEN c.src_expiration_date IS NOT NULL AND c.expiration_date IS NULL THEN 'expiration_date' END,
            CASE WHEN c.src_is_current IS NOT NULL AND c.is_current IS NULL THEN 'is_current' END,
            CASE WHEN c.src_attribute_hash IS NOT NULL AND c.attribute_hash IS NULL THEN 'attribute_hash' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.source_employee_key IS NULL THEN 'source_employee_key' END,
            CASE WHEN c.employee_id IS NULL THEN 'employee_id' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.department IS NULL THEN 'department' END,
            CASE WHEN c.job_role IS NULL THEN 'job_role' END,
            CASE WHEN c.hire_date IS NULL THEN 'hire_date' END,
            CASE WHEN c.is_active IS NULL THEN 'is_active' END,
            CASE WHEN c.is_manager IS NULL THEN 'is_manager' END,
            CASE WHEN c.tenure_band IS NULL THEN 'tenure_band' END,
            CASE WHEN c.effective_date IS NULL THEN 'effective_date' END,
            CASE WHEN c.expiration_date IS NULL THEN 'expiration_date' END,
            CASE WHEN c.is_current IS NULL THEN 'is_current' END,
            CASE WHEN c.attribute_hash IS NULL THEN 'attribute_hash' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.department IS NOT NULL AND c.department NOT IN ('Sales', 'Finance', 'BDC', 'Management', 'Service') THEN 'department' END,
            CASE WHEN c.job_role IS NOT NULL AND c.job_role NOT IN ('Salesperson', 'Sales Manager', 'Desk Manager', 'Finance Manager', 'BDC Representative', 'BDC Manager', 'General Manager', 'Service Advisor') THEN 'job_role' END,
            CASE WHEN c.tenure_band IS NOT NULL AND c.tenure_band NOT IN ('Under 1 Year', '1-3 Years', '3-5 Years', '5-10 Years', 'Over 10 Years') THEN 'tenure_band' END
        ], NULL) AS domain_failures
    FROM cast_attempt AS c
),
classified AS (
    SELECT
        f.*,
        CASE
            WHEN cardinality(f.cast_failures) > 0     THEN 'REJ-TYPE-001'
            WHEN cardinality(f.missing_required) > 0  THEN 'REJ-NULL-001'
            WHEN cardinality(f.domain_failures) > 0   THEN 'REJ-DOMAIN-001'
        END AS rejection_code,
        CASE
            WHEN cardinality(f.cast_failures) > 0     THEN 'structural'
            WHEN cardinality(f.missing_required) > 0  THEN 'completeness'
            WHEN cardinality(f.domain_failures) > 0   THEN 'business_rule'
        END AS rejection_category,
        CASE
            WHEN cardinality(f.cast_failures) > 0
                THEN 'value present but not representable in the governed type: '
                     || array_to_string(f.cast_failures, ', ')
            WHEN cardinality(f.missing_required) > 0
                THEN 'required value absent: ' || array_to_string(f.missing_required, ', ')
            WHEN cardinality(f.domain_failures) > 0
                THEN 'value outside its governed domain or range: '
                     || array_to_string(f.domain_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.source_employee_key,
    c.employee_id,
    c.dealership_id,
    c.department,
    c.job_role,
    c.hire_date,
    c.termination_date,
    c.is_active,
    c.is_manager,
    c.tenure_band,
    c.effective_date,
    c.expiration_date,
    c.is_current,
    c.attribute_hash,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_employee_id,
    c.src_effective_date,
    c.raw_record_id,
    c.load_batch_id,
    c.source_file_name,
    c.source_row_number,
    c.ingested_at,
    c.record_payload,
    c.rejection_code,
    c.rejection_category,
    c.rejection_reason,
    -- Rank within the natural key, computed separately for accepted and rejected
    -- rows so that a structurally invalid row can never displace a valid one.
    row_number() OVER (
        PARTITION BY c.employee_id, c.effective_date, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_employee_typed IS
    'Grain: one row per row of the most recent raw.employee_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_employee and 
staging.stg_employee_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_employee AS
SELECT DISTINCT ON (v.employee_id, v.effective_date)
    v.source_employee_key,
    v.employee_id,
    v.dealership_id,
    v.department,
    v.job_role,
    v.hire_date,
    v.termination_date,
    v.is_active,
    v.is_manager,
    v.tenure_band,
    v.effective_date,
    v.expiration_date,
    v.is_current,
    v.attribute_hash,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_employee_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.employee_id, v.effective_date, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_employee IS
    'Grain: one row per employee_id + effective_date, restricted to the most recent raw.employee_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_employee_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_employee.source_employee_key IS 'Generator-assigned employee_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/14_dim_employee_merge.sql, so staging exposes this as source_employee_key.';
COMMENT ON COLUMN staging.stg_employee.employee_id IS 'Natural key, EMP-##### (contract section 5). Stable across versions.';
COMMENT ON COLUMN staging.stg_employee.dealership_id IS 'Store the employee is assigned to in this version. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.department IS 'Department. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.job_role IS 'Job role. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.hire_date IS 'Date the employee was hired. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.termination_date IS 'Date the employee left; NULL means still employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.is_active IS 'Whether the employee is currently employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.is_manager IS 'Whether the role carries management responsibility. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN staging.stg_employee.tenure_band IS 'Banded tenure. Banded rather than exact so no precise personal timeline is published.';
COMMENT ON COLUMN staging.stg_employee.effective_date IS 'Inclusive start date of this version.';
COMMENT ON COLUMN staging.stg_employee.expiration_date IS 'Source expiration date. Informational: the merge derives the stored value from the successor version.';
COMMENT ON COLUMN staging.stg_employee.is_current IS 'Source current flag. Informational: the merge derives the stored value.';
COMMENT ON COLUMN staging.stg_employee.attribute_hash IS '64-character lower-case SHA-256 hex digest of tracked attributes 3-9 (dealership_id|department|job_role|hire_date|termination_date|is_active|is_manager), joined with ''|'', UTF-8, NULL serialised as the empty string. Computed by the generator (Agent D) and carried through unchanged; the merge compares it and never recomputes it.';
COMMENT ON COLUMN staging.stg_employee.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_employee.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_employee.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_employee.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_employee.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_employee.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_employee_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'employee'::text AS source_entity,
    coalesce(v.src_employee_id, '?') || '|' || coalesce(v.src_effective_date, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (employee_id, effective_date) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_employee_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_employee_rejected IS
    'Grain: one row per row of the most recent raw.employee_load batch that staging.stg_employee did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_employee_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_employee_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_employee_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_employee_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_employee_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_employee_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_employee_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_employee_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_employee_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_employee_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
