"""The privilege model is enforced by PostgreSQL, not by convention.

The central claim of ``sql/07_security/01_grants.sql`` is that Power BI can never
reach the raw layer. These tests prove it by becoming ``arpi_reporter`` and trying.

``SET ROLE`` is used rather than a separate login: a superuser that has switched to
a non-superuser role is subject to that role's privileges exactly as a real
connection would be, and it needs no ``pg_hba.conf`` change or password to work.
Every test resets the role afterwards.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from psycopg import errors

pytestmark = pytest.mark.integration


def _switch_role(cursor: Any, role_name: str) -> Iterator[Any]:
    """Act as ``role_name`` for the duration of one test, then restore.

    Teardown rolls back rather than issuing ``RESET ROLE``: a test that asserts a
    permission denial leaves the transaction aborted, so no further command would
    be accepted. ``SET`` is transactional in PostgreSQL, so the rollback restores
    the original role as a side effect.
    """
    cursor.execute(f"SET ROLE {role_name}")
    try:
        yield cursor
    finally:
        cursor.connection.rollback()


@pytest.fixture()
def as_reporter(cursor: Any) -> Iterator[Any]:
    """A cursor acting as ``arpi_reporter``."""
    yield from _switch_role(cursor, "arpi_reporter")


@pytest.fixture()
def as_loader(cursor: Any) -> Iterator[Any]:
    """A cursor acting as ``arpi_loader``."""
    yield from _switch_role(cursor, "arpi_loader")


# --------------------------------------------------------------------------------------
# Role definitions
# --------------------------------------------------------------------------------------


def test_all_three_roles_exist(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT rolname FROM pg_roles
        WHERE rolname IN ('arpi_admin', 'arpi_loader', 'arpi_reporter')
        ORDER BY rolname
        """
    )
    assert [row[0] for row in cursor.fetchall()] == ["arpi_admin", "arpi_loader", "arpi_reporter"]


def test_roles_cannot_log_in(cursor: Any) -> None:
    """They are group roles. A login role is created out of band and granted membership."""
    cursor.execute(
        """
        SELECT rolname FROM pg_roles
        WHERE rolname IN ('arpi_admin', 'arpi_loader', 'arpi_reporter')
          AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
        """
    )
    assert cursor.fetchall() == []


def test_every_arpi_object_is_owned_by_arpi_admin(cursor: Any) -> None:
    """Ownership is the mechanism that lets reporting views read what the reporter cannot."""
    cursor.execute(
        """
        SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner)
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND pg_get_userbyid(c.relowner) <> 'arpi_admin'
        """
    )
    assert cursor.fetchall() == [], "step 25 of the init sequence did not normalise ownership"


