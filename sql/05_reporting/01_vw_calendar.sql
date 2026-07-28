-- =============================================================================
-- File:            sql/05_reporting/01_vw_calendar.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly calendar view over warehouse.dim_date for Power BI, Excel and ad-hoc analysis.
-- Execution order: 13 of 25 — after warehouse.dim_date exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per calendar date.
-- =============================================================================
--
-- This view is the date table a semantic model should bind to. It renames the
-- physical columns to the words the business uses, adds the two labels that every
-- report re-derives by hand (year_month_label and month_year_label), and hides
-- nothing that a report legitimately needs.
--
-- Sort columns: year_month_number is provided so that year_month_label sorts
-- chronologically rather than alphabetically in Power BI and Excel.

CREATE OR REPLACE VIEW reporting.vw_calendar AS
SELECT
    d.date_key                                              AS date_key,
    d.full_date                                             AS calendar_date,
    d.day_of_month                                          AS day_of_month,
    d.day_name                                              AS day_name,
    d.day_of_week                                           AS iso_day_of_week,
    d.day_of_year                                           AS day_of_year,
    d.week_of_year                                          AS iso_week_number,
    d.iso_year                                              AS iso_week_year,
    d.month_number                                          AS month_number,
    d.month_name                                            AS month_name,
    d.month_start_date                                      AS month_start_date,
    d.month_end_date                                        AS month_end_date,
    (d.calendar_year::integer * 100) + d.month_number       AS year_month_number,
    to_char(d.full_date, 'YYYY-MM')                         AS year_month_label,
    d.month_name || ' ' || d.calendar_year::text            AS month_year_label,
    d.quarter_number                                        AS quarter_number,
    d.quarter_name                                          AS quarter_name,
    d.quarter_name || ' ' || d.calendar_year::text          AS quarter_year_label,
    d.calendar_year                                         AS calendar_year,
    d.fiscal_month                                          AS fiscal_month,
    d.fiscal_quarter                                        AS fiscal_quarter,
    d.fiscal_year                                           AS fiscal_year,
    d.is_weekend                                            AS is_weekend,
    d.is_month_end                                          AS is_month_end,
    d.is_quarter_end                                        AS is_quarter_end,
    d.is_year_end                                           AS is_year_end,
    d.is_holiday                                            AS is_holiday,
    d.holiday_name                                          AS holiday_name,
    d.is_closure_holiday                                    AS is_showroom_closed,
    d.is_selling_day                                        AS is_selling_day
FROM warehouse.dim_date AS d;

COMMENT ON VIEW reporting.vw_calendar IS
    'Grain: one row per calendar date. Business-facing projection of warehouse.dim_date and the date table '
    'a Power BI or Excel model should bind to. Adds year_month_number as the chronological sort key for '
    'year_month_label. is_showroom_closed is the reporting name for dim_date.is_closure_holiday; note that '
    'weekends are selling days because New Hampshire permits Sunday vehicle sales.';

COMMENT ON COLUMN reporting.vw_calendar.date_key IS 'Integer YYYYMMDD key. Join key for every fact table.';
COMMENT ON COLUMN reporting.vw_calendar.calendar_date IS 'The calendar date.';
COMMENT ON COLUMN reporting.vw_calendar.day_of_month IS 'Day number within the month, 1-31.';
COMMENT ON COLUMN reporting.vw_calendar.day_name IS 'Weekday name, Monday through Sunday.';
COMMENT ON COLUMN reporting.vw_calendar.iso_day_of_week IS 'ISO weekday number, 1 = Monday through 7 = Sunday.';
COMMENT ON COLUMN reporting.vw_calendar.day_of_year IS 'Ordinal day within the calendar year, 1-366.';
COMMENT ON COLUMN reporting.vw_calendar.iso_week_number IS 'ISO-8601 week number, 1-53. Use with iso_week_year, not calendar_year.';
COMMENT ON COLUMN reporting.vw_calendar.iso_week_year IS 'ISO-8601 week-numbering year.';
COMMENT ON COLUMN reporting.vw_calendar.month_number IS 'Month number, 1-12.';
COMMENT ON COLUMN reporting.vw_calendar.month_name IS 'Month name, January through December.';
COMMENT ON COLUMN reporting.vw_calendar.month_start_date IS 'First date of the month.';
COMMENT ON COLUMN reporting.vw_calendar.month_end_date IS 'Last date of the month.';
COMMENT ON COLUMN reporting.vw_calendar.year_month_number IS 'YYYYMM integer. Chronological sort key for year_month_label.';
COMMENT ON COLUMN reporting.vw_calendar.year_month_label IS 'Month label in YYYY-MM form, for example 2025-07.';
COMMENT ON COLUMN reporting.vw_calendar.month_year_label IS 'Readable month label, for example July 2025.';
COMMENT ON COLUMN reporting.vw_calendar.quarter_number IS 'Calendar quarter number, 1-4.';
COMMENT ON COLUMN reporting.vw_calendar.quarter_name IS 'Quarter label Q1 through Q4.';
COMMENT ON COLUMN reporting.vw_calendar.quarter_year_label IS 'Readable quarter label, for example Q3 2025.';
COMMENT ON COLUMN reporting.vw_calendar.calendar_year IS 'Gregorian calendar year.';
COMMENT ON COLUMN reporting.vw_calendar.fiscal_month IS 'Fiscal month; equals month_number while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN reporting.vw_calendar.fiscal_quarter IS 'Fiscal quarter; equals quarter_number while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN reporting.vw_calendar.fiscal_year IS 'Fiscal year; equals calendar_year while the fiscal year is calendar-aligned.';
COMMENT ON COLUMN reporting.vw_calendar.is_weekend IS 'True on Saturday and Sunday. Weekends are still selling days.';
COMMENT ON COLUMN reporting.vw_calendar.is_month_end IS 'True on the last date of the month.';
COMMENT ON COLUMN reporting.vw_calendar.is_quarter_end IS 'True on the last date of the calendar quarter.';
COMMENT ON COLUMN reporting.vw_calendar.is_year_end IS 'True on 31 December.';
COMMENT ON COLUMN reporting.vw_calendar.is_holiday IS 'True on a recognised holiday, whether or not the showroom closes.';
COMMENT ON COLUMN reporting.vw_calendar.holiday_name IS 'Holiday name, or NULL when the date is not a holiday.';
COMMENT ON COLUMN reporting.vw_calendar.is_showroom_closed IS 'True when the showroom is closed for the holiday.';
COMMENT ON COLUMN reporting.vw_calendar.is_selling_day IS 'True when a vehicle can be retailed. Denominator for every per-selling-day KPI.';
