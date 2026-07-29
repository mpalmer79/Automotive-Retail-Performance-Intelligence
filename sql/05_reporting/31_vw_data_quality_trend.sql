-- =============================================================================
-- File:            sql/05_reporting/31_vw_data_quality_trend.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Expose the data-quality result history as a trend, one row per pipeline run per check category, so a reader can see whether quality is improving or decaying.
-- Execution order: Reporting layer, after the audit tables exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per pipeline run per check category per severity.
-- =============================================================================
--
-- WHY A TREND AND NOT JUST A SNAPSHOT
-- -----------------------------------
-- reporting.vw_data_quality_summary already shows every individual result of every
-- run. That answers "what failed?" It does not answer "is this getting better or
-- worse?", which is the question a reviewer asks after the second run. This view
-- aggregates to run and category so a trend line is a direct plot rather than a
-- pivot a reader has to build.
--
-- THE THREE STATUSES MEAN DIFFERENT THINGS
-- ----------------------------------------
--   passed   the rule was evaluated and holds
--   failed   the rule was evaluated and is violated
--   skipped  the rule could NOT be meaningfully evaluated, essentially always
--            because the target object holds no rows
--
-- checks_skipped is published beside the pass rate on purpose. A run with a 100%
-- pass rate and forty skipped checks has proved far less than a run with a 100%
-- pass rate and none, and collapsing the two into one percentage would hide exactly
-- that. pass_rate therefore divides by EVALUATED checks, and evaluation_coverage
-- states what share of registered checks were evaluated at all.
--
-- SECURITY
-- --------
-- This view reads audit tables that arpi_reporter holds no privilege on. It works
-- because a PostgreSQL view executes with its owner's privileges, and arpi_admin
-- owns both. That is the mechanism which lets Power BI see data-quality evidence
-- without being able to read the audit schema.

CREATE OR REPLACE VIEW reporting.vw_data_quality_trend AS
SELECT
    r.pipeline_run_id                                                 AS pipeline_run_id,
    r.run_uuid                                                        AS run_uuid,
    r.pipeline_name                                                   AS pipeline_name,
    r.profile_name                                                    AS profile_name,
    r.started_at                                                      AS run_started_at,
    (r.started_at AT TIME ZONE 'UTC')::date                           AS run_date,
    r.status                                                          AS run_status,
    v.check_category                                                  AS check_category,
    v.severity                                                        AS severity,

    count(*)::bigint                                                  AS checks_recorded,
    count(*) FILTER (WHERE v.status = 'passed')::bigint               AS checks_passed,
    count(*) FILTER (WHERE v.status = 'failed')::bigint               AS checks_failed,
    count(*) FILTER (WHERE v.status = 'skipped')::bigint              AS checks_skipped,
    count(*) FILTER (WHERE v.status <> 'skipped')::bigint             AS checks_evaluated,
    sum(v.failed_record_count)::bigint                                AS failed_record_count,

    count(*) FILTER (WHERE v.status = 'passed')::numeric
        / nullif(count(*) FILTER (WHERE v.status <> 'skipped'), 0)    AS pass_rate,
    count(*) FILTER (WHERE v.status <> 'skipped')::numeric
        / nullif(count(*), 0)                                         AS evaluation_coverage
FROM audit.validation_result AS v
JOIN audit.pipeline_run AS r
       ON r.pipeline_run_id = v.pipeline_run_id
GROUP BY
    r.pipeline_run_id, r.run_uuid, r.pipeline_name, r.profile_name,
    r.started_at, r.status, v.check_category, v.severity;

COMMENT ON VIEW reporting.vw_data_quality_trend IS
    'Grain: one row per pipeline run per check category per severity. The trend companion to '
    'vw_data_quality_summary, which shows individual results: this view answers "is quality improving or '
    'decaying?" rather than "what failed?". pass_rate divides passed checks by EVALUATED checks, and '
    'checks_skipped and evaluation_coverage are published beside it, because a 100% pass rate with forty '
    'skipped checks has proved far less than a 100% pass rate with none -- a skipped check is one that '
    'could not be meaningfully evaluated, almost always because its target held no rows, and it must never '
    'read as a pass. Categories are the seven canonical values fixed in src/arpi/constants.py and enforced '
    'by a check constraint on audit.validation_result. Reads audit tables arpi_reporter holds no privilege '
    'on; it works because a view executes with its owner''s privileges, which is the mechanism that lets '
    'Power BI see data-quality evidence without reaching the audit schema.';

COMMENT ON COLUMN reporting.vw_data_quality_trend.pipeline_run_id IS 'Identifier of the pipeline run. Relationship column into vw_pipeline_run_summary.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.run_uuid IS 'Deterministic run identifier, derived from the run parameters. Two runs with identical parameters share it.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.pipeline_name IS 'Logical pipeline the run executed.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.profile_name IS 'Configuration profile: development, test or portfolio. Never compare quality across profiles without saying so; they generate different volumes.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.run_started_at IS 'When the run started, with time zone.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.run_date IS 'UTC date of the run. The x-axis of a quality trend.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.run_status IS 'Terminal status of the run: running, succeeded, failed or aborted.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.check_category IS 'One of the seven canonical categories: structural, completeness, uniqueness, referential, business_rule, privacy, reproducibility. Reconciliation is deliberately not a category; reconciliations live in vw_reconciliation_status.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.severity IS 'critical, warning or info. A critical failure fails the run; a warning does not.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.checks_recorded IS 'Every result recorded in the group, skipped ones included.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.checks_passed IS 'Rules evaluated and holding.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.checks_failed IS 'Rules evaluated and violated.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.checks_skipped IS 'Rules that could not be meaningfully evaluated, almost always because the target object held no rows. A skipped check is not a passing check and must never be displayed as one.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.checks_evaluated IS 'The pass-rate denominator: recorded checks less skipped ones.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.failed_record_count IS 'Total offending records across the group. Zero on a passing group.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.pass_rate IS 'checks_passed / checks_evaluated, as a fraction of 1. NULL when every check in the group was skipped -- there is no pass rate over an unevaluated population.';
COMMENT ON COLUMN reporting.vw_data_quality_trend.evaluation_coverage IS 'checks_evaluated / checks_recorded, as a fraction of 1. Must be read with pass_rate: a high pass rate at low coverage proves very little.';
