"""The three DASH.10 presentation-grain views, against the authorities they re-grain.

None of these views adds a fact, a dimension or a KPI identifier. Each is therefore a claim
that an existing authority's numbers survive being cut a different way, and a re-grain that
fans out, drops rows or double-counts produces output that is entirely plausible and wrong.

The SQL reconciliations in ``audit.vw_recon_leads_marketing`` re-prove the same properties on
every database run. These tests do three things that file cannot: they seed the specific
defect each rule exists to catch and observe it failing, they assert the declared grain is
the real one, and they check the privacy boundary of the response distribution against the
warehouse rather than against the contract that describes it.
"""

from __future__ import annotations

from typing import Any

import pytest

pytestmark = pytest.mark.integration


def _scalar(cursor: Any, statement: str) -> Any:
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _rows(cursor: Any, statement: str) -> list[tuple[Any, ...]]:
    cursor.execute(statement)
    return list(cursor.fetchall())


# --------------------------------------------------------------------------------------
# The lead projection, so a seeded defect can perturb ONE thing about it
# --------------------------------------------------------------------------------------

#: ``reporting.vw_leads``'s SELECT body, parameterised on the shown-flag expression.
#:
#: Written out here rather than read from the file because a seeded defect has to differ
#: from the real definition in exactly one respect, and a diff against a copy is the only
#: way to be sure that is what happened. ``sql/05_reporting/13_vw_leads.sql`` is the
#: authority; if the two drift, the tests that use this fail loudly rather than silently
#: testing a view nobody ships.
_LEAD_PROJECTION = """
    SELECT lead_key, lead_id AS lead_code, lead_created_date_key, dealership_key,
           customer_key, vehicle_model_key, lead_source_key, campaign_key,
           assigned_employee_key, sale_key,
           is_contacted, is_appointment_set,
           {shown} AS is_appointment_shown,
           is_sold, is_duplicate,
           original_lead_id AS original_lead_code,
           lead_count,
           CASE WHEN NOT is_duplicate THEN lead_count ELSE 0 END::smallint
               AS valid_lead_count,
           CASE WHEN is_duplicate THEN lead_count ELSE 0 END::smallint
               AS duplicate_lead_count,
           CASE WHEN NOT is_duplicate AND is_contacted THEN lead_count ELSE 0 END::smallint
               AS contacted_lead_count,
           CASE WHEN NOT is_duplicate AND is_appointment_set THEN lead_count ELSE 0 END::smallint
               AS appointment_set_lead_count,
           CASE WHEN NOT is_duplicate AND {shown} THEN lead_count ELSE 0 END::smallint
               AS appointment_shown_lead_count,
           CASE WHEN NOT is_duplicate AND is_sold THEN lead_count ELSE 0 END::smallint
               AS sold_lead_count,
           CASE WHEN NOT is_duplicate THEN first_response_seconds ELSE NULL END
               AS first_response_seconds,
           CASE WHEN NOT is_duplicate AND first_response_seconds IS NOT NULL
                THEN first_response_seconds / 60.0 ELSE NULL END AS first_response_minutes,
           CASE WHEN NOT is_duplicate AND first_response_seconds IS NOT NULL
                THEN first_response_seconds ELSE 0 END AS response_seconds_total,
           CASE WHEN NOT is_duplicate AND first_response_seconds IS NOT NULL
                THEN lead_count ELSE 0 END::smallint AS responded_lead_count,
           CASE WHEN NOT is_duplicate AND first_response_seconds IS NULL
                THEN lead_count ELSE 0 END::smallint AS unresponded_lead_count,
           CASE
               WHEN is_duplicate OR first_response_seconds IS NULL THEN NULL
               WHEN first_response_seconds <  300 THEN 'Under 5 minutes'
               WHEN first_response_seconds <  900 THEN '5-15 minutes'
               WHEN first_response_seconds < 3600 THEN '15-60 minutes'
               ELSE 'Over 60 minutes'
           END AS response_time_band,
           days_to_sale, source_system
    FROM warehouse.fact_lead
"""


# ======================================================================================
# reporting.vw_appointment_source_funnel
# ======================================================================================


