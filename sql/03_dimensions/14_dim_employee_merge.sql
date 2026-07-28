-- =============================================================================
-- File:            sql/03_dimensions/14_dim_employee_merge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Idempotent SCD Type 2 merge of staging.stg_employee into warehouse.dim_employee.
-- Execution order: 43 of 66 in the initialisation sequence, and at runtime by the Python loader after every CSV load.
-- Idempotency:     Rerunning with an unchanged attribute_hash writes zero rows. Statement 1 updates nothing and statement 2 inserts nothing. An empty staging view is a no-op.
-- Ownership:       Executed by arpi_loader. Creates no objects.
-- Grain:           One row per employee role-assignment version (warehouse.dim_employee grain).
-- =============================================================================

--
-- RUNTIME CONTRACT — READ BEFORE EDITING
-- --------------------------------------
-- src/arpi/ingestion/loader.py globs sql/03_dimensions/*_merge.sql, sorts by file
-- name and executes each file's whole text through psycopg's cursor.execute().
-- Plain SQL only: no psql meta-commands, no BEGIN/COMMIT (the loader owns the
-- transaction), statements separated by semicolons. The script must also be safe
-- to run inside the ordinary initialisation sequence against an empty database:
-- with no raw rows the staging view yields nothing and every statement affects
-- zero rows.
--
-- CHANGE DETECTION IS THE GENERATOR'S HASH, NOT A RECOMPUTATION
-- ------------------------------------------------------------
-- Agent D computes attribute_hash in Python as the SHA-256 of tracked attributes
-- 3-9 joined with the pipe character, UTF-8:
--
--   dealership_id|department|job_role|hire_date|termination_date|is_active|is_manager
--
-- NULL serialises as the empty string, booleans as lower-case true/false and dates
-- as ISO YYYY-MM-DD. The generator asserts this worked example against its literal
-- digest:
--
--   GSA-003|Sales|Salesperson|2021-05-04||true|false
--
-- This script NEVER recomputes that digest: it carries the generator's value
-- through staging unchanged and only compares it. Two implementations of one rule
-- is how a warehouse starts disagreeing with itself -- and here the failure mode is
-- specific and severe: a single byte of disagreement makes every employee look
-- changed on every run, so the Type 2 table grows a new version per load forever.
--
-- WHY TWO STATEMENTS, IN THIS ORDER
-- ---------------------------------
-- Statement 1 closes the ranges of versions that a newer version supersedes.
-- Statement 2 inserts the new versions. The order matters: inserting a second
-- current row for an employee while the first is still current would violate
-- uix_dim_employee_current_employee_id immediately. Both run in the loader's
-- single transaction, so a failure between them rolls everything back.
--
-- HOW A VERSION'S RANGE IS DERIVED
-- --------------------------------
--   expiration_date = (next version's effective_date - 1 day), or 9999-12-31
--                     when there is no next version
--   is_current      = (there is no next version)
-- Derived from the combined timeline rather than copied from the source, so the
-- ranges tile without gap or overlap by construction and the source's own
-- expiration_date/is_current columns are informational only.
--
-- SURROGATE KEY ASSIGNMENT (deterministic, documented choice)
-- ----------------------------------------------------------
-- employee_key is assigned as
--     (SELECT coalesce(max(employee_key), 0) FROM warehouse.dim_employee)
--     + row_number() OVER (ORDER BY employee_id, effective_date)
-- over the accepted versions only, not from a sequence, for the same reasons as
-- warehouse.dim_dealership: a first load into an empty dimension yields 1..N in
-- (employee_id, effective_date) order, rebuilding from the same CSVs reproduces
-- identical keys, and keys are never reused because the offset is always the
-- current maximum. A Type 2 change creates a version the source has no key for,
-- which is why source_employee_key is lineage only.

-- -----------------------------------------------------------------------------
-- Statement 1 of 2 — close the range of every stored version that the combined
-- timeline says is now superseded. A version whose range is already correct is
-- not touched, which is what makes a rerun a no-op.
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        s.employee_id,
        s.dealership_id,
        s.department,
        s.job_role,
        s.hire_date,
        s.termination_date,
        s.is_active,
        s.is_manager,
        s.tenure_band,
        s.effective_date,
        s.attribute_hash,
        s.source_system
    FROM staging.stg_employee AS s
),
candidate AS (
    -- Versions the dimension does not already hold at that exact effective_date.
    SELECT c.*
    FROM src AS c
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.dim_employee AS d
        WHERE d.employee_id = c.employee_id
          AND d.effective_date = c.effective_date
    )
),
sequenced AS (
    -- The combined timeline: what is stored, plus what staging proposes. Used only to
    -- evaluate the change-detection rule, never to write.
    SELECT employee_id, effective_date, attribute_hash, false AS is_candidate
    FROM warehouse.dim_employee
    UNION ALL
    SELECT employee_id, effective_date, attribute_hash, true
    FROM candidate
),
changed AS (
    -- A proposed version is a genuine change only when its attribute_hash differs from
    -- the version immediately preceding it on that combined timeline. A proposal whose
    -- hash matches its predecessor is a no-op: nothing about the employee changed.
    SELECT t.employee_id, t.effective_date
    FROM (
        SELECT
            employee_id,
            effective_date,
            attribute_hash,
            is_candidate,
            lag(attribute_hash) OVER (
                PARTITION BY employee_id ORDER BY effective_date
            ) AS previous_attribute_hash
        FROM sequenced
    ) AS t
    WHERE t.is_candidate
      AND (t.previous_attribute_hash IS NULL
           OR t.previous_attribute_hash <> t.attribute_hash)
),
accepted AS (
    SELECT c.*
    FROM candidate AS c
    JOIN changed AS ch
      ON ch.employee_id = c.employee_id
     AND ch.effective_date = c.effective_date
),
timeline AS (
    -- Stored versions plus the accepted new ones. This is what the ranges are derived
    -- from, so a rejected proposal cannot influence anybody's expiration_date.
    SELECT employee_id, effective_date FROM warehouse.dim_employee
    UNION ALL
    SELECT employee_id, effective_date FROM accepted
),
ranged AS (
    SELECT
        employee_id,
        effective_date,
        lead(effective_date) OVER (
            PARTITION BY employee_id ORDER BY effective_date
        ) AS next_effective_date
    FROM timeline
)
UPDATE warehouse.dim_employee AS d
SET expiration_date = coalesce(r.next_effective_date - 1, DATE '9999-12-31'),
    is_current      = (r.next_effective_date IS NULL)
FROM ranged AS r
WHERE r.employee_id = d.employee_id
  AND r.effective_date = d.effective_date
  AND (d.expiration_date, d.is_current) IS DISTINCT FROM (
        coalesce(r.next_effective_date - 1, DATE '9999-12-31'),
        (r.next_effective_date IS NULL)
      );

-- -----------------------------------------------------------------------------
-- Statement 2 of 2 — insert the accepted versions: brand-new employees, and the
-- successor versions of the employees whose ranges statement 1 just closed.
-- -----------------------------------------------------------------------------
WITH src AS (
    SELECT
        s.employee_id,
        s.dealership_id,
        s.department,
        s.job_role,
        s.hire_date,
        s.termination_date,
        s.is_active,
        s.is_manager,
        s.tenure_band,
        s.effective_date,
        s.attribute_hash,
        s.source_system
    FROM staging.stg_employee AS s
),
candidate AS (
    -- Versions the dimension does not already hold at that exact effective_date.
    SELECT c.*
    FROM src AS c
    WHERE NOT EXISTS (
        SELECT 1
        FROM warehouse.dim_employee AS d
        WHERE d.employee_id = c.employee_id
          AND d.effective_date = c.effective_date
    )
),
sequenced AS (
    -- The combined timeline: what is stored, plus what staging proposes. Used only to
    -- evaluate the change-detection rule, never to write.
    SELECT employee_id, effective_date, attribute_hash, false AS is_candidate
    FROM warehouse.dim_employee
    UNION ALL
    SELECT employee_id, effective_date, attribute_hash, true
    FROM candidate
),
changed AS (
    -- A proposed version is a genuine change only when its attribute_hash differs from
    -- the version immediately preceding it on that combined timeline. A proposal whose
    -- hash matches its predecessor is a no-op: nothing about the employee changed.
    SELECT t.employee_id, t.effective_date
    FROM (
        SELECT
            employee_id,
            effective_date,
            attribute_hash,
            is_candidate,
            lag(attribute_hash) OVER (
                PARTITION BY employee_id ORDER BY effective_date
            ) AS previous_attribute_hash
        FROM sequenced
    ) AS t
    WHERE t.is_candidate
      AND (t.previous_attribute_hash IS NULL
           OR t.previous_attribute_hash <> t.attribute_hash)
),
accepted AS (
    SELECT c.*
    FROM candidate AS c
    JOIN changed AS ch
      ON ch.employee_id = c.employee_id
     AND ch.effective_date = c.effective_date
),
timeline AS (
    -- Stored versions plus the accepted new ones. This is what the ranges are derived
    -- from, so a rejected proposal cannot influence anybody's expiration_date.
    SELECT employee_id, effective_date FROM warehouse.dim_employee
    UNION ALL
    SELECT employee_id, effective_date FROM accepted
),
ranged AS (
    SELECT
        employee_id,
        effective_date,
        lead(effective_date) OVER (
            PARTITION BY employee_id ORDER BY effective_date
        ) AS next_effective_date
    FROM timeline
),
keyed AS (
    SELECT
        (SELECT coalesce(max(x.employee_key), 0) FROM warehouse.dim_employee AS x)
            + row_number() OVER (ORDER BY a.employee_id, a.effective_date) AS employee_key,
        a.employee_id,
        a.dealership_id,
        a.department,
        a.job_role,
        a.hire_date,
        a.termination_date,
        a.is_active,
        a.is_manager,
        a.tenure_band,
        a.effective_date,
        coalesce(r.next_effective_date - 1, DATE '9999-12-31') AS expiration_date,
        (r.next_effective_date IS NULL) AS is_current,
        a.attribute_hash,
        a.source_system
    FROM accepted AS a
    JOIN ranged AS r
      ON r.employee_id = a.employee_id
     AND r.effective_date = a.effective_date
)
INSERT INTO warehouse.dim_employee (
    employee_key,
    employee_id,
    dealership_id,
    department,
    job_role,
    hire_date,
    termination_date,
    is_active,
    is_manager,
    tenure_band,
    effective_date,
    expiration_date,
    is_current,
    attribute_hash,
    source_system
)
SELECT
    k.employee_key,
    k.employee_id,
    k.dealership_id,
    k.department,
    k.job_role,
    k.hire_date,
    k.termination_date,
    k.is_active,
    k.is_manager,
    k.tenure_band,
    k.effective_date,
    k.expiration_date,
    k.is_current,
    k.attribute_hash,
    k.source_system
FROM keyed AS k;
