"""The dashboard export against a real, loaded PostgreSQL warehouse (``DASH.1``).

This is the half of the export's evidence that a database double cannot provide:

* every allowlisted view exists at the grain the contract declares;
* ``arpi_reporter`` can read every one of them, and still cannot reach ``raw``,
  ``staging``, ``warehouse`` or ``audit``;
* the exported row count equals the source view's row count, dataset by dataset;
* **every exported cell equals the value the view produced** -- the strongest form of the
  source-to-export link, and the one that covers the non-additive figures no group total
  can evidence;
* the group totals in the manifest equal totals computed independently in SQL, including
  the exact gross figures and the empty-denominator cases;
* generate and check agree, and a mutated export is caught.

The suite runs against the session-scoped ``loaded_database`` fixture, which builds the SQL
tree and runs one real pipeline through the production load path. It uses the ``test``
profile's two-month window, so the figures here are smaller than the committed
``development`` export -- the assertions are all relative to what the database holds, never
to a hardcoded number, so both profiles satisfy them.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from arpi.dashboard import contract as spec
from arpi.dashboard.export import (
    check_export,
    generate_export,
)
from arpi.dashboard.serialization import content_sha256, render_dataset_bytes

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]

FIXED_GENERATED_AT = "2026-08-07T00:00:00+00:00"


# =======================================================================================
# Fixtures
# =======================================================================================


@pytest.fixture(scope="module")
def export_tree(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A directory the module's exports are written into."""
    return tmp_path_factory.mktemp("dashboard-export")


@pytest.fixture()
def reporter_cursor(loaded_db: Any) -> Any:
    """A cursor inside the ``arpi_reporter`` role.

    ``SET ROLE`` is reverted by the rollback the ``loaded_db`` fixture performs, so no test
    leaks the role into the next one.
    """
    with loaded_db.cursor() as cursor:
        cursor.execute(f"SET ROLE {spec.REPORTER_ROLE}")
        yield cursor


@pytest.fixture()
def exported(loaded_db: Any, export_tree: Path) -> Any:
    """One generated export of the loaded warehouse, for the tests that read it."""
    result = generate_export(
        loaded_db,
        output_dir=export_tree,
        repo_root=REPO_ROOT,
        generated_at=FIXED_GENERATED_AT,
    )
    assert result.ok, result.problems
    return result


def _rows(cursor: Any, statement: str, params: Any = None) -> list[tuple[Any, ...]]:
    """Run a statement and return every row."""
    cursor.execute(statement, params)
    return list(cursor.fetchall())


def _scalar(cursor: Any, statement: str) -> Any:
    """Run a statement and return its first column of its first row."""
    cursor.execute(statement)
    row = cursor.fetchone()
    return None if row is None else row[0]


# =======================================================================================
# The reporting layer is what the contract says it is
# =======================================================================================


