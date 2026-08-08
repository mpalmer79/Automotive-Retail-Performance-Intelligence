"""Fifteen seeded defects, each proving one accounting control can actually fail.

A data-quality suite that has only ever been run against correct data proves nothing. It
could be checking the wrong column, comparing a value with itself, or silently passing on
an empty frame, and a green run would look identical either way.

So every defect below is planted in a **copy** of a real generated dataset and pushed
through the **production validation entry point** — `validate_inventory_accounting_dataset`,
`validate_gl_account_dataset`, `validate_gl_control_balance_dataset` — not through a
test-only re-implementation of the same rule. What is asserted is that the named check
reports `failed`, that it names the right number of offending rows where a count is
meaningful, and that the *clean* dataset passes the same check, so a rule that failed
unconditionally would not be mistaken for a rule that works.

**No committed artefact is mutated.** Each defect is applied to `frame.copy()`, and
`tests/unit/test_accounting_generation.py` covers the committed datasets as they stand.

The fifteen were chosen to cover the failures this domain is actually exposed to, not to
reach a number: the book-value identity, the three ways a component can be nonsense, the
two exclusions that keep concepts apart (pack, floorplan), the grain, the two closed
vocabularies, the schema contracts that keep a control catalogue from becoming a chart of
accounts, and the matched-date rule the whole reconciliation rests on.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from decimal import Decimal
from typing import Any

import pandas as pd
import pytest

from arpi.config import ArpiConfig
from arpi.generation.accounting_validation import (
    CHECK_GLA_CATALOGUE_IS_FOCUSED,
    CHECK_GLA_CATEGORY_VOCABULARY,
    CHECK_GLA_CONTROL_FLAG_CONSISTENT,
    CHECK_GLA_SCHEMA_MATCHES,
    CHECK_GLA_UNIQUE_ACCOUNT_ID,
    CHECK_GLB_ACCOUNT_RESOLVES,
    CHECK_GLB_BALANCE_DATE_IS_MONTH_END,
    CHECK_GLB_SCHEMA_MATCHES,
    CHECK_GLB_UNIQUE_GRAIN,
    CHECK_IAS_BOOK_VALUE_IDENTITY,
    CHECK_IAS_COMPONENTS_NONNEGATIVE,
    CHECK_IAS_CONTROL_CATEGORY_VALID,
    CHECK_IAS_DAYS_IN_STOCK_AGREES,
    CHECK_IAS_EXACT_PRECISION,
    CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK,
    CHECK_IAS_NO_PROHIBITED_PII,
    CHECK_IAS_OTHER_COSTS_NOT_A_PLUG,
    CHECK_IAS_UNIQUE_GRAIN,
    CHECK_IAS_WRITE_DOWN_NONNEGATIVE,
    validate_gl_account_dataset,
    validate_gl_control_balance_dataset,
    validate_inventory_accounting_dataset,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.gl_control import (
    generate_gl_account_dataset,
    generate_gl_control_balance_dataset,
)
from arpi.generation.inventory_accounting import generate_inventory_accounting_dataset
from arpi.validation.results import ValidationReport

# --------------------------------------------------------------------------------------
# Fixtures: one clean generation per module, copied before every mutation
# --------------------------------------------------------------------------------------


@pytest.fixture
def accounting_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_inventory_accounting_dataset(test_config)


@pytest.fixture
def gl_account_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_gl_account_dataset(test_config)


@pytest.fixture
def gl_balance_dataset(test_config: ArpiConfig) -> GeneratedDataset:
    return generate_gl_control_balance_dataset(test_config)


def _mutated(
    dataset: GeneratedDataset, mutate: Callable[[pd.DataFrame], pd.DataFrame]
) -> GeneratedDataset:
    """Return a copy of ``dataset`` with ``mutate`` applied to a copy of its frame.

    The copy is what keeps this suite honest: the committed CSVs and the module-scoped
    clean datasets are never touched, so a defect cannot leak into another test.
    """
    return GeneratedDataset(
        entity_name=dataset.entity_name,
        frame=mutate(dataset.frame.copy(deep=True)),
        declared_columns=dataset.declared_columns,
        namespace=dataset.namespace,
    )


def _result(report: ValidationReport, check_id: str) -> Any:
    for result in report.results:
        if result.check_id == check_id:
            return result
    raise AssertionError(f"{check_id} is not in the report at all, so it cannot have run")


def _assert_fails(
    report: ValidationReport, check_id: str, expected_failures: int | None = None
) -> None:
    result = _result(report, check_id)
    assert result.status == "failed", (
        f"{check_id} passed on a dataset seeded with the exact defect it exists to catch"
    )
    if expected_failures is not None:
        assert result.failed_record_count == expected_failures, (
            f"{check_id} reported {result.failed_record_count} offending row(s); the "
            f"seeded defect touched {expected_failures}"
        )


def _assert_passes(report: ValidationReport, check_id: str) -> None:
    result = _result(report, check_id)
    assert result.status == "passed", (
        f"{check_id} fails on CLEAN data, so its failure on seeded data proves nothing"
    )


# --------------------------------------------------------------------------------------
# The clean baseline. Without this every assertion below is worthless.
# --------------------------------------------------------------------------------------


def test_every_seeded_check_passes_on_clean_data(
    accounting_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    gl_balance_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """A rule that fails unconditionally is not a rule, it is noise."""
    schedule = validate_inventory_accounting_dataset(accounting_dataset, test_config)
    catalogue = validate_gl_account_dataset(gl_account_dataset)
    balances = validate_gl_control_balance_dataset(
        gl_balance_dataset, test_config, gl_account_dataset
    )

    for check_id in (
        CHECK_IAS_BOOK_VALUE_IDENTITY,
        CHECK_IAS_COMPONENTS_NONNEGATIVE,
        CHECK_IAS_WRITE_DOWN_NONNEGATIVE,
        CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK,
        CHECK_IAS_OTHER_COSTS_NOT_A_PLUG,
        CHECK_IAS_UNIQUE_GRAIN,
        CHECK_IAS_CONTROL_CATEGORY_VALID,
        CHECK_IAS_DAYS_IN_STOCK_AGREES,
        CHECK_IAS_EXACT_PRECISION,
        CHECK_IAS_NO_PROHIBITED_PII,
    ):
        _assert_passes(schedule, check_id)

    for check_id in (
        CHECK_GLA_CATALOGUE_IS_FOCUSED,
        CHECK_GLA_CATEGORY_VOCABULARY,
        CHECK_GLA_CONTROL_FLAG_CONSISTENT,
        CHECK_GLA_SCHEMA_MATCHES,
        CHECK_GLA_UNIQUE_ACCOUNT_ID,
    ):
        _assert_passes(catalogue, check_id)

    for check_id in (
        CHECK_GLB_ACCOUNT_RESOLVES,
        CHECK_GLB_BALANCE_DATE_IS_MONTH_END,
        CHECK_GLB_SCHEMA_MATCHES,
        CHECK_GLB_UNIQUE_GRAIN,
    ):
        _assert_passes(balances, check_id)


# --------------------------------------------------------------------------------------
# DEFECT 1 — the book-value identity, broken by one cent
# --------------------------------------------------------------------------------------


def test_defect_01_one_cent_breaks_the_book_value_identity(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The identity is exact and per line. One cent on one unit must fail it.

    This is the defect the whole domain rests on: if the identity could absorb a cent,
    every carrying amount in the subledger would be an approximation and the GL
    reconciliation would be comparing two guesses.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "current_book_value"] = frame.loc[
            frame.index[0], "current_book_value"
        ] + Decimal("0.01")
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_BOOK_VALUE_IDENTITY, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 2 — floorplan principal folded into book value
# --------------------------------------------------------------------------------------


def test_defect_02_floorplan_folded_into_book_value_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A liability capitalized INTO a component, with the identity kept closed.

    This is the single most plausible way the domain goes wrong, because the result looks
    like a bigger, more impressive inventory figure and the book-value identity can be
    made to close around it. The defect is seeded into `capitalized_reconditioning` rather
    than added to the total precisely so the identity check cannot see it: `DQ-IAS-014`
    asks the separate question -- does any component carry the advance -- which is why it
    exists apart from the identity check.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame.index[frame["floorplan_principal"] > Decimal("0.00")][0]
        principal = frame.loc[row, "floorplan_principal"]
        previous = frame.loc[row, "capitalized_reconditioning"]
        frame.loc[row, "capitalized_reconditioning"] = principal
        frame.loc[row, "current_book_value"] = (
            frame.loc[row, "current_book_value"] - previous + principal
        )
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    # The identity still closes -- that is the point of this defect.
    _assert_passes(report, CHECK_IAS_BOOK_VALUE_IDENTITY)
    _assert_fails(report, CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK)


# --------------------------------------------------------------------------------------
# DEFECT 3 — other capitalized costs used as a balancing plug
# --------------------------------------------------------------------------------------


def test_defect_03_a_balancing_plug_in_other_capitalized_costs_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A residual absorbed into the one column with no external meaning.

    A plug makes an identity close by construction rather than by being true, so the
    identity check cannot catch it. `DQ-IAS-019` constrains the column to the values the
    governed rules actually produce.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame.index[0]
        frame.loc[row, "other_capitalized_costs"] = Decimal("137.42")
        frame.loc[row, "current_book_value"] = (
            frame.loc[row, "acquisition_cost"]
            + frame.loc[row, "capitalized_transportation"]
            + frame.loc[row, "capitalized_reconditioning"]
            + frame.loc[row, "capitalized_accessories"]
            + Decimal("137.42")
            - frame.loc[row, "write_down_amount"]
        )
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_passes(report, CHECK_IAS_BOOK_VALUE_IDENTITY)
    _assert_fails(report, CHECK_IAS_OTHER_COSTS_NOT_A_PLUG, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 4 — a negative capitalized component
# --------------------------------------------------------------------------------------


def test_defect_04_a_negative_capitalized_component_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """A negative cost is not a cost, and the identity closes just as neatly around it."""

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame.index[0]
        frame.loc[row, "capitalized_reconditioning"] = Decimal("-250.00")
        frame.loc[row, "current_book_value"] = (
            frame.loc[row, "acquisition_cost"]
            + frame.loc[row, "capitalized_transportation"]
            + Decimal("-250.00")
            + frame.loc[row, "capitalized_accessories"]
            + frame.loc[row, "other_capitalized_costs"]
            - frame.loc[row, "write_down_amount"]
        )
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_passes(report, CHECK_IAS_BOOK_VALUE_IDENTITY)
    _assert_fails(report, CHECK_IAS_COMPONENTS_NONNEGATIVE, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 5 — a negative write-down, which is a write-UP
# --------------------------------------------------------------------------------------


def test_defect_05_a_negative_write_down_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """ARPI models impairment, never appreciation. A negative write-down is a write-up."""

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame.index[0]
        frame.loc[row, "write_down_amount"] = Decimal("-500.00")
        frame.loc[row, "current_book_value"] = (
            frame.loc[row, "acquisition_cost"]
            + frame.loc[row, "capitalized_transportation"]
            + frame.loc[row, "capitalized_reconditioning"]
            + frame.loc[row, "capitalized_accessories"]
            + frame.loc[row, "other_capitalized_costs"]
            + Decimal("500.00")
        )
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_passes(report, CHECK_IAS_BOOK_VALUE_IDENTITY)
    _assert_fails(report, CHECK_IAS_WRITE_DOWN_NONNEGATIVE, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 6 — a duplicated schedule line
# --------------------------------------------------------------------------------------


def test_defect_06_a_duplicated_schedule_grain_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """One unit twice on one date would count its carrying amount twice.

    That manufactures a GL variance that is not there, which is worse than an obviously
    missing row: the reconciliation reports a real-looking difference with no cause.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        duplicate = frame.iloc[[0]].copy(deep=True)
        duplicate["inventory_accounting_id"] = "IAS-99999999"
        return pd.concat([frame, duplicate], ignore_index=True)

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_UNIQUE_GRAIN)


