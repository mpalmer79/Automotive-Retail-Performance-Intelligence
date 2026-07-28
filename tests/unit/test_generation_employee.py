"""Unit tests for the employee generator and its SCD Type 2 mechanics."""

from __future__ import annotations

import hashlib
import re
from datetime import date, timedelta
from itertools import pairwise
from types import SimpleNamespace
from typing import cast

import pandas as pd
import pytest

from arpi.config import ArpiConfig
from arpi.constants import SENTINEL_EXPIRATION_DATE, SOURCE_SYSTEM
from arpi.exceptions import GenerationError
from arpi.generation.base import GeneratedDataset
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.employee import (
    ALLOWED_DEPARTMENTS,
    ALLOWED_JOB_ROLES,
    ALLOWED_TENURE_BANDS,
    DIM_EMPLOYEE_COLUMNS,
    EMPLOYEE_HASH_COLUMNS,
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SERVICE_ADVISOR,
    LATENT_PARAMETER_COLUMN_TOKENS,
    MANAGER_JOB_ROLES,
    ROLE_DEPARTMENT,
    TENURE_BAND_1_TO_3,
    TENURE_BAND_3_TO_5,
    TENURE_BAND_5_TO_10,
    TENURE_BAND_OVER_10,
    TENURE_BAND_UNDER_1,
    allocate_store_headcount,
    build_employee_assignments,
    department_for_role,
    employee_attribute_hash,
    employee_headcount,
    employee_performance_profiles,
    expand_role_plan,
    generate_employee_dataset,
    is_manager_for_role,
    predecessor_assignment,
    select_by_score,
    tenure_band_for,
)
from arpi.utilities.hashing import hash_attributes

EMPLOYEE_ID_PATTERN = re.compile(r"^EMP-\d{5}$")
STORE_OPENED = {store.dealership_id: store.opened_date for store in STORE_DEFINITIONS}


