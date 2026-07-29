"""The headline invariants of the ARPI Power BI semantic model, named one by one.

`scripts/check_powerbi_model.py` is the exhaustive check; this module runs it and
then re-states, as separately named tests, the facts a reviewer wants to see in a
test report rather than have to infer from a single green tick. "26 tables" and
"0 bidirectional relationships" are claims about the model, and a claim that is
only ever asserted inside a script nobody reads is not evidence.

A second group of tests gives the checker teeth: each mutates the parsed model in
memory and asserts that the relevant check notices. A validator that has never
been shown to fail is not a validator.

No database and no Power BI Desktop: everything here is text.
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


def _load_script(name: str) -> ModuleType:
    """Import `scripts/<name>.py` by path.

    The scripts are standard-library-only CI tools that deliberately do not live
    in the installable package, so there is no import path to them.
    """
    path = SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"arpi_scripts.{name}", path)
    assert spec is not None and spec.loader is not None, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    # Registered before execution so that dataclasses can resolve the module.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


model_check = _load_script("check_powerbi_model")
freshness_check = _load_script("check_desktop_validation_freshness")


@pytest.fixture(scope="module")
def checked_model() -> Any:
    """A Checker that has run every check against the committed model."""
    checker = model_check.Checker()
    checker.run()
    return checker


@pytest.fixture
def parsed_model() -> Any:
    """A freshly parsed model, function-scoped so a test may mutate it."""
    checker = model_check.Checker()
    checker.load_model()
    return checker


def _is_active(relationship: Any) -> bool:
    declared: str = relationship.properties.get("isActive", "true")
    return declared.strip().lower() != "false"


# --------------------------------------------------------------------------------------
# The validators run clean
# --------------------------------------------------------------------------------------


def test_the_static_model_check_passes(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = model_check.main(["--quiet"])
    captured = capsys.readouterr()
    assert exit_code == 0, f"scripts/check_powerbi_model.py reported:\n{captured.out}"


def test_the_static_model_check_reports_no_findings(checked_model: Any) -> None:
    rendered = "\n".join(finding.render() for finding in checked_model.findings)
    assert checked_model.findings == [], f"the model departs from its specification:\n{rendered}"


def test_the_desktop_validation_evidence_is_not_stale(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = freshness_check.main(["--quiet"])
    captured = capsys.readouterr()
    assert exit_code == 0, captured.out


def test_the_desktop_validation_evidence_is_never_reported_as_passed_while_pending() -> None:
    """PENDING must not block the branch, and must never read as a passing result."""
    evidence = json.loads(freshness_check.EVIDENCE_FILE.read_text(encoding="utf-8"))
    if evidence.get("overall_result") != "pending":
        pytest.skip("the Desktop validation evidence is no longer pending")
    status, _ = freshness_check.classify(evidence, "any-hash")
    assert status == "PENDING"
    assert freshness_check.STATUS_EXIT_CODES[status] == 0


# --------------------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------------------


def test_the_model_declares_exactly_twenty_six_tables(checked_model: Any) -> None:
    assert len(checked_model.tables) == 26, sorted(checked_model.tables)


def test_exactly_twenty_tables_are_imported_from_the_reporting_schema(
    checked_model: Any,
) -> None:
    imported = sorted(set(checked_model.tables) & set(model_check.IMPORTED_TABLES))
    assert len(imported) == 20
    assert imported == sorted(model_check.IMPORTED_TABLES)


def test_exactly_six_tables_carry_the_measures(checked_model: Any) -> None:
    measure_tables = sorted(set(checked_model.tables) & set(model_check.MEASURE_TABLES))
    assert len(measure_tables) == 6
    assert measure_tables == sorted(model_check.MEASURE_TABLES)


@pytest.mark.parametrize("table_name", model_check.IMPORTED_TABLES)
def test_every_imported_table_reads_only_the_reporting_schema(
    checked_model: Any, table_name: str
) -> None:
    table = checked_model.tables[table_name]
    source = model_check.partition_source(table.children_of("partition")[0])
    assert f'Schema = "reporting", Item = "{table_name}"' in source
    for forbidden in model_check.FORBIDDEN_SCHEMA_PREFIXES:
        assert forbidden not in source


# --------------------------------------------------------------------------------------
# Relationships
# --------------------------------------------------------------------------------------


def test_the_model_declares_exactly_forty_two_relationships(checked_model: Any) -> None:
    assert len(checked_model.relationships) == 42


def test_exactly_thirty_two_relationships_are_active(checked_model: Any) -> None:
    active = [r.name for r in checked_model.relationships if _is_active(r)]
    assert len(active) == 32, sorted(active)


def test_exactly_ten_relationships_are_inactive(checked_model: Any) -> None:
    inactive = [r.name for r in checked_model.relationships if not _is_active(r)]
    assert len(inactive) == 10, sorted(inactive)


def test_no_relationship_filters_in_both_directions(checked_model: Any) -> None:
    """A bidirectional filter is how one model starts giving two answers."""
    bidirectional = [
        relationship.name
        for relationship in checked_model.relationships
        if relationship.properties.get("crossFilteringBehavior", "").strip()
        in {"bothDirections", "automatic"}
    ]
    assert bidirectional == []


def test_no_relationship_is_many_to_many(checked_model: Any) -> None:
    many_to_many = [
        relationship.name
        for relationship in checked_model.relationships
        if relationship.properties.get("toCardinality", "one").strip() == "many"
        or (
            relationship.properties.get("fromCardinality", "many").strip() == "one"
            and relationship.properties.get("toCardinality", "one").strip() == "many"
        )
    ]
    assert many_to_many == []


def test_no_active_relationship_joins_two_fact_tables(checked_model: Any) -> None:
    by_name = {r.name: r for r in checked_model.relationships}
    offenders = [
        spec.name
        for spec in model_check.RELATIONSHIP_REGISTER
        if spec.from_table in model_check.FACT_TABLES
        and spec.to_table in model_check.FACT_TABLES
        and spec.name in by_name
        and _is_active(by_name[spec.name])
    ]
    assert offenders == []


def test_exactly_one_table_is_marked_as_the_date_table(checked_model: Any) -> None:
    marked = [
        name
        for name, table in checked_model.tables.items()
        if table.properties.get("dataCategory") == "Time"
    ]
    assert marked == ["vw_calendar"]


# --------------------------------------------------------------------------------------
# Columns
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("table_name", sorted(model_check.IMPORTED_TABLES))
def test_every_surrogate_key_column_is_hidden(checked_model: Any, table_name: str) -> None:
    table = checked_model.tables[table_name]
    visible_keys = [
        column.name
        for column in table.children_of("column")
        if column.name.endswith("_key") and "isHidden" not in column.flags
    ]
    assert visible_keys == [], f"{table_name} exposes surrogate key(s) {visible_keys}"


@pytest.mark.parametrize("table_name", sorted(model_check.IMPORTED_TABLES))
def test_no_column_declares_an_implicit_aggregation(checked_model: Any, table_name: str) -> None:
    table = checked_model.tables[table_name]
    offenders = [
        f"{column.name}={column.properties.get('summarizeBy')}"
        for column in table.children_of("column")
        if column.properties.get("summarizeBy") != "none"
    ]
    assert offenders == []


def test_the_model_declares_exactly_the_twelve_registered_sort_by_pairings(
    checked_model: Any,
) -> None:
    """`vw_reconciliation_status` has none: severity_rank does not order `status`."""
    declared = sorted(
        (name, column.name, column.properties["sortByColumn"])
        for name, table in checked_model.tables.items()
        for column in table.children_of("column")
        if "sortByColumn" in column.properties
    )
    expected = sorted(
        (spec.table, spec.column, spec.sort_by) for spec in model_check.SORT_BY_REGISTER
    )
    assert declared == expected
    assert len(expected) == 12
    assert all(table != "vw_reconciliation_status" for table, _, _ in declared)


@pytest.mark.parametrize("table_name", sorted(model_check.IMPORTED_TABLES))
def test_no_table_carries_a_personally_identifying_column(
    checked_model: Any, table_name: str
) -> None:
    table = checked_model.tables[table_name]
    offenders = [
        column.name
        for column in table.children_of("column")
        for fragment in model_check.FORBIDDEN_COLUMN_FRAGMENTS
        if fragment in column.name.lower()
    ]
    assert offenders == []


# --------------------------------------------------------------------------------------
# Measures
# --------------------------------------------------------------------------------------


def test_the_model_declares_exactly_forty_nine_measures(checked_model: Any) -> None:
    assert len(checked_model.measures()) == 49


def test_every_measure_name_is_unique_across_the_whole_model(checked_model: Any) -> None:
    names = [measure.name for _, measure in checked_model.measures()]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    assert duplicates == []
    assert len(set(names)) == 49


def test_exactly_twenty_nine_measures_carry_a_kpi_identifier(checked_model: Any) -> None:
    kpi_ids = [
        measure.annotations["ARPI_KpiId"]
        for _, measure in checked_model.measures()
        if "ARPI_KpiId" in measure.annotations
    ]
    assert len(kpi_ids) == 29


def test_the_kpi_identifiers_are_exactly_the_governed_twenty_nine(
    checked_model: Any,
) -> None:
    kpi_ids = sorted(
        measure.annotations["ARPI_KpiId"]
        for _, measure in checked_model.measures()
        if "ARPI_KpiId" in measure.annotations
    )
    assert kpi_ids == sorted(model_check.EXPECTED_KPI_IDS)


@pytest.mark.parametrize("kpi_id", model_check.EXPECTED_KPI_IDS)
def test_every_governed_kpi_is_implemented_exactly_once(checked_model: Any, kpi_id: str) -> None:
    owners = [
        f"{table}[{measure.name}]"
        for table, measure in checked_model.measures()
        if measure.annotations.get("ARPI_KpiId") == kpi_id
    ]
    assert len(owners) == 1, f"{kpi_id} is implemented by {owners}"


def test_exactly_twenty_measures_are_supporting_measures(checked_model: Any) -> None:
    supporting = [
        measure.name
        for _, measure in checked_model.measures()
        if "ARPI_KpiId" not in measure.annotations
        and measure.annotations.get("ARPI_MeasureRole") == "Supporting"
    ]
    assert len(supporting) == 20, sorted(supporting)


def test_exactly_eleven_measures_are_executive_cards(checked_model: Any) -> None:
    cards = [
        measure.name
        for _, measure in checked_model.measures()
        if measure.annotations.get("ARPI_ExecutiveCard") == "true"
    ]
    assert len(cards) == 11, sorted(cards)


@pytest.mark.parametrize("measure_name", model_check.RATIO_MEASURES)
def test_every_ratio_measure_divides_with_divide(checked_model: Any, measure_name: str) -> None:
    measure = checked_model.measure_by_name(measure_name)
    assert measure is not None, f"measure {measure_name!r} does not exist"
    assert "DIVIDE" in measure.expression


@pytest.mark.parametrize("measure_name", model_check.SEMI_ADDITIVE_MEASURES)
def test_every_inventory_stock_measure_is_anchored_on_the_last_date_in_context(
    checked_model: Any, measure_name: str
) -> None:
    """A stock summed across dates is overstated by roughly the number of days."""
    measure = checked_model.measure_by_name(measure_name)
    assert measure is not None, f"measure {measure_name!r} does not exist"
    assert "LASTNONBLANK" in measure.expression


@pytest.mark.parametrize("measure_name", model_check.LASTNONBLANKVALUE_MEASURES)
def test_seven_stock_measures_anchor_with_lastnonblankvalue(
    checked_model: Any, measure_name: str
) -> None:
    measure = checked_model.measure_by_name(measure_name)
    assert measure is not None, f"measure {measure_name!r} does not exist"
    assert "LASTNONBLANKVALUE" in measure.expression


def test_seven_of_the_eight_stock_measures_use_lastnonblankvalue() -> None:
    assert len(model_check.SEMI_ADDITIVE_MEASURES) == 8
    assert len(model_check.LASTNONBLANKVALUE_MEASURES) == 7
    assert "Dealer Days Supply" not in model_check.LASTNONBLANKVALUE_MEASURES


@pytest.mark.parametrize(
    ("measure_name", "required_terms"), model_check.LASTNONBLANK_ROW_ANCHORED_MEASURES
)
def test_dealer_days_supply_anchors_on_the_last_date_with_a_row(
    checked_model: Any, measure_name: str, required_terms: tuple[str, ...]
) -> None:
    """Its ratio is legitimately blank when the trailing window holds no sale.

    LASTNONBLANKVALUE would walk backwards past that date and report an earlier
    day's days supply as current, disagreeing with the SQL baseline, which takes
    max(as_of_date_key) unconditionally.
    """
    measure = checked_model.measure_by_name(measure_name)
    assert measure is not None, f"measure {measure_name!r} does not exist"
    assert "LASTNONBLANKVALUE" not in measure.expression
    for term in required_terms:
        assert term in measure.expression
    assert "DIVIDE" in measure.expression


@pytest.mark.parametrize("phrase", model_check.DEFERRED_DOMAIN_PHRASES)
def test_no_measure_names_a_deferred_domain(checked_model: Any, phrase: str) -> None:
    offenders = [
        f"{table}[{measure.name}]"
        for table, measure in checked_model.measures()
        if phrase in measure.name.lower()
    ]
    assert offenders == []


@pytest.mark.parametrize("table_name", model_check.DEFERRED_DOMAIN_TABLES)
def test_no_deferred_domain_measure_table_exists(checked_model: Any, table_name: str) -> None:
    assert table_name not in checked_model.tables


# --------------------------------------------------------------------------------------
# Artefacts that must not exist
# --------------------------------------------------------------------------------------


def test_no_pbix_exists_anywhere_in_the_repository() -> None:
    """ARPI is a PBIP/TMDL project: a PBIX is an opaque binary and is policy P2.1."""
    binaries = sorted(
        path.relative_to(REPO_ROOT).as_posix()
        for path in REPO_ROOT.rglob("*.pbix")
        if not any(part in model_check.SKIPPED_DIRECTORY_NAMES for part in path.parts)
    )
    assert binaries == []


@pytest.mark.parametrize("entry", model_check.FORBIDDEN_REPORT_ENTRIES)
def test_no_report_visual_content_exists(entry: str) -> None:
    """Report authoring is delivery increment P2.2 and has not started."""
    assert not (model_check.REPORT_DIR / entry).exists()


def test_no_local_power_bi_state_is_tracked() -> None:
    state = sorted(
        path.relative_to(REPO_ROOT).as_posix()
        for pattern in ("**/.pbi/localSettings.json", "**/.pbi/cache.abf", "**/*.abf")
        for path in REPO_ROOT.glob(pattern)
        if not any(part in model_check.SKIPPED_DIRECTORY_NAMES for part in path.parts)
    )
    assert state == []


def test_no_credential_material_appears_under_powerbi(checked_model: Any) -> None:
    credential_findings = [
        finding.render()
        for finding in checked_model.findings
        if "credential material" in finding.message
    ]
    assert credential_findings == []


def test_only_the_two_non_secret_parameters_are_declared(checked_model: Any) -> None:
    assert [expression.name for expression in checked_model.expressions] == [
        "ArpiServer",
        "ArpiDatabase",
    ]


# --------------------------------------------------------------------------------------
# The checker has teeth
# --------------------------------------------------------------------------------------


def test_the_hidden_key_check_notices_an_exposed_key(parsed_model: Any) -> None:
    column = parsed_model.tables["vw_vehicle_sales"].child("column", "dealership_key")
    column.flags.discard("isHidden")
    parsed_model._check_hidden_keys()
    assert any("dealership_key" in finding.message for finding in parsed_model.findings)


def test_the_relationship_check_notices_a_bidirectional_filter(parsed_model: Any) -> None:
    relationship = parsed_model.relationships[0]
    relationship.properties["crossFilteringBehavior"] = "bothDirections"
    parsed_model.check_relationships()
    assert any("crossFilteringBehavior" in finding.message for finding in parsed_model.findings)


def test_the_measure_check_notices_a_missing_kpi(parsed_model: Any) -> None:
    measure = parsed_model.tables["Sales Measures"].child("measure", "Retail Units Sold")
    del measure.annotations["ARPI_KpiId"]
    parsed_model.check_measures()
    assert any("KPI-SLS-001" in finding.message for finding in parsed_model.findings)


def test_the_date_table_check_notices_a_second_marked_date_table(parsed_model: Any) -> None:
    parsed_model.tables["vw_marketing_spend"].properties["dataCategory"] = "Time"
    parsed_model.check_marked_date_table()
    assert any("dataCategory: Time" in finding.message for finding in parsed_model.findings)


def test_the_sort_by_check_notices_an_unregistered_pairing(parsed_model: Any) -> None:
    column = parsed_model.tables["vw_reconciliation_status"].child("column", "status")
    column.properties["sortByColumn"] = "severity_rank"
    parsed_model.check_sort_by_columns()
    assert any("severity_rank" in finding.message for finding in parsed_model.findings)


def test_the_schema_check_notices_an_unauthorised_schema(parsed_model: Any) -> None:
    partition = parsed_model.tables["vw_leads"].children_of("partition")[0]
    partition.properties["source"] = 'Source{[Schema = "warehouse", Item = "fact_lead"]}[Data]'
    parsed_model.check_source_schemas()
    assert any("warehouse" in finding.message for finding in parsed_model.findings)


# --------------------------------------------------------------------------------------
# The TMDL reader itself
# --------------------------------------------------------------------------------------


def test_the_tmdl_reader_reads_a_table_a_column_a_measure_and_a_partition() -> None:
    source = (
        "/// A table.\n"
        "table 'Some Table'\n"
        "\tdataCategory: Time\n"
        "\n"
        "\t/// A column.\n"
        "\tcolumn some_key\n"
        "\t\tdataType: int64\n"
        "\t\tisHidden\n"
        "\t\tsourceColumn: some_key\n"
        "\t\tsummarizeBy: none\n"
        "\n"
        "\t\tannotation SummarizationSetBy = User\n"
        "\n"
        "\t/// A measure.\n"
        "\tmeasure 'Some Ratio' =\n"
        "\t\t\tDIVIDE (\n"
        "\t\t\t    SUM ( 'Some Table'[a] ),\n"
        "\t\t\t    SUM ( 'Some Table'[b] )\n"
        "\t\t\t)\n"
        "\t\tformatString: 0.0%\n"
        "\n"
        "\t\tannotation ARPI_KpiId = KPI-XXX-001\n"
        "\n"
        "\tpartition 'Some Table' = m\n"
        "\t\tmode: import\n"
        "\t\tsource =\n"
        "\t\t\t\tlet\n"
        '\t\t\t\t    Data = Source{[Schema = "reporting", Item = "x"]}[Data]\n'
        "\t\t\t\tin\n"
        "\t\t\t\t    Data\n"
        "\n"
        "\tannotation ARPI_TableRole = Dimension\n"
    )
    (table,) = model_check.parse_tmdl(source)
    assert table.kind == "table"
    assert table.name == "Some Table"
    assert table.description == "A table."
    assert table.properties["dataCategory"] == "Time"
    assert table.annotations["ARPI_TableRole"] == "Dimension"

    column = table.child("column", "some_key")
    assert column is not None
    assert column.description == "A column."
    assert "isHidden" in column.flags
    assert column.properties["summarizeBy"] == "none"
    assert column.annotations["SummarizationSetBy"] == "User"

    measure = table.child("measure", "Some Ratio")
    assert measure is not None
    assert "DIVIDE" in measure.expression
    assert measure.properties["formatString"] == "0.0%"
    assert measure.annotations["ARPI_KpiId"] == "KPI-XXX-001"

    partition = table.children_of("partition")[0]
    assert partition.expression == "m"
    assert partition.properties["mode"] == "import"
    assert 'Schema = "reporting"' in model_check.partition_source(partition)


# --------------------------------------------------------------------------------------
# The freshness check
# --------------------------------------------------------------------------------------


def test_the_model_source_hash_is_stable_and_covers_the_whole_definition() -> None:
    files = freshness_check.model_source_files()
    names = {path.name for path in files}
    assert "definition.pbism" in names
    assert "model.tmdl" in names
    assert "relationships.tmdl" in names
    first = freshness_check.compute_model_source_hash(files)
    second = freshness_check.compute_model_source_hash(files)
    assert first == second
    assert len(first) == 64


def test_print_hash_prints_only_the_hash_and_exits_zero(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The PowerShell Desktop validator consumes this output verbatim."""
    exit_code = freshness_check.main(["--print-hash"])
    printed = capsys.readouterr().out.strip()
    assert exit_code == 0
    assert printed == freshness_check.compute_model_source_hash(
        freshness_check.model_source_files()
    )


