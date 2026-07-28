-- =============================================================================
-- File:            sql/02_staging/06_stg_customer.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.customer_load batch, plus its rejected-row companion.
-- Execution order: 23 of 66 — after raw.customer_load and the staging cast helpers, before anything reads staging.stg_customer.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_customer: one accepted row per customer_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_customer_typed     every row of the newest batch, cast and classified
--   staging.stg_customer           the accepted rows only (what the warehouse loads)
--   staging.stg_customer_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_customer_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.customer_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.customer_key), '')                                      AS src_source_customer_key,
        nullif(btrim(r.customer_id), '')                                       AS src_customer_id,
        nullif(btrim(r.household_id), '')                                      AS src_household_id,
        nullif(btrim(r.age_band), '')                                          AS src_age_band,
        nullif(btrim(r.county), '')                                            AS src_county,
        upper(nullif(btrim(r.state_code), ''))                                 AS src_state_code,
        nullif(btrim(r.market_area), '')                                       AS src_market_area,
        nullif(btrim(r.customer_type), '')                                     AS src_customer_type,
        nullif(btrim(r.is_prior_customer), '')                                 AS src_is_prior_customer,
        nullif(btrim(r.is_service_customer), '')                               AS src_is_service_customer,
        nullif(btrim(r.first_interaction_date), '')                            AS src_first_interaction_date,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.customer_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_source_customer_key) AS source_customer_key,
        CASE WHEN length(t.src_customer_id) <= 16 THEN t.src_customer_id::varchar(16) END AS customer_id,
        CASE WHEN length(t.src_household_id) <= 16 THEN t.src_household_id::varchar(16) END AS household_id,
        CASE WHEN length(t.src_age_band) <= 20 THEN t.src_age_band::varchar(20) END AS age_band,
        CASE WHEN length(t.src_county) <= 40 THEN t.src_county::varchar(40) END AS county,
        CASE WHEN length(t.src_state_code) = 2 THEN t.src_state_code::char(2) END AS state_code,
        CASE WHEN length(t.src_market_area) <= 40 THEN t.src_market_area::varchar(40) END AS market_area,
        CASE WHEN length(t.src_customer_type) <= 20 THEN t.src_customer_type::varchar(20) END AS customer_type,
        staging.fn_try_boolean(t.src_is_prior_customer) AS is_prior_customer,
        staging.fn_try_boolean(t.src_is_service_customer) AS is_service_customer,
        staging.fn_try_date(t.src_first_interaction_date) AS first_interaction_date,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_source_customer_key,
        t.src_customer_id,
        t.src_household_id,
        t.src_age_band,
        t.src_county,
        t.src_state_code,
        t.src_market_area,
        t.src_customer_type,
        t.src_is_prior_customer,
        t.src_is_service_customer,
        t.src_first_interaction_date,
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
            CASE WHEN c.src_source_customer_key IS NOT NULL AND c.source_customer_key IS NULL THEN 'source_customer_key' END,
            CASE WHEN c.src_customer_id IS NOT NULL AND c.customer_id IS NULL THEN 'customer_id' END,
            CASE WHEN c.src_household_id IS NOT NULL AND c.household_id IS NULL THEN 'household_id' END,
            CASE WHEN c.src_age_band IS NOT NULL AND c.age_band IS NULL THEN 'age_band' END,
            CASE WHEN c.src_county IS NOT NULL AND c.county IS NULL THEN 'county' END,
            CASE WHEN c.src_state_code IS NOT NULL AND c.state_code IS NULL THEN 'state_code' END,
            CASE WHEN c.src_market_area IS NOT NULL AND c.market_area IS NULL THEN 'market_area' END,
            CASE WHEN c.src_customer_type IS NOT NULL AND c.customer_type IS NULL THEN 'customer_type' END,
            CASE WHEN c.src_is_prior_customer IS NOT NULL AND c.is_prior_customer IS NULL THEN 'is_prior_customer' END,
            CASE WHEN c.src_is_service_customer IS NOT NULL AND c.is_service_customer IS NULL THEN 'is_service_customer' END,
            CASE WHEN c.src_first_interaction_date IS NOT NULL AND c.first_interaction_date IS NULL THEN 'first_interaction_date' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.source_customer_key IS NULL THEN 'source_customer_key' END,
            CASE WHEN c.customer_id IS NULL THEN 'customer_id' END,
            CASE WHEN c.household_id IS NULL THEN 'household_id' END,
            CASE WHEN c.age_band IS NULL THEN 'age_band' END,
            CASE WHEN c.county IS NULL THEN 'county' END,
            CASE WHEN c.state_code IS NULL THEN 'state_code' END,
            CASE WHEN c.market_area IS NULL THEN 'market_area' END,
            CASE WHEN c.customer_type IS NULL THEN 'customer_type' END,
            CASE WHEN c.is_prior_customer IS NULL THEN 'is_prior_customer' END,
            CASE WHEN c.is_service_customer IS NULL THEN 'is_service_customer' END,
            CASE WHEN c.first_interaction_date IS NULL THEN 'first_interaction_date' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.age_band IS NOT NULL AND c.age_band NOT IN ('18-24', '25-34', '35-44', '45-54', '55-64', '65+') THEN 'age_band' END,
            CASE WHEN c.county IS NOT NULL AND c.county NOT IN ('Hillsborough', 'Rockingham', 'Merrimack', 'Strafford', 'Middlesex', 'Essex') THEN 'county' END,
            CASE WHEN c.market_area IS NOT NULL AND c.market_area NOT IN ('Southern New Hampshire', 'Northern Massachusetts') THEN 'market_area' END,
            CASE WHEN c.customer_type IS NOT NULL AND c.customer_type NOT IN ('Retail', 'Business') THEN 'customer_type' END
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
    c.source_customer_key,
    c.customer_id,
    c.household_id,
    c.age_band,
    c.county,
    c.state_code,
    c.market_area,
    c.customer_type,
    c.is_prior_customer,
    c.is_service_customer,
    c.first_interaction_date,
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
        PARTITION BY c.customer_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_customer_typed IS
    'Grain: one row per row of the most recent raw.customer_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_customer and 
