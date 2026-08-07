-- =============================================================================
-- File:            sql/05_reporting/43_vw_deal_jacket.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         The sanitized, presentation-complete record of one finalized vehicle transaction, for the console's Deal Jacket route.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales, reporting.vw_calendar, reporting.vw_vehicle and reporting.vw_vehicle_model exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per finalized vehicle transaction. Identical to warehouse.fact_vehicle_sale.
-- =============================================================================
--
-- WHAT THIS VIEW IS FOR
-- ---------------------
-- One deal, explained to the cent. Where reporting.vw_deal_explorer is a compact
-- INDEX -- what a manager scans to find a transaction -- this is the RECORD they open
-- when they have found it: the cost components behind the front gross, the trade
-- context, the finance amounts, the people, the lead's paper trail, and enough
-- supporting fact for the page to verify its own arithmetic.
--
-- It is a record view, not a workflow. Nothing here can be edited, assigned,
-- approved, submitted, repriced, funded or contracted, and no column exists that
-- such an action would write to.
--
-- THE GRAIN SURVIVES SEVEN JOINS, AND THAT IS ASSERTED
-- -----------------------------------------------------
-- vehicle and model         one-to-one on unique keys, unfiltered
-- three employee roles      LEFT on employee_key, unique; absence is absence
-- the linked lead           LEFT on sale_key; at most one lead per sale
-- the linked appointment    LEFT on sale_key; at most one appointment per sale
--
-- The last two are the only joins that could widen the grain. Both are asserted in
-- tests/integration/test_dashboard_reporting_views.py rather than assumed, because
-- the day the generator links a second lead to a deal is the day this view starts
-- duplicating that deal, and a duplicated Deal Jacket is a page that shows a
-- transaction twice with no indication that it has.
--
-- FINANCE STRUCTURE IS DERIVED, AND THE DERIVATION IS THE WHOLE DEFINITION
-- ------------------------------------------------------------------------
-- ARPI models no lender, no rate and no term until DASH.6. What it does model is
-- sale_type and amount_financed, and those two settle the only structural question
-- the jacket asks:
--
--   sale_type = 'Lease'      -> Lease
--   amount_financed = 0      -> Cash
--   otherwise                -> Retail Finance
--
-- That is the entire derivation, it is published as a column rather than left to a
-- consumer, and finance_structure_basis records it in the row so a reader can see
-- what the label was decided from. Nothing further is inferred: a Cash deal shows no
-- lender because no lender exists, not because one is hidden.
--
-- WHAT IS NOT MODELLED, AND SAYS SO
-- ---------------------------------
-- Several things a real deal jacket carries do not exist in this warehouse, and the
-- view publishes a flag for each rather than a plausible zero, so the page can render
-- "Not modelled" from data instead of from a hard-coded sentence:
--
--   trade payoff and equity          no trade fact exists (DASH.O-1)
--   lender, APR, term, payment       no finance dimension exists (DASH.6)
--   F&I product itemization          no product fact exists (DASH.7)
--   acquisition date                 dim_vehicle records no acquisition date;
--                                    days_in_inventory_at_sale is what exists
--   stock number                     the model contains none; vehicle_code is the
--                                    unit identifier and is not captioned as one
--
-- These are declared in the column comments and in DATA_CONTRACT.md, and the console
-- renders them as absences with reasons.
--
-- SUPPORTING FACT FOR THE PAGE'S OWN CHECKS
-- -----------------------------------------
-- DEAL_JACKET_SPEC.md section 12 requires the route to show a checklist of integrity
-- checks. Three of them need a fact the deal row does not otherwise carry, so the
-- view supplies each as a column rather than making the page ask a second question:
-- delivery_on_or_after_sale, sale_date_in_reporting_window, and
-- inventory_snapshot_count (the unit was on the ground before it was sold). The page
-- still recomputes the two ARITHMETIC identities itself from the displayed
-- components, because a verification that reads a flag verifies nothing.

