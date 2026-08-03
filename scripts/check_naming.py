#!/usr/bin/env python3
"""Fail the build when a retired project identifier is used as a current identity.

Automotive Retail Performance Intelligence (ARPI) was drafted under an earlier
working title. ADR-0001 retired that title and fixed the current identity:

    display name       Automotive Retail Performance Intelligence
    short identifier   ARPI
    Python package     arpi  (src/arpi/)
    config prefix      ARPI_
    database roles     arpi_admin, arpi_loader, arpi_reporter

This script is the automated enforcement of that decision. It scans the working
tree for the retired identifiers and fails if any of them appears outside the
small allowlist of files that preserve naming history on purpose.

Standard library only, so CI can run it without installing the package.

Usage
-----
    python scripts/check_naming.py
    python scripts/check_naming.py --quiet
    python scripts/check_naming.py --paths docs src
    python scripts/check_naming.py --self-test

Exit codes
----------
    0  no violations
    1  at least one violation (warnings alone do not fail the build)
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------
# Exact repository-relative POSIX paths that may contain the retired
# identifiers. Every entry needs a reason; do not extend this list without one.
ALLOWLISTED_PATHS: frozenset[str] = frozenset(
    {
        # The naming decision of record. It must quote the retired name in order
        # to state what was retired and why.
        "docs/architecture-decisions/ADR-0001-project-identity.md",
        # The dealer-group renaming decision of record, for the same reason: it
        # cannot explain what was retired without naming it.
        "docs/architecture-decisions/ADR-0011-dealer-group-public-naming.md",
        # Preserved historical research evidence, kept verbatim. The retired
        # name was proposed there; editing it would falsify the record.
        "docs/research.md",
        # This file. It necessarily contains every forbidden string as a pattern
        # literal, and scanning itself would always fail.
        "scripts/check_naming.py",
        # The inventory generator's own sanitization gate. It refuses to write a
        # frontend artefact containing a retired dealer-group or store name, and
        # it cannot do that without naming them.
        "portfolio/scripts/generate-inventory-data.ts",
        # The two suites that assert the retired names never reach the generated
        # data or a rendered page. Same reason: a test that a string is absent
        # has to contain the string.
        "portfolio/tests/unit/inventory.test.ts",
        "portfolio/tests/e2e/inventory.spec.ts",
    }
)

# Directories that are never scanned: version control internals, virtual
# environments, dependency trees, and tool caches.
SKIPPED_DIRECTORY_NAMES: frozenset[str] = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "env",
        "ENV",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".hypothesis",
        "htmlcov",
        ".tox",
        ".nox",
        ".idea",
        ".vscode",
        ".ipynb_checkpoints",
        "build",
        "dist",
    }
)

# Extensions that are binary by definition. Content sniffing catches the rest.
BINARY_SUFFIXES: frozenset[str] = frozenset(
    {
        ".pbix",
        ".pbit",
        ".pbiviz",
        ".xlsx",
        ".xlsm",
        ".xlsb",
        ".xlk",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".ico",
        ".pdf",
        ".zip",
        ".gz",
        ".bz2",
        ".dump",
        ".backup",
        ".so",
        ".pyc",
        ".pyd",
        ".dll",
        ".woff",
        ".woff2",
        ".ttf",
    }
)

# Files larger than this are assumed to be data, not prose, and are skipped so
# the check stays fast enough to run on every commit.
MAX_SCANNED_BYTES: int = 4 * 1024 * 1024

# Longest offending line echoed into the report before truncation.
MAX_SNIPPET_LENGTH: int = 160

# Guards against an allowlist entry being added without a review.
EXPECTED_ALLOWLIST_SIZE: int = 7


@dataclass(frozen=True)
class Rule:
    """A forbidden identifier and the human-readable reason it is forbidden."""

    name: str
    pattern: re.Pattern[str]
    explanation: str


# Ordered most specific first; the first matching rule wins for a given line, so
# the generic catch-all only fires when nothing more precise applies.
FORBIDDEN_RULES: tuple[Rule, ...] = (
    Rule(
        name="retired-display-name",
        pattern=re.compile(r"DealerPulse[ \t]+BI", re.IGNORECASE),
        explanation="retired display name; use 'Automotive Retail Performance Intelligence'",
    ),
    Rule(
        name="retired-repo-slug",
        pattern=re.compile(r"DealerPulse-BI", re.IGNORECASE),
        explanation=("retired repository slug; use 'Automotive-Retail-Performance-Intelligence'"),
    ),
    Rule(
        name="retired-compact-name",
        pattern=re.compile(r"DealerPulseBI", re.IGNORECASE),
        explanation="retired compact name; use 'ARPI'",
    ),
    Rule(
        name="retired-package-path",
        pattern=re.compile(r"src/dealerpulse", re.IGNORECASE),
        explanation="retired package path; the package lives at 'src/arpi'",
    ),
    Rule(
        name="retired-admin-role",
        pattern=re.compile(r"dealerpulse_admin", re.IGNORECASE),
        explanation="retired database role; use 'arpi_admin'",
    ),
    Rule(
        name="retired-loader-role",
        pattern=re.compile(r"dealerpulse_loader", re.IGNORECASE),
        explanation="retired database role; use 'arpi_loader'",
    ),
    Rule(
        name="retired-reporter-role",
        pattern=re.compile(r"dealerpulse_reporter", re.IGNORECASE),
        explanation="retired database role; use 'arpi_reporter'",
    ),
    Rule(
        name="retired-identifier",
        pattern=re.compile(r"dealerpulse", re.IGNORECASE),
        explanation="retired project identifier; use 'arpi' / 'ARPI'",
    ),
    # ---------------------------------------------------------------------
    # The fictional dealer group's names.
    #
    # The group and its independent store were renamed for the public site.
    # These are not merely stale strings: the website, the warehouse dimension,
    # the SQL comments and the sanitized workbooks all have to agree on who this
    # business is, and a single file left behind makes the site and the data
    # model contradict each other about the subject they exist to describe.
    #
    # The dealership IDs (GSA-001 .. GSA-003) were deliberately NOT changed. They
    # are internal keys, they appear in the warehouse, in the SQL, in the
    # workbooks and in the reference directory structure, and renaming them would
    # be a migration with no reader-visible benefit.
    # ---------------------------------------------------------------------
    Rule(
        name="retired-group-name",
        pattern=re.compile(r"Granite[ \t]+State[ \t]+Auto[ \t]+Group", re.IGNORECASE),
        explanation="retired dealer-group name; use 'Granite Auto Group'",
    ),
    Rule(
        name="retired-store-name",
        pattern=re.compile(r"Granite[ \t_]+Used[ \t_]+Auto", re.IGNORECASE),
        explanation=(
            "retired store name; GSA-003 is 'Granite Pre-Owned Center of Merrimack', "
            "short name 'Granite Pre-Owned'"
        ),
    ),
    Rule(
        name="never-used-group-name",
        pattern=re.compile(r"Game[ \t]+Auto[ \t]+Group", re.IGNORECASE),
        explanation="this project has never had a group by that name; use 'Granite Auto Group'",
    ),
)

# Non-fatal spelling consistency rules applied to Markdown only. The product is
# spelled 'PostgreSQL' (or 'Postgres' informally); these are the misspellings
# that actually show up in analytics documentation.
SPELLING_WARNING_RULES: tuple[Rule, ...] = (
    Rule(
        name="postgresql-spelling",
        pattern=re.compile(r"Postgreg\s?SQL", re.IGNORECASE),
        explanation="misspelling; write 'PostgreSQL'",
    ),
    Rule(
        name="postgresql-spelling",
        pattern=re.compile(r"\bPostgress\b", re.IGNORECASE),
        explanation="misspelling; write 'PostgreSQL'",
    ),
    Rule(
        name="postgresql-capitalisation",
        pattern=re.compile(r"\bPostGres"),
        explanation="capitalisation; write 'PostgreSQL' (or 'Postgres' informally)",
    ),
)

# Paths that must not exist. The retired package directory is the one case where
# the identifier being present as a real filesystem path is itself the defect.
FORBIDDEN_PATHS: tuple[str, ...] = ("src/dealerpulse",)


@dataclass(frozen=True)
class Finding:
    """One matched location."""

    path: str
    line_number: int
    rule_name: str
    explanation: str
    line_text: str

    def render(self) -> str:
        """Return the one-finding report block for this match."""
        snippet = self.line_text.strip()
        if len(snippet) > MAX_SNIPPET_LENGTH:
            snippet = snippet[: MAX_SNIPPET_LENGTH - 3] + "..."
        return (
            f"{self.path}:{self.line_number}: [{self.rule_name}] {self.explanation}\n    {snippet}"
        )


def relative_posix(path: Path) -> str:
    """Return *path* as a repository-relative POSIX string."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def is_probably_binary(path: Path) -> bool:
    """Return True when *path* looks like a binary file."""
    if path.suffix.lower() in BINARY_SUFFIXES:
        return True
    try:
        head = path.open("rb").read(8192)
    except OSError:
        return True
    return b"\x00" in head


