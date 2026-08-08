-- =============================================================================
-- File:            sql/05_reporting/49_vw_inventory_accounting.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_inventory_accounting — the stock-level inventory control schedule, one line per unit per month-end, with every book-value component published separately.
-- Execution order: Reporting layer, after warehouse.fact_inventory_accounting_snapshot and warehouse.dim_gl_account exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per vehicle, per dealership, per accounting date. Identical to the fact's declared grain; no aggregation, no filtering, no row lost.
-- =============================================================================
--
-- Delivery increment: DASH.8. Anchoring question SQ-43.
--
-- WHAT THIS IS: A STOCK SCHEDULE. IT IS NOT A GENERAL LEDGER.
-- -----------------------------------------------------------
-- A controller's inventory schedule lists every unit on the floor with what the store has
-- in it, and totals to the control account. That is exactly what this view is, and the
-- boundary is the whole point: there is no journal entry here, no debit and credit pair,
-- no posting reference, no trial balance and no period-close state, because ARPI builds a
-- focused inventory control schedule and its reconciliation and does not build a general
-- ledger.
--
-- SIX CONCEPTS THAT MUST NEVER MERGE, AND WHERE EACH ONE IS
-- ---------------------------------------------------------
--   INVENTORY BOOK VALUE      current_book_value here. An asset carrying amount.
--   FLOORPLAN PRINCIPAL       floorplan_principal here. A LIABILITY, carried as context.
--   GL CONTROL BALANCE        not here. reporting.vw_inventory_gl_reconciliation.
--   FRONT-END GROSS COST      not here. fact_vehicle_sale, on a different basis entirely.
--   RECONCILIATION VARIANCE   not here. It is a store-account-date measure, not a unit one.
--   DATA-QUALITY EXCEPTION    not here. reporting.vw_accounting_exceptions.
--
-- FLOORPLAN PRINCIPAL IS NEVER NETTED INTO BOOK VALUE
-- ---------------------------------------------------
-- It sits on the same row because a controller reading a stock schedule wants to see what
-- is owed against the unit next to what the unit is carried at. It is a separate column,
-- it is never added to or subtracted from any book figure, and there is deliberately no
-- "net inventory position" column here or anywhere else: that number would net an asset
-- against a liability and mean nothing. floorplan_principal = 0.00 is LEGITIMATE -- an
-- unfloored unit is a real condition, not a missing value.
--
-- THE BOOK-VALUE IDENTITY IS RE-PUBLISHED, NOT RE-DERIVED
-- --------------------------------------------------------
-- current_book_value is passed through from the fact, where
-- ck_fact_inventory_accounting_book_value_identity enforces
--
--     current_book_value = acquisition_cost + capitalized_transportation
--                        + capitalized_reconditioning + capitalized_accessories
--                        + other_capitalized_costs - write_down_amount
--
-- exactly, in numeric, with no tolerance. Recomputing the sum here would produce a column
-- that agrees with itself by construction and could never disagree with a defect.
-- book_value_components_total is published as the SUM so a consumer can compare the two
-- and see the identity hold, which is a different thing from the view asserting it.
--
-- PACK IS NOT HERE, AND THAT IS STRUCTURAL
-- -----------------------------------------
-- Pack is an internal gross-allocation device withheld from front-end gross at the point
-- of SALE. It is not a capitalized cost, it is not part of what the store has in the unit,
-- and it appears in no column of this view. KPI-GRS-001 and the front-gross identity on
-- fact_vehicle_sale are untouched by DASH.8, and RECON-ACC-PACK-EXCLUDED proves it.
--
-- NO FUTURE-OUTCOME LEAKAGE
-- -------------------------
-- Nothing on this row depends on whether, when or for how much the unit eventually sold.
-- The control category comes from the unit's condition, the write-down from age at the
-- accounting date, and the floorplan principal from the unit's own funding -- all knowable
-- on the accounting date and on no later one.
--
-- POSTING LAG, AND WHAT IT HONESTLY MEASURES
-- -------------------------------------------
-- posting_lag_days is accounting_date - acquisition_date: the elapsed days between a unit
-- entering stock and the schedule date on which it is being reported. KPI-ACC-011 is the
-- MEAN of this over units on their FIRST schedule appearance, which
-- is_first_accounting_appearance marks.
--
-- It is NOT a measure of how long a clerk took to post a journal entry. ARPI holds no
-- separate posting timestamp, and manufacturing one would invent an operational fact the
-- synthetic data does not contain. LIMITATIONS.md records this; the column name and this
-- comment are the honest description of the arithmetic actually performed.
--
-- SEMI-ADDITIVITY
-- ---------------
-- Every monetary column here is ADDITIVE across units, stores and accounts AT ONE
-- accounting date, and NEVER additive across dates. Summing two month-ends produces a
-- number that is not a balance. A period-ending subledger balance is the LAST accounting
-- date in the period, never a sum over the period.
--
-- EXPORT BOUNDARY: DASH.8 exports NO browser dataset from this view and adds no console
-- route. src/arpi/dashboard/contract.py is deliberately unchanged.
--
-- PRIVACY: no personal data. A schedule line names a store, a unit and a date.

