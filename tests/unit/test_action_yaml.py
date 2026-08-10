"""The two rule-file readers, and the proof that they agree.

`DASH.12` put a YAML file on the path of `ci.yml`'s ``repository-checks`` job, which runs on
a bare interpreter that installs nothing. PyYAML is used wherever it exists and
:mod:`arpi.dashboard.action_yaml` reads the same document where it does not — which is a
second parser, and a second parser is a second thing that can be wrong.

So it is held to the same discipline ``config/reference/`` already uses for exactly this
situation: parse the committed file with both, and require an identical structure. The
equality test below is the one that matters; the rest fix the reader's edges in place, so a
future rule file cannot quietly rely on a construct only one of the two understands.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from arpi.dashboard.action_rules import load_ruleset
from arpi.dashboard.action_yaml import ActionYamlError, parse_document

REPO_ROOT = Path(__file__).resolve().parents[2]
RULE_FILE = REPO_ROOT / "config" / "dashboard" / "action_rules.yaml"


class TestTheTwoReadersAgree:
    """The claim the fallback rests on."""

    def test_both_readers_produce_the_same_document(self) -> None:
        text = RULE_FILE.read_text("utf-8")
        assert parse_document(text) == yaml.safe_load(text)

    def test_the_fallback_reader_produces_a_loadable_ruleset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole file survives the round trip, not just the parse.

        Hiding PyYAML forces `load_ruleset` down the fallback path, and every schema,
        vocabulary, threshold, predicate and route check then runs against what the stdlib
        reader produced. A subtle difference — a folded scalar joined wrongly, a boolean read
        as a string — surfaces here as a rule failure rather than as a silent divergence.
        """
        import builtins

        real_import = builtins.__import__

        def refuse_yaml(name: str, *args: Any, **kwargs: Any) -> Any:
            if name == "yaml":
                raise ModuleNotFoundError("No module named 'yaml'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", refuse_yaml)
        fallback = load_ruleset(repo_root=REPO_ROOT)

        monkeypatch.undo()
        with_pyyaml = load_ruleset(repo_root=REPO_ROOT)

        assert fallback.file_sha256 == with_pyyaml.file_sha256
        assert [rule.rule_id for rule in fallback.rules] == [
            rule.rule_id for rule in with_pyyaml.rules
        ]
        assert [rule.enabled for rule in fallback.rules] == [
            rule.enabled for rule in with_pyyaml.rules
        ]
        for left, right in zip(fallback.rules, with_pyyaml.rules, strict=True):
            assert left.title == right.title
            assert left.evidence == right.evidence
            assert left.recommended_review == right.recommended_review
            assert left.threshold_values == right.threshold_values
            assert (left.predicate is None) == (right.predicate is None)
            if left.predicate is not None and right.predicate is not None:
                assert left.predicate.source == right.predicate.source
        assert fallback.change_drivers == with_pyyaml.change_drivers


class TestTheSubsetItSupports:
    """Each construct the rule file actually uses."""

    def test_a_block_mapping(self) -> None:
        assert parse_document("a: 1\nb: two\n") == {"a": 1, "b": "two"}

    def test_a_nested_mapping(self) -> None:
        assert parse_document("outer:\n  inner: 1\n") == {"outer": {"inner": 1}}

    def test_a_block_sequence_of_scalars(self) -> None:
        assert parse_document("items:\n  - one\n  - two\n") == {"items": ["one", "two"]}

    def test_a_block_sequence_of_mappings(self) -> None:
        document = "rules:\n  - id: A\n    on: true\n  - id: B\n    on: false\n"
        assert parse_document(document) == {
            "rules": [{"id": "A", "on": True}, {"id": "B", "on": False}]
        }

    def test_a_flow_sequence(self) -> None:
        assert parse_document("keys: [a, b]\n") == {"keys": ["a", "b"]}

    def test_an_empty_flow_sequence(self) -> None:
        assert parse_document("keys: []\n") == {"keys": []}

    def test_a_folded_scalar_joins_with_single_spaces(self) -> None:
        """`>` clips to one trailing newline, exactly as PyYAML does."""
        document = "note: >\n  first line\n  second line\nnext: 1\n"
        assert parse_document(document) == {"note": "first line second line\n", "next": 1}
        assert parse_document(document) == yaml.safe_load(document)

    def test_a_folded_scalar_can_strip_its_newline(self) -> None:
        document = "note: >-\n  first line\n  second line\n"
        assert parse_document(document) == {"note": "first line second line"}
        assert parse_document(document) == yaml.safe_load(document)

    def test_quoted_scalars(self) -> None:
        assert parse_document("a: \"1.05\"\nb: 'x'\n") == {"a": "1.05", "b": "x"}

    def test_a_negative_integer(self) -> None:
        assert parse_document("a: -1500\n") == {"a": -1500}

    def test_comments_and_blank_lines(self) -> None:
        document = "# leading\n\na: 1  # trailing\n\n# another\nb: 2\n"
        assert parse_document(document) == {"a": 1, "b": 2}

    def test_a_hash_inside_a_quoted_scalar_is_not_a_comment(self) -> None:
        assert parse_document('a: "x # y"\n') == {"a": "x # y"}

    def test_the_empty_flow_mapping(self) -> None:
        """`params: {}` is how a drill-through says it carries no query parameters."""
        assert parse_document("params: {}\n") == {"params": {}}

    def test_an_empty_document(self) -> None:
        assert parse_document("# only a comment\n") is None


class TestWhatItRefuses:
    """Strict, not lenient: an unsupported construct raises rather than being guessed at."""

    @pytest.mark.parametrize(
        ("document", "what"),
        [
            ("a: &anchor 1\n", "anchor"),
            ("a: *alias\n", "alias"),
            ("a: !!str 1\n", "tag"),
            ("a: {b: 1}\n", "flow mapping"),
            ("a: |\n  literal\n", "literal block scalar"),
            ("---\na: 1\n", "document marker"),
            ("a:\tb\n", "tab"),
            ("a: [[1]]\n", "nested flow"),
            ("a: [1\n", "unterminated"),
        ],
    )
    def test_an_unsupported_construct_raises(self, document: str, what: str) -> None:
        with pytest.raises(ActionYamlError):
            parse_document(document)

    def test_a_repeated_key_raises(self) -> None:
        """PyYAML would silently keep the last value. This reader refuses the document."""
        with pytest.raises(ActionYamlError, match="repeats the key"):
            parse_document("a: 1\na: 2\n")

    def test_inconsistent_indentation_raises(self) -> None:
        with pytest.raises(ActionYamlError):
            parse_document("a: 1\n   b: 2\n")

    def test_a_line_that_is_not_a_mapping_entry_raises(self) -> None:
        with pytest.raises(ActionYamlError, match="not a mapping entry"):
            parse_document("a: 1\nnot a key\n")
