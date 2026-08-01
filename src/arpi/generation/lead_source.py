"""Generator for ``warehouse.dim_lead_source`` (Slowly Changing Dimension Type 1).

Why this dimension exists
-------------------------
Ungoverned CRM source strings are the single most common reason dealership funnel
reporting cannot be trusted: the same channel arrives as ``Website``, ``web site``,
``WEBSITE FORM`` and ``Internet`` in one month of data. This dimension is where that is
normalised **once**, so every funnel and marketing measure is comparable across the three
fictional stores.

Fictional names only
--------------------
Every ``lead_source_name`` is a **generic, invented channel label** -- ``Third-Party
Marketplace Listing``, ``Paid Search Non-Brand``, ``Service Lane Opportunity``. No real
lead vendor, marketplace or media company is named anywhere in ARPI. That is deliberate
and it is not cosmetic: this module attaches invented conversion rates and invented cost
levels to every source, and attaching invented commercial behaviour to a **named real
company** would be a fabricated claim about that company.

Latent behaviour is a generation input, not a fact
--------------------------------------------------
[ARCHITECTURE.md §15.3](../../../ARCHITECTURE.md) requires sources to differ genuinely in
volume, contact rate, close rate and cost. Those four latents live on
:class:`LeadSourceBehaviour` and are exposed through :func:`lead_source_behaviour` and
:func:`lead_source_behaviours` for the lead, appointment and marketing-spend generators.

They are **not** dimension columns. A close rate stored on a dimension row would be an
assumption masquerading as a measured fact, and any report reading it would be reporting
the generator's own inputs back to itself. Measured conversion is computed downstream from
``fact_lead``; the numbers here only shape the draws that produce it.

Seeding
-------
The source list is fixed reference data, so this generator draws no random numbers at all
and is seed-independent. The ``dim_lead_source`` namespace is still declared, so that a
future variant which does draw cannot perturb another entity's digest.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.validation.checks import (
    check_column_schema,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
#: Warehouse entity produced by this module.
ENTITY_DIM_LEAD_SOURCE: Final = "dim_lead_source"

#: Seeding namespace for this entity, and this entity only.
LEAD_SOURCE_NAMESPACE: Final = "dim_lead_source"

# ---------------------------------------------------------------------------------------
# warehouse.dim_lead_source column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_LEAD_SOURCE_COLUMNS: Final[tuple[str, ...]] = (
    "lead_source_key",
    "lead_source_id",
    "lead_source_name",
    "source_category",
    "is_paid",
    "is_digital",
    "is_third_party",
    "is_internal",
    "source_system",
)

DIM_LEAD_SOURCE_DTYPES: Final[dict[str, str]] = {
    "lead_source_key": "int32",
    "lead_source_id": "string",
    "lead_source_name": "string",
    "source_category": "string",
    "is_paid": "bool",
    "is_digital": "bool",
    "is_third_party": "bool",
    "is_internal": "bool",
    "source_system": "string",
}

#: Every column of ``dim_lead_source`` is ``NOT NULL``.
DIM_LEAD_SOURCE_REQUIRED_COLUMNS: Final[tuple[str, ...]] = DIM_LEAD_SOURCE_COLUMNS

# ---------------------------------------------------------------------------------------
# Controlled vocabulary
# ---------------------------------------------------------------------------------------
CATEGORY_OWNED_DIGITAL: Final = "Owned Digital"
CATEGORY_THIRD_PARTY: Final = "Third Party"
CATEGORY_PAID_SEARCH: Final = "Paid Search"
CATEGORY_PAID_SOCIAL: Final = "Paid Social"
CATEGORY_TRADITIONAL_MEDIA: Final = "Traditional Media"
CATEGORY_WALK_IN: Final = "Walk-in"
CATEGORY_REFERRAL: Final = "Referral"
CATEGORY_INTERNAL: Final = "Internal"
CATEGORY_ORGANIC_WEB: Final = "Organic Web"

#: The nine governed source categories, in contract order.
ALLOWED_SOURCE_CATEGORIES: Final[tuple[str, ...]] = (
    CATEGORY_OWNED_DIGITAL,
    CATEGORY_THIRD_PARTY,
    CATEGORY_PAID_SEARCH,
    CATEGORY_PAID_SOCIAL,
    CATEGORY_TRADITIONAL_MEDIA,
    CATEGORY_WALK_IN,
    CATEGORY_REFERRAL,
    CATEGORY_INTERNAL,
    CATEGORY_ORGANIC_WEB,
)

#: Money is always :class:`~decimal.Decimal`, quantized to cents, never ``float``.
MONEY_QUANTUM: Final = Decimal("0.01")

#: Cost level recorded for a source that carries no media cost at all.
ZERO_COST: Final = Decimal("0.00")


# ---------------------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class LeadSourceBehaviour:
    """The latent behaviour of one lead source, never a dimension column.

    These four numbers are what make [ARCHITECTURE.md §15.3](../../../ARCHITECTURE.md)
    relationship 7 -- "sources differ in cost, volume, conversion and gross" -- genuinely
    present in the generated data rather than merely asserted in documentation.

    Attributes:
        lead_source_id: The source these latents belong to, ``LDS-###``.
        volume_weight: Share of total lead volume this source is expected to produce.
            The weights across all sources sum to ``1.0``.
        contact_rate: Expected probability that a lead from this source is successfully
            contacted at all.
        close_rate: Expected probability that a lead from this source ends in a sale.
            Applied to leads, not to contacted leads, so it is directly comparable across
            sources.
        cost_per_lead: Expected media cost of one lead, as a cent-quantized
            :class:`~decimal.Decimal`. ``0.00`` exactly when the source is not paid --
            an unpaid source has no media cost, and a small non-zero placeholder would
            make cost-per-lead look defined where it is not.
    """

    lead_source_id: str
    volume_weight: float
    contact_rate: float
    close_rate: float
    cost_per_lead: Decimal


@dataclass(frozen=True, slots=True)
class LeadSourceDefinition:
    """One governed lead source: its dimension attributes plus its latent behaviour.

    Attributes:
        lead_source_id: Synthetic identifier, ``LDS-###``.
        lead_source_name: Generic, invented channel label. Never a real company.
        source_category: One of :data:`ALLOWED_SOURCE_CATEGORIES`.
        is_paid: Whether the source carries media cost. Determines whether cost-per-lead
            is defined for it at all.
        is_digital: Digital rather than traditional or in-person channel.
        is_third_party: Supplied by an external marketplace rather than owned or earned.
        is_internal: Generated inside the store -- the showroom floor, the service lane
            or the store's own owner base -- rather than by an inbound channel.
        volume_weight: Latent. See :class:`LeadSourceBehaviour`.
        contact_rate: Latent. See :class:`LeadSourceBehaviour`.
        close_rate: Latent. See :class:`LeadSourceBehaviour`.
        cost_per_lead: Latent. See :class:`LeadSourceBehaviour`.
    """

    lead_source_id: str
    lead_source_name: str
    source_category: str
    is_paid: bool
    is_digital: bool
    is_third_party: bool
    is_internal: bool
    volume_weight: float
    contact_rate: float
    close_rate: float
    cost_per_lead: Decimal

    @property
    def behaviour(self) -> LeadSourceBehaviour:
        """The latent behaviour of this source, without its dimension attributes."""
        return LeadSourceBehaviour(
            lead_source_id=self.lead_source_id,
            volume_weight=self.volume_weight,
            contact_rate=self.contact_rate,
            close_rate=self.close_rate,
            cost_per_lead=self.cost_per_lead,
        )


#: The governed source list, in ``lead_source_id`` order -- the authoritative reference
#: data shared verbatim with the SQL seed and the documentation.
#:
#: Every name is invented and generic. The behavioural shape is the one the automotive
#: retail literature describes and ``docs/research.md`` §4.7 summarises: in-person and
#: earned sources are low volume, cost nothing and close several times better than
#: purchased digital traffic, while third-party marketplaces deliver high volume at a low
#: close rate. A flat set of rates across sources would be a prohibited synthetic pattern
#: ([ARCHITECTURE.md §15.4](../../../ARCHITECTURE.md)) and would make every marketing
#: comparison in the model vacuous.
LEAD_SOURCE_DEFINITIONS: Final[tuple[LeadSourceDefinition, ...]] = (
    LeadSourceDefinition(
        lead_source_id="LDS-001",
        lead_source_name="Dealer Website Form",
        source_category=CATEGORY_OWNED_DIGITAL,
        is_paid=False,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.14,
        contact_rate=0.82,
        close_rate=0.11,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-002",
        lead_source_name="Dealer Website Chat",
        source_category=CATEGORY_OWNED_DIGITAL,
        is_paid=False,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.06,
        contact_rate=0.88,
        close_rate=0.09,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-003",
        lead_source_name="Email Marketing Response",
        source_category=CATEGORY_OWNED_DIGITAL,
        is_paid=True,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.04,
        contact_rate=0.72,
        close_rate=0.08,
        cost_per_lead=Decimal("6.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-004",
        lead_source_name="Organic Search Landing",
        source_category=CATEGORY_ORGANIC_WEB,
        is_paid=False,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.05,
        contact_rate=0.78,
        close_rate=0.10,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-005",
        lead_source_name="Direct Site Visit",
        source_category=CATEGORY_ORGANIC_WEB,
        is_paid=False,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.03,
        contact_rate=0.75,
        close_rate=0.09,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-006",
        lead_source_name="Paid Search Brand",
        source_category=CATEGORY_PAID_SEARCH,
        is_paid=True,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.07,
        contact_rate=0.80,
        close_rate=0.12,
        cost_per_lead=Decimal("28.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-007",
        lead_source_name="Paid Search Non-Brand",
        source_category=CATEGORY_PAID_SEARCH,
        is_paid=True,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.09,
        contact_rate=0.74,
        close_rate=0.08,
        cost_per_lead=Decimal("46.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-008",
        lead_source_name="Paid Social Feed Campaign",
        source_category=CATEGORY_PAID_SOCIAL,
        is_paid=True,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.05,
        contact_rate=0.62,
        close_rate=0.05,
        cost_per_lead=Decimal("34.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-009",
        lead_source_name="Paid Social Video Campaign",
        source_category=CATEGORY_PAID_SOCIAL,
        is_paid=True,
        is_digital=True,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.03,
        contact_rate=0.58,
        close_rate=0.04,
        cost_per_lead=Decimal("39.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-010",
        lead_source_name="Third-Party Marketplace Listing",
        source_category=CATEGORY_THIRD_PARTY,
        is_paid=True,
        is_digital=True,
        is_third_party=True,
        is_internal=False,
        volume_weight=0.13,
        contact_rate=0.68,
        close_rate=0.07,
        cost_per_lead=Decimal("24.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-011",
        lead_source_name="Third-Party Trade Valuation Portal",
        source_category=CATEGORY_THIRD_PARTY,
        is_paid=True,
        is_digital=True,
        is_third_party=True,
        is_internal=False,
        volume_weight=0.05,
        contact_rate=0.70,
        close_rate=0.09,
        cost_per_lead=Decimal("31.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-012",
        lead_source_name="Radio Spot Response",
        source_category=CATEGORY_TRADITIONAL_MEDIA,
        is_paid=True,
        is_digital=False,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.02,
        contact_rate=0.66,
        close_rate=0.07,
        cost_per_lead=Decimal("52.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-013",
        lead_source_name="Direct Mail Response",
        source_category=CATEGORY_TRADITIONAL_MEDIA,
        is_paid=True,
        is_digital=False,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.03,
        contact_rate=0.64,
        close_rate=0.09,
        cost_per_lead=Decimal("41.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-014",
        lead_source_name="Television Spot Response",
        source_category=CATEGORY_TRADITIONAL_MEDIA,
        is_paid=True,
        is_digital=False,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.02,
        contact_rate=0.60,
        close_rate=0.06,
        cost_per_lead=Decimal("68.00"),
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-015",
        lead_source_name="Showroom Walk-in",
        source_category=CATEGORY_WALK_IN,
        is_paid=False,
        is_digital=False,
        is_third_party=False,
        is_internal=True,
        volume_weight=0.09,
        contact_rate=1.00,
        close_rate=0.24,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-016",
        lead_source_name="Customer Referral",
        source_category=CATEGORY_REFERRAL,
        is_paid=False,
        is_digital=False,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.04,
        contact_rate=0.92,
        close_rate=0.26,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-017",
        lead_source_name="Community Partner Referral",
        source_category=CATEGORY_REFERRAL,
        is_paid=False,
        is_digital=False,
        is_third_party=False,
        is_internal=False,
        volume_weight=0.02,
        contact_rate=0.86,
        close_rate=0.18,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-018",
        lead_source_name="Service Lane Opportunity",
        source_category=CATEGORY_INTERNAL,
        is_paid=False,
        is_digital=False,
        is_third_party=False,
        is_internal=True,
        volume_weight=0.03,
        contact_rate=0.90,
        close_rate=0.15,
        cost_per_lead=ZERO_COST,
    ),
    LeadSourceDefinition(
        lead_source_id="LDS-019",
        lead_source_name="Repeat Customer Outreach",
        source_category=CATEGORY_INTERNAL,
        is_paid=False,
        is_digital=False,
        is_third_party=False,
        is_internal=True,
        volume_weight=0.01,
        contact_rate=0.85,
        close_rate=0.17,
        cost_per_lead=ZERO_COST,
    ),
)

#: ``lead_source_id`` to its definition, for O(1) lookup by downstream generators.
LEAD_SOURCE_BY_ID: Final[dict[str, LeadSourceDefinition]] = {
    definition.lead_source_id: definition for definition in LEAD_SOURCE_DEFINITIONS
}

#: Every governed identifier, in contract order.
ALL_LEAD_SOURCE_IDS: Final[tuple[str, ...]] = tuple(LEAD_SOURCE_BY_ID)

#: The identifiers a marketing campaign may reference: exactly the paid sources. A
#: campaign against an unpaid source would attach spend to a channel whose cost-per-lead
#: is undefined by rule, which is how a marketing report starts dividing by nothing.
PAID_LEAD_SOURCE_IDS: Final[tuple[str, ...]] = tuple(
    definition.lead_source_id for definition in LEAD_SOURCE_DEFINITIONS if definition.is_paid
)

#: Total CRM lead volume per scale mode, from the Phase 1 scale contract.
#:
#: It lives beside :data:`LEAD_SOURCE_DEFINITIONS` because it is the other half of the
#: same calibration: the volume weights say how the funnel divides, this says how large
#: the funnel is. The marketing-spend generator derives monthly spend from it, and the
#: lead generator (`P1.4-02`) draws its population from it, so the two entities are
#: calibrated against one number rather than drifting apart from two.
TOTAL_LEAD_COUNT_BY_SCALE: Final[dict[str, int]] = {
    "test": 200,
    "development": 6_000,
    "portfolio": 55_000,
}

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_LEAD_SOURCE_UNIQUE_ID: Final = "DQ-LDS-001"
CHECK_LEAD_SOURCE_UNIQUE_NAME: Final = "DQ-LDS-002"
CHECK_LEAD_SOURCE_SCHEMA_MATCHES: Final = "DQ-LDS-003"
CHECK_LEAD_SOURCE_CATEGORY_ALLOWED: Final = "DQ-LDS-004"
CHECK_LEAD_SOURCE_INTERNAL_NOT_PAID: Final = "DQ-LDS-005"
CHECK_LEAD_SOURCE_NO_PROHIBITED_PII: Final = "DQ-LDS-006"

#: Every check identifier this module emits, in identifier order.
LEAD_SOURCE_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_LEAD_SOURCE_UNIQUE_ID,
    CHECK_LEAD_SOURCE_UNIQUE_NAME,
    CHECK_LEAD_SOURCE_SCHEMA_MATCHES,
    CHECK_LEAD_SOURCE_CATEGORY_ALLOWED,
    CHECK_LEAD_SOURCE_INTERNAL_NOT_PAID,
    CHECK_LEAD_SOURCE_NO_PROHIBITED_PII,
)

_WAREHOUSE_DIM_LEAD_SOURCE: Final = "warehouse.dim_lead_source"

# Registered at import time so the canonical register in
# :mod:`arpi.validation.registry` is complete whenever this generator is importable.
# ``layer`` is ``python`` because only a pandas implementation exists today; the equivalent
# SQL checks live in `sql/08_validation/` and are recorded separately.
register_checks(
    (
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_UNIQUE_ID,
            check_name="dim_lead_source.lead_source_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "lead_source_id is the natural key every lead, campaign and spend row "
                "resolves through. A duplicate would fan out the join and multiply every "
                "funnel and cost-per-lead measure."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_UNIQUE_NAME,
            check_name="dim_lead_source.lead_source_name is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "The display label is what a report groups by. Two sources sharing a name "
                "would silently merge on every visual while staying separate in the data, "
                "so the totals and the detail would disagree."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_SCHEMA_MATCHES,
            check_name="dim_lead_source matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "so a reordered flag would land in the wrong target field -- and the four "
                "flags are all booleans, which makes a silent swap entirely plausible."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_CATEGORY_ALLOWED,
            check_name="dim_lead_source.source_category is inside its declared enumeration",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "The nine categories are the analytical grouping the marketing page is "
                "built on. An ungoverned tenth value is exactly the CRM free-text problem "
                "this dimension exists to fix."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_INTERNAL_NOT_PAID,
            check_name="dim_lead_source internal sources carry no media cost",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "is_internal implies NOT is_paid. An opportunity generated inside the "
                "store -- a walk-in, a service-lane conversation, an owner-base call -- "
                "has no media cost, so charging one to it would inflate cost per lead and "
                "understate the return on the channels that were actually bought."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOURCE_NO_PROHIBITED_PII,
            check_name="dim_lead_source declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_LEAD_SOURCE,
            description=(
                "The privacy tripwire in its per-entity form. It inspects the schema, so "
                "a prohibited column fails the run even when it holds no values."
            ),
            applies_to=(_WAREHOUSE_DIM_LEAD_SOURCE,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class LeadSourceGenerator(BaseGenerator):
    """Build the governed lead-source dimension from fixed reference data."""

    entity_name = ENTITY_DIM_LEAD_SOURCE
    declared_columns = DIM_LEAD_SOURCE_COLUMNS
    namespace = LEAD_SOURCE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the lead-source frame.

        Args:
            config: Resolved configuration. Unused: the source list is fixed reference
                data, so this entity is seed-independent and profile-independent.

        Returns:
            A frame with the nine contract columns, in order, one row per governed
            source, with ``lead_source_key`` assigned as a deterministic ordinal 1..N
            over ``lead_source_id`` ascending.
        """
        del config  # The governed source list does not vary by profile or seed.
        ordered = sorted(LEAD_SOURCE_DEFINITIONS, key=lambda source: source.lead_source_id)
        records = [
            _build_row(ordinal, definition) for ordinal, definition in enumerate(ordered, start=1)
        ]
        frame = pd.DataFrame.from_records(records, columns=list(DIM_LEAD_SOURCE_COLUMNS))
        return frame.astype(DIM_LEAD_SOURCE_DTYPES)


