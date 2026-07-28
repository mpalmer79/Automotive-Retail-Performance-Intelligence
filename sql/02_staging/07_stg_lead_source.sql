-- =============================================================================
-- File:            sql/02_staging/07_stg_lead_source.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.lead_source_load batch, plus its rejected-row companion.
-- Execution order: 24 of 66 — after raw.lead_source_load and the staging cast helpers, before anything reads staging.stg_lead_source.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_lead_source: one accepted row per lead_source_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_lead_source_typed     every row of the newest batch, cast and classified
--   staging.stg_lead_source           the accepted rows only (what the warehouse loads)
--   staging.stg_lead_source_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_lead_source_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.lead_source_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.lead_source_key), '')                                   AS src_source_lead_source_key,
        nullif(btrim(r.lead_source_id), '')                                    AS src_lead_source_id,
        nullif(btrim(r.lead_source_name), '')                                  AS src_lead_source_name,
        nullif(btrim(r.source_category), '')                                   AS src_source_category,
        nullif(btrim(r.is_paid), '')                                           AS src_is_paid,
        nullif(btrim(r.is_digital), '')                                        AS src_is_digital,
        nullif(btrim(r.is_third_party), '')                                    AS src_is_third_party,
        nullif(btrim(r.is_internal), '')                                       AS src_is_internal,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.lead_source_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_source_lead_source_key) AS source_lead_source_key,
        CASE WHEN length(t.src_lead_source_id) <= 16 THEN t.src_lead_source_id::varchar(16) END AS lead_source_id,
        CASE WHEN length(t.src_lead_source_name) <= 60 THEN t.src_lead_source_name::varchar(60) END AS lead_source_name,
        CASE WHEN length(t.src_source_category) <= 30 THEN t.src_source_category::varchar(30) END AS source_category,
        staging.fn_try_boolean(t.src_is_paid) AS is_paid,
        staging.fn_try_boolean(t.src_is_digital) AS is_digital,
        staging.fn_try_boolean(t.src_is_third_party) AS is_third_party,
        staging.fn_try_boolean(t.src_is_internal) AS is_internal,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_source_lead_source_key,
        t.src_lead_source_id,
        t.src_lead_source_name,
        t.src_source_category,
        t.src_is_paid,
        t.src_is_digital,
        t.src_is_third_party,
        t.src_is_internal,
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
            CASE WHEN c.src_source_lead_source_key IS NOT NULL AND c.source_lead_source_key IS NULL THEN 'source_lead_source_key' END,
            CASE WHEN c.src_lead_source_id IS NOT NULL AND c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.src_lead_source_name IS NOT NULL AND c.lead_source_name IS NULL THEN 'lead_source_name' END,
            CASE WHEN c.src_source_category IS NOT NULL AND c.source_category IS NULL THEN 'source_category' END,
            CASE WHEN c.src_is_paid IS NOT NULL AND c.is_paid IS NULL THEN 'is_paid' END,
            CASE WHEN c.src_is_digital IS NOT NULL AND c.is_digital IS NULL THEN 'is_digital' END,
            CASE WHEN c.src_is_third_party IS NOT NULL AND c.is_third_party IS NULL THEN 'is_third_party' END,
            CASE WHEN c.src_is_internal IS NOT NULL AND c.is_internal IS NULL THEN 'is_internal' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.source_lead_source_key IS NULL THEN 'source_lead_source_key' END,
            CASE WHEN c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.lead_source_name IS NULL THEN 'lead_source_name' END,
            CASE WHEN c.source_category IS NULL THEN 'source_category' END,
            CASE WHEN c.is_paid IS NULL THEN 'is_paid' END,
            CASE WHEN c.is_digital IS NULL THEN 'is_digital' END,
            CASE WHEN c.is_third_party IS NULL THEN 'is_third_party' END,
            CASE WHEN c.is_internal IS NULL THEN 'is_internal' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.source_category IS NOT NULL AND c.source_category NOT IN ('Owned Digital', 'Third Party', 'Paid Search', 'Paid Social', 'Traditional Media', 'Walk-in', 'Referral', 'Internal', 'Organic Web') THEN 'source_category' END
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
    c.source_lead_source_key,
    c.lead_source_id,
    c.lead_source_name,
    c.source_category,
    c.is_paid,
    c.is_digital,
    c.is_third_party,
    c.is_internal,
    c.source_system,
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
        PARTITION BY c.lead_source_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_lead_source_typed IS
    'Grain: one row per row of the most recent raw.lead_source_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_lead_source and 
staging.stg_lead_source_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_lead_source AS
SELECT DISTINCT ON (v.lead_source_id)
    v.source_lead_source_key,
    v.lead_source_id,
    v.lead_source_name,
    v.source_category,
    v.is_paid,
    v.is_digital,
    v.is_third_party,
    v.is_internal,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_lead_source_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.lead_source_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_lead_source IS
    'Grain: one row per lead_source_id, restricted to the most recent raw.lead_source_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_lead_source_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_lead_source.source_lead_source_key IS 'Generator-assigned lead_source_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/16_dim_lead_source_merge.sql, so staging exposes this as source_lead_source_key.';
COMMENT ON COLUMN staging.stg_lead_source.lead_source_id IS 'Natural key, LDS-### (contract section 5).';
COMMENT ON COLUMN staging.stg_lead_source.lead_source_name IS 'Generic, fictional lead-source label. Names a channel, never a person or a real vendor.';
COMMENT ON COLUMN staging.stg_lead_source.source_category IS 'Normalised channel category.';
COMMENT ON COLUMN staging.stg_lead_source.is_paid IS 'Whether the source costs money per lead or per impression.';
COMMENT ON COLUMN staging.stg_lead_source.is_digital IS 'Whether the source is a digital channel.';
COMMENT ON COLUMN staging.stg_lead_source.is_third_party IS 'Whether the source is operated by a third party rather than the group.';
COMMENT ON COLUMN staging.stg_lead_source.is_internal IS 'Whether the source originates inside the group, for example a repeat customer.';
COMMENT ON COLUMN staging.stg_lead_source.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_lead_source.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_lead_source.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lead_source.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_lead_source.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_lead_source.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_lead_source_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'lead_source'::text AS source_entity,
    coalesce(v.src_lead_source_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (lead_source_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_lead_source_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_lead_source_rejected IS
    'Grain: one row per row of the most recent raw.lead_source_load batch that staging.stg_lead_source did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_lead_source_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_lead_source_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
