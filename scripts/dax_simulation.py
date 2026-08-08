"""SIMULATED SEMANTIC-MODEL VALIDATION — a DAX-subset evaluator written in Python.

WHAT THIS IS
------------
A **simulation** of the part of a semantic model that turns a measure expression, a set
of tables and a filter context into a number. It parses the committed TMDL, builds a
relationship graph, applies filter context the way a tabular engine would, and evaluates
the subset of DAX the ARPI model actually uses.

WHAT THIS IS NOT
----------------
This is **not** Power BI, **not** Power BI Desktop, **not** Microsoft Fabric, and **not**
Gate 2 evidence. It is a development proxy: a second, independent implementation of the
model's declared semantics, useful for catching a wrong column, a wrong denominator, a
wrong date basis or a lost `USERELATIONSHIP` long before an engine is available to catch
them. A result produced here may never be described as a Power BI, Desktop or Fabric
validation, and passing here closes nothing. See
`docs/architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md`
and `powerbi/model_documentation/10-simulated-semantic-model-validation.md`.

THE SUBSET
----------
Supported: ``SUM``, ``MEDIAN``, ``MAX``, ``COUNTROWS``, ``DIVIDE``, ``CALCULATE`` (with
equality predicates, ``USERELATIONSHIP`` and ``LASTNONBLANK`` as modifiers),
``LASTNONBLANKVALUE``, ``SELECTEDVALUE``, ``IF``, ``ISBLANK``, ``BLANK``, ``TRUE``,
``FALSE``, ``VAR``/``RETURN``, measure references, column references, string and numeric
literals, the four arithmetic operators and the six comparisons.

Anything outside that subset raises `UnsupportedDaxError`, which the harness records as
**not simulated** rather than as a pass. A simulator that silently returns a number for
an expression it did not understand is worse than no simulator.

DELIBERATE SIMPLIFICATIONS, each of which is a reason this cannot stand in for an engine:

* Filter propagation runs one way only, from the one side to the many side, which is
  what the ARPI model declares. Bidirectional and many-to-many behaviour is absent
  because the model has none, not because it is simulated.
* A dimension propagates a filter only when it is itself filtered. There is no blank row
  and no referential-integrity handling, so a fact row whose key matches no dimension row
  behaves differently here than in a real engine.
* Arithmetic uses Python floats and `Decimal`-free comparison with a tolerance. Currency
  rounding, data-type coercion and format strings are not modelled at all.
* Context transition, row context, iterators (``SUMX`` and friends), time intelligence
  and calculation groups are not implemented, because the model uses none of them.
"""

from __future__ import annotations

import importlib.util
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SEMANTIC_MODEL_DIR = (
    REPO_ROOT
    / "powerbi"
    / "ARPI_Performance_Intelligence"
    / "ARPI_Performance_Intelligence.SemanticModel"
    / "definition"
)


class UnsupportedDaxError(Exception):
    """Raised when an expression uses DAX outside the simulated subset."""


class SimulationError(Exception):
    """Raised when a supported expression cannot be evaluated against the fact source."""


# ---------------------------------------------------------------------------
# BLANK
# ---------------------------------------------------------------------------


class _Blank:
    """The DAX BLANK value.

    A distinct singleton rather than `None`, so that "the fact source has no value in
    this cell" and "this expression evaluated to BLANK" stay separable in the code that
    reads results.
    """

    __slots__ = ()

    def __repr__(self) -> str:
        """Render as the DAX literal, which is what a report shows."""
        return "BLANK()"


BLANK = _Blank()

#: Values that are absent one way or another when an aggregation reads a column.
_ABSENT = (None, BLANK)


def is_blank(value: Any) -> bool:
    """Return True when *value* is BLANK or a missing cell."""
    return value is BLANK or value is None


# ---------------------------------------------------------------------------
# The parsed expression
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Literal:
    """A number, a string, or a boolean written literally in the expression."""

    value: Any


@dataclass(frozen=True)
class ColumnRef:
    """A reference to `'table'[column]`."""

    table: str
    column: str


@dataclass(frozen=True)
class TableRef:
    """A reference to a whole table, as `COUNTROWS ( 'table' )` makes."""

    table: str


@dataclass(frozen=True)
class MeasureRef:
    """A reference to another measure, written `[Measure Name]`."""

    name: str


