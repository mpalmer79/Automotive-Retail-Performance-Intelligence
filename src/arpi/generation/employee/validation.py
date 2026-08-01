"""The employee dimension's data-quality suite, ``DQ-EMP-001`` through ``DQ-EMP-009``.

Registered in the canonical registry at import time, so the register is complete whenever
this package is importable.

The contract these follow is in :mod:`arpi.validation`: invalid input data returns a
failed :class:`~arpi.validation.results.CheckResult`, and a programming error raises.
``DQ-EMP-003`` is the worked example -- it compares the year-9999 sentinel rather than
doing pandas nanosecond arithmetic against it, because that arithmetic raised on one
pandas version and silently widened on another.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REPRODUCIBILITY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SENTINEL_EXPIRATION_DATE,
)
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.employee.calculations import employee_attribute_hash
from arpi.generation.employee.contract import (
    ALLOWED_DEPARTMENTS,
    ALLOWED_JOB_ROLES,
    ALLOWED_TENURE_BANDS,
    DIM_EMPLOYEE_COLUMNS,
    ENTITY_DIM_EMPLOYEE,
    LATENT_PARAMETER_COLUMN_TOKENS,
)
from arpi.generation.employee.distributions import EMPLOYEE_HEADCOUNT_BOUNDS
from arpi.validation.checks import check_column_schema, check_values_in_allowed_set
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_EMPLOYEE_UNIQUE_VERSION: Final = "DQ-EMP-001"
CHECK_EMPLOYEE_ONE_CURRENT_ROW: Final = "DQ-EMP-002"
CHECK_EMPLOYEE_NON_OVERLAPPING_VERSIONS: Final = "DQ-EMP-003"
CHECK_EMPLOYEE_SCHEMA_MATCHES: Final = "DQ-EMP-004"
CHECK_EMPLOYEE_NO_PROHIBITED_PII: Final = "DQ-EMP-005"
CHECK_EMPLOYEE_DATE_ORDERING: Final = "DQ-EMP-006"
CHECK_EMPLOYEE_HEADCOUNT_BOUNDS: Final = "DQ-EMP-007"
CHECK_EMPLOYEE_ATTRIBUTE_HASH_STABLE: Final = "DQ-EMP-008"
CHECK_EMPLOYEE_ENUMERATIONS: Final = "DQ-EMP-009"

#: Every check identifier this module emits, in identifier order.
EMPLOYEE_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_EMPLOYEE_UNIQUE_VERSION,
    CHECK_EMPLOYEE_ONE_CURRENT_ROW,
    CHECK_EMPLOYEE_NON_OVERLAPPING_VERSIONS,
    CHECK_EMPLOYEE_SCHEMA_MATCHES,
    CHECK_EMPLOYEE_NO_PROHIBITED_PII,
    CHECK_EMPLOYEE_DATE_ORDERING,
    CHECK_EMPLOYEE_HEADCOUNT_BOUNDS,
    CHECK_EMPLOYEE_ATTRIBUTE_HASH_STABLE,
    CHECK_EMPLOYEE_ENUMERATIONS,
)

_WAREHOUSE_DIM_EMPLOYEE: Final = "warehouse.dim_employee"

# Registered at import time so the canonical register in
# :mod:`arpi.validation.registry` is complete whenever this generator is importable.
# ``layer`` is ``python`` because only a pandas implementation exists today; the agent who
# adds the SQL equivalent changes that one field rather than re-declaring the check.
register_checks(
    (
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_UNIQUE_VERSION,
            check_name="dim_employee (employee_id, effective_date) is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "Two versions of one person starting on the same day would make the SCD2 "
                "range join ambiguous and silently double-count that person's facts."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_ONE_CURRENT_ROW,
            check_name="dim_employee has exactly one current row per employee",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "The partial unique index on employee_id WHERE is_current is what makes "
                "'current staff' a single index-friendly predicate. Two current rows "
                "would double every headcount, and zero would make the person vanish."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_NON_OVERLAPPING_VERSIONS,
            check_name="dim_employee version ranges are contiguous and non-overlapping",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "A gap loses the facts that fall in it; an overlap attributes them twice. "
                "The previous version's expiration_date must be exactly one day before "
                "the next version's effective_date."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_SCHEMA_MATCHES,
            check_name="dim_employee matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "so a reordered column would land in the wrong target field."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_NO_PROHIBITED_PII,
            check_name="dim_employee declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "Names, contact details, compensation, pay plans, commission and "
                "protected characteristics must never exist as employee columns, and "
                "neither may a latent performance parameter. The check inspects the "
                "schema, so an empty prohibited column still fails the run."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_DATE_ORDERING,
            check_name="dim_employee date ordering is valid",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "A hire before the store opened, a termination before the hire, or a "
                "version starting before the hire are each impossible, and each would "
                "produce a negative tenure somewhere downstream."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_HEADCOUNT_BOUNDS,
            check_name="dim_employee headcount is within the configured bounds",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "Per-employee volume is only plausible if the roster is the size the "
                "scale profile claims. A drifting headcount silently rescales every "
                "units-per-salesperson figure."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_ATTRIBUTE_HASH_STABLE,
            check_name="dim_employee attribute_hash matches a recomputation",
            category=CHECK_CATEGORY_REPRODUCIBILITY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "attribute_hash is the SCD2 change-detection mechanism and the basis of "
                "load idempotency. A hash that does not reproduce from its own row means "
                "reruns would either insert spurious versions or miss real ones."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
        CheckDefinition(
            check_id=CHECK_EMPLOYEE_ENUMERATIONS,
            check_name="dim_employee enumerated columns are inside their domains",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_EMPLOYEE,
            description=(
                "department, job_role and tenure_band drive every slicer in the employee "
                "reporting. An out-of-domain value appears as a new, unexplained category."
            ),
            applies_to=(_WAREHOUSE_DIM_EMPLOYEE,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_employee_dataset(dataset: GeneratedDataset, config: ArpiConfig) -> ValidationReport:
    """Run ``DQ-EMP-001`` through ``DQ-EMP-009`` against the employee dimension.

    The suite lives here rather than in :mod:`arpi.validation.datasets` only because that
    module is owned elsewhere in the current Phase 1 split. Nothing about it is
    entity-coupled beyond the identifiers, so moving it is a copy, not a rewrite.

    Args:
        dataset: The generated ``dim_employee`` dataset.
        config: Resolved configuration supplying the scale mode.

    Returns:
        A report containing nine results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            _check_unique_version(frame),
            _check_one_current_row(frame),
            _check_non_overlapping_versions(frame),
            check_column_schema(
                frame,
                DIM_EMPLOYEE_COLUMNS,
                check_id=CHECK_EMPLOYEE_SCHEMA_MATCHES,
                check_name="dim_employee matches its declared column contract",
                target_object=ENTITY_DIM_EMPLOYEE,
            ),
            _check_no_prohibited_columns(frame),
            _check_date_ordering(frame),
            _check_headcount_bounds(frame, config),
            _check_attribute_hash_stable(frame),
            _check_enumerations(frame),
        )
    )


