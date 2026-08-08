"""The four F&I reporting views, and the two governed functions beneath them.

Three things are proved here, and they are different things:

1. **Grain.** Each view holds exactly the grain it declares, with no fan-out. A duplicated
   join key in this domain doubles a gross figure, and a doubled gross is invisible in a
   percentage because both sides of the ratio move together.
2. **Grain SAFETY.** The measures that must not be repeated across a finer grain are
   physically absent from the finer view -- so the mistake is impossible rather than
   merely discouraged.
3. **Parity.** The SQL eligibility predicate and the Python one agree over the WHOLE input
   cross product, and the SQL minimum-sample floor equals the Python constant. Two
   languages cannot share one function body, so the honest arrangement is one authority
   per layer plus a proof that they agree.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from arpi.constants import (
    ELIGIBILITY_RULE_IDS,
    FINANCE_PRODUCT_CATEGORIES,
    MINIMUM_SAMPLE_ELIGIBLE_DEALS,
    RETAIL_FINANCE_STRUCTURES,
)
from arpi.generation.fi_eligibility import (
    eligible_categories,
    finance_structure_for,
    is_category_eligible,
)

pytestmark = pytest.mark.integration

FI_VIEWS = (
    "vw_deal_product_detail",
    "vw_fi_summary",
    "vw_fi_product_penetration",
    "vw_fi_adjustment_summary",
)

#: The declared grain of each view, exactly as its COMMENT ON VIEW states it.
DECLARED_GRAIN: dict[str, tuple[str, ...]] = {
    "vw_deal_product_detail": ("product_sale_id",),
    "vw_fi_summary": ("dealership_key", "sale_date_key", "finance_manager_grain_key"),
    "vw_fi_product_penetration": (
        "dealership_key",
        "sale_date_key",
        "finance_manager_grain_key",
        "product_category",
    ),
    "vw_fi_adjustment_summary": (
        "dealership_key",
        "adjustment_date_key",
        "finance_manager_grain_key",
        "product_category",
        "adjustment_type",
    ),
}

VEHICLE_CONDITIONS = ("New", "Used", "Certified")
SALE_TYPES = (
    "New Retail",
    "Used Retail",
    "Certified Retail",
    "Lease",
    "Wholesale",
    "Dealer Trade",
)


def _scalar(cursor: Any, statement: str, params: Any = None) -> Any:
    cursor.execute(statement, params)
    row = cursor.fetchone()
    return None if row is None else row[0]


# --------------------------------------------------------------------------------------
# Existence and access
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_view_exists(loaded_cursor: Any, view_name: str) -> None:
    assert (
        _scalar(
            loaded_cursor,
            "SELECT count(*) FROM information_schema.views "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
        == 1
    )


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_view_and_every_column_carry_a_comment(loaded_cursor: Any, view_name: str) -> None:
    """A view whose columns are undocumented is a view a consumer will guess at."""
    view_comment = _scalar(
        loaded_cursor, f"SELECT obj_description('reporting.{view_name}'::regclass, 'pg_class')"
    )
    assert view_comment and len(view_comment) > 200, (
        f"reporting.{view_name} has no substantive COMMENT ON VIEW"
    )
    undocumented = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'reporting' AND c.table_name = '{view_name}'
          AND col_description('reporting.{view_name}'::regclass, c.ordinal_position) IS NULL
        """,
    )
    assert undocumented == 0, f"reporting.{view_name} has {undocumented} undocumented column(s)"


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_view_comment_states_its_grain_and_its_synthetic_limitation(
    loaded_cursor: Any, view_name: str
) -> None:
    comment = _scalar(
        loaded_cursor, f"SELECT obj_description('reporting.{view_name}'::regclass, 'pg_class')"
    )
    assert "Grain:" in comment
    assert "DASH.7" in comment, "the export boundary is not stated"
    assert any(word in comment for word in ("SYNTHETIC", "FICTIONAL", "synthetic", "fictional"))


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_reporter_can_read_the_view(loaded_cursor: Any, view_name: str) -> None:
    """arpi_reporter holds SELECT on `reporting` and nothing on `warehouse`.

    Exercised by actually becoming the role inside the test transaction, not by asking
    the catalogue what it thinks: the penetration view calls a function that reads
    warehouse.dim_finance_product, which is why that function is SECURITY DEFINER. A
    SECURITY INVOKER function fails here with "permission denied for schema warehouse"
    while every privilege the catalogue reports still looks correct.
    """
    loaded_cursor.execute("SET LOCAL ROLE arpi_reporter")
    try:
        loaded_cursor.execute(f"SELECT count(*) FROM reporting.{view_name}")
        assert loaded_cursor.fetchone()[0] >= 0
    finally:
        loaded_cursor.execute("RESET ROLE")


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_reporter_holds_select_and_not_insert(loaded_cursor: Any, view_name: str) -> None:
    assert _scalar(
        loaded_cursor,
        f"SELECT has_table_privilege('arpi_reporter', 'reporting.{view_name}', 'SELECT')",
    )
    assert (
        _scalar(
            loaded_cursor,
            f"SELECT has_table_privilege('arpi_reporter', 'reporting.{view_name}', 'INSERT')",
        )
        is False
    )


