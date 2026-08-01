"""Generator for ``warehouse.dim_employee`` (Slowly Changing Dimension Type 2).

This package was one 1,532-line module carrying at least eight responsibilities. It is
split by responsibility, and this file is the compatibility surface: every name that was
importable from ``arpi.generation.employee`` still is, from the same path. Forty-two names
are imported from here elsewhere in the repository, and
``tests/data_quality/test_employee_characterisation.py`` asserts each one by name.

    contract        the column contract, controlled vocabularies, privacy tripwires
    distributions   roster shape -- how many people, in which roles, at which store
    models          the typed records passed between stages
    calculations    pure derivations: department, seniority, tenure band, attribute hash
    roster          who is hired, when, into what, and who replaces them
    performance     latent parameters, which are generation inputs and never facts
    builder         assembling the roster into Type 2 rows
    validation      DQ-EMP-001 through DQ-EMP-009

The split is behaviour-preserving. The generated CSV, the attribute hashes, the roster
plan, the performance profiles and every validation result are byte-identical to the
pre-split module, and each is pinned by a digest in the characterisation suite.

Privacy posture
---------------
This is one of the two most privacy-sensitive entities in ARPI, and its design is
subtractive: the generator has **no code path that can produce a personal name, a
personal email address, a phone number, a street address, a compensation figure, a pay
plan, a commission, or any protected characteristic**. A synthetic ``employee_id`` plus
role, store and banded tenure answers every KPI the project declares, so nothing more is
generated. ``DQ-EMP-005`` inspects the *schema*, so an accidental prohibited column fails
the run even when it holds no values.

SCD Type 2 semantics
--------------------
The grain is one row per employee **role-assignment version**. A person who is promoted or
moves store produces two contiguous versions: the earlier one is expired the day before
the change, and the later one carries the open-ended ``9999-12-31`` sentinel.

Employment status is carried by ``is_active`` and ``termination_date``, **not** by expiring
the version. A terminated employee therefore still has exactly one ``is_current`` row, so
historical facts keep resolving and the partial unique index on ``employee_id WHERE
is_current`` holds for everyone.
"""

from __future__ import annotations

from arpi.generation.employee.builder import (
    EmployeeGenerator,
    generate_employee_dataset,
)
from arpi.generation.employee.calculations import (
    department_for_role,
    employee_attribute_hash,
    is_manager_for_role,
    tenure_band_for,
)
from arpi.generation.employee.contract import (
    ALLOWED_DEPARTMENTS,
    ALLOWED_JOB_ROLES,
    ALLOWED_TENURE_BANDS,
    DEPARTMENT_SALES,
    DIM_EMPLOYEE_COLUMNS,
    DIM_EMPLOYEE_DTYPES,
    DIM_EMPLOYEE_REQUIRED_COLUMNS,
    EMPLOYEE_HASH_COLUMNS,
    EMPLOYEE_NAMESPACE,
    EMPLOYEE_PERFORMANCE_NAMESPACE,
    ENTITY_DIM_EMPLOYEE,
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
    LATENT_PARAMETER_COLUMN_TOKENS,
    MANAGER_JOB_ROLES,
    ROLE_DEPARTMENT,
    TENURE_BAND_1_TO_3,
    TENURE_BAND_3_TO_5,
    TENURE_BAND_5_TO_10,
    TENURE_BAND_OVER_10,
    TENURE_BAND_UNDER_1,
)
from arpi.generation.employee.distributions import (
    EMPLOYEE_HEADCOUNT_BOUNDS,
)
from arpi.generation.employee.models import (
    EmployeeAssignment,
    EmployeePerformanceProfile,
)
from arpi.generation.employee.performance import employee_performance_profiles
from arpi.generation.employee.roster import (
    allocate_store_headcount,
    build_employee_assignments,
    employee_headcount,
    expand_role_plan,
    predecessor_assignment,
    select_by_score,
)
from arpi.generation.employee.validation import (
    EMPLOYEE_CHECK_IDS,
    validate_employee_dataset,
)

__all__ = [
    "ALLOWED_DEPARTMENTS",
    "ALLOWED_JOB_ROLES",
    "ALLOWED_TENURE_BANDS",
    "DEPARTMENT_SALES",
    "DIM_EMPLOYEE_COLUMNS",
    "DIM_EMPLOYEE_DTYPES",
    "DIM_EMPLOYEE_REQUIRED_COLUMNS",
    "EMPLOYEE_CHECK_IDS",
    "EMPLOYEE_HASH_COLUMNS",
    "EMPLOYEE_HEADCOUNT_BOUNDS",
    "EMPLOYEE_NAMESPACE",
    "EMPLOYEE_PERFORMANCE_NAMESPACE",
    "ENTITY_DIM_EMPLOYEE",
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
    "EmployeeAssignment",
    "EmployeeGenerator",
    "EmployeePerformanceProfile",
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
]
