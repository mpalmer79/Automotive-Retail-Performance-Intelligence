-- =============================================================================
-- File:            sql/05_reporting/50_vw_inventory_gl_reconciliation.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_inventory_gl_reconciliation — the matched-date comparison of the inventory subledger against the GL control balance, with a signed variance and an explicit comparison state.
-- Execution order: Reporting layer, after reporting.vw_inventory_accounting and warehouse.fact_gl_control_balance exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per dealership, per GL control account, per comparison date — the FULL union of the two sides, so a date present on only one side still produces a row.
-- =============================================================================
--
-- Delivery increment: DASH.8. Anchoring question SQ-43.
--
-- THE VARIANCE SIGN IS FIXED AND MUST NOT BE FLIPPED
-- ---------------------------------------------------
--     variance_amount = gl_balance - subledger_balance
--
-- POSITIVE means the GL control account carries MORE than the stock schedule supports:
-- the ledger says the store owns inventory the schedule cannot account for.
-- NEGATIVE means the schedule carries more than the control account: units are on the
-- floor that the ledger has not picked up.
--
-- These are different investigations with different causes, and a report that published
-- only an absolute value would send a controller looking in the wrong direction half the
-- time. absolute_variance_amount is published ALONGSIDE, never instead: it is for ranking
-- by size, and it is never the number a variance is reported as.
--
-- A MISSING SIDE IS NULL. IT IS NEVER ZERO.
-- ------------------------------------------
-- The join is FULL, so a store-account-date present on one side only still produces a
-- row -- that absence is the finding. The missing side stays NULL and the variance stays
-- NULL, because COALESCE-ing an absent GL balance to 0.00 would report a variance equal
-- to the entire subledger and present a MISSING BALANCE as a ZEROED ACCOUNT. Those are
-- different facts about the world, and only one of them is true.
--
-- comparison_state makes the distinction explicit rather than leaving it to be inferred
-- from a NULL:
--   'Reconciled'                both sides present, compared, and equal to the cent
--   'Variance'                  both sides present, compared, and not equal
--   'Missing GL balance'        no control balance to compare against; variance is NULL
--   'Missing subledger balance' no stock schedule to compare against; variance is NULL
-- The first two mean A COMPARISON HAPPENED. The last two mean it could not.
--
-- MATCHED DATES ONLY
-- ------------------
-- Both sides are month-end by construction and the join is on the DATE KEY, so a
-- month-end control balance is never compared with a mid-month schedule. That comparison
-- is the classic reconciliation error, and it is prevented structurally rather than by a
-- caution in a document.
--
-- WHAT AN EXACT RECONCILIATION HERE PROVES, AND WHAT IT DOES NOT
-- --------------------------------------------------------------
-- The GL balances are GENERATED from the same subledger they are compared against, plus a
-- governed table of deliberate variances, so the reconciliation surface can be seen in
-- both its states. An exact reconciliation therefore proves the reconciliation ARITHMETIC
-- is correct. IT DOES NOT PROVE THAT TWO INDEPENDENT ACCOUNTING SYSTEMS AGREE, because
-- there is only one source. LIMITATIONS.md records this and no surface may claim
-- otherwise.
--
-- A VARIANCE IS NOT A DEFECT
-- --------------------------
-- Both sides of a variance row are structurally valid data. RECON-ACC-GL-SUBLEDGER is
-- registered as NON-CRITICAL for exactly this reason: marking a pipeline run failed
-- because a controlled accounting variance exists would make the exception surface
-- unusable and would teach a reader that a variance means broken data. It does not. The
-- variance is still calculated, recorded and rendered -- it is the STATUS that is not
-- critical.
--
-- ZERO EXACTLY, NOT WITHIN A TOLERANCE
-- ------------------------------------
-- Both sides are numeric produced by exact Decimal arithmetic. There is nothing for a
-- tolerance to absorb except a defect, so 'Reconciled' means variance_amount = 0.00 and
-- not |variance| <= 0.01.
--
-- SEMI-ADDITIVITY. Every balance and every variance here is additive across stores and
-- accounts AT ONE date and never across dates.
--
-- EXPORT BOUNDARY: DASH.8 exports NO browser dataset from this view.
--
-- PRIVACY: no personal data. A comparison row names a store, an account and a date.

