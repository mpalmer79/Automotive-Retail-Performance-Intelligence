"""The simulated semantic-model validation, and proof that it can fail.

Two groups of test.

The first runs the simulation against the committed model and re-states, as separately
named tests, the facts a reviewer wants to see in a test report: that every measure is
simulated rather than skipped, that the two implementations agree everywhere, that the
artifact is current, and that it labels itself for what it is.

The second gives the simulation teeth. Each test mutates the parsed model or the fact
source in memory — a swapped denominator, a dropped USERELATIONSHIP, a semi-additive
measure turned additive, a `+ 0` removed — and asserts that the relevant family notices. A
validator that has never been shown to fail is not a validator, and a thousand passing
checks against an unmutated model is exactly the shape of result that looks like thorough
validation while proving nothing.

NOTHING HERE IS A REAL-ENGINE VALIDATION. No Power BI Desktop, no Microsoft Fabric, no
Gate 2. See ADR-0014.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
RESULTS_PATH = REPO_ROOT / "powerbi" / "validation" / "simulated_semantic_model_results.json"


def _load_script(name: str) -> ModuleType:
    """Import `scripts/<name>.py` by path, as the other script tests do."""
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    path = SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"arpi_scripts.{name}", path)
    assert spec is not None and spec.loader is not None, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


harness = _load_script("simulate_semantic_model")
labels = _load_script("check_simulation_labels")

#: The harness's own engine module, not a second copy of it. Loading `dax_simulation`
#: separately would give these tests a different BLANK singleton and different AST classes
#: from the ones the harness compares against, and every mutation test would pass for the
#: wrong reason.
dax = harness.dax


@pytest.fixture(scope="module")
def simulation() -> Any:
    """A simulation that has run every family against the committed model."""
    run = harness.Simulation()
    run.run()
    return run


@pytest.fixture
def fresh() -> Any:
    """A simulation that has been built but not run, for a test to mutate first."""
    return harness.Simulation()


# ---------------------------------------------------------------------------
# 1. What the committed model does
# ---------------------------------------------------------------------------


def test_the_simulation_finds_nothing_wrong(simulation: Any) -> None:
    assert simulation.findings == [], "\n".join(finding.render() for finding in simulation.findings)


def test_every_measure_is_simulated_rather_than_skipped(simulation: Any) -> None:
    assert simulation.not_simulated == {}
    assert len(simulation.simulated_measure_names()) == len(simulation.model.measures)


def test_every_family_ran_at_least_one_check(simulation: Any) -> None:
    empty = [family.key for family in simulation.families if family.checks == 0]
    assert empty == []


def test_the_two_implementations_agree_in_every_context(simulation: Any) -> None:
    reconciliation = next(
        family for family in simulation.families if family.key == "reconciliation"
    )
    expected = len(harness.truth.CONTEXTS) * len(simulation.simulated_measure_names())
    assert reconciliation.checks == expected
    assert reconciliation.findings == []


def test_the_committed_artifact_is_what_this_model_produces() -> None:
    assert harness.main(["--check", "--quiet"]) == 0


def test_the_artifact_labels_itself_as_simulated() -> None:
    document = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    assert document["validation_kind"] == "SIMULATED SEMANTIC-MODEL VALIDATION"
    assert document["is_real_engine_result"] is False


def test_the_artifact_reports_the_real_engine_states_as_pending() -> None:
    document = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    assert document["desktop_validation"] == "PENDING"
    assert document["fabric_validation"] == "PENDING"
    assert document["gate_2_real_engine_validation"] == "PENDING"


def test_nothing_in_the_repository_calls_the_simulation_a_real_validation() -> None:
    assert labels.main(["--quiet"]) == 0


# ---------------------------------------------------------------------------
# 2. The evaluator's own semantics
# ---------------------------------------------------------------------------


def test_sum_over_an_empty_set_is_blank_and_plus_zero_makes_it_zero(simulation: Any) -> None:
    empty = next(
        context for context in harness.truth.CONTEXTS if context.context_id == "empty-month"
    )
    context = simulation._context_for(empty)
    assert dax.is_blank(simulation.engine.evaluate_measure("Total Gross", context))
    assert simulation.engine.evaluate_measure("Retail Units Sold", context) == 0


def test_divide_returns_blank_rather_than_raising() -> None:
    model = dax.SimulatedModel()
    engine = dax.SimulationEngine(model, {})
    node = dax.parse_dax("DIVIDE ( 1, 0 )")
    assert dax.is_blank(engine._evaluate(node, dax.FilterContext(), {}))


def test_an_unsupported_function_is_refused_rather_than_guessed() -> None:
    model = dax.SimulatedModel()
    engine = dax.SimulationEngine(model, {})
    node = dax.parse_dax("SUMX ( 'vw_leads', 1 )")
    with pytest.raises(dax.UnsupportedDaxError):
        engine._evaluate(node, dax.FilterContext(), {})


def test_a_filter_on_a_dimension_reaches_the_facts_it_relates_to(simulation: Any) -> None:
    unfiltered = simulation.engine.evaluate_measure("Retail Units Sold")
    one_store = simulation.engine.evaluate_measure(
        "Retail Units Sold",
        dax.context_from_filters({("vw_dealership", "dealership_code"): "GSA-001"}),
    )
    assert unfiltered > one_store > 0


# ---------------------------------------------------------------------------
# 3. Teeth: each mutation must be caught by the family that owns it
# ---------------------------------------------------------------------------


def test_a_swapped_denominator_is_caught_by_reconciliation(fresh: Any) -> None:
    fresh.model.measures["Contact Rate"].ast = dax.parse_dax(
        "DIVIDE ( SUM ( 'vw_leads'[contacted_lead_count] ), SUM ( 'vw_leads'[lead_count] ) )"
    )
    fresh.check_expressions()
    fresh.check_reconciliation()
    assert any("Contact Rate" in finding.detail for finding in fresh.findings)


def test_a_wrong_column_is_caught_by_reconciliation(fresh: Any) -> None:
    fresh.model.measures["New Units Sold"].ast = dax.parse_dax(
        "SUM ( 'vw_vehicle_sales'[used_unit_count] ) + 0"
    )
    fresh.check_expressions()
    fresh.check_reconciliation()
    assert any("New Units Sold" in finding.detail for finding in fresh.findings)


def test_dropping_the_userelationship_is_caught_by_the_filter_context_family(
    fresh: Any,
) -> None:
    fresh.model.measures["Show-to-Sale Conversion"].ast = dax.parse_dax(
        "DIVIDE ( SUM ( 'vw_appointments'[shown_and_sold_appointment_count] ), "
        "SUM ( 'vw_appointments'[shown_appointment_count] ) )"
    )
    fresh.check_expressions()
    fresh.check_filter_context()
    assert any("show-date basis" in finding.detail for finding in fresh.findings)


def test_dropping_the_userelationship_is_also_caught_by_metadata(fresh: Any) -> None:
    fresh.model.measures["Show-to-Sale Conversion"].ast = dax.parse_dax(
        "DIVIDE ( SUM ( 'vw_appointments'[shown_and_sold_appointment_count] ), "
        "SUM ( 'vw_appointments'[shown_appointment_count] ) )"
    )
    fresh.check_expressions()
    fresh.check_metadata()
    assert any("USERELATIONSHIP" in finding.detail for finding in fresh.findings)


def test_making_a_semi_additive_measure_additive_is_caught(fresh: Any) -> None:
    fresh.model.measures["Active Inventory Count"].ast = dax.parse_dax(
        "SUM ( 'vw_inventory_snapshots'[inventory_unit_count] )"
    )
    fresh.check_expressions()
    fresh.check_aggregation()
    assert any("Active Inventory Count" in finding.detail for finding in fresh.findings)


def test_losing_the_explicit_zero_is_caught_by_the_blank_family(fresh: Any) -> None:
    fresh.model.measures["Leads Received"].ast = dax.parse_dax(
        "SUM ( 'vw_leads'[valid_lead_count] )"
    )
    fresh.check_expressions()
    fresh.check_blank_behaviour()
    assert any("Leads Received" in finding.detail for finding in fresh.findings)


def test_a_ratio_that_returns_zero_instead_of_blank_is_caught(fresh: Any) -> None:
    fresh.model.measures["Contact Rate"].ast = dax.parse_dax(
        "DIVIDE ( SUM ( 'vw_leads'[contacted_lead_count] ), "
        "SUM ( 'vw_leads'[valid_lead_count] ), 0 )"
    )
    fresh.check_expressions()
    fresh.check_zero_denominators()
    assert any("Contact Rate" in finding.detail for finding in fresh.findings)


def test_a_condition_filter_reaching_the_funnel_is_caught(fresh: Any) -> None:
    for row in fresh.fact_source["vw_leads"]:
        row["condition_group"] = "New"
    fresh.model.columns["vw_leads"].add("condition_group")
    original = harness.truth.CONDITION_TABLES
    harness.truth.CONDITION_TABLES = (*original, "vw_leads")
    try:
        fresh.check_expressions()
        fresh.check_filter_context()
    finally:
        harness.truth.CONDITION_TABLES = original
    assert any("Used" in finding.detail for finding in fresh.findings)


def test_a_renamed_column_in_the_fact_source_is_caught(fresh: Any) -> None:
    fresh.fact_source["vw_leads"][0]["valid_leads"] = 1
    fresh.check_fact_source()
    assert any("valid_leads" in finding.detail for finding in fresh.findings)


def test_a_broken_baseline_identity_is_caught(
    fresh: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = json.loads(harness.SQL_BASELINE_PATH.read_text(encoding="utf-8"))
    document["contexts"][0]["measures"]["KPI-GRS-004"] = 1.0
    broken = tmp_path / "sql_baseline.json"
    broken.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(harness, "SQL_BASELINE_PATH", broken)
    fresh.check_baseline_algebra()
    assert any("KPI-GRS-004" in finding.detail for finding in fresh.findings)


def test_an_unsimulated_measure_is_reported_rather_than_passed(fresh: Any) -> None:
    fresh.model.measures["Total Gross"].ast = dax.parse_dax(
        "SUMX ( 'vw_vehicle_sales', 'vw_vehicle_sales'[retail_total_gross] )"
    )
    fresh.check_expressions()
    assert "Total Gross" in fresh.not_simulated
    assert "Total Gross" not in fresh.simulated_measure_names()
    assert any("Total Gross" in finding.detail for finding in fresh.findings)


# ---------------------------------------------------------------------------
# 4. Teeth for the labelling check
# ---------------------------------------------------------------------------


def test_the_label_check_rejects_an_artifact_that_drops_its_label(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    document["validation_kind"] = "Power BI validation"
    mutated = tmp_path / "simulated_semantic_model_results.json"
    mutated.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(labels, "RESULTS_PATH", mutated)
    failures: list[str] = []
    labels.check_artifacts(failures)
    assert failures


def test_the_label_check_rejects_an_artifact_claiming_a_passing_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    document["desktop_validation"] = "PASSED"
    mutated = tmp_path / "simulated_semantic_model_results.json"
    mutated.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setattr(labels, "RESULTS_PATH", mutated)
    failures: list[str] = []
    labels.check_engine_states(failures)
    assert any("desktop_validation" in failure for failure in failures)


def test_the_label_check_rejects_a_document_calling_the_simulation_validated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The offending sentence is assembled at runtime rather than written out. A test file
    # is a tracked text file, so a source line carrying both the artifact name and the
    # claim would be caught by the very check it exists to exercise -- which is the check
    # working, and would still be a broken build. Neither line below trips it alone.
    artifact = "simulated_semantic_model_results.json"
    claim = "shows the model is Power BI " + "validated"
    offender = tmp_path / "notes.md"
    offender.write_text(f"The {artifact} {claim}.\n", encoding="utf-8")
    monkeypatch.setattr(labels, "tracked_files", lambda: [offender])
    monkeypatch.setattr(labels, "REPO_ROOT", tmp_path)
    failures: list[str] = []
    labels.check_prose(failures)
    assert failures


def test_the_label_check_allows_a_denial(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    honest = tmp_path / "notes.md"
    honest.write_text(
        "simulated_semantic_model_results.json is not a Power BI validated result.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(labels, "tracked_files", lambda: [honest])
    monkeypatch.setattr(labels, "REPO_ROOT", tmp_path)
    failures: list[str] = []
    labels.check_prose(failures)
    assert failures == []
