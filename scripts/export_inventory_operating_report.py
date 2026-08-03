#!/usr/bin/env python3
r"""Export the Excel listing operating report for one store and capture date.

A thin wrapper over ``arpi export-inventory-report``.

Usage
-----
    python scripts/export_inventory_operating_report.py \\
      --dealership-id GSA-001 \\
      --captured-at 2026-08-02 \\
      --output artifacts/inventory/ARPI_Granite_Chevrolet_Inventory_Report_2026-08-02.xlsx

Omit ``--output`` and the approved underscore-based name is derived for you:

    artifacts/inventory/ARPI_<Store_Descriptor>_Inventory_Report_<yyyy-mm-dd>.xlsx

Everything in the produced workbook comes from the reporting views over the warehouse --
never from the sanitized input workbook, because a report assembled from its own source
would prove nothing about the load.

The Snapshot Changes sheet appears only when a prior capture exists for the same store.
It labels vehicles New Listing, Still Listed, Removed From Listing, Price Increase, Price
Reduction or Price Unchanged, and it has no Sold label because this data cannot support
one.

Exit codes
----------
    0  the report was written
    1  the warehouse holds no listings for that store and capture, or the database was
       unreachable
    2  the configuration is invalid
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from arpi.cli import main


def run(argv: list[str] | None = None) -> int:
    """Forward to ``arpi export-inventory-report``.

    Args:
        argv: Arguments excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    return main(["export-inventory-report", *(argv if argv is not None else sys.argv[1:])])


if __name__ == "__main__":
    raise SystemExit(run())
