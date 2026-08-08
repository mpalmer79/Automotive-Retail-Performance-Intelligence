"""The dashboard exporter: one governed exit from PostgreSQL to the public data lane.

WHAT THIS IS AND IS NOT
-----------------------
It is a selection, a validation and a serialisation. It is **not** a second semantic layer.
Every number it writes was computed by an approved ``reporting`` view; this module chooses
approved fields, turns surrogate keys into business codes, keeps exact values exact, orders
rows deterministically, records provenance, and refuses to emit a best effort.

THE CONTROLS, AND WHY EACH ONE EXISTS
-------------------------------------
* **Reporter identity.** The connection ``SET ROLE``s into ``arpi_reporter`` before it
  reads anything. A grant that looks right and a query that actually succeeds under the
  console's own privilege are different facts, and only the second is evidence.
* **Allowlist, not discovery.** Every object reference in every generated query is checked
  against the contract's allowlist. A ``reporting`` view the contract does not name is
  unreadable even though the role could select it.
* **Refusal on a failing warehouse.** A failed pipeline run, or a run with failing
  reconciliations, cannot produce a "passing" export. The exporter stops.
* **Grain guard.** The exported row count must equal the source view's own row count. A
  key-resolution join that widened the grain fails here rather than doubling a total.
* **Prohibited-column tripwire.** ``arpi.validation.privacy`` runs over every exported
  header. The contract's allowlist is the primary control; the tripwire is the belt and
  braces that catches an allowlist someone extended carelessly.
* **No connection detail, ever.** Nothing this module writes carries a host, port,
  database name, user, password or absolute local path. A unit test asserts it over the
  produced bytes rather than trusting the intent.

MODES
-----
``generate`` needs PostgreSQL. ``check`` does not: it re-derives every hash, every row
count, every contract conformance and every size ceiling from the committed tree alone,
which is what lets an offline portfolio build depend on committed exports. ``check`` with
``against_database=True`` additionally re-exports and byte-compares, and is what the
integration suite runs.

DETERMINISM, PRECISELY STATED
-----------------------------
For a fixed database state, generate is byte-identical. ``run_uuid`` in the ``pipeline-run``
dataset is the one declared varying field: a rebuilt warehouse is a different execution and
says so. The manifest's ``generated_at`` varies by construction and is excluded from the
invariants ``check`` enforces, so a regeneration cannot fail a check for having happened at
a different moment.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

from arpi.constants import FICTIONAL_DEALER_GROUP, SYNTHETIC_DATA_NOTICE
from arpi.dashboard import contract as spec
from arpi.dashboard.serialization import (
    canonical_json_bytes,
    content_sha256,
    query_sha256,
    render_dataset_bytes,
    serialise_row,
)
from arpi.exceptions import ArpiError
from arpi.logging_config import get_logger
from arpi.validation.privacy import prohibited_columns

__all__ = [
    "DEFAULT_EXPORT_DIR",
    "SIZE_LIMITS",
    "VARYING_MANIFEST_FIELDS",
    "ExportError",
    "ExportResult",
    "assert_headers_are_privacy_safe",
    "assert_query_is_allowlisted",
    "check_export",
    "compute_reconciliation_totals",
    "generate_export",
    "iter_dataset_paths",
    "known_limitations",
]

_LOGGER = get_logger(__name__)

#: Where the committed export lives, relative to the repository root.
DEFAULT_EXPORT_DIR: Final = Path("data") / "dashboard"

#: How many row-level problems one dataset reports before the rest are suppressed.
#:
#: One broken column would otherwise produce thousands of identical lines and bury every
#: other finding in the run.
_MAX_ROW_PROBLEMS: Final = 5

#: The file-size ceilings from ``DATA_CONTRACT.md`` section 10, in bytes.
#:
#: Enforced with the MEASURED number in the failure message, so a breach is a fact rather
#: than an assertion. The chunk and deal-index ceilings belong to the portfolio transformer
#: and to the increments that own a deal dataset; only the two that apply to this stage are
#: enforced here.
#: MEASURED, NOT GUESSED. DATA_CONTRACT.md section 10 originally carried a provisional 2 MB
#: single-file ceiling written before anything had been exported. The development-profile
#: measurement put lead-response.json at 2,269,345 bytes: 4,099 rows of seventeen columns,
#: where the per-row JSON object repeats every column name. One record per line was chosen
#: over a columnar encoding because a reviewer has to be able to read a diff and see which
#: measure moved, and that readability costs roughly four bytes of key for every byte of
#: value. The ceiling is therefore set from the measurement with about 30% headroom, and the
#: directory total stays where it was because the measured total is an order of magnitude
#: inside it.
SIZE_LIMITS: Final[Mapping[str, int]] = {
    "single_export_file": 3 * 1024 * 1024,
    "total_export_directory": 20 * 1024 * 1024,
}


class ExportError(ArpiError):
    """Raised when the export cannot proceed or the committed tree is not current.

    Every message names the dataset and the contract that failed, because "the export
    failed" is not an actionable sentence.
    """


@dataclass(slots=True)
class DatasetOutput:
    """One serialised dataset, ready to be written or compared.

    Attributes:
        entry: The dataset's contract.
        records: The exported records, in sort order.
        payload: The exact bytes.
        query: The SQL that produced the records.
    """

    entry: spec.DatasetContract
    records: list[dict[str, Any]]
    payload: bytes
    query: str


@dataclass(slots=True)
class ExportResult:
    """The outcome of a generate or check run.

    Attributes:
        manifest: The manifest structure.
        files: File name to byte length, for every dataset plus the manifest.
        problems: Every problem found, in discovery order. Empty means success.
        wrote: File names actually written to disk.
    """

    manifest: dict[str, Any] = field(default_factory=dict)
    files: dict[str, int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)
    wrote: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """Whether the run found no problems."""
        return not self.problems

    @property
    def total_bytes(self) -> int:
        """Total size of every file the export comprises."""
        return sum(self.files.values())


# ---------------------------------------------------------------------------------------
# Known limitations, stated in the artifact itself
# ---------------------------------------------------------------------------------------


def known_limitations() -> tuple[str, ...]:
    """Return the limitations that travel with every export.

    An artifact that does not state its own boundaries invites a reader to assume it has
    none. Each entry here is a real constraint of this increment, not a disclaimer.

    Returns:
        The limitation statements, in the order the manifest carries them.
    """
    return (
        SYNTHETIC_DATA_NOTICE,
        f"{FICTIONAL_DEALER_GROUP} is a fictional dealer group. Every store, employee role and "
        "transaction in this export is machine generated.",
        "The export carries only the 29 governed KPIs implemented at DASH.1. Targets, itemized "
        "F&I products, finance reserve, inventory accounting and GL controls are not modelled "
        "yet and no dataset here stands in for them.",
        "Manufacturer incentives, holdback and floorplan credits are excluded from front gross, "
        "so new-vehicle front gross is understated by construction. That is a modelling "
        "boundary, not a finding.",
        "Ratios and rates are exported unrounded at the scale the reporting view produced. "
        "display_precision states how the console should render them; the export never "
        "discards the exact value.",
        "Median, percentile, days-supply and inventory-turn figures are not additive. No "
        "group-level total is published for them, because a group median is not the average of "
        "store medians. Their evidence is row-level equality with the source view.",
        "logical_run_key is null: ADR-0010's logical run key is recorded in the audit layer's "
        "pipeline-run table, the reporting layer does not publish it, and the exporter may not "
        "read that schema. It is left null rather than guessed.",
        "Power BI real-engine validation remains pending on both ADR-0008 paths. Nothing in "
        "this export validates the semantic model, and no artifact here may be cited as Gate 2 "
        "evidence.",
        "aged_threshold_days and the age-bucket boundaries are labelled project defaults, never "
        "industry benchmarks.",
    )


# ---------------------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------------------


def _git_commit(repo_root: Path) -> str:
    """Return the current commit, so an export can be traced to the tree that produced it.

    Args:
        repo_root: The repository root.

    Returns:
        The 40-character sha, or ``"unknown"`` where git is unavailable.
    """
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):  # pragma: no cover
        return "unknown"
    return completed.stdout.strip() or "unknown"


def _contract_fingerprint() -> str:
    """Return a digest of the whole declared contract.

    THIS, NOT A CLOCK, IS THE STALENESS SIGNAL. An export generated a month ago whose
    contract has not changed is current; an export generated a minute ago whose contract has
    changed is stale. The fingerprint covers every dataset's identity, grain, key, sort,
    filter and column declaration, so any change a consumer could care about moves it.

    Returns:
        A 64-character lowercase digest.
    """
    payload = {
        "schema": spec.SCHEMA_ID,
        "contract_version": spec.CONTRACT_VERSION,
        "query_normalisation": spec.QUERY_NORMALISATION,
        "source_views": list(spec.SOURCE_VIEW_ALLOWLIST),
        "datasets": [_dataset_declaration(entry) for entry in spec.DATASETS],
        "reconciliation_totals": [
            {
                "name": total.name,
                "dataset": total.dataset,
                "numerator": total.numerator,
                "denominator": total.denominator,
                "type": total.type,
                "kpi_id": total.kpi_id,
                "subset": [list(pair) for pair in total.subset],
            }
            for total in spec.RECONCILIATION_TOTALS
        ],
    }
    return content_sha256(canonical_json_bytes(payload))


def _dataset_declaration(entry: spec.DatasetContract) -> dict[str, Any]:
    """Render a dataset's contract as the manifest carries it.

    This is what makes the manifest the single authority a TypeScript consumer validates
    against: the column list is emitted, never restated by hand on the other side.

    Args:
        entry: The dataset contract.

    Returns:
        The declaration mapping.
    """
    return {
        "name": entry.name,
        "source_view": f"{spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view}",
        "join_views": [f"{spec.ALLOWED_SOURCE_SCHEMA}.{view}" for view in entry.join_views],
        "grain": entry.grain,
        "business_key": list(entry.business_key),
        "date_basis": entry.date_basis,
        "sort_keys": list(entry.sort_keys),
        "chunked": entry.chunked,
        "kpi_ids": list(entry.kpi_ids),
        "columns": [
            {
                "name": column.name,
                "type": column.type,
                "nullable": column.nullable,
                "class": column.classification,
                "unit": column.unit,
                "display_precision": column.display_precision,
                "enumeration": list(column.enumeration) if column.enumeration else None,
                "source_column": f"{spec.ALLOWED_SOURCE_SCHEMA}.{column.source_column}",
            }
            for column in entry.columns
        ],
        "notes": entry.notes,
    }


# ---------------------------------------------------------------------------------------
# Query safety
# ---------------------------------------------------------------------------------------


def assert_query_is_allowlisted(entry: spec.DatasetContract, sql: str) -> None:
    """Fail unless every object the query touches is an allowlisted ``reporting`` view.

    Checked against the query text that will actually run rather than against the
    declaration that was meant to produce it, so a hand-edited expression cannot smuggle in
    a warehouse table.

    Args:
        entry: The dataset being exported.
        sql: The generated query.

    Raises:
        ExportError: If the query names a non-``reporting`` schema or an unlisted view.
    """
    for reference in spec.referenced_views(sql):
        schema, _, obj = reference.partition(".")
        if schema != spec.ALLOWED_SOURCE_SCHEMA:
            raise ExportError(
                f"dataset {entry.name!r} would read {reference!r}. The dashboard exporter may "
                f"read the {spec.ALLOWED_SOURCE_SCHEMA} schema and nothing else: ADR-0013 "
                "condition 8 prohibits raw, staging, warehouse and audit access, directly or "
                "transitively.",
                dataset=entry.name,
                reference=reference,
            )
        if obj not in spec.SOURCE_VIEW_ALLOWLIST:
            permitted = ", ".join(spec.SOURCE_VIEW_ALLOWLIST)
            raise ExportError(
                f"dataset {entry.name!r} would read {reference!r}, which the contract does not "
                f"allowlist. Allowlist, not discovery: add it to DATA_CONTRACT.md section 3 and "
                f"to arpi.dashboard.contract in the same change, or do not read it. Permitted: "
                f"{permitted}.",
                dataset=entry.name,
                reference=reference,
            )


def assert_headers_are_privacy_safe(entry: spec.DatasetContract) -> None:
    """Fail unless every exported column name is free of personal data.

    The allowlist is the primary control: a column reaches an export only by being declared.
    This is the second control, and it is the one that catches a careless extension of the
    first.

    Args:
        entry: The dataset being exported.

    Raises:
        ExportError: If any column name denotes personal data, or is classified as
            anything other than the one publicly eligible class.
    """
    offending = prohibited_columns(entry.column_names)
    if offending:
        raise ExportError(
            f"dataset {entry.name!r} declares prohibited personal-data column(s): "
            f"{', '.join(offending)}. ARPI holds no personal data and the public export lane "
            "must not be the place one appears.",
            dataset=entry.name,
            columns=list(offending),
        )
    misclassified = [
        column.name
        for column in entry.columns
        if column.classification != spec.PUBLIC_CLASSIFICATION
    ]
    if misclassified:
        raise ExportError(
            f"dataset {entry.name!r} declares column(s) {', '.join(misclassified)} outside the "
            f"only publicly eligible classification ({spec.PUBLIC_CLASSIFICATION}).",
            dataset=entry.name,
            columns=misclassified,
        )


# ---------------------------------------------------------------------------------------
# Reading the database
# ---------------------------------------------------------------------------------------


def _enter_reporter_role(cursor: Any) -> str:
    """``SET ROLE`` into ``arpi_reporter`` and confirm it took effect.

    ``arpi_reporter`` is a NOLOGIN group role by design, so the exporter connects as a login
    role and drops into the reporter's privilege for the duration. Confirming the role
    afterwards is the difference between intending the boundary and having it.

    Args:
        cursor: An open cursor.

    Returns:
        The effective role name.

    Raises:
        ExportError: If the role cannot be entered.
    """
    try:
        cursor.execute(f"SET ROLE {spec.REPORTER_ROLE}")
        cursor.execute("SELECT current_role")
        effective = str(cursor.fetchone()[0])
    except Exception as error:
        raise ExportError(
            f"could not SET ROLE {spec.REPORTER_ROLE}: {error}. The export runs inside the "
            "console's own privilege boundary; reading the reporting layer with more privilege "
            "than the console has would make ADR-0013 condition 10 unverifiable. Grant the "
            "connecting login role membership of "
            f"{spec.REPORTER_ROLE} (sql/07_security/00_roles.sql).",
            role=spec.REPORTER_ROLE,
        ) from error
    if effective != spec.REPORTER_ROLE:
        raise ExportError(
            f"SET ROLE {spec.REPORTER_ROLE} reported an effective role of {effective!r}.",
            role=effective,
        )
    return effective


def _run_context(cursor: Any) -> dict[str, Any]:
    """Read the pipeline run and reconciliation state the export must be honest about.

    Args:
        cursor: A cursor already inside the reporter role.

    Returns:
        The run context: profile, seed, status, run uuid and validation counts.

    Raises:
        ExportError: If no run exists, the run did not succeed, or reconciliations report
            failures. A failing warehouse cannot produce a passing export
            (DATA_CONTRACT.md section 11).
    """
    cursor.execute(
        "SELECT run_uuid, profile_name, random_seed, run_status, reconciliation_status, "
        "reconciliation_count, reconciliation_failed_count, validation_check_count, "
        "critical_failed_check_count, reported_warning_count "
        "FROM reporting.vw_pipeline_run_summary "
        "ORDER BY pipeline_run_id DESC LIMIT 1"
    )
    row = cursor.fetchone()
    if row is None:
        raise ExportError(
            "reporting.vw_pipeline_run_summary is empty: no pipeline run has loaded this "
            "database, so there is nothing to export. Run `arpi run-foundation "
            "--load-database` first."
        )
    (
        run_uuid,
        profile,
        seed,
        run_status,
        reconciliation_status,
        reconciliations,
        reconciliations_failed,
        checks,
        critical_failures,
        warnings,
    ) = row

    if run_status != "succeeded":
        raise ExportError(
            f"the most recent pipeline run is {run_status!r}, not 'succeeded'. An export taken "
            "from a failed run would carry a passing manifest over data the warehouse itself "
            "does not vouch for.",
            run_status=str(run_status),
        )
    if int(reconciliations_failed) > 0 or reconciliation_status != "passed":
        raise ExportError(
            f"{reconciliations_failed} of {reconciliations} reconciliations failed "
            f"(status {reconciliation_status!r}). The export refuses to publish reconciled "
            "totals over a warehouse whose own reconciliations do not pass.",
            reconciliations_failed=int(reconciliations_failed),
        )
    if int(critical_failures) > 0:
        raise ExportError(
            f"the pipeline run recorded {critical_failures} critical data-quality failure(s).",
            critical_failures=int(critical_failures),
        )

    return {
        "run_uuid": str(run_uuid),
        "profile": str(profile),
        "random_seed": int(seed),
        "run_status": str(run_status),
        "reconciliations": int(reconciliations),
        "reconciliations_failed": int(reconciliations_failed),
        "validation_checks": int(checks),
        "critical_failures": int(critical_failures),
        "warnings": int(warnings),
    }


def _read_dataset(cursor: Any, entry: spec.DatasetContract) -> DatasetOutput:
    """Read, validate and serialise one dataset.

    Args:
        cursor: A cursor already inside the reporter role.
        entry: The dataset contract.

    Returns:
        The serialised dataset.

    Raises:
        ExportError: If the query is not allowlisted, a header is prohibited, the source
            view's schema has drifted, the grain widened, or a business key repeats.
        ContractViolationError: If any value violates its column contract.
    """
    assert_headers_are_privacy_safe(entry)
    sql = spec.dataset_sql(entry)
    assert_query_is_allowlisted(entry, sql)

    _assert_view_schema(cursor, entry)

    cursor.execute(sql)
    rows = cursor.fetchall()
    records = [serialise_row(entry, row) for row in rows]

    _assert_grain_preserved(cursor, entry, len(records))
    _assert_business_key_unique(entry, records)
    _assert_row_identities(entry, records)

    return DatasetOutput(
        entry=entry, records=records, payload=render_dataset_bytes(records), query=sql
    )


def _assert_view_schema(cursor: Any, entry: spec.DatasetContract) -> None:
    """Fail unless the source view still declares every column the contract reads.

    A view that lost a column, or gained one the contract does not know about, is schema
    drift. Losing one is fatal. Gaining one is reported as fatal too: an unreviewed column
    in an approved view is exactly the situation the allowlist exists to make visible.

    Args:
        cursor: A cursor already inside the reporter role.
        entry: The dataset contract.

    Raises:
        ExportError: On any drift between the view and the contract.
    """
    cursor.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s",
        (spec.ALLOWED_SOURCE_SCHEMA, entry.source_view),
    )
    present = {str(name) for (name,) in cursor.fetchall()}
    if not present:
        raise ExportError(
            f"dataset {entry.name!r} names source view "
            f"{spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view}, which does not exist or is not "
            f"visible to {spec.REPORTER_ROLE}.",
            dataset=entry.name,
            source_view=entry.source_view,
        )
    required = {
        column.source_column.split(".", 1)[1]
        for column in entry.columns
        if column.source_column.startswith(f"{entry.source_view}.")
    }
    missing = sorted(required - present)
    if missing:
        raise ExportError(
            f"dataset {entry.name!r} requires column(s) {', '.join(missing)} from "
            f"{spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view}, which no longer declares them. "
            "Reconcile the view and arpi.dashboard.contract before exporting.",
            dataset=entry.name,
            missing=missing,
        )


def _assert_grain_preserved(cursor: Any, entry: spec.DatasetContract, exported: int) -> None:
    """Fail unless the export produced exactly as many rows as the source view holds.

    This is the guard that makes key resolution safe. A dimension join is a lookup on a
    unique key, so it cannot change the row count; if the count moved, the join fanned out
    and every total downstream would be wrong.

    Args:
        cursor: A cursor already inside the reporter role.
        entry: The dataset contract.
        exported: The number of rows exported.

    Raises:
        ExportError: If the counts disagree.
    """
    statement = f"SELECT count(*) FROM {spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view} AS base"
    if entry.where is not None:
        statement += f" WHERE {entry.where}"
    cursor.execute(statement)
    source = int(cursor.fetchone()[0])
    if source != exported:
        raise ExportError(
            f"dataset {entry.name!r} exported {exported} row(s) but "
            f"{spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view} holds {source}. A key-resolution "
            "join must not change the grain; this one did.",
            dataset=entry.name,
            exported=exported,
            source=source,
        )


def _assert_business_key_unique(
    entry: spec.DatasetContract, records: Sequence[Mapping[str, Any]]
) -> None:
    """Fail unless the declared business key identifies each row exactly once.

    Args:
        entry: The dataset contract.
        records: The exported records.

    Raises:
        ExportError: If a key tuple repeats.
    """
    seen: set[tuple[Any, ...]] = set()
    for record in records:
        key = tuple(record[name] for name in entry.business_key)
        if key in seen:
            rendered = ", ".join(f"{n}={v!r}" for n, v in zip(entry.business_key, key, strict=True))
            raise ExportError(
                f"dataset {entry.name!r} repeats its business key ({rendered}). The declared "
                f"grain is: {entry.grain}",
                dataset=entry.name,
            )
        seen.add(key)


def _assert_row_identities(
    entry: spec.DatasetContract, records: Sequence[Mapping[str, Any]]
) -> None:
    """Assert the row-level identities the reporting layer guarantees.

    Two identities are checkable from the exported values alone, and both are cheap:
    ``new + used = retail`` on sales (RECON-UNITS-001) and ``front + back = total`` on gross
    (RECON-GROSS-001). Checking them here means the export cannot be internally
    contradictory even if a view changed underneath it.

    Args:
        entry: The dataset contract.
        records: The exported records.

    Raises:
        ExportError: If an identity does not hold on some row.
    """
    if entry.name == "sales-summary":
        for record in records:
            if record["new_units_sold"] + record["used_units_sold"] != record["retail_units_sold"]:
                raise ExportError(
                    f"sales-summary row {record['dealership_id']} {record['sale_date']} breaks "
                    "the RECON-UNITS-001 identity: new + used does not equal retail units.",
                    dataset=entry.name,
                )
    if entry.name == "gross-summary":
        for record in records:
            front = Decimal(str(record["front_end_gross"]))
            back = Decimal(str(record["back_end_gross"]))
            total = Decimal(str(record["total_gross"]))
            if front + back != total:
                raise ExportError(
                    f"gross-summary row {record['dealership_id']} {record['sale_date']} breaks "
                    f"the RECON-GROSS-001 identity: {front} + {back} != {total}.",
                    dataset=entry.name,
                )


# ---------------------------------------------------------------------------------------
# Reconciliation totals
# ---------------------------------------------------------------------------------------


def compute_reconciliation_totals(
    outputs: Mapping[str, DatasetOutput],
) -> dict[str, dict[str, Any]]:
    """Compute every group-level total from the exported records.

    Sums are exact: values are summed as ``Decimal`` parsed back from the exported strings,
    so a total is arithmetic over exactly the bytes the console will read, not over some
    intermediate this process held in memory.

    NO QUOTIENT IS PUBLISHED. A ratio total carries its numerator sum and its denominator
    sum and stops there. Three reasons, any one of which would be sufficient:

    * The reporting layer's own rule 7 says a ratio publishes numerator and denominator as
      separate additive columns and the consumer divides. A quotient here would be a number
      computed outside SQL, which is what ADR-0013 condition 2 forbids.
    * Summing store ratios is the classic wrong answer. Publishing the components makes the
      right answer the only available one: an average of averages cannot be formed from this
      block at all.
    * A quotient would have to be reproduced exactly by a TypeScript consumer to be
      checkable. Python's ``Decimal`` division and PostgreSQL's ``numeric`` division already
      disagree about how many digits to keep; a third opinion in JavaScript would turn the
      cross-layer check into a comparison of rounding conventions rather than of data.

    A zero denominator is therefore reported as the zero it is, and the consumer renders the
    undefined ratio as "no data" rather than as a number.

    Args:
        outputs: The serialised datasets, keyed by name.

    Returns:
        A mapping of total name to its components and provenance.
    """
    totals: dict[str, dict[str, Any]] = {}
    for total in spec.RECONCILIATION_TOTALS:
        records = _subset_records(outputs[total.dataset].records, total.subset)
        numerator = _sum_column(records, total.numerator)
        entry: dict[str, Any] = {
            "dataset": total.dataset,
            "kpi_id": total.kpi_id,
            "unit": total.unit,
            "display_precision": total.display_precision,
        }
        if total.subset:
            # Emitted so a consumer re-deriving the total filters the same rows rather
            # than guessing which ones the exporter meant.
            entry["subset"] = dict(total.subset)
        if total.denominator is None:
            entry["column"] = total.numerator
            entry["total"] = _format_total(numerator, total.type)
        else:
            entry["numerator_column"] = total.numerator
            entry["denominator_column"] = total.denominator
            entry["numerator"] = _format_total(numerator, total.type)
            entry["denominator"] = format(_sum_column(records, total.denominator), "f")
        totals[total.name] = entry
    return totals


def _subset_records(
    records: Sequence[Mapping[str, Any]], subset: Sequence[tuple[str, str]]
) -> Sequence[Mapping[str, Any]]:
    """Restrict records to a declared subset, ANDing every column/value pair.

    A total over a dataset that mixes measures -- ``target-attainment`` carries unit
    targets and currency targets in one column, and store plans beside department
    refinements of them -- would otherwise add units to dollars and count the same gross
    twice. The subset is part of the contract declaration and therefore part of the
    contract fingerprint, so it cannot change without moving the hash.

    Args:
        records: The exported records.
        subset: Column/value pairs, ANDed. Empty means the whole dataset.

    Returns:
        The matching records, in their original order.
    """
    if not subset:
        return records
    return [
        record for record in records if all(record[column] == value for column, value in subset)
    ]


def _sum_column(records: Sequence[Mapping[str, Any]], column: str) -> Decimal:
    """Sum one column exactly, treating null as absent rather than as zero.

    Args:
        records: The exported records.
        column: The column to sum.

    Returns:
        The exact sum. A column with no non-null value sums to zero, which is the correct
        total of an empty set -- distinct from a ratio over an empty denominator, which is
        undefined and reported as ``None`` by the caller.
    """
    total = Decimal(0)
    for record in records:
        value = record[column]
        if value is None:
            continue
        total += Decimal(str(value))
    return total


def _format_total(value: Decimal, type_: str) -> str:
    """Render a total in the representation its type declares.

    Args:
        value: The exact sum.
        type_: ``currency``, ``exact`` or ``integer``.

    Returns:
        The rendered total. Integers render without a decimal point; currency renders at two
        places; an exact value renders at whatever scale it holds.
    """
    if type_ == "integer":
        return format(value.to_integral_value(), "f")
    if type_ == "currency":
        return format(value.quantize(Decimal("0.01")), "f")
    return format(value, "f")


# ---------------------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------------------


def _build_manifest(
    *,
    outputs: Sequence[DatasetOutput],
    run: Mapping[str, Any],
    generated_at: str,
    dataset_version: int,
    source_commit: str,
    as_of_date: str,
) -> dict[str, Any]:
    """Assemble the manifest.

    Args:
        outputs: The serialised datasets, in export order.
        run: The pipeline-run context.
        generated_at: ISO-8601 UTC generation timestamp.
        dataset_version: The monotonic dataset version.
        source_commit: The git sha the export was taken at.
        as_of_date: The latest fact date in the export.

    Returns:
        The manifest structure, ready for canonical serialisation.
    """
    by_name = {output.entry.name: output for output in outputs}
    totals = compute_reconciliation_totals(by_name)
    columns_scanned = sum(len(output.entry.columns) for output in outputs)
    largest = max(outputs, key=lambda output: len(output.payload))

    datasets: list[dict[str, Any]] = []
    for output in outputs:
        declaration = _dataset_declaration(output.entry)
        declaration.update(
            {
                "query_sha256": query_sha256(output.query),
                "row_count": len(output.records),
                "file": output.entry.file_name,
                "file_sha256": content_sha256(output.payload),
                "file_bytes": len(output.payload),
            }
        )
        datasets.append(declaration)

    return {
        "schema": spec.SCHEMA_ID,
        "contract_version": spec.CONTRACT_VERSION,
        "contract_sha256": _contract_fingerprint(),
        "dataset_version": dataset_version,
        "generated_at": generated_at,
        "as_of_date": as_of_date,
        "profile": run["profile"],
        "random_seed": run["random_seed"],
        "source_commit": source_commit,
        "exporter_version": spec.EXPORTER_VERSION,
        "query_normalisation": spec.QUERY_NORMALISATION,
        "reporter_role": spec.REPORTER_ROLE,
        "synthetic_data": True,
        "fictional_dealer_group": True,
        "pipeline_run": {
            "run_uuid": run["run_uuid"],
            # ADR-0010's logical run key is recorded in the audit layer, which the reporting
            # layer does not publish and the exporter may not read. Null here rather than
            # guessed; also stated in known_limitations().
            "logical_run_key": None,
            "status": run["run_status"],
        },
        "source_views": [
            f"{spec.ALLOWED_SOURCE_SCHEMA}.{view}" for view in spec.SOURCE_VIEW_ALLOWLIST
        ],
        "datasets": datasets,
        "reconciliation": {
            "status": "passed",
            "method": (
                "Every total is an exact sum over an additive exported column. A ratio "
                "publishes its numerator sum and its denominator sum and no quotient: the "
                "reporting layer's rule 7 puts division in the consumer, which is also what "
                "makes an average of store averages impossible to form from this block and "
                "what lets a consumer in any language reproduce the figure without first "
                "agreeing on a rounding convention. Non-additive figures -- medians, "
                "percentiles, days supply, inventory turn -- carry no group total by design, "
                "because a group median is not the average of store medians; their evidence "
                "is row-level equality with the source view, asserted by "
                "tests/integration/test_dashboard_export.py."
            ),
            "totals": totals,
        },
        "privacy_scan": {
            "status": "passed",
            "prohibited_hits": 0,
            "columns_scanned": columns_scanned,
            "primary_control": "contract allowlist",
            "secondary_control": "arpi.validation.privacy prohibited-name tripwire",
        },
        "validation": {
            "critical_failures": run["critical_failures"],
            "warnings": run["warnings"],
            "checks_evaluated": run["validation_checks"],
            "reconciliations_evaluated": run["reconciliations"],
            "reconciliations_failed": run["reconciliations_failed"],
        },
        "sizes": {
            "dataset_bytes_total": sum(len(output.payload) for output in outputs),
            "largest_dataset": {
                "name": largest.entry.name,
                "bytes": len(largest.payload),
                "rows": len(largest.records),
            },
            "limits": dict(SIZE_LIMITS),
        },
        "stale": False,
        "limitations": list(known_limitations()),
    }


#: Manifest fields that vary between two generations of identical data.
#:
#: ``check`` ignores these when comparing a regenerated manifest with the committed one, so
#: a regeneration cannot fail for having happened at a different moment or on a different
#: checkout. Everything else is a function of the data and the contract.
VARYING_MANIFEST_FIELDS: Final[frozenset[str]] = frozenset(
    {"generated_at", "source_commit", "dataset_version"}
)


# ---------------------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------------------


def generate_export(
    connection: Any,
    *,
    output_dir: Path,
    repo_root: Path,
    generated_at: str | None = None,
    write: bool = True,
) -> ExportResult:
    """Export every contracted dataset and its manifest.

    Args:
        connection: An open PostgreSQL connection. The exporter enters
            ``arpi_reporter`` on it and does not commit.
        output_dir: Directory the artifacts are written to.
        repo_root: Repository root, for the provenance commit.
        generated_at: Override the generation timestamp. Supplied by tests so a double
            export is byte-identical; production leaves it unset.
        write: When false, everything is computed and validated but nothing is written.

    Returns:
        The export result, including the manifest and every file's size.

    Raises:
        ExportError: On any control failure.
        ContractViolationError: On any value that cannot cross the boundary.
    """
    with connection.cursor() as cursor:
        _enter_reporter_role(cursor)
        run = _run_context(cursor)
        outputs = [_read_dataset(cursor, entry) for entry in spec.DATASETS]
        as_of_date = _as_of_date(cursor)

    result = ExportResult()
    previous = _read_committed_manifest(output_dir)
    manifest = _build_manifest(
        outputs=outputs,
        run=run,
        generated_at=generated_at or datetime.now(UTC).replace(microsecond=0).isoformat(),
        dataset_version=_next_dataset_version(previous, outputs),
        source_commit=_git_commit(repo_root),
        as_of_date=as_of_date,
    )
    manifest_bytes = canonical_json_bytes(manifest)

    for output in outputs:
        result.files[output.entry.file_name] = len(output.payload)
    result.files[spec.MANIFEST_FILE_NAME] = len(manifest_bytes)
    result.manifest = manifest
    result.problems.extend(_size_problems(result.files))
    result.problems.extend(_secret_problems(outputs, manifest_bytes))

    if result.problems or not write:
        return result

    output_dir.mkdir(parents=True, exist_ok=True)
    _write_bytes(output_dir / spec.MANIFEST_FILE_NAME, manifest_bytes)
    result.wrote.append(spec.MANIFEST_FILE_NAME)
    for output in outputs:
        _write_bytes(output_dir / output.entry.file_name, output.payload)
        result.wrote.append(output.entry.file_name)
    _remove_unexpected_files(output_dir, result)
    return result


def _as_of_date(cursor: Any) -> str:
    """Return the latest fact date the export covers.

    Taken as the maximum over the three date-grained fact bases the datasets carry -- sale,
    snapshot and lead-creation -- so "as of" means the last day any measured thing happened,
    not merely the last day the calendar has a row for.

    Args:
        cursor: A cursor already inside the reporter role.

    Returns:
        An ISO date string.
    """
    cursor.execute(
        "SELECT max(c.calendar_date) FROM reporting.vw_calendar AS c "
        "WHERE c.date_key IN ("
        "  SELECT sale_date_key FROM reporting.vw_sales_summary"
        "  UNION ALL SELECT snapshot_date_key FROM reporting.vw_inventory_health"
        "  UNION ALL SELECT lead_created_date_key FROM reporting.vw_lead_funnel)"
    )
    value = cursor.fetchone()[0]
    if value is None:  # pragma: no cover - _run_context already refused an empty warehouse
        raise ExportError("the reporting layer holds no dated facts, so there is no as-of date.")
    return str(value)


def _next_dataset_version(
    previous: Mapping[str, Any] | None, outputs: Sequence[DatasetOutput]
) -> int:
    """Return the dataset version this export should carry.

    Monotonic and content-addressed: it holds steady when the bytes are unchanged and
    increments by one when any dataset's content or the contract moves. A clock plays no
    part, so regenerating an unchanged export does not manufacture a new version.

    Args:
        previous: The committed manifest, or ``None`` on a first export.
        outputs: The serialised datasets.

    Returns:
        The dataset version.
    """
    if previous is None:
        return 1
    current = int(previous.get("dataset_version", 0)) or 1
    if previous.get("contract_sha256") != _contract_fingerprint():
        return current + 1
    committed = {
        str(entry.get("name")): str(entry.get("file_sha256"))
        for entry in previous.get("datasets", [])
        if isinstance(entry, Mapping)
    }
    fresh = {output.entry.name: content_sha256(output.payload) for output in outputs}
    return current if committed == fresh else current + 1


def _read_committed_manifest(output_dir: Path) -> dict[str, Any] | None:
    """Read the committed manifest, or ``None`` when there is not one yet.

    Args:
        output_dir: The export directory.

    Returns:
        The parsed manifest, or ``None`` if absent or unparseable. An unparseable manifest
        is treated as absent here and reported as a failure by ``check``; generate must be
        able to repair a corrupted tree.
    """
    path = output_dir / spec.MANIFEST_FILE_NAME
    if not path.is_file():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _write_bytes(path: Path, payload: bytes) -> None:
    """Write bytes with LF endings preserved on every platform.

    Args:
        path: Destination.
        payload: Exact bytes.
    """
    path.write_bytes(payload)


def _remove_unexpected_files(output_dir: Path, result: ExportResult) -> None:
    """Delete files the contract no longer declares, so the tree is a closed set.

    A dataset that was renamed leaves its old file behind, and a stale artifact that nothing
    validates is exactly the sort of thing a reader later mistakes for current data.

    Args:
        output_dir: The export directory.
        result: The result, extended with a note for each removal.
    """
    expected = set(result.files)
    for path in sorted(output_dir.glob("*.json")):
        if path.name not in expected:
            path.unlink()
            result.wrote.append(f"-{path.name}")


# ---------------------------------------------------------------------------------------
# Size and secret guards
# ---------------------------------------------------------------------------------------


def _size_problems(files: Mapping[str, int]) -> list[str]:
    """Return a problem for every measured size that breaches a ceiling.

    Args:
        files: File name to byte length.

    Returns:
        Problem messages carrying the measured number.
    """
    problems: list[str] = []
    single = SIZE_LIMITS["single_export_file"]
    for name, size in sorted(files.items()):
        if size > single:
            problems.append(
                f"{name} is {size} bytes, which exceeds the {single}-byte ceiling for a single "
                "committed export file (DATA_CONTRACT.md section 10)."
            )
    total = sum(files.values())
    ceiling = SIZE_LIMITS["total_export_directory"]
    if total > ceiling:
        problems.append(
            f"the export totals {total} bytes, which exceeds the {ceiling}-byte ceiling for "
            "data/dashboard/ (DATA_CONTRACT.md section 10)."
        )
    return problems


#: Substrings that must never appear in anything the exporter writes.
#:
#: Applied to the produced bytes rather than to individual fields, so a value that reached
#: the output through a field nobody thought to check is still caught. Every entry names
#: something that would be connection detail or an internal object path.
_FORBIDDEN_IN_OUTPUT: Final[tuple[tuple[str, str], ...]] = (
    ("password", "a credential field name"),
    ("postgresql://", "a connection string"),
    ("postgres://", "a connection string"),
    ("sslmode", "a connection parameter"),
    ("PGPASSWORD", "a credential environment variable"),
    ("ARPI_DATABASE__", "a database configuration environment variable"),
    ("raw.", "a raw-schema object reference"),
    ("staging.", "a staging-schema object reference"),
    ("warehouse.", "a warehouse-schema object reference"),
    ("audit.", "an audit-schema object reference"),
)


def _secret_problems(outputs: Sequence[DatasetOutput], manifest_bytes: bytes) -> list[str]:
    """Return a problem for any connection detail or internal path in the output.

    ``raw.``/``staging.``/``warehouse.``/``audit.`` are included because the generated
    artifacts travel into ``portfolio/src/generated/``, where the ADR-0013 condition 8
    boundary test forbids those strings outright. Catching them here means the exporter
    fails rather than the frontend build.

    Args:
        outputs: The serialised datasets.
        manifest_bytes: The manifest's exact bytes.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    payloads = [(output.entry.file_name, output.payload) for output in outputs]
    payloads.append((spec.MANIFEST_FILE_NAME, manifest_bytes))
    for name, payload in payloads:
        text = payload.decode("utf-8")
        for needle, what in _FORBIDDEN_IN_OUTPUT:
            if needle in text:
                problems.append(
                    f"{name} contains {needle!r}, which reads as {what}. The public export lane "
                    "carries business data and provenance only: no credential, no host, no "
                    "port, no database name, and no reference to a schema the console may not "
                    "see."
                )
    return problems


