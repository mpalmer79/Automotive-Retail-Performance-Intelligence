-- =============================================================================
-- File:            sql/08_validation/13_recon_fi.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-FI-* family, including the promoted RECON-FI-001: prove that every cent of deal-date back-end gross is explained by finance reserve plus product gross, and that the whole F&I domain holds together across layers.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 16_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHAT RECON-FI-001 HAS TO PROVE, AND WHAT IT MUST NOT
-- -----------------------------------------------------
-- It proves the DEAL-DATE identity:
--
--     fact_vehicle_sale.back_end_gross
--       = finance_reserve_gross + SUM(original_product_gross) + other_fi_income
--
-- with other_fi_income exactly 0.00 and no balancing plug. Exactly, to the cent, on
-- EVERY deal -- not in aggregate, because two deals with offsetting errors would hide
-- each other in a total.
--
-- IT MUST NOT compare stored deal-date back gross to POST-ADJUSTMENT net product gross.
-- A later cancellation is SUPPOSED to make retained gross differ from produced gross;
-- calling that difference an error would turn the domain's central distinction into a
-- permanent failing check. RECON-FI-NET-GROSS reconciles the as-of side separately, on
-- its own basis.
--
-- WHY THE COMPARISONS ARE EXACT AND NOT TOLERANT
-- -----------------------------------------------
-- Every F&I amount is produced by exact Decimal arithmetic and stored as numeric, and
-- the allocation that splits a deal's back gross across its contracts uses largest-
-- remainder distribution so it lands on the cent by construction. There is nothing for a
-- tolerance to absorb except a defect, so the tolerance is 0 wherever an identity is
-- claimed. The two comparisons that cross a grain boundary use the project-wide 0.01
-- currency tolerance, and say so.
--
-- WHY THE REPORTING VIEWS ARE RECONCILED FOR FAN-OUT
-- ---------------------------------------------------
-- Each of the four F&I views joins pre-aggregated subqueries. A duplicated join key would
-- fan a row out and double a gross figure -- invisible in a percentage and invisible in a
-- total that nobody has an independent copy of. The four RECON-REPORT-FI-*-ROWS rules
-- compare each view's row count to its own distinct declared grain, so a fan-out fails
-- rather than renders.

