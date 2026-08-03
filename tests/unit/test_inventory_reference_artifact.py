"""The committed Granite Chevrolet artifact, asserted directly.

Every other test in this lane exercises code against a fixture it built itself. This one
opens the file that is actually in the repository and asserts what it contains, because
the artifact is the evidence and a test that never reads it proves nothing about it.

The file name is spelled out rather than derived, in several tests, on purpose. It is the
one string in this project that has been decided and must not move.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from arpi.inventory.contract import InventoryListingContract, load_contract
from arpi.inventory.spec import resolve_store
from arpi.inventory.validation import (
    WorkbookValidationResult,
    contains_url,
    file_digest,
    looks_like_a_real_vin,
    validate_workbook,
)
from arpi.inventory.workbook import open_read_only, read_sheet_rows

REPO_ROOT = Path(__file__).resolve().parents[2]

#: The canonical artifact. This spelling is final.
CANONICAL_NAME = "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
CANONICAL_PATH = (
    REPO_ROOT / "data" / "reference" / "inventory" / "gsa-001" / "2026-08-02" / CANONICAL_NAME
)

EXPECTED_ROWS = 199
EXPECTED_NEW = 195
EXPECTED_USED = 4
EXPECTED_LISTED = 197
EXPECTED_CALL_FOR_PRICE = 2


@pytest.fixture(scope="module")
def result() -> WorkbookValidationResult:
    return validate_workbook(CANONICAL_PATH)


@pytest.fixture(scope="module")
def rows() -> tuple[tuple[Any, ...], ...]:
    with open_read_only(CANONICAL_PATH) as book:
        return read_sheet_rows(book, "Inventory").rows


@pytest.fixture(scope="module")
def every_string() -> tuple[str, ...]:
    with open_read_only(CANONICAL_PATH) as book:
        return tuple(
            str(value)
            for name in book.sheetnames
            for row in book[name].iter_rows(values_only=True)
            for value in row
            if value is not None
        )


def _column(contract: InventoryListingContract, header: str) -> int:
    return contract.headers.index(header)


# --------------------------------------------------------------------------------------
# Existence, naming, and the absence of a duplicate
# --------------------------------------------------------------------------------------


def test_the_canonical_workbook_exists_at_its_exact_path() -> None:
    assert CANONICAL_PATH.is_file()
    assert CANONICAL_PATH.name == CANONICAL_NAME


def test_the_canonical_name_uses_underscores_and_only_dates_use_hyphens() -> None:
    assert "_" in CANONICAL_NAME
    assert CANONICAL_NAME.count("-") == 2
    assert CANONICAL_NAME.startswith("ARPI_")
    assert CANONICAL_NAME.endswith("_2026-08-02.xlsx")
    assert CANONICAL_NAME.lower() != CANONICAL_NAME


def test_no_competing_workbook_exists_for_this_store_and_snapshot() -> None:
    siblings = sorted(
        path.name
        for path in CANONICAL_PATH.parent.iterdir()
        if path.is_file() and path.suffix.lower() in {".xlsx", ".xlsm", ".xls"}
    )
    assert siblings == [CANONICAL_NAME]


def test_no_hyphenated_duplicate_exists_anywhere_in_the_repository() -> None:
    """The specific alias the naming decision was made against."""
    matches = [
        path.relative_to(REPO_ROOT).as_posix()
        for path in REPO_ROOT.rglob("*.xlsx")
        if ".git" not in path.parts
        and "node_modules" not in path.parts
        and "-inventory-sanitized" in path.name.casefold()
    ]
    assert matches == []


def test_no_second_copy_of_the_canonical_file_exists() -> None:
    """Including at the repository root, where an upload once put one."""
    matches = [
        path.relative_to(REPO_ROOT).as_posix()
        for path in REPO_ROOT.rglob(CANONICAL_NAME)
        if ".git" not in path.parts
    ]
    assert matches == [CANONICAL_PATH.relative_to(REPO_ROOT).as_posix()]


def test_the_artifact_is_declared_in_the_contract_with_a_matching_digest() -> None:
    contract = load_contract()
    declared = contract.artifact_for("GSA-001", date(2026, 8, 2))
    assert declared is not None
    assert declared.file_name == CANONICAL_NAME
    assert declared.path == CANONICAL_PATH.relative_to(REPO_ROOT).as_posix()
    assert declared.row_count == EXPECTED_ROWS
    assert declared.sha256 == file_digest(CANONICAL_PATH)


# --------------------------------------------------------------------------------------
# The workbook contract
# --------------------------------------------------------------------------------------


def test_the_committed_workbook_passes_every_workbook_check(
    result: WorkbookValidationResult,
) -> None:
    assert result.is_valid, result.summary()
    assert len(result.checks_run) == 14


def test_the_workbook_holds_exactly_199_inventory_rows(result: WorkbookValidationResult) -> None:
    assert result.row_count == EXPECTED_ROWS


def test_the_workbook_has_the_four_required_sheets() -> None:
    with open_read_only(CANONICAL_PATH) as book:
        assert book.sheetnames == ["README", "Summary", "Inventory", "Model Summary"]


def test_the_workbook_declares_the_approved_classification(
    result: WorkbookValidationResult,
) -> None:
    assert result.metadata.classification == "Sanitized public reference data"


def test_the_workbook_metadata_agrees_with_the_dealership_registry(
    result: WorkbookValidationResult,
) -> None:
    store = resolve_store("GSA-001")
    assert result.metadata.dealership_id == store.dealership_id
    assert result.metadata.store_name == store.store_name
    # Optional by type -- a workbook may declare no snapshot date -- and present here,
    # which is what a passing DQ-LST-012 means.
    assert result.metadata.captured_at is not None
    assert result.metadata.captured_at.isoformat() == "2026-08-02"


def test_the_filename_date_agrees_with_the_workbook(result: WorkbookValidationResult) -> None:
    assert result.metadata.captured_at is not None
    assert result.metadata.captured_at.isoformat() in CANONICAL_NAME
    assert CANONICAL_PATH.parent.name == result.metadata.captured_at.isoformat()
    assert CANONICAL_PATH.parent.parent.name == "gsa-001"


# --------------------------------------------------------------------------------------
# Identity and privacy
# --------------------------------------------------------------------------------------


def test_all_199_synthetic_vehicle_identifiers_are_unique(result: WorkbookValidationResult) -> None:
    identifiers = [record.synthetic_vehicle_id for record in result.records]
    assert len(identifiers) == EXPECTED_ROWS
    assert len(set(identifiers)) == EXPECTED_ROWS


def test_all_199_synthetic_vins_are_unique(result: WorkbookValidationResult) -> None:
    vins = [record.synthetic_vin for record in result.records]
    assert len(set(vins)) == EXPECTED_ROWS
    assert all(vin.startswith("ARPI") for vin in vins)
    assert all(len(vin) == 17 for vin in vins)


def test_all_199_source_record_identifiers_are_unique(result: WorkbookValidationResult) -> None:
    identifiers = [record.source_record_id for record in result.records]
    assert len(set(identifiers)) == EXPECTED_ROWS


def test_no_url_appears_on_any_sheet(every_string: tuple[str, ...]) -> None:
    offending = [value for value in every_string if contains_url(value)]
    assert offending == []


def test_no_original_vin_column_exists() -> None:
    contract = load_contract()
    with open_read_only(CANONICAL_PATH) as book:
        headers = read_sheet_rows(book, "Inventory").headers
    assert "VIN" not in headers
    assert "Source URL" not in headers
    assert tuple(headers) == contract.headers


def test_no_value_anywhere_looks_like_a_real_vin(every_string: tuple[str, ...]) -> None:
    offending = [value for value in every_string if looks_like_a_real_vin(value)]
    assert offending == []


def test_no_real_dealer_name_appears(every_string: tuple[str, ...]) -> None:
    """The rule is positive: the only store named is the fictional one."""
    rendered = " ".join(every_string)
    assert "Granite Chevrolet of Nashua" in rendered
    assert "Granite Auto Group" in rendered
    # A store name is one of the three fictional ones, or it is not a store name.
    contract = load_contract()
    with open_read_only(CANONICAL_PATH) as book:
        rows = read_sheet_rows(book, "Inventory").rows
    store_column = _column(contract, "Store Name")
    assert {str(row[store_column]) for row in rows} == {"Granite Chevrolet of Nashua"}


def test_no_street_address_appears(every_string: tuple[str, ...]) -> None:
    """Geography stops at store name and market region, so no street line can be there."""
    street = re.compile(
        r"\b\d{1,6}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Turnpike|Highway|Hwy)\b"
    )
    offending = [value for value in every_string if street.search(value)]
    assert offending == []


# --------------------------------------------------------------------------------------
# The numbers the portfolio is allowed to display
# --------------------------------------------------------------------------------------


def test_the_condition_split_is_195_new_and_4_used(result: WorkbookValidationResult) -> None:
    counts = Counter(record.condition_type for record in result.records)
    assert counts["New"] == EXPECTED_NEW
    assert counts["Used"] == EXPECTED_USED
    assert sum(counts.values()) == EXPECTED_ROWS


def test_the_pricing_split_is_197_listed_and_2_call_for_price(
    result: WorkbookValidationResult,
) -> None:
    counts = Counter(record.pricing_status for record in result.records)
    assert counts["Listed"] == EXPECTED_LISTED
    assert counts["Call for price"] == EXPECTED_CALL_FOR_PRICE
    assert sum(counts.values()) == EXPECTED_ROWS


def test_every_listed_row_carries_a_price_and_every_call_for_price_row_does_not(
    result: WorkbookValidationResult,
) -> None:
    for record in result.records:
        if record.pricing_status == "Listed":
            assert record.advertised_price is not None
            assert record.advertised_price >= 0
        else:
            assert record.advertised_price is None


def test_every_row_has_an_inventory_unit_count_of_one(result: WorkbookValidationResult) -> None:
    assert {record.inventory_unit_count for record in result.records} == {1}


def test_no_mileage_is_negative(result: WorkbookValidationResult) -> None:
    """Mileage is optional, so the assertion is about the readings that exist.

    A listing that publishes no mileage carries ``None``, which is not a reading and not
    a zero. Comparing it against zero would be asserting something about an absence.
    """
    readings = [
        record.odometer_miles for record in result.records if record.odometer_miles is not None
    ]
    assert readings, "the Granite Chevrolet artifact publishes a reading on every row"
    assert min(readings) >= 0


def test_the_totals_reconcile_between_the_split_and_the_whole(
    result: WorkbookValidationResult,
) -> None:
    """Technical evidence about the artifact, not a finding about a dealership."""
    listed = [r for r in result.records if r.pricing_status == "Listed"]
    total = sum(r.advertised_price or 0 for r in result.records)
    assert total == sum(r.advertised_price or 0 for r in listed)
    assert len(listed) == EXPECTED_LISTED


def test_one_store_one_capture_one_batch(result: WorkbookValidationResult) -> None:
    assert {r.dealership_id for r in result.records} == {"GSA-001"}
    assert {r.captured_at.isoformat() for r in result.records} == {"2026-08-02"}
    assert {r.source_batch_id for r in result.records} == {"GSA001-20260802-001"}
    assert {r.source_feed for r in result.records} == {"sanitized_public_inventory_reference"}


def _portfolio_content() -> dict[str, Any]:
    import json

    return json.loads(  # type: ignore[no-any-return]
        (REPO_ROOT / "portfolio" / "src" / "content" / "inventory-operations.json").read_text(
            encoding="utf-8"
        )
    )


def test_the_portfolio_content_agrees_with_the_artifact() -> None:
    """The website's counts are read from the same file this test just counted."""
    artifact = _portfolio_content()["artifact"]
    assert artifact["fileName"] == CANONICAL_NAME
    assert artifact["path"] == CANONICAL_PATH.relative_to(REPO_ROOT).as_posix()
    assert artifact["rows"] == EXPECTED_ROWS
    assert artifact["newUnits"] == EXPECTED_NEW
    assert artifact["usedUnits"] == EXPECTED_USED
    assert artifact["listedPriceUnits"] == EXPECTED_LISTED
    assert artifact["callForPriceUnits"] == EXPECTED_CALL_FOR_PRICE
    assert artifact["classification"] == "Sanitized public reference data"


def test_the_website_shows_every_committed_artifact_and_no_others() -> None:
    """A store whose workbook is committed but not shown is the quiet failure here.

    The page's headline sums the cards, so an artifact missing from the content file
    would produce a smaller, entirely plausible total that nothing else contradicts.
    """
    declared = load_contract().canonical_artifacts
    shown = _portfolio_content()["artifacts"]

    assert [entry["dealershipId"] for entry in shown] == [a.dealership_id for a in declared]
    for entry, artifact in zip(shown, declared, strict=True):
        assert entry["fileName"] == artifact.file_name
        assert entry["path"] == artifact.path
        assert entry["rows"] == artifact.row_count
        assert entry["classification"] == "Sanitized public reference data"


def test_the_website_repeats_every_declared_coverage_caveat() -> None:
    """A partial capture must say so where it is read, not only in the contract.

    Granite Subaru's 24 rows are a count of what the capture could see. Shown beside two
    stores holding 199 and 318 with no caveat, that number reads as a small store.
    """
    declared = {a.dealership_id: a for a in load_contract().canonical_artifacts}
    for entry in _portfolio_content()["artifacts"]:
        artifact = declared[entry["dealershipId"]]
        assert entry["coverage"] == artifact.coverage
        if artifact.is_partial:
            assert entry.get("coverageNote"), f"{artifact.file_name} is partial and says nothing"