class TestSourceViewsExist:
    """Every allowlisted view is real, readable, and shaped as declared."""

    def test_every_allowlisted_view_exists(self, reporter_cursor: Any) -> None:
        present = {
            name
            for (name,) in _rows(
                reporter_cursor,
                "SELECT table_name FROM information_schema.views WHERE table_schema = %s",
                (spec.ALLOWED_SOURCE_SCHEMA,),
            )
        }
        missing = sorted(set(spec.SOURCE_VIEW_ALLOWLIST) - present)
        assert missing == [], (
            f"the contract allowlists {missing}, which the reporting schema does not contain"
        )

    def test_every_declared_column_exists_in_its_view(self, reporter_cursor: Any) -> None:
        """No column is inferred from documentation: each is checked against the object."""
        for entry in spec.DATASETS:
            present = {
                name
                for (name,) in _rows(
                    reporter_cursor,
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = %s AND table_name = %s",
                    (spec.ALLOWED_SOURCE_SCHEMA, entry.source_view),
                )
            }
            required = {
                column.source_column.split(".", 1)[1]
                for column in entry.columns
                if column.source_column.startswith(f"{entry.source_view}.")
            }
            assert required <= present, (
                f"{entry.name} requires {sorted(required - present)} from "
                f"{entry.source_view}, which does not declare them"
            )

    def test_every_view_declares_its_grain_in_a_comment(self, reporter_cursor: Any) -> None:
        for view in spec.SOURCE_VIEW_ALLOWLIST:
            qualified = f"{spec.ALLOWED_SOURCE_SCHEMA}.{view}"
            comment = _scalar(
                reporter_cursor,
                f"SELECT obj_description('{qualified}'::regclass, 'pg_class')",
            )
            assert comment, f"{view} carries no COMMENT ON VIEW"
            assert "Grain" in str(comment) or "grain" in str(comment), view

    def test_the_declared_business_key_is_unique_in_the_source_view(
        self, reporter_cursor: Any
    ) -> None:
        """The grain the contract declares is the grain the view actually has.

        Checked on the SOURCE columns behind the business key, not on the exported business
        codes, so a duplicate is attributed to the view rather than to the exporter. A NULL
        key component -- campaign_key on a source with no campaign -- counts as one distinct
        value, which is exactly how the export treats it.
        """
        for entry in spec.DATASETS:
            columns = spec.source_grain_columns(entry)
            assert columns, entry.name
            projection = ", ".join(columns)
            where = f" WHERE {entry.where}" if entry.where else ""
            duplicates = _scalar(
                reporter_cursor,
                f"SELECT count(*) FROM (SELECT {projection} "
                f"FROM {spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view} AS base{where} "
                f"GROUP BY {projection} HAVING count(*) > 1) AS d",
            )
            assert int(duplicates) == 0, (
                f"{entry.source_view} repeats ({projection}), so {entry.name}'s declared grain "
                f"({entry.grain}) is wrong"
            )

    def test_the_source_grain_columns_exist_in_the_view(self, reporter_cursor: Any) -> None:
        """The mapping from business key back to surrogate is real, not assumed."""
        for entry in spec.DATASETS:
            present = {
                name
                for (name,) in _rows(
                    reporter_cursor,
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = %s AND table_name = %s",
                    (spec.ALLOWED_SOURCE_SCHEMA, entry.source_view),
                )
            }
            for column in spec.source_grain_columns(entry):
                assert column in present, f"{entry.source_view} has no {column}"


class TestReporterRoleBoundary:
    """The privilege boundary the export claims is the one PostgreSQL enforces."""

    def test_the_reporter_can_select_every_allowlisted_view(self, reporter_cursor: Any) -> None:
        for view in spec.SOURCE_VIEW_ALLOWLIST:
            count = _scalar(
                reporter_cursor, f"SELECT count(*) FROM {spec.ALLOWED_SOURCE_SCHEMA}.{view}"
            )
            assert int(count) >= 0

    def test_the_reporter_can_run_every_generated_export_query(self, reporter_cursor: Any) -> None:
        """The queries the exporter will actually issue succeed under the console's privilege."""
        for entry in spec.DATASETS:
            reporter_cursor.execute(spec.dataset_sql(entry))
            reporter_cursor.fetchall()

    def test_the_reporter_holds_no_privilege_on_any_object_outside_reporting(
        self, loaded_cursor: Any
    ) -> None:
        """Swept over whatever exists, so a table a later increment adds is covered.

        Asked as the owner rather than as the reporter: ``information_schema`` only shows a
        role the objects it can already see, so listing tables from inside the reporter role
        would return an empty set and the test would pass by seeing nothing.
        """
        loaded_cursor.execute(
            """
            SELECT n.nspname || '.' || c.relname, p.privilege
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
            WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'audit')
              AND c.relkind IN ('r', 'p', 'v', 'm')
              AND has_table_privilege(%s, c.oid, p.privilege)
            ORDER BY 1, 2
            """,
            (spec.REPORTER_ROLE,),
        )
        held = loaded_cursor.fetchall()
        assert held == [], (
            f"{spec.REPORTER_ROLE} holds privilege on {held}. ADR-0013 condition 8 requires the "
            "export identity to be unable to reach those schemas at all."
        )

    def test_the_sweep_above_is_looking_at_real_objects(self, loaded_cursor: Any) -> None:
        """Guards the previous test against passing because the schemas are empty."""
        loaded_cursor.execute(
            "SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace "
            "WHERE n.nspname IN ('raw', 'staging', 'warehouse', 'audit') "
            "AND c.relkind IN ('r', 'p', 'v', 'm')"
        )
        assert int(loaded_cursor.fetchone()[0]) > 0

    @pytest.mark.parametrize(
        "qualified_name",
        [
            "raw.sale_event_load",
            "staging.stg_sale_event",
            "warehouse.fact_vehicle_sale",
            "audit.pipeline_run",
        ],
    )
    def test_the_reporter_cannot_read_a_representative_prohibited_object(
        self, reporter_cursor: Any, qualified_name: str
    ) -> None:
        """The deny path is asserted by running the query, not by trusting a grant.

        One object per prohibited schema, each in its own test, because a privilege error
        aborts the transaction and a loop would only ever prove the first one.
        """
        import psycopg

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            reporter_cursor.execute(f"SELECT count(*) FROM {qualified_name}")


