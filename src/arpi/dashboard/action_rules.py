"""The ``arpi.action_rules/1`` schema: loading, validating and fingerprinting the rule file.

WHAT A RULE IS, AND WHAT IT IS NOT
----------------------------------
A rule is a POLICY statement: "a condition of this shape, on this governed dataset, at this
grain, deserves a manager's review". It is not a finding, not a recommendation of business
action, and not a claim about why anything happened. The engine that consumes these rules
(:mod:`arpi.dashboard.actions`) decides nothing; it applies the predicate to rows the export
already published and copies the evidence across verbatim.

WHY THE SCHEMA IS THIS EXPLICIT
-------------------------------
The planning contract in ``docs/dashboard/ACTION_ENGINE_SPEC.md`` showed a rule with a
predicate and an evidence list and left the rest implied -- which dataset the rule reads,
what identifies the entity, which rows are in scope for an as-of date, what the drill-through
resolves to. Left implied, every one of those becomes a per-rule ``if rule_id == ...`` branch
in Python, and a rule engine whose rule semantics live in Python is not a rule engine. So
each of them is a declared field here, and the evaluator has no rule-specific code at all.

WHERE A THRESHOLD MAY LIVE
--------------------------
Exactly one place per threshold.

* A threshold the warehouse already governs is NOT restated. ``ACT-INV-001`` does not say
  "60 days"; it reads the governed boolean ``is_aged_over_default_threshold`` and DISCLOSES
  the row's own ``aged_threshold_days``, so the number the console shows is the number the
  export carried. Redefining "aged" here -- the planning document's 90-day example predates
  the implemented 60-day project default -- is exactly the regression this arrangement makes
  impossible.
* A minimum-sample floor comes from :data:`arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS`,
  the same authority ``warehouse.fn_minimum_sample_floor()`` publishes.
* A threshold that exists only to decide when a review prompt surfaces is declared on the
  rule, labelled a project-default review threshold, and rendered with the action.

Nothing may hard-code a threshold in Python, TypeScript, SQL or a test.

LANGUAGE
--------
Rule-authored prose is checked, not trusted. Review verbs are required; operational verbs
and causal claims are refused. The check runs over the rule file's own strings, so it cannot
fire on unrelated documentation elsewhere in the repository.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

import yaml

from arpi.constants import MINIMUM_SAMPLE_ELIGIBLE_DEALS
from arpi.dashboard import contract as spec
from arpi.dashboard.action_predicate import (
    ExpressionError,
    Predicate,
    ValueKind,
    compile_predicate,
)
from arpi.dashboard.serialization import content_sha256
from arpi.exceptions import ArpiError

__all__ = [
    "ACTION_DOMAINS",
    "ACTION_RULES_SCHEMA",
    "DEFAULT_RULES_PATH",
    "ENTITY_TYPES",
    "OWNER_ROLES",
    "SEVERITY_LEVELS",
    "ActionRule",
    "ChangeDriverPolicy",
    "DisclosedColumn",
    "DrillThrough",
    "MinimumSample",
    "RuleError",
    "RuleThreshold",
    "Ruleset",
    "SeverityLevel",
    "load_ruleset",
]


class RuleError(ArpiError):
    """The rule file is not a valid ``arpi.action_rules/1`` document."""


#: The rule file's schema identifier.
ACTION_RULES_SCHEMA: Final = "arpi.action_rules/1"

#: The rule file's location, relative to the repository root.
DEFAULT_RULES_PATH: Final = Path("config/dashboard/action_rules.yaml")

#: The stable domain vocabulary, in the order the console lists them.
#:
#: There is deliberately no ``employees`` domain and no ``other``. `DASH.11` settled that
#: employee comparison is a fairness-governed surface with a sample floor and no composite
#: score; an employee action family would need its own specification, and inventing one here
#: to fill a facet would be the opposite of that decision.
ACTION_DOMAINS: Final[tuple[str, ...]] = (
    "inventory",
    "sales-gross",
    "fi",
    "leads",
    "accounting",
)

#: How each domain is labelled in the console.
DOMAIN_LABELS: Final[dict[str, str]] = {
    "inventory": "Inventory",
    "sales-gross": "Sales & Gross",
    "fi": "F&I",
    "leads": "Leads",
    "accounting": "Accounting",
}

#: The governed role vocabulary. A review role, never an assignment.
OWNER_ROLES: Final[tuple[str, ...]] = (
    "Dealer principal",
    "General manager",
    "General sales manager",
    "Used-car manager",
    "F&I manager",
    "BDC manager",
    "Controller",
)

#: The three severity levels, most severe first. Severity is a rule's own classification of
#: a matched condition; it is not a probability, a confidence, a score or a materiality rank.
SEVERITY_LEVELS: Final[tuple[str, ...]] = ("high", "medium", "low")

#: The entity kinds an action may be about.
ENTITY_TYPES: Final[tuple[str, ...]] = (
    "inventory_unit",
    "deal",
    "store",
    "store_source_day",
    "store_day",
    "store_month",
    "account_position",
    "accounting_exception",
)

#: Rule states. Every proposed identifier keeps a state even when it never fires.
RULE_STATES: Final[tuple[str, ...]] = (
    "supported",
    "blocked-by-missing-data",
    "blocked-by-grain",
    "duplicates-data-quality-gate",
)

#: The review vocabulary an action's prose must draw on.
REVIEW_VERBS: Final[tuple[str, ...]] = (
    "review",
    "investigate",
    "validate",
    "reconcile",
    "compare",
    "confirm",
)

#: Operational and outcome verbs an action may never use.
#:
#: The queue surfaces conditions. Instructing a manager to reprice a unit or approve a deal
#: would make it a decision system, which is precisely the thing this increment refuses to
#: become.
PROHIBITED_VERBS: Final[tuple[str, ...]] = (
    "reprice",
    "repricing",
    "terminate",
    "deny",
    "submit",
    "cancel",
    "approve",
    "reject",
    "fire",
    "discipline",
    "coach",
    "assign",
    "acknowledge",
    "resolve",
    "escalate",
    "increase spend",
    "reduce spend",
    "raise the price",
    "lower the price",
    "contact immediately",
)

#: Causal constructions an action may never use.
#:
#: An action states that a condition holds. Saying it was CAUSED by anything is a claim the
#: evidence does not support and the engine cannot test.
CAUSAL_PHRASES: Final[tuple[str, ...]] = (
    "caused by",
    "caused",
    "because",
    "resulted from",
    "resulting from",
    "led to",
    "due to",
    "responsible for",
    "blame",
    "at fault",
    "drove the",
)

#: Rule-file keys, so an unknown one is refused rather than silently ignored.
_ROOT_KEYS: Final[frozenset[str]] = frozenset(
    {"schema", "ruleset_version", "defaults", "change_drivers", "rules"}
)
_CHANGE_DRIVER_KEYS: Final[frozenset[str]] = frozenset(
    {"authority", "dataset", "decomposition_order", "materiality"}
)
_DEFAULT_KEYS: Final[frozenset[str]] = frozenset({"expiry"})
_RULE_KEYS: Final[frozenset[str]] = frozenset(
    {
        "rule_id",
        "enabled",
        "state",
        "state_reason",
        "domain",
        "entity_type",
        "owner_role",
        "title",
        "description",
        "source_dataset",
        "date_basis",
        "scope",
        "entity_key",
        "store_field",
        "date_field",
        "thresholds",
        "disclosed_columns",
        "minimum_sample",
        "predicate",
        "severity",
        "evidence",
        "recommended_review",
        "limitations",
        "suppression",
        "drill_through",
    }
)
_SCOPE_KEYS: Final[frozenset[str]] = frozenset({"as_of", "as_of_month", "all", "filter"})
_THRESHOLD_KEYS: Final[frozenset[str]] = frozenset({"value", "units", "label", "rationale"})
_DISCLOSED_KEYS: Final[frozenset[str]] = frozenset({"column", "label", "units", "authority"})
_SAMPLE_KEYS: Final[frozenset[str]] = frozenset({"denominator", "floor", "disclosure"})
_SEVERITY_KEYS: Final[frozenset[str]] = frozenset({"level", "predicate"})
_DRILL_KEYS: Final[frozenset[str]] = frozenset({"route", "params"})

#: A permanent rule identifier.
_RULE_ID: Final[re.Pattern[str]] = re.compile(r"ACT-(INV|SLS|FNI|LED|ACC)-\d{3}\Z")

#: A template slot, ``{column_name}``.
_SLOT: Final[re.Pattern[str]] = re.compile(r"\{([a-z][a-z0-9_]*)\}")

#: Characters a rendered action string may never contain, so a template cannot smuggle
#: markup into a surface that renders it. Nothing in this synthetic system carries
#: user-provided text; the boundary is maintained regardless.
_UNSAFE_TEXT: Final[re.Pattern[str]] = re.compile(r"[<>]|&[a-z]+;|\]\(|https?://")


@dataclass(frozen=True, slots=True)
class RuleThreshold:
    """A review threshold this rule owns.

    Attributes:
        name: The name the predicate refers to as ``@name``.
        value: The exact value. Never a float.
        units: The unit rendered beside it.
        label: The disclosure label, which always names it a project default.
        rationale: Why this value, in the rule author's words.
    """

    name: str
    value: Decimal
    units: str
    label: str
    rationale: str


@dataclass(frozen=True, slots=True)
class DisclosedColumn:
    """A governed threshold READ FROM THE ROW rather than declared here.

    This is how the aged threshold reaches the console. The rule names the column; the
    value shown is whatever the export published for that row, so there is no second
    definition of "aged" anywhere in the stack.

    Attributes:
        column: The exported column carrying the governed threshold value.
        label: The disclosure label.
        units: The unit rendered beside it.
        authority: Where the number is governed, named for the reader.
    """

    column: str
    label: str
    units: str
    authority: str


@dataclass(frozen=True, slots=True)
class MinimumSample:
    """The sample discipline a rate- or comparison-based rule must satisfy.

    Attributes:
        denominator: The exported column carrying THE METRIC'S OWN denominator. Not a
            generic row count: a contact rate is floored on valid leads, a show rate on
            eligible appointments, and using one number for both would be wrong for at
            least one of them.
        floor: The resolved floor.
        authority: Where the floor comes from.
        disclosure: What the denominator counts, in words, for the console.
    """

    denominator: str
    floor: Decimal
    authority: str
    disclosure: str


@dataclass(frozen=True, slots=True)
class SeverityLevel:
    """One severity band, evaluated in order until one matches.

    Attributes:
        level: ``high``, ``medium`` or ``low``.
        predicate: The condition, or ``None`` for the final catch-all band.
    """

    level: str
    predicate: Predicate | None


@dataclass(frozen=True, slots=True)
class DrillThrough:
    """Where an action sends a reader for the evidence behind it.

    Attributes:
        route: An operating route path. Validated against the canonical route map.
        params: Query parameters, whose values are ``{column}`` templates or literals.
    """

    route: str
    params: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class ActionRule:
    """One permanent rule.

    Attributes:
        rule_id: The permanent identifier. Never reused, never renumbered, never deleted.
        enabled: Whether the rule may emit actions.
        state: Why the rule is in the state it is in, from :data:`RULE_STATES`.
        state_reason: The audit sentence for that state.
        domain: The console domain facet.
        entity_type: What one action is about.
        owner_role: The role best placed to REVIEW the evidence. Not an assignment.
        title: The action's headline.
        description: What the condition means, for documentation.
        source_dataset: The exported dataset the rule reads. The only data it may see.
        date_basis: The date basis of that dataset, restated so the action can show it.
        scope_as_of: Column that must equal the export's as-of date, or ``None``.
        scope_as_of_month: Column whose month must equal the as-of month, or ``None``.
        scope_filter: An extra predicate narrowing the population, or ``None``.
        entity_key: Columns whose values, joined, identify the entity.
        store_field: Column carrying the store, or ``None`` for a group-wide row.
        date_field: Column carrying the row's business date, or ``None``.
        thresholds: Review thresholds this rule owns.
        disclosed_columns: Governed thresholds read from the row.
        minimum_sample: Sample discipline, or ``None`` for a rule that needs none.
        predicate: The condition, or ``None`` for a disabled rule.
        severity: The severity bands, in evaluation order.
        evidence: Exported columns carried with the action, in display order.
        recommended_review: What to look at next. A review prompt, not an instruction.
        limitations: What the action does not establish.
        suppression: Documented conditions that veto an otherwise-firing rule.
        drill_through: The destination, or ``None`` for a disabled rule.
    """

    rule_id: str
    enabled: bool
    state: str
    state_reason: str
    domain: str
    entity_type: str
    owner_role: str
    title: str
    description: str
    source_dataset: str | None
    date_basis: str | None
    scope_as_of: str | None
    scope_as_of_month: str | None
    scope_filter: Predicate | None
    entity_key: tuple[str, ...]
    store_field: str | None
    date_field: str | None
    thresholds: tuple[RuleThreshold, ...]
    disclosed_columns: tuple[DisclosedColumn, ...]
    minimum_sample: MinimumSample | None
    predicate: Predicate | None
    severity: tuple[SeverityLevel, ...]
    evidence: tuple[str, ...]
    recommended_review: str
    limitations: str
    suppression: tuple[str, ...]
    drill_through: DrillThrough | None

    @property
    def threshold_values(self) -> dict[str, Decimal]:
        """The rule's declared thresholds, by name, for the evaluator."""
        return {threshold.name: threshold.value for threshold in self.thresholds}


