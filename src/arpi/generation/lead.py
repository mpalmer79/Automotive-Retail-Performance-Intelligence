"""Generator for the ``lead_event`` source entity behind ``warehouse.fact_lead``.

Grain: **one row per unique CRM lead**. The columns mirror ``warehouse.fact_lead``
(``PHASE1_CONTRACT.md`` §7) with the surrogate key dropped and the remaining keys replaced
by the natural identifiers a CRM would actually carry, exactly as ``sale_event`` mirrors
``warehouse.fact_vehicle_sale``.

No communication content, ever
------------------------------
A real CRM record is mostly *text about a person*: the message they sent, the transcript of
the call, the note the salesperson typed. **None of it exists here.** There is no message
body, no transcript, no recording reference, no note, no comment and no free-text field of
any kind, at any layer. ``DQ-LED-007`` inspects the **schema**, so a prohibited column fails
the run even when it holds no values -- and that is the intended behaviour, not an
inconvenience to be worked around.

The distinction this entity exists to protect: NULL is not zero
--------------------------------------------------------------
A lead that was never responded to carries ``first_response_seconds = NULL``. It never
carries ``0``. Zero would mean the store answered *instantaneously*, which is the exact
opposite of what happened, and averaging those zeros into a response-time measure is the
single most common way dealership response reporting goes wrong: the stores that ignore
leads look like the fastest stores in the group.

So the encoding here is deliberate and enforced:

* never responded  -> ``first_response_seconds IS NULL``, and ``is_contacted`` is false;
* responded        -> a positive integer, floored at
  :data:`MINIMUM_RESPONSE_SECONDS`, because no human answers in zero seconds.

``DQ-LED-004`` asserts both halves.

Response time is right-skewed, and it *influences* rather than determines
------------------------------------------------------------------------
Response times are drawn from a lognormal, so the median sits materially below the mean --
a handful of leads answered three days later drag the average far above the typical
experience. Reporting the mean alone is therefore misleading in this dataset in the same way
it is misleading in a real store, which is what makes the mean-versus-median governance rule
worth stating.

Response time then **influences** the probability of contact through
:func:`response_time_influence`, contact influences the probability of an appointment, and a
shown appointment materially raises the odds of a sale. Every one of those is a probability,
never a rule: a lead answered in four minutes can still go nowhere, and a lead answered two
days later can still buy.

Duplicates exist, and they are excluded from every funnel measure
-----------------------------------------------------------------
The same shopper submits the same enquiry twice; the CRM records two leads. ARPI models that
population and marks it with ``is_duplicate`` plus an ``original_lead_id`` pointing at the
first lead of that shopper at that store. **A duplicate is excluded from both the numerator
and the denominator of every funnel measure** -- see :func:`funnel_population`, which is the
one place that rule is implemented. Counting duplicates in the denominator understates every
conversion rate; counting them in the numerator double-counts the same opportunity.

Sold leads point at real, finalized sales
-----------------------------------------
``is_sold`` is only ever set by attaching a lead to a **finalized retail sale that exists in
the sale generator's output**. The sale supplies the customer and the model, so a sold lead
cannot disagree with the deal it claims. Not every sale is lead-attributed and not every
lead sells -- both would be fabrications.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Final

import pandas as pd

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    SOURCE_SYSTEM,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.customer import (
    CustomerSelection,
    customer_selection_pool,
    select_customer_for_sale,
)
from arpi.generation.employee import (
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
    EmployeeAssignment,
    EmployeePerformanceProfile,
    build_employee_assignments,
    employee_performance_profiles,
)
from arpi.generation.lead_source import (
    TOTAL_LEAD_COUNT_BY_SCALE,
    LeadSourceBehaviour,
    lead_source_behaviour,
    lead_source_behaviours,
)
from arpi.generation.marketing import CampaignRecord, campaign_records
from arpi.generation.sale import SaleLink, sale_links
from arpi.generation.vehicle import STORE_IDS, STORE_SHARE, STORE_USED_ALIGNMENT_WEIGHTS
from arpi.generation.vehicle_model import CataloguedModel, catalogued_models_for
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
#: Source entity produced by this module; it is loaded as ``warehouse.fact_lead``.
ENTITY_LEAD_EVENT: Final = "lead_event"

#: Seeding namespace for this entity, and this entity only, so that generating leads can
#: never perturb the numbers any other entity draws.
LEAD_NAMESPACE: Final = "lead_event"

LEAD_ID_PREFIX: Final = "LED-"
LEAD_ID_DIGITS: Final = 9

# ---------------------------------------------------------------------------------------
# Column contract -- PHASE1_CONTRACT.md §7, natural ids and real dates
# ---------------------------------------------------------------------------------------
LEAD_EVENT_COLUMNS: Final[tuple[str, ...]] = (
    "lead_id",
    "lead_created_date",
    "dealership_id",
    "customer_id",
    "vehicle_model_id",
    "lead_source_id",
    "campaign_id",
    "assigned_employee_id",
    "sale_id",
    "lead_count",
    "first_response_seconds",
    "is_contacted",
    "is_appointment_set",
    "is_appointment_shown",
    "is_sold",
    "is_duplicate",
    "original_lead_id",
    "days_to_sale",
    "source_system",
)

#: Columns that may be NULL, and the modelled reason each one is.
#:
#: * ``customer_id`` -- an anonymous enquiry is a real case, and the generator must never
#:   invent a shopper to fill the gap.
#: * ``vehicle_model_id`` -- plenty of shoppers enquire before choosing a unit.
#: * ``campaign_id`` -- an unpaid source has no campaign behind it at all.
#: * ``assigned_employee_id`` -- an unworked lead genuinely has no owner.
#: * ``sale_id`` / ``days_to_sale`` -- the lead did not buy.
#: * ``first_response_seconds`` -- **nobody ever responded.** See the module docstring:
#:   this one is the whole point, and it is never rendered as zero.
#: * ``original_lead_id`` -- the lead is not a duplicate.
LEAD_EVENT_NULLABLE_COLUMNS: Final[tuple[str, ...]] = (
    "customer_id",
    "vehicle_model_id",
    "campaign_id",
    "assigned_employee_id",
    "sale_id",
    "first_response_seconds",
    "original_lead_id",
    "days_to_sale",
)

LEAD_EVENT_DTYPES: Final[dict[str, str]] = {
    "lead_id": "string",
    "lead_created_date": "datetime64[s]",
    "dealership_id": "string",
    "customer_id": "string",
    "vehicle_model_id": "string",
    "lead_source_id": "string",
    "campaign_id": "string",
    "assigned_employee_id": "string",
    "sale_id": "string",
    "lead_count": "int16",
    "first_response_seconds": "Int32",
    "is_contacted": "bool",
    "is_appointment_set": "bool",
    "is_appointment_shown": "bool",
    "is_sold": "bool",
    "is_duplicate": "bool",
    "original_lead_id": "string",
    "days_to_sale": "Int32",
    "source_system": "string",
}

# ---------------------------------------------------------------------------------------
# Arrival: seasonality and day-of-week structure
# ---------------------------------------------------------------------------------------
#: Month-of-year multiplier on lead arrival. Shopping intent leads deliveries, so the
#: monthly shape here is close to -- but deliberately not identical to -- the sale shape:
#: leads peak slightly earlier than the units they produce.
LEAD_MONTH_WEIGHT: Final[dict[int, float]] = {
    1: 0.88,
    2: 0.94,
    3: 1.16,
    4: 1.14,
    5: 1.18,
    6: 1.10,
    7: 1.04,
    8: 1.12,
    9: 1.02,
    10: 0.96,
    11: 0.92,
    12: 1.04,
}

#: Day-of-week multiplier on lead arrival, indexed by :meth:`datetime.date.weekday`
#: (Monday is 0). Unlike sales, **Sunday is not close to zero**: the showroom is shut but
#: the website is not, and a Sunday enquiry is exactly the one that waits longest for a
#: reply. That interaction is modelled in :data:`RESPONSE_DAY_OF_WEEK_DELAY`.
LEAD_DAY_OF_WEEK_WEIGHT: Final[tuple[float, ...]] = (
    1.12,  # Monday
    1.06,  # Tuesday
    1.02,  # Wednesday
    1.02,  # Thursday
    0.98,  # Friday
    0.92,  # Saturday
    0.78,  # Sunday
)

# ---------------------------------------------------------------------------------------
# Population shape
# ---------------------------------------------------------------------------------------
#: Share of leads that never identify a shopper. An anonymous enquiry carries a NULL
#: customer reference rather than a synthesised one.
ANONYMOUS_LEAD_SHARE: Final = 0.11

#: Share of leads that name a model of interest. The rest are still shopping.
MODEL_OF_INTEREST_SHARE: Final = 0.78

#: Share of leads from a paid source, on a day a matching campaign is running, that are
#: attributable to a specific campaign. Below 1.0 because attribution is imperfect.
CAMPAIGN_ATTACHMENT_SHARE: Final = 0.88

#: Share of leads nobody is assigned to. An unowned lead is a real and consequential thing:
#: it is answered far less often, and far later, than an owned one.
UNASSIGNED_LEAD_SHARE: Final = 0.05

#: Roles that own a lead, in preference order, for digital and third-party sources.
BDC_ROLES: Final[tuple[str, ...]] = (JOB_ROLE_BDC_REPRESENTATIVE, JOB_ROLE_BDC_MANAGER)

#: Roles that own a lead for in-person and internally generated sources, and the fallback
#: for every source at a store with no business development centre on staff.
FLOOR_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
)

# ---------------------------------------------------------------------------------------
# Response behaviour
# ---------------------------------------------------------------------------------------
#: Median response time, in seconds, for a source of average contact discipline. The
#: distribution around it is lognormal, so the mean lands materially above this.
RESPONSE_MEDIAN_SECONDS: Final = 1_500.0

#: Sigma of the underlying normal. This is what produces the right skew: the mean of the
#: draw is the median multiplied by ``exp(sigma ** 2 / 2)``, roughly 2.5x at this value.
RESPONSE_LOG_SIGMA: Final = 1.35

#: Floor on a recorded response, in seconds. **No human answers in zero seconds**, so a
#: genuine response never rounds down to the value that means "never responded".
MINIMUM_RESPONSE_SECONDS: Final = 30

#: Ceiling on a recorded response, in seconds (three days). Past this the store has, for
#: every practical purpose, not responded -- but the lead is still recorded as responded,
#: because that is what the CRM would show.
MAXIMUM_RESPONSE_SECONDS: Final = 259_200

#: Contact rate at which a source draws its response times at the unmodified median.
RESPONSE_SPEED_PIVOT: Final = 0.80

#: Exponent on the ratio of the pivot to a source's contact rate. Sources that are worse at
#: making contact are also slower to try, which is why one latent drives both.
RESPONSE_SPEED_EXPONENT: Final = 2.0

#: Multiplier on the response median when nobody owns the lead.
UNASSIGNED_RESPONSE_DELAY: Final = 3.5

#: Multiplier on the response median by the weekday the lead arrived. A Sunday enquiry
#: waits for Monday morning.
RESPONSE_DAY_OF_WEEK_DELAY: Final[tuple[float, ...]] = (
    0.92,  # Monday
    0.90,  # Tuesday
    0.92,  # Wednesday
    0.94,  # Thursday
    1.02,  # Friday
    1.24,  # Saturday
    2.10,  # Sunday
)

#: How much more likely a lead is to receive *any* response than to be successfully
#: contacted. Responding is the store's decision; making contact needs the shopper too.
RESPONSE_UPLIFT_OVER_CONTACT: Final = 0.14

#: Ceiling on any modelled probability. Nothing in a dealership happens 100% of the time,
#: and a probability pinned at 1.0 is a prohibited synthetic pattern.
MAXIMUM_PROBABILITY: Final = 0.995

#: Floor on any modelled probability, so no combination of latents can make an outcome
#: impossible and turn a probabilistic influence into a rule.
MINIMUM_PROBABILITY: Final = 0.02

#: Multiplier on the probability of a response when nobody owns the lead.
UNASSIGNED_RESPONSE_FACTOR: Final = 0.45

#: Mean of ``crm_discipline_index`` across the employee population. That latent is drawn as
#: ``triangular(0.35, 1.00, 0.78)``, so it is a **fraction whose ceiling is 1.0**, not a
#: multiplier centred on 1.0. Dividing by this mean turns it into one, which is what the
#: draws here need: multiplying by the raw index would depress every response and contact
#: probability by roughly thirty per cent and quietly turn a store-quality latent into a
#: population-wide bias. A test recomputes this figure from the employee generator, so it
#: cannot silently drift if that draw is retuned.
MEAN_CRM_DISCIPLINE_INDEX: Final = 0.71

#: Inclusive bounds applied to the normalised CRM discipline multiplier, so a single latent
#: parameter cannot drive an outcome to a deterministic extreme.
DISCIPLINE_BOUNDS: Final[tuple[float, float]] = (0.72, 1.24)

# ---------------------------------------------------------------------------------------
# The response-time influence on contact
# ---------------------------------------------------------------------------------------
#: Intercept of the response-time influence on the probability of contact.
RESPONSE_INFLUENCE_INTERCEPT: Final = 1.26

#: Slope against ``log10(1 + minutes)``. Chosen so the influence decays quickly over the
#: first hour and then flattens, which is the shape the response-time literature describes.
RESPONSE_INFLUENCE_SLOPE: Final = 0.17

#: Inclusive bounds on the influence multiplier. The lower bound is well above zero: a slow
#: response hurts, but it never makes contact impossible.
RESPONSE_INFLUENCE_BOUNDS: Final[tuple[float, float]] = (0.52, 1.26)

# ---------------------------------------------------------------------------------------
# Appointment behaviour at lead grain
# ---------------------------------------------------------------------------------------
#: Probability that a contacted lead sets an appointment, before source and response-time
#: influences are applied.
APPOINTMENT_SET_BASE: Final = 0.40

#: Probability that a set appointment is shown, before the source influence is applied.
#: The appointment generator expands this into individual appointments; a lead that shows
#: may have broken two earlier appointments first.
APPOINTMENT_SHOW_BASE: Final = 0.62

#: Volume-weighted mean close rate across the governed sources, used to normalise a
#: source's close rate into a relative propensity. Recomputed by a test, so it cannot
#: silently drift away from :data:`~arpi.generation.lead_source.LEAD_SOURCE_DEFINITIONS`.
MEAN_SOURCE_CLOSE_RATE: Final = 0.112

#: Exponent applied to the ratio of a source's close rate to the mean. Below 1.0 so that a
#: source three times better at closing is not three times better at every earlier step.
SOURCE_PROPENSITY_EXPONENT: Final = 0.5

#: Inclusive bounds on the resulting source propensity multiplier.
SOURCE_PROPENSITY_BOUNDS: Final[tuple[float, float]] = (0.60, 1.60)

# ---------------------------------------------------------------------------------------
# Sale attribution
# ---------------------------------------------------------------------------------------
#: Share of finalized retail sales that are attributable to a CRM lead. Well below 1.0:
#: plenty of deals are written without a lead record ever existing, and pretending
#: otherwise would make lead-to-sale conversion look like a complete picture of the store.
SALE_ATTRIBUTION_SHARE: Final = 0.72

#: Longest gap, in days, between a lead and the sale it is credited with. Beyond this the
#: shopper has re-entered the funnel and the later lead owns the deal.
MAXIMUM_DAYS_TO_SALE: Final = 120

#: Relative weight of a lead when a sale is looking for one to credit. A lead that showed
#: for its appointment is far more likely to be the lead that bought -- which is what makes
#: "appointment-shown leads convert at a higher rate" true in the data rather than asserted.
SOLD_WEIGHT_BASE: Final = 1.0
SOLD_WEIGHT_APPOINTMENT_SET: Final = 1.7
SOLD_WEIGHT_APPOINTMENT_SHOWN: Final = 4.2

# ---------------------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------------------
#: Probability that a later lead from the same shopper at the same store, inside
#: :data:`DUPLICATE_WINDOW_DAYS`, is recorded as a duplicate rather than as a genuinely new
#: opportunity.
DUPLICATE_PROBABILITY: Final = 0.45

#: How long after the first lead a second one from the same shopper still counts as a
#: duplicate. Past this the shopper has genuinely come back.
DUPLICATE_WINDOW_DAYS: Final = 60

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (prefix reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_LEAD_UNIQUE_ID: Final = "DQ-LED-001"
CHECK_LEAD_SCHEMA_MATCHES: Final = "DQ-LED-002"
CHECK_LEAD_FUNNEL_IMPLICATION: Final = "DQ-LED-003"
CHECK_LEAD_RESPONSE_NULL_NOT_ZERO: Final = "DQ-LED-004"
CHECK_LEAD_SOLD_RESOLVES_TO_SALE: Final = "DQ-LED-005"
CHECK_LEAD_DUPLICATE_REFERENCE: Final = "DQ-LED-006"
CHECK_LEAD_NO_PROHIBITED_CONTENT: Final = "DQ-LED-007"
CHECK_LEAD_RESPONSE_RIGHT_SKEWED: Final = "DQ-LED-008"

#: Every check identifier this module emits, in identifier order.
LEAD_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_LEAD_UNIQUE_ID,
    CHECK_LEAD_SCHEMA_MATCHES,
    CHECK_LEAD_FUNNEL_IMPLICATION,
    CHECK_LEAD_RESPONSE_NULL_NOT_ZERO,
    CHECK_LEAD_SOLD_RESOLVES_TO_SALE,
    CHECK_LEAD_DUPLICATE_REFERENCE,
    CHECK_LEAD_NO_PROHIBITED_CONTENT,
    CHECK_LEAD_RESPONSE_RIGHT_SKEWED,
)

#: Inclusive band the ratio of mean to median response time must fall inside. The lower
#: bound is comfortably above 1.0 because a symmetric response-time distribution would make
#: the mean-versus-median governance rule meaningless.
SKEW_RATIO_BOUNDS: Final[tuple[float, float]] = (1.40, 4.50)

#: Inclusive band the never-responded share must fall inside. Above zero because a store
#: that answers every lead does not exist; well below half because one that answers none is
#: not a store either.
NEVER_RESPONDED_SHARE_BOUNDS: Final[tuple[float, float]] = (0.03, 0.30)

_WAREHOUSE_FACT_LEAD: Final = "warehouse.fact_lead"

# Registered at import time so the canonical register in
# :mod:`arpi.validation.registry` is complete whenever this generator is importable.
# ``layer`` is ``python`` because only a pandas implementation exists today; the SQL DDL and
# its CHECK constraints are Planned and owned by another agent.
register_checks(
    (
        CheckDefinition(
            check_id=CHECK_LEAD_UNIQUE_ID,
            check_name="lead_event.lead_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "lead_id is the grain. A duplicate row is not the same thing as a duplicate "
                "lead: is_duplicate marks a shopper who enquired twice, whereas a repeated "
                "lead_id double-counts one CRM record through every funnel measure."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SCHEMA_MATCHES,
            check_name="lead_event matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, and "
                "this entity carries five adjacent booleans that would be silently "
                "interchangeable if the order drifted."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_FUNNEL_IMPLICATION,
            check_name="the funnel implication chain holds on every lead",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "NOT is_contacted implies NOT is_appointment_set; NOT is_appointment_set "
                "implies NOT is_appointment_shown; is_sold implies a sale reference. A break "
                "anywhere in that chain produces a funnel whose stages do not nest, so a "
                "later stage can exceed the one before it and every conversion rate above "
                "the break is wrong."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_RESPONSE_NULL_NOT_ZERO,
            check_name="never-responded leads carry NULL, never zero, response time",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "A zero response time means the store answered instantaneously, which is the "
                "opposite of never answering. Averaging those zeros in makes the stores that "
                "ignore leads look like the fastest in the group. The check asserts that no "
                "response time is zero or negative, that a genuine never-responded population "
                "exists, and that every contacted lead has a response time."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_SOLD_RESOLVES_TO_SALE,
            check_name="every sold lead resolves to a finalized retail sale",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "is_sold is only meaningful if the deal behind it exists, is retail, belongs "
                "to the same store and customer, and was struck on or after the lead arrived. "
                "An unresolvable link would let lead-to-sale conversion count deals the "
                "dealership never made."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_DUPLICATE_REFERENCE,
            check_name="duplicate leads carry a resolvable original lead reference",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "is_duplicate implies original_lead_id, and the reference must resolve to an "
                "earlier lead that is not itself a duplicate. Without it a duplicate cannot be "
                "excluded from a funnel denominator, and every conversion rate in the model is "
                "computed over an inflated base."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_NO_PROHIBITED_CONTENT,
            check_name="lead_event declares no prohibited personal-data or content column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "A CRM lead record is mostly text about a person: the message body, the call "
                "transcript, the recording, the salesperson's note. ARPI generates none of it. "
                "The check inspects the schema, so an empty message_body column still fails "
                "the run -- which is the intended behaviour."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
        CheckDefinition(
            check_id=CHECK_LEAD_RESPONSE_RIGHT_SKEWED,
            check_name="the response-time distribution is right-skewed",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.WARNING,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_LEAD_EVENT,
            description=(
                "The median must sit materially below the mean. A symmetric response-time "
                "distribution would make the mean-versus-median governance rule decorative "
                "rather than load-bearing. A plausibility band rather than a hard rule, hence "
                "warning: the exact ratio is a modelling choice, its absence is a defect."
            ),
            applies_to=(_WAREHOUSE_FACT_LEAD,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class RoleInterval:
    """One employee's tenure in one role at one store, as an inclusive date range.

    ``selection_weight``, ``crm_discipline`` and ``closing_rate`` are latent parameters from
    :func:`arpi.generation.employee.employee_performance_profiles`. They are generation
    inputs and never become columns of anything: publishing them would turn a fabrication
    parameter into what looks like a measurement of a person.

    Attributes:
        employee_id: Synthetic identifier, ``EMP-#####``.
        dealership_id: Store held during this interval.
        job_role: Role held during this interval.
        start_date: First day of the interval, inclusive.
        end_date: Last day of the interval, inclusive.
        selection_weight: Relative likelihood of being picked for a lead or appointment.
        crm_discipline: Relative CRM logging and response discipline.
        closing_rate: Relative lead-to-sale conversion.
    """

    employee_id: str
    dealership_id: str
    job_role: str
    start_date: date
    end_date: date
    selection_weight: float
    crm_discipline: float
    closing_rate: float


@dataclass(frozen=True, slots=True)
class LeadRecord:
    """One CRM lead, plus the context the appointment generator needs.

    The first nineteen attributes correspond to the declared columns. ``sale_date`` is not a
    column: it is carried so the appointment generator can keep an appointment on or before
    the day the deal was struck without rebuilding the sale population.

    Attributes:
        lead_id: Identifier in the reserved ``LED-#########`` scheme.
        lead_created_date: Day the lead arrived; always inside the reporting window.
        dealership_id: Store that received the lead.
        customer_id: The shopper, or ``None`` for an anonymous enquiry.
        vehicle_model_id: Model of interest, or ``None`` when none was named.
        lead_source_id: Governed source the lead came through.
        campaign_id: Campaign the lead is attributed to, or ``None``.
        assigned_employee_id: Employee who owns the lead, or ``None`` when nobody does.
        sale_id: The finalized retail sale this lead produced, or ``None``.
        first_response_seconds: Seconds until the first response, or ``None`` when the lead
            was **never responded to**. Never zero; see the module docstring.
        is_contacted: Whether two-way contact was established.
        is_appointment_set: Whether an appointment was booked.
        is_appointment_shown: Whether the shopper showed for one.
        is_sold: Whether the lead produced a finalized retail sale.
        is_duplicate: Whether this lead repeats an earlier one from the same shopper.
        original_lead_id: The lead this one duplicates, or ``None``.
        days_to_sale: ``sale_date - lead_created_date``, or ``None`` when not sold.
        sale_date: Date of the linked sale, or ``None``. **Not a column.**
    """

    lead_id: str
    lead_created_date: date
    dealership_id: str
    customer_id: str | None
    vehicle_model_id: str | None
    lead_source_id: str
    campaign_id: str | None
    assigned_employee_id: str | None
    sale_id: str | None
    first_response_seconds: int | None
    is_contacted: bool
    is_appointment_set: bool
    is_appointment_shown: bool
    is_sold: bool
    is_duplicate: bool
    original_lead_id: str | None
    days_to_sale: int | None
    sale_date: date | None


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def lead_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as a ``LED-#########`` identifier.

    Args:
        ordinal: 1-based position in the ordered lead population.

    Returns:
        The zero-padded identifier, e.g. ``"LED-000042199"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive, or is too large for the reserved
            nine-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"lead_id ordinals start at 1, got {ordinal}.", entity=ENTITY_LEAD_EVENT
        )
    if ordinal >= 10**LEAD_ID_DIGITS:
        raise GenerationError(
            f"lead_id ordinal {ordinal} does not fit the reserved "
            f"{LEAD_ID_PREFIX}{'#' * LEAD_ID_DIGITS} scheme. Widen the identifier scheme in "
            "PHASE1_CONTRACT.md §5 before generating this many leads.",
            entity=ENTITY_LEAD_EVENT,
        )
    return f"{LEAD_ID_PREFIX}{ordinal:0{LEAD_ID_DIGITS}d}"


def lead_count_for(config: ArpiConfig) -> int:
    """Return the number of CRM leads for the active scale mode.

    Args:
        config: Resolved configuration.

    Returns:
        The count from
        :data:`~arpi.generation.lead_source.TOTAL_LEAD_COUNT_BY_SCALE` -- the same constant
        the marketing-spend generator calibrates against, so the two entities cannot drift
        apart.

    Raises:
        GenerationError: If the scale mode has no declared lead count.
    """
    try:
        return TOTAL_LEAD_COUNT_BY_SCALE[config.generation.scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No lead count is declared for scale mode {config.generation.scale_mode!r}. "
            f"Declared modes: {', '.join(sorted(TOTAL_LEAD_COUNT_BY_SCALE))}.",
            entity=ENTITY_LEAD_EVENT,
            scale_mode=config.generation.scale_mode,
        ) from error


def response_time_influence(first_response_seconds: int) -> float:
    """Return the multiplier a response time applies to downstream probabilities.

    Faster is better, and the relationship is logarithmic rather than linear: the difference
    between four minutes and forty matters far more than the difference between two days and
    three. The result is **a multiplier on a probability, never a rule** -- its lower bound
    is well above zero, so a slow response reduces the odds of contact without ever making
    contact impossible.

    Args:
        first_response_seconds: Seconds until the first response. Callers must not pass the
            never-responded case: a lead nobody answered has no response time at all, and
            substituting a number for that absence is the defect this entity exists to
            avoid.

    Returns:
        A multiplier inside :data:`RESPONSE_INFLUENCE_BOUNDS`.

    Raises:
        GenerationError: If ``first_response_seconds`` is negative.
    """
    if first_response_seconds < 0:
        raise GenerationError(
            f"first_response_seconds must be non-negative, got {first_response_seconds}.",
            entity=ENTITY_LEAD_EVENT,
        )
    minutes = first_response_seconds / 60.0
    raw = RESPONSE_INFLUENCE_INTERCEPT - RESPONSE_INFLUENCE_SLOPE * math.log10(1.0 + minutes)
    return _clamp(raw, RESPONSE_INFLUENCE_BOUNDS)


def source_propensity(behaviour: LeadSourceBehaviour) -> float:
    """Return a source's relative propensity to progress a lead down the funnel.

    Derived from the source's ``close_rate`` latent -- the authoritative per-source
    behaviour published by :mod:`arpi.generation.lead_source` -- rather than from a second
    table of numbers that could disagree with it.

    Args:
        behaviour: The source's latent behaviour.

    Returns:
        A multiplier inside :data:`SOURCE_PROPENSITY_BOUNDS`, equal to 1.0 for a source that
        closes at the volume-weighted mean rate.
    """
    ratio = behaviour.close_rate / MEAN_SOURCE_CLOSE_RATE
    return _clamp(ratio**SOURCE_PROPENSITY_EXPONENT, SOURCE_PROPENSITY_BOUNDS)


def discipline_multiplier(owner: RoleInterval | None) -> float:
    """Return the response-and-contact multiplier for the employee who owns a lead.

    ``crm_discipline_index`` is drawn as a fraction whose ceiling is ``1.0`` rather than as
    a multiplier centred on it, so it is normalised by
    :data:`MEAN_CRM_DISCIPLINE_INDEX` before use. Without that step the *average* employee
    would depress every probability, and a per-person difference would read as a
    population-wide bias.

    Args:
        owner: The employee who owns the lead, or ``None`` when nobody does.

    Returns:
        ``1.0`` for an unowned lead -- the ownership penalty is applied separately -- and
        otherwise a multiplier inside :data:`DISCIPLINE_BOUNDS`.
    """
    if owner is None:
        return 1.0
    return _clamp(owner.crm_discipline / MEAN_CRM_DISCIPLINE_INDEX, DISCIPLINE_BOUNDS)


def funnel_population(frame: pd.DataFrame) -> pd.DataFrame:
    """Return the leads that belong in a funnel numerator **or** denominator.

    **This is the one place the duplicate-exclusion rule lives.** Every funnel measure in
    ARPI -- contact rate, appointment set rate, show rate, lead-to-sale conversion -- is

    * numerator: rows of this population whose stage flag is true;
    * denominator: rows of this population.

    Duplicate leads are excluded from **both**. Leaving them in the denominator understates
    every conversion rate, because the same shopper is counted twice as an opportunity;
    leaving them in the numerator double-counts one opportunity's outcome. There is no
    measure for which including them is correct, so they are removed once, here, rather
    than filtered ad hoc by each consumer.

    Args:
        frame: A ``lead_event`` frame.

    Returns:
        The non-duplicate rows, in their original order.
    """
    return frame[~frame["is_duplicate"].astype(bool)]


def _clamp(value: float, bounds: tuple[float, float]) -> float:
    """Clamp ``value`` into an inclusive ``(low, high)`` band."""
    low, high = bounds
    return min(max(value, low), high)


def _probability(value: float) -> float:
    """Clamp a modelled probability away from both 0.0 and 1.0."""
    return min(max(value, MINIMUM_PROBABILITY), MAXIMUM_PROBABILITY)


# ---------------------------------------------------------------------------------------
# Employee routing
# ---------------------------------------------------------------------------------------
def employee_role_intervals(config: ArpiConfig) -> tuple[RoleInterval, ...]:
    """Flatten the roster into role intervals, honouring the SCD Type 2 timeline.

    A person who changed role or store mid-window contributes two intervals, so a lead is
    never assigned to somebody at a store they had not joined or in a role they no longer
    held. Employment is bounded by ``hire_date`` and ``termination_date``.

    This is also the helper :mod:`arpi.generation.appointment` calls, so the two funnel
    entities resolve employees through one implementation rather than two that could drift.

    Args:
        config: Resolved configuration.

    Returns:
        One interval per employee-role-store combination, in roster order.
    """
    profiles = employee_performance_profiles(config)
    intervals: list[RoleInterval] = []
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
) -> RoleInterval:
    """Build one role interval, carrying the latent indices the draws need."""
    return RoleInterval(
        employee_id=assignment.employee_id,
        dealership_id=dealership_id,
        job_role=job_role,
        start_date=start_date,
        end_date=end_date,
        selection_weight=max(profile.volume_index * profile.crm_discipline_index, 0.05),
        crm_discipline=profile.crm_discipline_index,
        closing_rate=profile.closing_rate_index,
    )


def choose_role_interval(
    intervals: Sequence[RoleInterval],
    dealership_id: str,
    roles: Sequence[str],
    on_date: date,
    rng: random.Random,
) -> RoleInterval | None:
    """Pick one employee eligible for a role at one store on one date.

    Args:
        intervals: Intervals from :func:`employee_role_intervals`.
        dealership_id: Store the work happened at.
        roles: Eligible job roles, in no particular order.
        on_date: Day the work happened.
        rng: The caller's generator, so the choice stays inside the caller's seed stream.

    Returns:
        An eligible employee, weighted by their latent selection weight, or ``None`` when
        the store had nobody in those roles on that day.
    """
    eligible = tuple(
        interval
        for interval in intervals
        if interval.dealership_id == dealership_id
        and interval.job_role in roles
        and interval.start_date <= on_date <= interval.end_date
    )
    if not eligible:
        return None
    weights = [interval.selection_weight for interval in eligible]
    return rng.choices(eligible, weights=weights, k=1)[0]


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
@dataclass(slots=True)
class _LeadDraft:
    """Mutable working record used while the population is assembled."""

    lead_created_date: date
    dealership_id: str
    lead_source_id: str
    assigned_employee_id: str | None
    first_response_seconds: int | None
    is_contacted: bool
    is_appointment_set: bool
    is_appointment_shown: bool
    sold_weight: float
    customer_id: str | None = None
    vehicle_model_id: str | None = None
    campaign_id: str | None = None
    sale_id: str | None = None
    sale_date: date | None = None
    is_duplicate: bool = False
    original_index: int | None = None


def build_lead_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[LeadRecord, ...]:
    """Build every CRM lead for the active profile.

    This is the public entry point the appointment generator and the funnel reconciliation
    call.

    Args:
        config: Resolved configuration supplying the master seed, the scale mode and the
            reporting window.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The leads, ordered by ``lead_id``, which is assigned over ``lead_created_date``
        ascending so the ordering is stable and chronological.
    """
    rng = rng_for(config.random_seed, LEAD_NAMESPACE)
    context = _LeadContext.build(config, catalogue_path)
    drafts = _draw_arrivals(rng, config, context)
    _attribute_sales(rng, drafts, context)
    _assign_customers_models_and_campaigns(rng, drafts, context)
    _mark_duplicates(rng, drafts)

    records = tuple(
        _to_record(lead_id_for(ordinal), draft, drafts)
        for ordinal, draft in enumerate(drafts, start=1)
    )
    _log_declared_distributions(records)
    return records


@dataclass(frozen=True, slots=True)
class _LeadContext:
    """Everything the lead draws read, resolved once per run."""

    behaviours: tuple[LeadSourceBehaviour, ...]
    intervals: tuple[RoleInterval, ...]
    customers: tuple[CustomerSelection, ...]
    first_interaction: dict[str, date]
    retail_sales: tuple[SaleLink, ...]
    campaigns_by_source: dict[str, tuple[CampaignRecord, ...]]
    models_by_store: dict[str, tuple[tuple[str, float], ...]]

    @classmethod
    def build(cls, config: ArpiConfig, catalogue_path: Path | None) -> _LeadContext:
        """Resolve every upstream population the lead draws depend on."""
        customers = customer_selection_pool(config)
        campaigns: dict[str, list[CampaignRecord]] = {}
        for record in campaign_records(config):
            campaigns.setdefault(record.lead_source_id, []).append(record)
        return cls(
            behaviours=lead_source_behaviours(),
            intervals=employee_role_intervals(config),
            customers=customers,
            first_interaction={
                selection.customer_id: selection.first_interaction_date for selection in customers
            },
            retail_sales=tuple(
                link
                for link in sale_links(config, catalogue_path)
                if link.is_retail and link.customer_id is not None
            ),
            campaigns_by_source={
                source_id: tuple(records) for source_id, records in campaigns.items()
            },
            models_by_store=_model_pools(config, catalogue_path),
        )


def _model_pools(
    config: ArpiConfig, catalogue_path: Path | None
) -> dict[str, tuple[tuple[str, float], ...]]:
    """Build the per-store pool of models a shopper might name, with draw weights.

    The weights are the store's used-inventory franchise alignment shares, so a shopper
    enquiring at the Chevrolet store mostly names a Chevrolet -- without the relationship
    ever becoming a rule, because every store retails units of every alignment.
    """
    models: tuple[CataloguedModel, ...] = catalogued_models_for(config, catalogue_path)
    pools: dict[str, tuple[tuple[str, float], ...]] = {}
    for dealership_id in STORE_IDS:
        alignment_weights = STORE_USED_ALIGNMENT_WEIGHTS[dealership_id]
        pool = tuple(
            (model.vehicle_model_id, weight)
            for model in models
            if (weight := alignment_weights.get(model.definition.franchise_alignment, 0.0)) > 0.0
        )
        pools[dealership_id] = pool
    return pools


def _draw_arrivals(
    rng: random.Random, config: ArpiConfig, context: _LeadContext
) -> list[_LeadDraft]:
    """Draw every lead's arrival, ownership, response and funnel outcome."""
    days = _reporting_days(config)
    weights = [
        LEAD_MONTH_WEIGHT[day.month] * LEAD_DAY_OF_WEEK_WEIGHT[day.weekday()] for day in days
    ]
    total = lead_count_for(config)
    arrivals = sorted(rng.choices(days, weights=weights, k=total))

    source_ids = [behaviour.lead_source_id for behaviour in context.behaviours]
    volume_weights = [behaviour.volume_weight for behaviour in context.behaviours]
    store_weights = [STORE_SHARE[store] for store in STORE_IDS]

    drafts: list[_LeadDraft] = []
    for arrival in arrivals:
        source_id = rng.choices(source_ids, weights=volume_weights, k=1)[0]
        behaviour = lead_source_behaviour(source_id)
        dealership_id = rng.choices(STORE_IDS, weights=store_weights, k=1)[0]
        owner = _choose_owner(rng, context.intervals, dealership_id, behaviour, arrival)
        drafts.append(_draw_funnel(rng, arrival, dealership_id, behaviour, owner))
    return drafts


