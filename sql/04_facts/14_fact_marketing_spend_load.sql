-- =============================================================================
-- File:            sql/04_facts/14_fact_marketing_spend_load.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent load of staging.stg_marketing_spend into warehouse.fact_marketing_spend, resolving every surrogate key by natural-key join.
-- Execution order: 58 of 73 in the initialisation sequence, and at runtime by the Python loader after every dimension merge.
-- Idempotency:     Rerunning with unchanged source writes zero rows: ON CONFLICT DO UPDATE fires only when at least one column actually differs. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per dealership per campaign per calendar month (warehouse.fact_marketing_spend grain).
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/04_facts/*_load.sql, sorts by file name and
-- executes each file's whole text through psycopg's cursor.execute(). Plain SQL
-- only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the transaction),
-- statements separated by semicolons. Safe against an empty database.
--
-- THE GRAIN IS THE CONFLICT TARGET
-- --------------------------------
-- marketing_spend_id is the source system's identifier and does NOT appear on the
-- fact: the fact's identity is (month, store, campaign), enforced by
-- uq_fact_marketing_spend_grain, and that unique constraint is the conflict target
-- below. Two vendor invoices for one campaign in one month at one store are one
-- fact row, not two.
--
-- WHY month_date_key IS JOINED ON date_key, NOT ON A DATE
-- -------------------------------------------------------
-- The source already carries the month as a date key (YYYYMM01), so the join
-- resolves warehouse.dim_date on date_key rather than on full_date. It is still a
-- resolution and not an assumption: a month key the calendar does not contain --
-- spend for a month outside the reporting window -- is excluded here and recorded
-- as a REJ-REF-001 rejection in audit.rejected_record by the loader, never
-- defaulted to the nearest month. ck_fact_marketing_spend_month_key_is_first_of_month
-- then enforces that whatever did resolve really is the first of a month, so spend
-- and sales cannot disagree about what a month is.
--
-- WHY EVERY OTHER JOIN IS INNER
-- -----------------------------
-- dealership_key, campaign_key and lead_source_key are all NOT NULL by contract:
-- spend that belongs to no store, no campaign or no source cannot be attributed at
-- all, and a marketing report built on it would divide a real cost by a fictional
-- denominator. dim_dealership is SCD Type 2, so the store is resolved as at the
-- first day of the spend month rather than as at today.
--
-- vendor_reported_leads IS NOT RECONCILED AWAY
-- --------------------------------------------
-- It is loaded exactly as the vendor reported it, and it deliberately differs from
-- the CRM lead count for the same campaign and month. The gap is the analytic
-- finding; silently replacing one with the other would destroy the only measure
-- that exposes it.

WITH src AS (
    SELECT
        d.date_key                 AS month_date_key,
        store.dealership_key,
        campaign.campaign_key,
        lead_source.lead_source_key,
        s.spend_amount,
        s.impressions,
        s.clicks,
        s.calls,
        s.form_submissions,
        s.vendor_reported_leads,
        s.source_system
    FROM staging.stg_marketing_spend AS s
    -- Required: the calendar. A month the window does not contain is a rejection.
    JOIN warehouse.dim_date AS d
      ON d.date_key = s.month_date_key
    -- Required: the store, as it stood on the first day of the spend month.
    JOIN warehouse.dim_dealership AS store
      ON store.dealership_id = s.dealership_id
     AND d.full_date BETWEEN store.effective_date AND store.expiration_date
    -- Required: the campaign and the source it attributes leads to.
    JOIN warehouse.dim_marketing_campaign AS campaign
      ON campaign.campaign_id = s.campaign_id
    JOIN warehouse.dim_lead_source AS lead_source
      ON lead_source.lead_source_id = s.lead_source_id
),
new_rows AS (
    SELECT
        (SELECT coalesce(max(x.marketing_spend_key), 0)
         FROM warehouse.fact_marketing_spend AS x)
            + row_number() OVER (
                ORDER BY s.month_date_key, s.dealership_key, s.campaign_key
              ) AS marketing_spend_key,
        s.*
    FROM src AS s
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.fact_marketing_spend AS f
        WHERE f.month_date_key = s.month_date_key
          AND f.dealership_key = s.dealership_key
          AND f.campaign_key = s.campaign_key
    )
),
existing_rows AS (
    -- Rows already present keep the key they were assigned on their first load.
    SELECT f.marketing_spend_key, s.*
    FROM src AS s
    JOIN warehouse.fact_marketing_spend AS f
      ON f.month_date_key = s.month_date_key
     AND f.dealership_key = s.dealership_key
     AND f.campaign_key = s.campaign_key
),
merged AS (
    SELECT * FROM new_rows
    UNION ALL
    SELECT * FROM existing_rows
)
INSERT INTO warehouse.fact_marketing_spend AS f (
    marketing_spend_key,
    month_date_key,
    dealership_key,
    campaign_key,
    lead_source_key,
    spend_amount,
    impressions,
    clicks,
    calls,
    form_submissions,
    vendor_reported_leads,
    source_system
)
SELECT
    k.marketing_spend_key,
    k.month_date_key,
    k.dealership_key,
    k.campaign_key,
    k.lead_source_key,
    k.spend_amount,
    k.impressions,
    k.clicks,
    k.calls,
    k.form_submissions,
    k.vendor_reported_leads,
    k.source_system
FROM merged AS k
ON CONFLICT (month_date_key, dealership_key, campaign_key) DO UPDATE
SET lead_source_key       = EXCLUDED.lead_source_key,
    spend_amount          = EXCLUDED.spend_amount,
    impressions           = EXCLUDED.impressions,
    clicks                = EXCLUDED.clicks,
    calls                 = EXCLUDED.calls,
    form_submissions      = EXCLUDED.form_submissions,
    vendor_reported_leads = EXCLUDED.vendor_reported_leads,
    source_system         = EXCLUDED.source_system
WHERE (
    f.lead_source_key,
    f.spend_amount,
    f.impressions,
    f.clicks,
    f.calls,
    f.form_submissions,
    f.vendor_reported_leads,
    f.source_system
) IS DISTINCT FROM (
    EXCLUDED.lead_source_key,
    EXCLUDED.spend_amount,
    EXCLUDED.impressions,
    EXCLUDED.clicks,
    EXCLUDED.calls,
    EXCLUDED.form_submissions,
    EXCLUDED.vendor_reported_leads,
    EXCLUDED.source_system
);
