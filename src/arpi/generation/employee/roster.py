"""Roster construction: who is hired, when, into what, and who replaces them.

This is where the randomness lives. Every draw is taken from a seeded generator in a
fixed order, and that order is part of the output contract: reordering two draws changes
every subsequent value and therefore the generated data.
`tests/data_quality/test_employee_characterisation.py` pins the result.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

from arpi.exceptions import GenerationError
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.employee.contract import (
    DAYS_PER_YEAR,
    EMPLOYEE_NAMESPACE,
    ENTITY_DIM_EMPLOYEE,
)
from arpi.generation.employee.distributions import (
    _CHANGE_POINT_RANGE,
    EMPLOYEE_HEADCOUNT_BY_SCALE,
    MINIMUM_CHANGE_TENURE_DAYS,
    MINIMUM_EMPLOYMENT_DAYS,
    MINIMUM_ROLE_CHANGES,
    PROMOTION_PREDECESSOR,
    ROLE_CHANGE_SHARE,
    ROLE_CHURN_WEIGHT,
    ROLE_TENURE_YEARS,
    STORE_HEADCOUNT_SHARE,
    STORE_ROLE_PLANS,
    STORE_ROLE_TAILS,
    TERMINATION_SHARE,
)
from arpi.generation.employee.models import EmployeeAssignment
from arpi.utilities.seeding import rng_for

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    import random
    from collections.abc import Sequence

    from arpi.config import ArpiConfig


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
