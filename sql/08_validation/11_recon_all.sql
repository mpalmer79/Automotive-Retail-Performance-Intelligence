-- =============================================================================
-- File:            sql/08_validation/11_recon_all.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Union every SQL reconciliation into one object and provide the recorder that persists them against a pipeline run.
-- Execution order: Validation layer, last of the reconciliation scripts.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW and CREATE OR REPLACE FUNCTION. Evaluating the view writes nothing; the recorder replaces its own rows for the given run rather than appending.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql. EXECUTE granted to arpi_loader.
-- Grain:           audit.vw_recon_all: one row per SQL reconciliation rule.
-- =============================================================================
--
-- THE SINGLE OBJECT AN OPERATOR READS
-- -----------------------------------
--     SELECT reconciliation_id, status, description
--     FROM audit.vw_recon_all
--     WHERE status = 'failed'
--     ORDER BY reconciliation_id;
--
-- WHY THE RECORDER REPLACES RATHER THAN APPENDS
-- ---------------------------------------------
-- A run's run_uuid is derived from its parameters, so re-running the pipeline with
-- the same parameters is the SAME logical run executed again, not a new one. The
-- Python loader already replaces its own child audit rows on that basis. This
-- function does the same for the rows it owns, scoped by reconciliation_id, so the
-- audit trail describes the most recent execution instead of accumulating a
-- duplicate set on every rerun. Rows written by the loader carry different
-- identifiers and are never touched; rows of other runs are never touched.
--
-- WITHOUT THIS, RECONCILIATIONS WOULD NOT BE RECORDED AT ALL
-- ---------------------------------------------------------
-- The reconciliation views are declarative: evaluating one produces a verdict and
-- writes nothing. A verdict nobody persisted is not evidence, so the loader calls
-- this function on every database run, immediately after it writes the audit rows.
-- That is what makes "every reconciliation records a result on every applicable
-- run" true rather than aspirational.

CREATE OR REPLACE VIEW audit.vw_recon_all AS
SELECT * FROM audit.vw_recon_ingestion
UNION ALL
SELECT * FROM audit.vw_recon_gross
UNION ALL
SELECT * FROM audit.vw_recon_funnel
UNION ALL
SELECT * FROM audit.vw_recon_marketing
UNION ALL
SELECT * FROM audit.vw_recon_reporting;

COMMENT ON VIEW audit.vw_recon_all IS
    'Grain: one row per SQL reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'The single object an operator or the pipeline should read. Try: SELECT reconciliation_id, status, '
    'description FROM audit.vw_recon_all WHERE status = ''failed'' ORDER BY reconciliation_id. Evaluating '
    'this view writes nothing; audit.fn_record_all_reconciliations is what persists the verdicts against a '
    'run, and the loader calls it on every database run.';

-- -----------------------------------------------------------------------------
-- audit.fn_record_all_reconciliations -- persist the SQL reconciliations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.fn_record_all_reconciliations(p_pipeline_run_id bigint)
RETURNS integer
LANGUAGE plpgsql
AS $fn_record_all_reconciliations$
DECLARE
    v_recorded_count integer;
BEGIN
    IF p_pipeline_run_id IS NULL THEN
        RAISE EXCEPTION 'p_pipeline_run_id is required when recording reconciliations.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM audit.pipeline_run WHERE pipeline_run_id = p_pipeline_run_id) THEN
        RAISE EXCEPTION 'Unknown pipeline_run_id %. Insert the audit.pipeline_run row first.',
            p_pipeline_run_id;
    END IF;

    -- Replace only the rows this function owns. The loader's own reconciliations
    -- carry different identifiers and must survive; so must every other run's rows.
    DELETE FROM audit.reconciliation_result
    WHERE pipeline_run_id = p_pipeline_run_id
      AND reconciliation_id IN (SELECT reconciliation_id FROM audit.vw_recon_all);

    INSERT INTO audit.reconciliation_result (
        pipeline_run_id,
        reconciliation_id,
        description,
        left_source,
        left_value,
        right_source,
        right_value,
        tolerance,
        status,
        evaluated_at
    )
    SELECT
        p_pipeline_run_id,
        a.reconciliation_id,
        a.description,
        a.left_source,
        a.left_value,
        a.right_source,
        a.right_value,
        a.tolerance,
        a.status,
        now()
    FROM audit.vw_recon_all AS a;

    GET DIAGNOSTICS v_recorded_count = ROW_COUNT;
    RETURN v_recorded_count;
END
$fn_record_all_reconciliations$;

COMMENT ON FUNCTION audit.fn_record_all_reconciliations(bigint) IS
    'Evaluate every reconciliation in audit.vw_recon_all and record each verdict against the given '
    'pipeline run, returning the number of rows written. Replaces rather than appends: a rerun with '
    'identical parameters is the same logical run executed again, so its own rows are rewritten while the '
    'loader''s reconciliations and every other run''s rows are left untouched. Called by the ARPI loader '
    'on every database run, which is what makes "every reconciliation records a result on every '
    'applicable run" true rather than aspirational.';
