-- =============================================================================
-- File:            sql/04_facts/09_fact_inventory_accounting_snapshot.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_inventory_accounting_snapshot, the stock-level inventory accounting schedule.
-- Execution order: After every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per vehicle, per dealership, per accounting snapshot date, while the vehicle is carried.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-022-fact-inventory-accounting-snapshot.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md), authorized by
-- ADR-0013 and DASHBOARD_PROGRAM.md.
--
-- WHAT THIS FACT IS
-- -----------------
-- The controller's stock schedule: what each carried unit is worth on the books at one
-- month-end, and what is owed against it. ARPI IS BUILDING A FOCUSED INVENTORY CONTROL
-- SCHEDULE. IT IS NOT BUILDING A GENERAL LEDGER -- there is no journal, no journal line,
-- no posting batch, no trial balance and no financial statement anywhere in this project.
--
-- THE BOOK-VALUE IDENTITY, ENFORCED HERE
-- --------------------------------------
--     current_book_value = acquisition_cost
--                        + capitalized_transportation
--                        + capitalized_reconditioning
--                        + capitalized_accessories
--                        + other_capitalized_costs
--                        - write_down_amount
--
-- Exact equality, no tolerance: every column is numeric(14,2), so a penny difference is a
-- defect and not a rounding artefact. It is a CHECK rather than a staging rule because a
-- violation must be UNLOADABLE, not merely quarantined -- the whole domain rests on this
-- one line, and RECON-ACC-BOOK-IDENTITY proves it independently over the loaded rows.
--
-- PACK IS NOT IN IT. Pack is a front-gross deduction (KPI-GRS-001) and an internal
-- allocation, not a capitalized cost of the vehicle. There is deliberately no pack column
-- on this fact: moving pack into book value would redefine the front-gross identity on
-- every deal, which DASH.8 is forbidden to touch.
--
-- FLOORPLAN PRINCIPAL IS NOT IN IT EITHER, AND THAT IS THE POINT OF THE COLUMN
-- ----------------------------------------------------------------------------
-- floorplan_principal is a LIABILITY POSITION. It is never added to book value, never
-- subtracted from it, and never netted against inventory value to manufacture a "net
-- inventory" figure that means nothing. The CHECK above excludes it by construction, and
-- DQ-IAS-014 asserts the exclusion as a property of the data.
--
-- A unit with floorplan_principal = 0.00 is an OWNED, UNFLOORED unit -- a legitimate
-- synthetic position and never missing data. After a write-down a unit may legitimately
-- owe more than it is carried at, which is exactly why the two are never netted.
--
-- ARPI models no rate, no interest, no curtailment, no maturity and no lender terms, so
-- nothing here can be read as floorplan cost analysis.
--
-- SEMI-ADDITIVITY -- THE RULE THAT MATTERS MOST DOWNSTREAM
-- --------------------------------------------------------
-- current_book_value and floorplan_principal are ADDITIVE across vehicles, stores and
-- control categories AT ONE accounting date, and are NEVER additive across dates. Summing
-- two month-ends produces a number that is not a balance of anything. A period-ending
-- balance is the LAST applicable snapshot date, not a sum. Every reporting view and every
-- KPI that reads this fact repeats the rule in its own comment.
--
-- SNAPSHOT HISTORY IS NEVER REWRITTEN
-- -----------------------------------
-- A write-down applies from its effective accounting date forward. Earlier snapshots keep
-- the value they were stated at, and acquisition_cost is never rewritten by one: the
-- write-down is carried as its own cumulative column so the original cost and the
-- adjustment are both visible.
--
-- NO FUTURE-OUTCOME LEAKAGE
-- -------------------------
-- Nothing on this row may depend on what eventually happened to the unit.
-- control_account_category comes from the vehicle's condition, the write-down from days in
-- stock, the floorplan state from the acquisition source -- all knowable ON the accounting
-- date. None consults the sale. The carrying SPAN is bounded by the disposition date
-- exactly as fact_vehicle_inventory_snapshot bounds it, because that is the population
-- rather than a classification.
--
-- MEASURE ADDITIVITY
--   Additive at one accounting date, across vehicles / stores / categories:
--     acquisition_cost, capitalized_*, other_capitalized_costs, write_down_amount,
--     current_book_value, floorplan_principal.
--   Semi-additive across accounting dates: use the last applicable date, never a sum.
--   Never additive: days_in_stock (an age, not a quantity).
--
-- PRIVACY: no personal data of any kind. The unit is a surrogate key into
-- warehouse.dim_vehicle, which holds a synthetic identifier and a synthetic VIN. There is
-- no customer reference, no employee reference, no free-text note and no monetary field
-- attributable to a person.