def _choose_owner(
    rng: random.Random,
    intervals: Sequence[RoleInterval],
    dealership_id: str,
    behaviour: LeadSourceBehaviour,
    arrival: date,
) -> RoleInterval | None:
    """Pick the employee who owns a lead, or ``None`` when nobody does.

    An internally generated opportunity -- a walk-in, a service-drive conversation -- is
    owned by whoever is on the floor. An inbound digital enquiry goes to the business
    development centre first, and falls back to the floor at a store with no BDC on staff.
    """
    if rng.random() < UNASSIGNED_LEAD_SHARE:
        return None
    preferred = FLOOR_ROLES if behaviour.contact_rate >= RESPONSE_SPEED_PIVOT else BDC_ROLES
    chosen = choose_role_interval(intervals, dealership_id, preferred, arrival, rng)
    if chosen is not None:
        return chosen
    fallback = BDC_ROLES if preferred is FLOOR_ROLES else FLOOR_ROLES
    return choose_role_interval(intervals, dealership_id, fallback, arrival, rng)


def _draw_funnel(
    rng: random.Random,
    arrival: date,
    dealership_id: str,
    behaviour: LeadSourceBehaviour,
    owner: RoleInterval | None,
) -> _LeadDraft:
    """Draw the response and the three funnel flags for one lead."""
    discipline = discipline_multiplier(owner)
    seconds = _draw_response(rng, arrival, behaviour, owner, discipline)

    if seconds is None:
        # Nobody answered, so nobody made contact. The lead still exists, still counts in
        # the denominator, and still carries NULL rather than a fabricated response time.
        contacted = False
        influence = 0.0
    else:
        influence = response_time_influence(seconds)
        contacted = rng.random() < _probability(behaviour.contact_rate * influence * discipline)

    propensity = source_propensity(behaviour)
    appointment_set = contacted and (
        rng.random() < _probability(APPOINTMENT_SET_BASE * propensity * influence * discipline)
    )
    appointment_shown = appointment_set and (
        rng.random() < _probability(APPOINTMENT_SHOW_BASE * propensity)
    )
    return _LeadDraft(
        lead_created_date=arrival,
        dealership_id=dealership_id,
        lead_source_id=behaviour.lead_source_id,
        assigned_employee_id=owner.employee_id if owner is not None else None,
        first_response_seconds=seconds,
        is_contacted=contacted,
        is_appointment_set=appointment_set,
        is_appointment_shown=appointment_shown,
        sold_weight=_sold_weight(behaviour, owner, appointment_set, appointment_shown),
    )


