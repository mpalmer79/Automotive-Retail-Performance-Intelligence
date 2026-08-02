"""The refusal rules a committed sanitized listing workbook must satisfy.

This module is the reason a sanitized workbook can be committed at all. Everything
ADR-0011 promises about the lane -- no original VIN, no source URL, no real dealer
identity, a classification that cannot be omitted, a store that resolves against the
authoritative registry, a file name that matches its own contents -- is expressed here as
an executable rule that **refuses** rather than warns.

Registered checks
-----------------
Seventeen ``DQ-LST-*`` checks are declared in :data:`LISTING_CHECKS`. Fourteen are
answerable from the workbook alone and run here; three are database-side (observed-vehicle
resolution, rerun idempotency, and the reconciliation of loaded rows) and run in
:mod:`arpi.inventory.importer`. Declaring all seventeen in one register is what lets a
test assert the set is complete without knowing where each one executes.

Redaction is not optional
-------------------------
Every finding names a **row number, a column and a category**, and never the offending
value. A validator that quoted the value it rejected would put an original VIN or a source
URL into a CI log the moment it did its job, which is exactly the leak the lane exists to
prevent. :func:`ValidationFinding.render` is the only formatting path and it cannot be
made to include a value.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Final

from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
)
from arpi.exceptions import ValidationError
from arpi.inventory.contract import InventoryListingContract, load_contract, normalise_header
from arpi.inventory.identity import derived_sanitized_file_name
from arpi.inventory.spec import resolve_store
from arpi.inventory.workbook import SheetData, open_read_only, open_with_formulas, read_sheet_rows

__all__ = [
    "LISTING_CHECKS",
    "ListingCheck",
    "ListingRecord",
    "ValidationFinding",
    "WorkbookMetadata",
    "WorkbookValidationResult",
    "contains_url",
    "file_digest",
    "looks_like_a_real_vin",
    "read_listing_records",
    "validate_workbook",
]

# --------------------------------------------------------------------------------------
# Value-level tripwires
# --------------------------------------------------------------------------------------

#: Any HTTP or HTTPS URL, and the scheme-relative and bare-host forms that carry the same
#: information. A sanitized artifact contains none of them anywhere, on any sheet.
_URL_PATTERN: Final = re.compile(
    r"(?:https?://|ftp://|//[a-z0-9-]+\.[a-z]{2,}|www\.[a-z0-9-]+\.[a-z]{2,})",
    re.IGNORECASE,
)

#: The ISO 3779 VIN character set: thirty-three characters, with ``I``, ``O`` and ``Q``
#: excluded precisely because they are confusable with 1 and 0.
#:
#: A seventeen-character string drawn only from this set is treated as a real VIN. The
#: rule is deliberately stricter than a check-digit test: the check digit is mandatory
#: only in North America, so a check-digit rule would pass a genuine European VIN. ARPI's
#: own identifiers are unaffected because every one of them begins ``ARPI`` and ``I`` is
#: not in the set -- which is the whole reason ADR-0005 chose that prefix.
_REAL_VIN_PATTERN: Final = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")

#: A README key/value row needs both halves to say anything.
_KEY_VALUE_WIDTH: Final = 2

#: Path segments the governed layout puts after the reference root: a date directory,
#: and a store directory above it.
_DATE_SEGMENT_DEPTH: Final = 2
_STORE_SEGMENT_DEPTH: Final = 3

#: Real dealer identities must never appear. The rule is positive rather than a blocklist
#: of real companies: a store name that is not one of the fictional Granite State Auto
#: Group stores is refused, so a future source's real name fails without anyone having to
#: predict it.
_FICTIONAL_GROUP: Final = "Granite State Auto Group"


def contains_url(value: Any) -> bool:
    """Return whether a cell value carries a URL.

    Args:
        value: Any cell value.

    Returns:
        ``True`` when the rendered value contains an HTTP, HTTPS, FTP, scheme-relative or
        ``www.`` reference.
    """
    if value is None:
        return False
    return bool(_URL_PATTERN.search(str(value)))


def looks_like_a_real_vin(value: Any) -> bool:
    """Return whether a value could be a real vehicle identification number.

    Args:
        value: Any cell value.

    Returns:
        ``True`` when the trimmed, upper-cased value is exactly seventeen characters drawn
        from the ISO 3779 VIN alphabet. ARPI's own ``ARPI``-prefixed identifiers always
        return ``False``.
    """
    if value is None:
        return False
    return bool(_REAL_VIN_PATTERN.match(str(value).strip().upper()))


def file_digest(path: Path) -> str:
    """Return the SHA-256 of a file's bytes, read in chunks.

    Args:
        path: File to digest.

    Returns:
        A 64-character lowercase hexadecimal digest.
    """
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------------------
# The registered checks
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ListingCheck:
    """One registered data-quality check for the sanitized listing lane.

    Attributes:
        check_id: Stable ``DQ-LST-nnn`` identifier.
        name: Short human-readable name.
        category: One of the canonical validation categories (ADR-0004).
        scope: ``workbook`` when the check is answerable from the file alone,
            ``database`` when it needs a loaded warehouse.
    """

    check_id: str
    name: str
    category: str
    scope: str


#: Every data-quality check the listing lane registers, in identifier order.
LISTING_CHECKS: Final[tuple[ListingCheck, ...]] = (
    ListingCheck("DQ-LST-001", "Declared grain is unique", CHECK_CATEGORY_UNIQUENESS, "workbook"),
    ListingCheck("DQ-LST-002", "Every dealership resolves", CHECK_CATEGORY_REFERENTIAL, "workbook"),
    ListingCheck(
        "DQ-LST-003", "Every observed vehicle resolves", CHECK_CATEGORY_REFERENTIAL, "database"
    ),
    ListingCheck(
        "DQ-LST-004",
        "Synthetic vehicle IDs and synthetic VINs are unique",
        CHECK_CATEGORY_UNIQUENESS,
        "workbook",
    ),
    ListingCheck("DQ-LST-005", "No valid real VIN appears", CHECK_CATEGORY_PRIVACY, "workbook"),
    ListingCheck("DQ-LST-006", "No URL appears", CHECK_CATEGORY_PRIVACY, "workbook"),
    ListingCheck("DQ-LST-007", "Condition is valid", CHECK_CATEGORY_BUSINESS_RULE, "workbook"),
    ListingCheck("DQ-LST-008", "Mileage is nonnegative", CHECK_CATEGORY_BUSINESS_RULE, "workbook"),
    ListingCheck(
        "DQ-LST-009", "Price agrees with pricing status", CHECK_CATEGORY_BUSINESS_RULE, "workbook"
    ),
    ListingCheck(
        "DQ-LST-010", "Inventory unit count is exactly 1", CHECK_CATEGORY_BUSINESS_RULE, "workbook"
    ),
    ListingCheck(
        "DQ-LST-011",
        "Workbook dealership metadata agrees with every data row",
        CHECK_CATEGORY_REFERENTIAL,
        "workbook",
    ),
    ListingCheck(
        "DQ-LST-012",
        "Workbook path date agrees with Captured At",
        CHECK_CATEGORY_STRUCTURAL,
        "workbook",
    ),
    ListingCheck(
        "DQ-LST-013", "Data classification is approved", CHECK_CATEGORY_PRIVACY, "workbook"
    ),
    ListingCheck(
        "DQ-LST-014", "The source file digest is recorded", CHECK_CATEGORY_STRUCTURAL, "database"
    ),
    ListingCheck("DQ-LST-015", "A rerun is idempotent", CHECK_CATEGORY_UNIQUENESS, "database"),
    ListingCheck(
        "DQ-LST-016",
        "The canonical filename follows the approved ARPI underscore convention",
        CHECK_CATEGORY_STRUCTURAL,
        "workbook",
    ),
    ListingCheck(
        "DQ-LST-017",
        "No unapproved duplicate or alias workbook exists for the same store and snapshot",
        CHECK_CATEGORY_UNIQUENESS,
        "workbook",
    ),
)

#: Checks answerable from a workbook alone.
WORKBOOK_CHECK_IDS: Final[tuple[str, ...]] = tuple(
    check.check_id for check in LISTING_CHECKS if check.scope == "workbook"
)

#: Checks that need a loaded warehouse.
DATABASE_CHECK_IDS: Final[tuple[str, ...]] = tuple(
    check.check_id for check in LISTING_CHECKS if check.scope == "database"
)


# --------------------------------------------------------------------------------------
# Findings
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ValidationFinding:
    """One refusal reason.

    Attributes:
        check_id: The ``DQ-LST-*`` check that produced it, or ``CONTRACT`` for a
            structural failure that precedes every check.
        category: Canonical validation category.
        message: What is wrong, in words. Never contains an offending value.
        sheet: Sheet the finding is on, when it has one.
        row: One-based data-row number within the sheet, when it has one.
        column: Column header the finding is about, when it has one.
    """

    check_id: str
    category: str
    message: str
    sheet: str | None = None
    row: int | None = None
    column: str | None = None

    def render(self) -> str:
        """Render the finding as one redacted line.

        Returns:
            ``"DQ-LST-009 [business_rule] Inventory row 174, column 'Advertised Price':
            ..."``. The offending value never appears.
        """
        location = ""
        if self.sheet and self.row is not None:
            location = f"{self.sheet} row {self.row}"
        elif self.sheet:
            location = self.sheet
        if self.column:
            location = (
                f"{location}, column {self.column!r}" if location else f"column {self.column!r}"
            )
        prefix = f"{self.check_id} [{self.category}]"
        return f"{prefix} {location}: {self.message}" if location else f"{prefix} {self.message}"


# --------------------------------------------------------------------------------------
# The parsed workbook
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ListingRecord:
    """One typed row of the sanitized ``Inventory`` sheet.

    The attribute names are the warehouse-side column names, so a record maps onto
    ``raw.inventory_listing_snapshot_load`` without a second translation table.
    """

    source_record_id: str
    dealership_id: str
    store_name: str
    captured_at: date
    source_batch_id: str
    source_feed: str
    condition_type: str
    model_year: int
    make: str
    model: str
    trim: str | None
    vehicle_display: str
    odometer_miles: int | None
    advertised_price: float | None
    pricing_status: str
    synthetic_vehicle_id: str
    synthetic_vin: str
    inventory_unit_count: int
    data_classification: str
    row_number: int

    @property
    def natural_key(self) -> tuple[str, date, str]:
        """The declared source grain: store, capture date, observed vehicle."""
        return (self.dealership_id, self.captured_at, self.synthetic_vehicle_id)


@dataclass(frozen=True, slots=True)
class WorkbookMetadata:
    """The governance block read from the ``README`` sheet.

    Attributes:
        dealership_id: Store the workbook declares.
        store_name: Store name the workbook declares.
        captured_at: Snapshot date the workbook declares.
        classification: Declared data classification.
        contract_version: Sanitization version the workbook was written against.
        values: Every key/value pair read from the sheet, for diagnostics.
    """

    dealership_id: str | None
    store_name: str | None
    captured_at: date | None
    classification: str | None
    contract_version: str | None
    values: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WorkbookValidationResult:
    """The outcome of validating one sanitized workbook.

    Attributes:
        path: Workbook that was validated.
        digest: SHA-256 of its bytes, recorded as load lineage.
        metadata: The ``README`` governance block.
        records: Every accepted ``Inventory`` row, typed.
        findings: Every refusal reason, redacted.
        checks_run: Identifiers of the checks that were evaluated.
    """

    path: Path
    digest: str
    metadata: WorkbookMetadata
    records: tuple[ListingRecord, ...]
    findings: tuple[ValidationFinding, ...]
    checks_run: tuple[str, ...]

    @property
    def is_valid(self) -> bool:
        """Whether the workbook may be committed and imported."""
        return not self.findings

    @property
    def row_count(self) -> int:
        """Number of ``Inventory`` data rows."""
        return len(self.records)

    def summary(self) -> str:
        """Render a redacted, human-readable summary."""
        lines = [
            f"workbook           : {self.path.name}",
            f"path               : {self.path.as_posix()}",
            f"sha256             : {self.digest}",
            f"dealership         : {self.metadata.dealership_id} ({self.metadata.store_name})",
            f"captured at        : {self.metadata.captured_at}",
            f"classification     : {self.metadata.classification}",
            f"inventory rows     : {self.row_count}",
            f"checks evaluated   : {len(self.checks_run)}",
            f"result             : {'PASS' if self.is_valid else 'FAIL'}",
        ]
        if self.findings:
            lines.append(f"findings           : {len(self.findings)}")
            lines.extend(f"  - {finding.render()}" for finding in self.findings)
        return "\n".join(lines)

    def as_dict(self) -> dict[str, Any]:
        """Render the result as a JSON-serialisable mapping, with no source values."""
        return {
            "workbook": self.path.name,
            "path": self.path.as_posix(),
            "sha256": self.digest,
            "dealership_id": self.metadata.dealership_id,
            "store_name": self.metadata.store_name,
            "captured_at": (
                self.metadata.captured_at.isoformat() if self.metadata.captured_at else None
            ),
            "classification": self.metadata.classification,
            "contract_version": self.metadata.contract_version,
            "inventory_rows": self.row_count,
            "checks_evaluated": list(self.checks_run),
            "result": "PASS" if self.is_valid else "FAIL",
            "findings": [
                {
                    "check_id": finding.check_id,
                    "category": finding.category,
                    "sheet": finding.sheet,
                    "row": finding.row,
                    "column": finding.column,
                    "message": finding.message,
                }
                for finding in self.findings
            ],
        }


# --------------------------------------------------------------------------------------
# Coercion helpers
# --------------------------------------------------------------------------------------


def _as_date(value: Any) -> date | None:
    """Coerce a cell value to a date, or ``None`` when it cannot be one."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _as_int(value: Any) -> int | None:
    """Coerce a cell value to an int, or ``None`` when it cannot be one."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        if isinstance(value, str):
            return int(float(value.replace(",", "").strip()))
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    """Coerce a cell value to a float, or ``None`` when it cannot be one."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        if isinstance(value, str):
            return float(value.replace(",", "").replace("$", "").strip())
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str:
    """Render a cell value as trimmed text."""
    return "" if value is None else str(value).strip()


