-- =============================================================================
-- File:            sql/05_reporting/11_vw_vehicle_sales.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Row-grain reporting projection of warehouse.fact_vehicle_sale, with the pre-filtered additive numerators every sales and gross KPI needs.
-- Execution order: Reporting layer, after warehouse.fact_vehicle_sale and warehouse.dim_vehicle exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per finalized vehicle transaction. Identical to warehouse.fact_vehicle_sale; no aggregation, no filtering.
-- =============================================================================
--
-- KPIs OWNED (row-level inputs)
-- -----------------------------
--   KPI-SLS-001  Retail units sold              SUM(retail_unit_count)
--   KPI-SLS-002  New units sold                 SUM(new_unit_count)
--   KPI-SLS-003  Used units sold                SUM(used_unit_count)
--   KPI-GRS-001  Front-end gross                SUM(retail_front_end_gross)
--   KPI-GRS-002  Back-end gross                 SUM(retail_back_end_gross)
--   KPI-GRS-003  Total gross                    SUM(retail_total_gross)
--   KPI-GRS-004  Front gross per retail unit    SUM(retail_front_end_gross) / SUM(retail_unit_count)
--   KPI-GRS-005  Back gross per retail unit     SUM(retail_back_end_gross)  / SUM(retail_unit_count)
--   KPI-GRS-006  Total gross per retail unit    SUM(retail_total_gross)     / SUM(retail_unit_count)
--   KPI-INV-007  Days to sale                   median of retail_days_in_inventory;
--                                               mean = SUM(retail_days_in_inventory_total)
--                                                      / SUM(retail_unit_count)
--   KPI-INV-008  Inventory turn (numerator)     SUM(retail_unit_count), annualized
--   KPI-INV-009  Dealer days supply (denominator)
--   KPI-MKT-002, KPI-MKT-003 (attributed sales and gross, through lead_source_key)
--
-- WHY PRE-FILTERED ADDITIVE COLUMNS
-- ---------------------------------
-- Every headline sales and gross measure is retail-only, and three of them are
-- ratios that share one denominator. If the view published only `unit_count` and
-- `total_gross`, each measure would have to re-apply `is_retail = true` in DAX, and
-- the classic failure mode -- numerator filtered, denominator not -- becomes one
-- forgotten CALCULATE away. Publishing `retail_unit_count`, `retail_total_gross`
-- and their siblings as columns that are ZERO on a non-retail row makes every one
-- of those measures a plain SUM that is additive under any filter context, and
-- makes numerator and denominator structurally impossible to diverge.
--
-- No ratio is computed here. The division belongs in DAX so it recomputes at every
-- level of aggregation; the governed period-grain ratios live in
-- reporting.vw_gross_summary for SQL and Excel consumers.
--
-- THE NEW/USED SPLIT AND THE UNIT IDENTITY
-- ----------------------------------------
-- KPI_CATALOG.md requires `KPI-SLS-002 + KPI-SLS-003 = KPI-SLS-001` in every filter
-- context (RECON-UNITS-001). `sale_type` alone cannot deliver that: `Lease` is a
-- retail sale type that is neither 'New Retail' nor 'Used Retail', so classifying on
-- sale_type alone strands every lease outside both halves of the identity. The
-- catalogue's own text resolves it -- KPI-SLS-002 counts "retail and lease
-- deliveries of new vehicles" and excludes "leases of used units" -- so the split is
-- taken from the VEHICLE's condition, with a certified pre-owned unit counted as
-- used. That is what makes the identity hold to the unit.
--
-- ROLE-PLAYING DATES
-- ------------------
-- sale_date_key and delivery_date_key are both exposed. The sale date is the
-- governed date basis for every sales and gross KPI; delivery-date reporting is a
-- separate, separately labelled measure. The semantic model relates BOTH to
-- reporting.vw_calendar -- one active relationship on sale_date_key, one inactive
-- on delivery_date_key -- rather than duplicating the calendar view.