@dataclass(frozen=True, slots=True)
class ChangeDriverPolicy:
    """How the governed gross-change bridge is PRESENTED. Not how it is computed.

    ``reporting.vw_gross_change_bridge`` owns the decomposition, its sequential order and
    its arithmetic, and `DASH.3` already renders it exactly. What was missing, and what this
    policy adds, is a display rule: below which contribution is an effect too small to be
    worth a reader's attention, and therefore grouped into a labelled remainder rather than
    listed. Grouped, never dropped -- the components plus the remainder still reconcile to
    the period change exactly, which is the property the whole surface rests on.

    Attributes:
        authority: The SQL object that owns the calculation, named for the reader.
        dataset: The exported dataset carrying it.
        decomposition_order: The sequential component order, validated against the export
            contract's own enumeration so this file cannot invent a component.
        materiality: The display threshold, its units, its project-default label and why.
    """

    authority: str
    dataset: str
    decomposition_order: tuple[str, ...]
    materiality: RuleThreshold


@dataclass(frozen=True, slots=True)
class Ruleset:
    """The whole rule file, validated.

    Attributes:
        schema: The schema identifier.
        ruleset_version: The file's own version, incremented when rules change meaning.
        expiry: The expiry model. Only ``dataset`` exists: an action lives exactly as long
            as the dataset version that produced it, and nothing persists between versions.
        change_drivers: The change-driver display policy.
        rules: Every permanent rule, enabled and disabled alike, in file order.
        file_sha256: The rule file's content hash, recorded in the export manifest so the
            queue can always be traced to the ruleset that produced it.
        path: Where the file was read from, relative to the repository root.
    """

    schema: str
    ruleset_version: int
    expiry: str
    change_drivers: ChangeDriverPolicy
    rules: tuple[ActionRule, ...]
    file_sha256: str
    path: str
    _by_id: dict[str, ActionRule] = field(default_factory=dict, repr=False, compare=False)

    @property
    def enabled(self) -> tuple[ActionRule, ...]:
        """Every rule that may emit an action, in file order."""
        return tuple(rule for rule in self.rules if rule.enabled)

    @property
    def disabled(self) -> tuple[ActionRule, ...]:
        """Every rule retained but not firing, in file order."""
        return tuple(rule for rule in self.rules if not rule.enabled)

    def rule(self, rule_id: str) -> ActionRule:
        """Return one rule by identifier.

        Args:
            rule_id: The permanent identifier.

        Returns:
            The rule.

        Raises:
            KeyError: If the ruleset holds no such identifier.
        """
        if rule_id not in self._by_id:
            raise KeyError(f"the ruleset holds no rule {rule_id!r}")
        return self._by_id[rule_id]

    @property
    def source_datasets(self) -> tuple[str, ...]:
        """Every exported dataset an enabled rule reads, sorted and deduplicated."""
        return tuple(sorted({rule.source_dataset for rule in self.enabled if rule.source_dataset}))


