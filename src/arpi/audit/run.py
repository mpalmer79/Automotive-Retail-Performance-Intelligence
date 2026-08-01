"""Pipeline-run audit records.

The recorder always collects results in memory. Persisting them to the ``audit`` schema
is optional and only happens when a database load actually ran, so a developer with no
PostgreSQL instance still gets the full audit trail on stdout.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from arpi.constants import (
    ARPI_VERSION,
    AUDIT_LAYERS,
    PIPELINE_STATUSES,
)
from arpi.exceptions import ValidationError
from arpi.validation.results import CheckResult, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

#: Fixed UUIDv5 namespace for ARPI logical runs. Never change this value: it would
#: renumber every historical run.
#:
#: This namespace was originally used to derive ``run_uuid`` itself. It now derives
#: :func:`build_logical_run_key`, over the identical payload, so that every historical
#: row's identifier is reproduced exactly in the column that now carries those semantics.
RUN_UUID_NAMESPACE = uuid.UUID("6d0c1f2a-6f8f-5b2e-9a1f-2b7d4c8e0a31")

STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_ABORTED = "aborted"

LAYER_SOURCE = "source"
LAYER_RAW = "raw"
LAYER_STAGING = "staging"
LAYER_WAREHOUSE = "warehouse"
LAYER_REJECTED = "rejected"


def build_logical_run_key(
    pipeline_name: str,
    profile: str,
    random_seed: int,
    start_date: date,
    end_date: date,
) -> uuid.UUID:
    """Derive the deterministic ``logical_run_key`` for a pipeline run.

    A UUIDv5 over ``(pipeline_name, profile, random_seed, start_date, end_date)``, so that
    **every execution asked to do the same thing shares one value**. It answers "which
    attempts are equivalent?" and nothing else.

    It is deliberately *not* unique in ``audit.pipeline_run``, is not the primary key, is
    not an upsert conflict target, and is never used to overwrite an earlier execution.
    Execution identity is :attr:`PipelineRun.run_uuid`, which is random per attempt. See
    ``docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md``.

    ``arpi_version`` is deliberately excluded from the payload: upgrading ARPI does not
    change what a run was asked to do, and including it would make "compare this run
    before and after the upgrade" inexpressible.

    Args:
        pipeline_name: Logical pipeline name, e.g. ``"phase0_foundation"``.
        profile: Active configuration profile.
        random_seed: Master seed for the run.
        start_date: Reporting window start.
        end_date: Reporting window end.

    Returns:
        A deterministic UUIDv5.
    """
    payload = "|".join(
        (
            pipeline_name,
            profile,
            str(random_seed),
            start_date.isoformat(),
            end_date.isoformat(),
        )
    )
    return uuid.uuid5(RUN_UUID_NAMESPACE, payload)


def build_execution_uuid() -> uuid.UUID:
    """Generate the identity of one pipeline **execution attempt**.

    A random UUIDv4, generated once at run start and never reused. Two executions with
    identical inputs get different values, which is what keeps both attempts visible in
    ``audit.pipeline_run``.

    Returns:
        A fresh random UUIDv4.
    """
    return uuid.uuid4()


@dataclass(slots=True)
class PipelineRun:
    """Mirrors one row of ``audit.pipeline_run``.

    Attributes:
        run_uuid: Identity of **this execution attempt**, from
            :func:`build_execution_uuid`. Random and unique per execution; two runs with
            identical inputs get different values so both attempts stay visible.
        logical_run_key: Deterministic fingerprint of the run's inputs, from
            :func:`build_logical_run_key`. Shared by every equivalent execution, and
            therefore *not* unique in ``audit.pipeline_run``.
        pipeline_name: Logical pipeline name.
        profile_name: Active configuration profile.
        run_mode: How the run was invoked, e.g. ``"cli"`` or ``"library"``.
        random_seed: Master seed for the run.
        arpi_version: Version of the package that produced the run.
        started_at: UTC start timestamp.
        completed_at: UTC completion timestamp, ``None`` while running.
        status: One of ``running``, ``succeeded``, ``failed``, ``aborted``.
        critical_failure_count: Number of failed critical data-quality checks.
        warning_count: Number of failed warning-level checks.
        notes: Free-form operator note.
    """

    run_uuid: uuid.UUID
    logical_run_key: uuid.UUID
    pipeline_name: str
    profile_name: str
    run_mode: str
    random_seed: int
    arpi_version: str
    started_at: datetime
    completed_at: datetime | None = None
    status: str = STATUS_RUNNING
    critical_failure_count: int = 0
    warning_count: int = 0
    notes: str | None = None

    @classmethod
    def start(
        cls, config: ArpiConfig, *, pipeline_name: str, run_mode: str = "library"
    ) -> PipelineRun:
        """Open a new execution for the given configuration.

        A fresh execution identity is generated here, so calling this twice with the same
        configuration opens two distinct attempts that share one ``logical_run_key``.

        Args:
            config: Resolved configuration.
            pipeline_name: Logical pipeline name.
            run_mode: How the run was invoked.

        Returns:
            A :class:`PipelineRun` in the ``running`` state.
        """
        return cls(
            run_uuid=build_execution_uuid(),
            logical_run_key=build_logical_run_key(
                pipeline_name,
                config.profile,
                config.random_seed,
                config.reporting.start_date,
                config.reporting.end_date,
            ),
            pipeline_name=pipeline_name,
            profile_name=config.profile,
            run_mode=run_mode,
            random_seed=config.random_seed,
            arpi_version=ARPI_VERSION,
            started_at=datetime.now(UTC),
        )

    def finish(self, status: str, *, notes: str | None = None) -> None:
        """Close the run.

        Args:
            status: Terminal status; must be one of the contract's status values.
            notes: Optional operator note.

        Raises:
            ValidationError: If ``status`` is not a recognised pipeline status.
        """
        if status not in PIPELINE_STATUSES:
            raise ValidationError(
                f"status must be one of {', '.join(PIPELINE_STATUSES)}, got {status!r}.",
                field="status",
            )
        self.status = status
        self.completed_at = datetime.now(UTC)
        if notes is not None:
            self.notes = notes

    def as_audit_row(self) -> dict[str, Any]:
        """Render this run as an ``audit.pipeline_run`` row (minus the serial key)."""
        return {
            "run_uuid": str(self.run_uuid),
            "logical_run_key": str(self.logical_run_key),
            "pipeline_name": self.pipeline_name,
            "profile_name": self.profile_name,
            "run_mode": self.run_mode,
            "random_seed": self.random_seed,
            "arpi_version": self.arpi_version,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "critical_failure_count": self.critical_failure_count,
            "warning_count": self.warning_count,
            "notes": self.notes,
        }


@dataclass(frozen=True, slots=True)
class RowCount:
    """Mirrors one row of ``audit.pipeline_run_row_count``."""

    entity_name: str
    layer: str
    row_count: int

    def as_audit_row(self) -> dict[str, Any]:
        """Render this record as an ``audit.pipeline_run_row_count`` row."""
        return {
            "entity_name": self.entity_name,
            "layer": self.layer,
            "row_count": self.row_count,
        }


@dataclass(frozen=True, slots=True)
class ReconciliationResult:
    """Mirrors one row of ``audit.reconciliation_result``."""

    reconciliation_id: str
    description: str
    left_source: str
    left_value: float
    right_source: str
    right_value: float
    tolerance: float = 0.0

    @property
    def difference(self) -> float:
        """Signed difference between the two sides."""
        return self.left_value - self.right_value

    @property
    def status(self) -> str:
        """``"passed"`` when the two sides agree within ``tolerance``."""
        return "passed" if abs(self.difference) <= self.tolerance else "failed"

    def as_audit_row(self) -> dict[str, Any]:
        """Render this record as an ``audit.reconciliation_result`` row.

        ``difference`` is omitted: the column is ``GENERATED ALWAYS AS`` in PostgreSQL.
        """
        return {
            "reconciliation_id": self.reconciliation_id,
            "description": self.description,
            "left_source": self.left_source,
            "left_value": self.left_value,
            "right_source": self.right_source,
            "right_value": self.right_value,
            "tolerance": self.tolerance,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class RejectedRecord:
    """Mirrors one row of ``audit.rejected_record``.

    A rejected record is a source row that reached ``raw`` and did not reach the
    warehouse. It is preserved rather than discarded so the defect can be reproduced.

    ``record_payload`` is a JSON **document string**, already redacted by
    ``arpi.ingestion.rejection.build_rejected_payload``. It is a string rather than a
    mapping for two reasons: this module must stay importable without the database
    extra, and passing an already-serialised document makes it impossible for a later
    caller to slip an unredacted mapping past the privacy boundary.

    Attributes:
        source_entity: Entity the rejected row belongs to.
        source_record_key: Best available natural key; ``None`` when it could not be read.
        rejection_code: Stable ``REJ-*`` identifier.
        rejection_reason: Human-readable explanation, prefixed with its canonical
            validation category because ``audit.rejected_record`` has no category column.
        record_payload: Redacted JSON document, or ``None`` when there is nothing safe
            to keep.
    """

    source_entity: str
    source_record_key: str | None
    rejection_code: str
    rejection_reason: str
    record_payload: str | None = None

    def as_audit_row(self) -> dict[str, Any]:
        """Render this record as an ``audit.rejected_record`` row."""
        return {
            "source_entity": self.source_entity,
            "source_record_key": self.source_record_key,
            "rejection_code": self.rejection_code,
            "rejection_reason": self.rejection_reason,
            "record_payload": self.record_payload,
        }


@dataclass(slots=True)
class AuditRecorder:
    """Collects everything a run should record, in memory.

    Attributes:
        run: The pipeline run being recorded.
        row_counts: Row counts per entity and layer.
        validation_results: Every evaluated data-quality check.
        reconciliation_results: Every evaluated reconciliation.
        rejected_records: Every source row that was quarantined rather than loaded.
    """

    run: PipelineRun
    row_counts: list[RowCount] = field(default_factory=list)
    validation_results: list[CheckResult] = field(default_factory=list)
    reconciliation_results: list[ReconciliationResult] = field(default_factory=list)
    rejected_records: list[RejectedRecord] = field(default_factory=list)

    def record_row_count(self, entity_name: str, layer: str, row_count: int) -> RowCount:
        """Record a row count for one entity in one layer.

        Args:
            entity_name: Warehouse entity name.
            layer: One of ``source``, ``raw``, ``staging``, ``warehouse``, ``rejected``.
            row_count: Number of rows observed.

        Returns:
            The recorded :class:`RowCount`.

        Raises:
            ValidationError: If ``layer`` is not a contract layer, the count is negative,
                or this ``(entity_name, layer)`` was already recorded for this run.
        """
        if layer not in AUDIT_LAYERS:
            raise ValidationError(
                f"layer must be one of {', '.join(AUDIT_LAYERS)}, got {layer!r}.",
                field="layer",
            )
        if row_count < 0:
            raise ValidationError(
                f"row_count must be non-negative, got {row_count}.", field="row_count"
            )
        # `audit.pipeline_run_row_count` is keyed on (pipeline_run_id, entity_name, layer),
        # and since ADR-0010 each execution owns its own pipeline_run_id -- so the loader
        # inserts these rows rather than upserting them. Recording the same entity and
        # layer twice within one run would therefore surface as a primary-key violation
        # from deep inside the loader, long after the mistake. It is a caller defect, so it
        # is rejected here, where the caller can see which pair was duplicated.
        if any(
            existing.entity_name == entity_name and existing.layer == layer
            for existing in self.row_counts
        ):
            raise ValidationError(
                f"row count for ({entity_name!r}, {layer!r}) was already recorded for this "
                "run. Each entity records each layer exactly once per execution.",
                field="entity_name",
            )
        record = RowCount(entity_name=entity_name, layer=layer, row_count=row_count)
        self.row_counts.append(record)
        return record

    def record_validation(self, report: ValidationReport) -> None:
        """Append every result in a report and refresh the run's failure tallies.

        Args:
            report: Report to absorb.
        """
        self.validation_results.extend(report.results)
        absorbed = ValidationReport(tuple(self.validation_results))
        self.run.critical_failure_count = len(absorbed.critical_failures)
        self.run.warning_count = len(absorbed.warnings)

    def record_reconciliation(self, result: ReconciliationResult) -> ReconciliationResult:
        """Append one reconciliation result.

        Args:
            result: Reconciliation outcome to record.

        Returns:
            The recorded result, for convenient chaining.
        """
        self.reconciliation_results.append(result)
        return result

    def record_rejection(self, record: RejectedRecord) -> RejectedRecord:
        """Append one rejected source row.

        Args:
            record: The quarantined row. Its payload must already have been redacted by
                ``arpi.ingestion.rejection.build_rejected_payload``; this recorder does
                not inspect it and cannot redact it.

        Returns:
            The recorded rejection, for convenient chaining.
        """
        self.rejected_records.append(record)
        return record

    @property
    def report(self) -> ValidationReport:
        """Every recorded validation result as a single report."""
        return ValidationReport(tuple(self.validation_results))

    def to_rows(self) -> dict[str, list[dict[str, Any]]]:
        """Render every recorded object as audit-table rows.

        Returns:
            A mapping of unqualified ``audit`` table name to a list of row dictionaries.
            ``rejected_record`` is empty when nothing was rejected, which is the expected
            state of a healthy run: ARPI generates its own source data, so a rejected row
            means a generator or mapping defect rather than a data-supplier problem.
        """
        return {
            "pipeline_run": [self.run.as_audit_row()],
            "pipeline_run_row_count": [row.as_audit_row() for row in self.row_counts],
            "validation_result": [row.as_audit_row() for row in self.validation_results],
            "reconciliation_result": [row.as_audit_row() for row in self.reconciliation_results],
            "rejected_record": [row.as_audit_row() for row in self.rejected_records],
        }
