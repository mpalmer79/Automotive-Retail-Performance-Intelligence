-- =============================================================================
-- File:            sql/05_reporting/47_vw_fi_product_penetration.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_fi_product_penetration — penetration with its own eligible denominator, and the per-category economics, at store x sale date x finance manager x category.
-- Execution order: Reporting layer, after the F&I facts and the governed F&I functions exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per dealership, per SALE DATE, per finance manager, per governed product category that was ELIGIBLE on at least one of that group's deals.
-- =============================================================================
--
-- Delivery increment: DASH.6. Anchoring question SQ-21.
--
-- THIS VIEW EXISTS TO MAKE ELIGIBILITY AUDITABLE
-- -----------------------------------------------
-- A penetration figure is only meaningful beside the denominator it was computed over,
-- and the denominator is the thing that is easy to get wrong. GAP penetration over ALL
-- retail deals is a smaller number than GAP penetration over FINANCED retail deals, both
-- look plausible, and only one of them means anything -- a cash buyer cannot buy GAP,
-- because there is no loan for it to cover. So this view publishes the numerator, the
-- denominator and the ELIG-* rule that produced the denominator, on every row, and the
-- ratio itself is left to the consumer.
--
-- HOW THE DENOMINATOR IS BUILT, AND WHY IT IS NOT A FILTER ON THE CONTRACTS
-- -------------------------------------------------------------------------
-- Rows here are generated from the DEALS, not from the contracts: every retail deal is
-- crossed with the ten governed categories and kept where
-- warehouse.fn_product_category_is_eligible says the deal could have carried it. So a
-- category with an eligible population and NO sales produces a row with a zero numerator,
-- which is a finding. Building the view from the contracts instead would make that row
-- vanish, and a category nobody sold would render identically to a category nobody could
-- have sold.
--
-- THE PREDICATE HAS ONE AUTHORITY. warehouse.fn_product_category_is_eligible reads
-- warehouse.dim_finance_product, which the generator stamps from
-- config/reference/fi_product_eligibility.yaml. No layer restates the rule.
--
-- PENETRATION COUNTS DISTINCT DEALS, NOT CONTRACT ROWS
-- -----------------------------------------------------
-- attached_deal_count is count(DISTINCT sale_key) and contract_count is the row count.
-- They differ, because one deal may carry two DIFFERENT products of one category -- a
-- windscreen plan and a roadside plan are both Other Aftermarket Products. A penetration
-- computed as contract_count / eligible_deal_count would exceed the share of deals that
-- bought anything, and could exceed 100%. Both columns are published so the correct one
-- is available and the incorrect one is visibly a different number.
--
-- WHAT IS DELIBERATELY ABSENT: NO finance reserve and NO retail-unit column. Both are
-- properties of a DEAL, and a deal appears on as many rows here as it has eligible
-- categories -- up to nine. Publishing either would invite a sum that multiplied it by
-- the category count. reporting.vw_fi_summary owns them, at a grain where they appear once.
--
-- DATE BASIS: SALE DATE throughout, including the adjustment columns, which are
-- attributed to the CONTRACT'S sale date rather than to the event's own date. That makes
-- net_product_gross_as_of an as-of restatement of the deal-date figure on the same row.
-- Adjustment-PERIOD analysis is reporting.vw_fi_adjustment_summary's and is grained on
-- the event's date instead.
--
-- MINIMUM SAMPLE: published, never applied. The denominator is eligible_deal_count.
--
-- NO BENCHMARK EXISTS. There is no good penetration rate and no bad one. Every figure
-- here is descriptive of a synthetic dataset, and no value may be compared to any
-- published market figure or described as "should".
--
-- EXPORT BOUNDARY: DASH.6 exports NO browser dataset from this view.

CREATE OR REPLACE VIEW reporting.vw_fi_product_penetration AS
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
governed_categories AS (
    -- The ten categories and the rule each one owns, read from the dimension the
    -- configuration was stamped onto. DISTINCT because several products share a category
    -- and they necessarily share its rule -- DQ-FPD-006 asserts that, so this cannot
    -- silently produce two rows for one category.
    SELECT DISTINCT p.product_category, p.eligibility_rule_id
    FROM warehouse.dim_finance_product AS p
),
deal_base AS (
    SELECT
        s.sale_key,
        s.dealership_key,
        s.sale_date_key,
        s.finance_manager_key,
        coalesce(s.finance_manager_key, 0)                                AS finance_manager_grain_key,
        warehouse.fn_finance_structure(s.sale_type, s.amount_financed)    AS finance_structure,
        v.condition_type
    FROM warehouse.fact_vehicle_sale AS s
    JOIN warehouse.dim_vehicle AS v ON v.vehicle_key = s.vehicle_key
    WHERE s.is_retail
),
eligible_deals AS (
    -- THE DENOMINATOR. One row per (deal, category) the deal could have carried.
    SELECT
        d.dealership_key,
        d.sale_date_key,
        d.finance_manager_key,
        d.finance_manager_grain_key,
        c.product_category,
        c.eligibility_rule_id,
        d.sale_key
    FROM deal_base AS d
    CROSS JOIN governed_categories AS c
    WHERE warehouse.fn_product_category_is_eligible(
              c.product_category, d.finance_structure, d.condition_type)
),
eligible_totals AS (
    SELECT
        e.dealership_key,
        e.sale_date_key,
        e.finance_manager_key,
        e.finance_manager_grain_key,
        e.product_category,
        e.eligibility_rule_id,
        count(DISTINCT e.sale_key)::integer AS eligible_deal_count
    FROM eligible_deals AS e
    GROUP BY e.dealership_key, e.sale_date_key, e.finance_manager_key,
             e.finance_manager_grain_key, e.product_category, e.eligibility_rule_id
),
attached_totals AS (
    -- THE NUMERATOR, plus the category economics KPI-FNI-020 needs. Aggregated to the
    -- same grain BEFORE the join, so contracts cannot fan the denominator out.
    SELECT
        ps.dealership_key,
        ps.sale_date_key,
        coalesce(ps.finance_manager_key, 0)     AS finance_manager_grain_key,
        p.product_category,
        count(DISTINCT ps.sale_key)::integer    AS attached_deal_count,
        sum(ps.product_sale_count)::integer     AS contract_count,
        sum(ps.product_retail_price)            AS product_retail_price,
        sum(ps.product_dealer_cost)             AS product_dealer_cost,
        sum(ps.original_product_gross)          AS original_product_gross
    FROM warehouse.fact_finance_product_sale AS ps
    JOIN warehouse.dim_finance_product AS p
      ON p.finance_product_key = ps.finance_product_key
    GROUP BY ps.dealership_key, ps.sale_date_key,
             coalesce(ps.finance_manager_key, 0), p.product_category
),
adjustment_totals AS (
    SELECT
        ps.dealership_key,
        ps.sale_date_key,
        coalesce(ps.finance_manager_key, 0)     AS finance_manager_grain_key,
        p.product_category,
        sum(a.adjustment_amount)                AS cumulative_adjustment_amount,
        count(*)::integer                       AS adjustment_event_count
    FROM warehouse.fact_finance_product_adjustment AS a
    JOIN warehouse.fact_finance_product_sale AS ps
      ON ps.product_sale_key = a.product_sale_key
    JOIN warehouse.dim_finance_product AS p
      ON p.finance_product_key = ps.finance_product_key
    JOIN warehouse.dim_date AS ad ON ad.date_key = a.adjustment_date_key
    CROSS JOIN governed_as_of AS g
    WHERE ad.full_date <= g.as_of_date
    GROUP BY ps.dealership_key, ps.sale_date_key,
             coalesce(ps.finance_manager_key, 0), p.product_category
)
SELECT
    -- Grain -------------------------------------------------------------------
    e.dealership_key,
    store.dealership_id,
    store.store_short_name,
    e.sale_date_key,
    sd.full_date                                                    AS sale_date,
    e.finance_manager_key,
    manager.employee_id                                             AS finance_manager_id,
    e.finance_manager_grain_key,
    e.product_category,
    e.eligibility_rule_id,

    -- Penetration, as components ----------------------------------------------
    coalesce(a.attached_deal_count, 0)                              AS penetration_numerator,
    e.eligible_deal_count                                           AS penetration_denominator,
    coalesce(a.attached_deal_count, 0)                              AS attached_deal_count,
    e.eligible_deal_count,
    coalesce(a.contract_count, 0)                                   AS contract_count,

    -- Category economics (KPI-FNI-020) ----------------------------------------
    coalesce(a.product_retail_price, 0.00)                          AS product_retail_price,
    coalesce(a.product_dealer_cost, 0.00)                           AS product_dealer_cost,
    coalesce(a.original_product_gross, 0.00)                        AS original_product_gross,
    coalesce(adj.adjustment_event_count, 0)                         AS adjustment_event_count,
    coalesce(adj.cumulative_adjustment_amount, 0.00)                AS cumulative_adjustment_amount,
    coalesce(a.original_product_gross, 0.00)
        - coalesce(adj.cumulative_adjustment_amount, 0.00)          AS net_product_gross_as_of,

    -- Minimum-sample context, published rather than applied --------------------
    warehouse.fn_minimum_sample_floor()                             AS minimum_sample_floor,
    (e.eligible_deal_count
        >= warehouse.fn_minimum_sample_floor())                     AS meets_minimum_sample,

    -- Basis context -----------------------------------------------------------
    g.as_of_date,
    'sale date'::text                                               AS deal_date_basis,
    'adjustment date <= as_of_date, attributed to the contract''s sale date'::text
                                                                    AS net_gross_date_basis
