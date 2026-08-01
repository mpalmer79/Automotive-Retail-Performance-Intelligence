#!/usr/bin/env python3
"""Derive ARPI's implementation status from the repository, and reject contradictions.

WHY THIS EXISTS
---------------
Implementation status was stated in prose, in several governing documents, each written
at a different time. Prose does not fail a build when it goes stale, so it went stale:

    LIMITATIONS.md              "no semantic model exists"        30 TMDL files exist
    GATE_1_READINESS.md         "No DAX measure exists"           49 measures exist
    STM-003                     "only three are ever recorded"    five layers are recorded
    01-system-context.md        "No semantic model ... exists"    the PBIP exists

Every one of those was true when written. None of them was true when found, and nothing
in the repository could tell the difference.

THE DESIGN
----------
Two inputs, one verdict.

    DECLARED   config/project_capabilities.json -- judgement a script cannot make:
               is a phase complete, is a gate open, is a feature deferred.

    DERIVED    this module -- facts read from source: does the PBIP exist, how many
               measures, how many report pages, what does the evidence file say.

Counts live in exactly one place: derived. Recording "49 measures" in the declared file
would create a second copy able to disagree with the first, which is the drift being
fixed rather than a fix for it.

The verdict combines them and fails on contradiction, in both directions:

  * a declaration the evidence refutes  -- "fabric: passed" with a null validated_at;
  * prose the evidence refutes          -- "no semantic model exists" beside 30 TMDL files.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
It does not turn "source exists" into "runtime proven". The semantic model source exists;
no engine has executed it. Report pages genuinely do not exist. The checks below are
written so that each one can only ever tighten a claim toward the evidence, never loosen
a gate.

Standard library only, and no package import: `repository-checks` runs on a bare
interpreter with nothing installed.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]

DECLARED_PATH = REPO_ROOT / "config" / "project_capabilities.json"

PBIP_DIR = REPO_ROOT / "powerbi" / "ARPI_Performance_Intelligence"
SEMANTIC_MODEL_DIR = PBIP_DIR / "ARPI_Performance_Intelligence.SemanticModel"
MODEL_DEFINITION_DIR = SEMANTIC_MODEL_DIR / "definition"
REPORT_DIR = PBIP_DIR / "ARPI_Performance_Intelligence.Report"

DESKTOP_EVIDENCE = REPO_ROOT / "powerbi" / "validation" / "desktop_validation_results.json"
FABRIC_EVIDENCE = REPO_ROOT / "powerbi" / "validation" / "fabric_validation_results.json"

WEBSITE_MANIFEST = REPO_ROOT / "portfolio" / "src" / "generated" / "project-manifest.json"

#: `audit.pipeline_run_row_count.layer` admits exactly these. DOC-23 closed the gap
#: between what the CHECK allowed and what the pipeline wrote.
AUDIT_LAYERS = ("source", "raw", "staging", "warehouse", "rejected")


# --------------------------------------------------------------------------------------
# Derivation
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class EngineEvidence:
    """One real-engine validation result file, read rather than trusted.

    Attributes:
        path: Repository-relative path, for messages.
        exists: Whether the file is present at all.
        validated_at: Timestamp the engine recorded, or ``None`` while pending.
        model_source_hash: Hash of the model definition the run validated.
        overall_status: The file's own verdict, when it carries one.
    """

    path: str
    exists: bool
    validated_at: str | None
    model_source_hash: str | None
    overall_status: str | None

    @property
    def has_run(self) -> bool:
        """Whether an engine actually executed. A file alone proves nothing."""
        return self.exists and bool(self.validated_at) and bool(self.model_source_hash)


@dataclass(frozen=True, slots=True)
class DerivedEvidence:
    """Implementation facts read from the repository.

    Every field is computed. None is copied from a document, so none can be stale in the
    way the prose was.
    """

    pbip_project_files: int
    tmdl_files: int
    semantic_tables: int
    relationships: int
    measures: int
    report_pages: int
    fact_ddl_scripts: int
    fact_load_scripts: int
    dimension_merge_scripts: int
    reporting_views: int
    audit_layers_recorded: int
    migrations: int
    desktop: EngineEvidence
    fabric: EngineEvidence
    railway_website_config: bool
    railway_database_job_config: bool

    @property
    def semantic_model_source_exists(self) -> bool:
        """Source, not a validated model. The distinction is the whole point."""
        return self.pbip_project_files > 0 and self.tmdl_files > 0

    @property
    def any_engine_has_run(self) -> bool:
        """Whether Desktop or Fabric has actually executed the model.

        ADR-0008 accepts either path, so one is enough -- but only one that really ran.
        """
        return self.desktop.has_run or self.fabric.has_run


def _count_files(directory: Path, suffix: str) -> int:
    if not directory.is_dir():
        return 0
    return sum(1 for path in directory.rglob(f"*{suffix}") if path.is_file())


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _engine_evidence(path: Path) -> EngineEvidence:
    document = _read_json(path)
    return EngineEvidence(
        path=path.relative_to(REPO_ROOT).as_posix(),
        exists=path.is_file(),
        validated_at=document.get("validated_at"),
        model_source_hash=document.get("model_source_hash"),
        overall_status=document.get("overall_status") or document.get("status"),
    )


def _count_measures() -> int:
    """Every ``measure`` declaration across the model's TMDL tables."""
    tables = MODEL_DEFINITION_DIR / "tables"
    if not tables.is_dir():
        return 0
    pattern = re.compile(r"^\s*measure\s+", re.MULTILINE)
    return sum(
        len(pattern.findall(path.read_text(encoding="utf-8")))
        for path in sorted(tables.glob("*.tmdl"))
    )


