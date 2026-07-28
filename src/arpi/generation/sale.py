"""Generator for the ``sale_event`` source entity behind ``warehouse.fact_vehicle_sale``.

Grain: **one row per finalized vehicle transaction**. The columns mirror
``warehouse.fact_vehicle_sale`` (``PHASE1_CONTRACT.md`` §7) with the surrogate keys
replaced by the natural identifiers a source system would actually carry, and the date
keys replaced by real dates.

Not every unit sells
--------------------
A vehicle is only sold if it wins a survival draw whose probability rises with the time it
had on the lot and falls with its model line's aging propensity. Unsold units keep their
acquisition and never appear here, which is the point: ``fact_vehicle_inventory_snapshot``
needs standing inventory to snapshot, and days-to-sale survivorship bias must be genuinely
present in the data rather than assumed away.

Cancelled deals are modelled and then excluded
----------------------------------------------
:data:`CANCELLATION_RATE` of otherwise-complete deals are cancelled -- unwound before
delivery, which is a real and common event. A cancelled deal **never appears in this
output**: the fact is called ``fact_vehicle_sale`` and its grain is a *finalized*
transaction, so an unwound deal is not a sale with a flag, it is not a sale. The unit
returns to inventory and remains available. The cancellation is modelled rather than
ignored because it is what makes the measured sell-through lower than the survival draw
alone would produce.

Manufacturer incentives are excluded
------------------------------------
ARPI models **no** manufacturer incentive of any kind: no customer rebate, no dealer cash,
no stair-step or volume bonus, no floor-plan credit, no holdback paid separately from
invoice. This materially changes what ``front_end_gross`` means here, so it is stated
plainly rather than buried: front-end gross is
``sale_price - acquisition_cost - reconditioning_cost - pack_amount`` and nothing else.
A real store's reported new-vehicle front-end gross is frequently rescued by incentive
money that arrives after the fact, so ARPI's new-vehicle front end is **structurally more
negative** than a real store's would be. Comparisons against published industry gross
figures are therefore invalid; comparisons within this dataset are not.

Money
-----
Every monetary value is a :class:`decimal.Decimal`. The two gross identities are exact to
the cent for every row, by construction rather than by tolerance:

* ``front_end_gross = sale_price - acquisition_cost - reconditioning_cost - pack_amount``
* ``total_gross = front_end_gross + back_end_gross``

A float anywhere in either identity is a defect, so no float ever reaches one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.acquisition import (
    AcquisitionRecord,
    build_acquisition_records,
    money,
)
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.customer import (
    CustomerSelection,
    customer_selection_pool,
    select_customer_for_sale,
)
from arpi.generation.employee import (
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_FINANCE_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    EmployeeAssignment,
    EmployeePerformanceProfile,
    build_employee_assignments,
    employee_performance_profiles,
)
from arpi.generation.vehicle import CONDITION_CERTIFIED, CONDITION_NEW
from arpi.logging_config import get_logger
from arpi.utilities.seeding import rng_for
from arpi.validation.checks import check_column_schema, check_unique_column
from arpi.validation.privacy import check_no_prohibited_pii_columns
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    import random
    from collections.abc import Sequence
    from pathlib import Path

    from arpi.config import ArpiConfig

_LOGGER = get_logger(__name__)

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespace
# ---------------------------------------------------------------------------------------
#: Source entity produced by this module; it is loaded as ``warehouse.fact_vehicle_sale``.
ENTITY_SALE_EVENT: Final = "sale_event"

#: Seeding namespace for this entity, and this entity only.
SALE_NAMESPACE: Final = "sale_event"

SALE_ID_PREFIX: Final = "SLE-"
SALE_ID_DIGITS: Final = 8

# ---------------------------------------------------------------------------------------
# Column contract -- PHASE1_CONTRACT.md §7, natural ids and real dates
# ---------------------------------------------------------------------------------------
SALE_EVENT_COLUMNS: Final[tuple[str, ...]] = (
    "sale_id",
    "sale_date",
    "delivery_date",
    "dealership_id",
    "vehicle_id",
    "customer_id",
    "salesperson_id",
    "desk_manager_id",
    "finance_manager_id",
    "lead_source_id",
    "sale_type",
    "is_retail",
    "unit_count",
    "sale_price",
    "msrp",
    "original_asking_price",
    "final_asking_price",
    "acquisition_cost",
    "reconditioning_cost",
    "pack_amount",
    "front_end_gross",
    "back_end_gross",
    "total_gross",
    "trade_allowance",
    "trade_acv",
    "cash_down",
    "amount_financed",
    "days_in_inventory_at_sale",
    "source_system",
)

#: Columns that may be NULL, and the modelled reason each one is.
#:
#: * ``customer_id`` -- a wholesale or dealer-trade unit has no retail buyer.
#: * ``salesperson_id`` / ``desk_manager_id`` / ``finance_manager_id`` -- a wholesale
#:   disposal is desked by management with no commissioned salesperson, and a store with
#:   no finance manager on staff on the day books no F&I participant.
#: * ``lead_source_id`` -- reserved for ``P1.4``; see :data:`LEAD_SOURCE_IS_DEFERRED`.
#: * ``msrp`` -- a used or certified unit has no manufacturer sticker in ARPI.
SALE_EVENT_NULLABLE_COLUMNS: Final[tuple[str, ...]] = (
    "customer_id",
    "salesperson_id",
    "desk_manager_id",
    "finance_manager_id",
    "lead_source_id",
    "msrp",
)

#: Monetary columns, all carried as :class:`decimal.Decimal` in an ``object`` column.
SALE_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "sale_price",
    "msrp",
    "original_asking_price",
    "final_asking_price",
    "acquisition_cost",
    "reconditioning_cost",
    "pack_amount",
    "front_end_gross",
    "back_end_gross",
    "total_gross",
    "trade_allowance",
    "trade_acv",
    "cash_down",
    "amount_financed",
)

#: Monetary columns that may never be negative. ``front_end_gross`` and ``total_gross``
#: are deliberately absent: a genuinely negative gross is a fact of the business, not a
#: defect, and suppressing it would be the fabrication.
SALE_NON_NEGATIVE_MONEY_COLUMNS: Final[tuple[str, ...]] = (
    "sale_price",
    "original_asking_price",
    "final_asking_price",
    "acquisition_cost",
    "reconditioning_cost",
    "pack_amount",
    "trade_allowance",
    "trade_acv",
    "cash_down",
    "amount_financed",
)

SALE_EVENT_DTYPES: Final[dict[str, str]] = {
    "sale_id": "string",
    "sale_date": "datetime64[s]",
    "delivery_date": "datetime64[s]",
    "dealership_id": "string",
    "vehicle_id": "string",
    "customer_id": "string",
    "salesperson_id": "string",
    "desk_manager_id": "string",
    "finance_manager_id": "string",
    "lead_source_id": "string",
    "sale_type": "string",
    "is_retail": "bool",
    "unit_count": "int16",
    "sale_price": "object",
    "msrp": "object",
    "original_asking_price": "object",
    "final_asking_price": "object",
    "acquisition_cost": "object",
    "reconditioning_cost": "object",
    "pack_amount": "object",
    "front_end_gross": "object",
    "back_end_gross": "object",
    "total_gross": "object",
    "trade_allowance": "object",
    "trade_acv": "object",
    "cash_down": "object",
    "amount_financed": "object",
    "days_in_inventory_at_sale": "int32",
    "source_system": "string",
}

#: ``lead_source_id`` is declared but never populated here. The lead and campaign entities
#: arrive in ``P1.4``; attribution is theirs to make, and inventing it in the sale
#: generator would mean two sources of truth for the same relationship.
LEAD_SOURCE_IS_DEFERRED: Final = True

# ---------------------------------------------------------------------------------------
# Deal types
# ---------------------------------------------------------------------------------------
SALE_TYPE_NEW_RETAIL: Final = "New Retail"
SALE_TYPE_USED_RETAIL: Final = "Used Retail"
SALE_TYPE_CERTIFIED_RETAIL: Final = "Certified Retail"
SALE_TYPE_LEASE: Final = "Lease"
SALE_TYPE_WHOLESALE: Final = "Wholesale"
SALE_TYPE_DEALER_TRADE: Final = "Dealer Trade"

ALLOWED_SALE_TYPES: Final[tuple[str, ...]] = (
    SALE_TYPE_NEW_RETAIL,
    SALE_TYPE_USED_RETAIL,
    SALE_TYPE_CERTIFIED_RETAIL,
    SALE_TYPE_LEASE,
    SALE_TYPE_WHOLESALE,
    SALE_TYPE_DEALER_TRADE,
)

#: The deal types that are retail. ``is_retail`` is **derived** from this set and is never
#: drawn: a random retail flag would let a wholesale unit count towards retail units sold,
#: which is the single most consequential way to overstate a dealership's performance.
RETAIL_SALE_TYPES: Final[frozenset[str]] = frozenset(
    {
        SALE_TYPE_NEW_RETAIL,
        SALE_TYPE_USED_RETAIL,
        SALE_TYPE_CERTIFIED_RETAIL,
        SALE_TYPE_LEASE,
    }
)

#: Deal-type mix by the unit's condition. A new unit is never sold as ``Used Retail``.
SALE_TYPE_WEIGHTS: Final[dict[str, dict[str, float]]] = {
    CONDITION_NEW: {
        SALE_TYPE_NEW_RETAIL: 0.70,
        SALE_TYPE_LEASE: 0.24,
        SALE_TYPE_DEALER_TRADE: 0.04,
        SALE_TYPE_WHOLESALE: 0.02,
    },
    CONDITION_CERTIFIED: {
        SALE_TYPE_CERTIFIED_RETAIL: 0.86,
        SALE_TYPE_LEASE: 0.05,
        SALE_TYPE_WHOLESALE: 0.06,
        SALE_TYPE_DEALER_TRADE: 0.03,
    },
    "Used": {
        SALE_TYPE_USED_RETAIL: 0.81,
        SALE_TYPE_WHOLESALE: 0.14,
        SALE_TYPE_DEALER_TRADE: 0.05,
    },
}

# ---------------------------------------------------------------------------------------
# Employee eligibility
# ---------------------------------------------------------------------------------------
#: Roles that may be recorded as the selling salesperson, in preference order. A Finance
#: Manager is absent by design and appears in :data:`PROHIBITED_SALESPERSON_ROLES`: F&I
#: income and vehicle gross are separately measured, and letting one person hold both
#: sides of a deal would corrupt both measures.
SALESPERSON_ROLES: Final[tuple[str, ...]] = (JOB_ROLE_SALESPERSON,)
SALESPERSON_FALLBACK_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
)
PROHIBITED_SALESPERSON_ROLES: Final[frozenset[str]] = frozenset({JOB_ROLE_FINANCE_MANAGER})

#: Roles that may desk a deal.
DESK_MANAGER_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_DESK_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
)

#: The only role that may be recorded as the finance manager on a deal.
FINANCE_MANAGER_ROLES: Final[tuple[str, ...]] = (JOB_ROLE_FINANCE_MANAGER,)

#: Probability that a retail deal is written by an F&I manager rather than desked as a
#: cash deal straight through. Never above 1.0: an F&I penetration rate above the eligible
#: transaction count is a prohibited synthetic pattern ([ARCHITECTURE.md §15.4]).
FINANCE_MANAGER_PARTICIPATION: Final = 0.91

# ---------------------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------------------
#: Expected days to sale for a unit of average aging propensity. This is the **mean** of
#: the gamma-shaped hazard below, not its scale: the scale is derived from it in
#: :func:`_lifetime_hazard`, so tuning this number moves the average the obvious way.
BASE_MEAN_DAYS_TO_SALE: Final = 58.0

#: Ceiling on the probability that any one unit sells inside the window. Below 1.0 so that
#: even a unit that sat all window has a genuine chance of still being in stock at the end.
SELL_THROUGH_CEILING: Final = 0.94

#: Shape parameter of the sale-timing hazard. Above 1.0 pushes the mode off day zero, so
#: units rarely sell the day they are booked in.
HAZARD_SHAPE: Final = 1.35

#: Days after which a unit is treated as dead stock that will not sell. The hazard is
#: evaluated over **days since acquisition**, not days since the window opened, which is
#: what makes a unit acquired during the warm-up arrive already aged: its remaining
#: hazard is on the declining tail, so it moves early in the window instead of behaving
#: like a fresh unit and pushing every sale towards the end of it.
HAZARD_HORIZON_DAYS: Final = 540

#: Share of otherwise-complete deals that are cancelled before delivery and therefore
#: never appear in this output. See the module docstring.
CANCELLATION_RATE: Final = 0.045

#: Month-of-year multiplier on sale volume. Spring, late summer and the year-end push are
#: the strong months; the deep winter weeks are the weakest.
SALE_MONTH_WEIGHT: Final[dict[int, float]] = {
    1: 0.80,
    2: 0.86,
    3: 1.12,
    4: 1.14,
    5: 1.22,
    6: 1.16,
    7: 1.06,
    8: 1.18,
    9: 1.02,
    10: 0.94,
    11: 0.92,
    12: 1.14,
}

#: Day-of-week multiplier, indexed by :meth:`datetime.date.weekday` (Monday is 0).
#: Saturday is the biggest retail day on any dealership's floor.
SALE_DAY_OF_WEEK_WEIGHT: Final[tuple[float, ...]] = (
    1.00,  # Monday
    0.96,  # Tuesday
    1.00,  # Wednesday
    1.06,  # Thursday
    1.12,  # Friday
    1.42,  # Saturday
    0.12,  # Sunday
)

#: Days between sale and delivery, and their relative weights. Delivery is never before
#: the sale.
DELIVERY_LAG_DAYS: Final[tuple[int, ...]] = (0, 1, 2, 3, 5)
DELIVERY_LAG_WEIGHTS: Final[tuple[float, ...]] = (0.52, 0.24, 0.12, 0.08, 0.04)

# ---------------------------------------------------------------------------------------
# Pricing and gross
# ---------------------------------------------------------------------------------------
#: The dealer pack: an internal charge added to every unit's cost before front-end gross
#: is struck. It is a real and standard practice, it differs by store, and it is why a
#: thin deal shows a negative front end. It is **not** a fee charged to a customer.
PACK_AMOUNT_BY_STORE: Final[dict[str, Decimal]] = {
    "GSA-001": Decimal("795.00"),
    "GSA-002": Decimal("750.00"),
    "GSA-003": Decimal("495.00"),
}
DEFAULT_PACK_AMOUNT: Final = Decimal("650.00")

#: Days of age between advertised markdowns, and the share cut at each one.
MARKDOWN_INTERVAL_DAYS: Final = 30
MARKDOWN_STEP_USED: Final = Decimal("0.017")
MARKDOWN_STEP_NEW: Final = Decimal("0.009")
MAXIMUM_MARKDOWN_STEPS: Final = 6

#: Negotiated discount off the current asking price, drawn ``(low, high, mode)`` and then
#: divided by the salesperson's gross-retention index, so a strong closer genuinely holds
#: more gross without the outcome ever being deterministic.
RETAIL_DISCOUNT: Final[tuple[float, float, float]] = (0.004, 0.080, 0.028)
MAXIMUM_RETAIL_DISCOUNT: Final = Decimal("0.14")

#: Floor applied to a salesperson's gross-retention index before it divides the discount,
#: so no single latent parameter can drive a deal to an implausible give-away.
MINIMUM_RETENTION: Final = Decimal("0.70")

#: Wholesale and dealer-trade proceeds as a share of total inventory investment. Wholesale
#: straddles 1.0: a store dumps an ageing unit at the auction and frequently takes a loss.
WHOLESALE_PROCEEDS_SHARE: Final[tuple[float, float, float]] = (0.84, 1.06, 0.95)
DEALER_TRADE_PROCEEDS_SHARE: Final[tuple[float, float, float]] = (0.94, 1.12, 1.02)

#: Back-end (finance and insurance) gross on a retail deal, before the finance manager's
#: own retention index is applied. Zero on wholesale and dealer trade by construction.
BACK_END_GROSS: Final[tuple[float, float, float]] = (0.0, 3000.0, 950.0)

#: Multiplier applied to back-end gross on a lease, which carries fewer eligible products.
LEASE_BACK_END_FACTOR: Final = Decimal("0.78")

#: Back-end retention used when the store has no finance manager on staff that day.
UNSTAFFED_FINANCE_FACTOR: Final = Decimal("0.55")

#: Share of retail deals that carry a trade-in, and the trade's value relative to the deal.
TRADE_IN_SHARE: Final = 0.38
TRADE_ACV_OF_SALE_PRICE: Final[tuple[float, float, float]] = (0.08, 0.44, 0.21)
#: Over-allowance: what the customer is shown is above actual cash value more often than
#: not, because the difference is taken out of the front-end gross instead.
TRADE_ALLOWANCE_OVER_ACV: Final[tuple[float, float, float]] = (0.98, 1.24, 1.06)

#: Share of retail deals that are financed or leased rather than paid in full.
FINANCED_SHARE: Final = 0.82

#: Cash down payment on a retail deal, drawn ``(low, high, mode)`` in dollars.
CASH_DOWN: Final[tuple[float, float, float]] = (0.0, 9000.0, 1750.0)
LEASE_CASH_DOWN_FACTOR: Final = Decimal("0.55")

_ZERO: Final = Decimal("0.00")
_ONE: Final = Decimal("1")

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (prefix reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_SALE_UNIQUE_ID: Final = "DQ-SLE-001"
CHECK_SALE_SCHEMA_MATCHES: Final = "DQ-SLE-002"
CHECK_SALE_NOT_BEFORE_ACQUISITION: Final = "DQ-SLE-003"
CHECK_SALE_GROSS_IDENTITIES: Final = "DQ-SLE-004"
CHECK_SALE_CUSTOMER_PRESENCE: Final = "DQ-SLE-005"
CHECK_SALE_IS_RETAIL_DERIVED: Final = "DQ-SLE-006"
CHECK_SALE_UNIT_COUNT: Final = "DQ-SLE-007"
CHECK_SALE_EMPLOYEE_ROLES: Final = "DQ-SLE-008"
CHECK_SALE_NO_PROHIBITED_PII: Final = "DQ-SLE-009"
CHECK_SALE_NEGATIVE_GROSS_PRESENT: Final = "DQ-SLE-010"

#: Every check identifier this module emits, in identifier order.
SALE_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_SALE_UNIQUE_ID,
    CHECK_SALE_SCHEMA_MATCHES,
    CHECK_SALE_NOT_BEFORE_ACQUISITION,
    CHECK_SALE_GROSS_IDENTITIES,
    CHECK_SALE_CUSTOMER_PRESENCE,
    CHECK_SALE_IS_RETAIL_DERIVED,
    CHECK_SALE_UNIT_COUNT,
    CHECK_SALE_EMPLOYEE_ROLES,
    CHECK_SALE_NO_PROHIBITED_PII,
    CHECK_SALE_NEGATIVE_GROSS_PRESENT,
)

#: Inclusive band the negative-front-end-gross share must fall inside. The lower bound is
#: above zero because a dataset with no losing deals is not a dealership; the upper bound
#: keeps it a minority.
NEGATIVE_GROSS_SHARE_BOUNDS: Final[tuple[float, float]] = (0.01, 0.45)

_WAREHOUSE_FACT_VEHICLE_SALE: Final = "warehouse.fact_vehicle_sale"

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_SALE_UNIQUE_ID,
            check_name="sale_event.sale_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "sale_id is the grain. A duplicate double-counts a unit and every gross "
                "measure struck from it, and nine of the specified KPIs read this fact."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_SCHEMA_MATCHES,
            check_name="sale_event matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "and this entity has fourteen monetary columns that would be silently "
                "interchangeable if the order drifted."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_NOT_BEFORE_ACQUISITION,
            check_name="no sale precedes the acquisition of its own vehicle",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "Selling a car the store does not own yet is an impossible date sequence "
                "and would produce a negative days-in-inventory, which every ageing "
                "measure would then average in."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_GROSS_IDENTITIES,
            check_name="the gross identities hold exactly, to the cent, on every row",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "front_end_gross = sale_price - acquisition_cost - reconditioning_cost - "
                "pack_amount, and total_gross = front_end_gross + back_end_gross. These "
                "are the arithmetic every gross KPI depends on; a cent of drift means a "
                "float reached a monetary value."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_CUSTOMER_PRESENCE,
            check_name="retail sales carry a known customer and wholesale need not",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "A retail unit was sold to somebody, so a missing customer is a defect. A "
                "wholesale unit went to the auction, so an absent customer is a modelled "
                "fact rather than a missing value. No sale may invent a customer the "
                "customer entity does not contain."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_IS_RETAIL_DERIVED,
            check_name="is_retail is exactly the derivation of sale_type",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "is_retail must be true for retail and lease and false for wholesale and "
                "dealer trade. Drawn independently it would let wholesale units inflate "
                "retail units sold, which is the most consequential possible overstatement."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_UNIT_COUNT,
            check_name="unit_count is 1 on every finalized sale",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "The grain is one physical vehicle, so the additive unit measure is 1. Any "
                "other value means the grain has been violated somewhere upstream."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_EMPLOYEE_ROLES,
            check_name="every employee on a sale held an eligible role at that store",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "A Finance Manager recorded as the salesperson would corrupt both F&I "
                "penetration and units-per-salesperson. The check resolves each employee "
                "against the SCD Type 2 timeline on the sale date, so a person credited "
                "at a store they had already left also fails."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_NO_PROHIBITED_PII,
            check_name="sale_event declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "A deal jacket is the single richest source of personal data in a real "
                "dealership. ARPI's carries none: no buyer name, no address, no credit "
                "score, no commission. The check inspects the schema, so an empty "
                "prohibited column still fails the run."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
        CheckDefinition(
            check_id=CHECK_SALE_NEGATIVE_GROSS_PRESENT,
            check_name="a negative front-end gross population is present and a minority",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.WARNING,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_SALE_EVENT,
            description=(
                "Real stores lose money on some units, so a dataset in which every deal "
                "makes money is unrealistically clean -- a prohibited synthetic pattern. "
                "A plausibility band rather than a hard rule, hence warning: the exact "
                "share is a modelling choice, its absence is a defect."
            ),
            applies_to=(_WAREHOUSE_FACT_VEHICLE_SALE,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class SaleRecord:
    """One finalized transaction, plus the lineage downstream generators need.

    Attributes:
        sale_id: Identifier in the reserved ``SLE-########`` scheme.
        sale_date: Date the deal was struck; always inside the reporting window.
        delivery_date: Date the unit was delivered; never before ``sale_date``.
        dealership_id: Selling store.
        vehicle_id: The unit sold.
        customer_id: The buyer, or ``None`` on a wholesale or dealer-trade disposal.
        salesperson_id: Selling salesperson, or ``None``.
        desk_manager_id: Manager who desked the deal, or ``None``.
        finance_manager_id: F&I manager who wrote the deal, or ``None``.
        sale_type: One of :data:`ALLOWED_SALE_TYPES`.
        is_retail: Derived from ``sale_type``; see :func:`is_retail_for_sale_type`.
        sale_price: Selling price of the vehicle.
        msrp: Manufacturer's suggested retail price, or ``None`` for a used unit.
        original_asking_price: The first advertised price, from the acquisition.
        final_asking_price: The advertised price after age-driven markdowns.
        acquisition_cost: Cost carried forward from the acquisition.
        reconditioning_cost: Reconditioning carried forward from the acquisition.
        pack_amount: The store's dealer pack.
        front_end_gross: Vehicle gross; may be negative.
        back_end_gross: Finance and insurance gross; zero on non-retail.
        total_gross: ``front_end_gross + back_end_gross``.
        trade_allowance: What the customer was shown for their trade.
        trade_acv: Actual cash value of that trade.
        cash_down: Cash the customer put down.
        amount_financed: Amount financed or capitalised.
        days_in_inventory_at_sale: ``sale_date - acquisition_date``, never negative.
        acquisition_id: The acquisition this sale disposes of.
        vehicle_model_id: Natural key of the unit's model, for downstream joins.
        condition_type: ``New``, ``Used`` or ``Certified``.
    """

    sale_id: str
    sale_date: date
    delivery_date: date
    dealership_id: str
    vehicle_id: str
    customer_id: str | None
    salesperson_id: str | None
    desk_manager_id: str | None
    finance_manager_id: str | None
    sale_type: str
    is_retail: bool
    sale_price: Decimal
    msrp: Decimal | None
    original_asking_price: Decimal
    final_asking_price: Decimal
    acquisition_cost: Decimal
    reconditioning_cost: Decimal
    pack_amount: Decimal
    front_end_gross: Decimal
    back_end_gross: Decimal
    total_gross: Decimal
    trade_allowance: Decimal
    trade_acv: Decimal
    cash_down: Decimal
    amount_financed: Decimal
    days_in_inventory_at_sale: int
    acquisition_id: str
    vehicle_model_id: str
    condition_type: str


@dataclass(frozen=True, slots=True)
class SaleLink:
    """The minimum an attribution generator needs to attach a lead to a finalized sale.

    This is the supported way for the lead, appointment and campaign generators (``P1.4``)
    to mark a lead as sold: pick a link whose ``dealership_id`` and ``customer_id`` match
    the lead, whose ``sale_date`` is on or after the lead's creation date, and carry
    ``sale_id`` onto the lead. Nothing else in this module needs to be imported to do it.

    Attributes:
        sale_id: The finalized sale's identifier.
        sale_date: Date the deal was struck.
        dealership_id: Selling store.
        customer_id: The buyer, or ``None`` on a wholesale or dealer-trade disposal.
        vehicle_id: The unit sold.
        vehicle_model_id: Natural key of the unit's model.
        salesperson_id: Selling salesperson, or ``None``.
        is_retail: Whether the transaction was retail.
    """

    sale_id: str
    sale_date: date
    dealership_id: str
    customer_id: str | None
    vehicle_id: str
    vehicle_model_id: str
    salesperson_id: str | None
    is_retail: bool


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def sale_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as an ``SLE-########`` identifier.

    Args:
        ordinal: 1-based position in the ordered sale population.

    Returns:
        The zero-padded identifier, e.g. ``"SLE-00003377"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive, or is too large for the reserved
            eight-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"sale_id ordinals start at 1, got {ordinal}.", entity=ENTITY_SALE_EVENT
        )
    if ordinal >= 10**SALE_ID_DIGITS:
        raise GenerationError(
            f"sale_id ordinal {ordinal} does not fit the reserved "
            f"{SALE_ID_PREFIX}{'#' * SALE_ID_DIGITS} scheme. Widen the identifier scheme "
            "in PHASE1_CONTRACT.md §5 before generating this many sales.",
            entity=ENTITY_SALE_EVENT,
        )
    return f"{SALE_ID_PREFIX}{ordinal:0{SALE_ID_DIGITS}d}"


def is_retail_for_sale_type(sale_type: str) -> bool:
    """Derive ``is_retail`` from ``sale_type``.

    This is the **only** way ``is_retail`` is ever produced. It is a total function of
    the deal type, so the flag cannot contradict it.

    Args:
        sale_type: One of :data:`ALLOWED_SALE_TYPES`.

    Returns:
        ``True`` for retail and lease, ``False`` for wholesale and dealer trade.

    Raises:
        GenerationError: If ``sale_type`` is outside the declared enumeration.
    """
    if sale_type not in ALLOWED_SALE_TYPES:
        raise GenerationError(
            f"sale_type {sale_type!r} is outside the declared enumeration "
            f"({', '.join(ALLOWED_SALE_TYPES)}).",
            entity=ENTITY_SALE_EVENT,
            sale_type=sale_type,
        )
    return sale_type in RETAIL_SALE_TYPES


def pack_amount_for(dealership_id: str) -> Decimal:
    """Return the dealer pack a store adds to every unit's cost.

    Args:
        dealership_id: Selling store.

    Returns:
        The store's pack, or :data:`DEFAULT_PACK_AMOUNT` for a store this module has not
        been told about.
    """
    return PACK_AMOUNT_BY_STORE.get(dealership_id, DEFAULT_PACK_AMOUNT)


def markdown_to_asking_price(
    original_asking_price: Decimal, days_in_inventory: int, condition_type: str
) -> Decimal:
    """Return the advertised price after age-driven markdowns.

    A unit is marked down one step per :data:`MARKDOWN_INTERVAL_DAYS` of age, up to
    :data:`MAXIMUM_MARKDOWN_STEPS`. This is the mechanism behind the negative relationship
    between age at sale and front-end gross, and it is deliberately not the only one: the
    negotiated discount is drawn separately, so the relationship holds in direction
    without being deterministic.

    Args:
        original_asking_price: The first advertised price.
        days_in_inventory: Days between acquisition and sale.
        condition_type: ``New``, ``Used`` or ``Certified``.

    Returns:
        The current advertised price, quantized to the cent.
    """
    steps = min(max(days_in_inventory, 0) // MARKDOWN_INTERVAL_DAYS, MAXIMUM_MARKDOWN_STEPS)
    step = MARKDOWN_STEP_NEW if condition_type == CONDITION_NEW else MARKDOWN_STEP_USED
    return money(original_asking_price * (_ONE - step * steps))


def front_end_gross_for(
    sale_price: Decimal,
    acquisition_cost: Decimal,
    reconditioning_cost: Decimal,
    pack_amount: Decimal,
) -> Decimal:
    """Compute front-end gross from its four components.

    Args:
        sale_price: Selling price of the vehicle.
        acquisition_cost: What the store paid for it.
        reconditioning_cost: What the store spent making it front-line ready.
        pack_amount: The store's dealer pack.

    Returns:
        ``sale_price - acquisition_cost - reconditioning_cost - pack_amount``, quantized
        to the cent. May be negative, and legitimately often is.
    """
    return money(sale_price - acquisition_cost - reconditioning_cost - pack_amount)


# ---------------------------------------------------------------------------------------
# Employee routing
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _RoleInterval:
    """One employee's tenure in one role at one store, as an inclusive date range.

    ``selection_weight`` and ``gross_retention`` are the latent parameters from
    :func:`arpi.generation.employee.employee_performance_profiles`. They are generation
    inputs and never become columns of anything: publishing them would turn a fabrication
    parameter into what looks like a measurement of a person.
    """

    employee_id: str
    dealership_id: str
    job_role: str
    start_date: date
    end_date: date
    selection_weight: float
    gross_retention: float


def _role_intervals(config: ArpiConfig) -> tuple[_RoleInterval, ...]:
    """Flatten the roster into role intervals, honouring the SCD Type 2 timeline.

    A person who changed role or store mid-window contributes two intervals, so a sale is
    never credited to somebody at a store they had not joined or a role they no longer
    held. Employment is bounded by ``hire_date`` and ``termination_date``.
    """
    profiles = employee_performance_profiles(config)
    intervals: list[_RoleInterval] = []
    for assignment in build_employee_assignments(config):
        profile = profiles[assignment.employee_id]
        last_day = assignment.termination_date or date(9999, 12, 31)
        if assignment.change_date is not None:
            intervals.append(
                _build_interval(
                    assignment,
                    profile,
                    dealership_id=str(assignment.prior_dealership_id),
                    job_role=str(assignment.prior_job_role),
                    start_date=assignment.hire_date,
                    end_date=min(assignment.change_date - timedelta(days=1), last_day),
                )
            )
        intervals.append(
            _build_interval(
                assignment,
                profile,
                dealership_id=assignment.dealership_id,
                job_role=assignment.job_role,
                start_date=assignment.change_date or assignment.hire_date,
                end_date=last_day,
            )
        )
    return tuple(intervals)


def _build_interval(
    assignment: EmployeeAssignment,
    profile: EmployeePerformanceProfile,
    *,
    dealership_id: str,
    job_role: str,
    start_date: date,
    end_date: date,
) -> _RoleInterval:
    """Build one role interval, weighted by the latent volume and closing indices."""
    return _RoleInterval(
        employee_id=assignment.employee_id,
        dealership_id=dealership_id,
        job_role=job_role,
        start_date=start_date,
        end_date=end_date,
        selection_weight=max(profile.volume_index * profile.closing_rate_index, 0.05),
        gross_retention=profile.gross_retention_index,
    )


def _candidates(
    intervals: Sequence[_RoleInterval],
    dealership_id: str,
    roles: Sequence[str],
    on_date: date,
) -> tuple[tuple[_RoleInterval, ...], tuple[float, ...]]:
    """Return the employees eligible for a role at one store on one date."""
    eligible = tuple(
        interval
        for interval in intervals
        if interval.dealership_id == dealership_id
        and interval.job_role in roles
        and interval.start_date <= on_date <= interval.end_date
    )
    return eligible, tuple(interval.selection_weight for interval in eligible)


def _choose(
    intervals: Sequence[_RoleInterval],
    dealership_id: str,
    roles: Sequence[str],
    on_date: date,
    rng: random.Random,
) -> _RoleInterval | None:
    """Pick one eligible employee, weighted by their latent performance indices."""
    eligible, weights = _candidates(intervals, dealership_id, roles, on_date)
    if not eligible:
        return None
    return rng.choices(eligible, weights=weights, k=1)[0]


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
def build_sale_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[SaleRecord, ...]:
    """Build every finalized sale for the active profile.

    This is the public entry point the inventory-snapshot and attribution generators call.

    Args:
        config: Resolved configuration supplying the master seed, the scale mode and the
            reporting window.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The finalized sales, ordered by ``sale_id``, which is assigned over
        ``(sale_date, vehicle_id)`` so the ordering is stable and chronological.
    """
    acquisitions = build_acquisition_records(config, catalogue_path)
    rng = rng_for(config.random_seed, SALE_NAMESPACE)
    intervals = _role_intervals(config)
    customers = customer_selection_pool(config)
    window_start = config.reporting.start_date
    window_end = config.reporting.end_date

    drafts: list[dict[str, Any]] = []
    cancelled = 0
    hazards: dict[float, tuple[float, ...]] = {}
    for acquisition in acquisitions:
        draft = _draft_sale(
            acquisition,
            rng=rng,
            intervals=intervals,
            customers=customers,
            window_start=window_start,
            window_end=window_end,
            hazards=hazards,
        )
        if draft is None:
            continue
        if rng.random() < CANCELLATION_RATE:
            # Modelled, then excluded: an unwound deal is not a finalized sale, and the
            # unit goes back into inventory rather than carrying a cancelled flag.
            cancelled += 1
            continue
        drafts.append(draft)

    drafts.sort(key=lambda draft: (draft["sale_date"], draft["vehicle_id"]))
    records = tuple(
        SaleRecord(sale_id=sale_id_for(ordinal), **draft)
        for ordinal, draft in enumerate(drafts, start=1)
    )
    _log_declared_distributions(records, len(acquisitions), cancelled)
    return records


def _draft_sale(
    acquisition: AcquisitionRecord,
    *,
    rng: random.Random,
    intervals: Sequence[_RoleInterval],
    customers: Sequence[CustomerSelection],
    window_start: date,
    window_end: date,
    hazards: dict[float, tuple[float, ...]],
) -> dict[str, Any] | None:
    """Draft the sale of one unit, or return ``None`` when it does not sell.

    The survival draw is **conditional on the age the unit already carries**. A unit
    acquired during the warm-up has survived to day one of the window without selling, so
    its probability of selling inside the window is the remaining hazard mass over the
    window divided by the remaining hazard mass over the whole horizon -- not the
    unconditional probability a fresh unit would face.
    """
    available_from = max(acquisition.acquisition_date, window_start)
    hazard = _lifetime_hazard(BASE_MEAN_DAYS_TO_SALE * acquisition.aging_propensity, hazards)
    first_offset = (available_from - acquisition.acquisition_date).days
    last_offset = min((window_end - acquisition.acquisition_date).days, HAZARD_HORIZON_DAYS)
    if first_offset > last_offset:
        return None
    remaining = math.fsum(hazard[first_offset:])
    if remaining <= 0.0:  # pragma: no cover - dead stock beyond the modelling horizon
        return None
    if rng.random() >= SELL_THROUGH_CEILING * (
        math.fsum(hazard[first_offset : last_offset + 1]) / remaining
    ):
        return None

    sale_date = _draw_sale_date(
        rng, acquisition.acquisition_date, available_from, window_end, hazard
    )
    sale_type = _weighted_choice(rng, SALE_TYPE_WEIGHTS[acquisition.condition_type])
    is_retail = is_retail_for_sale_type(sale_type)

    customer = select_customer_for_sale(customers, sale_date, rng) if is_retail else None
    if is_retail and customer is None:
        # No customer had interacted by this date, so there is nobody to sell to. The unit
        # stays in inventory rather than the generator inventing a buyer.
        return None

    salesperson = _choose_salesperson(intervals, acquisition.dealership_id, sale_date, rng)
    desk_manager = _choose(
        intervals, acquisition.dealership_id, DESK_MANAGER_ROLES, sale_date, rng
    )
    finance_manager = (
        _choose(intervals, acquisition.dealership_id, FINANCE_MANAGER_ROLES, sale_date, rng)
        if is_retail and rng.random() < FINANCE_MANAGER_PARTICIPATION
        else None
    )

    days_in_inventory = (sale_date - acquisition.acquisition_date).days
    pricing = _draw_pricing(
        acquisition,
        rng=rng,
        sale_type=sale_type,
        is_retail=is_retail,
        days_in_inventory=days_in_inventory,
        salesperson=salesperson,
        finance_manager=finance_manager,
    )
    return {
        "sale_date": sale_date,
        "delivery_date": _draw_delivery_date(rng, sale_date, window_end),
        "dealership_id": acquisition.dealership_id,
        "vehicle_id": acquisition.vehicle_id,
        "customer_id": customer.customer_id if customer is not None else None,
        "salesperson_id": salesperson.employee_id if salesperson is not None else None,
        "desk_manager_id": desk_manager.employee_id if desk_manager is not None else None,
        "finance_manager_id": (
            finance_manager.employee_id if finance_manager is not None else None
        ),
        "sale_type": sale_type,
        "is_retail": is_retail,
        "msrp": acquisition.msrp,
        "original_asking_price": acquisition.original_asking_price,
        "acquisition_cost": acquisition.acquisition_cost,
        "reconditioning_cost": acquisition.reconditioning_cost,
        "days_in_inventory_at_sale": days_in_inventory,
        "acquisition_id": acquisition.acquisition_id,
        "vehicle_model_id": acquisition.vehicle_model_id,
        "condition_type": acquisition.condition_type,
        **pricing,
    }


def _choose_salesperson(
    intervals: Sequence[_RoleInterval], dealership_id: str, sale_date: date, rng: random.Random
) -> _RoleInterval | None:
    """Pick the selling salesperson, never a Finance Manager.

    Salespeople are preferred. Where a store has none on staff that day the deal is
    credited to a sales or general manager, which is what actually happens on a small
    floor. The F&I desk is never eligible: see :data:`PROHIBITED_SALESPERSON_ROLES`.
    """
    chosen = _choose(intervals, dealership_id, SALESPERSON_ROLES, sale_date, rng)
    if chosen is not None:
        return chosen
    return _choose(intervals, dealership_id, SALESPERSON_FALLBACK_ROLES, sale_date, rng)


def _lifetime_hazard(mean_days: float, cache: dict[float, tuple[float, ...]]) -> tuple[float, ...]:
    """Return the unnormalised days-to-sale density for one mean, indexed by day of age.

    The shape is ``d ** HAZARD_SHAPE * exp(-d / mean_days)``: units rarely move the day
    they are booked in, most move within a couple of months, and the tail thins out
    rather than stopping. Results are cached because ``mean_days`` takes only as many
    distinct values as there are aging propensities.
    """
    cached = cache.get(mean_days)
    if cached is not None:
        return cached
    # d ** k * exp(-d / scale) is a gamma density of shape k + 1, whose mean is
    # (k + 1) * scale. Solving for the scale keeps ``mean_days`` meaning what it says.
    scale = mean_days / (HAZARD_SHAPE + 1.0)
    density = tuple(
        ((offset + 1) ** HAZARD_SHAPE) * math.exp(-(offset + 1) / scale)
        for offset in range(HAZARD_HORIZON_DAYS + 1)
    )
    cache[mean_days] = density
    return density


def _draw_sale_date(
    rng: random.Random,
    acquisition_date: date,
    available_from: date,
    window_end: date,
    hazard: Sequence[float],
) -> date:
    """Place the sale date, combining the time-on-lot hazard with calendar seasonality.

    The hazard is indexed by days since **acquisition**, so an aged warm-up unit is drawn
    from the declining tail of its own lifetime rather than from the start of a fresh one.
    """
    span = (window_end - available_from).days + 1
    base_offset = (available_from - acquisition_date).days
    candidates = [available_from + timedelta(days=offset) for offset in range(span)]
    weights = [
        hazard[min(base_offset + offset, HAZARD_HORIZON_DAYS)]
        * SALE_MONTH_WEIGHT[candidate.month]
        * SALE_DAY_OF_WEEK_WEIGHT[candidate.weekday()]
        for offset, candidate in enumerate(candidates)
    ]
    return rng.choices(candidates, weights=weights, k=1)[0]


def _draw_delivery_date(rng: random.Random, sale_date: date, window_end: date) -> date:
    """Place the delivery date on or after the sale date, inside the reporting window."""
    lag = rng.choices(DELIVERY_LAG_DAYS, weights=DELIVERY_LAG_WEIGHTS, k=1)[0]
    return min(sale_date + timedelta(days=lag), window_end)


def _draw_pricing(
    acquisition: AcquisitionRecord,
    *,
    rng: random.Random,
    sale_type: str,
    is_retail: bool,
    days_in_inventory: int,
    salesperson: _RoleInterval | None,
    finance_manager: _RoleInterval | None,
) -> dict[str, Any]:
    """Draw every monetary value on one deal and strike both gross identities."""
    final_asking = markdown_to_asking_price(
        acquisition.original_asking_price, days_in_inventory, acquisition.condition_type
    )
    pack = pack_amount_for(acquisition.dealership_id)
    investment = acquisition.acquisition_cost + acquisition.reconditioning_cost

    if not is_retail:
        share = (
            WHOLESALE_PROCEEDS_SHARE
            if sale_type == SALE_TYPE_WHOLESALE
            else DEALER_TRADE_PROCEEDS_SHARE
        )
        sale_price = money(investment * _decimal_triangular(rng, *share))
    else:
        retention = Decimal(
            str(salesperson.gross_retention if salesperson is not None else 1.0)
        )
        discount = min(
            _decimal_triangular(rng, *RETAIL_DISCOUNT) / max(retention, MINIMUM_RETENTION),
            MAXIMUM_RETAIL_DISCOUNT,
        )
        sale_price = money(final_asking * (_ONE - discount))

    front_end = front_end_gross_for(
        sale_price, acquisition.acquisition_cost, acquisition.reconditioning_cost, pack
    )
    back_end = _draw_back_end_gross(rng, sale_type, is_retail=is_retail, manager=finance_manager)
    trade_allowance, trade_acv = _draw_trade(rng, sale_price, is_retail=is_retail)
    cash_down, amount_financed = _draw_funding(
        rng, sale_price, trade_allowance, sale_type, is_retail=is_retail
    )
    return {
        "sale_price": sale_price,
        "final_asking_price": final_asking,
        "pack_amount": pack,
        "front_end_gross": front_end,
        "back_end_gross": back_end,
        "total_gross": money(front_end + back_end),
        "trade_allowance": trade_allowance,
        "trade_acv": trade_acv,
        "cash_down": cash_down,
        "amount_financed": amount_financed,
    }


def _draw_back_end_gross(
    rng: random.Random, sale_type: str, *, is_retail: bool, manager: _RoleInterval | None
) -> Decimal:
    """Draw finance and insurance gross, which only a retail deal can produce."""
    if not is_retail:
        return _ZERO
    drawn = money(Decimal(str(round(rng.triangular(*BACK_END_GROSS), 2))))
    factor = (
        Decimal(str(manager.gross_retention))
        if manager is not None
        else UNSTAFFED_FINANCE_FACTOR
    )
    if sale_type == SALE_TYPE_LEASE:
        factor *= LEASE_BACK_END_FACTOR
    return money(drawn * factor)


def _draw_trade(
    rng: random.Random, sale_price: Decimal, *, is_retail: bool
) -> tuple[Decimal, Decimal]:
    """Draw ``(trade_allowance, trade_acv)``; both are zero when there is no trade."""
    if not is_retail or rng.random() >= TRADE_IN_SHARE:
        return _ZERO, _ZERO
    acv = money(sale_price * _decimal_triangular(rng, *TRADE_ACV_OF_SALE_PRICE))
    allowance = money(acv * _decimal_triangular(rng, *TRADE_ALLOWANCE_OVER_ACV))
    return allowance, acv


def _draw_funding(
    rng: random.Random,
    sale_price: Decimal,
    trade_allowance: Decimal,
    sale_type: str,
    *,
    is_retail: bool,
) -> tuple[Decimal, Decimal]:
    """Draw ``(cash_down, amount_financed)``; a wholesale disposal has neither."""
    if not is_retail:
        return _ZERO, _ZERO
    drawn = Decimal(str(round(rng.triangular(*CASH_DOWN), 2)))
    if sale_type == SALE_TYPE_LEASE:
        drawn *= LEASE_CASH_DOWN_FACTOR
    cash_down = money(min(drawn, sale_price))
    financed = sale_type == SALE_TYPE_LEASE or rng.random() < FINANCED_SHARE
    if not financed:
        return cash_down, _ZERO
    return cash_down, money(max(sale_price - cash_down - trade_allowance, _ZERO))


def _decimal_triangular(rng: random.Random, low: float, high: float, mode: float) -> Decimal:
    """Draw a triangular variate and return it as an exact ``Decimal`` multiplier."""
    return Decimal(str(round(rng.triangular(low, high, mode), 6)))


def _weighted_choice(rng: random.Random, weights: dict[str, float]) -> str:
    """Draw one key from a weight mapping, iterating in a stable declared order."""
    keys = list(weights)
    return rng.choices(keys, weights=[weights[key] for key in keys], k=1)[0]


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class SaleGenerator(BaseGenerator):
    """Build one ``sale_event`` row per finalized vehicle transaction."""

    entity_name = ENTITY_SALE_EVENT
    declared_columns = SALE_EVENT_COLUMNS
    namespace = SALE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the sale frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 29 contract columns, in order, ordered by ``sale_id``.
        """
        records = build_sale_records(config)
        frame = pd.DataFrame.from_records(
            [sale_row(record) for record in records], columns=list(SALE_EVENT_COLUMNS)
        )
        return frame.astype(SALE_EVENT_DTYPES)


