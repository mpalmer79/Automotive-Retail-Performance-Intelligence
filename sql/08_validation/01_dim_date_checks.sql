-- =============================================================================
-- File:            sql/08_validation/01_dim_date_checks.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement data-quality checks DQ-DATE-001 through DQ-DATE-005 against warehouse.dim_date in SQL.
-- Execution order: 21 of 25 — after the validation helpers.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW; evaluating the view has no side effects and writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per check (five rows), in the uniform shape defined by audit.vw_dq_result_template.
-- =============================================================================
--
-- Run it:     SELECT * FROM audit.vw_dq_dim_date ORDER BY check_id;
--
-- The check identifiers are the same strings the Python validation framework
-- uses, so a rule has one identity across both implementations:
--   DQ-DATE-001  date_key is unique
--   DQ-DATE-002  the date range is contiguous (no missing dates)
--   DQ-DATE-003  date_key is the YYYYMMDD encoding of full_date
--   DQ-DATE-004  no required field is NULL
--   DQ-DATE-005  the selling-day ratio is inside the configured tolerance
--
-- Some of these rules are also enforced by constraints on warehouse.dim_date. The
-- checks are still worth having: they report how far off the data is rather than
-- merely refusing it, they produce an auditable record per run, and they keep
-- working if a constraint is ever relaxed. DQ-DATE-002 and DQ-DATE-005 cannot be
-- expressed as constraints at all, because both are properties of the set rather
-- than of a row.
--
-- Empty table: every check returns `skipped`. See the status semantics in
-- sql/08_validation/00_validation_helpers.sql.

CREATE OR REPLACE VIEW audit.vw_dq_dim_date AS
WITH base AS (
    SELECT
        count(*)                                                  AS row_count,
        count(DISTINCT d.date_key)                                AS distinct_date_key_count,
        min(d.full_date)                                          AS min_full_date,
        max(d.full_date)                                          AS max_full_date,
        count(*) FILTER (
            WHERE d.date_key <> (EXTRACT(YEAR  FROM d.full_date)::integer * 10000)
                              + (EXTRACT(MONTH FROM d.full_date)::integer * 100)
                              +  EXTRACT(DAY   FROM d.full_date)::integer
        )                                                         AS key_mismatch_count,
        count(*) FILTER (
            WHERE d.date_key IS NULL
               OR d.full_date IS NULL
               OR d.day_of_month IS NULL
               OR d.day_name IS NULL
               OR d.day_of_week IS NULL
               OR d.day_of_year IS NULL
               OR d.week_of_year IS NULL
               OR d.iso_year IS NULL
               OR d.month_number IS NULL
               OR d.month_name IS NULL
               OR d.month_start_date IS NULL
               OR d.month_end_date IS NULL
               OR d.quarter_number IS NULL
               OR d.quarter_name IS NULL
               OR d.calendar_year IS NULL
               OR d.fiscal_month IS NULL
               OR d.fiscal_quarter IS NULL
               OR d.fiscal_year IS NULL
               OR d.is_weekend IS NULL
               OR d.is_month_end IS NULL
               OR d.is_quarter_end IS NULL
               OR d.is_year_end IS NULL
               OR d.is_holiday IS NULL
               OR d.is_closure_holiday IS NULL
               OR d.is_selling_day IS NULL
        )                                                         AS null_required_count,
        count(*) FILTER (WHERE d.is_selling_day)                  AS selling_day_count
    FROM warehouse.dim_date AS d
),
derived AS (
    SELECT
        b.*,
        CASE
            WHEN b.row_count = 0 THEN NULL
            ELSE (b.max_full_date - b.min_full_date) + 1
        END                                                       AS expected_row_count,
        CASE
            WHEN b.row_count = 0 THEN NULL
            ELSE round(b.selling_day_count::numeric / b.row_count::numeric, 6)
        END                                                       AS selling_day_ratio
    FROM base AS b
)

-- DQ-DATE-001 --------------------------------------------------------------
SELECT
    'DQ-DATE-001'::text                                                       AS check_id,
    'dim_date date_key is unique'::text                                       AS check_name,
    'uniqueness'::text                                                        AS check_category,
    'warehouse.dim_date'::text                                                AS target_object,
    'critical'::text                                                          AS severity,
    CASE
        WHEN d.row_count = 0 THEN 'skipped'
        WHEN d.row_count = d.distinct_date_key_count THEN 'passed'
        ELSE 'failed'
    END::text                                                                 AS status,
    d.distinct_date_key_count::numeric                                        AS observed_value,
    d.row_count::numeric                                                      AS expected_value,
    greatest(d.row_count - d.distinct_date_key_count, 0)::bigint              AS failed_record_count,
    CASE
        WHEN d.row_count = 0 THEN 'warehouse.dim_date is empty; uniqueness not evaluated.'
        WHEN d.row_count = d.distinct_date_key_count
            THEN format('%s rows, %s distinct date_key values.', d.row_count, d.distinct_date_key_count)
        ELSE format('%s duplicate date_key values: %s rows but only %s distinct keys.',
                    d.row_count - d.distinct_date_key_count, d.row_count, d.distinct_date_key_count)
    END::text                                                                 AS message
