-- =============================================================================
-- File:            sql/03_dimensions/00_dim_date.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_date, the conformed calendar dimension shared by every future fact table.
-- Execution order: 8 of 25 — after the staging views, before sql/03_dimensions/10_dim_date_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus COMMENTs; existing rows and constraints are untouched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per calendar date.
-- =============================================================================
--
-- Column contract: ARPI cross-agent contract section 7 — 26 columns, exact names,
-- exact order, exact types. Do not add, remove or reorder columns here without a
-- contract change.
--
-- Fiscal calendar: ARPI's fiscal year is aligned to the calendar year, so
-- fiscal_month = month_number, fiscal_quarter = quarter_number and
-- fiscal_year = calendar_year. The columns still exist so that a future fiscal
-- offset is a data change rather than a schema change; the CHECK constraint
-- ck_dim_date_fiscal_alignment documents and enforces today's rule and is the
-- single place to relax when that changes.
--
-- Selling days: weekends ARE selling days. New Hampshire permits Sunday vehicle
-- sales, so is_selling_day depends only on showroom closure holidays
-- (is_selling_day = NOT is_closure_holiday), never on the day of week.

CREATE TABLE IF NOT EXISTS warehouse.dim_date (
    date_key            integer      NOT NULL,
    full_date           date         NOT NULL,
    day_of_month        smallint     NOT NULL,
    day_name            varchar(9)   NOT NULL,
    day_of_week         smallint     NOT NULL,
    day_of_year         smallint     NOT NULL,
    week_of_year        smallint     NOT NULL,
    iso_year            smallint     NOT NULL,
    month_number        smallint     NOT NULL,
    month_name          varchar(9)   NOT NULL,
    month_start_date    date         NOT NULL,
    month_end_date      date         NOT NULL,
    quarter_number      smallint     NOT NULL,
    quarter_name        varchar(2)   NOT NULL,
    calendar_year       smallint     NOT NULL,
    fiscal_month        smallint     NOT NULL,
    fiscal_quarter      smallint     NOT NULL,
    fiscal_year         smallint     NOT NULL,
    is_weekend          boolean      NOT NULL,
    is_month_end        boolean      NOT NULL,
    is_quarter_end      boolean      NOT NULL,
    is_year_end         boolean      NOT NULL,
    is_holiday          boolean      NOT NULL,
    holiday_name        varchar(64)  NULL,
    is_closure_holiday  boolean      NOT NULL,
    is_selling_day      boolean      NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_date
        PRIMARY KEY (date_key),
    CONSTRAINT uq_dim_date_full_date
        UNIQUE (full_date),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_date_date_key_range
        CHECK (date_key BETWEEN 19000101 AND 99991231),
    CONSTRAINT ck_dim_date_day_of_month_range
        CHECK (day_of_month BETWEEN 1 AND 31),
    CONSTRAINT ck_dim_date_day_of_week_range
        CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT ck_dim_date_day_of_year_range
        CHECK (day_of_year BETWEEN 1 AND 366),
    CONSTRAINT ck_dim_date_week_of_year_range
        CHECK (week_of_year BETWEEN 1 AND 53),
    CONSTRAINT ck_dim_date_month_number_range
        CHECK (month_number BETWEEN 1 AND 12),
    CONSTRAINT ck_dim_date_quarter_number_range
        CHECK (quarter_number BETWEEN 1 AND 4),
    CONSTRAINT ck_dim_date_quarter_name_format
        CHECK (quarter_name ~ '^Q[1-4]$'),
    CONSTRAINT ck_dim_date_day_name_domain
        CHECK (day_name IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    CONSTRAINT ck_dim_date_month_name_domain
        CHECK (month_name IN ('January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December')),

    -- Grain-integrity constraints --------------------------------------------
    -- date_key must be the YYYYMMDD encoding of full_date. EXTRACT on a date is
    -- IMMUTABLE, so it is legal inside a CHECK; to_char() is only STABLE and is not.
    CONSTRAINT ck_dim_date_key_matches_full_date
        CHECK (date_key = (EXTRACT(YEAR FROM full_date)::integer * 10000)
                        + (EXTRACT(MONTH FROM full_date)::integer * 100)
                        +  EXTRACT(DAY FROM full_date)::integer),
    CONSTRAINT ck_dim_date_month_bounds_ordered
        CHECK (month_end_date >= month_start_date
               AND full_date BETWEEN month_start_date AND month_end_date),
    CONSTRAINT ck_dim_date_quarter_matches_month
        CHECK (quarter_number = ((month_number - 1) / 3) + 1),
    CONSTRAINT ck_dim_date_quarter_name_matches_number
        CHECK (quarter_name = 'Q' || quarter_number::text),
    CONSTRAINT ck_dim_date_fiscal_alignment
        CHECK (fiscal_month = month_number
               AND fiscal_quarter = quarter_number
               AND fiscal_year = calendar_year),
    CONSTRAINT ck_dim_date_is_weekend_matches_day_of_week
        CHECK (is_weekend = (day_of_week IN (6, 7))),
    CONSTRAINT ck_dim_date_is_month_end_matches_bounds
        CHECK (is_month_end = (full_date = month_end_date)),
    CONSTRAINT ck_dim_date_is_quarter_end_matches_month
        CHECK (is_quarter_end = (full_date = month_end_date AND month_number IN (3, 6, 9, 12))),
    CONSTRAINT ck_dim_date_is_year_end_matches_date
        CHECK (is_year_end = (month_number = 12 AND day_of_month = 31)),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_dim_date_selling_day_rule
        CHECK (is_selling_day = NOT is_closure_holiday),
    CONSTRAINT ck_dim_date_holiday_name_matches_flag
        CHECK ((holiday_name IS NOT NULL) = is_holiday),
    CONSTRAINT ck_dim_date_closure_implies_holiday
        CHECK (NOT is_closure_holiday OR is_holiday)
);

COMMENT ON TABLE warehouse.dim_date IS
    'Grain: one row per calendar date. Conformed date dimension for the ARPI warehouse; every future fact '
    'table joins to it on date_key. Fiscal year is aligned to the calendar year in Phase 0. Weekends are '
    'selling days (New Hampshire permits Sunday vehicle sales); only showroom-closure holidays are not. '
    'Loaded exclusively by sql/03_dimensions/10_dim_date_merge.sql.';

COMMENT ON COLUMN warehouse.dim_date.date_key IS 'Primary key. Integer YYYYMMDD encoding of full_date, enforced by ck_dim_date_key_matches_full_date.';
COMMENT ON COLUMN warehouse.dim_date.full_date IS 'The calendar date itself. UNIQUE; this is the grain expressed as a date.';
COMMENT ON COLUMN warehouse.dim_date.day_of_month IS 'Day number within the month, 1-31.';
COMMENT ON COLUMN warehouse.dim_date.day_name IS 'English weekday name, Monday through Sunday.';
COMMENT ON COLUMN warehouse.dim_date.day_of_week IS 'ISO weekday number: 1 = Monday through 7 = Sunday.';
COMMENT ON COLUMN warehouse.dim_date.day_of_year IS 'Ordinal day within the calendar year, 1-366.';
COMMENT ON COLUMN warehouse.dim_date.week_of_year IS 'ISO-8601 week number, 1-53. Pair with iso_year, never with calendar_year.';
COMMENT ON COLUMN warehouse.dim_date.iso_year IS 'ISO-8601 week-numbering year. Differs from calendar_year in the first and last days of a year.';
COMMENT ON COLUMN warehouse.dim_date.month_number IS 'Month number, 1-12.';
COMMENT ON COLUMN warehouse.dim_date.month_name IS 'English month name, January through December.';
COMMENT ON COLUMN warehouse.dim_date.month_start_date IS 'First calendar date of the month containing full_date.';
COMMENT ON COLUMN warehouse.dim_date.month_end_date IS 'Last calendar date of the month containing full_date.';
COMMENT ON COLUMN warehouse.dim_date.quarter_number IS 'Calendar quarter number, 1-4, derived from month_number.';
COMMENT ON COLUMN warehouse.dim_date.quarter_name IS 'Quarter label Q1 through Q4, always consistent with quarter_number.';
COMMENT ON COLUMN warehouse.dim_date.calendar_year IS 'Gregorian calendar year.';
COMMENT ON COLUMN warehouse.dim_date.fiscal_month IS 'Fiscal month. Equals month_number while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN warehouse.dim_date.fiscal_quarter IS 'Fiscal quarter. Equals quarter_number while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN warehouse.dim_date.fiscal_year IS 'Fiscal year. Equals calendar_year while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN warehouse.dim_date.is_weekend IS 'True on Saturday and Sunday. Does not affect is_selling_day.';
COMMENT ON COLUMN warehouse.dim_date.is_month_end IS 'True when full_date is the last date of its month.';
COMMENT ON COLUMN warehouse.dim_date.is_quarter_end IS 'True when full_date is the last date of its calendar quarter.';
COMMENT ON COLUMN warehouse.dim_date.is_year_end IS 'True when full_date is 31 December.';
COMMENT ON COLUMN warehouse.dim_date.is_holiday IS 'True when the date is in the recognised holiday set defined in DATA_GENERATION.md.';
COMMENT ON COLUMN warehouse.dim_date.holiday_name IS 'Name of the recognised holiday, or NULL. NULL exactly when is_holiday is false, enforced by ck_dim_date_holiday_name_matches_flag.';
COMMENT ON COLUMN warehouse.dim_date.is_closure_holiday IS 'True when the showroom is closed for the holiday. Implies is_holiday.';
COMMENT ON COLUMN warehouse.dim_date.is_selling_day IS 'True when the store can retail a vehicle. Defined as NOT is_closure_holiday and enforced by ck_dim_date_selling_day_rule.';