# --------------------------------------------------------------------------------------
# DEFECT 7 — a control category outside the governed domain
# --------------------------------------------------------------------------------------


def test_defect_07_a_wholesale_control_category_is_rejected(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The category that was considered and rejected, seeded as the defect it would be.

    `Wholesale Inventory` is not in the governed domain, because nothing observable at a
    month-end distinguishes a unit held for wholesale -- only the eventual disposal would,
    and reading it would be future-outcome leakage. A schedule line that claimed the
    category anyway must fail rather than quietly route carrying amount to an account that
    does not exist.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "control_account_category"] = "Wholesale Inventory"
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_CONTROL_CATEGORY_VALID, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 8 — days in stock disagreeing with its own two dates
# --------------------------------------------------------------------------------------


def test_defect_08_days_in_stock_that_disagrees_with_its_dates_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """`KPI-ACC-011` is this column. A drifted value makes the posting lag unverifiable.

    It matters more since the warehouse stopped carrying an acquisition date key: the
    derived duration is the only record of the interval, so the check that proves it IS
    the derivation is the only thing standing behind the measure.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "days_in_stock"] = (
            int(frame.loc[frame.index[0], "days_in_stock"]) + 7
        )
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_DAYS_IN_STOCK_AGREES, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 9 — a float in a monetary column
# --------------------------------------------------------------------------------------


def test_defect_09_a_float_in_a_monetary_column_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The defect the exact-decimal contract exists to prevent.

    A float that happens to print as a clean amount is the worst version of this: it
    reconciles today and drifts a cent after the next aggregation.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame["acquisition_cost"] = frame["acquisition_cost"].astype(object)
        frame.loc[frame.index[0], "acquisition_cost"] = 18500.10
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_EXACT_PRECISION)


# --------------------------------------------------------------------------------------
# DEFECT 10 — a prohibited column on the schedule
# --------------------------------------------------------------------------------------


def test_defect_10_a_customer_column_on_the_schedule_is_caught(
    accounting_dataset: GeneratedDataset, test_config: ArpiConfig
) -> None:
    """The accounting layer is where a real dealership's most sensitive data lives.

    The column is seeded EMPTY, because a column that exists will eventually be populated
    and the schema is what has to be refused.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame["customer_name"] = ""
        return frame

    report = validate_inventory_accounting_dataset(
        _mutated(accounting_dataset, mutate), test_config
    )
    _assert_fails(report, CHECK_IAS_NO_PROHIBITED_PII)


