-- =============================================================================
-- File:            sql/05_reporting/46_vw_fi_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_fi_summary — the reusable F&I components at store x sale date x finance manager, with numerators and denominators published separately.
-- Execution order: Reporting layer, after the F&I facts and warehouse.fn_minimum_sample_floor exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per dealership, per SALE DATE, per finance manager (including the "no manager on the desk" group).
-- =============================================================================
--
-- Delivery increment: DASH.6. Anchoring questions SQ-20 (deepened) and SQ-21.
--
-- THE GRAIN, AND WHY THE CATEGORY IS NOT IN IT
-- ---------------------------------------------
-- This view carries FINANCE RESERVE and RETAIL UNITS. Both are properties of a DEAL, not
-- of a product category, so putting the category in the grain would repeat that store-
-- day's reserve and unit count on every category row -- and anything that summed the
-- result would multiply both by the number of categories sold. That is the single most
-- consequential mistake available in this domain, and the defence is structural rather
-- than advisory: the category is not here at all. Category-grain measures live in
-- reporting.vw_fi_product_penetration, which deliberately carries NO reserve and NO
-- retail-unit column.
--
-- AS-BUILT OWNER CORRECTION, RECORDED RATHER THAN SMOOTHED OVER
-- -------------------------------------------------------------
-- docs/dashboard/KPI_EXTENSION_PLAN.md section 4 assigns KPI-FNI-020 (product-category
-- mix) to "reporting.vw_fi_summary (category grain)". This view has no category grain and
-- cannot acquire one for the reason above, so KPI-FNI-020's governed owner as built is
-- reporting.vw_fi_product_penetration. Correct governance beats preserving a planning
-- assignment; the divergence is recorded in KPI_CATALOG.md and in the plan's as-built note.
--
-- THE MANAGER GROUP INCLUDES "NOBODY ON THE DESK"
-- ------------------------------------------------
-- finance_manager_key is nullable, and PostgreSQL treats NULLs as distinct, so a grain
-- expressed over it could not be checked for uniqueness. finance_manager_grain_key is
-- coalesce(finance_manager_key, 0) and is NOT NULL, so the declared grain is testable and
-- RECON-REPORT-FI-SUMMARY-ROWS can compare the row count to the distinct grain. A deal
-- written with nobody on the F&I desk is a real transaction and belongs in the store's
-- totals; dropping it would make the store total disagree with the deal fact.
--
-- RATIOS ARE PUBLISHED AS COMPONENTS, NEVER AS QUOTIENTS
-- -------------------------------------------------------
-- A ratio cannot be re-aggregated: the group figure is SUM(numerator) / SUM(denominator)
-- and never the average of the store figures. So this view exports the components and
-- lets the consumer divide once, at the grain it is actually reporting at. Every KPI-FNI
-- ratio owned here -- -002, -005, -006, -011, -022 -- has both of its sides as columns.
--
-- THREE DATE BASES, AND THIS VIEW IS ON THE FIRST TWO
-- ----------------------------------------------------
--   DEAL-DATE          retail units, reserve, original product gross, structure counts
--   AS-OF              net product gross, net F&I gross (adjustments <= as_of_date)
--   ADJUSTMENT-PERIOD  NOT here. reporting.vw_fi_adjustment_summary owns it, because it
--                      is grained on a different date and mixing the two on one row
--                      would put two populations behind one grain.
--
-- MINIMUM SAMPLE: published, never applied. meets_minimum_sample marks whether the
-- manager's retail units reached warehouse.fn_minimum_sample_floor(); the view does NOT
-- blank the components below it. Suppression is a rendering decision, and a NULL here
-- would be indistinguishable from a manager who genuinely had no deals. No row is ranked
-- and no manager is labelled here: DASH.7 and DASH.11 own presentation, with context.
--
-- EXPORT BOUNDARY: DASH.6 exports NO browser dataset from this view.

CREATE OR REPLACE VIEW reporting.vw_fi_summary AS
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
deal_base AS (
    -- RETAIL DEALS ONLY. A wholesale or dealer-trade disposal has no consumer, produces
    -- no F&I income and carries no reserve, so including it would add rows whose every
    -- measure is zero and whose structure is not part of the retail mix.
    SELECT
        s.sale_key,
        s.dealership_key,
        s.sale_date_key,
        s.finance_manager_key,
        s.unit_count,
        s.finance_reserve_gross,
        s.back_end_gross,
        warehouse.fn_finance_structure(s.sale_type, s.amount_financed) AS finance_structure
    FROM warehouse.fact_vehicle_sale AS s
    WHERE s.is_retail
),
deal_totals AS (
    SELECT
        d.dealership_key,
        d.sale_date_key,
        d.finance_manager_key,
        coalesce(d.finance_manager_key, 0)                                AS finance_manager_grain_key,
        sum(d.unit_count)::integer                                        AS retail_units,
        count(*) FILTER (WHERE d.finance_structure = 'Cash')::integer     AS cash_deal_count,
        count(*) FILTER (
            WHERE d.finance_structure = 'Retail Finance')::integer        AS retail_finance_deal_count,
        count(*) FILTER (WHERE d.finance_structure = 'Lease')::integer    AS lease_deal_count,
        sum(d.finance_reserve_gross)                                      AS finance_reserve_gross,
        sum(d.back_end_gross)                                             AS back_end_gross_deal_date
    FROM deal_base AS d
    GROUP BY d.dealership_key, d.sale_date_key, d.finance_manager_key
),
contract_totals AS (
    -- Aggregated to the SAME grain before the join, so the contract measures cannot fan
    -- the deal measures out. DQ-FPS-004 and DQ-FPS-006 guarantee a contract's store, date
    -- and manager are its parent deal's, which is what makes this grain-compatible.
    SELECT
        ps.dealership_key,
        ps.sale_date_key,
        coalesce(ps.finance_manager_key, 0)          AS finance_manager_grain_key,
        sum(ps.product_sale_count)::integer          AS contract_count,
        count(DISTINCT ps.sale_key)::integer         AS deals_with_a_product,
        sum(ps.product_retail_price)                 AS product_retail_price,
        sum(ps.product_dealer_cost)                  AS product_dealer_cost,
        sum(ps.original_product_gross)               AS original_product_gross
    FROM warehouse.fact_finance_product_sale AS ps
    GROUP BY ps.dealership_key, ps.sale_date_key, coalesce(ps.finance_manager_key, 0)
),
adjustment_totals AS (
    -- Cumulative adjustments through the governed as-of date, attributed to the
    -- CONTRACT'S OWN store, SALE DATE and manager -- never to the adjustment's date. That
    -- is what makes net product gross an as-of restatement of the deal-date figure rather
    -- than a second, differently-grained number sitting beside it.
    SELECT
        ps.dealership_key,
        ps.sale_date_key,
        coalesce(ps.finance_manager_key, 0)          AS finance_manager_grain_key,
        sum(a.adjustment_amount)                     AS cumulative_adjustment_amount,
        count(*)::integer                            AS adjustment_event_count
    FROM warehouse.fact_finance_product_adjustment AS a
    JOIN warehouse.fact_finance_product_sale AS ps
      ON ps.product_sale_key = a.product_sale_key
    JOIN warehouse.dim_date AS ad ON ad.date_key = a.adjustment_date_key
    CROSS JOIN governed_as_of AS g
    WHERE ad.full_date <= g.as_of_date
    GROUP BY ps.dealership_key, ps.sale_date_key, coalesce(ps.finance_manager_key, 0)
)
SELECT
    -- Grain -------------------------------------------------------------------
    t.dealership_key,
    store.dealership_id,
    store.store_short_name,
    t.sale_date_key,
    sd.full_date                                                    AS sale_date,
    t.finance_manager_key,
    manager.employee_id                                             AS finance_manager_id,
    t.finance_manager_grain_key,

    -- Deal-date denominators --------------------------------------------------
    t.retail_units,
    t.cash_deal_count,
    t.retail_finance_deal_count,
    t.lease_deal_count,

    -- Deal-date F&I production ------------------------------------------------
    t.finance_reserve_gross,
    t.back_end_gross_deal_date,
    coalesce(c.contract_count, 0)                                   AS contract_count,
    coalesce(c.deals_with_a_product, 0)                             AS deals_with_a_product,
    coalesce(c.product_retail_price, 0.00)                          AS product_retail_price,
    coalesce(c.product_dealer_cost, 0.00)                           AS product_dealer_cost,
    coalesce(c.original_product_gross, 0.00)                        AS original_product_gross,
    t.finance_reserve_gross
        + coalesce(c.original_product_gross, 0.00)                  AS original_fi_gross,

    -- As-of restatement -------------------------------------------------------
    coalesce(adj.adjustment_event_count, 0)                         AS adjustment_event_count,
    coalesce(adj.cumulative_adjustment_amount, 0.00)                AS cumulative_adjustment_amount,
    coalesce(c.original_product_gross, 0.00)
        - coalesce(adj.cumulative_adjustment_amount, 0.00)          AS net_product_gross_as_of,
    t.finance_reserve_gross
        + coalesce(c.original_product_gross, 0.00)
        - coalesce(adj.cumulative_adjustment_amount, 0.00)          AS net_fi_gross_as_of,

    -- Minimum-sample context, published rather than applied --------------------
    warehouse.fn_minimum_sample_floor()                             AS minimum_sample_floor,
    (t.retail_units >= warehouse.fn_minimum_sample_floor())         AS meets_minimum_sample,

    -- Basis context -----------------------------------------------------------
    g.as_of_date,
    'sale date'::text                                               AS deal_date_basis,
    'adjustment date <= as_of_date'::text                           AS net_gross_date_basis
