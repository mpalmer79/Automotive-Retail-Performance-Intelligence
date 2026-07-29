-- =============================================================================
-- File:            sql/08_validation/05_reconciliation_helpers.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Define the uniform reconciliation result shape that every audit.vw_recon_* view must return.
-- Execution order: Validation layer, after the audit tables exist and before the individual reconciliation views.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; no data is written by this script.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           n/a (helper definition). The empty template view declares the shape every reconciliation view must return.
-- =============================================================================
--
-- WHY RECONCILIATION IS A SEPARATE MECHANISM FROM DATA QUALITY
-- ------------------------------------------------------------
-- A data-quality check asks "is this value legal?" and answers from one object. A
-- reconciliation asks "do these two independently derived numbers agree?" and
-- answers from two. They are different kinds of evidence, they have different
-- shapes, and ARPI keeps them in different tables: audit.validation_result and
-- audit.reconciliation_result. `reconciliation` is deliberately NOT one of the
-- seven data-quality categories.
--
-- THE UNIFORM RESULT SHAPE
-- ------------------------
-- Every reconciliation view returns exactly these eight columns, in this order and
-- with these types:
--
--     reconciliation_id  text     stable identifier, e.g. RECON-GROSS-001
--     description        text     what was compared, including the observed figures
--     left_source        text     where the left-hand number came from
--     left_value         numeric  the left-hand number
--     right_source       text     where the right-hand number came from
--     right_value        numeric  the right-hand number
--     tolerance          numeric  permitted absolute difference; 0 means exact
--     status             text     passed | failed
--
-- The shape matches the business columns of audit.reconciliation_result, so a
-- result can be recorded with a plain INSERT ... SELECT. `difference` is not in the
-- shape because the audit table computes it as a generated column from left_value
-- and right_value, which is the only way the two can never drift apart.
--
-- TOLERANCE POLICY
-- ----------------
-- A tolerance is a claim about what difference is acceptable, so an unexplained one
-- is a hole in the evidence. ARPI permits exactly two values:
--
--   0        exact. Every count-based and identity-based reconciliation uses this.
--   0.01     validation.numeric_absolute_tolerance, the project-wide currency
--            tolerance, used only where two monetary figures are compared to the
--            cent or where a rate is compared across a documented grain shift.
--
-- Any view adding a third value must state its reason in the row's description as
-- well as here, and tests/integration/test_reconciliations.py asserts that no other
-- value appears.
--
-- STATUS
-- ------
-- audit.reconciliation_result permits only 'passed' and 'failed'. There is no
-- 'skipped': a reconciliation over an empty population compares 0 with 0 and
-- passes, which is honest -- nothing was lost between two empty sets -- while the
-- accompanying data-quality check is what reports that the population was empty.

CREATE OR REPLACE VIEW audit.vw_recon_result_template AS
SELECT
    NULL::text     AS reconciliation_id,
    NULL::text     AS description,
    NULL::text     AS left_source,
    NULL::numeric  AS left_value,
    NULL::text     AS right_source,
    NULL::numeric  AS right_value,
    NULL::numeric  AS tolerance,
    NULL::text     AS status
WHERE false;

COMMENT ON VIEW audit.vw_recon_result_template IS
    'Grain: none - always returns zero rows. Executable specification of the uniform reconciliation result '
    'shape that every audit.vw_recon_* view must return, in this column order and with these types. '
    'Compare a new reconciliation view against it with: SELECT * FROM audit.vw_recon_result_template '
    'UNION ALL SELECT * FROM audit.vw_recon_my_new_rule; a type or arity mismatch fails immediately. '
    'difference is absent on purpose -- audit.reconciliation_result generates it from left_value and '
    'right_value so the two can never drift apart. ARPI permits exactly two tolerance values: 0 for every '
    'count and identity comparison, and 0.01 (validation.numeric_absolute_tolerance) where two monetary '
    'figures are compared to the cent or a rate crosses a documented grain shift.';
