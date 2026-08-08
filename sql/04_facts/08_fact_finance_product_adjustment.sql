-- =============================================================================
-- File:            sql/04_facts/08_fact_finance_product_adjustment.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_finance_product_adjustment, the F&I post-sale event fact.
-- Execution order: After warehouse.fact_finance_product_sale and every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per product adjustment event.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-020-fact-finance-product-adjustment.md.
-- Delivery increment: DASH.6.
--
-- THE ORIGINAL CONTRACT IS NEVER REWRITTEN. THAT IS THE WHOLE DESIGN.
-- --------------------------------------------------------------------
-- A cancellation, a chargeback, a reinstatement or an approved adjustment is an EVENT
-- with its own business date. The warehouse.fact_finance_product_sale row it acts on
-- keeps the gross it was written with, forever. Restating that row instead would be
-- wrong twice over: it would move production out of the month it happened in, so every
-- historical month would change whenever a later event posted; and it would destroy the
-- distinction between what the F&I office PRODUCED and what the store RETAINED, which is
-- the distinction this whole domain exists to make.
--
-- THREE DATE BASES, NEVER BLENDED SILENTLY
-- ----------------------------------------
--   1. DEAL-DATE GROSS        original_product_gross by the parent deal's sale date
--   2. AS-OF NET GROSS        original minus cumulative adjustments through a stated date
--   3. ADJUSTMENT-PERIOD IMPACT   these rows, grouped by adjustment_date_key
-- Every reporting view and every KPI names which of the three it is on. KPI-FNI-014,
-- -015 and -018 are deliberately MIXED-BASIS period proxies and say so in their own
-- catalogue entries; they are not cohort loss rates and must never be presented as one.
--
-- THE SIGN CONVENTION
-- -------------------
--     net_product_gross_as_of = original_product_gross
--                             - SUM(adjustment_amount WHERE adjustment_date <= as_of)
-- A POSITIVE amount REDUCES retained gross; a NEGATIVE one restores it. Cancellation and
-- Chargeback are constrained positive; Reinstatement negative; Approved Adjustment is
-- signed and carries a governed reason category that says which way it went.
--
-- WHAT A CHECK CONSTRAINT CANNOT DO HERE
-- --------------------------------------
-- Three rules span rows or tables and are therefore NOT constraints: the cumulative cap
-- (net reduction inside [0, original gross] after every event), the reinstatement's need
-- for a prior reduction, and "no adjustment predates its contract". They are DQ-FPA-004,
-- DQ-FPA-007 and DQ-FPA-008 in Python, and RECON-FI-ADJUSTMENT-CAP and
-- RECON-FI-ADJUSTMENT-SEQUENCE in SQL. Stating that plainly is better than a trigger,
-- which would be a hidden second write path.
--
-- MEASURE ADDITIVITY
--   Additive across every dimension WITHIN the adjustment-date basis: adjustment_amount,
--     adjustment_count (as count(*) over rows, or SUM of 1).
--   NEVER additive across date bases: an adjustment-period total and a deal-date total
--     describe different populations and summing them is meaningless.
--
-- PRIVACY: no customer data, and no free-text field. adjustment_reason_category is a
-- closed vocabulary because a free-text reason is where somebody eventually writes
-- something about a customer.