# ---------------------------------------------------------------------------------------
# Reading the document
# ---------------------------------------------------------------------------------------


def _require_mapping(value: Any, where: str) -> dict[str, Any]:
    """Return a mapping or fail with a located message."""
    if not isinstance(value, dict):
        raise RuleError(f"{where} must be a mapping, found {type(value).__name__}")
    return dict(value)


def _reject_unknown(payload: dict[str, Any], allowed: frozenset[str], where: str) -> None:
    """Fail on any key the schema does not define."""
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise RuleError(f"{where} carries unknown field(s): {', '.join(unknown)}")


def _string(payload: dict[str, Any], key: str, where: str, *, allow_blank: bool = False) -> str:
    """Return a required string field."""
    value = payload.get(key)
    if not isinstance(value, str):
        raise RuleError(f"{where}.{key} must be a string")
    text = value.strip()
    if not text and not allow_blank:
        raise RuleError(f"{where}.{key} may not be blank")
    return text


def _optional_string(payload: dict[str, Any], key: str, where: str) -> str | None:
    """Return an optional string field."""
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise RuleError(f"{where}.{key} must be a string or absent")
    return value.strip() or None


def _string_tuple(payload: dict[str, Any], key: str, where: str) -> tuple[str, ...]:
    """Return a required list-of-strings field."""
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise RuleError(f"{where}.{key} must be a list of strings")
    return tuple(item.strip() for item in value)


def _exact_decimal(value: Any, where: str) -> Decimal:
    """Return a threshold value as an exact Decimal.

    A YAML float would already have lost exactness by the time it arrived, so a float is
    refused outright and the author is asked to quote the number.
    """
    if isinstance(value, bool) or not isinstance(value, int | str):
        raise RuleError(
            f"{where} must be an integer or a quoted decimal string, not "
            f"{type(value).__name__}; a YAML float cannot carry an exact value"
        )
    try:
        return Decimal(str(value))
    except ArithmeticError as error:
        raise RuleError(f"{where} is not a number: {value!r}") from error


def _check_language(text: str, where: str) -> None:
    """Refuse operational verbs, causal claims and markup in rule-authored prose."""
    lowered = text.lower()
    for phrase in CAUSAL_PHRASES:
        if re.search(rf"\b{re.escape(phrase)}\b", lowered):
            raise RuleError(
                f"{where} contains the causal construction {phrase!r}; an action states "
                "that a condition holds and never why"
            )
    for verb in PROHIBITED_VERBS:
        if re.search(rf"\b{re.escape(verb)}\b", lowered):
            raise RuleError(
                f"{where} contains the operational verb {verb!r}; the queue prompts a "
                "review and never directs a business action"
            )
    if _UNSAFE_TEXT.search(text):
        raise RuleError(f"{where} contains markup or a link, which action prose may not carry")


def _check_review_vocabulary(text: str, where: str) -> None:
    """Require that review prose actually asks for a review."""
    lowered = text.lower()
    if not any(re.search(rf"\b{verb}", lowered) for verb in REVIEW_VERBS):
        raise RuleError(
            f"{where} uses none of the review verbs ({', '.join(REVIEW_VERBS)}); review "
            "prose must ask for a review"
        )


def _check_slots(text: str, allowed: frozenset[str], where: str) -> None:
    """Refuse a template slot that names anything outside the rule's evidence."""
    for slot in _SLOT.findall(text):
        if slot not in allowed:
            raise RuleError(
                f"{where} substitutes {{{slot}}}, which is not one of this rule's evidence "
                "fields; a template may only read evidence it carries"
            )


# ---------------------------------------------------------------------------------------
# Rule construction
# ---------------------------------------------------------------------------------------


def _column_types(dataset: str, where: str) -> dict[str, str]:
    """Return the exported column-name-to-type map for a dataset.

    Raises:
        RuleError: If the rule names a dataset the export contract does not declare, which
            is what keeps a rule from reading anything the dashboard does not publish.
    """
    try:
        entry = spec.dataset(dataset)
    except KeyError as error:
        raise RuleError(
            f"{where}.source_dataset {dataset!r} is not an exported dashboard dataset"
        ) from error
    return {column.name: column.type for column in entry.columns}


def _compile(
    source: str, columns: dict[str, str], kinds: dict[str, ValueKind], where: str
) -> Predicate:
    """Compile a predicate, re-raising a parse failure as a rule failure."""
    try:
        return compile_predicate(source, columns=columns, thresholds=kinds)
    except ExpressionError as error:
        raise RuleError(f"{where}: {error}") from error


def _read_thresholds(payload: dict[str, Any], where: str) -> tuple[RuleThreshold, ...]:
    """Read the rule's own review thresholds."""
    raw = payload.get("thresholds")
    if raw is None:
        return ()
    mapping = _require_mapping(raw, f"{where}.thresholds")
    thresholds: list[RuleThreshold] = []
    for name in sorted(mapping):
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            raise RuleError(f"{where}.thresholds.{name} is not a valid threshold name")
        body = _require_mapping(mapping[name], f"{where}.thresholds.{name}")
        _reject_unknown(body, _THRESHOLD_KEYS, f"{where}.thresholds.{name}")
        label = _string(body, "label", f"{where}.thresholds.{name}")
        if "project default" not in label.lower():
            raise RuleError(
                f"{where}.thresholds.{name}.label is {label!r}; every threshold this file "
                "owns must be labelled a project default, because none of them is an "
                "industry benchmark, an OEM standard or a compliance requirement"
            )
        thresholds.append(
            RuleThreshold(
                name=name,
                value=_exact_decimal(body.get("value"), f"{where}.thresholds.{name}.value"),
                units=_string(body, "units", f"{where}.thresholds.{name}"),
                label=label,
                rationale=_string(body, "rationale", f"{where}.thresholds.{name}"),
            )
        )
    return tuple(thresholds)


def _read_change_drivers(payload: dict[str, Any]) -> ChangeDriverPolicy:
    """Read and validate the change-driver display policy.

    The decomposition order is checked against ``gross-change-bridge``'s own component
    enumeration rather than against a list repeated here. That is what stops this file
    from introducing a new/used, store or sale-type mix effect: a component the SQL does
    not define cannot be named, so it cannot be rendered, so nobody can add one in YAML
    without first adding it to the view that computes it.
    """
    where = "change_drivers"
    body = _require_mapping(payload.get(where), where)
    _reject_unknown(body, _CHANGE_DRIVER_KEYS, where)
    dataset = _string(body, "dataset", where)
    try:
        entry = spec.dataset(dataset)
    except KeyError as error:
        raise RuleError(f"{where}.dataset {dataset!r} is not an exported dataset") from error
    try:
        governed = entry.column("component_code").enumeration
    except KeyError as error:
        raise RuleError(f"{where}.dataset {dataset!r} carries no component_code") from error
    if governed is None:
        raise RuleError(f"{where}.dataset {dataset!r} does not enumerate its components")
    order = _string_tuple(body, "decomposition_order", where)
    if tuple(order) != tuple(governed):
        raise RuleError(
            f"{where}.decomposition_order is {list(order)}; {dataset} enumerates "
            f"{list(governed)}. The sequential decomposition is owned by the view, and a "
            "component that SQL does not compute may not be named, ordered or displayed here"
        )
    materiality_body = _require_mapping(body.get("materiality"), f"{where}.materiality")
    _reject_unknown(materiality_body, _THRESHOLD_KEYS, f"{where}.materiality")
    label = _string(materiality_body, "label", f"{where}.materiality")
    if "project default" not in label.lower():
        raise RuleError(
            f"{where}.materiality.label is {label!r}; the display threshold is a project "
            "default for a fictional group, not an accounting materiality standard and not "
            "an industry benchmark"
        )
    return ChangeDriverPolicy(
        authority=_string(body, "authority", where),
        dataset=dataset,
        decomposition_order=order,
        materiality=RuleThreshold(
            name="change_driver_materiality",
            value=_exact_decimal(materiality_body.get("value"), f"{where}.materiality.value"),
            units=_string(materiality_body, "units", f"{where}.materiality"),
            label=label,
            rationale=_string(materiality_body, "rationale", f"{where}.materiality"),
        ),
    )


def _read_disclosed(
    payload: dict[str, Any], columns: dict[str, str], where: str
) -> tuple[DisclosedColumn, ...]:
    """Read the governed thresholds the rule discloses from the row."""
    raw = payload.get("disclosed_columns")
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise RuleError(f"{where}.disclosed_columns must be a list")
    disclosed: list[DisclosedColumn] = []
    for index, item in enumerate(raw):
        located = f"{where}.disclosed_columns[{index}]"
        body = _require_mapping(item, located)
        _reject_unknown(body, _DISCLOSED_KEYS, located)
        column = _string(body, "column", located)
        if column not in columns:
            raise RuleError(f"{located}.column {column!r} is not exported by this dataset")
        disclosed.append(
            DisclosedColumn(
                column=column,
                label=_string(body, "label", located),
                units=_string(body, "units", located),
                authority=_string(body, "authority", located),
            )
        )
    return tuple(disclosed)


