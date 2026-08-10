"""The predicate grammar: what it accepts, what it refuses, and what it cannot be made to do.

The security argument for this module is negative — "there is no interpreter to reach" — and
a negative claim is worth exactly as much as the attempts made to falsify it. So the hostile
cases below are not decoration. Each one is an expression that WOULD do something under
``eval``, and each is required to fail before any row is read.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal

import pytest

from arpi.dashboard.action_predicate import ExpressionError, compile_predicate

#: A column contract standing in for one exported dataset.
COLUMNS: dict[str, str] = {
    "days_in_stock": "integer",
    "current_asking_price": "currency",
    "price_to_market_ratio": "exact",
    "median_response_minutes": "double",
    "condition_group": "string",
    "is_aged": "boolean",
    "is_price_reduced_since_prior": "boolean",
    "snapshot_date": "date",
}

THRESHOLDS: dict[str, str] = {"aged_days": "number", "ratio": "number"}
VALUES: dict[str, Decimal] = {"aged_days": Decimal(60), "ratio": Decimal("1.05")}


def evaluate(source: str, row: Mapping[str, object]) -> bool | None:
    """Compile and evaluate in one step, for readability in the cases below."""
    predicate = compile_predicate(source, columns=COLUMNS, thresholds=THRESHOLDS)  # type: ignore[arg-type]
    return predicate.evaluate(dict(row), VALUES)  # type: ignore[arg-type]


class TestHostileExpressions:
    """Every one of these is a payload that would execute under ``eval``."""

    @pytest.mark.parametrize(
        "source",
        [
            '__import__("os")',
            '__import__("os").system("id")',
            "open('/etc/passwd')",
            "eval('1+1')",
            "exec('x=1')",
            "lambda x: x",
            "days_in_stock.__class__",
            "days_in_stock.real",
            "().__class__.__bases__",
            "globals()",
            "days_in_stock[0]",
            "{'a': 1}",
            "[1, 2, 3]",
            "days_in_stock; open('x')",
            "days_in_stock + 1",
            "days_in_stock ** 2",
            "days_in_stock % 2",
            "1 if days_in_stock else 2",
            "days_in_stock | 1",
            "os.system('id')",
            "import os",
            "SELECT * FROM warehouse.fact_sale",
            "days_in_stock >= 60; DROP TABLE stores",
            "() => true",
            "function(){return 1}",
            "`${days_in_stock}`",
            "days_in_stock\\n and true",
        ],
    )
    def test_a_hostile_expression_never_compiles(self, source: str) -> None:
        with pytest.raises(ExpressionError):
            compile_predicate(source, columns=COLUMNS, thresholds=THRESHOLDS)  # type: ignore[arg-type]

    def test_a_dunder_is_refused_at_the_token_stage(self) -> None:
        """The identifier SHAPE is refused, one stage before the vocabulary check.

        ``__import__`` names no exported column, so it would fail validation anyway. It
        fails to tokenize instead, which means a dunder cannot become a token at all.
        """
        with pytest.raises(ExpressionError, match="unexpected character"):
            compile_predicate("__import__ == 1", columns=COLUMNS)

    def test_a_function_call_on_a_known_column_still_fails(self) -> None:
        """Call syntax has no production, so it is refused whatever it is applied to.

        The two spellings below fail at different gates, which is the point of asserting
        both. `days_in_stock(60)` never reaches the parenthesis: a non-boolean column
        standing alone is already not a condition. `is_aged(60)` parses as a complete
        boolean condition and then finds a token left over. Neither is a call, because the
        grammar has no production that would make one.
        """
        with pytest.raises(ExpressionError, match="is not boolean"):
            compile_predicate("days_in_stock(60)", columns=COLUMNS)
        with pytest.raises(ExpressionError, match="unexpected"):
            compile_predicate("is_aged(60)", columns=COLUMNS)


class TestVocabulary:
    """A predicate may name exported columns and declared thresholds. Nothing else."""

    def test_an_unknown_column_is_refused(self) -> None:
        with pytest.raises(ExpressionError, match="not an exported column"):
            compile_predicate("mystery_column >= 1", columns=COLUMNS)

    def test_an_unknown_threshold_is_refused(self) -> None:
        with pytest.raises(ExpressionError, match="not a threshold this rule declares"):
            compile_predicate("days_in_stock >= @nonsense", columns=COLUMNS, thresholds=THRESHOLDS)  # type: ignore[arg-type]

    def test_a_threshold_is_refused_when_the_rule_declares_none(self) -> None:
        with pytest.raises(ExpressionError, match="not a threshold"):
            compile_predicate("days_in_stock >= @aged_days", columns=COLUMNS)

    def test_the_compiled_predicate_reports_what_it_reads(self) -> None:
        predicate = compile_predicate(
            "days_in_stock >= @aged_days and condition_group == 'Used'",
            columns=COLUMNS,
            thresholds=THRESHOLDS,  # type: ignore[arg-type]
        )
        assert predicate.fields == ("condition_group", "days_in_stock")
        assert predicate.thresholds == ("aged_days",)


class TestStaticTyping:
    """Type errors are caught against the contract, before any row exists."""

    def test_a_string_column_may_not_be_compared_with_a_number(self) -> None:
        with pytest.raises(ExpressionError, match="cannot compare"):
            compile_predicate("condition_group >= 5", columns=COLUMNS)

    def test_a_string_column_may_not_be_ordered(self) -> None:
        with pytest.raises(ExpressionError, match="not defined for string"):
            compile_predicate("condition_group > 'Used'", columns=COLUMNS)

    def test_a_boolean_may_not_be_ordered(self) -> None:
        with pytest.raises(ExpressionError, match="not defined for boolean"):
            compile_predicate("is_aged > false", columns=COLUMNS)

    def test_a_non_boolean_may_not_stand_alone_as_a_condition(self) -> None:
        with pytest.raises(ExpressionError, match="is not boolean"):
            compile_predicate("days_in_stock", columns=COLUMNS)

    def test_a_boolean_column_may_stand_alone(self) -> None:
        assert evaluate("is_aged", {"is_aged": True}) is True

    def test_a_date_orders_chronologically(self) -> None:
        assert evaluate("snapshot_date >= '2025-06-01'", {"snapshot_date": "2025-12-31"}) is True
        assert evaluate("snapshot_date >= '2025-06-01'", {"snapshot_date": "2025-01-01"}) is False


class TestThreeValuedLogic:
    """NULL is UNKNOWN. It never satisfies a comparison through coercion."""

    def test_a_null_operand_makes_a_comparison_unknown(self) -> None:
        assert evaluate("price_to_market_ratio >= @ratio", {"price_to_market_ratio": None}) is None

    def test_a_null_never_compares_as_zero(self) -> None:
        """The mistake this module exists to prevent, stated as a test.

        A unit with no market estimate must not satisfy "ratio below 1" by treating the
        missing estimate as 0.
        """
        assert evaluate("price_to_market_ratio < 1", {"price_to_market_ratio": None}) is None
        assert evaluate("price_to_market_ratio < 1", {"price_to_market_ratio": "0.90"}) is True

    def test_not_of_unknown_is_unknown(self) -> None:
        assert evaluate("not (days_in_stock >= 60)", {"days_in_stock": None}) is None

    @pytest.mark.parametrize(
        ("left", "right", "expected"),
        [
            (True, True, True),
            (True, None, None),
            (None, None, None),
            (False, None, False),
            (True, False, False),
        ],
    )
    def test_conjunction_follows_kleene(
        self, left: bool | None, right: bool | None, expected: bool | None
    ) -> None:
        row = {"is_aged": left, "is_price_reduced_since_prior": right}
        assert evaluate("is_aged and is_price_reduced_since_prior", row) is expected

    @pytest.mark.parametrize(
        ("left", "right", "expected"),
        [
            (False, False, False),
            (True, None, True),
            (None, False, None),
            (None, None, None),
        ],
    )
    def test_disjunction_follows_kleene(
        self, left: bool | None, right: bool | None, expected: bool | None
    ) -> None:
        row = {"is_aged": left, "is_price_reduced_since_prior": right}
        assert evaluate("is_aged or is_price_reduced_since_prior", row) is expected

    def test_is_null_is_the_deliberate_question(self) -> None:
        assert evaluate("price_to_market_ratio is null", {"price_to_market_ratio": None}) is True
        assert evaluate("price_to_market_ratio is null", {"price_to_market_ratio": "1.0"}) is False
        assert (
            evaluate("price_to_market_ratio is not null", {"price_to_market_ratio": None}) is False
        )

    def test_null_is_never_the_literal_word(self) -> None:
        with pytest.raises(ExpressionError, match="not an operand"):
            compile_predicate("price_to_market_ratio == null", columns=COLUMNS)


class TestExactness:
    """Money is compared as Decimal. No float ever touches it."""

    def test_a_currency_string_compares_exactly(self) -> None:
        assert (
            evaluate("current_asking_price > 10072.25", {"current_asking_price": "10072.26"})
            is True
        )
        assert (
            evaluate("current_asking_price > 10072.26", {"current_asking_price": "10072.26"})
            is False
        )

    def test_a_ratio_at_many_places_compares_exactly(self) -> None:
        row = {"price_to_market_ratio": "1.0500"}
        assert evaluate("price_to_market_ratio >= @ratio", row) is True
        assert evaluate("price_to_market_ratio > @ratio", row) is False

    def test_a_value_a_float_would_round_survives(self) -> None:
        """0.1 + 0.2 famously is not 0.3 in binary floating point.

        The comparison below is exact, so a value written 0.30 is equal to 0.3 and not
        0.30000000000000004.
        """
        assert evaluate("price_to_market_ratio == 0.3", {"price_to_market_ratio": "0.30"}) is True


class TestBoundaries:
    """Inclusive and exclusive behaviour, stated rather than assumed."""

    @pytest.mark.parametrize(("days", "expected"), [(59, False), (60, True), (61, True)])
    def test_greater_or_equal_includes_the_boundary(self, days: int, expected: bool) -> None:
        assert evaluate("days_in_stock >= @aged_days", {"days_in_stock": days}) is expected

    @pytest.mark.parametrize(("days", "expected"), [(59, False), (60, False), (61, True)])
    def test_strictly_greater_excludes_the_boundary(self, days: int, expected: bool) -> None:
        assert evaluate("days_in_stock > @aged_days", {"days_in_stock": days}) is expected


class TestUnaryNegation:
    """`-@name` exists so a symmetric band needs one threshold, not two."""

    def test_a_negated_threshold_reads_the_same_value(self) -> None:
        source = "current_asking_price >= @aged_days or current_asking_price <= -@aged_days"
        assert evaluate(source, {"current_asking_price": "70.00"}) is True
        assert evaluate(source, {"current_asking_price": "-70.00"}) is True
        assert evaluate(source, {"current_asking_price": "10.00"}) is False

    def test_a_negated_threshold_is_still_a_threshold_reference(self) -> None:
        predicate = compile_predicate(
            "current_asking_price <= -@aged_days",
            columns=COLUMNS,
            thresholds=THRESHOLDS,  # type: ignore[arg-type]
        )
        assert predicate.thresholds == ("aged_days",)

    def test_unary_minus_applies_only_to_a_threshold(self) -> None:
        with pytest.raises(ExpressionError):
            compile_predicate("current_asking_price <= -days_in_stock", columns=COLUMNS)


class TestSyntax:
    """Malformed expressions fail to parse rather than parsing into something else."""

    @pytest.mark.parametrize(
        "source",
        [
            "",
            "   ",
            "days_in_stock >=",
            ">= 60",
            "(days_in_stock >= 60",
            "days_in_stock >= 60)",
            "days_in_stock >= 60 days_in_stock >= 70",
            "days_in_stock is",
            "days_in_stock is not",
            "days_in_stock and",
            "@aged_days",
        ],
    )
    def test_malformed_input_is_refused(self, source: str) -> None:
        with pytest.raises(ExpressionError):
            compile_predicate(source, columns=COLUMNS, thresholds=THRESHOLDS)  # type: ignore[arg-type]

    def test_parentheses_group_as_written(self) -> None:
        row = {"is_aged": False, "is_price_reduced_since_prior": True, "days_in_stock": 10}
        assert (
            evaluate("is_aged or (is_price_reduced_since_prior and days_in_stock < 20)", row)
            is True
        )
        assert (
            evaluate("(is_aged or is_price_reduced_since_prior) and days_in_stock > 20", row)
            is False
        )

    def test_a_missing_column_on_the_row_raises(self) -> None:
        """A row that does not carry a column the predicate names is a contract breach.

        It cannot happen through the export, and it must not pass silently if it ever does:
        an action whose condition could not actually be evaluated is worse than no action.
        """
        with pytest.raises(ExpressionError, match="missing column"):
            evaluate("days_in_stock >= 60", {})
