"""Reusable checks, result types and the dataset suites."""

from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd
import pytest

from arpi.config import ArpiConfig
from arpi.constants import (
    CHECK_CATEGORIES,
    CHECK_DATE_SELLING_DAY_RATIO,
    CHECK_DEALERSHIP_FRANCHISE_BRAND,
    CHECK_GENERATION_DETERMINISM_DIGEST,
    CHECK_GENERATION_SCHEMA_MATCHES,
)
from arpi.generation.base import GeneratedDataset
from arpi.validation.checks import (
    check_column_schema,
    check_contiguous_date_range,
    check_no_prohibited_pii_columns,
    check_non_null_columns,
    check_ratio_within_bounds,
    check_unique_column,
    check_values_in_allowed_set,
    skipped_check,
)
from arpi.validation.datasets import (
    ensure_registry_coverage,
    validate_date_dataset,
    validate_dealership_dataset,
    validate_foundation_datasets,
    validate_generation,
)
from arpi.validation.registry import expected_check_ids
from arpi.validation.results import CheckResult, CheckSeverity, CheckStatus, ValidationReport

ARGS: dict[str, Any] = {
    "check_id": "DQ-TEST-001",
    "check_name": "demo",
    "target_object": "demo_entity",
}


def test_check_unique_column_passes() -> None:
    frame = pd.DataFrame({"k": [1, 2, 3]})
    result = check_unique_column(frame, "k", **ARGS)
    assert result.status is CheckStatus.PASSED
    assert result.observed_value == 3
    assert result.expected_value == 3


def test_check_unique_column_reports_duplicates() -> None:
    result = check_unique_column(pd.DataFrame({"k": [1, 1, 2]}), "k", **ARGS)
    assert result.is_failure
    assert result.failed_record_count == 1
    assert "duplicate" in (result.message or "")


def test_check_unique_column_reports_a_missing_column() -> None:
    result = check_unique_column(pd.DataFrame({"other": [1]}), "k", **ARGS)
    assert result.is_failure
    assert "missing" in (result.message or "")


def test_check_non_null_columns() -> None:
    frame = pd.DataFrame({"a": [1, 2], "b": ["x", None]})
    assert check_non_null_columns(frame, ["a"], **ARGS).status is CheckStatus.PASSED
    failure = check_non_null_columns(frame, ["a", "b"], **ARGS)
    assert failure.is_failure
    assert failure.failed_record_count == 1
    assert "b=1" in (failure.message or "")


def test_check_non_null_columns_reports_absent_columns() -> None:
    result = check_non_null_columns(pd.DataFrame({"a": [1]}), ["a", "zz"], **ARGS)
    assert result.is_failure
    assert "zz" in (result.message or "")


def test_check_column_schema_detects_order_and_membership() -> None:
    frame = pd.DataFrame({"a": [1], "b": [2]})
    assert check_column_schema(frame, ["a", "b"], **ARGS).status is CheckStatus.PASSED

    reordered = check_column_schema(frame, ["b", "a"], **ARGS)
    assert reordered.is_failure
    assert "wrong order" in (reordered.message or "")

    mismatched = check_column_schema(frame, ["a", "c"], **ARGS)
    assert mismatched.is_failure
    assert "missing=['c']" in (mismatched.message or "")
    assert "unexpected=['b']" in (mismatched.message or "")


def test_check_values_in_allowed_set() -> None:
    frame = pd.DataFrame({"t": ["x", "y", None]})
    assert check_values_in_allowed_set(frame, "t", {"x", "y"}, **ARGS).status is CheckStatus.PASSED
    failure = check_values_in_allowed_set(frame, "t", {"x"}, **ARGS)
    assert failure.is_failure
    assert "y" in (failure.message or "")


def test_check_values_in_allowed_set_reports_a_missing_column() -> None:
    assert check_values_in_allowed_set(pd.DataFrame({"a": [1]}), "t", {"x"}, **ARGS).is_failure


