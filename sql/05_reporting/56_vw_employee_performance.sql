-- =============================================================================
-- File:            sql/05_reporting/56_vw_employee_performance.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create reporting.vw_employee_performance — role-aware employee activity components at store x calendar date x role family x employee version, numerators and denominators published separately and never as rates.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales, reporting.vw_leads, reporting.vw_appointments, warehouse.fn_employee_role_family and warehouse.fn_minimum_sample_floor exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. SELECT granted to arpi_reporter.
-- Grain:           One row per dealership, per calendar date, per role family, per employee VERSION -- including the "nobody credited" group.
-- =============================================================================
--
-- Delivery increment: DASH.11. Anchoring questions SQ-08, SQ-09, SQ-20, SQ-21 and SQ-28.
--
-- THIS VIEW RANKS NOBODY, AND CANNOT
-- -----------------------------------
-- There is no score column, no rank column, no percentile, no tier and no ordering
-- expression anywhere in it. It publishes COMPONENTS -- additive numerators and additive
-- denominators -- and never a rate, because a rate cannot be re-aggregated and because a
-- single published rate is the thing a leaderboard is built out of. PRIVACY_AND_ETHICS.md
-- section 5 treats a bare employee ranking as a design defect rather than as a feature
-- someone forgot to justify, and the defence here is structural: the consumer must divide
-- for itself, at the grain it is actually reporting at, having first checked the floor.
--
-- WHY DAILY, AND NOT MONTHLY
-- ---------------------------
-- The console's filter grammar (docs/dashboard/INFORMATION_ARCHITECTURE.md section 6)
-- accepts a month, an explicit date range, month-to-date and last-30-days. A monthly view
-- can answer the first and cannot answer the other three: "last 30 days" crosses a month
-- boundary, and a range from the 8th to the 22nd has no monthly row at all. Declaring
-- those filters not-applicable would have been a SQL convenience dressed up as a product
-- decision. The daily grain answers every one of them, and it costs 4,060 rows on the
-- development profile -- smaller than eleven datasets this project already exports.
--
-- THE EMPLOYEE KEY IS THE VERSION KEY. THIS IS THE WHOLE SCD2 CONTRACT
-- --------------------------------------------------------------------
-- warehouse.dim_employee is SCD Type 2, and every role-playing foreign key on every fact
-- points at the employee VERSION current when the event happened. This view joins on that
-- key and never on "the current version of the same person", so job_role, department,
-- tenure_band and the assignment store on every row are the values that were true AT THE
-- EVENT. A salesperson who sold at GSA-001 in August and moved to GSA-002 in December
-- keeps every August unit at GSA-001 and keeps the job role they held when they sold it.
-- The wrong implementation -- resolving employee_id to its current row -- would silently
-- move history to the new store and relabel it with the new title, and it would look
-- entirely reasonable while doing so.
--
-- is_active_in_current_roster is the ONE current-version attribute here, and it is named
-- for what it is. A person who left is still the person who sold the car: their historical
-- activity stays in the period it happened in, because current employment is roster
-- context and not a historical fact filter.
--
-- THE CREDITED STORE IS THE FACT'S STORE
-- ---------------------------------------
-- dealership_key is the store the transaction, lead or appointment belongs to -- the same
-- attribution every other reporting view uses -- which is what makes the rollups below
-- reconcile exactly. employee_version_dealership_id publishes the store the employee
-- VERSION was assigned to beside it, so the two can be seen to agree; DQ-EMP-004 fails if
-- they ever do not, rather than the divergence being averaged away silently.
--
-- ROLE FAMILY, AND WHY THE SALE COLUMNS ARE NAMED PER CREDIT RELATIONSHIP
-- -----------------------------------------------------------------------
-- role_family comes from warehouse.fn_employee_role_family() applied to the fact-linked
-- version's job_role -- one authority, audited against the facts, documented there.
--
-- One delivery is credited to as many as three different people: a salesperson, a desk
-- manager and a finance manager. Those three credits are three different questions about
-- one car, so they are three DIFFERENTLY NAMED COLUMN GROUPS -- sold_*, desked_*,
-- financed_* -- rather than one shared "retail units" column disambiguated by role_family.
-- The shared-column design was rejected on purpose: it makes SUM(retail_units) across
-- families silently triple every delivery, and it collapses in the unassigned group, where
-- a sale with no finance manager and a sale with no salesperson would land in the same
-- bucket under the same column with no way to tell them apart. With named groups, every
-- component sums correctly over the WHOLE view with no family filter at all, and the four
-- rollups below hold without one.
--
-- THE UNASSIGNED GROUP IS A REAL POPULATION AND IS NEVER DROPPED
-- --------------------------------------------------------------
-- finance_manager_key, assigned_employee_key and bdc_employee_key are all nullable, and
-- the development profile has 135 deliveries written with nobody on the F&I desk, 296
-- leads assigned to nobody and 521 appointments with no BDC employee. Those are real
-- transactions and real opportunities. They are published as role_family 'Unassigned' with
-- employee_grain_key 0 -- outside the employee comparison, inside every total -- because
-- dropping them would make this view disagree with the fact it was built from, and
-- inventing an EMP code for them would assert a person who does not exist.
--
-- employee_grain_key is coalesce(employee_key, 0) and is NOT NULL, so the declared grain is
-- testable: PostgreSQL treats NULLs as distinct and a grain expressed over the nullable key
-- could not be checked for uniqueness at all.
--
-- THREE DATE BASES, EACH NAMED IN THE COLUMN THAT USES IT
-- --------------------------------------------------------
--   SALE DATE            sold_*, desked_*, financed_*
--   LEAD CREATED DATE    assigned_*, valid_*, contacted_*, appointment_set_*,
--                        responded_*, unresponded_*, response_seconds_total
--   APPOINTMENT SCHEDULED DATE   bdc_scheduled_*, bdc_eligible_*,
--                                bdc_cancelled_in_advance_*,
--                                bdc_shown_appointments_scheduled_basis
--   APPOINTMENT SHOW DATE        bdc_shown_appointments_show_basis,
--                                bdc_shown_and_sold_appointments
--
-- A row is a DATE BUCKET, not a cohort: each column belongs to its own basis and each sums
-- correctly over a date range independently of the others. Nothing may mix a
-- scheduled-basis numerator with a show-basis denominator. reporting.vw_appointment_funnel
-- carries the same two bases on one row for the same reason and states it the same way.
--
-- shown appointments appear TWICE, deliberately, because they are two different
-- populations: the show-rate numerator counts appointments SCHEDULED in the period that
-- were kept, and the show-to-sale denominator counts appointments KEPT in the period. A
-- single column would silently serve one of the two ratios wrongly.
--
-- MINIMUM SAMPLE: THE FLOOR IS PUBLISHED, NO PER-ROW FLAG IS
-- -----------------------------------------------------------
-- minimum_sample_floor carries warehouse.fn_minimum_sample_floor() so no consumer has to
-- hard-code it. There is deliberately NO meets_minimum_sample column, and this is where
-- this view departs from reporting.vw_fi_summary: the floor governs an AGGREGATED
-- denominator over a reporting period, and a daily flag would be false for very nearly
-- every row while the period figure it belongs to is perfectly comparison-eligible. Worse,
-- the floor is DENOMINATOR-SPECIFIC -- gross per retail unit is floored on retail units,
-- contact rate on valid leads, appointment-set rate on contacted leads, show rate on
-- eligible appointments, show-to-sale on shown appointments -- so one flag could not have
-- served them even at the right grain. The consumer computes eligibility per metric, from
-- that metric's own governed denominator, against this floor.
--
-- WHAT IS NOT HERE, AND WHY
-- --------------------------
-- No target, quota, goal or attainment: warehouse.fact_sales_target supports an Employee
-- scope and DASH.5 deliberately leaves it unpopulated, and a structural capability is not
-- a business policy. No compensation, commission, pay plan or bonus of any kind. No name,
-- contact detail, hire date, termination date or protected attribute -- none of which
-- exists in the warehouse either. No F&I product CATEGORY: that is a finer grain and
-- reporting.vw_fi_product_penetration owns it, exactly as it owns it for the F&I page. No
-- store inventory column: inventory belongs to the store and not to the person, and
-- repeating it on every employee row is the shape that invites summing it across them --
-- /dashboard/employees reads the governed inventory-health dataset for that context
-- instead. No lead source: a finer grain again, and
-- reporting.vw_employee_lead_source_response owns it.
--
-- EXPORT BOUNDARY: DASH.11 exports this view as the `employee-performance` dataset.

