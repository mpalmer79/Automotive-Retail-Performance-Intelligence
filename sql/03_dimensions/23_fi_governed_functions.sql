-- =============================================================================
-- File:            sql/03_dimensions/23_fi_governed_functions.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the three governed F&I functions the reporting and validation layers share: the finance-structure derivation, the eligibility predicate, and the minimum-sample floor.
-- Execution order: Dimension layer, after warehouse.dim_finance_product exists and before any reporting or validation object calls these functions.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE FUNCTION only; defining a function writes no rows.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. EXECUTE is granted to arpi_reporter with the reporting views that call them.
-- Grain:           Not applicable (scalar functions).
-- =============================================================================
--
-- WHY THESE ARE FUNCTIONS AND NOT REPEATED EXPRESSIONS
-- ----------------------------------------------------
-- Each of the three answers a question that more than one object asks. Written inline in
-- each caller, the third copy is the one that eventually disagrees with the first two --
-- and a finance structure that means one thing in reporting.vw_deal_jacket and another in
-- reporting.vw_fi_summary is exactly the failure the whole increment exists to prevent.
--
-- ONE AUTHORITY PER LAYER, WITH THE EQUALITY PROVED
-- --------------------------------------------------
-- Python has its own single implementation of the first two, in
-- arpi.generation.fi_eligibility. Two languages cannot share one function body, so the
-- honest arrangement is one authority per layer plus a test that proves they agree:
-- tests/integration/test_fi_eligibility_parity.py evaluates BOTH over the whole input
-- cross product -- every sale type against a financed and an unfinanced amount, every
-- category against every structure and every vehicle condition -- and asserts they
-- return the same answer for every combination. That is a proof rather than a promise.

-- -----------------------------------------------------------------------------
-- warehouse.fn_finance_structure -- THE finance-structure derivation.
-- -----------------------------------------------------------------------------
-- Four branches, in this order:
--   Lease sale type                       -> 'Lease'
--   Wholesale / Dealer Trade              -> the same word (non-retail: no consumer)
--   Retail purchase, amount financed > 0  -> 'Retail Finance'
--   Retail purchase otherwise             -> 'Cash'
--
-- sale_type ITSELF IS UNTOUCHED. Promoting a stored structure column, or creating
-- warehouse.dim_sale_type, would need its own ADR and migration plan and neither is in
-- DASH.6; dim_sale_type remains Deferred.
--
-- NULL rather than a default on an unknown sale type. A default branch would silently
-- classify an unrecognised type as Cash, which would move it into the retail structure
-- mix and into three eligibility denominators. A NULL propagates and is visible.
CREATE OR REPLACE FUNCTION warehouse.fn_finance_structure(
    p_sale_type       varchar,
    p_amount_financed numeric
)
RETURNS varchar
LANGUAGE sql
IMMUTABLE
AS $fn_finance_structure$
    SELECT CASE
        WHEN p_sale_type = 'Lease'        THEN 'Lease'
        WHEN p_sale_type = 'Wholesale'    THEN 'Wholesale'
        WHEN p_sale_type = 'Dealer Trade' THEN 'Dealer Trade'
        WHEN p_sale_type IN ('New Retail', 'Used Retail', 'Certified Retail')
            THEN CASE WHEN coalesce(p_amount_financed, 0) > 0
                      THEN 'Retail Finance'
                      ELSE 'Cash'
                 END
    END::varchar;
$fn_finance_structure$;

COMMENT ON FUNCTION warehouse.fn_finance_structure(varchar, numeric) IS
    'THE finance-structure derivation for the SQL layer: Lease when the sale type is, Wholesale or Dealer '
    'Trade for a disposal, Retail Finance when a retail purchase financed something, Cash otherwise. '
    'Every SQL consumer calls this rather than repeating the CASE, because the third copy is the one that '
    'eventually disagrees. Returns NULL on an unrecognised sale type rather than defaulting to Cash: a '
    'default would move an unknown type into the retail structure mix and into three eligibility '
    'denominators without anything failing. sale_type itself is unchanged and warehouse.dim_sale_type '
    'remains Deferred. Mirrored in Python by arpi.generation.fi_eligibility.finance_structure_for, and '
    'the two are proved equal over the whole input cross product by '
    'tests/integration/test_fi_eligibility_parity.py.';

