"""Data-quality checks for the inventory-accounting control domain (``DASH.8``).

THREE FAMILIES, THREE ENTITIES
------------------------------
``DQ-IAS``  ``fact_inventory_accounting_snapshot`` -- the stock-level schedule
``DQ-GLA``  ``dim_gl_account``                     -- the selected control catalogue
``DQ-GLB``  ``fact_gl_control_balance``            -- the control balances

WHAT A DQ CHECK IS FOR HERE, AND WHAT IT IS NOT
-----------------------------------------------
A data-quality check asks **"is this record structurally valid?"**. A reconciliation asks
**"do two valid representations agree?"**. The distinction is load-bearing in this domain
and is the single easiest thing to get wrong.

A planted GL variance is **valid data**. Both the control balance and the subledger row
are well-formed, correctly keyed, exactly typed and referentially sound; they simply do
not agree, which is the entire point of a reconciliation surface. None of the checks
below fails because a variance exists, and none of them may be made to. If a controlled
variance failed DQ, the pipeline would report broken data every time the demonstration
worked, and a reader would learn that a variance means a defect. It does not.

So: structural validity here, agreement in ``sql/08_validation``, and the two never
borrow each other's vocabulary.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from decimal import Decimal
from typing import Final

import pandas as pd

from arpi.config import ArpiConfig
from arpi.constants import (
    CHECK_CATEGORY_BUSINESS_RULE,
    CHECK_CATEGORY_COMPLETENESS,
    CHECK_CATEGORY_PRIVACY,
    CHECK_CATEGORY_REFERENTIAL,
    CHECK_CATEGORY_STRUCTURAL,
    CHECK_CATEGORY_UNIQUENESS,
    GL_ACCOUNT_TYPES,
    GL_NORMAL_BALANCES,
    INVENTORY_CONTROL_CATEGORIES,
)
from arpi.generation.base import GeneratedDataset
from arpi.generation.gl_control import (
    ENTITY_DIM_GL_ACCOUNT,
    ENTITY_GL_CONTROL_BALANCE,
    GL_ACCOUNT_COLUMNS,
    GL_BALANCE_COLUMNS,
    GL_SOURCE_SYSTEM,
)
from arpi.generation.inventory_accounting import (
    ACCOUNTING_SOURCE_SYSTEM,
    CERTIFICATION_COST,
    ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
    INVENTORY_ACCOUNTING_COLUMNS,
    INVENTORY_ACCOUNTING_MONEY_COLUMNS,
)
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
from arpi.validation.results import CheckResult, CheckSeverity, ValidationReport

# ---------------------------------------------------------------------------------------
# Check identifiers
# ---------------------------------------------------------------------------------------
CHECK_IAS_UNIQUE_GRAIN: Final = "DQ-IAS-001"
CHECK_IAS_SCHEMA_MATCHES: Final = "DQ-IAS-002"
CHECK_IAS_DEALERSHIP_PRESENT: Final = "DQ-IAS-003"
CHECK_IAS_VEHICLE_PRESENT: Final = "DQ-IAS-004"
CHECK_IAS_DATE_IN_WINDOW: Final = "DQ-IAS-005"
CHECK_IAS_ACCOUNTING_DATE_IS_MONTH_END: Final = "DQ-IAS-006"
CHECK_IAS_ACQUISITION_NOT_AFTER_ACCOUNTING: Final = "DQ-IAS-007"
CHECK_IAS_CONTROL_CATEGORY_VALID: Final = "DQ-IAS-008"
CHECK_IAS_COMPONENTS_NONNEGATIVE: Final = "DQ-IAS-009"
CHECK_IAS_WRITE_DOWN_NONNEGATIVE: Final = "DQ-IAS-010"
CHECK_IAS_BOOK_VALUE_IDENTITY: Final = "DQ-IAS-011"
CHECK_IAS_BOOK_VALUE_NONNEGATIVE: Final = "DQ-IAS-012"
CHECK_IAS_FLOORPLAN_NONNEGATIVE: Final = "DQ-IAS-013"
CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK: Final = "DQ-IAS-014"
CHECK_IAS_EXACT_PRECISION: Final = "DQ-IAS-015"
CHECK_IAS_DAYS_IN_STOCK_AGREES: Final = "DQ-IAS-016"
CHECK_IAS_SOURCE_SYSTEM: Final = "DQ-IAS-017"
CHECK_IAS_NO_PROHIBITED_PII: Final = "DQ-IAS-018"
CHECK_IAS_OTHER_COSTS_NOT_A_PLUG: Final = "DQ-IAS-019"

CHECK_GLA_UNIQUE_ACCOUNT_ID: Final = "DQ-GLA-001"
CHECK_GLA_SCHEMA_MATCHES: Final = "DQ-GLA-002"
CHECK_GLA_ACCOUNT_NUMBER_UNIQUE: Final = "DQ-GLA-003"
CHECK_GLA_CATEGORY_VOCABULARY: Final = "DQ-GLA-004"
CHECK_GLA_TYPE_VOCABULARY: Final = "DQ-GLA-005"
CHECK_GLA_NORMAL_BALANCE_VOCABULARY: Final = "DQ-GLA-006"
CHECK_GLA_CONTROL_FLAG_CONSISTENT: Final = "DQ-GLA-007"
CHECK_GLA_ACTIVE_DATES_ORDERED: Final = "DQ-GLA-008"
CHECK_GLA_CATALOGUE_IS_FOCUSED: Final = "DQ-GLA-009"
CHECK_GLA_SOURCE_SYSTEM: Final = "DQ-GLA-010"

CHECK_GLB_UNIQUE_GRAIN: Final = "DQ-GLB-001"
CHECK_GLB_SCHEMA_MATCHES: Final = "DQ-GLB-002"
CHECK_GLB_DEALERSHIP_PRESENT: Final = "DQ-GLB-003"
CHECK_GLB_ACCOUNT_RESOLVES: Final = "DQ-GLB-004"
CHECK_GLB_DATE_IN_WINDOW: Final = "DQ-GLB-005"
CHECK_GLB_BALANCE_DATE_IS_MONTH_END: Final = "DQ-GLB-006"
CHECK_GLB_EXACT_PRECISION: Final = "DQ-GLB-007"
CHECK_GLB_SOURCE_SYSTEM: Final = "DQ-GLB-008"

#: Column-name fragments no accounting entity may carry.
#:
#: The accounting layer of a real dealership is where the most sensitive data in the
#: business lives -- customer finance files, employee pay, bank details, cheque numbers.
#: ARPI models none of it, and this check exists so that a future column cannot introduce
#: one under an innocuous name.
PROHIBITED_ACCOUNTING_FRAGMENTS: Final[tuple[str, ...]] = (
    "customer",
    "employee_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "address",
    "ssn",
    "social_security",
    "tax_id",
    "bank_account",
    "routing",
    "card_number",
    "check_number",
    "cheque_number",
    "invoice_image",
    "note",
    "comment",
    "memo",
    "narrative",
)


def _result(
    check_id: str, check_name: str, entity: str, frame: pd.DataFrame, category: str
) -> CheckResult:
    """A passing result over ``frame``, ready to be failed."""
    return CheckResult(
        check_id=check_id,
        check_name=check_name,
        target_object=entity,
        severity=CheckSeverity.CRITICAL,
        check_category=category,
        expected_value=float(frame.shape[0]),
        observed_value=float(frame.shape[0]),
    )


def _fail(base: CheckResult, message: str, failures: int, total: int) -> CheckResult:
    """Fail ``base`` with a count."""
    return base.failed(
        message, observed_value=float(total - failures), failed_record_count=failures
    )


def _is_month_end(value: pd.Timestamp) -> bool:
    """Whether a timestamp falls on the last day of its month."""
    return bool((value + pd.Timedelta(days=1)).day == 1)


#: The exponent an exact two-place ``Decimal`` reports. Named so the comparison below
#: reads as the cent-scale rule it is rather than as an unexplained integer.
CENT_EXPONENT: Final = -2


def _exact_cents(values: Iterable[object]) -> int:
    """Count values that are not exact two-place ``Decimal``s."""
    offenders = 0
    for value in values:
        if not isinstance(value, Decimal):
            offenders += 1
            continue
        exponent = value.as_tuple().exponent
        if not isinstance(exponent, int) or exponent != CENT_EXPONENT:
            offenders += 1
    return offenders


def _decimals(frame: pd.DataFrame, column: str) -> list[Decimal]:
    """One monetary column as exact ``Decimal``s.

    Pulled out as a typed list rather than read off ``itertuples``: a row tuple is
    untyped, so every arithmetic expression built from one is invisible to the type
    checker -- which is precisely the arithmetic worth checking in this module.
    """
    return [value if isinstance(value, Decimal) else Decimal("0.00") for value in frame[column]]


def _book_components(frame: pd.DataFrame) -> list[Decimal]:
    """The declared component sum for every row, in frame order.

    ``acquisition + transportation + reconditioning + accessories + other - write-down``.
    Floorplan principal is deliberately absent: it is a liability and never enters the
    asset identity.
    """
    acquisition = _decimals(frame, "acquisition_cost")
    transportation = _decimals(frame, "capitalized_transportation")
    reconditioning = _decimals(frame, "capitalized_reconditioning")
    accessories = _decimals(frame, "capitalized_accessories")
    other = _decimals(frame, "other_capitalized_costs")
    write_down = _decimals(frame, "write_down_amount")
    return [
        acquisition[index]
        + transportation[index]
        + reconditioning[index]
        + accessories[index]
        + other[index]
        - write_down[index]
        for index in range(frame.shape[0])
    ]


# ---------------------------------------------------------------------------------------
# DQ-IAS -- the stock-level accounting schedule
# ---------------------------------------------------------------------------------------
def _ias_grain(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-001`` -- one row per vehicle, store and accounting date."""
    base = _result(
        CHECK_IAS_UNIQUE_GRAIN,
        "fact_inventory_accounting_snapshot is unique on its declared grain",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_UNIQUENESS,
    )
    grain = ["dealership_id", "vehicle_id", "accounting_date"]
    duplicated = int(frame.duplicated(subset=grain).sum())
    if duplicated == 0:
        return base
    return _fail(
        base,
        f"{duplicated} row(s) repeat ({', '.join(grain)}), which would count one unit's "
        "book value twice in its control balance.",
        duplicated,
        frame.shape[0],
    )


