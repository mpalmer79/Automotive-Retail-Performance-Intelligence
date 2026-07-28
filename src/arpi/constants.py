"""Project-wide constants shared by generation, validation, ingestion and the CLI.

Everything in this module is a canonical value taken from the Phase 0 cross-agent
contract. Nothing here may be changed without also changing the SQL DDL, the data
dictionary and the committed sample data.
"""

from __future__ import annotations

from datetime import date
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
PROHIBITED_PII_FIELD_NAMES: Final[frozenset[str]] = frozenset(
    {
        "account_number",
        "address",
        "address_line_1",
        "address_line_2",
        "bank_account",
        "birth_date",
        "birthdate",
        "compensation",
        "credit_card",
        "credit_card_number",
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
        "middle_name",
        "mobile_number",
        "name",
        "national_id",
        "passport_number",
        "pay_rate",
        "phone",
        "phone_number",
        "postal_code",
        "routing_number",
        "salary",
        "social_security",
        "social_security_number",
        "ssn",
        "street",
        "street_address",
        "surname",
        "tax_id",
        "wage",
        "zip_code",
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

CHECK_CATEGORY_STRUCTURAL: Final = "structural"
CHECK_CATEGORY_BUSINESS_RULE: Final = "business_rule"
CHECK_CATEGORY_PRIVACY: Final = "privacy"
CHECK_CATEGORY_REPRODUCIBILITY: Final = "reproducibility"

RECONCILIATION_DIM_DATE_ROW_COUNT: Final = "RECON-DIM-DATE-ROWCOUNT"
RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT: Final = "RECON-DIM-DEALERSHIP-ROWCOUNT"
