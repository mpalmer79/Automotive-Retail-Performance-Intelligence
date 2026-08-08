-- =============================================================================
-- File:            sql/04_facts/17_fact_finance_product_sale_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_finance_product_sale into warehouse.fact_finance_product_sale, resolving every surrogate key by natural-key join.
-- Execution order: After every dimension merge AND after sql/04_facts/10_fact_vehicle_sale_load.sql, and at runtime by the Python loader.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per finance product contract sold on a finalized vehicle transaction.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL only: no
-- psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction), statements
-- separated by semicolons. Safe against an empty database.
--
-- THE FILE NUMBER IS LOAD ORDER, AND IT IS LOAD-BEARING
-- -----------------------------------------------------
-- 17 sorts after 10, so warehouse.fact_vehicle_sale is populated before this script
-- resolves sale_key against it. A contract whose parent deal has not been loaded yet
-- would be dropped by the inner join below and recorded as a REJ-REF-001 rejection --
-- correct behaviour for a genuinely missing deal, and a silent catastrophe if the only
-- reason the deal is missing is that its load script had not run.
--
-- THE PARENT IS RESOLVED AGAINST THE FACT, NOT RE-RESOLVED FROM THE DIMENSIONS
-- ---------------------------------------------------------------------------
-- sale_key comes from warehouse.fact_vehicle_sale by sale_id, rather than the contract
-- re-deriving a date and a store key of its own. That is what makes it impossible for a
-- contract to point at a deal the sale fact does not contain, and it is why the
-- back-gross identity in RECON-FI-001 is a comparison between two rows that are already
-- known to be about the same transaction.
--
-- WHY THE MANAGER AND LENDER JOINS ARE LEFT AND THE OTHERS ARE NOT
-- ----------------------------------------------------------------
-- finance_manager_key is NULL when the deal was written with nobody on the F&I desk, and
-- lender_key is NULL when NO LENDER EXISTS. Both are modelled states rather than missing
-- values, so an inner join would silently delete legitimate contracts from the fact.
-- Everything else -- the deal, the date, the store, the product -- is required: a
-- contract missing any of them cannot be attributed and is a rejection rather than a row
-- with a defaulted key.
--
-- NOTHING IS CALCULATED HERE. No penetration, no net gross, no PVR: those belong to the
-- reporting views. This script moves contracts and resolves keys.

WITH src AS (
    SELECT
        s.product_sale_id,
        deal.sale_key,
        d.date_key                     AS sale_date_key,
        store.dealership_key,
        manager.employee_key           AS finance_manager_key,
        product.finance_product_key,
        lender.lender_key,
        s.finance_structure,
        s.eligibility_rule_id,
        s.line_ordinal,
        s.product_sale_count,
        s.product_retail_price,
        s.product_dealer_cost,
        s.original_product_gross,
        s.contract_term_months,
        s.source_system
    FROM staging.stg_finance_product_sale AS s
    -- Required: the parent deal, resolved against the FACT it belongs to.
    JOIN warehouse.fact_vehicle_sale AS deal
      ON deal.sale_id = s.sale_id
    -- Required: the calendar.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.sale_date
    -- Required: the store, as it stood on the day of the deal.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.sale_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the catalogued product. An uncatalogued one has no category, therefore
    -- no eligibility rule and no penetration denominator.
    JOIN warehouse.dim_finance_product AS product
      ON product.finance_product_id = s.finance_product_id
    -- Optional by contract, and resolved AS AT THE SALE DATE rather than as at today.
    LEFT JOIN warehouse.dim_employee AS manager
      ON manager.employee_id = s.finance_manager_id
     AND s.sale_date BETWEEN manager.effective_date AND manager.expiration_date
    -- Optional by contract: NULL means NO LENDER EXISTS.
    LEFT JOIN warehouse.dim_lender AS lender
      ON lender.lender_id = s.lender_id
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.product_sale_key), 0)
         FROM warehouse.fact_finance_product_sale AS x)
            + row_number() OVER (ORDER BY s.product_sale_id) AS product_sale_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_finance_product_sale AS f
        WHERE f.product_sale_id = s.product_sale_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.product_sale_key, s.*
    FROM src AS s
    JOIN warehouse.fact_finance_product_sale AS f
      ON f.product_sale_id = s.product_sale_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_finance_product_sale AS f (
    product_sale_key,
    product_sale_id,
    sale_key,
    sale_date_key,
    dealership_key,
    finance_manager_key,
    finance_product_key,
    lender_key,
    finance_structure,
    eligibility_rule_id,
    line_ordinal,
    product_sale_count,
    product_retail_price,
    product_dealer_cost,
    original_product_gross,
    contract_term_months,
    source_system
)
SELECT
    k.product_sale_key,
    k.product_sale_id,
    k.sale_key,
    k.sale_date_key,
    k.dealership_key,
    k.finance_manager_key,
    k.finance_product_key,
    k.lender_key,
    k.finance_structure,
    k.eligibility_rule_id,
    k.line_ordinal,
    k.product_sale_count,
    k.product_retail_price,
    k.product_dealer_cost,
    k.original_product_gross,
    k.contract_term_months,
    k.source_system
FROM merged AS k
ON CONFLICT (product_sale_id) DO UPDATE
SET sale_key               = EXCLUDED.sale_key,
    sale_date_key          = EXCLUDED.sale_date_key,
    dealership_key         = EXCLUDED.dealership_key,
    finance_manager_key    = EXCLUDED.finance_manager_key,
    finance_product_key    = EXCLUDED.finance_product_key,
    lender_key             = EXCLUDED.lender_key,
    finance_structure      = EXCLUDED.finance_structure,
    eligibility_rule_id    = EXCLUDED.eligibility_rule_id,
    line_ordinal           = EXCLUDED.line_ordinal,
    product_sale_count     = EXCLUDED.product_sale_count,
    product_retail_price   = EXCLUDED.product_retail_price,
    product_dealer_cost    = EXCLUDED.product_dealer_cost,
    original_product_gross = EXCLUDED.original_product_gross,
    contract_term_months   = EXCLUDED.contract_term_months,
    source_system          = EXCLUDED.source_system
WHERE (
    f.sale_key,
    f.sale_date_key,
    f.dealership_key,
    f.finance_manager_key,
    f.finance_product_key,
    f.lender_key,
    f.finance_structure,
    f.eligibility_rule_id,
    f.line_ordinal,
    f.product_sale_count,
    f.product_retail_price,
    f.product_dealer_cost,
    f.original_product_gross,
    f.contract_term_months,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.sale_key,
    EXCLUDED.sale_date_key,
    EXCLUDED.dealership_key,
    EXCLUDED.finance_manager_key,
    EXCLUDED.finance_product_key,
    EXCLUDED.lender_key,
    EXCLUDED.finance_structure,
    EXCLUDED.eligibility_rule_id,
    EXCLUDED.line_ordinal,
    EXCLUDED.product_sale_count,
    EXCLUDED.product_retail_price,
    EXCLUDED.product_dealer_cost,
    EXCLUDED.original_product_gross,
    EXCLUDED.contract_term_months,
    EXCLUDED.source_system
);