FROM eligible_totals AS e
JOIN warehouse.dim_dealership AS store ON store.dealership_key = e.dealership_key
JOIN warehouse.dim_date AS sd ON sd.date_key = e.sale_date_key
LEFT JOIN warehouse.dim_employee AS manager ON manager.employee_key = e.finance_manager_key
LEFT JOIN attached_totals AS a
       ON a.dealership_key = e.dealership_key
      AND a.sale_date_key = e.sale_date_key
      AND a.finance_manager_grain_key = e.finance_manager_grain_key
      AND a.product_category = e.product_category
LEFT JOIN adjustment_totals AS adj
       ON adj.dealership_key = e.dealership_key
      AND adj.sale_date_key = e.sale_date_key
      AND adj.finance_manager_grain_key = e.finance_manager_grain_key
      AND adj.product_category = e.product_category
CROSS JOIN governed_as_of AS g;

COMMENT ON VIEW reporting.vw_fi_product_penetration IS
    'Grain: ONE ROW PER DEALERSHIP, PER SALE DATE, PER FINANCE MANAGER, PER GOVERNED PRODUCT CATEGORY '
    'THAT WAS ELIGIBLE on at least one of that group''s retail deals. Rows are generated from the DEALS '
    'and not from the contracts, so a category with an eligible population and NO sales produces a row '
    'with a zero numerator -- which is a finding. Building it from the contracts would make that row '
    'vanish and a category nobody sold would render identically to one nobody could have sold. THE '
    'DENOMINATOR IS THE POINT: penetration is only meaningful beside the population it was computed over, '
    'so penetration_numerator, penetration_denominator and the ELIG-* rule that produced the denominator '
    'are all on every row and the ratio itself is left to the consumer. GAP penetration over ALL retail '
    'deals and over FINANCED retail deals are different numbers and only the second means anything, '
    'because a cash buyer has no loan for GAP to cover. PENETRATION COUNTS DISTINCT DEALS: '
    'attached_deal_count is count(DISTINCT deal) and contract_count is the row count, and they differ '
    'because one deal may carry two DIFFERENT products of one category -- a contract-row penetration could '
    'exceed 100%. NO FINANCE RESERVE AND NO RETAIL-UNIT COLUMN EXIST HERE, deliberately: a deal appears on '
    'as many rows as it has eligible categories, so publishing either would invite a sum that multiplied '
    'it by the category count. reporting.vw_fi_summary owns them at a grain where they appear once. DATE '
    'BASIS: sale date throughout, including the adjustment columns, which are attributed to the '
    'CONTRACT''S sale date; adjustment-PERIOD analysis is reporting.vw_fi_adjustment_summary''s. MINIMUM '
    'SAMPLE is published and never applied, over eligible_deal_count. NO BENCHMARK EXISTS -- there is no '
    'good penetration rate and no bad one, every figure is descriptive of a SYNTHETIC dataset, and no '
    'value may be compared to a published market figure or described as what a store "should" achieve. '
    'Owns KPI-FNI-007, -008, -009, -010, -020 and -021, and the category slice of -011. DASH.6 exports no '
    'browser dataset from this view: DASH.7 owns the F&I presentation surface.';

