-- =============================================================================
-- File:            sql/02_staging/04_stg_vehicle.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.vehicle_load batch, plus its rejected-row companion.
-- Execution order: 21 of 66 — after raw.vehicle_load and the staging cast helpers, before anything reads staging.stg_vehicle.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_vehicle: one accepted row per vehicle_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_vehicle_typed     every row of the newest batch, cast and classified
--   staging.stg_vehicle           the accepted rows only (what the warehouse loads)
--   staging.stg_vehicle_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_vehicle_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.vehicle_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.vehicle_key), '')                                       AS src_source_vehicle_key,
        nullif(btrim(r.vehicle_id), '')                                        AS src_vehicle_id,
        upper(nullif(btrim(r.synthetic_vin), ''))                              AS src_synthetic_vin,
        nullif(btrim(r.vehicle_model_key), '')                                 AS src_source_vehicle_model_key,
        nullif(btrim(r.vehicle_model_id), '')                                  AS src_vehicle_model_id,
        nullif(btrim(r.condition_type), '')                                    AS src_condition_type,
        nullif(btrim(r.exterior_color), '')                                    AS src_exterior_color,
        nullif(btrim(r.interior_color), '')                                    AS src_interior_color,
        nullif(btrim(r.odometer_reading), '')                                  AS src_odometer_reading,
        nullif(btrim(r.odometer_band), '')                                     AS src_odometer_band,
        nullif(btrim(r.acquisition_source), '')                                AS src_acquisition_source,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.vehicle_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_source_vehicle_key) AS source_vehicle_key,
        CASE WHEN length(t.src_vehicle_id) <= 16 THEN t.src_vehicle_id::varchar(16) END AS vehicle_id,
        CASE WHEN length(t.src_synthetic_vin) = 17 THEN t.src_synthetic_vin::char(17) END AS synthetic_vin,
        staging.fn_try_integer(t.src_source_vehicle_model_key) AS source_vehicle_model_key,
        CASE WHEN length(t.src_vehicle_model_id) <= 16 THEN t.src_vehicle_model_id::varchar(16) END AS vehicle_model_id,
        CASE WHEN length(t.src_condition_type) <= 12 THEN t.src_condition_type::varchar(12) END AS condition_type,
        CASE WHEN length(t.src_exterior_color) <= 30 THEN t.src_exterior_color::varchar(30) END AS exterior_color,
        CASE WHEN length(t.src_interior_color) <= 30 THEN t.src_interior_color::varchar(30) END AS interior_color,
        staging.fn_try_integer(t.src_odometer_reading) AS odometer_reading,
        CASE WHEN length(t.src_odometer_band) <= 20 THEN t.src_odometer_band::varchar(20) END AS odometer_band,
        CASE WHEN length(t.src_acquisition_source) <= 40 THEN t.src_acquisition_source::varchar(40) END AS acquisition_source,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_source_vehicle_key,
        t.src_vehicle_id,
        t.src_synthetic_vin,
        t.src_source_vehicle_model_key,
        t.src_vehicle_model_id,
        t.src_condition_type,
        t.src_exterior_color,
        t.src_interior_color,
        t.src_odometer_reading,
        t.src_odometer_band,
        t.src_acquisition_source,
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
            CASE WHEN c.src_source_vehicle_key IS NOT NULL AND c.source_vehicle_key IS NULL THEN 'source_vehicle_key' END,
            CASE WHEN c.src_vehicle_id IS NOT NULL AND c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.src_synthetic_vin IS NOT NULL AND c.synthetic_vin IS NULL THEN 'synthetic_vin' END,
            CASE WHEN c.src_source_vehicle_model_key IS NOT NULL AND c.source_vehicle_model_key IS NULL THEN 'source_vehicle_model_key' END,
            CASE WHEN c.src_vehicle_model_id IS NOT NULL AND c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.src_condition_type IS NOT NULL AND c.condition_type IS NULL THEN 'condition_type' END,
            CASE WHEN c.src_exterior_color IS NOT NULL AND c.exterior_color IS NULL THEN 'exterior_color' END,
            CASE WHEN c.src_interior_color IS NOT NULL AND c.interior_color IS NULL THEN 'interior_color' END,
            CASE WHEN c.src_odometer_reading IS NOT NULL AND c.odometer_reading IS NULL THEN 'odometer_reading' END,
            CASE WHEN c.src_odometer_band IS NOT NULL AND c.odometer_band IS NULL THEN 'odometer_band' END,
            CASE WHEN c.src_acquisition_source IS NOT NULL AND c.acquisition_source IS NULL THEN 'acquisition_source' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.source_vehicle_key IS NULL THEN 'source_vehicle_key' END,
            CASE WHEN c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.synthetic_vin IS NULL THEN 'synthetic_vin' END,
            CASE WHEN c.source_vehicle_model_key IS NULL THEN 'source_vehicle_model_key' END,
            CASE WHEN c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.condition_type IS NULL THEN 'condition_type' END,
            CASE WHEN c.exterior_color IS NULL THEN 'exterior_color' END,
            CASE WHEN c.interior_color IS NULL THEN 'interior_color' END,
            CASE WHEN c.odometer_reading IS NULL THEN 'odometer_reading' END,
            CASE WHEN c.odometer_band IS NULL THEN 'odometer_band' END,
            CASE WHEN c.acquisition_source IS NULL THEN 'acquisition_source' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.condition_type IS NOT NULL AND c.condition_type NOT IN ('New', 'Used', 'Certified') THEN 'condition_type' END,
            CASE WHEN c.odometer_reading IS NOT NULL AND (c.odometer_reading < 0 OR c.odometer_reading > 2000000) THEN 'odometer_reading' END,
            CASE WHEN c.odometer_band IS NOT NULL AND c.odometer_band NOT IN ('New', 'Under 10k', '10k-30k', '30k-60k', '60k-100k', 'Over 100k') THEN 'odometer_band' END,
            CASE WHEN c.acquisition_source IS NOT NULL AND c.acquisition_source NOT IN ('Customer Trade', 'Auction', 'Off-street Purchase', 'Lease Return', 'Dealer Trade', 'Manufacturer Allocation') THEN 'acquisition_source' END
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
    c.source_vehicle_key,
    c.vehicle_id,
    c.synthetic_vin,
    c.source_vehicle_model_key,
    c.vehicle_model_id,
    c.condition_type,
    c.exterior_color,
    c.interior_color,
    c.odometer_reading,
    c.odometer_band,
    c.acquisition_source,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_vehicle_id,
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
        PARTITION BY c.vehicle_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_vehicle_typed IS
    'Grain: one row per row of the most recent raw.vehicle_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_vehicle and 
