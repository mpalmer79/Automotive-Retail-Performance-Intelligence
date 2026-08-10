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

from collections.abc import Mapping
from types import MappingProxyType
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

# ---------------------------------------------------------------------------------------
# Employee-performance role families (DASH.11)
# ---------------------------------------------------------------------------------------
# A ROLE FAMILY IS THE OPERATING SURFACE a person's measured activity belongs to. It is not
# a rank, a seniority order, a pay band or a judgement, and nothing may order these five
# values as though one were better than another. They exist because the surfaces have
# genuinely different opportunities and genuinely different governed denominators: a
# contact rate belongs to a lead population, a gross per retail unit to a delivered-unit
# population, and presenting one against the other is a category error rather than a
# comparison.
#
# THE MAP WAS DERIVED FROM THE FACTS, NOT ASSUMED FROM THE TITLES. Every entry below was
# chosen after auditing which job roles actually appear in each role-playing foreign key on
# the development profile; the audit is recorded in docs/reviews/DASH-11-REVIEW.md.
#
# TWO LAYERS, ONE MEANING, PROVED RATHER THAN PROMISED. warehouse.fn_employee_role_family()
# is the SQL authority and this is the Python one, because two languages cannot share a
# function body. tests/integration/test_employee_role_family_parity.py evaluates both over
# every declared job role and asserts they agree, which is the same arrangement
# arpi.generation.fi_eligibility has with the governed F&I functions.

ROLE_FAMILY_SALESPERSON: Final = "Salesperson"
ROLE_FAMILY_DESK_MANAGEMENT: Final = "Desk Management"
ROLE_FAMILY_FINANCE: Final = "Finance"
ROLE_FAMILY_BDC: Final = "BDC"

#: The bucket for activity credited to nobody. A real population -- deliveries written with
#: no finance manager, leads assigned to no one, appointments with no BDC employee -- kept
#: OUTSIDE the employee comparison and INSIDE every total. It is never given an EMP code.
ROLE_FAMILY_UNASSIGNED: Final = "Unassigned"

#: Declaration order, which is presentation order. NOT a ranking.
EMPLOYEE_ROLE_FAMILIES: Final[tuple[str, ...]] = (
    ROLE_FAMILY_SALESPERSON,
    ROLE_FAMILY_DESK_MANAGEMENT,
    ROLE_FAMILY_FINANCE,
    ROLE_FAMILY_BDC,
    ROLE_FAMILY_UNASSIGNED,
)

#: The four families a person can hold, in presentation order. Excludes Unassigned, which
#: belongs to no person.
EMPLOYEE_ROLE_FAMILIES_WITH_PEOPLE: Final[tuple[str, ...]] = EMPLOYEE_ROLE_FAMILIES[:-1]

#: job_role -> role family. A role absent from this map has NO employee-performance surface.
#:
#: Sales Manager and General Manager are Desk Management because both are credited on real
#: deliveries in fact_vehicle_sale.desk_manager_key -- 231 and 241 of them on the
#: development profile -- and each keeps its own job_role label on every row rather than
#: being promoted to a Desk Manager.
#:
#: Service Advisor is ABSENT, deliberately: warehouse.fact_service_visit is Deferred, so no
#: fact credits a service advisor with anything. Absence means "no surface", which is the
#: truthful answer; a Service family would render a page of zeroes that read as poor
#: performance rather than as absent data.
#:
#: BDC Manager is mapped but unpopulated: it is in the dim_employee job_role domain and no
#: generated employee holds it. The entry makes the map total over the declared domain; it
#: does not claim a surface.
ROLE_FAMILY_BY_JOB_ROLE: Final[Mapping[str, str]] = MappingProxyType(
    {
        JOB_ROLE_SALESPERSON: ROLE_FAMILY_SALESPERSON,
        JOB_ROLE_DESK_MANAGER: ROLE_FAMILY_DESK_MANAGEMENT,
        JOB_ROLE_SALES_MANAGER: ROLE_FAMILY_DESK_MANAGEMENT,
        JOB_ROLE_GENERAL_MANAGER: ROLE_FAMILY_DESK_MANAGEMENT,
        JOB_ROLE_FINANCE_MANAGER: ROLE_FAMILY_FINANCE,
        JOB_ROLE_BDC_REPRESENTATIVE: ROLE_FAMILY_BDC,
        JOB_ROLE_BDC_MANAGER: ROLE_FAMILY_BDC,
    }
)


def role_family(job_role: str) -> str | None:
    """Return the employee-performance role family for a job role.

    The Python half of the two-layer authority; ``warehouse.fn_employee_role_family()`` is
    the SQL half and an integration test proves the two agree over every declared role.

    Args:
        job_role: A value from :data:`ALLOWED_JOB_ROLES`.

    Returns:
        The role family, or ``None`` where the role has no employee-performance surface --
        which is a truthful answer and never a default into some other family.
    """
    return ROLE_FAMILY_BY_JOB_ROLE.get(job_role)


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