staging.stg_customer_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_customer AS
SELECT DISTINCT ON (v.customer_id)
    v.source_customer_key,
    v.customer_id,
    v.household_id,
    v.age_band,
    v.county,
    v.state_code,
    v.market_area,
    v.customer_type,
    v.is_prior_customer,
    v.is_service_customer,
    v.first_interaction_date,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_customer_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.customer_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_customer IS
    'Grain: one row per customer_id, restricted to the most recent raw.customer_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_customer_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_customer.source_customer_key IS 'Generator-assigned customer_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/15_dim_customer_merge.sql, so staging exposes this as source_customer_key.';
COMMENT ON COLUMN staging.stg_customer.customer_id IS 'Natural key, CUS-######## (contract section 5).';
COMMENT ON COLUMN staging.stg_customer.household_id IS 'Synthetic household grouping, HH-########. Links related customers without naming anybody.';
COMMENT ON COLUMN staging.stg_customer.age_band IS 'Banded age cohort. Exact age and date of birth are prohibited.';
COMMENT ON COLUMN staging.stg_customer.county IS 'County of residence. Geography deliberately stops here; no street address exists.';
COMMENT ON COLUMN staging.stg_customer.state_code IS 'Two-letter state code; NH or MA.';
COMMENT ON COLUMN staging.stg_customer.market_area IS 'Coarse market area the county belongs to.';
COMMENT ON COLUMN staging.stg_customer.customer_type IS 'Retail | Business.';
COMMENT ON COLUMN staging.stg_customer.is_prior_customer IS 'Whether the customer had transacted with the group before.';
COMMENT ON COLUMN staging.stg_customer.is_service_customer IS 'Whether the customer is known to the service department.';
COMMENT ON COLUMN staging.stg_customer.first_interaction_date IS 'Date of the first recorded interaction with the group.';
COMMENT ON COLUMN staging.stg_customer.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_customer.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_customer.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_customer.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_customer.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_customer.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_customer_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'customer'::text AS source_entity,
    coalesce(v.src_customer_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (customer_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_customer_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_customer_rejected IS
    'Grain: one row per row of the most recent raw.customer_load batch that staging.stg_customer did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_customer_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_customer_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_customer_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_customer_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_customer_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_customer_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_customer_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_customer_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_customer_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_customer_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