CREATE OR REPLACE VIEW reporting.vw_deal_jacket AS
SELECT
    -- Identity ----------------------------------------------------------------
    s.sale_code                                               AS sale_id,
    sd.calendar_date                                          AS sale_date,
    dd.calendar_date                                          AS delivery_date,
    sd.month_start_date                                       AS sale_month_start_date,
    s.dealership_key                                          AS dealership_key,
    s.sale_type                                               AS sale_type,
    s.is_retail                                               AS is_retail,

    -- Finance structure, derived. The basis is published beside the label.
    CASE
        WHEN s.sale_type = 'Lease' THEN 'Lease'
        WHEN s.amount_financed = 0 THEN 'Cash'
        ELSE 'Retail Finance'
    END                                                       AS finance_structure,
    CASE
        WHEN s.sale_type = 'Lease' THEN 'sale type is Lease'
        WHEN s.amount_financed = 0 THEN 'nothing was financed'
        ELSE 'an amount was financed'
    END                                                       AS finance_structure_basis,

    -- Vehicle -----------------------------------------------------------------
    v.vehicle_code                                            AS vehicle_code,
    v.synthetic_vin                                           AS synthetic_vin,
    m.model_year                                              AS model_year,
    m.make                                                    AS make,
    m.model_name                                              AS model_name,
    m.trim_level                                              AS trim_level,
    m.model_label                                             AS vehicle_display,
    m.body_style                                              AS body_style,
    v.condition_type                                          AS condition_type,
    v.condition_group                                         AS condition_group,
    v.odometer_band                                           AS odometer_band,
    v.acquisition_source                                      AS acquisition_source,
    s.days_in_inventory_at_sale                               AS days_in_inventory_at_sale,

    -- Price -------------------------------------------------------------------
    s.sale_price                                              AS sale_price,
    s.msrp                                                    AS msrp,
    s.original_asking_price                                   AS original_asking_price,
    s.final_asking_price                                      AS final_asking_price,

    -- The front-gross components, in the order the formula states them ---------
    s.acquisition_cost                                        AS acquisition_cost,
    s.reconditioning_cost                                     AS reconditioning_cost,
    s.pack_amount                                             AS pack_amount,
    s.front_end_gross                                         AS front_end_gross,

    -- Discounts. Exact subtractions of exported columns, published so every
    -- consumer computes them identically. NULL against a price that does not exist.
    (s.original_asking_price - s.sale_price)                  AS discount_from_original,
    (s.final_asking_price - s.sale_price)                     AS discount_from_final,
    CASE WHEN s.msrp IS NOT NULL THEN s.msrp - s.sale_price END
                                                              AS discount_from_msrp,

    -- Trade. Variance is allowance less actual cash value and is NOT part of the
    -- ARPI front-gross formula; it is published separately for exactly that reason.
    (s.trade_allowance > 0 OR s.trade_acv > 0)                AS has_trade,
    s.trade_allowance                                         AS trade_allowance,
    s.trade_acv                                               AS trade_acv,
    (s.trade_allowance - s.trade_acv)                         AS trade_variance,

    -- Finance amounts. No rate, no term, no payment, no lender: none is modelled.
    s.cash_down                                               AS cash_down,
    s.amount_financed                                         AS amount_financed,

    -- Gross ------------------------------------------------------------------
    s.back_end_gross                                          AS back_end_gross,
    s.total_gross                                             AS total_gross,

    -- Staff, as synthetic codes with their roles. No name is published anywhere.
    sp.employee_id                                            AS salesperson_code,
    sp.job_role                                               AS salesperson_role,
    dm.employee_id                                            AS desk_manager_code,
    dm.job_role                                               AS desk_manager_role,
    fm.employee_id                                            AS finance_manager_code,
    fm.job_role                                               AS finance_manager_role,
    bdc.employee_id                                           AS bdc_employee_code,

    -- The lead's paper trail. Flags only: no message, note, email or free text
    -- exists in fact_lead, and none is created here.
    (l.lead_key IS NOT NULL)                                  AS is_lead_attributed,
    l.lead_id                                                 AS lead_id,
    ld.calendar_date                                          AS lead_created_date,
    ls.lead_source_code                                       AS lead_source_code,
    ls.lead_source_name                                       AS lead_source_name,
    l.first_response_seconds                                  AS first_response_seconds,
    l.is_contacted                                            AS lead_contacted,
    l.is_appointment_set                                      AS lead_appointment_set,
    l.days_to_sale                                            AS lead_days_to_sale,

    -- The appointment, where one links. is_test_drive and is_write_up are real
    -- modelled flags, so those two timeline stages are shown rather than declared
    -- unavailable.
    (a.appointment_key IS NOT NULL)                           AS has_appointment,
    a.appointment_id                                          AS appointment_id,
    ac.calendar_date                                          AS appointment_scheduled_date,
    ash.calendar_date                                         AS appointment_show_date,
    a.is_shown                                                AS appointment_shown,
    a.is_test_drive                                           AS appointment_test_drive,
    a.is_write_up                                             AS appointment_write_up,

    -- Supporting fact for the page's integrity checklist ----------------------
    (dd.calendar_date >= sd.calendar_date)                    AS delivery_on_or_after_sale,
    (
        SELECT count(*)
        FROM warehouse.fact_vehicle_inventory_snapshot AS i
        WHERE i.vehicle_key = s.vehicle_key
    )::bigint                                                 AS inventory_snapshot_count,

    s.source_system                                           AS source_system
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
       ON ls.lead_source_key = l.lead_source_key
