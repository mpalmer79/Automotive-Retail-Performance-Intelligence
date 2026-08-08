"""The operating-plan chain, end to end: raw, staging, warehouse, reporting.

WHAT THIS SUITE OWNS
--------------------
``test_kpi_verification.py`` owns the arithmetic of ``KPI-TGT-001`` … ``KPI-TGT-010``, and
``test_reconciliations.py`` owns the between-layer identities. This file owns the pieces
neither of those can see: that the four objects exist and are shaped as declared, that the
one scope rule a CHECK constraint cannot express is genuinely enforced somewhere, that a
reload writes nothing new, that ``arpi_reporter`` can read the view and nothing beneath it,
and that the view does not fan out.

WHY THE STORE-SCOPE RULE IS TESTED HERE AND NOT WITH A CONSTRAINT
-----------------------------------------------------------------
Every scope rule that can be decided from one row's own columns IS a CHECK constraint on
``warehouse.fact_sales_target``. Exactly one spans two tables — a Store-scope row's
``target_scope_id`` must be its OWN store's ``dealership_id`` — and PostgreSQL cannot
express a cross-table equality in a CHECK. A trigger would be a hidden second load path,
so the rule lives in ``staging.stg_sales_target`` as a domain rejection, and
:func:`test_a_store_scope_row_naming_another_store_is_rejected` is what makes that a fact
rather than a claim.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from arpi.constants import (
    TARGET_DEPARTMENTS,
    TARGET_METRIC_KPI_IDS,
    TARGET_SCOPE_TYPES,
)

pytestmark = pytest.mark.integration

FACT = "warehouse.fact_sales_target"
VIEW = "reporting.vw_target_attainment"
STAGING = "staging.stg_sales_target"
RAW = "raw.sales_target_load"

#: The fact's declared grain, as ``uq_fact_sales_target_grain`` enforces it.
GRAIN_COLUMNS = (
    "dealership_key",
    "target_month_date_key",
    "kpi_id",
    "target_scope_type",
    "target_scope_id",
)

#: Column names that must never appear on the target view. `employee_key` is on the FACT
#: and is a surrogate into a dimension that holds no personal data; it must not reach the
#: reporting boundary, and no name-shaped column may appear at all.
PROHIBITED_VIEW_COLUMNS = (
    "employee_key",
    "employee_id",
    "employee_name",
    "salesperson",
    "compensation",
    "pay_plan",
    "commission",
    "email",
    "phone",
)


def _scalar(cursor: Any, statement: str, params: Any = None) -> Any:
    cursor.execute(statement, params)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _columns(cursor: Any, qualified: str) -> set[str]:
    schema, name = qualified.split(".", 1)
    cursor.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s",
        (schema, name),
    )
    return {row[0] for row in cursor.fetchall()}


# =======================================================================================
# The four objects exist and are shaped as declared
# =======================================================================================


@pytest.mark.parametrize("qualified", [RAW, STAGING, FACT, VIEW])
def test_every_layer_of_the_chain_exists(loaded_cursor: Any, qualified: str) -> None:
    assert _scalar(loaded_cursor, f"SELECT to_regclass('{qualified}')") is not None


def test_the_fact_declares_the_contract_columns(loaded_cursor: Any) -> None:
    assert _columns(loaded_cursor, FACT) == {
        "sales_target_key",
        "target_month_date_key",
        "dealership_key",
        "target_scope_type",
        "target_scope_id",
        "department_name",
        "employee_key",
        "kpi_id",
        "target_value",
        "stretch_target_value",
        "source_system",
    }


def test_the_money_columns_are_exact_numeric_and_never_float(loaded_cursor: Any) -> None:
    """`numeric(14,2)` on both. A double precision target is irreproducible by construction."""
    rows = dict(
        loaded_cursor.execute(
            """
            SELECT column_name, data_type || '(' || numeric_precision || ',' ||
                   numeric_scale || ')'
            FROM information_schema.columns
            WHERE table_schema = 'warehouse' AND table_name = 'fact_sales_target'
              AND column_name IN ('target_value', 'stretch_target_value')
            """
        ).fetchall()
    )
    assert rows == {
        "target_value": "numeric(14,2)",
        "stretch_target_value": "numeric(14,2)",
    }


def test_the_grain_constraint_covers_exactly_the_declared_grain(loaded_cursor: Any) -> None:
    """The constraint IS the grain, so the two cannot be allowed to drift apart."""
    columns = loaded_cursor.execute(
        """
        SELECT a.attname
        FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE n.nspname = 'warehouse' AND c.conname = 'uq_fact_sales_target_grain'
        ORDER BY k.ord
        """
    ).fetchall()
    assert {row[0] for row in columns} == set(GRAIN_COLUMNS)


def test_every_grain_column_is_not_null(loaded_cursor: Any) -> None:
    """PostgreSQL treats NULLs as distinct in a UNIQUE constraint.

    A grain expressed over a nullable column would therefore permit unlimited duplicate
    logical rows while the constraint sat on the table looking like it was working. This
    is why ``target_scope_id`` carries a business identity on every scope type rather than
    being NULL on the scopes that have no refinement.
    """
    nullable = loaded_cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'warehouse' AND table_name = 'fact_sales_target'
          AND is_nullable = 'YES'
        """
    ).fetchall()
    assert {row[0] for row in nullable} == {"department_name", "employee_key"}
    assert not ({row[0] for row in nullable} & set(GRAIN_COLUMNS))


