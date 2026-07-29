-- =============================================================================
-- File:            sql/04_facts/10_fact_vehicle_sale_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_sale_event into warehouse.fact_vehicle_sale, resolving every surrogate key by natural-key join.
-- Execution order: 54 of 73 in the initialisation sequence, and at runtime by the Python loader after every dimension merge.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per finalized vehicle transaction (warehouse.fact_vehicle_sale grain).
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. The script must also be safe to run inside
-- the ordinary initialisation sequence against an empty database: with no raw rows
-- the staging view yields nothing and every statement affects zero rows.
--
-- SURROGATE KEYS ARE RESOLVED, NEVER ASSUMED
-- ------------------------------------------
-- Every key below comes from a join on the natural key the source actually carries.
-- No ordinal is assumed, no generator-supplied key is trusted, and no key is
-- defaulted to a placeholder row. A dimension that has not been loaded therefore
-- costs the fact its rows, visibly, rather than silently attaching them to the
-- wrong member.
--
-- WHY dim_employee IS JOINED ON THE SALE DATE
-- -------------------------------------------
-- dim_employee is SCD Type 2: one row per role-assignment version, with
-- [effective_date, expiration_date] covering the person's time in that role at that
-- store. The join below therefore resolves the version whose range CONTAINS the
-- sale date -- not the current one. That is the entire point of Type 2. Resolving
-- to is_current instead would credit a July deal at the Nashua store to whichever
-- store the salesperson happens to work at today, silently moving volume and gross
-- between stores every time somebody transfers.
--
-- dim_dealership is Type 2 for the same reason and is joined the same way.
--
-- WHY THE DATE JOINS ARE INNER
-- ----------------------------
-- sale_date_key and delivery_date_key are NOT NULL and carry foreign keys into
-- warehouse.dim_date, which covers the reporting window and nothing else. A sale
-- dated outside the window cannot be reported at all, so it is excluded here and
-- recorded as a REJ-REF-001 rejection in audit.rejected_record by the loader
-- (_collect_unresolved_dates in src/arpi/ingestion/loader.py). It is neither
-- silently dropped nor defaulted to a placeholder date.
--
-- WHY SOME JOINS ARE LEFT
-- -----------------------
-- customer_key, the three employee keys and lead_source_key are nullable by
-- contract, and NULL there is a modelled fact rather than a missing value: a
-- wholesale deal has no retail buyer, a deal may carry no finance manager, and
-- lead-source attribution is a later increment. The source id is NULL in exactly
-- those cases, so the LEFT JOIN yields NULL only where the contract says it should.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- sale_key is assigned as
--     (SELECT coalesce(max(sale_key), 0) FROM warehouse.fact_vehicle_sale)
--     + row_number() OVER (ORDER BY sale_id)
-- over the rows that are NEW to the fact, exactly as the dimension merges assign
-- theirs. A first load into an empty fact yields 1..N in sale_id order; a rebuild
-- from the same CSVs reproduces identical keys; a row already present keeps the key
-- it was given, so fact_lead.sale_key and fact_appointment.sale_key never dangle.
--
-- WHY THE UPDATE IS GUARDED
-- -------------------------
-- Without the WHERE clause on DO UPDATE every rerun would rewrite every row,
-- producing dead tuples, pointless WAL and a misleading row count. The comparison
-- uses IS DISTINCT FROM so that a NULL on both sides counts as equal.
--
-- THE CHECK CONSTRAINTS ARE HONOURED, NOT WORKED AROUND
-- -----------------------------------------------------
-- is_retail, front_end_gross and total_gross are carried through from the source
-- rather than recomputed here, because the table's CHECK constraints already state
-- the identities. If the source ever disagreed with them the load would fail loudly
-- on the constraint, which is the outcome we want: a stored gross that silently
-- disagrees with its inputs is the most common way a dashboard lies.

