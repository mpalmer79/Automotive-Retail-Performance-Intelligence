"""Shared fixtures for the ARPI PostgreSQL integration tests.

Every test in ``tests/integration`` needs a real PostgreSQL server. When one is
not reachable the whole package is **skipped**, never errored: the suite must stay
green on a laptop or a CI job that has no database.

Connection details are resolved in this order:

1. ``ARPI_DATABASE__HOST`` / ``__PORT`` / ``__USER`` / ``__PASSWORD`` / ``__NAME``
   -- the ARPI configuration contract's environment overrides.
2. The standard ``PGHOST`` / ``PGPORT`` / ``PGUSER`` / ``PGPASSWORD`` /
   ``PGDATABASE`` variables.
3. Nothing at all, which means libpq's defaults: the local Unix socket as the
   current operating-system user.

These variables are captured **at import time** into :data:`_CONNECTION_ENV`. The
repository-wide ``_hermetic_environment`` fixture in ``tests/conftest.py`` deletes every
``ARPI_*`` variable and ``PGPASSWORD`` before each test so that unit tests cannot inherit
ambient configuration -- which is correct, and must stay. But fixtures run *after* it, so
reading ``os.environ`` at fixture time would see the stripped environment and build a
password-less connection. That is invisible locally, where the Unix socket uses peer
authentication and needs no password, and fatal in CI, where the connection is TCP to a
service container and libpq fails with ``fe_sendauth: no password supplied``.

Capturing at import time happens during collection, before any fixture runs, so the
integration tests keep the real credentials while unit tests keep their hermetic
environment.

The session fixture creates a **throwaway database**, runs the complete SQL
initialisation sequence into it, yields its name, and drops it at teardown. No
test ever touches a database a human might care about.
"""

from __future__ import annotations

import os
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final

import pytest

psycopg = pytest.importorskip("psycopg", reason="psycopg is required for the integration tests")

# --------------------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
SQL_ROOT = REPO_ROOT / "sql"

#: Files excluded from the automated initialisation sequence.
#: ``02_role_verification.sql`` is a read-only operator report rather than a build
#: step; running it would only add noise.
_EXCLUDED_FROM_SEQUENCE = frozenset({"07_security/02_role_verification.sql"})

#: The privilege-normalisation pass documented as step 25 in ``sql/README.md``.
_FINAL_GRANTS_PASS = "07_security/01_grants.sql"


def init_sequence_files() -> list[Path]:
    """Return the ordered initialisation sequence exactly as ``sql/README.md`` defines it.

    Sorted ``sql/0*/*.sql`` is the documented order, minus the operator report,
    plus a repeat of the grants script as the final privilege-normalisation pass.
    ``sql/99_local_reset.sql`` cannot be matched by the ``0*`` glob, which is
    precisely why it lives at the ``sql/`` root.
    """
    files = sorted(
        path
        for path in SQL_ROOT.glob("0*/*.sql")
        if path.relative_to(SQL_ROOT).as_posix() not in _EXCLUDED_FROM_SEQUENCE
    )
    return [*files, SQL_ROOT / _FINAL_GRANTS_PASS]


def run_init_sequence(conn: Any) -> list[str]:
    """Execute the whole initialisation sequence against ``conn``.

    Returns the list of relative file paths that were executed, so a test can
    assert the sequence was not silently empty. Each file is executed as one
    ``cursor.execute()`` call on its full text -- the same way Agent C's loader
    executes the merge scripts at runtime, so this doubles as a check that no file
    has picked up a ``psql`` meta-command.
    """
    executed: list[str] = []
    for path in init_sequence_files():
        sql_text = path.read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql_text)
        executed.append(path.relative_to(REPO_ROOT).as_posix())
    conn.commit()
    return executed


# --------------------------------------------------------------------------------------
# Connection parameters
# --------------------------------------------------------------------------------------


#: Connection-relevant environment captured before the hermetic fixture strips it.
#:
#: Only connection variables are captured. Everything else -- ``ARPI_PROFILE``,
#: feature flags, output paths -- is deliberately left to the hermetic fixture, so an
#: integration test still cannot inherit ambient *configuration*, only credentials.
_CONNECTION_ENV: Final[dict[str, str]] = {
    name: value
    for name, value in os.environ.items()
    if name.startswith("ARPI_DATABASE__")
    or name in {"PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE"}
    or name == "ARPI_TEST_MAINTENANCE_DATABASE"
}


