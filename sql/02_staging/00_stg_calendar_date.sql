-- =============================================================================
-- File:            sql/02_staging/00_stg_calendar_date.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, deduplicated view over the newest raw.calendar_date_load batch, shaped exactly like warehouse.dim_date.
-- Execution order: 6 of 25 — after raw.calendar_date_load exists, before the dim_date merge reads it.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per date_key in the most recent load batch.
-- =============================================================================
--
-- Newest-batch rule (deterministic, per the cross-agent contract section 10):
--   the batch with the greatest max(ingested_at), ties broken by the greatest
--   max(raw_record_id). Two batches landed inside the same clock tick therefore
--   still resolve to exactly one winner, and the winner never changes between
--   runs unless new data arrives.
--
-- Casting rules:
--   * btrim() then nullif('') so a blank CSV cell becomes NULL rather than a cast error.
--   * Text -> the exact warehouse type from contract section 7 (smallint stays smallint).
--   * Booleans accept the lower-case true/false emitted by the generator.
--
-- Deduplication: DISTINCT ON (date_key) keeping the highest raw_record_id, so a
-- file that repeats a date within one batch resolves to its last occurrence. This
-- guarantees the downstream ON CONFLICT merge can never try to touch the same
-- target row twice in one statement.
--
-- This view intentionally does NOT reject malformed rows. A value that cannot be
-- cast raises an error when the view is read, which the loader surfaces as a
-- failed run; structural rejection is the Python layer's responsibility and is
-- recorded in audit.rejected_record.

CREATE OR REPLACE VIEW staging.stg_calendar_date AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.calendar_date_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
typed AS (
    SELECT
        nullif(btrim(r.date_key), '')::integer            AS date_key,
        nullif(btrim(r.full_date), '')::date              AS full_date,
        nullif(btrim(r.day_of_month), '')::smallint       AS day_of_month,
        nullif(btrim(r.day_name), '')::varchar(9)         AS day_name,
        nullif(btrim(r.day_of_week), '')::smallint        AS day_of_week,
        nullif(btrim(r.day_of_year), '')::smallint        AS day_of_year,
        nullif(btrim(r.week_of_year), '')::smallint       AS week_of_year,
        nullif(btrim(r.iso_year), '')::smallint           AS iso_year,
        nullif(btrim(r.month_number), '')::smallint       AS month_number,
        nullif(btrim(r.month_name), '')::varchar(9)       AS month_name,
        nullif(btrim(r.month_start_date), '')::date       AS month_start_date,
        nullif(btrim(r.month_end_date), '')::date         AS month_end_date,
        nullif(btrim(r.quarter_number), '')::smallint     AS quarter_number,
        nullif(btrim(r.quarter_name), '')::varchar(2)     AS quarter_name,
        nullif(btrim(r.calendar_year), '')::smallint      AS calendar_year,
        nullif(btrim(r.fiscal_month), '')::smallint       AS fiscal_month,
        nullif(btrim(r.fiscal_quarter), '')::smallint     AS fiscal_quarter,
        nullif(btrim(r.fiscal_year), '')::smallint        AS fiscal_year,
        nullif(btrim(r.is_weekend), '')::boolean          AS is_weekend,
        nullif(btrim(r.is_month_end), '')::boolean        AS is_month_end,
        nullif(btrim(r.is_quarter_end), '')::boolean      AS is_quarter_end,
        nullif(btrim(r.is_year_end), '')::boolean         AS is_year_end,
        nullif(btrim(r.is_holiday), '')::boolean          AS is_holiday,
        nullif(btrim(r.holiday_name), '')::varchar(64)    AS holiday_name,
        nullif(btrim(r.is_closure_holiday), '')::boolean  AS is_closure_holiday,
        nullif(btrim(r.is_selling_day), '')::boolean      AS is_selling_day,
        r.load_batch_id                                   AS load_batch_id,
        r.source_file_name                                AS source_file_name,
        r.source_row_number                               AS source_row_number,
        r.raw_record_id                                   AS raw_record_id,
        r.ingested_at                                     AS ingested_at
    FROM raw.calendar_date_load AS r
    JOIN latest_batch AS b
      ON b.load_batch_id = r.load_batch_id
)
SELECT DISTINCT ON (t.date_key)
    t.date_key,
    t.full_date,
    t.day_of_month,
    t.day_name,
    t.day_of_week,
    t.day_of_year,
    t.week_of_year,
    t.iso_year,
    t.month_number,
    t.month_name,
    t.month_start_date,
    t.month_end_date,
    t.quarter_number,
    t.quarter_name,
    t.calendar_year,
    t.fiscal_month,
    t.fiscal_quarter,
    t.fiscal_year,
    t.is_weekend,
    t.is_month_end,
    t.is_quarter_end,
    t.is_year_end,
    t.is_holiday,
    t.holiday_name,
    t.is_closure_holiday,
    t.is_selling_day,
    t.load_batch_id,
    t.source_file_name,
    t.source_row_number,
    t.raw_record_id,
    t.ingested_at
FROM typed AS t
ORDER BY t.date_key, t.raw_record_id DESC;

COMMENT ON VIEW staging.stg_calendar_date IS
    'Grain: one row per date_key, restricted to the most recent raw.calendar_date_load batch '
    '(greatest max(ingested_at), tie-broken by greatest max(raw_record_id)) and deduplicated by keeping '
    'the highest raw_record_id per date_key. Columns 1-26 are the warehouse.dim_date contract in exact '
    'order and type; the trailing columns carry load lineage and are not merged into the warehouse.';

COMMENT ON COLUMN staging.stg_calendar_date.date_key IS 'Typed YYYYMMDD integer date key; the grain of this view.';
COMMENT ON COLUMN staging.stg_calendar_date.full_date IS 'Typed calendar date.';
COMMENT ON COLUMN staging.stg_calendar_date.holiday_name IS 'Typed holiday name; blank source cells become NULL.';
COMMENT ON COLUMN staging.stg_calendar_date.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_calendar_date.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_calendar_date.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_calendar_date.raw_record_id IS 'Lineage: raw.calendar_date_load surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_calendar_date.ingested_at IS 'Lineage: UTC instant the raw row was landed.';