@pytest.mark.parametrize("dealership_id", ["GSA-001", "GSA-002", "GSA-003"])
def test_every_shown_count_matches_the_workbook_it_describes(dealership_id: str) -> None:
    """Counted from the committed bytes, not copied from the contract.

    The contract declares a row count; these counts are conditions, pricing statuses and
    missing odometer readings, which nothing else re-derives. Reading the workbook is the
    only way this test can disagree with the website, and disagreeing is its whole job.
    """
    artifact = next(
        a for a in load_contract().canonical_artifacts if a.dealership_id == dealership_id
    )
    result = validate_workbook(REPO_ROOT / artifact.path)
    assert result.is_valid, result.summary()

    condition = Counter(record.condition_type for record in result.records)
    status = Counter(record.pricing_status for record in result.records)
    shown = next(
        entry
        for entry in _portfolio_content()["artifacts"]
        if entry["dealershipId"] == dealership_id
    )

    assert shown["rows"] == len(result.records)
    assert shown["newUnits"] == condition["New"]
    assert shown["usedUnits"] == condition["Used"]
    assert shown["listedPriceUnits"] == status["Listed"]
    assert shown["callForPriceUnits"] == status["Call for price"]
    assert shown["priceNotExposedUnits"] == status["Price not exposed"]
    assert shown["noOdometerUnits"] == sum(
        1 for record in result.records if record.odometer_miles is None
    )


