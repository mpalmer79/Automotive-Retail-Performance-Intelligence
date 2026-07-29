-- =============================================================================
-- File:            sql/05_reporting/29_vw_lead_response.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed lead-response aggregate at store, source and lead-creation date, publishing mean, median and the ignored-lead count together.
-- Execution order: Reporting layer, after reporting.vw_leads exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per lead source per lead-creation date.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-FUN-007  Average response time  response_seconds_total / responded_leads / 60
--   KPI-FUN-008  Median response time   median_response_minutes
--
-- THE MEDIAN IS THE HEADLINE
-- --------------------------
-- Response time is severely right-skewed: most responses happen in minutes and a
-- few happen days later. One lead answered after four days can move the mean for an
-- entire store-month. The median describes what the typical customer actually
-- experiences; the mean is retained as the companion and because it is the only
-- figure that reconciles additively to total response seconds.
--
-- The median cannot be recomputed from this aggregate at another grain. For that,
-- use MEDIAN over row-level reporting.vw_leads.first_response_seconds, which is
-- published precisely so a semantic model can recompute it under filter context.
--
-- WHAT BOTH MEASURES ARE BLIND TO
-- -------------------------------
-- Leads that were never responded to are EXCLUDED from both, because NULL means "no
-- response ever", which is analytically different from a very slow response. The
-- consequence is severe and must be stated on every visual: a store that ignores
-- half its leads can report an excellent response time. unresponded_leads and
-- response_coverage_rate are published on the same row so the blind spot is
-- impossible to omit.
--
-- A response of zero seconds -- an instant auto-response -- is a valid value and is
-- included. Only NULL is excluded.
--
-- BANDS BEAT A SINGLE STATISTIC
-- -----------------------------
-- The banded distribution (under 5 minutes, 5-15, 15-60, over 60) is more
-- actionable than either statistic and should be the primary visual, with the
-- median as the summary card. The bands are published as counts here and as a
-- row-level column on reporting.vw_leads.
--
-- ARPI states NO target response time. It has no benchmark data.

CREATE OR REPLACE VIEW reporting.vw_lead_response AS
SELECT
    l.dealership_key                                              AS dealership_key,
    l.lead_source_key                                             AS lead_source_key,
    l.lead_created_date_key                                       AS lead_created_date_key,

    -- Population.
    sum(l.valid_lead_count)::bigint                               AS valid_leads,
    sum(l.responded_lead_count)::bigint                           AS responded_leads,
    sum(l.unresponded_lead_count)::bigint                         AS unresponded_leads,
    sum(l.responded_lead_count)::numeric
        / nullif(sum(l.valid_lead_count), 0)                      AS response_coverage_rate,

    -- Mean components, kept separate and additive.
    sum(l.response_seconds_total)::bigint                         AS response_seconds_total,
    sum(l.response_seconds_total)::numeric
        / nullif(sum(l.responded_lead_count), 0)                  AS average_response_seconds,
    sum(l.response_seconds_total)::numeric
        / nullif(sum(l.responded_lead_count), 0) / 60.0           AS average_response_minutes,

    -- Order statistics over responded leads only.
    percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds)
                                                                  AS median_response_seconds,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_seconds) / 60.0
                                                                  AS median_response_minutes,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY l.first_response_seconds) / 60.0
                                                                  AS p90_response_minutes,

    -- The banded distribution, as additive counts.
    count(*) FILTER (WHERE l.response_time_band = 'Under 5 minutes')::bigint
                                                                  AS responses_under_5_minutes,
    count(*) FILTER (WHERE l.response_time_band = '5-15 minutes')::bigint
                                                                  AS responses_5_to_15_minutes,
    count(*) FILTER (WHERE l.response_time_band = '15-60 minutes')::bigint
                                                                  AS responses_15_to_60_minutes,
    count(*) FILTER (WHERE l.response_time_band = 'Over 60 minutes')::bigint
                                                                  AS responses_over_60_minutes
FROM reporting.vw_leads AS l
GROUP BY l.dealership_key, l.lead_source_key, l.lead_created_date_key;

