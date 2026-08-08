"""The F&I generators: the two catalogues, the decomposition, and the adjustment events.

The assertions here are about the properties the domain's correctness rests on, not about
particular drawn values: determinism, the back-gross identity to the cent, the eligibility
guarantee, the adjustment cap and sequence rules, and the fact that the catalogue's
sensitivity flags genuinely govern behaviour rather than decorating a row.
"""

from __future__ import annotations

import random
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    ADJUSTMENT_REASON_CATEGORIES,
    ADJUSTMENT_TYPE_CANCELLATION,
    ADJUSTMENT_TYPE_CHARGEBACK,
    ADJUSTMENT_TYPE_REINSTATEMENT,
    ADJUSTMENT_TYPES,
    FINANCE_PRODUCT_CATEGORIES,
    LENDER_CATEGORIES,
    LENDER_PROGRAM_TIERS,
)
from arpi.exceptions import GenerationError
from arpi.generation.finance_deal import (
    DealInput,
    _allocate,
    decompose_deals,
)
from arpi.generation.finance_product import (
    FICTIONAL_PROVIDERS,
    FINANCE_PRODUCT_DEFINITIONS,
    finance_products_by_category,
    generate_finance_product_dataset,
    validate_finance_product_dataset,
)
from arpi.generation.finance_product_adjustment import (
    build_finance_product_adjustment_records,
    generate_finance_product_adjustment_dataset,
    net_product_gross_as_of,
    validate_finance_product_adjustment_dataset,
)
from arpi.generation.finance_product_sale import (
    build_finance_product_sale_records,
    generate_finance_product_sale_dataset,
    validate_finance_product_sale_dataset,
)
from arpi.generation.lender import (
    LENDER_DEFINITIONS,
    assign_lender,
    generate_lender_dataset,
    validate_lender_dataset,
)
from arpi.generation.sale import build_sale_records, deal_finance_records
from arpi.utilities.seeding import rng_for

REPO_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
_ZERO = Decimal("0.00")


@pytest.fixture(scope="module")
def config() -> ArpiConfig:
    """The test profile: a two-month window, which keeps the whole module fast."""
    return load_config(profile="test", config_dir=REPO_CONFIG_DIR)


@pytest.fixture(scope="module")
def finance(config: ArpiConfig) -> dict[str, Any]:
    return deal_finance_records(config)


@pytest.fixture(scope="module")
def sales(config: ArpiConfig) -> dict[str, Any]:
    return {record.sale_id: record for record in build_sale_records(config)}


# ======================================================================================
# dim_finance_product
# ======================================================================================


def test_the_catalogue_covers_all_ten_governed_categories() -> None:
    grouped = finance_products_by_category()
    assert set(grouped) == set(FINANCE_PRODUCT_CATEGORIES)
    for category, products in grouped.items():
        assert products, f"{category} exists only as a placeholder"


def test_every_provider_is_one_of_the_declared_fictional_administrators() -> None:
    assert {p.provider_name for p in FINANCE_PRODUCT_DEFINITIONS} <= set(FICTIONAL_PROVIDERS)


def test_the_product_generator_is_seed_independent(config: ArpiConfig) -> None:
    """The catalogue is reference data, so two seeds must produce identical bytes."""
    other = config.model_copy(update={"random_seed": config.random_seed + 7})
    first = generate_finance_product_dataset(config).frame
    second = generate_finance_product_dataset(other).frame
    assert first.equals(second)


def test_the_product_catalogue_passes_its_own_dq_suite(config: ArpiConfig) -> None:
    report = validate_finance_product_dataset(generate_finance_product_dataset(config))
    assert not report.has_critical_failure
    assert len(report) == 12


def test_both_sensitivity_flags_genuinely_vary() -> None:
    """A constant flag is decoration, and decoration is eventually read as a finding."""
    assert len({p.cancellation_sensitive for p in FINANCE_PRODUCT_DEFINITIONS}) == 2
    assert len({p.chargeback_sensitive for p in FINANCE_PRODUCT_DEFINITIONS}) == 2


