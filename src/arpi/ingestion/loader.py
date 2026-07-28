"""Load generated dimensions into PostgreSQL and record the audit trail.

The loader is deliberately thin. It moves rows into the ``raw`` schema with ``COPY`` and
then hands control to the SQL that Agent D owns under ``sql/03_dimensions/``: the merge
logic lives in SQL so it can be reviewed, tested and run independently of Python.

Row values are always passed as parameters or through ``COPY``. SQL text is only ever
composed from :class:`psycopg.sql.Identifier` and from repository-controlled ``.sql``
files, never from generated data.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from arpi.audit.run import LAYER_RAW, LAYER_WAREHOUSE, ReconciliationResult
from arpi.constants import (
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
    RAW_TABLE_CALENDAR_DATE,
    RAW_TABLE_DEALERSHIP,
    RECONCILIATION_DIM_DATE_ROW_COUNT,
    RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT,
    SCHEMA_AUDIT,
    SCHEMA_RAW,
    SCHEMA_WAREHOUSE,
    WAREHOUSE_TABLE_DIM_DATE,
    WAREHOUSE_TABLE_DIM_DEALERSHIP,
)
from arpi.exceptions import DatabaseLoadError
from arpi.generation.writer import format_value
from arpi.ingestion.database import connect
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
ENTITY_TABLES: dict[str, tuple[str, str]] = {
    ENTITY_DIM_DATE: (RAW_TABLE_CALENDAR_DATE, WAREHOUSE_TABLE_DIM_DATE),
    ENTITY_DIM_DEALERSHIP: (RAW_TABLE_DEALERSHIP, WAREHOUSE_TABLE_DIM_DEALERSHIP),
}

#: Reconciliation identifier for each entity's warehouse row count.
ENTITY_RECONCILIATIONS: dict[str, str] = {
    ENTITY_DIM_DATE: RECONCILIATION_DIM_DATE_ROW_COUNT,
    ENTITY_DIM_DEALERSHIP: RECONCILIATION_DIM_DEALERSHIP_ROW_COUNT,
}

#: Raw-table bookkeeping columns appended to every copied row, in this order.
RAW_METADATA_COLUMNS = (
    "load_batch_id",
    "source_file_name",
    "source_row_number",
)


@dataclass(frozen=True, slots=True)
class LoadResult:
    """Outcome of loading the foundation dimensions.

    Attributes:
        load_batch_id: The batch identifier stamped on every raw row of this run.
        raw_row_counts: Rows copied into ``raw`` per entity.
        warehouse_row_counts: Rows present in ``warehouse`` per entity after the merge.
        executed_sql: Merge scripts that were executed, in execution order.
    """

    load_batch_id: uuid.UUID
    raw_row_counts: dict[str, int] = field(default_factory=dict)
    warehouse_row_counts: dict[str, int] = field(default_factory=dict)
    executed_sql: tuple[Path, ...] = ()


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
    """Load the foundation dimensions into PostgreSQL and write the audit rows.

    Each entity is copied into its raw table inside its own transaction. The merge
    scripts then run in a single transaction, followed by the audit inserts.

    Args:
        config: Resolved configuration; the database must be enabled and reachable.
        datasets: Generated datasets to load.
        recorder: Audit recorder to extend with raw/warehouse row counts and
            reconciliation results.
        sql_root: Directory containing the numbered SQL folders.

    Returns:
        A :class:`LoadResult` describing what was written.

    Raises:
        DatabaseLoadError: If an entity has no known raw table, or the merge SQL is
            missing.
        DatabaseUnavailableError: If PostgreSQL cannot be reached.
    """
    unknown = [d.entity_name for d in datasets if d.entity_name not in ENTITY_TABLES]
    if unknown:
        raise DatabaseLoadError(
            f"No raw landing table is defined for entity/entities: {', '.join(unknown)}.",
            entity=unknown[0],
        )
    merge_scripts = discover_merge_sql(sql_root)
    load_batch_id = uuid.uuid4()
    raw_counts: dict[str, int] = {}
    warehouse_counts: dict[str, int] = {}

    with connect(config) as connection:
        for dataset in datasets:
            raw_counts[dataset.entity_name] = _copy_into_raw(connection, dataset, load_batch_id)
            connection.commit()

        for script in merge_scripts:
            _execute_script(connection, script)
        connection.commit()

        for dataset in datasets:
            warehouse_counts[dataset.entity_name] = _warehouse_row_count(
                connection, ENTITY_TABLES[dataset.entity_name][1]
            )

        _record_counts(recorder, datasets, raw_counts, warehouse_counts)
        _insert_audit_rows(connection, recorder)
        connection.commit()

    return LoadResult(
        load_batch_id=load_batch_id,
        raw_row_counts=raw_counts,
        warehouse_row_counts=warehouse_counts,
        executed_sql=tuple(merge_scripts),
    )


def _copy_into_raw(connection: Any, dataset: GeneratedDataset, load_batch_id: uuid.UUID) -> int:
    """COPY one dataset into its raw landing table and return the row count."""
    raw_table = ENTITY_TABLES[dataset.entity_name][0]
    columns = [*dataset.actual_columns, *RAW_METADATA_COLUMNS]
    statement = sql.SQL("COPY {}.{} ({}) FROM STDIN").format(
        sql.Identifier(SCHEMA_RAW),
        sql.Identifier(raw_table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
    )
    source_file_name = f"{dataset.entity_name}.csv"
    copied = 0
    with connection.cursor() as cursor, cursor.copy(statement) as copy:
        for record in rows_for_copy(
            dataset.frame, load_batch_id=load_batch_id, source_file_name=source_file_name
        ):
            copy.write_row(record)
            copied += 1
    _LOGGER.info(
        "Copied %s row(s) into %s.%s (batch %s).",
        copied,
        SCHEMA_RAW,
        raw_table,
        load_batch_id,
    )
    return copied


def _execute_script(connection: Any, script: Path) -> None:
    """Execute one repository-controlled SQL script."""
    statement = script.read_text(encoding="utf-8")
    with connection.cursor() as cursor:
        cursor.execute(statement)
    _LOGGER.info("Executed merge script %s.", script)


def _warehouse_row_count(connection: Any, table: str) -> int:
    """Count the rows currently present in a warehouse table."""
    statement = sql.SQL("SELECT count(*) FROM {}.{}").format(
        sql.Identifier(SCHEMA_WAREHOUSE), sql.Identifier(table)
    )
    with connection.cursor() as cursor:
        cursor.execute(statement)
        row = cursor.fetchone()
    return int(row[0]) if row else 0


def _record_counts(
    recorder: AuditRecorder,
    datasets: Sequence[GeneratedDataset],
    raw_counts: dict[str, int],
    warehouse_counts: dict[str, int],
) -> None:
    """Record raw/warehouse row counts and the row-count reconciliations."""
    for dataset in datasets:
        entity = dataset.entity_name
        recorder.record_row_count(entity, LAYER_RAW, raw_counts[entity])
        recorder.record_row_count(entity, LAYER_WAREHOUSE, warehouse_counts[entity])
        recorder.record_reconciliation(
            ReconciliationResult(
                reconciliation_id=ENTITY_RECONCILIATIONS[entity],
                description=f"Generated {entity} rows equal warehouse.{entity} rows.",
                left_source=f"generator:{entity}",
                left_value=float(dataset.row_count),
                right_source=f"{SCHEMA_WAREHOUSE}.{entity}",
                right_value=float(warehouse_counts[entity]),
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

        for table in (
            "pipeline_run_row_count",
            "validation_result",
            "reconciliation_result",
        ):
            for row in rows[table]:
                payload = {"pipeline_run_id": pipeline_run_id, **row}
                cursor.execute(
                    _insert_statement(table, tuple(payload.keys())), tuple(payload.values())
                )
    _LOGGER.info("Recorded audit rows for pipeline_run_id %s.", pipeline_run_id)


def _insert_statement(table: str, columns: tuple[str, ...]) -> sql.Composed:
    """Build a parameterised ``INSERT`` for an audit table."""
    return sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
        sql.Identifier(SCHEMA_AUDIT),
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )
