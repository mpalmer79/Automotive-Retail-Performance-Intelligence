"""The inventory accounting and GL control generators, on the datasets they actually emit.

`tests/unit/test_accounting_seeded_defects.py` proves the data-quality suite can fail.
This module proves the generators are worth validating in the first place: that the
committed datasets have the shape, the domain and the determinism the contracts claim, and
that the properties the whole domain rests on are observable rather than merely asserted.

Two of those properties need the dataset to *contain* something, not merely to lack a
defect, and they are asserted as such:

* floorplan principal must be **materially non-zero**, or "floorplan is excluded from book
  value" is vacuously true;
* the reconciliation must produce **all four** comparison states, or a surface that only
  ever agrees would be shipped having never been observed working.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from arpi.config import ArpiConfig
from arpi.constants import (
    CONDITION_TO_CONTROL_CATEGORY,
    GL_ACCOUNT_TYPES,
    GL_NORMAL_BALANCES,
    INVENTORY_CONTROL_CATEGORIES,
)
from arpi.generation.accounting_validation import (
    validate_gl_account_dataset,
    validate_gl_control_balance_dataset,
    validate_inventory_accounting_dataset,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.gl_control import (
    CATEGORY_TO_ACCOUNT_ID,
    GL_ACCOUNT_DEFINITIONS,
    VARIANCE_SCENARIOS,
    generate_gl_account_dataset,
    generate_gl_control_balance_dataset,
    scenario_dates,
    subledger_totals,
)
from arpi.generation.inventory_accounting import (
    CERTIFICATION_COST,
    build_inventory_accounting_records,
    generate_inventory_accounting_dataset,
    month_end_dates,
)


@pytest.fixture
def accounting_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_inventory_accounting_dataset(test_config)


@pytest.fixture
def gl_account_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_gl_account_dataset(test_config)


@pytest.fixture
def gl_balance_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_gl_control_balance_dataset(test_config)


# --------------------------------------------------------------------------------------
# The schedule
# --------------------------------------------------------------------------------------


def test_the_schedule_validates_clean(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    report = validate_inventory_accounting_dataset(accounting_dataset, test_config)
    assert report.passed, [r.check_id for r in report.results if r.status != "passed"]


def test_the_schedule_is_month_end_only(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A deliberate narrowing, and what makes matched-date comparability structural."""
    dates = sorted({value.date() for value in accounting_dataset.frame["accounting_date"]})
    expected = month_end_dates(test_config.reporting.start_date, test_config.reporting.end_date)
    assert dates == list(expected)
    assert dates, "the accounting calendar is empty"


def test_the_grain_is_one_line_per_unit_per_store_per_date(
    accounting_dataset: GeneratedDataset,
) -> None:
    frame = accounting_dataset.frame
    grain = frame[["accounting_date", "dealership_id", "vehicle_id"]]
    assert len(grain) == len(grain.drop_duplicates()), (
        "a unit appears twice on one store's schedule on one date, which would count its "
        "carrying amount twice in the control balance"
    )


def test_the_book_value_identity_holds_on_every_line(
    accounting_dataset: GeneratedDataset,
) -> None:
    """Asserted here in Python as well as by the CHECK, the DQ suite and the reconciliation.

    Four independent statements of one rule is not redundancy in this domain: it is the
    only rule whose failure would make every figure above it meaningless.
    """
    frame = accounting_dataset.frame
    for _, row in frame.iterrows():
        expected = (
            row["acquisition_cost"]
            + row["capitalized_transportation"]
            + row["capitalized_reconditioning"]
            + row["capitalized_accessories"]
            + row["other_capitalized_costs"]
            - row["write_down_amount"]
        )
        assert row["current_book_value"] == expected


def test_the_dataset_carries_material_floorplan_principal(
    accounting_dataset: GeneratedDataset,
) -> None:
    """Without this, "floorplan is excluded from book value" is vacuously true."""
    floorplanned = sum(
        1 for amount in accounting_dataset.frame["floorplan_principal"] if amount > Decimal("0.00")
    )
    unfloored = accounting_dataset.row_count - floorplanned
    assert floorplanned > 0, "no unit is floorplanned, so the exclusion is untested"
    assert unfloored > 0, (
        "every unit is floorplanned, so 0.00 as a legitimate unfloored position is untested"
    )


def test_the_dataset_carries_write_downs_and_units_without_them(
    accounting_dataset: GeneratedDataset,
) -> None:
    written_down = sum(
        1 for amount in accounting_dataset.frame["write_down_amount"] if amount > Decimal("0.00")
    )
    assert written_down > 0, "no unit is written down, so the age rule is untested"
    assert written_down < accounting_dataset.row_count


def test_other_capitalized_costs_only_ever_carry_the_certification_cost(
    accounting_dataset: GeneratedDataset,
) -> None:
    """The column a balancing residual would hide in, checked against its governed rule."""
    permitted = {Decimal("0.00"), CERTIFICATION_COST}
    assert set(accounting_dataset.frame["other_capitalized_costs"]) <= permitted


def test_the_control_category_is_the_unit_condition_and_never_the_sales_grouping(
    accounting_dataset: GeneratedDataset,
) -> None:
    """Certified is its own control account; the sales domain groups it with Used."""
    categories = set(accounting_dataset.frame["control_account_category"])
    assert categories <= set(INVENTORY_CONTROL_CATEGORIES)
    assert set(CONDITION_TO_CONTROL_CATEGORY.values()) == set(INVENTORY_CONTROL_CATEGORIES)
    assert "Certified Vehicle Inventory" in categories, (
        "no certified unit is scheduled, so the accounting grouping is indistinguishable "
        "from the sales grouping in this dataset"
    )