def _first_env(*names: str) -> str | None:
    """Return the first non-empty captured value, or ``None``.

    Reads the import-time snapshot rather than ``os.environ`` so the hermetic fixture
    cannot strip the credentials out from under a fixture.
    """
    for name in names:
        value = _CONNECTION_ENV.get(name)
        if value not in (None, ""):
            return value
    return None


def connection_password() -> str | None:
    """The password the integration suite should authenticate with, if any."""
    return _first_env("ARPI_DATABASE__PASSWORD", "PGPASSWORD")


def base_connection_kwargs() -> dict[str, Any]:
    """Build libpq keyword arguments from the environment.

    Only keys that were actually configured are returned, so that anything left
    unset falls through to libpq's own defaults (local socket, current OS user).
    """
    kwargs: dict[str, Any] = {}

    host = _first_env("ARPI_DATABASE__HOST", "PGHOST")
    if host:
        kwargs["host"] = host

    port = _first_env("ARPI_DATABASE__PORT", "PGPORT")
    if port:
        kwargs["port"] = int(port)

    user = _first_env("ARPI_DATABASE__USER", "PGUSER")
    if user:
        kwargs["user"] = user

    password = _first_env("ARPI_DATABASE__PASSWORD", "PGPASSWORD")
    if password:
        kwargs["password"] = password

    sslmode = _first_env("ARPI_DATABASE__SSLMODE", "PGSSLMODE")
    if sslmode:
        kwargs["sslmode"] = sslmode

    kwargs["connect_timeout"] = int(_first_env("ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS") or 10)
    return kwargs


def maintenance_database() -> str:
    """Database used only to CREATE and DROP the throwaway test database."""
    return _first_env("ARPI_TEST_MAINTENANCE_DATABASE", "PGDATABASE") or "postgres"


# --------------------------------------------------------------------------------------
# Session fixtures
# --------------------------------------------------------------------------------------


@pytest.fixture(scope="session")
def maintenance_connection() -> Iterator[Any]:
    """Autocommit connection to the maintenance database, or skip the whole suite."""
    kwargs = base_connection_kwargs()
    try:
        conn = psycopg.connect(dbname=maintenance_database(), autocommit=True, **kwargs)
    except psycopg.OperationalError as exc:  # pragma: no cover - environment dependent
        pytest.skip(
            "No reachable PostgreSQL server for the integration tests "
            f"({type(exc).__name__}: {str(exc).strip()}). Set ARPI_DATABASE__* or PG* "
            "environment variables, or start a local server. See docs/database-setup.md."
        )

    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture(scope="session")
