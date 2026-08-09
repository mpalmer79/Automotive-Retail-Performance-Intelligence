-- =============================================================================
-- File:            sql/02_staging/14_stg_inventory_snapshot.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.inventory_snapshot_load batch, plus its rejected-row companion.
-- Execution order: 32 of 73 — after raw.inventory_snapshot_load and the staging cast helpers, before anything reads staging.stg_inventory_snapshot.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_inventory_snapshot: one accepted row per (snapshot_date, dealership_id, vehicle_id) in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_inventory_snapshot_typed     every row of the newest batch, cast and classified
--   staging.stg_inventory_snapshot           the accepted rows only (what the warehouse loads)
--   staging.stg_inventory_snapshot_rejected  the dropped rows, with a REJ-* code and a payload
--
-- The three are derived from one another, so the accepted set and the rejected set
-- cannot drift apart: every row of the newest batch appears in exactly one of them.
-- That is the identity the ingestion row-count chain reconciliation depends on
-- (RECON-INGEST-*-CHAIN in src/arpi/ingestion/loader.py).
--
-- THE NATURAL KEY IS THE GRAIN
-- ----------------------------
-- Unlike every other entity in ARPI, the inventory snapshot has no single-column
-- identifier: contract section 5 allocates none, because the fact's identity IS
-- (snapshot date, store, vehicle). Deduplication therefore partitions on all three
-- columns, and warehouse.fact_vehicle_inventory_snapshot enforces the same triple
-- as uq_fact_vehicle_inventory_snapshot_grain. One grain, stated once, enforced in
-- both places.
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
-- Identical to every other staging view: greatest max(ingested_at), ties broken by
-- greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_inventory_snapshot_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.inventory_snapshot_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.snapshot_date), '')                                     AS src_snapshot_date,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.vehicle_id), '')                                        AS src_vehicle_id,
        nullif(btrim(r.vehicle_model_id), '')                                  AS src_vehicle_model_id,
        nullif(btrim(r.current_asking_price), '')                              AS src_current_asking_price,
        nullif(btrim(r.original_asking_price), '')                             AS src_original_asking_price,
        nullif(btrim(r.msrp), '')                                              AS src_msrp,
        nullif(btrim(r.acquisition_cost), '')                                  AS src_acquisition_cost,
        nullif(btrim(r.reconditioning_cost), '')                               AS src_reconditioning_cost,
        nullif(btrim(r.inventory_investment), '')                              AS src_inventory_investment,
        nullif(btrim(r.market_price_estimate), '')                             AS src_market_price_estimate,
        nullif(btrim(r.days_in_stock), '')                                     AS src_days_in_stock,
        nullif(btrim(r.age_bucket), '')                                        AS src_age_bucket,
        nullif(btrim(r.markdown_count_to_date), '')                            AS src_markdown_count_to_date,
        nullif(btrim(r.inventory_unit_count), '')                              AS src_inventory_unit_count,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.inventory_snapshot_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_date(t.src_snapshot_date) AS snapshot_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_vehicle_id) <= 16 THEN t.src_vehicle_id::varchar(16) END AS vehicle_id,
        CASE WHEN length(t.src_vehicle_model_id) <= 16 THEN t.src_vehicle_model_id::varchar(16) END AS vehicle_model_id,
        staging.fn_try_money(t.src_current_asking_price) AS current_asking_price,
        staging.fn_try_money(t.src_original_asking_price) AS original_asking_price,
        staging.fn_try_money(t.src_msrp) AS msrp,
        staging.fn_try_money(t.src_acquisition_cost) AS acquisition_cost,
        staging.fn_try_money(t.src_reconditioning_cost) AS reconditioning_cost,
        staging.fn_try_money(t.src_inventory_investment) AS inventory_investment,
        staging.fn_try_money(t.src_market_price_estimate) AS market_price_estimate,
        staging.fn_try_integer(t.src_days_in_stock) AS days_in_stock,
        CASE WHEN length(t.src_age_bucket) <= 16 THEN t.src_age_bucket::varchar(16) END AS age_bucket,
        staging.fn_try_smallint(t.src_markdown_count_to_date) AS markdown_count_to_date,
        staging.fn_try_smallint(t.src_inventory_unit_count) AS inventory_unit_count,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_snapshot_date,
        t.src_dealership_id,
        t.src_vehicle_id,
        t.src_vehicle_model_id,
        t.src_current_asking_price,
        t.src_original_asking_price,
        t.src_msrp,
        t.src_acquisition_cost,
        t.src_reconditioning_cost,
        t.src_inventory_investment,
        t.src_market_price_estimate,
        t.src_days_in_stock,
        t.src_age_bucket,
        t.src_markdown_count_to_date,
        t.src_inventory_unit_count,
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
            CASE WHEN c.src_snapshot_date IS NOT NULL AND c.snapshot_date IS NULL THEN 'snapshot_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_vehicle_id IS NOT NULL AND c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.src_vehicle_model_id IS NOT NULL AND c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.src_current_asking_price IS NOT NULL AND c.current_asking_price IS NULL THEN 'current_asking_price' END,
            CASE WHEN c.src_original_asking_price IS NOT NULL AND c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.src_msrp IS NOT NULL AND c.msrp IS NULL THEN 'msrp' END,
            CASE WHEN c.src_acquisition_cost IS NOT NULL AND c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.src_reconditioning_cost IS NOT NULL AND c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.src_inventory_investment IS NOT NULL AND c.inventory_investment IS NULL THEN 'inventory_investment' END,
            CASE WHEN c.src_market_price_estimate IS NOT NULL AND c.market_price_estimate IS NULL THEN 'market_price_estimate' END,
            CASE WHEN c.src_days_in_stock IS NOT NULL AND c.days_in_stock IS NULL THEN 'days_in_stock' END,
            CASE WHEN c.src_age_bucket IS NOT NULL AND c.age_bucket IS NULL THEN 'age_bucket' END,
            CASE WHEN c.src_markdown_count_to_date IS NOT NULL AND c.markdown_count_to_date IS NULL THEN 'markdown_count_to_date' END,
            CASE WHEN c.src_inventory_unit_count IS NOT NULL AND c.inventory_unit_count IS NULL THEN 'inventory_unit_count' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. msrp is legitimately NULL for a
        -- used unit and is deliberately not listed.
        array_remove(ARRAY[
            CASE WHEN c.snapshot_date IS NULL THEN 'snapshot_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.current_asking_price IS NULL THEN 'current_asking_price' END,
            CASE WHEN c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.inventory_investment IS NULL THEN 'inventory_investment' END,
            CASE WHEN c.days_in_stock IS NULL THEN 'days_in_stock' END,
            CASE WHEN c.age_bucket IS NULL THEN 'age_bucket' END,
            CASE WHEN c.markdown_count_to_date IS NULL THEN 'markdown_count_to_date' END,
            CASE WHEN c.inventory_unit_count IS NULL THEN 'inventory_unit_count' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range. Each rule below
        -- mirrors a CHECK constraint on warehouse.fact_vehicle_inventory_snapshot, so a
        -- row that would violate the table is quarantined here instead of aborting the
        -- whole load.
        array_remove(ARRAY[
            CASE WHEN c.days_in_stock IS NOT NULL AND c.days_in_stock < 0 THEN 'days_in_stock' END,
            CASE WHEN c.markdown_count_to_date IS NOT NULL AND c.markdown_count_to_date < 0 THEN 'markdown_count_to_date' END,
            CASE WHEN c.inventory_unit_count IS NOT NULL AND c.inventory_unit_count <> 1 THEN 'inventory_unit_count' END,
            CASE WHEN c.age_bucket IS NOT NULL AND c.age_bucket NOT IN ('0-30', '31-60', '61-90', '91-120', 'Over 120') THEN 'age_bucket' END,
            CASE WHEN c.current_asking_price IS NOT NULL AND c.current_asking_price < 0 THEN 'current_asking_price' END,
            CASE WHEN c.original_asking_price IS NOT NULL AND c.original_asking_price < 0 THEN 'original_asking_price' END,
            CASE WHEN c.acquisition_cost IS NOT NULL AND c.acquisition_cost < 0 THEN 'acquisition_cost' END,
            CASE WHEN c.reconditioning_cost IS NOT NULL AND c.reconditioning_cost < 0 THEN 'reconditioning_cost' END,
            -- Strictly positive, not merely non-negative. This column exists to be the
            -- denominator of price_to_market_ratio, and a zero estimate is not a cheap
            -- unit -- it is a division the reporting layer cannot perform. Quarantining it
            -- here is what lets the ratio be NULL-because-absent rather than NULL-because-
            -- something-downstream-caught-a-division.
            CASE WHEN c.market_price_estimate IS NOT NULL AND c.market_price_estimate <= 0 THEN 'market_price_estimate' END,
            CASE WHEN c.inventory_investment IS NOT NULL
                  AND c.acquisition_cost IS NOT NULL
                  AND c.reconditioning_cost IS NOT NULL
                  AND c.inventory_investment <> c.acquisition_cost + c.reconditioning_cost
                THEN 'inventory_investment' END
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
    c.snapshot_date,
    c.dealership_id,
    c.vehicle_id,
    c.vehicle_model_id,
    c.current_asking_price,
    c.original_asking_price,
    c.msrp,
    c.acquisition_cost,
    c.reconditioning_cost,
    c.inventory_investment,
    c.market_price_estimate,
    c.days_in_stock,
    c.age_bucket,
    c.markdown_count_to_date,
    c.inventory_unit_count,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_snapshot_date,
    c.src_dealership_id,
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
        PARTITION BY c.snapshot_date, c.dealership_id, c.vehicle_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_inventory_snapshot_typed IS
    'Grain: one row per row of the most recent raw.inventory_snapshot_load batch. Internal: every business
column is cast with a non-throwing expression and the row is classified as accepted
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_inventory_snapshot and
staging.stg_inventory_snapshot_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_inventory_snapshot AS
SELECT DISTINCT ON (v.snapshot_date, v.dealership_id, v.vehicle_id)
    v.snapshot_date,
    v.dealership_id,
    v.vehicle_id,
    v.vehicle_model_id,
    v.current_asking_price,
    v.original_asking_price,
    v.msrp,
    v.acquisition_cost,
    v.reconditioning_cost,
    v.inventory_investment,
    v.market_price_estimate,
    v.days_in_stock,
    v.age_bucket,
    v.markdown_count_to_date,
    v.inventory_unit_count,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_inventory_snapshot_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.snapshot_date, v.dealership_id, v.vehicle_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_inventory_snapshot IS
    'Grain: one row per (snapshot_date, dealership_id, vehicle_id), restricted to the most recent
raw.inventory_snapshot_load batch and to rows that satisfy every type, completeness and domain rule.
Duplicates are resolved by keeping the highest raw_record_id; the losers are reported by
staging.stg_inventory_snapshot_rejected under REJ-KEY-001. This view is the only input the
warehouse.fact_vehicle_inventory_snapshot load reads.';

COMMENT ON COLUMN staging.stg_inventory_snapshot.snapshot_date IS 'As-of date of the snapshot; part of the declared grain. Resolved to snapshot_date_key against warehouse.dim_date by the fact load.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.dealership_id IS 'Store holding the unit; part of the declared grain.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.vehicle_id IS 'The unit in stock; part of the declared grain.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.vehicle_model_id IS 'Model of the unit, denormalised so a model-level aging report needs no second join.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.current_asking_price IS 'Advertised price on the snapshot date, after age-driven markdowns. Semi-additive: never sum across dates.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.original_asking_price IS 'First advertised price.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.msrp IS 'Manufacturer suggested retail price. NULL means the unit has no sticker, typically a used unit.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.acquisition_cost IS 'What the store paid for the unit.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.reconditioning_cost IS 'Reconditioning spend booked against the unit.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.inventory_investment IS 'acquisition_cost + reconditioning_cost, checked exactly here and enforced again by the warehouse CHECK constraint.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.market_price_estimate IS 'SYNTHETIC market price reference for the unit, constant across its snapshots. NULL where the estimator declined to price the unit. Strictly positive when present, because it is the denominator of price_to_market_ratio. NOT a market valuation, not sourced from any guidebook, auction or licensed benchmark, and never to be presented as one.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.days_in_stock IS 'Days since acquisition, measured from the acquisition date and not from the first snapshot date.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.age_bucket IS 'Banded days_in_stock: 0-30 | 31-60 | 61-90 | 91-120 | Over 120.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.markdown_count_to_date IS 'Price reductions taken to date; never decreases for a unit.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.inventory_unit_count IS 'Always 1.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_inventory_snapshot.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_inventory_snapshot_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'inventory_snapshot'::text AS source_entity,
    coalesce(v.src_snapshot_date, '?')
        || '|' || coalesce(v.src_dealership_id, '?')
        || '|' || coalesce(v.src_vehicle_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (snapshot_date, dealership_id, vehicle_id) within the load batch; '
        || 'the row with the highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_inventory_snapshot_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_inventory_snapshot_rejected IS
    'Grain: one row per row of the most recent raw.inventory_snapshot_load batch that
staging.stg_inventory_snapshot did NOT accept. Carries the REJ-* code, its canonical validation
category and the untyped source payload, which src/arpi/ingestion/rejection.py redacts before writing
to audit.rejected_record. Rejected rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.source_record_key IS 'Best-effort natural key of the rejected row -- the three grain columns joined by a pipe -- from the untyped source text.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_inventory_snapshot_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