@dataclass(frozen=True)
class VarRef:
    """A reference to a `VAR` declared earlier in the same expression."""

    name: str


@dataclass(frozen=True)
class Call:
    """A function call: the function name upper-cased, and its arguments in order."""

    name: str
    args: tuple[Any, ...]


@dataclass(frozen=True)
class Binary:
    """A binary operator applied to two sub-expressions."""

    operator: str
    left: Any
    right: Any


@dataclass(frozen=True)
class Unary:
    """A unary minus."""

    operand: Any


@dataclass(frozen=True)
class VarBlock:
    """One or more `VAR name = expression` bindings and the `RETURN` body."""

    bindings: tuple[tuple[str, Any], ...]
    body: Any


# ---------------------------------------------------------------------------
# Tokenizer and parser
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
      (?P<ws>\s+)
    | (?P<qname>'(?:[^']|'')*')
    | (?P<bracket>\[[^\]]*\])
    | (?P<string>"(?:[^"]|"")*")
    | (?P<number>\d+(?:\.\d+)?)
    | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
    | (?P<op><>|>=|<=|[-+*/=<>(),])
    """,
    re.VERBOSE,
)

_COMPARISONS = frozenset({"=", "<>", ">", "<", ">=", "<="})


@dataclass
class _Token:
    """One lexical token: its kind, its text, and where it started."""

    kind: str
    text: str
    position: int


def tokenize(expression: str) -> list[_Token]:
    """Split *expression* into tokens, rejecting anything the subset cannot lex."""
    tokens: list[_Token] = []
    index = 0
    while index < len(expression):
        match = _TOKEN_RE.match(expression, index)
        if match is None:
            snippet = expression[index : index + 20]
            raise UnsupportedDaxError(f"cannot tokenize at offset {index}: {snippet!r}")
        index = match.end()
        kind = match.lastgroup or ""
        if kind == "ws":
            continue
        tokens.append(_Token(kind, match.group(), match.start()))
    return tokens


class _Parser:
    """Recursive-descent parser for the simulated DAX subset."""

    def __init__(self, tokens: list[_Token]) -> None:
        """Start at the first token."""
        self._tokens = tokens
        self._index = 0

    # -- token helpers ---------------------------------------------------

    def _peek(self) -> _Token | None:
        return self._tokens[self._index] if self._index < len(self._tokens) else None

    def _next(self) -> _Token:
        token = self._peek()
        if token is None:
            raise UnsupportedDaxError("expression ended earlier than the grammar allows")
        self._index += 1
        return token

    def _at_operator(self, *texts: str) -> bool:
        token = self._peek()
        return token is not None and token.kind == "op" and token.text in texts

    def _at_keyword(self, keyword: str) -> bool:
        token = self._peek()
        return token is not None and token.kind == "name" and token.text.upper() == keyword

    def _expect_operator(self, text: str) -> None:
        token = self._next()
        if token.kind != "op" or token.text != text:
            raise UnsupportedDaxError(
                f"expected {text!r} at offset {token.position}, got {token.text!r}"
            )

    # -- grammar ---------------------------------------------------------

    def parse(self) -> Any:
        """Parse the whole token stream and insist that nothing is left over."""
        node = self._parse_expression()
        remaining = self._peek()
        if remaining is not None:
            raise UnsupportedDaxError(f"trailing tokens from offset {remaining.position}")
        return node

    def _parse_expression(self) -> Any:
        if self._at_keyword("VAR"):
            return self._parse_var_block()
        return self._parse_comparison()

    def _parse_var_block(self) -> VarBlock:
        bindings: list[tuple[str, Any]] = []
        while self._at_keyword("VAR"):
            self._next()
            name_token = self._next()
            if name_token.kind != "name":
                raise UnsupportedDaxError(f"VAR needs a name at offset {name_token.position}")
            self._expect_operator("=")
            bindings.append((name_token.text, self._parse_comparison()))
        if not self._at_keyword("RETURN"):
            raise UnsupportedDaxError("VAR block without RETURN")
        self._next()
        return VarBlock(tuple(bindings), self._parse_comparison())

    def _parse_comparison(self) -> Any:
        left = self._parse_additive()
        if self._at_operator(*_COMPARISONS):
            operator = self._next().text
            return Binary(operator, left, self._parse_additive())
        return left

    def _parse_additive(self) -> Any:
        node = self._parse_multiplicative()
        while self._at_operator("+", "-"):
            operator = self._next().text
            node = Binary(operator, node, self._parse_multiplicative())
        return node

    def _parse_multiplicative(self) -> Any:
        node = self._parse_unary()
        while self._at_operator("*", "/"):
            operator = self._next().text
            node = Binary(operator, node, self._parse_unary())
        return node

    def _parse_unary(self) -> Any:
        if self._at_operator("-"):
            self._next()
            return Unary(self._parse_unary())
        return self._parse_primary()

    def _parse_primary(self) -> Any:
        token = self._next()
        if token.kind == "number":
            text = token.text
            return Literal(float(text) if "." in text else int(text))
        if token.kind == "string":
            return Literal(token.text[1:-1].replace('""', '"'))
        if token.kind == "bracket":
            return MeasureRef(token.text[1:-1])
        if token.kind == "qname":
            return self._parse_column_reference(token)
        if token.kind == "name":
            return self._parse_name(token)
        if token.kind == "op" and token.text == "(":
            node = self._parse_expression()
            self._expect_operator(")")
            return node
        raise UnsupportedDaxError(f"unexpected token {token.text!r} at offset {token.position}")

    def _parse_column_reference(self, token: _Token) -> ColumnRef | TableRef:
        table = token.text[1:-1].replace("''", "'")
        bracket = self._peek()
        if bracket is None or bracket.kind != "bracket":
            return TableRef(table)
        self._next()
        return ColumnRef(table, bracket.text[1:-1])

    def _parse_name(self, token: _Token) -> Any:
        following = self._peek()
        if following is not None and following.kind == "bracket":
            self._next()
            return ColumnRef(token.text, following.text[1:-1])
        if following is not None and following.kind == "op" and following.text == "(":
            self._next()
            return Call(token.text.upper(), tuple(self._parse_arguments()))
        return VarRef(token.text)

    def _parse_arguments(self) -> list[Any]:
        arguments: list[Any] = []
        if self._at_operator(")"):
            self._next()
            return arguments
        while True:
            arguments.append(self._parse_expression())
            if self._at_operator(","):
                self._next()
                continue
            self._expect_operator(")")
            return arguments


def parse_dax(expression: str) -> Any:
    """Parse a DAX expression into the simulated AST."""
    return _Parser(tokenize(expression)).parse()


# ---------------------------------------------------------------------------
# The model, read from committed TMDL
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Relationship:
    """One many-to-one relationship, in the direction filters actually travel."""

    name: str
    many_table: str
    many_column: str
    one_table: str
    one_column: str
    is_active: bool


@dataclass
class Measure:
    """A measure as the simulation needs it: its expression, its annotations, its AST."""

    name: str
    home_table: str
    expression: str
    annotations: dict[str, str]
    ast: Any | None = None
    parse_error: str | None = None


@dataclass
class SimulatedModel:
    """Everything the evaluator needs, parsed out of the committed TMDL."""

    columns: dict[str, set[str]] = field(default_factory=dict)
    relationships: list[Relationship] = field(default_factory=list)
    measures: dict[str, Measure] = field(default_factory=dict)

    def data_tables(self) -> list[str]:
        """Return the tables that hold rows, i.e. everything but the measure groups."""
        measure_homes = {measure.home_table for measure in self.measures.values()}
        return sorted(name for name in self.columns if name not in measure_homes)

    def relationship_for(self, first: ColumnRef, second: ColumnRef) -> Relationship | None:
        """Return the relationship joining two columns, whichever order they are given in."""
        wanted = {(first.table, first.column), (second.table, second.column)}
        for relationship in self.relationships:
            ends = {
                (relationship.many_table, relationship.many_column),
                (relationship.one_table, relationship.one_column),
            }
            if ends == wanted:
                return relationship
        return None


def _load_model_checker() -> Any:
    """Import `scripts/check_powerbi_model.py` by path and return the module.

    The TMDL reader lives there and is the only parser this repository has. Re-implementing
    it here would mean two parsers disagreeing about the same files, which is exactly the
    failure the simulation exists to detect elsewhere.
    """
    path = Path(__file__).resolve().parent / "check_powerbi_model.py"
    spec = importlib.util.spec_from_file_location("arpi_scripts.check_powerbi_model", path)
    if spec is None or spec.loader is None:  # pragma: no cover - a broken checkout only
        raise SimulationError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_model() -> SimulatedModel:
    """Read the committed semantic model into the simulation's own structures."""
    checker = _load_model_checker().Checker()
    checker.load_model()

    model = SimulatedModel()
    for table_name, table in checker.tables.items():
        model.columns[table_name] = {column.name for column in table.children_of("column")}
        for measure in table.children_of("measure"):
            model.measures[measure.name] = Measure(
                name=measure.name,
                home_table=table_name,
                expression=measure.expression,
                annotations=dict(measure.annotations),
            )

    for declared in checker.relationships:
        many = declared.properties.get("fromColumn", "")
        one = declared.properties.get("toColumn", "")
        if "." not in many or "." not in one:
            raise SimulationError(f"relationship {declared.name} has no usable endpoints")
        many_table, many_column = many.split(".", 1)
        one_table, one_column = one.split(".", 1)
        model.relationships.append(
            Relationship(
                name=declared.name,
                many_table=many_table,
                many_column=many_column,
                one_table=one_table,
                one_column=one_column,
                is_active=declared.properties.get("isActive", "true").lower() != "false",
            )
        )

    for measure in model.measures.values():
        try:
            measure.ast = parse_dax(measure.expression)
        except UnsupportedDaxError as error:
            measure.parse_error = str(error)
    return model