WITH src AS (
    SELECT
        s.sale_id,
        d_sale.date_key                AS sale_date_key,
        d_delivery.date_key            AS delivery_date_key,
        store.dealership_key,
        veh.vehicle_key,
        cust.customer_key,
        sales_person.employee_key      AS salesperson_key,
        desk.employee_key              AS desk_manager_key,
        finance.employee_key           AS finance_manager_key,
        lead_source.lead_source_key,
        s.sale_type,
        s.is_retail,
        s.unit_count,
        s.sale_price,
        s.msrp,
        s.original_asking_price,
        s.final_asking_price,
        s.acquisition_cost,
        s.reconditioning_cost,
        s.pack_amount,
        s.front_end_gross,
        s.back_end_gross,
        s.total_gross,
        s.trade_allowance,
        s.trade_acv,
        s.cash_down,
        s.amount_financed,
        s.days_in_inventory_at_sale,
        s.source_system
    FROM staging.stg_sale_event AS s
    -- Required: the calendar. A date the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d_sale
      ON d_sale.full_date = s.sale_date
    JOIN warehouse.dim_date AS d_delivery
      ON d_delivery.full_date = s.delivery_date
    -- Required: the selling store, as it stood on the day of the deal.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.sale_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the unit.
    JOIN warehouse.dim_vehicle AS veh
      ON veh.vehicle_id = s.vehicle_id
    -- Optional by contract: NULL means 'no retail buyer', never 'buyer unknown'.
    LEFT JOIN warehouse.dim_customer AS cust
      ON cust.customer_id = s.customer_id
    -- Optional by contract, and resolved AS AT THE SALE DATE, not as at today.
    LEFT JOIN warehouse.dim_employee AS sales_person
      ON sales_person.employee_id = s.salesperson_id
     AND s.sale_date BETWEEN sales_person.effective_date AND sales_person.expiration_date
    LEFT JOIN warehouse.dim_employee AS desk
      ON desk.employee_id = s.desk_manager_id
     AND s.sale_date BETWEEN desk.effective_date AND desk.expiration_date
    LEFT JOIN warehouse.dim_employee AS finance
      ON finance.employee_id = s.finance_manager_id
     AND s.sale_date BETWEEN finance.effective_date AND finance.expiration_date
    -- Optional by contract: attribution is populated in a later increment.
    LEFT JOIN warehouse.dim_lead_source AS lead_source
      ON lead_source.lead_source_id = s.lead_source_id
),
new_rows AS (
    -- Rows the fact has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.sale_key), 0) FROM warehouse.fact_vehicle_sale AS x)
            + row_number() OVER (ORDER BY s.sale_id) AS sale_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.fact_vehicle_sale AS f WHERE f.sale_id = s.sale_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load, so a
    -- fact_lead or fact_appointment row that already points at them stays valid.
    SELECT f.sale_key, s.*
    FROM src AS s
    JOIN warehouse.fact_vehicle_sale AS f ON f.sale_id = s.sale_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_vehicle_sale AS f (
    sale_key,
    sale_id,
    sale_date_key,
    delivery_date_key,
    dealership_key,
    vehicle_key,
    customer_key,
    salesperson_key,
    desk_manager_key,
    finance_manager_key,
    lead_source_key,
    sale_type,
    is_retail,
    unit_count,
    sale_price,
    msrp,
    original_asking_price,
    final_asking_price,
    acquisition_cost,
    reconditioning_cost,
    pack_amount,
    front_end_gross,
    back_end_gross,
    total_gross,
    trade_allowance,
    trade_acv,
    cash_down,
    amount_financed,
    days_in_inventory_at_sale,
    source_system
)
SELECT
    k.sale_key,
    k.sale_id,
    k.sale_date_key,
    k.delivery_date_key,
    k.dealership_key,
    k.vehicle_key,
    k.customer_key,
    k.salesperson_key,
    k.desk_manager_key,
    k.finance_manager_key,
    k.lead_source_key,
    k.sale_type,
    k.is_retail,
    k.unit_count,
    k.sale_price,
    k.msrp,
    k.original_asking_price,
    k.final_asking_price,
    k.acquisition_cost,
    k.reconditioning_cost,
    k.pack_amount,
    k.front_end_gross,
    k.back_end_gross,
    k.total_gross,
    k.trade_allowance,
    k.trade_acv,
    k.cash_down,
    k.amount_financed,
    k.days_in_inventory_at_sale,
    k.source_system
