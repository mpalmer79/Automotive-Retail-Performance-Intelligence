"""Unit tests for the ``sale_event`` source generator.

These are the structural assertions: identifier formats, the two gross identities to the
cent, the derivation of ``is_retail``, date ordering, and role eligibility resolved
against the SCD Type 2 employee timeline. Distributional assertions -- sell-through,
negative-gross share, variance gap, seasonality -- live in
``tests/data_quality/test_sale_quality.py`` and run at ``development`` scale.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from arpi.config import ArpiConfig
from arpi.exceptions import GenerationError
from arpi.generation.acquisition import build_acquisition_records
from arpi.generation.employee import (
    JOB_ROLE_FINANCE_MANAGER,
    build_employee_assignments,
)
from arpi.generation.sale import (
    ALLOWED_SALE_TYPES,
    DESK_MANAGER_ROLES,
    MARKDOWN_INTERVAL_DAYS,
    MAXIMUM_MARKDOWN_STEPS,
    PACK_AMOUNT_BY_STORE,
    RETAIL_SALE_TYPES,
    SALE_EVENT_COLUMNS,
    SALE_TYPE_DEALER_TRADE,
    SALE_TYPE_LEASE,
    SALE_TYPE_WHOLESALE,
    SALESPERSON_FALLBACK_ROLES,
    SALESPERSON_ROLES,
    SaleRecord,
    build_sale_records,
    disposition_dates,
    front_end_gross_for,
    generate_sale_dataset,
    is_retail_for_sale_type,
    markdown_to_asking_price,
    pack_amount_for,
    sale_id_for,
    sale_links,
)

MONEY_FIELDS = (
    "sale_price",
    "original_asking_price",
    "final_asking_price",
    "acquisition_cost",
    "reconditioning_cost",
    "pack_amount",
    "front_end_gross",
    "back_end_gross",
    "total_gross",
    "trade_allowance",
    "trade_acv",
    "cash_down",
    "amount_financed",
)


@pytest.fixture
def sales(test_config: ArpiConfig) -> tuple[SaleRecord, ...]:
    """The finalized sale population for the ``test`` profile."""
    return build_sale_records(test_config)


def _role_on(config: ArpiConfig, employee_id: str, on_date: date) -> tuple[str, str] | None:
    """Resolve one employee's ``(dealership_id, job_role)`` on a date, or ``None``."""
    for assignment in build_employee_assignments(config):
        if assignment.employee_id != employee_id:
            continue
        if on_date < assignment.hire_date:
            return None
        if assignment.termination_date is not None and on_date > assignment.termination_date:
            return None
        if assignment.change_date is not None and on_date < assignment.change_date:
            return str(assignment.prior_dealership_id), str(assignment.prior_job_role)
        return assignment.dealership_id, assignment.job_role
    return None


# --------------------------------------------------------------------------------------
# Identifiers
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("ordinal", "expected"),
    [(1, "SLE-00000001"), (3_377, "SLE-00003377"), (99_999_999, "SLE-99999999")],
)
def test_sale_id_is_zero_padded_to_eight_digits(ordinal: int, expected: str) -> None:
    assert sale_id_for(ordinal) == expected


@pytest.mark.parametrize("ordinal", [0, -5, 100_000_000])
def test_sale_id_rejects_ordinals_outside_the_reserved_width(ordinal: int) -> None:
    with pytest.raises(GenerationError):
        sale_id_for(ordinal)


def test_sale_ids_are_sequential_and_chronological(sales: tuple[SaleRecord, ...]) -> None:
    assert [record.sale_id for record in sales] == [
        sale_id_for(index) for index in range(1, len(sales) + 1)
    ]
    dates = [record.sale_date for record in sales]
    assert dates == sorted(dates)


# --------------------------------------------------------------------------------------
# is_retail is derived, never drawn
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("sale_type", "expected"),
    [
        ("New Retail", True),
        ("Used Retail", True),
        ("Certified Retail", True),
        ("Lease", True),
        ("Wholesale", False),
        ("Dealer Trade", False),
    ],
)
def test_is_retail_is_a_total_function_of_sale_type(sale_type: str, expected: bool) -> None:
    assert is_retail_for_sale_type(sale_type) is expected