# --------------------------------------------------------------------------------------
# Grain, and the absence of fan-out
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_view_is_unique_at_its_declared_grain(loaded_cursor: Any, view_name: str) -> None:
    columns = ", ".join(DECLARED_GRAIN[view_name])
    rows = _scalar(loaded_cursor, f"SELECT count(*) FROM reporting.{view_name}")
    distinct = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM (SELECT DISTINCT {columns} FROM reporting.{view_name}) AS g",
    )
    assert rows == distinct, (
        f"reporting.{view_name} returns {rows} rows over {distinct} distinct "
        f"({columns}) combinations, so it fans out"
    )
    assert rows > 0, f"reporting.{view_name} is empty, so its grain is untested"


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_no_grain_column_is_null(loaded_cursor: Any, view_name: str) -> None:
    """PostgreSQL treats NULLs as distinct, so a nullable grain cannot be checked at all.

    finance_manager_grain_key exists precisely for this: coalesce(manager, 0) is NOT NULL,
    so the "nobody on the F&I desk" group is a real, testable group rather than a hole.
    """
    for column in DECLARED_GRAIN[view_name]:
        nulls = _scalar(
            loaded_cursor, f"SELECT count(*) FROM reporting.{view_name} WHERE {column} IS NULL"
        )
        assert nulls == 0, f"reporting.{view_name}.{column} is part of the grain and is NULL"


def test_the_detail_view_preserves_the_facts_grain_exactly(loaded_cursor: Any) -> None:
    view_rows = _scalar(loaded_cursor, "SELECT count(*) FROM reporting.vw_deal_product_detail")
    fact_rows = _scalar(loaded_cursor, "SELECT count(*) FROM warehouse.fact_finance_product_sale")
    assert view_rows == fact_rows


def test_a_manager_and_category_join_does_not_multiply_reserve_or_retail_units(
    loaded_cursor: Any,
) -> None:
    """THE DOUBLE COUNT THIS DOMAIN IS MOST EXPOSED TO, made structurally impossible.

    A deal appears on as many penetration rows as it has eligible categories -- up to nine.
    If that view carried finance reserve or retail units, summing it would multiply both by
    the category count. They are absent, so the mistake cannot be made, and this asserts
    the absence rather than trusting it.
    """
    columns = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'reporting' AND table_name = 'vw_fi_product_penetration'",
        )
    }
    for forbidden in ("finance_reserve_gross", "retail_units", "back_end_gross_deal_date"):
        assert forbidden not in columns, (
            f"vw_fi_product_penetration carries {forbidden!r}, which is a property of a "
            "DEAL. A deal appears on one row per eligible category here, so any sum of it "
            "would be multiplied by the category count."
        )

    # And the positive half: the summary view's totals are the warehouse's, unmultiplied.
    view_reserve = _scalar(
        loaded_cursor, "SELECT sum(finance_reserve_gross) FROM reporting.vw_fi_summary"
    )
    fact_reserve = _scalar(
        loaded_cursor,
        "SELECT sum(finance_reserve_gross) FROM warehouse.fact_vehicle_sale WHERE is_retail",
    )
    assert Decimal(str(view_reserve)) == Decimal(str(fact_reserve))

    view_units = _scalar(loaded_cursor, "SELECT sum(retail_units) FROM reporting.vw_fi_summary")
    fact_units = _scalar(
        loaded_cursor, "SELECT sum(unit_count) FROM warehouse.fact_vehicle_sale WHERE is_retail"
    )
    assert view_units == fact_units


def _rows(cursor: Any, statement: str) -> list[tuple[Any, ...]]:
    cursor.execute(statement)
    return list(cursor.fetchall())


def test_the_penetration_view_carries_every_governed_category(loaded_cursor: Any) -> None:
    categories = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT product_category FROM reporting.vw_fi_product_penetration",
        )
    }
    assert categories == set(FINANCE_PRODUCT_CATEGORIES)


def test_every_penetration_row_names_a_governed_eligibility_rule(loaded_cursor: Any) -> None:
    rules = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT eligibility_rule_id FROM reporting.vw_fi_product_penetration",
        )
    }
    assert rules <= set(ELIGIBILITY_RULE_IDS)


def test_a_penetration_numerator_never_exceeds_its_own_denominator(
    loaded_cursor: Any,
) -> None:
    offending = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_fi_product_penetration "
        "WHERE penetration_numerator > penetration_denominator",
    )
    assert offending == 0, (
        "a penetration numerator exceeds its denominator, so a contract sits outside its "
        "own eligible population -- which would render as a rate above 100%"
    )


# --------------------------------------------------------------------------------------
# Date bases, published as data
# --------------------------------------------------------------------------------------


def test_the_sale_date_views_publish_the_deal_date_basis(loaded_cursor: Any) -> None:
    for view_name in ("vw_fi_summary", "vw_fi_product_penetration"):
        bases = {
            row[0]
            for row in _rows(
                loaded_cursor, f"SELECT DISTINCT deal_date_basis FROM reporting.{view_name}"
            )
        }
        assert bases == {"sale date"}


def test_the_adjustment_view_is_on_a_different_basis_from_the_others(
    loaded_cursor: Any,
) -> None:
    """Two date bases inside one grain would put two populations behind one row."""
    numerator = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT numerator_date_basis FROM reporting.vw_fi_adjustment_summary",
        )
    }
    denominator = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT DISTINCT rate_denominator_date_basis FROM reporting.vw_fi_adjustment_summary",
        )
    }
    assert numerator == {"adjustment date"}
    assert denominator == {"sale date"}
    assert numerator != denominator


def test_the_adjustment_view_carries_no_sale_date_gross_column(loaded_cursor: Any) -> None:
    """A sale-date figure on an adjustment-date row is the silent blend to avoid.

    `adjusted_contract_original_gross` is permitted and is NOT that: it is the deal-date
    gross of the CONTRACTS ADJUSTED HERE, which is a cohort-free severity read and is
    documented as not being KPI-FNI-014's denominator.
    """
    columns = {
        row[0]
        for row in _rows(
            loaded_cursor,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'reporting' AND table_name = 'vw_fi_adjustment_summary'",
        )
    }
    assert "original_product_gross" not in columns
    assert "contracts_sold_in_period" not in columns
    assert "adjusted_contract_original_gross" in columns


def test_the_as_of_date_is_the_governed_one_and_is_identical_across_the_views(
    loaded_cursor: Any,
) -> None:
    """One as-of date for the whole platform, not one per domain."""
    fi_summary = _scalar(loaded_cursor, "SELECT DISTINCT as_of_date FROM reporting.vw_fi_summary")
    detail = _scalar(
        loaded_cursor, "SELECT DISTINCT as_of_date FROM reporting.vw_deal_product_detail"
    )
    penetration = _scalar(
        loaded_cursor, "SELECT DISTINCT as_of_date FROM reporting.vw_fi_product_penetration"
    )
    target = _scalar(
        loaded_cursor, "SELECT DISTINCT as_of_date FROM reporting.vw_target_attainment"
    )
    assert fi_summary == detail == penetration == target