def arpi_database(maintenance_connection: Any) -> Iterator[str]:
    """Create a throwaway database, initialise it, yield its name, then drop it.

    The name always starts with ``arpi_`` so that ``sql/99_local_reset.sql`` would
    accept it, and always ends with a random suffix so that two concurrent test
    runs cannot collide.
    """
    database_name = f"arpi_it_{uuid.uuid4().hex[:12]}"

    with maintenance_connection.cursor() as cur:
        cur.execute(f'CREATE DATABASE "{database_name}"')

    try:
        with psycopg.connect(dbname=database_name, **base_connection_kwargs()) as conn:
            executed = run_init_sequence(conn)
        assert executed, "the SQL initialisation sequence resolved to zero files"
        yield database_name
    finally:
        with maintenance_connection.cursor() as cur:
            # FORCE terminates any connection a failing test left behind.
            cur.execute(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')


# --------------------------------------------------------------------------------------
# Per-test fixtures
# --------------------------------------------------------------------------------------


@pytest.fixture()
def db(arpi_database: str) -> Iterator[Any]:
    """Transactional connection to the initialised test database.

    The transaction is always rolled back, so a test that writes rows cannot
    affect any other test. Tests that must observe committed state manage their
    own commits and clean up after themselves.
    """
    with psycopg.connect(dbname=arpi_database, **base_connection_kwargs()) as conn:
        try:
            yield conn
        finally:
            conn.rollback()


@pytest.fixture()
def cursor(db: Any) -> Iterator[Any]:
    """Plain cursor on the transactional connection."""
    with db.cursor() as cur:
        yield cur


# --------------------------------------------------------------------------------------
# Seed helpers
# --------------------------------------------------------------------------------------

#: The three Granite State Auto Group stores, exactly as the ARPI contract fixes
#: them. ``attribute_hash`` values are stand-ins with the right shape (64 lower-case
#: hex characters); the generator computes the real digests.
STORE_SEED: tuple[tuple[str, str, str, str, str | None, str, str, str, str], ...] = (
    (
        "GSA-001",
        "Granite Chevrolet of Nashua",
        "Granite Chevrolet",
        "Franchise New and Used",
        "Chevrolet",
        "Nashua",
        "Southern New Hampshire",
        "2009-04-06",
        "a" * 64,
    ),
    (
        "GSA-002",
        "Granite Subaru of Manchester",
        "Granite Subaru",
        "Franchise New and Used",
        "Subaru",
        "Manchester",
        "Southern New Hampshire",
        "2013-08-19",
        "b" * 64,
    ),
    (
        "GSA-003",
        "Granite Used Auto Center of Merrimack",
        "Granite Used Auto",
        "Independent Used",
        None,
        "Merrimack",
        "Southern New Hampshire",
        "2017-03-13",
        "c" * 64,
    ),
)


def seed_raw_dealerships(
    cur: Any,
    *,
    batch_id: str | None = None,
    overrides: dict[str, dict[str, str]] | None = None,
) -> str:
    """Insert one raw load batch of the three stores and return the batch id.

    ``overrides`` maps ``dealership_id`` to column/value pairs, which is how a test
    simulates a changed attribute and a changed ``attribute_hash``.
    """
    batch_id = batch_id or str(uuid.uuid4())
    overrides = overrides or {}

    for row_number, store in enumerate(STORE_SEED, start=1):
        (
            dealership_id,
            store_name,
            store_short_name,
            store_type,
            franchise_brand,
            city,
            market_region,
            opened_date,
            attribute_hash,
        ) = store
        values: dict[str, str | None] = {
            "dealership_key": str(row_number),
            "dealership_id": dealership_id,
            "store_name": store_name,
            "store_short_name": store_short_name,
            "store_type": store_type,
            "franchise_brand": franchise_brand,
            "city": city,
            "state_code": "NH",
            "market_region": market_region,
            "opened_date": opened_date,
            "is_active": "true",
            "effective_date": opened_date,
            "expiration_date": "9999-12-31",
            "is_current": "true",
            "attribute_hash": attribute_hash,
            "source_system": "arpi_synthetic_generator",
        }
        values.update(overrides.get(dealership_id, {}))

        columns = list(values)
        placeholders = ", ".join(["%s"] * (len(columns) + 3))
        cur.execute(
            f"INSERT INTO raw.dealership_load ({', '.join(columns)}, "
            f"load_batch_id, source_file_name, source_row_number) VALUES ({placeholders})",
            [*values.values(), batch_id, "dim_dealership.csv", row_number],
        )
    return batch_id


#: Dates in the seeded calendar that are recognised holidays, and whether the
#: showroom closes. Deliberately hand-written rather than derived, so the test data
#: does not silently agree with a buggy generator.
CALENDAR_HOLIDAYS: dict[str, tuple[str, bool]] = {
    "2025-07-04": ("Independence Day", True),
    "2025-09-01": ("Labor Day", False),
    "2025-10-13": ("Columbus Day", False),
    "2025-11-11": ("Veterans Day", False),
    "2025-11-27": ("Thanksgiving Day", True),
    "2025-12-25": ("Christmas Day", True),
}


def seed_raw_calendar(
    cur: Any,
    *,
    start_date: str = "2025-07-01",
    end_date: str = "2025-12-31",
    batch_id: str | None = None,
) -> str:
    """Insert one raw load batch covering a contiguous date range; return the batch id.

    The 26 dim_date attributes are derived in SQL from ``generate_series`` so the
    fixture stays fast and needs no Python date library, and so the values are
    computed by PostgreSQL rather than restating the generator's logic.
    """
    batch_id = batch_id or str(uuid.uuid4())
    holiday_values = ", ".join(
        f"(DATE '{day}', '{name}', {'true' if closes else 'false'})"
        for day, (name, closes) in CALENDAR_HOLIDAYS.items()
    )

    cur.execute(
        f"""
        INSERT INTO raw.calendar_date_load (
            date_key, full_date, day_of_month, day_name, day_of_week, day_of_year,
            week_of_year, iso_year, month_number, month_name, month_start_date,
            month_end_date, quarter_number, quarter_name, calendar_year, fiscal_month,
            fiscal_quarter, fiscal_year, is_weekend, is_month_end, is_quarter_end,
            is_year_end, is_holiday, holiday_name, is_closure_holiday, is_selling_day,
            load_batch_id, source_file_name, source_row_number
        )
        SELECT
            to_char(dd.d, 'YYYYMMDD'),
            to_char(dd.d, 'YYYY-MM-DD'),
            extract(day from dd.d)::text,
            btrim(to_char(dd.d, 'Day')),
            extract(isodow from dd.d)::text,
            extract(doy from dd.d)::text,
            extract(week from dd.d)::text,
            extract(isoyear from dd.d)::text,
            extract(month from dd.d)::text,
            btrim(to_char(dd.d, 'Month')),
            to_char(date_trunc('month', dd.d)::date, 'YYYY-MM-DD'),
            to_char((date_trunc('month', dd.d) + interval '1 month - 1 day')::date, 'YYYY-MM-DD'),
            extract(quarter from dd.d)::text,
            'Q' || extract(quarter from dd.d)::text,
            extract(year from dd.d)::text,
            extract(month from dd.d)::text,
            extract(quarter from dd.d)::text,
            extract(year from dd.d)::text,
            (extract(isodow from dd.d) IN (6, 7))::text,
            (dd.d = (date_trunc('month', dd.d) + interval '1 month - 1 day')::date)::text,
            (dd.d = (date_trunc('month', dd.d) + interval '1 month - 1 day')::date
             AND extract(month from dd.d) IN (3, 6, 9, 12))::text,
            (extract(month from dd.d) = 12 AND extract(day from dd.d) = 31)::text,
            (h.holiday_name IS NOT NULL)::text,
            h.holiday_name,
            coalesce(h.is_closure, false)::text,
            (NOT coalesce(h.is_closure, false))::text,
            %s::uuid,
            'dim_date.csv',
            (row_number() OVER (ORDER BY dd.d))::int
        FROM generate_series(%s::date, %s::date, interval '1 day') AS g(ts)
        CROSS JOIN LATERAL (SELECT g.ts::date AS d) AS dd
        LEFT JOIN LATERAL (
            SELECT v.holiday_name, v.is_closure
            FROM (VALUES {holiday_values}) AS v(hd, holiday_name, is_closure)
            WHERE v.hd = dd.d
        ) AS h ON true
        """,
        (batch_id, start_date, end_date),
    )
    return batch_id


def run_merge_scripts(cur: Any) -> None:
    """Run every ``sql/03_dimensions/*_merge.sql`` the way the loader does.

    Same glob, same sort order, same whole-file ``cursor.execute()``. If a merge
    file ever gains a ``psql`` meta-command or otherwise stops being executable
    this way, these tests fail before the loader does.
    """
    for path in sorted(SQL_ROOT.glob("03_dimensions/*_merge.sql")):
        cur.execute(path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------------------
# Fixtures exposing the helpers
# --------------------------------------------------------------------------------------
# The helpers are surfaced as fixtures rather than imported directly, because a
# test package without ``__init__.py`` cannot reliably import its own conftest by
# module path, and adding one would change how the rest of ``tests/`` is collected.


@pytest.fixture(scope="session")
def sql_root() -> Path:
    """Absolute path to the repository's ``sql/`` directory."""
    return SQL_ROOT


@pytest.fixture(scope="session")
def sql_init_files() -> list[Path]:
    """The ordered initialisation sequence, as ``sql/README.md`` defines it."""
    return init_sequence_files()


@pytest.fixture()
def init_sequence_runner() -> Any:
    """Callable ``(conn) -> list[str]`` that runs the whole initialisation sequence."""
    return run_init_sequence


@pytest.fixture()
def seed_calendar() -> Any:
    """Callable ``(cur, **kwargs) -> batch_id`` seeding ``raw.calendar_date_load``."""
    return seed_raw_calendar


@pytest.fixture()
def seed_dealerships() -> Any:
    """Callable ``(cur, **kwargs) -> batch_id`` seeding ``raw.dealership_load``."""
    return seed_raw_dealerships


@pytest.fixture()
def run_merges() -> Any:
    """Callable ``(cur) -> None`` running the dimension merge scripts in loader order."""
    return run_merge_scripts


# --------------------------------------------------------------------------------------
# A fully loaded warehouse, for the tests that need data rather than structure
# --------------------------------------------------------------------------------------
# Most of this package asserts on SQL structure and can work against an empty database.
# The KPI verification, reconciliation, reporter-role and Gate 1 readiness suites cannot:
# a KPI computed over zero rows proves only that the SQL parses, and a reconciliation
# that compares 0 with 0 passes without exercising anything.
#
# These fixtures build ONE database per test session, run the full initialisation
# sequence into it, and then run the real pipeline through the production load path
# exactly as the CLI does. Building it once is what keeps the cost tolerable; the
# per-test connection is transactional, so a test that writes -- the deliberate
# corruption tests do -- rolls back and leaves the data untouched for the next one.


@pytest.fixture(scope="session")
def loaded_database(maintenance_connection: Any) -> Iterator[str]:
    """A throwaway database with the SQL tree applied and one full pipeline run loaded.

    Uses the ``test`` profile, whose two-month window keeps the run fast while still
    producing non-zero rows in all eight dimensions and all five facts.
    """
    from pydantic import SecretStr

    from arpi.config import load_config
    from arpi.pipeline import run_foundation

    database_name = f"arpi_load_{uuid.uuid4().hex[:12]}"
    output_dir = REPO_ROOT / "data" / "raw" / f"_pytest_loaded_{uuid.uuid4().hex[:8]}"

    with maintenance_connection.cursor() as cur:
        cur.execute(f'CREATE DATABASE "{database_name}"')

    try:
        with psycopg.connect(dbname=database_name, **base_connection_kwargs()) as conn:
            run_init_sequence(conn)

        output_dir.mkdir(parents=True, exist_ok=True)
        connection = base_connection_kwargs()
        config = load_config(profile="test", config_dir=REPO_ROOT / "config")
        database_update: dict[str, Any] = {
            "enabled": True,
            "host": connection.get("host"),
            "port": connection.get("port", 5432),
            "name": database_name,
            "user": connection.get("user"),
            "sslmode": connection.get("sslmode", config.database.sslmode),
        }
        password = connection_password()
        if password is not None:
            database_update["password"] = SecretStr(password)
        config = config.model_copy(
            update={
                "database": config.database.model_copy(update=database_update),
                "paths": config.paths.model_copy(update={"raw_output_dir": output_dir}),
            }
        )

        result = run_foundation(config, load_database=True, output_dir=output_dir)
        assert result.database_loaded, (
            "the loaded_database fixture could not reach PostgreSQL through the "
            f"production load path: {result.database_skip_reason}"
        )
        assert not result.report.has_critical_failure, (
            "the loaded_database fixture produced critical data-quality failures"
        )
        yield database_name
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)
        with maintenance_connection.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')


@pytest.fixture()
def loaded_db(loaded_database: str) -> Iterator[Any]:
    """Transactional connection to the loaded database; always rolled back."""
    with psycopg.connect(dbname=loaded_database, **base_connection_kwargs()) as conn:
        try:
            yield conn
        finally:
            conn.rollback()


@pytest.fixture()
def loaded_cursor(loaded_db: Any) -> Iterator[Any]:
    """Plain cursor on the loaded, transactional connection."""
    with loaded_db.cursor() as cur:
        yield cur
