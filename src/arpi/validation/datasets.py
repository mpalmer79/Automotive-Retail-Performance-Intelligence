"""Phase 0 data-quality suites for the two foundation dimensions.

Check identifiers are shared verbatim with the SQL implementations, so a failure can be
traced from a Power BI tile back to a row in ``audit.validation_result`` and forward to
the code that produced it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

from arpi.constants import (
    ALLOWED_STORE_TYPES,
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_REPRODUCIBILITY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_DATE_CONTIGUOUS_RANGE,
    CHECK_DATE_KEY_MATCHES_FULL_DATE,
    CHECK_DATE_NO_NULL_REQUIRED,
    CHECK_DATE_SELLING_DAY_RATIO,
    CHECK_DATE_UNIQUE_KEY,
    CHECK_DEALERSHIP_FRANCHISE_BRAND,
    CHECK_DEALERSHIP_NO_PROHIBITED_PII,
    CHECK_DEALERSHIP_STORE_COUNT,
    CHECK_DEALERSHIP_UNIQUE_ID_CURRENT,
    CHECK_DEALERSHIP_UNIQUE_KEY,
    CHECK_GENERATION_DETERMINISM_DIGEST,
    CHECK_GENERATION_SCHEMA_MATCHES,
    DIM_DATE_REQUIRED_COLUMNS,
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
    STORE_TYPE_FRANCHISE,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.dates import date_key
from arpi.utilities.hashing import content_digest
from arpi.validation.checks import (
    check_column_schema,
    check_contiguous_date_range,
    check_no_prohibited_pii_columns,
    check_non_null_columns,
    check_ratio_within_bounds,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset


def validate_date_dataset(dataset: GeneratedDataset, config: ArpiConfig) -> ValidationReport:
    """Run ``DQ-DATE-001`` through ``DQ-DATE-005`` against the calendar dimension.

    Args:
        dataset: The generated ``dim_date`` dataset.
        config: Resolved configuration supplying the reporting window and the
            selling-day tolerance band.

    Returns:
        A report containing five results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "date_key",
                check_id=CHECK_DATE_UNIQUE_KEY,
                check_name="dim_date.date_key is unique",
                target_object=ENTITY_DIM_DATE,
            ),
            check_contiguous_date_range(
                frame,
                "full_date",
                config.reporting.start_date,
                config.reporting.end_date,
                check_id=CHECK_DATE_CONTIGUOUS_RANGE,
                check_name="dim_date covers the reporting window contiguously",
                target_object=ENTITY_DIM_DATE,
            ),
            _check_date_key_matches_full_date(frame),
            check_non_null_columns(
                frame,
                DIM_DATE_REQUIRED_COLUMNS,
                check_id=CHECK_DATE_NO_NULL_REQUIRED,
                check_name="dim_date required columns are populated",
                target_object=ENTITY_DIM_DATE,
            ),
            _check_selling_day_ratio(frame, config),
        )
    )


def validate_dealership_dataset(
    dataset: GeneratedDataset, config: ArpiConfig
) -> ValidationReport:
    """Run ``DQ-DLR-001`` through ``DQ-DLR-005`` against the dealership dimension.

    Args:
        dataset: The generated ``dim_dealership`` dataset.
        config: Resolved configuration supplying the expected store count.

    Returns:
        A report containing five results, in check-id order.
    """
    frame = dataset.frame
    current = frame[frame["is_current"]] if "is_current" in frame.columns else frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "dealership_key",
                check_id=CHECK_DEALERSHIP_UNIQUE_KEY,
                check_name="dim_dealership.dealership_key is unique",
                target_object=ENTITY_DIM_DEALERSHIP,
            ),
            check_unique_column(
                current,
                "dealership_id",
                check_id=CHECK_DEALERSHIP_UNIQUE_ID_CURRENT,
                check_name="dim_dealership.dealership_id is unique among current rows",
                target_object=ENTITY_DIM_DEALERSHIP,
            ),
            _check_store_count(current, config),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_DEALERSHIP_NO_PROHIBITED_PII,
                check_name="dim_dealership declares no personal-data columns",
                target_object=ENTITY_DIM_DEALERSHIP,
            ),
            _check_franchise_brand(frame),
        )
    )


def validate_generation(
    datasets: Sequence[GeneratedDataset],
    config: ArpiConfig,
) -> ValidationReport:
    """Run the cross-entity generation checks ``DQ-GEN-001`` and ``DQ-GEN-002``.

    ``DQ-GEN-001`` re-asserts that every produced frame matches the column contract it
    declares. ``DQ-GEN-002`` computes and records the SHA-256 digest of each entity's
    canonical CSV rendering, which is the value the manifest publishes and the value a
    reviewer can recompute to prove the run was reproducible.

    Args:
        datasets: Every dataset produced by this run.
        config: Resolved configuration; recorded for message context.

    Returns:
        A report containing one schema result per dataset plus one digest result.
    """
    schema_results = [
        check_column_schema(
            dataset.frame,
            dataset.declared_columns,
            check_id=CHECK_GENERATION_SCHEMA_MATCHES,
            check_name="generated schema matches the declared column contract",
            target_object=dataset.entity_name,
        )
        for dataset in datasets
    ]
    digests = {
        dataset.entity_name: content_digest(dataframe_to_csv_bytes(dataset.frame))
        for dataset in datasets
    }
    rendered = ", ".join(f"{entity}={digest[:12]}..." for entity, digest in sorted(digests.items()))
    digest_result = CheckResult(
        check_id=CHECK_GENERATION_DETERMINISM_DIGEST,
        check_name="determinism digest recorded for every generated entity",
        target_object=f"profile={config.profile}",
        severity=CheckSeverity.INFO,
        check_category=CHECK_CATEGORY_REPRODUCIBILITY,
        observed_value=float(len(digests)),
        expected_value=float(len(datasets)),
        message=f"seed={config.random_seed}; {rendered}" if rendered else "no entities generated",
    )
    return ValidationReport((*schema_results, digest_result))


