"""Unit tests for the governed dashboard exporter (``DASH.1``).

These run without PostgreSQL. The database is replaced by a double that answers exactly
the statements the exporter issues, which is what lets the contract, the serialisation,
the manifest, the privacy tripwire and the generate/check split all be exercised in the
fast suite. The half that genuinely needs a warehouse -- row counts, reconciliation
against the views, and the ``arpi_reporter`` privilege boundary -- lives in
``tests/integration/test_dashboard_export.py``.

Every guard here has a test that proves it can fail. A check that has never been seen to
fail is not evidence (``docs/dashboard/TEST_STRATEGY.md``).
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, ClassVar

import pytest

from arpi.dashboard import contract as spec
from arpi.dashboard.export import (
    SIZE_LIMITS,
    ExportError,
    assert_headers_are_privacy_safe,
    assert_query_is_allowlisted,
    check_export,
    generate_export,
    known_limitations,
)
from arpi.dashboard.serialization import (
    ContractViolationError,
    canonical_json_bytes,
    content_sha256,
    normalise_query,
    query_sha256,
    render_dataset_bytes,
    render_value,
    serialise_row,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_CONTRACT = REPO_ROOT / "docs" / "dashboard" / "DATA_CONTRACT.md"

FIXED_GENERATED_AT = "2026-08-07T00:00:00+00:00"


# =======================================================================================
# The database double
# =======================================================================================


def _view_of(collapsed: str, *, alias: bool = False) -> str:
    """Extract the reporting view a statement reads from.

    Args:
        collapsed: The whitespace-collapsed statement.
        alias: Whether to require the ``AS base`` alias, which distinguishes a dataset query
            from a bare count.

    Returns:
        The view name, or the empty string when the statement names none.
    """
    pattern = r"FROM reporting\.(\w+) AS base" if alias else r"FROM reporting\.(\w+)"
    match = re.search(pattern, collapsed)
    return match.group(1) if match else ""


class FakeCursor:
    """A cursor that answers the exporter's statements from a fixture.

    Deliberately literal: it matches on the distinctive fragment of each statement the
    exporter issues rather than parsing SQL. If the exporter starts issuing a statement
    this does not recognise, the test fails loudly instead of silently returning nothing.
    """

    def __init__(self, world: FakeWorld) -> None:
        """Initialise the cursor.

        Args:
            world: The fixture the cursor answers from.
        """
        self._world = world
        self._result: list[tuple[Any, ...]] = []

    def __enter__(self) -> FakeCursor:
        """Enter the cursor context."""
        return self

    def __exit__(self, *_: object) -> None:
        """Leave the cursor context."""

    def execute(self, statement: str, params: Any = None) -> None:
        """Record the statement and prepare its result.

        Args:
            statement: The SQL.
            params: Bound parameters, where the exporter uses them.

        Raises:
            AssertionError: If the statement is one this double does not model. Failing loudly
                is the point: a new query the exporter starts issuing must not be silently
                unexercised.
            RuntimeError: When the fixture is configured to deny ``SET ROLE``.
        """
        self._world.statements.append(statement)
        collapsed = " ".join(statement.split())
        self._result = self._answer(collapsed, params)

    def _answer(self, collapsed: str, params: Any) -> list[tuple[Any, ...]]:
        """Return the rows this double serves for one collapsed statement.

        Args:
            collapsed: The statement with runs of whitespace collapsed.
            params: Bound parameters.

        Returns:
            The prepared result set.

        Raises:
            AssertionError: If the statement is not modelled.
            RuntimeError: When the fixture is configured to deny ``SET ROLE``.
        """
        world = self._world
        handlers: tuple[tuple[bool, Any], ...] = (
            (collapsed.startswith("SET ROLE"), self._set_role),
            (collapsed == "SELECT current_role", lambda: [(world.effective_role,)]),
            (
                "FROM reporting.vw_pipeline_run_summary ORDER BY pipeline_run_id DESC" in collapsed,
                # An empty run context models an empty warehouse: no row, not a blank one.
                lambda: [world.run_context] if world.run_context else [],
            ),
            (
                "FROM information_schema.columns" in collapsed,
                lambda: [
                    (name,) for name in world.view_columns.get(str(params[1] if params else ""), ())
                ],
            ),
            (
                collapsed.startswith("SELECT count(*) FROM reporting."),
                lambda: [(world.source_counts[_view_of(collapsed)],)],
            ),
            (collapsed.startswith("SELECT max(c.calendar_date)"), lambda: [(world.as_of_date,)]),
            (
                collapsed.startswith("SELECT"),
                lambda: list(world.rows_by_view.get(_view_of(collapsed, alias=True), ())),
            ),
        )
        for matches, handler in handlers:
            if matches:
                result: list[tuple[Any, ...]] = handler()
                return result
        raise AssertionError(f"the database double does not model this statement: {collapsed}")

    def _set_role(self) -> list[tuple[Any, ...]]:
        """Model ``SET ROLE``, refusing when the fixture is configured to deny it.

        Returns:
            An empty result set.

        Raises:
            RuntimeError: When the fixture denies the role change.
        """
        if self._world.deny_set_role:
            raise RuntimeError("permission denied to set role")
        return []

    def fetchone(self) -> tuple[Any, ...] | None:
        """Return the first row of the prepared result, or ``None``."""
        return self._result[0] if self._result else None

    def fetchall(self) -> list[tuple[Any, ...]]:
        """Return the whole prepared result."""
        return self._result


class FakeConnection:
    """A connection that hands out :class:`FakeCursor` instances."""

    def __init__(self, world: FakeWorld) -> None:
        """Initialise the connection.

        Args:
            world: The fixture the cursors answer from.
        """
        self.world = world

    def cursor(self) -> FakeCursor:
        """Open a cursor."""
        return FakeCursor(self.world)


class FakeWorld:
    """The fixture a :class:`FakeConnection` serves.

    One tiny store, one sale date, one snapshot date and one lead, sized so a whole export
    fits in a test and every column is exercised at least once.
    """

    def __init__(self) -> None:
        """Build the default, fully valid world."""
        self.statements: list[str] = []
        self.effective_role = spec.REPORTER_ROLE
        self.deny_set_role = False
        self.as_of_date = date(2025, 7, 2)
        self.run_context: tuple[Any, ...] = (
            "11111111-2222-3333-4444-555555555555",
            "development",
            20250701,
            "succeeded",
            "passed",
            58,
            0,
            114,
            0,
            0,
        )
        self.view_columns = {
            entry.source_view: tuple(
                column.source_column.split(".", 1)[1] for column in entry.columns
            )
            for entry in spec.DATASETS
        }
        self.rows_by_view = {entry.source_view: _fixture_rows(entry) for entry in spec.DATASETS}
        self.source_counts = {
            entry.source_view: len(self.rows_by_view[entry.source_view]) for entry in spec.DATASETS
        }


#: One contract-valid value per column type, for the fixture world.
#:
#: Enumerated columns take their first permitted value instead, so no fixture accidentally
#: exercises the enumeration guard and makes an unrelated test fail for the wrong reason.
_FIXTURE_BY_TYPE: dict[str, Any] = {
    "currency": Decimal("1234.56"),
    "exact": Decimal("12.500000"),
    "double": 41.0,
    "integer": 2,
    "date": date(2025, 7, 1),
    "boolean": True,
}

#: Business codes the fixture uses, so referential assertions have something to resolve.
_FIXTURE_CODES: dict[str, str] = {
    "dealership_id": "GSA-001",
    "lead_source_code": "SRC-001",
    "campaign_code": "CMP-001",
}


def _fixture_value(column: spec.ColumnContract) -> Any:
    """Return a plausible, contract-valid value for one column.

    Args:
        column: The column contract.

    Returns:
        A value of the declared kind.
    """
    if column.enumeration is not None:
        return column.enumeration[0]
    if column.type in _FIXTURE_BY_TYPE:
        return _FIXTURE_BY_TYPE[column.type]
    return _FIXTURE_CODES.get(column.name, f"{column.name}-value")


def _fixture_rows(entry: spec.DatasetContract) -> list[tuple[Any, ...]]:
    """Return one contract-valid row for a dataset, with the identities satisfied.

    Args:
        entry: The dataset contract.

    Returns:
        A single-row result set.
    """
    values = [_fixture_value(column) for column in entry.columns]
    index = {column.name: position for position, column in enumerate(entry.columns)}

    if entry.name == "sales-summary":
        values[index["retail_units_sold"]] = 5
        values[index["new_units_sold"]] = 2
        values[index["used_units_sold"]] = 3
    if entry.name == "gross-summary":
        values[index["front_end_gross"]] = Decimal("-1452.97")
        values[index["back_end_gross"]] = Decimal("2007.75")
        values[index["total_gross"]] = Decimal("554.78")
    return [tuple(values)]


@pytest.fixture()
def world() -> FakeWorld:
    """A fully valid fixture world."""
    return FakeWorld()


@pytest.fixture()
def connection(world: FakeWorld) -> FakeConnection:
    """A connection over the valid fixture world."""
    return FakeConnection(world)


def _export(connection: FakeConnection, target: Path) -> Any:
    """Generate an export into ``target`` with a fixed timestamp.

    Args:
        connection: The database double.
        target: Output directory.

    Returns:
        The export result.
    """
    return generate_export(
        connection,
        output_dir=target,
        repo_root=REPO_ROOT,
        generated_at=FIXED_GENERATED_AT,
    )


# =======================================================================================
# The contract itself
# =======================================================================================


class TestContractShape:
    """The declared contract is internally consistent."""

    def test_every_dataset_name_is_unique_and_slug_shaped(self) -> None:
        assert len(set(spec.DATASET_NAMES)) == len(spec.DATASET_NAMES)
        for name in spec.DATASET_NAMES:
            assert re.fullmatch(r"[a-z][a-z0-9-]*", name), name

    def test_every_business_key_and_sort_key_is_a_declared_column(self) -> None:
        for entry in spec.DATASETS:
            declared = set(entry.column_names)
            assert set(entry.business_key) <= declared, entry.name
            assert set(entry.sort_keys) <= declared, entry.name

    def test_no_dataset_exports_a_surrogate_key(self) -> None:
        """Surrogates stop at the export boundary (DATA_CONTRACT.md section 4)."""
        for entry in spec.DATASETS:
            offending = [
                name
                for name in entry.column_names
                if name.endswith("_key") and name != "age_bucket_sort_order"
            ]
            assert offending == [], f"{entry.name} exports surrogate key(s) {offending}"

    def test_every_column_is_publicly_classified(self) -> None:
        for entry in spec.DATASETS:
            for column in entry.columns:
                assert column.classification == spec.PUBLIC_CLASSIFICATION

    def test_every_source_and_join_view_is_allowlisted(self) -> None:
        for entry in spec.DATASETS:
            assert entry.source_view in spec.SOURCE_VIEW_ALLOWLIST
            for view in entry.join_views:
                assert view in spec.SOURCE_VIEW_ALLOWLIST

    def test_every_reconciliation_total_names_real_columns(self) -> None:
        for total in spec.RECONCILIATION_TOTALS:
            entry = spec.dataset(total.dataset)
            assert total.numerator in entry.column_names, total.name
            if total.denominator is not None:
                assert total.denominator in entry.column_names, total.name

    def test_reconciliation_totals_only_sum_additive_columns(self) -> None:
        """A median or a percentile may never appear in a group total.

        A group median is not the average of store medians, and the only safe way to keep
        that mistake out is to make the wrong number impossible to build from this block.
        """
        for total in spec.RECONCILIATION_TOTALS:
            entry = spec.dataset(total.dataset)
            for name in (total.numerator, total.denominator):
                if name is None:
                    continue
                column = entry.column(name)
                assert column.type != "double", (
                    f"{total.name} sums {name}, which is a double-precision order statistic "
                    "and not additive"
                )

    def test_every_implemented_kpi_family_has_an_owning_dataset(self) -> None:
        """All 29 governed KPIs resolve to a dataset built on their owning view."""
        from arpi.constants import KPI_IDS, KPI_VIEW_OWNERSHIP

        exported_views = {entry.source_view for entry in spec.DATASETS}
        for kpi_id in KPI_IDS:
            owner = KPI_VIEW_OWNERSHIP[kpi_id][0]
            assert owner in exported_views, f"{kpi_id} owner {owner} is not exported"

    def test_dataset_named_for_an_unknown_name_raises(self) -> None:
        with pytest.raises(KeyError, match="unknown dashboard dataset"):
            spec.dataset("no-such-dataset")


class TestGeneratedQueries:
    """The generated SQL is allowlisted, comment-free and deterministic."""

    def test_every_generated_query_reads_only_allowlisted_reporting_views(self) -> None:
        for entry in spec.DATASETS:
            sql = spec.dataset_sql(entry)
            assert_query_is_allowlisted(entry, sql)
            for reference in spec.referenced_views(sql):
                schema, _, obj = reference.partition(".")
                assert schema == spec.ALLOWED_SOURCE_SCHEMA
                assert obj in spec.SOURCE_VIEW_ALLOWLIST

    def test_a_query_over_a_warehouse_table_is_refused(self) -> None:
        entry = spec.dataset("gross-summary")
        with pytest.raises(ExportError, match="ADR-0013 condition 8"):
            assert_query_is_allowlisted(
                entry, "SELECT total FROM warehouse.fact_vehicle_sale AS base"
            )

    @pytest.mark.parametrize("schema", ["raw", "staging", "warehouse", "audit"])
    def test_every_prohibited_schema_is_refused(self, schema: str) -> None:
        entry = spec.dataset("stores")
        with pytest.raises(ExportError, match="and nothing else"):
            assert_query_is_allowlisted(entry, f"SELECT x FROM {schema}.some_table AS base")

    def test_an_unlisted_reporting_view_is_refused(self) -> None:
        """Allowlist, not discovery: a real view the contract does not name is unreadable."""
        entry = spec.dataset("stores")
        with pytest.raises(ExportError, match="does not allowlist"):
            assert_query_is_allowlisted(entry, "SELECT x FROM reporting.vw_customer AS base")

    def test_no_generated_query_contains_a_comment_marker(self) -> None:
        """Hashing collapses whitespace, which would swallow a trailing comment."""
        for entry in spec.DATASETS:
            sql = spec.dataset_sql(entry)
            assert "--" not in sql
            assert "/*" not in sql

    def test_query_generation_is_deterministic(self) -> None:
        for entry in spec.DATASETS:
            assert spec.dataset_sql(entry) == spec.dataset_sql(entry)


class TestQueryHashing:
    """Query hashes detect meaning, not formatting."""

    def test_the_same_normalised_query_gives_the_same_hash(self) -> None:
        one = "SELECT a,\n       b\nFROM reporting.vw_dealership"
        two = "SELECT a,     b     FROM reporting.vw_dealership"
        assert normalise_query(one) == normalise_query(two)
        assert query_sha256(one) == query_sha256(two)

    def test_reindentation_does_not_change_the_hash(self) -> None:
        flat = spec.dataset_sql(spec.dataset("gross-summary"))
        indented = "\n".join(f"        {line}" for line in flat.split("\n"))
        assert query_sha256(flat) == query_sha256(indented)

    @pytest.mark.parametrize("ending", ["\r\n", "\r"])
    def test_platform_line_endings_do_not_cause_drift(self, ending: str) -> None:
        flat = spec.dataset_sql(spec.dataset("sales-summary"))
        assert query_sha256(flat) == query_sha256(flat.replace("\n", ending))

    def test_a_meaningful_change_changes_the_hash(self) -> None:
        entry = spec.dataset("gross-summary")
        base = spec.dataset_sql(entry)
        without_a_column = spec.dataset_sql(replace(entry, columns=entry.columns[:-1]))
        different_sort = spec.dataset_sql(replace(entry, sort_keys=("sale_date", "dealership_id")))
        assert query_sha256(base) != query_sha256(without_a_column)
        assert query_sha256(base) != query_sha256(different_sort)

    def test_a_query_carrying_a_comment_is_refused(self) -> None:
        with pytest.raises(ContractViolationError, match="comment marker"):
            normalise_query("SELECT a -- the interesting one\nFROM reporting.vw_dealership")

    def test_every_dataset_has_a_distinct_query_hash(self) -> None:
        hashes = {entry.name: query_sha256(spec.dataset_sql(entry)) for entry in spec.DATASETS}
        assert len(set(hashes.values())) == len(hashes)


# =======================================================================================
# Exact monetary handling
# =======================================================================================


class TestMonetaryPrecision:
    """Money is exact from PostgreSQL to JSON, and a float cannot get in."""

    def _money(self) -> spec.ColumnContract:
        return spec.dataset("gross-summary").column("front_end_gross")

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (Decimal("1234.56"), "1234.56"),
            (Decimal("0.00"), "0.00"),
            (Decimal("0"), "0.00"),
            (Decimal("-2529.18"), "-2529.18"),
            (Decimal("-0.01"), "-0.01"),
            (Decimal("0.01"), "0.01"),
            (Decimal("99999999.99"), "99999999.99"),
            (Decimal("1936571.59"), "1936571.59"),
            (Decimal("1234.5"), "1234.50"),
            (Decimal("1234"), "1234.00"),
        ],
    )
    def test_exact_two_place_rendering(self, value: Decimal, expected: str) -> None:
        assert render_value("gross-summary", self._money(), value) == expected

    def test_a_float_is_refused_outright(self) -> None:
        """Accepting a float would make the no-float promise unverifiable."""
        with pytest.raises(ContractViolationError, match="arrived as a Python float"):
            render_value("gross-summary", self._money(), 1234.56)

    def test_more_than_two_places_is_schema_drift_not_a_rounding_opportunity(self) -> None:
        with pytest.raises(ContractViolationError, match="will not round a gross figure"):
            render_value("gross-summary", self._money(), Decimal("1234.567"))

    def test_a_ratio_keeps_every_digit_the_view_produced(self) -> None:
        column = spec.dataset("gross-summary").column("front_gross_per_retail_unit")
        value = Decimal("2276.878602150537634408602150537634")
        assert render_value("gross-summary", column, value) == str(value)

    def test_a_ratio_never_arrives_as_a_float(self) -> None:
        column = spec.dataset("lead-funnel").column("contact_rate")
        with pytest.raises(ContractViolationError, match=r"must stay"):
            render_value("lead-funnel", column, 0.719)

    def test_an_order_statistic_round_trips_exactly_as_a_double(self) -> None:
        column = spec.dataset("inventory-health").column("median_inventory_age")
        for value in (40.0, 41.5, 0.1, 1e-7, 123456.789):
            rendered = render_value("inventory-health", column, value)
            assert json.loads(json.dumps(rendered)) == value

    def test_exponent_notation_never_reaches_the_output(self) -> None:
        column = spec.dataset("lead-funnel").column("contact_rate")
        assert render_value("lead-funnel", column, Decimal("1E+2")) == "100"

    def test_currency_totals_sum_exactly_including_a_negative(self) -> None:
        column = spec.dataset("gross-summary").column("front_end_gross")
        amounts = [Decimal("-2529.18"), Decimal("0.01"), Decimal("1936571.59")]
        rendered = [render_value("gross-summary", column, amount) for amount in amounts]
        assert sum(Decimal(value) for value in rendered) == Decimal("1934042.42")


class TestNullSemantics:
    """Null means "not applicable or not observed" and is never a zero."""

    def test_a_required_column_refuses_a_null(self) -> None:
        column = spec.dataset("gross-summary").column("front_end_gross")
        with pytest.raises(ContractViolationError, match="contract declares it required"):
            render_value("gross-summary", column, None)

    def test_a_nullable_column_keeps_its_null(self) -> None:
        column = spec.dataset("days-supply").column("days_supply")
        assert render_value("days-supply", column, None) is None

    def test_every_ratio_over_a_possibly_empty_denominator_is_nullable(self) -> None:
        """Zero denominator returns NULL in SQL; the contract must agree."""
        expected_nullable = {
            ("gross-summary", "front_gross_per_retail_unit"),
            ("gross-summary", "back_gross_per_retail_unit"),
            ("gross-summary", "total_gross_per_retail_unit"),
            ("sales-summary", "average_days_to_sale"),
            ("days-supply", "days_supply"),
            ("inventory-turn", "inventory_turn"),
            ("lead-funnel", "contact_rate"),
            ("lead-funnel", "appointment_set_rate"),
            ("lead-funnel", "lead_to_sale_conversion"),
            ("appointment-funnel", "show_rate"),
            ("appointment-funnel", "show_to_sale_conversion"),
            ("marketing-performance", "cost_per_lead"),
            ("marketing-performance", "cost_per_sale"),
            ("marketing-performance", "gross_return_on_ad_spend"),
        }
        for dataset_name, column_name in expected_nullable:
            assert spec.dataset(dataset_name).column(column_name).nullable, (
                f"{dataset_name}.{column_name} must be nullable: a zero denominator yields "
                "NULL, never zero"
            )


class TestEnumerations:
    """A closed set fails the export rather than reaching the console unlabelled."""

    def test_an_out_of_set_value_is_refused(self) -> None:
        column = spec.dataset("inventory-health").column("condition_group")
        with pytest.raises(ContractViolationError, match="closed enumeration"):
            render_value("inventory-health", column, "Certified")

    def test_the_governed_age_buckets_are_the_declared_set(self) -> None:
        column = spec.dataset("inventory-aging").column("age_bucket")
        assert column.enumeration == ("0-30", "31-60", "61-90", "91-120", "Over 120")


# =======================================================================================
# Serialisation and determinism
# =======================================================================================


class TestSerialisation:
    """Bytes are canonical, ordered and LF-terminated."""

    def test_a_row_is_serialised_in_contract_column_order(self) -> None:
        entry = spec.dataset("stores")
        row = _fixture_rows(entry)[0]
        record = serialise_row(entry, row)
        assert list(record) == list(entry.column_names)

    def test_a_row_of_the_wrong_width_is_schema_drift(self) -> None:
        entry = spec.dataset("stores")
        with pytest.raises(ContractViolationError, match="schema drift"):
            serialise_row(entry, ("GSA-001",))

    def test_dataset_bytes_are_one_record_per_line_and_lf_terminated(self) -> None:
        payload = render_dataset_bytes([{"a": 1}, {"a": 2}])
        assert payload == b'[\n  {"a":1},\n  {"a":2}\n]\n'
        assert b"\r" not in payload

    def test_an_empty_dataset_serialises_to_a_stable_empty_array(self) -> None:
        assert render_dataset_bytes([]) == b"[]\n"

    def test_canonical_json_is_indented_and_newline_terminated(self) -> None:
        payload = canonical_json_bytes({"b": 1, "a": 2})
        assert payload.endswith(b"\n")
        assert b"\r" not in payload
        # Key order is the mapping's own, so a manifest reads in documented order.
        assert payload.index(b'"b"') < payload.index(b'"a"')

    def test_hashing_is_stable_and_sensitive(self) -> None:
        assert content_sha256(b"abc") == content_sha256(b"abc")
        assert content_sha256(b"abc") != content_sha256(b"abd")
        assert len(content_sha256(b"abc")) == 64


class TestDeterminism:
    """Two exports of the same source data are byte-identical."""

    def test_two_generations_produce_identical_bytes(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        first = tmp_path / "one"
        second = tmp_path / "two"
        assert _export(connection, first).ok
        assert _export(connection, second).ok

        for entry in spec.DATASETS:
            assert (first / entry.file_name).read_bytes() == (second / entry.file_name).read_bytes()
        assert (first / spec.MANIFEST_FILE_NAME).read_bytes() == (
            second / spec.MANIFEST_FILE_NAME
        ).read_bytes()

    def test_regenerating_over_an_existing_export_holds_the_dataset_version(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        """A regeneration that changes nothing must not manufacture a new version."""
        first = _export(connection, tmp_path)
        second = _export(connection, tmp_path)
        assert first.manifest["dataset_version"] == second.manifest["dataset_version"] == 1

    def test_changed_source_data_bumps_the_dataset_version(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        _export(connection, tmp_path)
        rows = connection.world.rows_by_view["vw_dealership"]
        entry = spec.dataset("stores")
        index = entry.column_names.index("city")
        changed = list(rows[0])
        changed[index] = "Concord"
        connection.world.rows_by_view["vw_dealership"] = [tuple(changed)]

        assert _export(connection, tmp_path).manifest["dataset_version"] == 2

    #: Where a dataset sorts by an ORDERING PROXY rather than by the business-key column
    #: itself: ``dataset -> {sort column: the key column it orders}``.
    #:
    #: Both entries exist because the business-key column is a label whose alphabetical
    #: order is not its meaningful order. ``age_bucket`` would sort "0-30", "31-60",
    #: "61-90", "91-120", "Over 120" as text; ``component_code`` would sort the bridge
    #: "back_pvr", "front_pvr", "volume", which reverses a decomposition whose reading
    #: order -- volume first, priced at the baseline rate, then the rate effects -- is
    #: part of what it means.
    #:
    #: A proxy is only acceptable when it is one-to-one with the column it stands for,
    #: which the test below asserts rather than assumes.
    ORDERING_PROXIES: ClassVar[dict[str, dict[str, str]]] = {
        "inventory-aging": {"age_bucket_sort_order": "age_bucket"},
        "gross-change-bridge": {"component_ordinal": "component_code"},
    }

    def test_every_dataset_declares_a_sort_that_matches_its_business_key(self) -> None:
        """Deterministic ordering must uniquely order the rows, not merely group them."""
        for entry in spec.DATASETS:
            keys = set(entry.business_key)
            sort = set(entry.sort_keys)
            for proxy, stands_for in self.ORDERING_PROXIES.get(entry.name, {}).items():
                assert proxy in sort, f"{entry.name} does not sort by its proxy {proxy}"
                sort.add(stands_for)
            assert keys <= sort, f"{entry.name} sorts by {sort}, which does not fix {keys}"

    def test_every_ordering_proxy_is_declared_by_the_dataset_it_names(self) -> None:
        """A proxy that is not a column of its own dataset would silently do nothing."""
        for name, proxies in self.ORDERING_PROXIES.items():
            columns = set(spec.dataset(name).column_names)
            for proxy, stands_for in proxies.items():
                assert proxy in columns, f"{name} declares no column {proxy}"
                assert stands_for in columns, f"{name} declares no column {stands_for}"


# =======================================================================================
# The manifest
# =======================================================================================


class TestManifest:
    """The manifest carries everything a consumer and a reviewer need, and nothing else."""

    @pytest.fixture()
    def manifest(self, connection: FakeConnection, tmp_path: Path) -> dict[str, Any]:
        result = _export(connection, tmp_path)
        assert result.ok, result.problems
        manifest: dict[str, Any] = result.manifest
        return manifest

    def test_identity_and_provenance_fields_are_present(self, manifest: dict[str, Any]) -> None:
        assert manifest["schema"] == spec.SCHEMA_ID
        assert manifest["contract_version"] == spec.CONTRACT_VERSION
        assert len(manifest["contract_sha256"]) == 64
        assert manifest["dataset_version"] == 1
        assert manifest["generated_at"] == FIXED_GENERATED_AT
        assert manifest["as_of_date"] == "2025-07-02"
        assert manifest["profile"] == "development"
        assert manifest["random_seed"] == 20250701
        assert manifest["exporter_version"] == spec.EXPORTER_VERSION
        assert manifest["query_normalisation"] == spec.QUERY_NORMALISATION
        assert manifest["reporter_role"] == spec.REPORTER_ROLE
        assert manifest["synthetic_data"] is True
        assert manifest["fictional_dealer_group"] is True
        assert manifest["stale"] is False

    def test_the_pipeline_run_identity_travels_with_the_export(
        self, manifest: dict[str, Any]
    ) -> None:
        run = manifest["pipeline_run"]
        assert run["run_uuid"] == "11111111-2222-3333-4444-555555555555"
        assert run["status"] == "succeeded"
        # ADR-0010's logical run key is not published by the reporting layer, so it is null
        # rather than guessed, and a limitation says so.
        assert run["logical_run_key"] is None
        assert any("logical_run_key" in line for line in manifest["limitations"])

    def test_every_dataset_entry_carries_its_full_declaration(
        self, manifest: dict[str, Any]
    ) -> None:
        entries = {entry["name"]: entry for entry in manifest["datasets"]}
        assert list(entries) == list(spec.DATASET_NAMES)
        for name, entry in entries.items():
            declared = spec.dataset(name)
            assert entry["source_view"] == f"reporting.{declared.source_view}"
            assert entry["grain"] == declared.grain
            assert entry["business_key"] == list(declared.business_key)
            assert entry["date_basis"] == declared.date_basis
            assert entry["sort_keys"] == list(declared.sort_keys)
            assert entry["file"] == declared.file_name
            assert len(entry["query_sha256"]) == 64
            assert len(entry["file_sha256"]) == 64
            assert entry["row_count"] == 1
            assert entry["file_bytes"] > 0
            assert [column["name"] for column in entry["columns"]] == list(declared.column_names)
            for column in entry["columns"]:
                assert column["class"] == spec.PUBLIC_CLASSIFICATION
                assert column["source_column"].startswith("reporting.")

    def test_the_reconciliation_block_publishes_components_and_no_quotient(
        self, manifest: dict[str, Any]
    ) -> None:
        totals = manifest["reconciliation"]["totals"]
        assert manifest["reconciliation"]["status"] == "passed"
        assert set(totals) == {total.name for total in spec.RECONCILIATION_TOTALS}
        for name, entry in totals.items():
            assert "value" not in entry, f"{name} publishes a quotient; only components may appear"
            if "total" in entry:
                assert "numerator" not in entry
            else:
                assert {"numerator", "denominator"} <= set(entry)

    def test_the_status_blocks_report_the_run_the_export_came_from(
        self, manifest: dict[str, Any]
    ) -> None:
        assert manifest["privacy_scan"] == {
            "status": "passed",
            "prohibited_hits": 0,
            "columns_scanned": sum(len(entry.columns) for entry in spec.DATASETS),
            "primary_control": "contract allowlist",
            "secondary_control": "arpi.validation.privacy prohibited-name tripwire",
        }
        assert manifest["validation"]["critical_failures"] == 0
        assert manifest["validation"]["reconciliations_evaluated"] == 58
        assert manifest["validation"]["reconciliations_failed"] == 0

    def test_sizes_are_measured_and_the_limits_are_recorded(self, manifest: dict[str, Any]) -> None:
        sizes = manifest["sizes"]
        assert sizes["dataset_bytes_total"] > 0
        assert sizes["largest_dataset"]["name"] in spec.DATASET_NAMES
        assert sizes["limits"] == dict(SIZE_LIMITS)

    def test_the_export_states_its_own_limitations(self, manifest: dict[str, Any]) -> None:
        limitations = manifest["limitations"]
        assert limitations == list(known_limitations())
        joined = " ".join(limitations)
        assert "29 governed KPIs" in joined
        assert "Power BI real-engine validation remains pending" in joined
        assert "project defaults" in joined

    def test_the_source_view_allowlist_travels_with_the_export(
        self, manifest: dict[str, Any]
    ) -> None:
        assert manifest["source_views"] == [
            f"reporting.{view}" for view in spec.SOURCE_VIEW_ALLOWLIST
        ]
        assert all(view.startswith("reporting.") for view in manifest["source_views"])


class TestReconciliationTotals:
    """Totals are exact sums, ratios are component pairs, and nulls are absent not zero."""

    def _outputs(self, connection: FakeConnection, tmp_path: Path) -> dict[str, Any]:
        result = _export(connection, tmp_path)
        assert result.ok, result.problems
        totals: dict[str, Any] = result.manifest["reconciliation"]["totals"]
        return totals

    def test_a_plain_total_is_the_exact_sum(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        totals = self._outputs(connection, tmp_path)
        assert totals["front_end_gross"]["total"] == "-1452.97"
        assert totals["total_gross"]["total"] == "554.78"
        assert totals["retail_units"]["total"] == "5"

    def test_a_ratio_publishes_its_two_sums(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        totals = self._outputs(connection, tmp_path)
        entry = totals["front_gross_per_retail_unit"]
        assert entry["numerator"] == "-1452.97"
        # The gross-summary fixture carries retail_units_sold = 2.
        assert entry["denominator"] == "2"
        assert entry["kpi_id"] == "KPI-GRS-004"
        assert entry["display_precision"] == 2

    def test_a_null_is_absent_from_a_sum_rather_than_counted_as_zero(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        """An organic source has no spend. Null must not be summed as a zero-dollar spend.

        The distinction matters: a null spend and a zero spend are different business facts,
        and only one of them belongs in a cost-per-lead denominator's numerator.
        """
        entry = spec.dataset("marketing-performance")
        index = {name: position for position, name in enumerate(entry.column_names)}
        paid = list(connection.world.rows_by_view["vw_marketing_performance"][0])
        paid[index["spend_amount"]] = Decimal("100.00")
        paid[index["attributed_leads"]] = 4

        organic = list(paid)
        organic[index["spend_amount"]] = None
        organic[index["campaign_code"]] = None
        organic[index["attributed_leads"]] = 6

        connection.world.rows_by_view["vw_marketing_performance"] = [
            tuple(organic),
            tuple(paid),
        ]
        connection.world.source_counts["vw_marketing_performance"] = 2

        totals = self._outputs(connection, tmp_path)
        # The null row contributes nothing to the spend, but its leads still count.
        assert totals["cost_per_lead"]["numerator"] == "100.00"
        assert totals["cost_per_lead"]["denominator"] == "10"
        assert totals["marketing_spend"]["total"] == "100.00"


class TestFiContract:
    """The four F&I datasets DASH.7 promoted, checked as declarations rather than as data.

    These assertions are about the CONTRACT, not about the warehouse: they hold with the
    fake world in place and would hold against an empty database. What they guard is the
    set of decisions that could be quietly reversed by a future contract edit -- a rate
    column added, a penetration quotient exported, a leaderboard sort introduced, the
    three date bases collapsed into one.
    """

    FI_DATASETS = (
        "fi-summary",
        "fi-product-penetration",
        "fi-adjustment-summary",
        "deal-product-detail",
    )

    def test_all_four_are_declared_and_read_only_the_reporting_layer(self) -> None:
        for name in self.FI_DATASETS:
            entry = spec.dataset(name)
            assert entry.source_view in spec.SOURCE_VIEW_ALLOWLIST, entry.name
            for view in entry.join_views:
                assert view in spec.SOURCE_VIEW_ALLOWLIST, f"{entry.name} joins {view}"

    def test_no_consumer_credit_column_is_declared_anywhere(self) -> None:
        """Not merely absent from the F&I datasets: absent from the whole contract.

        The warehouse models none of these, so the export cannot publish one. This states
        the rule at the boundary anyway, because the boundary is where a future increment
        would be tempted to add one and where a reviewer will look for the prohibition.
        """
        prohibited = (
            "apr",
            "buy_rate",
            "sell_rate",
            "rate_spread",
            "money_factor",
            "monthly_payment",
            "payment_amount",
            "credit_score",
            "fico",
            "customer_income",
            "stipulation",
            "adverse_action",
            "ssn",
            "social_security",
            "date_of_birth",
        )
        for entry in spec.DATASETS:
            for column in entry.column_names:
                for token in prohibited:
                    assert token not in column, f"{entry.name}.{column} contains {token!r}"

    def test_penetration_publishes_two_additive_columns_and_no_quotient(self) -> None:
        entry = spec.dataset("fi-product-penetration")
        names = set(entry.column_names)
        assert "penetration_numerator" in names
        assert "penetration_denominator" in names
        offending = [
            name
            for name in names
            if re.fullmatch(r"penetration_(rate|ratio|pct|percent|percentage)", name)
        ]
        assert offending == [], (
            f"fi-product-penetration exports {offending}. A consumer that can read a "
            "penetration ratio can average it across stores, and the average of store "
            "penetrations is a different and wrong number."
        )

    def test_the_penetration_denominator_is_declared_per_category(self) -> None:
        """The category and its governed rule are both in the business key.

        A denominator that were not keyed by category could only be one population for
        every product, which is the contracts-over-all-retail-deals mistake in another
        shape.
        """
        entry = spec.dataset("fi-product-penetration")
        assert "product_category" in entry.business_key
        assert "eligibility_rule_id" in entry.column_names

    def test_the_adjustment_dataset_is_on_its_own_date_basis(self) -> None:
        entry = spec.dataset("fi-adjustment-summary")
        # A null basis is legitimate for a dimension and is a defect here: a dated F&I
        # dataset that declared none would be one a consumer had to guess the basis of.
        assert entry.date_basis is not None, "fi-adjustment-summary declares no date basis"
        assert "adjustment date" in entry.date_basis.lower(), entry.date_basis
        assert "adjustment_date" in entry.business_key
        # And it does not carry the parent sale's date, so nothing can restate it.
        assert "sale_date" not in entry.column_names

    def test_the_production_datasets_are_not_on_the_adjustment_basis(self) -> None:
        for name in ("fi-summary", "fi-product-penetration", "deal-product-detail"):
            entry = spec.dataset(name)
            assert entry.date_basis is not None, f"{name} declares no date basis"
            assert "adjustment date" not in entry.date_basis.lower(), entry.name

    def test_no_fi_dataset_sorts_by_a_performance_measure(self) -> None:
        """A default sort by a metric IS a leaderboard, whatever the column header says."""
        measureish = re.compile(
            r"gross|pvr|penetration|rate|ratio|amount|count|units|per_", re.IGNORECASE
        )
        for name in self.FI_DATASETS:
            entry = spec.dataset(name)
            assert entry.sort_keys, f"{entry.name} declares no sort"
            for key in entry.sort_keys:
                assert not measureish.search(key), f"{entry.name} sorts by {key}"

    def test_no_fi_dataset_declares_a_rank_or_a_judgement_column(self) -> None:
        forbidden = (
            "rank",
            "percentile_of_peers",
            "is_top",
            "is_bottom",
            "best_",
            "worst_",
            "performance_grade",
            "benchmark",
            "target_penetration",
        )
        for name in self.FI_DATASETS:
            entry = spec.dataset(name)
            for column in entry.column_names:
                for token in forbidden:
                    assert token not in column, f"{entry.name}.{column} contains {token!r}"

    def test_the_minimum_sample_floor_travels_with_the_data(self) -> None:
        """Governed centrally, exported as a column, never restated as a page constant."""
        entry = spec.dataset("fi-summary")
        assert "minimum_sample_floor" in entry.column_names

    def test_the_manager_identifier_is_a_synthetic_code_and_nullable(self) -> None:
        """``null`` means NOBODY WAS ON THE DESK, which is a real population."""
        for name in ("fi-summary", "fi-product-penetration", "fi-adjustment-summary"):
            entry = spec.dataset(name)
            column = entry.column("finance_manager_code")
            assert column.nullable, f"{entry.name} cannot represent an unstaffed delivery"
            assert not column.name.endswith("_key")

    def test_the_back_gross_identity_is_reconcilable_across_two_datasets(self) -> None:
        """Reserve and product gross come from ``fi-summary``; back-end gross does not.

        The identity is only evidence because the two sides are published by different
        views over different facts. If a future edit moved ``back_end_gross`` onto
        ``fi-summary`` and reconciled it against itself, this assertion is what notices.
        """
        by_name = {total.name: total for total in spec.RECONCILIATION_TOTALS}
        assert by_name["finance_reserve_gross"].dataset == "fi-summary"
        assert by_name["original_product_gross"].dataset == "fi-summary"
        assert by_name["back_end_gross"].dataset == "gross-summary"

    def test_the_itemisation_is_reconcilable_against_the_rollup(self) -> None:
        """``deal-product-detail`` carries its own totals, at a different grain.

        Added by DASH.7's seeded-defect suite, which found that a one-cent mutation of
        ``original_product_gross`` on this dataset passed the offline check: it was the
        only one of the four F&I datasets with no total re-derived from its committed
        bytes, so the largest deal-grain F&I export could be corrupted invisibly without a
        database.

        The pair is chosen so the check is evidence rather than a tautology. ``fi-summary``
        publishes the pre-aggregated figure and ``deal-product-detail`` publishes the
        lines; neither is derived from the other, so their agreeing is the export-boundary
        form of the reconciliation the Deal Jacket performs per deal.
        """
        by_name = {total.name: total for total in spec.RECONCILIATION_TOTALS}
        for name, column in (
            ("product_contract_original_gross", "original_product_gross"),
            ("product_contract_net_gross_as_of", "net_product_gross_as_of"),
        ):
            total = by_name[name]
            assert total.dataset == "deal-product-detail"
            assert total.numerator == column
            assert total.denominator is None, f"{name} is a sum, not a ratio"
            # The rollup side, published from a different dataset over a different view.
            rollup = by_name[column]
            assert rollup.dataset == "fi-summary"

    def test_every_fi_dataset_carries_at_least_one_total(self) -> None:
        """The rule the missing one broke, stated so it cannot be broken again.

        A dataset with no reconciliation total is a dataset whose bytes nothing re-derives
        offline. For the F&I family that is not acceptable: three of the four had one and
        the fourth did not, and nothing said the fourth was allowed to be different.
        """
        covered = {total.dataset for total in spec.RECONCILIATION_TOTALS}
        for name in self.FI_DATASETS:
            assert name in covered, (
                f"{name} publishes no reconciliation total, so a corruption of its bytes "
                "would pass `--check` without a database"
            )

    def test_the_penetration_totals_each_name_the_rows_they_cover(self) -> None:
        """Two categories, two different denominators, both declared as subsets.

        A total over the whole penetration dataset would add VSC's 558 eligible deals to
        GAP's 388 and publish a group penetration that means nothing.
        """
        by_name = {total.name: total for total in spec.RECONCILIATION_TOTALS}
        for name, rule in (("vsc_penetration", "ELIG-VSC"), ("gap_penetration", "ELIG-GAP")):
            total = by_name[name]
            assert total.dataset == "fi-product-penetration"
            assert dict(total.subset or ()) == {"eligibility_rule_id": rule}, total.subset
            assert total.denominator == "penetration_denominator"

    def test_the_adjustment_totals_are_subset_by_event_type(self) -> None:
        by_name = {total.name: total for total in spec.RECONCILIATION_TOTALS}
        for name, adjustment_type in (
            ("chargeback_amount", "Chargeback"),
            ("cancellation_amount", "Cancellation"),
        ):
            total = by_name[name]
            assert total.dataset == "fi-adjustment-summary"
            assert dict(total.subset or ()) == {"adjustment_type": adjustment_type}, total.subset

    def test_the_deal_jacket_publishes_the_components_rather_than_a_verified_flag(
        self,
    ) -> None:
        """DASH.7-02 needs the parts, not a boolean somebody else computed.

        A jacket that read a stored ``back_gross_verified`` would verify nothing. The
        console recomputes the identity from these columns, so they have to be here and
        the flag has to not be.
        """
        entry = spec.dataset("deal-jacket")
        names = set(entry.column_names)
        assert {"finance_reserve_gross", "original_product_gross", "back_end_gross"} <= names
        offending = sorted(name for name in names if "verified" in name or "reconcil" in name)
        assert offending == [], f"deal-jacket publishes {offending}"

    def test_the_deal_jacket_derives_its_structure_from_the_governed_function(self) -> None:
        """The DASH.7 defect, stated at the contract boundary.

        The view's inline CASE labelled every wholesale and dealer-trade disposal
        ``Cash`` -- 92 rows -- because neither finances anything. The view now calls the
        governed derivation and publishes the branch it took, plus a boolean so a
        consumer never re-enumerates the set. All three columns are required together:
        a structure with no basis is a claim a reader cannot check.
        """
        names = set(spec.dataset("deal-jacket").column_names)
        assert {"finance_structure", "finance_structure_basis", "is_retail_structure"} <= names

    def test_the_lender_is_published_without_any_decision_record(self) -> None:
        """A lender assignment is not a credit decision, and the contract keeps them apart."""
        entry = spec.dataset("deal-jacket")
        names = set(entry.column_names)
        assert "lender_name" in names
        assert "lender_code" in names
        for forbidden in ("decision", "approval", "declin", "tier_assigned", "application"):
            offending = sorted(name for name in names if forbidden in name)
            assert offending == [], f"deal-jacket publishes {offending}"
        # `lender_program_tier` classifies the LENDER'S PROGRAM. It is permitted, and it
        # is named here so that the sweep above cannot be read as forbidding it by
        # accident.
        assert "lender_program_tier" in names

    def test_every_lender_and_product_column_is_nullable_where_absence_is_real(self) -> None:
        """A cash deal has no lender. A wholesale disposal has no consumer at all."""
        entry = spec.dataset("deal-jacket")
        for name in ("lender_code", "lender_name", "lender_category", "lender_program_tier"):
            assert entry.column(name).nullable, f"deal-jacket.{name} cannot be absent"


# =======================================================================================
# The controls: each one proven able to fail
# =======================================================================================


class TestReporterRoleBoundary:
    """The export runs inside the console's own privilege, or not at all."""

    def test_the_exporter_enters_the_reporter_role_before_reading(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        _export(connection, tmp_path)
        statements = connection.world.statements
        assert statements[0] == f"SET ROLE {spec.REPORTER_ROLE}"
        assert statements[1] == "SELECT current_role"

    def test_a_failed_set_role_aborts_the_export(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        connection.world.deny_set_role = True
        with pytest.raises(ExportError, match="could not SET ROLE"):
            _export(connection, tmp_path)

    def test_a_role_that_did_not_take_effect_aborts_the_export(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        connection.world.effective_role = "postgres"
        with pytest.raises(ExportError, match="effective role"):
            _export(connection, tmp_path)


class TestRefusalOnAFailingWarehouse:
    """A failing warehouse cannot produce a passing export."""

    def test_a_failed_pipeline_run_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        run = list(connection.world.run_context)
        run[3] = "failed"
        connection.world.run_context = tuple(run)
        with pytest.raises(ExportError, match="not 'succeeded'"):
            _export(connection, tmp_path)

    def test_failing_reconciliations_are_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        run = list(connection.world.run_context)
        run[4] = "failed"
        run[6] = 3
        connection.world.run_context = tuple(run)
        with pytest.raises(ExportError, match="reconciliations failed"):
            _export(connection, tmp_path)

    def test_critical_data_quality_failures_are_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        run = list(connection.world.run_context)
        run[8] = 1
        connection.world.run_context = tuple(run)
        with pytest.raises(ExportError, match="critical data-quality failure"):
            _export(connection, tmp_path)

    def test_an_empty_warehouse_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        connection.world.run_context = ()
        with pytest.raises(ExportError, match="no pipeline run has loaded"):
            _export(connection, tmp_path)


class TestSchemaDrift:
    """A view that changed shape fails the export rather than exporting a guess."""

    def test_a_missing_source_column_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        columns = list(connection.world.view_columns["vw_gross_summary"])
        columns.remove("front_end_gross")
        connection.world.view_columns["vw_gross_summary"] = tuple(columns)
        with pytest.raises(ExportError, match="no longer declares them"):
            _export(connection, tmp_path)

    def test_a_missing_source_view_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        connection.world.view_columns["vw_days_supply"] = ()
        with pytest.raises(ExportError, match="does not exist or is not"):
            _export(connection, tmp_path)

    def test_a_row_carrying_an_unexpected_extra_column_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        rows = connection.world.rows_by_view["vw_dealership"]
        connection.world.rows_by_view["vw_dealership"] = [(*rows[0], "surprise")]
        with pytest.raises(ContractViolationError, match="schema drift"):
            _export(connection, tmp_path)

    def test_a_widened_grain_is_refused(self, connection: FakeConnection, tmp_path: Path) -> None:
        """A key-resolution join that fanned out would double every total downstream."""
        connection.world.source_counts["vw_gross_summary"] = 2
        with pytest.raises(ExportError, match="must not change the grain"):
            _export(connection, tmp_path)

    def test_a_repeated_business_key_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        rows = connection.world.rows_by_view["vw_dealership"]
        connection.world.rows_by_view["vw_dealership"] = [rows[0], rows[0]]
        connection.world.source_counts["vw_dealership"] = 2
        with pytest.raises(ExportError, match="repeats its business key"):
            _export(connection, tmp_path)


class TestRowIdentities:
    """The identities the reporting layer guarantees are asserted on the exported values."""

    def test_a_broken_unit_identity_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        entry = spec.dataset("sales-summary")
        row = list(connection.world.rows_by_view["vw_sales_summary"][0])
        row[entry.column_names.index("new_units_sold")] = 99
        connection.world.rows_by_view["vw_sales_summary"] = [tuple(row)]
        with pytest.raises(ExportError, match="RECON-UNITS-001"):
            _export(connection, tmp_path)

    def test_a_broken_gross_identity_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        entry = spec.dataset("gross-summary")
        row = list(connection.world.rows_by_view["vw_gross_summary"][0])
        row[entry.column_names.index("total_gross")] = Decimal("0.01")
        connection.world.rows_by_view["vw_gross_summary"] = [tuple(row)]
        with pytest.raises(ExportError, match="RECON-GROSS-001"):
            _export(connection, tmp_path)


class TestPrivacyControls:
    """The allowlist is the primary control; the tripwire is the second one."""

    def test_the_declared_contract_passes_the_tripwire(self) -> None:
        for entry in spec.DATASETS:
            assert_headers_are_privacy_safe(entry)

    @pytest.mark.parametrize(
        "prohibited",
        [
            "customer_name",
            "customer_first_name",
            "street_address",
            "email",
            "customer_email",
            "phone",
            "home_phone_number",
            "date_of_birth",
            "birth_date",
            "customer_age",
            "ssn",
            "social_security_number",
            "drivers_license_number",
            "bank_account_number",
            "credit_card_number",
            "payment_card_number",
            "credit_score",
            "customer_notes",
            "call_recording_url",
            "message_body",
        ],
    )
    def test_a_prohibited_field_is_refused(self, prohibited: str) -> None:
        """Every prohibited category the privacy contract names is refused by name."""
        entry = spec.dataset("stores")
        poisoned = replace(
            entry,
            columns=(
                *entry.columns,
                spec.ColumnContract(
                    name=prohibited,
                    type="string",
                    nullable=True,
                    expression=f"base.{prohibited}",
                    source_column=f"vw_dealership.{prohibited}",
                ),
            ),
        )
        with pytest.raises(ExportError, match="prohibited personal-data column"):
            assert_headers_are_privacy_safe(poisoned)

    def test_a_misclassified_column_is_refused(self) -> None:
        entry = spec.dataset("stores")
        poisoned = replace(
            entry,
            columns=(
                replace(entry.columns[0], classification="internal"),
                *entry.columns[1:],
            ),
        )
        with pytest.raises(ExportError, match="publicly eligible classification"):
            assert_headers_are_privacy_safe(poisoned)

    def test_no_customer_grain_dataset_exists(self) -> None:
        """Customers appear only as pre-aggregated counts. No dataset is at their grain."""
        for entry in spec.DATASETS:
            assert entry.source_view != "vw_customer"
            assert "vw_customer" not in entry.join_views
            assert not any("customer" in name for name in entry.column_names)

    def test_no_employee_or_vehicle_identity_is_exported(self) -> None:
        """DASH.1 has no dataset that needs one, so none is exported."""
        for entry in spec.DATASETS:
            assert entry.source_view not in {"vw_employee", "vw_vehicle", "vw_vehicle_model"}
            assert not any(
                view in {"vw_employee", "vw_vehicle", "vw_vehicle_model"}
                for view in entry.join_views
            )

    def test_no_vehicle_identifier_column_is_declared(self) -> None:
        """The allowlist is the control here, because the tripwire deliberately is not.

        ARPI's VIN columns are synthetic by policy (ADR-0005) and legitimate on the public
        listing lane, so ``arpi.validation.privacy`` does not treat "vin" as a prohibited
        name -- and it is right not to. That makes the dashboard lane's protection
        structural instead: no dataset here declares a vehicle identifier of any spelling,
        so there is no field for one to arrive in, and the portfolio generator additionally
        scans its output bytes for a VIN-shaped token.

        THIS LIST CHANGED WITH ``DASH.3``, AND THAT IS THE MECHANISM WORKING. At ``DASH.1``
        it also prohibited ``sale_id``, because no deal-grain dataset existed and the
        cheapest protection was to leave no field for one to arrive in. ``DASH.3`` ships
        that dataset, and ``sale_id`` is its business key, its route parameter and the only
        identity it publishes (``DEAL_JACKET_SPEC.md`` section 1).

        So the rule is narrowed rather than dropped, and the narrowing is asserted below:
        ``sale_id`` is permitted ONLY on a deal-grain dataset and ONLY as its business key.
        Every stock-number spelling and every surrogate key stays prohibited everywhere,
        ``sale_key`` included -- a URL carrying a surrogate would leak warehouse load order
        and break when the fact is rebuilt.

        ``DASH.4`` NARROWED IT ONCE MORE, FOR ``synthetic_vin``, AND ONLY ON THE JACKET.
        ``DEAL_JACKET_SPEC.md`` section 4 requires the Deal Jacket to display the unit's
        synthetic identifier with its ADR-0005 policy note, and ADR-0005 is what makes that
        safe: the value is ``ARPI`` plus thirteen characters, and the prefix contains an
        ``I``, which the real-VIN alphabet excludes. The value is therefore structurally
        incapable of being a real VIN -- which is also why the portfolio generator's
        VIN-shaped-token byte scan does not fire on it, and correctly so. The bare spelling
        ``vin`` stays prohibited everywhere: a column called ``vin`` reads as a real vehicle
        identifier no matter what it holds.

        ``test_the_synthetic_vin_shape_is_what_keeps_the_byte_scan_honest`` below asserts
        the property this permission rests on, rather than leaving it to the prose.
        """
        prohibited = {
            "vin",
            "vehicle_identification_number",
            "vehicle_id",
            "vehicle_key",
            "stock_number",
            "stock_reference",
            "sale_key",
        }
        for entry in spec.DATASETS:
            offending = sorted(prohibited & set(entry.column_names))
            assert offending == [], f"{entry.name} declares {offending}"

        #: The only dataset that may publish the synthetic vehicle identifier.
        for entry in spec.DATASETS:
            if "synthetic_vin" not in entry.column_names:
                continue
            assert entry.name == "deal-jacket", (
                f"{entry.name} declares synthetic_vin; only the Deal Jacket's dataset may, "
                "because it is the only surface that renders one unit in detail with the "
                "ADR-0005 policy note beside it"
            )

        #: The deal-grain datasets, which are the only ones that may publish ``sale_id``.
        #:
        #: ``deal-product-detail`` (DASH.7) is one grain BELOW a deal -- one row per
        #: product contract -- and carries ``sale_id`` as the foreign key that lets the
        #: Deal Jacket resolve its own contracts. It is therefore on this list and is
        #: deliberately the one member whose business key is not ``sale_id`` alone: its
        #: key is the contract, and asserting otherwise would require it to publish one
        #: row per deal, which is the aggregation the itemisation exists to avoid.
        deal_grain = {"deal-explorer", "deal-jacket", "deal-product-detail"}
        for entry in spec.DATASETS:
            if "sale_id" not in entry.column_names:
                continue
            assert entry.name in deal_grain, (
                f"{entry.name} declares sale_id but is not a deal-grain dataset"
            )
            expected_key = (
                ("product_sale_id",) if entry.name == "deal-product-detail" else ("sale_id",)
            )
            assert entry.business_key == expected_key, (
                f"{entry.name} declares sale_id as something other than its business key"
            )
        # `campaigns.target_vehicle_category` names a campaign's audience (New / Used /
        # Both), not a vehicle. Kept as a reminder that this test is about identifiers,
        # not about the word.
        assert "target_vehicle_category" in spec.dataset("campaigns").column_names

    def test_the_synthetic_vin_shape_is_what_keeps_the_byte_scan_honest(self) -> None:
        """ADR-0005's ``ARPI`` prefix is a privacy control, not a branding choice.

        The portfolio generator scans its own output bytes for a VIN-shaped token: 17
        characters from the real VIN alphabet, which excludes ``I``, ``O`` and ``Q``, with
        at least one digit. That scan is the reason a vehicle identifier cannot reach the
        console unnoticed -- and the Deal Jacket publishes ``synthetic_vin`` right past it.

        That is correct, and this test is why. ``ARPI`` contains an ``I``, so a value in the
        policy's shape is structurally incapable of matching the pattern: it is not a real
        VIN, the scanner agrees it is not, and nothing has been suppressed to make that
        true. The day somebody changes the prefix to four characters from the VIN alphabet,
        the synthetic identifier becomes indistinguishable from a real one to every tool
        that looks for one -- and this test fails first.
        """
        vin_shaped = re.compile(r"\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b")

        # The pattern works: a genuinely VIN-shaped token matches.
        assert vin_shaped.search("1HGCM82633A004352") is not None

        # And an ARPI synthetic identifier does not, because of the prefix.
        for synthetic in ("ARPIJ5Y7KSD2532DA", "ARPI4K9VY0KDWVR23", "ARPIB87282JN280J6"):
            assert vin_shaped.search(synthetic) is None, (
                f"{synthetic} is VIN-shaped; ADR-0005's prefix is supposed to make that "
                "impossible, and the Deal Jacket publishes this column"
            )

        # The prefix is the mechanism, stated as an assertion rather than as a comment:
        # the VIN alphabet excludes `I`, and ADR-0005's prefix contains one.
        vin_alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
        arpi_prefix = "ARPI"
        assert "I" not in vin_alphabet
        assert "I" in arpi_prefix


class TestNoSecretsInOutput:
    """Nothing the exporter writes names a machine, a credential, or a hidden schema."""

    def test_no_produced_byte_carries_connection_detail(
        self, connection: FakeConnection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PGPASSWORD", "hunter2")
        monkeypatch.setenv("ARPI_DATABASE__HOST", "db.internal.example")
        result = _export(connection, tmp_path)
        assert result.ok, result.problems

        forbidden = (
            "hunter2",
            "db.internal.example",
            "PGPASSWORD",
            "ARPI_DATABASE__",
            "password",
            "sslmode",
            "postgresql://",
            "raw.",
            "staging.",
            "warehouse.",
            "audit.",
            str(tmp_path),
        )
        for path in sorted(tmp_path.glob("*.json")):
            text = path.read_text(encoding="utf-8")
            for needle in forbidden:
                assert needle not in text, f"{path.name} carries {needle!r}"

    def test_an_internal_object_path_in_a_value_is_refused(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        """The guard is over produced bytes, so a value nobody thought to check is caught."""
        entry = spec.dataset("reconciliation-status")
        row = list(connection.world.rows_by_view["vw_reconciliation_status"][0])
        row[entry.column_names.index("reconciliation_id")] = "warehouse.fact_vehicle_sale"
        connection.world.rows_by_view["vw_reconciliation_status"] = [tuple(row)]

        result = _export(connection, tmp_path)
        assert not result.ok
        assert any("warehouse." in problem for problem in result.problems)
        assert not (tmp_path / entry.file_name).exists(), "nothing may be written on a hit"


class TestSizeCeilings:
    """A breach reports the measured number, and the ceilings are the contract's."""

    def test_a_measured_breach_names_the_number(
        self, connection: FakeConnection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(SIZE_LIMITS, "single_export_file", 10)
        result = _export(connection, tmp_path)
        assert not result.ok
        assert any("exceeds the 10-byte ceiling" in problem for problem in result.problems)

    def test_a_directory_total_breach_is_reported(
        self, connection: FakeConnection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(SIZE_LIMITS, "total_export_directory", 10)
        result = _export(connection, tmp_path)
        assert not result.ok
        assert any("exceeds the 10-byte ceiling for" in problem for problem in result.problems)


# =======================================================================================
# Generate versus check
# =======================================================================================


class TestCheckMode:
    """Check works offline and fails on anything that is not current."""

    @pytest.fixture()
    def exported(self, connection: FakeConnection, tmp_path: Path) -> Path:
        result = _export(connection, tmp_path)
        assert result.ok, result.problems
        return tmp_path

    def test_a_current_export_passes_without_a_database(self, exported: Path) -> None:
        result = check_export(output_dir=exported)
        assert result.ok, result.problems
        assert result.files[spec.MANIFEST_FILE_NAME] > 0
        assert len(result.files) == len(spec.DATASETS) + 1

    def test_a_missing_manifest_fails(self, tmp_path: Path) -> None:
        result = check_export(output_dir=tmp_path)
        assert not result.ok
        assert any("is missing" in problem for problem in result.problems)

    def test_an_unparseable_manifest_fails(self, exported: Path) -> None:
        (exported / spec.MANIFEST_FILE_NAME).write_text("{not json", encoding="utf-8")
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("not valid JSON" in problem for problem in result.problems)

    def test_a_missing_dataset_file_fails(self, exported: Path) -> None:
        (exported / "gross-summary.json").unlink()
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("gross-summary.json is missing" in problem for problem in result.problems)

    def test_an_undeclared_file_fails(self, exported: Path) -> None:
        """The file set is closed: a stale artifact nothing validates is a trap."""
        (exported / "leftover.json").write_text("[]\n", encoding="utf-8")
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("the contract does not declare it" in problem for problem in result.problems)

    def test_a_hash_mismatch_fails(self, exported: Path) -> None:
        path = exported / "stores.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records[0]["city"] = "Somewhere Else"
        path.write_bytes(render_dataset_bytes(records))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("hashes to" in problem for problem in result.problems)

    def test_a_row_count_mismatch_fails(self, exported: Path) -> None:
        path = exported / "stores.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        payload = render_dataset_bytes([*records, records[0]])
        path.write_bytes(payload)

        manifest_path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in manifest["datasets"]:
            if entry["name"] == "stores":
                entry["file_sha256"] = content_sha256(payload)
                entry["file_bytes"] = len(payload)
        manifest_path.write_bytes(canonical_json_bytes(manifest))

        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("row(s) but the manifest records" in problem for problem in result.problems)

    def test_an_unknown_schema_version_fails(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["schema"] = "arpi.dashboard_export/99"
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("refuses an unknown major version" in problem for problem in result.problems)

    def test_an_unknown_contract_version_fails(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["contract_version"] = 99
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("contract_version" in problem for problem in result.problems)

    def test_a_changed_contract_fingerprint_is_the_staleness_signal(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["contract_sha256"] = "0" * 64
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("THIS IS THE STALENESS SIGNAL" in problem for problem in result.problems)

    def test_a_stale_flag_fails(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["stale"] = True
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("declares stale=true" in problem for problem in result.problems)

    def test_a_tampered_reconciliation_total_fails(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["reconciliation"]["totals"]["total_gross"]["total"] = "999999.99"
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("recomputes its total" in problem for problem in result.problems)

    def test_a_query_hash_mismatch_fails(self, exported: Path) -> None:
        path = exported / spec.MANIFEST_FILE_NAME
        manifest = json.loads(path.read_text(encoding="utf-8"))
        for entry in manifest["datasets"]:
            if entry["name"] == "gross-summary":
                entry["query_sha256"] = "1" * 64
        path.write_bytes(canonical_json_bytes(manifest))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("The source query" in problem for problem in result.problems)

    def test_a_null_in_a_required_column_fails(self, exported: Path) -> None:
        path = exported / "gross-summary.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records[0]["front_end_gross"] = None
        payload = render_dataset_bytes(records)
        path.write_bytes(payload)
        _restamp(exported, "gross-summary", payload)
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("declares required" in problem for problem in result.problems)

    def test_a_currency_value_that_lost_its_places_fails(self, exported: Path) -> None:
        path = exported / "gross-summary.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records[0]["front_end_gross"] = "-1452.9"
        payload = render_dataset_bytes(records)
        path.write_bytes(payload)
        _restamp(exported, "gross-summary", payload)
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("not a valid currency value" in problem for problem in result.problems)

    def test_a_currency_value_turned_into_a_number_fails(self, exported: Path) -> None:
        """A float in a monetary field is the failure the whole contract exists to prevent."""
        path = exported / "gross-summary.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records[0]["front_end_gross"] = -1452.97
        payload = render_dataset_bytes(records)
        path.write_bytes(payload)
        _restamp(exported, "gross-summary", payload)
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("not a valid currency value" in problem for problem in result.problems)

    def test_an_out_of_enumeration_value_fails(self, exported: Path) -> None:
        path = exported / "inventory-health.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records[0]["condition_group"] = "Certified"
        payload = render_dataset_bytes(records)
        path.write_bytes(payload)
        _restamp(exported, "inventory-health", payload)
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("closed enumeration" in problem for problem in result.problems)

    def test_a_hand_formatted_file_fails(self, exported: Path) -> None:
        path = exported / "stores.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        payload = (json.dumps(records, indent=4) + "\n").encode()
        path.write_bytes(payload)
        _restamp(exported, "stores", payload)
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("not in canonical serialisation" in problem for problem in result.problems)


class TestSeededFiExportDefects:
    """Four F&I datasets, each protected by a deliberate corruption that must be caught.

    WHY THIS CLASS EXISTS
    ---------------------
    ``DASH.1`` set the rule and this applies it to the datasets ``DASH.7`` promoted: a
    check that has never been observed failing is not evidence. Every assertion below
    corrupts a committed export and requires the PRODUCTION validation path --
    :func:`check_export`, the same function ``scripts/export_dashboard_dataset.py --check``
    calls and the same one CI runs -- to refuse it. No test-only validator is used
    anywhere in this class.

    WHAT PROTECTS WHAT, EXPLICITLY
    ------------------------------
    ``fi-summary``
        A one-cent mutation of ``finance_reserve_gross``, hash restamped. Caught by the
        ``finance_reserve_gross`` reconciliation total re-derived from the committed rows.
        A second case breaks the exact-decimal contract; a third repeats the business key.

    ``fi-product-penetration``
        A mutation of ``penetration_numerator`` and, separately, of
        ``penetration_denominator``, each hash restamped. Caught by the ``vsc_penetration``
        total, which publishes both sides. A fourth case moves BOTH sides together so the
        ratio still reads plausibly -- the shape of the real ``DASH.7`` cache-key defect --
        and requires that a plausible wrong answer is still refused.

    ``fi-adjustment-summary``
        A mutation of ``adjustment_amount``, hash restamped. Caught by the
        ``cancellation_amount`` subset total. A second case corrupts the adjustment DATE,
        which is this dataset's whole reason for existing separately.

    ``deal-product-detail``
        A one-cent mutation of ``original_product_gross`` that also breaks the identity
        against ``net_product_gross_as_of``; and a duplicated ``product_sale_id``, which is
        the relationship break that would let one contract be counted twice.

    THE HASH IS RESTAMPED ON PURPOSE
    --------------------------------
    Every mutation below rewrites the manifest's ``file_sha256`` and ``file_bytes`` through
    :func:`_restamp` before the check runs. Without that the hash guard fires first and the
    test would prove only that SHA-256 works. Restamping puts the deeper guard on the hook,
    which is the assertion actually worth making: an attacker or a careless script that
    updated the hash still cannot get a wrong figure past the boundary.

    NO COMMITTED PRODUCTION ARTIFACT IS MUTATED. Every case runs against a fresh export
    written into pytest's ``tmp_path`` from the fixture world.
    """

    @pytest.fixture()
    def exported(self, connection: FakeConnection, tmp_path: Path) -> Path:
        result = _export(connection, tmp_path)
        assert result.ok, result.problems
        # The control: the untouched export passes. Without this, a case that "fails" for
        # an unrelated reason would look like the seeded defect being caught.
        assert check_export(output_dir=tmp_path).ok
        return tmp_path

    @staticmethod
    def _mutate(exported: Path, dataset: str, mutate: Any) -> Any:
        """Rewrite one dataset's records, restamp its hash, and run the production check."""
        path = exported / f"{dataset}.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        mutate(records)
        payload = render_dataset_bytes(records)
        path.write_bytes(payload)
        _restamp(exported, dataset, payload)
        return check_export(output_dir=exported)

    # -- fi-summary ---------------------------------------------------------------

    def test_fi_summary_one_cent_of_finance_reserve_is_caught(self, exported: Path) -> None:
        """The smallest mutation that changes a governed figure at all."""

        def mutate(records: list[dict[str, Any]]) -> None:
            original = Decimal(records[0]["finance_reserve_gross"])
            records[0]["finance_reserve_gross"] = f"{original + Decimal('0.01'):.2f}"

        result = self._mutate(exported, "fi-summary", mutate)
        assert not result.ok
        assert any(
            "'finance_reserve_gross' recomputes its total" in problem for problem in result.problems
        ), result.problems

    def test_fi_summary_restamping_the_hash_does_not_bypass_the_total(self, exported: Path) -> None:
        """Stated as its own assertion because it is the property that matters.

        The hash guard is the cheap one. What makes the boundary trustworthy is that
        passing it changes nothing: the totals are re-derived from the bytes on disk.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["original_product_gross"] = "999999.99"

        result = self._mutate(exported, "fi-summary", mutate)
        assert not result.ok
        # The hash guard did NOT fire -- that is the point.
        assert not any("hashes to" in problem for problem in result.problems), result.problems
        assert any(
            "'original_product_gross' recomputes its total" in problem
            for problem in result.problems
        ), result.problems

    def test_fi_summary_an_exact_decimal_that_lost_a_place_is_caught(self, exported: Path) -> None:
        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["finance_reserve_gross"] = "1234.5"

        result = self._mutate(exported, "fi-summary", mutate)
        assert not result.ok
        assert any("not a valid currency value" in problem for problem in result.problems), (
            result.problems
        )

    def test_fi_summary_a_currency_value_turned_into_a_float_is_caught(
        self, exported: Path
    ) -> None:
        """A float in a monetary field is the failure the whole contract exists to prevent."""

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["finance_reserve_gross"] = 1234.56

        result = self._mutate(exported, "fi-summary", mutate)
        assert not result.ok
        assert any("not a valid currency value" in problem for problem in result.problems), (
            result.problems
        )

    def test_fi_summary_a_repeated_business_key_is_caught(self, exported: Path) -> None:
        """Store, sale date and manager identify a row exactly once, or the grain widened."""

        def mutate(records: list[dict[str, Any]]) -> None:
            records.append(dict(records[0]))

        result = self._mutate(exported, "fi-summary", mutate)
        assert not result.ok
        assert any("repeats the business key" in problem for problem in result.problems), (
            result.problems
        )

    # -- fi-product-penetration ---------------------------------------------------

    def test_penetration_a_mutated_numerator_is_caught(self, exported: Path) -> None:
        """Attached deals moved on their own. The published numerator no longer re-derives."""

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["penetration_numerator"] = int(records[0]["penetration_numerator"]) + 1

        result = self._mutate(exported, "fi-product-penetration", mutate)
        assert not result.ok
        assert any(
            "'vsc_penetration' recomputes its numerator" in problem for problem in result.problems
        ), result.problems

    def test_penetration_a_mutated_denominator_is_caught(self, exported: Path) -> None:
        """The eligible population moved on its own.

        This is the one that matters most on this dataset. A denominator nobody checks is
        how "penetration over all retail deals" gets published under a governed name.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["penetration_denominator"] = int(records[0]["penetration_denominator"]) + 7

        result = self._mutate(exported, "fi-product-penetration", mutate)
        assert not result.ok
        assert any(
            "'vsc_penetration' recomputes its denominator" in problem for problem in result.problems
        ), result.problems

    def test_penetration_a_plausible_wrong_ratio_is_still_refused(self, exported: Path) -> None:
        """BOTH sides inflated together, so the RATIO is unchanged and looks right.

        This is the shape of the real ``DASH.7`` defect: eighteen partitions decoded under
        one cache key returned the first partition eighteen times, inflating numerator and
        denominator by the same factor. VSC read 288/720 where the warehouse says 227/558,
        and 40.0% against a true 40.7% is a figure nobody would question on a screen.

        A validation that compared only the quotient would pass this. The manifest
        publishes both components separately for exactly this reason, and both are
        re-derived, so a wrong answer that happens to be plausible is refused on the
        components rather than accepted on the ratio.
        """
        path = exported / "fi-product-penetration.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        before = Decimal(records[0]["penetration_numerator"]) / Decimal(
            records[0]["penetration_denominator"]
        )

        def mutate(mutated: list[dict[str, Any]]) -> None:
            mutated[0]["penetration_numerator"] = int(mutated[0]["penetration_numerator"]) * 2
            mutated[0]["penetration_denominator"] = int(mutated[0]["penetration_denominator"]) * 2

        result = self._mutate(exported, "fi-product-penetration", mutate)

        after_records = json.loads(
            (exported / "fi-product-penetration.json").read_text(encoding="utf-8")
        )
        after = Decimal(after_records[0]["penetration_numerator"]) / Decimal(
            after_records[0]["penetration_denominator"]
        )
        assert before == after, "the corruption changed the ratio, so it is not the plausible case"

        assert not result.ok
        assert any("'vsc_penetration' recomputes its" in problem for problem in result.problems), (
            result.problems
        )

    def test_penetration_a_repeated_category_grain_is_caught(self, exported: Path) -> None:
        """Store, sale date, manager and CATEGORY, exactly once.

        A repeated category row would double one category's numerator and denominator
        together -- again leaving the ratio plausible and the counts wrong.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records.append(dict(records[0]))

        result = self._mutate(exported, "fi-product-penetration", mutate)
        assert not result.ok
        assert any("repeats the business key" in problem for problem in result.problems), (
            result.problems
        )

    # -- fi-adjustment-summary ----------------------------------------------------

    def test_adjustment_a_mutated_amount_is_caught(self, exported: Path) -> None:
        """The subset total covers Cancellation rows and re-derives from the bytes."""

        def mutate(records: list[dict[str, Any]]) -> None:
            original = Decimal(records[0]["adjustment_amount"])
            records[0]["adjustment_amount"] = f"{original + Decimal('0.01'):.2f}"

        result = self._mutate(exported, "fi-adjustment-summary", mutate)
        assert not result.ok
        assert any(
            "'cancellation_amount' recomputes its total" in problem for problem in result.problems
        ), result.problems

    def test_adjustment_a_corrupted_date_basis_column_is_caught(self, exported: Path) -> None:
        """The adjustment date is why this dataset exists separately from the summary.

        A row whose own business date is unreadable cannot be placed in a period at all,
        and a console that silently dropped it would under-report the period rather than
        fail.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["adjustment_date"] = "not-a-date"

        result = self._mutate(exported, "fi-adjustment-summary", mutate)
        assert not result.ok
        assert any("date" in problem.lower() for problem in result.problems), result.problems

    def test_adjustment_an_out_of_set_event_type_is_caught(self, exported: Path) -> None:
        """Four governed adjustment types. A fifth is a vocabulary nobody agreed to."""

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["adjustment_type"] = "Refund"

        result = self._mutate(exported, "fi-adjustment-summary", mutate)
        assert not result.ok
        assert any(
            "enumeration" in problem.lower() or "permitted" in problem.lower()
            for problem in result.problems
        ), result.problems

    # -- deal-product-detail ------------------------------------------------------

    def test_product_detail_a_one_cent_gross_mutation_is_caught(self, exported: Path) -> None:
        """One cent on one contract, hash restamped, and the export still refuses it."""

        def mutate(records: list[dict[str, Any]]) -> None:
            original = Decimal(records[0]["original_product_gross"])
            records[0]["original_product_gross"] = f"{original + Decimal('0.01'):.2f}"

        result = self._mutate(exported, "deal-product-detail", mutate)
        assert not result.ok
        assert result.problems

    def test_product_detail_a_duplicated_contract_is_caught(self, exported: Path) -> None:
        """The relationship break that would count one contract twice.

        ``product_sale_id`` is this dataset's whole business key precisely because a deal
        may carry several contracts: identity has to be the contract, not the sale. A
        duplicate is how a single contract's gross would be added to a category twice.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records.append(dict(records[0]))

        result = self._mutate(exported, "deal-product-detail", mutate)
        assert not result.ok
        assert any("repeats the business key" in problem for problem in result.problems), (
            result.problems
        )

    def test_product_detail_a_null_in_a_required_column_is_caught(self, exported: Path) -> None:
        """A required column may not be null.

        Null means "not applicable or not observed", never zero -- and never at all on a
        column the contract declares required.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["original_product_gross"] = None

        result = self._mutate(exported, "deal-product-detail", mutate)
        assert not result.ok
        assert any("declares required" in problem for problem in result.problems), result.problems

    def test_product_detail_an_undeclared_column_is_caught(self, exported: Path) -> None:
        """The column set is closed in both directions.

        A prohibited F&I field can only reach the export by being added to a row, and this
        is the guard that refuses one. ``TestFiContract`` refuses it at the contract, this
        refuses it in the bytes, and the exporter's own prohibited-name tripwire refuses it
        at generation -- three independent controls, none of which relies on the others.
        """

        def mutate(records: list[dict[str, Any]]) -> None:
            records[0]["credit_score"] = 720

        result = self._mutate(exported, "deal-product-detail", mutate)
        assert not result.ok
        assert result.problems

    # -- the whole family ---------------------------------------------------------

    @pytest.mark.parametrize(
        "dataset",
        [
            "fi-summary",
            "fi-product-penetration",
            "fi-adjustment-summary",
            "deal-product-detail",
        ],
    )
    def test_every_fi_dataset_is_hash_protected(self, exported: Path, dataset: str) -> None:
        """The cheap guard, asserted once per dataset so none is left out of it.

        Deliberately does NOT restamp: this is the one case where the hash guard is the
        guard under test.
        """
        path = exported / f"{dataset}.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        records.append(dict(records[0]))
        path.write_bytes(render_dataset_bytes(records))
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any("hashes to" in problem for problem in result.problems), result.problems

    @pytest.mark.parametrize(
        "dataset",
        [
            "fi-summary",
            "fi-product-penetration",
            "fi-adjustment-summary",
            "deal-product-detail",
        ],
    )
    def test_every_fi_dataset_is_required_to_be_present(self, exported: Path, dataset: str) -> None:
        """A missing F&I file is a failure, never an empty section on a page."""
        (exported / f"{dataset}.json").unlink()
        result = check_export(output_dir=exported)
        assert not result.ok
        assert any(f"{dataset}.json is missing" in problem for problem in result.problems), (
            result.problems
        )


def _restamp(output_dir: Path, dataset: str, payload: bytes) -> None:
    """Update a manifest entry's hash and size so a later guard is the one that fires.

    Args:
        output_dir: The export directory.
        dataset: The dataset whose file was rewritten.
        payload: The new bytes.
    """
    path = output_dir / spec.MANIFEST_FILE_NAME
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for entry in manifest["datasets"]:
        if entry["name"] == dataset:
            entry["file_sha256"] = content_sha256(payload)
            entry["file_bytes"] = len(payload)
            entry["row_count"] = len(json.loads(payload.decode("utf-8")))
    path.write_bytes(canonical_json_bytes(manifest))


class TestGenerateWritesAClosedSet:
    """Generation replaces the tree rather than layering onto it."""

    def test_a_file_the_contract_no_longer_declares_is_removed(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        tmp_path.mkdir(parents=True, exist_ok=True)
        (tmp_path / "retired-dataset.json").write_text("[]\n", encoding="utf-8")
        result = _export(connection, tmp_path)
        assert result.ok, result.problems
        assert not (tmp_path / "retired-dataset.json").exists()
        assert "-retired-dataset.json" in result.wrote

    def test_write_false_computes_everything_and_writes_nothing(
        self, connection: FakeConnection, tmp_path: Path
    ) -> None:
        result = generate_export(
            connection,
            output_dir=tmp_path,
            repo_root=REPO_ROOT,
            generated_at=FIXED_GENERATED_AT,
            write=False,
        )
        assert result.ok, result.problems
        assert result.manifest["dataset_version"] == 1
        assert list(tmp_path.glob("*.json")) == []


# =======================================================================================
# Documentation agrees with the contract
# =======================================================================================


class TestDocumentationAgreesWithTheContract:
    """The Markdown specification and the machine-readable contract are one thing.

    Without this pair of assertions the allowlist would live in two hand-synchronised
    places and the first divergence would be silent.
    """

    def _contract_text(self) -> str:
        return DATA_CONTRACT.read_text(encoding="utf-8")

    def test_the_approved_source_view_table_lists_exactly_the_allowlist(self) -> None:
        text = self._contract_text()
        section = text.split("## 3. Approved source views")[1].split("\n## ")[0]
        documented = set(re.findall(r"`reporting\.(vw_\w+)`", section))
        assert documented == set(spec.SOURCE_VIEW_ALLOWLIST), (
            "DATA_CONTRACT.md section 3 and arpi.dashboard.contract disagree about which "
            f"views are approved. Only in the document: "
            f"{sorted(documented - set(spec.SOURCE_VIEW_ALLOWLIST))}. Only in the code: "
            f"{sorted(set(spec.SOURCE_VIEW_ALLOWLIST) - documented)}."
        )

    def test_the_approved_source_view_table_lists_every_dataset(self) -> None:
        text = self._contract_text()
        section = text.split("## 3. Approved source views")[1].split("\n## ")[0]
        # Any backticked slug in the section counts: the calendar row qualifies its dataset
        # name with a parenthetical, so anchoring on the cell boundary would miss it.
        documented = set(re.findall(r"`([a-z][a-z0-9-]*)`", section))
        assert set(spec.DATASET_NAMES) <= documented, (
            "DATA_CONTRACT.md section 3 does not name every exported dataset: missing "
            f"{sorted(set(spec.DATASET_NAMES) - documented)}."
        )

    def test_the_document_records_the_schema_and_the_query_normalisation(self) -> None:
        text = self._contract_text()
        assert spec.SCHEMA_ID in text
        assert spec.QUERY_NORMALISATION in text

    def test_the_document_records_the_measured_size_ceilings(self) -> None:
        text = self._contract_text()
        for name, limit in SIZE_LIMITS.items():
            megabytes = limit // (1024 * 1024)
            assert f"{megabytes} MB" in text, (
                f"DATA_CONTRACT.md section 10 does not record the {name} ceiling of "
                f"{megabytes} MB that the exporter enforces."
            )