def _read_minimum_sample(
    payload: dict[str, Any], columns: dict[str, str], where: str
) -> MinimumSample | None:
    """Read the rule's sample discipline."""
    raw = payload.get("minimum_sample")
    if raw is None:
        return None
    body = _require_mapping(raw, f"{where}.minimum_sample")
    _reject_unknown(body, _SAMPLE_KEYS, f"{where}.minimum_sample")
    denominator = _string(body, "denominator", f"{where}.minimum_sample")
    if denominator not in columns:
        raise RuleError(
            f"{where}.minimum_sample.denominator {denominator!r} is not exported by this "
            "dataset; the floor must be applied to the metric's own denominator"
        )
    floor_spec = _require_mapping(body.get("floor"), f"{where}.minimum_sample.floor")
    authority = floor_spec.get("authority")
    if authority != "governed_minimum_sample":
        raise RuleError(
            f"{where}.minimum_sample.floor.authority must be 'governed_minimum_sample'; the "
            "floor is owned by warehouse.fn_minimum_sample_floor() and its Python twin "
            "arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS, and may not be restated here"
        )
    return MinimumSample(
        denominator=denominator,
        floor=Decimal(MINIMUM_SAMPLE_ELIGIBLE_DEALS),
        # Named WITHOUT a schema prefix. This string is PUBLISHED with the action, and the
        # exporter's secret guard forbids a reference to a schema the console may not see
        # -- it rejected the first spelling of this line, which is the control working.
        authority="governed minimum-sample project default (fn_minimum_sample_floor)",
        disclosure=_string(body, "disclosure", f"{where}.minimum_sample"),
    )


def _read_severity(
    payload: dict[str, Any],
    columns: dict[str, str],
    kinds: dict[str, ValueKind],
    where: str,
) -> tuple[SeverityLevel, ...]:
    """Read the ordered severity bands."""
    raw = payload.get("severity")
    if not isinstance(raw, list) or not raw:
        raise RuleError(f"{where}.severity must be a non-empty list")
    bands: list[SeverityLevel] = []
    for index, item in enumerate(raw):
        located = f"{where}.severity[{index}]"
        body = _require_mapping(item, located)
        _reject_unknown(body, _SEVERITY_KEYS, located)
        level = _string(body, "level", located)
        if level not in SEVERITY_LEVELS:
            raise RuleError(f"{located}.level {level!r} is not one of {SEVERITY_LEVELS}")
        source = _optional_string(body, "predicate", located)
        if source is None and index != len(raw) - 1:
            raise RuleError(
                f"{located} omits its predicate but is not the last band; only the final "
                "band may be the catch-all, because the first match wins"
            )
        bands.append(
            SeverityLevel(
                level=level,
                predicate=None if source is None else _compile(source, columns, kinds, located),
            )
        )
    levels = [band.level for band in bands]
    if len(set(levels)) != len(levels):
        raise RuleError(f"{where}.severity repeats a level: {levels}")
    if levels != sorted(levels, key=SEVERITY_LEVELS.index):
        raise RuleError(
            f"{where}.severity is ordered {levels}; bands must run most severe first so "
            "that the first match is also the most severe match"
        )
    return tuple(bands)


def _read_drill_through(
    payload: dict[str, Any], columns: dict[str, str], where: str
) -> DrillThrough:
    """Read and validate the drill-through template."""
    body = _require_mapping(payload.get("drill_through"), f"{where}.drill_through")
    _reject_unknown(body, _DRILL_KEYS, f"{where}.drill_through")
    route = _string(body, "route", f"{where}.drill_through")
    if not route.startswith("/") or "?" in route or "#" in route:
        raise RuleError(
            f"{where}.drill_through.route {route!r} must be a bare absolute path; query "
            "parameters are declared separately so each one can be validated"
        )
    params_raw = body.get("params") or {}
    params = _require_mapping(params_raw, f"{where}.drill_through.params")
    resolved: list[tuple[str, str]] = []
    for key in sorted(params):
        value = params[key]
        if not isinstance(value, str):
            raise RuleError(f"{where}.drill_through.params.{key} must be a string")
        for slot in _SLOT.findall(value):
            if slot not in columns:
                raise RuleError(
                    f"{where}.drill_through.params.{key} substitutes {{{slot}}}, which this "
                    "dataset does not export"
                )
        resolved.append((key, value))
    return DrillThrough(route=route, params=tuple(resolved))


def _read_scope(
    payload: dict[str, Any],
    columns: dict[str, str],
    kinds: dict[str, ValueKind],
    where: str,
) -> tuple[str | None, str | None, Predicate | None]:
    """Read the rule's row scope."""
    raw = payload.get("scope")
    if raw is None:
        raise RuleError(f"{where}.scope is required; a rule must say which rows it reads")
    body = _require_mapping(raw, f"{where}.scope")
    _reject_unknown(body, _SCOPE_KEYS, f"{where}.scope")
    as_of = _optional_string(body, "as_of", f"{where}.scope")
    as_of_month = _optional_string(body, "as_of_month", f"{where}.scope")
    whole = body.get("all")
    chosen = [name for name, value in (("as_of", as_of), ("as_of_month", as_of_month)) if value]
    if whole is True:
        chosen.append("all")
    if len(chosen) != 1:
        raise RuleError(
            f"{where}.scope must choose exactly one of as_of, as_of_month or all; found "
            f"{chosen or ['none']}"
        )
    for name, column in (("as_of", as_of), ("as_of_month", as_of_month)):
        if column is not None and columns.get(column) != "date":
            raise RuleError(f"{where}.scope.{name} {column!r} is not an exported date column")
    filter_source = _optional_string(body, "filter", f"{where}.scope")
    scope_filter = (
        None
        if filter_source is None
        else _compile(filter_source, columns, kinds, f"{where}.scope.filter")
    )
    return as_of, as_of_month, scope_filter


