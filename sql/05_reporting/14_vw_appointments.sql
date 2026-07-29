-- =============================================================================
-- File:            sql/05_reporting/14_vw_appointments.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Row-grain reporting projection of warehouse.fact_appointment, with all three role-playing date keys and the show-rate eligibility rule.
-- Execution order: Reporting layer, after warehouse.fact_appointment exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per scheduled appointment. One lead can produce several.
-- =============================================================================
--
-- KPIs OWNED (row-level inputs)
-- -----------------------------
--   KPI-FUN-004  Show rate                 SUM(shown_appointment_count)
--                                          / SUM(eligible_appointment_count),
--                                          on the SCHEDULED-date basis
--   KPI-FUN-005  Show-to-sale conversion   SUM(shown_and_sold_appointment_count)
--                                          / SUM(shown_appointment_count),
--                                          on the SHOW-date basis
--
-- THE GRAIN SHIFT
-- ---------------
-- KPI-FUN-004 and KPI-FUN-005 are computed over APPOINTMENTS, not leads. One lead
-- can produce several appointments, so a funnel visual that mixes lead-grain and
-- appointment-grain rates without saying so is comparing different denominators.
--
-- THREE ROLE-PLAYING DATES, TWO DATE BASES
-- ----------------------------------------
--   created_date_key    when the appointment was booked
--   scheduled_date_key  when it was due -- the date basis for KPI-FUN-004
--   show_date_key       when the customer arrived -- the date basis for KPI-FUN-005,
--                       NULL when they did not
--
-- All three relate to reporting.vw_calendar. One is active and the other two are
-- inactive relationships activated with USERELATIONSHIP. The calendar view is never
-- duplicated. The scheduled-date basis matters for show rate: an appointment
-- scheduled for next month is not eligible to show this month and must not sit in
-- this month's denominator. Because the denominator is filtered on
-- scheduled_date_key, restricting the period end handles that automatically.
--
-- THE CANCELLATION EXCLUSION IS THE MANIPULABLE PART
-- --------------------------------------------------
-- Appointments cancelled in advance are excluded from the show-rate denominator,
-- because a customer who cancelled never had the opportunity to show and counting
-- them as a no-show conflates two different failures. That exclusion is also the
-- part of this measure a store can game: marking no-shows as advance cancellations
-- produces a flattering show rate. cancelled_in_advance_count is therefore
-- published here and MUST appear on the same visual as the show rate.

CREATE OR REPLACE VIEW reporting.vw_appointments AS
SELECT
    a.appointment_key                                                AS appointment_key,
    a.appointment_id                                                 AS appointment_code,

    -- Role-playing date keys, exposed explicitly.
    a.created_date_key                                               AS created_date_key,
    a.scheduled_date_key                                             AS scheduled_date_key,
    a.show_date_key                                                  AS show_date_key,

    -- Relationship keys.
    a.dealership_key                                                 AS dealership_key,
    a.lead_key                                                       AS lead_key,
    a.customer_key                                                   AS customer_key,
    a.salesperson_key                                                AS salesperson_key,
    a.bdc_employee_key                                               AS bdc_employee_key,
    a.vehicle_model_key                                              AS vehicle_model_key,
    a.sale_key                                                       AS sale_key,

    -- Outcome flags, kept for row inspection and for slicers.
    a.is_confirmed                                                   AS is_confirmed,
    a.is_cancelled_in_advance                                        AS is_cancelled_in_advance,
    a.is_shown                                                       AS is_shown,
    a.is_test_drive                                                  AS is_test_drive,
    a.is_write_up                                                    AS is_write_up,
    a.is_sold                                                        AS is_sold,

    -- Additive appointment measures.
    a.appointment_count                                              AS appointment_count,
    CASE WHEN NOT a.is_cancelled_in_advance
         THEN a.appointment_count ELSE 0 END::smallint               AS eligible_appointment_count,
    CASE WHEN a.is_cancelled_in_advance
         THEN a.appointment_count ELSE 0 END::smallint               AS cancelled_in_advance_count,
    CASE WHEN a.is_shown THEN a.appointment_count ELSE 0 END::smallint
                                                                     AS shown_appointment_count,
    CASE WHEN a.is_shown AND a.is_sold
         THEN a.appointment_count ELSE 0 END::smallint               AS shown_and_sold_appointment_count,
    CASE WHEN a.is_confirmed THEN a.appointment_count ELSE 0 END::smallint
                                                                     AS confirmed_appointment_count,
    CASE WHEN a.is_test_drive THEN a.appointment_count ELSE 0 END::smallint
                                                                     AS test_drive_count,
    CASE WHEN a.is_write_up THEN a.appointment_count ELSE 0 END::smallint
                                                                     AS write_up_count,

    a.minutes_early_or_late                                          AS minutes_early_or_late,
    a.source_system                                                  AS source_system
FROM warehouse.fact_appointment AS a;

