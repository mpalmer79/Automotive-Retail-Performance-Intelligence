"""The single authority on F&I product eligibility and on the derived finance structure.

WHY THIS MODULE EXISTS
----------------------
Eligibility is asked four times in ARPI, by four different consumers:

* the product-basket generator, deciding which categories a deal *could* carry;
* ``DQ-FPS-011``, refusing a generated row whose category was not eligible;
* ``reporting.vw_fi_product_penetration``, computing the denominator of every
  penetration KPI;
* a future TypeScript or DAX consumer, rendering the denominator's description.

If each asked its own copy of the rule, the four answers would eventually disagree and
the penetration figures would be computed over a denominator that no longer matched the
rows in the numerator. So the predicate is declared once, in
``config/reference/fi_product_eligibility.yaml``, and this module is the only Python
that evaluates it. The SQL layer evaluates the same predicate through
``warehouse.fn_product_category_is_eligible``, and
``tests/integration/test_fi_eligibility_parity.py`` proves the two agree over the whole
input cross product rather than asserting that they should.

ELIGIBILITY IS NOT SALES PROPENSITY
-----------------------------------
This module answers "could this product have been sold on this deal under ARPI's
synthetic rule?". It does **not** answer "should this customer buy it?", and it has no
way to: its inputs are the transaction's finance structure and the vehicle's condition,
and nothing else. No customer attribute participates -- no demographic, no protected
characteristic, no credit datum, no income, no age, no geography, no inferred
willingness to buy. Attachment *probability*, which is a different thing and lives in
:mod:`arpi.generation.finance_deal`, is subject to the same prohibition.

THE FINANCE STRUCTURE, DERIVED ONCE
-----------------------------------
:func:`finance_structure_for` is the only Python implementation of the mapping. It is
here rather than in :mod:`arpi.generation.sale` because eligibility is its principal
consumer and because putting it in the sale generator would make the reporting layer's
copy look like the second one rather than the peer it is. ``sale_type`` itself is
untouched: promoting a stored structure column, or creating ``warehouse.dim_sale_type``,
would need its own ADR and migration plan and neither is in ``DASH.6``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Final

import yaml

from arpi.constants import (
    FINANCE_PRODUCT_CATEGORIES,
    FINANCE_STRUCTURE_CASH,
    FINANCE_STRUCTURE_DEALER_TRADE,
    FINANCE_STRUCTURE_LEASE,
    FINANCE_STRUCTURE_RETAIL_FINANCE,
    FINANCE_STRUCTURE_WHOLESALE,
    NON_RETAIL_FINANCE_STRUCTURES,
    RETAIL_FINANCE_STRUCTURES,
)
from arpi.exceptions import GenerationError

__all__ = [
    "ELIGIBILITY_FILE_NAME",
    "EligibilityConfiguration",
    "EligibilityRule",
    "default_eligibility_paths",
    "eligibility_configuration",
    "eligible_categories",
    "finance_structure_for",
    "is_category_eligible",
    "is_retail_structure",
    "resolve_eligibility_path",
    "rule_for_category",
]

#: The entity name used when this module raises, so the error carries a subject.
_ENTITY: Final = "fi_product_eligibility"

#: The governed sale types, and the structure each maps to when it is unambiguous.
#:
#: ``Lease``, ``Wholesale`` and ``Dealer Trade`` decide the structure on their own. The
#: three retail purchase types do not: they split on whether anything was financed, which
#: is why the mapping is a function of two arguments rather than a dictionary.
_STRUCTURE_BY_SALE_TYPE: Final[dict[str, str]] = {
    "Lease": FINANCE_STRUCTURE_LEASE,
    "Wholesale": FINANCE_STRUCTURE_WHOLESALE,
    "Dealer Trade": FINANCE_STRUCTURE_DEALER_TRADE,
}

#: The retail purchase sale types, which split on ``amount_financed``.
_RETAIL_PURCHASE_SALE_TYPES: Final[frozenset[str]] = frozenset(
    {"New Retail", "Used Retail", "Certified Retail"}
)

#: File name of the governed rule set, under ``config/reference/``.
ELIGIBILITY_FILE_NAME: Final = "fi_product_eligibility.yaml"


def default_eligibility_paths() -> tuple[Path, ...]:
    """Return the locations searched for the rule set when none is supplied.

    Mirrors :func:`arpi.generation.vehicle_model.default_catalogue_paths` exactly,
    because both files are source-controlled reference data read by a generator that may
    be invoked from a working directory or from an editable checkout.

    Returns:
        The working directory's ``config/reference/`` copy first, then the copy
        alongside an editable source checkout of the package.
    """
    suffix = Path("config") / "reference" / ELIGIBILITY_FILE_NAME
    cwd_candidate = Path.cwd() / suffix
    checkout_candidate = Path(__file__).resolve().parents[3] / suffix
    if checkout_candidate == cwd_candidate:
        return (cwd_candidate,)
    return (cwd_candidate, checkout_candidate)


def resolve_eligibility_path(path: Path | None = None) -> Path:
    """Resolve the rule set to read.

    Args:
        path: Explicit path. When omitted, :func:`default_eligibility_paths` is searched
            in order.

    Returns:
        The first existing candidate.

    Raises:
        GenerationError: If no candidate exists. Eligibility has exactly one authority,
            so a missing file is a hard failure rather than a fallback to a built-in
            rule set that nobody reviewed.
    """
    if path is not None:
        return path.resolve()
    candidates = default_eligibility_paths()
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    searched = ", ".join(str(candidate) for candidate in candidates)
    raise GenerationError(
        f"The F&I eligibility configuration {ELIGIBILITY_FILE_NAME} was not found. "
        f"Searched: {searched}. Eligibility is defined once, centrally; there is no "
        "built-in default rule set to fall back to.",
        entity=_ENTITY,
    )


# ---------------------------------------------------------------------------------------
# The finance-structure derivation
# ---------------------------------------------------------------------------------------
def finance_structure_for(sale_type: str, amount_financed: Decimal) -> str:
    """Derive the finance structure of one transaction.

    THE ONE PYTHON IMPLEMENTATION. Four branches, in this order:

    ``Lease`` sale type
        ``Lease``. A lease is a lease however it was funded.
    ``Wholesale`` / ``Dealer Trade``
        The same word. Non-retail: there is no consumer, so no product and no consumer
        lender may attach, and neither is a component of the retail structure mix.
    Retail purchase with ``amount_financed > 0``
        ``Retail Finance``.
    Retail purchase otherwise
        ``Cash``.

    Args:
        sale_type: One of the six governed sale types.
        amount_financed: The deal's financed amount, exact. Zero on a cash deal.

    Returns:
        One of :data:`arpi.constants.FINANCE_STRUCTURES`.

    Raises:
        GenerationError: If ``sale_type`` is outside the governed enumeration. A default
            branch would silently classify an unknown type as ``Cash``, which would move
            it into the structure mix and into three eligibility denominators.
    """
    fixed = _STRUCTURE_BY_SALE_TYPE.get(sale_type)
    if fixed is not None:
        return fixed
    if sale_type not in _RETAIL_PURCHASE_SALE_TYPES:
        raise GenerationError(
            f"sale_type {sale_type!r} is outside the governed enumeration, so no finance "
            "structure can be derived for it. Add the type to the derivation deliberately "
            "rather than letting it fall through to Cash.",
            entity=_ENTITY,
            sale_type=sale_type,
        )
    if amount_financed > 0:
        return FINANCE_STRUCTURE_RETAIL_FINANCE
    return FINANCE_STRUCTURE_CASH


def is_retail_structure(finance_structure: str) -> bool:
    """Whether a structure is one of the three retail structures.

    Args:
        finance_structure: A value returned by :func:`finance_structure_for`.

    Returns:
        ``True`` for Cash, Retail Finance and Lease; ``False`` for the two disposals.
    """
    return finance_structure in RETAIL_FINANCE_STRUCTURES


# ---------------------------------------------------------------------------------------
# The governed rules
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class EligibilityRule:
    """One governed ``ELIG-*`` rule.

    Attributes:
        rule_id: Permanent identifier, e.g. ``ELIG-GAP``.
        label: The denominator description a consumer renders beside a penetration.
        categories: The governed product categories this rule owns. Every category in
            the platform belongs to exactly one rule.
        finance_structures: The retail structures the rule admits. Never contains a
            non-retail structure.
        vehicle_conditions: The vehicle conditions the rule admits.
        rationale: Why the rule narrows the way it does.
    """

    rule_id: str
    label: str
    categories: tuple[str, ...]
    finance_structures: frozenset[str]
    vehicle_conditions: frozenset[str]
    rationale: str

    def admits(self, finance_structure: str, vehicle_condition: str) -> bool:
        """Whether a deal of this structure and condition is in the rule's denominator.

        Args:
            finance_structure: A value from :func:`finance_structure_for`.
            vehicle_condition: ``New``, ``Used`` or ``Certified``.

        Returns:
            ``True`` when the deal satisfies the rule.
        """
        return (
            finance_structure in self.finance_structures
            and vehicle_condition in self.vehicle_conditions
        )


@dataclass(frozen=True, slots=True)
class EligibilityConfiguration:
    """The loaded rule set, indexed the two ways its consumers ask for it.

    Attributes:
        version: The configuration version, incremented when a predicate changes meaning.
        rules: Every rule, in declaration order.
        rule_by_category: The total function from governed category to owning rule.
    """

    version: int
    rules: tuple[EligibilityRule, ...]
    rule_by_category: dict[str, EligibilityRule]

    @property
    def rule_ids(self) -> tuple[str, ...]:
        """Every rule identifier, in declaration order."""
        return tuple(rule.rule_id for rule in self.rules)


def eligibility_configuration(path: Path | None = None) -> EligibilityConfiguration:
    """Load and validate the governed eligibility rules.

    Args:
        path: Explicit configuration path; defaults to the source-controlled copy. A
            test may pass a temporary file to exercise a rejection.

    Returns:
        The validated configuration.

    Raises:
        GenerationError: If the file is unreadable, structurally wrong, names a category
            or structure outside the governed vocabulary, or fails the partition rule.
    """
    return _load_configuration(resolve_eligibility_path(path))


@lru_cache(maxsize=4)
def _load_configuration(path: Path) -> EligibilityConfiguration:
    """Parse one configuration file. Cached: the file is read on every generated deal."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise GenerationError(
            f"The F&I eligibility configuration at {path} could not be read ({exc}). "
            "Eligibility has exactly one authority, so a missing file is a hard failure "
            "rather than a fallback to a default rule set.",
            entity=_ENTITY,
        ) from exc
    except yaml.YAMLError as exc:
        raise GenerationError(
            f"The F&I eligibility configuration at {path} is not valid YAML ({exc}).",
            entity=_ENTITY,
        ) from exc

    if not isinstance(raw, dict):
        raise GenerationError(
            f"The F&I eligibility configuration at {path} must be a mapping.",
            entity=_ENTITY,
        )

    version = raw.get("version")
    if not isinstance(version, int):
        raise GenerationError(
            "The F&I eligibility configuration must declare an integer `version`. The "
            "version is what lets a stored rule id be interpreted against the predicate "
            "that was in force when the row was written.",
            entity=_ENTITY,
        )

    declared_rules = raw.get("rules")
    if not isinstance(declared_rules, list) or not declared_rules:
        raise GenerationError(
            "The F&I eligibility configuration must declare a non-empty `rules` list.",
            entity=_ENTITY,
        )

    rules = tuple(_build_rule(entry, path) for entry in declared_rules)
    rule_by_category = _partition(rules, path)
    return EligibilityConfiguration(
        version=version, rules=rules, rule_by_category=rule_by_category
    )


