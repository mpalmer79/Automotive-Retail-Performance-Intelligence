-- =============================================================================
-- File:            sql/08_validation/15_recon_accounting.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-ACC-* / RECON-GLB-* family: prove the book-value identity holds on every schedule line, that pack and floorplan are outside it, that the schedule covers the stock it claims to, and record the GL-to-subledger comparison without asserting it must agree.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 18_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHAT RECON-ACC-BOOK-IDENTITY HAS TO PROVE
-- ------------------------------------------
--     current_book_value = acquisition_cost + capitalized_transportation
--                        + capitalized_reconditioning + capitalized_accessories
--                        + other_capitalized_costs - write_down_amount
--
-- EXACTLY, to the cent, on EVERY schedule line -- not in aggregate, because two lines with
-- offsetting errors would hide each other in a total. Tolerance 0: every component is
-- produced by exact Decimal arithmetic and stored as numeric, so there is nothing for a
-- tolerance to absorb except a defect.
--
-- The fact carries ck_fact_inventory_accounting_book_value_identity, which enforces the
-- same rule row by row. This rule re-asks it over the whole table so a constraint dropped
-- from a DEPLOYED database fails a run rather than passing one.
--
-- RECON-ACC-GL-SUBLEDGER IS NOT AN EQUALITY, AND MUST NOT BECOME ONE
-- -------------------------------------------------------------------
-- It compares the GL control balance with the inventory subledger and reports the
-- compared amounts and the signed variance. Its status is 'passed' when every
-- store-account-date that COULD be compared WAS compared -- not when they all agree.
--
-- DASH.8 deliberately plants controlled variances so the reconciliation surface can be
-- seen working in both its states. A nonzero variance is the intended demonstration, not
-- a defect: both sides are structurally valid data that simply do not agree. The rule is
-- registered in NON_CRITICAL_RECONCILIATION_IDS for that reason, and the variance is
-- still calculated, recorded and rendered -- it is the STATUS that is not critical.
--
-- A rule that failed a pipeline run because a controlled accounting variance exists would
-- make the exception surface unusable and would teach a reader that a variance means
-- broken data. It does not.
--
-- WHAT AN EXACT RECONCILIATION HERE PROVES, AND WHAT IT DOES NOT
-- --------------------------------------------------------------
-- The GL balances are GENERATED from the same subledger they are compared against, plus a
-- governed table of deliberate variances. An exact reconciliation proves the ARITHMETIC.
-- IT DOES NOT PROVE THAT TWO INDEPENDENT ACCOUNTING SYSTEMS AGREE, because there is only
-- one source. LIMITATIONS.md records this and no rule here may claim otherwise.
--
-- WHY PACK AND FLOORPLAN GET RULES OF THEIR OWN
-- ----------------------------------------------
-- Both are the failure this domain is most likely to suffer, and neither would be caught
-- by the identity above: the identity closes just as well with a wrong component in it.
--
--   RECON-ACC-PACK-EXCLUDED proves DASH.8 did not touch KPI-GRS-001's arithmetic. Pack is
--   an internal gross-allocation device withheld from front-end gross at the point of
--   SALE. It is not a capitalized inventory cost. The rule re-proves the front-gross
--   identity over every deal, so an accounting increment that had quietly moved pack into
--   inventory would fail here rather than in a review.
--
--   RECON-ACC-FLOORPLAN-EXCLUDED proves floorplan principal is outside the book identity.
--   The check is structural: the identity holds on every line AND floorplan principal is
--   materially nonzero across the schedule. Either half alone is weak -- an identity that
--   closes proves nothing if every floorplan balance is zero, and a nonzero floorplan
--   proves nothing if the identity was never asked.

