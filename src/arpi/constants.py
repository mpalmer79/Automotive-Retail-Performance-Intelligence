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
DASHBOARD_PROGRAM_VIEWS: Final[tuple[str, ...]] = (
    "vw_sales_gross_trend",
    "vw_gross_change_bridge",
    "vw_deal_explorer",
)

#: Every view the ``reporting`` schema is expected to contain, and nothing else.
REPORTING_VIEWS: Final[tuple[str, ...]] = tuple(
    sorted({*MVP_REPORTING_VIEWS, *INVENTORY_LISTING_VIEWS, *DASHBOARD_PROGRAM_VIEWS})
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
)

#: The reconciliations whose failure invalidates the numbers built on them.
#:
#: Every SQL reconciliation is critical except ``RECON-FUNNEL-CHAIN``, which multiplies
#: two lead-grain rates by two appointment-grain rates. One lead can produce several
#: appointments, so that product is an approximation and cannot be made an identity; a
#: breach is a finding to explain, not a defect. ``reporting.vw_reconciliation_status``
#: derives the same distinction in SQL.
NON_CRITICAL_RECONCILIATION_IDS: Final[frozenset[str]] = frozenset({"RECON-FUNNEL-CHAIN"})

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
