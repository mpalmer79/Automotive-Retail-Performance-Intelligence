"""Entry point for ``python -m arpi``."""

from __future__ import annotations

import sys

from arpi.cli import main

if __name__ == "__main__":
    sys.exit(main())