FROM deal_totals AS t
JOIN warehouse.dim_dealership AS store ON store.dealership_key = t.dealership_key
JOIN warehouse.dim_date AS sd ON sd.date_key = t.sale_date_key
LEFT JOIN warehouse.dim_employee AS manager ON manager.employee_key = t.finance_manager_key
LEFT JOIN contract_totals AS c
       ON c.dealership_key = t.dealership_key
      AND c.sale_date_key = t.sale_date_key
      AND c.finance_manager_grain_key = t.finance_manager_grain_key
LEFT JOIN adjustment_totals AS adj
       ON adj.dealership_key = t.dealership_key
      AND adj.sale_date_key = t.sale_date_key
      AND adj.finance_manager_grain_key = t.finance_manager_grain_key
CROSS JOIN governed_as_of AS g;

COMMENT ON VIEW reporting.vw_fi_summary IS
    'Grain: ONE ROW PER DEALERSHIP, PER SALE DATE, PER FINANCE MANAGER -- including the "nobody on the '
    'F&I desk" group, which finance_manager_grain_key represents as 0 so the grain is NOT NULL and '
    'therefore testable. RETAIL DEALS ONLY. THE PRODUCT CATEGORY IS DELIBERATELY NOT IN THE GRAIN: this '
    'view carries finance reserve and retail units, both properties of a DEAL, and adding a category '
    'would repeat them on every category row and multiply both for anything that summed the result. '
    'Category-grain measures belong to reporting.vw_fi_product_penetration, which carries no reserve and '
    'no retail-unit column. AS-BUILT OWNER CORRECTION: the planning document assigned KPI-FNI-020 here '
    '"at category grain"; this view has none and cannot acquire one, so KPI-FNI-020''s owner as built is '
    'reporting.vw_fi_product_penetration. RATIOS ARE PUBLISHED AS COMPONENTS, never as quotients -- a '
    'group figure is SUM(numerator)/SUM(denominator) and never the average of store percentages. TWO DATE '
    'BASES, both labelled: DEAL-DATE for retail units, reserve, original product gross and the structure '
    'counts, and AS-OF for net product gross and net F&I gross. The ADJUSTMENT-PERIOD basis is NOT here: '
    'it is grained on a different date and reporting.vw_fi_adjustment_summary owns it. MINIMUM SAMPLE IS '
    'PUBLISHED, NEVER APPLIED: meets_minimum_sample marks whether the manager reached '
    'warehouse.fn_minimum_sample_floor(), and the components are never blanked, because suppression is a '
    'rendering decision and a NULL would be indistinguishable from a manager with no deals. No row is '
    'ranked and no manager is labelled best, worst or underperforming: manager differences inherit store '
    'mix, structure mix and eligibility mix, and DASH.7 and DASH.11 own presentation with that context. '
    'Owns KPI-FNI-001, -002, -003, -004, -005, -006, -011, -019 and -022. Every value is SYNTHETIC and no '
    'penetration or PVR figure here is comparable to any published market figure. DASH.6 exports no '
    'browser dataset from this view.';

