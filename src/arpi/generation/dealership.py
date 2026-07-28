"""Generator for ``warehouse.dim_dealership``.

The three stores of the fictional Granite State Auto Group are fixed reference data, not
random draws, so this generator is deterministic and seed-independent. It emits a single
current SCD Type 2 version per store; historical versions are **Out of scope** for
Phase 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

import pandas as pd

from arpi.constants import (
    DEALERSHIP_HASH_COLUMNS,
    DIM_DEALERSHIP_COLUMNS,
    DIM_DEALERSHIP_DTYPES,
    ENTITY_DIM_DEALERSHIP,
    SENTINEL_EXPIRATION_DATE,
    SOURCE_SYSTEM,
    STORE_TYPE_FRANCHISE,
    STORE_TYPE_INDEPENDENT,
)
from arpi.exceptions import GenerationError
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.utilities.hashing import hash_attributes

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

#: Seeding namespace recorded for this entity (unused: the store list is fixed).
DEALERSHIP_NAMESPACE = "dim_dealership"


@dataclass(frozen=True, slots=True)
class StoreDefinition:
    """A single fictional store.

    Only non-identifying business attributes are modelled: there are deliberately no
    street addresses, phone numbers, email addresses or contact names anywhere in ARPI.
    """

    dealership_id: str
    store_name: str
    store_short_name: str
    store_type: str
    franchise_brand: str | None
    city: str
    state_code: str
    market_region: str
    opened_date: date
    is_active: bool = True


#: Authoritative store list, shared verbatim with the SQL seed and the documentation.
STORE_DEFINITIONS: tuple[StoreDefinition, ...] = (
    StoreDefinition(
        dealership_id="GSA-001",
        store_name="Granite Chevrolet of Nashua",
        store_short_name="Granite Chevrolet",
        store_type=STORE_TYPE_FRANCHISE,
        franchise_brand="Chevrolet",
        city="Nashua",
        state_code="NH",
        market_region="Southern New Hampshire",
        opened_date=date(2009, 4, 6),
    ),
    StoreDefinition(
        dealership_id="GSA-002",
        store_name="Granite Subaru of Manchester",
        store_short_name="Granite Subaru",
        store_type=STORE_TYPE_FRANCHISE,
        franchise_brand="Subaru",
        city="Manchester",
        state_code="NH",
        market_region="Southern New Hampshire",
        opened_date=date(2013, 8, 19),
    ),
    StoreDefinition(
        dealership_id="GSA-003",
        store_name="Granite Used Auto Center of Merrimack",
        store_short_name="Granite Used Auto",
        store_type=STORE_TYPE_INDEPENDENT,
        franchise_brand=None,
        city="Merrimack",
        state_code="NH",
        market_region="Southern New Hampshire",
        opened_date=date(2017, 3, 13),
    ),
)


class DealershipGenerator(BaseGenerator):
    """Build the current SCD Type 2 version of every fictional store."""

    entity_name = ENTITY_DIM_DEALERSHIP
    declared_columns = DIM_DEALERSHIP_COLUMNS
    namespace = DEALERSHIP_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the dealership frame.

        Args:
            config: Resolved configuration; ``generation.store_count`` must equal the
                number of defined stores.

        Returns:
            A frame with the 16 contract columns, in order, one row per store.

        Raises:
            GenerationError: If ``generation.store_count`` disagrees with the fixed
                store list.
        """
        defined = len(STORE_DEFINITIONS)
        if config.generation.store_count != defined:
            raise GenerationError(
                f"generation.store_count is {config.generation.store_count} but "
                f"{defined} stores are defined in "
                "arpi.generation.dealership.STORE_DEFINITIONS. Either restore the "
                f"configured value to {defined} or add the missing store definitions.",
                entity=ENTITY_DIM_DEALERSHIP,
                configured_store_count=config.generation.store_count,
                defined_store_count=defined,
            )

        ordered = sorted(STORE_DEFINITIONS, key=lambda store: store.dealership_id)
        records = [_build_row(index, store) for index, store in enumerate(ordered, start=1)]
        frame = pd.DataFrame.from_records(records, columns=list(DIM_DEALERSHIP_COLUMNS))
        return frame.astype(DIM_DEALERSHIP_DTYPES)


def generate_dealership_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the ``dim_dealership`` dataset.

    Args:
        config: Resolved configuration.

    Returns:
        The generated dataset, schema-checked against the column contract.
    """
    return DealershipGenerator().generate(config)


def dealership_attribute_hash(store: StoreDefinition) -> str:
    """Compute the SCD Type 2 ``attribute_hash`` for a store.

    The payload is the nine tracked attributes -- ``store_name``, ``store_short_name``,
    ``store_type``, ``franchise_brand``, ``city``, ``state_code``, ``market_region``,
    ``opened_date``, ``is_active`` -- in that order, each rendered with
    :func:`arpi.utilities.hashing.canonical_token` (dates as ``YYYY-MM-DD``, booleans as
    ``true``/``false``, a NULL ``franchise_brand`` as the empty string), joined with
    ``"|"``, encoded UTF-8 and hashed with SHA-256.

    For ``GSA-003`` the payload is therefore::

        Granite Used Auto Center of Merrimack|Granite Used Auto|Independent Used||\
Merrimack|NH|Southern New Hampshire|2017-03-13|true

    Args:
        store: Store definition to hash.

    Returns:
        A 64-character lowercase hexadecimal digest.
    """
    return hash_attributes([getattr(store, column) for column in DEALERSHIP_HASH_COLUMNS])


def _build_row(dealership_key: int, store: StoreDefinition) -> dict[str, Any]:
    """Render one store as a ``dim_dealership`` row."""
    return {
        "dealership_key": dealership_key,
        "dealership_id": store.dealership_id,
        "store_name": store.store_name,
        "store_short_name": store.store_short_name,
        "store_type": store.store_type,
        "franchise_brand": store.franchise_brand,
        "city": store.city,
        "state_code": store.state_code,
        "market_region": store.market_region,
        "opened_date": store.opened_date,
        "is_active": store.is_active,
        "effective_date": store.opened_date,
        "expiration_date": SENTINEL_EXPIRATION_DATE,
        "is_current": True,
        "attribute_hash": dealership_attribute_hash(store),
        "source_system": SOURCE_SYSTEM,
    }
