"""The generalised prohibited-field tripwire."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from arpi.constants import (
    APPROVED_AGE_COLUMNS,
    APPROVED_NAME_COLUMNS,
    REDACTED_PLACEHOLDER,
)
from arpi.validation.privacy import (
    ProhibitedColumnError,
    assert_columns_are_privacy_safe,
    assert_csv_header_is_privacy_safe,
    assert_frame_is_privacy_safe,
    is_prohibited_column,
    normalise_column_name,
    prohibited_columns,
    redact_payload,
)

# Realistic Phase 1 column shapes that MUST be refused. Every one of these is a name a
# real DMS or CRM export would actually use, which is the point: the tripwire has to
# catch the shapes that will genuinely be proposed, not only their textbook forms.
MUST_FAIL = [
    "customer_email",
    "buyer_first_name",
    "salesperson_name",
    "home_phone_number",
    "customer_ssn",
    "employee_salary",
    "commission_amount",
    "pay_plan",
    "date_of_birth",
    "drivers_license_number",
    "bank_account_number",
    "credit_card_number",
    "exact_credit_score",
    "race",
    "ethnicity",
    "gender",
    "marital_status",
    "veteran_status",
    "message_body",
    "call_recording_url",
    "customer_notes",
    "Customer-Email",
    "customer.email",
    "CUSTOMER__EMAIL",
]

# Columns that exist, or are contracted to exist, and MUST keep passing. A tripwire that
# fires on `day_name` or `model` would be turned off within a week.
MUST_PASS = [
    "day_name",
    "month_name",
    "quarter_name",
    "holiday_name",
    "store_name",
    "store_short_name",
    "check_name",
    "entity_name",
    "pipeline_name",
    "profile_name",
    "campaign_name",
    "vendor_name",
    "lead_source_name",
    "make",
    "model",
    "trim",
    "model_name",
    "age_band",
    "market_area",
    "county",
]


@pytest.mark.parametrize("column", MUST_FAIL)
def test_prohibited_columns_are_refused(column: str) -> None:
    assert is_prohibited_column(column), f"{column!r} must be refused as personal data"


@pytest.mark.parametrize("column", MUST_PASS)
def test_legitimate_columns_are_accepted(column: str) -> None:
    assert not is_prohibited_column(column), f"{column!r} was wrongly refused"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("customer_email", "customer_email"),
        ("Customer-Email", "customer_email"),
        ("customer.email", "customer_email"),
        ("CUSTOMER__EMAIL", "customer_email"),
        ("  Customer Email  ", "customer_email"),
        ("__customer___email__", "customer_email"),
        ("Day Name", "day_name"),
        ("", ""),
        ("___", ""),
    ],
)
def test_normalisation(raw: str, expected: str) -> None:
    assert normalise_column_name(raw) == expected


def test_an_empty_name_is_not_prohibited() -> None:
    """A blank name carries no personal data; the schema check catches it elsewhere."""
    assert not is_prohibited_column("   ")


@pytest.mark.parametrize(
    "column",
    ["age", "customer_age", "age_years", "driver_age", "applicant_age_at_signing"],
)
def test_age_as_an_exact_value_is_refused(column: str) -> None:
    assert is_prohibited_column(column)


@pytest.mark.parametrize("column", sorted(APPROVED_AGE_COLUMNS))
def test_banded_age_columns_are_accepted(column: str) -> None:
    assert not is_prohibited_column(column)


def test_every_allowlist_entry_carries_a_written_justification() -> None:
    """An allowlist without reasons is a blocklist with extra steps."""
    for column, justification in {**APPROVED_NAME_COLUMNS, **APPROVED_AGE_COLUMNS}.items():
        assert justification.strip(), f"{column} is allowlisted with no justification"
        assert len(justification) > 30, f"{column}'s justification explains nothing"


def test_prohibited_columns_preserves_the_declared_spelling() -> None:
    offending = prohibited_columns(["county", "Customer-Email", "make", "customer_ssn"])
    assert offending == ("Customer-Email", "customer_ssn")


def test_assert_columns_accepts_a_clean_schema() -> None:
    assert_columns_are_privacy_safe(("customer_id", "age_band", "county"), "dim_customer") is None


def test_assert_columns_fails_closed() -> None:
    with pytest.raises(ProhibitedColumnError) as excinfo:
        assert_columns_are_privacy_safe(
            ("customer_id", "customer_email"), "dim_customer", source="declared columns"
        )
    error = excinfo.value
    assert error.entity == "dim_customer"
    assert error.columns == ("customer_email",)
    assert "customer_email" in str(error)
    assert "must never generate" in str(error)


def test_assert_frame_fails_closed() -> None:
    frame = pd.DataFrame({"customer_id": ["CUS-00000001"], "home_phone_number": ["x"]})
    with pytest.raises(ProhibitedColumnError, match="home_phone_number"):
        assert_frame_is_privacy_safe(frame, "dim_customer")


def test_assert_frame_accepts_a_clean_frame() -> None:
    frame = pd.DataFrame({"customer_id": ["CUS-00000001"], "age_band": ["25-34"]})
    assert assert_frame_is_privacy_safe(frame, "dim_customer") is None


def test_a_postgresql_column_list_uses_the_same_rule() -> None:
    """information_schema returns names; names are all the checker needs."""
    catalogue_columns = ["dealership_key", "store_name", "city", "state_code"]
    assert_columns_are_privacy_safe(
        catalogue_columns, "warehouse.dim_dealership", source="information_schema.columns"
    )
    with pytest.raises(ProhibitedColumnError):
        assert_columns_are_privacy_safe(
            [*catalogue_columns, "owner_email"],
            "warehouse.dim_dealership",
            source="information_schema.columns",
        )


def test_csv_header_is_checked(tmp_path: Path) -> None:
    clean = tmp_path / "dim_customer.csv"
    clean.write_text("customer_id,age_band,county\nCUS-00000001,25-34,Hillsborough\n")
    assert assert_csv_header_is_privacy_safe(clean, "dim_customer") == (
        "customer_id",
        "age_band",
        "county",
    )

    dirty = tmp_path / "leads.csv"
    dirty.write_text("lead_id,customer_email\nLED-000000001,a@example.com\n")
    with pytest.raises(ProhibitedColumnError, match="customer_email"):
        assert_csv_header_is_privacy_safe(dirty, "fact_lead")


def test_redact_payload_masks_values_but_keeps_keys() -> None:
    payload = {
        "lead_id": "LED-000000001",
        "customer_email": "someone@example.com",
        "home_phone_number": "555-0100",
        "age_band": "25-34",
    }
    redacted = redact_payload(payload)

    assert list(redacted) == list(payload), "keys must survive so the shape stays legible"
    assert redacted["lead_id"] == "LED-000000001"
    assert redacted["age_band"] == "25-34"
    assert redacted["customer_email"] == REDACTED_PLACEHOLDER
    assert redacted["home_phone_number"] == REDACTED_PLACEHOLDER
    assert "someone@example.com" not in str(redacted)


def test_redact_payload_does_not_mutate_its_input() -> None:
    payload = {"customer_ssn": "000-00-0000"}
    redacted = redact_payload(payload)
    assert payload["customer_ssn"] == "000-00-0000"
    assert redacted["customer_ssn"] == REDACTED_PLACEHOLDER


def test_redact_payload_leaves_a_clean_payload_alone() -> None:
    payload = {"vehicle_id": "VEH-0001337", "odometer_reading": 42}
    assert redact_payload(payload) == payload
