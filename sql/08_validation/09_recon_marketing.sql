-- =============================================================================
-- File:            sql/08_validation/09_recon_marketing.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Reconcile marketing spend and its attributed leads, sales and gross between the reporting layer and the warehouse, and assert the cost-attributability rule.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY MARKETING NEEDS ITS OWN RECONCILIATIONS
-- -------------------------------------------
-- reporting.vw_marketing_performance is the only view in ARPI built on a FULL OUTER
-- JOIN. That is deliberate -- it is how the organic tail stays visible instead of
-- being dropped -- but a full outer join is also the easiest way to lose or
-- duplicate a row without anyone noticing. Every one of the rules below exists to
-- make that impossible to do silently.
--
--   RECON-MKT-SPEND      total spend in the view equals total spend in the fact.
--                        A dropped spend row would understate every cost measure.
--   RECON-MKT-LEADS      attributed leads in the view equal valid leads in the
--                        warehouse. The join must not fan a lead out across two
--                        spend rows, nor lose an organic one.
--   RECON-MKT-SALES      attributed retail units equal the retail units reachable
--                        through a non-duplicate lead. Attribution is single-source
--                        and first-touch, so a sale is credited to at most one lead.
--   RECON-MKT-GROSS      attributed gross equals the gross of those same sales, to
--                        the cent.
--   RECON-MKT-COST-RULE  no organic or internal source carries a cost measure.
--                        The rule is that those measures are UNDEFINED there -- a
--                        walk-in has no cost per lead -- so a non-NULL value would
--                        be a false statement, not a rounding difference.
--
-- The attribution side is computed here directly from the warehouse rather than
-- from the reporting view, so the two are genuinely independent derivations. A
-- reconciliation that reads the same view on both sides proves nothing.

CREATE OR REPLACE VIEW audit.vw_recon_marketing AS
WITH view_side AS (
    SELECT
        coalesce(sum(spend_amount), 0)                        AS spend_amount,
        coalesce(sum(attributed_leads), 0)::numeric           AS attributed_leads,
        coalesce(sum(attributed_retail_units), 0)::numeric    AS attributed_retail_units,
        coalesce(sum(attributed_total_gross), 0)              AS attributed_total_gross,
        count(*) FILTER (
            WHERE NOT is_cost_attributable
              AND (cost_per_lead IS NOT NULL
                OR cost_per_sale IS NOT NULL
                OR gross_return_on_ad_spend IS NOT NULL)
        )::numeric                                            AS organic_rows_with_cost
    FROM reporting.vw_marketing_performance
),
warehouse_side AS (
    SELECT
        (SELECT coalesce(sum(spend_amount), 0) FROM warehouse.fact_marketing_spend)
                                                              AS spend_amount,
        (SELECT count(*) FROM warehouse.fact_lead WHERE NOT is_duplicate)::numeric
                                                              AS valid_leads,
        (SELECT coalesce(sum(s.unit_count), 0)
         FROM warehouse.fact_lead AS l
         JOIN warehouse.fact_vehicle_sale AS s ON s.sale_key = l.sale_key
         WHERE NOT l.is_duplicate AND s.is_retail)::numeric    AS attributed_retail_units,
        (SELECT coalesce(sum(s.total_gross), 0)
         FROM warehouse.fact_lead AS l
         JOIN warehouse.fact_vehicle_sale AS s ON s.sale_key = l.sale_key
         WHERE NOT l.is_duplicate AND s.is_retail)            AS attributed_total_gross
)

-- RECON-MKT-SPEND ------------------------------------------------------------
SELECT
    'RECON-MKT-SPEND'::text AS reconciliation_id,
    format('Marketing spend in the reporting layer equals warehouse spend (%s against %s), to the cent. '
           'The view is built on a full outer join, so a dropped spend row would understate every cost '
           'measure at once.', v.spend_amount, w.spend_amount)::text AS description,
    'reporting.vw_marketing_performance'::text AS left_source,
    v.spend_amount AS left_value,
    'warehouse.fact_marketing_spend'::text AS right_source,
    w.spend_amount AS right_value,
    0.01::numeric AS tolerance,
    CASE WHEN abs(v.spend_amount - w.spend_amount) <= 0.01 THEN 'passed' ELSE 'failed' END::text AS status