def _count_relationships() -> int:
    path = MODEL_DEFINITION_DIR / "relationships.tmdl"
    if not path.is_file():
        return 0
    return len(re.findall(r"^relationship\s+", path.read_text(encoding="utf-8"), re.MULTILINE))


def _count_report_pages() -> int:
    """Report pages, which genuinely do not exist yet.

    A PBIR shell with no page definitions is not a dashboard, and this count is what
    keeps any document from implying otherwise.
    """
    pages = REPORT_DIR / "definition" / "pages"
    if not pages.is_dir():
        return 0
    return sum(1 for path in pages.rglob("page.json") if path.is_file())


def _count_audit_layers_recorded() -> int:
    """How many of the five layers the loader and pipeline actually record.

    Read from source rather than declared, because the claim that only three were written
    is exactly the kind of statement that went stale when the fourth and fifth arrived.
    """
    sources = [
        REPO_ROOT / "src" / "arpi" / "pipeline.py",
        REPO_ROOT / "src" / "arpi" / "ingestion" / "loader.py",
    ]
    text = "\n".join(path.read_text(encoding="utf-8") for path in sources if path.is_file())
    recorded = {
        layer
        for layer in AUDIT_LAYERS
        if re.search(rf"record_row_count\([^)]*LAYER_{layer.upper()}", text)
    }
    return len(recorded)


def derive_evidence() -> DerivedEvidence:
    """Read the repository and report what is actually there."""
    sql = REPO_ROOT / "sql"
    facts = sql / "04_facts"
    dimensions = sql / "03_dimensions"
    reporting = sql / "05_reporting"
    migrations = sql / "09_migrations"

    fact_scripts = sorted(facts.glob("*.sql")) if facts.is_dir() else []
    dimension_scripts = sorted(dimensions.glob("*.sql")) if dimensions.is_dir() else []

    return DerivedEvidence(
        pbip_project_files=_count_files(PBIP_DIR, ".pbip")
        + (1 if (SEMANTIC_MODEL_DIR / "definition.pbism").is_file() else 0),
        tmdl_files=_count_files(MODEL_DEFINITION_DIR, ".tmdl"),
        semantic_tables=_count_files(MODEL_DEFINITION_DIR / "tables", ".tmdl"),
        relationships=_count_relationships(),
        measures=_count_measures(),
        report_pages=_count_report_pages(),
        fact_ddl_scripts=sum(1 for p in fact_scripts if "_load" not in p.name),
        fact_load_scripts=sum(1 for p in fact_scripts if p.name.endswith("_load.sql")),
        dimension_merge_scripts=sum(1 for p in dimension_scripts if p.name.endswith("_merge.sql")),
        reporting_views=sum(
            1
            for p in (sorted(reporting.glob("*.sql")) if reporting.is_dir() else [])
            if p.name[0].isdigit() and "scope" not in p.name
        ),
        audit_layers_recorded=_count_audit_layers_recorded(),
        migrations=sum(1 for p in migrations.glob("*.sql")) if migrations.is_dir() else 0,
        desktop=_engine_evidence(DESKTOP_EVIDENCE),
        fabric=_engine_evidence(FABRIC_EVIDENCE),
        railway_website_config=(REPO_ROOT / "railway.json").is_file(),
        railway_database_job_config=(
            REPO_ROOT / "deployment" / "railway" / "Dockerfile.database-setup"
        ).is_file(),
    )


def load_declared() -> dict[str, Any]:
    """The human-declared status. Judgement, never counts."""
    declared = _read_json(DECLARED_PATH).get("declared")
    return declared if isinstance(declared, dict) else {}


# --------------------------------------------------------------------------------------
# Contradiction rules
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Contradiction:
    """One inconsistency between a claim and the evidence that refutes it."""

    rule: str
    claim: str
    evidence: str
    location: str

    def render(self) -> str:
        """Three lines: where, what was claimed, and what refutes it."""
        return (
            f"  [{self.rule}] {self.location}\n"
            f"      claims:   {self.claim}\n"
            f"      evidence: {self.evidence}"
        )


