"""Optional PostgreSQL ingestion.

Everything in this subpackage degrades gracefully: ``psycopg`` is an optional dependency
(``pip install "arpi[db]"``), and a run without a reachable database is *skipped*, never
failed.
"""

from __future__ import annotations

from arpi.ingestion.database import PSYCOPG_AVAILABLE, database_available

__all__ = ["PSYCOPG_AVAILABLE", "database_available"]
