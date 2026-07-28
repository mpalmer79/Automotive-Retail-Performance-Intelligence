-- =============================================================================
-- File:            sql/08_validation/04_audit_checks.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement DQ-AUD-001 through DQ-AUD-005 (audit-layer integrity), expose the combined audit.vw_dq_all, and provide the recorder that persists every SQL check against a run.
-- Execution order: 24 of 25 — last script of the initialisation sequence proper; step 25 re-runs sql/07_security/01_grants.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW and CREATE OR REPLACE FUNCTION. Evaluating the views writes nothing; the recorder function writes only when explicitly called with a run id.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql. EXECUTE on the recorder granted to arpi_loader.
-- Grain:           audit.vw_dq_audit: one row per check (five rows). audit.vw_dq_all: one row per check across all four check views.
-- =============================================================================
--
-- Run it:     SELECT * FROM audit.vw_dq_audit ORDER BY check_id;
--             SELECT * FROM audit.vw_dq_all   ORDER BY check_id;
--
--   DQ-AUD-001  every audit.validation_result resolves to an audit.pipeline_run
--   DQ-AUD-002  every audit.rejected_record resolves to an audit.pipeline_run
--   DQ-AUD-003  every audit.pipeline_run_row_count resolves to an audit.pipeline_run
--   DQ-AUD-004  every audit.reconciliation_result resolves to an audit.pipeline_run
--   DQ-AUD-005  no run is internally inconsistent (finished before it started, or
--               finished while still marked running)
--
-- DQ-AUD-001 through DQ-AUD-004 duplicate guarantees that foreign keys already
-- enforce, on purpose. They are how ARPI proves the constraints are doing their
-- job: if one of these ever fails, either a foreign key was dropped or the audit
-- data was loaded around it. An audit trail that cannot be checked is not an
-- audit trail.

CREATE OR REPLACE VIEW audit.vw_dq_audit AS
WITH orphans AS (
    SELECT
        (SELECT count(*) FROM audit.validation_result AS v
          WHERE NOT EXISTS (SELECT 1 FROM audit.pipeline_run AS r
                             WHERE r.pipeline_run_id = v.pipeline_run_id))        AS orphan_validation_count,
        (SELECT count(*) FROM audit.validation_result)                            AS validation_count,
        (SELECT count(*) FROM audit.rejected_record AS x
          WHERE NOT EXISTS (SELECT 1 FROM audit.pipeline_run AS r
                             WHERE r.pipeline_run_id = x.pipeline_run_id))        AS orphan_rejected_count,
        (SELECT count(*) FROM audit.rejected_record)                              AS rejected_count,
        (SELECT count(*) FROM audit.pipeline_run_row_count AS c
          WHERE NOT EXISTS (SELECT 1 FROM audit.pipeline_run AS r
                             WHERE r.pipeline_run_id = c.pipeline_run_id))        AS orphan_row_count_count,
        (SELECT count(*) FROM audit.pipeline_run_row_count)                       AS row_count_count,
        (SELECT count(*) FROM audit.reconciliation_result AS q
          WHERE NOT EXISTS (SELECT 1 FROM audit.pipeline_run AS r
                             WHERE r.pipeline_run_id = q.pipeline_run_id))        AS orphan_reconciliation_count,
        (SELECT count(*) FROM audit.reconciliation_result)                        AS reconciliation_count,
        (SELECT count(*) FROM audit.pipeline_run)                                 AS run_count,
        (SELECT count(*) FROM audit.pipeline_run AS r
          WHERE (r.completed_at IS NOT NULL AND r.completed_at < r.started_at)
             OR (r.completed_at IS NOT NULL AND r.status = 'running')
             OR (r.completed_at IS NULL AND r.status <> 'running'))               AS inconsistent_run_count
)