CREATE OR REPLACE VIEW reporting.vw_vehicle_sales AS
SELECT
    s.sale_key                                                        AS sale_key,
    s.sale_id                                                         AS sale_code,

    -- Role-playing date keys, exposed explicitly.
    s.sale_date_key                                                   AS sale_date_key,
    s.delivery_date_key                                               AS delivery_date_key,

    -- Relationship keys.
    s.dealership_key                                                  AS dealership_key,
    s.vehicle_key                                                     AS vehicle_key,
    v.vehicle_model_key                                               AS vehicle_model_key,
    s.customer_key                                                    AS customer_key,
    s.salesperson_key                                                 AS salesperson_key,
    s.desk_manager_key                                                AS desk_manager_key,
    s.finance_manager_key                                             AS finance_manager_key,
    s.lead_source_key                                                 AS lead_source_key,

    -- Descriptive attributes.
    s.sale_type                                                       AS sale_type,
    s.is_retail                                                       AS is_retail,
    CASE WHEN v.condition_type = 'New' THEN 'New' ELSE 'Used' END     AS condition_group,
    v.condition_type                                                  AS vehicle_condition_type,

    -- Additive unit measures. Zero on rows the measure excludes, so every one of
    -- these is a plain SUM that stays correct under any filter context.
    s.unit_count                                                      AS unit_count,
    CASE WHEN s.is_retail THEN s.unit_count ELSE 0 END::smallint       AS retail_unit_count,
    CASE WHEN s.is_retail AND v.condition_type = 'New'
         THEN s.unit_count ELSE 0 END::smallint                       AS new_unit_count,
    CASE WHEN s.is_retail AND v.condition_type <> 'New'
         THEN s.unit_count ELSE 0 END::smallint                       AS used_unit_count,
    CASE WHEN s.sale_type = 'Wholesale' THEN s.unit_count ELSE 0 END::smallint
                                                                      AS wholesale_unit_count,
    CASE WHEN s.sale_type = 'Dealer Trade' THEN s.unit_count ELSE 0 END::smallint
                                                                      AS dealer_trade_unit_count,

    -- Price and cost, at row level.
    s.sale_price                                                      AS sale_price,
    s.msrp                                                            AS msrp,
    s.original_asking_price                                           AS original_asking_price,
    s.final_asking_price                                              AS final_asking_price,
    s.acquisition_cost                                                AS acquisition_cost,
    s.reconditioning_cost                                             AS reconditioning_cost,
    s.pack_amount                                                     AS pack_amount,

    -- Gross, unfiltered and retail-only. The retail_* columns are the numerators of
    -- KPI-GRS-001..006; the unfiltered columns exist so a wholesale-inclusive
    -- variant can be built as a separate, separately named measure.
    s.front_end_gross                                                 AS front_end_gross,
    s.back_end_gross                                                  AS back_end_gross,
    s.total_gross                                                     AS total_gross,
    CASE WHEN s.is_retail THEN s.front_end_gross ELSE 0 END           AS retail_front_end_gross,
    CASE WHEN s.is_retail THEN s.back_end_gross  ELSE 0 END           AS retail_back_end_gross,
    CASE WHEN s.is_retail THEN s.total_gross     ELSE 0 END           AS retail_total_gross,

    -- Trade and finance structure.
    s.trade_allowance                                                 AS trade_allowance,
    s.trade_acv                                                       AS trade_acv,
    s.cash_down                                                       AS cash_down,
    s.amount_financed                                                 AS amount_financed,

    -- Days to sale. The row-level value is exposed so the MEDIAN can be recomputed
    -- under filter context; the retail-only column is the additive mean numerator.
    s.days_in_inventory_at_sale                                       AS days_in_inventory_at_sale,
    CASE WHEN s.is_retail THEN s.days_in_inventory_at_sale ELSE NULL END
                                                                      AS retail_days_in_inventory,
    CASE WHEN s.is_retail THEN s.days_in_inventory_at_sale ELSE 0 END
                                                                      AS retail_days_in_inventory_total,

    s.source_system                                                   AS source_system
FROM warehouse.fact_vehicle_sale AS s
JOIN warehouse.dim_vehicle AS v
       ON v.vehicle_key = s.vehicle_key;

COMMENT ON VIEW reporting.vw_vehicle_sales IS
    'Grain: one row per finalized vehicle transaction -- identical to warehouse.fact_vehicle_sale, with no '
    'aggregation and no filtering. Fact table for the semantic model. Owns the row-level inputs to '
    'KPI-SLS-001..003, KPI-GRS-001..006, KPI-INV-007, the KPI-INV-008 numerator, the KPI-INV-009 '
    'denominator and the KPI-MKT-002/003 attributed measures. Retail-only numerators are published as '
    'columns that are zero on excluded rows, so each measure is a plain additive SUM and numerator and '
    'denominator cannot diverge. new_unit_count and used_unit_count split on the VEHICLE condition, not on '
    'sale_type, because a lease is a retail sale type that sale_type alone leaves outside both halves of '
    'the RECON-UNITS-001 identity; a certified pre-owned unit is a used unit. No ratio is materialised: '
    'divide in DAX so the result recomputes at every level. Role-playing dates sale_date_key and '
    'delivery_date_key both relate to vw_calendar -- one active, one inactive -- never by duplicating the '
    'calendar. Surrogate keys should be hidden in the semantic model.';