class TestAppointmentSourceFunnel:
    """The appointment measures, cut by the source and campaign of the originating lead."""

    def test_the_declared_grain_is_the_real_one(self, loaded_cursor: Any) -> None:
        duplicates = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM (
                SELECT dealership_key, lead_source_key, campaign_key, date_key
                FROM reporting.vw_appointment_source_funnel
                GROUP BY 1, 2, 3, 4
                HAVING count(*) > 1
            ) AS repeated
            """,
        )
        assert duplicates == 0

    def test_it_rolls_up_to_the_governed_appointment_funnel(self, loaded_cursor: Any) -> None:
        """Every additive column, on both date bases, on every store and date.

        Components rather than rates: an inflated numerator over an inflated denominator
        divides back to a correct-looking rate, which is exactly how a fan-out on the
        appointment-to-lead join would hide from a rate comparison.
        """
        mismatches = _scalar(
            loaded_cursor,
            """
            WITH rolled AS (
                SELECT dealership_key, date_key,
                       sum(scheduled_appointments)            AS scheduled,
                       sum(eligible_appointments)             AS eligible,
                       sum(cancelled_in_advance_appointments) AS cancelled,
                       sum(confirmed_appointments)            AS confirmed,
                       sum(shown_appointments)                AS shown,
                       sum(shown_appointments_on_show_date)   AS shown_on_show_date,
                       sum(shown_and_sold_appointments)       AS shown_and_sold,
                       sum(test_drive_appointments)           AS test_drives,
                       sum(write_up_appointments)             AS write_ups
                FROM reporting.vw_appointment_source_funnel
                GROUP BY 1, 2
            )
            SELECT count(*)
            FROM rolled
            FULL OUTER JOIN reporting.vw_appointment_funnel AS base
                 USING (dealership_key, date_key)
            WHERE rolled.scheduled          IS DISTINCT FROM base.scheduled_appointments
               OR rolled.eligible           IS DISTINCT FROM base.eligible_appointments
               OR rolled.cancelled          IS DISTINCT FROM base.cancelled_in_advance_appointments
               OR rolled.confirmed          IS DISTINCT FROM base.confirmed_appointments
               OR rolled.shown              IS DISTINCT FROM base.shown_appointments
               OR rolled.shown_on_show_date IS DISTINCT FROM base.shown_appointments_on_show_date
               OR rolled.shown_and_sold     IS DISTINCT FROM base.shown_and_sold_appointments
               OR rolled.test_drives        IS DISTINCT FROM base.test_drive_appointments
               OR rolled.write_ups          IS DISTINCT FROM base.write_up_appointments
            """,
        )
        assert mismatches == 0

    def test_the_appointment_population_is_preserved_exactly(self, loaded_cursor: Any) -> None:
        """No fan-out and no loss: the view counts every appointment exactly once."""
        view_total = _scalar(
            loaded_cursor,
            "SELECT sum(scheduled_appointments) FROM reporting.vw_appointment_source_funnel",
        )
        fact_total = _scalar(loaded_cursor, "SELECT count(*) FROM warehouse.fact_appointment")
        assert view_total == fact_total

    def test_duplicate_leads_keep_their_appointments(self, loaded_cursor: Any) -> None:
        """The exclusion that belongs to the LEAD grain must not leak into this one.

        Appointments hanging off duplicate leads are real appointments and are counted by
        ``vw_appointment_funnel``. Excluding them here would shrink the KPI-FUN-004
        denominator and break the roll-up above — and would do it silently, because a
        smaller denominator raises the show rate.
        """
        via_duplicates = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM warehouse.fact_appointment AS a
            JOIN warehouse.fact_lead AS l ON l.lead_key = a.lead_key
            WHERE l.is_duplicate
            """,
        )
        assert via_duplicates > 0, (
            "no appointment hangs off a duplicate lead, so this rule is untested"
        )

    def test_show_rate_matches_the_governed_denominator_at_this_grain(
        self, loaded_cursor: Any
    ) -> None:
        offenders = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_appointment_source_funnel
            WHERE eligible_appointments > 0
              AND abs(show_rate - (shown_appointments::numeric / eligible_appointments))
                  > 0.000001
            """,
        )
        assert offenders == 0

    def test_seeded_defect_all_scheduled_as_the_show_denominator_disagrees(
        self, loaded_cursor: Any
    ) -> None:
        """Dividing by scheduled rather than eligible must give a different answer."""
        differing = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_appointment_source_funnel
            WHERE scheduled_appointments > 0
              AND eligible_appointments <> scheduled_appointments
              AND abs(show_rate - (shown_appointments::numeric / scheduled_appointments))
                  > 0.000001
            """,
        )
        assert differing > 0, (
            "no row distinguishes eligible from scheduled appointments, so the "
            "cancellation exclusion is untested"
        )

    def test_every_rate_is_null_on_a_zero_denominator(self, loaded_cursor: Any) -> None:
        for rate, denominator in (
            ("show_rate", "eligible_appointments"),
            ("cancellation_rate", "scheduled_appointments"),
            ("show_to_sale_conversion", "shown_appointments_on_show_date"),
        ):
            offenders = _scalar(
                loaded_cursor,
                f"""
                SELECT count(*) FROM reporting.vw_appointment_source_funnel
                WHERE coalesce({denominator}, 0) = 0 AND {rate} IS NOT NULL
                """,
            )
            assert offenders == 0, f"{rate} returned a value on a zero {denominator}"


