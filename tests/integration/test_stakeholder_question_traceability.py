"""``docs/requirements/STAKEHOLDER_QUESTIONS.md`` stays in step with the code.

The matrix is only useful if it cannot drift. A KPI added to the catalogue and not cited
by a question makes [KPI_CATALOG.md](../../KPI_CATALOG.md) §37 unfalsifiable again; a view
added to ``reporting`` and cited nowhere is an object with no stated purpose. Both
directions are asserted here against ``arpi.constants``, which is the same tuple the
reporting layer, the Gate 1 review and the model documentation all read.

The document is parsed as text rather than as structured data on purpose. A Markdown table
is what a human reviews, and a test that read a machine-readable sidecar would pass while
the reviewed document said something else.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from arpi.constants import INVENTORY_LISTING_KPI_IDS, KPI_IDS, REPORTING_VIEWS

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]
MATRIX = REPO_ROOT / "docs" / "requirements" / "STAKEHOLDER_QUESTIONS.md"

#: Every persona named in ``docs/research.md`` §11.3, primary and secondary.
#:
#: Hand-listed rather than parsed out of the research document, because that document is
#: preserved historical evidence and must not become a thing this test can silently
#: rewrite by reinterpreting.
RESEARCH_PERSONAS: tuple[str, ...] = (
    "Dealer principal",
    "General manager",
    "General sales manager",
    "Used-car manager",
    "Internet or BDC director",
    "Finance director",
    "Marketing manager",
    "Regional operations manager",
    "Data or BI analyst",
    "Sales manager",
    "Fixed-operations manager",
    "New-car manager",
)

#: The four status values the project uses. Nothing else may appear.
STATUS_VALUES: frozenset[str] = frozenset({"Implemented", "Planned", "Deferred", "Out of scope"})


@pytest.fixture(scope="module")
def matrix_text() -> str:
    assert MATRIX.is_file(), "docs/requirements/STAKEHOLDER_QUESTIONS.md does not exist"
    return MATRIX.read_text(encoding="utf-8")


#: Every governed KPI identifier, MVP and Inventory Listings alike.
#:
#: The two tuples are separate in ``arpi.constants`` because only the first is implemented
#: as DAX and counted against the semantic model's expectation file. Traceability is not a
#: property of the semantic model, though -- it is a property of the catalogue -- so both
#: sets are held to it here.
ALL_KPI_IDS: tuple[str, ...] = (*KPI_IDS, *INVENTORY_LISTING_KPI_IDS)


def test_every_kpi_is_cited_by_at_least_one_question(matrix_text: str) -> None:
    """KPI_CATALOG.md §37: a KPI with no business question behind it fails Gate 4."""
    missing = [kpi_id for kpi_id in ALL_KPI_IDS if kpi_id not in matrix_text]
    assert not missing, (
        f"KPI identifiers cited by no stakeholder question: {missing}. Either add a "
        "question that needs them, or list them explicitly as unattributed in section 5."
    )


def test_every_reporting_view_supports_at_least_one_question(matrix_text: str) -> None:
    """A view nobody can name a question for is an object with no stated purpose."""
    missing = [view for view in REPORTING_VIEWS if view not in matrix_text]
    assert not missing, f"reporting views supporting no stakeholder question: {missing}"


@pytest.mark.parametrize("persona", RESEARCH_PERSONAS)
def test_every_research_persona_appears(matrix_text: str, persona: str) -> None:
    assert persona in matrix_text, (
        f"the persona {persona!r} from docs/research.md 11.3 appears nowhere in the matrix"
    )


def test_every_cited_kpi_identifier_resolves_to_a_catalogued_kpi(matrix_text: str) -> None:
    """The other direction: the matrix may not invent an identifier."""
    cited = set(re.findall(r"KPI-[A-Z]{3}-\d{3}", matrix_text))
    unknown = sorted(cited - set(ALL_KPI_IDS))
    assert not unknown, f"the matrix cites KPI identifiers that do not exist: {unknown}"


def test_every_cited_reporting_view_exists(matrix_text: str) -> None:
    cited = set(re.findall(r"reporting\.(vw_[a-z_]+)", matrix_text))
    unknown = sorted(cited - set(REPORTING_VIEWS))
    assert not unknown, f"the matrix cites reporting views that do not exist: {unknown}"


def test_every_question_carries_every_required_field(matrix_text: str) -> None:
    """Each block is a field table, and a missing field is a silently incomplete row."""
    blocks = re.split(r"^### (SQ-\d+) — ", matrix_text, flags=re.MULTILINE)[1:]
    pairs = list(zip(blocks[::2], blocks[1::2], strict=True))
    assert pairs, "the matrix contains no question blocks"

    required = (
        "**Persona**",
        "**Business question**",
        "**Required dimensions**",
        "**Required facts**",
        "**KPI IDs**",
        "**Reporting view**",
        "**Intended future report page**",
        "**Decision enabled**",
        "**Interpretation caution**",
        "**Implementation status**",
    )
    for question_id, body in pairs:
        for field in required:
            assert field in body, f"{question_id} has no {field} field"


def test_question_identifiers_are_unique_and_sequential(matrix_text: str) -> None:
    identifiers = re.findall(r"^### (SQ-\d+) — ", matrix_text, flags=re.MULTILINE)
    assert identifiers, "the matrix contains no question identifiers"
    assert len(identifiers) == len(set(identifiers)), "a question identifier is duplicated"
    numbers = [int(identifier.split("-")[1]) for identifier in identifiers]
    assert numbers == sorted(numbers), "question identifiers are out of order"


def test_every_status_uses_the_project_vocabulary(matrix_text: str) -> None:
    statuses = re.findall(r"\| \*\*Implementation status\*\* \| \*\*(.+?)\*\* \|", matrix_text)
    assert statuses, "no implementation status was found in the matrix"
    unknown = sorted(set(statuses) - STATUS_VALUES)
    assert not unknown, f"statuses outside the project vocabulary: {unknown}"


def test_the_matrix_records_what_the_mvp_cannot_answer(matrix_text: str) -> None:
    """A matrix that lists only what works is a marketing document.

    Questions the platform cannot answer must be present and marked, not omitted, so a
    reader can see the boundary rather than inferring it from silence.
    """
    deferred = re.findall(r"\| \*\*Implementation status\*\* \| \*\*Deferred\*\* \|", matrix_text)
    assert deferred, "no question is recorded as unanswerable; the boundary is invisible"
    assert "The MVP cannot answer this question" in matrix_text


def test_the_matrix_is_linked_from_the_requirements_index() -> None:
    """DOC-15 closes only when the document exists AND is reachable from the index."""
    index = (REPO_ROOT / "docs" / "requirements" / "README.md").read_text(encoding="utf-8")
    assert "[STAKEHOLDER_QUESTIONS.md](STAKEHOLDER_QUESTIONS.md)" in index, (
        "docs/requirements/README.md 2 does not link the matrix, so a reader cannot find it"
    )
