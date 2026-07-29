-- =============================================================================
-- File:            sql/05_reporting/07_vw_employee.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly employee view over warehouse.dim_employee, current versions only, minimised for fair employee analysis.
-- Execution order: Reporting layer, after warehouse.dim_employee and warehouse.dim_dealership exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per employee (the current SCD Type 2 version only).
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table, related one-to-many into the fact views on the role-playing
-- employee keys: vw_vehicle_sales.salesperson_key, .desk_manager_key and
-- .finance_manager_key, vw_leads.assigned_employee_key, and
-- vw_appointments.salesperson_key and .bdc_employee_key. Every relationship is
-- single-direction, dimension to fact. Role-playing is handled with several
-- inactive relationships plus USERELATIONSHIP, or with one active relationship per
-- role and explicit measures -- NOT by duplicating this view.
--
-- WHY CURRENT VERSIONS ONLY
-- -------------------------
-- A report slicer must offer each person exactly once. dim_employee keeps Type 2
-- history (34 versions for 30 people on the development profile); exposing every
-- version here would let a report count one salesperson twice.
--
-- PRIVACY AND FAIRNESS MINIMISATION
-- ---------------------------------
-- No name, contact detail, pay plan, commission, salary or termination date is
-- exposed, and none exists in the warehouse either. Tenure is published as a BAND,
-- never as a hire date, for the same reason customer age is published as a band:
-- the band answers every legitimate analytical question and the precise value does
-- not. ARCHITECTURE.md section 23 requires employee comparison to carry context
-- rather than a bare ranking; department, job_role, is_manager and tenure_band are
-- the context this dimension supplies, and the fairness-context metrics -- lead
-- volume received, lead-source mix, new-versus-used mix, gross per unit -- come
-- from the fact views filtered by these attributes.

CREATE OR REPLACE VIEW reporting.vw_employee AS
SELECT
    e.employee_key                                  AS employee_key,
    e.employee_id                                   AS employee_code,
    d.dealership_key                                AS dealership_key,
    e.dealership_id                                 AS dealership_code,
    d.store_short_name                              AS store_short_name,
    e.department                                    AS department,
    e.job_role                                      AS job_role,
    e.is_manager                                    AS is_manager,
    e.tenure_band                                   AS tenure_band,
    e.is_active                                     AS is_active,
    e.employee_id || ' (' || e.job_role || ')'      AS employee_label,
    e.effective_date                                AS version_effective_date,
    e.source_system                                 AS source_system
FROM warehouse.dim_employee AS e
JOIN warehouse.dim_dealership AS d
       ON d.dealership_id = e.dealership_id
      AND d.is_current
WHERE e.is_current;

COMMENT ON VIEW reporting.vw_employee IS
    'Grain: one row per employee, restricted to the current SCD Type 2 version. Dimension table; relates '
    'one-to-many into the role-playing employee keys on vw_vehicle_sales, vw_leads and vw_appointments, '
    'single direction. Role-playing is handled with inactive relationships and USERELATIONSHIP, never by '
    'duplicating this view. Deliberately minimised: no name, contact detail, pay plan, commission, salary '
    'or termination date is exposed, and tenure is published only as a band. ARCHITECTURE.md section 23 '
    'requires contextual metrics alongside any employee comparison; department, job_role, is_manager and '
    'tenure_band are that context.';

COMMENT ON COLUMN reporting.vw_employee.employee_key IS 'Warehouse surrogate key of the current version. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee.employee_code IS 'Stable, non-identifying employee code from the source system. The only employee label ARPI publishes.';
COMMENT ON COLUMN reporting.vw_employee.dealership_key IS 'Surrogate key of the store the person works at, resolved from the current dealership version. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_employee.dealership_code IS 'Store code the person works at, for example GSA-001.';
COMMENT ON COLUMN reporting.vw_employee.store_short_name IS 'Short store name, denormalised so an employee slicer can group by store without a second relationship.';
COMMENT ON COLUMN reporting.vw_employee.department IS 'Sales, Finance, BDC, Management or Service.';
COMMENT ON COLUMN reporting.vw_employee.job_role IS 'Job role. Drives which role-playing relationship is meaningful for a given person.';
COMMENT ON COLUMN reporting.vw_employee.is_manager IS 'True for a management role.';
COMMENT ON COLUMN reporting.vw_employee.tenure_band IS 'Banded tenure. Published instead of a hire date so employee comparison carries tenure context without exposing a precise personal date.';
COMMENT ON COLUMN reporting.vw_employee.is_active IS 'True while the person is employed.';
COMMENT ON COLUMN reporting.vw_employee.employee_label IS 'Readable label combining code and role. Preferred slicer label.';
COMMENT ON COLUMN reporting.vw_employee.version_effective_date IS 'Start date of the current attribute version, so an analyst can see when the record last changed.';
COMMENT ON COLUMN reporting.vw_employee.source_system IS 'Originating system. Present so no reader mistakes this for real employee data.';