def sale_row(record: SaleRecord) -> dict[str, Any]:
    """Render one sale record as its declared row.

    Args:
        record: The record to render.

    Returns:
        A mapping keyed by :data:`SALE_EVENT_COLUMNS`.
    """
    return {
        "sale_id": record.sale_id,
        "sale_date": record.sale_date,
        "delivery_date": record.delivery_date,
        "dealership_id": record.dealership_id,
        "vehicle_id": record.vehicle_id,
        "customer_id": record.customer_id,
        "salesperson_id": record.salesperson_id,
        "desk_manager_id": record.desk_manager_id,
        "finance_manager_id": record.finance_manager_id,
        "lead_source_id": None,
        "sale_type": record.sale_type,
        "is_retail": record.is_retail,
        "unit_count": 1,
        "sale_price": record.sale_price,
        "msrp": record.msrp,
        "original_asking_price": record.original_asking_price,
        "final_asking_price": record.final_asking_price,
        "acquisition_cost": record.acquisition_cost,
        "reconditioning_cost": record.reconditioning_cost,
        "pack_amount": record.pack_amount,
        "front_end_gross": record.front_end_gross,
        "back_end_gross": record.back_end_gross,
        "total_gross": record.total_gross,
        "trade_allowance": record.trade_allowance,
        "trade_acv": record.trade_acv,
        "cash_down": record.cash_down,
        "amount_financed": record.amount_financed,
        "days_in_inventory_at_sale": record.days_in_inventory_at_sale,
        "source_system": SOURCE_SYSTEM,
    }


