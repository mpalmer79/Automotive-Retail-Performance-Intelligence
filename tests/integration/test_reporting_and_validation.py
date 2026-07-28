"""The reporting views and the SQL data-quality checks behave as documented."""

from __future__ import annotations

from typing import Any

import pytest

pytestmark = pytest.mark.integration


UNIFORM_RESULT_COLUMNS = [
    "check_id",
    "check_name",
    "check_category",
    "target_object",
    "severity",
    "status",
    "observed_value",
    "expected_value",
    "failed_record_count",
    "message",
]

DQ_CHECK_VIEWS = [
    "audit.vw_dq_dim_date",
    "audit.vw_dq_dim_dealership",
    "audit.vw_dq_referential",
    "audit.vw_dq_audit",
    "audit.vw_dq_all",
]

EXPECTED_CHECK_IDS = sorted(
    [f"DQ-DATE-{n:03d}" for n in range(1, 6)]
    + [f"DQ-DLR-{n:03d}" for n in range(1, 6)]
    + [f"DQ-REF-{n:03d}" for n in range(1, 6)]
    + [f"DQ-AUD-{n:03d}" for n in range(1, 6)]
)


# --------------------------------------------------------------------------------------
# Reporting views
# --------------------------------------------------------------------------------------


def test_reporting_views_are_queryable_when_empty(cursor: Any) -> None:
    """An empty warehouse must not make a reporting view error."""
    for view_name in (
        "reporting.vw_calendar",
        "reporting.vw_dealership",
        "reporting.vw_pipeline_run_summary",
        "reporting.vw_data_quality_summary",
    ):
        cursor.execute(f"SELECT count(*) FROM {view_name}")
        assert cursor.fetchone()[0] == 0


def test_vw_calendar_projects_the_loaded_calendar(
    cursor: Any, seed_calendar: Any, run_merges: Any
) -> None:
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    run_merges(cursor)

    cursor.execute(
        """
        SELECT date_key, calendar_date, year_month_number, year_month_label,
               month_year_label, quarter_year_label, is_showroom_closed, is_selling_day
        FROM reporting.vw_calendar
        WHERE date_key = 20250704
        """
    )
    row = cursor.fetchone()
    assert row[0] == 20250704
    assert str(row[1]) == "2025-07-04"
    assert row[2] == 202507
    assert row[3] == "2025-07"
    assert row[4] == "July 2025"
    assert row[5] == "Q3 2025"
    assert row[6] is True
    assert row[7] is False


def test_vw_calendar_year_month_number_sorts_chronologically(
    cursor: Any, seed_calendar: Any, run_merges: Any
) -> None:
    seed_calendar(cursor, start_date="2025-09-01", end_date="2025-12-31")
    run_merges(cursor)
    cursor.execute("SELECT DISTINCT year_month_number FROM reporting.vw_calendar ORDER BY 1")
    assert [row[0] for row in cursor.fetchall()] == [202509, 202510, 202511, 202512]


