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
FICTIONAL_DEALER_GROUP: Final = "Granite State Auto Group"
SOURCE_SYSTEM: Final = "arpi_synthetic_generator"
GENERATOR_MODULE: Final = "arpi.generation"

SYNTHETIC_DATA_NOTICE: Final = (
    "SYNTHETIC DATA -- 100% machine generated. Granite State Auto Group and every store, "
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
        "entity_name": "Warehouse entity such as dim_date. Names a table, never a person.",
        "holiday_name": "Recognised holiday label such as 'Independence Day'.",
        "lead_source_name": (
            "Normalised, generic lead-source label such as 'Dealer Website'. Names a "
            "channel, never a person."
        ),
        "model_name": "Vehicle model label such as 'Equinox'. Names a product, never a person.",
        "month_name": "Calendar vocabulary from MONTH_NAMES: January..December.",
        "pipeline_name": "Logical pipeline such as phase0_foundation.",
        "profile_name": "ARPI configuration profile: development, test or portfolio.",
        "quarter_name": "Calendar vocabulary: Q1..Q4.",
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
