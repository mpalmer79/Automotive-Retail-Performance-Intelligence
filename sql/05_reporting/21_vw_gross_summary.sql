-- =============================================================================
-- File:            sql/05_reporting/21_vw_gross_summary.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed gross aggregate at store and sale date, owning the SQL side of KPI-GRS-001..006 with numerator and denominator kept separate.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per sale date on which at least one transaction was finalized.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-GRS-001  Front-end gross                front_end_gross
--   KPI-GRS-002  Back-end gross                 back_end_gross
--   KPI-GRS-003  Total gross                    total_gross
--   KPI-GRS-004  Front gross per retail unit    front_end_gross / retail_units_sold
--   KPI-GRS-005  Back gross per retail unit     back_end_gross  / retail_units_sold
--   KPI-GRS-006  Total gross per retail unit    total_gross     / retail_units_sold
--
-- FRONT, BACK AND TOTAL STAY SEPARATE
-- -----------------------------------
-- Combining them too early destroys the diagnosis. A store can hold total gross
-- steady while front gross collapses and F&I compensates, and that is a materially
-- different -- and usually less durable -- business situation from one where both
-- are stable. All three are published, always.
--
-- ONE DENOMINATOR, THREE RATIOS
-- -----------------------------
-- KPI-GRS-004, 005 and 006 share retail_units_sold. That is what makes
-- KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005 an identity, and a failure of that
-- identity means the filter contexts have diverged. Publishing one denominator
-- column rather than three is how the identity is guaranteed instead of hoped for.
--
-- ZERO DENOMINATOR RETURNS NULL
-- -----------------------------
-- Zero units sold means per-unit gross is UNDEFINED, not zero. Rendering $0 in a
-- month with no sales would be a false statement, and a chart must show a gap
-- rather than a zero point. Every ratio here uses nullif on the denominator.
--
-- The three ratios are valid at this view's grain ONLY. A Power BI model must bind
-- to reporting.vw_vehicle_sales and divide in DAX, so the result recomputes at
-- every level of aggregation.
--
-- MODELLING BOUNDARY
-- ------------------
-- Manufacturer incentives, holdback and floorplan credits are EXCLUDED from front
-- gross. New-vehicle front gross in ARPI is therefore systematically understated
-- relative to how a real store would report it. That is a modelling boundary, not
-- a finding, and no reader should be told otherwise.

CREATE OR REPLACE VIEW reporting.vw_gross_summary AS
SELECT
    s.dealership_key                                          AS dealership_key,
    s.sale_date_key                                           AS sale_date_key,

    -- The single shared denominator.
    sum(s.retail_unit_count)::bigint                          AS retail_units_sold,

    -- Additive gross numerators, retail only.
    sum(s.retail_front_end_gross)                             AS front_end_gross,
    sum(s.retail_back_end_gross)                              AS back_end_gross,
    sum(s.retail_total_gross)                                 AS total_gross,

    -- The same three measures over every transaction, so a wholesale-inclusive
    -- variant is available as a separate, separately named figure.
    sum(s.front_end_gross)                                    AS front_end_gross_all_types,
    sum(s.back_end_gross)                                     AS back_end_gross_all_types,
    sum(s.total_gross)                                        AS total_gross_all_types,

    -- Ratios at this view's grain. NULL, never zero, on an empty denominator.
    sum(s.retail_front_end_gross) / nullif(sum(s.retail_unit_count), 0)
                                                              AS front_gross_per_retail_unit,
    sum(s.retail_back_end_gross)  / nullif(sum(s.retail_unit_count), 0)
                                                              AS back_gross_per_retail_unit,
    sum(s.retail_total_gross)     / nullif(sum(s.retail_unit_count), 0)
                                                              AS total_gross_per_retail_unit,

    -- Deal-mix context. A negative-front deal is a real dealership outcome and
    -- must stay visible rather than being averaged away.
    count(*) FILTER (WHERE s.is_retail AND s.front_end_gross < 0)::bigint
                                                              AS negative_front_gross_units