CREATE OR REPLACE VIEW reporting.vw_inventory_gl_reconciliation AS
WITH subledger AS (
    -- The stock schedule, totalled to the control account it schedules. The unit count
    -- travels with it so a variance can be read against the population behind it.
    SELECT
        a.accounting_date_key                AS comparison_date_key,
        a.dealership_key                     AS dealership_key,
        a.gl_account_key                     AS gl_account_key,
        sum(a.current_book_value)            AS subledger_balance,
        sum(a.stock_unit_count)              AS stock_unit_count,
        sum(a.floorplan_principal)           AS floorplan_principal
    FROM reporting.vw_inventory_accounting AS a
    GROUP BY a.accounting_date_key, a.dealership_key, a.gl_account_key
),
control AS (
    SELECT
        b.balance_date_key                   AS comparison_date_key,
        b.dealership_key                     AS dealership_key,
        b.gl_account_key                     AS gl_account_key,
        b.net_balance                        AS gl_balance
    FROM warehouse.fact_gl_control_balance AS b
),
compared AS (
    -- FULL, deliberately. A side that is absent is the finding, not a row to drop.
    SELECT
        coalesce(s.comparison_date_key, c.comparison_date_key) AS comparison_date_key,
        coalesce(s.dealership_key, c.dealership_key)           AS dealership_key,
        coalesce(s.gl_account_key, c.gl_account_key)           AS gl_account_key,
        s.subledger_balance                                    AS subledger_balance,
        s.stock_unit_count                                     AS stock_unit_count,
        s.floorplan_principal                                  AS floorplan_principal,
        c.gl_balance                                           AS gl_balance
    FROM subledger AS s
    FULL JOIN control AS c
      ON c.comparison_date_key = s.comparison_date_key
     AND c.dealership_key = s.dealership_key
     AND c.gl_account_key = s.gl_account_key
)
SELECT
    -- Grain. Every one of these is NOT NULL by construction, so the declared grain is
    -- testable and RECON-REPORT-GL-RECON-ROWS can compare rows to distinct grain.
    x.comparison_date_key                        AS comparison_date_key,
    d.full_date                                  AS comparison_date,
    d.month_start_date                           AS comparison_month_start_date,
    x.dealership_key                             AS dealership_key,
    store.dealership_id                          AS dealership_id,
    store.store_name                             AS store_name,
    x.gl_account_key                             AS gl_account_key,
    acct.gl_account_id                           AS gl_account_id,
    acct.account_number                          AS gl_account_number,
    acct.account_name                            AS gl_account_name,
    acct.account_category                        AS control_account_category,
    acct.normal_balance                          AS normal_balance,

    -- The two sides. Neither is ever defaulted. -----------------------------
    x.subledger_balance                          AS subledger_balance,
    x.gl_balance                                 AS gl_balance,
    x.stock_unit_count                           AS stock_unit_count,
    x.floorplan_principal                        AS floorplan_principal,

    -- The comparison. NULL when it could not be made. -----------------------
    (x.gl_balance - x.subledger_balance)         AS variance_amount,
    abs(x.gl_balance - x.subledger_balance)      AS absolute_variance_amount,
    CASE
        WHEN x.subledger_balance IS NULL THEN 'Missing subledger balance'
        WHEN x.gl_balance IS NULL        THEN 'Missing GL balance'
        WHEN x.gl_balance = x.subledger_balance THEN 'Reconciled'
        ELSE 'Variance'
    END                                          AS comparison_state,
    -- Deliberately three-valued. FALSE means compared and disagreed; NULL means no
    -- comparison was possible. Collapsing the two would hide a missing balance inside
    -- the same bucket as a real variance.
    CASE
        WHEN x.subledger_balance IS NULL OR x.gl_balance IS NULL THEN NULL
        ELSE (x.gl_balance = x.subledger_balance)
    END                                          AS is_reconciled,
    (x.subledger_balance IS NOT NULL AND x.gl_balance IS NOT NULL)
                                                 AS is_comparable,

    -- Denominator, published so a consumer sums a column rather than counting rows.
    1::integer                                   AS comparison_count
FROM compared AS x
JOIN warehouse.dim_date AS d
  ON d.date_key = x.comparison_date_key
JOIN warehouse.dim_dealership AS store
  ON store.dealership_key = x.dealership_key
JOIN warehouse.dim_gl_account AS acct
  ON acct.gl_account_key = x.gl_account_key;

COMMENT ON VIEW reporting.vw_inventory_gl_reconciliation IS
    'Grain: one row per dealership per GL control account per comparison date, over the FULL union of both
