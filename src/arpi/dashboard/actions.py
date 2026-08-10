"""The deterministic management-action engine.

WHAT IT DOES
------------
Given a validated ruleset, the rows the dashboard export already published, an as-of date
and a dataset version, it returns a queue of review prompts. Same inputs, same bytes --
every time, on every machine, in any order the rows arrive.

WHAT IT MAY READ
----------------
Only the exported datasets. The engine is handed already-serialised records; it holds no
connection, no cursor and no credential, and it cannot see ``raw``, ``staging``,
``warehouse`` or ``audit`` even by accident. A rule that cannot be evaluated from the
public export is a rule that stays disabled, which is why the register in
``config/dashboard/action_rules.yaml`` has as many disabled identifiers as it does.

WHAT IT MAY NOT DO
------------------
It evaluates CONDITIONS. It does not compute business figures. There is no contact rate, no
show rate, no PVR, no penetration, no variance and no attainment arithmetic anywhere in this
module: every such number is read from a column SQL already published, at the grain SQL
published it. The engine also performs no aggregation of its own -- no group-by, no
cross-dataset join, no derived denominator -- because each of those would silently become a
second KPI implementation with no reconciliation behind it.

There is no rule-specific branch in this file. Nothing here says ``if rule_id ==``. Every
decision a rule makes is declared in the rule file and read generically, which is the only
arrangement under which the YAML is really the rule and the Python is really an engine.

STATELESSNESS
-------------
An action exists because a condition holds in a dataset version. It disappears when the
condition stops holding. There is no created-at, no acknowledged-at, no assignment and no
history: nothing here writes anything anywhere except the two artifacts the exporter emits.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final

from arpi.dashboard import contract as spec
from arpi.dashboard.action_predicate import PredicateValue
from arpi.dashboard.action_rules import (
    ACTION_DOMAINS,
    SEVERITY_LEVELS,
    ActionRule,
    Ruleset,
)
from arpi.exceptions import ArpiError
from arpi.validation.privacy import prohibited_columns

__all__ = [
    "ACTIONS_FILE_NAME",
    "ACTIONS_SCHEMA",
    "Action",
    "ActionEngineError",
    "SuppressionReason",
    "evaluate_ruleset",
    "queue_counts",
    "render_actions",
]


class ActionEngineError(ArpiError):
    """The engine could not honestly produce a queue."""


#: The action dataset's schema identifier.
ACTIONS_SCHEMA: Final = "arpi.management_actions/1"

#: The action dataset's file name inside the export directory.
ACTIONS_FILE_NAME: Final = "management-actions.json"

#: Severity rank for ordering. Lower sorts first.
_SEVERITY_RANK: Final[dict[str, int]] = {
    level: index for index, level in enumerate(SEVERITY_LEVELS)
}

#: Domain rank for ordering, from the console's domain order.
_DOMAIN_RANK: Final[dict[str, int]] = {domain: index for index, domain in enumerate(ACTION_DOMAINS)}

#: The separator joining a composite entity key.
#:
#: A vertical bar cannot occur in any exported business code -- they are all
#: ``PREFIX-digits`` or ISO dates -- so a composite identity can always be split back into
#: its parts, and two different key tuples can never collide on one string.
ENTITY_KEY_SEPARATOR: Final = "|"


@dataclass(frozen=True, slots=True)
class SuppressionReason:
    """One candidate row that matched a condition but did not become an action.

    Suppression is part of the rule contract, so it is returned rather than discarded. The
    console never renders these -- a suppressed pseudo-action is not a finding -- but the
    tests and the review document need to prove that the vetoes actually fire.

    Attributes:
        rule_id: The rule whose condition matched.
        entity_id: The entity the row identified.
        reason: Which veto applied.
        detail: The observed values behind the veto.
    """

    rule_id: str
    entity_id: str
    reason: str
    detail: str


@dataclass(frozen=True, slots=True)
class Action:
    """One review prompt.

    Attributes:
        action_id: ``{rule_id}:{entity_id}:{dataset_version}``.
        dedupe_key: ``{rule_id}:{entity_id}``. Exactly one action per key per version.
        record: The serialisable action, in the published field order.
        sort_key: The deterministic ordering tuple.
    """

    action_id: str
    dedupe_key: str
    record: dict[str, Any]
    sort_key: tuple[int, int, str, str, str]


def _scope_matches(rule: ActionRule, row: Mapping[str, Any], as_of_date: str) -> bool:
    """Whether a row is inside the rule's as-of scope."""
    if rule.scope_as_of is not None:
        return bool(row.get(rule.scope_as_of) == as_of_date)
    if rule.scope_as_of_month is not None:
        value = row.get(rule.scope_as_of_month)
        return isinstance(value, str) and value[:7] == as_of_date[:7]
    return True


