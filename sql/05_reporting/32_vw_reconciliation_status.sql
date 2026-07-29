-- =============================================================================
-- File:            sql/05_reporting/32_vw_reconciliation_status.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Expose every recorded reconciliation result, with its two sides, its tolerance and its criticality, through the reporting layer.
-- Execution order: Reporting layer, after the audit tables exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per recorded reconciliation result, that is one per pipeline run per reconciliation identifier.
-- =============================================================================
--
-- WHY THIS IS A REPORTING OBJECT
-- ------------------------------
-- Reconciliation is how ARPI proves its numbers rather than asserting them, and a
-- proof nobody can see is not evidence. audit.reconciliation_result is invisible to
-- arpi_reporter by design; this view is the sanctioned window onto it, so a
-- reviewer, an Excel workbook or a future Power BI Data Quality page can read the
-- reconciliation record without any privilege on the audit schema. A view executes
-- with its owner's privileges, and arpi_admin owns both sides.
--
-- BOTH SIDES ARE PUBLISHED
-- ------------------------
-- left_value and right_value are exposed, not just the verdict. Two compensating
-- errors can produce a passing difference, so a reader must be able to see the
-- numbers that were compared and where they came from. difference is stored as a
-- generated column on the audit table, so it cannot drift from its operands.
--
-- CRITICALITY
-- -----------
-- is_critical is derived here from the reconciliation identifier rather than stored,
-- because audit.reconciliation_result carries no criticality column and adding one
-- would change a published audit contract for a value that is a property of the
-- rule, not of the result. EVERY reconciliation is critical except
-- RECON-FUNNEL-CHAIN, which compares the product of four funnel rates against
-- lead-to-sale conversion. KPI_CATALOG.md describes that relationship as one the
-- chain "should approximate", and a gap means leads are converting by a path the
-- model does not capture -- a finding to explain, not a defect to fail on. No other
-- reconciliation carries an unexplained tolerance.
--
-- TOLERANCE
-- ---------
-- Recorded on every row. Zero means exact. The only non-zero tolerance in ARPI is
-- validation.numeric_absolute_tolerance (0.01), used where two currency figures are
-- compared to the cent.

CREATE OR REPLACE VIEW reporting.vw_reconciliation_status AS
SELECT
    c.reconciliation_result_id                                        AS reconciliation_result_id,
    r.pipeline_run_id                                                 AS pipeline_run_id,
    r.run_uuid                                                        AS run_uuid,
    r.pipeline_name                                                   AS pipeline_name,
    r.profile_name                                                    AS profile_name,
    r.started_at                                                      AS run_started_at,
    (r.started_at AT TIME ZONE 'UTC')::date                           AS run_date,
    r.status                                                          AS run_status,

    c.reconciliation_id                                               AS reconciliation_id,
    c.description                                                     AS description,
    c.left_source                                                     AS left_source,
    c.left_value                                                      AS left_value,
    c.right_source                                                    AS right_source,
    c.right_value                                                     AS right_value,
    c.difference                                                      AS difference,
    abs(c.difference)                                                 AS absolute_difference,
    c.tolerance                                                       AS tolerance,
    c.status                                                          AS status,
    (c.status = 'passed')                                             AS is_passing,
    (c.reconciliation_id <> 'RECON-FUNNEL-CHAIN')                     AS is_critical,
    CASE
        WHEN c.status = 'passed' THEN 0
        WHEN c.reconciliation_id = 'RECON-FUNNEL-CHAIN' THEN 1
        ELSE 2
    END                                                               AS severity_rank,
    c.evaluated_at                                                    AS evaluated_at
FROM audit.reconciliation_result AS c
JOIN audit.pipeline_run AS r
       ON r.pipeline_run_id = c.pipeline_run_id;

COMMENT ON VIEW reporting.vw_reconciliation_status IS
    'Grain: one row per recorded reconciliation result -- one per pipeline run per reconciliation '
    'identifier. The sanctioned window onto audit.reconciliation_result, which arpi_reporter holds no '
    'privilege on: a view executes with its owner''s privileges, so reconciliation evidence reaches a '
    'reviewer, an Excel workbook or a future Data Quality page without any grant on the audit schema. '
    'Both sides of every comparison are published, not just the verdict, because two compensating errors '
    'can produce a passing difference and a reader must be able to see the numbers and their sources. '
    'is_critical is derived from the identifier rather than stored -- criticality is a property of the '
    'rule, not of the result -- and every reconciliation is critical except RECON-FUNNEL-CHAIN, which '
    'compares a product of four funnel rates against lead-to-sale conversion and is a finding to explain '
    'rather than a defect to fail on. No other reconciliation carries an unexplained tolerance; the only '
    'non-zero tolerance in ARPI is 0.01, used where two currency figures are compared to the cent.';

COMMENT ON COLUMN reporting.vw_reconciliation_status.reconciliation_result_id IS 'Identifier of the recorded result.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.pipeline_run_id IS 'The run the result belongs to. Relationship column into vw_pipeline_run_summary.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.run_uuid IS 'Deterministic run identifier derived from the run parameters.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.pipeline_name IS 'Logical pipeline the run executed.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.profile_name IS 'Configuration profile: development, test or portfolio.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.run_started_at IS 'When the run started, with time zone.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.run_date IS 'UTC date of the run. The x-axis of a reconciliation trend.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.run_status IS 'Terminal status of the run.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.reconciliation_id IS 'Stable identifier of the rule, for example RECON-GROSS-001. Registered in KPI_CATALOG.md section 36.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.description IS 'What the rule compares, in words, including the observed figures where the recorder supplies them.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.left_source IS 'Where the left-hand figure came from.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.left_value IS 'The left-hand figure.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.right_source IS 'Where the right-hand figure came from.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.right_value IS 'The right-hand figure.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.difference IS 'left_value - right_value, stored as a generated column on the audit table so it cannot drift from its operands.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.absolute_difference IS 'Magnitude of the difference, for sorting the worst offenders to the top.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.tolerance IS 'The tolerance applied. Zero means exact. The only non-zero value in ARPI is 0.01, where two currency figures are compared to the cent.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.status IS 'passed or failed.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.is_passing IS 'Convenience flag so a report does not compare status strings.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.is_critical IS 'True for every reconciliation except RECON-FUNNEL-CHAIN. A failing critical reconciliation invalidates the numbers built on it.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.severity_rank IS '0 passing, 1 failing but informational, 2 failing and critical. Sort descending to surface what matters first.';
COMMENT ON COLUMN reporting.vw_reconciliation_status.evaluated_at IS 'When the result was recorded.';
