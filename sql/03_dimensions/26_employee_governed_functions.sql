-- =============================================================================
-- File:            sql/03_dimensions/26_employee_governed_functions.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the governed employee role-family map that the employee-performance reporting and validation objects share.
-- Execution order: Dimension layer, after warehouse.dim_employee exists and before any reporting or validation object calls this function.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE FUNCTION only; defining a function writes no rows.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. EXECUTE is granted to arpi_reporter with the reporting views that call it.
-- Grain:           Not applicable (scalar function).
-- =============================================================================
--
-- Delivery increment: DASH.11. Anchoring questions SQ-08, SQ-09, SQ-20, SQ-21 and SQ-28.
--
-- WHAT A ROLE FAMILY IS, AND WHAT IT IS NOT
-- ------------------------------------------
-- A role family is the OPERATING SURFACE a person's measured activity belongs to. It is
-- not a rank, not a seniority order, not a pay band and not a judgement. It exists because
-- the four families have genuinely different opportunities and genuinely different
-- denominators: a contact rate belongs to a lead population, a gross per retail unit
-- belongs to a delivered-unit population, and presenting one against the other would be a
-- category error rather than a comparison.
--
-- THE MAP IS DERIVED FROM THE FACTS, NOT ASSUMED FROM THE TITLES
-- --------------------------------------------------------------
-- Every branch below was chosen after auditing which job roles actually appear in each
-- role-playing foreign key on the development profile. The audit is recorded in
-- docs/reviews/DASH-11-REVIEW.md section 2; the counts that produced it are:
--
--   fact_vehicle_sale.salesperson_key      Salesperson only
--   fact_vehicle_sale.desk_manager_key     Desk Manager, Sales Manager, General Manager
--   fact_vehicle_sale.finance_manager_key  Finance Manager only
--   fact_lead.assigned_employee_key        BDC Representative, Salesperson,
--                                          Sales Manager, General Manager
--   fact_appointment.salesperson_key       Salesperson, Sales Manager, General Manager
--   fact_appointment.bdc_employee_key      BDC Representative only
--
-- SALES MANAGER AND GENERAL MANAGER ARE DESK MANAGEMENT BECAUSE THE FACTS SAY SO
-- ------------------------------------------------------------------------------
-- Both appear in desk_manager_key on real generated deliveries -- 231 and 241 of them --
-- so both are credited desk management and both keep their own job_role label on every
-- row. Neither is promoted to a Desk Manager and neither acquires a metric the facts do
-- not carry. Had the audit found no desk credit for a role, that role would be absent
-- here rather than given a fabricated surface.
--
-- SERVICE ADVISOR RETURNS NULL, DELIBERATELY
-- -------------------------------------------
-- warehouse.fact_service_visit is Deferred, so no fact credits a Service Advisor with
-- anything. A NULL here means "this person has no employee-performance surface", which is
-- the truthful answer; inventing a Service family would produce a page of zeroes that
-- looked like poor performance rather than like absent data. LIMITATIONS.md records it.
--
-- BDC MANAGER IS MAPPED BUT UNPOPULATED
-- --------------------------------------
-- 'BDC Manager' is in the dim_employee job_role domain and no generated employee holds it.
-- The branch exists so that the map is total over the declared domain rather than so that
-- a surface is claimed; the development profile produces zero rows for it.
--
-- NULL rather than a default on an unknown role. A default branch would quietly file an
-- unrecognised title into a family and give it that family's denominators. A NULL
-- propagates, and DQ-EMP-002 fails on it.
CREATE OR REPLACE FUNCTION warehouse.fn_employee_role_family(p_job_role varchar)
RETURNS varchar
LANGUAGE sql
IMMUTABLE
AS $fn_employee_role_family$
    SELECT CASE
        WHEN p_job_role = 'Salesperson'                              THEN 'Salesperson'
        WHEN p_job_role IN ('Desk Manager',
                            'Sales Manager',
                            'General Manager')                       THEN 'Desk Management'
        WHEN p_job_role = 'Finance Manager'                          THEN 'Finance'
        WHEN p_job_role IN ('BDC Representative', 'BDC Manager')     THEN 'BDC'
        ELSE NULL
    END::varchar;
$fn_employee_role_family$;

COMMENT ON FUNCTION warehouse.fn_employee_role_family(varchar) IS
    'THE employee role-family map: the single authority deciding which employee-performance surface a '
    'job role''s measured activity belongs to. Salesperson -> Salesperson. Desk Manager, Sales Manager and '
    'General Manager -> Desk Management, because all three are credited on real deliveries in '
    'fact_vehicle_sale.desk_manager_key and each keeps its own job_role label. Finance Manager -> Finance. '
    'BDC Representative and BDC Manager -> BDC, the second being a declared job role no generated employee '
    'currently holds. Service Advisor -> NULL, because fact_service_visit is Deferred and no fact credits a '
    'service advisor with anything; a family of zeroes would read as poor performance rather than as absent '
    'data. NULL rather than a default on an unknown role, so an unmapped title fails DQ-EMP-002 instead of '
    'silently acquiring another family''s denominators. A ROLE FAMILY IS NOT A RANK, a seniority order or a '
    'judgement: it exists because the four surfaces have different opportunities and different governed '
    'denominators, and comparing across them would be a category error.';