def validate_foundation_datasets(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    config: ArpiConfig,
) -> ValidationReport:
    """Run every Phase 0 data-quality check.

    Args:
        date_dataset: The generated ``dim_date`` dataset.
        dealership_dataset: The generated ``dim_dealership`` dataset.
        config: Resolved configuration.

    Returns:
        A single combined report.
    """
    return ValidationReport.combine(
        validate_date_dataset(date_dataset, config),
        validate_dealership_dataset(dealership_dataset, config),
        validate_generation((date_dataset, dealership_dataset), config),
    )


def _check_date_key_matches_full_date(frame: pd.DataFrame) -> CheckResult:
    """DQ-DATE-003: every ``date_key`` must be ``YYYYMMDD`` of its ``full_date``."""
    base = CheckResult(
        check_id=CHECK_DATE_KEY_MATCHES_FULL_DATE,
        check_name="dim_date.date_key encodes dim_date.full_date",
        target_object=ENTITY_DIM_DATE,
        check_category=CHECK_CATEGORY_STRUCTURAL,
        expected_value=0.0,
        observed_value=0.0,
    )
    if not {"date_key", "full_date"}.issubset(frame.columns):
        return base.failed(f"{ENTITY_DIM_DATE} is missing date_key and/or full_date.")

    expected = pd.to_datetime(frame["full_date"]).map(lambda value: date_key(value.date()))
    mismatches = int((expected.to_numpy() != frame["date_key"].to_numpy()).sum())
    if mismatches == 0:
        return base
    return base.failed(
        f"{mismatches} row(s) have a date_key that does not encode their full_date.",
        observed_value=float(mismatches),
        failed_record_count=mismatches,
    )


def _check_selling_day_ratio(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """DQ-DATE-005: the share of selling days must sit inside the configured band."""
    total = int(frame.shape[0])
    if total == 0 or "is_selling_day" not in frame.columns:
        return CheckResult(
            check_id=CHECK_DATE_SELLING_DAY_RATIO,
            check_name="dim_date selling-day ratio is within tolerance",
            target_object=ENTITY_DIM_DATE,
            severity=CheckSeverity.WARNING,
            check_category=CHECK_CATEGORY_BUSINESS_RULE,
        ).failed("Cannot compute the selling-day ratio: no rows or no is_selling_day column.")

    selling_days = int(frame["is_selling_day"].sum())
    return check_ratio_within_bounds(
        selling_days / total,
        config.validation.min_selling_day_ratio,
        config.validation.max_selling_day_ratio,
        check_id=CHECK_DATE_SELLING_DAY_RATIO,
        check_name="dim_date selling-day ratio is within tolerance",
        target_object=ENTITY_DIM_DATE,
        severity=CheckSeverity.WARNING,
        description="selling-day ratio",
    )


def _check_store_count(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """DQ-DLR-003: the number of current stores must equal ``generation.store_count``."""
    expected = config.generation.store_count
    observed = int(frame.shape[0])
    base = CheckResult(
        check_id=CHECK_DEALERSHIP_STORE_COUNT,
        check_name="dim_dealership current row count matches configuration",
        target_object=ENTITY_DIM_DEALERSHIP,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        observed_value=float(observed),
        expected_value=float(expected),
    )
    if observed == expected:
        return base
    return base.failed(
        f"Expected {expected} current dealership row(s) from generation.store_count, "
        f"found {observed}.",
        failed_record_count=abs(observed - expected),
    )


def _check_franchise_brand(frame: pd.DataFrame) -> CheckResult:
    """DQ-DLR-005: franchise stores must name a brand; independents must not."""
    base = CheckResult(
        check_id=CHECK_DEALERSHIP_FRANCHISE_BRAND,
        check_name="franchise stores declare a franchise brand",
        target_object=ENTITY_DIM_DEALERSHIP,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        observed_value=0.0,
        expected_value=0.0,
    )
    if not {"store_type", "franchise_brand"}.issubset(frame.columns):
        return base.failed(
            f"{ENTITY_DIM_DEALERSHIP} is missing store_type and/or franchise_brand."
        )

    store_type_result = check_values_in_allowed_set(
        frame,
        "store_type",
        ALLOWED_STORE_TYPES,
        check_id=CHECK_DEALERSHIP_FRANCHISE_BRAND,
        check_name="franchise stores declare a franchise brand",
        target_object=ENTITY_DIM_DEALERSHIP,
    )
    if store_type_result.is_failure:
        return store_type_result

    franchise = frame[frame["store_type"] == STORE_TYPE_FRANCHISE]
    missing_brand = int(franchise["franchise_brand"].isna().sum())
    independent = frame[frame["store_type"] != STORE_TYPE_FRANCHISE]
    unexpected_brand = int(independent["franchise_brand"].notna().sum())
    offending = missing_brand + unexpected_brand
    if offending == 0:
        return base
    return base.failed(
        f"{missing_brand} franchise store(s) have no franchise_brand and "
        f"{unexpected_brand} independent store(s) unexpectedly declare one.",
        observed_value=float(offending),
        failed_record_count=offending,
    )