COMMENT ON VIEW reporting.vw_appointments IS
    'Grain: one row per scheduled appointment -- identical to warehouse.fact_appointment, with no '
    'aggregation and no filtering. One lead can produce several appointments, so this fact is a grain '
    'shift from vw_leads and the two must not share a denominator silently. Fact table for the semantic '
    'model; owns the row-level inputs to KPI-FUN-004 (scheduled-date basis) and KPI-FUN-005 (show-date '
    'basis). Three role-playing date keys -- created, scheduled and show -- all relate to vw_calendar as '
    'one active and two inactive relationships activated with USERELATIONSHIP; the calendar view is never '
    'duplicated. show_date_key is NULL when the customer did not arrive. Appointments cancelled in advance '
    'are excluded from the show-rate denominator because they never had the opportunity to show; that '
    'exclusion is the manipulable part of the measure, so cancelled_in_advance_count is published and must '
    'appear on the same visual as the show rate. Surrogate keys should be hidden in the semantic model.';

COMMENT ON COLUMN reporting.vw_appointments.appointment_key IS 'Warehouse surrogate key of the appointment. Hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_appointments.appointment_code IS 'Stable business identifier of the appointment.';
COMMENT ON COLUMN reporting.vw_appointments.created_date_key IS 'Role-playing date key: when the appointment was booked. Inactive relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_appointments.scheduled_date_key IS 'Role-playing date key: when the appointment was due. The governed date basis for KPI-FUN-004 show rate -- an appointment scheduled for a later period is not eligible to show in this one. Active relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_appointments.show_date_key IS 'Role-playing date key: when the customer arrived, NULL when they did not. The governed date basis for KPI-FUN-005 show-to-sale conversion, so the visit and its outcome sit in the same period. Inactive relationship to vw_calendar.';
COMMENT ON COLUMN reporting.vw_appointments.dealership_key IS 'Store surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_appointments.lead_key IS 'The lead that produced the appointment. Relationship column into vw_leads; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_appointments.customer_key IS 'Customer surrogate key, or NULL for an anonymous appointment.';
COMMENT ON COLUMN reporting.vw_appointments.salesperson_key IS 'Role-playing employee key: the salesperson who took the appointment.';
COMMENT ON COLUMN reporting.vw_appointments.bdc_employee_key IS 'Role-playing employee key: the BDC representative who set the appointment.';
COMMENT ON COLUMN reporting.vw_appointments.vehicle_model_key IS 'Model line of interest, or NULL.';
COMMENT ON COLUMN reporting.vw_appointments.sale_key IS 'The finalized sale the appointment produced, or NULL. Relationship column into vw_vehicle_sales.';
COMMENT ON COLUMN reporting.vw_appointments.is_confirmed IS 'True when the appointment was confirmed before the scheduled date.';
COMMENT ON COLUMN reporting.vw_appointments.is_cancelled_in_advance IS 'True when the customer cancelled before the scheduled date. Excluded from the show-rate denominator.';
COMMENT ON COLUMN reporting.vw_appointments.is_shown IS 'True when the customer arrived. Implies show_date_key is populated and is_cancelled_in_advance is false.';
COMMENT ON COLUMN reporting.vw_appointments.is_test_drive IS 'True when a test drive took place.';
COMMENT ON COLUMN reporting.vw_appointments.is_write_up IS 'True when the visit reached a written deal. Implies is_shown.';
COMMENT ON COLUMN reporting.vw_appointments.is_sold IS 'True when the visit produced a finalized retail sale. Implies sale_key is populated.';
COMMENT ON COLUMN reporting.vw_appointments.appointment_count IS 'Always 1. Counts every scheduled appointment, cancellations included.';
COMMENT ON COLUMN reporting.vw_appointments.eligible_appointment_count IS 'KPI-FUN-004 denominator: appointments that had the opportunity to show. 1 unless cancelled in advance.';
COMMENT ON COLUMN reporting.vw_appointments.cancelled_in_advance_count IS 'The excluded cancellation population. Must be published on the same visual as show rate, because reclassifying no-shows as advance cancellations is what makes a flattering show rate possible.';
COMMENT ON COLUMN reporting.vw_appointments.shown_appointment_count IS 'KPI-FUN-004 numerator on the scheduled-date basis, and the KPI-FUN-005 denominator on the show-date basis.';
COMMENT ON COLUMN reporting.vw_appointments.shown_and_sold_appointment_count IS 'KPI-FUN-005 numerator: shown appointments that produced a finalized retail sale.';
COMMENT ON COLUMN reporting.vw_appointments.confirmed_appointment_count IS 'Confirmed appointments. Context for show rate: confirmation practice moves it.';
COMMENT ON COLUMN reporting.vw_appointments.test_drive_count IS 'Appointments that included a test drive.';
COMMENT ON COLUMN reporting.vw_appointments.write_up_count IS 'Appointments that reached a written deal.';
COMMENT ON COLUMN reporting.vw_appointments.minutes_early_or_late IS 'Punctuality in minutes relative to the scheduled time, negative when early. NULL unless the customer showed.';
COMMENT ON COLUMN reporting.vw_appointments.source_system IS 'Originating system. Present so no reader mistakes this for real CRM data.';
