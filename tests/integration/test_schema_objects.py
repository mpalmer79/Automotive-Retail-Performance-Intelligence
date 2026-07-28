"""The SQL initialisation sequence builds the objects it claims to, and is rerunnable."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

pytestmark = pytest.mark.integration


EXPECTED_SCHEMAS = ("audit", "raw", "reporting", "staging", "warehouse")

EXPECTED_TABLES = {
    ("audit", "pipeline_run"),
    ("audit", "pipeline_run_row_count"),
    ("audit", "reconciliation_result"),
    ("audit", "rejected_record"),
    ("audit", "validation_result"),
    ("raw", "calendar_date_load"),
    ("raw", "dealership_load"),
    ("warehouse", "dim_date"),
    ("warehouse", "dim_dealership"),
}

EXPECTED_VIEWS = {
    ("audit", "vw_dq_all"),
    ("audit", "vw_dq_audit"),
    ("audit", "vw_dq_dim_date"),
    ("audit", "vw_dq_dim_dealership"),
    ("audit", "vw_dq_referential"),
    ("audit", "vw_dq_result_template"),
    ("reporting", "vw_calendar"),
    ("reporting", "vw_data_quality_summary"),
    ("reporting", "vw_dealership"),
    ("reporting", "vw_pipeline_run_summary"),
    ("staging", "stg_calendar_date"),
    ("staging", "stg_dealership"),
}

# The 26 columns of the dim_date contract, in the exact order they must appear.
DIM_DATE_COLUMNS = [
    "date_key",
    "full_date",
    "day_of_month",
    "day_name",
    "day_of_week",
    "day_of_year",
    "week_of_year",
    "iso_year",
    "month_number",
    "month_name",
    "month_start_date",
    "month_end_date",
    "quarter_number",
    "quarter_name",
    "calendar_year",
    "fiscal_month",
    "fiscal_quarter",
    "fiscal_year",
    "is_weekend",
    "is_month_end",
    "is_quarter_end",
    "is_year_end",
    "is_holiday",
    "holiday_name",
    "is_closure_holiday",
    "is_selling_day",
]

# The 16 columns of the dim_dealership contract, in the exact order they must appear.
DIM_DEALERSHIP_COLUMNS = [
    "dealership_key",
    "dealership_id",
    "store_name",
    "store_short_name",
    "store_type",
    "franchise_brand",
    "city",
    "state_code",
    "market_region",
    "opened_date",
    "is_active",
    "effective_date",
    "expiration_date",
    "is_current",
    "attribute_hash",
    "source_system",
]


def _catalog_snapshot(cur: Any) -> list[tuple[str, str, str]]:
    """Every relation in the five ARPI schemas, as a stable sorted list."""
    cur.execute(
        """
        SELECT n.nspname, c.relname, c.relkind::text
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i')
        ORDER BY n.nspname, c.relname, c.relkind
        """
    )
    return [(row[0], row[1], row[2]) for row in cur.fetchall()]


def test_init_sequence_is_not_empty(sql_init_files: list[Path]) -> None:
    """A glob that silently matches nothing would make every other test vacuous."""
    files = sql_init_files
    assert len(files) >= 24
    relative = [p.as_posix() for p in files]
    assert any(p.endswith("00_database/00_create_schemas.sql") for p in relative)
    assert any(p.endswith("08_validation/04_audit_checks.sql") for p in relative)
    # The destructive script must never appear in the build sequence.
    assert not any("99_local_reset" in p for p in relative)
    # Nor should the read-only operator report.
    assert not any("02_role_verification" in p for p in relative)


def test_all_five_schemas_exist(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT nspname FROM pg_namespace
        WHERE nspname IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
        ORDER BY nspname
        """
    )
    assert [row[0] for row in cursor.fetchall()] == list(EXPECTED_SCHEMAS)


def test_every_schema_is_documented(cursor: Any) -> None:
    """A layer without a comment is a layer nobody has to justify."""
    cursor.execute(
        """
        SELECT nspname, obj_description(oid, 'pg_namespace')
        FROM pg_namespace
        WHERE nspname IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
        """
    )
    for schema_name, comment in cursor.fetchall():
        assert comment, f"schema {schema_name} has no COMMENT ON SCHEMA"


def test_expected_tables_exist(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
          AND table_type = 'BASE TABLE'
        """
    )
    assert {(row[0], row[1]) for row in cursor.fetchall()} == EXPECTED_TABLES


def test_expected_views_exist(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT table_schema, table_name
        FROM information_schema.views
        WHERE table_schema IN ('raw', 'staging', 'warehouse', 'reporting', 'audit')
        """
    )
    assert {(row[0], row[1]) for row in cursor.fetchall()} == EXPECTED_VIEWS


