-- =============================================================================
-- File:            sql/03_dimensions/24_dim_gl_account.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_gl_account, the selected synthetic control-account catalogue.
-- Execution order: Dimension layer, after the conformed dimensions, before sql/03_dimensions/25_dim_gl_account_merge.sql and before fact_gl_control_balance resolves gl_account_key.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per selected synthetic GL control account definition.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-023-dim-gl-account.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md), authorized by
-- ADR-0013 and DASHBOARD_PROGRAM.md.
--
-- THIS IS A SELECTED CONTROL CATALOGUE. IT IS NOT A CHART OF ACCOUNTS.
-- --------------------------------------------------------------------
-- ARPI is building a focused inventory control schedule and its reconciliation. It is
-- not building a general ledger, and this table is where that boundary is easiest to
-- breach: a chart of accounts is a long list, and a long list looks impressive.
--
-- So the catalogue is deliberately three rows -- one inventory asset control account per
-- governed inventory control category. There is no Cash, no Sales Revenue, no Cost of
-- Sales, no Payroll, no Parts, no Service, no Rent, no Accounts Payable, no Receivables,
-- no Equity, no Retained Earnings and no Tax account, because answering SQ-43 needs none
-- of them. A control catalogue that reconciles is worth more than a fake full COA that
-- does not.
--
-- The CHECK on account_category is what enforces this. An account outside the governed
-- inventory categories cannot be inserted at all, and DQ-GLA-009 additionally scans the
-- NAME for general-ledger vocabulary, so the boundary fails a run rather than a review.
--
-- FLOORPLAN LIABILITY IS NOT HERE, AND THAT IS A RECORDED DECISION
-- ----------------------------------------------------------------
-- warehouse.fact_inventory_accounting_snapshot carries floorplan_principal, so a
-- Floorplan Liability control account is available to model. It is deliberately absent.
--
-- KPI-ACC-001 is an inventory ASSET subledger measure, and putting a liability into the
-- same reconciliation invites exactly one mistake: netting the two into a "net inventory"
-- figure that means nothing and that no controller would recognise. No registered
-- stakeholder question requires liability reconciliation. Floorplan principal stays on
-- the stock-level schedule as liability CONTEXT, which is what it is.
--
-- account_type permits 'Liability' so a later increment can add one WITHOUT a migration
-- to the domain. If it does, it must be a separate liability class reconciling against
-- SUM(floorplan_principal), never against current_book_value, and it must never enter
-- KPI-ACC-001.
--
-- EVERY ACCOUNT IS FICTIONAL
-- --------------------------
-- The account numbers sit in a conventional dealership inventory block so the shape is
-- recognisable to a controller, and every one of them is invented. No real dealer group's
-- chart of accounts was consulted, copied or approximated, and none may be.
--
-- SCD POLICY: TYPE 1 (ADR-0006)
-- -----------------------------
-- An account's number, name and category are properties of the invented account, and a
-- correction to any of them describes what was always true. No fact points at a historical
-- version of an account definition, so there is no history requirement and the merge
-- overwrites in place. The active window is carried as attributes rather than as Type 2
-- rows for the same reason.

