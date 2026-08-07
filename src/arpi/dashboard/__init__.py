"""The governed dashboard export lane (ADR-0013, ``DASH.1``).

This package is the single machine-readable authority for what the public operating
console may see. It contains no KPI arithmetic: every value it publishes was computed by
an approved ``reporting`` view, and the export's whole job is to select approved fields,
resolve surrogate keys to business codes, preserve exact values, order deterministically,
and record provenance.

Modules
-------
:mod:`arpi.dashboard.contract`
    The declarative contract: the source-view allowlist, every dataset's grain, business
    key, date basis, column list, types, nullability, privacy classification and display
    precision. Nothing else in the repository may declare an exportable field.
:mod:`arpi.dashboard.serialization`
    Canonical JSON, exact-decimal rendering, content hashing and query normalisation.
:mod:`arpi.dashboard.export`
    The exporter itself: generate and check modes over ``data/dashboard/``.

The command-line entry point is ``scripts/export_dashboard_dataset.py``.
"""

from __future__ import annotations

__all__ = ["contract", "export", "serialization"]
