-- =============================================================================
-- File:            sql/05_reporting/28_vw_appointment_funnel.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Governed appointment-funnel aggregate carrying both the scheduled-date and show-date measures on one calendar date, with the cancellation exclusion made visible.
-- Execution order: Reporting layer, after reporting.vw_appointments exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per dealership per calendar date on which the store had at least one appointment scheduled or shown.
-- =============================================================================
--
-- KPIs OWNED
-- ----------
--   KPI-FUN-004  Show rate                shown_appointments / eligible_appointments
--                                         on the SCHEDULED-date basis
--   KPI-FUN-005  Show-to-sale conversion  shown_and_sold_appointments
--                                         / shown_appointments_on_show_date
--                                         on the SHOW-date basis
--
-- TWO DATE BASES ON ONE ROW
-- -------------------------
-- KPI-FUN-004 is attributed to the date the appointment was SCHEDULED, because an
-- appointment booked for next month is not eligible to show this month and must not
-- sit in this month's denominator. KPI-FUN-005 is attributed to the date the
-- customer ARRIVED, so the visit and its outcome sit in the same period. Those are
-- two different columns on the same fact, and this view carries both aggregates
-- against one calendar date via a full outer join. The column names state their
-- basis; do not mix a scheduled-basis numerator with a show-basis denominator.
--
-- THE GRAIN SHIFT FROM vw_lead_funnel
-- -----------------------------------
-- These rates are computed over APPOINTMENTS. One lead can produce several, so
-- these denominators are not the lead denominators and a funnel visual that shows
-- all six rates must say which grain each one uses.
--
-- THE CANCELLATION EXCLUSION IS THE MANIPULABLE PART
-- --------------------------------------------------
-- Appointments cancelled before the scheduled date are excluded from the show-rate
-- denominator: the customer never had the opportunity to show, and counting them as
-- a no-show conflates two different failures. That exclusion is also what a store
-- can game -- reclassifying no-shows as advance cancellations produces a flattering
-- show rate. cancellation_rate is therefore published on the same row and MUST
-- appear on the same visual.
--
-- LAG
-- ---
-- A customer who visits on the last day of a month and buys three days later is a
-- sale in the next period but a show in this one. Under the show-date basis the
-- sale is still attributed to the visit, so late-period conversion appears to
-- improve as the data matures. Period-to-date figures must be labelled incomplete.
-- Walk-in traffic without an appointment is not in this measure at all.

CREATE OR REPLACE VIEW reporting.vw_appointment_funnel AS
WITH scheduled_basis AS (
    SELECT
        a.dealership_key                                            AS dealership_key,
        a.scheduled_date_key                                        AS date_key,
        sum(a.appointment_count)::bigint                            AS scheduled_appointments,
        sum(a.eligible_appointment_count)::bigint                   AS eligible_appointments,
        sum(a.cancelled_in_advance_count)::bigint                   AS cancelled_in_advance_appointments,
        sum(a.confirmed_appointment_count)::bigint                  AS confirmed_appointments,
        sum(a.shown_appointment_count)::bigint                      AS shown_appointments
    FROM reporting.vw_appointments AS a
    GROUP BY a.dealership_key, a.scheduled_date_key
),
show_basis AS (
    SELECT
        a.dealership_key                                            AS dealership_key,
        a.show_date_key                                             AS date_key,
        sum(a.shown_appointment_count)::bigint                      AS shown_appointments_on_show_date,
        sum(a.shown_and_sold_appointment_count)::bigint             AS shown_and_sold_appointments,
        sum(a.test_drive_count)::bigint                             AS test_drive_appointments,
        sum(a.write_up_count)::bigint                               AS write_up_appointments
    FROM reporting.vw_appointments AS a
    WHERE a.show_date_key IS NOT NULL
    GROUP BY a.dealership_key, a.show_date_key
)
SELECT
    coalesce(s.dealership_key, w.dealership_key)                    AS dealership_key,
    coalesce(s.date_key,       w.date_key)                          AS date_key,

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
       ON  w.dealership_key = s.dealership_key
       AND w.date_key       = s.date_key;

COMMENT ON VIEW reporting.vw_appointment_funnel IS
    'Grain: one row per dealership per calendar date on which the store had at least one appointment '
    'scheduled or shown. Governed SQL owner of KPI-FUN-004 and KPI-FUN-005. These rates are computed over '
    'APPOINTMENTS, not leads -- one lead can produce several -- so their denominators are not the '
    'vw_lead_funnel denominators and any visual showing both must say which grain each rate uses. Two date '
    'bases are carried on one row and the column names state which: show rate is on the SCHEDULED-date '
    'basis, because an appointment booked for a later period is not eligible to show in this one, and '
    'show-to-sale conversion is on the SHOW-date basis, so the visit and its outcome sit in the same '
    'period. Never mix a scheduled-basis numerator with a show-basis denominator. Appointments cancelled '
    'before the scheduled date are excluded from the show-rate denominator because they never had the '
    'opportunity to show; that exclusion is the manipulable part of the measure, so cancellation_rate is '
    'published here and must appear on the same visual. Every rate returns NULL on a zero denominator. '
    'Walk-in traffic without an appointment is not in this measure at all.';

COMMENT ON COLUMN reporting.vw_appointment_funnel.dealership_key IS 'Store surrogate key. Relationship column into vw_dealership.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.date_key IS 'Calendar date carrying both bases: the scheduled date for the show-rate columns and the show date for the conversion columns. Relationship column into vw_calendar.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.scheduled_appointments IS 'Appointments due on this date, cancellations included. The denominator of cancellation_rate, never of show rate.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.eligible_appointments IS 'KPI-FUN-004 denominator: appointments due on this date that had the opportunity to show. Excludes advance cancellations.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.cancelled_in_advance_appointments IS 'The excluded cancellation population, on the scheduled-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.confirmed_appointments IS 'Appointments confirmed before the scheduled date. Context for show rate: confirmation practice moves it.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.shown_appointments IS 'KPI-FUN-004 numerator: appointments due on this date at which the customer arrived. Attributed to the SCHEDULED date.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.show_rate IS 'KPI-FUN-004 at this view''s grain, as a fraction of 1. NULL when no appointment was eligible. Must be published beside cancellation_rate, because reclassifying no-shows as advance cancellations is what makes a flattering show rate possible.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.cancellation_rate IS 'Advance cancellations as a share of appointments scheduled. The measure that keeps the show-rate exclusion honest.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.shown_appointments_on_show_date IS 'KPI-FUN-005 denominator: appointments at which the customer arrived on this date. Attributed to the SHOW date, which is why this can differ from shown_appointments on the same row.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.shown_and_sold_appointments IS 'KPI-FUN-005 numerator: shown appointments that produced a finalized retail sale. A sold appointment whose sale key does not resolve to a finalized retail sale is a critical failure, not a rounding issue.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.test_drive_appointments IS 'Visits that included a test drive, on the show-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.write_up_appointments IS 'Visits that reached a written deal, on the show-date basis.';
COMMENT ON COLUMN reporting.vw_appointment_funnel.show_to_sale_conversion IS 'KPI-FUN-005 at this view''s grain, as a fraction of 1. NULL when nobody showed. Late-period figures improve as data matures, because a visit on the last day of a month can produce a sale days later; period-to-date values must be labelled incomplete.';
