-- =============================================================================
-- File:            sql/04_facts/20_fact_gl_control_balance_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_gl_control_balance into warehouse.fact_gl_control_balance, resolving every surrogate key by natural-key join.
-- Execution order: After every dimension merge, including sql/03_dimensions/25_dim_gl_account_merge.sql, and at runtime by the Python loader.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when net_balance or source_system actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per dealership, per GL control account, per balance date.
-- =============================================================================
--
-- RUNTIME CONTRACT -- READ BEFORE EDITING
-- ---------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL only:
-- no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction), statements
-- separated by semicolons. Safe against an empty database.
--
-- NOTHING IS RECONCILED HERE, AND NOTHING IS CORRECTED HERE
-- ---------------------------------------------------------
-- net_balance is loaded exactly as it arrives. This script does not compare it with the
-- inventory subledger, does not adjust it towards the subledger, and does not drop a row
-- because the two disagree. A control balance that differs from the stock schedule is a
-- VARIANCE -- valid data describing a real reconciliation condition -- and the whole
-- point of the fact is that such rows survive to be reported.
--
-- The comparison itself is RECON-ACC-GL-SUBLEDGER in sql/08_validation and
-- reporting.vw_inventory_gl_reconciliation. Silently repairing a variance in the load
-- would leave a reconciliation surface that can only ever show agreement, which proves
-- nothing.
--
-- THE GRAIN IS THE CONFLICT TARGET
-- --------------------------------
-- gl_control_balance_id is the source system's identifier and does NOT appear on the
-- fact: the fact's identity is (balance date, store, account), enforced by
-- uq_fact_gl_control_balance_grain, and that constraint is the conflict target below.
-- Two balances at one (store, account, date) would double the control side and
-- manufacture a variance that is not there.
--
-- WHY THE STORE IS RESOLVED AS AT THE BALANCE DATE
-- ------------------------------------------------
-- dim_dealership is SCD Type 2, so the store is resolved as it stood on the balance date
-- rather than as at today. A month-end balance belongs to the store that existed at that
-- month-end, which is also the store the matching schedule resolves to -- the two sides
-- must land on the same dealership_key or the reconciliation compares different stores.
--
-- WHY EVERY JOIN IS AN INNER JOIN
-- -------------------------------
-- Every key on this fact is NOT NULL by contract:
--   * balance_date_key   -- a balance date the calendar does not contain has no schedule
--                           to be compared against, and comparability is matched-date.
--   * dealership_key     -- a balance for a store that does not exist reconciles to
--                           nothing.
--   * gl_account_key     -- resolved by gl_account_id against dim_gl_account. An account
--                           the catalogue does not contain is a scope breach, not a
--                           lookup miss: the catalogue's category CHECK is what keeps a
--                           general-ledger account out of this fact, and defaulting past
--                           it here would route around that boundary.
-- A row failing any of these is excluded and recorded as a REJ-REF-001 rejection by the
-- loader.
--
-- NO SIDE IS EVER FABRICATED
-- --------------------------
-- If the generator withheld a balance for a store-account-month, no row is invented
-- here. The reconciliation surface reports that as a missing GL side with a NULL
-- variance, never as a zero balance -- COALESCE-ing an absent balance to 0.00 would
-- report a full-inventory variance as though the account had genuinely been zeroed.

WITH src AS (
    SELECT
        d.date_key     AS balance_date_key,
        store.dealership_key,
        acct.gl_account_key,
        s.net_balance,
        s.source_system
    FROM staging.stg_gl_control_balance AS s
    -- Required: the calendar.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.balance_date
    -- Required: the store, as it stood on the balance date.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.balance_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the control account, by its business key.
    JOIN warehouse.dim_gl_account AS acct
      ON acct.gl_account_id = s.gl_account_id
),
new_rows AS (
    -- Rows the fact has never seen. Only these consume a new surrogate key.
    SELECT
        (SELECT coalesce(max(x.gl_control_balance_key), 0)
         FROM warehouse.fact_gl_control_balance AS x)
            + row_number() OVER (
                ORDER BY s.balance_date_key, s.dealership_key, s.gl_account_key
              ) AS gl_control_balance_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_gl_control_balance AS f
        WHERE f.balance_date_key = s.balance_date_key
          AND f.dealership_key = s.dealership_key
          AND f.gl_account_key = s.gl_account_key
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.gl_control_balance_key, s.*
    FROM src AS s
    JOIN warehouse.fact_gl_control_balance AS f
      ON f.balance_date_key = s.balance_date_key
     AND f.dealership_key = s.dealership_key
     AND f.gl_account_key = s.gl_account_key
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_gl_control_balance AS f (
    gl_control_balance_key,
    balance_date_key,
    dealership_key,
    gl_account_key,
    net_balance,
    source_system
)
SELECT
    k.gl_control_balance_key,
    k.balance_date_key,
    k.dealership_key,
    k.gl_account_key,
    k.net_balance,
    k.source_system
FROM merged AS k
ON CONFLICT (balance_date_key, dealership_key, gl_account_key) DO UPDATE
SET net_balance   = EXCLUDED.net_balance,
    source_system = EXCLUDED.source_system
WHERE (
    f.net_balance,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.net_balance,
    EXCLUDED.source_system
);