def generate_sale_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``sale_event`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return SaleGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Helpers for downstream generators
# ---------------------------------------------------------------------------------------
def sale_links(config: ArpiConfig, catalogue_path: Path | None = None) -> tuple[SaleLink, ...]:
    """Return the link records an attribution generator joins leads to sales through.

    Args:
        config: Resolved configuration.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        One :class:`SaleLink` per finalized sale, ordered by ``sale_id``.
    """
    return tuple(
        SaleLink(
            sale_id=record.sale_id,
            sale_date=record.sale_date,
            dealership_id=record.dealership_id,
            customer_id=record.customer_id,
            vehicle_id=record.vehicle_id,
            vehicle_model_id=record.vehicle_model_id,
            salesperson_id=record.salesperson_id,
            is_retail=record.is_retail,
        )
        for record in build_sale_records(config, catalogue_path)
    )


def disposition_dates(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> dict[str, date]:
    """Map every sold ``vehicle_id`` to the date it left inventory.

    The inventory-snapshot generator needs this to stop snapshotting a unit: a vehicle
    absent from the mapping never sold inside the window and is still in stock at the end
    of it.

    Args:
        config: Resolved configuration.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A mapping of ``vehicle_id`` to ``sale_date``, in ``vehicle_id`` order.
    """
    records = build_sale_records(config, catalogue_path)
    return {record.vehicle_id: record.sale_date for record in sorted(records, key=_by_vehicle)}


def _by_vehicle(record: SaleRecord) -> str:
    """Sort key placing sale records in ``vehicle_id`` order."""
    return record.vehicle_id


def _log_declared_distributions(
    records: Sequence[SaleRecord], acquired: int, cancelled: int
) -> None:
    """Log sell-through, the deal-type mix and the negative-gross share actually produced."""
    if acquired == 0:  # pragma: no cover - the population is never empty
        return
    mix: dict[str, int] = {}
    for record in records:
        mix[record.sale_type] = mix.get(record.sale_type, 0) + 1
    negative = sum(1 for record in records if record.front_end_gross < 0)
    _LOGGER.info(
        "sale_event distributions: sales=%d acquired=%d sell_through=%.4f cancelled=%d "
        "negative_front_end_share=%.4f sale_type=%s",
        len(records),
        acquired,
        len(records) / acquired,
        cancelled,
        (negative / len(records)) if records else 0.0,
        {name: round(count / len(records), 4) for name, count in sorted(mix.items())}
        if records
        else {},
    )


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_sale_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-SLE-001`` through ``DQ-SLE-010`` against the sale source entity.

    Args:
        dataset: The generated ``sale_event`` dataset.
        config: Resolved configuration, used to rebuild the acquisition dates, the
            customer population and the employee timeline the sales must agree with.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A report containing ten results, in check-id order.
    """
    frame = dataset.frame
    acquisition_dates = {
        record.vehicle_id: record.acquisition_date
        for record in build_acquisition_records(config, catalogue_path)
    }
    known_customers = {selection.customer_id for selection in customer_selection_pool(config)}
    return ValidationReport(
        (
            replace(
                check_unique_column(
                    frame,
                    "sale_id",
                    check_id=CHECK_SALE_UNIQUE_ID,
                    check_name="sale_event.sale_id is unique",
                    target_object=ENTITY_SALE_EVENT,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            check_column_schema(
                frame,
                SALE_EVENT_COLUMNS,
                check_id=CHECK_SALE_SCHEMA_MATCHES,
                check_name="sale_event matches its declared column contract",
                target_object=ENTITY_SALE_EVENT,
            ),
            _check_not_before_acquisition(frame, acquisition_dates),
            _check_gross_identities(frame),
            _check_customer_presence(frame, known_customers),
            _check_is_retail_derived(frame),
            _check_unit_count(frame),
            _check_employee_roles(frame, _role_intervals(config)),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_SALE_NO_PROHIBITED_PII,
                check_name="sale_event declares no prohibited personal-data column",
                target_object=ENTITY_SALE_EVENT,
            ),
            _check_negative_gross_present(frame),
        )
    )


def _base_result(
    check_id: str,
    check_name: str,
    category: str,
    severity: CheckSeverity = CheckSeverity.CRITICAL,
) -> CheckResult:
    """Build the passing skeleton shared by this module's bespoke checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_SALE_EVENT,
        severity=severity,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_not_before_acquisition(
    frame: pd.DataFrame, acquisition_dates: dict[str, date]
) -> CheckResult:
    """``DQ-SLE-003`` -- no sale precedes the acquisition of its own vehicle."""
    base = _base_result(
        CHECK_SALE_NOT_BEFORE_ACQUISITION,
        "no sale precedes the acquisition of its own vehicle",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    columns = ("sale_id", "vehicle_id", "sale_date", "delivery_date", "days_in_inventory_at_sale")
    for sale_id, vehicle_id, sale_date, delivery_date, days in zip(
        *(frame[column] for column in columns), strict=True
    ):
        acquired = acquisition_dates.get(str(vehicle_id))
        sold = pd.Timestamp(sale_date).date()
        if acquired is None:
            offending.append(f"{sale_id}: vehicle {vehicle_id} has no acquisition")
            continue
        if sold < acquired:
            offending.append(f"{sale_id}: sold {sold.isoformat()} before {acquired.isoformat()}")
        elif int(days) != (sold - acquired).days:
            offending.append(f"{sale_id}: days_in_inventory_at_sale {days} disagrees with dates")
        if pd.Timestamp(delivery_date).date() < sold:
            offending.append(f"{sale_id}: delivered before it was sold")
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} sale(s) violate the acquisition-to-delivery date ordering: "
        f"{'; '.join(offending[:5])}.",
        failed_record_count=len(offending),
    )


def _check_gross_identities(frame: pd.DataFrame) -> CheckResult:
    """``DQ-SLE-004`` -- both gross identities hold exactly, to the cent."""
    base = _base_result(
        CHECK_SALE_GROSS_IDENTITIES,
        "the gross identities hold exactly, to the cent, on every row",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending: list[str] = []
    columns = (
        "sale_id",
        "sale_price",
        "acquisition_cost",
        "reconditioning_cost",
        "pack_amount",
        "front_end_gross",
        "back_end_gross",
        "total_gross",
    )
    for sale_id, price, cost, recon, pack, front, back, total in zip(
        *(frame[column] for column in columns), strict=True
    ):
        expected_front = money(
            Decimal(str(price)) - Decimal(str(cost)) - Decimal(str(recon)) - Decimal(str(pack))
        )
        if Decimal(str(front)) != expected_front:
            offending.append(f"{sale_id}: front_end_gross {front} != {expected_front}")
            continue
        expected_total = money(Decimal(str(front)) + Decimal(str(back)))
        if Decimal(str(total)) != expected_total:
            offending.append(f"{sale_id}: total_gross {total} != {expected_total}")
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} row(s) break a gross identity: {'; '.join(offending[:5])}. Every "
        "monetary value must be a Decimal quantized to the cent.",
        failed_record_count=len(offending),
    )


def _check_customer_presence(frame: pd.DataFrame, known_customers: set[str]) -> CheckResult:
    """``DQ-SLE-005`` -- retail carries a known customer; non-retail may carry none."""
    base = _base_result(
        CHECK_SALE_CUSTOMER_PRESENCE,
        "retail sales carry a known customer and wholesale need not",
        CHECK_CATEGORY_REFERENTIAL,
    )
    offending: list[str] = []
    for sale_id, is_retail, customer_id in zip(
        frame["sale_id"], frame["is_retail"], frame["customer_id"], strict=True
    ):
        missing = customer_id is None or pd.isna(customer_id)
        if bool(is_retail) and missing:
            offending.append(f"{sale_id}: retail sale with no customer")
        elif not missing and str(customer_id) not in known_customers:
            offending.append(f"{sale_id}: customer {customer_id} does not exist")
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} sale(s) name no customer where one is required, or name a "
        f"customer the customer entity does not contain: {'; '.join(offending[:5])}.",
        failed_record_count=len(offending),
    )


def _check_is_retail_derived(frame: pd.DataFrame) -> CheckResult:
    """``DQ-SLE-006`` -- ``is_retail`` is exactly the derivation of ``sale_type``."""
    base = _base_result(
        CHECK_SALE_IS_RETAIL_DERIVED,
        "is_retail is exactly the derivation of sale_type",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    unknown = sorted(
        {str(value) for value in frame["sale_type"] if str(value) not in ALLOWED_SALE_TYPES}
    )
    mismatched = sum(
        1
        for sale_type, is_retail in zip(frame["sale_type"], frame["is_retail"], strict=True)
        if str(sale_type) in ALLOWED_SALE_TYPES
        and bool(is_retail) is not (str(sale_type) in RETAIL_SALE_TYPES)
    )
    total = mismatched + len(unknown)
    result = replace(base, observed_value=float(total))
    if total == 0:
        return result
    return result.failed(
        f"{mismatched} row(s) carry an is_retail flag that contradicts their sale_type"
        + (f", and sale_type(s) {', '.join(unknown)} are outside the enumeration" if unknown else "")
        + ".",
        failed_record_count=total,
    )


def _check_unit_count(frame: pd.DataFrame) -> CheckResult:
    """``DQ-SLE-007`` -- ``unit_count`` is 1 on every row."""
    base = _base_result(
        CHECK_SALE_UNIT_COUNT,
        "unit_count is 1 on every finalized sale",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int((frame["unit_count"] != 1).sum())
    result = replace(base, observed_value=float(offending))
    if offending == 0:
        return result
    return result.failed(
        f"{offending} sale(s) carry a unit_count other than 1. The grain is one physical "
        "vehicle per row.",
        failed_record_count=offending,
    )


def _check_employee_roles(
    frame: pd.DataFrame, intervals: Sequence[_RoleInterval]
) -> CheckResult:
    """``DQ-SLE-008`` -- every employee on a sale held an eligible role on that date."""
    base = _base_result(
        CHECK_SALE_EMPLOYEE_ROLES,
        "every employee on a sale held an eligible role at that store",
        CHECK_CATEGORY_REFERENTIAL,
    )
    expectations = (
        ("salesperson_id", (*SALESPERSON_ROLES, *SALESPERSON_FALLBACK_ROLES)),
        ("desk_manager_id", DESK_MANAGER_ROLES),
        ("finance_manager_id", FINANCE_MANAGER_ROLES),
    )
    offending: list[str] = []
    for record in frame.to_dict(orient="records"):
        sale_date = pd.Timestamp(record["sale_date"]).date()
        store = str(record["dealership_id"])
        for column, roles in expectations:
            employee_id = record[column]
            if employee_id is None or pd.isna(employee_id):
                continue
            eligible, _ = _candidates(intervals, store, roles, sale_date)
            if str(employee_id) not in {interval.employee_id for interval in eligible}:
                offending.append(f"{record['sale_id']}: {column} {employee_id} is not eligible")
    result = replace(base, observed_value=float(len(offending)))
    if not offending:
        return result
    return result.failed(
        f"{len(offending)} employee assignment(s) on sales are invalid for the store, the "
        f"role or the date: {'; '.join(offending[:5])}. A Finance Manager may never be the "
        "salesperson.",
        failed_record_count=len(offending),
    )


def _check_negative_gross_present(frame: pd.DataFrame) -> CheckResult:
    """``DQ-SLE-010`` -- losing deals exist, and remain a minority."""
    minimum, maximum = NEGATIVE_GROSS_SHARE_BOUNDS
    base = _base_result(
        CHECK_SALE_NEGATIVE_GROSS_PRESENT,
        "a negative front-end gross population is present and a minority",
        CHECK_CATEGORY_BUSINESS_RULE,
        severity=CheckSeverity.WARNING,
    )
    total = int(frame.shape[0])
    if total == 0:
        return base.failed("sale_event produced no rows, so the gross population is absent.")
    negative = sum(1 for value in frame["front_end_gross"] if Decimal(str(value)) < 0)
    share = negative / total
    result = replace(
        base, observed_value=share, expected_value=(minimum + maximum) / 2
    )
    if minimum <= share <= maximum:
        return result
    return result.failed(
        f"{negative} of {total} sale(s) carry a negative front-end gross, a share of "
        f"{share:.4f}, outside the plausibility band [{minimum}, {maximum}]. No losing "
        "deals at all is unrealistically clean; a majority of them is not a business."
    )