# --------------------------------------------------------------------------------------
# DEFECT 11 — the catalogue starting to become a chart of accounts
# --------------------------------------------------------------------------------------


def test_defect_11_a_general_ledger_account_name_is_caught(
    gl_account_dataset: GeneratedDataset,
) -> None:
    """`DQ-GLA-009` scans NAMES, so a mislabelled row cannot slip past the category CHECK.

    ARPI is building a focused inventory control schedule and is not building a general
    ledger. A `Cost of Sales` account is where that boundary gets breached first, because
    a longer catalogue looks more impressive and proves less.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "account_name"] = "Vehicle Cost of Sales Control"
        return frame

    report = validate_gl_account_dataset(_mutated(gl_account_dataset, mutate))
    _assert_fails(report, CHECK_GLA_CATALOGUE_IS_FOCUSED)


# --------------------------------------------------------------------------------------
# DEFECT 12 — an account category outside the governed vocabulary
# --------------------------------------------------------------------------------------


def test_defect_12_an_account_category_outside_the_domain_is_caught(
    gl_account_dataset: GeneratedDataset,
) -> None:
    """The scope boundary, asked of the catalogue rather than of the schedule."""

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "account_category"] = "Accounts Payable"
        return frame

    report = validate_gl_account_dataset(_mutated(gl_account_dataset, mutate))
    _assert_fails(report, CHECK_GLA_CATEGORY_VOCABULARY)


# --------------------------------------------------------------------------------------
# DEFECT 13 — a control flag that contradicts its own category
# --------------------------------------------------------------------------------------


def test_defect_13_a_control_flag_contradicting_its_category_is_caught(
    gl_account_dataset: GeneratedDataset,
) -> None:
    """A flag that disagrees with the thing it summarises is worse than no flag at all.

    A consumer trusts it precisely because it looks authoritative, so an inventory control
    account marked as not being one would quietly drop a whole category out of any query
    that filtered on the flag.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "inventory_control_flag"] = False
        return frame

    report = validate_gl_account_dataset(_mutated(gl_account_dataset, mutate))
    _assert_fails(report, CHECK_GLA_CONTROL_FLAG_CONSISTENT)