def _is_blank(value: Any) -> bool:
    """Return whether a cell holds nothing at all.

    Distinct from "does not coerce". For an optional column the difference decides
    whether a row is accepted: an empty cell is an absence the contract permits, and a
    cell holding ``unknown`` is a value somebody wrote that ARPI cannot represent.
    Treating the second as the first would discard it silently.
    """
    return value is None or (isinstance(value, str) and not value.strip())


# --------------------------------------------------------------------------------------
# README metadata
# --------------------------------------------------------------------------------------


def _read_metadata(sheet_rows: Sequence[tuple[Any, ...]]) -> WorkbookMetadata:
    """Read the governance block from the ``README`` sheet's key/value rows."""
    values: dict[str, str] = {}
    for row in sheet_rows:
        if len(row) < _KEY_VALUE_WIDTH:
            continue
        key = _text(row[0])
        if not key:
            continue
        raw = row[1]
        rendered = raw.date().isoformat() if isinstance(raw, datetime) else _text(raw)
        if rendered and key not in values:
            values[key] = rendered
    return WorkbookMetadata(
        dealership_id=values.get("Dealership ID") or None,
        store_name=values.get("Store") or None,
        captured_at=_as_date(values.get("Snapshot date")),
        classification=values.get("Classification") or None,
        contract_version=values.get("Sanitization version") or None,
        values=values,
    )


