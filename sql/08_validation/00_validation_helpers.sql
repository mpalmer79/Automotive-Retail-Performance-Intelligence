-- =============================================================================
-- File:            sql/08_validation/00_validation_helpers.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Define the uniform data-quality result shape and the function that records a result against a pipeline run.
-- Execution order: 20 of 25 — after the audit tables exist and before the individual check scripts.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE FUNCTION and CREATE OR REPLACE VIEW; no data is written by this script.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql. EXECUTE granted to arpi_loader.
-- Grain:           n/a (helper definitions). The empty template view declares the shape every check view must return.
-- =============================================================================
--
-- THE UNIFORM RESULT SHAPE
-- ------------------------
-- Every SQL data-quality check in sql/08_validation returns exactly these ten
-- columns, in this order and with these types:
--
--     check_id             text     stable identifier, e.g. DQ-DATE-001
--     check_name           text     human-readable name
--     check_category       text     structural | completeness | uniqueness |
--                                   referential | business_rule | privacy |
--                                   reproducibility
--     target_object        text     fully qualified object under test
--     severity             text     critical | warning | info
--     status               text     passed | failed | skipped
--     observed_value       numeric  what was measured, or NULL
--     expected_value       numeric  what was required, or NULL
--     failed_record_count  bigint   offending record count, 0 when passing
--     message              text     explanation for a human
--
-- The shape is identical to the business columns of audit.validation_result, so a
-- check result can be recorded with a plain INSERT ... SELECT. The check
-- identifiers are shared verbatim with the Python validation framework, so a
-- given rule has one identity whether it is evaluated in pandas or in SQL.
--
-- CATEGORY VOCABULARY
-- -------------------
-- There are EXACTLY seven categories, and they are the same seven in Python, in SQL
-- and in the database. They are defined once as CHECK_CATEGORIES in
-- src/arpi/constants.py, enforced by ck_validation_result_check_category on
-- audit.validation_result, and registered per check in src/arpi/validation/registry.py.
-- A check view that emits any other spelling will be rejected on INSERT rather than
-- quietly adding a fifth vocabulary, which is how the earlier drift happened (DOC-24).
-- `reconciliation` is not a category: reconciliations use audit.reconciliation_result.
--
-- STATUS SEMANTICS
-- ----------------
--   passed   the rule was evaluated and holds
--   failed   the rule was evaluated and is violated
--   skipped  the rule could not be meaningfully evaluated, essentially always
--            because the target object holds no rows. A check over an empty table
--            must never report `passed` (that would claim evidence nobody has)
--            and must never report `failed` (an empty table before the first load
--            is normal). This is why the whole initialisation sequence can run
--            against an empty database and still produce an honest report.

-- -----------------------------------------------------------------------------
-- Template view: the canonical, executable definition of the result shape.
-- It returns no rows; its purpose is to fix the column names and types in one
-- place so a check view can be diffed against it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW audit.vw_dq_result_template AS
SELECT
    NULL::text     AS check_id,
    NULL::text     AS check_name,
    NULL::text     AS check_category,
    NULL::text     AS target_object,
    NULL::text     AS severity,
    NULL::text     AS status,
    NULL::numeric  AS observed_value,
    NULL::numeric  AS expected_value,
    NULL::bigint   AS failed_record_count,
    NULL::text     AS message
WHERE false;

COMMENT ON VIEW audit.vw_dq_result_template IS
    'Grain: none - always returns zero rows. Executable specification of the uniform data-quality result '
    'shape that every audit.vw_dq_* view must return, in this column order and with these types. Compare '
    'a new check view against it with: SELECT * FROM audit.vw_dq_result_template UNION ALL SELECT * FROM '
    'audit.vw_dq_my_new_check; a type or arity mismatch fails immediately.';

-- -----------------------------------------------------------------------------
-- audit.fn_record_validation_result
-- Record one evaluated check against a pipeline run.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.fn_record_validation_result(
    p_pipeline_run_id      bigint,
    p_check_id             text,
    p_check_name           text,
    p_check_category       text,
    p_target_object        text,
    p_severity             text,
    p_status               text,
    p_observed_value       numeric DEFAULT NULL,
    p_expected_value       numeric DEFAULT NULL,
    p_failed_record_count  bigint  DEFAULT 0,
    p_message              text    DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $fn_record_validation_result$
DECLARE
    v_validation_result_id bigint;
BEGIN
    -- Fail fast and legibly rather than surfacing a raw check-constraint error
    -- from three call frames away.
    IF p_pipeline_run_id IS NULL THEN
        RAISE EXCEPTION 'p_pipeline_run_id is required when recording a validation result.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM audit.pipeline_run WHERE pipeline_run_id = p_pipeline_run_id) THEN
        RAISE EXCEPTION 'Unknown pipeline_run_id %. Insert the audit.pipeline_run row first.', p_pipeline_run_id;
    END IF;

    IF p_severity IS NULL OR p_severity NOT IN ('critical', 'warning', 'info') THEN
        RAISE EXCEPTION 'Invalid severity %. Expected critical, warning or info.', coalesce(p_severity, '<null>');
    END IF;

    IF p_status IS NULL OR p_status NOT IN ('passed', 'failed', 'skipped') THEN
        RAISE EXCEPTION 'Invalid status %. Expected passed, failed or skipped.', coalesce(p_status, '<null>');
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
    VALUES (
        p_pipeline_run_id,
        p_check_id,
        p_check_name,
        p_check_category,
        p_target_object,
        p_severity,
        p_status,
        p_observed_value,
        p_expected_value,
        coalesce(p_failed_record_count, 0),
        p_message,
        now()
    )
    RETURNING validation_result_id INTO v_validation_result_id;

    RETURN v_validation_result_id;
END
$fn_record_validation_result$;

COMMENT ON FUNCTION audit.fn_record_validation_result(bigint, text, text, text, text, text, text, numeric, numeric, bigint, text) IS
    'Record one evaluated data-quality check against a pipeline run and return the new '
    'audit.validation_result_id. Validates pipeline_run_id, severity and status up front so a caller gets '
    'a readable error instead of a raw constraint violation. Called by the Python validation framework '
    'and by audit.fn_record_all_dq_checks (see sql/08_validation/04_audit_checks.sql).';
