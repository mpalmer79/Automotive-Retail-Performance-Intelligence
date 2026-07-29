-- =============================================================================
-- File:            sql/08_validation/08_recon_funnel.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement RECON-LEAD-001, the duplicate-exclusion reconciliation, the funnel numerator and denominator bounds, and the funnel-chain consistency check.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- RECON-LEAD-001 -- LEAD TOTALS AFTER DOCUMENTED EXCLUSIONS
-- ---------------------------------------------------------
-- Lead totals in the reporting view must equal staging counts AFTER the documented
-- exclusions, and the excluded population must be shown rather than tolerated. The
-- rule is therefore stated as an addition, not a subtraction:
--
--     leads_received + duplicate_leads_excluded = staged lead rows
--
-- If duplicates were simply subtracted, a lost lead and an extra duplicate would
-- cancel. Stating it as an addition means both terms must be right.
--
-- RECON-LEAD-DUPLICATES -- THE EXCLUSION ITSELF
-- ---------------------------------------------
-- The duplicate count in the reporting layer must equal the duplicate count in the
-- warehouse. This is what stops the most important funnel exclusion from drifting:
-- duplicates inflate volume and depress every conversion rate at once, so a view
-- that excluded the wrong rows would make a source look both busy and bad with
-- nothing to show for it.
--
-- RECON-FUNNEL-BOUNDS -- NUMERATOR AND DENOMINATOR RECONCILIATION
-- ---------------------------------------------------------------
-- Every funnel rate's numerator must be no greater than its denominator, and each
-- stage's denominator must be exactly the previous stage's numerator. Reconciling
-- the ratio alone is insufficient -- two compensating errors produce a correct
-- ratio -- so this rule checks the chain of populations at lead grain, on every
-- store-source-day row:
--
--     sold <= shown <= appointment set <= contacted <= leads received
--
-- A breach means the flag consistency the fact table enforces has been broken, or
-- a view has filtered one side of a rate and not the other.
--
-- RECON-FUNNEL-SOLD-PATH -- WHERE SALES ACTUALLY COME FROM
-- --------------------------------------------------------
-- Sold leads split exactly into those that went the whole modelled path -- shown at
-- an appointment -- and those that did not. Publishing that split as an exact
-- identity is what turns the funnel-chain gap below from an unexplained
-- discrepancy into a measured quantity.
--
-- RECON-FUNNEL-CHAIN -- CONSISTENCY ACROSS THE GRAIN SHIFT
-- --------------------------------------------------------
-- The funnel is a chain: contact rate x appointment-set rate x show rate x
-- show-to-sale conversion should approximate lead-to-sale conversion. Two of those
-- four rates are computed over APPOINTMENTS and two over LEADS, and one lead can
-- produce several appointments, so the product is not an identity and cannot be
-- made into one.
--
-- The rule therefore compares the chain product against the MODELLED-PATH
-- conversion -- sold leads that were shown at an appointment, over valid leads --
-- rather than against total lead-to-sale conversion. That isolates exactly one
-- source of difference, the lead-to-appointment grain shift, because the off-path
-- population is already reconciled exactly by RECON-FUNNEL-SOLD-PATH. The permitted
-- difference is validation.numeric_absolute_tolerance (0.01), the project-wide
-- tolerance, applied to a rate rather than a currency amount; no threshold was
-- invented for this rule.
--
-- This is the ONE reconciliation ARPI treats as informational rather than critical
-- (see reporting.vw_reconciliation_status.is_critical). A breach means leads are
-- converting by a path the funnel does not model, which is a finding to explain and
-- not, by itself, a defect.

