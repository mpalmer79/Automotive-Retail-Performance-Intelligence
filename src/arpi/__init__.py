"""Automotive Retail Performance Intelligence (ARPI).

A synthetic automotive-retail analytics platform: deterministic data generation, a
dimensional PostgreSQL warehouse, a data-quality framework and an audited pipeline.

Every row ARPI produces is machine generated. Granite State Auto Group is fictional and
no real person, customer, employee or business is represented anywhere in this project.

This package implements: configuration, logging, fourteen deterministic generators, the
validation framework, the CSV/manifest writer, the optional PostgreSQL load of eight
conformed dimensions and five MVP facts, audit recording and the CLI. The warehouse
transformations live in ``sql/`` rather than here, deliberately. The Power BI model
source lives under ``powerbi/``; no engine has executed it, so nothing here reports a
validated semantic model.
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