COMMENT ON COLUMN reporting.vw_fi_summary.dealership_key IS 'Surrogate key of the store. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_summary.dealership_id IS 'Business identifier of the store, GSA-###.';
COMMENT ON COLUMN reporting.vw_fi_summary.store_short_name IS 'Abbreviated fictional store name, for report headings. Names a business, never a person.';
COMMENT ON COLUMN reporting.vw_fi_summary.sale_date_key IS 'Date key of the sale date. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_summary.sale_date IS 'THE DEAL-DATE BASIS. Retail units, reserve, original product gross and the structure counts all belong to this date.';
COMMENT ON COLUMN reporting.vw_fi_summary.finance_manager_key IS 'Surrogate key of the F&I manager credited on the deals in this group, or NULL for the "nobody on the F&I desk" group. Nullable, which is why finance_manager_grain_key exists beside it.';
COMMENT ON COLUMN reporting.vw_fi_summary.finance_manager_id IS 'Synthetic identifier of that manager, or NULL. A synthetic identifier and never a name.';
COMMENT ON COLUMN reporting.vw_fi_summary.finance_manager_grain_key IS 'coalesce(finance_manager_key, 0), NOT NULL. Part of the declared grain: PostgreSQL treats NULLs as distinct, so a grain expressed over the nullable key could not be checked for uniqueness at all. 0 is the "nobody on the F&I desk" group, which is a real population of real deliveries and is never dropped.';
COMMENT ON COLUMN reporting.vw_fi_summary.retail_units IS 'KPI-SLS-001 restricted to this group: retail units delivered. Additive. THE DENOMINATOR of KPI-FNI-002, -005, -006 and -022. It includes cash deals, which cannot generate finance reserve -- the SQ-20 caution -- so a store with an unusual cash mix moves the reserve PVR for reasons unrelated to finance-office skill. cash_deal_count is published beside it so that caution is checkable rather than merely stated.';
COMMENT ON COLUMN reporting.vw_fi_summary.cash_deal_count IS 'Retail deals whose derived structure is Cash. Additive. Numerator of the Cash share of KPI-FNI-019.';
COMMENT ON COLUMN reporting.vw_fi_summary.retail_finance_deal_count IS 'Retail deals whose derived structure is Retail Finance. Additive. Numerator of the Retail Finance share of KPI-FNI-019, and the only structure that can carry finance reserve.';
COMMENT ON COLUMN reporting.vw_fi_summary.lease_deal_count IS 'Retail deals whose derived structure is Lease. Additive. Numerator of the Lease share of KPI-FNI-019. The three structure counts sum exactly to retail_units, which is what makes the shares a partition; Wholesale and Dealer Trade are not components because they are not retail.';
COMMENT ON COLUMN reporting.vw_fi_summary.finance_reserve_gross IS 'KPI-FNI-001: the finance-office income earned on the financing itself. Additive, exact. 0.00 on Cash and Lease by rule and legitimately 0.00 on a Retail Finance deal that earned none. AN AMOUNT ONLY -- no APR, buy rate, sell rate, rate spread or money factor is modelled anywhere in ARPI, and this must never be presented as rate guidance.';
COMMENT ON COLUMN reporting.vw_fi_summary.back_end_gross_deal_date IS 'KPI-GRS-002 restricted to this group, on the deal-date basis. Published here so the back-gross identity is readable from one row: it equals finance_reserve_gross + original_product_gross exactly, which is what RECON-FI-001 proves across the whole warehouse.';
COMMENT ON COLUMN reporting.vw_fi_summary.contract_count IS 'Product contracts written on this group''s deals. Additive. NUMERATOR of KPI-FNI-006 (products per retail unit) and DENOMINATOR of KPI-FNI-011 (product gross per contract). 0 rather than NULL when the group sold none.';
COMMENT ON COLUMN reporting.vw_fi_summary.deals_with_a_product IS 'Distinct deals in this group carrying at least one contract. Additive at this grain only. Published so a reader can see how many deliveries carried nothing -- and so that nobody computes products per retail unit over it: KPI-FNI-006''s denominator is ALL retail units, not only the deals that bought something.';
COMMENT ON COLUMN reporting.vw_fi_summary.product_retail_price IS 'Sum of SYNTHETIC contract prices. Additive. Never a market or recommended price.';
COMMENT ON COLUMN reporting.vw_fi_summary.product_dealer_cost IS 'Sum of SYNTHETIC contract costs. Additive.';
COMMENT ON COLUMN reporting.vw_fi_summary.original_product_gross IS 'KPI-FNI-003: product gross as written, on the DEAL-DATE basis. Additive, exact. The F&I office''s production number, before any later cancellation or chargeback; it overstates RETAINED gross wherever adjustments followed, which is what net_product_gross_as_of is for.';
COMMENT ON COLUMN reporting.vw_fi_summary.original_fi_gross IS 'finance_reserve_gross + original_product_gross, on the deal-date basis. Equals back_end_gross_deal_date exactly, by the identity RECON-FI-001 proves. Additive.';
COMMENT ON COLUMN reporting.vw_fi_summary.adjustment_event_count IS 'Adjustment events through as_of_date on contracts written by this group, attributed to the CONTRACT''S sale date rather than to the event''s own date. Additive within the as-of basis. For adjustment-PERIOD analysis use reporting.vw_fi_adjustment_summary, which is grained on the event''s date.';
COMMENT ON COLUMN reporting.vw_fi_summary.cumulative_adjustment_amount IS 'Signed sum of those adjustments. POSITIVE MEANS GROSS WAS TAKEN BACK. Additive within the as-of basis. 0.00 rather than NULL when nothing was taken back.';
COMMENT ON COLUMN reporting.vw_fi_summary.net_product_gross_as_of IS 'KPI-FNI-004: original_product_gross - cumulative_adjustment_amount. AS-OF BASIS -- adjustments after as_of_date are excluded by design. NOT comparable to original_product_gross unless both bases are stated, which is why both are on the row and both are labelled.';
COMMENT ON COLUMN reporting.vw_fi_summary.net_fi_gross_as_of IS 'finance_reserve_gross + net_product_gross_as_of: what the store RETAINED as at the as-of date, against what it PRODUCED (original_fi_gross). NUMERATOR of KPI-FNI-022 (F&I manager back PVR).';
COMMENT ON COLUMN reporting.vw_fi_summary.minimum_sample_floor IS 'The project-default eligible-deal floor from warehouse.fn_minimum_sample_floor(), published as data so a consumer states the threshold it applied rather than hard-coding it. A PROJECT DEFAULT FOR A FICTIONAL GROUP -- never a statistical significance threshold or an industry convention.';
COMMENT ON COLUMN reporting.vw_fi_summary.meets_minimum_sample IS 'Whether retail_units reached the floor. PUBLISHED, NOT APPLIED: the components are never blanked below it, because a NULL would be indistinguishable from a manager with no deals at all. A consumer renders "insufficient sample (n = X)" from this flag, excludes the row from ranking, and fires no action rule on it.';
COMMENT ON COLUMN reporting.vw_fi_summary.as_of_date IS 'The dataset''s own as-of date: the last day any measured thing happened. The same definition reporting.vw_target_attainment and the export manifest carry. NEVER the wall clock.';
COMMENT ON COLUMN reporting.vw_fi_summary.deal_date_basis IS 'Constant label "sale date": the basis of retail units, reserve, original product gross and the structure counts.';
COMMENT ON COLUMN reporting.vw_fi_summary.net_gross_date_basis IS 'Constant label naming the as-of rule the net columns are on.';
