-- =============================================================================
-- File:            sql/05_reporting/51_vw_accounting_exceptions.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_accounting_exceptions — one row per accounting control exception, over a closed code vocabulary, with a stable identifier so a single defect is reported once.
-- Execution order: Reporting layer, after reporting.vw_inventory_gl_reconciliation and reporting.vw_data_quality_summary exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per exception: (exception_code, entity_name, entity_key), published as exception_id.
-- =============================================================================
--
-- Delivery increment: DASH.8. Anchoring question SQ-43.
--
-- A RECONCILIATION VARIANCE AND A DATA-QUALITY EXCEPTION ARE DIFFERENT THINGS
-- ---------------------------------------------------------------------------
-- Both appear here, and they must not be read as the same finding.
--
--   A RECONCILIATION VARIANCE (ACC-GL-VARIANCE) means two structurally VALID balances
--   were compared and did not agree. Nothing is broken. Somebody has to find out why.
--
--   A DATA-QUALITY EXCEPTION (every other code here) means a rule the model asserts about
--   itself does not hold: an identity that must balance does not, a record that must
--   exist does not, a check that must pass did not.
--
-- exception_code is what separates them, and no consumer may total the two into a single
-- "problems" figure. KPI-ACC-003 counts variances. KPI-ACC-012 counts data-quality
-- exceptions. There is deliberately no KPI that adds them together.
--
-- ONE DEFECT, ONE ROW
-- -------------------
-- exception_id is exception_code || ':' || entity_name || ':' || entity_key, and it is the
-- declared grain. Every branch below is scoped to one control QUESTION about one entity,
-- so a single physical defect cannot be counted twice by two branches that noticed it.
-- RECON-REPORT-EXCEPTION-GRAIN is not needed for this because uniqueness is provable
-- directly from the branch scopes, and tests/integration asserts it on every run.
--
-- MISSING BALANCES ARE EXCEPTIONS WITH NO AMOUNT
-- -----------------------------------------------
-- ACC-MISSING-GL-BALANCE and ACC-MISSING-SUBLEDGER-BALANCE carry exception_amount NULL,
-- not 0.00 and not the balance of the side that IS present. The absent side has no value,
-- and reporting the present side as though it were the variance would state a number
-- nobody computed.
--
-- TWO BRANCHES ARE UNREACHABLE WHILE THEIR FOREIGN KEYS STAND, AND THAT IS THE POINT
-- ----------------------------------------------------------------------------------
-- ACC-ORPHAN-FI-PRODUCT and ACC-ORPHAN-FI-ADJUSTMENT look for a child row whose parent
-- does not resolve. fk_fact_finance_product_sale_sale and
-- fk_fact_finance_product_adjustment_product_sale make that impossible in a database whose
-- constraints are intact, so both branches return zero rows on every healthy run.
--
-- They are written anyway, as LEFT JOINs with an IS NULL test, for the same reason
-- RECON-FI-RESERVE-STRUCTURE re-asks a CHECK over the whole table: a constraint dropped
-- from a DEPLOYED database must fail a run rather than pass one. A control surface that
-- only asks questions the schema already answers proves nothing about the schema it is
-- deployed against.
--
-- WHAT IS DELIBERATELY NOT HERE
-- ------------------------------
-- No journal entry, no suspense account, no aged-trial-balance bucket, no period-close
-- state, no approval or sign-off workflow, and no remediation status. ARPI builds a
-- focused inventory control schedule and its reconciliation; it does not build a general
-- ledger, and it does not build a close-management application.
--
-- EXPORT BOUNDARY: DASH.8 exports NO browser dataset from this view.
--
-- PRIVACY: no personal data. An exception names a store, an entity and a date.

CREATE OR REPLACE VIEW reporting.vw_accounting_exceptions AS

