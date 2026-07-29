-- =============================================================================
-- File:            sql/08_validation/10_recon_reporting.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Reconcile every reporting fact and analytical view back to the warehouse fact it is built on, so the layer Power BI reads is proven rather than assumed.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Every other reconciliation in ARPI proves something about the WAREHOUSE. Power BI
-- will never read the warehouse: it reads the reporting layer, and a view can lose
-- rows in ways a table cannot. An inner join to a dimension drops any fact row
-- whose key does not resolve; a WHERE clause added for a good reason quietly
-- narrows a population; a GROUP BY at the wrong grain fans a measure out. None of
-- those would be caught by anything upstream.
--
-- These rules compare each reporting object against the warehouse fact it projects.
-- Row-grain views must match row for row and measure for measure; aggregate views
-- must match on their totals. They are the last link in the chain that runs from a
-- generated CSV to the number a report will show.
--
-- The inner joins to dim_vehicle in vw_vehicle_sales and vw_inventory_snapshots are
-- the specific hazard these rules watch: both facts declare a NOT NULL vehicle_key
-- with a foreign key, so the join cannot drop a row today, and RECON-REPORT-SALES-ROWS
-- and RECON-REPORT-INVENTORY-ROWS are what will notice the day that stops being true.

CREATE OR REPLACE VIEW audit.vw_recon_reporting AS
WITH sales AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_vehicle_sales)::numeric                  AS view_rows,
        (SELECT count(*) FROM warehouse.fact_vehicle_sale)::numeric                 AS fact_rows,
        (SELECT coalesce(sum(total_gross), 0) FROM reporting.vw_vehicle_sales)      AS view_gross,
        (SELECT coalesce(sum(total_gross), 0) FROM warehouse.fact_vehicle_sale)     AS fact_gross
),
inventory AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_inventory_snapshots)::numeric            AS view_rows,
        (SELECT count(*) FROM warehouse.fact_vehicle_inventory_snapshot)::numeric   AS fact_rows,
        (SELECT coalesce(sum(active_inventory_units), 0)
         FROM reporting.vw_inventory_health)::numeric                               AS health_units,
        (SELECT coalesce(sum(inventory_unit_count), 0)
         FROM warehouse.fact_vehicle_inventory_snapshot)::numeric                   AS fact_units,
        (SELECT coalesce(sum(units_in_bucket), 0)
         FROM reporting.vw_inventory_aging)::numeric                                AS aging_units
),
leads AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_leads)::numeric                          AS view_rows,
        (SELECT count(*) FROM warehouse.fact_lead)::numeric                         AS fact_rows,
        (SELECT coalesce(sum(leads_received), 0) FROM reporting.vw_lead_funnel)::numeric
                                                                                    AS funnel_leads,
        (SELECT coalesce(sum(valid_leads), 0) FROM reporting.vw_lead_response)::numeric
                                                                                    AS response_leads
),
appointments AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_appointments)::numeric                   AS view_rows,
        (SELECT count(*) FROM warehouse.fact_appointment)::numeric                  AS fact_rows,
        (SELECT coalesce(sum(scheduled_appointments), 0)
         FROM reporting.vw_appointment_funnel)::numeric                             AS funnel_appointments
),
spend AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_marketing_spend)::numeric                AS view_rows,
        (SELECT count(*) FROM warehouse.fact_marketing_spend)::numeric              AS fact_rows
),
days_to_sale AS (
    SELECT
        (SELECT coalesce(sum(retail_units_sold), 0) FROM reporting.vw_days_to_sale)::numeric
                                                                                    AS view_units,
        (SELECT coalesce(sum(unit_count), 0)
         FROM warehouse.fact_vehicle_sale WHERE is_retail)::numeric                 AS fact_units
)

-- RECON-REPORT-SALES-ROWS ----------------------------------------------------
SELECT
    'RECON-REPORT-SALES-ROWS'::text AS reconciliation_id,
    format('reporting.vw_vehicle_sales preserves the fact grain: %s view rows against %s fact rows, and '
           '%s against %s total gross. The view joins dim_vehicle to derive the new/used split, so this '
           'is what notices if that join ever starts dropping a sale.',
           s.view_rows, s.fact_rows, s.view_gross, s.fact_gross)::text AS description,
    'reporting.vw_vehicle_sales'::text AS left_source,
    s.view_rows AS left_value,
    'warehouse.fact_vehicle_sale'::text AS right_source,
    s.fact_rows AS right_value,
    0::numeric AS tolerance,
    CASE WHEN s.view_rows = s.fact_rows AND abs(s.view_gross - s.fact_gross) <= 0.01
         THEN 'passed' ELSE 'failed' END::text AS status
FROM sales AS s

UNION ALL

