-- =============================================================================
-- File:            sql/03_dimensions/04_dim_employee.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_employee, the conformed SCD Type 2 employee dimension.
-- Execution order: 35 of 66 — after the dimensions it references, before sql/03_dimensions/14_dim_employee_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per employee role-assignment version (SCD Type 2).
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 15 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.
--
-- SCD TYPE 2 MODEL
-- ----------------
--   * Versions tile the timeline: effective_date .. expiration_date inclusive,
--     with no gap and no overlap for a given employee_id.
--   * The open-ended sentinel is 9999-12-31 and is_current is kept in lock step
--     with it by ck_dim_employee_current_flag_matches_sentinel.
--   * Change detection uses attribute_hash over tracked attributes 3-9:
--       dealership_id|department|job_role|hire_date|termination_date|is_active|is_manager
--     Agent D computes that digest in Python as the SHA-256 of those seven
--     values joined with the pipe character, UTF-8, NULL serialised as the
--     empty string, booleans lower-case true/false and dates ISO YYYY-MM-DD.
--     Worked example from the generator's own assertion:
--       GSA-003|Sales|Salesperson|2021-05-04||true|false
--     The merge compares the generator's value and NEVER recomputes it, so
--     there is exactly one definition of 'changed' in the whole system.
--
-- PRIVACY: this entity carries no name, contact detail, compensation, commission,
-- pay plan or protected characteristic. Tenure is banded, not exact.

CREATE TABLE IF NOT EXISTS warehouse.dim_employee (
    employee_key      integer       NOT NULL,
    employee_id       varchar(16)   NOT NULL,
    dealership_id     varchar(16)   NOT NULL,
    department        varchar(30)   NOT NULL,
    job_role          varchar(40)   NOT NULL,
    hire_date         date          NOT NULL,
    termination_date  date          NULL    ,
    is_active         boolean       NOT NULL,
    is_manager        boolean       NOT NULL,
    tenure_band       varchar(20)   NOT NULL,
    effective_date    date          NOT NULL,
    expiration_date   date          NOT NULL,
    is_current        boolean       NOT NULL,
    attribute_hash    char(64)      NOT NULL,
    source_system     varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_employee
        PRIMARY KEY (employee_key),
    CONSTRAINT uq_dim_employee_id_effective_date
        UNIQUE (employee_id, effective_date),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_employee_key_positive
        CHECK (employee_key > 0),
    CONSTRAINT ck_dim_employee_department_domain
        CHECK (department IN ('Sales', 'Finance', 'BDC', 'Management', 'Service')),
    CONSTRAINT ck_dim_employee_job_role_domain
        CHECK (job_role IN ('Salesperson', 'Sales Manager', 'Desk Manager', 'Finance Manager', 'BDC Representative', 'BDC Manager', 'General Manager', 'Service Advisor')),
    CONSTRAINT ck_dim_employee_tenure_band_domain
        CHECK (tenure_band IN ('Under 1 Year', '1-3 Years', '3-5 Years', '5-10 Years', 'Over 10 Years')),
    CONSTRAINT ck_dim_employee_attribute_hash_hex
        CHECK (attribute_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_dim_employee_employee_id_not_blank
        CHECK (btrim(employee_id) <> ''),
    CONSTRAINT ck_dim_employee_source_system_not_blank
        CHECK (btrim(source_system) <> ''),
    CONSTRAINT ck_dim_employee_expiration_not_before_effective
        CHECK (expiration_date >= effective_date),
    CONSTRAINT ck_dim_employee_current_flag_matches_sentinel
        CHECK (is_current = (expiration_date = DATE '9999-12-31')),
    CONSTRAINT ck_dim_employee_effective_not_before_hire
        CHECK (effective_date >= hire_date)
);

-- Exactly one live version per employee. This is the operational grain guarantee
-- every fact join depends on, and it is what makes the Type 2 merge safe to rerun.
CREATE UNIQUE INDEX IF NOT EXISTS uix_dim_employee_current_employee_id
    ON warehouse.dim_employee (employee_id)
    WHERE is_current;

COMMENT ON TABLE warehouse.dim_employee IS
    'Grain: one row per employee role-assignment version (SCD Type 2). Loaded exclusively by 
sql/03_dimensions/14_dim_employee_merge.sql from staging.stg_employee. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_employee.employee_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(employee_key) + row_number() ordered by employee_id, effective_date; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_employee.employee_id IS 'Natural key, EMP-##### (contract section 5). Stable across versions.';
COMMENT ON COLUMN warehouse.dim_employee.dealership_id IS 'Store the employee is assigned to in this version. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.department IS 'Department. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.job_role IS 'Job role. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.hire_date IS 'Date the employee was hired. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.termination_date IS 'Date the employee left; NULL means still employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.is_active IS 'Whether the employee is currently employed. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.is_manager IS 'Whether the role carries management responsibility. SCD Type 2 tracked attribute.';
COMMENT ON COLUMN warehouse.dim_employee.tenure_band IS 'Banded tenure. Banded rather than exact so no precise personal timeline is published.';
COMMENT ON COLUMN warehouse.dim_employee.effective_date IS 'Inclusive start date of this version.';
COMMENT ON COLUMN warehouse.dim_employee.expiration_date IS 'Source expiration date. Informational: the merge derives the stored value from the successor version.';
COMMENT ON COLUMN warehouse.dim_employee.is_current IS 'Source current flag. Informational: the merge derives the stored value.';
COMMENT ON COLUMN warehouse.dim_employee.attribute_hash IS '64-character lower-case SHA-256 hex digest of tracked attributes 3-9 (dealership_id|department|job_role|hire_date|termination_date|is_active|is_manager), joined with ''|'', UTF-8, NULL serialised as the empty string. Computed by the generator (Agent D) and carried through unchanged; the merge compares it and never recomputes it.';
COMMENT ON COLUMN warehouse.dim_employee.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
