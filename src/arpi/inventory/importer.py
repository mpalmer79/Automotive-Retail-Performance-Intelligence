"""Workbook to PostgreSQL: raw, staging, observed vehicle, listing fact.

One import is one workbook, one batch and one transaction. Either every layer moved or
nothing did, and the reconciliations that prove it run inside the same transaction, so an
import that could not account for its own rows rolls back rather than reporting success.

The idempotency rule
--------------------
Historical listing snapshots are immutable. That is enforced in three places, and it is
worth naming all three because each catches a different mistake:

1. **Before anything is landed**, the importer asks whether the workbook's SHA-256 has
   already been imported. A rerun of the same file therefore does no work at all and says
   so, rather than landing a second raw batch that staging would then silently deduplicate.
2. **A different file for a batch already loaded is REFUSED.** That is the corrected-workbook
   case, and it is a refusal rather than an update because silently restating an
   observation somebody made in the past is not a correction, it is a rewrite. The
   supersession procedure is documented in ``data/reference/README.md`` section 8.
3. **The fact load is INSERT-only**, on the declared grain, with ``ON CONFLICT DO NOTHING``.
   Even a caller who bypassed both checks above cannot produce a duplicate or a restatement.

What is never logged
--------------------
No original VIN, no source URL, no complete source row. The workbook the importer reads
has none of the first two by contract, and :class:`ImportSummary` carries counts, batch
identifiers, a digest and repository paths.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from arpi.constants import ARPI_VERSION
from arpi.exceptions import DatabaseLoadError, ValidationError
from arpi.inventory.contract import InventoryListingContract, load_contract
from arpi.inventory.spec import INVENTORY_LISTING_SOURCE, ReferenceSourceSpec
from arpi.inventory.validation import (
    ListingRecord,
    WorkbookValidationResult,
    read_listing_records,
)
from arpi.logging_config import get_logger

__all__ = [
    "ImportSummary",
    "ReconciliationOutcome",
    "import_listing_workbook",
]

_LOGGER = get_logger(__name__)

#: Default SQL root, relative to the directory ARPI is run from.
DEFAULT_SQL_ROOT = Path("sql")


@dataclass(frozen=True, slots=True)
class ReconciliationOutcome:
    """One reconciliation verdict read back from ``audit.vw_recon_inventory_listing``.

    Attributes:
        reconciliation_id: Stable ``RECON-LISTING-*`` identifier.
        description: What was compared, including the observed figures.
        left_value: The left-hand number.
        right_value: The right-hand number.
        status: ``passed`` or ``failed``.
    """

    reconciliation_id: str
    description: str
    left_value: float
    right_value: float
    status: str


@dataclass(frozen=True, slots=True)
class ImportSummary:
    """What one import did.

    Attributes:
        workbook: File name of the imported workbook, exactly as committed.
        digest: SHA-256 of its bytes.
        dealership_id: Store the rows belong to.
        captured_at: Snapshot date.
        source_batch_id: Capture batch identifier.
        load_batch_id: UUID of this ingestion batch.
        workbook_rows: Rows read from the ``Inventory`` sheet.
        raw_rows: Rows landed in ``raw``.
        staged_rows: Rows staging accepted.
        rejected_rows: Rows staging refused, with a redacted reason recorded in ``audit``.
        observed_vehicles: Rows in ``warehouse.dim_observed_vehicle`` for this batch.
        fact_rows_inserted: Rows this import added to the listing fact.
        fact_rows_total: Rows the listing fact holds afterwards.
        reconciliations: Every reconciliation verdict, in identifier order.
        already_imported: Whether the workbook had already been imported, in which case
            nothing was written.
    """

    workbook: str
    digest: str
    dealership_id: str
    captured_at: date
    source_batch_id: str
    load_batch_id: uuid.UUID | None
    workbook_rows: int
    raw_rows: int
    staged_rows: int
    rejected_rows: int
    observed_vehicles: int
    fact_rows_inserted: int
    fact_rows_total: int
    reconciliations: tuple[ReconciliationOutcome, ...]
    already_imported: bool

    @property
    def failing_reconciliations(self) -> tuple[ReconciliationOutcome, ...]:
        """Every reconciliation that did not pass."""
        return tuple(row for row in self.reconciliations if row.status != "passed")

    def summary(self) -> str:
        """Render a redacted, human-readable summary."""
        if self.already_imported:
            return "\n".join(
                [
                    f"workbook           : {self.workbook}",
                    f"sha256             : {self.digest}",
                    f"dealership         : {self.dealership_id}",
                    f"captured at        : {self.captured_at.isoformat()}",
                    f"source batch       : {self.source_batch_id}",
                    "result             : ALREADY IMPORTED (nothing written)",
                    f"fact rows total    : {self.fact_rows_total}",
                ]
            )
        lines = [
            f"workbook           : {self.workbook}",
            f"sha256             : {self.digest}",
            f"dealership         : {self.dealership_id}",
            f"captured at        : {self.captured_at.isoformat()}",
            f"source batch       : {self.source_batch_id}",
            f"load batch         : {self.load_batch_id}",
            f"workbook rows      : {self.workbook_rows}",
            f"raw rows           : {self.raw_rows}",
            f"staged rows        : {self.staged_rows}",
            f"rejected rows      : {self.rejected_rows}",
            f"observed vehicles  : {self.observed_vehicles}",
            f"fact rows inserted : {self.fact_rows_inserted}",
            f"fact rows total    : {self.fact_rows_total}",
            f"reconciliations    : {len(self.reconciliations)} evaluated, "
            f"{len(self.failing_reconciliations)} failing",
        ]
        lines.extend(
            f"  {row.status:>6}  {row.reconciliation_id}: {row.description}"
            for row in self.reconciliations
        )
        return "\n".join(lines)

    def as_dict(self) -> dict[str, Any]:
        """Render the summary as a JSON-serialisable mapping."""
        return {
            "workbook": self.workbook,
            "sha256": self.digest,
            "dealership_id": self.dealership_id,
            "captured_at": self.captured_at.isoformat(),
            "source_batch_id": self.source_batch_id,
            "load_batch_id": str(self.load_batch_id) if self.load_batch_id else None,
            "already_imported": self.already_imported,
            "workbook_rows": self.workbook_rows,
            "raw_rows": self.raw_rows,
            "staged_rows": self.staged_rows,
            "rejected_rows": self.rejected_rows,
            "observed_vehicles": self.observed_vehicles,
            "fact_rows_inserted": self.fact_rows_inserted,
            "fact_rows_total": self.fact_rows_total,
            "reconciliations": [
                {
                    "reconciliation_id": row.reconciliation_id,
                    "status": row.status,
                    "left_value": float(row.left_value),
                    "right_value": float(row.right_value),
                    "description": row.description,
                }
                for row in self.reconciliations
            ],
        }


# --------------------------------------------------------------------------------------
# Low-level helpers
# --------------------------------------------------------------------------------------

#: Raw-layer columns, in the order the COPY writes them. Derived from the contract at
#: call time rather than restated here, except for the load metadata that only the
#: importer knows.
_LOAD_METADATA_COLUMNS: tuple[str, ...] = (
    "load_batch_id",
    "source_file_name",
    "source_file_digest",
    "source_row_number",
)


def _scalar(cursor: Any, statement: str, parameters: Sequence[Any] = ()) -> Any:
    """Run a statement expected to return one value."""
    cursor.execute(statement, parameters)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _already_imported(cursor: Any, spec: ReferenceSourceSpec, digest: str) -> bool:
    """Return whether a workbook with this exact digest has already reached the fact."""
    return bool(
        _scalar(
            cursor,
            f"SELECT EXISTS (SELECT 1 FROM warehouse.{spec.fact_table} "  # noqa: S608
            "WHERE source_file_digest = %s)",
            (digest,),
        )
    )


def _conflicting_batch(cursor: Any, spec: ReferenceSourceSpec, batch_id: str, digest: str) -> str | None:
    """Return the digest already loaded for this batch under different bytes, if any."""
    return _scalar(  # type: ignore[no-any-return]
        cursor,
        f"SELECT min(source_file_digest) FROM warehouse.{spec.fact_table} "  # noqa: S608
        "WHERE source_batch_id = %s AND source_file_digest <> %s",
        (batch_id, digest),
    )


def _land_raw_rows(
    cursor: Any,
    spec: ReferenceSourceSpec,
    records: Sequence[ListingRecord],
    *,
    contract: InventoryListingContract,
    load_batch_id: uuid.UUID,
    source_file_name: str,
    digest: str,
) -> int:
    """COPY the sanitized rows into the raw landing table and return the row count.

    The column list is the contract's column list plus the load metadata, so a change to
    the sanitized shape cannot silently misalign the COPY: the raw table declares the same
    columns from the same contract, and a mismatch is an error rather than a shifted value.
    """
    columns = (*contract.columns, *_LOAD_METADATA_COLUMNS)
    column_sql = ", ".join(columns)
    statement = f"COPY raw.{spec.raw_table} ({column_sql}) FROM STDIN"  # noqa: S608
    with cursor.copy(statement) as copy:
        for record in records:
            copy.write_row(
                (
                    record.source_record_id,
                    record.dealership_id,
                    record.store_name,
                    record.captured_at.isoformat(),
                    record.source_batch_id,
                    record.source_feed,
                    record.condition_type,
                    str(record.model_year),
                    record.make,
                    record.model,
                    record.trim,
                    record.vehicle_display,
                    str(record.odometer_miles),
                    None if record.advertised_price is None else f"{record.advertised_price:.2f}",
                    record.pricing_status,
                    record.synthetic_vehicle_id,
                    record.synthetic_vin,
                    str(record.inventory_unit_count),
                    record.data_classification,
                    str(load_batch_id),
                    source_file_name,
                    digest,
                    str(record.row_number),
                )
            )
    return len(records)


def _execute_script(cursor: Any, sql_root: Path, relative: str) -> None:
    """Execute one repository-controlled SQL script by path.

    Args:
        cursor: Open cursor; the caller owns the transaction.
        sql_root: Directory holding the numbered SQL folders.
        relative: Path relative to ``sql_root``.

    Raises:
        DatabaseLoadError: If the script is absent. A missing load script would leave the
            warehouse holding raw rows and no facts while the import reported success.
    """
    path = sql_root / relative
    if not path.is_file():
        raise DatabaseLoadError(
            f"Required SQL script not found: {path}. The inventory listing import cannot "
            "run without it; run ARPI from the repository root or pass an explicit "
            "sql_root.",
            missing_paths=[path],
        )
    cursor.execute(path.read_text(encoding="utf-8"))


def _open_audit_run(cursor: Any, *, profile: str, source_entity: str, captured_at: date) -> int:
    """Open an ``audit.pipeline_run`` row for this import and return its identifier.

    An import is a run in its own right. It has a start, an end, row counts at each layer,
    rejected records and reconciliation verdicts, and every one of those audit tables
    requires a ``pipeline_run_id``. Reusing the last pipeline run's identifier would
    attribute a workbook import to a synthetic-data run that never touched it.

    ``run_uuid`` identifies THIS execution attempt and is random per execution;
    ``logical_run_key`` is the deterministic fingerprint of what was asked for, which is
    exactly the separation ADR-0010 established. For an import, "what was asked for" is
    the lane, the profile and the capture being imported -- so re-importing the same
    capture is recognisably the same logical run across attempts, while each attempt
    keeps its own row.

    ``random_seed`` is zero because this lane generates nothing: the number is a property
    of a synthetic generator, and recording a fictitious seed would imply the import
    could be reproduced from one.
    """
    from arpi.audit.run import build_execution_uuid, build_logical_run_key

    logical_key = build_logical_run_key(
        pipeline_name=source_entity,
        profile=profile,
        random_seed=0,
        start_date=captured_at,
        end_date=captured_at,
    )
    cursor.execute(
        """
        INSERT INTO audit.pipeline_run (
            run_uuid, logical_run_key, pipeline_name, profile_name, run_mode,
            random_seed, arpi_version, started_at, status
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, now(), 'running')
        RETURNING pipeline_run_id
        """,
        (
            str(build_execution_uuid()),
            str(logical_key),
            source_entity,
            profile,
            "cli",
            0,
            ARPI_VERSION,
        ),
    )
    return int(cursor.fetchone()[0])


def _close_audit_run(cursor: Any, pipeline_run_id: int, status: str, notes: str) -> None:
    """Close the import's audit run with a final status and a redacted note."""
    cursor.execute(
        """
        UPDATE audit.pipeline_run
           SET completed_at = now(), status = %s, notes = %s
         WHERE pipeline_run_id = %s
        """,
        (status, notes, pipeline_run_id),
    )


