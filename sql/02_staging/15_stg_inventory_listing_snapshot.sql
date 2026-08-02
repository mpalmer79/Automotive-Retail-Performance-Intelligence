-- =============================================================================
-- File:            sql/02_staging/15_stg_inventory_listing_snapshot.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.inventory_listing_snapshot_load batch, plus its rejected-row companion.
-- Execution order: Staging layer, after raw.inventory_listing_snapshot_load and the staging cast helpers, before anything reads staging.stg_inventory_listing_snapshot.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_inventory_listing_snapshot: one accepted row per (dealership_id, captured_at, synthetic_vehicle_id) in the most recent load batch.
-- =============================================================================
--
-- THREE VIEWS, ONE RULE SET -- the same shape every other ARPI entity uses.
--
--   staging.stg_inventory_listing_snapshot_typed     every row of the newest batch
--   staging.stg_inventory_listing_snapshot           the accepted rows only
--   staging.stg_inventory_listing_snapshot_rejected  the dropped rows, with a code
--
-- Every row of the newest batch appears in exactly one of the last two, which is the
-- identity the listing reconciliations depend on (RECON-LISTING-*).
--
-- THE NATURAL KEY IS THE GRAIN
-- ----------------------------
-- (dealership_id, captured_at, synthetic_vehicle_id). One store, one observation
-- date, one observed vehicle. warehouse.fact_vehicle_listing_snapshot enforces the
-- surrogate-key form of the same triple as uq_fact_vehicle_listing_snapshot_grain.
-- One grain, stated once, enforced in both places.
--
-- WHY CLASSIFICATION IS A STAGING RULE AND NOT ONLY A DOCUMENT
-- ------------------------------------------------------------
-- ADR-0011 permits this lane only for data carrying the approved classification. A
-- row whose data_classification is absent, misspelt, or says "synthetic" is refused
-- here under REJ-DOMAIN-001 rather than loaded and explained later. The warehouse
-- can then state, as a property of its own contents, that every listing row it holds
-- was classified before it arrived.
--
-- WHY THE STORE IS RESOLVED AGAINST dim_dealership
-- ------------------------------------------------
-- The workbook's store name is source-supplied and the registry's is authoritative.
-- A disagreement means the workbook was assigned to the wrong store or the registry
-- changed under it, and either way the row must not silently join to whichever store
-- the identifier happens to match. REJ-REF-001 covers both.
--
-- PRICING IS A TWO-COLUMN CONTRACT
-- --------------------------------
--   Listed          => advertised_price must be present.
--   Call for price  => advertised_price must be absent.
-- A row where the two disagree is quarantined, not repaired. Admitting it would let
-- one vehicle count in both halves of a pricing-completeness percentage.
--
-- NEWEST-BATCH RULE: greatest max(ingested_at), ties broken by greatest
-- max(raw_record_id). Identical to every other staging view.

