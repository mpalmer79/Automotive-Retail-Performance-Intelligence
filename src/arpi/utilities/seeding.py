"""Deterministic seed derivation.

Reproducibility guarantee
-------------------------
Every stochastic component draws from its own :class:`random.Random`, seeded by
:func:`derive_seed` from the configured master seed **and a stable namespace string**.

Because the namespace is hashed rather than consumed from a shared stream, adding,
removing or reordering entities never perturbs the numbers drawn by any other entity.
Regenerating the same entity with the same master seed therefore always produces
byte-identical output, even after the generator suite grows.

The derivation is ``int.from_bytes(sha256(f"{master_seed}:{namespace}").digest()[:8], "big")``.
SHA-256 is used because it is stable across Python versions and platforms; the builtin
:func:`hash` is not (it is salted per process).
"""

from __future__ import annotations

import hashlib
import random

from arpi.exceptions import ValidationError

#: Number of digest bytes folded into the derived seed (64 bits).
SEED_BYTE_WIDTH = 8


def derive_seed(master_seed: int, namespace: str) -> int:
    """Derive a stable 64-bit sub-seed for a named component.

    Args:
        master_seed: Non-negative master seed from ``ArpiConfig.random_seed``.
        namespace: Stable identifier for the component, e.g. ``"dim_dealership"``.

    Returns:
        A non-negative integer in ``[0, 2**64)``, stable across processes,
        platforms and Python versions.

    Raises:
        ValidationError: If ``master_seed`` is negative or ``namespace`` is blank.
    """
    if master_seed < 0:
        raise ValidationError(
            f"master_seed must be a non-negative integer, got {master_seed}.",
            field="master_seed",
        )
    if not namespace or not namespace.strip():
        raise ValidationError(
            "namespace must be a non-empty identifier so seeds stay stable across releases.",
            field="namespace",
        )
    digest = hashlib.sha256(f"{master_seed}:{namespace}".encode()).digest()
    return int.from_bytes(digest[:SEED_BYTE_WIDTH], "big")


def rng_for(master_seed: int, namespace: str) -> random.Random:
    """Build a dedicated pseudo-random generator for a named component.

    Args:
        master_seed: Non-negative master seed from ``ArpiConfig.random_seed``.
        namespace: Stable identifier for the component.

    Returns:
        A :class:`random.Random` seeded with :func:`derive_seed`.
    """
    return random.Random(derive_seed(master_seed, namespace))