COMMENT ON VIEW reporting.vw_lead_response IS
    'Grain: one row per dealership per lead source per lead-creation date. Governed SQL owner of '
    'KPI-FUN-007 (mean) and KPI-FUN-008 (median). The median is the headline because the distribution is '
    'severely right-skewed and one four-day response can move a store-month mean; the mean is retained as '
    'its companion and because it alone reconciles additively to response_seconds_total. The median cannot '
    'be recomputed from this aggregate at another grain -- use MEDIAN over row-level '
    'reporting.vw_leads.first_response_seconds. BOTH measures exclude leads that were never responded to, '
    'so a store that ignores half its leads can report an excellent response time; unresponded_leads and '
    'response_coverage_rate are published on the same row so that blind spot cannot be omitted. A '
    'zero-second auto-response is a valid value and is included -- only NULL is excluded. The banded '
    'distribution is more actionable than either statistic and should be the primary visual, with the '
    'median as the summary card. ARPI states NO target response time, because it has no benchmark data.';

COMMENT ON COLUMN reporting.vw_lead_response.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_lead_response.lead_source_key IS 'Lead source. Relationship column into vw_lead_source. Sources differ in lead quality, so response figures are not comparable across sources without controlling for source.';
COMMENT ON COLUMN reporting.vw_lead_response.lead_created_date_key IS 'Lead creation date. The governed date basis. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_lead_response.valid_leads IS 'Valid non-duplicate leads created on the date. Equals KPI-FUN-001 in the same context. NOT the response-time denominator.';
COMMENT ON COLUMN reporting.vw_lead_response.responded_leads IS 'KPI-FUN-007 denominator: valid leads that received a first response. This, not valid_leads, is the denominator both response measures use.';
COMMENT ON COLUMN reporting.vw_lead_response.unresponded_leads IS 'Valid leads never responded to. The population both response-time KPIs are blind to. Must be shown beside any response figure.';
COMMENT ON COLUMN reporting.vw_lead_response.response_coverage_rate IS 'responded_leads / valid_leads, as a fraction of 1. NULL on zero leads. The measure that stops an excellent response time from concealing ignored leads.';
COMMENT ON COLUMN reporting.vw_lead_response.response_seconds_total IS 'KPI-FUN-007 numerator: total first-response seconds across responded leads. First response can never precede lead creation, so this is non-negative.';
COMMENT ON COLUMN reporting.vw_lead_response.average_response_seconds IS 'Mean first-response time in seconds at this view''s grain. NULL when no lead was responded to.';
COMMENT ON COLUMN reporting.vw_lead_response.average_response_minutes IS 'KPI-FUN-007 at this view''s grain, in minutes to one decimal. NULL when no lead was responded to. Dominated by the tail; use the median as the headline.';
COMMENT ON COLUMN reporting.vw_lead_response.median_response_seconds IS 'Median first-response time in seconds. Linear-interpolated PERCENTILE_CONT, fixed so SQL and DAX agree.';
COMMENT ON COLUMN reporting.vw_lead_response.median_response_minutes IS 'KPI-FUN-008 at this view''s grain, in minutes. The headline responsiveness figure. NULL when no lead was responded to. Not decomposable across grains.';
COMMENT ON COLUMN reporting.vw_lead_response.p90_response_minutes IS 'Ninetieth percentile of first-response time in minutes. Shows the tail the median is deliberately insensitive to.';
COMMENT ON COLUMN reporting.vw_lead_response.responses_under_5_minutes IS 'Responded leads answered in under five minutes.';
COMMENT ON COLUMN reporting.vw_lead_response.responses_5_to_15_minutes IS 'Responded leads answered in five to fifteen minutes.';
COMMENT ON COLUMN reporting.vw_lead_response.responses_15_to_60_minutes IS 'Responded leads answered in fifteen to sixty minutes.';
COMMENT ON COLUMN reporting.vw_lead_response.responses_over_60_minutes IS 'Responded leads answered after more than an hour. The tail that moves the mean.';
