"""SHA-256 helpers used for SCD Type 2 attribute hashes and content digests."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from arpi.constants import CSV_BOOLEAN_FALSE, CSV_BOOLEAN_TRUE, ISO_DATE_FORMAT

#: Separator used when serialising tracked attributes before hashing.
HASH_FIELD_SEPARATOR = "|"

#: Serialisation of a ``None`` attribute inside a hash payload.
HASH_NULL_TOKEN = ""


def canonical_token(value: Any) -> str:
    """Serialise a single attribute value into its canonical hash/CSV token.

    The rules are identical to the CSV dialect so that a hash computed in Python and a
    hash recomputed from the committed CSV agree:

    * ``None`` becomes the empty string.
    * ``bool`` becomes ``"true"`` / ``"false"`` (checked before ``int``, since ``bool``
      is a subclass of ``int``).
    * :class:`datetime.date` and :class:`datetime.datetime` become ``YYYY-MM-DD``.
    * everything else becomes ``str(value)``.

    Args:
        value: Attribute value to serialise.

    Returns:
        The canonical string token for ``value``.
    """
    if value is None:
        return HASH_NULL_TOKEN
    if isinstance(value, bool):
        return CSV_BOOLEAN_TRUE if value else CSV_BOOLEAN_FALSE
    if isinstance(value, datetime):
        return value.date().strftime(ISO_DATE_FORMAT)
    if isinstance(value, date):
        return value.strftime(ISO_DATE_FORMAT)
    return str(value)


def sha256_hex(payload: bytes) -> str:
    """Return the lowercase SHA-256 hex digest of ``payload``.

    Args:
        payload: Raw bytes to digest.

    Returns:
        A 64-character lowercase hexadecimal digest.
    """
    return hashlib.sha256(payload).hexdigest()


def content_digest(payload: bytes) -> str:
    """Return the manifest ``content_digest`` for a generated file's bytes.

    Args:
        payload: Exact bytes that were written to disk.

    Returns:
        A 64-character lowercase SHA-256 hexadecimal digest.
    """
    return sha256_hex(payload)


def hash_attributes(values: Sequence[Any]) -> str:
    """Hash an ordered sequence of tracked attributes.

    Each value is serialised with :func:`canonical_token`, joined with ``"|"`` and
    encoded as UTF-8 before hashing. The order of ``values`` is significant.

    Args:
        values: Ordered attribute values, e.g. the SCD Type 2 tracked columns.

    Returns:
        A 64-character lowercase SHA-256 hexadecimal digest.
    """
    payload = HASH_FIELD_SEPARATOR.join(canonical_token(value) for value in values)
    return sha256_hex(payload.encode("utf-8"))