-- ACC-GL-VARIANCE -- two valid balances compared, and they disagree -------------------
SELECT
    'ACC-GL-VARIANCE:gl_reconciliation:'
        || r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key
                                                     AS exception_id,
    'ACC-GL-VARIANCE'::varchar(40)                   AS exception_code,
    'gl_reconciliation'::varchar(40)                 AS entity_name,
    (r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key)::varchar(64)
                                                     AS entity_key,
    r.dealership_key                                 AS dealership_key,
    r.comparison_date_key                            AS exception_date_key,
    r.variance_amount                                AS exception_amount,
    format('%s at %s on date key %s: GL balance %s against subledger balance %s, signed variance %s. '
           'BOTH SIDES ARE VALID DATA. Positive means the control account carries more than the stock '
           'schedule supports; negative means the schedule carries more than the account. This is a '
           'reconciliation finding to investigate, not a broken record.',
           r.gl_account_name, r.store_name, r.comparison_date_key,
           r.gl_balance, r.subledger_balance, r.variance_amount)::text
                                                     AS exception_detail,
    1::integer                                       AS exception_count
FROM reporting.vw_inventory_gl_reconciliation AS r
WHERE r.comparison_state = 'Variance'

UNION ALL

-- ACC-MISSING-GL-BALANCE -- a schedule with no control account balance to compare ------
SELECT
    'ACC-MISSING-GL-BALANCE:gl_reconciliation:'
        || r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key,
    'ACC-MISSING-GL-BALANCE',
    'gl_reconciliation',
    (r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key)::varchar(64),
    r.dealership_key,
    r.comparison_date_key,
    -- NULL, not the subledger balance. No variance was computed, so none is reported.
    NULL::numeric,
    format('%s at %s on date key %s: the stock schedule carries %s over %s unit(s) and NO control '
           'account balance exists to compare it against. The variance is NULL, not the full '
           'subledger balance: a missing balance is not a zeroed account.',
           r.gl_account_name, r.store_name, r.comparison_date_key,
           r.subledger_balance, r.stock_unit_count),
    1
FROM reporting.vw_inventory_gl_reconciliation AS r
WHERE r.comparison_state = 'Missing GL balance'

UNION ALL

-- ACC-MISSING-SUBLEDGER-BALANCE -- a control balance with no schedule behind it --------
SELECT
    'ACC-MISSING-SUBLEDGER-BALANCE:gl_reconciliation:'
        || r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key,
    'ACC-MISSING-SUBLEDGER-BALANCE',
    'gl_reconciliation',
    (r.comparison_date_key || '-' || r.dealership_key || '-' || r.gl_account_key)::varchar(64),
    r.dealership_key,
    r.comparison_date_key,
    NULL::numeric,
    format('%s at %s on date key %s: the control account carries %s and NO stock schedule exists to '
           'support it. The variance is NULL, not the full control balance: an absent schedule is not '
           'an empty one.',
           r.gl_account_name, r.store_name, r.comparison_date_key, r.gl_balance),
    1
FROM reporting.vw_inventory_gl_reconciliation AS r
WHERE r.comparison_state = 'Missing subledger balance'

UNION ALL

-- ACC-MISSING-BOOK-ROW -- a unit in stock with no line on the schedule ----------------
-- Compared at MATCHED DATES ONLY: the operational snapshot is restricted to the dates the
-- accounting calendar actually contains, because the accounting calendar is a month-end
-- SUBSET of the inventory calendar and every mid-month snapshot would otherwise look like
-- a missing schedule line.
SELECT
    'ACC-MISSING-BOOK-ROW:inventory_snapshot:'
        || i.snapshot_date_key || '-' || i.dealership_key || '-' || i.vehicle_key,
    'ACC-MISSING-BOOK-ROW',
    'inventory_snapshot',
    (i.snapshot_date_key || '-' || i.dealership_key || '-' || i.vehicle_key)::varchar(64),
    i.dealership_key,
    i.snapshot_date_key,
    NULL::numeric,
    format('Vehicle key %s is in stock at dealership key %s on accounting date key %s and has NO line '
           'on the inventory control schedule. Its carrying amount is therefore absent from the '
           'subledger balance the control account is reconciled against.',
           i.vehicle_key, i.dealership_key, i.snapshot_date_key),
    1
