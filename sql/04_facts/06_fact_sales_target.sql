-- =============================================================================
-- File:            sql/04_facts/06_fact_sales_target.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_sales_target, the monthly operating-plan fact.
-- Execution order: After every dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the load script.
-- Grain:           One row per dealership, per target scope, per targeted KPI, per calendar month.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-016-fact-sales-target.md.
-- Delivery increment: DASH.5 (docs/requirements/DASHBOARD_BACKLOG.md), authorized by
-- ADR-0013 Decision and DASHBOARD_PROGRAM.md section 9.8.
--
-- WHAT THIS FACT IS
-- -----------------
-- The PLAN, not the result. One row states what a store committed to sell or to
-- produce in one calendar month, at one governed scope, for one governed metric.
-- Every value is a SYNTHETIC INTERNAL OPERATING GOAL FOR THE FICTIONAL GRANITE AUTO
-- GROUP. It is not an industry benchmark, not a manufacturer objective, not a market
-- standard and not any real dealership's plan. No consumer may describe a value here
-- as "good", "average", "standard" or "recommended".
--
-- kpi_id NAMES THE METRIC BEING TARGETED, NEVER THE TARGET KPI
-- -----------------------------------------------------------
-- A row planning the month's retail units carries kpi_id = 'KPI-SLS-001'. KPI-TGT-001
-- (Retail unit target) is the governed measure COMPUTED FROM such rows, and storing it
-- here would make the fact describe its own consumer. The same holds for KPI-GRS-003
-- and KPI-TGT-003.
--
-- THE SCOPE MODEL
-- ---------------
--   Store       target_scope_id is the store's own dealership_id; no department, no
--               employee. Owns the two headline measures: retail units (KPI-SLS-001)
--               and total gross (KPI-GRS-003).
--   Department  target_scope_id is the department name, which department_name repeats
--               so the identity is CHECK-verifiable from the row alone. Owns the two
--               components that partition total gross exactly: Sales owns front-end
--               gross (KPI-GRS-001) and Finance owns back-end gross (KPI-GRS-002).
--               warehouse.fact_vehicle_sale enforces total = front + back, so the two
--               department actuals sum to the store actual with no overlap and no gap.
--   Employee    target_scope_id is the employee's synthetic identifier, which
--               employee_key resolves. Owns unit delivery (KPI-SLS-001). PHYSICALLY
--               SUPPORTED AND DELIBERATELY NOT POPULATED BY DASH.5: no registered
--               stakeholder question requires employee-scope targets and DASH.11 owns
--               the employee-performance surface. The vocabulary is permanent so the
--               scope can be populated later without a migration.
--
-- DEPARTMENT AND EMPLOYEE ROWS ARE REFINEMENTS, NEVER ADDENDS. A store total reads
-- Store-scope rows only. Summing every row of a store-month would double-count the
-- store's gross, which is why KPI-TGT-001 and KPI-TGT-003 both filter on the scope.
--
-- RETAIL UNITS ARE STORE-SCOPE ONLY, BY DESIGN. A retail unit is delivered once.
-- A Sales-department unit target would reproduce the store target and a Finance-
-- department one would count the same car a second time. F&I measures are computed
-- PER the sales department's unit count, not on a unit count of their own.
--
-- THE GRAIN CONSTRAINT AND THE NULL PROBLEM
-- -----------------------------------------
-- PostgreSQL treats NULLs as distinct in a UNIQUE constraint, so a grain expressed
-- over a nullable scope column would permit unlimited duplicate logical rows. That is
-- why target_scope_id is NOT NULL for every scope type and carries the scope's own
-- business identity: the grain constraint is over five NOT NULL columns and therefore
-- really enforces the declared grain.
--
-- WHAT A CHECK CONSTRAINT CANNOT DO HERE
-- --------------------------------------
-- Exactly one rule spans two tables: a Store-scope row's target_scope_id must equal
-- its own store's dealership_id, and dealership_id lives in warehouse.dim_dealership.
-- A CHECK cannot read another table and a trigger would be a hidden second load path,
-- so that rule is enforced in staging.stg_sales_target as a REJ-DOMAIN-001 rejection
-- and asserted by DQ-TGT-006. Every other scope rule IS a CHECK below.
--
-- MEASURE ADDITIVITY
--   Additive across store and month WITHIN one scope type and one kpi_id:
--     target_value, stretch_target_value.
--   NEVER additive across scope types: see the refinement rule above.
--
-- PRIVACY: no personal data. An employee-scope row would carry a surrogate key into
-- warehouse.dim_employee, which holds a synthetic identifier and no name, no pay plan
-- and no contact detail.

