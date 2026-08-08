-- =============================================================================
-- File:            sql/04_facts/19_fact_inventory_accounting_snapshot_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_inventory_accounting into warehouse.fact_inventory_accounting_snapshot, resolving every surrogate key by natural-key join.
-- Execution order: After every dimension merge, including sql/03_dimensions/25_dim_gl_account_merge.sql, and at runtime by the Python loader.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per vehicle per dealership per accounting date.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL only:
-- no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction), statements
-- separated by semicolons. Safe against an empty database.
--
-- NOTHING IS CALCULATED HERE
-- --------------------------
-- current_book_value is NOT recomputed. It arrives from staging as the generator
-- produced it, and the fact's ck_fact_inventory_accounting_book_value_identity CHECK
-- re-derives the identity in the database and refuses the row if the two disagree.
-- Recomputing the total here would make that constraint tautological: the load would
-- always satisfy a rule it had just enforced on itself, and a generator defect in a
-- component would land silently. The constraint has to be able to fail.
--
-- The same applies to control_account_category. It is carried through unchanged and
-- checked against the account it resolves, rather than being re-derived from
-- dim_vehicle.condition_type here.
--
-- THE GRAIN IS THE CONFLICT TARGET
-- --------------------------------
-- inventory_accounting_id is the source system's identifier and does NOT appear on the
-- fact: the fact's identity is (accounting date, store, vehicle), enforced by
-- uq_fact_inventory_accounting_snapshot_grain, and that constraint is the conflict
-- target below. A unit cannot be on one store's schedule twice on one date -- that
-- would count its book value twice in the control balance and manufacture a variance
-- that is not there.
--
-- WHY THE STORE IS RESOLVED AS AT THE ACCOUNTING DATE
-- ---------------------------------------------------
-- dim_dealership is SCD Type 2, so the store is resolved as it stood on the accounting
-- date rather than as at today. A month-end schedule belongs to the store that existed
-- at that month-end.
--
-- WHY EVERY JOIN IS AN INNER JOIN
-- -------------------------------
-- Every key on this fact is NOT NULL by contract, and there is no defensible default
-- for any of them:
--   * accounting_date_key    -- a schedule date the calendar does not contain cannot be
--                              compared with a control balance at all.
--   * acquisition_date_key   -- the posting-lag denominator. Defaulting it to the
--                              accounting date would silently report a lag of zero.
--   * dealership_key         -- a schedule line for a store that does not exist cannot
--                              be reconciled against that store's control account.
--   * vehicle_key            -- a schedule line with no unit is not a stock schedule.
--   * gl_account_key         -- resolved from control_account_category through
--                              dim_gl_account. A category with no control account has
--                              nowhere to reconcile TO, which is exactly the condition
--                              DQ-IAS-014 exists to surface.
-- A row that fails any of these is excluded here and recorded as a REJ-REF-001
-- rejection by the loader, rather than being defaulted to a nearby date, store or
-- account. Defaulting would move book value onto the wrong control account, which is
-- the single most damaging error this model can make.
--
-- FLOORPLAN PRINCIPAL IS CARRIED, NEVER NETTED
-- --------------------------------------------
-- floorplan_principal moves through this load as an independent column. It is not added
-- to, subtracted from, or reconciled against current_book_value here or anywhere else.
-- It is a liability recorded as context on an asset schedule.

