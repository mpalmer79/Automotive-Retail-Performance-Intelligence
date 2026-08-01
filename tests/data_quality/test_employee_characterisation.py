"""Byte-level characterisation of the employee generator, written before it was split.

`src/arpi/generation/employee.py` mixed at least seven responsibilities in one 1,532-line
module: the column contract, reference distributions, record construction, Type 2 history,
derived calculations, latent performance parameters and eight validators. Splitting it is
worthwhile and is also the easiest kind of change to get subtly wrong -- a reordered
random draw, a different sort, a dict that iterates differently -- and none of those show
up as an exception. They show up as different data.

So this module pins the OUTPUT rather than the structure. Every assertion here holds
before and after the split, and the digests below were recorded from the pre-split module.
If a refactor changes one, it changed the data, and no amount of "the tests still pass"
elsewhere makes that acceptable: `DATA_GENERATION.md` promises byte-reproducible output
from a fixed seed.

Deliberately NOT asserted here: internal structure, module layout, private helpers. Those
are what the refactor is free to change.
"""

from __future__ import annotations

import pytest

from arpi.config import ArpiConfig
from arpi.generation.base import GeneratedDataset
from arpi.generation.employee import (
    DIM_EMPLOYEE_COLUMNS,
    EMPLOYEE_CHECK_IDS,
    build_employee_assignments,
    employee_headcount,
    employee_performance_profiles,
    generate_employee_dataset,
    validate_employee_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest

pytestmark = pytest.mark.data_quality


@pytest.fixture
def dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """Function-scoped, matching `test_config`.

    Generation is deterministic and fast, so regenerating per test costs little and keeps
    the fixture free of shared state -- which is the failure mode this module exists to
    detect.
    """
    return generate_employee_dataset(test_config)


# --------------------------------------------------------------------------------------
# The bytes
# --------------------------------------------------------------------------------------


def test_the_generated_csv_digest_is_unchanged(dataset: GeneratedDataset) -> None:
    """The single strongest assertion available: the exact bytes written to disk.

    A change to the random-draw order, the sort order, a distribution, a rounding rule or
    a column's dtype all move this digest. Nothing else in the suite covers all of those
    at once.
    """
    digest = content_digest(dataframe_to_csv_bytes(dataset.frame))
    assert digest == ("b9b1d3862396437009e67f9ed7a262891405681f5ad4d3d2612b490077adb3c9"), digest


def test_generation_is_reproducible_within_a_process(test_config: ArpiConfig) -> None:
    """Two calls with one configuration produce identical bytes.

    Guards the failure mode a split makes easy: module-level state that survives the first
    call and perturbs the second.
    """
    first = dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
    assert first == second


def test_the_column_contract_is_exact(dataset: GeneratedDataset) -> None:
    """Order matters: the CSV is written in this order and the raw table expects it."""
    assert tuple(dataset.frame.columns) == DIM_EMPLOYEE_COLUMNS


def test_the_dtypes_are_unchanged(dataset: GeneratedDataset) -> None:
    """`datetime64[s]` on every date column is what lets the 9999-12-31 sentinel exist."""
    dtypes = {column: str(dtype) for column, dtype in dataset.frame.dtypes.items()}
    assert dtypes["effective_date"] == "datetime64[s]"
    assert dtypes["expiration_date"] == "datetime64[s]"
    assert dtypes["hire_date"] == "datetime64[s]"
    assert dtypes["termination_date"] == "datetime64[s]"
    assert dtypes["employee_key"] == "int32"
    assert dtypes["is_current"] == "bool"


def test_the_row_order_is_unchanged(dataset: GeneratedDataset) -> None:
    """A different sort is a different file even when every row survives.

    Two properties, both load-bearing: the surrogate key ascends, and an employee's Type 2
    versions appear together in effective-date order. The second is what the merge relies
    on to expire the previous version against the right successor.
    """
    keys = dataset.frame["employee_key"].tolist()
    assert keys == sorted(keys), "rows must stay ordered by surrogate key"

    for employee_id, versions in dataset.frame.groupby("employee_id", sort=False):
        effective = versions["effective_date"].tolist()
        assert effective == sorted(effective), (
            f"{employee_id} has versions out of effective-date order"
        )
        positions = versions.index.tolist()
        assert positions == list(range(positions[0], positions[0] + len(positions))), (
            f"{employee_id}'s versions are not contiguous in the frame"
        )


# --------------------------------------------------------------------------------------
# The derived values
# --------------------------------------------------------------------------------------


def test_the_headcount_is_unchanged(test_config: ArpiConfig) -> None:
    assert employee_headcount(test_config) == 12


def test_the_row_and_employee_counts_are_unchanged(dataset: GeneratedDataset) -> None:
    """Rows exceed employees because promotions and moves create Type 2 versions."""
    assert len(dataset.frame) == 15
    assert dataset.frame["employee_id"].nunique() == 12


def test_the_attribute_hashes_are_unchanged(dataset: GeneratedDataset) -> None:
    """One digest over every row's hash, so a single changed hash fails.

    The attribute hash decides whether a Type 2 version is written at all, so a change
    here is a change to the dimension's history, not merely to a column.
    """
    joined = "|".join(dataset.frame["attribute_hash"].tolist()).encode()
    digest = content_digest(joined)
    assert digest == ("d50c3be3c456e8b0bbffd4aead0b70e9113b54dda3c00855639310630940b1f4"), digest


def test_the_assignment_plan_is_unchanged(test_config: ArpiConfig) -> None:
    """The roster before it becomes rows: identity, store, role and dates.

    Pinned separately from the frame because the split moves history construction into
    its own module, and a fault there would otherwise only be visible through the CSV.
    """
    assignments = build_employee_assignments(test_config)
    rendered = "|".join(
        f"{a.employee_id}:{a.dealership_id}:{a.job_role}:{a.hire_date.isoformat()}"
        f":{a.termination_date.isoformat() if a.termination_date else '-'}"
        f":{a.change_date.isoformat() if a.change_date else '-'}"
        for a in assignments
    ).encode()
    digest = content_digest(rendered)
    assert digest == ("8fb26c940c1188a6f801abfa9a479be0ecec2329de10bdfbf96ac39e321704d7"), digest


def test_the_performance_profiles_are_unchanged(test_config: ArpiConfig) -> None:
    """Latent parameters feed the sale generator, so a change here moves the facts too.

    They are never columns of `dim_employee` and never reach the warehouse; that is
    asserted by DQ-EMP-005. This pins their values.
    """
    profiles = employee_performance_profiles(test_config)
    rendered = "|".join(
        f"{key}:{profile.volume_index:.10f}:{profile.closing_rate_index:.10f}"
        f":{profile.gross_retention_index:.10f}:{profile.crm_discipline_index:.10f}"
        for key, profile in sorted(profiles.items())
    ).encode()
    digest = content_digest(rendered)
    assert digest == ("3452dc4a40b4f5fc8db48bfc49e89461f495c8e31e9b6c89520afb24bfcc02b5"), digest


# --------------------------------------------------------------------------------------
# The validation contract
# --------------------------------------------------------------------------------------


def test_every_check_still_runs_and_in_the_same_order(
    dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """Result order is part of the contract: it is the order written to the audit table."""
    report = validate_employee_dataset(dataset, test_config)
    assert tuple(result.check_id for result in report.results) == EMPLOYEE_CHECK_IDS


def test_every_check_passes_on_generated_data(
    dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_employee_dataset(dataset, test_config)
    failures = [result.check_id for result in report.results if result.is_failure]
    assert failures == []


def test_the_check_metadata_is_unchanged(
    dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """Identifier, name, category, severity and target object per check.

    These reach `audit.validation_result` and are compared against the SQL layer's own
    check registry, so a rename is a cross-layer break rather than a cosmetic one.
    """
    report = validate_employee_dataset(dataset, test_config)
    rendered = "|".join(
        f"{r.check_id}:{r.check_name}:{r.check_category}:{r.severity.value}:{r.target_object}"
        for r in report.results
    ).encode()
    digest = content_digest(rendered)
    assert digest == ("fc26a527c40dc004a087a479da824f8e435bab63619fdb358a72f16a8b790187"), digest


def test_a_tampered_frame_still_fails_the_same_check(
    dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """One end-to-end failure path, so the split cannot quietly stop detecting one."""
    frame = dataset.frame.copy()
    frame.loc[frame.index[0], "tenure_band"] = "not-a-band"
    tampered = GeneratedDataset(
        entity_name=dataset.entity_name,
        frame=frame,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )
    report = validate_employee_dataset(tampered, test_config)
    failed = {result.check_id for result in report.results if result.is_failure}
    # DQ-EMP-009 is the enumeration check; an out-of-domain tenure band is its business.
    assert failed == {"DQ-EMP-009"}, (
        "the tampering must fail exactly the check that owns it -- a split that made a "
        "different check fire, or several, would have changed the validation contract"
    )


# --------------------------------------------------------------------------------------
# The public surface
# --------------------------------------------------------------------------------------


#: Every name imported from `arpi.generation.employee` anywhere in the repository, found
#: by parsing the imports rather than by memory. Splitting the module must keep all of
#: them importable from the same path.
PUBLIC_SURFACE = (
    "ALLOWED_DEPARTMENTS",
    "ALLOWED_JOB_ROLES",
    "ALLOWED_TENURE_BANDS",
    "DEPARTMENT_SALES",
    "DIM_EMPLOYEE_COLUMNS",
    "DIM_EMPLOYEE_REQUIRED_COLUMNS",
    "EMPLOYEE_CHECK_IDS",
    "EMPLOYEE_HASH_COLUMNS",
    "EMPLOYEE_HEADCOUNT_BOUNDS",
    "ENTITY_DIM_EMPLOYEE",
    "EmployeeAssignment",
    "EmployeeGenerator",
    "EmployeePerformanceProfile",
    "JOB_ROLE_BDC_MANAGER",
    "JOB_ROLE_BDC_REPRESENTATIVE",
    "JOB_ROLE_DESK_MANAGER",
    "JOB_ROLE_FINANCE_MANAGER",
    "JOB_ROLE_GENERAL_MANAGER",
    "JOB_ROLE_SALESPERSON",
    "JOB_ROLE_SALES_MANAGER",
    "JOB_ROLE_SERVICE_ADVISOR",
    "LATENT_PARAMETER_COLUMN_TOKENS",
    "MANAGER_JOB_ROLES",
    "ROLE_DEPARTMENT",
    "TENURE_BAND_1_TO_3",
    "TENURE_BAND_3_TO_5",
    "TENURE_BAND_5_TO_10",
    "TENURE_BAND_OVER_10",
    "TENURE_BAND_UNDER_1",
    "allocate_store_headcount",
    "build_employee_assignments",
    "department_for_role",
    "employee_attribute_hash",
    "employee_headcount",
    "employee_performance_profiles",
    "expand_role_plan",
    "generate_employee_dataset",
    "is_manager_for_role",
    "predecessor_assignment",
    "select_by_score",
    "tenure_band_for",
    "validate_employee_dataset",
)


@pytest.mark.parametrize("name", PUBLIC_SURFACE)
def test_the_public_name_is_still_importable(name: str) -> None:
    """Compatibility, asserted name by name so a failure says which one broke."""
    import arpi.generation.employee as module

    assert hasattr(module, name), (
        f"arpi.generation.employee.{name} disappeared. It is imported elsewhere in the "
        "repository, so the split must re-export it from the same path."
    )


def test_the_module_has_no_circular_import() -> None:
    """Importing the package fresh, with nothing else loaded, must succeed."""
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import arpi.generation.employee as m; print(m.ENTITY_DIM_EMPLOYEE)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "dim_employee"


def test_the_checks_are_registered_exactly_once() -> None:
    """A split package must not register its checks twice by importing itself.

    The registry rejects a duplicate identifier, so a double registration is an import
    error rather than silent duplication -- but only if something imports the package.
    """
    from arpi.validation.registry import CHECK_REGISTRY

    registered = [
        definition.check_id
        for definition in CHECK_REGISTRY.values()
        if definition.check_id.startswith("DQ-EMP-")
    ]
    assert sorted(registered) == sorted(EMPLOYEE_CHECK_IDS)


def test_the_contract_module_declares_no_heavyweight_dependency() -> None:
    """The column contract is data and its module imports nothing to say so.

    Asserted by parsing the module's own imports rather than by watching `sys.modules`:
    importing it at runtime still pulls pandas in transitively, because
    `arpi.generation.__init__` eagerly imports every generator. That is the parent
    package's behaviour, and changing it would be a behaviour change rather than a split.
    What this pins is that the contract itself stays dependency-free.
    """
    import ast
    from pathlib import Path

    module = Path("src/arpi/generation/employee/contract.py")
    tree = ast.parse(module.read_text(encoding="utf-8"))
    imported = {
        node.module.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    } | {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert imported <= {"__future__", "datetime", "typing"}, (
        f"the column contract imports {sorted(imported)}; it should need nothing beyond "
        "the standard library's type and date names"
    )
    assert isinstance(DIM_EMPLOYEE_COLUMNS, tuple)
    assert all(isinstance(column, str) for column in DIM_EMPLOYEE_COLUMNS)