COMMENT ON COLUMN reporting.vw_fi_product_penetration.dealership_key IS 'Surrogate key of the store. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.dealership_id IS 'Business identifier of the store, GSA-###.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.store_short_name IS 'Abbreviated fictional store name. Names a business, never a person.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.sale_date_key IS 'Date key of the sale date. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.sale_date IS 'THE SALE-DATE BASIS, which every column on this row is on -- including the adjustment columns, which are attributed to the contract''s sale date rather than to the event''s own date.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.finance_manager_key IS 'Surrogate key of the F&I manager, or NULL for the "nobody on the F&I desk" group.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.finance_manager_id IS 'Synthetic identifier of that manager, or NULL. Never a name.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.finance_manager_grain_key IS 'coalesce(finance_manager_key, 0), NOT NULL. Part of the declared grain, so uniqueness at the grain is checkable: PostgreSQL treats NULLs as distinct and a nullable grain column could not be verified at all.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.product_category IS 'One of the ten governed categories. Part of the declared grain. A ROW VALUE, never a column: ARPI has no vsc_gross and never will.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.eligibility_rule_id IS 'The ELIG-* rule that produced this row''s denominator, from config/reference/fi_product_eligibility.yaml. PUBLISHED ON EVERY ROW so a penetration figure names its own denominator rather than leaving a reader to assume one.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.penetration_numerator IS 'KPI-FNI-007/008/009/010/021 numerator: DISTINCT eligible deals in this group carrying at least one contract of this category. A deal with two contracts of one category counts ONCE. Additive at this grain.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.penetration_denominator IS 'The matching denominator: distinct deals in this group that satisfied the category''s ELIG-* rule. Additive at this grain. A group penetration is SUM(numerator)/SUM(denominator) and NEVER the average of the per-row percentages.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.attached_deal_count IS 'Same value as penetration_numerator, named for the reader rather than for the formula. 0 rather than NULL when the category was eligible and nothing was sold, which is a finding and not an absence.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.eligible_deal_count IS 'Same value as penetration_denominator, named for the reader. Also the minimum-sample denominator.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.contract_count IS 'Contracts of this category written in this group. Additive. DIFFERENT FROM attached_deal_count wherever a deal carried two different products of one category. Divide gross by THIS for gross per contract (KPI-FNI-011); never use it as a penetration numerator.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.product_retail_price IS 'Sum of SYNTHETIC contract prices in this category. Additive. Component of KPI-FNI-020. Never a market or recommended price.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.product_dealer_cost IS 'Sum of SYNTHETIC contract costs in this category. Additive. Component of KPI-FNI-020.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.original_product_gross IS 'Deal-date product gross in this category. Additive, exact. Component of KPI-FNI-020, and the numerator of the category slice of KPI-FNI-011. A category MIX SHARE is this value over the all-category total at the SAME grain and basis -- never an average of percentages, and never a sum of them.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.adjustment_event_count IS 'Adjustment events through as_of_date on this category''s contracts, attributed to the CONTRACT''S sale date. Additive within the as-of basis.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.cumulative_adjustment_amount IS 'Signed sum of those adjustments. POSITIVE MEANS GROSS WAS TAKEN BACK. 0.00 rather than NULL when nothing was.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.net_product_gross_as_of IS 'original_product_gross - cumulative_adjustment_amount for this category. AS-OF BASIS; not comparable to original_product_gross unless both bases are stated. Component of KPI-FNI-020.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.minimum_sample_floor IS 'The project-default eligible-deal floor from warehouse.fn_minimum_sample_floor(), published as data. A PROJECT DEFAULT FOR A FICTIONAL GROUP -- never a statistical significance threshold or an industry convention.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.meets_minimum_sample IS 'Whether eligible_deal_count reached the floor. PUBLISHED, NOT APPLIED: components are never blanked below it. Below the floor a consumer renders "insufficient sample (n = X)", excludes the row from ranking, and fires no action rule. Manager penetration differences inherit store mix, structure mix and eligibility mix and are never a measure of skill on their own.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.as_of_date IS 'The dataset''s own as-of date, identical in definition to reporting.vw_target_attainment''s. NEVER the wall clock.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.deal_date_basis IS 'Constant label "sale date": the basis every column on this row is on.';
COMMENT ON COLUMN reporting.vw_fi_product_penetration.net_gross_date_basis IS 'Constant label naming the as-of rule, and stating that adjustments are attributed to the contract''s sale date rather than to their own.';
