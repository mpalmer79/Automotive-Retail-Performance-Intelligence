"""The versioned workbook contract, the identity function, and the naming convention.

These three are tested together because they are the parts of the lane that everything
else is written against: the sanitizer writes to them, the validator refuses against them,
the importer types against them, and CI enforces them. A defect here is invisible in every
other test, because every other test would agree with it.

The naming assertions are deliberately literal. ``ARPI_Granite_Chevrolet_Inventory_
Sanitized_2026-08-02.xlsx`` is spelled out rather than derived, so a broken derivation
cannot pass by agreeing with itself.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import pytest

from arpi.exceptions import ConfigurationError, ValidationError
from arpi.inventory.contract import (
    CONTRACT_PATH,
    InventoryListingContract,
    load_contract,
    normalise_header,
)
from arpi.inventory.identity import (
    default_output_path,
    derived_report_file_name,
    derived_sanitized_file_name,
    reference_directory,
    source_batch_id,
    source_record_id,
    synthetic_identity,
)
from arpi.inventory.spec import known_dealership_ids, resolve_store, source_for
from arpi.inventory.validation import LISTING_CHECKS, contains_url, looks_like_a_real_vin

REPO_ROOT = Path(__file__).resolve().parents[2]

#: The canonical Granite Chevrolet artifact, spelled out. This name is final.
CANONICAL_NAME = "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
CANONICAL_PATH = (
    "data/reference/inventory/gsa-001/2026-08-02/"
    "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
)

#: A throwaway identifier used only to exercise the hash. It is not a real VIN and is
#: not drawn from any source: `I` is not in the VIN alphabet, so it cannot be one.
SAMPLE_IDENTIFIER = "TESTIDENTIFIER001"


@pytest.fixture(scope="module")
def contract() -> InventoryListingContract:
    return load_contract()


# --------------------------------------------------------------------------------------
# The contract loads and is internally consistent
# --------------------------------------------------------------------------------------


def test_the_contract_file_exists_and_loads(contract: InventoryListingContract) -> None:
    assert CONTRACT_PATH.is_file()
    assert contract.contract_version
    assert contract.classification == "Sanitized public reference data"


def test_the_classification_is_never_the_word_synthetic(contract: InventoryListingContract) -> None:
    """The lane is not synthetic, and the one approved value must not suggest it is."""
    assert "synthetic" not in contract.classification.casefold()


def test_the_inventory_contract_declares_the_nineteen_sanitized_columns(
    contract: InventoryListingContract,
) -> None:
    assert contract.headers == (
        "Source Record ID",
        "Dealership ID",
        "Store Name",
        "Captured At",
        "Source Batch ID",
        "Source Feed",
        "Condition",
        "Model Year",
        "Make",
        "Model",
        "Trim",
        "Vehicle Display",
        "Odometer Miles",
        "Advertised Price",
        "Pricing Status",
        "Synthetic Vehicle ID",
        "Synthetic VIN",
        "Inventory Unit Count",
        "Data Classification",
    )


def test_no_declared_column_is_a_prohibited_one(contract: InventoryListingContract) -> None:
    """An original VIN column and a source URL column must be impossible to declare."""
    declared = {normalise_header(header) for header in contract.headers}
    assert not declared & contract.prohibited_headers
    assert "vin" in contract.prohibited_headers
    assert "source_url" in contract.prohibited_headers
    # `synthetic_vin` is the approved column and must not be caught by the `vin` rule,
    # which matches exactly rather than by substring.
    assert "synthetic_vin" not in contract.prohibited_headers


def test_the_four_required_sheets_are_declared_in_workbook_order(
    contract: InventoryListingContract,
) -> None:
    assert contract.required_sheets == ("README", "Summary", "Inventory", "Model Summary")
    assert contract.optional_sheets["snapshot_changes"] == "Snapshot Changes"


def test_call_for_price_may_not_carry_a_price(contract: InventoryListingContract) -> None:
    """The explicit, documented switch. Admitting a price would double-count a vehicle."""
    assert contract.listed_requires_price is True
    assert contract.call_for_price_allows_price is False


def test_the_controlled_vocabularies_are_exactly_two_values_each(
    contract: InventoryListingContract,
) -> None:
    assert contract.condition_values == ("New", "Used")
    assert contract.pricing_status_values == ("Listed", "Call for price")


def test_the_canonical_artifact_is_declared_with_its_digest(
    contract: InventoryListingContract,
) -> None:
    artifact = contract.artifact_for("GSA-001", date(2026, 8, 2))
    assert artifact is not None
    assert artifact.file_name == CANONICAL_NAME
    assert artifact.path == CANONICAL_PATH
    assert artifact.row_count == 199
    assert re.fullmatch(r"[0-9a-f]{64}", artifact.sha256)


def test_a_missing_contract_is_refused_rather_than_guessed(tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError, match="was not found"):
        load_contract(tmp_path / "nope.yaml")


# --------------------------------------------------------------------------------------
# Deterministic, group-stable identity
# --------------------------------------------------------------------------------------


def test_identity_is_deterministic() -> None:
    first = synthetic_identity(SAMPLE_IDENTIFIER)
    second = synthetic_identity(SAMPLE_IDENTIFIER)
    assert first == second


def test_identity_ignores_case_and_surrounding_whitespace() -> None:
    """A source that pads or lowercases an identifier must not create a second vehicle."""
    assert synthetic_identity(f"  {SAMPLE_IDENTIFIER.lower()} ") == synthetic_identity(
        SAMPLE_IDENTIFIER
    )


def test_different_identifiers_produce_different_identities() -> None:
    assert synthetic_identity(SAMPLE_IDENTIFIER) != synthetic_identity("TESTIDENTIFIER002")


def test_identity_is_group_stable_and_not_store_scoped() -> None:
    """One physical vehicle observed at two stores resolves to one identity.

    That is what makes a cross-store appearance DETECTABLE. It does not make it
    explained: ARPI holds no dealer-trade event and must not infer one.
    """
    # There is no store argument to pass, and that absence is the property being
    # asserted -- a store-scoped namespace could not be tested for this at all.
    assert "GSA-001" not in load_contract().identity_namespace
    assert "GSA" in load_contract().identity_namespace


def test_the_synthetic_vin_can_never_be_a_real_vin() -> None:
    """The ARPI prefix contains I, which the ISO 3779 alphabet excludes."""
    identity = synthetic_identity(SAMPLE_IDENTIFIER)
    assert identity.vin.startswith("ARPI")
    assert len(identity.vin) == 17
    assert looks_like_a_real_vin(identity.vin) is False


def test_the_vehicle_identifier_has_the_declared_shape() -> None:
    identity = synthetic_identity(SAMPLE_IDENTIFIER)
    assert identity.vehicle_id.startswith("VEH-")
    assert re.fullmatch(r"VEH-[0-9A-F]{12}", identity.vehicle_id)
    # Both are cut from the same digest, so the shorter is a prefix of the longer.
    assert identity.vin[4:].startswith(identity.vehicle_id[4:])


def test_a_blank_identifier_is_refused_without_quoting_it() -> None:
    with pytest.raises(ValidationError) as error:
        synthetic_identity("   ")
    assert "blank" in str(error.value)


# --------------------------------------------------------------------------------------
# The approved underscore-based naming convention
# --------------------------------------------------------------------------------------


def test_the_derived_granite_chevrolet_name_is_exactly_the_canonical_one() -> None:
    assert derived_sanitized_file_name("GSA-001", date(2026, 8, 2)) == CANONICAL_NAME


def test_the_derived_name_is_never_lowercase_or_hyphenated() -> None:
    derived = derived_sanitized_file_name("GSA-001", date(2026, 8, 2))
    assert derived != derived.lower()
    assert derived != "granite-chevrolet-inventory-sanitized.xlsx"
    # Hyphens appear only inside the ISO date: exactly two of them.
    assert derived.count("-") == 2
    assert "_" in derived


def test_the_subaru_name_follows_the_same_convention() -> None:
    assert (
        derived_sanitized_file_name("GSA-002", date(2026, 8, 9))
        == "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-09.xlsx"
    )


def test_the_used_store_also_has_a_declared_descriptor() -> None:
    assert (
        derived_sanitized_file_name("GSA-003", date(2026, 8, 9))
        == "ARPI_Granite_Used_Auto_Center_Inventory_Sanitized_2026-08-09.xlsx"
    )


def test_all_three_stores_derive_their_governed_path_and_name() -> None:
    """One store, one directory, one name -- for every store, not only the committed one.

    Spelled out rather than derived. These are the paths a future Subaru or Used Auto
    capture must occupy, and a workbook filed under another store's directory is refused
    by `scripts/check_reference_data.py` even when it is the only file there.
    """
    captured = date(2026, 8, 2)
    expected = {
        "GSA-001": (
            "data/reference/inventory/gsa-001/2026-08-02/"
            "ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx"
        ),
        "GSA-002": (
            "data/reference/inventory/gsa-002/2026-08-02/"
            "ARPI_Granite_Subaru_Inventory_Sanitized_2026-08-02.xlsx"
        ),
        "GSA-003": (
            "data/reference/inventory/gsa-003/2026-08-02/"
            "ARPI_Granite_Used_Auto_Center_Inventory_Sanitized_2026-08-02.xlsx"
        ),
    }
    for dealership, path in expected.items():
        assert default_output_path(dealership, captured).as_posix() == path
    # Three stores, three distinct directories. None of them shares one.
    directories = {Path(path).parent for path in expected.values()}
    assert len(directories) == len(expected)


def test_only_the_chevrolet_artifact_is_committed(contract: InventoryListingContract) -> None:
    """Subaru and Used Auto are conventions, not promises that a file exists.

    ADR-0011 admits an artifact only once a real capture has been sanitized and reviewed.
    Generating one in advance would put a file in the reference lane that has been through
    none of the controls.
    """
    assert [a.dealership_id for a in contract.canonical_artifacts] == ["GSA-001"]
    for dealership in ("GSA-002", "GSA-003"):
        assert not (REPO_ROOT / "data" / "reference" / "inventory" / dealership.lower()).exists()


def test_the_report_name_uses_the_same_convention_with_a_different_word() -> None:
    assert (
        derived_report_file_name("GSA-001", date(2026, 8, 2))
        == "ARPI_Granite_Chevrolet_Inventory_Report_2026-08-02.xlsx"
    )


def test_every_derived_name_matches_the_contract_regex(contract: InventoryListingContract) -> None:
    for dealership in known_dealership_ids():
        sanitized = derived_sanitized_file_name(dealership, date(2026, 8, 2))
        report = derived_report_file_name(dealership, date(2026, 8, 2))
        assert contract.sanitized_regex.match(sanitized)
        assert contract.report_regex.match(report)
        # And the two conventions do not collide.
        assert not contract.sanitized_regex.match(report)
        assert not contract.report_regex.match(sanitized)


def test_a_hyphenated_name_does_not_match_the_contract_regex(
    contract: InventoryListingContract,
) -> None:
    assert not contract.sanitized_regex.match("granite-chevrolet-inventory-sanitized.xlsx")
    assert not contract.sanitized_regex.match(
        "arpi_granite_chevrolet_inventory_sanitized_2026-08-02.xlsx"
    )


def test_a_store_with_no_declared_descriptor_is_refused() -> None:
    """Deriving one from the registry silently would let a rename rename an artifact."""
    with pytest.raises(ConfigurationError, match="No filename descriptor is declared"):
        derived_sanitized_file_name("GSA-999", date(2026, 8, 2))


def test_the_directory_convention_lowercases_only_the_store_segment() -> None:
    directory = reference_directory("GSA-001", date(2026, 8, 2))
    assert directory.as_posix() == "data/reference/inventory/gsa-001/2026-08-02"
    full = default_output_path("GSA-001", date(2026, 8, 2))
    assert full.as_posix() == CANONICAL_PATH
    assert full.name == CANONICAL_NAME


# --------------------------------------------------------------------------------------
# Deterministic batch and record identifiers
# --------------------------------------------------------------------------------------


def test_the_batch_identifier_matches_the_committed_artifact() -> None:
    assert source_batch_id("GSA-001", date(2026, 8, 2)) == "GSA001-20260802-001"


def test_the_record_identifier_matches_the_committed_artifact() -> None:
    assert source_record_id("GSA-001", date(2026, 8, 2), 1) == "GSA001-20260802-0001"
    assert source_record_id("GSA-001", date(2026, 8, 2), 199) == "GSA001-20260802-0199"


# --------------------------------------------------------------------------------------
# Value-level tripwires
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "https://example.invalid/inventory/1",
        "http://example.invalid",
        "see www.example.invalid for details",
        "ftp://example.invalid/feed",
    ],
)
def test_a_url_is_detected_however_it_is_written(value: str) -> None:
    assert contains_url(value) is True


@pytest.mark.parametrize(
    "value",
    [None, "", "Granite Chevrolet of Nashua", "2026 Chevrolet Silverado 1500 LT", "38690"],
)
def test_an_ordinary_value_is_not_mistaken_for_a_url(value: object) -> None:
    assert contains_url(value) is False


def test_a_seventeen_character_vin_alphabet_string_is_treated_as_a_real_vin() -> None:
    # Seventeen characters, none of them I, O or Q. Not a real vehicle's VIN; the point
    # is the SHAPE, which is what the rule matches.
    assert looks_like_a_real_vin("1GCUYDED5NZ123456") is True


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "ARPICF041EC8630BD",  # ARPI-prefixed: contains I, so it cannot be a real VIN
        "VEH-CF041EC8630B",  # too short, and hyphenated
        "1GCUYDED5NZ12345",  # sixteen characters
        "1GCUYDED5NZ1234567",  # eighteen characters
    ],
)
def test_a_non_vin_is_not_flagged(value: object) -> None:
    assert looks_like_a_real_vin(value) is False


# --------------------------------------------------------------------------------------
# The source adapter registry
# --------------------------------------------------------------------------------------


def test_the_listing_source_is_registered_and_names_its_objects() -> None:
    spec = source_for("inventory_listing_snapshot")
    assert spec.raw_table == "inventory_listing_snapshot_load"
    assert spec.staging_view == "stg_inventory_listing_snapshot"
    assert spec.typed_view == "stg_inventory_listing_snapshot_typed"
    assert spec.dimension_table == "dim_observed_vehicle"
    assert spec.fact_table == "fact_vehicle_listing_snapshot"
    assert spec.natural_key == ("dealership_id", "captured_at", "synthetic_vehicle_id")


def test_the_dimension_script_is_not_named_merge() -> None:
    """The pipeline's loader globs sql/03_dimensions/*_merge.sql and runs every match.

    This lane's source is a workbook that arrives on no schedule, so a *_merge.sql name
    would sweep it into every pipeline run and let a green run read as evidence that the
    lane had been loaded.
    """
    spec = source_for("inventory_listing_snapshot")
    assert not spec.dimension_merge_script.endswith("_merge.sql")
    assert spec.dimension_merge_script.endswith("_load.sql")


def test_an_unregistered_source_is_refused_rather_than_skipped() -> None:
    with pytest.raises(ValidationError, match="No sanitized reference source"):
        source_for("service_visit_snapshot")


def test_every_declared_lane_sql_file_exists() -> None:
    from arpi.inventory.spec import INVENTORY_LANE_SQL_FILES

    missing = [
        name for name in INVENTORY_LANE_SQL_FILES if not (REPO_ROOT / "sql" / name).is_file()
    ]
    assert missing == [], f"declared lane SQL files that do not exist: {missing}"


def test_the_lane_declaration_covers_every_listing_sql_file() -> None:
    """The other direction: a listing script the declaration forgets is invisible.

    Several checks subtract this list from the MVP counts. A file it omits would be
    counted as an MVP object, which is how "five facts" quietly becomes six.
    """
    from arpi.inventory.spec import INVENTORY_LANE_SQL_FILES

    declared = set(INVENTORY_LANE_SQL_FILES)
    found = {
        f"{path.parent.name}/{path.name}"
        for path in (REPO_ROOT / "sql").rglob("*.sql")
        if "listing" in path.name or "observed_vehicle" in path.name
    }
    assert found <= declared, f"listing SQL files the lane does not declare: {found - declared}"


# --------------------------------------------------------------------------------------
# The dealership registry
# --------------------------------------------------------------------------------------


def test_the_three_stores_resolve() -> None:
    assert known_dealership_ids() == ("GSA-001", "GSA-002", "GSA-003")
    assert resolve_store("GSA-001").store_name == "Granite Chevrolet of Nashua"
    assert resolve_store("GSA-002").store_name == "Granite Subaru of Manchester"
    assert resolve_store("GSA-003").store_name == "Granite Used Auto Center of Merrimack"


def test_the_store_lookup_is_case_insensitive_and_trims() -> None:
    assert resolve_store("  gsa-002 ").dealership_id == "GSA-002"


def test_an_unknown_store_is_refused() -> None:
    with pytest.raises(ValidationError, match="does not exist in the ARPI dealership registry"):
        resolve_store("GSA-404")


# --------------------------------------------------------------------------------------
# The registered checks
# --------------------------------------------------------------------------------------


def test_seventeen_checks_are_registered_with_no_gaps() -> None:
    ids = [check.check_id for check in LISTING_CHECKS]
    assert ids == [f"DQ-LST-{index:03d}" for index in range(1, 18)]
    assert len(set(ids)) == len(ids)


def test_every_check_declares_a_scope_a_test_can_reach() -> None:
    assert {check.scope for check in LISTING_CHECKS} == {"workbook", "database"}