def test_the_fact_carries_its_foreign_keys(loaded_cursor: Any) -> None:
    names = loaded_cursor.execute(
        """
        SELECT c.conname FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid = c.connamespace
        WHERE n.nspname = 'warehouse' AND c.conrelid = 'warehouse.fact_sales_target'::regclass
          AND c.contype = 'f'
        """
    ).fetchall()
    assert {row[0] for row in names} == {
        "fk_fact_sales_target_month",
        "fk_fact_sales_target_dealership",
        "fk_fact_sales_target_employee",
    }


def test_the_fact_and_the_view_document_themselves(loaded_cursor: Any) -> None:
    for qualified in (FACT, VIEW):
        comment = _scalar(
            loaded_cursor, f"SELECT obj_description('{qualified}'::regclass, 'pg_class')"
        )
        assert comment, f"{qualified} carries no COMMENT"
        assert "Grain" in str(comment)
        assert "SYNTHETIC INTERNAL OPERATING GOAL" in str(comment).upper()


def test_every_view_column_is_documented(loaded_cursor: Any) -> None:
    undocumented = loaded_cursor.execute(
        """
        SELECT c.column_name
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'reporting' AND c.table_name = 'vw_target_attainment'
          AND col_description(%s::regclass, c.ordinal_position::integer) IS NULL
        ORDER BY c.ordinal_position
        """,
        (VIEW,),
    ).fetchall()
    assert [row[0] for row in undocumented] == []


# =======================================================================================
# The chain carried the data
# =======================================================================================


def test_the_row_count_is_identical_at_every_layer(loaded_cursor: Any) -> None:
    raw_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {RAW}")
    staging_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {STAGING}")
    warehouse_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {FACT}")
    rejected = _scalar(loaded_cursor, "SELECT count(*) FROM staging.stg_sales_target_rejected")
    assert raw_rows > 0
    assert raw_rows == staging_rows + rejected
    assert staging_rows == warehouse_rows


def test_the_generated_plan_covers_every_store_month_with_four_rows(
    loaded_cursor: Any,
) -> None:
    """Two store plans and two department refinements, per store per month."""
    stores = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.dim_dealership WHERE is_current"
    )
    months = _scalar(loaded_cursor, f"SELECT count(DISTINCT target_month_date_key) FROM {FACT}")
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {FACT}") == stores * months * 4


