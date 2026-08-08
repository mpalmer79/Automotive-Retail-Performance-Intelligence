"""Project-wide constants shared by generation, validation, ingestion and the CLI.

Everything in this module is a canonical value taken from the Phase 0 cross-agent
contract. Nothing here may be changed without also changing the SQL DDL, the data
dictionary and the committed sample data.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from types import MappingProxyType
from typing import Final

# ---------------------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------------------
#: Single source of truth for the package version; kept in step with ``pyproject.toml``.
ARPI_VERSION: Final = "0.1.0"

PROJECT_NAME: Final = "Automotive Retail Performance Intelligence"
SHORT_NAME: Final = "ARPI"
PACKAGE_NAME: Final = "arpi"
REPOSITORY_SLUG: Final = "Automotive-Retail-Performance-Intelligence"
AUTHOR_NAME: Final = "Michael Palmer"
FICTIONAL_DEALER_GROUP: Final = "Granite Auto Group"
SOURCE_SYSTEM: Final = "arpi_synthetic_generator"
GENERATOR_MODULE: Final = "arpi.generation"

SYNTHETIC_DATA_NOTICE: Final = (
    "SYNTHETIC DATA -- 100% machine generated. Granite Auto Group and every store, "
    "employee role and transaction referenced by this project are fictional. No real "
    "customer, employee, dealership or vendor data is present, and no record here "
    "describes a real person or a real business."
)

# ---------------------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------------------
ENV_PREFIX: Final = "ARPI_"
ENV_NESTED_DELIMITER: Final = "__"
ENV_PROFILE_VAR: Final = "ARPI_PROFILE"
ENV_PASSWORD_VAR: Final = "ARPI_DATABASE__PASSWORD"
ENV_PASSWORD_FALLBACK_VAR: Final = "PGPASSWORD"
DEFAULT_PROFILE: Final = "development"
SUPPORTED_PROFILES: Final[tuple[str, ...]] = ("development", "test", "portfolio")
DEFAULT_CONFIG_DIR_NAME: Final = "config"
REDACTED_PLACEHOLDER: Final = "***REDACTED***"
EXPECTED_STORE_COUNT: Final = 3
MAX_REPORTING_WINDOW_YEARS: Final = 40
ALLOWED_SSL_MODES: Final[tuple[str, ...]] = (
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "verify-full",
)
ALLOWED_LOG_LEVELS: Final[tuple[str, ...]] = (
    "DEBUG",
    "INFO",
    "WARNING",
    "ERROR",
    "CRITICAL",
)
ALLOWED_LOG_FORMATS: Final[tuple[str, ...]] = ("text", "json")

# ---------------------------------------------------------------------------------------
# Database object names
# ---------------------------------------------------------------------------------------
SCHEMA_RAW: Final = "raw"
SCHEMA_STAGING: Final = "staging"
SCHEMA_WAREHOUSE: Final = "warehouse"
SCHEMA_AUDIT: Final = "audit"
SCHEMA_REPORTING: Final = "reporting"

RAW_TABLE_CALENDAR_DATE: Final = "calendar_date_load"
RAW_TABLE_DEALERSHIP: Final = "dealership_load"
WAREHOUSE_TABLE_DIM_DATE: Final = "dim_date"
WAREHOUSE_TABLE_DIM_DEALERSHIP: Final = "dim_dealership"

AUDIT_TABLE_PIPELINE_RUN: Final = "pipeline_run"
AUDIT_TABLE_ROW_COUNT: Final = "pipeline_run_row_count"
AUDIT_TABLE_VALIDATION_RESULT: Final = "validation_result"
AUDIT_TABLE_RECONCILIATION_RESULT: Final = "reconciliation_result"
AUDIT_TABLE_REJECTED_RECORD: Final = "rejected_record"

AUDIT_LAYERS: Final[tuple[str, ...]] = ("source", "raw", "staging", "warehouse", "rejected")
PIPELINE_STATUSES: Final[tuple[str, ...]] = ("running", "succeeded", "failed", "aborted")

# ---------------------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------------------
ENTITY_DIM_DATE: Final = "dim_date"
ENTITY_DIM_DEALERSHIP: Final = "dim_dealership"
PIPELINE_NAME_FOUNDATION: Final = "phase0_foundation"

SENTINEL_EXPIRATION_DATE: Final = date(9999, 12, 31)

# ---------------------------------------------------------------------------------------
# Calendar vocabulary (hard-coded so output never depends on the process locale)
# ---------------------------------------------------------------------------------------
DAY_NAMES: Final[tuple[str, ...]] = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)
MONTH_NAMES: Final[tuple[str, ...]] = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# ---------------------------------------------------------------------------------------
# warehouse.dim_date column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_DATE_COLUMNS: Final[tuple[str, ...]] = (
    "date_key",
    "full_date",
    "day_of_month",
    "day_name",
    "day_of_week",
    "day_of_year",
    "week_of_year",
    "iso_year",
    "month_number",
    "month_name",
    "month_start_date",
    "month_end_date",
    "quarter_number",
    "quarter_name",
    "calendar_year",
    "fiscal_month",
    "fiscal_quarter",
    "fiscal_year",
    "is_weekend",
    "is_month_end",
    "is_quarter_end",
    "is_year_end",
    "is_holiday",
    "holiday_name",
    "is_closure_holiday",
    "is_selling_day",
)

DIM_DATE_DTYPES: Final[dict[str, str]] = {
    "date_key": "int32",
    "full_date": "datetime64[ns]",
    "day_of_month": "int16",
    "day_name": "string",
    "day_of_week": "int16",
    "day_of_year": "int16",
    "week_of_year": "int16",
    "iso_year": "int16",
    "month_number": "int16",
    "month_name": "string",
    "month_start_date": "datetime64[ns]",
    "month_end_date": "datetime64[ns]",
    "quarter_number": "int16",
    "quarter_name": "string",
    "calendar_year": "int16",
    "fiscal_month": "int16",
    "fiscal_quarter": "int16",
    "fiscal_year": "int16",
    "is_weekend": "bool",
    "is_month_end": "bool",
    "is_quarter_end": "bool",
    "is_year_end": "bool",
    "is_holiday": "bool",
    "holiday_name": "string",
    "is_closure_holiday": "bool",
    "is_selling_day": "bool",
}

#: Columns of ``dim_date`` that must never be NULL (every column except ``holiday_name``).
DIM_DATE_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in DIM_DATE_COLUMNS if column != "holiday_name"
)

# ---------------------------------------------------------------------------------------
# warehouse.dim_dealership column contract (exact names, exact order)
# ---------------------------------------------------------------------------------------
DIM_DEALERSHIP_COLUMNS: Final[tuple[str, ...]] = (
    "dealership_key",
    "dealership_id",
    "store_name",
    "store_short_name",
    "store_type",
    "franchise_brand",
    "city",
    "state_code",
    "market_region",
    "opened_date",
    "is_active",
    "effective_date",
    "expiration_date",
    "is_current",
    "attribute_hash",
    "source_system",
)

# ``expiration_date`` carries the 9999-12-31 open-ended sentinel, which overflows
# ``datetime64[ns]`` (max 2262-04-11). Second precision is used for every dealership
# date column so all three share one dtype and the sentinel round-trips exactly.
DIM_DEALERSHIP_DTYPES: Final[dict[str, str]] = {
    "dealership_key": "int32",
    "dealership_id": "string",
    "store_name": "string",
    "store_short_name": "string",
    "store_type": "string",
    "franchise_brand": "string",
    "city": "string",
    "state_code": "string",
    "market_region": "string",
    "opened_date": "datetime64[s]",
    "is_active": "bool",
    "effective_date": "datetime64[s]",
    "expiration_date": "datetime64[s]",
    "is_current": "bool",
    "attribute_hash": "string",
    "source_system": "string",
}

#: Columns of ``dim_dealership`` that must never be NULL (``franchise_brand`` is nullable).
DIM_DEALERSHIP_REQUIRED_COLUMNS: Final[tuple[str, ...]] = tuple(
    column for column in DIM_DEALERSHIP_COLUMNS if column != "franchise_brand"
)

#: SCD Type 2 tracked attributes -- columns 3..11 of the ``dim_dealership`` contract.
DEALERSHIP_HASH_COLUMNS: Final[tuple[str, ...]] = (
    "store_name",
    "store_short_name",
    "store_type",
    "franchise_brand",
    "city",
    "state_code",
    "market_region",
    "opened_date",
    "is_active",
)

STORE_TYPE_FRANCHISE: Final = "Franchise New and Used"
STORE_TYPE_INDEPENDENT: Final = "Independent Used"
ALLOWED_STORE_TYPES: Final[tuple[str, ...]] = (STORE_TYPE_FRANCHISE, STORE_TYPE_INDEPENDENT)

# ---------------------------------------------------------------------------------------
# CSV / manifest dialect
# ---------------------------------------------------------------------------------------
CSV_ENCODING: Final = "utf-8"
CSV_LINE_TERMINATOR: Final = "\n"
CSV_DELIMITER: Final = ","
CSV_QUOTE_CHAR: Final = '"'
CSV_NULL_REPRESENTATION: Final = ""
CSV_BOOLEAN_TRUE: Final = "true"
CSV_BOOLEAN_FALSE: Final = "false"
ISO_DATE_FORMAT: Final = "%Y-%m-%d"
MANIFEST_FILENAME: Final = "generation_manifest.json"
MANIFEST_TIMESTAMP_POLICY: Final = "omitted for deterministic output"
CSV_FILE_SUFFIX: Final = ".csv"

# ---------------------------------------------------------------------------------------
# Privacy: column names that must never appear in any generated dataset
# ---------------------------------------------------------------------------------------
# This section is the *vocabulary*; the matching rules that consume it live in
# ``arpi.validation.privacy``, which is the single public entry point for the tripwire.
# The vocabulary stays here so that ``arpi.constants`` remains the one module a reviewer
# has to read to see every value shared between generation, validation and SQL.
#
# Column names that are prohibited when matched **exactly** (after normalisation).
PROHIBITED_PII_FIELD_NAMES: Final[frozenset[str]] = frozenset(
    {
        "account_number",
        "address",
        "address_line_1",
        "address_line_2",
        "age",
        "bank_account",
        "birth_date",
        "birthdate",
        "compensation",
        "credit_card",
        "credit_card_number",
        "credit_report",
        "credit_score",
        "customer_name",
        "date_of_birth",
        "dob",
        "drivers_license",
        "driver_license",
        "email",
        "email_address",
        "employee_name",
        "first_name",
        "full_name",
        "given_name",
        "home_address",
        "ip_address",
        "last_name",
        "license_number",
        "mailing_address",
        "marital_status",
        "middle_name",
        "mobile_number",
        "name",
        "national_id",
        "national_origin",
        "passport_number",
        "pay_plan",
        "pay_rate",
        "phone",
        "phone_number",
        "postal_code",
        "routing_number",
        "salary",
        "sexual_orientation",
        "social_security",
        "social_security_number",
        "ssn",
        "street",
        "street_address",
        "surname",
        "tax_id",
        "veteran_status",
        "wage",
        "zip_code",
        # The F&I lane (DASH.6). ARPI models a finance-office INCOME AMOUNT and nothing
        # about how a rate produced it. Every name below is a lending or credit mechanic
        # the platform deliberately does not have, and a column carrying one would turn a
        # descriptive analytics model into something that looks like desking software.
        "adverse_action",
        "adverse_action_reason",
        "annual_percentage_rate",
        "apr",
        "approval_status",
        "buy_rate",
        "credit_application",
        "credit_tier",
        "debt_to_income",
        "down_payment_percent",
        "fico",
        "fico_score",
        "income",
        "loan_term",
        "loan_to_value",
        "money_factor",
        "monthly_payment",
        "payment_amount",
        "rate_markup",
        "rate_spread",
        "residual_value",
        "sell_rate",
        "stipulation",
        "stipulations",
    }
)

# Tokens prohibited *anywhere* inside a normalised column name.
#
# Exact-name matching alone is too weak to be a real tripwire: it accepts
# ``customer_email``, ``buyer_first_name`` and ``home_phone_number`` while rejecting only
# the bare forms. Every token below is one that no legitimate ARPI column can contain, so
# substring matching is safe. Deliberately absent are ambiguous words such as ``name``,
# which appears in wholly innocent columns like ``day_name`` and ``store_name`` and is
# handled by the suffix rule instead, and ``age``, which must not drag ``age_band`` down
# with it and is therefore handled by its own rule.
PROHIBITED_PII_SUBSTRINGS: Final[frozenset[str]] = frozenset(
    {
        # Direct identifiers and contact vectors
        "account_number",
        "address",
        "birthdate",
        "birth_date",
        "birth_day",
        "birth_year",
        "date_of_birth",
        "e_mail",
        "email",
        "fax_number",
        "mailing",
        "maiden",
        "phone",
        "surname",
        "street",
        "telephone",
        # Government and financial identifiers
        "bank_account",
        "card_number",
        "credit_card",
        "debit_card",
        "drivers_license",
        "driver_license",
        "licence_number",
        "license_number",
        "national_id",
        "passport",
        "payment_card",
        "routing_number",
        "social_security",
        "ssn",
        "tax_id",
        # Credit file and credit report
        "beacon_score",
        "credit_bureau",
        "credit_file",
        "credit_history",
        "credit_rating",
        "credit_report",
        "credit_score",
        # Compensation
        "commission",
        "compensation",
        "payroll",
        "pay_grade",
        "pay_plan",
        "payplan",
        "pay_rate",
        "salary",
        "wage",
        # Precise geography
        "geocode",
        "latitude",
        "longitude",
        "lat_lon",
        "postal_code",
        "postcode",
        "zip_code",
        "zipcode",
        # Protected characteristics
        "gender_identity",
        "marital_status",
        "national_origin",
        "sexual_orientation",
        "veteran_status",
        # Communication content
        "call_recording",
        "chat_log",
        "message_body",
        "message_content",
        "voicemail",
        # Lending and credit mechanics (DASH.6). Each token is one ARPI deliberately
        # does not model, and each is safe as a SUBSTRING because no legitimate ARPI
        # column can contain it. Deliberately absent are `rate` and `term`, which are
        # fragments of wholly innocent names -- `closing_rate_index`, `cancellation_rate`,
        # `contract_term_months` -- and are covered by the exact-name list instead.
        "adverse_action",
        "annual_percentage_rate",
        "buy_rate",
        "credit_application",
        "credit_decision",
        "credit_tier",
        "debt_to_income",
        "fico",
        "income",
        "interest_rate",
        "loan_to_value",
        "money_factor",
        "payment_amount",
        "payoff_quote",
        "rate_markup",
        "rate_spread",
        "sell_rate",
        "stipulation",
    }
)

# Tokens prohibited when they appear as a whole ``_``-separated word of a column name.
#
# These words are unsafe as substrings because they are fragments of innocent ones --
# ``race`` inside ``racecourse``, ``sex`` inside ``sexagenary``, ``note`` inside
# ``footnote`` -- but are unambiguous as complete words. Splitting on ``_`` gives the
# reach the substring rule cannot have without false positives, so ``customer_notes``
# and ``call_recording_url`` are caught while ``body_style`` and ``county`` are not.
PROHIBITED_PII_WORD_TOKENS: Final[frozenset[str]] = frozenset(
    {
        # Protected characteristics
        "ancestry",
        "citizenship",
        "disability",
        "disabled",
        "ethnic",
        "ethnicity",
        "gender",
        "nationality",
        "pregnancy",
        "race",
        "religion",
        "religious",
        "sex",
        "orientation",
        "veteran",
        "marital",
        # Direct identifiers
        "dob",
        "licence",
        "license",
        "mobile",
        "fax",
        "zip",
        "postal",
        # Financial
        "bonus",
        "cvv",
        "iban",
        # Communication content
        "comment",
        "comments",
        "memo",
        "note",
        "notes",
        "recording",
        "recordings",
        "remarks",
        "transcript",
        "transcripts",
        # Lending and credit mechanics (DASH.6) that are unsafe as substrings but
        # unambiguous as whole words. `apr` is a fragment of `april`; `payment` would
        # reject nothing today but must reject `monthly_payment` tomorrow; `fico` and
        # `stips` are trade shorthand a future generator might reach for.
        "apr",
        "approval",
        "buyrate",
        "declined",
        "payment",
        "sellrate",
        "stips",
    }
)

# Columns ending in ``name`` are treated as personal data unless they appear here.
#
# A person's name is prohibited; a descriptive label is not, and only an explicit
# allowlist can tell the two apart. Denying by default means a future generator that adds
# ``salesperson_name`` or ``customer_name`` fails the check without anyone having to
# remember to extend a blocklist first. Adding an entry here is a deliberate act that a
# reviewer will see in the diff -- which is why every entry must carry the written
# justification that appears as its value.
APPROVED_NAME_COLUMNS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "campaign_name": (
            "Fictional marketing campaign label, e.g. 'Spring Sales Event'. Names a "
            "campaign, never a person."
        ),
        "check_name": "Human-readable name of a data-quality check. Names a rule, never a person.",
        "day_name": "Calendar vocabulary from DAY_NAMES: Monday..Sunday.",
        "department_name": (
            "Governed dealership department label -- Sales or Finance on a target row, "
            "and one of the five ALLOWED_DEPARTMENTS on an employee row. Names an "
            "organisational unit, never a person, and carries no headcount or identity."
        ),
        "entity_name": "Warehouse entity such as dim_date. Names a table, never a person.",
        "finance_product_name": (
            "Fictional F&I product label such as 'Granite Shield Powertrain Plus'. Names "
            "a synthetic product of a fictional administrator, never a person, and never "
            "a real F&I product or program."
        ),
        "holiday_name": "Recognised holiday label such as 'Independence Day'.",
        "lender_name": (
            "Fictional lender label such as 'Granite Financial Services'. Names a "
            "SYNTHETIC INSTITUTION THAT DOES NOT EXIST, never a person and never a real "
            "financial institution. tests/unit/test_fi_privacy.py asserts no committed "
            "lender name resembles a real one."
        ),
        "product_name": (
            "Synonym of finance_product_name retained for the reporting boundary. Names a "
            "fictional product, never a person."
        ),
        "provider_name": (
            "Fictional F&I product administrator label such as 'Northbridge Protection "
            "Services'. Names a synthetic business that does not exist, never a person "
            "and never a real product administrator."
        ),
        "lead_source_name": (
            "Normalised, generic lead-source label such as 'Dealer Website'. Names a "
            "channel, never a person."
        ),
        "model_name": "Vehicle model label such as 'Equinox'. Names a product, never a person.",
        "month_name": "Calendar vocabulary from MONTH_NAMES: January..December.",
        "pipeline_name": "Logical pipeline such as phase0_foundation.",
        "profile_name": "ARPI configuration profile: development, test or portfolio.",
        "quarter_name": "Calendar vocabulary: Q1, Q2, Q3, Q4. Names a period, never a person.",
        "source_file_name": (
            "Ingestion lineage: the CSV a raw row was copied from, for example "
            "dim_vehicle.csv. Names a file, never a person, and exists only in the raw "
            "and staging layers -- it never reaches the reporting boundary."
        ),
        "store_name": (
            "Fictional dealership store name such as 'Granite Chevrolet of Nashua'. "
            "Names a business, never a person."
        ),
        "store_short_name": "Abbreviated fictional store name used on report headings.",
        "vendor_name": (
            "Fictional marketing vendor label. Names a business, never a person, and no "
            "real vendor is referenced."
        ),
    }
)

# ``age`` is a direct quasi-identifier; a *band* is the minimised form ARPI publishes.
# The rule therefore rejects any column carrying ``age`` as a word unless it is one of
# these explicitly banded spellings, so ``age_band`` passes and ``customer_age`` does not.
APPROVED_AGE_COLUMNS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "age_band": "Banded cohort (18-24, 25-34, ...) as declared for dim_customer.",
        "age_bracket": "Synonym of age_band retained for report-facing views.",
        "age_bucket": "Synonym of age_band retained for report-facing views.",
        "age_group": "Synonym of age_band retained for report-facing views.",
        "age_range": "Synonym of age_band retained for report-facing views.",
    }
)

# Columns whose ``age`` measures an ASSET, not a person.
#
# The rule above exists because a person's age is a direct quasi-identifier. Inventory
# age is not: it is how many days a vehicle has been in stock, and it is one of the
# central measures of the whole platform (`KPI-INV-003`, `KPI-INV-004`, `KPI-INV-005`,
# `KPI-INV-006`). Without this list the tripwire rejects every legitimate inventory-age
# column, which is a false positive the project would hit on every new aging measure.
#
# The distinction is deliberately drawn by an explicit allowlist rather than by weakening
# the word rule: ``customer_age`` and ``buyer_age`` must keep failing, and a new entry
# here is a visible act in a diff that a reviewer can challenge. Every entry names the
# asset it measures.
APPROVED_ASSET_AGE_COLUMNS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "age_bucket_sort_order": (
            "Sort key for the vehicle inventory age bucket, so the bucket orders by age "
            "rather than alphabetically. Describes a vehicle, never a person."
        ),
        "average_inventory_age": (
            "KPI-INV-003. Mean days a vehicle has been in stock. Describes a vehicle, "
            "never a person."
        ),
        "median_inventory_age": (
            "KPI-INV-004. Median days a vehicle has been in stock. Describes a vehicle, "
            "never a person."
        ),
        "aged_threshold_days": (
            "The inventory aging threshold in days, published so a finding can state it. "
            "Describes a project convention, never a person."
        ),
        "vehicle_age_days": (
            "Days a vehicle has been in stock, reserved for a future row-level column. "
            "Describes a vehicle, never a person."
        ),
        "snapshot_age_days": (
            "reporting.vw_vehicle_listing_current. Days between one observation and the "
            "store's newest capture, published so a stale observation cannot be read as a "
            "current one. Describes an OBSERVATION, never a person -- and deliberately "
            "not a vehicle either: it is not days in stock and not vehicle age."
        ),
        "latest_capture_age_days": (
            "KPI-LST-022, reporting.vw_vehicle_listing_summary. Days between a capture "
            "date and the store's newest capture. This is SNAPSHOT FRESHNESS. Describes "
            "an observation, never a person."
        ),
    }
)

# ---------------------------------------------------------------------------------------
# Data-quality check identifiers (shared verbatim between Python and SQL)
# ---------------------------------------------------------------------------------------
CHECK_DATE_UNIQUE_KEY: Final = "DQ-DATE-001"
CHECK_DATE_CONTIGUOUS_RANGE: Final = "DQ-DATE-002"
CHECK_DATE_KEY_MATCHES_FULL_DATE: Final = "DQ-DATE-003"
CHECK_DATE_NO_NULL_REQUIRED: Final = "DQ-DATE-004"
CHECK_DATE_SELLING_DAY_RATIO: Final = "DQ-DATE-005"

CHECK_DEALERSHIP_UNIQUE_KEY: Final = "DQ-DLR-001"
CHECK_DEALERSHIP_UNIQUE_ID_CURRENT: Final = "DQ-DLR-002"
CHECK_DEALERSHIP_STORE_COUNT: Final = "DQ-DLR-003"
CHECK_DEALERSHIP_NO_PROHIBITED_PII: Final = "DQ-DLR-004"
CHECK_DEALERSHIP_FRANCHISE_BRAND: Final = "DQ-DLR-005"

CHECK_GENERATION_SCHEMA_MATCHES: Final = "DQ-GEN-001"
CHECK_GENERATION_DETERMINISM_DIGEST: Final = "DQ-GEN-002"

# ---------------------------------------------------------------------------------------
# Canonical validation category vocabulary
# ---------------------------------------------------------------------------------------
# EXACTLY seven categories exist. This module is the authority: the SQL check views in
# sql/08_validation emit these strings verbatim, and audit.validation_result.check_category
# carries a CHECK constraint over exactly this set (sql/00_database/03_audit_tables.sql).
#
# ``reconciliation`` is deliberately NOT a category -- reconciliations are a different
# kind of evidence and live in audit.reconciliation_result.
CHECK_CATEGORY_STRUCTURAL: Final = "structural"
CHECK_CATEGORY_COMPLETENESS: Final = "completeness"
CHECK_CATEGORY_UNIQUENESS: Final = "uniqueness"
CHECK_CATEGORY_REFERENTIAL: Final = "referential"
CHECK_CATEGORY_BUSINESS_RULE: Final = "business_rule"
CHECK_CATEGORY_PRIVACY: Final = "privacy"
CHECK_CATEGORY_REPRODUCIBILITY: Final = "reproducibility"

#: The only values ``audit.validation_result.check_category`` may take.
CHECK_CATEGORIES: Final[frozenset[str]] = frozenset(
    {
        CHECK_CATEGORY_STRUCTURAL,
        CHECK_CATEGORY_COMPLETENESS,
        CHECK_CATEGORY_UNIQUENESS,
        CHECK_CATEGORY_REFERENTIAL,
        CHECK_CATEGORY_BUSINESS_RULE,
        CHECK_CATEGORY_PRIVACY,
        CHECK_CATEGORY_REPRODUCIBILITY,
    }
)

#: Spellings that earlier revisions emitted, and the canonical category each becomes.
#:
#: The database migration in ``sql/00_database/03_audit_tables.sql`` rewrites historical
#: rows using exactly this mapping before the CHECK constraint is added, so an existing
#: database can be brought up to the constrained vocabulary without losing audit history.
#: ``DQ-DLR-004`` is the one documented exception: it spelt its category ``schema`` but is
#: the privacy tripwire, so it becomes ``privacy`` rather than ``structural``.
RETIRED_CHECK_CATEGORIES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "schema": CHECK_CATEGORY_STRUCTURAL,
        "domain": CHECK_CATEGORY_BUSINESS_RULE,
        "determinism": CHECK_CATEGORY_REPRODUCIBILITY,
    }
)

RECONCILIATION_DIM_DATE_ROW_COUNT: Final = "RECON-DIM-DATE-ROWCOUNT"
RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT: Final = "RECON-DIM-DEALERSHIP-ROWCOUNT"

# ---------------------------------------------------------------------------------------
# The reporting surface
# ---------------------------------------------------------------------------------------
# These tuples are the contract between the SQL under ``sql/05_reporting`` and everything
# that consumes it: the reporting-layer completeness test, the reporter-role end-to-end
# test, the Gate 1 readiness test, and the semantic-model documentation under
# ``powerbi/model_documentation/``. A view added to the SQL tree and not added here is
# invisible to those checks, and a view named here and not built fails them -- which is
# the point. ARPI has no other list of what the reporting layer contains.

#: Dimension views. One per MVP dimension, each the star-schema table a semantic model
#: relates FROM. Every relationship is one-to-many, dimension to fact, single direction.
MVP_DIMENSION_VIEWS: Final[tuple[str, ...]] = (
    "vw_calendar",
    "vw_dealership",
    "vw_employee",
    "vw_customer",
    "vw_vehicle",
    "vw_vehicle_model",
    "vw_lead_source",
    "vw_marketing_campaign",
)

#: Fact views. One per MVP fact, each preserving its warehouse fact's grain exactly --
#: no aggregation and no filtering -- so a semantic model can recompute every measure,
#: including the medians, under any filter context.
MVP_FACT_VIEWS: Final[tuple[str, ...]] = (
    "vw_vehicle_sales",
    "vw_inventory_snapshots",
    "vw_leads",
    "vw_appointments",
    "vw_marketing_spend",
)

#: Governed analytical views. Each owns the SQL side of one or more KPIs at a declared
#: grain, publishing numerators and denominators as separate additive columns.
ANALYTICAL_VIEWS: Final[tuple[str, ...]] = (
    "vw_sales_summary",
    "vw_gross_summary",
    "vw_inventory_health",
    "vw_inventory_aging",
    "vw_days_to_sale",
    "vw_inventory_turn",
    "vw_days_supply",
    "vw_lead_funnel",
    "vw_appointment_funnel",
    "vw_lead_response",
    "vw_marketing_performance",
    "vw_data_quality_trend",
    "vw_reconciliation_status",
)

#: Operational views that predate the MVP reporting layer and remain part of it.
OPERATIONAL_REPORTING_VIEWS: Final[tuple[str, ...]] = (
    "vw_pipeline_run_summary",
    "vw_data_quality_summary",
)

#: The MVP reporting surface: the twenty-eight views the semantic model may read.
#:
#: This tuple is what ``powerbi/validation/sql_baseline_metadata.json`` describes, what
#: the semantic-model documentation binds to, and what the portfolio's "reporting views"
#: count means. It is held separate from :data:`REPORTING_VIEWS` for exactly that reason:
#: the Inventory Operations views below are real reporting views in the same schema, and
#: folding them in would silently change a number that was measured against a specific
#: baseline run.
MVP_REPORTING_VIEWS: Final[tuple[str, ...]] = tuple(
    sorted(
        {
            *MVP_DIMENSION_VIEWS,
            *MVP_FACT_VIEWS,
            *ANALYTICAL_VIEWS,
            *OPERATIONAL_REPORTING_VIEWS,
        }
    )
)

#: The ARPI Inventory Operations views, over the sanitized public listing lane (ADR-0011).
#:
#: Separate from the MVP surface on purpose. These read
#: ``warehouse.fact_vehicle_listing_snapshot`` and ``warehouse.dim_observed_vehicle``,
#: which are populated by a workbook import rather than by a pipeline run, and they are
#: NOT part of the current semantic model -- that model is awaiting real-engine validation
#: and adding tables to it would change the validation target. See section 14 of the
#: Inventory Operations increment and ``docs/requirements/PHASE_2_BACKLOG.md``.
INVENTORY_LISTING_VIEWS: Final[tuple[str, ...]] = (
    "vw_vehicle_listing_current",
    "vw_vehicle_listing_summary",
    "vw_vehicle_listing_model_mix",
    "vw_vehicle_listing_price_completeness",
    "vw_vehicle_listing_observation_span",
    "vw_vehicle_listing_change",
)

#: The dashboard-program views, added by the Dealer Operations Command Center increments.
#:
#: Held separate from :data:`MVP_REPORTING_VIEWS` for the same reason
#: :data:`INVENTORY_LISTING_VIEWS` is: that tuple is what
#: ``powerbi/validation/sql_baseline_metadata.json`` describes and what the semantic
#: model binds to, and folding new views into it would silently change a number measured
#: against a specific baseline run -- while the semantic model, which is awaiting
#: real-engine validation, gained nothing.
#:
#: These views read the same warehouse facts as the MVP surface and add no new fact.
#: They exist because the console needs volume and gross on one row with their condition
#: components (``vw_sales_gross_trend``), a decomposition of gross change whose
#: arithmetic order is fixed in SQL rather than in TypeScript
#: (``vw_gross_change_bridge``), and a public-safe deal-grain projection
#: (``vw_deal_explorer``). ADR-0013 condition 2 is what makes them views rather than
#: console code.
#: ``DASH.6`` adds the four F&I views. They are database-and-reporting only: no browser
#: dataset is exported for them and no console route reads them, because ``DASH.7`` owns
#: the F&I presentation surface. Leaving them here rather than in
#: :data:`MVP_REPORTING_VIEWS` keeps the 28-view MVP baseline exactly where it was.
DASHBOARD_PROGRAM_VIEWS: Final[tuple[str, ...]] = (
    "vw_sales_gross_trend",
    "vw_gross_change_bridge",
    "vw_deal_explorer",
    "vw_deal_jacket",
    "vw_target_attainment",
    "vw_deal_product_detail",
    "vw_fi_summary",
    "vw_fi_product_penetration",
    "vw_fi_adjustment_summary",
)

#: The inventory accounting and GL control views, added by DASH.8.
#:
#: Held separate from :data:`MVP_REPORTING_VIEWS` and from :data:`DASHBOARD_PROGRAM_VIEWS`
#: for two different reasons. The MVP tuple is the 28-view baseline
#: ``powerbi/validation/sql_baseline_metadata.json`` describes and the semantic model binds
#: to; folding these in would silently restate a number measured against a specific
#: baseline run. The dashboard-program tuple is the set of views the console program
#: added, and these are not console views at all: DASH.8 exports NO browser dataset, adds
#: no route, and leaves ``src/arpi/dashboard/contract.py`` untouched. They are a
#: database-and-reporting increment answering SQ-43.
#:
#: They read two new facts of their own -- ``fact_inventory_accounting_snapshot`` and
#: ``fact_gl_control_balance`` -- plus the existing sale and F&I facts, which they only
#: ever read.
ACCOUNTING_REPORTING_VIEWS: Final[tuple[str, ...]] = (
    "vw_inventory_accounting",
    "vw_inventory_gl_reconciliation",
    "vw_accounting_exceptions",
)

#: Every SQL script the inventory accounting and GL control lane owns (DASH.8).
#:
#: Declared here for the same reason ``INVENTORY_LANE_SQL_FILES`` is declared in
#: ``arpi.inventory.spec`` and ``DASHBOARD_LANE_SQL_FILES`` in ``arpi.dashboard.contract``:
#: ``scripts/project_capabilities.py`` derives "five MVP facts", "eight conformed
#: dimensions" and "twenty-eight reporting views" by counting scripts in
#: ``sql/03_dimensions``, ``sql/04_facts`` and ``sql/05_reporting``, and those numbers were
#: measured against a specific baseline run. Adding two facts, one dimension and three
#: views beside them must not move a baseline; subtracting this lane is what keeps the
#: figures describing what they were measured against, while the lane is counted and
#: reported separately rather than hidden.
#:
#: It is declared in ``arpi.constants`` rather than in ``arpi.dashboard.contract`` on
#: purpose. DASH.8 adds no browser dataset, no console route and no export contract, so
#: the dashboard contract module is deliberately untouched by this increment.
ACCOUNTING_LANE_SQL_FILES: Final[tuple[str, ...]] = (
    "01_raw/20_raw_inventory_accounting_load.sql",
    "01_raw/21_raw_gl_account_load.sql",
    "01_raw/22_raw_gl_control_balance_load.sql",
    "02_staging/21_stg_inventory_accounting.sql",
    "02_staging/22_stg_gl_account.sql",
    "02_staging/23_stg_gl_control_balance.sql",
    "03_dimensions/24_dim_gl_account.sql",
    "03_dimensions/25_dim_gl_account_merge.sql",
    "04_facts/09_fact_inventory_accounting_snapshot.sql",
    "04_facts/10_fact_gl_control_balance.sql",
    "04_facts/19_fact_inventory_accounting_snapshot_load.sql",
    "04_facts/20_fact_gl_control_balance_load.sql",
    "05_reporting/49_vw_inventory_accounting.sql",
    "05_reporting/50_vw_inventory_gl_reconciliation.sql",
    "05_reporting/51_vw_accounting_exceptions.sql",
    "06_indexes/04_accounting_indexes.sql",
    "08_validation/15_recon_accounting.sql",
)

#: Every view the ``reporting`` schema is expected to contain, and nothing else.
REPORTING_VIEWS: Final[tuple[str, ...]] = tuple(
    sorted(
        {
            *MVP_REPORTING_VIEWS,
            *INVENTORY_LISTING_VIEWS,
            *DASHBOARD_PROGRAM_VIEWS,
            *ACCOUNTING_REPORTING_VIEWS,
        }
    )
)

# ---------------------------------------------------------------------------------------
# KPI identifiers and their reporting owners
# ---------------------------------------------------------------------------------------
#: Every MVP KPI identifier, in KPI_CATALOG.md order.
#:
#: The catalogue is the specification; this tuple is the machine-readable index of it, so
#: a test can assert that all 29 are computable without parsing Markdown. Adding a KPI
#: requires a new permanent identifier in both places.
KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-SLS-001",
    "KPI-SLS-002",
    "KPI-SLS-003",
    "KPI-GRS-001",
    "KPI-GRS-002",
    "KPI-GRS-003",
    "KPI-GRS-004",
    "KPI-GRS-005",
    "KPI-GRS-006",
    "KPI-INV-001",
    "KPI-INV-002",
    "KPI-INV-003",
    "KPI-INV-004",
    "KPI-INV-005",
    "KPI-INV-006",
    "KPI-INV-007",
    "KPI-INV-008",
    "KPI-INV-009",
    "KPI-FUN-001",
    "KPI-FUN-002",
    "KPI-FUN-003",
    "KPI-FUN-004",
    "KPI-FUN-005",
    "KPI-FUN-006",
    "KPI-FUN-007",
    "KPI-FUN-008",
    "KPI-MKT-001",
    "KPI-MKT-002",
    "KPI-MKT-003",
)

#: The reporting views each KPI can be computed from.
#:
#: The first entry of each tuple is the governed SQL owner named in KPI_CATALOG.md; the
#: rest are the row-grain fact views a semantic model should bind to instead, because a
#: row-grain fact recomputes a ratio or an order statistic under any filter context while
#: an aggregate cannot.
KPI_VIEW_OWNERSHIP: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "KPI-SLS-001": ("vw_sales_summary", "vw_vehicle_sales"),
        "KPI-SLS-002": ("vw_sales_summary", "vw_vehicle_sales"),
        "KPI-SLS-003": ("vw_sales_summary", "vw_vehicle_sales"),
        "KPI-GRS-001": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-GRS-002": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-GRS-003": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-GRS-004": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-GRS-005": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-GRS-006": ("vw_gross_summary", "vw_vehicle_sales"),
        "KPI-INV-001": ("vw_inventory_health", "vw_inventory_snapshots"),
        "KPI-INV-002": ("vw_inventory_health", "vw_inventory_snapshots"),
        "KPI-INV-003": ("vw_inventory_health", "vw_inventory_snapshots"),
        "KPI-INV-004": ("vw_inventory_health", "vw_inventory_aging", "vw_inventory_snapshots"),
        "KPI-INV-005": ("vw_inventory_health", "vw_inventory_snapshots"),
        "KPI-INV-006": ("vw_inventory_health", "vw_inventory_snapshots"),
        "KPI-INV-007": ("vw_days_to_sale", "vw_sales_summary", "vw_vehicle_sales"),
        "KPI-INV-008": ("vw_inventory_turn",),
        "KPI-INV-009": ("vw_days_supply",),
        "KPI-FUN-001": ("vw_lead_funnel", "vw_leads"),
        "KPI-FUN-002": ("vw_lead_funnel", "vw_leads"),
        "KPI-FUN-003": ("vw_lead_funnel", "vw_leads"),
        "KPI-FUN-004": ("vw_appointment_funnel", "vw_appointments"),
        "KPI-FUN-005": ("vw_appointment_funnel", "vw_appointments"),
        "KPI-FUN-006": ("vw_lead_funnel", "vw_leads"),
        "KPI-FUN-007": ("vw_lead_response", "vw_leads"),
        "KPI-FUN-008": ("vw_lead_response", "vw_leads"),
        "KPI-MKT-001": ("vw_marketing_performance",),
        "KPI-MKT-002": ("vw_marketing_performance",),
        "KPI-MKT-003": ("vw_marketing_performance",),
    }
)

# ---------------------------------------------------------------------------------------
# The Inventory Listings KPI domain (ADR-0011)
# ---------------------------------------------------------------------------------------
#: Every governed KPI over the sanitized public listing lane, in KPI_CATALOG.md order.
#:
#: HELD SEPARATE FROM :data:`KPI_IDS` ON PURPOSE. ``KPI_IDS`` is the MVP set the semantic
#: model implements as DAX measures, and ``powerbi/validation/model_expectations.json``
#: asserts its size against the measures that actually exist. These KPIs are governed and
#: documented but are NOT semantic-model measures: the current model is awaiting
#: real-engine validation, and adding measures before that validation would change what is
#: being validated. Counting them in ``KPI_IDS`` would make the model's own expectation
#: file wrong the moment this tuple grew.
#:
#: WHAT IS DELIBERATELY ABSENT, AND WHY IT MUST STAY ABSENT
#: -------------------------------------------------------
#: There is no sold-units KPI, no inventory turn, no days in stock, no gross, no inventory
#: investment, no acquisition or reconditioning cost, no carrying cost, no ROI and no
#: marketing attribution. Each of those needs data a public listing snapshot does not
#: carry, and a KPI defined over data that does not exist is a number somebody will
#: eventually quote.
INVENTORY_LISTING_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-LST-001",  # Observed listing units
    "KPI-LST-002",  # New listing units
    "KPI-LST-003",  # Used listing units
    "KPI-LST-004",  # Vehicles with listed price
    "KPI-LST-005",  # Call-for-price units
    "KPI-LST-006",  # Pricing completeness percentage
    "KPI-LST-007",  # Total advertised listing value
    "KPI-LST-008",  # Average advertised price
    "KPI-LST-009",  # Average advertised price by model
    "KPI-LST-010",  # Minimum advertised price
    "KPI-LST-011",  # Maximum advertised price
    "KPI-LST-012",  # Model mix percentage
    "KPI-LST-013",  # Trim mix percentage
    "KPI-LST-014",  # New listings since prior snapshot
    "KPI-LST-015",  # Removed listings since prior snapshot
    "KPI-LST-016",  # Price reductions since prior snapshot
    "KPI-LST-017",  # Price increases since prior snapshot
    "KPI-LST-018",  # Average price change
    "KPI-LST-019",  # First observed date
    "KPI-LST-020",  # Last observed date
    "KPI-LST-021",  # Days observed online
    "KPI-LST-022",  # Snapshot freshness
    "KPI-LST-023",  # Price-not-exposed units
    "KPI-LST-024",  # Unpriced listing units
)

#: The reporting view each Inventory Listings KPI is computed from.
INVENTORY_LISTING_KPI_VIEW_OWNERSHIP: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "KPI-LST-001": ("vw_vehicle_listing_summary", "vw_vehicle_listing_current"),
        "KPI-LST-002": ("vw_vehicle_listing_summary", "vw_vehicle_listing_current"),
        "KPI-LST-003": ("vw_vehicle_listing_summary", "vw_vehicle_listing_current"),
        "KPI-LST-004": ("vw_vehicle_listing_summary", "vw_vehicle_listing_price_completeness"),
        "KPI-LST-005": ("vw_vehicle_listing_summary", "vw_vehicle_listing_price_completeness"),
        "KPI-LST-006": ("vw_vehicle_listing_price_completeness", "vw_vehicle_listing_summary"),
        "KPI-LST-007": ("vw_vehicle_listing_summary",),
        "KPI-LST-008": ("vw_vehicle_listing_summary",),
        "KPI-LST-009": ("vw_vehicle_listing_model_mix",),
        "KPI-LST-010": ("vw_vehicle_listing_model_mix", "vw_vehicle_listing_summary"),
        "KPI-LST-011": ("vw_vehicle_listing_model_mix", "vw_vehicle_listing_summary"),
        "KPI-LST-012": ("vw_vehicle_listing_model_mix",),
        "KPI-LST-013": ("vw_vehicle_listing_model_mix",),
        "KPI-LST-014": ("vw_vehicle_listing_change",),
        "KPI-LST-015": ("vw_vehicle_listing_change",),
        "KPI-LST-016": ("vw_vehicle_listing_change",),
        "KPI-LST-017": ("vw_vehicle_listing_change",),
        "KPI-LST-018": ("vw_vehicle_listing_change",),
        "KPI-LST-019": ("vw_vehicle_listing_observation_span",),
        "KPI-LST-020": ("vw_vehicle_listing_observation_span",),
        "KPI-LST-021": ("vw_vehicle_listing_observation_span",),
        "KPI-LST-022": ("vw_vehicle_listing_summary", "vw_vehicle_listing_current"),
        "KPI-LST-023": (
            "vw_vehicle_listing_summary",
            "vw_vehicle_listing_price_completeness",
            "vw_vehicle_listing_model_mix",
        ),
        "KPI-LST-024": (
            "vw_vehicle_listing_summary",
            "vw_vehicle_listing_price_completeness",
            "vw_vehicle_listing_model_mix",
        ),
    }
)

#: Measures that must NEVER be defined over the sanitized listing lane, because the source
#: cannot supply them. Asserted by ``tests/unit/test_inventory_kpis.py`` against the
#: catalogue's Inventory Listings section, so a future edit cannot quietly add one.
PROHIBITED_LISTING_MEASURES: Final[tuple[str, ...]] = (
    "sold units",
    "units sold",
    "inventory turn",
    "days in stock",
    "front gross",
    "back gross",
    "total gross",
    "inventory investment",
    "acquisition cost",
    "reconditioning cost",
    "carrying cost",
    "floor plan",
    "return on investment",
    "marketing attribution",
)

# ---------------------------------------------------------------------------------------
# The Targets and pace domain (delivery increment DASH.5)
# ---------------------------------------------------------------------------------------
#: The governed target-scope vocabulary of ``warehouse.fact_sales_target``.
#:
#: Permanent on assignment. ``Store`` and ``Department`` are populated by the generator;
#: ``Employee`` is physically supported by the fact -- nullable ``employee_key``, CHECK-
#: coupled to the scope type, foreign key to ``warehouse.dim_employee`` -- and is
#: deliberately not populated by ``DASH.5``. See ``docs/source-to-target/
#: STM-016-fact-sales-target.md`` section 6 for the recorded decision.
TARGET_SCOPE_STORE: Final = "Store"
TARGET_SCOPE_DEPARTMENT: Final = "Department"
TARGET_SCOPE_EMPLOYEE: Final = "Employee"

TARGET_SCOPE_TYPES: Final[tuple[str, ...]] = (
    TARGET_SCOPE_STORE,
    TARGET_SCOPE_DEPARTMENT,
    TARGET_SCOPE_EMPLOYEE,
)

#: The departments the target domain supports, and the gross component each one owns.
#:
#: WHY ONLY TWO OF THE FIVE. ``dim_employee.department`` carries five values, but a
#: department target needs a department ACTUAL, and the actual must be attributable
#: without double counting. ``warehouse.fact_vehicle_sale`` enforces
#: ``total_gross = front_end_gross + back_end_gross``, so front and back are an exact
#: partition of the store's total gross: the Sales department owns the front end
#: (``KPI-GRS-001``) and the Finance department owns the back end (``KPI-GRS-002``), and
#: the two together are the store total with no overlap and no gap. BDC, Management and
#: Service own no component of that identity -- BDC is measured in the lead funnel,
#: Management is accountable for the store line rather than a separate one, and Service
#: has no fact at all (``warehouse.fact_service_visit`` is Deferred). A target for any of
#: them would have no denominator, so none is permitted.
TARGET_DEPARTMENT_METRIC: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Sales": "KPI-GRS-001",
        "Finance": "KPI-GRS-002",
    }
)

TARGET_DEPARTMENTS: Final[tuple[str, ...]] = tuple(sorted(TARGET_DEPARTMENT_METRIC))

#: The metrics ``fact_sales_target.kpi_id`` may name.
#:
#: This is the metric BEING TARGETED, never the target KPI itself. A row that plans the
#: month's retail units carries ``KPI-SLS-001``; ``KPI-TGT-001`` is the governed measure
#: COMPUTED FROM such rows. Storing ``KPI-TGT-001`` on the fact would make the fact
#: describe its own consumer.
TARGET_METRIC_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-SLS-001",
    "KPI-GRS-001",
    "KPI-GRS-002",
    "KPI-GRS-003",
)

#: Which metrics each scope type may target, mirrored by a CHECK constraint on the fact.
#:
#: Store scope owns the two headline measures. Department scope owns the two gross
#: components. Employee scope owns unit delivery. The separation is what stops a
#: department row targeting total gross -- which would double-count against the store
#: row -- or a store row targeting front gross, which would create two overlapping store
#: gross plans.
TARGET_SCOPE_METRICS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        TARGET_SCOPE_STORE: ("KPI-GRS-003", "KPI-SLS-001"),
        TARGET_SCOPE_DEPARTMENT: ("KPI-GRS-001", "KPI-GRS-002"),
        TARGET_SCOPE_EMPLOYEE: ("KPI-SLS-001",),
    }
)

#: Every Targets and pace KPI identifier, in KPI_CATALOG.md order.
#:
#: HELD SEPARATE FROM :data:`KPI_IDS` FOR THE SAME REASON
#: :data:`INVENTORY_LISTING_KPI_IDS` IS. ``KPI_IDS`` is the 29-strong MVP set the
#: semantic model implements as DAX measures, and
#: ``powerbi/validation/model_expectations.json`` asserts its size against the measures
#: that actually exist. These ten are governed, computed in SQL by
#: ``reporting.vw_target_attainment`` and rendered by the web console, but they are NOT
#: semantic-model measures: the Power BI model is awaiting real-engine validation and
#: adding measures before that validation would change what is being validated. Folding
#: them into ``KPI_IDS`` would make the model's own expectation file wrong and would
#: restate the historical MVP baseline, which describes 29 KPIs and still does.
TARGET_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-TGT-001",  # Retail unit target
    "KPI-TGT-002",  # Retail unit target attainment
    "KPI-TGT-003",  # Total gross target
    "KPI-TGT-004",  # Total gross target attainment
    "KPI-TGT-005",  # Selling days elapsed
    "KPI-TGT-006",  # Selling days remaining
    "KPI-TGT-007",  # Retail unit pace
    "KPI-TGT-008",  # Total gross pace
    "KPI-TGT-009",  # Projected month-end retail units
    "KPI-TGT-010",  # Projected month-end total gross
)

#: The reporting view each Targets and pace KPI is computed from.
TARGET_KPI_VIEW_OWNERSHIP: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    dict.fromkeys(TARGET_KPI_IDS, ("vw_target_attainment",))
)

# ---------------------------------------------------------------------------------------
# The F&I domain (delivery increment DASH.6)
# ---------------------------------------------------------------------------------------
# Everything below governs the finance-and-insurance model: the product catalogue's
# controlled vocabulary, the derived finance structure, the fictional lender
# classification, the adjustment event vocabulary and the twenty-two KPI identifiers.
#
# NOTHING HERE IS A LENDING MECHANIC. ARPI models no APR, no buy rate, no sell rate, no
# rate spread, no payment, no term of a loan, no approval, no decline, no credit tier and
# no credit file. A lender's category and program tier classify the FICTIONAL LENDER, and
# never a customer. See PRIVACY_AND_ETHICS.md section 7.

#: The ten governed F&I product categories. Permanent on assignment.
#:
#: CATEGORIES ARE ROWS, NEVER COLUMNS. There is no ``vsc_gross`` column and there never
#: will be one: a category-per-column model cannot answer "which categories exist?"
#: without a schema change, and it makes the eleventh category a migration rather than a
#: catalogue row. ``warehouse.fact_finance_product_sale`` carries one row per contract and
#: the category is an attribute of the product dimension it resolves.
#:
#: "Extended warranty" is a permitted USER-FACING ALIAS for Vehicle Service Contract. It
#: is never a model category, never a column and never a stored value.
FINANCE_PRODUCT_CATEGORIES: Final[tuple[str, ...]] = (
    "Vehicle Service Contract",
    "GAP",
    "Tire & Wheel",
    "Prepaid Maintenance",
    "Appearance Protection",
    "Key Replacement",
    "Theft or Security Product",
    "Paintless Dent Protection",
    "Lease Wear Protection",
    "Other Aftermarket Product",
)

#: The derived finance structure of a retail transaction.
#:
#: Derived from ``sale_type`` and ``amount_financed`` and never stored on the source
#: entity: ``sale_type`` keeps its existing meaning, and changing it would need its own
#: ADR and migration plan. ``warehouse.dim_sale_type`` remains Deferred.
FINANCE_STRUCTURE_CASH: Final = "Cash"
FINANCE_STRUCTURE_RETAIL_FINANCE: Final = "Retail Finance"
FINANCE_STRUCTURE_LEASE: Final = "Lease"

#: The three RETAIL structures, which are the only ones an eligibility rule may name and
#: the only ones ``KPI-FNI-019`` shares out. They partition the retail population exactly.
RETAIL_FINANCE_STRUCTURES: Final[tuple[str, ...]] = (
    FINANCE_STRUCTURE_CASH,
    FINANCE_STRUCTURE_RETAIL_FINANCE,
    FINANCE_STRUCTURE_LEASE,
)

#: The two non-retail structures. A disposal has no consumer, so no product and no
#: consumer lender may ever attach to one. They are NOT components of the structure mix.
FINANCE_STRUCTURE_WHOLESALE: Final = "Wholesale"
FINANCE_STRUCTURE_DEALER_TRADE: Final = "Dealer Trade"

NON_RETAIL_FINANCE_STRUCTURES: Final[tuple[str, ...]] = (
    FINANCE_STRUCTURE_WHOLESALE,
    FINANCE_STRUCTURE_DEALER_TRADE,
)

#: Every value the finance-structure derivation may return.
FINANCE_STRUCTURES: Final[tuple[str, ...]] = (
    *RETAIL_FINANCE_STRUCTURES,
    *NON_RETAIL_FINANCE_STRUCTURES,
)

#: The lender classification vocabulary. Classifies the FICTIONAL LENDER, never a person.
LENDER_CATEGORIES: Final[tuple[str, ...]] = (
    "Captive",
    "Bank",
    "Credit Union",
    "Independent Finance Company",
)

#: The lender PROGRAM tier vocabulary.
#:
#: READ THIS BEFORE USING IT. A program tier describes the kind of business a fictional
#: lender's program is written for. It is NOT a customer's credit score, NOT a credit
#: tier, NOT an approval result and NOT an adverse-action reason. Nothing in ARPI assigns
#: a tier to a customer, and no ARPI value is derived from any credit datum, because no
#: credit datum exists anywhere in the platform.
LENDER_PROGRAM_TIERS: Final[tuple[str, ...]] = ("Prime", "Near-prime", "Subprime")

#: The four F&I adjustment event types. Permanent on assignment.
ADJUSTMENT_TYPE_CANCELLATION: Final = "Cancellation"
ADJUSTMENT_TYPE_CHARGEBACK: Final = "Chargeback"
ADJUSTMENT_TYPE_REINSTATEMENT: Final = "Reinstatement"
ADJUSTMENT_TYPE_APPROVED: Final = "Approved Adjustment"

ADJUSTMENT_TYPES: Final[tuple[str, ...]] = (
    ADJUSTMENT_TYPE_CANCELLATION,
    ADJUSTMENT_TYPE_CHARGEBACK,
    ADJUSTMENT_TYPE_REINSTATEMENT,
    ADJUSTMENT_TYPE_APPROVED,
)

#: THE SIGN CONVENTION, stated once so no layer can adopt a second one.
#:
#:     net_product_gross_as_of = original_product_gross
#:                             - SUM(adjustment_amount WHERE adjustment_date <= as_of)
#:
#: A POSITIVE adjustment_amount REDUCES retained gross. A NEGATIVE one restores it.
#: Cancellation and Chargeback are therefore positive; Reinstatement is negative, because
#: it reverses a reduction that already happened; Approved Adjustment is signed and
#: carries a governed reason category that says which direction it went and why.
#:
#: The mapping records the sign each type is CONSTRAINED to, and ``None`` where the type
#: is legitimately signed. ``warehouse.fact_finance_product_adjustment`` enforces it as a
#: CHECK constraint and ``DQ-FPA-006`` asserts it in Python.
ADJUSTMENT_SIGN_CONVENTION: Final[Mapping[str, str | None]] = MappingProxyType(
    {
        ADJUSTMENT_TYPE_CANCELLATION: "positive",
        ADJUSTMENT_TYPE_CHARGEBACK: "positive",
        ADJUSTMENT_TYPE_REINSTATEMENT: "negative",
        ADJUSTMENT_TYPE_APPROVED: None,
    }
)

#: The governed reason categories, and the adjustment type each belongs to.
#:
#: A closed vocabulary, because a free-text reason would become a place to write
#: something about a customer. None of these describes a person: each describes what
#: happened to a contract.
ADJUSTMENT_REASON_CATEGORIES: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        ADJUSTMENT_TYPE_CANCELLATION: (
            "Customer Request",
            "Vehicle Sold or Traded",
            "Total Loss",
            "Early Payoff",
        ),
        ADJUSTMENT_TYPE_CHARGEBACK: (
            "Early Payoff",
            "Contract Cancelled",
            "Repossession",
            "Total Loss",
        ),
        ADJUSTMENT_TYPE_REINSTATEMENT: (
            "Cancellation Rescinded",
            "Administrative Correction",
        ),
        ADJUSTMENT_TYPE_APPROVED: (
            "Administrative Correction",
            "Pricing Correction",
            "Remittance Correction",
        ),
    }
)

#: Every governed reason category, deduplicated, for the DDL's CHECK domain.
ADJUSTMENT_REASON_CATEGORY_VALUES: Final[tuple[str, ...]] = tuple(
    sorted({reason for reasons in ADJUSTMENT_REASON_CATEGORIES.values() for reason in reasons})
)

#: THE PROJECT-DEFAULT MINIMUM SAMPLE FLOOR, and the one place it is written.
#:
#: An employee- or manager-level ratio is published with its components at every
#: denominator, but is marked as NOT MEETING THE FLOOR below this count of eligible
#: deals. Below the floor a consumer must render an explicit "insufficient sample (n = X)"
#: state rather than a comparable percentage, must exclude the row from ranking, and must
#: not fire an action rule on it.
#:
#: A PROJECT DEFAULT FOR A FICTIONAL GROUP. Not a statistical significance threshold, not
#: an industry convention and not a legal standard. ``warehouse.fn_minimum_sample_floor``
#: is the SQL side of the same number, and
#: ``tests/integration/test_fi_reporting_views.py`` asserts the two agree, so the value
#: exists once per layer with a proof of equality rather than twice with a hope.
MINIMUM_SAMPLE_ELIGIBLE_DEALS: Final = 10

#: Every F&I KPI identifier, in KPI_CATALOG.md order.
#:
#: HELD SEPARATE FROM :data:`KPI_IDS` FOR THE SAME REASON :data:`TARGET_KPI_IDS` IS.
#: ``KPI_IDS`` is the 29-strong MVP set the Power BI semantic model implements as DAX
#: measures, and ``powerbi/validation/model_expectations.json`` asserts its size against
#: the measures that exist. These twenty-two are governed and computed in SQL; no DAX
#: measure reads them, because the semantic model is awaiting real-engine validation and
#: adding measures before that validation would change what is being validated. Folding
#: them into ``KPI_IDS`` would restate a historical baseline that describes 29 KPIs and
#: still does.
#:
#: BACK-END GROSS AND BACK PVR ARE NOT HERE. They remain ``KPI-GRS-002`` and
#: ``KPI-GRS-005``. DASH.6 adds a reconciliation identity BENEATH them; it does not
#: redefine them, and reissuing an unchanged definition under a new id is forbidden by
#: KPI_CATALOG.md section 37.2.
FI_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-FNI-001",  # Finance reserve gross
    "KPI-FNI-002",  # Finance reserve PVR
    "KPI-FNI-003",  # Original product gross
    "KPI-FNI-004",  # Net product gross (as-of)
    "KPI-FNI-005",  # Product gross PVR
    "KPI-FNI-006",  # Products per retail unit
    "KPI-FNI-007",  # Vehicle Service Contract penetration
    "KPI-FNI-008",  # GAP penetration
    "KPI-FNI-009",  # Tire & Wheel penetration
    "KPI-FNI-010",  # Prepaid Maintenance penetration
    "KPI-FNI-011",  # Product gross per contract
    "KPI-FNI-012",  # Chargeback amount
    "KPI-FNI-013",  # Chargeback count
    "KPI-FNI-014",  # Chargeback rate by amount
    "KPI-FNI-015",  # Chargeback rate by contract count
    "KPI-FNI-016",  # Cancellation amount
    "KPI-FNI-017",  # Cancellation count
    "KPI-FNI-018",  # Cancellation rate
    "KPI-FNI-019",  # Deal structure mix
    "KPI-FNI-020",  # Product-category mix
    "KPI-FNI-021",  # F&I manager penetration
    "KPI-FNI-022",  # F&I manager back PVR
)

#: The reporting view each F&I KPI is computed from. The first entry is the governed SQL
#: owner named in KPI_CATALOG.md.
#:
#: AS-BUILT OWNER CORRECTION, RECORDED RATHER THAN SMOOTHED OVER. The planning document
#: assigned ``KPI-FNI-020`` (product-category mix) to ``reporting.vw_fi_summary``
#: "(category grain)". ``vw_fi_summary``'s declared grain has no category in it, and
#: adding one would repeat that store-day's finance reserve and retail units on every
#: category row -- the exact double count section 34 of the increment forbids. The
#: category-grain owner is therefore ``reporting.vw_fi_product_penetration``, which
#: already holds the category and deliberately carries NO reserve and NO retail-unit
#: column. Correct governance beats preserving a planning assignment.
FI_KPI_VIEW_OWNERSHIP: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "KPI-FNI-001": ("vw_fi_summary",),
        "KPI-FNI-002": ("vw_fi_summary",),
        "KPI-FNI-003": ("vw_fi_summary", "vw_deal_product_detail"),
        "KPI-FNI-004": ("vw_fi_summary", "vw_deal_product_detail"),
        "KPI-FNI-005": ("vw_fi_summary",),
        "KPI-FNI-006": ("vw_fi_summary",),
        "KPI-FNI-007": ("vw_fi_product_penetration",),
        "KPI-FNI-008": ("vw_fi_product_penetration",),
        "KPI-FNI-009": ("vw_fi_product_penetration",),
        "KPI-FNI-010": ("vw_fi_product_penetration",),
        "KPI-FNI-011": ("vw_fi_summary", "vw_fi_product_penetration"),
        "KPI-FNI-012": ("vw_fi_adjustment_summary",),
        "KPI-FNI-013": ("vw_fi_adjustment_summary",),
        "KPI-FNI-014": ("vw_fi_adjustment_summary", "vw_fi_summary"),
        "KPI-FNI-015": ("vw_fi_adjustment_summary", "vw_fi_summary"),
        "KPI-FNI-016": ("vw_fi_adjustment_summary",),
        "KPI-FNI-017": ("vw_fi_adjustment_summary",),
        "KPI-FNI-018": ("vw_fi_adjustment_summary", "vw_fi_summary"),
        "KPI-FNI-019": ("vw_fi_summary",),
        "KPI-FNI-020": ("vw_fi_product_penetration",),
        "KPI-FNI-021": ("vw_fi_product_penetration",),
        "KPI-FNI-022": ("vw_fi_summary",),
    }
)

# ---------------------------------------------------------------------------------------
# The inventory-accounting control domain (DASH.8)
# ---------------------------------------------------------------------------------------
#: The inventory control-account categories an accounting snapshot may resolve to.
#:
#: THREE, NOT THE FOUR THE PLAN NAMED, AND THE MISSING ONE IS A DELIBERATE REFUSAL.
#: ``KPI_EXTENSION_PLAN.md`` listed a fourth category, ``Wholesale Inventory``. Nothing in
#: the model distinguishes a unit HELD FOR WHOLESALE at a snapshot date: ``condition_type``
#: is New / Used / Certified, ``acquisition_source`` describes where the unit came FROM,
#: and the only thing that would separate a wholesale population is how the unit eventually
#: left -- which is a fact about the future of that snapshot date. Classifying inventory by
#: its eventual disposal is exactly the leakage the increment forbids, and it would corrupt
#: every balance it touched: a unit would move between control accounts retroactively as
#: soon as it sold. The category is therefore not created. See ``docs/reviews/DASH-8-REVIEW.md``.
#:
#: CERTIFIED IS ITS OWN CONTROL ACCOUNT, AND THAT IS NOT THE SALES RULE. The sales KPIs
#: group Certified with Used for condition reporting (``CONDITION_GROUPS``); the accounting
#: model does not, because a certified unit carries its own capitalized certification cost
#: and a controller schedules it separately. Accounting classification and KPI grouping are
#: allowed to differ, and they do.
INVENTORY_CONTROL_CATEGORIES: Final[tuple[str, ...]] = (
    "New Vehicle Inventory",
    "Used Vehicle Inventory",
    "Certified Vehicle Inventory",
)

#: The vehicle condition each control category schedules. One condition, one account, and
#: the mapping is total over ``dim_vehicle.condition_type`` -- a unit cannot land in two
#: inventory control balances, and cannot land in none.
CONDITION_TO_CONTROL_CATEGORY: Final[Mapping[str, str]] = MappingProxyType(
    {
        "New": "New Vehicle Inventory",
        "Used": "Used Vehicle Inventory",
        "Certified": "Certified Vehicle Inventory",
    }
)

#: The GL account types the synthetic control catalogue may declare.
GL_ACCOUNT_TYPES: Final[tuple[str, ...]] = ("Asset", "Liability")

#: The normal balance vocabulary, closed so no third spelling can enter.
GL_NORMAL_BALANCES: Final[tuple[str, ...]] = ("Debit", "Credit")

#: Every accounting KPI identifier, in KPI_CATALOG.md order.
#:
#: HELD SEPARATE FROM :data:`KPI_IDS` FOR THE SAME REASON :data:`FI_KPI_IDS` IS. ``KPI_IDS``
#: is the 29-strong MVP set the Power BI semantic model implements as DAX measures. These
#: twelve are governed and computed in SQL and no DAX measure reads them. Folding them into
#: ``KPI_IDS`` would restate a historical baseline that describes 29 KPIs and still does.
ACCOUNTING_KPI_IDS: Final[tuple[str, ...]] = (
    "KPI-ACC-001",  # Inventory subledger balance
    "KPI-ACC-002",  # GL inventory control balance
    "KPI-ACC-003",  # Inventory reconciliation variance
    "KPI-ACC-004",  # Unreconciled stock count
    "KPI-ACC-005",  # Unbalanced front-gross identity count
    "KPI-ACC-006",  # Unbalanced back-gross reconciliation count
    "KPI-ACC-007",  # Unbalanced total-gross identity count
    "KPI-ACC-008",  # Orphaned F&I product count
    "KPI-ACC-009",  # Product adjustment without original contract count
    "KPI-ACC-010",  # Missing inventory book record count
    "KPI-ACC-011",  # Inventory posting lag
    "KPI-ACC-012",  # Data-quality exception count
)

#: The reporting view each accounting KPI is computed from.
ACCOUNTING_KPI_VIEW_OWNERSHIP: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "KPI-ACC-001": ("vw_inventory_accounting", "vw_inventory_gl_reconciliation"),
        "KPI-ACC-002": ("vw_inventory_gl_reconciliation",),
        "KPI-ACC-003": ("vw_inventory_gl_reconciliation",),
        "KPI-ACC-004": ("vw_accounting_exceptions",),
        "KPI-ACC-005": ("vw_accounting_exceptions",),
        "KPI-ACC-006": ("vw_accounting_exceptions",),
        "KPI-ACC-007": ("vw_accounting_exceptions",),
        "KPI-ACC-008": ("vw_accounting_exceptions",),
        "KPI-ACC-009": ("vw_accounting_exceptions",),
        "KPI-ACC-010": ("vw_accounting_exceptions",),
        "KPI-ACC-011": ("vw_inventory_accounting",),
        "KPI-ACC-012": ("vw_accounting_exceptions",),
    }
)

#: The governed accounting exception vocabulary, closed.
#:
#: One code per control QUESTION, not per symptom. A single physical defect must produce a
#: single exception row: ``vw_accounting_exceptions`` gives every row a stable identifier
#: built from its code and its entity so a UNION branch cannot report the same defect twice.
ACCOUNTING_EXCEPTION_CODES: Final[tuple[str, ...]] = (
    "ACC-GL-VARIANCE",
    "ACC-MISSING-GL-BALANCE",
    "ACC-MISSING-SUBLEDGER-BALANCE",
    "ACC-MISSING-BOOK-ROW",
    "ACC-ORPHAN-BOOK-ROW",
    "ACC-FRONT-GROSS-IDENTITY",
    "ACC-BACK-GROSS-IDENTITY",
    "ACC-TOTAL-GROSS-IDENTITY",
    "ACC-ORPHAN-FI-PRODUCT",
    "ACC-ORPHAN-FI-ADJUSTMENT",
    "ACC-DQ-FAILURE",
)

#: The reconciliation comparison states. ``Reconciled`` and ``Variance`` both mean BOTH
#: SIDES WERE PRESENT AND COMPARED; the two missing states mean no comparison was possible
#: and the variance is NULL. Missing is never zero.
RECONCILIATION_COMPARISON_STATES: Final[tuple[str, ...]] = (
    "Reconciled",
    "Variance",
    "Missing GL balance",
    "Missing subledger balance",
)

#: The eligibility rule identifiers, in the order the configuration declares them.
#:
#: The configuration in ``config/reference/fi_product_eligibility.yaml`` is the authority
#: on what each rule MEANS; this tuple exists so a consumer can assert the set has not
#: silently changed, and so the SQL DDL's CHECK domain and the Python evaluator cannot
#: drift apart. ``tests/unit/test_fi_eligibility.py`` asserts the two agree.
ELIGIBILITY_RULE_IDS: Final[tuple[str, ...]] = (
    "ELIG-VSC",
    "ELIG-GAP",
    "ELIG-TW",
    "ELIG-PPM",
    "ELIG-LWP",
    "ELIG-OTH",
)

# ---------------------------------------------------------------------------------------
# Reconciliation identifiers evaluated in SQL
# ---------------------------------------------------------------------------------------
#: Every reconciliation ``audit.vw_recon_all`` publishes, and the loader records on each
#: database run through ``audit.fn_record_all_reconciliations``.
SQL_RECONCILIATION_IDS: Final[tuple[str, ...]] = (
    "RECON-FACT-VEHICLE-SALE-WAREHOUSE",
    "RECON-FACT-INVENTORY-SNAPSHOT-WAREHOUSE",
    "RECON-FACT-LEAD-WAREHOUSE",
    "RECON-FACT-APPOINTMENT-WAREHOUSE",
    "RECON-FACT-MARKETING-SPEND-WAREHOUSE",
    "RECON-INV-CONTINUITY",
    "RECON-GROSS-001",
    "RECON-GROSS-001-FRONT",
    "RECON-GROSS-002",
    "RECON-UNITS-001",
    "RECON-REPORT-SALES",
    "RECON-LEAD-001",
    "RECON-LEAD-DUPLICATES",
    "RECON-FUNNEL-BOUNDS",
    "RECON-FUNNEL-SOLD-PATH",
    "RECON-FUNNEL-CHAIN",
    "RECON-MKT-SPEND",
    "RECON-MKT-LEADS",
    "RECON-MKT-SALES",
    "RECON-MKT-GROSS",
    "RECON-MKT-COST-RULE",
    "RECON-REPORT-SALES-ROWS",
    "RECON-REPORT-INVENTORY-ROWS",
    "RECON-INV-001",
    "RECON-REPORT-LEADS-ROWS",
    "RECON-REPORT-APPOINTMENTS-ROWS",
    "RECON-REPORT-SPEND-ROWS",
    "RECON-REPORT-DAYS-TO-SALE",
    # Targets and pace (DASH.5). Registered here like every other SQL reconciliation, so
    # a target lost between two layers fails a run rather than making every attainment
    # percentage quietly larger.
    "RECON-FACT-SALES-TARGET-WAREHOUSE",
    "RECON-TGT-GRAIN",
    "RECON-TGT-UNITS",
    "RECON-TGT-GROSS",
    "RECON-TGT-DEPT-SPLIT",
    "RECON-TGT-STORE-TOTALS",
    "RECON-TGT-MONTH-TOTALS",
    "RECON-REPORT-TARGET-ROWS",
    "RECON-TGT-ACTUAL-UNITS",
    "RECON-TGT-ACTUAL-GROSS",
    # The F&I domain (DASH.6). RECON-FI-001 is the promoted headline: it proves the
    # stored deal-date back-end gross is EXPLAINED, to the cent, by finance reserve plus
    # original product gross. The rest prove the chain, the grains, the eligibility
    # subset, the adjustment cap and the reporting layer's freedom from fan-out.
    "RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE",
    "RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE",
    "RECON-FI-001",
    "RECON-FI-PRODUCT-IDENTITY",
    "RECON-FI-DEAL-LEVEL",
    "RECON-FI-STORE-TOTALS",
    "RECON-FI-PERIOD-TOTALS",
    "RECON-FI-TOTAL-GROSS",
    "RECON-FI-RESERVE-STRUCTURE",
    "RECON-FI-ELIGIBILITY",
    "RECON-FI-PRODUCT-GRAIN",
    "RECON-FI-ADJUSTMENT-GRAIN",
    "RECON-FI-ADJUSTMENT-CAP",
    "RECON-FI-ADJUSTMENT-SEQUENCE",
    "RECON-FI-NET-GROSS",
    "RECON-REPORT-FI-DETAIL-ROWS",
    "RECON-REPORT-FI-SUMMARY-ROWS",
    "RECON-REPORT-FI-PENETRATION-ROWS",
    "RECON-REPORT-FI-ADJUSTMENT-ROWS",
    # The inventory-accounting control domain (DASH.8). RECON-ACC-BOOK-IDENTITY is the
    # headline: it proves current book value is EXPLAINED, to the cent, by its declared
    # components. RECON-ACC-GL-SUBLEDGER is deliberately NOT an equality: it records the
    # compared amounts and the signed variance, because a controlled variance is a valid
    # reconciliation OUTCOME and not a structural defect. See sql/08_validation.
    "RECON-FACT-INVENTORY-ACCOUNTING-WAREHOUSE",
    "RECON-FACT-GL-CONTROL-BALANCE-WAREHOUSE",
    "RECON-ACC-BOOK-IDENTITY",
    "RECON-ACC-BOOK-COMPONENTS",
    "RECON-ACC-PACK-EXCLUDED",
    "RECON-ACC-FLOORPLAN-EXCLUDED",
    "RECON-ACC-POPULATION",
    "RECON-ACC-CATEGORY-TOTALS",
    "RECON-ACC-GL-SUBLEDGER",
    "RECON-ACC-GRAIN",
    "RECON-GLB-GRAIN",
    "RECON-REPORT-ACCOUNTING-ROWS",
    "RECON-REPORT-GL-RECON-ROWS",
)

#: The reconciliations whose failure invalidates the numbers built on them.
#:
#: Every SQL reconciliation is critical except ``RECON-FUNNEL-CHAIN``, which multiplies
#: two lead-grain rates by two appointment-grain rates. One lead can produce several
#: appointments, so that product is an approximation and cannot be made an identity; a
#: breach is a finding to explain, not a defect. ``reporting.vw_reconciliation_status``
#: derives the same distinction in SQL.
#: ``RECON-ACC-GL-SUBLEDGER`` joins them for a different and stronger reason. It compares
#: a GL control balance with the inventory subledger it schedules, and the increment
#: DELIBERATELY plants variances so the reconciliation surface can be seen working. A
#: nonzero variance there is the intended demonstration, not a defect: both sides are
#: structurally valid data, they simply do not agree. Marking a run failed because a
#: controlled accounting variance exists would make the exception surface unusable, and
#: would teach a reader that a variance means broken data. It does not. The variance is
#: still calculated, recorded and rendered -- it is the STATUS that is not critical.
NON_CRITICAL_RECONCILIATION_IDS: Final[frozenset[str]] = frozenset(
    {"RECON-FUNNEL-CHAIN", "RECON-ACC-GL-SUBLEDGER"}
)

CRITICAL_SQL_RECONCILIATION_IDS: Final[tuple[str, ...]] = tuple(
    identifier
    for identifier in SQL_RECONCILIATION_IDS
    if identifier not in NON_CRITICAL_RECONCILIATION_IDS
)

#: The only tolerance values any ARPI reconciliation may carry.
#:
#: ``0`` is exact, and every count and identity comparison uses it. ``0.01`` is
#: ``validation.numeric_absolute_tolerance``, applied where two currency figures are
#: compared to the cent or a rate crosses a documented grain shift. A third value would
#: be an unexplained tolerance, which is a hole in the evidence rather than a setting.
ALLOWED_RECONCILIATION_TOLERANCES: Final[frozenset[str]] = frozenset({"0", "0.01"})
