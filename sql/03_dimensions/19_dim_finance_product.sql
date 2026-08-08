-- =============================================================================
-- File:            sql/03_dimensions/19_dim_finance_product.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_finance_product, the governed F&I product catalogue.
-- Execution order: Dimension layer, after the conformed dimensions, before sql/03_dimensions/21_dim_finance_product_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per finance product definition.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-017-dim-finance-product.md.
-- Delivery increment: DASH.6, authorized by ADR-0013 and DASHBOARD_PROGRAM.md section 9.
--
-- EVERY PRODUCT AND EVERY ADMINISTRATOR IS FICTIONAL
-- --------------------------------------------------
-- No real F&I product, program, administrator, underwriter or vendor is named here, and
-- none may be added. The catalogue attaches invented economics and invented cancellation
-- behaviour to every row, and attaching those to a real company's name would be a
-- fabricated claim about that company. DQ-FPD-004 closes the provider set.
--
-- CATEGORIES ARE ROWS, NEVER COLUMNS
-- ----------------------------------
-- product_category takes one of ten governed values. There is no vsc_gross column and
-- there never will be: a category-per-column model makes the eleventh category a
-- migration instead of a catalogue row, and it cannot answer "which categories exist?"
-- without reading the schema. "Extended warranty" is a permitted USER-FACING ALIAS for
-- Vehicle Service Contract and is never a stored value.
--
-- THE PROVIDER DECISION (DASH.6-01): AN ATTRIBUTE, NOT A DIMENSION
-- ----------------------------------------------------------------
-- provider_name is a column here rather than a foreign key into
-- warehouse.dim_finance_product_provider, which remains Deferred along with STM-021. In
-- this model a provider has no behaviour independent of the product it administers:
-- cancellation and chargeback sensitivity belong to the product, the provider mix IS the
-- product mix, and no fact needs a provider key that finance_product_key does not
-- already resolve. A dimension would add a join, a merge script, an STM and a DQ family
-- in exchange for an attribute lookup. Promoting it later needs no change to any fact.
--
-- SCD POLICY: TYPE 1 (ADR-0006)
-- ------------------------------
-- A corrected product name or a repriced cost ratio is a CORRECTION, not a new version
-- of the product. There is no effective_date, no expiration_date, no is_current and no
-- attribute_hash, and DQ-FPD-010 asserts their absence -- a consumer that filtered on
-- is_current would silently lose every row. active_start_date / active_end_date are a
-- different thing entirely: they record when the product was OFFERED, which is an
-- attribute of the product rather than a version of the row.
--
-- ELIGIBILITY HAS ONE AUTHORITY AND IT IS NOT THIS TABLE
-- ------------------------------------------------------
-- config/reference/fi_product_eligibility.yaml is the authority. eligibility_rule_id is
-- STAMPED from it, and eligible_finance_structures / eligible_vehicle_conditions are
-- DERIVED from it as descriptive metadata for a consumer that wants to render "which
-- deals could carry this?" without loading the configuration. Because they are derived
-- they cannot disagree with it, and DQ-FPD-006 proves they do not.
--
-- WHAT IS DELIBERATELY ABSENT: no price, no cost, no rate, no commission, no remittance
-- schedule, no reserve formula. A price here would be a second authority beside the price
-- actually struck on the contract, and the day they disagreed nobody could say which was
-- the sale.
--
-- PRIVACY: no personal data of any kind. A product row describes a product.