def _read_readme_rows(path: Path, readme_title: str) -> tuple[tuple[Any, ...], ...]:
    """Read every ``README`` row, header row included, as key/value tuples.

    :func:`arpi.inventory.workbook.read_sheet_rows` treats row 1 as headers, which is
    right for the ``Inventory`` sheet and wrong for ``README`` -- whose row 1 is the
    title and whose key/value pairs start below it. This reads the sheet whole.
    """
    with open_read_only(path) as workbook:
        if readme_title not in workbook.sheetnames:
            return ()
        return tuple(tuple(row) for row in workbook[readme_title].iter_rows(values_only=True))


# --------------------------------------------------------------------------------------
# The validator
# --------------------------------------------------------------------------------------


def _check_sheet_contract(
    workbook: Any, contract: InventoryListingContract, findings: list[ValidationFinding]
) -> bool:
    """Refuse a workbook missing a required sheet. Returns whether it may be read on."""
    missing = [name for name in contract.required_sheets if name not in workbook.sheetnames]
    if missing:
        findings.append(
            ValidationFinding(
                check_id="CONTRACT",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"{len(missing)} required sheet(s) are missing: {', '.join(missing)}. "
                    f"A governed workbook has exactly {', '.join(contract.required_sheets)}."
                ),
            )
        )
        return False
    return True