def _record_row_counts(cursor: Any, pipeline_run_id: int, entity: str, counts: dict[str, int]) -> None:
    """Record the observed row count at each layer boundary.

    All five layers are recorded on every import -- ``source``, ``raw``, ``staging``,
    ``warehouse`` and ``rejected`` -- so the source-to-warehouse chain can be read off the
    audit table without re-running anything.
    """
    for layer, row_count in counts.items():
        cursor.execute(
            """
            INSERT INTO audit.pipeline_run_row_count (pipeline_run_id, entity_name, layer, row_count)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (pipeline_run_id, entity_name, layer) DO UPDATE
               SET row_count = EXCLUDED.row_count, recorded_at = now()
            """,
            (pipeline_run_id, entity, layer, row_count),
        )


def _record_rejections(cursor: Any, spec: ReferenceSourceSpec, pipeline_run_id: int) -> int:
    """Copy staging's rejected rows into ``audit.rejected_record``, redacted.

    The payload passes through the same prohibited-field redaction every other ARPI
    rejection does. This source carries no personal-data column at all, so the redaction
    is a no-op today -- and it is applied anyway, because the day a future contract adds a
    column is not the day to discover that this path skipped the control.
    """
    from arpi.validation.privacy import redact_payload

    cursor.execute(
        f"""
        SELECT source_entity, source_record_key, rejection_code, rejection_reason,
               record_payload
        FROM staging.{spec.rejected_view}
        ORDER BY raw_record_id
        """  # noqa: S608 - spec.rejected_view is a module-level literal, never input
    )
    rows = cursor.fetchall()
    for source_entity, source_record_key, rejection_code, rejection_reason, payload in rows:
        cursor.execute(
            """
            INSERT INTO audit.rejected_record (
                pipeline_run_id, source_entity, source_record_key,
                rejection_code, rejection_reason, record_payload
            ) VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                pipeline_run_id,
                source_entity,
                source_record_key,
                rejection_code,
                rejection_reason,
                _json(redact_payload(payload or {})),
            ),
        )
    return len(rows)


def _record_reconciliations(
    cursor: Any, pipeline_run_id: int, outcomes: Sequence[ReconciliationOutcome]
) -> None:
    """Persist the listing reconciliation verdicts against the import's own run.

    A verdict nobody persisted is not evidence. The listing lane is not part of
    ``audit.vw_recon_all`` -- see the reconciliation view's own header for why -- so it
    records its results here rather than through the pipeline's recorder function.
    """
    cursor.execute(
        """
        INSERT INTO audit.reconciliation_result (
            pipeline_run_id, reconciliation_id, description, left_source, left_value,
            right_source, right_value, tolerance, status
        )
        SELECT %s, r.reconciliation_id, r.description, r.left_source, r.left_value,
               r.right_source, r.right_value, r.tolerance, r.status
        FROM audit.vw_recon_inventory_listing AS r
        """,
        (pipeline_run_id,),
    )
    _LOGGER.info("Recorded %d listing reconciliation verdict(s).", len(outcomes))


def _json(payload: dict[str, Any]) -> str:
    """Render a payload as JSON for the audit table's jsonb column."""
    import json

    return json.dumps(payload, default=str, sort_keys=True)


def _reconciliations(cursor: Any) -> tuple[ReconciliationOutcome, ...]:
    """Evaluate the listing reconciliations and return every verdict."""
    cursor.execute(
        """
        SELECT reconciliation_id, description, left_value, right_value, status
        FROM audit.vw_recon_inventory_listing
        ORDER BY reconciliation_id
        """
    )
    return tuple(
        ReconciliationOutcome(
            reconciliation_id=row[0],
            description=row[1],
            left_value=float(row[2] or 0),
            right_value=float(row[3] or 0),
            status=row[4],
        )
        for row in cursor.fetchall()
    )


# --------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------


def import_listing_workbook(  # noqa: PLR0913 - every argument is an operator decision
    connection: Any,
    workbook_path: Path,
    *,
    contract: InventoryListingContract | None = None,
    spec: ReferenceSourceSpec = INVENTORY_LISTING_SOURCE,
    sql_root: Path = DEFAULT_SQL_ROOT,
    expect_dealership: str | None = None,
    expect_captured_at: date | None = None,
    profile: str = "development",
    dry_run: bool = False,
) -> ImportSummary:
    """Import one sanitized listing workbook into PostgreSQL.

    The whole import runs in the caller's transaction. Nothing is committed here: the
    caller commits on success and rolls back on failure, which is what makes an import
    that fails its own reconciliations leave no trace.

    Args:
        connection: Open ``psycopg`` connection. The caller owns the transaction.
        workbook_path: The committed sanitized workbook.
        contract: Contract to validate and type against.
        spec: Source adapter spec. Defaults to the inventory listing lane.
        sql_root: Directory holding the numbered SQL folders.
        expect_dealership: Store the operator expects. A disagreement is a refusal.
        expect_captured_at: Snapshot date the operator expects. A disagreement is a refusal.
        profile: Configuration profile recorded on the import's own ``audit.pipeline_run``
            row, so an import is attributable to an environment.
        dry_run: Validate, report what would be imported, and write nothing.

    Returns:
        A redacted summary of the import.

    Raises:
        ValidationError: If the workbook fails validation, or if a DIFFERENT workbook has
            already been imported for the same capture batch.
        DatabaseLoadError: If a required SQL script is missing, or if a reconciliation
            failed. Both leave the transaction for the caller to roll back.
    """
    active = contract or load_contract()
    result: WorkbookValidationResult = read_listing_records(
        workbook_path,
        contract=active,
        expect_dealership=expect_dealership,
        expect_captured_at=expect_captured_at,
    )
    records = result.records
    first = records[0]

    with connection.cursor() as cursor:
        if _already_imported(cursor, spec, result.digest):
            _LOGGER.info(
                "Workbook %s (digest %s) has already been imported; nothing to do.",
                workbook_path.name,
                result.digest,
            )
            return ImportSummary(
                workbook=workbook_path.name,
                digest=result.digest,
                dealership_id=first.dealership_id,
                captured_at=first.captured_at,
                source_batch_id=first.source_batch_id,
                load_batch_id=None,
                workbook_rows=len(records),
                raw_rows=0,
                staged_rows=0,
                rejected_rows=0,
                observed_vehicles=0,
                fact_rows_inserted=0,
                fact_rows_total=int(
                    _scalar(cursor, f"SELECT count(*) FROM warehouse.{spec.fact_table}")  # noqa: S608
                    or 0
                ),
                reconciliations=(),
                already_imported=True,
            )

        conflicting = _conflicting_batch(cursor, spec, first.source_batch_id, result.digest)
        if conflicting is not None:
            raise ValidationError(
                f"Capture batch {first.source_batch_id!r} has already been imported from a "
                f"DIFFERENT workbook (loaded digest {conflicting}, offered digest "
                f"{result.digest}). Historical listing snapshots are immutable and are "
                "never silently restated. Use the supersession procedure in "
                "data/reference/README.md section 8: assign the corrected capture its own "
                "batch identifier, or remove the superseded batch deliberately and record "
                "why.",
                field="source_batch_id",
            )

        if dry_run:
            return ImportSummary(
                workbook=workbook_path.name,
                digest=result.digest,
                dealership_id=first.dealership_id,
                captured_at=first.captured_at,
                source_batch_id=first.source_batch_id,
                load_batch_id=None,
                workbook_rows=len(records),
                raw_rows=0,
                staged_rows=0,
                rejected_rows=0,
                observed_vehicles=0,
                fact_rows_inserted=0,
                fact_rows_total=int(
                    _scalar(cursor, f"SELECT count(*) FROM warehouse.{spec.fact_table}")  # noqa: S608
                    or 0
                ),
                reconciliations=(),
                already_imported=False,
            )

        load_batch_id = uuid.uuid4()
        pipeline_run_id = _open_audit_run(
            cursor,
            profile=profile,
            source_entity=spec.source_entity,
            captured_at=first.captured_at,
        )
        fact_rows_before = int(
            _scalar(cursor, f"SELECT count(*) FROM warehouse.{spec.fact_table}") or 0  # noqa: S608
        )

        raw_rows = _land_raw_rows(
            cursor,
            spec,
            records,
            contract=active,
            load_batch_id=load_batch_id,
            source_file_name=workbook_path.name,
            digest=result.digest,
        )

        staged_rows = int(
            _scalar(cursor, f"SELECT count(*) FROM staging.{spec.staging_view}") or 0  # noqa: S608
        )
        rejected_rows = _record_rejections(cursor, spec, pipeline_run_id)

        _execute_script(cursor, sql_root, f"03_dimensions/{spec.dimension_merge_script}")
        _execute_script(cursor, sql_root, f"04_facts/{spec.fact_load_script}")

        fact_rows_after = int(
            _scalar(cursor, f"SELECT count(*) FROM warehouse.{spec.fact_table}") or 0  # noqa: S608
        )
        observed_vehicles = int(
            _scalar(
                cursor,
                f"SELECT count(*) FROM warehouse.{spec.dimension_table} AS d "  # noqa: S608
                f"WHERE d.synthetic_vehicle_id IN "
                f"(SELECT synthetic_vehicle_id FROM staging.{spec.staging_view})",
            )
            or 0
        )

        _record_row_counts(
            cursor,
            pipeline_run_id,
            spec.source_entity,
            {
                "source": len(records),
                "raw": raw_rows,
                "staging": staged_rows,
                "rejected": rejected_rows,
                "warehouse": fact_rows_after - fact_rows_before,
            },
        )

        outcomes = _reconciliations(cursor)
        _record_reconciliations(cursor, pipeline_run_id, outcomes)
        failing = [row for row in outcomes if row.status != "passed"]
        if failing:
            rendered = "\n  ".join(
                f"{row.reconciliation_id}: {row.description}" for row in failing
            )
            # The run is marked failed before the exception is raised, so an operator who
            # inspects the audit trail after a rollback sees the same verdict the CLI
            # printed. The caller's rollback then discards both, which is correct: an
            # import that could not account for its own rows left no data either.
            _close_audit_run(
                cursor,
                pipeline_run_id,
                "failed",
                f"{len(failing)} listing reconciliation(s) failed for "
                f"{workbook_path.name}.",
            )
            raise DatabaseLoadError(
                f"{len(failing)} listing reconciliation(s) failed, so the import is "
                f"refused and the transaction must be rolled back:\n  {rendered}",
                context={"failing": [row.reconciliation_id for row in failing]},
            )

        _close_audit_run(
            cursor,
            pipeline_run_id,
            "succeeded",
            f"Imported {raw_rows} sanitized listing row(s) from {workbook_path.name} "
            f"(digest {result.digest}).",
        )

        return ImportSummary(
            workbook=workbook_path.name,
            digest=result.digest,
            dealership_id=first.dealership_id,
            captured_at=first.captured_at,
            source_batch_id=first.source_batch_id,
            load_batch_id=load_batch_id,
            workbook_rows=len(records),
            raw_rows=raw_rows,
            staged_rows=staged_rows,
            rejected_rows=rejected_rows,
            observed_vehicles=observed_vehicles,
            fact_rows_inserted=fact_rows_after - fact_rows_before,
            fact_rows_total=fact_rows_after,
            reconciliations=outcomes,
            already_imported=False,
        )
