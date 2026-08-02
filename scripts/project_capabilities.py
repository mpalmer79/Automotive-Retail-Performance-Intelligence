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

import ast
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deployment_evidence import (
    DeploymentEvidence,
    read_deployment_evidence,
)

REPO_ROOT = Path(__file__).resolve().parents[1]

DECLARED_PATH = REPO_ROOT / "config" / "project_capabilities.json"

PBIP_DIR = REPO_ROOT / "powerbi" / "ARPI_Performance_Intelligence"
SEMANTIC_MODEL_DIR = PBIP_DIR / "ARPI_Performance_Intelligence.SemanticModel"
MODEL_DEFINITION_DIR = SEMANTIC_MODEL_DIR / "definition"
REPORT_DIR = PBIP_DIR / "ARPI_Performance_Intelligence.Report"

DESKTOP_EVIDENCE = REPO_ROOT / "powerbi" / "validation" / "desktop_validation_results.json"
FABRIC_EVIDENCE = REPO_ROOT / "powerbi" / "validation" / "fabric_validation_results.json"

WEBSITE_MANIFEST = REPO_ROOT / "portfolio" / "src" / "generated" / "project-manifest.json"

#: ADR-0008 is the record that made Microsoft Fabric an accepted real-engine validation
#: path. Fabric as a *data platform* -- a lakehouse, a warehouse item, a replacement for
#: PostgreSQL -- remains a non-goal, and the two are not the same claim. The distinction is
#: derived from the record rather than declared, so a superseded ADR retires it.
ADR_REAL_ENGINE_PATHS = (
    REPO_ROOT / "docs" / "architecture-decisions" / "ADR-0008-real-engine-validation-paths.md"
)

#: Documents whose header review metadata is generated from the declared register. Listed
#: here so a document that stops carrying the block is a failure rather than a silence.
REVIEWED_DOCUMENTS = ("LIMITATIONS.md",)

#: `audit.pipeline_run_row_count.layer` admits exactly these. DOC-23 closed the gap
#: between what the CHECK allowed and what the pipeline wrote.
AUDIT_LAYERS = ("source", "raw", "staging", "warehouse", "rejected")

#: The two sources the fact-loading contract is read from, and the directory it governs.
#: Read as source rather than imported: this module runs on a bare interpreter with the
#: package uninstalled.
INGESTION_SPEC_SOURCE = REPO_ROOT / "src" / "arpi" / "ingestion" / "spec.py"
INVENTORY_SPEC_SOURCE = REPO_ROOT / "src" / "arpi" / "inventory" / "spec.py"
LOADER_SOURCE = REPO_ROOT / "src" / "arpi" / "ingestion" / "loader.py"
FACT_SQL_DIR = REPO_ROOT / "sql" / "04_facts"

