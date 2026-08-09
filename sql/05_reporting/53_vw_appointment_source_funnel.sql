-- =============================================================================
-- File:            sql/05_reporting/53_vw_appointment_source_funnel.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Appointment-grain funnel resolved to the originating lead's source and campaign, carrying both the scheduled-date and show-date bases, so a source-filtered console page can show KPI-FUN-004 and KPI-FUN-005 honestly.
-- Execution order: Reporting layer, after reporting.vw_appointments and reporting.vw_leads exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per lead source per campaign (nullable) per calendar date on which that combination had at least one appointment scheduled or shown.
-- Lane:            Dashboard program (DASH.10). NOT part of the 28-view MVP reporting baseline.
-- =============================================================================
--
-- WHY THIS VIEW EXISTS
-- --------------------
-- reporting.vw_appointment_funnel owns KPI-FUN-004 and KPI-FUN-005 at store x date and
-- carries no source or campaign. reporting.vw_lead_funnel carries both. A console page
-- that filters the top of the funnel by source while leaving the appointment rates
-- group-wide, and then draws all of it as one funnel, is not showing a filtered funnel:
-- it is showing two populations in one shape. DASH.10 needs the appointment rates at the
-- same dimensionality as the lead rates, and this view is that -- and nothing else.
--
-- IT ADDS NO FACT AND NO MEASURE
-- ------------------------------
-- Every measure here is the identical CASE expression reporting.vw_appointments already
-- publishes, summed at a finer grain. No new KPI identifier is created: KPI-FUN-004 and
-- KPI-FUN-005 keep their definitions, their denominators and their date bases exactly.
-- This is a PRESENTATION GRAIN over an existing fact.
--
-- THE JOIN CANNOT FAN OUT
-- -----------------------
-- warehouse.fact_appointment.lead_key is NOT NULL and is a foreign key to
-- warehouse.fact_lead.lead_key, which is that table's primary key. The join is therefore
-- strictly many-to-one and the appointment population is preserved exactly: rolling this
-- view up across lead_source_key and campaign_key reproduces vw_appointment_funnel
-- component for component. RECON-APPT-SOURCE-001 asserts that rather than assuming it,
-- because a fan-out here would inflate every appointment measure at once and still look
-- entirely plausible.
--
-- DUPLICATE LEADS ARE NOT EXCLUDED HERE, AND THAT IS DELIBERATE
-- ------------------------------------------------------------
-- The lead funnel excludes duplicate leads from every measure. This view does NOT, because
-- its population is APPOINTMENTS, and vw_appointment_funnel counts every scheduled
-- appointment whatever the status of the lead behind it. Excluding the appointments that
-- hang off duplicate leads would silently reduce KPI-FUN-004's denominator and break the
-- roll-up equality that makes this view trustworthy. The duplicate lead still carries a
-- source and a campaign, so attribution resolves; the appointment is still a real
-- appointment. A reader comparing lead-grain and appointment-grain counts must not expect
-- them to agree, and the two grains are labelled everywhere they are shown together.
--
-- TWO DATE BASES, UNCHANGED
-- -------------------------
-- KPI-FUN-004 is on the SCHEDULED date. KPI-FUN-005 is on the SHOW date. They are carried
-- against one calendar date by a full outer join, exactly as vw_appointment_funnel does,
-- and the column names state which basis each belongs to. Never mix a scheduled-basis
-- numerator with a show-basis denominator.
--
-- THE CANCELLATION EXCLUSION TRAVELS WITH THE RATE
-- ------------------------------------------------
-- Advance cancellations are excluded from the show-rate denominator and cancellation_rate
-- is published on the same row, for the same reason as in vw_appointment_funnel:
-- reclassifying no-shows as advance cancellations is what makes a flattering show rate
-- possible, and the measure that keeps it honest must be impossible to leave behind.