CREATE OR REPLACE VIEW reporting.vw_inventory_accounting AS
SELECT
    -- Grain ------------------------------------------------------------------
    f.accounting_date_key                            AS accounting_date_key,
    d.full_date                                      AS accounting_date,
    d.month_start_date                               AS accounting_month_start_date,
    d.is_month_end                                   AS is_month_end,
    f.dealership_key                                 AS dealership_key,
    store.dealership_id                              AS dealership_id,
    store.store_name                                 AS store_name,
    f.vehicle_key                                    AS vehicle_key,
    veh.vehicle_id                                   AS vehicle_id,
    veh.synthetic_vin                                AS synthetic_vin,

    -- The control account this line schedules against ------------------------
    f.gl_account_key                                 AS gl_account_key,
    f.control_account_category                       AS control_account_category,
    acct.account_number                              AS gl_account_number,
    acct.account_name                                AS gl_account_name,
    veh.condition_type                               AS condition_type,

    -- Book value, published as components AND as the stored total ------------
    f.acquisition_cost                               AS acquisition_cost,
    f.capitalized_transportation                     AS capitalized_transportation,
    f.capitalized_reconditioning                     AS capitalized_reconditioning,
    f.capitalized_accessories                        AS capitalized_accessories,
    f.other_capitalized_costs                        AS other_capitalized_costs,
    f.write_down_amount                              AS write_down_amount,
    f.current_book_value                             AS current_book_value,
    -- The identity, recomputed HERE ONLY so a consumer can compare it with the stored
    -- column. The stored column is never replaced by this one.
    (f.acquisition_cost
     + f.capitalized_transportation
     + f.capitalized_reconditioning
     + f.capitalized_accessories
     + f.other_capitalized_costs
     - f.write_down_amount)                          AS book_value_components_total,
    (f.write_down_amount > 0.00)                     AS is_written_down,

    -- Liability context. Never netted into anything above. -------------------
    f.floorplan_principal                            AS floorplan_principal,
    (f.floorplan_principal > 0.00)                   AS is_floorplanned,

    -- Age and posting lag ----------------------------------------------------
    f.days_in_stock                                  AS days_in_stock,
    f.acquisition_date_key                           AS acquisition_date_key,
    acq.full_date                                    AS acquisition_date,
    (d.full_date - acq.full_date)                    AS posting_lag_days,
    (f.accounting_date_key = min(f.accounting_date_key) OVER (PARTITION BY f.vehicle_key))
                                                     AS is_first_accounting_appearance,

    -- Denominators, published so a consumer never counts rows ----------------
    1::integer                                       AS stock_unit_count,

    f.source_system                                  AS source_system
FROM warehouse.fact_inventory_accounting_snapshot AS f
JOIN warehouse.dim_date AS d
  ON d.date_key = f.accounting_date_key
JOIN warehouse.dim_date AS acq
  ON acq.date_key = f.acquisition_date_key
JOIN warehouse.dim_dealership AS store
  ON store.dealership_key = f.dealership_key
JOIN warehouse.dim_vehicle AS veh
  ON veh.vehicle_key = f.vehicle_key
JOIN warehouse.dim_gl_account AS acct
  ON acct.gl_account_key = f.gl_account_key;

COMMENT ON VIEW reporting.vw_inventory_accounting IS
    'Grain: one row per vehicle per dealership per accounting date -- the fact''s own grain, no aggregation
and no row lost; RECON-REPORT-ACCOUNTING-ROWS reconciles the count on every run. A STOCK SCHEDULE, not a
general ledger: no journal entry, no debit/credit pair, no posting reference, no trial balance, no period
close. current_book_value is passed through from the fact, where the identity acquisition_cost +
capitalized_transportation + capitalized_reconditioning + capitalized_accessories + other_capitalized_costs
- write_down_amount is enforced exactly in numeric; book_value_components_total re-derives it so the two
can be COMPARED rather than asserted. PACK IS NOT A BOOK COMPONENT and appears nowhere here.
floorplan_principal is a LIABILITY carried as context and is never added to, subtracted from or netted
against any book figure; 0.00 is a legitimate unfloored unit, not a missing value. posting_lag_days is
accounting_date - acquisition_date and is NOT a journal posting delay -- ARPI holds no posting timestamp.
SEMI-ADDITIVE: additive across units, stores and accounts at ONE date, never summed across dates. Owns
KPI-ACC-001 (subledger balance) and KPI-ACC-011 (posting lag). No browser dataset is exported from this
view. All values synthetic; no personal data. Promoted by DASH.8.';

