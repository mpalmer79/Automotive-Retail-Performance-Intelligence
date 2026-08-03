"""``scripts/check_reference_data.py``: the CI governance gate for the reference lane.

Every rule here has to fail on a repository that has the defect and stay silent on one
that does not, and both directions matter equally: a check that cannot fire is decoration,
and a check that fires on correct code teaches people to ignore it.

The rules are exercised against **fabricated repositories** in ``tmp_path`` rather than
against the real one, so a test can build the exact defect it is about. The one test that
uses the real repository asserts the outcome that actually matters: it passes today.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest
from openpyxl import Workbook

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import check_reference_data  # noqa: E402  (path set above)

CANONICAL_NAME = "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
CANONICAL_PATH = f"data/reference/inventory/gsa-001/2026-08-02/{CANONICAL_NAME}"


# --------------------------------------------------------------------------------------
# Against the real repository
# --------------------------------------------------------------------------------------


def test_the_real_repository_passes_every_rule() -> None:
    violations = check_reference_data.run()
    rendered = "\n".join(v.render() for v in violations)
    assert violations == [], rendered


def test_the_check_is_standard_library_only() -> None:
    """It runs in the repository-checks CI job on a bare interpreter."""
    source = (SCRIPTS / "check_reference_data.py").read_text(encoding="utf-8")
    forbidden = ("import yaml", "import openpyxl", "import pandas", "from arpi")
    for token in forbidden:
        assert token not in source, f"{token} would break the bare-interpreter CI job"


# --------------------------------------------------------------------------------------
# The contract reader
# --------------------------------------------------------------------------------------


def test_the_contract_reader_finds_the_declared_artifact_and_both_regexes() -> None:
    artifacts, sanitized_regex, report_regex = check_reference_data.read_contract_facts(
        check_reference_data.CONTRACT_PATH
    )
    assert [a["dealership_id"] for a in artifacts] == ["GSA-001", "GSA-002", "GSA-003"]
    assert artifacts[0]["file_name"] == CANONICAL_NAME
    assert artifacts[0]["path"] == CANONICAL_PATH
    assert artifacts[0]["row_count"] == "199"
    # The small parser must read a multi-entry list, not just the first one. It is a
    # hand-written line scanner, and "works on a list of one" is the shape of bug that
    # would have gone unnoticed until the day a second store was declared.
    assert artifacts[1]["path"].startswith("data/reference/inventory/gsa-002/")
    assert artifacts[2]["path"].startswith("data/reference/inventory/gsa-003/")
    # Both regexes must have survived the small parser intact, including the
    # backslash escapes -- which is exactly what single-quoting them protects.
    import re

    assert re.compile(sanitized_regex).match(CANONICAL_NAME)
    assert re.compile(report_regex).match("ARPI_Granite_Chevrolet_Inventory_Report_2026-08-02.xlsx")
    assert not re.compile(sanitized_regex).match("granite-chevrolet-inventory-sanitized.xlsx")


def test_the_two_parsers_agree_about_the_contract() -> None:
    """PyYAML in the application, a line scanner in CI. They must read the same file.

    This is the failure the single-quoted regexes were introduced to prevent: a
    double-quoted YAML scalar needs backslash unescaping the small parser does not do,
    and the two would then compile different patterns while both looked correct.
    """
    from arpi.inventory.contract import load_contract

    contract = load_contract()
    artifacts, sanitized_regex, report_regex = check_reference_data.read_contract_facts(
        check_reference_data.CONTRACT_PATH
    )
    assert sanitized_regex == contract.sanitized_regex.pattern
    assert report_regex == contract.report_regex.pattern
    assert [a["file_name"] for a in artifacts] == [
        artifact.file_name for artifact in contract.canonical_artifacts
    ]


# --------------------------------------------------------------------------------------
# Individual rules, against fabricated repositories
# --------------------------------------------------------------------------------------


def _workbook(
    path: Path, *, classification: str = "Sanitized public reference data", extra: str | None = None
) -> Path:
    """Write a minimal workbook carrying the values the content rules inspect."""
    path.parent.mkdir(parents=True, exist_ok=True)
    book = Workbook()
    # `Workbook.active` is Optional in the stubs because a workbook can have no
    # sheets. A freshly constructed one always has exactly one.
    sheet = book.active
    assert sheet is not None
    sheet.title = "Inventory"
    sheet.append(["Data Classification"])
    sheet.append([classification])
    if extra is not None:
        sheet.append([extra])
    book.save(path)
    book.close()
    return path


@pytest.fixture
def fake_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A repository with one correctly named, correctly declared artifact."""
    reference = tmp_path / "data" / "reference" / "inventory" / "gsa-001" / "2026-08-02"
    workbook = _workbook(reference / CANONICAL_NAME)
    digest = check_reference_data.file_digest(workbook)

    contract = tmp_path / "config" / "reference" / "inventory_listing_contract.yaml"
    contract.parent.mkdir(parents=True, exist_ok=True)
    contract.write_text(
        "naming:\n"
        "  sanitized_regex: "
        r"'^ARPI_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_Inventory_Sanitized_\d{4}-\d{2}-\d{2}\.xlsx$'"
        "\n"
        "  report_regex: "
        r"'^ARPI_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_Inventory_Report_\d{4}-\d{2}-\d{2}\.xlsx$'"
        "\n"
        "  store_descriptors:\n"
        "    GSA-001: Granite_Chevrolet\n"
        "    GSA-002: Granite_Subaru\n"
        "    GSA-003: Granite_Pre_Owned_Center\n"
        "canonical_artifacts:\n"
        "  - dealership_id: GSA-001\n"
        '    captured_at: "2026-08-02"\n'
        f"    file_name: {CANONICAL_NAME}\n"
        f"    path: {CANONICAL_PATH}\n"
        "    row_count: 199\n"
        f"    sha256: {digest}\n",
        encoding="utf-8",
    )

    policy = tmp_path / "data" / "reference" / "README.md"
    policy.write_text(f"The canonical artifact is {CANONICAL_NAME}.\n", encoding="utf-8")

    monkeypatch.setattr(check_reference_data, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_reference_data, "CONTRACT_PATH", contract)
    monkeypatch.setattr(check_reference_data, "REFERENCE_ROOT", tmp_path / "data" / "reference")
    monkeypatch.setattr(check_reference_data, "SAMPLE_ROOT", tmp_path / "data" / "sample")
    return tmp_path


