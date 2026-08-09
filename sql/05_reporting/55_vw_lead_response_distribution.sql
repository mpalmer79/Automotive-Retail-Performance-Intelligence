-- =============================================================================
-- File:            sql/05_reporting/55_vw_lead_response_distribution.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Publish the first-response population as a counted distribution, so KPI-FUN-008 can be recomputed as a true order statistic at any supported filter scope without exporting a lead.
-- Execution order: Reporting layer, after reporting.vw_leads exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per lead source per campaign (nullable) per lead-creation date per distinct first-response value, including one row for the never-responded population.
-- Lane:            Dashboard program (DASH.10). NOT part of the 28-view MVP reporting baseline.
-- =============================================================================
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- reporting.vw_lead_response publishes a median at store x source x lead-creation date. A
-- median is NOT decomposable: the median of a month is not the average of its daily
-- medians, not the average of its store medians, and not a weighted blend of either.
-- Every one of those is a different number, and all three are wrong. The console
-- therefore cannot form a monthly, group-wide, or campaign-filtered KPI-FUN-008 from that
-- aggregate at all -- which is why the existing selector refuses to, and returns
-- "not derivable" outside the single grain the export publishes.
--
-- An order statistic can only be recomputed from the POPULATION. This view publishes that
-- population, and it is the only thing it does.
--
-- WHY A COUNTED DISTRIBUTION RATHER THAN LEAD ROWS
-- ------------------------------------------------
-- A median needs the multiset of values, not the identities that carry them. Grouping by
-- the response value and counting preserves the multiset EXACTLY -- percentile_cont over
-- this view expanded by lead_count is identical to percentile_cont over the lead rows --
-- while removing lead identity from the artefact entirely. There is no lead key, no lead
-- code, no customer, no employee, no sale and no vehicle here, so the export this view
-- feeds cannot leak one even in principle. That is a stronger guarantee than an allowlist
-- over a lead-grain projection, and it is the smallest representation that preserves the
-- required statistic.
--
-- It is also not a drill-through. Nothing downstream may render a row of this view as a
-- lead: the rows are histogram bins, and a bin with lead_count = 1 is still a bin.
--
-- NULL IS NOT ZERO
-- ----------------
-- first_response_seconds IS NULL means the lead was NEVER RESPONDED TO. Zero seconds means
-- an instant response and is a real, valid, included observation. The two must never be
-- conflated, and this view keeps them apart structurally: the never-responded population
-- is carried on its own row with first_response_seconds NULL and response_time_band NULL,
-- it is counted by unresponded_lead_count, and it is EXCLUDED from responded_lead_count.
-- Both response-time KPIs are blind to that population by definition, which is exactly why
-- it is published here rather than filtered out -- a store that ignores half its leads can
-- otherwise report an excellent median.
--
-- Any consumer computing the median must restrict to rows where first_response_seconds IS
-- NOT NULL. Treating the NULL row as a zero would put the ignored leads at the fastest end
-- of the distribution and improve the median, which is the precise failure this shape
-- makes visible.
--
-- BANDS COME FROM HERE, NOT FROM THE CONSUMER
-- -------------------------------------------
-- response_time_band is the governed banding already defined on reporting.vw_leads,
-- carried through unchanged so the console never re-derives a boundary. The bands are
-- descriptive bins. ARPI states NO target response time and publishes no benchmark,
-- because it has no benchmark data.
--
-- DUPLICATES are excluded, structurally, by the same vw_leads columns every other funnel
-- measure uses. This view goes one step further than vw_lead_response and drops the
-- duplicate ROWS as well, which is the one respect in which the two do not have matching
-- row sets: vw_lead_response groups over every vw_leads row, so a store-source-date whose
-- only leads are duplicates still produces a row there, carrying valid_leads = 0. A
-- histogram bin holding no leads is not a bin, so no row is emitted here. In the
-- development profile that is 212 groups. RECON-LEAD-RESPONSE-DIST-001 states the
-- equality in the form that is actually true: every component agrees wherever
-- vw_lead_response has valid_leads > 0, the rows present only in vw_lead_response are
-- exactly those with valid_leads = 0, and this view never carries a row the other lacks.

CREATE OR REPLACE VIEW reporting.vw_lead_response_distribution AS
SELECT
    l.dealership_key                                              AS dealership_key,
    l.lead_source_key                                             AS lead_source_key,
    l.campaign_key                                                AS campaign_key,
    l.lead_created_date_key                                       AS lead_created_date_key,

    -- The observed value. NULL is the never-responded bin, not a zero.
    l.first_response_seconds                                      AS first_response_seconds,
    l.response_time_band                                          AS response_time_band,

    -- How many valid leads carry that value. This is what makes the row a bin.
    sum(l.valid_lead_count)::bigint                               AS lead_count,
    sum(l.responded_lead_count)::bigint                           AS responded_lead_count,
    sum(l.unresponded_lead_count)::bigint                         AS unresponded_lead_count,
    sum(l.response_seconds_total)::bigint                         AS response_seconds_total