FROM view_side AS v CROSS JOIN warehouse_side AS w

UNION ALL

-- RECON-MKT-LEADS ------------------------------------------------------------
SELECT
    'RECON-MKT-LEADS'::text,
    format('Attributed leads equal valid warehouse leads (%s against %s). This is the term that catches a '
           'full outer join fanning one lead across two spend rows, or dropping the organic tail '
           'altogether.', v.attributed_leads, w.valid_leads)::text,
    'reporting.vw_marketing_performance'::text,
    v.attributed_leads,
    'warehouse.fact_lead (non-duplicate)'::text,
    w.valid_leads,
    0::numeric,
    CASE WHEN v.attributed_leads = w.valid_leads THEN 'passed' ELSE 'failed' END::text
FROM view_side AS v CROSS JOIN warehouse_side AS w

UNION ALL

-- RECON-MKT-SALES ------------------------------------------------------------
SELECT
    'RECON-MKT-SALES'::text,
    format('Attributed retail units equal the retail units reachable through a non-duplicate lead '
           '(%s against %s). Attribution is single-source and first-touch, so a sale is credited to at '
           'most one lead and this comparison is exact.',
           v.attributed_retail_units, w.attributed_retail_units)::text,
    'reporting.vw_marketing_performance'::text,
    v.attributed_retail_units,
    'warehouse.fact_lead joined to warehouse.fact_vehicle_sale'::text,
    w.attributed_retail_units,
    0::numeric,
    CASE WHEN v.attributed_retail_units = w.attributed_retail_units
         THEN 'passed' ELSE 'failed' END::text
FROM view_side AS v CROSS JOIN warehouse_side AS w

UNION ALL

-- RECON-MKT-GROSS ------------------------------------------------------------
SELECT
    'RECON-MKT-GROSS'::text,
    format('Attributed gross equals the gross of the attributed sales (%s against %s), to the cent. This '
           'is the numerator of gross return on advertising spend, which is the return measure ARPI '
           'treats as primary.', v.attributed_total_gross, w.attributed_total_gross)::text,
    'reporting.vw_marketing_performance'::text,
    v.attributed_total_gross,
    'warehouse.fact_lead joined to warehouse.fact_vehicle_sale'::text,
    w.attributed_total_gross,
    0.01::numeric,
    CASE WHEN abs(v.attributed_total_gross - w.attributed_total_gross) <= 0.01
         THEN 'passed' ELSE 'failed' END::text
FROM view_side AS v CROSS JOIN warehouse_side AS w

UNION ALL

-- RECON-MKT-COST-RULE --------------------------------------------------------
SELECT
    'RECON-MKT-COST-RULE'::text,
    format('No organic or internal source carries a cost measure: %s rows violate the rule. Cost per '
           'lead, cost per sale and gross return are UNDEFINED for those sources -- a walk-in has no '
           'marketing cost -- so a non-NULL value there would be a false statement, not a rounding '
           'difference.', v.organic_rows_with_cost)::text,
    'reporting.vw_marketing_performance (organic rows carrying a cost measure)'::text,
    v.organic_rows_with_cost,
    'zero violations required'::text,
    0::numeric,
    0::numeric,
    CASE WHEN v.organic_rows_with_cost = 0 THEN 'passed' ELSE 'failed' END::text
FROM view_side AS v;

COMMENT ON VIEW audit.vw_recon_marketing IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'reporting.vw_marketing_performance is the only ARPI view built on a FULL OUTER JOIN -- deliberately, '
    'so the organic tail stays visible -- and a full outer join is also the easiest way to lose or '
    'duplicate a row unnoticed. These rules make that impossible to do silently: spend, attributed leads, '
    'attributed retail units and attributed gross are each reconciled against the warehouse, with the '
    'warehouse side derived independently rather than read back from the same view. RECON-MKT-COST-RULE '
    'asserts that no organic or internal source carries a cost measure, because those measures are '
    'undefined there rather than zero.';