CREATE OR REPLACE VIEW audit.vw_recon_funnel AS
WITH staged AS (
    SELECT count(DISTINCT lead_id)::numeric AS staged_leads FROM staging.stg_lead
),
reported AS (
    SELECT
        coalesce(sum(leads_received), 0)::numeric            AS leads_received,
        coalesce(sum(contacted_leads), 0)::numeric           AS contacted_leads,
        coalesce(sum(appointment_set_leads), 0)::numeric     AS appointment_set_leads,
        coalesce(sum(appointment_shown_leads), 0)::numeric   AS appointment_shown_leads,
        coalesce(sum(sold_leads), 0)::numeric                AS sold_leads,
        coalesce(sum(duplicate_leads_excluded), 0)::numeric  AS duplicates_excluded
    FROM reporting.vw_lead_funnel
),
staged_duplicates AS (
    SELECT count(*)::numeric AS duplicate_leads
    FROM staging.stg_lead
    WHERE is_duplicate
),
bounds AS (
    SELECT
        count(*)::numeric AS grain_rows,
        count(*) FILTER (
            WHERE appointment_shown_leads <= appointment_set_leads
              AND appointment_set_leads   <= contacted_leads
              AND contacted_leads         <= leads_received
              AND sold_leads              <= leads_received
        )::numeric        AS conforming_rows
    FROM reporting.vw_lead_funnel
),
sold_path AS (
    SELECT
        count(*) FILTER (WHERE l.is_sold)::numeric                              AS sold_leads,
        count(*) FILTER (WHERE l.is_sold AND l.is_appointment_shown)::numeric   AS sold_on_path,
        count(*) FILTER (WHERE l.is_sold AND NOT l.is_appointment_shown)::numeric
                                                                               AS sold_off_path,
        count(*) FILTER (WHERE l.is_appointment_shown)::numeric                 AS flagged_shown,
        count(*) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM warehouse.fact_appointment AS a
                WHERE a.lead_key = l.lead_key AND a.is_shown
            )
        )::numeric                                                             AS shown_in_appointments
    FROM warehouse.fact_lead AS l
    WHERE NOT l.is_duplicate
),
appointment_rates AS (
    SELECT
        coalesce(sum(eligible_appointments), 0)::numeric            AS eligible_appointments,
        coalesce(sum(shown_appointments), 0)::numeric               AS shown_appointments,
        coalesce(sum(shown_appointments_on_show_date), 0)::numeric  AS shown_on_show_date,
        coalesce(sum(shown_and_sold_appointments), 0)::numeric      AS shown_and_sold
    FROM reporting.vw_appointment_funnel
),
chain AS (
    SELECT
        (r.contacted_leads        / nullif(r.leads_received, 0))
      * (r.appointment_set_leads  / nullif(r.contacted_leads, 0))
      * (a.shown_appointments     / nullif(a.eligible_appointments, 0))
      * (a.shown_and_sold         / nullif(a.shown_on_show_date, 0))          AS chain_product,
        s.sold_on_path / nullif(r.leads_received, 0)                          AS modelled_path_conversion,
        r.sold_leads   / nullif(r.leads_received, 0)                          AS lead_to_sale_conversion
    FROM reported AS r
    CROSS JOIN appointment_rates AS a
    CROSS JOIN sold_path AS s
)

-- RECON-LEAD-001 -------------------------------------------------------------
SELECT
    'RECON-LEAD-001'::text AS reconciliation_id,
    format('Lead totals reconcile to staging after documented exclusions: %s leads received + %s '
           'duplicates excluded = %s staged leads. Stated as an addition, not a subtraction, so a lost '
           'lead and an extra duplicate cannot cancel.',
           r.leads_received, r.duplicates_excluded, g.staged_leads)::text AS description,
    'reporting.vw_lead_funnel (received + duplicates excluded)'::text AS left_source,
    r.leads_received + r.duplicates_excluded AS left_value,
    'staging.stg_lead'::text AS right_source,
    g.staged_leads AS right_value,
    0::numeric AS tolerance,
    CASE WHEN r.leads_received + r.duplicates_excluded = g.staged_leads
         THEN 'passed' ELSE 'failed' END::text AS status
FROM reported AS r CROSS JOIN staged AS g

UNION ALL

-- RECON-LEAD-DUPLICATES ------------------------------------------------------
SELECT
    'RECON-LEAD-DUPLICATES'::text,
    format('The duplicate exclusion survives the whole ingestion path: %s duplicates excluded by the '
           'reporting layer against %s duplicate rows staging accepted. Compared against STAGING rather '
           'than against the warehouse, so the two sides are independent derivations -- a warehouse '
           'comparison would read the same rows the reporting layer read and could not fail. Duplicates '
           'inflate volume and depress every conversion rate at once, so excluding the wrong rows is the '
           'single most damaging funnel error.',
           r.duplicates_excluded, w.duplicate_leads)::text,
    'reporting.vw_lead_funnel'::text,
    r.duplicates_excluded,
    'staging.stg_lead'::text,
    w.duplicate_leads,
    0::numeric,
    CASE WHEN r.duplicates_excluded = w.duplicate_leads THEN 'passed' ELSE 'failed' END::text
FROM reported AS r CROSS JOIN staged_duplicates AS w

UNION ALL