def _exported_columns(
    payload: dict[str, Any],
    key: str,
    columns: dict[str, str],
    dataset: str,
    where: str,
) -> tuple[str, ...]:
    """Read a required list of column names and prove each is exported by the dataset."""
    names = _string_tuple(payload, key, where)
    if not names:
        raise RuleError(f"{where}.{key} must name at least one column")
    for column in names:
        if column not in columns:
            raise RuleError(f"{where}.{key} names {column!r}, not exported by {dataset}")
    return names


def _assert_thresholds_are_read(
    thresholds: tuple[RuleThreshold, ...],
    predicate: Predicate,
    severity: tuple[SeverityLevel, ...],
    scope_filter: Predicate | None,
    where: str,
) -> None:
    """Refuse a rule that declares a threshold no predicate consults.

    A threshold nothing reads still appears in the file, still looks governed, and still
    changes nothing when edited -- which is a worse state than not declaring it at all.
    """
    read = set(predicate.thresholds)
    for band in severity:
        if band.predicate is not None:
            read |= set(band.predicate.thresholds)
    if scope_filter is not None:
        read |= set(scope_filter.thresholds)
    declared = {threshold.name for threshold in thresholds}
    if declared - read:
        raise RuleError(
            f"{where} declares threshold(s) {sorted(declared - read)} that no predicate "
            "reads; an undisclosed threshold that changes nothing is worse than none"
        )


def _read_enabled_rule(payload: dict[str, Any], where: str, rule_id: str) -> ActionRule:
    """Build an enabled rule, validating every declaration against the export contract."""
    dataset = _string(payload, "source_dataset", where)
    columns = _column_types(dataset, where)
    thresholds = _read_thresholds(payload, where)
    kinds: dict[str, ValueKind] = {threshold.name: "number" for threshold in thresholds}

    entity_key = _exported_columns(payload, "entity_key", columns, dataset, where)
    evidence = _exported_columns(payload, "evidence", columns, dataset, where)

    store_field = _optional_string(payload, "store_field", where)
    if store_field is not None and store_field not in columns:
        raise RuleError(f"{where}.store_field {store_field!r} is not exported by {dataset}")
    date_field = _optional_string(payload, "date_field", where)
    if date_field is not None and columns.get(date_field) != "date":
        raise RuleError(f"{where}.date_field {date_field!r} is not an exported date column")

    scope_as_of, scope_as_of_month, scope_filter = _read_scope(payload, columns, kinds, where)
    predicate = _compile(_string(payload, "predicate", where), columns, kinds, where)
    severity = _read_severity(payload, columns, kinds, where)

    title = _string(payload, "title", where)
    recommended_review = _string(payload, "recommended_review", where)
    limitations = _string(payload, "limitations", where)
    allowed_slots = frozenset(evidence)
    for text, located in ((title, f"{where}.title"), (recommended_review, f"{where}.review")):
        _check_language(text, located)
        _check_slots(text, allowed_slots, located)
    _check_language(limitations, f"{where}.limitations")
    _check_review_vocabulary(recommended_review, f"{where}.recommended_review")

    _assert_thresholds_are_read(thresholds, predicate, severity, scope_filter, where)

    return ActionRule(
        rule_id=rule_id,
        enabled=True,
        state="supported",
        state_reason=_string(payload, "state_reason", where),
        domain=_string(payload, "domain", where),
        entity_type=_string(payload, "entity_type", where),
        owner_role=_string(payload, "owner_role", where),
        title=title,
        description=_string(payload, "description", where),
        source_dataset=dataset,
        date_basis=_string(payload, "date_basis", where),
        scope_as_of=scope_as_of,
        scope_as_of_month=scope_as_of_month,
        scope_filter=scope_filter,
        entity_key=entity_key,
        store_field=store_field,
        date_field=date_field,
        thresholds=thresholds,
        disclosed_columns=_read_disclosed(payload, columns, where),
        minimum_sample=_read_minimum_sample(payload, columns, where),
        predicate=predicate,
        severity=severity,
        evidence=evidence,
        recommended_review=recommended_review,
        limitations=limitations,
        suppression=_string_tuple(payload, "suppression", where),
        drill_through=_read_drill_through(payload, columns, where),
    )


