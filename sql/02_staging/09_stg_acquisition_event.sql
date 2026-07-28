-- =============================================================================
-- File:            sql/02_staging/09_stg_acquisition_event.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.acquisition_event_load batch, plus its rejected-row companion.
-- Execution order: 26 of 66 — after raw.acquisition_event_load and the staging cast helpers, before anything reads staging.stg_acquisition_event.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_acquisition_event: one accepted row per acquisition_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_acquisition_event_typed     every row of the newest batch, cast and classified
--   staging.stg_acquisition_event           the accepted rows only (what the warehouse loads)
--   staging.stg_acquisition_event_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_acquisition_event_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.acquisition_event_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.acquisition_id), '')                                    AS src_acquisition_id,
        nullif(btrim(r.vehicle_id), '')                                        AS src_vehicle_id,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.acquisition_date), '')                                  AS src_acquisition_date,
        nullif(btrim(r.acquisition_source), '')                                AS src_acquisition_source,
        nullif(btrim(r.acquisition_cost), '')                                  AS src_acquisition_cost,
        nullif(btrim(r.reconditioning_cost), '')                               AS src_reconditioning_cost,
        nullif(btrim(r.original_asking_price), '')                             AS src_original_asking_price,
        nullif(btrim(r.msrp), '')                                              AS src_msrp,
        nullif(btrim(r.initial_inventory_status), '')                          AS src_initial_inventory_status,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.acquisition_event_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_acquisition_id) <= 16 THEN t.src_acquisition_id::varchar(16) END AS acquisition_id,
        CASE WHEN length(t.src_vehicle_id) <= 16 THEN t.src_vehicle_id::varchar(16) END AS vehicle_id,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        staging.fn_try_date(t.src_acquisition_date) AS acquisition_date,
        CASE WHEN length(t.src_acquisition_source) <= 40 THEN t.src_acquisition_source::varchar(40) END AS acquisition_source,
        staging.fn_try_money(t.src_acquisition_cost) AS acquisition_cost,
        staging.fn_try_money(t.src_reconditioning_cost) AS reconditioning_cost,
        staging.fn_try_money(t.src_original_asking_price) AS original_asking_price,
        staging.fn_try_money(t.src_msrp) AS msrp,
        CASE WHEN length(t.src_initial_inventory_status) <= 30 THEN t.src_initial_inventory_status::varchar(30) END AS initial_inventory_status,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_acquisition_id,
        t.src_vehicle_id,
        t.src_dealership_id,
        t.src_acquisition_date,
        t.src_acquisition_source,
        t.src_acquisition_cost,
        t.src_reconditioning_cost,
        t.src_original_asking_price,
        t.src_msrp,
        t.src_initial_inventory_status,
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
            CASE WHEN c.src_acquisition_id IS NOT NULL AND c.acquisition_id IS NULL THEN 'acquisition_id' END,
            CASE WHEN c.src_vehicle_id IS NOT NULL AND c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_acquisition_date IS NOT NULL AND c.acquisition_date IS NULL THEN 'acquisition_date' END,
            CASE WHEN c.src_acquisition_source IS NOT NULL AND c.acquisition_source IS NULL THEN 'acquisition_source' END,
            CASE WHEN c.src_acquisition_cost IS NOT NULL AND c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.src_reconditioning_cost IS NOT NULL AND c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.src_original_asking_price IS NOT NULL AND c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.src_msrp IS NOT NULL AND c.msrp IS NULL THEN 'msrp' END,
            CASE WHEN c.src_initial_inventory_status IS NOT NULL AND c.initial_inventory_status IS NULL THEN 'initial_inventory_status' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.acquisition_id IS NULL THEN 'acquisition_id' END,
            CASE WHEN c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.acquisition_date IS NULL THEN 'acquisition_date' END,
            CASE WHEN c.acquisition_source IS NULL THEN 'acquisition_source' END,
            CASE WHEN c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.initial_inventory_status IS NULL THEN 'initial_inventory_status' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
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
    c.acquisition_id,
    c.vehicle_id,
    c.dealership_id,
    c.acquisition_date,
    c.acquisition_source,
    c.acquisition_cost,
    c.reconditioning_cost,
    c.original_asking_price,
    c.msrp,
    c.initial_inventory_status,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_acquisition_id,
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
        PARTITION BY c.acquisition_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_acquisition_event_typed IS
    'Grain: one row per row of the most recent raw.acquisition_event_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_acquisition_event and 
staging.stg_acquisition_event_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_acquisition_event AS
SELECT DISTINCT ON (v.acquisition_id)
    v.acquisition_id,
    v.vehicle_id,
    v.dealership_id,
    v.acquisition_date,
    v.acquisition_source,
    v.acquisition_cost,
    v.reconditioning_cost,
    v.original_asking_price,
    v.msrp,
    v.initial_inventory_status,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_acquisition_event_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.acquisition_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_acquisition_event IS
    'Grain: one row per acquisition_id, restricted to the most recent raw.acquisition_event_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_acquisition_event_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_acquisition_event.acquisition_id IS 'Natural key, ACQ-######## (contract section 5).';
COMMENT ON COLUMN staging.stg_acquisition_event.vehicle_id IS 'Vehicle acquired. Exactly one acquisition exists per vehicle.';
COMMENT ON COLUMN staging.stg_acquisition_event.dealership_id IS 'Store that acquired the vehicle.';
COMMENT ON COLUMN staging.stg_acquisition_event.acquisition_date IS 'Date the store took the vehicle into stock. May precede reporting.start_date by up to 180 warm-up days.';
COMMENT ON COLUMN staging.stg_acquisition_event.acquisition_source IS 'How the vehicle was acquired.';
COMMENT ON COLUMN staging.stg_acquisition_event.acquisition_cost IS 'What the store paid for the vehicle, exact to the cent.';
COMMENT ON COLUMN staging.stg_acquisition_event.reconditioning_cost IS 'Reconditioning spend before the vehicle went on sale. Materially higher for used than for new.';
COMMENT ON COLUMN staging.stg_acquisition_event.original_asking_price IS 'First advertised asking price.';
COMMENT ON COLUMN staging.stg_acquisition_event.msrp IS 'Manufacturer suggested retail price; NULL when the vehicle has no MSRP.';
COMMENT ON COLUMN staging.stg_acquisition_event.initial_inventory_status IS 'Inventory status the vehicle entered stock with.';
COMMENT ON COLUMN staging.stg_acquisition_event.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_acquisition_event.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_acquisition_event.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_acquisition_event.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_acquisition_event.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_acquisition_event.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_acquisition_event_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'acquisition_event'::text AS source_entity,
    coalesce(v.src_acquisition_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (acquisition_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_acquisition_event_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_acquisition_event_rejected IS
    'Grain: one row per row of the most recent raw.acquisition_event_load batch that staging.stg_acquisition_event did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_acquisition_event_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_acquisition_event_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
