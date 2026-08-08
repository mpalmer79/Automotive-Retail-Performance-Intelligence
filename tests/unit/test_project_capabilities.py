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

from deployment_evidence import (  # noqa: E402  (path set above)
    AnalyticalPlatformEvidence,
    DeployedEnvironment,
    DeploymentEvidence,
    read_deployment_evidence,
)
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
    check_fact_load_contract,
    check_review_metadata,
    check_website_agreement,
    derive_evidence,
    find_stale_claims,
    load_declared,
    load_review,
)

#: The fact-load scripts the pipeline runs on every execution, spelled out rather than
#: derived, so a test fixture cannot agree with a broken derivation by construction.
#:
#: Five MVP loads plus the dashboard program's operating-plan load, added by ``DASH.5``.
#: The sixth is listed here because the PIPELINE runs it; it is deliberately excluded
#: from the "five MVP facts" baseline the semantic model was measured against, which is
#: a claim about that model and not about this registry.
REQUIRED_FACT_LOADS = (
    "10_fact_vehicle_sale_load.sql",
    "11_fact_vehicle_inventory_snapshot_load.sql",
    "12_fact_lead_load.sql",
    "13_fact_appointment_load.sql",
    "14_fact_marketing_spend_load.sql",
    "16_fact_sales_target_load.sql",
)

#: The sanitized listing lane's fact-load script, declared by arpi.inventory.spec rather
#: than by arpi.ingestion.spec. It is spelled out here for the same reason as the five
#: above, and kept separate because the fixtures below describe an MVP-shaped repository.
LISTING_FACT_LOAD = "15_fact_vehicle_listing_snapshot_load.sql"

#: Every fact-load script the repository actually holds, across both registries. The
#: contract is that the two sets are equal: a script no registry names is never executed,
#: so it would sit in the tree looking loaded.
ALL_FACT_LOADS = tuple(sorted((*REQUIRED_FACT_LOADS, LISTING_FACT_LOAD)))

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


STAGING = DeployedEnvironment(
    environment="staging",
    service_name="arpi-portfolio",
    public_url="https://example.invalid",
    health_path="/status",
    commit_sha="UNVERIFIED",
    deployed_at="UNVERIFIED",
    health_verified_at="UNVERIFIED",
    remote_smoke_test="UNVERIFIED",
    security_headers="UNVERIFIED",
    connects_to_database=False,
)

DECLARED_ONLY = AnalyticalPlatformEvidence(
    postgresql_instance="declared",
    schema_deployment="declared",
    data_load="declared",
    role_verification="declared",
    migration_verification="declared",
    backup_and_restore="not-implemented",
    scheduled_execution="not-implemented",
    provisioning_job_last_run="UNVERIFIED",
    verifier_last_run="UNVERIFIED",
)

DEPLOYED = DeploymentEvidence(
    exists=True,
    path="deployment/evidence/portfolio_deployment.json",
    environments=(STAGING,),
    production_environment="not-created",
    analytical=DECLARED_ONLY,
)


