"""The Inventory Listings KPI domain stays governed and stays honest.

Two obligations, and the second is the one that matters:

1. Every KPI the register names is defined in ``KPI_CATALOG.md`` with all twelve required
   fields, and resolves to a reporting view that exists.
2. **No measure this source cannot support ever appears in the section.** Sold units,
   inventory turn, days in stock, gross, inventory investment, acquisition and recon
   cost, carrying cost, ROI and marketing attribution each need data a public listing
   snapshot does not carry, and a KPI defined over data that does not exist is a number
   somebody will eventually quote.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from arpi.constants import (
    INVENTORY_LISTING_KPI_IDS,
    INVENTORY_LISTING_KPI_VIEW_OWNERSHIP,
    INVENTORY_LISTING_VIEWS,
    KPI_IDS,
    MVP_REPORTING_VIEWS,
    PROHIBITED_LISTING_MEASURES,
    REPORTING_VIEWS,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = REPO_ROOT / "KPI_CATALOG.md"

#: The twelve fields every entry in the domain must carry.
REQUIRED_FIELDS = (
    "**KPI ID**",
    "**Display name**",
    "**Business question**",
    "**Grain**",
    "**Formula**",
    "**Date basis**",
    "**Null behaviour**",
    "**Filter behaviour**",
    "**Additivity**",
    "**Interpretation caution**",
    "**Source view**",
    "**Status**",
    "**Owner**",
)


@pytest.fixture(scope="module")
def catalogue() -> str:
    return CATALOGUE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def domain_section(catalogue: str) -> str:
    """The Inventory Listings section, which is the last section of the catalogue."""
    marker = "## 38. Inventory Listings domain"
    assert marker in catalogue, "the Inventory Listings domain section is missing"
    return catalogue[catalogue.index(marker) :]


# --------------------------------------------------------------------------------------
# The register and the catalogue agree
# --------------------------------------------------------------------------------------


def test_twenty_two_listing_kpis_are_registered_with_no_gaps() -> None:
    assert tuple(f"KPI-LST-{index:03d}" for index in range(1, 25)) == INVENTORY_LISTING_KPI_IDS


def test_every_registered_kpi_is_defined_in_the_catalogue(domain_section: str) -> None:
    missing = [kpi for kpi in INVENTORY_LISTING_KPI_IDS if f"`{kpi}`" not in domain_section]
    assert missing == [], f"registered but not defined in KPI_CATALOG.md: {missing}"


def test_the_catalogue_defines_no_listing_kpi_the_register_does_not_know(
    domain_section: str,
) -> None:
    defined = set(re.findall(r"KPI-LST-\d{3}", domain_section))
    assert defined - set(INVENTORY_LISTING_KPI_IDS) == set()


def test_every_kpi_entry_carries_every_required_field(domain_section: str) -> None:
    blocks = re.split(r"^### 38\.4\.\d+ ", domain_section, flags=re.MULTILINE)[1:]
    assert len(blocks) == len(INVENTORY_LISTING_KPI_IDS)
    for block in blocks:
        title = block.splitlines()[0]
        for field in REQUIRED_FIELDS:
            assert field in block, f"{title}: missing {field}"


def test_every_kpi_resolves_to_a_reporting_view_that_exists() -> None:
    assert set(INVENTORY_LISTING_KPI_VIEW_OWNERSHIP) == set(INVENTORY_LISTING_KPI_IDS)
    for kpi, views in INVENTORY_LISTING_KPI_VIEW_OWNERSHIP.items():
        assert views, f"{kpi} names no source view"
        for view in views:
            assert view in INVENTORY_LISTING_VIEWS, f"{kpi} names an unknown view {view}"


def test_every_listing_view_owns_at_least_one_kpi() -> None:
    """A view that owns no KPI is an object with no stated analytical purpose."""
    owned = {view for views in INVENTORY_LISTING_KPI_VIEW_OWNERSHIP.values() for view in views}
    assert set(INVENTORY_LISTING_VIEWS) == owned


# --------------------------------------------------------------------------------------
# The prohibited measures
# --------------------------------------------------------------------------------------


def test_no_prohibited_measure_is_defined_as_a_kpi(domain_section: str) -> None:
    """The distinction this test turns on is where the phrase appears.

    "Days in stock" SHOULD appear in this section, repeatedly, in the interpretation
    caution that says days observed online is not it. Searching the whole section for the
    phrase would therefore fail on correct writing and would have to be deleted.

    What must never happen is a prohibited measure appearing where a KPI is DEFINED: its
    display name, its formula, or its source view. Those three fields are what a reader
    binds a number to, so those three fields are what this checks.
    """
    defining_fields = ("**Display name**", "**Formula**", "**Source view**")
    offending: list[str] = []
    for block in re.split(r"^### 38\.4\.\d+ ", domain_section, flags=re.MULTILINE)[1:]:
        title = block.splitlines()[0]
        for line in block.splitlines():
            if not any(field in line for field in defining_fields):
                continue
            offending.extend(
                f"{title}: {measure}"
                for measure in PROHIBITED_LISTING_MEASURES
                if measure in line.casefold()
            )
    assert offending == [], (
        f"the Inventory Listings domain DEFINES measures this source cannot support: "
        f"{offending}. Each needs data a public listing snapshot does not carry."
    )


def test_the_prohibited_phrases_do_appear_in_the_cautions(domain_section: str) -> None:
    """The other direction. A section that never mentioned them would not have warned."""
    cautions = "\n".join(
        line for line in domain_section.splitlines() if "**Interpretation caution**" in line
    ).casefold()
    for measure in ("days in stock", "inventory investment", "acquisition cost"):
        assert measure in cautions, (
            f"no interpretation caution mentions {measure!r}. The section must say what "
            "the number is NOT, not merely avoid the word."
        )


def test_the_domain_states_which_measures_it_will_not_define(domain_section: str) -> None:
    for measure in ("sold", "inventory turn", "days in stock", "gross", "attribution"):
        assert measure in domain_section.casefold()


def test_the_prohibited_list_is_not_empty_and_names_the_dangerous_ones() -> None:
    assert "sold units" in PROHIBITED_LISTING_MEASURES
    assert "days in stock" in PROHIBITED_LISTING_MEASURES
    assert "inventory investment" in PROHIBITED_LISTING_MEASURES


# --------------------------------------------------------------------------------------
# The boundary with the MVP KPI set and the semantic model
# --------------------------------------------------------------------------------------


def test_the_listing_kpis_are_not_in_the_mvp_kpi_set() -> None:
    """KPI_IDS is what the semantic model implements and what its expectation file counts.

    Adding these to it would make ``model_expectations.json`` wrong the moment the tuple
    grew, and would imply a DAX measure exists for each -- none does, deliberately.
    """
    assert set(KPI_IDS) & set(INVENTORY_LISTING_KPI_IDS) == set()
    assert len(KPI_IDS) == 29


def test_the_listing_views_are_not_part_of_the_mvp_reporting_surface() -> None:
    assert set(MVP_REPORTING_VIEWS) & set(INVENTORY_LISTING_VIEWS) == set()
    assert len(MVP_REPORTING_VIEWS) == 28
    assert len(INVENTORY_LISTING_VIEWS) == 6


def test_the_full_reporting_surface_is_the_union_of_the_two() -> None:
    assert set(REPORTING_VIEWS) == set(MVP_REPORTING_VIEWS) | set(INVENTORY_LISTING_VIEWS)
    assert len(REPORTING_VIEWS) == 34
    assert list(REPORTING_VIEWS) == sorted(REPORTING_VIEWS)


def test_the_domain_says_it_has_no_dax_measures_yet(domain_section: str) -> None:
    """Section 14 of the increment: the semantic model is not touched."""
    assert "Future DAX ownership" in domain_section
    assert "awaiting real-engine validation" in domain_section


def test_the_domain_states_the_six_semantic_boundaries(domain_section: str) -> None:
    lowered = domain_section.casefold()
    for statement in (
        "not** transaction price",
        "removed from listing",
        "not** days in stock",
        "physical presence",
        "current business performance",
    ):
        assert statement.casefold() in lowered, f"the domain does not state: {statement}"


def test_every_view_a_kpi_names_is_built_as_a_sql_file() -> None:
    reporting = REPO_ROOT / "sql" / "05_reporting"
    built = {
        path.stem.split("_", 1)[1] for path in reporting.glob("*.sql") if path.name[0].isdigit()
    }
    for view in INVENTORY_LISTING_VIEWS:
        assert view in built, f"{view} is registered but has no SQL file"
