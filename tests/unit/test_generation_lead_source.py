"""Unit tests for the governed lead-source dimension.

The tests that matter most here are the coherence ones. A lead-source dimension whose
flags disagree with its categories, or whose "paid" sources cost nothing, would pass every
schema check and still make every marketing measure built on it meaningless.
"""

from __future__ import annotations

import re
from decimal import Decimal

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.exceptions import GenerationError
from arpi.generation.lead_source import (
    ALL_LEAD_SOURCE_IDS,
    ALLOWED_SOURCE_CATEGORIES,
    CATEGORY_INTERNAL,
    CATEGORY_ORGANIC_WEB,
    CATEGORY_OWNED_DIGITAL,
    CATEGORY_PAID_SEARCH,
    CATEGORY_PAID_SOCIAL,
    CATEGORY_REFERRAL,
    CATEGORY_THIRD_PARTY,
    CATEGORY_TRADITIONAL_MEDIA,
    CATEGORY_WALK_IN,
    DIM_LEAD_SOURCE_COLUMNS,
    LEAD_SOURCE_CHECK_IDS,
    LEAD_SOURCE_DEFINITIONS,
    PAID_LEAD_SOURCE_IDS,
    TOTAL_LEAD_COUNT_BY_SCALE,
    LeadSourceDefinition,
    generate_lead_source_dataset,
    lead_source_behaviour,
    lead_source_behaviours,
    lead_source_definition,
    lead_source_key_for,
    validate_lead_source_dataset,
)

LEAD_SOURCE_ID_PATTERN = re.compile(r"^LDS-\d{3}$")

#: Categories whose sources are, by definition, digital channels.
DIGITAL_CATEGORIES = frozenset(
    {
        CATEGORY_OWNED_DIGITAL,
        CATEGORY_ORGANIC_WEB,
        CATEGORY_PAID_SEARCH,
        CATEGORY_PAID_SOCIAL,
        CATEGORY_THIRD_PARTY,
    }
)

#: Categories whose sources are not digital channels: broadcast, print, the showroom
#: floor, the service drive and word of mouth.
NON_DIGITAL_CATEGORIES = frozenset(
    {
        CATEGORY_TRADITIONAL_MEDIA,
        CATEGORY_WALK_IN,
        CATEGORY_REFERRAL,
        CATEGORY_INTERNAL,
    }
)


@pytest.fixture
def definitions() -> tuple[LeadSourceDefinition, ...]:
    """The governed source list."""
    return LEAD_SOURCE_DEFINITIONS