CREATE OR REPLACE VIEW audit.vw_recon_accounting AS
WITH chain AS (
    SELECT
        (SELECT count(*) FROM staging.stg_inventory_accounting)::numeric        AS staging_accounting_rows,
        (SELECT count(*) FROM warehouse.fact_inventory_accounting_snapshot)::numeric
                                                                                AS warehouse_accounting_rows,
        (SELECT count(*) FROM staging.stg_gl_control_balance)::numeric          AS staging_balance_rows,
        (SELECT count(*) FROM warehouse.fact_gl_control_balance)::numeric       AS warehouse_balance_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT accounting_date_key, dealership_key, vehicle_key
            FROM warehouse.fact_inventory_accounting_snapshot
        ) AS g)::numeric                                                        AS distinct_accounting_grain,
        (SELECT count(*) FROM (
            SELECT DISTINCT balance_date_key, dealership_key, gl_account_key
            FROM warehouse.fact_gl_control_balance
        ) AS g)::numeric                                                        AS distinct_balance_grain
),
book_identity AS (
    -- PER LINE, not in total. Two lines with offsetting errors must not hide each other.
    SELECT
        count(*)::numeric AS lines,
        count(*) FILTER (
            WHERE f.current_book_value = f.acquisition_cost
                                       + f.capitalized_transportation
                                       + f.capitalized_reconditioning
                                       + f.capitalized_accessories
                                       + f.other_capitalized_costs
                                       - f.write_down_amount
        )::numeric        AS conforming_lines,
        count(*) FILTER (
            WHERE f.acquisition_cost < 0
               OR f.capitalized_transportation < 0
               OR f.capitalized_reconditioning < 0
               OR f.capitalized_accessories < 0
               OR f.other_capitalized_costs < 0
               OR f.write_down_amount < 0
               OR f.current_book_value < 0
               OR f.floorplan_principal < 0
        )::numeric        AS negative_component_lines,
        count(*) FILTER (WHERE f.floorplan_principal > 0)::numeric AS floorplanned_lines
    FROM warehouse.fact_inventory_accounting_snapshot AS f
),
pack_exclusion AS (
    -- The front-gross identity, re-proved. Pack is SUBTRACTED at the point of sale and is
    -- a capitalized inventory cost nowhere.
    SELECT
        count(*)::numeric AS deals,
        count(*) FILTER (
            WHERE s.front_end_gross
                  = s.sale_price - s.acquisition_cost - s.reconditioning_cost - s.pack_amount
        )::numeric        AS conforming_deals,
        coalesce(sum(s.pack_amount), 0) AS pack_total
    FROM warehouse.fact_vehicle_sale AS s
),
population AS (
    -- The schedule against the operational stock it claims to cover, at MATCHED DATES
    -- ONLY: the accounting calendar is a month-end SUBSET of the inventory calendar, so
    -- the comparison is restricted to the dates the schedule actually contains.
    SELECT
        (SELECT count(*)
         FROM warehouse.fact_vehicle_inventory_snapshot AS i
         WHERE i.snapshot_date_key IN (
            SELECT DISTINCT a.accounting_date_key
            FROM warehouse.fact_inventory_accounting_snapshot AS a
         ))::numeric                                                   AS stock_lines_on_accounting_dates,
        (SELECT count(*) FROM warehouse.fact_inventory_accounting_snapshot)::numeric
                                                                       AS schedule_lines,
        (SELECT count(*)
         FROM reporting.vw_accounting_exceptions AS e
         WHERE e.exception_code = 'ACC-MISSING-BOOK-ROW')::numeric      AS missing_book_rows,
        (SELECT count(*)
         FROM reporting.vw_accounting_exceptions AS e
         WHERE e.exception_code = 'ACC-ORPHAN-BOOK-ROW')::numeric       AS orphan_book_rows
),
category_totals AS (
    -- Every schedule line lands in exactly one control account, and the per-account
    -- totals add back to the whole schedule. A line routed to the wrong account would
    -- leave both account totals wrong while the grand total still balanced, so the rule
    -- checks BOTH the grand total and the category mapping.
    SELECT
        (SELECT coalesce(sum(f.current_book_value), 0)
         FROM warehouse.fact_inventory_accounting_snapshot AS f)        AS schedule_total,
        (SELECT coalesce(sum(t.account_total), 0) FROM (
            SELECT sum(f.current_book_value) AS account_total
            FROM warehouse.fact_inventory_accounting_snapshot AS f
            GROUP BY f.accounting_date_key, f.dealership_key, f.gl_account_key
         ) AS t)                                                        AS account_total,
        (SELECT count(*)
         FROM warehouse.fact_inventory_accounting_snapshot AS f
         JOIN warehouse.dim_gl_account AS a ON a.gl_account_key = f.gl_account_key
         JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = f.vehicle_key
         WHERE a.account_category <> f.control_account_category
            OR f.control_account_category <> (v.condition_type || ' Vehicle Inventory'))::numeric
                                                                        AS misrouted_lines
),
gl_comparison AS (
    SELECT
        count(*)::numeric                                              AS comparisons,
        count(*) FILTER (WHERE r.is_comparable)::numeric                AS comparable_rows,
        count(*) FILTER (WHERE r.comparison_state = 'Reconciled')::numeric   AS reconciled_rows,
        count(*) FILTER (WHERE r.comparison_state = 'Variance')::numeric     AS variance_rows,
        count(*) FILTER (WHERE r.comparison_state = 'Missing GL balance')::numeric
                                                                        AS missing_gl_rows,
        count(*) FILTER (WHERE r.comparison_state = 'Missing subledger balance')::numeric
                                                                        AS missing_subledger_rows,
        coalesce(sum(r.subledger_balance) FILTER (WHERE r.is_comparable), 0) AS comparable_subledger,
        coalesce(sum(r.gl_balance) FILTER (WHERE r.is_comparable), 0)        AS comparable_gl,
        -- The invariant this rule actually tests. A comparable row MUST carry a variance;
        -- a row with a missing side MUST NOT, because a NULL variance is what distinguishes
        -- "could not be compared" from "compared and agreed". Counting the two states
        -- against each other would be tautological -- they are derived from the same
        -- CASE -- so the rule tests the coupling between the state and the variance.
        count(*) FILTER (
            WHERE (r.is_comparable AND r.variance_amount IS NOT NULL
                   AND r.comparison_state IN ('Reconciled', 'Variance')
                   AND r.is_reconciled IS NOT NULL
                   AND (r.comparison_state = 'Variance') = (r.variance_amount <> 0))
               OR (NOT r.is_comparable AND r.variance_amount IS NULL
                   AND r.comparison_state IN ('Missing GL balance', 'Missing subledger balance')
                   AND r.is_reconciled IS NULL)
        )::numeric                                                      AS well_formed_rows,
        -- Deliberately NOT coalesced to zero row by row: a NULL variance is excluded from
        -- the sum rather than counted as agreement.
        coalesce(sum(r.variance_amount), 0)                             AS signed_variance_total,
        coalesce(sum(r.absolute_variance_amount), 0)                    AS absolute_variance_total
    FROM reporting.vw_inventory_gl_reconciliation AS r
),
view_shape AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_inventory_accounting)::numeric       AS accounting_view_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT accounting_date_key, dealership_key, vehicle_key
            FROM reporting.vw_inventory_accounting
        ) AS g)::numeric                                                        AS accounting_view_distinct,
        (SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation)::numeric
                                                                                AS recon_view_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT comparison_date_key, dealership_key, gl_account_key
            FROM reporting.vw_inventory_gl_reconciliation
        ) AS g)::numeric                                                        AS recon_view_distinct
)

