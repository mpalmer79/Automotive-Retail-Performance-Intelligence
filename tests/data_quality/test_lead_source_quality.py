"""Data-quality assertions over the generated lead-source dimension.

Three properties are load-bearing here and are asserted rather than assumed:

* the column set is **exactly** the nine-column contract, in order;
* the same seed produces byte-identical output, and generating this entity does not move
  any other entity's digest;
* the latent behaviour that shapes downstream funnel data is genuinely non-uniform, so
  relationship 7 -- "sources differ in cost, volume, conversion and gross" -- is present
  in the data rather than only in the documentation.
"""

from __future__ import annotations

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.generation.base import GeneratedDataset
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import generate_customer_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import generate_employee_dataset
from arpi.generation.lead_source import (
    ALLOWED_SOURCE_CATEGORIES,
    DIM_LEAD_SOURCE_COLUMNS,
    LEAD_SOURCE_CHECK_IDS,
    LEAD_SOURCE_DEFINITIONS,
    generate_lead_source_dataset,
    lead_source_behaviours,
    validate_lead_source_dataset,
)
from arpi.generation.writer import dataframe_to_csv_bytes
from arpi.utilities.hashing import content_digest
from arpi.validation.registry import require_registered

pytestmark = pytest.mark.data_quality

#: Spelled out verbatim so that a future refactor of the shared privacy module cannot
#: silently narrow what this entity is checked against.
PROHIBITED_COLUMN_NAMES = (
    "first_name",
    "last_name",
    "full_name",
    "customer_name",
    "email",
    "phone",
    "address",
    "street_address",
    "ssn",
    "date_of_birth",
    "drivers_license",
    "bank_account",
    "credit_card",
    "credit_score",
    "salary",
    "commission",
    "race",
    "gender",
    "notes",
    "comments",
    "transcript",
)


@pytest.fixture
def lead_source_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    """The generated ``dim_lead_source`` dataset."""
    return generate_lead_source_dataset(test_config)


# --------------------------------------------------------------------------------------
# Column contract
# --------------------------------------------------------------------------------------
def test_the_column_order_is_exactly_the_contract(
    lead_source_dataset: GeneratedDataset,
) -> None:
    assert lead_source_dataset.actual_columns == DIM_LEAD_SOURCE_COLUMNS
    assert len(DIM_LEAD_SOURCE_COLUMNS) == 9


def test_the_column_set_is_exactly_the_contract(
    lead_source_dataset: GeneratedDataset,
) -> None:
    """Deny by default: anything not in the contract is, by construction, not generated."""
    assert set(lead_source_dataset.actual_columns) == set(DIM_LEAD_SOURCE_COLUMNS)


def test_no_column_is_ever_null(lead_source_dataset: GeneratedDataset) -> None:
    assert not lead_source_dataset.frame.isna().to_numpy().any()


def test_the_source_system_marker_is_on_every_row(
    lead_source_dataset: GeneratedDataset,
) -> None:
    values = set(lead_source_dataset.frame["source_system"].tolist())
    assert values == {"arpi_synthetic_generator"}


# --------------------------------------------------------------------------------------
# Privacy
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("prohibited", PROHIBITED_COLUMN_NAMES)
def test_no_prohibited_column_name_exists(
    lead_source_dataset: GeneratedDataset, prohibited: str
) -> None:
    columns = {str(column).lower() for column in lead_source_dataset.frame.columns}
    assert prohibited not in columns
    assert not any(prohibited in column for column in columns)


def test_the_privacy_check_is_registered_as_critical() -> None:
    definition = require_registered("DQ-LDS-006")
    assert definition.category == "privacy"
    assert str(definition.severity) == "critical"


def test_the_gating_suite_fails_when_a_prohibited_column_appears(
    lead_source_dataset: GeneratedDataset,
) -> None:
    """The tripwire has to actually trip, so assert the failure rather than the pass."""
    tampered = lead_source_dataset.frame.copy()
    tampered["contact_email"] = ""
    results = {
        result.check_id: result
        for result in validate_lead_source_dataset(
            GeneratedDataset(
                entity_name=lead_source_dataset.entity_name,
                frame=tampered,
                declared_columns=lead_source_dataset.declared_columns,
                namespace=lead_source_dataset.namespace,
            )
        ).results
    }
    assert results["DQ-LDS-006"].is_failure