def test_validation_functions_are_owned_by_arpi_admin(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT p.proname, pg_get_userbyid(p.proowner)
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'audit' AND pg_get_userbyid(p.proowner) <> 'arpi_admin'
        """
    )
    assert cursor.fetchall() == []


# --------------------------------------------------------------------------------------
# arpi_reporter — the allow path
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "view_name",
    [
        "reporting.vw_calendar",
        "reporting.vw_dealership",
        "reporting.vw_pipeline_run_summary",
        "reporting.vw_data_quality_summary",
    ],
)
def test_reporter_can_select_from_every_reporting_view(as_reporter: Any, view_name: str) -> None:
    as_reporter.execute(f"SELECT count(*) FROM {view_name}")
    assert as_reporter.fetchone()[0] >= 0


def test_reporter_reads_reporting_views_without_warehouse_access(as_reporter: Any) -> None:
    """The view's owner supplies the privilege; the reporter needs none of its own."""
    as_reporter.execute("SELECT current_user")
    assert as_reporter.fetchone()[0] == "arpi_reporter"

    as_reporter.execute("SELECT has_schema_privilege('arpi_reporter', 'warehouse', 'USAGE')")
    assert as_reporter.fetchone()[0] is False

    as_reporter.execute("SELECT count(*) FROM reporting.vw_dealership")
    assert as_reporter.fetchone()[0] >= 0


# --------------------------------------------------------------------------------------
# arpi_reporter — the deny path
# --------------------------------------------------------------------------------------


def test_reporter_cannot_read_raw_dealership_load(as_reporter: Any) -> None:
    """The single most important assertion in this file."""
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute("SELECT * FROM raw.dealership_load")


def test_reporter_cannot_read_raw_calendar_date_load(as_reporter: Any) -> None:
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute("SELECT * FROM raw.calendar_date_load")


@pytest.mark.parametrize(
    "object_name",
    [
        "staging.stg_dealership",
        "warehouse.dim_date",
        "warehouse.dim_dealership",
        "audit.pipeline_run",
        "audit.validation_result",
    ],
)
def test_reporter_cannot_read_non_reporting_objects(as_reporter: Any, object_name: str) -> None:
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute(f"SELECT * FROM {object_name}")


def test_reporter_cannot_insert_into_a_warehouse_table(as_reporter: Any) -> None:
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute(
            "INSERT INTO warehouse.dim_dealership (dealership_key, dealership_id) VALUES (99, 'X')"
        )


def test_reporter_cannot_write_to_a_reporting_view(as_reporter: Any) -> None:
    """Read-only means read-only, even inside the one schema the reporter can reach."""
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute("INSERT INTO reporting.vw_calendar (date_key) VALUES (20250101)")


def test_reporter_cannot_create_objects(as_reporter: Any) -> None:
    with pytest.raises(errors.InsufficientPrivilege):
        as_reporter.execute("CREATE TABLE reporting.sneaky (id integer)")


def test_reporter_has_no_schema_privileges_outside_reporting(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT s.schema_name, has_schema_privilege('arpi_reporter', s.schema_name, 'USAGE')
        FROM (VALUES ('raw'), ('staging'), ('warehouse'), ('audit')) AS s(schema_name)
        WHERE has_schema_privilege('arpi_reporter', s.schema_name, 'USAGE')
        """
    )
    assert cursor.fetchall() == []


def test_reporter_holds_no_table_grant_on_the_raw_schema(cursor: Any) -> None:
    """Belt and braces: even the grant catalogue must be clean, not merely unreachable."""
    cursor.execute(
        """
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'arpi_reporter' AND table_schema = 'raw'
        """
    )
    assert cursor.fetchall() == []


# --------------------------------------------------------------------------------------
# arpi_loader
# --------------------------------------------------------------------------------------


def test_loader_can_write_the_pipeline_layers(as_loader: Any) -> None:
    as_loader.execute(
        """
        INSERT INTO raw.dealership_load (
            dealership_id, load_batch_id, source_file_name, source_row_number
        )
        VALUES ('GSA-999', gen_random_uuid(), 'dim_dealership.csv', 1)
        RETURNING raw_record_id
        """
    )
    assert as_loader.fetchone()[0] is not None


def test_loader_can_read_staging_and_write_the_warehouse(as_loader: Any) -> None:
    as_loader.execute("SELECT count(*) FROM staging.stg_dealership")
    assert as_loader.fetchone()[0] >= 0
    as_loader.execute("SELECT has_table_privilege('arpi_loader', 'warehouse.dim_date', 'INSERT')")
    assert as_loader.fetchone()[0] is True


def test_loader_can_record_a_validation_result(as_loader: Any) -> None:
    as_loader.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, pipeline_name, profile_name, run_mode, random_seed,
            arpi_version, started_at, status
        )
        VALUES (gen_random_uuid(), 'run-foundation', 'test', 'cli', 1, '0.1.0', now(), 'running')
        RETURNING pipeline_run_id
        """
    )
    run_id = as_loader.fetchone()[0]

    as_loader.execute(
        """
        SELECT audit.fn_record_validation_result(
            %s, 'DQ-DATE-001', 'unique date_key', 'uniqueness',
            'warehouse.dim_date', 'critical', 'passed', 184, 184, 0, 'ok'
        )
        """,
        (run_id,),
    )
    assert as_loader.fetchone()[0] is not None


def test_loader_cannot_create_objects(as_loader: Any) -> None:
    """The loader moves data. It does not define structures."""
    with pytest.raises(errors.InsufficientPrivilege):
        as_loader.execute("CREATE TABLE warehouse.fact_sneaky (id integer)")


def test_loader_cannot_read_the_reporting_schema(as_loader: Any) -> None:
    """Least privilege: the loader has no business serving reports."""
    with pytest.raises(errors.InsufficientPrivilege):
        as_loader.execute("SELECT * FROM reporting.vw_calendar")


# --------------------------------------------------------------------------------------
# Repository hygiene
# --------------------------------------------------------------------------------------


def test_no_sql_file_contains_a_password(sql_root: Any) -> None:
    """No credential may ever be committed, in any form."""
    forbidden = (
        "password '",
        'password "',
        "PASSWORD '",
        'PASSWORD "',
        "postgresql://",
        "postgres://",
    )
    offenders: list[str] = []
    for path in sorted(sql_root.rglob("*.sql")):
        text = path.read_text(encoding="utf-8")
        if any(token in text for token in forbidden):
            offenders.append(path.name)
    assert offenders == []
