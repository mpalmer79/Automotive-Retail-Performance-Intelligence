-- =============================================================================
-- File:            sql/05_reporting/45_vw_deal_product_detail.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_deal_product_detail — one row per F&I product contract, with its deal-date gross and its as-of net gross side by side.
-- Execution order: Reporting layer, after the F&I facts and warehouse.fn_minimum_sample_floor exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per warehouse.fact_finance_product_sale row (one product contract on one finalized deal).
-- =============================================================================
--
-- Delivery increment: DASH.6. Anchoring question SQ-21.
--
-- PURPOSE
-- -------
-- Explain the individual product contracts behind finalized deals. This is the view a
-- reader reaches for when a store's back-end gross moved and the question is WHICH
-- CONTRACTS moved it -- the question the MVP could not answer at all.
--
-- THE GRAIN IS THE CONTRACT, AND THE VIEW ADDS NO ROWS TO THE FACT
-- ----------------------------------------------------------------
-- Every join here is to a dimension on a unique key, or to a PRE-AGGREGATED adjustment
-- subquery keyed on product_sale_key. The adjustment aggregate is what makes that true:
-- joining the adjustment fact directly would fan a contract with three events into three
-- rows, and its original gross would then be counted three times by anything that summed
-- this view. RECON-REPORT-FI-DETAIL-ROWS compares the view's row count to the fact's on
-- every run, so a fan-out fails rather than renders.
--
-- TWO BASES ON ONE ROW, BOTH LABELLED
-- -----------------------------------
--   original_product_gross        DEAL-DATE basis. What was written, on the day it was
--                                 written. Never changes.
--   net_product_gross_as_of       AS-OF basis. Original minus cumulative adjustments
--                                 with adjustment_date <= as_of_date.
-- They are different reads of the same contract and are NOT comparable without stating
-- both bases, which is why as_of_date is a column rather than an assumption. Adjustments
-- AFTER as_of_date are excluded, which is the entire point of the basis.
--
-- THE AS-OF DATE IS GOVERNED, NEVER THE WALL CLOCK
-- ------------------------------------------------
-- It is the dataset's own as-of date: the last day any measured thing happened, over the
-- sale, snapshot and lead-creation bases. The SAME definition reporting.vw_target_attainment
-- and the dashboard export manifest carry, so every ARPI surface agrees about what "as of"
-- means. now() would make the same query return different answers on two afternoons.
--
-- NULL BEHAVIOUR
--   finance_manager_id   NULL means the deal was written with nobody on the F&I desk.
--                        A modelled state, never a missing value.
--   lender_id            NULL means NO LENDER EXISTS -- a cash deal borrowed nothing.
--                        Never "lender unknown".
--   cumulative_adjustment_amount  0.00, never NULL, when a contract has no event through
--                        the as-of date. "Nothing was taken back" is a statement.
--
-- ADDITIVITY
--   Additive: product_retail_price, product_dealer_cost, original_product_gross,
--     cumulative_adjustment_amount, net_product_gross_as_of, adjustment_event_count,
--     product_sale_count -- all at this grain and within their stated basis.
--   NON-ADDITIVE: contract_term_months (average it), line_ordinal, every identifier.
--   NEVER additive across date bases: summing a deal-date column and an as-of column
--     produces a figure that describes no population.
--
-- ELIGIBILITY: every row satisfied its category's ELIG-* rule when it was written, and
-- the rule id is published so a reader can see WHICH denominator the contract belongs
-- to. The predicate itself lives in config/reference/fi_product_eligibility.yaml.
--
-- SYNTHETIC-DATA LIMITATION: every product, administrator and lender is INVENTED, and
-- every price is a SYNTHETIC amount -- never a market price, a recommended price or a
-- real dealership's F&I menu. No APR, buy rate, sell rate, rate spread, money factor,
-- payment or loan term exists here or anywhere in ARPI.
--
-- EXPORT BOUNDARY: DASH.6 exports NO browser dataset from this view. It is
-- database-and-reporting only; DASH.7 owns the F&I presentation surface and the itemized
-- Deal Jacket. Nothing here is public-safe by accident -- it is public-safe by content,
-- carrying no customer reference of any kind.
--
-- KPI OWNERSHIP: contributes to KPI-FNI-003 (original product gross) and KPI-FNI-004
-- (net product gross); reporting.vw_fi_summary is their governed aggregate owner.

