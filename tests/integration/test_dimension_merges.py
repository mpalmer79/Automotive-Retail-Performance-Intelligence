"""The dimension merge scripts are idempotent, and the SCD Type 2 path is correct.

These tests execute ``sql/03_dimensions/*_merge.sql`` exactly the way the Python
loader does: globbed, sorted by file name, and executed as whole-file
``cursor.execute()`` calls. If the merges stop working this way, these tests break
before production does.

Everything runs inside the ``db`` fixture's transaction and is rolled back, so the
tests can seed raw data freely without affecting each other.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

pytestmark = pytest.mark.integration


def _counts(cur: Any) -> tuple[int, int, int]:
    """(dim_date rows, dim_dealership rows, dim_dealership current rows)."""
    cur.execute(
        """
        SELECT
            (SELECT count(*) FROM warehouse.dim_date),
            (SELECT count(*) FROM warehouse.dim_dealership),
            (SELECT count(*) FROM warehouse.dim_dealership WHERE is_current)
        """
    )
    return tuple(int(v) for v in cur.fetchone())  # type: ignore[return-value]


def _current_ids_are_unique(cur: Any) -> bool:
    cur.execute(
        """
        SELECT count(*) = count(DISTINCT dealership_id)
        FROM warehouse.dim_dealership WHERE is_current
        """
    )
    return bool(cur.fetchone()[0])


# --------------------------------------------------------------------------------------
# Empty-source behaviour
# --------------------------------------------------------------------------------------


def test_merges_are_a_no_op_when_raw_is_empty(cursor: Any, run_merges: Any) -> None:
    """This is why the merges can sit inside the ordinary initialisation sequence."""
    assert _counts(cursor) == (0, 0, 0)
    run_merges(cursor)
    assert _counts(cursor) == (0, 0, 0)


# --------------------------------------------------------------------------------------
# dim_date
# --------------------------------------------------------------------------------------


def test_dim_date_merge_loads_the_staged_calendar(
    cursor: Any, seed_calendar: Any, run_merges: Any
) -> None:
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    cursor.execute("SELECT count(*) FROM staging.stg_calendar_date")
    staged = cursor.fetchone()[0]
    assert staged == 31

    run_merges(cursor)

    cursor.execute("SELECT count(*), min(full_date), max(full_date) FROM warehouse.dim_date")
    row_count, min_date, max_date = cursor.fetchone()
    assert row_count == 31
    assert str(min_date) == "2025-07-01"
    assert str(max_date) == "2025-07-31"


def test_dim_date_merge_is_idempotent(cursor: Any, seed_calendar: Any, run_merges: Any) -> None:
    """A second run with unchanged source must write zero rows, not rewrite them."""
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    run_merges(cursor)
    before = _counts(cursor)

    cursor.execute("SELECT xmin::text FROM warehouse.dim_date ORDER BY date_key")
    versions_before = [row[0] for row in cursor.fetchall()]

    run_merges(cursor)

    assert _counts(cursor) == before

    cursor.execute("SELECT xmin::text FROM warehouse.dim_date ORDER BY date_key")
    versions_after = [row[0] for row in cursor.fetchall()]
    assert versions_after == versions_before, (
        "unchanged rows were rewritten; the guard on ON CONFLICT DO UPDATE is not working"
    )


def test_dim_date_merge_applies_a_corrected_attribute(
    cursor: Any, seed_calendar: Any, run_merges: Any
) -> None:
    """dim_date is Type 1: a correction overwrites in place and adds no row."""
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    run_merges(cursor)

    cursor.execute(
        "SELECT holiday_name, is_selling_day FROM warehouse.dim_date WHERE date_key = 20250704"
    )
    assert cursor.fetchone() == ("Independence Day", False)

    # A second batch that reclassifies 4 July as an ordinary trading day.
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    cursor.execute(
        """
        UPDATE raw.calendar_date_load
        SET is_holiday = 'false', holiday_name = NULL,
            is_closure_holiday = 'false', is_selling_day = 'true'
        WHERE date_key = '20250704'
          AND load_batch_id = (
              SELECT load_batch_id FROM raw.calendar_date_load
              GROUP BY load_batch_id ORDER BY max(ingested_at) DESC, max(raw_record_id) DESC LIMIT 1
          )
        """
    )
    run_merges(cursor)

    cursor.execute(
        "SELECT holiday_name, is_selling_day FROM warehouse.dim_date WHERE date_key = 20250704"
    )
    assert cursor.fetchone() == (None, True)

    cursor.execute("SELECT count(*) FROM warehouse.dim_date")
    assert cursor.fetchone()[0] == 31, "a Type 1 correction must not add a row"


def test_staging_exposes_only_the_newest_batch(cursor: Any, seed_calendar: Any) -> None:
    seed_calendar(cursor, start_date="2025-07-01", end_date="2025-07-31")
    seed_calendar(cursor, start_date="2025-08-01", end_date="2025-08-31")

    cursor.execute("SELECT count(*), min(full_date), max(full_date) FROM staging.stg_calendar_date")
    row_count, min_date, max_date = cursor.fetchone()
    assert row_count == 31
    assert str(min_date) == "2025-08-01"
    assert str(max_date) == "2025-08-31"


# --------------------------------------------------------------------------------------
# dim_dealership — first load
# --------------------------------------------------------------------------------------


def test_dealership_merge_assigns_contract_surrogate_keys(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """A first load yields 1, 2, 3 in dealership_id order, as the contract fixes them."""
    seed_dealerships(cursor)
    run_merges(cursor)

    cursor.execute(
        "SELECT dealership_key, dealership_id FROM warehouse.dim_dealership ORDER BY dealership_key"
    )
    assert cursor.fetchall() == [(1, "GSA-001"), (2, "GSA-002"), (3, "GSA-003")]


def test_dealership_merge_writes_the_scd_sentinel(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_dealerships(cursor)
    run_merges(cursor)

    cursor.execute(
        """
        SELECT count(*)
        FROM warehouse.dim_dealership
        WHERE is_current AND expiration_date = DATE '9999-12-31'
        """
    )
    assert cursor.fetchone()[0] == 3


def test_dealership_merge_is_idempotent(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """Rerunning with an unchanged attribute_hash writes nothing at all."""
    seed_dealerships(cursor)
    run_merges(cursor)
    before = _counts(cursor)
    assert before[1:] == (3, 3)

    run_merges(cursor)
    run_merges(cursor)

    assert _counts(cursor) == before
    assert _current_ids_are_unique(cursor)


def test_dealership_merge_ignores_an_identical_second_batch(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """A fresh load batch with identical content is still a no-op."""
    seed_dealerships(cursor)
    run_merges(cursor)
    seed_dealerships(cursor)
    run_merges(cursor)

    assert _counts(cursor)[1:] == (3, 3)
    assert _current_ids_are_unique(cursor)


# --------------------------------------------------------------------------------------
# dim_dealership — SCD Type 2 change path
# --------------------------------------------------------------------------------------


def test_dealership_merge_expires_and_replaces_a_changed_store(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """A changed attribute_hash produces exactly one expired row and one new current row."""
    seed_dealerships(cursor)
    run_merges(cursor)
    assert _counts(cursor)[1:] == (3, 3)

    seed_dealerships(
        cursor,
        overrides={
            "GSA-002": {
                "store_name": "Granite Subaru of Manchester NH",
                "attribute_hash": "d" * 64,
            }
        },
    )
    run_merges(cursor)

    cursor.execute(
        """
        SELECT dealership_key, store_name, effective_date, expiration_date, is_current
        FROM warehouse.dim_dealership
        WHERE dealership_id = 'GSA-002'
        ORDER BY effective_date
        """
    )
    versions = cursor.fetchall()
    assert len(versions) == 2

    expired, current = versions
    assert expired[1] == "Granite Subaru of Manchester"
    assert expired[4] is False
    assert str(expired[3]) != "9999-12-31"

    assert current[1] == "Granite Subaru of Manchester NH"
    assert current[4] is True
    assert str(current[3]) == "9999-12-31"

    # The successor starts the day after its predecessor ended: no gap, no overlap.
    assert current[2] == expired[3] + dt.timedelta(days=1)

    # A brand-new surrogate key, above every key already issued.
    assert current[0] == 4

    # Total counts: four versions, still three live stores.
    assert _counts(cursor)[1:] == (4, 3)
    assert _current_ids_are_unique(cursor)


def test_dealership_scd_change_is_itself_idempotent(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """Rerunning after a Type 2 change must not create a third version."""
    seed_dealerships(cursor)
    run_merges(cursor)
    seed_dealerships(cursor, overrides={"GSA-002": {"attribute_hash": "d" * 64}})
    run_merges(cursor)
    after_change = _counts(cursor)

    run_merges(cursor)
    run_merges(cursor)

    assert _counts(cursor) == after_change
    assert _current_ids_are_unique(cursor)


def test_dealership_merge_adds_a_brand_new_store(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    seed_dealerships(cursor)
    run_merges(cursor)

    cursor.execute(
        """
        INSERT INTO raw.dealership_load (
            dealership_id, store_name, store_short_name, store_type, franchise_brand,
            city, state_code, market_region, opened_date, is_active, effective_date,
            expiration_date, is_current, attribute_hash, source_system,
            load_batch_id, source_file_name, source_row_number
        )
        VALUES ('GSA-004', 'Granite Ford of Concord', 'Granite Ford', 'Franchise New and Used',
                'Ford', 'Concord', 'NH', 'Southern New Hampshire', '2021-05-03', 'true',
                '2021-05-03', '9999-12-31', 'true', %s, 'arpi_synthetic_generator',
                gen_random_uuid(), 'dim_dealership.csv', 1)
        """,
        ("e" * 64,),
    )
    run_merges(cursor)

    cursor.execute(
        "SELECT dealership_key, is_current FROM warehouse.dim_dealership\n"
        "WHERE dealership_id = 'GSA-004'"
    )
    assert cursor.fetchall() == [(4, True)]
    assert _current_ids_are_unique(cursor)


def test_scd_timeline_check_passes_after_a_change(
    cursor: Any, seed_dealerships: Any, run_merges: Any
) -> None:
    """The SQL data-quality view agrees that the timeline is intact."""
    seed_dealerships(cursor)
    run_merges(cursor)
    seed_dealerships(cursor, overrides={"GSA-002": {"attribute_hash": "d" * 64}})
    run_merges(cursor)

    cursor.execute(
        "SELECT status, message FROM audit.vw_dq_referential WHERE check_id = 'DQ-REF-005'"
    )
    status, message = cursor.fetchone()
    assert status == "passed", message
