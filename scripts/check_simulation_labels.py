"""Fail when the simulated semantic-model validation is described as a real one.

WHY THIS EXISTS
---------------
`scripts/simulate_semantic_model.py` produces a thousand-odd passing checks about the
semantic model without any Microsoft engine. That is useful, and it is exactly the kind of
result that gets shortened — in a commit message, a README line, a status table — into
"the model is validated". It is not. Real-engine validation is an external manual
dependency and stays externally pending until Power BI Desktop or Microsoft Fabric
produces a result (ADR-0008, ADR-0014).

Prose does not fail a build when it drifts. This check makes that particular drift fail
one. It enforces three things:

1.  The simulated artifacts carry the label `SIMULATED SEMANTIC-MODEL VALIDATION`, declare
    `is_real_engine_result: false`, and never record a passing engine state that the real
    evidence files do not record.
2.  No tracked text file claims, on a line that also names a simulated artifact, that the
    model is Power BI validated, Desktop validated, Fabric validated, or that Gate 2 has
    passed. A negation — "is not a Power BI validation", "never Gate 2 evidence" — is
    allowed, because saying what a thing is not is the point.
3.  The simulation's own documentation states the disclaimer at least once, so that a
    reader who opens only that page still learns it.

NOTHING HERE CONTACTS AN ENGINE. It reads two JSON files and greps the working tree.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RESULTS_PATH = REPO_ROOT / "powerbi" / "validation" / "simulated_semantic_model_results.json"
FACT_SOURCE_PATH = REPO_ROOT / "powerbi" / "validation" / "simulated_fact_source.json"
SIMULATION_DOC = (
    REPO_ROOT / "powerbi" / "model_documentation" / "10-simulated-semantic-model-validation.md"
)

VALIDATION_KIND = "SIMULATED SEMANTIC-MODEL VALIDATION"

#: File suffixes worth reading as prose or configuration.
TEXT_SUFFIXES = frozenset({".md", ".py", ".json", ".yml", ".yaml", ".ts", ".tsx", ".sql", ".ps1"})

#: Names that mean a line is talking about the simulation.
SIMULATION_TERMS = (
    "simulate_semantic_model",
    "simulated_semantic_model_results",
    "simulated_fact_source",
    "dax_simulation",
    "simulated semantic-model validation",
    "simulated semantic model validation",
)

#: Claims that may never be attached to the simulation.
FORBIDDEN_CLAIMS = (
    re.compile(r"power\s*bi[- ]validated", re.IGNORECASE),
    re.compile(r"validated\s+(?:in|by|with)\s+power\s*bi", re.IGNORECASE),
    re.compile(r"desktop[- ]validated", re.IGNORECASE),
    re.compile(r"fabric[- ]validated", re.IGNORECASE),
    re.compile(r"validated\s+(?:in|by|with)\s+(?:microsoft\s+)?fabric", re.IGNORECASE),
    re.compile(r"real[- ]engine[- ]validated", re.IGNORECASE),
    re.compile(r"gate\s*2\s+(?:has\s+)?(?:passed|passes)", re.IGNORECASE),
    re.compile(r"(?:passes|satisfies|closes|clears)\s+gate\s*2", re.IGNORECASE),
)

#: Words that turn a forbidden claim into a permitted denial of one.
NEGATIONS = (
    "not",
    "never",
    "no ",
    "nor ",
    "cannot",
    "does not",
    "may not",
    "must not",
    "rather than",
    "instead of",
    "without",
    "forbidden",
    "prohibited",
)

#: The disclaimer the simulation's documentation has to contain, in substance.
REQUIRED_DOC_PHRASES = (
    "is not a Power BI validation",
    "Gate 2",
    "externally pending",
)


def _display(path: Path) -> str:
    """Render a path relative to the repository when it is inside it."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def tracked_files() -> list[Path]:
    """Return the tracked text files, or every text file when git is unavailable."""
    try:
        listed = subprocess.run(
            ["git", "ls-files"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        listed = [
            str(path.relative_to(REPO_ROOT))
            for path in REPO_ROOT.rglob("*")
            if path.is_file() and ".git" not in path.parts
        ]
    return [
        REPO_ROOT / name
        for name in listed
        if Path(name).suffix in TEXT_SUFFIXES and (REPO_ROOT / name).is_file()
    ]


def check_artifacts(failures: list[str]) -> None:
    """The two simulated artifacts must label themselves for what they are."""
    for path in (RESULTS_PATH, FACT_SOURCE_PATH):
        if not path.is_file():
            failures.append(f"{_display(path)} is missing")
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("validation_kind") != VALIDATION_KIND:
            failures.append(f"{_display(path)} does not carry validation_kind {VALIDATION_KIND!r}")
        if document.get("is_real_engine_result") is not False:
            failures.append(f"{_display(path)} does not declare is_real_engine_result: false")


def check_engine_states(failures: list[str]) -> None:
    """The artifact may not report an engine state the real evidence does not support."""
    if not RESULTS_PATH.is_file():
        return
    document = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import check_real_engine_validation as gate  # noqa: PLC0415 - a script, imported by path

    states, _ = gate.evaluate()
    expected = {
        "desktop_validation": states["Power BI Desktop"][0],
        "fabric_validation": states["Microsoft Fabric"][0],
    }
    for field, state in expected.items():
        if document.get(field) != state:
            failures.append(
                f"the simulated artifact records {field} = {document.get(field)!r} while the "
                f"evidence file says {state!r}; re-run scripts/simulate_semantic_model.py"
            )


def check_prose(failures: list[str]) -> None:
    """No line may attach a real-engine claim to the simulation."""
    for path in tracked_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:  # pragma: no cover - binary file with a text suffix
            continue
        for number, line in enumerate(lines, start=1):
            lowered = line.lower()
            if not any(term in lowered for term in SIMULATION_TERMS):
                continue
            if any(negation in lowered for negation in NEGATIONS):
                continue
            for claim in FORBIDDEN_CLAIMS:
                if claim.search(line):
                    failures.append(
                        f"{_display(path)}:{number} describes the simulation as a "
                        f"real-engine validation: {line.strip()!r}"
                    )


def check_documentation(failures: list[str]) -> None:
    """The simulation's own page has to say what it is not."""
    if not SIMULATION_DOC.is_file():
        failures.append(f"{_display(SIMULATION_DOC)} is missing")
        return
    text = SIMULATION_DOC.read_text(encoding="utf-8")
    for phrase in REQUIRED_DOC_PHRASES:
        if phrase.lower() not in text.lower():
            failures.append(f"{_display(SIMULATION_DOC)} does not contain {phrase!r}")


def main(argv: list[str] | None = None) -> int:
    """Run every label check and report."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--quiet", action="store_true", help="print only failures")
    arguments = parser.parse_args(argv)

    failures: list[str] = []
    check_artifacts(failures)
    check_engine_states(failures)
    check_prose(failures)
    check_documentation(failures)

    if failures:
        print("Simulation labelling check FAILED:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    if not arguments.quiet:
        print(
            "Simulation labelling check passed: the simulated validation is labelled "
            f"{VALIDATION_KIND} everywhere it appears, and no document claims it is a "
            "Power BI, Desktop or Fabric result."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