# --------------------------------------------------------------------------------------
# Identifiers and keys
# --------------------------------------------------------------------------------------
def test_every_identifier_matches_the_declared_format(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    for definition in definitions:
        assert LEAD_SOURCE_ID_PATTERN.match(definition.lead_source_id), definition.lead_source_id


def test_identifiers_are_unique(definitions: tuple[LeadSourceDefinition, ...]) -> None:
    identifiers = [definition.lead_source_id for definition in definitions]
    assert len(set(identifiers)) == len(identifiers)


def test_names_are_unique(definitions: tuple[LeadSourceDefinition, ...]) -> None:
    names = [definition.lead_source_name for definition in definitions]
    assert len(set(names)) == len(names)


def test_the_key_is_a_deterministic_ordinal_over_the_identifier(
    test_config: ArpiConfig,
) -> None:
    frame = generate_lead_source_dataset(test_config).frame
    ordered = frame.sort_values("lead_source_id")
    assert list(ordered["lead_source_key"]) == list(range(1, frame.shape[0] + 1))


def test_the_key_helper_agrees_with_the_generated_frame(test_config: ArpiConfig) -> None:
    frame = generate_lead_source_dataset(test_config).frame
    for record in frame.to_dict(orient="records"):
        assert lead_source_key_for(str(record["lead_source_id"])) == int(record["lead_source_key"])


def test_the_key_helper_rejects_an_unknown_source() -> None:
    with pytest.raises(GenerationError, match="not a governed lead source"):
        lead_source_key_for("LDS-999")


# --------------------------------------------------------------------------------------
# Coverage and flag coherence
# --------------------------------------------------------------------------------------
def test_every_declared_category_is_covered(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    covered = {definition.source_category for definition in definitions}
    assert covered == set(ALLOWED_SOURCE_CATEGORIES)


def test_internal_sources_are_never_paid(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    """The rule: an internally generated opportunity has no media cost."""
    for definition in definitions:
        if definition.is_internal:
            assert not definition.is_paid, definition.lead_source_id


def test_paid_sources_carry_a_cost_and_unpaid_sources_carry_none(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    for definition in definitions:
        if definition.is_paid:
            assert definition.cost_per_lead > Decimal("0.00"), definition.lead_source_id
        else:
            assert definition.cost_per_lead == Decimal("0.00"), definition.lead_source_id


def test_digital_flags_follow_from_the_category(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    for definition in definitions:
        if definition.source_category in DIGITAL_CATEGORIES:
            assert definition.is_digital, definition.lead_source_id
        elif definition.source_category in NON_DIGITAL_CATEGORIES:
            assert not definition.is_digital, definition.lead_source_id


def test_only_third_party_category_sources_are_flagged_third_party(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    for definition in definitions:
        assert definition.is_third_party == (definition.source_category == CATEGORY_THIRD_PARTY), (
            definition.lead_source_id
        )


def test_a_third_party_source_is_never_internal(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    for definition in definitions:
        assert not (definition.is_third_party and definition.is_internal)


def test_the_paid_source_list_matches_the_flag(
    definitions: tuple[LeadSourceDefinition, ...],
) -> None:
    expected = tuple(definition.lead_source_id for definition in definitions if definition.is_paid)
    assert expected == PAID_LEAD_SOURCE_IDS


# --------------------------------------------------------------------------------------
# Latent behaviour
# --------------------------------------------------------------------------------------
def test_the_volume_weights_sum_to_one() -> None:
    total = sum(behaviour.volume_weight for behaviour in lead_source_behaviours())
    assert total == pytest.approx(1.0, abs=1e-9)


def test_every_rate_is_a_probability() -> None:
    for behaviour in lead_source_behaviours():
        assert 0.0 < behaviour.volume_weight <= 1.0, behaviour.lead_source_id
        assert 0.0 < behaviour.contact_rate <= 1.0, behaviour.lead_source_id
        assert 0.0 < behaviour.close_rate < 1.0, behaviour.lead_source_id


def test_the_latents_are_not_uniform_across_sources() -> None:
    """Relationship 7: sources must genuinely differ in cost, volume and conversion."""
    behaviours = lead_source_behaviours()
    close_rates = [behaviour.close_rate for behaviour in behaviours]
    contact_rates = [behaviour.contact_rate for behaviour in behaviours]
    weights = [behaviour.volume_weight for behaviour in behaviours]
    costs = [behaviour.cost_per_lead for behaviour in behaviours]
    assert max(close_rates) - min(close_rates) > 0.10
    assert max(contact_rates) - min(contact_rates) > 0.10
    assert max(weights) - min(weights) > 0.05
    assert max(costs) - min(costs) > Decimal("20.00")


def test_every_cost_is_an_exact_cent_quantized_decimal() -> None:
    for behaviour in lead_source_behaviours():
        assert isinstance(behaviour.cost_per_lead, Decimal)
        assert behaviour.cost_per_lead.as_tuple().exponent == -2, behaviour.lead_source_id


def test_the_behaviour_helper_returns_the_definitions_latents() -> None:
    for definition in LEAD_SOURCE_DEFINITIONS:
        behaviour = lead_source_behaviour(definition.lead_source_id)
        assert behaviour.volume_weight == definition.volume_weight
        assert behaviour.contact_rate == definition.contact_rate
        assert behaviour.close_rate == definition.close_rate
        assert behaviour.cost_per_lead == definition.cost_per_lead


def test_the_behaviour_helper_rejects_an_unknown_source() -> None:
    with pytest.raises(GenerationError, match="not a governed lead source"):
        lead_source_behaviour("LDS-000")


def test_the_definition_helper_rejects_an_unknown_source() -> None:
    with pytest.raises(GenerationError, match="not a governed lead source"):
        lead_source_definition("nonsense")


def test_the_behaviours_are_ordered_by_identifier() -> None:
    identifiers = [behaviour.lead_source_id for behaviour in lead_source_behaviours()]
    assert identifiers == sorted(identifiers)
    assert tuple(identifiers) == tuple(sorted(ALL_LEAD_SOURCE_IDS))


def test_the_latents_never_appear_as_dimension_columns(test_config: ArpiConfig) -> None:
    """A close rate on a dimension row would be an assumption dressed up as a fact."""
    columns = set(generate_lead_source_dataset(test_config).actual_columns)
    for latent in ("volume_weight", "contact_rate", "close_rate", "cost_per_lead"):
        assert latent not in columns


def test_the_lead_scale_matches_the_phase_one_contract() -> None:
    assert TOTAL_LEAD_COUNT_BY_SCALE == {"test": 200, "development": 6_000, "portfolio": 55_000}


# --------------------------------------------------------------------------------------
# Frame shape and determinism
# --------------------------------------------------------------------------------------
def test_the_frame_matches_the_declared_contract(test_config: ArpiConfig) -> None:
    dataset = generate_lead_source_dataset(test_config)
    assert dataset.actual_columns == DIM_LEAD_SOURCE_COLUMNS
    assert dataset.column_count == 9
    assert dataset.row_count == len(LEAD_SOURCE_DEFINITIONS)
    assert dataset.namespace == "dim_lead_source"


def test_regeneration_produces_an_identical_frame(test_config: ArpiConfig) -> None:
    first = generate_lead_source_dataset(test_config).frame
    second = generate_lead_source_dataset(test_config).frame
    assert first.equals(second)


def test_the_dimension_is_seed_independent() -> None:
    """Fixed reference data: changing the master seed must not move a single value."""
    base = load_config(profile="test")
    reseeded = base.model_copy(update={"random_seed": base.random_seed + 991})
    assert generate_lead_source_dataset(base).frame.equals(
        generate_lead_source_dataset(reseeded).frame
    )


def test_the_dimension_is_profile_independent() -> None:
    """The governed source list is reference data, not a function of scale."""
    test_frame = generate_lead_source_dataset(load_config(profile="test")).frame
    development_frame = generate_lead_source_dataset(load_config(profile="development")).frame
    assert test_frame.equals(development_frame)


# --------------------------------------------------------------------------------------
# Validation suite
# --------------------------------------------------------------------------------------
def test_the_suite_emits_every_declared_check_in_order(test_config: ArpiConfig) -> None:
    report = validate_lead_source_dataset(generate_lead_source_dataset(test_config))
    assert [result.check_id for result in report.results] == list(LEAD_SOURCE_CHECK_IDS)


def test_the_suite_passes_on_the_generated_dimension(test_config: ArpiConfig) -> None:
    report = validate_lead_source_dataset(generate_lead_source_dataset(test_config))
    assert not report.failures, [result.message for result in report.failures]