-- RECON-FACT-INVENTORY-ACCOUNTING-WAREHOUSE -----------------------------------------
SELECT
    'RECON-FACT-INVENTORY-ACCOUNTING-WAREHOUSE'::text AS reconciliation_id,
    format('Every accepted staging schedule line reaches the warehouse: %s staging row(s) against %s '
           'warehouse row(s). A line lost between the two layers removes its carrying amount from the '
           'subledger balance and manufactures a GL variance that describes nothing.',
           c.staging_accounting_rows, c.warehouse_accounting_rows)      AS description,
    'staging.stg_inventory_accounting'::text                            AS left_source,
    c.staging_accounting_rows                                           AS left_value,
    'warehouse.fact_inventory_accounting_snapshot'::text                AS right_source,
    c.warehouse_accounting_rows                                         AS right_value,
    0::numeric                                                          AS tolerance,
    CASE WHEN c.staging_accounting_rows = c.warehouse_accounting_rows
         THEN 'passed' ELSE 'failed' END                                AS status
FROM chain AS c

UNION ALL

-- RECON-FACT-GL-CONTROL-BALANCE-WAREHOUSE -------------------------------------------
SELECT
    'RECON-FACT-GL-CONTROL-BALANCE-WAREHOUSE'::text,
    format('Every accepted staging control balance reaches the warehouse: %s staging row(s) against %s '
           'warehouse row(s). A lost balance is reported as a MISSING GL BALANCE with a NULL variance, '
           'which is a different finding from a variance -- this rule names which layer lost it.',
           c.staging_balance_rows, c.warehouse_balance_rows),
    'staging.stg_gl_control_balance',
    c.staging_balance_rows,
    'warehouse.fact_gl_control_balance',
    c.warehouse_balance_rows,
    0::numeric,
    CASE WHEN c.staging_balance_rows = c.warehouse_balance_rows
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-ACC-BOOK-IDENTITY -- THE HEADLINE, per line ---------------------------------
SELECT
    'RECON-ACC-BOOK-IDENTITY'::text,
    format('current_book_value is explained by its declared components on %s of %s schedule line(s): '
           'acquisition_cost + capitalized_transportation + capitalized_reconditioning + '
           'capitalized_accessories + other_capitalized_costs - write_down_amount. EXACT and PER LINE, '
           'because two lines with offsetting errors would hide each other in a total. Tolerance 0: '
           'every component is exact Decimal arithmetic stored as numeric, so there is nothing for a '
           'tolerance to absorb except a defect. ck_fact_inventory_accounting_book_value_identity '
           'enforces the same rule row by row; this re-asks it over the whole table so a constraint '
           'dropped from a deployed database fails a run rather than passing one.',
           b.conforming_lines, b.lines),
    'warehouse.fact_inventory_accounting_snapshot lines whose book value is explained',
    b.conforming_lines,
    'warehouse.fact_inventory_accounting_snapshot lines',
    b.lines,
    0::numeric,
    CASE WHEN b.conforming_lines = b.lines THEN 'passed' ELSE 'failed' END
