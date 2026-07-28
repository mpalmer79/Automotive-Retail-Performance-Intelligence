"""Canonical serialisation and SHA-256 helpers."""

from __future__ import annotations

import hashlib
from datetime import date, datetime

import pytest

from arpi.utilities.hashing import (
    HASH_FIELD_SEPARATOR,
    canonical_token,
    content_digest,
    hash_attributes,
    sha256_hex,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        (True, "true"),
        (False, "false"),
        (date(2017, 3, 13), "2017-03-13"),
        (datetime(2017, 3, 13, 14, 30), "2017-03-13"),
        ("Granite Subaru", "Granite Subaru"),
        (42, "42"),
    ],
)
def test_canonical_token(value: object, expected: str) -> None:
    assert canonical_token(value) == expected


def test_booleans_are_checked_before_integers() -> None:
    assert canonical_token(True) != canonical_token(1)


def test_sha256_hex_matches_the_standard_library() -> None:
    assert sha256_hex(b"arpi") == hashlib.sha256(b"arpi").hexdigest()


def test_content_digest_is_sha256_of_the_bytes() -> None:
    payload = b"date_key\n20250701\n"
    assert content_digest(payload) == hashlib.sha256(payload).hexdigest()


def test_hash_attributes_uses_the_documented_serialisation() -> None:
    values = ["Store", None, date(2020, 1, 2), True]
    expected_payload = HASH_FIELD_SEPARATOR.join(["Store", "", "2020-01-02", "true"])
    assert hash_attributes(values) == sha256_hex(expected_payload.encode("utf-8"))


def test_hash_attributes_is_order_sensitive() -> None:
    assert hash_attributes(["a", "b"]) != hash_attributes(["b", "a"])


def test_hash_attributes_is_stable() -> None:
    assert hash_attributes(["a", 1, None]) == hash_attributes(["a", 1, None])


def test_hash_attributes_returns_sixty_four_hex_characters() -> None:
    digest = hash_attributes(["a"])
    assert len(digest) == 64
    assert digest == digest.lower()
    assert set(digest) <= set("0123456789abcdef")