# --------------------------------------------------------------------------------------
# Scale and coverage
# --------------------------------------------------------------------------------------
def test_the_governed_list_is_a_workable_size(
    lead_source_dataset: GeneratedDataset,
) -> None:
    """Enough sources to be a real taxonomy, few enough to stay governable."""
    assert 9 <= lead_source_dataset.row_count <= 40
    assert lead_source_dataset.row_count == len(LEAD_SOURCE_DEFINITIONS)


def test_every_declared_category_is_represented(
    lead_source_dataset: GeneratedDataset,
) -> None:
    present = set(lead_source_dataset.frame["source_category"].tolist())
    assert present == set(ALLOWED_SOURCE_CATEGORIES)


def test_each_flag_has_both_values_present(lead_source_dataset: GeneratedDataset) -> None:
    """A flag that is constant across the dimension slices nothing."""
    frame = lead_source_dataset.frame
    for column in ("is_paid", "is_digital", "is_third_party", "is_internal"):
        assert set(frame[column].tolist()) == {True, False}, column


def test_internal_sources_are_never_paid_in_the_generated_frame(
    lead_source_dataset: GeneratedDataset,
) -> None:
    frame = lead_source_dataset.frame
    assert frame[frame["is_internal"]]["is_paid"].sum() == 0


def test_paid_and_unpaid_sources_are_both_a_meaningful_share(
    lead_source_dataset: GeneratedDataset,
) -> None:
    paid_share = float(lead_source_dataset.frame["is_paid"].mean())
    assert 0.30 < paid_share < 0.75


# --------------------------------------------------------------------------------------
# Latent behaviour: relationship 7
# --------------------------------------------------------------------------------------
def test_the_sources_differ_in_cost_volume_and_conversion() -> None:
    behaviours = lead_source_behaviours()
    assert len({behaviour.close_rate for behaviour in behaviours}) > 5
    assert len({behaviour.cost_per_lead for behaviour in behaviours}) > 5
    assert len({behaviour.volume_weight for behaviour in behaviours}) > 5


def test_in_person_and_earned_sources_close_better_than_purchased_traffic() -> None:
    """A direction-and-band check, not a point value."""
    by_id = {behaviour.lead_source_id: behaviour for behaviour in lead_source_behaviours()}
    walk_in = by_id["LDS-015"].close_rate
    referral = by_id["LDS-016"].close_rate
    third_party = by_id["LDS-010"].close_rate
    paid_social = by_id["LDS-008"].close_rate
    assert walk_in > third_party * 2
    assert referral > paid_social * 2
    assert 0.15 < walk_in < 0.40
    assert 0.02 < paid_social < 0.12


def test_unpaid_sources_have_no_cost_and_paid_sources_do() -> None:
    for behaviour in lead_source_behaviours():
        if behaviour.cost_per_lead == 0:
            continue
        assert behaviour.cost_per_lead > 0


# --------------------------------------------------------------------------------------
# Reproducibility and seed isolation
# --------------------------------------------------------------------------------------
def test_the_same_seed_produces_byte_identical_output(test_config: ArpiConfig) -> None:
    first = dataframe_to_csv_bytes(generate_lead_source_dataset(test_config).frame)
    second = dataframe_to_csv_bytes(generate_lead_source_dataset(test_config).frame)
    assert first == second
    assert content_digest(first) == content_digest(second)


def test_the_digest_is_stable_across_reruns(test_config: ArpiConfig) -> None:
    digests = {
        content_digest(dataframe_to_csv_bytes(generate_lead_source_dataset(test_config).frame))
        for _ in range(3)
    }
    assert len(digests) == 1


def test_generating_lead_sources_does_not_perturb_any_other_entity(
    test_config: ArpiConfig,
) -> None:
    """One namespace per entity: adding an entity must never move another's digest."""

    def digests() -> dict[str, str]:
        return {
            "dim_date": content_digest(
                dataframe_to_csv_bytes(generate_date_dataset(test_config).frame)
            ),
            "dim_dealership": content_digest(
                dataframe_to_csv_bytes(generate_dealership_dataset(test_config).frame)
            ),
            "dim_employee": content_digest(
                dataframe_to_csv_bytes(generate_employee_dataset(test_config).frame)
            ),
            "dim_customer": content_digest(
                dataframe_to_csv_bytes(generate_customer_dataset(test_config).frame)
            ),
        }

    before = digests()
    generate_lead_source_dataset(test_config)
    assert digests() == before


