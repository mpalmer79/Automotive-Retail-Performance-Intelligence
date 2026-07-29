#!/usr/bin/env python3
"""Verify a cloud PostgreSQL deployment of the ARPI `reporting` schema.

WHAT THIS ENFORCES, AND WHY
---------------------------
`docs/cloud-database-setup.md` describes a managed PostgreSQL 16 database that a
cloud semantic-model engine reads over the public internet. Two things change the
moment the database stops being local, and both of them are the sort of thing that
is assumed rather than checked:

1. **The connection may not actually be encrypted.** `sslmode=require` in a
   `.env` proves nothing about the session that a tool eventually opened. This
   script asks the *server* whether the current backend is using TLS and fails
   loudly when it is not. A cloud database reached in clear text is a finding,
   not a warning.
2. **The load may not be the same load.** The `development` profile is
   deterministic from seed 20250701, so a faithful cloud load reproduces the
   local row counts exactly. Anything else means the cloud database was built
   from a different profile, a partial run, or a rerun that duplicated rows.
   Every expected count below is therefore an equality, never a lower bound.

It also re-proves the third thing that must survive the move: `arpi_reporter`
holds **no** privilege on `raw`, `staging`, `warehouse` or `audit`. That is
verified against *this* database rather than inferred from the local one, because
a managed provider's non-superuser bootstrap role changes who owns what, and
ownership is the mechanism the isolation rests on.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It never prints a password, a host name, a port, a user name, a database name or
a connection string -- not in its normal output and not in its error output. A
verification run is exactly the output somebody pastes into an issue, so it is
written to be safe to paste. Connection failures are reported by exception type
and nothing else.

It does not write to the database, does not create anything, and does not need to
be run as a superuser. Read access to the catalogues and to the five ARPI schemas
is enough.

CONNECTION SETTINGS
-------------------
Resolved from `ARPI_DATABASE__*` first, then the standard `PG*` variables, exactly
as `scripts/generate_sql_baseline.py` does -- one convention, not two. Two keys are
resolved here that the baseline generator has no use for, both of which are already
part of the documented ARPI configuration surface: `ARPI_DATABASE__SSLMODE`
(`PGSSLMODE`) and `ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS` (`PGCONNECT_TIMEOUT`).
Without the first, the TLS mode an operator configured for ARPI would be ignored
by the one script whose job is to check TLS.

Usage
-----
    python scripts/verify_cloud_database.py
    python scripts/verify_cloud_database.py --quiet
    python scripts/verify_cloud_database.py --list-checks
    python scripts/verify_cloud_database.py --checks tls reporting-row-counts

Exit codes
----------
    0  every selected check passed
    1  at least one finding
    2  the check could not be run at all (psycopg missing, or no connection)
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

try:
    import psycopg
except ImportError:  # pragma: no cover - psycopg is an optional extra, not a hard dependency
    psycopg = None  # type: ignore[assignment]

#: Minimum server version. `sql/` targets PostgreSQL 16; a managed provider that
#: only offers 15 is a different deployment and must not be reported as this one.
MINIMUM_SERVER_VERSION_NUM: int = 160000

#: The five ARPI schemas, in layer order.
ARPI_SCHEMAS: tuple[str, ...] = ("raw", "staging", "warehouse", "reporting", "audit")

#: The four schemas `arpi_reporter` must hold no privilege on, at any level.
PIPELINE_SCHEMAS: tuple[str, ...] = ("raw", "staging", "warehouse", "audit")

#: The role the semantic model connects through. It is a NOLOGIN group role; a
#: separate login role is granted membership in it.
REPORTER_ROLE: str = "arpi_reporter"

#: Table-level privileges checked one by one, rather than trusting `ALL`.
TABLE_PRIVILEGES: tuple[str, ...] = (
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
)

#: Exactly this many views in `reporting`. More means something was added out of
#: band; fewer means the ordered sequence did not finish.
EXPECTED_REPORTING_VIEW_COUNT: int = 28

#: The eight conformed dimensions. Each must exist and hold at least one row.
EXPECTED_DIMENSION_TABLES: tuple[str, ...] = (
    "dim_customer",
    "dim_date",
    "dim_dealership",
    "dim_employee",
    "dim_lead_source",
    "dim_marketing_campaign",
    "dim_vehicle",
    "dim_vehicle_model",
)

#: The five MVP facts. Each must exist and hold at least one row.
EXPECTED_FACT_TABLES: tuple[str, ...] = (
    "fact_appointment",
    "fact_lead",
    "fact_marketing_spend",
    "fact_vehicle_inventory_snapshot",
    "fact_vehicle_sale",
)

#: Exact reporting row counts for the `development` profile at seed 20250701 over
#: 2025-07-01 .. 2025-12-31 with three stores. These are equalities on purpose:
#: the generator is deterministic, so a correct cloud load reproduces every one of
#: them. A mismatch identifies which view diverged and by how much.
EXPECTED_REPORTING_ROW_COUNTS: dict[str, int] = {
    "vw_calendar": 184,
    "vw_dealership": 3,
    "vw_employee": 30,
    "vw_customer": 2500,
    "vw_vehicle_model": 120,
    "vw_vehicle": 900,
    "vw_lead_source": 19,
    "vw_marketing_campaign": 24,
    "vw_vehicle_sales": 650,
    "vw_inventory_snapshots": 45754,
    "vw_leads": 6000,
    "vw_appointments": 2111,
    "vw_marketing_spend": 212,
    "vw_inventory_turn": 30,
    "vw_days_supply": 920,
    "vw_marketing_performance": 537,
    "vw_data_quality_trend": 9,
    "vw_reconciliation_status": 58,
    "vw_pipeline_run_summary": 1,
    "vw_data_quality_summary": 114,
}

#: Reconciliations the loader records on every run, and how many may fail.
EXPECTED_RECONCILIATION_COUNT: int = 58
EXPECTED_FAILING_RECONCILIATION_COUNT: int = 0

#: The profile and seed the cloud database must have been loaded from.
EXPECTED_PROFILE: str = "development"
EXPECTED_RANDOM_SEED: int = 20250701
EXPECTED_RUN_STATUS: str = "succeeded"


@dataclass(frozen=True)
class Finding:
    """One failed expectation, in the house `path:line: message` reporting shape.

    `location` is the database object the finding is about and `check_id` the
    check that produced it, so a report line reads
    `reporting.vw_leads:reporting-row-counts: ...` in the same position a file
    path and a line number would occupy in the other repository checks.
    """

    location: str
    check_id: str
    message: str

    def render(self) -> str:
        """Return the one-line report form of this finding."""
        return f"{self.location}:{self.check_id}: {self.message}"


#: A check returns its findings plus a short, credential-free note for the report.
CheckOutcome = tuple[list[Finding], str]


@dataclass(frozen=True)
class Check:
    """One named verification, its purpose, and the function that performs it."""

    name: str
    description: str
    run: Callable[[Any], CheckOutcome]


def scalar(cursor: Any, statement: str, params: Sequence[Any] | None = None) -> Any:
    """Execute *statement* and return the first column of the first row, or None."""
    cursor.execute(statement, list(params) if params is not None else None)
    row = cursor.fetchone()
    return None if row is None else row[0]


# --------------------------------------------------------------------------------------
# The checks
# --------------------------------------------------------------------------------------


def check_server_version(cursor: Any) -> CheckOutcome:
    """Fail unless the server is PostgreSQL 16 or later."""
    version_num = int(scalar(cursor, "SELECT current_setting('server_version_num')::int"))
    version_text = str(scalar(cursor, "SELECT current_setting('server_version')"))
    if version_num < MINIMUM_SERVER_VERSION_NUM:
        return (
            [
                Finding(
                    "server",
                    "server-version",
                    f"PostgreSQL {version_text} is older than the required 16. The sql/ tree "
                    "targets 16; provision a 16 (or later) instance rather than working around "
                    "this.",
                )
            ],
            version_text,
        )
    return [], f"PostgreSQL {version_text}"


def check_tls(cursor: Any) -> CheckOutcome:
    """Fail unless this very connection is encrypted, according to the server."""
    cursor.execute(
        "SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    )
    row = cursor.fetchone()
    if row is None:
        return (
            [
                Finding(
                    "connection",
                    "tls",
                    "the server reported no pg_stat_ssl row for this backend, so TLS cannot be "
                    "confirmed. Treat that as not encrypted.",
                )
            ],
            "unknown",
        )
    in_use, protocol, cipher = row
    if not in_use:
        return (
            [
                Finding(
                    "connection",
                    "tls",
                    "this connection is NOT using TLS. A cloud database must be reached over "
                    "TLS: set ARPI_DATABASE__SSLMODE=require (or stricter) and confirm the "
                    "provider is not being reached through an unencrypted pooler port.",
                )
            ],
            "not encrypted",
        )
    return [], f"{protocol} / {cipher}"


def check_schemas(cursor: Any) -> CheckOutcome:
    """Fail unless all five ARPI schemas exist."""
    cursor.execute(
        "SELECT nspname FROM pg_namespace WHERE nspname = ANY(%s)",
        [list(ARPI_SCHEMAS)],
    )
    present = {str(row[0]) for row in cursor.fetchall()}
    findings = [
        Finding(
            name,
            "schemas",
            "schema is absent. Run the ordered sql/ sequence against this database before "
            "verifying it.",
        )
        for name in ARPI_SCHEMAS
        if name not in present
    ]
    return findings, f"{len(present)} of {len(ARPI_SCHEMAS)} present"


def check_reporting_view_count(cursor: Any) -> CheckOutcome:
    """Fail unless `reporting` holds exactly the expected number of views."""
    observed = int(
        scalar(
            cursor,
            "SELECT count(*) FROM information_schema.views WHERE table_schema = 'reporting'",
        )
    )
    if observed != EXPECTED_REPORTING_VIEW_COUNT:
        return (
            [
                Finding(
                    "reporting",
                    "reporting-view-count",
                    f"expected exactly {EXPECTED_REPORTING_VIEW_COUNT} views, found {observed}. "
                    "Fewer means the ordered sequence did not finish; more means an object was "
                    "created outside sql/.",
                )
            ],
            f"{observed} views",
        )
    return [], f"{observed} views"


def _warehouse_tables(cursor: Any) -> set[str]:
    """Return the names of every ordinary table in the `warehouse` schema."""
    cursor.execute(
        "SELECT c.relname FROM pg_class AS c "
        "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'warehouse' AND c.relkind IN ('r', 'p')",
    )
    return {str(row[0]) for row in cursor.fetchall()}


def check_warehouse_tables(cursor: Any) -> CheckOutcome:
    """Fail unless all eight dimensions and five facts exist and hold rows."""
    present = _warehouse_tables(cursor)
    findings: list[Finding] = []
    populated = 0
    expected = (
        *((name, "dimension") for name in EXPECTED_DIMENSION_TABLES),
        *((name, "fact") for name in EXPECTED_FACT_TABLES),
    )
    for name, kind in expected:
        if name not in present:
            findings.append(
                Finding(
                    f"warehouse.{name}",
                    "warehouse-tables",
                    f"{kind} table is absent. The ordered sql/ sequence has not been run to "
                    "completion against this database.",
                )
            )
            continue
        rows = int(scalar(cursor, f"SELECT count(*) FROM warehouse.{name}"))
        if rows == 0:
            findings.append(
                Finding(
                    f"warehouse.{name}",
                    "warehouse-tables",
                    f"{kind} table exists but holds no rows. The schema was built and the "
                    "pipeline was not run, or it was run without --load-database.",
                )
            )
            continue
        populated += 1
    return findings, f"{populated} of {len(expected)} populated"


def _reporting_relations(cursor: Any) -> set[str]:
    """Return the names of every readable relation in the `reporting` schema."""
    cursor.execute(
        "SELECT c.relname FROM pg_class AS c "
        "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'reporting' AND c.relkind IN ('r', 'p', 'v', 'm')",
    )
    return {str(row[0]) for row in cursor.fetchall()}


def check_reporting_row_counts(cursor: Any) -> CheckOutcome:
    """Fail on any reporting view whose row count is not exactly the expected one."""
    present = _reporting_relations(cursor)
    findings: list[Finding] = []
    matched = 0
    for view, expected in EXPECTED_REPORTING_ROW_COUNTS.items():
        if view not in present:
            findings.append(
                Finding(
                    f"reporting.{view}",
                    "reporting-row-counts",
                    f"view does not exist; it should hold {expected} rows. The ordered sql/ "
                    "sequence has not been run to completion against this database.",
                )
            )
            continue
        observed = int(scalar(cursor, f"SELECT count(*) FROM reporting.{view}"))
        if observed != expected:
            findings.append(
                Finding(
                    f"reporting.{view}",
                    "reporting-row-counts",
                    f"expected {expected} rows, found {observed}. The development profile is "
                    "deterministic at seed 20250701, so this is a difference in the load, not "
                    "in the expectation.",
                )
            )
            continue
        matched += 1
    return findings, f"{matched} of {len(EXPECTED_REPORTING_ROW_COUNTS)} views exact"


def check_reconciliations(cursor: Any) -> CheckOutcome:
    """Fail unless every recorded reconciliation is present and passing."""
    if "vw_reconciliation_status" not in _reporting_relations(cursor):
        return (
            [
                Finding(
                    "reporting.vw_reconciliation_status",
                    "reconciliations",
                    "view does not exist, so no reconciliation can be read. Run the ordered "
                    "sql/ sequence to completion.",
                )
            ],
            "view absent",
        )
    cursor.execute(
        "SELECT count(*), count(*) FILTER (WHERE NOT is_passing) "
        "FROM reporting.vw_reconciliation_status",
    )
    total, failing = (int(value) for value in cursor.fetchone())
    findings: list[Finding] = []
    if total != EXPECTED_RECONCILIATION_COUNT:
        findings.append(
            Finding(
                "reporting.vw_reconciliation_status",
                "reconciliations",
                f"expected {EXPECTED_RECONCILIATION_COUNT} recorded reconciliations, found "
                f"{total}. A short count means the load did not record them all.",
            )
        )
    if failing != EXPECTED_FAILING_RECONCILIATION_COUNT:
        findings.append(
            Finding(
                "reporting.vw_reconciliation_status",
                "reconciliations",
                f"{failing} reconciliation(s) are failing; "
                f"{EXPECTED_FAILING_RECONCILIATION_COUNT} may fail. Query the view for "
                "reconciliation_id and observed values before changing anything else.",
            )
        )
    return findings, f"{total} recorded, {failing} failing"


def check_pipeline_run(cursor: Any) -> CheckOutcome:
    """Fail unless the latest run recorded the development profile and seed 20250701."""
    if "vw_pipeline_run_summary" not in _reporting_relations(cursor):
        return (
            [
                Finding(
                    "reporting.vw_pipeline_run_summary",
                    "pipeline-run",
                    "view does not exist, so the profile and seed this database was loaded "
                    "from cannot be established. Run the ordered sql/ sequence to completion.",
                )
            ],
            "view absent",
        )
    cursor.execute(
        "SELECT profile_name, random_seed, run_status FROM reporting.vw_pipeline_run_summary "
        "ORDER BY pipeline_run_id DESC LIMIT 1",
    )
    row = cursor.fetchone()
    if row is None:
        return (
            [
                Finding(
                    "audit.pipeline_run",
                    "pipeline-run",
                    "no pipeline run is recorded. The schema exists but nothing has been loaded "
                    "through arpi run-foundation --load-database.",
                )
            ],
            "no run recorded",
        )
    profile, seed, status = str(row[0]), int(row[1]), str(row[2])
    findings: list[Finding] = []
    if profile != EXPECTED_PROFILE:
        findings.append(
            Finding(
                "audit.pipeline_run",
                "pipeline-run",
                f"expected profile {EXPECTED_PROFILE!r}, found {profile!r}. The expected row "
                "counts describe the development profile and mean nothing against another one.",
            )
        )
    if seed != EXPECTED_RANDOM_SEED:
        findings.append(
            Finding(
                "audit.pipeline_run",
                "pipeline-run",
                f"expected seed {EXPECTED_RANDOM_SEED}, found {seed}. A different seed produces "
                "different data from the same generator.",
            )
        )
    if status != EXPECTED_RUN_STATUS:
        findings.append(
            Finding(
                "audit.pipeline_run",
                "pipeline-run",
                f"the latest run status is {status!r}, not {EXPECTED_RUN_STATUS!r}. Whatever "
                "else matches, this database was not loaded by a run that finished.",
            )
        )
    return findings, f"{profile} / seed {seed} / {status}"


def _reporter_role_exists(cursor: Any) -> bool:
    """Return True when the reporter group role exists in this cluster."""
    return bool(
        scalar(
            cursor,
            "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s)",
            [REPORTER_ROLE],
        )
    )


def _reporter_schema_findings(cursor: Any) -> list[Finding]:
    """Return a finding for every pipeline schema the reporter holds USAGE or CREATE on."""
    cursor.execute(
        "SELECT s.schema_name, p.privilege "
        "FROM unnest(%s::text[]) AS s(schema_name) "
        "CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege) "
        "WHERE has_schema_privilege(%s, s.schema_name, p.privilege) "
        "ORDER BY 1, 2",
        [list(PIPELINE_SCHEMAS), REPORTER_ROLE],
    )
    return [
        Finding(
            str(schema_name),
            "reporter-isolation",
            f"{REPORTER_ROLE} holds {privilege} on this schema. Without schema USAGE no table "
            "grant can be exercised, which is precisely why it must not be held.",
        )
        for schema_name, privilege in cursor.fetchall()
    ]


def _reporter_object_findings(cursor: Any) -> list[Finding]:
    """Return a finding for every pipeline object the reporter holds a table privilege on."""
    cursor.execute(
        "SELECT n.nspname, c.relname, p.privilege "
        "FROM pg_class AS c "
        "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
        "CROSS JOIN unnest(%s::text[]) AS p(privilege) "
        "WHERE n.nspname = ANY(%s) "
        "  AND c.relkind IN ('r', 'p', 'v', 'm', 'f') "
        "  AND has_table_privilege(%s, c.oid, p.privilege) "
        "ORDER BY 1, 2, 3",
        [list(TABLE_PRIVILEGES), list(PIPELINE_SCHEMAS), REPORTER_ROLE],
    )
    return [
        Finding(
            f"{schema_name}.{object_name}",
            "reporter-isolation",
            f"{REPORTER_ROLE} holds {privilege} on this object. The semantic model connects "
            "through this role, so it can read the pipeline layers.",
        )
        for schema_name, object_name, privilege in cursor.fetchall()
    ]


def _reporter_grant_findings(cursor: Any) -> list[Finding]:
    """Return a finding for every direct grant recorded against the reporter."""
    cursor.execute(
        "SELECT table_schema, table_name, privilege_type "
        "FROM information_schema.table_privileges "
        "WHERE grantee = %s AND table_schema = ANY(%s) "
        "ORDER BY 1, 2, 3",
        [REPORTER_ROLE, list(PIPELINE_SCHEMAS)],
    )
    return [
        Finding(
            f"{schema_name}.{object_name}",
            "reporter-isolation",
            f"information_schema.table_privileges records an explicit {privilege} grant to "
            f"{REPORTER_ROLE}. Re-run sql/07_security/01_grants.sql, which revokes it.",
        )
        for schema_name, object_name, privilege in cursor.fetchall()
    ]


def check_reporter_isolation(cursor: Any) -> CheckOutcome:
    """Fail on any privilege the reporter holds in raw, staging, warehouse or audit."""
    if not _reporter_role_exists(cursor):
        return (
            [
                Finding(
                    "cluster",
                    "reporter-isolation",
                    f"role {REPORTER_ROLE} does not exist, so the isolation this deployment "
                    "depends on is not in place at all. Run sql/07_security/00_roles.sql.",
                )
            ],
            "role absent",
        )
    findings = [
        *_reporter_schema_findings(cursor),
        *_reporter_object_findings(cursor),
        *_reporter_grant_findings(cursor),
    ]
    if findings:
        return findings, f"{len(findings)} privilege(s) held"
    readable = int(
        scalar(
            cursor,
            "SELECT count(*) FROM pg_class AS c "
            "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'reporting' AND c.relkind IN ('r', 'p', 'v', 'm') "
            "  AND has_table_privilege(%s, c.oid, 'SELECT')",
            [REPORTER_ROLE],
        )
    )
    return [], f"confined to reporting; {readable} view(s) readable"


CHECKS: tuple[Check, ...] = (
    Check("server-version", "PostgreSQL 16 or later", check_server_version),
    Check("tls", "this connection is encrypted", check_tls),
    Check("schemas", "all five ARPI schemas exist", check_schemas),
    Check(
        "reporting-view-count",
        f"exactly {EXPECTED_REPORTING_VIEW_COUNT} views in reporting",
        check_reporting_view_count,
    ),
    Check(
        "warehouse-tables",
        "eight dimensions and five facts exist and hold rows",
        check_warehouse_tables,
    ),
    Check(
        "reporting-row-counts",
        "every reporting view holds exactly the development-profile row count",
        check_reporting_row_counts,
    ),
    Check(
        "reconciliations",
        f"{EXPECTED_RECONCILIATION_COUNT} reconciliations recorded, none failing",
        check_reconciliations,
    ),
    Check(
        "pipeline-run",
        f"the run recorded profile {EXPECTED_PROFILE} at seed {EXPECTED_RANDOM_SEED}",
        check_pipeline_run,
    ),
    Check(
        "reporter-isolation",
        f"{REPORTER_ROLE} holds nothing in raw, staging, warehouse or audit",
        check_reporter_isolation,
    ),
)


# --------------------------------------------------------------------------------------
# Connection and command line
# --------------------------------------------------------------------------------------


def connection_kwargs() -> dict[str, Any]:
    """Resolve connection settings from ARPI_DATABASE__* then PG*, as the test suite does."""

    def first(*names: str) -> str | None:
        for name in names:
            value = os.environ.get(name)
            if value:
                return value
        return None

    kwargs: dict[str, Any] = {
        "host": first("ARPI_DATABASE__HOST", "PGHOST") or "localhost",
        "port": int(first("ARPI_DATABASE__PORT", "PGPORT") or 5432),
        "dbname": first("ARPI_DATABASE__NAME", "PGDATABASE") or "arpi_dev",
        "user": first("ARPI_DATABASE__USER", "PGUSER") or os.environ.get("USER", "postgres"),
    }
    password = first("ARPI_DATABASE__PASSWORD", "PGPASSWORD")
    if password:
        kwargs["password"] = password
    sslmode = first("ARPI_DATABASE__SSLMODE", "PGSSLMODE")
    if sslmode:
        kwargs["sslmode"] = sslmode
    timeout = first("ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS", "PGCONNECT_TIMEOUT")
    if timeout:
        kwargs["connect_timeout"] = int(timeout)
    return kwargs


def resolve_checks(names: Sequence[str]) -> tuple[list[Check], str | None]:
    """Return the checks matching *names*, or an explanation of why none could be."""
    if not names:
        return list(CHECKS), None
    by_name = {check.name: check for check in CHECKS}
    unknown = [name for name in names if name not in by_name]
    if unknown:
        return [], (
            f"unknown check(s): {', '.join(unknown)}. "
            "Run with --list-checks to see the available names."
        )
    return [by_name[name] for name in names], None


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description=(
            "Verify a cloud PostgreSQL deployment of the ARPI reporting schema. Prints no "
            "host, user name, database name or password, ever."
        ),
    )
    parser.add_argument(
        "--checks",
        nargs="+",
        default=[],
        metavar="NAME",
        help="Limit the run to these checks (default: all of them). See --list-checks.",
    )
    parser.add_argument(
        "--list-checks",
        action="store_true",
        help="Print the available check names and exit 0.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only findings and the final summary line.",
    )
    return parser


def run_checks(cursor: Any, checks: Sequence[Check], quiet: bool) -> list[Finding]:
    """Run every check in *checks* and return the accumulated findings."""
    findings: list[Finding] = []
    for check in checks:
        check_findings, note = check.run(cursor)
        findings.extend(check_findings)
        if not quiet:
            status = "FAIL" if check_findings else " ok "
            print(f"  [{status}] {check.name:<22} {note}")
    return findings


def main(argv: Sequence[str] | None = None) -> int:
    """Run the cloud verification and return a process exit code."""
    args = build_parser().parse_args(argv)

    if args.list_checks:
        for check in CHECKS:
            print(f"{check.name:<22} {check.description}")
        return 0

    if psycopg is None:
        print(
            "error: psycopg is required by this script and is not installed. "
            "Install the optional extra with: pip install -e '.[db]'",
            file=sys.stderr,
        )
        return 2

    checks, selection_error = resolve_checks(args.checks)
    if selection_error is not None:
        print(f"error: {selection_error}", file=sys.stderr)
        return 2

    if not args.quiet:
        print("ARPI cloud database verification")
        print(f"  checks selected  : {len(checks)} of {len(CHECKS)}")
        print("  connection       : resolved from ARPI_DATABASE__* then PG*; never printed")
        print()

    try:
        with (
            psycopg.connect(**connection_kwargs(), autocommit=True) as connection,
            connection.cursor() as cursor,
        ):
            findings = run_checks(cursor, checks, args.quiet)
    except psycopg.Error as error:
        # The exception text carries the host, port, user and database name. None of
        # that may reach this output, so only the exception type is reported.
        print(
            f"error: could not run the verification ({type(error).__name__}). Check that "
            "ARPI_DATABASE__HOST, PORT, NAME, USER and PASSWORD are exported, that the "
            "instance is running and not paused, and that your address is allowed to reach it.",
            file=sys.stderr,
        )
        return 2

    if findings:
        print()
        print(f"Findings ({len(findings)}):")
        for finding in findings:
            print(f"  {finding.render()}")
        print()
        print(
            f"FAIL: {len(findings)} finding(s) across {len(checks)} check(s). This database is "
            "not a faithful deployment of the ARPI reporting schema; fix the load or the "
            "grants rather than the expectations."
        )
        return 1

    if not args.quiet:
        print()
    print(f"OK: {len(checks)} check(s) passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
