"""Data-quality framework: reusable checks, typed results and dataset-level suites."""

from __future__ import annotations

from arpi.validation.results import (
    CheckResult,
    CheckSeverity,
    CheckStatus,
    ValidationReport,
)

__all__ = ["CheckResult", "CheckSeverity", "CheckStatus", "ValidationReport"]
