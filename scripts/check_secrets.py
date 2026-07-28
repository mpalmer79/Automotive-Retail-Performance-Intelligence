#!/usr/bin/env python3
"""Lightweight secret scanner for CI.

THIS IS A SAFETY NET, NOT A REAL SECRET SCANNER.
------------------------------------------------
It catches the small number of mistakes that actually happen in a project like
this one: committing a `.env`, pasting a live connection string into a document,
or leaving a private key in the tree. It uses a handful of high-signal regular
expressions and will miss anything else. It is *not* entropy-based, it does not
scan git history, and it does not understand context.

Real controls that complement it:

* `.gitignore` keeps `.env` and generated data out of the index in the first
  place.
* The `detect-private-key` pre-commit hook.
* GitHub secret scanning and push protection on the hosted repository.
* Rotating any credential that reaches a commit, before doing anything else.

Standard library only, so CI can run it without installing the package.

Usage
-----
    python scripts/check_secrets.py
    python scripts/check_secrets.py --quiet
    python scripts/check_secrets.py --paths docs config

Exit codes
----------
    0  nothing found
    1  at least one finding, or a tracked `.env` file
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent

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

# This file contains every pattern as a literal and would always match itself.
SKIPPED_PATHS: frozenset[str] = frozenset({"scripts/check_secrets.py"})

BINARY_SUFFIXES: frozenset[str] = frozenset(
    {
        ".pbix",
        ".pbit",
        ".pbiviz",
        ".xlsx",
        ".xlsm",
        ".xlsb",
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
        ".woff",
        ".woff2",
        ".ttf",
    }
)

MAX_SCANNED_BYTES: int = 4 * 1024 * 1024

# Longest evidence line echoed into the report before truncation.
MAX_EVIDENCE_LENGTH: int = 200

# Values that are obviously not real credentials. Matched case-insensitively as
# substrings of the candidate secret.
PLACEHOLDER_MARKERS: tuple[str, ...] = (
    "changeme",
    "change-me",
    "change_me",
    "your-password",
    "your_password",
    "yourpassword",
    "redacted",
    "<password>",
    "<your",
    "example",
    "placeholder",
    "xxx",
    "dummy",
    "fixme",
    "todo",
    "notarealsecret",
    "${",
    "$(",
    "{{",
)

# Whole-value placeholders. These are matched exactly rather than as substrings,
# because they are common English words that a real credential could contain.
# Documentation in this repository uses them when illustrating a URI shape.
PLACEHOLDER_EXACT_VALUES: frozenset[str] = frozenset(
    {
        "secret",
        "secrets",
        "password",
        "passwd",
        "pwd",
        "pass",
        "user",
        "username",
        "postgres",
        "hunter2",
        "s3cr3t",
        "123456",
        "abc123",
        "none",
        "null",
    }
)


@dataclass(frozen=True)
class Detector:
    """One high-signal pattern plus how to extract the candidate secret."""

    name: str
    pattern: re.Pattern[str]
    description: str
    # Regex group holding the candidate secret; 0 means "the whole match".
    secret_group: int = 0


DETECTORS: tuple[Detector, ...] = (
    Detector(
        name="database-uri-credentials",
        pattern=re.compile(
            r"\b(?:postgres|postgresql|mysql|mariadb|mongodb|redis|amqp)"
            r"(?:\+[a-z0-9]+)?://[^\s:@/]+:(?P<secret>[^\s:@/]+)@",
            re.IGNORECASE,
        ),
        description="connection URI containing an inline password",
        secret_group=1,
    ),
    Detector(
        name="aws-access-key-id",
        pattern=re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        description="AWS access key ID",
    ),
    Detector(
        name="private-key-block",
        pattern=re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
        description="private key block",
    ),
    Detector(
        name="github-personal-access-token",
        pattern=re.compile(r"\bghp_[A-Za-z0-9]{36}\b"),
        description="GitHub personal access token",
    ),
    Detector(
        name="api-secret-key",
        pattern=re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
        description="API secret key with an 'sk-' prefix",
    ),
    Detector(
        name="json-web-token",
        pattern=re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\."),
        description="JSON Web Token",
    ),
    Detector(
        name="quoted-password-assignment",
        pattern=re.compile(
            r"(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*"
            r"['\"](?P<secret>[^'\"]{8,})['\"]",
            re.IGNORECASE,
        ),
        description="quoted credential assignment",
        secret_group=1,
    ),
)


@dataclass(frozen=True)
class Finding:
    """One suspected credential, already redacted for safe logging."""

    path: str
    line_number: int
    detector: str
    description: str
    evidence: str

    def render(self) -> str:
        """Return the one-finding report block for this detection."""
        return (
            f"{self.path}:{self.line_number}: [{self.detector}] {self.description}\n"
            f"    {self.evidence}"
        )


def relative_posix(path: Path) -> str:
    """Return *path* as a repository-relative POSIX string."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def looks_like_placeholder(candidate: str) -> bool:
    """Return True when *candidate* is obviously not a real credential."""
    lowered = candidate.strip().lower()
    if not lowered:
        return True
    if lowered.startswith("*") and lowered.endswith("*"):
        return True
    if set(lowered) <= {"*", "x", "-", "_", "."}:
        return True
    if lowered in PLACEHOLDER_EXACT_VALUES:
        return True
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def redact(text: str) -> str:
    """Never echo a suspected secret back into CI logs in full."""
    stripped = text.strip()
    if len(stripped) > MAX_EVIDENCE_LENGTH:
        stripped = stripped[: MAX_EVIDENCE_LENGTH - 3] + "..."
    for detector in DETECTORS:
        stripped = detector.pattern.sub(
            lambda m: f"<{'*' * 8} redacted {len(m.group(0))} chars>", stripped
        )
    return stripped


