-- =============================================================================
-- File:            sql/05_reporting/30_vw_marketing_performance.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed marketing aggregate at store, month, source and campaign, with spend and attributed outcomes as separate additive columns and cost measures undefined where spend does not apply.
-- Execution order: Reporting layer, after reporting.vw_marketing_spend, reporting.vw_leads and reporting.vw_vehicle_sales exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per calendar month per lead source per campaign (nullable).
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-MKT-001  Cost per lead                       spend_amount / attributed_leads
--   KPI-MKT-002  Cost per sale                       spend_amount / attributed_retail_units
--   KPI-MKT-003  Gross return on advertising spend   attributed_total_gross / spend_amount
--
-- MONTH IS THE FINEST VALID GRAIN, STRUCTURALLY
-- ---------------------------------------------
-- Spend is monthly; leads are daily. Dividing a monthly spend figure by one day's
-- leads produces a number that is meaningless and looks fine. This view is built at
-- month grain and joins to vw_calendar on the FIRST DAY of the month, so no
-- consumer can compute a day-grain cost-per figure from it: filtering to any date
-- that is not a month start returns no rows at all. The guarantee is structural,
-- not a note in a document.
--
-- ORGANIC AND INTERNAL SOURCES ARE UNDEFINED, NOT ZERO
-- ----------------------------------------------------
-- A walk-in has no cost per lead. This view therefore FULL OUTER JOINs spend to
-- attributed outcomes, so a source-month with leads but no spend appears with
-- spend_amount NULL and every cost measure NULL. Publishing those rows -- rather
-- than dropping them -- is what makes the organic tail visible instead of silently
-- absent, and is_cost_attributable states on every row whether a cost figure is
-- defined at all.
--
-- ZERO DENOMINATORS RETURN NULL, NEVER INFINITY
-- ---------------------------------------------
--   * spend with zero attributed leads  -> cost_per_lead NULL. The correct way to
--     report it is spend with zero leads, which spend_with_no_attributed_leads
--     surfaces explicitly.
--   * spend with zero attributed sales  -> cost_per_sale NULL, reported as
--     "spend with no attributed sales", which is the actionable statement.
--   * zero spend with gross present     -> gross_return_on_ad_spend NULL. Gross with
--     zero spend is an organic result, not an infinite return.
--
-- ATTRIBUTION AND ITS LIMITS
-- --------------------------
-- Single-source, first-touch. A customer who arrived through three channels is
-- credited to one; multi-touch attribution is out of scope. Sales and gross are
-- attributed through the ORIGINATING LEAD'S creation month, not the sale date --
-- anchoring to the sale date would credit this month's spend with last quarter's
-- leads. The consequence is severe cohort immaturity: leads created this month have
-- not finished converting, so the current month's cost per sale always looks
-- terrible and improves for weeks. Trend visuals must restrict to matured cohorts
-- or label the tail.
--
-- GROSS RETURN IS THE PRIMARY RETURN MEASURE
-- ------------------------------------------
-- Dealership revenue includes the cost of the vehicle, so a revenue-based ROAS is
-- inflated by roughly an order of magnitude and is close to meaningless. ARPI
-- publishes GROSS-based return as primary. attributed_revenue is exposed only so a
-- reader can see the difference; it is explicitly secondary and must be labelled
-- with the reason. Even the gross measure nets out no cost other than the vehicle:
-- no personnel, facility or floor-plan cost is modelled, so it is a CONTRIBUTION
-- measure, not a profit measure. ARPI publishes no target value.