def test_the_dimension_declares_no_type_2_history_columns(config: ArpiConfig) -> None:
    frame = generate_finance_product_dataset(config).frame
    for forbidden in ("effective_date", "expiration_date", "is_current", "attribute_hash"):
        assert forbidden not in frame.columns


def test_the_dimension_carries_no_price_cost_or_rate(config: ArpiConfig) -> None:
    """A price here would be a second authority beside the one struck on the contract."""
    columns = {str(name).casefold() for name in generate_finance_product_dataset(config).frame}
    for forbidden in ("price", "cost", "rate", "reserve", "commission", "apr", "payment"):
        assert not any(forbidden in name for name in columns), (
            f"dim_finance_product declares a {forbidden!r} column"
        )


# ======================================================================================
# dim_lender
# ======================================================================================


def test_the_lender_catalogue_covers_every_governed_category_and_tier() -> None:
    assert {d.lender_category for d in LENDER_DEFINITIONS} == set(LENDER_CATEGORIES)
    assert {d.program_tier for d in LENDER_DEFINITIONS} <= set(LENDER_PROGRAM_TIERS)
    assert len({d.program_tier for d in LENDER_DEFINITIONS}) == 3


def test_the_lender_generator_is_seed_independent(config: ArpiConfig) -> None:
    other = config.model_copy(update={"random_seed": config.random_seed + 7})
    assert generate_lender_dataset(config).frame.equals(generate_lender_dataset(other).frame)


def test_the_lender_catalogue_passes_its_own_dq_suite(config: ArpiConfig) -> None:
    report = validate_lender_dataset(generate_lender_dataset(config))
    assert not report.has_critical_failure
    assert len(report) == 10


def test_lender_assignment_depends_only_on_store_structure_and_seed() -> None:
    """The guarantee in its strongest form: there is nowhere to pass a customer in."""
    import inspect

    parameters = set(inspect.signature(assign_lender).parameters)
    assert parameters == {"rng", "dealership_id", "finance_structure"}


def test_a_cash_deal_and_a_disposal_carry_no_lender() -> None:
    rng = random.Random(1)
    for structure in ("Cash", "Wholesale", "Dealer Trade"):
        assert assign_lender(rng, dealership_id="GSA-001", finance_structure=structure) is None


def test_a_captive_writes_its_own_franchise_and_almost_never_another() -> None:
    """Lender mix differs by STORE, which is a property of the store and not of a person."""
    rng = rng_for(20250701, "lender-affinity-test")
    home = Counter(
        assign_lender(rng, dealership_id="GSA-001", finance_structure="Retail Finance")
        for _ in range(600)
    )
    away = Counter(
        assign_lender(rng, dealership_id="GSA-002", finance_structure="Retail Finance")
        for _ in range(600)
    )
    assert home["LND-001"] > away["LND-001"] * 5


# ======================================================================================
# The decomposition: the back-gross identity
# ======================================================================================


def test_every_deal_decomposes_to_its_stored_back_end_gross_exactly(
    finance: dict[str, Any], sales: dict[str, Any]
) -> None:
    """THE HEADLINE IDENTITY, to the cent, on every deal, with no plug anywhere."""
    for sale_id, deal in finance.items():
        assert deal.decomposed_back_end_gross == sales[sale_id].back_end_gross, sale_id


def test_the_decomposition_is_deterministic_under_one_seed(config: ArpiConfig) -> None:
    first = deal_finance_records(config)
    second = deal_finance_records(config)
    assert list(first) == list(second)
    for sale_id, deal in first.items():
        other = second[sale_id]
        assert deal.finance_reserve_gross == other.finance_reserve_gross
        assert deal.lender_id == other.lender_id
        assert deal.products == other.products


