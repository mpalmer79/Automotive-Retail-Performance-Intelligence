"""Generators for the selected synthetic GL control accounts and their balances.

WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT
---------------------------------------------
A **selected control-account catalogue** and the balances those accounts carry. Three
inventory asset control accounts, one per governed inventory control category, and one
balance per store per account per month-end.

It is not a chart of accounts. There is no Cash, no Sales Revenue, no Cost of Sales, no
Payroll, no Parts, no Service, no Rent, no Accounts Payable and no Receivables, because
answering ``SQ-43`` needs none of them and a padded catalogue would be a costume rather
than a model. A focused control catalogue that reconciles is worth more than a fake full
COA that does not.

FLOORPLAN LIABILITY IS NOT IN THE CATALOGUE, AND THAT IS A DECISION
-------------------------------------------------------------------
``fact_inventory_accounting_snapshot`` carries ``floorplan_principal``, so a Floorplan
Liability control account is *available* to model. It is deliberately not created.

``KPI-ACC-001`` is an inventory ASSET subledger measure. Putting a liability into the same
reconciliation invites exactly one mistake -- netting the two into a "net inventory"
figure that means nothing and that no controller would recognise -- and the increment has
no registered question that requires liability reconciliation. Floorplan principal stays
on the stock-level schedule as liability CONTEXT, which is what it is.

If a later increment adds one, it must be a separate liability class reconciling against
``SUM(floorplan_principal)``, never against ``current_book_value``, and it must never
enter ``KPI-ACC-001``. ``tests/integration/test_gl_control.py`` asserts the inventory
control set contains no liability account today.

THE HONESTY RULE ABOUT WHAT AN EXACT RECONCILIATION PROVES
----------------------------------------------------------
These balances are GENERATED from the same subledger they are reconciled against, plus a
governed table of deliberate variances. That is what makes the reconciliation surface
demonstrable: most positions tie exactly, a controlled few do not, and both states can be
seen working.

It is **not** an independently ingested second accounting system. An exact reconciliation
here proves the reconciliation arithmetic is correct; it does not prove that two
independent sources agree, because there is only one source. Every document that shows
this figure says so, and ``LIMITATIONS.md`` records it.

THE SCENARIO TABLE IS NOT AN ANSWER KEY
---------------------------------------
:data:`VARIANCE_SCENARIOS` exists to GENERATE testable data. Nothing in the reporting
layer reads it. ``reporting.vw_inventory_gl_reconciliation`` computes the variance
independently as ``GL balance - subledger balance`` from the two facts, so a scenario
table that disagreed with the data would surface as a wrong number rather than being
quietly honoured.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

import pandas as pd

from arpi.config import ArpiConfig
from arpi.constants import INVENTORY_CONTROL_CATEGORIES
from arpi.generation.base import BaseGenerator, GeneratedDataset
from arpi.generation.inventory_accounting import (
    InventoryAccountingRecord,
    build_inventory_accounting_records,
)

LOGGER: Final = logging.getLogger(__name__)

ENTITY_DIM_GL_ACCOUNT: Final = "dim_gl_account"
ENTITY_GL_CONTROL_BALANCE: Final = "gl_control_balance"
GL_ACCOUNT_NAMESPACE: Final = "gl_account"
GL_BALANCE_NAMESPACE: Final = "gl_control_balance"
GL_SOURCE_SYSTEM: Final = "SYNTHETIC-DMS-GL"

# ---------------------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------------------
#: The selected control accounts, one per governed inventory control category.
#:
#: Account numbers follow a conventional dealership inventory block (12xx) so the shape is
#: recognisable, and every one of them is INVENTED. No real dealer group's chart of
#: accounts was consulted, copied or approximated.
GL_ACCOUNT_DEFINITIONS: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("GLA-1210", "1210", "New Vehicle Inventory", "New Vehicle Inventory"),
    ("GLA-1220", "1220", "Used Vehicle Inventory", "Used Vehicle Inventory"),
    ("GLA-1230", "1230", "Certified Vehicle Inventory", "Certified Vehicle Inventory"),
)

GL_ACCOUNT_COLUMNS: Final[tuple[str, ...]] = (
    "gl_account_id",
    "account_number",
    "account_name",
    "account_category",
    "account_type",
    "normal_balance",
    "inventory_control_flag",
    "active_start_date",
    "active_end_date",
    "source_system",
)

GL_ACCOUNT_DTYPES: Final[dict[str, str]] = {
    "gl_account_id": "string",
    "account_number": "string",
    "account_name": "string",
    "account_category": "string",
    "account_type": "string",
    "normal_balance": "string",
    "inventory_control_flag": "boolean",
    "active_start_date": "datetime64[s]",
    "active_end_date": "object",
    "source_system": "string",
}

GL_BALANCE_COLUMNS: Final[tuple[str, ...]] = (
    "gl_control_balance_id",
    "dealership_id",
    "gl_account_id",
    "balance_date",
    "net_balance",
    "source_system",
)

GL_BALANCE_MONEY_COLUMNS: Final[tuple[str, ...]] = ("net_balance",)

GL_BALANCE_DTYPES: Final[dict[str, str]] = {
    "gl_control_balance_id": "string",
    "dealership_id": "string",
    "gl_account_id": "string",
    "balance_date": "datetime64[s]",
    "net_balance": "object",
    "source_system": "string",
}

#: The account each control category posts to.
CATEGORY_TO_ACCOUNT_ID: Final[Mapping[str, str]] = {
    definition[3]: definition[0] for definition in GL_ACCOUNT_DEFINITIONS
}


# ---------------------------------------------------------------------------------------
# Controlled variance scenarios -- one governed source, no scattered literals
# ---------------------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class VarianceScenario:
    """One deliberate difference between a control account and its subledger.

    Attributes:
        scenario_id: Stable identifier, recorded in documentation and asserted in tests.
        dealership_id: The store whose control account differs.
        category: The inventory control category.
        balance_date: The month-end the difference exists on.
        variance: Signed, in the KPI-ACC-003 direction -- GL minus subledger. Positive
            means the control account is HIGHER than the schedule.
        omit_gl: When true no GL balance row is written at all, which produces the
            ``Missing GL balance`` comparison state rather than a variance. A missing
            side is not a zero and must never be coalesced into one.
        orphan_gl: When set, a GL balance is written at a position the SUBLEDGER has no
            rows for, producing the mirror state -- ``Missing subledger balance``. This
            is the exception a controller actually hunts: a control account carrying a
            balance the schedule has nothing behind it. It is only reachable at a
            store/category the store genuinely does not stock, which is why it is
            planted rather than waited for.
    """

    scenario_id: str
    dealership_id: str
    category: str
    balance_date: date
    variance: Decimal
    omit_gl: bool = False
    orphan_gl: Decimal | None = None


#: The planted scenarios, declared once.
#:
#: Deliberately small. Most store/account/month positions reconcile exactly, because a
#: reconciliation surface where everything is broken teaches a reader nothing. Both signs
#: are represented so ``KPI-ACC-003``'s group rollup can be proved to sum SIGNED values
#: rather than absolute ones, and one position omits the GL side so the missing-side
#: behaviour exists in committed data rather than only in a test.
#:
#: These are synthetic demonstration conditions. They are not discovered business findings
#: and no document may describe them as such.
VARIANCE_SCENARIOS: Final[tuple[VarianceScenario, ...]] = (
    VarianceScenario(
        scenario_id="ACC-SCN-001",
        dealership_id="GSA-001",
        category="Used Vehicle Inventory",
        balance_date=date(2025, 9, 30),
        variance=Decimal("1250.00"),
    ),
    VarianceScenario(
        scenario_id="ACC-SCN-002",
        dealership_id="GSA-002",
        category="New Vehicle Inventory",
        balance_date=date(2025, 10, 31),
        variance=Decimal("-865.40"),
    ),
    VarianceScenario(
        scenario_id="ACC-SCN-003",
        dealership_id="GSA-003",
        category="Certified Vehicle Inventory",
        balance_date=date(2025, 11, 30),
        variance=Decimal("412.75"),
    ),
    VarianceScenario(
        scenario_id="ACC-SCN-004",
        dealership_id="GSA-002",
        category="Certified Vehicle Inventory",
        balance_date=date(2025, 8, 31),
        variance=Decimal("0.00"),
        omit_gl=True,
    ),
    VarianceScenario(
        scenario_id="ACC-SCN-005",
        dealership_id="GSA-003",
        category="New Vehicle Inventory",
        balance_date=date(2025, 12, 31),
        variance=Decimal("0.00"),
        orphan_gl=Decimal("18400.00"),
    ),
)


def scenario_for(dealership_id: str, category: str, balance_date: date) -> VarianceScenario | None:
    """The planted scenario at one position, or ``None`` when it should reconcile."""
    for scenario in VARIANCE_SCENARIOS:
        if (
            scenario.dealership_id == dealership_id
            and scenario.category == category
            and scenario.balance_date == balance_date
        ):
            return scenario
    return None


# ---------------------------------------------------------------------------------------
# The catalogue generator
# ---------------------------------------------------------------------------------------
def build_gl_account_rows(config: ArpiConfig) -> tuple[dict[str, Any], ...]:
    """Build the selected control-account catalogue.

    Args:
        config: Resolved configuration, supplying the window the accounts are active over.

    Returns:
        One row per selected control account, in declaration order.
    """
    return tuple(
        {
            "gl_account_id": account_id,
            "account_number": number,
            "account_name": name,
            "account_category": category,
            "account_type": "Asset",
            "normal_balance": "Debit",
            "inventory_control_flag": True,
            "active_start_date": config.reporting.start_date,
            "active_end_date": None,
            "source_system": GL_SOURCE_SYSTEM,
        }
        for account_id, number, name, category in GL_ACCOUNT_DEFINITIONS
    )


class GlAccountGenerator(BaseGenerator):
    """Build the selected synthetic GL control-account catalogue."""

    entity_name = ENTITY_DIM_GL_ACCOUNT
    declared_columns = GL_ACCOUNT_COLUMNS
    namespace = GL_ACCOUNT_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the catalogue frame."""
        frame = pd.DataFrame.from_records(
            list(build_gl_account_rows(config)), columns=list(GL_ACCOUNT_COLUMNS)
        )
        return frame.astype(GL_ACCOUNT_DTYPES)