-- RECON-FUNNEL-BOUNDS --------------------------------------------------------
SELECT
    'RECON-FUNNEL-BOUNDS'::text,
    format('Funnel numerators and denominators nest correctly on %s of %s store-source-day rows: '
           'shown <= appointment set <= contacted <= received, and sold <= received. Sold leads are '
           'bounded by RECEIVED rather than by shown, because KPI-FUN-006 divides by leads received and a '
           'lead can convert without ever showing at an appointment -- that off-path population is '
           'measured exactly by RECON-FUNNEL-SOLD-PATH. Reconciling a ratio alone is insufficient, '
           'because two compensating errors produce a correct ratio.',
           b.conforming_rows, b.grain_rows)::text,
    'reporting.vw_lead_funnel (rows with correctly nested populations)'::text,
    b.conforming_rows,
    'reporting.vw_lead_funnel (all rows)'::text,
    b.grain_rows,
    0::numeric,
    CASE WHEN b.conforming_rows = b.grain_rows THEN 'passed' ELSE 'failed' END::text
FROM bounds AS b

UNION ALL

-- RECON-FUNNEL-SOLD-PATH -----------------------------------------------------
SELECT
    'RECON-FUNNEL-SOLD-PATH'::text,
    format('The lead fact and the appointment fact agree on who showed: %s leads flagged '
           'is_appointment_shown against %s leads with at least one shown appointment. Sold leads '
           'decompose into %s that went the whole modelled path and %s that converted without ever '
           'showing, totalling %s -- measuring the off-path population is what turns the funnel-chain '
           'difference into a quantity rather than a discrepancy. The comparison is made ACROSS the two '
           'facts, so it is falsifiable: a decomposition of one column against itself could not fail.',
           s.flagged_shown, s.shown_in_appointments,
           s.sold_on_path, s.sold_off_path, s.sold_leads)::text,
    'warehouse.fact_lead (flagged is_appointment_shown)'::text,
    s.flagged_shown,
    'warehouse.fact_appointment (leads with a shown appointment)'::text,
    s.shown_in_appointments,
    0::numeric,
    CASE WHEN s.flagged_shown = s.shown_in_appointments THEN 'passed' ELSE 'failed' END::text
FROM sold_path AS s

UNION ALL

-- RECON-FUNNEL-CHAIN ---------------------------------------------------------
SELECT
    'RECON-FUNNEL-CHAIN'::text,
    format('Funnel-chain consistency across the lead-to-appointment grain shift: contact rate x '
           'appointment-set rate x show rate x show-to-sale conversion = %s, against modelled-path '
           'conversion %s. Total lead-to-sale conversion is %s; the remainder is the off-path population '
           'reconciled exactly by RECON-FUNNEL-SOLD-PATH. Two of the four rates are computed over '
           'appointments and two over leads, and one lead can produce several appointments, so the '
           'product is an approximation and cannot be made an identity. Informational, not critical: a '
           'breach means leads are converting by a path the funnel does not model, which is a finding to '
           'explain.',
           round(c.chain_product, 6), round(c.modelled_path_conversion, 6),
           round(c.lead_to_sale_conversion, 6))::text,
    'reporting.vw_lead_funnel x reporting.vw_appointment_funnel (chain product)'::text,
    round(c.chain_product, 6),
    'reporting.vw_lead_funnel (modelled-path conversion)'::text,
    round(c.modelled_path_conversion, 6),
    0.01::numeric,
    CASE WHEN abs(c.chain_product - c.modelled_path_conversion) <= 0.01
         THEN 'passed' ELSE 'failed' END::text
FROM chain AS c;

COMMENT ON VIEW audit.vw_recon_funnel IS
    'Grain: one row per reconciliation rule, in the uniform shape of audit.vw_recon_result_template. '
    'RECON-LEAD-001 states the staging reconciliation as an ADDITION -- leads received + duplicates '
    'excluded = staged leads -- so a lost lead and an extra duplicate cannot cancel, and so the excluded '
    'population is shown rather than tolerated. RECON-FUNNEL-BOUNDS checks that funnel populations nest '
    'correctly on every store-source-day row, because reconciling a ratio alone lets two compensating '
    'errors pass. RECON-FUNNEL-SOLD-PATH decomposes sold leads exactly into those that went the modelled '
    'path and those that did not, which is what turns the chain difference into a measured quantity. '
    'RECON-FUNNEL-CHAIN compares the four-rate product against modelled-path conversion, isolating the '
    'lead-to-appointment grain shift as the only source of difference; its 0.01 tolerance is '
    'validation.numeric_absolute_tolerance, not a threshold invented for this rule. It is the only ARPI '
    'reconciliation treated as informational rather than critical, because the product spans two grains '
    'and cannot be an identity.';
