"""SIMULATED SEMANTIC-MODEL VALIDATION — the harness.

WHAT THIS COMMAND DOES
----------------------
It runs every check that can be made about the ARPI semantic model **without a Microsoft
engine**, and writes the result to
`powerbi/validation/simulated_semantic_model_results.json`.

Ten families of check, in order:

1.  **Structure.** `scripts/check_powerbi_model.py`, composed rather than duplicated.
2.  **Fact-source conformance.** Every column the simulated fact source declares exists in
    the committed TMDL, and every data table in the model appears in the fact source.
3.  **Expression coverage.** Every measure parses into the simulated DAX subset. Anything
    that does not is reported as NOT SIMULATED, never as a pass.
4.  **Measure metadata.** The annotations and the expression agree: the source table, the
    date basis, and the one measure that names a non-default relationship.
5.  **Reconciliation to governed SQL truth.** Every measure, in every simulated context,
    evaluated twice — once by parsing the TMDL and applying filter context, once by
    computing the governed definition straight from the rows — and compared.
6.  **Zero-denominator behaviour.** Every ratio returns BLANK, not zero and not an error.
7.  **Blank and null behaviour.** The measures written to return an explicit zero do; the
    measures written to return BLANK do; a null-bearing column is skipped, not read as zero.
8.  **Aggregation behaviour.** Additive measures add up across a partition. Semi-additive
    measures do not, and are pinned to their last-date value.
9.  **Filter-context assumptions.** A condition filter does not reach the funnel; the
    show-date measure moves when the scheduled-date measures do not; an inactive
    relationship carries no filter until a measure invokes it.
10. **Governed SQL baseline algebra.** The identities the model's measure graph implies,
    checked against `powerbi/validation/sql_baseline.json` — real governed numbers from
    the development database, across all twenty-one of its filter contexts.

WHAT A GREEN RUN IS NOT
-----------------------
It is not a Power BI validation, not a Desktop validation, not a Fabric validation, and
not Gate 2. No Microsoft semantic-model engine is contacted, launched or consulted at any
point; families 1-9 read text and rows in this repository, and family 10 reads a JSON file
of SQL results. Real-engine validation remains externally pending, and the artifact this
command writes says so in three of its own fields. See
`docs/architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md`.

USAGE
-----
    python scripts/simulate_semantic_model.py            # run and rewrite the artifact
    python scripts/simulate_semantic_model.py --check    # run and fail if it would change
    python scripts/simulate_semantic_model.py --quiet    # findings only
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import math
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dax_simulation as dax
import simulated_sql_truth as truth

REPO_ROOT = Path(__file__).resolve().parents[1]
VALIDATION_DIR = REPO_ROOT / "powerbi" / "validation"
FACT_SOURCE_PATH = VALIDATION_DIR / "simulated_fact_source.json"
RESULTS_PATH = VALIDATION_DIR / "simulated_semantic_model_results.json"
SQL_BASELINE_PATH = VALIDATION_DIR / "sql_baseline.json"

#: The label this artifact carries, and the only label it may ever carry.
VALIDATION_KIND = "SIMULATED SEMANTIC-MODEL VALIDATION"

#: Relative and absolute tolerance for comparing two computed numbers.
RELATIVE_TOLERANCE = 1e-9
ABSOLUTE_TOLERANCE = 1e-9

#: The SQL baseline stores six decimal places, so identities derived from it can only be
#: checked to about that precision.
BASELINE_RELATIVE_TOLERANCE = 1e-5
BASELINE_ABSOLUTE_TOLERANCE = 5e-6

#: How many measure values a single context contributes to the recorded evidence.
_ROUNDING = 6


@dataclass
class Finding:
    """One thing the simulation found wrong."""

    family: str
    detail: str

    def render(self) -> str:
        """Render for a terminal."""
        return f"  [{self.family}] {self.detail}"


@dataclass
class Family:
    """One family of checks and what it concluded."""

    key: str
    title: str
    checks: int = 0
    findings: list[Finding] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def record(self, ok: bool, detail: str) -> bool:
        """Count a check and, when it failed, record why."""
        self.checks += 1
        if not ok:
            self.findings.append(Finding(self.key, detail))
        return ok


def _load_script(name: str) -> Any:
    """Import a sibling script by path, the way the rest of `scripts/` does."""
    path = Path(__file__).resolve().parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"arpi_scripts.{name}", path)
    if spec is None or spec.loader is None:  # pragma: no cover - a broken checkout only
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _normalise(value: Any) -> Any:
    """Fold both sides' notion of emptiness onto None so they can be compared."""
    if value is dax.BLANK or value is None or value == truth.BLANK:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return float(value)
    return value