CREATE OR REPLACE VIEW reporting.vw_marketing_performance AS
WITH calendar_month AS (
    SELECT
        c.date_key                                                   AS date_key,
        (extract(year  FROM c.month_start_date)::integer * 10000)
          + (extract(month FROM c.month_start_date)::integer * 100)
          +  extract(day   FROM c.month_start_date)::integer         AS month_date_key
    FROM reporting.vw_calendar AS c
),
spend AS (
    SELECT
        m.dealership_key                                             AS dealership_key,
        m.month_date_key                                             AS month_date_key,
        m.lead_source_key                                            AS lead_source_key,
        m.campaign_key                                               AS campaign_key,
        sum(m.spend_amount)                                          AS spend_amount,
        sum(m.impressions)::bigint                                   AS impressions,
        sum(m.clicks)::bigint                                        AS clicks,
        sum(m.vendor_reported_leads)::bigint                         AS vendor_reported_leads
    FROM reporting.vw_marketing_spend AS m
    GROUP BY m.dealership_key, m.month_date_key, m.lead_source_key, m.campaign_key
),
attributed AS (
    SELECT
        l.dealership_key                                             AS dealership_key,
        cm.month_date_key                                            AS month_date_key,
        l.lead_source_key                                            AS lead_source_key,
        l.campaign_key                                               AS campaign_key,
        sum(l.valid_lead_count)::bigint                              AS attributed_leads,
        sum(l.sold_lead_count)::bigint                               AS attributed_sold_leads,
        sum(coalesce(s.retail_unit_count, 0))::bigint                AS attributed_retail_units,
        sum(coalesce(s.retail_total_gross, 0))                       AS attributed_total_gross,
        sum(coalesce(s.retail_front_end_gross, 0))                   AS attributed_front_end_gross,
        sum(CASE WHEN s.is_retail THEN s.sale_price ELSE 0 END)      AS attributed_revenue
    FROM reporting.vw_leads AS l
    JOIN calendar_month AS cm ON cm.date_key = l.lead_created_date_key
    LEFT JOIN reporting.vw_vehicle_sales AS s
           ON s.sale_key = l.sale_key
          AND l.is_duplicate = false
    GROUP BY l.dealership_key, cm.month_date_key, l.lead_source_key, l.campaign_key
)
SELECT
    coalesce(sp.dealership_key,  at.dealership_key)                  AS dealership_key,
    coalesce(sp.month_date_key,  at.month_date_key)                  AS month_date_key,
    coalesce(sp.lead_source_key, at.lead_source_key)                 AS lead_source_key,
    coalesce(sp.campaign_key,    at.campaign_key)                    AS campaign_key,
    ls.is_paid                                                       AS is_cost_attributable,

    -- Spend side.
    sp.spend_amount                                                  AS spend_amount,
    coalesce(sp.impressions, 0)                                      AS impressions,
    coalesce(sp.clicks, 0)                                           AS clicks,
    coalesce(sp.vendor_reported_leads, 0)                            AS vendor_reported_leads,

    -- Attributed-outcome side.
    coalesce(at.attributed_leads, 0)                                 AS attributed_leads,
    coalesce(at.attributed_sold_leads, 0)                            AS attributed_sold_leads,
    coalesce(at.attributed_retail_units, 0)                          AS attributed_retail_units,
    coalesce(at.attributed_total_gross, 0)                           AS attributed_total_gross,
    coalesce(at.attributed_front_end_gross, 0)                       AS attributed_front_end_gross,
    coalesce(at.attributed_revenue, 0)                               AS attributed_revenue,

    -- The three measures. NULL wherever the figure is undefined.
    CASE WHEN ls.is_paid
         THEN sp.spend_amount / nullif(coalesce(at.attributed_leads, 0), 0)
    END                                                              AS cost_per_lead,
    CASE WHEN ls.is_paid
         THEN sp.spend_amount / nullif(coalesce(at.attributed_retail_units, 0), 0)
    END                                                              AS cost_per_sale,
    CASE WHEN ls.is_paid
         THEN coalesce(at.attributed_total_gross, 0) / nullif(sp.spend_amount, 0)
    END                                                              AS gross_return_on_ad_spend,

    -- The cases a cost ratio cannot express, surfaced explicitly.
    (sp.spend_amount > 0 AND coalesce(at.attributed_leads, 0) = 0)   AS spend_with_no_attributed_leads,
    (sp.spend_amount > 0 AND coalesce(at.attributed_retail_units, 0) = 0)
                                                                     AS spend_with_no_attributed_sales,
    (sp.spend_amount IS NULL AND coalesce(at.attributed_leads, 0) > 0)
                                                                     AS leads_with_no_spend
FROM spend AS sp
FULL OUTER JOIN attributed AS at
       ON  at.dealership_key  =                 sp.dealership_key
       AND at.month_date_key  =                 sp.month_date_key
       AND at.lead_source_key =                 sp.lead_source_key
       AND at.campaign_key    IS NOT DISTINCT FROM sp.campaign_key
JOIN reporting.vw_lead_source AS ls
       ON ls.lead_source_key = coalesce(sp.lead_source_key, at.lead_source_key);

COMMENT ON VIEW reporting.vw_marketing_performance IS
    'Grain: one row per dealership per calendar month per lead source per campaign (nullable). Governed '
    'SQL owner of KPI-MKT-001, KPI-MKT-002 and KPI-MKT-003. Month is the finest valid grain and the '
    'guarantee is STRUCTURAL: the view joins to vw_calendar on the first day of the month, so filtering to '
    'any other date returns nothing and a day-grain cost-per figure cannot be produced. Spend and '
    'attributed outcomes are separate additive columns; the ratios are valid at this view''s grain only '
    'and should be recomputed with DIVIDE in DAX. Cost measures are NULL, never zero, for organic and '
    'internal sources -- a walk-in has no cost per lead -- and those rows are published rather than '
    'dropped so the organic tail stays visible. Zero denominators return NULL, never infinity, and the '
    'three cases a ratio cannot express are surfaced as explicit flags. Attribution is single-source and '
    'first-touch; sales and gross are attributed through the ORIGINATING LEAD''S creation month, not the '
    'sale date, so cohort immaturity makes the current month always look worst. Gross-based return is the '
    'primary return measure: revenue includes the cost of the vehicle, so a revenue-based ROAS is inflated '
    'by roughly an order of magnitude; attributed_revenue is exposed only for that comparison and is '
    'explicitly secondary. Even the gross measure nets out no cost but the vehicle, so it is a '
    'contribution measure, not a profit measure. ARPI publishes no target value.';