def _rules(fake_repo: Path) -> list[str]:
    return [violation.rule for violation in check_reference_data.run()]


def test_a_correct_repository_produces_no_violation(fake_repo: Path) -> None:
    assert _rules(fake_repo) == []


def test_a_hyphenated_workbook_name_is_caught(fake_repo: Path) -> None:
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-002/2026-08-09"
        / "granite-subaru-inventory-sanitized.xlsx"
    )
    assert "canonical-filename" in _rules(fake_repo)
    assert "undeclared-artifact" in _rules(fake_repo)


def test_a_second_workbook_in_one_snapshot_directory_is_caught(fake_repo: Path) -> None:
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-001/2026-08-02"
        / "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-03.xlsx"
    )
    assert "duplicate-artifact" in _rules(fake_repo)


def test_a_second_copy_of_the_canonical_file_elsewhere_is_caught(fake_repo: Path) -> None:
    """The exact defect that existed at the repository root before this increment."""
    shutil.copy(fake_repo / CANONICAL_PATH, fake_repo / CANONICAL_NAME)
    assert "duplicate-artifact" in _rules(fake_repo)


def test_an_alias_differing_only_in_hyphenation_is_caught(fake_repo: Path) -> None:
    _workbook(fake_repo / "arpi-granite-chevrolet-inventory-sanitized-2026-08-02.xlsx")
    assert "duplicate-artifact" in _rules(fake_repo)


def test_a_workbook_filed_under_another_store_is_caught(fake_repo: Path) -> None:
    """The exact mistake: three captures uploaded into one store's directory.

    Filed alone, so the duplicate rule cannot be what catches it. The directory is part of
    the artifact's identity and this is the rule that says so.
    """
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-001/2026-08-02"
        / "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-02.xlsx"
    )
    assert "artifact-misfiled" in _rules(fake_repo)


def test_a_used_auto_workbook_belongs_under_gsa_003(fake_repo: Path) -> None:
    misfiled = (
        fake_repo
        / "data/reference/inventory/gsa-001/2026-08-02"
        / "ARPI_Granite_Pre_Owned_Center_Inventory_Sanitized_2026-08-02.xlsx"
    )
    _workbook(misfiled)
    findings = [v for v in check_reference_data.run() if v.rule == "artifact-misfiled"]
    assert findings
    assert "gsa-003" in findings[0].message

    # Filed correctly, the rule is silent -- it is about the directory, not the name.
    misfiled.unlink()
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-003/2026-08-02"
        / "ARPI_Granite_Pre_Owned_Center_Inventory_Sanitized_2026-08-02.xlsx"
    )
    assert "artifact-misfiled" not in _rules(fake_repo)


def test_a_file_name_date_that_disagrees_with_its_directory_is_caught(
    fake_repo: Path,
) -> None:
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-002/2026-08-09"
        / "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-02.xlsx"
    )
    findings = [v for v in check_reference_data.run() if v.rule == "artifact-misfiled"]
    assert findings
    assert "the same fact and must agree" in findings[0].message


