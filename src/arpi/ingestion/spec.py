"""Declarative description of how one entity moves from CSV to warehouse.

Phase 0 hard-coded the ingestion path for each entity in three separate dictionaries in
``loader.py``: one mapping entity to raw and warehouse table, one listing the Type 2
entities, one mapping entity to reconciliation identifier. Adding an entity meant
editing all three and remembering the fourth place that also needed it.

This module replaces that with one :class:`EntityIngestionSpec` per entity. Adding an
entity is adding a spec -- no new branch, no new dictionary, no new code path. The
loader iterates the registry and treats every entity identically.

The registry is the contract other agents target. A generator author declares their
entity here and the loader, the row-count chain, the rejected-record path and the
reconciliations all pick it up.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from arpi.constants import (
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
    RAW_TABLE_CALENDAR_DATE,
    RAW_TABLE_DEALERSHIP,
    RECONCILIATION_DIM_DATE_ROW_COUNT,
    RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT,
    WAREHOUSE_TABLE_DIM_DATE,
    WAREHOUSE_TABLE_DIM_DEALERSHIP,
)
from arpi.exceptions import DatabaseLoadError

#: Prefix of every ingestion row-count chain reconciliation identifier.
RECONCILIATION_INGEST_PREFIX: Final = "RECON-INGEST"


@dataclass(frozen=True, slots=True)
class EntityIngestionSpec:
    """Everything the loader needs to know about one entity.

    Attributes:
        entity_name: Logical entity name, e.g. ``"dim_vehicle_model"`` for a warehouse
            dimension or ``"sale_event"`` for a pre-warehouse source entity. This is the
            name the generator declares and the name recorded in ``audit``.
        raw_table: Unqualified table in the ``raw`` schema the CSV lands in.
        staging_view: Unqualified view in the ``staging`` schema holding the accepted
            rows -- typed, domain-filtered and deduplicated.
        warehouse_table: Unqualified table in the ``warehouse`` schema the merge writes,
            or ``None`` for a source entity that has no warehouse target yet.
        natural_key: Business key columns, in order, as they are named in the staging
            view. Used to deduplicate, to reconcile staging against the warehouse, and to
            identify a rejected row.
        merge_script: File name of the merge script under ``sql/03_dimensions`` (or
            ``sql/04_facts``) that loads the warehouse table, or ``None`` when none
            exists yet.
        rejected_view: Unqualified view in the ``staging`` schema listing the rows the
            staging view did NOT accept, or ``None`` when the entity has no rejected
            companion view. Phase 0's two staging views predate the pattern and have
            none, so their dropped rows are counted rather than itemised.
        scd_type_2: Whether the warehouse table keeps Type 2 history, in which case only
            ``is_current`` rows reconcile against a source that carries one row per
            business key.
        source_file_name: CSV file name the raw rows are stamped with.
        row_count_reconciliation_id: Identifier of the generator-to-warehouse row-count
            reconciliation, when the entity has a warehouse target.
    """

    entity_name: str
    raw_table: str
    staging_view: str
    warehouse_table: str | None
    natural_key: tuple[str, ...]
    merge_script: str | None
    rejected_view: str | None = None
    scd_type_2: bool = False
    source_file_name: str | None = None
    row_count_reconciliation_id: str | None = None

    def __post_init__(self) -> None:
        """Reject a spec that cannot describe a real load."""
        if not self.natural_key:
            raise ValueError(f"{self.entity_name}: natural_key must name at least one column.")

    @property
    def csv_name(self) -> str:
        """File name the raw rows are stamped with."""
        return self.source_file_name or f"{self.entity_name}.csv"

    @property
    def warehouse_match_key(self) -> str:
        """Column compared between staging and the warehouse.

        The first component of the natural key. For a Type 2 dimension whose staging
        grain is one row per *version*, that is still the business key -- the question the
        reconciliation asks is "did every staged business key reach the warehouse?", not
        "did every version?", because the merge legitimately suppresses a version whose
        attribute hash did not change.
        """
        return self.natural_key[0]

    @property
    def chain_reconciliation_id(self) -> str:
        """Identifier of this entity's five-layer row-count chain reconciliation."""
        return f"{RECONCILIATION_INGEST_PREFIX}-{_slug(self.entity_name)}-CHAIN"

    @property
    def warehouse_reconciliation_id(self) -> str:
        """Identifier of this entity's staging-to-warehouse reconciliation."""
        return f"{RECONCILIATION_INGEST_PREFIX}-{_slug(self.entity_name)}-WAREHOUSE"


def _slug(entity_name: str) -> str:
    """Render an entity name as the upper-case hyphenated form used in identifiers."""
    return entity_name.replace("_", "-").upper()


def _dimension(
    subject: str,
    *,
    natural_key: tuple[str, ...],
    merge_script: str,
    scd_type_2: bool = False,
) -> EntityIngestionSpec:
    """Build a spec for a Phase 1 dimension, applying the naming conventions.

    Args:
        subject: The dimension's subject area, without the ``dim_`` prefix, e.g.
            ``"vehicle_model"``. Every object name is derived from it: the entity is
            ``dim_<subject>`` -- the name the generator declares and the name the loader
            looks the spec up by -- while the raw table, the staging view and the
            rejected view all use the unprefixed form the SQL layer chose.
        natural_key: Business key columns as named in the staging view.
        merge_script: File name of the merge script under ``sql/03_dimensions``.
        scd_type_2: Whether the warehouse table keeps Type 2 history.

    Returns:
        The populated spec.
    """
    entity_name = f"dim_{subject}"
    return EntityIngestionSpec(
        entity_name=entity_name,
        raw_table=f"{subject}_load",
        staging_view=f"stg_{subject}",
        warehouse_table=entity_name,
        natural_key=natural_key,
        merge_script=merge_script,
        rejected_view=f"stg_{subject}_rejected",
        scd_type_2=scd_type_2,
        source_file_name=f"{entity_name}.csv",
        row_count_reconciliation_id=f"RECON-DIM-{_slug(subject)}-ROWCOUNT",
    )