FROM warehouse.fact_vehicle_inventory_snapshot AS i
JOIN (
    SELECT DISTINCT a.accounting_date_key FROM warehouse.fact_inventory_accounting_snapshot AS a
) AS cal ON cal.accounting_date_key = i.snapshot_date_key
LEFT JOIN warehouse.fact_inventory_accounting_snapshot AS f
       ON f.accounting_date_key = i.snapshot_date_key
      AND f.dealership_key = i.dealership_key
      AND f.vehicle_key = i.vehicle_key
WHERE f.inventory_accounting_key IS NULL

UNION ALL

-- ACC-ORPHAN-BOOK-ROW -- a schedule line for a unit that is not in stock ---------------
SELECT
    'ACC-ORPHAN-BOOK-ROW:inventory_accounting:'
        || f.accounting_date_key || '-' || f.dealership_key || '-' || f.vehicle_key,
    'ACC-ORPHAN-BOOK-ROW',
    'inventory_accounting',
    (f.accounting_date_key || '-' || f.dealership_key || '-' || f.vehicle_key)::varchar(64),
    f.dealership_key,
    f.accounting_date_key,
    f.current_book_value,
    format('The inventory control schedule carries %s for vehicle key %s at dealership key %s on date '
           'key %s, and the operational inventory snapshot does NOT show that unit in stock. The '
           'control account is being asked to support a unit that is not on the floor.',
           f.current_book_value, f.vehicle_key, f.dealership_key, f.accounting_date_key),
    1
FROM warehouse.fact_inventory_accounting_snapshot AS f
LEFT JOIN warehouse.fact_vehicle_inventory_snapshot AS i
       ON i.snapshot_date_key = f.accounting_date_key
      AND i.dealership_key = f.dealership_key
      AND i.vehicle_key = f.vehicle_key
WHERE i.inventory_snapshot_key IS NULL

UNION ALL

-- ACC-FRONT-GROSS-IDENTITY -- KPI-ACC-005 ---------------------------------------------
-- front_end_gross = sale_price - acquisition_cost - reconditioning_cost - pack_amount.
-- PACK IS SUBTRACTED HERE AND IS NOT A BOOK COMPONENT ANYWHERE. DASH.8 did not change
-- this identity and must not: it is KPI-GRS-001's arithmetic.
SELECT
    'ACC-FRONT-GROSS-IDENTITY:vehicle_sale:' || s.sale_id,
    'ACC-FRONT-GROSS-IDENTITY',
    'vehicle_sale',
    s.sale_id::varchar(64),
    s.dealership_key,
    s.sale_date_key,
    (s.front_end_gross
     - (s.sale_price - s.acquisition_cost - s.reconditioning_cost - s.pack_amount)),
    format('Deal %s: stored front_end_gross %s does not equal sale_price %s - acquisition_cost %s - '
           'reconditioning_cost %s - pack_amount %s. Pack is withheld from front gross at the point of '
           'sale and is never a capitalized inventory cost.',
           s.sale_id, s.front_end_gross, s.sale_price, s.acquisition_cost,
           s.reconditioning_cost, s.pack_amount),
    1
FROM warehouse.fact_vehicle_sale AS s
WHERE s.front_end_gross
      <> s.sale_price - s.acquisition_cost - s.reconditioning_cost - s.pack_amount

UNION ALL

-- ACC-BACK-GROSS-IDENTITY -- KPI-ACC-006 ----------------------------------------------
-- back_end_gross = finance_reserve_gross + SUM(original_product_gross) + other_fi_income.
--
-- ORIGINAL product gross, on the DEAL-DATE basis, NOT post-adjustment net product gross.
-- A later cancellation is SUPPOSED to make retained gross differ from produced gross;
-- comparing stored deal-date back gross against a net figure would flag every adjusted
-- deal in the dataset as an accounting defect, which is exactly backwards. This is the
-- same identity RECON-FI-001 proves, asked here per deal as an exception.
--
-- other_fi_income is the literal 0.00: no such column exists on fact_vehicle_sale, the
-- back-gross identity closes without one, and RECON-FI-001 proves it closes. Writing it
-- explicitly keeps the identity complete rather than silently two-termed.
SELECT
    'ACC-BACK-GROSS-IDENTITY:vehicle_sale:' || s.sale_id,
    'ACC-BACK-GROSS-IDENTITY',
    'vehicle_sale',
    s.sale_id::varchar(64),
    s.dealership_key,
    s.sale_date_key,
    (s.back_end_gross
     - (s.finance_reserve_gross + coalesce(p.original_product_gross, 0.00) + 0.00)),
    format('Deal %s: stored back_end_gross %s does not equal finance_reserve_gross %s + deal-date '
           'SUM(original_product_gross) %s + other_fi_income 0.00. This compares ORIGINAL product '
           'gross, never post-adjustment net gross: a later cancellation is meant to make retained '
           'gross differ from produced gross.',
           s.sale_id, s.back_end_gross, s.finance_reserve_gross,
           coalesce(p.original_product_gross, 0.00)),
    1
