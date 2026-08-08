"""The operating-plan generator: determinism, exactness, scope rules, and no leakage.

THE TEST THIS MODULE EXISTS FOR
-------------------------------
:func:`test_the_generator_never_reads_a_realized_sale` is the one that matters. A plan
computed from the result it is supposed to measure is not a plan: if
``arpi.generation.sales_target`` read ``sale_event`` and emitted ``actual * 1.05``, every
attainment figure on the console would be a restatement of the same number, and the page
would be presenting a tautology as a management measurement. The rule is enforced over the
module's actual import graph rather than promised in a docstring.

Everything else here is the ordinary contract: the same seed reproduces the same plan, no
Python float touches a target, the scope vocabulary is honoured, and the two department
gross plans partition the store's total-gross plan exactly.
"""

from __future__ import annotations

import ast
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, cast

import pytest

from arpi.config import ArpiConfig
from arpi.constants import (
    SOURCE_SYSTEM,
    TARGET_DEPARTMENTS,
    TARGET_METRIC_KPI_IDS,
    TARGET_SCOPE_DEPARTMENT,
    TARGET_SCOPE_METRICS,
    TARGET_SCOPE_STORE,
    TARGET_SCOPE_TYPES,
)
from arpi.exceptions import GenerationError
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.sales_target import (
    ENTITY_SALES_TARGET,
    SALES_TARGET_COLUMNS,
    SALES_TARGET_GRAIN_COLUMNS,
    STORE_PLANNING_BASELINE,
    STRETCH_TARGET_MULTIPLIER,
    TARGET_MONTH_SEASONALITY,
    SalesTargetGenerator,
    generate_sales_target_dataset,
    validate_sales_target_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes

REPO_ROOT: Final = Path(__file__).resolve().parents[2]

#: Modules that carry, produce or read a REALIZED sale. The plan generator may import
#: none of them, directly or transitively.
REALIZED_SALE_MODULES: Final[frozenset[str]] = frozenset(
    {
        "arpi.generation.sale",
        "arpi.generation.acquisition",
        "arpi.generation.inventory_snapshot",
        "arpi.generation.lead",
        "arpi.generation.appointment",
        "arpi.pipeline",
        "arpi.ingestion.loader",
        "arpi.ingestion.database",
    }
)


def _config(**overrides: object) -> ArpiConfig:
    """Build a development-profile configuration with optional overrides."""
    return ArpiConfig.model_validate(
        {
            "profile": "development",
            "random_seed": 20250701,
            "reporting": {"start_date": date(2025, 7, 1), "end_date": date(2025, 12, 31)},
            "generation": {"store_count": 3, "scale_mode": "development"},
            **overrides,
        }
    )


# =======================================================================================
# No outcome leakage
# =======================================================================================


def _imported_modules(module_path: Path) -> set[str]:
    """Every module name the file imports, from its AST rather than from a regex."""
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            names.add(node.module)
    return names


def test_the_generator_never_reads_a_realized_sale() -> None:
    """The plan may not be computed from the result it measures.

    Enforced over the module's own import graph, one level deep from the generator and
    one level deep again from everything it imports inside ``arpi``. A transitive import
    would be just as fatal as a direct one: the point is that no realized figure can
    reach the planning arithmetic, not that no line of it says ``import sale``.
    """
    generator = REPO_ROOT / "src" / "arpi" / "generation" / "sales_target.py"
    direct = _imported_modules(generator)

    offending = sorted(direct & REALIZED_SALE_MODULES)
    assert offending == [], (
        f"arpi.generation.sales_target imports {offending}, which carry realized sales. "
        "A target computed from the outcome it measures is a tautology, not a plan."
    )

    transitive: set[str] = set()
    for name in sorted(direct):
        if not name.startswith("arpi."):
            continue
        candidate = REPO_ROOT / "src" / Path(name.replace(".", "/") + ".py")
        if not candidate.exists():
            candidate = REPO_ROOT / "src" / Path(name.replace(".", "/")) / "__init__.py"
        if candidate.exists():
            transitive |= _imported_modules(candidate)

    offending_transitive = sorted(transitive & REALIZED_SALE_MODULES)
    assert offending_transitive == [], (
        f"arpi.generation.sales_target transitively imports {offending_transitive}, which "
        "carry realized sales."
    )


def test_the_plan_is_unchanged_when_the_sale_generator_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second, behavioural proof of the same rule.

    The import guard above catches a static dependency. This catches a lazy one: if the
    generator ever reached for realized sales at call time -- a deferred import, a
    registry lookup, a helper that reads ``data/raw`` -- making the sale module
    unimportable would change the output or raise. It does neither.
    """
    import sys

    config = _config()
    before = generate_sales_target_dataset(config).frame

    monkeypatch.setitem(sys.modules, "arpi.generation.sale", None)
    after = generate_sales_target_dataset(config).frame

    assert list(after["target_value"]) == list(before["target_value"])
    assert list(after["sales_target_id"]) == list(before["sales_target_id"])


def test_the_planning_inputs_are_exogenous() -> None:
    """Every input to a target is a calendar fact or a declared planning assumption.

    Stated as an assertion rather than as prose: the baselines are per store, the
    seasonality is per month of the year, and neither is derived from anything the sale
    generator produced.
    """
    assert set(STORE_PLANNING_BASELINE) == {store.dealership_id for store in STORE_DEFINITIONS}
    assert set(TARGET_MONTH_SEASONALITY) == set(range(1, 13))
    for baseline in STORE_PLANNING_BASELINE.values():
        assert baseline.units_per_selling_day > 0
        assert isinstance(baseline.planned_total_gross_per_unit, Decimal)
        assert isinstance(baseline.planned_front_gross_share, Decimal)
        assert Decimal(0) < baseline.planned_front_gross_share < Decimal(1)


def test_the_three_stores_are_planned_differently() -> None:
    """A plan that treated an independent used operation as a small franchise is a defect.

    The independent pre-owned centre sells fewer units at a wider front margin and has no
    captive finance relationship, so all three of its planning inputs differ from both
    franchises'. Identical baselines would make every store's attainment move together.
    """
    per_day = {store: b.units_per_selling_day for store, b in STORE_PLANNING_BASELINE.items()}
    per_unit = {
        store: b.planned_total_gross_per_unit for store, b in STORE_PLANNING_BASELINE.items()
    }
    front_share = {
        store: b.planned_front_gross_share for store, b in STORE_PLANNING_BASELINE.items()
    }
    assert len(set(per_day.values())) == len(per_day)
    assert len(set(per_unit.values())) == len(per_unit)
    assert len(set(front_share.values())) == len(front_share)


# =======================================================================================
# Determinism
# =======================================================================================


def test_the_same_seed_reproduces_the_same_plan_byte_for_byte() -> None:
    config = _config()
    first = dataframe_to_csv_bytes(generate_sales_target_dataset(config).frame)
    second = dataframe_to_csv_bytes(generate_sales_target_dataset(config).frame)
    assert first == second


def test_a_different_seed_produces_a_different_plan() -> None:
    """Different, but the same shape: the variation is seeded, not the structure."""
    baseline = generate_sales_target_dataset(_config()).frame
    other = generate_sales_target_dataset(_config(random_seed=99)).frame
    assert list(baseline["sales_target_id"]) == list(other["sales_target_id"])
    assert list(baseline["target_value"]) != list(other["target_value"])


def test_the_row_order_is_stable_and_the_identifier_follows_it() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    keys = list(
        zip(
            frame["dealership_id"],
            frame["target_month_date_key"],
            frame["target_scope_type"],
            frame["target_scope_id"],
            frame["kpi_id"],
            strict=True,
        )
    )
    assert keys == sorted(keys)
    assert list(frame["sales_target_id"]) == [
        f"TGT-{ordinal:08d}" for ordinal in range(1, len(frame) + 1)
    ]


# =======================================================================================
# The column contract and exactness
# =======================================================================================


def test_the_frame_matches_the_declared_column_contract() -> None:
    dataset = generate_sales_target_dataset(_config())
    assert dataset.entity_name == ENTITY_SALES_TARGET
    assert tuple(dataset.frame.columns) == SALES_TARGET_COLUMNS


def test_no_python_float_reaches_a_target() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    for column in ("target_value", "stretch_target_value"):
        for value in frame[column]:
            assert isinstance(value, Decimal), (
                f"{column} carries {value!r} ({type(value).__name__}); a binary float in a "
                "target makes its attainment denominator irreproducible"
            )
            exponent = value.as_tuple().exponent
            assert isinstance(exponent, int) and -exponent <= 2


def test_a_unit_target_is_a_whole_number_carried_at_cent_scale() -> None:
    """`57.00`, not `57` and not `57.4`. A store does not commit to two-fifths of a car."""
    frame = generate_sales_target_dataset(_config()).frame
    units = frame[frame["kpi_id"] == "KPI-SLS-001"]
    assert not units.empty
    for cell in units["target_value"]:
        value = Decimal(str(cell))
        assert value == value.to_integral_value()
        assert str(value).endswith(".00")


def test_every_stretch_target_is_at_least_the_committed_target() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    for target, stretch in zip(frame["target_value"], frame["stretch_target_value"], strict=True):
        assert stretch >= target
    assert STRETCH_TARGET_MULTIPLIER > 1


# =======================================================================================
# The scope model
# =======================================================================================


def test_the_declared_grain_is_unique() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    assert not frame.duplicated(subset=list(SALES_TARGET_GRAIN_COLUMNS)).any()


def test_every_scope_type_and_metric_is_in_its_governed_vocabulary() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    assert set(frame["target_scope_type"]) <= set(TARGET_SCOPE_TYPES)
    assert set(frame["kpi_id"]) <= set(TARGET_METRIC_KPI_IDS)
    for scope_type, kpi_id in zip(frame["target_scope_type"], frame["kpi_id"], strict=True):
        assert kpi_id in TARGET_SCOPE_METRICS[scope_type]


def test_no_target_row_names_a_kpi_tgt_identifier() -> None:
    """The fact stores the metric BEING targeted, never the measure computed from it."""
    frame = generate_sales_target_dataset(_config()).frame
    assert not any(str(value).startswith("KPI-TGT-") for value in frame["kpi_id"])


def test_a_store_scope_row_names_its_own_store_and_carries_no_refinement() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    store_rows = frame[frame["target_scope_type"] == TARGET_SCOPE_STORE]
    assert not store_rows.empty
    assert list(store_rows["target_scope_id"]) == list(store_rows["dealership_id"])
    assert store_rows["department_name"].isna().all()
    assert store_rows["employee_id"].isna().all()


def test_a_department_scope_row_names_its_department_and_no_employee() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    rows = frame[frame["target_scope_type"] == TARGET_SCOPE_DEPARTMENT]
    assert not rows.empty
    assert set(rows["department_name"]) == set(TARGET_DEPARTMENTS)
    assert list(rows["target_scope_id"]) == list(rows["department_name"])
    assert rows["employee_id"].isna().all()


def test_dash5_generates_no_employee_scope_row() -> None:
    """Recorded as an assertion, not only as a decision.

    Employee scope is part of the permanent vocabulary and is physically supported by the
    fact. It is deliberately unpopulated: no registered stakeholder question requires an
    employee-scope target, ``DASH.11`` owns the employee-performance surface, and Gate 4
    forbids adding data no question requires. If a later increment populates it, this
    test is where the decision is revisited.
    """
    frame = generate_sales_target_dataset(_config()).frame
    assert "Employee" not in set(frame["target_scope_type"])
    assert frame["employee_id"].isna().all()


def test_the_department_plans_partition_the_store_gross_plan_exactly() -> None:
    """Front + back = total, on the plan as on the sale fact. To the cent, per store-month."""
    frame = generate_sales_target_dataset(_config()).frame
    store_gross: dict[tuple[str, str], Decimal] = {}
    department_gross: dict[tuple[str, str], Decimal] = {}
    for row in frame.itertuples(index=False):
        key = (str(row.dealership_id), str(row.target_month_date_key))
        value = Decimal(str(row.target_value))
        if row.target_scope_type == TARGET_SCOPE_STORE and row.kpi_id == "KPI-GRS-003":
            store_gross[key] = value
        elif row.target_scope_type == TARGET_SCOPE_DEPARTMENT:
            department_gross[key] = department_gross.get(key, Decimal(0)) + value

    assert store_gross
    assert set(store_gross) == set(department_gross)
    for key, total in store_gross.items():
        assert department_gross[key] == total, key


def test_a_department_target_never_names_the_store_metric() -> None:
    """A department may not plan total gross: doing so would overlap the store row."""
    frame = generate_sales_target_dataset(_config()).frame
    rows = frame[frame["target_scope_type"] == TARGET_SCOPE_DEPARTMENT]
    assert "KPI-GRS-003" not in set(rows["kpi_id"])
    assert "KPI-SLS-001" not in set(rows["kpi_id"])


# =======================================================================================
# Coverage, lineage and the window
# =======================================================================================


def test_every_active_store_month_carries_both_store_plans() -> None:
    config = _config()
    frame = generate_sales_target_dataset(config).frame
    stores = {store.dealership_id for store in STORE_DEFINITIONS if store.is_active}
    months = {202507_01, 202508_01, 202509_01, 202510_01, 202511_01, 202512_01}
    for store in stores:
        for month in months:
            selected = frame[
                (frame["dealership_id"] == store)
                & (frame["target_month_date_key"] == month)
                & (frame["target_scope_type"] == TARGET_SCOPE_STORE)
            ]
            assert set(selected["kpi_id"]) == {"KPI-SLS-001", "KPI-GRS-003"}, (store, month)
    assert len(frame) == len(stores) * len(months) * 4


def test_every_target_month_is_a_first_of_month_key_inside_the_window() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    assert (frame["target_month_date_key"] % 100 == 1).all()
    assert frame["target_month_date_key"].min() == 20250701
    assert frame["target_month_date_key"].max() == 20251201


def test_the_plan_differs_between_stores_and_between_months() -> None:
    """Identical targets everywhere would make the console unable to show two states."""
    frame = generate_sales_target_dataset(_config()).frame
    units = frame[
        (frame["kpi_id"] == "KPI-SLS-001") & (frame["target_scope_type"] == TARGET_SCOPE_STORE)
    ]
    by_store: dict[str, set[Decimal]] = {str(store): set() for store in set(units["dealership_id"])}
    for row in units.itertuples(index=False):
        by_store[str(row.dealership_id)].add(Decimal(str(row.target_value)))
    # Every store's six months are not one repeated number.
    for store, values in by_store.items():
        assert len(values) > 1, store
    # And no two stores carry the same six-month plan.
    plans = {store: tuple(sorted(values)) for store, values in by_store.items()}
    assert len(set(plans.values())) == len(plans)


def test_every_row_carries_the_synthetic_lineage_marker() -> None:
    frame = generate_sales_target_dataset(_config()).frame
    assert set(frame["source_system"]) == {SOURCE_SYSTEM}


def test_a_store_with_no_planning_baseline_is_refused() -> None:
    """Silence would be indistinguishable from a store that missed its plan."""
    generator = SalesTargetGenerator()
    config = _config()
    original = dict(STORE_PLANNING_BASELINE)
    try:
        STORE_PLANNING_BASELINE.pop("GSA-002")
        with pytest.raises(GenerationError, match="GSA-002"):
            generator.build_frame(config)
    finally:
        STORE_PLANNING_BASELINE.clear()
        STORE_PLANNING_BASELINE.update(original)


# =======================================================================================
# The validation suite
# =======================================================================================


def test_every_dq_tgt_check_passes_on_the_generated_plan() -> None:
    config = _config()
    report = validate_sales_target_dataset(generate_sales_target_dataset(config), config)
    identifiers = [result.check_id for result in report.results]
    assert identifiers == sorted(identifiers)
    assert len(identifiers) == 14
    assert all(identifier.startswith("DQ-TGT-") for identifier in identifiers)
    failures = [result.check_id for result in report.results if result.status != "passed"]
    assert failures == []


def test_the_grain_check_fails_on_a_planted_duplicate() -> None:
    """A check that cannot fail is decoration."""
    import pandas as pd

    config = _config()
    dataset = generate_sales_target_dataset(config)
    duplicated = pd.concat([dataset.frame, dataset.frame.head(1)], ignore_index=True)
    dataset = type(dataset)(
        entity_name=dataset.entity_name,
        frame=duplicated,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )
    report = validate_sales_target_dataset(dataset, config)
    failed = {result.check_id for result in report.results if result.status != "passed"}
    assert "DQ-TGT-001" in failed


def test_the_department_split_check_fails_when_one_target_moves_by_a_cent() -> None:
    config = _config()
    dataset = generate_sales_target_dataset(config)
    frame = dataset.frame.copy()
    index = frame.index[frame["department_name"] == "Sales"][0]
    moved = Decimal(str(frame.at[index, "target_value"])) + Decimal("0.01")
    # `object` dtype holds a Decimal; the annotation on `.at` does not know that, and a
    # cast is honest about where the type information actually lives.
    frame.at[index, "target_value"] = cast(Any, moved)
    dataset = type(dataset)(
        entity_name=dataset.entity_name,
        frame=frame,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )
    report = validate_sales_target_dataset(dataset, config)
    failed = {result.check_id for result in report.results if result.status != "passed"}
    assert "DQ-TGT-012" in failed


def test_the_precision_check_fails_on_a_float() -> None:
    config = _config()
    dataset = generate_sales_target_dataset(config)
    frame = dataset.frame.copy()
    frame.at[frame.index[0], "target_value"] = 41.0
    dataset = type(dataset)(
        entity_name=dataset.entity_name,
        frame=frame,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )
    report = validate_sales_target_dataset(dataset, config)
    failed = {result.check_id for result in report.results if result.status != "passed"}
    assert "DQ-TGT-011" in failed