COMMENT ON COLUMN reporting.vw_inventory_accounting.accounting_date_key IS 'The schedule date. Part of the declared grain. A schedule is comparable with a control balance only at the SAME date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.accounting_date IS 'The schedule date as a calendar date. A business date from the synthetic dataset, never a wall clock.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.accounting_month_start_date IS 'First day of the schedule date''s month, for month grouping without a second calendar hop.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.is_month_end IS 'Whether the schedule date is the last date of its month. True on every DASH.8 row: the accounting calendar is deliberately a month-end subset of the inventory calendar.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.dealership_key IS 'Store the unit is scheduled at, resolved by the load as the store stood on the accounting date. Part of the declared grain.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.dealership_id IS 'Store business key.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.store_name IS 'Store name as at the accounting date. Synthetic; no real dealership is named.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.vehicle_key IS 'The unit. Part of the declared grain. One unit appears once per store per accounting date and never twice.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.vehicle_id IS 'Vehicle business key.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.synthetic_vin IS 'Synthetic VIN. INVENTED and check-digit invalid by construction; never a real vehicle.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.gl_account_key IS 'The inventory control account this line totals into. Resolved from the control category, not from an account number in the source.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.control_account_category IS 'New, Used or Certified Vehicle Inventory. Derived from the unit''s condition at acquisition and NEVER from what the unit eventually sold as -- that would be future-outcome leakage. Note this is deliberately NOT the sales grouping, which combines Certified with Used.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.gl_account_number IS 'Synthetic control-account number. INVENTED; never a real dealer group''s account number.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.gl_account_name IS 'Synthetic control-account name.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.condition_type IS 'The unit''s condition. Published so a reader can see the category mapping rather than trust it.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.acquisition_cost IS 'What the store paid for the unit. Additive at one date. A book-value component.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.capitalized_transportation IS 'Transport capitalized into the unit''s carrying amount. Additive at one date. 0.00 where the acquisition source incurs none.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.capitalized_reconditioning IS 'Reconditioning capitalized into the unit''s carrying amount. Additive at one date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.capitalized_accessories IS 'Dealer-installed accessories capitalized into the unit''s carrying amount. Additive at one date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.other_capitalized_costs IS 'Remaining capitalized cost, including certification cost on a certified unit. Additive at one date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.write_down_amount IS 'Carrying-value reduction recognised on the unit, driven by age at the accounting date and never by an eventual sale price. Always >= 0: a negative write-down would be a write-UP, which this model does not represent. SUBTRACTED in the identity.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.current_book_value IS 'THE carrying amount, passed through from the fact where the identity is enforced exactly in numeric. This is the column KPI-ACC-001 sums. Semi-additive: additive across units, stores and accounts at ONE date, never across dates.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.book_value_components_total IS 'The identity recomputed from the components, published SO IT CAN BE COMPARED with current_book_value. It never replaces it: a view that recomputed the total and published only that would agree with itself by construction and could not surface a defect.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.is_written_down IS 'Whether any write-down has been recognised on this line.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.floorplan_principal IS 'Floorplan principal outstanding against the unit. A LIABILITY, carried as context on an asset schedule. NEVER added to, subtracted from or netted against book value, and there is deliberately no net-inventory-position column anywhere in ARPI. 0.00 means genuinely unfloored, not missing.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.is_floorplanned IS 'Whether floorplan principal is outstanding. Distinguishes an unfloored unit from a zero that a reader might otherwise mistake for missing data.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.days_in_stock IS 'Days the unit has been in stock at the accounting date. Drives the write-down rule.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.acquisition_date_key IS 'Date the unit entered stock. Constrained on the fact to be no later than the accounting date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.acquisition_date IS 'Date the unit entered stock, as a calendar date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.posting_lag_days IS 'accounting_date - acquisition_date. NOT a journal posting delay: ARPI holds no posting timestamp and inventing one would manufacture an operational fact the synthetic data does not contain. KPI-ACC-011 is the mean of this over first appearances only.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.is_first_accounting_appearance IS 'Whether this is the earliest accounting date on which the unit appears. KPI-ACC-011''s population: averaging posting lag over every appearance would grow the mean purely because a unit stayed in stock.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.stock_unit_count IS 'Constant 1, published so a consumer sums a column rather than counting rows. Additive at one date.';
COMMENT ON COLUMN reporting.vw_inventory_accounting.source_system IS 'Originating system; constant SYNTHETIC-DMS-ACC.';