def _build_rule(entry: Any, path: Path) -> EligibilityRule:
    """Build and validate one rule entry."""
    if not isinstance(entry, dict):
        raise GenerationError(
            f"Every entry of `rules` in {path} must be a mapping.", entity=_ENTITY
        )
    rule_id = entry.get("rule_id")
    if not isinstance(rule_id, str) or not rule_id.startswith("ELIG-"):
        raise GenerationError(
            f"Rule identifier {rule_id!r} in {path} must be a string of the form ELIG-*.",
            entity=_ENTITY,
        )

    categories = _string_list(entry, "categories", rule_id, path)
    unknown = tuple(name for name in categories if name not in FINANCE_PRODUCT_CATEGORIES)
    if unknown:
        raise GenerationError(
            f"{rule_id} names product category/categories outside the governed ten: "
            f"{', '.join(unknown)}. The vocabulary is arpi.constants."
            "FINANCE_PRODUCT_CATEGORIES and a rule may not extend it.",
            entity=_ENTITY,
            rule_id=rule_id,
        )

    structures = _string_list(entry, "finance_structures", rule_id, path)
    forbidden = tuple(name for name in structures if name in NON_RETAIL_FINANCE_STRUCTURES)
    if forbidden:
        raise GenerationError(
            f"{rule_id} names non-retail structure(s) {', '.join(forbidden)}. A wholesale "
            "or dealer-trade disposal has no consumer, so no product can be written on "
            "one and no rule may admit one.",
            entity=_ENTITY,
            rule_id=rule_id,
        )
    unsupported = tuple(name for name in structures if name not in RETAIL_FINANCE_STRUCTURES)
    if unsupported:
        raise GenerationError(
            f"{rule_id} names finance structure(s) outside the governed retail "
            f"vocabulary: {', '.join(unsupported)}.",
            entity=_ENTITY,
            rule_id=rule_id,
        )

    conditions = _string_list(entry, "vehicle_conditions", rule_id, path)
    unknown_conditions = tuple(
        name for name in conditions if name not in {"New", "Used", "Certified"}
    )
    if unknown_conditions:
        raise GenerationError(
            f"{rule_id} names vehicle condition(s) outside the warehouse.dim_vehicle "
            f"vocabulary: {', '.join(unknown_conditions)}.",
            entity=_ENTITY,
            rule_id=rule_id,
        )

    label = entry.get("label")
    rationale = entry.get("rationale")
    for field_name, value in (("label", label), ("rationale", rationale)):
        if not isinstance(value, str) or not value.strip():
            raise GenerationError(
                f"{rule_id} must carry a non-empty `{field_name}`. A denominator a "
                "consumer cannot describe is a denominator a reader cannot check.",
                entity=_ENTITY,
                rule_id=rule_id,
            )

    return EligibilityRule(
        rule_id=rule_id,
        label=str(label).strip(),
        categories=categories,
        finance_structures=frozenset(structures),
        vehicle_conditions=frozenset(conditions),
        rationale=" ".join(str(rationale).split()),
    )


