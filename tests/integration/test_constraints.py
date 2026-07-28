"""Constraints are enforced by the database, not merely documented.

Each test here proves a rule by trying to break it and asserting that PostgreSQL
refuses. A constraint that has never been shown to reject anything is a comment.
"""

from __future__ import annotations

from typing import Any

import psycopg
import pytest
from psycopg import errors

pytestmark = pytest.mark.integration


# One complete, valid dim_date row. Individual tests copy it and corrupt one field,
# so a failure always points at the field under test rather than at a typo.
VALID_DATE_ROW: dict[str, Any] = {
    "date_key": 20250704,
    "full_date": "2025-07-04",
    "day_of_month": 4,
    "day_name": "Friday",
    "day_of_week": 5,
    "day_of_year": 185,
    "week_of_year": 27,
    "iso_year": 2025,
    "month_number": 7,
    "month_name": "July",
    "month_start_date": "2025-07-01",
    "month_end_date": "2025-07-31",
    "quarter_number": 3,
    "quarter_name": "Q3",
    "calendar_year": 2025,
    "fiscal_month": 7,
    "fiscal_quarter": 3,
    "fiscal_year": 2025,
    "is_weekend": False,
    "is_month_end": False,
    "is_quarter_end": False,
    "is_year_end": False,
    "is_holiday": True,
    "holiday_name": "Independence Day",
    "is_closure_holiday": True,
    "is_selling_day": False,
}

VALID_DEALERSHIP_ROW: dict[str, Any] = {
    "dealership_key": 9001,
    "dealership_id": "GSA-901",
    "store_name": "Granite Test Motors",
    "store_short_name": "Granite Test",
    "store_type": "Franchise New and Used",
    "franchise_brand": "Chevrolet",
    "city": "Nashua",
    "state_code": "NH",
    "market_region": "Southern New Hampshire",
    "opened_date": "2010-01-01",
    "is_active": True,
    "effective_date": "2010-01-01",
    "expiration_date": "9999-12-31",
    "is_current": True,
    "attribute_hash": "a" * 64,
    "source_system": "arpi_synthetic_generator",
}


def _insert(cur: Any, table: str, row: dict[str, Any]) -> None:
    columns = ", ".join(row)
    placeholders = ", ".join(["%s"] * len(row))
    cur.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(row.values()))


def _with(row: dict[str, Any], **changes: Any) -> dict[str, Any]:
    updated = dict(row)
    updated.update(changes)
    return updated


# --------------------------------------------------------------------------------------
# The valid rows really are valid; otherwise every negative test below is vacuous.
# --------------------------------------------------------------------------------------


def test_valid_dim_date_row_is_accepted(cursor: Any) -> None:
    _insert(cursor, "warehouse.dim_date", VALID_DATE_ROW)
    cursor.execute("SELECT count(*) FROM warehouse.dim_date WHERE date_key = 20250704")
    assert cursor.fetchone()[0] == 1


def test_valid_dim_dealership_row_is_accepted(cursor: Any) -> None:
    _insert(cursor, "warehouse.dim_dealership", VALID_DEALERSHIP_ROW)
    cursor.execute("SELECT count(*) FROM warehouse.dim_dealership WHERE dealership_id = 'GSA-901'")
    assert cursor.fetchone()[0] == 1


# --------------------------------------------------------------------------------------
# warehouse.dim_date
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("description", "changes"),
    [
        ("date_key below the allowed range", {"date_key": 18991231, "full_date": "1899-12-31"}),
        ("day_of_week outside 1-7", {"day_of_week": 8}),
        ("month_number outside 1-12", {"month_number": 13}),
        ("quarter_number outside 1-4", {"quarter_number": 5}),
        ("quarter_name not matching ^Q[1-4]$", {"quarter_name": "X3"}),
        ("date_key not encoding full_date", {"date_key": 20250705}),
        ("fiscal year not aligned to the calendar year", {"fiscal_year": 2024}),
        ("is_weekend inconsistent with day_of_week", {"is_weekend": True}),
        ("day_name outside the English weekday names", {"day_name": "Freitag"}),
    ],
)
def test_dim_date_rejects_invalid_row(
    cursor: Any, description: str, changes: dict[str, Any]
) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(cursor, "warehouse.dim_date", _with(VALID_DATE_ROW, **changes))