CREATE OR REPLACE VIEW reporting.vw_appointment_source_funnel AS
WITH attributed_appointment AS (
    -- Each appointment, with the source and campaign of the ONE lead that produced it.
    -- The appointment's own dealership_key is used, never the lead's: the appointment is
    -- the fact being counted, and vw_appointment_funnel groups by that column.
    SELECT
        a.dealership_key                                            AS dealership_key,
        l.lead_source_key                                           AS lead_source_key,
        l.campaign_key                                              AS campaign_key,
        a.scheduled_date_key                                        AS scheduled_date_key,
        a.show_date_key                                             AS show_date_key,
        a.appointment_count                                         AS appointment_count,
        a.eligible_appointment_count                                AS eligible_appointment_count,
        a.cancelled_in_advance_count                                AS cancelled_in_advance_count,
        a.confirmed_appointment_count                               AS confirmed_appointment_count,
        a.shown_appointment_count                                   AS shown_appointment_count,
        a.shown_and_sold_appointment_count                          AS shown_and_sold_appointment_count,
        a.test_drive_count                                          AS test_drive_count,
        a.write_up_count                                            AS write_up_count
    FROM reporting.vw_appointments AS a
    JOIN reporting.vw_leads AS l
           ON l.lead_key = a.lead_key
),
scheduled_basis AS (
    SELECT
        d.dealership_key                                            AS dealership_key,
        d.lead_source_key                                           AS lead_source_key,
        d.campaign_key                                              AS campaign_key,
        d.scheduled_date_key                                        AS date_key,
        sum(d.appointment_count)::bigint                            AS scheduled_appointments,
        sum(d.eligible_appointment_count)::bigint                   AS eligible_appointments,
        sum(d.cancelled_in_advance_count)::bigint                   AS cancelled_in_advance_appointments,
        sum(d.confirmed_appointment_count)::bigint                  AS confirmed_appointments,
        sum(d.shown_appointment_count)::bigint                      AS shown_appointments
    FROM attributed_appointment AS d
    GROUP BY d.dealership_key, d.lead_source_key, d.campaign_key, d.scheduled_date_key
),
show_basis AS (
    SELECT
        d.dealership_key                                            AS dealership_key,
        d.lead_source_key                                           AS lead_source_key,
        d.campaign_key                                              AS campaign_key,
        d.show_date_key                                             AS date_key,
        sum(d.shown_appointment_count)::bigint                      AS shown_appointments_on_show_date,
        sum(d.shown_and_sold_appointment_count)::bigint             AS shown_and_sold_appointments,
        sum(d.test_drive_count)::bigint                             AS test_drive_appointments,
        sum(d.write_up_count)::bigint                               AS write_up_appointments
    FROM attributed_appointment AS d
    WHERE d.show_date_key IS NOT NULL
    GROUP BY d.dealership_key, d.lead_source_key, d.campaign_key, d.show_date_key
)
SELECT
    coalesce(s.dealership_key,  w.dealership_key)                   AS dealership_key,
    coalesce(s.lead_source_key, w.lead_source_key)                  AS lead_source_key,
    coalesce(s.campaign_key,    w.campaign_key)                     AS campaign_key,
    coalesce(s.date_key,        w.date_key)                         AS date_key,

    -- Scheduled-date basis: KPI-FUN-004.
    coalesce(s.scheduled_appointments, 0)                           AS scheduled_appointments,
    coalesce(s.eligible_appointments, 0)                            AS eligible_appointments,
    coalesce(s.cancelled_in_advance_appointments, 0)                AS cancelled_in_advance_appointments,
    coalesce(s.confirmed_appointments, 0)                           AS confirmed_appointments,
    coalesce(s.shown_appointments, 0)                               AS shown_appointments,
    s.shown_appointments::numeric
        / nullif(s.eligible_appointments, 0)                        AS show_rate,
    s.cancelled_in_advance_appointments::numeric
        / nullif(s.scheduled_appointments, 0)                       AS cancellation_rate,

    -- Show-date basis: KPI-FUN-005.
    coalesce(w.shown_appointments_on_show_date, 0)                  AS shown_appointments_on_show_date,
    coalesce(w.shown_and_sold_appointments, 0)                      AS shown_and_sold_appointments,
    coalesce(w.test_drive_appointments, 0)                          AS test_drive_appointments,
    coalesce(w.write_up_appointments, 0)                            AS write_up_appointments,
    w.shown_and_sold_appointments::numeric
        / nullif(w.shown_appointments_on_show_date, 0)              AS show_to_sale_conversion
FROM scheduled_basis AS s
FULL OUTER JOIN show_basis AS w
       ON  w.dealership_key  =                 s.dealership_key
       AND w.lead_source_key =                 s.lead_source_key
       AND w.campaign_key    IS NOT DISTINCT FROM s.campaign_key
       AND w.date_key        =                 s.date_key;

