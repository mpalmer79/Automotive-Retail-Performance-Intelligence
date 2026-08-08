-- =============================================================================
-- File:            sql/02_staging/23_stg_gl_control_balance.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Type, validate and deduplicate raw.gl_control_balance_load into staging.stg_gl_control_balance, quarantining every row it does not accept.
-- Execution order: After sql/01_raw/22_raw_gl_control_balance_load.sql and the staging cast helpers.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; no data is written.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per gl_control_balance_id, from the most recent load batch, after type, completeness and domain rejection.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-024-fact-gl-control-balance.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. One control-account balance per store per account per month-end.
--
-- A VARIANCE AGAINST THE SUBLEDGER IS NOT REJECTED HERE, AND MUST NEVER BE. Staging asks
-- whether a balance row is structurally valid. Whether it AGREES with the stock schedule
-- is a reconciliation question, answered in sql/08_validation and rendered by
-- reporting.vw_inventory_gl_reconciliation. A controlled variance passes every rule below,
-- which is the intended behaviour: rejecting it would delete the exception the whole
-- domain exists to surface.
--
-- NEWEST-BATCH RULE. Identical to every other staging view: greatest max(ingested_at),
-- ties broken by greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_gl_control_balance_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.gl_control_balance_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.gl_control_balance_id), '') AS src_gl_control_balance_id,
        nullif(btrim(r.dealership_id), '')         AS src_dealership_id,
        nullif(btrim(r.gl_account_id), '')         AS src_gl_account_id,
        nullif(btrim(r.balance_date), '')          AS src_balance_date,
        nullif(btrim(r.net_balance), '')           AS src_net_balance,
        nullif(btrim(r.source_system), '')         AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.gl_control_balance_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_gl_control_balance_id) <= 16 THEN t.src_gl_control_balance_id::varchar(16) END AS gl_control_balance_id,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_gl_account_id) <= 16 THEN t.src_gl_account_id::varchar(16) END AS gl_account_id,
        staging.fn_try_date(t.src_balance_date) AS balance_date,
        staging.fn_try_money(t.src_net_balance) AS net_balance,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_gl_control_balance_id,
        t.src_dealership_id,
        t.src_gl_account_id,
        t.src_balance_date,
        t.src_net_balance,
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
            CASE WHEN c.src_gl_control_balance_id IS NOT NULL AND c.gl_control_balance_id IS NULL THEN 'gl_control_balance_id' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_gl_account_id IS NOT NULL AND c.gl_account_id IS NULL THEN 'gl_account_id' END,
            CASE WHEN c.src_balance_date IS NOT NULL AND c.balance_date IS NULL THEN 'balance_date' END,
            CASE WHEN c.src_net_balance IS NOT NULL AND c.net_balance IS NULL THEN 'net_balance' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.gl_control_balance_id IS NULL THEN 'gl_control_balance_id' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.gl_account_id IS NULL THEN 'gl_account_id' END,
            CASE WHEN c.balance_date IS NULL THEN 'balance_date' END,
            CASE WHEN c.net_balance IS NULL THEN 'net_balance' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or outside the permitted numeric range.
        array_remove(ARRAY[
            -- Deliberately sparse. A balance is valid whatever its value; the only
            -- structural rule is that it exists and is exactly typed. Whether it AGREES
            -- with the subledger is a reconciliation question, not a rejection rule.
            CASE WHEN c.gl_account_id IS NOT NULL AND c.gl_account_id !~ '^GLA-[0-9]{4}$' THEN 'gl_account_id' END
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
    c.gl_control_balance_id,
    c.dealership_id,
    c.gl_account_id,
    c.balance_date,
    c.net_balance,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified even when
    -- the cast that would have typed it is what failed.
    c.src_gl_control_balance_id,
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
        PARTITION BY c.gl_control_balance_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_gl_control_balance_typed IS
    'Grain: one row per row of the most recent raw.gl_control_balance_load batch. Internal: every business column is
cast with a non-throwing expression and the row is classified as accepted (rejection_code IS NULL and
natural_key_rank = 1) or rejected. staging.stg_gl_control_balance and staging.stg_gl_control_balance_rejected are the two
halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_gl_control_balance AS
SELECT DISTINCT ON (v.gl_control_balance_id)
    v.gl_control_balance_id,
    v.dealership_id,
    v.gl_account_id,
    v.balance_date,
    v.net_balance,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_gl_control_balance_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.gl_control_balance_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_gl_control_balance IS
    'Grain: one row per gl_control_balance_id, restricted to the most recent raw.gl_control_balance_load
batch and to rows that satisfy every type, completeness and domain rule. Synthetic control-account
balances, generated to demonstrate reconciliation mechanics rather than ingested from a second system.
A balance that differs from the stock schedule is a VARIANCE, reported by
reporting.vw_inventory_gl_reconciliation, and is never rejected here.';

COMMENT ON COLUMN staging.stg_gl_control_balance.gl_control_balance_id IS 'Natural key, GLB-########.';
COMMENT ON COLUMN staging.stg_gl_control_balance.dealership_id IS 'Store the balance belongs to.';
COMMENT ON COLUMN staging.stg_gl_control_balance.gl_account_id IS 'The control account. Resolved to a surrogate key by the fact load.';
COMMENT ON COLUMN staging.stg_gl_control_balance.balance_date IS 'Month-end the balance is stated as at. Comparable only with a schedule at the same date.';
COMMENT ON COLUMN staging.stg_gl_control_balance.net_balance IS 'The control-account balance, exact to two decimal places. May legitimately differ from the subledger: that is a variance, not a defect.';
COMMENT ON COLUMN staging.stg_gl_control_balance.source_system IS 'Originating system; constant SYNTHETIC-DMS-GL.';
COMMENT ON COLUMN staging.stg_gl_control_balance.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_gl_control_balance.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_gl_control_balance.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_gl_control_balance.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_gl_control_balance.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_gl_control_balance_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'gl_control_balance'::text AS source_entity,
    coalesce(v.src_gl_control_balance_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (gl_control_balance_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_gl_control_balance_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_gl_control_balance_rejected IS
    'Grain: one row per row of the most recent raw.gl_control_balance_load batch that staging.stg_gl_control_balance did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows
are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_gl_control_balance_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
