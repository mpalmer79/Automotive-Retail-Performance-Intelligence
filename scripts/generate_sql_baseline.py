"""Generate the ARPI SQL-to-DAX reconciliation baseline.

WHAT THIS IS FOR
----------------
The Power BI semantic model computes twenty-nine governed KPIs in DAX. The
``reporting`` schema computes the same twenty-nine in SQL, and the SQL side is the
governed owner. This script evaluates the SQL side across a fixed set of filter
contexts and writes the answers to ``powerbi/validation/sql_baseline.json``, so that
``scripts/validate_powerbi_model.ps1`` can run the matching DAX queries against a live
Power BI Desktop model and compare number for number.

A measure can have a correct grand total and still be wrong under filter context. That
is the whole reason this file evaluates every KPI unfiltered, per store, per month, by
condition group, by employee, by lead source, by vehicle model, in a context whose
denominator is zero, and in a context that exercises an inactive date relationship.

FILTER PROPAGATION IS MODELLED, NOT ASSUMED
-------------------------------------------
The baseline mirrors the model's relationship graph rather than applying every filter to
every table. A vehicle-model filter reaches ``vw_vehicle_sales`` and
``vw_inventory_snapshots`` through ``vw_vehicle``, and reaches nothing else. An employee
filter reaches the sale, lead and appointment facts and nothing else. A condition-group
filter comes from ``vw_vehicle`` and therefore does not touch ``vw_inventory_turn`` or
``vw_days_supply``, even though both carry a ``condition_group`` column of their own.
Getting this wrong would produce a baseline that disagrees with a correct model, which is
worse than having no baseline at all. :data:`PROPAGATION` is the register.

SEMI-ADDITIVITY IS MODELLED TOO
-------------------------------
Inventory count, investment, age and the aged measures are stocks. The model evaluates
them at the last snapshot date in the filter context; so does this script. Summing them
across a month would be wrong by roughly a factor of thirty in both places, which is
exactly the kind of agreement a reconciliation must not produce.

USAGE
-----
Point the standard ``PG*`` or ``ARPI_DATABASE__*`` environment variables at a database
built from ``sql/`` and loaded by the ``development`` profile, then::

    python scripts/generate_sql_baseline.py

Nothing secret is written. The output records a host-free description of the source: the
profile, the seed, the reporting date range and the row counts, never a connection
string, a user name or a password.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

try:
    import psycopg
except ImportError:  # pragma: no cover - psycopg is an optional extra, not a hard dependency
    psycopg = None  # type: ignore[assignment]

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "powerbi" / "validation"

#: Which filters reach which source table, following the model's active relationships.
#: A filter absent from a table's tuple does not narrow that table's measures at all.
PROPAGATION: dict[str, tuple[str, ...]] = {
    "vw_vehicle_sales": ("date", "dealership", "condition", "employee", "lead_source", "model"),
    "vw_inventory_snapshots": ("date", "dealership", "condition", "model"),
    "vw_leads": ("date", "dealership", "employee", "lead_source"),
    "vw_appointments": ("date", "dealership", "employee"),
    "vw_marketing_performance": ("date", "dealership", "lead_source"),
    "vw_inventory_turn": ("date", "dealership"),
    "vw_days_supply": ("date", "dealership"),
}

#: The date column each source table is filtered on, by date role.
DATE_COLUMN: dict[str, str] = {
    "vw_vehicle_sales": "sale_date_key",
    "vw_inventory_snapshots": "snapshot_date_key",
    "vw_leads": "lead_created_date_key",
    "vw_appointments": "scheduled_date_key",
    "vw_marketing_performance": "month_date_key",
    "vw_inventory_turn": "month_date_key",
    "vw_days_supply": "as_of_date_key",
}


@dataclass(frozen=True)
class Context:
    """One filter context, evaluated identically in SQL here and in DAX in the model."""

    context_id: str
    description: str
    date_from: str | None = None
    date_to: str | None = None
    year_month_label: str | None = None
    dealership_code: str | None = None
    condition_group: str | None = None
    employee_code: str | None = None
    lead_source_code: str | None = None
    vehicle_model_code: str | None = None
    #: Date role to filter the appointment fact on. ``show_date_key`` exercises the
    #: inactive relationship that KPI-FUN-005 activates with USERELATIONSHIP.
    appointment_date_role: str = "scheduled_date_key"
    notes: str = ""

    def as_filters(self) -> dict[str, Any]:
        """Return the context's filters as the JSON object recorded in the baseline."""
        return {
            "year_month_label": self.year_month_label,
            "dealership_code": self.dealership_code,
            "condition_group": self.condition_group,
            "employee_code": self.employee_code,
            "lead_source_code": self.lead_source_code,
            "vehicle_model_code": self.vehicle_model_code,
            "appointment_date_role": self.appointment_date_role,
        }


