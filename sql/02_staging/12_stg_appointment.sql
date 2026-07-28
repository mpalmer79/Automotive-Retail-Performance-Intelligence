-- =============================================================================
-- File:            sql/02_staging/12_stg_appointment.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.appointment_load batch, plus its rejected-row companion.
-- Execution order: 29 of 66 — after raw.appointment_load and the staging cast helpers, before anything reads staging.stg_appointment.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_appointment: one accepted row per appointment_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_appointment_typed     every row of the newest batch, cast and classified
--   staging.stg_appointment           the accepted rows only (what the warehouse loads)
--   staging.stg_appointment_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_appointment_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.appointment_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.appointment_id), '')                                    AS src_appointment_id,
        nullif(btrim(r.created_date), '')                                      AS src_created_date,
        nullif(btrim(r.scheduled_date), '')                                    AS src_scheduled_date,
        nullif(btrim(r.show_date), '')                                         AS src_show_date,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.lead_id), '')                                           AS src_lead_id,
        nullif(btrim(r.customer_id), '')                                       AS src_customer_id,
        nullif(btrim(r.salesperson_id), '')                                    AS src_salesperson_id,
        nullif(btrim(r.bdc_employee_id), '')                                   AS src_bdc_employee_id,
        nullif(btrim(r.vehicle_model_id), '')                                  AS src_vehicle_model_id,
        nullif(btrim(r.sale_id), '')                                           AS src_sale_id,
        nullif(btrim(r.appointment_count), '')                                 AS src_appointment_count,
        nullif(btrim(r.is_confirmed), '')                                      AS src_is_confirmed,
        nullif(btrim(r.is_cancelled_in_advance), '')                           AS src_is_cancelled_in_advance,
        nullif(btrim(r.is_shown), '')                                          AS src_is_shown,
        nullif(btrim(r.is_test_drive), '')                                     AS src_is_test_drive,
        nullif(btrim(r.is_write_up), '')                                       AS src_is_write_up,
        nullif(btrim(r.is_sold), '')                                           AS src_is_sold,
        nullif(btrim(r.minutes_early_or_late), '')                             AS src_minutes_early_or_late,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.appointment_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_appointment_id) <= 20 THEN t.src_appointment_id::varchar(20) END AS appointment_id,
        staging.fn_try_date(t.src_created_date) AS created_date,
        staging.fn_try_date(t.src_scheduled_date) AS scheduled_date,
        staging.fn_try_date(t.src_show_date) AS show_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_lead_id) <= 20 THEN t.src_lead_id::varchar(20) END AS lead_id,
        CASE WHEN length(t.src_customer_id) <= 16 THEN t.src_customer_id::varchar(16) END AS customer_id,
        CASE WHEN length(t.src_salesperson_id) <= 16 THEN t.src_salesperson_id::varchar(16) END AS salesperson_id,
        CASE WHEN length(t.src_bdc_employee_id) <= 16 THEN t.src_bdc_employee_id::varchar(16) END AS bdc_employee_id,
        CASE WHEN length(t.src_vehicle_model_id) <= 16 THEN t.src_vehicle_model_id::varchar(16) END AS vehicle_model_id,
        CASE WHEN length(t.src_sale_id) <= 16 THEN t.src_sale_id::varchar(16) END AS sale_id,
        staging.fn_try_smallint(t.src_appointment_count) AS appointment_count,
        staging.fn_try_boolean(t.src_is_confirmed) AS is_confirmed,
        staging.fn_try_boolean(t.src_is_cancelled_in_advance) AS is_cancelled_in_advance,
        staging.fn_try_boolean(t.src_is_shown) AS is_shown,
        staging.fn_try_boolean(t.src_is_test_drive) AS is_test_drive,
        staging.fn_try_boolean(t.src_is_write_up) AS is_write_up,
        staging.fn_try_boolean(t.src_is_sold) AS is_sold,
        staging.fn_try_integer(t.src_minutes_early_or_late) AS minutes_early_or_late,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_appointment_id,
        t.src_created_date,
        t.src_scheduled_date,
        t.src_show_date,
        t.src_dealership_id,
        t.src_lead_id,
        t.src_customer_id,
        t.src_salesperson_id,
        t.src_bdc_employee_id,
        t.src_vehicle_model_id,
        t.src_sale_id,
        t.src_appointment_count,
        t.src_is_confirmed,
        t.src_is_cancelled_in_advance,
        t.src_is_shown,
        t.src_is_test_drive,
        t.src_is_write_up,
        t.src_is_sold,
        t.src_minutes_early_or_late,
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
            CASE WHEN c.src_appointment_id IS NOT NULL AND c.appointment_id IS NULL THEN 'appointment_id' END,
            CASE WHEN c.src_created_date IS NOT NULL AND c.created_date IS NULL THEN 'created_date' END,
            CASE WHEN c.src_scheduled_date IS NOT NULL AND c.scheduled_date IS NULL THEN 'scheduled_date' END,
            CASE WHEN c.src_show_date IS NOT NULL AND c.show_date IS NULL THEN 'show_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_lead_id IS NOT NULL AND c.lead_id IS NULL THEN 'lead_id' END,
            CASE WHEN c.src_customer_id IS NOT NULL AND c.customer_id IS NULL THEN 'customer_id' END,
            CASE WHEN c.src_salesperson_id IS NOT NULL AND c.salesperson_id IS NULL THEN 'salesperson_id' END,
            CASE WHEN c.src_bdc_employee_id IS NOT NULL AND c.bdc_employee_id IS NULL THEN 'bdc_employee_id' END,
            CASE WHEN c.src_vehicle_model_id IS NOT NULL AND c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.src_sale_id IS NOT NULL AND c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.src_appointment_count IS NOT NULL AND c.appointment_count IS NULL THEN 'appointment_count' END,
            CASE WHEN c.src_is_confirmed IS NOT NULL AND c.is_confirmed IS NULL THEN 'is_confirmed' END,
            CASE WHEN c.src_is_cancelled_in_advance IS NOT NULL AND c.is_cancelled_in_advance IS NULL THEN 'is_cancelled_in_advance' END,
            CASE WHEN c.src_is_shown IS NOT NULL AND c.is_shown IS NULL THEN 'is_shown' END,
            CASE WHEN c.src_is_test_drive IS NOT NULL AND c.is_test_drive IS NULL THEN 'is_test_drive' END,
            CASE WHEN c.src_is_write_up IS NOT NULL AND c.is_write_up IS NULL THEN 'is_write_up' END,
            CASE WHEN c.src_is_sold IS NOT NULL AND c.is_sold IS NULL THEN 'is_sold' END,
            CASE WHEN c.src_minutes_early_or_late IS NOT NULL AND c.minutes_early_or_late IS NULL THEN 'minutes_early_or_late' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.appointment_id IS NULL THEN 'appointment_id' END,
            CASE WHEN c.created_date IS NULL THEN 'created_date' END,
            CASE WHEN c.scheduled_date IS NULL THEN 'scheduled_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.lead_id IS NULL THEN 'lead_id' END,
            CASE WHEN c.appointment_count IS NULL THEN 'appointment_count' END,
            CASE WHEN c.is_confirmed IS NULL THEN 'is_confirmed' END,
            CASE WHEN c.is_cancelled_in_advance IS NULL THEN 'is_cancelled_in_advance' END,
            CASE WHEN c.is_shown IS NULL THEN 'is_shown' END,
            CASE WHEN c.is_test_drive IS NULL THEN 'is_test_drive' END,
            CASE WHEN c.is_write_up IS NULL THEN 'is_write_up' END,
            CASE WHEN c.is_sold IS NULL THEN 'is_sold' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.appointment_count IS NOT NULL AND (c.appointment_count < 1 OR c.appointment_count > 1) THEN 'appointment_count' END,
            CASE WHEN c.minutes_early_or_late IS NOT NULL AND (c.minutes_early_or_late < -100000 OR c.minutes_early_or_late > 100000) THEN 'minutes_early_or_late' END
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
    c.appointment_id,
    c.created_date,
    c.scheduled_date,
    c.show_date,
    c.dealership_id,
    c.lead_id,
    c.customer_id,
    c.salesperson_id,
    c.bdc_employee_id,
    c.vehicle_model_id,
    c.sale_id,
    c.appointment_count,
    c.is_confirmed,
    c.is_cancelled_in_advance,
    c.is_shown,
    c.is_test_drive,
    c.is_write_up,
    c.is_sold,
    c.minutes_early_or_late,
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
        PARTITION BY c.appointment_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_appointment_typed IS
    'Grain: one row per row of the most recent raw.appointment_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_appointment and 
