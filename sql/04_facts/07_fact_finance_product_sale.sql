-- =============================================================================
-- File:            sql/04_facts/07_fact_finance_product_sale.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_finance_product_sale, the F&I product contract fact.
-- Execution order: After every dimension it references and after warehouse.fact_vehicle_sale, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per finance product contract sold on a finalized vehicle transaction.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-019-fact-finance-product-sale.md.
-- Delivery increment: DASH.6, authorized by ADR-0013 and DASHBOARD_PROGRAM.md section 9.
--
-- WHAT THIS FACT MAKES POSSIBLE
-- -----------------------------
-- Before DASH.6, ARPI knew a deal's back-end gross (KPI-GRS-002) and nothing beneath it.
-- SQ-21 -- "Which finance products have weak or inconsistent penetration, and what do
-- cancellations cost us?" -- sat on the stakeholder register as UNANSWERABLE for exactly
-- that reason, and any product-mix narrative built on the MVP would have been fabricated.
-- These rows are the first half of the answer; fact_finance_product_adjustment is the
-- second.
--
-- THE BACK-GROSS IDENTITY THIS FACT COMPLETES
-- -------------------------------------------
--     fact_vehicle_sale.back_end_gross
--       = fact_vehicle_sale.finance_reserve_gross
--       + SUM(original_product_gross) over this fact for the same deal
--       + other_fi_income                            (exactly 0.00; not a column)
--
-- Exact to the cent on EVERY deal. It cannot be a CHECK constraint -- it spans two tables
-- -- so it is RECON-FI-001 and DQ-FPS-014 instead, and a seeded one-cent corruption case
-- proves the control can fail.
--
-- other_fi_income IS NOT A COLUMN, deliberately. A zero that is never anything else is a
-- place a future balancing plug would hide. The allocation that produces these rows
-- reaches the cent by largest-remainder distribution across real product lines, so there
-- is no residue to park anywhere.
--
-- DEAL-DATE BASIS, AND NEVER REWRITTEN
-- ------------------------------------
-- A row records what was written on the day it was written. A cancellation or chargeback
-- three months later is a separate event and leaves this row untouched: restating a June
-- contract because of an August chargeback would move production out of the month it
-- happened in and make every historical month unstable.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No APR, buy rate, sell rate, rate spread, money factor, payment, loan term, approval,
-- credit datum or customer attribute. contract_term_months is the term of the PRODUCT
-- CONTRACT -- how long the coverage lasts -- and is NOT a loan term; ARPI has none.
--
-- MEASURE ADDITIVITY
--   Additive across every dimension: product_sale_count, product_retail_price,
--     product_dealer_cost, original_product_gross.
--   NON-ADDITIVE: contract_term_months (average it, never sum it), line_ordinal.
--
-- PRIVACY: no customer data at all. The only reference to a person is a surrogate key
-- into warehouse.dim_employee, which holds a synthetic identifier and no name.

