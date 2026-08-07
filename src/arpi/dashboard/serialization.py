"""Canonical serialisation, exact-decimal rendering, hashing and query normalisation.

Determinism is a property of this module. Same source data plus same contract must produce
identical bytes, because ``--check`` is a byte comparison and a check that can report a
false difference is a check somebody disables.

The rules, all of them:

* **LF line endings.** Bytes are written directly, so no platform newline translation can
  reach them.
* **One record per line.** A dataset file is a JSON array whose elements each occupy one
  line. Fully expanding sixteen thousand rows produces a diff nobody reads; one line per
  row makes a changed measure legible in review.
* **Fixed key order.** Keys follow the contract's column order, not Python's insertion
  luck and not alphabetical order.
* **No timestamps in a dataset.** The manifest carries the two it declares.
* **Exact money.** ``Decimal`` in, decimal string out, at exactly two places, and the
  conversion refuses rather than rounds if the value carries more.
* **No float in a monetary path.** ``float`` appears only for the ``percentile_cont``
  order statistics PostgreSQL itself computes as ``double precision``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from datetime import date
from decimal import Decimal
from typing import Any, Final

from arpi.dashboard.contract import (
    MONETARY_DECIMAL_PLACES,
    ColumnContract,
    ColumnType,
    DatasetContract,
)
from arpi.exceptions import ArpiError
from arpi.utilities.hashing import sha256_hex

__all__ = [
    "ContractViolationError",
    "canonical_json_bytes",
    "content_sha256",
    "normalise_query",
    "query_sha256",
    "render_dataset_bytes",
    "render_value",
    "serialise_row",
]

#: The single-space-separated whitespace-canonical form used for query hashing.
_WHITESPACE_RUN: Final = re.compile(r"\s+")

#: Comment markers the query builder must never emit. Stripping a comment safely needs a
#: SQL parser, so the contract forbids one instead; this is the enforcement.
_COMMENT_MARKERS: Final[tuple[str, ...]] = ("--", "/*")


class ContractViolationError(ArpiError):
    """Raised when a value cannot cross the export boundary as its contract declares.

    Carries the dataset, the column and the offending value so the message names the thing
    to fix rather than only the rule that was broken.
    """

    def __init__(self, dataset: str, column: str, detail: str) -> None:
        """Initialise the error.

        Args:
            dataset: The dataset being exported.
            column: The column whose value failed.
            detail: What was wrong, in a sentence.
        """
        super().__init__(
            f"dashboard export dataset {dataset!r}, column {column!r}: {detail}",
            dataset=dataset,
            column=column,
        )
        self.dataset = dataset
        self.column = column


# ---------------------------------------------------------------------------------------
# Value rendering
# ---------------------------------------------------------------------------------------


def _render_currency(dataset: str, column: str, value: object) -> str:
    """Render a monetary value as an exact two-place decimal string.

    A ``float`` is refused outright rather than converted: the whole point of the money
    contract is that no binary floating-point value ever reaches a gross figure, and
    accepting one here would make that promise unverifiable.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        value: The value from PostgreSQL.

    Returns:
        The decimal string, sign preserved, exactly two places.

    Raises:
        ContractViolationError: If the value is a float, is not a ``Decimal``-compatible
            number, or carries more than two decimal places.
    """
    if isinstance(value, float):
        raise ContractViolationError(
            dataset,
            column,
            "arrived as a Python float. A monetary column must reach the exporter as a "
            "Decimal; a float has already lost the guarantee the contract makes.",
        )
    if not isinstance(value, Decimal | int):
        raise ContractViolationError(
            dataset, column, f"declared as currency but arrived as {type(value).__name__}."
        )
    amount = Decimal(value)
    exponent = amount.as_tuple().exponent
    if not isinstance(exponent, int) or -exponent > MONETARY_DECIMAL_PLACES:
        raise ContractViolationError(
            dataset,
            column,
            f"carries the value {amount} with more than {MONETARY_DECIMAL_PLACES} decimal "
            "places. The reporting layer's monetary columns are numeric(12,2) and sums of "
            "them, so this is schema drift. The exporter will not round a gross figure into "
            "shape.",
        )
    # quantize() cannot round here: the exponent was just proven to be -2 or coarser, so
    # this only pads. Padding is what keeps "1234.5" and "1234.50" from being two spellings
    # of one amount.
    return format(amount.quantize(Decimal(1).scaleb(-MONETARY_DECIMAL_PLACES)), "f")


def _render_exact(dataset: str, column: str, value: object) -> str:
    """Render an unbounded-scale ``numeric`` as its exact decimal string, unrounded.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        value: The value from PostgreSQL.

    Returns:
        The exact decimal string in positional notation.

    Raises:
        ContractViolationError: If the value is a float or not decimal-compatible.
    """
    if isinstance(value, float):
        raise ContractViolationError(
            dataset,
            column,
            "arrived as a Python float. This column is a PostgreSQL numeric and must stay "
            "exact; declare it as 'double' if the view really produces a double.",
        )
    if not isinstance(value, Decimal | int):
        raise ContractViolationError(
            dataset, column, f"declared as an exact decimal but arrived as {type(value).__name__}."
        )
    # `format(..., "f")` rather than `str()`: str() can emit exponent notation for values
    # with a positive exponent, and two spellings of one number break byte-stability.
    return format(Decimal(value), "f")


def _render_double(dataset: str, column: str, value: object) -> float:
    """Render a ``double precision`` order statistic as a JSON number.

    ``float`` survives the JSON round trip exactly, because Python's ``repr`` -- which
    ``json`` uses -- emits the shortest string that reparses to the identical double. The
    value is therefore preserved, not approximated, and no decimal precision is claimed
    that ``percentile_cont`` never produced.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        value: The value from PostgreSQL.

    Returns:
        The value as a ``float``.

    Raises:
        ContractViolationError: If the value is not a real number.
    """
    if isinstance(value, bool) or not isinstance(value, float | int | Decimal):
        raise ContractViolationError(
            dataset, column, f"declared as a double but arrived as {type(value).__name__}."
        )
    return float(value)


def _render_integer(dataset: str, column: str, value: object) -> int:
    """Render an integer-family value as a JSON number.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        value: The value from PostgreSQL.

    Returns:
        The value as an ``int``.

    Raises:
        ContractViolationError: If the value is not an exact integer.
    """
    if isinstance(value, bool):
        raise ContractViolationError(
            dataset, column, "declared as an integer but arrived as a boolean."
        )
    if isinstance(value, int):
        return value
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    raise ContractViolationError(
        dataset, column, f"declared as an integer but arrived as {type(value).__name__}."
    )


def _render_date(dataset: str, column: str, value: object) -> str:
    """Render a date as ``YYYY-MM-DD``.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        value: The value from PostgreSQL.

    Returns:
        The ISO date string.

    Raises:
        ContractViolationError: If the value is not a ``date``.
    """
    if not isinstance(value, date):
        raise ContractViolationError(
            dataset, column, f"declared as a date but arrived as {type(value).__name__}."
        )
    return value.isoformat()


def render_value(dataset: str, column: ColumnContract, value: object) -> Any:
    """Render one value according to its column contract.

    Args:
        dataset: Dataset name, for the error message.
        column: The column contract.
        value: The value as PostgreSQL returned it.

    Returns:
        A JSON-serialisable value.

    Raises:
        ContractViolationError: If the value is null where the contract forbids it, is of
            the wrong kind, or falls outside a declared enumeration.
    """
    if value is None:
        if not column.nullable:
            raise ContractViolationError(
                dataset,
                column.name,
                "is null, but the contract declares it required. A required column is "
                "non-null in every row; the exporter fails rather than emitting a null the "
                "console would have to render as 'no data'.",
            )
        return None

    rendered = _render_typed(dataset, column.name, column.type, value)
    if column.enumeration is not None and rendered not in column.enumeration:
        permitted = ", ".join(column.enumeration)
        raise ContractViolationError(
            dataset,
            column.name,
            f"carries {rendered!r}, which is outside its closed enumeration ({permitted}). "
            "An out-of-set value fails the export rather than reaching the console as an "
            "unlabelled category.",
        )
    return rendered


#: The renderer for each type that has one. ``boolean`` and ``string`` are handled inline
#: in :func:`_render_typed` because neither converts anything.
_RENDERERS: Final[Mapping[str, Callable[[str, str, object], Any]]] = {
    "currency": _render_currency,
    "exact": _render_exact,
    "double": _render_double,
    "integer": _render_integer,
    "date": _render_date,
}


def _render_typed(dataset: str, column: str, type_: ColumnType, value: object) -> Any:
    """Dispatch a non-null value to its type's renderer.

    Args:
        dataset: Dataset name, for the error message.
        column: Column name, for the error message.
        type_: The declared column type.
        value: The non-null value.

    Returns:
        A JSON-serialisable value.

    Raises:
        ContractViolationError: If the value does not match the declared type.
    """
    renderer = _RENDERERS.get(type_)
    if renderer is not None:
        return renderer(dataset, column, value)
    if type_ == "boolean":
        if not isinstance(value, bool):
            raise ContractViolationError(
                dataset, column, f"declared as a boolean but arrived as {type(value).__name__}."
            )
        return value
    if not isinstance(value, str):
        # uuid, text and varchar all arrive as str or as something with a faithful str();
        # a UUID is the one legitimate non-str, and psycopg hands it over as uuid.UUID.
        return str(value)
    return value


def serialise_row(entry: DatasetContract, row: Sequence[object]) -> dict[str, Any]:
    """Render one database row into its exported mapping, in contract column order.

    Args:
        entry: The dataset contract.
        row: The row as PostgreSQL returned it, in contract column order.

    Returns:
        The exported record.

    Raises:
        ContractViolationError: If the row's width disagrees with the contract, or any
            value violates its column's declaration.
    """
    if len(row) != len(entry.columns):
        raise ContractViolationError(
            entry.name,
            "*",
            f"the query returned {len(row)} column(s) but the contract declares "
            f"{len(entry.columns)}. This is schema drift in "
            f"reporting.{entry.source_view}; reconcile the view and the contract before "
            "exporting.",
        )
    return {
        column.name: render_value(entry.name, column, value)
        for column, value in zip(entry.columns, row, strict=True)
    }


# ---------------------------------------------------------------------------------------
# File serialisation
# ---------------------------------------------------------------------------------------


def render_dataset_bytes(records: Sequence[Mapping[str, Any]]) -> bytes:
    """Serialise a dataset to its exact committed bytes.

    One record per line, LF endings, a trailing newline, no non-ASCII escaping surprises
    (``ensure_ascii`` left at its default so the bytes are ASCII and diff cleanly on any
    terminal).

    Args:
        records: The exported records, already in sort order.

    Returns:
        The file's bytes.
    """
    if not records:
        return b"[]\n"
    body = ",\n".join(
        f"  {json.dumps(record, separators=(',', ':'), sort_keys=False)}" for record in records
    )
    return f"[\n{body}\n]\n".encode()


def canonical_json_bytes(payload: Mapping[str, Any]) -> bytes:
    """Serialise a mapping to indented, LF-terminated canonical JSON.

    Used for the manifest and for any structure whose hash is recorded. Key order is the
    mapping's own order, which the callers build deliberately; ``sort_keys`` is left off so
    a manifest reads top-to-bottom in the order the contract documents.

    Args:
        payload: The structure to serialise.

    Returns:
        The bytes, ending in a single newline.
    """
    return (json.dumps(payload, indent=2, sort_keys=False, ensure_ascii=True) + "\n").encode()


def content_sha256(payload: bytes) -> str:
    """Return the SHA-256 hex digest of a file's exact bytes.

    Args:
        payload: The bytes as written to disk.

    Returns:
        A 64-character lowercase digest.
    """
    return sha256_hex(payload)


# ---------------------------------------------------------------------------------------
# Query normalisation and hashing
# ---------------------------------------------------------------------------------------


def normalise_query(sql: str) -> str:
    """Reduce a query to its whitespace-canonical single-line form.

    See :data:`arpi.dashboard.contract.QUERY_NORMALISATION` for the algorithm and for why
    comments are refused rather than stripped.

    Args:
        sql: The query text.

    Returns:
        The canonical form.

    Raises:
        ContractViolationError: If the query carries a comment marker, which this
            normalisation cannot handle safely.
    """
    for marker in _COMMENT_MARKERS:
        if marker in sql:
            raise ContractViolationError(
                "*",
                "*",
                f"the generated query contains the comment marker {marker!r}. Query hashing "
                "normalises whitespace to a single line, which would swallow a trailing "
                "comment, so the contract forbids emitting one. Move the explanation into "
                "the contract's notes.",
            )
    unified = sql.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in unified.split("\n")]
    return _WHITESPACE_RUN.sub(" ", " ".join(line for line in lines if line)).strip()


def query_sha256(sql: str) -> str:
    """Return the SHA-256 digest of a query's canonical form.

    Args:
        sql: The query text.

    Returns:
        A 64-character lowercase digest, stable across reindentation and across platform
        line endings.
    """
    return sha256_hex(normalise_query(sql).encode("utf-8"))