FROM book_identity AS b

UNION ALL

-- RECON-ACC-BOOK-COMPONENTS -- no component is negative -----------------------------
SELECT
    'RECON-ACC-BOOK-COMPONENTS'::text,
    format('%s schedule line(s) carry a negative book component, write-down, carrying value or '
           'floorplan principal. A negative capitalized cost is not a cost, a negative write-down is a '
           'write-UP this model does not represent, and a negative carrying value would SUBTRACT from a '
           'control balance. The identity in RECON-ACC-BOOK-IDENTITY closes just as neatly with a '
           'nonsense component inside it, which is why this rule is separate.',
           b.negative_component_lines),
    'warehouse.fact_inventory_accounting_snapshot lines with a negative component',
    b.negative_component_lines,
    'permitted negative components',
    0::numeric,
    0::numeric,
    CASE WHEN b.negative_component_lines = 0 THEN 'passed' ELSE 'failed' END
FROM book_identity AS b

UNION ALL

-- RECON-ACC-PACK-EXCLUDED -- DASH.8 did not touch the front-gross identity -----------
SELECT
    'RECON-ACC-PACK-EXCLUDED'::text,
    format('front_end_gross = sale_price - acquisition_cost - reconditioning_cost - pack_amount still '
           'holds on %s of %s deal(s), over %s of pack in the dataset. Pack is an internal '
           'gross-allocation device withheld from front gross at the point of SALE; it is NOT a '
           'capitalized inventory cost and appears in no book-value component. An accounting increment '
           'that had quietly moved pack into inventory would fail here rather than in a review, and '
           'KPI-GRS-001 would have changed without anyone saying so.',
           p.conforming_deals, p.deals, p.pack_total),
    'warehouse.fact_vehicle_sale deals whose front-gross identity holds',
    p.conforming_deals,
    'warehouse.fact_vehicle_sale deals',
    p.deals,
    0::numeric,
    CASE WHEN p.conforming_deals = p.deals THEN 'passed' ELSE 'failed' END
FROM pack_exclusion AS p

UNION ALL

-- RECON-ACC-FLOORPLAN-EXCLUDED -- a liability is not part of an asset identity -------
SELECT
    'RECON-ACC-FLOORPLAN-EXCLUDED'::text,
    format('The book-value identity holds on all %s schedule line(s) WHILE %s of them carry a nonzero '
           'floorplan principal. Both halves are required: an identity that closes proves nothing if '
           'every floorplan balance happens to be zero, and a nonzero floorplan proves nothing if the '
           'identity was never asked. Floorplan principal is a LIABILITY carried as context on an asset '
           'schedule -- it is never added to, subtracted from or netted against book value, and ARPI '
           'publishes no net-inventory-position figure anywhere.',
           b.lines, b.floorplanned_lines),
    'lines where the identity holds and floorplan is excluded from it',
    b.conforming_lines,
    'lines',
    b.lines,
    0::numeric,
    CASE WHEN b.conforming_lines = b.lines AND b.floorplanned_lines > 0
         THEN 'passed' ELSE 'failed' END
FROM book_identity AS b

UNION ALL

