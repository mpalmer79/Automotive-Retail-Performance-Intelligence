"""Generator for ``warehouse.dim_customer`` (Slowly Changing Dimension Type 1).

Privacy posture
---------------
This is the most privacy-sensitive entity in ARPI, and it is deliberately thin. It exists
to support repeat-purchase, household and cohort analysis -- **not** to profile people.

The generator has **no code path** that can produce a name, a full birth date, a street
address, a personal email address, a phone number, a Social Security number, a driver's
licence number, bank or payment-card details, an exact credit score, a protected
characteristic, or a free-form note. Two minimisation decisions carry most of the weight:

* **Age is banded, never exact.** ``age_band`` is a six-way band; a full birth date is a
  quasi-identifier and is prohibited.
* **Geography stops at county and market area.** No street, no postal code, no
  coordinates. County is the finest geography ARPI stores anywhere.

:func:`validate_customer_dataset` inspects the *schema*, so an accidental prohibited column
fails the run even when it holds no values.

Seeding
-------
The generator draws from its own ``dim_customer`` namespace. Because
:func:`arpi.utilities.seeding.rng_for` hashes the namespace rather than consuming a shared
stream, generating customers cannot perturb a single value -- or a single content digest --
in any other entity.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, replace
from datetime import date, timedelta
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
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import (
    check_column_schema,
    check_unique_column,
    check_values_in_allowed_set,
)
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    import random
    from collections.abc import Sequence

    from arpi.config import ArpiConfig

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
#: Warehouse entity produced by this module.
ENTITY_DIM_CUSTOMER: Final = "dim_customer"

#: Seeding namespace for this entity, and this entity only.
CUSTOMER_NAMESPACE: Final = "dim_customer"

# ---------------------------------------------------------------------------------------
# warehouse.dim_customer column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_CUSTOMER_COLUMNS: Final[tuple[str, ...]] = (
    "customer_key",
    "customer_id",
    "household_id",
    "age_band",
    "county",
    "state_code",
    "market_area",
    "customer_type",
    "is_prior_customer",
    "is_service_customer",
    "first_interaction_date",
    "source_system",
)

# Second precision matches the dealership and employee dimensions, so every ARPI date
# column shares one dtype regardless of whether it can carry the 9999-12-31 sentinel.
DIM_CUSTOMER_DTYPES: Final[dict[str, str]] = {
    "customer_key": "int32",
    "customer_id": "string",
    "household_id": "string",
    "age_band": "string",
    "county": "string",
    "state_code": "string",
    "market_area": "string",
    "customer_type": "string",
    "is_prior_customer": "bool",
    "is_service_customer": "bool",
    "first_interaction_date": "datetime64[s]",
    "source_system": "string",
}

#: Every column of ``dim_customer`` is ``NOT NULL``.
DIM_CUSTOMER_REQUIRED_COLUMNS: Final[tuple[str, ...]] = DIM_CUSTOMER_COLUMNS

# ---------------------------------------------------------------------------------------
# Controlled vocabularies
# ---------------------------------------------------------------------------------------
ALLOWED_AGE_BANDS: Final[tuple[str, ...]] = (
    "18-24",
    "25-34",
    "35-44",
    "45-54",
    "55-64",
    "65+",
)

#: Draw weights for ``age_band``. Deliberately non-uniform: a flat age distribution is a
#: prohibited synthetic pattern ([ARCHITECTURE.md §15.4]) and would not survive review.
AGE_BAND_WEIGHTS: Final[tuple[float, ...]] = (0.06, 0.20, 0.22, 0.20, 0.18, 0.14)

MARKET_AREA_SOUTHERN_NH: Final = "Southern New Hampshire"
MARKET_AREA_NORTHERN_MA: Final = "Northern Massachusetts"

ALLOWED_MARKET_AREAS: Final[tuple[str, ...]] = (
    MARKET_AREA_SOUTHERN_NH,
    MARKET_AREA_NORTHERN_MA,
)
ALLOWED_STATE_CODES: Final[tuple[str, ...]] = ("NH", "MA")


@dataclass(frozen=True, slots=True)
class CountyProfile:
    """One county in the fictional group's trading area.

    Attributes:
        county: County name -- the finest geography ARPI stores.
        state_code: Two-letter state code.
        market_area: Analytical market grouping the county belongs to.
        weight: Relative share of the synthetic customer base.
    """

    county: str
    state_code: str
    market_area: str
    weight: float


#: Trading-area counties. The three stores sit in Hillsborough County, so it dominates;
#: the Massachusetts counties are the cross-border shoppers the group genuinely competes
#: for. ``state_code`` and ``market_area`` are **derived from the county**, never drawn
#: separately, so an inconsistent geography triple is unrepresentable.
COUNTY_PROFILES: Final[tuple[CountyProfile, ...]] = (
    CountyProfile("Hillsborough", "NH", MARKET_AREA_SOUTHERN_NH, 0.42),
    CountyProfile("Rockingham", "NH", MARKET_AREA_SOUTHERN_NH, 0.20),
    CountyProfile("Merrimack", "NH", MARKET_AREA_SOUTHERN_NH, 0.12),
    CountyProfile("Strafford", "NH", MARKET_AREA_SOUTHERN_NH, 0.06),
    CountyProfile("Middlesex", "MA", MARKET_AREA_NORTHERN_MA, 0.13),
    CountyProfile("Essex", "MA", MARKET_AREA_NORTHERN_MA, 0.07),
)

ALLOWED_COUNTIES: Final[tuple[str, ...]] = tuple(profile.county for profile in COUNTY_PROFILES)

#: County to ``(state_code, market_area)``, the authoritative consistency rule.
COUNTY_GEOGRAPHY: Final[dict[str, tuple[str, str]]] = {
    profile.county: (profile.state_code, profile.market_area) for profile in COUNTY_PROFILES
}

CUSTOMER_TYPE_RETAIL: Final = "Retail"
CUSTOMER_TYPE_BUSINESS: Final = "Business"
ALLOWED_CUSTOMER_TYPES: Final[tuple[str, ...]] = (CUSTOMER_TYPE_RETAIL, CUSTOMER_TYPE_BUSINESS)

# ---------------------------------------------------------------------------------------
# Population shape
# ---------------------------------------------------------------------------------------
#: Number of synthetic customers per scale mode. Contract section 11.
CUSTOMER_COUNT_BY_SCALE: Final[dict[str, int]] = {
    "test": 80,
    "development": 2_500,
    "portfolio": 22_000,
}

#: Probability that a new customer joins the household most recently created rather than
#: founding a new one. Produces a realistic long tail of one-person households with a
#: minority of two- and three-person ones.
HOUSEHOLD_JOIN_PROBABILITY: Final = 0.22

#: Largest synthetic household. Beyond three the household grouping stops being useful for
#: repeat-purchase analysis and starts looking like a fabricated family record.
MAXIMUM_HOUSEHOLD_SIZE: Final = 3

#: Acquisition warm-up: a customer may first appear up to this many days before
#: ``reporting.start_date``, so inventory and repeat business exist on day one
#: (contract section 8).
ACQUISITION_WARM_UP_DAYS: Final = 180

#: Base probability that a customer bought before the reporting window opened.
PRIOR_CUSTOMER_BASE_PROBABILITY: Final = 0.18

#: Added to the base probability for the three older age bands, which skew to repeat buyers.
PRIOR_CUSTOMER_MATURE_UPLIFT: Final = 0.10

#: Age bands that receive :data:`PRIOR_CUSTOMER_MATURE_UPLIFT`.
MATURE_AGE_BANDS: Final[frozenset[str]] = frozenset({"45-54", "55-64", "65+"})

PRIOR_CUSTOMER_BUSINESS_PROBABILITY: Final = 0.30
SERVICE_CUSTOMER_PRIOR_PROBABILITY: Final = 0.75
SERVICE_CUSTOMER_NEW_PROBABILITY: Final = 0.34
SERVICE_CUSTOMER_BUSINESS_PROBABILITY: Final = 0.28

#: Share of the customer base that is a business rather than a private buyer.
BUSINESS_CUSTOMER_SHARE: Final = 0.07

# ---------------------------------------------------------------------------------------
# Privacy tripwire
# ---------------------------------------------------------------------------------------
#: Personal-data column names are caught by :mod:`arpi.validation.privacy`, which is the
#: single generalised authority for that vocabulary. This set adds only the automotive
#: finance-and-insurance material named in ``docs/research.md`` 10.2 that a general
#: personal-data vocabulary has no reason to know about. Substring matching is safe: no
#: legitimate customer column contains any of them.
CUSTOMER_PROHIBITED_COLUMN_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "credit_application",
        "credit_report",
        "deal_jacket",
        "household_income",
        "insurance",
    }
)

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_CUSTOMER_UNIQUE_ID: Final = "DQ-CUS-001"
CHECK_CUSTOMER_SCHEMA_MATCHES: Final = "DQ-CUS-002"
CHECK_CUSTOMER_NO_PROHIBITED_PII: Final = "DQ-CUS-003"
CHECK_CUSTOMER_GEOGRAPHY_ALLOWED: Final = "DQ-CUS-004"
CHECK_CUSTOMER_AGE_BAND_ALLOWED: Final = "DQ-CUS-005"
CHECK_CUSTOMER_HOUSEHOLD_CONSISTENT: Final = "DQ-CUS-006"
CHECK_CUSTOMER_FIRST_INTERACTION_WINDOW: Final = "DQ-CUS-007"
CHECK_CUSTOMER_TYPE_ALLOWED: Final = "DQ-CUS-008"

#: Every check identifier this module emits, in identifier order. Agent B's registry can
#: adopt these with a one-line import rather than a re-declaration.
CUSTOMER_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_CUSTOMER_UNIQUE_ID,
    CHECK_CUSTOMER_SCHEMA_MATCHES,
    CHECK_CUSTOMER_NO_PROHIBITED_PII,
    CHECK_CUSTOMER_GEOGRAPHY_ALLOWED,
    CHECK_CUSTOMER_AGE_BAND_ALLOWED,
    CHECK_CUSTOMER_HOUSEHOLD_CONSISTENT,
    CHECK_CUSTOMER_FIRST_INTERACTION_WINDOW,
    CHECK_CUSTOMER_TYPE_ALLOWED,
)

_WAREHOUSE_DIM_CUSTOMER: Final = "warehouse.dim_customer"

# Registered at import time so the canonical register in
# :mod:`arpi.validation.registry` is complete whenever this generator is importable.
# ``layer`` is ``python`` because only a pandas implementation exists today.
register_checks(
    (
        CheckDefinition(
            check_id=CHECK_CUSTOMER_UNIQUE_ID,
            check_name="dim_customer.customer_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "customer_id is the natural key every fact resolves through. A duplicate "
                "would fan out the join and inflate repeat-purchase rates."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_SCHEMA_MATCHES,
            check_name="dim_customer matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "so a reordered column would land in the wrong target field."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_NO_PROHIBITED_PII,
            check_name="dim_customer declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "Names, full birth dates, street addresses, contact details, government "
                "and financial identifiers, exact credit scores, protected "
                "characteristics and free-form notes must never exist as customer "
                "columns. The check inspects the schema, so an empty prohibited column "
                "still fails the run."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_GEOGRAPHY_ALLOWED,
            check_name="dim_customer geography is allowed and internally consistent",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "County is the finest geography ARPI stores, and state_code and "
                "market_area follow from it. An inconsistent triple would mean geography "
                "had been drawn independently rather than derived, which is how a "
                "finer-grained location gets reconstructed."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_AGE_BAND_ALLOWED,
            check_name="dim_customer.age_band is inside its declared enumeration",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "Age is banded rather than exact precisely so it cannot act as a "
                "quasi-identifier. A value outside the six declared bands means the "
                "banding was bypassed."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_HOUSEHOLD_CONSISTENT,
            check_name="dim_customer households share one geography",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "A household that spans two counties is not a household, and "
                "household-level repeat-purchase analysis built on it would be "
                "meaningless."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_FIRST_INTERACTION_WINDOW,
            check_name="dim_customer.first_interaction_date is inside the permitted window",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "Facts may only reference a customer on or after their first "
                "interaction. A date outside the warm-up window would let a sale precede "
                "the existence of its own buyer."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
        CheckDefinition(
            check_id=CHECK_CUSTOMER_TYPE_ALLOWED,
            check_name="dim_customer.customer_type is inside its declared enumeration",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_CUSTOMER,
            description=(
                "Retail and business buyers behave differently in every funnel measure, "
                "so an unrecognised type would silently join a segment it does not belong "
                "to."
            ),
            applies_to=(_WAREHOUSE_DIM_CUSTOMER,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CustomerSelection:
    """The minimum a downstream fact generator needs to attach a customer to a row.

    Attributes:
        customer_id: Synthetic identifier, ``CUS-########``.
        household_id: Synthetic household identifier, ``HH-########``.
        customer_type: ``Retail`` or ``Business``.
        is_prior_customer: Whether they bought before the reporting window opened.
        first_interaction_date: Earliest date any fact may reference this customer.
    """

    customer_id: str
    household_id: str
    customer_type: str
    is_prior_customer: bool
    first_interaction_date: date


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def geography_for_county(county: str) -> tuple[str, str]:
    """Return the ``(state_code, market_area)`` a county belongs to.

    Args:
        county: One of :data:`ALLOWED_COUNTIES`.

    Returns:
        The state code and market area, both derived rather than drawn.

    Raises:
        GenerationError: If the county is outside the declared trading area.
    """
    try:
        return COUNTY_GEOGRAPHY[county]
    except KeyError as error:
        raise GenerationError(
            f"county {county!r} is outside the declared trading area "
            f"({', '.join(ALLOWED_COUNTIES)}).",
            entity=ENTITY_DIM_CUSTOMER,
            county=county,
        ) from error


def customer_count(config: ArpiConfig) -> int:
    """Return the number of synthetic customers for the active scale mode.

    Args:
        config: Resolved configuration.

    Returns:
        The count from :data:`CUSTOMER_COUNT_BY_SCALE`.

    Raises:
        GenerationError: If the scale mode has no declared customer count.
    """
    try:
        return CUSTOMER_COUNT_BY_SCALE[config.generation.scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No customer count is declared for scale mode "
            f"{config.generation.scale_mode!r}. Declared modes: "
            f"{', '.join(sorted(CUSTOMER_COUNT_BY_SCALE))}.",
            entity=ENTITY_DIM_CUSTOMER,
            scale_mode=config.generation.scale_mode,
        ) from error


def first_interaction_window(config: ArpiConfig) -> tuple[date, date]:
    """Return the inclusive date range in which a first interaction may fall.

    The range opens :data:`ACQUISITION_WARM_UP_DAYS` before ``reporting.start_date`` so
    that customers already exist when the first day of the window is generated, and a sale
    on day one still satisfies ``first_interaction_date <= sale_date``.

    Args:
        config: Resolved configuration.

    Returns:
        ``(earliest, latest)`` as inclusive bounds.
    """
    return (
        config.reporting.start_date - timedelta(days=ACQUISITION_WARM_UP_DAYS),
        config.reporting.end_date,
    )


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class CustomerGenerator(BaseGenerator):
    """Build the synthetic customer population."""

    entity_name = ENTITY_DIM_CUSTOMER
    declared_columns = DIM_CUSTOMER_COLUMNS
    namespace = CUSTOMER_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the customer frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 12 contract columns, in order, one row per customer, with
            ``customer_key`` assigned as a deterministic ordinal over ``customer_id``.
        """
        records = _build_records(config)
        frame = pd.DataFrame.from_records(records, columns=list(DIM_CUSTOMER_COLUMNS))
        return frame.astype(DIM_CUSTOMER_DTYPES)


