#!/usr/bin/env python3
"""Report whether the Power BI Desktop validation evidence still describes this model.

WHY THIS EXISTS
---------------
`scripts/check_powerbi_model.py` reads the TMDL as text. It cannot tell you
whether the model refreshes, whether a relationship resolves against real keys,
or whether a measure returns the number the KPI catalogue says it should. Only
Power BI Desktop, pointed at a loaded PostgreSQL reporting schema, can tell you
that -- and Desktop is a Windows desktop application that CI has no business
launching. GitHub Actions must never attempt to start it.

So the evidence is produced by hand, recorded in
`powerbi/validation/desktop_validation_results.json`, and *tied to the model it
describes* by a hash. This script recomputes that hash and compares. A passing
Desktop run against a model that has since changed is not evidence about the
model in the tree; it is evidence about a model that no longer exists.

THE MODEL SOURCE HASH
---------------------
SHA-256 over every file under
`ARPI_Performance_Intelligence.SemanticModel/definition/` plus
`definition.pbism`, taken in sorted relative-path order, with each path and each
file length mixed in so that renaming or splitting a file changes the hash.
Nothing else is included: the report item, the `.pbip` and the `.platform` files
do not affect what a refresh does.

STATUSES
--------
    PASSED   the evidence records a passing run, against this exact model
    PENDING  Desktop has never run; the evidence is a placeholder
    STALE    the evidence describes a different model than the one in the tree
    FAILED   the evidence records a failing run
    MISSING  there is no evidence file at all

`PENDING` exits 0 so that it does not block a branch while delivery increment
P2.1 is in flight. It is never reported as passed, and the word PENDING appears
in the output of every run, so nobody can mistake "not yet validated" for
"validated".

Standard library only, so CI can run it without installing the package.

Usage
-----
    python scripts/check_desktop_validation_freshness.py
    python scripts/check_desktop_validation_freshness.py --print-hash

Exit codes
----------
    0  PASSED or PENDING
    1  STALE, FAILED or MISSING
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Sequence
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent

SEMANTIC_MODEL_DIR: Path = (
    REPO_ROOT
    / "powerbi"
    / "ARPI_Performance_Intelligence"
    / "ARPI_Performance_Intelligence.SemanticModel"
)
DEFINITION_DIR: Path = SEMANTIC_MODEL_DIR / "definition"
PBISM_FILE: Path = SEMANTIC_MODEL_DIR / "definition.pbism"

EVIDENCE_FILE: Path = REPO_ROOT / "powerbi" / "validation" / "desktop_validation_results.json"

#: The five statuses this script reports, and whether each one fails the build.
STATUS_EXIT_CODES: dict[str, int] = {
    "PASSED": 0,
    "PENDING": 0,
    "STALE": 1,
    "FAILED": 1,
    "MISSING": 1,
}

RESULT_KEY: str = "overall_result"
HASH_KEY: str = "model_source_hash"


def relative_posix(path: Path) -> str:
    """Return *path* as a repository-relative POSIX string."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def model_source_files() -> list[Path]:
    """Return every file the hash covers, sorted by path.

    ``definition.pbism`` and everything under ``definition/`` -- and DELIBERATELY NOT
    ``.platform``, even though ``.platform`` IS part of what is deployed to Microsoft
    Fabric. The service owns that file: it assigns a ``logicalId`` and rewrites the
    display name on first deploy. Hashing it would make every piece of validation
    evidence permanently stale the moment the model was deployed once, which is the exact
    failure mode the hash exists to prevent. The asymmetry is intentional and
    ``tests/unit/test_fabric_tooling.py`` asserts it so that nobody "fixes" it later.
    """
    files: list[Path] = []
    if PBISM_FILE.is_file():
        files.append(PBISM_FILE)
    if DEFINITION_DIR.is_dir():
        files.extend(
            path for path in DEFINITION_DIR.rglob("*") if path.is_file() and not path.is_symlink()
        )
    return sorted(files, key=lambda path: path.relative_to(SEMANTIC_MODEL_DIR).as_posix())


