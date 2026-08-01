-- =============================================================================
-- File:            sql/05_reporting/03_vw_pipeline_run_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         One-row-per-run operational summary of every ARPI pipeline execution, with per-layer row counts and validation counts.
-- Execution order: 15 of 25 — after the audit tables exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per audit.pipeline_run row (one per pipeline execution).
-- =============================================================================
--
-- This view is the answer to "did the last load work, and did anything change?".
-- It satisfies the run-report requirement in ARCHITECTURE.md section 21.4: run id,
-- start and completion timestamp, source/staging/warehouse/rejected row counts,
-- warning count, failed test count and reconciliation status, all on one line.
--
-- Row counts are pivoted out of audit.pipeline_run_row_count with FILTER, which
-- keeps the whole thing a single scan and returns NULL (not zero) for a layer the
-- run never reported. NULL means "not measured"; 0 means "measured and empty" —
-- an important distinction when diagnosing a load that silently did nothing.

CREATE OR REPLACE VIEW reporting.vw_pipeline_run_summary AS
SELECT
    r.pipeline_run_id                                              AS pipeline_run_id,
    r.run_uuid                                                     AS run_uuid,
    r.pipeline_name                                                AS pipeline_name,
    r.profile_name                                                 AS profile_name,
    r.run_mode                                                     AS run_mode,
    r.arpi_version                                                 AS arpi_version,
    r.random_seed                                                  AS random_seed,
    r.status                                                       AS run_status,
    r.started_at                                                   AS started_at,
    r.completed_at                                                 AS completed_at,
    round(EXTRACT(EPOCH FROM (r.completed_at - r.started_at))::numeric, 3)
                                                                   AS duration_seconds,
    rc.source_row_count                                            AS source_row_count,
    rc.raw_row_count                                               AS raw_row_count,
    rc.staging_row_count                                           AS staging_row_count,
    rc.warehouse_row_count                                         AS warehouse_row_count,
    rc.rejected_row_count                                          AS rejected_row_count,
    coalesce(v.check_count, 0)                                     AS validation_check_count,
    coalesce(v.passed_count, 0)                                    AS validation_passed_count,
    coalesce(v.failed_count, 0)                                    AS validation_failed_count,
    coalesce(v.skipped_count, 0)                                   AS validation_skipped_count,
    coalesce(v.critical_failed_count, 0)                           AS critical_failed_check_count,
    r.critical_failure_count                                       AS reported_critical_failure_count,
    r.warning_count                                                AS reported_warning_count,
    coalesce(rj.rejected_record_count, 0)                          AS rejected_record_count,
    coalesce(rec.reconciliation_count, 0)                          AS reconciliation_count,
    coalesce(rec.reconciliation_failed_count, 0)                   AS reconciliation_failed_count,
    CASE
        WHEN coalesce(rec.reconciliation_count, 0) = 0            THEN 'not evaluated'
        WHEN coalesce(rec.reconciliation_failed_count, 0) = 0     THEN 'passed'
        ELSE 'failed'
    END                                                            AS reconciliation_status,
    r.notes                                                        AS notes