# ---------------------------------------------------------------------------------------
# Check
# ---------------------------------------------------------------------------------------


def check_export(
    *,
    output_dir: Path,
    connection: Any | None = None,
) -> ExportResult:
    """Verify the committed export without needing a database.

    What is checked offline: the manifest parses and declares the expected schema and
    contract fingerprint; the file set is exactly the contract's closed set; every file's
    hash matches its manifest entry; every query hash matches the contract-built SQL; every
    row conforms to its column declaration; business keys are unique; row counts agree with
    the manifest; reconciliation totals re-derive from the committed rows; every header
    passes the privacy tripwire; every measured size is inside its ceiling; and no output
    carries connection detail.

    What needs a database, and is only checked when ``connection`` is supplied: that the
    committed bytes still equal a fresh export.

    Args:
        output_dir: The export directory to verify.
        connection: An open connection, to additionally byte-compare against a fresh export.

    Returns:
        The result. ``problems`` is empty exactly when the tree is current.
    """
    result = ExportResult()
    manifest_path = output_dir / spec.MANIFEST_FILE_NAME
    if not manifest_path.is_file():
        result.problems.append(
            f"{manifest_path} is missing. Run `python scripts/export_dashboard_dataset.py` "
            "against a loaded warehouse and commit the result."
        )
        return result

    manifest_bytes = manifest_path.read_bytes()
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except ValueError as error:
        result.problems.append(f"{manifest_path} is not valid JSON: {error}")
        return result
    if not isinstance(manifest, dict):
        result.problems.append(f"{manifest_path} does not contain a JSON object.")
        return result

    result.manifest = manifest
    result.files[spec.MANIFEST_FILE_NAME] = len(manifest_bytes)
    result.problems.extend(_check_manifest_envelope(manifest))
    result.problems.extend(_check_file_set(output_dir, manifest))

    outputs = _reload_outputs(output_dir, manifest, result)
    if outputs is not None:
        result.problems.extend(_check_totals(manifest, outputs))
        result.problems.extend(_secret_problems(outputs, manifest_bytes))
    result.problems.extend(_size_problems(result.files))

    if connection is not None:
        result.problems.extend(_check_against_database(connection, output_dir, manifest))
    return result