CREATE TABLE IF NOT EXISTS warehouse.fact_sales_target (
    sales_target_key        bigint         NOT NULL,
    target_month_date_key   integer        NOT NULL,
    dealership_key          integer        NOT NULL,
    target_scope_type       varchar(12)    NOT NULL,
    target_scope_id         varchar(40)    NOT NULL,
    department_name         varchar(20)    NULL,
    employee_key            integer        NULL,
    kpi_id                  varchar(16)    NOT NULL,
    target_value            numeric(14,2)  NOT NULL,
    stretch_target_value    numeric(14,2)  NOT NULL,
    source_system           varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_sales_target
        PRIMARY KEY (sales_target_key),
    -- THE declared grain, enforced. Five NOT NULL columns, so PostgreSQL's
    -- NULL-distinctness rule cannot let a duplicate logical target through.
    CONSTRAINT uq_fact_sales_target_grain
        UNIQUE (dealership_key, target_month_date_key, kpi_id,
                target_scope_type, target_scope_id),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_sales_target_key_positive
        CHECK (sales_target_key > 0),
    CONSTRAINT ck_fact_sales_target_scope_type_domain
        CHECK (target_scope_type IN ('Store', 'Department', 'Employee')),
    CONSTRAINT ck_fact_sales_target_scope_id_not_blank
        CHECK (btrim(target_scope_id) <> ''),
    CONSTRAINT ck_fact_sales_target_kpi_domain
        CHECK (kpi_id IN ('KPI-SLS-001', 'KPI-GRS-001', 'KPI-GRS-002', 'KPI-GRS-003')),
    CONSTRAINT ck_fact_sales_target_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- A target month always addresses the FIRST day of a month: YYYYMM01. Without
    -- this, the plan and the actual could disagree about what a month is.
    CONSTRAINT ck_fact_sales_target_month_key_is_first_of_month
        CHECK (target_month_date_key % 100 = 1),
    -- A negative goal is not a goal: it would invert every attainment ratio.
    CONSTRAINT ck_fact_sales_target_value_nonnegative
        CHECK (target_value >= 0),
    -- A stretch goal beneath the committed goal is not a stretch goal. Equality is
    -- permitted: a one-unit target multiplied by the stretch factor rounds back to
    -- one unit, and refusing that would forbid a legitimate small-store plan.
    CONSTRAINT ck_fact_sales_target_stretch_not_below_target
        CHECK (stretch_target_value >= target_value),
    -- department_name is present exactly on Department scope, and never elsewhere.
    CONSTRAINT ck_fact_sales_target_department_scope_coupling
        CHECK ((target_scope_type = 'Department') = (department_name IS NOT NULL)),
    -- The scope identity repeats the department, so the coupling is verifiable from
    -- the row alone rather than only from the loader that wrote it.
    CONSTRAINT ck_fact_sales_target_department_identity
        CHECK (department_name IS NULL OR department_name = target_scope_id),
    -- employee_key is present exactly on Employee scope, and never elsewhere.
    CONSTRAINT ck_fact_sales_target_employee_scope_coupling
        CHECK ((target_scope_type = 'Employee') = (employee_key IS NOT NULL)),
    -- Which metric each scope may target. This is the anti-double-counting rule:
    -- a department may not target total gross (it would overlap the store row) and a
    -- store may not carry a second, front-only gross plan beside its total-gross one.
    CONSTRAINT ck_fact_sales_target_scope_metric
        CHECK (
            (target_scope_type = 'Store'
                 AND kpi_id IN ('KPI-SLS-001', 'KPI-GRS-003'))
            OR (target_scope_type = 'Department'
                 AND ((department_name = 'Sales'   AND kpi_id = 'KPI-GRS-001')
                   OR (department_name = 'Finance' AND kpi_id = 'KPI-GRS-002')))
            OR (target_scope_type = 'Employee'
                 AND kpi_id = 'KPI-SLS-001')
        )
);