-- DQ-AUD-001 --------------------------------------------------------------
SELECT
    'DQ-AUD-001'::text                                                        AS check_id,
    'every validation_result resolves to a pipeline_run'::text                AS check_name,
    'referential'::text                                                       AS check_category,
    'audit.validation_result'::text                                           AS target_object,
    'critical'::text                                                          AS severity,
    CASE
        WHEN o.validation_count = 0 THEN 'skipped'
        WHEN o.orphan_validation_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text                                                                 AS status,
    o.orphan_validation_count::numeric                                        AS observed_value,
    0::numeric                                                                AS expected_value,
    o.orphan_validation_count::bigint                                         AS failed_record_count,
    CASE
        WHEN o.validation_count = 0 THEN 'audit.validation_result is empty; referential integrity not evaluated.'
        WHEN o.orphan_validation_count = 0
            THEN format('All %s validation results resolve to a pipeline run.', o.validation_count)
        ELSE format('%s of %s validation results reference a pipeline_run_id that does not exist. '
                    'fk_validation_result_pipeline_run should make this impossible.',
                    o.orphan_validation_count, o.validation_count)
    END::text                                                                 AS message
FROM orphans AS o

UNION ALL

-- DQ-AUD-002 --------------------------------------------------------------
SELECT
    'DQ-AUD-002'::text,
    'every rejected_record resolves to a pipeline_run'::text,
    'referential'::text,
    'audit.rejected_record'::text,
    'critical'::text,
    CASE
        WHEN o.rejected_count = 0 THEN 'skipped'
        WHEN o.orphan_rejected_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    o.orphan_rejected_count::numeric,
    0::numeric,
    o.orphan_rejected_count::bigint,
    CASE
        WHEN o.rejected_count = 0 THEN 'audit.rejected_record is empty; referential integrity not evaluated.'
        WHEN o.orphan_rejected_count = 0
            THEN format('All %s rejected records resolve to a pipeline run.', o.rejected_count)
        ELSE format('%s of %s rejected records reference a pipeline_run_id that does not exist.',
                    o.orphan_rejected_count, o.rejected_count)
    END::text
FROM orphans AS o

UNION ALL

-- DQ-AUD-003 --------------------------------------------------------------
SELECT
    'DQ-AUD-003'::text,
    'every pipeline_run_row_count resolves to a pipeline_run'::text,
    'referential'::text,
    'audit.pipeline_run_row_count'::text,
    'critical'::text,
    CASE
        WHEN o.row_count_count = 0 THEN 'skipped'
        WHEN o.orphan_row_count_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    o.orphan_row_count_count::numeric,
    0::numeric,
    o.orphan_row_count_count::bigint,
    CASE
        WHEN o.row_count_count = 0 THEN 'audit.pipeline_run_row_count is empty; referential integrity not evaluated.'
        WHEN o.orphan_row_count_count = 0
            THEN format('All %s row-count records resolve to a pipeline run.', o.row_count_count)
        ELSE format('%s of %s row-count records reference a pipeline_run_id that does not exist.',
                    o.orphan_row_count_count, o.row_count_count)
    END::text
FROM orphans AS o

UNION ALL

-- DQ-AUD-004 --------------------------------------------------------------
SELECT
    'DQ-AUD-004'::text,
    'every reconciliation_result resolves to a pipeline_run'::text,
    'referential'::text,
    'audit.reconciliation_result'::text,
    'critical'::text,
    CASE
        WHEN o.reconciliation_count = 0 THEN 'skipped'
        WHEN o.orphan_reconciliation_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    o.orphan_reconciliation_count::numeric,
    0::numeric,
    o.orphan_reconciliation_count::bigint,
    CASE
        WHEN o.reconciliation_count = 0 THEN 'audit.reconciliation_result is empty; referential integrity not evaluated.'
        WHEN o.orphan_reconciliation_count = 0
            THEN format('All %s reconciliation results resolve to a pipeline run.', o.reconciliation_count)
        ELSE format('%s of %s reconciliation results reference a pipeline_run_id that does not exist.',
                    o.orphan_reconciliation_count, o.reconciliation_count)
    END::text
FROM orphans AS o

UNION ALL

