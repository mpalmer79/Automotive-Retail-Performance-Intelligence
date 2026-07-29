-- =============================================================================
-- File:            sql/08_validation/07_recon_gross.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement RECON-GROSS-001 and RECON-UNITS-001: the row-level gross identity and the retail unit identity.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- RECON-GROSS-001 -- THE ROW-LEVEL GROSS IDENTITY
-- -----------------------------------------------
-- total_gross must equal front_end_gross + back_end_gross on EVERY row, to the
-- cent. This is checked row by row rather than in aggregate on purpose: two
-- offsetting row-level errors sum to a correct total, so an aggregate comparison
-- would pass a fact table that is wrong twice. The rule counts conforming rows
-- against the row count, so the comparison itself is exact (tolerance 0) while the
-- per-row test uses validation.numeric_absolute_tolerance = 0.01, the project-wide
-- currency tolerance. The description carries the largest observed deviation so a
-- reader can see how much headroom the identity actually has.
--
-- A second identity is checked on the same population: front_end_gross must equal
-- sale_price - acquisition_cost - reconditioning_cost - pack_amount. The warehouse
-- enforces both with check constraints, so a failure here means a constraint was
-- dropped -- which is exactly why the reconciliation duplicates the constraint
-- rather than trusting it.
--
-- RECON-UNITS-001 -- THE RETAIL UNIT IDENTITY
-- -------------------------------------------
-- KPI-SLS-002 + KPI-SLS-003 must equal KPI-SLS-001 in every filter context. If the
-- identity fails, a sale type is unmapped. Note that sale_type alone cannot deliver
-- it: 'Lease' is a retail sale type that is neither 'New Retail' nor 'Used Retail',
-- so a split on sale_type strands every lease outside both halves. ARPI takes the
-- split from the VEHICLE's condition, with certified pre-owned counted as used,
-- which is what the catalogue's own text requires and what makes this identity
-- hold. The rule is evaluated per store and day, not just in total, so a
-- compensating error in two stores cannot hide.
--
-- RECON-REPORT-SALES and RECON-REPORT-GROSS
-- -----------------------------------------
-- The reporting layer is what Power BI will read, so "the warehouse is right" is
-- not sufficient evidence: the views over it must agree with it. These two rules
-- compare reporting.vw_sales_summary and reporting.vw_gross_summary totals against
-- the warehouse fact directly. Units are exact; gross uses the 0.01 currency
-- tolerance.

CREATE OR REPLACE VIEW audit.vw_recon_gross AS
WITH row_identity AS (
    SELECT
        count(*)::numeric                                                       AS sale_rows,
        count(*) FILTER (
            WHERE abs(total_gross - (front_end_gross + back_end_gross)) <= 0.01
        )::numeric                                                              AS total_conforming,
        count(*) FILTER (
            WHERE abs(front_end_gross
                      - (sale_price - acquisition_cost - reconditioning_cost - pack_amount)) <= 0.01
        )::numeric                                                              AS front_conforming,
        coalesce(max(abs(total_gross - (front_end_gross + back_end_gross))), 0) AS worst_total_deviation,
        coalesce(max(abs(front_end_gross
                         - (sale_price - acquisition_cost - reconditioning_cost - pack_amount))), 0)
                                                                                AS worst_front_deviation
    FROM warehouse.fact_vehicle_sale
),
unit_identity AS (
    SELECT
        count(*)::numeric                                          AS grain_rows,
        count(*) FILTER (
            WHERE retail_units_sold = new_units_sold + used_units_sold
        )::numeric                                                 AS conforming_rows,
        coalesce(sum(retail_units_sold), 0)::numeric               AS retail_units,
        coalesce(sum(new_units_sold + used_units_sold), 0)::numeric AS split_units
    FROM reporting.vw_sales_summary
),
reported AS (
    SELECT
        (SELECT coalesce(sum(retail_units_sold), 0) FROM reporting.vw_sales_summary)::numeric
                                                                   AS view_retail_units,
        (SELECT coalesce(sum(unit_count), 0) FROM warehouse.fact_vehicle_sale WHERE is_retail)::numeric
                                                                   AS fact_retail_units,
        (SELECT coalesce(sum(total_gross), 0) FROM reporting.vw_gross_summary)
                                                                   AS view_total_gross,
        (SELECT coalesce(sum(total_gross), 0) FROM warehouse.fact_vehicle_sale WHERE is_retail)
                                                                   AS fact_total_gross
)

