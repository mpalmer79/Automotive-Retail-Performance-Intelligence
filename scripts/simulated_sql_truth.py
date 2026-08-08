"""SIMULATED SEMANTIC-MODEL VALIDATION — the SQL-side reference, computed independently.

WHY A SECOND IMPLEMENTATION
---------------------------
`powerbi/model_documentation/09-sql-to-dax-reconciliation.md` explains why reconciliation
is worth doing at all: for most KPIs the SQL side and the model side read **different
objects**, nothing forces them to agree, and two defensible numbers where there should be
one is the failure mode. That argument does not depend on which engine evaluates the DAX.

This module is the SQL side of a **simulated** reconciliation. It computes every measure
straight from the rows of `powerbi/validation/simulated_fact_source.json`, using the
governed definition in `KPI_CATALOG.md` — the date basis, the numerator, the denominator,
the population — and nothing from the TMDL. `scripts/dax_simulation.py` computes the same
measures by parsing the TMDL and applying filter context. Two implementations, one set of
governed definitions, and a comparison that fails when they disagree.

WHAT A PASS HERE MEANS, EXACTLY
-------------------------------
That the model's declared semantics and the governed SQL semantics agree **on this fact
source**. Not that either matches the production database, not that a Microsoft engine
would return these numbers, and not that Gate 2 has moved. Those remain externally
pending. See ADR-0014.

THE ONE CONVENTION WORTH STATING
--------------------------------
A condition context is **not** a filter on every table that happens to have a
`condition_group` column. In the model it comes from `vw_vehicle`, so it reaches
`vw_vehicle_sales` and `vw_inventory_snapshots` and **nothing else** — not the lead and
appointment grain, and not `vw_inventory_turn` or `vw_days_supply`, both of which carry a
`condition_group` column of their own that the filter never touches. That is the
propagation `scripts/generate_sql_baseline.py` models, for the reason its docstring gives:
a baseline that applied the filter everywhere would disagree with a correct model.

This simulation's fact source has no `vw_vehicle` rows, so it applies the condition
directly to the two reached tables' own columns as a stand-in for that path. The
consequence is checked rather than assumed: the funnel measures, Inventory Turn and Dealer
Days Supply must all be unmoved by a condition context, and the harness asserts it.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Any

#: Returned for a measure this module deliberately does not compute.
NOT_MODELLED = "NOT_MODELLED"

#: The DAX BLANK, as the reference side spells it. Kept separate from the engine's BLANK
#: so that neither implementation can borrow the other's notion of emptiness.
BLANK = "BLANK"

#: The tables a condition filter actually reaches, which is the model's propagation and
#: not the set of tables holding a `condition_group` column. `vw_inventory_turn` and
#: `vw_days_supply` hold one and are deliberately absent: no relationship carries the
#: filter to them.
CONDITION_TABLES = (
    "vw_vehicle_sales",
    "vw_inventory_snapshots",
)

#: Seconds in a minute — both response-time measures divide by it.
SECONDS_PER_MINUTE = 60


@dataclass(frozen=True)
class SimulatedContext:
    """One filter context, in business terms rather than in DAX."""

    context_id: str
    description: str
    store_code: str | None = None
    month_label: str | None = None
    condition: str | None = None


#: The contexts both sides are evaluated in. Each one exists to make a specific behaviour
#: falsifiable; the description says which.
CONTEXTS: tuple[SimulatedContext, ...] = (
    SimulatedContext("unfiltered", "No filter of any kind."),
    SimulatedContext(
        "store-GSA-001",
        "One store. Proves the dealership filter reaches every fact table.",
        store_code="GSA-001",
    ),
    SimulatedContext(
        "store-GSA-002",
        "A store with sales but no November activity.",
        store_code="GSA-002",
    ),
    SimulatedContext(
        "store-GSA-003",
        "A store with one uncontacted lead and no marketing spend: the zero-denominator "
        "and blank-spend context.",
        store_code="GSA-003",
    ),
    SimulatedContext(
        "month-2025-11",
        "One month. Proves each fact table's active date basis.",
        month_label="2025-11",
    ),
    SimulatedContext(
        "month-2025-12",
        "The later month, which is also the last snapshot date.",
        month_label="2025-12",
    ),
    SimulatedContext(
        "condition-New",
        "New only. Must not move a lead or appointment measure.",
        condition="New",
    ),
    SimulatedContext("condition-Used", "Used only.", condition="Used"),
    SimulatedContext(
        "store-and-month",
        "Two filters at once, on different tables, reaching the same facts.",
        store_code="GSA-001",
        month_label="2025-12",
    ),
    SimulatedContext(
        "store-month-and-condition",
        "Three filters at once.",
        store_code="GSA-001",
        month_label="2025-12",
        condition="Used",
    ),
    SimulatedContext(
        "empty-month",
        "A month with no rows anywhere: every measure must be BLANK or an explicit zero, "
        "and none may be a number that looks like data.",
        month_label="2025-10",
    ),
)


# ---------------------------------------------------------------------------
# Small aggregation helpers, written for clarity rather than for speed
# ---------------------------------------------------------------------------


def _values(rows: list[dict[str, Any]], column: str) -> list[Any]:
    """Return the non-null values of *column* across *rows*."""
    return [row[column] for row in rows if row.get(column) is not None]


def _sum(rows: list[dict[str, Any]], column: str) -> Any:
    """Sum a column, returning BLANK over an empty set as SQL's SUM and DAX's both do."""
    values = _values(rows, column)
    return BLANK if not values else sum(values)


def _sum_or_zero(rows: list[dict[str, Any]], column: str) -> Any:
    """Sum a column, reading an empty set as zero — the model's `+ 0` idiom."""
    total = _sum(rows, column)
    return 0 if total is BLANK else total


def _median(rows: list[dict[str, Any]], column: str) -> Any:
    """Median of a column's non-null values, BLANK when there are none."""
    values = _values(rows, column)
    return BLANK if not values else statistics.median(values)


def _divide(numerator: Any, denominator: Any) -> Any:
    """DIVIDE: BLANK on a zero or blank denominator, never an error."""
    if denominator is BLANK or denominator == 0:
        return BLANK
    if numerator is BLANK:
        return BLANK
    return numerator / denominator


def _last_date_value(rows: list[dict[str, Any]], date_column: str, compute: Any) -> Any:
    """Apply the semi-additive rule: the value at the last date where it is not BLANK."""
    result: Any = BLANK
    for date_key in sorted({row[date_column] for row in rows if row.get(date_column) is not None}):
        slice_rows = [row for row in rows if row.get(date_column) == date_key]
        value = compute(slice_rows)
        if value is not BLANK:
            result = value
    return result


# ---------------------------------------------------------------------------
# The reference itself
# ---------------------------------------------------------------------------


class SqlTruth:
    """Computes every measure from the simulated fact source, the governed way."""

    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        """Index the dimension lookups both the store and month filters need."""
        self.tables = tables
        self._store_keys = {
            row["dealership_code"]: row["dealership_key"] for row in tables["vw_dealership"]
        }
        self._month_keys: dict[str, set[int]] = {}
        for row in tables["vw_calendar"]:
            self._month_keys.setdefault(row["year_month_label"], set()).add(row["date_key"])

    # -- row selection ---------------------------------------------------

    def rows(
        self,
        table: str,
        context: SimulatedContext,
        date_column: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return the rows of *table* the governed query would read in *context*.

        `date_column` names the date basis the governed definition uses for this table,
        which is the whole point of stating it here: an appointment is filtered on its
        scheduled date for the show rate and on its show date for show-to-sale, and a
        reference implementation that got that wrong would agree with a model that got it
        wrong in the same way.
        """
        selected = list(self.tables.get(table, []))
        if context.store_code is not None and selected and "dealership_key" in selected[0]:
            key = self._store_keys.get(context.store_code)
            selected = [row for row in selected if row.get("dealership_key") == key]
        if context.month_label is not None and date_column is not None:
            keys = self._month_keys.get(context.month_label, set())
            selected = [row for row in selected if row.get(date_column) in keys]
        if context.condition is not None and table in CONDITION_TABLES:
            selected = [row for row in selected if row.get("condition_group") == context.condition]
        return selected

    # -- measure groups --------------------------------------------------

    def _sales(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_vehicle_sales", context, "sale_date_key")

    def _leads(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_leads", context, "lead_created_date_key")

    def _appointments(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_appointments", context, "scheduled_date_key")

    def _appointments_on_show_date(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_appointments", context, "show_date_key")

    def _snapshots(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_inventory_snapshots", context, "snapshot_date_key")

    def _marketing(self, context: SimulatedContext) -> list[dict[str, Any]]:
        return self.rows("vw_marketing_performance", context, "month_date_key")

    def _sales_measures(self, context: SimulatedContext) -> dict[str, Any]:
        sales = self._sales(context)
        return {
            "Retail Units Sold": _sum_or_zero(sales, "retail_unit_count"),
            "New Units Sold": _sum_or_zero(sales, "new_unit_count"),
            "Used Units Sold": _sum_or_zero(sales, "used_unit_count"),
        }

    def _gross_measures(self, context: SimulatedContext) -> dict[str, Any]:
        sales = self._sales(context)
        units = _sum_or_zero(sales, "retail_unit_count")
        front = _sum(sales, "retail_front_end_gross")
        back = _sum(sales, "retail_back_end_gross")
        total = _sum(sales, "retail_total_gross")
        return {
            "Front-End Gross": front,
            "Back-End Gross": back,
            "Total Gross": total,
            "Front Gross per Retail Unit": _divide(front, units),
            "Back Gross per Retail Unit": _divide(back, units),
            "Total Gross per Retail Unit": _divide(total, units),
        }

    def _inventory_measures(self, context: SimulatedContext) -> dict[str, Any]:
        snapshots = self._snapshots(context)
        sales = self._sales(context)
        date_column = "snapshot_date_key"

        def at_last(compute: Any) -> Any:
            return _last_date_value(snapshots, date_column, compute)

        turn = self.rows("vw_inventory_turn", context, "month_date_key")
        supply = self.rows("vw_days_supply", context, "as_of_date_key")
        return {
            "Active Inventory Count": at_last(lambda rows: _sum(rows, "inventory_unit_count")),
            "Inventory Investment": at_last(lambda rows: _sum(rows, "inventory_investment")),
            "Average Inventory Age": at_last(
                lambda rows: _divide(
                    _sum(rows, "days_in_stock"), _sum(rows, "inventory_unit_count")
                )
            ),
            "Median Inventory Age": at_last(lambda rows: _median(rows, "days_in_stock")),
            "Aged Inventory Count": at_last(lambda rows: _sum(rows, "aged_unit_count")),
            "Aged Inventory Percentage": at_last(
                lambda rows: _divide(
                    _sum(rows, "aged_unit_count"), _sum(rows, "inventory_unit_count")
                )
            ),
            "Aged Inventory Investment": at_last(
                lambda rows: _sum(rows, "aged_inventory_investment")
            ),
            "Days to Sale (Median)": _median(sales, "retail_days_in_inventory"),
            "Days to Sale (Mean)": _divide(
                _sum(sales, "retail_days_in_inventory_total"),
                _sum_or_zero(sales, "retail_unit_count"),
            ),
            "Inventory Turn": _divide(
                _sum(turn, "annualized_retail_units"),
                _sum(turn, "average_daily_active_inventory"),
            ),
            "Dealer Days Supply": _last_date_value(
                supply,
                "as_of_date_key",
                lambda rows: _divide(
                    _sum(rows, "active_inventory_units"),
                    _sum(rows, "average_daily_retail_sales"),
                ),
            ),
        }

    def _funnel_measures(self, context: SimulatedContext) -> dict[str, Any]:
        leads = self._leads(context)
        appointments = self._appointments(context)
        on_show_date = self._appointments_on_show_date(context)
        response_minutes = _divide(
            _sum(leads, "response_seconds_total"), _sum(leads, "responded_lead_count")
        )
        return {
            "Leads Received": _sum_or_zero(leads, "valid_lead_count"),
            "Contact Rate": _divide(
                _sum(leads, "contacted_lead_count"), _sum(leads, "valid_lead_count")
            ),
            "Appointment-Set Rate": _divide(
                _sum(leads, "appointment_set_lead_count"), _sum(leads, "contacted_lead_count")
            ),
            "Show Rate": _divide(
                _sum(appointments, "shown_appointment_count"),
                _sum(appointments, "eligible_appointment_count"),
            ),
            "Show-to-Sale Conversion": _divide(
                _sum(on_show_date, "shown_and_sold_appointment_count"),
                _sum(on_show_date, "shown_appointment_count"),
            ),
            "Lead-to-Sale Conversion": _divide(
                _sum(leads, "sold_lead_count"), _sum(leads, "valid_lead_count")
            ),
            "Average Response Time": (
                BLANK if response_minutes is BLANK else response_minutes / SECONDS_PER_MINUTE
            ),
            "Median Response Time": _divide(
                _median(leads, "first_response_seconds"), SECONDS_PER_MINUTE
            ),
            "Unresponded Leads": _sum_or_zero(leads, "unresponded_lead_count"),
            "Duplicate Leads": _sum_or_zero(leads, "duplicate_lead_count"),
            "Sold Leads": _sum_or_zero(leads, "sold_lead_count"),
            "Eligible Appointments": _sum_or_zero(appointments, "eligible_appointment_count"),
            "Shown Appointments": _sum_or_zero(appointments, "shown_appointment_count"),
            "Advance Cancellations": _sum_or_zero(appointments, "cancelled_in_advance_count"),
            "Cancellation Rate": _divide(
                _sum(appointments, "cancelled_in_advance_count"),
                _sum(appointments, "appointment_count"),
            ),
        }

    def _marketing_measures(self, context: SimulatedContext) -> dict[str, Any]:
        marketing = self._marketing(context)
        spend = _sum(marketing, "spend_amount")
        blank_spend = spend is BLANK
        return {
            "Cost per Lead": (
                BLANK if blank_spend else _divide(spend, _sum(marketing, "attributed_leads"))
            ),
            "Cost per Sale": (
                BLANK if blank_spend else _divide(spend, _sum(marketing, "attributed_retail_units"))
            ),
            "Gross Return on Advertising Spend": (
                BLANK if blank_spend else _divide(_sum(marketing, "attributed_total_gross"), spend)
            ),
        }

    def _operational_measures(self) -> dict[str, Any]:
        """The data-quality and pipeline measures, which no context filters.

        None of these three tables is related to the calendar or to a dealership, so their
        measures are constant across contexts. That is itself a claim worth checking: a
        relationship added later would make it false on both sides at once, which is why
        the harness also asserts the constancy directly.
        """
        trend = self.tables["vw_data_quality_trend"]
        reconciliations = self.tables["vw_reconciliation_status"]
        runs = self.tables["vw_pipeline_run_summary"]
        succeeded = [row for row in runs if row.get("run_status") == "succeeded"]
        latest_run = max((row["pipeline_run_id"] for row in runs), default=None)
        latest = [row for row in runs if row.get("pipeline_run_id") == latest_run]
        latest_statuses = {row.get("run_status") for row in latest if row.get("run_status")}
        duration = _sum(latest, "duration_seconds")
        return {
            "Checks Passed": _sum_or_zero(trend, "checks_passed"),
            "Checks Failed": _sum_or_zero(trend, "checks_failed"),
            "Checks Skipped": _sum_or_zero(trend, "checks_skipped"),
            "Pass Rate": _divide(_sum(trend, "checks_passed"), _sum(trend, "checks_evaluated")),
            "Evaluation Coverage": _divide(
                _sum(trend, "checks_evaluated"), _sum(trend, "checks_recorded")
            ),
            "Critical Reconciliations Failed": len(
                [
                    row
                    for row in reconciliations
                    if row.get("is_critical") is True and row.get("is_passing") is False
                ]
            ),
            "Reconciliation Difference": _sum(reconciliations, "absolute_difference"),
            "Last Successful Refresh": (
                max(_values(succeeded, "completed_at")) if succeeded else BLANK
            ),
            "Pipeline Status": (
                next(iter(latest_statuses)) if len(latest_statuses) == 1 else BLANK
            ),
            "Pipeline Duration": (BLANK if duration is BLANK else duration / SECONDS_PER_MINUTE),
            "Rejected Rows": _sum_or_zero(runs, "rejected_row_count"),
        }

    def evaluate(self, context: SimulatedContext) -> dict[str, Any]:
        """Return every measure's governed value in *context*."""
        results: dict[str, Any] = {}
        results.update(self._sales_measures(context))
        results.update(self._gross_measures(context))
        results.update(self._inventory_measures(context))
        results.update(self._funnel_measures(context))
        results.update(self._marketing_measures(context))
        results.update(self._operational_measures())
        return results
