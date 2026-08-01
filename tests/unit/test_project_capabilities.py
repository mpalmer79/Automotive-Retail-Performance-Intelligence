"""The capability register derives implementation status and rejects contradictions.

Implementation status used to live only in prose, in several documents written at
different times, and prose does not fail a build when it goes stale. It went stale in ten
places: "no semantic model exists" beside thirty TMDL files, "No DAX measure exists"
beside forty-nine measures, "only three are ever recorded" beside five recorded layers.

These tests cover the machinery that makes those statements impossible to leave behind:
that the derivation reads the repository correctly, that each contradiction rule fires on
a claim the evidence refutes and stays silent when it does not, and -- most importantly --
that no rule can ever loosen a gate.
"""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from generate_project_capabilities import (  # noqa: E402  (path set above)
    GENERATORS,
    render,
)
from project_capabilities import (  # noqa: E402  (path set above)
    AUDIT_LAYERS,
    DerivedEvidence,
    EngineEvidence,
    build_capabilities,
    check_declarations,
    check_website_agreement,
    derive_evidence,
    find_stale_claims,
    load_declared,
)

PENDING = EngineEvidence(
    path="powerbi/validation/fabric_validation_results.json",
    exists=True,
    validated_at=None,
    model_source_hash=None,
    overall_status=None,
)
PASSED = EngineEvidence(
    path="powerbi/validation/fabric_validation_results.json",
    exists=True,
    validated_at="2026-08-01T00:00:00Z",
    model_source_hash="abc123",
    overall_status="passed",
)


@pytest.fixture(scope="module")
def evidence() -> DerivedEvidence:
    return derive_evidence()


