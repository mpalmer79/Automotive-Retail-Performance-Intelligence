"""The versioned sanitized-listing workbook contract, loaded once from YAML.

``config/reference/inventory_listing_contract.yaml`` is the single declaration of sheet
names, header spellings, controlled vocabularies, governed ranges, the synthetic identity
algorithm, the approved underscore-based file-naming convention and the list of canonical
committed artifacts. This module turns it into frozen dataclasses.

Why a file rather than Python constants
---------------------------------------
Three independent consumers need the same strings: the sanitizer that writes a workbook,
the validator that refuses one, and ``scripts/check_reference_data.py``, which runs in the
``repository-checks`` CI job on a **bare interpreter with nothing installed**. The check
script therefore reads the YAML with its own minimal parser rather than importing this
module; both read the same file, so neither can drift from the other while both look
correct in review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Final

import yaml

from arpi.exceptions import ConfigurationError

#: Repository-relative location of the contract. Resolved from this module rather than
#: from the working directory so a CLI invoked from anywhere finds the same file.
CONTRACT_PATH: Final[Path] = (
    Path(__file__).resolve().parents[3] / "config" / "reference" / "inventory_listing_contract.yaml"
)

#: Characters folded to ``_`` when a header name is normalised for comparison. The same
#: folding :mod:`arpi.validation.privacy` applies, so ``Source-URL`` and ``source url``
#: are one name in both places.
_SEPARATORS: Final[tuple[str, ...]] = ("-", ".", " ", "\t")


def normalise_header(name: str) -> str:
    """Fold a header spelling to the canonical form the contract rules are written against.

    Args:
        name: Header text as it appears in the workbook, in any spelling.

    Returns:
        Lower-case, underscore-separated form. ``" Source URL "`` becomes ``source_url``.
    """
    folded = str(name).strip().lower()
    for separator in _SEPARATORS:
        folded = folded.replace(separator, "_")
    return "_".join(part for part in folded.split("_") if part)


@dataclass(frozen=True, slots=True)
class InventoryColumn:
    """One column of the sanitized ``Inventory`` sheet.

    Attributes:
        header: Exact spelling in row 1 of the sheet.
        column: Warehouse-side ``snake_case`` name used from ``raw`` onward.
        type_name: ``text``, ``integer``, ``money`` or ``date``.
        required: Whether a blank cell is a rejection.
        max_length: Governed length for a text column, or ``None``.
    """

    header: str
    column: str
    type_name: str
    required: bool
    max_length: int | None = None


@dataclass(frozen=True, slots=True)
class PrivateInputColumn:
    """One column of the private workbook the sanitizer accepts as input.

    Attributes:
        header: Exact spelling expected in the private workbook's header row.
        role: What the column means to the sanitizer, e.g. ``original_vin``.
        required: Whether the private workbook is refused without it.
    """

    header: str
    role: str
    required: bool


@dataclass(frozen=True, slots=True)
class CanonicalArtifact:
    """A sanitized reference workbook that is committed to the repository.

    Attributes:
        dealership_id: Store the snapshot belongs to.
        captured_at: Snapshot date.
        file_name: Approved underscore-based file name, exactly as committed.
        path: Repository-relative path, exactly as committed.
        row_count: Number of data rows on the ``Inventory`` sheet.
        sha256: SHA-256 of the committed bytes.
        legacy_path_hint: A repository-path hint inside the workbook's ``README`` sheet
            that predates the naming decision and is accepted for this artifact only.
            ``None`` for every workbook the sanitizer produces, which always writes the
            approved path.
    """

    dealership_id: str
    captured_at: date
    file_name: str
    path: str
    row_count: int
    sha256: str
    legacy_path_hint: str | None = None


@dataclass(frozen=True, slots=True)
class InventoryListingContract:
    """The whole contract, as read from YAML.

    Every attribute is the single source of its value. Nothing here is recomputed from
    a Python literal, so a change to the YAML reaches the sanitizer, the validator, the
    importer, the exporter and the CI check in one edit.
    """

    contract_version: str
    classification: str
    source_feed: str
    source_system: str
    sheets: dict[str, str]
    optional_sheets: dict[str, str]
    inventory_columns: tuple[InventoryColumn, ...]
    prohibited_headers: frozenset[str]
    condition_values: tuple[str, ...]
    pricing_status_values: tuple[str, ...]
    listed_requires_price: bool
    call_for_price_allows_price: bool
    model_year_minimum: int
    model_year_maximum: int
    model_year_years_ahead_of_capture: int
    odometer_minimum: int
    odometer_maximum: int
    price_minimum: float
    price_maximum: float
    inventory_unit_count: int
    identity_namespace: str
    vehicle_id_prefix: str
    vehicle_id_digest_length: int
    vin_prefix: str
    vin_digest_length: int
    private_input_columns: tuple[PrivateInputColumn, ...]
    sanitized_pattern: str
    report_pattern: str
    sanitized_regex: re.Pattern[str]
    report_regex: re.Pattern[str]
    reference_root: str
    report_root: str
    date_format: str
    store_descriptors: dict[str, str]
    canonical_artifacts: tuple[CanonicalArtifact, ...]
    rejection_codes: dict[str, str]

    # -- Derived accessors --------------------------------------------------------

    @property
    def headers(self) -> tuple[str, ...]:
        """Exact ``Inventory`` header row, in order."""
        return tuple(column.header for column in self.inventory_columns)

    @property
    def columns(self) -> tuple[str, ...]:
        """Warehouse-side column names, in ``Inventory`` order."""
        return tuple(column.column for column in self.inventory_columns)

    @property
    def required_sheets(self) -> tuple[str, ...]:
        """The four sheets every governed workbook must contain, in workbook order."""
        return (
            self.sheets["readme"],
            self.sheets["summary"],
            self.sheets["inventory"],
            self.sheets["model_summary"],
        )

    def column_for(self, header: str) -> InventoryColumn:
        """Return the column declaration for one header spelling.

        Args:
            header: Header text, in any spelling.

        Returns:
            The matching :class:`InventoryColumn`.

        Raises:
            KeyError: If the header is not part of the contract.
        """
        wanted = normalise_header(header)
        for column in self.inventory_columns:
            if normalise_header(column.header) == wanted:
                return column
        raise KeyError(header)

    def store_descriptor(self, dealership_id: str) -> str:
        """Return the filename descriptor for a store.

        Args:
            dealership_id: Registry identifier, e.g. ``"GSA-002"``.

        Returns:
            The underscore-joined descriptor, e.g. ``"Granite_Subaru"``.

        Raises:
            ConfigurationError: If the store has no declared descriptor. Deriving one
                from the registry silently would let a store rename rename a committed
                artifact, which section 8 of the contract forbids.
        """
        try:
            return self.store_descriptors[dealership_id]
        except KeyError:
            known = ", ".join(sorted(self.store_descriptors))
            raise ConfigurationError(
                f"No filename descriptor is declared for dealership {dealership_id!r}. "
                f"Add one to naming.store_descriptors in {CONTRACT_PATH.name}. "
                f"Declared stores: {known}.",
                config_path=CONTRACT_PATH,
                keys=["store_descriptors"],
            ) from None

    def artifact_for(self, dealership_id: str, captured_at: date) -> CanonicalArtifact | None:
        """Return the declared canonical artifact for a store and snapshot date, if any.

        Args:
            dealership_id: Registry identifier.
            captured_at: Snapshot date.

        Returns:
            The declaration, or ``None`` when no artifact is committed for that pair.
        """
        for artifact in self.canonical_artifacts:
            if artifact.dealership_id == dealership_id and artifact.captured_at == captured_at:
                return artifact
        return None


def _require(payload: dict[str, Any], key: str) -> Any:
    """Return ``payload[key]`` or raise a configuration error naming the missing key."""
    if key not in payload:
        raise ConfigurationError(
            f"The inventory listing contract is missing the required key {key!r}.",
            config_path=CONTRACT_PATH,
            keys=[key],
        )
    return payload[key]


def _as_date(value: Any, key: str) -> date:
    """Coerce a YAML scalar to a date, refusing anything ambiguous."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ConfigurationError(
            f"{key} must be an ISO date (YYYY-MM-DD); got {value!r}.",
            config_path=CONTRACT_PATH,
            keys=[key],
        ) from None