FROM merged AS k
ON CONFLICT (sale_id) DO UPDATE
SET sale_date_key             = EXCLUDED.sale_date_key,
    delivery_date_key         = EXCLUDED.delivery_date_key,
    dealership_key            = EXCLUDED.dealership_key,
    vehicle_key               = EXCLUDED.vehicle_key,
    customer_key              = EXCLUDED.customer_key,
    salesperson_key           = EXCLUDED.salesperson_key,
    desk_manager_key          = EXCLUDED.desk_manager_key,
    finance_manager_key       = EXCLUDED.finance_manager_key,
    lead_source_key           = EXCLUDED.lead_source_key,
    sale_type                 = EXCLUDED.sale_type,
    is_retail                 = EXCLUDED.is_retail,
    unit_count                = EXCLUDED.unit_count,
    sale_price                = EXCLUDED.sale_price,
    msrp                      = EXCLUDED.msrp,
    original_asking_price     = EXCLUDED.original_asking_price,
    final_asking_price        = EXCLUDED.final_asking_price,
    acquisition_cost          = EXCLUDED.acquisition_cost,
    reconditioning_cost       = EXCLUDED.reconditioning_cost,
    pack_amount               = EXCLUDED.pack_amount,
    front_end_gross           = EXCLUDED.front_end_gross,
    back_end_gross            = EXCLUDED.back_end_gross,
    total_gross               = EXCLUDED.total_gross,
    trade_allowance           = EXCLUDED.trade_allowance,
    trade_acv                 = EXCLUDED.trade_acv,
    cash_down                 = EXCLUDED.cash_down,
    amount_financed           = EXCLUDED.amount_financed,
    days_in_inventory_at_sale = EXCLUDED.days_in_inventory_at_sale,
    source_system             = EXCLUDED.source_system
WHERE (
    f.sale_date_key,
    f.delivery_date_key,
    f.dealership_key,
    f.vehicle_key,
    f.customer_key,
    f.salesperson_key,
    f.desk_manager_key,
    f.finance_manager_key,
    f.lead_source_key,
    f.sale_type,
    f.is_retail,
    f.unit_count,
    f.sale_price,
    f.msrp,
    f.original_asking_price,
    f.final_asking_price,
    f.acquisition_cost,
    f.reconditioning_cost,
    f.pack_amount,
    f.front_end_gross,
    f.back_end_gross,
    f.total_gross,
    f.trade_allowance,
    f.trade_acv,
    f.cash_down,
    f.amount_financed,
    f.days_in_inventory_at_sale,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.sale_date_key,
    EXCLUDED.delivery_date_key,
    EXCLUDED.dealership_key,
    EXCLUDED.vehicle_key,
    EXCLUDED.customer_key,
    EXCLUDED.salesperson_key,
    EXCLUDED.desk_manager_key,
    EXCLUDED.finance_manager_key,
    EXCLUDED.lead_source_key,
    EXCLUDED.sale_type,
    EXCLUDED.is_retail,
    EXCLUDED.unit_count,
    EXCLUDED.sale_price,
    EXCLUDED.msrp,
    EXCLUDED.original_asking_price,
    EXCLUDED.final_asking_price,
    EXCLUDED.acquisition_cost,
    EXCLUDED.reconditioning_cost,
    EXCLUDED.pack_amount,
    EXCLUDED.front_end_gross,
    EXCLUDED.back_end_gross,
    EXCLUDED.total_gross,
    EXCLUDED.trade_allowance,
    EXCLUDED.trade_acv,
    EXCLUDED.cash_down,
    EXCLUDED.amount_financed,
    EXCLUDED.days_in_inventory_at_sale,
    EXCLUDED.source_system
);
