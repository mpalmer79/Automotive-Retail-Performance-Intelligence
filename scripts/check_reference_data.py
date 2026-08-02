#!/usr/bin/env python3
"""Governance check for the sanitized public reference lane (ADR-0011).

WHAT THIS ENFORCES, AND WHY IT IS NOT A UNIT TEST
--------------------------------------------------
``arpi.inventory.validation`` refuses a bad workbook when somebody runs the validator.
This runs in CI on every branch, with nothing installed, and asks the questions that are
about the REPOSITORY rather than about a workbook:

* Is every committed reference artifact declared in the contract, and is every declared
  artifact present? Neither an undeclared upload nor a silent deletion may pass.
* Does every artifact's file name follow the approved ARPI underscore convention?
* Is there a duplicate or alias copy -- a second workbook for the same store and snapshot,
  a hyphenated or lowercased twin, or a stray copy at the repository root?
* Do the committed bytes still match the declared digest?
* Is ``data/sample`` still synthetic-only, with no reference workbook smuggled into it?
* Does any committed artifact carry a URL, or a value that looks like a real VIN?
* Does the documentation name the canonical Granite Chevrolet workbook correctly, and
  never by a hyphenated substitute?
* Does the documentation make a claim the lane cannot support -- calling the reference
  data fully synthetic, calling a removed listing a sale, or calling days observed online
  days in stock?

Standard library only, so the ``repository-checks`` CI job can run it on a bare
interpreter. That is why the contract YAML is read by a small purpose-built parser rather
than by PyYAML, and why the ``.xlsx`` files are read as ZIP archives rather than through
openpyxl: both dependencies exist in the application environment and neither exists here.

Usage
-----
    python scripts/check_reference_data.py
    python scripts/check_reference_data.py --quiet

Exit codes
----------
    0  every rule passed
    1  at least one violation
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import xml.etree.ElementTree as ElementTree
import zipfile
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
CONTRACT_PATH: Path = REPO_ROOT / "config" / "reference" / "inventory_listing_contract.yaml"
REFERENCE_ROOT: Path = REPO_ROOT / "data" / "reference"
SAMPLE_ROOT: Path = REPO_ROOT / "data" / "sample"

#: Workbook suffixes a reference artifact may use.
WORKBOOK_SUFFIXES: frozenset[str] = frozenset({".xlsx", ".xlsm", ".xls"})

#: Any HTTP, HTTPS, FTP or bare-host reference. Mirrors the pattern in
#: arpi.inventory.validation, which is the runtime control this backstops.
URL_PATTERN = re.compile(
    r"(?:https?://|ftp://|www\.[a-z0-9-]+\.[a-z]{2,})",
    re.IGNORECASE,
)

#: The ISO 3779 VIN alphabet: no I, O or Q. Seventeen characters drawn only from it is
#: treated as a real VIN. ARPI's own identifiers all begin `ARPI` and so never match.
REAL_VIN_PATTERN = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")

#: Text files this check reads when looking for a wrong filename or a prohibited claim.
DOCUMENT_SUFFIXES: frozenset[str] = frozenset({".md", ".py", ".ts", ".tsx", ".sql", ".yaml", ".yml", ".json"})

#: Directories never searched.
SKIPPED_DIRECTORIES: frozenset[str] = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".next",
        ".turbo",
        "htmlcov",
        "playwright-report",
        "test-results",
        "build",
        "dist",
    }
)

#: This file states every prohibited pattern as a literal and would always match itself.
#: The reference policy quotes the prohibited claims in order to prohibit them, and the
#: contract records the one declared legacy path hint, so all three are exempt by path.
SELF_EXEMPT: frozenset[str] = frozenset(
    {
        "scripts/check_reference_data.py",
        "data/reference/README.md",
        "config/reference/inventory_listing_contract.yaml",
        "docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md",
    }
)


@dataclass(frozen=True)
class Violation:
    """One governance failure.

    Attributes:
        rule: Short rule identifier, e.g. ``canonical-filename``.
        location: Repository-relative path, with a line number where there is one.
        message: What is wrong and what to do about it.
    """

    rule: str
    location: str
    message: str

    def render(self) -> str:
        """Render the violation as one line."""
        return f"  [{self.rule}] {self.location}: {self.message}"


# --------------------------------------------------------------------------------------
# A very small YAML reader
# --------------------------------------------------------------------------------------


def _scalar(text: str) -> str:
    """Strip inline comments and surrounding quotes from a YAML scalar."""
    value = text.strip()
    if value and value[0] not in {'"', "'"} and " #" in value:
        value = value.split(" #", 1)[0].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return value


def read_contract_facts(path: Path) -> tuple[list[dict[str, str]], str, str]:
    """Read the canonical artifact declarations and the two naming regexes.

    A full YAML parser is not available here, and the contract's shape is fixed: a
    ``canonical_artifacts`` list of flat mappings, and two scalar keys under ``naming``.
    Reading exactly those with a line scanner is enough, and it keeps this check free of
    dependencies.

    Args:
        path: Contract file.

    Returns:
        The artifact declarations, the sanitized-name regex and the report-name regex.
    """
    artifacts: list[dict[str, str]] = []
    sanitized_regex = ""
    report_regex = ""
    in_artifacts = False
    current: dict[str, str] | None = None
    pending_key: str | None = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("sanitized_regex:"):
            sanitized_regex = _scalar(stripped.split(":", 1)[1])
            continue
        if stripped.startswith("report_regex:"):
            report_regex = _scalar(stripped.split(":", 1)[1])
            continue

        if stripped == "canonical_artifacts:":
            in_artifacts = True
            continue
        if in_artifacts and not raw_line.startswith((" ", "\t", "-")):
            in_artifacts = False
        if not in_artifacts:
            continue

        if stripped.startswith("- "):
            current = {}
            artifacts.append(current)
            stripped = stripped[2:].strip()
        if current is None:
            continue

        if pending_key is not None:
            current[pending_key] = _scalar(stripped)
            pending_key = None
            continue
        if ":" in stripped:
            key, _, value = stripped.partition(":")
            value = _scalar(value)
            if value in {">-", ">", "|", "|-"}:
                pending_key = key.strip()
            else:
                current[key.strip()] = value

    return artifacts, sanitized_regex, report_regex


# --------------------------------------------------------------------------------------
# Workbook reading, without openpyxl
# --------------------------------------------------------------------------------------


def workbook_strings(path: Path) -> list[str]:
    """Return every string a workbook holds, read straight from its XML parts.

    A committed ``.xlsx`` is a ZIP of XML. The shared string table holds every text value
    in the file, and the sheet XML holds inline strings and formulas. Reading both is
    enough to answer "does a URL or a real VIN appear anywhere in this artifact" without
    installing anything.

    Args:
        path: Workbook to read.

    Returns:
        Every string found, in document order.
    """
    found: list[str] = []
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            for name in names:
                if not (name.startswith("xl/") and name.endswith(".xml")):
                    continue
                if not (
                    name == "xl/sharedStrings.xml"
                    or name.startswith("xl/worksheets/")
                    or name.startswith("xl/comments")
                ):
                    continue
                try:
                    root = ElementTree.fromstring(archive.read(name))
                except ElementTree.ParseError:
                    continue
                found.extend(
                    element.text for element in root.iter() if element.text and element.text.strip()
                )
    except (zipfile.BadZipFile, OSError):
        return []
    return found


def file_digest(path: Path) -> str:
    """Return the SHA-256 of a file's bytes."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repository_files(suffixes: frozenset[str]) -> list[Path]:
    """Return every tracked-looking file with one of the given suffixes."""
    found: list[Path] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIPPED_DIRECTORIES for part in path.relative_to(REPO_ROOT).parts):
            continue
        if path.suffix.lower() in suffixes:
            found.append(path)
    return found