FROM reporting.vw_vehicle_sales AS s
GROUP BY s.dealership_key, s.sale_date_key;

COMMENT ON VIEW reporting.vw_gross_summary IS
    'Grain: one row per dealership per sale date on which at least one transaction was finalized. '
    'Governed SQL owner of KPI-GRS-001..006 and the SQL side of RECON-GROSS-002. Front, back and total '
    'gross are published separately and always: combining them early hides a collapsing front offset by '
    'rising F&I. The three per-unit ratios share ONE denominator column, retail_units_sold, which is what '
    'makes KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005 an identity rather than a coincidence. Every ratio '
    'returns NULL on a zero denominator, because zero units sold means per-unit gross is undefined, not '
    'zero. The ratios are valid at this view''s grain only -- a Power BI model must bind to '
    'reporting.vw_vehicle_sales and divide in DAX. Manufacturer incentives, holdback and floorplan '
    'credits are excluded from front gross, so ARPI new-vehicle front gross is understated by '
    'construction; that is a modelling boundary, not a finding.';

COMMENT ON COLUMN reporting.vw_gross_summary.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_gross_summary.sale_date_key IS 'Sale date, not delivery date. The governed date basis for every measure in this view, identical on numerator and denominator.';
COMMENT ON COLUMN reporting.vw_gross_summary.retail_units_sold IS 'The shared denominator of KPI-GRS-004, 005 and 006. Identical to vw_sales_summary.retail_units_sold; reconciling the ratio alone is insufficient, because two compensating errors produce a correct ratio.';
COMMENT ON COLUMN reporting.vw_gross_summary.front_end_gross IS 'KPI-GRS-001. Retail vehicle profit: sale price less acquisition, reconditioning and pack. Negative values are legitimate and must remain visible, distinguished by more than colour alone.';
COMMENT ON COLUMN reporting.vw_gross_summary.back_end_gross IS 'KPI-GRS-002. Retail finance-office profit. A cash deal with no products contributes 0, not NULL. No product-level detail exists behind this figure in the MVP.';
COMMENT ON COLUMN reporting.vw_gross_summary.total_gross IS 'KPI-GRS-003. front_end_gross + back_end_gross, reconciled to the cent at row level by RECON-GROSS-001.';
COMMENT ON COLUMN reporting.vw_gross_summary.front_end_gross_all_types IS 'Front gross over every transaction including wholesale and dealer trades. A different measure; never the headline figure.';
COMMENT ON COLUMN reporting.vw_gross_summary.back_end_gross_all_types IS 'Back gross over every transaction. A different measure; never the headline figure.';
COMMENT ON COLUMN reporting.vw_gross_summary.total_gross_all_types IS 'Total gross over every transaction. A different measure; never the headline figure.';
COMMENT ON COLUMN reporting.vw_gross_summary.front_gross_per_retail_unit IS 'KPI-GRS-004 at this view''s grain. NULL when no retail unit sold. A rising figure with falling volume is not automatically good.';
COMMENT ON COLUMN reporting.vw_gross_summary.back_gross_per_retail_unit IS 'KPI-GRS-005 at this view''s grain. NULL when no retail unit sold. The denominator includes cash deals, which cannot generate finance reserve, so deal-type mix must be controlled for in any store comparison.';
COMMENT ON COLUMN reporting.vw_gross_summary.total_gross_per_retail_unit IS 'KPI-GRS-006 at this view''s grain. NULL when no retail unit sold. Equals front_gross_per_retail_unit + back_gross_per_retail_unit by construction. The correct counterweight to volume in employee analysis, but still not sufficient alone.';
COMMENT ON COLUMN reporting.vw_gross_summary.negative_front_gross_units IS 'Retail units delivered at a negative front gross. Published so the tail stays visible instead of being averaged away.';
