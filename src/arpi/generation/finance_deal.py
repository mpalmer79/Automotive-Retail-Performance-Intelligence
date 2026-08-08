"""The F&I decomposition engine: what the back-end gross of one deal is actually made of.

WHAT THIS MODULE DECIDES
------------------------
For every finalized transaction: its derived finance structure, the fictional lender
behind it (or the fact that none exists), the finance reserve it earned, and the basket
of product contracts written on it -- each with an exact retail price, dealer cost and
original gross.

THE GENERATION STRATEGY, AND WHY IT IS THIS ONE (DASH.6-01)
------------------------------------------------------------
Two strategies were available and both are defensible. They are recorded here rather
than in a commit message because the choice governs how every existing number in ARPI
behaves.

**A. Component-first rebase.** Draw reserve and products first, then set
``back_end_gross = finance_reserve_gross + SUM(original_product_gross)``. Honest, simple,
and it moves the synthetic baseline of every retail deal in the repository.

**B. Decomposition-preserving (CHOSEN).** The existing back-end gross draw in
:mod:`arpi.generation.sale` stays exactly as it is, and this module explains it: every
cent of a deal's ``back_end_gross`` is allocated to a named component. Nothing is
rebased, so DASH.2 through DASH.5 -- the committed dashboard exports, the target
attainment figures, the gross bridge, the deal jacket -- keep the numbers they were
built and reviewed against, while gaining an explanation beneath them.

B was chosen because the thing DASH.6 was asked for is an EXPLANATION of an aggregate
that already exists, and because a rebase would have moved several hundred committed
artifact values for no analytical gain. The cost of B is stated plainly: the reserve and
product amounts on a deal are shares of a total that was drawn first, so they are
*decompositions* rather than independent draws. What that does **not** cost is
correctness -- every component still obeys its own generation rule, every category still
has its own economics, and no component is a plug.

**THERE IS NO BALANCING PLUG.** ``other_fi_income`` is exactly ``0.00`` and is not a
column anywhere. The allocation reaches the cent by LARGEST REMAINDER over the basket's
declared gross weights (:func:`_allocate`), which distributes the rounding residue across
real product lines instead of parking it in a residual bucket. When the basket is empty
the whole amount is the reserve, and when reserve is impossible the whole amount is
product gross. Every branch sums to the deal's stored ``back_end_gross`` exactly, and
:func:`decompose_deals` asserts it on every deal before returning.

**NO CIRCULARITY.** The dependency runs one way: ``back_end_gross`` is an input here and
is never written back. This module does not import :mod:`arpi.generation.sale`, which is
what makes that structural rather than promised -- ``sale.py`` imports *this*, builds
:class:`DealInput` records from its own draws, and takes the reserve and lender back.

WHAT DRIVES ATTACHMENT, AND WHAT MAY NEVER
------------------------------------------
Attachment probability varies with the store's operating model, the finance manager's
synthetic skill index, the derived finance structure, the product category, the vehicle's
condition through eligibility, and seeded randomness. It varies with **nothing about a
customer**: no demographic, no protected characteristic, no credit datum, no income, no
age, no geography and no inferred willingness to buy. There is no such attribute anywhere
in the inputs, which is the strongest form the guarantee can take.

Nothing here is a recommendation. The model describes synthetic outcomes; it does not say
what a store should sell, what it should charge, or what any penetration ought to be.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Final

from arpi.constants import (
    FINANCE_PRODUCT_CATEGORIES,
    FINANCE_STRUCTURE_CASH,
    FINANCE_STRUCTURE_LEASE,
    FINANCE_STRUCTURE_RETAIL_FINANCE,
)
from arpi.exceptions import GenerationError
from arpi.generation.fi_eligibility import (
    EligibilityConfiguration,
    eligibility_configuration,
    eligible_categories,
    finance_structure_for,
)
from arpi.generation.finance_product import (
    CONTRACT_TERM_BOUNDS,
    FINANCE_PRODUCTS_BY_ID,
    FinanceProductDefinition,
    finance_products_by_category,
)
from arpi.generation.lender import assign_lender

__all__ = [
    "CATEGORY_ATTACH_BASE",
    "DealFinance",
    "DealInput",
    "MINIMUM_PRODUCT_GROSS",
    "ProductLine",
    "decompose_deals",
]

_ENTITY: Final = "finance_product_sale"
_ZERO: Final = Decimal("0.00")
_CENTS: Final = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    """Quantize to the cent, half-up. The only rounding this module performs."""
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------------------
# Generation parameters -- PROJECT DEFAULTS FOR A FICTIONAL GROUP
# ---------------------------------------------------------------------------------------
# None of these is an industry benchmark, a market rate or a target. They are parameters
# of a synthetic model for Granite Auto Group, declared here beside the code that reads
# them, exactly as PACK_AMOUNT_BY_STORE and STORE_PLANNING_BASELINE are.

#: Probability that an eligible category attaches to a deal, before the structure, store,
#: manager and condition adjustments below. Ordered by category so the draw sequence is
#: stable: the generator consumes one variate per eligible category on every deal,
#: whether or not the category attaches, so adding a category cannot shift the stream of
#: an earlier one.
CATEGORY_ATTACH_BASE: Final[dict[str, float]] = {
    "Vehicle Service Contract": 0.44,
    "GAP": 0.52,
    "Tire & Wheel": 0.30,
    "Prepaid Maintenance": 0.26,
    "Appearance Protection": 0.22,
    "Key Replacement": 0.14,
    "Theft or Security Product": 0.11,
    "Paintless Dent Protection": 0.16,
    "Lease Wear Protection": 0.48,
    "Other Aftermarket Product": 0.13,
}

#: Structure multiplier on attachment. A cash buyer is in the F&I office for less time
#: and takes fewer products; a lease carries a narrower menu.
STRUCTURE_ATTACH_FACTOR: Final[dict[str, float]] = {
    FINANCE_STRUCTURE_CASH: 0.62,
    FINANCE_STRUCTURE_RETAIL_FINANCE: 1.00,
    FINANCE_STRUCTURE_LEASE: 0.85,
}

#: Store multiplier on attachment: the operating model of the store, not of its customers.
#: The independent pre-owned centre leans harder on F&I because it has no captive
#: relationship and a thinner front end; the Subaru franchise runs a lighter menu.
STORE_ATTACH_FACTOR: Final[dict[str, float]] = {
    "GSA-001": 1.00,
    "GSA-002": 0.92,
    "GSA-003": 1.12,
}
DEFAULT_STORE_ATTACH_FACTOR: Final = 1.00

#: Multiplier applied when no finance manager was credited on the deal. The transaction
#: is legitimate -- a store with nobody on the F&I desk that day still delivers cars --
#: and it attaches materially fewer products.
UNSTAFFED_ATTACH_FACTOR: Final = 0.55

#: Bounds the finance manager's synthetic skill index is clamped to before it multiplies
#: an attachment probability, so no single latent parameter can drive a deal to certainty.
MANAGER_SKILL_BOUNDS: Final[tuple[float, float]] = (0.70, 1.30)

#: Probability that a deal carrying an Other Aftermarket Product carries a SECOND, distinct
#: one. This is the one category where two contracts on a single deal is realistic -- a
#: windscreen plan and a roadside plan are different products -- and it is why penetration
#: counts DISTINCT DEALS rather than contract rows. Without it, that rule would be
#: untestable because the two counts would coincide on every row of the dataset.
SECOND_OTHER_PRODUCT_SHARE: Final = 0.18

#: Share of Retail Finance deals that earn NO reserve at all. A flat-fee or no-reserve
#: program is ordinary, and a dataset where every financed deal earned reserve would make
#: `finance_reserve_gross = 0.00` look like missing data rather than a modelled outcome.
NO_RESERVE_SHARE: Final = 0.09

#: The share of a financed deal's back-end gross that is finance reserve, drawn
#: ``(low, high, mode)``. The remainder is product gross.
RESERVE_SHARE_OF_BACK_GROSS: Final[tuple[float, float, float]] = (0.10, 0.55, 0.28)

#: The smallest original gross a product line may be allocated. A basket is trimmed to
#: what the deal's product budget can actually carry, so a thin deal produces one product
#: rather than six three-dollar ones.
MINIMUM_PRODUCT_GROSS: Final = Decimal("75.00")

#: Jitter applied to a product's declared dealer-cost ratio, drawn ``(low, high)``. Cost
#: differs a little between contracts of the same product; the ratio itself is the
#: catalogue's.
DEALER_COST_RATIO_JITTER: Final[tuple[float, float]] = (0.90, 1.10)

#: The contract-term variations a product line may take against its catalogue default,
#: and their weights. THE PRODUCT CONTRACT'S term, never a loan term.
CONTRACT_TERM_OFFSETS: Final[tuple[int, ...]] = (-12, 0, 0, 0, 12)


# ---------------------------------------------------------------------------------------
# Inputs and outputs
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class DealInput:
    """Everything this module needs about one finalized transaction.

    A deliberately small, self-contained structure. It is what keeps this module free of
    any import from :mod:`arpi.generation.sale`, and therefore free of the circular
    dependency that a "derive products, recompute back gross, re-derive products" design
    would have needed.

    Attributes:
        sale_id: The transaction's identifier. Fixes the iteration order.
        sale_date: The deal date. Every product line inherits it.
        dealership_id: Selling store.
        sale_type: One of the six governed sale types.
        is_retail: Derived from ``sale_type`` by the sale generator.
        amount_financed: Exact financed amount; zero on a cash deal.
        back_end_gross: The deal's stored F&I gross. THE BUDGET THIS MODULE DECOMPOSES.
        finance_manager_id: The F&I manager credited, or ``None``.
        manager_skill: The credited manager's synthetic gross-retention index, or ``None``
            when no manager was credited. A generation latent, never published.
        condition_type: ``New``, ``Used`` or ``Certified``.
    """

    sale_id: str
    sale_date: date
    dealership_id: str
    sale_type: str
    is_retail: bool
    amount_financed: Decimal
    back_end_gross: Decimal
    finance_manager_id: str | None
    manager_skill: float | None
    condition_type: str


@dataclass(frozen=True, slots=True)
class ProductLine:
    """One product contract written on one deal.

    Attributes:
        line_ordinal: 1-based position within the deal, in catalogue-category order.
        finance_product_id: The catalogued product.
        product_category: Its governed category, denormalised for the fact's own checks.
        eligibility_rule_id: The rule the deal satisfied for this category.
        product_retail_price: What the customer was charged, exact.
        product_dealer_cost: What the product cost the store, exact.
        original_product_gross: ``product_retail_price - product_dealer_cost``, exact.
            The DEAL-DATE production figure; later adjustments never change it.
        contract_term_months: The PRODUCT CONTRACT's term. Not a loan term.
    """

    line_ordinal: int
    finance_product_id: str
    product_category: str
    eligibility_rule_id: str
    product_retail_price: Decimal
    product_dealer_cost: Decimal
    original_product_gross: Decimal
    contract_term_months: int


@dataclass(frozen=True, slots=True)
class DealFinance:
    """The complete F&I decomposition of one deal.

    Attributes:
        sale_id: The transaction this describes.
        finance_structure: Cash, Retail Finance, Lease, Wholesale or Dealer Trade.
        lender_id: The fictional lender, or ``None`` where none exists.
        finance_reserve_gross: The finance-office income on the financing itself, exact.
            ``0.00`` is a modelled outcome, never a missing value.
        products: The contracts written, in ``line_ordinal`` order. May be empty.
    """

    sale_id: str
    finance_structure: str
    lender_id: str | None
    finance_reserve_gross: Decimal
    products: tuple[ProductLine, ...]

    @property
    def original_product_gross(self) -> Decimal:
        """Total deal-date product gross on this deal, exact."""
        return sum(
            (line.original_product_gross for line in self.products), start=_ZERO
        )

    @property
    def decomposed_back_end_gross(self) -> Decimal:
        """``finance_reserve_gross + SUM(original_product_gross)``.

        The identity ``RECON-FI-001`` proves in SQL. ``other_fi_income`` is exactly
        ``0.00`` and is deliberately not a term: a zero that is never anything else is a
        place a future plug would hide.
        """
        return _money(self.finance_reserve_gross + self.original_product_gross)


# ---------------------------------------------------------------------------------------
# The decomposition
# ---------------------------------------------------------------------------------------
def decompose_deals(
    deals: tuple[DealInput, ...],
    rng: random.Random,
    *,
    config: EligibilityConfiguration | None = None,
) -> tuple[DealFinance, ...]:
    """Decompose every deal's back-end gross into reserve and product contracts.

    Args:
        deals: The finalized transactions, which the caller must supply in a stable
            order. The order fixes the random stream, so it is part of the contract.
        rng: A dedicated generator. Consumed in a fixed order per deal, so adding a
            product category cannot perturb an earlier deal.
        config: A loaded eligibility configuration; the governed one by default.

    Returns:
        One :class:`DealFinance` per input deal, in the input order.

    Raises:
        GenerationError: If a decomposition does not sum to the deal's stored back-end
            gross to the cent, or if a non-retail transaction carries F&I gross. Both are
            impossible by construction, which is exactly why they are asserted: a silent
            cent of drift here would surface as an unexplainable reconciliation failure
            three layers downstream.
    """
    rules = config or eligibility_configuration()
    by_category = finance_products_by_category()
    results = tuple(_decompose_one(deal, rng, rules, by_category) for deal in deals)
    for deal, finance in zip(deals, results, strict=True):
        if finance.decomposed_back_end_gross != deal.back_end_gross:
            raise GenerationError(
                f"{deal.sale_id}: the F&I decomposition sums to "
                f"{finance.decomposed_back_end_gross} against a stored back_end_gross of "
                f"{deal.back_end_gross}. The decomposition is exact by construction, so a "
                "difference means a rounding step was added without a compensating "
                "largest-remainder allocation.",
                entity=_ENTITY,
                sale_id=deal.sale_id,
            )
    return results


def _decompose_one(
    deal: DealInput,
    rng: random.Random,
    rules: EligibilityConfiguration,
    by_category: dict[str, tuple[FinanceProductDefinition, ...]],
) -> DealFinance:
    """Decompose one deal. Every branch sums to ``deal.back_end_gross`` exactly."""
    structure = finance_structure_for(deal.sale_type, deal.amount_financed)
    lender_id = assign_lender(
        rng, dealership_id=deal.dealership_id, finance_structure=structure
    )

    if not deal.is_retail:
        # A disposal has no consumer: no reserve, no product, no consumer lender. The
        # sale generator already sets back_end_gross to zero on one; this asserts it
        # rather than assuming it, because a non-zero value here would be silently
        # unexplainable.
        if deal.back_end_gross != _ZERO:
            raise GenerationError(
                f"{deal.sale_id}: a {structure} disposal carries back_end_gross "
                f"{deal.back_end_gross}. Non-retail transactions produce no F&I income, "
                "so there is no component to attribute it to.",
                entity=_ENTITY,
                sale_id=deal.sale_id,
            )
        return DealFinance(deal.sale_id, structure, None, _ZERO, ())

    eligible = eligible_categories(
        finance_structure=structure, vehicle_condition=deal.condition_type, config=rules
    )
    basket = _draw_basket(deal, rng, structure, eligible, by_category)
    if not basket and structure != FINANCE_STRUCTURE_RETAIL_FINANCE and deal.back_end_gross > _ZERO:
        # A Cash deal and a Lease both earn zero reserve by rule, so an empty basket
        # would leave the deal's F&I gross with nothing to attribute it to. One product
        # is forced rather than the reserve rule being bent: bending it would put reserve
        # on a deal that financed nothing, which is the single thing this domain must
        # never do. The forced line is drawn from the eligible set, so it still satisfies
        # its own eligibility rule.
        basket = (_forced_line(rng, eligible, by_category, deal),)
    reserve, budget = _split_reserve(deal, rng, structure, basket_is_empty=not basket)

    basket = _trim_to_budget(basket, budget)
    if not basket:
        # Nothing left to write a contract against. The whole amount is the reserve --
        # reachable only on a Retail Finance deal, or when the deal produced no F&I gross
        # at all, in which case the reserve is zero too.
        return DealFinance(deal.sale_id, structure, lender_id, deal.back_end_gross, ())

    allocations = _allocate(budget, tuple(product.gross_weight for product in basket))
    products = tuple(
        _build_line(ordinal, product, gross, rng, rules)
        for ordinal, (product, gross) in enumerate(zip(basket, allocations, strict=True), start=1)
    )
    return DealFinance(deal.sale_id, structure, lender_id, reserve, products)


def _draw_basket(
    deal: DealInput,
    rng: random.Random,
    structure: str,
    eligible: tuple[str, ...],
    by_category: dict[str, tuple[FinanceProductDefinition, ...]],
) -> tuple[FinanceProductDefinition, ...]:
    """Choose which products a deal carries.

    One variate is consumed per ELIGIBLE CATEGORY, in
    :data:`arpi.constants.FINANCE_PRODUCT_CATEGORIES` order, whether or not the category
    attaches. That fixed consumption is what makes the stream stable: a change to one
    category's probability cannot shift the draws of the categories after it.
    """
    store_factor = STORE_ATTACH_FACTOR.get(deal.dealership_id, DEFAULT_STORE_ATTACH_FACTOR)
    structure_factor = STRUCTURE_ATTACH_FACTOR[structure]
    if deal.manager_skill is None:
        manager_factor = UNSTAFFED_ATTACH_FACTOR
    else:
        low, high = MANAGER_SKILL_BOUNDS
        manager_factor = min(max(deal.manager_skill, low), high)

    chosen: list[FinanceProductDefinition] = []
    for category in eligible:
        probability = min(
            CATEGORY_ATTACH_BASE[category] * structure_factor * store_factor * manager_factor,
            0.95,
        )
        if rng.random() >= probability:
            continue
        products = by_category[category]
        chosen.append(_pick_product(rng, products, exclude=()))
        if category == "Other Aftermarket Product" and len(products) > 1:
            # The one category where a second, DIFFERENT contract on one deal is
            # realistic. It is what makes "penetration counts distinct deals, not
            # contract rows" a rule with teeth rather than an identity.
            if rng.random() < SECOND_OTHER_PRODUCT_SHARE:
                chosen.append(_pick_product(rng, products, exclude=(chosen[-1],)))
    return tuple(chosen)


def _forced_line(
    rng: random.Random,
    eligible: tuple[str, ...],
    by_category: dict[str, tuple[FinanceProductDefinition, ...]],
    deal: DealInput,
) -> FinanceProductDefinition:
    """Choose the single contract a Cash or Lease deal with F&I gross must carry.

    Weighted by the same base attachment probabilities the basket draw uses, so the
    forced line looks like an ordinary one rather than always being the same product.

    Raises:
        GenerationError: If no category is eligible. Unreachable for a retail deal --
            ``ELIG-VSC`` admits every retail structure and every vehicle condition -- and
            asserted rather than assumed, because the alternative is a deal whose F&I
            gross has no component at all.
    """
    if not eligible:
        raise GenerationError(
            f"{deal.sale_id}: a retail deal carrying back_end_gross "
            f"{deal.back_end_gross} has no eligible product category and cannot earn "
            "reserve, so its F&I gross cannot be attributed to anything.",
            entity=_ENTITY,
            sale_id=deal.sale_id,
        )
    weights = [CATEGORY_ATTACH_BASE[category] for category in eligible]
    category = rng.choices(eligible, weights=weights, k=1)[0]
    return _pick_product(rng, by_category[category], exclude=())


def _pick_product(
    rng: random.Random,
    products: tuple[FinanceProductDefinition, ...],
    *,
    exclude: tuple[FinanceProductDefinition, ...],
) -> FinanceProductDefinition:
    """Pick one product from a category, weighted by its attach affinity."""
    candidates = tuple(product for product in products if product not in exclude)
    if not candidates:  # pragma: no cover - the caller guards on len(products) > 1
        return products[0]
    weights = [product.attach_affinity for product in candidates]
    return rng.choices(candidates, weights=weights, k=1)[0]


def _split_reserve(
    deal: DealInput, rng: random.Random, structure: str, *, basket_is_empty: bool
) -> tuple[Decimal, Decimal]:
    """Split the deal's back-end gross into ``(reserve, product budget)``.

    THE RESERVE RULES, in one place:

    * A **Cash** deal earns no reserve. There is nothing financed to earn it on, so the
      whole amount is product gross. This is not a rounding choice; it is the rule.
    * A **Lease** earns no reserve either. ARPI models no money factor and no lease rate
      mechanic, so there is no mechanism a lease reserve could be attributed to, and
      inventing one would be assuming that retail-finance mechanics apply to a lease.
      A lease still gets a lender: the funding source exists and is analytically useful.
      The decision is recorded in ``docs/source-to-target/STM-019`` section 6.
    * A **Retail Finance** deal may earn reserve, and sometimes earns none:
      :data:`NO_RESERVE_SHARE` of them are flat or no-reserve programs.
    * When a financed deal's basket came out empty, the whole amount IS the reserve --
      the legitimate "finance deal with no product" case.

    One variate is consumed for the no-reserve draw and one for the share, on every
    Retail Finance deal, so the stream does not depend on which branch was taken.
    """
    if structure != FINANCE_STRUCTURE_RETAIL_FINANCE:
        return _ZERO, deal.back_end_gross

    earns_reserve = rng.random() >= NO_RESERVE_SHARE
    share = Decimal(str(round(rng.triangular(*RESERVE_SHARE_OF_BACK_GROSS), 6)))
    if basket_is_empty:
        return deal.back_end_gross, _ZERO
    if not earns_reserve:
        return _ZERO, deal.back_end_gross
    reserve = _money(deal.back_end_gross * share)
    return reserve, deal.back_end_gross - reserve


def _trim_to_budget(
    basket: tuple[FinanceProductDefinition, ...], budget: Decimal
) -> tuple[FinanceProductDefinition, ...]:
    """Trim a basket to the number of lines its product budget can genuinely carry.

    A deal whose whole product budget is forty dollars does not carry five contracts; it
    carries one. Trimming from the end preserves catalogue-category order, so the line
    that survives is the highest-priority category rather than an arbitrary one.
    """
    if budget <= _ZERO:
        return ()
    affordable = int(budget / MINIMUM_PRODUCT_GROSS)
    return basket[: max(1, min(len(basket), affordable))]


def _allocate(total: Decimal, weights: tuple[Decimal, ...]) -> tuple[Decimal, ...]:
    """Split ``total`` across ``weights``, to the cent, with no residue anywhere.

    LARGEST REMAINDER, not proportional-then-fix-the-last-one. Every line receives the
    floor of its exact share, and the cents left over are handed out one at a time to the
    lines with the largest fractional parts, breaking ties by position so the result is
    deterministic. ``sum(result) == total`` holds exactly, and no line absorbs the whole
    rounding error -- which is what a "give the remainder to the last product" rule would
    do, and what would make the final line of every basket a disguised plug.
    """
    if not weights:  # pragma: no cover - callers guard on an empty basket
        return ()
    weight_total = sum(weights, start=Decimal(0))
    if weight_total <= 0:  # pragma: no cover - catalogue weights are all positive
        weight_total = Decimal(len(weights))
        weights = tuple(Decimal(1) for _ in weights)

    units = int((total / _CENTS).to_integral_value(rounding=ROUND_HALF_UP))
    exact = [Decimal(units) * weight / weight_total for weight in weights]
    floors = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
    remainder = units - sum(floors)
    order = sorted(
        range(len(weights)), key=lambda index: (-(exact[index] - floors[index]), index)
    )
    for position in range(remainder):
        floors[order[position % len(order)]] += 1
    return tuple(Decimal(count) * _CENTS for count in floors)


def _build_line(
    ordinal: int,
    product: FinanceProductDefinition,
    gross: Decimal,
    rng: random.Random,
    rules: EligibilityConfiguration,
) -> ProductLine:
    """Build one product line, striking the price identity exactly.

    ``original_product_gross`` is the ALLOCATED amount and ``product_dealer_cost`` is
    derived from it, so ``retail_price = dealer_cost + gross`` holds by construction
    rather than by a subtraction that could round. That direction matters: deriving the
    gross from an independently drawn price and cost would put a rounding step between
    the deal's back-end gross and its components, and the identity would fail in the last
    place on some fraction of rows.
    """
    low, high = DEALER_COST_RATIO_JITTER
    jitter = Decimal(str(round(rng.uniform(low, high), 6)))
    dealer_cost = _money(gross * product.dealer_cost_ratio * jitter)
    if dealer_cost < _ZERO:  # pragma: no cover - every ratio and jitter is positive
        dealer_cost = _ZERO
    offset = rng.choice(CONTRACT_TERM_OFFSETS)
    minimum, maximum = CONTRACT_TERM_BOUNDS
    term = min(max(product.default_contract_term_months + offset, minimum), maximum)
    return ProductLine(
        line_ordinal=ordinal,
        finance_product_id=product.finance_product_id,
        product_category=product.product_category,
        eligibility_rule_id=rules.rule_by_category[product.product_category].rule_id,
        product_retail_price=_money(dealer_cost + gross),
        product_dealer_cost=dealer_cost,
        original_product_gross=gross,
        contract_term_months=term,
    )


def product_definition(finance_product_id: str) -> FinanceProductDefinition:
    """Look up a catalogued product by its identifier.

    Args:
        finance_product_id: The product's natural key.

    Returns:
        Its catalogue definition.

    Raises:
        GenerationError: If the identifier is not in the catalogue.
    """
    try:
        return FINANCE_PRODUCTS_BY_ID[finance_product_id]
    except KeyError:
        raise GenerationError(
            f"Finance product {finance_product_id!r} is not in the governed catalogue.",
            entity=_ENTITY,
            finance_product_id=finance_product_id,
        ) from None


#: The governed category order, re-exported so a consumer iterating a basket does not
#: have to import the constants module for the one thing it needs.
CATEGORY_ORDER: Final[tuple[str, ...]] = FINANCE_PRODUCT_CATEGORIES
