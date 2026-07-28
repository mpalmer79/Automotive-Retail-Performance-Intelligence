"""Generator for ``warehouse.dim_employee`` (Slowly Changing Dimension Type 2).

Privacy posture
---------------
This is one of the two most privacy-sensitive entities in ARPI, and its design is
subtractive: the generator has **no code path that can produce a personal name, a
personal email address, a phone number, a street address, a compensation figure, a pay
plan, a commission, or any protected characteristic**. A synthetic ``employee_id`` plus
role, store and banded tenure answers every KPI the project declares, so nothing more is
generated. :func:`validate_employee_dataset` inspects the *schema*, so an accidental
prohibited column fails the run even when it holds no values.

Latent performance parameters are generation inputs, never facts
----------------------------------------------------------------
[ARCHITECTURE.md §15.3] requires employees to differ in volume, closing rate and gross
retention, otherwise the sales fact is implausibly uniform. Those per-person parameters
live in :func:`employee_performance_profiles` and are consumed by the sale generator.
They are deliberately **not** columns of ``dim_employee``, are never written to the
committed sample data, and must never reach a reporting view.

The reason is analytical honesty rather than squeamishness. A scorecard built from a
latent "true skill" parameter is circular: it would report back the number the generator
used to fabricate the outcome, and it would look like a validated measurement of a person.
[PRIVACY_AND_ETHICS.md §5] requires every employee metric to be presented with contextual
metrics -- lead volume received, lead-source mix, tenure, inventory availability -- because
raw output is a measure of routing and opportunity as much as of skill. Publishing the
latent parameter would quietly defeat that rule.

SCD Type 2 semantics
--------------------
The grain is one row per employee **role-assignment version**. A person who is promoted or
moves store produces two contiguous versions: the earlier one is expired the day before the
change, and the later one carries the open-ended ``9999-12-31`` sentinel.

Employment status is carried by ``is_active`` and ``termination_date``, **not** by expiring
the version. A terminated employee therefore still has exactly one ``is_current`` row, so
historical facts keep resolving and the partial unique index on ``employee_id WHERE
is_current`` holds for everyone.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REPRODUCIBILITY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.utilities.hashing import hash_attributes
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import check_column_schema, check_values_in_allowed_set
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    import random
    from collections.abc import Sequence

    from arpi.config import ArpiConfig

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespaces
# ---------------------------------------------------------------------------------------
#: Warehouse entity produced by this module.
ENTITY_DIM_EMPLOYEE: Final = "dim_employee"

#: Seeding namespace for the roster itself. One namespace per entity, so adding an entity
#: never perturbs another entity's digest.
EMPLOYEE_NAMESPACE: Final = "dim_employee"

#: Separate seeding namespace for the latent performance parameters, so that tuning them
#: cannot shift a single value inside ``dim_employee``.
EMPLOYEE_PERFORMANCE_NAMESPACE: Final = "dim_employee_performance"

# ---------------------------------------------------------------------------------------
# warehouse.dim_employee column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_EMPLOYEE_COLUMNS: Final[tuple[str, ...]] = (
    "employee_key",
    "employee_id",
    "dealership_id",
    "department",
    "job_role",
    "hire_date",
    "termination_date",
    "is_active",
    "is_manager",
    "tenure_band",
    "effective_date",
    "expiration_date",
    "is_current",
    "attribute_hash",
    "source_system",
)

# ``expiration_date`` carries the 9999-12-31 sentinel, which overflows ``datetime64[ns]``
# (max 2262-04-11). Second precision is used for every date column so they share one dtype
# and the sentinel round-trips exactly, matching the ``dim_dealership`` decision.
DIM_EMPLOYEE_DTYPES: Final[dict[str, str]] = {
    "employee_key": "int32",
    "employee_id": "string",
    "dealership_id": "string",
    "department": "string",
    "job_role": "string",
    "hire_date": "datetime64[s]",
    "termination_date": "datetime64[s]",
    "is_active": "bool",
    "is_manager": "bool",
    "tenure_band": "string",
    "effective_date": "datetime64[s]",
    "expiration_date": "datetime64[s]",
    "is_current": "bool",
    "attribute_hash": "string",
    "source_system": "string",
}

#: Columns that must never be NULL (``termination_date`` is the only nullable column).
DIM_EMPLOYEE_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in DIM_EMPLOYEE_COLUMNS if column != "termination_date"
)

#: SCD Type 2 tracked attributes: ``dealership_id`` through ``is_manager``, in contract
#: order. Changing this tuple changes every hash and must be mirrored in SQL.
EMPLOYEE_HASH_COLUMNS: Final[tuple[str, ...]] = (
    "dealership_id",
    "department",
    "job_role",
    "hire_date",
    "termination_date",
    "is_active",
    "is_manager",
)

# ---------------------------------------------------------------------------------------
# Controlled vocabularies
# ---------------------------------------------------------------------------------------
DEPARTMENT_SALES: Final = "Sales"
DEPARTMENT_FINANCE: Final = "Finance"
DEPARTMENT_BDC: Final = "BDC"
DEPARTMENT_MANAGEMENT: Final = "Management"
DEPARTMENT_SERVICE: Final = "Service"

ALLOWED_DEPARTMENTS: Final[tuple[str, ...]] = (
    DEPARTMENT_SALES,
    DEPARTMENT_FINANCE,
    DEPARTMENT_BDC,
    DEPARTMENT_MANAGEMENT,
    DEPARTMENT_SERVICE,
)

JOB_ROLE_SALESPERSON: Final = "Salesperson"
JOB_ROLE_SALES_MANAGER: Final = "Sales Manager"
JOB_ROLE_DESK_MANAGER: Final = "Desk Manager"
JOB_ROLE_FINANCE_MANAGER: Final = "Finance Manager"
JOB_ROLE_BDC_REPRESENTATIVE: Final = "BDC Representative"
JOB_ROLE_BDC_MANAGER: Final = "BDC Manager"
JOB_ROLE_GENERAL_MANAGER: Final = "General Manager"
JOB_ROLE_SERVICE_ADVISOR: Final = "Service Advisor"

ALLOWED_JOB_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SERVICE_ADVISOR,
)

#: ``department`` is a pure function of ``job_role``: it is never drawn independently, so a
#: BDC representative can never land in the Finance department.
ROLE_DEPARTMENT: Final[dict[str, str]] = {
    JOB_ROLE_SALESPERSON: DEPARTMENT_SALES,
    JOB_ROLE_SALES_MANAGER: DEPARTMENT_MANAGEMENT,
    JOB_ROLE_DESK_MANAGER: DEPARTMENT_MANAGEMENT,
    JOB_ROLE_GENERAL_MANAGER: DEPARTMENT_MANAGEMENT,
    JOB_ROLE_FINANCE_MANAGER: DEPARTMENT_FINANCE,
    JOB_ROLE_BDC_REPRESENTATIVE: DEPARTMENT_BDC,
    JOB_ROLE_BDC_MANAGER: DEPARTMENT_BDC,
    JOB_ROLE_SERVICE_ADVISOR: DEPARTMENT_SERVICE,
}

#: ``is_manager`` is likewise derived from ``job_role`` and never drawn independently.
MANAGER_JOB_ROLES: Final[frozenset[str]] = frozenset(
    {
        JOB_ROLE_SALES_MANAGER,
        JOB_ROLE_DESK_MANAGER,
        JOB_ROLE_FINANCE_MANAGER,
        JOB_ROLE_BDC_MANAGER,
        JOB_ROLE_GENERAL_MANAGER,
    }
)

TENURE_BAND_UNDER_1: Final = "Under 1 Year"
TENURE_BAND_1_TO_3: Final = "1-3 Years"
TENURE_BAND_3_TO_5: Final = "3-5 Years"
TENURE_BAND_5_TO_10: Final = "5-10 Years"
TENURE_BAND_OVER_10: Final = "Over 10 Years"

ALLOWED_TENURE_BANDS: Final[tuple[str, ...]] = (
    TENURE_BAND_UNDER_1,
    TENURE_BAND_1_TO_3,
    TENURE_BAND_3_TO_5,
    TENURE_BAND_5_TO_10,
    TENURE_BAND_OVER_10,
)

#: Upper bound (exclusive, in years) for each band except the open-ended final one.
_TENURE_BAND_UPPER_BOUNDS: Final[tuple[tuple[float, str], ...]] = (
    (1.0, TENURE_BAND_UNDER_1),
    (3.0, TENURE_BAND_1_TO_3),
    (5.0, TENURE_BAND_3_TO_5),
    (10.0, TENURE_BAND_5_TO_10),
)

#: Mean days in a year, used to convert a day count into whole years of tenure.
DAYS_PER_YEAR: Final = 365.25

# ---------------------------------------------------------------------------------------
# Roster shape
# ---------------------------------------------------------------------------------------
#: Total headcount (distinct people, not versions) per scale mode. Contract section 11.
EMPLOYEE_HEADCOUNT_BY_SCALE: Final[dict[str, int]] = {
    "test": 12,
    "development": 30,
    "portfolio": 45,
}

#: Inclusive headcount bounds asserted by ``DQ-EMP-007``. The portfolio band is the 35..50
#: target from the Phase 1 backlog; the two generated-in-CI profiles are exact.
EMPLOYEE_HEADCOUNT_BOUNDS: Final[dict[str, tuple[int, int]]] = {
    "test": (12, 12),
    "development": (30, 30),
    "portfolio": (35, 50),
}

#: Share of total headcount by store. ``GSA-003`` is the smallest roster: it is the
#: independent used operation, with no franchise service drive to staff.
STORE_HEADCOUNT_SHARE: Final[dict[str, float]] = {
    "GSA-001": 0.40,
    "GSA-002": 0.36,
    "GSA-003": 0.24,
}

# Staffing plans, filled in order until the store's allocated headcount is reached. The
# ordering encodes hiring priority: a store staffs its management desk and its first
# salespeople before it adds a second finance manager.
_CHEVROLET_PLAN: Final[tuple[str, ...]] = (
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_SERVICE_ADVISOR,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_SALESPERSON,
)
_SUBARU_PLAN: Final[tuple[str, ...]] = (
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_SALESPERSON,
)
# The independent used store is sales-weighted: no franchise service drive, a leaner
# management desk, and a markedly higher salesperson share than either franchise store.
_INDEPENDENT_PLAN: Final[tuple[str, ...]] = (
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_SALESPERSON,
)

STORE_ROLE_PLANS: Final[dict[str, tuple[str, ...]]] = {
    "GSA-001": _CHEVROLET_PLAN,
    "GSA-002": _SUBARU_PLAN,
    "GSA-003": _INDEPENDENT_PLAN,
}

#: Repeated when a store's allocated headcount exceeds its explicit plan, so the generator
#: degrades predictably instead of failing if a future profile raises the scale.
STORE_ROLE_TAILS: Final[dict[str, tuple[str, ...]]] = {
    "GSA-001": (
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_BDC_REPRESENTATIVE,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SERVICE_ADVISOR,
        JOB_ROLE_SALESPERSON,
    ),
    "GSA-002": (
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_BDC_REPRESENTATIVE,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SERVICE_ADVISOR,
        JOB_ROLE_SALESPERSON,
    ),
    "GSA-003": (
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_SALESPERSON,
        JOB_ROLE_BDC_REPRESENTATIVE,
    ),
}

#: Tenure draw per role, in years, as ``(low, high, mode)`` for a triangular distribution.
#: Managers are longer-tenured than the sales floor, which is the dominant real pattern.
ROLE_TENURE_YEARS: Final[dict[str, tuple[float, float, float]]] = {
    JOB_ROLE_GENERAL_MANAGER: (7.0, 16.0, 11.0),
    JOB_ROLE_SALES_MANAGER: (4.0, 13.0, 7.5),
    JOB_ROLE_DESK_MANAGER: (3.5, 11.0, 6.0),
    JOB_ROLE_FINANCE_MANAGER: (3.0, 12.0, 6.0),
    JOB_ROLE_BDC_MANAGER: (2.5, 9.0, 4.5),
    JOB_ROLE_SERVICE_ADVISOR: (1.0, 10.0, 3.5),
    JOB_ROLE_BDC_REPRESENTATIVE: (0.4, 5.5, 1.4),
    JOB_ROLE_SALESPERSON: (0.3, 12.0, 2.0),
}

#: Relative churn propensity used to choose who leaves. The sales floor turns over far
#: faster than the management desk; the general manager almost never does.
ROLE_CHURN_WEIGHT: Final[dict[str, float]] = {
    JOB_ROLE_SALESPERSON: 1.00,
    JOB_ROLE_BDC_REPRESENTATIVE: 0.85,
    JOB_ROLE_SERVICE_ADVISOR: 0.45,
    JOB_ROLE_FINANCE_MANAGER: 0.25,
    JOB_ROLE_DESK_MANAGER: 0.20,
    JOB_ROLE_BDC_MANAGER: 0.20,
    JOB_ROLE_SALES_MANAGER: 0.15,
    JOB_ROLE_GENERAL_MANAGER: 0.05,
}

#: Predecessor role for a promotion. Roles absent from this map move store instead.
PROMOTION_PREDECESSOR: Final[dict[str, str]] = {
    JOB_ROLE_SALES_MANAGER: JOB_ROLE_SALESPERSON,
    JOB_ROLE_DESK_MANAGER: JOB_ROLE_SALESPERSON,
    JOB_ROLE_FINANCE_MANAGER: JOB_ROLE_SALESPERSON,
    JOB_ROLE_BDC_MANAGER: JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_GENERAL_MANAGER: JOB_ROLE_SALES_MANAGER,
}

#: Share of the roster that leaves during the reporting window, with a floor of one person
#: so the terminated-employee path is always exercised.
TERMINATION_SHARE: Final = 0.10

#: Share of the roster with a genuine role or store change. The floor of three is a
#: contract requirement: the SCD2 expire-and-insert path must be exercised by real data.
ROLE_CHANGE_SHARE: Final = 0.12
MINIMUM_ROLE_CHANGES: Final = 3

#: Minimum tenure before a person is eligible for a promotion or transfer.
MINIMUM_CHANGE_TENURE_DAYS: Final = 730

#: Minimum days employed before a termination may be generated.
MINIMUM_EMPLOYMENT_DAYS: Final = 90

#: Fraction-of-tenure window in which a role or store change lands.
_CHANGE_POINT_RANGE: Final[tuple[float, float]] = (0.35, 0.75)

# ---------------------------------------------------------------------------------------
# Privacy and leakage tripwires
# ---------------------------------------------------------------------------------------
#: Personal-data column names are caught by :mod:`arpi.validation.privacy`, which is the
#: single generalised authority for that vocabulary. This set adds the one rule that is
#: specific to this entity and is **not** a personal-data rule: the latent performance
#: parameters in :func:`employee_performance_profiles` are generation inputs, and a column
#: named after one of them would mean a fabrication parameter had leaked into the
#: warehouse. Substring matching is safe: no legitimate employee column contains these.
LATENT_PARAMETER_COLUMN_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "closing_rate",
        "crm_discipline",
        "gross_retention",
        "latent",
        "performance_index",
        "skill_index",
        "volume_index",
    }
)

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
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class EmployeeAssignment:
    """One synthetic person: their current assignment and their single prior one.

    Attributes:
        employee_id: Synthetic identifier, ``EMP-#####``.
        dealership_id: Store held in the current version.
        job_role: Role held in the current version.
        hire_date: Date of hire; identical across every version of this person.
        termination_date: Date of departure, or ``None`` while still employed.
        change_date: Date the current version took effect, or ``None`` when this person
            has only ever held one assignment.
        prior_dealership_id: Store held before ``change_date``, or ``None``.
        prior_job_role: Role held before ``change_date``, or ``None``.
    """

    employee_id: str
    dealership_id: str
    job_role: str
    hire_date: date
    termination_date: date | None
    change_date: date | None = None
    prior_dealership_id: str | None = None
    prior_job_role: str | None = None


@dataclass(frozen=True, slots=True)
class EmployeePerformanceProfile:
    """Latent per-employee generation parameters consumed by the sale generator.

    **These are inputs to fabrication, not measurements of a person.** They must never be
    written to ``dim_employee``, to the committed sample data, or to a reporting view; see
    the module docstring for why. Every index is a multiplier centred near ``1.0``.

    Attributes:
        employee_id: The person these parameters belong to.
        dealership_id: Store held in the current version, for convenience when routing.
        job_role: Role held in the current version.
        is_manager: Whether the current role carries management responsibility.
        is_active: Whether the person is still employed at the end of the window.
        volume_index: Relative expected deal volume.
        closing_rate_index: Relative lead-to-sale conversion.
        gross_retention_index: Relative front-end gross retention.
        crm_discipline_index: Relative CRM logging and response discipline.
    """

    employee_id: str
    dealership_id: str
    job_role: str
    is_manager: bool
    is_active: bool
    volume_index: float
    closing_rate_index: float
    gross_retention_index: float
    crm_discipline_index: float


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def department_for_role(job_role: str) -> str:
    """Return the department a job role belongs to.

    Args:
        job_role: One of :data:`ALLOWED_JOB_ROLES`.

    Returns:
        The owning department.

    Raises:
        GenerationError: If ``job_role`` is outside the declared enumeration.
    """
    try:
        return ROLE_DEPARTMENT[job_role]
    except KeyError as error:
        raise GenerationError(
            f"job_role {job_role!r} is outside the declared enumeration "
            f"({', '.join(ALLOWED_JOB_ROLES)}).",
            entity=ENTITY_DIM_EMPLOYEE,
            job_role=job_role,
        ) from error


def is_manager_for_role(job_role: str) -> bool:
    """Return whether a job role carries management responsibility.

    ``is_manager`` is always derived here and never drawn at random, so it cannot
    contradict ``job_role``.

    Args:
        job_role: One of :data:`ALLOWED_JOB_ROLES`.

    Returns:
        ``True`` for the five management roles.
    """
    return job_role in MANAGER_JOB_ROLES


def tenure_band_for(hire_date: date, as_of: date) -> str:
    """Band a hire date into one of the five declared tenure bands.

    ``tenure_band`` is always derived here and never drawn at random. It is measured
    against the **end of the reporting window** rather than against wall-clock time, so
    the generated data does not change meaning as the calendar advances.

    Args:
        hire_date: Date the person was hired.
        as_of: Reference date, normally ``reporting.end_date``.

    Returns:
        One of :data:`ALLOWED_TENURE_BANDS`.
    """
    years = max((as_of - hire_date).days, 0) / DAYS_PER_YEAR
    for upper_bound, band in _TENURE_BAND_UPPER_BOUNDS:
        if years < upper_bound:
            return band
    return TENURE_BAND_OVER_10


def employee_attribute_hash(
    dealership_id: str,
    department: str,
    job_role: str,
    hire_date: date,
    termination_date: date | None,
    *,
    is_active: bool,
    is_manager: bool,
) -> str:
    """Compute the SCD Type 2 ``attribute_hash`` for one employee version.

    **Serialisation contract -- Agent F's SQL merge must reproduce this byte for byte.**
    The payload is the seven tracked attributes (contract columns 3 through 9) in this
    exact order::

        dealership_id | department | job_role | hire_date | termination_date
                      | is_active  | is_manager

    Each value is rendered with :func:`arpi.utilities.hashing.canonical_token`:

    ===================== ====================================
    Value                 Rendered as
    ===================== ====================================
    text                  the text itself, unmodified
    ``NULL`` / ``None``   the empty string
    :class:`datetime.date` ISO-8601 ``YYYY-MM-DD``
    boolean               lowercase ``true`` / ``false``
    ===================== ====================================

    The seven tokens are joined with the pipe character ``|``, encoded UTF-8 and hashed
    with SHA-256, lowercase hex. A salesperson at ``GSA-003`` hired on 2021-05-04 and
    still employed therefore hashes this exact payload::

        GSA-003|Sales|Salesperson|2021-05-04||true|false

    Note the empty field between ``2021-05-04`` and ``true``: a NULL
    ``termination_date`` contributes an empty token, not the literal ``None``.

    Deliberately excluded: ``employee_key`` (a surrogate), ``employee_id`` (the matching
    key, so hashing it would be circular), ``tenure_band`` (derived from ``hire_date``,
    which is already tracked), the three SCD bookkeeping columns, and ``source_system``
    (a constant contributes no discriminating information).

    Args:
        dealership_id: Store for this version.
        department: Department for this version.
        job_role: Role for this version.
        hire_date: Date of hire.
        termination_date: Date of departure, or ``None``.
        is_active: Whether the person is employed in this version.
        is_manager: Whether the role carries management responsibility.

    Returns:
        A 64-character lowercase hexadecimal digest.
    """
    return hash_attributes(
        [
            dealership_id,
            department,
            job_role,
            hire_date,
            termination_date,
            is_active,
            is_manager,
        ]
    )


# ---------------------------------------------------------------------------------------
# Roster construction
# ---------------------------------------------------------------------------------------
def employee_headcount(config: ArpiConfig) -> int:
    """Return the number of distinct people generated for the active scale mode.

    Args:
        config: Resolved configuration.

    Returns:
        Headcount from :data:`EMPLOYEE_HEADCOUNT_BY_SCALE`.

    Raises:
        GenerationError: If the scale mode has no declared headcount.
    """
    try:
        return EMPLOYEE_HEADCOUNT_BY_SCALE[config.generation.scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No employee headcount is declared for scale mode "
            f"{config.generation.scale_mode!r}. Declared modes: "
            f"{', '.join(sorted(EMPLOYEE_HEADCOUNT_BY_SCALE))}.",
            entity=ENTITY_DIM_EMPLOYEE,
            scale_mode=config.generation.scale_mode,
        ) from error


def allocate_store_headcount(headcount: int) -> dict[str, int]:
    """Split a total headcount across the three stores by the declared shares.

    Uses the largest-remainder method with a ``dealership_id`` tie-break, so the split is
    deterministic and the parts always sum to ``headcount``.

    Args:
        headcount: Total number of people to place.

    Returns:
        A mapping of ``dealership_id`` to headcount, in ``dealership_id`` order.
    """
    exact = {store: headcount * share for store, share in STORE_HEADCOUNT_SHARE.items()}
    allocated = {store: int(value) for store, value in exact.items()}
    remainder = headcount - sum(allocated.values())
    ranked = sorted(exact, key=lambda store: (-(exact[store] - allocated[store]), store))
    for store in ranked[:remainder]:
        allocated[store] += 1
    return {store: allocated[store] for store in sorted(allocated)}


def expand_role_plan(dealership_id: str, headcount: int) -> tuple[str, ...]:
    """Return the ordered job roles staffed at one store.

    Args:
        dealership_id: Store to staff.
        headcount: Number of slots to fill.

    Returns:
        Exactly ``headcount`` job roles, in hiring-priority order. When ``headcount``
        exceeds the store's explicit plan the store's tail pattern repeats.

    Raises:
        GenerationError: If the store has no declared staffing plan.
    """
    plan = STORE_ROLE_PLANS.get(dealership_id)
    tail = STORE_ROLE_TAILS.get(dealership_id)
    if plan is None or tail is None:
        raise GenerationError(
            f"No staffing plan is declared for dealership {dealership_id!r}.",
            entity=ENTITY_DIM_EMPLOYEE,
            dealership_id=dealership_id,
        )
    if headcount <= len(plan):
        return plan[:headcount]
    roles = list(plan)
    while len(roles) < headcount:
        roles.extend(tail)
    return tuple(roles[:headcount])


def predecessor_assignment(
    dealership_id: str, job_role: str, hire_date: date
) -> tuple[str, str] | None:
    """Return the assignment a person held before their current one.

    Two change shapes are modelled. A management role is reached by **promotion** from the
    feeder role at the same store. A non-management role is reached by **transfer** from
    the same role at a different store, which is only valid if that store had already
    opened when the person was hired.

    Args:
        dealership_id: Current store.
        job_role: Current role.
        hire_date: Date of hire, which constrains which stores could have employed them.

    Returns:
        ``(dealership_id, job_role)`` for the prior version, or ``None`` when no valid
        prior assignment exists.
    """
    promoted_from = PROMOTION_PREDECESSOR.get(job_role)
    if promoted_from is not None:
        return dealership_id, promoted_from
    for store in sorted(STORE_DEFINITIONS, key=lambda item: item.dealership_id):
        if store.dealership_id != dealership_id and store.opened_date <= hire_date:
            return store.dealership_id, job_role
    return None


def select_by_score(scored: Sequence[tuple[str, float]], required: int) -> tuple[str, ...]:
    """Pick the top ``required`` identifiers by score, breaking ties on the identifier.

    Args:
        scored: ``(employee_id, score)`` pairs; a higher score is selected first.
        required: How many identifiers to select.

    Returns:
        The selected identifiers, sorted ascending so downstream iteration is stable.

    Raises:
        GenerationError: If fewer than ``required`` candidates were supplied.
    """
    if len(scored) < required:
        raise GenerationError(
            f"Only {len(scored)} eligible employee(s) were available but {required} were "
            "required. Raise the headcount for this scale mode or relax the eligibility "
            "rule; the contract requires at least "
            f"{MINIMUM_ROLE_CHANGES} employees with a genuine role or store change.",
            entity=ENTITY_DIM_EMPLOYEE,
            eligible=len(scored),
            required=required,
        )
    ranked = sorted(scored, key=lambda item: (-item[1], item[0]))
    return tuple(sorted(employee_id for employee_id, _ in ranked[:required]))


def build_employee_assignments(config: ArpiConfig) -> tuple[EmployeeAssignment, ...]:
    """Build the synthetic roster: one entry per person, in ``employee_id`` order.

    Args:
        config: Resolved configuration supplying the master seed, the scale mode and the
            reporting window.

    Returns:
        The roster, deterministic for a given ``random_seed`` and profile.
    """
    rng = rng_for(config.random_seed, EMPLOYEE_NAMESPACE)
    window_start = config.reporting.start_date
    window_end = config.reporting.end_date
    allocation = allocate_store_headcount(employee_headcount(config))
    opened = {store.dealership_id: store.opened_date for store in STORE_DEFINITIONS}

    people: list[dict[str, Any]] = []
    sequence = 0
    for dealership_id in sorted(allocation):
        for job_role in expand_role_plan(dealership_id, allocation[dealership_id]):
            sequence += 1
            people.append(
                {
                    "employee_id": f"EMP-{sequence:05d}",
                    "dealership_id": dealership_id,
                    "job_role": job_role,
                    "hire_date": _draw_hire_date(rng, job_role, opened[dealership_id], window_end),
                }
            )

    terminations = _draw_terminations(rng, people, window_start, window_end)
    changes = _draw_role_changes(rng, people, terminations, window_end)
    return tuple(
        EmployeeAssignment(
            employee_id=person["employee_id"],
            dealership_id=person["dealership_id"],
            job_role=person["job_role"],
            hire_date=person["hire_date"],
            termination_date=terminations.get(person["employee_id"]),
            **changes.get(person["employee_id"], {}),
        )
        for person in people
    )


def _draw_hire_date(rng: random.Random, job_role: str, opened_date: date, window_end: date) -> date:
    """Draw a hire date from the role's tenure distribution, clamped to the store's life."""
    low, high, mode = ROLE_TENURE_YEARS[job_role]
    years = rng.triangular(low, high, mode)
    candidate = window_end - timedelta(days=round(years * DAYS_PER_YEAR))
    return max(candidate, opened_date)


def _draw_terminations(
    rng: random.Random,
    people: Sequence[dict[str, Any]],
    window_start: date,
    window_end: date,
) -> dict[str, date]:
    """Choose who leaves during the window, then place each departure date."""
    eligible: list[tuple[str, float]] = []
    for person in people:
        score = rng.random() * ROLE_CHURN_WEIGHT[person["job_role"]]
        earliest = _earliest_termination_date(person["hire_date"], window_start)
        if earliest <= window_end:
            eligible.append((person["employee_id"], score))

    required = min(len(eligible), max(1, int(len(people) * TERMINATION_SHARE + 0.5)))
    selected = select_by_score(eligible, required)

    hire_dates = {person["employee_id"]: person["hire_date"] for person in people}
    terminations: dict[str, date] = {}
    for employee_id in selected:
        earliest = _earliest_termination_date(hire_dates[employee_id], window_start)
        span = (window_end - earliest).days
        terminations[employee_id] = earliest + timedelta(days=rng.randrange(span + 1))
    return terminations


def _earliest_termination_date(hire_date: date, window_start: date) -> date:
    """Return the first date on which a departure may be recorded."""
    return max(hire_date + timedelta(days=MINIMUM_EMPLOYMENT_DAYS), window_start)


def _draw_role_changes(
    rng: random.Random,
    people: Sequence[dict[str, Any]],
    terminations: dict[str, date],
    window_end: date,
) -> dict[str, dict[str, Any]]:
    """Choose who changed role or store, then place each change date.

    Departures are excluded: a person who left during the window keeps the assignment they
    left from, which keeps the two histories independent and easy to reason about.
    """
    eligible: list[tuple[str, float]] = []
    predecessors: dict[str, tuple[str, str]] = {}
    for person in people:
        score = rng.random()
        employee_id = person["employee_id"]
        if employee_id in terminations:
            continue
        if (window_end - person["hire_date"]).days < MINIMUM_CHANGE_TENURE_DAYS:
            continue
        prior = predecessor_assignment(
            person["dealership_id"], person["job_role"], person["hire_date"]
        )
        if prior is None:
            continue
        predecessors[employee_id] = prior
        eligible.append((employee_id, score))

    required = max(MINIMUM_ROLE_CHANGES, int(len(people) * ROLE_CHANGE_SHARE + 0.5))
    selected = select_by_score(eligible, required)

    hire_dates = {person["employee_id"]: person["hire_date"] for person in people}
    low, high = _CHANGE_POINT_RANGE
    changes: dict[str, dict[str, Any]] = {}
    for employee_id in selected:
        hire_date = hire_dates[employee_id]
        tenure_days = (window_end - hire_date).days
        offset = max(round(tenure_days * rng.uniform(low, high)), 1)
        prior_dealership_id, prior_job_role = predecessors[employee_id]
        changes[employee_id] = {
            "change_date": hire_date + timedelta(days=offset),
            "prior_dealership_id": prior_dealership_id,
            "prior_job_role": prior_job_role,
        }
    return changes


# ---------------------------------------------------------------------------------------
# Latent performance parameters
# ---------------------------------------------------------------------------------------
def employee_performance_profiles(config: ArpiConfig) -> dict[str, EmployeePerformanceProfile]:
    """Build the latent per-employee performance parameters, keyed by ``employee_id``.

    This is the **public entry point the sale generator calls**. The parameters are drawn
    from their own seeding namespace, so tuning them cannot shift a single value inside
    ``dim_employee``, and they are never materialised as columns anywhere.

    Every index is a multiplier: ``1.0`` is an average performer for the role. Volume is
    additionally scaled by a tenure factor, because a first-year salesperson genuinely does
    turn fewer units than a five-year veteran, and a scorecard that ignores that is the
    fairness failure [PRIVACY_AND_ETHICS.md §5] exists to prevent.

    No two employees receive the same parameters: identical employee performance is a
    prohibited synthetic pattern ([ARCHITECTURE.md §15.4]).

    Args:
        config: Resolved configuration.

    Returns:
        A mapping of ``employee_id`` to :class:`EmployeePerformanceProfile`, in
        ``employee_id`` order.
    """
    rng = rng_for(config.random_seed, EMPLOYEE_PERFORMANCE_NAMESPACE)
    window_end = config.reporting.end_date
    profiles: dict[str, EmployeePerformanceProfile] = {}
    for assignment in build_employee_assignments(config):
        tenure_years = max((window_end - assignment.hire_date).days, 0) / DAYS_PER_YEAR
        tenure_factor = min(0.72 + 0.11 * min(tenure_years, 5.0), 1.25)
        profiles[assignment.employee_id] = EmployeePerformanceProfile(
            employee_id=assignment.employee_id,
            dealership_id=assignment.dealership_id,
            job_role=assignment.job_role,
            is_manager=is_manager_for_role(assignment.job_role),
            is_active=assignment.termination_date is None,
            volume_index=round(rng.triangular(0.45, 1.85, 0.95) * tenure_factor, 4),
            closing_rate_index=round(rng.triangular(0.62, 1.48, 0.98), 4),
            gross_retention_index=round(rng.triangular(0.74, 1.32, 1.00), 4),
            crm_discipline_index=round(rng.triangular(0.35, 1.00, 0.78), 4),
        )
    return profiles


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class EmployeeGenerator(BaseGenerator):
    """Build every SCD Type 2 version of every synthetic employee."""

    entity_name = ENTITY_DIM_EMPLOYEE
    declared_columns = DIM_EMPLOYEE_COLUMNS
    namespace = EMPLOYEE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the employee frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 15 contract columns, in order, sorted by ``employee_id`` then
            ``effective_date``, with ``employee_key`` assigned as a deterministic ordinal
            over that ordering.
        """
        window_end = config.reporting.end_date
        records: list[dict[str, Any]] = []
        for assignment in build_employee_assignments(config):
            records.extend(_versions_for(assignment, window_end))
        records.sort(key=lambda row: (row["employee_id"], row["effective_date"]))
        for employee_key, record in enumerate(records, start=1):
            record["employee_key"] = employee_key
        frame = pd.DataFrame.from_records(records, columns=list(DIM_EMPLOYEE_COLUMNS))
        return frame.astype(DIM_EMPLOYEE_DTYPES)