def iter_candidate_files(roots: Sequence[Path]) -> Iterator[Path]:
    """Yield every scannable text file beneath *roots*."""
    seen: set[Path] = set()
    for root in roots:
        if root.is_file():
            resolved = root.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield resolved
            continue
        if not root.is_dir():
            continue
        for candidate in sorted(root.rglob("*")):
            if not candidate.is_file() or candidate.is_symlink():
                continue
            if any(part in SKIPPED_DIRECTORY_NAMES for part in candidate.parts):
                continue
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            yield resolved


def read_lines(path: Path) -> list[str] | None:
    """Return the decoded lines of *path*, or None when it is not scannable."""
    try:
        if path.stat().st_size > MAX_SCANNED_BYTES:
            return None
    except OSError:
        return None
    if is_probably_binary(path):
        return None
    try:
        return path.read_text(encoding="utf-8", errors="strict").splitlines()
    except (UnicodeDecodeError, OSError):
        return None


def scan_lines(rel_path: str, lines: Iterable[str], rules: tuple[Rule, ...]) -> list[Finding]:
    """Apply *rules* to *lines*, recording at most one finding per line."""
    findings: list[Finding] = []
    for line_number, line in enumerate(lines, start=1):
        for rule in rules:
            if rule.pattern.search(line):
                findings.append(
                    Finding(
                        path=rel_path,
                        line_number=line_number,
                        rule_name=rule.name,
                        explanation=rule.explanation,
                        line_text=line,
                    )
                )
                break
    return findings


