-- =============================================================================
-- File:            sql/08_validation/14_recon_inventory_units.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement the RECON-INV-UNIT-* family: prove reporting.vw_inventory_units agrees with reporting.vw_inventory_snapshots on price_to_market_ratio, and that its reportable-date narrowing preserves the fact grain exactly.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and before 18_recon_all.sql, which unions this view.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- `reporting.vw_inventory_units` is the console's unit-grain surface (`DASH.9`). It reads
-- `warehouse.fact_vehicle_inventory_snapshot` DIRECTLY rather than reading
-- `reporting.vw_inventory_snapshots`, because it needs window functions over a narrowed set
-- of dates and the snapshots view does not publish that narrowing.
--
-- That decision has a cost, and this file is the price. Reading the fact directly means the
-- units view REPEATS the `price_to_market_ratio` expression instead of selecting it, so the
-- project now states the same rule in two places. Two copies of a rule is exactly how two
-- surfaces come to disagree about a measure that carries one name: the Executive figure and
-- the unit table would both look right, and only a reader comparing them would find out.
--
-- The mitigation is not "be careful". It is this rule, which re-proves the equality on every
-- database run, and which fails if either expression is edited without the other.
--
-- WHAT RECON-INV-UNIT-RATIO PROVES
-- ---------------------------------
-- For every row the two views share, the ratio is the SAME -- and, just as importantly, it
-- is NULL in the same places. `IS DISTINCT FROM` is the operator that says both at once:
-- `NULL IS DISTINCT FROM NULL` is false, so aligned absences agree, while an absence on one
-- side and a number on the other is a disagreement. Written with `<>` the NULL rows would
-- compare to NULL, the WHERE would discard them, and the rule would quietly stop checking
-- the branch most likely to be wrong -- the roughly 8% of units with no market estimate,
-- where "no ratio" must never become zero.
--
-- Tolerance 0. Both sides `round(..., 4)` the same division of the same two columns, so
-- there is no floating-point slack for a tolerance to absorb. Anything a tolerance would
-- hide here is a defect.
--
-- WHAT RECON-INV-UNIT-GRAIN PROVES
-- ---------------------------------
-- The units view narrows the fact to month ends plus the latest snapshot date, and then runs
-- `lag()` over that narrowed set partitioned by `(vehicle_key, dealership_key)`. Two things
-- can go wrong in that shape and neither shows up as an error:
--
--   * the join to `reportable_dates` fans out and a unit appears twice on one date, which
--     would double every count and every investment total on `/dashboard/inventory`;
--   * the narrowing drops rows the fact holds on those dates, which would understate the lot
--     while looking entirely plausible.
--
-- So the rule compares the view's row count against the fact's own count on the same set of
-- dates, and separately asserts the view's declared grain is unique. Both must hold.
--
-- WHAT THESE RULES ARE NOT
-- ------------------------
-- They are technical agreement between two layers of this project. They say nothing about
-- whether a price is right, whether a unit should be marked down, or whether the synthetic
-- market estimate resembles any real market. It does not: see
-- DATA_DICTIONARY.md section 15.5 and LIMITATIONS.md.