CREATE TABLE IF NOT EXISTS warehouse.fact_finance_product_adjustment (
    adjustment_key              bigint         NOT NULL,
    adjustment_id               varchar(16)    NOT NULL,
    product_sale_key            bigint         NOT NULL,
    sale_key                    bigint         NOT NULL,
    adjustment_date_key         integer        NOT NULL,
    dealership_key              integer        NOT NULL,
    finance_manager_key         integer        NULL,
    finance_product_key         integer        NOT NULL,
    adjustment_type             varchar(24)    NOT NULL,
    adjustment_amount           numeric(12,2)  NOT NULL,
    adjustment_reason_category  varchar(40)    NOT NULL,
    sequence_ordinal            smallint       NOT NULL,
    source_system               varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_finance_product_adjustment
        PRIMARY KEY (adjustment_key),
    -- THE declared grain: one row per adjustment event, identified by its own business
    -- identifier. A contract may legitimately carry several events, and two events may
    -- legitimately share a date, so the grain is the event and nothing narrower.
    CONSTRAINT uq_fact_finance_product_adjustment_adjustment_id
        UNIQUE (adjustment_id),
    -- One contract's event sequence is ordered, and the ordinal is part of what makes
    -- "a reinstatement follows a reduction" checkable. Two events at one position would
    -- make the sequence ambiguous.
    CONSTRAINT uq_fact_finance_product_adjustment_sequence
        UNIQUE (product_sale_key, sequence_ordinal),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_fi_adjustment_key_positive
        CHECK (adjustment_key > 0),
    CONSTRAINT ck_fact_fi_adjustment_id_not_blank
        CHECK (btrim(adjustment_id) <> ''),
    CONSTRAINT ck_fact_fi_adjustment_type_domain
        CHECK (adjustment_type IN
            ('Cancellation', 'Chargeback', 'Reinstatement', 'Approved Adjustment')),
    CONSTRAINT ck_fact_fi_adjustment_sequence_ordinal_positive
        CHECK (sequence_ordinal >= 1),
    CONSTRAINT ck_fact_fi_adjustment_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- THE SIGN CONVENTION, enforced per type. Approved Adjustment is legitimately
    -- signed and is constrained only to be an event at all: a zero-amount adjustment is
    -- not an adjustment.
    CONSTRAINT ck_fact_fi_adjustment_sign_convention
        CHECK (
            (adjustment_type IN ('Cancellation', 'Chargeback') AND adjustment_amount > 0)
            OR (adjustment_type = 'Reinstatement' AND adjustment_amount < 0)
            OR (adjustment_type = 'Approved Adjustment' AND adjustment_amount <> 0)
        ),
    -- The reason must belong to its OWN type, not merely to the vocabulary. A
    -- 'Repossession' is a governed reason -- for a Chargeback. Against a Reinstatement
    -- it would be a governed word in a nonsensical place.
    CONSTRAINT ck_fact_fi_adjustment_reason_belongs_to_type
        CHECK (
            (adjustment_type = 'Cancellation'
             AND adjustment_reason_category IN
                 ('Customer Request', 'Vehicle Sold or Traded', 'Total Loss', 'Early Payoff'))
            OR (adjustment_type = 'Chargeback'
             AND adjustment_reason_category IN
                 ('Early Payoff', 'Contract Cancelled', 'Repossession', 'Total Loss'))
            OR (adjustment_type = 'Reinstatement'
             AND adjustment_reason_category IN
                 ('Cancellation Rescinded', 'Administrative Correction'))
            OR (adjustment_type = 'Approved Adjustment'
             AND adjustment_reason_category IN
                 ('Administrative Correction', 'Pricing Correction', 'Remittance Correction'))
        )
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_fi_adjustment_product_sale',    'product_sale_key',    'fact_finance_product_sale', 'product_sale_key'),
            ('fk_fact_fi_adjustment_sale',            'sale_key',            'fact_vehicle_sale',         'sale_key'),
            ('fk_fact_fi_adjustment_date',            'adjustment_date_key', 'dim_date',                  'date_key'),
            ('fk_fact_fi_adjustment_dealership',      'dealership_key',      'dim_dealership',            'dealership_key'),
            ('fk_fact_fi_adjustment_finance_manager', 'finance_manager_key', 'dim_employee',              'employee_key'),
            ('fk_fact_fi_adjustment_product',         'finance_product_key', 'dim_finance_product',       'finance_product_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_finance_product_adjustment ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_finance_product_adjustment IS
    'Grain: ONE ROW PER PRODUCT ADJUSTMENT EVENT -- a Cancellation, Chargeback, Reinstatement or Approved '
    'Adjustment -- enforced by uq_fact_finance_product_adjustment_adjustment_id. EVENT FACT on the '
    'ADJUSTMENT-DATE basis: every row carries its OWN business date and the contract it acts on is NEVER '
    'rewritten. An August chargeback on a June contract belongs to August, and the June contract keeps '
    'June''s gross -- restating it would move production out of the month it happened in and destroy the '
    'distinction between what the F&I office PRODUCED and what the store RETAINED. THE SIGN CONVENTION: '
    'net_product_gross_as_of = original_product_gross - SUM(adjustment_amount WHERE adjustment_date <= '
    'as_of); a POSITIVE amount REDUCES retained gross and a NEGATIVE one restores it. The cumulative cap '
    '(net reduction inside [0, original gross] after EVERY event), the reinstatement''s need for a prior '
    'reduction, and "no adjustment predates its contract" span rows or tables and are therefore '
    'DQ-FPA-004/007/008 and RECON-FI-ADJUSTMENT-CAP / -SEQUENCE rather than CHECK constraints. Timing and '
    'volume are a SYNTHETIC CONFIGURED DISTRIBUTION and are never an observed loss rate; the reporting '
    'window truncates the lag distribution, so recent months carry structurally fewer events. '
    'adjustment_reason_category is a CLOSED vocabulary and there is no free-text field anywhere. Contains '
    'no customer data.';

COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by adjustment_id.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_id IS 'Natural key from the source system, FPA-########. Unique, and the declared grain.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.product_sale_key IS 'Foreign key to warehouse.fact_finance_product_sale: the contract this event acts on. NOT NULL, and enforced by the foreign key rather than hoped for -- AN ORPHANED ADJUSTMENT IS A NUMBER WITH NOTHING TO REDUCE, and it would appear in the adjustment-period total while appearing in no contract''s net gross, so the two reads of the same domain would silently disagree.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.sale_key IS 'Foreign key to warehouse.fact_vehicle_sale: the contract''s parent deal, denormalised so a store-and-period read needs one join fewer. Always the contract''s own deal; DQ-FPA-010 asserts it.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_date_key IS 'Foreign key to warehouse.dim_date: THE EVENT''S OWN BUSINESS DATE. Never the deal date, and never restated into the original sale month. This is the date basis of KPI-FNI-012, -013, -016 and -017, and the numerator basis of the mixed-basis rates KPI-FNI-014, -015 and -018.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store, carried from the contract.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.finance_manager_key IS 'Foreign key to warehouse.dim_employee: the manager credited on the ORIGINAL deal, or NULL where none was. Attribution deliberately follows the CONTRACT rather than whoever processed the cancellation: that person is not modelled, and inventing them would attribute a loss to somebody on no evidence.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.finance_product_key IS 'Foreign key to warehouse.dim_finance_product: the product, carried from the contract. Resolves the category for adjustment-by-category analysis without a second join.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_type IS 'Cancellation, Chargeback, Reinstatement or Approved Adjustment. Decides the sign rule and the permitted reason categories, both enforced by CHECK.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_amount IS 'SIGNED, exact to the cent. Additive WITHIN the adjustment-date basis and never across date bases. POSITIVE REDUCES retained gross; NEGATIVE restores it. A cancellation''s amount is what was taken back, not what remains.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.adjustment_reason_category IS 'A governed reason category belonging to this event''s own type. A CLOSED VOCABULARY and never free text: a free-text reason is where somebody eventually writes something about a customer. Describes what happened to a CONTRACT, never anything about a person.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.sequence_ordinal IS '1-based position within the contract''s own event sequence, ordered by date. NON-ADDITIVE. What makes "a reinstatement follows a reduction" a checkable statement rather than a hope.';
COMMENT ON COLUMN warehouse.fact_finance_product_adjustment.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops a synthetic chargeback distribution being read as an observed loss rate.';