-- DQ-AUD-005 --------------------------------------------------------------
SELECT
    'DQ-AUD-005'::text,
    'pipeline_run status and timestamps are internally consistent'::text,
    'business_rule'::text,
    'audit.pipeline_run'::text,
    'warning'::text,
    CASE
        WHEN o.run_count = 0 THEN 'skipped'
        WHEN o.inconsistent_run_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    o.inconsistent_run_count::numeric,
    0::numeric,
    o.inconsistent_run_count::bigint,
    CASE
        WHEN o.run_count = 0 THEN 'audit.pipeline_run is empty; run consistency not evaluated.'
        WHEN o.inconsistent_run_count = 0
            THEN format('All %s runs are internally consistent: a finished run has a completion timestamp '
                        'at or after its start and a terminal status.', o.run_count)
        ELSE format('%s of %s runs are inconsistent: finished before starting, completed while still '
                    'marked running, or carrying a terminal status with no completion timestamp. Usually '
                    'means the process died without updating its run row.',
                    o.inconsistent_run_count, o.run_count)
    END::text
FROM orphans AS o;

COMMENT ON VIEW audit.vw_dq_audit IS
    'Grain: one row per check (DQ-AUD-001..005), in the uniform shape of audit.vw_dq_result_template. '
    'Audit-layer integrity: every child audit row resolves to a pipeline run, and every run is '
    'internally consistent. The referential checks intentionally duplicate foreign keys so that a '
    'dropped constraint is detected rather than assumed absent.';

-- -----------------------------------------------------------------------------
-- audit.vw_dq_all — every SQL data-quality check in one place.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW audit.vw_dq_all AS
SELECT * FROM audit.vw_dq_dim_date
UNION ALL
SELECT * FROM audit.vw_dq_dim_dealership
UNION ALL
SELECT * FROM audit.vw_dq_referential
UNION ALL
SELECT * FROM audit.vw_dq_audit;

COMMENT ON VIEW audit.vw_dq_all IS
    'Grain: one row per SQL data-quality check across all four check views (DQ-DATE-*, DQ-DLR-*, '
    'DQ-REF-*, DQ-AUD-*), in the uniform shape of audit.vw_dq_result_template. The single object an '
    'operator or the pipeline should read. Try: SELECT check_id, status, message FROM audit.vw_dq_all '
    'WHERE status = ''failed'' ORDER BY check_id;';

-- -----------------------------------------------------------------------------
-- audit.fn_record_all_dq_checks — persist the SQL checks against a run.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.fn_record_all_dq_checks(p_pipeline_run_id bigint)
RETURNS integer
LANGUAGE plpgsql
AS $fn_record_all_dq_checks$
DECLARE
    v_recorded_count integer;
BEGIN
    IF p_pipeline_run_id IS NULL THEN
        RAISE EXCEPTION 'p_pipeline_run_id is required when recording data-quality checks.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM audit.pipeline_run WHERE pipeline_run_id = p_pipeline_run_id) THEN
        RAISE EXCEPTION 'Unknown pipeline_run_id %. Insert the audit.pipeline_run row first.', p_pipeline_run_id;
    END IF;

    INSERT INTO audit.validation_result (
        pipeline_run_id,
        check_id,
        check_name,
        check_category,
        target_object,
        severity,
        status,
        observed_value,
        expected_value,
        failed_record_count,
        message,
        evaluated_at
    )
    SELECT
        p_pipeline_run_id,
        a.check_id,
        a.check_name,
        a.check_category,
        a.target_object,
        a.severity,
        a.status,
        a.observed_value,
        a.expected_value,
        a.failed_record_count,
        a.message,
        now()
    FROM audit.vw_dq_all AS a;

    GET DIAGNOSTICS v_recorded_count = ROW_COUNT;
    RETURN v_recorded_count;
END
$fn_record_all_dq_checks$;

COMMENT ON FUNCTION audit.fn_record_all_dq_checks(bigint) IS
    'Evaluate every SQL data-quality check in audit.vw_dq_all and record each result against the given '
    'pipeline run, returning the number of results written. Complements the Python validation framework; '
    'running both is intentional, because agreement between two independent implementations of the same '
    'check identifier is itself evidence.';
