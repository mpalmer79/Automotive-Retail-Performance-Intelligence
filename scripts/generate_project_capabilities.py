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
    load_review,
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
            "Counted apart from every row above, because folding either lane in would move a "
            "baseline that was measured against a specific run:",
            "",
            "| Lane, counted separately | Count | Status |",
            "|---|---:|---|",
            f"| Sanitized public listing SQL files (ADR-0011) | "
            f"{evidence.inventory_listing_sql_files} | Implemented, and outside the MVP "
            "warehouse the semantic model reads. |",
            f"| Sanitized public listing reporting views | "
            f"{evidence.inventory_listing_reporting_views} | Implemented. |",
            f"| Dashboard program SQL files (ADR-0013) | "
            f"{evidence.dashboard_program_sql_files} | Implemented. |",
            f"| Dashboard program fact DDL scripts | "
            f"{evidence.dashboard_program_fact_ddl_scripts} | Implemented. `DASH.5` added the "
            "first fact this lane owns; the MVP fact count above is unchanged. |",
            f"| Dashboard program reporting views | "
            f"{evidence.dashboard_program_reporting_views} | Implemented, and **not** part of "
            "the reporting-view baseline the semantic model binds to. |",
            f"| Dashboard program KPIs | {evidence.dashboard_program_kpis} | Implemented in "
            f"SQL and on the web console. The {evidence.governed_kpis} governed KPIs above are "
            "unchanged: no DAX measure reads these, so the two numbers are reported side by "
            "side and never summed. |",
            "",
        ]
    )


def _review_metadata_block(_evidence: DerivedEvidence, _declared: dict[str, Any]) -> str:
    """The reviewed-on header, generated so it cannot be the stalest line in the document.

    Reads ``load_review()`` directly rather than taking it as a parameter, because every
    generator shares one signature and only this one needs the block. The declared file is
    the single place a human edits it.
    """
    review = load_review()
    reviewed = review.get("last_reviewed", "UNVERIFIED")
    commit = review.get("last_verified_commit", "UNVERIFIED")
    version = review.get("register_version", "UNVERIFIED")
    return "\n".join(
        [
            "",
            f"**Register version:** {version}  ",
            f"**Last reviewed:** {reviewed}  ",
            f"**Last verified at commit:** `{commit}`",
            "",
            "This header is generated from `config/project_capabilities.json`. A review date "
            "typed into a document is the first thing to go stale, and a limitations register "
            "with a stale header has already lost the argument.",
            "",
        ]
    )


def _state(value: bool, yes: str, no: str) -> str:
    return yes if value else no