staging.stg_vehicle_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_vehicle AS
SELECT DISTINCT ON (v.vehicle_id)
    v.source_vehicle_key,
    v.vehicle_id,
    v.synthetic_vin,
    v.source_vehicle_model_key,
    v.vehicle_model_id,
    v.condition_type,
    v.exterior_color,
    v.interior_color,
    v.odometer_reading,
    v.odometer_band,
    v.acquisition_source,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_vehicle_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.vehicle_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_vehicle IS
    'Grain: one row per vehicle_id, restricted to the most recent raw.vehicle_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_vehicle_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_vehicle.source_vehicle_key IS 'Generator-assigned vehicle_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/13_dim_vehicle_merge.sql, so staging exposes this as source_vehicle_key.';
COMMENT ON COLUMN staging.stg_vehicle.vehicle_id IS 'Natural key, VEH-####### (contract section 5).';
COMMENT ON COLUMN staging.stg_vehicle.synthetic_vin IS '17-character synthetic vehicle identifier with the ARPI prefix. Deliberately NOT a valid VIN and never resolvable to a real vehicle or owner.';
COMMENT ON COLUMN staging.stg_vehicle.source_vehicle_model_key IS 'Generator-assigned vehicle_model_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/13_dim_vehicle_merge.sql, so staging exposes this as source_vehicle_model_key.';
COMMENT ON COLUMN staging.stg_vehicle.vehicle_model_id IS 'Model this vehicle is an instance of; resolved to a surrogate key by the merge.';
COMMENT ON COLUMN staging.stg_vehicle.condition_type IS 'New | Used | Certified.';
COMMENT ON COLUMN staging.stg_vehicle.exterior_color IS 'Exterior colour label.';
COMMENT ON COLUMN staging.stg_vehicle.interior_color IS 'Interior colour label.';
COMMENT ON COLUMN staging.stg_vehicle.odometer_reading IS 'Odometer reading in miles; never negative.';
COMMENT ON COLUMN staging.stg_vehicle.odometer_band IS 'Banded odometer reading used for reporting.';
COMMENT ON COLUMN staging.stg_vehicle.acquisition_source IS 'How the store came to own the vehicle.';
COMMENT ON COLUMN staging.stg_vehicle.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_vehicle.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_vehicle.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_vehicle.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_vehicle.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_vehicle.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_vehicle_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'vehicle'::text AS source_entity,
    coalesce(v.src_vehicle_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (vehicle_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_vehicle_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_vehicle_rejected IS
    'Grain: one row per row of the most recent raw.vehicle_load batch that staging.stg_vehicle did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_vehicle_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_vehicle_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
