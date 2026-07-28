-- =============================================================================
-- File:            sql/08_validation/03_referential_checks.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement DQ-REF-001 through DQ-REF-005: grain uniqueness, calendar contiguity, SCD Type 2 timeline integrity and constraint presence.
-- Execution order: 23 of 25 — after the dimension checks.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW; evaluating the view has no side effects and writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per check (five rows), in the uniform shape defined by audit.vw_dq_result_template.
-- =============================================================================
--
-- Run it:     SELECT * FROM audit.vw_dq_referential ORDER BY check_id;
--
--   DQ-REF-001  warehouse.dim_date grain is unique on full_date
--   DQ-REF-002  warehouse.dim_dealership grain is unique on (dealership_id, effective_date)
--   DQ-REF-003  warehouse.dim_date has no gaps in its date sequence
--   DQ-REF-004  the constraints that enforce these grains are actually present
--   DQ-REF-005  the SCD Type 2 timeline of every store is contiguous and non-overlapping
--
-- Phase 0 has no fact tables, so there is no fact-to-dimension foreign key to
-- verify yet. Rather than pretend otherwise, this file checks what does exist:
-- the grain rules the future facts will depend on, and the constraints that
-- enforce them. Fact-to-dimension referential checks arrive with the facts in
-- Phase 1.2 (see sql/04_facts/README.md).
--
-- DQ-REF-003 differs from DQ-DATE-002 on purpose. DQ-DATE-002 compares a count
-- against a span, which detects that dates are missing. DQ-REF-003 uses a window
-- function to find WHERE they are missing, and reports the first gap so it can be
-- fixed rather than merely noticed.
--
-- DQ-REF-004 is a catalogue check: it asserts that the named constraints exist.
-- A migration that drops a constraint would otherwise make every data check pass
-- while the guarantee behind them has quietly gone.

CREATE OR REPLACE VIEW audit.vw_dq_referential AS
WITH date_grain AS (
    SELECT
        count(*)                     AS row_count,
        count(DISTINCT d.full_date)  AS distinct_full_date_count
    FROM warehouse.dim_date AS d
),
date_gaps AS (
    SELECT
        count(*)                                              AS gap_count,
        min(g.previous_date)                                  AS first_gap_after,
        min(g.missing_days)                                   AS first_gap_size
    FROM (
        SELECT
            lag(d.full_date) OVER (ORDER BY d.full_date)                        AS previous_date,
            d.full_date - lag(d.full_date) OVER (ORDER BY d.full_date) - 1      AS missing_days
        FROM warehouse.dim_date AS d
    ) AS g
    WHERE g.missing_days > 0
),
dealership_grain AS (
    SELECT
        count(*)                                                   AS row_count,
        count(DISTINCT (d.dealership_id, d.effective_date))         AS distinct_version_count
    FROM warehouse.dim_dealership AS d
),
scd_timeline AS (
    -- A store's versions must tile the timeline: each version starts exactly one
    -- day after the previous one ended, and exactly one version is open-ended.
    SELECT
        count(*) FILTER (WHERE t.previous_expiration_date IS NOT NULL
                           AND t.effective_date <> t.previous_expiration_date + 1)  AS timeline_break_count,
        count(*) FILTER (WHERE t.is_current
                           AND t.expiration_date <> DATE '9999-12-31')              AS sentinel_break_count,
        count(*) FILTER (WHERE NOT t.is_current
                           AND t.expiration_date = DATE '9999-12-31')               AS stale_sentinel_count
    FROM (
        SELECT
            d.dealership_id,
            d.effective_date,
            d.expiration_date,
            d.is_current,
            lag(d.expiration_date) OVER (PARTITION BY d.dealership_id ORDER BY d.effective_date)
                AS previous_expiration_date
        FROM warehouse.dim_dealership AS d
    ) AS t
),
expected_constraints (constraint_name, table_name) AS (
    VALUES
        ('pk_dim_date',                              'warehouse.dim_date'),
        ('uq_dim_date_full_date',                    'warehouse.dim_date'),
        ('ck_dim_date_selling_day_rule',             'warehouse.dim_date'),
        ('ck_dim_date_holiday_name_matches_flag',    'warehouse.dim_date'),
        ('pk_dim_dealership',                        'warehouse.dim_dealership'),
        ('uq_dim_dealership_id_effective_date',      'warehouse.dim_dealership'),
        ('ck_dim_dealership_current_flag_matches_sentinel', 'warehouse.dim_dealership'),
        ('ck_dim_dealership_franchise_brand_rule',   'warehouse.dim_dealership'),
        ('pk_pipeline_run',                          'audit.pipeline_run'),
        ('fk_validation_result_pipeline_run',        'audit.validation_result'),
        ('fk_rejected_record_pipeline_run',          'audit.rejected_record')
),
constraint_presence AS (
    SELECT
        count(*)                                                      AS expected_count,
        count(*) FILTER (WHERE c.conname IS NULL)                     AS missing_count,
        coalesce(string_agg(e.constraint_name, ', ' ORDER BY e.constraint_name)
                 FILTER (WHERE c.conname IS NULL), '')                AS missing_list
    FROM expected_constraints AS e
    LEFT JOIN pg_constraint AS c
           ON c.conname = e.constraint_name
          AND c.conrelid = to_regclass(e.table_name)
),
index_presence AS (
    SELECT
        (to_regclass('warehouse.uix_dim_dealership_current_dealership_id') IS NOT NULL) AS current_index_present
)