WITH src AS (
    SELECT
        d.date_key                     AS accounting_date_key,
        store.dealership_key,
        veh.vehicle_key,
        acct.gl_account_key,
        acq.date_key                   AS acquisition_date_key,
        s.control_account_category,
        s.acquisition_cost,
        s.capitalized_transportation,
        s.capitalized_reconditioning,
        s.capitalized_accessories,
        s.other_capitalized_costs,
        s.write_down_amount,
        s.current_book_value,
        s.floorplan_principal,
        s.days_in_stock,
        s.source_system
    FROM staging.stg_inventory_accounting AS s
    -- Required: the calendar, for the schedule date and for the acquisition date. Both
    -- must be real business dates; neither is ever a wall clock.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.accounting_date
    JOIN warehouse.dim_date AS acq
      ON acq.full_date = s.acquisition_date
    -- Required: the store, as it stood on the accounting date.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.accounting_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the unit.
    JOIN warehouse.dim_vehicle AS veh
      ON veh.vehicle_id = s.vehicle_id
    -- Required: the control account this line schedules against, resolved from the
    -- governed category rather than from a literal account number in the CSV. The
    -- generator never names an account; the category is the contract between the
    -- subledger and the catalogue.
    JOIN warehouse.dim_gl_account AS acct
      ON acct.account_category = s.control_account_category
     AND acct.inventory_control_flag
),
new_rows AS (
    -- Rows the fact has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.inventory_accounting_key), 0)
         FROM warehouse.fact_inventory_accounting_snapshot AS x)
            + row_number() OVER (
                ORDER BY s.accounting_date_key, s.dealership_key, s.vehicle_key
              ) AS inventory_accounting_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_inventory_accounting_snapshot AS f
        WHERE f.accounting_date_key = s.accounting_date_key
          AND f.dealership_key = s.dealership_key
          AND f.vehicle_key = s.vehicle_key
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.inventory_accounting_key, s.*
    FROM src AS s
    JOIN warehouse.fact_inventory_accounting_snapshot AS f
      ON f.accounting_date_key = s.accounting_date_key
     AND f.dealership_key = s.dealership_key
     AND f.vehicle_key = s.vehicle_key
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_inventory_accounting_snapshot AS f (
    inventory_accounting_key,
    accounting_date_key,
    dealership_key,
    vehicle_key,
    gl_account_key,
    acquisition_date_key,
    control_account_category,
    acquisition_cost,
    capitalized_transportation,
    capitalized_reconditioning,
    capitalized_accessories,
    other_capitalized_costs,
    write_down_amount,
    current_book_value,
    floorplan_principal,
    days_in_stock,
    source_system
)
SELECT
    k.inventory_accounting_key,
    k.accounting_date_key,
    k.dealership_key,
    k.vehicle_key,
    k.gl_account_key,
    k.acquisition_date_key,
    k.control_account_category,
    k.acquisition_cost,
    k.capitalized_transportation,
    k.capitalized_reconditioning,
    k.capitalized_accessories,
    k.other_capitalized_costs,
    k.write_down_amount,
    k.current_book_value,
    k.floorplan_principal,
    k.days_in_stock,
    k.source_system
FROM merged AS k
ON CONFLICT (accounting_date_key, dealership_key, vehicle_key) DO UPDATE
SET gl_account_key             = EXCLUDED.gl_account_key,
    acquisition_date_key       = EXCLUDED.acquisition_date_key,
    control_account_category   = EXCLUDED.control_account_category,
    acquisition_cost           = EXCLUDED.acquisition_cost,
    capitalized_transportation = EXCLUDED.capitalized_transportation,
    capitalized_reconditioning = EXCLUDED.capitalized_reconditioning,
    capitalized_accessories    = EXCLUDED.capitalized_accessories,
    other_capitalized_costs    = EXCLUDED.other_capitalized_costs,
    write_down_amount          = EXCLUDED.write_down_amount,
    current_book_value         = EXCLUDED.current_book_value,
    floorplan_principal        = EXCLUDED.floorplan_principal,
    days_in_stock              = EXCLUDED.days_in_stock,
    source_system              = EXCLUDED.source_system
WHERE (
    f.gl_account_key,
    f.acquisition_date_key,
    f.control_account_category,
    f.acquisition_cost,
    f.capitalized_transportation,
    f.capitalized_reconditioning,
    f.capitalized_accessories,
    f.other_capitalized_costs,
    f.write_down_amount,
    f.current_book_value,
    f.floorplan_principal,
    f.days_in_stock,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.gl_account_key,
    EXCLUDED.acquisition_date_key,
    EXCLUDED.control_account_category,
    EXCLUDED.acquisition_cost,
    EXCLUDED.capitalized_transportation,
    EXCLUDED.capitalized_reconditioning,
    EXCLUDED.capitalized_accessories,
    EXCLUDED.other_capitalized_costs,
    EXCLUDED.write_down_amount,
    EXCLUDED.current_book_value,
    EXCLUDED.floorplan_principal,
    EXCLUDED.days_in_stock,
    EXCLUDED.source_system
);