def generate_lead_source_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_lead_source`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return LeadSourceGenerator().generate(config)


def _build_row(lead_source_key: int, definition: LeadSourceDefinition) -> dict[str, Any]:
    """Render one governed source as a ``dim_lead_source`` row.

    The latent behaviour on ``definition`` is deliberately **not** copied into the row:
    it is a generation input, not a measured fact.
    """
    return {
        "lead_source_key": lead_source_key,
        "lead_source_id": definition.lead_source_id,
        "lead_source_name": definition.lead_source_name,
        "source_category": definition.source_category,
        "is_paid": definition.is_paid,
        "is_digital": definition.is_digital,
        "is_third_party": definition.is_third_party,
        "is_internal": definition.is_internal,
        "source_system": SOURCE_SYSTEM,
    }


# ---------------------------------------------------------------------------------------
# Helpers for downstream generators
# ---------------------------------------------------------------------------------------
def lead_source_key_for(lead_source_id: str) -> int:
    """Return the deterministic surrogate ordinal for a source.

    Args:
        lead_source_id: A governed identifier, ``LDS-###``.

    Returns:
        The 1-based ordinal assigned to that source, identical to the value the
        generator writes into ``lead_source_key``.

    Raises:
        GenerationError: If the identifier is not a governed source.
    """
    ordered = sorted(source.lead_source_id for source in LEAD_SOURCE_DEFINITIONS)
    try:
        return ordered.index(lead_source_id) + 1
    except ValueError as error:
        raise GenerationError(
            f"lead_source_id {lead_source_id!r} is not a governed lead source. "
            f"Governed identifiers: {', '.join(ALL_LEAD_SOURCE_IDS)}.",
            entity=ENTITY_DIM_LEAD_SOURCE,
            lead_source_id=lead_source_id,
        ) from error


def lead_source_definition(lead_source_id: str) -> LeadSourceDefinition:
    """Return the full definition of one governed source.

    Args:
        lead_source_id: A governed identifier, ``LDS-###``.

    Returns:
        Its :class:`LeadSourceDefinition`, dimension attributes and latents together.

    Raises:
        GenerationError: If the identifier is not a governed source.
    """
    try:
        return LEAD_SOURCE_BY_ID[lead_source_id]
    except KeyError as error:
        raise GenerationError(
            f"lead_source_id {lead_source_id!r} is not a governed lead source. "
            f"Governed identifiers: {', '.join(ALL_LEAD_SOURCE_IDS)}.",
            entity=ENTITY_DIM_LEAD_SOURCE,
            lead_source_id=lead_source_id,
        ) from error


def lead_source_behaviour(lead_source_id: str) -> LeadSourceBehaviour:
    """Return the latent behaviour a downstream generator should draw against.

    **This is the helper the lead, appointment and marketing-spend generators call.** It
    is the only supported way to obtain per-source volume, contact, close and cost
    behaviour: those values are not, and must not become, dimension columns.

    Args:
        lead_source_id: A governed identifier, ``LDS-###``.

    Returns:
        The :class:`LeadSourceBehaviour` for that source.

    Raises:
        GenerationError: If the identifier is not a governed source.
    """
    return lead_source_definition(lead_source_id).behaviour


def lead_source_behaviours() -> tuple[LeadSourceBehaviour, ...]:
    """Return the latent behaviour of every governed source, in identifier order.

    Use this to build a weighted draw over sources::

        behaviours = lead_source_behaviours()
        chosen = rng.choices(
            [item.lead_source_id for item in behaviours],
            weights=[item.volume_weight for item in behaviours],
            k=1,
        )[0]

    Returns:
        One :class:`LeadSourceBehaviour` per governed source, ordered by
        ``lead_source_id``. The ``volume_weight`` values sum to ``1.0``.
    """
    return tuple(
        definition.behaviour
        for definition in sorted(LEAD_SOURCE_DEFINITIONS, key=lambda item: item.lead_source_id)
    )


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_lead_source_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-LDS-001`` through ``DQ-LDS-006`` against the lead-source dimension.

    Args:
        dataset: The generated ``dim_lead_source`` dataset.

    Returns:
        A report containing six results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "lead_source_id",
                check_id=CHECK_LEAD_SOURCE_UNIQUE_ID,
                check_name="dim_lead_source.lead_source_id is unique",
                target_object=ENTITY_DIM_LEAD_SOURCE,
            ),
            check_unique_column(
                frame,
                "lead_source_name",
                check_id=CHECK_LEAD_SOURCE_UNIQUE_NAME,
                check_name="dim_lead_source.lead_source_name is unique",
                target_object=ENTITY_DIM_LEAD_SOURCE,
            ),
            check_column_schema(
                frame,
                DIM_LEAD_SOURCE_COLUMNS,
                check_id=CHECK_LEAD_SOURCE_SCHEMA_MATCHES,
                check_name="dim_lead_source matches its declared column contract",
                target_object=ENTITY_DIM_LEAD_SOURCE,
            ),
            check_values_in_allowed_set(
                frame,
                "source_category",
                ALLOWED_SOURCE_CATEGORIES,
                check_id=CHECK_LEAD_SOURCE_CATEGORY_ALLOWED,
                check_name="dim_lead_source.source_category is inside its declared enumeration",
                target_object=ENTITY_DIM_LEAD_SOURCE,
            ),
            _check_internal_is_not_paid(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_LEAD_SOURCE_NO_PROHIBITED_PII,
                check_name="dim_lead_source declares no prohibited personal-data column",
                target_object=ENTITY_DIM_LEAD_SOURCE,
            ),
        )
    )


def _check_internal_is_not_paid(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LDS-005`` -- ``is_internal`` implies ``NOT is_paid``."""
    base = CheckResult(
        check_id=CHECK_LEAD_SOURCE_INTERNAL_NOT_PAID,
        check_name="dim_lead_source internal sources carry no media cost",
        target_object=ENTITY_DIM_LEAD_SOURCE,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_BUSINESS_RULE,
        expected_value=0.0,
        observed_value=0.0,
    )
    missing = [column for column in ("is_internal", "is_paid") if column not in frame.columns]
    if missing:
        return base.failed(
            f"Column(s) {', '.join(missing)} are missing from {ENTITY_DIM_LEAD_SOURCE}."
        )

    offending = frame[frame["is_internal"].astype(bool) & frame["is_paid"].astype(bool)]
    count = int(offending.shape[0])
    if count == 0:
        return base
    names = ", ".join(sorted(str(value) for value in offending["lead_source_id"]))
    return base.failed(
        f"{count} lead source(s) are marked both internal and paid: {names}. An "
        "internally generated opportunity has no media cost.",
        observed_value=float(count),
        failed_record_count=count,
    )
