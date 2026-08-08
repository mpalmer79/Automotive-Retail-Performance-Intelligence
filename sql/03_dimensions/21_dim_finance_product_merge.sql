-- =============================================================================
-- File:            sql/03_dimensions/21_dim_finance_product_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent Type 1 merge of staging.stg_finance_product into warehouse.dim_finance_product.
-- Execution order: Dimension layer, after sql/03_dimensions/19_dim_finance_product.sql, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one attribute actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per finance product definition (warehouse.dim_finance_product grain).
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file name
-- and executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. The script must also be safe inside the ordinary
-- initialisation sequence against an empty database.
--
-- WHY TYPE 1 (ADR-0006)
-- ---------------------
-- A corrected product name, a restated eligibility rule or a repriced cost ratio
-- describes what was always true of the product, so it must apply retroactively. A
-- Type 2 table here would produce version rows that no contract could meaningfully
-- point at, and a consumer filtering on is_current would silently lose every row.
-- active_start_date / active_end_date are NOT versioning: they record when the
-- product was OFFERED, which is an attribute of the product rather than of the row.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- finance_product_key is assigned as max(existing) + row_number() OVER (ORDER BY finance_product_id) over the rows
-- that are NEW to the dimension, rather than from a sequence: rebuilding a database from
-- the same CSVs reproduces identical keys, and a sequence would drift after any
-- rolled-back load because sequences are non-transactional. Rows already present keep
-- the key they were given, so a key is never reused and never reassigned. The
-- generator-supplied ordinal is deliberately ignored; staging exposes it as lineage only.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE every rerun would rewrite every row, producing
-- dead tuples, pointless WAL and a misleading row count. The comparison uses IS DISTINCT
-- FROM so that a NULL on both sides counts as equal.


WITH src AS (
    SELECT
        s.finance_product_id AS finance_product_id,
        s.product_name AS product_name,
        s.product_category AS product_category,
        s.provider_name AS provider_name,
        s.eligibility_rule_id AS eligibility_rule_id,
        s.eligible_finance_structures AS eligible_finance_structures,
        s.eligible_vehicle_conditions AS eligible_vehicle_conditions,
        s.default_contract_term_months AS default_contract_term_months,
        s.cancellation_sensitive AS cancellation_sensitive,
        s.chargeback_sensitive AS chargeback_sensitive,
        s.active_start_date AS active_start_date,
        s.active_end_date AS active_end_date,
        s.is_active AS is_active,
        s.source_system AS source_system
    FROM staging.stg_finance_product AS s
),
new_rows AS (
    -- Rows the dimension has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.finance_product_key), 0) FROM warehouse.dim_finance_product AS x)
            + row_number() OVER (ORDER BY s.finance_product_id) AS finance_product_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.dim_finance_product AS d WHERE d.finance_product_id = s.finance_product_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT d.finance_product_key, s.*
    FROM src AS s
    JOIN warehouse.dim_finance_product AS d ON d.finance_product_id = s.finance_product_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.dim_finance_product AS d (
    finance_product_key,
    finance_product_id,
    product_name,
    product_category,
    provider_name,
    eligibility_rule_id,
    eligible_finance_structures,
    eligible_vehicle_conditions,
    default_contract_term_months,
    cancellation_sensitive,
    chargeback_sensitive,
    active_start_date,
    active_end_date,
    is_active,
    source_system
)
SELECT
    k.finance_product_key,
    k.finance_product_id,
    k.product_name,
    k.product_category,
    k.provider_name,
    k.eligibility_rule_id,
    k.eligible_finance_structures,
    k.eligible_vehicle_conditions,
    k.default_contract_term_months,
    k.cancellation_sensitive,
    k.chargeback_sensitive,
    k.active_start_date,
    k.active_end_date,
    k.is_active,
    k.source_system
FROM merged AS k
ON CONFLICT (finance_product_id) DO UPDATE
SET product_name                 = EXCLUDED.product_name,
    product_category             = EXCLUDED.product_category,
    provider_name                = EXCLUDED.provider_name,
    eligibility_rule_id          = EXCLUDED.eligibility_rule_id,
    eligible_finance_structures  = EXCLUDED.eligible_finance_structures,
    eligible_vehicle_conditions  = EXCLUDED.eligible_vehicle_conditions,
    default_contract_term_months = EXCLUDED.default_contract_term_months,
    cancellation_sensitive       = EXCLUDED.cancellation_sensitive,
    chargeback_sensitive         = EXCLUDED.chargeback_sensitive,
    active_start_date            = EXCLUDED.active_start_date,
    active_end_date              = EXCLUDED.active_end_date,
    is_active                    = EXCLUDED.is_active,
    source_system                = EXCLUDED.source_system
WHERE (
    d.product_name,
    d.product_category,
    d.provider_name,
    d.eligibility_rule_id,
    d.eligible_finance_structures,
    d.eligible_vehicle_conditions,
    d.default_contract_term_months,
    d.cancellation_sensitive,
    d.chargeback_sensitive,
    d.active_start_date,
    d.active_end_date,
    d.is_active,
    d.source_system
) IS DISTINCT FROM (
    EXCLUDED.product_name,
    EXCLUDED.product_category,
    EXCLUDED.provider_name,
    EXCLUDED.eligibility_rule_id,
    EXCLUDED.eligible_finance_structures,
    EXCLUDED.eligible_vehicle_conditions,
    EXCLUDED.default_contract_term_months,
    EXCLUDED.cancellation_sensitive,
    EXCLUDED.chargeback_sensitive,
    EXCLUDED.active_start_date,
    EXCLUDED.active_end_date,
    EXCLUDED.is_active,
    EXCLUDED.source_system
);