FROM derived AS d

UNION ALL

-- DQ-DATE-002 --------------------------------------------------------------
SELECT
    'DQ-DATE-002'::text,
    'dim_date covers a contiguous date range'::text,
    'completeness'::text,
    'warehouse.dim_date'::text,
    'critical'::text,
    CASE
        WHEN d.row_count = 0 THEN 'skipped'
        WHEN d.row_count = d.expected_row_count THEN 'passed'
        ELSE 'failed'
    END::text,
    d.row_count::numeric,
    d.expected_row_count::numeric,
    greatest(coalesce(d.expected_row_count, 0) - d.row_count, 0)::bigint,
    CASE
        WHEN d.row_count = 0 THEN 'warehouse.dim_date is empty; contiguity not evaluated.'
        WHEN d.row_count = d.expected_row_count
            THEN format('%s consecutive dates from %s to %s with no gaps.',
                        d.row_count, d.min_full_date, d.max_full_date)
        ELSE format('%s dates missing between %s and %s: expected %s rows, found %s.',
                    d.expected_row_count - d.row_count, d.min_full_date, d.max_full_date,
                    d.expected_row_count, d.row_count)
    END::text
FROM derived AS d

UNION ALL

-- DQ-DATE-003 --------------------------------------------------------------
SELECT
    'DQ-DATE-003'::text,
    'dim_date date_key matches full_date'::text,
    'business_rule'::text,
    'warehouse.dim_date'::text,
    'critical'::text,
    CASE
        WHEN d.row_count = 0 THEN 'skipped'
        WHEN d.key_mismatch_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    d.key_mismatch_count::numeric,
    0::numeric,
    d.key_mismatch_count::bigint,
    CASE
        WHEN d.row_count = 0 THEN 'warehouse.dim_date is empty; key encoding not evaluated.'
        WHEN d.key_mismatch_count = 0
            THEN format('All %s rows encode date_key as YYYYMMDD of full_date.', d.row_count)
        ELSE format('%s of %s rows have a date_key that is not the YYYYMMDD encoding of full_date.',
                    d.key_mismatch_count, d.row_count)
    END::text
FROM derived AS d

UNION ALL

-- DQ-DATE-004 --------------------------------------------------------------
SELECT
    'DQ-DATE-004'::text,
    'dim_date has no null required fields'::text,
    'completeness'::text,
    'warehouse.dim_date'::text,
    'critical'::text,
    CASE
        WHEN d.row_count = 0 THEN 'skipped'
        WHEN d.null_required_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    d.null_required_count::numeric,
    0::numeric,
    d.null_required_count::bigint,
    CASE
        WHEN d.row_count = 0 THEN 'warehouse.dim_date is empty; completeness not evaluated.'
        WHEN d.null_required_count = 0
            THEN format('All %s rows populate every required column. holiday_name is nullable by design.',
                        d.row_count)
        ELSE format('%s of %s rows have a NULL in a required column.', d.null_required_count, d.row_count)
    END::text
FROM derived AS d

UNION ALL

-- DQ-DATE-005 --------------------------------------------------------------
-- Bounds mirror validation.min_selling_day_ratio (0.80) and
-- validation.max_selling_day_ratio (1.00) from the ARPI configuration contract.
-- They are literals here because SQL has no access to the YAML profile; the
-- Python implementation of this check reads the configured values, and the two
-- must be changed together.
SELECT
    'DQ-DATE-005'::text,
    'dim_date selling-day ratio is within tolerance'::text,
    'business_rule'::text,
    'warehouse.dim_date'::text,
    'warning'::text,
    CASE
        WHEN d.row_count = 0 THEN 'skipped'
        WHEN d.selling_day_ratio BETWEEN 0.80 AND 1.00 THEN 'passed'
        ELSE 'failed'
    END::text,
    d.selling_day_ratio,
    0.80::numeric,
    CASE
        WHEN d.row_count = 0 THEN 0
        WHEN d.selling_day_ratio BETWEEN 0.80 AND 1.00 THEN 0
        ELSE d.row_count - d.selling_day_count
    END::bigint,
    CASE
        WHEN d.row_count = 0 THEN 'warehouse.dim_date is empty; selling-day ratio not evaluated.'
        WHEN d.selling_day_ratio BETWEEN 0.80 AND 1.00
            THEN format('%s of %s dates are selling days (ratio %s, tolerance 0.80 to 1.00).',
                        d.selling_day_count, d.row_count, d.selling_day_ratio)
        ELSE format('Selling-day ratio %s is outside the tolerance 0.80 to 1.00: %s of %s dates are selling days.',
                    d.selling_day_ratio, d.selling_day_count, d.row_count)
    END::text
FROM derived AS d;

COMMENT ON VIEW audit.vw_dq_dim_date IS
    'Grain: one row per check (DQ-DATE-001..005), in the uniform shape of audit.vw_dq_result_template. '
    'SQL implementation of the warehouse.dim_date data-quality rules; the check identifiers match the '
    'Python validation framework exactly. Returns status = skipped for every check when the dimension is '
    'empty, so it is safe to evaluate before the first load.';