def _check_manifest_envelope(manifest: Mapping[str, Any]) -> list[str]:
    """Verify the manifest's identity, versioning and required blocks.

    Args:
        manifest: The committed manifest.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    if manifest.get("schema") != spec.SCHEMA_ID:
        problems.append(
            f"the manifest declares schema {manifest.get('schema')!r}, but this exporter writes "
            f"{spec.SCHEMA_ID!r}. A consumer refuses an unknown major version rather than "
            "guessing at a shape."
        )
    if manifest.get("contract_version") != spec.CONTRACT_VERSION:
        problems.append(
            f"the manifest declares contract_version {manifest.get('contract_version')!r}, but "
            f"the contract is at version {spec.CONTRACT_VERSION}."
        )
    fingerprint = _contract_fingerprint()
    if manifest.get("contract_sha256") != fingerprint:
        problems.append(
            "the committed export was produced by a different contract "
            f"(manifest contract_sha256 {manifest.get('contract_sha256')!r}, current "
            f"{fingerprint!r}). THIS IS THE STALENESS SIGNAL: the declared datasets, grains, "
            "keys, sorts, filters or columns have changed, so the committed artifacts no longer "
            "describe what the exporter would produce. Regenerate against a loaded warehouse."
        )
    if manifest.get("query_normalisation") != spec.QUERY_NORMALISATION:
        problems.append(
            f"the manifest declares query normalisation {manifest.get('query_normalisation')!r}, "
            f"but this exporter uses {spec.QUERY_NORMALISATION!r}, so its query hashes are not "
            "comparable."
        )
    version = manifest.get("dataset_version")
    if not isinstance(version, int) or version < 1:
        problems.append(
            f"dataset_version is {version!r}; it must be a positive integer that increments on "
            "every regeneration that changes bytes."
        )
    if manifest.get("stale") is not False:
        problems.append(
            "the manifest declares stale=true. CI never lets a stale export merge; regenerate it."
        )
    if manifest.get("synthetic_data") is not True:
        problems.append("the manifest must declare synthetic_data=true.")
    if manifest.get("fictional_dealer_group") is not True:
        problems.append("the manifest must declare fictional_dealer_group=true.")
    if manifest.get("reporter_role") != spec.REPORTER_ROLE:
        problems.append(
            f"the manifest must record the {spec.REPORTER_ROLE!r} privilege boundary the export "
            "ran inside."
        )
    if not manifest.get("limitations"):
        problems.append(
            "the manifest carries no limitations. An artifact that does not state its own "
            "boundaries invites a reader to assume it has none."
        )
    problems.extend(_check_manifest_status_blocks(manifest))
    return problems


def _check_manifest_status_blocks(manifest: Mapping[str, Any]) -> list[str]:
    """Verify the reconciliation, privacy and validation status blocks.

    Args:
        manifest: The committed manifest.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    reconciliation = manifest.get("reconciliation")
    if not isinstance(reconciliation, Mapping) or reconciliation.get("status") != "passed":
        problems.append("the manifest's reconciliation block is missing or does not report passed.")
    privacy = manifest.get("privacy_scan")
    if not isinstance(privacy, Mapping):
        problems.append("the manifest carries no privacy_scan block.")
    elif privacy.get("status") != "passed" or privacy.get("prohibited_hits") != 0:
        problems.append(
            f"the manifest's privacy scan reports status {privacy.get('status')!r} with "
            f"{privacy.get('prohibited_hits')!r} prohibited hit(s)."
        )
    validation = manifest.get("validation")
    if not isinstance(validation, Mapping):
        problems.append("the manifest carries no validation block.")
    elif validation.get("critical_failures") not in (0, None) and validation.get(
        "critical_failures"
    ):
        problems.append(
            f"the manifest records {validation.get('critical_failures')!r} critical validation "
            "failure(s); an export may not be taken from such a run."
        )
    run = manifest.get("pipeline_run")
    if not isinstance(run, Mapping) or not run.get("run_uuid"):
        problems.append("the manifest carries no pipeline-run identity.")
    elif run.get("status") != "succeeded":
        problems.append(
            f"the manifest records pipeline-run status {run.get('status')!r}, not 'succeeded'."
        )
    return problems