# =======================================================================================
# Source to export: counts, then every cell
# =======================================================================================


class TestSourceToExportFidelity:
    """The export is the view, selected and serialised -- nothing more and nothing less."""

    def test_every_dataset_row_count_equals_its_source_view(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        for entry in spec.DATASETS:
            where = f" WHERE {entry.where}" if entry.where else ""
            source = int(
                _scalar(
                    reporter_cursor,
                    f"SELECT count(*) FROM {spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view} "
                    f"AS base{where}",
                )
            )
            declared = next(
                item for item in exported.manifest["datasets"] if item["name"] == entry.name
            )
            assert declared["row_count"] == source, (
                f"{entry.name} exported {declared['row_count']} row(s) from a view holding {source}"
            )

    def test_every_exported_cell_equals_the_value_the_view_produced(
        self, reporter_cursor: Any, exported: Any, export_tree: Path
    ) -> None:
        """The strongest source-to-export statement available.

        A group total cannot evidence a median, a percentile, a days supply or an inventory
        turn -- none of them is additive. Row-level equality covers all of them, and every
        other column besides, so no exported figure is unevidenced.
        """
        for entry in spec.DATASETS:
            reporter_cursor.execute(spec.dataset_sql(entry))
            source_rows = list(reporter_cursor.fetchall())
            exported_rows = json.loads((export_tree / entry.file_name).read_text(encoding="utf-8"))
            assert len(exported_rows) == len(source_rows), entry.name

            for index, (source_row, exported_row) in enumerate(
                zip(source_rows, exported_rows, strict=True)
            ):
                for column, source_value in zip(entry.columns, source_row, strict=True):
                    exported_value = exported_row[column.name]
                    label = f"{entry.name}[{index}].{column.name}"
                    if source_value is None:
                        assert exported_value is None, label
                        continue
                    if column.type in {"currency", "exact"}:
                        assert Decimal(str(exported_value)) == Decimal(str(source_value)), label
                    elif column.type == "double":
                        assert exported_value == pytest.approx(float(source_value), rel=0, abs=0), (
                            label
                        )
                    elif column.type == "date":
                        assert exported_value == source_value.isoformat(), label
                    elif column.type == "integer":
                        assert exported_value == int(source_value), label
                    else:
                        assert str(exported_value) == str(source_value), label

    def test_no_exported_column_is_a_surrogate_key(self, exported: Any) -> None:
        for entry in exported.manifest["datasets"]:
            for column in entry["columns"]:
                assert not column["name"].endswith("_key") or column["name"].endswith(
                    "_sort_order"
                ), f"{entry['name']}.{column['name']}"

    def test_every_store_code_resolves_to_a_real_store(
        self, reporter_cursor: Any, export_tree: Path
    ) -> None:
        codes = {
            code
            for (code,) in _rows(
                reporter_cursor, "SELECT dealership_code FROM reporting.vw_dealership"
            )
        }
        assert codes, "the loaded warehouse should hold stores"
        for entry in spec.DATASETS:
            if "dealership_id" not in entry.column_names:
                continue
            rows = json.loads((export_tree / entry.file_name).read_text(encoding="utf-8"))
            exported = {row["dealership_id"] for row in rows}
            assert exported <= codes, f"{entry.name} names unknown store(s) {exported - codes}"


# =======================================================================================
# Reconciliation against independent SQL
# =======================================================================================


def test_export_totals_match_reporting(reporter_cursor: Any, exported: Any) -> None:
    """Every manifest total, recomputed in SQL over the source view it came from.

    A module-level function rather than a method, because `DASH.1-03` names this test by
    the node id ``tests/integration/test_dashboard_export.py::test_export_totals_match_reporting``
    and a backlog item that points at a test which does not exist under that name is not a
    reference.
    """
    totals = exported.manifest["reconciliation"]["totals"]
    assert totals, "the manifest should carry reconciliation totals"

    for name, total in totals.items():
        entry = spec.dataset(str(total["dataset"]))
        where = f" WHERE {entry.where}" if entry.where else ""
        components = (
            [("total", str(total["column"]))]
            if "total" in total
            else [
                ("numerator", str(total["numerator_column"])),
                ("denominator", str(total["denominator_column"])),
            ]
        )
        for label, column in components:
            source_column = entry.column(column).expression.replace("base.", "")
            summed = _scalar(
                reporter_cursor,
                f"SELECT coalesce(sum({source_column}), 0) FROM "
                f"{spec.ALLOWED_SOURCE_SCHEMA}.{entry.source_view} AS base{where}",
            )
            assert Decimal(str(total[label])) == Decimal(str(summed)), (
                f"{name}.{label}: the manifest records {total[label]} but summing "
                f"{entry.source_view}.{source_column} gives {summed}"
            )


class TestExportTotalsMatchReporting:
    """Family-by-family reconciliation against independently derived SQL."""

    def test_the_gross_totals_are_exact_to_the_cent(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        """Front, back and total gross, derived from the row-grain fact view instead.

        A different path from the one the export took: ``vw_vehicle_sales`` is the
        transaction-grain view, and ``vw_gross_summary`` aggregates it. Agreement between
        the two is what makes the figure evidence rather than a tautology.
        """
        front, back, total, units = _rows(
            reporter_cursor,
            "SELECT sum(retail_front_end_gross), sum(retail_back_end_gross), "
            "sum(retail_total_gross), sum(retail_unit_count) "
            "FROM reporting.vw_vehicle_sales",
        )[0]
        totals = exported.manifest["reconciliation"]["totals"]
        assert Decimal(str(totals["front_end_gross"]["total"])) == Decimal(str(front))
        assert Decimal(str(totals["back_end_gross"]["total"])) == Decimal(str(back))
        assert Decimal(str(totals["total_gross"]["total"])) == Decimal(str(total))
        assert Decimal(str(totals["retail_units"]["total"])) == Decimal(str(units))
        # The identity that makes the three ratios consistent.
        assert Decimal(str(front)) + Decimal(str(back)) == Decimal(str(total))

    def test_the_unit_totals_reconcile_to_the_fact_view(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        new_units, used_units = _rows(
            reporter_cursor,
            "SELECT count(*) FILTER (WHERE s.is_retail AND v.condition_group = 'New'), "
            "count(*) FILTER (WHERE s.is_retail AND v.condition_group = 'Used') "
            "FROM reporting.vw_vehicle_sales AS s "
            "JOIN reporting.vw_vehicle AS v ON v.vehicle_key = s.vehicle_key",
        )[0]
        totals = exported.manifest["reconciliation"]["totals"]
        assert int(totals["new_units"]["total"]) == int(new_units)
        assert int(totals["used_units"]["total"]) == int(used_units)
        assert int(totals["retail_units"]["total"]) == int(new_units) + int(used_units)

    def test_the_funnel_totals_reconcile_to_the_lead_view(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        received, contacted, appointments, sold = _rows(
            reporter_cursor,
            "SELECT count(*) FILTER (WHERE NOT is_duplicate), "
            "count(*) FILTER (WHERE NOT is_duplicate AND is_contacted), "
            "count(*) FILTER (WHERE NOT is_duplicate AND is_appointment_set), "
            "count(*) FILTER (WHERE NOT is_duplicate AND sale_key IS NOT NULL) "
            "FROM reporting.vw_leads",
        )[0]
        totals = exported.manifest["reconciliation"]["totals"]
        assert int(totals["leads_received"]["total"]) == int(received)
        assert int(totals["contacted_leads"]["total"]) == int(contacted)
        assert int(totals["appointment_set_leads"]["total"]) == int(appointments)
        assert int(totals["sold_leads"]["total"]) == int(sold)
        # The rate components are the same numbers, which is what keeps the displayed rate
        # from drifting from the counts beside it.
        assert totals["contact_rate"]["numerator"] == totals["contacted_leads"]["total"]
        assert totals["contact_rate"]["denominator"] == totals["leads_received"]["total"]

    def test_the_appointment_totals_reconcile_to_the_appointment_view(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        shown, shown_and_sold = _rows(
            reporter_cursor,
            "SELECT count(*) FILTER (WHERE is_shown), "
            "count(*) FILTER (WHERE is_shown AND sale_key IS NOT NULL) "
            "FROM reporting.vw_appointments",
        )[0]
        totals = exported.manifest["reconciliation"]["totals"]
        assert int(totals["shown_appointments"]["total"]) == int(shown)
        assert int(totals["show_to_sale_conversion"]["numerator"]) == int(shown_and_sold)

    def test_the_marketing_totals_reconcile_to_the_spend_view(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        spend = _scalar(
            reporter_cursor,
            "SELECT coalesce(sum(spend_amount), 0) FROM reporting.vw_marketing_spend",
        )
        totals = exported.manifest["reconciliation"]["totals"]
        assert Decimal(str(totals["marketing_spend"]["total"])) == Decimal(str(spend))
        assert Decimal(str(totals["cost_per_lead"]["numerator"])) == Decimal(str(spend))
        assert Decimal(str(totals["cost_per_sale"]["numerator"])) == Decimal(str(spend))
        assert Decimal(str(totals["gross_return_on_ad_spend"]["denominator"])) == Decimal(
            str(spend)
        )

    def test_the_response_time_total_uses_summed_seconds_not_averaged_averages(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        """KPI-FUN-007's group figure is Σseconds / Σresponded, never a mean of store means."""
        seconds, responded = _rows(
            reporter_cursor,
            "SELECT coalesce(sum(response_seconds_total), 0), coalesce(sum(responded_leads), 0) "
            "FROM reporting.vw_lead_response",
        )[0]
        total = exported.manifest["reconciliation"]["totals"]["average_response_seconds"]
        assert Decimal(str(total["numerator"])) == Decimal(str(seconds))
        assert Decimal(str(total["denominator"])) == Decimal(str(responded))

    def test_no_group_total_exists_for_a_non_additive_figure(self, exported: Any) -> None:
        non_additive = {
            column["name"]
            for entry in exported.manifest["datasets"]
            for column in entry["columns"]
            if column["type"] == "double"
        }
        non_additive |= {"days_supply", "inventory_turn", "median_inventory_age"}
        for name, total in exported.manifest["reconciliation"]["totals"].items():
            for key in ("column", "numerator_column", "denominator_column"):
                if key in total:
                    assert total[key] not in non_additive, (
                        f"{name} sums {total[key]}, which is not additive: a group figure for it "
                        "is not the average of the store figures"
                    )


class TestEmptyDenominatorBehaviour:
    """A zero denominator yields NULL through the whole chain, never a zero."""

    def test_the_source_views_return_null_on_an_empty_denominator(
        self, reporter_cursor: Any
    ) -> None:
        """Proven directly, on a row the view itself produces."""
        nulls = _scalar(
            reporter_cursor,
            "SELECT count(*) FROM reporting.vw_gross_summary "
            "WHERE retail_units_sold = 0 AND front_gross_per_retail_unit IS NOT NULL",
        )
        assert int(nulls) == 0, (
            "a row with zero retail units carries a non-null per-unit gross, which would be a "
            "false statement: zero units means per-unit gross is undefined, not zero"
        )

    def test_a_null_ratio_reaches_the_export_as_null(
        self, reporter_cursor: Any, export_tree: Path, exported: Any
    ) -> None:
        """Wherever the view produced NULL, the export carries null -- never 0."""
        checked = 0
        for entry in spec.DATASETS:
            nullable = [column for column in entry.columns if column.nullable]
            if not nullable:
                continue
            reporter_cursor.execute(spec.dataset_sql(entry))
            source_rows = list(reporter_cursor.fetchall())
            exported_rows = json.loads((export_tree / entry.file_name).read_text(encoding="utf-8"))
            positions = {column.name: entry.column_names.index(column.name) for column in nullable}
            for source_row, exported_row in zip(source_rows, exported_rows, strict=True):
                for name, position in positions.items():
                    if source_row[position] is None:
                        assert exported_row[name] is None, f"{entry.name}.{name}"
                        checked += 1
        assert checked > 0, (
            "the loaded warehouse produced no null in any nullable column, so this assertion "
            "proved nothing. Widen the fixture window or the column set."
        )

    def test_a_zero_denominator_total_is_reported_as_zero_not_hidden(self, exported: Any) -> None:
        """A denominator sum of zero is published; the consumer decides it means "no data"."""
        for total in exported.manifest["reconciliation"]["totals"].values():
            if "denominator" in total:
                assert Decimal(str(total["denominator"])) >= 0


# =======================================================================================
# Generate and check, end to end
# =======================================================================================


class TestGenerateAndCheck:
    """The two modes agree, and a mutated export is caught."""

    def test_a_freshly_generated_export_passes_an_offline_check(
        self, exported: Any, export_tree: Path
    ) -> None:
        result = check_export(output_dir=export_tree)
        assert result.ok, result.problems

    def test_a_freshly_generated_export_passes_a_check_against_the_database(
        self, exported: Any, export_tree: Path, loaded_db: Any
    ) -> None:
        result = check_export(output_dir=export_tree, connection=loaded_db)
        assert result.ok, result.problems

    def test_two_generations_of_the_same_database_are_byte_identical(
        self, loaded_db: Any, tmp_path: Path
    ) -> None:
        first = tmp_path / "one"
        second = tmp_path / "two"
        for target in (first, second):
            result = generate_export(
                loaded_db,
                output_dir=target,
                repo_root=REPO_ROOT,
                generated_at=FIXED_GENERATED_AT,
            )
            assert result.ok, result.problems
        for entry in spec.DATASETS:
            assert (first / entry.file_name).read_bytes() == (
                second / entry.file_name
            ).read_bytes(), entry.name
        assert (first / spec.MANIFEST_FILE_NAME).read_bytes() == (
            second / spec.MANIFEST_FILE_NAME
        ).read_bytes()


class TestSeededDefect:
    """A guard that has never been seen to fail is not evidence."""

    @pytest.fixture()
    def mutated(self, loaded_db: Any, tmp_path: Path) -> Path:
        """A valid export with exactly one monetary value changed by a cent."""
        target = tmp_path / "mutated"
        result = generate_export(
            loaded_db,
            output_dir=target,
            repo_root=REPO_ROOT,
            generated_at=FIXED_GENERATED_AT,
        )
        assert result.ok, result.problems

        path = target / "gross-summary.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        assert records, "the loaded warehouse should produce gross rows"
        original = Decimal(records[0]["front_end_gross"])
        records[0]["front_end_gross"] = f"{original + Decimal('0.01'):.2f}"
        path.write_bytes(render_dataset_bytes(records))
        return target

    def test_a_one_cent_mutation_fails_the_hash_check(self, mutated: Path) -> None:
        result = check_export(output_dir=mutated)
        assert not result.ok
        assert any("hashes to" in problem for problem in result.problems)

    def test_a_one_cent_mutation_fails_reconciliation_even_when_the_hash_is_restamped(
        self, mutated: Path
    ) -> None:
        """Restamping the hash does not help: the totals no longer re-derive."""
        path = mutated / "gross-summary.json"
        payload = path.read_bytes()
        manifest_path = mutated / spec.MANIFEST_FILE_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in manifest["datasets"]:
            if entry["name"] == "gross-summary":
                entry["file_sha256"] = content_sha256(payload)
                entry["file_bytes"] = len(payload)
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n"
        )

        result = check_export(output_dir=mutated)
        assert not result.ok
        assert any("recomputes its" in problem for problem in result.problems), result.problems

    def test_a_one_cent_mutation_fails_a_check_against_the_database(
        self, mutated: Path, loaded_db: Any
    ) -> None:
        result = check_export(output_dir=mutated, connection=loaded_db)
        assert not result.ok


class TestNoSecretsReachTheExport:
    """Nothing produced from a real connection names the machine it came from."""

    def test_the_export_carries_no_connection_detail(
        self, exported: Any, export_tree: Path
    ) -> None:
        forbidden = (
            "password",
            "sslmode",
            "postgresql://",
            "postgres://",
            "PGPASSWORD",
            "ARPI_DATABASE__",
            "localhost",
            "127.0.0.1",
            "5432",
            "raw.",
            "staging.",
            "warehouse.",
            "audit.",
            str(export_tree),
        )
        for path in sorted(export_tree.glob("*.json")):
            text = path.read_text(encoding="utf-8")
            for needle in forbidden:
                assert needle not in text, f"{path.name} carries {needle!r}"

    def test_the_export_names_the_loaded_database_nowhere(
        self, exported: Any, export_tree: Path, loaded_database: str
    ) -> None:
        for path in sorted(export_tree.glob("*.json")):
            assert loaded_database not in path.read_text(encoding="utf-8"), path.name


class TestManifestAgainstTheRealRun:
    """The manifest describes the run it was actually taken from."""

    def test_the_manifest_records_the_databases_latest_run(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        run_uuid, profile, seed, status = _rows(
            reporter_cursor,
            "SELECT run_uuid, profile_name, random_seed, run_status "
            "FROM reporting.vw_pipeline_run_summary ORDER BY pipeline_run_id DESC LIMIT 1",
        )[0]
        assert exported.manifest["pipeline_run"]["run_uuid"] == str(run_uuid)
        assert exported.manifest["pipeline_run"]["status"] == status
        assert exported.manifest["profile"] == profile
        assert exported.manifest["random_seed"] == int(seed)

    def test_the_as_of_date_is_the_latest_dated_fact(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        latest = _scalar(
            reporter_cursor,
            "SELECT max(c.calendar_date) FROM reporting.vw_calendar AS c WHERE c.date_key IN ("
            "  SELECT sale_date_key FROM reporting.vw_sales_summary"
            "  UNION ALL SELECT snapshot_date_key FROM reporting.vw_inventory_health"
            "  UNION ALL SELECT lead_created_date_key FROM reporting.vw_lead_funnel)",
        )
        assert exported.manifest["as_of_date"] == str(latest)

    def test_the_manifest_reconciliation_count_matches_the_warehouse(
        self, reporter_cursor: Any, exported: Any
    ) -> None:
        evaluated, failed = _rows(
            reporter_cursor,
            "SELECT count(*), count(*) FILTER (WHERE NOT is_passing) "
            "FROM reporting.vw_reconciliation_status",
        )[0]
        assert exported.manifest["validation"]["reconciliations_failed"] == 0
        assert int(failed) == 0
        assert exported.manifest["validation"]["reconciliations_evaluated"] > 0
        assert int(evaluated) >= exported.manifest["validation"]["reconciliations_evaluated"]

    def test_the_reconciliation_dataset_covers_the_export_s_own_run(
        self, reporter_cursor: Any, export_tree: Path, exported: Any
    ) -> None:
        rows = json.loads((export_tree / "reconciliation-status.json").read_text(encoding="utf-8"))
        assert rows, "the export should carry reconciliation evidence"
        assert all(row["status"] == "passed" for row in rows)
        latest_run_rows = int(
            _scalar(
                reporter_cursor,
                "SELECT count(*) FROM reporting.vw_reconciliation_status WHERE pipeline_run_id = "
                "(SELECT max(pipeline_run_id) FROM reporting.vw_reconciliation_status)",
            )
        )
        assert len(rows) == latest_run_rows

    def test_the_pipeline_run_dataset_holds_exactly_one_row(self, export_tree: Path) -> None:
        rows = json.loads((export_tree / "pipeline-run.json").read_text(encoding="utf-8"))
        assert len(rows) == 1
        assert rows[0]["run_status"] == "succeeded"
        assert "notes" not in rows[0], "a free-text column must never reach a public artifact"
        for excluded in ("started_at", "completed_at", "duration_seconds"):
            assert excluded not in rows[0], f"{excluded} is wall-clock and must not be exported"


class TestCommittedExportMatchesTheContract:
    """The committed development export is structurally current.

    The committed artifacts were taken from a `development`-profile warehouse, while this
    suite's fixture is the `test` profile. Byte-comparing them would be comparing two
    different datasets, so what is asserted here is what is meaningful across profiles: the
    committed tree passes an offline check against the current contract.
    """

    def test_the_committed_export_passes_an_offline_check(self) -> None:
        committed = REPO_ROOT / "data" / "dashboard"
        if not (committed / spec.MANIFEST_FILE_NAME).is_file():
            pytest.skip("no committed dashboard export in this working tree")
        result = check_export(output_dir=committed)
        assert result.ok, result.problems

    def test_the_committed_export_is_the_development_profile(self) -> None:
        committed = REPO_ROOT / "data" / "dashboard" / spec.MANIFEST_FILE_NAME
        if not committed.is_file():
            pytest.skip("no committed dashboard export in this working tree")
        manifest = json.loads(committed.read_text(encoding="utf-8"))
        assert manifest["profile"] == "development", (
            "the committed export must be the development profile; mixing tiers in one commit "
            "is a check failure (DATA_CONTRACT.md section 2)"
        )
