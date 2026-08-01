#!/usr/bin/env python3
"""Regenerate the capability blocks embedded in the governing documents.

A document states implementation status in two registers. One is human reasoning -- why a
gate is closed, what a limitation means for a reader -- and that must stay hand-written.
The other is a table of counts and statuses, which is exactly what goes stale.

Only the second is generated, and only between explicit markers:

    <!-- ARPI:CAPABILITIES:BEGIN semantic-model -->
    ...generated...
    <!-- ARPI:CAPABILITIES:END semantic-model -->

Everything outside a marked block is left untouched. No document is generated whole, and
the generated content is ordinary readable Markdown rather than an opaque payload.

Usage:
    python scripts/generate_project_capabilities.py            # rewrite the blocks
    python scripts/generate_project_capabilities.py --check    # fail if any is stale

`--check` is what CI runs: it regenerates in memory and compares, so a count that moved
without the documents being regenerated fails the build rather than shipping.

Standard library only, and no package import: `repository-checks` runs on a bare
interpreter with nothing installed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from project_capabilities import (
    REPO_ROOT,
    DerivedEvidence,
    derive_evidence,
    load_declared,
)

BEGIN = "<!-- ARPI:CAPABILITIES:BEGIN {name} -->"
END = "<!-- ARPI:CAPABILITIES:END {name} -->"

_BLOCK = re.compile(
    r"(?P<begin><!-- ARPI:CAPABILITIES:BEGIN (?P<name>[a-z0-9-]+) -->)"
    r"(?P<body>.*?)"
    r"(?P<end><!-- ARPI:CAPABILITIES:END (?P=name) -->)",
    re.DOTALL,
)


def _yes_no(value: bool) -> str:
    return "Yes" if value else "No"


def _json_ish(value: str | None) -> str:
    """Render a value the way the evidence file spells it, not the way Python repr does.

    A generated block is read alongside the JSON it summarises, so `null` is the honest
    rendering of an absent timestamp. `None` would send a reader looking for a Python
    object that is not there.
    """
    return "null" if value is None else f"`{value}`"


def _semantic_model_block(evidence: DerivedEvidence, declared: dict[str, Any]) -> str:
    """What of the Power BI layer exists, and what has been proven about it."""
    engines = declared.get("real_engine_validation", {})
    return "\n".join(
        [
            "",
            "| Artefact | Count | What it means |",
            "|---|---:|---|",
            f"| PBIP project files | {evidence.pbip_project_files} | The project and its "
            "semantic-model definition exist in source control. |",
            f"| TMDL files | {evidence.tmdl_files} | The model is stored as readable text, "
            "not a binary. |",
            f"| Semantic tables | {evidence.semantic_tables} | Imported reporting views plus "
            "measure-only tables. |",
            f"| Relationships | {evidence.relationships} | Declared in TMDL and statically "
            "checked. |",
            f"| DAX measures | {evidence.measures} | Written and statically checked. **Never "
            "evaluated by an engine.** |",
            f"| Report pages | {evidence.report_pages} | The report is a PBIR shell. A "
            "dashboard does not exist. |",
            "",
            "**Source exists; runtime is unproven.** Every figure above is read from the "
            "repository, and every one of them describes *source*. Static parsing is not "
            "execution.",
            "",
            "| Real-engine path | Declared | Evidence |",
            "|---|---|---|",
            f"| Power BI Desktop | {engines.get('desktop', 'unknown')} | "
            f"`validated_at` is {_json_ish(evidence.desktop.validated_at)} |",
            f"| Microsoft Fabric | {engines.get('fabric', 'unknown')} | "
            f"`validated_at` is {_json_ish(evidence.fabric.validated_at)} |",
            "",
            f"An engine has run: **{_yes_no(evidence.any_engine_has_run)}**. "
            "`ADR-0008-real-engine-validation-paths` accepts either path and requires one of "
            "them before Lifecycle Phase 5 can complete. (This block is generated into "
            "documents at several depths, so it names the record rather than linking to it: "
            "one relative link cannot resolve from all of them.)",
            "",
        ]
    )


def _warehouse_block(evidence: DerivedEvidence, _declared: dict[str, Any]) -> str:
    """What of the database layer is implemented, as opposed to specified."""
    return "\n".join(
        [
            "",
            "| Layer | Count | Status |",
            "|---|---:|---|",
            f"| Dimension merge scripts | {evidence.dimension_merge_scripts} | Implemented "
            "and exercised by the integration suite. |",
            f"| Fact DDL scripts | {evidence.fact_ddl_scripts} | Implemented. |",
            f"| Fact load scripts | {evidence.fact_load_scripts} | Implemented. Facts are "
            "**not** merely planned. |",
            f"| Reporting views | {evidence.reporting_views} | The only surface the semantic "
            "model may read. |",
            f"| Audit row-count layers recorded | {evidence.audit_layers_recorded} of 5 | "
            "`source`, `raw`, `staging`, `warehouse`, `rejected`. |",
            f"| Forward migrations | {evidence.migrations} | Ordered, immutable once "
            "released, recorded in `audit.schema_migration`. |",
            "",
        ]
    )


#: Which block goes where. A document may carry more than one.
GENERATORS = {
    "semantic-model": _semantic_model_block,
    "warehouse": _warehouse_block,
}


def documents_with_blocks() -> list[Path]:
    """Every tracked Markdown file carrying at least one capability marker."""
    found: list[Path] = []
    for path in sorted(REPO_ROOT.rglob("*.md")):
        relative = path.relative_to(REPO_ROOT).as_posix()
        if relative.startswith(("node_modules/", ".next/", "portfolio/node_modules/")):
            continue
        if "ARPI:CAPABILITIES:BEGIN" in path.read_text(encoding="utf-8"):
            found.append(path)
    return found


def render(text: str, evidence: DerivedEvidence, declared: dict[str, Any]) -> tuple[str, list[str]]:
    """Replace every marked block's body. Returns the new text and any unknown names."""
    unknown: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        name = match.group("name")
        generator = GENERATORS.get(name)
        if generator is None:
            unknown.append(name)
            return match.group(0)
        return match.group("begin") + generator(evidence, declared) + match.group("end")

    return _BLOCK.sub(_replace, text), unknown