def test_a_different_seed_produces_a_different_decomposition(config: ArpiConfig) -> None:
    # Deliberately not a round number and deliberately not the test profile own
    # seed, which is 424242 -- an earlier revision of this test picked exactly that
    # and passed while proving nothing.
    other = deal_finance_records(config.model_copy(update={"random_seed": 99_000_017}))
    base = deal_finance_records(config)
    assert any(
        base[sale_id].products != other[sale_id].products for sale_id in base if sale_id in other
    ), "the decomposition did not vary with the seed, so it is not actually drawing"


def test_no_monetary_value_is_a_float(finance: dict[str, Any]) -> None:
    for deal in finance.values():
        assert isinstance(deal.finance_reserve_gross, Decimal)
        for line in deal.products:
            for value in (
                line.product_retail_price,
                line.product_dealer_cost,
                line.original_product_gross,
            ):
                assert isinstance(value, Decimal)
                # Quantized to the cent. `exponent` is an int on a finite Decimal; the
                # 'n'/'N'/'F' literals belong to NaN and infinity, which a monetary value
                # can never be -- and which the isinstance check above does not exclude.
                exponent = value.as_tuple().exponent
                assert isinstance(exponent, int), f"{value!r} is not a finite Decimal"
                assert -exponent <= 2


def test_the_product_price_identity_holds_on_every_line(finance: dict[str, Any]) -> None:
    for deal in finance.values():
        for line in deal.products:
            assert (
                line.original_product_gross == line.product_retail_price - line.product_dealer_cost
            )
            assert line.product_retail_price >= 0
            assert line.product_dealer_cost >= 0


def test_reserve_appears_only_on_a_retail_finance_deal(
    finance: dict[str, Any], sales: dict[str, Any]
) -> None:
    for sale_id, deal in finance.items():
        if deal.finance_structure != "Retail Finance":
            assert deal.finance_reserve_gross == _ZERO, (
                f"{sale_id}: a {deal.finance_structure} deal earned reserve"
            )
        assert deal.finance_reserve_gross >= 0
        assert sales[sale_id].sale_id == sale_id


def test_a_lease_gets_a_lender_but_never_reserve(finance: dict[str, Any]) -> None:
    """The recorded design decision, in one test.

    ARPI models no money factor, so a lease has no rate mechanic a reserve could be
    attributed to -- but its funding source exists and is analytically useful, so the
    lender is carried and the reserve is not.
    """
    leases = [deal for deal in finance.values() if deal.finance_structure == "Lease"]
    assert leases, "the fixture contains no lease, so the rule is untested"
    for deal in leases:
        assert deal.finance_reserve_gross == _ZERO
        assert deal.lender_id is not None


def test_a_disposal_carries_no_reserve_no_lender_and_no_product(
    finance: dict[str, Any],
) -> None:
    disposals = [
        deal for deal in finance.values() if deal.finance_structure in ("Wholesale", "Dealer Trade")
    ]
    assert disposals, "the fixture contains no disposal, so the rule is untested"
    for deal in disposals:
        assert deal.finance_reserve_gross == _ZERO
        assert deal.lender_id is None
        assert deal.products == ()


def test_a_non_retail_deal_carrying_fi_gross_is_refused() -> None:
    """Asserted rather than assumed: it would otherwise be silently unexplainable."""
    deal = DealInput(
        sale_id="SLE-00000001",
        sale_date=date(2025, 1, 5),
        dealership_id="GSA-001",
        sale_type="Wholesale",
        is_retail=False,
        amount_financed=_ZERO,
        back_end_gross=Decimal("500.00"),
        finance_manager_id=None,
        manager_skill=None,
        condition_type="Used",
    )
    with pytest.raises(GenerationError, match="produce no F&I income"):
        decompose_deals((deal,), random.Random(1))


