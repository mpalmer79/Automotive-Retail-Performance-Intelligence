r"""The canonical registry of ARPI data-quality check identifiers.

Every ``DQ-*`` identifier the platform can emit is declared here exactly once, whether it
is evaluated in pandas, in SQL, or in both. Before this module existed the register was
split across ``src/arpi/constants.py``, ``sql/08_validation/`` and ``DATA_DICTIONARY.md``
§21.2, and the two SQL-only families (``DQ-REF-*`` and ``DQ-AUD-*``) appeared in none of
the shared lists -- the gap recorded as ``DOC-21``. A register that is incomplete stops
being a register, so there is now one list and one authority.

Registering a check from your own module
========================================
**You do not need to edit this file.** Reserve nothing, ask nobody: your family's prefix
is already reserved in :data:`RESERVED_CHECK_PREFIXES`, and you register your checks from
wherever they are implemented. Call this at import time of the module that owns the
checks -- typically right below the ``CHECK_*`` id constants::

    from arpi.constants import CHECK_CATEGORY_BUSINESS_RULE
    from arpi.validation.registry import (
        CheckDefinition,
        CheckLayer,
        register_checks,
    )
    from arpi.validation.results import CheckSeverity

    register_checks(
        (
            CheckDefinition(
                check_id="DQ-VEH-001",
                check_name="dim_vehicle.synthetic_vin is unique",
                category=CHECK_CATEGORY_UNIQUENESS,
                severity=CheckSeverity.CRITICAL,
                layer=CheckLayer.BOTH,
                entity="dim_vehicle",
                description=("Two vehicles sharing a VIN would double-count every unit metric."),
                applies_to=("warehouse.dim_vehicle",),
            ),
        )
    )

Rules the registrar enforces, so that a mistake fails loudly at import time:

* ``check_id`` must match ``^DQ-[A-Z]{3,4}-\\d{3}$``.
* Its prefix must be one of :data:`RESERVED_CHECK_PREFIXES`.
* ``category`` must be one of the seven in :data:`arpi.constants.CHECK_CATEGORIES`.
* An identifier may be registered **once**. A second registration of the same id raises
  :class:`DuplicateCheckIdError` rather than quietly replacing the first -- two agents
  cannot silently collide on ``DQ-INV-001``.
* ``check_name``, ``entity`` and ``description`` must be non-empty, and ``applies_to``
  must name at least one object.

Because registration happens at import time, a check is only in
:data:`CHECK_REGISTRY` once its module has been imported. Import your validation module
from your package's ``__init__`` (or from :mod:`arpi.validation.datasets`) so that the
registry is complete whenever the pipeline runs.

Reading the registry
====================
* :data:`CHECK_REGISTRY` -- read-only mapping of ``check_id`` to
  :class:`CheckDefinition`, live rather than a snapshot.
* :func:`iter_checks_for_entity` -- every check for one entity, including the
  cross-entity ones.
* :func:`expected_check_ids` -- the ids a run *must* produce a result for, filtered by
  implementation layer. Used to prove a run's result set is complete rather than
  silently partial.
* :func:`require_registered` -- assert that an id is known, and get its definition.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Final

from arpi.constants import (
    CHECK_CATEGORIES,
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_REPRODUCIBILITY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    CHECK_DATE_CONTIGUOUS_RANGE,
    CHECK_DATE_KEY_MATCHES_FULL_DATE,
    CHECK_DATE_NO_NULL_REQUIRED,
    CHECK_DATE_SELLING_DAY_RATIO,
    CHECK_DATE_UNIQUE_KEY,
    CHECK_DEALERSHIP_FRANCHISE_BRAND,
    CHECK_DEALERSHIP_NO_PROHIBITED_PII,
    CHECK_DEALERSHIP_STORE_COUNT,
    CHECK_DEALERSHIP_UNIQUE_ID_CURRENT,
    CHECK_DEALERSHIP_UNIQUE_KEY,
    CHECK_GENERATION_DETERMINISM_DIGEST,
    CHECK_GENERATION_SCHEMA_MATCHES,
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
)
from arpi.exceptions import ValidationError
from arpi.validation.results import CheckSeverity

__all__ = [
    "CHECK_ID_PATTERN",
    "CHECK_REGISTRY",
    "CROSS_ENTITY",
    "RESERVED_CHECK_PREFIXES",
    "CheckDefinition",
    "CheckLayer",
    "DuplicateCheckIdError",
    "UnregisteredCheckError",
    "expected_check_ids",
    "iter_checks_for_entity",
    "register_check",
    "register_checks",
    "require_registered",
]

#: Every check identifier must match this. Three or four letters keeps the families
#: readable (``DATE``, ``DLR``, ``GEN``) and the three-digit ordinal keeps them sortable.
CHECK_ID_PATTERN: Final = re.compile(r"^DQ-[A-Z]{3,4}-\d{3}$")

#: ``entity`` value meaning "this check is not tied to a single entity".
CROSS_ENTITY: Final = "*"


class CheckLayer(StrEnum):
    """Which implementation evaluates a check.

    ``both`` means the identifier has a pandas implementation *and* a SQL implementation
    that assert the same rule. Agreement between two independent implementations of one
    identifier is itself evidence, which is why the duplication is deliberate.
    """

    PYTHON = "python"
    SQL = "sql"
    BOTH = "both"


#: Check-id prefix to the entity or area that owns it.
#:
#: A prefix is reserved as soon as it appears here, whether or not any check using it has
#: been implemented yet. Reserving up front is what stops two agents building Phase 1
#: entities in parallel from both claiming ``DQ-INV-001``.
RESERVED_CHECK_PREFIXES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "DATE": "dim_date",
        "DLR": "dim_dealership",
        "GEN": "cross-entity generation (schema conformance, determinism digest)",
        "VMD": "dim_vehicle_model",
        "VEH": "dim_vehicle",
        "EMP": "dim_employee",
        "CUS": "dim_customer",
        "ACQ": "acquisition_event (inventory acquisition source entity)",
        "SLE": "fact_vehicle_sale",
        "INV": "fact_vehicle_inventory_snapshot",
        "LDS": "dim_lead_source",
        "LED": "fact_lead",
        "APT": "fact_appointment",
        "CMP": "dim_marketing_campaign",
        "MKT": "fact_marketing_spend",
        "TGT": "fact_sales_target (targets and selling-day pace)",
        "FPD": "dim_finance_product (the governed F&I product catalogue)",
        "LND": "dim_lender (the fictional lender catalogue)",
        "FPS": "fact_finance_product_sale (one row per product sold on a deal)",
        "FPA": "fact_finance_product_adjustment (cancellation, chargeback, reinstatement)",
        "REF": "cross-object referential and grain integrity (SQL)",
        "AUD": "audit-layer integrity (SQL)",
        "ING": "ingestion and the row-count chain",
        # The inventory-accounting control domain (DASH.8). Three families because three
        # entities: the stock-level schedule, the selected control catalogue, and the
        # control balances. Kept apart so a check cannot be written about "accounting"
        # in general and end up applying to none of them precisely.
        "IAS": "fact_inventory_accounting_snapshot (the stock-level accounting schedule)",
        "GLA": "dim_gl_account (the selected synthetic control-account catalogue)",
        "GLB": "fact_gl_control_balance (selected control-account balances)",
    }
)


class DuplicateCheckIdError(ValidationError):
    """Raised when a check identifier is registered more than once."""

    def __init__(self, check_id: str, existing: CheckDefinition) -> None:
        """Initialise the error.

        Args:
            check_id: The identifier that was registered twice.
            existing: The definition already holding that identifier.
        """
        super().__init__(
            f"Check id {check_id!r} is already registered by {existing.entity} "
            f"({existing.check_name!r}). Every DQ identifier must be unique across the "
            f"whole platform; pick the next free ordinal in the "
            f"{check_id.split('-')[1]} family.",
            field="check_id",
            check_id=check_id,
        )
        self.check_id = check_id
        self.existing = existing


class UnregisteredCheckError(ValidationError):
    """Raised when a check identifier is used but was never registered."""

    def __init__(self, check_id: str) -> None:
        """Initialise the error.

        Args:
            check_id: The unknown identifier.
        """
        super().__init__(
            f"Check id {check_id!r} is not in CHECK_REGISTRY. Register it with "
            f"arpi.validation.registry.register_check() from the module that "
            f"implements it, so the shared register stays complete.",
            field="check_id",
            check_id=check_id,
        )
        self.check_id = check_id


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    """The declaration of one data-quality check.

    Attributes:
        check_id: Stable identifier matching :data:`CHECK_ID_PATTERN`, e.g.
            ``"DQ-DATE-001"``. Shared verbatim between Python and SQL.
        check_name: Short human-readable name, recorded on every result row.
        category: One of the seven canonical
            :data:`~arpi.constants.CHECK_CATEGORIES`.
        severity: Severity of a failure. ``critical`` fails the run.
        layer: Which implementation evaluates the check.
        entity: The entity the check belongs to, or :data:`CROSS_ENTITY` when it is not
            tied to one.
        description: Why the check exists -- what goes wrong if it is not made.
        applies_to: The objects the check is evaluated against, e.g.
            ``("warehouse.dim_date",)``. ``("*",)`` means every generated entity.
        overlaps_with: Other identifiers that assert an overlapping property by a
            different method. Recorded deliberately: ``DQ-REF-003`` finds *where* dates
            are missing with a window function while ``DQ-DATE-002`` detects *that* they
            are missing by comparing a count against a span, and a reader deserves to
            know the duplication is intentional rather than accidental.
    """

    check_id: str
    check_name: str
    category: str
    severity: CheckSeverity
    layer: CheckLayer
    entity: str
    description: str
    applies_to: tuple[str, ...]
    overlaps_with: tuple[str, ...] = field(default=())

    @property
    def prefix(self) -> str:
        """The family prefix, e.g. ``"DATE"`` for ``"DQ-DATE-001"``."""
        return self.check_id.split("-")[1]


_REGISTRY: dict[str, CheckDefinition] = {}

#: Read-only, **live** view of every registered check, keyed by identifier.
#:
#: Live rather than a snapshot: a definition registered later by another module appears
#: here without this module being reloaded.
CHECK_REGISTRY: Final[Mapping[str, CheckDefinition]] = MappingProxyType(_REGISTRY)


def register_check(definition: CheckDefinition) -> CheckDefinition:
    """Add one check to the canonical registry.

    Args:
        definition: The check to register.

    Returns:
        The same definition, so a module-level constant can be assigned from the call.

    Raises:
        ValidationError: If the identifier is malformed, its prefix is not reserved, its
            category is not canonical, or a required field is empty.
        DuplicateCheckIdError: If the identifier is already registered.
    """
    check_id = definition.check_id
    if not CHECK_ID_PATTERN.match(check_id):
        raise ValidationError(
            f"Check id {check_id!r} does not match {CHECK_ID_PATTERN.pattern}. "
            f"Use DQ-<3 or 4 uppercase letters>-<3 digits>, e.g. DQ-VEH-001.",
            field="check_id",
        )

    prefix = definition.prefix
    if prefix not in RESERVED_CHECK_PREFIXES:
        raise ValidationError(
            f"Check id {check_id!r} uses the unreserved family prefix {prefix!r}. "
            f"Reserved prefixes are: {', '.join(sorted(RESERVED_CHECK_PREFIXES))}. "
            f"Add the prefix to RESERVED_CHECK_PREFIXES before using it, so two "
            f"entities cannot claim the same family.",
            field="check_id",
        )

    if definition.category not in CHECK_CATEGORIES:
        raise ValidationError(
            f"Check {check_id} declares category {definition.category!r}, which is not "
            f"one of the canonical categories: {', '.join(sorted(CHECK_CATEGORIES))}.",
            field="category",
        )

    for name in ("check_name", "entity", "description"):
        if not str(getattr(definition, name)).strip():
            raise ValidationError(
                f"Check {check_id} has an empty {name}. Every registered check must say "
                f"what it is and why it exists.",
                field=name,
            )

    if not definition.applies_to:
        raise ValidationError(
            f"Check {check_id} names no object in applies_to. A check that applies to "
            f"nothing cannot be evaluated.",
            field="applies_to",
        )

    existing = _REGISTRY.get(check_id)
    if existing is not None:
        raise DuplicateCheckIdError(check_id, existing)

    _REGISTRY[check_id] = definition
    return definition


def register_checks(definitions: Iterable[CheckDefinition]) -> tuple[CheckDefinition, ...]:
    """Add several checks to the canonical registry, in order.

    Args:
        definitions: The checks to register.

    Returns:
        The registered definitions, in the order given.

    Raises:
        ValidationError: If any definition is invalid.
        DuplicateCheckIdError: If any identifier is already registered.
    """
    return tuple(register_check(definition) for definition in definitions)


def require_registered(check_id: str) -> CheckDefinition:
    """Return the definition for ``check_id``, or fail.

    Args:
        check_id: The identifier to look up.

    Returns:
        The registered :class:`CheckDefinition`.

    Raises:
        UnregisteredCheckError: If the identifier is unknown.
    """
    definition = _REGISTRY.get(check_id)
    if definition is None:
        raise UnregisteredCheckError(check_id)
    return definition


def iter_checks_for_entity(entity: str) -> tuple[CheckDefinition, ...]:
    """Return every registered check that applies to one entity.

    Cross-entity checks -- those declaring :data:`CROSS_ENTITY` -- are included, because
    they genuinely do apply: ``DQ-GEN-001`` asserts the declared schema of *every*
    generated entity, including this one.

    Args:
        entity: Entity name, e.g. ``"dim_date"``.

    Returns:
        The matching definitions, ordered by identifier.
    """
    return tuple(
        definition
        for _, definition in sorted(_REGISTRY.items())
        if definition.entity in (entity, CROSS_ENTITY)
    )


def expected_check_ids(
    *,
    layers: Collection[CheckLayer] = (CheckLayer.PYTHON, CheckLayer.BOTH),
    entities: Collection[str] | None = None,
) -> tuple[str, ...]:
    """Return the identifiers a run must produce a result for.

    ``DATA_DICTIONARY.md`` §21.3 requires every registered check to produce a row on
    every run, including ``skipped`` rows: a check that produces no row is itself a
    defect, because a silently absent check is indistinguishable from a passing one.
    This function is the expectation that requirement is measured against.

    Args:
        layers: Which implementation layers to include. The default is the Python side,
            since the SQL checks are recorded by ``audit.fn_record_all_dq_checks``
            rather than by the pandas framework.
        entities: Restrict to these entities. Cross-entity checks are always included.
            ``None`` means every entity.

    Returns:
        The matching identifiers, sorted.
    """
    wanted = set(layers)
    return tuple(
        sorted(
            check_id
            for check_id, definition in _REGISTRY.items()
            if definition.layer in wanted
            and (
                entities is None
                or definition.entity in entities
                or definition.entity == CROSS_ENTITY
            )
        )
    )


# ---------------------------------------------------------------------------------------
# Phase 0 families: the checks that exist today.
#
# Phase 1 families (DQ-VMD, DQ-VEH, DQ-EMP, DQ-CUS, DQ-ACQ, DQ-SLE, DQ-INV, DQ-LDS,
# DQ-LED, DQ-APT, DQ-CMP, DQ-MKT, DQ-ING) have their prefixes reserved above and are
# registered by the modules that implement them, via register_checks(). Nothing below
# needs to change when they arrive. The same holds for the dashboard program's DQ-TGT
# family, registered by arpi.generation.sales_target.
# ---------------------------------------------------------------------------------------

_DIM_DATE_OBJECT: Final = "warehouse.dim_date"
_DIM_DEALERSHIP_OBJECT: Final = "warehouse.dim_dealership"

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_DATE_UNIQUE_KEY,
            check_name="dim_date.date_key is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DATE,
            description=(
                "A duplicated date_key would fan out every future fact joined to the "
                "calendar, silently multiplying every additive measure."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DATE_CONTIGUOUS_RANGE,
            check_name="dim_date covers the reporting window contiguously",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DATE,
            description=(
                "Detects that dates are missing by comparing the row count against the "
                "span of the reporting window. A gap drops every fact on the missing "
                "dates without any error being raised."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
            overlaps_with=("DQ-REF-003",),
        ),
        CheckDefinition(
            check_id=CHECK_DATE_KEY_MATCHES_FULL_DATE,
            check_name="dim_date.date_key encodes dim_date.full_date",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DATE,
            description=(
                "date_key must be the YYYYMMDD encoding of full_date. Every fact stores "
                "the key, so a key that does not encode its date misfiles the fact."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DATE_NO_NULL_REQUIRED,
            check_name="dim_date required columns are populated",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DATE,
            description=(
                "Every column except holiday_name is mandatory; holiday_name is NULL by "
                "design on a non-holiday."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DATE_SELLING_DAY_RATIO,
            check_name="dim_date selling-day ratio is within tolerance",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.WARNING,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DATE,
            description=(
                "A plausibility band rather than a hard rule: a calendar where almost "
                "every day is closed, or none is, indicates a holiday-rule defect. "
                "warning, because an unusual window is not by itself wrong."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DEALERSHIP_UNIQUE_KEY,
            check_name="dim_dealership.dealership_key is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DEALERSHIP,
            description="The surrogate key of an SCD Type 2 dimension identifies one version row.",
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DEALERSHIP_UNIQUE_ID_CURRENT,
            check_name="dim_dealership.dealership_id is unique among current rows",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DEALERSHIP,
            description=(
                "Exactly one live version per store. Two current rows would double every "
                "store-level total."
            ),
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DEALERSHIP_STORE_COUNT,
            check_name="dim_dealership current row count matches configuration",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DEALERSHIP,
            description=(
                "The fictional group has exactly generation.store_count stores. A "
                "generator that quietly produces a different number must fail."
            ),
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DEALERSHIP_NO_PROHIBITED_PII,
            check_name="dim_dealership declares no personal-data columns",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DEALERSHIP,
            description=(
                "The privacy tripwire in its per-entity form: a schema inspection, so it "
                "is meaningful even when the dimension is empty and is never skipped."
            ),
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_DEALERSHIP_FRANCHISE_BRAND,
            check_name="franchise stores declare a franchise brand",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.BOTH,
            entity=ENTITY_DIM_DEALERSHIP,
            description=(
                "A franchise store names its brand; an Independent Used store leaves it "
                "NULL. The rule that separates new-vehicle stores from the used-only one."
            ),
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id=CHECK_GENERATION_SCHEMA_MATCHES,
            check_name="generated schema matches the declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=CROSS_ENTITY,
            description=(
                "Columns, and their order, must match what the generator declares. "
                "Python-only by design: it inspects the in-memory frame against its "
                "declaration, which SQL cannot observe. One result per generated entity."
            ),
            applies_to=("*",),
        ),
        CheckDefinition(
            check_id=CHECK_GENERATION_DETERMINISM_DIGEST,
            check_name="determinism digest recorded for every generated entity",
            category=CHECK_CATEGORY_REPRODUCIBILITY,
            severity=CheckSeverity.INFO,
            layer=CheckLayer.PYTHON,
            entity=CROSS_ENTITY,
            description=(
                "Records the SHA-256 digest of each entity's canonical CSV rendering so "
                "a reviewer can recompute it. info, not a gate: it publishes evidence, "
                "it does not compare against a stored expectation."
            ),
            applies_to=("*",),
        ),
        CheckDefinition(
            check_id="DQ-REF-001",
            check_name="dim_date grain is unique on full_date",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity=ENTITY_DIM_DATE,
            description="The declared grain of the calendar: one row per calendar date.",
            applies_to=(_DIM_DATE_OBJECT,),
        ),
        CheckDefinition(
            check_id="DQ-REF-002",
            check_name="dim_dealership grain is unique on (dealership_id, effective_date)",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity=ENTITY_DIM_DEALERSHIP,
            description="The declared grain of an SCD Type 2 store dimension.",
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id="DQ-REF-003",
            check_name="dim_date has no gaps in its date sequence",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity=ENTITY_DIM_DATE,
            description=(
                "Finds *where* dates are missing using a window function, and reports "
                "the first gap so it can be fixed rather than merely noticed. The "
                "overlap with DQ-DATE-002 is deliberate: that check detects that dates "
                "are missing by comparing a count against a span, this one locates them."
            ),
            applies_to=(_DIM_DATE_OBJECT,),
            overlaps_with=(CHECK_DATE_CONTIGUOUS_RANGE,),
        ),
        CheckDefinition(
            check_id="DQ-REF-004",
            check_name="grain-enforcing constraints and indexes are present",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity=CROSS_ENTITY,
            description=(
                "A catalogue check. A migration that drops a constraint would otherwise "
                "leave every data check passing while the guarantee behind them is gone."
            ),
            applies_to=("warehouse", "audit"),
        ),
        CheckDefinition(
            check_id="DQ-REF-005",
            check_name="dim_dealership SCD Type 2 timeline is contiguous and non-overlapping",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity=ENTITY_DIM_DEALERSHIP,
            description=(
                "Each version starts the day after the previous one ended, and only "
                "current rows carry the 9999-12-31 sentinel."
            ),
            applies_to=(_DIM_DEALERSHIP_OBJECT,),
        ),
        CheckDefinition(
            check_id="DQ-AUD-001",
            check_name="every validation_result resolves to a pipeline_run",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity="validation_result",
            description=(
                "Deliberately duplicates a foreign key, so that a dropped constraint is "
                "detected rather than assumed absent."
            ),
            applies_to=("audit.validation_result",),
        ),
        CheckDefinition(
            check_id="DQ-AUD-002",
            check_name="every rejected_record resolves to a pipeline_run",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity="rejected_record",
            description=(
                "An audit trail whose rows cannot be traced to a run is not an audit trail."
            ),
            applies_to=("audit.rejected_record",),
        ),
        CheckDefinition(
            check_id="DQ-AUD-003",
            check_name="every pipeline_run_row_count resolves to a pipeline_run",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity="pipeline_run_row_count",
            description="Row counts are the evidence for reconciliation; orphans invalidate it.",
            applies_to=("audit.pipeline_run_row_count",),
        ),
        CheckDefinition(
            check_id="DQ-AUD-004",
            check_name="every reconciliation_result resolves to a pipeline_run",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.SQL,
            entity="reconciliation_result",
            description="A reconciliation that belongs to no run proves nothing about any run.",
            applies_to=("audit.reconciliation_result",),
        ),
        CheckDefinition(
            check_id="DQ-AUD-005",
            check_name="pipeline_run status and timestamps are internally consistent",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.WARNING,
            layer=CheckLayer.SQL,
            entity="pipeline_run",
            description=(
                "A run that finished before it started, or completed while still marked "
                "running, usually means the process died without updating its row. "
                "warning, because the data it produced may still be sound."
            ),
            applies_to=("audit.pipeline_run",),
        ),
    )
)
