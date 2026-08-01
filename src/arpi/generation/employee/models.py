"""The typed records the employee generator passes between its stages.

``EmployeeAssignment`` is one person's role assignment over a period; a promotion or a
store move produces a second one. ``EmployeePerformanceProfile`` carries the latent
parameters the sale, lead and appointment generators consume.

Neither is a warehouse row. ``EmployeePerformanceProfile`` in particular must never
become one -- see the privacy note in :mod:`arpi.generation.employee.performance`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


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
