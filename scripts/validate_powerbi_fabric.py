r"""Validate the deployed ARPI semantic model against its SQL baseline, using Fabric.

WHAT THIS IS
------------
The Microsoft Fabric half of ADR-0008's real-engine validation. It is the exact
counterpart of ``scripts/validate_powerbi_model.ps1``, which does the same job through a
running Power BI Desktop instance on Windows. Either satisfies the gate; this one needs
nothing but a browser, which is why it exists.

It proves, in order:

1. the deployed model's metadata matches the committed inventory — twenty-six tables,
   forty-two relationships, forty-nine measures, one marked date table;
2. every imported table refreshed and holds its expected row count;
3. every governed KPI returns, in every filter context, the number the governed SQL says
   it should.

WHY ``includeNulls`` MATTERS MORE THAN IT LOOKS
----------------------------------------------
The Execute Queries API omits null columns from a row object unless ``includeNulls`` is
set. ARPI has two filter contexts whose entire purpose is to prove a measure returns
*blank* rather than *zero* — an organic lead source with no cost basis, and a store-day
with no retail sale. Without ``includeNulls`` a correct blank arrives as a missing key,
which is indistinguishable from a measure this script forgot to ask for. It is set, and
a missing key is therefore treated as a hard failure rather than as a blank.

WHAT IT WILL NOT DO
-------------------
It never prints or records a token, a database password, or a connection string carrying
credentials. The evidence file names a workspace and an item — both are identifiers, not
secrets — and records who ran it only as free text they chose.

USAGE
-----
    python scripts/validate_powerbi_fabric.py \\
        --workspace-id <guid> --item-id <guid> --operator <your-github-handle>

Add ``--connection-id <guid>`` to bind the model to a cloud PostgreSQL connection before
refreshing. Add ``--skip-refresh`` if you have just refreshed it in the portal.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_desktop_validation_freshness as freshness
from arpi_fabric import (
    FABRIC_API,
    POWERBI_API,
    POWERBI_RESOURCE,
    ApiError,
    add_common_arguments,
    client_from_args,
    connection_binding,
    get_connection,
    log,
    redact,
    resolve_setting,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
VALIDATION_DIR = REPO_ROOT / "powerbi" / "validation"
BASELINE_PATH = VALIDATION_DIR / "sql_baseline.json"
EXPECTATIONS_PATH = VALIDATION_DIR / "model_expectations.json"
QUERIES_PATH = VALIDATION_DIR / "validation_queries.dax"
RESULTS_PATH = VALIDATION_DIR / "fabric_validation_results.json"

#: Relative tolerance for a floating-point comparison. Integer counts are compared
#: exactly regardless.
DEFAULT_TOLERANCE = 1e-6

#: Refresh polling bounds, in seconds. A 45,754-row fact table on a trial capacity takes
#: minutes, not seconds.
REFRESH_POLL_INTERVAL = 15
REFRESH_DEADLINE = 3600

HTTP_ACCEPTED = 202


# ---------------------------------------------------------------------------------------
# Execute Queries
# ---------------------------------------------------------------------------------------


def execute_dax(client: Any, workspace_id: str, item_id: str, query: str) -> list[dict[str, Any]]:
    """Run one DAX query through the Power BI Execute Queries REST API.

    One query per request: the API accepts a list but evaluates only the first, and
    pretending otherwise would silently drop contexts.
    """
    url = f"{POWERBI_API}/groups/{workspace_id}/datasets/{item_id}/executeQueries"
    body = {
        "queries": [{"query": query}],
        # See the module docstring. Without this, blank is indistinguishable from absent.
        "serializerSettings": {"includeNulls": True},
    }
    _, _, payload = client.request(
        "POST", url, resource=POWERBI_RESOURCE, body=body, expected=(200,)
    )
    results = (payload or {}).get("results") or []
    if not results:
        raise RuntimeError("Execute Queries returned no result set")
    tables = results[0].get("tables") or []
    if not tables:
        raise RuntimeError("Execute Queries returned no table")
    rows = tables[0].get("rows") or []
    return [dict(row) for row in rows]


def scalar_row(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Return the single row a ROW() query produces, keyed without DAX bracket noise."""
    if len(rows) != 1:
        raise RuntimeError(f"expected exactly one row, got {len(rows)}")
    return {key.strip("[]"): value for key, value in rows[0].items()}


# ---------------------------------------------------------------------------------------
# Model metadata, read from the deployed model rather than from the TMDL on disk
# ---------------------------------------------------------------------------------------

