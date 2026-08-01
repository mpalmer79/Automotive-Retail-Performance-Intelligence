"""Latent performance parameters: generation inputs, never warehouse facts.

[ARCHITECTURE.md §15.3] requires employees to differ in volume, closing rate and gross
retention, otherwise the sales fact is implausibly uniform. Those per-person parameters
are consumed by the sale, lead and appointment generators.

They are deliberately **not** columns of ``dim_employee``, are never written to the
committed sample data, and must never reach a reporting view. The reason is analytical
honesty rather than squeamishness: a scorecard built from a latent "true skill" parameter
is circular. It would report back the number the generator used to fabricate the outcome,
and it would look like a validated measurement of a person.

``DQ-EMP-005`` enforces this by inspecting the warehouse frame's *schema*, so a leaked
parameter fails the run even when the column is empty.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from arpi.generation.employee.calculations import is_manager_for_role
from arpi.generation.employee.contract import (
    DAYS_PER_YEAR,
    EMPLOYEE_PERFORMANCE_NAMESPACE,
)
from arpi.generation.employee.models import EmployeePerformanceProfile
from arpi.generation.employee.roster import build_employee_assignments
from arpi.utilities.seeding import rng_for

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig


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
