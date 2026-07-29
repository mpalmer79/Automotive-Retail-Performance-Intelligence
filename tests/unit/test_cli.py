"""CLI argument parsing, output and exit codes."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from arpi import cli
from arpi.cli import EXIT_CONFIG_ERROR, EXIT_FAILURE, EXIT_OK, build_parser, main
from arpi.constants import ARPI_VERSION, MANIFEST_FILENAME
from arpi.exceptions import GenerationError


@pytest.fixture
def cli_workspace(working_dir: Path, repo_config_dir: Path) -> Path:
    """An empty working directory holding a copy of the profile YAML files."""
    destination = working_dir / "config"
    destination.mkdir()
    for source in sorted(repo_config_dir.glob("*.yaml")):
        shutil.copy2(source, destination / source.name)
    return working_dir


def test_parser_requires_a_subcommand() -> None:
    with pytest.raises(SystemExit) as excinfo:
        build_parser().parse_args([])
    assert excinfo.value.code == 2


def test_parser_rejects_an_unknown_profile() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["generate", "--profile", "staging"])


def test_load_database_flags_are_mutually_exclusive() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["run-foundation", "--load-database", "--no-load-database"])


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["run-foundation"], None),
        (["run-foundation", "--load-database"], True),
        (["run-foundation", "--no-load-database"], False),
    ],
)
def test_load_database_tri_state(argv: list[str], expected: bool | None) -> None:
    assert build_parser().parse_args(argv).load_database is expected


def test_version_command(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["version"]) == EXIT_OK
    assert ARPI_VERSION in capsys.readouterr().out


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["--version"])
    assert excinfo.value.code == EXIT_OK
    assert ARPI_VERSION in capsys.readouterr().out


def test_check_config_prints_the_redacted_configuration(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ARPI_DATABASE__PASSWORD", "s3cret")
    assert main(["check-config", "--profile", "test"]) == EXIT_OK
    out = capsys.readouterr().out
    assert "profile: test" in out
    assert "***REDACTED***" in out
    assert "s3cret" not in out
    assert "Database reachable : no" in out


def test_check_config_renders_yaml_style_scalars(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    main(["check-config", "--profile", "test"])
    out = capsys.readouterr().out
    assert "enabled: false" in out
    assert "host: null" in out


def test_check_config_with_an_unknown_profile_exits_two(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["check-config", "--config-dir", str(cli_workspace / "nope")]) == (
        EXIT_CONFIG_ERROR
    )
    assert "ARPI error" in capsys.readouterr().err


def test_invalid_configuration_exits_two(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = cli_workspace / "config" / "test.yaml"
    path.write_text(
        path.read_text(encoding="utf-8").replace("store_count: 3", "store_count: 9"),
        encoding="utf-8",
    )
    assert main(["generate", "--profile", "test"]) == EXIT_CONFIG_ERROR
    assert "store_count" in capsys.readouterr().err


def test_generate_writes_files_and_exits_zero(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["generate", "--profile", "test"]) == EXIT_OK
    out = capsys.readouterr().out
    assert "Wrote 2 entity CSV(s)" in out
    assert "DQ-DATE-001" in out
    raw_dir = cli_workspace / "data" / "raw" / "test"
    assert (raw_dir / "dim_date.csv").is_file()
    assert (raw_dir / MANIFEST_FILENAME).is_file()


def test_generate_honours_output_dir(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["generate", "--profile", "test", "--output-dir", "elsewhere"]) == EXIT_OK
    assert (cli_workspace / "elsewhere" / "dim_date.csv").is_file()
    capsys.readouterr()


def test_generate_writes_samples_for_the_development_profile(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["generate", "--profile", "development"]) == EXIT_OK
    assert "sample CSV(s)" in capsys.readouterr().out
    assert (cli_workspace / "data" / "sample" / "dim_date.csv").is_file()


def test_generate_rejects_a_traversing_output_dir(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["generate", "--profile", "test", "--output-dir", "../escape"]) == (
        EXIT_CONFIG_ERROR
    )
    assert "path traversal" in capsys.readouterr().err


def test_generate_exits_one_on_a_critical_failure(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from arpi.validation.results import CheckResult, ValidationReport

    failing = ValidationReport(
        (
            CheckResult(
                check_id="DQ-DATE-001", check_name="forced", target_object="dim_date"
            ).failed("forced failure"),
        )
    )
    monkeypatch.setattr("arpi.cli.validate_foundation_datasets", lambda *a, **k: failing)
    assert main(["generate", "--profile", "test"]) == EXIT_FAILURE
    assert "critical data-quality check(s) failed" in capsys.readouterr().err


def test_run_foundation_prints_the_summary(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["run-foundation", "--profile", "test", "--no-load-database"]) == EXIT_OK
    out = capsys.readouterr().out
    assert "ARPI Phase 0 foundation run" in out
    assert "Database load" in out
    assert "skipped" in out


def test_run_foundation_exits_one_on_a_critical_failure(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from arpi.validation.results import CheckResult, ValidationReport

    failing = ValidationReport(
        (
            CheckResult(
                check_id="DQ-DATE-001", check_name="forced", target_object="dim_date"
            ).failed("forced failure"),
        )
    )
    monkeypatch.setattr("arpi.pipeline.validate_all_datasets", lambda *a, **k: failing)
    assert main(["run-foundation", "--profile", "test", "--no-load-database"]) == EXIT_FAILURE
    assert "critical data-quality check(s) failed" in capsys.readouterr().err


def test_log_level_override_is_applied(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["check-config", "--profile", "test", "--log-level", "DEBUG"]) == EXIT_OK
    assert "level: DEBUG" in capsys.readouterr().out


def test_arpi_errors_become_a_clean_message(
    cli_workspace: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(config: object) -> None:
        raise GenerationError("generator exploded", entity="dim_date")

    monkeypatch.setattr("arpi.cli.generate_date_dataset", _boom)
    assert main(["generate", "--profile", "test"]) == EXIT_FAILURE
    captured = capsys.readouterr()
    assert "ARPI error: generator exploded" in captured.err
    assert "Traceback" not in captured.err


def test_unexpected_errors_still_raise(
    cli_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(config: object) -> None:
        raise RuntimeError("unexpected")

    monkeypatch.setattr("arpi.cli.generate_date_dataset", _boom)
    with pytest.raises(RuntimeError, match="unexpected"):
        main(["generate", "--profile", "test"])


def test_emit_writes_to_stdout(capsys: pytest.CaptureFixture[str]) -> None:
    cli.emit("hello")
    cli.emit()
    captured = capsys.readouterr()
    assert captured.out == "hello\n\n"
    assert captured.err == ""


def test_emit_error_writes_to_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    cli.emit_error("bad")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "ARPI error: bad" in captured.err


def test_module_entry_point_is_wired() -> None:
    import importlib

    entry = importlib.import_module("arpi.__main__")
    assert entry.main is main
