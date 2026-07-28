-- =============================================================================
-- File:            sql/04_facts/12_fact_lead_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_lead into warehouse.fact_lead, resolving every surrogate key by natural-key join.
-- Execution order: 56 of 73 in the initialisation sequence, and at runtime by the Python loader after warehouse.fact_vehicle_sale is loaded.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per unique CRM lead (warehouse.fact_lead grain).
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
-- fact_lead.sale_key references warehouse.fact_vehicle_sale, and
-- ck_fact_lead_sold_requires_sale makes that key mandatory on a sold lead. File 10
-- therefore runs before file 12: a sold lead loaded ahead of its sale would fail
-- the constraint rather than silently lose its conversion.
--
-- SURROGATE KEYS ARE RESOLVED, NEVER ASSUMED
-- ------------------------------------------
-- Every key comes from a join on the natural key the source carries. dim_employee
-- is SCD Type 2, so assigned_employee_key resolves the version whose
-- [effective_date, expiration_date] contains the lead's creation date -- the date
-- the generator itself used to pick an owner. Resolving to is_current instead would
-- attribute the lead to whichever store that person works at now.
--
-- dim_dealership is Type 2 and is joined the same way.
--
-- WHY THE DATE JOIN IS INNER
-- --------------------------
-- lead_created_date_key is NOT NULL and references warehouse.dim_date, which covers
-- the reporting window and nothing else. A lead dated outside it is excluded here
-- and recorded as a REJ-REF-001 rejection in audit.rejected_record by the loader.
--
-- WHY SOME JOINS ARE LEFT
-- -----------------------
-- customer_key, vehicle_model_key, campaign_key, assigned_employee_key and sale_key
-- are nullable by contract, and NULL is a modelled fact in every one of those
-- cases: an anonymous enquiry, a shopper who named no unit, an unpaid source with
-- no campaign behind it, an unworked lead, a lead that did not buy. lead_source_key
-- is NOT NULL and is joined INNER, because a lead with no source is not a lead
-- anybody can attribute.
--
-- FUNNEL FLAGS ARE CARRIED, NOT RECOMPUTED
-- ----------------------------------------
-- is_contacted, is_appointment_set, is_appointment_shown and is_sold come straight
-- from the source; their monotonicity is enforced by the table's CHECK constraints.
-- If the source ever violated the funnel the load would fail on the constraint,
-- which is the outcome we want: a funnel chart built on contradictory rows shows a
-- conversion rate above 100%.
--
-- first_response_seconds is passed through untouched, including its NULLs. NULL
-- means nobody ever responded; 0 means the response was immediate. Coalescing the
-- first into the second would silently improve every response-time average.

