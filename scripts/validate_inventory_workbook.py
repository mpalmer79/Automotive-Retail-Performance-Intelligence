#!/usr/bin/env python3
"""Validate a committed sanitized listing workbook against the governed contract.

A thin wrapper over ``arpi validate-inventory``.

Usage
-----
    python scripts/validate_inventory_workbook.py \\
      --workbook data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx

What it refuses
---------------
An original VIN column, a source URL anywhere, a value that looks like a real VIN, a
missing or wrong data classification, a real dealership identity, an unknown store, a
store name that disagrees with the ARPI dealership registry, a duplicated grain, record
identifier, synthetic vehicle identifier or synthetic VIN, a broken pricing contract, a
mileage below zero, an inventory unit count other than 1, a capture date that disagrees
with the directory, a file name that disagrees with the workbook's own contents, and a
snapshot directory holding more than one workbook.

Every finding names a row, a column and a validation category. None of them quotes the
offending value.

Exit codes
----------
    0  the workbook satisfies the contract
    1  at least one finding
    2  the configuration is invalid
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from arpi.cli import main  # noqa: E402 - the path shim above must run first


def run(argv: list[str] | None = None) -> int:
    """Forward to ``arpi validate-inventory``.

    Args:
        argv: Arguments excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    return main(["validate-inventory", *(argv if argv is not None else sys.argv[1:])])


if __name__ == "__main__":
    raise SystemExit(run())