def test_vw_dealership_shows_only_current_versions(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_dealerships(cursor)
    run_merges(cursor)
    seed_dealerships(cursor, overrides={"GSA-002": {"attribute_hash": "d" * 64}})
    run_merges(cursor)

    cursor.execute("SELECT count(*) FROM warehouse.dim_dealership")
    assert cursor.fetchone()[0] == 4

    cursor.execute("SELECT count(*), count(DISTINCT dealership_code) FROM reporting.vw_dealership")
    assert cursor.fetchone() == (3, 3)


def test_vw_dealership_business_columns(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_dealerships(cursor)
    run_merges(cursor)

    cursor.execute(
        """
        SELECT dealership_code, store_short_name, brand_label, is_franchise_store, location_label
        FROM reporting.vw_dealership
        ORDER BY dealership_code
        """
    )
    assert cursor.fetchall() == [
        ("GSA-001", "Granite Chevrolet", "Chevrolet", True, "Nashua, NH"),
        ("GSA-002", "Granite Subaru", "Subaru", True, "Manchester, NH"),
        ("GSA-003", "Granite Used Auto", "Independent", False, "Merrimack, NH"),
    ]


def test_vw_dealership_hides_scd_plumbing(cursor: Any) -> None:
    """Exposing attribute_hash or is_current would invite a double-counting report."""
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'reporting' AND table_name = 'vw_dealership'
        """
    )
    columns = {row[0] for row in cursor.fetchall()}
    assert not columns & {"attribute_hash", "expiration_date", "is_current"}


def test_vw_pipeline_run_summary_reports_a_run(cursor: Any) -> None:
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, completed_at, status, warning_count
        )
        VALUES (gen_random_uuid(), 'run-foundation', 'development', 'cli', 20250701, '0.1.0',
                now() - interval '30 seconds', now(), 'succeeded', 2)
        RETURNING pipeline_run_id
        """
    )
    run_id = cursor.fetchone()[0]

    cursor.executemany(
        """
        INSERT INTO audit.pipeline_run_row_count (pipeline_run_id, entity_name, layer, row_count)
        VALUES (%s, 'dim_date', %s, %s)
        """,
        [(run_id, "source", 184), (run_id, "raw", 184), (run_id, "warehouse", 184)],
    )
    cursor.execute(
        """
        INSERT INTO audit.validation_result (
            pipeline_run_id, check_id, check_name, check_category, target_object,
            severity, status, failed_record_count, evaluated_at
        )
        VALUES
            (%(run)s, 'DQ-DATE-001', 'unique date_key', 'uniqueness', 'warehouse.dim_date',
             'critical', 'passed', 0, now()),
            (%(run)s, 'DQ-DATE-005', 'selling-day ratio', 'business_rule', 'warehouse.dim_date',
             'warning', 'failed', 3, now())
        """,
        {"run": run_id},
    )

    cursor.execute(
        """
        SELECT run_status, source_row_count, raw_row_count, staging_row_count,
               warehouse_row_count, validation_check_count, validation_passed_count,
               validation_failed_count, critical_failed_check_count, reported_warning_count,
               reconciliation_status, duration_seconds
        FROM reporting.vw_pipeline_run_summary
        WHERE pipeline_run_id = %s
        """,
        (run_id,),
    )
    row = cursor.fetchone()
    assert row[0] == "succeeded"
    assert row[1] == 184
    assert row[2] == 184
    assert row[3] is None, "a layer that was never measured must be NULL, not 0"
    assert row[4] == 184
    assert (row[5], row[6], row[7], row[8]) == (2, 1, 1, 0)
    assert row[9] == 2
    assert row[10] == "not evaluated", (
        "no reconciliation ran, so none may be claimed to have passed"
    )
    assert row[11] is not None and row[11] > 0


def test_vw_data_quality_summary_flags_the_latest_run(cursor: Any) -> None:
    run_ids = []
    for _ in range(2):
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run (
                run_uuid, pipeline_name, profile_name, run_mode, random_seed,
                arpi_version, started_at, status
            )
            VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 1, '0.1.0',
                    now(), 'running')
            RETURNING pipeline_run_id
            """
        )
        run_ids.append(cursor.fetchone()[0])

    for run_id, status in zip(run_ids, ["failed", "passed"], strict=True):
        cursor.execute(
            """
            INSERT INTO audit.validation_result (
                pipeline_run_id, check_id, check_name, check_category, target_object,
                severity, status, failed_record_count, evaluated_at
            )
            VALUES (%s, 'DQ-DATE-001', 'unique date_key', 'uniqueness', 'warehouse.dim_date',
                    'critical', %s, 0, now())
            """,
            (run_id, status),
        )

    cursor.execute(
        """
        SELECT pipeline_run_id, check_status, is_failed, is_critical_failure,
               is_latest_run_for_check
        FROM reporting.vw_data_quality_summary
        WHERE check_id = 'DQ-DATE-001'
        ORDER BY pipeline_run_id
        """
    )
    rows = cursor.fetchall()
    assert len(rows) == 2
    assert rows[0][1:] == ("failed", True, True, False)
    assert rows[1][1:] == ("passed", False, False, True)


# --------------------------------------------------------------------------------------
# Data-quality check views
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("view_name", [*DQ_CHECK_VIEWS, "audit.vw_dq_result_template"])
def test_dq_view_returns_the_uniform_shape(cursor: Any, view_name: str) -> None:
    schema, _, table = view_name.partition(".")
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (schema, table),
    )
    assert [row[0] for row in cursor.fetchall()] == UNIFORM_RESULT_COLUMNS


def test_result_template_returns_no_rows(cursor: Any) -> None:
    cursor.execute("SELECT count(*) FROM audit.vw_dq_result_template")
    assert cursor.fetchone()[0] == 0


def test_vw_dq_all_covers_every_expected_check_id(cursor: Any) -> None:
    cursor.execute("SELECT check_id FROM audit.vw_dq_all ORDER BY check_id")
    assert [row[0] for row in cursor.fetchall()] == EXPECTED_CHECK_IDS


def test_dq_checks_report_skipped_on_an_empty_warehouse(cursor: Any) -> None:
    """An empty table yields no evidence, so a check over it must not claim to pass."""
    cursor.execute(
        """
        SELECT check_id, status FROM audit.vw_dq_all
        WHERE check_id LIKE 'DQ-DATE-%' OR check_id LIKE 'DQ-DLR-%'
        ORDER BY check_id
        """
    )
    results = dict(cursor.fetchall())
    for check_id in [f"DQ-DATE-{n:03d}" for n in range(1, 6)]:
        assert results[check_id] == "skipped"
    # DQ-DLR-004 inspects the catalogue, not the data, so it is always evaluated.
    assert results["DQ-DLR-004"] == "passed"
    for check_id in ("DQ-DLR-001", "DQ-DLR-002", "DQ-DLR-003", "DQ-DLR-005"):
        assert results[check_id] == "skipped"


def test_every_dq_check_has_a_message_and_valid_domains(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT check_id, check_name, check_category, target_object, severity, status, message
        FROM audit.vw_dq_all
        """
    )
    for check_id, name, category, target, severity, status, message in cursor.fetchall():
        assert name and category and target and message, f"{check_id} is missing metadata"
        assert severity in ("critical", "warning", "info"), f"{check_id} has severity {severity!r}"
        assert status in ("passed", "failed", "skipped"), f"{check_id} has status {status!r}"