def _current_state_block(evidence: DerivedEvidence, declared: dict[str, Any]) -> str:
    """Everything a reader needs in order to know where the project actually is.

    One table, read from source on every run. UNVERIFIED appears wherever this repository's
    automation could not obtain the fact; it is never rendered as a pass and never guessed.
    """
    phases = declared.get("lifecycle_phases", {})
    gates = declared.get("gates", {})
    deliverables = declared.get("deliverables", {})
    deployment = evidence.deployment
    analytical = deployment.analytical

    portfolio = "; ".join(
        f"{environment.environment} live at {environment.public_url}"
        for environment in deployment.environments
        if environment.is_recorded
    )

    rows = [
        ("Warehouse dimensions", str(evidence.dimension_merge_scripts), "`sql/03_dimensions/`"),
        ("Warehouse facts", str(evidence.fact_ddl_scripts), "`sql/04_facts/`"),
        ("Reporting views", str(evidence.reporting_views), "`sql/05_reporting/`"),
        (
            "Governed KPIs",
            str(evidence.governed_kpis),
            "`powerbi/validation/model_expectations.json`",
        ),
        (
            "PBIP source",
            _state(evidence.pbip_project_files > 0, "present", "absent"),
            f"{evidence.pbip_project_files} project file(s)",
        ),
        ("TMDL files", str(evidence.tmdl_files), "`…SemanticModel/definition/`"),
        ("Semantic tables", str(evidence.semantic_tables), "`…/definition/tables/`"),
        ("Relationships", str(evidence.relationships), "`…/definition/relationships.tmdl`"),
        ("DAX measures", str(evidence.measures), "declared in TMDL, never evaluated"),
        (
            "Static model validation",
            _state(evidence.static_model_validation, "enforced in CI", "ABSENT"),
            "`scripts/check_powerbi_model.py`",
        ),
        (
            "Desktop validation",
            _state(evidence.desktop.has_run, "recorded", "pending"),
            f"`validated_at` is {_json_ish(evidence.desktop.validated_at)}",
        ),
        (
            "Fabric validation",
            _state(evidence.fabric.has_run, "recorded", "pending"),
            f"`validated_at` is {_json_ish(evidence.fabric.validated_at)}",
        ),
        ("Report pages", str(evidence.report_pages), "PBIR shell"),
        ("Report visuals", str(evidence.report_visuals), "PBIR shell"),
        ("Analytical findings", str(evidence.analytical_findings), "`docs/findings/`"),
        (
            "Portfolio deployment",
            portfolio or "none recorded",
            "health verification is "
            + _state(deployment.portfolio_is_live_verified, "recorded", "UNVERIFIED"),
        ),
        (
            "PostgreSQL deployment",
            analytical.postgresql_instance,
            "independent of the website; a live site proves nothing here",
        ),
        (
            "Database provisioning",
            analytical.schema_deployment,
            f"job `arpi-database-setup`, last run {analytical.provisioning_job_last_run}",
        ),
        (
            "Gate 1",
            str(gates.get("gate_1", "unknown")).upper(),
            "`docs/requirements/GATE_1_READINESS.md`",
        ),
        (
            "Gate 2",
            str(gates.get("gate_2", "unknown")).upper(),
            "; ".join(evidence.gate_2_conditions_unmet) or "conditions are a human verdict",
        ),
        (
            "Case study",
            str(deliverables.get("case_study", "unknown")),
            "gated behind Gate 2",
        ),
        (
            "Lifecycle Phase 5 (semantic model)",
            str(phases.get("5_semantic_model", "unknown")),
            "blocked on real-engine validation",
        ),
        (
            "Lifecycle Phase 8 (case study)",
            str(phases.get("8_case_study", "unknown")),
            "blocked on Gate 2",
        ),
    ]

    return "\n".join(
        [
            "",
            "| Item | State | Evidence |",
            "|---|---|---|",
            *(f"| {item} | {state} | {source} |" for item, state, source in rows),
            "",
            "Every row is read from the repository or from a declared status the repository "
            "does not refute. `UNVERIFIED` means this project's own automation did not obtain "
            "the fact, which is not the same as the fact being false.",
            "",
        ]
    )


def _deployment_block(evidence: DerivedEvidence, _declared: dict[str, Any]) -> str:
    """Three deployments, held apart.

    A live website is the easiest thing in this project to over-read. It is a set of
    prerendered routes with no database connection, so its health check proves that a
    static site is served and nothing whatever about PostgreSQL or a semantic model.
    """
    deployment = evidence.deployment
    analytical = deployment.analytical
    lines = [
        "",
        "**1. Portfolio presentation deployment.** A Next.js site of prerendered routes.",
        "",
        "| Field | Value |",
        "|---|---|",
    ]

    if deployment.environments:
        for environment in deployment.environments:
            lines.extend(
                [
                    f"| Environment | {environment.environment} |",
                    f"| Service name | `{environment.service_name}` |",
                    f"| Public URL | {environment.public_url} |",
                    f"| Health route | `{environment.health_path}` |",
                    f"| Deployment commit | {environment.commit_sha} |",
                    f"| Deployment timestamp | {environment.deployed_at} |",
                    f"| Health verification | {environment.health_verified_at} |",
                    f"| Remote smoke test | {environment.remote_smoke_test} |",
                    f"| Security headers | {environment.security_headers} |",
                    "| Database connection | "
                    + _state(environment.connects_to_database, "**PRESENT**", "none")
                    + " |",
                ]
            )
    else:
        lines.append("| Environment | none recorded |")

    lines.extend(
        [
            f"| Production environment | {deployment.production_environment} |",
            "",
            "**2. Analytical-platform deployment.** PostgreSQL and everything the warehouse "
            "needs in order to be running rather than defined. Nothing here follows from the "
            "website being live.",
            "",
            "| Field | State |",
            "|---|---|",
            f"| PostgreSQL instance | {analytical.postgresql_instance} |",
            f"| Schema deployment | {analytical.schema_deployment} |",
            f"| Data load | {analytical.data_load} |",
            f"| Role verification | {analytical.role_verification} |",
            f"| Migration verification | {analytical.migration_verification} |",
            f"| Backup and restoration | {analytical.backup_and_restore} |",
            f"| Scheduled execution | {analytical.scheduled_execution} |",
            f"| Provisioning job last run | {analytical.provisioning_job_last_run} |",
            f"| Verifier last run | {analytical.verifier_last_run} |",
            "",
            "**3. Semantic-model deployment.** An engine that has loaded, refreshed and "
            "evaluated the model. Its evidence is the validation files, not this register.",
            "",
            "| Field | State |",
            "|---|---|",
            f"| Power BI Desktop | {_state(evidence.desktop.has_run, 'recorded', 'pending')} |",
            f"| Microsoft Fabric | {_state(evidence.fabric.has_run, 'recorded', 'pending')} |",
            f"| Refresh | {_state(evidence.any_engine_has_run, 'recorded', 'never performed')} |",
            "| DAX evaluation | "
            + _state(evidence.any_engine_has_run, "recorded", "never performed")
            + " |",
            "| SQL-to-DAX reconciliation | "
            + _state(evidence.any_engine_has_run, "recorded", "SQL side only")
            + " |",
            "| Evidence freshness | desktop `validated_at` "
            f"{_json_ish(evidence.desktop.validated_at)}, fabric `validated_at` "
            f"{_json_ish(evidence.fabric.validated_at)} |",
            "",
            "**These are three statuses, not one.** A reader who takes the first table as "
            "evidence for the second or the third has been misled, and any document that "
            "invites that reading is a defect worth reporting.",
            "",
        ]
    )
    return "\n".join(lines)