def test_the_dimension_does_not_move_when_the_seed_changes() -> None:
    """Fixed reference data: the master seed is irrelevant to this entity."""
    base = load_config(profile="test")
    reseeded = base.model_copy(update={"random_seed": base.random_seed + 4242})
    assert content_digest(
        dataframe_to_csv_bytes(generate_lead_source_dataset(base).frame)
    ) == content_digest(dataframe_to_csv_bytes(generate_lead_source_dataset(reseeded).frame))


# --------------------------------------------------------------------------------------
# The gating suite
# --------------------------------------------------------------------------------------
def test_every_gating_check_passes(lead_source_dataset: GeneratedDataset) -> None:
    report = validate_lead_source_dataset(lead_source_dataset)
    assert not report.failures, [result.message for result in report.failures]


def test_the_suite_emits_every_declared_check_exactly_once(
    lead_source_dataset: GeneratedDataset,
) -> None:
    emitted = [
        result.check_id for result in validate_lead_source_dataset(lead_source_dataset).results
    ]
    assert emitted == list(LEAD_SOURCE_CHECK_IDS)
    assert len(set(emitted)) == len(emitted)


def test_every_emitted_check_is_registered(lead_source_dataset: GeneratedDataset) -> None:
    for result in validate_lead_source_dataset(lead_source_dataset).results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, result.check_id
        assert result.severity == definition.severity, result.check_id


def test_the_gating_suite_fails_on_an_internal_paid_source(
    lead_source_dataset: GeneratedDataset,
) -> None:
    tampered = lead_source_dataset.frame.copy()
    internal = tampered.index[tampered["is_internal"]][0]
    tampered.loc[internal, "is_paid"] = True
    results = {
        result.check_id: result
        for result in validate_lead_source_dataset(
            GeneratedDataset(
                entity_name=lead_source_dataset.entity_name,
                frame=tampered,
                declared_columns=lead_source_dataset.declared_columns,
                namespace=lead_source_dataset.namespace,
            )
        ).results
    }
    assert results["DQ-LDS-005"].is_failure


def test_the_gating_suite_fails_on_an_ungoverned_category(
    lead_source_dataset: GeneratedDataset,
) -> None:
    tampered = lead_source_dataset.frame.copy()
    tampered.loc[tampered.index[0], "source_category"] = "Internet"
    results = {
        result.check_id: result
        for result in validate_lead_source_dataset(
            GeneratedDataset(
                entity_name=lead_source_dataset.entity_name,
                frame=tampered,
                declared_columns=lead_source_dataset.declared_columns,
                namespace=lead_source_dataset.namespace,
            )
        ).results
    }
    assert results["DQ-LDS-004"].is_failure


def test_the_gating_suite_fails_on_a_duplicated_source_name(
    lead_source_dataset: GeneratedDataset,
) -> None:
    tampered = lead_source_dataset.frame.copy()
    tampered.loc[tampered.index[1], "lead_source_name"] = str(
        tampered.loc[tampered.index[0], "lead_source_name"]
    )
    results = {
        result.check_id: result
        for result in validate_lead_source_dataset(
            GeneratedDataset(
                entity_name=lead_source_dataset.entity_name,
                frame=tampered,
                declared_columns=lead_source_dataset.declared_columns,
                namespace=lead_source_dataset.namespace,
            )
        ).results
    }
    assert results["DQ-LDS-002"].is_failure


def test_the_internal_rule_check_reports_a_missing_column(
    lead_source_dataset: GeneratedDataset,
) -> None:
    """A dropped flag column must fail the rule rather than pass it vacuously."""
    tampered = lead_source_dataset.frame.drop(columns=["is_paid"])
    results = {
        result.check_id: result
        for result in validate_lead_source_dataset(
            GeneratedDataset(
                entity_name=lead_source_dataset.entity_name,
                frame=tampered,
                declared_columns=lead_source_dataset.declared_columns,
                namespace=lead_source_dataset.namespace,
            )
        ).results
    }
    assert results["DQ-LDS-005"].is_failure
    assert "is_paid" in str(results["DQ-LDS-005"].message)