def _fake(**overrides: int | bool | EngineEvidence) -> DerivedEvidence:
    """A derived-evidence value with everything present, then selectively overridden."""
    base = DerivedEvidence(
        pbip_project_files=2,
        tmdl_files=30,
        semantic_tables=26,
        relationships=42,
        measures=49,
        report_pages=0,
        fact_ddl_scripts=5,
        fact_load_scripts=5,
        dimension_merge_scripts=8,
        reporting_views=28,
        audit_layers_recorded=5,
        migrations=2,
        desktop=PENDING,
        fabric=PENDING,
        railway_website_config=True,
        railway_database_job_config=True,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


# --------------------------------------------------------------------------------------
# Derivation
# --------------------------------------------------------------------------------------


def test_the_semantic_model_source_is_detected(evidence: DerivedEvidence) -> None:
    assert evidence.semantic_model_source_exists
    assert evidence.tmdl_files > 0
    assert evidence.pbip_project_files > 0


def test_measures_relationships_and_tables_are_counted(evidence: DerivedEvidence) -> None:
    """Counts are read from TMDL, never declared, so they cannot go stale."""
    assert evidence.measures > 0
    assert evidence.relationships > 0
    assert evidence.semantic_tables > 0


def test_the_five_audit_layers_are_detected(evidence: DerivedEvidence) -> None:
    """DOC-23 closed this gap; the derivation reads the loader rather than a document."""
    assert evidence.audit_layers_recorded == len(AUDIT_LAYERS)


def test_the_fact_loads_are_detected(evidence: DerivedEvidence) -> None:
    assert evidence.fact_load_scripts > 0
    assert evidence.dimension_merge_scripts > 0


def test_report_pages_are_zero(evidence: DerivedEvidence) -> None:
    """The one count that must stay honest in the other direction.

    A PBIR shell with no pages is not a dashboard. If this ever becomes non-zero without a
    deliberate change, the deliverable declarations need revisiting.
    """
    assert evidence.report_pages == 0


def test_no_real_engine_has_run(evidence: DerivedEvidence) -> None:
    """Both evidence files record a null `validated_at`, and the register must say so."""
    assert evidence.any_engine_has_run is False
    assert evidence.desktop.has_run is False
    assert evidence.fabric.has_run is False


def test_evidence_files_alone_do_not_count_as_a_run() -> None:
    """A file that exists but records nothing is not proof that an engine ran."""
    empty = EngineEvidence(
        path="x", exists=True, validated_at=None, model_source_hash=None, overall_status=None
    )
    assert empty.has_run is False

    timestamp_only = EngineEvidence(
        path="x",
        exists=True,
        validated_at="2026-08-01T00:00:00Z",
        model_source_hash=None,
        overall_status="passed",
    )
    assert timestamp_only.has_run is False, (
        "a pass must be bound to a model source hash, or it proves nothing about which "
        "model was validated"
    )


# --------------------------------------------------------------------------------------
# The repository as it stands
# --------------------------------------------------------------------------------------


def test_the_repository_has_no_stale_claims(evidence: DerivedEvidence) -> None:
    """The check that would have caught all ten corrected statements."""
    from check_project_capabilities import tracked_text_files

    contradictions = find_stale_claims(evidence, tracked_text_files())
    assert contradictions == [], "\n".join(c.render() for c in contradictions)


def test_the_declared_status_is_consistent(evidence: DerivedEvidence) -> None:
    contradictions = check_declarations(load_declared(), evidence)
    assert contradictions == [], "\n".join(c.render() for c in contradictions)


def test_the_website_manifest_agrees_with_the_register(evidence: DerivedEvidence) -> None:
    """Two independent derivations of one fact must not disagree.

    The website's manifest is generated in TypeScript from the same repository. Two
    derivations is the arrangement that produced the stale prose, so they are compared.
    """
    contradictions = check_website_agreement(evidence)
    assert contradictions == [], "\n".join(c.render() for c in contradictions)


# --------------------------------------------------------------------------------------
# Contradiction rules fire, and only when they should
# --------------------------------------------------------------------------------------


def test_a_reintroduced_stale_claim_is_caught(tmp_path: Path) -> None:
    document = REPO_ROOT / "LIMITATIONS.md"
    original = document.read_text(encoding="utf-8")
    try:
        document.write_text(original + "\n\nno semantic model exists\n", encoding="utf-8")
        found = find_stale_claims(_fake(), [document])
        assert [c.rule for c in found] == ["semantic-model-source-exists"]
        assert "30 TMDL files" in found[0].evidence
    finally:
        document.write_text(original, encoding="utf-8")


def test_a_claim_is_permitted_once_the_evidence_supports_it(tmp_path: Path) -> None:
    """A semantic check, not a banned-phrase list.

    If the semantic model source were removed, "no semantic model exists" would become
    true again and the rule must stop forbidding it. A phrase blacklist could not express
    that, and would force a document to stay wrong in the other direction.
    """
    document = tmp_path / "doc.md"
    document.write_text("no semantic model exists\n", encoding="utf-8")

    without_model = _fake(tmdl_files=0, pbip_project_files=0)
    assert find_stale_claims(without_model, [document]) == []


def test_declaring_an_engine_passed_without_evidence_fails() -> None:
    declared = {"real_engine_validation": {"desktop": "pending", "fabric": "passed"}}
    found = check_declarations(declared, _fake())
    assert [c.rule for c in found] == ["engine-passed-needs-evidence"]


def test_declaring_an_engine_passed_with_evidence_is_accepted() -> None:
    declared = {"real_engine_validation": {"desktop": "pending", "fabric": "passed"}}
    assert check_declarations(declared, _fake(fabric=PASSED)) == []


def test_a_pass_bound_to_no_model_hash_is_rejected() -> None:
    """Evidence must be pinned to the model it validated, or it proves nothing."""
    unpinned = replace(PASSED, model_source_hash=None)
    declared = {"real_engine_validation": {"fabric": "passed"}}
    found = check_declarations(declared, _fake(fabric=unpinned))
    assert [c.rule for c in found] == ["engine-passed-needs-evidence"]


def test_declaring_a_dashboard_without_report_pages_fails() -> None:
    declared = {"deliverables": {"dashboard": "complete"}}
    found = check_declarations(declared, _fake())
    assert "dashboard-needs-pages" in {c.rule for c in found}


def test_completing_phase_5_without_a_real_engine_fails() -> None:
    declared = {"lifecycle_phases": {"5_semantic_model": "complete"}}
    found = check_declarations(declared, _fake())
    assert [c.rule for c in found] == ["phase-5-needs-a-real-engine"]


def test_completing_phase_5_is_accepted_once_an_engine_has_run() -> None:
    declared = {"lifecycle_phases": {"5_semantic_model": "complete"}}
    assert check_declarations(declared, _fake(fabric=PASSED)) == []


def test_opening_gate_2_without_its_conditions_fails() -> None:
    declared = {"gates": {"gate_2": "open"}}
    found = check_declarations(declared, _fake())
    assert [c.rule for c in found] == ["gate-2-needs-its-conditions"]
    assert "no real-engine validation has run" in found[0].evidence
    assert "zero pages" in found[0].evidence


def test_gate_2_still_needs_pages_even_after_an_engine_passes() -> None:
    """One condition met is not all conditions met."""
    declared = {"gates": {"gate_2": "open"}}
    found = check_declarations(declared, _fake(fabric=PASSED))
    assert [c.rule for c in found] == ["gate-2-needs-its-conditions"]
    assert "zero pages" in found[0].evidence


def test_no_rule_can_open_a_gate_or_pass_a_validation() -> None:
    """The safety property of the whole register.

    Every rule fails an optimistic declaration. None promotes a status because a file
    appeared, so the register can tighten a claim toward the evidence and never loosen
    one. A conservative declaration must produce no findings whatever the evidence says.
    """
    conservative = {
        "lifecycle_phases": {"5_semantic_model": "in-progress"},
        "gates": {"gate_1": "open", "gate_2": "closed"},
        "real_engine_validation": {"desktop": "pending", "fabric": "pending"},
        "deliverables": {"dashboard": "not-started", "power_bi_report_pages": "not-started"},
    }
    for evidence_case in (
        _fake(),
        _fake(fabric=PASSED),
        _fake(desktop=PASSED, fabric=PASSED, report_pages=12),
    ):
        assert check_declarations(conservative, evidence_case) == []


def test_the_website_disagreeing_is_caught(tmp_path: Path) -> None:
    manifest = REPO_ROOT / "portfolio" / "src" / "generated" / "project-manifest.json"
    original = manifest.read_text(encoding="utf-8")
    try:
        document = json.loads(original)
        document["counts"]["daxMeasures"]["value"] = 1
        manifest.write_text(json.dumps(document, indent=2), encoding="utf-8")
        found = check_website_agreement(derive_evidence())
        assert [c.rule for c in found] == ["website-agrees-with-register"]
    finally:
        manifest.write_text(original, encoding="utf-8")


# --------------------------------------------------------------------------------------
# Generated documentation blocks
# --------------------------------------------------------------------------------------


def test_generated_blocks_are_current() -> None:
    """Every marked block in the repository matches what the generator produces now."""
    from generate_project_capabilities import documents_with_blocks

    evidence = derive_evidence()
    declared = load_declared()
    stale = []
    for path in documents_with_blocks():
        original = path.read_text(encoding="utf-8")
        updated, unknown = render(original, evidence, declared)
        assert unknown == [], f"{path} declares an unknown block name: {unknown}"
        if updated != original:
            stale.append(path.relative_to(REPO_ROOT).as_posix())
    assert stale == [], (
        f"stale generated blocks in {stale}. Run "
        "`python scripts/generate_project_capabilities.py` and commit the result."
    )


def test_at_least_one_document_carries_a_generated_block() -> None:
    """A generator nothing uses proves nothing."""
    from generate_project_capabilities import documents_with_blocks

    assert documents_with_blocks(), "no document carries a capability block"


def test_regeneration_is_idempotent() -> None:
    """Running the generator twice must not change the second result."""
    evidence = derive_evidence()
    declared = load_declared()
    source = (
        "before\n"
        "<!-- ARPI:CAPABILITIES:BEGIN semantic-model -->\n"
        "<!-- ARPI:CAPABILITIES:END semantic-model -->\n"
        "after\n"
    )
    once, _ = render(source, evidence, declared)
    twice, _ = render(once, evidence, declared)
    assert once == twice


def test_generation_leaves_surrounding_prose_untouched() -> None:
    """Human reasoning outside the markers is never rewritten."""
    evidence = derive_evidence()
    declared = load_declared()
    source = (
        "HUMAN PARAGRAPH ABOVE\n"
        "<!-- ARPI:CAPABILITIES:BEGIN warehouse -->\n"
        "stale content\n"
        "<!-- ARPI:CAPABILITIES:END warehouse -->\n"
        "HUMAN PARAGRAPH BELOW\n"
    )
    updated, _ = render(source, evidence, declared)
    assert updated.startswith("HUMAN PARAGRAPH ABOVE\n")
    assert updated.endswith("HUMAN PARAGRAPH BELOW\n")
    assert "stale content" not in updated


def test_an_unknown_block_name_is_reported_not_silently_skipped() -> None:
    source = (
        "<!-- ARPI:CAPABILITIES:BEGIN not-a-real-block -->\n"
        "<!-- ARPI:CAPABILITIES:END not-a-real-block -->\n"
    )
    updated, unknown = render(source, derive_evidence(), load_declared())
    assert unknown == ["not-a-real-block"]
    assert updated == source, "an unknown block must be left alone, not emptied"


def test_the_semantic_model_block_never_implies_runtime_proof() -> None:
    """The distinction the whole register exists to preserve."""
    block = GENERATORS["semantic-model"](_fake(), load_declared())
    assert "Never evaluated by an engine" in block
    assert "Static parsing is not execution" in block
    assert "An engine has run: **No**" in block


def test_the_semantic_model_block_reports_a_real_run_when_there_is_one() -> None:
    block = GENERATORS["semantic-model"](_fake(fabric=PASSED), load_declared())
    assert "An engine has run: **Yes**" in block


# --------------------------------------------------------------------------------------
# The combined register
# --------------------------------------------------------------------------------------


def test_the_register_carries_both_declared_and_derived() -> None:
    register = build_capabilities()
    assert register["schema"] == "arpi.project_capabilities/1"
    assert register["declared"], "declared status is missing"
    assert register["derived"]["measures"] > 0


def test_the_declared_file_records_no_counts() -> None:
    """Counts belong to derivation. A count here would be a second copy able to disagree.

    This is the rule that keeps the register from becoming the thing it replaced.
    """
    declared = load_declared()

    def _numbers(node: object) -> list[int]:
        if isinstance(node, bool):
            return []
        if isinstance(node, int):
            return [node]
        if isinstance(node, dict):
            return [n for key, value in node.items() if key != "_comment" for n in _numbers(value)]
        if isinstance(node, list):
            return [n for item in node for n in _numbers(item)]
        return []

    assert _numbers(declared) == [], (
        "config/project_capabilities.json declares a numeric value. Counts are derived "
        "from the repository; declaring one creates a second copy that can go stale."
    )