def test_all_dq_checks_pass_on_a_correctly_loaded_warehouse(
    cursor: Any, seed_calendar: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-12-31")
    seed_dealerships(cursor)
    run_merges(cursor)

    cursor.execute(
        """
        SELECT check_id, status, message FROM audit.vw_dq_all
        WHERE check_id LIKE 'DQ-DATE-%' OR check_id LIKE 'DQ-DLR-%' OR check_id LIKE 'DQ-REF-%'
        ORDER BY check_id
        """
    )
    failures = [(cid, msg) for cid, status, msg in cursor.fetchall() if status != "passed"]
    assert failures == []


def test_dq_date_002_detects_a_gap(cursor: Any, seed_calendar: Any, run_merges: Any) -> None:
    """Delete a date and watch both contiguity checks notice."""
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    run_merges(cursor)
    cursor.execute("DELETE FROM warehouse.dim_date WHERE date_key = 20250715")

    cursor.execute(
        "SELECT status, observed_value, expected_value, failed_record_count, message "
        "FROM audit.vw_dq_dim_date WHERE check_id = 'DQ-DATE-002'"
    )
    status, observed, expected, failed, message = cursor.fetchone()
    assert status == "failed"
    assert observed == 30
    assert expected == 31
    assert failed == 1

    cursor.execute(
        "SELECT status, failed_record_count, message FROM audit.vw_dq_referential "
        "WHERE check_id = 'DQ-REF-003'"
    )
    status, failed, message = cursor.fetchone()
    assert status == "failed"
    assert failed == 1
    assert "2025-07-14" in message, message


def test_dq_dlr_003_detects_a_wrong_store_count(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_dealerships(cursor)
    run_merges(cursor)
    cursor.execute("DELETE FROM warehouse.dim_dealership WHERE dealership_id = 'GSA-003'")

    cursor.execute(
        "SELECT status, observed_value, expected_value FROM audit.vw_dq_dim_dealership "
        "WHERE check_id = 'DQ-DLR-003'"
    )
    assert cursor.fetchone() == ("failed", 2, 3)


def test_dq_ref_004_detects_a_dropped_constraint(cursor: Any) -> None:
    """A data check that passes while its constraint is gone is worthless."""
    cursor.execute("SELECT status FROM audit.vw_dq_referential WHERE check_id = 'DQ-REF-004'")
    assert cursor.fetchone()[0] == "passed"

    cursor.execute("ALTER TABLE warehouse.dim_date DROP CONSTRAINT ck_dim_date_selling_day_rule")
    cursor.execute(
        "SELECT status, failed_record_count, message FROM audit.vw_dq_referential "
        "WHERE check_id = 'DQ-REF-004'"
    )
    status, failed, message = cursor.fetchone()
    assert status == "failed"
    assert failed == 1
    assert "ck_dim_date_selling_day_rule" in message


def test_dq_dlr_004_detects_a_prohibited_column(cursor: Any) -> None:
    """The privacy promise is enforced against the catalogue, not just documented."""
    cursor.execute("SELECT status FROM audit.vw_dq_dim_dealership WHERE check_id = 'DQ-DLR-004'")
    assert cursor.fetchone()[0] == "passed"

    cursor.execute("ALTER TABLE warehouse.dim_dealership ADD COLUMN street_address text")
    cursor.execute(
        "SELECT status, failed_record_count, message FROM audit.vw_dq_dim_dealership "
        "WHERE check_id = 'DQ-DLR-004'"
    )
    status, failed, message = cursor.fetchone()
    assert status == "failed"
    assert failed == 1
    assert "street_address" in message


# --------------------------------------------------------------------------------------
# Recording results
# --------------------------------------------------------------------------------------


def test_fn_record_all_dq_checks_persists_every_result(cursor: Any) -> None:
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 1, '0.1.0', now(), 'running')
        RETURNING pipeline_run_id
        """
    )
    run_id = cursor.fetchone()[0]

    cursor.execute("SELECT audit.fn_record_all_dq_checks(%s)", (run_id,))
    recorded = cursor.fetchone()[0]
    assert recorded == len(EXPECTED_CHECK_IDS)

    cursor.execute(
        "SELECT check_id FROM audit.validation_result WHERE pipeline_run_id = %s ORDER BY check_id",
        (run_id,),
    )
    assert [row[0] for row in cursor.fetchall()] == EXPECTED_CHECK_IDS


def test_fn_record_validation_result_rejects_an_unknown_run(cursor: Any) -> None:
    with pytest.raises(Exception, match="Unknown pipeline_run_id"):
        cursor.execute(
            """
            SELECT audit.fn_record_validation_result(
                987654321, 'DQ-DATE-001', 'unique date_key', 'uniqueness',
                'warehouse.dim_date', 'critical', 'passed'
            )
            """
        )


@pytest.mark.parametrize(
    ("severity", "status", "expected_message"),
    [("catastrophic", "passed", "Invalid severity"), ("critical", "maybe", "Invalid status")],
)
def test_fn_record_validation_result_rejects_invalid_domains(
    cursor: Any, severity: str, status: str, expected_message: str
) -> None:
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 1, '0.1.0', now(), 'running')
        RETURNING pipeline_run_id
        """
    )
    run_id = cursor.fetchone()[0]

    with pytest.raises(Exception, match=expected_message):
        cursor.execute(
            """
            SELECT audit.fn_record_validation_result(
                %s, 'DQ-TEST-000', 'probe', 'domain', 'warehouse.dim_date', %s, %s
            )
            """,
            (run_id, severity, status),
        )