def relative(path: Path) -> str:
    """Render a path relative to the repository root, POSIX style."""
    return path.relative_to(REPO_ROOT).as_posix()


# --------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------


def check_declared_artifacts(
    artifacts: list[dict[str, str]], sanitized_regex: str
) -> list[Violation]:
    """Every committed reference workbook is declared, present, correctly named and unchanged."""
    violations: list[Violation] = []
    pattern = re.compile(sanitized_regex) if sanitized_regex else None

    declared_paths = {artifact.get("path", "") for artifact in artifacts}
    committed = sorted(
        path
        for path in REFERENCE_ROOT.rglob("*")
        if path.is_file() and path.suffix.lower() in WORKBOOK_SUFFIXES
    )

    for path in committed:
        rel = relative(path)
        if rel not in declared_paths:
            violations.append(
                Violation(
                    "undeclared-artifact",
                    rel,
                    "a reference workbook exists that config/reference/"
                    "inventory_listing_contract.yaml does not declare. Add it to "
                    "canonical_artifacts with its digest and row count, or remove it. An "
                    "undeclared artifact has been through no review.",
                )
            )
        if pattern is not None and not pattern.match(path.name):
            violations.append(
                Violation(
                    "canonical-filename",
                    rel,
                    "the file name does not follow the approved ARPI convention "
                    "ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx. "
                    "Filename words are separated by underscores; hyphens appear only "
                    "inside the ISO date.",
                )
            )

    for artifact in artifacts:
        rel = artifact.get("path", "")
        if not rel:
            continue
        path = REPO_ROOT / rel
        if not path.is_file():
            violations.append(
                Violation(
                    "missing-artifact",
                    rel,
                    "the contract declares this canonical artifact and it is not "
                    "committed. Restore it, or remove the declaration deliberately and "
                    "record why -- a silent deletion is how evidence disappears.",
                )
            )
            continue
        if path.name != artifact.get("file_name"):
            violations.append(
                Violation(
                    "canonical-filename",
                    rel,
                    f"the committed file name is {path.name!r} but the contract declares "
                    f"{artifact.get('file_name')!r}. A filename change requires an "
                    "explicit migration, not an informal rename.",
                )
            )
        expected = artifact.get("sha256", "")
        actual = file_digest(path)
        if expected and expected != actual:
            violations.append(
                Violation(
                    "artifact-digest",
                    rel,
                    f"the committed bytes no longer match the declared digest "
                    f"(declared {expected}, actual {actual}). A reference artifact is "
                    "evidence; replacing it silently is not permitted.",
                )
            )
    return violations


