-- =============================================================================
-- File:            sql/05_reporting/41_vw_gross_change_bridge.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Deterministic, non-causal decomposition of month-over-month total-gross change into volume, front-PVR and back-PVR effects, published as exact numerators over a shared denominator.
-- Execution order: Reporting layer, after reporting.vw_vehicle_sales and reporting.vw_calendar exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per comparison-period pair per bridge component. Three components per store-month.
-- =============================================================================
--
-- WHAT THIS VIEW IS, AND WHAT IT IS NOT
-- -------------------------------------
-- It is an ATTRIBUTION under a documented arithmetic order. Given two comparable
-- periods it answers "how much of the total-gross change is assigned to selling a
-- different number of units, and how much to earning a different amount per unit".
--
-- It is NOT causal. It does not know why volume moved, and nothing derived from it
-- may claim that a person, a department, an inventory position or a marketing spend
-- caused any part of the change. The approved phrasing is "the bridge attributes",
-- "the documented decomposition assigns", "under the sequential bridge". A causal
-- claim needs a method this project has not built.
--
-- THE DECOMPOSITION, AND WHY THIS ORDER
-- -------------------------------------
-- With U units, F front gross per retail unit and B back gross per retail unit, in
-- the comparison period (0) and the current period (1):
--
--   volume effect     = (U1 - U0) * (F0 + B0)      priced at the BASELINE rate
--   front PVR effect  = U1 * (F1 - F0)             valued at the CURRENT volume
--   back PVR effect   = U1 * (B1 - B0)             valued at the CURRENT volume
--
-- Summing gives U1*(F1 + B1) - U0*(F0 + B0), which is exactly the total-gross change.
-- The order is the standard sequential bridge: volume is measured first at the old
-- rate, then rate changes are measured on the new volume. The interaction term
-- (U1 - U0) * ((F1 + B1) - (F0 + B0)) is therefore carried inside the two rate
-- effects rather than being split out. A different order would assign different
-- amounts to each component while producing the same total; this one is chosen,
-- documented, and fixed, because a bridge whose order is unstated is not reproducible.
--
-- NO MIX EFFECT. A new/used mix component is a legitimate fourth term, but only once
-- its position in the sequence and its exact reconciliation are specified. Adding it
-- undocumented would silently change what the other three components mean.
--
-- WHY NUMERATORS AND A SHARED DENOMINATOR, NOT DOLLAR AMOUNTS
-- -----------------------------------------------------------
-- F0 = FG0 / U0 is a division, and numeric division is not exact. Computing three
-- effects from rounded per-unit rates and then asserting they sum to the period
-- delta asserts something that is not quite true, and the residual would land
-- wherever the rounding happened to fall.
--
-- So the view never divides. Each component is published as an exact numerator over
-- the shared denominator U0:
--
--   volume            numerator = (U1 - U0) * TG0
--   front PVR         numerator = U0 * FG1 - U1 * FG0
--   back PVR          numerator = U0 * BG1 - U1 * BG0
--
-- Their sum is (U1 - U0)*TG0 + U0*TG1 - U1*TG0 = U0 * (TG1 - TG0), identically, in
-- exact numeric arithmetic with no division anywhere. That is the reconciliation the
-- integration suite asserts, and it holds to the last digit rather than to the cent.
--
-- effect_amount is published too, as numerator / denominator, because a store-month
-- is a legitimate place to read the dollar figure. It is a convenience at THIS grain
-- and carries the rounding that division implies. A consumer that needs the identity
-- must use the numerators; a consumer that displays dollars and needs its column to
-- add up must show the rounding residual it created rather than hiding it.
--
-- COMPARABILITY IS A STATED FACT, NOT AN ABSENCE
-- ----------------------------------------------
-- A bridge needs a baseline rate, and a baseline rate needs U0 > 0. When the
-- comparison month sold no retail units there is no rate to price the volume change
-- at, and every alternative is a lie: dividing by zero fails, substituting a zero PVR
-- claims the store earned nothing per unit, and omitting the row makes a real month
-- silently disappear.
--
-- The row is therefore always emitted, with is_comparable = false, a reason, NULL
-- component amounts -- and total_gross_change still populated, because the period
-- change itself is perfectly well defined even when its decomposition is not.
--
-- Two reasons are distinguished, because they are different facts about the world:
--   comparison-period-outside-window  the prior month is before the reporting window;
--                                     nothing is known about it.
--   comparison-period-no-retail-units the prior month is in the window and sold none.
--
-- THE COMPARISON IS MONTH OVER MONTH
-- ----------------------------------
-- Prior calendar month, per store. That is the dealership's own reporting rhythm, it
-- matches the console's default period and its default prior-period comparison, and
-- it is a closed set of pairs a view can enumerate. A prior-year pair is not
-- published: the development profile covers six months, so every prior-year
-- comparison would be non-comparable, and publishing a column that is always empty
-- teaches a reader nothing.

