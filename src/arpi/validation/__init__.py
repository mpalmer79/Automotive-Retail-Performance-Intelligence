"""Data-quality framework: reusable checks, typed results and dataset-level suites.

Importing this package populates :data:`arpi.validation.registry.CHECK_REGISTRY` with
every check the platform declares today. A module implementing a new family registers its
own checks -- see the :mod:`arpi.validation.registry` docstring -- and never edits the
registry module.

THE VALIDATOR CONTRACT
======================
A check exists to *report* on data. Four things can go wrong while one runs, and they are
not interchangeable. Confusing them is how a gating suite either crashes on bad data or,
worse, goes green while hiding a defect.

**1. Invalid input data -> a failed** :class:`~arpi.validation.results.CheckResult`.
The check ran to completion and the data did not satisfy the rule. This is the check
doing its job, not an error. It must return a structured result: a status, a count, an
observed value, and a message naming enough of the offending records to start debugging.
It must never raise, and it must never stop the other checks in the suite from running.

A worked example is ``DQ-EMP-003`` in :mod:`arpi.generation.employee`. An SCD Type 2 row
carrying the open-ended ``9999-12-31`` sentinel followed by a later version is invalid
history. That is *data*, so the check reports it. It previously evaluated
``pandas.Timestamp("9999-12-31") + pandas.Timedelta(days=1)``, which is outside pandas'
nanosecond range, so on ``pandas==2.2.3`` it raised ``OutOfBoundsDatetime`` and took the
whole gating suite down instead of failing one check.

**2. A programming error -> raise, loudly.**
A typo, a wrong column name, a broken invariant inside the check itself. These must
surface as exceptions with their traceback intact. They are *not* to be converted into
failed checks: a suite that reports "check failed" for its own bugs cannot be trusted to
mean anything when it reports a real one.

This is why checks do not wrap their bodies in ``try/except Exception``. Guard the
specific, known, domain-invalid state at the boundary where it enters -- see
``arpi.generation.employee._as_date``, which converts unusable cells to ``None`` for the
caller to report -- and let everything else propagate.

**3. Validation-infrastructure failure -> raise.**
An unregistered check identifier, a malformed check definition, a result that cannot be
rendered as an audit row. :class:`~arpi.validation.registry.UnregisteredCheckError` and
:class:`~arpi.validation.registry.DuplicateCheckIdError` exist for this and are
deliberately fatal: an audit trail assembled from an unknown check is not an audit trail.

**4. Environmental failure -> raise, and let the caller decide.**
An unreachable database, a missing file, a permission error. The pipeline distinguishes
these from data failures when it sets the run's terminal status; a check does not.

The practical test when writing a check: *would a competent operator looking at this
result know whether to fix the data or to file a bug?* If the answer depends on reading a
traceback, the check is reporting the wrong one of these four.
"""

from __future__ import annotations

from arpi.validation.privacy import (
    ProhibitedColumnError,
    assert_columns_are_privacy_safe,
    assert_csv_header_is_privacy_safe,
    assert_frame_is_privacy_safe,
    is_prohibited_column,
    prohibited_columns,
    redact_payload,
)
from arpi.validation.registry import (
    CHECK_REGISTRY,
    CheckDefinition,
    CheckLayer,
    DuplicateCheckIdError,
    UnregisteredCheckError,
    iter_checks_for_entity,
    register_check,
    register_checks,
    require_registered,
)
from arpi.validation.results import (
    CheckResult,
    CheckSeverity,
    CheckStatus,
    ValidationReport,
)

__all__ = [
    "CHECK_REGISTRY",
    "CheckDefinition",
    "CheckLayer",
    "CheckResult",
    "CheckSeverity",
    "CheckStatus",
    "DuplicateCheckIdError",
    "ProhibitedColumnError",
    "UnregisteredCheckError",
    "ValidationReport",
    "assert_columns_are_privacy_safe",
    "assert_csv_header_is_privacy_safe",
    "assert_frame_is_privacy_safe",
    "is_prohibited_column",
    "iter_checks_for_entity",
    "prohibited_columns",
    "redact_payload",
    "register_check",
    "register_checks",
    "require_registered",
]