def check_no_duplicate_artifacts(artifacts: list[dict[str, str]]) -> list[Violation]:
    """No snapshot directory holds two workbooks, and no alias copy exists elsewhere."""
    violations: list[Violation] = []

    by_directory: dict[Path, list[str]] = {}
    for path in REFERENCE_ROOT.rglob("*"):
        if path.is_file() and path.suffix.lower() in WORKBOOK_SUFFIXES:
            by_directory.setdefault(path.parent, []).append(path.name)
    for directory, names in sorted(by_directory.items()):
        if len(names) > 1:
            violations.append(
                Violation(
                    "duplicate-artifact",
                    relative(directory),
                    f"{len(names)} workbooks in one snapshot directory "
                    f"({', '.join(sorted(names))}). One store and one snapshot date have "
                    "exactly one canonical artifact.",
                )
            )

    declared_names = {artifact.get("file_name", "") for artifact in artifacts}
    declared_paths = {artifact.get("path", "") for artifact in artifacts}
    for path in repository_files(WORKBOOK_SUFFIXES):
        rel = relative(path)
        if rel in declared_paths:
            continue
        if path.name in declared_names:
            violations.append(
                Violation(
                    "duplicate-artifact",
                    rel,
                    "a second copy of a canonical reference workbook exists outside its "
                    "governed path. There is exactly one copy, at "
                    "data/reference/inventory/<dealership-id>/<yyyy-mm-dd>/.",
                )
            )
        stem = path.stem.replace("-", "_").casefold()
        for declared in declared_names:
            if declared and stem == Path(declared).stem.replace("-", "_").casefold():
                violations.append(
                    Violation(
                        "duplicate-artifact",
                        rel,
                        f"this file is an alias of the canonical artifact {declared!r} "
                        "differing only in hyphenation or capitalisation. No duplicate, "
                        "alias, symlink or renamed copy may exist.",
                    )
                )
    return violations


