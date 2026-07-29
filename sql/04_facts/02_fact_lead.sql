-- =============================================================================
-- File:            sql/04_facts/02_fact_lead.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_lead, the CRM lead accumulating-snapshot fact.
-- Execution order: 49 of 66 — after every dimension it references and after fact_vehicle_sale, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per unique CRM lead.
-- =============================================================================
--
-- Column contract: ARPI Phase 1 cross-agent contract section 7 — 19 columns, exact
-- names, exact order, exact types. Mapping document: STM-011 (Agent H).
--
-- STATUS
-- ------
-- The table exists, is constrained, and is loaded by sql/04_facts/12_fact_lead_load.sql on every
-- pipeline run. Its grain is enforced by a UNIQUE constraint, and
-- tests/integration/test_gate1_readiness.py asserts both that the constraint covers
-- exactly the declared grain columns and that the loaded data satisfies it. The
-- staging-to-warehouse count is reconciled on every run by audit.vw_recon_ingestion,
-- so a load that silently dropped rows on an unresolved surrogate key fails rather
-- than passing quietly. warehouse.fact_lead is projected for reporting without
-- aggregation or filtering; see sql/05_reporting/.
--
-- FUNNEL MONOTONICITY IS ENFORCED
-- -------------------------------
-- A lead cannot have shown for an appointment that was never set, and cannot have
-- had an appointment set if nobody ever contacted it. Those are not reporting
-- conventions, they are facts about the world, and a funnel chart built on data that
-- violates them shows a conversion rate above 100%. The CHECK constraints below make
-- the violation impossible to store.
--
-- NULL MEANS NULL
-- ---------------
-- first_response_seconds is NULL when the lead was never responded to, and 0 only
-- when the response was genuinely immediate. Encoding "never" as 0 would silently
-- improve every average response time, which is exactly the metric a dealer group
-- would be trying to manage.
--
-- MEASURE ADDITIVITY
-- ------------------
--   Additive: lead_count.
--   Non-additive: first_response_seconds, days_to_sale (average them, never sum).
--   The boolean funnel flags are counted, not summed; count them with
--   count(*) FILTER (WHERE flag) so the denominator stays visible.
--
-- PRIVACY: no communication content of any kind. There is no message body, no
-- transcript, no call recording and no free-text note column, by design.

