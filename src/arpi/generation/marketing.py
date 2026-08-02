"""Generators for ``warehouse.dim_marketing_campaign`` and the marketing-spend fact source.

Two entities live here because they are one story: a campaign is a named initiative, and
the spend fact is what that initiative cost, month by month and store by store. Splitting
them across modules would mean regenerating the campaign population twice with two
seeding namespaces, and the second copy would have to agree with the first exactly.

Fictional vendors only
----------------------
Every ``vendor_name`` is invented. No real advertising agency, marketplace, broadcaster or
mail house is named anywhere in ARPI. The names are built from the fictional group's own
geography so a reader can see at a glance that they are placeholders. This is the same
rule the lead-source module follows and for the same reason: this generator attaches
invented spend, invented delivery and invented lead counts to every vendor, and attaching
invented commercial behaviour to a **named real company** would be a fabricated claim
about that company.

The vendor-versus-CRM gap is deliberate
---------------------------------------
``vendor_reported_leads`` is generated as a **documented inflation over the same
underlying true lead count the CRM lead fact will draw from** -- not as an independent
random number. Media vendors systematically over-report: duplicate submissions from one
shopper, form fills that never produce a contactable record, and short inbound calls are
all commonly counted as leads on a vendor invoice and are not leads in the CRM. The
inflation factor is :data:`VENDOR_OVER_REPORT_FACTOR`.

This is an intended analytical finding, not a defect. A portfolio dataset in which the
vendor's number and the CRM's number agree perfectly would be teaching the wrong lesson:
in real dealership reporting they never do, and the first job of a marketing analyst is to
know which number they are looking at.

Money
-----
Every amount is a :class:`decimal.Decimal` quantized to ``0.01`` with ``ROUND_HALF_UP``.
No float ever reaches ``spend_amount``.

Seeding
-------
Two namespaces, one per entity: ``dim_marketing_campaign`` and ``marketing_spend_event``.
The spend generator rebuilds the campaign population deterministically and then draws its
own numbers from its own stream, so neither entity can perturb the other's digest -- or
any other entity's.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
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
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.dealership import STORE_DEFINITIONS
from arpi.generation.lead_source import (
    ALL_LEAD_SOURCE_IDS,
    MONEY_QUANTUM,
    TOTAL_LEAD_COUNT_BY_SCALE,
    lead_source_behaviour,
)
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

    from arpi.config import ArpiConfig

# ---------------------------------------------------------------------------------------
# Entity identity and seeding namespaces
# ---------------------------------------------------------------------------------------
#: Warehouse dimension produced by this module.
ENTITY_DIM_MARKETING_CAMPAIGN: Final = "dim_marketing_campaign"

#: Source entity feeding ``warehouse.fact_marketing_spend``. Named like the other
#: pre-warehouse source entities (``acquisition_event``, ``sale_event``): it carries
#: natural identifiers rather than surrogate keys, which are assigned at load.
ENTITY_MARKETING_SPEND: Final = "marketing_spend_event"

CAMPAIGN_NAMESPACE: Final = "dim_marketing_campaign"
MARKETING_SPEND_NAMESPACE: Final = "marketing_spend_event"

# ---------------------------------------------------------------------------------------
# Column contracts (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_MARKETING_CAMPAIGN_COLUMNS: Final[tuple[str, ...]] = (
    "campaign_key",
    "campaign_id",
    "campaign_name",
    "channel",
    "vendor_name",
    "lead_source_id",
    "start_date",
    "end_date",
    "target_department",
    "target_vehicle_category",
    "source_system",
)

DIM_MARKETING_CAMPAIGN_DTYPES: Final[dict[str, str]] = {
    "campaign_key": "int32",
    "campaign_id": "string",
    "campaign_name": "string",
    "channel": "string",
    "vendor_name": "string",
    "lead_source_id": "string",
    "start_date": "datetime64[s]",
    "end_date": "datetime64[s]",
    "target_department": "string",
    "target_vehicle_category": "string",
    "source_system": "string",
}

#: ``end_date`` is the only nullable column: NULL means the campaign was still running
#: when the reporting window closed.
DIM_MARKETING_CAMPAIGN_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in DIM_MARKETING_CAMPAIGN_COLUMNS if column != "end_date"
)

MARKETING_SPEND_COLUMNS: Final[tuple[str, ...]] = (
    "marketing_spend_id",
    "month_date_key",
    "dealership_id",
    "campaign_id",
    "lead_source_id",
    "spend_amount",
    "impressions",
    "clicks",
    "calls",
    "form_submissions",
    "vendor_reported_leads",
    "source_system",
)

#: ``spend_amount`` is ``object`` because it holds :class:`~decimal.Decimal`. Storing it
#: as ``float64`` would reintroduce binary rounding into the one column where cents have
#: to be exact.
MARKETING_SPEND_DTYPES: Final[dict[str, str]] = {
    "marketing_spend_id": "string",
    "month_date_key": "int32",
    "dealership_id": "string",
    "campaign_id": "string",
    "lead_source_id": "string",
    "spend_amount": "object",
    "impressions": "int64",
    "clicks": "int64",
    "calls": "int32",
    "form_submissions": "int32",
    "vendor_reported_leads": "int32",
    "source_system": "string",
}

#: Every column of the spend source is ``NOT NULL``.
MARKETING_SPEND_REQUIRED_COLUMNS: Final[tuple[str, ...]] = MARKETING_SPEND_COLUMNS

#: The grain of the spend fact, asserted by ``DQ-MKT-001``.
MARKETING_SPEND_GRAIN_COLUMNS: Final[tuple[str, ...]] = (
    "month_date_key",
    "dealership_id",
    "campaign_id",
)

# ---------------------------------------------------------------------------------------
# Controlled vocabularies
# ---------------------------------------------------------------------------------------
CHANNEL_PAID_SEARCH: Final = "Paid Search"
CHANNEL_PAID_SOCIAL: Final = "Paid Social"
CHANNEL_THIRD_PARTY_LISTINGS: Final = "Third-Party Listings"
CHANNEL_DIRECT_MAIL: Final = "Direct Mail"
CHANNEL_RADIO: Final = "Radio"
CHANNEL_TELEVISION: Final = "Television"
CHANNEL_EMAIL: Final = "Email"

ALLOWED_CHANNELS: Final[tuple[str, ...]] = (
    CHANNEL_PAID_SEARCH,
    CHANNEL_PAID_SOCIAL,
    CHANNEL_THIRD_PARTY_LISTINGS,
    CHANNEL_DIRECT_MAIL,
    CHANNEL_RADIO,
    CHANNEL_TELEVISION,
    CHANNEL_EMAIL,
)

DEPARTMENT_SALES: Final = "Sales"
DEPARTMENT_SERVICE: Final = "Service"
DEPARTMENT_BOTH: Final = "Both"
ALLOWED_TARGET_DEPARTMENTS: Final[tuple[str, ...]] = (
    DEPARTMENT_SALES,
    DEPARTMENT_SERVICE,
    DEPARTMENT_BOTH,
)

VEHICLE_CATEGORY_NEW: Final = "New"
VEHICLE_CATEGORY_USED: Final = "Used"
VEHICLE_CATEGORY_BOTH: Final = "Both"
ALLOWED_TARGET_VEHICLE_CATEGORIES: Final[tuple[str, ...]] = (
    VEHICLE_CATEGORY_NEW,
    VEHICLE_CATEGORY_USED,
    VEHICLE_CATEGORY_BOTH,
)

#: The independent used-vehicle store. It stocks no new inventory, so a campaign whose
#: ``target_vehicle_category`` is ``New`` never spends there.
INDEPENDENT_USED_DEALERSHIP_ID: Final = "GSA-003"

#: Ordinal of the last calendar month, used when rolling a month cursor over a year end.
DECEMBER: Final = 12


# ---------------------------------------------------------------------------------------
# Reference data: channels, vendors, campaign themes
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class ChannelProfile:
    """Delivery economics of one campaign channel: generation inputs, never columns.

    Attributes:
        channel: One of :data:`ALLOWED_CHANNELS`.
        cost_per_thousand_impressions: Media cost of a thousand impressions, used to
            derive ``impressions`` from ``spend_amount``. For ``Direct Mail`` an
            "impression" is a delivered piece, which is why its rate is two orders of
            magnitude higher than a digital one.
        click_through_rate: Share of impressions that produce a click. Exactly ``0.0``
            for the offline channels, which have no click to report -- the fact stores
            ``0``, never NULL, so that additive measures need no NULL handling.
        call_share: Share of the vendor's reported leads the vendor attributes to inbound
            calls.
        form_share: Share of the vendor's reported leads the vendor attributes to form
            submissions. ``call_share + form_share`` is deliberately below ``1.0``: the
            remainder is chat, text and other events the vendor counts as leads but
            reports under neither heading.
        always_on_probability: Probability that a campaign on this channel runs for the
            whole reporting window rather than as a seasonal burst.
        campaign_share: Share of the campaign population that targets this channel's
            lead sources.
    """

    channel: str
    cost_per_thousand_impressions: Decimal
    click_through_rate: float
    call_share: float
    form_share: float
    always_on_probability: float
    campaign_share: float


#: Channel economics, keyed by channel name.
CHANNEL_PROFILES: Final[dict[str, ChannelProfile]] = {
    profile.channel: profile
    for profile in (
        ChannelProfile(
            channel=CHANNEL_PAID_SEARCH,
            cost_per_thousand_impressions=Decimal("22.00"),
            click_through_rate=0.042,
            call_share=0.22,
            form_share=0.62,
            always_on_probability=0.75,
            campaign_share=0.26,
        ),
        ChannelProfile(
            channel=CHANNEL_PAID_SOCIAL,
            cost_per_thousand_impressions=Decimal("11.00"),
            click_through_rate=0.011,
            call_share=0.19,
            form_share=0.58,
            always_on_probability=0.35,
            campaign_share=0.19,
        ),
        ChannelProfile(
            channel=CHANNEL_THIRD_PARTY_LISTINGS,
            cost_per_thousand_impressions=Decimal("17.00"),
            click_through_rate=0.019,
            call_share=0.28,
            form_share=0.66,
            always_on_probability=0.85,
            campaign_share=0.23,
        ),
        ChannelProfile(
            channel=CHANNEL_DIRECT_MAIL,
            cost_per_thousand_impressions=Decimal("520.00"),
            click_through_rate=0.0,
            call_share=0.68,
            form_share=0.16,
            always_on_probability=0.10,
            campaign_share=0.09,
        ),
        ChannelProfile(
            channel=CHANNEL_RADIO,
            cost_per_thousand_impressions=Decimal("14.00"),
            click_through_rate=0.0,
            call_share=0.82,
            form_share=0.06,
            always_on_probability=0.25,
            campaign_share=0.08,
        ),
        ChannelProfile(
            channel=CHANNEL_TELEVISION,
            cost_per_thousand_impressions=Decimal("27.00"),
            click_through_rate=0.0,
            call_share=0.74,
            form_share=0.10,
            always_on_probability=0.20,
            campaign_share=0.07,
        ),
        ChannelProfile(
            channel=CHANNEL_EMAIL,
            cost_per_thousand_impressions=Decimal("3.50"),
            click_through_rate=0.026,
            call_share=0.18,
            form_share=0.64,
            always_on_probability=0.30,
            campaign_share=0.08,
        ),
    )
}

#: Which channel each campaign-eligible lead source is bought through, and the share of
#: the campaign population that targets it. Only **paid** sources appear: a campaign
#: against an unpaid source would attach spend to a channel whose cost per lead is
#: undefined by rule.
CAMPAIGN_LEAD_SOURCE_CHANNELS: Final[dict[str, str]] = {
    "LDS-003": CHANNEL_EMAIL,
    "LDS-006": CHANNEL_PAID_SEARCH,
    "LDS-007": CHANNEL_PAID_SEARCH,
    "LDS-008": CHANNEL_PAID_SOCIAL,
    "LDS-009": CHANNEL_PAID_SOCIAL,
    "LDS-010": CHANNEL_THIRD_PARTY_LISTINGS,
    "LDS-011": CHANNEL_THIRD_PARTY_LISTINGS,
    "LDS-012": CHANNEL_RADIO,
    "LDS-013": CHANNEL_DIRECT_MAIL,
    "LDS-014": CHANNEL_TELEVISION,
}

#: Relative frequency with which a campaign targets each eligible lead source. Sums to 1.
CAMPAIGN_LEAD_SOURCE_WEIGHTS: Final[dict[str, float]] = {
    "LDS-003": 0.08,
    "LDS-006": 0.12,
    "LDS-007": 0.14,
    "LDS-008": 0.12,
    "LDS-009": 0.07,
    "LDS-010": 0.16,
    "LDS-011": 0.07,
    "LDS-012": 0.08,
    "LDS-013": 0.09,
    "LDS-014": 0.07,
}

#: Invented vendor names, by channel. **Every one is fictional.** They are built from the
#: fictional group's own New Hampshire geography so that a reader can see immediately that
#: they are placeholders rather than real media companies.
VENDOR_NAMES_BY_CHANNEL: Final[dict[str, tuple[str, ...]]] = {
    CHANNEL_PAID_SEARCH: ("Granite Ridge Digital", "Souhegan Media Partners"),
    CHANNEL_PAID_SOCIAL: ("Granite Ridge Digital", "Souhegan Media Partners"),
    CHANNEL_THIRD_PARTY_LISTINGS: ("Riverwalk Listings Network", "Kearsarge Auto Marketplace"),
    CHANNEL_DIRECT_MAIL: ("Sable Peak Direct Marketing",),
    CHANNEL_RADIO: ("Millyard Broadcast Sales", "North Bank Broadcast Group"),
    CHANNEL_TELEVISION: ("North Bank Broadcast Group",),
    CHANNEL_EMAIL: ("In-House Marketing Team",),
}

#: Campaign themes for sales-facing campaigns, chosen by the calendar quarter the campaign
#: starts in so that a "Winter Clearance" never starts in July.
SALES_THEMES_BY_QUARTER: Final[dict[int, tuple[str, ...]]] = {
    1: ("New Year Inventory Event", "Winter Trade-In Push", "Presidents Day Sales Drive"),
    2: ("Spring Sales Event", "Tax Season Trade-In Push", "Memorial Day Sales Drive"),
    3: ("Summer Clearance", "Model Year Close-Out", "Labor Day Sales Drive"),
    4: ("Certified Used Push", "Year-End Sales Event", "Holiday Sales Drive"),
}

#: Campaign themes for service-facing campaigns.
SERVICE_THEMES: Final[tuple[str, ...]] = (
    "Service Retention Drive",
    "Seasonal Maintenance Reminder",
    "Owner Loyalty Service Offer",
)

# ---------------------------------------------------------------------------------------
# Population shape
# ---------------------------------------------------------------------------------------
#: Number of campaigns per scale mode. Chosen so that the spend fact lands inside the
#: 500-2,000 row target at portfolio scale (``P1.5-01``); see STM-014 section 4.5.
CAMPAIGN_COUNT_BY_SCALE: Final[dict[str, int]] = {
    "test": 8,
    "development": 24,
    "portfolio": 60,
}

#: Share of group lead volume each store attracts. The two franchise stores are larger
#: than the independent used lot, so a flat third each would misstate every per-store
#: cost measure.
STORE_LEAD_SHARE: Final[dict[str, float]] = {
    "GSA-001": 0.42,
    "GSA-002": 0.35,
    "GSA-003": 0.23,
}

#: Probability that a given store participates in a campaign it is eligible for. Every
#: campaign ends up with at least one store.
STORE_PARTICIPATION_PROBABILITY: Final = 0.62

#: Multiplicative spread of campaign size, drawn once per campaign. Campaigns are not all
#: the same size; a flat budget across campaigns is a prohibited synthetic pattern.
CAMPAIGN_INTENSITY_RANGE: Final[tuple[float, float]] = (0.55, 1.60)

#: Month-to-month variation in delivered lead volume, drawn per spend row.
LEAD_VOLUME_VARIANCE_RANGE: Final[tuple[float, float]] = (0.80, 1.20)

#: Month-to-month variation in what a lead actually cost. Drawn **independently** of the
#: volume variance above, which is what keeps spend and lead volume correlated without
#: being a perfect function of one another. A perfect correlation would make every
#: cost-per-lead identical and the whole marketing analysis trivial.
SPEND_EFFICIENCY_RANGE: Final[tuple[float, float]] = (0.82, 1.24)

#: Variation applied to delivery counts (impressions, clicks) and to the vendor's split
#: of its own reported leads.
DELIVERY_VARIANCE_RANGE: Final[tuple[float, float]] = (0.88, 1.14)

#: Central inflation of ``vendor_reported_leads`` over the true underlying lead count.
#:
#: 1.28 means the vendor claims about 28% more leads than the CRM will record. The
#: assumption behind the number: a vendor counts each submission event, while the CRM
#: counts each unique contactable shopper. Duplicate submissions from one shopper,
#: form fills with unusable contact details, and very short inbound calls are all
#: commonly billed as leads and are not leads in the CRM. A 20-35% gap is the range
#: ``docs/research.md`` §4.10 describes for third-party and paid media reconciliation,
#: and 1.28 sits in the middle of it.
#:
#: **This is an assumption, not a measurement.** It is stated here, in STM-014 and in
#: DATA_DICTIONARY.md so that nobody mistakes the resulting gap for evidence about any
#: real vendor.
VENDOR_OVER_REPORT_FACTOR: Final = 1.28

#: Per-row spread around :data:`VENDOR_OVER_REPORT_FACTOR`. Its lower bound keeps the
#: product strictly above 1.0, so the over-reporting is **systematic** -- a vendor never
#: reports fewer leads than the CRM records -- rather than merely noisy in both
#: directions.
VENDOR_OVER_REPORT_SPREAD: Final[tuple[float, float]] = (0.90, 1.12)

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (reserved in the canonical DQ registry)
# ---------------------------------------------------------------------------------------
CHECK_CAMPAIGN_UNIQUE_ID: Final = "DQ-CMP-001"
CHECK_CAMPAIGN_SCHEMA_MATCHES: Final = "DQ-CMP-002"
CHECK_CAMPAIGN_DATE_ORDER: Final = "DQ-CMP-003"
CHECK_CAMPAIGN_LEAD_SOURCE_RESOLVES: Final = "DQ-CMP-004"
CHECK_CAMPAIGN_ENUMERATIONS_VALID: Final = "DQ-CMP-005"
CHECK_CAMPAIGN_NO_PROHIBITED_PII: Final = "DQ-CMP-006"

CAMPAIGN_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_CAMPAIGN_UNIQUE_ID,
    CHECK_CAMPAIGN_SCHEMA_MATCHES,
    CHECK_CAMPAIGN_DATE_ORDER,
    CHECK_CAMPAIGN_LEAD_SOURCE_RESOLVES,
    CHECK_CAMPAIGN_ENUMERATIONS_VALID,
    CHECK_CAMPAIGN_NO_PROHIBITED_PII,
)

CHECK_SPEND_UNIQUE_GRAIN: Final = "DQ-MKT-001"
CHECK_SPEND_SCHEMA_MATCHES: Final = "DQ-MKT-002"
CHECK_SPEND_MONTH_KEY_FIRST_OF_MONTH: Final = "DQ-MKT-003"
CHECK_SPEND_NO_NEGATIVE_AMOUNTS: Final = "DQ-MKT-004"
CHECK_SPEND_REFERENCES_RESOLVE: Final = "DQ-MKT-005"
CHECK_SPEND_VENDOR_LEADS_NON_NEGATIVE: Final = "DQ-MKT-006"
CHECK_SPEND_NO_PROHIBITED_PII: Final = "DQ-MKT-007"

MARKETING_SPEND_CHECK_IDS: Final[tuple[str, ...]] = (
    CHECK_SPEND_UNIQUE_GRAIN,
    CHECK_SPEND_SCHEMA_MATCHES,
    CHECK_SPEND_MONTH_KEY_FIRST_OF_MONTH,
    CHECK_SPEND_NO_NEGATIVE_AMOUNTS,
    CHECK_SPEND_REFERENCES_RESOLVE,
    CHECK_SPEND_VENDOR_LEADS_NON_NEGATIVE,
    CHECK_SPEND_NO_PROHIBITED_PII,
)

_WAREHOUSE_DIM_CAMPAIGN: Final = "warehouse.dim_marketing_campaign"
_WAREHOUSE_FACT_SPEND: Final = "warehouse.fact_marketing_spend"

# Registered at import time so the canonical register in :mod:`arpi.validation.registry`
# is complete whenever these generators are importable. ``layer`` is ``python`` because
# these checks are evaluated in Python against the generated frame; the warehouse's own
# CHECK constraints and the SQL data-quality views are separate evidence, registered
# under their own layer.
register_checks(
    (
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_UNIQUE_ID,
            check_name="dim_marketing_campaign.campaign_id is unique",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "campaign_id is the natural key the spend fact and the lead fact both "
                "resolve through. A duplicate would fan out the join and double every "
                "campaign's spend."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN,),
        ),
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_SCHEMA_MATCHES,
            check_name="dim_marketing_campaign matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "Column order is part of the contract: the raw loader maps positionally, "
                "and start_date and end_date are adjacent columns of the same type, which "
                "makes a silent swap entirely plausible."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN,),
        ),
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_DATE_ORDER,
            check_name="dim_marketing_campaign end_date is NULL or on or after start_date",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "A campaign that ends before it starts has a negative active window, so "
                "every month-overlap calculation built on it -- including which months "
                "receive spend -- is wrong."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN,),
        ),
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_LEAD_SOURCE_RESOLVES,
            check_name="dim_marketing_campaign.lead_source_id resolves to a governed source",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "A campaign pointing at a source that does not exist would drop out of "
                "every source-level profitability measure without any error being raised."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN, "warehouse.dim_lead_source"),
        ),
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_ENUMERATIONS_VALID,
            check_name="dim_marketing_campaign channel and targeting values are in domain",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "channel, target_department and target_vehicle_category are the slicers "
                "the marketing page groups by. An ungoverned value silently forms a "
                "category of its own on every visual."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN,),
        ),
        CheckDefinition(
            check_id=CHECK_CAMPAIGN_NO_PROHIBITED_PII,
            check_name="dim_marketing_campaign declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            description=(
                "The privacy tripwire in its per-entity form. campaign_name and "
                "vendor_name are allowlisted descriptive labels; any other name-shaped "
                "column fails the run, schema-only, even when empty."
            ),
            applies_to=(_WAREHOUSE_DIM_CAMPAIGN,),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_UNIQUE_GRAIN,
            check_name="fact_marketing_spend is unique on (month, dealership, campaign)",
            category=CHECK_CATEGORY_UNIQUENESS,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "The declared grain. A duplicated triple double-counts spend, which "
                "halves every return-on-advertising measure computed from it."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_SCHEMA_MATCHES,
            check_name="marketing spend matches its declared column contract",
            category=CHECK_CATEGORY_STRUCTURAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "Column order is part of the contract, and four of the twelve columns are "
                "interchangeable-looking counts, so a positional load would misfile them "
                "without failing."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_MONTH_KEY_FIRST_OF_MONTH,
            check_name="fact_marketing_spend.month_date_key is the first day of its month",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "A month-grain fact keyed on 20250731 instead of 20250701 joins to a "
                "single day of dim_date, so every monthly total silently lands in the "
                "wrong bucket -- or in none at all. This is the single most common way a "
                "month-grain fact goes wrong."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_NO_NEGATIVE_AMOUNTS,
            check_name="fact_marketing_spend carries no negative amount or count",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "Marketing spend is non-negative by rule (ARCHITECTURE.md section 21.2), "
                "as are impressions, clicks, calls and form submissions. A negative "
                "amount would net off real spend elsewhere in the same total."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_REFERENCES_RESOLVE,
            check_name="fact_marketing_spend campaign, dealership and lead source resolve",
            category=CHECK_CATEGORY_REFERENTIAL,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "Spend against a campaign, store or source that does not exist cannot be "
                "attributed to anything, so it disappears from every grouped total while "
                "still inflating the grand total."
            ),
            applies_to=(
                ENTITY_MARKETING_SPEND,
                _WAREHOUSE_FACT_SPEND,
                _WAREHOUSE_DIM_CAMPAIGN,
                "warehouse.dim_dealership",
                "warehouse.dim_lead_source",
            ),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_VENDOR_LEADS_NON_NEGATIVE,
            check_name="fact_marketing_spend.vendor_reported_leads is non-negative",
            category=CHECK_CATEGORY_BUSINESS_RULE,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "The vendor's claimed lead count is deliberately allowed to differ from "
                "the CRM count -- that gap is an intended finding -- but it can never be "
                "negative, and the divergence must never be implemented by subtracting "
                "one count from another."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
        CheckDefinition(
            check_id=CHECK_SPEND_NO_PROHIBITED_PII,
            check_name="marketing spend declares no prohibited personal-data column",
            category=CHECK_CATEGORY_PRIVACY,
            severity=CheckSeverity.CRITICAL,
            layer=CheckLayer.PYTHON,
            entity=ENTITY_MARKETING_SPEND,
            description=(
                "Marketing data is where audience and targeting attributes creep in. The "
                "tripwire inspects the schema, so a prohibited column fails the run even "
                "when it holds no values."
            ),
            applies_to=(ENTITY_MARKETING_SPEND, _WAREHOUSE_FACT_SPEND),
        ),
    )
)


# ---------------------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CampaignRecord:
    """One campaign: its dimension attributes plus the latents spend is drawn from.

    Attributes:
        campaign_id: Synthetic identifier, ``CMP-#####``.
        campaign_name: Fictional campaign label.
        channel: One of :data:`ALLOWED_CHANNELS`.
        vendor_name: Fictional vendor label.
        lead_source_id: The governed lead source this campaign buys, ``LDS-###``.
        start_date: First day the campaign is active.
        end_date: Last day the campaign is active, or ``None`` when it was still running
            when the reporting window closed.
        target_department: ``Sales``, ``Service`` or ``Both``.
        target_vehicle_category: ``New``, ``Used`` or ``Both``.
        dealership_ids: Stores that fund this campaign, in identifier order.
        source_share: This campaign's share of its lead source's volume, normalised to
            1.0 across all campaigns targeting the same source. **A latent, not a
            column.**
    """

    campaign_id: str
    campaign_name: str
    channel: str
    vendor_name: str
    lead_source_id: str
    start_date: date
    end_date: date | None
    target_department: str
    target_vehicle_category: str
    dealership_ids: tuple[str, ...]
    source_share: float

    def is_active_on(self, day: date) -> bool:
        """Report whether the campaign is running on a given day.

        Args:
            day: The calendar date to test.

        Returns:
            ``True`` when ``day`` falls inside ``[start_date, end_date]``; an open
            ``end_date`` means the campaign has not stopped.
        """
        if day < self.start_date:
            return False
        return self.end_date is None or day <= self.end_date


@dataclass(frozen=True, slots=True)
class CampaignMonthDemand:
    """The true underlying lead volume one campaign-month-store is expected to produce.

    This is the number ``vendor_reported_leads`` is inflated **from**, and the number the
    CRM lead generator (`P1.4-02`) draws its lead volume from. Exposing it is what makes
    the vendor-versus-CRM gap a real, reproducible difference between two entities rather
    than two unrelated random numbers that happen not to match.

    Attributes:
        campaign_id: The campaign, ``CMP-#####``.
        dealership_id: The store, ``GSA-00N``.
        month_start: First day of the calendar month.
        month_date_key: ``YYYYMMDD`` encoding of ``month_start``.
        lead_source_id: The campaign's governed lead source.
        true_lead_count: Leads the CRM is expected to record for this campaign-month.
        vendor_reported_leads: Leads the vendor claims, always at or above
            ``true_lead_count``.
    """

    campaign_id: str
    dealership_id: str
    month_start: date
    month_date_key: int
    lead_source_id: str
    true_lead_count: int
    vendor_reported_leads: int


# ---------------------------------------------------------------------------------------
# Calendar helpers
# ---------------------------------------------------------------------------------------
def month_start_key(month_start: date) -> int:
    """Encode the first day of a month as a ``YYYYMMDD`` integer date key.

    Args:
        month_start: A date that **must** be the first day of its month.

    Returns:
        The ``YYYYMMDD`` key, e.g. ``20250701`` for July 2025.

    Raises:
        GenerationError: If ``month_start`` is not the first day of its month. Failing
            loudly here is the point: a month-grain fact keyed on the last day of the
            month joins to one day of ``dim_date`` and silently misfiles every total.
    """
    if month_start.day != 1:
        raise GenerationError(
            f"month_date_key must encode the FIRST day of the month, got "
            f"{month_start.isoformat()}. A month-grain fact keyed on any other day joins "
            "to a single calendar day rather than to the month.",
            entity=ENTITY_MARKETING_SPEND,
            month_start=month_start.isoformat(),
        )
    return month_start.year * 10_000 + month_start.month * 100 + 1


def month_starts_between(start: date, end: date) -> tuple[date, ...]:
    """Return the first day of every calendar month overlapping ``[start, end]``.

    Args:
        start: First date of the window.
        end: Last date of the window, inclusive.

    Returns:
        Month start dates in ascending order. Empty when ``end`` precedes ``start``.
    """
    if end < start:
        return ()
    months: list[date] = []
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        months.append(cursor)
        cursor = _next_month(cursor)
    return tuple(months)


def month_end(month_start: date) -> date:
    """Return the last calendar day of the month ``month_start`` opens.

    Args:
        month_start: Any date inside the month.

    Returns:
        The month's final day.
    """
    _, days = calendar.monthrange(month_start.year, month_start.month)
    return date(month_start.year, month_start.month, days)


def active_fraction_of_month(
    campaign: CampaignRecord, month_start: date, window_end: date
) -> float:
    """Return the share of a month during which a campaign is active.

    A campaign that starts on the 15th funds roughly half of that month, which is what
    keeps the first and last month of a burst campaign from looking like a full month of
    spend.

    Args:
        campaign: The campaign being measured.
        month_start: First day of the calendar month.
        window_end: Last day of the reporting window; an open-ended campaign is treated
            as running to this date and no further.

    Returns:
        A value in ``[0.0, 1.0]``. Zero means the campaign was not running at all.
    """
    finish = month_end(month_start)
    campaign_end = campaign.end_date if campaign.end_date is not None else window_end
    first_active = max(month_start, campaign.start_date)
    last_active = min(finish, campaign_end)
    if last_active < first_active:
        return 0.0
    active_days = (last_active - first_active).days + 1
    return active_days / ((finish - month_start).days + 1)


def _next_month(month_start: date) -> date:
    """Return the first day of the month after ``month_start``."""
    if month_start.month == DECEMBER:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def _add_months(month_start: date, months: int) -> date:
    """Return the first day of the month ``months`` after ``month_start``."""
    cursor = month_start
    for _ in range(months):
        cursor = _next_month(cursor)
    return cursor


def _quantize_money(value: Decimal) -> Decimal:
    """Round a monetary amount to cents with ``ROUND_HALF_UP``."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------------------