@pytest.mark.parametrize("dealership_id", ["GSA-001", "GSA-002", "GSA-003"])
def test_validity_does_not_depend_on_how_the_path_was_spelled(dealership_id: str) -> None:
    """A workbook is valid or it is not. How the caller typed its path is not a property of it.

    DQ-LST-016 compares the README's recommended repository path against the path being
    validated, and the recommended path is always repository-relative. Comparing the two
    literally meant `arpi validate-inventory data/reference/...` passed while the same
    workbook validated by absolute path was refused -- a refusal that named the workbook
    for a defect belonging to the command line.
    """
    artifact = next(
        a for a in load_contract().canonical_artifacts if a.dealership_id == dealership_id
    )
    absolute = validate_workbook(REPO_ROOT / artifact.path)
    relative = validate_workbook(Path(artifact.path))

    assert absolute.is_valid, absolute.summary()
    assert relative.is_valid, relative.summary()
    assert [f.check_id for f in absolute.findings] == [f.check_id for f in relative.findings]


def test_a_franchise_store_legitimately_lists_other_makes(result: WorkbookValidationResult) -> None:
    """The lane knows nothing about franchise brands, and the artifact proves it matters.

    Granite Chevrolet's committed snapshot carries used units from four other makes. A
    validator that enforced "a Chevrolet store lists Chevrolets" would reject a correct
    workbook, which is why no such rule exists.
    """
    makes = {record.make for record in result.records}
    assert "Chevrolet" in makes
    assert len(makes) > 1
    used_makes = {record.make for record in result.records if record.condition_type == "Used"}
    assert used_makes - {"Chevrolet"}
