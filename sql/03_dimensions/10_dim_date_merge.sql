-- =============================================================================
-- File:            sql/03_dimensions/10_dim_date_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent UPSERT of staging.stg_calendar_date into warehouse.dim_date.
-- Execution order: 10 of 25 in the init sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per calendar date (warehouse.dim_date grain), keyed on date_key.
-- =============================================================================
--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file
-- name and executes each file's whole text through psycopg's cursor.execute().
-- Therefore this file must contain plain SQL only:
--   * no psql meta-commands (\i, \set, \c, \gexec, \copy)
--   * no BEGIN/COMMIT — the loader owns the transaction
--   * statements separated by semicolons
-- It must also be safe to run inside the ordinary init sequence against an empty
-- database, which it is: with no raw rows the staging view yields nothing and the
-- INSERT affects zero rows.
--
-- WHY dim_date IS TYPE 1 AND NOT TYPE 2
-- -------------------------------------
-- A calendar date has no history: 2025-07-04 was always a Friday. A change here
-- can only be a corrected derivation or a changed holiday policy, both of which
-- must apply retroactively. So the merge overwrites in place.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE, every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The row
-- comparison uses IS DISTINCT FROM so that a NULL holiday_name on both sides
-- counts as equal rather than unknown.

INSERT INTO warehouse.dim_date AS d (
    date_key,
    full_date,
    day_of_month,
    day_name,
    day_of_week,
    day_of_year,
    week_of_year,
    iso_year,
    month_number,
    month_name,
    month_start_date,
    month_end_date,
    quarter_number,
    quarter_name,
    calendar_year,
    fiscal_month,
    fiscal_quarter,
    fiscal_year,
    is_weekend,
    is_month_end,
    is_quarter_end,
    is_year_end,
    is_holiday,
    holiday_name,
    is_closure_holiday,
    is_selling_day
)
SELECT
    s.date_key,
    s.full_date,
    s.day_of_month,
    s.day_name,
    s.day_of_week,
    s.day_of_year,
    s.week_of_year,
    s.iso_year,
    s.month_number,
    s.month_name,
    s.month_start_date,
    s.month_end_date,
    s.quarter_number,
    s.quarter_name,
    s.calendar_year,
    s.fiscal_month,
    s.fiscal_quarter,
    s.fiscal_year,
    s.is_weekend,
    s.is_month_end,
    s.is_quarter_end,
    s.is_year_end,
    s.is_holiday,
    s.holiday_name,
    s.is_closure_holiday,
    s.is_selling_day
FROM staging.stg_calendar_date AS s
ON CONFLICT (date_key) DO UPDATE
SET full_date          = EXCLUDED.full_date,
    day_of_month       = EXCLUDED.day_of_month,
    day_name           = EXCLUDED.day_name,
    day_of_week        = EXCLUDED.day_of_week,
    day_of_year        = EXCLUDED.day_of_year,
    week_of_year       = EXCLUDED.week_of_year,
    iso_year           = EXCLUDED.iso_year,
    month_number       = EXCLUDED.month_number,
    month_name         = EXCLUDED.month_name,
    month_start_date   = EXCLUDED.month_start_date,
    month_end_date     = EXCLUDED.month_end_date,
    quarter_number     = EXCLUDED.quarter_number,
    quarter_name       = EXCLUDED.quarter_name,
    calendar_year      = EXCLUDED.calendar_year,
    fiscal_month       = EXCLUDED.fiscal_month,
    fiscal_quarter     = EXCLUDED.fiscal_quarter,
    fiscal_year        = EXCLUDED.fiscal_year,
    is_weekend         = EXCLUDED.is_weekend,
    is_month_end       = EXCLUDED.is_month_end,
    is_quarter_end     = EXCLUDED.is_quarter_end,
    is_year_end        = EXCLUDED.is_year_end,
    is_holiday         = EXCLUDED.is_holiday,
    holiday_name       = EXCLUDED.holiday_name,
    is_closure_holiday = EXCLUDED.is_closure_holiday,
    is_selling_day     = EXCLUDED.is_selling_day
WHERE (
    d.full_date,
    d.day_of_month,
    d.day_name,
    d.day_of_week,
    d.day_of_year,
    d.week_of_year,
    d.iso_year,
    d.month_number,
    d.month_name,
    d.month_start_date,
    d.month_end_date,
    d.quarter_number,
    d.quarter_name,
    d.calendar_year,
    d.fiscal_month,
    d.fiscal_quarter,
    d.fiscal_year,
    d.is_weekend,
    d.is_month_end,
    d.is_quarter_end,
    d.is_year_end,
    d.is_holiday,
    d.holiday_name,
    d.is_closure_holiday,
    d.is_selling_day
) IS DISTINCT FROM (
    EXCLUDED.full_date,
    EXCLUDED.day_of_month,
    EXCLUDED.day_name,
    EXCLUDED.day_of_week,
    EXCLUDED.day_of_year,
    EXCLUDED.week_of_year,
    EXCLUDED.iso_year,
    EXCLUDED.month_number,
    EXCLUDED.month_name,
    EXCLUDED.month_start_date,
    EXCLUDED.month_end_date,
    EXCLUDED.quarter_number,
    EXCLUDED.quarter_name,
    EXCLUDED.calendar_year,
    EXCLUDED.fiscal_month,
    EXCLUDED.fiscal_quarter,
    EXCLUDED.fiscal_year,
    EXCLUDED.is_weekend,
    EXCLUDED.is_month_end,
    EXCLUDED.is_quarter_end,
    EXCLUDED.is_year_end,
    EXCLUDED.is_holiday,
    EXCLUDED.holiday_name,
    EXCLUDED.is_closure_holiday,
    EXCLUDED.is_selling_day
);