WITH src AS (
    SELECT
        s.lead_id,
        d.date_key                 AS lead_created_date_key,
        store.dealership_key,
        cust.customer_key,
        model.vehicle_model_key,
        lead_source.lead_source_key,
        campaign.campaign_key,
        owner.employee_key         AS assigned_employee_key,
        sale.sale_key,
        s.lead_count,
        s.first_response_seconds,
        s.is_contacted,
        s.is_appointment_set,
        s.is_appointment_shown,
        s.is_sold,
        s.is_duplicate,
        s.original_lead_id,
        s.days_to_sale,
        s.source_system
    FROM staging.stg_lead AS s
    -- Required: the calendar. A date the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d
      ON d.full_date = s.lead_created_date
    -- Required: the store, as it stood on the day the lead arrived.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND s.lead_created_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: where the lead came from.
    JOIN warehouse.dim_lead_source AS lead_source
      ON lead_source.lead_source_id = s.lead_source_id
    -- Optional by contract; NULL is a modelled fact, not a missing value.
    LEFT JOIN warehouse.dim_customer AS cust
      ON cust.customer_id = s.customer_id
    LEFT JOIN warehouse.dim_vehicle_model AS model
      ON model.vehicle_model_id = s.vehicle_model_id
    LEFT JOIN warehouse.dim_marketing_campaign AS campaign
      ON campaign.campaign_id = s.campaign_id
    -- Optional, and resolved AS AT THE CREATION DATE, not as at today.
    LEFT JOIN warehouse.dim_employee AS owner
      ON owner.employee_id = s.assigned_employee_id
     AND s.lead_created_date BETWEEN owner.effective_date AND owner.expiration_date
    LEFT JOIN warehouse.fact_vehicle_sale AS sale
      ON sale.sale_id = s.sale_id
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.lead_key), 0) FROM warehouse.fact_lead AS x)
            + row_number() OVER (ORDER BY s.lead_id) AS lead_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1 FROM warehouse.fact_lead AS f WHERE f.lead_id = s.lead_id
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load, so a
    -- fact_appointment row that already points at them stays valid.
    SELECT f.lead_key, s.*
    FROM src AS s
    JOIN warehouse.fact_lead AS f ON f.lead_id = s.lead_id
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_lead AS f (
    lead_key,
    lead_id,
    lead_created_date_key,
    dealership_key,
    customer_key,
    vehicle_model_key,
    lead_source_key,
    campaign_key,
    assigned_employee_key,
    sale_key,
    lead_count,
    first_response_seconds,
    is_contacted,
    is_appointment_set,
    is_appointment_shown,
    is_sold,
    is_duplicate,
    original_lead_id,
    days_to_sale,
    source_system
)
SELECT
    k.lead_key,
    k.lead_id,
    k.lead_created_date_key,
    k.dealership_key,
    k.customer_key,
    k.vehicle_model_key,
    k.lead_source_key,
    k.campaign_key,
    k.assigned_employee_key,
    k.sale_key,
    k.lead_count,
    k.first_response_seconds,
    k.is_contacted,
    k.is_appointment_set,
    k.is_appointment_shown,
    k.is_sold,
    k.is_duplicate,
    k.original_lead_id,
    k.days_to_sale,
    k.source_system
FROM merged AS k
ON CONFLICT (lead_id) DO UPDATE
SET lead_created_date_key  = EXCLUDED.lead_created_date_key,
    dealership_key         = EXCLUDED.dealership_key,
    customer_key           = EXCLUDED.customer_key,
    vehicle_model_key      = EXCLUDED.vehicle_model_key,
    lead_source_key        = EXCLUDED.lead_source_key,
    campaign_key           = EXCLUDED.campaign_key,
    assigned_employee_key  = EXCLUDED.assigned_employee_key,
    sale_key               = EXCLUDED.sale_key,
    lead_count             = EXCLUDED.lead_count,
    first_response_seconds = EXCLUDED.first_response_seconds,
    is_contacted           = EXCLUDED.is_contacted,
    is_appointment_set     = EXCLUDED.is_appointment_set,
    is_appointment_shown   = EXCLUDED.is_appointment_shown,
    is_sold                = EXCLUDED.is_sold,
    is_duplicate           = EXCLUDED.is_duplicate,
    original_lead_id       = EXCLUDED.original_lead_id,
    days_to_sale           = EXCLUDED.days_to_sale,
    source_system          = EXCLUDED.source_system
WHERE (
    f.lead_created_date_key,
    f.dealership_key,
    f.customer_key,
    f.vehicle_model_key,
    f.lead_source_key,
    f.campaign_key,
    f.assigned_employee_key,
    f.sale_key,
    f.lead_count,
    f.first_response_seconds,
    f.is_contacted,
    f.is_appointment_set,
    f.is_appointment_shown,
    f.is_sold,
    f.is_duplicate,
    f.original_lead_id,
    f.days_to_sale,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.lead_created_date_key,
    EXCLUDED.dealership_key,
    EXCLUDED.customer_key,
    EXCLUDED.vehicle_model_key,
    EXCLUDED.lead_source_key,
    EXCLUDED.campaign_key,
    EXCLUDED.assigned_employee_key,
    EXCLUDED.sale_key,
    EXCLUDED.lead_count,
    EXCLUDED.first_response_seconds,
    EXCLUDED.is_contacted,
    EXCLUDED.is_appointment_set,
    EXCLUDED.is_appointment_shown,
    EXCLUDED.is_sold,
    EXCLUDED.is_duplicate,
    EXCLUDED.original_lead_id,
    EXCLUDED.days_to_sale,
    EXCLUDED.source_system
);
