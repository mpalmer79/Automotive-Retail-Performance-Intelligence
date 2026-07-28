"""Deterministic CSV and manifest writer.

CSV rows are rendered with the standard library ``csv`` module rather than
``DataFrame.to_csv`` so the dialect is pinned exactly: UTF-8, ``\\n`` line endings, a
header row, ISO-8601 dates, lowercase ``true``/``false`` booleans and an empty field for
NULL. The same rendering rules produce the SCD ``attribute_hash``, so hashes recomputed
from a committed CSV agree with the generator.

No wall-clock timestamp is ever written: re-running the generator must produce
byte-identical files so that ``git diff`` on ``data/sample/`` is meaningful.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

from arpi.constants import (
    ARPI_VERSION,
    CSV_BOOLEAN_FALSE,
    CSV_BOOLEAN_TRUE,
    CSV_DELIMITER,
    CSV_ENCODING,
    CSV_FILE_SUFFIX,
    CSV_LINE_TERMINATOR,
    CSV_NULL_REPRESENTATION,
    CSV_QUOTE_CHAR,
    ENTITY_DIM_DEALERSHIP,
    GENERATOR_MODULE,
    ISO_DATE_FORMAT,
    MANIFEST_FILENAME,
    MANIFEST_TIMESTAMP_POLICY,
    PROJECT_NAME,
    SHORT_NAME,
    SYNTHETIC_DATA_NOTICE,
)
from arpi.utilities.hashing import content_digest

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset


@dataclass(frozen=True, slots=True)
class WrittenEntity:
    """Bookkeeping for one entity written to disk.

    Attributes:
        entity: Warehouse entity name.
        path: File that was written.
        row_count: Number of data rows written (excluding the header).
        column_count: Number of columns written.
        content_digest: SHA-256 hex digest of the exact bytes written.
        truncated: ``True`` when a sample row cap dropped rows.
    """

    entity: str
    path: Path
    row_count: int
    column_count: int
    content_digest: str
    truncated: bool

    def as_manifest_entry(self) -> dict[str, Any]:
        """Render this entity as a ``generated_entities`` manifest entry."""
        return {
            "entity": self.entity,
            "row_count": self.row_count,
            "column_count": self.column_count,
            "content_digest": self.content_digest,
        }


def format_value(value: Any) -> str:
    """Render a single cell using the ARPI CSV dialect.

    Args:
        value: Cell value taken from a pandas frame.

    Returns:
        ``""`` for NULL, ``"true"``/``"false"`` for booleans, ``YYYY-MM-DD`` for dates
        and timestamps, and ``str(value)`` otherwise.
    """
    if value is None or value is pd.NaT or (not isinstance(value, str) and pd.isna(value)):
        return CSV_NULL_REPRESENTATION
    if isinstance(value, bool):
        return CSV_BOOLEAN_TRUE if value else CSV_BOOLEAN_FALSE
    if isinstance(value, pd.Timestamp | datetime):
        return value.strftime(ISO_DATE_FORMAT)
    if isinstance(value, date):
        return value.strftime(ISO_DATE_FORMAT)
    return str(value)


def dataframe_to_csv_bytes(frame: pd.DataFrame, *, row_limit: int | None = None) -> bytes:
    """Serialise a frame to CSV bytes using the ARPI dialect.

    Args:
        frame: Frame to serialise. Column order is preserved verbatim.
        row_limit: Optional cap on the number of data rows.

    Returns:
        UTF-8 encoded CSV bytes, ``\\n`` terminated, with a header row.
    """
    limited = frame if row_limit is None else frame.head(row_limit)
    buffer = io.StringIO(newline="")
    writer = csv.writer(
        buffer,
        delimiter=CSV_DELIMITER,
        quotechar=CSV_QUOTE_CHAR,
        lineterminator=CSV_LINE_TERMINATOR,
        quoting=csv.QUOTE_MINIMAL,
    )
    writer.writerow([str(column) for column in limited.columns])
    for row in limited.itertuples(index=False, name=None):
        writer.writerow([format_value(value) for value in row])
    return buffer.getvalue().encode(CSV_ENCODING)


def write_dataset(
    dataset: GeneratedDataset,
    output_dir: Path,
    *,
    row_limit: int | None = None,
) -> WrittenEntity:
    """Write one dataset to ``<output_dir>/<entity_name>.csv``.

    Args:
        dataset: Dataset to write.
        output_dir: Directory previously validated by
            :func:`arpi.utilities.paths.resolve_output_dir`.
        row_limit: Optional cap on the number of data rows, used for sample outputs.

    Returns:
        Bookkeeping describing the file that was written.
    """
    payload = dataframe_to_csv_bytes(dataset.frame, row_limit=row_limit)
    path = output_dir / f"{dataset.entity_name}{CSV_FILE_SUFFIX}"
    path.write_bytes(payload)
    written_rows = (
        dataset.row_count if row_limit is None else min(dataset.row_count, row_limit)
    )
    return WrittenEntity(
        entity=dataset.entity_name,
        path=path,
        row_count=written_rows,
        column_count=dataset.column_count,
        content_digest=content_digest(payload),
        truncated=written_rows < dataset.row_count,
    )


def build_manifest(config: ArpiConfig, entities: Sequence[WrittenEntity]) -> dict[str, Any]:
    """Build the manifest document for a set of written entities.

    Args:
        config: Resolved configuration describing the run.
        entities: Entities that were written, in write order.

    Returns:
        A JSON-serialisable manifest containing no wall-clock timestamp.
    """
    return {
        "project": PROJECT_NAME,
        "short_name": SHORT_NAME,
        "arpi_version": ARPI_VERSION,
        "profile": config.profile,
        "random_seed": config.random_seed,
        "reporting_start_date": config.reporting.start_date.isoformat(),
        "reporting_end_date": config.reporting.end_date.isoformat(),
        "generated_entities": [entity.as_manifest_entry() for entity in entities],
        "synthetic_data_notice": SYNTHETIC_DATA_NOTICE,
        "generator_module": GENERATOR_MODULE,
        "timestamp_policy": MANIFEST_TIMESTAMP_POLICY,
    }


def write_manifest(
    config: ArpiConfig,
    entities: Sequence[WrittenEntity],
    output_dir: Path,
) -> Path:
    """Write ``generation_manifest.json`` next to the generated CSVs.

    Args:
        config: Resolved configuration describing the run.
        entities: Entities that were written, in write order.
        output_dir: Directory previously validated by
            :func:`arpi.utilities.paths.resolve_output_dir`.

    Returns:
        The path of the manifest that was written.
    """
    manifest = build_manifest(config, entities)
    path = output_dir / MANIFEST_FILENAME
    payload = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    path.write_text(payload, encoding=CSV_ENCODING, newline=CSV_LINE_TERMINATOR)
    return path


def write_outputs(
    config: ArpiConfig,
    datasets: Sequence[GeneratedDataset],
    output_dir: Path,
    *,
    row_limit: int | None = None,
) -> tuple[tuple[WrittenEntity, ...], Path]:
    """Write every dataset plus the manifest into ``output_dir``.

    Args:
        config: Resolved configuration describing the run.
        datasets: Datasets to write, in the order they should appear in the manifest.
        output_dir: Directory previously validated by
            :func:`arpi.utilities.paths.resolve_output_dir`.
        row_limit: Optional cap applied to every dataset except ``dim_dealership``,
            which is always written in full (it has only three rows).

    Returns:
        A tuple of the written entities and the manifest path.
    """
    written = tuple(
        write_dataset(dataset, output_dir, row_limit=_limit_for(dataset, row_limit))
        for dataset in datasets
    )
    return written, write_manifest(config, written, output_dir)


def _limit_for(dataset: GeneratedDataset, row_limit: int | None) -> int | None:
    """Return the row cap for one dataset; dealership rows are never truncated."""
    if dataset.entity_name == ENTITY_DIM_DEALERSHIP:
        return None
    return row_limit