def _ias_schema(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-002`` -- the column contract holds."""
    base = _result(
        CHECK_IAS_SCHEMA_MATCHES,
        "inventory accounting snapshot matches its declared column contract",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_STRUCTURAL,
    )
    if tuple(frame.columns) == INVENTORY_ACCOUNTING_COLUMNS:
        return base
    return base.failed(
        f"columns {tuple(frame.columns)} do not match the declared contract "
        f"{INVENTORY_ACCOUNTING_COLUMNS}.",
        observed_value=0.0,
        failed_record_count=frame.shape[0],
    )


def _ias_not_null(frame: pd.DataFrame, column: str, check_id: str, name: str) -> CheckResult:
    """A completeness check over one column."""
    base = _result(
        check_id, name, ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT, frame, CHECK_CATEGORY_COMPLETENESS
    )
    missing = int(frame[column].isna().sum()) + int((frame[column].astype("string") == "").sum())
    if missing == 0:
        return base
    return _fail(base, f"{missing} row(s) carry no {column}.", missing, frame.shape[0])


def _ias_date_in_window(frame: pd.DataFrame, config: ArpiConfig) -> CheckResult:
    """``DQ-IAS-005`` -- every accounting date is inside the reporting window."""
    base = _result(
        CHECK_IAS_DATE_IN_WINDOW,
        "accounting date falls inside the reporting window",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    start = pd.Timestamp(config.reporting.start_date)
    end = pd.Timestamp(config.reporting.end_date)
    outside = int(((frame["accounting_date"] < start) | (frame["accounting_date"] > end)).sum())
    if outside == 0:
        return base
    return _fail(
        base,
        f"{outside} row(s) carry an accounting date outside the reporting window, which "
        "could not resolve a date key.",
        outside,
        frame.shape[0],
    )


def _ias_month_end(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-006`` -- the accounting calendar is month-end."""
    base = _result(
        CHECK_IAS_ACCOUNTING_DATE_IS_MONTH_END,
        "accounting date is a month-end",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = int(sum(not _is_month_end(value) for value in frame["accounting_date"]))
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) are dated other than month-end. The accounting calendar is a "
        "subset of the inventory calendar; a mid-month schedule could not be compared "
        "with a month-end control balance.",
        offenders,
        frame.shape[0],
    )