@dataclass(slots=True)
class ClaimRule:
    """A prose claim that the evidence forbids.

    Attributes:
        rule: Stable identifier, so a failure is greppable.
        pattern: What must not appear, as a regular expression.
        forbidden_when: Reads the evidence and returns True when the claim is false.
        because: The evidence, rendered for the failure message.
        exempt: Paths permitted to quote the claim -- this module, the checker, and any
            document that records the correction as history rather than asserting it.
    """

    rule: str
    pattern: re.Pattern[str]
    forbidden_when: Any
    because: Any
    exempt: tuple[str, ...] = ()


#: Files that quote stale claims in order to record that they WERE stale. Excluding them
#: is not a loophole: a document explaining a correction has to be able to state what was
#: corrected, and the register itself has to name the patterns it forbids.
_ALWAYS_EXEMPT: tuple[str, ...] = (
    "scripts/project_capabilities.py",
    "scripts/check_project_capabilities.py",
    "tests/unit/test_project_capabilities.py",
    "docs/reviews/",
    "config/project_capabilities.json",
)


CLAIM_RULES: tuple[ClaimRule, ...] = (
    ClaimRule(
        rule="semantic-model-source-exists",
        pattern=re.compile(r"[Nn]o semantic model exists|[Nn]o semantic model,", re.MULTILINE),
        forbidden_when=lambda e: e.semantic_model_source_exists,
        because=lambda e: (
            f"{e.tmdl_files} TMDL files and {e.pbip_project_files} PBIP project file(s) exist"
        ),
    ),
    ClaimRule(
        rule="dax-measures-exist",
        pattern=re.compile(r"[Nn]o DAX measure exists", re.MULTILINE),
        forbidden_when=lambda e: e.measures > 0,
        because=lambda e: f"{e.measures} measures are declared in the model's TMDL",
    ),
    ClaimRule(
        rule="power-bi-source-exists",
        pattern=re.compile(r"[Nn]o Power BI file, no semantic model", re.MULTILINE),
        forbidden_when=lambda e: e.semantic_model_source_exists,
        because=lambda e: f"the PBIP project and {e.tmdl_files} TMDL files exist",
    ),
    ClaimRule(
        rule="five-audit-layers-recorded",
        pattern=re.compile(r"only three are ever\s+recorded", re.MULTILINE),
        forbidden_when=lambda e: e.audit_layers_recorded >= len(AUDIT_LAYERS),
        because=lambda e: f"the pipeline records all {e.audit_layers_recorded} layers",
    ),
    ClaimRule(
        rule="fact-loads-implemented",
        pattern=re.compile(r"[Nn]o SQL load exists yet", re.MULTILINE),
        forbidden_when=lambda e: e.fact_load_scripts > 0 and e.dimension_merge_scripts > 0,
        because=lambda e: (
            f"{e.fact_load_scripts} fact-load scripts and "
            f"{e.dimension_merge_scripts} dimension merges exist"
        ),
    ),
    ClaimRule(
        rule="no-cross-agent-ownership",
        pattern=re.compile(r"Planned and owned by another agent", re.MULTILINE),
        # Always forbidden: the entities it refers to are implemented, and the phrase
        # describes a build process that no longer exists.
        forbidden_when=lambda e: e.fact_load_scripts > 0,
        because=lambda _e: "the referenced SQL objects are implemented",
    ),
)


def _relative(path: Path) -> str:
    """Repository-relative path, falling back to the absolute one.

    Callers normally pass tracked files, but a test -- or a future caller checking a
    generated file outside the tree -- may not. A path outside the repository is still
    worth searching; only its label changes.
    """
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def find_stale_claims(evidence: DerivedEvidence, files: list[Path]) -> list[Contradiction]:
    """Search tracked text for claims the repository refutes."""
    found: list[Contradiction] = []
    for rule in CLAIM_RULES:
        if not rule.forbidden_when(evidence):
            continue
        exempt = _ALWAYS_EXEMPT + rule.exempt
        for path in files:
            relative = _relative(path)
            if any(relative.startswith(prefix) for prefix in exempt):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for match in rule.pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                found.append(
                    Contradiction(
                        rule=rule.rule,
                        claim=match.group(0).replace("\n", " ").strip(),
                        evidence=rule.because(evidence),
                        location=f"{relative}:{line}",
                    )
                )
    return found