-- DQ-REF-001 --------------------------------------------------------------
SELECT
    'DQ-REF-001'::text                                                        AS check_id,
    'dim_date grain is unique on full_date'::text                             AS check_name,
    'referential'::text                                                       AS check_category,
    'warehouse.dim_date'::text                                                AS target_object,
    'critical'::text                                                          AS severity,
    CASE
        WHEN g.row_count = 0 THEN 'skipped'
        WHEN g.row_count = g.distinct_full_date_count THEN 'passed'
        ELSE 'failed'
    END::text                                                                 AS status,
    g.distinct_full_date_count::numeric                                       AS observed_value,
    g.row_count::numeric                                                      AS expected_value,
    greatest(g.row_count - g.distinct_full_date_count, 0)::bigint             AS failed_record_count,
    CASE
        WHEN g.row_count = 0 THEN 'warehouse.dim_date is empty; grain not evaluated.'
        WHEN g.row_count = g.distinct_full_date_count
            THEN format('One row per calendar date across %s rows.', g.row_count)
        ELSE format('Grain violated: %s rows for only %s distinct dates.',
                    g.row_count, g.distinct_full_date_count)
    END::text                                                                 AS message
FROM date_grain AS g

UNION ALL

-- DQ-REF-002 --------------------------------------------------------------
SELECT
    'DQ-REF-002'::text,
    'dim_dealership grain is unique on (dealership_id, effective_date)'::text,
    'referential'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE
        WHEN g.row_count = 0 THEN 'skipped'
        WHEN g.row_count = g.distinct_version_count THEN 'passed'
        ELSE 'failed'
    END::text,
    g.distinct_version_count::numeric,
    g.row_count::numeric,
    greatest(g.row_count - g.distinct_version_count, 0)::bigint,
    CASE
        WHEN g.row_count = 0 THEN 'warehouse.dim_dealership is empty; grain not evaluated.'
        WHEN g.row_count = g.distinct_version_count
            THEN format('One row per store version across %s rows.', g.row_count)
        ELSE format('Grain violated: %s rows for only %s distinct (dealership_id, effective_date) pairs.',
                    g.row_count, g.distinct_version_count)
    END::text
FROM dealership_grain AS g

UNION ALL

