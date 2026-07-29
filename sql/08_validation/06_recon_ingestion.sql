-- =============================================================================
-- File:            sql/08_validation/06_recon_ingestion.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Reconcile each MVP fact's staging population against its warehouse table, and assert inventory snapshot continuity.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHAT THIS CLOSES
-- ----------------
-- The Python loader already reconciles every entity's RAW to STAGING chain --
-- raw = staging accepted + rejected + deduplicated -- and, for the eight
-- dimensions, staging to warehouse. The five FACTS had no staging-to-warehouse
-- reconciliation at all, because their ingestion specs carry no warehouse target:
-- the fact load scripts run, but nothing compared what they wrote against what
-- staging offered them. A fact load that silently dropped rows on an unresolved
-- surrogate key would have looked exactly like a correct one.
--
-- These five rules close that gap. Each compares the DISTINCT BUSINESS KEYS staging
-- accepted against the rows the warehouse fact actually holds, so a drop on an
-- unresolved dimension join fails the reconciliation rather than passing quietly.
-- Together with the loader's raw-to-staging chain, the source-to-staging-to-
-- warehouse path is now covered end to end for all five MVP facts.
--
-- All five are exact. A fact row is either loaded or it is not.
--
-- INVENTORY SNAPSHOT CONTINUITY
-- -----------------------------
-- A daily snapshot fact is only trustworthy if the days are actually there. A gap
-- in the middle of a vehicle's life on the lot silently corrupts every measure
-- built on it: the daily average in KPI-INV-008 divides by the dates that exist,
-- so a missing day inflates the average lot size, and a semi-additive
-- last-value measure would report the wrong count on the missing date. The
-- continuity rule asserts that each vehicle-store pair's snapshot dates form an
-- unbroken run: the number of distinct dates equals the span between its first and
-- last date.

CREATE OR REPLACE VIEW audit.vw_recon_ingestion AS
WITH sale AS (
    SELECT
        (SELECT count(DISTINCT sale_id) FROM staging.stg_sale_event)                AS staged,
        (SELECT count(DISTINCT sale_id) FROM warehouse.fact_vehicle_sale)           AS loaded
),
inventory AS (
    SELECT
        (SELECT count(*) FROM (
             SELECT DISTINCT snapshot_date, dealership_id, vehicle_id
             FROM staging.stg_inventory_snapshot) AS k)                             AS staged,
        (SELECT count(*) FROM warehouse.fact_vehicle_inventory_snapshot)            AS loaded
),
lead AS (
    SELECT
        (SELECT count(DISTINCT lead_id) FROM staging.stg_lead)                      AS staged,
        (SELECT count(DISTINCT lead_id) FROM warehouse.fact_lead)                   AS loaded
),
appointment AS (
    SELECT
        (SELECT count(DISTINCT appointment_id) FROM staging.stg_appointment)        AS staged,
        (SELECT count(DISTINCT appointment_id) FROM warehouse.fact_appointment)     AS loaded
),
spend AS (
    SELECT
        (SELECT count(*) FROM (
             SELECT DISTINCT month_date_key, dealership_id, campaign_id
             FROM staging.stg_marketing_spend) AS k)                                AS staged,
        (SELECT count(*) FROM warehouse.fact_marketing_spend)                       AS loaded
),
continuity AS (
    SELECT
        count(*)::numeric AS pair_count,
        count(*) FILTER (
            WHERE run.distinct_dates <> run.span_days
        )::numeric        AS broken_pair_count
    FROM (
        SELECT
            i.dealership_key,
            i.vehicle_key,
            count(DISTINCT d.full_date)                                   AS distinct_dates,
            (max(d.full_date) - min(d.full_date) + 1)                     AS span_days
        FROM warehouse.fact_vehicle_inventory_snapshot AS i
        JOIN warehouse.dim_date AS d ON d.date_key = i.snapshot_date_key
        GROUP BY i.dealership_key, i.vehicle_key
    ) AS run
)

-- RECON-FACT-VEHICLE-SALE-WAREHOUSE ------------------------------------------
SELECT
    'RECON-FACT-VEHICLE-SALE-WAREHOUSE'::text AS reconciliation_id,
    format('Every sale_id accepted by staging reached warehouse.fact_vehicle_sale (%s staged, %s loaded).',
           sale.staged, sale.loaded)::text AS description,
    'staging.stg_sale_event'::text AS left_source,
    sale.staged::numeric AS left_value,
    'warehouse.fact_vehicle_sale'::text AS right_source,
    sale.loaded::numeric AS right_value,
    0::numeric AS tolerance,
    CASE WHEN sale.staged = sale.loaded THEN 'passed' ELSE 'failed' END::text AS status