# Campaign population
# ---------------------------------------------------------------------------------------
def campaign_count(config: ArpiConfig) -> int:
    """Return the number of campaigns for the active scale mode.

    Args:
        config: Resolved configuration.

    Returns:
        The count from :data:`CAMPAIGN_COUNT_BY_SCALE`.

    Raises:
        GenerationError: If the scale mode has no declared campaign count.
    """
    try:
        return CAMPAIGN_COUNT_BY_SCALE[config.generation.scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No campaign count is declared for scale mode "
            f"{config.generation.scale_mode!r}. Declared modes: "
            f"{', '.join(sorted(CAMPAIGN_COUNT_BY_SCALE))}.",
            entity=ENTITY_DIM_MARKETING_CAMPAIGN,
            scale_mode=config.generation.scale_mode,
        ) from error


def campaign_records(config: ArpiConfig) -> tuple[CampaignRecord, ...]:
    """Build the campaign population, in ``campaign_id`` order.

    This is the helper the lead generator calls to attach campaigns to leads. It carries
    the campaign's active window, its stores and its targeting, so a lead can be attached
    to a campaign that was actually running on the day the lead arrived -- and, where the
    lead generator chooses, to one running **outside** its target segment, which
    [ARCHITECTURE.md §15.3](../../../ARCHITECTURE.md) relationship 16 requires.

    Args:
        config: Resolved configuration supplying the seed, scale mode and window.

    Returns:
        Every campaign, ordered by ``campaign_id``.
    """
    rng = rng_for(config.random_seed, CAMPAIGN_NAMESPACE)
    window_start = config.reporting.start_date
    window_end = config.reporting.end_date
    months = month_starts_between(window_start, window_end)
    eligible_sources = tuple(CAMPAIGN_LEAD_SOURCE_WEIGHTS)
    weights = [CAMPAIGN_LEAD_SOURCE_WEIGHTS[source] for source in eligible_sources]

    drafts: list[tuple[CampaignRecord, float]] = []
    for ordinal in range(1, campaign_count(config) + 1):
        lead_source_id = rng.choices(eligible_sources, weights=weights, k=1)[0]
        channel = CAMPAIGN_LEAD_SOURCE_CHANNELS[lead_source_id]
        profile = CHANNEL_PROFILES[channel]
        start_date, end_date = _draw_campaign_window(rng, profile, months, window_start, window_end)
        department = _draw_target_department(rng, channel)
        vehicle_category = _draw_target_vehicle_category(rng, department)
        drafts.append(
            (
                CampaignRecord(
                    campaign_id=f"CMP-{ordinal:05d}",
                    campaign_name=_campaign_name(rng, start_date, channel, department),
                    channel=channel,
                    vendor_name=rng.choice(VENDOR_NAMES_BY_CHANNEL[channel]),
                    lead_source_id=lead_source_id,
                    start_date=start_date,
                    end_date=end_date,
                    target_department=department,
                    target_vehicle_category=vehicle_category,
                    dealership_ids=_draw_dealerships(rng, vehicle_category),
                    source_share=0.0,
                ),
                rng.uniform(*CAMPAIGN_INTENSITY_RANGE),
            )
        )
    return _normalise_source_shares(drafts)


