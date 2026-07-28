-- =============================================================================
-- File:            sql/02_staging/11_stg_lead.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.lead_load batch, plus its rejected-row companion.
-- Execution order: 28 of 66 — after raw.lead_load and the staging cast helpers, before anything reads staging.stg_lead.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_lead: one accepted row per lead_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_lead_typed     every row of the newest batch, cast and classified
--   staging.stg_lead           the accepted rows only (what the warehouse loads)
--   staging.stg_lead_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_lead_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.lead_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.lead_id), '')                                           AS src_lead_id,
        nullif(btrim(r.lead_created_date), '')                                 AS src_lead_created_date,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.customer_id), '')                                       AS src_customer_id,
        nullif(btrim(r.vehicle_model_id), '')                                  AS src_vehicle_model_id,
        nullif(btrim(r.lead_source_id), '')                                    AS src_lead_source_id,
        nullif(btrim(r.campaign_id), '')                                       AS src_campaign_id,
        nullif(btrim(r.assigned_employee_id), '')                              AS src_assigned_employee_id,
        nullif(btrim(r.sale_id), '')                                           AS src_sale_id,
        nullif(btrim(r.lead_count), '')                                        AS src_lead_count,
        nullif(btrim(r.first_response_seconds), '')                            AS src_first_response_seconds,
        nullif(btrim(r.is_contacted), '')                                      AS src_is_contacted,
        nullif(btrim(r.is_appointment_set), '')                                AS src_is_appointment_set,
        nullif(btrim(r.is_appointment_shown), '')                              AS src_is_appointment_shown,
        nullif(btrim(r.is_sold), '')                                           AS src_is_sold,
        nullif(btrim(r.is_duplicate), '')                                      AS src_is_duplicate,
        nullif(btrim(r.original_lead_id), '')                                  AS src_original_lead_id,
        nullif(btrim(r.days_to_sale), '')                                      AS src_days_to_sale,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.lead_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_lead_id) <= 20 THEN t.src_lead_id::varchar(20) END AS lead_id,
        staging.fn_try_date(t.src_lead_created_date) AS lead_created_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_customer_id) <= 16 THEN t.src_customer_id::varchar(16) END AS customer_id,
        CASE WHEN length(t.src_vehicle_model_id) <= 16 THEN t.src_vehicle_model_id::varchar(16) END AS vehicle_model_id,
        CASE WHEN length(t.src_lead_source_id) <= 16 THEN t.src_lead_source_id::varchar(16) END AS lead_source_id,
        CASE WHEN length(t.src_campaign_id) <= 16 THEN t.src_campaign_id::varchar(16) END AS campaign_id,
        CASE WHEN length(t.src_assigned_employee_id) <= 16 THEN t.src_assigned_employee_id::varchar(16) END AS assigned_employee_id,
        CASE WHEN length(t.src_sale_id) <= 16 THEN t.src_sale_id::varchar(16) END AS sale_id,
        staging.fn_try_smallint(t.src_lead_count) AS lead_count,
        staging.fn_try_integer(t.src_first_response_seconds) AS first_response_seconds,
        staging.fn_try_boolean(t.src_is_contacted) AS is_contacted,
        staging.fn_try_boolean(t.src_is_appointment_set) AS is_appointment_set,
        staging.fn_try_boolean(t.src_is_appointment_shown) AS is_appointment_shown,
        staging.fn_try_boolean(t.src_is_sold) AS is_sold,
        staging.fn_try_boolean(t.src_is_duplicate) AS is_duplicate,
        CASE WHEN length(t.src_original_lead_id) <= 20 THEN t.src_original_lead_id::varchar(20) END AS original_lead_id,
        staging.fn_try_integer(t.src_days_to_sale) AS days_to_sale,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_lead_id,
        t.src_lead_created_date,
        t.src_dealership_id,
        t.src_customer_id,
        t.src_vehicle_model_id,
        t.src_lead_source_id,
        t.src_campaign_id,
        t.src_assigned_employee_id,
        t.src_sale_id,
        t.src_lead_count,
        t.src_first_response_seconds,
        t.src_is_contacted,
        t.src_is_appointment_set,
        t.src_is_appointment_shown,
        t.src_is_sold,
        t.src_is_duplicate,
        t.src_original_lead_id,
        t.src_days_to_sale,
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
            CASE WHEN c.src_lead_id IS NOT NULL AND c.lead_id IS NULL THEN 'lead_id' END,
            CASE WHEN c.src_lead_created_date IS NOT NULL AND c.lead_created_date IS NULL THEN 'lead_created_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_customer_id IS NOT NULL AND c.customer_id IS NULL THEN 'customer_id' END,
            CASE WHEN c.src_vehicle_model_id IS NOT NULL AND c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.src_lead_source_id IS NOT NULL AND c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.src_campaign_id IS NOT NULL AND c.campaign_id IS NULL THEN 'campaign_id' END,
            CASE WHEN c.src_assigned_employee_id IS NOT NULL AND c.assigned_employee_id IS NULL THEN 'assigned_employee_id' END,
            CASE WHEN c.src_sale_id IS NOT NULL AND c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.src_lead_count IS NOT NULL AND c.lead_count IS NULL THEN 'lead_count' END,
            CASE WHEN c.src_first_response_seconds IS NOT NULL AND c.first_response_seconds IS NULL THEN 'first_response_seconds' END,
            CASE WHEN c.src_is_contacted IS NOT NULL AND c.is_contacted IS NULL THEN 'is_contacted' END,
            CASE WHEN c.src_is_appointment_set IS NOT NULL AND c.is_appointment_set IS NULL THEN 'is_appointment_set' END,
            CASE WHEN c.src_is_appointment_shown IS NOT NULL AND c.is_appointment_shown IS NULL THEN 'is_appointment_shown' END,
            CASE WHEN c.src_is_sold IS NOT NULL AND c.is_sold IS NULL THEN 'is_sold' END,
            CASE WHEN c.src_is_duplicate IS NOT NULL AND c.is_duplicate IS NULL THEN 'is_duplicate' END,
            CASE WHEN c.src_original_lead_id IS NOT NULL AND c.original_lead_id IS NULL THEN 'original_lead_id' END,
            CASE WHEN c.src_days_to_sale IS NOT NULL AND c.days_to_sale IS NULL THEN 'days_to_sale' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.lead_id IS NULL THEN 'lead_id' END,
            CASE WHEN c.lead_created_date IS NULL THEN 'lead_created_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.lead_count IS NULL THEN 'lead_count' END,
            CASE WHEN c.is_contacted IS NULL THEN 'is_contacted' END,
            CASE WHEN c.is_appointment_set IS NULL THEN 'is_appointment_set' END,
            CASE WHEN c.is_appointment_shown IS NULL THEN 'is_appointment_shown' END,
            CASE WHEN c.is_sold IS NULL THEN 'is_sold' END,
            CASE WHEN c.is_duplicate IS NULL THEN 'is_duplicate' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.lead_count IS NOT NULL AND (c.lead_count < 1 OR c.lead_count > 1) THEN 'lead_count' END,
            CASE WHEN c.first_response_seconds IS NOT NULL AND (c.first_response_seconds < 0 OR c.first_response_seconds > 100000000) THEN 'first_response_seconds' END,
            CASE WHEN c.days_to_sale IS NOT NULL AND (c.days_to_sale < 0 OR c.days_to_sale > 3650) THEN 'days_to_sale' END
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
    c.lead_id,
    c.lead_created_date,
    c.dealership_id,
    c.customer_id,
    c.vehicle_model_id,
    c.lead_source_id,
    c.campaign_id,
    c.assigned_employee_id,
    c.sale_id,
    c.lead_count,
    c.first_response_seconds,
    c.is_contacted,
    c.is_appointment_set,
    c.is_appointment_shown,
    c.is_sold,
    c.is_duplicate,
    c.original_lead_id,
    c.days_to_sale,
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
        PARTITION BY c.lead_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_lead_typed IS
    'Grain: one row per row of the most recent raw.lead_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_lead and 