FROM reporting.vw_leads AS l
WHERE NOT l.is_duplicate
GROUP BY
    l.dealership_key,
    l.lead_source_key,
    l.campaign_key,
    l.lead_created_date_key,
    l.first_response_seconds,
    l.response_time_band;

COMMENT ON VIEW reporting.vw_lead_response_distribution IS
    'Grain: one row per dealership per lead source per campaign (nullable) per lead-creation date per '
    'distinct first-response value, plus one row per such combination for the never-responded population. '
    'DASH.10 dashboard-program lane; NOT part of the 28-view MVP reporting baseline and NOT bound by the '
    'Power BI semantic model. It exists for exactly one reason: KPI-FUN-008 is a MEDIAN, medians are not '
    'decomposable, and an order statistic can only be recomputed from the population -- not from the '
    'store-source-date medians vw_lead_response publishes, and never by averaging those. This view is that '
    'population, published as a COUNTED DISTRIBUTION rather than as lead rows: grouping by the response value '
    'and counting preserves the multiset exactly, so percentile_cont over these rows expanded by lead_count '
    'equals percentile_cont over the underlying leads, while the artefact carries no lead key, lead code, '
    'customer, employee, sale or vehicle at all. The rows are histogram bins and must never be rendered as '
    'leads; a bin with lead_count = 1 is still a bin. first_response_seconds NULL means NEVER RESPONDED and '
    'is carried on its own row with response_time_band NULL and responded_lead_count 0 -- zero seconds is a '
    'real instant response and is included as an ordinary observation. A consumer computing the median MUST '
    'restrict to rows where first_response_seconds IS NOT NULL; treating the NULL bin as zero would sort the '
    'ignored leads to the fastest end and improve the median, which is the failure this shape exists to make '
    'impossible to hide. unresponded_lead_count is published because both response-time KPIs are blind to '
    'that population and a store ignoring half its leads can otherwise report an excellent median. '
    'response_time_band is the governed banding from vw_leads, carried through unchanged so no consumer '
    're-derives a boundary; the bands are descriptive bins and ARPI states NO target response time and '
    'publishes no benchmark. Duplicates are excluded, and unlike vw_lead_response this view emits no row at '
    'all for a store-source-date whose only leads are duplicates, because a histogram bin holding no leads is '
    'not a bin. Date basis is lead creation throughout. RECON-LEAD-RESPONSE-DIST-001 states the resulting '
    'equality in the form that is true: rolled up to store x source x lead-creation date, every population, '
    'band and response-seconds component agrees with vw_lead_response wherever that view has valid_leads > 0; '
    'the rows present only there are exactly those with valid_leads = 0; and this view never carries a row '
    'the other lacks. Export eligibility: exported to the browser as the lead-response-distribution dataset '
    'under DASH.10.';

COMMENT ON COLUMN reporting.vw_lead_response_distribution.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.lead_source_key IS 'Lead source, single-source first-touch. Relationship column into vw_lead_source. Sources differ in lead quality, so response figures are not comparable across sources without controlling for source.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.campaign_key IS 'Campaign credited with the lead, or NULL where none applies. Carried so a campaign-filtered median is a true median of the filtered population rather than a blend of published medians. NULL is a distinct grain component.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.lead_created_date_key IS 'Lead creation date. The governed date basis. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.first_response_seconds IS 'The observed seconds to first outbound response shared by every lead in this bin. NULL identifies the NEVER-RESPONDED bin and is not a value: it must be excluded from any order statistic and must never be coalesced to zero. Zero is a distinct, valid observation meaning an instant response.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.response_time_band IS 'The governed band this bin falls in -- under 5 minutes, 5-15, 15-60, over 60 -- carried unchanged from vw_leads so no consumer re-derives a boundary. NULL on the never-responded bin. A descriptive bin only: ARPI publishes no target or benchmark response time.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.lead_count IS 'Valid non-duplicate leads in this bin. The weight that makes the row a histogram bin rather than a lead: a median computed over these rows must expand by this count, or weight by it, to equal the median over the leads themselves.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.responded_lead_count IS 'Leads in this bin that received a first response. Equals lead_count on every bin except the never-responded one, where it is 0. The KPI-FUN-007 denominator at this grain.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.unresponded_lead_count IS 'Leads in this bin never responded to. Zero on every bin except the never-responded one. The population both response-time KPIs are blind to, and which must be shown beside any response figure.';
COMMENT ON COLUMN reporting.vw_lead_response_distribution.response_seconds_total IS 'KPI-FUN-007 numerator at this grain: first_response_seconds multiplied by the responded leads in the bin, 0 on the never-responded bin. Additive, so a mean at any scope is summed seconds over summed responded leads rather than an average of averages.';