def compute_model_source_hash(files: Sequence[Path]) -> str:
    """Return the SHA-256 model source hash over *files*.

    Each file contributes its semantic-model-relative POSIX path, its byte
    length and its bytes, so that moving content between files changes the
    digest even when the concatenated content does not.
    """
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(SEMANTIC_MODEL_DIR).as_posix()
        content = path.read_bytes()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(content)).encode("ascii"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def load_evidence() -> tuple[dict[str, object] | None, str | None]:
    """Return the parsed evidence file and an error message, either of which is None."""
    if not EVIDENCE_FILE.is_file():
        return None, None
    try:
        loaded = json.loads(EVIDENCE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, f"is not valid JSON: {error}"
    if not isinstance(loaded, dict):
        return None, "does not hold a JSON object at the top level"
    return loaded, None


#: What each recorded `overall_result` means once the hash already matches.
_RESULT_STATUS: dict[str, tuple[str, str]] = {
    "passed": (
        "PASSED",
        "the evidence file records a passing Power BI Desktop run against this exact model source.",
    ),
    "pending": (
        "PENDING",
        "the evidence file records that Power BI Desktop has not yet been run. This is "
        "not a passing result.",
    ),
    "failed": (
        "FAILED",
        "the evidence file records a failing Power BI Desktop run against this model "
        "source. Read the recorded checks before changing anything else.",
    ),
}


def _classify_without_a_hash(recorded_result: str) -> tuple[str, str]:
    """Classify evidence that records no model source hash at all."""
    if recorded_result == "pending":
        return (
            "PENDING",
            "the evidence file records no model source hash and no Desktop run. This is "
            "the expected state while delivery increment P2.1 is in flight; it is not a "
            "passing result.",
        )
    return (
        "STALE",
        f"the evidence file records {RESULT_KEY} {recorded_result!r} but no {HASH_KEY}, "
        "so the result cannot be tied to any model. Re-run Desktop validation and record "
        "the hash printed below.",
    )


def classify(evidence: dict[str, object] | None, current_hash: str) -> tuple[str, str]:
    """Return the (status, explanation) for *evidence* against *current_hash*."""
    if evidence is None:
        return (
            "MISSING",
            f"{relative_posix(EVIDENCE_FILE)} does not exist. Power BI Desktop validation "
            "has produced no evidence, so nothing about this model has been verified "
            "against loaded data.",
        )

    recorded_result = str(evidence.get(RESULT_KEY, "")).strip().lower()
    raw_hash = evidence.get(HASH_KEY)
    recorded_hash = str(raw_hash).strip() if isinstance(raw_hash, str) else ""

    if not recorded_hash:
        return _classify_without_a_hash(recorded_result)

    if recorded_hash != current_hash:
        return (
            "STALE",
            f"the evidence file records {HASH_KEY} {recorded_hash} but the semantic model "
            f"now hashes to {current_hash}. The recorded result "
            f"({recorded_result or 'unrecorded'}) describes a model that no longer exists "
            "in this tree; re-run Power BI Desktop validation.",
        )

    return _RESULT_STATUS.get(
        recorded_result,
        (
            "FAILED",
            f"the evidence file records an unrecognised {RESULT_KEY} {recorded_result!r}; "
            "it must be one of 'passed', 'pending' or 'failed'.",
        ),
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser."""
    parser = argparse.ArgumentParser(
        description=(
            "Compare the recorded Power BI Desktop validation evidence with the semantic "
            "model in the tree. Power BI Desktop is never launched."
        ),
    )
    parser.add_argument(
        "--print-hash",
        action="store_true",
        help="Print only the model source hash and exit 0.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print only the status line.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the freshness check and return a process exit code."""
    args = build_parser().parse_args(argv)

    files = model_source_files()
    if not files:
        print(
            f"error: no semantic model source found under {relative_posix(DEFINITION_DIR)}",
            file=sys.stderr,
        )
        return 1

    current_hash = compute_model_source_hash(files)
    if args.print_hash:
        print(current_hash)
        return 0

    evidence, parse_error = load_evidence()
    if parse_error is not None:
        print(f"{relative_posix(EVIDENCE_FILE)}: {parse_error}")
        print("STATUS: FAILED -- the Desktop validation evidence cannot be read.")
        return 1

    status, explanation = classify(evidence, current_hash)

    if not args.quiet:
        print("ARPI Power BI Desktop validation evidence (Desktop is never launched here)")
        print(f"  evidence file  : {relative_posix(EVIDENCE_FILE)}")
        print(f"  files hashed   : {len(files)}")
        print(f"  model source hash : {current_hash}")
        if evidence is not None:
            print(f"  recorded result   : {evidence.get(RESULT_KEY, '(none)')}")
            print(f"  recorded hash     : {evidence.get(HASH_KEY, '(none)')}")
        print()

    print(f"STATUS: {status} -- {explanation}")
    if status in {"STALE", "MISSING"}:
        print(
            "Run the Power BI Desktop validation by hand, then record the model source "
            f"hash above as {HASH_KEY} in {relative_posix(EVIDENCE_FILE)}."
        )
    return STATUS_EXIT_CODES[status]


if __name__ == "__main__":
    raise SystemExit(main())