sides -- a store-account-date present on only one side still produces a row, because that absence is the
finding. Compares the inventory subledger (SUM of current_book_value from reporting.vw_inventory_accounting)
with the GL control balance at MATCHED DATES ONLY; both sides are month-end by construction, so a month-end
balance is never compared with a mid-month schedule. variance_amount = gl_balance - subledger_balance:
POSITIVE means the GL carries more than the schedule supports, NEGATIVE means the schedule carries more
than the GL, and the sign is never flipped or absorbed into an absolute value. A MISSING SIDE IS NULL AND
NEVER ZERO -- COALESCE-ing an absent balance to 0.00 would present a missing balance as a zeroed account.
Reconciliation is EXACT (= 0.00), not within a tolerance. A VARIANCE IS NOT A DEFECT: both sides are valid
data and RECON-ACC-GL-SUBLEDGER is registered non-critical for that reason. THE GL BALANCES ARE GENERATED
FROM THE SUBLEDGER THEY ARE COMPARED AGAINST, plus governed deliberate variances -- an exact reconciliation
proves the ARITHMETIC, not that two independent systems agree. Owns KPI-ACC-001, KPI-ACC-002 and
KPI-ACC-003. No browser dataset is exported from this view. All values synthetic; no personal data.
Promoted by DASH.8.';

COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.comparison_date_key IS 'The matched date both sides are stated as at. Part of the declared grain. Never NULL: it is the coalesce of the two sides'' dates, which are equal wherever both exist.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.comparison_date IS 'The matched date as a calendar date. A month-end business date, never a wall clock.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.comparison_month_start_date IS 'First day of the comparison date''s month, for month grouping without a second calendar hop.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.dealership_key IS 'Store both sides belong to. Part of the declared grain. Both facts resolve the store as at their own date, so the two sides land on the same key.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.dealership_id IS 'Store business key.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.store_name IS 'Store name as at the comparison date. Synthetic; no real dealership is named.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.gl_account_key IS 'The control account being reconciled. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.gl_account_id IS 'Control-account business key, GLA-####.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.gl_account_number IS 'Synthetic control-account number. INVENTED; never a real dealer group''s account number.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.gl_account_name IS 'Synthetic control-account name.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.control_account_category IS 'New, Used or Certified Vehicle Inventory. The category whose schedule this account controls.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.normal_balance IS 'The account''s natural side, Debit or Credit. What makes the sign of a balance unambiguous.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.subledger_balance IS 'SUM of current_book_value over the stock schedule for this store, account and date. NULL when no schedule exists for the combination -- never 0.00, because a missing schedule is not an empty one. Semi-additive: additive across stores and accounts at ONE date, never across dates.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.gl_balance IS 'The control-account balance for this store, account and date. NULL when no balance exists -- never 0.00, because a missing balance is not a zeroed account. Semi-additive on the same terms as the subledger side.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.stock_unit_count IS 'Units behind the subledger balance, so a variance can be read against its population. NULL when the subledger side is absent.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.floorplan_principal IS 'SUM of floorplan principal over the same units, carried as LIABILITY CONTEXT only. It is not part of either side of the comparison and is never netted into a balance or a variance.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.variance_amount IS 'gl_balance - subledger_balance. POSITIVE: the GL carries more than the schedule supports. NEGATIVE: the schedule carries more than the GL. NULL when either side is absent, because a variance against an absent side is not a variance. The sign is load-bearing and must never be flipped.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.absolute_variance_amount IS 'Magnitude of the variance, for ranking by size ONLY. Published alongside the signed variance and never instead of it: an absolute value sends a controller in the wrong direction half the time.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.comparison_state IS 'Reconciled, Variance, Missing GL balance or Missing subledger balance. The first two mean BOTH SIDES WERE PRESENT AND COMPARED; the last two mean no comparison was possible and the variance is NULL. Closed vocabulary.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.is_reconciled IS 'Three-valued deliberately. TRUE: compared and equal. FALSE: compared and unequal. NULL: no comparison was possible. Collapsing NULL into FALSE would hide a missing balance inside the same bucket as a real variance.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.is_comparable IS 'Whether both sides were present. KPI-ACC-003''s denominator: a variance rate over rows that could not be compared is not a rate.';
COMMENT ON COLUMN reporting.vw_inventory_gl_reconciliation.comparison_count IS 'Constant 1, published so a consumer sums a column rather than counting rows.';
