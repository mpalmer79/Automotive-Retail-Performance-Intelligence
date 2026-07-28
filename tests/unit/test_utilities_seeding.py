"""Deterministic seed derivation."""

from __future__ import annotations

import pytest

from arpi.exceptions import ValidationError
from arpi.utilities.seeding import derive_seed, rng_for

# Golden values pin the derivation. Changing them changes every generated dataset,
# so a diff here must be a deliberate, documented decision.
GOLDEN = {
    (20250701, "dim_date"): 817584133849618377,
    (20250701, "dim_dealership"): 9753213130882621592,
    (20250701, "fact_vehicle_sale"): 1099056741522114820,
    (424242, "dim_date"): 1422492888417982282,
    (424242, "dim_dealership"): 5731083937579275130,
}


@pytest.mark.parametrize(("inputs", "expected"), sorted(GOLDEN.items()))
def test_derive_seed_golden_values(inputs: tuple[int, str], expected: int) -> None:
    assert derive_seed(*inputs) == expected


def test_derive_seed_is_stable_across_calls() -> None:
    assert derive_seed(7, "alpha") == derive_seed(7, "alpha")


def test_derive_seed_fits_in_sixty_four_bits() -> None:
    assert 0 <= derive_seed(20250701, "dim_date") < 2**64


def test_namespaces_are_independent() -> None:
    seeds = {derive_seed(20250701, name) for name in ("a", "b", "c", "d", "e")}
    assert len(seeds) == 5


def test_a_new_namespace_does_not_perturb_existing_ones() -> None:
    before = derive_seed(20250701, "dim_date")
    _ = derive_seed(20250701, "fact_lead_activity")
    assert derive_seed(20250701, "dim_date") == before


def test_master_seed_changes_every_namespace() -> None:
    assert derive_seed(1, "dim_date") != derive_seed(2, "dim_date")


def test_rng_for_is_reproducible() -> None:
    first = [rng_for(20250701, "demo").random() for _ in range(3)]
    second = [rng_for(20250701, "demo").random() for _ in range(3)]
    assert first == second


def test_rng_for_differs_between_namespaces() -> None:
    assert rng_for(20250701, "a").random() != rng_for(20250701, "b").random()


def test_negative_master_seed_is_rejected() -> None:
    with pytest.raises(ValidationError, match="non-negative"):
        derive_seed(-1, "dim_date")


@pytest.mark.parametrize("namespace", ["", "   "])
def test_blank_namespace_is_rejected(namespace: str) -> None:
    with pytest.raises(ValidationError, match="non-empty"):
        derive_seed(1, namespace)