def generate_customer_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_customer`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return CustomerGenerator().generate(config)


def _build_records(config: ArpiConfig) -> list[dict[str, Any]]:
    """Draw the whole customer population, in ``customer_id`` order."""
    rng = rng_for(config.random_seed, CUSTOMER_NAMESPACE)
    total = customer_count(config)
    earliest, latest = first_interaction_window(config)
    window_start = config.reporting.start_date
    counties = [profile.county for profile in COUNTY_PROFILES]
    weights = [profile.weight for profile in COUNTY_PROFILES]

    records: list[dict[str, Any]] = []
    household_sequence = 0
    household_id = ""
    household_county = ""
    household_size = MAXIMUM_HOUSEHOLD_SIZE

    for sequence in range(1, total + 1):
        joins_existing = (
            household_size < MAXIMUM_HOUSEHOLD_SIZE and rng.random() < HOUSEHOLD_JOIN_PROBABILITY
        )
        if joins_existing:
            household_size += 1
        else:
            household_sequence += 1
            household_id = f"HH-{household_sequence:08d}"
            household_county = rng.choices(counties, weights=weights, k=1)[0]
            household_size = 1

        state_code, market_area = geography_for_county(household_county)
        age_band = rng.choices(ALLOWED_AGE_BANDS, weights=AGE_BAND_WEIGHTS, k=1)[0]
        is_business = rng.random() < BUSINESS_CUSTOMER_SHARE
        is_prior = rng.random() < _prior_customer_probability(age_band, is_business=is_business)
        is_service = rng.random() < _service_customer_probability(
            is_prior=is_prior, is_business=is_business
        )
        records.append(
            {
                "customer_key": sequence,
                "customer_id": f"CUS-{sequence:08d}",
                "household_id": household_id,
                "age_band": age_band,
                "county": household_county,
                "state_code": state_code,
                "market_area": market_area,
                "customer_type": CUSTOMER_TYPE_BUSINESS if is_business else CUSTOMER_TYPE_RETAIL,
                "is_prior_customer": is_prior,
                "is_service_customer": is_service,
                "first_interaction_date": _draw_first_interaction_date(
                    rng, earliest, latest, window_start, is_prior=is_prior
                ),
                "source_system": SOURCE_SYSTEM,
            }
        )
    return records


def _prior_customer_probability(age_band: str, *, is_business: bool) -> float:
    """Return the probability that a customer bought before the window opened."""
    if is_business:
        return PRIOR_CUSTOMER_BUSINESS_PROBABILITY
    uplift = PRIOR_CUSTOMER_MATURE_UPLIFT if age_band in MATURE_AGE_BANDS else 0.0
    return PRIOR_CUSTOMER_BASE_PROBABILITY + uplift


def _service_customer_probability(*, is_prior: bool, is_business: bool) -> float:
    """Return the probability that a customer also has service history."""
    if is_business:
        return SERVICE_CUSTOMER_BUSINESS_PROBABILITY
    return SERVICE_CUSTOMER_PRIOR_PROBABILITY if is_prior else SERVICE_CUSTOMER_NEW_PROBABILITY


def _draw_first_interaction_date(
    rng: random.Random,
    earliest: date,
    latest: date,
    window_start: date,
    *,
    is_prior: bool,
) -> date:
    """Place the first interaction, keeping prior customers inside the warm-up period."""
    upper = window_start - timedelta(days=1) if is_prior else latest
    upper = max(upper, earliest)
    span = (upper - earliest).days
    return earliest + timedelta(days=rng.randrange(span + 1))


# ---------------------------------------------------------------------------------------
# Selection helpers for downstream fact generators
# ---------------------------------------------------------------------------------------
def customer_selection_pool(
    config: ArpiConfig, *, customer_type: str | None = None
) -> tuple[CustomerSelection, ...]:
    """Build the pool a fact generator picks customers from.

    The pool is sorted by ``(first_interaction_date, customer_id)``, which is what makes
    :func:`select_customer_for_sale` a binary search rather than a scan. Build it **once**
    per run and reuse it; rebuilding it per sale would regenerate the whole population.

    Args:
        config: Resolved configuration.
        customer_type: Restrict the pool to one of :data:`ALLOWED_CUSTOMER_TYPES`, or
            ``None`` for every customer.

    Returns:
        The eligible customers, sorted ascending by ``first_interaction_date``.

    Raises:
        GenerationError: If ``customer_type`` is outside the declared enumeration.
    """
    if customer_type is not None and customer_type not in ALLOWED_CUSTOMER_TYPES:
        raise GenerationError(
            f"customer_type {customer_type!r} is outside the declared enumeration "
            f"({', '.join(ALLOWED_CUSTOMER_TYPES)}).",
            entity=ENTITY_DIM_CUSTOMER,
            customer_type=customer_type,
        )
    selections = [
        CustomerSelection(
            customer_id=str(record["customer_id"]),
            household_id=str(record["household_id"]),
            customer_type=str(record["customer_type"]),
            is_prior_customer=bool(record["is_prior_customer"]),
            first_interaction_date=record["first_interaction_date"],
        )
        for record in _build_records(config)
        if customer_type is None or record["customer_type"] == customer_type
    ]
    selections.sort(key=lambda item: (item.first_interaction_date, item.customer_id))
    return tuple(selections)


def select_customer_for_sale(
    pool: Sequence[CustomerSelection], sale_date: date, rng: random.Random
) -> CustomerSelection | None:
    """Pick a customer who already existed on ``sale_date``.

    This is the guarantee that ``first_interaction_date <= sale_date`` holds for every
    fact: a customer who has not interacted yet is never offered.

    Args:
        pool: A pool from :func:`customer_selection_pool`, still in its sorted order.
        sale_date: Date of the transaction being generated.
        rng: The caller's generator, so the choice stays inside the caller's seed stream.

    Returns:
        An eligible customer, or ``None`` when nobody had interacted by ``sale_date``.
    """
    eligible = bisect_right(pool, sale_date, key=lambda item: item.first_interaction_date)
    if eligible == 0:
        return None
    return pool[rng.randrange(eligible)]


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_customer_dataset(dataset: GeneratedDataset, config: ArpiConfig) -> ValidationReport:
    """Run ``DQ-CUS-001`` through ``DQ-CUS-008`` against the customer dimension.

    The suite lives here rather than in :mod:`arpi.validation.datasets` only because that
    module is owned elsewhere in the current Phase 1 split. Nothing about it is
    entity-coupled beyond the identifiers, so moving it is a copy, not a rewrite.

    Args:
        dataset: The generated ``dim_customer`` dataset.
        config: Resolved configuration supplying the first-interaction window.

    Returns:
        A report containing eight results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "customer_id",
                check_id=CHECK_CUSTOMER_UNIQUE_ID,
                check_name="dim_customer.customer_id is unique",
                target_object=ENTITY_DIM_CUSTOMER,
            ),
            check_column_schema(
                frame,
                DIM_CUSTOMER_COLUMNS,
                check_id=CHECK_CUSTOMER_SCHEMA_MATCHES,
                check_name="dim_customer matches its declared column contract",
                target_object=ENTITY_DIM_CUSTOMER,
            ),
            _check_no_prohibited_columns(frame),
            _check_geography(frame),
            check_values_in_allowed_set(
                frame,
                "age_band",
                ALLOWED_AGE_BANDS,
                check_id=CHECK_CUSTOMER_AGE_BAND_ALLOWED,
                check_name="dim_customer.age_band is inside its declared enumeration",
                target_object=ENTITY_DIM_CUSTOMER,
            ),
            _check_household_consistency(frame),
            _check_first_interaction_window(frame, config),
            check_values_in_allowed_set(
                frame,
                "customer_type",
                ALLOWED_CUSTOMER_TYPES,
                check_id=CHECK_CUSTOMER_TYPE_ALLOWED,
                check_name="dim_customer.customer_type is inside its declared enumeration",
                target_object=ENTITY_DIM_CUSTOMER,
            ),
        )
    )


def _check_first_interaction_window(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """``DQ-CUS-007`` -- every ``first_interaction_date`` is inside the permitted window.

    This is the check the sale generator depends on: a customer whose first interaction
    post-dates the window could be attached to a sale that precedes their own existence.
    """
    earliest, latest = first_interaction_window(config)
    outside = int(
        (
            (frame["first_interaction_date"] < pd.Timestamp(earliest))
            | (frame["first_interaction_date"] > pd.Timestamp(latest))
        ).sum()
    )
    base = _base_result(
        CHECK_CUSTOMER_FIRST_INTERACTION_WINDOW,
        "dim_customer.first_interaction_date is inside the permitted window",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    if outside == 0:
        return base
    return base.failed(
        f"{outside} customer(s) have a first_interaction_date outside "
        f"{earliest.isoformat()}..{latest.isoformat()}.",
        observed_value=float(outside),
        failed_record_count=outside,
    )


def _base_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_DIM_CUSTOMER,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_no_prohibited_columns(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CUS-003`` -- no prohibited personal-data column exists."""
    shared = check_no_prohibited_pii_columns(
        frame,
        check_id=CHECK_CUSTOMER_NO_PROHIBITED_PII,
        check_name="dim_customer declares no prohibited personal-data column",
        target_object=ENTITY_DIM_CUSTOMER,
    )
    if shared.is_failure:
        return shared
    offending = sorted(
        str(column)
        for column in frame.columns
        if any(token in str(column).strip().lower() for token in CUSTOMER_PROHIBITED_COLUMN_TOKENS)
    )
    base = _base_result(
        CHECK_CUSTOMER_NO_PROHIBITED_PII,
        "dim_customer declares no prohibited personal-data column",
        CHECK_CATEGORY_PRIVACY,
    )
    if not offending:
        return base
    return base.failed(
        f"dim_customer declares prohibited column(s): {', '.join(offending)}. Protected "
        "characteristics, credit and insurance material, and free-form commentary must "
        "never be materialised.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_geography(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CUS-004`` -- county, state and market area are allowed and mutually consistent."""
    base = _base_result(
        CHECK_CUSTOMER_GEOGRAPHY_ALLOWED,
        "dim_customer geography is allowed and internally consistent",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    unknown = ~frame["county"].isin(ALLOWED_COUNTIES)
    expected_state = frame["county"].map(
        {name: value[0] for name, value in COUNTY_GEOGRAPHY.items()}
    )
    expected_market = frame["county"].map(
        {name: value[1] for name, value in COUNTY_GEOGRAPHY.items()}
    )
    inconsistent = (frame["state_code"] != expected_state) | (
        frame["market_area"] != expected_market
    )
    offending = int((unknown | inconsistent).sum())
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{offending} customer(s) carry a county outside {', '.join(ALLOWED_COUNTIES)} or a "
        "state_code / market_area that does not follow from their county.",
        failed_record_count=offending,
    )


def _check_household_consistency(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CUS-006`` -- every member of a household shares one geography."""
    base = _base_result(
        CHECK_CUSTOMER_HOUSEHOLD_CONSISTENT,
        "dim_customer households share one geography",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    distinct = frame.groupby("household_id")[["county", "state_code", "market_area"]].nunique()
    offending = int((distinct > 1).any(axis=1).sum())
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{offending} household(s) span more than one county, state or market area. A "
        "household is a single address-free geography grouping and cannot.",
        failed_record_count=offending,
    )