-- RECON-ACC-POPULATION -- the schedule covers the stock it claims to -----------------
SELECT
    'RECON-ACC-POPULATION'::text,
    format('On the dates the accounting calendar contains, the operational inventory holds %s stock '
           'line(s) and the control schedule holds %s, with %s missing book row(s) and %s orphan '
           'schedule line(s). Compared at MATCHED DATES ONLY: the accounting calendar is a month-end '
           'SUBSET of the inventory calendar, so comparing every date would report each mid-month '
           'snapshot as a missing schedule line.',
           n.stock_lines_on_accounting_dates, n.schedule_lines,
           n.missing_book_rows, n.orphan_book_rows),
    'warehouse.fact_vehicle_inventory_snapshot lines on accounting dates',
    n.stock_lines_on_accounting_dates,
    'warehouse.fact_inventory_accounting_snapshot lines',
    n.schedule_lines,
    0::numeric,
    CASE WHEN n.stock_lines_on_accounting_dates = n.schedule_lines
          AND n.missing_book_rows = 0
          AND n.orphan_book_rows = 0
         THEN 'passed' ELSE 'failed' END
FROM population AS n

UNION ALL

-- RECON-ACC-CATEGORY-TOTALS ---------------------------------------------------------
SELECT
    'RECON-ACC-CATEGORY-TOTALS'::text,
    format('The schedule totals %s and the per-account totals add back to %s, with %s misrouted '
           'line(s). A line routed to the wrong control account leaves BOTH account totals wrong while '
           'the grand total still balances, so this rule checks the mapping as well as the sum: every '
           'line''s category must agree with the account it resolves to AND with the unit''s own '
           'condition.',
           t.schedule_total, t.account_total, t.misrouted_lines),
    'warehouse.fact_inventory_accounting_snapshot total book value',
    t.schedule_total,
    'sum of per-account totals, with misrouted lines counted separately',
    t.account_total,
    0::numeric,
    CASE WHEN t.schedule_total = t.account_total AND t.misrouted_lines = 0
         THEN 'passed' ELSE 'failed' END
FROM category_totals AS t

UNION ALL

-- RECON-ACC-GRAIN -------------------------------------------------------------------
SELECT
    'RECON-ACC-GRAIN'::text,
    format('warehouse.fact_inventory_accounting_snapshot holds %s row(s) over %s distinct (accounting '
           'date, store, vehicle) combination(s). A second line for one unit on one date would count '
           'its carrying amount twice in the control balance and manufacture a variance that is not '
           'there.',
           c.warehouse_accounting_rows, c.distinct_accounting_grain),
    'warehouse.fact_inventory_accounting_snapshot row count',
    c.warehouse_accounting_rows,
    'warehouse.fact_inventory_accounting_snapshot distinct declared grain',
    c.distinct_accounting_grain,
    0::numeric,
    CASE WHEN c.warehouse_accounting_rows = c.distinct_accounting_grain
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-GLB-GRAIN -------------------------------------------------------------------
SELECT
    'RECON-GLB-GRAIN'::text,
    format('warehouse.fact_gl_control_balance holds %s row(s) over %s distinct (balance date, store, '
           'account) combination(s). A second balance at one combination would double the control side '
           'and manufacture a variance that is not there.',
           c.warehouse_balance_rows, c.distinct_balance_grain),
    'warehouse.fact_gl_control_balance row count',
    c.warehouse_balance_rows,
    'warehouse.fact_gl_control_balance distinct declared grain',
    c.distinct_balance_grain,
    0::numeric,
    CASE WHEN c.warehouse_balance_rows = c.distinct_balance_grain
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-ACC-GL-SUBLEDGER -- NOT AN EQUALITY -----------------------------------------
-- Status is 'passed' when every comparable store-account-date WAS compared, not when
-- they all agree. Registered in NON_CRITICAL_RECONCILIATION_IDS. See the file header.
SELECT
    'RECON-ACC-GL-SUBLEDGER'::text,
    format('%s comparison row(s): %s comparable, of which %s reconciled exactly and %s carry a '
           'variance; %s missing GL balance(s) and %s missing subledger balance(s) could not be '
           'compared at all and hold a NULL variance rather than a zero. Across the comparable rows the '
           'subledger totals %s against a control total of %s, a signed variance of %s and an absolute '
           'variance of %s. THIS RULE IS NOT AN EQUALITY. DASH.8 deliberately plants controlled '
           'variances so the reconciliation surface can be seen working in both its states, so a '
           'nonzero variance is the intended demonstration and not a defect: both sides are '
           'structurally valid data that do not agree. THE GL BALANCES ARE GENERATED FROM THE SUBLEDGER '
           'THEY ARE COMPARED AGAINST, so an exact reconciliation proves the ARITHMETIC and NOT that '
           'two independent accounting systems agree. WHAT IS TESTED here is that the comparison is '
           'WELL FORMED on all %s row(s): every comparable row carries a variance and a non-null '
           'reconciled flag whose value agrees with whether that variance is zero, and every row with a '
           'missing side carries a NULL variance and a NULL flag -- because a NULL variance is what '
           'distinguishes "could not be compared" from "compared and agreed", and COALESCE-ing an absent '
           'balance to 0.00 would report a missing balance as a zeroed account.',
           g.comparisons, g.comparable_rows, g.reconciled_rows, g.variance_rows,
           g.missing_gl_rows, g.missing_subledger_rows,
           g.comparable_subledger, g.comparable_gl,
           g.signed_variance_total, g.absolute_variance_total, g.well_formed_rows),
    'comparison rows whose state, variance and reconciled flag agree with each other',
    g.well_formed_rows,
    'comparison rows',
    g.comparisons,
    0::numeric,
    CASE WHEN g.well_formed_rows = g.comparisons THEN 'passed' ELSE 'failed' END