def _check_file_set(output_dir: Path, manifest: Mapping[str, Any]) -> list[str]:
    """Verify the export directory holds exactly the contract's closed set of files.

    Args:
        output_dir: The export directory.
        manifest: The committed manifest.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    declared = {entry.file_name for entry in spec.DATASETS} | {spec.MANIFEST_FILE_NAME}
    present = {path.name for path in output_dir.glob("*.json")}

    for name in sorted(declared - present):
        problems.append(
            f"{name} is missing from {output_dir}. The contract declares a closed set of files; "
            "a missing dataset fails the check rather than being treated as empty."
        )
    for name in sorted(present - declared):
        problems.append(
            f"{name} is present in {output_dir} but the contract does not declare it. A stale "
            "artifact nothing validates is exactly what a reader later mistakes for current data."
        )

    manifest_names = [
        entry.get("name") for entry in manifest.get("datasets", []) if isinstance(entry, Mapping)
    ]
    if manifest_names != list(spec.DATASET_NAMES):
        problems.append(
            f"the manifest lists datasets {manifest_names!r}; the contract declares "
            f"{list(spec.DATASET_NAMES)!r}, in that order."
        )
    return problems


def _reload_outputs(
    output_dir: Path, manifest: Mapping[str, Any], result: ExportResult
) -> list[DatasetOutput] | None:
    """Re-read every committed dataset and re-verify it against the contract and manifest.

    Args:
        output_dir: The export directory.
        manifest: The committed manifest.
        result: The result, extended with each file's size and any problem found.

    Returns:
        The reloaded datasets, or ``None`` when a file was unreadable and no further
        cross-checking is meaningful.
    """
    manifest_datasets = {
        str(entry.get("name")): entry
        for entry in manifest.get("datasets", [])
        if isinstance(entry, Mapping)
    }
    outputs: list[DatasetOutput] = []
    fatal = False

    for entry in spec.DATASETS:
        path = output_dir / entry.file_name
        if not path.is_file():
            fatal = True
            continue
        payload = path.read_bytes()
        result.files[entry.file_name] = len(payload)

        try:
            records = json.loads(payload.decode("utf-8"))
        except ValueError as error:
            result.problems.append(f"{entry.file_name} is not valid JSON: {error}")
            fatal = True
            continue
        if not isinstance(records, list):
            result.problems.append(f"{entry.file_name} does not contain a JSON array.")
            fatal = True
            continue

        sql = spec.dataset_sql(entry)
        outputs.append(
            DatasetOutput(entry=entry, records=list(records), payload=payload, query=sql)
        )
        result.problems.extend(
            _check_dataset(entry, records, payload, sql, manifest_datasets.get(entry.name))
        )

    return None if fatal else outputs


def _check_dataset(
    entry: spec.DatasetContract,
    records: Sequence[Any],
    payload: bytes,
    sql: str,
    declared: Mapping[str, Any] | None,
) -> list[str]:
    """Verify one committed dataset against its contract and manifest entry.

    Args:
        entry: The dataset contract.
        records: The parsed records.
        payload: The file's exact bytes.
        sql: The contract-built SQL for this dataset.
        declared: The dataset's manifest entry, if the manifest listed it.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    if declared is None:
        return [f"the manifest carries no entry for dataset {entry.name!r}."]

    digest = content_sha256(payload)
    if declared.get("file_sha256") != digest:
        problems.append(
            f"{entry.file_name} hashes to {digest} but the manifest records "
            f"{declared.get('file_sha256')}. The committed file and the manifest disagree: one "
            "of them was edited by hand."
        )
    if declared.get("file_bytes") != len(payload):
        problems.append(
            f"{entry.file_name} is {len(payload)} bytes but the manifest records "
            f"{declared.get('file_bytes')}."
        )
    if declared.get("row_count") != len(records):
        problems.append(
            f"{entry.file_name} holds {len(records)} row(s) but the manifest records "
            f"{declared.get('row_count')}."
        )
    expected_query_hash = query_sha256(sql)
    if declared.get("query_sha256") != expected_query_hash:
        problems.append(
            f"dataset {entry.name!r} records query hash {declared.get('query_sha256')} but the "
            f"contract now builds a query hashing to {expected_query_hash}. The source query "
            "changed; regenerate the export."
        )
    if payload != render_dataset_bytes([record for record in records if isinstance(record, dict)]):
        problems.append(
            f"{entry.file_name} is not in canonical serialisation. Regenerate it rather than "
            "editing it: --check is a byte comparison, and a hand-formatted file cannot pass one."
        )

    problems.extend(_check_records(entry, records))
    return problems


