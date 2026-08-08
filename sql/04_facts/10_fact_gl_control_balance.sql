-- =============================================================================
-- File:            sql/04_facts/10_fact_gl_control_balance.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_gl_control_balance, the selected synthetic control-account balances.
-- Execution order: After warehouse.dim_gl_account and every other dimension it references.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per dealership, per GL control account, per balance date.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-024-fact-gl-control-balance.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS FACT IS
-- -----------------
-- One control-account balance per store per account per month-end: the GL side of the
-- reconciliation the stock schedule is compared against.
--
-- WHAT AN EXACT RECONCILIATION AGAINST IT PROVES, AND WHAT IT DOES NOT
-- --------------------------------------------------------------------
-- These balances are GENERATED from the same subledger they are reconciled against, plus
-- a governed table of deliberate variances, so the reconciliation surface can be seen
-- working in both its states. That is the whole reason the fact exists.
--
-- It is NOT an independently ingested second accounting system. An exact reconciliation
-- proves the reconciliation ARITHMETIC is correct; it does not prove that two independent
-- sources agree, because there is only one source. LIMITATIONS.md records this, every
-- reporting view that publishes a variance repeats it, and no surface may claim otherwise.
--
-- ONLY net_balance, AND THAT IS DELIBERATE
-- ----------------------------------------
-- No debit_balance, no credit_balance, no journal reference, no posting batch. The
-- governed question -- does the control account agree with the schedule -- is answered by
-- one signed balance, and manufacturing debit/credit detail to look accounting-like would
-- be inventing a general ledger one column at a time. normal_balance on dim_gl_account
-- states the account's natural side, which is what makes the sign unambiguous.
--
-- SEMI-ADDITIVITY
-- ---------------
-- net_balance is ADDITIVE across accounts and stores AT ONE balance date, and is NEVER
-- additive across dates. Summing two month-ends produces a number that is not a balance.
-- A period-ending balance is the LAST comparable date, not a sum.
--
-- COMPARABILITY: MATCHED DATES ONLY
-- ---------------------------------
-- A GL balance and a subledger balance are comparable only when the store, the control
-- account and the DATE all match. Comparing a month-end control balance with a mid-month
-- schedule and calling the difference a variance is the classic reconciliation error, and
-- it is prevented here by both sides being month-end by construction.
--
-- A VARIANCE IS NOT A DEFECT. A balance that differs from the schedule is structurally
-- valid data; whether the two AGREE is a reconciliation question answered in
-- sql/08_validation and rendered by reporting.vw_inventory_gl_reconciliation. There is
-- deliberately no constraint here requiring agreement.
--
-- PRIVACY: no personal data. A control balance names a store, an account and a date.

CREATE TABLE IF NOT EXISTS warehouse.fact_gl_control_balance (
    gl_control_balance_key  bigint         NOT NULL,
    balance_date_key        integer        NOT NULL,
    dealership_key          integer        NOT NULL,
    gl_account_key          integer        NOT NULL,
    net_balance             numeric(16,2)  NOT NULL,
    source_system           varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_gl_control_balance
        PRIMARY KEY (gl_control_balance_key),
    -- THE declared grain, enforced over three NOT NULL columns. A second balance at one
    -- (store, account, date) would double the control side and manufacture a variance
    -- that is not there.
    CONSTRAINT uq_fact_gl_control_balance_grain
        UNIQUE (balance_date_key, dealership_key, gl_account_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_gl_control_balance_key_positive
        CHECK (gl_control_balance_key > 0),
    CONSTRAINT ck_fact_gl_control_balance_source_system_not_blank
        CHECK (btrim(source_system) <> '')
    -- Deliberately NO constraint requiring net_balance to equal the subledger. A
    -- controlled variance is valid data and the exception surface exists to show it.
);

DO $fk_fact_gl_control_balance$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fact_gl_control_balance_date'
    ) THEN
        ALTER TABLE warehouse.fact_gl_control_balance
            ADD CONSTRAINT fk_fact_gl_control_balance_date
            FOREIGN KEY (balance_date_key)
            REFERENCES warehouse.dim_date (date_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fact_gl_control_balance_dealership'
    ) THEN
        ALTER TABLE warehouse.fact_gl_control_balance
            ADD CONSTRAINT fk_fact_gl_control_balance_dealership
            FOREIGN KEY (dealership_key)
            REFERENCES warehouse.dim_dealership (dealership_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fact_gl_control_balance_account'
    ) THEN
        ALTER TABLE warehouse.fact_gl_control_balance
            ADD CONSTRAINT fk_fact_gl_control_balance_account
            FOREIGN KEY (gl_account_key)
            REFERENCES warehouse.dim_gl_account (gl_account_key) ON DELETE RESTRICT;
    END IF;
END
$fk_fact_gl_control_balance$;

CREATE INDEX IF NOT EXISTS ix_fact_gl_control_balance_date_store
    ON warehouse.fact_gl_control_balance (balance_date_key, dealership_key);

COMMENT ON TABLE warehouse.fact_gl_control_balance IS
    'Grain: one row per dealership per GL control account per balance date. The GL side of the inventory
reconciliation. Balances are month-end, matching the accounting schedule, so the two are comparable at
matched dates only -- comparing a month-end control balance with a mid-month schedule and calling the
difference a variance is the reconciliation error this grain prevents. SEMI-ADDITIVE: additive across
accounts and stores at ONE date, never summed across dates; a period-ending balance is the last
comparable date. Carries net_balance only -- no debit/credit detail, no journal reference, no posting
batch, because the governed question is answered by one signed balance and manufacturing journal-level
detail would be inventing a general ledger. THESE BALANCES ARE GENERATED FROM THE SUBLEDGER THEY ARE
RECONCILED AGAINST, plus governed deliberate variances: an exact reconciliation proves the arithmetic,
NOT that two independent sources agree. A balance differing from the schedule is valid data and a
VARIANCE, never a defect. All values synthetic; no personal data. Promoted by DASH.8.';

COMMENT ON COLUMN warehouse.fact_gl_control_balance.gl_control_balance_key IS 'Surrogate key. Assigned deterministically by the load from the natural key ordering.';
COMMENT ON COLUMN warehouse.fact_gl_control_balance.balance_date_key IS 'Month-end the balance is stated as at. Part of the declared grain. Comparable only with a schedule at the same date.';
COMMENT ON COLUMN warehouse.fact_gl_control_balance.dealership_key IS 'Store the balance belongs to. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_gl_control_balance.gl_account_key IS 'The control account. Part of the declared grain. Resolved through warehouse.dim_gl_account, whose category domain keeps a general-ledger account out of this fact.';
COMMENT ON COLUMN warehouse.fact_gl_control_balance.net_balance IS 'The control-account balance, exact to two decimal places. May legitimately differ from the inventory subledger: that difference is KPI-ACC-003''s signed variance and an exception to investigate, never proof of an accounting error. Semi-additive: sum across accounts and stores at one date, never across dates.';
COMMENT ON COLUMN warehouse.fact_gl_control_balance.source_system IS 'Originating system; constant SYNTHETIC-DMS-GL.';