def generate_gl_account_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the dataset feeding ``warehouse.dim_gl_account``."""
    return GlAccountGenerator().generate(config)


# ---------------------------------------------------------------------------------------
# The balance generator
# ---------------------------------------------------------------------------------------
def subledger_totals(
    records: Sequence[InventoryAccountingRecord],
) -> dict[tuple[str, str, date], Decimal]:
    """Sum book value by store, control category and accounting date.

    This is the subledger side of the reconciliation, computed here so the GL side can be
    generated to agree with it except where a scenario says otherwise.

    Args:
        records: Every accounting snapshot.

    Returns:
        The exact total at each position.
    """
    totals: dict[tuple[str, str, date], Decimal] = {}
    for record in records:
        key = (record.dealership_id, record.control_account_category, record.accounting_date)
        totals[key] = totals.get(key, Decimal("0.00")) + record.current_book_value
    return totals


def build_gl_balance_rows(
    config: ArpiConfig, catalogue_path: Path | None = None
) -> tuple[dict[str, Any], ...]:
    """Build one control balance per store, account and month-end.

    Args:
        config: Resolved configuration.
        catalogue_path: Explicit vehicle model catalogue path.

    Returns:
        The balance rows, ordered by the declared grain.
    """
    records = build_inventory_accounting_records(config, catalogue_path)
    totals = subledger_totals(records)

    rows: list[dict[str, Any]] = []
    ordinal = 0
    # A GL balance with no subledger behind it. Emitted first so the ordering below stays
    # keyed on the subledger positions rather than on scenario bookkeeping.
    orphans: dict[tuple[str, str, date], Decimal] = {
        (planted.dealership_id, planted.category, planted.balance_date): planted.orphan_gl
        for planted in VARIANCE_SCENARIOS
        if planted.orphan_gl is not None
    }
    for (dealership_id, category, balance_date), amount in sorted(orphans.items()):
        if not (config.reporting.start_date <= balance_date <= config.reporting.end_date):
            # The scenarios are dated against the committed development window. A shorter
            # profile simply does not reach them, and planting a balance outside the
            # window would land on a date `dim_date` does not carry.
            continue
        if (dealership_id, category, balance_date) in totals:
            raise ValueError(
                f"a scenario plants an orphan GL balance at {dealership_id}/{category}/"
                f"{balance_date}, a position the subledger DOES carry, so it would read "
                "as a variance rather than as a missing subledger side"
            )
        ordinal += 1
        rows.append(
            {
                "gl_control_balance_id": f"GLB-{ordinal:08d}",
                "dealership_id": dealership_id,
                "gl_account_id": CATEGORY_TO_ACCOUNT_ID[category],
                "balance_date": balance_date,
                "net_balance": amount.quantize(Decimal("0.01")),
                "source_system": GL_SOURCE_SYSTEM,
            }
        )
    for (dealership_id, category, balance_date), subledger in sorted(
        totals.items(), key=lambda item: (item[0][2], item[0][0], item[0][1])
    ):
        scenario = scenario_for(dealership_id, category, balance_date)
        if scenario is not None and scenario.orphan_gl is not None:
            continue
        if scenario is not None and scenario.omit_gl:
            # No row at all. The reconciliation must report a missing GL side rather than
            # a zero balance, and the only way to test that is for the row to be absent.
            continue
        variance = scenario.variance if scenario is not None else Decimal("0.00")
        ordinal += 1
        rows.append(
            {
                "gl_control_balance_id": f"GLB-{ordinal:08d}",
                "dealership_id": dealership_id,
                "gl_account_id": CATEGORY_TO_ACCOUNT_ID[category],
                "balance_date": balance_date,
                "net_balance": (subledger + variance).quantize(Decimal("0.01")),
                "source_system": GL_SOURCE_SYSTEM,
            }
        )
    LOGGER.info(
        "gl control balances: %d row(s), %d planted scenario(s)",
        len(rows),
        len(VARIANCE_SCENARIOS),
    )
    return tuple(rows)


class GlControlBalanceGenerator(BaseGenerator):
    """Build one control balance per store per account per month-end."""

    entity_name = ENTITY_GL_CONTROL_BALANCE
    declared_columns = GL_BALANCE_COLUMNS
    namespace = GL_BALANCE_NAMESPACE

    def build_frame(self, config: ArpiConfig) -> pd.DataFrame:
        """Build the balance frame."""
        frame = pd.DataFrame.from_records(
            list(build_gl_balance_rows(config)), columns=list(GL_BALANCE_COLUMNS)
        )
        return frame.astype(GL_BALANCE_DTYPES)


def generate_gl_control_balance_dataset(config: ArpiConfig) -> GeneratedDataset:
    """Generate the dataset feeding ``warehouse.fact_gl_control_balance``."""
    return GlControlBalanceGenerator().generate(config)


__all__ = [
    "CATEGORY_TO_ACCOUNT_ID",
    "ENTITY_DIM_GL_ACCOUNT",
    "ENTITY_GL_CONTROL_BALANCE",
    "GL_ACCOUNT_COLUMNS",
    "GL_ACCOUNT_DEFINITIONS",
    "GL_BALANCE_COLUMNS",
    "INVENTORY_CONTROL_CATEGORIES",
    "VARIANCE_SCENARIOS",
    "VarianceScenario",
    "build_gl_account_rows",
    "build_gl_balance_rows",
    "generate_gl_account_dataset",
    "generate_gl_control_balance_dataset",
    "scenario_for",
    "subledger_totals",
]