def test_check_contiguous_date_range() -> None:
    frame = pd.DataFrame({"d": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-03"])})
    passed = check_contiguous_date_range(frame, "d", date(2025, 1, 1), date(2025, 1, 3), **ARGS)
    assert passed.status is CheckStatus.PASSED
    assert passed.observed_value == 3


def test_check_contiguous_date_range_detects_gaps_and_extras() -> None:
    frame = pd.DataFrame({"d": pd.to_datetime(["2025-01-01", "2025-01-03", "2025-02-01"])})
    result = check_contiguous_date_range(frame, "d", date(2025, 1, 1), date(2025, 1, 3), **ARGS)
    assert result.is_failure
    assert "missing date(s)" in (result.message or "")
    assert "unexpected date(s)" in (result.message or "")


def test_check_contiguous_date_range_reports_a_missing_column() -> None:
    result = check_contiguous_date_range(
        pd.DataFrame({"x": [1]}), "d", date(2025, 1, 1), date(2025, 1, 1), **ARGS
    )
    assert result.is_failure


def test_check_ratio_within_bounds() -> None:
    assert check_ratio_within_bounds(0.9, 0.8, 1.0, **ARGS).status is CheckStatus.PASSED
    low = check_ratio_within_bounds(0.5, 0.8, 1.0, **ARGS)
    assert low.is_failure
    assert low.severity is CheckSeverity.WARNING
    assert "0.5000" in (low.message or "")


def test_check_no_prohibited_pii_columns() -> None:
    assert check_no_prohibited_pii_columns(pd.DataFrame({"city": ["Nashua"]}), **ARGS).status is (
        CheckStatus.PASSED
    )
    failure = check_no_prohibited_pii_columns(pd.DataFrame({"Email": ["a"], "ssn": ["b"]}), **ARGS)
    assert failure.is_failure
    assert failure.failed_record_count == 2
    assert "Email" in (failure.message or "")


@pytest.mark.parametrize(
    "column",
    [
        "email",
        "customer_email",
        "contact_email_address",
        "customer_phone",
        "home_phone_number",
        "customer_ssn",
        "buyer_first_name",
        "salesperson_name",
        "employee_home_address",
        "annual_salary",
        "credit_score",
        "postal_code",
        "name",
    ],
)
def test_prohibited_pii_columns_are_caught_with_realistic_prefixes(column: str) -> None:
    """Qualified personal-data columns must fail, not just their bare forms.

    Exact-name matching used to accept ``customer_email`` and ``buyer_first_name``, which
    are exactly the shapes the Phase 1 customer and employee entities will introduce.
    """
    result = check_no_prohibited_pii_columns(pd.DataFrame({column: ["x"]}), **ARGS)
    assert result.is_failure, f"{column!r} should be rejected as personal data"


@pytest.mark.parametrize(
    "column",
    [
        "day_name",
        "month_name",
        "quarter_name",
        "holiday_name",
        "store_name",
        "store_short_name",
        "check_name",
        "entity_name",
        "market_region",
        "state_code",
        "dealership_id",
        "is_selling_day",
    ],
)
def test_legitimate_descriptive_columns_are_not_flagged(column: str) -> None:
    """Descriptive label columns must pass; only person-name columns are prohibited."""
    result = check_no_prohibited_pii_columns(pd.DataFrame({column: ["x"]}), **ARGS)
    assert result.status is CheckStatus.PASSED, f"{column!r} was wrongly flagged"


def test_skipped_check() -> None:
    result = skipped_check(**ARGS, reason="no database")
    assert result.status is CheckStatus.SKIPPED
    assert result.message == "no database"


def test_check_result_audit_row_shape() -> None:
    row = CheckResult(**ARGS).as_audit_row()
    assert set(row) == {
        "check_id",
        "check_name",
        "check_category",
        "target_object",
        "severity",
        "status",
        "observed_value",
        "expected_value",
        "failed_record_count",
        "message",
    }
    assert row["severity"] == "critical"
    assert row["status"] == "passed"


def test_report_partitions_results() -> None:
    passed = CheckResult(**ARGS)
    critical = CheckResult(**ARGS).failed("boom")
    warning = CheckResult(**ARGS, severity=CheckSeverity.WARNING).failed("meh")
    skipped = skipped_check(**ARGS, reason="n/a")
    report = ValidationReport((passed, critical, warning, skipped))

    assert len(report) == 4
    assert report.passed == (passed,)
    assert report.critical_failures == (critical,)
    assert report.warnings == (warning,)
    assert report.skipped == (skipped,)
    assert report.has_critical_failure is True


def test_report_combine_preserves_order() -> None:
    first = ValidationReport((CheckResult(**{**ARGS, "check_id": "A"}),))
    second = ValidationReport((CheckResult(**{**ARGS, "check_id": "B"}),))
    combined = ValidationReport.combine(first, second)
    assert [result.check_id for result in combined.results] == ["A", "B"]


def test_summary_table_of_an_empty_report() -> None:
    assert ValidationReport().summary_table() == "No data-quality checks were evaluated."
    assert ValidationReport().has_critical_failure is False


def test_summary_table_renders_a_tally() -> None:
    report = ValidationReport((CheckResult(**ARGS), CheckResult(**ARGS).failed("boom")))
    table = report.summary_table()
    assert "CHECK ID" in table
    assert "PASSED" in table
    assert "FAILED" in table
    assert "1 passed, 1 critical failure(s), 0 warning(s), 0 info failure(s), 0 skipped." in table


def test_the_tally_accounts_for_every_result() -> None:
    """A result counted in no bucket would read as though the report were clean."""
    report = ValidationReport(
        (
            CheckResult(**ARGS),
            CheckResult(**ARGS).failed("critical"),
            CheckResult(**ARGS, severity=CheckSeverity.WARNING).failed("warning"),
            CheckResult(**ARGS, severity=CheckSeverity.INFO).failed("info"),
            skipped_check(**ARGS, reason="n/a"),
        )
    )
    buckets = (
        report.passed,
        report.critical_failures,
        report.warnings,
        report.info_failures,
        report.skipped,
    )
    assert sum(len(bucket) for bucket in buckets) == len(report)
    assert len(report.failures) == 3
    assert "1 passed, 1 critical failure(s), 1 warning(s), 1 info failure(s), 1 skipped." in (
        report.summary_table()
    )


def test_report_audit_rows(date_dataset: GeneratedDataset, test_config: ArpiConfig) -> None:
    rows = validate_date_dataset(date_dataset, test_config).as_audit_rows()
    assert len(rows) == 5
    assert all("check_id" in row for row in rows)


def test_date_suite_ids(date_dataset: GeneratedDataset, test_config: ArpiConfig) -> None:
    report = validate_date_dataset(date_dataset, test_config)
    assert [result.check_id for result in report.results] == [
        "DQ-DATE-001",
        "DQ-DATE-002",
        "DQ-DATE-003",
        "DQ-DATE-004",
        "DQ-DATE-005",
    ]
    assert not report.has_critical_failure


def test_dealership_suite_ids(
    dealership_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_dealership_dataset(dealership_dataset, test_config)
    assert [result.check_id for result in report.results] == [
        "DQ-DLR-001",
        "DQ-DLR-002",
        "DQ-DLR-003",
        "DQ-DLR-004",
        "DQ-DLR-005",
    ]
    assert not report.has_critical_failure


def test_generation_suite_ids(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    report = validate_generation((date_dataset, dealership_dataset), test_config)
    assert [result.check_id for result in report.results] == [
        CHECK_GENERATION_SCHEMA_MATCHES,
        CHECK_GENERATION_SCHEMA_MATCHES,
        CHECK_GENERATION_DETERMINISM_DIGEST,
    ]
    digest = report.results[-1]
    assert digest.severity is CheckSeverity.INFO
    assert "dim_date=" in (digest.message or "")


def test_generation_suite_with_no_datasets(test_config: ArpiConfig) -> None:
    report = validate_generation((), test_config)
    assert report.results[-1].message == "no entities generated"


def test_full_suite_has_thirteen_results(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    assert len(report) == 13
    assert not report.has_critical_failure
    assert not report.warnings


def test_date_key_mismatch_is_caught(
    date_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = date_dataset.frame.copy()
    frame.loc[frame.index[0], "date_key"] = 19700101
    broken = GeneratedDataset("dim_date", frame, date_dataset.declared_columns, "dim_date")
    report = validate_date_dataset(broken, test_config)
    failed = next(r for r in report.results if r.check_id == "DQ-DATE-003")
    assert failed.is_failure
    assert failed.failed_record_count == 1


def test_date_key_check_needs_both_columns(test_config: ArpiConfig) -> None:
    dataset = GeneratedDataset("dim_date", pd.DataFrame({"date_key": [1]}), ("date_key",), "n")
    report = validate_date_dataset(dataset, test_config)
    assert next(r for r in report.results if r.check_id == "DQ-DATE-003").is_failure


def test_selling_day_ratio_on_an_empty_frame(test_config: ArpiConfig) -> None:
    dataset = GeneratedDataset("dim_date", pd.DataFrame(), (), "dim_date")
    report = validate_date_dataset(dataset, test_config)
    ratio = next(r for r in report.results if r.check_id == CHECK_DATE_SELLING_DAY_RATIO)
    assert ratio.is_failure
    assert "Cannot compute" in (ratio.message or "")


def test_store_count_mismatch_is_caught(
    dealership_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = dealership_dataset.frame.head(2)
    dataset = GeneratedDataset(
        "dim_dealership", frame, dealership_dataset.declared_columns, "dim_dealership"
    )
    report = validate_dealership_dataset(dataset, test_config)
    failed = next(r for r in report.results if r.check_id == "DQ-DLR-003")
    assert failed.is_failure
    assert failed.observed_value == 2
    assert failed.expected_value == 3


def test_missing_franchise_brand_is_caught(
    dealership_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = dealership_dataset.frame.copy()
    frame.loc[frame.index[0], "franchise_brand"] = None
    dataset = GeneratedDataset(
        "dim_dealership", frame, dealership_dataset.declared_columns, "dim_dealership"
    )
    report = validate_dealership_dataset(dataset, test_config)
    failed = next(r for r in report.results if r.check_id == CHECK_DEALERSHIP_FRANCHISE_BRAND)
    assert failed.is_failure
    assert failed.failed_record_count == 1


def test_unexpected_store_type_is_caught(
    dealership_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = dealership_dataset.frame.copy()
    frame.loc[frame.index[0], "store_type"] = "Motorcycle Boutique"
    dataset = GeneratedDataset(
        "dim_dealership", frame, dealership_dataset.declared_columns, "dim_dealership"
    )
    failed = next(
        r
        for r in validate_dealership_dataset(dataset, test_config).results
        if r.check_id == CHECK_DEALERSHIP_FRANCHISE_BRAND
    )
    assert failed.is_failure
    assert "Motorcycle Boutique" in (failed.message or "")


def test_franchise_brand_check_needs_both_columns(test_config: ArpiConfig) -> None:
    dataset = GeneratedDataset(
        "dim_dealership", pd.DataFrame({"dealership_key": [1]}), ("dealership_key",), "n"
    )
    failed = next(
        r
        for r in validate_dealership_dataset(dataset, test_config).results
        if r.check_id == CHECK_DEALERSHIP_FRANCHISE_BRAND
    )
    assert failed.is_failure


def test_selling_day_ratio_outside_the_band_is_a_warning(
    date_dataset: GeneratedDataset, repo_config_dir: object
) -> None:
    from arpi.config import load_config

    config = load_config(
        profile="test",
        config_dir=repo_config_dir,  # type: ignore[arg-type]
        env={"ARPI_VALIDATION__MIN_SELLING_DAY_RATIO": "0.999"},
    )
    ratio = next(
        r
        for r in validate_date_dataset(date_dataset, config).results
        if r.check_id == CHECK_DATE_SELLING_DAY_RATIO
    )
    assert ratio.is_failure
    assert ratio.severity is CheckSeverity.WARNING


def test_every_emitted_category_is_canonical(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """DOC-24: one vocabulary, enforced, rather than four described."""
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    for result in report.results:
        assert result.check_category in CHECK_CATEGORIES, (
            f"{result.check_id} emitted the non-canonical category {result.check_category!r}"
        )


def test_the_categories_actually_used_span_the_taxonomy(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """A taxonomy nothing uses is a taxonomy nobody maintains."""
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    used = {result.check_category for result in report.results}
    assert used == {
        "uniqueness",
        "completeness",
        "business_rule",
        "privacy",
        "structural",
        "reproducibility",
    }, "referential is SQL-only in Phase 0; every other category must be exercised"


def test_a_critical_failure_reaches_the_report(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """No suite may swallow a critical failure on its way to the run's verdict."""
    frame = date_dataset.frame.copy()
    frame.loc[frame.index[0], "date_key"] = 19700101
    broken = GeneratedDataset("dim_date", frame, date_dataset.declared_columns, "dim_date")

    report = validate_foundation_datasets(broken, dealership_dataset, test_config)

    assert report.has_critical_failure
    assert [result.check_id for result in report.critical_failures] == ["DQ-DATE-003"]


def test_a_prohibited_column_is_a_critical_failure_of_the_whole_run(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """The privacy tripwire must fail the run, not warn and continue."""
    frame = dealership_dataset.frame.copy()
    frame["owner_email"] = "someone@example.com"
    broken = GeneratedDataset(
        "dim_dealership",
        frame,
        (*dealership_dataset.declared_columns, "owner_email"),
        "dim_dealership",
    )

    report = validate_foundation_datasets(date_dataset, broken, test_config)

    failure = next(r for r in report.critical_failures if r.check_id == "DQ-DLR-004")
    assert failure.check_category == "privacy"
    assert failure.severity is CheckSeverity.CRITICAL
    assert report.has_critical_failure


def test_ensure_registry_coverage_leaves_a_complete_report_alone(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    assert ensure_registry_coverage(report, entities=("dim_date", "dim_dealership")) is report, (
        "a complete report must be returned unchanged, not rebuilt"
    )


def test_ensure_registry_coverage_fills_a_gap_with_an_honest_skip() -> None:
    """A check that produces no row reads exactly like a passing one, so fill the gap."""
    partial = ValidationReport((CheckResult(**{**ARGS, "check_id": "DQ-DATE-001"}),))

    completed = ensure_registry_coverage(partial, entities=("dim_date",))
    by_id = {result.check_id: result for result in completed.results}

    assert set(by_id) == set(expected_check_ids(entities=("dim_date",))) | {"DQ-DATE-001"}
    filled = by_id["DQ-DATE-002"]
    assert filled.status is CheckStatus.SKIPPED
    assert filled.check_category == "completeness"
    assert filled.severity is CheckSeverity.CRITICAL
    assert "not evaluated by this run" in (filled.message or "")
    assert not completed.has_critical_failure, "a skip is not a failure"


@pytest.mark.parametrize("severity", list(CheckSeverity))
def test_severity_values_are_the_contract_strings(severity: CheckSeverity) -> None:
    assert str(severity) in {"critical", "warning", "info"}


@pytest.mark.parametrize("status", list(CheckStatus))
def test_status_values_are_the_contract_strings(status: CheckStatus) -> None:
    assert str(status) in {"passed", "failed", "skipped"}
