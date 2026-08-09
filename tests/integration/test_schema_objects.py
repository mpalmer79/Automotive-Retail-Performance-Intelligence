"""The SQL initialisation sequence builds the objects it claims to, and is rerunnable."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from arpi.constants import REPORTING_VIEWS

pytestmark = pytest.mark.integration


EXPECTED_SCHEMAS = ("audit", "raw", "reporting", "staging", "warehouse")

#: Every entity that has a raw landing table, in the order sql/01_raw declares them.
#:
#: Kept as a literal list rather than derived from the ingestion registry: this test is
#: meant to fail when an object appears that nobody wrote down, so deriving the expected
#: set from the same code that creates it would defeat the purpose.
RAW_ENTITIES = (
    "calendar_date_load",
    "dealership_load",
    "vehicle_model_load",
    "vehicle_load",
    "employee_load",
    "customer_load",
    "lead_source_load",
    "marketing_campaign_load",
    "acquisition_event_load",
    "sale_event_load",
    "lead_load",
    "appointment_load",
    "marketing_spend_load",
    "inventory_snapshot_load",
    # The sanitized public listing lane (ADR-0011).
    "inventory_listing_snapshot_load",
    # The dashboard program's operating plan (ADR-0013, DASH.5).
    "sales_target_load",
    # The DASH.6 F&I lane (ADR-0013): two dimensions and two facts in natural-key form.
    "finance_product_load",
    "lender_load",
    "finance_product_sale_load",
    "finance_product_adjustment_load",
    # The DASH.8 inventory accounting and GL control lane (ADR-0013): the stock schedule,
    # the selected control-account catalogue and the control balances.
    "inventory_accounting_load",
    "gl_account_load",
    "gl_control_balance_load",
)

#: Entities whose staging layer follows the Phase 1 three-view pattern:
#: ``stg_<entity>_typed``, ``stg_<entity>`` and ``stg_<entity>_rejected``.
STAGING_ENTITIES = (
    "vehicle_model",
    "vehicle",
    "employee",
    "customer",
    "lead_source",
    "marketing_campaign",
    "acquisition_event",
    "sale_event",
    "lead",
    "appointment",
    "marketing_spend",
    "inventory_snapshot",
    "inventory_listing_snapshot",
    "sales_target",
    # The DASH.6 F&I lane. Two dimensions and two facts in natural-key form, landed
    # like every other entity so they get the same rejected-record path and the same
    # five-layer row-count chain.
    "finance_product",
    "lender",
    "finance_product_sale",
    "finance_product_adjustment",
    # The DASH.8 accounting control lane, landed the same way and for the same reasons.
    "inventory_accounting",
    "gl_account",
    "gl_control_balance",
)

#: The conformed dimensions.
DIMENSION_TABLES = (
    "dim_date",
    "dim_dealership",
    "dim_vehicle_model",
    "dim_vehicle",
    "dim_employee",
    "dim_customer",
    "dim_lead_source",
    "dim_marketing_campaign",
)

#: The DASH.6 F&I dimensions. Held apart from DIMENSION_TABLES for the same reason
#: fact_sales_target is held apart from the MVP facts: "eight conformed dimensions" is
#: the number the semantic model and the SQL baseline were measured against, and these
#: two belong to the dashboard-program lane that the model does not read.
FI_DIMENSION_TABLES = (
    "dim_finance_product",
    "dim_lender",
)

#: The DASH.8 control-account catalogue. Held apart for the same reason again, and with
#: one more of its own: it is a SELECTED control catalogue rather than a conformed
#: dimension -- three inventory accounts, never a chart of accounts.
ACCOUNTING_DIMENSION_TABLES = ("dim_gl_account",)

#: The fact tables. Five MVP facts, the listing lane's, and the target lane's; this module builds a
#: structure-only database and never runs the pipeline, which is what
#: test_the_sql_sequence_alone_loads_no_data relies on.
FACT_TABLES = (
    "fact_vehicle_sale",
    "fact_vehicle_inventory_snapshot",
    "fact_lead",
    "fact_appointment",
    "fact_marketing_spend",
    # The sanitized public listing lane (ADR-0011). Structurally a sixth fact and
    # deliberately not a sixth MVP fact: it is loaded by a workbook import rather than by
    # a pipeline run, so it is absent from arpi.ingestion.spec.ENTITY_SPECS and is empty
    # in a structure-only database exactly as the other five are.
    "fact_vehicle_listing_snapshot",
    # The dashboard program's operating plan (ADR-0013, DASH.5). Structurally a seventh
    # fact and deliberately not a sixth MVP fact: the MVP baseline the semantic model was
    # measured against describes five, and this table holds a PLAN rather than a measured
    # result. It IS in arpi.ingestion.spec.ENTITY_SPECS and loads on every pipeline run.
    "fact_sales_target",
    # The DASH.6 F&I facts (ADR-0013). Structurally the eighth and ninth, and
    # deliberately not MVP facts either: they belong to the dashboard-program lane.
    # Both ARE in arpi.ingestion.spec.ENTITY_SPECS and load on every pipeline run.
    "fact_finance_product_sale",
    "fact_finance_product_adjustment",
    # The DASH.8 accounting facts (ADR-0013). Structurally the tenth and eleventh, and
    # deliberately not MVP facts: they belong to the accounting control lane, which the
    # semantic model does not read and for which no browser dataset is exported. Both ARE
    # in arpi.ingestion.spec.ENTITY_SPECS and load on every pipeline run.
    "fact_inventory_accounting_snapshot",
    "fact_gl_control_balance",
)

EXPECTED_TABLES = {
    ("audit", "pipeline_run"),
    ("audit", "pipeline_run_row_count"),
    ("audit", "reconciliation_result"),
    ("audit", "rejected_record"),
    ("audit", "schema_migration"),
    ("audit", "validation_result"),
    *(("raw", name) for name in RAW_ENTITIES),
    *(("warehouse", name) for name in DIMENSION_TABLES),
    *(("warehouse", name) for name in FI_DIMENSION_TABLES),
    *(("warehouse", name) for name in ACCOUNTING_DIMENSION_TABLES),
    ("warehouse", "dim_observed_vehicle"),
    *(("warehouse", name) for name in FACT_TABLES),
}

#: The audit-schema views: the data-quality check views and the reconciliation views.
AUDIT_VIEWS = (
    "vw_dq_all",
    "vw_dq_audit",
    "vw_dq_dim_date",
    "vw_dq_dim_dealership",
    "vw_dq_referential",
    "vw_dq_result_template",
    "vw_recon_all",
    "vw_recon_funnel",
    "vw_recon_gross",
    "vw_recon_fi",
    "vw_recon_ingestion",
    # The listing lane's reconciliations. Deliberately NOT unioned into vw_recon_all --
    # that view is the pipeline's per-run set with a published identifier list and an
    # asserted per-run count, and this lane runs on a workbook cadence instead. See the
    # view's own header.
    "vw_recon_inventory_listing",
    "vw_recon_marketing",
    "vw_recon_reporting",
    "vw_recon_result_template",
    # The target domain's reconciliations (DASH.5). Unioned INTO vw_recon_all, unlike the
    # listing lane's: the operating plan loads on every pipeline run, so its chain,
    # grain, department partition and reporting totals are per-run evidence.
    "vw_recon_target",
    # The accounting domain's reconciliations (DASH.8). Unioned INTO vw_recon_all: the
    # schedule and the control balances load on every pipeline run, so the book-value
    # identity, both grains and the GL comparison are per-run evidence.
    "vw_recon_accounting",
    # The unit-grain inventory view's reconciliations (DASH.9). Unioned INTO vw_recon_all:
    # reporting.vw_inventory_units reads the fact directly and so REPEATS the
    # price_to_market_ratio expression rather than selecting it, and a duplicated rule that
    # is only checked when somebody remembers is not checked. Both rules are per-run
    # evidence -- the ratio agreeing between the two views, and the reportable-date
    # narrowing neither duplicating nor dropping a snapshot.
    "vw_recon_inventory_units",
)

EXPECTED_VIEWS = {
    *(("audit", name) for name in AUDIT_VIEWS),
    *(("reporting", name) for name in REPORTING_VIEWS),
    ("staging", "stg_calendar_date"),
    ("staging", "stg_dealership"),
    *(("staging", f"stg_{name}") for name in STAGING_ENTITIES),
    *(("staging", f"stg_{name}_typed") for name in STAGING_ENTITIES),
    *(("staging", f"stg_{name}_rejected") for name in STAGING_ENTITIES),
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


def test_exactly_the_declared_fact_tables_exist(cursor: Any) -> None:
    """The fact tables are exactly the ones the contract declares -- no more.

    Seven, across three lanes: the five MVP facts, the sanitized listing lane's, and
    the dashboard program's operating plan. The MVP baseline still describes five,
    which is a claim about the semantic model rather than about this schema.
    """
    cursor.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'warehouse' AND table_name LIKE 'fact\\_%'
        """
    )
    assert {row[0] for row in cursor.fetchall()} == set(FACT_TABLES)


