-- =============================================================================
-- File:            sql/03_dimensions/11_dim_dealership_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent SCD Type 2 merge of staging.stg_dealership into warehouse.dim_dealership.
-- Execution order: 11 of 25 in the init sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with an unchanged attribute_hash writes zero rows. Statement 1 expires nothing and statement 2 inserts nothing. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per dealership store version (warehouse.dim_dealership grain).
-- =============================================================================
--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file
-- name and executes each file's whole text through psycopg's cursor.execute().
-- Plain SQL only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the
-- transaction), statements separated by semicolons. The two statements below must
-- run in order and in the same transaction; statement 2 depends on statement 1
-- having already expired the superseded row.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- -----------------------------------------------------------
-- dealership_key is assigned as
--     (SELECT coalesce(max(dealership_key), 0) FROM warehouse.dim_dealership)
--     + row_number() OVER (ORDER BY dealership_id, new_effective_date)
-- rather than from a sequence. Reasons:
--   * On a first load into an empty dimension this yields 1, 2, 3 in
--     dealership_id order, which matches the cross-agent contract section 6
--     table exactly (GSA-001 -> 1, GSA-002 -> 2, GSA-003 -> 3). A sequence would
--     produce the same numbers only by luck and would drift after any rolled-back
--     load, because sequences are non-transactional.
--   * The assignment is a pure function of the current dimension contents plus
--     the sorted input, so rebuilding a database from the same CSVs reproduces
--     identical keys. That is what makes the committed sample data and the
--     integration tests comparable across machines.
--   * Keys are never reused: the offset is always the current maximum.
-- The generator-supplied key is deliberately ignored (staging exposes it as
-- source_dealership_key, lineage only) because a Type 2 change creates a version
-- the source has no key for.
--
-- NEW VERSION EFFECTIVE DATE
-- --------------------------
-- new_effective_date = GREATEST(staging.effective_date, current.effective_date + 1)
-- In Phase 0 effective_date equals opened_date, which never moves, so a pure
-- attribute change would otherwise propose an effective_date equal to the one
-- already in use. That would violate uq_dim_dealership_id_effective_date and
-- would force expiration_date = effective_date - 1, violating
-- ck_dim_dealership_expiration_not_before_effective. Taking the greater of the
-- proposed date and "one day after the version being replaced" keeps versions
-- strictly ordered, keeps the timeline gap-free, and stays deterministic. When a
-- source genuinely supplies a later effective_date, that date is used unchanged.
--
-- CRASH SAFETY
-- ------------
-- If the transaction fails between the two statements everything rolls back. If a
-- store somehow ends up with no current row, the next run repairs it: statement 2
-- treats "latest version is not current and its hash differs from staging" as the
-- signal to insert the successor.

-- -----------------------------------------------------------------------------
-- Statement 1 of 2 — expire the current version of every store whose tracked
-- attributes changed. Stores whose hash matches are not touched, which is what
-- makes a rerun a no-op.
-- -----------------------------------------------------------------------------
UPDATE warehouse.dim_dealership AS d
SET expiration_date = GREATEST(s.effective_date, d.effective_date + 1) - 1,
    is_current      = false
FROM staging.stg_dealership AS s
WHERE s.dealership_id = d.dealership_id
  AND d.is_current
  AND d.attribute_hash <> s.attribute_hash;

-- -----------------------------------------------------------------------------
-- Statement 2 of 2 — insert brand-new stores and the successor versions of the
-- stores just expired by statement 1.
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        s.dealership_id,
        s.store_name,
        s.store_short_name,
        s.store_type,
        s.franchise_brand,
        s.city,
        s.state_code,
        s.market_region,
        s.opened_date,
        s.is_active,
        s.effective_date,
        s.attribute_hash,
        s.source_system
    FROM staging.stg_dealership AS s
),
latest_version AS (
    -- The most recent version of each store already in the dimension, whether or
    -- not it is current. DISTINCT ON makes the pick deterministic.
    SELECT DISTINCT ON (d.dealership_id)
        d.dealership_id,
        d.effective_date,
        d.expiration_date,
        d.is_current,
        d.attribute_hash
    FROM warehouse.dim_dealership AS d
    ORDER BY d.dealership_id, d.effective_date DESC, d.dealership_key DESC
),
brand_new AS (
    -- Stores that have never been loaded before.
    SELECT
        src.*,
        src.effective_date AS new_effective_date
    FROM src
    WHERE NOT EXISTS (
        SELECT 1
        FROM latest_version AS lv
        WHERE lv.dealership_id = src.dealership_id
    )
),
changed AS (
    -- Stores whose current version was expired by statement 1. The successor
    -- starts the day after the row that was just closed, so the timeline has no
    -- gap.
    SELECT
        src.*,
        (lv.expiration_date + 1) AS new_effective_date
    FROM src
    JOIN latest_version AS lv
      ON lv.dealership_id = src.dealership_id
    WHERE lv.is_current = false
      AND lv.attribute_hash <> src.attribute_hash
),
pending AS (
    SELECT * FROM brand_new
    UNION ALL
    SELECT * FROM changed
),
keyed AS (
    SELECT
        (SELECT coalesce(max(x.dealership_key), 0) FROM warehouse.dim_dealership AS x)
            + row_number() OVER (ORDER BY p.dealership_id, p.new_effective_date) AS dealership_key,
        p.dealership_id,
        p.store_name,
        p.store_short_name,
        p.store_type,
        p.franchise_brand,
        p.city,
        p.state_code,
        p.market_region,
        p.opened_date,
        p.is_active,
        p.new_effective_date,
        p.attribute_hash,
        p.source_system
    FROM pending AS p
)
INSERT INTO warehouse.dim_dealership (
    dealership_key,
    dealership_id,
    store_name,
    store_short_name,
    store_type,
    franchise_brand,
    city,
    state_code,
    market_region,
    opened_date,
    is_active,
    effective_date,
    expiration_date,
    is_current,
    attribute_hash,
    source_system
)
SELECT
    k.dealership_key,
    k.dealership_id,
    k.store_name,
    k.store_short_name,
    k.store_type,
    k.franchise_brand,
    k.city,
    k.state_code,
    k.market_region,
    k.opened_date,
    k.is_active,
    k.new_effective_date,
    DATE '9999-12-31',
    true,
    k.attribute_hash,
    k.source_system
FROM keyed AS k;