CREATE TABLE IF NOT EXISTS warehouse.dim_finance_product (
    finance_product_key          integer       NOT NULL,
    finance_product_id           varchar(16)   NOT NULL,
    product_name                 varchar(80)   NOT NULL,
    product_category             varchar(40)   NOT NULL,
    provider_name                varchar(60)   NOT NULL,
    eligibility_rule_id          varchar(16)   NOT NULL,
    eligible_finance_structures  varchar(60)   NOT NULL,
    eligible_vehicle_conditions  varchar(40)   NOT NULL,
    default_contract_term_months smallint      NOT NULL,
    cancellation_sensitive       boolean       NOT NULL,
    chargeback_sensitive         boolean       NOT NULL,
    active_start_date            date          NOT NULL,
    active_end_date              date          NOT NULL,
    is_active                    boolean       NOT NULL,
    source_system                varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_finance_product
        PRIMARY KEY (finance_product_key),
    CONSTRAINT uq_dim_finance_product_finance_product_id
        UNIQUE (finance_product_id),
    -- Two products may not share a name: the name is what a reader identifies a
    -- contract by, and two identical names make a category mix unreadable.
    CONSTRAINT uq_dim_finance_product_product_name
        UNIQUE (product_name),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_finance_product_key_positive
        CHECK (finance_product_key > 0),
    CONSTRAINT ck_dim_finance_product_id_not_blank
        CHECK (btrim(finance_product_id) <> ''),
    -- The ten governed categories, verbatim from arpi.constants.
    CONSTRAINT ck_dim_finance_product_category_domain
        CHECK (product_category IN (
            'Vehicle Service Contract', 'GAP', 'Tire & Wheel', 'Prepaid Maintenance',
            'Appearance Protection', 'Key Replacement', 'Theft or Security Product',
            'Paintless Dent Protection', 'Lease Wear Protection',
            'Other Aftermarket Product')),
    -- The governed eligibility rule identifiers.
    CONSTRAINT ck_dim_finance_product_eligibility_rule_domain
        CHECK (eligibility_rule_id IN (
            'ELIG-VSC', 'ELIG-GAP', 'ELIG-TW', 'ELIG-PPM', 'ELIG-LWP', 'ELIG-OTH')),
    CONSTRAINT ck_dim_finance_product_provider_not_blank
        CHECK (btrim(provider_name) <> ''),
    CONSTRAINT ck_dim_finance_product_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- The PRODUCT CONTRACT's default term, in months. NOT a loan term: ARPI models
    -- none. The bound is what stops a value that only makes sense as financing.
    CONSTRAINT ck_dim_finance_product_contract_term_range
        CHECK (default_contract_term_months BETWEEN 12 AND 120),
    -- A product withdrawn before it opened cannot have been sold.
    CONSTRAINT ck_dim_finance_product_active_window_ordered
        CHECK (active_end_date >= active_start_date),
    -- is_active is DERIVED from the sentinel end date and is never assigned
    -- independently, for the same reason is_retail is derived from sale_type on the
    -- sale fact: a flag that can contradict its own dates lets a withdrawn product
    -- back into a current menu.
    CONSTRAINT ck_dim_finance_product_is_active_derivation
        CHECK (is_active = (active_end_date = DATE '9999-12-31'))
);

-- The penetration view groups by category and joins the catalogue on every product
-- row; the category is what both reads filter and group on.
CREATE INDEX IF NOT EXISTS ix_dim_finance_product_category
    ON warehouse.dim_finance_product (product_category);

COMMENT ON TABLE warehouse.dim_finance_product IS
    'Grain: one row per finance product definition. SCD TYPE 1 (ADR-0006): a corrected name or ratio is '
    'a correction, not a new version, and the table carries no effective_date, expiration_date, '
    'is_current or attribute_hash -- DQ-FPD-010 asserts their absence. EVERY PRODUCT AND EVERY '
    'ADMINISTRATOR IS FICTIONAL; no real F&I product, program, administrator or vendor is named and '
    'none may be added. CATEGORIES ARE ROWS: product_category takes one of ten governed values and '
    'there is no per-category column anywhere in ARPI. "Extended warranty" is a permitted user-facing '
    'alias for Vehicle Service Contract and never a stored value. PROVIDER IS AN ATTRIBUTE, not a '
    'dimension: warehouse.dim_finance_product_provider and STM-021 remain Deferred (DASH.6-01). '
    'ELIGIBILITY IS NOT DEFINED HERE -- config/reference/fi_product_eligibility.yaml is the one '
    'authority and eligibility_rule_id is stamped from it. Carries NO price, cost, rate, commission or '
    'reserve formula: a price here would be a second authority beside the one struck on the contract. '
    'Loaded exclusively by sql/03_dimensions/21_dim_finance_product_merge.sql. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_finance_product.finance_product_key IS 'Primary key. Warehouse-assigned surrogate key, assigned by the merge as max(key) + row_number() ordered by finance_product_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_finance_product.finance_product_id IS 'Natural key, FP-###. Unique. What every product-sale row resolves through.';
