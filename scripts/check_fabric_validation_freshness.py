"""Report whether the Microsoft Fabric validation evidence still describes this model.

WHAT THIS ENFORCES, AND WHY
---------------------------
ADR-0008 accepts two real-engine validation paths. This is the freshness check for the
Fabric one, and it is the exact counterpart of
``scripts/check_desktop_validation_freshness.py``.

Evidence for a model that has since been edited is not evidence. The evidence file records
the SHA-256 of the semantic model definition as it stood when Fabric validated it; this
script recomputes that hash from the working tree and compares. If someone changes a
measure after a passing run, the recorded hash stops matching and the state becomes
**STALE** rather than staying green — which is the whole point, because a stale pass is
more dangerous than no pass at all. It reads as validated while describing a model that no
longer exists.

The hash function is imported from the Desktop freshness checker rather than reimplemented.
Two implementations of one hash is two answers waiting to disagree, and the disagreement
would surface as a permanently stale gate that nobody could clear.

STATES
------
======== ====================================================================== ====
State    Meaning                                                                Exit
======== ====================================================================== ====
PASSED   Fabric validated this exact model definition and everything passed.       0
PENDING  Fabric has never validated this model. Not a pass.                        0
STALE    The recorded hash does not match the model on disk.                       1
FAILED   Fabric validated it and something failed.                                 1
MISSING  There is no evidence file at all.                                         1
======== ====================================================================== ====

PENDING exits zero so that a branch can be worked on before the engine has run. It is
never rendered as a pass, and ``scripts/check_real_engine_validation.py`` is what refuses
to let PENDING alone satisfy the gate.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_desktop_validation_freshness import (
    compute_model_source_hash,
    model_source_files,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_FILE = REPO_ROOT / "powerbi" / "validation" / "fabric_validation_results.json"

STATUS_EXIT_CODES: dict[str, int] = {
    "PASSED": 0,
    "PENDING": 0,
    "STALE": 1,
    "FAILED": 1,
    "MISSING": 1,
}


def load_evidence() -> tuple[dict[str, Any] | None, str | None]:
    """Return the parsed evidence file and an error message, either of which is None."""
    if not EVIDENCE_FILE.is_file():
        return None, None
    try:
        loaded = json.loads(EVIDENCE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, f"is not valid JSON: {error}"
    if not isinstance(loaded, dict):
        return None, "does not contain a JSON object"
    return loaded, None


def _classify_without_a_hash(recorded_result: str) -> tuple[str, str]:
    """Classify evidence that records no model source hash."""
    if recorded_result == "pending":
        return (
            "PENDING",
            "the evidence file records no model source hash and no Fabric run. This is "
            "the expected state before the model has been deployed and validated; it is "
            "not a passing result.",
        )
    return (
        "STALE",
        f"the evidence file records result {recorded_result!r} but no model source hash, "
        "so there is nothing to check it against. Re-run the validation.",
    )


def _classify_completed(evidence: dict[str, Any], recorded_result: str) -> tuple[str, str]:
    """Classify evidence whose recorded hash matches the model on disk."""
    failed = evidence.get("failed_checks") or []
    if recorded_result == "passed":
        differences = evidence.get("sql_to_dax_differences") or []
        if failed or differences:
            return (
                "FAILED",
                f"the evidence file claims 'passed' but lists {len(failed)} failed "
                f"check(s) and {len(differences)} SQL-to-DAX difference(s). A result that "
                "contradicts its own detail is not a pass.",
            )
        return (
            "PASSED",
            f"Fabric validated this exact model definition at {evidence.get('validated_at')}.",
        )
    if recorded_result == "failed":
        return "FAILED", f"the last Fabric validation failed, with {len(failed)} failed check(s)."
    if recorded_result == "pending":
        return (
            "PENDING",
            "the evidence file records a model source hash but no completed run. Re-run "
            "the validation.",
        )
    return "STALE", f"unrecognised overall_result {recorded_result!r}."


def classify(evidence: dict[str, Any] | None, current_hash: str) -> tuple[str, str]:
    """Return ``(state, explanation)`` for the Fabric evidence against *current_hash*."""
    if evidence is None:
        return (
            "MISSING",
            "there is no Fabric validation evidence file. Run "
            "scripts/validate_powerbi_fabric.py, or record a deliberate pending "
            "placeholder.",
        )

    recorded_result = str(evidence.get("overall_result", "")).lower()
    recorded_hash = evidence.get("model_source_hash")

    if not recorded_hash:
        return _classify_without_a_hash(recorded_result)

    if str(recorded_hash) != current_hash:
        return (
            "STALE",
            "the semantic model has changed since Fabric validated it. Recorded "
            f"{str(recorded_hash)[:16]}..., current {current_hash[:16]}.... Re-deploy and "
            "re-validate; the recorded result describes a model that no longer exists.",
        )

    return _classify_completed(evidence, recorded_result)


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser for this script."""
    parser = argparse.ArgumentParser(
        description=(
            "Report whether the recorded Microsoft Fabric validation still describes the "
            "semantic model that is committed. Power BI Desktop and Fabric are never "
            "launched here; this only reads files and compares a hash."
        )
    )
    parser.add_argument(
        "--print-hash",
        action="store_true",
        help=(
            "Print only the current model source hash and exit 0. This is how "
            "scripts/validate_powerbi_fabric.py and validate_powerbi_model.ps1 record the "
            "same value CI recomputes, from one implementation rather than two."
        ),
    )
    parser.add_argument("--quiet", action="store_true", help="Print only the status line.")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Classify the Fabric evidence and exit with the state's code."""
    args = build_parser().parse_args(argv)

    files = model_source_files()
    if not files:
        print(
            "error: no semantic model definition found; cannot compute a model source hash",
            file=sys.stderr,
        )
        return 2
    current_hash = compute_model_source_hash(files)

    if args.print_hash:
        print(current_hash)
        return 0

    evidence, error = load_evidence()
    if error is not None:
        print(f"error: {EVIDENCE_FILE.relative_to(REPO_ROOT)} {error}", file=sys.stderr)
        return 1

    state, explanation = classify(evidence, current_hash)

    if not args.quiet:
        print("ARPI Microsoft Fabric validation evidence (nothing is deployed or launched here)")
        print(f"  evidence file     : {EVIDENCE_FILE.relative_to(REPO_ROOT)}")
        print(f"  files hashed      : {len(files)}")
        print(f"  model source hash : {current_hash}")
        if evidence is not None:
            recorded = evidence.get("model_source_hash")
            print(f"  recorded result   : {evidence.get('overall_result')}")
            print(f"  recorded hash     : {recorded if recorded else 'None'}")
            if evidence.get("workspace_id"):
                print(f"  workspace         : {evidence.get('workspace_id')}")
            if evidence.get("semantic_model_id"):
                print(f"  semantic model    : {evidence.get('semantic_model_id')}")
        print()

    print(f"STATUS: {state} -- {explanation}")
    return STATUS_EXIT_CODES[state]


if __name__ == "__main__":
    raise SystemExit(main())
