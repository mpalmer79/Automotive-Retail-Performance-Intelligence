-- =============================================================================
-- File:            sql/02_staging/18_stg_lender.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.lender_load batch, plus its rejected-row companion.
-- Execution order: After raw.lender_load and the staging cast helpers, before anything reads staging.stg_lender.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Grain:           staging.stg_lender: one accepted row per lender_id in the most recent load batch.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- =============================================================================
--
-- THE TWO CLOSED VOCABULARIES THIS VIEW ENFORCES
-- ----------------------------------------------
-- lender_category and program_tier are both closed, and the second matters more than it
-- looks. A program tier classifies the FICTIONAL LENDER'S PROGRAM and never a customer.
-- An open vocabulary would eventually admit a value that reads like a credit grade --
-- 'A+', 'Tier 3' -- and a reader would take it for one. ARPI carries no customer credit
-- attribute anywhere, so there is nothing a tier could legitimately be derived from.
--
-- NO RATE, PAYMENT, CREDIT OR DECISIONING VALUE PASSES THROUGH THIS LANE, because none
-- exists to pass: the column contract has no such field and DQ-LND-007 checks the schema.

CREATE OR REPLACE VIEW staging.stg_lender_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.lender_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.lender_key), '') AS src_lender_key,
        nullif(btrim(r.lender_id), '') AS src_lender_id,
        nullif(btrim(r.lender_name), '') AS src_lender_name,
        nullif(btrim(r.lender_category), '') AS src_lender_category,
        nullif(btrim(r.program_tier), '') AS src_program_tier,
        nullif(btrim(r.active_start_date), '') AS src_active_start_date,
        nullif(btrim(r.active_end_date), '') AS src_active_end_date,
        nullif(btrim(r.is_active), '') AS src_is_active,
        nullif(btrim(r.source_system), '') AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.lender_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_lender_key) AS lender_key,
        CASE WHEN length(t.src_lender_id) <= 16 THEN t.src_lender_id::varchar(16) END AS lender_id,
        CASE WHEN length(t.src_lender_name) <= 80 THEN t.src_lender_name::varchar(80) END AS lender_name,
        CASE WHEN length(t.src_lender_category) <= 40 THEN t.src_lender_category::varchar(40) END AS lender_category,
        CASE WHEN length(t.src_program_tier) <= 20 THEN t.src_program_tier::varchar(20) END AS program_tier,
        staging.fn_try_date(t.src_active_start_date) AS active_start_date,
        staging.fn_try_date(t.src_active_end_date) AS active_end_date,
        staging.fn_try_boolean(t.src_is_active) AS is_active,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_lender_key,
        t.src_lender_id,
        t.src_lender_name,
        t.src_lender_category,
        t.src_program_tier,
        t.src_active_start_date,
        t.src_active_end_date,
        t.src_is_active,
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
            CASE WHEN c.src_lender_key IS NOT NULL AND c.lender_key IS NULL THEN 'lender_key' END,
            CASE WHEN c.src_lender_id IS NOT NULL AND c.lender_id IS NULL THEN 'lender_id' END,
            CASE WHEN c.src_lender_name IS NOT NULL AND c.lender_name IS NULL THEN 'lender_name' END,
            CASE WHEN c.src_lender_category IS NOT NULL AND c.lender_category IS NULL THEN 'lender_category' END,
            CASE WHEN c.src_program_tier IS NOT NULL AND c.program_tier IS NULL THEN 'program_tier' END,
            CASE WHEN c.src_active_start_date IS NOT NULL AND c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.src_active_end_date IS NOT NULL AND c.active_end_date IS NULL THEN 'active_end_date' END,
            CASE WHEN c.src_is_active IS NOT NULL AND c.is_active IS NULL THEN 'is_active' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. The columns listed as
        -- deliberately optional are absent BY DESIGN: lender_key (lineage only; the warehouse assigns its own).
        array_remove(ARRAY[
            CASE WHEN c.lender_id IS NULL THEN 'lender_id' END,
            CASE WHEN c.lender_name IS NULL THEN 'lender_name' END,
            CASE WHEN c.lender_category IS NULL THEN 'lender_category' END,
            CASE WHEN c.program_tier IS NULL THEN 'program_tier' END,
            CASE WHEN c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.active_end_date IS NULL THEN 'active_end_date' END,
            CASE WHEN c.is_active IS NULL THEN 'is_active' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain, the permitted range, or a governed rule.
        array_remove(ARRAY[
            CASE WHEN c.lender_category IS NOT NULL
                  AND c.lender_category NOT IN ('Captive', 'Bank', 'Credit Union', 'Independent Finance Company')
                 THEN 'lender_category' END,
            -- Closed on purpose: see the header. A tier is a property of the lender''s
            -- program, never of a person, and never a credit grade.
            CASE WHEN c.program_tier IS NOT NULL
                  AND c.program_tier NOT IN ('Prime', 'Near-prime', 'Subprime')
                 THEN 'program_tier' END,
            CASE WHEN c.active_start_date IS NOT NULL AND c.active_end_date IS NOT NULL
                  AND c.active_end_date < c.active_start_date
                 THEN 'active_end_date' END,
            CASE WHEN c.is_active IS NOT NULL AND c.active_end_date IS NOT NULL
                  AND c.is_active <> (c.active_end_date = DATE '9999-12-31')
                 THEN 'is_active' END
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
                THEN 'value outside its governed domain, range or rule: '
                     || array_to_string(f.domain_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.lender_key,
    c.lender_id,
    c.lender_name,
    c.lender_category,
    c.program_tier,
    c.active_start_date,
    c.active_end_date,
    c.is_active,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_lender_id,
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
        PARTITION BY c.lender_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_lender_typed IS
    'Grain: one row per row of the most recent raw.lender_load batch. Internal: every business column is
cast with a non-throwing expression and the row is classified as accepted or rejected.
staging.stg_lender and staging.stg_lender_rejected are the two halves of this view.';

CREATE OR REPLACE VIEW staging.stg_lender AS
SELECT DISTINCT ON (v.lender_id)
    v.lender_key,
    v.lender_id,
    v.lender_name,
    v.lender_category,
    v.program_tier,
    v.active_start_date,
    v.active_end_date,
    v.is_active,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_lender_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.lender_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_lender IS
    'Grain: one row per lender_id, restricted to the most recent raw.lender_load batch and to rows that
satisfy every type, completeness and domain rule. The only input warehouse.dim_lender is merged
from. EVERY LENDER IS FICTIONAL and no real financial institution is named. Carries NO apr, buy
rate, sell rate, rate spread, money factor, payment, loan term, approval status, stipulation,
credit score or income figure: ARPI is not a lending model.';

COMMENT ON COLUMN staging.stg_lender.lender_key IS 'Generator-assigned ordinal, lineage only. The merge assigns the warehouse surrogate key.';
COMMENT ON COLUMN staging.stg_lender.lender_id IS 'Natural key, LND-###.';
COMMENT ON COLUMN staging.stg_lender.lender_name IS 'INVENTED institution label. Never a person and never a real financial institution.';
COMMENT ON COLUMN staging.stg_lender.lender_category IS 'Captive, Bank, Credit Union or Independent Finance Company.';
COMMENT ON COLUMN staging.stg_lender.program_tier IS 'Prime, Near-prime or Subprime. Classifies the FICTIONAL LENDER''S PROGRAM, never a customer, and is never a credit tier or an approval result.';
COMMENT ON COLUMN staging.stg_lender.active_start_date IS 'First date the lender''s program was available.';
COMMENT ON COLUMN staging.stg_lender.active_end_date IS 'Last date available, or the 9999-12-31 open-ended sentinel.';
COMMENT ON COLUMN staging.stg_lender.is_active IS 'DERIVED from active_end_date; a row where the two disagree is rejected as REJ-DOMAIN-001.';
COMMENT ON COLUMN staging.stg_lender.source_system IS 'Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN staging.stg_lender.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_lender.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lender.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_lender.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_lender.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_lender_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'lender'::text AS source_entity,
    coalesce(v.src_lender_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (lender_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_lender_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_lender_rejected IS
    'Grain: one row per row of the most recent raw.lender_load batch that staging.stg_lender did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected
rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_lender_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_lender_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_lender_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lender_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_lender_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_lender_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_lender_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_lender_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_lender_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_lender_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