CREATE TABLE IF NOT EXISTS warehouse.fact_inventory_accounting_snapshot (
    inventory_accounting_key    bigint         NOT NULL,
    accounting_date_key         integer        NOT NULL,
    dealership_key              integer        NOT NULL,
    vehicle_key                 integer        NOT NULL,
    gl_account_key              integer        NOT NULL,
    acquisition_date_key        integer        NOT NULL,
    control_account_category    varchar(40)    NOT NULL,
    acquisition_cost            numeric(14,2)  NOT NULL,
    capitalized_transportation  numeric(14,2)  NOT NULL,
    capitalized_reconditioning  numeric(14,2)  NOT NULL,
    capitalized_accessories     numeric(14,2)  NOT NULL,
    other_capitalized_costs     numeric(14,2)  NOT NULL,
    write_down_amount           numeric(14,2)  NOT NULL,
    current_book_value          numeric(14,2)  NOT NULL,
    floorplan_principal         numeric(14,2)  NOT NULL,
    days_in_stock               integer        NOT NULL,
    source_system               varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_inventory_accounting_snapshot
        PRIMARY KEY (inventory_accounting_key),
    -- THE declared grain, enforced. Three NOT NULL columns, so PostgreSQL's
    -- NULL-distinctness rule cannot let a duplicate logical row through. A second row
    -- for one unit on one date would count its book value twice in the control balance
    -- and manufacture a variance that is not there.
    CONSTRAINT uq_fact_inventory_accounting_snapshot_grain
        UNIQUE (accounting_date_key, dealership_key, vehicle_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_inventory_accounting_key_positive
        CHECK (inventory_accounting_key > 0),
    CONSTRAINT ck_fact_inventory_accounting_category_domain
        CHECK (control_account_category IN (
            'New Vehicle Inventory',
            'Used Vehicle Inventory',
            'Certified Vehicle Inventory'
        )),
    CONSTRAINT ck_fact_inventory_accounting_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- THE BOOK-VALUE IDENTITY. Exact equality. Everything the domain claims rests here.
    CONSTRAINT ck_fact_inventory_accounting_book_value_identity
        CHECK (current_book_value = acquisition_cost
                                  + capitalized_transportation
                                  + capitalized_reconditioning
                                  + capitalized_accessories
                                  + other_capitalized_costs
                                  - write_down_amount),
    CONSTRAINT ck_fact_inventory_accounting_components_nonnegative
        CHECK (acquisition_cost >= 0
           AND capitalized_transportation >= 0
           AND capitalized_reconditioning >= 0
           AND capitalized_accessories >= 0
           AND other_capitalized_costs >= 0),
    -- A negative write-down is a write-UP, which this model does not represent.
    CONSTRAINT ck_fact_inventory_accounting_write_down_nonnegative
        CHECK (write_down_amount >= 0),
    -- A negative carrying value would subtract from a control balance.
    CONSTRAINT ck_fact_inventory_accounting_book_value_nonnegative
        CHECK (current_book_value >= 0),
    CONSTRAINT ck_fact_inventory_accounting_floorplan_nonnegative
        CHECK (floorplan_principal >= 0),
    CONSTRAINT ck_fact_inventory_accounting_days_in_stock_nonnegative
        CHECK (days_in_stock >= 0),
    -- A unit cannot be booked before it entered stock. Guards the posting lag from
    -- becoming negative, which would make KPI-ACC-011 meaningless.
    CONSTRAINT ck_fact_inventory_accounting_acquired_before_booked
        CHECK (acquisition_date_key <= accounting_date_key)
);

-- Foreign keys, added guarded so the file is safe to rerun.
DO $fk_fact_inventory_accounting$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fact_inventory_accounting_date'
    ) THEN
        ALTER TABLE warehouse.fact_inventory_accounting_snapshot
            ADD CONSTRAINT fk_fact_inventory_accounting_date
            FOREIGN KEY (accounting_date_key)
            REFERENCES warehouse.dim_date (date_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fact_inventory_accounting_acquisition_date'
    ) THEN
        ALTER TABLE warehouse.fact_inventory_accounting_snapshot
            ADD CONSTRAINT fk_fact_inventory_accounting_acquisition_date
            FOREIGN KEY (acquisition_date_key)
            REFERENCES warehouse.dim_date (date_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fact_inventory_accounting_dealership'
    ) THEN
        ALTER TABLE warehouse.fact_inventory_accounting_snapshot
            ADD CONSTRAINT fk_fact_inventory_accounting_dealership
            FOREIGN KEY (dealership_key)
            REFERENCES warehouse.dim_dealership (dealership_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fact_inventory_accounting_vehicle'
    ) THEN
        ALTER TABLE warehouse.fact_inventory_accounting_snapshot
            ADD CONSTRAINT fk_fact_inventory_accounting_vehicle
            FOREIGN KEY (vehicle_key)
            REFERENCES warehouse.dim_vehicle (vehicle_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fact_inventory_accounting_gl_account'
    ) THEN
        ALTER TABLE warehouse.fact_inventory_accounting_snapshot
            ADD CONSTRAINT fk_fact_inventory_accounting_gl_account
            FOREIGN KEY (gl_account_key)
            REFERENCES warehouse.dim_gl_account (gl_account_key) ON DELETE RESTRICT;
    END IF;
