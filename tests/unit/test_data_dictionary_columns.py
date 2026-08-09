"""The data dictionary's column tables, asserted against the DDL that creates them.

WHY THIS EXISTS
---------------
``DATA_DICTIONARY.md`` section 15 documented three columns on
``warehouse.fact_vehicle_inventory_snapshot`` that the table has never had --
``price_to_market_ratio``, ``lead_count_to_date`` and ``appointment_count_to_date`` -- and
omitted three it does have. That survived several increments because nothing compared the
two, and a documented column reads as a fact about the schema: someone building against
the dictionary would have selected a column that does not exist.

It is the same failure the repository already guards against elsewhere. ``CLAUDE.md`` §3
requires claims to be DERIVED from evidence rather than asserted, and
``scripts/check_project_capabilities.py`` enforces that for counts and statuses in both
directions. This does it for one table's columns, in both directions: every documented
column exists, and every existing column is documented.

WHY ONE TABLE RATHER THAN ALL OF THEM
-------------------------------------
The dictionary's thirty-odd sections were written by hand over the project's life and use
several table layouts; a parser general enough for all of them would need every section
reformatted first, which is a documentation increment and not this one. This pins the table
that was actually wrong, and the parser is deliberately strict -- a section that stops
matching the expected shape fails loudly rather than silently checking nothing, which is
the failure mode ``DATA_DICTIONARY.md`` §21.3 names: an absent check reads exactly like a
passing one.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DICTIONARY = REPO / "DATA_DICTIONARY.md"
FACT_DDL = REPO / "sql" / "04_facts" / "01_fact_vehicle_inventory_snapshot.sql"

#: The heading that opens the section, and the one that closes it.
SECTION_START = "## 15. `warehouse.fact_vehicle_inventory_snapshot`"
SECTION_END = "### 15.2 Business rules"

#: Columns named in section 15's prose as never having existed. They must stay absent from
#: the DDL: if one is ever implemented, the prose explaining that it does not exist becomes
#: false and this test says so.
PHANTOM_COLUMNS = frozenset(
    {"price_to_market_ratio", "lead_count_to_date", "appointment_count_to_date"}
)


def ddl_columns() -> frozenset[str]:
    """Every column ``CREATE TABLE`` declares, read from the SQL text.

    Read from the file rather than from a live database on purpose: the agreement holds
    whether or not a PostgreSQL server is available, so the check runs in every sandbox
    rather than only in the integration lane.
    """
    text = FACT_DDL.read_text(encoding="utf-8")
    start = text.index("CREATE TABLE IF NOT EXISTS warehouse.fact_vehicle_inventory_snapshot (")
    body = text[start : text.index("\n);", start)]

    columns: set[str] = set()
    # The type is followed by a lookahead for whitespace rather than by ``\b``. A word
    # boundary after ``numeric(12,2)`` never matches: the pattern ends on ``)``, the next
    # character is a space, and two non-word characters have no boundary between them. The
    # first version of this regex silently matched only the integer columns -- eight of
    # seventeen -- which is exactly the "an absent check reads like a passing one" failure
    # the guard test below exists to catch, and did.
    declaration = re.compile(
        r"^\s{4}([a-z][a-z0-9_]*)\s+"
        r"(bigint|integer|smallint|numeric\(\d+,\d+\)|varchar\(\d+\)|text|date|boolean)(?=\s)"
    )
    for line in body.splitlines():
        match = declaration.match(line)
        if match is not None:
            columns.add(match.group(1))
    return frozenset(columns)


def documented_columns() -> frozenset[str]:
    """Every column section 15 tabulates, from the leading `` `name` `` cell of each row."""
    text = DICTIONARY.read_text(encoding="utf-8")
    start = text.index(SECTION_START)
    section = text[start : text.index(SECTION_END, start)]

    columns: set[str] = set()
    for line in section.splitlines():
        match = re.match(r"^\|\s*`([a-z][a-z0-9_]*)`\s*\|", line)
        if match is not None:
            columns.add(match.group(1))
    return frozenset(columns)


def test_the_parsers_find_something_to_compare() -> None:
    """Both sides are non-empty, so a passing comparison is not an empty one.

    Without this, reformatting either file into a shape the regexes miss would turn every
    assertion below into ``frozenset() == frozenset()``.
    """
    assert len(ddl_columns()) >= 15, "the DDL parser matched almost nothing"
    assert len(documented_columns()) >= 15, "the dictionary parser matched almost nothing"


def test_every_documented_column_exists_in_the_ddl() -> None:
    """No column may be documented that no DDL creates."""
    invented = documented_columns() - ddl_columns()
    assert not invented, (
        "DATA_DICTIONARY.md section 15 documents columns that "
        f"warehouse.fact_vehicle_inventory_snapshot does not have: {sorted(invented)}"
    )


def test_every_ddl_column_is_documented() -> None:
    """And no column may exist that the dictionary does not describe.

    The other direction, and the one that catches the quieter failure: a column added to
    the table and never written down is invisible to anyone reading the dictionary.
    """
    undocumented = ddl_columns() - documented_columns()
    assert not undocumented, (
        "warehouse.fact_vehicle_inventory_snapshot has columns that "
        f"DATA_DICTIONARY.md section 15 does not document: {sorted(undocumented)}"
    )


def test_the_columns_that_never_existed_still_do_not() -> None:
    """The three phantom columns are absent from the whole SQL tree, not just this table.

    Section 15.5 states plainly that these were documentation errors rather than deferred
    work, and gives a reason for the two count columns: activity *to date* on a daily
    inventory snapshot would make each row depend on events after the snapshot, which the
    fact's own header forbids. If one is ever implemented, that prose is wrong and this
    fails rather than leaving the explanation standing.
    """
    for column in sorted(PHANTOM_COLUMNS):
        assert column not in ddl_columns(), (
            f"{column} now exists on the fact; DATA_DICTIONARY.md section 15.5 still says "
            "it never did"
        )


#: The two reporting views permitted to compute `price_to_market_ratio`, and the reason
#: there are two rather than one.
#:
#: `vw_inventory_snapshots` states the rule. `vw_inventory_units` repeats it, because it
#: reads `warehouse.fact_vehicle_inventory_snapshot` directly -- it needs window functions
#: over a narrowed set of dates that the snapshots view does not publish -- and so cannot
#: select a column the thing it reads does not have.
#:
#: A third file computing this division is a defect. So is the two drifting apart, which is
#: why `RECON-INV-UNIT-RATIO` re-proves their equality on every database run rather than
#: this test being the only thing standing between them.
RATIO_DEFINERS = ("12_vw_inventory_snapshots.sql", "52_vw_inventory_units.sql")


def test_the_ratio_is_computed_in_exactly_the_two_views_that_may() -> None:
    """`price_to_market_ratio` is derived, and section 15.5 says where.

    Not "in exactly one place" -- that was the claim the SQL comments made, and it is not
    what the code does. Stating it that way here would have made this test the third place
    the project asserted something about the ratio that was not true of it.
    """
    reporting = REPO / "sql" / "05_reporting"
    division = re.compile(r"current_asking_price\s*/\s*NULLIF\(\s*[a-z]*\.?market_price_estimate")
    definers = tuple(
        sorted(
            path.name
            for path in reporting.glob("*.sql")
            if division.search(path.read_text(encoding="utf-8"))
        )
    )
    assert definers == RATIO_DEFINERS, (
        "price_to_market_ratio may be computed only in the two views that must; "
        f"found the division in {list(definers)}"
    )


def test_the_two_copies_of_the_ratio_are_the_same_expression() -> None:
    """The duplication is byte-identical, so it cannot diverge by accident.

    Two copies of a rule is how two surfaces come to disagree about a measure carrying one
    name. This catches the divergence at the file level and costs nothing;
    ``RECON-INV-UNIT-RATIO`` catches it against real rows on every database run, which is
    the one that would notice a difference this comparison could not see.
    """
    reporting = REPO / "sql" / "05_reporting"
    expression = re.compile(
        r"ELSE round\(i\.current_asking_price / NULLIF\(i\.market_price_estimate, 0\), 4\)"
    )
    found = {
        name: expression.findall((reporting / name).read_text(encoding="utf-8"))
        for name in RATIO_DEFINERS
    }
    for name, matches in found.items():
        assert len(matches) == 1, f"expected exactly one ratio expression in {name}, got {matches}"
    assert len({matches[0] for matches in found.values()}) == 1, (
        f"the two copies of the price_to_market_ratio expression have diverged: {found}"
    )