CREATE TABLE IF NOT EXISTS warehouse.fact_finance_product_sale (
    product_sale_key        bigint         NOT NULL,
    product_sale_id         varchar(16)    NOT NULL,
    sale_key                bigint         NOT NULL,
    sale_date_key           integer        NOT NULL,
    dealership_key          integer        NOT NULL,
    finance_manager_key     integer        NULL,
    finance_product_key     integer        NOT NULL,
    lender_key              integer        NULL,
    finance_structure       varchar(20)    NOT NULL,
    eligibility_rule_id     varchar(16)    NOT NULL,
    line_ordinal            smallint       NOT NULL,
    product_sale_count      smallint       NOT NULL,
    product_retail_price    numeric(12,2)  NOT NULL,
    product_dealer_cost     numeric(12,2)  NOT NULL,
    original_product_gross  numeric(12,2)  NOT NULL,
    contract_term_months    smallint       NOT NULL,
    source_system           varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_finance_product_sale
        PRIMARY KEY (product_sale_key),
    CONSTRAINT uq_fact_finance_product_sale_product_sale_id
        UNIQUE (product_sale_id),
    -- THE declared logical grain, enforced. ONE CONTRACT PER PRODUCT DEFINITION PER
    -- DEAL: a customer does not buy the identical contract twice, so a repeat is a
    -- duplicate rather than a second sale. Two DIFFERENT products inside one category
    -- are permitted and are generated -- a windscreen plan and a roadside plan are both
    -- Other Aftermarket Products -- which is precisely why every penetration measure
    -- counts DISTINCT DEALS rather than contract rows. Forbidding that would make
    -- "count the deal once" an identity and the rule untestable.
    CONSTRAINT uq_fact_finance_product_sale_grain
        UNIQUE (sale_key, finance_product_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_finance_product_sale_key_positive
        CHECK (product_sale_key > 0),
    CONSTRAINT ck_fact_finance_product_sale_id_not_blank
        CHECK (btrim(product_sale_id) <> ''),
    -- The three RETAIL structures only. A disposal has no consumer, so no product can
    -- ever be written on one.
    CONSTRAINT ck_fact_finance_product_sale_structure_domain
        CHECK (finance_structure IN ('Cash', 'Retail Finance', 'Lease')),
    CONSTRAINT ck_fact_finance_product_sale_eligibility_rule_domain
        CHECK (eligibility_rule_id IN
            ('ELIG-VSC', 'ELIG-GAP', 'ELIG-TW', 'ELIG-PPM', 'ELIG-LWP', 'ELIG-OTH')),
    CONSTRAINT ck_fact_finance_product_sale_line_ordinal_positive
        CHECK (line_ordinal >= 1),
    CONSTRAINT ck_fact_finance_product_sale_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- The grain is one contract, so the additive contract measure is 1. Any other value
    -- means the grain was violated upstream.
    CONSTRAINT ck_fact_finance_product_sale_count_is_one
        CHECK (product_sale_count = 1),
    -- A negative price or cost is not a thin deal, it is a defect. Product GROSS is
    -- deliberately unconstrained: a product sold below cost is a real event, even though
    -- this generator does not produce one, and suppressing it would be the fabrication.
    CONSTRAINT ck_fact_finance_product_sale_price_nonnegative
        CHECK (product_retail_price >= 0),
    CONSTRAINT ck_fact_finance_product_sale_cost_nonnegative
        CHECK (product_dealer_cost >= 0),
    -- THE PRODUCT PRICE IDENTITY, exact to the cent. Enforced rather than documented,
    -- because every product gross measure in the platform depends on it.
    CONSTRAINT ck_fact_finance_product_sale_gross_identity
        CHECK (original_product_gross = product_retail_price - product_dealer_cost),
    -- The COVERAGE's term, not a loan term: ARPI models none.
    CONSTRAINT ck_fact_finance_product_sale_contract_term_range
        CHECK (contract_term_months BETWEEN 12 AND 120),
    -- A cash deal borrowed nothing, so it can carry no lender. The converse -- that a
    -- financed deal DOES carry one -- spans two tables and is DQ-FPS-007's.
    CONSTRAINT ck_fact_finance_product_sale_cash_has_no_lender
        CHECK (finance_structure <> 'Cash' OR lender_key IS NULL)
);

-- Conformed-dimension foreign keys. Declared with guarded ALTER TABLE rather than
-- inline, so that this file stays idempotent while still adding a constraint that a
-- database created by an earlier revision does not yet have.
DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_fi_product_sale_sale',            'sale_key',            'fact_vehicle_sale',   'sale_key'),
            ('fk_fact_fi_product_sale_sale_date',       'sale_date_key',       'dim_date',            'date_key'),
            ('fk_fact_fi_product_sale_dealership',      'dealership_key',      'dim_dealership',      'dealership_key'),
            ('fk_fact_fi_product_sale_finance_manager', 'finance_manager_key', 'dim_employee',        'employee_key'),
            ('fk_fact_fi_product_sale_product',         'finance_product_key', 'dim_finance_product', 'finance_product_key'),
            ('fk_fact_fi_product_sale_lender',          'lender_key',          'dim_lender',          'lender_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_finance_product_sale ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_finance_product_sale IS
    'Grain: ONE ROW PER FINANCE PRODUCT CONTRACT SOLD ON A FINALIZED VEHICLE TRANSACTION, enforced by '
    'uq_fact_finance_product_sale_grain over (sale_key, finance_product_key). Transaction fact, DEAL-DATE '
    'basis, NEVER rewritten: a later cancellation or chargeback is a separate event in '
    'warehouse.fact_finance_product_adjustment and leaves these rows untouched, because restating a June '
    'contract for an August chargeback would move production out of the month it happened in. THE '
    'IDENTITY THIS FACT COMPLETES: fact_vehicle_sale.back_end_gross = finance_reserve_gross + '
    'SUM(original_product_gross) for the same deal, exactly, with other_fi_income exactly 0.00 -- and '
    'other_fi_income is deliberately NOT a column, because a zero that is never anything else is where a '
    'balancing plug would hide. RECON-FI-001 and DQ-FPS-014 prove it; no CHECK can, because it spans two '
    'tables. One deal may carry two DIFFERENT products of one category, which is why every penetration '
    'measure counts DISTINCT DEALS rather than these rows. PRICES ARE SYNTHETIC: never a market price, '
    'never a recommended price, never a real dealership''s F&I menu. NO apr, buy rate, sell rate, rate '
    'spread, money factor, payment, loan term or credit datum exists here or anywhere in ARPI. Contains '
    'no customer data.';

COMMENT ON COLUMN warehouse.fact_finance_product_sale.product_sale_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by product_sale_id.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.product_sale_id IS 'Natural key from the source system, FPS-########. Unique. THE STABLE BUSINESS IDENTIFIER an adjustment references, so a cancellation can be traced to its contract in the source data rather than only through a warehouse surrogate.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.sale_key IS 'Foreign key to warehouse.fact_vehicle_sale: the parent finalized transaction. Part of the declared grain. A fact-to-fact key rather than a re-resolved natural key, so a contract can never point at a deal the sale fact does not contain.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.sale_date_key IS 'Foreign key to warehouse.dim_date: the parent deal''s date. THE ONLY DATE THIS FACT CARRIES, and the basis of KPI-FNI-003.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.dealership_key IS 'Foreign key to warehouse.dim_dealership: the selling store, carried from the parent deal.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.finance_manager_key IS 'Foreign key to warehouse.dim_employee: the F&I manager credited on the PARENT DEAL. NULL means the deal was written with nobody on the F&I desk -- a modelled state, never a missing value. KPI-FNI-021 and KPI-FNI-022 are computed over this attribution.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.finance_product_key IS 'Foreign key to warehouse.dim_finance_product. Part of the declared grain. Resolves the category, the provider and the two sensitivity flags; provider is an attribute of the product, so no provider key exists (DASH.6-01).';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.lender_key IS 'Foreign key to warehouse.dim_lender: the parent deal''s FICTIONAL lender. NULL means NO LENDER EXISTS -- a cash deal borrowed nothing -- and never means "lender unknown".';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.finance_structure IS 'Cash, Retail Finance or Lease, DERIVED from the parent deal by warehouse.fn_finance_structure and denormalised here so a structure read needs no join. Never a disposal: no product can be written on one. KPI-FNI-019 shares out these three over the deal fact, not over this one.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.eligibility_rule_id IS 'The ELIG-* rule the parent deal satisfied for this product''s category, from config/reference/fi_product_eligibility.yaml. Stored so a contract carries the denominator it belongs to; the predicate itself is re-evaluated by DQ-FPS-011 and RECON-FI-ELIGIBILITY rather than trusted from this column.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.line_ordinal IS '1-based position within the deal, in catalogue-category order. NON-ADDITIVE: it orders a deal''s contracts and is never summed or averaged.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.product_sale_count IS 'Always 1. Additive. A COLUMN rather than a count(*), so a contract count is summed like any other measure and cannot be inflated by a join fan-out. Numerator of KPI-FNI-006 and KPI-FNI-011.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.product_retail_price IS 'SYNTHETIC price charged for the contract, exact to the cent. Additive. NEVER a market price, a recommended price or a real product''s price, and pricing depends on no customer characteristic of any kind.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.product_dealer_cost IS 'SYNTHETIC cost of the contract to the store, exact to the cent. Additive.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.original_product_gross IS 'product_retail_price - product_dealer_cost, enforced by ck_fact_finance_product_sale_gross_identity. Additive. THE DEAL-DATE PRODUCTION FIGURE (KPI-FNI-003): what the F&I office wrote, before any later adjustment. It is never reduced when a cancellation posts -- that is what net product gross (KPI-FNI-004) is for, and stating both bases is mandatory whenever the two appear together.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.contract_term_months IS 'The PRODUCT CONTRACT''s term: how long the COVERAGE lasts. NON-ADDITIVE: average it, never sum it. THIS IS NOT A FINANCE LOAN TERM. ARPI models no loan term, no APR, no payment and no rate of any kind, and the two must never be conflated.';
COMMENT ON COLUMN warehouse.fact_finance_product_sale.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops an invented product price being read as a market or recommended price.';