def _check_header_contract(
    sheet: SheetData, contract: InventoryListingContract, findings: list[ValidationFinding]
) -> bool:
    """Refuse an ``Inventory`` sheet whose header row departs from the contract."""
    expected = list(contract.headers)
    actual = list(sheet.headers)
    ok = True

    prohibited = [
        header for header in actual if normalise_header(header) in contract.prohibited_headers
    ]
    for header in prohibited:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-006" if "url" in normalise_header(header) else "DQ-LST-005",
                category=CHECK_CATEGORY_PRIVACY,
                message=(
                    "the sanitized contract forbids this column; it carries source "
                    "identity that must not be committed"
                ),
                sheet=sheet.title,
                column=header,
            )
        )
        ok = False

    if actual != expected:
        missing = [header for header in expected if header not in actual]
        unexpected = [
            header for header in actual if header not in expected and header not in prohibited
        ]
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if unexpected:
            detail.append(f"unexpected {', '.join(unexpected)}")
        if not detail:
            detail.append("the header order differs from the contract")
        findings.append(
            ValidationFinding(
                check_id="CONTRACT",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"the Inventory header row does not match contract version "
                    f"{contract.contract_version}: {'; '.join(detail)}"
                ),
                sheet=sheet.title,
            )
        )
        ok = False
    return ok


