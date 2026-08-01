"""The ``warehouse.dim_employee`` column contract and its controlled vocabularies.

Data, not behaviour. Nothing here reads a configuration, draws a random number, or imports
pandas -- the dtypes are named as strings. The module is therefore readable on its own
terms: what a column is called, what it may contain, and what it must never contain.

(Importing it still pulls pandas in transitively, because ``arpi.generation.__init__``
eagerly imports every generator. That is a property of the parent package, not of this
module, and making the package lazy is a behaviour change rather than a split.)

The privacy tripwires live here too, beside the vocabularies they guard: the prohibited
column names and the latent-parameter tokens are part of what this entity is *allowed to
be*, which is exactly what a contract states.
"""

from __future__ import annotations

from typing import Final

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