CREATE OR REPLACE VIEW audit.vw_recon_fi AS
WITH governed_as_of AS (
    SELECT max(d.full_date) AS as_of_date
    FROM warehouse.dim_date AS d
    WHERE d.date_key IN (
        SELECT s.sale_date_key FROM warehouse.fact_vehicle_sale AS s
        UNION ALL
        SELECT i.snapshot_date_key FROM warehouse.fact_vehicle_inventory_snapshot AS i
        UNION ALL
        SELECT l.lead_created_date_key FROM warehouse.fact_lead AS l
    )
),
chain AS (
    SELECT
        (SELECT count(*) FROM staging.stg_finance_product_sale)::numeric        AS staging_product_rows,
        (SELECT count(*) FROM warehouse.fact_finance_product_sale)::numeric     AS warehouse_product_rows,
        (SELECT count(*) FROM staging.stg_finance_product_adjustment)::numeric  AS staging_adjustment_rows,
        (SELECT count(*) FROM warehouse.fact_finance_product_adjustment)::numeric
                                                                                AS warehouse_adjustment_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT sale_key, finance_product_key
            FROM warehouse.fact_finance_product_sale
        ) AS g)::numeric                                                        AS distinct_product_grain,
        (SELECT count(DISTINCT adjustment_id)
         FROM warehouse.fact_finance_product_adjustment)::numeric               AS distinct_adjustment_grain
),
deal_identity AS (
    -- PER DEAL, not in total. Two deals with offsetting errors must not hide each other.
    SELECT
        count(*)::numeric AS deals,
        count(*) FILTER (
            WHERE s.back_end_gross = s.finance_reserve_gross + coalesce(p.product_gross, 0.00)
        )::numeric        AS conforming_deals
    FROM warehouse.fact_vehicle_sale AS s
    LEFT JOIN (
        SELECT ps.sale_key, sum(ps.original_product_gross) AS product_gross
        FROM warehouse.fact_finance_product_sale AS ps
        GROUP BY ps.sale_key
    ) AS p ON p.sale_key = s.sale_key
),
gross_totals AS (
    SELECT
        (SELECT coalesce(sum(s.back_end_gross), 0) FROM warehouse.fact_vehicle_sale AS s)
                                                                        AS back_end_gross,
        (SELECT coalesce(sum(s.finance_reserve_gross), 0) FROM warehouse.fact_vehicle_sale AS s)
                                                                        AS reserve_gross,
        (SELECT coalesce(sum(ps.original_product_gross), 0)
         FROM warehouse.fact_finance_product_sale AS ps)                AS product_gross,
        (SELECT count(*) FILTER (WHERE s.total_gross <> s.front_end_gross + s.back_end_gross)
         FROM warehouse.fact_vehicle_sale AS s)::numeric                AS broken_total_gross,
        (SELECT count(*) FROM warehouse.fact_vehicle_sale)::numeric     AS sale_rows
),
product_identity AS (
    SELECT
        count(*)::numeric AS contracts,
        count(*) FILTER (
            WHERE ps.original_product_gross
                  = ps.product_retail_price - ps.product_dealer_cost
        )::numeric        AS conforming_contracts
    FROM warehouse.fact_finance_product_sale AS ps
),
store_totals AS (
    SELECT
        count(*)::numeric AS stores,
        count(*) FILTER (WHERE abs(fact_total - view_total) <= 0.01)::numeric AS conforming_stores
    FROM (
        SELECT
            coalesce(f.dealership_key, v.dealership_key) AS dealership_key,
            coalesce(f.total, 0) AS fact_total,
            coalesce(v.total, 0) AS view_total
        FROM (
            SELECT ps.dealership_key, sum(ps.original_product_gross) AS total
            FROM warehouse.fact_finance_product_sale AS ps
            GROUP BY ps.dealership_key
        ) AS f
        FULL JOIN (
            SELECT s.dealership_key, sum(s.original_product_gross) AS total
            FROM reporting.vw_fi_summary AS s
            GROUP BY s.dealership_key
        ) AS v ON v.dealership_key = f.dealership_key
    ) AS per_store
),
period_totals AS (
    SELECT
        count(*)::numeric AS periods,
        count(*) FILTER (WHERE abs(fact_total - view_total) <= 0.01)::numeric AS conforming_periods
    FROM (
        SELECT
            coalesce(f.month_key, v.month_key) AS month_key,
            coalesce(f.total, 0) AS fact_total,
            coalesce(v.total, 0) AS view_total
        FROM (
            SELECT to_char(d.month_start_date, 'YYYYMMDD')::integer AS month_key,
                   sum(ps.original_product_gross) AS total
            FROM warehouse.fact_finance_product_sale AS ps
            JOIN warehouse.dim_date AS d ON d.date_key = ps.sale_date_key
            GROUP BY 1
        ) AS f
        FULL JOIN (
            SELECT to_char(d.month_start_date, 'YYYYMMDD')::integer AS month_key,
                   sum(s.original_product_gross) AS total
            FROM reporting.vw_fi_summary AS s
            JOIN warehouse.dim_date AS d ON d.date_key = s.sale_date_key
            GROUP BY 1
        ) AS v ON v.month_key = f.month_key
    ) AS per_period
),
reserve_structure AS (
    -- Reserve exists only where the structure can produce it. The CHECK on the fact
    -- covers what one row can decide; this re-asks it over the whole table, so a
    -- constraint dropped from a deployed database fails a run rather than passing.
    SELECT
        count(*)::numeric AS retail_deals,
        count(*) FILTER (
            WHERE s.finance_reserve_gross = 0
               OR warehouse.fn_finance_structure(s.sale_type, s.amount_financed) = 'Retail Finance'
        )::numeric        AS conforming_deals,
        count(*) FILTER (
            WHERE warehouse.fn_finance_structure(s.sale_type, s.amount_financed) = 'Cash'
              AND s.lender_key IS NOT NULL
        )::numeric        AS cash_deals_with_a_lender
    FROM warehouse.fact_vehicle_sale AS s
    WHERE s.is_retail
),
eligibility AS (
    -- Every contract is a SUBSET of the eligible (deal, category) combinations. Asked
    -- through the same governed function reporting.vw_fi_product_penetration builds its
    -- denominator from, so a numerator outside its own denominator fails here.
    SELECT
        count(*)::numeric AS contracts,
        count(*) FILTER (
            WHERE warehouse.fn_product_category_is_eligible(
                      p.product_category,
                      warehouse.fn_finance_structure(s.sale_type, s.amount_financed),
                      v.condition_type)
        )::numeric        AS eligible_contracts
    FROM warehouse.fact_finance_product_sale AS ps
    JOIN warehouse.fact_vehicle_sale AS s ON s.sale_key = ps.sale_key
    JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
    JOIN warehouse.dim_finance_product AS p ON p.finance_product_key = ps.finance_product_key
),
adjustment_bounds AS (
    -- THE CAP, checked over each contract's WHOLE event history. Cumulative net
    -- reduction must land inside [0, original gross]; the running check after every
    -- single event is DQ-FPA-007's, because SQL that walked the sequence here would
    -- duplicate the Python state machine rather than corroborate it.
    SELECT
        count(*)::numeric AS adjusted_contracts,
        count(*) FILTER (
            WHERE reduction >= 0 AND reduction <= original_gross
        )::numeric        AS conforming_contracts
    FROM (
        SELECT
            ps.product_sale_key,
            ps.original_product_gross      AS original_gross,
            sum(a.adjustment_amount)       AS reduction
        FROM warehouse.fact_finance_product_adjustment AS a
        JOIN warehouse.fact_finance_product_sale AS ps
          ON ps.product_sale_key = a.product_sale_key
        GROUP BY ps.product_sale_key, ps.original_product_gross
    ) AS per_contract
),
adjustment_sequence AS (
    -- Two things at once: no event predates its own contract, and no reinstatement
    -- exists on a contract that never had a reduction to reinstate.
    SELECT
        (SELECT count(*)
         FROM warehouse.fact_finance_product_adjustment AS a
         JOIN warehouse.fact_finance_product_sale AS ps
           ON ps.product_sale_key = a.product_sale_key
         WHERE a.adjustment_date_key < ps.sale_date_key)::numeric      AS pre_sale_events,
        (SELECT count(*)
         FROM (
            SELECT a.product_sale_key,
                   count(*) FILTER (WHERE a.adjustment_type = 'Reinstatement') AS reinstatements,
                   count(*) FILTER (
                       WHERE a.adjustment_type IN ('Cancellation', 'Chargeback')) AS reductions
            FROM warehouse.fact_finance_product_adjustment AS a
            GROUP BY a.product_sale_key
         ) AS per_contract
         WHERE reinstatements > 0 AND reductions = 0)::numeric         AS orphan_reinstatements,
        (SELECT count(*) FROM warehouse.fact_finance_product_adjustment)::numeric
                                                                        AS adjustment_rows
),
net_gross AS (
    -- The as-of side, on its OWN basis. Warehouse derivation against the reporting view.
    SELECT
        (SELECT coalesce(sum(ps.original_product_gross), 0)
                - coalesce((
                    SELECT sum(a.adjustment_amount)
                    FROM warehouse.fact_finance_product_adjustment AS a
                    JOIN warehouse.dim_date AS ad ON ad.date_key = a.adjustment_date_key
                    CROSS JOIN governed_as_of AS g
                    WHERE ad.full_date <= g.as_of_date
                  ), 0)
         FROM warehouse.fact_finance_product_sale AS ps)               AS warehouse_net,
        (SELECT coalesce(sum(s.net_product_gross_as_of), 0)
         FROM reporting.vw_fi_summary AS s)                            AS view_net
),
view_shape AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_deal_product_detail)::numeric        AS detail_rows,
        (SELECT count(DISTINCT product_sale_id)
         FROM reporting.vw_deal_product_detail)::numeric                        AS detail_distinct,
        (SELECT count(*) FROM reporting.vw_fi_summary)::numeric                 AS summary_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, sale_date_key, finance_manager_grain_key
            FROM reporting.vw_fi_summary
        ) AS g)::numeric                                                        AS summary_distinct,
        (SELECT count(*) FROM reporting.vw_fi_product_penetration)::numeric     AS penetration_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, sale_date_key, finance_manager_grain_key,
                            product_category
            FROM reporting.vw_fi_product_penetration
        ) AS g)::numeric                                                        AS penetration_distinct,
        (SELECT count(*) FROM reporting.vw_fi_adjustment_summary)::numeric      AS adjustment_view_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, adjustment_date_key, finance_manager_grain_key,
                            product_category, adjustment_type
            FROM reporting.vw_fi_adjustment_summary
        ) AS g)::numeric                                                        AS adjustment_view_distinct,
        (SELECT coalesce(sum(adjustment_count), 0)
         FROM reporting.vw_fi_adjustment_summary)::numeric                      AS adjustment_view_events
)

-- RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE ---------------------------------------
SELECT
    'RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE'::text AS reconciliation_id,
    format('Every accepted staging contract reaches the warehouse: %s staging row(s) against %s '
           'warehouse row(s). A contract lost between the two layers reduces a deal''s explained '
           'back-end gross without reducing the stored back-end gross, so RECON-FI-001 would fail '
           'immediately after -- but this rule names WHICH layer lost it.',
           c.staging_product_rows, c.warehouse_product_rows)          AS description,
    'staging.stg_finance_product_sale'::text                          AS left_source,
    c.staging_product_rows                                            AS left_value,
    'warehouse.fact_finance_product_sale'::text                       AS right_source,
    c.warehouse_product_rows                                          AS right_value,
    0::numeric                                                        AS tolerance,
    CASE WHEN c.staging_product_rows = c.warehouse_product_rows
         THEN 'passed' ELSE 'failed' END                              AS status
FROM chain AS c

UNION ALL

-- RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE ---------------------------------
SELECT
    'RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE'::text,
    format('Every accepted staging adjustment reaches the warehouse: %s staging row(s) against %s '
           'warehouse row(s). A lost adjustment makes retained gross look HIGHER than it was, which '
           'is the direction nobody investigates.',
           c.staging_adjustment_rows, c.warehouse_adjustment_rows),
    'staging.stg_finance_product_adjustment',
    c.staging_adjustment_rows,
    'warehouse.fact_finance_product_adjustment',
    c.warehouse_adjustment_rows,
    0::numeric,
    CASE WHEN c.staging_adjustment_rows = c.warehouse_adjustment_rows
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-FI-001 -- THE HEADLINE IDENTITY, per deal ---------------------------------
SELECT
    'RECON-FI-001'::text,
    format('Deal-date back-end gross is explained by its components on %s of %s deal(s): '
           'back_end_gross = finance_reserve_gross + SUM(original_product_gross), with '
           'other_fi_income exactly 0.00 and no balancing plug. EXACT and PER DEAL, because two '
           'deals with offsetting errors would hide each other in a total. This rule deliberately '
           'does NOT compare deal-date back gross to post-adjustment NET product gross: a later '
           'cancellation is supposed to make retained gross differ from produced gross, and calling '
           'that an error would turn the domain''s central distinction into a permanent failure.',
           d.conforming_deals, d.deals),
    'warehouse.fact_vehicle_sale deals whose back-end gross is explained',
    d.conforming_deals,
    'warehouse.fact_vehicle_sale deals',
    d.deals,
    0::numeric,
    CASE WHEN d.conforming_deals = d.deals THEN 'passed' ELSE 'failed' END
