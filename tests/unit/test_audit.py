"""Deterministic run identifiers and in-memory audit recording."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest

from arpi.audit.run import (
    LAYER_RAW,
    LAYER_SOURCE,
    LAYER_WAREHOUSE,
    STATUS_RUNNING,
    STATUS_SUCCEEDED,
    AuditRecorder,
    PipelineRun,
    ReconciliationResult,
    RowCount,
    build_run_uuid,
)
from arpi.config import ArpiConfig
from arpi.constants import ARPI_VERSION, PIPELINE_NAME_FOUNDATION
from arpi.exceptions import ValidationError
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

ARGS: dict[str, Any] = {
    "check_id": "DQ-TEST-001",
    "check_name": "demo",
    "target_object": "demo_entity",
}


def _run(config: ArpiConfig) -> PipelineRun:
    return PipelineRun.start(config, pipeline_name=PIPELINE_NAME_FOUNDATION, run_mode="test")


def test_run_uuid_is_deterministic() -> None:
    args = ("phase0_foundation", "test", 424242, date(2025, 1, 1), date(2025, 2, 28))
    assert build_run_uuid(*args) == build_run_uuid(*args)
    assert isinstance(build_run_uuid(*args), uuid.UUID)
    assert build_run_uuid(*args).version == 5


@pytest.mark.parametrize(
    "changed",
    [
        ("other_pipeline", "test", 424242, date(2025, 1, 1), date(2025, 2, 28)),
        ("phase0_foundation", "development", 424242, date(2025, 1, 1), date(2025, 2, 28)),
        ("phase0_foundation", "test", 1, date(2025, 1, 1), date(2025, 2, 28)),
        ("phase0_foundation", "test", 424242, date(2025, 1, 2), date(2025, 2, 28)),
        ("phase0_foundation", "test", 424242, date(2025, 1, 1), date(2025, 3, 1)),
    ],
)
def test_run_uuid_changes_with_every_input(changed: tuple[object, ...]) -> None:
    baseline = build_run_uuid(
        "phase0_foundation", "test", 424242, date(2025, 1, 1), date(2025, 2, 28)
    )
    assert build_run_uuid(*changed) != baseline  # type: ignore[arg-type]


def test_run_starts_in_the_running_state(test_config: ArpiConfig) -> None:
    run = _run(test_config)
    assert run.status == STATUS_RUNNING
    assert run.completed_at is None
    assert run.arpi_version == ARPI_VERSION
    assert run.profile_name == "test"
    assert run.random_seed == 424242


def test_run_uuid_is_reproducible_across_runs(test_config: ArpiConfig) -> None:
    assert _run(test_config).run_uuid == _run(test_config).run_uuid


def test_finish_sets_status_and_completion(test_config: ArpiConfig) -> None:
    run = _run(test_config)
    run.finish(STATUS_SUCCEEDED, notes="all good")
    assert run.status == STATUS_SUCCEEDED
    assert run.completed_at is not None
    assert run.notes == "all good"


def test_finish_rejects_an_unknown_status(test_config: ArpiConfig) -> None:
    with pytest.raises(ValidationError, match="status must be"):
        _run(test_config).finish("exploded")


def test_run_audit_row_shape(test_config: ArpiConfig) -> None:
    row = _run(test_config).as_audit_row()
    assert set(row) == {
        "run_uuid",
        "pipeline_name",
        "profile_name",
        "run_mode",
        "random_seed",
        "arpi_version",
        "started_at",
        "completed_at",
        "status",
        "critical_failure_count",
        "warning_count",
        "notes",
    }
    assert isinstance(row["run_uuid"], str)


def test_recorder_collects_row_counts(test_config: ArpiConfig) -> None:
    recorder = AuditRecorder(run=_run(test_config))
    recorder.record_row_count("dim_date", LAYER_SOURCE, 59)
    recorder.record_row_count("dim_date", LAYER_RAW, 59)
    recorder.record_row_count("dim_date", LAYER_WAREHOUSE, 59)
    assert [row.layer for row in recorder.row_counts] == ["source", "raw", "warehouse"]
    assert recorder.row_counts[0] == RowCount("dim_date", "source", 59)


def test_recorder_rejects_an_unknown_layer(test_config: ArpiConfig) -> None:
    with pytest.raises(ValidationError, match="layer must be"):
        AuditRecorder(run=_run(test_config)).record_row_count("dim_date", "mezzanine", 1)


def test_recorder_rejects_a_negative_row_count(test_config: ArpiConfig) -> None:
    with pytest.raises(ValidationError, match="non-negative"):
        AuditRecorder(run=_run(test_config)).record_row_count("dim_date", LAYER_RAW, -1)


def test_recorder_updates_failure_tallies(test_config: ArpiConfig) -> None:
    recorder = AuditRecorder(run=_run(test_config))
    recorder.record_validation(
        ValidationReport(
            (
                CheckResult(**ARGS),
                CheckResult(**ARGS).failed("boom"),
                CheckResult(**ARGS, severity=CheckSeverity.WARNING).failed("meh"),
            )
        )
    )
    assert recorder.run.critical_failure_count == 1
    assert recorder.run.warning_count == 1
    assert len(recorder.report) == 3


def test_recorder_tallies_accumulate_across_reports(test_config: ArpiConfig) -> None:
    recorder = AuditRecorder(run=_run(test_config))
    failing = ValidationReport((CheckResult(**ARGS).failed("boom"),))
    recorder.record_validation(failing)
    recorder.record_validation(failing)
    assert recorder.run.critical_failure_count == 2


def test_reconciliation_status_and_difference() -> None:
    matched = ReconciliationResult("R-1", "counts", "gen", 59.0, "db", 59.0)
    assert matched.difference == 0
    assert matched.status == "passed"

    mismatched = ReconciliationResult("R-1", "counts", "gen", 59.0, "db", 58.0)
    assert mismatched.difference == pytest.approx(1.0)
    assert mismatched.status == "failed"

    tolerant = ReconciliationResult("R-1", "counts", "gen", 59.0, "db", 58.0, tolerance=1.0)
    assert tolerant.status == "passed"


def test_reconciliation_audit_row_omits_the_generated_column() -> None:
    row = ReconciliationResult("R-1", "counts", "gen", 1.0, "db", 1.0).as_audit_row()
    assert "difference" not in row
    assert row["status"] == "passed"


def test_to_rows_shape(test_config: ArpiConfig) -> None:
    recorder = AuditRecorder(run=_run(test_config))
    recorder.record_row_count("dim_date", LAYER_SOURCE, 59)
    recorder.record_validation(ValidationReport((CheckResult(**ARGS),)))
    recorder.record_reconciliation(ReconciliationResult("R-1", "d", "gen", 1.0, "db", 1.0))

    rows = recorder.to_rows()
    assert set(rows) == {
        "pipeline_run",
        "pipeline_run_row_count",
        "validation_result",
        "reconciliation_result",
        "rejected_record",
    }
    assert len(rows["pipeline_run"]) == 1
    assert len(rows["pipeline_run_row_count"]) == 1
    assert len(rows["validation_result"]) == 1
    assert len(rows["reconciliation_result"]) == 1
    assert rows["rejected_record"] == []