LEFT JOIN reporting.vw_calendar AS ld
       ON ld.date_key = l.lead_created_date_key
LEFT JOIN warehouse.fact_appointment AS a
       ON a.sale_key = s.sale_key
LEFT JOIN warehouse.dim_employee AS bdc
       ON bdc.employee_key = a.bdc_employee_key
LEFT JOIN reporting.vw_calendar AS ac
       ON ac.date_key = a.scheduled_date_key
LEFT JOIN reporting.vw_calendar AS ash
       ON ash.date_key = a.show_date_key;

COMMENT ON VIEW reporting.vw_deal_jacket IS
    'Grain: one row per finalized vehicle transaction -- identical to warehouse.fact_vehicle_sale, no '
    'aggregation and no filtering. Date basis: sale date, with delivery date, lead-created date and '
    'appointment dates exposed as separate labelled columns. The sanitized, presentation-complete record of '
    'ONE deal, for the console''s Deal Jacket route: the cost components behind the front gross, the trade '
    'context, the finance amounts, the people, the lead''s paper trail, and supporting fact for the page''s '
    'own integrity checklist. A RECORD VIEW, NOT A WORKFLOW: nothing here can be edited, assigned, '
    'approved, submitted, repriced, funded or contracted, and no column exists that such an action would '
    'write to. Distinct from vw_deal_explorer, which is the compact index a manager scans; this is what '
    'they open. GRAIN SURVIVES SEVEN JOINS: vehicle and model are one-to-one, three employee roles are LEFT '
    'on a unique key, and the linked lead and appointment are LEFT on sale_key carrying at most one row '
    'each -- the last two are the only joins that could widen the grain and both are asserted rather than '
    'assumed, because a duplicated Deal Jacket shows a transaction twice with no indication that it has. '
    'FINANCE STRUCTURE IS DERIVED and the derivation is the whole definition: Lease when the sale type is, '
    'Cash when nothing was financed, Retail Finance otherwise; finance_structure_basis records which of the '
    'three decided it. NOT MODELLED, and published as absence rather than as a plausible zero: trade payoff '
    'and equity (no trade fact), lender/APR/term/payment (no finance dimension until DASH.6), F&I product '
    'itemization (no product fact until DASH.7), acquisition date (dim_vehicle records none), stock number '
    '(the model contains none; vehicle_code is the unit identifier and is not captioned as one). The two '
    'ARITHMETIC identities are deliberately NOT published as flags: the page recomputes front gross and '
    'total gross from the displayed components, because a verification that reads a flag verifies nothing. '
    'Export-eligible: yes, as dashboard dataset deal-jacket, chunked by store and sale month.';

