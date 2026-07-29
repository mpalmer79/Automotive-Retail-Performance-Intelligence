-- =============================================================================
-- File:            sql/04_facts/04_fact_marketing_spend.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_marketing_spend, the monthly marketing spend periodic-snapshot fact.
-- Execution order: 51 of 66 — after every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per dealership per campaign per calendar month.
-- =============================================================================
--
-- Column contract: ARPI Phase 1 cross-agent contract section 7 — 12 columns, exact
-- names, exact order, exact types. Mapping document: STM-014 (Agent H).
--
-- STATUS
-- ------
-- The table exists, is constrained, and is loaded by sql/04_facts/14_fact_marketing_spend_load.sql on every
-- pipeline run. Its grain is enforced by a UNIQUE constraint, and
-- tests/integration/test_gate1_readiness.py asserts both that the constraint covers
-- exactly the declared grain columns and that the loaded data satisfies it. The
-- staging-to-warehouse count is reconciled on every run by audit.vw_recon_ingestion,
-- so a load that silently dropped rows on an unresolved surrogate key fails rather
-- than passing quietly. warehouse.fact_marketing_spend is projected for reporting without
-- aggregation or filtering; see sql/05_reporting/.
--
-- THE MONTH KEY IS THE FIRST OF THE MONTH
-- ---------------------------------------
-- month_date_key is a normal dim_date key of the form YYYYMM01, not a YYYYMM
-- integer. Conforming to dim_date rather than inventing a parallel month key means a
-- spend report and a sales report join to the same calendar, so "this month" means
-- the same thing in both. The load script must resolve the first day of the month; a
-- key pointing at any other day of the month is a defect, and DQ-MKT-* checks it.
--
-- VENDOR-REPORTED LEADS DELIBERATELY DISAGREE WITH THE CRM
-- --------------------------------------------------------
-- vendor_reported_leads is what the vendor invoices against. It does not equal the
-- count of rows in warehouse.fact_lead for the same campaign and month, and it is
-- not supposed to: vendors count differently, deduplicate differently, and are paid
-- on their own number. The gap between the two is a genuine analytic question this
-- warehouse exists to answer, so both are stored and neither is reconciled away.
--
-- MEASURE ADDITIVITY
-- ------------------
--   Additive across store, campaign and month: spend_amount, impressions, clicks,
--     calls, form_submissions, vendor_reported_leads.
--   Cost per lead, cost per sale and every other efficiency ratio are NON-ADDITIVE
--     and must be computed as a ratio of two sums, never as an average of ratios.
--
-- PRIVACY: no personal data. vendor_name in dim_marketing_campaign is fictional and
-- names a business, never a person.

CREATE TABLE IF NOT EXISTS warehouse.fact_marketing_spend (
    marketing_spend_key    bigint         NOT NULL,
    month_date_key         integer        NOT NULL,
    dealership_key         integer        NOT NULL,
    campaign_key           integer        NOT NULL,
    lead_source_key        integer        NOT NULL,
    spend_amount           numeric(12,2)  NOT NULL,
    impressions            bigint         NOT NULL,
    clicks                 bigint         NOT NULL,
    calls                  integer        NOT NULL,
    form_submissions       integer        NOT NULL,
    vendor_reported_leads  integer        NOT NULL,
    source_system          varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_marketing_spend
        PRIMARY KEY (marketing_spend_key),
    -- THE declared grain, enforced.
    CONSTRAINT uq_fact_marketing_spend_grain
        UNIQUE (month_date_key, dealership_key, campaign_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_marketing_spend_key_positive
        CHECK (marketing_spend_key > 0),
    CONSTRAINT ck_fact_marketing_spend_amount_nonnegative
        CHECK (spend_amount >= 0),
    CONSTRAINT ck_fact_marketing_spend_impressions_nonnegative
        CHECK (impressions >= 0),
    CONSTRAINT ck_fact_marketing_spend_clicks_nonnegative
        CHECK (clicks >= 0),
    CONSTRAINT ck_fact_marketing_spend_calls_nonnegative
        CHECK (calls >= 0),
    CONSTRAINT ck_fact_marketing_spend_form_submissions_nonnegative
        CHECK (form_submissions >= 0),
    CONSTRAINT ck_fact_marketing_spend_vendor_reported_leads_nonnegative
        CHECK (vendor_reported_leads >= 0),
    CONSTRAINT ck_fact_marketing_spend_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- month_date_key must address the FIRST day of a month: YYYYMM01.
    CONSTRAINT ck_fact_marketing_spend_month_key_is_first_of_month
        CHECK (month_date_key % 100 = 1)
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_marketing_spend_month',       'month_date_key',  'dim_date',               'date_key'),
            ('fk_fact_marketing_spend_dealership',  'dealership_key',  'dim_dealership',         'dealership_key'),
            ('fk_fact_marketing_spend_campaign',    'campaign_key',    'dim_marketing_campaign', 'campaign_key'),
            ('fk_fact_marketing_spend_lead_source', 'lead_source_key', 'dim_lead_source',        'lead_source_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_marketing_spend ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_marketing_spend IS
    'Grain: one row per dealership per campaign per calendar month, enforced by '
    'uq_fact_marketing_spend_grain. Periodic snapshot fact. vendor_reported_leads intentionally differs '
    'from the CRM lead count for the same campaign and month; the difference is an analytic finding, not a '
    'defect to reconcile away. Currently EMPTY: the generator and load script are Phase 1.5 work owned by '
    'Agent H.';

COMMENT ON COLUMN warehouse.fact_marketing_spend.marketing_spend_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by (month_date_key, dealership_key, campaign_key).';
COMMENT ON COLUMN warehouse.fact_marketing_spend.month_date_key IS 'Foreign key to warehouse.dim_date, always the FIRST day of the spend month (YYYYMM01). Conforms to the shared calendar so spend and sales agree on what a month is.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store the spend belongs to. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.campaign_key IS 'Foreign key to warehouse.dim_marketing_campaign. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.lead_source_key IS 'Foreign key to warehouse.dim_lead_source: the source the campaign attributes leads to.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.spend_amount IS 'Money spent in the month, exact to the cent. Additive.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.impressions IS 'Vendor-reported impressions. Additive. bigint because a display campaign exceeds the integer range.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.clicks IS 'Vendor-reported clicks. Additive.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.calls IS 'Vendor-reported inbound calls. Additive.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.form_submissions IS 'Vendor-reported form submissions. Additive.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.vendor_reported_leads IS 'Leads the vendor claims and invoices against. Deliberately NOT equal to the CRM lead count; both are kept so the gap can be measured. Additive.';
COMMENT ON COLUMN warehouse.fact_marketing_spend.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