def test_no_wholesale_control_category_is_ever_emitted(
    accounting_dataset: GeneratedDataset,
) -> None:
    """Recorded decision: only the eventual disposal would identify one, which is leakage."""
    assert "Wholesale Inventory" not in set(accounting_dataset.frame["control_account_category"])


def test_generation_is_deterministic(test_config: ArpiConfig) -> None:
    first = generate_inventory_accounting_dataset(test_config).frame
    second = generate_inventory_accounting_dataset(test_config).frame
    assert first.equals(second)


# --------------------------------------------------------------------------------------
# The catalogue
# --------------------------------------------------------------------------------------


def test_the_catalogue_validates_clean(gl_account_dataset: GeneratedDataset) -> None:
    report = validate_gl_account_dataset(gl_account_dataset)
    assert report.passed, [r.check_id for r in report.results if r.status != "passed"]


def test_the_catalogue_is_three_accounts_one_per_governed_category(
    gl_account_dataset: GeneratedDataset,
) -> None:
    """The smallness is the design. A control catalogue that reconciles beats a fake COA."""
    frame = gl_account_dataset.frame
    assert gl_account_dataset.row_count == len(INVENTORY_CONTROL_CATEGORIES) == 3
    assert set(frame["account_category"]) == set(INVENTORY_CONTROL_CATEGORIES)
    assert len(GL_ACCOUNT_DEFINITIONS) == 3


def test_every_catalogue_account_is_an_inventory_asset(
    gl_account_dataset: GeneratedDataset,
) -> None:
    """Liability is permitted by the domain and used by nothing, which is the recorded state."""
    frame = gl_account_dataset.frame
    assert set(frame["account_type"]) == {"Asset"}
    assert "Liability" in GL_ACCOUNT_TYPES, (
        "the domain no longer permits a liability class, so a later floorplan control "
        "account would need a migration rather than a row"
    )
    assert set(frame["normal_balance"]) <= set(GL_NORMAL_BALANCES)
    assert all(frame["inventory_control_flag"])


def test_no_catalogue_account_names_a_general_ledger_concept(
    gl_account_dataset: GeneratedDataset,
) -> None:
    forbidden = (
        "cash",
        "revenue",
        "cost of sales",
        "payroll",
        "payable",
        "receivable",
        "equity",
        "retained",
        "tax",
    )
    for name in gl_account_dataset.frame["account_name"]:
        assert not any(fragment in name.lower() for fragment in forbidden), name


# --------------------------------------------------------------------------------------
# The control balances
# --------------------------------------------------------------------------------------


def test_the_balances_validate_clean(
    gl_balance_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    report = validate_gl_control_balance_dataset(
        gl_balance_dataset, test_config, gl_account_dataset
    )
    assert report.passed, [r.check_id for r in report.results if r.status != "passed"]


def test_every_scenario_lands_inside_the_profiles_own_calendar(
    test_config: ArpiConfig,
) -> None:
    """The defect that made the whole surface untested on the profile that tests it.

    The scenarios were originally written with literal dates in the development window, so
    the two-month `test` profile reached none of them. Expressed as offsets they land in
    every profile.
    """
    records = build_inventory_accounting_records(test_config)
    calendar = sorted({record.accounting_date for record in records})
    resolved = scenario_dates(calendar)

    assert set(resolved) == {scenario.scenario_id for scenario in VARIANCE_SCENARIOS}
    for scenario_id, landed in resolved.items():
        assert landed in calendar, f"{scenario_id} lands outside the accounting calendar"


def test_the_planted_scenarios_produce_all_four_comparison_states(
    gl_balance_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A surface observed in only one state has not been demonstrated working.

    Computed here from the generated frames rather than from the database, so the property
    is a fact about the GENERATOR and holds before any SQL runs.
    """
    records = build_inventory_accounting_records(test_config)
    totals = subledger_totals(records)
    # The generated frame carries dates as pandas timestamps; `totals` is keyed on plain
    # `date`. Normalising here rather than comparing the two representations is what stops
    # this test from silently reporting every position as a missing side.
    balances = {
        (
            row["dealership_id"],
            row["gl_account_id"],
            row["balance_date"].date()
            if hasattr(row["balance_date"], "date")
            else row["balance_date"],
        ): row["net_balance"]
        for _, row in gl_balance_dataset.frame.iterrows()
    }
    account_for = CATEGORY_TO_ACCOUNT_ID

    reconciled = variance = missing_gl = 0
    positive = negative = 0
    for (dealership_id, category, balance_date), subledger in totals.items():
        key = (dealership_id, account_for[category], balance_date)
        if key not in balances:
            missing_gl += 1
            continue
        difference = balances[key] - subledger
        if difference == Decimal("0.00"):
            reconciled += 1
        else:
            variance += 1
            positive += difference > 0
            negative += difference < 0

    subledger_positions = {
        (dealership_id, account_for[category], balance_date)
        for dealership_id, category, balance_date in totals
    }
    missing_subledger = sum(1 for key in balances if key not in subledger_positions)

    assert reconciled > 0, "no position reconciles exactly"
    assert variance > 0, "no position carries a variance"
    assert missing_gl > 0, "no position has a withheld GL balance"
    assert missing_subledger > 0, "no GL balance exists without a schedule behind it"
    assert positive > 0 and negative > 0, (
        "both variance signs are required: a rollup that summed absolute values rather "
        "than signed ones would pass on a one-signed dataset"
    )


def test_a_variance_is_never_a_rejection(
    gl_balance_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """The balances that differ from the schedule survive validation untouched.

    A variance is structurally valid data. Quarantining one would leave a reconciliation
    surface that could only ever show agreement.
    """
    report = validate_gl_control_balance_dataset(
        gl_balance_dataset, test_config, gl_account_dataset
    )
    assert report.passed
    assert gl_balance_dataset.row_count > 0