CREATE OR REPLACE VIEW reporting.vw_employee_performance AS
WITH sale_credit AS (
    -- One row per (delivery, credit relationship). The lateral triples each sale, and each
    -- copy carries a DIFFERENT column group, so nothing is double counted: a delivery
    -- contributes to sold_* once, to desked_* once and to financed_* once.
    SELECT
        s.dealership_key                                            AS dealership_key,
        s.sale_date_key                                             AS date_key,
        r.credit                                                    AS credit,
        r.employee_key                                              AS employee_key,
        s.retail_unit_count                                         AS retail_unit_count,
        s.new_unit_count                                            AS new_unit_count,
        s.used_unit_count                                           AS used_unit_count,
        CASE WHEN s.vehicle_condition_type = 'Certified'
             THEN s.retail_unit_count ELSE 0 END                    AS certified_unit_count,
        s.wholesale_unit_count + s.dealer_trade_unit_count          AS non_retail_unit_count,
        s.retail_front_end_gross                                    AS retail_front_end_gross,
        s.retail_back_end_gross                                     AS retail_back_end_gross,
        s.retail_total_gross                                        AS retail_total_gross,
        CASE WHEN s.desk_manager_key IS NOT NULL
             THEN s.retail_unit_count ELSE 0 END                    AS retail_units_with_desk_manager,
        warehouse.fn_finance_structure(s.sale_type, v.amount_financed)
                                                                    AS finance_structure,
        v.finance_reserve_gross                                     AS finance_reserve_gross
    FROM reporting.vw_vehicle_sales AS s
    JOIN warehouse.fact_vehicle_sale AS v ON v.sale_key = s.sale_key
    CROSS JOIN LATERAL (
        VALUES ('sold',     s.salesperson_key),
               ('desked',   s.desk_manager_key),
               ('financed', s.finance_manager_key)
    ) AS r(credit, employee_key)
),
sold_totals AS (
    SELECT
        c.dealership_key,
        c.date_key,
        coalesce(c.employee_key, 0)                                 AS employee_grain_key,
        c.employee_key,
        sum(c.retail_unit_count)::integer                           AS sold_retail_units,
        sum(c.new_unit_count)::integer                              AS sold_new_units,
        sum(c.used_unit_count)::integer                             AS sold_used_units,
        sum(c.certified_unit_count)::integer                        AS sold_certified_units,
        sum(c.non_retail_unit_count)::integer                       AS sold_non_retail_units,
        sum(c.retail_front_end_gross)                               AS sold_front_end_gross,
        sum(c.retail_total_gross)                                   AS sold_total_gross,
        sum(c.retail_units_with_desk_manager)::integer              AS sold_retail_units_with_desk_manager
    FROM sale_credit AS c
    WHERE c.credit = 'sold'
    GROUP BY c.dealership_key, c.date_key, c.employee_key
),
desked_totals AS (
    SELECT
        c.dealership_key,
        c.date_key,
        coalesce(c.employee_key, 0)                                 AS employee_grain_key,
        c.employee_key,
        sum(c.retail_unit_count)::integer                           AS desked_retail_units,
        sum(c.new_unit_count)::integer                              AS desked_new_units,
        sum(c.used_unit_count)::integer                             AS desked_used_units,
        sum(c.certified_unit_count)::integer                        AS desked_certified_units,
        sum(c.non_retail_unit_count)::integer                       AS desked_non_retail_units,
        sum(c.retail_front_end_gross)                               AS desked_front_end_gross,
        sum(c.retail_total_gross)                                   AS desked_total_gross
    FROM sale_credit AS c
    WHERE c.credit = 'desked'
    GROUP BY c.dealership_key, c.date_key, c.employee_key
),
financed_totals AS (
    -- RETAIL DELIVERIES ONLY, matching reporting.vw_fi_summary exactly: a wholesale or
    -- dealer-trade disposal has no consumer, carries no reserve and is not part of the
    -- retail structure mix.
    SELECT
        c.dealership_key,
        c.date_key,
        coalesce(c.employee_key, 0)                                 AS employee_grain_key,
        c.employee_key,
        sum(c.retail_unit_count)::integer                           AS financed_retail_units,
        count(*) FILTER (WHERE c.finance_structure = 'Cash')::integer
                                                                    AS financed_cash_deals,
        count(*) FILTER (WHERE c.finance_structure = 'Retail Finance')::integer
                                                                    AS financed_retail_finance_deals,
        count(*) FILTER (WHERE c.finance_structure = 'Lease')::integer
                                                                    AS financed_lease_deals,
        sum(c.finance_reserve_gross)                                AS financed_reserve_gross,
        sum(c.retail_back_end_gross)                                AS financed_back_end_gross
    FROM sale_credit AS c
    WHERE c.credit = 'financed'
      AND c.retail_unit_count > 0
    GROUP BY c.dealership_key, c.date_key, c.employee_key
),
product_totals AS (
    -- Aggregated to the finance grain BEFORE the join, so contract measures cannot fan the
    -- deal measures out. DQ-FPS-004 and DQ-FPS-006 guarantee a contract's store, date and
    -- manager are its parent deal's, which is what makes this grain-compatible.
    SELECT
        ps.dealership_key,
        ps.sale_date_key                                            AS date_key,
        coalesce(ps.finance_manager_key, 0)                         AS employee_grain_key,
        sum(ps.product_sale_count)::integer                         AS financed_contract_count,
        count(DISTINCT ps.sale_key)::integer                        AS financed_deals_with_a_product,
        sum(ps.original_product_gross)                              AS financed_product_gross
    FROM warehouse.fact_finance_product_sale AS ps
    GROUP BY ps.dealership_key, ps.sale_date_key, coalesce(ps.finance_manager_key, 0)
),
lead_totals AS (
    -- LEAD CREATED DATE basis. Every duplicate exclusion is inherited structurally from
    -- reporting.vw_leads, where a duplicate row carries zero in every valid measure, so no
    -- numerator and no denominator here can pick the exclusion up differently.
    SELECT
        l.dealership_key,
        l.lead_created_date_key                                     AS date_key,
        coalesce(l.assigned_employee_key, 0)                        AS employee_grain_key,
        l.assigned_employee_key                                     AS employee_key,
        sum(l.lead_count)::integer                                  AS assigned_lead_count,
        sum(l.valid_lead_count)::integer                            AS valid_lead_count,
        sum(l.duplicate_lead_count)::integer                        AS duplicate_lead_count,
        sum(l.contacted_lead_count)::integer                        AS contacted_lead_count,
        sum(l.appointment_set_lead_count)::integer                  AS appointment_set_lead_count,
        sum(l.appointment_shown_lead_count)::integer                AS appointment_shown_lead_count,
        sum(l.sold_lead_count)::integer                             AS sold_lead_count,
        sum(l.responded_lead_count)::integer                        AS responded_lead_count,
        sum(l.unresponded_lead_count)::integer                      AS unresponded_lead_count,
        sum(l.response_seconds_total)::bigint                       AS response_seconds_total
    FROM reporting.vw_leads AS l
    GROUP BY l.dealership_key, l.lead_created_date_key, l.assigned_employee_key
),
bdc_scheduled_basis AS (
    -- APPOINTMENT SCHEDULED DATE basis. An appointment booked for next month is not
    -- eligible to show this month and must not sit in this month's show-rate denominator.
    SELECT
        a.dealership_key,
        a.scheduled_date_key                                        AS date_key,
        coalesce(a.bdc_employee_key, 0)                             AS employee_grain_key,
        a.bdc_employee_key                                          AS employee_key,
        sum(a.appointment_count)::integer                           AS bdc_scheduled_appointments,
        sum(a.eligible_appointment_count)::integer                  AS bdc_eligible_appointments,
        sum(a.cancelled_in_advance_count)::integer                  AS bdc_cancelled_in_advance_appointments,
        sum(a.shown_appointment_count)::integer                     AS bdc_shown_appointments_scheduled_basis
    FROM reporting.vw_appointments AS a
    GROUP BY a.dealership_key, a.scheduled_date_key, a.bdc_employee_key
),
bdc_show_basis AS (
    -- APPOINTMENT SHOW DATE basis. The visit and its outcome sit in the same period.
    SELECT
        a.dealership_key,
        a.show_date_key                                             AS date_key,
        coalesce(a.bdc_employee_key, 0)                             AS employee_grain_key,
        a.bdc_employee_key                                          AS employee_key,
        sum(a.shown_appointment_count)::integer                     AS bdc_shown_appointments_show_basis,
        sum(a.shown_and_sold_appointment_count)::integer            AS bdc_shown_and_sold_appointments
    FROM reporting.vw_appointments AS a
    WHERE a.show_date_key IS NOT NULL
    GROUP BY a.dealership_key, a.show_date_key, a.bdc_employee_key
),
grain AS (
    -- The declared grain, assembled from every contributing basis. A UNION (not UNION ALL)
    -- so each (store, date, employee version) appears once regardless of how many of the
    -- six component sets reached it.
    SELECT dealership_key, date_key, employee_grain_key, employee_key FROM sold_totals
    UNION SELECT dealership_key, date_key, employee_grain_key, employee_key FROM desked_totals
    UNION SELECT dealership_key, date_key, employee_grain_key, employee_key FROM financed_totals
    UNION SELECT dealership_key, date_key, employee_grain_key, employee_key FROM lead_totals
    UNION SELECT dealership_key, date_key, employee_grain_key, employee_key FROM bdc_scheduled_basis
    UNION SELECT dealership_key, date_key, employee_grain_key, employee_key FROM bdc_show_basis
)
SELECT
    -- Grain -------------------------------------------------------------------
    g.dealership_key                                                AS dealership_key,
    store.dealership_id                                             AS dealership_id,
    store.store_short_name                                          AS store_short_name,
    g.date_key                                                      AS activity_date_key,
    ad.full_date                                                    AS activity_date,
    coalesce(
        warehouse.fn_employee_role_family(ev.job_role),
        'Unassigned'
    )::varchar                                                      AS role_family,
    g.employee_key                                                  AS employee_key,
    g.employee_grain_key                                            AS employee_grain_key,
    ev.employee_id                                                  AS employee_code,

    -- Employee context AS AT THE EVENT, from the fact-linked SCD Type 2 version ----
    ev.job_role                                                     AS job_role,
    ev.department                                                   AS department,
    ev.tenure_band                                                  AS tenure_band,
    ev.dealership_id                                                AS employee_version_dealership_id,

    -- Current roster context, and labelled as such --------------------------------
    cur.is_active                                                   AS is_active_in_current_roster,

    -- Salesperson credit, SALE DATE basis -----------------------------------------
    coalesce(s.sold_retail_units, 0)                                AS sold_retail_units,
    coalesce(s.sold_new_units, 0)                                   AS sold_new_units,
    coalesce(s.sold_used_units, 0)                                  AS sold_used_units,
    coalesce(s.sold_certified_units, 0)                             AS sold_certified_units,
    coalesce(s.sold_non_retail_units, 0)                            AS sold_non_retail_units,
    coalesce(s.sold_front_end_gross, 0.00)                          AS sold_front_end_gross,
    coalesce(s.sold_total_gross, 0.00)                              AS sold_total_gross,
    coalesce(s.sold_retail_units_with_desk_manager, 0)              AS sold_retail_units_with_desk_manager,

    -- Desk-management credit, SALE DATE basis --------------------------------------
    coalesce(k.desked_retail_units, 0)                              AS desked_retail_units,
    coalesce(k.desked_new_units, 0)                                 AS desked_new_units,
    coalesce(k.desked_used_units, 0)                                AS desked_used_units,
    coalesce(k.desked_certified_units, 0)                           AS desked_certified_units,
    coalesce(k.desked_non_retail_units, 0)                          AS desked_non_retail_units,
    coalesce(k.desked_front_end_gross, 0.00)                        AS desked_front_end_gross,
    coalesce(k.desked_total_gross, 0.00)                            AS desked_total_gross,

    -- Finance credit, SALE DATE basis -----------------------------------------------
    coalesce(f.financed_retail_units, 0)                            AS financed_retail_units,
    coalesce(f.financed_cash_deals, 0)                              AS financed_cash_deals,
    coalesce(f.financed_retail_finance_deals, 0)                    AS financed_retail_finance_deals,
    coalesce(f.financed_lease_deals, 0)                             AS financed_lease_deals,
    coalesce(f.financed_reserve_gross, 0.00)                        AS financed_reserve_gross,
    coalesce(f.financed_back_end_gross, 0.00)                       AS financed_back_end_gross,
    coalesce(p.financed_product_gross, 0.00)                        AS financed_product_gross,
    coalesce(p.financed_contract_count, 0)                          AS financed_contract_count,
    coalesce(p.financed_deals_with_a_product, 0)                    AS financed_deals_with_a_product,

    -- Lead credit, LEAD CREATED DATE basis -------------------------------------------
    coalesce(l.assigned_lead_count, 0)                              AS assigned_lead_count,
    coalesce(l.valid_lead_count, 0)                                 AS valid_lead_count,
    coalesce(l.duplicate_lead_count, 0)                             AS duplicate_lead_count,
    coalesce(l.contacted_lead_count, 0)                             AS contacted_lead_count,
    coalesce(l.appointment_set_lead_count, 0)                       AS appointment_set_lead_count,
    coalesce(l.appointment_shown_lead_count, 0)                     AS appointment_shown_lead_count,
    coalesce(l.sold_lead_count, 0)                                  AS sold_lead_count,
    coalesce(l.responded_lead_count, 0)                             AS responded_lead_count,
    coalesce(l.unresponded_lead_count, 0)                           AS unresponded_lead_count,
    coalesce(l.response_seconds_total, 0)                           AS response_seconds_total,

    -- BDC appointment credit, APPOINTMENT SCHEDULED DATE basis -----------------------
    coalesce(bs.bdc_scheduled_appointments, 0)                      AS bdc_scheduled_appointments,
    coalesce(bs.bdc_eligible_appointments, 0)                       AS bdc_eligible_appointments,
    coalesce(bs.bdc_cancelled_in_advance_appointments, 0)           AS bdc_cancelled_in_advance_appointments,
    coalesce(bs.bdc_shown_appointments_scheduled_basis, 0)          AS bdc_shown_appointments_scheduled_basis,

    -- BDC appointment credit, APPOINTMENT SHOW DATE basis ----------------------------
    coalesce(bh.bdc_shown_appointments_show_basis, 0)               AS bdc_shown_appointments_show_basis,
    coalesce(bh.bdc_shown_and_sold_appointments, 0)                 AS bdc_shown_and_sold_appointments,

    -- Minimum-sample authority, published so nothing downstream hard-codes it ---------
    warehouse.fn_minimum_sample_floor()                             AS minimum_sample_floor
