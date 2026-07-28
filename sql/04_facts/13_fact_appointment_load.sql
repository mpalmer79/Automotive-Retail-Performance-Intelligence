-- =============================================================================
-- File:            sql/04_facts/13_fact_appointment_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_appointment into warehouse.fact_appointment, resolving every surrogate key by natural-key join.
-- Execution order: 57 of 73 in the initialisation sequence, and at runtime by the Python loader after warehouse.fact_lead is loaded.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per scheduled appointment (warehouse.fact_appointment grain).
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. Safe against an empty database.
--
-- ORDERING IS LOAD-BEARING
-- ------------------------
-- fact_appointment.lead_key is NOT NULL and references warehouse.fact_lead, and
-- sale_key references warehouse.fact_vehicle_sale. Files 10 and 12 therefore run
-- before this one. An appointment always originates from a lead, so the join to
-- fact_lead is INNER: an appointment whose lead did not load is not loaded either,
-- and the drop is visible through the loader's row-count reconciliation rather than
-- silent.
--
-- THREE DATE ROLES, THREE JOINS
-- -----------------------------
--   created_date_key    when the appointment was set          (required)
--   scheduled_date_key  when it was booked for                (required)
--   show_date_key       when the customer actually arrived    (NULL = did not show)
-- The first two are INNER joins to warehouse.dim_date: a date the reporting window
-- does not contain is excluded here and recorded as a REJ-REF-001 rejection in
-- audit.rejected_record by the loader, never defaulted. show_date_key is a LEFT
-- join because its NULL is a modelled fact -- nobody arrived -- and
-- ck_fact_appointment_shown_requires_show_date makes it mandatory exactly when
-- is_shown is true.
--
-- WHICH DATE EACH EMPLOYEE IS RESOLVED ON
-- ---------------------------------------
-- dim_employee is SCD Type 2, so both employee keys resolve the version whose
-- [effective_date, expiration_date] contains the relevant date -- and the relevant
-- date differs by role, exactly as the generator drew them:
--   * the salesperson is the person expected to take the visit, so they are
--     resolved as at the SCHEDULED date;
--   * the business development representative is the person who booked it, so they
--     are resolved as at the CREATED date.
-- Resolving either to is_current would credit the appointment to whichever store
-- that person works at today.
--
-- minutes_early_or_late is passed through untouched, including its NULLs: NULL
-- means nobody showed, and ck_fact_appointment_punctuality_requires_show enforces
-- that. Rendering it as 0 would report a punctual arrival that never happened.