@pytest.mark.parametrize(
    ("evidence", "expected_status"),
    [
        (None, "MISSING"),
        ({"overall_result": "pending", "model_source_hash": None}, "PENDING"),
        ({"overall_result": "pending", "model_source_hash": "current"}, "PENDING"),
        ({"overall_result": "passed", "model_source_hash": "current"}, "PASSED"),
        ({"overall_result": "passed", "model_source_hash": "other"}, "STALE"),
        ({"overall_result": "failed", "model_source_hash": "other"}, "STALE"),
        ({"overall_result": "failed", "model_source_hash": "current"}, "FAILED"),
        ({"overall_result": "passed", "model_source_hash": None}, "STALE"),
        ({"overall_result": "unknown", "model_source_hash": "current"}, "FAILED"),
    ],
    ids=[
        "no-evidence-file",
        "pending-with-no-hash",
        "pending-with-matching-hash",
        "passed-against-this-model",
        "passed-against-another-model",
        "failed-against-another-model",
        "failed-against-this-model",
        "passed-with-no-hash",
        "unrecognised-result",
    ],
)
def test_the_freshness_check_distinguishes_every_status(
    evidence: dict[str, Any] | None, expected_status: str
) -> None:
    status, explanation = freshness_check.classify(evidence, "current")
    assert status == expected_status
    assert explanation


@pytest.mark.parametrize(
    ("status", "expected_exit_code"),
    [
        ("PASSED", 0),
        ("PENDING", 0),
        ("STALE", 1),
        ("FAILED", 1),
        ("MISSING", 1),
    ],
)
def test_only_passed_and_pending_leave_the_build_green(
    status: str, expected_exit_code: int
) -> None:
    assert freshness_check.STATUS_EXIT_CODES[status] == expected_exit_code