-- RECON-GROSS-001 (total gross identity) -------------------------------------
SELECT
    'RECON-GROSS-001'::text AS reconciliation_id,
    format('Row-level gross identity: total_gross = front_end_gross + back_end_gross on %s of %s sale '
           'rows, within the 0.01 currency tolerance. Largest observed deviation %s. Checked row by row '
           'because two offsetting row-level errors sum to a correct total.',
           r.total_conforming, r.sale_rows, r.worst_total_deviation)::text AS description,
    'warehouse.fact_vehicle_sale (rows satisfying the identity)'::text AS left_source,
    r.total_conforming AS left_value,
    'warehouse.fact_vehicle_sale (all rows)'::text AS right_source,
    r.sale_rows AS right_value,
    0::numeric AS tolerance,
    CASE WHEN r.total_conforming = r.sale_rows THEN 'passed' ELSE 'failed' END::text AS status
FROM row_identity AS r

UNION ALL

-- RECON-GROSS-001-FRONT (front gross derivation) -----------------------------
SELECT
    'RECON-GROSS-001-FRONT'::text,
    format('Row-level front-gross derivation: front_end_gross = sale_price - acquisition_cost - '
           'reconditioning_cost - pack_amount on %s of %s sale rows, within the 0.01 currency tolerance. '
           'Largest observed deviation %s. Duplicates a warehouse check constraint on purpose, so a '
           'dropped constraint is detected rather than assumed absent.',
           r.front_conforming, r.sale_rows, r.worst_front_deviation)::text,
    'warehouse.fact_vehicle_sale (rows satisfying the derivation)'::text,
    r.front_conforming,
    'warehouse.fact_vehicle_sale (all rows)'::text,
    r.sale_rows,
    0::numeric,
    CASE WHEN r.front_conforming = r.sale_rows THEN 'passed' ELSE 'failed' END::text
FROM row_identity AS r

UNION ALL

-- RECON-UNITS-001 ------------------------------------------------------------
SELECT
    'RECON-UNITS-001'::text,
    format('Retail unit identity: retail units = new units + used units on %s of %s store-day rows '
           '(%s retail against %s split). The split is taken from the vehicle condition, not sale_type, '
           'because a lease is a retail sale type that sale_type alone leaves outside both halves.',
           u.conforming_rows, u.grain_rows, u.retail_units, u.split_units)::text,
    'reporting.vw_sales_summary (store-day rows satisfying the identity)'::text,
    u.conforming_rows,
    'reporting.vw_sales_summary (all store-day rows)'::text,
    u.grain_rows,
    0::numeric,
    CASE WHEN u.conforming_rows = u.grain_rows THEN 'passed' ELSE 'failed' END::text
FROM unit_identity AS u

UNION ALL

-- RECON-REPORT-SALES ---------------------------------------------------------
SELECT
    'RECON-REPORT-SALES'::text,
    format('Reporting retail units equal warehouse retail units (%s against %s). The reporting layer is '
           'what Power BI reads, so a correct warehouse is not sufficient evidence on its own.',
           p.view_retail_units, p.fact_retail_units)::text,
    'reporting.vw_sales_summary'::text,
    p.view_retail_units,
    'warehouse.fact_vehicle_sale'::text,
    p.fact_retail_units,
    0::numeric,
    CASE WHEN p.view_retail_units = p.fact_retail_units THEN 'passed' ELSE 'failed' END::text
FROM reported AS p

UNION ALL

-- RECON-GROSS-002 (SQL side) -------------------------------------------------
SELECT
    'RECON-GROSS-002'::text,
    format('Reporting total gross equals warehouse retail total gross (%s against %s), within the 0.01 '
           'currency tolerance. This is the SQL side of RECON-GROSS-002; the Power BI side follows '
           'Gate 1.', p.view_total_gross, p.fact_total_gross)::text,
    'reporting.vw_gross_summary'::text,
    p.view_total_gross,
    'warehouse.fact_vehicle_sale'::text,
    p.fact_total_gross,
    0.01::numeric,
    CASE WHEN abs(p.view_total_gross - p.fact_total_gross) <= 0.01 THEN 'passed' ELSE 'failed' END::text
FROM reported AS p;

COMMENT ON VIEW audit.vw_recon_gross IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'RECON-GROSS-001 and RECON-GROSS-001-FRONT check the two gross identities ROW BY ROW rather than in '
    'aggregate, because two offsetting row-level errors sum to a correct total; both duplicate a warehouse '
    'check constraint on purpose, so a dropped constraint is detected rather than assumed absent. '
    'RECON-UNITS-001 asserts retail units = new units + used units on every store-day row, not just in '
    'total, so a compensating error across two stores cannot hide. RECON-REPORT-SALES and RECON-GROSS-002 '
    'compare the reporting views against the warehouse fact, because the reporting layer is what Power BI '
    'will read and a correct warehouse is not sufficient evidence on its own. Every comparison here is a '
    'count or an exact total; the only tolerance is 0.01, the project currency tolerance.';