CREATE OR REPLACE VIEW reporting.vw_deal_product_detail AS
WITH governed_as_of AS (
    -- The dataset's own as-of date. Identical in definition to
    -- reporting.vw_target_attainment's, so ARPI has ONE as-of date rather than one per
    -- domain. Deliberately does NOT include adjustment dates: an adjustment posted after
    -- the last measured sale is genuinely not yet reflected, and excluding it is what
    -- makes the as-of basis mean something.
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
applied_adjustments AS (
    -- PRE-AGGREGATED, which is what keeps the grain at one row per contract. One row per
    -- product_sale_key, over the events on or before the governed as-of date.
    SELECT
        a.product_sale_key,
        count(*)::integer            AS adjustment_event_count,
        sum(a.adjustment_amount)     AS cumulative_adjustment_amount
    FROM warehouse.fact_finance_product_adjustment AS a
    JOIN warehouse.dim_date AS ad ON ad.date_key = a.adjustment_date_key
    CROSS JOIN governed_as_of AS g
    WHERE ad.full_date <= g.as_of_date
    GROUP BY a.product_sale_key
)
SELECT
    -- Identity ----------------------------------------------------------------
    ps.product_sale_id,
    deal.sale_id,
    sd.full_date                                              AS sale_date,
    sd.date_key                                               AS sale_date_key,

    -- Store and people --------------------------------------------------------
    store.dealership_id,
    store.store_short_name,
    manager.employee_id                                       AS finance_manager_id,

    -- Deal structure ----------------------------------------------------------
    ps.finance_structure,
    lender.lender_id,
    lender.lender_category,
    lender.program_tier                                       AS lender_program_tier,

    -- Product -----------------------------------------------------------------
    product.finance_product_id,
    product.product_name,
    product.product_category,
    product.provider_name,
    ps.eligibility_rule_id,
    ps.line_ordinal,
    ps.contract_term_months,

    -- Deal-date economics -----------------------------------------------------
    ps.product_sale_count,
    ps.product_retail_price,
    ps.product_dealer_cost,
    ps.original_product_gross,

    -- As-of economics ---------------------------------------------------------
    coalesce(adj.adjustment_event_count, 0)                   AS adjustment_event_count,
    coalesce(adj.cumulative_adjustment_amount, 0.00)          AS cumulative_adjustment_amount,
    ps.original_product_gross
        - coalesce(adj.cumulative_adjustment_amount, 0.00)    AS net_product_gross_as_of,

    -- Basis context -----------------------------------------------------------
    g.as_of_date,
    'sale date'::text                                         AS gross_date_basis,
    'adjustment date <= as_of_date'::text                     AS net_gross_date_basis,
    ps.source_system
FROM warehouse.fact_finance_product_sale AS ps
JOIN warehouse.fact_vehicle_sale AS deal ON deal.sale_key = ps.sale_key
JOIN warehouse.dim_date AS sd ON sd.date_key = ps.sale_date_key
JOIN warehouse.dim_dealership AS store ON store.dealership_key = ps.dealership_key
JOIN warehouse.dim_finance_product AS product
  ON product.finance_product_key = ps.finance_product_key
LEFT JOIN warehouse.dim_employee AS manager
  ON manager.employee_key = ps.finance_manager_key
LEFT JOIN warehouse.dim_lender AS lender ON lender.lender_key = ps.lender_key
LEFT JOIN applied_adjustments AS adj ON adj.product_sale_key = ps.product_sale_key
CROSS JOIN governed_as_of AS g;

COMMENT ON VIEW reporting.vw_deal_product_detail IS
    'Grain: ONE ROW PER F&I PRODUCT CONTRACT on a finalized vehicle transaction -- exactly '
    'warehouse.fact_finance_product_sale''s grain, with no aggregation, no filtering and no row added or '
    'lost. Every join is to a dimension on a unique key or to a PRE-AGGREGATED adjustment subquery keyed '
    'on product_sale_key; joining the adjustment fact directly would fan a contract with three events '
    'into three rows and triple its gross, so RECON-REPORT-FI-DETAIL-ROWS compares this view''s row count '
    'to the fact''s on every run. TWO DATE BASES ON ONE ROW, BOTH LABELLED: original_product_gross is '
    'DEAL-DATE (what was written, never changed by a later event) and net_product_gross_as_of is AS-OF '
    '(original minus cumulative adjustments with adjustment_date <= as_of_date). The two are NOT '
    'comparable without stating both bases, and summing across them produces a figure that describes no '
    'population. THE AS-OF DATE IS GOVERNED and is the dataset''s own -- the last day any measured thing '
    'happened -- never the wall clock. NULL finance_manager_id means the deal was written with nobody on '
    'the F&I desk; NULL lender_id means NO LENDER EXISTS, never "lender unknown"; '
    'cumulative_adjustment_amount is 0.00 rather than NULL when nothing was taken back. EVERY PRODUCT, '
    'ADMINISTRATOR AND LENDER IS FICTIONAL and every price is SYNTHETIC -- never a market price, a '
    'recommended price or a real F&I menu. NO apr, buy rate, sell rate, rate spread, money factor, '
    'payment or loan term exists here or anywhere in ARPI, and no customer is referenced at all. '
    'DASH.6 exports NO browser dataset from this view: it is database-and-reporting only, and DASH.7 owns '
    'the F&I surface and the itemized Deal Jacket. Contributes to KPI-FNI-003 and KPI-FNI-004, whose '
    'governed aggregate owner is reporting.vw_fi_summary.';

COMMENT ON COLUMN reporting.vw_deal_product_detail.product_sale_id IS 'The contract''s stable business identifier, FPS-########. Unique across the view, and the key an adjustment references.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.sale_id IS 'The parent finalized transaction, SLE-########. Several contracts may share one.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.sale_date IS 'The parent deal''s date. THE DEAL-DATE BASIS: original_product_gross belongs to this date and to no other.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.sale_date_key IS 'Date key of the parent deal''s date, for joining the shared calendar.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.dealership_id IS 'Selling store, carried from the parent deal.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.store_short_name IS 'Abbreviated fictional store name, for report headings. Names a business, never a person.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.finance_manager_id IS 'Synthetic identifier of the F&I manager credited on the PARENT DEAL. NULL means the deal was written with nobody on the F&I desk -- a modelled state, never a missing value. A synthetic identifier and never a name.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.finance_structure IS 'Cash, Retail Finance or Lease, DERIVED from the parent deal by warehouse.fn_finance_structure. Never a Wholesale or Dealer Trade disposal: no product can be written on one.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.lender_id IS 'The FICTIONAL lender behind the parent deal. NULL means NO LENDER EXISTS -- a cash deal borrowed nothing -- and never means "lender unknown".';
COMMENT ON COLUMN reporting.vw_deal_product_detail.lender_category IS 'Captive, Bank, Credit Union or Independent Finance Company. Classifies the invented institution. NULL where no lender exists.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.lender_program_tier IS 'Prime, Near-prime or Subprime. CLASSIFIES THE FICTIONAL LENDER''S PROGRAM AND NEVER A CUSTOMER: it is not a credit score, not a credit tier and not an approval result, and nothing in ARPI derives it from any credit datum because none exists.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.finance_product_id IS 'The catalogued product, FP-###.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.product_name IS 'Fictional product label. Names an INVENTED product of an INVENTED administrator.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.product_category IS 'One of the ten governed categories. "Extended warranty" is a permitted user-facing alias for Vehicle Service Contract and is never a value here.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.provider_name IS 'Fictional administrator label. An ATTRIBUTE of the product by deliberate decision (DASH.6-01); provider analysis joins through the product and no fact carries a provider key.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.eligibility_rule_id IS 'The ELIG-* rule this contract''s category owns, from config/reference/fi_product_eligibility.yaml. Published so a reader can see which denominator the contract belongs to in reporting.vw_fi_product_penetration.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.line_ordinal IS '1-based position within the deal. NON-ADDITIVE: it orders a deal''s contracts and is never summed.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.contract_term_months IS 'The PRODUCT CONTRACT''s term: how long the COVERAGE lasts. NON-ADDITIVE -- average it, never sum it. THIS IS NOT A FINANCE LOAN TERM; ARPI models none.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.product_sale_count IS 'Always 1. Additive: sum it for a contract count rather than using count(*).';
COMMENT ON COLUMN reporting.vw_deal_product_detail.product_retail_price IS 'SYNTHETIC price charged, exact to the cent. Additive. Never a market price, a recommended price or a real product''s price, and it depends on no customer characteristic of any kind.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.product_dealer_cost IS 'SYNTHETIC cost to the store, exact to the cent. Additive.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.original_product_gross IS 'product_retail_price - product_dealer_cost, exact. Additive. THE DEAL-DATE PRODUCTION FIGURE (KPI-FNI-003): what the F&I office wrote, before any later adjustment, and it is never reduced when one posts.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.adjustment_event_count IS 'Number of adjustment events on this contract through as_of_date. Additive. 0 rather than NULL when nothing has happened to the contract.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.cumulative_adjustment_amount IS 'Signed sum of this contract''s adjustments with adjustment_date <= as_of_date. Additive. POSITIVE MEANS GROSS WAS TAKEN BACK. 0.00 rather than NULL when nothing was: "nothing was taken back" is a statement, not an absence.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.net_product_gross_as_of IS 'original_product_gross - cumulative_adjustment_amount, exact (KPI-FNI-004). Additive WITHIN the as-of basis. AS-OF BASIS ONLY: adjustments after as_of_date are excluded by design, and this figure is not comparable to original_product_gross unless both bases are stated.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.as_of_date IS 'The dataset''s own as-of date: the last day any measured thing happened, over the sale, snapshot and lead-creation bases. The SAME definition reporting.vw_target_attainment and the dashboard export manifest carry. NEVER the wall clock -- now() would make one query return two answers on two afternoons.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.gross_date_basis IS 'Constant label "sale date": the basis original_product_gross is on. Published as data so a consumer renders the basis from the row rather than from a hard-coded sentence.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.net_gross_date_basis IS 'Constant label naming the as-of rule net_product_gross_as_of is on.';
COMMENT ON COLUMN reporting.vw_deal_product_detail.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops an invented price being read as a market price.';