def check_sample_stays_synthetic() -> list[Violation]:
    """``data/sample`` is reserved for fully machine-generated data and holds no workbook."""
    if not SAMPLE_ROOT.is_dir():
        return []
    return [
        Violation(
            "sample-is-synthetic-only",
            relative(path),
            "a workbook was placed under data/sample, which is reserved for fully "
            "machine-generated data. Sanitized public reference data lives under "
            "data/reference/ and carries an explicit classification (ADR-0011).",
        )
        for path in sorted(SAMPLE_ROOT.rglob("*"))
        if path.is_file() and path.suffix.lower() in WORKBOOK_SUFFIXES
    ]


def check_artifact_contents(artifacts: list[dict[str, str]]) -> list[Violation]:
    """No committed artifact carries a URL, a real VIN, or a missing classification."""
    violations: list[Violation] = []
    for artifact in artifacts:
        rel = artifact.get("path", "")
        path = REPO_ROOT / rel
        if not path.is_file():
            continue
        legacy_hint = artifact.get("legacy_path_hint", "")
        strings = workbook_strings(path)
        if not strings:
            violations.append(
                Violation(
                    "artifact-unreadable",
                    rel,
                    "the workbook could not be read as an .xlsx archive, so its contents "
                    "cannot be checked. A reference artifact that cannot be inspected "
                    "cannot be governed.",
                )
            )
            continue

        urls = sorted({match.group(0) for value in strings for match in URL_PATTERN.finditer(value)})
        if urls:
            violations.append(
                Violation(
                    "artifact-url",
                    rel,
                    f"{len(urls)} URL reference(s) appear in the workbook. Row-level "
                    "source URLs are removed by the sanitizer and must never reach a "
                    "committed artifact.",
                )
            )

        vin_hits = sum(1 for value in strings if REAL_VIN_PATTERN.search(value))
        if vin_hits:
            violations.append(
                Violation(
                    "artifact-real-vin",
                    rel,
                    f"{vin_hits} value(s) are seventeen characters drawn from the real VIN "
                    "alphabet. Original VINs are replaced with ARPI-prefixed synthetic "
                    "identifiers, which contain I and can never match.",
                )
            )

        if "Sanitized public reference data" not in strings:
            violations.append(
                Violation(
                    "artifact-classification",
                    rel,
                    "the workbook does not carry the approved classification 'Sanitized "
                    "public reference data'. A reference artifact without an explicit "
                    "classification cannot be committed.",
                )
            )

        for value in strings:
            if not URL_PATTERN.search(value) and "-inventory-sanitized" in value.casefold():
                if legacy_hint and value.strip() == legacy_hint:
                    # The one declared, reviewed deviation. Keyed to this artifact's
                    # declaration, so it covers this file and nothing else.
                    continue
                violations.append(
                    Violation(
                        "canonical-filename",
                        rel,
                        "the workbook names a hyphenated inventory workbook file. The "
                        "approved convention uses underscores between filename words.",
                    )
                )
    return violations