@pytest.fixture
def employee_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_employee`` dataset for the ``test`` profile."""
    return generate_employee_dataset(test_config)


# --------------------------------------------------------------------------------------
# Identifiers, schema and determinism
# --------------------------------------------------------------------------------------
def test_every_employee_id_matches_the_reserved_scheme(
    employee_dataset: GeneratedDataset,
) -> None:
    identifiers = employee_dataset.frame["employee_id"].tolist()
    assert identifiers
    assert all(EMPLOYEE_ID_PATTERN.match(str(value)) for value in identifiers)


def test_employee_ids_are_a_dense_zero_padded_sequence(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    distinct = sorted(set(employee_dataset.frame["employee_id"].tolist()))
    expected = [f"EMP-{index:05d}" for index in range(1, employee_headcount(test_config) + 1)]
    assert distinct == expected


def test_employee_key_is_a_dense_ordinal_over_the_sorted_frame(
    employee_dataset: GeneratedDataset,
) -> None:
    frame = employee_dataset.frame
    assert frame["employee_key"].tolist() == list(range(1, frame.shape[0] + 1))
    ordered = frame.sort_values(["employee_id", "effective_date"])
    assert ordered["employee_key"].tolist() == frame["employee_key"].tolist()


def test_the_frame_declares_the_contract_columns_in_order(
    employee_dataset: GeneratedDataset,
) -> None:
    assert employee_dataset.actual_columns == DIM_EMPLOYEE_COLUMNS
    assert employee_dataset.schema_matches()


def test_source_system_is_constant(employee_dataset: GeneratedDataset) -> None:
    assert set(employee_dataset.frame["source_system"].tolist()) == {SOURCE_SYSTEM}


def test_generation_is_deterministic(test_config: ArpiConfig) -> None:
    first = generate_employee_dataset(test_config).frame
    second = generate_employee_dataset(test_config).frame
    pd.testing.assert_frame_equal(first, second)


def test_a_different_seed_produces_a_different_roster(test_config: ArpiConfig) -> None:
    other = test_config.model_copy(update={"random_seed": test_config.random_seed + 1})
    assert not generate_employee_dataset(test_config).frame.equals(
        generate_employee_dataset(other).frame
    )


# --------------------------------------------------------------------------------------
# Derived fields are derived, never drawn
# --------------------------------------------------------------------------------------
def test_department_is_derived_from_job_role(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    expected = frame["job_role"].map(ROLE_DEPARTMENT)
    assert (frame["department"] == expected).all()
    assert set(frame["department"].tolist()) <= set(ALLOWED_DEPARTMENTS)
    assert set(frame["job_role"].tolist()) <= set(ALLOWED_JOB_ROLES)


def test_is_manager_is_derived_from_job_role(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    expected = frame["job_role"].isin(MANAGER_JOB_ROLES)
    assert (frame["is_manager"] == expected).all()


@pytest.mark.parametrize(
    ("job_role", "expected"),
    [
        (JOB_ROLE_SALESPERSON, False),
        (JOB_ROLE_BDC_REPRESENTATIVE, False),
        (JOB_ROLE_SERVICE_ADVISOR, False),
        (JOB_ROLE_SALES_MANAGER, True),
        (JOB_ROLE_DESK_MANAGER, True),
        (JOB_ROLE_FINANCE_MANAGER, True),
        (JOB_ROLE_BDC_MANAGER, True),
        (JOB_ROLE_GENERAL_MANAGER, True),
    ],
)
def test_is_manager_for_role(job_role: str, expected: bool) -> None:
    assert is_manager_for_role(job_role) is expected


def test_department_for_role_rejects_an_unknown_role() -> None:
    with pytest.raises(GenerationError, match="outside the declared enumeration"):
        department_for_role("Lot Porter")


def test_tenure_band_is_derived_from_hire_date(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    frame = employee_dataset.frame
    window_end = test_config.reporting.end_date
    for record in frame.to_dict(orient="records"):
        hire_date = pd.Timestamp(record["hire_date"]).date()
        assert record["tenure_band"] == tenure_band_for(hire_date, window_end)
    assert set(frame["tenure_band"].tolist()) <= set(ALLOWED_TENURE_BANDS)


@pytest.mark.parametrize(
    ("days", "expected"),
    [
        (0, TENURE_BAND_UNDER_1),
        (364, TENURE_BAND_UNDER_1),
        (366, TENURE_BAND_1_TO_3),
        (1_000, TENURE_BAND_1_TO_3),
        (1_200, TENURE_BAND_3_TO_5),
        (2_000, TENURE_BAND_5_TO_10),
        (4_000, TENURE_BAND_OVER_10),
    ],
)
def test_tenure_band_boundaries(days: int, expected: str) -> None:
    as_of = date(2025, 12, 31)
    assert tenure_band_for(as_of - timedelta(days=days), as_of) == expected


def test_a_tenure_band_never_goes_negative() -> None:
    as_of = date(2025, 1, 1)
    assert tenure_band_for(as_of + timedelta(days=30), as_of) == TENURE_BAND_UNDER_1


# --------------------------------------------------------------------------------------
# attribute_hash
# --------------------------------------------------------------------------------------
def test_the_documented_hash_payload_is_the_one_that_is_hashed() -> None:
    """The docstring's worked example is the byte-for-byte contract with the SQL merge."""
    payload = "GSA-003|Sales|Salesperson|2021-05-04||true|false"
    expected = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    assert (
        employee_attribute_hash(
            "GSA-003",
            "Sales",
            "Salesperson",
            date(2021, 5, 4),
            None,
            is_active=True,
            is_manager=False,
        )
        == expected
    )


def test_the_tracked_attributes_are_contract_columns_three_to_nine() -> None:
    assert DIM_EMPLOYEE_COLUMNS[2:9] == EMPLOYEE_HASH_COLUMNS


def test_every_row_hash_recomputes_from_its_own_tracked_attributes_only(
    employee_dataset: GeneratedDataset,
) -> None:
    """Untracked columns cannot enter the hash: the recomputation never reads them."""
    for record in employee_dataset.frame.to_dict(orient="records"):
        termination = record["termination_date"]
        tracked = [
            record["dealership_id"],
            record["department"],
            record["job_role"],
            pd.Timestamp(record["hire_date"]).date(),
            None if pd.isna(termination) else pd.Timestamp(termination).date(),
            bool(record["is_active"]),
            bool(record["is_manager"]),
        ]
        assert hash_attributes(tracked) == record["attribute_hash"]