COMMENT ON COLUMN reporting.vw_vehicle_sales.sale_key IS 'Warehouse surrogate key of the transaction. Relationship column for vw_leads and vw_appointments; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.sale_code IS 'Stable business identifier of the transaction.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.sale_date_key IS 'Role-playing date key: the date the deal was finalized. The governed date basis for every sales and gross KPI. Active relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.delivery_date_key IS 'Role-playing date key: the date the vehicle was delivered. Inactive relationship to vw_calendar; any delivery-basis measure must be labelled as such.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.vehicle_key IS 'Vehicle surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.vehicle_model_key IS 'Model-line surrogate key, resolved through the vehicle. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.customer_key IS 'Customer surrogate key. NULL on wholesale and dealer-trade rows, which have no retail customer.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.salesperson_key IS 'Role-playing employee key: the selling salesperson.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.desk_manager_key IS 'Role-playing employee key: the desk manager on the deal.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.finance_manager_key IS 'Role-playing employee key: the finance manager on the deal.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.lead_source_key IS 'Lead source credited with the deal, single-source first-touch. NULL where no source was recorded.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.sale_type IS 'New Retail, Used Retail, Certified Retail, Lease, Wholesale or Dealer Trade.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.is_retail IS 'True for a retail or lease delivery. False for wholesale and dealer trades, which are not retail units.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.condition_group IS 'Governed new/used split taken from the vehicle. A certified pre-owned unit is Used.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.vehicle_condition_type IS 'New, Used or Certified as recorded on the vehicle.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.unit_count IS 'Always 1. Additive unit measure over every transaction, retail or not.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_unit_count IS 'KPI-SLS-001 numerator, and the shared denominator of KPI-GRS-004/005/006 and the KPI-INV-007 mean. 1 on a retail row, 0 otherwise.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.new_unit_count IS 'KPI-SLS-002 numerator. 1 on a retail delivery of a new vehicle, 0 otherwise. Includes leases of new vehicles.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.used_unit_count IS 'KPI-SLS-003 numerator. 1 on a retail delivery of a used or certified vehicle, 0 otherwise. Includes leases of used vehicles.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.wholesale_unit_count IS 'Wholesale disposals. Never part of a retail measure; published so wholesale volume can be read beside the aged-inventory percentage it moves.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.dealer_trade_unit_count IS 'Dealer trades. Never part of a retail measure.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.sale_price IS 'Final selling price of the vehicle.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.msrp IS 'Manufacturer suggested retail price where one applies, otherwise NULL.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.original_asking_price IS 'First advertised price.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.final_asking_price IS 'Advertised price at the time of sale.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.acquisition_cost IS 'What the unit cost to acquire.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.reconditioning_cost IS 'What the unit cost to recondition.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.pack_amount IS 'Internal pack applied to the deal.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.front_end_gross IS 'Vehicle profit on every transaction: sale_price less acquisition, reconditioning and pack. May legitimately be negative.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.back_end_gross IS 'Finance-office profit on every transaction.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.total_gross IS 'front_end_gross + back_end_gross on every transaction. Reconciled to the cent by RECON-GROSS-001.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_front_end_gross IS 'KPI-GRS-001 numerator. Equals front_end_gross on a retail row, 0 otherwise. Negative values are legitimate and must stay visible.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_back_end_gross IS 'KPI-GRS-002 numerator. Equals back_end_gross on a retail row, 0 otherwise.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_total_gross IS 'KPI-GRS-003 numerator and the KPI-MKT-003 attributed-gross numerator. Equals total_gross on a retail row, 0 otherwise.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.trade_allowance IS 'Allowance granted on the trade-in.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.trade_acv IS 'Actual cash value of the trade-in.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.cash_down IS 'Cash down payment.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.amount_financed IS 'Amount financed.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.days_in_inventory_at_sale IS 'Calendar days between acquisition and sale, on every transaction.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_days_in_inventory IS 'KPI-INV-007 median population: days in inventory on a retail row, NULL otherwise, so a non-retail row is excluded from the order statistic rather than pulling it towards zero.';
COMMENT ON COLUMN reporting.vw_vehicle_sales.retail_days_in_inventory_total IS 'KPI-INV-007 mean numerator: days in inventory on a retail row, 0 otherwise, so the mean is SUM(this) / SUM(retail_unit_count).';
COMMENT ON COLUMN reporting.vw_vehicle_sales.source_system IS 'Originating system. Present so no reader mistakes this for real transaction data.';
