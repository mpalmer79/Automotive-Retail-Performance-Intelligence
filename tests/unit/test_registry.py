"""The canonical DQ check registry."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from arpi.config import ArpiConfig
from arpi.constants import (
    CHECK_CATEGORIES,
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_UNIQUENESS,
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
)
from arpi.exceptions import ValidationError
from arpi.generation.base import GeneratedDataset
from arpi.validation.datasets import validate_foundation_datasets
from arpi.validation.registry import (
    CHECK_ID_PATTERN,
    CHECK_REGISTRY,
    CROSS_ENTITY,
    RESERVED_CHECK_PREFIXES,
    CheckDefinition,
    CheckLayer,
    DuplicateCheckIdError,
    UnregisteredCheckError,
    expected_check_ids,
    iter_checks_for_entity,
    register_check,
    register_checks,
    require_registered,
)
from arpi.validation.results import CheckSeverity

#: Prefix reserved for Phase 1 vehicle checks; nothing registers it yet, so a test may.
_SPARE_ID = "DQ-VEH-999"


def _definition(check_id: str = _SPARE_ID, **overrides: object) -> CheckDefinition:
    fields: dict[str, object] = {
        "check_id": check_id,
        "check_name": "a probe check",
        "category": CHECK_CATEGORY_UNIQUENESS,
        "severity": CheckSeverity.CRITICAL,
        "layer": CheckLayer.PYTHON,
        "entity": "dim_vehicle",
        "description": "Exists only to exercise the registrar's own rules.",
        "applies_to": ("warehouse.dim_vehicle",),
    }
    fields.update(overrides)
    return CheckDefinition(**fields)  # type: ignore[arg-type]


@pytest.fixture()
def temporary_registration() -> Iterator[None]:
    """Undo anything a test registers, so the global registry stays as it was.

    ``CHECK_REGISTRY`` is a live read-only view of a module-level dictionary, which is
    what lets a test add to it and then clean up without reimporting the module.
    """
    from arpi.validation import registry

    before = frozenset(CHECK_REGISTRY)
    yield
    for check_id in set(CHECK_REGISTRY) - before:
        del registry._REGISTRY[check_id]


# --------------------------------------------------------------------------------------
# Registry contents
# --------------------------------------------------------------------------------------


def test_the_registry_is_not_empty() -> None:
    assert len(CHECK_REGISTRY) >= 22


def test_no_duplicate_identifiers() -> None:
    """A mapping cannot hold a duplicate key; this asserts the invariant explicitly."""
    ids = [definition.check_id for definition in CHECK_REGISTRY.values()]
    assert len(ids) == len(set(ids))
    assert all(key == definition.check_id for key, definition in CHECK_REGISTRY.items())


@pytest.mark.parametrize("check_id", sorted(CHECK_REGISTRY))
def test_every_identifier_matches_the_pattern(check_id: str) -> None:
    assert CHECK_ID_PATTERN.match(check_id), f"{check_id} is not a well-formed DQ identifier"


@pytest.mark.parametrize("check_id", sorted(CHECK_REGISTRY))
def test_every_category_is_canonical(check_id: str) -> None:
    assert CHECK_REGISTRY[check_id].category in CHECK_CATEGORIES


@pytest.mark.parametrize("check_id", sorted(CHECK_REGISTRY))
def test_every_prefix_is_reserved(check_id: str) -> None:
    assert CHECK_REGISTRY[check_id].prefix in RESERVED_CHECK_PREFIXES


@pytest.mark.parametrize("check_id", sorted(CHECK_REGISTRY))
def test_every_check_says_what_it_is_and_why(check_id: str) -> None:
    definition = CHECK_REGISTRY[check_id]
    assert definition.check_name.strip()
    assert definition.description.strip()
    assert definition.applies_to


def test_every_contract_family_has_a_reserved_prefix() -> None:
    """Cross-agent contract section 3: every Phase 1 family is reserved up front."""
    expected = {
        "DATE",
        "DLR",
        "GEN",
        "VMD",
        "VEH",
        "EMP",
        "CUS",
        "ACQ",
        "SLE",
        "INV",
        "LDS",
        "LED",
        "APT",
        "CMP",
        "MKT",
        "REF",
        "AUD",
        "ING",
    }
    assert expected <= set(RESERVED_CHECK_PREFIXES)


def test_the_sql_only_families_are_registered() -> None:
    """DOC-21: DQ-REF-* and DQ-AUD-* used to appear in no shared register at all."""
    for check_id in [f"DQ-REF-{n:03d}" for n in range(1, 6)]:
        assert CHECK_REGISTRY[check_id].layer is CheckLayer.SQL
    for check_id in [f"DQ-AUD-{n:03d}" for n in range(1, 6)]:
        assert CHECK_REGISTRY[check_id].layer is CheckLayer.SQL


def test_the_deliberate_overlap_is_recorded() -> None:
    """DOC-21: the DQ-REF-003 / DQ-DATE-002 relationship is stated, not left implicit."""
    assert "DQ-REF-003" in CHECK_REGISTRY["DQ-DATE-002"].overlaps_with
    assert "DQ-DATE-002" in CHECK_REGISTRY["DQ-REF-003"].overlaps_with


# --------------------------------------------------------------------------------------
# Lookup helpers
# --------------------------------------------------------------------------------------


def test_iter_checks_for_entity_includes_cross_entity_checks() -> None:
    ids = [definition.check_id for definition in iter_checks_for_entity(ENTITY_DIM_DATE)]
    assert "DQ-DATE-001" in ids
    assert "DQ-REF-001" in ids, "the SQL grain check is a dim_date check too"
    assert "DQ-GEN-001" in ids, "a cross-entity check applies to every entity"
    assert "DQ-DLR-001" not in ids
    assert ids == sorted(ids)


def test_iter_checks_for_an_unknown_entity_returns_only_cross_entity_checks() -> None:
    ids = [definition.check_id for definition in iter_checks_for_entity("fact_nothing")]
    assert ids == sorted(
        check_id
        for check_id, definition in CHECK_REGISTRY.items()
        if definition.entity == CROSS_ENTITY
    )


def test_require_registered_returns_the_definition() -> None:
    assert require_registered("DQ-DATE-001").entity == ENTITY_DIM_DATE


def test_require_registered_rejects_an_unknown_id() -> None:
    with pytest.raises(UnregisteredCheckError, match="DQ-ZZZ-001"):
        require_registered("DQ-ZZZ-001")


def test_expected_check_ids_filters_by_layer() -> None:
    python_side = expected_check_ids()
    assert "DQ-GEN-001" in python_side
    assert "DQ-DATE-001" in python_side, "a `both` check is evaluated in Python too"
    assert "DQ-AUD-001" not in python_side

    sql_side = expected_check_ids(layers=(CheckLayer.SQL,))
    assert "DQ-AUD-001" in sql_side
    assert "DQ-GEN-001" not in sql_side


def test_expected_check_ids_filters_by_entity() -> None:
    ids = expected_check_ids(entities=(ENTITY_DIM_DATE,))
    assert "DQ-DATE-001" in ids
    assert "DQ-GEN-001" in ids, "cross-entity checks always apply"
    assert "DQ-DLR-001" not in ids


# --------------------------------------------------------------------------------------
# Registration rules
# --------------------------------------------------------------------------------------


def test_a_check_can_be_registered_from_another_module(temporary_registration: None) -> None:
    definition = register_check(_definition())
    assert CHECK_REGISTRY[_SPARE_ID] is definition
    assert require_registered(_SPARE_ID).entity == "dim_vehicle"


def test_registering_several_checks_at_once(temporary_registration: None) -> None:
    registered = register_checks(
        (_definition("DQ-VEH-997"), _definition("DQ-VEH-998")),
    )
    assert [definition.check_id for definition in registered] == ["DQ-VEH-997", "DQ-VEH-998"]
    assert "DQ-VEH-998" in CHECK_REGISTRY


def test_registering_a_duplicate_identifier_raises(temporary_registration: None) -> None:
    register_check(_definition())
    with pytest.raises(DuplicateCheckIdError, match=_SPARE_ID):
        register_check(_definition(check_name="a colliding check"))


def test_registering_an_already_registered_phase_zero_id_raises() -> None:
    with pytest.raises(DuplicateCheckIdError):
        register_check(_definition("DQ-DATE-001", entity=ENTITY_DIM_DATE))


@pytest.mark.parametrize(
    "check_id",
    ["DQ-VE-001", "DQ-VEHIC-001", "dq-veh-001", "DQ-VEH-1", "DQ-VEH-0001", "VEH-001"],
)
def test_a_malformed_identifier_is_refused(check_id: str) -> None:
    with pytest.raises(ValidationError, match="does not match"):
        register_check(_definition(check_id))


def test_an_unreserved_prefix_is_refused() -> None:
    with pytest.raises(ValidationError, match="unreserved family prefix"):
        register_check(_definition("DQ-ZZZ-001"))


def test_a_non_canonical_category_is_refused() -> None:
    with pytest.raises(ValidationError, match="canonical categories"):
        register_check(_definition(category="determinism"))


@pytest.mark.parametrize("field_name", ["check_name", "entity", "description"])
def test_an_empty_required_field_is_refused(field_name: str) -> None:
    with pytest.raises(ValidationError, match=f"empty {field_name}"):
        register_check(_definition(**{field_name: "   "}))


def test_a_check_that_applies_to_nothing_is_refused() -> None:
    with pytest.raises(ValidationError, match="applies_to"):
        register_check(_definition(applies_to=()))


# --------------------------------------------------------------------------------------
# Runtime agreement
# --------------------------------------------------------------------------------------


def test_every_check_emitted_at_runtime_is_registered(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """The register is only canonical if nothing escapes it."""
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    assert report.results, "the suite produced no results at all"
    for result in report.results:
        definition = require_registered(result.check_id)
        assert result.check_category == definition.category, (
            f"{result.check_id} emitted category {result.check_category!r} but is "
            f"registered as {definition.category!r}"
        )
        assert result.severity == definition.severity, (
            f"{result.check_id} emitted severity {result.severity!r} but is registered "
            f"as {definition.severity!r}"
        )


def test_a_run_records_every_registered_python_layer_check(
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """DATA_DICTIONARY.md 21.3: an absent check reads exactly like a passing one."""
    report = validate_foundation_datasets(date_dataset, dealership_dataset, test_config)
    produced = {result.check_id for result in report.results}
    expected = set(expected_check_ids(entities=(ENTITY_DIM_DATE, ENTITY_DIM_DEALERSHIP)))
    assert expected <= produced, f"no result recorded for {sorted(expected - produced)}"


def test_the_sql_categories_registered_here_match_the_sql_files() -> None:
    """The category a SQL view emits is the category the registry claims for that id.

    Read from the ``.sql`` text rather than from a database, so the agreement is
    asserted even where no PostgreSQL server is available.
    """
    import re
    from pathlib import Path

    literal = re.compile(r"^'(DQ-[A-Z]{3,4}-\d{3})'::text")
    sql_dir = Path(__file__).resolve().parents[2] / "sql" / "08_validation"
    emitted: dict[str, str] = {}
    for path in sorted(sql_dir.glob("*.sql")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            match = literal.match(line.strip())
            if match is None:
                continue
            # The uniform result shape is check_id, check_name, check_category, ...
            category_line = lines[index + 2].strip()
            emitted[match.group(1)] = category_line.split("'")[1]

    assert emitted, "no SQL check literals were found; the parser needs updating"
    for check_id, category in sorted(emitted.items()):
        assert category in CHECK_CATEGORIES, f"{check_id} emits non-canonical {category!r}"
        assert category == CHECK_REGISTRY[check_id].category, (
            f"{check_id} emits {category!r} in SQL but is registered as "
            f"{CHECK_REGISTRY[check_id].category!r}"
        )