def _entity_id(rule: ActionRule, row: Mapping[str, Any]) -> str:
    """Build the entity identity from the rule's declared key columns."""
    parts: list[str] = []
    for column in rule.entity_key:
        value = row.get(column)
        if value is None:
            raise ActionEngineError(
                f"{rule.rule_id} identifies its entity by {column!r}, which is null on a "
                "row inside the rule's scope; an action with no identity cannot be deduped"
            )
        parts.append(str(value))
    return ENTITY_KEY_SEPARATOR.join(parts)


def _sample_veto(rule: ActionRule, row: Mapping[str, Any]) -> SuppressionReason | None:
    """Apply the rule's minimum-sample discipline, if it declares one."""
    sample = rule.minimum_sample
    if sample is None:
        return None
    observed = row.get(sample.denominator)
    if observed is None:
        return SuppressionReason(
            rule_id=rule.rule_id,
            entity_id="",
            reason="denominator-not-observed",
            detail=f"{sample.denominator} is null, so the sample floor cannot be tested",
        )
    if Decimal(str(observed)) < sample.floor:
        return SuppressionReason(
            rule_id=rule.rule_id,
            entity_id="",
            reason="below-minimum-sample",
            detail=(
                f"{sample.denominator} = {observed}, below the governed floor of {sample.floor}"
            ),
        )
    return None


def _severity_for(
    rule: ActionRule, row: dict[str, PredicateValue], thresholds: dict[str, Decimal]
) -> tuple[str, str | None] | None:
    """Return the first matching severity band and the predicate that matched it.

    The first match wins, and the bands are validated to run most severe first, so one
    entity can never produce three actions by qualifying for three levels.
    """
    for band in rule.severity:
        if band.predicate is None:
            return band.level, None
        if band.predicate.evaluate(row, thresholds) is True:
            return band.level, band.predicate.source
    return None