FROM deal_identity AS d

UNION ALL

-- RECON-FI-DEAL-LEVEL -- the same identity as a group total -----------------------
SELECT
    'RECON-FI-DEAL-LEVEL'::text,
    format('Group totals agree: %s of back-end gross against %s of finance reserve plus %s of '
           'deal-date product gross. Exact, with no tolerance -- every F&I amount is produced by '
           'exact Decimal arithmetic and the allocation lands on the cent by largest-remainder '
           'construction, so there is nothing for a tolerance to absorb except a defect.',
           g.back_end_gross, g.reserve_gross, g.product_gross),
    'warehouse.fact_vehicle_sale back_end_gross',
    g.back_end_gross,
    'finance_reserve_gross + warehouse.fact_finance_product_sale original_product_gross',
    g.reserve_gross + g.product_gross,
    0::numeric,
    CASE WHEN g.back_end_gross = g.reserve_gross + g.product_gross
         THEN 'passed' ELSE 'failed' END
FROM gross_totals AS g

UNION ALL

-- RECON-FI-TOTAL-GROSS -- the pre-existing identity still holds -------------------
SELECT
    'RECON-FI-TOTAL-GROSS'::text,
    format('total_gross = front_end_gross + back_end_gross still holds on all %s sale(s): %s '
           'violation(s). DASH.6 added two columns to this fact and redefined none, so the identity '
           'that predates it must be exactly as true afterwards. A failure here means the F&I '
           'increment changed something it had no business changing.',
           g.sale_rows, g.broken_total_gross),
    'warehouse.fact_vehicle_sale rows breaking total = front + back',
    g.broken_total_gross,
    'permitted violations',
    0::numeric,
    0::numeric,
    CASE WHEN g.broken_total_gross = 0 THEN 'passed' ELSE 'failed' END