COMMENT ON COLUMN warehouse.dim_finance_product.product_name IS 'Fictional product label such as "Granite Shield Powertrain Plus". Names an INVENTED product of an INVENTED administrator -- never a person, and never a real F&I product or program.';
COMMENT ON COLUMN warehouse.dim_finance_product.product_category IS 'One of the ten governed categories. A ROW VALUE, never a column: the eleventh category is a catalogue row, not a migration.';
COMMENT ON COLUMN warehouse.dim_finance_product.provider_name IS 'Fictional administrator label. AN ATTRIBUTE BY DELIBERATE DECISION (DASH.6-01): a provider has no behaviour in this model independent of the product it administers, so provider analysis joins through the product and no fact carries a provider key.';
COMMENT ON COLUMN warehouse.dim_finance_product.eligibility_rule_id IS 'The ELIG-* rule the product''s category owns, STAMPED from config/reference/fi_product_eligibility.yaml. Every one of the ten categories resolves to exactly one rule -- not zero, and not two. Published by reporting.vw_fi_product_penetration beside every numerator and denominator, so a penetration figure names its own denominator.';
COMMENT ON COLUMN warehouse.dim_finance_product.eligible_finance_structures IS 'Pipe-delimited descriptive metadata DERIVED from the governed rule (for example "Cash | Lease | Retail Finance"). NOT an authority: it cannot disagree with the configuration because it is generated from it, and DQ-FPD-006 proves that.';
COMMENT ON COLUMN warehouse.dim_finance_product.eligible_vehicle_conditions IS 'Pipe-delimited descriptive metadata DERIVED from the governed rule. ELIG-PPM narrows to New and Certified, which is why a store with a heavier used mix has a structurally smaller Prepaid Maintenance denominator.';
COMMENT ON COLUMN warehouse.dim_finance_product.default_contract_term_months IS 'The PRODUCT CONTRACT''s default term: how long the COVERAGE lasts. THIS IS NOT A FINANCE LOAN TERM -- ARPI models no loan term, no APR, no payment and no rate of any kind, and the two must never be conflated.';
COMMENT ON COLUMN warehouse.dim_finance_product.cancellation_sensitive IS 'Whether the contract can be cancelled for a refund. BEHAVIOURAL, not descriptive: the adjustment generator emits no Cancellation against a product where this is false, and DQ-FPA-011 asserts it. A false value means a cancellation on this product is a DEFECT, not an unusual event.';
COMMENT ON COLUMN warehouse.dim_finance_product.chargeback_sensitive IS 'Whether the store''s income is charged back when the contract ends early. Behavioural in the same way: no Chargeback is emitted against a product where this is false.';
COMMENT ON COLUMN warehouse.dim_finance_product.active_start_date IS 'First date the product was offered. An attribute of the product, NOT an SCD Type 2 effective date: this table keeps no row history.';
COMMENT ON COLUMN warehouse.dim_finance_product.active_end_date IS 'Last date offered, or the 9999-12-31 open-ended sentinel for a product still in the menu.';
COMMENT ON COLUMN warehouse.dim_finance_product.is_active IS 'DERIVED from active_end_date by ck_dim_finance_product_is_active_derivation, never assigned independently. Stored because every menu read filters on it.';
COMMENT ON COLUMN warehouse.dim_finance_product.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops an invented catalogue being read as a real dealership''s F&I menu.';