COMMENT ON VIEW reporting.vw_appointment_source_funnel IS
    'Grain: one row per dealership per lead source per campaign (nullable) per calendar date on which that '
    'combination had at least one appointment scheduled or shown. DASH.10 dashboard-program lane; NOT part '
    'of the 28-view MVP reporting baseline and NOT bound by the Power BI semantic model. Presents KPI-FUN-004 '
    'and KPI-FUN-005 at source and campaign grain so a source-filtered console page can scope the appointment '
    'rates with the same filter it scopes the lead funnel; it creates no KPI identifier and changes no '
    'definition, denominator or date basis. Source and campaign are resolved through the ONE lead that '
    'produced each appointment -- fact_appointment.lead_key is NOT NULL and references fact_lead''s primary '
    'key, so the join is strictly many-to-one and cannot fan out; rolling this view up across lead source and '
    'campaign reproduces vw_appointment_funnel component for component, which RECON-APPT-SOURCE-001 asserts. '
    'Attribution is single-source and first-touch, inherited from the lead. Duplicate leads are NOT excluded: '
    'the population is APPOINTMENTS and vw_appointment_funnel counts every scheduled appointment whatever the '
    'status of the lead behind it, so excluding them would shrink the KPI-FUN-004 denominator and break the '
    'roll-up equality. This is an appointment-grain measure and one lead can produce several appointments, so '
    'these denominators are NOT the vw_lead_funnel denominators and any visual showing both must say which '
    'grain each rate uses. Two date bases are carried on one row and the column names state which: show rate '
    'is on the SCHEDULED-date basis, show-to-sale conversion is on the SHOW-date basis; never mix a '
    'scheduled-basis numerator with a show-basis denominator. Advance cancellations are excluded from the '
    'show-rate denominator and cancellation_rate is published here because it must appear on the same visual. '
    'Every rate returns NULL on a zero denominator, never 0. Export eligibility: exported to the browser as '
    'the appointment-source-funnel dataset under DASH.10; it publishes no customer, employee or vehicle '
    'relationship and no free text.';

COMMENT ON COLUMN reporting.vw_appointment_source_funnel.dealership_key IS 'Store surrogate key, taken from the APPOINTMENT rather than the lead so this view groups on the same column as vw_appointment_funnel. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.lead_source_key IS 'Lead source of the originating lead, single-source first-touch. Relationship column into vw_lead_source. Sources differ in lead quality, so no rate here is comparable across sources without controlling for source.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.campaign_key IS 'Campaign credited with the originating lead, or NULL where none applies. NULL is a distinct grain component, not an absence of data. Relationship column into vw_marketing_campaign.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.date_key IS 'Calendar date carrying both bases: the scheduled date for the show-rate columns and the show date for the conversion columns. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.scheduled_appointments IS 'Appointments due on this date for this source and campaign, cancellations included. The denominator of cancellation_rate, never of show rate.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.eligible_appointments IS 'KPI-FUN-004 denominator at this grain: appointments due on this date that had the opportunity to show. Excludes advance cancellations.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.cancelled_in_advance_appointments IS 'The excluded cancellation population, on the scheduled-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.confirmed_appointments IS 'Appointments confirmed before the scheduled date. Context for show rate: confirmation practice moves it.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.shown_appointments IS 'KPI-FUN-004 numerator at this grain: appointments due on this date at which the customer arrived. Attributed to the SCHEDULED date.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.show_rate IS 'KPI-FUN-004 at this view''s grain, as a fraction of 1. NULL when no appointment was eligible. Must be published beside cancellation_rate. Not a new KPI: the same definition and denominator as vw_appointment_funnel, evaluated at source and campaign grain.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.cancellation_rate IS 'Advance cancellations as a share of appointments scheduled, at this grain. The measure that keeps the show-rate exclusion honest.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.shown_appointments_on_show_date IS 'KPI-FUN-005 denominator at this grain: appointments at which the customer arrived on this date. Attributed to the SHOW date, which is why this can differ from shown_appointments on the same row.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.shown_and_sold_appointments IS 'KPI-FUN-005 numerator at this grain: shown appointments that produced a finalized retail sale.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.test_drive_appointments IS 'Visits that included a test drive, on the show-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.write_up_appointments IS 'Visits that reached a written deal, on the show-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_source_funnel.show_to_sale_conversion IS 'KPI-FUN-005 at this view''s grain, as a fraction of 1. NULL when nobody showed. Late-period figures improve as data matures, because a visit on the last day of a month can produce a sale days later; period-to-date values must be labelled incomplete.';