def test_the_sql_sequence_alone_loads_no_data(cursor: Any) -> None:
    """Applying the SQL tree builds structure and inserts nothing.

    This database was built by running the initialisation sequence and nothing else. A
    fact table holding rows here would mean a DDL script had started inserting data,
    which would make the sequence non-idempotent in a way row counts would hide: a second
    application would double the rows. Populated facts are asserted separately, against
    the `loaded_database` fixture, which runs the real pipeline.
    """
    for table in FACT_TABLES:
        # The table name comes from the literal FACT_TABLES tuple above, never from input.
        cursor.execute(f"SELECT count(*) FROM warehouse.{table}")
        row = cursor.fetchone()
        assert row is not None
        assert row[0] == 0, (
            f"warehouse.{table} holds rows after a structure-only build; a DDL script is "
            "inserting data, which makes the initialisation sequence non-idempotent"
        )


def test_reporting_layer_contains_exactly_the_declared_views(cursor: Any) -> None:
    """The reporting surface is fixed by arpi.constants.REPORTING_VIEWS and nothing else.

    A view added to sql/05_reporting without being declared there is invisible to the
    completeness, reporter-role and Gate 1 checks, which all read the same tuple. This
    test is what stops that happening quietly.
    """
    cursor.execute(
        """
        SELECT table_name FROM information_schema.views
        WHERE table_schema = 'reporting' ORDER BY table_name
        """
    )
    assert [row[0] for row in cursor.fetchall()] == list(REPORTING_VIEWS)


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
        *(f"reporting.{name}" for name in REPORTING_VIEWS),
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
    assert [path.name for path in merge_files] == [
        "10_dim_date_merge.sql",
        "11_dim_dealership_merge.sql",
        "12_dim_vehicle_model_merge.sql",
        "13_dim_vehicle_merge.sql",
        "14_dim_employee_merge.sql",
        "15_dim_customer_merge.sql",
        "16_dim_lead_source_merge.sql",
        "17_dim_marketing_campaign_merge.sql",
        # DASH.6. Numbered 21 and 22 so they sort after every MVP merge and after the
        # two F&I dimension DDL files (19 and 20) that create the tables they write.
        "21_dim_finance_product_merge.sql",
        "22_dim_lender_merge.sql",
        # DASH.8. Numbered 25 so it sorts after the DDL file (24) that creates the table
        # it writes, and after every merge above it.
        "25_dim_gl_account_merge.sql",
    ], "the loader runs these in sorted order; the list must stay explicit"

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