def test_no_fact_tables_exist_yet(cursor: Any) -> None:
    """Phase 0 has no facts. A stray fact table would make the reporting layer a lie."""
    cursor.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'warehouse' AND table_name LIKE 'fact\\_%'
        """
    )
    assert cursor.fetchall() == []


def test_reporting_layer_contains_exactly_four_views(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT table_name FROM information_schema.views
        WHERE table_schema = 'reporting' ORDER BY table_name
        """
    )
    assert [row[0] for row in cursor.fetchall()] == [
        "vw_calendar",
        "vw_data_quality_summary",
        "vw_dealership",
        "vw_pipeline_run_summary",
    ]


@pytest.mark.parametrize(
    ("table_name", "expected_columns"),
    [("dim_date", DIM_DATE_COLUMNS), ("dim_dealership", DIM_DEALERSHIP_COLUMNS)],
)
def test_dimension_columns_match_the_contract_in_order(
    cursor: Any, table_name: str, expected_columns: list[str]
) -> None:
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'warehouse' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table_name,),
    )
    assert [row[0] for row in cursor.fetchall()] == expected_columns


@pytest.mark.parametrize("table_name", ["dim_date", "dim_dealership"])
def test_every_dimension_column_is_documented(cursor: Any, table_name: str) -> None:
    cursor.execute(
        """
        SELECT a.attname, col_description(a.attrelid, a.attnum)
        FROM pg_attribute AS a
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        """,
        (f"warehouse.{table_name}",),
    )
    for column_name, comment in cursor.fetchall():
        assert comment, f"warehouse.{table_name}.{column_name} has no COMMENT ON COLUMN"


@pytest.mark.parametrize(
    "qualified_name",
    [
        "warehouse.dim_date",
        "warehouse.dim_dealership",
        "audit.pipeline_run",
        "audit.validation_result",
        "staging.stg_calendar_date",
        "staging.stg_dealership",
        "reporting.vw_calendar",
        "reporting.vw_dealership",
        "reporting.vw_pipeline_run_summary",
        "reporting.vw_data_quality_summary",
    ],
)
def test_object_comment_declares_a_grain(cursor: Any, qualified_name: str) -> None:
    cursor.execute("SELECT obj_description(%s::regclass, 'pg_class')", (qualified_name,))
    comment = cursor.fetchone()[0]
    assert comment, f"{qualified_name} has no COMMENT ON TABLE/VIEW"
    assert "grain" in comment.lower(), f"{qualified_name} does not declare its grain"


def test_init_sequence_is_rerunnable(db: Any, init_sequence_runner: Any) -> None:
    """Run the whole sequence a second time: no error, no duplicated object.

    This is the single most important guarantee in ``sql/``. It is what lets an
    operator re-apply the tree after a change without reasoning about which files
    have already been applied.
    """
    with db.cursor() as cur:
        before = _catalog_snapshot(cur)
    assert before, "the initialised database contains no relations at all"

    executed = init_sequence_runner(db)
    assert len(executed) >= 24

    with db.cursor() as cur:
        after = _catalog_snapshot(cur)

    assert after == before

    # And nothing was created twice under a mangled name.
    names = [(schema, name) for schema, name, kind in after if kind in ("r", "v", "S")]
    assert len(names) == len(set(names))


def test_merge_scripts_contain_no_psql_meta_commands(sql_root: Path) -> None:
    """The loader executes these through psycopg; a backslash command would crash it."""
    merge_files = sorted(sql_root.glob("03_dimensions/*_merge.sql"))
    assert len(merge_files) == 2, "expected exactly the dim_date and dim_dealership merges"

    forbidden = ("\\i ", "\\set ", "\\c ", "\\gexec", "\\copy", "\\echo")
    for path in merge_files:
        # Only executable SQL matters. The header comments of these files discuss
        # the forbidden meta-commands by name, which is exactly what makes the
        # constraint discoverable, so comment lines are stripped before scanning.
        statements = "\n".join(
            line
            for line in path.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("--")
        )
        for token in forbidden:
            assert token not in statements, f"{path.name} contains the psql meta-command {token!r}"
        assert "BEGIN;" not in statements.upper(), (
            f"{path.name} manages its own transaction; the loader owns it"
        )
        assert "COMMIT;" not in statements.upper(), (
            f"{path.name} manages its own transaction; the loader owns it"
        )


def test_every_sql_file_has_the_standard_header(sql_root: Path) -> None:
    """Every file in the tree documents its purpose, order, idempotency and ownership."""
    required = (
        "-- File:",
        "-- Project:",
        "-- Purpose:",
        "-- Execution order:",
        "-- Idempotency:",
        "-- Ownership:",
        "-- Grain:",
    )
    sql_files = sorted(sql_root.rglob("*.sql"))
    assert len(sql_files) >= 25

    for path in sql_files:
        head = path.read_text(encoding="utf-8")[:2000]
        for label in required:
            assert label in head, (
                f"{path.relative_to(sql_root)} is missing the '{label}' header line"
            )