CREATE OR REPLACE VIEW staging.stg_inventory_listing_snapshot_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.inventory_listing_snapshot_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    SELECT
        nullif(btrim(r.source_record_id), '')      AS src_source_record_id,
        nullif(btrim(r.dealership_id), '')         AS src_dealership_id,
        nullif(btrim(r.store_name), '')            AS src_store_name,
        nullif(btrim(r.captured_at), '')           AS src_captured_at,
        nullif(btrim(r.source_batch_id), '')       AS src_source_batch_id,
        nullif(btrim(r.source_feed), '')           AS src_source_feed,
        nullif(btrim(r.condition_type), '')        AS src_condition_type,
        nullif(btrim(r.model_year), '')            AS src_model_year,
        nullif(btrim(r.make), '')                  AS src_make,
        nullif(btrim(r.model), '')                 AS src_model,
        nullif(btrim(r.trim), '')                  AS src_trim,
        nullif(btrim(r.vehicle_display), '')       AS src_vehicle_display,
        nullif(btrim(r.odometer_miles), '')        AS src_odometer_miles,
        nullif(btrim(r.advertised_price), '')      AS src_advertised_price,
        nullif(btrim(r.pricing_status), '')        AS src_pricing_status,
        nullif(btrim(r.synthetic_vehicle_id), '')  AS src_synthetic_vehicle_id,
        nullif(btrim(r.synthetic_vin), '')         AS src_synthetic_vin,
        nullif(btrim(r.inventory_unit_count), '')  AS src_inventory_unit_count,
        nullif(btrim(r.data_classification), '')   AS src_data_classification,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_file_digest,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.inventory_listing_snapshot_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_source_record_id) <= 40 THEN t.src_source_record_id::varchar(40) END AS source_record_id,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_store_name) <= 80 THEN t.src_store_name::varchar(80) END AS store_name,
        staging.fn_try_date(t.src_captured_at) AS captured_at,
        CASE WHEN length(t.src_source_batch_id) <= 40 THEN t.src_source_batch_id::varchar(40) END AS source_batch_id,
        CASE WHEN length(t.src_source_feed) <= 60 THEN t.src_source_feed::varchar(60) END AS source_feed,
        CASE WHEN length(t.src_condition_type) <= 8 THEN t.src_condition_type::varchar(8) END AS condition_type,
        staging.fn_try_integer(t.src_model_year) AS model_year,
        CASE WHEN length(t.src_make) <= 40 THEN t.src_make::varchar(40) END AS make,
        CASE WHEN length(t.src_model) <= 60 THEN t.src_model::varchar(60) END AS model,
        CASE WHEN length(t.src_trim) <= 60 THEN t.src_trim::varchar(60) END AS trim,
        CASE WHEN length(t.src_vehicle_display) <= 160 THEN t.src_vehicle_display::varchar(160) END AS vehicle_display,
        staging.fn_try_integer(t.src_odometer_miles) AS odometer_miles,
        staging.fn_try_money(t.src_advertised_price) AS advertised_price,
        CASE WHEN length(t.src_pricing_status) <= 20 THEN t.src_pricing_status::varchar(20) END AS pricing_status,
        CASE WHEN length(t.src_synthetic_vehicle_id) <= 24 THEN t.src_synthetic_vehicle_id::varchar(24) END AS synthetic_vehicle_id,
        CASE WHEN length(t.src_synthetic_vin) <= 24 THEN t.src_synthetic_vin::varchar(24) END AS synthetic_vin,
        staging.fn_try_smallint(t.src_inventory_unit_count) AS inventory_unit_count,
        CASE WHEN length(t.src_data_classification) <= 40 THEN t.src_data_classification::varchar(40) END AS data_classification,
        t.*
    FROM trimmed AS t
),
flagged AS (
    SELECT
        c.*,
        -- Present in the source but not representable in the governed type.
        array_remove(ARRAY[
            CASE WHEN c.src_source_record_id IS NOT NULL AND c.source_record_id IS NULL THEN 'source_record_id' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_store_name IS NOT NULL AND c.store_name IS NULL THEN 'store_name' END,
            CASE WHEN c.src_captured_at IS NOT NULL AND c.captured_at IS NULL THEN 'captured_at' END,
            CASE WHEN c.src_source_batch_id IS NOT NULL AND c.source_batch_id IS NULL THEN 'source_batch_id' END,
            CASE WHEN c.src_source_feed IS NOT NULL AND c.source_feed IS NULL THEN 'source_feed' END,
            CASE WHEN c.src_condition_type IS NOT NULL AND c.condition_type IS NULL THEN 'condition_type' END,
            CASE WHEN c.src_model_year IS NOT NULL AND c.model_year IS NULL THEN 'model_year' END,
            CASE WHEN c.src_make IS NOT NULL AND c.make IS NULL THEN 'make' END,
            CASE WHEN c.src_model IS NOT NULL AND c.model IS NULL THEN 'model' END,
            CASE WHEN c.src_trim IS NOT NULL AND c.trim IS NULL THEN 'trim' END,
            CASE WHEN c.src_vehicle_display IS NOT NULL AND c.vehicle_display IS NULL THEN 'vehicle_display' END,
            CASE WHEN c.src_odometer_miles IS NOT NULL AND c.odometer_miles IS NULL THEN 'odometer_miles' END,
            CASE WHEN c.src_advertised_price IS NOT NULL AND c.advertised_price IS NULL THEN 'advertised_price' END,
            CASE WHEN c.src_pricing_status IS NOT NULL AND c.pricing_status IS NULL THEN 'pricing_status' END,
            CASE WHEN c.src_synthetic_vehicle_id IS NOT NULL AND c.synthetic_vehicle_id IS NULL THEN 'synthetic_vehicle_id' END,
            CASE WHEN c.src_synthetic_vin IS NOT NULL AND c.synthetic_vin IS NULL THEN 'synthetic_vin' END,
            CASE WHEN c.src_inventory_unit_count IS NOT NULL AND c.inventory_unit_count IS NULL THEN 'inventory_unit_count' END,
            CASE WHEN c.src_data_classification IS NOT NULL AND c.data_classification IS NULL THEN 'data_classification' END
        ], NULL) AS cast_failures,
        -- Required by the contract but absent. trim and advertised_price are
        -- legitimately NULL and are deliberately not listed; the pricing rule below
        -- is what makes a missing price a rejection when the status demands one.
        array_remove(ARRAY[
            CASE WHEN c.source_record_id IS NULL THEN 'source_record_id' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.store_name IS NULL THEN 'store_name' END,
            CASE WHEN c.captured_at IS NULL THEN 'captured_at' END,
            CASE WHEN c.source_batch_id IS NULL THEN 'source_batch_id' END,
            CASE WHEN c.source_feed IS NULL THEN 'source_feed' END,
            CASE WHEN c.condition_type IS NULL THEN 'condition_type' END,
            CASE WHEN c.model_year IS NULL THEN 'model_year' END,
            CASE WHEN c.make IS NULL THEN 'make' END,
            CASE WHEN c.model IS NULL THEN 'model' END,
            CASE WHEN c.vehicle_display IS NULL THEN 'vehicle_display' END,
            CASE WHEN c.odometer_miles IS NULL THEN 'odometer_miles' END,
            CASE WHEN c.pricing_status IS NULL THEN 'pricing_status' END,
            CASE WHEN c.synthetic_vehicle_id IS NULL THEN 'synthetic_vehicle_id' END,
            CASE WHEN c.synthetic_vin IS NULL THEN 'synthetic_vin' END,
            CASE WHEN c.inventory_unit_count IS NULL THEN 'inventory_unit_count' END,
            CASE WHEN c.data_classification IS NULL THEN 'data_classification' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range. Each rule
        -- mirrors a CHECK constraint on warehouse.fact_vehicle_listing_snapshot or a
        -- DQ-LST-* check, so a row that would violate the table is quarantined here
        -- instead of aborting the whole import.
        array_remove(ARRAY[
            CASE WHEN c.condition_type IS NOT NULL AND c.condition_type NOT IN ('New', 'Used') THEN 'condition_type' END,
            CASE WHEN c.pricing_status IS NOT NULL AND c.pricing_status NOT IN ('Listed', 'Call for price') THEN 'pricing_status' END,
            CASE WHEN c.odometer_miles IS NOT NULL AND c.odometer_miles < 0 THEN 'odometer_miles' END,
            CASE WHEN c.model_year IS NOT NULL AND (c.model_year < 1980 OR c.model_year > 2100) THEN 'model_year' END,
            CASE WHEN c.advertised_price IS NOT NULL AND c.advertised_price < 0 THEN 'advertised_price' END,
            CASE WHEN c.inventory_unit_count IS NOT NULL AND c.inventory_unit_count <> 1 THEN 'inventory_unit_count' END,
            -- The classification gate. ADR-0011 admits exactly one value.
            CASE WHEN c.data_classification IS NOT NULL
                  AND c.data_classification <> 'Sanitized public reference data'
                THEN 'data_classification' END,
            -- The two halves of the pricing contract.
            CASE WHEN c.pricing_status = 'Listed' AND c.advertised_price IS NULL THEN 'advertised_price' END,
            CASE WHEN c.pricing_status = 'Call for price' AND c.advertised_price IS NOT NULL THEN 'advertised_price' END,
            -- The synthetic identifiers must be recognisably synthetic. A value that
            -- did not come from the sanitizer has not been through it.
            CASE WHEN c.synthetic_vin IS NOT NULL AND c.synthetic_vin NOT LIKE 'ARPI%' THEN 'synthetic_vin' END,
            CASE WHEN c.synthetic_vehicle_id IS NOT NULL AND c.synthetic_vehicle_id NOT LIKE 'VEH-%' THEN 'synthetic_vehicle_id' END,
            -- No URL may survive into the warehouse, on any column.
            CASE WHEN (
                     coalesce(c.src_vehicle_display, '') || coalesce(c.src_make, '')
                  || coalesce(c.src_model, '') || coalesce(c.src_trim, '')
                  || coalesce(c.src_store_name, '') || coalesce(c.src_source_feed, '')
                 ) ~* '(https?://|ftp://|www\.[a-z0-9-]+\.[a-z]{2,})'
                THEN 'source_feed' END
        ], NULL) AS domain_failures,
        -- The store must exist in the registry AND agree with it. Both directions are
        -- referential failures, and the row is quarantined rather than joined to
        -- whichever version happens to match.
        array_remove(ARRAY[
            CASE WHEN c.dealership_id IS NOT NULL AND NOT EXISTS (
                     SELECT 1 FROM warehouse.dim_dealership AS d
                     WHERE d.dealership_id = c.dealership_id
                 ) THEN 'dealership_id' END,
            -- The store name is compared against the version of the store that was
            -- current ON THE CAPTURE DATE, which is the same version the fact load
            -- resolves. Comparing against today's version instead would reject a
            -- correct historical snapshot the day a store is renamed.
            CASE WHEN c.dealership_id IS NOT NULL AND c.store_name IS NOT NULL
                  AND c.captured_at IS NOT NULL
                  AND EXISTS (SELECT 1 FROM warehouse.dim_dealership AS d
                              WHERE d.dealership_id = c.dealership_id)
                  AND NOT EXISTS (
                     SELECT 1 FROM warehouse.dim_dealership AS d
                     WHERE d.dealership_id = c.dealership_id
                       AND d.store_name = c.store_name
                       AND c.captured_at BETWEEN d.effective_date AND d.expiration_date
                 ) THEN 'store_name' END
        ], NULL) AS referential_failures
    FROM cast_attempt AS c
),
classified AS (
    SELECT
        f.*,
        CASE
            WHEN cardinality(f.cast_failures) > 0        THEN 'REJ-TYPE-001'
            WHEN cardinality(f.missing_required) > 0     THEN 'REJ-NULL-001'
            WHEN cardinality(f.domain_failures) > 0      THEN 'REJ-DOMAIN-001'
            WHEN cardinality(f.referential_failures) > 0 THEN 'REJ-REF-001'
        END AS rejection_code,
        CASE
            WHEN cardinality(f.cast_failures) > 0        THEN 'structural'
            WHEN cardinality(f.missing_required) > 0     THEN 'completeness'
            WHEN cardinality(f.domain_failures) > 0      THEN 'business_rule'
            WHEN cardinality(f.referential_failures) > 0 THEN 'referential'
        END AS rejection_category,
        CASE
            WHEN cardinality(f.cast_failures) > 0
                THEN 'value present but not representable in the governed type: '
                     || array_to_string(f.cast_failures, ', ')
            WHEN cardinality(f.missing_required) > 0
                THEN 'required value absent: ' || array_to_string(f.missing_required, ', ')
            WHEN cardinality(f.domain_failures) > 0
                THEN 'value outside its governed domain, range or pricing contract: '
                     || array_to_string(f.domain_failures, ', ')
            WHEN cardinality(f.referential_failures) > 0
                THEN 'value does not resolve against the dealership registry: '
                     || array_to_string(f.referential_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.source_record_id,
    c.dealership_id,
    c.store_name,
    c.captured_at,
    c.source_batch_id,
    c.source_feed,
    c.condition_type,
    c.model_year,
    c.make,
    c.model,
    c.trim,
    c.vehicle_display,
    c.odometer_miles,
    c.advertised_price,
    c.pricing_status,
    c.synthetic_vehicle_id,
    c.synthetic_vin,
    c.inventory_unit_count,
    c.data_classification,
    -- Untyped natural-key text, kept so a rejected row can still be identified even
    -- when the cast that would have typed it is what failed.
    c.src_dealership_id,
    c.src_captured_at,
    c.src_synthetic_vehicle_id,
    c.raw_record_id,
    c.load_batch_id,
    c.source_file_name,
    c.source_file_digest,
    c.source_row_number,
    c.ingested_at,
    c.record_payload,
    c.rejection_code,
    c.rejection_category,
    c.rejection_reason,
    row_number() OVER (
        PARTITION BY c.dealership_id, c.captured_at, c.synthetic_vehicle_id,
                     (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_inventory_listing_snapshot_typed IS
    'Grain: one row per row of the most recent raw.inventory_listing_snapshot_load batch. Internal: every
business column is cast with a non-throwing expression and the row is classified as accepted
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_inventory_listing_snapshot and
staging.stg_inventory_listing_snapshot_rejected are the two halves of this view and together reproduce it
exactly.';

CREATE OR REPLACE VIEW staging.stg_inventory_listing_snapshot AS
SELECT DISTINCT ON (v.dealership_id, v.captured_at, v.synthetic_vehicle_id)
    v.source_record_id,
    v.dealership_id,
    v.store_name,
    v.captured_at,
    v.source_batch_id,
    v.source_feed,
    v.condition_type,
    v.model_year,
    v.make,
    v.model,
    v.trim,
    v.vehicle_display,
    v.odometer_miles,
    v.advertised_price,
    v.pricing_status,
    v.synthetic_vehicle_id,
    v.synthetic_vin,
    v.inventory_unit_count,
    v.data_classification,
    v.load_batch_id,
    v.source_file_name,
    v.source_file_digest,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_inventory_listing_snapshot_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.dealership_id, v.captured_at, v.synthetic_vehicle_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_inventory_listing_snapshot IS
    'Grain: one row per (dealership_id, captured_at, synthetic_vehicle_id), restricted to the most recent
raw.inventory_listing_snapshot_load batch and to rows that satisfy every type, completeness, domain,
classification, pricing and referential rule. Duplicates are resolved by keeping the highest raw_record_id;
the losers are reported by staging.stg_inventory_listing_snapshot_rejected under REJ-KEY-001. This view is
the only input warehouse.dim_observed_vehicle and warehouse.fact_vehicle_listing_snapshot read.';

COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_record_id IS 'Deterministic per-row identifier assigned by the sanitizer; lineage back to the workbook row.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.dealership_id IS 'Store the listing was assigned to; part of the declared grain. Resolved to dealership_key by the fact load.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.store_name IS 'Store name, already checked to agree with warehouse.dim_dealership.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.captured_at IS 'Observation date of the listing snapshot; part of the declared grain. This is when the listing was SEEN, not when a vehicle arrived or left.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_batch_id IS 'Capture-batch identifier; one workbook is one batch.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_feed IS 'Neutral feed label that replaced the row-level source URL.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.condition_type IS 'New or Used, as advertised.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.model_year IS 'Model year, as advertised.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.make IS 'Make, as advertised.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.model IS 'Model, as advertised.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.trim IS 'Trim, as advertised. Legitimately NULL.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.vehicle_display IS 'Year/make/model/trim as one advertised string.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.odometer_miles IS 'Advertised odometer reading. Not a verified reading and not a title record.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.advertised_price IS 'ADVERTISED price. Not transaction price, acquisition cost, inventory investment, MSRP or gross. NULL when the listing says call for price.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.pricing_status IS 'Listed or Call for price. Governs whether advertised_price may be present.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.synthetic_vehicle_id IS 'Group-stable ARPI vehicle identity; part of the declared grain. Resolved to observed_vehicle_key by the fact load.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.synthetic_vin IS 'ARPI-prefixed synthetic VIN. Can never be a real VIN.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.inventory_unit_count IS 'Always 1. SEMI-ADDITIVE: sum across vehicles on one capture date; never across capture dates.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.data_classification IS 'Sanitized public reference data. Any other value was rejected upstream.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_file_name IS 'Lineage: the committed workbook file name, exactly as it appears in the repository.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_file_digest IS 'Lineage: SHA-256 of the workbook bytes.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.source_row_number IS 'Lineage: one-based data-row number on the Inventory sheet.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_inventory_listing_snapshot_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'inventory_listing_snapshot'::text AS source_entity,
    coalesce(v.src_dealership_id, '?')
        || '|' || coalesce(v.src_captured_at, '?')
        || '|' || coalesce(v.src_synthetic_vehicle_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (dealership_id, captured_at, synthetic_vehicle_id) within the load '
        || 'batch; the row with the highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_inventory_listing_snapshot_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_inventory_listing_snapshot_rejected IS
    'Grain: one row per row of the most recent raw.inventory_listing_snapshot_load batch that
staging.stg_inventory_listing_snapshot did NOT accept. Carries the REJ-* code, its canonical validation
category and the untyped source payload, which src/arpi/ingestion/rejection.py redacts before writing to
audit.rejected_record. Rejected rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.source_file_name IS 'Lineage: the committed workbook file name.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.source_row_number IS 'Lineage: one-based data-row number on the Inventory sheet; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.source_record_key IS 'Best-effort natural key of the rejected row -- the three grain columns joined by a pipe -- from the untyped source text.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.rejection_category IS 'Canonical validation category (ADR-0004) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns. Never quotes a source value.';
COMMENT ON COLUMN staging.stg_inventory_listing_snapshot_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