def check_documentation(artifacts: list[dict[str, str]]) -> list[Violation]:
    """Documentation names the canonical artifact correctly and makes no prohibited claim."""
    violations: list[Violation] = []
    legacy_hints = {
        artifact.get("legacy_path_hint", "") for artifact in artifacts if artifact.get("legacy_path_hint")
    }

    hyphenated = re.compile(
        r"\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-inventory-sanitized(?:-\d{4}-\d{2}-\d{2})?\.xlsx\b",
        re.IGNORECASE,
    )
    # Each pattern matches an AFFIRMATIVE claim only. The negative lookahead after the
    # verb is what lets the codebase state the correct rule -- "days observed online is
    # NOT days in stock" -- without the check that forbids the wrong one flagging the
    # sentence that forbids it.
    _not_negated = r"(?![^.\n]{0,12}\b(?:not|never|neither|rather than)\b)"
    prohibited_claims = (
        (
            "reference-data-is-not-synthetic",
            re.compile(
                r"(?:reference|sanitized|listing)[^.\n]{0,80}?\b(?:is|are)\b"
                + _not_negated
                + r"[^.\n]{0,20}\bfully synthetic\b",
                re.IGNORECASE,
            ),
            "the sanitized reference lane is NOT fully synthetic. Its dealer and vehicle "
            "identifiers are synthetic; its listing attributes are a de-identified public "
            "reference snapshot. Call it 'sanitized public reference data'.",
        ),
        (
            "removed-is-not-sold",
            re.compile(
                r"removed(?: from)?[- ]listing[^.\n]{0,60}?\b(?:means|is|are|equals)\b"
                + _not_negated
                + r"[^.\n]{0,20}\bsold\b",
                re.IGNORECASE,
            ),
            "a removed listing is not a sale. It can reflect a sale, a trade, a wholesale, "
            "feed suppression or an error, and this data cannot tell them apart.",
        ),
        (
            "days-observed-is-not-days-in-stock",
            re.compile(
                r"days observed online[^.\n]{0,40}?\b(?:is|are|means|equals)\b"
                + _not_negated
                + r"[^.\n]{0,20}days in stock",
                re.IGNORECASE,
            ),
            "days observed online is not days in stock. Days in stock runs from "
            "acquisition and lives on the owned-inventory fact; this lane never sees it.",
        ),
    )

    for path in repository_files(DOCUMENT_SUFFIXES):
        rel = relative(path)
        if rel in SELF_EXEMPT:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if "inventory" not in text.casefold():
            continue

        for number, line in enumerate(text.splitlines(), start=1):
            for match in hyphenated.finditer(line):
                if match.group(0) in legacy_hints or any(
                    match.group(0) in hint for hint in legacy_hints
                ):
                    continue
                violations.append(
                    Violation(
                        "canonical-filename",
                        f"{rel}:{number}",
                        f"{match.group(0)!r} is a hyphenated inventory workbook name. The "
                        "approved ARPI convention uses underscores between filename words "
                        "and hyphens only inside the ISO date.",
                    )
                )
            for rule, pattern, message in prohibited_claims:
                if pattern.search(line):
                    violations.append(Violation(rule, f"{rel}:{number}", message))

    for artifact in artifacts:
        name = artifact.get("file_name", "")
        if not name:
            continue
        mentioned = any(
            name in path.read_text(encoding="utf-8", errors="ignore")
            for path in (
                REPO_ROOT / "data" / "reference" / "README.md",
                REPO_ROOT / "DATA_DICTIONARY.md",
            )
            if path.is_file()
        )
        if not mentioned:
            violations.append(
                Violation(
                    "canonical-filename",
                    "data/reference/README.md",
                    f"the canonical artifact {name!r} is named in neither the reference "
                    "policy nor the data dictionary. Every document that identifies it "
                    "must use this exact spelling.",
                )
            )
    return violations


# --------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------


def run() -> list[Violation]:
    """Evaluate every rule and return the violations, in rule order."""
    if not CONTRACT_PATH.is_file():
        return [
            Violation(
                "contract-missing",
                relative(CONTRACT_PATH),
                "the inventory listing contract is absent, so no reference artifact can "
                "be governed.",
            )
        ]
    artifacts, sanitized_regex, _report_regex = read_contract_facts(CONTRACT_PATH)
    if not artifacts:
        return [
            Violation(
                "contract-empty",
                relative(CONTRACT_PATH),
                "the contract declares no canonical artifacts. If none is committed, say "
                "so explicitly rather than leaving the list empty.",
            )
        ]

    violations: list[Violation] = []
    violations.extend(check_declared_artifacts(artifacts, sanitized_regex))
    violations.extend(check_no_duplicate_artifacts(artifacts))
    violations.extend(check_sample_stays_synthetic())
    violations.extend(check_artifact_contents(artifacts))
    violations.extend(check_documentation(artifacts))
    return violations


def main(argv: list[str] | None = None) -> int:
    """Run the check and report.

    Args:
        argv: Arguments excluding the program name.

    Returns:
        ``0`` when every rule passed, ``1`` otherwise.
    """
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument("--quiet", action="store_true", help="Print nothing on success.")
    args = parser.parse_args(argv)

    violations = run()
    if violations:
        print(f"Reference-data governance: {len(violations)} violation(s).", file=sys.stderr)
        for violation in violations:
            print(violation.render(), file=sys.stderr)
        print(
            "\nADR-0011 and data/reference/README.md govern this lane. The canonical "
            "Granite Chevrolet artifact is ARPI_Granite_Chevrolet_Inventory_Sanitized_"
            "2026-08-02.xlsx and that spelling is final.",
            file=sys.stderr,
        )
        return 1
    if not args.quiet:
        print("Reference-data governance: every rule passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