CREATE TABLE IF NOT EXISTS warehouse.fact_lead (
    lead_key                bigint       NOT NULL,
    lead_id                 varchar(20)  NOT NULL,
    lead_created_date_key   integer      NOT NULL,
    dealership_key          integer      NOT NULL,
    customer_key            integer      NULL,
    vehicle_model_key       integer      NULL,
    lead_source_key         integer      NOT NULL,
    campaign_key            integer      NULL,
    assigned_employee_key   integer      NULL,
    sale_key                bigint       NULL,
    lead_count              smallint     NOT NULL,
    first_response_seconds  integer      NULL,
    is_contacted            boolean      NOT NULL,
    is_appointment_set      boolean      NOT NULL,
    is_appointment_shown    boolean      NOT NULL,
    is_sold                 boolean      NOT NULL,
    is_duplicate            boolean      NOT NULL,
    original_lead_id        varchar(20)  NULL,
    days_to_sale            integer      NULL,
    source_system           varchar(40)  NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_lead
        PRIMARY KEY (lead_key),
    CONSTRAINT uq_fact_lead_lead_id
        UNIQUE (lead_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_lead_key_positive
        CHECK (lead_key > 0),
    CONSTRAINT ck_fact_lead_lead_id_not_blank
        CHECK (btrim(lead_id) <> ''),
    CONSTRAINT ck_fact_lead_lead_count_is_one
        CHECK (lead_count = 1),
    CONSTRAINT ck_fact_lead_first_response_seconds_nonnegative
        CHECK (first_response_seconds IS NULL OR first_response_seconds >= 0),
    CONSTRAINT ck_fact_lead_days_to_sale_nonnegative
        CHECK (days_to_sale IS NULL OR days_to_sale >= 0),
    CONSTRAINT ck_fact_lead_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_fact_lead_appointment_requires_contact
        CHECK (is_contacted OR NOT is_appointment_set),
    CONSTRAINT ck_fact_lead_shown_requires_appointment
        CHECK (is_appointment_set OR NOT is_appointment_shown),
    CONSTRAINT ck_fact_lead_sold_requires_sale
        CHECK (NOT is_sold OR sale_key IS NOT NULL)
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_lead_created_date', 'lead_created_date_key', 'dim_date',               'date_key'),
            ('fk_fact_lead_dealership',   'dealership_key',        'dim_dealership',         'dealership_key'),
            ('fk_fact_lead_customer',     'customer_key',          'dim_customer',           'customer_key'),
            ('fk_fact_lead_model',        'vehicle_model_key',     'dim_vehicle_model',      'vehicle_model_key'),
            ('fk_fact_lead_lead_source',  'lead_source_key',       'dim_lead_source',        'lead_source_key'),
            ('fk_fact_lead_campaign',     'campaign_key',          'dim_marketing_campaign', 'campaign_key'),
            ('fk_fact_lead_employee',     'assigned_employee_key', 'dim_employee',           'employee_key'),
            ('fk_fact_lead_sale',         'sale_key',              'fact_vehicle_sale',      'sale_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_lead ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_lead IS
    'Grain: one row per unique CRM lead. Accumulating snapshot: the funnel flags and days_to_sale are '
    'updated as the lead progresses. Funnel monotonicity is enforced by CHECK constraints, so a conversion '
    'rate computed from this table can never exceed 100%. Contains no communication content. Currently '
    'EMPTY: the generator and load script are Phase 1.4 work owned by Agent H.';

COMMENT ON COLUMN warehouse.fact_lead.lead_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by lead_id.';
COMMENT ON COLUMN warehouse.fact_lead.lead_id IS 'Natural key from the CRM, LED-#########. Unique.';
COMMENT ON COLUMN warehouse.fact_lead.lead_created_date_key IS 'Foreign key to warehouse.dim_date: the date the lead was created.';
COMMENT ON COLUMN warehouse.fact_lead.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store the lead belongs to.';
COMMENT ON COLUMN warehouse.fact_lead.customer_key IS 'Foreign key to warehouse.dim_customer. NULL means the lead never resolved to a known customer.';
COMMENT ON COLUMN warehouse.fact_lead.vehicle_model_key IS 'Foreign key to warehouse.dim_vehicle_model. NULL means the lead expressed no model of interest.';
COMMENT ON COLUMN warehouse.fact_lead.lead_source_key IS 'Foreign key to warehouse.dim_lead_source: where the lead came from. Required.';
COMMENT ON COLUMN warehouse.fact_lead.campaign_key IS 'Foreign key to warehouse.dim_marketing_campaign. NULL means the lead is not attributed to a campaign.';
COMMENT ON COLUMN warehouse.fact_lead.assigned_employee_key IS 'Foreign key to warehouse.dim_employee. NULL means the lead was never assigned to anybody.';
COMMENT ON COLUMN warehouse.fact_lead.sale_key IS 'Foreign key to warehouse.fact_vehicle_sale. NULL means the lead did not convert. Required when is_sold.';
COMMENT ON COLUMN warehouse.fact_lead.lead_count IS 'Always 1. Additive; the denominator of every lead conversion rate.';
COMMENT ON COLUMN warehouse.fact_lead.first_response_seconds IS 'Seconds from creation to first response. NULL means never responded to; 0 means an immediate response. Never used as a stand-in for missing. NON-ADDITIVE: average it.';
COMMENT ON COLUMN warehouse.fact_lead.is_contacted IS 'Whether anybody made contact with the lead.';
COMMENT ON COLUMN warehouse.fact_lead.is_appointment_set IS 'Whether an appointment was set. Implies is_contacted.';
COMMENT ON COLUMN warehouse.fact_lead.is_appointment_shown IS 'Whether the appointment was kept. Implies is_appointment_set.';
COMMENT ON COLUMN warehouse.fact_lead.is_sold IS 'Whether the lead converted to a sale. Implies sale_key IS NOT NULL.';
COMMENT ON COLUMN warehouse.fact_lead.is_duplicate IS 'Whether this lead duplicates an earlier one. Duplicates are kept, not deleted: the duplication rate is itself a CRM quality measure.';
COMMENT ON COLUMN warehouse.fact_lead.original_lead_id IS 'The lead this one duplicates. NULL when it is not a duplicate.';
COMMENT ON COLUMN warehouse.fact_lead.days_to_sale IS 'Days from lead creation to sale. NULL when the lead never sold. NON-ADDITIVE: average it.';
COMMENT ON COLUMN warehouse.fact_lead.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
