"""Enforce ADR-0008: Lifecycle Phase 5 needs a current pass from a real engine.

WHAT THIS IS FOR
----------------
``scripts/check_powerbi_model.py`` proves the semantic model is **well-formed**. It cannot
prove the model is **correct**: nine thousand static assertions passing reads like thorough
validation, and it is thorough validation of the wrong thing. Only a Microsoft
semantic-model engine can load the TMDL, refresh it against real data and return a number.

ADR-0008 accepts two engines for that, of equal standing:

* **Power BI Desktop** — evidence in ``powerbi/validation/desktop_validation_results.json``
* **Microsoft Fabric** — evidence in ``powerbi/validation/fabric_validation_results.json``

The proof obligation is identical, so **either** satisfies the gate. A project with a
current Desktop pass and no Fabric result is fully validated, and the reverse is equally
true. This script composes the two per-engine freshness checks and applies the policy the
branch calls for.

THE POLICY
----------
Without ``--require-pass`` (feature branches, work in progress):

* PENDING on both engines is tolerated — the work is not finished and does not claim to be.
* STALE or FAILED on either engine fails, because those are not "not yet done", they are
  "was done, and either has been invalidated or did not work".

With ``--require-pass`` (``main``, and any branch claiming Phase 5 is complete):

* at least one engine must be **PASSED** against the current model source hash;
* PENDING everywhere fails, because static validation alone must never satisfy the gate.

WHY ``--require-pass`` IS NOT YET ON FOR ``main``
-------------------------------------------------
Turning it on before a passing real-engine result exists would break ``main`` for a
condition nobody can currently clear, which teaches people to bypass the check. The CI
workflow therefore runs this script without the flag and says so. The change is one line
in ``.github/workflows/ci.yml``, and the backlog item that owns it is explicit that the
flag goes on in the same change that lands the first passing evidence.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_desktop_validation_freshness as desktop
import check_fabric_validation_freshness as fabric

REPO_ROOT = Path(__file__).resolve().parents[1]

#: States that mean "an engine has spoken and the answer was bad". These fail on any
#: branch, because a stale pass is more dangerous than no pass.
BLOCKING_STATES = frozenset({"STALE", "FAILED"})


def evaluate() -> tuple[dict[str, tuple[str, str]], str]:
    """Return each engine's state and the current model source hash."""
    files = desktop.model_source_files()
    current_hash = desktop.compute_model_source_hash(files)

    desktop_evidence, desktop_error = desktop.load_evidence()
    fabric_evidence, fabric_error = fabric.load_evidence()

    states: dict[str, tuple[str, str]] = {}
    if desktop_error is not None:
        states["Power BI Desktop"] = ("FAILED", f"evidence file {desktop_error}")
    else:
        states["Power BI Desktop"] = desktop.classify(desktop_evidence, current_hash)
    if fabric_error is not None:
        states["Microsoft Fabric"] = ("FAILED", f"evidence file {fabric_error}")
    else:
        states["Microsoft Fabric"] = fabric.classify(fabric_evidence, current_hash)
    return states, current_hash


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser for this script."""
    parser = argparse.ArgumentParser(
        description=(
            "Enforce ADR-0008's real-engine validation gate across both accepted engines. "
            "Neither Power BI Desktop nor Microsoft Fabric is launched or contacted here; "
            "this reads two evidence files and compares a hash."
        )
    )
    parser.add_argument(
        "--require-pass",
        action="store_true",
        help=(
            "Require at least one engine to be PASSED against the current model source "
            "hash. This is the main-branch policy. Without it, PENDING is tolerated so "
            "that a branch can be worked on before an engine has run."
        ),
    )
    parser.add_argument("--quiet", action="store_true", help="Print only the verdict line.")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Report both engines' states and apply the requested policy."""
    args = build_parser().parse_args(argv)

    files = desktop.model_source_files()
    if not files:
        print("error: no semantic model definition found", file=sys.stderr)
        return 2

    states, current_hash = evaluate()

    if not args.quiet:
        print("ARPI real-engine validation gate (ADR-0008)")
        print(f"  model source hash : {current_hash}")
        policy = "require a current pass" if args.require_pass else "permissive (in progress)"
        print(f"  policy            : {policy}")
        print()
        for engine, (state, explanation) in states.items():
            print(f"  {engine:<18} {state}")
            print(f"  {'':<18} {explanation}")
        print()

    blocking = {engine: state for engine, (state, _) in states.items() if state in BLOCKING_STATES}
    if blocking:
        for engine, state in blocking.items():
            print(f"VERDICT: FAIL -- {engine} evidence is {state}.")
        print(
            "A stale or failed real-engine result is not 'not yet validated'. Re-run that "
            "engine's validation, or reset its evidence to a deliberate pending placeholder."
        )
        return 1

    passing = [engine for engine, (state, _) in states.items() if state == "PASSED"]
    if passing:
        print(f"VERDICT: PASS -- validated by {', '.join(passing)} against the current model.")
        return 0

    if args.require_pass:
        print(
            "VERDICT: FAIL -- no engine has validated the current semantic model. Static "
            "validation alone does not complete Lifecycle Phase 5 (ADR-0008). Run either "
            "scripts/validate_powerbi_fabric.py or scripts/validate_powerbi_model.ps1."
        )
        return 1

    print(
        "VERDICT: PENDING -- no engine has validated this model yet. Tolerated on a feature "
        "branch; it will not be tolerated once --require-pass is on. This is NOT a pass."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
