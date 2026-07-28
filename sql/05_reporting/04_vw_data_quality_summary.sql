-- =============================================================================
-- File:            sql/05_reporting/04_vw_data_quality_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Validation outcomes per pipeline run, with run context, for the data-quality page of any report.
-- Execution order: 16 of 25 — after the audit tables exist; last file of the reporting layer.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per validation result (audit.validation_result), enriched with its pipeline run.
-- =============================================================================
--
-- Grain choice: reporting.vw_pipeline_run_summary already gives one aggregated
-- line per run. This view is deliberately the complementary detail: every check
-- of every run, so that a data-quality page can show which check failed, on what
-- object, by how much, and whether it is the newest evaluation. Aggregating here
-- as well would leave nobody able to answer "which check broke?".
--
-- is_latest_run_for_check marks the most recent evaluation of each check_id so a
-- report can show current data-quality state without a subquery.
--
-- check_category is passed through unaggregated. It is safe to group on in a report
-- because the underlying column now carries a CHECK constraint over the seven canonical
-- categories, so a "checks by category" breakdown no longer mixes a Python taxonomy with
-- a SQL one depending on which layer recorded the row.

CREATE OR REPLACE VIEW reporting.vw_data_quality_summary AS
SELECT
    v.validation_result_id                                   AS validation_result_id,
    v.pipeline_run_id                                        AS pipeline_run_id,
    r.run_uuid                                               AS run_uuid,
    r.pipeline_name                                          AS pipeline_name,
    r.profile_name                                           AS profile_name,
    r.status                                                 AS run_status,
    r.started_at                                             AS run_started_at,
    v.check_id                                               AS check_id,
    v.check_name                                             AS check_name,
    v.check_category                                         AS check_category,
    v.target_object                                          AS target_object,
    v.severity                                               AS severity,
    v.status                                                 AS check_status,
    (v.status = 'failed')                                    AS is_failed,
    (v.status = 'failed' AND v.severity = 'critical')        AS is_critical_failure,
    v.observed_value                                         AS observed_value,
    v.expected_value                                         AS expected_value,
    v.failed_record_count                                    AS failed_record_count,
    v.message                                                AS message,
    v.evaluated_at                                           AS evaluated_at,
    (v.pipeline_run_id = max(v.pipeline_run_id) OVER (PARTITION BY v.check_id))
                                                             AS is_latest_run_for_check
FROM audit.validation_result AS v
JOIN audit.pipeline_run AS r
  ON r.pipeline_run_id = v.pipeline_run_id;

COMMENT ON VIEW reporting.vw_data_quality_summary IS
    'Grain: one row per validation result (audit.validation_result), joined to its pipeline run. The '
    'detail counterpart to reporting.vw_pipeline_run_summary: which check, on which object, with what '
    'observed and expected values. Filter on is_latest_run_for_check for current data-quality state.';

COMMENT ON COLUMN reporting.vw_data_quality_summary.validation_result_id IS 'Identifier of the individual check evaluation.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.pipeline_run_id IS 'Run the check was evaluated in. Join key to reporting.vw_pipeline_run_summary.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.run_uuid IS 'UUID of the run; correlates with log output.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.pipeline_name IS 'Logical pipeline that executed the check.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.profile_name IS 'ARPI configuration profile the run used.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.run_status IS 'Overall status of the run the check belongs to.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.run_started_at IS 'UTC instant the run began. Use this to order results by run.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.check_id IS 'Stable check identifier such as DQ-DATE-001. Identical in Python and in sql/08_validation.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.check_name IS 'Human-readable check name.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.check_category IS
    'One of exactly seven canonical categories: structural, completeness, uniqueness, referential, '
    'business_rule, privacy, reproducibility. Constrained on audit.validation_result, so a '
    '"checks by category" breakdown groups one taxonomy rather than several.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.target_object IS 'Fully qualified object the check was evaluated against.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.severity IS 'critical | warning | info.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.check_status IS 'passed | failed | skipped.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.is_failed IS 'Convenience flag: the check failed at any severity.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.is_critical_failure IS 'Convenience flag: the check failed at critical severity and therefore fails the run.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.observed_value IS 'Numeric value observed, or NULL when the check is not numeric.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.expected_value IS 'Numeric value expected or the boundary tested, or NULL when not applicable.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.failed_record_count IS 'Number of records that violated the rule; 0 when the check passed.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.message IS 'Human-readable explanation of the outcome.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.evaluated_at IS 'UTC instant the check ran.';
COMMENT ON COLUMN reporting.vw_data_quality_summary.is_latest_run_for_check IS 'True on the most recent evaluation of this check_id across all runs. Filter on it to see current state.';
