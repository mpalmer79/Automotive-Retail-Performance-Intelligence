"""Generator for the ``appointment_event`` source entity behind ``warehouse.fact_appointment``.

Grain: **one row per scheduled appointment**. The columns mirror
``warehouse.fact_appointment`` (``PHASE1_CONTRACT.md`` §7) with the surrogate key dropped and
the remaining keys replaced by the natural identifiers a CRM would actually carry, exactly as
``sale_event`` mirrors ``warehouse.fact_vehicle_sale``.

Why this is a separate grain from ``fact_lead``
-----------------------------------------------
One lead can produce several appointments. A shopper books for Thursday, cancels on
Wednesday, rebooks for Saturday and finally comes in. That is one lead and three
appointments, and collapsing it to one row per lead would hide two broken appointments and
overstate the show rate. The two facts therefore live at two grains, and this module is what
makes that difference genuinely present in the data rather than merely asserted.

An advance cancellation is not a no-show
----------------------------------------
This is the distinction the whole entity turns on, and it is the reason
``is_cancelled_in_advance`` and ``is_shown`` are separate mutually exclusive flags rather
than one status column:

* **Advance cancellation** -- the shopper rang ahead and cancelled. The store got the time
  back and could book somebody else into it.
* **No-show** -- the shopper simply did not arrive. **Neither cancelled nor shown.** The
  time was held and lost.
* **Shown** -- the shopper arrived.

Conflating the two understates broken appointments, and it flatters the show rate in
whichever direction the analyst happens to prefer: put advance cancellations in the
denominator and the show rate collapses; drop no-shows from it and the show rate looks
excellent. ARPI keeps them distinct so a reporting view has to state which denominator it
means ([KPI_CATALOG.md](../../../KPI_CATALOG.md) §27).

``minutes_early_or_late`` is NULL when nobody showed
----------------------------------------------------
Same rule as ``fact_lead.first_response_seconds``, for the same reason. Zero would mean the
shopper arrived exactly on time; NULL means there was no arrival at all. Encoding the second
as the first would make a no-show look like the most punctual appointment in the dataset.
``DQ-APT-007`` enforces it.

Sold appointments point at real, finalized sales
------------------------------------------------
Only a **retail** sale carries a customer, so only a retail sale is linkable from the funnel.
That is intended rather than a limitation: a wholesale unit went to the auction and no
shopper ever sat at a desk for it. An appointment is marked sold only when its own lead was
credited with a finalized retail sale and this is the appointment the shopper showed for.
"""

from __future__ import annotations

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
from arpi.generation.employee import (
    JOB_ROLE_BDC_MANAGER,
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_GENERAL_MANAGER,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_SALESPERSON,
)
from arpi.generation.lead import (
    LeadRecord,
    RoleInterval,
    build_lead_records,
    choose_role_interval,
    employee_role_intervals,
)
from arpi.generation.sale import SaleLink, sale_links
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
#: Source entity produced by this module; loaded as ``warehouse.fact_appointment``.
ENTITY_APPOINTMENT_EVENT: Final = "appointment_event"

#: Seeding namespace for this entity, and this entity only.
APPOINTMENT_NAMESPACE: Final = "appointment_event"

APPOINTMENT_ID_PREFIX: Final = "APT-"
APPOINTMENT_ID_DIGITS: Final = 8

# ---------------------------------------------------------------------------------------
# Column contract -- PHASE1_CONTRACT.md §7, natural ids and real dates
# ---------------------------------------------------------------------------------------
APPOINTMENT_EVENT_COLUMNS: Final[tuple[str, ...]] = (
    "appointment_id",
    "created_date",
    "scheduled_date",
    "show_date",
    "dealership_id",
    "lead_id",
    "customer_id",
    "salesperson_id",
    "bdc_employee_id",
    "vehicle_model_id",
    "sale_id",
    "appointment_count",
    "is_confirmed",
    "is_cancelled_in_advance",
    "is_shown",
    "is_test_drive",
    "is_write_up",
    "is_sold",
    "minutes_early_or_late",
    "source_system",
)

#: Columns that may be NULL, and the modelled reason each one is.
#:
#: * ``show_date`` -- nobody arrived, so there is no arrival date.
#: * ``customer_id`` -- the originating lead was anonymous.
#: * ``salesperson_id`` / ``bdc_employee_id`` -- the store had nobody in that role on the
#:   day. A store with no business development centre books appointments off the floor.
#: * ``vehicle_model_id`` -- the shopper never named a unit.
#: * ``sale_id`` -- the appointment did not produce a deal.
#: * ``minutes_early_or_late`` -- **nobody showed.** Never rendered as zero.
APPOINTMENT_EVENT_NULLABLE_COLUMNS: Final[tuple[str, ...]] = (
    "show_date",
    "customer_id",
    "salesperson_id",
    "bdc_employee_id",
    "vehicle_model_id",
    "sale_id",
    "minutes_early_or_late",
)

APPOINTMENT_EVENT_DTYPES: Final[dict[str, str]] = {
    "appointment_id": "string",
    "created_date": "datetime64[s]",
    "scheduled_date": "datetime64[s]",
    "show_date": "datetime64[s]",
    "dealership_id": "string",
    "lead_id": "string",
    "customer_id": "string",
    "salesperson_id": "string",
    "bdc_employee_id": "string",
    "vehicle_model_id": "string",
    "sale_id": "string",
    "appointment_count": "int16",
    "is_confirmed": "bool",
    "is_cancelled_in_advance": "bool",
    "is_shown": "bool",
    "is_test_drive": "bool",
    "is_write_up": "bool",
    "is_sold": "bool",
    "minutes_early_or_late": "Int32",
    "source_system": "string",
}

# ---------------------------------------------------------------------------------------
# How many appointments one lead produces
# ---------------------------------------------------------------------------------------
#: Number of appointments a lead with ``is_appointment_set`` produces, and their weights.
#: Above one for a genuine minority, which is what exercises the grain difference between
#: ``fact_lead`` and ``fact_appointment``.
APPOINTMENTS_PER_LEAD: Final[tuple[int, ...]] = (1, 2, 3)
APPOINTMENTS_PER_LEAD_WEIGHTS: Final[tuple[float, ...]] = (0.72, 0.21, 0.07)

# ---------------------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------------------
#: Days between the lead arriving and the first appointment being booked, with weights.
BOOKING_LAG_DAYS: Final[tuple[int, ...]] = (0, 1, 2, 3, 5, 8)
BOOKING_LAG_WEIGHTS: Final[tuple[float, ...]] = (0.46, 0.24, 0.12, 0.08, 0.06, 0.04)

#: Days between an appointment being booked and the slot it is booked into, with weights.
#: Zero is common: a great many appointments are booked for later the same day.
APPOINTMENT_LEAD_TIME_DAYS: Final[tuple[int, ...]] = (0, 1, 2, 3, 4, 6, 9)
APPOINTMENT_LEAD_TIME_WEIGHTS: Final[tuple[float, ...]] = (
    0.31,
    0.27,
    0.15,
    0.10,
    0.08,
    0.06,
    0.03,
)

#: Days between one broken appointment's slot and the rebooking of the next, with weights.
REBOOK_LAG_DAYS: Final[tuple[int, ...]] = (1, 2, 3, 5)
REBOOK_LAG_WEIGHTS: Final[tuple[float, ...]] = (0.42, 0.28, 0.19, 0.11)

# ---------------------------------------------------------------------------------------
# Outcomes
# ---------------------------------------------------------------------------------------
#: Probability that an appointment which will be broken was **cancelled in advance** rather
#: than no-showed. The remainder are no-shows: neither cancelled nor shown.
ADVANCE_CANCELLATION_SHARE: Final = 0.45

#: Probability an appointment is confirmed, by whether it was ultimately shown. Confirmation
#: genuinely predicts attendance, so the two cannot be drawn independently; the conditioning
#: runs from the outcome to the confirmation because the lead-grain funnel already fixed the
#: outcome, and a lead and its appointments must not disagree.
CONFIRMED_SHARE_SHOWN: Final = 0.84
CONFIRMED_SHARE_BROKEN: Final = 0.52

#: Probability a shown appointment includes a test drive.
TEST_DRIVE_SHARE: Final = 0.63

#: Probability a shown appointment produces a written deal. A sold appointment is always
#: written up, because the paperwork is the deal.
WRITE_UP_SHARE: Final = 0.55

#: Mean and spread, in minutes, of arrival relative to the booked time. The mean is slightly
#: positive because more shoppers run late than early, and the spread reaches both signs.
MINUTES_LATE_MEAN: Final = 7.0
MINUTES_LATE_SIGMA: Final = 16.0

#: Inclusive clamp on ``minutes_early_or_late``. Beyond these the appointment would have been
#: rebooked rather than logged as an arrival.
MINUTES_EARLY_OR_LATE_BOUNDS: Final[tuple[int, int]] = (-45, 120)

#: Roles eligible to be recorded as the salesperson on an appointment.
SALESPERSON_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_SALESPERSON,
    JOB_ROLE_SALES_MANAGER,
    JOB_ROLE_GENERAL_MANAGER,
)

#: Roles eligible to be recorded as the business development representative.
BDC_EMPLOYEE_ROLES: Final[tuple[str, ...]] = (
    JOB_ROLE_BDC_REPRESENTATIVE,
    JOB_ROLE_BDC_MANAGER,
)

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (prefix reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_APPOINTMENT_UNIQUE_ID: Final = "DQ-APT-001"
CHECK_APPOINTMENT_SCHEMA_MATCHES: Final = "DQ-APT-002"
CHECK_APPOINTMENT_DATE_ORDERING: Final = "DQ-APT-003"
CHECK_APPOINTMENT_SHOWN_NOT_CANCELLED: Final = "DQ-APT-004"
CHECK_APPOINTMENT_WRITE_UP_IMPLIES_SHOWN: Final = "DQ-APT-005"
CHECK_APPOINTMENT_SOLD_LINKS_TO_SALE: Final = "DQ-APT-006"
CHECK_APPOINTMENT_MINUTES_NULL_WHEN_NOT_SHOWN: Final = "DQ-APT-007"
CHECK_APPOINTMENT_NO_PROHIBITED_CONTENT: Final = "DQ-APT-008"

#: Every check identifier this module emits, in identifier order.
APPOINTMENT_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_APPOINTMENT_UNIQUE_ID,
    CHECK_APPOINTMENT_SCHEMA_MATCHES,
    CHECK_APPOINTMENT_DATE_ORDERING,
    CHECK_APPOINTMENT_SHOWN_NOT_CANCELLED,
    CHECK_APPOINTMENT_WRITE_UP_IMPLIES_SHOWN,
    CHECK_APPOINTMENT_SOLD_LINKS_TO_SALE,
    CHECK_APPOINTMENT_MINUTES_NULL_WHEN_NOT_SHOWN,
    CHECK_APPOINTMENT_NO_PROHIBITED_CONTENT,
)

_WAREHOUSE_FACT_APPOINTMENT: Final = "warehouse.fact_appointment"

register_checks(
    (
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_UNIQUE_ID,
            check_name="appointment_event.appointment_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "appointment_id is the grain. The grain is deliberately finer than fact_lead, "
                "so a duplicated identifier would inflate exactly the measure -- appointments "
                "booked -- that the finer grain exists to make countable."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_SCHEMA_MATCHES,
            check_name="appointment_event matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, and "
                "this entity carries six adjacent booleans -- including the cancelled and "
                "shown pair -- that a positional swap would silently interchange."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_DATE_ORDERING,
            check_name="no appointment is scheduled or shown before it was created",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "scheduled_date >= created_date, show_date >= created_date, and is_shown "
                "implies a show date. An impossible sequence produces negative booking lead "
                "times that every scheduling measure would then average in."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_SHOWN_NOT_CANCELLED,
            check_name="shown appointments were not cancelled in advance",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "is_shown implies NOT is_cancelled_in_advance. The two are different events: "
                "a cancellation gives the time back, a no-show does not, and a no-show is "
                "neither. Conflating them understates broken appointments and lets the show "
                "rate be flattered by choosing a denominator after the fact."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_WRITE_UP_IMPLIES_SHOWN,
            check_name="a write-up implies the shopper showed",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "A deal cannot be written on somebody who never arrived. A write-up on a "
                "broken appointment would make the write-up rate exceed the show rate, which "
                "is impossible and immediately visible on a funnel visual."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_SOLD_LINKS_TO_SALE,
            check_name="every sold appointment shows and resolves to a finalized sale",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "is_sold implies is_shown, a sale reference, and a finalized retail sale at "
                "the same store on or after the show date. Only retail sales carry a "
                "customer, so only retail sales are linkable from the funnel."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_MINUTES_NULL_WHEN_NOT_SHOWN,
            check_name="minutes early or late is NULL when nobody showed",
            category=CHECK_CATEGORY_COMPLETENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "Zero minutes means the shopper arrived exactly on time. A no-show has no "
                "arrival at all, so it carries NULL. Encoding the second as the first would "
                "make every broken appointment look like the most punctual in the dataset."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
        CheckDefinition(
            check_id=CHECK_APPOINTMENT_NO_PROHIBITED_CONTENT,
            check_name="appointment_event declares no prohibited personal-data or content column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_APPOINTMENT_EVENT,
            description=(
                "An appointment record in a real CRM carries the confirmation call notes and "
                "the reminder message text. ARPI generates neither. The check inspects the "
                "schema, so an empty notes column still fails the run."
            ),
            applies_to=(_WAREHOUSE_FACT_APPOINTMENT,),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class AppointmentRecord:
    """One scheduled appointment.

    Attributes:
        appointment_id: Identifier in the reserved ``APT-########`` scheme.
        created_date: Day the appointment was booked.
        scheduled_date: Day it was booked for; never before ``created_date``.
        show_date: Day the shopper arrived, or ``None`` when they did not.
        dealership_id: Store the appointment was booked at.
        lead_id: The CRM lead this appointment belongs to.
        customer_id: The shopper, or ``None`` when the lead was anonymous.
        salesperson_id: Salesperson expected to take the appointment, or ``None``.
        bdc_employee_id: Business development representative who booked it, or ``None``.
        vehicle_model_id: Model of interest carried from the lead, or ``None``.
        sale_id: The finalized retail sale this appointment produced, or ``None``.
        is_confirmed: Whether the appointment was confirmed before the slot.
        is_cancelled_in_advance: Whether the shopper cancelled ahead of the slot.
            **Mutually exclusive with** ``is_shown``; a no-show is neither.
        is_shown: Whether the shopper arrived.
        is_test_drive: Whether the visit included a test drive.
        is_write_up: Whether a deal was written. Implies ``is_shown``.
        is_sold: Whether the visit produced a finalized retail sale.
        minutes_early_or_late: Minutes relative to the booked time, negative for early, or
            ``None`` when nobody showed. **Never zero as a stand-in for absent.**
    """

    appointment_id: str
    created_date: date
    scheduled_date: date
    show_date: date | None
    dealership_id: str
    lead_id: str
    customer_id: str | None
    salesperson_id: str | None
    bdc_employee_id: str | None
    vehicle_model_id: str | None
    sale_id: str | None
    is_confirmed: bool
    is_cancelled_in_advance: bool
    is_shown: bool
    is_test_drive: bool
    is_write_up: bool
    is_sold: bool
    minutes_early_or_late: int | None


# ---------------------------------------------------------------------------------------
# Derivations
# ---------------------------------------------------------------------------------------
def appointment_id_for(ordinal: int) -> str:
    """Render a 1-based ordinal as an ``APT-########`` identifier.

    Args:
        ordinal: 1-based position in the ordered appointment population.

    Returns:
        The zero-padded identifier, e.g. ``"APT-00011882"``.

    Raises:
        GenerationError: If ``ordinal`` is not positive, or is too large for the reserved
            eight-digit width.
    """
    if ordinal < 1:
        raise GenerationError(
            f"appointment_id ordinals start at 1, got {ordinal}.",
            entity=ENTITY_APPOINTMENT_EVENT,
        )
    if ordinal >= 10**APPOINTMENT_ID_DIGITS:
        raise GenerationError(
            f"appointment_id ordinal {ordinal} does not fit the reserved "
            f"{APPOINTMENT_ID_PREFIX}{'#' * APPOINTMENT_ID_DIGITS} scheme. Widen the "
            "identifier scheme in PHASE1_CONTRACT.md §5 before generating this many "
            "appointments.",
            entity=ENTITY_APPOINTMENT_EVENT,
        )
    return f"{APPOINTMENT_ID_PREFIX}{ordinal:0{APPOINTMENT_ID_DIGITS}d}"


# ---------------------------------------------------------------------------------------
# Population construction
# ---------------------------------------------------------------------------------------
@dataclass(slots=True)
class _AppointmentDraft:
    """Mutable working record used while the population is assembled."""

    created_date: date
    scheduled_date: date
    dealership_id: str
    lead_id: str
    customer_id: str | None
    vehicle_model_id: str | None
    sequence: int
    is_shown: bool
    is_cancelled_in_advance: bool
    is_confirmed: bool
    is_test_drive: bool
    is_write_up: bool
    sale_id: str | None
    minutes_early_or_late: int | None
    salesperson_id: str | None = None
    bdc_employee_id: str | None = None


def build_appointment_records(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[AppointmentRecord, ...]:
    """Build every scheduled appointment for the active profile.

    Appointments are expanded from the leads that set one, so the two facts cannot
    contradict each other: a lead whose ``is_appointment_shown`` is true has exactly one
    shown appointment, and a lead whose it is false has none.

    Args:
        config: Resolved configuration supplying the master seed, the scale mode and the
            reporting window.
        catalogue_path: Explicit vehicle model catalogue path; defaults to the
            source-controlled copy.

    Returns:
        The appointments, ordered by ``appointment_id``, which is assigned over
        ``(created_date, lead_id, sequence)`` so the ordering is stable and chronological.
    """
    rng = rng_for(config.random_seed, APPOINTMENT_NAMESPACE)
    intervals = employee_role_intervals(config)
    window_end = config.reporting.end_date

    drafts: list[_AppointmentDraft] = []
    for lead in build_lead_records(config, catalogue_path):
        if not lead.is_appointment_set:
            continue
        drafts.extend(_draft_for_lead(rng, lead, window_end))

    drafts.sort(key=lambda draft: (draft.created_date, draft.lead_id, draft.sequence))
    for draft in drafts:
        _assign_employees(rng, draft, intervals)

    records = tuple(
        _to_record(appointment_id_for(ordinal), draft)
        for ordinal, draft in enumerate(drafts, start=1)
    )
    _log_declared_distributions(records)
    return records


def _draft_for_lead(
    rng: random.Random, lead: LeadRecord, window_end: date
) -> list[_AppointmentDraft]:
    """Expand one appointment-setting lead into its appointments.

    The **last** appointment carries the lead's outcome: if the shopper eventually showed,
    they showed for the final booking, and every earlier one was broken. That is what makes
    the multi-appointment population meaningful -- a lead with three appointments and one
    show contributes two broken appointments to the denominator rather than none.
    """
    count = rng.choices(APPOINTMENTS_PER_LEAD, weights=APPOINTMENTS_PER_LEAD_WEIGHTS, k=1)[0]
    latest = min(lead.sale_date, window_end) if lead.sale_date is not None else window_end
    created = _bounded(
        lead.lead_created_date
        + timedelta(days=rng.choices(BOOKING_LAG_DAYS, weights=BOOKING_LAG_WEIGHTS, k=1)[0]),
        lead.lead_created_date,
        latest,
    )

    drafts: list[_AppointmentDraft] = []
    for sequence in range(1, count + 1):
        scheduled = _bounded(
            created
            + timedelta(
                days=rng.choices(
                    APPOINTMENT_LEAD_TIME_DAYS, weights=APPOINTMENT_LEAD_TIME_WEIGHTS, k=1
                )[0]
            ),
            created,
            latest,
        )
        is_last = sequence == count
        shown = is_last and lead.is_appointment_shown
        drafts.append(_draft_one(rng, lead, created, scheduled, sequence, shown=shown))
        created = _bounded(
            scheduled
            + timedelta(days=rng.choices(REBOOK_LAG_DAYS, weights=REBOOK_LAG_WEIGHTS, k=1)[0]),
            scheduled,
            latest,
        )
    return drafts


def _draft_one(
    rng: random.Random,
    lead: LeadRecord,
    created: date,
    scheduled: date,
    sequence: int,
    *,
    shown: bool,
) -> _AppointmentDraft:
    """Draw the outcome flags for one appointment."""
    cancelled = (not shown) and rng.random() < ADVANCE_CANCELLATION_SHARE
    confirmed = rng.random() < (CONFIRMED_SHARE_SHOWN if shown else CONFIRMED_SHARE_BROKEN)
    sold = shown and lead.is_sold
    write_up = sold or (shown and rng.random() < WRITE_UP_SHARE)
    return _AppointmentDraft(
        created_date=created,
        scheduled_date=scheduled,
        dealership_id=lead.dealership_id,
        lead_id=lead.lead_id,
        customer_id=lead.customer_id,
        vehicle_model_id=lead.vehicle_model_id,
        sequence=sequence,
        is_shown=shown,
        is_cancelled_in_advance=cancelled,
        is_confirmed=confirmed,
        is_test_drive=shown and rng.random() < TEST_DRIVE_SHARE,
        is_write_up=write_up,
        sale_id=lead.sale_id if sold else None,
        minutes_early_or_late=_draw_minutes(rng) if shown else None,
    )


def _draw_minutes(rng: random.Random) -> int:
    """Draw arrival punctuality in minutes, negative for early."""
    low, high = MINUTES_EARLY_OR_LATE_BOUNDS
    return int(min(max(round(rng.gauss(MINUTES_LATE_MEAN, MINUTES_LATE_SIGMA)), low), high))


def _bounded(value: date, earliest: date, latest: date) -> date:
    """Clamp a date into ``[earliest, latest]``, preferring ``earliest`` when inverted."""
    if latest < earliest:  # pragma: no cover - the caller always orders the bounds
        return earliest
    return min(max(value, earliest), latest)


def _assign_employees(
    rng: random.Random, draft: _AppointmentDraft, intervals: Sequence[RoleInterval]
) -> None:
    """Attach the salesperson and the business development representative, if any."""
    salesperson = choose_role_interval(
        intervals, draft.dealership_id, SALESPERSON_ROLES, draft.scheduled_date, rng
    )
    bdc = choose_role_interval(
        intervals, draft.dealership_id, BDC_EMPLOYEE_ROLES, draft.created_date, rng
    )
    draft.salesperson_id = salesperson.employee_id if salesperson is not None else None
    draft.bdc_employee_id = bdc.employee_id if bdc is not None else None


def _to_record(appointment_id: str, draft: _AppointmentDraft) -> AppointmentRecord:
    """Render one working draft as an immutable record."""
    return AppointmentRecord(
        appointment_id=appointment_id,
        created_date=draft.created_date,
        scheduled_date=draft.scheduled_date,
        show_date=draft.scheduled_date if draft.is_shown else None,
        dealership_id=draft.dealership_id,
        lead_id=draft.lead_id,
        customer_id=draft.customer_id,
        salesperson_id=draft.salesperson_id,
        bdc_employee_id=draft.bdc_employee_id,
        vehicle_model_id=draft.vehicle_model_id,
        sale_id=draft.sale_id,
        is_confirmed=draft.is_confirmed,
        is_cancelled_in_advance=draft.is_cancelled_in_advance,
        is_shown=draft.is_shown,
        is_test_drive=draft.is_test_drive,
        is_write_up=draft.is_write_up,
        is_sold=draft.sale_id is not None,
        minutes_early_or_late=draft.minutes_early_or_late,
    )


def _log_declared_distributions(records: Sequence[AppointmentRecord]) -> None:
    """Log the show, cancellation and no-show shares actually produced."""
    if not records:  # pragma: no cover - the population is never empty
        return
    shown = sum(1 for record in records if record.is_shown)
    cancelled = sum(1 for record in records if record.is_cancelled_in_advance)
    leads = len({record.lead_id for record in records})
    _LOGGER.info(
        "appointment_event distributions: appointments=%d leads=%d appointments_per_lead=%.3f "
        "shown_share=%.4f advance_cancellation_share=%.4f no_show_share=%.4f",
        len(records),
        leads,
        len(records) / leads,
        shown / len(records),
        cancelled / len(records),
        (len(records) - shown - cancelled) / len(records),
    )


# ---------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------
class AppointmentGenerator(BaseGenerator):
    """Build one ``appointment_event`` row per scheduled appointment."""

    entity_name = ENTITY_APPOINTMENT_EVENT
    declared_columns = APPOINTMENT_EVENT_COLUMNS
    namespace = APPOINTMENT_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the appointment frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 20 contract columns, in order, ordered by ``appointment_id``.
        """
        records = build_appointment_records(config)
        frame = pd.DataFrame.from_records(
            [appointment_row(record) for record in records],
            columns=list(APPOINTMENT_EVENT_COLUMNS),
        )
        return frame.astype(APPOINTMENT_EVENT_DTYPES)


def appointment_row(record: AppointmentRecord) -> dict[str, Any]:
    """Render one appointment record as its declared row.

    Args:
        record: The record to render.

    Returns:
        A mapping keyed by :data:`APPOINTMENT_EVENT_COLUMNS`.
    """
    return {
        "appointment_id": record.appointment_id,
        "created_date": record.created_date,
        "scheduled_date": record.scheduled_date,
        "show_date": record.show_date,
        "dealership_id": record.dealership_id,
        "lead_id": record.lead_id,
        "customer_id": record.customer_id,
        "salesperson_id": record.salesperson_id,
        "bdc_employee_id": record.bdc_employee_id,
        "vehicle_model_id": record.vehicle_model_id,
        "sale_id": record.sale_id,
        "appointment_count": 1,
        "is_confirmed": record.is_confirmed,
        "is_cancelled_in_advance": record.is_cancelled_in_advance,
        "is_shown": record.is_shown,
        "is_test_drive": record.is_test_drive,
        "is_write_up": record.is_write_up,
        "is_sold": record.is_sold,
        "minutes_early_or_late": record.minutes_early_or_late,
        "source_system": SOURCE_SYSTEM,
    }


def generate_appointment_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``appointment_event`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return AppointmentGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# Data-quality suite
# ---------------------------------------------------------------------------------------
def validate_appointment_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, catalogue_path: Path | None = None
) -> ValidationReport:
    """Run ``DQ-APT-001`` through ``DQ-APT-008`` against the appointment source entity.

    Args:
        dataset: The generated ``appointment_event`` dataset.
        config: Resolved configuration, used to rebuild the finalized sales the sold
            appointments must agree with.
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
                    "appointment_id",
                    check_id=CHECK_APPOINTMENT_UNIQUE_ID,
                    check_name="appointment_event.appointment_id is unique",
                    target_object=ENTITY_APPOINTMENT_EVENT,
                ),
                check_category=CHECK_CATEGORY_UNIQUENESS,
            ),
            check_column_schema(
                frame,
                APPOINTMENT_EVENT_COLUMNS,
                check_id=CHECK_APPOINTMENT_SCHEMA_MATCHES,
                check_name="appointment_event matches its declared column contract",
                target_object=ENTITY_APPOINTMENT_EVENT,
            ),
            _check_date_ordering(frame),
            _check_shown_not_cancelled(frame),
            _check_write_up_implies_shown(frame),
            _check_sold_links_to_sale(frame, sales),
            _check_minutes_null_when_not_shown(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_APPOINTMENT_NO_PROHIBITED_CONTENT,
                check_name=(
                    "appointment_event declares no prohibited personal-data or content column"
                ),
                target_object=ENTITY_APPOINTMENT_EVENT,
            ),
        )
    )


def _base_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing baseline for one appointment check."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_APPOINTMENT_EVENT,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_date_ordering(frame: pd.DataFrame) -> CheckResult:
    """``DQ-APT-003`` -- nothing happens before the appointment was created."""
    base = _base_result(
        CHECK_APPOINTMENT_DATE_ORDERING,
        "no appointment is scheduled or shown before it was created",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    created = pd.to_datetime(frame["created_date"])
    scheduled = pd.to_datetime(frame["scheduled_date"])
    show = pd.to_datetime(frame["show_date"])
    shown = frame["is_shown"].astype(bool)
    problems = {
        "scheduled before created": int((scheduled < created).sum()),
        "shown before created": int((show.notna() & (show < created)).sum()),
        "shown without a show date": int((shown & show.isna()).sum()),
        "a show date without is_shown": int((~shown & show.notna()).sum()),
    }
    total = sum(problems.values())
    if total == 0:
        return base
    detail = ", ".join(f"{label}={count}" for label, count in problems.items() if count)
    return base.failed(
        f"{total} appointment(s) carry an impossible date sequence: {detail}.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_shown_not_cancelled(frame: pd.DataFrame) -> CheckResult:
    """``DQ-APT-004`` -- shown and cancelled-in-advance are mutually exclusive."""
    base = _base_result(
        CHECK_APPOINTMENT_SHOWN_NOT_CANCELLED,
        "shown appointments were not cancelled in advance",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int(
        (frame["is_shown"].astype(bool) & frame["is_cancelled_in_advance"].astype(bool)).sum()
    )
    if offending == 0:
        return base
    return base.failed(
        f"{offending} appointment(s) are recorded as both shown and cancelled in advance. "
        "They are different events: a cancellation returns the time to the store, a no-show "
        "does not, and a no-show is neither cancelled nor shown.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_write_up_implies_shown(frame: pd.DataFrame) -> CheckResult:
    """``DQ-APT-005`` -- a deal cannot be written on somebody who never arrived."""
    base = _base_result(
        CHECK_APPOINTMENT_WRITE_UP_IMPLIES_SHOWN,
        "a write-up implies the shopper showed",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int(
        (frame["is_write_up"].astype(bool) & ~frame["is_shown"].astype(bool)).sum()
    )
    if offending == 0:
        return base
    return base.failed(
        f"{offending} appointment(s) record a write-up without a show. A write-up rate above "
        "the show rate is impossible.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_sold_links_to_sale(frame: pd.DataFrame, sales: dict[str, SaleLink]) -> CheckResult:
    """``DQ-APT-006`` -- a sold appointment shows and names a finalized retail sale."""
    base = _base_result(
        CHECK_APPOINTMENT_SOLD_LINKS_TO_SALE,
        "every sold appointment shows and resolves to a finalized sale",
        CHECK_CATEGORY_REFERENTIAL,
    )
    sold = frame[frame["is_sold"].astype(bool)]
    offending: list[str] = []
    for record in sold.to_dict(orient="records"):
        appointment_id = str(record["appointment_id"])
        if not bool(record["is_shown"]):
            offending.append(f"{appointment_id} is sold without a show")
            continue
        sale = sales.get(str(record["sale_id"]))
        if sale is None:
            offending.append(f"{appointment_id} names unknown sale {record['sale_id']!r}")
        elif sale.dealership_id != str(record["dealership_id"]):
            offending.append(f"{appointment_id} is credited with a sale at another store")
        elif sale.sale_date < pd.Timestamp(record["show_date"]).date():
            offending.append(f"{appointment_id} shows after the sale it claims")
    unsold_with_sale = int(
        (~frame["is_sold"].astype(bool) & frame["sale_id"].notna()).sum()
    )
    total = len(offending) + unsold_with_sale
    if total == 0:
        return base
    shown = "; ".join(offending[:5]) or "none"
    return base.failed(
        f"{total} appointment(s) break the sold-to-sale linkage: {shown}; "
        f"{unsold_with_sale} unsold appointment(s) carry a sale reference.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_minutes_null_when_not_shown(frame: pd.DataFrame) -> CheckResult:
    """``DQ-APT-007`` -- punctuality is NULL, not zero, when nobody arrived."""
    base = _base_result(
        CHECK_APPOINTMENT_MINUTES_NULL_WHEN_NOT_SHOWN,
        "minutes early or late is NULL when nobody showed",
        CHECK_CATEGORY_COMPLETENESS,
    )
    shown = frame["is_shown"].astype(bool)
    minutes = frame["minutes_early_or_late"]
    problems = {
        "not shown but a punctuality value is recorded": int((~shown & minutes.notna()).sum()),
        "shown but no punctuality value is recorded": int((shown & minutes.isna()).sum()),
    }
    total = sum(problems.values())
    if total == 0:
        return base
    detail = ", ".join(f"{label}={count}" for label, count in problems.items() if count)
    return base.failed(
        f"{total} appointment(s) encode punctuality incorrectly: {detail}. Zero minutes means "
        "arriving exactly on time; a no-show has no arrival at all.",
        observed_value=float(total),
        failed_record_count=total,
    )