FROM grain AS g
JOIN warehouse.dim_dealership AS store ON store.dealership_key = g.dealership_key
JOIN warehouse.dim_date AS ad ON ad.date_key = g.date_key
LEFT JOIN warehouse.dim_employee AS ev ON ev.employee_key = g.employee_key
LEFT JOIN warehouse.dim_employee AS cur
       ON cur.employee_id = ev.employee_id
      AND cur.is_current
LEFT JOIN sold_totals AS s
       ON s.dealership_key = g.dealership_key
      AND s.date_key = g.date_key
      AND s.employee_grain_key = g.employee_grain_key
LEFT JOIN desked_totals AS k
       ON k.dealership_key = g.dealership_key
      AND k.date_key = g.date_key
      AND k.employee_grain_key = g.employee_grain_key
LEFT JOIN financed_totals AS f
       ON f.dealership_key = g.dealership_key
      AND f.date_key = g.date_key
      AND f.employee_grain_key = g.employee_grain_key
LEFT JOIN product_totals AS p
       ON p.dealership_key = g.dealership_key
      AND p.date_key = g.date_key
      AND p.employee_grain_key = g.employee_grain_key
LEFT JOIN lead_totals AS l
       ON l.dealership_key = g.dealership_key
      AND l.date_key = g.date_key
      AND l.employee_grain_key = g.employee_grain_key
