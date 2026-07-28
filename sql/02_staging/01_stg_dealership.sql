-- =============================================================================
-- File:            sql/02_staging/01_stg_dealership.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, deduplicated view over the newest raw.dealership_load batch, shaped for the SCD Type 2 merge.
-- Execution order: 7 of 25 — after raw.dealership_load exists, before the dim_dealership merge reads it.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per dealership_id in the most recent load batch (the newest version supplied by that batch).
-- =============================================================================
--
-- Newest-batch rule: identical to staging.stg_calendar_date — greatest
-- max(ingested_at), ties broken by greatest max(raw_record_id).
--
-- Deduplication: DISTINCT ON (dealership_id) keeping the greatest effective_date
-- and then the highest raw_record_id. A source file therefore contributes at most
-- one candidate version per store per run, which is what the Type 2 merge expects.
--
-- Deliberate rename: the source column `dealership_key` is exposed here as
-- `source_dealership_key`. The warehouse surrogate key is assigned by
-- sql/03_dimensions/11_dim_dealership_merge.sql and must never be taken from the
-- source, because a Type 2 change produces a new surrogate key that the source
-- knows nothing about. Keeping both names distinct makes that impossible to
-- confuse and keeps the merge's column references unambiguous.

CREATE OR REPLACE VIEW staging.stg_dealership AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.dealership_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
typed AS (
    SELECT
        nullif(btrim(r.dealership_key), '')::integer     AS source_dealership_key,
        nullif(btrim(r.dealership_id), '')::varchar(16)  AS dealership_id,
        nullif(btrim(r.store_name), '')::varchar(120)    AS store_name,
        nullif(btrim(r.store_short_name), '')::varchar(40) AS store_short_name,
        nullif(btrim(r.store_type), '')::varchar(40)     AS store_type,
        nullif(btrim(r.franchise_brand), '')::varchar(40) AS franchise_brand,
        nullif(btrim(r.city), '')::varchar(60)           AS city,
        upper(nullif(btrim(r.state_code), ''))::char(2)  AS state_code,
        nullif(btrim(r.market_region), '')::varchar(60)  AS market_region,
        nullif(btrim(r.opened_date), '')::date           AS opened_date,
        nullif(btrim(r.is_active), '')::boolean          AS is_active,
        nullif(btrim(r.effective_date), '')::date        AS effective_date,
        nullif(btrim(r.expiration_date), '')::date       AS expiration_date,
        nullif(btrim(r.is_current), '')::boolean         AS is_current,
        lower(nullif(btrim(r.attribute_hash), ''))::char(64) AS attribute_hash,
        nullif(btrim(r.source_system), '')::varchar(40)  AS source_system,
        r.load_batch_id                                  AS load_batch_id,
        r.source_file_name                               AS source_file_name,
        r.source_row_number                              AS source_row_number,
        r.raw_record_id                                  AS raw_record_id,
        r.ingested_at                                    AS ingested_at
    FROM raw.dealership_load AS r
    JOIN latest_batch AS b
      ON b.load_batch_id = r.load_batch_id
)
SELECT DISTINCT ON (t.dealership_id)
    t.source_dealership_key,
    t.dealership_id,
    t.store_name,
    t.store_short_name,
    t.store_type,
    t.franchise_brand,
    t.city,
    t.state_code,
    t.market_region,
    t.opened_date,
    t.is_active,
    t.effective_date,
    t.expiration_date,
    t.is_current,
    t.attribute_hash,
    t.source_system,
    t.load_batch_id,
    t.source_file_name,
    t.source_row_number,
    t.raw_record_id,
    t.ingested_at
FROM typed AS t
ORDER BY t.dealership_id, t.effective_date DESC, t.raw_record_id DESC;

COMMENT ON VIEW staging.stg_dealership IS
    'Grain: one row per dealership_id, restricted to the most recent raw.dealership_load batch '
    '(greatest max(ingested_at), tie-broken by greatest max(raw_record_id)) and deduplicated by keeping '
    'the greatest effective_date then the highest raw_record_id. Feeds the SCD Type 2 merge in '
    'sql/03_dimensions/11_dim_dealership_merge.sql. state_code is upper-cased and attribute_hash is '
    'lower-cased so that comparisons against the warehouse are case-stable.';

COMMENT ON COLUMN staging.stg_dealership.source_dealership_key IS 'Lineage only. The generator-assigned key. The warehouse surrogate key is assigned by the merge and is intentionally not taken from here.';
COMMENT ON COLUMN staging.stg_dealership.dealership_id IS 'Natural key, for example GSA-001; the grain of this view.';
COMMENT ON COLUMN staging.stg_dealership.store_name IS 'Full store name (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.store_short_name IS 'Short store name used on dashboards (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.store_type IS 'Franchise New and Used | Independent Used (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.franchise_brand IS 'Franchise brand; NULL for independent used stores (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.city IS 'Store city (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.state_code IS 'Two-letter state code, upper-cased (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.market_region IS 'Market region (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.opened_date IS 'Date the store opened (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.is_active IS 'Whether the store is currently trading (Type 2 tracked attribute).';
COMMENT ON COLUMN staging.stg_dealership.effective_date IS 'Proposed version start date. The merge uses max(this, current version effective_date + 1) so versions never collide.';
COMMENT ON COLUMN staging.stg_dealership.expiration_date IS 'Source expiration date. Informational: the merge always writes the 9999-12-31 sentinel for the new current row.';
COMMENT ON COLUMN staging.stg_dealership.is_current IS 'Source current flag. Informational: the merge always writes true for the new current row.';
COMMENT ON COLUMN staging.stg_dealership.attribute_hash IS '64-character lower-case SHA-256 hex digest of the Type 2 tracked attributes; the merge change-detection key.';
COMMENT ON COLUMN staging.stg_dealership.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 0.';
COMMENT ON COLUMN staging.stg_dealership.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_dealership.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_dealership.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_dealership.raw_record_id IS 'Lineage: raw.dealership_load surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_dealership.ingested_at IS 'Lineage: UTC instant the raw row was landed.';