def _draw_response(
    rng: random.Random,
    arrival: date,
    behaviour: LeadSourceBehaviour,
    owner: RoleInterval | None,
    discipline: float,
) -> int | None:
    """Draw the first response, or ``None`` when the lead was never responded to.

    ``None`` is the whole point of this function. It is returned rather than a zero, a
    sentinel or a very large number, because each of those would be indistinguishable from a
    real response in an average.
    """
    probability = _probability(behaviour.contact_rate + RESPONSE_UPLIFT_OVER_CONTACT)
    if owner is None:
        probability = _probability(probability * UNASSIGNED_RESPONSE_FACTOR)
    else:
        probability = _probability(probability * discipline)
    if rng.random() >= probability:
        return None

    factor = (RESPONSE_SPEED_PIVOT / behaviour.contact_rate) ** RESPONSE_SPEED_EXPONENT
    factor *= RESPONSE_DAY_OF_WEEK_DELAY[arrival.weekday()]
    factor /= discipline
    if owner is None:
        factor *= UNASSIGNED_RESPONSE_DELAY
    drawn = rng.lognormvariate(math.log(RESPONSE_MEDIAN_SECONDS), RESPONSE_LOG_SIGMA) * factor
    return int(min(max(drawn, MINIMUM_RESPONSE_SECONDS), MAXIMUM_RESPONSE_SECONDS))