# ======================================================================================
# reporting.vw_lead_stage_loss
# ======================================================================================


class TestLeadStageLoss:
    """The cohort partitioned by furthest stage reached."""

    def test_the_five_terms_sum_exactly_to_leads_received(self, loaded_cursor: Any) -> None:
        violations = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_stage_loss
            WHERE leads_received <> not_contacted
                                  + contacted_not_appointment_set
                                  + appointment_set_not_shown
                                  + shown_not_sold
                                  + shown_and_sold
            """,
        )
        assert violations == 0

    def test_no_count_is_negative(self, loaded_cursor: Any) -> None:
        negatives = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_stage_loss
            WHERE least(not_contacted, contacted_not_appointment_set,
                        appointment_set_not_shown, shown_not_sold, shown_and_sold,
                        sold_without_modelled_showroom_visit) < 0
            """,
        )
        assert negatives == 0

    def test_the_grain_matches_the_lead_funnel_exactly(self, loaded_cursor: Any) -> None:
        """Both directions. The console places a stage count beside a funnel count."""
        for left, right in (
            ("vw_lead_stage_loss", "vw_lead_funnel"),
            ("vw_lead_funnel", "vw_lead_stage_loss"),
        ):
            extra = _scalar(
                loaded_cursor,
                f"""
                SELECT count(*) FROM (
                    SELECT dealership_key, lead_source_key, campaign_key,
                           lead_created_date_key
                    FROM reporting.{left}
                    EXCEPT
                    SELECT dealership_key, lead_source_key, campaign_key,
                           lead_created_date_key
                    FROM reporting.{right}
                ) AS only_in_left
                """,
            )
            assert extra == 0, f"{left} carries a grain combination {right} does not"

    def test_leads_received_agrees_with_the_funnel(self, loaded_cursor: Any) -> None:
        mismatches = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_stage_loss AS s
            JOIN reporting.vw_lead_funnel AS f
                 ON  f.dealership_key        = s.dealership_key
                 AND f.lead_source_key       = s.lead_source_key
                 AND f.lead_created_date_key = s.lead_created_date_key
                 AND f.campaign_key IS NOT DISTINCT FROM s.campaign_key
            WHERE s.leads_received <> f.leads_received
            """,
        )
        assert mismatches == 0

    def test_the_naive_subtraction_is_wrong_and_the_data_proves_it(
        self, loaded_cursor: Any
    ) -> None:
        """``appointment_shown_leads - sold_leads`` is not the shown-without-sale count.

        ``warehouse.fact_lead`` enforces that an appointment implies contact and a show
        implies an appointment, but NOT that a sale implies a show. Sold leads that never
        showed therefore exist, and subtracting all sold leads from the shown population
        removes leads that were never in it — on a narrow enough scope, below zero.

        This is the physical fact the whole partition shape depends on. If it ever stopped
        being true, the simpler subtraction would become correct and this view could be
        retired; while it is true, the subtraction is a defect.
        """
        sold_without_show = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM warehouse.fact_lead
            WHERE NOT is_duplicate AND is_sold AND NOT is_appointment_shown
            """,
        )
        assert sold_without_show > 0, (
            "every sold lead showed, so the naive subtraction would be correct and this "
            "view's shape is not justified by the data it reads"
        )

        would_go_negative = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_funnel
            WHERE appointment_shown_leads - sold_leads < 0
            """,
        )
        assert would_go_negative > 0, (
            "no row would produce a negative count under the naive subtraction, so the "
            "defect this partition prevents is not demonstrated by this data"
        )

    def test_the_overlay_is_not_a_sixth_partition_term(self, loaded_cursor: Any) -> None:
        """Adding it to the five must break the identity, because it double-counts."""
        rows_where_adding_it_breaks_the_identity = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_stage_loss
            WHERE sold_without_modelled_showroom_visit > 0
              AND leads_received <> not_contacted
                                  + contacted_not_appointment_set
                                  + appointment_set_not_shown
                                  + shown_not_sold
                                  + shown_and_sold
                                  + sold_without_modelled_showroom_visit
            """,
        )
        assert rows_where_adding_it_breaks_the_identity > 0

    def test_duplicates_are_excluded_from_every_count(self, loaded_cursor: Any) -> None:
        view_total = _scalar(
            loaded_cursor, "SELECT sum(leads_received) FROM reporting.vw_lead_stage_loss"
        )
        valid_total = _scalar(
            loaded_cursor,
            "SELECT count(*) FROM warehouse.fact_lead WHERE NOT is_duplicate",
        )
        assert view_total == valid_total


# ======================================================================================
# reporting.vw_lead_response_distribution
# ======================================================================================


class TestLeadResponseDistribution:
    """The first-response population, as counted bins."""

    def test_the_declared_grain_is_the_real_one(self, loaded_cursor: Any) -> None:
        duplicates = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM (
                SELECT dealership_key, lead_source_key, campaign_key,
                       lead_created_date_key, first_response_seconds
                FROM reporting.vw_lead_response_distribution
                GROUP BY 1, 2, 3, 4, 5
                HAVING count(*) > 1
            ) AS repeated
            """,
        )
        assert duplicates == 0

    def test_the_median_recomputed_from_bins_equals_the_median_over_leads(
        self, loaded_cursor: Any
    ) -> None:
        """The property the view exists to earn.

        Expanding each bin by its lead count must be indistinguishable from reading the
        lead rows, because that is the only thing that makes a true median at an arbitrary
        filter scope possible.
        """
        from_bins = _scalar(
            loaded_cursor,
            """
            SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::numeric, 6)
            FROM (
                SELECT d.first_response_seconds AS seconds
                FROM reporting.vw_lead_response_distribution AS d,
                     LATERAL generate_series(1, d.lead_count::integer)
                WHERE d.first_response_seconds IS NOT NULL
            ) AS expanded
            """,
        )
        from_leads = _scalar(
            loaded_cursor,
            """
            SELECT round(percentile_cont(0.5)
                WITHIN GROUP (ORDER BY first_response_seconds)::numeric, 6)
            FROM reporting.vw_leads
            WHERE NOT is_duplicate AND first_response_seconds IS NOT NULL
            """,
        )
        assert from_bins == from_leads

    def test_the_average_of_published_medians_is_a_different_number(
        self, loaded_cursor: Any
    ) -> None:
        """The defect the whole dataset exists to prevent, measured.

        If these two happened to agree, the console could form KPI-FUN-008 from the cheaper
        aggregate and this dataset would not be justified. They do not agree, and not by a
        rounding margin.
        """
        truth = float(
            _scalar(
                loaded_cursor,
                """
                SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_seconds)
                FROM reporting.vw_leads
                WHERE NOT is_duplicate AND first_response_seconds IS NOT NULL
                """,
            )
        )
        average_of_medians = float(
            _scalar(
                loaded_cursor,
                """
                SELECT avg(median_response_seconds) FROM reporting.vw_lead_response
                WHERE median_response_seconds IS NOT NULL
                """,
            )
        )
        assert abs(average_of_medians - truth) > 1.0
        assert average_of_medians / truth > 1.5, (
            "the average of subgroup medians is close to the true median on this data, so "
            "the falsifiability of the median architecture is not demonstrated"
        )

    def test_it_rolls_up_to_the_governed_response_view(self, loaded_cursor: Any) -> None:
        """Population, bands and response seconds, wherever the base view holds leads."""
        mismatches = _scalar(
            loaded_cursor,
            """
            WITH rolled AS (
                SELECT dealership_key, lead_source_key, lead_created_date_key,
                       sum(lead_count)             AS leads,
                       sum(responded_lead_count)   AS responded,
                       sum(unresponded_lead_count) AS unresponded,
                       sum(response_seconds_total) AS seconds,
                       coalesce(sum(lead_count)
                           FILTER (WHERE response_time_band = 'Under 5 minutes'), 0) AS b1,
                       coalesce(sum(lead_count)
                           FILTER (WHERE response_time_band = '5-15 minutes'), 0) AS b2,
                       coalesce(sum(lead_count)
                           FILTER (WHERE response_time_band = '15-60 minutes'), 0) AS b3,
                       coalesce(sum(lead_count)
                           FILTER (WHERE response_time_band = 'Over 60 minutes'), 0) AS b4
                FROM reporting.vw_lead_response_distribution
                GROUP BY 1, 2, 3
            )
            SELECT count(*)
            FROM rolled
            JOIN reporting.vw_lead_response AS base
                 USING (dealership_key, lead_source_key, lead_created_date_key)
            WHERE rolled.leads       IS DISTINCT FROM base.valid_leads
               OR rolled.responded   IS DISTINCT FROM base.responded_leads
               OR rolled.unresponded IS DISTINCT FROM base.unresponded_leads
               OR rolled.seconds     IS DISTINCT FROM base.response_seconds_total
               OR rolled.b1          IS DISTINCT FROM base.responses_under_5_minutes
               OR rolled.b2          IS DISTINCT FROM base.responses_5_to_15_minutes
               OR rolled.b3          IS DISTINCT FROM base.responses_15_to_60_minutes
               OR rolled.b4          IS DISTINCT FROM base.responses_over_60_minutes
            """,
        )
        assert mismatches == 0

    def test_it_invents_no_group_and_omits_only_duplicate_only_groups(
        self, loaded_cursor: Any
    ) -> None:
        invented = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM (
                SELECT DISTINCT dealership_key, lead_source_key, lead_created_date_key
                FROM reporting.vw_lead_response_distribution
                EXCEPT
                SELECT dealership_key, lead_source_key, lead_created_date_key
                FROM reporting.vw_lead_response
            ) AS only_here
            """,
        )
        assert invented == 0

        populated_and_missing = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_response AS base
            WHERE base.valid_leads > 0
              AND NOT EXISTS (
                  SELECT 1 FROM reporting.vw_lead_response_distribution AS d
                  WHERE d.dealership_key        = base.dealership_key
                    AND d.lead_source_key       = base.lead_source_key
                    AND d.lead_created_date_key = base.lead_created_date_key
              )
            """,
        )
        assert populated_and_missing == 0

    def test_null_is_never_responded_and_is_not_a_zero(self, loaded_cursor: Any) -> None:
        """The distinction the whole shape rests on.

        A NULL bin carries the unanswered leads and no responded ones; a zero-second bin, if
        the data holds one, is an ordinary observation counted as responded.
        """
        malformed = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_response_distribution
            WHERE (first_response_seconds IS NULL
                   AND (responded_lead_count <> 0 OR response_time_band IS NOT NULL
                        OR response_seconds_total <> 0))
               OR (first_response_seconds IS NOT NULL
                   AND (unresponded_lead_count <> 0 OR response_time_band IS NULL))
            """,
        )
        assert malformed == 0

        unanswered = _scalar(
            loaded_cursor,
            """
            SELECT sum(unresponded_lead_count)
            FROM reporting.vw_lead_response_distribution
            WHERE first_response_seconds IS NULL
            """,
        )
        assert unanswered > 0, "no lead is unanswered, so the NULL-versus-zero rule is untested"

    def test_a_zero_second_response_would_be_counted_as_responded(self, loaded_cursor: Any) -> None:
        """Zero is a valid instant response, structurally distinct from NULL.

        The development profile happens to contain no zero-second response, so this asserts
        the RULE rather than an observation: any zero bin that exists must be responded and
        banded, and the query returns no offender either way. Recorded explicitly so the
        absence of the case is visible rather than mistaken for coverage.
        """
        offenders = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM reporting.vw_lead_response_distribution
            WHERE first_response_seconds = 0
              AND (responded_lead_count = 0 OR response_time_band <> 'Under 5 minutes')
            """,
        )
        assert offenders == 0

    def test_the_bands_are_the_governed_vocabulary(self, loaded_cursor: Any) -> None:
        bands = {
            row[0]
            for row in _rows(
                loaded_cursor,
                "SELECT DISTINCT response_time_band FROM reporting.vw_lead_response_distribution",
            )
        }
        assert bands <= {
            "Under 5 minutes",
            "5-15 minutes",
            "15-60 minutes",
            "Over 60 minutes",
            None,
        }

    def test_it_carries_no_identity_column_at_all(self, loaded_cursor: Any) -> None:
        """The privacy boundary, checked against the catalogue rather than the contract.

        This is what makes the counted-bin shape stronger than an allowlist over a
        lead-grain projection: there is no identity column to allow or forbid. A future
        edit that added one fails here rather than at review.
        """
        columns = {
            row[0]
            for row in _rows(
                loaded_cursor,
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'reporting'
                  AND table_name = 'vw_lead_response_distribution'
                """,
            )
        }
        prohibited = {
            "lead_key",
            "lead_id",
            "lead_code",
            "customer_key",
            "customer_id",
            "customer_name",
            "email",
            "email_address",
            "phone",
            "phone_number",
            "address",
            "postal_code",
            "assigned_employee_key",
            "sale_key",
            "vehicle_model_key",
            "original_lead_id",
            "original_lead_code",
            "notes",
            "note",
            "message",
            "message_body",
            "transcript",
            "comment",
        }
        assert columns & prohibited == set(), (
            f"the response distribution publishes {sorted(columns & prohibited)}"
        )
        assert columns == {
            "dealership_key",
            "lead_source_key",
            "campaign_key",
            "lead_created_date_key",
            "first_response_seconds",
            "response_time_band",
            "lead_count",
            "responded_lead_count",
            "unresponded_lead_count",
            "response_seconds_total",
        }