def main() -> int:
    """Regenerate, or verify, every capability block.

    Returns:
        ``0`` when every block is current (or was rewritten); ``1`` when ``--check`` found
        a stale block or an unknown block name.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; fail when a block is out of date",
    )
    arguments = parser.parse_args()

    evidence = derive_evidence()
    declared = load_declared()
    documents = documents_with_blocks()

    print("ARPI capability block generation")
    print(f"  documents with blocks : {len(documents)}")
    print(f"  known block names     : {', '.join(sorted(GENERATORS))}")

    stale: list[str] = []
    rewritten = 0
    for path in documents:
        original = path.read_text(encoding="utf-8")
        updated, unknown = render(original, evidence, declared)
        relative = path.relative_to(REPO_ROOT).as_posix()
        for name in unknown:
            print(
                f"error: {relative} declares an unknown block name {name!r}. "
                f"Add a generator for it in {Path(__file__).name}.",
                file=sys.stderr,
            )
            stale.append(relative)
        if updated == original:
            continue
        if arguments.check:
            stale.append(relative)
        else:
            path.write_text(updated, encoding="utf-8")
            rewritten += 1

    if arguments.check and stale:
        print(
            "\nFAILED: generated capability blocks are out of date in:\n  "
            + "\n  ".join(sorted(set(stale)))
            + "\n\nRun `python scripts/generate_project_capabilities.py` and commit the result.",
            file=sys.stderr,
        )
        return 1

    if arguments.check:
        print("\nOK: every generated capability block is current.")
    else:
        print(f"\nOK: rewrote {rewritten} document(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