FROM gross_totals AS g

UNION ALL

-- RECON-FI-PRODUCT-IDENTITY -- price minus cost equals gross ----------------------
SELECT
    'RECON-FI-PRODUCT-IDENTITY'::text,
    format('original_product_gross = product_retail_price - product_dealer_cost on %s of %s '
           'contract(s), exact to the cent. This is the arithmetic every product gross measure '
           'depends on; a cent of drift means a float reached a monetary value.',
           p.conforming_contracts, p.contracts),
    'warehouse.fact_finance_product_sale conforming contracts',
    p.conforming_contracts,
    'warehouse.fact_finance_product_sale contracts',
    p.contracts,
    0::numeric,
    CASE WHEN p.conforming_contracts = p.contracts THEN 'passed' ELSE 'failed' END
FROM product_identity AS p

UNION ALL

-- RECON-FI-PRODUCT-GRAIN ----------------------------------------------------------
SELECT
    'RECON-FI-PRODUCT-GRAIN'::text,
    format('warehouse.fact_finance_product_sale holds %s row(s) over %s distinct (deal, product) '
           'combination(s). The declared grain is enforced by uq_fact_finance_product_sale_grain; '
           'this proves the constraint is still on the table rather than trusting that it is.',
           c.warehouse_product_rows, c.distinct_product_grain),
    'warehouse.fact_finance_product_sale row count',
    c.warehouse_product_rows,
    'warehouse.fact_finance_product_sale distinct declared grain',
    c.distinct_product_grain,
    0::numeric,
    CASE WHEN c.warehouse_product_rows = c.distinct_product_grain
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-FI-ADJUSTMENT-GRAIN -------------------------------------------------------
SELECT
    'RECON-FI-ADJUSTMENT-GRAIN'::text,
    format('warehouse.fact_finance_product_adjustment holds %s row(s) over %s distinct '
           'adjustment_id(s). The grain is the EVENT: a contract may legitimately carry several, '
           'and two may legitimately share a date, so nothing narrower would be correct.',
           c.warehouse_adjustment_rows, c.distinct_adjustment_grain),
    'warehouse.fact_finance_product_adjustment row count',
    c.warehouse_adjustment_rows,
    'warehouse.fact_finance_product_adjustment distinct adjustment_id',
    c.distinct_adjustment_grain,
    0::numeric,
    CASE WHEN c.warehouse_adjustment_rows = c.distinct_adjustment_grain
         THEN 'passed' ELSE 'failed' END