def _normalise_source_shares(
    drafts: list[tuple[CampaignRecord, float]],
) -> tuple[CampaignRecord, ...]:
    """Scale each campaign's intensity into a share of its lead source's volume.

    Within one lead source the shares sum to 1.0, so the campaigns bought against a
    source divide that source's expected lead volume between them rather than each
    claiming all of it.
    """
    totals: dict[str, float] = {}
    for record, intensity in drafts:
        totals[record.lead_source_id] = totals.get(record.lead_source_id, 0.0) + intensity
    shared = [
        CampaignRecord(
            campaign_id=record.campaign_id,
            campaign_name=record.campaign_name,
            channel=record.channel,
            vendor_name=record.vendor_name,
            lead_source_id=record.lead_source_id,
            start_date=record.start_date,
            end_date=record.end_date,
            target_department=record.target_department,
            target_vehicle_category=record.target_vehicle_category,
            dealership_ids=record.dealership_ids,
            source_share=intensity / totals[record.lead_source_id],
        )
        for record, intensity in drafts
    ]
    return tuple(sorted(shared, key=lambda record: record.campaign_id))


def _draw_campaign_window(
    rng: random.Random,
    profile: ChannelProfile,
    months: tuple[date, ...],
    window_start: date,
    window_end: date,
) -> tuple[date, date | None]:
    """Place a campaign's active window inside the reporting window.

    Always-on campaigns are recorded as starting on the first day of the reporting
    window: ARPI holds no history before it, so an earlier start date would assert
    something the dataset cannot support. Burst campaigns start on the 1st, 8th or 15th
    of a month -- media buys are placed on period boundaries, not on arbitrary days --
    and run for one to four months.
    """
    if rng.random() < profile.always_on_probability:
        return window_start, None

    start_month = rng.choice(months)
    offset = rng.choices((0, 7, 14), weights=(0.6, 0.2, 0.2), k=1)[0]
    start_date = max(window_start, min(window_end, start_month + timedelta(days=offset)))
    duration_months = rng.choices((1, 2, 3, 4), weights=(0.30, 0.34, 0.22, 0.14), k=1)[0]
    finish = _add_months(date(start_date.year, start_date.month, 1), duration_months) - timedelta(
        days=1
    )
    if finish >= window_end:
        return start_date, None
    return start_date, finish


