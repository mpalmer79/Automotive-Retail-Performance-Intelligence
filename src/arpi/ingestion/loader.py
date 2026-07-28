"""Load generated entities into PostgreSQL and record the full audit trail.

The loader is deliberately thin. It moves rows into the ``raw`` schema with ``COPY`` and
then hands control to the SQL under ``sql/03_dimensions/``: the merge logic lives in SQL
so it can be reviewed, tested and run independently of Python.

Row values are always passed as parameters or through ``COPY``. SQL text is only ever
composed from :class:`psycopg.sql.Identifier` and from repository-controlled ``.sql``
files, never from generated data.

THE FIVE-LAYER ROW-COUNT CHAIN
------------------------------
``ARCHITECTURE.md`` section 21.4 requires every run to record a row count at each layer
boundary. Phase 0 recorded three of the five -- ``source``, ``raw`` and ``warehouse`` --
and ``DOC-23`` registered the gap: with no ``staging`` count, nothing could prove that
rows were not lost between the raw tables and the views the warehouse actually reads,
and with no ``rejected`` count the audit trail could not say where a lost row went.

All five are now recorded, and the reconciliations span the whole chain::

    raw = staging_accepted + rejected_invalid + deduplicated
    distinct natural keys in staging = those same keys present in the warehouse

The first identity is the important one, and it is **not** true by construction. Each
term is measured independently: ``raw`` counts the newest batch in the landing table,
``staging`` counts the accepted view, and the two rejection terms come from the staging
rejected view, which classifies every row the accepted view left behind. If any of the
three disagreed with the others the reconciliation would fail, which is the point --
a staging count that is unconditionally equal to the raw count proves nothing.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final

from arpi.audit.run import (
    LAYER_RAW,
    LAYER_REJECTED,
    LAYER_STAGING,
    LAYER_WAREHOUSE,
    ReconciliationResult,
    RejectedRecord,
)
from arpi.constants import (
    SCHEMA_AUDIT,
    SCHEMA_RAW,
    SCHEMA_STAGING,
    SCHEMA_WAREHOUSE,
)
from arpi.exceptions import DatabaseLoadError
from arpi.generation.writer import format_value
from arpi.ingestion.database import connect
from arpi.ingestion.rejection import (
    MAX_PERSISTED_REJECTED_RECORDS,
    REJECTION_CODE_DUPLICATE_KEY,
    build_rejected_payload,
    category_for,
)
from arpi.ingestion.spec import ENTITY_SPECS, EntityIngestionSpec, spec_for
from arpi.logging_config import get_logger

try:
    from psycopg import sql
except ImportError:  # pragma: no cover - exercised only where the db extra is absent
    sql = None  # type: ignore[assignment]

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Iterator, Sequence

    import pandas as pd

    from arpi.audit.run import AuditRecorder
    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset

_LOGGER = get_logger(__name__)

#: Directory, relative to the SQL root, holding the dimension merge scripts.
DIMENSION_SQL_SUBDIR = "03_dimensions"

#: Glob matching the merge scripts the loader is required to execute.
MERGE_SQL_GLOB = "*_merge.sql"

#: Default SQL root, relative to the directory ARPI is run from.
DEFAULT_SQL_ROOT = Path("sql")

#: Maps a generated entity to its raw landing table and its warehouse target.
#:
#: A read-only projection of :data:`arpi.ingestion.spec.ENTITY_SPECS`, kept because it is
#: the shape callers and tests already know. The registry is the authority; this is a
#: view of it, so the two can never disagree. Entities with no warehouse target yet do
#: not appear.
ENTITY_TABLES: Final[dict[str, tuple[str, str]]] = {
    entity_spec.entity_name: (entity_spec.raw_table, entity_spec.warehouse_table)
    for entity_spec in ENTITY_SPECS
    if entity_spec.warehouse_table is not None
}

#: Entities stored as Type 2 dimensions.
SCD_TYPE_2_ENTITIES: Final[frozenset[str]] = frozenset(
    entity_spec.entity_name for entity_spec in ENTITY_SPECS if entity_spec.scd_type_2
)
"""Entities whose warehouse table keeps Type 2 history, so only current rows reconcile."""

#: Column identifying which rows of each audit child table this loader owns.
#:
#: A rerun replaces the loader's own rows, but the SQL data-quality scripts append rows
#: for the same run under warehouse-qualified target names. Scoping the delete by these
#: columns keeps the two layers from deleting each other's results.
AUDIT_CHILD_SCOPE: dict[str, str] = {
    "validation_result": "target_object",
    "reconciliation_result": "reconciliation_id",
    "rejected_record": "source_entity",
}

#: Audit child tables written row by row, in insertion order.
AUDIT_APPEND_TABLES: Final[tuple[str, ...]] = (
    "validation_result",
    "reconciliation_result",
    "rejected_record",
)

#: Raw-table bookkeeping columns appended to every copied row, in this order.
RAW_METADATA_COLUMNS = (
    "load_batch_id",
    "source_file_name",
    "source_row_number",
)


@dataclass(frozen=True, slots=True)
class LayerCounts:
    """One entity's row count at every layer of the ingestion chain.

    Attributes:
        raw: Rows of the newest load batch in the raw landing table.
        staging: Rows the staging view accepted.
        rejected_invalid: Rows dropped because a value was unrepresentable, absent or
            outside its domain.
        deduplicated: Rows dropped because their natural key repeated within the batch.
        warehouse: Rows present in the warehouse table after the merge.
        warehouse_matched: Distinct staged natural keys that reached the warehouse.
        staging_keys: Distinct natural keys present in staging.
    """

    raw: int = 0
    staging: int = 0
    rejected_invalid: int = 0
    deduplicated: int = 0
    warehouse: int = 0
    warehouse_matched: int = 0
    staging_keys: int = 0

    @property
    def rejected_total(self) -> int:
        """Rows written to ``audit.rejected_record``: invalid rows plus duplicates."""
        return self.rejected_invalid + self.deduplicated

    @property
    def chain_balances(self) -> bool:
        """Whether ``raw = staging + rejected_invalid + deduplicated``."""
        return self.raw == self.staging + self.rejected_invalid + self.deduplicated


@dataclass(frozen=True, slots=True)
class LoadResult:
    """Outcome of loading the generated entities.

    Attributes:
        load_batch_id: The batch identifier stamped on every raw row of this run.
        raw_row_counts: Rows copied into ``raw`` per entity.
        warehouse_row_counts: Rows present in ``warehouse`` per entity after the merge.
        executed_sql: Merge scripts that were executed, in execution order.
        layer_counts: The full five-layer chain per entity.
        rejected_records: Every quarantined row, already redacted.
    """

    load_batch_id: uuid.UUID
    raw_row_counts: dict[str, int] = field(default_factory=dict)
    warehouse_row_counts: dict[str, int] = field(default_factory=dict)
    executed_sql: tuple[Path, ...] = ()
    layer_counts: dict[str, LayerCounts] = field(default_factory=dict)
    rejected_records: tuple[RejectedRecord, ...] = ()


def discover_merge_sql(sql_root: Path = DEFAULT_SQL_ROOT) -> list[Path]:
    """Find the dimension merge scripts the loader must execute.

    Args:
        sql_root: Directory containing the numbered SQL folders.

    Returns:
        The ``*_merge.sql`` files under ``<sql_root>/03_dimensions``, sorted by name so
        execution order is deterministic and reviewable.

    Raises:
        DatabaseLoadError: If the directory is missing or contains no merge scripts.
            The loader never silently succeeds without merging.
    """
    directory = Path(sql_root) / DIMENSION_SQL_SUBDIR
    if not directory.is_dir():
        raise DatabaseLoadError(
            f"Dimension merge SQL directory not found: {directory}. The database load "
            "cannot run without it; run ARPI from the repository root or pass an "
            "explicit sql_root.",
            missing_paths=[directory],
        )
    scripts = sorted(directory.glob(MERGE_SQL_GLOB))
    if not scripts:
        raise DatabaseLoadError(
            f"No {MERGE_SQL_GLOB} scripts found in {directory}. The warehouse dimensions "
            "would be left empty, so the load is refused.",
            missing_paths=[directory / MERGE_SQL_GLOB],
        )
    return scripts


def rows_for_copy(
    frame: pd.DataFrame,
    *,
    load_batch_id: uuid.UUID,
    source_file_name: str,
) -> Iterator[tuple[Any, ...]]:
    """Render a frame as raw-layer tuples, one per row.

    Every business column is rendered as text using the same dialect as the CSV writer,
    so ``raw`` holds exactly what a reviewer sees in ``data/sample``.

    Args:
        frame: Generated frame.
        load_batch_id: Batch identifier stamped on every row.
        source_file_name: Name of the CSV the rows correspond to.

    Yields:
        Tuples of ``(*business_columns, load_batch_id, source_file_name, row_number)``.
    """
    for row_number, row in enumerate(frame.itertuples(index=False, name=None), start=1):
        yield (
            *(format_value(value) for value in row),
            str(load_batch_id),
            source_file_name,
            row_number,
        )


def load_foundation(
    config: ArpiConfig,
    datasets: Sequence[GeneratedDataset],
    recorder: AuditRecorder,
    *,
    sql_root: Path = DEFAULT_SQL_ROOT,
) -> LoadResult:
    """Load the generated entities into PostgreSQL and write the audit rows.

    Each entity is copied into its raw table inside its own transaction. The merge
    scripts then run in a single transaction, followed by the count collection, the
    rejected-record collection and the audit inserts.

    Args:
        config: Resolved configuration; the database must be enabled and reachable.
        datasets: Generated datasets to load.
        recorder: Audit recorder to extend with the five-layer row counts, the
            reconciliations and the rejected records.
        sql_root: Directory containing the numbered SQL folders.

    Returns:
        A :class:`LoadResult` describing what was written.

    Raises:
        DatabaseLoadError: If an entity has no registered ingestion spec, or the merge
            SQL is missing.
        DatabaseUnavailableError: If PostgreSQL cannot be reached.
    """
    specs = [spec_for(dataset.entity_name) for dataset in datasets]
    merge_scripts = discover_merge_sql(sql_root)
    load_batch_id = uuid.uuid4()
    counts: dict[str, LayerCounts] = {}
    rejections: list[RejectedRecord] = []

    with connect(config) as connection:
        for dataset, entity_spec in zip(datasets, specs, strict=True):
            _copy_into_raw(connection, dataset, entity_spec, load_batch_id)
            connection.commit()

        for script in merge_scripts:
            _execute_script(connection, script)
        connection.commit()

        for entity_spec in specs:
            counts[entity_spec.entity_name] = _collect_layer_counts(connection, entity_spec)
            rejections.extend(_collect_rejections(connection, entity_spec))

        _record_counts(recorder, datasets, specs, counts)
        for rejection in rejections:
            recorder.record_rejection(rejection)
        _insert_audit_rows(connection, recorder)
        connection.commit()

    return LoadResult(
        load_batch_id=load_batch_id,
        raw_row_counts={name: layer.raw for name, layer in counts.items()},
        warehouse_row_counts={name: layer.warehouse for name, layer in counts.items()},
        executed_sql=tuple(merge_scripts),
        layer_counts=counts,
        rejected_records=tuple(rejections),
    )


def _copy_into_raw(
    connection: Any,
    dataset: GeneratedDataset,
    entity_spec: EntityIngestionSpec,
    load_batch_id: uuid.UUID,
) -> int:
    """COPY one dataset into its raw landing table and return the row count."""
    columns = [*dataset.actual_columns, *RAW_METADATA_COLUMNS]
    statement = sql.SQL("COPY {}.{} ({}) FROM STDIN").format(
        sql.Identifier(SCHEMA_RAW),
        sql.Identifier(entity_spec.raw_table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
    )
    copied = 0
    with connection.cursor() as cursor, cursor.copy(statement) as copy:
        for record in rows_for_copy(
            dataset.frame, load_batch_id=load_batch_id, source_file_name=entity_spec.csv_name
        ):
            copy.write_row(record)
            copied += 1
    _LOGGER.info(
        "Copied %s row(s) into %s.%s (batch %s).",
        copied,
        SCHEMA_RAW,
        entity_spec.raw_table,
        load_batch_id,
    )
    return copied


def _execute_script(connection: Any, script: Path) -> None:
    """Execute one repository-controlled SQL script."""
    statement = script.read_text(encoding="utf-8")
    with connection.cursor() as cursor:
        cursor.execute(statement)
    _LOGGER.info("Executed merge script %s.", script)


def _scalar(connection: Any, statement: Any, parameters: Sequence[Any] | None = None) -> int:
    """Run a single-value query and return it as an int, treating NULL as zero."""
    with connection.cursor() as cursor:
        cursor.execute(statement, parameters)
        row = cursor.fetchone()
    if not row or row[0] is None:
        return 0
    return int(row[0])


def _newest_batch_predicate(entity_spec: EntityIngestionSpec) -> sql.Composed:
    """Build the ``WHERE load_batch_id = (newest batch)`` clause for a raw table.

    The rule is identical to the one every staging view applies -- greatest
    ``max(ingested_at)``, ties broken by greatest ``max(raw_record_id)`` -- because the
    raw count and the staging count must describe the same batch or the chain identity
    compares two different loads and means nothing.
    """
    return sql.SQL(
        "WHERE load_batch_id = ("
        "SELECT load_batch_id FROM {raw_schema}.{raw_table} "
        "GROUP BY load_batch_id "
        "ORDER BY max(ingested_at) DESC, max(raw_record_id) DESC LIMIT 1)"
    ).format(
        raw_schema=sql.Identifier(SCHEMA_RAW),
        raw_table=sql.Identifier(entity_spec.raw_table),
    )


def _collect_layer_counts(connection: Any, entity_spec: EntityIngestionSpec) -> LayerCounts:
    """Measure one entity at every layer of the ingestion chain.

    Each term is measured independently against the database rather than derived from
    another term, so the chain identity is an assertion about the load and not an
    arithmetic tautology.

    Args:
        connection: An open database connection.
        entity_spec: The entity's ingestion spec.

    Returns:
        The populated :class:`LayerCounts`.
    """
    raw_count = _scalar(
        connection,
        sql.SQL("SELECT count(*) FROM {}.{} ").format(
            sql.Identifier(SCHEMA_RAW), sql.Identifier(entity_spec.raw_table)
        )
        + _newest_batch_predicate(entity_spec),
    )
    staging_count = _scalar(
        connection,
        sql.SQL("SELECT count(*) FROM {}.{}").format(
            sql.Identifier(SCHEMA_STAGING), sql.Identifier(entity_spec.staging_view)
        ),
    )
    staging_keys = _scalar(
        connection,
        sql.SQL("SELECT count(*) FROM (SELECT DISTINCT {} FROM {}.{}) AS k").format(
            sql.SQL(", ").join(sql.Identifier(column) for column in entity_spec.natural_key),
            sql.Identifier(SCHEMA_STAGING),
            sql.Identifier(entity_spec.staging_view),
        ),
    )
    rejected_invalid, deduplicated = _collect_drop_counts(connection, entity_spec, raw_count)

    warehouse_count = 0
    warehouse_matched = 0
    if entity_spec.warehouse_table is not None:
        warehouse_count = _warehouse_row_count(
            connection, entity_spec.warehouse_table, current_only=entity_spec.scd_type_2
        )
        warehouse_matched = _warehouse_matched_count(connection, entity_spec)

    return LayerCounts(
        raw=raw_count,
        staging=staging_count,
        rejected_invalid=rejected_invalid,
        deduplicated=deduplicated,
        warehouse=warehouse_count,
        warehouse_matched=warehouse_matched,
        staging_keys=staging_keys,
    )


def _collect_drop_counts(
    connection: Any, entity_spec: EntityIngestionSpec, raw_count: int
) -> tuple[int, int]:
    """Count the rows staging dropped, split into invalid rows and duplicates.

    Args:
        connection: An open database connection.
        entity_spec: The entity's ingestion spec.
        raw_count: Rows in the newest raw batch, used only for the fallback path.

    Returns:
        ``(rejected_invalid, deduplicated)``.

    An entity with a rejected companion view gets both terms from that view, which
    classifies every dropped row. The two Phase 0 staging views have no such companion,
    so the duplicate term is measured directly against the raw table -- the batch's row
    count minus its distinct natural keys -- and the invalid term is zero, because those
    views cannot drop a row for any other reason. That fallback is still a measurement,
    not an assumption: if a Phase 0 view ever started dropping rows for a third reason,
    the chain identity would stop balancing and the reconciliation would fail.
    """
    if entity_spec.rejected_view is not None:
        rejected_invalid = _scalar(
            connection,
            sql.SQL("SELECT count(*) FROM {}.{} WHERE rejection_code <> {}").format(
                sql.Identifier(SCHEMA_STAGING),
                sql.Identifier(entity_spec.rejected_view),
                sql.Literal(REJECTION_CODE_DUPLICATE_KEY),
            ),
        )
        deduplicated = _scalar(
            connection,
            sql.SQL("SELECT count(*) FROM {}.{} WHERE rejection_code = {}").format(
                sql.Identifier(SCHEMA_STAGING),
                sql.Identifier(entity_spec.rejected_view),
                sql.Literal(REJECTION_CODE_DUPLICATE_KEY),
            ),
        )
        return rejected_invalid, deduplicated

    distinct_keys = _scalar(
        connection,
        sql.SQL("SELECT count(DISTINCT ROW({})) FROM {}.{} ").format(
            sql.SQL(", ").join(sql.Identifier(column) for column in entity_spec.natural_key),
            sql.Identifier(SCHEMA_RAW),
            sql.Identifier(entity_spec.raw_table),
        )
        + _newest_batch_predicate(entity_spec),
    )
    return 0, raw_count - distinct_keys


def _warehouse_row_count(connection: Any, table: str, *, current_only: bool) -> int:
    """Count the warehouse rows a generated dataset should reconcile against.

    Args:
        connection: An open database connection.
        table: Unqualified warehouse table name.
        current_only: Restrict the count to ``is_current`` rows. Required for slowly
            changing dimensions: the generator emits one row per business key, but a
            Type 2 table accumulates one row per *version*. An unfiltered count would
            exceed the generated count the moment any attribute changes, failing the
            reconciliation for a load that was entirely correct.

    Returns:
        The row count.
    """
    statement = sql.SQL("SELECT count(*) FROM {}.{}").format(
        sql.Identifier(SCHEMA_WAREHOUSE), sql.Identifier(table)
    )
    if current_only:
        statement = statement + sql.SQL(" WHERE is_current")
    return _scalar(connection, statement)


def _warehouse_matched_count(connection: Any, entity_spec: EntityIngestionSpec) -> int:
    """Count the distinct staged natural keys that actually reached the warehouse.

    This is the term that catches a merge which silently drops rows -- for example the
    inner join in the ``dim_vehicle`` merge, which cannot insert a vehicle whose model is
    not in ``dim_vehicle_model``. Comparing it with the distinct staged key count turns
    that silent drop into a failed reconciliation.
    """
    # Guarded by the caller; the type checker cannot see that from here.
    assert entity_spec.warehouse_table is not None
    match_key = sql.Identifier(entity_spec.warehouse_match_key)
    statement = sql.SQL(
        "SELECT count(*) FROM (SELECT DISTINCT {match_key} FROM {staging}.{view}) AS s "
        "WHERE EXISTS (SELECT 1 FROM {warehouse}.{table} AS w WHERE w.{match_key} = s.{match_key}"
    ).format(
        match_key=match_key,
        staging=sql.Identifier(SCHEMA_STAGING),
        view=sql.Identifier(entity_spec.staging_view),
        warehouse=sql.Identifier(SCHEMA_WAREHOUSE),
        table=sql.Identifier(entity_spec.warehouse_table),
    )
    statement = statement + sql.SQL(" AND w.is_current)" if entity_spec.scd_type_2 else ")")
    return _scalar(connection, statement)


def _collect_rejections(connection: Any, entity_spec: EntityIngestionSpec) -> list[RejectedRecord]:
    """Read one entity's rejected rows and render them safe to persist.

    Every payload leaves this function redacted. The redaction is unconditional and does
    not consult the entity: a rejected customer row must not write an e-mail address into
    the audit table even if one somehow appeared in the source.

    Args:
        connection: An open database connection.
        entity_spec: The entity's ingestion spec.

    Returns:
        Up to :data:`~arpi.ingestion.rejection.MAX_PERSISTED_REJECTED_RECORDS` rejections.
        The counts recorded against the run are always complete; only the number of
        individual payloads persisted is capped.
    """
    if entity_spec.rejected_view is None:
        return []

    statement = sql.SQL(
        "SELECT source_record_key, rejection_code, rejection_category, rejection_reason, "
        "record_payload, source_row_number, load_batch_id, source_file_name "
        "FROM {}.{} ORDER BY source_row_number LIMIT {}"
    ).format(
        sql.Identifier(SCHEMA_STAGING),
        sql.Identifier(entity_spec.rejected_view),
        sql.Literal(MAX_PERSISTED_REJECTED_RECORDS),
    )
    with connection.cursor() as cursor:
        cursor.execute(statement)
        rows = cursor.fetchall()

    rejections: list[RejectedRecord] = []
    for row in rows:
        (
            source_record_key,
            rejection_code,
            rejection_category,
            rejection_reason,
            record_payload,
            source_row_number,
            load_batch_id,
            source_file_name,
        ) = row
        # The view supplies the category; category_for is the authority if it ever
        # disagrees, so one code cannot mean two things.
        category = category_for(str(rejection_code)) or str(rejection_category)
        rejections.append(
            RejectedRecord(
                source_entity=entity_spec.entity_name,
                source_record_key=(None if source_record_key is None else str(source_record_key)),
                rejection_code=str(rejection_code),
                # audit.rejected_record has no category column, so the category is
                # carried as a machine-readable prefix here and inside the payload.
                rejection_reason=f"[{category}] {rejection_reason}",
                record_payload=build_rejected_payload(
                    record_payload,
                    rejection_category=category,
                    source_row_number=(
                        None if source_row_number is None else int(source_row_number)
                    ),
                    load_batch_id=(None if load_batch_id is None else str(load_batch_id)),
                    source_file_name=(None if source_file_name is None else str(source_file_name)),
                ),
            )
        )
    if rejections:
        _LOGGER.warning(
            "%s row(s) of %s were rejected and quarantined in %s.rejected_record.",
            len(rejections),
            entity_spec.entity_name,
            SCHEMA_AUDIT,
        )
    return rejections


def _record_counts(
    recorder: AuditRecorder,
    datasets: Sequence[GeneratedDataset],
    specs: Sequence[EntityIngestionSpec],
    counts: dict[str, LayerCounts],
) -> None:
    """Record the five-layer row counts and every reconciliation that spans them."""
    for dataset, entity_spec in zip(datasets, specs, strict=True):
        entity = entity_spec.entity_name
        layer = counts[entity]

        recorder.record_row_count(entity, LAYER_RAW, layer.raw)
        recorder.record_row_count(entity, LAYER_STAGING, layer.staging)
        recorder.record_row_count(entity, LAYER_REJECTED, layer.rejected_total)
        if entity_spec.warehouse_table is not None:
            recorder.record_row_count(entity, LAYER_WAREHOUSE, layer.warehouse)

        # Chain: nothing vanished between raw and staging. Every raw row of the newest
        # batch is either accepted, rejected as invalid, or dropped as a duplicate.
        recorder.record_reconciliation(
            ReconciliationResult(
                reconciliation_id=entity_spec.chain_reconciliation_id,
                description=(
                    f"Every {entity} row in the newest raw batch is accounted for: "
                    f"raw = staging accepted + rejected + deduplicated "
                    f"({layer.raw} = {layer.staging} + {layer.rejected_invalid} "
                    f"+ {layer.deduplicated})."
                ),
                left_source=f"{SCHEMA_RAW}.{entity_spec.raw_table}",
                left_value=float(layer.raw),
                right_source=(
                    f"{SCHEMA_STAGING}.{entity_spec.staging_view}"
                    f" + {SCHEMA_AUDIT}.rejected_record + deduplicated"
                ),
                right_value=float(layer.staging + layer.rejected_invalid + layer.deduplicated),
            )
        )

        if entity_spec.warehouse_table is None:
            continue

        # Chain: every accepted natural key reached the warehouse. This is the term that
        # catches a merge dropping rows on an unresolved foreign key.
        recorder.record_reconciliation(
            ReconciliationResult(
                reconciliation_id=entity_spec.warehouse_reconciliation_id,
                description=(
                    f"Every {entity} natural key accepted by staging was inserted into or "
                    f"matched in the warehouse."
                ),
                left_source=f"{SCHEMA_STAGING}.{entity_spec.staging_view}",
                left_value=float(layer.staging_keys),
                right_source=f"{SCHEMA_WAREHOUSE}.{entity_spec.warehouse_table}",
                right_value=float(layer.warehouse_matched),
            )
        )

        # The Phase 0 reconciliation, retained: generated rows equal warehouse rows.
        if entity_spec.row_count_reconciliation_id is not None:
            recorder.record_reconciliation(
                ReconciliationResult(
                    reconciliation_id=entity_spec.row_count_reconciliation_id,
                    description=f"Generated {entity} rows equal warehouse.{entity} rows.",
                    left_source=f"generator:{entity}",
                    left_value=float(dataset.row_count),
                    right_source=f"{SCHEMA_WAREHOUSE}.{entity}",
                    right_value=float(layer.warehouse),
                )
            )


def _insert_audit_rows(connection: Any, recorder: AuditRecorder) -> None:
    """Insert the pipeline run and its child audit rows, all parameterised."""
    rows = recorder.to_rows()
    run_row = rows["pipeline_run"][0]
    with connection.cursor() as cursor:
        cursor.execute(
            _insert_statement("pipeline_run", tuple(run_row.keys()))
            + sql.SQL(
                " ON CONFLICT (run_uuid) DO UPDATE SET "
                "completed_at = EXCLUDED.completed_at, status = EXCLUDED.status, "
                "critical_failure_count = EXCLUDED.critical_failure_count, "
                "warning_count = EXCLUDED.warning_count, notes = EXCLUDED.notes "
                "RETURNING pipeline_run_id"
            ),
            tuple(run_row.values()),
        )
        result = cursor.fetchone()
        pipeline_run_id = int(result[0])

        # A rerun with the same parameters is the same logical run executed again, not a
        # new one: the run_uuid is derived from those parameters. Its child rows are
        # therefore replaced rather than appended, so the audit trail describes the most
        # recent execution instead of accumulating duplicates. Other runs are untouched,
        # preserving prior run history as the architecture requires.
        for table, scope_column in AUDIT_CHILD_SCOPE.items():
            owned = sorted({str(row[scope_column]) for row in rows[table]})
            if owned:
                cursor.execute(
                    _delete_children_statement(table, scope_column),
                    (pipeline_run_id, owned),
                )

        for row in rows["pipeline_run_row_count"]:
            payload = {"pipeline_run_id": pipeline_run_id, **row}
            cursor.execute(
                _insert_statement("pipeline_run_row_count", tuple(payload.keys()))
                + sql.SQL(
                    " ON CONFLICT (pipeline_run_id, entity_name, layer) DO UPDATE SET "
                    "row_count = EXCLUDED.row_count, recorded_at = EXCLUDED.recorded_at"
                ),
                tuple(payload.values()),
            )

        for table in AUDIT_APPEND_TABLES:
            for row in rows[table]:
                payload = {"pipeline_run_id": pipeline_run_id, **row}
                cursor.execute(
                    _insert_statement(table, tuple(payload.keys())), tuple(payload.values())
                )
    _LOGGER.info("Recorded audit rows for pipeline_run_id %s.", pipeline_run_id)


def _delete_children_statement(table: str, scope_column: str) -> sql.Composed:
    """Build a parameterised ``DELETE`` scoped to the rows this loader owns.

    The delete is restricted to the values the loader is about to write. The SQL
    validation scripts append rows for the same run under warehouse-qualified target
    names such as ``warehouse.dim_date``, whereas the loader writes generator-side names
    such as ``dim_date``. Deleting the whole run's children would silently discard
    results an operator had recorded from the SQL layer.
    """
    return sql.SQL("DELETE FROM {}.{} WHERE pipeline_run_id = {} AND {} = ANY({})").format(
        sql.Identifier(SCHEMA_AUDIT),
        sql.Identifier(table),
        sql.Placeholder(),
        sql.Identifier(scope_column),
        sql.Placeholder(),
    )


def _insert_statement(table: str, columns: tuple[str, ...]) -> sql.Composed:
    """Build a parameterised ``INSERT`` for an audit table."""
    return sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
        sql.Identifier(SCHEMA_AUDIT),
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )
