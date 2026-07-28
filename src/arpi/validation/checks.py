"""Reusable, entity-agnostic data-quality checks.

Every function returns a :class:`~arpi.validation.results.CheckResult` rather than
raising, so a full report can be produced in one pass and persisted to
``audit.validation_result``.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import date, timedelta

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    PROHIBITED_PII_FIELD_NAMES,
)
from arpi.validation.results import CheckResult, CheckSeverity, CheckStatus


def check_unique_column(
    frame: pd.DataFrame,
    column: str,
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that a column contains no duplicate values.

    Args:
        frame: Frame to inspect.
        column: Column that must be unique.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the number of distinct values and
        ``expected_value`` the row count.
    """
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_STRUCTURAL,
    )
    if column not in frame.columns:
        return base.failed(f"Column {column!r} is missing from {target_object}.")

    total = int(frame.shape[0])
    distinct = int(frame[column].nunique(dropna=False))
    result = replace(base, observed_value=float(distinct), expected_value=float(total))
    if distinct == total:
        return result
    duplicates = total - distinct
    return result.failed(
        f"{column!r} has {duplicates} duplicate value(s) across {total} row(s).",
        failed_record_count=duplicates,
    )


def check_non_null_columns(
    frame: pd.DataFrame,
    columns: Sequence[str],
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that a set of columns contains no NULL values.

    Args:
        frame: Frame to inspect.
        columns: Columns that must be fully populated.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the total number of NULL cells found.
    """
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_STRUCTURAL,
    )
    missing_columns = [column for column in columns if column not in frame.columns]
    if missing_columns:
        return base.failed(
            f"Columns absent from {target_object}: {', '.join(sorted(missing_columns))}."
        )

    null_counts = {
        column: int(frame[column].isna().sum())
        for column in columns
        if int(frame[column].isna().sum()) > 0
    }
    total_nulls = sum(null_counts.values())
    result = replace(base, observed_value=float(total_nulls), expected_value=0.0)
    if not null_counts:
        return result
    detail = ", ".join(f"{column}={count}" for column, count in sorted(null_counts.items()))
    return result.failed(
        f"NULL values found in required column(s): {detail}.",
        failed_record_count=total_nulls,
    )


def check_column_schema(
    frame: pd.DataFrame,
    expected_columns: Sequence[str],
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that a frame's columns match a contract exactly, including order.

    Args:
        frame: Frame to inspect.
        expected_columns: The contract column names, in contract order.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the actual column count.
    """
    actual = tuple(str(column) for column in frame.columns)
    expected = tuple(expected_columns)
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_STRUCTURAL,
        observed_value=float(len(actual)),
        expected_value=float(len(expected)),
    )
    if actual == expected:
        return base

    missing = [column for column in expected if column not in actual]
    unexpected = [column for column in actual if column not in expected]
    if missing or unexpected:
        detail = f"missing={sorted(missing) or 'none'}, unexpected={sorted(unexpected) or 'none'}"
    else:
        detail = f"same columns in the wrong order: expected {expected}, got {actual}"
    return base.failed(f"Column contract violated for {target_object}: {detail}.")


def check_values_in_allowed_set(
    frame: pd.DataFrame,
    column: str,
    allowed: Collection[object],
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that every non-NULL value in a column comes from an allowed set.

    Args:
        frame: Frame to inspect.
        column: Column to inspect.
        allowed: Permitted values.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the number of offending rows.
    """
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        expected_value=0.0,
    )
    if column not in frame.columns:
        return base.failed(f"Column {column!r} is missing from {target_object}.")

    series = frame[column].dropna()
    offending = sorted({str(value) for value in series if value not in allowed})
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{column!r} contains value(s) outside the allowed set: {', '.join(offending)}. "
        f"Allowed: {', '.join(sorted(str(value) for value in allowed))}.",
        failed_record_count=len(offending),
    )


def check_contiguous_date_range(
    frame: pd.DataFrame,
    column: str,
    start: date,
    end: date,
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that a date column covers ``[start, end]`` with no gaps and no extras.

    Args:
        frame: Frame to inspect.
        column: Date column to inspect.
        start: First date that must be present.
        end: Last date that must be present.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the number of distinct dates present
        and ``expected_value`` the number of dates in the window.
    """
    expected_count = (end - start).days + 1
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_STRUCTURAL,
        expected_value=float(expected_count),
    )
    if column not in frame.columns:
        return base.failed(f"Column {column!r} is missing from {target_object}.")

    present = {value.date() for value in pd.to_datetime(frame[column])}
    result = replace(base, observed_value=float(len(present)))

    expected_set = {start + timedelta(days=offset) for offset in range(expected_count)}
    missing = sorted(expected_set - present)
    extra = sorted(present - expected_set)
    if not missing and not extra:
        return result

    problems = []
    if missing:
        problems.append(f"{len(missing)} missing date(s), first {missing[0].isoformat()}")
    if extra:
        problems.append(f"{len(extra)} unexpected date(s), first {extra[0].isoformat()}")
    return result.failed(
        f"{column!r} does not cover {start.isoformat()}..{end.isoformat()} contiguously: "
        + "; ".join(problems)
        + ".",
        failed_record_count=len(missing) + len(extra),
    )


def check_ratio_within_bounds(
    observed: float,
    minimum: float,
    maximum: float,
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.WARNING,
    description: str = "ratio",
) -> CheckResult:
    """Assert that a ratio falls inside an inclusive tolerance band.

    Args:
        observed: Observed ratio.
        minimum: Inclusive lower bound.
        maximum: Inclusive upper bound.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.
        description: Noun used in the failure message, e.g. ``"selling-day ratio"``.

    Returns:
        The check result; ``expected_value`` records the midpoint of the band.
    """
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        observed_value=observed,
        expected_value=(minimum + maximum) / 2,
    )
    if minimum <= observed <= maximum:
        return base
    return base.failed(
        f"The {description} for {target_object} is {observed:.4f}, outside the configured "
        f"band [{minimum:.4f}, {maximum:.4f}]."
    )


def check_no_prohibited_pii_columns(
    frame: pd.DataFrame,
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Assert that no column name matches the prohibited personal-data vocabulary.

    ARPI generates no personal data at all. This check is a structural tripwire: if a
    future generator introduces a column called ``email`` or ``ssn``, the pipeline fails
    before anything is written.

    Args:
        frame: Frame to inspect.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the number of offending columns.
    """
    offending = sorted(
        str(column)
        for column in frame.columns
        if str(column).strip().lower() in PROHIBITED_PII_FIELD_NAMES
    )
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_PRIVACY,
        observed_value=float(len(offending)),
        expected_value=0.0,
    )
    if not offending:
        return base
    return base.failed(
        f"{target_object} declares prohibited personal-data column(s): "
        f"{', '.join(offending)}. ARPI must never generate personal data.",
        failed_record_count=len(offending),
    )


def skipped_check(
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    reason: str,
    check_category: str = CHECK_CATEGORY_STRUCTURAL,
    severity: CheckSeverity = CheckSeverity.INFO,
) -> CheckResult:
    """Build a ``skipped`` result for a check that could not be evaluated.

    Args:
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check would have applied to.
        reason: Why the check was not evaluated.
        check_category: Category constant.
        severity: Severity to record.

    Returns:
        A :class:`CheckResult` with ``status`` set to ``skipped``.
    """
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        status=CheckStatus.SKIPPED,
        check_category=check_category,
        message=reason,
    )