FROM chain AS c

UNION ALL

-- RECON-FI-STORE-TOTALS -----------------------------------------------------------
SELECT
    'RECON-FI-STORE-TOTALS'::text,
    format('Deal-date product gross agrees between the warehouse and reporting.vw_fi_summary for '
           '%s of %s store(s), within the 0.01 currency tolerance. Compared PER STORE rather than '
           'in total, so two offsetting stores cannot hide each other.',
           s.conforming_stores, s.stores),
    'stores whose warehouse and reporting product gross agree',
    s.conforming_stores,
    'stores carrying a contract',
    s.stores,
    0.01::numeric,
    CASE WHEN s.conforming_stores = s.stores THEN 'passed' ELSE 'failed' END
FROM store_totals AS s

UNION ALL

-- RECON-FI-PERIOD-TOTALS ----------------------------------------------------------
SELECT
    'RECON-FI-PERIOD-TOTALS'::text,
    format('The same comparison per month: %s of %s month(s) agree. A month dropped by the '
           'reporting frame fails here rather than rendering as a month in which the F&I office '
           'wrote nothing.',
           m.conforming_periods, m.periods),
    'months whose warehouse and reporting product gross agree',
    m.conforming_periods,
    'months carrying a contract',
    m.periods,
    0.01::numeric,
    CASE WHEN m.conforming_periods = m.periods THEN 'passed' ELSE 'failed' END
FROM period_totals AS m

UNION ALL

-- RECON-FI-RESERVE-STRUCTURE ------------------------------------------------------
SELECT
    'RECON-FI-RESERVE-STRUCTURE'::text,
    format('Finance reserve appears only where the structure can produce it on %s of %s retail '
           'deal(s), and %s cash deal(s) name a lender. Reserve is earned on financing: a cash deal '
           'financed nothing and ARPI models no lease rate mechanic, so both carry exactly 0.00. '
           'The fact''s CHECK covers what one row can decide; this re-asks it over the whole table, '
           'so a constraint dropped from a deployed database fails a run rather than passing.',
           r.conforming_deals, r.retail_deals, r.cash_deals_with_a_lender),
    'retail deals whose reserve and lender agree with their structure',
    r.conforming_deals - r.cash_deals_with_a_lender,
    'retail deals',
    r.retail_deals,
    0::numeric,
    CASE WHEN r.conforming_deals = r.retail_deals AND r.cash_deals_with_a_lender = 0
         THEN 'passed' ELSE 'failed' END
FROM reserve_structure AS r

UNION ALL

-- RECON-FI-ELIGIBILITY ------------------------------------------------------------
SELECT
    'RECON-FI-ELIGIBILITY'::text,
    format('%s of %s contract(s) satisfy their category''s governed eligibility rule, asked through '
           'the same warehouse.fn_product_category_is_eligible that builds the penetration '
           'denominator. A contract outside its own denominator would make a penetration figure '
           'exceed 100%% for a reason no reader could see -- GAP on a cash deal, or Lease Wear '
           'Protection on a purchase.',
           e.eligible_contracts, e.contracts),
    'contracts satisfying their eligibility rule',
    e.eligible_contracts,
    'contracts',
    e.contracts,
    0::numeric,
    CASE WHEN e.eligible_contracts = e.contracts THEN 'passed' ELSE 'failed' END
FROM eligibility AS e

UNION ALL

