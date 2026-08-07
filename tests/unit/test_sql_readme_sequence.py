"""``sql/README.md``'s execution-order table must name every file that actually runs.

That table calls itself "the authority for ordering", and it was not: it had drifted two
raw scripts, one staging script and the whole of ``09_migrations/`` behind the directory,
and claimed a total of 104 files for a sequence that ran more than that. Nothing failed,
because a stale ordinal in a document is invisible to every other check in the repository.

The failure mode this closes is specific and cheap to fall into. Someone adds a SQL script;
the sorted glob in ``tests/integration/conftest.py::init_sequence_files`` picks it up and
runs it, so the integration suite stays green; the README says nothing about it. A reader
following the documented order builds a database that is missing the script, and finds out
at the first query rather than at the first review.

These tests are deliberately structural. They assert that the set of files named in the
table equals the set of files the sequence executes, and that the stated total matches --
not that any particular description is well written, which is a judgement no test makes.
"""

from __future__ import annotations

import importlib.util
import re
from collections.abc import Callable
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SQL_README = REPO_ROOT / "sql" / "README.md"


def _load_init_sequence() -> Callable[[], list[Path]]:
    """Import the integration conftest's sequence builder, by path and under its own name.

    By path because ``tests/conftest.py`` already owns the importable name ``conftest``, and
    a plain import resolves to that one. From the integration conftest rather than a local
    copy because a second implementation of "what order do the scripts run in" is exactly
    the drift these tests exist to catch.
    """
    location = REPO_ROOT / "tests" / "integration" / "conftest.py"
    spec = importlib.util.spec_from_file_location("arpi_integration_conftest", location)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    builder: Callable[[], list[Path]] = module.init_sequence_files
    return builder


init_sequence_files = _load_init_sequence()

#: A table row: an ordinal or ordinal range, a file cell, a description. The file cell may
#: hold one path or a ``first … last`` range, which is why the paths are extracted from the
#: cell rather than assumed to be the whole of it. The en dash in the ordinal group is
#: written as an escape because the README's ranges really use one, and a plain hyphen
#: would not match them.
_ROW = re.compile("^\\|\\s*(\\d+(?:[-\u2013]\\d+)?)\\s*\\|(.+?)\\|", re.MULTILINE)

#: A backticked SQL reference inside a table cell. Range rows write their first endpoint as
#: a full path and their last as a bare file name -- ``01_vw_calendar.sql … 04_vw_....sql``
#: -- so both forms must match, and the bare one is resolved against the first's directory.
_PATH = re.compile(r"`([0-9A-Za-z_]+(?:/[0-9A-Za-z_]+)?\.sql)`")

#: "The sequence is **124 files** in total".
_TOTAL = re.compile(r"The sequence is \*\*(\d+) files\*\* in total")


def _readme() -> str:
    return SQL_README.read_text(encoding="utf-8")


def _table_rows() -> list[tuple[str, str]]:
    """Return the (ordinal, file-cell) pairs of the execution-order table."""
    return [(ordinal, cell) for ordinal, cell in _ROW.findall(_readme())]


def _documented_files() -> set[str]:
    """Every SQL path the table names, expanding ``first … last`` ranges by directory order.

    A range row such as ``59-63 | 04_facts/10_... … 14_...`` documents five files by naming
    two. Expanding it against the directory is what makes the row checkable: a file dropped
    into the middle of a documented range is caught, because the range's own ordinals stop
    matching the number of files between its endpoints.
    """
    documented: set[str] = set()
    sql_root = REPO_ROOT / "sql"

    for ordinal, cell in _table_rows():
        paths = _PATH.findall(cell)
        if not paths:
            continue
        if len(paths) == 1:
            documented.add(paths[0])
            continue

        first, last = paths[0], paths[-1]
        assert "/" in first, f"row {ordinal} opens a range without a directory"
        directory = Path(first).parent
        # The last endpoint is usually written bare; resolve it against the first's
        # directory. An endpoint that names a different directory is a malformed range.
        last_full = last if "/" in last else f"{directory.as_posix()}/{last}"
        assert Path(last_full).parent == directory, f"row {ordinal} spans two directories"
        siblings = sorted(
            p.relative_to(sql_root).as_posix() for p in (sql_root / directory).glob("*.sql")
        )
        start, end = siblings.index(first), siblings.index(last_full)
        assert start <= end, f"row {ordinal} runs backwards"
        documented.update(siblings[start : end + 1])

    return documented


