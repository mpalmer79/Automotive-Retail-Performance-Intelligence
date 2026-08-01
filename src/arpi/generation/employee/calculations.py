"""Derivations from an employee's attributes: department, seniority, tenure, hash.

Pure functions of their arguments. No configuration, no randomness, no frame -- which is
what makes them testable one value at a time, and what makes the attribute hash
reproducible across runs.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from arpi.exceptions import GenerationError
from arpi.generation.employee.contract import (
    _TENURE_BAND_UPPER_BOUNDS,
    ALLOWED_JOB_ROLES,
    DAYS_PER_YEAR,
    ENTITY_DIM_EMPLOYEE,
    MANAGER_JOB_ROLES,
    ROLE_DEPARTMENT,
    TENURE_BAND_OVER_10,
)
from arpi.utilities.hashing import hash_attributes

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    pass


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
