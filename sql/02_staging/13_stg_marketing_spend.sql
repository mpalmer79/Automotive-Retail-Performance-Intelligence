-- =============================================================================
-- File:            sql/02_staging/13_stg_marketing_spend.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.marketing_spend_load batch, plus its rejected-row companion.
-- Execution order: 30 of 66 — after raw.marketing_spend_load and the staging cast helpers, before anything reads staging.stg_marketing_spend.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_marketing_spend: one accepted row per marketing_spend_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_marketing_spend_typed     every row of the newest batch, cast and classified
--   staging.stg_marketing_spend           the accepted rows only (what the warehouse loads)
--   staging.stg_marketing_spend_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_marketing_spend_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.marketing_spend_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.marketing_spend_id), '')                                AS src_marketing_spend_id,
        nullif(btrim(r.month_date), '')                                        AS src_month_date,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.campaign_id), '')                                       AS src_campaign_id,
        nullif(btrim(r.lead_source_id), '')                                    AS src_lead_source_id,
        nullif(btrim(r.spend_amount), '')                                      AS src_spend_amount,
        nullif(btrim(r.impressions), '')                                       AS src_impressions,
        nullif(btrim(r.clicks), '')                                            AS src_clicks,
        nullif(btrim(r.calls), '')                                             AS src_calls,
        nullif(btrim(r.form_submissions), '')                                  AS src_form_submissions,
        nullif(btrim(r.vendor_reported_leads), '')                             AS src_vendor_reported_leads,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.marketing_spend_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_marketing_spend_id) <= 16 THEN t.src_marketing_spend_id::varchar(16) END AS marketing_spend_id,
        staging.fn_try_date(t.src_month_date) AS month_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_campaign_id) <= 16 THEN t.src_campaign_id::varchar(16) END AS campaign_id,
        CASE WHEN length(t.src_lead_source_id) <= 16 THEN t.src_lead_source_id::varchar(16) END AS lead_source_id,
        staging.fn_try_money(t.src_spend_amount) AS spend_amount,
        staging.fn_try_bigint(t.src_impressions) AS impressions,
        staging.fn_try_bigint(t.src_clicks) AS clicks,
        staging.fn_try_integer(t.src_calls) AS calls,
        staging.fn_try_integer(t.src_form_submissions) AS form_submissions,
        staging.fn_try_integer(t.src_vendor_reported_leads) AS vendor_reported_leads,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_marketing_spend_id,
        t.src_month_date,
        t.src_dealership_id,
        t.src_campaign_id,
        t.src_lead_source_id,
        t.src_spend_amount,
        t.src_impressions,
        t.src_clicks,
        t.src_calls,
        t.src_form_submissions,
        t.src_vendor_reported_leads,
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
            CASE WHEN c.src_marketing_spend_id IS NOT NULL AND c.marketing_spend_id IS NULL THEN 'marketing_spend_id' END,
            CASE WHEN c.src_month_date IS NOT NULL AND c.month_date IS NULL THEN 'month_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_campaign_id IS NOT NULL AND c.campaign_id IS NULL THEN 'campaign_id' END,
            CASE WHEN c.src_lead_source_id IS NOT NULL AND c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.src_spend_amount IS NOT NULL AND c.spend_amount IS NULL THEN 'spend_amount' END,
            CASE WHEN c.src_impressions IS NOT NULL AND c.impressions IS NULL THEN 'impressions' END,
            CASE WHEN c.src_clicks IS NOT NULL AND c.clicks IS NULL THEN 'clicks' END,
            CASE WHEN c.src_calls IS NOT NULL AND c.calls IS NULL THEN 'calls' END,
            CASE WHEN c.src_form_submissions IS NOT NULL AND c.form_submissions IS NULL THEN 'form_submissions' END,
            CASE WHEN c.src_vendor_reported_leads IS NOT NULL AND c.vendor_reported_leads IS NULL THEN 'vendor_reported_leads' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.marketing_spend_id IS NULL THEN 'marketing_spend_id' END,
            CASE WHEN c.month_date IS NULL THEN 'month_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.campaign_id IS NULL THEN 'campaign_id' END,
            CASE WHEN c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.spend_amount IS NULL THEN 'spend_amount' END,
            CASE WHEN c.impressions IS NULL THEN 'impressions' END,
            CASE WHEN c.clicks IS NULL THEN 'clicks' END,
            CASE WHEN c.calls IS NULL THEN 'calls' END,
            CASE WHEN c.form_submissions IS NULL THEN 'form_submissions' END,
            CASE WHEN c.vendor_reported_leads IS NULL THEN 'vendor_reported_leads' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.impressions IS NOT NULL AND (c.impressions < 0 OR c.impressions > 1000000000000000) THEN 'impressions' END,
            CASE WHEN c.clicks IS NOT NULL AND (c.clicks < 0 OR c.clicks > 1000000000000000) THEN 'clicks' END,
            CASE WHEN c.calls IS NOT NULL AND (c.calls < 0 OR c.calls > 1000000000) THEN 'calls' END,
            CASE WHEN c.form_submissions IS NOT NULL AND (c.form_submissions < 0 OR c.form_submissions > 1000000000) THEN 'form_submissions' END,
            CASE WHEN c.vendor_reported_leads IS NOT NULL AND (c.vendor_reported_leads < 0 OR c.vendor_reported_leads > 1000000000) THEN 'vendor_reported_leads' END
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
    c.marketing_spend_id,
    c.month_date,
    c.dealership_id,
    c.campaign_id,
    c.lead_source_id,
    c.spend_amount,
    c.impressions,
    c.clicks,
    c.calls,
    c.form_submissions,
    c.vendor_reported_leads,
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
        PARTITION BY c.marketing_spend_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_marketing_spend_typed IS
    'Grain: one row per row of the most recent raw.marketing_spend_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_marketing_spend and 