def _evidence_for(rule: ActionRule, row: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Copy the rule's evidence columns across verbatim.

    The value is whatever the export published -- including ``null``, which stays ``null``.
    Coalescing a missing balance or an unobserved response to zero here would destroy the
    exact distinction the warehouse maintains and the console renders.
    """
    if rule.source_dataset is None:  # pragma: no cover - disabled rules never reach here
        raise ActionEngineError(f"{rule.rule_id} has no source dataset")
    entry = spec.dataset(rule.source_dataset)
    evidence: list[dict[str, Any]] = []
    for name in rule.evidence:
        column = entry.column(name)
        evidence.append(
            {
                "name": name,
                "value": row.get(name),
                "type": column.type,
                "unit": column.unit,
                "display_precision": column.display_precision,
            }
        )
    return evidence


def _thresholds_used(
    rule: ActionRule, row: Mapping[str, Any], matched: str | None
) -> list[dict[str, Any]]:
    """Assemble the thresholds that decided this action, for disclosure.

    Two kinds appear, and they are labelled differently on purpose. A GOVERNED value is
    read from the row, so the console shows the number the export carried -- this is how
    the 60-day aged threshold reaches the screen without being restated anywhere. A REVIEW
    threshold is owned by the rule file and is always labelled a project default.
    """
    used: list[dict[str, Any]] = []
    for disclosed in rule.disclosed_columns:
        used.append(
            {
                "name": disclosed.column,
                "label": disclosed.label,
                "value": _as_text(row.get(disclosed.column)),
                "units": disclosed.units,
                "source": "governed",
                "authority": disclosed.authority,
            }
        )
    referenced = set(rule.predicate.thresholds) if rule.predicate is not None else set()
    if matched is not None:
        for band in rule.severity:
            if band.predicate is not None and band.predicate.source == matched:
                referenced |= set(band.predicate.thresholds)
    if rule.scope_filter is not None:
        referenced |= set(rule.scope_filter.thresholds)
    for threshold in rule.thresholds:
        if threshold.name not in referenced:
            continue
        used.append(
            {
                "name": threshold.name,
                "label": threshold.label,
                "value": _as_text(threshold.value),
                "units": threshold.units,
                "source": "project-default-review-threshold",
                "authority": rule.rule_id,
            }
        )
    sample = rule.minimum_sample
    if sample is not None:
        used.append(
            {
                "name": "minimum_sample_floor",
                "label": "Minimum sample",
                "value": _as_text(sample.floor),
                "units": sample.disclosure,
                "source": "governed",
                "authority": sample.authority,
            }
        )
    return used


def _as_text(value: Any) -> str | None:
    """Render a threshold value as exact text, never through a float."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        # NOT normalised. A ratio authored as 0.70 must disclose as "0.70": normalising
        # would strip the trailing zero and show a reader a threshold spelled differently
        # from the one in the rule file they can go and read.
        return format(value, "f")
    return str(value)


def _drill_through(rule: ActionRule, row: Mapping[str, Any]) -> str:
    """Build the drill-through URL from the rule's declared route and parameters.

    Parameters whose template resolves to a null value are DROPPED rather than emitted
    empty: a link carrying ``?unit=`` would arrive at a destination that filters on nothing
    and says it is filtering.
    """
    if rule.drill_through is None:  # pragma: no cover - disabled rules never reach here
        raise ActionEngineError(f"{rule.rule_id} has no drill-through")
    pairs: list[str] = []
    for key, template in rule.drill_through.params:
        resolved = template
        dropped = False
        start = template.find("{")
        while start != -1:
            end = template.find("}", start)
            column = template[start + 1 : end]
            value = row.get(column)
            if value is None:
                dropped = True
                break
            resolved = resolved.replace(f"{{{column}}}", str(value))
            start = template.find("{", end)
        if not dropped:
            pairs.append(f"{key}={resolved}")
    query = "&".join(pairs)
    return f"{rule.drill_through.route}?{query}" if query else rule.drill_through.route


def _render_text(template: str, row: Mapping[str, Any], evidence: Sequence[str]) -> str:
    """Substitute evidence slots into a rule template.

    Only the rule's own evidence columns are substitutable, and the schema loader has
    already refused any other slot. A null value renders as the literal word ``not
    recorded`` so the sentence stays true rather than reading as an empty gap.
    """
    rendered = template
    for column in evidence:
        token = f"{{{column}}}"
        if token in rendered:
            value = row.get(column)
            rendered = rendered.replace(token, "not recorded" if value is None else str(value))
    return rendered


def _assert_evidence_is_public(ruleset: Ruleset) -> None:
    """Refuse a ruleset whose evidence names anything the privacy contract prohibits.

    The export's column allowlist is the primary control and every evidence column is
    already one of its members, so this can only fire if the allowlist itself were widened.
    It is here anyway: the action queue is a new door onto the same data, and a new door is
    exactly where a control gets forgotten. The failure is loud -- the export refuses --
    rather than a silent strip, because silently dropping a field would leave an action
    whose evidence no longer explains why it fired.
    """
    for rule in ruleset.enabled:
        offending = prohibited_columns(rule.evidence)
        if offending:
            raise ActionEngineError(
                f"{rule.rule_id} carries prohibited evidence field(s): "
                f"{', '.join(offending)}; the action queue is not a route around the "
                "privacy boundary"
            )


def evaluate_ruleset(
    ruleset: Ruleset,
    datasets: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    as_of_date: str,
    dataset_version: int,
) -> tuple[list[Action], list[SuppressionReason]]:
    """Evaluate every enabled rule and return the queue.

    Args:
        ruleset: The validated rule file.
        datasets: Exported dataset name to its records. Only the datasets enabled rules
            declare need be present.
        as_of_date: The export's as-of date, which defines every rule's scope.
        dataset_version: The export's dataset version, which forms part of each identity.

    Returns:
        The actions in deterministic order, and every suppression that occurred.

    Raises:
        ActionEngineError: If a rule names a dataset that was not supplied, if an entity
            key is null inside scope, or if evidence would breach the privacy contract.
    """
    _assert_evidence_is_public(ruleset)
    actions: dict[str, Action] = {}
    suppressed: list[SuppressionReason] = []

    for rule in ruleset.enabled:
        if rule.source_dataset is None or rule.predicate is None:  # pragma: no cover
            raise ActionEngineError(f"{rule.rule_id} is enabled without a definition")
        if rule.source_dataset not in datasets:
            raise ActionEngineError(
                f"{rule.rule_id} reads {rule.source_dataset!r}, which was not supplied to "
                "the engine"
            )
        thresholds = rule.threshold_values
        for raw in datasets[rule.source_dataset]:
            if not _scope_matches(rule, raw, as_of_date):
                continue
            row: dict[str, PredicateValue] = dict(raw)
            if (
                rule.scope_filter is not None
                and rule.scope_filter.evaluate(row, thresholds) is not True
            ):
                continue
            if rule.predicate.evaluate(row, thresholds) is not True:
                continue
            entity_id = _entity_id(rule, raw)
            veto = _sample_veto(rule, raw)
            if veto is not None:
                suppressed.append(
                    SuppressionReason(
                        rule_id=veto.rule_id,
                        entity_id=entity_id,
                        reason=veto.reason,
                        detail=veto.detail,
                    )
                )
                continue
            matched = _severity_for(rule, row, thresholds)
            if matched is None:
                suppressed.append(
                    SuppressionReason(
                        rule_id=rule.rule_id,
                        entity_id=entity_id,
                        reason="no-severity-band-matched",
                        detail="the condition held but no severity predicate did",
                    )
                )
                continue
            severity, matched_source = matched
            dedupe_key = f"{rule.rule_id}:{entity_id}"
            if dedupe_key in actions:
                suppressed.append(
                    SuppressionReason(
                        rule_id=rule.rule_id,
                        entity_id=entity_id,
                        reason="duplicate-dedupe-key",
                        detail=f"{dedupe_key} already produced an action in this version",
                    )
                )
                continue
            store = str(raw.get(rule.store_field)) if rule.store_field else ""
            evidence = _evidence_for(rule, raw)
            record = {
                "action_id": f"{dedupe_key}:{dataset_version}",
                "rule_id": rule.rule_id,
                "domain": rule.domain,
                "as_of_date": as_of_date,
                "store": store or None,
                "entity_type": rule.entity_type,
                "entity_id": entity_id,
                "severity": severity,
                "title": _render_text(rule.title, raw, rule.evidence),
                "owner_role": rule.owner_role,
                "recommended_review": _render_text(rule.recommended_review, raw, rule.evidence),
                "limitations": rule.limitations,
                "date_basis": rule.date_basis,
                "observed_date": raw.get(rule.date_field) if rule.date_field else None,
                "drill_through": _drill_through(rule, raw),
                "evidence": evidence,
                "thresholds_used": _thresholds_used(rule, raw, matched_source),
            }
            actions[dedupe_key] = Action(
                action_id=str(record["action_id"]),
                dedupe_key=dedupe_key,
                record=record,
                sort_key=(
                    _SEVERITY_RANK[severity],
                    _DOMAIN_RANK[rule.domain],
                    store,
                    rule.rule_id,
                    entity_id,
                ),
            )

    ordered = sorted(actions.values(), key=lambda action: action.sort_key)
    suppressed.sort(key=lambda item: (item.rule_id, item.entity_id, item.reason))
    return ordered, suppressed


def render_actions(actions: Sequence[Action]) -> list[dict[str, Any]]:
    """Return the serialisable records, in queue order."""
    return [action.record for action in actions]


def queue_counts(actions: Sequence[Action]) -> dict[str, dict[str, int]]:
    """Count the queue by every facet the console offers.

    Counts are presentation figures derived from the queue itself, not new KPIs. They are
    computed once here so the server and the browser cannot disagree about them.

    Args:
        actions: The queue, in any order.

    Returns:
        Counts by severity, domain, store, owner role and rule, each key sorted.
    """
    facets: dict[str, dict[str, int]] = {
        "by_severity": {},
        "by_domain": {},
        "by_store": {},
        "by_owner_role": {},
        "by_rule": {},
    }
    fields = {
        "by_severity": "severity",
        "by_domain": "domain",
        "by_store": "store",
        "by_owner_role": "owner_role",
        "by_rule": "rule_id",
    }
    for action in actions:
        for facet, field_name in fields.items():
            value = action.record.get(field_name)
            if value is None:
                continue
            facets[facet][str(value)] = facets[facet].get(str(value), 0) + 1
    ordered: dict[str, dict[str, int]] = {}
    for facet, counts in facets.items():
        if facet == "by_severity":
            ordered[facet] = {
                level: counts.get(level, 0) for level in SEVERITY_LEVELS if level in counts
            }
        elif facet == "by_domain":
            ordered[facet] = {
                domain: counts[domain] for domain in ACTION_DOMAINS if domain in counts
            }
        else:
            ordered[facet] = {key: counts[key] for key in sorted(counts)}
    return ordered