-- DQ-REF-003 --------------------------------------------------------------
SELECT
    'DQ-REF-003'::text,
    'dim_date has no gaps in its date sequence'::text,
    'completeness'::text,
    'warehouse.dim_date'::text,
    'critical'::text,
    CASE
        WHEN dg.row_count = 0 THEN 'skipped'
        WHEN gaps.gap_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    gaps.gap_count::numeric,
    0::numeric,
    gaps.gap_count::bigint,
    CASE
        WHEN dg.row_count = 0 THEN 'warehouse.dim_date is empty; gap detection not evaluated.'
        WHEN gaps.gap_count = 0
            THEN format('Every consecutive pair of the %s dates is exactly one day apart.', dg.row_count)
        ELSE format('%s gap(s) in the date sequence. First gap starts after %s and is %s day(s) wide. '
                    'A gap silently drops every future fact on the missing dates.',
                    gaps.gap_count, gaps.first_gap_after, gaps.first_gap_size)
    END::text
FROM date_gaps AS gaps
CROSS JOIN date_grain AS dg

UNION ALL

-- DQ-REF-004 --------------------------------------------------------------
SELECT
    'DQ-REF-004'::text,
    'grain-enforcing constraints and indexes are present'::text,
    'schema'::text,
    'warehouse, audit'::text,
    'critical'::text,
    CASE
        WHEN cp.missing_count = 0 AND ip.current_index_present THEN 'passed'
        ELSE 'failed'
    END::text,
    (cp.expected_count - cp.missing_count)::numeric,
    cp.expected_count::numeric,
    (cp.missing_count + CASE WHEN ip.current_index_present THEN 0 ELSE 1 END)::bigint,
    CASE
        WHEN cp.missing_count = 0 AND ip.current_index_present
            THEN format('All %s expected constraints and the partial unique index '
                        'uix_dim_dealership_current_dealership_id are present.', cp.expected_count)
        WHEN cp.missing_count > 0 AND NOT ip.current_index_present
            THEN format('Missing constraint(s): %s. The partial unique index '
                        'uix_dim_dealership_current_dealership_id is also missing.', cp.missing_list)
        WHEN cp.missing_count > 0
            THEN format('Missing constraint(s): %s. Data checks may pass while the guarantee behind them '
                        'is gone.', cp.missing_list)
        ELSE 'The partial unique index uix_dim_dealership_current_dealership_id is missing; nothing '
             'prevents two current rows for the same store.'
    END::text
FROM constraint_presence AS cp
CROSS JOIN index_presence AS ip

UNION ALL

-- DQ-REF-005 --------------------------------------------------------------
SELECT
    'DQ-REF-005'::text,
    'dim_dealership SCD Type 2 timeline is contiguous and non-overlapping'::text,
    'referential'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE
        WHEN g.row_count = 0 THEN 'skipped'
        WHEN t.timeline_break_count + t.sentinel_break_count + t.stale_sentinel_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    (t.timeline_break_count + t.sentinel_break_count + t.stale_sentinel_count)::numeric,
    0::numeric,
    (t.timeline_break_count + t.sentinel_break_count + t.stale_sentinel_count)::bigint,
    CASE
        WHEN g.row_count = 0 THEN 'warehouse.dim_dealership is empty; SCD timeline not evaluated.'
        WHEN t.timeline_break_count + t.sentinel_break_count + t.stale_sentinel_count = 0
            THEN format('All %s version rows tile their store timeline: each version starts the day after '
                        'the previous one ended, and only current rows carry the 9999-12-31 sentinel.',
                        g.row_count)
        ELSE format('SCD timeline broken: %s version(s) do not start the day after the previous version '
                    'ended, %s current row(s) lack the 9999-12-31 sentinel, %s expired row(s) still carry it.',
                    t.timeline_break_count, t.sentinel_break_count, t.stale_sentinel_count)
    END::text
FROM scd_timeline AS t
CROSS JOIN dealership_grain AS g;

COMMENT ON VIEW audit.vw_dq_referential IS
    'Grain: one row per check (DQ-REF-001..005), in the uniform shape of audit.vw_dq_result_template. '
    'Grain uniqueness, calendar contiguity, SCD Type 2 timeline integrity, and presence of the '
    'constraints and indexes that enforce them. No fact-to-dimension checks exist yet because no fact '
    'table exists yet; they arrive with the facts in Phase 1.2.';