def test_dim_date_rejects_selling_day_contradicting_closure(cursor: Any) -> None:
    """is_selling_day must be exactly NOT is_closure_holiday."""
    with pytest.raises(errors.CheckViolation):
        _insert(cursor, "warehouse.dim_date", _with(VALID_DATE_ROW, is_selling_day=True))


def test_dim_date_rejects_holiday_name_without_holiday_flag(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(
            cursor,
            "warehouse.dim_date",
            _with(VALID_DATE_ROW, is_holiday=False, is_closure_holiday=False, is_selling_day=True),
        )


def test_dim_date_rejects_holiday_flag_without_name(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(cursor, "warehouse.dim_date", _with(VALID_DATE_ROW, holiday_name=None))


def test_dim_date_rejects_null_required_column(cursor: Any) -> None:
    with pytest.raises(errors.NotNullViolation):
        _insert(cursor, "warehouse.dim_date", _with(VALID_DATE_ROW, day_name=None))


def test_dim_date_holiday_name_is_nullable_when_not_a_holiday(cursor: Any) -> None:
    """The one nullable column really is nullable; the rule is conditional, not blanket."""
    _insert(
        cursor,
        "warehouse.dim_date",
        _with(
            VALID_DATE_ROW,
            date_key=20250705,
            full_date="2025-07-05",
            day_of_month=5,
            day_name="Saturday",
            day_of_week=6,
            day_of_year=186,
            is_weekend=True,
            is_holiday=False,
            holiday_name=None,
            is_closure_holiday=False,
            is_selling_day=True,
        ),
    )
    cursor.execute("SELECT holiday_name FROM warehouse.dim_date WHERE date_key = 20250705")
    assert cursor.fetchone()[0] is None


def test_dim_date_primary_key_rejects_duplicate_date_key(cursor: Any) -> None:
    _insert(cursor, "warehouse.dim_date", VALID_DATE_ROW)
    with pytest.raises(errors.UniqueViolation):
        _insert(cursor, "warehouse.dim_date", VALID_DATE_ROW)


def test_dim_date_full_date_is_unique(cursor: Any) -> None:
    """Two different keys pointing at the same date would break the declared grain."""
    _insert(cursor, "warehouse.dim_date", VALID_DATE_ROW)
    # Bypass the key/date consistency check by also changing full_date's encoding is
    # impossible, so assert the unique constraint exists and covers full_date instead.
    cursor.execute(
        """
        SELECT count(*)
        FROM pg_constraint
        WHERE conrelid = 'warehouse.dim_date'::regclass
          AND conname = 'uq_dim_date_full_date'
          AND contype = 'u'
        """
    )
    assert cursor.fetchone()[0] == 1


# --------------------------------------------------------------------------------------
# warehouse.dim_dealership
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("description", "changes"),
    [
        ("lower-case state code", {"state_code": "nh"}),
        ("numeric state code", {"state_code": "N1"}),
        ("store_type outside the allowed domain", {"store_type": "Franchise"}),
        ("attribute_hash too short", {"attribute_hash": "abc"}),
        ("attribute_hash not lower-case hex", {"attribute_hash": "A" * 64}),
        ("non-positive surrogate key", {"dealership_key": 0}),
        ("effective_date before opened_date", {"effective_date": "2009-12-31"}),
    ],
)
def test_dim_dealership_rejects_invalid_row(
    cursor: Any, description: str, changes: dict[str, Any]
) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(cursor, "warehouse.dim_dealership", _with(VALID_DEALERSHIP_ROW, **changes))


def test_dim_dealership_rejects_expiration_before_effective(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(
            cursor,
            "warehouse.dim_dealership",
            _with(VALID_DEALERSHIP_ROW, expiration_date="2009-12-31", is_current=False),
        )


def test_dim_dealership_rejects_franchise_store_without_brand(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(
            cursor, "warehouse.dim_dealership", _with(VALID_DEALERSHIP_ROW, franchise_brand=None)
        )


def test_dim_dealership_rejects_independent_store_with_brand(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert(
            cursor,
            "warehouse.dim_dealership",
            _with(VALID_DEALERSHIP_ROW, store_type="Independent Used", franchise_brand="Chevrolet"),
        )


def test_dim_dealership_accepts_independent_store_without_brand(cursor: Any) -> None:
    _insert(
        cursor,
        "warehouse.dim_dealership",
        _with(VALID_DEALERSHIP_ROW, store_type="Independent Used", franchise_brand=None),
    )
    cursor.execute(
        "SELECT franchise_brand FROM warehouse.dim_dealership WHERE dealership_id = 'GSA-901'"
    )
    assert cursor.fetchone()[0] is None


def test_dim_dealership_rejects_current_flag_out_of_step_with_sentinel(cursor: Any) -> None:
    """is_current must be exactly (expiration_date = 9999-12-31)."""
    with pytest.raises(errors.CheckViolation):
        _insert(cursor, "warehouse.dim_dealership", _with(VALID_DEALERSHIP_ROW, is_current=False))


def test_dim_dealership_rejects_duplicate_version(cursor: Any) -> None:
    """(dealership_id, effective_date) is the declared version grain."""
    _insert(cursor, "warehouse.dim_dealership", VALID_DEALERSHIP_ROW)
    with pytest.raises(errors.UniqueViolation):
        _insert(
            cursor,
            "warehouse.dim_dealership",
            _with(VALID_DEALERSHIP_ROW, dealership_key=9002),
        )


def test_dim_dealership_rejects_two_current_rows_for_one_store(cursor: Any) -> None:
    """The partial unique index is the SCD Type 2 grain guarantee."""
    _insert(cursor, "warehouse.dim_dealership", VALID_DEALERSHIP_ROW)
    with pytest.raises(errors.UniqueViolation):
        _insert(
            cursor,
            "warehouse.dim_dealership",
            _with(VALID_DEALERSHIP_ROW, dealership_key=9002, effective_date="2011-01-01"),
        )


def test_dim_dealership_allows_one_expired_and_one_current_version(cursor: Any) -> None:
    """The partial index constrains current rows only; history must still be possible."""
    _insert(
        cursor,
        "warehouse.dim_dealership",
        _with(VALID_DEALERSHIP_ROW, expiration_date="2010-12-31", is_current=False),
    )
    _insert(
        cursor,
        "warehouse.dim_dealership",
        _with(VALID_DEALERSHIP_ROW, dealership_key=9002, effective_date="2011-01-01"),
    )
    cursor.execute(
        """
        SELECT count(*) FILTER (WHERE is_current), count(*)
        FROM warehouse.dim_dealership WHERE dealership_id = 'GSA-901'
        """
    )
    current_count, total_count = cursor.fetchone()
    assert (current_count, total_count) == (1, 2)


# --------------------------------------------------------------------------------------
# audit layer
# --------------------------------------------------------------------------------------


def _insert_pipeline_run(cur: Any, *, status: str = "running") -> int:
    cur.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 424242, '0.1.0', now(), %s)
        RETURNING pipeline_run_id
        """,
        (status,),
    )
    return int(cur.fetchone()[0])


def test_pipeline_run_accepts_valid_metadata(cursor: Any) -> None:
    run_id = _insert_pipeline_run(cursor)
    cursor.execute(
        """
        SELECT pipeline_name, profile_name, status, critical_failure_count, warning_count
        FROM audit.pipeline_run WHERE pipeline_run_id = %s
        """,
        (run_id,),
    )
    assert cursor.fetchone() == ("run-foundation", "test", "running", 0, 0)


def test_pipeline_run_rejects_invalid_status(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        _insert_pipeline_run(cursor, status="finished-ish")


def test_pipeline_run_rejects_completion_before_start(cursor: Any) -> None:
    with pytest.raises(errors.CheckViolation):
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run (
                run_uuid, pipeline_name, profile_name, run_mode, random_seed,
                arpi_version, started_at, completed_at, status
            )
            VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 1, '0.1.0',
                    now(), now() - interval '1 hour', 'succeeded')
            """
        )


def test_pipeline_run_uuid_is_unique(cursor: Any) -> None:
    cursor.execute("SELECT gen_random_uuid()")
    run_uuid = cursor.fetchone()[0]
    statement = """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (%s, 'run-foundation', 'test', 'cli', 1, '0.1.0', now(), 'running')
    """
    cursor.execute(statement, (run_uuid,))
    with pytest.raises(errors.UniqueViolation):
        cursor.execute(statement, (run_uuid,))


def test_validation_result_foreign_key_is_enforced(cursor: Any) -> None:
    """An orphan validation result would make the audit trail unverifiable."""
    with pytest.raises(errors.ForeignKeyViolation):
        cursor.execute(
            """
            INSERT INTO audit.validation_result (
                pipeline_run_id, check_id, check_name, check_category,
                target_object, severity, status, evaluated_at
            )
            VALUES (987654321, 'DQ-DATE-001', 'unique date_key', 'uniqueness',
                    'warehouse.dim_date', 'critical', 'passed', now())
            """
        )


def test_validation_result_accepts_a_resolvable_run(cursor: Any) -> None:
    run_id = _insert_pipeline_run(cursor)
    cursor.execute(
        """
        INSERT INTO audit.validation_result (
            pipeline_run_id, check_id, check_name, check_category,
            target_object, severity, status, observed_value, expected_value,
            failed_record_count, message, evaluated_at
        )
        VALUES (%s, 'DQ-DATE-001', 'unique date_key', 'uniqueness',
                'warehouse.dim_date', 'critical', 'passed', 184, 184, 0, 'ok', now())
        RETURNING validation_result_id
        """,
        (run_id,),
    )
    assert cursor.fetchone()[0] is not None


@pytest.mark.parametrize(
    ("column", "value"),
    [("severity", "catastrophic"), ("status", "maybe")],
)
def test_validation_result_rejects_invalid_domain_value(
    cursor: Any, column: str, value: str
) -> None:
    run_id = _insert_pipeline_run(cursor)
    values = {"severity": "critical", "status": "passed"}
    values[column] = value
    with pytest.raises(errors.CheckViolation):
        cursor.execute(
            """
            INSERT INTO audit.validation_result (
                pipeline_run_id, check_id, check_name, check_category,
                target_object, severity, status, evaluated_at
            )
            VALUES (%s, 'DQ-TEST-000', 'domain probe', 'business_rule',
                    'warehouse.dim_date', %s, %s, now())
            """,
            (run_id, values["severity"], values["status"]),
        )


def test_rejected_record_foreign_key_is_enforced(cursor: Any) -> None:
    with pytest.raises(errors.ForeignKeyViolation):
        cursor.execute(
            """
            INSERT INTO audit.rejected_record (
                pipeline_run_id, source_entity, rejection_code, rejection_reason, rejected_at
            )
            VALUES (987654321, 'dim_dealership', 'BAD_TYPE', 'unparseable date', now())
            """
        )


def test_pipeline_run_row_count_rejects_unknown_layer(cursor: Any) -> None:
    run_id = _insert_pipeline_run(cursor)
    with pytest.raises(errors.CheckViolation):
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run_row_count (
                pipeline_run_id, entity_name, layer, row_count
            )
            VALUES (%s, 'dim_date', 'datamart', 184)
            """,
            (run_id,),
        )


def test_reconciliation_difference_is_generated(cursor: Any) -> None:
    run_id = _insert_pipeline_run(cursor)
    cursor.execute(
        """
        INSERT INTO audit.reconciliation_result (
            pipeline_run_id, reconciliation_id, description,
            left_source, left_value, right_source, right_value, tolerance, status, evaluated_at
        )
        VALUES (%s, 'REC-001', 'staging versus warehouse row count',
                'staging.stg_calendar_date', 184, 'warehouse.dim_date', 180, 0, 'failed', now())
        RETURNING difference
        """,
        (run_id,),
    )
    assert cursor.fetchone()[0] == 4


def test_audit_history_cannot_be_silently_deleted(cursor: Any) -> None:
    """ON DELETE RESTRICT: a run with findings cannot be removed by accident."""
    run_id = _insert_pipeline_run(cursor)
    cursor.execute(
        """
        INSERT INTO audit.validation_result (
            pipeline_run_id, check_id, check_name, check_category,
            target_object, severity, status, evaluated_at
        )
        VALUES (%s, 'DQ-DATE-001', 'unique date_key', 'uniqueness',
                'warehouse.dim_date', 'critical', 'passed', now())
        """,
        (run_id,),
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        cursor.execute("DELETE FROM audit.pipeline_run WHERE pipeline_run_id = %s", (run_id,))