def check_forbidden_paths() -> list[Finding]:
    """Fail when a retired path exists on disk."""
    findings: list[Finding] = []
    for forbidden in FORBIDDEN_PATHS:
        target = REPO_ROOT / forbidden
        if target.exists():
            findings.append(
                Finding(
                    path=forbidden,
                    line_number=0,
                    rule_name="retired-package-path",
                    explanation="retired path exists on disk; the package lives at 'src/arpi'",
                    line_text=f"<filesystem> {forbidden}",
                )
            )
    return findings


def run_check(roots: Sequence[Path]) -> tuple[list[Finding], list[Finding], int]:
    """Scan *roots* and return (violations, warnings, files_scanned)."""
    violations: list[Finding] = check_forbidden_paths()
    warnings: list[Finding] = []
    files_scanned = 0

    for path in iter_candidate_files(roots):
        rel_path = relative_posix(path)
        lines = read_lines(path)
        if lines is None:
            continue
        files_scanned += 1
        if rel_path in ALLOWLISTED_PATHS:
            # Allowlisted files preserve history verbatim, including the retired
            # name and the misspellings that were corrected. Skip both rule sets.
            continue
        violations.extend(scan_lines(rel_path, lines, FORBIDDEN_RULES))
        if path.suffix.lower() == ".md":
            warnings.extend(scan_lines(rel_path, lines, SPELLING_WARNING_RULES))

    return violations, warnings, files_scanned


def resolve_roots(raw_paths: Sequence[str]) -> list[Path]:
    """Turn CLI path arguments into existing absolute paths."""
    if not raw_paths:
        return [REPO_ROOT]
    roots: list[Path] = []
    for raw in raw_paths:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = REPO_ROOT / candidate
        if candidate.exists():
            roots.append(candidate)
        else:
            print(f"warning: path does not exist, skipping: {raw}", file=sys.stderr)
    return roots


