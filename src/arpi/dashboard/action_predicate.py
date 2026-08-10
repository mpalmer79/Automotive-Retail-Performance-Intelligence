"""A deliberately small expression language for management-action rule predicates.

WHY THIS EXISTS RATHER THAN ``eval``
------------------------------------
``config/dashboard/action_rules.yaml`` carries strings like
``days_in_stock >= @high_severity_days``. The obvious way to evaluate one is to hand it to
Python. That would make the rule file executable code: a configuration file whose contents
run with the exporter's privileges, in a repository whose whole argument is that the
published figures can be recomputed by hand from governed inputs. ``eval``, ``exec``,
``ast.literal_eval`` used as a pretend expression engine, and any dynamic import are
therefore absent by construction, not by convention.

What is here instead is a tokenizer, a recursive-descent parser and a three-valued
evaluator over a grammar with no function calls, no attribute access, no indexing and no
name resolution beyond two closed vocabularies: the exported columns of one dataset, and
the thresholds one rule declares. An expression naming anything else fails to VALIDATE --
before any row is read -- and a malformed expression fails to PARSE. Neither failure mode
can reach an interpreter, because there is no interpreter to reach.

THREE-VALUED LOGIC, AND WHY IT IS NOT AN AFFECTATION
----------------------------------------------------
The warehouse distinguishes "zero" from "not observed" everywhere, and the rule layer would
throw that distinction away if it coerced. A unit with no market estimate must not satisfy
``price_to_market_ratio >= 1.05`` by treating the missing estimate as 0, and a lead that
never received a response must not satisfy ``average_response_minutes > 30`` by treating
"never" as either a large number or a small one. So a comparison with a NULL operand
evaluates to UNKNOWN, ``and``/``or``/``not`` follow Kleene's tables, and a rule fires only
on TRUE. UNKNOWN suppresses, and ``is null`` / ``is not null`` are the only ways to ask the
question deliberately.

EXACTNESS
---------
Currency and exact-decimal columns cross the export boundary as strings precisely so that
no float ever touches them. This module keeps that promise: every numeric comparison is
performed on :class:`~decimal.Decimal`, and a numeric literal in the rule file is parsed
from its source text rather than through :class:`float`.

Pure: no I/O, no database, no clock, no randomness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final, Literal

from arpi.exceptions import ArpiError

__all__ = [
    "ExpressionError",
    "Predicate",
    "PredicateValue",
    "ValueKind",
    "compile_predicate",
    "evaluate",
]


class ExpressionError(ArpiError):
    """A predicate could not be tokenized, parsed, or validated.

    Raised for every rejection this module performs, so a caller never has to distinguish
    "this is not valid syntax" from "this names a column that does not exist" in order to
    refuse the rule file.
    """


#: The value kinds the grammar distinguishes.
#:
#: Deliberately coarser than the export's column types: the grammar cares whether two
#: operands can be compared and with which operators, not whether a number arrived as an
#: integer or as an exact decimal string.
ValueKind = Literal["number", "string", "boolean", "date"]

#: A value a predicate can read from a row or a threshold.
PredicateValue = str | int | float | bool | Decimal | None

#: How an export column type maps onto a grammar value kind.
_COLUMN_KINDS: Final[dict[str, ValueKind]] = {
    "integer": "number",
    "currency": "number",
    "exact": "number",
    "double": "number",
    "string": "string",
    "boolean": "boolean",
    "date": "date",
}

#: Comparison operators the grammar accepts, longest first so ``>=`` wins over ``>``.
_COMPARISON_OPERATORS: Final[tuple[str, ...]] = ("==", "!=", "<=", ">=", "<", ">")

#: Operators permitted for each value kind.
#:
#: Ordering a string is meaningless here and ordering a boolean is a category error, so
#: both are restricted to equality. Dates order because they are ISO-8601 and lexical
#: order is chronological order.
_ALLOWED_OPERATORS: Final[dict[ValueKind, frozenset[str]]] = {
    "number": frozenset(_COMPARISON_OPERATORS),
    "date": frozenset(_COMPARISON_OPERATORS),
    "string": frozenset({"==", "!="}),
    "boolean": frozenset({"==", "!="}),
}

#: Words the grammar reserves. Everything else that looks like a name must be a column.
_KEYWORDS: Final[frozenset[str]] = frozenset({"and", "or", "not", "is", "null", "true", "false"})

#: A bare column name. Lower snake case, and never leading-underscore.
#:
#: The leading-underscore refusal is defence in depth: ``__import__`` would fail validation
#: anyway for naming no exported column, but refusing the SHAPE means a dunder cannot even
#: become a token, and the rejection happens one stage earlier than the vocabulary check.
_IDENTIFIER: Final[re.Pattern[str]] = re.compile(r"[a-z][a-z0-9_]*")

#: A numeric literal. No exponent, no underscore separators, no leading ``+``.
_NUMBER: Final[re.Pattern[str]] = re.compile(r"-?\d+(?:\.\d+)?")

#: An ISO-8601 calendar date, which the grammar treats as a date rather than a string.
_ISO_DATE: Final[re.Pattern[str]] = re.compile(r"\d{4}-\d{2}-\d{2}\Z")


# ---------------------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Token:
    """One lexical token.

    Attributes:
        kind: The token category the parser switches on.
        text: The exact source text, used for error messages and literal parsing.
        position: Zero-based offset into the source, so an error can point at it.
    """

    kind: str
    text: str
    position: int


def _tokenize(source: str) -> list[_Token]:
    """Split a predicate into tokens.

    Args:
        source: The predicate text.

    Returns:
        The tokens, without whitespace.

    Raises:
        ExpressionError: On any character the grammar does not define. This is the first
            gate a hostile expression meets: ``.``, ``[``, ``{``, backslash, ``;``, ``%``,
            ``|`` and every other punctuation mark that would begin an attribute access,
            a subscript, a lambda, a format string or a statement separator is simply not
            a token.
    """
    tokens: list[_Token] = []
    index = 0
    length = len(source)
    while index < length:
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char in "()":
            tokens.append(_Token("paren", char, index))
            index += 1
            continue
        operator = next((op for op in _COMPARISON_OPERATORS if source.startswith(op, index)), None)
        if operator is not None:
            tokens.append(_Token("operator", operator, index))
            index += len(operator)
            continue
        if char == "-" and source.startswith("-@", index):
            tokens.append(_Token("minus", "-", index))
            index += 1
            continue
        if char == "@":
            match = _IDENTIFIER.match(source, index + 1)
            if match is None:
                raise ExpressionError(
                    f"expected a threshold name after '@' at position {index} in {source!r}"
                )
            tokens.append(_Token("threshold", match.group(), index))
            index = match.end()
            continue
        if char in "'\"":
            end = source.find(char, index + 1)
            if end == -1:
                raise ExpressionError(f"unterminated string at position {index} in {source!r}")
            tokens.append(_Token("string", source[index + 1 : end], index))
            index = end + 1
            continue
        if char.isdigit() or (char == "-" and _NUMBER.match(source, index)):
            match = _NUMBER.match(source, index)
            if match is None:  # pragma: no cover - guarded by the condition above
                raise ExpressionError(f"malformed number at position {index} in {source!r}")
            tokens.append(_Token("number", match.group(), index))
            index = match.end()
            continue
        match = _IDENTIFIER.match(source, index)
        if match is None:
            raise ExpressionError(
                f"unexpected character {char!r} at position {index} in {source!r}; the "
                "predicate grammar defines no such token"
            )
        word = match.group()
        tokens.append(_Token("keyword" if word in _KEYWORDS else "name", word, index))
        index = match.end()
    return tokens


# ---------------------------------------------------------------------------------------
# Syntax tree
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Literal:
    """A constant written in the rule file."""

    value: PredicateValue
    kind: ValueKind


@dataclass(frozen=True, slots=True)
class _Field:
    """A reference to an exported column of the rule's source dataset."""

    name: str
    kind: ValueKind


@dataclass(frozen=True, slots=True)
class _Threshold:
    """A reference to a threshold the rule declares."""

    name: str
    kind: ValueKind


@dataclass(frozen=True, slots=True)
class _Negated:
    """The arithmetic negation of a numeric operand.

    Written ``-@name``, and permitted only on a threshold. It exists so a severity band
    that is symmetric about zero -- a control variance is reviewed on the SIZE of the
    disagreement, whichever side carries more -- can be expressed against ONE declared
    threshold instead of a positive threshold and a hand-kept negative twin.
    """

    inner: _Threshold
    kind: ValueKind


@dataclass(frozen=True, slots=True)
class _Comparison:
    """A binary comparison between two operands of the same kind."""

    operator: str
    left: _Operand
    right: _Operand


@dataclass(frozen=True, slots=True)
class _NullTest:
    """An explicit ``is null`` / ``is not null`` question."""

    operand: _Operand
    negated: bool


@dataclass(frozen=True, slots=True)
class _BooleanOperand:
    """A boolean-valued operand standing alone as a condition."""

    operand: _Operand


@dataclass(frozen=True, slots=True)
class _Not:
    """Kleene negation."""

    operand: _Node


@dataclass(frozen=True, slots=True)
class _And:
    """Kleene conjunction."""

    left: _Node
    right: _Node


@dataclass(frozen=True, slots=True)
class _Or:
    """Kleene disjunction."""

    left: _Node
    right: _Node


_Operand = _Literal | _Field | _Threshold | _Negated
_Node = _Comparison | _NullTest | _BooleanOperand | _Not | _And | _Or


@dataclass(frozen=True, slots=True)
class Predicate:
    """A validated predicate, ready to be evaluated against rows.

    Attributes:
        source: The original text, carried so the rule file's own words can be shown in
            documentation and in the console's threshold disclosure.
        fields: Every exported column the predicate reads, sorted. Used to prove that a
            rule's evidence covers what its condition actually looked at.
        thresholds: Every threshold name the predicate reads, sorted.
    """

    source: str
    fields: tuple[str, ...]
    thresholds: tuple[str, ...]
    _root: _Node

    def evaluate(
        self, row: dict[str, PredicateValue], thresholds: dict[str, Decimal]
    ) -> bool | None:
        """Evaluate against one row.

        Args:
            row: The exported record, column name to value.
            thresholds: The rule's resolved threshold values.

        Returns:
            ``True``, ``False``, or ``None`` for UNKNOWN.
        """
        return _evaluate_node(self._root, row, thresholds)


# ---------------------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------------------


class _Parser:
    """Recursive-descent parser for the predicate grammar.

    The grammar, in full::

        expression  := disjunction
        disjunction := conjunction ( "or" conjunction )*
        conjunction := negation ( "and" negation )*
        negation    := "not" negation | condition
        condition   := "(" expression ")"
                     | operand ( comparison operand | "is" [ "not" ] "null" )?
        operand     := name | "@" name | number | string | "true" | "false" | "null"

    There is no production for a call, a subscript, an attribute, an assignment or a
    lambda, which is the entire security argument.
    """

    def __init__(
        self,
        source: str,
        tokens: list[_Token],
        columns: dict[str, str],
        threshold_kinds: dict[str, ValueKind],
    ) -> None:
        """Initialise the parser.

        Args:
            source: The predicate text, for error messages.
            tokens: The token stream.
            columns: Exported column name to export column type, for the rule's dataset.
            threshold_kinds: Declared threshold name to value kind.
        """
        self._source = source
        self._tokens = tokens
        self._columns = columns
        self._thresholds = threshold_kinds
        self._index = 0
        self.fields: set[str] = set()
        self.used_thresholds: set[str] = set()

    def _peek(self) -> _Token | None:
        return self._tokens[self._index] if self._index < len(self._tokens) else None

    def _take(self) -> _Token:
        token = self._peek()
        if token is None:
            raise ExpressionError(f"unexpected end of predicate in {self._source!r}")
        self._index += 1
        return token

    def _accept(self, kind: str, text: str) -> bool:
        token = self._peek()
        if token is not None and token.kind == kind and token.text == text:
            self._index += 1
            return True
        return False

    def parse(self) -> _Node:
        """Parse the whole token stream.

        Returns:
            The root node.

        Raises:
            ExpressionError: If tokens remain after a complete expression, which is what
                catches ``a == 1 b == 2`` and other silently-truncated conditions.
        """
        node = self._disjunction()
        remaining = self._peek()
        if remaining is not None:
            raise ExpressionError(
                f"unexpected {remaining.text!r} at position {remaining.position} "
                f"in {self._source!r}"
            )
        return node

    def _disjunction(self) -> _Node:
        node = self._conjunction()
        while self._accept("keyword", "or"):
            node = _Or(node, self._conjunction())
        return node

    def _conjunction(self) -> _Node:
        node = self._negation()
        while self._accept("keyword", "and"):
            node = _And(node, self._negation())
        return node

    def _negation(self) -> _Node:
        if self._accept("keyword", "not"):
            return _Not(self._negation())
        return self._condition()

    def _condition(self) -> _Node:
        if self._accept("paren", "("):
            node = self._disjunction()
            if not self._accept("paren", ")"):
                raise ExpressionError(f"expected ')' in {self._source!r}")
            return node
        left = self._operand()
        token = self._peek()
        if token is not None and token.kind == "operator":
            self._index += 1
            right = self._operand()
            self._check_comparison(token.text, left, right)
            return _Comparison(token.text, left, right)
        if self._accept("keyword", "is"):
            negated = self._accept("keyword", "not")
            if not self._accept("keyword", "null"):
                raise ExpressionError(f"expected 'null' after 'is' in {self._source!r}")
            return _NullTest(left, negated)
        if _kind_of(left) != "boolean":
            raise ExpressionError(
                f"{_describe(left)} is not boolean and stands alone as a condition in "
                f"{self._source!r}; compare it or test it for null"
            )
        return _BooleanOperand(left)

    def _operand(self) -> _Operand:
        token = self._take()
        if token.kind == "minus":
            inner = self._operand()
            if not isinstance(inner, _Threshold):
                raise ExpressionError(
                    f"unary '-' applies only to a threshold in {self._source!r}; write a "
                    "negative literal directly"
                )
            return _Negated(inner, "number")
        if token.kind == "name":
            column_type = self._columns.get(token.text)
            if column_type is None:
                raise ExpressionError(
                    f"{token.text!r} in {self._source!r} is not an exported column of this "
                    "rule's source dataset"
                )
            column_kind = _COLUMN_KINDS.get(column_type)
            if column_kind is None:
                raise ExpressionError(
                    f"column {token.text!r} has type {column_type!r}, which the predicate "
                    "grammar cannot compare"
                )
            self.fields.add(token.text)
            return _Field(token.text, column_kind)
        if token.kind == "threshold":
            if token.text not in self._thresholds:
                raise ExpressionError(
                    f"@{token.text} in {self._source!r} is not a threshold this rule declares"
                )
            self.used_thresholds.add(token.text)
            return _Threshold(token.text, self._thresholds[token.text])
        if token.kind == "number":
            return _Literal(Decimal(token.text), "number")
        if token.kind == "string":
            literal_kind: ValueKind = "date" if _ISO_DATE.match(token.text) else "string"
            return _Literal(token.text, literal_kind)
        if token.kind == "keyword" and token.text in {"true", "false"}:
            return _Literal(token.text == "true", "boolean")
        if token.kind == "keyword" and token.text == "null":
            raise ExpressionError(
                f"'null' is not an operand in {self._source!r}; use 'is null' or 'is not null'"
            )
        raise ExpressionError(
            f"unexpected {token.text!r} at position {token.position} in {self._source!r}"
        )

    def _check_comparison(self, operator: str, left: _Operand, right: _Operand) -> None:
        left_kind = _kind_of(left)
        right_kind = _kind_of(right)
        if left_kind != right_kind:
            raise ExpressionError(
                f"cannot compare {_describe(left)} ({left_kind}) with {_describe(right)} "
                f"({right_kind}) in {self._source!r}"
            )
        if operator not in _ALLOWED_OPERATORS[left_kind]:
            raise ExpressionError(
                f"operator {operator!r} is not defined for {left_kind} operands in {self._source!r}"
            )


def _kind_of(operand: _Operand) -> ValueKind:
    """Return an operand's value kind."""
    return operand.kind


def _describe(operand: _Operand) -> str:
    """Return a human phrase naming an operand, for an error message."""
    if isinstance(operand, _Field):
        return f"column {operand.name!r}"
    if isinstance(operand, _Threshold):
        return f"threshold '@{operand.name}'"
    if isinstance(operand, _Negated):
        return f"negated threshold '-@{operand.inner.name}'"
    return f"literal {operand.value!r}"


def compile_predicate(
    source: str,
    *,
    columns: dict[str, str],
    thresholds: dict[str, ValueKind] | None = None,
) -> Predicate:
    """Tokenize, parse and validate a predicate against a dataset's column contract.

    Every rejection this project cares about happens here, at load time, against the
    contract rather than against a row: an unknown column, an unknown threshold, an
    operator that is not defined for the operands' kinds, a comparison between a string
    column and a number, a stray character, an unbalanced parenthesis, a trailing token.
    None of it depends on which rows happen to exist.

    Args:
        source: The predicate text from the rule file.
        columns: Exported column name to export column type for the rule's source dataset.
        thresholds: Declared threshold name to value kind, or ``None`` for a rule that
            declares none.

    Returns:
        The validated predicate.

    Raises:
        ExpressionError: On any failure to tokenize, parse or validate.
    """
    if not source.strip():
        raise ExpressionError("a predicate may not be empty")
    parser = _Parser(source, _tokenize(source), columns, dict(thresholds or {}))
    root = parser.parse()
    return Predicate(
        source=source,
        fields=tuple(sorted(parser.fields)),
        thresholds=tuple(sorted(parser.used_thresholds)),
        _root=root,
    )


# ---------------------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------------------


def _decimal(value: PredicateValue) -> Decimal | None:
    """Convert a numeric row value to an exact Decimal.

    Args:
        value: The row value. Currency and exact columns arrive as strings and are parsed
            from their text; integers convert directly; a float converts through its repr
            so the Decimal is exact for the value present rather than for a re-rounded one.

    Returns:
        The Decimal, or ``None`` if the value is NULL.

    Raises:
        ExpressionError: If the value is not numeric at all, which means the export
            disagreed with the column contract the predicate was validated against.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise ExpressionError(f"expected a number, found the boolean {value!r}")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(repr(value))
    try:
        return Decimal(value)
    except InvalidOperation as error:
        raise ExpressionError(f"expected a number, found {value!r}") from error


def _operand_value(
    operand: _Operand,
    row: dict[str, PredicateValue],
    thresholds: dict[str, Decimal],
) -> PredicateValue:
    """Resolve an operand to a concrete value for one row."""
    if isinstance(operand, _Literal):
        return operand.value
    if isinstance(operand, _Threshold):
        return thresholds[operand.name]
    if isinstance(operand, _Negated):
        return -thresholds[operand.inner.name]
    if operand.name not in row:
        raise ExpressionError(f"row is missing column {operand.name!r}")
    return row[operand.name]


def _compare(operator: str, left: PredicateValue, right: PredicateValue, kind: ValueKind) -> bool:
    """Compare two non-NULL values of one kind."""
    if kind == "number":
        left_number = _decimal(left)
        right_number = _decimal(right)
        assert left_number is not None and right_number is not None
        return _apply(operator, left_number, right_number)
    if kind == "boolean":
        return left == right if operator == "==" else left != right
    return _apply(operator, str(left), str(right))


def _apply(operator: str, left: Decimal | str, right: Decimal | str) -> bool:
    """Apply an ordering operator to two comparable values."""
    if operator == "==":
        return left == right
    if operator == "!=":
        return left != right
    if operator == "<":
        return left < right  # type: ignore[operator]
    if operator == "<=":
        return left <= right  # type: ignore[operator]
    if operator == ">":
        return left > right  # type: ignore[operator]
    return left >= right  # type: ignore[operator]


def _evaluate_leaf(
    node: _Comparison | _NullTest | _BooleanOperand,
    row: dict[str, PredicateValue],
    thresholds: dict[str, Decimal],
) -> bool | None:
    """Evaluate a node that reads values rather than combining other nodes."""
    if isinstance(node, _Comparison):
        left = _operand_value(node.left, row, thresholds)
        right = _operand_value(node.right, row, thresholds)
        if left is None or right is None:
            return None
        return _compare(node.operator, left, right, _kind_of(node.left))
    if isinstance(node, _NullTest):
        value = _operand_value(node.operand, row, thresholds)
        return (value is not None) if node.negated else (value is None)
    standalone = _operand_value(node.operand, row, thresholds)
    return None if standalone is None else bool(standalone)


def _evaluate_node(
    node: _Node,
    row: dict[str, PredicateValue],
    thresholds: dict[str, Decimal],
) -> bool | None:
    """Evaluate one node under Kleene three-valued logic.

    ``None`` is UNKNOWN throughout. A comparison with a NULL operand is UNKNOWN rather than
    false, so ``not (x > 5)`` does not quietly become true for a row whose ``x`` was never
    observed -- which is the mistake this whole module exists to make impossible.

    Both connectives evaluate BOTH sides rather than short-circuiting on the first. That
    costs nothing on expressions this small and buys a real property: a predicate naming a
    column the row does not carry raises wherever it appears, instead of raising only when
    the other side of an ``and`` happened not to be false.

    Args:
        node: The node to evaluate.
        row: The exported record.
        thresholds: The rule's resolved threshold values.

    Returns:
        ``True``, ``False``, or ``None`` for UNKNOWN.
    """
    if isinstance(node, _Comparison | _NullTest | _BooleanOperand):
        return _evaluate_leaf(node, row, thresholds)
    if isinstance(node, _Not):
        inner = _evaluate_node(node.operand, row, thresholds)
        return None if inner is None else not inner
    left_value = _evaluate_node(node.left, row, thresholds)
    right_value = _evaluate_node(node.right, row, thresholds)
    # `and` is decided by a False on either side; `or` is decided by a True. Whatever does
    # not decide the connective leaves UNKNOWN dominant, which is the Kleene table.
    decisive = not isinstance(node, _And)
    if left_value is decisive or right_value is decisive:
        return decisive
    if left_value is None or right_value is None:
        return None
    return not decisive


def evaluate(
    predicate: Predicate,
    row: dict[str, PredicateValue],
    thresholds: dict[str, Decimal],
) -> bool | None:
    """Evaluate a predicate against one row.

    Args:
        predicate: The compiled predicate.
        row: The exported record.
        thresholds: The rule's resolved threshold values.

    Returns:
        ``True``, ``False`` or ``None`` for UNKNOWN. Callers fire only on ``True``.
    """
    return predicate.evaluate(row, thresholds)