#: The function whose failure mode this register guards.
FACT_DISCOVERY_FUNCTION = "discover_fact_sql"


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
    governed_kpis: int
    report_pages: int
    report_visuals: int
    analytical_findings: int
    static_model_validation: bool
    fact_ddl_scripts: int
    fact_load_scripts: int
    required_fact_load_scripts: tuple[str, ...]
    present_fact_load_scripts: tuple[str, ...]
    fact_discovery_fails_closed: bool
    dimension_merge_scripts: int
    reporting_views: int
    audit_layers_recorded: int
    migrations: int
    desktop: EngineEvidence
    fabric: EngineEvidence
    railway_website_config: bool
    railway_database_job_config: bool
    deployment: DeploymentEvidence
    fabric_is_an_accepted_validation_path: bool
    #: SQL files owned by the sanitized public listing lane (ADR-0011). Counted separately
    #: from every field above, all of which describe the MVP warehouse the semantic model
    #: reads. Defaulted so the fixtures in tests/unit/test_project_capabilities.py, which
    #: build this record positionally to describe an MVP-shaped repository, keep doing so.
    inventory_listing_sql_files: int = 0
    inventory_listing_reporting_views: int = 0

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

    @property
    def gate_2_conditions_unmet(self) -> tuple[str, ...]:
        """Gate 2's conditions that the repository refutes, in ARCHITECTURE.md order.

        Derived rather than declared, so a document cannot describe the gate as clearable
        while the evidence says otherwise. Empty does NOT mean the gate is open: the third
        condition -- drafted executive findings -- is a human judgement recorded in
        ``docs/requirements/GATE_2_READINESS.md``, and no derivation may substitute for it.
        """
        unmet: list[str] = []
        if self.report_pages == 0:
            unmet.append("the PBIR report defines zero pages")
        if not self.any_engine_has_run:
            unmet.append(
                "no engine has refreshed the model, so no Power BI total exists to reconcile"
            )
        return tuple(unmet)

    @property
    def analytical_platform_is_running(self) -> bool:
        """Whether a PostgreSQL deployment has been provisioned, deployed and loaded.

        Read from the deployment evidence and entirely independent of the website. A live
        portfolio moves this not at all, which is the reason it is a separate property.
        """
        return self.deployment.analytical.is_running


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


def _count_report_visuals() -> int:
    """Visual containers in the PBIR report.

    Counted separately from pages because a page could be added with nothing on it, and
    "a dashboard exists" would then be one file away from looking true.
    """
    definition = REPORT_DIR / "definition"
    if not definition.is_dir():
        return 0
    return sum(1 for path in definition.rglob("visual.json") if path.is_file())


def _count_analytical_findings() -> int:
    """Written findings. ``.gitkeep`` is not a finding."""
    findings = REPO_ROOT / "docs" / "findings"
    if not findings.is_dir():
        return 0
    return sum(1 for path in findings.rglob("*.md") if path.is_file())


def _governed_kpi_count() -> int:
    """The governed KPI count, from the model expectations the static checker reads."""
    expectations = _read_json(REPO_ROOT / "powerbi" / "validation" / "model_expectations.json")
    value = expectations.get("kpi_measure_count")
    return value if isinstance(value, int) else 0


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


