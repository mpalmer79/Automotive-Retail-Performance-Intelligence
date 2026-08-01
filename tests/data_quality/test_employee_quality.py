"""Data-quality assertions over the generated employee dimension.

The privacy assertions in this module are the highest-value tests in the file. They
inspect the **schema**, not the values, so a prohibited column fails the run even when it
is entirely empty.
"""

from __future__ import annotations

import pandas as pd
import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import SENTINEL_EXPIRATION_DATE
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import (
    ALLOWED_DEPARTMENTS,
    DEPARTMENT_SALES,
    DIM_EMPLOYEE_COLUMNS,
    DIM_EMPLOYEE_REQUIRED_COLUMNS,
    EMPLOYEE_CHECK_IDS,
    EMPLOYEE_HEADCOUNT_BOUNDS,
    JOB_ROLE_SALESPERSON,
    LATENT_PARAMETER_COLUMN_TOKENS,
    employee_headcount,
    employee_performance_profiles,
    generate_employee_dataset,
    validate_employee_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered
from arpi.validation.results import CheckResult

pytestmark = pytest.mark.data_quality

#: The prohibited vocabulary spelled out verbatim, so that a future refactor of the shared
#: privacy module cannot silently narrow what this entity is checked against.
PROHIBITED_COLUMN_NAMES = (
    "name",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "address",
    "street_address",
    "ssn",
    "social_security_number",
    "date_of_birth",
    "dob",
    "drivers_license",
    "bank_account",
    "credit_card",
    "credit_score",
    "salary",
    "compensation",
    "commission",
    "pay_plan",
    "race",
    "ethnicity",
    "gender",
    "religion",
    "marital_status",
    "veteran_status",
    "notes",
    "comments",
)


@pytest.fixture
def employee_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_employee`` dataset for the ``test`` profile."""
    return generate_employee_dataset(test_config)


@pytest.fixture
def development_employee_dataset(development_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_employee`` dataset for the ``development`` profile."""
    return generate_employee_dataset(development_config)


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(
    employee_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in employee_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_the_column_set_is_exactly_the_contract(employee_dataset: GeneratedDataset) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(employee_dataset.actual_columns) == set(DIM_EMPLOYEE_COLUMNS)


def test_no_latent_performance_parameter_leaked_into_the_dimension(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A scorecard built on the generator's own skill parameter would be circular."""
    columns = {str(column).lower() for column in employee_dataset.frame.columns}
    for token in LATENT_PARAMETER_COLUMN_TOKENS:
        assert not any(token in column for column in columns)

    profile_fields = {
        "volume_index",
        "closing_rate_index",
        "gross_retention_index",
        "crm_discipline_index",
    }
    assert profile_fields.isdisjoint(columns)
    assert employee_performance_profiles(test_config), "the parameters must still exist"


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-EMP-005")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(employee_dataset: GeneratedDataset) -> None:
    assert employee_dataset.actual_columns == DIM_EMPLOYEE_COLUMNS
    assert len(DIM_EMPLOYEE_COLUMNS) == 15


def test_required_columns_are_never_null(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    for column in DIM_EMPLOYEE_REQUIRED_COLUMNS:
        assert not frame[column].isna().any(), column


def test_termination_date_is_the_only_nullable_column(
    employee_dataset: GeneratedDataset,
) -> None:
    nullable = {
        column for column in DIM_EMPLOYEE_COLUMNS if column not in DIM_EMPLOYEE_REQUIRED_COLUMNS
    }
    assert nullable == {"termination_date"}


# --------------------------------------------------------------------------------------
# Scale and distribution
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("profile", ["test", "development"])
def test_headcount_is_within_the_configured_bounds(profile: str) -> None:
    config = load_config(profile=profile)
    frame = generate_employee_dataset(config).frame
    minimum, maximum = EMPLOYEE_HEADCOUNT_BOUNDS[profile]
    headcount = int(frame["employee_id"].nunique())
    assert minimum <= headcount <= maximum
    assert headcount == employee_headcount(config)


def test_every_store_is_staffed(employee_dataset: GeneratedDataset) -> None:
    current = employee_dataset.frame.loc[employee_dataset.frame["is_current"]]
    assert set(current["dealership_id"].tolist()) == {"GSA-001", "GSA-002", "GSA-003"}


def test_the_independent_store_has_the_smallest_roster(
    development_employee_dataset: GeneratedDataset,
) -> None:
    current = development_employee_dataset.frame.loc[
        development_employee_dataset.frame["is_current"]
    ]
    counts = current["dealership_id"].value_counts()
    assert counts["GSA-003"] < counts["GSA-002"]
    assert counts["GSA-003"] < counts["GSA-001"]


def test_the_independent_store_is_sales_weighted(
    development_employee_dataset: GeneratedDataset,
) -> None:
    current = development_employee_dataset.frame.loc[
        development_employee_dataset.frame["is_current"]
    ]
    shares = {
        dealership_id: float((group["job_role"] == JOB_ROLE_SALESPERSON).mean())
        for dealership_id, group in current.groupby("dealership_id")
    }
    assert shares["GSA-003"] > shares["GSA-001"]
    assert shares["GSA-003"] > shares["GSA-002"]


def test_every_declared_department_is_staffed_at_development_scale(
    development_employee_dataset: GeneratedDataset,
) -> None:
    current = development_employee_dataset.frame.loc[
        development_employee_dataset.frame["is_current"]
    ]
    assert set(current["department"].tolist()) == set(ALLOWED_DEPARTMENTS)


def test_sales_is_the_largest_department(
    development_employee_dataset: GeneratedDataset,
) -> None:
    current = development_employee_dataset.frame.loc[
        development_employee_dataset.frame["is_current"]
    ]
    counts = current["department"].value_counts()
    assert counts.idxmax() == DEPARTMENT_SALES


def test_the_roster_is_not_all_managers(
    development_employee_dataset: GeneratedDataset,
) -> None:
    current = development_employee_dataset.frame.loc[
        development_employee_dataset.frame["is_current"]
    ]
    assert 0.0 < float(current["is_manager"].mean()) < 0.5


def test_tenure_is_not_uniform(development_employee_dataset: GeneratedDataset) -> None:
    bands = development_employee_dataset.frame["tenure_band"].nunique()
    assert bands >= 3


# --------------------------------------------------------------------------------------
# SCD Type 2 coverage
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("profile", ["test", "development"])
def test_at_least_three_employees_have_two_or_more_versions(profile: str) -> None:
    """The SCD2 load path must be exercised by real data, not only by unit tests."""
    frame = generate_employee_dataset(load_config(profile=profile)).frame
    versions = frame.groupby("employee_id").size()
    assert int((versions >= 2).sum()) >= 3


def test_a_terminated_employee_population_exists(
    development_employee_dataset: GeneratedDataset,
) -> None:
    frame = development_employee_dataset.frame
    current = frame.loc[frame["is_current"]]
    terminated = int(current["termination_date"].notna().sum())
    assert 0 < terminated < len(current)


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_generating_employees_does_not_perturb_any_other_entity(
    test_config: ArpiConfig,
) -> None:
    """One namespace per entity: adding an entity must never move another's digest."""
    before = {
        "dim_date": content_digest(
            dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
        ),
        "dim_dealership": content_digest(
            dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
        ),
        "dim_customer": content_digest(
            dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
        ),
    }
    generate_employee_dataset(test_config)
    after = {
        "dim_date": content_digest(
            dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
        ),
        "dim_dealership": content_digest(
            dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
        ),
        "dim_customer": content_digest(
            dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
        ),
    }
    assert before == after


def test_the_employee_digest_is_stable_across_reruns(test_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_employee_dataset(employee_dataset, test_config)
    failures = [result for result in report.results if result.is_failure]
    assert not failures, [result.message for result in failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_employee_dataset(employee_dataset, test_config)
    emitted = [result.check_id for result in report.results]
    assert emitted == list(EMPLOYEE_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    for result in validate_employee_dataset(employee_dataset, test_config).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id


def test_the_gating_suite_fails_when_a_prohibited_column_appears(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The tripwire has to actually trip, so assert the failure rather than the pass."""
    tampered = employee_dataset.frame.copy()
    tampered["commission_rate"] = 0.0
    dataset = GeneratedDataset(
        entity_name=employee_dataset.entity_name,
        frame=tampered,
        declared_columns=employee_dataset.declared_columns,
        namespace=employee_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_employee_dataset(dataset, test_config).results
    }
    assert results["DQ-EMP-005"].is_failure


def test_the_gating_suite_fails_when_a_latent_parameter_appears(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = employee_dataset.frame.copy()
    tampered["volume_index"] = 1.0
    dataset = GeneratedDataset(
        entity_name=employee_dataset.entity_name,
        frame=tampered,
        declared_columns=employee_dataset.declared_columns,
        namespace=employee_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_employee_dataset(dataset, test_config).results
    }
    assert results["DQ-EMP-005"].is_failure


def test_the_gating_suite_fails_on_a_tampered_hash(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    tampered = employee_dataset.frame.copy()
    tampered.loc[tampered.index[0], "attribute_hash"] = "0" * 64
    dataset = GeneratedDataset(
        entity_name=employee_dataset.entity_name,
        frame=tampered,
        declared_columns=employee_dataset.declared_columns,
        namespace=employee_dataset.namespace,
    )
    results = {
        result.check_id: result
        for result in validate_employee_dataset(dataset, test_config).results
    }
    assert results["DQ-EMP-008"].is_failure


def _tampered(dataset: GeneratedDataset, frame: pd.DataFrame) -> GeneratedDataset:
    """Wrap a deliberately broken frame so the gating suite can be run against it."""
    return GeneratedDataset(
        entity_name=dataset.entity_name,
        frame=frame,
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )


def _results(dataset: GeneratedDataset, config: ArpiConfig) -> dict[str, CheckResult]:
    return {
        result.check_id: result for result in validate_employee_dataset(dataset, config).results
    }


def test_the_gating_suite_fails_on_a_duplicate_version(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame
    duplicated = pd.concat([frame, frame.head(1)], ignore_index=True)
    results = _results(_tampered(employee_dataset, duplicated), test_config)
    assert results["DQ-EMP-001"].is_failure


def test_the_gating_suite_fails_on_a_second_current_row(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame.copy()
    frame.loc[frame.index[0], "is_current"] = True
    frame.loc[frame.index[0], "expiration_date"] = pd.Timestamp(SENTINEL_EXPIRATION_DATE)
    frame.loc[frame.index[0], "employee_id"] = frame.iloc[1]["employee_id"]
    results = _results(_tampered(employee_dataset, frame), test_config)
    assert results["DQ-EMP-002"].is_failure


def test_the_gating_suite_fails_on_a_gap_between_versions(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame.copy()
    historical = frame.index[~frame["is_current"]][0]
    frame.loc[historical, "expiration_date"] = frame.loc[
        historical, "expiration_date"
    ] - pd.Timedelta(days=5)
    results = _results(_tampered(employee_dataset, frame), test_config)
    assert results["DQ-EMP-003"].is_failure


def test_the_gating_suite_fails_on_a_termination_before_the_hire(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame.copy()
    frame.loc[frame.index[0], "termination_date"] = frame.loc[
        frame.index[0], "hire_date"
    ] - pd.Timedelta(days=1)
    frame.loc[frame.index[0], "is_active"] = False
    results = _results(_tampered(employee_dataset, frame), test_config)
    assert results["DQ-EMP-006"].is_failure


def test_the_gating_suite_fails_when_the_headcount_drifts(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame.copy()
    frame = frame.loc[frame["employee_id"] != frame.iloc[0]["employee_id"]]
    results = _results(_tampered(employee_dataset, frame), test_config)
    assert results["DQ-EMP-007"].is_failure


def test_the_gating_suite_fails_on_an_out_of_domain_enumeration(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame.copy()
    frame.loc[frame.index[0], "job_role"] = "Lot Porter"
    results = _results(_tampered(employee_dataset, frame), test_config)
    assert results["DQ-EMP-009"].is_failure


# --------------------------------------------------------------------------------------
# The year-9999 sentinel and DQ-EMP-003
# --------------------------------------------------------------------------------------
#
# `expiration_date` carries a 9999-12-31 sentinel on the current row. `pandas.Timedelta`
# is nanosecond-based and the nanosecond range ends at 2262-04-11, so
# `Timestamp("9999-12-31") + Timedelta(days=1)` is unrepresentable. DQ-EMP-003 used to do
# exactly that while walking adjacent versions, and whether it raised
# `OutOfBoundsDatetime` or silently widened depended on the installed pandas version:
#
#   pandas 2.2.3  -> OutOfBoundsDatetime: Cannot cast 9999-12-31 00:00:00 to unit='ns'
#   pandas 3.0.5  -> 10000-01-01 00:00:00
#
# A gating validator crashing on invalid input is worse than one reporting it, and a
# gating validator whose behaviour depends on an unpinned transitive version is worse
# still. The check now compares the sentinel instead of doing arithmetic on it.


def _employee_with_two_versions(
    employee_dataset: GeneratedDataset,
) -> tuple[pd.DataFrame, str]:
    """Return the frame and an employee_id that genuinely has more than one version."""
    frame = employee_dataset.frame.copy()
    counts = frame.groupby("employee_id").size()
    multi = counts[counts > 1]
    assert not multi.empty, "the fixture must contain at least one multi-version employee"
    return frame, str(multi.index[0])


def test_an_open_ended_row_followed_by_another_version_fails_rather_than_raising(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The exact shape that used to raise OutOfBoundsDatetime.

    An earlier version carrying the open-ended sentinel is invalid history: only the last
    version may be open-ended. It must come back as a failed check, deterministically,
    with the offending employee named -- not as an exception from inside pandas.
    """
    frame, employee_id = _employee_with_two_versions(employee_dataset)
    rows = frame.index[frame["employee_id"] == employee_id]
    # Give the FIRST of this person's versions the open-ended sentinel, so a later
    # version follows a row that has no end.
    frame.loc[rows[0], "expiration_date"] = pd.Timestamp(SENTINEL_EXPIRATION_DATE)

    results = _results(_tampered(employee_dataset, frame), test_config)

    outcome = results["DQ-EMP-003"]
    assert outcome.is_failure
    assert employee_id in (outcome.message or ""), (
        "a continuity failure must name the employee it is about"
    )


def test_the_whole_suite_still_runs_when_one_employee_has_invalid_history(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """One invalid record must not stop the other checks from being evaluated.

    A validator that raises takes the rest of the gating suite down with it, so the run
    reports one exception instead of a full set of results.
    """
    frame, employee_id = _employee_with_two_versions(employee_dataset)
    rows = frame.index[frame["employee_id"] == employee_id]
    frame.loc[rows[0], "expiration_date"] = pd.Timestamp(SENTINEL_EXPIRATION_DATE)

    results = _results(_tampered(employee_dataset, frame), test_config)

    assert set(results) == set(EMPLOYEE_CHECK_IDS), (
        "every registered employee check must still produce a result"
    )
    assert results["DQ-EMP-005"].is_failure is False, (
        "an unrelated privacy check must be unaffected by invalid history"
    )


def test_several_employees_with_invalid_history_are_all_counted(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The result is structured: a count, not merely a boolean."""
    frame = employee_dataset.frame.copy()
    counts = frame.groupby("employee_id").size()
    multi = [str(value) for value in counts[counts > 1].index[:2]]
    assert len(multi) == 2, "this test needs two multi-version employees"
    for employee_id in multi:
        rows = frame.index[frame["employee_id"] == employee_id]
        frame.loc[rows[0], "expiration_date"] = pd.Timestamp(SENTINEL_EXPIRATION_DATE)

    outcome = _results(_tampered(employee_dataset, frame), test_config)["DQ-EMP-003"]

    assert outcome.is_failure
    assert outcome.failed_record_count >= 2
    for employee_id in multi:
        assert employee_id in (outcome.message or "")


def test_a_valid_open_ended_current_row_still_passes(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The generated dataset is full of sentinels and must remain valid.

    The correction must not turn "open-ended" into "invalid": the sentinel is only a
    failure when a later version follows it.
    """
    results = _results(employee_dataset, test_config)
    assert results["DQ-EMP-003"].is_failure is False
    assert results["DQ-EMP-002"].is_failure is False

    current = employee_dataset.frame[employee_dataset.frame["is_current"]]
    assert (current["expiration_date"] == pd.Timestamp(SENTINEL_EXPIRATION_DATE)).all()


def test_a_closed_version_boundary_is_still_checked_exactly(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """Ordinary contiguity is unchanged: one day off is still a failure.

    Guards the opposite error from the sentinel fix -- converting to Python dates must not
    make the day comparison looser.
    """
    frame, employee_id = _employee_with_two_versions(employee_dataset)
    rows = frame.index[frame["employee_id"] == employee_id]
    frame.loc[rows[0], "expiration_date"] = frame.loc[rows[0], "expiration_date"] - pd.Timedelta(
        days=1
    )

    outcome = _results(_tampered(employee_dataset, frame), test_config)["DQ-EMP-003"]

    assert outcome.is_failure
    assert employee_id in (outcome.message or "")


def test_the_continuity_check_is_deterministic(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """Two evaluations of the same invalid frame produce the same result."""
    frame, employee_id = _employee_with_two_versions(employee_dataset)
    rows = frame.index[frame["employee_id"] == employee_id]
    frame.loc[rows[0], "expiration_date"] = pd.Timestamp(SENTINEL_EXPIRATION_DATE)
    tampered = _tampered(employee_dataset, frame)

    first = _results(tampered, test_config)["DQ-EMP-003"]
    second = _results(tampered, test_config)["DQ-EMP-003"]

    assert first.message == second.message
    assert first.failed_record_count == second.failed_record_count
    assert first.observed_value == second.observed_value


def test_a_missing_expiration_date_is_reported_rather_than_raising(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """An unusable date is invalid data, not a crash.

    NaT reaching date arithmetic is the other way this check could raise. It is a data
    problem, so it comes back as a failed check.
    """
    frame, employee_id = _employee_with_two_versions(employee_dataset)
    rows = frame.index[frame["employee_id"] == employee_id]
    frame.loc[rows[0], "expiration_date"] = pd.NaT

    outcome = _results(_tampered(employee_dataset, frame), test_config)["DQ-EMP-003"]

    assert outcome.is_failure
    assert employee_id in (outcome.message or "")
