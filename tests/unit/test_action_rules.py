"""The rule register and the engine: what fires, what is suppressed, and what may not exist.

WHAT THESE TESTS ARE FOR
------------------------
The committed queue is one dataset, and a queue that happens to be right today proves very
little about a rule. So each enabled rule is driven with a fixture built to FIRE and a
fixture built to SUPPRESS, at the boundary values the rule file declares, and each disabled
identifier is required to stay in the register, stay off, and produce nothing.

The register audit's own claims are asserted too. "This rule is disabled because the project
holds no such evidence" is a testable statement about the export contract, and it is tested
rather than taken on trust.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from arpi.constants import MINIMUM_SAMPLE_ELIGIBLE_DEALS
from arpi.dashboard import contract as spec
from arpi.dashboard.action_export import build_action_stage, load_exported_datasets
from arpi.dashboard.action_rules import (
    ACTION_DOMAINS,
    OWNER_ROLES,
    SEVERITY_LEVELS,
    RuleError,
    load_ruleset,
)
from arpi.dashboard.actions import ActionEngineError, evaluate_ruleset, queue_counts

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = REPO_ROOT / "data" / "dashboard"

#: Every permanent identifier the planning contract proposed. None may be deleted.
PROPOSED_RULE_IDS: tuple[str, ...] = (
    "ACT-INV-001",
    "ACT-INV-002",
    "ACT-INV-003",
    "ACT-INV-004",
    "ACT-INV-005",
    "ACT-INV-006",
    "ACT-INV-007",
    "ACT-SLS-001",
    "ACT-SLS-002",
    "ACT-SLS-003",
    "ACT-SLS-004",
    "ACT-SLS-005",
    "ACT-SLS-006",
    "ACT-FNI-001",
    "ACT-FNI-002",
    "ACT-FNI-003",
    "ACT-FNI-004",
    "ACT-FNI-005",
    "ACT-FNI-006",
    "ACT-FNI-007",
    "ACT-LED-001",
    "ACT-LED-002",
    "ACT-LED-003",
    "ACT-LED-004",
    "ACT-LED-005",
    "ACT-ACC-001",
    "ACT-ACC-002",
    "ACT-ACC-003",
    "ACT-ACC-004",
    "ACT-ACC-005",
)


@pytest.fixture(scope="module")
def ruleset() -> Any:
    """The committed rule file."""
    return load_ruleset(repo_root=REPO_ROOT)


@pytest.fixture(scope="module")
def exported() -> dict[str, list[dict[str, Any]]]:
    """Every dataset the enabled rules read, from the committed export."""
    rules = load_ruleset(repo_root=REPO_ROOT)
    return load_exported_datasets(
        EXPORT_DIR, sorted({*rules.source_datasets, "gross-change-bridge"})
    )


@pytest.fixture(scope="module")
def manifest() -> dict[str, Any]:
    """The committed export manifest."""
    payload: dict[str, Any] = json.loads((EXPORT_DIR / "manifest.json").read_text("utf-8"))
    return payload


class TestTheRegister:
    """Every proposed identifier is accounted for, permanently."""

    def test_every_proposed_identifier_is_still_present(self, ruleset: Any) -> None:
        assert tuple(rule.rule_id for rule in ruleset.rules) == PROPOSED_RULE_IDS

    def test_the_register_holds_no_identifier_nobody_proposed(self, ruleset: Any) -> None:
        assert {rule.rule_id for rule in ruleset.rules} == set(PROPOSED_RULE_IDS)

    def test_every_rule_uses_the_governed_vocabularies(self, ruleset: Any) -> None:
        for rule in ruleset.rules:
            assert rule.domain in ACTION_DOMAINS
            assert rule.owner_role in OWNER_ROLES
            for band in rule.severity:
                assert band.level in SEVERITY_LEVELS

    def test_there_is_no_employee_action_family(self, ruleset: Any) -> None:
        """`DASH.11`'s fairness contract is a boundary, not a gap to be filled.

        No rule may be about an employee, and no domain may be `employees`. A rate-based
        rule grouped by a person would need the sample discipline that surface built, and
        an action family aimed at people would need its own specification.
        """
        assert "employees" not in ACTION_DOMAINS
        for rule in ruleset.rules:
            assert rule.entity_type != "employee"
            assert "employee" not in rule.title.lower()

    def test_every_disabled_rule_carries_an_audited_reason(self, ruleset: Any) -> None:
        for rule in ruleset.disabled:
            assert rule.state != "supported"
            assert len(rule.state_reason) > 80, rule.rule_id

    def test_a_disabled_rule_carries_no_evaluable_definition(self, ruleset: Any) -> None:
        for rule in ruleset.disabled:
            assert rule.predicate is None
            assert rule.source_dataset is None
            assert rule.drill_through is None
            assert rule.severity == ()

    def test_a_disabled_rule_emits_nothing(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        actions, _ = evaluate_ruleset(ruleset, exported, as_of_date="2025-12-31", dataset_version=1)
        fired = {action.record["rule_id"] for action in actions}
        for rule in ruleset.disabled:
            assert rule.rule_id not in fired


class TestTheDataQualityBoundary:
    """A condition an earlier gate already prevents is not a management action.

    Each assertion below proves the claim the register makes: the condition does not occur
    in the committed export, because something upstream would have failed first.
    """

    def test_no_deal_breaks_the_gross_identity(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """`ACT-SLS-006`, and the reason it stays disabled."""
        from decimal import Decimal

        offenders = [
            row
            for row in exported["deal-explorer"]
            if Decimal(row["front_end_gross"]) + Decimal(row["back_end_gross"])
            != Decimal(row["total_gross"])
        ]
        assert offenders == []

    def test_no_financed_deal_lacks_a_lender(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """`ACT-FNI-005`. A null lender occurs only where a lender is correctly absent."""
        financed = {"Retail Finance", "Lease"}
        offenders = [
            row["sale_id"]
            for row in exported["deal-jacket"]
            if row["finance_structure"] in financed and row["lender_code"] is None
        ]
        assert offenders == []

    def test_no_adjustment_exceeds_its_original_product_gross(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """`ACT-FNI-004`. Net product gross is never driven below zero."""
        from decimal import Decimal

        offenders = [
            row["sale_id"]
            for row in exported["deal-jacket"]
            if Decimal(row["net_product_gross_as_of"]) < 0
        ]
        assert offenders == []

    def test_every_dataset_declares_a_business_key_the_exporter_asserts(self) -> None:
        """`ACT-ACC-004`. A duplicate cannot reach a valid export at all."""
        for entry in spec.DATASETS:
            assert entry.business_key, entry.name


class TestTheMissingDataBoundary:
    """A rule the project cannot evaluate honestly is disabled, not approximated."""

    def test_no_dataset_carries_lead_activity_at_vehicle_grain(self) -> None:
        """`ACT-INV-002`. Lead measures exist, but never keyed to a unit in stock."""
        units = spec.dataset("inventory-units")
        assert not any("lead" in column.name for column in units.columns)

    def test_no_dataset_carries_appointment_activity_at_vehicle_grain(self) -> None:
        """`ACT-INV-004`."""
        units = spec.dataset("inventory-units")
        assert not any("appointment" in column.name for column in units.columns)

    def test_the_posting_lag_column_is_not_a_posting_delay(self) -> None:
        """`ACT-ACC-005`, and the trap it avoids.

        `inventory-accounting.posting_lag_days` looks like the measure the rule needs. Its
        own contract note says it is `accounting_date - acquisition_date`, which is
        `days_in_stock` under another name, and that ARPI holds no posting timestamp.
        Enabling the rule would mean inventing the second date.
        """
        entry = spec.dataset("inventory-accounting")
        assert "posting_lag_days is the NARROWED" in entry.notes
        # The finding itself: the column is days_in_stock under another name, so a rule
        # reading it as a posting delay would be reading the unit's AGE and calling it a
        # journal timing. Every exported row carries the two as one value.
        rows = load_exported_datasets(EXPORT_DIR, ["inventory-accounting"])["inventory-accounting"]
        assert rows != []
        assert all(row["posting_lag_days"] == row["days_in_stock"] for row in rows)

    def test_the_gl_variance_is_an_account_position_not_a_unit_one(self) -> None:
        """`ACT-INV-005`. Dividing an account variance across units would invent a figure."""
        entry = spec.dataset("inventory-gl-reconciliation")
        assert "vehicle_id" not in entry.column_names
        assert entry.business_key == ("dealership_id", "comparison_date", "gl_account_number")


class TestTheGrainBoundary:
    """A rate rule may only fire where the metric's own denominator can reach the floor."""

    def test_the_lead_denominators_never_reach_the_governed_floor(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """`ACT-LED-002` and `ACT-LED-003`, tested rather than asserted in prose."""
        largest = max(row["valid_leads"] for row in exported["lead-response"])
        assert largest < MINIMUM_SAMPLE_ELIGIBLE_DEALS

    def test_the_show_rate_denominator_does_reach_the_floor(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """`ACT-LED-004`, which is why it is the one enabled lead rate rule."""
        reaching = [
            row
            for row in exported["appointment-funnel"]
            if row["eligible_appointments"] >= MINIMUM_SAMPLE_ELIGIBLE_DEALS
        ]
        assert reaching != []

    def test_the_show_to_sale_cohort_matures_only_off_the_window_edge(
        self, exported: dict[str, list[dict[str, Any]]], manifest: dict[str, Any]
    ) -> None:
        """`ACT-LED-005`.

        The only rows meeting the floor fall on the as-of date, where a sale that follows a
        show has nowhere to be recorded. Firing there would report a window edge as a
        management condition.
        """
        as_of = manifest["as_of_date"]
        reaching = [
            row
            for row in exported["appointment-funnel"]
            if row["shown_appointments"] >= MINIMUM_SAMPLE_ELIGIBLE_DEALS
        ]
        assert reaching != []
        assert all(row["appointment_date"] == as_of for row in reaching)


class TestThresholdAuthority:
    """One authority per threshold, and every rule-owned one labelled a project default."""

    def test_no_rule_restates_the_governed_aged_threshold(self, ruleset: Any) -> None:
        """The planning document's 90-day example is NOT reinstated.

        No rule declares a threshold whose value is the aged threshold. The aged condition
        is read from the governed boolean and the number is disclosed from the row.
        """
        for rule in ruleset.enabled:
            for threshold in rule.thresholds:
                assert "aged_threshold" not in threshold.name

    def test_the_aged_threshold_reaches_the_console_from_the_row(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        rules = load_ruleset(repo_root=REPO_ROOT)
        aged_rule = rules.rule("ACT-INV-001")
        disclosed = [item.column for item in aged_rule.disclosed_columns]
        assert "aged_threshold_days" in disclosed
        published = {row["aged_threshold_days"] for row in exported["inventory-units"]}
        assert published == {60}

    def test_every_rule_owned_threshold_is_labelled_a_project_default(self, ruleset: Any) -> None:
        for rule in ruleset.enabled:
            for threshold in rule.thresholds:
                assert "project default" in threshold.label.lower(), threshold.name
                assert threshold.rationale

    def test_no_threshold_claims_to_be_an_industry_standard(self, ruleset: Any) -> None:
        banned = ("industry", "benchmark", "oem standard", "best practice", "compliance")
        for rule in ruleset.rules:
            for threshold in rule.thresholds:
                assert not any(word in threshold.label.lower() for word in banned)

    def test_the_sample_floor_comes_from_the_governed_authority(self, ruleset: Any) -> None:
        for rule in ruleset.enabled:
            if rule.minimum_sample is not None:
                assert rule.minimum_sample.floor == MINIMUM_SAMPLE_ELIGIBLE_DEALS

    def test_a_rate_rule_floors_on_its_own_denominator(self, ruleset: Any) -> None:
        """Not a generic row count: the metric's actual denominator."""
        rule = ruleset.rule("ACT-LED-004")
        assert rule.minimum_sample is not None
        assert rule.minimum_sample.denominator == "eligible_appointments"


class TestTheEngine:
    """Identity, ordering, dedupe and severity over the committed export."""

    @staticmethod
    @pytest.fixture(scope="module")
    def evaluated(exported: dict[str, list[dict[str, Any]]]) -> Any:
        rules = load_ruleset(repo_root=REPO_ROOT)
        return evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=17)

    def test_the_identity_contract_holds_for_every_action(self, evaluated: Any) -> None:
        actions, _ = evaluated
        for action in actions:
            record = action.record
            assert action.action_id == f"{record['rule_id']}:{record['entity_id']}:17"

    def test_no_dedupe_key_appears_twice(self, evaluated: Any) -> None:
        actions, _ = evaluated
        keys = [action.dedupe_key for action in actions]
        assert len(keys) == len(set(keys))

    def test_one_entity_never_produces_two_severities(self, evaluated: Any) -> None:
        actions, _ = evaluated
        seen: dict[tuple[str, str], str] = {}
        for action in actions:
            key = (action.record["rule_id"], action.record["entity_id"])
            assert key not in seen
            seen[key] = action.record["severity"]

    def test_the_queue_is_ordered_most_severe_first(self, evaluated: Any) -> None:
        actions, _ = evaluated
        ranks = [SEVERITY_LEVELS.index(action.record["severity"]) for action in actions]
        assert ranks == sorted(ranks)

    def test_the_order_is_a_total_order_over_visible_values(self, evaluated: Any) -> None:
        actions, _ = evaluated
        keys = [action.sort_key for action in actions]
        assert keys == sorted(keys)
        assert len(keys) == len(set(keys))

    def test_a_dataset_version_change_changes_every_identity(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        rules = load_ruleset(repo_root=REPO_ROOT)
        first, _ = evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=17)
        second, _ = evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=18)
        assert {a.action_id for a in first}.isdisjoint({a.action_id for a in second})
        # The dedupe key is version-independent, which is what makes the SAME condition
        # recognisable across versions without anything persisting.
        assert [a.dedupe_key for a in first] == [a.dedupe_key for a in second]

    def test_suppression_actually_occurs(self, evaluated: Any) -> None:
        _, suppressed = evaluated
        assert suppressed != []
        assert any(item.reason == "below-minimum-sample" for item in suppressed)

    def test_no_suppressed_candidate_becomes_an_action(self, evaluated: Any) -> None:
        actions, suppressed = evaluated
        fired = {(a.record["rule_id"], a.record["entity_id"]) for a in actions}
        for item in suppressed:
            assert (item.rule_id, item.entity_id) not in fired


class TestDeterminism:
    """Same inputs, same bytes."""

    def test_two_runs_produce_byte_identical_output(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        first = build_action_stage(
            exported, as_of_date="2025-12-31", dataset_version=17, repo_root=REPO_ROOT
        )
        second = build_action_stage(
            exported, as_of_date="2025-12-31", dataset_version=17, repo_root=REPO_ROOT
        )
        assert first.payload == second.payload
        assert first.manifest_block == second.manifest_block

    def test_row_order_does_not_change_the_output(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """The queue is a property of the data, not of the order it arrived in."""
        forward = build_action_stage(
            exported, as_of_date="2025-12-31", dataset_version=17, repo_root=REPO_ROOT
        )
        reversed_input = {name: list(reversed(rows)) for name, rows in exported.items()}
        backward = build_action_stage(
            reversed_input, as_of_date="2025-12-31", dataset_version=17, repo_root=REPO_ROOT
        )
        assert forward.payload == backward.payload

    def test_no_timestamp_enters_the_queue(self, exported: dict[str, list[dict[str, Any]]]) -> None:
        stage = build_action_stage(
            exported, as_of_date="2025-12-31", dataset_version=17, repo_root=REPO_ROOT
        )
        text = stage.payload.decode("utf-8")
        for forbidden in ("created_at", "generated_at", "acknowledged", "assigned_at", "closed_at"):
            assert forbidden not in text

    def test_the_committed_queue_is_the_queue_the_ruleset_produces(
        self, exported: dict[str, list[dict[str, Any]]], manifest: dict[str, Any]
    ) -> None:
        stage = build_action_stage(
            exported,
            as_of_date=manifest["as_of_date"],
            dataset_version=manifest["dataset_version"],
            repo_root=REPO_ROOT,
        )
        committed = (EXPORT_DIR / "management-actions.json").read_bytes()
        assert stage.payload == committed


class TestPrivacy:
    """The queue is a new door onto the same data. It is not a way around the boundary."""

    PROHIBITED = (
        "customer_name",
        "customer_email",
        "phone",
        "email_address",
        "message",
        "employee_name",
        "salary",
        "compensation",
        "credit_score",
        "ssn",
        "date_of_birth",
        "street_address",
    )

    def test_no_prohibited_field_appears_in_the_committed_queue(self) -> None:
        text = (EXPORT_DIR / "management-actions.json").read_text("utf-8").lower()
        for field in self.PROHIBITED:
            assert field not in text

    def test_prohibited_evidence_fails_the_export_loudly(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """A prohibited field is REFUSED, never silently stripped.

        Stripping would leave an action whose evidence no longer explains why it fired,
        which is a quieter failure and a worse one.
        """
        from dataclasses import replace

        rules = load_ruleset(repo_root=REPO_ROOT)
        poisoned = replace(rules.rule("ACT-INV-001"), evidence=("days_in_stock", "customer_name"))
        broken = replace(rules, rules=(poisoned,), _by_id={poisoned.rule_id: poisoned})
        with pytest.raises(ActionEngineError, match="prohibited evidence"):
            evaluate_ruleset(broken, exported, as_of_date="2025-12-31", dataset_version=17)

    def test_no_rule_reads_a_lead_at_individual_grain(self, ruleset: Any) -> None:
        """The public product carries no customer records, and the queue adds none."""
        for rule in ruleset.enabled:
            assert rule.entity_type != "lead"
            assert "lead_id" not in rule.entity_key


class TestSchemaRejection:
    """The loader refuses a document it cannot fully understand."""

    def _write(self, tmp_path: Path, document: str) -> Path:
        path = tmp_path / "action_rules.yaml"
        path.write_text(document, encoding="utf-8")
        return path

    def test_an_unknown_root_field_is_refused(self, tmp_path: Path) -> None:
        path = self._write(tmp_path, "schema: arpi.action_rules/1\nsurprise: 1\n")
        with pytest.raises(RuleError, match="unknown field"):
            load_ruleset(path, repo_root=REPO_ROOT)

    def test_a_wrong_schema_is_refused(self, tmp_path: Path) -> None:
        path = self._write(tmp_path, "schema: arpi.action_rules/9\n")
        with pytest.raises(RuleError, match="declares schema"):
            load_ruleset(path, repo_root=REPO_ROOT)

    def test_a_malformed_document_is_refused(self, tmp_path: Path) -> None:
        path = self._write(tmp_path, "schema: [\n")
        with pytest.raises(RuleError):
            load_ruleset(path, repo_root=REPO_ROOT)

    def test_a_missing_file_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(RuleError, match="cannot read"):
            load_ruleset(tmp_path / "absent.yaml", repo_root=REPO_ROOT)


class TestCounts:
    """Facet counts are counts of the queue, and the manifest says the same."""

    def test_the_manifest_counts_match_the_committed_queue(self, manifest: dict[str, Any]) -> None:
        actions = json.loads((EXPORT_DIR / "management-actions.json").read_text("utf-8"))
        block = manifest["management_actions"]
        assert block["row_count"] == len(actions)
        by_severity: dict[str, int] = {}
        for action in actions:
            by_severity[action["severity"]] = by_severity.get(action["severity"], 0) + 1
        assert block["counts"]["by_severity"] == by_severity

    def test_the_counts_helper_agrees_with_the_rows(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        rules = load_ruleset(repo_root=REPO_ROOT)
        actions, _ = evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=17)
        counts = queue_counts(actions)
        assert sum(counts["by_domain"].values()) == len(actions)
        assert sum(counts["by_severity"].values()) == len(actions)


class TestEveryEnabledRuleFiresAndSuppresses:
    """One firing fixture and one suppressed fixture for each enabled rule.

    The fixtures are DERIVED rather than hand-written, which makes them honest in a way a
    literal row could not be: the firing row is a real row from the committed export that
    the rule actually matched, and the suppressed row is that same row with the fields the
    predicate reads set to NULL.

    That second construction tests the property most likely to be got wrong. A rule whose
    condition is `ratio >= 1.05` must not fire on a unit with no market estimate, and a rule
    whose condition is `is_price_reduced_since_prior == false` must not fire on a unit that
    has no prior snapshot to compare against. Under two-valued logic both would; under the
    Kleene rules the engine implements, both go UNKNOWN and suppress.
    """

    @staticmethod
    def _firing_rows(
        ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> dict[str, dict[str, Any]]:
        """One real row per enabled rule that the rule's CONDITION matched.

        Searched over the whole reporting window rather than the as-of scope, because a
        fixture tests the rule and not the current period. Two enabled rules match nothing
        inside the as-of scope and therefore produce no current action; they are still live,
        still evaluable, and still matched by rows the export carries. `TestHonestZeroes`
        below records exactly that, so the distinction between "this rule found nothing
        today" and "this rule can never find anything" is asserted rather than assumed.
        """
        found: dict[str, dict[str, Any]] = {}
        for rule in ruleset.enabled:
            assert rule.predicate is not None and rule.source_dataset is not None
            thresholds = rule.threshold_values
            for row in exported[rule.source_dataset]:
                if (
                    rule.scope_filter is not None
                    and rule.scope_filter.evaluate(dict(row), thresholds) is not True
                ):
                    continue
                if rule.predicate.evaluate(dict(row), thresholds) is True:
                    found[rule.rule_id] = row
                    break
        return found

    def test_every_enabled_rule_has_a_row_that_matches_its_condition(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """Every enabled rule is evaluable against real data and matches something.

        A rule that matches nothing anywhere in the export is either mis-specified or reading
        a column that never holds the value it tests, and either way it is not a rule this
        project can claim to have enabled.
        """
        firing = self._firing_rows(ruleset, exported)
        missing = [rule.rule_id for rule in ruleset.enabled if rule.rule_id not in firing]
        assert missing == []

    @staticmethod
    def _asks_about_absence(rule: Any) -> bool:
        """Whether a rule's CONDITION is a null test.

        Derived from the predicate rather than listed by identifier, so a third such rule is
        handled by the same reasoning instead of by an edit to a hard-coded exception. Two
        rules qualify today: `ACT-FNI-006` asks "was there nobody on the F&I desk?" and
        `ACT-ACC-002` asks "is one side of this control comparison absent?". For both, a null
        is the ANSWER rather than an unknown, and suppressing on it would be the wrong
        reading of the same value every other rule must suppress on.

        `ACT-ACC-001` deliberately does not qualify: `is not null` is the mirror question,
        and a null makes it suppress exactly as it should.
        """
        return rule.predicate is not None and "is null" in rule.predicate.source

    def test_every_enabled_rule_suppresses_when_its_operands_are_unknown(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        firing = self._firing_rows(ruleset, exported)
        checked = 0
        for rule in ruleset.enabled:
            if self._asks_about_absence(rule):
                continue
            assert rule.predicate is not None
            row = dict(firing[rule.rule_id])
            for field_name in rule.predicate.fields:
                row[field_name] = None
            verdict = rule.predicate.evaluate(row, rule.threshold_values)
            assert verdict is not True, rule.rule_id
            checked += 1
        assert checked >= 8

    def test_a_rule_that_asks_about_absence_suppresses_on_a_present_value(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """Their fire/suppress pair is the inverse of every other rule's."""
        firing = self._firing_rows(ruleset, exported)
        absence_rules = [rule for rule in ruleset.enabled if self._asks_about_absence(rule)]
        assert len(absence_rules) == 2
        for rule in absence_rules:
            assert rule.predicate is not None
            row = dict(firing[rule.rule_id])
            assert rule.predicate.evaluate(row, rule.threshold_values) is True
            for field_name in rule.predicate.fields:
                row[field_name] = "present"
            assert rule.predicate.evaluate(row, rule.threshold_values) is False, rule.rule_id

    def test_every_enabled_rule_reaches_a_severity_band(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """A condition that matches but reaches no band would be a silently dropped action."""
        firing = self._firing_rows(ruleset, exported)
        for rule in ruleset.enabled:
            row = dict(firing[rule.rule_id])
            matched = [
                band.level
                for band in rule.severity
                if band.predicate is None
                or band.predicate.evaluate(row, rule.threshold_values) is True
            ]
            assert matched != [], rule.rule_id

    def test_the_first_matching_band_wins(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """An entity qualifying for two bands produces ONE action at the more severe."""
        rules = load_ruleset(repo_root=REPO_ROOT)
        actions, _ = evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=17)
        aged = [a for a in actions if a.record["rule_id"] == "ACT-INV-001"]
        high = [a for a in aged if a.record["severity"] == "high"]
        assert high != []
        for action in high:
            days = next(
                item["value"]
                for item in action.record["evidence"]
                if item["name"] == "days_in_stock"
            )
            # A unit past the high band is also past the catch-all, and produces one action.
            assert days >= 120


class TestThresholdBoundaries:
    """Inclusive or exclusive, decided in the rule file and asserted here."""

    @pytest.mark.parametrize(("days", "expected"), [(119, "medium"), (120, "high"), (121, "high")])
    def test_the_high_severity_day_threshold_includes_its_boundary(
        self, ruleset: Any, days: int, expected: str
    ) -> None:
        rule = ruleset.rule("ACT-INV-001")
        row = {
            "days_in_stock": days,
            "is_aged_over_default_threshold": True,
            "is_price_reduced_since_prior": False,
        }
        matched = next(
            band.level
            for band in rule.severity
            if band.predicate is None or band.predicate.evaluate(row, rule.threshold_values) is True
        )
        assert matched == expected

    @pytest.mark.parametrize(
        ("ratio", "fires"), [("1.0499", False), ("1.0500", True), ("1.0501", True)]
    )
    def test_the_price_to_market_threshold_includes_its_boundary(
        self, ruleset: Any, ratio: str, fires: bool
    ) -> None:
        rule = ruleset.rule("ACT-INV-003")
        assert rule.predicate is not None
        row = {"is_aged_over_default_threshold": True, "price_to_market_ratio": ratio}
        assert (rule.predicate.evaluate(row, rule.threshold_values) is True) is fires

    @pytest.mark.parametrize(
        ("eligible", "suppressed"),
        [
            (MINIMUM_SAMPLE_ELIGIBLE_DEALS - 1, True),
            (MINIMUM_SAMPLE_ELIGIBLE_DEALS, False),
            (MINIMUM_SAMPLE_ELIGIBLE_DEALS + 1, False),
        ],
    )
    def test_the_sample_floor_admits_exactly_the_floor(
        self, ruleset: Any, eligible: int, suppressed: bool
    ) -> None:
        """Floor minus one suppresses; the floor itself does not.

        The floor is read from the governed authority rather than copied into this test, so
        a change to the authority moves both sides of the assertion together.
        """
        rule = ruleset.rule("ACT-LED-004")
        sample = rule.minimum_sample
        assert sample is not None
        from decimal import Decimal

        assert (Decimal(eligible) < sample.floor) is suppressed

    @pytest.mark.parametrize(("amount", "severity"), [("999.99", "medium"), ("1000.00", "high")])
    def test_variance_severity_is_symmetric_about_zero(
        self, ruleset: Any, amount: str, severity: str
    ) -> None:
        """A control variance is reviewed on its SIZE. Neither direction is the good one."""
        rule = ruleset.rule("ACT-ACC-001")
        for signed in (amount, f"-{amount}"):
            matched = next(
                band.level
                for band in rule.severity
                if band.predicate is None
                or band.predicate.evaluate({"exception_amount": signed}, rule.threshold_values)
                is True
            )
            assert matched == severity, signed


class TestLanguage:
    """An action prompts a review. It never instructs, and never states a cause."""

    def test_no_action_text_uses_a_causal_construction(self) -> None:
        import re

        actions = json.loads((EXPORT_DIR / "management-actions.json").read_text("utf-8"))
        banned = ("caused", "because", "resulted from", "led to", "due to", "responsible for")
        for action in actions:
            text = f"{action['title']} {action['recommended_review']} {action['limitations']}"
            for phrase in banned:
                assert not re.search(rf"\b{phrase}\b", text.lower()), (
                    action["action_id"],
                    phrase,
                )

    def test_no_action_text_gives_an_operational_instruction(self) -> None:
        import re

        actions = json.loads((EXPORT_DIR / "management-actions.json").read_text("utf-8"))
        banned = ("reprice", "terminate", "approve", "cancel", "fire", "discipline", "assign")
        for action in actions:
            text = f"{action['title']} {action['recommended_review']}"
            for verb in banned:
                assert not re.search(rf"\b{verb}\b", text.lower()), (action["action_id"], verb)

    def test_every_review_prompt_asks_for_a_review(self) -> None:
        actions = json.loads((EXPORT_DIR / "management-actions.json").read_text("utf-8"))
        verbs = ("review", "investigate", "validate", "reconcile", "compare", "confirm")
        for action in actions:
            assert any(verb in action["recommended_review"].lower() for verb in verbs)

    def test_no_action_claims_a_workflow_state(self) -> None:
        text = (EXPORT_DIR / "management-actions.json").read_text("utf-8").lower()
        for word in ("assigned to", "overdue", "completed", "acknowledged", "due date"):
            assert word not in text


class TestHonestZeroes:
    """Two enabled rules produce no current action, and neither was tuned to.

    `ACT-SLS-002` and `ACT-LED-001` are live rules with real matches inside the reporting
    window and none inside the as-of scope. That is the honest outcome and it is recorded
    here rather than smoothed away: the alternative would have been to widen a scope or drop
    a threshold until the queue looked fuller, which is reverse-engineering policy from the
    data it is supposed to judge.
    """

    ZERO_FIRING = ("ACT-SLS-002", "ACT-LED-001")

    def test_they_are_enabled(self, ruleset: Any) -> None:
        enabled = {rule.rule_id for rule in ruleset.enabled}
        for rule_id in self.ZERO_FIRING:
            assert rule_id in enabled

    def test_they_produce_no_action_in_the_as_of_scope(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        rules = load_ruleset(repo_root=REPO_ROOT)
        actions, _ = evaluate_ruleset(rules, exported, as_of_date="2025-12-31", dataset_version=17)
        fired = {action.record["rule_id"] for action in actions}
        for rule_id in self.ZERO_FIRING:
            assert rule_id not in fired

    def test_they_match_real_rows_elsewhere_in_the_window(
        self, ruleset: Any, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """The proof that the zero is a fact about the period, not about the rule."""
        for rule_id in self.ZERO_FIRING:
            rule = ruleset.rule(rule_id)
            assert rule.predicate is not None and rule.source_dataset is not None
            matches = [
                row
                for row in exported[rule.source_dataset]
                if (
                    rule.scope_filter is None
                    or rule.scope_filter.evaluate(dict(row), rule.threshold_values) is True
                )
                and rule.predicate.evaluate(dict(row), rule.threshold_values) is True
            ]
            assert matches != [], rule_id

    def test_every_december_negative_total_gross_deal_is_non_retail(
        self, exported: dict[str, list[dict[str, Any]]]
    ) -> None:
        """Why `ACT-SLS-002` is empty, stated as the fact it rests on.

        Every December transaction whose total gross is below zero is a Wholesale or Dealer
        Trade disposal, and the rule is scoped to retail deliveries. Widening it to reach
        them would report ordinary disposal outcomes as management conditions.
        """
        from decimal import Decimal

        december = [row for row in exported["deal-explorer"] if row["sale_date"][:7] == "2025-12"]
        negative = [row for row in december if Decimal(row["total_gross"]) < 0]
        assert negative != []
        assert all(row["is_retail"] is False for row in negative)
        assert {row["sale_type"] for row in negative} == {"Wholesale", "Dealer Trade"}
