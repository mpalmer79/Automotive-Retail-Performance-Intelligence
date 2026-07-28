"""Automotive Retail Performance Intelligence (ARPI).

A synthetic automotive-retail analytics platform: deterministic data generation, a
dimensional PostgreSQL warehouse, a data-quality framework and an audited pipeline.

Every row ARPI produces is machine generated. Granite State Auto Group is fictional and
no real person, customer, employee or business is represented anywhere in this project.

Phase 0 implements: configuration, logging, the ``dim_date`` and ``dim_dealership``
generators, the validation framework, the CSV/manifest writer, the optional PostgreSQL
load, audit recording and the CLI. Fact tables, transformations and Power BI assets are
**Planned**, not implemented.
"""

from __future__ import annotations

from arpi.constants import ARPI_VERSION, PROJECT_NAME, SHORT_NAME, SYNTHETIC_DATA_NOTICE
from arpi.exceptions import (
    ArpiError,
    ConfigurationError,
    DatabaseLoadError,
    DatabaseUnavailableError,
    DataQualityError,
    GenerationError,
    ProfileNotFoundError,
    ValidationError,
)

__version__ = ARPI_VERSION

__all__ = [
    "PROJECT_NAME",
    "SHORT_NAME",
    "SYNTHETIC_DATA_NOTICE",
    "ArpiError",
    "ConfigurationError",
    "DataQualityError",
    "DatabaseLoadError",
    "DatabaseUnavailableError",
    "GenerationError",
    "ProfileNotFoundError",
    "ValidationError",
    "__version__",
]