def _source_entity(
    entity_name: str,
    *,
    subject: str | None = None,
    natural_key: tuple[str, ...],
) -> EntityIngestionSpec:
    """Build a spec for a pre-warehouse source entity with no warehouse target yet.

    Args:
        entity_name: The name the generator declares for the entity.
        subject: The SQL layer's object stem, when it differs from ``entity_name``.
        natural_key: Business key columns as named in the staging view.

    Returns:
        The populated spec.
    """
    stem = subject or entity_name
    return EntityIngestionSpec(
        entity_name=entity_name,
        raw_table=f"{stem}_load",
        staging_view=f"stg_{stem}",
        warehouse_table=None,
        natural_key=natural_key,
        merge_script=None,
        rejected_view=f"stg_{stem}_rejected",
    )


#: Every entity ARPI can ingest, in load order.
#:
#: Phase 0's two dimensions come first because everything else conforms to them. The
#: Phase 1 dimensions follow in dependency order (a vehicle needs its model), then the
#: pre-warehouse source entities whose warehouse targets are the facts.
ENTITY_SPECS: Final[tuple[EntityIngestionSpec, ...]] = (
    EntityIngestionSpec(
        entity_name=ENTITY_DIM_DATE,
        raw_table=RAW_TABLE_CALENDAR_DATE,
        staging_view="stg_calendar_date",
        warehouse_table=WAREHOUSE_TABLE_DIM_DATE,
        natural_key=("date_key",),
        merge_script="10_dim_date_merge.sql",
        # No rejected companion view: staging.stg_calendar_date is a Phase 0 view and is
        # owned elsewhere. Its dropped rows are still counted, through the distinct
        # natural-key count in the loader, so the chain still balances honestly.
        rejected_view=None,
        source_file_name="dim_date.csv",
        row_count_reconciliation_id=RECONCILIATION_DIM_DATE_ROW_COUNT,
    ),
    EntityIngestionSpec(
        entity_name=ENTITY_DIM_DEALERSHIP,
        raw_table=RAW_TABLE_DEALERSHIP,
        staging_view="stg_dealership",
        warehouse_table=WAREHOUSE_TABLE_DIM_DEALERSHIP,
        natural_key=("dealership_id",),
        merge_script="11_dim_dealership_merge.sql",
        rejected_view=None,
        scd_type_2=True,
        source_file_name="dim_dealership.csv",
        row_count_reconciliation_id=RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT,
    ),
    _dimension(
        "vehicle_model",
        natural_key=("vehicle_model_id",),
        merge_script="12_dim_vehicle_model_merge.sql",
    ),
    _dimension(
        "vehicle",
        natural_key=("vehicle_id",),
        merge_script="13_dim_vehicle_merge.sql",
    ),
    _dimension(
        "employee",
        natural_key=("employee_id", "effective_date"),
        merge_script="14_dim_employee_merge.sql",
        scd_type_2=True,
    ),
    _dimension(
        "customer",
        natural_key=("customer_id",),
        merge_script="15_dim_customer_merge.sql",
    ),
    _dimension(
        "lead_source",
        natural_key=("lead_source_id",),
        merge_script="16_dim_lead_source_merge.sql",
    ),
    _dimension(
        "marketing_campaign",
        natural_key=("campaign_id",),
        merge_script="17_dim_marketing_campaign_merge.sql",
    ),
    _source_entity("acquisition_event", natural_key=("acquisition_id",)),
    _source_entity("sale_event", natural_key=("sale_id",)),
    _source_entity("lead", natural_key=("lead_id",)),
    _source_entity("appointment", natural_key=("appointment_id",)),
    # The generator in arpi.generation.marketing declares this entity as
    # `marketing_spend_event`, so that -- not the bare `marketing_spend` the SQL objects
    # are stemmed on -- is the name the loader will look the spec up by. The stem is
    # carried separately rather than renaming either side.
    _source_entity(
        "marketing_spend_event",
        subject="marketing_spend",
        natural_key=("marketing_spend_id",),
    ),
)

#: The registry keyed by entity name.
SPECS_BY_ENTITY: Final[dict[str, EntityIngestionSpec]] = {
    spec.entity_name: spec for spec in ENTITY_SPECS
}


def spec_for(entity_name: str) -> EntityIngestionSpec:
    """Return the ingestion spec for one entity.

    Args:
        entity_name: Logical entity name as declared by its generator.

    Returns:
        The registered :class:`EntityIngestionSpec`.

    Raises:
        DatabaseLoadError: If the entity has no spec. The load is refused rather than
            silently skipping the entity, because a skipped entity is indistinguishable
            from an entity that generated no rows.
    """
    try:
        return SPECS_BY_ENTITY[entity_name]
    except KeyError:
        known = ", ".join(sorted(SPECS_BY_ENTITY))
        raise DatabaseLoadError(
            f"No ingestion spec is registered for entity {entity_name!r}. Add an "
            f"EntityIngestionSpec to arpi.ingestion.spec.ENTITY_SPECS. Known entities: "
            f"{known}.",
            entity=entity_name,
        ) from None