#: DAX INFO functions are the engine's own view of what it loaded. Reading the TMDL again
#: would prove nothing: the point is to ask the engine what it actually built.
#:
#: These deliberately select COLUMNS BY NAME and compare SETS rather than counting rows.
#: A count tells you "expected 26, got 27"; a set tells you which table appeared. They
#: also avoid depending on INFO.TABLES()[IsPrivate], which could not be confirmed against
#: published documentation -- a validation script must not fail on a column name nobody
#: verified.
TABLES_QUERY = (
    'EVALUATE SELECTCOLUMNS ( INFO.TABLES (), "TableName", [Name], "Category", [DataCategory] )'
)
MEASURES_QUERY = 'EVALUATE SELECTCOLUMNS ( INFO.MEASURES (), "MeasureName", [Name] )'
RELATIONSHIPS_QUERY = (
    'EVALUATE SELECTCOLUMNS ( INFO.RELATIONSHIPS (), "Active", [IsActive], '
    '"CrossFilter", [CrossFilteringBehavior], "FromCard", [FromCardinality], '
    '"ToCard", [ToCardinality] )'
)

#: TOM enum values as the DMV reports them.
CROSS_FILTER_ONE_DIRECTION = 1
CARDINALITY_ONE = 1
CARDINALITY_MANY = 2

#: A measure table is one whose name ends in " Measures". That is the model's own naming
#: convention and scripts/check_powerbi_model.py enforces it statically.
MEASURE_TABLE_SUFFIX = " Measures"


def rows_of(client: Any, workspace_id: str, item_id: str, query: str) -> list[dict[str, Any]]:
    """Run a multi-row DAX query and return its rows with DAX brackets stripped."""
    raw = execute_dax(client, workspace_id, item_id, query)
    return [{key.strip("[]"): value for key, value in row.items()} for row in raw]


def check_tables(client: Any, run: Run, expectations: dict[str, Any]) -> None:
    """Prove the engine built exactly the tables the repository declares."""
    try:
        rows = rows_of(client, run.workspace_id, run.item_id, TABLES_QUERY)
    except (ApiError, RuntimeError) as error:
        run.check("inventory:tables", False, f"INFO.TABLES() could not be read: {error}")
        return

    names = {str(row.get("TableName")) for row in rows}
    measure_tables = {n for n in names if n.endswith(MEASURE_TABLE_SUFFIX)}
    imported = names - measure_tables
    run.inventory["tables"] = len(names)
    run.inventory["imported_tables"] = len(imported)
    run.inventory["measure_tables"] = len(measure_tables)

    expected_imported = set(expectations["expected_row_counts"])
    missing = sorted(expected_imported - imported)
    unexpected = sorted(imported - expected_imported)
    run.check(
        "inventory:imported-tables",
        not missing and not unexpected,
        f"missing {missing}, unexpected {unexpected}" if (missing or unexpected) else "",
    )
    run.check(
        "inventory:measure-tables",
        len(measure_tables) == expectations["measure_table_count"],
        f"expected {expectations['measure_table_count']}, engine has {sorted(measure_tables)}",
    )
    run.check(
        "inventory:table-count",
        len(names) == expectations["table_count"],
        f"expected {expectations['table_count']}, engine reports {len(names)}",
    )

    # The marked date table. A model that lost it still refreshes and still returns
    # numbers -- it just silently stops doing time intelligence, which is precisely the
    # kind of defect no static check and no total can catch.
    marked = {str(r.get("TableName")) for r in rows if str(r.get("Category") or "") == "Time"}
    run.check(
        "inventory:marked-date-table",
        marked == {expectations["marked_date_table"]},
        f"expected exactly {{{expectations['marked_date_table']!r}}} marked as a date "
        f"table, engine reports {sorted(marked)}",
    )


def check_measures(client: Any, run: Run, expectations: dict[str, Any]) -> None:
    """Prove every governed measure exists on the engine, by name."""
    try:
        rows = rows_of(client, run.workspace_id, run.item_id, MEASURES_QUERY)
    except (ApiError, RuntimeError) as error:
        run.check("inventory:measures", False, f"INFO.MEASURES() could not be read: {error}")
        return

    names = {str(row.get("MeasureName")) for row in rows}
    run.inventory["measures"] = len(names)
    run.check(
        "inventory:measure-count",
        len(names) == expectations["measure_count"],
        f"expected {expectations['measure_count']}, engine reports {len(names)}",
    )
    # Every measure the baseline reconciles must exist under exactly that name, or the
    # reconciliation below would fail with a confusing DAX error instead of a clear one.
    reconciled = set(expectations.get("measure_map", {}).values())
    missing = sorted(reconciled - names)
    run.check(
        "inventory:reconciled-measures-present",
        not missing,
        f"the engine has no measure named: {missing}",
    )