# --------------------------------------------------------------------------------------
# The governed functions: parity with Python
# --------------------------------------------------------------------------------------


def test_the_sql_finance_structure_matches_python_over_the_whole_cross_product(
    loaded_cursor: Any,
) -> None:
    """Every governed sale type against a financed and an unfinanced amount.

    Two languages cannot share one function body, so the honest arrangement is one
    authority per layer plus a proof they agree -- and this is the proof.
    """
    for sale_type in SALE_TYPES:
        for financed in ("0.00", "0.01", "18000.00"):
            observed = _scalar(
                loaded_cursor,
                "SELECT warehouse.fn_finance_structure(%s::varchar, %s::numeric)",
                (sale_type, financed),
            )
            expected = finance_structure_for(sale_type, Decimal(financed))
            assert observed == expected, (
                f"SQL and Python disagree on ({sale_type}, {financed}): "
                f"{observed!r} vs {expected!r}"
            )


def test_an_unknown_sale_type_returns_null_rather_than_defaulting_to_cash(
    loaded_cursor: Any,
) -> None:
    """A default would move an unknown type into three eligibility denominators."""
    assert (
        _scalar(
            loaded_cursor,
            "SELECT warehouse.fn_finance_structure('Fleet'::varchar, 0::numeric)",
        )
        is None
    )


def test_the_sql_eligibility_predicate_matches_python_over_the_whole_cross_product(
    loaded_cursor: Any,
) -> None:
    """Ten categories x five structures x three conditions, evaluated both ways."""
    structures = (*RETAIL_FINANCE_STRUCTURES, "Wholesale", "Dealer Trade")
    disagreements: list[str] = []
    for category in FINANCE_PRODUCT_CATEGORIES:
        for structure in structures:
            for condition in VEHICLE_CONDITIONS:
                observed = _scalar(
                    loaded_cursor,
                    "SELECT warehouse.fn_product_category_is_eligible("
                    "%s::varchar, %s::varchar, %s::varchar)",
                    (category, structure, condition),
                )
                if structure in RETAIL_FINANCE_STRUCTURES:
                    expected = is_category_eligible(
                        category, finance_structure=structure, vehicle_condition=condition
                    )
                else:
                    # No rule admits a disposal, and the SQL side must agree without
                    # anyone having written that rule twice.
                    expected = False
                if observed != expected:
                    disagreements.append(
                        f"{category}/{structure}/{condition}: {observed} vs {expected}"
                    )
    assert disagreements == [], (
        f"the SQL and Python eligibility predicates disagree: {disagreements}"
    )


def test_the_sql_eligible_set_matches_python_for_every_structure_and_condition(
    loaded_cursor: Any,
) -> None:
    """The same parity, asked the other way round: which categories, not is-this-one."""
    for structure in RETAIL_FINANCE_STRUCTURES:
        for condition in VEHICLE_CONDITIONS:
            observed = {
                row[0]
                for row in _rows(
                    loaded_cursor,
                    f"""
                    SELECT DISTINCT p.product_category
                    FROM warehouse.dim_finance_product AS p
                    WHERE warehouse.fn_product_category_is_eligible(
                              p.product_category, '{structure}', '{condition}')
                    """,
                )
            }
            expected = set(
                eligible_categories(finance_structure=structure, vehicle_condition=condition)
            )
            assert observed == expected, f"{structure}/{condition}: {observed} vs {expected}"


def test_the_minimum_sample_floor_is_one_value_per_layer_and_they_agree(
    loaded_cursor: Any,
) -> None:
    assert _scalar(loaded_cursor, "SELECT warehouse.fn_minimum_sample_floor()") == (
        MINIMUM_SAMPLE_ELIGIBLE_DEALS
    )
    for view_name in ("vw_fi_summary", "vw_fi_product_penetration"):
        published = {
            row[0]
            for row in _rows(
                loaded_cursor, f"SELECT DISTINCT minimum_sample_floor FROM reporting.{view_name}"
            )
        }
        assert published == {MINIMUM_SAMPLE_ELIGIBLE_DEALS}


