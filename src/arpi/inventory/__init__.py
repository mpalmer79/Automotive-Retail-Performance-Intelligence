"""ARPI Inventory Operations: the sanitized public inventory reference lane.

This package is the whole of the third controlled data lane ADR-0011 creates. It is
deliberately separate from :mod:`arpi.generation` (fully synthetic operational data) and
from the general public reference data under ``config/reference/``, because the material
it handles is neither: the dealer and vehicle identifiers are synthetic, and the listing
attributes are a **de-identified public reference snapshot**.

What a listing snapshot proves, and what it does not
----------------------------------------------------
A row proves that a vehicle listing was visible in a public source at a moment in time.
It does not prove the vehicle was physically on the ground, that the dealership owned it,
what it cost, or what it eventually sold for. Every module here is written to make the
honest reading the easy one:

* advertised price is not transaction price, acquisition cost or inventory investment;
* a listing that disappears is *removed from listing*, never *sold*;
* days observed online is not days in stock.

Those three distinctions are enforced, not merely documented -- see
:mod:`arpi.inventory.validation` and ``scripts/check_reference_data.py``.

Module map
----------
``contract``    the versioned workbook contract, loaded from
                ``config/reference/inventory_listing_contract.yaml``
``identity``    the deterministic, group-stable synthetic vehicle identity, and the
                approved underscore-based file-naming convention
``workbook``    thin openpyxl helpers: read-only loads, atomic writes, styling
``sanitizer``   private workbook in, governed public-reference workbook out
``validation``  the refusal rules a committed workbook must satisfy (DQ-LST-*)
``spec``        the sanitized-listing source adapter registry
``importer``    workbook to PostgreSQL: raw, staging, dimension, fact
``report``      the database-backed Excel operating report
"""

from __future__ import annotations

from arpi.inventory.contract import InventoryListingContract, load_contract
from arpi.inventory.identity import (
    derived_report_file_name,
    derived_sanitized_file_name,
    reference_directory,
    source_batch_id,
    source_record_id,
    synthetic_identity,
)
from arpi.inventory.spec import INVENTORY_LISTING_SOURCE, ReferenceSourceSpec

__all__ = [
    "INVENTORY_LISTING_SOURCE",
    "InventoryListingContract",
    "ReferenceSourceSpec",
    "derived_report_file_name",
    "derived_sanitized_file_name",
    "load_contract",
    "reference_directory",
    "source_batch_id",
    "source_record_id",
    "synthetic_identity",
]