def _declared_strings(source: Path, keyword: str) -> set[str]:
    """Every string literal a module passes to ``keyword=`` in a call.

    Parsed rather than grepped, so a script name mentioned in a comment or a docstring is
    not mistaken for a declaration.
    """
    if not source.is_file():
        return set()
    try:
        tree = ast.parse(source.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()
    return {
        node.value.value
        for node in ast.walk(tree)
        if isinstance(node, ast.keyword)
        and node.arg == keyword
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    }


def _inventory_lane_sql_files() -> frozenset[str]:
    """The SQL files the sanitized listing lane owns, read from its own declaration.

    ``arpi.inventory.spec.INVENTORY_LANE_SQL_FILES`` is the single declaration. It is read
    here rather than restated, because the counts this module derives -- five MVP facts,
    eight dimensions, twenty-eight reporting views -- are measured against a baseline run
    and must not move because a second, separately governed lane appeared beside them.
    """
    if not INVENTORY_SPEC_SOURCE.is_file():
        return frozenset()
    try:
        tree = ast.parse(INVENTORY_SPEC_SOURCE.read_text(encoding="utf-8"))
    except SyntaxError:
        return frozenset()
    for node in ast.walk(tree):
        target = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target = node.target.id
        elif isinstance(node, ast.Assign) and node.targets and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
        if target != "INVENTORY_LANE_SQL_FILES" or node.value is None:
            continue
        if isinstance(node.value, (ast.Tuple, ast.List)):
            return frozenset(
                element.value
                for element in node.value.elts
                if isinstance(element, ast.Constant) and isinstance(element.value, str)
            )
    return frozenset()


def _required_fact_load_scripts() -> tuple[str, ...]:
    """Every fact-load script a registry declares, across BOTH ingestion registries.

    ARPI has two: ``arpi.ingestion.spec`` for the generated CSV entities the pipeline runs
    on every execution, and ``arpi.inventory.spec`` for the sanitized reference sources a
    human imports on their own cadence. The contract this feeds -- that no script in
    ``sql/04_facts`` is present without a registry naming it -- applies to both, because
    the property it protects is the same in either case: a load script nobody executes is
    an empty fact that looks loaded.
    """
    return tuple(
        sorted(
            _declared_strings(INGESTION_SPEC_SOURCE, "fact_load_script")
            | _declared_strings(INVENTORY_SPEC_SOURCE, "fact_load_script")
        )
    )


def _fact_discovery_fails_closed() -> bool:
    """Whether the loader refuses a database load rather than shipping without facts.

    A structural property of ``discover_fact_sql``, not a sentence anywhere: it must
    raise the database-loading error, and it must have no path that returns an empty
    list. Returning nothing was correct while the facts were unimplemented and became a
    silent partial load the moment they were not, which is the regression this guards.
    """
    if not LOADER_SOURCE.is_file():
        return False
    try:
        tree = ast.parse(LOADER_SOURCE.read_text(encoding="utf-8"))
    except SyntaxError:
        return False

    function = next(
        (
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == FACT_DISCOVERY_FUNCTION
        ),
        None,
    )
    if function is None:
        return False

    refuses = any(
        isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id == "DatabaseLoadError"
        for node in ast.walk(function)
    )
    returns_nothing = any(
        isinstance(node, ast.Return)
        and isinstance(node.value, ast.List | ast.Tuple)
        and not node.value.elts
        for node in ast.walk(function)
    )
    return refuses and not returns_nothing


def derive_evidence() -> DerivedEvidence:
    """Read the repository and report what is actually there."""
    sql = REPO_ROOT / "sql"
    facts = sql / "04_facts"
    dimensions = sql / "03_dimensions"
    reporting = sql / "05_reporting"
    migrations = sql / "09_migrations"

    # The sanitized public listing lane (ADR-0011) lives in the same directories as the
    # MVP warehouse and is NOT part of it. Its files are subtracted here so that "five MVP
    # facts", "eight conformed dimensions" and "twenty-eight reporting views" keep meaning
    # what the semantic model and the SQL baseline were measured against, and are counted
    # separately below so the lane is reported rather than hidden.
    lane_files = _inventory_lane_sql_files()

    def _in_lane(path: Path) -> bool:
        return f"{path.parent.name}/{path.name}" in lane_files

    all_fact_scripts = sorted(facts.glob("*.sql")) if facts.is_dir() else []
    all_dimension_scripts = sorted(dimensions.glob("*.sql")) if dimensions.is_dir() else []
    all_reporting_scripts = sorted(reporting.glob("*.sql")) if reporting.is_dir() else []

    fact_scripts = [p for p in all_fact_scripts if not _in_lane(p)]
    dimension_scripts = [p for p in all_dimension_scripts if not _in_lane(p)]
    reporting_scripts = [
        p
        for p in all_reporting_scripts
        if p.name[0].isdigit() and "scope" not in p.name and not _in_lane(p)
    ]
    lane_reporting_scripts = [p for p in all_reporting_scripts if _in_lane(p)]

    return DerivedEvidence(
        pbip_project_files=_count_files(PBIP_DIR, ".pbip")
        + (1 if (SEMANTIC_MODEL_DIR / "definition.pbism").is_file() else 0),
        tmdl_files=_count_files(MODEL_DEFINITION_DIR, ".tmdl"),
        semantic_tables=_count_files(MODEL_DEFINITION_DIR / "tables", ".tmdl"),
        relationships=_count_relationships(),
        measures=_count_measures(),
        governed_kpis=_governed_kpi_count(),
        report_pages=_count_report_pages(),
        report_visuals=_count_report_visuals(),
        analytical_findings=_count_analytical_findings(),
        static_model_validation=(REPO_ROOT / "scripts" / "check_powerbi_model.py").is_file(),
        fact_ddl_scripts=sum(1 for p in fact_scripts if "_load" not in p.name),
        fact_load_scripts=sum(1 for p in fact_scripts if p.name.endswith("_load.sql")),
        required_fact_load_scripts=_required_fact_load_scripts(),
        # EVERY load script in the directory, lane files included. The contract this feeds
        # is "no script is present that no registry names", and subtracting the lane here
        # would exempt it from the one check it most needs to satisfy.
        present_fact_load_scripts=tuple(
            sorted(p.name for p in all_fact_scripts if p.name.endswith("_load.sql"))
        ),
        fact_discovery_fails_closed=_fact_discovery_fails_closed(),
        dimension_merge_scripts=sum(1 for p in dimension_scripts if p.name.endswith("_merge.sql")),
        reporting_views=len(reporting_scripts),
        inventory_listing_sql_files=len(lane_files),
        inventory_listing_reporting_views=len(lane_reporting_scripts),
        audit_layers_recorded=_count_audit_layers_recorded(),
        migrations=sum(1 for p in migrations.glob("*.sql")) if migrations.is_dir() else 0,
        desktop=_engine_evidence(DESKTOP_EVIDENCE),
        fabric=_engine_evidence(FABRIC_EVIDENCE),
        railway_website_config=(REPO_ROOT / "railway.json").is_file(),
        railway_database_job_config=(
            REPO_ROOT / "deployment" / "railway" / "Dockerfile.database-setup"
        ).is_file(),
        deployment=read_deployment_evidence(),
        fabric_is_an_accepted_validation_path=_fabric_is_an_accepted_path(),
    )


def _fabric_is_an_accepted_path() -> bool:
    """Whether ADR-0008 still names Microsoft Fabric as a real-engine validation path.

    Read from the record rather than declared. If ADR-0008 is ever superseded and Fabric
    stops being an accepted path, the rules guarded by this retire themselves instead of
    forbidding a statement that has become true again.
    """
    if not ADR_REAL_ENGINE_PATHS.is_file():
        return False
    text = ADR_REAL_ENGINE_PATHS.read_text(encoding="utf-8")
    return "Microsoft Fabric Service" in text and FABRIC_EVIDENCE.is_file()


def load_declared() -> dict[str, Any]:
    """The human-declared status. Judgement, never counts."""
    declared = _read_json(DECLARED_PATH).get("declared")
    return declared if isinstance(declared, dict) else {}


def load_review() -> dict[str, Any]:
    """The declared review metadata: when this register was last verified, and against what."""
    review = _read_json(DECLARED_PATH).get("review")
    return review if isinstance(review, dict) else {}


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
        markdown_only: Restrict the search to ``.md`` files.

            A narrative rule reads prose for an assertion. Source code does not assert; it
            branches. ``platform-story.tsx`` says the model is unproven "until an engine has
            loaded it", the manifest generator writes one string when a validation has
            passed and another when it has not, and the case-study route renders unlocked
            copy inside ``if (caseStudy.unlocked)``. Every one of those is correct, and a
            regular expression cannot tell them from a claim. What keeps the code honest is
            the gate itself -- ``portfolio/tests/e2e/case-study-gate.spec.ts`` asserts the
            unlocked copy never reaches a rendered page -- so policing it here would add no
            safety and would push authors toward contorted phrasing.
    """

    rule: str
    pattern: re.Pattern[str]
    forbidden_when: Any
    because: Any
    exempt: tuple[str, ...] = ()
    markdown_only: bool = False


#: Files that quote stale claims in order to record that they WERE stale. Excluding them
#: is not a loophole: a document explaining a correction has to be able to state what was
#: corrected, and the register itself has to name the patterns it forbids.
_ALWAYS_EXEMPT: tuple[str, ...] = (
    "scripts/project_capabilities.py",
    "scripts/check_project_capabilities.py",
    "scripts/deployment_evidence.py",
    "tests/unit/test_project_capabilities.py",
    "tests/unit/test_deployment_evidence.py",
    "docs/reviews/",
    "config/project_capabilities.json",
    # A preserved point-in-time artefact, in the same category as docs/reviews/. Its value
    # is precisely that it was not edited after it was written: LIMITATIONS.md section 11
    # states that it is not maintained and must be read as the rationale for the
    # architecture rather than a claim about today. Rewriting its non-goal list to track a
    # later ADR would destroy the only thing it is good for.
    "docs/research.md",
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
    # -- The register's second generation. Every rule below guards a statement that was
    # -- true when written and became false without anything failing.
    ClaimRule(
        rule="portfolio-deployment-exists",
        pattern=re.compile(
            r"[Nn]o staging deployment and no production deployment"
            r"|[Nn]o preview deployment and no production deployment"
            r"|[Nn]o preview URL and no production URL exist"
            r"|[Nn]o staging URL and no production URL"
            r"|[Tt]here is also \*\*no deployment\*\*"
            r"|the site is \*\*not deployed yet\*\*"
            r"|the site is not live, launched or published",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: e.deployment.portfolio_is_recorded,
        because=lambda e: (
            f"{e.deployment.path} records a portfolio deployment: "
            + "; ".join(
                f"{environment.environment} at {environment.public_url}"
                for environment in e.deployment.environments
                if environment.is_recorded
            )
        ),
        markdown_only=True,
    ),
    ClaimRule(
        rule="semantic-model-material-exists",
        pattern=re.compile(
            r"[Aa]s of today \*\*none of it exists yet\*\*"
            r"|no semantic-model material exists"
            r"|[Nn]o TMDL (file )?exists",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: e.semantic_model_source_exists,
        because=lambda e: (
            f"{e.tmdl_files} TMDL files, {e.semantic_tables} semantic tables and "
            f"{e.measures} DAX measures are committed"
        ),
        markdown_only=True,
    ),
    ClaimRule(
        rule="semantic-model-is-not-merely-planned",
        pattern=re.compile(
            r"Power BI semantic model, measure groups"
            r"|[Tt]he semantic model (is|remains) (only |merely )?planned"
            r"|semantic model \| Planned",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: e.semantic_model_source_exists,
        because=lambda e: (
            f"the model source is committed: {e.tmdl_files} TMDL files and {e.measures} "
            "measures. Only its real-engine validation is pending"
        ),
        markdown_only=True,
    ),
    ClaimRule(
        rule="fabric-is-an-accepted-validation-path",
        pattern=re.compile(
            # An unqualified exclusion in a non-goal list. The qualified forms -- "Microsoft
            # Fabric as a data platform", "as a lakehouse" -- are the accurate statements
            # and are deliberately not matched.
            r"^\s*[-*] Microsoft Fabric\s*$|Databricks, Microsoft Fabric,",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: e.fabric_is_an_accepted_validation_path,
        because=lambda _e: (
            "ADR-0008 accepts the Microsoft Fabric Service as one of two equal real-engine "
            "validation paths. Fabric as a DATA PLATFORM remains a non-goal; say which"
        ),
        markdown_only=True,
    ),
    ClaimRule(
        rule="no-dashboard-exists",
        pattern=re.compile(
            r"[Tt]he dashboard is (built|complete|finished|live|available)"
            r"|[Aa] dashboard (exists|has been built)"
            r"|[Tt]he (Power BI )?report pages are complete",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: e.report_pages == 0,
        because=lambda _e: "the PBIR report defines zero pages",
        markdown_only=True,
    ),
    ClaimRule(
        rule="case-study-remains-locked",
        pattern=re.compile(
            r"[Tt]he case study is (available|published|unlocked|open)"
            r"|[Tt]he `?/case-study`? route is (open|unlocked|available)",
            re.MULTILINE,
        ),
        # Guarded by Gate 2's own derivable conditions, not by the declaration. A document
        # cannot describe the case study as available while the evidence refutes the gate.
        forbidden_when=lambda e: bool(e.gate_2_conditions_unmet),
        because=lambda e: "Gate 2 is unmet: " + "; ".join(e.gate_2_conditions_unmet),
        markdown_only=True,
    ),
    ClaimRule(
        rule="real-engine-validation-is-pending",
        pattern=re.compile(
            r"[Rr]eal-engine validation (has )?passed"
            r"|[Rr]eal-engine validation is complete"
            r"|[Tt]he model has been validated by an engine"
            # Guards the generated semantic-model block against a hand edit.
            r"|An engine has run: \*\*Yes\*\*",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: not e.any_engine_has_run,
        because=lambda e: (
            f"desktop validated_at={e.desktop.validated_at!r} and "
            f"fabric validated_at={e.fabric.validated_at!r}; ADR-0008 requires one real run"
        ),
        markdown_only=True,
    ),
    ClaimRule(
        rule="website-deployment-is-not-platform-deployment",
        pattern=re.compile(
            r"the (warehouse|database|analytical platform) is (deployed|live|running)"
            r"|PostgreSQL is (deployed|live|running|provisioned)"
            r"|the reporting schema is (deployed|live|reachable)",
            re.MULTILINE,
        ),
        forbidden_when=lambda e: not e.analytical_platform_is_running,
        because=lambda e: (
            f"{e.deployment.path} records the analytical platform as "
            f"postgresql_instance={e.deployment.analytical.postgresql_instance!r}, "
            f"schema_deployment={e.deployment.analytical.schema_deployment!r}. A live "
            "portfolio is not a running warehouse"
        ),
        markdown_only=True,
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
            if rule.markdown_only and path.suffix != ".md":
                continue
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

    # The case study is downstream of Gate 2 and may not overtake it. Declaring it
    # anything but locked while the gate's own conditions are unmet is the exact move
    # this register exists to refuse.
    if deliverables.get("case_study") not in (None, "locked") and gates.get("gate_2") != "open":
        found.append(
            Contradiction(
                rule="case-study-follows-gate-2",
                claim=f"deliverables.case_study = {deliverables.get('case_study')!r}",
                evidence=(
                    f"gates.gate_2 = {gates.get('gate_2')!r}"
                    + (
                        "; " + "; ".join(evidence.gate_2_conditions_unmet)
                        if evidence.gate_2_conditions_unmet
                        else ""
                    )
                ),
                location=DECLARED_PATH.relative_to(REPO_ROOT).as_posix(),
            )
        )

    found.extend(_check_deployment_declarations(declared, evidence))
    return found


#: Declared deployment states that assert something exists and therefore need evidence.
_ASSERTED_DEPLOYMENT_STATES = frozenset({"deployed", "live", "running", "provisioned"})


def _check_deployment_declarations(
    declared: dict[str, Any], evidence: DerivedEvidence
) -> list[Contradiction]:
    """Hold each of the three deployments to its own evidence.

    A deployment status is the easiest claim in this repository to assert and the hardest
    to check, because the thing it describes is not in the repository. The rules here fail
    a status asserted without its evidence source, in both directions -- an optimistic
    declaration the evidence cannot support, and a pessimistic one the evidence refutes --
    and they never let the website's status stand in for the database's.
    """
    found: list[Contradiction] = []
    deployment = declared.get("deployment", {})
    location = DECLARED_PATH.relative_to(REPO_ROOT).as_posix()
    record = evidence.deployment

    if not record.exists:
        found.append(
            Contradiction(
                rule="deployment-status-needs-an-evidence-file",
                claim=f"a deployment block is declared with {len(deployment)} entries",
                evidence=f"{record.path} does not exist, so no status here can be checked",
                location=location,
            )
        )
        return found

    website = deployment.get("portfolio_website")
    if website in _ASSERTED_DEPLOYMENT_STATES and not record.portfolio_is_recorded:
        found.append(
            Contradiction(
                rule="deployment-status-needs-evidence",
                claim=f"deployment.portfolio_website = {website!r}",
                evidence=(
                    f"{record.path} records no environment with both a public URL and a "
                    "service name"
                ),
                location=location,
            )
        )
    if website == "not-deployed" and record.portfolio_is_recorded:
        found.append(
            Contradiction(
                rule="deployment-status-must-not-deny-its-evidence",
                claim="deployment.portfolio_website = 'not-deployed'",
                evidence=f"{record.path} records a public URL for a deployed environment",
                location=location,
            )
        )

    # The whole point of the separation: PostgreSQL may not inherit the website's status.
    database = deployment.get("railway_postgresql")
    if database in _ASSERTED_DEPLOYMENT_STATES and not record.analytical.is_running:
        found.append(
            Contradiction(
                rule="database-deployment-needs-its-own-evidence",
                claim=f"deployment.railway_postgresql = {database!r}",
                evidence=(
                    f"{record.path} records postgresql_instance="
                    f"{record.analytical.postgresql_instance!r}, schema_deployment="
                    f"{record.analytical.schema_deployment!r}, data_load="
                    f"{record.analytical.data_load!r}. A deployed website is not one of these"
                ),
                location=location,
            )
        )

    # A portfolio deployment that held a database credential would break the boundary the
    # architecture is built on, and the register would be the last place to notice.
    if record.portfolio_connects_to_database:
        found.append(
            Contradiction(
                rule="the-website-holds-no-database-connection",
                claim="a portfolio environment records connects_to_database other than false",
                evidence=(
                    "deployment/railway/project.config.json declares "
                    "services.portfolio.requiresDatabase = false and lists "
                    "websiteDatabaseAccess under deliberatelyAbsent"
                ),
                location=record.path,
            )
        )

    return found


def check_fact_load_contract(evidence: DerivedEvidence) -> list[Contradiction]:
    """A warehouse whose facts are declared loaded may not tolerate their absence.

    The contradiction this exists to stop was real and lived in the repository for a
    release: ``sql/04_facts/README.md`` stated that all five MVP facts were populated and
    loaded on every pipeline run, while the loader returned an empty list when the fact
    directory was missing and carried on. Both statements were reviewed. Neither could
    fail a build, so the disagreement between them was invisible.

    The rule is structural rather than textual. It reads three things -- the load scripts
    on disk, the scripts the ingestion registry declares required, and whether the
    loader's discovery raises rather than returning nothing -- and fails when the facts
    exist but the loader would run without them. It also fails when the two name
    different sets, which is what a rename on one side and not the other looks like.

    It retires itself. With no fact-load script in the tree there is nothing to declare
    implemented, and the rule stays silent instead of forbidding a state that has become
    honest again.

    Args:
        evidence: The derived evidence.

    Returns:
        Every contradiction found, which is empty when the contract holds.
    """
    if evidence.fact_load_scripts == 0:
        return []

    found: list[Contradiction] = []
    location = "src/arpi/ingestion/loader.py"

    if not evidence.fact_discovery_fails_closed:
        found.append(
            Contradiction(
                rule="fact-loads-are-required-infrastructure",
                claim=(f"{FACT_DISCOVERY_FUNCTION} tolerates an absent or empty fact-load set"),
                evidence=(
                    f"{evidence.fact_load_scripts} fact-load scripts exist in "
                    f"{FACT_SQL_DIR.relative_to(REPO_ROOT).as_posix()} and the warehouse "
                    "documentation declares the five MVP facts loaded on every run; a load "
                    "that skipped them would report success over a warehouse with no measures"
                ),
                location=location,
            )
        )

    required = set(evidence.required_fact_load_scripts)
    present = set(evidence.present_fact_load_scripts)
    if required != present:
        undeclared = sorted(present - required)
        unbuilt = sorted(required - present)
        detail = []
        if unbuilt:
            detail.append(f"declared but absent from the tree: {', '.join(unbuilt)}")
        if undeclared:
            detail.append(f"present but declared by no ingestion spec: {', '.join(undeclared)}")
        found.append(
            Contradiction(
                rule="fact-load-contract-names-every-script",
                claim=(
                    f"the ingestion registry requires {len(required)} fact-load script(s) "
                    f"while {FACT_SQL_DIR.relative_to(REPO_ROOT).as_posix()} holds "
                    f"{len(present)}"
                ),
                evidence=(
                    "; ".join(detail)
                    + ". A script the registry does not name is never executed, so the two "
                    "must describe the same set"
                ),
                location="src/arpi/ingestion/spec.py",
            )
        )

    return found


def check_review_metadata(review: dict[str, Any]) -> list[Contradiction]:
    """Reject review metadata that cannot be true.

    The document header used to carry its own review date and version, typed by hand, and
    it went stale for the same reason every other hand-typed status did. The header is now
    generated from this block, so the two cannot disagree -- which leaves only the block
    itself to check: that the date parses, that it is not in the future, and that the
    commit it names looks like a commit.
    """
    found: list[Contradiction] = []
    location = DECLARED_PATH.relative_to(REPO_ROOT).as_posix()

    raw_date = review.get("last_reviewed")
    if not isinstance(raw_date, str):
        found.append(
            Contradiction(
                rule="review-metadata-is-required",
                claim=f"review.last_reviewed = {raw_date!r}",
                evidence="the generated document header has no date to render",
                location=location,
            )
        )
    else:
        try:
            reviewed = dt.date.fromisoformat(raw_date)
        except ValueError:
            found.append(
                Contradiction(
                    rule="review-date-must-parse",
                    claim=f"review.last_reviewed = {raw_date!r}",
                    evidence="it is not an ISO-8601 date",
                    location=location,
                )
            )
        else:
            today = dt.datetime.now(tz=dt.UTC).date()
            if reviewed > today:
                found.append(
                    Contradiction(
                        rule="review-date-must-not-be-in-the-future",
                        claim=f"review.last_reviewed = {raw_date}",
                        evidence=f"today is {today.isoformat()}",
                        location=location,
                    )
                )

    commit = review.get("last_verified_commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        found.append(
            Contradiction(
                rule="review-commit-must-be-a-commit",
                claim=f"review.last_verified_commit = {commit!r}",
                evidence="a limitation's evidence is bound to the commit it was read from",
                location=location,
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
            "required_fact_load_scripts": list(evidence.required_fact_load_scripts),
            "fact_discovery_fails_closed": evidence.fact_discovery_fails_closed,
            "dimension_merge_scripts": evidence.dimension_merge_scripts,
            "reporting_views": evidence.reporting_views,
            "audit_layers_recorded": evidence.audit_layers_recorded,
            "migrations": evidence.migrations,
            "real_engine_has_run": evidence.any_engine_has_run,
            "desktop_validated_at": evidence.desktop.validated_at,
            "fabric_validated_at": evidence.fabric.validated_at,
            "fabric_is_an_accepted_validation_path": (
                evidence.fabric_is_an_accepted_validation_path
            ),
            "gate_2_conditions_unmet": list(evidence.gate_2_conditions_unmet),
            "portfolio_deployment_recorded": evidence.deployment.portfolio_is_recorded,
            "portfolio_deployment_live_verified": evidence.deployment.portfolio_is_live_verified,
            "portfolio_connects_to_database": evidence.deployment.portfolio_connects_to_database,
            "analytical_platform_is_running": evidence.analytical_platform_is_running,
        },
        "review": load_review(),
    }
