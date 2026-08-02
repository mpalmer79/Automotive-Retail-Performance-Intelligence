#!/usr/bin/env python3
"""Import a committed sanitized listing workbook into PostgreSQL.

A thin wrapper over ``arpi load-inventory``, named as the workbook's own README sheet
names it so an operator following the artifact ends up in the right place.

Usage
-----
    python scripts/import_inventory_snapshot.py \\
      --workbook data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx \\
      --dealership-id GSA-001 \\
      --captured-at 2026-08-02

Add ``--dry-run`` to validate and report without writing, and ``--json`` for a
machine-readable summary.

The import is one transaction. It validates the workbook, lands it, stages it, merges the
observed vehicle dimension, loads the listing fact and evaluates every RECON-LISTING-* rule
before committing. A failed reconciliation rolls the whole thing back.

Reruns are safe: a workbook whose digest has already been imported does nothing at all.
A DIFFERENT workbook for a capture batch already loaded is refused, because a historical
listing snapshot is never silently restated -- see data/reference/README.md section 8.

Exit codes
----------
    0  the import succeeded, or the workbook had already been imported
    1  validation failed, a reconciliation failed, or the database was unreachable
    2  the configuration is invalid
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from arpi.cli import main  # noqa: E402 - the path shim above must run first


def run(argv: list[str] | None = None) -> int:
    """Forward to ``arpi load-inventory``.

    Args:
        argv: Arguments excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    return main(["load-inventory", *(argv if argv is not None else sys.argv[1:])])


if __name__ == "__main__":
    raise SystemExit(run())
