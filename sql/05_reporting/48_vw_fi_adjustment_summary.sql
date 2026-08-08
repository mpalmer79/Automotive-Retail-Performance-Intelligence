-- =============================================================================
-- File:            sql/05_reporting/48_vw_fi_adjustment_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_fi_adjustment_summary — adjustment-period analysis on the ADJUSTMENT date, at store x adjustment date x finance manager x category x adjustment type.
-- Execution order: Reporting layer, after the F&I facts exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per dealership, per ADJUSTMENT DATE, per finance manager, per product category, per adjustment type.
-- =============================================================================
--
-- Delivery increment: DASH.6. Anchoring question SQ-21 ("...and what do cancellations
-- cost us?").
--
-- THIS VIEW IS ON A DIFFERENT DATE FROM EVERY OTHER F&I VIEW, AND THAT IS THE POINT
-- ---------------------------------------------------------------------------------
-- reporting.vw_fi_summary and reporting.vw_fi_product_penetration are on the SALE date.
-- This one is on the ADJUSTMENT date: an August chargeback on a June contract belongs to
-- August, and the June contract keeps June's gross. That is why it is a separate view
-- rather than more columns on an existing one -- two date bases in one grain would put
-- two populations behind one row, and nothing would fail.
--
-- THE MIXED-BASIS RATES, AND WHY THEY ARE HONEST ONLY WHEN LABELLED
-- -----------------------------------------------------------------
-- KPI-FNI-014, -015 and -018 divide something on THIS view by something on
-- reporting.vw_fi_summary:
--
--     chargeback rate by amount = chargeback amount posted in period P   (adjustment date)
--                               / original product gross written in P     (sale date)
--
-- The numerator's period is POSTING time and the denominator's is SELLING time. They
-- describe overlapping but different contract populations, so the result is a PERIOD
-- PROXY and NOT a cohort loss rate -- the contracts charged back in August are mostly not
-- the contracts written in August. That is a legitimate operating measure and a dishonest
-- one if the basis is not stated, so this view publishes numerator_date_basis and
-- denominator_source as data: a consumer renders the disclosure from the row rather than
-- from a sentence somebody remembered to write.
--
-- Both sides are available at a COMPATIBLE SHAPE -- store, date, manager, category -- so
-- a consumer aligns them by key. The denominator is deliberately NOT copied onto this
-- view: it belongs to the sale date, and a sale-date figure sitting on an adjustment-date
-- row is exactly the silent blend the whole design avoids.
--
-- WHAT IS PUBLISHED INSTEAD, AND WHAT IT IS NOT
-- ----------------------------------------------
-- adjusted_contract_original_gross is the deal-date gross of the DISTINCT CONTRACTS
-- adjusted in this group, counted once per contract however many events it carried. It
-- supports "how much of what we adjusted had we originally written?" -- a cohort-free
-- severity read. It is NOT KPI-FNI-014's denominator and must never be substituted for
-- one; the column comment says so, and so does this header.
--
-- ADDITIVITY
--   Additive across store, date, manager, category and type: adjustment_count,
--     adjustment_amount, distinct_adjusted_contract_count (at this grain only).
--   NEVER additive with anything on the sale-date basis.
--   distinct_adjusted_contract_count is NOT additive across dates: one contract adjusted
--     twice in two months is one contract, and summing the two months double-counts it.
--
-- SIGN: adjustment_amount keeps the governed convention. POSITIVE REDUCES retained gross.
-- A Reinstatement row therefore carries a NEGATIVE total, which is correct and is the
-- reason the type is in the grain rather than being netted away.
--
-- SYNTHETIC-DATA LIMITATION: cancellation and chargeback timing and volume are a
-- CONFIGURED SYNTHETIC DISTRIBUTION, never an observed loss rate, and the reporting
-- window truncates the lag distribution -- the most recent months of sales carry
-- structurally fewer adjustments because those contracts have not had time to fail.
-- Comparing adjustment volume between an early month and a late one reads that
-- truncation and not the business.
--
-- EXPORT BOUNDARY: DASH.6 exports NO browser dataset from this view.

CREATE OR REPLACE VIEW reporting.vw_fi_adjustment_summary AS
WITH events AS (
    SELECT
        a.adjustment_key,
        a.product_sale_key,
        a.dealership_key,
        a.adjustment_date_key,
        a.finance_manager_key,
        coalesce(a.finance_manager_key, 0)   AS finance_manager_grain_key,
        p.product_category,
        a.adjustment_type,
        a.adjustment_amount,
        ps.original_product_gross
    FROM warehouse.fact_finance_product_adjustment AS a
    JOIN warehouse.fact_finance_product_sale AS ps
      ON ps.product_sale_key = a.product_sale_key
    JOIN warehouse.dim_finance_product AS p
      ON p.finance_product_key = a.finance_product_key
),
event_totals AS (
    SELECT
        e.dealership_key,
        e.adjustment_date_key,
        e.finance_manager_key,
        e.finance_manager_grain_key,
        e.product_category,
        e.adjustment_type,
        count(*)::integer                          AS adjustment_count,
        sum(e.adjustment_amount)                   AS adjustment_amount,
        count(DISTINCT e.product_sale_key)::integer AS distinct_adjusted_contract_count
    FROM events AS e
    GROUP BY e.dealership_key, e.adjustment_date_key, e.finance_manager_key,
             e.finance_manager_grain_key, e.product_category, e.adjustment_type
),
contract_gross AS (
    -- ONE ROW PER CONTRACT PER GROUP FIRST, then summed. Summing e.original_product_gross
    -- directly would count a contract's original gross once per event on it, which is the
    -- fan-out this whole view is careful about.
    SELECT
        d.dealership_key,
        d.adjustment_date_key,
        d.finance_manager_grain_key,
        d.product_category,
        d.adjustment_type,
        sum(d.original_product_gross) AS adjusted_contract_original_gross
    FROM (
        SELECT DISTINCT
            e.dealership_key,
            e.adjustment_date_key,
            e.finance_manager_grain_key,
            e.product_category,
            e.adjustment_type,
            e.product_sale_key,
            e.original_product_gross
        FROM events AS e
    ) AS d
    GROUP BY d.dealership_key, d.adjustment_date_key, d.finance_manager_grain_key,
             d.product_category, d.adjustment_type
)
SELECT
    -- Grain -------------------------------------------------------------------
    t.dealership_key,
    store.dealership_id,
    store.store_short_name,
    t.adjustment_date_key,
    ad.full_date                                                    AS adjustment_date,
    t.finance_manager_key,
    manager.employee_id                                             AS finance_manager_id,
    t.finance_manager_grain_key,
    t.product_category,
    t.adjustment_type,

    -- Adjustment-period measures ----------------------------------------------
    t.adjustment_count,
    t.adjustment_amount,
    t.distinct_adjusted_contract_count,
    coalesce(cg.adjusted_contract_original_gross, 0.00)             AS adjusted_contract_original_gross,

    -- Basis disclosure, published as data -------------------------------------
    'adjustment date'::text                                         AS numerator_date_basis,
    'sale date'::text                                               AS rate_denominator_date_basis,
    'reporting.vw_fi_summary.original_product_gross'::text          AS rate_denominator_source,
    'mixed-basis period proxy, not a contract-cohort loss rate'::text
                                                                    AS rate_basis_disclosure
FROM event_totals AS t
JOIN warehouse.dim_dealership AS store ON store.dealership_key = t.dealership_key
JOIN warehouse.dim_date AS ad ON ad.date_key = t.adjustment_date_key
LEFT JOIN warehouse.dim_employee AS manager ON manager.employee_key = t.finance_manager_key
LEFT JOIN contract_gross AS cg
       ON cg.dealership_key = t.dealership_key
      AND cg.adjustment_date_key = t.adjustment_date_key
      AND cg.finance_manager_grain_key = t.finance_manager_grain_key
      AND cg.product_category = t.product_category
      AND cg.adjustment_type = t.adjustment_type;

COMMENT ON VIEW reporting.vw_fi_adjustment_summary IS
    'Grain: ONE ROW PER DEALERSHIP, PER ADJUSTMENT DATE, PER FINANCE MANAGER, PER PRODUCT CATEGORY, PER '
    'ADJUSTMENT TYPE. THE ONLY F&I VIEW ON THE ADJUSTMENT-DATE BASIS, and that is why it is a separate '
    'view rather than more columns on an existing one: an August chargeback on a June contract belongs to '
    'August, the June contract keeps June''s gross, and two date bases inside one grain would put two '
    'populations behind one row with nothing failing. THE MIXED-BASIS RATES: KPI-FNI-014, -015 and -018 '
    'divide a figure from THIS view by one from reporting.vw_fi_summary -- the numerator''s period is '
    'POSTING time and the denominator''s is SELLING time, so the result is a PERIOD PROXY and NOT a '
    'contract-cohort loss rate, because the contracts charged back in a month are mostly not the ones '
    'written in it. numerator_date_basis, rate_denominator_date_basis, rate_denominator_source and '
    'rate_basis_disclosure are published AS DATA so a consumer renders that disclosure from the row rather '
    'than from a sentence somebody remembered. The denominator is deliberately NOT copied onto this view: '
    'a sale-date figure on an adjustment-date row is exactly the silent blend this design avoids. SIGN: '
    'adjustment_amount keeps the governed convention -- POSITIVE REDUCES retained gross -- so a '
    'Reinstatement row carries a negative total, which is why the type is in the grain rather than netted '
    'away. distinct_adjusted_contract_count is NOT additive across dates: one contract adjusted in two '
    'months is one contract. TIMING AND VOLUME ARE A SYNTHETIC CONFIGURED DISTRIBUTION, never an observed '
    'loss rate, and the reporting window truncates the lag distribution so recent months carry '
    'structurally fewer events -- comparing an early month to a late one reads that truncation, not the '
    'business. Owns KPI-FNI-012, -013, -016 and -017, and the numerator of -014, -015 and -018. DASH.6 '
    'exports no browser dataset from this view: DASH.7 owns the F&I presentation surface.';

COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.dealership_key IS 'Surrogate key of the store. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.dealership_id IS 'Business identifier of the store, GSA-###.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.store_short_name IS 'Abbreviated fictional store name. Names a business, never a person.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjustment_date_key IS 'Date key of THE EVENT''S OWN business date. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjustment_date IS 'THE ADJUSTMENT-PERIOD BASIS: the date the event posted, never the date the contract was written. An August chargeback on a June contract appears here in August, and June''s original product gross is unchanged.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.finance_manager_key IS 'Surrogate key of the manager credited on the ORIGINAL deal, or NULL where none was. Attribution follows the CONTRACT, not whoever processed the cancellation: that person is not modelled, and inventing them would attribute a loss to somebody on no evidence.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.finance_manager_id IS 'Synthetic identifier of that manager, or NULL. Never a name.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.finance_manager_grain_key IS 'coalesce(finance_manager_key, 0), NOT NULL. Part of the declared grain, so uniqueness at the grain is checkable.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.product_category IS 'One of the ten governed categories, from the adjusted contract''s product. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjustment_type IS 'Cancellation, Chargeback, Reinstatement or Approved Adjustment. IN THE GRAIN rather than netted away, because the four move retained gross in different directions and for different reasons, and a single netted figure would hide a month in which large cancellations and large reinstatements both happened.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjustment_count IS 'KPI-FNI-013 (Chargeback) and KPI-FNI-017 (Cancellation): events of this type in this group. Additive across store, date, manager, category and type, on the ADJUSTMENT-DATE basis only.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjustment_amount IS 'KPI-FNI-012 (Chargeback) and KPI-FNI-016 (Cancellation): signed sum of this type''s amounts. Additive on the adjustment-date basis only. POSITIVE MEANS GROSS WAS TAKEN BACK, so a Reinstatement row is legitimately negative. NEVER additive with anything on the sale-date basis.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.distinct_adjusted_contract_count IS 'Distinct contracts touched by this type in this group. Additive at THIS grain and NOT across dates: one contract adjusted in two months is one contract, and summing the months double-counts it.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.adjusted_contract_original_gross IS 'Deal-date gross of the DISTINCT contracts adjusted here, counted once per contract however many events it carried. Supports "how much of what we adjusted had we originally written?" -- a cohort-free severity read. IT IS NOT KPI-FNI-014''S DENOMINATOR and must never be substituted for one: that denominator is original product gross for contracts SOLD in the period, on the sale-date basis, and it lives in reporting.vw_fi_summary.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.numerator_date_basis IS 'Constant label "adjustment date": the basis every measure on this row is on. Published as data so a consumer states the basis it rendered rather than assuming one.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.rate_denominator_date_basis IS 'Constant label "sale date": the basis of the denominator KPI-FNI-014, -015 and -018 pair with these numerators. Different from numerator_date_basis ON PURPOSE, and the difference is the disclosure.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.rate_denominator_source IS 'Where that denominator lives. Deliberately NOT copied onto this view: a sale-date figure on an adjustment-date row is the silent blend this design exists to avoid, and both views share a compatible store/date/manager/category shape so a consumer aligns them by key.';
COMMENT ON COLUMN reporting.vw_fi_adjustment_summary.rate_basis_disclosure IS 'Constant label stating that the resulting rate is a MIXED-BASIS PERIOD PROXY and not a contract-cohort loss rate. The contracts charged back in a month are mostly not the contracts written in it; a cohort loss rate is a different measure that ARPI does not compute.';