FROM warehouse.fact_vehicle_sale AS s
LEFT JOIN (
    SELECT ps.sale_key, sum(ps.original_product_gross) AS original_product_gross
    FROM warehouse.fact_finance_product_sale AS ps
    GROUP BY ps.sale_key
) AS p ON p.sale_key = s.sale_key
WHERE s.back_end_gross
      <> s.finance_reserve_gross + coalesce(p.original_product_gross, 0.00) + 0.00

UNION ALL

-- ACC-TOTAL-GROSS-IDENTITY -- KPI-ACC-007 ---------------------------------------------
SELECT
    'ACC-TOTAL-GROSS-IDENTITY:vehicle_sale:' || s.sale_id,
    'ACC-TOTAL-GROSS-IDENTITY',
    'vehicle_sale',
    s.sale_id::varchar(64),
    s.dealership_key,
    s.sale_date_key,
    (s.total_gross - (s.front_end_gross + s.back_end_gross)),
    format('Deal %s: stored total_gross %s does not equal front_end_gross %s + back_end_gross %s.',
           s.sale_id, s.total_gross, s.front_end_gross, s.back_end_gross),
    1
FROM warehouse.fact_vehicle_sale AS s
WHERE s.total_gross <> s.front_end_gross + s.back_end_gross

UNION ALL

-- ACC-ORPHAN-FI-PRODUCT -- KPI-ACC-008 ------------------------------------------------
-- Unreachable while fk_fact_finance_product_sale_sale stands. Written so a constraint
-- dropped from a deployed database fails a run rather than passing one.
SELECT
    'ACC-ORPHAN-FI-PRODUCT:finance_product_sale:' || ps.product_sale_id,
    'ACC-ORPHAN-FI-PRODUCT',
    'finance_product_sale',
    ps.product_sale_id::varchar(64),
    ps.dealership_key,
    ps.sale_date_key,
    ps.original_product_gross,
    format('F&I contract %s carries %s of product gross and its deal (sale key %s) does not resolve. '
           'Its gross is therefore counted in no deal''s back-end gross. A foreign key normally makes '
           'this impossible; if this row exists, the constraint is not on the deployed table.',
           ps.product_sale_id, ps.original_product_gross, ps.sale_key),
    1
FROM warehouse.fact_finance_product_sale AS ps
LEFT JOIN warehouse.fact_vehicle_sale AS s ON s.sale_key = ps.sale_key
WHERE s.sale_key IS NULL

UNION ALL

-- ACC-ORPHAN-FI-ADJUSTMENT -- KPI-ACC-009 ---------------------------------------------
-- Unreachable while fk_fact_finance_product_adjustment_product_sale stands, and written
-- for the same reason as the branch above.
SELECT
    'ACC-ORPHAN-FI-ADJUSTMENT:finance_product_adjustment:' || a.adjustment_id,
    'ACC-ORPHAN-FI-ADJUSTMENT',
    'finance_product_adjustment',
    a.adjustment_id::varchar(64),
    a.dealership_key,
    a.adjustment_date_key,
    a.adjustment_amount,
    format('Adjustment %s reduces %s against contract key %s, and that contract does not resolve. The '
           'reduction therefore applies to no original gross. A foreign key normally makes this '
           'impossible; if this row exists, the constraint is not on the deployed table.',
           a.adjustment_id, a.adjustment_amount, a.product_sale_key),
    1