# --------------------------------------------------------------------------------------
# DEFECT 14 — a balance naming an account the catalogue does not contain
# --------------------------------------------------------------------------------------


def test_defect_14_a_balance_for_an_unknown_account_is_caught(
    gl_balance_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """An account outside the catalogue is a SCOPE BREACH, not a lookup miss.

    The catalogue's category domain is what keeps a general-ledger account out of the
    balance fact; a balance that named one would route around that boundary entirely.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        frame.loc[frame.index[0], "gl_account_id"] = "GLA-4010"
        return frame

    report = validate_gl_control_balance_dataset(
        _mutated(gl_balance_dataset, mutate), test_config, gl_account_dataset
    )
    _assert_fails(report, CHECK_GLB_ACCOUNT_RESOLVES, expected_failures=1)


# --------------------------------------------------------------------------------------
# DEFECT 15 — a mid-month control balance
# --------------------------------------------------------------------------------------


def test_defect_15_a_mid_month_balance_date_is_caught(
    gl_balance_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """Matched-date comparability is structural, and this is the check that keeps it so.

    Comparing a month-end control balance with a mid-month schedule and calling the
    difference a variance is the classic reconciliation error. It is prevented by both
    sides being month-end BY CONSTRUCTION -- so a balance that is not month-end has to
    fail here, or the whole guarantee is only a comment.
    """

    def mutate(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame.index[0]
        stated: date = frame.loc[row, "balance_date"]
        frame.loc[row, "balance_date"] = stated.replace(day=15)
        return frame

    report = validate_gl_control_balance_dataset(
        _mutated(gl_balance_dataset, mutate), test_config, gl_account_dataset
    )
    _assert_fails(report, CHECK_GLB_BALANCE_DATE_IS_MONTH_END, expected_failures=1)


# --------------------------------------------------------------------------------------
# The suite's own contract
# --------------------------------------------------------------------------------------


def test_the_committed_datasets_are_never_mutated(
    accounting_dataset: GeneratedDataset,
    gl_account_dataset: GeneratedDataset,
    gl_balance_dataset: GeneratedDataset,
    test_config: ArpiConfig,
) -> None:
    """Every defect above is applied to a copy, and this proves the copies held.

    Each fixture regenerates from the seed, so a mutation that had escaped ``_mutated``
    into the generator itself -- rather than into a per-test copy -- would surface here as
    a clean generation that no longer validates.
    """
    assert validate_inventory_accounting_dataset(accounting_dataset, test_config).passed
    assert validate_gl_account_dataset(gl_account_dataset).passed
    assert validate_gl_control_balance_dataset(
        gl_balance_dataset, test_config, gl_account_dataset
    ).passed