staging.stg_lead_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_lead AS
SELECT DISTINCT ON (v.lead_id)
    v.lead_id,
    v.lead_created_date,
    v.dealership_id,
    v.customer_id,
    v.vehicle_model_id,
    v.lead_source_id,
    v.campaign_id,
    v.assigned_employee_id,
    v.sale_id,
    v.lead_count,
    v.first_response_seconds,
    v.is_contacted,
    v.is_appointment_set,
    v.is_appointment_shown,
    v.is_sold,
    v.is_duplicate,
    v.original_lead_id,
    v.days_to_sale,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_lead_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.lead_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_lead IS
    'Grain: one row per lead_id, restricted to the most recent raw.lead_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_lead_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_lead.lead_id IS 'Natural key, LED-######### (contract section 5).';
COMMENT ON COLUMN staging.stg_lead.lead_created_date IS 'Date the lead was created in the CRM.';
COMMENT ON COLUMN staging.stg_lead.dealership_id IS 'Store the lead belongs to.';
COMMENT ON COLUMN staging.stg_lead.customer_id IS 'Customer the lead resolved to; NULL when it never resolved to one.';
COMMENT ON COLUMN staging.stg_lead.vehicle_model_id IS 'Model of interest; NULL when the lead expressed none.';
COMMENT ON COLUMN staging.stg_lead.lead_source_id IS 'Source the lead arrived from.';
COMMENT ON COLUMN staging.stg_lead.campaign_id IS 'Campaign the lead is attributed to; NULL when unattributed.';
COMMENT ON COLUMN staging.stg_lead.assigned_employee_id IS 'Employee the lead was assigned to; NULL when unassigned.';
COMMENT ON COLUMN staging.stg_lead.sale_id IS 'Sale the lead converted to; NULL when it did not convert.';
COMMENT ON COLUMN staging.stg_lead.lead_count IS 'Always exactly 1; the additive count measure.';
COMMENT ON COLUMN staging.stg_lead.first_response_seconds IS 'Seconds to first response. NULL means never responded to; 0 is a real value, never a stand-in for missing.';
COMMENT ON COLUMN staging.stg_lead.is_contacted IS 'Whether anyone made contact.';
COMMENT ON COLUMN staging.stg_lead.is_appointment_set IS 'Whether an appointment was set.';
COMMENT ON COLUMN staging.stg_lead.is_appointment_shown IS 'Whether the appointment was kept.';
COMMENT ON COLUMN staging.stg_lead.is_sold IS 'Whether the lead converted to a sale.';
COMMENT ON COLUMN staging.stg_lead.is_duplicate IS 'Whether the lead duplicates an earlier one.';
COMMENT ON COLUMN staging.stg_lead.original_lead_id IS 'Lead this one duplicates; NULL when it is not a duplicate.';
COMMENT ON COLUMN staging.stg_lead.days_to_sale IS 'Days from lead creation to sale; NULL when it never sold.';
COMMENT ON COLUMN staging.stg_lead.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_lead.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_lead.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lead.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_lead.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_lead.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_lead_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'lead'::text AS source_entity,
    coalesce(v.src_lead_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (lead_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_lead_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_lead_rejected IS
    'Grain: one row per row of the most recent raw.lead_load batch that staging.stg_lead did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_lead_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_lead_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_lead_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_lead_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_lead_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_lead_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_lead_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_lead_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_lead_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_lead_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
