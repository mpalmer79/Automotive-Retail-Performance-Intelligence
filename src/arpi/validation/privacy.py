"""The prohibited-field tripwire: one rule, usable against every schema ARPI touches.

ARPI generates no personal data at all. That promise is only as good as the control
behind it, so this module turns it into an executable, deny-by-default rule that any
layer can call:

* a generator's declared column tuple, before a row exists;
* a :class:`pandas.DataFrame`, before it is written;
* a CSV header row, before the file is loaded;
* a list of PostgreSQL column names read from ``information_schema``.

All four are sequences of column names, so all four go through
:func:`assert_columns_are_privacy_safe`. There is one vocabulary and one set of rules,
which is the point: a column that would be refused in pandas is refused in PostgreSQL.

How a name is judged
--------------------
1. **Normalise.** Lower-case, strip, turn ``-``, ``.`` and spaces into ``_``, collapse
   runs of ``_``, and trim leading and trailing ``_``. ``Customer-Email``,
   ``customer.email`` and ``CUSTOMER__EMAIL`` all normalise to ``customer_email``.
2. **Exact match** against :data:`~arpi.constants.PROHIBITED_PII_FIELD_NAMES`.
3. **Substring match** against :data:`~arpi.constants.PROHIBITED_PII_SUBSTRINGS`. Every
   token there is one no legitimate ARPI column can contain, so ``customer_email`` and
   ``home_phone_number`` are caught rather than only their bare forms.
4. **Whole-word match** against :data:`~arpi.constants.PROHIBITED_PII_WORD_TOKENS`, over
   the ``_``-separated words of the name. This reaches ``customer_notes`` and
   ``call_recording_url`` without the false positives a substring rule would cause.
5. **The ``age`` rule.** Any name carrying ``age`` as a word is prohibited unless it is
   one of the banded spellings in :data:`~arpi.constants.APPROVED_AGE_COLUMNS`, so
   ``age_band`` passes and ``age`` and ``customer_age`` do not. A second allowlist,
   :data:`~arpi.constants.APPROVED_ASSET_AGE_COLUMNS`, covers the names whose ``age``
   measures an asset rather than a person -- inventory age is one of the platform's
   central measures and must not be refused as if it were a birthday. Both lists are
   explicit and every entry carries a written justification.
6. **The ``_name`` suffix rule.** A name ending in ``name`` is treated as a person's name
   unless it appears in :data:`~arpi.constants.APPROVED_NAME_COLUMNS`, whose every entry
   carries a written justification. Denying by default means a future generator adding
   ``salesperson_name`` fails without anyone having to extend a blocklist first.

Fail closed
-----------
Every entry point raises :class:`ProhibitedColumnError` on a match. Nothing in this
module warns and continues, and nothing offers a bypass flag. The one function that does
not raise is :func:`check_no_prohibited_pii_columns`, which exists because the validation
framework records outcomes rather than raising -- and it records a ``critical`` failure,
which fails the run.

Never persist a prohibited payload
----------------------------------
:func:`redact_payload` drops nothing and hides everything: prohibited keys keep their
position in the mapping but their values become
:data:`~arpi.constants.REDACTED_PLACEHOLDER`. The rejected-record path must pass every
payload through it before writing to ``audit.rejected_record``, so quarantining a bad row
can never itself become the leak.

What this does not do
---------------------
It inspects **names, not values**. A column called ``market_area`` holding an email
address passes. See ``LIMITATIONS.md``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from arpi.constants import (
    APPROVED_AGE_COLUMNS,
    APPROVED_ASSET_AGE_COLUMNS,
    APPROVED_NAME_COLUMNS,
    CHECK_CATEGORY_PRIVACY,
    CSV_DELIMITER,
    CSV_ENCODING,
    PROHIBITED_PII_FIELD_NAMES,
    PROHIBITED_PII_SUBSTRINGS,
    PROHIBITED_PII_WORD_TOKENS,
    REDACTED_PLACEHOLDER,
)
from arpi.exceptions import ArpiError
from arpi.validation.results import CheckResult, CheckSeverity

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from pathlib import Path

    import pandas as pd

__all__ = [
    "ProhibitedColumnError",
    "assert_columns_are_privacy_safe",
    "assert_csv_header_is_privacy_safe",
    "assert_frame_is_privacy_safe",
    "check_no_prohibited_pii_columns",
    "is_prohibited_column",
    "normalise_column_name",
    "prohibited_columns",
    "redact_payload",
]

#: Characters that a column name may use as a word separator, all folded to ``_``.
_SEPARATORS: tuple[str, ...] = ("-", ".", " ", "\t")


class ProhibitedColumnError(ArpiError):
    """Raised when a schema declares a column name that denotes personal data.

    Attributes:
        entity: The entity whose schema was inspected.
        columns: The offending column names, exactly as they were declared.
    """

    def __init__(self, entity: str, columns: Sequence[str], *, source: str) -> None:
        """Initialise the error.

        Args:
            entity: Entity whose schema was inspected, e.g. ``"dim_customer"``.
            columns: Offending column names, as declared.
            source: Where the names came from, e.g. ``"declared columns"``.
        """
        rendered = ", ".join(columns)
        super().__init__(
            f"{entity} declares prohibited personal-data column(s) in its {source}: "
            f"{rendered}. ARPI must never generate, store or persist personal data. "
            f"Rename the column, or -- if it is a descriptive label rather than a "
            f"person -- add it to APPROVED_NAME_COLUMNS with a written justification.",
            entity=entity,
            columns=list(columns),
            source=source,
        )
        self.entity = entity
        self.columns: tuple[str, ...] = tuple(columns)
        self.source = source


def normalise_column_name(name: str) -> str:
    """Fold a column name to the canonical form the rules are written against.

    Lower-cases, strips surrounding whitespace, replaces ``-``, ``.``, spaces and tabs
    with ``_``, collapses runs of ``_``, and trims leading and trailing ``_``.

    Args:
        name: The column name as declared, however it is spelt.

    Returns:
        The normalised name. ``"  Customer-Email "`` becomes ``"customer_email"``.
    """
    folded = name.strip().lower()
    for separator in _SEPARATORS:
        folded = folded.replace(separator, "_")
    # ``"a__b___c"`` -> ``"a_b_c"``; a single pass over the parts is enough because
    # ``str.split`` already discards empty segments when they are filtered out.
    return "_".join(part for part in folded.split("_") if part)


def is_prohibited_column(name: str) -> bool:
    """Decide whether a column name denotes personal data.

    Args:
        name: The column name to classify, in any spelling.

    Returns:
        ``True`` when the name is prohibited. See the module docstring for the six
        rules, which are applied in order of increasing subtlety.
    """
    normalised = normalise_column_name(name)
    if not normalised:
        return False
    if normalised in PROHIBITED_PII_FIELD_NAMES:
        return True
    if any(token in normalised for token in PROHIBITED_PII_SUBSTRINGS):
        return True

    words = frozenset(normalised.split("_"))
    if words & PROHIBITED_PII_WORD_TOKENS:
        return True
    if (
        "age" in words
        and normalised not in APPROVED_AGE_COLUMNS
        and normalised not in APPROVED_ASSET_AGE_COLUMNS
    ):
        return True

    is_name_column = normalised == "name" or normalised.endswith("_name")
    return is_name_column and normalised not in APPROVED_NAME_COLUMNS


def prohibited_columns(names: Iterable[str]) -> tuple[str, ...]:
    """Return every prohibited name in ``names``, in the order they were given.

    Args:
        names: Column names to classify.

    Returns:
        The offending names exactly as supplied, so an error message can quote the
        spelling the author actually used rather than the normalised form.
    """
    return tuple(str(name) for name in names if is_prohibited_column(str(name)))


def assert_columns_are_privacy_safe(
    columns: Iterable[str],
    entity: str,
    *,
    source: str = "declared columns",
) -> None:
    """Fail closed unless every column name is free of personal data.

    This is the schema-level checker. It works identically against a generator's
    declared column tuple, a CSV header row, and a list of PostgreSQL column names read
    from ``information_schema.columns`` -- all three are sequences of names.

    Args:
        columns: The column names to inspect.
        entity: Entity the schema belongs to, used in the error message.
        source: Where the names came from, used in the error message.

    Raises:
        ProhibitedColumnError: If any name denotes personal data.
    """
    offending = prohibited_columns(columns)
    if offending:
        raise ProhibitedColumnError(entity, offending, source=source)


def assert_frame_is_privacy_safe(frame: pd.DataFrame, entity: str) -> None:
    """Fail closed unless a frame's columns are free of personal data.

    Args:
        frame: The frame about to be written, loaded or published.
        entity: Entity the frame represents, e.g. ``"dim_customer"``.

    Raises:
        ProhibitedColumnError: If any column name denotes personal data.
    """
    assert_columns_are_privacy_safe(
        (str(column) for column in frame.columns), entity, source="frame columns"
    )


def assert_csv_header_is_privacy_safe(path: Path, entity: str) -> tuple[str, ...]:
    """Fail closed unless a CSV file's header row is free of personal data.

    Only the first line is read, so this is cheap enough to run on every file before it
    is loaded.

    Args:
        path: The CSV file to inspect.
        entity: Entity the file represents.

    Returns:
        The header fields, in file order.

    Raises:
        ProhibitedColumnError: If any header field denotes personal data.
    """
    with path.open("r", encoding=CSV_ENCODING, newline="") as handle:
        header_line = handle.readline()
    header = tuple(field.strip().strip('"') for field in header_line.strip().split(CSV_DELIMITER))
    assert_columns_are_privacy_safe(header, entity, source=f"CSV header of {path.name}")
    return header


def redact_payload(mapping: Mapping[str, Any]) -> dict[str, Any]:
    """Return a copy of ``mapping`` with every prohibited key's value masked.

    Keys are preserved so that a reviewer can still see *what* a rejected record carried
    and reproduce the defect; only the values disappear. Dropping the keys entirely
    would make two differently shaped rejections indistinguishable.

    Args:
        mapping: The record payload about to be persisted, typically to
            ``audit.rejected_record.record_payload``.

    Returns:
        A new dictionary in which prohibited keys map to
        :data:`~arpi.constants.REDACTED_PLACEHOLDER`.
    """
    return {
        key: (REDACTED_PLACEHOLDER if is_prohibited_column(str(key)) else value)
        for key, value in mapping.items()
    }


def check_no_prohibited_pii_columns(
    frame: pd.DataFrame,
    *,
    check_id: str,
    check_name: str,
    target_object: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Record, rather than raise, the outcome of the tripwire for one frame.

    The validation framework collects results in one pass and persists them to
    ``audit.validation_result``, so this variant reports instead of raising. The result
    is ``critical`` by default, which fails the run -- the outcome is the same, but it is
    auditable.

    Args:
        frame: Frame to inspect.
        check_id: Stable check identifier.
        check_name: Short human-readable name.
        target_object: Entity the check applies to.
        severity: Severity of a failure.

    Returns:
        The check result; ``observed_value`` is the number of offending columns.
    """
    offending = sorted(prohibited_columns(str(column) for column in frame.columns))
    base = CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=target_object,
        severity=severity,
        check_category=CHECK_CATEGORY_PRIVACY,
        observed_value=float(len(offending)),
        expected_value=0.0,
    )
    if not offending:
        return base
    return base.failed(
        f"{target_object} declares prohibited personal-data column(s): "
        f"{', '.join(offending)}. ARPI must never generate personal data.",
        failed_record_count=len(offending),
    )