-- RECON-FI-ADJUSTMENT-CAP ---------------------------------------------------------
SELECT
    'RECON-FI-ADJUSTMENT-CAP'::text,
    format('Cumulative net reduction stays inside [0, original product gross] on %s of %s adjusted '
           'contract(s). An ordinary adjustment cannot take back more than was produced, and a '
           'reinstatement cannot restore more than was taken -- net retained gross above the '
           'original would be gross the deal never made.',
           b.conforming_contracts, b.adjusted_contracts),
    'adjusted contracts inside the cap',
    b.conforming_contracts,
    'adjusted contracts',
    b.adjusted_contracts,
    0::numeric,
    CASE WHEN b.conforming_contracts = b.adjusted_contracts THEN 'passed' ELSE 'failed' END
FROM adjustment_bounds AS b

UNION ALL

-- RECON-FI-ADJUSTMENT-SEQUENCE ----------------------------------------------------
SELECT
    'RECON-FI-ADJUSTMENT-SEQUENCE'::text,
    format('Across %s adjustment event(s): %s predate their own contract and %s contract(s) carry a '
           'reinstatement with no reduction to reinstate. Both must be zero. Cancelling a contract '
           'before it was written is an impossible sequence, and a reinstatement with nothing to '
           'reinstate creates gross the deal never produced.',
           q.adjustment_rows, q.pre_sale_events, q.orphan_reinstatements),
    'impossible adjustment sequences',
    q.pre_sale_events + q.orphan_reinstatements,
    'permitted impossible sequences',
    0::numeric,
    0::numeric,
    CASE WHEN q.pre_sale_events = 0 AND q.orphan_reinstatements = 0
         THEN 'passed' ELSE 'failed' END
FROM adjustment_sequence AS q

UNION ALL

-- RECON-FI-NET-GROSS --------------------------------------------------------------
SELECT
    'RECON-FI-NET-GROSS'::text,
    format('As-of net product gross agrees between an independent warehouse derivation (%s) and '
           'reporting.vw_fi_summary (%s), within the 0.01 currency tolerance. This is the AS-OF '
           'side, reconciled on its OWN basis: it is not compared to deal-date back gross, because '
           'a later cancellation is supposed to make the two differ.',
           n.warehouse_net, n.view_net),
    'warehouse net product gross as of the governed date',
    n.warehouse_net,
    'reporting.vw_fi_summary net_product_gross_as_of',
    n.view_net,
    0.01::numeric,
    CASE WHEN abs(n.warehouse_net - n.view_net) <= 0.01 THEN 'passed' ELSE 'failed' END
FROM net_gross AS n

UNION ALL

-- RECON-REPORT-FI-DETAIL-ROWS -----------------------------------------------------
SELECT
    'RECON-REPORT-FI-DETAIL-ROWS'::text,
    format('reporting.vw_deal_product_detail returns %s row(s) over %s distinct contract(s), '
           'against %s warehouse contract(s). It joins an adjustment aggregate; joining the '
           'adjustment fact directly would fan a contract with three events into three rows and '
           'triple its gross for anything that summed the view.',
           w.detail_rows, w.detail_distinct, c.warehouse_product_rows),
    'reporting.vw_deal_product_detail row count',
    w.detail_rows,
    'warehouse.fact_finance_product_sale row count',
    c.warehouse_product_rows,
    0::numeric,
    CASE WHEN w.detail_rows = w.detail_distinct
          AND w.detail_rows = c.warehouse_product_rows
         THEN 'passed' ELSE 'failed' END
FROM view_shape AS w CROSS JOIN chain AS c

UNION ALL

-- RECON-REPORT-FI-SUMMARY-ROWS ----------------------------------------------------
SELECT
    'RECON-REPORT-FI-SUMMARY-ROWS'::text,
    format('reporting.vw_fi_summary returns %s row(s) over %s distinct (store, sale date, manager) '
           'combination(s). A fan-out here would double the store''s retail units AND its finance '
           'reserve, which is invisible in a PVR because both sides move together.',
           w.summary_rows, w.summary_distinct),
    'reporting.vw_fi_summary row count',
    w.summary_rows,
    'reporting.vw_fi_summary distinct declared grain',
    w.summary_distinct,
    0::numeric,
    CASE WHEN w.summary_rows = w.summary_distinct THEN 'passed' ELSE 'failed' END