def _check_records(entry: spec.DatasetContract, records: Sequence[Any]) -> list[str]:
    """Verify every committed row against its column contract and the declared key.

    Args:
        entry: The dataset contract.
        records: The parsed records.

    Returns:
        Problem messages, capped at the first few per dataset so one broken column does not
        produce thousands of lines.
    """
    problems: list[str] = []
    expected = list(entry.column_names)
    seen: set[tuple[Any, ...]] = set()

    for index, record in enumerate(records):
        if len(problems) >= _MAX_ROW_PROBLEMS:
            problems.append(f"{entry.file_name}: further row problems suppressed.")
            break
        if not isinstance(record, dict):
            problems.append(f"{entry.file_name} row {index} is not a JSON object.")
            continue
        if list(record) != expected:
            problems.append(
                f"{entry.file_name} row {index} declares keys {list(record)!r}; the contract "
                f"declares {expected!r}, in that order."
            )
            continue
        problems.extend(_check_record_values(entry, index, record))
        key = tuple(record[name] for name in entry.business_key)
        if key in seen:
            problems.append(
                f"{entry.file_name} repeats the business key {key!r}. The declared grain is: "
                f"{entry.grain}"
            )
        seen.add(key)
    return problems


def _check_record_values(
    entry: spec.DatasetContract, index: int, record: Mapping[str, Any]
) -> list[str]:
    """Verify one row's values against their column declarations.

    Args:
        entry: The dataset contract.
        index: The row's position, for the message.
        record: The parsed row.

    Returns:
        Problem messages.
    """
    problems: list[str] = []
    for column in entry.columns:
        value = record[column.name]
        if value is None:
            if not column.nullable:
                problems.append(
                    f"{entry.file_name} row {index} has a null {column.name}, which the contract "
                    "declares required."
                )
            continue
        if not _value_matches_type(column.type, value):
            problems.append(
                f"{entry.file_name} row {index} column {column.name} carries {value!r}, which is "
                f"not a valid {column.type} value."
            )
            continue
        if column.enumeration is not None and value not in column.enumeration:
            problems.append(
                f"{entry.file_name} row {index} column {column.name} carries {value!r}, outside "
                f"its closed enumeration ({', '.join(column.enumeration)})."
            )
    return problems