def _check_enumerations(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-009`` -- ``department``, ``job_role`` and ``tenure_band`` are in domain."""
    columns = (
        ("department", ALLOWED_DEPARTMENTS),
        ("job_role", ALLOWED_JOB_ROLES),
        ("tenure_band", ALLOWED_TENURE_BANDS),
    )
    failures = [
        result.message
        for result in (
            check_values_in_allowed_set(
                frame,
                column,
                allowed,
                check_id=CHECK_EMPLOYEE_ENUMERATIONS,
                check_name="dim_employee enumerated columns are inside their domains",
                target_object=ENTITY_DIM_EMPLOYEE,
            )
            for column, allowed in columns
        )
        if result.is_failure
    ]
    base = _base_result(
        CHECK_EMPLOYEE_ENUMERATIONS,
        "dim_employee enumerated columns are inside their domains",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    if not failures:
        return base
    return base.failed(
        " ".join(str(message) for message in failures),
        observed_value=float(len(failures)),
        failed_record_count=len(failures),
    )


def _base_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_DIM_EMPLOYEE,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_unique_version(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-001`` -- ``(employee_id, effective_date)`` is unique."""
    base = _base_result(
        CHECK_EMPLOYEE_UNIQUE_VERSION,
        "dim_employee (employee_id, effective_date) is unique",
        CHECK_CATEGORY_UNIQUENESS,
    )
    duplicates = int(frame.duplicated(subset=["employee_id", "effective_date"]).sum())
    if duplicates == 0:
        return base
    return base.failed(
        f"{duplicates} duplicate (employee_id, effective_date) pair(s) found: a person "
        "cannot have two versions starting on the same day.",
        observed_value=float(duplicates),
        failed_record_count=duplicates,
    )


def _check_one_current_row(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-002`` -- exactly one current row per employee, carrying the sentinel."""
    base = _base_result(
        CHECK_EMPLOYEE_ONE_CURRENT_ROW,
        "dim_employee has exactly one current row per employee",
        CHECK_CATEGORY_UNIQUENESS,
    )
    current_counts = frame.groupby("employee_id")["is_current"].sum()
    wrong_count = int((current_counts != 1).sum())
    current = frame[frame["is_current"]]
    sentinel = pd.Timestamp(SENTINEL_EXPIRATION_DATE)
    wrong_sentinel = int((current["expiration_date"] != sentinel).sum())
    offending = wrong_count + wrong_sentinel
    if offending == 0:
        return base
    return base.failed(
        f"{wrong_count} employee(s) do not have exactly one is_current row and "
        f"{wrong_sentinel} current row(s) do not carry the "
        f"{SENTINEL_EXPIRATION_DATE.isoformat()} sentinel.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


#: How many offending employee identifiers a failed continuity check names before it
#: summarises the rest. Enough to start debugging, short enough to stay readable in a log
#: line and in ``audit.validation_result.failure_detail``.
_MAX_REPORTED_EMPLOYEES: Final = 5


def _as_date(value: Any) -> date | None:
    """Convert one date-like cell to a Python :class:`datetime.date`.

    SCD Type 2 continuity has to do day arithmetic, and the open-ended sentinel is
    ``9999-12-31``. ``pandas.Timedelta`` is nanosecond-based and the nanosecond range ends
    at 2262-04-11, so ``pandas.Timestamp("9999-12-31") + pandas.Timedelta(days=1)`` is
    unrepresentable. Whether it raises ``OutOfBoundsDatetime`` or silently widens depends
    on the installed pandas version, which is not a property a gating validator may
    depend on.

    Python's ``date`` covers years 1 through 9999 and ``datetime.timedelta`` arithmetic on
    it is exact, so the whole check is done in Python types. This function is the single
    boundary where that conversion happens.

    Args:
        value: A ``pandas.Timestamp``, ``datetime``, ``date``, ``NaT`` or ``None``.

    Returns:
        The corresponding :class:`datetime.date`, or ``None`` when the cell holds no
        usable date. ``None`` is a *data* problem for the caller to report as a failed
        check, not an error to raise.
    """
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _check_non_overlapping_versions(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-003`` -- version ranges per employee are contiguous and non-overlapping."""
    base = _base_result(
        CHECK_EMPLOYEE_NON_OVERLAPPING_VERSIONS,
        "dim_employee version ranges are contiguous and non-overlapping",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    ordered = frame.sort_values(["employee_id", "effective_date"])
    one_day = timedelta(days=1)
    offending = 0
    offending_employees: list[str] = []
    for employee_id, versions in ordered.groupby("employee_id", sort=True):
        expirations = [_as_date(value) for value in versions["expiration_date"].tolist()]
        effectives = [_as_date(value) for value in versions["effective_date"].tolist()]
        broken = 0
        for index in range(1, len(effectives)):
            previous_expiration = expirations[index - 1]
            following_effective = effectives[index]
            if previous_expiration is None or following_effective is None:
                broken += 1
                continue
            # An open-ended row is by definition the last version a person has. One
            # followed by another version is invalid history, and the sentinel is the
            # signal -- so it is compared, never used in arithmetic. `SENTINEL + one_day`
            # is unrepresentable in pandas' nanosecond resolution, and evaluating it
            # raised OutOfBoundsDatetime rather than reporting the invalid data.
            if previous_expiration == SENTINEL_EXPIRATION_DATE:
                broken += 1
                continue
            if previous_expiration + one_day != following_effective:
                broken += 1
        if broken:
            offending += broken
            offending_employees.append(str(employee_id))
    if offending == 0:
        return base
    named = ", ".join(offending_employees[:_MAX_REPORTED_EMPLOYEES])
    if len(offending_employees) > _MAX_REPORTED_EMPLOYEES:
        named += f", and {len(offending_employees) - _MAX_REPORTED_EMPLOYEES} more"
    return base.failed(
        f"{offending} adjacent version pair(s) are not contiguous: the previous version's "
        "expiration_date must be exactly one day before the next version's effective_date, "
        f"and only the last version may carry the {SENTINEL_EXPIRATION_DATE.isoformat()} "
        f"sentinel. Affected employee_id(s): {named}.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_no_prohibited_columns(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-005`` -- no prohibited personal-data or latent-parameter column exists."""
    shared = check_no_prohibited_pii_columns(
        frame,
        check_id=CHECK_EMPLOYEE_NO_PROHIBITED_PII,
        check_name="dim_employee declares no prohibited personal-data column",
        target_object=ENTITY_DIM_EMPLOYEE,
    )
    if shared.is_failure:
        return shared
    offending = sorted(
        str(column)
        for column in frame.columns
        if any(token in str(column).strip().lower() for token in LATENT_PARAMETER_COLUMN_TOKENS)
    )
    base = _base_result(
        CHECK_EMPLOYEE_NO_PROHIBITED_PII,
        "dim_employee declares no prohibited personal-data column",
        CHECK_CATEGORY_PRIVACY,
    )
    if not offending:
        return base
    return base.failed(
        f"dim_employee declares prohibited column(s): {', '.join(offending)}. A latent "
        "performance parameter has leaked into the warehouse: those are generation inputs "
        "and a scorecard built on one would be circular.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_date_ordering(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-006`` -- hire, termination and version dates are correctly ordered."""
    base = _base_result(
        CHECK_EMPLOYEE_DATE_ORDERING,
        "dim_employee date ordering is valid",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    opened = {store.dealership_id: pd.Timestamp(store.opened_date) for store in STORE_DEFINITIONS}
    store_opened = frame["dealership_id"].map(opened)
    violations = {
        "hire_date before the store opened": frame["hire_date"] < store_opened,
        "termination_date before hire_date": frame["termination_date"].notna()
        & (frame["termination_date"] < frame["hire_date"]),
        "effective_date before hire_date": frame["effective_date"] < frame["hire_date"],
        "expiration_date before effective_date": frame["expiration_date"] < frame["effective_date"],
        "is_active disagrees with termination_date": frame["is_active"]
        != frame["termination_date"].isna(),
    }
    counts = {reason: int(mask.sum()) for reason, mask in violations.items() if int(mask.sum())}
    total = sum(counts.values())
    if total == 0:
        return base
    detail = ", ".join(f"{reason}={count}" for reason, count in sorted(counts.items()))
    return base.failed(
        f"{total} employee row(s) violate the date-ordering rules: {detail}.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_headcount_bounds(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """``DQ-EMP-007`` -- distinct headcount falls inside the configured bounds."""
    scale_mode = config.generation.scale_mode
    minimum, maximum = EMPLOYEE_HEADCOUNT_BOUNDS[scale_mode]
    headcount = int(frame["employee_id"].nunique())
    result = replace(
        _base_result(
            CHECK_EMPLOYEE_HEADCOUNT_BOUNDS,
            "dim_employee headcount is within the configured bounds",
            CHECK_CATEGORY_BUSINESS_RULE,
        ),
        observed_value=float(headcount),
        expected_value=(minimum + maximum) / 2,
    )
    if minimum <= headcount <= maximum:
        return result
    return result.failed(
        f"dim_employee holds {headcount} distinct employee(s) under the {scale_mode!r} "
        f"scale mode, outside the configured band [{minimum}, {maximum}]."
    )


def _check_attribute_hash_stable(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-008`` -- every ``attribute_hash`` equals a recomputation of its own row."""
    base = _base_result(
        CHECK_EMPLOYEE_ATTRIBUTE_HASH_STABLE,
        "dim_employee attribute_hash matches a recomputation",
        CHECK_CATEGORY_REPRODUCIBILITY,
    )
    offending = 0
    for record in frame.to_dict(orient="records"):
        termination = record["termination_date"]
        recomputed = employee_attribute_hash(
            str(record["dealership_id"]),
            str(record["department"]),
            str(record["job_role"]),
            pd.Timestamp(record["hire_date"]).date(),
            None if pd.isna(termination) else pd.Timestamp(termination).date(),
            is_active=bool(record["is_active"]),
            is_manager=bool(record["is_manager"]),
        )
        if recomputed != record["attribute_hash"]:
            offending += 1
    if offending == 0:
        return base
    return base.failed(
        f"{offending} row(s) carry an attribute_hash that does not match a recomputation "
        "of their own tracked attributes.",
        observed_value=float(offending),
        failed_record_count=offending,
    )
