"""The sanitized-reference source adapter registry, and store resolution.

WHY THIS IS A SECOND REGISTRY
------------------------------
:mod:`arpi.ingestion.spec` describes entities whose source is a **generated CSV**. Its
loader globs the generator output, executes every registered fact-load script on every
pipeline run, and fails closed when a registered entity produces no file. A sanitized
listing snapshot is none of those things: it arrives as an Excel workbook, on a cadence a
human controls, for one store at a time, and a pipeline run that finds no workbook has
not failed -- it simply has nothing new to import.

Registering ``inventory_listing_snapshot`` in ``ENTITY_SPECS`` would therefore make every
ordinary pipeline run demand a workbook it has no reason to expect. This registry keeps
the two lanes apart while giving the listing lane the same shape: one declaration, and
every layer reads it.

NOTHING HERE IS SOURCE-SPECIFIC
-------------------------------
There is no Chevrolet in this module and none anywhere in :mod:`arpi.inventory`. A source
adapter names the *lane*, not the store: the same spec serves GSA-001, GSA-002 and
GSA-003, and the store is resolved from the workbook's own metadata against the
authoritative dealership registry rather than inferred from a file name.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from arpi.exceptions import ValidationError
from arpi.generation.dealership import STORE_DEFINITIONS, StoreDefinition

__all__ = [
    "INVENTORY_LISTING_SOURCE",
    "REFERENCE_SOURCE_SPECS",
    "ReferenceSourceSpec",
    "known_dealership_ids",
    "resolve_store",
    "source_for",
]


@dataclass(frozen=True, slots=True)
class ReferenceSourceSpec:
    """Everything the listing importer needs to know about one sanitized source.

    Attributes:
        source_entity: Logical entity name recorded in ``audit`` and used to look the
            spec up.
        raw_table: Unqualified table in the ``raw`` schema the workbook lands in.
        staging_view: Unqualified accepted-rows view in the ``staging`` schema.
        rejected_view: Unqualified rejected-rows companion view.
        dimension_table: Unqualified ``warehouse`` dimension the source merges into.
        dimension_merge_script: File name under ``sql/03_dimensions`` performing that
            merge.
        fact_table: Unqualified ``warehouse`` fact the source loads.
        fact_load_script: File name under ``sql/04_facts`` performing that load.
        natural_key: The declared source grain, in order, as named in the staging view.
        reconciliation_prefix: Prefix of every reconciliation identifier this source
            records.
    """

    source_entity: str
    raw_table: str
    staging_view: str
    rejected_view: str
    dimension_table: str
    dimension_merge_script: str
    fact_table: str
    fact_load_script: str
    natural_key: tuple[str, ...]
    reconciliation_prefix: str

    @property
    def typed_view(self) -> str:
        """Unqualified name of the internal typed-and-classified staging view."""
        return f"{self.staging_view}_typed"


#: The sanitized public inventory listing lane.
#:
#: Grain: one sanitized vehicle listing per dealership per ``captured_at`` value. The
#: natural key is ``(dealership_id, captured_at, synthetic_vehicle_id)`` -- the same
#: triple ``uq_fact_vehicle_listing_snapshot_grain`` enforces, stated once here and
#: enforced once in the database.
INVENTORY_LISTING_SOURCE: Final = ReferenceSourceSpec(
    source_entity="inventory_listing_snapshot",
    raw_table="inventory_listing_snapshot_load",
    staging_view="stg_inventory_listing_snapshot",
    rejected_view="stg_inventory_listing_snapshot_rejected",
    dimension_table="dim_observed_vehicle",
    # Deliberately *_load.sql, not *_merge.sql: the pipeline's loader globs
    # sql/03_dimensions/*_merge.sql and runs every match on every run, and this lane's
    # source is a workbook that arrives on no schedule. See the script's own header.
    dimension_merge_script="18_dim_observed_vehicle_load.sql",
    fact_table="fact_vehicle_listing_snapshot",
    fact_load_script="15_fact_vehicle_listing_snapshot_load.sql",
    natural_key=("dealership_id", "captured_at", "synthetic_vehicle_id"),
    reconciliation_prefix="RECON-LISTING",
)

#: Every sanitized reference source ARPI can import.
REFERENCE_SOURCE_SPECS: Final[tuple[ReferenceSourceSpec, ...]] = (INVENTORY_LISTING_SOURCE,)

#: Every SQL file under ``sql/`` that belongs to this lane rather than to the MVP
#: warehouse, declared once and read by machine.
#:
#: WHY THIS LIST EXISTS
#: --------------------
#: Several checks count SQL objects and mean the MVP by it: the capability register's
#: warehouse block ("five fact DDL scripts", "twenty-eight reporting views"), the
#: portfolio manifest generator, and the semantic-model expectation file. Those counts are
#: measured against a specific baseline run and must not move because a second, separately
#: governed lane appeared beside them.
#:
#: ``scripts/project_capabilities.py`` and ``portfolio/scripts/generate-project-manifest.ts``
#: both read this tuple to subtract the lane from the MVP counts and report it on its own.
#: Declaring it here -- next to the spec that owns the scripts -- rather than in either
#: consumer is what stops the two from disagreeing.
INVENTORY_LANE_SQL_FILES: Final[tuple[str, ...]] = (
    "01_raw/14_raw_inventory_listing_snapshot_load.sql",
    "02_staging/15_stg_inventory_listing_snapshot.sql",
    "03_dimensions/08_dim_observed_vehicle.sql",
    "03_dimensions/18_dim_observed_vehicle_load.sql",
    "04_facts/05_fact_vehicle_listing_snapshot.sql",
    "04_facts/15_fact_vehicle_listing_snapshot_load.sql",
    "05_reporting/33_vw_vehicle_listing_current.sql",
    "05_reporting/34_vw_vehicle_listing_summary.sql",
    "05_reporting/35_vw_vehicle_listing_model_mix.sql",
    "05_reporting/36_vw_vehicle_listing_price_completeness.sql",
    "05_reporting/37_vw_vehicle_listing_observation_span.sql",
    "05_reporting/38_vw_vehicle_listing_change.sql",
    "06_indexes/02_inventory_listing_indexes.sql",
    "08_validation/12_recon_inventory_listing.sql",
    "09_migrations/0002_add_inventory_listing_objects.sql",
)

#: The registry keyed by entity name.
_BY_ENTITY: Final[dict[str, ReferenceSourceSpec]] = {
    spec.source_entity: spec for spec in REFERENCE_SOURCE_SPECS
}


def source_for(source_entity: str) -> ReferenceSourceSpec:
    """Return the adapter spec for one sanitized source entity.

    Args:
        source_entity: Logical entity name.

    Returns:
        The registered spec.

    Raises:
        ValidationError: If no spec is registered. The import is refused rather than
            skipped, because a skipped source is indistinguishable from an empty one.
    """
    try:
        return _BY_ENTITY[source_entity]
    except KeyError:
        known = ", ".join(sorted(_BY_ENTITY))
        raise ValidationError(
            f"No sanitized reference source is registered for {source_entity!r}. Add a "
            f"ReferenceSourceSpec to arpi.inventory.spec.REFERENCE_SOURCE_SPECS. Known "
            f"sources: {known}.",
            field="source_entity",
        ) from None


def known_dealership_ids() -> tuple[str, ...]:
    """Return every dealership identifier the authoritative registry defines, sorted."""
    return tuple(sorted(store.dealership_id for store in STORE_DEFINITIONS))


def resolve_store(dealership_id: str) -> StoreDefinition:
    """Resolve a dealership identifier against the authoritative registry.

    The registry is :data:`arpi.generation.dealership.STORE_DEFINITIONS`, which is also
    what ``warehouse.dim_dealership`` is built from. Resolving here rather than trusting
    the workbook is what makes a workbook claiming an unknown store, or claiming a store
    name that disagrees with the registry, a refusal instead of a silent import.

    Args:
        dealership_id: Identifier as it appears in the workbook.

    Returns:
        The store definition.

    Raises:
        ValidationError: If the identifier is unknown.
    """
    wanted = str(dealership_id).strip().upper()
    for store in STORE_DEFINITIONS:
        if store.dealership_id == wanted:
            return store
    raise ValidationError(
        f"Dealership {dealership_id!r} does not exist in the ARPI dealership registry. "
        f"Known stores: {', '.join(known_dealership_ids())}.",
        field="dealership_id",
    )