def test_every_vocabulary_column_stays_inside_its_domain(loaded_cursor: Any) -> None:
    scopes = loaded_cursor.execute(f"SELECT DISTINCT target_scope_type FROM {FACT}").fetchall()
    assert {row[0] for row in scopes} <= set(TARGET_SCOPE_TYPES)

    metrics = loaded_cursor.execute(f"SELECT DISTINCT kpi_id FROM {FACT}").fetchall()
    assert {row[0] for row in metrics} <= set(TARGET_METRIC_KPI_IDS)
    assert not any(str(row[0]).startswith("KPI-TGT-") for row in metrics)

    departments = loaded_cursor.execute(
        f"SELECT DISTINCT department_name FROM {FACT} WHERE department_name IS NOT NULL"
    ).fetchall()
    assert {row[0] for row in departments} <= set(TARGET_DEPARTMENTS)


def test_a_store_scope_row_names_its_own_store(loaded_cursor: Any) -> None:
    """The rule staging enforces, verified against the loaded warehouse."""
    offenders = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {FACT} AS t
        JOIN warehouse.dim_dealership AS d ON d.dealership_key = t.dealership_key
        WHERE t.target_scope_type = 'Store' AND t.target_scope_id <> d.dealership_id
        """,
    )
    assert offenders == 0


# =======================================================================================
# Staging enforces what a CHECK constraint cannot
# =======================================================================================


def _latest_batch(cursor: Any) -> Any:
    return _scalar(
        cursor,
        f"SELECT load_batch_id FROM {RAW} GROUP BY load_batch_id "
        "ORDER BY max(ingested_at) DESC, max(raw_record_id) DESC LIMIT 1",
    )


def _plant_raw_row(cursor: Any, **overrides: str) -> None:
    """Copy one landed row into the newest batch with the given fields replaced."""
    columns = (
        "sales_target_id",
        "target_month_date_key",
        "dealership_id",
        "target_scope_type",
        "target_scope_id",
        "department_name",
        "employee_id",
        "kpi_id",
        "target_value",
        "stretch_target_value",
        "source_system",
    )
    projected = ", ".join(
        f"{'%(' + name + ')s' if name in overrides else 'r.' + name} AS {name}" for name in columns
    )
    cursor.execute(
        f"""
        INSERT INTO {RAW} ({", ".join(columns)}, load_batch_id, source_file_name,
                           source_row_number)
        SELECT {projected}, r.load_batch_id, r.source_file_name,
               (SELECT max(x.source_row_number) + 1 FROM {RAW} AS x)
        FROM {RAW} AS r
        WHERE r.load_batch_id = %(batch)s
          AND r.raw_record_id = (SELECT min(y.raw_record_id) FROM {RAW} AS y
                                 WHERE y.load_batch_id = %(batch)s
                                   AND y.target_scope_type = 'Store')
        """,
        {**overrides, "batch": _latest_batch(cursor)},
    )
    assert cursor.rowcount == 1


def _rejection_for(cursor: Any, sales_target_id: str) -> tuple[str, str] | None:
    row = cursor.execute(
        "SELECT rejection_code, rejection_reason FROM staging.stg_sales_target_rejected "
        "WHERE source_record_key = %s",
        (sales_target_id,),
    ).fetchone()
    return None if row is None else (row[0], row[1])


def test_a_store_scope_row_naming_another_store_is_rejected(loaded_cursor: Any) -> None:
    """The one rule that spans two tables. Rejected with a reason, never silently dropped."""
    _plant_raw_row(
        loaded_cursor,
        sales_target_id="TGT-99000001",
        target_scope_id="GSA-999",
    )
    assert (
        _scalar(
            loaded_cursor,
            f"SELECT count(*) FROM {STAGING} WHERE sales_target_id = 'TGT-99000001'",
        )
        == 0
    )
    rejection = _rejection_for(loaded_cursor, "TGT-99000001")
    assert rejection is not None
    code, reason = rejection
    assert code == "REJ-DOMAIN-001"
    assert "target_scope_id" in reason


@pytest.mark.parametrize(
    ("identifier", "overrides", "expected_code"),
    [
        ("TGT-99000002", {"target_scope_type": "Region"}, "REJ-DOMAIN-001"),
        ("TGT-99000003", {"kpi_id": "KPI-TGT-001"}, "REJ-DOMAIN-001"),
        ("TGT-99000004", {"target_month_date_key": "20250115"}, "REJ-DOMAIN-001"),
        ("TGT-99000005", {"target_value": "-1.00"}, "REJ-DOMAIN-001"),
        ("TGT-99000006", {"target_value": "not-a-number"}, "REJ-TYPE-001"),
        ("TGT-99000007", {"kpi_id": ""}, "REJ-NULL-001"),
        ("TGT-99000008", {"department_name": "Sales"}, "REJ-DOMAIN-001"),
    ],
)
def test_staging_rejects_a_malformed_plan_row(
    loaded_cursor: Any,
    identifier: str,
    overrides: dict[str, str],
    expected_code: str,
) -> None:
    """Every rejection carries a code and a reason, and none reaches the warehouse."""
    _plant_raw_row(loaded_cursor, sales_target_id=identifier, **overrides)
    assert (
        _scalar(
            loaded_cursor,
            f"SELECT count(*) FROM {STAGING} WHERE sales_target_id = %s",
            (identifier,),
        )
        == 0
    )
    rejection = _rejection_for(loaded_cursor, identifier)
    assert rejection is not None, f"{overrides} was accepted"
    assert rejection[0] == expected_code


def test_a_duplicate_natural_key_keeps_the_newest_row_and_reports_the_loser(
    loaded_cursor: Any,
) -> None:
    existing = _scalar(
        loaded_cursor,
        f"SELECT sales_target_id FROM {STAGING} ORDER BY sales_target_id LIMIT 1",
    )
    _plant_raw_row(loaded_cursor, sales_target_id=str(existing), target_value="1234.00")
    accepted = _scalar(
        loaded_cursor,
        f"SELECT target_value FROM {STAGING} WHERE sales_target_id = %s",
        (existing,),
    )
    assert Decimal(str(accepted)) == Decimal("1234.00"), "the highest raw_record_id wins"
    rejection = _rejection_for(loaded_cursor, str(existing))
    assert rejection is not None
    assert rejection[0] == "REJ-KEY-001"


# =======================================================================================
# Idempotency
# =======================================================================================


def test_reloading_an_unchanged_plan_writes_nothing(loaded_cursor: Any) -> None:
    """A rerun is the same logical plan executed again, not a second plan."""
    from pathlib import Path

    script = (
        Path(__file__).resolve().parents[2] / "sql" / "04_facts" / "16_fact_sales_target_load.sql"
    )
    before = loaded_cursor.execute(
        f"SELECT sales_target_key, target_value, stretch_target_value FROM {FACT} "
        "ORDER BY sales_target_key"
    ).fetchall()
    loaded_cursor.execute(script.read_text(encoding="utf-8"))
    after = loaded_cursor.execute(
        f"SELECT sales_target_key, target_value, stretch_target_value FROM {FACT} "
        "ORDER BY sales_target_key"
    ).fetchall()
    assert after == before


def test_a_revised_plan_replaces_the_row_rather_than_adding_one(loaded_cursor: Any) -> None:
    """A plan is a current statement; plan history is Out of scope and documented as such."""
    from pathlib import Path

    script = (
        Path(__file__).resolve().parents[2] / "sql" / "04_facts" / "16_fact_sales_target_load.sql"
    )
    rows_before = _scalar(loaded_cursor, f"SELECT count(*) FROM {FACT}")
    key = _scalar(loaded_cursor, f"SELECT min(sales_target_key) FROM {FACT}")
    loaded_cursor.execute(
        f"UPDATE {FACT} SET target_value = target_value + 5.00 WHERE sales_target_key = %s",
        (key,),
    )
    loaded_cursor.execute(script.read_text(encoding="utf-8"))
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {FACT}") == rows_before
    restored = _scalar(
        loaded_cursor, f"SELECT target_value FROM {FACT} WHERE sales_target_key = %s", (key,)
    )
    staged = _scalar(
        loaded_cursor,
        f"""
        SELECT s.target_value FROM {STAGING} AS s
        JOIN warehouse.dim_dealership AS d
          ON d.dealership_id = s.dealership_id AND d.is_current
        JOIN {FACT} AS t
          ON t.dealership_key = d.dealership_key
         AND t.target_month_date_key = s.target_month_date_key
         AND t.kpi_id = s.kpi_id
         AND t.target_scope_type = s.target_scope_type
         AND t.target_scope_id = s.target_scope_id
        WHERE t.sales_target_key = %s
        """,
        (key,),
    )
    assert Decimal(str(restored)) == Decimal(str(staged))


# =======================================================================================
# The reporting boundary
# =======================================================================================


def test_the_reporter_can_read_the_view_and_cannot_write_it(loaded_cursor: Any) -> None:
    assert (
        _scalar(loaded_cursor, "SELECT has_table_privilege('arpi_reporter', %s, 'SELECT')", (VIEW,))
        is True
    )
    for privilege in ("INSERT", "UPDATE", "DELETE"):
        assert (
            _scalar(
                loaded_cursor,
                "SELECT has_table_privilege('arpi_reporter', %s, %s)",
                (VIEW, privilege),
            )
            is False
        )


@pytest.mark.parametrize("qualified", [RAW, STAGING, FACT])
def test_the_reporter_cannot_read_the_layers_beneath_the_view(
    loaded_cursor: Any, qualified: str
) -> None:
    assert (
        _scalar(
            loaded_cursor,
            "SELECT has_table_privilege('arpi_reporter', %s, 'SELECT')",
            (qualified,),
        )
        is False
    )


def test_the_view_publishes_no_person_and_no_surrogate_employee_key(
    loaded_cursor: Any,
) -> None:
    columns = _columns(loaded_cursor, VIEW)
    offenders = sorted(
        column
        for column in columns
        if any(prohibited in column for prohibited in PROHIBITED_VIEW_COLUMNS)
    )
    assert offenders == []


def test_the_view_holds_its_declared_grain_and_does_not_fan_out(loaded_cursor: Any) -> None:
    """The declared grain is the real grain.

    The view joins four aggregates and a LEFT JOIN to the plan, and a duplicated join key
    would double both the target and the actual -- invisible in a percentage, fatal in a
    total.
    """
    rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {VIEW}")
    distinct = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM (
            SELECT DISTINCT dealership_key, target_month, target_scope_type,
                            target_scope_id, target_kpi_id
            FROM {VIEW}
        ) AS g
        """,
    )
    assert rows == distinct
    assert rows > 0


def test_the_view_carries_every_applicable_store_month_whether_planned_or_not(
    loaded_cursor: Any,
) -> None:
    """The frame is the governed applicable set, not just whatever the fact happens to hold.

    That is what lets a store-month with no plan render "No target set" rather than
    vanishing from the page, and it is why the missing-target state is representable at
    all.
    """
    stores = _scalar(
        loaded_cursor, "SELECT count(*) FROM warehouse.dim_dealership WHERE is_current"
    )
    months = _scalar(
        loaded_cursor, "SELECT count(DISTINCT month_start_date) FROM warehouse.dim_date"
    )
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {VIEW}") == stores * months * 4

    loaded_cursor.execute(f"DELETE FROM {FACT}")
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {VIEW}") == stores * months * 4
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {VIEW} WHERE is_target_present") == 0
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {VIEW} WHERE target_value IS NULL") > 0