@lru_cache(maxsize=1)
def load_contract(path: Path | None = None) -> InventoryListingContract:
    """Load and validate the workbook contract.

    Cached, because every CLI entry point and every test reads the same file and parsing
    it repeatedly buys nothing.

    Args:
        path: Contract file to read. Defaults to :data:`CONTRACT_PATH`.

    Returns:
        The parsed contract.

    Raises:
        ConfigurationError: If the file is absent, unparseable or missing a required key.
    """
    source = path or CONTRACT_PATH
    if not source.is_file():
        raise ConfigurationError(
            f"The inventory listing contract was not found at {source}. It is required "
            "by the sanitizer, the validator, the importer and the CI reference-data "
            "check; ARPI refuses to guess a workbook shape.",
            config_path=source,
        )
    try:
        payload = yaml.safe_load(source.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:  # pragma: no cover - malformed YAML is a typo, not a path
        raise ConfigurationError(
            f"The inventory listing contract at {source} is not valid YAML: {error}.",
            config_path=source,
        ) from error
    if not isinstance(payload, dict):
        raise ConfigurationError(
            f"The inventory listing contract at {source} must be a mapping.",
            config_path=source,
        )

    naming = _require(payload, "naming")
    identity = _require(payload, "identity")
    pricing = _require(payload, "pricing_rules")
    model_year = _require(payload, "model_year")
    odometer = _require(payload, "odometer_miles")
    price = _require(payload, "advertised_price")

    return InventoryListingContract(
        contract_version=str(_require(payload, "contract_version")),
        classification=str(_require(payload, "classification")),
        source_feed=str(_require(payload, "source_feed")),
        source_system=str(_require(payload, "source_system")),
        sheets=dict(_require(payload, "sheets")),
        optional_sheets=dict(payload.get("optional_sheets", {})),
        inventory_columns=tuple(
            InventoryColumn(
                header=str(item["header"]),
                column=str(item["column"]),
                type_name=str(item["type"]),
                required=bool(item["required"]),
                max_length=item.get("max_length"),
            )
            for item in _require(payload, "inventory_columns")
        ),
        prohibited_headers=frozenset(
            normalise_header(name) for name in payload.get("prohibited_headers", ())
        ),
        condition_values=tuple(str(v) for v in _require(payload, "condition_values")),
        pricing_status_values=tuple(str(v) for v in _require(payload, "pricing_status_values")),
        listed_requires_price=bool(pricing["listed_requires_price"]),
        call_for_price_allows_price=bool(pricing["call_for_price_allows_price"]),
        model_year_minimum=int(model_year["minimum"]),
        model_year_maximum=int(model_year["maximum"]),
        model_year_years_ahead_of_capture=int(model_year["years_ahead_of_capture"]),
        odometer_minimum=int(odometer["minimum"]),
        odometer_maximum=int(odometer["maximum"]),
        price_minimum=float(price["minimum"]),
        price_maximum=float(price["maximum"]),
        inventory_unit_count=int(_require(payload, "inventory_unit_count")["exactly"]),
        identity_namespace=str(identity["namespace"]),
        vehicle_id_prefix=str(identity["vehicle_id_prefix"]),
        vehicle_id_digest_length=int(identity["vehicle_id_digest_length"]),
        vin_prefix=str(identity["vin_prefix"]),
        vin_digest_length=int(identity["vin_digest_length"]),
        private_input_columns=tuple(
            PrivateInputColumn(
                header=str(item["header"]),
                role=str(item["role"]),
                required=bool(item["required"]),
            )
            for item in _require(payload, "private_input_columns")
        ),
        sanitized_pattern=str(naming["sanitized_pattern"]),
        report_pattern=str(naming["report_pattern"]),
        sanitized_regex=re.compile(str(naming["sanitized_regex"])),
        report_regex=re.compile(str(naming["report_regex"])),
        reference_root=str(naming["reference_root"]),
        report_root=str(naming["report_root"]),
        date_format=str(naming["date_format"]),
        store_descriptors={
            str(key): str(value) for key, value in _require(payload, "store_descriptors").items()
        },
        canonical_artifacts=tuple(
            CanonicalArtifact(
                dealership_id=str(item["dealership_id"]),
                captured_at=_as_date(item["captured_at"], "canonical_artifacts.captured_at"),
                file_name=str(item["file_name"]),
                path=str(item["path"]).strip(),
                row_count=int(item["row_count"]),
                sha256=str(item["sha256"]),
                legacy_path_hint=(
                    str(item["legacy_path_hint"]) if item.get("legacy_path_hint") else None
                ),
            )
            for item in payload.get("canonical_artifacts", ())
        ),
        rejection_codes={
            str(key): str(value) for key, value in _require(payload, "rejection_codes").items()
        },
    )