COMMENT ON COLUMN reporting.vw_deal_jacket.sale_id IS 'Stable business identifier of the transaction, SLE-########. The route parameter. The surrogate sale_key is deliberately absent.';
COMMENT ON COLUMN reporting.vw_deal_jacket.sale_date IS 'Calendar date the deal was finalized. The governed date basis, and the chunking date.';
COMMENT ON COLUMN reporting.vw_deal_jacket.delivery_date IS 'Calendar date the vehicle was delivered. A separate date role, never silently substituted for the sale date.';
COMMENT ON COLUMN reporting.vw_deal_jacket.sale_month_start_date IS 'First day of the sale month. Published so the export partitions on a stored value.';
COMMENT ON COLUMN reporting.vw_deal_jacket.dealership_key IS 'Store surrogate key. Relationship column; resolved to the GSA-00# business code by the dashboard export.';
COMMENT ON COLUMN reporting.vw_deal_jacket.sale_type IS 'New Retail, Used Retail, Certified Retail, Lease, Wholesale or Dealer Trade.';
COMMENT ON COLUMN reporting.vw_deal_jacket.is_retail IS 'True for a retail or lease delivery. False for wholesale and dealer trades, whose retail-only sections the jacket renders as Not applicable rather than as zero.';
COMMENT ON COLUMN reporting.vw_deal_jacket.finance_structure IS 'Cash, Retail Finance or Lease, DERIVED from sale type and amount financed. No lender, rate, term or payment is modelled until DASH.6, so this is the only structural fact the jacket states.';
COMMENT ON COLUMN reporting.vw_deal_jacket.finance_structure_basis IS 'Which of the three conditions produced finance_structure, in words. Published so a reader can see what the label was decided from rather than trusting it.';
COMMENT ON COLUMN reporting.vw_deal_jacket.vehicle_code IS 'Synthetic vehicle identifier, VEH-#######. NOT a stock number: the model contains none, and this column is never captioned as one.';
COMMENT ON COLUMN reporting.vw_deal_jacket.synthetic_vin IS 'The ARPI synthetic VIN-style identifier (ADR-0005). Machine-generated and belonging to no real vehicle; the route displays it with its policy note.';
COMMENT ON COLUMN reporting.vw_deal_jacket.model_year IS 'Model year of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_jacket.make IS 'Make of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_jacket.model_name IS 'Model of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_jacket.trim_level IS 'Trim of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_jacket.vehicle_display IS 'Year, make, model and trim as one string, so every consumer renders the unit identically.';
COMMENT ON COLUMN reporting.vw_deal_jacket.body_style IS 'Body style of the unit sold.';
COMMENT ON COLUMN reporting.vw_deal_jacket.condition_type IS 'New, Used or Certified as recorded on the vehicle.';
COMMENT ON COLUMN reporting.vw_deal_jacket.condition_group IS 'Governed new/used split. A certified pre-owned unit is Used.';
COMMENT ON COLUMN reporting.vw_deal_jacket.odometer_band IS 'Banded odometer reading, never the exact figure. Banding is the privacy control (PRIVACY_AND_ETHICS.md).';
COMMENT ON COLUMN reporting.vw_deal_jacket.acquisition_source IS 'How the unit was acquired: trade, auction, lease return and so on. NOT an acquisition date -- the model records none.';
COMMENT ON COLUMN reporting.vw_deal_jacket.days_in_inventory_at_sale IS 'Calendar days between acquisition and sale. The only inventory-age fact the deal carries, and what stands in for an acquisition date the model does not record.';
COMMENT ON COLUMN reporting.vw_deal_jacket.sale_price IS 'Final selling price of the vehicle. The first line of the front-gross formula.';
COMMENT ON COLUMN reporting.vw_deal_jacket.msrp IS 'Manufacturer suggested retail price where one applies, otherwise NULL. NULL means not applicable -- a used unit legitimately has none -- and must never be rendered as zero.';
COMMENT ON COLUMN reporting.vw_deal_jacket.original_asking_price IS 'First advertised price of the unit.';
COMMENT ON COLUMN reporting.vw_deal_jacket.final_asking_price IS 'Advertised price at the time of sale.';
COMMENT ON COLUMN reporting.vw_deal_jacket.acquisition_cost IS 'What the unit cost to acquire. Second line of the front-gross formula, subtracted.';
COMMENT ON COLUMN reporting.vw_deal_jacket.reconditioning_cost IS 'What the unit cost to recondition. Third line of the front-gross formula, subtracted.';
COMMENT ON COLUMN reporting.vw_deal_jacket.pack_amount IS 'Internal pack applied to the deal. Fourth line of the front-gross formula, subtracted.';
COMMENT ON COLUMN reporting.vw_deal_jacket.front_end_gross IS 'KPI-GRS-001 at deal grain: sale price less acquisition, reconditioning and pack, as stored and CHECK-constrained on the fact. EXCLUDES manufacturer holdback, dealer cash, stair-step money, floorplan credits and unposted adjustments, none of which ARPI models. Legitimately negative, and never suppressed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.discount_from_original IS 'Original asking price less selling price. Negative when the unit sold above its first advertised price.';
COMMENT ON COLUMN reporting.vw_deal_jacket.discount_from_final IS 'Final asking price less selling price.';
COMMENT ON COLUMN reporting.vw_deal_jacket.discount_from_msrp IS 'MSRP less selling price, or NULL where the unit carries no MSRP. NULL is not applicable, never zero.';
COMMENT ON COLUMN reporting.vw_deal_jacket.has_trade IS 'True when the deal carried a trade-in, judged by a non-zero allowance or actual cash value. False renders as Not applicable, never as a row of zeros.';
COMMENT ON COLUMN reporting.vw_deal_jacket.trade_allowance IS 'Allowance granted on the trade-in.';
COMMENT ON COLUMN reporting.vw_deal_jacket.trade_acv IS 'Actual cash value of the trade-in.';
COMMENT ON COLUMN reporting.vw_deal_jacket.trade_variance IS 'Trade allowance less actual cash value. NOT part of the ARPI front-gross formula, and published separately for exactly that reason: folding it in would change what KPI-GRS-001 means. Payoff and equity are not modelled at all.';
COMMENT ON COLUMN reporting.vw_deal_jacket.cash_down IS 'Cash down payment.';
COMMENT ON COLUMN reporting.vw_deal_jacket.amount_financed IS 'Amount financed. Zero on a cash deal, which is what finance_structure reads. No rate, term, payment, lender, buy rate, sell rate or spread exists anywhere in ARPI.';
COMMENT ON COLUMN reporting.vw_deal_jacket.back_end_gross IS 'KPI-GRS-002 at deal grain. AGGREGATE finance-office profit: reserve and product gross are not separated because no finance-product fact exists until DASH.7, and the route labels it as aggregate rather than implying an itemization it does not have.';
COMMENT ON COLUMN reporting.vw_deal_jacket.total_gross IS 'KPI-GRS-003 at deal grain: front_end_gross + back_end_gross, reconciled to the cent by RECON-GROSS-001. The page recomputes this identity from the displayed components rather than trusting the column.';
COMMENT ON COLUMN reporting.vw_deal_jacket.salesperson_code IS 'Synthetic employee identifier of the selling salesperson. No name is published. NULL means the role was not attributed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.salesperson_role IS 'The salesperson''s job role, for the attribution line. Role and store only; no name, no pay, no performance.';
COMMENT ON COLUMN reporting.vw_deal_jacket.desk_manager_code IS 'Synthetic employee identifier of the desk manager. NULL means the role was not attributed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.desk_manager_role IS 'The desk manager''s job role.';
COMMENT ON COLUMN reporting.vw_deal_jacket.finance_manager_code IS 'Synthetic employee identifier of the finance manager. NULL means the role was not attributed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.finance_manager_role IS 'The finance manager''s job role.';
COMMENT ON COLUMN reporting.vw_deal_jacket.bdc_employee_code IS 'Synthetic employee identifier of the BDC employee on the linked appointment, where one exists. NULL means no appointment linked, or none was attributed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.is_lead_attributed IS 'True when a CRM lead links to this deal. False is genuine walk-in or unattributed business, not missing data, and the two must not be collapsed.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_id IS 'Business identifier of the linked lead. NULL when the deal has none.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_created_date IS 'Calendar date the linked lead was created: the first stage of the timeline.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_source_code IS 'Source of the linked lead, resolved through fact_lead rather than through the sale fact''s own never-populated lead_source_key.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_source_name IS 'Display name of the linked lead''s source.';
COMMENT ON COLUMN reporting.vw_deal_jacket.first_response_seconds IS 'Seconds from lead creation to first response. NULL means never responded, which is a different fact from responding slowly.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_contacted IS 'Whether the linked lead was contacted. A modelled flag, not a message: no note, email, transcript or free text exists in fact_lead.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_appointment_set IS 'Whether an appointment was set on the linked lead.';
COMMENT ON COLUMN reporting.vw_deal_jacket.lead_days_to_sale IS 'Days from lead creation to the sale it produced.';
COMMENT ON COLUMN reporting.vw_deal_jacket.has_appointment IS 'True when an appointment links to this deal. The timeline renders its stages only when it does.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_id IS 'Business identifier of the linked appointment.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_scheduled_date IS 'Calendar date the appointment was scheduled for.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_show_date IS 'Calendar date the customer showed. NULL when they did not, which the timeline states rather than leaving blank.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_shown IS 'Whether the appointment was shown.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_test_drive IS 'Whether a test drive was recorded. A real modelled flag, which is why the timeline shows this stage rather than declaring it unavailable.';
COMMENT ON COLUMN reporting.vw_deal_jacket.appointment_write_up IS 'Whether a write-up was recorded. A real modelled flag, for the same reason.';
COMMENT ON COLUMN reporting.vw_deal_jacket.delivery_on_or_after_sale IS 'Supporting fact for the page''s date-validity check: a vehicle delivered before it was sold is a defect. Published so the checklist is rendered from data rather than from a hard-coded sentence.';
COMMENT ON COLUMN reporting.vw_deal_jacket.inventory_snapshot_count IS 'How many inventory snapshots ever observed this unit. Supporting fact for the sale-to-inventory check: a sold unit that never appeared in inventory is a relationship worth flagging. Zero is a legitimate value for a unit acquired and sold between two snapshot dates, so the page reports it as a note rather than as a failure.';
COMMENT ON COLUMN reporting.vw_deal_jacket.source_system IS 'Originating system. Present so no reader mistakes this for a real transaction record.';