def check_relationships(client: Any, run: Run, expectations: dict[str, Any]) -> None:
    """Prove the relationship register survived deployment, including its shape."""
    try:
        rows = rows_of(client, run.workspace_id, run.item_id, RELATIONSHIPS_QUERY)
    except (ApiError, RuntimeError) as error:
        run.check(
            "inventory:relationships", False, f"INFO.RELATIONSHIPS() could not be read: {error}"
        )
        return

    def truthy(value: Any) -> bool:
        return str(value).strip().lower() in {"true", "1"}

    active = [r for r in rows if truthy(r.get("Active"))]
    bidirectional = [
        r
        for r in rows
        if r.get("CrossFilter") is not None and int(r["CrossFilter"]) != CROSS_FILTER_ONE_DIRECTION
    ]
    many_to_many = [
        r for r in rows if r.get("ToCard") is not None and int(r["ToCard"]) != CARDINALITY_ONE
    ]
    wrong_from = [
        r for r in rows if r.get("FromCard") is not None and int(r["FromCard"]) != CARDINALITY_MANY
    ]

    run.inventory["relationships"] = len(rows)
    run.inventory["active_relationships"] = len(active)

    run.check(
        "inventory:relationship-count",
        len(rows) == expectations["relationship_count"],
        f"expected {expectations['relationship_count']}, engine reports {len(rows)}",
    )
    run.check(
        "inventory:active-relationships",
        len(active) == expectations["active_relationship_count"],
        f"expected {expectations['active_relationship_count']}, engine reports {len(active)}",
    )
    run.check(
        "inventory:no-bidirectional",
        not bidirectional,
        f"{len(bidirectional)} relationship(s) filter in both directions",
    )
    run.check(
        "inventory:no-many-to-many",
        not many_to_many,
        f"{len(many_to_many)} relationship(s) are not many-to-one on the 'to' side",
    )
    run.check(
        "inventory:many-to-one",
        not wrong_from,
        f"{len(wrong_from)} relationship(s) are not many on the 'from' side",
    )


# ---------------------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------------------


def bind_connection(client: Any, workspace_id: str, item_id: str, connection_id: str) -> None:
    """Bind the semantic model's data source to an existing Fabric cloud connection.

    ``connectionDetails`` is REQUIRED by the API. It is read from the connection itself
    rather than guessed, so the PostgreSQL ``type`` and ``path`` strings come from the
    service that owns them.
    """
    connection = get_connection(client, connection_id)
    url = f"{FABRIC_API}/workspaces/{workspace_id}/semanticModels/{item_id}/bindConnection"
    client.request(
        "POST", url, body={"connectionBinding": connection_binding(connection)}, expected=(200,)
    )
    log(f"  bound to connection {connection_id}")


def trigger_refresh(client: Any, workspace_id: str, item_id: str) -> str:
    """Start a full refresh and return its request identifier."""
    url = f"{POWERBI_API}/groups/{workspace_id}/datasets/{item_id}/refreshes"
    status, headers, _ = client.request(
        "POST",
        url,
        resource=POWERBI_RESOURCE,
        body={"type": "Full", "notifyOption": "NoNotification"},
        expected=(200, HTTP_ACCEPTED),
    )
    request_id = headers.get("requestid") or headers.get("x-ms-request-id") or ""
    log(f"  refresh started (status {status})")
    return request_id


def poll_refresh(client: Any, workspace_id: str, item_id: str) -> dict[str, Any]:
    """Poll refresh history until the newest refresh leaves ``Unknown``."""
    url = f"{POWERBI_API}/groups/{workspace_id}/datasets/{item_id}/refreshes?$top=1"
    deadline = time.time() + REFRESH_DEADLINE
    while time.time() < deadline:
        _, _, payload = client.request("GET", url, resource=POWERBI_RESOURCE, expected=(200,))
        entries = (payload or {}).get("value") or []
        if not entries:
            time.sleep(REFRESH_POLL_INTERVAL)
            continue
        newest = entries[0]
        # The Power BI refresh API uses "Unknown" to mean "in progress", which reads
        # alarmingly but is documented and normal.
        if newest.get("status") != "Unknown":
            return dict(newest)
        time.sleep(REFRESH_POLL_INTERVAL)
    raise RuntimeError("The refresh did not finish within an hour.")


