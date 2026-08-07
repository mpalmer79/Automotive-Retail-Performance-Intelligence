-- =============================================================================
-- File:            sql/02_staging/16_stg_sales_target.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.sales_target_load batch, plus its rejected-row companion.
-- Execution order: After raw.sales_target_load and the staging cast helpers, before anything reads staging.stg_sales_target.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Grain:           staging.stg_sales_target: one accepted row per sales_target_id in the most recent load batch.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- =============================================================================
--
-- THREE VIEWS, ONE RULE SET -- the pattern staging.stg_marketing_spend establishes:
--   staging.stg_sales_target_typed     every row of the newest batch, cast and classified
--   staging.stg_sales_target           the accepted rows only (what the warehouse loads)
--   staging.stg_sales_target_rejected  the dropped rows, with a REJ-* code and a payload
--
-- WHAT STAGING OWNS FOR THIS ENTITY, AND WHAT IT DOES NOT
-- -------------------------------------------------------
-- Staging PREPARES the fact. It parses, canonicalises the scope vocabulary, validates
-- the targeted-metric vocabulary, enforces the scope-integrity rules that a single
-- CHECK constraint cannot express, deduplicates deterministically and rejects what it
-- cannot accept. It computes NO attainment, NO pace and NO projection: those are
-- reporting.vw_target_attainment's, and a staging view that produced them would be a
-- second implementation of the same KPI.
--
-- THE SCOPE-INTEGRITY RULES ENFORCED HERE
-- ---------------------------------------
-- warehouse.fact_sales_target enforces, in CHECK constraints, everything that can be
-- decided from one row's own columns: the scope vocabulary, the coupling between the
-- scope type and department_name / employee_key, the department-to-metric mapping and
-- the scope-to-metric mapping. One rule cannot be a CHECK, because it spans two tables:
--
--     a Store-scope row's target_scope_id must be its OWN store's dealership_id
--
-- PostgreSQL cannot express a cross-column equality against another table in a CHECK,
-- and a trigger would be a hidden second load path. So the rule is enforced here, as a
-- domain rejection, and the rejected row is reported with its payload rather than
-- dropped. tests/integration/test_target_ingestion.py plants a mismatched row and
-- asserts it lands in staging.stg_sales_target_rejected instead of the warehouse.
--
-- NEWEST-BATCH RULE. Identical to every other staging view: greatest max(ingested_at),
-- ties broken by greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_sales_target_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.sales_target_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.sales_target_id), '')       AS src_sales_target_id,
        nullif(btrim(r.target_month_date_key), '') AS src_target_month_date_key,
        nullif(btrim(r.dealership_id), '')         AS src_dealership_id,
        nullif(btrim(r.target_scope_type), '')     AS src_target_scope_type,
        nullif(btrim(r.target_scope_id), '')       AS src_target_scope_id,
        nullif(btrim(r.department_name), '')       AS src_department_name,
        nullif(btrim(r.employee_id), '')           AS src_employee_id,
        nullif(btrim(r.kpi_id), '')                AS src_kpi_id,
        nullif(btrim(r.target_value), '')          AS src_target_value,
        nullif(btrim(r.stretch_target_value), '')  AS src_stretch_target_value,
        nullif(btrim(r.source_system), '')         AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.sales_target_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_sales_target_id) <= 16 THEN t.src_sales_target_id::varchar(16) END AS sales_target_id,
        staging.fn_try_integer(t.src_target_month_date_key) AS target_month_date_key,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_target_scope_type) <= 12 THEN t.src_target_scope_type::varchar(12) END AS target_scope_type,
        CASE WHEN length(t.src_target_scope_id) <= 40 THEN t.src_target_scope_id::varchar(40) END AS target_scope_id,
        CASE WHEN length(t.src_department_name) <= 20 THEN t.src_department_name::varchar(20) END AS department_name,
        CASE WHEN length(t.src_employee_id) <= 16 THEN t.src_employee_id::varchar(16) END AS employee_id,
        CASE WHEN length(t.src_kpi_id) <= 16 THEN t.src_kpi_id::varchar(16) END AS kpi_id,
        staging.fn_try_money(t.src_target_value) AS target_value,
        staging.fn_try_money(t.src_stretch_target_value) AS stretch_target_value,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_sales_target_id,
        t.src_target_month_date_key,
        t.src_dealership_id,
        t.src_target_scope_type,
        t.src_target_scope_id,
        t.src_department_name,
        t.src_employee_id,
        t.src_kpi_id,
        t.src_target_value,
        t.src_stretch_target_value,
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
            CASE WHEN c.src_sales_target_id IS NOT NULL AND c.sales_target_id IS NULL THEN 'sales_target_id' END,
            CASE WHEN c.src_target_month_date_key IS NOT NULL AND c.target_month_date_key IS NULL THEN 'target_month_date_key' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_target_scope_type IS NOT NULL AND c.target_scope_type IS NULL THEN 'target_scope_type' END,
            CASE WHEN c.src_target_scope_id IS NOT NULL AND c.target_scope_id IS NULL THEN 'target_scope_id' END,
            CASE WHEN c.src_department_name IS NOT NULL AND c.department_name IS NULL THEN 'department_name' END,
            CASE WHEN c.src_employee_id IS NOT NULL AND c.employee_id IS NULL THEN 'employee_id' END,
            CASE WHEN c.src_kpi_id IS NOT NULL AND c.kpi_id IS NULL THEN 'kpi_id' END,
            CASE WHEN c.src_target_value IS NOT NULL AND c.target_value IS NULL THEN 'target_value' END,
            CASE WHEN c.src_stretch_target_value IS NOT NULL AND c.stretch_target_value IS NULL THEN 'stretch_target_value' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. department_name and employee_id
        -- are absent BY DESIGN on the scopes that do not own them, so they are not
        -- listed here; their presence rule is a scope-integrity rule below.
        array_remove(ARRAY[
            CASE WHEN c.sales_target_id IS NULL THEN 'sales_target_id' END,
            CASE WHEN c.target_month_date_key IS NULL THEN 'target_month_date_key' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.target_scope_type IS NULL THEN 'target_scope_type' END,
            CASE WHEN c.target_scope_id IS NULL THEN 'target_scope_id' END,
            CASE WHEN c.kpi_id IS NULL THEN 'kpi_id' END,
            CASE WHEN c.target_value IS NULL THEN 'target_value' END,
            CASE WHEN c.stretch_target_value IS NULL THEN 'stretch_target_value' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain, outside the permitted numeric range, or
        -- carrying a scope identity that contradicts the scope type.
        array_remove(ARRAY[
            CASE WHEN c.target_scope_type IS NOT NULL
                  AND c.target_scope_type NOT IN ('Store', 'Department', 'Employee')
                 THEN 'target_scope_type' END,
            CASE WHEN c.kpi_id IS NOT NULL
                  AND c.kpi_id NOT IN ('KPI-SLS-001', 'KPI-GRS-001', 'KPI-GRS-002', 'KPI-GRS-003')
                 THEN 'kpi_id' END,
            CASE WHEN c.target_month_date_key IS NOT NULL AND c.target_month_date_key % 100 <> 1
                 THEN 'target_month_date_key' END,
            CASE WHEN c.target_value IS NOT NULL AND c.target_value < 0 THEN 'target_value' END,
            CASE WHEN c.stretch_target_value IS NOT NULL AND c.target_value IS NOT NULL
                  AND c.stretch_target_value < c.target_value
                 THEN 'stretch_target_value' END,
            -- Scope integrity. Store scope names its own store and carries neither a
            -- department nor an employee; Department scope carries the department it
            -- names and no employee; Employee scope carries the employee it names and
            -- no department.
            CASE WHEN c.target_scope_type = 'Store'
                  AND (c.department_name IS NOT NULL
                       OR c.employee_id IS NOT NULL
                       OR c.target_scope_id IS DISTINCT FROM c.dealership_id)
                 THEN 'target_scope_id' END,
            CASE WHEN c.target_scope_type = 'Department'
                  AND (c.department_name IS NULL
                       OR c.employee_id IS NOT NULL
                       OR c.department_name IS DISTINCT FROM c.target_scope_id
                       OR c.department_name NOT IN ('Sales', 'Finance'))
                 THEN 'department_name' END,
            CASE WHEN c.target_scope_type = 'Employee'
                  AND (c.employee_id IS NULL
                       OR c.department_name IS NOT NULL
                       OR c.employee_id IS DISTINCT FROM c.target_scope_id)
                 THEN 'employee_id' END,
            -- The scope-to-metric mapping. A department does not own total gross and a
            -- store does not carry a second, overlapping front-gross plan.
            CASE WHEN c.target_scope_type = 'Store'
                  AND c.kpi_id IS NOT NULL
                  AND c.kpi_id NOT IN ('KPI-SLS-001', 'KPI-GRS-003')
                 THEN 'kpi_id' END,
            CASE WHEN c.target_scope_type = 'Department'
                  AND c.kpi_id IS NOT NULL
                  AND NOT ((c.department_name = 'Sales' AND c.kpi_id = 'KPI-GRS-001')
                        OR (c.department_name = 'Finance' AND c.kpi_id = 'KPI-GRS-002'))
                 THEN 'kpi_id' END,
            CASE WHEN c.target_scope_type = 'Employee'
                  AND c.kpi_id IS NOT NULL
                  AND c.kpi_id <> 'KPI-SLS-001'
                 THEN 'kpi_id' END
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
                THEN 'value outside its governed domain, range or scope rule: '
                     || array_to_string(f.domain_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.sales_target_id,
    c.target_month_date_key,
    c.dealership_id,
    c.target_scope_type,
    c.target_scope_id,
    c.department_name,
    c.employee_id,
    c.kpi_id,
    c.target_value,
    c.stretch_target_value,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_sales_target_id,
    c.raw_record_id,
    c.load_batch_id,
    c.source_file_name,
    c.source_row_number,
    c.ingested_at,
    c.record_payload,
    c.rejection_code,
    c.rejection_category,
    c.rejection_reason,
    row_number() OVER (
        PARTITION BY c.sales_target_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_sales_target_typed IS
    'Grain: one row per row of the most recent raw.sales_target_load batch. Internal: every business
column is cast with a non-throwing expression and the row is classified as accepted (rejection_code IS
NULL and natural_key_rank = 1) or rejected. The scope-integrity rules that span two tables -- a
Store-scope row must name its own store -- are enforced here, because a CHECK constraint cannot
express them. staging.stg_sales_target and staging.stg_sales_target_rejected are the two halves of
this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_sales_target AS
SELECT DISTINCT ON (v.sales_target_id)
    v.sales_target_id,
    v.target_month_date_key,
    v.dealership_id,
    v.target_scope_type,
    v.target_scope_id,
    v.department_name,
    v.employee_id,
    v.kpi_id,
    v.target_value,
    v.stretch_target_value,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_sales_target_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.sales_target_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_sales_target IS
    'Grain: one row per sales_target_id, restricted to the most recent raw.sales_target_load batch and
to rows that satisfy every type, completeness, domain and scope-integrity rule. Duplicates are
resolved by keeping the highest raw_record_id; the losers are reported by
staging.stg_sales_target_rejected under REJ-KEY-001. This view is the only input the warehouse fact
load reads. It carries the monthly operating PLAN and computes no attainment, pace or projection:
those belong to reporting.vw_target_attainment.';

COMMENT ON COLUMN staging.stg_sales_target.sales_target_id IS 'Natural key, TGT-########.';
COMMENT ON COLUMN staging.stg_sales_target.target_month_date_key IS 'Date key of the first day of the target month, YYYYMM01.';
COMMENT ON COLUMN staging.stg_sales_target.dealership_id IS 'Store the target belongs to.';
COMMENT ON COLUMN staging.stg_sales_target.target_scope_type IS 'Store, Department or Employee. Part of the declared grain.';
COMMENT ON COLUMN staging.stg_sales_target.target_scope_id IS 'Business identity of the scope, never NULL: the dealership_id, the department name, or the employee_id. Non-null so the grain constraint needs no NULL-distinctness rule.';
COMMENT ON COLUMN staging.stg_sales_target.department_name IS 'Sales or Finance, on a Department-scope row only. NULL on every other scope.';
COMMENT ON COLUMN staging.stg_sales_target.employee_id IS 'Synthetic employee identifier, on an Employee-scope row only. NULL on every other scope. Never a name.';
COMMENT ON COLUMN staging.stg_sales_target.kpi_id IS 'The metric BEING TARGETED. Never a KPI-TGT id: the target KPIs are computed FROM these rows.';
COMMENT ON COLUMN staging.stg_sales_target.target_value IS 'The month''s committed goal, exact to two decimal places. A synthetic internal operating goal, never a benchmark.';
COMMENT ON COLUMN staging.stg_sales_target.stretch_target_value IS 'The month''s stretch goal, never below target_value.';
COMMENT ON COLUMN staging.stg_sales_target.source_system IS 'Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN staging.stg_sales_target.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_sales_target.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_sales_target.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_sales_target.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_sales_target.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_sales_target_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'sales_target'::text AS source_entity,
    coalesce(v.src_sales_target_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (sales_target_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_sales_target_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_sales_target_rejected IS
    'Grain: one row per row of the most recent raw.sales_target_load batch that staging.stg_sales_target
did NOT accept. Carries the REJ-* code, its canonical validation category and the untyped source
payload, which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record.
Rejected rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_sales_target_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_sales_target_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
