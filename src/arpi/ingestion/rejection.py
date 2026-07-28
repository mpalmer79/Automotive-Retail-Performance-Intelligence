"""The rejected-record path: what a rejection is, and what may be written about one.

A rejection is a row that reached ``raw`` and did not reach the warehouse. Phase 0 had
no such path at all -- ``audit.rejected_record`` was always empty, because the generators
could only emit contract-shaped rows and the staging views could only pass them through.
Phase 1 staging genuinely drops rows, so the rejections are real and are recorded here.

**A rejected payload is still a payload.** The row that failed is quarantined *with its
values*, so the defect can be reproduced -- and that is precisely the moment a prohibited
value would be written into a table nobody thinks of as holding data. Every payload is
therefore passed through the privacy redactor before it leaves this module. The
redaction is unconditional: it does not depend on the entity, on the caller remembering,
or on the belief that synthetic data cannot contain a real e-mail address.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Final

from arpi.constants import REDACTED_PLACEHOLDER

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Mapping

# ---------------------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------------------


def _fallback_redact_payload(mapping: Mapping[str, Any]) -> dict[str, Any]:
    """Mask prohibited values without ``arpi.validation.privacy``.

    Agent B owns the real implementation. This stand-in exists so that the rejected-record
    path cannot silently become the one place a prohibited value is persisted merely
    because a module failed to import. It **fails closed**: anything it cannot positively
    recognise as a safe column name is redacted.

    Args:
        mapping: The payload about to be persisted.

    Returns:
        A new dictionary in which every unrecognised key maps to the redaction
        placeholder.
    """
    return dict.fromkeys(mapping, REDACTED_PLACEHOLDER)


try:
    from arpi.validation.privacy import redact_payload as _redact_payload
except ImportError:  # pragma: no cover - exercised only if the privacy module is absent
    _redact_payload = _fallback_redact_payload


def redact_payload(mapping: Mapping[str, Any]) -> dict[str, Any]:
    """Return a copy of ``mapping`` safe to persist to ``audit.rejected_record``.

    Delegates to :func:`arpi.validation.privacy.redact_payload`, which is the single
    authority on which column names are prohibited. If that module is ever unavailable
    the fail-closed stand-in above redacts everything rather than passing values through.

    Args:
        mapping: The raw source row as read from the staging rejected view.

    Returns:
        The same keys, with prohibited values replaced by the redaction placeholder.
        Keys are preserved so a reviewer can still see the *shape* of the offending row.
    """
    return _redact_payload(mapping)


# ---------------------------------------------------------------------------------------
# Rejection codes
# ---------------------------------------------------------------------------------------

#: Lineage columns of the raw layer, which are never business data and never redacted.
LINEAGE_KEYS: Final[frozenset[str]] = frozenset(
    {"raw_record_id", "load_batch_id", "source_file_name", "source_row_number", "ingested_at"}
)

#: Key under which the rejected payload carries its own lineage.
#:
#: ``audit.rejected_record`` has columns for the run, the entity, the code, the reason and
#: the payload -- but none for the source row number or for the rejection category, both
#: of which the ingestion contract requires. Rather than alter a table another agent owns,
#: they are carried inside the JSON payload under this reserved key. The nesting keeps
#: them out of the business-column namespace, so a source column called ``lineage`` could
#: never collide with them.
LINEAGE_PAYLOAD_KEY: Final = "_lineage"

#: Upper bound on how many rejected payloads a single run persists.
#:
#: The counts are always complete -- ``audit.pipeline_run_row_count`` records every
#: rejection. This caps only how many individual payloads are written, so a catastrophic
#: generator defect cannot turn one run into a million audit rows. In practice the cap is
#: never reached: ``validation.max_rejected_record_ratio`` is 0.0, so a single rejection
#: already fails the run.
MAX_PERSISTED_REJECTED_RECORDS: Final = 1000

CATEGORY_STRUCTURAL: Final = "structural"
CATEGORY_COMPLETENESS: Final = "completeness"
CATEGORY_UNIQUENESS: Final = "uniqueness"
CATEGORY_REFERENTIAL: Final = "referential"
CATEGORY_BUSINESS_RULE: Final = "business_rule"

#: The enumerated rejection vocabulary, mapped to its canonical validation category.
#:
#: These identifiers are **not** invented here. They are the register already published in
#: ``docs/source-to-target/README.md`` section 4, which the Phase 0 mapping documents
#: reference. Introducing a second vocabulary -- ``REJ-CAST-001`` beside ``REJ-TYPE-001``,
#: ``REJ-DUPKEY-001`` beside ``REJ-KEY-001`` -- is exactly the drift that ``DOC-24``
#: records for ``check_category``, so the existing spellings are reused verbatim. The
#: staging rejected views emit the same strings, so one rejection has one identity in both
#: implementations.
#:
#: Categories come from the canonical seven-value vocabulary in ``arpi.constants``.
REJECTION_CATEGORIES: Final[dict[str, str]] = {
    # The source row could not be parsed at all.
    "REJ-PARSE-001": CATEGORY_STRUCTURAL,
    # The source file's columns do not match the declared schema.
    "REJ-SCHEMA-001": CATEGORY_STRUCTURAL,
    # A value is present but cannot be represented in its governed type.
    "REJ-TYPE-001": CATEGORY_STRUCTURAL,
    # A required value is absent.
    "REJ-NULL-001": CATEGORY_COMPLETENESS,
    # A value is outside its enumerated domain or its permitted numeric range.
    "REJ-DOMAIN-001": CATEGORY_BUSINESS_RULE,
    # A duplicate natural key within one load batch.
    "REJ-KEY-001": CATEGORY_UNIQUENESS,
    # A foreign key did not resolve.
    "REJ-REF-001": CATEGORY_REFERENTIAL,
    # A business rule spanning several columns was violated.
    "REJ-RULE-001": CATEGORY_BUSINESS_RULE,
}

#: The one code that means "this row was a duplicate", as opposed to "this row was bad".
#:
#: The five-layer chain reports deduplication and rejection separately, because they are
#: different findings: a duplicate natural key means the source repeated itself, while a
#: type or domain failure means the source was wrong. Both are written to
#: ``audit.rejected_record`` -- neither is discarded -- but they are counted apart.
REJECTION_CODE_DUPLICATE_KEY: Final = "REJ-KEY-001"


def category_for(rejection_code: str) -> str:
    """Return the canonical validation category for a rejection code.

    Args:
        rejection_code: A ``REJ-*`` identifier.

    Returns:
        The canonical category, or ``structural`` for an unrecognised code -- an unknown
        code is itself a structural defect in the emitter, and defaulting to a real
        category keeps the audit row insertable rather than failing the whole load.
    """
    return REJECTION_CATEGORIES.get(rejection_code, CATEGORY_STRUCTURAL)


def build_rejected_payload(
    record_payload: Mapping[str, Any] | None,
    *,
    rejection_category: str,
    source_row_number: int | None,
    load_batch_id: str | None,
    source_file_name: str | None,
) -> str:
    """Render one rejected row as redacted JSON, ready for ``audit.rejected_record``.

    Args:
        record_payload: The untyped source row as returned by the staging rejected view.
        rejection_category: Canonical validation category of the rejection.
        source_row_number: One-based data-row number in the source file.
        load_batch_id: Batch the rejected row belongs to.
        source_file_name: File the rejected row came from.

    Returns:
        A JSON document string. Business values are redacted where their column name is
        prohibited; lineage is nested under :data:`LINEAGE_PAYLOAD_KEY` because
        ``audit.rejected_record`` has no column for the row number or the category.
    """
    business = {
        key: value for key, value in (record_payload or {}).items() if key not in LINEAGE_KEYS
    }
    safe = redact_payload(business)
    safe[LINEAGE_PAYLOAD_KEY] = {
        "rejection_category": rejection_category,
        "source_row_number": source_row_number,
        "load_batch_id": load_batch_id,
        "source_file_name": source_file_name,
    }
    return json.dumps(safe, default=str, sort_keys=True)