def _sold_weight(
    behaviour: LeadSourceBehaviour,
    owner: RoleInterval | None,
    appointment_set: bool,
    appointment_shown: bool,
) -> float:
    """Return the relative weight this lead carries when a sale looks for one to credit."""
    if appointment_shown:
        stage = SOLD_WEIGHT_APPOINTMENT_SHOWN
    elif appointment_set:
        stage = SOLD_WEIGHT_APPOINTMENT_SET
    else:
        stage = SOLD_WEIGHT_BASE
    closing = owner.closing_rate if owner is not None else 1.0
    return max(behaviour.close_rate * stage * closing, 0.001)


def _reporting_days(config: ArpiConfig) -> list[date]:
    """Return every day of the inclusive reporting window."""
    start = config.reporting.start_date
    span = (config.reporting.end_date - start).days + 1
    return [start + timedelta(days=offset) for offset in range(span)]


def _attribute_sales(rng: random.Random, drafts: list[_LeadDraft], context: _LeadContext) -> None:
    """Attach finalized retail sales to the leads that produced them.

    A sale is offered to the leads at its own store that arrived inside
    :data:`MAXIMUM_DAYS_TO_SALE` before it, were contacted, are not already credited with a
    deal, and whose buyer had already interacted with the group. The winner is drawn
    weighted by :meth:`_sold_weight`, so a lead that showed for its appointment wins far
    more often -- probabilistically, never by rule.
    """
    by_store: dict[str, list[int]] = {store: [] for store in STORE_IDS}
    for index, draft in enumerate(drafts):
        by_store.setdefault(draft.dealership_id, []).append(index)
    arrival_by_store = {
        store: [drafts[index].lead_created_date for index in indices]
        for store, indices in by_store.items()
    }

    for sale in context.retail_sales:
        if rng.random() >= SALE_ATTRIBUTION_SHARE:
            continue
        customer_id = str(sale.customer_id)
        interacted = context.first_interaction.get(customer_id)
        if interacted is None:  # pragma: no cover - every retail buyer is a known customer
            continue
        candidates, weights = _sale_candidates(drafts, by_store, arrival_by_store, sale, interacted)
        if not candidates:
            continue
        chosen = rng.choices(candidates, weights=weights, k=1)[0]
        draft = drafts[chosen]
        draft.sale_id = sale.sale_id
        draft.sale_date = sale.sale_date
        draft.customer_id = customer_id
        draft.vehicle_model_id = sale.vehicle_model_id