def _executed_files() -> list[str]:
    return [p.relative_to(REPO_ROOT / "sql").as_posix() for p in init_sequence_files()]


def test_the_table_documents_every_file_the_sequence_executes() -> None:
    executed = set(_executed_files())
    documented = _documented_files()

    missing = sorted(executed - documented)
    assert not missing, (
        "sql/README.md's execution-order table does not name these scripts, which the "
        f"initialisation sequence runs: {missing}"
    )


def test_the_table_names_no_file_the_sequence_does_not_execute() -> None:
    executed = set(_executed_files())
    documented = _documented_files()

    phantom = sorted(documented - executed)
    assert not phantom, (
        "sql/README.md's execution-order table names scripts the initialisation sequence "
        f"does not run: {phantom}"
    )


def test_every_range_row_spans_as_many_files_as_its_ordinals_claim() -> None:
    """A range row is only honest if its ordinals count the files it covers.

    Set comparison alone cannot catch a file dropped into the middle of a documented range:
    expanding the range against the directory would silently absorb it. The ordinals are
    what notice. ``59-63`` covering six files is the same defect as an undocumented script,
    dressed as a row that is already there.
    """
    sql_root = REPO_ROOT / "sql"
    for ordinal, cell in _table_rows():
        paths = _PATH.findall(cell)
        if len(paths) < 2:
            continue
        low, _, high = ordinal.replace("\u2013", "-").partition("-")
        assert high, f"row {ordinal} names a range of files under a single ordinal"

        directory = Path(paths[0]).parent
        last = paths[-1] if "/" in paths[-1] else f"{directory.as_posix()}/{paths[-1]}"
        siblings = sorted(
            p.relative_to(sql_root).as_posix() for p in (sql_root / directory).glob("*.sql")
        )
        covered = siblings.index(last) - siblings.index(paths[0]) + 1
        assert covered == int(high) - int(low) + 1, (
            f"sql/README.md row {ordinal} claims {int(high) - int(low) + 1} files but its "
            f"endpoints span {covered} in {directory.as_posix()}/"
        )


def test_the_stated_total_matches_the_sequence() -> None:
    """The total counts *steps*, not distinct files: the grants script runs twice."""
    match = _TOTAL.search(_readme())
    assert match is not None, "sql/README.md no longer states a sequence total"
    assert int(match.group(1)) == len(_executed_files())


def test_the_excluded_files_are_named_and_really_are_excluded() -> None:
    """A file left out of the sequence must be left out *on the record*."""
    readme = _readme()
    executed = set(_executed_files())

    for excluded in ("07_security/02_role_verification.sql", "99_local_reset.sql"):
        assert f"`{excluded}`" in readme, f"{excluded} is not explained in sql/README.md"
        assert excluded not in executed


@pytest.mark.parametrize(
    "lane_file",
    [
        "01_raw/14_raw_inventory_listing_snapshot_load.sql",
        "02_staging/15_stg_inventory_listing_snapshot.sql",
        "03_dimensions/08_dim_observed_vehicle.sql",
        "03_dimensions/18_dim_observed_vehicle_load.sql",
        "04_facts/05_fact_vehicle_listing_snapshot.sql",
        "04_facts/15_fact_vehicle_listing_snapshot_load.sql",
        "08_validation/12_recon_inventory_listing.sql",
    ],
)
def test_a_listing_lane_script_is_marked_as_such(lane_file: str) -> None:
    """The lane is identifiable in the table, not merely present in it.

    A reader counting facts from this table must be able to see which row is the sixth one
    and why it does not belong to the five. An unmarked row would read as an MVP fact.
    """
    readme = _readme()
    rows = [line for line in readme.splitlines() if f"`{lane_file}`" in line]
    assert rows, f"{lane_file} has no row in sql/README.md"
    assert any("Listing lane" in row for row in rows), (
        f"{lane_file} is in the execution-order table but is not marked as listing lane, so "
        "a reader counting MVP objects from the table would count it"
    )