-- -----------------------------------------------------------------------------
-- warehouse.fn_product_category_is_eligible -- THE eligibility predicate.
-- -----------------------------------------------------------------------------
-- READS THE DIMENSION RATHER THAN RESTATING THE RULE. The predicate's authority is
-- config/reference/fi_product_eligibility.yaml; the generator stamps that configuration
-- onto warehouse.dim_finance_product as eligible_finance_structures and
-- eligible_vehicle_conditions; this function reads those columns. So the chain from
-- configuration to SQL answer has no second copy of the rule in it -- which is why the
-- pipe-delimited metadata columns exist at all, and why they are derived rather than
-- hand-declared beside the rule.
--
-- STABLE rather than IMMUTABLE: the answer depends on table contents, which is exactly
-- what makes it correct.
--
-- SECURITY DEFINER, AND WHY IT HAS TO BE
-- --------------------------------------
-- arpi_reporter holds SELECT on the `reporting` schema and NOTHING on `warehouse` -- that
-- separation is the whole point of the grant model. A view's own table reads run as the
-- view's owner, but a function called inside it runs as the INVOKER, so a SECURITY
-- INVOKER function reading warehouse.dim_finance_product fails with "permission denied
-- for schema warehouse" the moment a reporter selects reporting.vw_fi_product_penetration.
--
-- The alternatives were worse. Granting the reporter USAGE on warehouse would hand it the
-- whole lower layer to satisfy one lookup. Inlining the predicate into each view would
-- put a second and third copy of the rule in the repository, which is the one thing this
-- module exists to prevent. SECURITY DEFINER with a pinned search_path keeps the rule in
-- one place and widens nothing: the function takes three scalar arguments, returns a
-- boolean, reads exactly one table, and cannot be made to read another.
CREATE OR REPLACE FUNCTION warehouse.fn_product_category_is_eligible(
    p_product_category  varchar,
    p_finance_structure varchar,
    p_vehicle_condition varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, warehouse
AS $fn_product_category_is_eligible$
    SELECT EXISTS (
        SELECT 1
        FROM warehouse.dim_finance_product AS p
        WHERE p.product_category = p_product_category
          AND p_finance_structure
              = ANY (string_to_array(p.eligible_finance_structures, ' | '))
          AND p_vehicle_condition
              = ANY (string_to_array(p.eligible_vehicle_conditions, ' | '))
    );
$fn_product_category_is_eligible$;

COMMENT ON FUNCTION warehouse.fn_product_category_is_eligible(varchar, varchar, varchar) IS
    'Whether one governed product category could have been written on a deal of the given finance '
    'structure and vehicle condition. THE SQL SIDE OF ONE AUTHORITY: the predicate is defined in '
    'config/reference/fi_product_eligibility.yaml, stamped by the generator onto '
    'warehouse.dim_finance_product, and READ here -- so no layer restates the rule. Returns false for a '
    'Wholesale or Dealer Trade disposal, which no rule admits because a disposal has no consumer. '
    'ELIGIBILITY IS NOT SALES PROPENSITY: it answers whether the product COULD have been written, never '
    'whether a customer should buy it, and no customer attribute of any kind participates -- no '
    'demographic, no protected characteristic, no credit datum, no income, no age, no geography.';

-- -----------------------------------------------------------------------------
-- warehouse.fn_minimum_sample_floor -- the shared minimum-sample rule.
-- -----------------------------------------------------------------------------
-- The project-default floor beneath which an employee- or manager-level RATIO must not
-- be rendered as a comparable figure. A PROJECT DEFAULT FOR A FICTIONAL GROUP: not a
-- statistical significance threshold, not an industry convention, not a legal standard.
--
-- Written here once so the reporting views do not each hard-code a number.
-- arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS is the Python side of the same value, and
-- tests/integration/test_fi_reporting_views.py asserts the two agree -- one value per
-- layer with a proof of equality, rather than two values with a hope.
--
-- The views PUBLISH the components at every denominator and mark whether the floor was
-- met. They never blank a value: suppression is a rendering decision, and a reporting
-- layer that returned NULL below the floor would make the row indistinguishable from a
-- manager who genuinely had no eligible deals.
CREATE OR REPLACE FUNCTION warehouse.fn_minimum_sample_floor()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $fn_minimum_sample_floor$
    SELECT 10;
$fn_minimum_sample_floor$;

COMMENT ON FUNCTION warehouse.fn_minimum_sample_floor() IS
    'The project-default minimum eligible-deal count beneath which an employee- or manager-level ratio '
    'must not be rendered as a comparable figure: below it a consumer shows an explicit "insufficient '
    'sample (n = X)" state, excludes the row from ranking, and fires no action rule on it. A PROJECT '
    'DEFAULT FOR A FICTIONAL GROUP -- never a statistical significance threshold, an industry convention '
    'or a legal standard. The Python side is arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS and the two are '
    'asserted equal by the integration suite. The reporting views publish the components and a '
    'meets_minimum_sample flag and never blank a value themselves: suppression is a rendering decision, '
    'and a NULL here would be indistinguishable from a manager with no eligible deals at all.';