def _fake(**overrides: object) -> DerivedEvidence:
    """A derived-evidence value with everything present, then selectively overridden."""
    base = DerivedEvidence(
        pbip_project_files=2,
        tmdl_files=30,
        semantic_tables=26,
        relationships=42,
        measures=49,
        governed_kpis=29,
        report_pages=0,
        report_visuals=0,
        analytical_findings=0,
        static_model_validation=True,
        fact_ddl_scripts=5,
        fact_load_scripts=5,
        required_fact_load_scripts=REQUIRED_FACT_LOADS,
        present_fact_load_scripts=REQUIRED_FACT_LOADS,
        fact_discovery_fails_closed=True,
        dimension_merge_scripts=8,
        reporting_views=28,
        audit_layers_recorded=5,
        migrations=2,
        desktop=PENDING,
        fabric=PENDING,
        railway_website_config=True,
        railway_database_job_config=True,
        deployment=DEPLOYED,
        fabric_is_an_accepted_validation_path=True,
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


def test_declaring_the_inventory_report_without_an_exporter_fails() -> None:
    declared = {"deliverables": {"inventory_operating_report": "implemented"}}
    found = check_declarations(declared, _fake())
    assert "inventory-report-needs-an-exporter" in {c.rule for c in found}


def test_declaring_the_inventory_report_with_its_exporter_is_accepted() -> None:
    declared = {"deliverables": {"inventory_operating_report": "implemented"}}
    evidence = _fake(inventory_report_exporter=True, inventory_listing_reporting_views=6)
    assert check_declarations(declared, evidence) == []


def test_the_two_excel_deliverables_are_checked_separately() -> None:
    """A shipped listing report must not vouch for the deferred P2.4-03 workbook.

    They are different workbooks over different lanes. The failure this guards is a reader
    -- or a later rule -- treating one Excel deliverable as evidence for the other, which
    would let the Power BI-reconciled report read as delivered while it does not exist.
    """
    shipped_listing_report = _fake(
        inventory_report_exporter=True, inventory_listing_reporting_views=6
    )
    declared = {
        "deliverables": {
            "inventory_operating_report": "implemented",
            "excel_operating_report": "deferred",
        }
    }
    assert check_declarations(declared, shipped_listing_report) == []

    # The listing exporter exists, and it still cannot carry excel_operating_report: that
    # entry stays deferred on its own evidence, which is the report pages it needs.
    assert shipped_listing_report.report_pages == 0


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


# --------------------------------------------------------------------------------------
# Declared capability must also be required capability
# --------------------------------------------------------------------------------------
# The contradiction guarded here lived in the repository: sql/04_facts/README.md declared
# all five MVP facts populated and loaded on every pipeline run, while the loader returned
# an empty list when the fact directory was absent and carried on. Both were reviewed;
# neither could fail a build.


def test_the_repository_requires_the_facts_it_declares(evidence: DerivedEvidence) -> None:
    contradictions = check_fact_load_contract(evidence)
    assert contradictions == [], "\n".join(c.render() for c in contradictions)


def test_the_required_fact_set_is_read_from_the_registry(evidence: DerivedEvidence) -> None:
    """Derived from source, so a renamed script cannot pass by editing one side.

    Both ingestion registries contribute: arpi.ingestion.spec declares the five MVP fact
    loads the pipeline runs on every execution, and arpi.inventory.spec declares the
    sanitized listing lane's, which a workbook import runs on its own cadence. The
    contract holds across both, because a script neither registry names is never executed.
    """
    assert evidence.required_fact_load_scripts == ALL_FACT_LOADS
    assert evidence.present_fact_load_scripts == ALL_FACT_LOADS
    assert set(REQUIRED_FACT_LOADS) < set(evidence.required_fact_load_scripts)
    assert LISTING_FACT_LOAD in evidence.required_fact_load_scripts
    assert evidence.fact_discovery_fails_closed is True


def test_a_loader_that_tolerates_missing_facts_is_caught() -> None:
    found = check_fact_load_contract(_fake(fact_discovery_fails_closed=False))
    assert [c.rule for c in found] == ["fact-loads-are-required-infrastructure"]
    assert "no measures" in found[0].evidence


def test_a_fact_script_no_ingestion_spec_names_is_caught() -> None:
    """An unregistered script is never executed, so it must not sit there looking loaded."""
    found = check_fact_load_contract(
        _fake(present_fact_load_scripts=(*REQUIRED_FACT_LOADS, "15_fact_service_ro_load.sql"))
    )
    assert [c.rule for c in found] == ["fact-load-contract-names-every-script"]
    assert "15_fact_service_ro_load.sql" in found[0].evidence


def test_a_required_script_missing_from_the_tree_is_caught() -> None:
    found = check_fact_load_contract(_fake(present_fact_load_scripts=REQUIRED_FACT_LOADS[1:]))
    assert [c.rule for c in found] == ["fact-load-contract-names-every-script"]
    assert REQUIRED_FACT_LOADS[0] in found[0].evidence


def test_the_rule_retires_itself_when_no_fact_load_exists() -> None:
    """A semantic check, not a permanent demand.

    With no fact-load script in the tree there is no capability being declared, and the
    rule must stay silent rather than forbid a state that has become honest again.
    """
    unimplemented = _fake(
        fact_load_scripts=0,
        present_fact_load_scripts=(),
        required_fact_load_scripts=(),
        fact_discovery_fails_closed=False,
    )
    assert check_fact_load_contract(unimplemented) == []


def test_the_structural_derivation_reads_behaviour_not_a_sentence(tmp_path: Path) -> None:
    """The guard survives a rewording of the loader and fails on a rewrite of it.

    A comment saying the load is required proves nothing; what the check reads is whether
    ``discover_fact_sql`` raises and whether any path returns an empty list.
    """
    import project_capabilities as capabilities

    fails_closed = tmp_path / "fails_closed.py"
    fails_closed.write_text(
        "def discover_fact_sql(root):\n"
        "    if not root.is_dir():\n"
        "        raise DatabaseLoadError('refused', missing_paths=[root])\n"
        "    return [root / name for name in REQUIRED_FACT_SQL]\n",
        encoding="utf-8",
    )
    fails_open = tmp_path / "fails_open.py"
    fails_open.write_text(
        "def discover_fact_sql(root):\n"
        "    # The fact loads are required infrastructure and this load cannot skip them.\n"
        "    if not root.is_dir():\n"
        "        return []\n"
        "    return sorted(root.glob('*_load.sql'))\n",
        encoding="utf-8",
    )

    original = capabilities.LOADER_SOURCE
    try:
        capabilities.LOADER_SOURCE = fails_closed
        assert capabilities._fact_discovery_fails_closed() is True
        capabilities.LOADER_SOURCE = fails_open
        assert capabilities._fact_discovery_fails_closed() is False
    finally:
        capabilities.LOADER_SOURCE = original


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


# --------------------------------------------------------------------------------------
# The three deployments, held apart
#
# A live website is the easiest claim in this project to over-read. Everything below
# exists to make the over-reading a build failure rather than a matter of wording.
# --------------------------------------------------------------------------------------


def test_the_repository_records_a_portfolio_deployment(evidence: DerivedEvidence) -> None:
    """The correction this register was extended for: the site is deployed, and said it was not."""
    assert evidence.deployment.exists, "the deployment evidence file is missing"
    assert evidence.deployment.portfolio_is_recorded


def test_recorded_and_verified_stay_separate_properties(evidence: DerivedEvidence) -> None:
    """A URL is a statement. A health verification is an observation.

    `is_live_verified` was false for as long as nothing could reach the deployment host,
    and is true now that `.github/workflows/verify-deployment.yml` runs the remote suite
    from infrastructure that can. The distinction survives the change: verification still
    requires a timestamp from a real health check, so a URL alone can never satisfy it.
    """
    assert evidence.deployment.portfolio_is_recorded
    assert evidence.deployment.portfolio_is_live_verified

    # The property is not a synonym for "a URL is present": stripping the timestamp must
    # take it back to false, or it would be proving nothing.
    stripped = replace(
        evidence.deployment,
        environments=tuple(
            replace(environment, health_verified_at="UNVERIFIED")
            for environment in evidence.deployment.environments
        ),
    )
    assert stripped.portfolio_is_recorded
    assert stripped.portfolio_is_live_verified is False


def test_a_live_website_is_not_a_running_warehouse(evidence: DerivedEvidence) -> None:
    """The distinction the whole of section 8 exists to preserve."""
    assert evidence.deployment.portfolio_is_recorded
    assert evidence.analytical_platform_is_running is False


def test_the_website_holds_no_database_connection(evidence: DerivedEvidence) -> None:
    assert evidence.deployment.portfolio_connects_to_database is False


def test_asserting_a_deployment_without_evidence_fails() -> None:
    empty = DeploymentEvidence(
        exists=True,
        path="deployment/evidence/portfolio_deployment.json",
        environments=(),
        production_environment="not-created",
        analytical=DECLARED_ONLY,
    )
    found = check_declarations(
        {"deployment": {"portfolio_website": "deployed"}}, _fake(deployment=empty)
    )
    assert [c.rule for c in found] == ["deployment-status-needs-evidence"]


def test_denying_a_deployment_the_evidence_records_fails() -> None:
    """Tightening runs in both directions: a pessimistic claim is a contradiction too."""
    found = check_declarations({"deployment": {"portfolio_website": "not-deployed"}}, _fake())
    assert [c.rule for c in found] == ["deployment-status-must-not-deny-its-evidence"]


def test_the_database_may_not_inherit_the_website_status() -> None:
    """The failure mode this separation exists for."""
    found = check_declarations(
        {"deployment": {"portfolio_website": "deployed", "railway_postgresql": "deployed"}},
        _fake(),
    )
    assert [c.rule for c in found] == ["database-deployment-needs-its-own-evidence"]


def test_a_database_status_is_accepted_once_its_own_evidence_supports_it() -> None:
    running = replace(
        DEPLOYED,
        analytical=replace(
            DECLARED_ONLY,
            postgresql_instance="verified",
            schema_deployment="verified",
            data_load="verified",
            verifier_last_run="2026-08-01T00:00:00Z",
        ),
    )
    found = check_declarations(
        {"deployment": {"railway_postgresql": "deployed"}}, _fake(deployment=running)
    )
    assert found == [], "\n".join(c.render() for c in found)


def test_a_website_holding_a_database_connection_fails() -> None:
    """The architecture's boundary, checked rather than asserted."""
    connected = replace(DEPLOYED, environments=(replace(STAGING, connects_to_database=True),))
    found = check_declarations({"deployment": {}}, _fake(deployment=connected))
    assert [c.rule for c in found] == ["the-website-holds-no-database-connection"]


def test_a_missing_evidence_file_fails_rather_than_passing_silently() -> None:
    absent = DeploymentEvidence(
        exists=False,
        path="deployment/evidence/portfolio_deployment.json",
        environments=(),
        production_environment="not-created",
        analytical=DECLARED_ONLY,
    )
    found = check_declarations(
        {"deployment": {"portfolio_website": "deployed"}}, _fake(deployment=absent)
    )
    assert [c.rule for c in found] == ["deployment-status-needs-an-evidence-file"]


def test_an_unknown_deployment_state_asserts_nothing() -> None:
    """UNVERIFIED is not a claim, so it needs no evidence and must not fail the build."""
    unknown = replace(
        DEPLOYED,
        analytical=replace(DECLARED_ONLY, postgresql_instance="UNVERIFIED"),
    )
    found = check_declarations(
        {"deployment": {"railway_postgresql": "UNVERIFIED"}}, _fake(deployment=unknown)
    )
    assert found == [], "\n".join(c.render() for c in found)


# --------------------------------------------------------------------------------------
# Status claims the corrected documents used to carry
# --------------------------------------------------------------------------------------


def test_denying_the_deployment_in_prose_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("There is no staging URL and no production URL.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["portfolio-deployment-exists"]


def test_calling_the_semantic_model_planned_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("The semantic model is only planned.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["semantic-model-is-not-merely-planned"]


def test_claiming_a_dashboard_while_the_report_is_empty_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("A dashboard exists.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["no-dashboard-exists"]


def test_a_dashboard_claim_is_permitted_once_pages_exist(tmp_path: Path) -> None:
    document = tmp_path / "fine.md"
    document.write_text("A dashboard exists.\n", encoding="utf-8")
    assert find_stale_claims(_fake(report_pages=7, report_visuals=30), [document]) == []


def test_claiming_the_case_study_is_available_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("The case study is available.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["case-study-remains-locked"]


def test_claiming_a_pass_while_both_engines_are_pending_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("Real-engine validation has passed.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["real-engine-validation-is-pending"]


def test_a_hand_edited_engine_block_is_caught(tmp_path: Path) -> None:
    """The generated block says No. Editing it to Yes must not survive."""
    document = tmp_path / "stale.md"
    document.write_text("An engine has run: **Yes**\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["real-engine-validation-is-pending"]


def test_claiming_the_warehouse_is_running_is_caught(tmp_path: Path) -> None:
    document = tmp_path / "stale.md"
    document.write_text("PostgreSQL is deployed.\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["website-deployment-is-not-platform-deployment"]


def test_excluding_fabric_without_qualification_is_caught(tmp_path: Path) -> None:
    """Fabric as a data platform is out of scope; the Fabric Service is a required path."""
    document = tmp_path / "stale.md"
    document.write_text("- Microsoft Fabric\n", encoding="utf-8")
    found = find_stale_claims(_fake(), [document])
    assert [c.rule for c in found] == ["fabric-is-an-accepted-validation-path"]


def test_the_qualified_fabric_exclusion_is_permitted(tmp_path: Path) -> None:
    document = tmp_path / "fine.md"
    document.write_text("- Microsoft Fabric as a data platform\n", encoding="utf-8")
    assert find_stale_claims(_fake(), [document]) == []


def test_the_fabric_rule_retires_itself_if_the_path_is_withdrawn(tmp_path: Path) -> None:
    """A semantic check, not a banned phrase.

    If ADR-0008 were ever superseded and the Service stopped being an accepted path, the
    unqualified exclusion would become true again and must stop failing the build.
    """
    document = tmp_path / "fine.md"
    document.write_text("- Microsoft Fabric\n", encoding="utf-8")
    assert find_stale_claims(_fake(fabric_is_an_accepted_validation_path=False), [document]) == []


def test_narrative_rules_do_not_search_source_code(tmp_path: Path) -> None:
    """Code branches; it does not assert.

    `platform-story.tsx` says the model is unproven "until an engine has loaded it", and
    the case-study route renders unlocked copy inside `if (caseStudy.unlocked)`. Both are
    correct, and the gate that keeps them honest is the end-to-end suite, not a regex.
    """
    source = tmp_path / "component.tsx"
    source.write_text("const copy = 'The case study is available.'\n", encoding="utf-8")
    assert find_stale_claims(_fake(), [source]) == []


def test_the_case_study_may_not_overtake_its_gate() -> None:
    found = check_declarations(
        {"gates": {"gate_2": "closed"}, "deliverables": {"case_study": "unlocked"}}, _fake()
    )
    assert "case-study-follows-gate-2" in [c.rule for c in found]


# --------------------------------------------------------------------------------------
# Review metadata
# --------------------------------------------------------------------------------------


def test_the_declared_review_metadata_is_usable() -> None:
    problems = check_review_metadata(load_review())
    assert problems == [], "\n".join(c.render() for c in problems)


def test_a_missing_review_date_fails() -> None:
    found = check_review_metadata({"last_verified_commit": "abc1234"})
    assert [c.rule for c in found] == ["review-metadata-is-required"]


def test_an_unparseable_review_date_fails() -> None:
    found = check_review_metadata(
        {"last_reviewed": "last Tuesday", "last_verified_commit": "abc1234"}
    )
    assert [c.rule for c in found] == ["review-date-must-parse"]


def test_a_review_date_in_the_future_fails() -> None:
    found = check_review_metadata(
        {"last_reviewed": "2999-01-01", "last_verified_commit": "abc1234"}
    )
    assert [c.rule for c in found] == ["review-date-must-not-be-in-the-future"]


def test_a_review_commit_that_is_not_a_commit_fails() -> None:
    found = check_review_metadata({"last_reviewed": "2026-08-01", "last_verified_commit": "HEAD"})
    assert [c.rule for c in found] == ["review-commit-must-be-a-commit"]


def test_the_review_header_is_generated_not_typed() -> None:
    """The document's own review date must come from the register, or it goes stale too."""
    review = load_review()
    block = GENERATORS["review-metadata"](_fake(), load_declared())
    assert review["last_reviewed"] in block
    assert review["last_verified_commit"] in block


# --------------------------------------------------------------------------------------
# The new generated blocks
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["current-state", "deployment", "exit-criteria"])
def test_every_new_block_is_rendered_into_a_document(name: str) -> None:
    from generate_project_capabilities import documents_with_blocks

    carried = "".join(path.read_text(encoding="utf-8") for path in documents_with_blocks())
    assert f"ARPI:CAPABILITIES:BEGIN {name}" in carried


@pytest.mark.parametrize("name", sorted(GENERATORS))
def test_regenerating_any_block_is_idempotent(name: str) -> None:
    evidence, declared = derive_evidence(), load_declared()
    source = (
        f"before\n<!-- ARPI:CAPABILITIES:BEGIN {name} -->\n"
        f"<!-- ARPI:CAPABILITIES:END {name} -->\nafter\n"
    )
    once, _ = render(source, evidence, declared)
    twice, _ = render(once, evidence, declared)
    assert once == twice
    assert once.startswith("before\n") and once.endswith("after\n")


def test_the_current_state_block_reports_the_gates_and_the_deployment() -> None:
    block = GENERATORS["current-state"](_fake(), load_declared())
    assert "Gate 1" in block and "Gate 2" in block
    assert "Report pages | 0" in block
    assert "Portfolio deployment" in block
    assert "PostgreSQL deployment | declared" in block


def test_the_current_state_block_never_guesses() -> None:
    """A fact this repository could not obtain is rendered UNVERIFIED, never as a pass."""
    block = GENERATORS["current-state"](_fake(), load_declared())
    assert "UNVERIFIED" in block


def test_the_deployment_block_keeps_the_three_deployments_apart() -> None:
    block = GENERATORS["deployment"](_fake(), load_declared())
    assert "Portfolio presentation deployment" in block
    assert "Analytical-platform deployment" in block
    assert "Semantic-model deployment" in block
    assert "These are three statuses, not one" in block
    assert "| Database connection | none |" in block


def test_the_exit_criteria_block_computes_rather_than_asserts() -> None:
    block = GENERATORS["exit-criteria"](_fake(), load_declared())
    assert "Real-engine validation" in block
    assert "Gate 2 open" in block
    assert "Case study unlocked" in block
    assert "| yes |" not in block, (
        "nothing is met while both engines are pending and the report has no pages"
    )


def test_an_exit_criterion_flips_only_when_its_evidence_appears() -> None:
    met = GENERATORS["exit-criteria"](_fake(fabric=PASSED), load_declared())
    assert "| yes |" in met, "real-engine validation must read as met once an engine has run"


def test_the_register_records_the_deployment_and_the_review() -> None:
    register = build_capabilities()
    assert register["derived"]["portfolio_deployment_recorded"] is True
    assert register["derived"]["analytical_platform_is_running"] is False
    assert register["review"]["last_reviewed"]


def test_the_evidence_file_on_disk_parses_into_the_register() -> None:
    """The register reads the committed file, not a fixture."""
    record = read_deployment_evidence()
    assert record.exists
    assert record.environment("staging") is not None
    assert record.environment("production") is None, (
        "no production environment has been created; recording one would be a claim"
    )