CREATE OR REPLACE VIEW audit.vw_recon_inventory_units AS
WITH ratio_disagreements AS (
    -- THE JOIN GOES THROUGH THE DIMENSIONS, and that is not incidental. The two views do
    -- not share a grain vocabulary: vw_inventory_snapshots publishes surrogate keys, and
    -- vw_inventory_units deliberately publishes none -- no warehouse surrogate crosses the
    -- console boundary. So the comparison resolves the units view's business identifiers
    -- back to keys, which is exactly the mapping a reader holding both outputs would have
    -- to perform, and is therefore the comparison worth proving.
    SELECT count(*)::numeric AS disagreeing_rows
    FROM reporting.vw_inventory_units AS u
    JOIN warehouse.dim_date        AS d  ON d.full_date     = u.snapshot_date
    JOIN warehouse.dim_dealership  AS dl ON dl.dealership_id = u.dealership_id
    JOIN warehouse.dim_vehicle     AS v  ON v.vehicle_id     = u.vehicle_id
    JOIN reporting.vw_inventory_snapshots AS s
      ON  s.snapshot_date_key = d.date_key
      AND s.dealership_key    = dl.dealership_key
      AND s.vehicle_key       = v.vehicle_key
    WHERE u.price_to_market_ratio IS DISTINCT FROM s.price_to_market_ratio
),
grain AS (
    SELECT
        (SELECT count(*) FROM reporting.vw_inventory_units)::numeric        AS view_rows,
        (SELECT count(*) FROM (
            SELECT DISTINCT snapshot_date, dealership_id, vehicle_id
            FROM reporting.vw_inventory_units
         ) AS g)::numeric                                                   AS distinct_grain,
        -- The fact's own count on exactly the dates the view reports on, derived the same
        -- way the view derives them. If the narrowing itself is wrong both sides move
        -- together, which is why the grain rule above is asked separately.
        (SELECT count(*)
         FROM warehouse.fact_vehicle_inventory_snapshot AS f
         JOIN warehouse.dim_date AS d ON d.date_key = f.snapshot_date_key
         WHERE d.full_date IN (SELECT DISTINCT snapshot_date FROM reporting.vw_inventory_units)
        )::numeric                                                          AS fact_rows
)

-- RECON-INV-UNIT-RATIO --------------------------------------------------------
SELECT
    'RECON-INV-UNIT-RATIO'::text                            AS reconciliation_id,
    format('price_to_market_ratio agrees between reporting.vw_inventory_units and '
           'reporting.vw_inventory_snapshots on every shared row: %s disagreeing rows. '
           'The units view reads the fact directly and therefore repeats the expression '
           'rather than selecting it, so this is what notices if one copy is edited and '
           'the other is not. NULL counts as a value here: an absent estimate must yield '
           'an absent ratio on both sides, never a zero on either.',
           r.disagreeing_rows)::text                        AS description,
    'reporting.vw_inventory_units'::text                    AS left_source,
    r.disagreeing_rows                                      AS left_value,
    'reporting.vw_inventory_snapshots'::text                AS right_source,
    0::numeric                                              AS right_value,
    0::numeric                                              AS tolerance,
    CASE WHEN r.disagreeing_rows = 0 THEN 'passed' ELSE 'failed' END::text AS status
FROM ratio_disagreements AS r

UNION ALL

-- RECON-INV-UNIT-GRAIN --------------------------------------------------------
SELECT
    'RECON-INV-UNIT-GRAIN'::text,
    format('reporting.vw_inventory_units holds one row per store, unit and reportable date: '
           '%s rows against %s distinct grain keys, and %s rows in the warehouse fact on the '
           'same dates. The view narrows the fact to month ends plus the latest snapshot and '
           'then windows over that set, so a fan-out would double every count the inventory '
           'route publishes and a dropped row would understate the lot.',
           g.view_rows, g.distinct_grain, g.fact_rows)::text,
    'reporting.vw_inventory_units'::text,
    g.view_rows,
    'warehouse.fact_vehicle_inventory_snapshot'::text,
    g.fact_rows,
    0::numeric,
    CASE
        WHEN g.view_rows = g.distinct_grain AND g.view_rows = g.fact_rows THEN 'passed'
        ELSE 'failed'
    END::text
FROM grain AS g;

COMMENT ON VIEW audit.vw_recon_inventory_units IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'RECON-INV-UNIT-RATIO proves the two reporting views state the same price_to_market_ratio, '
    'including agreeing on where it is absent; RECON-INV-UNIT-GRAIN proves the unit view''s '
    'reportable-date narrowing neither duplicates nor drops a snapshot. Technical agreement '
    'between layers of this project only: neither rule says anything about a real market or a '
    'real price. Unioned into audit.vw_recon_all.';