def generate_employee_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_employee`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return EmployeeGenerator().generate(config)


def _versions_for(assignment: EmployeeAssignment, window_end: date) -> list[dict[str, Any]]:
    """Render one person as their one or two contiguous SCD Type 2 versions."""
    tenure_band = tenure_band_for(assignment.hire_date, window_end)
    versions: list[dict[str, Any]] = []
    if assignment.change_date is not None:
        versions.append(
            _version_row(
                assignment,
                dealership_id=str(assignment.prior_dealership_id),
                job_role=str(assignment.prior_job_role),
                termination_date=None,
                tenure_band=tenure_band,
                effective_date=assignment.hire_date,
                expiration_date=assignment.change_date - timedelta(days=1),
                is_current=False,
            )
        )
    versions.append(
        _version_row(
            assignment,
            dealership_id=assignment.dealership_id,
            job_role=assignment.job_role,
            termination_date=assignment.termination_date,
            tenure_band=tenure_band,
            effective_date=assignment.change_date or assignment.hire_date,
            expiration_date=SENTINEL_EXPIRATION_DATE,
            is_current=True,
        )
    )
    return versions


def _version_row(
    assignment: EmployeeAssignment,
    *,
    dealership_id: str,
    job_role: str,
    termination_date: date | None,
    tenure_band: str,
    effective_date: date,
    expiration_date: date,
    is_current: bool,
) -> dict[str, Any]:
    """Render one SCD Type 2 version as a ``dim_employee`` row (minus ``employee_key``)."""
    department = department_for_role(job_role)
    is_manager = is_manager_for_role(job_role)
    is_active = termination_date is None
    return {
        "employee_key": 0,
        "employee_id": assignment.employee_id,
        "dealership_id": dealership_id,
        "department": department,
        "job_role": job_role,
        "hire_date": assignment.hire_date,
        "termination_date": termination_date,
        "is_active": is_active,
        "is_manager": is_manager,
        "tenure_band": tenure_band,
        "effective_date": effective_date,
        "expiration_date": expiration_date,
        "is_current": is_current,
        "attribute_hash": employee_attribute_hash(
            dealership_id,
            department,
            job_role,
            assignment.hire_date,
            termination_date,
            is_active=is_active,
            is_manager=is_manager,
        ),
        "source_system": SOURCE_SYSTEM,
    }


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


def _check_non_overlapping_versions(frame: pd.DataFrame) -> CheckResult:
    """``DQ-EMP-003`` -- version ranges per employee are contiguous and non-overlapping."""
    base = _base_result(
        CHECK_EMPLOYEE_NON_OVERLAPPING_VERSIONS,
        "dim_employee version ranges are contiguous and non-overlapping",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    ordered = frame.sort_values(["employee_id", "effective_date"])
    one_day = pd.Timedelta(days=1)
    offending = 0
    for _, versions in ordered.groupby("employee_id", sort=True):
        expirations = versions["expiration_date"].tolist()
        effectives = versions["effective_date"].tolist()
        offending += sum(
            1
            for index in range(1, len(effectives))
            if expirations[index - 1] + one_day != effectives[index]
        )
    if offending == 0:
        return base
    return base.failed(
        f"{offending} adjacent version pair(s) are not contiguous: the previous version's "
        "expiration_date must be exactly one day before the next version's effective_date.",
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