def _close(left: Any, right: Any, relative: float, absolute: float) -> bool:
    """Compare two normalised values, numerically when both are numbers."""
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, float) and isinstance(right, float):
        return math.isclose(left, right, rel_tol=relative, abs_tol=absolute)
    return bool(left == right)


def _render(value: Any) -> Any:
    """Render a value for the JSON artifact: BLANK becomes null, floats are rounded."""
    normalised = _normalise(value)
    if isinstance(normalised, float):
        rounded = round(normalised, _ROUNDING)
        return int(rounded) if rounded.is_integer() else rounded
    return normalised


# ---------------------------------------------------------------------------
# Declarative expectations
# ---------------------------------------------------------------------------

#: Measures written with the `+ 0` idiom, which must return an explicit zero — not BLANK —
#: when their context is empty, so that a quiet day appears on a trend line.
EXPLICIT_ZERO_MEASURES = frozenset(
    {
        "Retail Units Sold",
        "New Units Sold",
        "Used Units Sold",
        "Leads Received",
        "Unresponded Leads",
        "Duplicate Leads",
        "Sold Leads",
        "Eligible Appointments",
        "Shown Appointments",
        "Advance Cancellations",
        "Checks Passed",
        "Checks Failed",
        "Checks Skipped",
        "Rejected Rows",
        "Critical Reconciliations Failed",
    }
)

#: Ratio measures, which must be BLANK — never zero — when their denominator is empty.
RATIO_MEASURES = frozenset(
    {
        "Front Gross per Retail Unit",
        "Back Gross per Retail Unit",
        "Total Gross per Retail Unit",
        "Average Inventory Age",
        "Aged Inventory Percentage",
        "Inventory Turn",
        "Dealer Days Supply",
        "Days to Sale (Mean)",
        "Contact Rate",
        "Appointment-Set Rate",
        "Show Rate",
        "Show-to-Sale Conversion",
        "Lead-to-Sale Conversion",
        "Average Response Time",
        "Median Response Time",
        "Cancellation Rate",
        "Pass Rate",
        "Evaluation Coverage",
        "Cost per Lead",
        "Cost per Sale",
        "Gross Return on Advertising Spend",
    }
)

#: Measures a condition filter must not move, because no relationship carries it to their
#: source table. The funnel is the case a report author gets wrong most often.
CONDITION_BLIND_MEASURES = frozenset(
    {
        "Leads Received",
        "Contact Rate",
        "Appointment-Set Rate",
        "Show Rate",
        "Show-to-Sale Conversion",
        "Lead-to-Sale Conversion",
        "Unresponded Leads",
        "Duplicate Leads",
        "Sold Leads",
        "Eligible Appointments",
        "Shown Appointments",
        "Advance Cancellations",
        "Cancellation Rate",
    }
)

#: Baseline identities implied by the measure graph: `target = expression of others`.
#: Each is checked in all twenty-one governed contexts.
RATIO_IDENTITIES: tuple[tuple[str, str, str], ...] = (
    ("KPI-GRS-004", "KPI-GRS-001", "KPI-SLS-001"),
    ("KPI-GRS-005", "KPI-GRS-002", "KPI-SLS-001"),
    ("KPI-GRS-006", "KPI-GRS-003", "KPI-SLS-001"),
    ("KPI-INV-006", "KPI-INV-005", "KPI-INV-001"),
    ("KPI-FUN-004", "SUP-SHOWN-APPOINTMENTS", "SUP-ELIGIBLE-APPOINTMENTS"),
    ("KPI-FUN-006", "SUP-SOLD-LEADS", "KPI-FUN-001"),
)

#: Baseline identities of the form `total = a + b`.
SUM_IDENTITIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("KPI-SLS-001", ("KPI-SLS-002", "KPI-SLS-003")),
    ("KPI-GRS-003", ("KPI-GRS-001", "KPI-GRS-002")),
)

#: Contexts that partition the whole model, and the measures that must add up over them.
STORE_CONTEXTS = ("store-GSA-001", "store-GSA-002", "store-GSA-003")
MONTH_CONTEXTS = (
    "month-2025-07",
    "month-2025-08",
    "month-2025-09",
    "month-2025-10",
    "month-2025-11",
    "month-2025-12",
)
CONDITION_CONTEXTS = ("condition-New", "condition-Used")

#: Additive everywhere: over stores, over months, and over the condition split.
FULLY_ADDITIVE_KEYS = (
    "KPI-SLS-001",
    "KPI-SLS-002",
    "KPI-SLS-003",
    "KPI-GRS-001",
    "KPI-GRS-002",
    "KPI-GRS-003",
)