WITH src AS (
    SELECT
        s.appointment_id,
        d_created.date_key             AS created_date_key,
        d_scheduled.date_key           AS scheduled_date_key,
        d_show.date_key                AS show_date_key,
        store.dealership_key,
        lead_fact.lead_key,
        cust.customer_key,
        sales_person.employee_key      AS salesperson_key,
        bdc.employee_key               AS bdc_employee_key,
        model.vehicle_model_key,
        sale.sale_key,
        s.appointment_count,
        s.is_confirmed,
        s.is_cancelled_in_advance,
        s.is_shown,
        s.is_test_drive,
        s.is_write_up,
        s.is_sold,
        s.minutes_early_or_late,
        s.source_system
    FROM staging.stg_appointment AS s
    -- Required: the calendar. A date the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d_created
      ON d_created.full_date = s.created_date
    JOIN warehouse.dim_date AS d_scheduled
      ON d_scheduled.full_date = s.scheduled_date
    -- Required: the store, as it stood on the day the appointment was set.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.created_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: an appointment always originates from a lead.
    JOIN warehouse.fact_lead AS lead_fact
      ON lead_fact.lead_id = s.lead_id
    -- Optional by contract: NULL means nobody arrived.
    LEFT JOIN warehouse.dim_date AS d_show
      ON d_show.full_date = s.show_date
    -- Optional by contract; NULL is a modelled fact, not a missing value.
    LEFT JOIN warehouse.dim_customer AS cust
      ON cust.customer_id = s.customer_id
    LEFT JOIN warehouse.dim_vehicle_model AS model
      ON model.vehicle_model_id = s.vehicle_model_id
    -- Optional, and each resolved as at the date its own role acts on.
    LEFT JOIN warehouse.dim_employee AS sales_person
      ON sales_person.employee_id = s.salesperson_id
     AND s.scheduled_date BETWEEN sales_person.effective_date AND sales_person.expiration_date
    LEFT JOIN warehouse.dim_employee AS bdc
      ON bdc.employee_id = s.bdc_employee_id
     AND s.created_date BETWEEN bdc.effective_date AND bdc.expiration_date
    LEFT JOIN warehouse.fact_vehicle_sale AS sale
      ON sale.sale_id = s.sale_id
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.appointment_key), 0) FROM warehouse.fact_appointment AS x)
            + row_number() OVER (ORDER BY s.appointment_id) AS appointment_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.fact_appointment AS f
        WHERE f.appointment_id = s.appointment_id
    )
),
existing_rows AS (
    SELECT f.appointment_key, s.*
    FROM src AS s
    JOIN warehouse.fact_appointment AS f ON f.appointment_id = s.appointment_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_appointment AS f (
    appointment_key,
    appointment_id,
    created_date_key,
    scheduled_date_key,
    show_date_key,
    dealership_key,
    lead_key,
    customer_key,
    salesperson_key,
    bdc_employee_key,
    vehicle_model_key,
    sale_key,
    appointment_count,
    is_confirmed,
    is_cancelled_in_advance,
    is_shown,
    is_test_drive,
    is_write_up,
    is_sold,
    minutes_early_or_late,
    source_system
)
SELECT
    k.appointment_key,
    k.appointment_id,
    k.created_date_key,
    k.scheduled_date_key,
    k.show_date_key,
    k.dealership_key,
    k.lead_key,
    k.customer_key,
    k.salesperson_key,
    k.bdc_employee_key,
    k.vehicle_model_key,
    k.sale_key,
    k.appointment_count,
    k.is_confirmed,
    k.is_cancelled_in_advance,
    k.is_shown,
    k.is_test_drive,
    k.is_write_up,
    k.is_sold,
    k.minutes_early_or_late,
    k.source_system
FROM merged AS k
ON CONFLICT (appointment_id) DO UPDATE
SET created_date_key        = EXCLUDED.created_date_key,
    scheduled_date_key      = EXCLUDED.scheduled_date_key,
    show_date_key           = EXCLUDED.show_date_key,
    dealership_key          = EXCLUDED.dealership_key,
    lead_key                = EXCLUDED.lead_key,
    customer_key            = EXCLUDED.customer_key,
    salesperson_key         = EXCLUDED.salesperson_key,
    bdc_employee_key        = EXCLUDED.bdc_employee_key,
    vehicle_model_key       = EXCLUDED.vehicle_model_key,
    sale_key                = EXCLUDED.sale_key,
    appointment_count       = EXCLUDED.appointment_count,
    is_confirmed            = EXCLUDED.is_confirmed,
    is_cancelled_in_advance = EXCLUDED.is_cancelled_in_advance,
    is_shown                = EXCLUDED.is_shown,
    is_test_drive           = EXCLUDED.is_test_drive,
    is_write_up             = EXCLUDED.is_write_up,
    is_sold                 = EXCLUDED.is_sold,
    minutes_early_or_late   = EXCLUDED.minutes_early_or_late,
    source_system           = EXCLUDED.source_system
WHERE (
    f.created_date_key,
    f.scheduled_date_key,
    f.show_date_key,
    f.dealership_key,
    f.lead_key,
    f.customer_key,
    f.salesperson_key,
    f.bdc_employee_key,
    f.vehicle_model_key,
    f.sale_key,
    f.appointment_count,
    f.is_confirmed,
    f.is_cancelled_in_advance,
    f.is_shown,
    f.is_test_drive,
    f.is_write_up,
    f.is_sold,
    f.minutes_early_or_late,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.created_date_key,
    EXCLUDED.scheduled_date_key,
    EXCLUDED.show_date_key,
    EXCLUDED.dealership_key,
    EXCLUDED.lead_key,
    EXCLUDED.customer_key,
    EXCLUDED.salesperson_key,
    EXCLUDED.bdc_employee_key,
    EXCLUDED.vehicle_model_key,
    EXCLUDED.sale_key,
    EXCLUDED.appointment_count,
    EXCLUDED.is_confirmed,
    EXCLUDED.is_cancelled_in_advance,
    EXCLUDED.is_shown,
    EXCLUDED.is_test_drive,
    EXCLUDED.is_write_up,
    EXCLUDED.is_sold,
    EXCLUDED.minutes_early_or_late,
    EXCLUDED.source_system
);