def is_probably_binary(path: Path) -> bool:
    """Return True when *path* looks like a binary file."""
    if path.suffix.lower() in BINARY_SUFFIXES:
        return True
    try:
        head = path.open("rb").read(8192)
    except OSError:
        return True
    return b"\x00" in head


def tracked_files() -> list[str] | None:
    """Return repository-relative paths tracked by git, or None if unavailable."""
    try:
        completed = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "ls-files", "-z"],
            capture_output=True,
            check=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return [entry for entry in completed.stdout.decode("utf-8", "replace").split("\0") if entry]


def check_tracked_env_files() -> tuple[list[Finding], str | None]:
    """Fail when any `.env` variant other than `.env.example` is tracked."""
    entries = tracked_files()
    if entries is None:
        return [], "git is unavailable; skipped the tracked-.env check"

    findings: list[Finding] = []
    for entry in entries:
        name = Path(entry).name
        if not name.startswith(".env"):
            continue
        if name == ".env.example":
            continue
        findings.append(
            Finding(
                path=entry,
                line_number=0,
                detector="tracked-env-file",
                description=(
                    "environment file is tracked by git; only '.env.example' may be committed"
                ),
                evidence=f"git ls-files reports: {entry}",
            )
        )
    return findings, None


def iter_candidate_files(roots: Sequence[Path]) -> list[Path]:
    """Return every scannable file beneath *roots*, sorted and de-duplicated."""
    found: set[Path] = set()
    for root in roots:
        if root.is_file():
            found.add(root.resolve())
            continue
        if not root.is_dir():
            continue
        for candidate in root.rglob("*"):
            if not candidate.is_file() or candidate.is_symlink():
                continue
            if any(part in SKIPPED_DIRECTORY_NAMES for part in candidate.parts):
                continue
            found.add(candidate.resolve())
    return sorted(found)


def scan_file(path: Path) -> list[Finding]:
    """Apply every detector to *path* and return the redacted findings."""
    rel_path = relative_posix(path)
    if rel_path in SKIPPED_PATHS:
        return []
    try:
        if path.stat().st_size > MAX_SCANNED_BYTES:
            return []
    except OSError:
        return []
    if is_probably_binary(path):
        return []
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except (UnicodeDecodeError, OSError):
        return []

    findings: list[Finding] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        for detector in DETECTORS:
            for match in detector.pattern.finditer(line):
                candidate = match.group(detector.secret_group) or ""
                # Documentation legitimately shows canonical example values such
                # as AWS's own 'AKIAIOSFODNN7EXAMPLE'; those are not findings.
                if looks_like_placeholder(candidate):
                    continue
                findings.append(
                    Finding(
                        path=rel_path,
                        line_number=line_number,
                        detector=detector.name,
                        description=detector.description,
                        evidence=redact(line),
                    )
                )
                break
    return findings


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


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description="Lightweight secret scanner (safety net, not a real scanner).",
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
        help="Print only findings and the final summary line.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the secret check and return a process exit code."""
    args = build_parser().parse_args(argv)

    roots = resolve_roots(args.paths)
    if not roots:
        print("error: no valid paths to scan", file=sys.stderr)
        return 1

    findings, git_note = check_tracked_env_files()

    candidates = iter_candidate_files(roots)
    scanned = 0
    for path in candidates:
        file_findings = scan_file(path)
        scanned += 1
        findings.extend(file_findings)

    if not args.quiet:
        print("ARPI secret check (safety net, not a replacement for a real scanner)")
        print(f"  files considered : {scanned}")
        print(f"  detectors        : {len(DETECTORS)}")
        if git_note:
            print(f"  note             : {git_note}")
        print()

    if findings:
        print(f"Findings ({len(findings)}):")
        for finding in findings:
            print(f"  {finding.render()}")
        print()
        print(
            f"FAIL: {len(findings)} potential secret(s). If a real credential reached a commit, "
            "ROTATE IT FIRST, then remove it from the tree and history. If it is a placeholder, "
            "make it obviously so (for example 'changeme' or '***REDACTED***')."
        )
        return 1

    if not args.quiet:
        print("OK: no high-signal secret patterns found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