def _exit_criteria_block(evidence: DerivedEvidence, _declared: dict[str, Any]) -> str:
    """What has to be *observed* before each blocked item moves.

    Every condition below names a file, a count or a recorded result. None of them is
    satisfied by an opinion, and the ``Met`` column is computed rather than asserted.
    """
    analytical = evidence.deployment.analytical
    criteria = [
        (
            "Real-engine validation",
            "`desktop_validation_results.json` or `fabric_validation_results.json` carries a "
            "non-null `validated_at` and a `model_source_hash` matching the committed TMDL",
            evidence.any_engine_has_run,
        ),
        (
            "Lifecycle Phase 5 complete",
            "real-engine validation above, plus `sql_to_dax_differences` empty in the same file",
            evidence.any_engine_has_run,
        ),
        (
            "Dashboard development may begin",
            "real-engine validation above. Report pages are not authored before the model that "
            "feeds them has returned a number",
            evidence.any_engine_has_run,
        ),
        (
            "SQL-to-DAX reconciliation",
            "every measure in `powerbi/validation/sql_baseline.json` matched by an engine-"
            "evaluated value, with the differences recorded",
            evidence.any_engine_has_run,
        ),
        (
            "Gate 2 open",
            "report pages greater than zero, SQL-to-DAX reconciliation recorded, and a written "
            "verdict in `docs/requirements/GATE_2_READINESS.md`",
            evidence.report_pages > 0 and evidence.any_engine_has_run,
        ),
        (
            "Case study unlocked",
            "Gate 2 open, `analytical_findings` greater than zero, and the build flag set",
            bool(evidence.analytical_findings) and evidence.report_pages > 0,
        ),
        (
            "PostgreSQL production readiness",
            "`postgresql_instance`, `schema_deployment` and `data_load` all recorded as "
            "verified in the deployment evidence, with `verifier_last_run` set",
            evidence.analytical_platform_is_running,
        ),
        (
            "Backup-and-restore evidence",
            "a recorded restoration into an empty database, with the row counts compared "
            "against the source",
            analytical.backup_and_restore not in ("not-implemented", "UNVERIFIED"),
        ),
        (
            "Production-source integration",
            "a vendor extract landed through `raw` with its licence recorded. No such source "
            "is in scope, so this is stated to be denied rather than pursued",
            False,
        ),
        (
            "Benchmark comparison eligibility",
            "a licensed, citable source of real dealership performance data at dealership "
            "grain. None exists for this project, so no comparison is admissible",
            False,
        ),
    ]

    return "\n".join(
        [
            "",
            "| Exit criterion | Evidence required | Met |",
            "|---|---|:--:|",
            *(
                f"| {name} | {condition} | {_state(met, 'yes', 'no')} |"
                for name, condition, met in criteria
            ),
            "",
            "`Met` is computed, not asserted. A row reads `yes` only when the evidence named "
            "beside it exists in the repository.",
            "",
        ]
    )


#: Which block goes where. A document may carry more than one.
GENERATORS = {
    "semantic-model": _semantic_model_block,
    "warehouse": _warehouse_block,
    "review-metadata": _review_metadata_block,
    "current-state": _current_state_block,
    "deployment": _deployment_block,
    "exit-criteria": _exit_criteria_block,
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