def test_is_retail_rejects_a_sale_type_outside_the_enumeration() -> None:
    with pytest.raises(GenerationError):
        is_retail_for_sale_type("Fleet Retail")


def test_the_declared_enumeration_and_the_retail_set_agree() -> None:
    assert RETAIL_SALE_TYPES < set(ALLOWED_SALE_TYPES)
    assert set(ALLOWED_SALE_TYPES) - RETAIL_SALE_TYPES == {
        SALE_TYPE_WHOLESALE,
        SALE_TYPE_DEALER_TRADE,
    }


def test_every_record_carries_the_derived_flag(sales: tuple[SaleRecord, ...]) -> None:
    for record in sales:
        assert record.sale_type in ALLOWED_SALE_TYPES
        assert record.is_retail is is_retail_for_sale_type(record.sale_type)


# --------------------------------------------------------------------------------------
# Exact decimal arithmetic
# --------------------------------------------------------------------------------------
def test_front_end_gross_is_exact_decimal_subtraction() -> None:
    assert front_end_gross_for(
        Decimal("20000.00"), Decimal("15000.01"), Decimal("1200.02"), Decimal("795.00")
    ) == Decimal("3004.97")


def test_front_end_gross_may_legitimately_be_negative() -> None:
    assert front_end_gross_for(
        Decimal("9000.00"), Decimal("9100.00"), Decimal("400.00"), Decimal("495.00")
    ) == Decimal("-995.00")


def test_both_gross_identities_hold_to_the_cent_on_every_row(
    sales: tuple[SaleRecord, ...],
) -> None:
    for record in sales:
        assert record.front_end_gross == (
            record.sale_price
            - record.acquisition_cost
            - record.reconditioning_cost
            - record.pack_amount
        ), record.sale_id
        assert record.total_gross == record.front_end_gross + record.back_end_gross


def test_every_monetary_value_is_a_quantized_decimal(sales: tuple[SaleRecord, ...]) -> None:
    for record in sales:
        for field in MONEY_FIELDS:
            value = getattr(record, field)
            assert isinstance(value, Decimal), field
            assert not isinstance(value, float), field
            assert value.as_tuple().exponent == -2, (record.sale_id, field, value)


def test_only_the_gross_columns_may_go_negative(sales: tuple[SaleRecord, ...]) -> None:
    non_negative = tuple(
        field for field in MONEY_FIELDS if field not in {"front_end_gross", "total_gross"}
    )
    for record in sales:
        for field in non_negative:
            assert getattr(record, field) >= 0, (record.sale_id, field)


def test_back_end_gross_is_zero_on_every_non_retail_transaction(
    sales: tuple[SaleRecord, ...],
) -> None:
    for record in sales:
        if not record.is_retail:
            assert record.back_end_gross == Decimal("0.00")
            assert record.cash_down == Decimal("0.00")
            assert record.amount_financed == Decimal("0.00")
            assert record.trade_allowance == Decimal("0.00")
            assert record.trade_acv == Decimal("0.00")


# --------------------------------------------------------------------------------------
# Pricing derivations
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("dealership_id", sorted(PACK_AMOUNT_BY_STORE))
def test_pack_is_a_property_of_the_store(dealership_id: str) -> None:
    assert pack_amount_for(dealership_id) == PACK_AMOUNT_BY_STORE[dealership_id]


def test_an_unknown_store_still_gets_a_pack() -> None:
    assert pack_amount_for("GSA-999") > 0


def test_a_fresh_unit_is_not_marked_down() -> None:
    asking = Decimal("25000.00")
    assert markdown_to_asking_price(asking, 0, "Used") == asking
    assert markdown_to_asking_price(asking, MARKDOWN_INTERVAL_DAYS - 1, "Used") == asking