LEFT JOIN bdc_scheduled_basis AS bs
       ON bs.dealership_key = g.dealership_key
      AND bs.date_key = g.date_key
      AND bs.employee_grain_key = g.employee_grain_key
LEFT JOIN bdc_show_basis AS bh
       ON bh.dealership_key = g.dealership_key
      AND bh.date_key = g.date_key
      AND bh.employee_grain_key = g.employee_grain_key;

COMMENT ON VIEW reporting.vw_employee_performance IS
    'Grain: ONE ROW PER DEALERSHIP, PER CALENDAR DATE, PER ROLE FAMILY, PER EMPLOYEE VERSION -- including '
    'the "nobody credited" group, which employee_grain_key represents as 0 so the grain is NOT NULL and '
    'therefore testable. RANKS NOBODY AND CANNOT: there is no score, rank, percentile, tier or ordering '
    'expression here, and every measure is published as an additive COMPONENT rather than as a rate, '
    'because a rate cannot be re-aggregated and a single published rate is what a leaderboard is built '
    'from. THE EMPLOYEE KEY IS THE SCD TYPE 2 VERSION KEY the fact points at, never the current version, so '
    'job_role, department, tenure_band and employee_version_dealership_id are the values that were true AT '
    'THE EVENT: history keeps its store and keeps its title. is_active_in_current_roster is the one '
    'current-version attribute and is named for it -- a person who has left is still the person who sold '
    'the car, and their activity stays in the period it happened in. THE CREDITED STORE IS THE FACT''S '
    'STORE, which is what makes the rollups reconcile. THE SALE COLUMNS ARE NAMED PER CREDIT RELATIONSHIP '
    '-- sold_*, desked_*, financed_* -- because one delivery is credited to three different people, and a '
    'single shared "retail units" column would triple every delivery for anything that summed it across '
    'families and would collapse entirely in the unassigned group. Each named group therefore sums '
    'correctly over the WHOLE view with no family filter. FOUR DATE BASES, each named in the column that '
    'uses it: SALE DATE for sold_/desked_/financed_, LEAD CREATED DATE for the lead columns, APPOINTMENT '
    'SCHEDULED DATE for bdc_eligible_ and bdc_shown_appointments_scheduled_basis, APPOINTMENT SHOW DATE for '
    'bdc_shown_appointments_show_basis and bdc_shown_and_sold_appointments. A row is a DATE BUCKET, not a '
    'cohort; nothing may mix a scheduled-basis numerator with a show-basis denominator. MINIMUM SAMPLE: the '
    'floor is published, no per-row flag is -- the floor governs an AGGREGATED denominator and is '
    'DENOMINATOR-SPECIFIC, so one daily flag could not serve gross per retail unit, contact rate, '
    'appointment-set rate, show rate and show-to-sale at once. NO TARGET, QUOTA OR ATTAINMENT: employee-'
    'scope targets are deliberately unpopulated. NO COMPENSATION, NAME, CONTACT DETAIL, HIRE DATE, '
    'TERMINATION DATE OR PROTECTED ATTRIBUTE -- none exists in the warehouse either. Every value is '
    'SYNTHETIC and describes a fictional person; no figure here supports a statement about individual '
    'skill, and none is comparable to any published market figure. Exported by DASH.11 as '
    '`employee-performance`.';

