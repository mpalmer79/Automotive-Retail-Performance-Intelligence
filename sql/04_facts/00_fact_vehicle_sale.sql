-- =============================================================================
-- File:            sql/04_facts/00_fact_vehicle_sale.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_vehicle_sale, the vehicle transaction fact.
-- Execution order: @@ORDER@@ — after every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per finalized vehicle transaction.
-- =============================================================================
--
-- Column contract: ARPI Phase 1 cross-agent contract section 7 — 30 columns, exact
-- names, exact order, exact types. Mapping document:
-- docs/source-to-target/STM-008-fact-vehicle-sale.md.
--
-- STATUS
-- ------
-- The table exists and is constrained; **no row has ever been loaded into it.** The
-- generator (Agent E) and the load script sql/04_facts/10_fact_vehicle_sale_load.sql
-- land in the follow-up increment. Nothing in this repository should be read as
-- claiming sales reporting exists.
--
-- WHAT IS AND IS NOT IN THE GRAIN
-- -------------------------------
--   * One row per finalized deal. Cancelled and unwound deals never appear: a deal
--     that did not complete is not a sale, and counting one would overstate every
--     volume and gross measure downstream.
--   * unit_count is always 1. It exists so that "units sold" is an additive measure
--     summed like any other, rather than a count(*) that breaks the moment a filter
--     or a join fan-out changes.
--   * Manufacturer incentives, holdback and floorplan credits are EXCLUDED from
--     every gross measure. They arrive on a different cadence than the deal, are
--     not attributable to a single vehicle at the time of sale, and including them
--     would make front_end_gross disagree with the deal jacket a manager reads.
--     The exclusion is deliberate and is documented in STM-008 section 10.
--
-- ARITHMETIC IDENTITIES ARE ENFORCED, NOT DOCUMENTED
-- --------------------------------------------------
-- front_end_gross and total_gross are stored rather than computed on read, because
-- Power BI and Excel both consume them directly. A stored derived measure that can
-- silently disagree with its inputs is the most common way a dashboard lies, so both
-- identities are CHECK constraints. The same applies to is_retail, which is a pure
-- function of sale_type and is never assigned independently.
--
-- MEASURE ADDITIVITY
-- ------------------
--   Additive across every dimension: unit_count, sale_price, front_end_gross,
--     back_end_gross, total_gross, trade_allowance, trade_acv, cash_down,
--     amount_financed, acquisition_cost, reconditioning_cost, pack_amount.
--   Non-additive: days_in_inventory_at_sale (average it, never sum it), msrp,
--     original_asking_price, final_asking_price (prices are attributes of a vehicle,
--     not quantities of money that accumulate).
--
-- PRIVACY: no customer or employee personal data. Every reference to a person is a
-- surrogate key into a dimension that holds none.