FROM sale

UNION ALL

-- RECON-FACT-INVENTORY-SNAPSHOT-WAREHOUSE ------------------------------------
SELECT
    'RECON-FACT-INVENTORY-SNAPSHOT-WAREHOUSE'::text,
    format('Every (snapshot date, store, vehicle) accepted by staging reached '
           'warehouse.fact_vehicle_inventory_snapshot (%s staged, %s loaded).',
           inventory.staged, inventory.loaded)::text,
    'staging.stg_inventory_snapshot'::text,
    inventory.staged::numeric,
    'warehouse.fact_vehicle_inventory_snapshot'::text,
    inventory.loaded::numeric,
    0::numeric,
    CASE WHEN inventory.staged = inventory.loaded THEN 'passed' ELSE 'failed' END::text
FROM inventory

UNION ALL

-- RECON-FACT-LEAD-WAREHOUSE --------------------------------------------------
SELECT
    'RECON-FACT-LEAD-WAREHOUSE'::text,
    format('Every lead_id accepted by staging reached warehouse.fact_lead (%s staged, %s loaded).',
           lead.staged, lead.loaded)::text,
    'staging.stg_lead'::text,
    lead.staged::numeric,
    'warehouse.fact_lead'::text,
    lead.loaded::numeric,
    0::numeric,
    CASE WHEN lead.staged = lead.loaded THEN 'passed' ELSE 'failed' END::text
FROM lead

UNION ALL

-- RECON-FACT-APPOINTMENT-WAREHOUSE -------------------------------------------
SELECT
    'RECON-FACT-APPOINTMENT-WAREHOUSE'::text,
    format('Every appointment_id accepted by staging reached warehouse.fact_appointment '
           '(%s staged, %s loaded).', appointment.staged, appointment.loaded)::text,
    'staging.stg_appointment'::text,
    appointment.staged::numeric,
    'warehouse.fact_appointment'::text,
    appointment.loaded::numeric,
    0::numeric,
    CASE WHEN appointment.staged = appointment.loaded THEN 'passed' ELSE 'failed' END::text
FROM appointment

UNION ALL

-- RECON-FACT-MARKETING-SPEND-WAREHOUSE ---------------------------------------
SELECT
    'RECON-FACT-MARKETING-SPEND-WAREHOUSE'::text,
    format('Every (month, store, campaign) accepted by staging reached '
           'warehouse.fact_marketing_spend (%s staged, %s loaded).',
           spend.staged, spend.loaded)::text,
    'staging.stg_marketing_spend'::text,
    spend.staged::numeric,
    'warehouse.fact_marketing_spend'::text,
    spend.loaded::numeric,
    0::numeric,
    CASE WHEN spend.staged = spend.loaded THEN 'passed' ELSE 'failed' END::text
FROM spend

UNION ALL

-- RECON-INV-CONTINUITY -------------------------------------------------------
SELECT
    'RECON-INV-CONTINUITY'::text,
    format('Every vehicle-store pair has an unbroken run of daily snapshots: %s of %s pairs have a gap '
           'between their first and last snapshot date. A gap silently corrupts every semi-additive '
           'inventory measure, because the daily average divides by the dates that exist.',
           continuity.broken_pair_count, continuity.pair_count)::text,
    'warehouse.fact_vehicle_inventory_snapshot (pairs with a gap)'::text,
    continuity.broken_pair_count,
    'zero gaps required'::text,
    0::numeric,
    0::numeric,
    CASE WHEN continuity.broken_pair_count = 0 THEN 'passed' ELSE 'failed' END::text
FROM continuity;

COMMENT ON VIEW audit.vw_recon_ingestion IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'Closes the staging-to-warehouse gap for the five MVP facts, which the Python loader could not cover '
    'because their ingestion specs carry no warehouse target: a fact load that silently dropped rows on an '
    'unresolved surrogate key would otherwise have looked exactly like a correct one. Each rule compares '
    'the distinct business keys staging accepted against the rows the warehouse fact holds, exactly, with '
    'no tolerance. RECON-INV-CONTINUITY additionally asserts that each vehicle-store pair''s daily '
    'snapshots form an unbroken run, because a missing day inflates the daily-average denominator of '
    'KPI-INV-008 and makes a semi-additive last-value measure report the wrong count on that date.';