FROM view_shape AS w

UNION ALL

-- RECON-REPORT-FI-PENETRATION-ROWS ------------------------------------------------
SELECT
    'RECON-REPORT-FI-PENETRATION-ROWS'::text,
    format('reporting.vw_fi_product_penetration returns %s row(s) over %s distinct (store, sale '
           'date, manager, category) combination(s). A fan-out would inflate the eligible '
           'denominator, which makes every penetration figure SMALLER -- the direction that looks '
           'like a finding rather than a defect.',
           w.penetration_rows, w.penetration_distinct),
    'reporting.vw_fi_product_penetration row count',
    w.penetration_rows,
    'reporting.vw_fi_product_penetration distinct declared grain',
    w.penetration_distinct,
    0::numeric,
    CASE WHEN w.penetration_rows = w.penetration_distinct THEN 'passed' ELSE 'failed' END
FROM view_shape AS w

UNION ALL

-- RECON-REPORT-FI-ADJUSTMENT-ROWS -------------------------------------------------
SELECT
    'RECON-REPORT-FI-ADJUSTMENT-ROWS'::text,
    format('reporting.vw_fi_adjustment_summary returns %s row(s) over %s distinct (store, '
           'adjustment date, manager, category, type) combination(s), and accounts for %s of %s '
           'warehouse adjustment event(s). Both halves matter: the first proves no fan-out, the '
           'second proves no event was dropped by a join.',
           w.adjustment_view_rows, w.adjustment_view_distinct, w.adjustment_view_events,
           c.warehouse_adjustment_rows),
    'reporting.vw_fi_adjustment_summary events accounted for',
    w.adjustment_view_events,
    'warehouse.fact_finance_product_adjustment row count',
    c.warehouse_adjustment_rows,
    0::numeric,
    CASE WHEN w.adjustment_view_rows = w.adjustment_view_distinct
          AND w.adjustment_view_events = c.warehouse_adjustment_rows
         THEN 'passed' ELSE 'failed' END
FROM view_shape AS w CROSS JOIN chain AS c;

COMMENT ON VIEW audit.vw_recon_fi IS
    'Grain: one row per RECON-FI-* / F&I-domain reconciliation rule, in the uniform shape of '
    'audit.vw_recon_result_template. RECON-FI-001 is the headline: every cent of a deal''s DEAL-DATE '
    'back-end gross is explained by finance reserve plus deal-date product gross, with other_fi_income '
    'exactly 0.00 and no balancing plug -- checked PER DEAL and EXACTLY, because two deals with '
    'offsetting errors would hide each other in a total. It deliberately does NOT compare deal-date back '
    'gross to post-adjustment net product gross: a later cancellation is SUPPOSED to make retained gross '
    'differ from produced gross, and calling that an error would turn the domain''s central distinction '
    'into a permanent failing check -- RECON-FI-NET-GROSS reconciles the as-of side on its own basis '
    'instead. The family also proves the two staging-to-warehouse chains, both declared grains, the '
    'product price identity, that total = front + back is exactly as true after DASH.6 as before it, that '
    'reserve and lender appear only where the structure permits, that every contract sits inside its own '
    'eligibility denominator, the cumulative adjustment cap, that no event predates its contract and no '
    'reinstatement is an orphan, and that none of the four F&I reporting views fans out. Identity '
    'comparisons use tolerance 0 because exact Decimal arithmetic and largest-remainder allocation leave '
    'nothing for a tolerance to absorb except a defect; the two comparisons that cross a grain boundary '
    'use the project-wide 0.01 currency tolerance and say so.';