# ---------------------------------------------------------------------------
# Filter context
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FilterContext:
    """The filters in force, plus any relationship the context has re-pointed.

    Filters are held as `(table, column, allowed values)`. Applying a filter to a column
    that already carries one **replaces** it, which is CALCULATE's overwrite semantics
    and the behaviour a report author relies on.
    """

    filters: tuple[tuple[str, str, frozenset[Any]], ...] = ()
    activated: frozenset[str] = frozenset()
    deactivated: frozenset[str] = frozenset()

    def with_filter(self, table: str, column: str, values: frozenset[Any]) -> FilterContext:
        """Return a context with *column* restricted to *values*, replacing any prior filter."""
        kept = tuple(entry for entry in self.filters if entry[0] != table or entry[1] != column)
        return FilterContext(
            filters=(*kept, (table, column, values)),
            activated=self.activated,
            deactivated=self.deactivated,
        )

    def with_relationship(self, activated: str, deactivated: frozenset[str]) -> FilterContext:
        """Return a context in which *activated* carries the filter instead of *deactivated*."""
        return FilterContext(
            filters=self.filters,
            activated=self.activated | {activated},
            deactivated=(self.deactivated | deactivated) - {activated},
        )

    def filters_on(self, table: str) -> tuple[tuple[str, frozenset[Any]], ...]:
        """Return the `(column, values)` filters that apply directly to *table*."""
        return tuple((column, values) for owner, column, values in self.filters if owner == table)