def test_a_cash_deal_with_fi_gross_carries_a_product_rather_than_reserve() -> None:
    """Reserve is impossible on a cash deal, so the gross must attach to a contract."""
    deal = DealInput(
        sale_id="SLE-00000002",
        sale_date=date(2025, 1, 5),
        dealership_id="GSA-001",
        sale_type="Used Retail",
        is_retail=True,
        amount_financed=_ZERO,
        back_end_gross=Decimal("1200.00"),
        finance_manager_id="EMP-00001",
        manager_skill=1.0,
        condition_type="Used",
    )
    (result,) = decompose_deals((deal,), random.Random(11))
    assert result.finance_structure == "Cash"
    assert result.finance_reserve_gross == _ZERO
    assert result.products, "a cash deal with F&I gross had nothing to attribute it to"
    assert result.decomposed_back_end_gross == Decimal("1200.00")


def test_no_cash_deal_ever_carries_gap(finance: dict[str, Any]) -> None:
    for deal in finance.values():
        if deal.finance_structure != "Cash":
            continue
        assert all(line.product_category != "GAP" for line in deal.products)


def test_lease_wear_protection_appears_only_on_a_lease(finance: dict[str, Any]) -> None:
    for deal in finance.values():
        if deal.finance_structure == "Lease":
            continue
        assert all(line.product_category != "Lease Wear Protection" for line in deal.products)


def test_the_population_contains_every_required_basket_state(
    finance: dict[str, Any],
) -> None:
    """The distribution-sanity requirement, asserted rather than hoped for."""
    sizes = Counter(len(deal.products) for deal in finance.values())
    retail = [deal for deal in finance.values() if deal.finance_structure != "Wholesale"]
    assert sizes[0] > 0, "no deal carried zero products"
    assert sizes[1] > 0, "no single-product deal"
    assert sum(count for size, count in sizes.items() if size >= 2) > 0, "no multi-product deal"
    assert any(
        deal.finance_structure == "Retail Finance"
        and not deal.products
        and deal.finance_reserve_gross > 0
        for deal in finance.values()
    ), "no financed deal with reserve and no product"
    assert retail


def test_a_deal_never_carries_the_same_product_definition_twice(
    finance: dict[str, Any],
) -> None:
    for sale_id, deal in finance.items():
        ids = [line.finance_product_id for line in deal.products]
        assert len(ids) == len(set(ids)), f"{sale_id} repeats a product definition"


def test_line_ordinals_are_contiguous_from_one(finance: dict[str, Any]) -> None:
    for deal in finance.values():
        assert [line.line_ordinal for line in deal.products] == list(
            range(1, len(deal.products) + 1)
        )


# --------------------------------------------------------------------------------------
# The allocation, tested directly: it is the identity's mechanism
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("total", "weights"),
    [
        ("1000.00", ("1.0", "1.0", "1.0")),
        ("0.07", ("1.0", "1.0", "1.0")),
        ("999.99", ("1.22", "0.46", "0.31", "0.21")),
        ("1.00", ("1.0",)),
        ("12345.67", ("1.35", "1.0")),
    ],
)
def test_the_allocation_lands_on_the_cent_with_no_residue(
    total: str, weights: tuple[str, ...]
) -> None:
    """LARGEST REMAINDER, not proportional-then-fix-the-last-one.

    The second would make the final line of every basket absorb the whole rounding error,
    which is a plug wearing a product's name.
    """
    amount = Decimal(total)
    allocated = _allocate(amount, tuple(Decimal(w) for w in weights))
    assert sum(allocated, start=Decimal("0")) == amount
    assert all(value >= 0 for value in allocated)
    assert len(allocated) == len(weights)


def test_the_allocation_spreads_the_remainder_rather_than_parking_it() -> None:
    """Three equal weights over one cent more than divides: exactly one line gets it."""
    allocated = _allocate(Decimal("0.04"), (Decimal("1"), Decimal("1"), Decimal("1")))
    assert sum(allocated, start=Decimal("0")) == Decimal("0.04")
    assert sorted(allocated) == [Decimal("0.01"), Decimal("0.01"), Decimal("0.02")]


# ======================================================================================
# fact_finance_product_sale
# ======================================================================================


