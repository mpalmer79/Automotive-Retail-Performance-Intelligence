"""Roster shape: how many people, in which roles, at which store.

The reference distributions the generator draws against. Separated from the drawing
itself so that a change to the shape of the dealer group is reviewable without reading
the construction logic, and so that the numbers can be asserted directly.
"""

from __future__ import annotations

from typing import Final

from arpi.generation.employee.contract import (
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
)

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