# ---------------------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------------------


def read_context_queries(path: Path) -> dict[str, str]:
    """Parse the generated DAX file into ``{context_id: query}``."""
    queries: dict[str, str] = {}
    current: str | None = None
    buffer: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        marker = line.strip()
        if marker.startswith("// ARPI-CONTEXT:"):
            if current:
                queries[current] = "\n".join(buffer).strip()
            current = marker.split(":", 1)[1].strip()
            buffer = []
            continue
        if current is not None and not marker.startswith("//"):
            buffer.append(line)
    if current:
        queries[current] = "\n".join(buffer).strip()
    return queries


def compare_value(
    expected: Any, actual: Any, tolerance: float
) -> tuple[bool, float | None, str | None]:
    """Compare one baseline value with one DAX value.

    Blank on one side and a number on the other is the single most important failure this
    script can catch: it is how a zero denominator starts rendering as $0 rather than as a
    gap, and how an organic lead source starts reporting a free lead.
    """
    if expected is None and actual is None:
        return True, None, None
    if expected is None or actual is None:
        return False, None, "one side is blank and the other is not"
    try:
        expected_number = float(expected)
        actual_number = float(actual)
    except (TypeError, ValueError):
        return expected == actual, None, "values are not numeric and are not equal"
    delta = abs(expected_number - actual_number)
    scale = max(1.0, abs(expected_number))
    return (delta / scale <= tolerance), delta, None


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser for this script."""
    parser = argparse.ArgumentParser(
        description=(
            "Refresh the deployed ARPI semantic model in Microsoft Fabric and reconcile "
            "its DAX against the governed SQL baseline."
        )
    )
    add_common_arguments(parser)
    parser.add_argument(
        "--item-id", default=None, help="Semantic model GUID. Env: ARPI_FABRIC_ITEM_ID."
    )
    parser.add_argument(
        "--connection-id",
        default=None,
        help=(
            "Fabric cloud connection GUID to bind before refreshing. "
            "Env: ARPI_FABRIC_CONNECTION_ID. Omit if the model is already bound."
        ),
    )
    parser.add_argument(
        "--operator",
        default=None,
        help=(
            "Who ran this, as free text you choose - a GitHub handle is the usual answer. "
            "Recorded in the evidence file. Do not pass an email address or a domain account."
        ),
    )
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument(
        "--skip-refresh",
        action="store_true",
        help="Do not trigger a refresh. Use only when you have just refreshed by hand.",
    )
    return parser


@dataclass
class Run:
    """Everything one validation run accumulates, so it can be passed as one thing."""

    workspace_id: str
    item_id: str
    model_hash: str
    operator: str | None
    tolerance: float
    refresh_result: str | None = None
    retrieved_definition_hash: str | None = None
    row_counts: dict[str, int] = field(default_factory=dict)
    inventory: dict[str, int | None] = field(default_factory=dict)
    passed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    differences: list[dict[str, Any]] = field(default_factory=list)

    def check(self, identifier: str, ok: bool, detail: str = "") -> None:
        """Record one check, printing only the failures."""
        if ok:
            self.passed.append(identifier)
        else:
            self.failed.append(identifier)
            log(f"    FAIL  {identifier}  {detail}")


def check_inventory(client: Any, run: Run, expectations: dict[str, Any]) -> None:
    """Ask the engine what it actually built, and compare it with the repository."""
    log("")
    log("  Reading the deployed model's own inventory ...")
    check_tables(client, run, expectations)
    check_measures(client, run, expectations)
    check_relationships(client, run, expectations)


def check_row_counts(client: Any, run: Run, expectations: dict[str, Any]) -> None:
    """Prove every imported table refreshed to the row count the profile produces."""
    log("")
    log("  Counting loaded rows ...")
    for table, expected_rows in expectations["expected_row_counts"].items():
        query = f"EVALUATE ROW ( \"n\", COUNTROWS ( '{table}' ) )"
        try:
            row = scalar_row(execute_dax(client, run.workspace_id, run.item_id, query))
            value = next(iter(row.values()))
            actual_rows = 0 if value is None else int(value)
        except (ApiError, RuntimeError, StopIteration, TypeError, ValueError) as error:
            run.check(f"rows:{table}", False, f"could not be counted: {error}")
            continue
        run.row_counts[table] = actual_rows
        if actual_rows == 0:
            run.check(f"rows:{table}", False, "refreshed to zero rows")
        else:
            run.check(
                f"rows:{table}",
                actual_rows == expected_rows,
                f"expected {expected_rows} (development profile), loaded {actual_rows}",
            )


def reconcile(client: Any, run: Run, baseline: dict[str, Any], measure_map: dict[str, str]) -> None:
    """Run every generated context query and compare it with the SQL baseline."""
    log("")
    log("  Reconciling DAX against the SQL baseline ...")
    queries = read_context_queries(QUERIES_PATH)
    for context in baseline["contexts"]:
        context_id = context["context_id"]
        query = queries.get(context_id)
        if not query:
            run.check(f"sql-to-dax:{context_id}", False, "no DAX query was generated")
            continue
        try:
            row = scalar_row(execute_dax(client, run.workspace_id, run.item_id, query))
        except (ApiError, RuntimeError) as error:
            run.check(f"sql-to-dax:{context_id}", False, f"query failed: {error}")
            continue
        reconcile_context(run, context_id, context["measures"], row, measure_map)


def reconcile_context(
    run: Run,
    context_id: str,
    expected_measures: dict[str, Any],
    row: dict[str, Any],
    measure_map: dict[str, str],
) -> None:
    """Compare every measure of one filter context."""
    for key, expected_value in expected_measures.items():
        if key.startswith("_"):
            continue
        identifier = f"sql-to-dax:{context_id}:{key}"
        if key not in row:
            run.check(identifier, False, "the engine returned no column for this measure")
            continue
        ok, delta, reason = compare_value(expected_value, row[key], run.tolerance)
        if ok:
            run.passed.append(identifier)
            continue
        run.check(identifier, False, reason or f"SQL={expected_value} DAX={row[key]} delta={delta}")
        run.differences.append(
            {
                "context_id": context_id,
                "measure_key": key,
                "measure_name": measure_map.get(key),
                "sql_value": expected_value,
                "dax_value": row[key],
                "absolute_difference": delta,
                "tolerance": run.tolerance,
            }
        )


def capture_retrieved_definition_hash(client: Any, run: Run) -> None:
    """Re-read the deployed definition and hash it, so the evidence names both sides.

    ``deploy_powerbi_fabric.py`` already compares sent against retrieved and fails on any
    unexplained difference. Recording the retrieved hash HERE as well matters because
    deploy and validate can be separated by hours: this proves the thing that was
    validated is the thing that is still deployed, not merely the thing that was once
    uploaded.
    """
    try:
        url = (
            f"{FABRIC_API}/workspaces/{run.workspace_id}/semanticModels/{run.item_id}"
            "/getDefinition?format=TMDL"
        )
        status, headers, payload = client.request("POST", url, expected=(200, HTTP_ACCEPTED))
        if status == HTTP_ACCEPTED:
            payload = client.poll_operation(headers, what="get semantic model definition")
        parts = ((payload or {}).get("definition") or {}).get("parts") or []
        digest = hashlib.sha256()
        for part in sorted(parts, key=lambda item: str(item.get("path"))):
            path = str(part.get("path"))
            if path == ".platform":
                # Service-owned; excluded for the same reason the model source hash
                # excludes it. See check_desktop_validation_freshness.model_source_files.
                continue
            content = base64.b64decode(part.get("payload") or "")
            digest.update(path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(len(content)).encode("ascii"))
            digest.update(b"\0")
            digest.update(content)
            digest.update(b"\0")
        run.retrieved_definition_hash = digest.hexdigest()
        log(f"  retrieved definition hash: {run.retrieved_definition_hash}")
    except (ApiError, RuntimeError, ValueError) as error:
        log(f"    could not retrieve the deployed definition: {error}")
        run.check("definition:retrieved", False, str(error))


def do_refresh(client: Any, run: Run, *, skip: bool) -> bool:
    """Refresh the model. Returns False when nothing downstream can be trusted."""
    if skip:
        run.refresh_result = "not attempted"
        log("")
        log("  Refresh skipped at your request.")
        return True
    log("")
    log("  Refreshing (this takes minutes on a trial capacity) ...")
    trigger_refresh(client, run.workspace_id, run.item_id)
    outcome = poll_refresh(client, run.workspace_id, run.item_id)
    status = str(outcome.get("status", "Unknown"))
    run.refresh_result = "succeeded" if status == "Completed" else "failed"
    run.check("refresh", run.refresh_result == "succeeded", f"refresh finished as {status}")
    if run.refresh_result != "succeeded":
        log("")
        log(f"  Refresh detail: {json.dumps(redact(outcome))[:800]}")
        log("  Without a successful refresh nothing below can be trusted; stopping.")
        return False
    log("  Refresh completed.")
    return True


def write_results(run: Run) -> int:
    """Write the evidence file and return the process exit code."""
    overall = "passed" if not run.failed and run.passed else "failed"
    payload = {
        "schema": "arpi.fabric_validation_results/1",
        "validated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "operator": run.operator,
        "engine": "Microsoft Fabric",
        "workspace_id": run.workspace_id,
        "semantic_model_id": run.item_id,
        "model_source_hash": run.model_hash,
        "retrieved_definition_hash": run.retrieved_definition_hash,
        "refresh_result": run.refresh_result,
        "table_count": run.inventory.get("tables"),
        "imported_table_count": run.inventory.get("imported_tables"),
        "measure_table_count": run.inventory.get("measure_tables"),
        "relationship_count": run.inventory.get("relationships"),
        "active_relationship_count": run.inventory.get("active_relationships"),
        "measure_count": run.inventory.get("measures"),
        "row_counts": run.row_counts or None,
        "passed_checks": run.passed,
        "failed_checks": run.failed,
        "sql_to_dax_differences": run.differences,
        "overall_result": overall,
        "notes": (
            "Written by scripts/validate_powerbi_fabric.py against a live Microsoft Fabric "
            "semantic model. The model_source_hash is what makes this evidence falsifiable: "
            "edit the TMDL and CI reports the evidence as stale rather than as passed. No "
            "token, password or connection string is recorded here."
        ),
    }
    RESULTS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    log("")
    log(f"  passed: {len(run.passed)}   failed: {len(run.failed)}   result: {overall}")
    log(f"  wrote : {RESULTS_PATH.relative_to(REPO_ROOT)}")
    log("")
    if overall != "passed":
        log("  Fabric validation FAILED. Do not mark the pull request ready.")
        return 1
    log("  Fabric validation PASSED. Commit the evidence file to the pull request branch.")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Refresh, reconcile, and write falsifiable evidence."""
    args = build_parser().parse_args(argv)

    for required in (BASELINE_PATH, EXPECTATIONS_PATH, QUERIES_PATH):
        if not required.is_file():
            print(f"error: missing {required.relative_to(REPO_ROOT)}", file=sys.stderr)
            return 2

    run = Run(
        workspace_id=resolve_setting(
            args.workspace_id, "ARPI_FABRIC_WORKSPACE_ID", required=True, what="the workspace ID"
        )
        or "",
        item_id=resolve_setting(
            args.item_id, "ARPI_FABRIC_ITEM_ID", required=True, what="the semantic model ID"
        )
        or "",
        model_hash=freshness.compute_model_source_hash(freshness.model_source_files()),
        operator=resolve_setting(args.operator, "ARPI_FABRIC_OPERATOR"),
        tolerance=args.tolerance,
    )
    connection_id = resolve_setting(args.connection_id, "ARPI_FABRIC_CONNECTION_ID")
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    expectations = json.loads(EXPECTATIONS_PATH.read_text(encoding="utf-8"))
    client = client_from_args(args)

    log("ARPI semantic model validation -> Microsoft Fabric")
    log(f"  workspace  : {run.workspace_id}")
    log(f"  model      : {run.item_id}")
    log(f"  model hash : {run.model_hash}")

    try:
        if connection_id:
            log("")
            log("  Binding the PostgreSQL connection ...")
            bind_connection(client, run.workspace_id, run.item_id, connection_id)
        capture_retrieved_definition_hash(client, run)
        if do_refresh(client, run, skip=args.skip_refresh):
            check_inventory(client, run, expectations)
            check_row_counts(client, run, expectations)
            reconcile(client, run, baseline, expectations.get("measure_map", {}))
    except ApiError as error:
        print(f"\n{error}", file=sys.stderr)
        run.failed.append("api")
    except (RuntimeError, OSError) as error:
        print(f"\nerror: {error}", file=sys.stderr)
        run.failed.append("execution")

    return write_results(run)


if __name__ == "__main__":
    raise SystemExit(main())