def _string_list(entry: dict[str, Any], key: str, rule_id: str, path: Path) -> tuple[str, ...]:
    """Read a required non-empty list of strings from a rule entry."""
    value = entry.get(key)
    if not isinstance(value, list) or not value or not all(isinstance(x, str) for x in value):
        raise GenerationError(
            f"{rule_id} in {path} must declare `{key}` as a non-empty list of strings.",
            entity=_ENTITY,
            rule_id=rule_id,
        )
    return tuple(value)


def _partition(rules: tuple[EligibilityRule, ...], path: Path) -> dict[str, EligibilityRule]:
    """Build the category-to-rule mapping, refusing anything that is not a partition.

    THE BINDING RULE. Every governed category resolves to exactly one rule. A category
    with none has no denominator, so every penetration figure over it would be undefined
    and would render as an empty cell rather than as a governance failure. A category
    with two has two denominators, so the same figure could be computed two ways and
    both would look correct.
    """
    mapping: dict[str, EligibilityRule] = {}
    duplicated: list[str] = []
    for rule in rules:
        for category in rule.categories:
            if category in mapping:
                duplicated.append(f"{category} (in {mapping[category].rule_id} and {rule.rule_id})")
                continue
            mapping[category] = rule
    missing = tuple(name for name in FINANCE_PRODUCT_CATEGORIES if name not in mapping)
    if duplicated or missing:
        problems = []
        if missing:
            problems.append(f"no rule owns {', '.join(missing)}")
        if duplicated:
            problems.append(f"two rules own {'; '.join(duplicated)}")
        raise GenerationError(
            f"The F&I eligibility configuration at {path} is not a partition of the ten "
            f"governed product categories: {'; and '.join(problems)}. Every category must "
            "resolve to exactly one ELIG-* rule -- not zero, and not two.",
            entity=_ENTITY,
        )
    return mapping