def test_the_product_sale_entity_passes_its_own_dq_suite(config: ArpiConfig) -> None:
    dataset = generate_finance_product_sale_dataset(config)
    report = validate_finance_product_sale_dataset(dataset, config)
    assert not report.has_critical_failure
    assert len(report) == 16


def test_the_product_sale_entity_is_deterministic(config: ArpiConfig) -> None:
    first = generate_finance_product_sale_dataset(config).frame
    second = generate_finance_product_sale_dataset(config).frame
    assert first.equals(second)


def test_every_contract_resolves_to_a_finalized_deal(
    config: ArpiConfig, sales: dict[str, Any]
) -> None:
    for record in build_finance_product_sale_records(config):
        assert record.sale_id in sales
        parent = sales[record.sale_id]
        assert record.sale_date == parent.sale_date
        assert record.dealership_id == parent.dealership_id
        assert record.finance_manager_id == parent.finance_manager_id


def test_a_transaction_without_a_finance_manager_is_permitted(config: ArpiConfig) -> None:
    """A store with nobody on the F&I desk still delivers cars.

    That is a modelled state, not a missing value, and contracts written on such a deal
    are legitimate rather than defective.
    """
    records = build_finance_product_sale_records(config)
    assert any(record.finance_manager_id is None for record in records), (
        "no contract was written without a finance manager, so the allowed-transaction "
        "case is untested"
    )


# ======================================================================================
# fact_finance_product_adjustment
# ======================================================================================


@pytest.fixture(scope="module")
def development_config() -> ArpiConfig:
    """The development profile, whose six-month window produces enough events to test.

    The two-month test profile is deliberately short and produces almost no adjustments --
    the lag distribution is truncated by the window, which is a real property of the
    dataset rather than a defect. Asserting adjustment behaviour against a fixture that
    contains one event would be asserting nothing.
    """
    return load_config(profile="development", config_dir=REPO_CONFIG_DIR)


@pytest.fixture(scope="module")
def adjustments(development_config: ArpiConfig) -> tuple[Any, ...]:
    return build_finance_product_adjustment_records(development_config)


@pytest.fixture(scope="module")
def contracts(development_config: ArpiConfig) -> dict[str, Any]:
    return {
        record.product_sale_id: record
        for record in build_finance_product_sale_records(development_config)
    }


def test_the_adjustment_entity_passes_its_own_dq_suite(development_config: ArpiConfig) -> None:
    dataset = generate_finance_product_adjustment_dataset(development_config)
    report = validate_finance_product_adjustment_dataset(dataset, development_config)
    assert not report.has_critical_failure
    assert len(report) == 13


def test_the_adjustment_entity_is_deterministic(development_config: ArpiConfig) -> None:
    first = generate_finance_product_adjustment_dataset(development_config).frame
    second = generate_finance_product_adjustment_dataset(development_config).frame
    assert first.equals(second)


def test_every_governed_event_type_is_produced(adjustments: tuple[Any, ...]) -> None:
    produced = {record.adjustment_type for record in adjustments}
    assert produced <= set(ADJUSTMENT_TYPES)
    for required in (
        ADJUSTMENT_TYPE_CANCELLATION,
        ADJUSTMENT_TYPE_CHARGEBACK,
        ADJUSTMENT_TYPE_REINSTATEMENT,
    ):
        assert required in produced, f"no {required} was generated, so its rules are untested"


def test_no_adjustment_predates_its_own_contract(
    adjustments: tuple[Any, ...], contracts: dict[str, Any]
) -> None:
    for record in adjustments:
        assert record.adjustment_date >= contracts[record.product_sale_id].sale_date


def test_at_least_one_adjustment_lands_in_a_different_month_from_its_sale(
    adjustments: tuple[Any, ...], contracts: dict[str, Any]
) -> None:
    """The cross-month case the date-basis rule exists for."""
    crossing = [
        record
        for record in adjustments
        if (record.adjustment_date.year, record.adjustment_date.month)
        != (
            contracts[record.product_sale_id].sale_date.year,
            contracts[record.product_sale_id].sale_date.month,
        )
    ]
    assert crossing, "no adjustment crossed a month boundary, so the date basis is untested"


