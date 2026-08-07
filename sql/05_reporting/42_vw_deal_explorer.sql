-- =============================================================================
-- File:            sql/05_reporting/42_vw_deal_explorer.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Compact, public-safe, deal-grain projection over finalized vehicle sales, for the console's Deal Explorer index.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales, reporting.vw_calendar, reporting.vw_vehicle and reporting.vw_vehicle_model exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per finalized vehicle transaction. Identical to warehouse.fact_vehicle_sale.
-- =============================================================================
--
-- WHAT THIS VIEW IS FOR
-- ---------------------
-- The Deal Explorer index: a management deal log a GSM scans, searches and sorts to
-- find the transactions behind an aggregate. It is deliberately COMPACT. The full
-- transaction record is reporting.vw_deal_jacket, and duplicating its cost, trade and
-- finance columns here would put the whole deal population into the index payload to
-- serve a list that shows a dozen fields.
--
-- BUSINESS KEY, NEVER THE SURROGATE
-- ---------------------------------
-- sale_id (SLE-########) is the identifier this view publishes and the console routes
-- on. sale_key is a warehouse implementation detail: it is not exported, not routable,
-- and not present in this view at all. A URL that carried it would leak the load order
-- of the warehouse and would break the moment the fact were rebuilt.
--
-- THE GRAIN SURVIVES EVERY JOIN
-- -----------------------------
-- Four joins resolve surrogate keys to business attributes, and each is one-to-one or
-- one-to-none on a unique key:
--   vw_vehicle / vw_vehicle_model  unique on their own keys, no filter
--   dim_employee                   unique on employee_key; joined three times for the
--                                  three deal roles, LEFT so an unattributed role is
--                                  absence rather than a lost deal
--   fact_lead                      LEFT, on sale_key
-- The lead join is the only one that could widen the grain, and it cannot here: a sale
-- carries at most one lead. The integration suite asserts the row count equals the
-- fact's, that sale_id is unique, and that the lead relationship is still at most one
-- per sale rather than trusting that it stays that way.
--
-- LEAD SOURCE COMES FROM THE LINKED LEAD, NOT FROM THE SALE
-- ---------------------------------------------------------
-- warehouse.fact_vehicle_sale HAS a lead_source_key column, and the generator never
-- populates it -- it is NULL on every one of the development profile's transactions.
-- Reading it would have made every deal in the console read "no source recorded",
-- which is a statement about a column that was never filled rather than about the
-- business.
--
-- The real linkage runs the other way: fact_lead.sale_key points at the deal the lead
-- produced, and the lead carries the source. So attribution here is resolved through
-- the linked lead. 400 of the profile's 650 transactions have one; the remaining 250
-- are genuinely unattributed walk-in business, and is_lead_attributed says which is
-- which rather than leaving a reader to guess whether NULL means walk-in or means
-- broken.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
--   * customer_key and every customer attribute. The deal lane is public; the customer
--     dimension is not exported at any grain, in any form, banded or otherwise.
--   * Employee names. Roles are published as synthetic employee codes only.
--   * Acquisition cost, reconditioning, pack, trade and finance amounts. Those are the
--     Deal Jacket's, and an index that carried them would ship the whole deal
--     population's cost structure to render a list.
--   * A stock number. The model has no such column -- warehouse.dim_vehicle publishes
--     vehicle_id (VEH-#######) and a synthetic VIN, and no separate stock number
--     exists. vehicle_code is the identifier a user searches on, and the console labels
--     it for what it is rather than captioning it "stock number" and inventing a
--     dealership artefact the data does not contain.

CREATE OR REPLACE VIEW reporting.vw_deal_explorer AS
SELECT
    -- Identity ----------------------------------------------------------------
    s.sale_code                                               AS sale_id,
    sd.calendar_date                                          AS sale_date,
    dd.calendar_date                                          AS delivery_date,
    sd.month_start_date                                       AS sale_month_start_date,

    -- Store -------------------------------------------------------------------
    s.dealership_key                                          AS dealership_key,

    -- Vehicle -----------------------------------------------------------------
    v.vehicle_code                                            AS vehicle_code,
    m.model_year                                              AS model_year,
    m.make                                                    AS make,
    m.model_name                                              AS model_name,
    m.trim_level                                              AS trim_level,
    m.model_label                                             AS vehicle_display,
    m.body_style                                              AS body_style,
    v.condition_type                                          AS condition_type,
    v.condition_group                                         AS condition_group,

    -- Transaction shape -------------------------------------------------------
    s.sale_type                                               AS sale_type,
    s.is_retail                                               AS is_retail,

    -- Price. Cost is deliberately absent; the gross figures below are the export's
    -- governed outputs and cannot be decomposed back into cost from this view.
    s.sale_price                                              AS sale_price,
    s.msrp                                                    AS msrp,
    s.original_asking_price                                   AS original_asking_price,
    s.final_asking_price                                      AS final_asking_price,

    -- Gross, as stored on the fact and CHECK-constrained there.
    s.front_end_gross                                         AS front_end_gross,
    s.back_end_gross                                          AS back_end_gross,
    s.total_gross                                             AS total_gross,
    (s.front_end_gross < 0)                                   AS is_negative_front_gross,

    -- Inventory context -------------------------------------------------------
    s.days_in_inventory_at_sale                               AS days_in_inventory_at_sale,

    -- Trade presence, not trade economics. The amounts are the Deal Jacket's.
    (s.trade_allowance > 0 OR s.trade_acv > 0)                AS has_trade,

    -- Attribution, resolved through the linked lead ---------------------------
    (l.lead_key IS NOT NULL)                                  AS is_lead_attributed,
    ls.lead_source_code                                       AS lead_source_code,
    ls.lead_source_name                                       AS lead_source_name,

    -- Staff, as synthetic codes only. NULL means the role was not attributed.
    sp.employee_id                                            AS salesperson_code,
    dm.employee_id                                            AS desk_manager_code,
    fm.employee_id                                            AS finance_manager_code
FROM reporting.vw_vehicle_sales AS s
JOIN reporting.vw_calendar AS sd
       ON sd.date_key = s.sale_date_key
JOIN reporting.vw_calendar AS dd
       ON dd.date_key = s.delivery_date_key
JOIN reporting.vw_vehicle AS v
       ON v.vehicle_key = s.vehicle_key
JOIN reporting.vw_vehicle_model AS m
       ON m.vehicle_model_key = s.vehicle_model_key
LEFT JOIN warehouse.dim_employee AS sp
       ON sp.employee_key = s.salesperson_key
LEFT JOIN warehouse.dim_employee AS dm
       ON dm.employee_key = s.desk_manager_key
LEFT JOIN warehouse.dim_employee AS fm
       ON fm.employee_key = s.finance_manager_key
LEFT JOIN warehouse.fact_lead AS l
       ON l.sale_key = s.sale_key
LEFT JOIN reporting.vw_lead_source AS ls
       ON ls.lead_source_key = l.lead_source_key;

COMMENT ON VIEW reporting.vw_deal_explorer IS
    'Grain: one row per finalized vehicle transaction -- identical to warehouse.fact_vehicle_sale, no '
    'aggregation and no filtering. Date basis: sale date, with delivery date exposed as a separate labelled '
    'column. The console''s Deal Explorer index: a management deal log, deliberately COMPACT, because the '
    'full transaction record is reporting.vw_deal_jacket and duplicating its cost, trade and finance '
    'columns here would ship the whole deal population''s cost structure to render a list. Identity is the '
    'business key sale_id (SLE-########); sale_key is absent entirely, because a URL carrying it would leak '
    'warehouse load order and break when the fact is rebuilt. GRAIN SURVIVES EVERY JOIN: vehicle, model, '
    'three employee roles and the linked lead all resolve one-to-one or one-to-none on unique keys, and the '
    'lead -- the only join that could widen the grain -- carries at most one row per sale; the integration '
    'suite asserts row count, sale_id uniqueness and the lead cardinality rather than trusting them. LEAD '
    'SOURCE COMES FROM THE LINKED LEAD: fact_vehicle_sale.lead_source_key exists and the generator never '
    'populates it, so reading it would report "no source recorded" on every deal -- a statement about an '
    'unfilled column, not about the business. fact_lead.sale_key is the real linkage; is_lead_attributed '
    'distinguishes genuine walk-in business from missing data. DELIBERATELY ABSENT: every customer '
    'attribute (the customer dimension is not exported at any grain, banded or otherwise), employee names '
    '(roles are synthetic codes only), all cost and finance amounts, and a stock number -- the model has no '
    'such column, so vehicle_code is published as itself rather than captioned as a dealership artefact the '
    'data does not contain. Export-eligible: yes, as dashboard dataset deal-explorer, chunked by store and '
    'sale month.';

COMMENT ON COLUMN reporting.vw_deal_explorer.sale_id IS 'Stable business identifier of the transaction, SLE-########. The route parameter of the Deal Jacket and the only identity this view publishes.';
COMMENT ON COLUMN reporting.vw_deal_explorer.sale_date IS 'Calendar date the deal was finalized. The governed date basis, and the chunking date.';
COMMENT ON COLUMN reporting.vw_deal_explorer.delivery_date IS 'Calendar date the vehicle was delivered. A separate date role; never silently substituted for the sale date.';
COMMENT ON COLUMN reporting.vw_deal_explorer.sale_month_start_date IS 'First day of the sale month. Published so the export partitions by a stored value rather than by a date function applied downstream.';
COMMENT ON COLUMN reporting.vw_deal_explorer.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model. Resolved to the GSA-00# business code by the dashboard export.';
COMMENT ON COLUMN reporting.vw_deal_explorer.vehicle_code IS 'Synthetic vehicle identifier, VEH-#######. The searchable unit identifier. NOT a stock number: the model contains no stock number, and this column is not captioned as one.';
COMMENT ON COLUMN reporting.vw_deal_explorer.model_year IS 'Model year of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_explorer.make IS 'Make of the unit sold. Searchable.';
COMMENT ON COLUMN reporting.vw_deal_explorer.model_name IS 'Model of the unit sold. Searchable.';
COMMENT ON COLUMN reporting.vw_deal_explorer.trim_level IS 'Trim of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_explorer.vehicle_display IS 'Year, make, model and trim as one string, published so every consumer renders the unit identically.';
COMMENT ON COLUMN reporting.vw_deal_explorer.body_style IS 'Body style of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_explorer.condition_type IS 'New, Used or Certified as recorded on the vehicle.';
COMMENT ON COLUMN reporting.vw_deal_explorer.condition_group IS 'Governed new/used split taken from the vehicle. A certified pre-owned unit is Used.';
COMMENT ON COLUMN reporting.vw_deal_explorer.sale_type IS 'New Retail, Used Retail, Certified Retail, Lease, Wholesale or Dealer Trade.';
COMMENT ON COLUMN reporting.vw_deal_explorer.is_retail IS 'True for a retail or lease delivery. False for wholesale and dealer trades, which are not retail units and must not be judged by retail-only measures.';
COMMENT ON COLUMN reporting.vw_deal_explorer.sale_price IS 'Final selling price of the vehicle.';
COMMENT ON COLUMN reporting.vw_deal_explorer.msrp IS 'Manufacturer suggested retail price where one applies, otherwise NULL. NULL means not applicable -- a used unit legitimately has none -- and must never be rendered as zero.';
COMMENT ON COLUMN reporting.vw_deal_explorer.original_asking_price IS 'First advertised price of the unit.';
COMMENT ON COLUMN reporting.vw_deal_explorer.final_asking_price IS 'Advertised price at the time of sale.';
COMMENT ON COLUMN reporting.vw_deal_explorer.front_end_gross IS 'KPI-GRS-001 at deal grain: sale price less acquisition, reconditioning and pack, as stored and CHECK-constrained on the fact. Legitimately negative on a real deal, and never suppressed.';
COMMENT ON COLUMN reporting.vw_deal_explorer.back_end_gross IS 'KPI-GRS-002 at deal grain. Aggregate finance-office profit; product itemization arrives with the F&I model.';
COMMENT ON COLUMN reporting.vw_deal_explorer.total_gross IS 'KPI-GRS-003 at deal grain: front_end_gross + back_end_gross, reconciled to the cent by RECON-GROSS-001.';
COMMENT ON COLUMN reporting.vw_deal_explorer.is_negative_front_gross IS 'True when the deal closed at a front-end loss. Published so the index can filter and count them without re-deriving the comparison.';
COMMENT ON COLUMN reporting.vw_deal_explorer.days_in_inventory_at_sale IS 'Calendar days between acquisition and sale. Non-additive: average it, never sum it.';
COMMENT ON COLUMN reporting.vw_deal_explorer.has_trade IS 'True when the deal carried a trade-in, judged by a non-zero allowance or actual cash value. Trade economics are the Deal Jacket''s; this column only says whether the section applies.';
COMMENT ON COLUMN reporting.vw_deal_explorer.is_lead_attributed IS 'True when a CRM lead links to this deal. False is genuine walk-in or unattributed business, not missing data, and the two must not be collapsed.';
COMMENT ON COLUMN reporting.vw_deal_explorer.lead_source_code IS 'Source of the linked lead, resolved through fact_lead rather than through the sale fact''s own never-populated lead_source_key. NULL when no lead links to the deal.';
COMMENT ON COLUMN reporting.vw_deal_explorer.lead_source_name IS 'Display name of the linked lead''s source. NULL when no lead links to the deal.';
COMMENT ON COLUMN reporting.vw_deal_explorer.salesperson_code IS 'Synthetic employee identifier of the selling salesperson. No name is published. NULL means the role was not attributed.';
COMMENT ON COLUMN reporting.vw_deal_explorer.desk_manager_code IS 'Synthetic employee identifier of the desk manager. No name is published. NULL means the role was not attributed.';
COMMENT ON COLUMN reporting.vw_deal_explorer.finance_manager_code IS 'Synthetic employee identifier of the finance manager. No name is published. NULL means the role was not attributed.';