FROM gl_comparison AS g

UNION ALL

-- RECON-REPORT-ACCOUNTING-ROWS ------------------------------------------------------
SELECT
    'RECON-REPORT-ACCOUNTING-ROWS'::text,
    format('reporting.vw_inventory_accounting returns %s row(s) over %s distinct (accounting date, '
           'store, vehicle) combination(s), against %s warehouse row(s). The view is at the fact''s own '
           'grain with no aggregation, so a difference is either a fan-out from a dimension join or a '
           'row dropped by one.',
           w.accounting_view_rows, w.accounting_view_distinct, c.warehouse_accounting_rows),
    'reporting.vw_inventory_accounting row count',
    w.accounting_view_rows,
    'warehouse.fact_inventory_accounting_snapshot row count',
    c.warehouse_accounting_rows,
    0::numeric,
    CASE WHEN w.accounting_view_rows = c.warehouse_accounting_rows
          AND w.accounting_view_rows = w.accounting_view_distinct
         THEN 'passed' ELSE 'failed' END
FROM view_shape AS w CROSS JOIN chain AS c

UNION ALL

-- RECON-REPORT-GL-RECON-ROWS --------------------------------------------------------
SELECT
    'RECON-REPORT-GL-RECON-ROWS'::text,
    format('reporting.vw_inventory_gl_reconciliation returns %s row(s) over %s distinct (comparison '
           'date, store, account) combination(s). The view FULL JOINs two sides, so this proves no '
           'comparison is duplicated -- a duplicated row would report one variance twice and would be '
           'invisible in any total.',
           w.recon_view_rows, w.recon_view_distinct),
    'reporting.vw_inventory_gl_reconciliation row count',
    w.recon_view_rows,
    'reporting.vw_inventory_gl_reconciliation distinct declared grain',
    w.recon_view_distinct,
    0::numeric,
    CASE WHEN w.recon_view_rows = w.recon_view_distinct THEN 'passed' ELSE 'failed' END
FROM view_shape AS w;

COMMENT ON VIEW audit.vw_recon_accounting IS
    'Grain: one row per RECON-ACC-* / RECON-GLB-* rule, in the uniform shape of '
    'audit.vw_recon_result_template. RECON-ACC-BOOK-IDENTITY is the headline: current_book_value is '
    'explained, to the cent, by acquisition cost plus capitalized transportation, reconditioning, '
    'accessories and other costs, less write-down -- checked PER LINE and EXACTLY, because two lines with '
    'offsetting errors would hide each other in a total. RECON-ACC-PACK-EXCLUDED re-proves the front-gross '
    'identity so an accounting increment cannot quietly move pack into inventory and change KPI-GRS-001; '
    'RECON-ACC-FLOORPLAN-EXCLUDED proves the book identity holds while floorplan principal is materially '
    'nonzero, so a liability is demonstrably outside an asset identity rather than merely absent from it. '
    'RECON-ACC-GL-SUBLEDGER IS DELIBERATELY NOT AN EQUALITY: it passes when every comparable '
    'store-account-date was compared, not when they all agree, because DASH.8 plants controlled variances '
    'so the reconciliation surface can be seen working in both states. It is registered non-critical for '
    'that reason, and the variance is still calculated, recorded and rendered. The GL balances are '
    'GENERATED from the subledger they are compared against, so an exact reconciliation proves the '
    'arithmetic and NOT that two independent systems agree.';