def check_declarations(declared: dict[str, Any], evidence: DerivedEvidence) -> list[Contradiction]:
    """Reject a declared status the derived evidence refutes.

    Only ever tightens: every rule here fails an OPTIMISTIC declaration. There is no rule
    that would let a gate open or a validation pass because a file appeared.
    """
    found: list[Contradiction] = []

    engines = declared.get("real_engine_validation", {})
    for name, result in (("desktop", evidence.desktop), ("fabric", evidence.fabric)):
        status = engines.get(name)
        if status == "passed" and not result.has_run:
            found.append(
                Contradiction(
                    rule="engine-passed-needs-evidence",
                    claim=f"real_engine_validation.{name} = passed",
                    evidence=(
                        f"{result.path} has validated_at={result.validated_at!r} and "
                        f"model_source_hash={result.model_source_hash!r}; a pass requires both"
                    ),
                    location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
                )
            )

    deliverables = declared.get("deliverables", {})
    if deliverables.get("power_bi_report_pages") not in (None, "not-started") and (
        evidence.report_pages == 0
    ):
        found.append(
            Contradiction(
                rule="report-pages-need-pages",
                claim=(
                    "deliverables.power_bi_report_pages = "
                    f"{deliverables.get('power_bi_report_pages')!r}"
                ),
                evidence="the PBIR report defines zero pages",
                location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
            )
        )
    if deliverables.get("dashboard") not in (None, "not-started") and evidence.report_pages == 0:
        found.append(
            Contradiction(
                rule="dashboard-needs-pages",
                claim=f"deliverables.dashboard = {deliverables.get('dashboard')!r}",
                evidence="the PBIR report defines zero pages",
                location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
            )
        )

    phases = declared.get("lifecycle_phases", {})
    if phases.get("5_semantic_model") == "complete" and not evidence.any_engine_has_run:
        found.append(
            Contradiction(
                rule="phase-5-needs-a-real-engine",
                claim="lifecycle_phases.5_semantic_model = complete",
                evidence=(
                    "neither Desktop nor Fabric evidence records a run; ADR-0008 requires "
                    "one real engine to have executed the model"
                ),
                location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
            )
        )

    gates = declared.get("gates", {})
    if gates.get("gate_2") == "open":
        blockers: list[str] = []
        if not evidence.any_engine_has_run:
            blockers.append("no real-engine validation has run")
        if evidence.report_pages == 0:
            blockers.append("the report defines zero pages")
        if blockers:
            found.append(
                Contradiction(
                    rule="gate-2-needs-its-conditions",
                    claim="gates.gate_2 = open",
                    evidence="; ".join(blockers),
                    location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
                )
            )

    return found


def check_website_agreement(evidence: DerivedEvidence) -> list[Contradiction]:
    """The website's manifest and this register must not disagree.

    The manifest is generated independently, in TypeScript, from the same repository. Two
    derivations of one fact is exactly the arrangement that produced the stale prose, so
    the two are compared rather than trusted.
    """
    manifest = _read_json(WEBSITE_MANIFEST)
    counts = manifest.get("counts", {})
    if not counts:
        return []

    comparisons = (
        ("daxMeasures", evidence.measures, "measures declared in TMDL"),
        ("semanticRelationships", evidence.relationships, "relationships declared in TMDL"),
        ("semanticTables", evidence.semantic_tables, "table TMDL files"),
        ("facts", evidence.fact_ddl_scripts, "fact DDL scripts"),
    )

    found: list[Contradiction] = []
    for key, derived, description in comparisons:
        entry = counts.get(key)
        if not isinstance(entry, dict) or "value" not in entry:
            continue
        if entry["value"] != derived:
            found.append(
                Contradiction(
                    rule="website-agrees-with-register",
                    claim=f"the website manifest reports counts.{key} = {entry['value']}",
                    evidence=f"the repository holds {derived} {description}",
                    location=WEBSITE_MANIFEST.relative_to(REPO_ROOT).as_posix(),
                )
            )
    return found


def build_capabilities() -> dict[str, Any]:
    """The combined register: declared status beside the evidence that supports it."""
    evidence = derive_evidence()
    declared = load_declared()
    return {
        "schema": "arpi.project_capabilities/1",
        "declared": declared,
        "derived": {
            "semantic_model_source_exists": evidence.semantic_model_source_exists,
            "pbip_project_files": evidence.pbip_project_files,
            "tmdl_files": evidence.tmdl_files,
            "semantic_tables": evidence.semantic_tables,
            "relationships": evidence.relationships,
            "measures": evidence.measures,
            "report_pages": evidence.report_pages,
            "fact_ddl_scripts": evidence.fact_ddl_scripts,
            "fact_load_scripts": evidence.fact_load_scripts,
            "dimension_merge_scripts": evidence.dimension_merge_scripts,
            "reporting_views": evidence.reporting_views,
            "audit_layers_recorded": evidence.audit_layers_recorded,
            "migrations": evidence.migrations,
            "real_engine_has_run": evidence.any_engine_has_run,
            "desktop_validated_at": evidence.desktop.validated_at,
            "fabric_validated_at": evidence.fabric.validated_at,
        },
    }