COMMENT ON COLUMN reporting.vw_employee_performance.dealership_key IS 'Surrogate key of the CREDITED store -- the store the transaction, lead or appointment belongs to. Part of the declared grain. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee_performance.dealership_id IS 'Business identifier of the credited store, GSA-###.';
COMMENT ON COLUMN reporting.vw_employee_performance.store_short_name IS 'Abbreviated fictional store name, for report headings. Names a business, never a person.';
COMMENT ON COLUMN reporting.vw_employee_performance.activity_date_key IS 'Date key of the activity date. Part of the declared grain. WHICH date it is depends on the column: sale date for sold_/desked_/financed_, lead created date for the lead columns, appointment scheduled date for the scheduled-basis appointment columns and appointment show date for the show-basis ones. A row is a date bucket, not a cohort.';
COMMENT ON COLUMN reporting.vw_employee_performance.activity_date IS 'Calendar date of the bucket. See activity_date_key for the per-column basis.';
COMMENT ON COLUMN reporting.vw_employee_performance.role_family IS 'Salesperson, Desk Management, Finance, BDC or Unassigned -- the operating surface this activity belongs to, from warehouse.fn_employee_role_family() applied to the FACT-LINKED version''s job_role. NOT a rank, a seniority order or a judgement: the four families have different opportunities and different governed denominators, so a figure from one is not comparable with a figure from another. Unassigned is the real population of activity credited to nobody, kept outside the employee comparison and inside every total.';
COMMENT ON COLUMN reporting.vw_employee_performance.employee_key IS 'Surrogate key of the employee VERSION the fact points at -- the version current when the event happened -- or NULL for the unassigned group. Nullable, which is why employee_grain_key exists beside it. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee_performance.employee_grain_key IS 'coalesce(employee_key, 0), NOT NULL. Part of the declared grain: PostgreSQL treats NULLs as distinct, so a grain expressed over the nullable key could not be checked for uniqueness at all. 0 is the "nobody credited" group -- 135 deliveries with no finance manager, 296 leads assigned to nobody and 521 appointments with no BDC employee on the development profile -- and it is never dropped and never given an invented EMP code.';
COMMENT ON COLUMN reporting.vw_employee_performance.employee_code IS 'Stable synthetic person identity, EMP-#####, or NULL for the unassigned group. THE ONLY EMPLOYEE LABEL ARPI PUBLISHES. Stable across SCD Type 2 versions, so one person''s activity can be followed across a role or store change while each segment keeps its own historical attribution.';
COMMENT ON COLUMN reporting.vw_employee_performance.job_role IS 'Job role AS AT THE EVENT, from the fact-linked version. A person who was a salesperson in August and a desk manager in December keeps Salesperson on their August rows. Never overwritten by the current title.';
COMMENT ON COLUMN reporting.vw_employee_performance.department IS 'Department as at the event: Sales, Finance, BDC, Management or Service.';
COMMENT ON COLUMN reporting.vw_employee_performance.tenure_band IS 'Banded tenure carried by the fact-linked version. Published instead of a hire date so employee comparison carries tenure context without exposing a precise personal date. A BAND FROM THE VERSION RECORD -- it is not recomputed as at the transaction date, and nothing may present it as the person''s exact tenure on that day.';
COMMENT ON COLUMN reporting.vw_employee_performance.employee_version_dealership_id IS 'The store the employee VERSION was assigned to, published beside the credited store so the two can be seen to agree. DQ-EMP-004 fails if they ever diverge, rather than the divergence being averaged away silently.';
COMMENT ON COLUMN reporting.vw_employee_performance.is_active_in_current_roster IS 'Whether the person is on the CURRENT roster. CURRENT CONTEXT, NOT A HISTORICAL FILTER: activity performed during the selected period belongs in the selected period whatever this says, and nothing may drop a row because it is false. No termination date is published and no leaving vocabulary is used anywhere -- "inactive in current roster" is the whole statement.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_retail_units IS 'KPI-SLS-001 restricted to deliveries where this person is the credited SALESPERSON. Additive. Sale-date basis. THE GOVERNED DENOMINATOR of front and total gross per retail unit for this credit, and therefore the sample count the floor is applied to for those two measures. Retail only: wholesale and dealer trades are excluded on both sides, and sold_non_retail_units publishes what was excluded so the exclusion is checkable rather than asserted.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_new_units IS 'KPI-SLS-002 for this credit: new retail units. Additive. sold_new_units + sold_used_units = sold_retail_units exactly, which is what makes the mix a partition.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_used_units IS 'KPI-SLS-003 for this credit: used retail units. Additive. CERTIFIED UNITS ARE USED UNITS and are already inside this figure; sold_certified_units is a subset published for context and must never be added to this column or presented as a third unit measure.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_certified_units IS 'The certified subset of sold_used_units, published as CONTEXT ONLY. Additive. Already counted in sold_used_units and in sold_retail_units; adding it to either double counts, and KPI-SLS-003 remains the governed used measure.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_non_retail_units IS 'Wholesale and dealer-trade units on deliveries credited to this salesperson. Additive. NEVER a numerator or a denominator of any per-retail-unit measure: it exists so the retail-only exclusion can be verified from the published data instead of trusted.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_front_end_gross IS 'KPI-GRS-001 restricted to this credit: retail front-end gross. Additive, exact. NUMERATOR of front gross per retail unit (KPI-GRS-004) over sold_retail_units. The quotient is SUM(numerator)/SUM(denominator) at whatever grain is being reported, NEVER the average of daily or per-employee ratios.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_total_gross IS 'KPI-GRS-003 restricted to this credit: retail total gross. Additive, exact. NUMERATOR of total gross per retail unit over sold_retail_units, on the same ratio-of-sums rule.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_retail_units_with_desk_manager IS 'Of sold_retail_units, those written with a desk manager credited. Additive. MANAGEMENT PARTICIPATION CONTEXT ONLY: it records that a desk manager was assigned, and asserts nothing about manager quality, help, rescue or interference, and no causal claim of any kind. On the development profile desk_manager_key is never null, so this equals sold_retail_units on every row and the context is structurally constant -- which a consumer should say plainly rather than give prominent space to.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_retail_units IS 'KPI-SLS-001 restricted to deliveries where this person is the credited DESK MANAGER. Additive. Sale-date basis. The governed denominator of the desk credit''s per-unit gross, and the sample count the floor is applied to for it. GROSS ON TRANSACTIONS THIS MANAGER DESKED -- not gross this manager caused.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_new_units IS 'New retail units on deliveries desked by this person. Additive. Sums with desked_used_units to desked_retail_units.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_used_units IS 'Used retail units on deliveries desked by this person. Additive. Certified units are used units and are already inside this figure.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_certified_units IS 'The certified subset of desked_used_units, context only. Already counted in desked_used_units and desked_retail_units.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_non_retail_units IS 'Wholesale and dealer-trade units on deliveries desked by this person. Additive. Never a numerator or denominator of a per-retail-unit measure.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_front_end_gross IS 'Retail front-end gross on deliveries desked by this person. Additive, exact. Numerator of the desk credit''s front gross per retail unit over desked_retail_units.';
COMMENT ON COLUMN reporting.vw_employee_performance.desked_total_gross IS 'Retail total gross on deliveries desked by this person. Additive, exact. Numerator of the desk credit''s total gross per retail unit over desked_retail_units.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_retail_units IS 'Retail units delivered with this person credited as the FINANCE MANAGER. Additive. Sale-date basis. THE GOVERNED DENOMINATOR of reserve PVR and back gross per retail unit, and it INCLUDES CASH DEALS, which cannot generate reserve -- the SQ-20 caution. financed_cash_deals is published beside it so a different cash mix is visible as the explanation rather than being mistaken for finance-office skill. Reconciles to reporting.vw_fi_summary.retail_units at the same store, date and manager.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_cash_deals IS 'Retail deals in this group whose derived structure is Cash, from warehouse.fn_finance_structure(). Additive. MUST be shown beside any reserve or back PVR comparison: a cash deal is in the denominator and can produce no reserve.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_retail_finance_deals IS 'Retail deals whose derived structure is Retail Finance. Additive. The only structure that can carry finance reserve.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_lease_deals IS 'Retail deals whose derived structure is Lease. Additive. The three structure counts sum exactly to financed_retail_units, which is what makes the mix a partition.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_reserve_gross IS 'KPI-FNI-001 restricted to this manager: finance-office income earned on the financing itself. Additive, exact. 0.00 on Cash and Lease by rule. AN AMOUNT ONLY -- no APR, buy rate, sell rate, rate spread or money factor is modelled anywhere in ARPI, and nothing here may be presented as rate guidance.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_back_end_gross IS 'KPI-GRS-002 restricted to this manager, on the deal-date basis. Additive, exact. Numerator of back gross per retail unit over financed_retail_units.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_product_gross IS 'KPI-FNI-003 restricted to this manager: product gross AS WRITTEN, deal-date basis. Additive, exact. Production before any later cancellation or chargeback -- it overstates RETAINED gross wherever adjustments followed. The as-of and adjustment-period bases are deliberately NOT here: reporting.vw_fi_summary and reporting.vw_fi_adjustment_summary own them, and /dashboard/fi owns their analysis.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_contract_count IS 'Product contracts written on this manager''s deals. Additive. CONTRACT ROWS, NOT PENETRATED DEALS: nothing may use this as a penetration numerator. Category-grain penetration with its eligible denominator belongs to reporting.vw_fi_product_penetration.';
COMMENT ON COLUMN reporting.vw_employee_performance.financed_deals_with_a_product IS 'Distinct deals in this group carrying at least one contract. Additive at this grain only. Published so a reader can see how many deliveries carried nothing; it is NOT a governed penetration figure, whose denominator is an eligible-deal population per category.';
COMMENT ON COLUMN reporting.vw_employee_performance.assigned_lead_count IS 'All leads assigned to this person on the LEAD CREATED DATE basis, duplicates included. Additive. Published only so the excluded duplicate population stays visible; it is NEVER a funnel denominator.';
COMMENT ON COLUMN reporting.vw_employee_performance.valid_lead_count IS 'KPI-FUN-001 restricted to this person: assigned leads excluding duplicates. Additive. THE GOVERNED DENOMINATOR of contact rate (KPI-FUN-002), and the sample count the floor is applied to for it. The duplicate exclusion is inherited structurally from reporting.vw_leads, where a duplicate carries zero in every valid measure, so no numerator and no denominator can pick it up differently.';
COMMENT ON COLUMN reporting.vw_employee_performance.duplicate_lead_count IS 'Assigned leads excluded as duplicates. Additive. Kept visible as an excluded population; it enters no numerator, no denominator and no response-time statistic.';
COMMENT ON COLUMN reporting.vw_employee_performance.contacted_lead_count IS 'KPI-FUN-002 numerator: valid assigned leads contacted. Additive. ALSO THE GOVERNED DENOMINATOR OF APPOINTMENT-SET RATE (KPI-FUN-003) -- appointment-set leads over CONTACTED leads, never over all valid leads. That denominator defect was found and corrected once already and must not return on this surface.';
COMMENT ON COLUMN reporting.vw_employee_performance.appointment_set_lead_count IS 'KPI-FUN-003 numerator: valid assigned leads that produced an appointment. Additive. LEAD GRAIN -- one lead can produce several appointments, so this is not the appointment-grain population the show-rate columns use.';
COMMENT ON COLUMN reporting.vw_employee_performance.appointment_shown_lead_count IS 'Valid assigned leads whose appointment was kept. Additive. Lead grain, and therefore not comparable with the appointment-grain show columns.';
COMMENT ON COLUMN reporting.vw_employee_performance.sold_lead_count IS 'KPI-FUN-006 numerator restricted to this person: valid assigned leads that became a delivery. Additive. Attributed to the LEAD''S created date, not the sale''s date, so a lead worked in one month and sold in the next stays in the month it arrived.';
COMMENT ON COLUMN reporting.vw_employee_performance.responded_lead_count IS 'Valid assigned leads with a recorded first response. Additive. The denominator of MEAN response time over response_seconds_total. A true MEDIAN is not derivable from this column and must not be approximated from it: reporting.vw_employee_lead_source_response carries the exact response population for that.';
COMMENT ON COLUMN reporting.vw_employee_performance.unresponded_lead_count IS 'Valid assigned leads that were NEVER RESPONDED TO. Additive. A NULL first response means never answered -- it does NOT mean zero seconds, and coalescing it to zero would sort ignored leads to the fastest end and improve every response statistic. This column must stay visible beside any response figure, because a person who ignores half their leads can otherwise report an excellent one.';
COMMENT ON COLUMN reporting.vw_employee_performance.response_seconds_total IS 'Sum of first-response seconds over responded_lead_count. Additive. Numerator of MEAN response time only. Zero seconds is a valid instant response and is included; never-responded leads contribute nothing to either side.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_scheduled_appointments IS 'Appointments this BDC employee set, on the APPOINTMENT SCHEDULED DATE basis. Additive. APPOINTMENT GRAIN, not lead grain. Not the show-rate denominator -- bdc_eligible_appointments is.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_eligible_appointments IS 'KPI-FUN-004 DENOMINATOR: scheduled appointments excluding advance cancellations, on the SCHEDULED DATE basis. Additive. The sample count the floor is applied to for show rate. The cancellation exclusion is the manipulable part of this measure, so bdc_cancelled_in_advance_appointments must appear on the same visual.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_cancelled_in_advance_appointments IS 'Appointments cancelled before the scheduled date, excluded from the show-rate denominator. Additive, scheduled-date basis. PUBLISHED BESIDE SHOW RATE, NOT BURIED IN METHODOLOGY: reclassifying no-shows as advance cancellations produces a flattering show rate, and this column is what makes that visible.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_shown_appointments_scheduled_basis IS 'KPI-FUN-004 NUMERATOR: appointments SCHEDULED in this bucket that were kept. Additive, SCHEDULED-DATE basis. Distinct from bdc_shown_appointments_show_basis, which counts a different population; mixing the two produces a ratio whose numerator and denominator describe different cohorts.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_shown_appointments_show_basis IS 'KPI-FUN-005 DENOMINATOR: appointments KEPT in this bucket, on the SHOW DATE basis. Additive. The sample count the floor is applied to for show-to-sale. Deliberately a second column rather than a reuse of the scheduled-basis one.';
COMMENT ON COLUMN reporting.vw_employee_performance.bdc_shown_and_sold_appointments IS 'KPI-FUN-005 NUMERATOR: kept appointments that produced a delivery, on the SHOW DATE basis, so the visit and its outcome sit in the same bucket. Additive. A customer who visits late in a period and buys days later still counts at the visit, so period-to-date conversion improves as the data matures and must be labelled incomplete.';
COMMENT ON COLUMN reporting.vw_employee_performance.minimum_sample_floor IS 'The project-default floor from warehouse.fn_minimum_sample_floor(), published as data so nothing downstream hard-codes it in SQL, Python, TypeScript or React. A PROJECT DEFAULT FOR A FICTIONAL GROUP -- never a statistical significance threshold, never an industry convention and never a performance threshold. It is a PUBLICATION DISCIPLINE: below it a comparative ratio is not shown, which says nothing whatever about the person.';