FROM audit.pipeline_run AS r
LEFT JOIN LATERAL (
    SELECT
        max(c.row_count) FILTER (WHERE c.layer = 'source')    AS source_row_count,
        max(c.row_count) FILTER (WHERE c.layer = 'raw')       AS raw_row_count,
        max(c.row_count) FILTER (WHERE c.layer = 'staging')   AS staging_row_count,
        max(c.row_count) FILTER (WHERE c.layer = 'warehouse') AS warehouse_row_count,
        max(c.row_count) FILTER (WHERE c.layer = 'rejected')  AS rejected_row_count
    FROM audit.pipeline_run_row_count AS c
    WHERE c.pipeline_run_id = r.pipeline_run_id
) AS rc ON true
LEFT JOIN LATERAL (
    SELECT
        count(*)                                                                   AS check_count,
        count(*) FILTER (WHERE vr.status = 'passed')                               AS passed_count,
        count(*) FILTER (WHERE vr.status = 'failed')                               AS failed_count,
        count(*) FILTER (WHERE vr.status = 'skipped')                              AS skipped_count,
        count(*) FILTER (WHERE vr.status = 'failed' AND vr.severity = 'critical')  AS critical_failed_count
    FROM audit.validation_result AS vr
    WHERE vr.pipeline_run_id = r.pipeline_run_id
) AS v ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS rejected_record_count
    FROM audit.rejected_record AS rr
    WHERE rr.pipeline_run_id = r.pipeline_run_id
) AS rj ON true
LEFT JOIN LATERAL (
    SELECT
        count(*)                                        AS reconciliation_count,
        count(*) FILTER (WHERE re.status = 'failed')    AS reconciliation_failed_count
    FROM audit.reconciliation_result AS re
    WHERE re.pipeline_run_id = r.pipeline_run_id
) AS rec ON true;

COMMENT ON VIEW reporting.vw_pipeline_run_summary IS
    'Grain: one row per pipeline run (audit.pipeline_run). Operational summary satisfying '
    'ARCHITECTURE.md section 21.4: identity, timing, per-layer row counts, validation counts, rejected '
    'record count and reconciliation status. A NULL row count means the layer was never measured; 0 means '
    'it was measured and empty.';

COMMENT ON COLUMN reporting.vw_pipeline_run_summary.pipeline_run_id IS 'Run identifier. Join key to reporting.vw_data_quality_summary.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.run_uuid IS 'Execution identity: a random UUID generated once per execution attempt and never reused; correlates database rows with log output. Equivalent reruns are grouped by audit.pipeline_run.logical_run_key, not by this column. See ADR-0010.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.pipeline_name IS 'Logical pipeline that executed.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.profile_name IS 'ARPI configuration profile: development, test or portfolio.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.run_mode IS 'How the run was invoked, for example cli or ci.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.arpi_version IS 'Version of the arpi distribution that produced the run.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.random_seed IS 'Generator seed. Two runs with the same seed and profile must produce identical data.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.run_status IS 'running | succeeded | failed | aborted.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.started_at IS 'UTC instant the run began.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.completed_at IS 'UTC instant the run finished; NULL while still running.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.duration_seconds IS 'Wall-clock run duration in seconds to millisecond precision; NULL while still running.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.source_row_count IS 'Rows read from source files. NULL if never measured.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.raw_row_count IS 'Rows landed in the raw layer. NULL if never measured.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.staging_row_count IS 'Rows visible in the staging layer. NULL if never measured.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.warehouse_row_count IS 'Rows present in the warehouse layer after the merge. NULL if never measured.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.rejected_row_count IS 'Rows rejected, as reported by the pipeline. NULL if never measured.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.validation_check_count IS 'Number of data-quality checks evaluated during the run.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.validation_passed_count IS 'Checks that passed.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.validation_failed_count IS 'Checks that failed at any severity.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.validation_skipped_count IS 'Checks skipped, normally because the target object held no rows.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.critical_failed_check_count IS 'Failed checks with critical severity, counted from audit.validation_result.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.reported_critical_failure_count IS 'Critical failure count as recorded on the run row by the pipeline itself. Should equal critical_failed_check_count; a mismatch means the pipeline stopped early.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.reported_warning_count IS 'Warning count as recorded on the run row by the pipeline itself.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.rejected_record_count IS 'Rows actually written to audit.rejected_record for the run.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.reconciliation_count IS 'Number of reconciliations evaluated during the run.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.reconciliation_failed_count IS 'Number of reconciliations that failed.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.reconciliation_status IS 'passed | failed | not evaluated. Never claims success when no reconciliation ran.';
COMMENT ON COLUMN reporting.vw_pipeline_run_summary.notes IS 'Free-text operator note captured on the run.';