def _typed_record(  # noqa: PLR0912, PLR0915 - one branch per contract rule
    # The nineteen-column contract is validated here, field by field, in one place. A
    # split into "type checks" and "domain checks" would put half the specification in
    # each and make a missing rule invisible in both.
    values: Sequence[Any],
    *,
    row_number: int,
    sheet_title: str,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> ListingRecord | None:
    """Type one ``Inventory`` row, recording a redacted finding for every failure."""
    by_column = dict(zip(contract.columns, values, strict=False))
    before = len(findings)

    def fail(check_id: str, category: str, message: str, header: str) -> None:
        findings.append(
            ValidationFinding(
                check_id=check_id,
                category=category,
                message=message,
                sheet=sheet_title,
                row=row_number,
                column=header,
            )
        )

    for column in contract.inventory_columns:
        if column.required and not _text(by_column.get(column.column)):
            fail(
                "CONTRACT", CHECK_CATEGORY_COMPLETENESS, "a required value is absent", column.header
            )

    captured_at = _as_date(by_column.get("captured_at"))
    if captured_at is None:
        fail(
            "CONTRACT",
            CHECK_CATEGORY_STRUCTURAL,
            "Captured At is missing or unparseable",
            "Captured At",
        )

    model_year = _as_int(by_column.get("model_year"))
    if model_year is None:
        fail("CONTRACT", CHECK_CATEGORY_STRUCTURAL, "Model Year is not an integer", "Model Year")
    elif not contract.model_year_minimum <= model_year <= contract.model_year_maximum:
        fail(
            "CONTRACT",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Model Year is outside the governed range "
            f"{contract.model_year_minimum}-{contract.model_year_maximum}",
            "Model Year",
        )
    elif captured_at is not None and (
        model_year > captured_at.year + contract.model_year_years_ahead_of_capture
    ):
        fail(
            "CONTRACT",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Model Year is more than {contract.model_year_years_ahead_of_capture} years "
            "beyond the snapshot year",
            "Model Year",
        )

    # Odometer is OPTIONAL by contract: a listing surface that publishes no mileage is
    # a real thing, and the Granite Used Auto Center workbook is entirely made of them.
    # A blank cell is therefore an absence, not a defect. A cell that holds something
    # which is not an integer still is -- "unknown" typed into the column is a value
    # somebody meant, and reading it as NULL would silently discard it.
    raw_odometer = by_column.get("odometer_miles")
    odometer = _as_int(raw_odometer)
    if odometer is None and not _is_blank(raw_odometer):
        fail(
            "DQ-LST-008",
            CHECK_CATEGORY_STRUCTURAL,
            "Odometer Miles is not an integer",
            "Odometer Miles",
        )
    elif odometer is not None and not (
        contract.odometer_minimum <= odometer <= contract.odometer_maximum
    ):
        fail(
            "DQ-LST-008",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Odometer Miles is outside the governed range "
            f"{contract.odometer_minimum}-{contract.odometer_maximum}",
            "Odometer Miles",
        )

    condition = _text(by_column.get("condition_type"))
    if condition and condition not in contract.condition_values:
        fail(
            "DQ-LST-007",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Condition is outside the governed domain ({' | '.join(contract.condition_values)})",
            "Condition",
        )

    pricing_status = _text(by_column.get("pricing_status"))
    if pricing_status and pricing_status not in contract.pricing_status_values:
        fail(
            "DQ-LST-009",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Pricing Status is outside the governed domain "
            f"({' | '.join(contract.pricing_status_values)})",
            "Pricing Status",
        )

    price_cell = by_column.get("advertised_price")
    price = _as_float(price_cell)
    has_price = _text(price_cell) != ""
    if has_price and price is None:
        fail(
            "DQ-LST-009",
            CHECK_CATEGORY_STRUCTURAL,
            "Advertised Price is not a number",
            "Advertised Price",
        )
    elif price is not None and not contract.price_minimum <= price <= contract.price_maximum:
        fail(
            "DQ-LST-009",
            CHECK_CATEGORY_BUSINESS_RULE,
            "Advertised Price is outside the governed range",
            "Advertised Price",
        )
    listed = pricing_status == contract.pricing_status_values[0]
    if contract.listed_requires_price and listed and price is None:
        fail(
            "DQ-LST-009",
            CHECK_CATEGORY_BUSINESS_RULE,
            "Pricing Status is 'Listed' but no advertised price is present",
            "Advertised Price",
        )
    # Read from the contract's declared set rather than testing for a literal status.
    # There are two statuses that forbid a price and there may one day be a third; a
    # chain of string comparisons here is how the fourth one gets missed.
    if pricing_status in contract.statuses_that_forbid_a_price and price is not None:
        fail(
            "DQ-LST-009",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Pricing Status is {pricing_status!r} but an advertised price is present; "
            "the contract does not permit that combination",
            "Advertised Price",
        )

    unit_count = _as_int(by_column.get("inventory_unit_count"))
    if unit_count != contract.inventory_unit_count:
        fail(
            "DQ-LST-010",
            CHECK_CATEGORY_BUSINESS_RULE,
            f"Inventory Unit Count must be exactly {contract.inventory_unit_count}",
            "Inventory Unit Count",
        )

    classification = _text(by_column.get("data_classification"))
    if classification != contract.classification:
        fail(
            "DQ-LST-013",
            CHECK_CATEGORY_PRIVACY,
            f"Data Classification must be {contract.classification!r}",
            "Data Classification",
        )

    for column in contract.inventory_columns:
        cell = by_column.get(column.column)
        if contains_url(cell):
            fail("DQ-LST-006", CHECK_CATEGORY_PRIVACY, "the cell contains a URL", column.header)
        if column.column != "synthetic_vin" and looks_like_a_real_vin(cell):
            fail(
                "DQ-LST-005",
                CHECK_CATEGORY_PRIVACY,
                "the cell holds a seventeen-character value drawn from the real VIN alphabet",
                column.header,
            )
        if column.max_length is not None and len(_text(cell)) > column.max_length:
            fail(
                "CONTRACT",
                CHECK_CATEGORY_STRUCTURAL,
                f"the value exceeds the governed length of {column.max_length}",
                column.header,
            )

    synthetic_vin = _text(by_column.get("synthetic_vin"))
    if synthetic_vin and not synthetic_vin.startswith(contract.vin_prefix):
        fail(
            "DQ-LST-005",
            CHECK_CATEGORY_PRIVACY,
            f"Synthetic VIN must begin {contract.vin_prefix!r}, which is what makes it "
            "impossible for a real VIN",
            "Synthetic VIN",
        )
    synthetic_vehicle_id = _text(by_column.get("synthetic_vehicle_id"))
    if synthetic_vehicle_id and not synthetic_vehicle_id.startswith(contract.vehicle_id_prefix):
        fail(
            "CONTRACT",
            CHECK_CATEGORY_STRUCTURAL,
            f"Synthetic Vehicle ID must begin {contract.vehicle_id_prefix!r}",
            "Synthetic Vehicle ID",
        )

    if len(findings) != before:
        return None

    assert captured_at is not None
    assert model_year is not None
    assert unit_count is not None
    return ListingRecord(
        source_record_id=_text(by_column.get("source_record_id")),
        dealership_id=_text(by_column.get("dealership_id")),
        store_name=_text(by_column.get("store_name")),
        captured_at=captured_at,
        source_batch_id=_text(by_column.get("source_batch_id")),
        source_feed=_text(by_column.get("source_feed")),
        condition_type=condition,
        model_year=model_year,
        make=_text(by_column.get("make")),
        model=_text(by_column.get("model")),
        trim=_text(by_column.get("trim")) or None,
        vehicle_display=_text(by_column.get("vehicle_display")),
        odometer_miles=odometer,
        advertised_price=price,
        pricing_status=pricing_status,
        synthetic_vehicle_id=synthetic_vehicle_id,
        synthetic_vin=synthetic_vin,
        inventory_unit_count=unit_count,
        data_classification=classification,
        row_number=row_number,
    )


def _check_uniqueness(
    records: Sequence[ListingRecord],
    sheet_title: str,
    findings: list[ValidationFinding],
) -> None:
    """Refuse duplicated grains, record identifiers, vehicle identifiers and VINs."""
    rules: tuple[tuple[str, str, Callable[[ListingRecord], Any]], ...] = (
        (
            "DQ-LST-001",
            "declared grain (Dealership ID, Captured At, Synthetic Vehicle ID)",
            lambda r: r.natural_key,
        ),
        ("CONTRACT", "Source Record ID", lambda r: r.source_record_id),
        ("DQ-LST-004", "Synthetic Vehicle ID", lambda r: r.synthetic_vehicle_id),
        ("DQ-LST-004", "Synthetic VIN", lambda r: r.synthetic_vin),
    )
    for check_id, label, key in rules:
        seen: dict[Any, int] = {}
        for record in records:
            value = key(record)
            if value in seen:
                findings.append(
                    ValidationFinding(
                        check_id=check_id,
                        category=CHECK_CATEGORY_UNIQUENESS,
                        message=f"{label} duplicates the value first seen on row {seen[value]}",
                        sheet=sheet_title,
                        row=record.row_number,
                    )
                )
            else:
                seen[value] = record.row_number


def _check_store_agreement(
    records: Sequence[ListingRecord],
    metadata: WorkbookMetadata,
    sheet_title: str,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a workbook whose store or capture date is not constant and registry-backed."""
    if not records:
        return
    dealership_ids = {record.dealership_id for record in records}
    if len(dealership_ids) > 1:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=(
                    f"the Inventory sheet carries {len(dealership_ids)} distinct Dealership "
                    "IDs; one workbook is one store"
                ),
                sheet=sheet_title,
                column="Dealership ID",
            )
        )
    store_names = {record.store_name for record in records}
    if len(store_names) > 1:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=(
                    f"the Inventory sheet carries {len(store_names)} distinct Store Names; "
                    "one workbook is one store"
                ),
                sheet=sheet_title,
                column="Store Name",
            )
        )
    batches = {record.source_batch_id for record in records}
    if len(batches) > 1:
        findings.append(
            ValidationFinding(
                check_id="CONTRACT",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"the Inventory sheet carries {len(batches)} distinct Source Batch IDs. "
                    "One workbook is one batch; a multi-batch workbook needs an explicit "
                    "contract that does not exist"
                ),
                sheet=sheet_title,
                column="Source Batch ID",
            )
        )
    captures = {record.captured_at for record in records}
    if len(captures) > 1:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-012",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"the Inventory sheet carries {len(captures)} distinct Captured At "
                    "values; one workbook is one snapshot"
                ),
                sheet=sheet_title,
                column="Captured At",
            )
        )

    dealership_id = next(iter(sorted(dealership_ids)))
    try:
        store = resolve_store(dealership_id)
    except ValidationError as error:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-002",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=str(error.message),
                sheet=sheet_title,
                column="Dealership ID",
            )
        )
        return

    for record in records:
        if record.store_name != store.store_name:
            findings.append(
                ValidationFinding(
                    check_id="DQ-LST-011",
                    category=CHECK_CATEGORY_REFERENTIAL,
                    message=(
                        f"Store Name disagrees with the dealership registry, which names "
                        f"{dealership_id} {store.store_name!r}"
                    ),
                    sheet=sheet_title,
                    row=record.row_number,
                    column="Store Name",
                )
            )
            break

    if metadata.dealership_id and metadata.dealership_id != dealership_id:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=(
                    f"the README sheet declares dealership {metadata.dealership_id!r} while "
                    f"the Inventory sheet carries {dealership_id!r}"
                ),
                sheet="README",
            )
        )
    if metadata.store_name and metadata.store_name != store.store_name:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=(
                    "the README sheet's Store disagrees with the dealership registry, which "
                    f"names {dealership_id} {store.store_name!r}"
                ),
                sheet="README",
            )
        )
    if _FICTIONAL_GROUP not in metadata.values.get("Dealer group", _FICTIONAL_GROUP):
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_PRIVACY,
                message=(
                    f"the README sheet names a dealer group other than the fictional "
                    f"{_FICTIONAL_GROUP}; a real dealership identity must not be committed"
                ),
                sheet="README",
            )
        )


def _check_metadata(
    metadata: WorkbookMetadata,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a workbook whose ``README`` governance block is absent or wrong."""
    if metadata.classification is None:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-013",
                category=CHECK_CATEGORY_PRIVACY,
                message=(
                    "the README sheet declares no Classification. A reference artifact "
                    "without an explicit classification cannot be committed"
                ),
                sheet="README",
            )
        )
    elif metadata.classification != contract.classification:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-013",
                category=CHECK_CATEGORY_PRIVACY,
                message=(
                    f"the README Classification must be {contract.classification!r}. This "
                    "lane is not fully synthetic and must never be labelled as such"
                ),
                sheet="README",
            )
        )
    if metadata.captured_at is None:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-012",
                category=CHECK_CATEGORY_STRUCTURAL,
                message="the README sheet declares no Snapshot date",
                sheet="README",
            )
        )