def _value_matches_type(type_: str, value: Any) -> bool:
    """Decide whether a parsed JSON value matches a declared column type.

    Args:
        type_: The declared type.
        value: The parsed value.

    Returns:
        ``True`` when the value is a legitimate representation of that type.
    """
    if type_ == "boolean":
        return isinstance(value, bool)
    if type_ in {"integer", "double"}:
        if isinstance(value, bool):
            return False
        return isinstance(value, int) if type_ == "integer" else isinstance(value, float | int)
    if not isinstance(value, str):
        return False
    return _string_value_matches_type(type_, value)


def _string_value_matches_type(type_: str, value: str) -> bool:
    """Decide whether a JSON string matches a declared string-carried column type.

    Args:
        type_: The declared type.
        value: The parsed string.

    Returns:
        ``True`` when the string is a legitimate representation of that type.
    """
    if type_ == "currency":
        return _is_decimal_string(value, places=spec.MONETARY_DECIMAL_PLACES)
    if type_ == "exact":
        return _is_decimal_string(value)
    if type_ == "date":
        try:
            datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            return False
        return True
    return True


def _is_decimal_string(value: str, *, places: int | None = None) -> bool:
    """Decide whether a string is an exact positional decimal, optionally at a fixed scale.

    Exponent notation is rejected: two spellings of one number would break byte-stability,
    and the serialiser never emits one.

    Args:
        value: The candidate string.
        places: The exact number of decimal places required, or ``None`` for any scale.

    Returns:
        ``True`` when the string is acceptable.
    """
    if "e" in value or "E" in value:
        return False
    try:
        Decimal(value)
    except ArithmeticError:
        return False
    if places is None:
        return True
    _, _, fraction = value.partition(".")
    return len(fraction) == places