CREATE OR REPLACE VIEW reporting.vw_gross_change_bridge AS
WITH monthly AS (
    SELECT
        s.dealership_key                                      AS dealership_key,
        c.month_start_date                                    AS month_start_date,
        sum(s.retail_unit_count)::bigint                      AS retail_units_sold,
        sum(s.retail_front_end_gross)                         AS front_end_gross,
        sum(s.retail_back_end_gross)                          AS back_end_gross,
        sum(s.retail_total_gross)                             AS total_gross
    FROM reporting.vw_vehicle_sales AS s
    JOIN reporting.vw_calendar AS c
           ON c.date_key = s.sale_date_key
    GROUP BY s.dealership_key, c.month_start_date
),
window_bounds AS (
    SELECT min(month_start_date) AS first_month FROM monthly
),
paired AS (
    SELECT
        m.dealership_key                                      AS dealership_key,
        m.month_start_date                                    AS month_start_date,
        (m.month_start_date - interval '1 month')::date       AS comparison_month_start_date,
        m.retail_units_sold                                   AS retail_units_sold,
        m.front_end_gross                                     AS front_end_gross,
        m.back_end_gross                                      AS back_end_gross,
        m.total_gross                                         AS total_gross,
        coalesce(p.retail_units_sold, 0)                      AS comparison_retail_units_sold,
        coalesce(p.front_end_gross, 0)                        AS comparison_front_end_gross,
        coalesce(p.back_end_gross, 0)                         AS comparison_back_end_gross,
        coalesce(p.total_gross, 0)                            AS comparison_total_gross,
        ((m.month_start_date - interval '1 month')::date < w.first_month)
                                                              AS comparison_outside_window
    FROM monthly AS m
    CROSS JOIN window_bounds AS w
    LEFT JOIN monthly AS p
           ON p.dealership_key = m.dealership_key
          AND p.month_start_date = (m.month_start_date - interval '1 month')::date
),
components AS (
    SELECT
        p.*,
        component.ordinal                                     AS component_ordinal,
        component.code                                        AS component_code,
        component.label                                       AS component_label,
        -- The exact numerator of each effect, over the shared denominator
        -- comparison_retail_units_sold. No division occurs anywhere in this view's
        -- reconciled arithmetic.
        CASE component.code
            WHEN 'volume'
                THEN (p.retail_units_sold - p.comparison_retail_units_sold)
                     * p.comparison_total_gross
            WHEN 'front_pvr'
                THEN p.comparison_retail_units_sold * p.front_end_gross
                     - p.retail_units_sold * p.comparison_front_end_gross
            ELSE p.comparison_retail_units_sold * p.back_end_gross
                 - p.retail_units_sold * p.comparison_back_end_gross
        END                                                   AS effect_numerator
    FROM paired AS p
    CROSS JOIN LATERAL (
        VALUES
            (1, 'volume',    'Volume effect'),
            (2, 'front_pvr', 'Front PVR effect'),
            (3, 'back_pvr',  'Back PVR effect')
    ) AS component(ordinal, code, label)
)
SELECT
    c.dealership_key                                          AS dealership_key,
    c.month_start_date                                        AS month_start_date,
    c.comparison_month_start_date                             AS comparison_month_start_date,
    c.component_ordinal                                       AS component_ordinal,
    c.component_code                                          AS component_code,
    c.component_label                                         AS component_label,

    -- Period figures, repeated on every component row so one row is self-describing.
    c.retail_units_sold                                       AS retail_units_sold,
    c.comparison_retail_units_sold                            AS comparison_retail_units_sold,
    c.front_end_gross                                         AS front_end_gross,
    c.comparison_front_end_gross                              AS comparison_front_end_gross,
    c.back_end_gross                                          AS back_end_gross,
    c.comparison_back_end_gross                               AS comparison_back_end_gross,
    c.total_gross                                             AS total_gross,
    c.comparison_total_gross                                  AS comparison_total_gross,

    -- The period change. Defined whether or not the decomposition is.
    (c.total_gross - c.comparison_total_gross)                AS total_gross_change,

    -- Comparability, stated rather than implied.
    (c.comparison_retail_units_sold > 0)                      AS is_comparable,
    CASE
        WHEN c.comparison_retail_units_sold > 0 THEN NULL
        WHEN c.comparison_outside_window THEN 'comparison-period-outside-window'
        ELSE 'comparison-period-no-retail-units'
    END                                                       AS not_comparable_reason,

    -- The decomposition. Exact numerator over the shared denominator.
    CASE WHEN c.comparison_retail_units_sold > 0
         THEN c.effect_numerator END                          AS effect_numerator,
    nullif(c.comparison_retail_units_sold, 0)                 AS effect_denominator,
    CASE WHEN c.comparison_retail_units_sold > 0
         THEN c.effect_numerator / c.comparison_retail_units_sold
         END                                                  AS effect_amount