def _sale_candidates(
    drafts: Sequence[_LeadDraft],
    by_store: dict[str, list[int]],
    arrival_by_store: dict[str, list[date]],
    sale: SaleLink,
    interacted: date,
) -> tuple[list[int], list[float]]:
    """Return the leads eligible to be credited with one sale, and their weights."""
    indices = by_store.get(sale.dealership_id, [])
    arrivals = arrival_by_store.get(sale.dealership_id, [])
    earliest = sale.sale_date - timedelta(days=MAXIMUM_DAYS_TO_SALE)
    low = bisect_left(arrivals, earliest)
    high = bisect_right(arrivals, sale.sale_date)

    candidates: list[int] = []
    weights: list[float] = []
    for position in range(low, high):
        index = indices[position]
        draft = drafts[index]
        if draft.sale_id is not None or not draft.is_contacted:
            continue
        if draft.lead_created_date < interacted:
            continue
        candidates.append(index)
        weights.append(draft.sold_weight)
    return candidates, weights


def _assign_customers_models_and_campaigns(
    rng: random.Random, drafts: list[_LeadDraft], context: _LeadContext
) -> None:
    """Fill in the shopper, the model of interest and the campaign for every lead.

    Sold leads already carry the buyer and the unit from the deal they are credited with, so
    they are left alone: a lead cannot disagree with its own sale.
    """
    for draft in drafts:
        if draft.customer_id is None and rng.random() >= ANONYMOUS_LEAD_SHARE:
            selection = select_customer_for_sale(context.customers, draft.lead_created_date, rng)
            draft.customer_id = selection.customer_id if selection is not None else None
        if draft.vehicle_model_id is None and rng.random() < MODEL_OF_INTEREST_SHARE:
            draft.vehicle_model_id = _draw_model(rng, context, draft.dealership_id)
        draft.campaign_id = _draw_campaign(rng, context, draft)


def _draw_model(rng: random.Random, context: _LeadContext, dealership_id: str) -> str | None:
    """Draw a model of interest for one store, or ``None`` when the pool is empty."""
    pool = context.models_by_store.get(dealership_id, ())
    if not pool:  # pragma: no cover - every store has an eligible alignment
        return None
    return rng.choices(
        [model_id for model_id, _ in pool], weights=[weight for _, weight in pool], k=1
    )[0]


def _draw_campaign(rng: random.Random, context: _LeadContext, draft: _LeadDraft) -> str | None:
    """Attribute a lead to a campaign that was actually running when it arrived.

    Only campaigns bought against the lead's own source, funded by the lead's own store and
    active on the day are eligible. Unpaid sources have no campaign at all, and a share of
    eligible leads stay unattributed, because attribution in a real CRM is not complete.
    """
    eligible = tuple(
        campaign
        for campaign in context.campaigns_by_source.get(draft.lead_source_id, ())
        if draft.dealership_id in campaign.dealership_ids
        and campaign.is_active_on(draft.lead_created_date)
    )
    if not eligible or rng.random() >= CAMPAIGN_ATTACHMENT_SHARE:
        return None
    weights = [max(campaign.source_share, 0.001) for campaign in eligible]
    return rng.choices(eligible, weights=weights, k=1)[0].campaign_id


def _mark_duplicates(rng: random.Random, drafts: list[_LeadDraft]) -> None:
    """Mark repeat enquiries from the same shopper at the same store as duplicates.

    The reference always points at the **first** lead of that shopper at that store inside
    the window, never at another duplicate, so following ``original_lead_id`` is a single
    hop rather than a chain. A lead credited with a sale is never marked as a duplicate: it
    is the opportunity that produced the deal, so excluding it from the funnel would drop a
    sale out of the numerator.
    """
    roots: dict[tuple[str, str], tuple[int, date]] = {}
    for index, draft in enumerate(drafts):
        if draft.customer_id is None:
            continue
        key = (draft.customer_id, draft.dealership_id)
        root = roots.get(key)
        if root is None:
            roots[key] = (index, draft.lead_created_date)
            continue
        root_index, root_date = root
        within_window = (draft.lead_created_date - root_date).days <= DUPLICATE_WINDOW_DAYS
        if draft.sale_id is None and within_window and rng.random() < DUPLICATE_PROBABILITY:
            draft.is_duplicate = True
            draft.original_index = root_index


def _to_record(lead_id: str, draft: _LeadDraft, drafts: Sequence[_LeadDraft]) -> LeadRecord:
    """Render one working draft as an immutable record."""
    original_lead_id = (
        lead_id_for(draft.original_index + 1) if draft.original_index is not None else None
    )
    days_to_sale = (
        (draft.sale_date - draft.lead_created_date).days if draft.sale_date is not None else None
    )
    del drafts  # Identifiers are ordinals, so no lookup into the population is needed.
    return LeadRecord(
        lead_id=lead_id,
        lead_created_date=draft.lead_created_date,
        dealership_id=draft.dealership_id,
        customer_id=draft.customer_id,
        vehicle_model_id=draft.vehicle_model_id,
        lead_source_id=draft.lead_source_id,
        campaign_id=draft.campaign_id,
        assigned_employee_id=draft.assigned_employee_id,
        sale_id=draft.sale_id,
        first_response_seconds=draft.first_response_seconds,
        is_contacted=draft.is_contacted,
        is_appointment_set=draft.is_appointment_set,
        is_appointment_shown=draft.is_appointment_shown,
        is_sold=draft.sale_id is not None,
        is_duplicate=draft.is_duplicate,
        original_lead_id=original_lead_id,
        days_to_sale=days_to_sale,
        sale_date=draft.sale_date,
    )