def _draw_target_department(rng: random.Random, channel: str) -> str:
    """Draw the department a campaign targets.

    Search and marketplace listings are shopper-intent channels, so they are never bought
    for the service drive; broadcast, mail and email are.
    """
    if channel in (CHANNEL_PAID_SEARCH, CHANNEL_THIRD_PARTY_LISTINGS):
        return rng.choices((DEPARTMENT_SALES, DEPARTMENT_BOTH), weights=(0.85, 0.15), k=1)[0]
    return rng.choices(
        (DEPARTMENT_SALES, DEPARTMENT_BOTH, DEPARTMENT_SERVICE),
        weights=(0.60, 0.22, 0.18),
        k=1,
    )[0]


def _draw_target_vehicle_category(rng: random.Random, department: str) -> str:
    """Draw the vehicle category a campaign targets.

    A service campaign is not bought against a vehicle category at all, so it is recorded
    as ``Both`` rather than as a NULL the contract does not allow.
    """
    if department == DEPARTMENT_SERVICE:
        return VEHICLE_CATEGORY_BOTH
    return rng.choices(
        (VEHICLE_CATEGORY_NEW, VEHICLE_CATEGORY_USED, VEHICLE_CATEGORY_BOTH),
        weights=(0.34, 0.40, 0.26),
        k=1,
    )[0]


def _draw_dealerships(rng: random.Random, vehicle_category: str) -> tuple[str, ...]:
    """Draw which stores fund a campaign.

    The independent used store stocks no new inventory, so it never funds a campaign
    targeting new vehicles. Every campaign ends up with at least one store: a campaign
    nobody paid for would produce no spend rows and would sit in the dimension as an
    orphan.
    """
    eligible = [
        store.dealership_id
        for store in sorted(STORE_DEFINITIONS, key=lambda item: item.dealership_id)
        if not (
            store.dealership_id == INDEPENDENT_USED_DEALERSHIP_ID
            and vehicle_category == VEHICLE_CATEGORY_NEW
        )
    ]
    chosen = [
        dealership_id
        for dealership_id in eligible
        if rng.random() < STORE_PARTICIPATION_PROBABILITY
    ]
    if not chosen:
        weights = [STORE_LEAD_SHARE[dealership_id] for dealership_id in eligible]
        chosen = [rng.choices(eligible, weights=weights, k=1)[0]]
    return tuple(chosen)


def _campaign_name(rng: random.Random, start_date: date, channel: str, department: str) -> str:
    """Compose a fictional campaign label from its season, year and channel."""
    if department == DEPARTMENT_SERVICE:
        theme = rng.choice(SERVICE_THEMES)
    else:
        quarter = (start_date.month - 1) // 3 + 1
        theme = rng.choice(SALES_THEMES_BY_QUARTER[quarter])
    return f"{theme} {start_date.year} - {channel}"


# ---------------------------------------------------------------------------------------
# Campaign generator
# ---------------------------------------------------------------------------------------
class MarketingCampaignGenerator(BaseGenerator):
    """Build the marketing campaign dimension."""

    entity_name = ENTITY_DIM_MARKETING_CAMPAIGN
    declared_columns = DIM_MARKETING_CAMPAIGN_COLUMNS
    namespace = CAMPAIGN_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the campaign frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 11 contract columns, in order, one row per campaign, with
            ``campaign_key`` assigned as a deterministic ordinal over ``campaign_id``.
        """
        records = [
            _build_campaign_row(ordinal, record)
            for ordinal, record in enumerate(campaign_records(config), start=1)
        ]
        frame = pd.DataFrame.from_records(records, columns=list(DIM_MARKETING_CAMPAIGN_COLUMNS))
        return frame.astype(DIM_MARKETING_CAMPAIGN_DTYPES)


def generate_marketing_campaign_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_marketing_campaign`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return MarketingCampaignGenerator().generate(config)


def _build_campaign_row(campaign_key: int, record: CampaignRecord) -> dict[str, Any]:
    """Render one campaign as a ``dim_marketing_campaign`` row."""
    return {
        "campaign_key": campaign_key,
        "campaign_id": record.campaign_id,
        "campaign_name": record.campaign_name,
        "channel": record.channel,
        "vendor_name": record.vendor_name,
        "lead_source_id": record.lead_source_id,
        "start_date": record.start_date,
        "end_date": record.end_date,
        "target_department": record.target_department,
        "target_vehicle_category": record.target_vehicle_category,
        "source_system": SOURCE_SYSTEM,
    }


# ---------------------------------------------------------------------------------------
# Marketing spend source
# ---------------------------------------------------------------------------------------
def monthly_group_lead_volume(config: ArpiConfig) -> float:
    """Return the whole group's expected lead volume for one month.

    Derived from the configured lead scale rather than invented separately, so that spend
    and lead volume are calibrated against each other instead of drifting apart.

    Args:
        config: Resolved configuration.

    Returns:
        Expected leads per calendar month across all three stores and every source.

    Raises:
        GenerationError: If the scale mode has no declared lead count.
    """
    try:
        total = TOTAL_LEAD_COUNT_BY_SCALE[config.generation.scale_mode]
    except KeyError as error:
        raise GenerationError(
            f"No lead count is declared for scale mode {config.generation.scale_mode!r}. "
            f"Declared modes: {', '.join(sorted(TOTAL_LEAD_COUNT_BY_SCALE))}.",
            entity=ENTITY_MARKETING_SPEND,
            scale_mode=config.generation.scale_mode,
        ) from error
    months = len(month_starts_between(config.reporting.start_date, config.reporting.end_date))
    return total / max(months, 1)


def campaign_month_demand(config: ArpiConfig) -> tuple[CampaignMonthDemand, ...]:
    """Return the true and vendor-reported lead volume for every campaign-month-store.

    **This is the bridge between this fact and the CRM lead fact.** The lead generator
    (`P1.4-02`) draws its campaign-attributed volume from ``true_lead_count``, while this
    fact publishes ``vendor_reported_leads``, which is that same number inflated by
    :data:`VENDOR_OVER_REPORT_FACTOR`. The resulting gap is therefore a reproducible
    property of the dataset rather than an accident of two unrelated draws.

    Args:
        config: Resolved configuration.

    Returns:
        One entry per generated spend row, in ``(month_date_key, dealership_id,
        campaign_id)`` order.
    """
    return tuple(row.demand for row in _build_spend_rows(config))


@dataclass(frozen=True, slots=True)
class _SpendRow:
    """Internal carrier: the emitted columns plus the demand behind them."""

    demand: CampaignMonthDemand
    spend_amount: Decimal
    impressions: int
    clicks: int
    calls: int
    form_submissions: int


def _build_spend_rows(config: ArpiConfig) -> tuple[_SpendRow, ...]:
    """Draw every spend row, ordered by the declared grain."""
    rng = rng_for(config.random_seed, MARKETING_SPEND_NAMESPACE)
    window_start = config.reporting.start_date
    window_end = config.reporting.end_date
    months = month_starts_between(window_start, window_end)
    monthly_volume = monthly_group_lead_volume(config)

    campaigns = campaign_records(config)
    rows: list[_SpendRow] = []
    for month_start in months:
        for campaign in campaigns:
            fraction = active_fraction_of_month(campaign, month_start, window_end)
            if fraction <= 0.0:
                continue
            behaviour = lead_source_behaviour(campaign.lead_source_id)
            profile = CHANNEL_PROFILES[campaign.channel]
            for dealership_id in campaign.dealership_ids:
                expected_leads = (
                    monthly_volume
                    * behaviour.volume_weight
                    * STORE_LEAD_SHARE[dealership_id]
                    * campaign.source_share
                    * fraction
                )
                rows.append(
                    _draw_spend_row(
                        rng,
                        campaign,
                        profile,
                        dealership_id,
                        month_start,
                        expected_leads,
                    )
                )
    rows.sort(
        key=lambda row: (
            row.demand.month_date_key,
            row.demand.dealership_id,
            row.demand.campaign_id,
        )
    )
    return tuple(rows)


def _draw_spend_row(
    rng: random.Random,
    campaign: CampaignRecord,
    profile: ChannelProfile,
    dealership_id: str,
    month_start: date,
    expected_leads: float,
) -> _SpendRow:
    """Draw one campaign-month-store row from its expected lead volume.

    Volume and cost are drawn from **two independent** variance ranges, so spend
    correlates with campaign activity without being a deterministic function of the lead
    count. Perfectly proportional spend would make every cost-per-lead identical and the
    marketing analysis vacuous.
    """
    behaviour = lead_source_behaviour(campaign.lead_source_id)
    true_leads = max(0, round(expected_leads * rng.uniform(*LEAD_VOLUME_VARIANCE_RANGE)))
    efficiency = rng.uniform(*SPEND_EFFICIENCY_RANGE)
    spend = _quantize_money(
        behaviour.cost_per_lead * Decimal(f"{max(expected_leads, 0.0) * efficiency:.6f}")
    )

    vendor_leads = round(
        true_leads * VENDOR_OVER_REPORT_FACTOR * rng.uniform(*VENDOR_OVER_REPORT_SPREAD)
    )
    impressions = _delivery_count(
        rng, float(spend) / float(profile.cost_per_thousand_impressions) * 1000.0
    )
    clicks = _delivery_count(rng, impressions * profile.click_through_rate)
    calls = min(_delivery_count(rng, vendor_leads * profile.call_share), vendor_leads)
    forms = min(_delivery_count(rng, vendor_leads * profile.form_share), vendor_leads - calls)

    return _SpendRow(
        demand=CampaignMonthDemand(
            campaign_id=campaign.campaign_id,
            dealership_id=dealership_id,
            month_start=month_start,
            month_date_key=month_start_key(month_start),
            lead_source_id=campaign.lead_source_id,
            true_lead_count=true_leads,
            vendor_reported_leads=vendor_leads,
        ),
        spend_amount=spend,
        impressions=impressions,
        clicks=clicks,
        calls=calls,
        form_submissions=forms,
    )


def _delivery_count(rng: random.Random, expected: float) -> int:
    """Round an expected delivery count to a non-negative integer, with variance."""
    if expected <= 0.0:
        return 0
    return max(0, round(expected * rng.uniform(*DELIVERY_VARIANCE_RANGE)))


class MarketingSpendGenerator(BaseGenerator):
    """Build the monthly marketing-spend source rows."""

    entity_name = ENTITY_MARKETING_SPEND
    declared_columns = MARKETING_SPEND_COLUMNS
    namespace = MARKETING_SPEND_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the marketing-spend frame.

        Args:
            config: Resolved configuration supplying the seed, scale mode and window.

        Returns:
            A frame with the 12 contract columns, in order, one row per dealership,
            campaign and calendar month, ordered by the declared grain with
            ``marketing_spend_id`` assigned as a deterministic ordinal over that order.
        """
        records = [
            _build_spend_record(ordinal, row)
            for ordinal, row in enumerate(_build_spend_rows(config), start=1)
        ]
        frame = pd.DataFrame.from_records(records, columns=list(MARKETING_SPEND_COLUMNS))
        return frame.astype(MARKETING_SPEND_DTYPES)


def generate_marketing_spend_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``marketing_spend_event`` dataset feeding ``fact_marketing_spend``.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return MarketingSpendGenerator().generate(config)


def _build_spend_record(ordinal: int, row: _SpendRow) -> dict[str, Any]:
    """Render one drawn row as a marketing-spend source record."""
    return {
        "marketing_spend_id": f"MKT-{ordinal:08d}",
        "month_date_key": row.demand.month_date_key,
        "dealership_id": row.demand.dealership_id,
        "campaign_id": row.demand.campaign_id,
        "lead_source_id": row.demand.lead_source_id,
        "spend_amount": row.spend_amount,
        "impressions": row.impressions,
        "clicks": row.clicks,
        "calls": row.calls,
        "form_submissions": row.form_submissions,
        "vendor_reported_leads": row.demand.vendor_reported_leads,
        "source_system": SOURCE_SYSTEM,
    }


# ---------------------------------------------------------------------------------------
# Data-quality suites
# ---------------------------------------------------------------------------------------
def validate_marketing_campaign_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-CMP-001`` through ``DQ-CMP-006`` against the campaign dimension.

    Args:
        dataset: The generated ``dim_marketing_campaign`` dataset.

    Returns:
        A report containing six results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            check_unique_column(
                frame,
                "campaign_id",
                check_id=CHECK_CAMPAIGN_UNIQUE_ID,
                check_name="dim_marketing_campaign.campaign_id is unique",
                target_object=ENTITY_DIM_MARKETING_CAMPAIGN,
            ),
            check_column_schema(
                frame,
                DIM_MARKETING_CAMPAIGN_COLUMNS,
                check_id=CHECK_CAMPAIGN_SCHEMA_MATCHES,
                check_name="dim_marketing_campaign matches its declared column contract",
                target_object=ENTITY_DIM_MARKETING_CAMPAIGN,
            ),
            _check_campaign_date_order(frame),
            _check_campaign_lead_source_resolves(frame),
            _check_campaign_enumerations(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_CAMPAIGN_NO_PROHIBITED_PII,
                check_name="dim_marketing_campaign declares no prohibited personal-data column",
                target_object=ENTITY_DIM_MARKETING_CAMPAIGN,
            ),
        )
    )