def test_an_unknown_store_descriptor_is_caught(fake_repo: Path) -> None:
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-004/2026-08-02"
        / "ARPI_Granite_Honda_Inventory_Sanitized_2026-08-02.xlsx"
    )
    assert "artifact-misfiled" in _rules(fake_repo)


def test_the_three_store_descriptors_are_the_ones_the_paths_use() -> None:
    """Read from the real contract, so a rename cannot leave this test agreeing with itself."""
    descriptors = check_reference_data.store_descriptors(check_reference_data.CONTRACT_PATH)
    assert descriptors == {
        "GSA-001": "Granite_Chevrolet",
        "GSA-002": "Granite_Subaru",
        "GSA-003": "Granite_Pre_Owned_Center",
    }


def test_a_missing_declared_artifact_is_caught(fake_repo: Path) -> None:
    (fake_repo / CANONICAL_PATH).unlink()
    assert "missing-artifact" in _rules(fake_repo)


def test_a_replaced_artifact_is_caught_by_its_digest(fake_repo: Path) -> None:
    _workbook(fake_repo / CANONICAL_PATH, extra="changed")
    assert "artifact-digest" in _rules(fake_repo)


def test_a_workbook_under_data_sample_is_caught(fake_repo: Path) -> None:
    _workbook(fake_repo / "data" / "sample" / "something.xlsx")
    assert "sample-is-synthetic-only" in _rules(fake_repo)


def test_a_url_inside_a_committed_artifact_is_caught(fake_repo: Path) -> None:
    _workbook(fake_repo / CANONICAL_PATH, extra="https://example.invalid/listing/1")
    rules = _rules(fake_repo)
    assert "artifact-url" in rules


def test_a_real_vin_inside_a_committed_artifact_is_caught(fake_repo: Path) -> None:
    _workbook(fake_repo / CANONICAL_PATH, extra="1GCUYDED5NZ123456")
    assert "artifact-real-vin" in _rules(fake_repo)


def test_a_real_vin_embedded_in_a_longer_cell_is_still_caught(fake_repo: Path) -> None:
    """The rule is a search, not a full match, and it has to stay one.

    The runtime validator full-matches a trimmed cell, which is right for a workbook the
    sanitizer wrote. This check exists for the workbook it did not, where an identifier
    can arrive inside a sentence.
    """
    _workbook(fake_repo / CANONICAL_PATH, extra="Stock VIN 1GCUYDED5NZ123456 (source)")
    assert "artifact-real-vin" in _rules(fake_repo)


@pytest.mark.parametrize(
    ("value", "why"),
    [
        ("9.99999999999999999", "a float rendered at full precision"),
        ("0.12345678901234567", "a ratio rendered at full precision"),
        ("12345678901234567", "seventeen digits, which is a number and not a VIN"),
        ("ARPI16E677B741223", "an ARPI identity, which contains I"),
        ("1GCUYDED5NZ1234567", "eighteen characters"),
    ],
)
def test_a_value_that_only_looks_like_a_vin_is_not_reported(
    fake_repo: Path, value: str, why: str
) -> None:
    """Every one of these was a false positive, or would have been.

    The first is not hypothetical: ``9.99999999999999999`` on a Model Summary sheet was
    reported as a real VIN in a committed artifact, because a word boundary sits at a
    decimal point and offered seventeen digits with one at each end.

    A privacy check that cries wolf is worse than one that is merely noisy. This rule
    refuses a commit, so a false positive teaches the next person to reach for an
    override -- and the override is what will be reached for on the day the finding is
    real.
    """
    _workbook(fake_repo / CANONICAL_PATH, extra=value)
    assert "artifact-real-vin" not in _rules(fake_repo), why


def test_a_missing_classification_is_caught(fake_repo: Path) -> None:
    _workbook(fake_repo / CANONICAL_PATH, classification="Fully synthetic data")
    assert "artifact-classification" in _rules(fake_repo)


def test_a_hyphenated_filename_in_documentation_is_caught(fake_repo: Path) -> None:
    doc = fake_repo / "docs" / "guide.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(
        "Commit the inventory workbook as granite-chevrolet-inventory-sanitized.xlsx.\n",
        encoding="utf-8",
    )
    assert "canonical-filename" in _rules(fake_repo)