END
$fk_fact_inventory_accounting$;

CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_date_store
    ON warehouse.fact_inventory_accounting_snapshot (accounting_date_key, dealership_key);

CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_account
    ON warehouse.fact_inventory_accounting_snapshot (gl_account_key, accounting_date_key);

CREATE INDEX IF NOT EXISTS ix_fact_inventory_accounting_vehicle
    ON warehouse.fact_inventory_accounting_snapshot (vehicle_key, accounting_date_key);

COMMENT ON TABLE warehouse.fact_inventory_accounting_snapshot IS
    'Grain: one row per vehicle per dealership per accounting snapshot date, while the vehicle is
carried. The stock-level accounting schedule -- a FOCUSED INVENTORY CONTROL SCHEDULE, never a general
ledger: no journal, no posting, no trial balance, no financial statement. Accounting dates are
month-ends, a subset of the inventory calendar, so a schedule and an operational snapshot are always
comparable at a matched date. current_book_value equals its declared components EXACTLY, enforced by
ck_fact_inventory_accounting_book_value_identity; pack is deliberately absent (it is a front-gross
deduction, not a capitalized cost) and floorplan_principal is a LIABILITY that never enters the
identity. SEMI-ADDITIVE: additive across vehicles, stores and categories at ONE date, never summed
across dates -- a period-ending balance is the last applicable snapshot, not a sum. Snapshot history is
never rewritten: a write-down applies from its effective date forward and never restates an earlier
row or the acquisition cost. All values synthetic; no personal data of any kind. Promoted by DASH.8.';

COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.inventory_accounting_key IS 'Surrogate key. Assigned deterministically by the load from the natural key ordering, so rebuilding from the same CSVs reproduces identical keys.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.accounting_date_key IS 'Month-end the position is stated as at. Part of the declared grain. A business date from the synthetic dataset, never a wall clock.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.dealership_key IS 'Store carrying the unit. Part of the declared grain. Resolved as the store stood on the accounting date.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.vehicle_key IS 'The carried unit. Part of the declared grain. A synthetic vehicle; ARPI models no dealership stock number and this column is not one.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.gl_account_key IS 'The inventory control account this unit is scheduled to, resolved from control_account_category. One unit resolves to exactly one control account and can never appear in two control balances.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.acquisition_date_key IS 'Date the store took the unit into stock. With accounting_date_key this is the only supportable posting-lag pair in the model (KPI-ACC-011); the F&I domain has no separate posting date, so no F&I posting lag exists to compute.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.control_account_category IS 'New, Used or Certified Vehicle Inventory, derived from the vehicle condition and knowable ON the accounting date. Wholesale Inventory is deliberately NOT a category: nothing distinguishes a unit held for wholesale at a snapshot date except how it eventually left, and classifying inventory by its eventual disposal is future-outcome leakage.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.acquisition_cost IS 'What the store paid. The acquisition event''s own figure, to the cent -- the accounting schedule does not invent a second acquisition cost.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.capitalized_transportation IS 'Inbound freight capitalized into the unit. 0.00 where the unit was driven in (customer trade, off-street purchase, lease return); a modelled zero, not an absence.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.capitalized_reconditioning IS 'Reconditioning capitalized into the unit. The acquisition event''s own reconditioning spend, shared rather than redrawn.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.capitalized_accessories IS 'Accessories fitted and capitalized. 0.00 on the majority that carry none.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.other_capitalized_costs IS 'Other capitalized cost. Populated only by the certification inspection on a certified unit, which is why Certified is its own control account rather than a label on a used car.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.write_down_amount IS 'Cumulative synthetic accounting write-down as at this date. A SYNTHETIC ACCOUNTING ADJUSTMENT against an aged unit -- never a market-value estimate, and nothing in this project supports calling it one. It reduces book value and never rewrites acquisition cost or an earlier snapshot.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.current_book_value IS 'The carrying value. Equals acquisition + transportation + reconditioning + accessories + other - write-down, EXACTLY, enforced by CHECK. Semi-additive: sum across units at one date, never across dates.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.floorplan_principal IS 'Principal owed against the unit. A LIABILITY POSITION: never added to, subtracted from or netted against book value, and never part of KPI-ACC-001. 0.00 is an owned, unfloored unit and never missing data. After a write-down a unit may owe more than it is carried at, which is precisely why the two are not netted. No rate, interest, curtailment or maturity is modelled.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.days_in_stock IS 'Accounting date less acquisition date. An age, never a quantity: not additive under any aggregation.';
COMMENT ON COLUMN warehouse.fact_inventory_accounting_snapshot.source_system IS 'Originating system; constant SYNTHETIC-DMS-ACCOUNTING.';