BASELINE_HASH_ARGS: dict[str, object] = {
    "dealership_id": "GSA-001",
    "department": "Sales",
    "job_role": JOB_ROLE_SALESPERSON,
    "hire_date": date(2022, 3, 1),
    "termination_date": None,
    "is_active": True,
    "is_manager": False,
}


def _hash(**overrides: object) -> str:
    merged = {**BASELINE_HASH_ARGS, **overrides}
    return employee_attribute_hash(
        str(merged["dealership_id"]),
        str(merged["department"]),
        str(merged["job_role"]),
        merged["hire_date"],  # type: ignore[arg-type]
        merged["termination_date"],  # type: ignore[arg-type]
        is_active=bool(merged["is_active"]),
        is_manager=bool(merged["is_manager"]),
    )


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("dealership_id", "GSA-002"),
        ("department", "Management"),
        ("job_role", JOB_ROLE_SALES_MANAGER),
        ("hire_date", date(2022, 3, 2)),
        ("termination_date", date(2025, 1, 9)),
        ("is_active", False),
        ("is_manager", True),
    ],
)
def test_changing_a_tracked_attribute_changes_the_hash(field_name: str, value: object) -> None:
    assert _hash(**{field_name: value}) != _hash()


def test_the_hash_is_stable_across_calls() -> None:
    assert _hash() == _hash()


def test_a_null_termination_date_serialises_as_an_empty_token() -> None:
    """The NULL rendering is what the SQL merge must reproduce; assert it explicitly."""
    with_null = _hash(termination_date=None)
    literal_none = hash_attributes(
        [
            "GSA-001",
            "Sales",
            JOB_ROLE_SALESPERSON,
            date(2022, 3, 1),
            "",
            True,
            False,
        ]
    )
    assert with_null == literal_none