def context_from_filters(pairs: dict[tuple[str, str], Any]) -> FilterContext:
    """Build a context from `{(table, column): value or iterable of values}`."""
    context = FilterContext()
    for (table, column), value in pairs.items():
        values = value if isinstance(value, (list, tuple, set, frozenset)) else [value]
        context = context.with_filter(table, column, frozenset(values))
    return context


# ---------------------------------------------------------------------------
# The engine
# ---------------------------------------------------------------------------

#: DIVIDE takes two or three arguments; anything else is a different function.
_DIVIDE_ARITY = (2, 3)


class SimulationEngine:
    """Evaluates the simulated subset of DAX over an in-memory fact source."""

    def __init__(self, model: SimulatedModel, data: dict[str, list[dict[str, Any]]]) -> None:
        """Bind an engine to a parsed model and an in-memory fact source."""
        self.model = model
        self.data = data
        self._visible_cache: dict[FilterContext, dict[str, list[dict[str, Any]]]] = {}
        self._handlers = {
            "SUM": self._function_sum,
            "MEDIAN": self._function_median,
            "MAX": self._function_max,
            "COUNTROWS": self._function_countrows,
            "DIVIDE": self._function_divide,
            "CALCULATE": self._function_calculate,
            "LASTNONBLANKVALUE": self._function_lastnonblankvalue,
            "SELECTEDVALUE": self._function_selectedvalue,
            "IF": self._function_if,
            "ISBLANK": self._function_isblank,
            "BLANK": self._function_blank,
            "TRUE": self._function_true,
            "FALSE": self._function_false,
        }
        self._node_handlers = {
            Literal: self._evaluate_literal,
            MeasureRef: self._evaluate_measure_ref,
            VarRef: self._evaluate_var_ref,
            VarBlock: self._evaluate_var_block,
            Unary: self._evaluate_unary,
            Binary: self._evaluate_binary,
            Call: self._evaluate_call,
            ColumnRef: self._refuse_column,
            TableRef: self._refuse_table,
        }

    # -- public surface --------------------------------------------------

    def evaluate_measure(self, name: str, context: FilterContext | None = None) -> Any:
        """Evaluate the named measure in *context* (the whole model when omitted)."""
        measure = self.model.measures.get(name)
        if measure is None:
            raise SimulationError(f"no measure named {name!r}")
        if measure.ast is None:
            raise UnsupportedDaxError(measure.parse_error or f"{name} did not parse")
        return self._evaluate(measure.ast, context or FilterContext(), {})

    def visible_rows(self, table: str, context: FilterContext) -> list[dict[str, Any]]:
        """Return the rows of *table* that survive *context*, propagation included."""
        cached = self._visible_cache.get(context)
        if cached is None:
            cached = self._propagate(context)
            self._visible_cache[context] = cached
        if table not in cached:
            raise SimulationError(f"the fact source has no table named {table!r}")
        return cached[table]

    # -- filter propagation ----------------------------------------------

    def _propagate(self, context: FilterContext) -> dict[str, list[dict[str, Any]]]:
        """Apply direct filters, then push them from the one side to the many side."""
        surviving: dict[str, list[dict[str, Any]]] = {}
        restricted: set[str] = set()
        for table, rows in self.data.items():
            direct = context.filters_on(table)
            if direct:
                surviving[table] = [row for row in rows if _row_passes(row, direct)]
                restricted.add(table)
            else:
                surviving[table] = list(rows)

        active = [
            relationship
            for relationship in self.model.relationships
            if self._is_active(relationship, context)
        ]
        changed = True
        while changed:
            changed = False
            for relationship in active:
                if relationship.one_table not in restricted:
                    continue
                missing = {relationship.one_table, relationship.many_table} - set(surviving)
                if missing:
                    continue
                keys = {
                    row.get(relationship.one_column) for row in surviving[relationship.one_table]
                }
                kept = [
                    row
                    for row in surviving[relationship.many_table]
                    if row.get(relationship.many_column) in keys
                ]
                if len(kept) != len(surviving[relationship.many_table]):
                    surviving[relationship.many_table] = kept
                    restricted.add(relationship.many_table)
                    changed = True
        return surviving

    @staticmethod
    def _is_active(relationship: Relationship, context: FilterContext) -> bool:
        """Return whether *relationship* carries filters in this context."""
        if relationship.name in context.activated:
            return True
        return relationship.is_active and relationship.name not in context.deactivated

    # -- evaluation ------------------------------------------------------

    def _evaluate(self, node: Any, context: FilterContext, variables: dict[str, Any]) -> Any:
        """Evaluate one node, dispatching on its type."""
        handler = self._node_handlers.get(type(node))
        if handler is None:
            raise UnsupportedDaxError(f"cannot evaluate {node!r}")
        return handler(node, context, variables)

    def _evaluate_literal(
        self, node: Literal, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del context, variables
        return node.value

    def _evaluate_measure_ref(
        self, node: MeasureRef, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        return self.evaluate_measure(node.name, context)

    def _evaluate_var_ref(
        self, node: VarRef, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del context
        if node.name not in variables:
            raise UnsupportedDaxError(f"unknown identifier {node.name!r}")
        return variables[node.name]

    def _evaluate_unary(
        self, node: Unary, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        operand = self._evaluate(node.operand, context, variables)
        return BLANK if is_blank(operand) else -operand

    def _evaluate_call(self, node: Call, context: FilterContext, variables: dict[str, Any]) -> Any:
        handler = self._handlers.get(node.name)
        if handler is None:
            raise UnsupportedDaxError(f"{node.name} is outside the simulated subset")
        return handler(node.args, context, variables)

    def _refuse_column(
        self, node: ColumnRef, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del context, variables
        raise UnsupportedDaxError(
            f"'{node.table}'[{node.column}] used without an aggregation; "
            "row context is not simulated"
        )

    def _refuse_table(
        self, node: TableRef, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del context, variables
        raise UnsupportedDaxError(
            f"'{node.table}' used where a scalar is needed; table expressions are not simulated"
        )

    def _evaluate_var_block(
        self, node: VarBlock, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        scope = dict(variables)
        for name, expression in node.bindings:
            scope[name] = self._evaluate(expression, context, scope)
        return self._evaluate(node.body, context, scope)

    def _evaluate_binary(
        self, node: Binary, context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        left = self._evaluate(node.left, context, variables)
        right = self._evaluate(node.right, context, variables)
        if node.operator in _COMPARISONS:
            return _compare(node.operator, left, right)
        return _arithmetic(node.operator, left, right)

    # -- aggregations ----------------------------------------------------

    def _column_values(self, argument: Any, context: FilterContext, function: str) -> list[Any]:
        if not isinstance(argument, ColumnRef):
            raise UnsupportedDaxError(f"{function} needs a column reference")
        rows = self.visible_rows(argument.table, context)
        return [row[argument.column] for row in rows if row.get(argument.column) not in _ABSENT]

    def _function_sum(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        values = self._column_values(args[0], context, "SUM")
        return BLANK if not values else sum(values)

    def _function_median(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        values = self._column_values(args[0], context, "MEDIAN")
        return BLANK if not values else statistics.median(values)

    def _function_max(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        values = self._column_values(args[0], context, "MAX")
        return BLANK if not values else max(values)

    def _function_countrows(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        argument = args[0]
        if not isinstance(argument, (TableRef, ColumnRef, VarRef)):
            raise UnsupportedDaxError("COUNTROWS needs a table reference")
        table = argument.name if isinstance(argument, VarRef) else argument.table
        count = len(self.visible_rows(table, context))
        return BLANK if count == 0 else count

    def _function_divide(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        if len(args) not in _DIVIDE_ARITY:
            raise UnsupportedDaxError("DIVIDE takes two or three arguments")
        numerator = self._evaluate(args[0], context, variables)
        denominator = self._evaluate(args[1], context, variables)
        alternate: Any = BLANK
        if len(args) == _DIVIDE_ARITY[1]:
            alternate = self._evaluate(args[2], context, variables)
        if is_blank(denominator) or denominator == 0:
            return alternate
        if is_blank(numerator):
            return BLANK
        return numerator / denominator

    def _function_selectedvalue(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del variables
        values = set(self._column_values(args[0], context, "SELECTEDVALUE"))
        return values.pop() if len(values) == 1 else BLANK

    def _function_if(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        condition = self._evaluate(args[0], context, variables)
        branch = args[1] if condition else (args[2] if len(args) > _DIVIDE_ARITY[0] else None)
        return BLANK if branch is None else self._evaluate(branch, context, variables)

    def _function_isblank(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        return is_blank(self._evaluate(args[0], context, variables))

    def _function_blank(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del args, context, variables
        return BLANK

    def _function_true(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del args, context, variables
        return True

    def _function_false(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        del args, context, variables
        return False

    # -- CALCULATE and the semi-additive helpers -------------------------

    def _function_calculate(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        modified = context
        for modifier in args[1:]:
            modified = self._apply_modifier(modifier, modified, context, variables)
        return self._evaluate(args[0], modified, variables)

    def _apply_modifier(
        self,
        modifier: Any,
        context: FilterContext,
        outer: FilterContext,
        variables: dict[str, Any],
    ) -> FilterContext:
        """Apply one CALCULATE argument to the context being built."""
        if isinstance(modifier, Call) and modifier.name == "USERELATIONSHIP":
            return self._apply_userelationship(modifier, context)
        if isinstance(modifier, Call) and modifier.name == "LASTNONBLANK":
            return self._apply_lastnonblank(modifier, context, outer, variables)
        if isinstance(modifier, Binary) and modifier.operator == "=":
            return self._apply_equality(modifier, context, outer, variables)
        raise UnsupportedDaxError("CALCULATE modifier is outside the simulated subset")

    def _apply_userelationship(self, modifier: Call, context: FilterContext) -> FilterContext:
        first, second = modifier.args
        if not isinstance(first, ColumnRef) or not isinstance(second, ColumnRef):
            raise UnsupportedDaxError("USERELATIONSHIP needs two column references")
        relationship = self.model.relationship_for(first, second)
        if relationship is None:
            raise SimulationError(
                f"USERELATIONSHIP names no declared relationship: "
                f"'{first.table}'[{first.column}] to '{second.table}'[{second.column}]"
            )
        pair = {relationship.many_table, relationship.one_table}
        conflicting = frozenset(
            other.name
            for other in self.model.relationships
            if other.name != relationship.name
            and other.is_active
            and {other.many_table, other.one_table} == pair
        )
        return context.with_relationship(relationship.name, conflicting)

    def _apply_lastnonblank(
        self,
        modifier: Call,
        context: FilterContext,
        outer: FilterContext,
        variables: dict[str, Any],
    ) -> FilterContext:
        column, expression = modifier.args
        if not isinstance(column, ColumnRef):
            raise UnsupportedDaxError("LASTNONBLANK needs a column reference")
        last = self._last_non_blank_key(column, expression, outer, variables)
        if last is None:
            return context.with_filter(column.table, column.column, frozenset())
        return context.with_filter(column.table, column.column, frozenset({last}))

    def _apply_equality(
        self,
        modifier: Binary,
        context: FilterContext,
        outer: FilterContext,
        variables: dict[str, Any],
    ) -> FilterContext:
        column = modifier.left
        if not isinstance(column, ColumnRef):
            raise UnsupportedDaxError("a CALCULATE predicate must compare a column to a value")
        value = self._evaluate(modifier.right, outer, variables)
        return context.with_filter(column.table, column.column, frozenset({value}))

    def _last_non_blank_key(
        self,
        column: ColumnRef,
        expression: Any,
        context: FilterContext,
        variables: dict[str, Any],
    ) -> Any:
        """Return the last value of *column* at which *expression* is not BLANK."""
        keys = sorted(
            {
                row[column.column]
                for row in self.visible_rows(column.table, context)
                if row.get(column.column) not in _ABSENT
            }
        )
        last: Any = None
        for key in keys:
            sliced = context.with_filter(column.table, column.column, frozenset({key}))
            if not is_blank(self._evaluate(expression, sliced, variables)):
                last = key
        return last

    def _function_lastnonblankvalue(
        self, args: tuple[Any, ...], context: FilterContext, variables: dict[str, Any]
    ) -> Any:
        column, expression = args
        if not isinstance(column, ColumnRef):
            raise UnsupportedDaxError("LASTNONBLANKVALUE needs a column reference")
        last = self._last_non_blank_key(column, expression, context, variables)
        if last is None:
            return BLANK
        sliced = context.with_filter(column.table, column.column, frozenset({last}))
        return self._evaluate(expression, sliced, variables)


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------


def _row_passes(row: dict[str, Any], filters: tuple[tuple[str, frozenset[Any]], ...]) -> bool:
    """Return whether *row* satisfies every direct filter on its table."""
    return all(row.get(column) in values for column, values in filters)


def _arithmetic(operator: str, left: Any, right: Any) -> Any:
    """Apply an arithmetic operator with DAX's BLANK rules.

    Addition and subtraction read BLANK as zero unless both sides are BLANK, which is why
    the `+ 0` idiom in the model turns an empty SUM into a visible zero. Multiplication
    and division propagate BLANK instead.
    """
    if operator in {"+", "-"}:
        if is_blank(left) and is_blank(right):
            return BLANK
        left = 0 if is_blank(left) else left
        right = 0 if is_blank(right) else right
        return left + right if operator == "+" else left - right
    if is_blank(left) or is_blank(right):
        return BLANK
    if operator == "*":
        return left * right
    if right == 0:
        return BLANK
    return left / right


def _compare(operator: str, left: Any, right: Any) -> bool:
    """Compare two values, reading BLANK as the empty end of the ordering."""
    if operator == "=":
        return _equal(left, right)
    if operator == "<>":
        return not _equal(left, right)
    left = 0 if is_blank(left) else left
    right = 0 if is_blank(right) else right
    if operator == ">":
        return bool(left > right)
    if operator == "<":
        return bool(left < right)
    if operator == ">=":
        return bool(left >= right)
    return bool(left <= right)


def _equal(left: Any, right: Any) -> bool:
    """Equality with BLANK folded onto the empty value, as DAX does."""
    if is_blank(left) or is_blank(right):
        return is_blank(left) and is_blank(right)
    return bool(left == right)