#: Additive over stores and months, but blind to the condition split because the filter
#: never reaches the lead or appointment grain.
FUNNEL_ADDITIVE_KEYS = (
    "KPI-FUN-001",
    "SUP-SOLD-LEADS",
    "SUP-UNRESPONDED-LEADS",
    "SUP-DUPLICATE-LEADS",
    "SUP-ELIGIBLE-APPOINTMENTS",
    "SUP-SHOWN-APPOINTMENTS",
    "SUP-ADVANCE-CANCELLATIONS",
)

#: Semi-additive: they add up across stores and across the condition split, and they must
#: NOT add up across months, because each is the value at a single as-of date.
SEMI_ADDITIVE_KEYS = ("KPI-INV-001", "KPI-INV-002", "KPI-INV-005", "SUP-AGED-INVESTMENT")


# ---------------------------------------------------------------------------
# The simulation
# ---------------------------------------------------------------------------


class Simulation:
    """Runs every family of simulated check and assembles the artifact."""

    def __init__(self) -> None:
        """Parse the model, load the fact source, and build both implementations."""
        self.families: list[Family] = []
        self.model = dax.load_model()
        document = json.loads(FACT_SOURCE_PATH.read_text(encoding="utf-8"))
        self.fact_source: dict[str, list[dict[str, Any]]] = document["tables"]
        self.engine = dax.SimulationEngine(self.model, self.fact_source)
        self.reference = truth.SqlTruth(self.fact_source)
        self.not_simulated: dict[str, str] = {}
        self.evidence: dict[str, dict[str, Any]] = {}

    # -- plumbing --------------------------------------------------------

    def family(self, key: str, title: str) -> Family:
        """Start a family, register it, and return it."""
        created = Family(key, title)
        self.families.append(created)
        return created

    @property
    def findings(self) -> list[Finding]:
        """Every finding across every family."""
        return [finding for family in self.families for finding in family.findings]

    def measure_names(self) -> list[str]:
        """Every measure in the model, in a stable order."""
        return sorted(self.model.measures)

    def simulated_measure_names(self) -> list[str]:
        """The measures the subset can evaluate."""
        return [name for name in self.measure_names() if name not in self.not_simulated]

    def _context_for(self, context: truth.SimulatedContext) -> dax.FilterContext:
        """Translate a business context into the filters a report would apply."""
        filters: dict[tuple[str, str], Any] = {}
        if context.store_code is not None:
            filters[("vw_dealership", "dealership_code")] = context.store_code
        if context.month_label is not None:
            filters[("vw_calendar", "year_month_label")] = context.month_label
        if context.condition is not None:
            for table in truth.CONDITION_TABLES:
                filters[(table, "condition_group")] = context.condition
        return dax.context_from_filters(filters)

    def _evaluate(self, name: str, context: truth.SimulatedContext) -> Any:
        return self.engine.evaluate_measure(name, self._context_for(context))

    # -- 1. structure ----------------------------------------------------

    def check_structure(self) -> None:
        """Compose the structural checker rather than repeat it."""
        family = self.family("structure", "TMDL structure (composed from check_powerbi_model.py)")
        checker = _load_script("check_powerbi_model").Checker()
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            checker.run()
        family.record(
            not checker.findings,
            f"the structural checker reported {len(checker.findings)} finding(s); "
            "run scripts/check_powerbi_model.py for the detail",
        )
        family.notes.append(
            "Structure, relationships, hidden columns, format strings and the measure "
            "register are checked there and not repeated here."
        )

    # -- 2. fact-source conformance --------------------------------------

    def check_fact_source(self) -> None:
        """The fact source must describe the model that is actually committed."""
        family = self.family("fact-source", "Simulated fact source conforms to the model")
        for table, rows in sorted(self.fact_source.items()):
            declared = self.model.columns.get(table)
            if not family.record(declared is not None, f"{table} is not a table in the model"):
                continue
            assert declared is not None
            used = {column for row in rows for column in row}
            unknown = sorted(used - declared)
            family.record(
                not unknown,
                f"{table} declares column(s) the model does not have: {', '.join(unknown)}",
            )
        for table in self.model.data_tables():
            family.record(
                table in self.fact_source,
                f"{table} has no entry in the simulated fact source",
            )
        empty = sorted(table for table, rows in self.fact_source.items() if not rows)
        family.notes.append(
            "Tables present but deliberately empty, because no measure reads them: "
            + (", ".join(empty) if empty else "none")
        )

    # -- 3. expression coverage ------------------------------------------

    def check_expressions(self) -> None:
        """Every measure must parse into the simulated subset, or be named as unsimulated."""
        family = self.family("expressions", "Measure expressions parse into the simulated subset")
        for name in self.measure_names():
            measure = self.model.measures[name]
            if measure.parse_error is not None:
                self.not_simulated[name] = measure.parse_error
                family.record(False, f"{name} did not parse: {measure.parse_error}")
                continue
            try:
                self.engine.evaluate_measure(name)
            except dax.UnsupportedDaxError as error:
                self.not_simulated[name] = str(error)
                family.record(False, f"{name} uses DAX outside the subset: {error}")
            except dax.SimulationError as error:
                self.not_simulated[name] = str(error)
                family.record(False, f"{name} could not be evaluated: {error}")
            else:
                family.record(True, "")

    # -- 4. measure metadata ---------------------------------------------

    def check_metadata(self) -> None:
        """The annotations must describe the expression that is actually there."""
        family = self.family("metadata", "Measure metadata agrees with the expression")
        for name in self.simulated_measure_names():
            measure = self.model.measures[name]
            annotations = measure.annotations
            tables, columns = _referenced_columns(measure.ast)
            source = annotations.get("ARPI_SourceTable")
            family.record(
                source is not None,
                f"{name} declares no ARPI_SourceTable",
            )
            if source is not None and tables:
                family.record(
                    source in tables or tables <= {"vw_calendar"},
                    f"{name} is annotated ARPI_SourceTable = {source} but reads "
                    f"{', '.join(sorted(tables))}",
                )
            for table, column in sorted(columns):
                family.record(
                    column in self.model.columns.get(table, set()),
                    f"{name} reads '{table}'[{column}], which the model does not declare",
                )
            self._check_relationship_annotation(family, name, measure)
            self._check_date_basis_annotation(family, name, measure, source)

    def _check_relationship_annotation(self, family: Family, name: str, measure: Any) -> None:
        declared = measure.annotations.get("ARPI_UsesRelationship")
        used = _uses_relationship(measure.ast)
        if declared is None:
            family.record(
                not used,
                f"{name} calls USERELATIONSHIP but declares no ARPI_UsesRelationship",
            )
            return
        family.record(
            used,
            f"{name} declares ARPI_UsesRelationship = {declared} but never calls USERELATIONSHIP",
        )
        family.record(
            any(relationship.name == declared for relationship in self.model.relationships),
            f"{name} names relationship {declared}, which the model does not declare",
        )

    def _check_date_basis_annotation(
        self, family: Family, name: str, measure: Any, source: str | None
    ) -> None:
        basis = measure.annotations.get("ARPI_DateBasis")
        if basis is None or source is None:
            return
        family.record(
            basis in self.model.columns.get(source, set()),
            f"{name} declares ARPI_DateBasis = {basis}, which is not a column of {source}",
        )
        carries = [
            relationship
            for relationship in self.model.relationships
            if relationship.many_table == source and relationship.many_column == basis
        ]
        family.record(
            bool(carries),
            f"{name} declares a date basis ({source}.{basis}) that no relationship uses",
        )

    # -- 5. reconciliation to governed SQL truth -------------------------

    def check_reconciliation(self) -> None:
        """Evaluate both implementations everywhere and compare."""
        family = self.family(
            "reconciliation",
            "Simulated model results reconcile to the governed SQL definitions",
        )
        for context in truth.CONTEXTS:
            expected = self.reference.evaluate(context)
            recorded: dict[str, Any] = {}
            for name in self.simulated_measure_names():
                actual = self._evaluate(name, context)
                recorded[name] = _render(actual)
                if name not in expected:
                    family.record(False, f"{name} has no governed reference value")
                    continue
                agreed = _close(
                    _normalise(actual),
                    _normalise(expected[name]),
                    RELATIVE_TOLERANCE,
                    ABSOLUTE_TOLERANCE,
                )
                family.record(
                    agreed,
                    f"{context.context_id}: {name} — model {_render(actual)!r}, "
                    f"governed SQL {_render(expected[name])!r}",
                )
            self.evidence[context.context_id] = recorded
        family.notes.append(
            f"{len(truth.CONTEXTS)} contexts x {len(self.simulated_measure_names())} measures, "
            "each evaluated once by parsing the TMDL and once from the governed definition."
        )

    # -- 6. zero denominators --------------------------------------------

    def check_zero_denominators(self) -> None:
        """A ratio with nothing underneath it is BLANK, not zero."""
        family = self.family("zero-denominator", "Ratios return BLANK on an empty denominator")
        empty = next(context for context in truth.CONTEXTS if context.context_id == "empty-month")
        for name in sorted(RATIO_MEASURES & set(self.simulated_measure_names())):
            if self.model.measures[name].annotations.get("ARPI_SourceTable") in {
                "vw_data_quality_trend",
                "vw_reconciliation_status",
                "vw_pipeline_run_summary",
            }:
                continue
            value = self._evaluate(name, empty)
            family.record(
                dax.is_blank(value),
                f"{name} returned {_render(value)!r} in an empty context; a ratio must be BLANK",
            )
        store = next(context for context in truth.CONTEXTS if context.context_id == "store-GSA-003")
        family.record(
            dax.is_blank(self._evaluate("Appointment-Set Rate", store)),
            "Appointment-Set Rate is not BLANK in a store where nothing was contacted",
        )
        family.record(
            dax.is_blank(self._evaluate("Cost per Sale", store)),
            "Cost per Sale is not BLANK in a store with no attributed unit",
        )

    # -- 7. blank and null behaviour -------------------------------------

    def check_blank_behaviour(self) -> None:
        """The explicit-zero measures and the blank-returning measures both behave."""
        family = self.family("blank-behaviour", "Blank, null and explicit-zero behaviour")
        empty = next(context for context in truth.CONTEXTS if context.context_id == "empty-month")
        operational = {"Checks Passed", "Checks Failed", "Checks Skipped", "Rejected Rows"}
        for name in sorted(EXPLICIT_ZERO_MEASURES & set(self.simulated_measure_names())):
            if name in operational or name == "Critical Reconciliations Failed":
                continue
            value = self._evaluate(name, empty)
            family.record(
                _normalise(value) == 0,
                f"{name} returned {_render(value)!r} in an empty context; the `+ 0` idiom "
                "exists so that it returns zero",
            )
        for name in ("Front-End Gross", "Back-End Gross", "Total Gross"):
            value = self._evaluate(name, empty)
            family.record(
                dax.is_blank(value),
                f"{name} returned {_render(value)!r} in an empty context; a gross total with "
                "no sale behind it must be BLANK, not zero",
            )
        unfiltered = truth.CONTEXTS[0]
        family.record(
            _normalise(self._evaluate("Retail Units Sold", unfiltered))
            == len(
                [
                    row
                    for row in self.fact_source["vw_vehicle_sales"]
                    if row.get("retail_unit_count")
                ]
            ),
            "the wholesale row with null retail columns is being counted as a retail unit",
        )
        family.record(
            _normalise(self._evaluate("Days to Sale (Median)", unfiltered)) is not None,
            "Days to Sale (Median) is BLANK where the fact source has retail days",
        )

    # -- 8. aggregation behaviour ----------------------------------------

    def check_aggregation(self) -> None:
        """Additive measures add up; semi-additive measures deliberately do not."""
        family = self.family("aggregation", "Aggregation and semi-additive behaviour")
        stores = [
            context for context in truth.CONTEXTS if context.context_id.startswith("store-GSA-")
        ]
        unfiltered = truth.CONTEXTS[0]
        additive = ("Retail Units Sold", "New Units Sold", "Used Units Sold", "Leads Received")
        for name in additive:
            total = _normalise(self._evaluate(name, unfiltered)) or 0
            parts = sum(_normalise(self._evaluate(name, store)) or 0 for store in stores)
            family.record(
                _close(float(total), float(parts), RELATIVE_TOLERANCE, ABSOLUTE_TOLERANCE),
                f"{name} does not add up across the three stores: {total} vs {parts}",
            )
        months = [
            context for context in truth.CONTEXTS if context.context_id.startswith("month-2025-1")
        ]
        semi_additive = [
            name
            for name in self.simulated_measure_names()
            if self.model.measures[name].annotations.get("ARPI_TimeAggregation")
            == "SemiAdditiveLastDate"
        ]
        family.record(
            bool(semi_additive),
            "no measure declares ARPI_TimeAggregation = SemiAdditiveLastDate, so the "
            "semi-additive checks below would silently check nothing",
        )
        for name in semi_additive:
            total = _normalise(self._evaluate(name, unfiltered))
            if total is None:
                continue
            parts = sum(_normalise(self._evaluate(name, month)) or 0 for month in months)
            family.record(
                not _close(float(total), float(parts), RELATIVE_TOLERANCE, ABSOLUTE_TOLERANCE)
                or len(months) < 2,  # noqa: PLR2004 - one month cannot demonstrate anything
                f"{name} is declared semi-additive but its monthly values sum to the total "
                f"({parts}), which is what an additive measure would do",
            )
            last_month = months[-1]
            family.record(
                _close(
                    float(total),
                    float(_normalise(self._evaluate(name, last_month)) or 0),
                    RELATIVE_TOLERANCE,
                    ABSOLUTE_TOLERANCE,
                ),
                f"{name} is declared semi-additive but does not equal its last-date value",
            )

    # -- 9. filter-context assumptions -----------------------------------

    def check_filter_context(self) -> None:
        """The assumptions a report author makes about what a filter reaches."""
        family = self.family("filter-context", "Filter-context assumptions hold")
        unfiltered = truth.CONTEXTS[0]
        for context in truth.CONTEXTS:
            if context.condition is None or context.store_code or context.month_label:
                continue
            for name in sorted(CONDITION_BLIND_MEASURES & set(self.simulated_measure_names())):
                family.record(
                    _close(
                        _normalise(self._evaluate(name, context)),
                        _normalise(self._evaluate(name, unfiltered)),
                        RELATIVE_TOLERANCE,
                        ABSOLUTE_TOLERANCE,
                    ),
                    f"{name} moved under a {context.condition} filter, which no relationship "
                    "carries to its source table",
                )
        self._check_show_date_basis(family)

    def _check_show_date_basis(self, family: Family) -> None:
        """The one measure that re-points the calendar must actually re-point it.

        The fact source contains an appointment scheduled on 30 November that the customer
        arrived for on 1 December. That single row makes the two date bases falsifiable:

        * on the SCHEDULED-date basis it belongs to November, so `Shown Appointments` is 2
          in November and 0 in December;
        * on the SHOW-date basis it belongs to December, so `Show-to-Sale Conversion` is
          1/1 in November (the appointment that showed and sold) and 0/1 in December.

        Drop the `USERELATIONSHIP` and December becomes BLANK, because no appointment
        scheduled in December was ever shown. Nothing else in the model distinguishes the
        two bases, which is why this check is written out row by row.
        """
        by_id = {context.context_id: context for context in truth.CONTEXTS}
        november, december = by_id["month-2025-11"], by_id["month-2025-12"]
        expectations = (
            ("Shown Appointments", november, 2, "scheduled-date basis"),
            ("Shown Appointments", december, 0, "scheduled-date basis"),
            ("Show-to-Sale Conversion", november, 1.0, "show-date basis"),
            ("Show-to-Sale Conversion", december, 0.0, "show-date basis"),
        )
        for name, context, expected, basis in expectations:
            actual = _normalise(self._evaluate(name, context))
            family.record(
                _close(actual, float(expected), RELATIVE_TOLERANCE, ABSOLUTE_TOLERANCE),
                f"{name} on the {basis} is {actual!r} in {context.context_id}, expected "
                f"{expected!r}",
            )
        family.notes.append(
            "The appointment scheduled on 30 November and shown on 1 December is the only "
            "row that tells the two date bases apart."
        )

    # -- 10. governed SQL baseline algebra -------------------------------

    def check_baseline_algebra(self) -> None:
        """Check the measure graph's identities against real governed SQL numbers."""
        family = self.family(
            "baseline-algebra",
            "Governed SQL baseline satisfies the identities the measure graph implies",
        )
        document = json.loads(SQL_BASELINE_PATH.read_text(encoding="utf-8"))
        contexts = {entry["context_id"]: entry["measures"] for entry in document["contexts"]}
        family.notes.append(
            f"{len(contexts)} governed contexts read from "
            "powerbi/validation/sql_baseline.json. These are SQL results from the "
            "development-profile database; no DAX side exists for them until a real "
            "engine runs."
        )
        for context_id, measures in sorted(contexts.items()):
            self._check_identities(family, context_id, measures)
        self._check_partitions(family, contexts)

    def _check_identities(self, family: Family, context_id: str, measures: dict[str, Any]) -> None:
        for target, numerator, denominator in RATIO_IDENTITIES:
            if not {target, numerator, denominator} <= set(measures):
                continue
            expected = _baseline_divide(measures[numerator], measures[denominator])
            family.record(
                _close(
                    _normalise(measures[target]),
                    _normalise(expected),
                    BASELINE_RELATIVE_TOLERANCE,
                    BASELINE_ABSOLUTE_TOLERANCE,
                ),
                f"{context_id}: {target} is {measures[target]!r}, but {numerator} / "
                f"{denominator} is {expected!r}",
            )
        for target, parts in SUM_IDENTITIES:
            if not {target, *parts} <= set(measures):
                continue
            values = [measures[part] for part in parts]
            expected = (
                None
                if all(value is None for value in values)
                else sum(value for value in values if value is not None)
            )
            family.record(
                _close(
                    _normalise(measures[target]),
                    _normalise(expected),
                    BASELINE_RELATIVE_TOLERANCE,
                    BASELINE_ABSOLUTE_TOLERANCE,
                ),
                f"{context_id}: {target} is {measures[target]!r}, but "
                f"{' + '.join(parts)} is {expected!r}",
            )

    def _check_partitions(self, family: Family, contexts: dict[str, dict[str, Any]]) -> None:
        """Additivity, condition-blindness and semi-additivity, over governed numbers."""
        total = contexts.get("unfiltered", {})
        partitions: tuple[tuple[str, tuple[str, ...], Iterable[str]], ...] = (
            (
                "stores",
                STORE_CONTEXTS,
                FULLY_ADDITIVE_KEYS + FUNNEL_ADDITIVE_KEYS + SEMI_ADDITIVE_KEYS,
            ),
            ("months", MONTH_CONTEXTS, FULLY_ADDITIVE_KEYS + FUNNEL_ADDITIVE_KEYS),
            ("condition", CONDITION_CONTEXTS, FULLY_ADDITIVE_KEYS + SEMI_ADDITIVE_KEYS),
        )
        for label, context_ids, keys in partitions:
            if not set(context_ids) <= set(contexts):
                family.record(False, f"the baseline has no complete {label} partition")
                continue
            for key in keys:
                if key not in total:
                    continue
                parts = sum(contexts[cid].get(key) or 0 for cid in context_ids)
                family.record(
                    _close(
                        float(total[key] or 0),
                        float(parts),
                        BASELINE_RELATIVE_TOLERANCE,
                        BASELINE_ABSOLUTE_TOLERANCE,
                    ),
                    f"{key} does not add up across the {label} partition: "
                    f"{total[key]!r} vs {parts!r}",
                )
        for key in FUNNEL_ADDITIVE_KEYS:
            for context_id in CONDITION_CONTEXTS:
                if key not in total or key not in contexts.get(context_id, {}):
                    continue
                family.record(
                    _close(
                        float(total[key] or 0),
                        float(contexts[context_id][key] or 0),
                        BASELINE_RELATIVE_TOLERANCE,
                        BASELINE_ABSOLUTE_TOLERANCE,
                    ),
                    f"{key} moved in {context_id}; a condition filter does not reach the "
                    "lead or appointment grain",
                )
        for key in SEMI_ADDITIVE_KEYS:
            if key not in total or not set(MONTH_CONTEXTS) <= set(contexts):
                continue
            parts = sum(contexts[cid].get(key) or 0 for cid in MONTH_CONTEXTS)
            family.record(
                not _close(
                    float(total[key] or 0),
                    float(parts),
                    BASELINE_RELATIVE_TOLERANCE,
                    BASELINE_ABSOLUTE_TOLERANCE,
                ),
                f"{key} adds up across months ({parts!r} = {total[key]!r}), which a "
                "semi-additive as-of-date measure must not do",
            )
        self._check_governed_zero_denominator(family, contexts)

    def _check_governed_zero_denominator(
        self, family: Family, contexts: dict[str, dict[str, Any]]
    ) -> None:
        """The governed zero-denominator context distinguishes null from zero, or should."""
        zero = contexts.get("zero-denominator", {})
        for key in ("KPI-GRS-004", "KPI-GRS-005", "KPI-GRS-006", "KPI-FUN-004", "KPI-INV-006"):
            if key not in zero:
                continue
            family.record(
                zero[key] is None,
                f"{key} is {zero[key]!r} in the governed zero-denominator context; every "
                "ratio must be null there",
            )
        for key in ("KPI-SLS-001", "KPI-SLS-002", "KPI-SLS-003"):
            if key not in zero:
                continue
            family.record(
                zero[key] == 0,
                f"{key} is {zero[key]!r} in the governed zero-denominator context; a counted "
                "measure must be an explicit zero there",
            )

    # -- assembly --------------------------------------------------------

    def run(self) -> None:
        """Run every family, in order."""
        self.check_structure()
        self.check_fact_source()
        self.check_expressions()
        self.check_metadata()
        self.check_reconciliation()
        self.check_zero_denominators()
        self.check_blank_behaviour()
        self.check_aggregation()
        self.check_filter_context()
        self.check_baseline_algebra()

    def artifact(self) -> dict[str, Any]:
        """Build the JSON document this run stands behind."""
        gate = _load_script("check_real_engine_validation")
        states, model_hash = gate.evaluate()
        desktop_state = states["Power BI Desktop"][0]
        fabric_state = states["Microsoft Fabric"][0]
        gate_state = (
            "PASSED"
            if "PASSED" in {desktop_state, fabric_state}
            else desktop_state
            if desktop_state == fabric_state
            else "PENDING"
        )
        passed = not self.findings
        return {
            "schema": "arpi.simulated_semantic_model_results/1",
            "validation_kind": VALIDATION_KIND,
            "is_real_engine_result": False,
            "engine": "scripts/dax_simulation.py — a DAX-subset evaluator written in Python",
            "gate_2_real_engine_validation": gate_state,
            "desktop_validation": desktop_state,
            "fabric_validation": fabric_state,
            "engine_states_read_from": [
                "powerbi/validation/desktop_validation_results.json",
                "powerbi/validation/fabric_validation_results.json",
            ],
            "model_source_hash": model_hash,
            "overall_result": "passed" if passed else "failed",
            "measure_count": len(self.model.measures),
            "simulated_measure_count": len(self.simulated_measure_names()),
            "context_count": len(truth.CONTEXTS),
            "check_count": sum(family.checks for family in self.families),
            "not_simulated": dict(sorted(self.not_simulated.items())),
            "families": [
                {
                    "key": family.key,
                    "title": family.title,
                    "checks": family.checks,
                    "result": "passed" if not family.findings else "failed",
                    "findings": [finding.detail for finding in family.findings],
                    "notes": family.notes,
                }
                for family in self.families
            ],
            "contexts": [
                {
                    "context_id": context.context_id,
                    "description": context.description,
                    "store_code": context.store_code,
                    "month_label": context.month_label,
                    "condition": context.condition,
                    "measures": self.evidence.get(context.context_id, {}),
                }
                for context in truth.CONTEXTS
            ],
            "notes": (
                "SIMULATED SEMANTIC-MODEL VALIDATION. No Microsoft semantic-model engine "
                "was launched, contacted or consulted to produce this file, and nothing in "
                "it may be described as a Power BI, Power BI Desktop or Microsoft Fabric "
                "validation, or as evidence for Gate 2. Real-engine validation is an "
                "external manual dependency and remains PENDING on both accepted paths; "
                "see ADR-0008 for the paths and ADR-0014 for how the dependency is "
                "handled. The values recorded here come from "
                "powerbi/validation/simulated_fact_source.json, which is eleven rows of "
                "hand-built arithmetic, not dealership data and not the development "
                "database."
            ),
        }


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _walk(node: Any) -> Iterable[Any]:
    """Yield every node in an expression tree."""
    yield node
    if isinstance(node, dax.Call):
        children: tuple[Any, ...] = node.args
    elif isinstance(node, dax.Binary):
        children = (node.left, node.right)
    elif isinstance(node, dax.Unary):
        children = (node.operand,)
    elif isinstance(node, dax.VarBlock):
        children = (*(expression for _, expression in node.bindings), node.body)
    else:
        children = ()
    for child in children:
        yield from _walk(child)


