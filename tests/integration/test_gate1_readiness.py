"""The automated half of the Gate 1 readiness review.

``docs/requirements/GATE_1_READINESS.md`` records the verdict. This module is the
evidence behind the conditions that can be checked mechanically, so the verdict rests on
assertions rather than on someone's reading of the schema.

Gate 1 itself is three conditions (ARCHITECTURE.md section 28): fact grains approved,
dimensions documented, KPI formulas documented. "Approved" is defined by ``P1.5-04`` as
**built, enforced by a database constraint, and tested** -- which is what most of this
file checks. The remaining conditions come from ``P1.5-03`` and ``P1.5-04``: every KPI
computable, the reporter isolated, the calendar covering every fact, the critical
reconciliations passing, the fairness context available, and no Power BI artefact built
before the gate opens.

What this file deliberately does NOT do is decide the verdict. A test that asserted
"Gate 1 is open" would pass by construction the moment someone edited the assertion. The
verdict is a written decision in the readiness document, and these tests are its
evidence.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from arpi.constants import (
    CRITICAL_SQL_RECONCILIATION_IDS,
    KPI_IDS,
    KPI_VIEW_OWNERSHIP,
    MVP_DIMENSION_VIEWS,
    MVP_FACT_VIEWS,
    REPORTING_VIEWS,
)

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]

#: The eight MVP dimensions, as fixed by DATA_DICTIONARY.md Part B.
MVP_DIMENSIONS: tuple[str, ...] = (
    "dim_date",
    "dim_dealership",
    "dim_vehicle_model",
    "dim_vehicle",
    "dim_employee",
    "dim_customer",
    "dim_lead_source",
    "dim_marketing_campaign",
)

#: Each MVP fact and the UNIQUE or PRIMARY KEY constraint that enforces its declared
#: grain. "Approved" means this constraint exists and holds -- a grain declared in a
#: document and unenforced in the database is a claim, not a control.
FACT_GRAIN_CONSTRAINTS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "fact_vehicle_sale",
        "uq_fact_vehicle_sale_sale_id",
        ("sale_id",),
    ),
    (
        "fact_vehicle_inventory_snapshot",
        "uq_fact_vehicle_inventory_snapshot_grain",
        ("snapshot_date_key", "dealership_key", "vehicle_key"),
    ),
    ("fact_lead", "uq_fact_lead_lead_id", ("lead_id",)),
    ("fact_appointment", "uq_fact_appointment_appointment_id", ("appointment_id",)),
    (
        "fact_marketing_spend",
        "uq_fact_marketing_spend_grain",
        ("month_date_key", "dealership_key", "campaign_key"),
    ),
)

#: The fairness context ARCHITECTURE.md section 23 requires alongside any employee
#: comparison, and the reporting column that supplies each one. Ranking a salesperson
#: without these penalises whoever was handed the harder inventory.
FAIRNESS_CONTEXT: tuple[tuple[str, str, str], ...] = (
    ("lead volume received", "vw_lead_funnel", "leads_received"),
    ("lead-source mix", "vw_leads", "lead_source_key"),
    ("store traffic", "vw_appointment_funnel", "shown_appointments"),
    ("tenure", "vw_employee", "tenure_band"),
    ("new-versus-used mix", "vw_vehicle_sales", "new_unit_count"),
    ("inventory availability", "vw_inventory_health", "active_inventory_units"),
    ("manager involvement", "vw_vehicle_sales", "desk_manager_key"),
    ("gross per unit context", "vw_vehicle_sales", "retail_total_gross"),
)


def _scalar(cursor: Any, statement: str, parameters: tuple[Any, ...] | None = None) -> Any:
    cursor.execute(statement, parameters)
    row = cursor.fetchone()
    return None if row is None else row[0]


# --------------------------------------------------------------------------------------
# Condition 1: fact grains are approved -- built, constrained and tested
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("fact_table", [name for name, _, _ in FACT_GRAIN_CONSTRAINTS])
def test_every_mvp_fact_exists_and_holds_rows(loaded_cursor: Any, fact_table: str) -> None:
    rows = _scalar(loaded_cursor, f"SELECT count(*) FROM warehouse.{fact_table}")
    assert rows > 0, f"warehouse.{fact_table} is empty; the grain cannot be approved"


@pytest.mark.parametrize(
    ("fact_table", "constraint_name", "grain_columns"),
    FACT_GRAIN_CONSTRAINTS,
    ids=[name for name, _, _ in FACT_GRAIN_CONSTRAINTS],
)
def test_every_fact_grain_is_enforced_by_a_database_constraint(
    loaded_cursor: Any, fact_table: str, constraint_name: str, grain_columns: tuple[str, ...]
) -> None:
    """The grain is a control, not a claim: a UNIQUE constraint over the grain columns."""
    loaded_cursor.execute(
        """
        SELECT a.attname
        FROM pg_constraint AS con
        JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
        JOIN pg_attribute AS a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        WHERE con.conname = %s
          AND con.conrelid = %s::regclass
          AND con.contype IN ('p', 'u')
        ORDER BY k.ordinality
        """,
        (constraint_name, f"warehouse.{fact_table}"),
    )
    columns = tuple(row[0] for row in loaded_cursor.fetchall())
    assert columns == grain_columns, (
        f"warehouse.{fact_table} grain constraint {constraint_name} covers {columns}, "
        f"expected {grain_columns}"
    )


@pytest.mark.parametrize(
    ("fact_table", "constraint_name", "grain_columns"),
    FACT_GRAIN_CONSTRAINTS,
    ids=[name for name, _, _ in FACT_GRAIN_CONSTRAINTS],
)
def test_the_loaded_data_actually_satisfies_the_declared_grain(
    loaded_cursor: Any, fact_table: str, constraint_name: str, grain_columns: tuple[str, ...]
) -> None:
    """A constraint that exists and data that satisfies it are two different facts."""
    columns = ", ".join(grain_columns)
    total = _scalar(loaded_cursor, f"SELECT count(*) FROM warehouse.{fact_table}")
    distinct = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM (SELECT DISTINCT {columns} FROM warehouse.{fact_table}) AS g",
    )
    assert total == distinct


# --------------------------------------------------------------------------------------
# Condition 2: dimensions are documented and built
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("dimension", MVP_DIMENSIONS)
def test_every_mvp_dimension_exists_holds_rows_and_declares_its_grain(
    loaded_cursor: Any, dimension: str
) -> None:
    rows = _scalar(loaded_cursor, f"SELECT count(*) FROM warehouse.{dimension}")
    assert rows > 0, f"warehouse.{dimension} is empty"

    comment = _scalar(
        loaded_cursor,
        "SELECT obj_description(%s::regclass, 'pg_class')",
        (f"warehouse.{dimension}",),
    )
    assert comment and "grain" in comment.lower(), (
        f"warehouse.{dimension} does not declare its grain"
    )


@pytest.mark.parametrize("dimension", MVP_DIMENSIONS)
def test_every_dimension_column_is_documented(loaded_cursor: Any, dimension: str) -> None:
    loaded_cursor.execute(
        """
        SELECT a.attname, col_description(a.attrelid, a.attnum)
        FROM pg_attribute AS a
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        """,
        (f"warehouse.{dimension}",),
    )
    undocumented = [name for name, comment in loaded_cursor.fetchall() if not comment]
    assert not undocumented, f"warehouse.{dimension} columns without a comment: {undocumented}"


@pytest.mark.parametrize("dimension", MVP_DIMENSIONS)
def test_every_dimension_has_a_source_to_target_mapping(dimension: str) -> None:
    """A dimension with no mapping document cannot be said to be documented."""
    mappings = list((REPO_ROOT / "docs" / "source-to-target").glob("STM-*.md"))
    subject = dimension.replace("_", "-")
    matching = [path for path in mappings if subject in path.name]
    assert matching, f"no source-to-target mapping found for warehouse.{dimension}"


@pytest.mark.parametrize("fact_table", [name for name, _, _ in FACT_GRAIN_CONSTRAINTS])
def test_every_fact_has_a_source_to_target_mapping(fact_table: str) -> None:
    mappings = list((REPO_ROOT / "docs" / "source-to-target").glob("STM-*.md"))
    subject = fact_table.replace("_", "-")
    matching = [path for path in mappings if subject in path.name]
    assert matching, f"no source-to-target mapping found for warehouse.{fact_table}"


# --------------------------------------------------------------------------------------
# Condition 3: every KPI is computable from the reporting layer
# --------------------------------------------------------------------------------------


def test_all_twenty_nine_kpis_resolve_to_an_existing_reporting_view(loaded_cursor: Any) -> None:
    assert len(KPI_IDS) == 29
    loaded_cursor.execute(
        "SELECT table_name FROM information_schema.views WHERE table_schema = 'reporting'"
    )
    existing = {row[0] for row in loaded_cursor.fetchall()}
    for kpi_id in KPI_IDS:
        owners = KPI_VIEW_OWNERSHIP[kpi_id]
        assert owners, f"{kpi_id} has no reporting owner"
        missing = [name for name in owners if name not in existing]
        assert not missing, f"{kpi_id} names non-existent view(s): {missing}"


def test_the_reporting_layer_is_complete(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        "SELECT table_name FROM information_schema.views "
        "WHERE table_schema = 'reporting' ORDER BY table_name"
    )
    assert [row[0] for row in loaded_cursor.fetchall()] == list(REPORTING_VIEWS)
    assert len(MVP_DIMENSION_VIEWS) == 8
    assert len(MVP_FACT_VIEWS) == 5


# --------------------------------------------------------------------------------------
# Supporting conditions from P1.5-03 and P1.5-04
# --------------------------------------------------------------------------------------


def test_every_critical_reconciliation_passes(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        "SELECT reconciliation_id, status FROM audit.vw_recon_all "
        "WHERE reconciliation_id = ANY(%s) AND status <> 'passed'",
        (list(CRITICAL_SQL_RECONCILIATION_IDS),),
    )
    assert loaded_cursor.fetchall() == []


def test_the_reporter_is_isolated_from_every_pipeline_layer(loaded_cursor: Any) -> None:
    for schema in ("raw", "staging", "warehouse", "audit"):
        holds_usage = _scalar(
            loaded_cursor, "SELECT has_schema_privilege('arpi_reporter', %s, 'USAGE')", (schema,)
        )
        assert holds_usage is False, f"arpi_reporter holds USAGE on schema {schema}"


def test_the_calendar_covers_every_fact_date(loaded_cursor: Any) -> None:
    unresolved = _scalar(
        loaded_cursor,
        """
        SELECT
            (SELECT count(*) FROM reporting.vw_vehicle_sales f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.sale_date_key))
          + (SELECT count(*) FROM reporting.vw_vehicle_sales f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.delivery_date_key))
          + (SELECT count(*) FROM reporting.vw_inventory_snapshots f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.snapshot_date_key))
          + (SELECT count(*) FROM reporting.vw_leads f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.lead_created_date_key))
          + (SELECT count(*) FROM reporting.vw_appointments f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.scheduled_date_key))
          + (SELECT count(*) FROM reporting.vw_marketing_spend f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.vw_calendar c
                               WHERE c.date_key = f.month_date_key))
        """,
    )
    assert unresolved == 0


@pytest.mark.parametrize(
    ("metric", "view_name", "column_name"),
    FAIRNESS_CONTEXT,
    ids=[m for m, _, _ in FAIRNESS_CONTEXT],
)
def test_the_employee_fairness_context_is_available_from_the_reporting_layer(
    loaded_cursor: Any, metric: str, view_name: str, column_name: str
) -> None:
    """ARCHITECTURE.md section 23 requires each of these beside any employee comparison."""
    exists = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = 'reporting' AND table_name = %s AND column_name = %s",
        (view_name, column_name),
    )
    assert exists == 1, (
        f"the fairness context {metric!r} is not obtainable: "
        f"reporting.{view_name}.{column_name} does not exist"
    )


def test_no_power_bi_artefact_has_been_built(loaded_cursor: Any) -> None:
    """No Power BI artefact exists, because Gate 1 gates Power BI DEVELOPMENT.

    A PBIX or PBIP in the tree would mean the gate was crossed before it was evaluated,
    which invalidates the review regardless of its verdict. Model documentation is not
    development: it is the specification the gate produces.
    """
    powerbi = REPO_ROOT / "powerbi"
    artefacts = [
        path.relative_to(REPO_ROOT).as_posix()
        for pattern in ("**/*.pbix", "**/*.pbip", "**/*.pbit", "**/*.tmdl", "**/*.bim")
        for path in powerbi.glob(pattern)
    ]
    assert not artefacts, f"Power BI development started before Gate 1 was evaluated: {artefacts}"


def test_the_readiness_document_exists_and_records_a_verdict() -> None:
    """The verdict is a written decision, and it must be one of exactly two words."""
    document = REPO_ROOT / "docs" / "requirements" / "GATE_1_READINESS.md"
    assert document.is_file(), "docs/requirements/GATE_1_READINESS.md does not exist"

    text = document.read_text(encoding="utf-8")
    assert "## Final verdict" in text, "the readiness document records no final verdict section"

    verdicts = [line for line in text.splitlines() if line.strip() in {"**OPEN**", "**CLOSED**"}]
    assert len(verdicts) == 1, (
        "the readiness document must state exactly one final verdict, written on its own "
        f"line as **OPEN** or **CLOSED**; found {len(verdicts)}"
    )


def test_every_gate_one_condition_is_recorded_with_evidence() -> None:
    """Each condition carries an identifier, evidence, a test or query, and a verdict."""
    document = REPO_ROOT / "docs" / "requirements" / "GATE_1_READINESS.md"
    text = document.read_text(encoding="utf-8")
    for field in (
        "Condition ID",
        "Requirement",
        "Evidence",
        "Test or SQL query",
        "Result",
        "Limitation",
        "Verdict",
    ):
        assert field in text, f"the readiness document has no {field!r} field"
