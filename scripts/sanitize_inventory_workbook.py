#!/usr/bin/env python3
r"""Sanitize a private dealership inventory workbook into a governed public artifact.

This is the documented Chromebook-friendly entry point. It is a thin wrapper over
``arpi sanitize-inventory``: one implementation, two ways to reach it, so a change to the
sanitizer cannot leave the script and the CLI disagreeing.

Usage
-----
    python scripts/sanitize_inventory_workbook.py \\
      --input /private/path/source.xlsx \\
      --dealership-id GSA-001 \\
      --captured-at 2026-08-02 \\
      --output data/reference/inventory/gsa-001/2026-08-02/\
ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx

Omit ``--output`` and the approved underscore-based name is derived for you:

    ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx

Add ``--dry-run`` to see the row count, the contract result, how many identifiers would be
replaced, how many URLs would be removed and the intended output path -- without writing.

THE PRIVATE INPUT NEVER ENTERS THE REPOSITORY. Keep it outside the working tree. Nothing
here prints an original VIN, a source URL or a source row; errors name a row, a column and
a validation category.

Exit codes
----------
    0  the artifact was produced, or the dry run passed
    1  the private workbook failed the input contract, or the output already exists
    2  the configuration is invalid
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from arpi.cli import main


def run(argv: list[str] | None = None) -> int:
    """Forward to ``arpi sanitize-inventory``.

    Args:
        argv: Arguments excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    return main(["sanitize-inventory", *(argv if argv is not None else sys.argv[1:])])


if __name__ == "__main__":
    raise SystemExit(run())