# ---------------------------------------------------------------------------------------
# The public predicate
# ---------------------------------------------------------------------------------------
def rule_for_category(category: str, config: EligibilityConfiguration | None = None) -> (
    EligibilityRule
):
    """Return the one rule that owns a product category.

    Args:
        category: One of the ten governed categories.
        config: A loaded configuration; the source-controlled one by default.

    Returns:
        The owning rule.

    Raises:
        GenerationError: If the category is outside the governed vocabulary.
    """
    resolved = config or eligibility_configuration()
    try:
        return resolved.rule_by_category[category]
    except KeyError:
        raise GenerationError(
            f"Product category {category!r} is outside the governed ten and therefore "
            "owns no eligibility rule.",
            entity=_ENTITY,
            product_category=category,
        ) from None


def is_category_eligible(
    category: str,
    *,
    finance_structure: str,
    vehicle_condition: str,
    config: EligibilityConfiguration | None = None,
) -> bool:
    """Whether one product category could have been written on one transaction.

    Args:
        category: One of the ten governed categories.
        finance_structure: A value from :func:`finance_structure_for`.
        vehicle_condition: ``New``, ``Used`` or ``Certified``.
        config: A loaded configuration; the source-controlled one by default.

    Returns:
        ``True`` when the deal satisfies the category's rule.
    """
    return rule_for_category(category, config).admits(finance_structure, vehicle_condition)


def eligible_categories(
    *,
    finance_structure: str,
    vehicle_condition: str,
    config: EligibilityConfiguration | None = None,
) -> tuple[str, ...]:
    """Every governed category that could have been written on one transaction.

    Args:
        finance_structure: A value from :func:`finance_structure_for`.
        vehicle_condition: ``New``, ``Used`` or ``Certified``.
        config: A loaded configuration; the source-controlled one by default.

    Returns:
        The eligible categories in :data:`arpi.constants.FINANCE_PRODUCT_CATEGORIES`
        order, which keeps every downstream iteration deterministic. Empty for a
        wholesale or dealer-trade disposal, because no rule admits one.
    """
    resolved = config or eligibility_configuration()
    return tuple(
        category
        for category in FINANCE_PRODUCT_CATEGORIES
        if resolved.rule_by_category[category].admits(finance_structure, vehicle_condition)
    )
