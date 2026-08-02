"""Deterministic synthetic identity and the approved file-naming convention.

Two unrelated-looking problems are solved in one module because both are *derivations
that must never vary*: the same original VIN must always produce the same synthetic
vehicle identity, and the same store and snapshot date must always produce the same
output file name.

Group-stable vehicle identity
-----------------------------
::

    digest = SHA256(UTF8("ARPI|GSA|" + upper(trim(original VIN)))).hex().upper()
    synthetic_vehicle_id = "VEH-" + digest[:12]
    synthetic_vin        = "ARPI" + digest[:13]

The namespace carries the **group**, not the store, which is what makes the identity
group-stable: one physical vehicle observed at Granite Chevrolet and later at Granite
Subaru resolves to the same ``synthetic_vehicle_id``, so a cross-store appearance is
*detectable*. Detectable is not the same as explained -- ARPI holds no dealer-trade
event, so a cross-store appearance is reported as an observation and never interpreted as
a trade. See ``LIMITATIONS.md``.

The ``ARPI`` prefix is load-bearing. ``I`` is not a permitted VIN character, so no
ARPI-prefixed identifier can pass a real VIN validation. That is the guarantee ADR-0005
already makes for generated vehicles, and it is the reason
``arpi.inventory.validation.looks_like_a_real_vin`` can be strict without ever flagging
ARPI's own output.

Nothing here accepts, returns or logs an original VIN beyond the single call that hashes
it. The value is consumed and the digest is returned; there is no reverse mapping and no
function that would build one.

The naming convention
---------------------
::

    ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx
    ARPI_<Store_Descriptor>_Inventory_Report_<yyyy-mm-dd>.xlsx

Underscores separate filename words; hyphens appear only inside the ISO date. For
``GSA-001`` on ``2026-08-02`` the derived sanitized name is exactly
``ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx``. It is never derived
lowercase and never derived hyphenated.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

from arpi.exceptions import ValidationError
from arpi.inventory.contract import InventoryListingContract, load_contract

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    pass

__all__ = [
    "SyntheticIdentity",
    "derived_report_file_name",
    "derived_sanitized_file_name",
    "reference_directory",
    "source_batch_id",
    "source_record_id",
    "synthetic_identity",
]


@dataclass(frozen=True, slots=True)
class SyntheticIdentity:
    """The replacement identity for one physical vehicle.

    Attributes:
        vehicle_id: ``VEH-`` plus twelve uppercase hexadecimal characters.
        vin: ``ARPI`` plus thirteen uppercase hexadecimal characters, seventeen in all.
    """

    vehicle_id: str
    vin: str


def synthetic_identity(
    original_vin: str, *, contract: InventoryListingContract | None = None
) -> SyntheticIdentity:
    """Derive the group-stable synthetic identity for one original VIN.

    Args:
        original_vin: The VIN as it appears in the private source. It is consumed here
            and never returned, logged or stored.
        contract: Contract supplying the namespace, prefixes and digest lengths.

    Returns:
        The synthetic identity.

    Raises:
        ValidationError: If the VIN is blank. The message names the failure category and
            never quotes the value.
    """
    active = contract or load_contract()
    normalised = str(original_vin).strip().upper()
    if not normalised:
        raise ValidationError(
            "A source vehicle identifier is blank, so no deterministic synthetic "
            "identity can be derived for it.",
            field="original_vin",
        )
    digest = hashlib.sha256(f"{active.identity_namespace}{normalised}".encode()).hexdigest().upper()
    return SyntheticIdentity(
        vehicle_id=f"{active.vehicle_id_prefix}{digest[: active.vehicle_id_digest_length]}",
        vin=f"{active.vin_prefix}{digest[: active.vin_digest_length]}",
    )


def source_batch_id(dealership_id: str, captured_at: date, *, sequence: int = 1) -> str:
    """Build the deterministic batch identifier for one capture.

    One workbook is one batch. The identifier is ``<store><date>-<nnn>`` with the store's
    hyphen removed, matching the committed Granite Chevrolet artifact exactly
    (``GSA001-20260802-001``).

    Args:
        dealership_id: Registry identifier, e.g. ``"GSA-001"``.
        captured_at: Snapshot date.
        sequence: Batch number within the day, for the rare multi-batch capture.

    Returns:
        The batch identifier.
    """
    stem = dealership_id.replace("-", "").upper()
    return f"{stem}-{captured_at:%Y%m%d}-{sequence:03d}"


def source_record_id(dealership_id: str, captured_at: date, row_number: int) -> str:
    """Build the deterministic record identifier for one listing row.

    Args:
        dealership_id: Registry identifier.
        captured_at: Snapshot date.
        row_number: One-based position of the row within the snapshot.

    Returns:
        The record identifier, e.g. ``"GSA001-20260802-0001"``.
    """
    stem = dealership_id.replace("-", "").upper()
    return f"{stem}-{captured_at:%Y%m%d}-{row_number:04d}"


def derived_sanitized_file_name(
    dealership_id: str,
    captured_at: date,
    *,
    contract: InventoryListingContract | None = None,
) -> str:
    """Derive the approved sanitized-workbook file name.

    Args:
        dealership_id: Registry identifier.
        captured_at: Snapshot date.
        contract: Contract supplying the pattern and the store descriptor.

    Returns:
        For ``GSA-001`` on ``2026-08-02``, exactly
        ``ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx``.
    """
    active = contract or load_contract()
    return active.sanitized_pattern.format(
        store_descriptor=active.store_descriptor(dealership_id),
        captured_at=captured_at.strftime(active.date_format),
    )


def derived_report_file_name(
    dealership_id: str,
    captured_at: date,
    *,
    contract: InventoryListingContract | None = None,
) -> str:
    """Derive the approved operating-report file name.

    Args:
        dealership_id: Registry identifier.
        captured_at: Snapshot date.
        contract: Contract supplying the pattern and the store descriptor.

    Returns:
        For ``GSA-001`` on ``2026-08-02``, exactly
        ``ARPI_Granite_Chevrolet_Inventory_Report_2026-08-02.xlsx``.
    """
    active = contract or load_contract()
    return active.report_pattern.format(
        store_descriptor=active.store_descriptor(dealership_id),
        captured_at=captured_at.strftime(active.date_format),
    )


def reference_directory(
    dealership_id: str,
    captured_at: date,
    *,
    contract: InventoryListingContract | None = None,
    root: Path | None = None,
) -> Path:
    """Return the governed directory a sanitized workbook belongs in.

    The directory convention is
    ``data/reference/inventory/<dealership-id lowercased>/<yyyy-mm-dd>/``. The store
    segment is lowercased because it is a *path* segment; the file name inside it is not,
    and the two rules are independent on purpose.

    Args:
        dealership_id: Registry identifier.
        captured_at: Snapshot date.
        contract: Contract supplying the reference root.
        root: Repository root to resolve against. Defaults to a relative path.

    Returns:
        The directory path.
    """
    active = contract or load_contract()
    relative = Path(active.reference_root) / dealership_id.lower() / f"{captured_at:%Y-%m-%d}"
    return relative if root is None else root / relative


def default_output_path(
    dealership_id: str,
    captured_at: date,
    *,
    contract: InventoryListingContract | None = None,
    root: Path | None = None,
) -> Path:
    """Return the full governed path of a sanitized workbook, directory and name together.

    Args:
        dealership_id: Registry identifier.
        captured_at: Snapshot date.
        contract: Contract supplying the convention.
        root: Repository root to resolve against.

    Returns:
        The path a sanitizer run writes when ``--output`` is not supplied.
    """
    active = contract or load_contract()
    directory = reference_directory(dealership_id, captured_at, contract=active, root=root)
    return directory / derived_sanitized_file_name(dealership_id, captured_at, contract=active)