staging.stg_appointment_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_appointment AS
SELECT DISTINCT ON (v.appointment_id)
    v.appointment_id,
    v.created_date,
    v.scheduled_date,
    v.show_date,
    v.dealership_id,
    v.lead_id,
    v.customer_id,
    v.salesperson_id,
    v.bdc_employee_id,
    v.vehicle_model_id,
    v.sale_id,
    v.appointment_count,
    v.is_confirmed,
    v.is_cancelled_in_advance,
    v.is_shown,
    v.is_test_drive,
    v.is_write_up,
    v.is_sold,
    v.minutes_early_or_late,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_appointment_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.appointment_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_appointment IS
    'Grain: one row per appointment_id, restricted to the most recent raw.appointment_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_appointment_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_appointment.appointment_id IS 'Natural key, APT-######## (contract section 5).';
COMMENT ON COLUMN staging.stg_appointment.created_date IS 'Date the appointment was created.';
COMMENT ON COLUMN staging.stg_appointment.scheduled_date IS 'Date the appointment was scheduled for; never before created_date.';
COMMENT ON COLUMN staging.stg_appointment.show_date IS 'Date the customer actually attended; NULL when they did not.';
COMMENT ON COLUMN staging.stg_appointment.dealership_id IS 'Store the appointment belongs to.';
COMMENT ON COLUMN staging.stg_appointment.lead_id IS 'Lead the appointment was set from.';
COMMENT ON COLUMN staging.stg_appointment.customer_id IS 'Customer expected; NULL when the lead never resolved to one.';
COMMENT ON COLUMN staging.stg_appointment.salesperson_id IS 'Salesperson assigned; NULL when none.';
COMMENT ON COLUMN staging.stg_appointment.bdc_employee_id IS 'BDC representative who set the appointment; NULL when none.';
COMMENT ON COLUMN staging.stg_appointment.vehicle_model_id IS 'Model of interest; NULL when none was expressed.';
COMMENT ON COLUMN staging.stg_appointment.sale_id IS 'Sale the appointment produced; NULL when it produced none.';
COMMENT ON COLUMN staging.stg_appointment.appointment_count IS 'Always exactly 1; the additive count measure.';
COMMENT ON COLUMN staging.stg_appointment.is_confirmed IS 'Whether the appointment was confirmed in advance.';
COMMENT ON COLUMN staging.stg_appointment.is_cancelled_in_advance IS 'Whether the customer cancelled before the slot.';
COMMENT ON COLUMN staging.stg_appointment.is_shown IS 'Whether the customer attended.';
COMMENT ON COLUMN staging.stg_appointment.is_test_drive IS 'Whether a test drive took place.';
COMMENT ON COLUMN staging.stg_appointment.is_write_up IS 'Whether the visit produced a written deal.';
COMMENT ON COLUMN staging.stg_appointment.is_sold IS 'Whether the visit produced a sale.';
COMMENT ON COLUMN staging.stg_appointment.minutes_early_or_late IS 'Signed minutes early (negative) or late (positive). NULL when the customer did not attend.';
COMMENT ON COLUMN staging.stg_appointment.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_appointment.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_appointment.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_appointment.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_appointment.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_appointment.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_appointment_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'appointment'::text AS source_entity,
    coalesce(v.src_appointment_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (appointment_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_appointment_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_appointment_rejected IS
    'Grain: one row per row of the most recent raw.appointment_load batch that staging.stg_appointment did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_appointment_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_appointment_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_appointment_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_appointment_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_appointment_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_appointment_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_appointment_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_appointment_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_appointment_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_appointment_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