def test_the_sign_convention_holds_per_type(adjustments: tuple[Any, ...]) -> None:
    for record in adjustments:
        if record.adjustment_type in (ADJUSTMENT_TYPE_CANCELLATION, ADJUSTMENT_TYPE_CHARGEBACK):
            assert record.adjustment_amount > 0
        elif record.adjustment_type == ADJUSTMENT_TYPE_REINSTATEMENT:
            assert record.adjustment_amount < 0
        else:
            assert record.adjustment_amount != 0


def test_every_reason_belongs_to_its_own_type(adjustments: tuple[Any, ...]) -> None:
    for record in adjustments:
        assert (
            record.adjustment_reason_category
            in ADJUSTMENT_REASON_CATEGORIES[record.adjustment_type]
        )


def test_the_cumulative_cap_holds_after_every_event(
    adjustments: tuple[Any, ...], contracts: dict[str, Any]
) -> None:
    """The cap is checked after every event, not only at the end of the sequence.

    A pair of events that breached the cap and came back inside it would otherwise pass,
    and the net gross between them would have been a figure the model says is impossible.
    """
    by_contract: dict[str, list[Any]] = {}
    for record in adjustments:
        by_contract.setdefault(record.product_sale_id, []).append(record)
    for product_sale_id, events in by_contract.items():
        original = contracts[product_sale_id].original_product_gross
        cumulative = _ZERO
        for event in sorted(events, key=lambda e: (e.adjustment_date, e.sequence_ordinal)):
            cumulative += event.adjustment_amount
            assert _ZERO <= cumulative <= original, (
                f"{product_sale_id} breached the cap at step {event.sequence_ordinal}"
            )


def test_a_reinstatement_always_follows_a_reduction(
    adjustments: tuple[Any, ...],
) -> None:
    by_contract: dict[str, list[Any]] = {}
    for record in adjustments:
        by_contract.setdefault(record.product_sale_id, []).append(record)
    for product_sale_id, events in by_contract.items():
        ordered = sorted(events, key=lambda e: (e.adjustment_date, e.sequence_ordinal))
        reduced = _ZERO
        for event in ordered:
            if event.adjustment_type == ADJUSTMENT_TYPE_REINSTATEMENT:
                assert reduced > 0, f"{product_sale_id} reinstates with nothing reduced"
                assert -event.adjustment_amount <= reduced
            reduced += event.adjustment_amount


def test_the_sensitivity_flags_govern_which_events_can_exist(
    adjustments: tuple[Any, ...], contracts: dict[str, Any]
) -> None:
    """What makes the two dimension columns behavioural rather than decorative."""
    for record in adjustments:
        contract = contracts[record.product_sale_id]
        if record.adjustment_type == ADJUSTMENT_TYPE_CANCELLATION:
            assert contract.cancellation_sensitive
        if record.adjustment_type == ADJUSTMENT_TYPE_CHARGEBACK:
            assert contract.chargeback_sensitive


def test_the_as_of_arithmetic_excludes_a_later_event(
    adjustments: tuple[Any, ...], contracts: dict[str, Any]
) -> None:
    """Evaluated the day BEFORE, the day OF and the day AFTER one event."""
    event = adjustments[0]
    contract = contracts[event.product_sale_id]
    same_contract = tuple(
        record for record in adjustments if record.product_sale_id == event.product_sale_id
    )
    original = contract.original_product_gross

    from datetime import timedelta

    before = net_product_gross_as_of(
        original, same_contract, event.adjustment_date - timedelta(days=1)
    )
    on_day = net_product_gross_as_of(original, same_contract, event.adjustment_date)
    assert before in (original, on_day) or before > on_day
    assert on_day <= before
    assert on_day == original - sum(
        (
            record.adjustment_amount
            for record in same_contract
            if record.adjustment_date <= event.adjustment_date
        ),
        start=_ZERO,
    )