staging.stg_marketing_spend_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_marketing_spend AS
SELECT DISTINCT ON (v.marketing_spend_id)
    v.marketing_spend_id,
    v.month_date,
    v.dealership_id,
    v.campaign_id,
    v.lead_source_id,
    v.spend_amount,
    v.impressions,
    v.clicks,
    v.calls,
    v.form_submissions,
    v.vendor_reported_leads,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_marketing_spend_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.marketing_spend_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_marketing_spend IS
    'Grain: one row per marketing_spend_id, restricted to the most recent raw.marketing_spend_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_marketing_spend_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_marketing_spend.marketing_spend_id IS 'Natural key, MKT-######## (contract section 5).';
COMMENT ON COLUMN staging.stg_marketing_spend.month_date IS 'First day of the spend month.';
COMMENT ON COLUMN staging.stg_marketing_spend.dealership_id IS 'Store the spend belongs to.';
COMMENT ON COLUMN staging.stg_marketing_spend.campaign_id IS 'Campaign the spend belongs to.';
COMMENT ON COLUMN staging.stg_marketing_spend.lead_source_id IS 'Lead source the campaign attributes to.';
COMMENT ON COLUMN staging.stg_marketing_spend.spend_amount IS 'Money spent in the month, exact to the cent.';
COMMENT ON COLUMN staging.stg_marketing_spend.impressions IS 'Vendor-reported impressions.';
COMMENT ON COLUMN staging.stg_marketing_spend.clicks IS 'Vendor-reported clicks.';
COMMENT ON COLUMN staging.stg_marketing_spend.calls IS 'Vendor-reported inbound calls.';
COMMENT ON COLUMN staging.stg_marketing_spend.form_submissions IS 'Vendor-reported form submissions.';
COMMENT ON COLUMN staging.stg_marketing_spend.vendor_reported_leads IS 'Leads the vendor claims. Intentionally differs from the CRM lead count; the gap is the point of the measure, not a defect.';
COMMENT ON COLUMN staging.stg_marketing_spend.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_marketing_spend.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_marketing_spend.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_marketing_spend.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_marketing_spend.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_marketing_spend.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_marketing_spend_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'marketing_spend'::text AS source_entity,
    coalesce(v.src_marketing_spend_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (marketing_spend_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_marketing_spend_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_marketing_spend_rejected IS
    'Grain: one row per row of the most recent raw.marketing_spend_load batch that staging.stg_marketing_spend did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_marketing_spend_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_marketing_spend_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
