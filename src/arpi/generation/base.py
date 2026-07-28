"""Shared contract for every ARPI synthetic-data generator."""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import TYPE_CHECKING

import pandas as pd

from arpi.exceptions import GenerationError

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig


@dataclass(frozen=True, slots=True)
class GeneratedDataset:
    """A generated table plus the metadata the writer and validators need.

    Attributes:
        entity_name: Warehouse entity name, e.g. ``"dim_date"``.
        frame: The generated rows. Column order is significant and must match
            ``declared_columns`` exactly.
        declared_columns: The column contract this dataset claims to satisfy.
        namespace: Seeding namespace used by the generator, recorded for traceability.
    """

    entity_name: str
    frame: pd.DataFrame
    declared_columns: tuple[str, ...]
    namespace: str

    @property
    def row_count(self) -> int:
        """Number of rows in the generated frame."""
        return int(self.frame.shape[0])

    @property
    def column_count(self) -> int:
        """Number of columns in the generated frame."""
        return int(self.frame.shape[1])

    @property
    def actual_columns(self) -> tuple[str, ...]:
        """Column names actually present, in their actual order."""
        return tuple(str(column) for column in self.frame.columns)

    def schema_matches(self) -> bool:
        """Report whether the frame's columns match ``declared_columns`` exactly."""
        return self.actual_columns == self.declared_columns


class BaseGenerator(abc.ABC):
    """Abstract base class implemented by every entity generator.

    Subclasses declare the entity they produce, the column contract they satisfy and a
    stable seeding namespace, then implement :meth:`build_frame`.
    """

    #: Warehouse entity name produced by this generator.
    entity_name: str = ""

    #: The exact column names, in order, this generator guarantees.
    declared_columns: tuple[str, ...] = ()

    #: Stable seeding namespace; see :mod:`arpi.utilities.seeding`.
    namespace: str = ""

    @abc.abstractmethod
    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the raw frame for this entity.

        Args:
            config: Resolved configuration.

        Returns:
            A frame whose columns match :attr:`declared_columns` exactly.
        """

    def generate(self, config: ArpiConfig) -> GeneratedDataset:
        """Build the frame and wrap it, verifying the declared column contract.

        Args:
            config: Resolved configuration.

        Returns:
            The generated dataset.

        Raises:
            GenerationError: If the produced frame does not match the declared columns.
        """
        frame = self.build_frame(config)
        dataset = GeneratedDataset(
            entity_name=self.entity_name,
            frame=frame,
            declared_columns=self.declared_columns,
            namespace=self.namespace,
        )
        if not dataset.schema_matches():
            raise GenerationError(
                f"Generator for {self.entity_name!r} produced columns "
                f"{dataset.actual_columns} but declares {self.declared_columns}.",
                entity=self.entity_name,
            )
        return dataset