def _ias_acquisition_order(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-007`` -- a unit is not booked before it was acquired."""
    base = _result(
        CHECK_IAS_ACQUISITION_NOT_AFTER_ACCOUNTING,
        "acquisition date is on or before the accounting date",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = int((frame["acquisition_date"] > frame["accounting_date"]).sum())
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) book a unit before it entered stock, which would make the "
        "posting lag negative.",
        offenders,
        frame.shape[0],
    )


def _ias_control_category(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-008`` -- every row resolves to exactly one governed control category."""
    base = _result(
        CHECK_IAS_CONTROL_CATEGORY_VALID,
        "control account category is one of the governed inventory categories",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = int((~frame["control_account_category"].isin(INVENTORY_CONTROL_CATEGORIES)).sum())
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) name a control category outside "
        f"{INVENTORY_CONTROL_CATEGORIES}. A unit scheduled into an account that does not "
        "exist is a balance nobody reconciles.",
        offenders,
        frame.shape[0],
    )


def _ias_components_nonnegative(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-009`` -- no capitalized component is negative."""
    base = _result(
        CHECK_IAS_COMPONENTS_NONNEGATIVE,
        "every capitalized component is non-negative",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    components = [
        "acquisition_cost",
        "capitalized_transportation",
        "capitalized_reconditioning",
        "capitalized_accessories",
        "other_capitalized_costs",
    ]
    offenders = sum(
        1 for column in components for value in _decimals(frame, column) if value < Decimal("0.00")
    )
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} negative capitalized component(s). A negative capitalized cost is a "
        "credit nobody modelled.",
        offenders,
        frame.shape[0],
    )


def _ias_write_down_nonnegative(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-010`` -- a write-down reduces, never adds."""
    base = _result(
        CHECK_IAS_WRITE_DOWN_NONNEGATIVE,
        "write-down amount is non-negative",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = sum(1 for value in _decimals(frame, "write_down_amount") if value < Decimal("0.00"))
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} negative write-down(s). A negative write-down is a write-UP, which "
        "this model does not support.",
        offenders,
        frame.shape[0],
    )


def _ias_book_identity(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-011`` -- the book-value identity holds exactly.

    THE HEADLINE CHECK OF THE DOMAIN. Exact equality, no tolerance: every component is an
    exact two-place ``Decimal``, so a penny difference is a defect and not a rounding
    artefact.
    """
    base = _result(
        CHECK_IAS_BOOK_VALUE_IDENTITY,
        "current book value equals its declared components exactly",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    expected = _book_components(frame)
    actual = _decimals(frame, "current_book_value")
    offenders = sum(1 for index in range(frame.shape[0]) if expected[index] != actual[index])
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) where acquisition + transportation + reconditioning + "
        "accessories + other - write-down does not equal current_book_value.",
        offenders,
        frame.shape[0],
    )


def _ias_book_nonnegative(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-012`` -- a unit is never carried at a negative value."""
    base = _result(
        CHECK_IAS_BOOK_VALUE_NONNEGATIVE,
        "current book value is non-negative",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = sum(
        1 for value in _decimals(frame, "current_book_value") if value < Decimal("0.00")
    )
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) carry a negative book value, which would subtract from the "
        "control balance rather than adding to it.",
        offenders,
        frame.shape[0],
    )


def _ias_floorplan_nonnegative(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-013`` -- floorplan principal is never negative."""
    base = _result(
        CHECK_IAS_FLOORPLAN_NONNEGATIVE,
        "floorplan principal is non-negative",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offenders = sum(
        1 for value in _decimals(frame, "floorplan_principal") if value < Decimal("0.00")
    )
    if offenders == 0:
        return base
    return _fail(base, f"{offenders} negative floorplan principal(s).", offenders, frame.shape[0])


#: The book components a floorplan balance could be smuggled into, and the one it cannot.
#:
#: ``acquisition_cost`` is deliberately absent. A new unit is floorplanned AT COST by rule,
#: so ``floorplan_principal == acquisition_cost`` is the ordinary, correct state on a large
#: share of the schedule and testing it would fail on clean data. Every other component is
#: derived from a rule that has nothing to do with the advance, so a component that equals
#: the principal is a liability that has been capitalized.
_FLOORPLAN_SMUGGLING_COLUMNS: Final[tuple[str, ...]] = (
    "capitalized_transportation",
    "capitalized_reconditioning",
    "capitalized_accessories",
    "other_capitalized_costs",
    "write_down_amount",
)


def _ias_floorplan_excluded(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-014`` -- floorplan principal is not inside book value.

    ASSERTED AS A PROPERTY OF THE DATA, not merely as a comment, and asked in the one way
    that is not already answered by the identity.

    ``DQ-IAS-011`` proves ``current_book_value`` equals the sum of its components. That
    catches a floorplan balance ADDED TO THE TOTAL -- but not one capitalized INTO a
    component, because the identity closes just as neatly around it. So this check asks
    the separate question: does any component carry the advance? A component equal to the
    floorplan principal is the shape that defect takes.

    Both failure modes are counted, because the first is still possible on a database
    whose constraint has been dropped.
    """
    base = _result(
        CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK,
        "floorplan principal is excluded from current book value",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    expected = _book_components(frame)
    actual = _decimals(frame, "current_book_value")
    floorplan = _decimals(frame, "floorplan_principal")
    components = {column: _decimals(frame, column) for column in _FLOORPLAN_SMUGGLING_COLUMNS}
    offenders = sum(
        1
        for index in range(frame.shape[0])
        if floorplan[index] != Decimal("0.00")
        and (
            actual[index] != expected[index]
            or any(values[index] == floorplan[index] for values in components.values())
        )
    )
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) whose book value moves with floorplan principal, or whose "
        "capitalized components carry the advance. Floorplan is a liability position and "
        "is never added to, subtracted from or netted against inventory value.",
        offenders,
        frame.shape[0],
    )


def _ias_precision(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-015`` -- every monetary value is an exact two-place ``Decimal``."""
    base = _result(
        CHECK_IAS_EXACT_PRECISION,
        "every accounting amount is an exact two-place Decimal",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_STRUCTURAL,
    )
    offenders = sum(
        _exact_cents(list(frame[column])) for column in INVENTORY_ACCOUNTING_MONEY_COLUMNS
    )
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} amount(s) are not exact two-place Decimals. A float in a monetary "
        "column is the defect the whole contract exists to prevent.",
        offenders,
        frame.shape[0],
    )


def _ias_other_costs_not_a_plug(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-019`` -- other capitalized costs are derived, never a balancing residual.

    ``other_capitalized_costs`` is the column a plug would hide in. Every other component
    of the book-value identity has an obvious external meaning, so a generator that could
    not make the identity close would be tempted to absorb the difference here -- and the
    identity check would pass, because a plug makes an identity close by construction.

    So the values are constrained to the ones the rule actually produces: ``0.00``, or the
    certification cost on a Certified unit. A residual would be neither.
    """
    base = _result(
        CHECK_IAS_OTHER_COSTS_NOT_A_PLUG,
        "other capitalized costs are derived from named rules, not a balancing residual",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    permitted = {Decimal("0.00"), CERTIFICATION_COST}
    offenders = sum(
        1 for amount in _decimals(frame, "other_capitalized_costs") if amount not in permitted
    )
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) carry an other-capitalized-cost that no governed rule "
        "produces. A value here that is neither 0.00 nor the certification cost is a "
        "balancing residual, and a plug makes the book-value identity close by "
        "construction rather than by being true.",
        offenders,
        frame.shape[0],
    )


def _ias_days_in_stock(frame: pd.DataFrame) -> CheckResult:
    """``DQ-IAS-016`` -- days in stock is the difference between the two dates."""
    base = _result(
        CHECK_IAS_DAYS_IN_STOCK_AGREES,
        "days in stock equals accounting date less acquisition date",
        ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    expected = (frame["accounting_date"] - frame["acquisition_date"]).dt.days
    offenders = int((expected != frame["days_in_stock"]).sum())
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) where days_in_stock disagrees with its own two dates, which "
        "would make the posting lag unverifiable.",
        offenders,
        frame.shape[0],
    )


def _source_system_check(
    frame: pd.DataFrame, entity: str, check_id: str, expected: str
) -> CheckResult:
    """Every row names the expected source system."""
    base = _result(
        check_id, f"every row is stamped {expected}", entity, frame, CHECK_CATEGORY_STRUCTURAL
    )
    offenders = int((frame["source_system"] != expected).sum())
    if offenders == 0:
        return base
    return _fail(base, f"{offenders} row(s) name another source system.", offenders, frame.shape[0])


def _prohibited_columns_check(frame: pd.DataFrame, entity: str, check_id: str) -> CheckResult:
    """No column name carries a prohibited fragment."""
    base = _result(
        check_id,
        "no accounting column names personal or confidential data",
        entity,
        frame,
        CHECK_CATEGORY_PRIVACY,
    )
    offending = sorted(
        column
        for column in frame.columns
        for fragment in PROHIBITED_ACCOUNTING_FRAGMENTS
        if fragment in column.lower()
    )
    if not offending:
        return base
    return base.failed(
        f"prohibited column name(s) {offending}. The accounting layer is where a real "
        "dealership's most sensitive data lives; ARPI models none of it.",
        observed_value=0.0,
        failed_record_count=len(offending),
    )


def validate_inventory_accounting_dataset(
    dataset: GeneratedDataset, config: ArpiConfig
) -> ValidationReport:
    """Run ``DQ-IAS-001`` through ``DQ-IAS-018``.

    Args:
        dataset: The generated accounting snapshot dataset.
        config: Resolved configuration, used to bound the accounting dates.

    Returns:
        A report containing eighteen results, in check-id order.
    """
    frame = dataset.frame
    return ValidationReport(
        (
            _ias_grain(frame),
            _ias_schema(frame),
            _ias_not_null(
                frame,
                "dealership_id",
                CHECK_IAS_DEALERSHIP_PRESENT,
                "every accounting snapshot names a store",
            ),
            _ias_not_null(
                frame,
                "vehicle_id",
                CHECK_IAS_VEHICLE_PRESENT,
                "every accounting snapshot names a vehicle",
            ),
            _ias_date_in_window(frame, config),
            _ias_month_end(frame),
            _ias_acquisition_order(frame),
            _ias_control_category(frame),
            _ias_components_nonnegative(frame),
            _ias_write_down_nonnegative(frame),
            _ias_book_identity(frame),
            _ias_book_nonnegative(frame),
            _ias_floorplan_nonnegative(frame),
            _ias_floorplan_excluded(frame),
            _ias_precision(frame),
            _ias_other_costs_not_a_plug(frame),
            _ias_days_in_stock(frame),
            _source_system_check(
                frame,
                ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
                CHECK_IAS_SOURCE_SYSTEM,
                ACCOUNTING_SOURCE_SYSTEM,
            ),
            _prohibited_columns_check(
                frame, ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT, CHECK_IAS_NO_PROHIBITED_PII
            ),
        )
    )


# ---------------------------------------------------------------------------------------
# DQ-GLA -- the selected control-account catalogue
# ---------------------------------------------------------------------------------------
#: Account categories a FULL chart of accounts would carry and this catalogue may not.
#:
#: The catalogue is deliberately focused. This check is the guard on that decision: a
#: future edit that started adding Cash, Payroll or Accounts Payable would be building a
#: general ledger, which ``DASH.8`` is explicitly not doing.
NON_CONTROL_ACCOUNT_FRAGMENTS: Final[tuple[str, ...]] = (
    "cash",
    "revenue",
    "cost of sales",
    "payroll",
    "wage",
    "parts",
    "service",
    "rent",
    "utilit",
    "payable",
    "receivable",
    "equity",
    "retained",
    "tax",
    "interest",
)


def _gla_unique(frame: pd.DataFrame, column: str, check_id: str, name: str) -> CheckResult:
    """A uniqueness check over one catalogue column."""
    base = _result(check_id, name, ENTITY_DIM_GL_ACCOUNT, frame, CHECK_CATEGORY_UNIQUENESS)
    duplicated = int(frame.duplicated(subset=[column]).sum())
    if duplicated == 0:
        return base
    return _fail(base, f"{duplicated} duplicate {column}(s).", duplicated, frame.shape[0])


def _gla_vocabulary(
    frame: pd.DataFrame, column: str, allowed: Sequence[str], check_id: str, name: str
) -> CheckResult:
    """A closed-vocabulary check over one catalogue column."""
    base = _result(check_id, name, ENTITY_DIM_GL_ACCOUNT, frame, CHECK_CATEGORY_BUSINESS_RULE)
    offenders = int((~frame[column].isin(list(allowed))).sum())
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} row(s) name a {column} outside {tuple(allowed)}.",
        offenders,
        frame.shape[0],
    )


def _gla_control_flag(frame: pd.DataFrame) -> CheckResult:
    """``DQ-GLA-007`` -- the control flag agrees with the category."""
    base = _result(
        CHECK_GLA_CONTROL_FLAG_CONSISTENT,
        "inventory control flag agrees with the account category",
        ENTITY_DIM_GL_ACCOUNT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    expected = frame["account_category"].isin(list(INVENTORY_CONTROL_CATEGORIES))
    offenders = int((frame["inventory_control_flag"].astype(bool) != expected).sum())
    if offenders == 0:
        return base
    return _fail(
        base,
        f"{offenders} account(s) whose control flag contradicts their category. A flag "
        "that disagrees with the thing it summarises is worse than no flag.",
        offenders,
        frame.shape[0],
    )


def _gla_active_dates(frame: pd.DataFrame) -> CheckResult:
    """``DQ-GLA-008`` -- an end date never precedes its start."""
    base = _result(
        CHECK_GLA_ACTIVE_DATES_ORDERED,
        "account active window is ordered",
        ENTITY_DIM_GL_ACCOUNT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    starts = list(frame["active_start_date"])
    ends = list(frame["active_end_date"])
    offenders = sum(
        1
        for index in range(frame.shape[0])
        if ends[index] is not None and not pd.isna(ends[index]) and ends[index] < starts[index]
    )
    if offenders == 0:
        return base
    return _fail(base, f"{offenders} account(s) end before they start.", offenders, frame.shape[0])


def _gla_focused(frame: pd.DataFrame) -> CheckResult:
    """``DQ-GLA-009`` -- the catalogue has not started becoming a chart of accounts."""
    base = _result(
        CHECK_GLA_CATALOGUE_IS_FOCUSED,
        "the catalogue contains only inventory control accounts",
        ENTITY_DIM_GL_ACCOUNT,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    offending = sorted(
        str(name)
        for name in frame["account_name"]
        for fragment in NON_CONTROL_ACCOUNT_FRAGMENTS
        if fragment in str(name).lower()
    )
    if not offending:
        return base
    return base.failed(
        f"account(s) {offending} belong to a general ledger rather than to a focused "
        "inventory control catalogue. DASH.8 builds a control schedule, not a GL.",
        observed_value=float(frame.shape[0] - len(offending)),
        failed_record_count=len(offending),
    )


def validate_gl_account_dataset(dataset: GeneratedDataset) -> ValidationReport:
    """Run ``DQ-GLA-001`` through ``DQ-GLA-010``.

    Args:
        dataset: The generated control-account catalogue.

    Returns:
        A report containing ten results, in check-id order.
    """
    frame = dataset.frame
    schema = _result(
        CHECK_GLA_SCHEMA_MATCHES,
        "gl account matches its declared column contract",
        ENTITY_DIM_GL_ACCOUNT,
        frame,
        CHECK_CATEGORY_STRUCTURAL,
    )
    if tuple(frame.columns) != GL_ACCOUNT_COLUMNS:
        schema = schema.failed(
            f"columns {tuple(frame.columns)} do not match {GL_ACCOUNT_COLUMNS}.",
            observed_value=0.0,
            failed_record_count=frame.shape[0],
        )
    return ValidationReport(
        (
            _gla_unique(
                frame,
                "gl_account_id",
                CHECK_GLA_UNIQUE_ACCOUNT_ID,
                "gl_account_id is unique",
            ),
            schema,
            _gla_unique(
                frame,
                "account_number",
                CHECK_GLA_ACCOUNT_NUMBER_UNIQUE,
                "account_number is unique",
            ),
            _gla_vocabulary(
                frame,
                "account_category",
                INVENTORY_CONTROL_CATEGORIES,
                CHECK_GLA_CATEGORY_VOCABULARY,
                "account category is a governed inventory control category",
            ),
            _gla_vocabulary(
                frame,
                "account_type",
                GL_ACCOUNT_TYPES,
                CHECK_GLA_TYPE_VOCABULARY,
                "account type is a governed type",
            ),
            _gla_vocabulary(
                frame,
                "normal_balance",
                GL_NORMAL_BALANCES,
                CHECK_GLA_NORMAL_BALANCE_VOCABULARY,
                "normal balance is Debit or Credit",
            ),
            _gla_control_flag(frame),
            _gla_active_dates(frame),
            _gla_focused(frame),
            _source_system_check(
                frame, ENTITY_DIM_GL_ACCOUNT, CHECK_GLA_SOURCE_SYSTEM, GL_SOURCE_SYSTEM
            ),
        )
    )


# ---------------------------------------------------------------------------------------
# DQ-GLB -- the control balances
# ---------------------------------------------------------------------------------------
def validate_gl_control_balance_dataset(
    dataset: GeneratedDataset, config: ArpiConfig, accounts: GeneratedDataset
) -> ValidationReport:
    """Run ``DQ-GLB-001`` through ``DQ-GLB-008``.

    A CONTROLLED VARIANCE IS NOT CHECKED HERE, AND MUST NOT BE. Every check below asks
    whether a balance row is structurally valid. Whether it AGREES with the subledger is
    a reconciliation question, answered in ``sql/08_validation`` and rendered by
    ``reporting.vw_inventory_gl_reconciliation``. A planted variance passes every check
    in this function, which is the intended behaviour.

    Args:
        dataset: The generated control balances.
        config: Resolved configuration, used to bound the balance dates.
        accounts: The generated catalogue, so account references can be resolved.

    Returns:
        A report containing eight results, in check-id order.
    """
    frame = dataset.frame
    known_accounts = set(accounts.frame["gl_account_id"])

    grain = _result(
        CHECK_GLB_UNIQUE_GRAIN,
        "fact_gl_control_balance is unique on its declared grain",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_UNIQUENESS,
    )
    duplicated = int(
        frame.duplicated(subset=["dealership_id", "gl_account_id", "balance_date"]).sum()
    )
    if duplicated:
        grain = _fail(
            grain,
            f"{duplicated} row(s) repeat (store, account, date), which would double a "
            "control balance and manufacture a variance that is not there.",
            duplicated,
            frame.shape[0],
        )

    schema = _result(
        CHECK_GLB_SCHEMA_MATCHES,
        "gl control balance matches its declared column contract",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_STRUCTURAL,
    )
    if tuple(frame.columns) != GL_BALANCE_COLUMNS:
        schema = schema.failed(
            f"columns {tuple(frame.columns)} do not match {GL_BALANCE_COLUMNS}.",
            observed_value=0.0,
            failed_record_count=frame.shape[0],
        )

    store = _result(
        CHECK_GLB_DEALERSHIP_PRESENT,
        "every control balance names a store",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_COMPLETENESS,
    )
    missing_store = int(frame["dealership_id"].isna().sum())
    if missing_store:
        store = _fail(
            store, f"{missing_store} row(s) name no store.", missing_store, frame.shape[0]
        )

    account = _result(
        CHECK_GLB_ACCOUNT_RESOLVES,
        "every control balance resolves to a catalogued account",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_REFERENTIAL,
    )
    unresolved = int((~frame["gl_account_id"].isin(known_accounts)).sum())
    if unresolved:
        account = _fail(
            account,
            f"{unresolved} row(s) reference an account the catalogue does not define.",
            unresolved,
            frame.shape[0],
        )

    start = pd.Timestamp(config.reporting.start_date)
    end = pd.Timestamp(config.reporting.end_date)
    window = _result(
        CHECK_GLB_DATE_IN_WINDOW,
        "balance date falls inside the reporting window",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    outside = int(((frame["balance_date"] < start) | (frame["balance_date"] > end)).sum())
    if outside:
        window = _fail(
            window, f"{outside} row(s) fall outside the window.", outside, frame.shape[0]
        )

    month_end = _result(
        CHECK_GLB_BALANCE_DATE_IS_MONTH_END,
        "balance date is a month-end",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_BUSINESS_RULE,
    )
    not_month_end = int(sum(not _is_month_end(value) for value in frame["balance_date"]))
    if not_month_end:
        month_end = _fail(
            month_end,
            f"{not_month_end} row(s) are dated other than month-end, so they could not be "
            "compared with a month-end schedule.",
            not_month_end,
            frame.shape[0],
        )

    precision = _result(
        CHECK_GLB_EXACT_PRECISION,
        "every control balance is an exact two-place Decimal",
        ENTITY_GL_CONTROL_BALANCE,
        frame,
        CHECK_CATEGORY_STRUCTURAL,
    )
    imprecise = _exact_cents(list(frame["net_balance"]))
    if imprecise:
        precision = _fail(
            precision,
            f"{imprecise} balance(s) are not exact two-place Decimals.",
            imprecise,
            frame.shape[0],
        )

    return ValidationReport(
        (
            grain,
            schema,
            store,
            account,
            window,
            month_end,
            precision,
            _source_system_check(
                frame, ENTITY_GL_CONTROL_BALANCE, CHECK_GLB_SOURCE_SYSTEM, GL_SOURCE_SYSTEM
            ),
        )
    )


# ---------------------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------------------
def _ias(check_id: str, name: str, category: str, description: str) -> CheckDefinition:
    return CheckDefinition(
        check_id=check_id,
        check_name=name,
        category=category,
        severity=CheckSeverity.CRITICAL,
        layer=CheckLayer.PYTHON,
        entity=ENTITY_INVENTORY_ACCOUNTING_SNAPSHOT,
        description=description,
        applies_to=("warehouse.fact_inventory_accounting_snapshot",),
    )


def _gla(check_id: str, name: str, category: str, description: str) -> CheckDefinition:
    return CheckDefinition(
        check_id=check_id,
        check_name=name,
        category=category,
        severity=CheckSeverity.CRITICAL,
        layer=CheckLayer.PYTHON,
        entity=ENTITY_DIM_GL_ACCOUNT,
        description=description,
        applies_to=("warehouse.dim_gl_account",),
    )


def _glb(check_id: str, name: str, category: str, description: str) -> CheckDefinition:
    return CheckDefinition(
        check_id=check_id,
        check_name=name,
        category=category,
        severity=CheckSeverity.CRITICAL,
        layer=CheckLayer.PYTHON,
        entity=ENTITY_GL_CONTROL_BALANCE,
        description=description,
        applies_to=("warehouse.fact_gl_control_balance",),
    )


register_checks(
    (
        _ias(
            CHECK_IAS_UNIQUE_GRAIN,
            "fact_inventory_accounting_snapshot is unique on its declared grain",
            CHECK_CATEGORY_UNIQUENESS,
            "Two rows for one unit on one accounting date would count its book value "
            "twice in the control balance and manufacture a variance.",
        ),
        _ias(
            CHECK_IAS_SCHEMA_MATCHES,
            "inventory accounting snapshot matches its declared column contract",
            CHECK_CATEGORY_STRUCTURAL,
            "A column added or reordered silently breaks the raw COPY column list.",
        ),
        _ias(
            CHECK_IAS_DEALERSHIP_PRESENT,
            "every accounting snapshot names a store",
            CHECK_CATEGORY_COMPLETENESS,
            "A schedule row with no store belongs to no control account.",
        ),
        _ias(
            CHECK_IAS_VEHICLE_PRESENT,
            "every accounting snapshot names a vehicle",
            CHECK_CATEGORY_COMPLETENESS,
            "The schedule is stock-level; a row with no unit is a balance with no asset.",
        ),
        _ias(
            CHECK_IAS_DATE_IN_WINDOW,
            "accounting date falls inside the reporting window",
            CHECK_CATEGORY_BUSINESS_RULE,
            "dim_date covers the reporting window and nothing else, so a date outside it "
            "could not resolve a key.",
        ),
        _ias(
            CHECK_IAS_ACCOUNTING_DATE_IS_MONTH_END,
            "accounting date is a month-end",
            CHECK_CATEGORY_BUSINESS_RULE,
            "The accounting calendar is a month-end subset of the inventory calendar. A "
            "mid-month schedule could not be compared with a month-end control balance.",
        ),
        _ias(
            CHECK_IAS_ACQUISITION_NOT_AFTER_ACCOUNTING,
            "acquisition date is on or before the accounting date",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A unit booked before it was acquired would make the posting lag negative.",
        ),
        _ias(
            CHECK_IAS_CONTROL_CATEGORY_VALID,
            "control account category is one of the governed inventory categories",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A unit scheduled into an account that does not exist is a balance nobody reconciles.",
        ),
        _ias(
            CHECK_IAS_COMPONENTS_NONNEGATIVE,
            "every capitalized component is non-negative",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A negative capitalized cost is a credit this model does not represent.",
        ),
        _ias(
            CHECK_IAS_WRITE_DOWN_NONNEGATIVE,
            "write-down amount is non-negative",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A negative write-down is a write-up, which the model does not support.",
        ),
        _ias(
            CHECK_IAS_BOOK_VALUE_IDENTITY,
            "current book value equals its declared components exactly",
            CHECK_CATEGORY_BUSINESS_RULE,
            "The headline identity of the domain, checked at exact equality because every "
            "component is an exact two-place Decimal.",
        ),
        _ias(
            CHECK_IAS_BOOK_VALUE_NONNEGATIVE,
            "current book value is non-negative",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A negative carrying value would subtract from a control balance.",
        ),
        _ias(
            CHECK_IAS_FLOORPLAN_NONNEGATIVE,
            "floorplan principal is non-negative",
            CHECK_CATEGORY_BUSINESS_RULE,
            "Principal owed is never negative in this model.",
        ),
        _ias(
            CHECK_IAS_FLOORPLAN_EXCLUDED_FROM_BOOK,
            "floorplan principal is excluded from current book value",
            CHECK_CATEGORY_BUSINESS_RULE,
            "The asset/liability boundary, asserted as a property of the data rather than "
            "left to a comment. Floorplan is never netted against inventory value.",
        ),
        _ias(
            CHECK_IAS_EXACT_PRECISION,
            "every accounting amount is an exact two-place Decimal",
            CHECK_CATEGORY_STRUCTURAL,
            "A float in a monetary column is the defect the whole contract prevents.",
        ),
        _ias(
            CHECK_IAS_DAYS_IN_STOCK_AGREES,
            "days in stock equals accounting date less acquisition date",
            CHECK_CATEGORY_BUSINESS_RULE,
            "KPI-ACC-011's posting lag is computed from these two dates; a days_in_stock "
            "that disagreed with them would make the lag unverifiable.",
        ),
        _ias(
            CHECK_IAS_SOURCE_SYSTEM,
            "every accounting row is stamped with the accounting source system",
            CHECK_CATEGORY_STRUCTURAL,
            "Provenance is recorded per row rather than assumed from the file it arrived in.",
        ),
        _ias(
            CHECK_IAS_NO_PROHIBITED_PII,
            "no accounting column names personal or confidential data",
            CHECK_CATEGORY_PRIVACY,
            "Dealership accounting is where the most sensitive data in the business lives. "
            "ARPI models none of it, and no free-text field exists for one to enter through.",
        ),
        _gla(
            CHECK_GLA_UNIQUE_ACCOUNT_ID,
            "gl_account_id is unique",
            CHECK_CATEGORY_UNIQUENESS,
            "Two accounts sharing an identifier would merge two control balances.",
        ),
        _gla(
            CHECK_GLA_SCHEMA_MATCHES,
            "gl account matches its declared column contract",
            CHECK_CATEGORY_STRUCTURAL,
            "A column added or reordered silently breaks the raw COPY column list.",
        ),
        _gla(
            CHECK_GLA_ACCOUNT_NUMBER_UNIQUE,
            "account_number is unique",
            CHECK_CATEGORY_UNIQUENESS,
            "An account number is how a controller refers to the account; two accounts "
            "sharing one is an ambiguity nobody can resolve.",
        ),
        _gla(
            CHECK_GLA_CATEGORY_VOCABULARY,
            "account category is a governed inventory control category",
            CHECK_CATEGORY_BUSINESS_RULE,
            "The catalogue is closed. A category outside the governed set is an account "
            "no subledger position maps to.",
        ),
        _gla(
            CHECK_GLA_TYPE_VOCABULARY,
            "account type is a governed type",
            CHECK_CATEGORY_BUSINESS_RULE,
            "Asset and Liability are the only types this domain models.",
        ),
        _gla(
            CHECK_GLA_NORMAL_BALANCE_VOCABULARY,
            "normal balance is Debit or Credit",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A third spelling would make the sign of a balance ambiguous.",
        ),
        _gla(
            CHECK_GLA_CONTROL_FLAG_CONSISTENT,
            "inventory control flag agrees with the account category",
            CHECK_CATEGORY_BUSINESS_RULE,
            "A flag that contradicts the thing it summarises is worse than no flag, "
            "because a consumer trusts it precisely for looking authoritative.",
        ),
        _gla(
            CHECK_GLA_ACTIVE_DATES_ORDERED,
            "account active window is ordered",
            CHECK_CATEGORY_BUSINESS_RULE,
            "An account that ends before it starts is active on no date at all.",
        ),
        _gla(
            CHECK_GLA_CATALOGUE_IS_FOCUSED,
            "the catalogue contains only inventory control accounts",
            CHECK_CATEGORY_BUSINESS_RULE,
            "The guard on the scope decision. Cash, Payroll, Payables and Receivables "
            "belong to a general ledger, which DASH.8 is explicitly not building.",
        ),
        _gla(
            CHECK_GLA_SOURCE_SYSTEM,
            "every account is stamped with the GL source system",
            CHECK_CATEGORY_STRUCTURAL,
            "Provenance is recorded per row.",
        ),
        _glb(
            CHECK_GLB_UNIQUE_GRAIN,
            "fact_gl_control_balance is unique on its declared grain",
            CHECK_CATEGORY_UNIQUENESS,
            "Two balances at one (store, account, date) would double the control side and "
            "manufacture a variance that is not there.",
        ),
        _glb(
            CHECK_GLB_SCHEMA_MATCHES,
            "gl control balance matches its declared column contract",
            CHECK_CATEGORY_STRUCTURAL,
            "A column added or reordered silently breaks the raw COPY column list.",
        ),
        _glb(
            CHECK_GLB_DEALERSHIP_PRESENT,
            "every control balance names a store",
            CHECK_CATEGORY_COMPLETENESS,
            "A balance with no store cannot be compared with a store's schedule.",
        ),
        _glb(
            CHECK_GLB_ACCOUNT_RESOLVES,
            "every control balance resolves to a catalogued account",
            CHECK_CATEGORY_REFERENTIAL,
            "A balance on an account nobody defined is a number with no meaning.",
        ),
        _glb(
            CHECK_GLB_DATE_IN_WINDOW,
            "balance date falls inside the reporting window",
            CHECK_CATEGORY_BUSINESS_RULE,
            "dim_date covers the reporting window and nothing else.",
        ),
        _glb(
            CHECK_GLB_BALANCE_DATE_IS_MONTH_END,
            "balance date is a month-end",
            CHECK_CATEGORY_BUSINESS_RULE,
            "Comparing a month-end control balance with a mid-month schedule and calling "
            "the difference a variance is the classic reconciliation error.",
        ),
        _glb(
            CHECK_GLB_EXACT_PRECISION,
            "every control balance is an exact two-place Decimal",
            CHECK_CATEGORY_STRUCTURAL,
            "A float in a monetary column is the defect the whole contract prevents.",
        ),
        _glb(
            CHECK_GLB_SOURCE_SYSTEM,
            "every control balance is stamped with the GL source system",
            CHECK_CATEGORY_STRUCTURAL,
            "Provenance is recorded per row.",
        ),
    )
)

__all__ = [
    "PROHIBITED_ACCOUNTING_FRAGMENTS",
    "validate_gl_account_dataset",
    "validate_gl_control_balance_dataset",
    "validate_inventory_accounting_dataset",
]
