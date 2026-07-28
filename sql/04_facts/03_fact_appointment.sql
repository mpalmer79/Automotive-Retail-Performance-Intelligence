-- =============================================================================
-- File:            sql/04_facts/03_fact_appointment.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_appointment, the showroom appointment accumulating-snapshot fact.
-- Execution order: 50 of 66 — after warehouse.fact_lead, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per scheduled appointment.
-- =============================================================================
--
-- Column contract: ARPI Phase 1 cross-agent contract section 7 — 20 columns, exact
-- names, exact order, exact types. Mapping document: STM-012 (Agent H).
--
-- STATUS
-- ------
-- The table exists and is constrained; **no row has ever been loaded into it.** The
-- generator and load script are Agent H's, in Phase 1.4.
--
-- SHOW LOGIC IS ENFORCED
-- ----------------------
-- A customer who cancelled in advance did not also attend; an appointment that was
-- not attended has no show date and no arrival punctuality; a deal cannot be written
-- up at a visit that never happened. Show rate is the single most manipulated metric
-- in automotive retail BDC reporting, so every one of those rules is a CHECK
-- constraint rather than a convention.
--
-- MEASURE ADDITIVITY
-- ------------------
--   Additive: appointment_count.
--   Non-additive: minutes_early_or_late (a signed value; average it, never sum it,
--     because early and late cancel out into a meaningless zero).
--
-- PRIVACY: no communication content, no customer contact detail, no free-text note.

