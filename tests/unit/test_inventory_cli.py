"""The four Inventory Operations subcommands, at the CLI boundary.

What is checked here is the operator's experience, not the library's behaviour: that each
command exists with ``--help``, that its required options are required, that a dry run
writes nothing and still reports the intended file name, that a failure exits non-zero,
that ``--json`` produces something a script can read, and that no source identifier ever
reaches stdout or stderr.

The database-backed commands are exercised without a database on purpose. Their behaviour
when PostgreSQL is unreachable is part of the contract -- a clean message and exit code 1,
never a traceback -- and it is the state a first-time operator is most likely to hit.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from openpyxl import Workbook

from arpi.cli import build_parser, main
from arpi.inventory.cli import INVENTORY_COMMANDS, is_inventory_command

PRIVATE_HEADERS = (
    "Condition",
    "Year",
    "Make",
    "Model",
    "Trim",
    "Vehicle",
    "Mileage",
    "Price",
    "Price Status",
    "VIN",
    "Source URL",
    "Captured",
)

#: Invented. `.invalid` is the reserved TLD and resolves to nothing.
PRIVATE_ROWS: tuple[tuple[Any, ...], ...] = (
    (
        "New",
        2026,
        "Subaru",
        "Outback",
        "Premium",
        "2026 Subaru Outback Premium",
        6,
        34995,
        "Listed",
        "TESTVEHICLEID0001",
        "https://example.invalid/1",
        "2026-08-09",
    ),
    (
        "Used",
        2019,
        "Toyota",
        "RAV4",
        "XLE",
        "2019 Toyota RAV4 XLE",
        58210,
        22450,
        "Listed",
        "TESTVEHICLEID0003",
        "https://example.invalid/3",
        "2026-08-09",
    ),
)

EXPECTED_NAME = "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-09.xlsx"
CANONICAL = (
    Path(__file__).resolve().parents[2]
    / "data/reference/inventory/gsa-001/2026-08-02"
    / "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
)


@pytest.fixture
def private(tmp_path: Path) -> Path:
    path = tmp_path / "private" / "source.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    book = Workbook()
    # `Workbook.active` is Optional in the stubs because a workbook can have no
    # sheets. A freshly constructed one always has exactly one.
    sheet = book.active
    assert sheet is not None
    sheet.append(list(PRIVATE_HEADERS))
    for row in PRIVATE_ROWS:
        sheet.append(list(row))
    book.save(path)
    book.close()
    return path


# --------------------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------------------


def test_all_four_commands_are_registered() -> None:
    assert INVENTORY_COMMANDS == (
        "sanitize-inventory",
        "validate-inventory",
        "load-inventory",
        "export-inventory-report",
    )
    for command in INVENTORY_COMMANDS:
        assert is_inventory_command(command)
    assert not is_inventory_command("run-foundation")


@pytest.mark.parametrize("command", INVENTORY_COMMANDS)
def test_every_command_has_help(command: str, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main([command, "--help"])
    assert exit_info.value.code == 0
    rendered = capsys.readouterr().out
    assert command in rendered
    assert "--help" in rendered


@pytest.mark.parametrize("command", INVENTORY_COMMANDS)
def test_every_command_offers_a_machine_readable_summary(command: str) -> None:
    parser = build_parser()
    args = parser.parse_args([command, *_minimum_args(command)])
    assert hasattr(args, "as_json")


def _minimum_args(command: str) -> list[str]:
    if command == "sanitize-inventory":
        return ["--input", "x.xlsx", "--dealership-id", "GSA-001", "--captured-at", "2026-08-02"]
    if command == "validate-inventory":
        return ["--workbook", "x.xlsx"]
    if command == "load-inventory":
        return ["--workbook", "x.xlsx"]
    return ["--dealership-id", "GSA-001", "--captured-at", "2026-08-02"]


@pytest.mark.parametrize(
    ("command", "missing"),
    [
        ("sanitize-inventory", ["--dealership-id", "GSA-001"]),
        ("validate-inventory", []),
        ("load-inventory", []),
        ("export-inventory-report", ["--dealership-id", "GSA-001"]),
    ],
)
def test_a_missing_required_option_fails_the_parser(command: str, missing: list[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main([command, *missing])
    assert exit_info.value.code == 2


def test_an_invalid_date_is_rejected_with_a_usable_message(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit):
        main(["validate-inventory", "--workbook", "x.xlsx", "--captured-at", "02/08/2026"])
    assert "YYYY-MM-DD" in capsys.readouterr().err


# --------------------------------------------------------------------------------------
# sanitize-inventory
# --------------------------------------------------------------------------------------


def test_a_dry_run_writes_nothing_and_reports_the_intended_file_name(
    private: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    destination = tmp_path / "out" / EXPECTED_NAME
    code = main(
        [
            "sanitize-inventory",
            "--input",
            str(private),
            "--dealership-id",
            "GSA-002",
            "--captured-at",
            "2026-08-09",
            "--output",
            str(destination),
            "--dry-run",
        ]
    )
    assert code == 0
    assert not destination.exists()
    rendered = capsys.readouterr().out
    assert "dry run (nothing written)" in rendered
    assert EXPECTED_NAME in rendered
    assert "identifiers replaced: 2" in rendered


def test_sanitize_writes_the_artifact_and_reports_its_digest(
    private: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    destination = tmp_path / "out" / EXPECTED_NAME
    code = main(
        [
            "sanitize-inventory",
            "--input",
            str(private),
            "--dealership-id",
            "GSA-002",
            "--captured-at",
            "2026-08-09",
            "--output",
            str(destination),
        ]
    )
    assert code == 0
    assert destination.is_file()
    assert "sha256" in capsys.readouterr().out


def test_the_json_summary_parses_and_carries_no_source_value(
    private: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "sanitize-inventory",
            "--input",
            str(private),
            "--dealership-id",
            "GSA-002",
            "--captured-at",
            "2026-08-09",
            "--output",
            str(tmp_path / EXPECTED_NAME),
            "--json",
        ]
    )
    assert code == 0
    rendered = capsys.readouterr().out
    payload = json.loads(rendered)
    assert payload["output_file_name"] == EXPECTED_NAME
    assert payload["rows"] == len(PRIVATE_ROWS)
    assert payload["dealership_id"] == "GSA-002"
    for row in PRIVATE_ROWS:
        assert str(row[9]) not in rendered
    assert "example.invalid" not in rendered


def test_a_failing_sanitize_exits_non_zero_with_a_redacted_message(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "sanitize-inventory",
            "--input",
            str(tmp_path / "absent.xlsx"),
            "--dealership-id",
            "GSA-002",
            "--captured-at",
            "2026-08-09",
        ]
    )
    assert code == 1
    captured = capsys.readouterr()
    assert "ARPI error" in captured.err
    assert "Traceback" not in captured.err


def test_an_existing_output_is_refused_without_overwrite(
    private: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    destination = tmp_path / EXPECTED_NAME
    destination.write_bytes(b"existing")
    code = main(
        [
            "sanitize-inventory",
            "--input",
            str(private),
            "--dealership-id",
            "GSA-002",
            "--captured-at",
            "2026-08-09",
            "--output",
            str(destination),
        ]
    )
    assert code == 1
    assert "already exists" in capsys.readouterr().err
    assert destination.read_bytes() == b"existing"


# --------------------------------------------------------------------------------------
# validate-inventory
# --------------------------------------------------------------------------------------


def test_validate_passes_on_the_committed_artifact(capsys: pytest.CaptureFixture[str]) -> None:
    code = main(["validate-inventory", "--workbook", str(CANONICAL)])
    assert code == 0
    rendered = capsys.readouterr().out
    assert "result             : PASS" in rendered
    assert "inventory rows     : 199" in rendered


def test_validate_accepts_a_matching_expectation(capsys: pytest.CaptureFixture[str]) -> None:
    code = main(
        [
            "validate-inventory",
            "--workbook",
            str(CANONICAL),
            "--dealership-id",
            "GSA-001",
            "--captured-at",
            "2026-08-02",
        ]
    )
    assert code == 0
    assert "PASS" in capsys.readouterr().out


def test_validate_refuses_a_workbook_that_is_not_the_one_asked_for(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = main(
        [
            "validate-inventory",
            "--workbook",
            str(CANONICAL),
            "--dealership-id",
            "GSA-002",
        ]
    )
    assert code == 1
    rendered = capsys.readouterr()
    assert "GSA-002 was requested" in rendered.out
    assert "refused" in rendered.err


def test_the_validate_json_summary_lists_the_checks_it_ran(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = main(["validate-inventory", "--workbook", str(CANONICAL), "--json"])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["result"] == "PASS"
    assert payload["inventory_rows"] == 199
    assert payload["findings"] == []
    assert len(payload["checks_evaluated"]) == 14
    assert payload["path"].endswith("ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx")


def test_validate_on_a_missing_workbook_exits_one(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["validate-inventory", "--workbook", str(tmp_path / "absent.xlsx")])
    assert code == 1
    assert "Workbook not found" in capsys.readouterr().err


# --------------------------------------------------------------------------------------
# The database-backed commands, without a database
# --------------------------------------------------------------------------------------


def test_load_without_a_database_exits_one_with_a_clean_message(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = main(["load-inventory", "--workbook", str(CANONICAL)])
    assert code == 1
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert "database" in captured.err.casefold()


def test_export_without_a_database_exits_one_with_a_clean_message(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = main(
        [
            "export-inventory-report",
            "--dealership-id",
            "GSA-001",
            "--captured-at",
            "2026-08-02",
        ]
    )
    assert code == 1
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert "database" in captured.err.casefold()


def test_export_defaults_to_the_approved_report_name() -> None:
    """Checked at the parser, because the command cannot run without a database."""
    from arpi.inventory.identity import derived_report_file_name

    parser = build_parser()
    args = parser.parse_args(
        [
            "export-inventory-report",
            "--dealership-id",
            "GSA-001",
            "--captured-at",
            "2026-08-02",
        ]
    )
    assert args.output is None
    assert (
        derived_report_file_name(args.dealership_id, args.captured_at)
        == "ARPI_Granite_Chevrolet_Inventory_Report_2026-08-02.xlsx"
    )
    assert args.overwrite is True


def test_export_no_overwrite_flips_the_default() -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "export-inventory-report",
            "--dealership-id",
            "GSA-001",
            "--captured-at",
            "2026-08-02",
            "--no-overwrite",
        ]
    )
    assert args.overwrite is False


# --------------------------------------------------------------------------------------
# The script wrappers
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("module", "expected"),
    [
        ("sanitize_inventory_workbook", "sanitize-inventory"),
        ("validate_inventory_workbook", "validate-inventory"),
        ("import_inventory_snapshot", "load-inventory"),
        ("export_inventory_operating_report", "export-inventory-report"),
    ],
)
def test_every_script_wrapper_forwards_to_its_subcommand(module: str, expected: str) -> None:
    """One implementation, two ways to reach it, so the script and the CLI cannot drift."""
    source = (Path(__file__).resolve().parents[2] / "scripts" / f"{module}.py").read_text(
        encoding="utf-8"
    )
    assert f'main(["{expected}"' in source


def test_the_documented_chromebook_command_appears_in_its_script() -> None:
    source = (
        Path(__file__).resolve().parents[2] / "scripts" / "sanitize_inventory_workbook.py"
    ).read_text(encoding="utf-8")
    assert "--dealership-id GSA-001" in source
    assert "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx" in source
    assert "granite-chevrolet-inventory-sanitized.xlsx" not in source


def test_the_capture_date_argument_parses_an_iso_date() -> None:
    parser = build_parser()
    args = parser.parse_args(
        ["validate-inventory", "--workbook", "x", "--captured-at", "2026-08-02"]
    )
    assert args.captured_at == date(2026, 8, 2)