def test_markdowns_accumulate_with_age_and_then_stop() -> None:
    asking = Decimal("25000.00")
    thirty = markdown_to_asking_price(asking, MARKDOWN_INTERVAL_DAYS, "Used")
    sixty = markdown_to_asking_price(asking, MARKDOWN_INTERVAL_DAYS * 2, "Used")
    assert thirty < asking
    assert sixty < thirty
    capped = markdown_to_asking_price(asking, MARKDOWN_INTERVAL_DAYS * MAXIMUM_MARKDOWN_STEPS, "Used")
    assert markdown_to_asking_price(asking, 3_650, "Used") == capped


def test_new_units_are_marked_down_more_gently_than_used_ones() -> None:
    asking = Decimal("40000.00")
    age = MARKDOWN_INTERVAL_DAYS * 3
    assert markdown_to_asking_price(asking, age, "New") > markdown_to_asking_price(
        asking, age, "Used"
    )


def test_the_final_asking_price_never_exceeds_the_original(
    sales: tuple[SaleRecord, ...],
) -> None:
    for record in sales:
        assert record.final_asking_price <= record.original_asking_price


# --------------------------------------------------------------------------------------
# Date ordering
# --------------------------------------------------------------------------------------
def test_no_vehicle_is_ever_sold_before_it_is_acquired(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    acquired = {
        record.vehicle_id: record.acquisition_date
        for record in build_acquisition_records(test_config)
    }
    for record in sales:
        assert record.sale_date >= acquired[record.vehicle_id], record.sale_id
        assert record.days_in_inventory_at_sale == (
            record.sale_date - acquired[record.vehicle_id]
        ).days
        assert record.days_in_inventory_at_sale >= 0


def test_delivery_is_never_before_the_sale(sales: tuple[SaleRecord, ...]) -> None:
    for record in sales:
        assert record.delivery_date >= record.sale_date


def test_every_sale_falls_inside_the_reporting_window(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    start = test_config.reporting.start_date
    end = test_config.reporting.end_date
    for record in sales:
        assert start <= record.sale_date <= end
        assert start <= record.delivery_date <= end


def test_warm_up_units_carry_their_full_age_into_days_in_inventory(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    """A unit acquired before the window opened must not have its age reset to day one."""
    span = (test_config.reporting.end_date - test_config.reporting.start_date).days
    assert max(record.days_in_inventory_at_sale for record in sales) > span


# --------------------------------------------------------------------------------------
# Customers
# --------------------------------------------------------------------------------------
def test_every_retail_sale_names_a_customer_and_no_wholesale_one_does(
    sales: tuple[SaleRecord, ...],
) -> None:
    for record in sales:
        if record.is_retail:
            assert record.customer_id is not None, record.sale_id
        else:
            assert record.customer_id is None, record.sale_id


def test_a_lease_is_retail_and_therefore_carries_a_customer(
    sales: tuple[SaleRecord, ...],
) -> None:
    leases = [record for record in sales if record.sale_type == SALE_TYPE_LEASE]
    assert all(record.customer_id is not None for record in leases)


# --------------------------------------------------------------------------------------
# Employee eligibility
# --------------------------------------------------------------------------------------
def test_a_finance_manager_is_never_recorded_as_the_salesperson(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    for record in sales:
        if record.salesperson_id is None:
            continue
        resolved = _role_on(test_config, record.salesperson_id, record.sale_date)
        assert resolved is not None, record.sale_id
        assert resolved[1] != JOB_ROLE_FINANCE_MANAGER, record.sale_id


def test_every_participant_held_an_eligible_role_at_the_selling_store(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    expectations = (
        ("salesperson_id", (*SALESPERSON_ROLES, *SALESPERSON_FALLBACK_ROLES)),
        ("desk_manager_id", DESK_MANAGER_ROLES),
        ("finance_manager_id", (JOB_ROLE_FINANCE_MANAGER,)),
    )
    for record in sales:
        for field, roles in expectations:
            employee_id = getattr(record, field)
            if employee_id is None:
                continue
            resolved = _role_on(test_config, employee_id, record.sale_date)
            assert resolved is not None, (record.sale_id, field)
            store, role = resolved
            assert store == record.dealership_id, (record.sale_id, field)
            assert role in roles, (record.sale_id, field, role)


def test_a_finance_manager_only_ever_appears_on_a_retail_deal(
    sales: tuple[SaleRecord, ...],
) -> None:
    for record in sales:
        if not record.is_retail:
            assert record.finance_manager_id is None


# --------------------------------------------------------------------------------------
# Not everything sells, and cancellations never appear
# --------------------------------------------------------------------------------------
def test_unsold_units_remain_so_the_inventory_snapshot_has_something_to_snapshot(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    acquisitions = build_acquisition_records(test_config)
    assert 0 < len(sales) < len(acquisitions)
    sold = {record.vehicle_id for record in sales}
    assert {record.vehicle_id for record in acquisitions} - sold


def test_no_vehicle_is_sold_twice(sales: tuple[SaleRecord, ...]) -> None:
    identifiers = [record.vehicle_id for record in sales]
    assert len(set(identifiers)) == len(identifiers)


def test_every_row_is_a_single_finalized_unit(test_config: ArpiConfig) -> None:
    frame = generate_sale_dataset(test_config).frame
    assert set(frame["unit_count"].tolist()) == {1}


# --------------------------------------------------------------------------------------
# Deferred attribution
# --------------------------------------------------------------------------------------
def test_lead_source_is_declared_but_left_to_the_attribution_generator(
    test_config: ArpiConfig,
) -> None:
    frame = generate_sale_dataset(test_config).frame
    assert "lead_source_id" in frame.columns
    assert frame["lead_source_id"].isna().all()


# --------------------------------------------------------------------------------------
# Helpers consumed by downstream generators
# --------------------------------------------------------------------------------------
def test_sale_links_expose_everything_an_attribution_generator_needs(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    links = sale_links(test_config)
    assert len(links) == len(sales)
    for link, record in zip(links, sales, strict=True):
        assert link.sale_id == record.sale_id
        assert link.sale_date == record.sale_date
        assert link.dealership_id == record.dealership_id
        assert link.customer_id == record.customer_id
        assert link.vehicle_id == record.vehicle_id
        assert link.vehicle_model_id == record.vehicle_model_id
        assert link.salesperson_id == record.salesperson_id
        assert link.is_retail == record.is_retail


def test_disposition_dates_cover_exactly_the_sold_units(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    dispositions = disposition_dates(test_config)
    assert dispositions == {record.vehicle_id: record.sale_date for record in sales}
    acquisitions = build_acquisition_records(test_config)
    assert set(dispositions) < {record.vehicle_id for record in acquisitions}


def test_a_disposition_never_precedes_its_own_acquisition(test_config: ArpiConfig) -> None:
    acquired = {
        record.vehicle_id: record.acquisition_date
        for record in build_acquisition_records(test_config)
    }
    for vehicle_id, sold_on in disposition_dates(test_config).items():
        assert sold_on >= acquired[vehicle_id]


# --------------------------------------------------------------------------------------
# Determinism
# --------------------------------------------------------------------------------------
def test_the_same_configuration_produces_the_identical_population(
    test_config: ArpiConfig,
) -> None:
    assert build_sale_records(test_config) == build_sale_records(test_config)


def test_the_dataset_declares_the_contract_columns_in_order(test_config: ArpiConfig) -> None:
    dataset = generate_sale_dataset(test_config)
    assert dataset.actual_columns == SALE_EVENT_COLUMNS
    assert dataset.schema_matches()
    assert dataset.entity_name == "sale_event"
    assert dataset.namespace == "sale_event"


def test_the_delivery_lag_is_bounded_by_the_window(
    sales: tuple[SaleRecord, ...], test_config: ArpiConfig
) -> None:
    for record in sales:
        assert record.delivery_date <= min(
            record.sale_date + timedelta(days=5), test_config.reporting.end_date
        )
