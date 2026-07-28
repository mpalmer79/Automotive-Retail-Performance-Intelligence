-- =============================================================================
-- File:            sql/02_staging/02_stg_cast_functions.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Non-throwing cast helpers that let a staging view drop one malformed row instead of failing the whole load.
-- Execution order: 19 of 66 — after the Phase 0 staging views, before every Phase 1 staging view that calls these functions.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE FUNCTION only; a function holds no state, so a rerun redefines it identically.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           n/a (scalar functions)
-- =============================================================================
--
-- WHY THESE EXIST
-- ---------------
-- A plain `'not-a-date'::date` does not reject a row: it aborts the statement, and
-- with it the whole staging view, the whole merge and the whole load. That makes
-- "staging drops bad rows" impossible to implement honestly — the only outcomes
-- are all rows or no rows.
--
-- Each function below attempts the cast and returns NULL when it cannot be done.
-- The caller then decides what NULL means: `staging.stg_<entity>_typed` compares
-- the NULL result against the trimmed source text, so it can tell "the value was
-- absent" (REJ-NULL-001) apart from "the value was present but unrepresentable"
-- (REJ-TYPE-001). Those two are different defects and must not be conflated.
--
-- WHY NOT A REGEX GUARD INSTEAD
-- -----------------------------
-- A regex can approve `2025-02-30`, `2025-13-01` and `99999999999999999999`, all of
-- which still raise on cast. Catching the exception is the only formulation that is
-- exactly as strict as PostgreSQL itself, which is the strictness that matters: the
-- warehouse column is what the value must ultimately fit.
--
-- DECLARED VOLATILITY
-- -------------------
-- IMMUTABLE: the result depends only on the argument. STRICT: NULL in, NULL out,
-- so the planner can skip the call entirely for absent values. PARALLEL SAFE: no
-- side effects, no shared state. Together these let the planner inline the calls
-- into a sequential scan; a staging view over a few hundred thousand rows costs a
-- fraction of a second.
--
-- No money value is ever routed through a float. fn_try_money returns
-- numeric(12,2), the exact type every ARPI money column uses.

CREATE OR REPLACE FUNCTION staging.fn_try_smallint(p_value text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    RETURN p_value::smallint;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_smallint(text) IS
    'Cast text to smallint, or return NULL when the value is not a smallint. Used by the Phase 1 staging '
    'views so that one malformed source value quarantines its own row instead of aborting the load.';

CREATE OR REPLACE FUNCTION staging.fn_try_integer(p_value text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    RETURN p_value::integer;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_integer(text) IS
    'Cast text to integer, or return NULL when the value is not an integer.';

CREATE OR REPLACE FUNCTION staging.fn_try_bigint(p_value text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    RETURN p_value::bigint;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_bigint(text) IS
    'Cast text to bigint, or return NULL when the value is not a bigint.';

CREATE OR REPLACE FUNCTION staging.fn_try_money(p_value text)
RETURNS numeric(12, 2)
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    -- numeric(12,2) is the governed money type for the whole warehouse. A value with
    -- more than ten integral digits overflows it and is a rejection, not a rounding
    -- opportunity; a value with more than two decimal places is rounded by the cast,
    -- exactly as it would be on insert into the target column.
    RETURN p_value::numeric(12, 2);
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_money(text) IS
    'Cast text to numeric(12,2), the governed ARPI money type, or return NULL when the value is not a '
    'number or does not fit. Never routes a money value through a floating-point type.';

CREATE OR REPLACE FUNCTION staging.fn_try_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    RETURN p_value::date;
EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_date(text) IS
    'Cast text to date, or return NULL when the value is not a date. Rejects 2025-02-30 and 2025-13-01 '
    'as firmly as PostgreSQL does, which a regular expression cannot.';

CREATE OR REPLACE FUNCTION staging.fn_try_boolean(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
    RETURN p_value::boolean;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION staging.fn_try_boolean(text) IS
    'Cast text to boolean, or return NULL when the value is not a boolean. The ARPI CSV dialect writes '
    'lower-case true/false, which PostgreSQL accepts natively.';