@pytest.mark.parametrize(
    ("claim", "rule"),
    [
        (
            "The inventory reference workbook is fully synthetic.",
            "reference-data-is-not-synthetic",
        ),
        (
            "A removed listing means the inventory unit was sold.",
            "removed-is-not-sold",
        ),
        (
            "For inventory, days observed online is days in stock.",
            "days-observed-is-not-days-in-stock",
        ),
    ],
)
def test_a_prohibited_documentation_claim_is_caught(fake_repo: Path, claim: str, rule: str) -> None:
    doc = fake_repo / "docs" / "claims.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(claim + "\n", encoding="utf-8")
    assert rule in _rules(fake_repo)


@pytest.mark.parametrize(
    "correct",
    [
        "The inventory reference workbook is not fully synthetic.",
        "A removed inventory listing is never sold; it may be a trade or a wholesale.",
        "For inventory, days observed online is not days in stock.",
        "Removed From Listing must never be labelled sold in an inventory report.",
    ],
)
def test_the_correct_statement_of_the_same_rule_is_not_caught(
    fake_repo: Path, correct: str
) -> None:
    """A check that fires on the sentence forbidding the defect teaches people to ignore it."""
    doc = fake_repo / "docs" / "claims.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(correct + "\n", encoding="utf-8")
    assert _rules(fake_repo) == []


def test_a_declared_legacy_hint_is_exempt_only_for_its_own_artifact(fake_repo: Path) -> None:
    """The one reviewed deviation, keyed to a digest so it cannot spread."""
    hint = "data/reference/inventory/gsa-001/2026-08-02/granite-chevrolet-inventory-sanitized.xlsx"
    workbook = _workbook(fake_repo / CANONICAL_PATH, extra=hint)
    digest = check_reference_data.file_digest(workbook)

    contract = check_reference_data.CONTRACT_PATH
    text = contract.read_text(encoding="utf-8")
    text = text.replace(f"sha256: {text.split('sha256: ')[1].strip()}", f"sha256: {digest}")
    contract.write_text(text + f"    legacy_path_hint: {hint}\n", encoding="utf-8")

    assert _rules(fake_repo) == []

    # The same hint in a SECOND workbook, which has no declaration, is still caught.
    _workbook(
        fake_repo
        / "data/reference/inventory/gsa-002/2026-08-09"
        / "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-09.xlsx",
        extra=hint,
    )
    assert "undeclared-artifact" in _rules(fake_repo)


def test_the_exit_code_is_one_when_a_rule_fails(
    fake_repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _workbook(fake_repo / "data" / "sample" / "smuggled.xlsx")
    assert check_reference_data.main([]) == 1
    assert "violation" in capsys.readouterr().err


def test_the_exit_code_is_zero_and_quiet_prints_nothing(
    fake_repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert check_reference_data.main(["--quiet"]) == 0
    assert capsys.readouterr().out == ""


def test_a_violation_renders_a_path_and_never_a_value(fake_repo: Path) -> None:
    _workbook(fake_repo / CANONICAL_PATH, extra="https://example.invalid/listing/1")
    rendered = "\n".join(v.render() for v in check_reference_data.run())
    assert "example.invalid" not in rendered
    assert CANONICAL_PATH in rendered


def test_the_declared_artifact_count_is_reported_when_the_contract_is_empty(
    fake_repo: Path,
) -> None:
    check_reference_data.CONTRACT_PATH.write_text("naming:\n  sanitized_regex: 'x'\n", "utf-8")
    assert "contract-empty" in _rules(fake_repo)


def test_a_missing_contract_is_reported_rather_than_ignored(
    fake_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(check_reference_data, "CONTRACT_PATH", fake_repo / "absent.yaml")
    assert _rules(fake_repo) == ["contract-missing"]


# --------------------------------------------------------------------------------------
# The workbook reader
# --------------------------------------------------------------------------------------


def test_the_zip_reader_finds_the_strings_openpyxl_would(tmp_path: Path) -> None:
    """It reads XLSX as a ZIP of XML because openpyxl is not installed in that CI job."""
    path = _workbook(tmp_path / "book.xlsx", extra="a distinctive value")
    strings = check_reference_data.workbook_strings(path)
    assert "Sanitized public reference data" in strings
    assert "a distinctive value" in strings


def test_an_unreadable_workbook_is_reported_rather_than_skipped(fake_repo: Path) -> None:
    (fake_repo / CANONICAL_PATH).write_bytes(b"not a zip archive")
    assert "artifact-unreadable" in _rules(fake_repo)


def test_the_portfolio_manifest_is_not_confused_for_a_reference_artifact() -> None:
    """A sanity check on scope: the rules must not sweep in unrelated JSON or XLSX."""
    manifest = REPO_ROOT / "portfolio" / "src" / "generated" / "project-manifest.json"
    assert manifest.is_file()
    json.loads(manifest.read_text(encoding="utf-8"))
    assert manifest.suffix not in check_reference_data.WORKBOOK_SUFFIXES
