"""The Phase 0 vertical slice: generate, validate, write, optionally load, audit.

This orchestrator is the whole implemented pipeline. Facts, transformations and
reporting refreshes are **Planned**, not implemented.

The database step is optional by design. When PostgreSQL is unavailable the run is
reported as *skipped, not failed*, together with the exact reason, so the slice remains
runnable on a laptop with nothing installed but Python.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from arpi.audit.run import (
    LAYER_SOURCE,
    STATUS_FAILED,
    STATUS_SUCCEEDED,
    AuditRecorder,
    PipelineRun,
)
from arpi.constants import PIPELINE_NAME_FOUNDATION, SYNTHETIC_DATA_NOTICE
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.writer import WrittenEntity, write_outputs
from arpi.ingestion.database import database_available
from arpi.ingestion.loader import DEFAULT_SQL_ROOT, LoadResult, load_foundation
from arpi.logging_config import configure_logging, get_logger
from arpi.utilities.paths import resolve_output_dir
from arpi.validation.datasets import validate_foundation_datasets
from arpi.validation.results import ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset

_LOGGER = get_logger(__name__)

SKIP_REASON_NOT_REQUESTED = (
    "not requested (pass --load-database, or set database.enabled and rerun)"
)


@dataclass(frozen=True, slots=True)
class FoundationRunResult:
    """Everything the Phase 0 slice produced.

    Attributes:
        run: The audited pipeline run.
        report: Every data-quality result from this run.
        datasets: The generated datasets, in generation order.
        raw_files: Files written under the raw output directory.
        sample_files: Files written under the sample output directory.
        database_loaded: Whether rows actually reached PostgreSQL.
        database_skip_reason: Why the database step did not run, if it did not.
        load_result: Details of the database load, when one happened.
        recorder: The in-memory audit recorder.
    """

    run: PipelineRun
    report: ValidationReport
    datasets: tuple[GeneratedDataset, ...]
    raw_files: tuple[WrittenEntity, ...]
    sample_files: tuple[WrittenEntity, ...]
    database_loaded: bool
    database_skip_reason: str | None
    load_result: LoadResult | None
    recorder: AuditRecorder

    @property
    def succeeded(self) -> bool:
        """``True`` when no critical data-quality check failed."""
        return not self.report.has_critical_failure

    def summary(self) -> str:
        """Render a human-readable execution summary.

        Returns:
            A multi-line report suitable for printing to stdout or pasting into a PR.
        """
        lines = [
            "ARPI Phase 0 foundation run",
            "=" * 60,
            f"profile              : {self.run.profile_name}",
            f"random_seed          : {self.run.random_seed}",
            f"run_uuid             : {self.run.run_uuid}",
            f"arpi_version         : {self.run.arpi_version}",
            f"status               : {self.run.status}",
            "",
            "Generated entities",
            "-" * 60,
        ]
        lines.extend(
            f"  {dataset.entity_name:<18} {dataset.row_count:>6} rows x "
            f"{dataset.column_count} columns"
            for dataset in self.datasets
        )
        lines.extend(["", "Files written", "-" * 60])
        written = [*self.raw_files, *self.sample_files]
        if written:
            lines.extend(
                f"  {entity.path}  ({entity.row_count} rows"
                f"{', truncated sample' if entity.truncated else ''}, "
                f"sha256={entity.content_digest[:16]}...)"
                for entity in written
            )
        else:
            lines.append("  (none)")
        lines.extend(["", "Database load", "-" * 60])
        if self.database_loaded and self.load_result is not None:
            lines.append(f"  loaded    : yes (batch {self.load_result.load_batch_id})")
            lines.extend(
                f"  warehouse : {entity} = {count} row(s)"
                for entity, count in sorted(self.load_result.warehouse_row_counts.items())
            )
            lines.extend(f"  merge sql : {path}" for path in self.load_result.executed_sql)
        else:
            lines.append(f"  skipped   : {self.database_skip_reason}")
            lines.append("  (skipped is not a failure: the slice runs without PostgreSQL)")
        lines.extend(["", "Data quality", "-" * 60, self.report.summary_table()])
        if self.recorder.reconciliation_results:
            lines.extend(["", "Reconciliation", "-" * 60])
            lines.extend(
                f"  {item.reconciliation_id}: {item.left_value:g} vs "
                f"{item.right_value:g} -> {item.status}"
                for item in self.recorder.reconciliation_results
            )
        lines.extend(["", SYNTHETIC_DATA_NOTICE])
        return "\n".join(lines)


def run_foundation(
    config: ArpiConfig,
    *,
    load_database: bool | None = None,
    output_dir: Path | str | None = None,
    sql_root: Path = DEFAULT_SQL_ROOT,
    run_mode: str = "library",
) -> FoundationRunResult:
    """Run the Phase 0 vertical slice end to end.

    Args:
        config: Resolved configuration.
        load_database: Force the database step on or off. ``None`` means "load when
            ``database.enabled`` is true and PostgreSQL answers".
        output_dir: Override for the raw output directory. Relative paths resolve
            against the project root; escaping it is refused.
        sql_root: Directory containing the numbered SQL folders.
        run_mode: Recorded on the audit row, e.g. ``"cli"``.

    Returns:
        A :class:`FoundationRunResult`. Critical data-quality failures are *reported*,
        not raised: the caller decides the exit code.
    """
    configure_logging(config)
    _LOGGER.info("Resolved configuration: %s", config.redacted_dict())

    run = PipelineRun.start(config, pipeline_name=PIPELINE_NAME_FOUNDATION, run_mode=run_mode)
    recorder = AuditRecorder(run=run)
    _LOGGER.info("Starting %s (run_uuid=%s).", run.pipeline_name, run.run_uuid)

    date_dataset = generate_date_dataset(config)
    dealership_dataset = generate_dealership_dataset(config)
    datasets = (date_dataset, dealership_dataset)
    for dataset in datasets:
        recorder.record_row_count(dataset.entity_name, LAYER_SOURCE, dataset.row_count)
        _LOGGER.info("Generated %s: %s row(s).", dataset.entity_name, dataset.row_count)

    report = validate_foundation_datasets(date_dataset, dealership_dataset, config)
    recorder.record_validation(report)
    _LOGGER.info(
        "Data quality: %s passed, %s critical failure(s), %s warning(s).",
        len(report.passed),
        len(report.critical_failures),
        len(report.warnings),
    )

    raw_files, sample_files = _write_all(config, datasets, output_dir)

    # The run must reach its terminal status BEFORE the database step, because the
    # database step is what writes audit.pipeline_run. Finishing afterwards left every
    # persisted run stuck at status 'running' with a null completed_at, even for runs
    # that succeeded, which in turn made reporting.vw_pipeline_run_summary report a
    # null duration for completed work. The terminal status depends only on the
    # validation report, and whether the load will be attempted is decided separately,
    # so both are known at this point.
    skip_reason = _load_skip_reason(config, load_database=load_database)
    run.finish(
        STATUS_FAILED if report.has_critical_failure else STATUS_SUCCEEDED,
        notes=(
            "database load skipped: " + skip_reason
            if skip_reason is not None
            else "database load completed"
        ),
    )
    _LOGGER.info("Finished %s with status %s.", run.pipeline_name, run.status)

    loaded, load_result = _load_if_possible(
        config, datasets, recorder, skip_reason=skip_reason, sql_root=sql_root
    )

    return FoundationRunResult(
        run=run,
        report=recorder.report,
        datasets=datasets,
        raw_files=raw_files,
        sample_files=sample_files,
        database_loaded=loaded,
        database_skip_reason=skip_reason,
        load_result=load_result,
        recorder=recorder,
    )


def _write_all(
    config: ArpiConfig,
    datasets: tuple[GeneratedDataset, ...],
    output_dir: Path | str | None,
) -> tuple[tuple[WrittenEntity, ...], tuple[WrittenEntity, ...]]:
    """Write the raw outputs and, when configured, the capped sample outputs."""
    raw_base = (
        output_dir if output_dir is not None else config.paths.raw_output_dir / config.profile
    )
    raw_dir = resolve_output_dir(raw_base, config)
    raw_files, raw_manifest = write_outputs(config, datasets, raw_dir)
    _LOGGER.info("Wrote raw outputs to %s (manifest %s).", raw_dir, raw_manifest.name)

    if not config.generation.write_sample_outputs:
        return raw_files, ()

    sample_dir = resolve_output_dir(config.paths.sample_output_dir, config)
    sample_files, sample_manifest = write_outputs(
        config, datasets, sample_dir, row_limit=config.generation.sample_row_limit
    )
    _LOGGER.info("Wrote sample outputs to %s (manifest %s).", sample_dir, sample_manifest.name)
    return raw_files, sample_files


def _load_skip_reason(config: ArpiConfig, *, load_database: bool | None) -> str | None:
    """Decide whether the database step will run.

    Args:
        config: The resolved configuration.
        load_database: An explicit override, or ``None`` to follow ``database.enabled``.

    Returns:
        ``None`` when the load should proceed, otherwise a human-readable reason the
        step is being skipped. Skipping is never a failure: the slice is designed to
        run without PostgreSQL.
    """
    wanted = config.database.enabled if load_database is None else load_database
    if not wanted:
        _LOGGER.info("Database load skipped: %s", SKIP_REASON_NOT_REQUESTED)
        return SKIP_REASON_NOT_REQUESTED

    if not database_available(config):
        reason = (
            "PostgreSQL is not reachable with the current configuration "
            f"(database.enabled={config.database.enabled}); see the INFO log above for "
            "the specific cause"
        )
        _LOGGER.warning("Database load skipped: %s", reason)
        return reason

    return None


def _load_if_possible(
    config: ArpiConfig,
    datasets: tuple[GeneratedDataset, ...],
    recorder: AuditRecorder,
    *,
    skip_reason: str | None,
    sql_root: Path,
) -> tuple[bool, LoadResult | None]:
    """Run the database step unless it was already decided to be skipped."""
    if skip_reason is not None:
        return False, None

    result = load_foundation(config, datasets, recorder, sql_root=sql_root)
    _LOGGER.info(
        "Database load complete: %s.",
        ", ".join(
            f"{entity}={count}" for entity, count in sorted(result.warehouse_row_counts.items())
        ),
    )
    return True, result
