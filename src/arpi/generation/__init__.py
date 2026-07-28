"""Synthetic data generators for the ARPI warehouse.

Phase 0 implements the two foundation dimensions -- ``dim_date`` and
``dim_dealership`` -- plus the CSV/manifest writer. Fact generators are **Planned**,
not implemented.
"""

from __future__ import annotations

from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.calendar import CalendarDateGenerator, generate_date_dataset
from arpi.generation.dealership import DealershipGenerator, generate_dealership_dataset

__all__ = [
    "BaseGenerator",
    "CalendarDateGenerator",
    "DealershipGenerator",
    "GeneratedDataset",
    "generate_date_dataset",
    "generate_dealership_dataset",
]