def _log_declared_distributions(records: Sequence[LeadRecord]) -> None:
    """Log the funnel shares and the response-time skew actually produced."""
    if not records:  # pragma: no cover - the population is never empty
        return
    graded = [record for record in records if not record.is_duplicate]
    responses = [
        record.first_response_seconds
        for record in records
        if record.first_response_seconds is not None
    ]
    ordered = sorted(responses)
    median = float(ordered[len(ordered) // 2]) if ordered else 0.0
    mean = (sum(responses) / len(responses)) if responses else 0.0
    _LOGGER.info(
        "lead_event distributions: leads=%d duplicate_share=%.4f never_responded_share=%.4f "
        "median_response=%.1f mean_response=%.1f contacted=%.4f appointment_set=%.4f "
        "appointment_shown=%.4f sold=%.4f",
        len(records),
        1.0 - len(graded) / len(records),
        1.0 - len(responses) / len(records),
        median,
        mean,
        _share(graded, "is_contacted"),
        _share(graded, "is_appointment_set"),
        _share(graded, "is_appointment_shown"),
        _share(graded, "is_sold"),
    )


def _share(records: Sequence[LeadRecord], attribute: str) -> float:
    """Return the share of records whose named boolean attribute is true."""
    if not records:  # pragma: no cover - guarded by the caller
        return 0.0
    return sum(1 for record in records if getattr(record, attribute)) / len(records)


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class LeadGenerator(BaseGenerator):
    """Build one ``lead_event`` row per unique CRM lead."""

    entity_name = ENTITY_LEAD_EVENT
    declared_columns = LEAD_EVENT_COLUMNS
    namespace = LEAD_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the lead frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 19 contract columns, in order, ordered by ``lead_id``.
        """
        records = build_lead_records(config)
        frame = pd.DataFrame.from_records(
            [lead_row(record) for record in records], columns=list(LEAD_EVENT_COLUMNS)
        )
        return frame.astype(LEAD_EVENT_DTYPES)


def lead_row(record: LeadRecord) -> dict[str, Any]:
    """Render one lead record as its declared row.

    Args:
        record: The record to render.

    Returns:
        A mapping keyed by :data:`LEAD_EVENT_COLUMNS`.
    """
    return {
        "lead_id": record.lead_id,
        "lead_created_date": record.lead_created_date,
        "dealership_id": record.dealership_id,
        "customer_id": record.customer_id,
        "vehicle_model_id": record.vehicle_model_id,
        "lead_source_id": record.lead_source_id,
        "campaign_id": record.campaign_id,
        "assigned_employee_id": record.assigned_employee_id,
        "sale_id": record.sale_id,
        "lead_count": 1,
        "first_response_seconds": record.first_response_seconds,
        "is_contacted": record.is_contacted,
        "is_appointment_set": record.is_appointment_set,
        "is_appointment_shown": record.is_appointment_shown,
        "is_sold": record.is_sold,
        "is_duplicate": record.is_duplicate,
        "original_lead_id": record.original_lead_id,
        "days_to_sale": record.days_to_sale,
        "source_system": SOURCE_SYSTEM,
    }


def generate_lead_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``lead_event`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return LeadGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_lead_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-LED-001`` through ``DQ-LED-008`` against the lead source entity.

    Args:
        dataset: The generated ``lead_event`` dataset.
        config: Resolved configuration, used to rebuild the finalized sales the sold leads
            must agree with.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        A report containing eight results, in check-id order.
    """
    frame = dataset.frame
    sales = {
        link.sale_id: link
        for link in sale_links(config, catalogue_path)
        if link.is_retail and link.customer_id is not None
    }
    return ValidationReport(
        (
            replace(
                check_unique_column(
                    frame,
                    "lead_id",
                    check_id=CHECK_LEAD_UNIQUE_ID,
                    check_name="lead_event.lead_id is unique",
                    target_object=ENTITY_LEAD_EVENT,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            check_column_schema(
                frame,
                LEAD_EVENT_COLUMNS,
                check_id=CHECK_LEAD_SCHEMA_MATCHES,
                check_name="lead_event matches its declared column contract",
                target_object=ENTITY_LEAD_EVENT,
            ),
            _check_funnel_implication(frame),
            _check_response_null_not_zero(frame),
            _check_sold_resolves_to_sale(frame, sales),
            _check_duplicate_reference(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_LEAD_NO_PROHIBITED_CONTENT,
                check_name="lead_event declares no prohibited personal-data or content column",
                target_object=ENTITY_LEAD_EVENT,
            ),
            _check_response_right_skewed(frame),
        )
    )


def _base_result(
    check_id: str, check_name: str, category: str, severity: CheckSeverity
) -> CheckResult:
    """Build the passing baseline for one lead check."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_LEAD_EVENT,
        severity=severity,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_funnel_implication(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LED-003`` -- the funnel stages nest, and a sold lead names its sale."""
    base = _base_result(
        CHECK_LEAD_FUNNEL_IMPLICATION,
        "the funnel implication chain holds on every lead",
        CHECK_CATEGORY_BUSINESS_RULE,
        CheckSeverity.CRITICAL,
    )
    required = ("is_contacted", "is_appointment_set", "is_appointment_shown", "is_sold", "sale_id")
    missing = [column for column in required if column not in frame.columns]
    if missing:
        return base.failed(f"Column(s) {', '.join(missing)} are missing from {ENTITY_LEAD_EVENT}.")

    contacted = frame["is_contacted"].astype(bool)
    appointment_set = frame["is_appointment_set"].astype(bool)
    shown = frame["is_appointment_shown"].astype(bool)
    sold = frame["is_sold"].astype(bool)
    problems = {
        "appointment set without contact": int((appointment_set & ~contacted).sum()),
        "appointment shown without an appointment": int((shown & ~appointment_set).sum()),
        "sold without a sale reference": int((sold & frame["sale_id"].isna()).sum()),
        "a sale reference without is_sold": int((~sold & frame["sale_id"].notna()).sum()),
    }
    total = sum(problems.values())
    if total == 0:
        return base
    detail = ", ".join(f"{label}={count}" for label, count in problems.items() if count)
    return base.failed(
        f"{total} lead(s) break the funnel implication chain: {detail}. Funnel stages that "
        "do not nest let a later stage exceed an earlier one.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_response_null_not_zero(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LED-004`` -- never responded is NULL, and a response is always positive."""
    base = _base_result(
        CHECK_LEAD_RESPONSE_NULL_NOT_ZERO,
        "never-responded leads carry NULL, never zero, response time",
        CHECK_CATEGORY_COMPLETENESS,
        CheckSeverity.CRITICAL,
    )
    if "first_response_seconds" not in frame.columns:
        return base.failed(f"Column 'first_response_seconds' is missing from {ENTITY_LEAD_EVENT}.")

    seconds = frame["first_response_seconds"]
    missing = seconds.isna()
    non_positive = int((seconds.notna() & (seconds.fillna(1) < 1)).sum())
    contacted_without_response = int((frame["is_contacted"].astype(bool) & missing).sum())
    never_responded = int(missing.sum())

    if non_positive or contacted_without_response:
        total = non_positive + contacted_without_response
        return base.failed(
            f"{non_positive} lead(s) record a response time of zero or less, and "
            f"{contacted_without_response} contacted lead(s) record no response time at all. "
            "Zero means an instantaneous answer, which is the opposite of never answering.",
            observed_value=float(total),
            failed_record_count=total,
        )
    if never_responded == 0:
        return base.failed(
            "No lead carries a NULL first_response_seconds. A dataset in which every lead "
            "was answered has no never-responded population, so the NULL-versus-zero "
            "distinction this entity exists to protect cannot be exercised.",
            observed_value=0.0,
            expected_value=1.0,
        )
    return replace(
        base, observed_value=float(never_responded), expected_value=float(never_responded)
    )


def _check_sold_resolves_to_sale(frame: pd.DataFrame, sales: dict[str, SaleLink]) -> CheckResult:
    """``DQ-LED-005`` -- every sold lead names a finalized retail sale that fits it."""
    base = _base_result(
        CHECK_LEAD_SOLD_RESOLVES_TO_SALE,
        "every sold lead resolves to a finalized retail sale",
        CHECK_CATEGORY_REFERENTIAL,
        CheckSeverity.CRITICAL,
    )
    sold = frame[frame["is_sold"].astype(bool)]
    offending: list[str] = []
    for record in sold.to_dict(orient="records"):
        sale = sales.get(str(record["sale_id"]))
        lead_id = str(record["lead_id"])
        if sale is None:
            offending.append(f"{lead_id} names unknown sale {record['sale_id']!r}")
            continue
        if sale.dealership_id != str(record["dealership_id"]):
            offending.append(f"{lead_id} is credited with a sale at another store")
        elif sale.customer_id != record["customer_id"]:
            offending.append(f"{lead_id} is credited with another shopper's sale")
        elif sale.sale_date < pd.Timestamp(record["lead_created_date"]).date():
            offending.append(f"{lead_id} is credited with a sale struck before it arrived")

    if not offending:
        return base
    shown = "; ".join(offending[:5])
    return base.failed(
        f"{len(offending)} sold lead(s) do not resolve to a finalized retail sale: {shown}.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_duplicate_reference(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LED-006`` -- a duplicate names an earlier, non-duplicate lead."""
    base = _base_result(
        CHECK_LEAD_DUPLICATE_REFERENCE,
        "duplicate leads carry a resolvable original lead reference",
        CHECK_CATEGORY_BUSINESS_RULE,
        CheckSeverity.CRITICAL,
    )
    duplicate = frame["is_duplicate"].astype(bool)
    original = frame["original_lead_id"]
    known = dict(zip(frame["lead_id"], duplicate, strict=True))

    problems = {
        "duplicate without an original reference": int((duplicate & original.isna()).sum()),
        "original reference on a lead that is not a duplicate": int(
            (~duplicate & original.notna()).sum()
        ),
    }
    unresolved = [
        str(value)
        for value in original.dropna()
        if str(value) not in known or bool(known[str(value)])
    ]
    problems["original reference that does not resolve to a non-duplicate lead"] = len(unresolved)
    total = sum(problems.values())
    if total == 0:
        return base
    detail = ", ".join(f"{label}={count}" for label, count in problems.items() if count)
    return base.failed(
        f"{total} lead(s) carry a broken duplicate reference: {detail}. A duplicate that "
        "cannot be identified cannot be excluded from a funnel denominator.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_response_right_skewed(frame: pd.DataFrame) -> CheckResult:
    """``DQ-LED-008`` -- the median response time sits materially below the mean."""
    base = _base_result(
        CHECK_LEAD_RESPONSE_RIGHT_SKEWED,
        "the response-time distribution is right-skewed",
        CHECK_CATEGORY_BUSINESS_RULE,
        CheckSeverity.WARNING,
    )
    responses = frame["first_response_seconds"].dropna().astype("float64")
    low, high = SKEW_RATIO_BOUNDS
    if responses.empty:  # pragma: no cover - guarded by DQ-LED-004
        return base.failed("No lead carries a response time, so skew cannot be measured.")

    median = float(responses.median())
    mean = float(responses.mean())
    ratio = mean / median if median > 0 else 0.0
    result = replace(base, observed_value=ratio, expected_value=(low + high) / 2)
    if low <= ratio <= high:
        return result
    return result.failed(
        f"The ratio of mean to median response time is {ratio:.3f}, outside the plausible "
        f"band [{low:.2f}, {high:.2f}]. A response-time distribution that is not right-"
        "skewed makes the mean-versus-median governance rule decorative."
    )