# --------------------------------------------------------------------------------------
# What must not be there
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("view_name", FI_VIEWS)
def test_the_view_exposes_no_customer_reference_and_no_lending_mechanic(
    loaded_cursor: Any, view_name: str
) -> None:
    columns = {
        row[0].casefold()
        for row in _rows(
            loaded_cursor,
            "SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema = 'reporting' AND table_name = '{view_name}'",
        )
    }
    forbidden = (
        "customer",
        "apr",
        "buy_rate",
        "sell_rate",
        "rate_spread",
        "money_factor",
        "monthly_payment",
        "credit_score",
        "fico",
        "income",
        "stipulation",
        "adverse_action",
    )
    offending = [
        f"{name} (contains {token!r})" for name in columns for token in forbidden if token in name
    ]
    assert offending == [], f"reporting.{view_name} exposes {offending}"


def test_every_fi_view_is_exported_exactly_once_by_dash_7() -> None:
    """DASH.6 exported none of these. DASH.7 promotes all four, and only these four.

    Through DASH.6 this assertion read the other way round -- no F&I view may appear in
    the export contract -- because DASH.6 was a data increment and a view that exists in
    ``reporting`` is not thereby exportable. DASH.7 owns the presentation surface, so the
    assertion is re-aimed rather than deleted, and it is still a closed set in both
    directions: a fifth F&I view exported without an increment fails here, and a promoted
    view that quietly lost its dataset fails here too.

    Read from the export contract rather than from the data directory, so a dataset added
    without a manifest entry is caught too.
    """
    from arpi.dashboard.contract import DATASETS

    exported = [spec for spec in DATASETS if spec.source_view.split(".")[-1] in FI_VIEWS]
    by_view = {spec.source_view.split(".")[-1]: spec for spec in exported}

    assert sorted(by_view) == sorted(FI_VIEWS), (
        "DASH.7 exports exactly the four DASH.6 F&I views. "
        f"Exported: {sorted(by_view)}; expected: {sorted(FI_VIEWS)}."
    )
    assert len(exported) == len(by_view), (
        "an F&I view is exported by more than one dataset, which would publish the same "
        "rows under two names and two reconciliation identities"
    )
    for spec in exported:
        joined = {view.split(".")[-1] for view in spec.join_views}
        assert joined <= set(FI_VIEWS) | {"vw_dealership", "vw_calendar"}, (
            f"{spec.name} joins {sorted(joined)}: an F&I dataset resolves keys through "
            "allowlisted dimension views only"
        )


def test_no_exported_fi_column_is_undeclared_by_the_view(loaded_cursor: Any) -> None:
    """The promotion is a SUBSET, never an addition.

    A dataset that named a column the view does not publish would fail at export time,
    but it would fail with a database error rather than with the reason. This states the
    rule the promotion had to satisfy: DASH.7 exports fewer columns than DASH.6 built and
    invents none.

    Checked against ``source_column``, not against the exported name. Two columns are
    deliberately RENAMED at the boundary -- ``finance_manager_id`` is exported as
    ``finance_manager_code`` so that no exported identifier reads like a warehouse key --
    and a check that compared exported names would call a rename an invention.
    """
    from arpi.dashboard.contract import DATASETS

    checked = 0
    for spec in DATASETS:
        view_name = spec.source_view.split(".")[-1]
        if view_name not in FI_VIEWS:
            continue
        loaded_cursor.execute(
            """
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'reporting' AND table_name = %s
            """,
            (view_name,),
        )
        published = {row[0] for row in loaded_cursor.fetchall()}
        declared = {
            column.source_column.split(".")[-1]
            for column in spec.columns
            if column.source_column is not None
        }
        assert declared <= published, (
            f"{spec.name} declares {sorted(declared - published)}, which "
            f"reporting.{view_name} does not publish"
        )
        assert len(declared) < len(published), (
            f"{spec.name} exports every column reporting.{view_name} publishes. The "
            "promotion is meant to be a reviewed subset, not a pass-through."
        )
        checked += 1
    assert checked == len(FI_VIEWS)
