"""The governed eligibility rules, and the finance-structure derivation beside them.

Eligibility has exactly one authority in ARPI --
``config/reference/fi_product_eligibility.yaml`` -- and this module holds it to the
properties the whole F&I domain depends on: the partition rule, the closed vocabularies,
and the fact that no customer attribute can reach the predicate because there is nowhere
for one to be passed in.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import yaml

from arpi.constants import (
    ELIGIBILITY_RULE_IDS,
    FINANCE_PRODUCT_CATEGORIES,
    FINANCE_STRUCTURE_CASH,
    FINANCE_STRUCTURE_DEALER_TRADE,
    FINANCE_STRUCTURE_LEASE,
    FINANCE_STRUCTURE_RETAIL_FINANCE,
    FINANCE_STRUCTURE_WHOLESALE,
    RETAIL_FINANCE_STRUCTURES,
)
from arpi.exceptions import GenerationError
from arpi.generation.fi_eligibility import (
    eligibility_configuration,
    eligible_categories,
    finance_structure_for,
    is_category_eligible,
    is_retail_structure,
    resolve_eligibility_path,
    rule_for_category,
)

CONDITIONS = ("New", "Used", "Certified")
SALE_TYPES = (
    "New Retail",
    "Used Retail",
    "Certified Retail",
    "Lease",
    "Wholesale",
    "Dealer Trade",
)


# --------------------------------------------------------------------------------------
# The finance-structure derivation
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sale_type", "financed", "expected"),
    [
        ("New Retail", "0.00", FINANCE_STRUCTURE_CASH),
        ("Used Retail", "0.00", FINANCE_STRUCTURE_CASH),
        ("Certified Retail", "0.00", FINANCE_STRUCTURE_CASH),
        ("New Retail", "0.01", FINANCE_STRUCTURE_RETAIL_FINANCE),
        ("Used Retail", "18000.00", FINANCE_STRUCTURE_RETAIL_FINANCE),
        ("Certified Retail", "9999.99", FINANCE_STRUCTURE_RETAIL_FINANCE),
        # A lease is a lease however it was funded: the sale type decides, and the
        # financed amount is not consulted at all.
        ("Lease", "0.00", FINANCE_STRUCTURE_LEASE),
        ("Lease", "22000.00", FINANCE_STRUCTURE_LEASE),
        ("Wholesale", "0.00", FINANCE_STRUCTURE_WHOLESALE),
        ("Dealer Trade", "0.00", FINANCE_STRUCTURE_DEALER_TRADE),
    ],
)
def test_the_finance_structure_derivation_is_total_over_the_governed_types(
    sale_type: str, financed: str, expected: str
) -> None:
    assert finance_structure_for(sale_type, Decimal(financed)) == expected


def test_an_unknown_sale_type_raises_rather_than_defaulting_to_cash() -> None:
    """A default branch would move an unknown type into three eligibility denominators.

    Silently. That is the failure this refusal exists to prevent: `Cash` is the branch a
    fall-through would land on, and a Cash classification makes a transaction eligible for
    every rule except GAP and Lease Wear Protection.
    """
    with pytest.raises(GenerationError, match="outside the governed enumeration"):
        finance_structure_for("Fleet", Decimal("0.00"))


def test_only_the_three_retail_structures_are_retail() -> None:
    assert all(is_retail_structure(name) for name in RETAIL_FINANCE_STRUCTURES)
    assert not is_retail_structure(FINANCE_STRUCTURE_WHOLESALE)
    assert not is_retail_structure(FINANCE_STRUCTURE_DEALER_TRADE)


# --------------------------------------------------------------------------------------
# The partition rule
# --------------------------------------------------------------------------------------


def test_every_governed_category_resolves_to_exactly_one_rule() -> None:
    """THE BINDING RULE. Not zero -- a category with no rule has no denominator, so every
    penetration over it is undefined and renders as an empty cell rather than as a
    governance failure. Not two -- a category with two denominators can be computed two
    ways and both look correct.
    """
    config = eligibility_configuration()
    assert set(config.rule_by_category) == set(FINANCE_PRODUCT_CATEGORIES)
    for category in FINANCE_PRODUCT_CATEGORIES:
        rule = rule_for_category(category, config)
        owning = [r.rule_id for r in config.rules if category in r.categories]
        assert owning == [rule.rule_id], (
            f"{category} is owned by {owning}; exactly one rule must own it"
        )


def test_the_rule_identifiers_match_the_constant() -> None:
    assert eligibility_configuration().rule_ids == ELIGIBILITY_RULE_IDS


def test_the_shared_rule_names_its_categories_rather_than_being_a_fallback() -> None:
    """The planning ambiguity, resolved explicitly.

    KPI_EXTENSION_PLAN said "one rule per category" while its own table grouped five
    categories under ELIG-OTH. The configuration resolves that by making ELIG-OTH NAME its
    five categories, so the mapping stays a total function a reader can check by eye
    rather than a fallback hidden in code.
    """
    config = eligibility_configuration()
    other = next(rule for rule in config.rules if rule.rule_id == "ELIG-OTH")
    assert len(other.categories) == 5
    assert set(other.categories) == {
        "Appearance Protection",
        "Key Replacement",
        "Theft or Security Product",
        "Paintless Dent Protection",
        "Other Aftermarket Product",
    }


def test_a_configuration_that_is_not_a_partition_is_refused(tmp_path: Path) -> None:
    """Seeded defect: a category owned by nobody must fail the load, not default."""
    source = yaml.safe_load(resolve_eligibility_path().read_text(encoding="utf-8"))
    # Drop one category from the SHARED rule, so the rule keeps a non-empty list and the
    # file still parses -- the failure under test is the missing OWNER, not a malformed
    # entry, and removing ELIG-GAP's only category would have tripped the schema check
    # first and left the partition rule unexercised.
    for rule in source["rules"]:
        if rule["rule_id"] == "ELIG-OTH":
            rule["categories"] = [
                name for name in rule["categories"] if name != "Key Replacement"
            ]
    broken = tmp_path / "fi_product_eligibility.yaml"
    broken.write_text(yaml.safe_dump(source), encoding="utf-8")
    with pytest.raises(GenerationError, match="not a partition"):
        eligibility_configuration(broken)


def test_a_configuration_that_owns_a_category_twice_is_refused(tmp_path: Path) -> None:
    source = yaml.safe_load(resolve_eligibility_path().read_text(encoding="utf-8"))
    for rule in source["rules"]:
        if rule["rule_id"] == "ELIG-OTH":
            rule["categories"] = [*rule["categories"], "GAP"]
    broken = tmp_path / "fi_product_eligibility.yaml"
    broken.write_text(yaml.safe_dump(source), encoding="utf-8")
    with pytest.raises(GenerationError, match="not a partition"):
        eligibility_configuration(broken)


def test_a_rule_naming_a_non_retail_structure_is_refused(tmp_path: Path) -> None:
    """A disposal has no consumer, so no rule may admit one -- refused, not ignored."""
    source = yaml.safe_load(resolve_eligibility_path().read_text(encoding="utf-8"))
    source["rules"][0]["finance_structures"] = ["Cash", "Wholesale"]
    broken = tmp_path / "fi_product_eligibility.yaml"
    broken.write_text(yaml.safe_dump(source), encoding="utf-8")
    with pytest.raises(GenerationError, match="non-retail structure"):
        eligibility_configuration(broken)


def test_a_rule_naming_an_ungoverned_category_is_refused(tmp_path: Path) -> None:
    source = yaml.safe_load(resolve_eligibility_path().read_text(encoding="utf-8"))
    source["rules"][0]["categories"] = ["Extended Warranty"]
    broken = tmp_path / "fi_product_eligibility.yaml"
    broken.write_text(yaml.safe_dump(source), encoding="utf-8")
    with pytest.raises(GenerationError, match="outside the governed ten"):
        eligibility_configuration(broken)


# --------------------------------------------------------------------------------------
# The predicate itself
# --------------------------------------------------------------------------------------


def test_no_category_is_eligible_on_a_disposal() -> None:
    for structure in (FINANCE_STRUCTURE_WHOLESALE, FINANCE_STRUCTURE_DEALER_TRADE):
        for condition in CONDITIONS:
            assert (
                eligible_categories(finance_structure=structure, vehicle_condition=condition)
                == ()
            )


def test_gap_is_eligible_only_on_a_financed_retail_deal() -> None:
    """The rule that exists to stop a GAP penetration over all retail deals."""
    for condition in CONDITIONS:
        assert is_category_eligible(
            "GAP",
            finance_structure=FINANCE_STRUCTURE_RETAIL_FINANCE,
            vehicle_condition=condition,
        )
        assert not is_category_eligible(
            "GAP", finance_structure=FINANCE_STRUCTURE_CASH, vehicle_condition=condition
        )
        assert not is_category_eligible(
            "GAP", finance_structure=FINANCE_STRUCTURE_LEASE, vehicle_condition=condition
        )


def test_lease_wear_protection_is_eligible_only_on_a_lease() -> None:
    for condition in CONDITIONS:
        assert is_category_eligible(
            "Lease Wear Protection",
            finance_structure=FINANCE_STRUCTURE_LEASE,
            vehicle_condition=condition,
        )
        for structure in (FINANCE_STRUCTURE_CASH, FINANCE_STRUCTURE_RETAIL_FINANCE):
            assert not is_category_eligible(
                "Lease Wear Protection",
                finance_structure=structure,
                vehicle_condition=condition,
            )


def test_prepaid_maintenance_narrows_on_vehicle_condition() -> None:
    """The one rule whose condition dimension is behavioural rather than decorative."""
    for structure in RETAIL_FINANCE_STRUCTURES:
        assert is_category_eligible(
            "Prepaid Maintenance", finance_structure=structure, vehicle_condition="New"
        )
        assert is_category_eligible(
            "Prepaid Maintenance", finance_structure=structure, vehicle_condition="Certified"
        )
        assert not is_category_eligible(
            "Prepaid Maintenance", finance_structure=structure, vehicle_condition="Used"
        )


def test_every_retail_deal_has_at_least_one_eligible_category() -> None:
    """Otherwise a retail deal could carry F&I gross with nothing to attribute it to.

    The forced-line branch in the decomposition engine raises rather than inventing a
    product when this is not true, and this asserts the branch is unreachable in practice.
    """
    for structure in RETAIL_FINANCE_STRUCTURES:
        for condition in CONDITIONS:
            assert eligible_categories(
                finance_structure=structure, vehicle_condition=condition
            ), f"{structure}/{condition} has no eligible category"


def test_eligible_categories_returns_governed_order() -> None:
    """Determinism: the basket draw iterates this, so the order is part of the contract."""
    result = eligible_categories(
        finance_structure=FINANCE_STRUCTURE_RETAIL_FINANCE, vehicle_condition="New"
    )
    assert list(result) == [name for name in FINANCE_PRODUCT_CATEGORIES if name in result]


def test_the_predicate_takes_no_customer_attribute() -> None:
    """The guarantee in its strongest form: there is nowhere to pass one in.

    A test that asserted "the answer does not vary with customer age" would need an age
    parameter to vary. The signature has none, and neither does the rule schema -- which is
    why the promise is structural rather than behavioural.
    """
    import inspect

    parameters = set(inspect.signature(is_category_eligible).parameters)
    assert parameters == {"category", "finance_structure", "vehicle_condition", "config"}

    declared = yaml.safe_load(resolve_eligibility_path().read_text(encoding="utf-8"))
    permitted_keys = {"rule_id", "label", "categories", "finance_structures",
                      "vehicle_conditions", "rationale"}
    for rule in declared["rules"]:
        assert set(rule) <= permitted_keys, (
            f"{rule.get('rule_id')} declares keys outside the permitted schema: "
            f"{sorted(set(rule) - permitted_keys)}. Eligibility may depend on the "
            "transaction's structure and the vehicle's condition, and on nothing else."
        )


def test_the_configuration_declares_a_version() -> None:
    """A stored rule id is only interpretable against the predicate that was in force."""
    assert eligibility_configuration().version >= 1