# ======================================================================================
# The reconciliation rules themselves
# ======================================================================================


class TestTheReconciliationRules:
    """The five rules are registered, evaluated and passing."""

    def test_all_five_rules_are_present_and_pass(self, loaded_cursor: Any) -> None:
        results = dict(
            _rows(
                loaded_cursor,
                "SELECT reconciliation_id, status FROM audit.vw_recon_leads_marketing",
            )
        )
        assert set(results) == {
            "RECON-APPT-SOURCE-ROLLUP",
            "RECON-LEAD-STAGE-PARTITION",
            "RECON-LEAD-STAGE-GRAIN",
            "RECON-LEAD-RESPONSE-DIST-ROLLUP",
            "RECON-LEAD-RESPONSE-DIST-MEDIAN",
        }
        assert set(results.values()) == {"passed"}

    def test_the_rules_are_unioned_into_the_per_run_set(self, loaded_cursor: Any) -> None:
        """A rule that evaluates but is never recorded protects nothing."""
        recorded = _scalar(
            loaded_cursor,
            """
            SELECT count(*) FROM audit.vw_recon_all
            WHERE reconciliation_id LIKE 'RECON-APPT-SOURCE-%'
               OR reconciliation_id LIKE 'RECON-LEAD-STAGE-%'
               OR reconciliation_id LIKE 'RECON-LEAD-RESPONSE-DIST-%'
            """,
        )
        assert recorded == 5

    def test_a_seeded_fan_out_fails_the_rollup_rule(self, loaded_cursor: Any) -> None:
        """Drive the guard with the defect it exists to catch, and observe it fail.

        THE DEFECT HAS TO BE IN THE JOIN, not in the fact. An extra row in
        ``fact_appointment`` increments BOTH sides of this comparison -- the source view and
        ``vw_appointment_funnel`` read the same fact -- so the roll-up still agrees and the
        seed proves nothing. That was the first version of this test, and it passed against
        a corruption it was supposed to catch.

        A real fan-out is a lead-side duplicate: today
        ``fact_appointment.lead_key`` references ``fact_lead``'s primary key, so the join is
        strictly many-to-one and cannot multiply. This replaces the lead projection with one
        carrying a lead twice, which is exactly what the relationship guarantees against, and
        counts every appointment on that lead twice in the source funnel while
        ``vw_appointment_funnel`` -- which joins no lead -- counts it once.

        Rolled back with the transaction, so the corruption never outlives this test.
        """
        before = _scalar(
            loaded_cursor,
            "SELECT status FROM audit.vw_recon_leads_marketing "
            "WHERE reconciliation_id = 'RECON-APPT-SOURCE-ROLLUP'",
        )
        assert before == "passed"

        # A lead that actually has an appointment, so the fan-out has something to multiply.
        lead_key = _scalar(
            loaded_cursor,
            "SELECT lead_key FROM warehouse.fact_appointment ORDER BY appointment_key LIMIT 1",
        )
        assert lead_key is not None

        base = _LEAD_PROJECTION.format(shown="is_appointment_shown")
        loaded_cursor.execute(
            f"""
            CREATE OR REPLACE VIEW reporting.vw_leads AS
            {base}
            UNION ALL
            {base} WHERE lead_key = {int(lead_key)}
            """
        )

        after = _scalar(
            loaded_cursor,
            "SELECT status FROM audit.vw_recon_leads_marketing "
            "WHERE reconciliation_id = 'RECON-APPT-SOURCE-ROLLUP'",
        )
        assert after == "failed", (
            "a lead resolved twice did not fail RECON-APPT-SOURCE-ROLLUP, so the rule "
            "would not catch a fan-out on the appointment-to-lead join"
        )

    def test_a_seeded_broken_progression_fails_the_partition_rule(self, loaded_cursor: Any) -> None:
        """A lead shown without an appointment set breaks the furthest-stage partition.

        ``fact_lead`` enforces the implication with a CHECK constraint, so this seeds the
        defect at the only place it can be seeded: the reporting projection the view reads.
        Rolled back with the transaction.
        """
        before = _scalar(
            loaded_cursor,
            "SELECT status FROM audit.vw_recon_leads_marketing "
            "WHERE reconciliation_id = 'RECON-LEAD-STAGE-PARTITION'",
        )
        assert before == "passed"

        # One expression differs from the shipped view: every lead is marked shown, which
        # contradicts the appointment-set flag on leads that never booked one.
        loaded_cursor.execute(
            "CREATE OR REPLACE VIEW reporting.vw_leads AS " + _LEAD_PROJECTION.format(shown="true")
        )

        after = _scalar(
            loaded_cursor,
            "SELECT status FROM audit.vw_recon_leads_marketing "
            "WHERE reconciliation_id = 'RECON-LEAD-STAGE-PARTITION'",
        )
        assert after == "failed", (
            "a lead marked shown without an appointment did not break the partition "
            "identity, so RECON-LEAD-STAGE-PARTITION would not catch a broken progression"
        )


# ======================================================================================
# Reporter access
# ======================================================================================


def test_arpi_reporter_can_read_all_three_views(loaded_cursor: Any) -> None:
    """Read-only, through the established reporting grants and nothing wider."""
    for view in (
        "vw_appointment_source_funnel",
        "vw_lead_stage_loss",
        "vw_lead_response_distribution",
    ):
        assert (
            _scalar(
                loaded_cursor,
                f"SELECT has_table_privilege('arpi_reporter', 'reporting.{view}', 'SELECT')",
            )
            is True
        ), f"arpi_reporter cannot read reporting.{view}"

        for privilege in ("INSERT", "UPDATE", "DELETE"):
            assert (
                _scalar(
                    loaded_cursor,
                    "SELECT has_table_privilege('arpi_reporter', "
                    f"'reporting.{view}', '{privilege}')",
                )
                is False
            ), f"arpi_reporter holds {privilege} on reporting.{view}"