-- Conformed-dimension foreign keys. Declared with guarded ALTER TABLE rather than
-- inline, so that this file stays idempotent while still adding a constraint that a
-- database created by an earlier revision does not yet have.
DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_sales_target_month',      'target_month_date_key', 'dim_date',       'date_key'),
            ('fk_fact_sales_target_dealership', 'dealership_key',        'dim_dealership', 'dealership_key'),
            ('fk_fact_sales_target_employee',   'employee_key',          'dim_employee',   'employee_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_sales_target ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

-- The reporting view reads targets by store and month, and the export reads them in
-- grain order. One index on the two columns every read filters on.
CREATE INDEX IF NOT EXISTS ix_fact_sales_target_store_month
    ON warehouse.fact_sales_target (dealership_key, target_month_date_key);

COMMENT ON TABLE warehouse.fact_sales_target IS
    'Grain: one row per dealership, per target scope (Store, Department or Employee), per targeted KPI, '
    'per calendar month, enforced by uq_fact_sales_target_grain over five NOT NULL columns. The monthly '
    'operating PLAN, not the result. EVERY VALUE IS A SYNTHETIC INTERNAL OPERATING GOAL FOR THE '
    'FICTIONAL GRANITE AUTO GROUP AND IS NEVER AN INDUSTRY BENCHMARK, A MANUFACTURER OBJECTIVE OR A REAL '
    'DEALERSHIP TARGET. kpi_id names the metric BEING TARGETED, never a KPI-TGT identifier: the target '
    'KPIs are computed FROM these rows by reporting.vw_target_attainment. Department and Employee rows '
    'are REFINEMENTS of the store plan, never addends -- a store total reads Store-scope rows only, and '
    'summing every scope would double-count the store''s gross. Retail units are store-scope only '
    'because a unit is delivered once. Absence of a row means NO TARGET SET, which is not the same '
    'statement as a target of zero.';

COMMENT ON COLUMN warehouse.fact_sales_target.sales_target_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by the declared grain.';
COMMENT ON COLUMN warehouse.fact_sales_target.target_month_date_key IS 'Foreign key to warehouse.dim_date, always the FIRST day of the target month (YYYYMM01). Conforms to the shared calendar, so the plan and the actual agree on what a month is, and supplies the selling-day denominator every pace measure uses.';
COMMENT ON COLUMN warehouse.fact_sales_target.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store the plan belongs to. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_sales_target.target_scope_type IS 'Store, Department or Employee. Part of the declared grain. Decides which actual is the comparable numerator and whether the row is a store total or a refinement of one.';
COMMENT ON COLUMN warehouse.fact_sales_target.target_scope_id IS 'Business identity of the scope, NOT NULL on every scope type: the store''s dealership_id, the department name, or the employee''s synthetic identifier. Non-null so the grain constraint is not defeated by PostgreSQL treating NULLs as distinct.';
COMMENT ON COLUMN warehouse.fact_sales_target.department_name IS 'Sales or Finance, on a Department-scope row only, and NULL on every other scope (ck_fact_sales_target_department_scope_coupling). Sales owns front-end gross and Finance owns back-end gross, which partition total gross exactly.';
COMMENT ON COLUMN warehouse.fact_sales_target.employee_key IS 'Foreign key to warehouse.dim_employee, on an Employee-scope row only, and NULL on every other scope (ck_fact_sales_target_employee_scope_coupling). DASH.5 generates no employee-scope row; the column exists because the scope vocabulary is permanent. dim_employee holds a synthetic identifier and no name, pay plan or contact detail.';
COMMENT ON COLUMN warehouse.fact_sales_target.kpi_id IS 'The metric BEING TARGETED: KPI-SLS-001 (retail units), KPI-GRS-003 (total gross), KPI-GRS-001 (front-end gross, Sales department) or KPI-GRS-002 (back-end gross, Finance department). NEVER a KPI-TGT identifier.';
COMMENT ON COLUMN warehouse.fact_sales_target.target_value IS 'The month''s committed goal, exact numeric(14,2). A unit target is a whole number carried at cent scale (57.00); a gross target is USD to the cent. A synthetic internal operating goal, never a benchmark. Additive within one scope type and one kpi_id, and never across scope types.';
COMMENT ON COLUMN warehouse.fact_sales_target.stretch_target_value IS 'The month''s stretch goal, never below target_value. Governed data with no DASH.5 console surface: it is exported nowhere yet and is reserved for the management-planning surfaces later increments own.';
COMMENT ON COLUMN warehouse.fact_sales_target.source_system IS 'Originating system; constant arpi_synthetic_generator. The lineage marker that stops a reader mistaking a synthetic operating goal for a real dealership plan.';