CREATE TABLE IF NOT EXISTS warehouse.fact_vehicle_sale (
    sale_key                    bigint         NOT NULL,
    sale_id                     varchar(16)    NOT NULL,
    sale_date_key               integer        NOT NULL,
    delivery_date_key           integer        NOT NULL,
    dealership_key              integer        NOT NULL,
    vehicle_key                 integer        NOT NULL,
    customer_key                integer        NULL,
    salesperson_key             integer        NULL,
    desk_manager_key            integer        NULL,
    finance_manager_key         integer        NULL,
    lead_source_key             integer        NULL,
    sale_type                   varchar(20)    NOT NULL,
    is_retail                   boolean        NOT NULL,
    unit_count                  smallint       NOT NULL,
    sale_price                  numeric(12,2)  NOT NULL,
    msrp                        numeric(12,2)  NULL,
    original_asking_price       numeric(12,2)  NOT NULL,
    final_asking_price          numeric(12,2)  NOT NULL,
    acquisition_cost            numeric(12,2)  NOT NULL,
    reconditioning_cost         numeric(12,2)  NOT NULL,
    pack_amount                 numeric(12,2)  NOT NULL,
    front_end_gross             numeric(12,2)  NOT NULL,
    back_end_gross              numeric(12,2)  NOT NULL,
    total_gross                 numeric(12,2)  NOT NULL,
    trade_allowance             numeric(12,2)  NOT NULL,
    trade_acv                   numeric(12,2)  NOT NULL,
    cash_down                   numeric(12,2)  NOT NULL,
    amount_financed             numeric(12,2)  NOT NULL,
    days_in_inventory_at_sale   integer        NOT NULL,
    source_system               varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_vehicle_sale
        PRIMARY KEY (sale_key),
    CONSTRAINT uq_fact_vehicle_sale_sale_id
        UNIQUE (sale_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_vehicle_sale_key_positive
        CHECK (sale_key > 0),
    CONSTRAINT ck_fact_vehicle_sale_sale_id_not_blank
        CHECK (btrim(sale_id) <> ''),
    CONSTRAINT ck_fact_vehicle_sale_sale_type_domain
        CHECK (sale_type IN ('New Retail', 'Used Retail', 'Certified Retail',
                             'Lease', 'Wholesale', 'Dealer Trade')),
    CONSTRAINT ck_fact_vehicle_sale_unit_count_is_one
        CHECK (unit_count = 1),
    CONSTRAINT ck_fact_vehicle_sale_days_in_inventory_nonnegative
        CHECK (days_in_inventory_at_sale >= 0),
    CONSTRAINT ck_fact_vehicle_sale_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- is_retail is DERIVED from sale_type and is never assigned independently.
    CONSTRAINT ck_fact_vehicle_sale_is_retail_derivation
        CHECK (is_retail = (sale_type IN ('New Retail', 'Used Retail',
                                          'Certified Retail', 'Lease'))),
    -- A retail deal always has a buyer. A wholesale or dealer-trade deal need not.
    CONSTRAINT ck_fact_vehicle_sale_retail_requires_customer
        CHECK ((is_retail AND customer_key IS NOT NULL) OR NOT is_retail),
    -- A vehicle cannot be delivered before it is sold.
    CONSTRAINT ck_fact_vehicle_sale_delivery_not_before_sale
        CHECK (delivery_date_key >= sale_date_key),
    -- The two stored gross identities.
    CONSTRAINT ck_fact_vehicle_sale_front_end_gross_identity
        CHECK (front_end_gross
               = sale_price - acquisition_cost - reconditioning_cost - pack_amount),
    CONSTRAINT ck_fact_vehicle_sale_total_gross_identity
        CHECK (total_gross = front_end_gross + back_end_gross)
);

-- Conformed-dimension foreign keys. Declared with guarded ALTER TABLE rather than
-- inline, so that this file stays idempotent while still adding a constraint that a
-- database created by an earlier revision does not yet have.
DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_vehicle_sale_sale_date',      'sale_date_key',       'dim_date',       'date_key'),
            ('fk_fact_vehicle_sale_delivery_date',  'delivery_date_key',   'dim_date',       'date_key'),
            ('fk_fact_vehicle_sale_dealership',     'dealership_key',      'dim_dealership', 'dealership_key'),
            ('fk_fact_vehicle_sale_vehicle',        'vehicle_key',         'dim_vehicle',    'vehicle_key'),
            ('fk_fact_vehicle_sale_customer',       'customer_key',        'dim_customer',   'customer_key'),
            ('fk_fact_vehicle_sale_salesperson',    'salesperson_key',     'dim_employee',   'employee_key'),
            ('fk_fact_vehicle_sale_desk_manager',   'desk_manager_key',    'dim_employee',   'employee_key'),
            ('fk_fact_vehicle_sale_finance_manager','finance_manager_key', 'dim_employee',   'employee_key'),
            ('fk_fact_vehicle_sale_lead_source',    'lead_source_key',     'dim_lead_source','lead_source_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_vehicle_sale ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_vehicle_sale IS
    'Grain: one row per finalized vehicle transaction. Transaction fact. Cancelled and unwound deals are '
    'never present. Manufacturer incentives, holdback and floorplan credits are excluded from every gross '
    'measure by design (see docs/source-to-target/STM-008-fact-vehicle-sale.md). Currently EMPTY: the '
    'generator and load script arrive in a later Phase 1.2 increment.';

COMMENT ON COLUMN warehouse.fact_vehicle_sale.sale_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by sale_id.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.sale_id IS 'Natural key from the source system, SLE-########. Unique.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.sale_date_key IS 'Foreign key to warehouse.dim_date: the date the deal was finalized.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.delivery_date_key IS 'Foreign key to warehouse.dim_date: the date the vehicle was delivered. Never before sale_date_key.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.dealership_key IS 'Foreign key to warehouse.dim_dealership: the selling store.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.vehicle_key IS 'Foreign key to warehouse.dim_vehicle: the vehicle sold.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.customer_key IS 'Foreign key to warehouse.dim_customer. NULL means the deal had no retail buyer (wholesale or dealer trade); it never means "buyer unknown".';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.salesperson_key IS 'Foreign key to warehouse.dim_employee. NULL means no salesperson was credited on the deal.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.desk_manager_key IS 'Foreign key to warehouse.dim_employee. NULL means no desk manager was credited.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.finance_manager_key IS 'Foreign key to warehouse.dim_employee. NULL means no finance manager was credited.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.lead_source_key IS 'Foreign key to warehouse.dim_lead_source. NULL means the deal is not yet attributed; attribution is populated in P1.4.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.sale_type IS 'New Retail | Used Retail | Certified Retail | Lease | Wholesale | Dealer Trade. Determines is_retail.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.is_retail IS 'Derived from sale_type by ck_fact_vehicle_sale_is_retail_derivation. Stored because every report filters on it; never assigned independently.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.unit_count IS 'Always 1. Additive. Exists so units sold is a summable measure rather than a count(*) that a join fan-out can inflate.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.sale_price IS 'Selling price of the vehicle, exact to the cent. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.msrp IS 'Manufacturer suggested retail price. NULL means the vehicle has no MSRP (typically a used unit). Non-additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.original_asking_price IS 'First advertised asking price. Non-additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.final_asking_price IS 'Advertised asking price at the moment of sale. Non-additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.acquisition_cost IS 'What the store paid for the vehicle. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.reconditioning_cost IS 'Reconditioning spend on the vehicle before sale. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.pack_amount IS 'Internal pack withheld from front-end gross. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.front_end_gross IS 'sale_price - acquisition_cost - reconditioning_cost - pack_amount, enforced by ck_fact_vehicle_sale_front_end_gross_identity. Additive. Excludes manufacturer incentives.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.back_end_gross IS 'Finance and insurance gross on the deal. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.total_gross IS 'front_end_gross + back_end_gross, enforced by ck_fact_vehicle_sale_total_gross_identity. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.trade_allowance IS 'Allowance credited to the customer for a trade-in. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.trade_acv IS 'Actual cash value the store assigned to the trade-in. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.cash_down IS 'Cash the customer put down. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.amount_financed IS 'Amount financed on the deal. Additive.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.days_in_inventory_at_sale IS 'Days the vehicle had been in stock when it sold. NON-ADDITIVE: average it, never sum it.';
COMMENT ON COLUMN warehouse.fact_vehicle_sale.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