def _check_path_and_name(
    path: Path,
    records: Sequence[ListingRecord],
    metadata: WorkbookMetadata,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a file whose name or directory disagrees with its own contents."""
    if not contract.sanitized_regex.match(path.name):
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-016",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"{path.name!r} does not follow the approved ARPI naming convention "
                    f"{contract.sanitized_pattern!r}. Filename words are separated by "
                    "underscores; hyphens appear only inside the ISO date"
                ),
            )
        )

    captured_at = metadata.captured_at or (records[0].captured_at if records else None)
    dealership_id = metadata.dealership_id or (records[0].dealership_id if records else None)
    if captured_at is None or dealership_id is None:
        return

    expected_name = derived_sanitized_file_name(dealership_id, captured_at, contract=contract)
    if path.name != expected_name:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-016",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"the file name does not match its own contents; {dealership_id} on "
                    f"{captured_at.isoformat()} is named {expected_name!r}"
                ),
            )
        )

    parts = path.resolve().parts
    if len(parts) >= _DATE_SEGMENT_DEPTH:
        date_segment = parts[-_DATE_SEGMENT_DEPTH]
        store_segment = parts[-_STORE_SEGMENT_DEPTH] if len(parts) >= _STORE_SEGMENT_DEPTH else ""
        if (
            re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_segment)
            and date_segment != captured_at.isoformat()
        ):
            findings.append(
                ValidationFinding(
                    check_id="DQ-LST-012",
                    category=CHECK_CATEGORY_STRUCTURAL,
                    message=(
                        f"the directory date segment {date_segment!r} disagrees with the "
                        f"workbook's Captured At of {captured_at.isoformat()}"
                    ),
                )
            )
        if (
            store_segment
            and re.fullmatch(r"gsa-\d{3}", store_segment)
            and (store_segment != dealership_id.lower())
        ):
            findings.append(
                ValidationFinding(
                    check_id="DQ-LST-011",
                    category=CHECK_CATEGORY_REFERENTIAL,
                    message=(
                        f"the directory store segment {store_segment!r} disagrees with the "
                        f"workbook's Dealership ID of {dealership_id}"
                    ),
                )
            )


def _check_recommended_path(
    path: Path,
    metadata: WorkbookMetadata,
    records: Sequence[ListingRecord],
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a workbook that recommends a repository path other than its own.

    The ``README`` sheet's "Recommended repository path" is the line an operator follows
    when deciding where to commit the file. A workbook that names a path other than the
    one it actually occupies -- lowercased, hyphenated, or simply wrong -- would teach the
    approved convention away, one commit at a time.

    One artifact is exempt: the hand-produced Granite Chevrolet workbook, whose hint
    predates the naming decision. The exemption is keyed to the artifact's declared
    digest in ``config/reference/inventory_listing_contract.yaml``, so it covers those
    exact bytes and nothing else. A new workbook carrying the same stale hint is refused.
    """
    recommended = metadata.values.get("Recommended repository path")
    if not recommended:
        return
    if _recommends_this_file(recommended, path):
        return

    captured_at = metadata.captured_at or (records[0].captured_at if records else None)
    dealership_id = metadata.dealership_id or (records[0].dealership_id if records else None)
    if captured_at is not None and dealership_id is not None:
        artifact = contract.artifact_for(dealership_id, captured_at)
        if (
            artifact is not None
            and artifact.legacy_path_hint == recommended
            and artifact.sha256 == file_digest(path)
        ):
            return

    findings.append(
        ValidationFinding(
            check_id="DQ-LST-016",
            category=CHECK_CATEGORY_STRUCTURAL,
            message=(
                "the README sheet recommends a repository path that is not the path this "
                "workbook occupies. The approved convention is "
                f"{contract.reference_root}/<dealership-id lowercased>/<yyyy-mm-dd>/"
                f"{contract.sanitized_pattern}"
            ),
            sheet="README",
        )
    )


def _recommends_this_file(recommended: str, path: Path) -> bool:
    """Whether a README's recommended path names the file at ``path``.

    Compared by SUFFIX rather than by equality. The recommended path is always
    repository-relative, and the path being validated is whatever the caller supplied:
    the CLI passes a relative path and a test passes an absolute one. Comparing the two
    literally made a workbook's validity depend on how somebody spelled its path on the
    command line, which is not a property of the workbook.

    Matching on whole path segments rather than on the raw string is what keeps this from
    being a substring check: ``.../gsa-002/2026-08-02/X.xlsx`` must not satisfy a
    recommendation of ``.../other-gsa-002/2026-08-02/X.xlsx``.
    """
    wanted = PurePosixPath(recommended.strip()).parts
    actual = PurePosixPath(path.as_posix()).parts
    return len(actual) >= len(wanted) and actual[-len(wanted) :] == wanted


def _check_no_alias(
    path: Path,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a snapshot directory that holds more than one workbook.

    A duplicate or alias copy of a canonical artifact -- hyphenated, lowercased, or simply
    a second upload -- is exactly what DQ-LST-017 exists to catch, and a directory listing
    is the cheapest place to catch it.
    """
    directory = path.parent
    if not directory.is_dir():
        return
    siblings = sorted(
        candidate.name
        for candidate in directory.iterdir()
        if candidate.is_file() and candidate.suffix.lower() in {".xlsx", ".xlsm", ".xls"}
    )
    if len(siblings) > 1:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-017",
                category=CHECK_CATEGORY_UNIQUENESS,
                message=(
                    f"{directory.as_posix()} holds {len(siblings)} workbooks "
                    f"({', '.join(siblings)}). One store and one snapshot date have exactly "
                    f"one canonical artifact; the approved name is "
                    f"{contract.sanitized_pattern!r} and no duplicate or alias copy may exist"
                ),
            )
        )


def _check_supporting_sheets(
    path: Path,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Refuse a workbook whose Summary and Model Summary carry no formulas.

    The governed workbook is formula-driven so a dealership user can re-filter the
    Inventory sheet and watch the summaries move. A summary of hard-coded numbers looks
    identical and silently stops agreeing with the data the first time anyone edits it.
    """
    with open_with_formulas(path) as workbook:
        for key in ("summary", "model_summary"):
            title = contract.sheets[key]
            if title not in workbook.sheetnames:
                continue
            has_formula = any(
                isinstance(cell, str) and cell.startswith("=")
                for row in workbook[title].iter_rows(values_only=True)
                for cell in row
            )
            if not has_formula:
                findings.append(
                    ValidationFinding(
                        check_id="CONTRACT",
                        category=CHECK_CATEGORY_STRUCTURAL,
                        message=(
                            "the sheet carries no formula. Governed summaries are "
                            "formula-driven so they cannot silently disagree with the "
                            "Inventory sheet"
                        ),
                        sheet=title,
                    )
                )


def _check_every_cell_for_leaks(
    path: Path,
    contract: InventoryListingContract,
    findings: list[ValidationFinding],
) -> None:
    """Sweep every sheet -- not only Inventory -- for a URL or a real VIN.

    The Inventory row check is per-column and typed. This is the blunt second pass that
    covers the README prose, the Summary notice and any sheet a future contract adds.
    """
    with open_read_only(path) as workbook:
        for title in workbook.sheetnames:
            for row_index, row in enumerate(workbook[title].iter_rows(values_only=True), start=1):
                for value in row:
                    if contains_url(value):
                        findings.append(
                            ValidationFinding(
                                check_id="DQ-LST-006",
                                category=CHECK_CATEGORY_PRIVACY,
                                message="the cell contains a URL",
                                sheet=title,
                                row=row_index,
                            )
                        )
                    if title != contract.sheets["inventory"] and looks_like_a_real_vin(value):
                        findings.append(
                            ValidationFinding(
                                check_id="DQ-LST-005",
                                category=CHECK_CATEGORY_PRIVACY,
                                message=(
                                    "the cell holds a seventeen-character value drawn from "
                                    "the real VIN alphabet"
                                ),
                                sheet=title,
                                row=row_index,
                            )
                        )


def validate_workbook(
    path: Path,
    *,
    contract: InventoryListingContract | None = None,
    expect_dealership: str | None = None,
    expect_captured_at: date | None = None,
) -> WorkbookValidationResult:
    """Validate one sanitized listing workbook against the governed contract.

    Args:
        path: Workbook to validate.
        contract: Contract to validate against. Defaults to the repository contract.
        expect_dealership: Store the caller expects. A disagreement is a refusal.
        expect_captured_at: Snapshot date the caller expects. A disagreement is a refusal.

    Returns:
        The result. ``is_valid`` is ``False`` when any finding was recorded; the caller
        decides whether to raise, and every CLI entry point does.

    Raises:
        ValidationError: If the file cannot be opened at all.
    """
    active = contract or load_contract()
    findings: list[ValidationFinding] = []
    records: tuple[ListingRecord, ...] = ()
    metadata = WorkbookMetadata(None, None, None, None, None)

    with open_read_only(path) as workbook:
        if _check_sheet_contract(workbook, active, findings):
            metadata = _read_metadata(_read_readme_rows(path, active.sheets["readme"]))
            inventory = read_sheet_rows(workbook, active.sheets["inventory"])
            if _check_header_contract(inventory, active, findings):
                typed = [
                    _typed_record(
                        row,
                        row_number=index,
                        sheet_title=inventory.title,
                        contract=active,
                        findings=findings,
                    )
                    for index, row in enumerate(inventory.rows, start=1)
                ]
                records = tuple(record for record in typed if record is not None)

    if records:
        _check_uniqueness(records, active.sheets["inventory"], findings)
        _check_store_agreement(records, metadata, active.sheets["inventory"], findings)
    _check_metadata(metadata, active, findings)
    _check_path_and_name(path, records, metadata, active, findings)
    _check_recommended_path(path, metadata, records, active, findings)
    _check_no_alias(path, active, findings)
    if not any(finding.check_id == "CONTRACT" and finding.row is None for finding in findings):
        _check_supporting_sheets(path, active, findings)
    _check_every_cell_for_leaks(path, active, findings)

    if expect_dealership and records and records[0].dealership_id != expect_dealership.upper():
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-011",
                category=CHECK_CATEGORY_REFERENTIAL,
                message=(
                    f"the workbook belongs to {records[0].dealership_id} but "
                    f"{expect_dealership.upper()} was requested"
                ),
            )
        )
    if expect_captured_at and records and records[0].captured_at != expect_captured_at:
        findings.append(
            ValidationFinding(
                check_id="DQ-LST-012",
                category=CHECK_CATEGORY_STRUCTURAL,
                message=(
                    f"the workbook was captured on {records[0].captured_at.isoformat()} but "
                    f"{expect_captured_at.isoformat()} was requested"
                ),
            )
        )

    return WorkbookValidationResult(
        path=path,
        digest=file_digest(path),
        metadata=metadata,
        records=records,
        findings=tuple(findings),
        checks_run=WORKBOOK_CHECK_IDS,
    )


