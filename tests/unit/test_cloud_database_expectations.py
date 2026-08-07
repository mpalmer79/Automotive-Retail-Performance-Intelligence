"""``scripts/verify_cloud_database.py``'s expectations must match the repository's.

That script asserts exact counts against a live database: how many reporting views exist,
how many reconciliations a run records, which dimensions and facts must be present. Every
one of those numbers is **duplicated** from `arpi.constants` and `sql/`, because the
script imports only the standard library -- it is pointed at a cloud database from a bare
interpreter, with no `arpi` package installed.

Duplication is the right trade there and the wrong thing to leave unguarded. A number that
drifts turns an exact check into a false one in whichever direction it drifted: too high
and every correct deployment fails, too low and an extra object passes unnoticed.

This is where the two copies are compared. It cost a CI failure to learn: the listing lane
added six reporting views, the script still expected twenty-eight, and a fully correct
database was reported as not a faithful deployment.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import verify_cloud_database as verifier  # noqa: E402  (path set above)

from arpi.constants import (  # noqa: E402
    DASHBOARD_PROGRAM_VIEWS,
    INVENTORY_LISTING_VIEWS,
    MVP_REPORTING_VIEWS,
    REPORTING_VIEWS,
)


def test_the_mvp_view_count_matches_the_constant() -> None:
    assert len(MVP_REPORTING_VIEWS) == verifier.EXPECTED_MVP_REPORTING_VIEW_COUNT


def test_the_listing_lane_view_count_matches_the_constant() -> None:
    assert len(INVENTORY_LISTING_VIEWS) == verifier.EXPECTED_LISTING_REPORTING_VIEW_COUNT


def test_the_dashboard_lane_view_count_matches_the_constant() -> None:
    assert len(DASHBOARD_PROGRAM_VIEWS) == verifier.EXPECTED_DASHBOARD_REPORTING_VIEW_COUNT


def test_the_total_is_every_reporting_view_and_the_three_lanes_do_not_overlap() -> None:
    """The sum has to be the whole schema, or the exact check is not exact.

    Asserted against `REPORTING_VIEWS` rather than against the sum of the three lengths,
    which would pass even if a view were declared in two registers.
    """
    assert len(REPORTING_VIEWS) == verifier.EXPECTED_REPORTING_VIEW_COUNT
    assert set(MVP_REPORTING_VIEWS) & set(INVENTORY_LISTING_VIEWS) == set()
    assert set(MVP_REPORTING_VIEWS) & set(DASHBOARD_PROGRAM_VIEWS) == set()
    assert set(INVENTORY_LISTING_VIEWS) & set(DASHBOARD_PROGRAM_VIEWS) == set()


def test_the_reporting_view_count_matches_the_sql_that_creates_them() -> None:
    """Both registers are Python. The views are SQL, and that is the real authority.

    A view added to `sql/05_reporting/` and to neither register would satisfy every test
    above and still fail the cloud verifier against a database that is correct.
    """
    reporting = REPO_ROOT / "sql" / "05_reporting"
    scripts = [
        path
        for path in sorted(reporting.glob("*.sql"))
        if path.name[0].isdigit() and "scope" not in path.name
    ]
    assert len(scripts) == verifier.EXPECTED_REPORTING_VIEW_COUNT, (
        "sql/05_reporting/ creates "
        f"{len(scripts)} views and verify_cloud_database.py expects "
        f"{verifier.EXPECTED_REPORTING_VIEW_COUNT}"
    )


def test_the_expected_fact_tables_are_the_mvp_five_and_not_the_listing_fact() -> None:
    """The listing fact is deliberately absent from the cloud verifier's fact list.

    That list is checked for "exists and holds at least one row". The listing fact is
    loaded on a workbook cadence, not by the pipeline, so a correct cloud database can
    legitimately hold the table and no rows -- and requiring rows would fail a deployment
    for not having been handed a workbook.
    """
    assert "fact_vehicle_listing_snapshot" not in verifier.EXPECTED_FACT_TABLES
    assert len(verifier.EXPECTED_FACT_TABLES) == 5


def test_the_observed_vehicle_dimension_is_not_one_of_the_eight() -> None:
    """Same reason, and it is also not conformed. Eight means eight."""
    assert "dim_observed_vehicle" not in verifier.EXPECTED_DIMENSION_TABLES
    assert len(verifier.EXPECTED_DIMENSION_TABLES) == 8


def test_the_reconciliation_count_excludes_the_listing_lane() -> None:
    """`audit.vw_recon_all` is the pipeline's per-run set and the listing lane is not in it.

    The lane records its own reconciliations against its own `audit.pipeline_run` row on a
    workbook cadence. Adding them to a per-run count would make the expected number depend
    on how many workbooks somebody had imported.
    """
    assert verifier.EXPECTED_RECONCILIATION_COUNT_PER_RUN == 58


def test_no_listing_view_carries_an_expected_row_count() -> None:
    """A cloud database holds those views empty until somebody imports a workbook.

    The lane loads on a workbook cadence, not on a pipeline run. An expected row count
    here would fail a faithful deployment for the sole reason that nobody had handed it a
    capture -- and the fix somebody would reach for is to loosen the check for every view.
    """
    counted = set(verifier.EXPECTED_REPORTING_ROW_COUNTS) | set(
        verifier.EXPECTED_REPORTING_ROW_COUNTS_PER_RUN
    )
    assert {name for name in counted if name.startswith("vw_vehicle_listing_")} == set()
    for view in INVENTORY_LISTING_VIEWS:
        assert view not in counted