@dataclass
class Clause:
    """An accumulating SQL WHERE fragment and its parameter list."""

    sql: str = ""
    params: list[Any] = field(default_factory=list)

    def add(self, fragment: str, *values: Any) -> None:
        """Append one AND-ed predicate and its parameters."""
        self.sql += f" AND {fragment}"
        self.params.extend(values)


def build_clause(table: str, context: Context) -> Clause:
    """Return the WHERE fragment for ``table`` under ``context``.

    Only filters that propagate to ``table`` are applied. Keys are resolved through the
    dimension views so that this mirrors what a relationship does rather than what a
    hand-written join would do.
    """
    reaches = PROPAGATION[table]
    clause = Clause()
    alias = "t"

    if "date" in reaches and context.date_from is not None:
        column = DATE_COLUMN[table]
        if table == "vw_appointments":
            column = context.appointment_date_role
        clause.add(
            f"{alias}.{column} BETWEEN "
            f"to_char(%s::date, 'YYYYMMDD')::int AND to_char(%s::date, 'YYYYMMDD')::int",
            context.date_from,
            context.date_to,
        )

    if "dealership" in reaches and context.dealership_code:
        clause.add(
            f"{alias}.dealership_key = "
            "(SELECT dealership_key FROM reporting.vw_dealership WHERE dealership_code = %s)",
            context.dealership_code,
        )

    if "condition" in reaches and context.condition_group:
        clause.add(f"{alias}.condition_group = %s", context.condition_group)

    if "employee" in reaches and context.employee_code:
        employee_column = {
            "vw_vehicle_sales": "salesperson_key",
            "vw_leads": "assigned_employee_key",
            "vw_appointments": "salesperson_key",
        }[table]
        clause.add(
            f"{alias}.{employee_column} = "
            "(SELECT employee_key FROM reporting.vw_employee WHERE employee_code = %s)",
            context.employee_code,
        )

    if "lead_source" in reaches and context.lead_source_code:
        clause.add(
            f"{alias}.lead_source_key = "
            "(SELECT lead_source_key FROM reporting.vw_lead_source WHERE lead_source_code = %s)",
            context.lead_source_code,
        )

    if "model" in reaches and context.vehicle_model_code:
        clause.add(
            f"{alias}.vehicle_model_key = (SELECT vehicle_model_key "
            "FROM reporting.vw_vehicle_model WHERE vehicle_model_code = %s)",
            context.vehicle_model_code,
        )

    return clause


def scalar(cursor: Any, statement: str, params: list[Any]) -> Any:
    """Execute ``statement`` and return the first column of the first row, or None."""
    cursor.execute(statement, params)
    row = cursor.fetchone()
    return None if row is None else row[0]


def number(value: Any) -> float | int | None:
    """Normalise a database numeric to JSON, rounding to six places. None stays None."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return round(float(value), 6)
    if isinstance(value, int):
        return value
    return round(float(value), 6)


# --------------------------------------------------------------------------------------
# Measure evaluation
# --------------------------------------------------------------------------------------


def sales_measures(cursor: Any, context: Context) -> dict[str, Any]:
    """Every sales, gross and days-to-sale measure, from vw_vehicle_sales."""
    clause = build_clause("vw_vehicle_sales", context)
    row = scalar(
        cursor,
        f"""
        SELECT json_build_object(
            'KPI-SLS-001', coalesce(sum(t.retail_unit_count), 0),
            'KPI-SLS-002', coalesce(sum(t.new_unit_count), 0),
            'KPI-SLS-003', coalesce(sum(t.used_unit_count), 0),
            'KPI-GRS-001', sum(t.retail_front_end_gross),
            'KPI-GRS-002', sum(t.retail_back_end_gross),
            'KPI-GRS-003', sum(t.retail_total_gross),
            'KPI-GRS-004', sum(t.retail_front_end_gross)
                           / nullif(sum(t.retail_unit_count), 0),
            'KPI-GRS-005', sum(t.retail_back_end_gross)
                           / nullif(sum(t.retail_unit_count), 0),
            'KPI-GRS-006', sum(t.retail_total_gross)
                           / nullif(sum(t.retail_unit_count), 0),
            'KPI-INV-007', percentile_cont(0.5) WITHIN GROUP (
                               ORDER BY t.retail_days_in_inventory),
            'SUP-DAYS-TO-SALE-MEAN', sum(t.retail_days_in_inventory_total)::numeric
                           / nullif(sum(t.retail_unit_count), 0)
        )
        FROM reporting.vw_vehicle_sales AS t
        WHERE true{clause.sql}
        """,
        clause.params,
    )
    return {key: number(value) for key, value in row.items()}


def inventory_snapshot_measures(cursor: Any, context: Context) -> dict[str, Any]:
    """Semi-additive: evaluated at the last snapshot date in the filter context."""
    clause = build_clause("vw_inventory_snapshots", context)
    as_of = scalar(
        cursor,
        f"SELECT max(t.snapshot_date_key) FROM reporting.vw_inventory_snapshots AS t "
        f"WHERE true{clause.sql}",
        clause.params,
    )
    if as_of is None:
        return dict.fromkeys(
            [
                "KPI-INV-001",
                "KPI-INV-002",
                "KPI-INV-003",
                "KPI-INV-004",
                "KPI-INV-005",
                "KPI-INV-006",
                "SUP-AGED-INVESTMENT",
                "_as_of_date_key",
            ]
        )
    row = scalar(
        cursor,
        f"""
        SELECT json_build_object(
            'KPI-INV-001', sum(t.inventory_unit_count),
            'KPI-INV-002', sum(t.inventory_investment),
            'KPI-INV-003', sum(t.days_in_stock)::numeric
                           / nullif(sum(t.inventory_unit_count), 0),
            'KPI-INV-004', percentile_cont(0.5) WITHIN GROUP (ORDER BY t.days_in_stock),
            'KPI-INV-005', sum(t.aged_unit_count),
            'KPI-INV-006', sum(t.aged_unit_count)::numeric
                           / nullif(sum(t.inventory_unit_count), 0),
            'SUP-AGED-INVESTMENT', sum(t.aged_inventory_investment)
        )
        FROM reporting.vw_inventory_snapshots AS t
        WHERE t.snapshot_date_key = %s{clause.sql}
        """,
        [as_of, *clause.params],
    )
    result = {key: number(value) for key, value in row.items()}
    result["_as_of_date_key"] = as_of
    return result


def inventory_turn_measure(cursor: Any, context: Context) -> dict[str, Any]:
    """KPI-INV-008, from the governed vw_inventory_turn view. Valid at month grain."""
    clause = build_clause("vw_inventory_turn", context)
    value = scalar(
        cursor,
        f"SELECT sum(t.annualized_retail_units) "
        f"/ nullif(sum(t.average_daily_active_inventory), 0) "
        f"FROM reporting.vw_inventory_turn AS t WHERE true{clause.sql}",
        clause.params,
    )
    return {"KPI-INV-008": number(value)}


def days_supply_measure(cursor: Any, context: Context) -> dict[str, Any]:
    """Semi-additive: the numerator is a stock, so evaluate at the last as-of date."""
    clause = build_clause("vw_days_supply", context)
    as_of = scalar(
        cursor,
        f"SELECT max(t.as_of_date_key) FROM reporting.vw_days_supply AS t WHERE true{clause.sql}",
        clause.params,
    )
    if as_of is None:
        return {"KPI-INV-009": None}
    value = scalar(
        cursor,
        f"SELECT sum(t.active_inventory_units) "
        f"/ nullif(sum(t.average_daily_retail_sales), 0) "
        f"FROM reporting.vw_days_supply AS t WHERE t.as_of_date_key = %s{clause.sql}",
        [as_of, *clause.params],
    )
    return {"KPI-INV-009": number(value)}


def lead_measures(cursor: Any, context: Context) -> dict[str, Any]:
    """Every lead-grain funnel measure, from vw_leads."""
    clause = build_clause("vw_leads", context)
    row = scalar(
        cursor,
        f"""
        SELECT json_build_object(
            'KPI-FUN-001', coalesce(sum(t.valid_lead_count), 0),
            'KPI-FUN-002', sum(t.contacted_lead_count)::numeric
                           / nullif(sum(t.valid_lead_count), 0),
            'KPI-FUN-003', sum(t.appointment_set_lead_count)::numeric
                           / nullif(sum(t.contacted_lead_count), 0),
            'KPI-FUN-006', sum(t.sold_lead_count)::numeric
                           / nullif(sum(t.valid_lead_count), 0),
            'KPI-FUN-007', (sum(t.response_seconds_total)::numeric
                           / nullif(sum(t.responded_lead_count), 0)) / 60.0,
            'KPI-FUN-008', percentile_cont(0.5) WITHIN GROUP (
                               ORDER BY t.first_response_seconds) / 60.0,
            'SUP-UNRESPONDED-LEADS', coalesce(sum(t.unresponded_lead_count), 0),
            'SUP-DUPLICATE-LEADS', coalesce(sum(t.duplicate_lead_count), 0),
            'SUP-SOLD-LEADS', coalesce(sum(t.sold_lead_count), 0)
        )
        FROM reporting.vw_leads AS t
        WHERE true{clause.sql}
        """,
        clause.params,
    )
    return {key: number(value) for key, value in row.items()}


def appointment_measures(cursor: Any, context: Context) -> dict[str, Any]:
    """Show Rate is scheduled-date based; Show-to-Sale is show-date based.

    The two are evaluated over different row populations on purpose, which is why they
    are built from two separate clauses rather than one.
    """
    scheduled = build_clause("vw_appointments", context)
    show_context = Context(**{**context.__dict__, "appointment_date_role": "show_date_key"})
    show = build_clause("vw_appointments", show_context)

    scheduled_row = scalar(
        cursor,
        f"""
        SELECT json_build_object(
            'KPI-FUN-004', sum(t.shown_appointment_count)::numeric
                           / nullif(sum(t.eligible_appointment_count), 0),
            'SUP-ELIGIBLE-APPOINTMENTS', coalesce(sum(t.eligible_appointment_count), 0),
            'SUP-SHOWN-APPOINTMENTS', coalesce(sum(t.shown_appointment_count), 0),
            'SUP-ADVANCE-CANCELLATIONS', coalesce(sum(t.cancelled_in_advance_count), 0),
            'SUP-CANCELLATION-RATE', sum(t.cancelled_in_advance_count)::numeric
                           / nullif(sum(t.appointment_count), 0)
        )
        FROM reporting.vw_appointments AS t
        WHERE true{scheduled.sql}
        """,
        scheduled.params,
    )
    show_value = scalar(
        cursor,
        f"SELECT sum(t.shown_and_sold_appointment_count)::numeric "
        f"/ nullif(sum(t.shown_appointment_count), 0) "
        f"FROM reporting.vw_appointments AS t WHERE true{show.sql}",
        show.params,
    )
    result = {key: number(value) for key, value in scheduled_row.items()}
    result["KPI-FUN-005"] = number(show_value)
    return result


def marketing_measures(cursor: Any, context: Context) -> dict[str, Any]:
    """BLANK, not zero, wherever spend is undefined.

    ``spend_amount`` is NULL for organic, walk-in and internal sources, which have no
    cost basis at all. ``sum()`` of an all-NULL column is NULL, and the model's ISBLANK
    guard produces the same answer. A source with no cost basis must never report a free
    lead.
    """
    clause = build_clause("vw_marketing_performance", context)
    row = scalar(
        cursor,
        f"""
        SELECT json_build_object(
            'KPI-MKT-001', CASE WHEN sum(t.spend_amount) IS NULL THEN NULL
                 ELSE sum(t.spend_amount) / nullif(sum(t.attributed_leads), 0) END,
            'KPI-MKT-002', CASE WHEN sum(t.spend_amount) IS NULL THEN NULL
                 ELSE sum(t.spend_amount) / nullif(sum(t.attributed_retail_units), 0) END,
            'KPI-MKT-003', CASE WHEN sum(t.spend_amount) IS NULL THEN NULL
                 ELSE sum(t.attributed_total_gross) / nullif(sum(t.spend_amount), 0) END
        )
        FROM reporting.vw_marketing_performance AS t
        WHERE true{clause.sql}
        """,
        clause.params,
    )
    return {key: number(value) for key, value in row.items()}


def evaluate(cursor: Any, context: Context) -> dict[str, Any]:
    """Every measure in the baseline, for one filter context."""
    measures: dict[str, Any] = {}
    measures.update(sales_measures(cursor, context))
    measures.update(inventory_snapshot_measures(cursor, context))
    measures.update(inventory_turn_measure(cursor, context))
    measures.update(days_supply_measure(cursor, context))
    measures.update(lead_measures(cursor, context))
    measures.update(appointment_measures(cursor, context))
    measures.update(marketing_measures(cursor, context))
    return measures


# --------------------------------------------------------------------------------------
# The contexts
# --------------------------------------------------------------------------------------

MONTHS: tuple[tuple[str, str, str], ...] = (
    ("2025-07", "2025-07-01", "2025-07-31"),
    ("2025-08", "2025-08-01", "2025-08-31"),
    ("2025-09", "2025-09-01", "2025-09-30"),
    ("2025-10", "2025-10-01", "2025-10-31"),
    ("2025-11", "2025-11-01", "2025-11-30"),
    ("2025-12", "2025-12-01", "2025-12-31"),
)

STORES: tuple[str, ...] = ("GSA-001", "GSA-002", "GSA-003")


def contexts() -> list[Context]:
    """The twenty-one filter contexts the SQL and DAX sides are both evaluated over."""
    built: list[Context] = [
        Context("unfiltered", "The whole model, no filter of any kind."),
    ]
    for store in STORES:
        built.append(
            Context(
                f"store-{store}",
                f"Store {store} only. Proves a measure that is right in total is also "
                "right per store.",
                dealership_code=store,
            )
        )
    for label, start, end in MONTHS:
        built.append(
            Context(
                f"month-{label}",
                f"Calendar month {label} only.",
                date_from=start,
                date_to=end,
                year_month_label=label,
            )
        )
    built += [
        Context(
            "condition-New",
            "New vehicles only, filtered through vw_vehicle[condition_group]. Does NOT "
            "reach vw_inventory_turn, vw_days_supply or vw_marketing_performance, which "
            "carry a condition_group column but no relationship to vw_vehicle.",
            condition_group="New",
        ),
        Context("condition-Used", "Used and certified vehicles only.", condition_group="Used"),
        Context(
            "employee-EMP-00003",
            "One salesperson. Reaches the sale, lead and appointment facts only; every "
            "inventory and marketing measure stays unfiltered by it.",
            employee_code="EMP-00003",
        ),
        Context(
            "lead-source-LDS-001",
            "One lead source, and deliberately a source with NO cost basis: the three "
            "marketing measures must be null here, not zero.",
            lead_source_code="LDS-001",
        ),
        Context(
            "vehicle-model-VMD-00104",
            "One model line, filtered through the vw_vehicle_model -> vw_vehicle "
            "snowflake. Reaches the sale and inventory-snapshot facts only.",
            vehicle_model_code="VMD-00104",
        ),
        # ---------------------------------------------------------------------------
        # Combination contexts.
        #
        # Every context above varies one axis. A filter that reaches a table by the
        # wrong route very often agrees with each single-axis expectation and diverges
        # only where two of them intersect, so single-axis agreement is weak evidence.
        # These four are where the eight relationships added for the imported analytical
        # views are actually tested: a store filter and a month filter both have to land
        # on vw_inventory_turn, vw_days_supply and vw_marketing_performance at once.
        # ---------------------------------------------------------------------------
        Context(
            "store-and-month",
            "One store in one month. The first context in which two filters have to "
            "reach the same table by two different relationships simultaneously.",
            date_from="2025-10-01",
            date_to="2025-10-31",
            year_month_label="2025-10",
            dealership_code="GSA-001",
        ),
        Context(
            "store-and-condition",
            "One store, new vehicles only. The store filter reaches every fact directly; "
            "the condition filter reaches two of them through vw_vehicle and reaches "
            "vw_inventory_turn and vw_days_supply not at all.",
            dealership_code="GSA-002",
            condition_group="New",
        ),
        Context(
            "month-and-condition",
            "One month, used vehicles only. Isolates the snowflake path from the store "
            "path: any disagreement here is a vehicle-dimension problem, not a store one.",
            date_from="2025-11-01",
            date_to="2025-11-30",
            year_month_label="2025-11",
            condition_group="Used",
        ),
        Context(
            "store-month-and-condition",
            "Three filters at once, on the used-only store. Any measure that resolves a "
            "filter path by luck rather than by design fails here or nowhere.",
            date_from="2025-09-01",
            date_to="2025-09-30",
            year_month_label="2025-09",
            dealership_code="GSA-003",
            condition_group="Used",
        ),
        Context(
            "zero-denominator",
            "A store-month with no retail sale at all. Every ratio must be null here. "
            "Reporting a zero would be a false statement rather than a missing one.",
            date_from="2025-07-01",
            date_to="2025-07-01",
            year_month_label="2025-07",
            dealership_code="GSA-003",
            condition_group="New",
        ),
        Context(
            "inactive-relationship-show-date",
            "Appointment measures evaluated on the SHOW date instead of the scheduled "
            "date, which is the inactive relationship KPI-FUN-005 activates with "
            "USERELATIONSHIP. KPI-FUN-004 shifts population here; that is the point.",
            date_from="2025-10-01",
            date_to="2025-10-31",
            year_month_label="2025-10",
            appointment_date_role="show_date_key",
        ),
    ]
    return built


# --------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------


def git_commit() -> str:
    """Return the current commit, so a baseline can be traced to the tree that produced it."""
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):  # pragma: no cover
        return "unknown"


def connection_kwargs() -> dict[str, Any]:
    """Resolve connection settings from ARPI_DATABASE__* then PG*, as the test suite does."""

    def first(*names: str) -> str | None:
        for name in names:
            value = os.environ.get(name)
            if value:
                return value
        return None

    kwargs: dict[str, Any] = {
        "host": first("ARPI_DATABASE__HOST", "PGHOST") or "localhost",
        "port": int(first("ARPI_DATABASE__PORT", "PGPORT") or 5432),
        "dbname": first("ARPI_DATABASE__NAME", "PGDATABASE") or "arpi_dev",
        "user": first("ARPI_DATABASE__USER", "PGUSER") or os.environ.get("USER", "postgres"),
    }
    password = first("ARPI_DATABASE__PASSWORD", "PGPASSWORD")
    if password:
        kwargs["password"] = password
    return kwargs


def collect_metadata(cursor: Any) -> dict[str, Any]:
    """Describe the data the baseline was taken from. Never the machine it was taken on."""
    cursor.execute(
        "SELECT profile_name, random_seed, run_status FROM reporting.vw_pipeline_run_summary "
        "ORDER BY pipeline_run_id DESC LIMIT 1"
    )
    profile, seed, status = cursor.fetchone()
    cursor.execute("SELECT min(calendar_date), max(calendar_date) FROM reporting.vw_calendar")
    first_date, last_date = cursor.fetchone()
    cursor.execute("SELECT count(*) FROM information_schema.views WHERE table_schema = 'reporting'")
    view_count = cursor.fetchone()[0]

    row_counts: dict[str, int] = {}
    for table in [*PROPAGATION, *sorted(set(TABLE_ROW_COUNTS) - set(PROPAGATION))]:
        cursor.execute(f"SELECT count(*) FROM reporting.{table}")
        row_counts[table] = cursor.fetchone()[0]

    cursor.execute(
        "SELECT count(*), count(*) FILTER (WHERE NOT is_passing) "
        "FROM reporting.vw_reconciliation_status"
    )
    reconciliations, failing = cursor.fetchone()

    return {
        "generated_from": "scripts/generate_sql_baseline.py",
        "git_commit": git_commit(),
        "profile": profile,
        "random_seed": seed,
        "pipeline_run_status": status,
        "reporting_date_range": {"first": str(first_date), "last": str(last_date)},
        "reporting_view_count": view_count,
        "database_schema_version": "sql/ tree at the commit above; 104 ordered scripts",
        "row_counts": row_counts,
        "reconciliations": {"total": reconciliations, "failing": failing},
        "credentials_recorded": False,
        "note": (
            "No host, user name or password is recorded here on purpose. The baseline "
            "describes the DATA it was taken from, not the machine it was taken on."
        ),
    }


#: Imported tables whose row counts belong in the metadata but which carry no measure.
TABLE_ROW_COUNTS: tuple[str, ...] = (
    "vw_calendar",
    "vw_dealership",
    "vw_employee",
    "vw_customer",
    "vw_vehicle_model",
    "vw_vehicle",
    "vw_lead_source",
    "vw_marketing_campaign",
    "vw_vehicle_sales",
    "vw_inventory_snapshots",
    "vw_leads",
    "vw_appointments",
    "vw_marketing_spend",
    "vw_inventory_turn",
    "vw_days_supply",
    "vw_marketing_performance",
    "vw_data_quality_trend",
    "vw_reconciliation_status",
    "vw_pipeline_run_summary",
    "vw_data_quality_summary",
)


# --------------------------------------------------------------------------------------
# The DAX side
#
# One query per context, generated from the SAME Context objects the SQL side uses, so
# the two can never drift into filtering different populations. Each query returns a
# single row whose column names are baseline keys, which is what makes the PowerShell
# comparator a dictionary lookup rather than a positional guess.
# --------------------------------------------------------------------------------------

#: Baseline key -> model measure. Keys beginning with SUP- are supporting measures and
#: carry no KPI identifier of their own.
MEASURE_MAP: dict[str, str] = {
    "KPI-SLS-001": "Retail Units Sold",
    "KPI-SLS-002": "New Units Sold",
    "KPI-SLS-003": "Used Units Sold",
    "KPI-GRS-001": "Front-End Gross",
    "KPI-GRS-002": "Back-End Gross",
    "KPI-GRS-003": "Total Gross",
    "KPI-GRS-004": "Front Gross per Retail Unit",
    "KPI-GRS-005": "Back Gross per Retail Unit",
    "KPI-GRS-006": "Total Gross per Retail Unit",
    "KPI-INV-001": "Active Inventory Count",
    "KPI-INV-002": "Inventory Investment",
    "KPI-INV-003": "Average Inventory Age",
    "KPI-INV-004": "Median Inventory Age",
    "KPI-INV-005": "Aged Inventory Count",
    "KPI-INV-006": "Aged Inventory Percentage",
    "KPI-INV-007": "Days to Sale (Median)",
    "KPI-INV-008": "Inventory Turn",
    "KPI-INV-009": "Dealer Days Supply",
    "KPI-FUN-001": "Leads Received",
    "KPI-FUN-002": "Contact Rate",
    "KPI-FUN-003": "Appointment-Set Rate",
    "KPI-FUN-004": "Show Rate",
    "KPI-FUN-005": "Show-to-Sale Conversion",
    "KPI-FUN-006": "Lead-to-Sale Conversion",
    "KPI-FUN-007": "Average Response Time",
    "KPI-FUN-008": "Median Response Time",
    "KPI-MKT-001": "Cost per Lead",
    "KPI-MKT-002": "Cost per Sale",
    "KPI-MKT-003": "Gross Return on Advertising Spend",
    "SUP-DAYS-TO-SALE-MEAN": "Days to Sale (Mean)",
    "SUP-AGED-INVESTMENT": "Aged Inventory Investment",
    "SUP-UNRESPONDED-LEADS": "Unresponded Leads",
    "SUP-DUPLICATE-LEADS": "Duplicate Leads",
    "SUP-SOLD-LEADS": "Sold Leads",
    "SUP-ELIGIBLE-APPOINTMENTS": "Eligible Appointments",
    "SUP-SHOWN-APPOINTMENTS": "Shown Appointments",
    "SUP-ADVANCE-CANCELLATIONS": "Advance Cancellations",
    "SUP-CANCELLATION-RATE": "Cancellation Rate",
}


def dax_predicates(context: Context) -> list[str]:
    """Return the CALCULATETABLE filter arguments equivalent to this context's SQL clauses."""
    predicates: list[str] = []
    if context.date_from and context.date_to:
        start = context.date_from.split("-")
        end = context.date_to.split("-")
        predicates.append(
            f"'vw_calendar'[calendar_date] >= DATE ( {int(start[0])}, {int(start[1])}, "
            f"{int(start[2])} )\n            && 'vw_calendar'[calendar_date] <= DATE ( "
            f"{int(end[0])}, {int(end[1])}, {int(end[2])} )"
        )
    if context.dealership_code:
        predicates.append(f"'vw_dealership'[dealership_code] = \"{context.dealership_code}\"")
    if context.condition_group:
        predicates.append(f"'vw_vehicle'[condition_group] = \"{context.condition_group}\"")
    if context.employee_code:
        predicates.append(f"'vw_employee'[employee_code] = \"{context.employee_code}\"")
    if context.lead_source_code:
        predicates.append(f"'vw_lead_source'[lead_source_code] = \"{context.lead_source_code}\"")
    if context.vehicle_model_code:
        predicates.append(
            f"'vw_vehicle_model'[vehicle_model_code] = \"{context.vehicle_model_code}\""
        )
    if context.appointment_date_role == "show_date_key":
        predicates.append(
            "USERELATIONSHIP ( 'vw_calendar'[date_key], 'vw_appointments'[show_date_key] )"
        )
    return predicates


