"""The Phase 0 vertical slice."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from arpi.audit.run import STATUS_FAILED, STATUS_SUCCEEDED
from arpi.config import ArpiConfig, load_config
from arpi.constants import MANIFEST_FILENAME
from arpi.ingestion import database
from arpi.pipeline import SKIP_REASON_NOT_REQUESTED, run_foundation


@pytest.fixture
def slice_config(working_dir: Path, repo_config_dir: Path) -> ArpiConfig:
    """A ``test``-profile config resolved from a config copy inside a scratch cwd."""
    destination = working_dir / "config"
    destination.mkdir()
    for source in sorted(repo_config_dir.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    return load_config(profile="test", config_dir=destination)


def test_run_writes_raw_outputs(slice_config: ArpiConfig, working_dir: Path) -> None:
    result = run_foundation(slice_config, load_database=False)

    raw_dir = working_dir / "data" / "raw" / "test"
    assert (raw_dir / "dim_date.csv").is_file()
    assert (raw_dir / "dim_dealership.csv").is_file()
    assert (raw_dir / MANIFEST_FILENAME).is_file()
    assert {entity.entity for entity in result.raw_files} == {"dim_date", "dim_dealership"}


def test_test_profile_writes_no_sample_outputs(slice_config: ArpiConfig, working_dir: Path) -> None:
    result = run_foundation(slice_config, load_database=False)
    assert result.sample_files == ()
    assert not (working_dir / "data" / "sample").exists()


def test_development_profile_writes_capped_sample_outputs(
    working_dir: Path, repo_config_dir: Path
) -> None:
    destination = working_dir / "config"
    destination.mkdir()
    for source in sorted(repo_config_dir.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    config = load_config(
        profile="development",
        config_dir=destination,
        env={"ARPI_GENERATION__SAMPLE_ROW_LIMIT": "10"},
    )
    result = run_foundation(config, load_database=False)

    by_entity = {entity.entity: entity for entity in result.sample_files}
    assert by_entity["dim_date"].row_count == 10
    assert by_entity["dim_date"].truncated is True
    assert by_entity["dim_dealership"].row_count == 3
    assert by_entity["dim_dealership"].truncated is False
    assert (working_dir / "data" / "sample" / MANIFEST_FILENAME).is_file()


def test_output_dir_override(slice_config: ArpiConfig, working_dir: Path) -> None:
    result = run_foundation(slice_config, load_database=False, output_dir="custom/place")
    assert result.raw_files[0].path.parent == working_dir / "custom" / "place"


def test_run_records_the_audit_trail(slice_config: ArpiConfig) -> None:
    result = run_foundation(slice_config, load_database=False)
    rows = result.recorder.to_rows()
    assert len(rows["pipeline_run_row_count"]) == 2
    assert {row["layer"] for row in rows["pipeline_run_row_count"]} == {"source"}
    assert len(rows["validation_result"]) == 13
    assert rows["reconciliation_result"] == []
    assert result.run.status == STATUS_SUCCEEDED
    assert result.run.completed_at is not None


def test_run_succeeds_and_reports_no_critical_failures(slice_config: ArpiConfig) -> None:
    result = run_foundation(slice_config, load_database=False)
    assert result.succeeded is True
    assert not result.report.has_critical_failure
    assert len(result.report) == 13


def test_database_step_is_skipped_not_failed(slice_config: ArpiConfig) -> None:
    result = run_foundation(slice_config, load_database=False)
    assert result.database_loaded is False
    assert result.database_skip_reason == SKIP_REASON_NOT_REQUESTED
    assert result.load_result is None
    assert result.run.status == STATUS_SUCCEEDED
    assert "database load skipped" in (result.run.notes or "")


def test_database_defaults_to_the_config_flag(slice_config: ArpiConfig) -> None:
    result = run_foundation(slice_config)
    assert result.database_loaded is False
    assert result.database_skip_reason == SKIP_REASON_NOT_REQUESTED


def test_unreachable_database_is_skipped_with_a_reason(
    working_dir: Path, repo_config_dir: Path
) -> None:
    destination = working_dir / "config"
    destination.mkdir()
    for source in sorted(repo_config_dir.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    config = load_config(
        profile="test",
        config_dir=destination,
        env={
            "ARPI_DATABASE__ENABLED": "true",
            "ARPI_DATABASE__HOST": "127.0.0.1",
            "ARPI_DATABASE__PORT": "1",
            "ARPI_DATABASE__NAME": "absent",
            "ARPI_DATABASE__USER": "arpi_loader",
            "ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS": "1",
        },
    )
    result = run_foundation(config, load_database=True)
    assert result.database_loaded is False
    assert "not reachable" in (result.database_skip_reason or "")
    assert result.run.status == STATUS_SUCCEEDED


def test_missing_psycopg_is_skipped_not_failed(
    slice_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(database, "PSYCOPG_AVAILABLE", False)
    result = run_foundation(slice_config, load_database=True)
    assert result.database_loaded is False
    assert result.run.status == STATUS_SUCCEEDED


def test_critical_failure_marks_the_run_failed(
    slice_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    from arpi.validation.results import CheckResult, ValidationReport

    failing = ValidationReport(
        (
            CheckResult(
                check_id="DQ-DATE-001", check_name="forced", target_object="dim_date"
            ).failed("forced failure"),
        )
    )
    monkeypatch.setattr(
        "arpi.pipeline.validate_foundation_datasets", lambda *args, **kwargs: failing
    )
    result = run_foundation(slice_config, load_database=False)
    assert result.succeeded is False
    assert result.run.status == STATUS_FAILED
    assert result.run.critical_failure_count == 1


def test_summary_is_human_readable(slice_config: ArpiConfig) -> None:
    summary = run_foundation(slice_config, load_database=False).summary()
    assert "ARPI Phase 0 foundation run" in summary
    assert "profile              : test" in summary
    assert "dim_date" in summary
    assert "dim_dealership" in summary
    assert "skipped" in summary
    assert "skipped is not a failure" in summary
    assert "SYNTHETIC DATA" in summary
    assert "DQ-DATE-001" in summary


def test_summary_reports_a_completed_load(
    slice_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import uuid

    from arpi.audit.run import ReconciliationResult
    from arpi.ingestion.loader import LoadResult

    script = tmp_path / "10_dim_date_merge.sql"
    script.write_text("-- merge", encoding="utf-8")
    fake = LoadResult(
        load_batch_id=uuid.UUID("11111111-2222-3333-4444-555555555555"),
        raw_row_counts={"dim_date": 59},
        warehouse_row_counts={"dim_date": 59},
        executed_sql=(script,),
    )

    monkeypatch.setattr("arpi.pipeline.database_available", lambda config: True)

    def _fake_load(config, datasets, recorder, *, sql_root):  # type: ignore[no-untyped-def]
        recorder.record_reconciliation(
            ReconciliationResult("RECON-DIM-DATE-ROWCOUNT", "d", "gen", 59.0, "db", 59.0)
        )
        return fake

    monkeypatch.setattr("arpi.pipeline.load_foundation", _fake_load)

    result = run_foundation(slice_config, load_database=True)
    summary = result.summary()
    assert result.database_loaded is True
    assert "loaded    : yes" in summary
    assert "warehouse : dim_date = 59 row(s)" in summary
    assert "10_dim_date_merge.sql" in summary
    assert "RECON-DIM-DATE-ROWCOUNT" in summary
    assert result.run.notes == "database load completed"