def _check_totals(manifest: Mapping[str, Any], outputs: Sequence[DatasetOutput]) -> list[str]:
    """Re-derive every reconciliation total from the committed rows and compare.

    This is the export-to-committed-bytes half of the reconciliation chain: the manifest's
    totals must be arithmetic over exactly the rows the console will read, not over some
    intermediate the exporter held in memory.

    Args:
        manifest: The committed manifest.
        outputs: The reloaded datasets.

    Returns:
        Problem messages.
    """
    reconciliation = manifest.get("reconciliation")
    if not isinstance(reconciliation, Mapping):
        return ["the manifest carries no reconciliation block, so its totals cannot be checked."]
    declared = reconciliation.get("totals")
    if not isinstance(declared, Mapping):
        return ["the manifest's reconciliation block carries no totals."]

    recomputed = compute_reconciliation_totals({output.entry.name: output for output in outputs})
    problems: list[str] = []
    for name, expected in recomputed.items():
        actual = declared.get(name)
        if not isinstance(actual, Mapping):
            problems.append(f"the manifest records no reconciliation total named {name!r}.")
            continue
        for component in ("total", "numerator", "denominator"):
            if component not in expected:
                continue
            if actual.get(component) != expected[component]:
                problems.append(
                    f"reconciliation total {name!r} recomputes its {component} from the "
                    f"committed rows as {expected[component]!r} but the manifest records "
                    f"{actual.get(component)!r}."
                )
    for name in declared:
        if name not in recomputed:
            problems.append(
                f"the manifest records a reconciliation total {name!r} the contract does not "
                "declare."
            )
    return problems