CREATE TABLE IF NOT EXISTS warehouse.dim_gl_account (
    gl_account_key          integer                 NOT NULL,
    gl_account_id           character varying(16)   NOT NULL,
    account_number          character varying(20)   NOT NULL,
    account_name            character varying(60)   NOT NULL,
    account_category        character varying(40)   NOT NULL,
    account_type            character varying(20)   NOT NULL,
    normal_balance          character varying(10)   NOT NULL,
    inventory_control_flag  boolean                 NOT NULL,
    active_start_date       date                    NOT NULL,
    active_end_date         date                    NULL,
    source_system           character varying(40)   NOT NULL,

    CONSTRAINT pk_dim_gl_account
        PRIMARY KEY (gl_account_key),
    CONSTRAINT uq_dim_gl_account_gl_account_id
        UNIQUE (gl_account_id),
    CONSTRAINT uq_dim_gl_account_account_number
        UNIQUE (account_number),
    CONSTRAINT ck_dim_gl_account_key_positive
        CHECK (gl_account_key > 0),
    -- The scope boundary, enforced physically. An account outside the governed inventory
    -- control categories belongs to a general ledger, which this project does not build.
    CONSTRAINT ck_dim_gl_account_category_domain
        CHECK (account_category IN (
            'New Vehicle Inventory',
            'Used Vehicle Inventory',
            'Certified Vehicle Inventory'
        )),
    CONSTRAINT ck_dim_gl_account_type_domain
        CHECK (account_type IN ('Asset', 'Liability')),
    CONSTRAINT ck_dim_gl_account_normal_balance_domain
        CHECK (normal_balance IN ('Debit', 'Credit')),
    -- A flag that contradicts the category it summarises is worse than no flag: a
    -- consumer trusts it precisely because it looks authoritative.
    CONSTRAINT ck_dim_gl_account_control_flag_agrees
        CHECK (inventory_control_flag = (account_category IN (
            'New Vehicle Inventory',
            'Used Vehicle Inventory',
            'Certified Vehicle Inventory'
        ))),
    CONSTRAINT ck_dim_gl_account_active_window_ordered
        CHECK (active_end_date IS NULL OR active_end_date >= active_start_date),
    CONSTRAINT ck_dim_gl_account_source_system_not_blank
        CHECK (btrim(source_system) <> '')
);

CREATE INDEX IF NOT EXISTS ix_dim_gl_account_category
    ON warehouse.dim_gl_account (account_category);

COMMENT ON TABLE warehouse.dim_gl_account IS
    'Grain: one row per SELECTED synthetic GL control account. A focused inventory control catalogue,
never a chart of accounts: three inventory asset control accounts, one per governed inventory control
category. There is no Cash, Revenue, Cost of Sales, Payroll, Parts, Service, Payable or Receivable
account, because answering SQ-43 requires none of them and ARPI does not build a general ledger. Every
account is FICTIONAL; no real dealer group''s chart of accounts was consulted or approximated. SCD
Type 1 (ADR-0006). Floorplan Liability is deliberately absent -- see the file header for the recorded
decision. Promoted by DASH.8.';

COMMENT ON COLUMN warehouse.dim_gl_account.gl_account_key IS 'Surrogate key. Assigned deterministically by the merge as max(existing) + row_number() OVER (ORDER BY gl_account_id), so rebuilding from the same CSVs reproduces identical keys.';
COMMENT ON COLUMN warehouse.dim_gl_account.gl_account_id IS 'Business key, GLA-####. Stable across loads.';
COMMENT ON COLUMN warehouse.dim_gl_account.account_number IS 'Synthetic account number in a conventional dealership inventory block. INVENTED; never a real dealer group''s account number.';
COMMENT ON COLUMN warehouse.dim_gl_account.account_name IS 'Human-readable account name. INVENTED. DQ-GLA-009 scans this for general-ledger vocabulary so the catalogue cannot quietly become a chart of accounts.';
COMMENT ON COLUMN warehouse.dim_gl_account.account_category IS 'The governed inventory control category this account schedules: New, Used or Certified Vehicle Inventory. Closed by CHECK. Certified is its own control account and that is deliberately NOT the sales rule, which groups Certified with Used -- a certified unit carries a capitalized certification cost the others do not.';
COMMENT ON COLUMN warehouse.dim_gl_account.account_type IS 'Asset or Liability. Every account in the DASH.8 catalogue is an Asset; Liability is permitted so a later increment can add a floorplan control account without a domain migration, and such an account must reconcile against floorplan principal and never enter KPI-ACC-001.';
COMMENT ON COLUMN warehouse.dim_gl_account.normal_balance IS 'Debit or Credit. Makes the sign of a balance unambiguous.';
COMMENT ON COLUMN warehouse.dim_gl_account.inventory_control_flag IS 'Whether the account is an inventory control account. CHECK-coupled to account_category so it cannot contradict the thing it summarises.';
COMMENT ON COLUMN warehouse.dim_gl_account.active_start_date IS 'First date the account is active. A business date from the synthetic dataset, never a wall clock.';
COMMENT ON COLUMN warehouse.dim_gl_account.active_end_date IS 'Last date the account is active; NULL while open. NULL means still open, never unknown.';
COMMENT ON COLUMN warehouse.dim_gl_account.source_system IS 'Originating system; constant SYNTHETIC-DMS-GL.';