FROM warehouse.fact_finance_product_adjustment AS a
LEFT JOIN warehouse.fact_finance_product_sale AS ps
       ON ps.product_sale_key = a.product_sale_key
WHERE ps.product_sale_key IS NULL

UNION ALL

-- ACC-DQ-FAILURE -- KPI-ACC-012 -------------------------------------------------------
-- The CURRENT data-quality state, one row per failing check on its latest evaluation.
-- Restricted to is_latest_run_for_check so a check that failed once and has passed on
-- every run since is not reported as an open exception forever.
SELECT
    'ACC-DQ-FAILURE:validation_check:' || q.check_id,
    'ACC-DQ-FAILURE',
    'validation_check',
    q.check_id::varchar(64),
    NULL::integer,
    NULL::integer,
    NULL::numeric,
    format('Data-quality check %s (%s) failed at %s severity on its most recent evaluation, over %s: '
           '%s',
           q.check_id, q.check_name, q.severity, q.target_object,
           coalesce(q.message, 'no message recorded')),
    1
FROM reporting.vw_data_quality_summary AS q
WHERE q.is_failed
  AND q.is_latest_run_for_check;

COMMENT ON VIEW reporting.vw_accounting_exceptions IS
    'Grain: one row per exception, identified by exception_id = exception_code:entity_name:entity_key.
Every branch is scoped to ONE control question about ONE entity, so a single physical defect cannot be
reported twice. A RECONCILIATION VARIANCE (ACC-GL-VARIANCE) and a DATA-QUALITY EXCEPTION (every other
code) are DIFFERENT FINDINGS and must never be totalled together: a variance means two structurally valid
balances were compared and disagreed, while a data-quality exception means a rule the model asserts about
itself does not hold. KPI-ACC-003 counts variances, KPI-ACC-012 counts data-quality exceptions, and no KPI
adds them. Missing-balance codes carry exception_amount NULL, never the balance of the side that is
present. ACC-ORPHAN-FI-PRODUCT and ACC-ORPHAN-FI-ADJUSTMENT are unreachable while their foreign keys
stand and are written anyway, so a constraint dropped from a deployed database fails a run rather than
passing one. There is deliberately no journal entry, suspense account, aged trial balance, period-close
state or remediation workflow here: ARPI builds an inventory control schedule and its reconciliation, not
a general ledger. Owns KPI-ACC-004, KPI-ACC-005, KPI-ACC-006, KPI-ACC-007, KPI-ACC-008, KPI-ACC-009,
KPI-ACC-010 and KPI-ACC-012. No browser dataset is exported from this view. All values synthetic; no
personal data. Promoted by DASH.8.';

COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_id IS 'exception_code:entity_name:entity_key. The declared grain, unique across every branch, so a single defect is counted once.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_code IS 'The governed exception code, from the closed vocabulary in src/arpi/constants.py ACCOUNTING_EXCEPTION_CODES. What distinguishes a reconciliation variance from a data-quality exception.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.entity_name IS 'The kind of thing the exception is about: gl_reconciliation, inventory_accounting, inventory_snapshot, vehicle_sale, finance_product_sale, finance_product_adjustment or validation_check.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.entity_key IS 'The identifier of the specific entity within its kind. A composite of surrogate keys where the entity is a grain rather than a row with a business key.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.dealership_key IS 'Store the exception belongs to. NULL on ACC-DQ-FAILURE, where a failing check is a property of a pipeline run and not of a store.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_date_key IS 'Business date the exception is stated as at. NULL on ACC-DQ-FAILURE for the same reason as dealership_key.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_amount IS 'The signed amount the exception is about, where one exists: the variance for ACC-GL-VARIANCE, the identity breach for the gross codes, the carrying amount for an orphan schedule line. NULL where no amount was computed -- notably on both missing-balance codes, where reporting the present side would state a number nobody computed.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_detail IS 'A full sentence naming what was compared, what the two values were, and what the finding means. Written so an exception can be acted on without a second query.';
COMMENT ON COLUMN reporting.vw_accounting_exceptions.exception_count IS 'Constant 1, published so a consumer sums a column rather than counting rows.';