-- RECON-REPORT-INVENTORY-ROWS ------------------------------------------------
SELECT
    'RECON-REPORT-INVENTORY-ROWS'::text,
    format('reporting.vw_inventory_snapshots preserves the fact grain: %s view rows against %s fact rows. '
           'The view joins dim_vehicle to derive the condition group, so this is what notices if that '
           'join ever starts dropping a snapshot.', i.view_rows, i.fact_rows)::text,
    'reporting.vw_inventory_snapshots'::text,
    i.view_rows,
    'warehouse.fact_vehicle_inventory_snapshot'::text,
    i.fact_rows,
    0::numeric,
    CASE WHEN i.view_rows = i.fact_rows THEN 'passed' ELSE 'failed' END::text
FROM inventory AS i

UNION ALL

-- RECON-INV-001 --------------------------------------------------------------
SELECT
    'RECON-INV-001'::text,
    format('Inventory counts in the reporting layer match the snapshot records: %s units in '
           'vw_inventory_health and %s in vw_inventory_aging, against %s in the warehouse fact. All three '
           'must agree, or the health view and the distribution view are describing different lots.',
           i.health_units, i.aging_units, i.fact_units)::text,
    'reporting.vw_inventory_health'::text,
    i.health_units,
    'warehouse.fact_vehicle_inventory_snapshot'::text,
    i.fact_units,
    0::numeric,
    CASE WHEN i.health_units = i.fact_units AND i.aging_units = i.fact_units
         THEN 'passed' ELSE 'failed' END::text
FROM inventory AS i

UNION ALL

-- RECON-REPORT-LEADS-ROWS ----------------------------------------------------
SELECT
    'RECON-REPORT-LEADS-ROWS'::text,
    format('reporting.vw_leads preserves the fact grain (%s against %s rows), and the two funnel views '
           'agree on the valid population (%s in vw_lead_funnel, %s in vw_lead_response). Duplicates are '
           'excluded by column, not by filter, so the row counts include them and the population counts '
           'do not.', l.view_rows, l.fact_rows, l.funnel_leads, l.response_leads)::text,
    'reporting.vw_leads'::text,
    l.view_rows,
    'warehouse.fact_lead'::text,
    l.fact_rows,
    0::numeric,
    CASE WHEN l.view_rows = l.fact_rows AND l.funnel_leads = l.response_leads
         THEN 'passed' ELSE 'failed' END::text
FROM leads AS l

UNION ALL

-- RECON-REPORT-APPOINTMENTS-ROWS ---------------------------------------------
SELECT
    'RECON-REPORT-APPOINTMENTS-ROWS'::text,
    format('reporting.vw_appointments preserves the fact grain (%s against %s rows), and '
           'vw_appointment_funnel accounts for every appointment on the scheduled-date basis (%s). The '
           'funnel view is a full outer join of two date bases, so a lost row there would be invisible '
           'without this check.', a.view_rows, a.fact_rows, a.funnel_appointments)::text,
    'reporting.vw_appointments'::text,
    a.view_rows,
    'warehouse.fact_appointment'::text,
    a.fact_rows,
    0::numeric,
    CASE WHEN a.view_rows = a.fact_rows AND a.funnel_appointments = a.fact_rows
         THEN 'passed' ELSE 'failed' END::text
FROM appointments AS a

UNION ALL

-- RECON-REPORT-SPEND-ROWS ----------------------------------------------------
SELECT
    'RECON-REPORT-SPEND-ROWS'::text,
    format('reporting.vw_marketing_spend preserves the fact grain: %s view rows against %s fact rows.',
           p.view_rows, p.fact_rows)::text,
    'reporting.vw_marketing_spend'::text,
    p.view_rows,
    'warehouse.fact_marketing_spend'::text,
    p.fact_rows,
    0::numeric,
    CASE WHEN p.view_rows = p.fact_rows THEN 'passed' ELSE 'failed' END::text
FROM spend AS p

UNION ALL

-- RECON-REPORT-DAYS-TO-SALE --------------------------------------------------
SELECT
    'RECON-REPORT-DAYS-TO-SALE'::text,
    format('The days-to-sale population is exactly the retail units sold: %s in vw_days_to_sale against '
           '%s retail units in the warehouse. A median taken over the wrong population is the failure '
           'this rule exists to catch.', d.view_units, d.fact_units)::text,
    'reporting.vw_days_to_sale'::text,
    d.view_units,
    'warehouse.fact_vehicle_sale (retail)'::text,
    d.fact_units,
    0::numeric,
    CASE WHEN d.view_units = d.fact_units THEN 'passed' ELSE 'failed' END::text
FROM days_to_sale AS d;

COMMENT ON VIEW audit.vw_recon_reporting IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'Every other ARPI reconciliation proves something about the warehouse; Power BI never reads the '
    'warehouse. These rules compare each reporting object against the warehouse fact it projects, so the '
    'layer a report actually consumes is proven rather than assumed. A view can lose rows in ways a table '
    'cannot -- an inner join that fails to resolve, a WHERE clause added for a good reason, a GROUP BY at '
    'the wrong grain -- and none of those would be caught upstream. RECON-INV-001 additionally requires '
    'the inventory health view and the age-distribution view to agree with each other and with the fact, '
    'because two views describing different lots is a failure mode a single comparison would miss.';
