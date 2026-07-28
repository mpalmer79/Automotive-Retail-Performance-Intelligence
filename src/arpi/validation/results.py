"""Typed data-quality results.

:class:`CheckResult` mirrors the ``audit.validation_result`` table column for column, so
a report can be persisted without any translation layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Self

from arpi.constants import CHECK_CATEGORY_STRUCTURAL


class CheckSeverity(StrEnum):
    """How much a failing check matters."""

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class CheckStatus(StrEnum):
    """Outcome of evaluating a check."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass(frozen=True, slots=True)
class CheckResult:
    """The outcome of a single data-quality check.

    Attributes:
        check_id: Stable identifier shared with SQL, e.g. ``"DQ-DATE-001"``.
        check_name: Short human-readable name.
        check_category: One of the ``CHECK_CATEGORY_*`` constants.
        target_object: Entity or object the check was evaluated against.
        severity: Severity of a failure.
        status: Outcome of the evaluation.
        observed_value: Numeric value observed, when the check produces one.
        expected_value: Numeric value expected, when the check produces one.
        failed_record_count: Number of offending records.
        message: Human-readable explanation, always populated for failures.
    """

    check_id: str
    check_name: str
    target_object: str
    severity: CheckSeverity = CheckSeverity.CRITICAL
    status: CheckStatus = CheckStatus.PASSED
    check_category: str = CHECK_CATEGORY_STRUCTURAL
    observed_value: float | None = None
    expected_value: float | None = None
    failed_record_count: int = 0
    message: str | None = None

    @property
    def is_failure(self) -> bool:
        """Whether this check failed."""
        return self.status is CheckStatus.FAILED

    def failed(self, message: str, **updates: Any) -> Self:
        """Return a failed copy of this result.

        Args:
            message: Explanation of the failure.
            **updates: Additional field overrides, e.g. ``failed_record_count``.

        Returns:
            A new :class:`CheckResult` with ``status`` set to ``failed``.
        """
        return replace(self, status=CheckStatus.FAILED, message=message, **updates)

    def as_audit_row(self) -> dict[str, Any]:
        """Render this result as an ``audit.validation_result`` row (minus keys)."""
        return {
            "check_id": self.check_id,
            "check_name": self.check_name,
            "check_category": self.check_category,
            "target_object": self.target_object,
            "severity": str(self.severity),
            "status": str(self.status),
            "observed_value": self.observed_value,
            "expected_value": self.expected_value,
            "failed_record_count": self.failed_record_count,
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class ValidationReport:
    """An ordered collection of :class:`CheckResult` values."""

    results: tuple[CheckResult, ...] = field(default_factory=tuple)

    @classmethod
    def combine(cls, *reports: ValidationReport) -> ValidationReport:
        """Concatenate several reports, preserving order.

        Args:
            *reports: Reports to merge.

        Returns:
            A single report containing every result.
        """
        merged: list[CheckResult] = []
        for report in reports:
            merged.extend(report.results)
        return cls(tuple(merged))

    def __len__(self) -> int:
        return len(self.results)

    @property
    def failures(self) -> tuple[CheckResult, ...]:
        """Every failed check, at any severity.

        The severity-specific properties below partition this tuple. They exist for
        convenience; this one exists so that a failure at a severity nobody anticipated
        cannot vanish between them.
        """
        return tuple(result for result in self.results if result.is_failure)

    @property
    def critical_failures(self) -> tuple[CheckResult, ...]:
        """Failed checks whose severity is ``critical``. These fail the run."""
        return tuple(
            result for result in self.failures if result.severity is CheckSeverity.CRITICAL
        )

    @property
    def warnings(self) -> tuple[CheckResult, ...]:
        """Failed checks whose severity is ``warning``. Reported, never gating."""
        return tuple(
            result for result in self.failures if result.severity is CheckSeverity.WARNING
        )

    @property
    def info_failures(self) -> tuple[CheckResult, ...]:
        """Failed checks whose severity is ``info``.

        Nothing emits one today, and an ``info`` failure never gates a run. The property
        exists because the tally in :meth:`summary_table` must account for every result:
        a failure counted in no bucket would read as though the report were clean.
        """
        return tuple(result for result in self.failures if result.severity is CheckSeverity.INFO)

    @property
    def passed(self) -> tuple[CheckResult, ...]:
        """Checks that passed."""
        return tuple(result for result in self.results if result.status is CheckStatus.PASSED)

    @property
    def skipped(self) -> tuple[CheckResult, ...]:
        """Checks that were not evaluated."""
        return tuple(result for result in self.results if result.status is CheckStatus.SKIPPED)

    @property
    def has_critical_failure(self) -> bool:
        """Whether any critical check failed."""
        return bool(self.critical_failures)

    def summary_table(self) -> str:
        """Render the report as a fixed-width, human-readable table.

        Returns:
            A multi-line string ending with a one-line tally. Empty reports render a
            single explanatory line.
        """
        if not self.results:
            return "No data-quality checks were evaluated."

        headers = ("CHECK ID", "STATUS", "SEVERITY", "TARGET", "DETAIL")
        rows = [
            (
                result.check_id,
                str(result.status).upper(),
                str(result.severity),
                result.target_object,
                result.message or "",
            )
            for result in self.results
        ]
        widths = [
            max(len(header), *(len(row[index]) for row in rows))
            for index, header in enumerate(headers)
        ]
        # The final column is free-form prose, so it is not padded.
        widths[-1] = len(headers[-1])

        def render(cells: tuple[str, ...]) -> str:
            padded = [cell.ljust(widths[index]) for index, cell in enumerate(cells)]
            return "  ".join(padded).rstrip()

        lines = [render(headers), render(tuple("-" * width for width in widths))]
        lines.extend(render(row) for row in rows)
        # Every bucket is printed, including the one that is normally zero, so that the
        # counts always add up to the number of rows above them. A tally that silently
        # omits a category is how a failure gets mistaken for a clean report.
        lines.append(
            f"{len(self.passed)} passed, {len(self.critical_failures)} critical failure(s), "
            f"{len(self.warnings)} warning(s), {len(self.info_failures)} info failure(s), "
            f"{len(self.skipped)} skipped."
        )
        return "\n".join(lines)

    def as_audit_rows(self) -> list[dict[str, Any]]:
        """Render every result as an ``audit.validation_result`` row."""
        return [result.as_audit_row() for result in self.results]