def _referenced_columns(node: Any) -> tuple[set[str], set[tuple[str, str]]]:
    """Return the tables and `(table, column)` pairs an expression reads."""
    columns = {
        (child.table, child.column) for child in _walk(node) if isinstance(child, dax.ColumnRef)
    }
    return {table for table, _ in columns}, columns


def _uses_relationship(node: Any) -> bool:
    """Return whether an expression calls USERELATIONSHIP."""
    return any(
        isinstance(child, dax.Call) and child.name == "USERELATIONSHIP" for child in _walk(node)
    )


def _baseline_divide(numerator: Any, denominator: Any) -> Any:
    """DIVIDE over baseline values, where absent is spelled `null`."""
    if denominator in (None, 0) or numerator is None:
        return None
    return numerator / denominator


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def _report(simulation: Simulation, artifact: dict[str, Any], quiet: bool) -> None:
    """Print what happened, at the volume asked for."""
    if not quiet:
        print(VALIDATION_KIND)
        print("NOT a Power BI, Desktop or Fabric validation. NOT Gate 2 evidence.\n")
        for family in simulation.families:
            mark = "ok  " if not family.findings else "FAIL"
            print(f"  {mark}  {family.title} ({family.checks} checks)")
        print()
    for finding in simulation.findings:
        print(finding.render())
    if not quiet:
        print(
            f"\n{artifact['check_count']} checks, "
            f"{artifact['simulated_measure_count']}/{artifact['measure_count']} measures "
            f"simulated, {artifact['context_count']} contexts, "
            f"{len(simulation.findings)} finding(s)."
        )
        print(
            "Power BI real-engine validation remains externally pending; "
            "this simulation does not change that state."
        )


def main(argv: list[str] | None = None) -> int:
    """Run the simulation and write or verify the artifact."""
    parser = argparse.ArgumentParser(description=VALIDATION_KIND)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the committed artifact is not what this run produces",
    )
    parser.add_argument("--quiet", action="store_true", help="print findings only")
    arguments = parser.parse_args(argv)

    simulation = Simulation()
    simulation.run()
    artifact = simulation.artifact()
    rendered = json.dumps(artifact, indent=2, ensure_ascii=False) + "\n"

    if arguments.check:
        committed = RESULTS_PATH.read_text(encoding="utf-8") if RESULTS_PATH.is_file() else ""
        if committed != rendered:
            print(
                f"{RESULTS_PATH.relative_to(REPO_ROOT)} is not what this run produces. "
                "Re-run scripts/simulate_semantic_model.py and commit the result."
            )
            _report(simulation, artifact, arguments.quiet)
            return 1
    else:
        RESULTS_PATH.write_text(rendered, encoding="utf-8")

    _report(simulation, artifact, arguments.quiet)
    return 1 if simulation.findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