COMMENT ON COLUMN reporting.vw_marketing_performance.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_marketing_performance.month_date_key IS 'First day of the month, as a YYYYMMDD key. Relationship column into vw_calendar. Both spend and attributed outcomes are anchored here, which is what makes a day-grain cost figure impossible.';
COMMENT ON COLUMN reporting.vw_marketing_performance.lead_source_key IS 'Lead source. Relationship column into vw_lead_source.';
COMMENT ON COLUMN reporting.vw_marketing_performance.campaign_key IS 'Campaign, or NULL for source-level activity with no campaign. Relationship column into vw_marketing_campaign.';
COMMENT ON COLUMN reporting.vw_marketing_performance.is_cost_attributable IS 'Whether a cost figure is defined for this source at all. False for organic and internal sources, where every cost measure on the row is NULL by rule rather than by absence of data.';
COMMENT ON COLUMN reporting.vw_marketing_performance.spend_amount IS 'KPI-MKT-001/002 numerator and the KPI-MKT-003 denominator. NULL -- not zero -- when the source-month carries no spend row at all, which is how an organic result is distinguished from a paid campaign that spent nothing.';
COMMENT ON COLUMN reporting.vw_marketing_performance.impressions IS 'Vendor-reported impressions.';
COMMENT ON COLUMN reporting.vw_marketing_performance.clicks IS 'Vendor-reported clicks.';
COMMENT ON COLUMN reporting.vw_marketing_performance.vendor_reported_leads IS 'Leads as the VENDOR counts them. Deliberately differs from attributed_leads because vendors count differently and typically count duplicates. The gap is a finding to report, never a substitution to make.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_leads IS 'KPI-MKT-001 denominator: valid non-duplicate CRM leads created in the month and credited to this source and campaign.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_sold_leads IS 'Attributed leads that produced a finalized retail sale. The lead-side view of the same outcome attributed_retail_units measures on the sale side.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_retail_units IS 'KPI-MKT-002 denominator: retail units delivered from the attributed leads, anchored to the LEAD''S creation month rather than the sale date.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_total_gross IS 'KPI-MKT-003 numerator: total retail gross from the attributed leads. The primary return numerator.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_front_end_gross IS 'Front-end gross from the attributed leads, published so a channel can be read for vehicle profit separately from F&I.';
COMMENT ON COLUMN reporting.vw_marketing_performance.attributed_revenue IS 'Retail selling price from the attributed leads. SECONDARY ONLY: revenue includes the cost of the vehicle, so a revenue-based return is inflated by roughly an order of magnitude and must never be presented as the primary profitability measure.';
COMMENT ON COLUMN reporting.vw_marketing_performance.cost_per_lead IS 'KPI-MKT-001 at this view''s grain. NULL for an organic or internal source, and NULL when spend produced zero leads -- report that case as spend with zero leads, not as an infinite cost. Says nothing about lead quality.';
COMMENT ON COLUMN reporting.vw_marketing_performance.cost_per_sale IS 'KPI-MKT-002 at this view''s grain. NULL for an organic or internal source, and NULL when spend produced zero attributed sales. Cohort immaturity is severe: the current month always looks worst and improves for weeks.';
COMMENT ON COLUMN reporting.vw_marketing_performance.gross_return_on_ad_spend IS 'KPI-MKT-003 at this view''s grain, as a multiple to two decimals -- 1.0 means the channel returned exactly its cost in gross. NULL on zero spend, never infinity. A contribution measure, not a profit measure: no personnel, facility or floor-plan cost is netted out.';
COMMENT ON COLUMN reporting.vw_marketing_performance.spend_with_no_attributed_leads IS 'True where money was spent and no valid lead was attributed. The actionable statement a NULL cost_per_lead cannot make on its own.';
COMMENT ON COLUMN reporting.vw_marketing_performance.spend_with_no_attributed_sales IS 'True where money was spent and no retail unit was attributed. Read with cohort maturity in mind before concluding anything.';
COMMENT ON COLUMN reporting.vw_marketing_performance.leads_with_no_spend IS 'True where leads arrived with no spend row at all -- the organic and internal tail. Published so it is visible rather than silently absent.';