def write_dax_queries(path: Path) -> int:
    """Write one DAX query per context and return how many were written."""
    header = """// =============================================================================
// ARPI SQL-to-DAX validation queries
//
// GENERATED by scripts/generate_sql_baseline.py from the same Context definitions that
// produced powerbi/validation/sql_baseline.json. Do not hand-edit: regenerate instead,
// or the two sides stop describing the same population and the comparison becomes
// meaningless.
//
// One query per filter context. Each returns a single row whose column names are the
// baseline keys in sql_baseline.json, so scripts/validate_powerbi_model.ps1 compares by
// name rather than by position.
//
// A measure can have a correct grand total and still be wrong under filter context.
// That is why the unfiltered query is one of twenty-one rather than the only one.
// =============================================================================
"""
    blocks: list[str] = [header]
    for context in contexts():
        predicates = dax_predicates(context)
        assignments = ",\n        ".join(
            f'"{key}", [{measure}]' for key, measure in MEASURE_MAP.items()
        )
        row = f"    ROW (\n        {assignments}\n    )"
        if predicates:
            filters = ",\n        ".join(predicates)
            body = f"EVALUATE\nCALCULATETABLE (\n{row},\n        {filters}\n)"
        else:
            body = f"EVALUATE\n{row.lstrip()}"
        blocks.append(
            f"\n// ARPI-CONTEXT: {context.context_id}\n// {context.description}\n{body}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")
    return len(contexts())


def write_model_expectations(path: Path, metadata: dict[str, Any]) -> None:
    """Write the model inventories the Desktop validator checks the live model against."""
    path.write_text(
        json.dumps(
            {
                "schema": "arpi.model_expectations/1",
                "project": "ARPI_Performance_Intelligence",
                "storage_mode": "Import",
                "source_schema": "reporting",
                "database_identity": "arpi_reporter",
                "table_count": 26,
                "imported_table_count": 20,
                "measure_table_count": 6,
                "relationship_count": 42,
                "active_relationship_count": 32,
                "inactive_relationship_count": 10,
                "bidirectional_relationship_count": 0,
                "many_to_many_relationship_count": 0,
                "marked_date_table": "vw_calendar",
                "marked_date_column": "calendar_date",
                "measure_count": 49,
                "kpi_measure_count": 29,
                "supporting_measure_count": 20,
                "expected_row_counts": metadata["row_counts"],
                "measure_map": MEASURE_MAP,
                "profile": metadata["profile"],
                "note": (
                    "Row counts are the development profile. The test profile is smaller "
                    "and the portfolio profile larger; a refresh against either will not "
                    "match these counts and must not be compared against them."
                ),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    """Evaluate every context against the database and write the four validation artefacts."""
    if psycopg is None:
        print("psycopg is required: pip install -e '.[db]'", file=sys.stderr)
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("ARPI SQL-to-DAX baseline")

    with psycopg.connect(**connection_kwargs()) as connection, connection.cursor() as cursor:
        metadata = collect_metadata(cursor)
        evaluated = []
        for context in contexts():
            values = evaluate(cursor, context)
            evaluated.append(
                {
                    "context_id": context.context_id,
                    "description": context.description,
                    "filters": context.as_filters(),
                    "measures": values,
                }
            )
            print(f"  {context.context_id:<34} {len(values)} values")

    baseline = {
        "schema": "arpi.sql_baseline/1",
        "contexts": evaluated,
    }
    (OUTPUT_DIR / "sql_baseline.json").write_text(
        json.dumps(baseline, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )
    (OUTPUT_DIR / "sql_baseline_metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    query_count = write_dax_queries(OUTPUT_DIR / "validation_queries.dax")
    write_model_expectations(OUTPUT_DIR / "model_expectations.json", metadata)

    print(f"\nwrote {len(evaluated)} contexts to powerbi/validation/sql_baseline.json")
    print("wrote powerbi/validation/sql_baseline_metadata.json")
    print(f"wrote {query_count} DAX queries to powerbi/validation/validation_queries.dax")
    print("wrote powerbi/validation/model_expectations.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