CREATE TABLE IF NOT EXISTS warehouse.fact_appointment (
    appointment_key          bigint       NOT NULL,
    appointment_id           varchar(20)  NOT NULL,
    created_date_key         integer      NOT NULL,
    scheduled_date_key       integer      NOT NULL,
    show_date_key            integer      NULL,
    dealership_key           integer      NOT NULL,
    lead_key                 bigint       NOT NULL,
    customer_key             integer      NULL,
    salesperson_key          integer      NULL,
    bdc_employee_key         integer      NULL,
    vehicle_model_key        integer      NULL,
    sale_key                 bigint       NULL,
    appointment_count        smallint     NOT NULL,
    is_confirmed             boolean      NOT NULL,
    is_cancelled_in_advance  boolean      NOT NULL,
    is_shown                 boolean      NOT NULL,
    is_test_drive            boolean      NOT NULL,
    is_write_up              boolean      NOT NULL,
    is_sold                  boolean      NOT NULL,
    minutes_early_or_late    integer      NULL,
    source_system            varchar(40)  NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_appointment
        PRIMARY KEY (appointment_key),
    CONSTRAINT uq_fact_appointment_appointment_id
        UNIQUE (appointment_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_appointment_key_positive
        CHECK (appointment_key > 0),
    CONSTRAINT ck_fact_appointment_appointment_id_not_blank
        CHECK (btrim(appointment_id) <> ''),
    CONSTRAINT ck_fact_appointment_count_is_one
        CHECK (appointment_count = 1),
    CONSTRAINT ck_fact_appointment_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_fact_appointment_scheduled_not_before_created
        CHECK (scheduled_date_key >= created_date_key),
    CONSTRAINT ck_fact_appointment_shown_requires_show_date
        CHECK (NOT is_shown OR show_date_key IS NOT NULL),
    CONSTRAINT ck_fact_appointment_shown_excludes_cancellation
        CHECK (NOT is_shown OR NOT is_cancelled_in_advance),
    CONSTRAINT ck_fact_appointment_write_up_requires_show
        CHECK (NOT is_write_up OR is_shown),
    CONSTRAINT ck_fact_appointment_sold_requires_sale
        CHECK (NOT is_sold OR sale_key IS NOT NULL),
    CONSTRAINT ck_fact_appointment_punctuality_requires_show
        CHECK (is_shown OR minutes_early_or_late IS NULL)
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_appointment_created_date',   'created_date_key',   'dim_date',          'date_key'),
            ('fk_fact_appointment_scheduled_date', 'scheduled_date_key', 'dim_date',          'date_key'),
            ('fk_fact_appointment_show_date',      'show_date_key',      'dim_date',          'date_key'),
            ('fk_fact_appointment_dealership',     'dealership_key',     'dim_dealership',    'dealership_key'),
            ('fk_fact_appointment_lead',           'lead_key',           'fact_lead',         'lead_key'),
            ('fk_fact_appointment_customer',       'customer_key',       'dim_customer',      'customer_key'),
            ('fk_fact_appointment_salesperson',    'salesperson_key',    'dim_employee',      'employee_key'),
            ('fk_fact_appointment_bdc_employee',   'bdc_employee_key',   'dim_employee',      'employee_key'),
            ('fk_fact_appointment_model',          'vehicle_model_key',  'dim_vehicle_model', 'vehicle_model_key'),
            ('fk_fact_appointment_sale',           'sale_key',           'fact_vehicle_sale', 'sale_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_appointment ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_appointment IS
    'Grain: one row per scheduled appointment. Accumulating snapshot: show, test drive, write-up and sale '
    'outcomes are filled in as the visit progresses. Show logic is enforced by CHECK constraints so a show '
    'rate cannot be inflated by contradictory rows. Currently EMPTY: the generator and load script are '
    'Phase 1.4 work owned by Agent H.';

COMMENT ON COLUMN warehouse.fact_appointment.appointment_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by appointment_id.';
COMMENT ON COLUMN warehouse.fact_appointment.appointment_id IS 'Natural key from the CRM, APT-########. Unique.';
COMMENT ON COLUMN warehouse.fact_appointment.created_date_key IS 'Foreign key to warehouse.dim_date: the date the appointment was set.';
COMMENT ON COLUMN warehouse.fact_appointment.scheduled_date_key IS 'Foreign key to warehouse.dim_date: the date the appointment was scheduled for. Never before created_date_key.';
COMMENT ON COLUMN warehouse.fact_appointment.show_date_key IS 'Foreign key to warehouse.dim_date: the date the customer actually attended. NULL means they did not attend.';
COMMENT ON COLUMN warehouse.fact_appointment.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store the appointment is at.';
COMMENT ON COLUMN warehouse.fact_appointment.lead_key IS 'Foreign key to warehouse.fact_lead: the lead the appointment was set from. Required; an appointment always originates from a lead.';
COMMENT ON COLUMN warehouse.fact_appointment.customer_key IS 'Foreign key to warehouse.dim_customer. NULL means the lead never resolved to a known customer.';
COMMENT ON COLUMN warehouse.fact_appointment.salesperson_key IS 'Foreign key to warehouse.dim_employee. NULL means no salesperson was assigned.';
COMMENT ON COLUMN warehouse.fact_appointment.bdc_employee_key IS 'Foreign key to warehouse.dim_employee: the BDC representative who set the appointment. NULL when it was not set by the BDC.';
COMMENT ON COLUMN warehouse.fact_appointment.vehicle_model_key IS 'Foreign key to warehouse.dim_vehicle_model. NULL means no model of interest was expressed.';
COMMENT ON COLUMN warehouse.fact_appointment.sale_key IS 'Foreign key to warehouse.fact_vehicle_sale. NULL means the visit produced no sale. Required when is_sold.';
COMMENT ON COLUMN warehouse.fact_appointment.appointment_count IS 'Always 1. Additive; the denominator of every show rate.';
COMMENT ON COLUMN warehouse.fact_appointment.is_confirmed IS 'Whether the appointment was confirmed in advance.';
COMMENT ON COLUMN warehouse.fact_appointment.is_cancelled_in_advance IS 'Whether the customer cancelled before the slot. Mutually exclusive with is_shown.';
COMMENT ON COLUMN warehouse.fact_appointment.is_shown IS 'Whether the customer attended. Implies show_date_key IS NOT NULL and NOT is_cancelled_in_advance.';
COMMENT ON COLUMN warehouse.fact_appointment.is_test_drive IS 'Whether a test drive took place during the visit.';
COMMENT ON COLUMN warehouse.fact_appointment.is_write_up IS 'Whether the visit produced a written deal. Implies is_shown.';
COMMENT ON COLUMN warehouse.fact_appointment.is_sold IS 'Whether the visit produced a sale. Implies sale_key IS NOT NULL.';
COMMENT ON COLUMN warehouse.fact_appointment.minutes_early_or_late IS 'Signed arrival punctuality: negative is early, positive is late. NULL exactly when the customer did not attend. NON-ADDITIVE: average it, never sum it.';
COMMENT ON COLUMN warehouse.fact_appointment.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
