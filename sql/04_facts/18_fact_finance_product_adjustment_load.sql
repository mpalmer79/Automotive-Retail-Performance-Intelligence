-- =============================================================================
-- File:            sql/04_facts/18_fact_finance_product_adjustment_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_finance_product_adjustment into warehouse.fact_finance_product_adjustment, resolving every surrogate key by natural-key join.
-- Execution order: After sql/04_facts/17_fact_finance_product_sale_load.sql, and at runtime by the Python loader.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per product adjustment event.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- Plain SQL only, executed as one cursor.execute() by src/arpi/ingestion/loader.py. No
-- psql meta-commands, no BEGIN/COMMIT. Safe against an empty database.
--
-- 18 SORTS AFTER 17, AND THAT IS THE POINT. An adjustment resolves the contract it acts
-- on against warehouse.fact_finance_product_sale, so the contract fact must already be
-- loaded. The join below is INNER and unforgiving: an adjustment whose contract does not
-- exist is dropped and recorded as a REJ-REF-001 rejection, because AN ORPHANED
-- ADJUSTMENT IS A NUMBER WITH NOTHING TO REDUCE -- it would appear in the
-- adjustment-period total and in no contract's net gross, and the two reads of the same
-- domain would then disagree with nothing to explain why.
--
-- IDEMPOTENCY ON AN EVENT FACT, WHICH IS NOT THE SAME AS ON A PLAN
-- ----------------------------------------------------------------
-- fact_sales_target upserts because a plan is a CURRENT STATEMENT and a later revision
-- replaces it. An adjustment is an EVENT and history is the point, so the conflict target
-- here is adjustment_id -- the event's own identity -- and a rerun of the SAME generated
-- population rewrites the same events rather than appending a second copy of them. It is
-- deliberately NOT (product_sale_key, adjustment_date): two genuine events on one
-- contract on one day would then collapse into one, which is a silent loss of an event
-- rather than a deduplication.
--
-- NOTHING IS CALCULATED HERE. No cumulative cap, no net gross, no rate. The cap is
-- RECON-FI-ADJUSTMENT-CAP's and DQ-FPA-007's; net gross is the reporting layer's.

WITH src AS (
    SELECT
        s.adjustment_id,
        contract.product_sale_key,
        contract.sale_key,
        d.date_key                     AS adjustment_date_key,
        store.dealership_key,
        manager.employee_key           AS finance_manager_key,
        product.finance_product_key,
        s.adjustment_type,
        s.adjustment_amount,
        s.adjustment_reason_category,
        s.sequence_ordinal,
        s.source_system
    FROM staging.stg_finance_product_adjustment AS s
    -- Required: the contract this event acts on, and its parent deal with it.
    JOIN warehouse.fact_finance_product_sale AS contract
      ON contract.product_sale_id = s.product_sale_id
    -- Required: the calendar, on the EVENT'S OWN date.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.adjustment_date
    -- Required: the store, as it stood on the day the event posted.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.adjustment_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the product.
    JOIN warehouse.dim_finance_product AS product
      ON product.finance_product_id = s.finance_product_id
    -- Optional by contract: NULL means the ORIGINAL deal was written with nobody on the
    -- F&I desk. Resolved as at the ADJUSTMENT date, because that is when this row exists;
    -- the person credited is still the one who wrote the deal, and DQ-FPA-010 checks
    -- that the identity carried here is the contract's own.
    LEFT JOIN warehouse.dim_employee AS manager
      ON manager.employee_id = s.finance_manager_id
     AND s.adjustment_date BETWEEN manager.effective_date AND manager.expiration_date
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.adjustment_key), 0)
         FROM warehouse.fact_finance_product_adjustment AS x)
            + row_number() OVER (ORDER BY s.adjustment_id) AS adjustment_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_finance_product_adjustment AS f
        WHERE f.adjustment_id = s.adjustment_id
    )
),
existing_rows AS (
    SELECT f.adjustment_key, s.*
    FROM src AS s
    JOIN warehouse.fact_finance_product_adjustment AS f
      ON f.adjustment_id = s.adjustment_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_finance_product_adjustment AS f (
    adjustment_key,
    adjustment_id,
    product_sale_key,
    sale_key,
    adjustment_date_key,
    dealership_key,
    finance_manager_key,
    finance_product_key,
    adjustment_type,
    adjustment_amount,
    adjustment_reason_category,
    sequence_ordinal,
    source_system
)
SELECT
    k.adjustment_key,
    k.adjustment_id,
    k.product_sale_key,
    k.sale_key,
    k.adjustment_date_key,
    k.dealership_key,
    k.finance_manager_key,
    k.finance_product_key,
    k.adjustment_type,
    k.adjustment_amount,
    k.adjustment_reason_category,
    k.sequence_ordinal,
    k.source_system
FROM merged AS k
ON CONFLICT (adjustment_id) DO UPDATE
SET product_sale_key           = EXCLUDED.product_sale_key,
    sale_key                   = EXCLUDED.sale_key,
    adjustment_date_key        = EXCLUDED.adjustment_date_key,
    dealership_key             = EXCLUDED.dealership_key,
    finance_manager_key        = EXCLUDED.finance_manager_key,
    finance_product_key        = EXCLUDED.finance_product_key,
    adjustment_type            = EXCLUDED.adjustment_type,
    adjustment_amount          = EXCLUDED.adjustment_amount,
    adjustment_reason_category = EXCLUDED.adjustment_reason_category,
    sequence_ordinal           = EXCLUDED.sequence_ordinal,
    source_system              = EXCLUDED.source_system
WHERE (
    f.product_sale_key,
    f.sale_key,
    f.adjustment_date_key,
    f.dealership_key,
    f.finance_manager_key,
    f.finance_product_key,
    f.adjustment_type,
    f.adjustment_amount,
    f.adjustment_reason_category,
    f.sequence_ordinal,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.product_sale_key,
    EXCLUDED.sale_key,
    EXCLUDED.adjustment_date_key,
    EXCLUDED.dealership_key,
    EXCLUDED.finance_manager_key,
    EXCLUDED.finance_product_key,
    EXCLUDED.adjustment_type,
    EXCLUDED.adjustment_amount,
    EXCLUDED.adjustment_reason_category,
    EXCLUDED.sequence_ordinal,
    EXCLUDED.source_system
);
