"""Data-quality framework: reusable checks, typed results and dataset-level suites.

Importing this package populates :data:`arpi.validation.registry.CHECK_REGISTRY` with
every check the platform declares today. A module implementing a new family registers its
own checks -- see the :mod:`arpi.validation.registry` docstring -- and never edits the
registry module.
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