# --------------------------------------------------------------------------------------
# SCD Type 2 mechanics
# --------------------------------------------------------------------------------------
def test_exactly_one_current_row_per_employee(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    current_counts = frame.groupby("employee_id")["is_current"].sum()
    assert set(current_counts.tolist()) == {1}


def test_current_rows_carry_the_sentinel_and_others_do_not(
    employee_dataset: GeneratedDataset,
) -> None:
    frame = employee_dataset.frame
    sentinel = pd.Timestamp(SENTINEL_EXPIRATION_DATE)
    assert (frame.loc[frame["is_current"], "expiration_date"] == sentinel).all()
    assert (frame.loc[~frame["is_current"], "expiration_date"] != sentinel).all()


def test_version_ranges_are_contiguous_and_non_overlapping(
    employee_dataset: GeneratedDataset,
) -> None:
    ordered = employee_dataset.frame.sort_values(["employee_id", "effective_date"])
    one_day = pd.Timedelta(days=1)
    for _, versions in ordered.groupby("employee_id", sort=True):
        effectives = versions["effective_date"].tolist()
        expirations = versions["expiration_date"].tolist()
        for index in range(1, len(effectives)):
            assert expirations[index - 1] + one_day == effectives[index]
            assert expirations[index - 1] < effectives[index]


def test_at_least_three_employees_have_two_versions(employee_dataset: GeneratedDataset) -> None:
    """The SCD2 expire-and-insert path must be exercised by real generated data."""
    versions = employee_dataset.frame.groupby("employee_id").size()
    assert int((versions >= 2).sum()) >= 3


def test_a_second_version_is_a_genuine_role_or_store_change(
    employee_dataset: GeneratedDataset,
) -> None:
    frame = employee_dataset.frame
    multi = frame.groupby("employee_id").filter(lambda group: len(group) > 1)
    assert not multi.empty
    for _, versions in multi.sort_values(["employee_id", "effective_date"]).groupby("employee_id"):
        rows = versions.to_dict(orient="records")
        for previous, following in pairwise(rows):
            changed = (
                previous["dealership_id"] != following["dealership_id"]
                or previous["job_role"] != following["job_role"]
            )
            assert changed, "a new version must reflect a real role or store change"
            assert previous["attribute_hash"] != following["attribute_hash"]


def test_the_first_version_starts_on_the_hire_date(employee_dataset: GeneratedDataset) -> None:
    ordered = employee_dataset.frame.sort_values(["employee_id", "effective_date"])
    first_rows = ordered.groupby("employee_id").head(1)
    assert (first_rows["effective_date"] == first_rows["hire_date"]).all()


# --------------------------------------------------------------------------------------
# Employment dates and terminations
# --------------------------------------------------------------------------------------
def test_hire_date_is_never_before_the_store_opened(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    opened = frame["dealership_id"].map(
        {key: pd.Timestamp(value) for key, value in STORE_OPENED.items()}
    )
    assert (frame["hire_date"] >= opened).all()


def test_is_active_always_agrees_with_termination_date(
    employee_dataset: GeneratedDataset,
) -> None:
    frame = employee_dataset.frame
    assert (frame["is_active"] == frame["termination_date"].isna()).all()


def test_some_employees_are_terminated(employee_dataset: GeneratedDataset) -> None:
    frame = employee_dataset.frame
    terminated = frame.loc[frame["is_current"] & frame["termination_date"].notna()]
    assert not terminated.empty


def test_a_terminated_employee_still_closes_correctly(
    employee_dataset: GeneratedDataset,
) -> None:
    frame = employee_dataset.frame
    terminated_ids = set(frame.loc[frame["termination_date"].notna(), "employee_id"].tolist())
    assert terminated_ids
    sentinel = pd.Timestamp(SENTINEL_EXPIRATION_DATE)
    for employee_id in sorted(terminated_ids):
        versions = frame.loc[frame["employee_id"] == employee_id]
        current = versions.loc[versions["is_current"]]
        assert len(current) == 1
        row = current.iloc[0]
        assert row["expiration_date"] == sentinel
        assert bool(row["is_active"]) is False
        assert row["termination_date"] >= row["hire_date"]


def test_termination_dates_fall_inside_the_reporting_window(
    employee_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    terminations = employee_dataset.frame["termination_date"].dropna()
    assert not terminations.empty
    assert (terminations >= pd.Timestamp(test_config.reporting.start_date)).all()
    assert (terminations <= pd.Timestamp(test_config.reporting.end_date)).all()


# --------------------------------------------------------------------------------------
# Roster construction helpers
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("headcount", [12, 30, 45])
def test_store_allocation_sums_to_the_headcount(headcount: int) -> None:
    allocation = allocate_store_headcount(headcount)
    assert sum(allocation.values()) == headcount
    assert sorted(allocation) == ["GSA-001", "GSA-002", "GSA-003"]


@pytest.mark.parametrize("headcount", [12, 30, 45])
def test_the_independent_store_has_the_smallest_roster(headcount: int) -> None:
    allocation = allocate_store_headcount(headcount)
    assert allocation["GSA-003"] < allocation["GSA-002"] <= allocation["GSA-001"]


def test_store_allocation_is_deterministic() -> None:
    assert allocate_store_headcount(30) == allocate_store_headcount(30)


def test_a_role_plan_is_truncated_to_the_requested_headcount() -> None:
    roles = expand_role_plan("GSA-001", 4)
    assert len(roles) == 4
    assert roles[0] == JOB_ROLE_GENERAL_MANAGER


def test_a_role_plan_cycles_its_tail_when_the_headcount_exceeds_it() -> None:
    roles = expand_role_plan("GSA-003", 60)
    assert len(roles) == 60
    assert set(roles) <= set(ALLOWED_JOB_ROLES)


def test_an_unknown_store_has_no_role_plan() -> None:
    with pytest.raises(GenerationError, match="No staffing plan"):
        expand_role_plan("GSA-999", 3)


def test_a_management_role_is_reached_by_promotion_at_the_same_store() -> None:
    assert predecessor_assignment("GSA-001", JOB_ROLE_SALES_MANAGER, date(2018, 1, 1)) == (
        "GSA-001",
        JOB_ROLE_SALESPERSON,
    )


def test_a_non_management_role_is_reached_by_transfer_from_another_store() -> None:
    prior = predecessor_assignment("GSA-003", JOB_ROLE_SALESPERSON, date(2020, 1, 1))
    assert prior is not None
    assert prior[0] != "GSA-003"
    assert prior[1] == JOB_ROLE_SALESPERSON


def test_a_transfer_is_impossible_before_any_other_store_opened() -> None:
    assert predecessor_assignment("GSA-001", JOB_ROLE_SALESPERSON, date(2010, 1, 1)) is None


def test_select_by_score_takes_the_highest_scores_in_identifier_order() -> None:
    scored = [("EMP-00003", 0.9), ("EMP-00001", 0.1), ("EMP-00002", 0.5)]
    assert select_by_score(scored, 2) == ("EMP-00002", "EMP-00003")


def test_select_by_score_refuses_to_invent_candidates() -> None:
    with pytest.raises(GenerationError, match="required"):
        select_by_score([("EMP-00001", 0.5)], 3)


def test_employee_headcount_rejects_an_undeclared_scale_mode() -> None:
    stand_in = cast(
        "ArpiConfig", SimpleNamespace(generation=SimpleNamespace(scale_mode="enormous"))
    )
    with pytest.raises(GenerationError, match="No employee headcount"):
        employee_headcount(stand_in)


# --------------------------------------------------------------------------------------
# Latent performance parameters
# --------------------------------------------------------------------------------------
def test_performance_profiles_cover_every_employee_exactly_once(
    test_config: ArpiConfig,
) -> None:
    profiles = employee_performance_profiles(test_config)
    roster = build_employee_assignments(test_config)
    assert sorted(profiles) == sorted(assignment.employee_id for assignment in roster)


def test_performance_profiles_are_deterministic(test_config: ArpiConfig) -> None:
    assert employee_performance_profiles(test_config) == employee_performance_profiles(test_config)


def test_no_two_employees_share_a_performance_profile(test_config: ArpiConfig) -> None:
    """Identical employee performance is a prohibited synthetic pattern."""
    profiles = employee_performance_profiles(test_config).values()
    for attribute in (
        "volume_index",
        "closing_rate_index",
        "gross_retention_index",
        "crm_discipline_index",
    ):
        values = [getattr(profile, attribute) for profile in profiles]
        assert len(set(values)) == len(values)


def test_performance_indices_are_positive_and_bounded(test_config: ArpiConfig) -> None:
    for profile in employee_performance_profiles(test_config).values():
        assert 0.0 < profile.volume_index < 3.0
        assert 0.0 < profile.closing_rate_index < 3.0
        assert 0.0 < profile.gross_retention_index < 3.0
        assert 0.0 < profile.crm_discipline_index <= 1.0


def test_performance_profiles_describe_the_current_assignment(
    test_config: ArpiConfig, employee_dataset: GeneratedDataset
) -> None:
    current = employee_dataset.frame.loc[employee_dataset.frame["is_current"]]
    expected = {
        str(record["employee_id"]): (str(record["dealership_id"]), str(record["job_role"]))
        for record in current.to_dict(orient="records")
    }
    for employee_id, profile in employee_performance_profiles(test_config).items():
        assert (profile.dealership_id, profile.job_role) == expected[employee_id]


def test_no_latent_parameter_name_appears_as_a_column(
    employee_dataset: GeneratedDataset,
) -> None:
    columns = {str(column).lower() for column in employee_dataset.frame.columns}
    for column in columns:
        assert not any(token in column for token in LATENT_PARAMETER_COLUMN_TOKENS)


def test_reading_the_latent_parameters_does_not_perturb_the_dimension(
    test_config: ArpiConfig, employee_dataset: GeneratedDataset
) -> None:
    """Reading the latent parameters must not perturb the dimension it describes."""
    employee_performance_profiles(test_config)
    pd.testing.assert_frame_equal(
        generate_employee_dataset(test_config).frame, employee_dataset.frame
    )