def _campaign_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by the campaign checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_DIM_MARKETING_CAMPAIGN,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_campaign_date_order(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CMP-003`` -- ``end_date`` is NULL or on or after ``start_date``."""
    base = _campaign_result(
        CHECK_CAMPAIGN_DATE_ORDER,
        "dim_marketing_campaign end_date is NULL or on or after start_date",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    ended = frame[frame["end_date"].notna()]
    offending = int((ended["end_date"] < ended["start_date"]).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} campaign(s) end before they start.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


def _check_campaign_lead_source_resolves(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CMP-004`` -- every ``lead_source_id`` names a governed source."""
    base = _campaign_result(
        CHECK_CAMPAIGN_LEAD_SOURCE_RESOLVES,
        "dim_marketing_campaign.lead_source_id resolves to a governed source",
        CHECK_CATEGORY_REFERENTIAL,
    )
    unknown = sorted(
        {
            str(value)
            for value in frame["lead_source_id"]
            if str(value) not in set(ALL_LEAD_SOURCE_IDS)
        }
    )
    if not unknown:
        return base
    return base.failed(
        f"Campaign(s) reference lead source(s) that do not exist: {', '.join(unknown)}.",
        observed_value=float(len(unknown)),
        failed_record_count=len(unknown),
    )


def _check_campaign_enumerations(frame: pd.DataFrame) -> CheckResult:
    """``DQ-CMP-005`` -- channel and both targeting columns are inside their domains."""
    base = _campaign_result(
        CHECK_CAMPAIGN_ENUMERATIONS_VALID,
        "dim_marketing_campaign channel and targeting values are in domain",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    domains = {
        "channel": ALLOWED_CHANNELS,
        "target_department": ALLOWED_TARGET_DEPARTMENTS,
        "target_vehicle_category": ALLOWED_TARGET_VEHICLE_CATEGORIES,
    }
    problems = {
        column: sorted({str(value) for value in frame[column] if str(value) not in allowed})
        for column, allowed in domains.items()
    }
    offending = {column: values for column, values in problems.items() if values}
    if not offending:
        return base
    detail = "; ".join(f"{column}: {', '.join(values)}" for column, values in offending.items())
    return base.failed(
        f"Value(s) outside the declared enumerations -- {detail}.",
        observed_value=float(sum(len(values) for values in offending.values())),
        failed_record_count=sum(len(values) for values in offending.values()),
    )


def validate_marketing_spend_dataset(
    dataset: GeneratedDataset, config: ArpiConfig
) -> ValidationReport:
    """Run ``DQ-MKT-001`` through ``DQ-MKT-007`` against the marketing-spend source.

    Args:
        dataset: The generated ``marketing_spend_event`` dataset.
        config: Resolved configuration, used to rebuild the campaign population the
            referential check resolves against.

    Returns:
        A report containing seven results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            _check_spend_grain(frame),
            check_column_schema(
                frame,
                MARKETING_SPEND_COLUMNS,
                check_id=CHECK_SPEND_SCHEMA_MATCHES,
                check_name="marketing spend matches its declared column contract",
                target_object=ENTITY_MARKETING_SPEND,
            ),
            _check_month_key_is_first_of_month(frame),
            _check_no_negative_amounts(frame),
            _check_spend_references_resolve(frame, config),
            _check_vendor_leads_non_negative(frame),
            check_no_prohibited_pii_columns(
                frame,
                check_id=CHECK_SPEND_NO_PROHIBITED_PII,
                check_name="marketing spend declares no prohibited personal-data column",
                target_object=ENTITY_MARKETING_SPEND,
            ),
        )
    )


def _spend_result(check_id: str, check_name: str, category: str) -> CheckResult:
    """Build the passing skeleton shared by the spend checks."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=ENTITY_MARKETING_SPEND,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=0.0,
        observed_value=0.0,
    )


def _check_spend_grain(frame: pd.DataFrame) -> CheckResult:
    """``DQ-MKT-001`` -- the declared grain is unique."""
    base = CheckResult(
        check_id=CHECK_SPEND_UNIQUE_GRAIN,
        check_name="fact_marketing_spend is unique on (month, dealership, campaign)",
        target_object=ENTITY_MARKETING_SPEND,
        severity=CheckSeverity.CRITICAL,
        check_category=CHECK_CATEGORY_UNIQUENESS,
        expected_value=float(frame.shape[0]),
        observed_value=float(frame.shape[0]),
    )
    duplicated = int(frame.duplicated(subset=list(MARKETING_SPEND_GRAIN_COLUMNS)).sum())
    if duplicated == 0:
        return base
    return base.failed(
        f"{duplicated} row(s) repeat the grain "
        f"({', '.join(MARKETING_SPEND_GRAIN_COLUMNS)}), which double-counts spend.",
        observed_value=float(frame.shape[0] - duplicated),
        failed_record_count=duplicated,
    )


def _check_month_key_is_first_of_month(frame: pd.DataFrame) -> CheckResult:
    """``DQ-MKT-003`` -- every ``month_date_key`` ends in ``01``."""
    base = _spend_result(
        CHECK_SPEND_MONTH_KEY_FIRST_OF_MONTH,
        "fact_marketing_spend.month_date_key is the first day of its month",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = sorted({int(value) for value in frame["month_date_key"] if int(value) % 100 != 1})
    if not offending:
        return base
    rendered = ", ".join(str(value) for value in offending[:5])
    return base.failed(
        f"{len(offending)} distinct month_date_key value(s) are not the first day of a "
        f"month: {rendered}. A month-grain fact must key on YYYYMM01.",
        observed_value=float(len(offending)),
        failed_record_count=len(offending),
    )


def _check_no_negative_amounts(frame: pd.DataFrame) -> CheckResult:
    """``DQ-MKT-004`` -- spend and every delivery count are non-negative."""
    base = _spend_result(
        CHECK_SPEND_NO_NEGATIVE_AMOUNTS,
        "fact_marketing_spend carries no negative amount or count",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    negative_spend = int(sum(1 for value in frame["spend_amount"] if Decimal(str(value)) < 0))
    counts = ("impressions", "clicks", "calls", "form_submissions")
    negative_counts = {
        column: int((frame[column] < 0).sum())
        for column in counts
        if int((frame[column] < 0).sum()) > 0
    }
    total = negative_spend + sum(negative_counts.values())
    if total == 0:
        return base
    detail = ", ".join(f"{column}={count}" for column, count in sorted(negative_counts.items()))
    return base.failed(
        f"{total} negative value(s) found: spend_amount={negative_spend}"
        + (f", {detail}" if detail else "")
        + ". Marketing spend and delivery counts are non-negative by rule.",
        observed_value=float(total),
        failed_record_count=total,
    )


def _check_spend_references_resolve(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """``DQ-MKT-005`` -- campaign, dealership and lead source all resolve."""
    base = _spend_result(
        CHECK_SPEND_REFERENCES_RESOLVE,
        "fact_marketing_spend campaign, dealership and lead source resolve",
        CHECK_CATEGORY_REFERENTIAL,
    )
    known_campaigns = {record.campaign_id for record in campaign_records(config)}
    known_dealerships = {store.dealership_id for store in STORE_DEFINITIONS}
    known_sources = set(ALL_LEAD_SOURCE_IDS)
    unresolved = {
        "campaign_id": sorted(
            {str(value) for value in frame["campaign_id"] if str(value) not in known_campaigns}
        ),
        "dealership_id": sorted(
            {str(value) for value in frame["dealership_id"] if str(value) not in known_dealerships}
        ),
        "lead_source_id": sorted(
            {str(value) for value in frame["lead_source_id"] if str(value) not in known_sources}
        ),
    }
    offending = {column: values for column, values in unresolved.items() if values}
    if not offending:
        return base
    detail = "; ".join(f"{column}: {', '.join(values)}" for column, values in offending.items())
    return base.failed(
        f"Spend rows reference object(s) that do not exist -- {detail}.",
        observed_value=float(sum(len(values) for values in offending.values())),
        failed_record_count=sum(len(values) for values in offending.values()),
    )


def _check_vendor_leads_non_negative(frame: pd.DataFrame) -> CheckResult:
    """``DQ-MKT-006`` -- the vendor's claimed lead count is never negative."""
    base = _spend_result(
        CHECK_SPEND_VENDOR_LEADS_NON_NEGATIVE,
        "fact_marketing_spend.vendor_reported_leads is non-negative",
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = int((frame["vendor_reported_leads"] < 0).sum())
    if offending == 0:
        return base
    return base.failed(
        f"{offending} row(s) report a negative vendor lead count. The vendor-versus-CRM "
        "gap is generated as an inflation, never as a subtraction.",
        observed_value=float(offending),
        failed_record_count=offending,
    )


# Re-exported so a caller can validate an enumeration without importing the checks module.
__all__ = [
    "ALLOWED_CHANNELS",
    "ALLOWED_TARGET_DEPARTMENTS",
    "ALLOWED_TARGET_VEHICLE_CATEGORIES",
    "CAMPAIGN_CHECK_IDS",
    "CAMPAIGN_COUNT_BY_SCALE",
    "DIM_MARKETING_CAMPAIGN_COLUMNS",
    "MARKETING_SPEND_CHECK_IDS",
    "MARKETING_SPEND_COLUMNS",
    "MARKETING_SPEND_GRAIN_COLUMNS",
    "VENDOR_NAMES_BY_CHANNEL",
    "VENDOR_OVER_REPORT_FACTOR",
    "CampaignMonthDemand",
    "CampaignRecord",
    "MarketingCampaignGenerator",
    "MarketingSpendGenerator",
    "active_fraction_of_month",
    "campaign_count",
    "campaign_month_demand",
    "campaign_records",
    "check_values_in_allowed_set",
    "generate_marketing_campaign_dataset",
    "generate_marketing_spend_dataset",
    "month_end",
    "month_start_key",
    "month_starts_between",
    "monthly_group_lead_volume",
    "validate_marketing_campaign_dataset",
    "validate_marketing_spend_dataset",
]