def read_listing_records(
    path: Path,
    *,
    contract: InventoryListingContract | None = None,
    expect_dealership: str | None = None,
    expect_captured_at: date | None = None,
) -> WorkbookValidationResult:
    """Validate a workbook and refuse to return records unless it passed.

    This is the importer's only entry point into a workbook. Reading and validating are
    the same operation on purpose: a caller cannot obtain rows from a workbook that failed
    validation, so no code path exists that imports an unvalidated artifact.

    Args:
        path: Workbook to read.
        contract: Contract to validate against.
        expect_dealership: Store the caller expects.
        expect_captured_at: Snapshot date the caller expects.

    Returns:
        The passing validation result, records included.

    Raises:
        ValidationError: If the workbook failed validation. The message lists every
            redacted finding.
    """
    result = validate_workbook(
        path,
        contract=contract,
        expect_dealership=expect_dealership,
        expect_captured_at=expect_captured_at,
    )
    if not result.is_valid:
        rendered = "\n  ".join(finding.render() for finding in result.findings)
        raise ValidationError(
            f"{path.name} does not satisfy the sanitized listing workbook contract; "
            f"{len(result.findings)} finding(s):\n  {rendered}",
            field="workbook",
        )
    return result


def check_ids(scope: str | None = None) -> tuple[str, ...]:
    """Return the registered check identifiers, optionally filtered by scope.

    Args:
        scope: ``workbook``, ``database``, or ``None`` for all of them.

    Returns:
        The identifiers, in registration order.
    """
    return tuple(
        check.check_id for check in LISTING_CHECKS if scope is None or check.scope == scope
    )


def iter_findings(results: Iterable[WorkbookValidationResult]) -> Iterable[ValidationFinding]:
    """Flatten the findings of several validation results, in order."""
    for result in results:
        yield from result.findings