def _check_against_database(
    connection: Any, output_dir: Path, manifest: Mapping[str, Any]
) -> list[str]:
    """Re-export and byte-compare against the committed tree.

    Only meaningful against the pipeline run the export was taken from: a rebuilt warehouse
    is a different execution, and saying so is more useful than reporting a byte difference
    in ``run_uuid`` as if it were a defect.

    Args:
        connection: An open connection.
        output_dir: The committed export directory.
        manifest: The committed manifest.

    Returns:
        Problem messages.
    """
    fresh = generate_export(
        connection,
        output_dir=output_dir,
        repo_root=output_dir,
        generated_at=str(manifest.get("generated_at")),
        write=False,
    )
    if fresh.problems:
        return [f"a fresh export would fail: {problem}" for problem in fresh.problems]

    committed_run = manifest.get("pipeline_run")
    fresh_run = fresh.manifest.get("pipeline_run")
    committed_uuid = committed_run.get("run_uuid") if isinstance(committed_run, Mapping) else None
    fresh_uuid = fresh_run.get("run_uuid") if isinstance(fresh_run, Mapping) else None
    if committed_uuid != fresh_uuid:
        return [
            f"the database holds pipeline run {fresh_uuid} but the committed export was taken "
            f"from {committed_uuid}. A rebuilt warehouse is a different execution: regenerate "
            "the export rather than comparing across runs."
        ]

    problems: list[str] = []
    for entry in spec.DATASETS:
        declared = next(
            (
                item
                for item in fresh.manifest.get("datasets", [])
                if isinstance(item, Mapping) and item.get("name") == entry.name
            ),
            None,
        )
        committed = output_dir / entry.file_name
        if declared is None or not committed.is_file():
            problems.append(f"dataset {entry.name!r} could not be compared against the database.")
            continue
        if declared.get("file_sha256") != content_sha256(committed.read_bytes()):
            problems.append(
                f"{entry.file_name} differs from a fresh export of the same pipeline run. The "
                "committed artifact is stale or was edited by hand; regenerate it."
            )

    for field_name, value in fresh.manifest.items():
        if field_name in VARYING_MANIFEST_FIELDS or field_name == "datasets":
            continue
        if manifest.get(field_name) != value:
            problems.append(
                f"the manifest's {field_name!r} differs from a fresh export of the same run."
            )
    return problems


def iter_dataset_paths(output_dir: Path) -> Iterator[Path]:
    """Yield every file the export comprises, manifest first, in a stable order.

    Args:
        output_dir: The export directory.

    Yields:
        Paths, whether or not they exist, so a caller can report a missing one.
    """
    yield output_dir / spec.MANIFEST_FILE_NAME
    for entry in spec.DATASETS:
        yield output_dir / entry.file_name