def self_test() -> int:
    """Run internal assertions on the rule set. Returns a process exit code."""
    checks: list[tuple[str, bool]] = []

    def expect(label: str, condition: bool) -> None:
        checks.append((label, condition))

    def first_rule(text: str) -> str | None:
        found = scan_lines("t.md", [text], FORBIDDEN_RULES)
        return found[0].rule_name if found else None

    expect("display name is caught", first_rule("DealerPulse BI") == "retired-display-name")
    expect("slug is caught", first_rule("DealerPulse-BI") == "retired-repo-slug")
    expect("compact name is caught", first_rule("DealerPulseBI") == "retired-compact-name")
    expect("package path is caught", first_rule("src/dealerpulse/x.py") == "retired-package-path")
    expect("admin role is caught", first_rule("dealerpulse_admin") == "retired-admin-role")
    expect("loader role is caught", first_rule("dealerpulse_loader") == "retired-loader-role")
    expect(
        "reporter role is caught",
        first_rule("dealerpulse_reporter") == "retired-reporter-role",
    )
    expect("catch-all fires last", first_rule("the dealerpulse thing") == "retired-identifier")
    expect("case-insensitive", first_rule("DEALERPULSE") == "retired-identifier")
    single_line_hits = scan_lines("t.md", ["DealerPulse BI"], FORBIDDEN_RULES)
    expect("one finding per line", len(single_line_hits) == 1)

    current_name = "Automotive Retail Performance Intelligence"
    expect("current name is clean", first_rule(current_name) is None)
    expect("arpi roles are clean", first_rule("arpi_admin arpi_loader arpi_reporter") is None)
    expect("src/arpi is clean", first_rule("src/arpi/config.py") is None)
    expect("ARPI prefix is clean", first_rule("ARPI_DATABASE__HOST") is None)

    def spelling(text: str) -> str | None:
        found = scan_lines("t.md", [text], SPELLING_WARNING_RULES)
        return found[0].rule_name if found else None

    expect("PostgreSQL is accepted", spelling("PostgreSQL 16 is the warehouse.") is None)
    expect("Postgres is accepted", spelling("Postgres is fine informally.") is None)
    expect("PostgregSQL warns", spelling("PostgregSQL") == "postgresql-spelling")
    expect("Postgress warns", spelling("Postgress") == "postgresql-spelling")
    expect("PostGres warns", spelling("PostGres") == "postgresql-capitalisation")

    expect(
        "allowlist size is unchanged",
        len(ALLOWLISTED_PATHS) == EXPECTED_ALLOWLIST_SIZE,
    )
    expect("this file is allowlisted", "scripts/check_naming.py" in ALLOWLISTED_PATHS)
    expect("adr is allowlisted", any("ADR-0001" in p for p in ALLOWLISTED_PATHS))
    expect(
        "binary suffix detection",
        is_probably_binary(Path("nonexistent.pbix")) and ".md" not in BINARY_SUFFIXES,
    )

    failures = [label for label, ok in checks if not ok]
    for label, ok in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    print(f"\nself-test: {len(checks) - len(failures)}/{len(checks)} assertions passed")
    return 1 if failures else 0


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description="Fail when a retired ARPI identifier is used as a current identity.",
    )
    parser.add_argument(
        "--paths",
        nargs="+",
        default=[],
        metavar="PATH",
        help="Limit the scan to these files or directories (default: the whole repository).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only violations and the final summary line.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run internal assertions on the rule set and exit.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the naming check and return a process exit code."""
    args = build_parser().parse_args(argv)

    if args.self_test:
        return self_test()

    roots = resolve_roots(args.paths)
    if not roots:
        print("error: no valid paths to scan", file=sys.stderr)
        return 1

    violations, warnings, files_scanned = run_check(roots)

    if not args.quiet:
        print("ARPI naming check")
        print(f"  repository : {REPO_ROOT}")
        print(f"  files read : {files_scanned}")
        print(f"  allowlisted: {len(ALLOWLISTED_PATHS)} path(s)")
        print()

    if warnings:
        print(f"Warnings ({len(warnings)}) — not build-breaking:")
        for warning in warnings:
            print(f"  {warning.render()}")
        print()

    if violations:
        print(f"Violations ({len(violations)}) — retired identifier used as a current identity:")
        for violation in violations:
            print(f"  {violation.render()}")
        print()
        print(
            f"FAIL: {len(violations)} naming violation(s). "
            "Replace the retired identifier with the ARPI equivalent, or, if the text is "
            "genuinely historical, add the file to ALLOWLISTED_PATHS with a reason."
        )
        return 1

    if not args.quiet:
        print("OK: no retired identifiers used as a current identity.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