def _read_disabled_rule(payload: dict[str, Any], where: str, rule_id: str) -> ActionRule:
    """Build a retained-but-disabled rule.

    A disabled rule keeps its identifier, its domain, its intent and -- most importantly --
    the audited reason it does not fire. It carries no predicate, no dataset and no
    drill-through, because it has none: the whole point of the state is that the project
    cannot honestly evaluate the condition.
    """
    state = _string(payload, "state", where)
    if state not in RULE_STATES or state == "supported":
        raise RuleError(
            f"{where}.state must be one of {RULE_STATES[1:]} for a disabled rule, found {state!r}"
        )
    for banned in ("predicate", "severity", "evidence", "drill_through", "source_dataset"):
        if payload.get(banned) is not None:
            raise RuleError(
                f"{where} is disabled but declares {banned}; a disabled rule has no "
                "evaluable definition, and carrying one invites it to be switched on "
                "without the audit that would justify it"
            )
    return ActionRule(
        rule_id=rule_id,
        enabled=False,
        state=state,
        state_reason=_string(payload, "state_reason", where),
        domain=_string(payload, "domain", where),
        entity_type=_string(payload, "entity_type", where),
        owner_role=_string(payload, "owner_role", where),
        title=_string(payload, "title", where),
        description=_string(payload, "description", where),
        source_dataset=None,
        date_basis=None,
        scope_as_of=None,
        scope_as_of_month=None,
        scope_filter=None,
        entity_key=(),
        store_field=None,
        date_field=None,
        thresholds=(),
        disclosed_columns=(),
        minimum_sample=None,
        predicate=None,
        severity=(),
        evidence=(),
        recommended_review="",
        limitations=_string(payload, "limitations", where),
        suppression=_string_tuple(payload, "suppression", where),
        drill_through=None,
    )


def _read_rule(payload: dict[str, Any], index: int) -> ActionRule:
    """Read one rule from the document."""
    where = f"rules[{index}]"
    _reject_unknown(payload, _RULE_KEYS, where)
    rule_id = _string(payload, "rule_id", where)
    if not _RULE_ID.match(rule_id):
        raise RuleError(f"{where}.rule_id {rule_id!r} is not a permanent ACT identifier")
    where = f"rules[{index}] ({rule_id})"
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        raise RuleError(f"{where}.enabled must be true or false")
    rule = (
        _read_enabled_rule(payload, where, rule_id)
        if enabled
        else _read_disabled_rule(payload, where, rule_id)
    )
    if rule.domain not in ACTION_DOMAINS:
        raise RuleError(f"{where}.domain {rule.domain!r} is not one of {ACTION_DOMAINS}")
    if rule.owner_role not in OWNER_ROLES:
        raise RuleError(f"{where}.owner_role {rule.owner_role!r} is not a governed role")
    if rule.entity_type not in ENTITY_TYPES:
        raise RuleError(f"{where}.entity_type {rule.entity_type!r} is not a known entity type")
    _check_language(rule.title, f"{where}.title")
    return rule


def load_ruleset(path: Path | None = None, *, repo_root: Path | None = None) -> Ruleset:
    """Read, validate and fingerprint the rule file.

    Args:
        path: The rule file. Defaults to :data:`DEFAULT_RULES_PATH` under ``repo_root``.
        repo_root: Repository root, used to resolve the default path and to report the
            file's location relative to it.

    Returns:
        The validated ruleset, carrying the file's content hash.

    Raises:
        RuleError: On any schema, vocabulary, threshold, predicate or route failure. The
            file is refused whole: a partially-valid ruleset would produce a queue nobody
            could reason about.
    """
    root = repo_root or Path.cwd()
    location = path or (root / DEFAULT_RULES_PATH)
    try:
        raw_bytes = location.read_bytes()
    except OSError as error:
        raise RuleError(f"cannot read the action rule file at {location}: {error}") from error
    try:
        document = yaml.safe_load(raw_bytes.decode("utf-8"))
    except yaml.YAMLError as error:
        raise RuleError(f"{location} is not valid YAML: {error}") from error

    payload = _require_mapping(document, "the rule file")
    _reject_unknown(payload, _ROOT_KEYS, "the rule file")
    schema = _string(payload, "schema", "the rule file")
    if schema != ACTION_RULES_SCHEMA:
        raise RuleError(f"the rule file declares schema {schema!r}, expected {ACTION_RULES_SCHEMA}")
    version = payload.get("ruleset_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise RuleError("the rule file's ruleset_version must be a positive integer")
    defaults = _require_mapping(payload.get("defaults"), "the rule file's defaults")
    _reject_unknown(defaults, _DEFAULT_KEYS, "the rule file's defaults")
    expiry = _string(defaults, "expiry", "the rule file's defaults")
    if expiry != "dataset":
        raise RuleError(
            "the only expiry model is 'dataset': an action lives exactly as long as the "
            "dataset version that produced it, and no other model exists because nothing "
            "persists between versions"
        )

    rules_raw = payload.get("rules")
    if not isinstance(rules_raw, list) or not rules_raw:
        raise RuleError("the rule file must carry a non-empty rules list")
    rules = tuple(
        _read_rule(_require_mapping(item, f"rules[{index}]"), index)
        for index, item in enumerate(rules_raw)
    )
    identifiers = [rule.rule_id for rule in rules]
    duplicates = sorted({name for name in identifiers if identifiers.count(name) > 1})
    if duplicates:
        raise RuleError(f"the rule file repeats rule id(s): {', '.join(duplicates)}")

    try:
        relative = location.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:  # pragma: no cover - only when the file sits outside the repository
        relative = location.as_posix()
    return Ruleset(
        schema=schema,
        ruleset_version=version,
        expiry=expiry,
        change_drivers=_read_change_drivers(payload),
        rules=rules,
        file_sha256=content_sha256(raw_bytes),
        path=relative,
        _by_id={rule.rule_id: rule for rule in rules},
    )
