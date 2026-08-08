-- =============================================================================
-- File:            sql/02_staging/22_stg_gl_account.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Type, validate and deduplicate raw.gl_account_load into staging.stg_gl_account, quarantining every row it does not accept.
-- Execution order: After sql/01_raw/21_raw_gl_account_load.sql and the staging cast helpers.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; no data is written.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per gl_account_id, from the most recent load batch, after type, completeness and domain rejection.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-023-dim-gl-account.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. The SELECTED synthetic control-account catalogue. It is not a
-- chart of accounts, and the domain rules below are what keep it from becoming one: the
-- account category must be a governed inventory control category, so an account named
-- Cash, Payroll or Accounts Payable cannot enter through this door.
--
-- Every account is invented. No real dealer group's chart of accounts was consulted.
--
-- NEWEST-BATCH RULE. Identical to every other staging view: greatest max(ingested_at),
-- ties broken by greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_gl_account_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.gl_account_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.gl_account_id), '')          AS src_gl_account_id,
        nullif(btrim(r.account_number), '')         AS src_account_number,
        nullif(btrim(r.account_name), '')           AS src_account_name,
        nullif(btrim(r.account_category), '')       AS src_account_category,
        nullif(btrim(r.account_type), '')           AS src_account_type,
        nullif(btrim(r.normal_balance), '')         AS src_normal_balance,
        nullif(btrim(r.inventory_control_flag), '') AS src_inventory_control_flag,
        nullif(btrim(r.active_start_date), '')      AS src_active_start_date,
        nullif(btrim(r.active_end_date), '')        AS src_active_end_date,
        nullif(btrim(r.source_system), '')          AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.gl_account_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_gl_account_id) <= 16 THEN t.src_gl_account_id::varchar(16) END AS gl_account_id,
        CASE WHEN length(t.src_account_number) <= 20 THEN t.src_account_number::varchar(20) END AS account_number,
        CASE WHEN length(t.src_account_name) <= 60 THEN t.src_account_name::varchar(60) END AS account_name,
        CASE WHEN length(t.src_account_category) <= 40 THEN t.src_account_category::varchar(40) END AS account_category,
        CASE WHEN length(t.src_account_type) <= 20 THEN t.src_account_type::varchar(20) END AS account_type,
        CASE WHEN length(t.src_normal_balance) <= 10 THEN t.src_normal_balance::varchar(10) END AS normal_balance,
        staging.fn_try_boolean(t.src_inventory_control_flag) AS inventory_control_flag,
        staging.fn_try_date(t.src_active_start_date) AS active_start_date,
        staging.fn_try_date(t.src_active_end_date) AS active_end_date,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_gl_account_id,
        t.src_account_number,
        t.src_account_name,
        t.src_account_category,
        t.src_account_type,
        t.src_normal_balance,
        t.src_inventory_control_flag,
        t.src_active_start_date,
        t.src_active_end_date,
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
            CASE WHEN c.src_gl_account_id IS NOT NULL AND c.gl_account_id IS NULL THEN 'gl_account_id' END,
            CASE WHEN c.src_account_number IS NOT NULL AND c.account_number IS NULL THEN 'account_number' END,
            CASE WHEN c.src_account_name IS NOT NULL AND c.account_name IS NULL THEN 'account_name' END,
            CASE WHEN c.src_account_category IS NOT NULL AND c.account_category IS NULL THEN 'account_category' END,
            CASE WHEN c.src_account_type IS NOT NULL AND c.account_type IS NULL THEN 'account_type' END,
            CASE WHEN c.src_normal_balance IS NOT NULL AND c.normal_balance IS NULL THEN 'normal_balance' END,
            CASE WHEN c.src_inventory_control_flag IS NOT NULL AND c.inventory_control_flag IS NULL THEN 'inventory_control_flag' END,
            CASE WHEN c.src_active_start_date IS NOT NULL AND c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.src_active_end_date IS NOT NULL AND c.active_end_date IS NULL THEN 'active_end_date' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.gl_account_id IS NULL THEN 'gl_account_id' END,
            CASE WHEN c.account_number IS NULL THEN 'account_number' END,
            CASE WHEN c.account_name IS NULL THEN 'account_name' END,
            CASE WHEN c.account_category IS NULL THEN 'account_category' END,
            CASE WHEN c.account_type IS NULL THEN 'account_type' END,
            CASE WHEN c.normal_balance IS NULL THEN 'normal_balance' END,
            CASE WHEN c.inventory_control_flag IS NULL THEN 'inventory_control_flag' END,
            CASE WHEN c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or outside the permitted numeric range.
        array_remove(ARRAY[
            -- The guard on the scope decision: a category outside the governed set is a
            -- general-ledger account, and DASH.8 builds a control schedule rather than a GL.
            CASE WHEN c.account_category IS NOT NULL
                  AND c.account_category NOT IN ('New Vehicle Inventory', 'Used Vehicle Inventory', 'Certified Vehicle Inventory')
                 THEN 'account_category' END,
            CASE WHEN c.account_type IS NOT NULL AND c.account_type NOT IN ('Asset', 'Liability') THEN 'account_type' END,
            CASE WHEN c.normal_balance IS NOT NULL AND c.normal_balance NOT IN ('Debit', 'Credit') THEN 'normal_balance' END,
            -- A flag that contradicts the category it summarises is worse than no flag.
            CASE WHEN c.inventory_control_flag IS NOT NULL AND c.account_category IS NOT NULL
                  AND c.inventory_control_flag <> (c.account_category IN ('New Vehicle Inventory', 'Used Vehicle Inventory', 'Certified Vehicle Inventory'))
                 THEN 'inventory_control_flag' END,
            CASE WHEN c.active_end_date IS NOT NULL AND c.active_start_date IS NOT NULL
                  AND c.active_end_date < c.active_start_date
                 THEN 'active_end_date' END
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
    c.gl_account_id,
    c.account_number,
    c.account_name,
    c.account_category,
    c.account_type,
    c.normal_balance,
    c.inventory_control_flag,
    c.active_start_date,
    c.active_end_date,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified even when
    -- the cast that would have typed it is what failed.
    c.src_gl_account_id,
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
        PARTITION BY c.gl_account_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_gl_account_typed IS
    'Grain: one row per row of the most recent raw.gl_account_load batch. Internal: every business column is
cast with a non-throwing expression and the row is classified as accepted (rejection_code IS NULL and
natural_key_rank = 1) or rejected. staging.stg_gl_account and staging.stg_gl_account_rejected are the two
halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_gl_account AS
SELECT DISTINCT ON (v.gl_account_id)
    v.gl_account_id,
    v.account_number,
    v.account_name,
    v.account_category,
    v.account_type,
    v.normal_balance,
    v.inventory_control_flag,
    v.active_start_date,
    v.active_end_date,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_gl_account_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.gl_account_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_gl_account IS
    'Grain: one row per gl_account_id, restricted to the most recent raw.gl_account_load batch and to rows
that satisfy every type, completeness and domain rule. A SELECTED synthetic control-account catalogue
for a fictional dealer group -- never a chart of accounts. The category domain rule is what prevents a
general-ledger account entering through this view.';

COMMENT ON COLUMN staging.stg_gl_account.gl_account_id IS 'Natural key, GLA-####.';
COMMENT ON COLUMN staging.stg_gl_account.account_number IS 'Synthetic account number. Invented, never a real dealer group's.';
COMMENT ON COLUMN staging.stg_gl_account.account_name IS 'Human-readable account name. Invented.';
COMMENT ON COLUMN staging.stg_gl_account.account_category IS 'The governed inventory control category the account schedules.';
COMMENT ON COLUMN staging.stg_gl_account.account_type IS 'Asset or Liability.';
COMMENT ON COLUMN staging.stg_gl_account.normal_balance IS 'Debit or Credit.';
COMMENT ON COLUMN staging.stg_gl_account.inventory_control_flag IS 'Whether the account is an inventory control account. Must agree with the category.';
COMMENT ON COLUMN staging.stg_gl_account.active_start_date IS 'First date the account is active.';
COMMENT ON COLUMN staging.stg_gl_account.active_end_date IS 'Last date the account is active; NULL while open.';
COMMENT ON COLUMN staging.stg_gl_account.source_system IS 'Originating system; constant SYNTHETIC-DMS-GL.';
COMMENT ON COLUMN staging.stg_gl_account.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_gl_account.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_gl_account.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_gl_account.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_gl_account.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_gl_account_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'dim_gl_account'::text AS source_entity,
    coalesce(v.src_gl_account_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (gl_account_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_gl_account_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_gl_account_rejected IS
    'Grain: one row per row of the most recent raw.gl_account_load batch that staging.stg_gl_account did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows
are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_gl_account_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_gl_account_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