FROM components AS c;

COMMENT ON VIEW reporting.vw_gross_change_bridge IS
    'Grain: one row per dealership per comparison-period pair per bridge component -- three components '
    '(volume, front PVR, back PVR) per store-month. Date basis: sale date, aggregated to calendar month. '
    'ATTRIBUTION UNDER A DOCUMENTED ARITHMETIC ORDER, NOT CAUSATION: the bridge assigns total-gross change '
    'to selling a different number of units and to earning a different amount per unit; it does not know '
    'why either moved, and no consumer may claim a person, department, inventory position or marketing '
    'spend caused any part of it. Order is the standard sequential bridge -- volume priced at the baseline '
    'rate, then each rate change valued at the current volume -- so the interaction term sits inside the '
    'two rate effects rather than being split out; a different order would assign different amounts for '
    'the same total, which is why this one is fixed and documented. No mix component: a new/used term is '
    'legitimate but only once its position in the sequence and its exact reconciliation are specified. '
    'NO DIVISION OCCURS IN THE RECONCILED ARITHMETIC: each effect is published as an exact numerator over '
    'the shared denominator comparison_retail_units_sold, and the three numerators sum identically to '
    'comparison_retail_units_sold * total_gross_change in exact numeric, to the last digit rather than to '
    'the cent. effect_amount is the convenience quotient at THIS grain and carries the rounding division '
    'implies; a consumer needing the identity must use the numerators, and one displaying dollars must '
    'show any rounding residual rather than hiding it. A bridge needs a baseline rate and therefore needs '
    'comparison units above zero: when there are none the row is still emitted with is_comparable false, a '
    'reason, NULL components and a populated total_gross_change, because the period change is well defined '
    'even when its decomposition is not. Comparison is the prior calendar month per store; no prior-year '
    'pair is published because the development profile covers six months and the column would always be '
    'empty. Export-eligible: yes, as dashboard dataset gross-change-bridge.';

COMMENT ON COLUMN reporting.vw_gross_change_bridge.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model. Resolved to the GSA-00# business code by the dashboard export.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.month_start_date IS 'First day of the current period: the calendar month being explained. Part of the business key.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.comparison_month_start_date IS 'First day of the comparison period, always the prior calendar month. Populated even when that month is outside the reporting window, so the pair is always identifiable.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.component_ordinal IS 'Presentation order of the component within the bridge: 1 volume, 2 front PVR, 3 back PVR. Reading order is part of the decomposition, so it is published rather than left to the consumer.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.component_code IS 'Stable component identifier: volume, front_pvr or back_pvr. Part of the business key.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.component_label IS 'Human-readable component name, published so every consumer names the component identically.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.retail_units_sold IS 'KPI-SLS-001 for the current month. Repeated on each component row so a single row is self-describing.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.comparison_retail_units_sold IS 'KPI-SLS-001 for the comparison month, and the shared denominator of all three effects. Zero means the bridge is not comparable.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.front_end_gross IS 'KPI-GRS-001 for the current month.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.comparison_front_end_gross IS 'KPI-GRS-001 for the comparison month. Zero when that month is outside the window or sold nothing; read is_comparable before interpreting it.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.back_end_gross IS 'KPI-GRS-002 for the current month.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.comparison_back_end_gross IS 'KPI-GRS-002 for the comparison month.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.total_gross IS 'KPI-GRS-003 for the current month.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.comparison_total_gross IS 'KPI-GRS-003 for the comparison month.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.total_gross_change IS 'Current total gross less comparison total gross. The quantity the bridge decomposes, and the one figure that stays meaningful when the decomposition is not available.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.is_comparable IS 'True when the comparison month sold at least one retail unit, which is what makes a baseline per-unit rate exist. False means the components are NULL and only total_gross_change may be read.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.not_comparable_reason IS 'NULL when comparable. Otherwise comparison-period-outside-window (the prior month precedes the reporting window, so nothing is known about it) or comparison-period-no-retail-units (the prior month is in the window and sold none). The two are different facts and are not collapsed.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.effect_numerator IS 'Exact numerator of this component over effect_denominator. Volume: (U1 - U0) * TG0. Front PVR: U0 * FG1 - U1 * FG0. Back PVR: U0 * BG1 - U1 * BG0. The three numerators for one store-month sum identically to effect_denominator * total_gross_change, with no division anywhere. NULL when not comparable.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.effect_denominator IS 'The shared denominator of all three effects: comparison_retail_units_sold. NULL rather than zero when not comparable, so a consumer cannot divide by it accidentally.';
COMMENT ON COLUMN reporting.vw_gross_change_bridge.effect_amount IS 'effect_numerator / effect_denominator: the component in dollars, valid at THIS grain. A convenience that carries the rounding division implies -- three rounded amounts need not sum to a rounded total_gross_change, and a consumer displaying them must show the residual rather than hiding it. Use the numerators for the identity. NULL when not comparable.';
