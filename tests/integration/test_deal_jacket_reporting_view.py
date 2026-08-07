"""Integration tests for ``reporting.vw_deal_jacket`` (``DASH.4``).

The Deal Jacket is the one page in ARPI that claims a transaction is explained TO THE
CENT. That claim rests on three things this module asserts against a real PostgreSQL
server holding a real pipeline run:

* **The grain survives seven joins.** Two of them -- the linked lead and the linked
  appointment -- could widen it. A widened grain does not error; it renders one
  transaction twice with nothing on the page saying so.
* **Both arithmetic identities hold on every deal.** The console recomputes them, but
  the console recomputes them from THIS view, so a view that publishes inconsistent
  components would produce a page that correctly reports its own source is broken.
  Catching it here names the cause.
* **Nothing prohibited reached a public lane.** The Deal Jacket renders more of a
  transaction than anything else in the project, which makes it the place where a
  privacy regression would first show up.

WHY THE IDENTITIES ARE ASSERTED HERE AND ALSO IN THE CONSOLE
------------------------------------------------------------
They are not the same assertion. The view test proves the exported components are
self-consistent in the database. The console test proves the PAGE recomputes rather
than trusting a flag. Removing either one leaves a hole: a correct view rendered by a
page that displays a stored number it never checked, or a page that checks diligently
against a source that was already wrong.

SEEDED DEFECTS ARE INCLUDED
---------------------------
``test_a_mutated_front_gross_breaks_the_identity`` and its total-gross twin prove the
identity assertions can fail. An identity test that is accidentally vacuous -- zero
rows, or a value compared with itself -- looks exactly like a passing one. Both
mutations are applied inside the query, in the per-test transaction ``loaded_db``
rolls back; no committed data is touched.
"""

from __future__ import annotations

from typing import Any

import pytest

pytestmark = pytest.mark.integration

JACKET_VIEW = "reporting.vw_deal_jacket"
EXPLORER_VIEW = "reporting.vw_deal_explorer"

#: Fields that must never appear in a public deal lane, in any spelling.
#: Checked against column NAMES; the value-level scan is the exporter's privacy check.
PROHIBITED_JACKET_COLUMNS = (
    "customer_key",
    "customer_id",
    "customer_name",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "email_address",
    "phone",
    "phone_number",
    "address",
    "street_address",
    "postal_code",
    "date_of_birth",
    "birth_date",
    "ssn",
    "credit_score",
    "credit_tier",
    "drivers_license",
    "account_number",
    "bank_account",
    "card_number",
    "lender",
    "lender_name",
    "lender_key",
    "apr",
    "interest_rate",
    "buy_rate",
    "sell_rate",
    "rate_spread",
    "term_months",
    "monthly_payment",
    "sale_key",
    "employee_name",
    "salesperson_name",
    "notes",
    "comments",
    "message",
    "message_body",
    "vin",
)


def _scalar(cursor: Any, sql: str, params: tuple[Any, ...] = ()) -> Any:
    cursor.execute(sql, params)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _columns(cursor: Any, view: str) -> set[str]:
    schema, name = view.split(".", 1)
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        """,
        (schema, name),
    )
    return {row[0] for row in cursor.fetchall()}


# ======================================================================================
# Shape, documentation, access
# ======================================================================================


def test_the_view_exists_and_is_a_view(loaded_cursor: Any) -> None:
    """Reporting-layer rule 1: no materialised view without a MEASURED problem."""
    kind = _scalar(
        loaded_cursor,
        """
        SELECT c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'reporting' AND c.relname = 'vw_deal_jacket'
        """,
    )
    assert kind == "v", f"{JACKET_VIEW} has relkind {kind!r}; expected an ordinary view"


def test_the_view_declares_its_grain_and_date_basis(loaded_cursor: Any) -> None:
    comment = _scalar(
        loaded_cursor, "SELECT obj_description(%s::regclass, 'pg_class')", (JACKET_VIEW,)
    )
    assert comment, f"{JACKET_VIEW} carries no COMMENT ON VIEW"
    assert "Grain:" in comment, f"{JACKET_VIEW} does not declare its grain"
    assert "Date basis:" in comment or "date basis" in comment.lower(), (
        f"{JACKET_VIEW} does not declare its date basis"
    )
    assert "Export-eligible" in comment, f"{JACKET_VIEW} does not declare its export eligibility"


def test_every_column_is_documented(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        """
        SELECT c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'reporting' AND c.table_name = 'vw_deal_jacket'
          AND col_description('reporting.vw_deal_jacket'::regclass, c.ordinal_position) IS NULL
        ORDER BY c.ordinal_position
        """
    )
    undocumented = [row[0] for row in loaded_cursor.fetchall()]
    assert undocumented == [], f"{JACKET_VIEW} has undocumented column(s): {undocumented}"


def test_the_reporter_role_can_read_it_and_cannot_write_it(loaded_cursor: Any) -> None:
    readable = _scalar(
        loaded_cursor, "SELECT has_table_privilege('arpi_reporter', %s, 'SELECT')", (JACKET_VIEW,)
    )
    assert readable is True, f"arpi_reporter cannot SELECT {JACKET_VIEW}"
    for privilege in ("INSERT", "UPDATE", "DELETE"):
        granted = _scalar(
            loaded_cursor,
            "SELECT has_table_privilege('arpi_reporter', %s, %s)",
            (JACKET_VIEW, privilege),
        )
        assert granted is False, f"arpi_reporter holds {privilege} on {JACKET_VIEW}"


def test_the_view_returns_rows(loaded_cursor: Any) -> None:
    """A view that is correct but empty would satisfy almost every other test here."""
    assert _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW}") > 0


# ======================================================================================
# Grain: seven joins, none of which may widen it
# ======================================================================================


def test_the_jacket_is_one_row_per_finalized_sale(loaded_cursor: Any) -> None:
    jacket_rows = _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW}")
    fact_rows = _scalar(loaded_cursor, "SELECT count(*) FROM warehouse.fact_vehicle_sale")
    assert jacket_rows == fact_rows, (
        f"vw_deal_jacket has {jacket_rows} rows against {fact_rows} in the fact -- "
        "one of the seven joins fanned out or dropped rows"
    )


def test_the_jacket_sale_id_is_unique(loaded_cursor: Any) -> None:
    distinct = _scalar(loaded_cursor, f"SELECT count(DISTINCT sale_id) FROM {JACKET_VIEW}")
    total = _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW}")
    assert distinct == total, "sale_id is not unique in vw_deal_jacket"


def test_at_most_one_lead_links_to_a_sale(loaded_cursor: Any) -> None:
    """The first of the two joins that could widen the grain.

    Asserted rather than assumed: the day the generator links a second lead to one
    deal is the day this view starts rendering that transaction twice.
    """
    worst = _scalar(
        loaded_cursor,
        """
        SELECT coalesce(max(n), 0) FROM (
            SELECT count(*) AS n FROM warehouse.fact_lead
            WHERE sale_key IS NOT NULL GROUP BY sale_key
        ) AS t
        """,
    )
    assert worst <= 1, f"a sale carries {worst} leads; vw_deal_jacket would duplicate that deal"


def test_at_most_one_appointment_links_to_a_sale(loaded_cursor: Any) -> None:
    """The second. Same failure mode, different fact."""
    worst = _scalar(
        loaded_cursor,
        """
        SELECT coalesce(max(n), 0) FROM (
            SELECT count(*) AS n FROM warehouse.fact_appointment
            WHERE sale_key IS NOT NULL GROUP BY sale_key
        ) AS t
        """,
    )
    assert worst <= 1, (
        f"a sale carries {worst} appointments; vw_deal_jacket would duplicate that deal"
    )


def test_the_jacket_and_the_explorer_cover_the_same_deals(loaded_cursor: Any) -> None:
    """Index and record must not disagree about which transactions exist.

    A deal listed in the Deal Explorer whose jacket route 404s, or a jacket reachable
    only by typing an id, is a broken drill-through either way.
    """
    missing = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM (
            SELECT sale_id FROM {EXPLORER_VIEW}
            EXCEPT SELECT sale_id FROM {JACKET_VIEW}
            UNION ALL
            SELECT sale_id FROM {JACKET_VIEW}
            EXCEPT SELECT sale_id FROM {EXPLORER_VIEW}
        ) AS t
        """,
    )
    assert missing == 0, "the Deal Explorer and the Deal Jacket cover different sale ids"


def test_the_jacket_agrees_with_the_explorer_on_every_shared_figure(loaded_cursor: Any) -> None:
    """Two views over the same fact may not report a deal differently."""
    mismatches = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*)
        FROM {JACKET_VIEW} AS j
        JOIN {EXPLORER_VIEW} AS e ON e.sale_id = j.sale_id
        WHERE j.sale_date         IS DISTINCT FROM e.sale_date
           OR j.sale_type         IS DISTINCT FROM e.sale_type
           OR j.is_retail         IS DISTINCT FROM e.is_retail
           OR j.dealership_key    IS DISTINCT FROM e.dealership_key
           OR j.sale_price        IS DISTINCT FROM e.sale_price
           OR j.msrp              IS DISTINCT FROM e.msrp
           OR j.front_end_gross   IS DISTINCT FROM e.front_end_gross
           OR j.back_end_gross    IS DISTINCT FROM e.back_end_gross
           OR j.total_gross       IS DISTINCT FROM e.total_gross
           OR j.is_lead_attributed IS DISTINCT FROM e.is_lead_attributed
           OR j.lead_source_code  IS DISTINCT FROM e.lead_source_code
        """,
    )
    assert mismatches == 0, "vw_deal_jacket disagrees with vw_deal_explorer about a deal"


def test_every_deal_resolves_to_exactly_one_store(loaded_cursor: Any) -> None:
    orphans = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW} AS j
        LEFT JOIN reporting.vw_dealership AS d ON d.dealership_key = j.dealership_key
        WHERE d.dealership_key IS NULL
        """,
    )
    assert orphans == 0


# ======================================================================================
# The two arithmetic identities the page recomputes
# ======================================================================================


def test_the_front_gross_identity_holds_on_every_deal(loaded_cursor: Any) -> None:
    """Sale price less acquisition, reconditioning and pack equals front-end gross.

    Trade variance is deliberately absent from this formula. Adding it would change
    what KPI-GRS-001 means, and the whole point of the Deal Jacket is that the figure
    it shows is the figure the KPI catalogue defines.
    """
    breaks = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE sale_price - acquisition_cost - reconditioning_cost - pack_amount
              IS DISTINCT FROM front_end_gross
        """,
    )
    assert breaks == 0, f"the front-gross identity fails on {breaks} deal(s)"


def test_the_total_gross_identity_holds_on_every_deal(loaded_cursor: Any) -> None:
    breaks = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {JACKET_VIEW} "
        "WHERE front_end_gross + back_end_gross IS DISTINCT FROM total_gross",
    )
    assert breaks == 0, f"the total-gross identity fails on {breaks} deal(s)"


def test_a_mutated_front_gross_breaks_the_identity(loaded_db: Any) -> None:
    """Seeded defect: one cent, and the front-gross assertion above must catch it.

    A view cannot be UPDATEd, so the mutation is applied in the query -- which is
    exactly the arithmetic a defective view would publish. The fixture rolls the
    transaction back regardless.
    """
    with loaded_db.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT count(*) FROM {JACKET_VIEW}
            WHERE sale_price - acquisition_cost - reconditioning_cost - pack_amount
                  IS DISTINCT FROM front_end_gross + 0.01
            """
        )
        broken = cursor.fetchone()[0]
    assert broken > 0, (
        "adding a cent to the front-end gross did not break the identity; the assertion "
        "above is not actually testing anything"
    )


def test_a_mutated_total_gross_breaks_the_identity(loaded_db: Any) -> None:
    """Seeded defect: the total-gross twin."""
    with loaded_db.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT count(*) FROM {JACKET_VIEW}
            WHERE front_end_gross + back_end_gross IS DISTINCT FROM total_gross + 0.01
            """
        )
        broken = cursor.fetchone()[0]
    assert broken > 0, "adding a cent to the total gross did not break the identity"


def test_trade_variance_is_published_but_is_not_inside_the_front_gross(
    loaded_cursor: Any,
) -> None:
    """It is allowance less ACV, and it is deliberately outside the formula.

    The second half of this test is the one that matters: on every deal where the
    variance is non-zero, folding it into the front-gross formula must BREAK the
    identity. If it did not, the view's separation would be decorative.
    """
    wrong = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {JACKET_VIEW} "
        "WHERE trade_variance IS DISTINCT FROM trade_allowance - trade_acv",
    )
    assert wrong == 0, "trade_variance is not allowance less actual cash value"

    non_zero = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE trade_variance <> 0"
    )
    assert non_zero > 0, "no deal carries a non-zero trade variance; the separation is untestable"

    folded_in = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE trade_variance <> 0
          AND sale_price - acquisition_cost - reconditioning_cost - pack_amount
              - trade_variance = front_end_gross
        """,
    )
    assert folded_in == 0, (
        "trade variance is inside the published front-end gross; KPI-GRS-001 defines it as excluded"
    )


def test_the_discount_columns_are_exact_subtractions(loaded_cursor: Any) -> None:
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE discount_from_original IS DISTINCT FROM original_asking_price - sale_price
           OR discount_from_final    IS DISTINCT FROM final_asking_price - sale_price
        """,
    )
    assert wrong == 0


def test_a_unit_without_an_msrp_has_a_null_msrp_discount_and_not_a_zero(
    loaded_cursor: Any,
) -> None:
    """Absence is NULL. A zero discount from a price that does not exist is a fiction."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE (msrp IS NULL AND discount_from_msrp IS NOT NULL)
           OR (msrp IS NOT NULL AND discount_from_msrp IS DISTINCT FROM msrp - sale_price)
        """,
    )
    assert wrong == 0

    without_msrp = _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE msrp IS NULL")
    assert without_msrp > 0, "no unit without an MSRP exists; the Not-applicable rule is untestable"

    zero_msrp = _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE msrp = 0")
    assert zero_msrp == 0, "an MSRP of 0.00 was published; absence must be NULL"


# ======================================================================================
# Derived finance structure
# ======================================================================================


def test_the_finance_structure_is_exactly_its_documented_derivation(loaded_cursor: Any) -> None:
    """Lease, then nothing financed, then financed. In that order and no other."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE finance_structure IS DISTINCT FROM CASE
                WHEN sale_type = 'Lease' THEN 'Lease'
                WHEN amount_financed = 0 THEN 'Cash'
                ELSE 'Retail Finance'
              END
        """,
    )
    assert wrong == 0, "finance_structure does not match its documented derivation"


def test_the_finance_structure_basis_agrees_with_the_label(loaded_cursor: Any) -> None:
    """A reader must be able to see what the label was decided FROM."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE (finance_structure = 'Lease'
               AND finance_structure_basis <> 'sale type is Lease')
           OR (finance_structure = 'Cash'
               AND finance_structure_basis <> 'nothing was financed')
           OR (finance_structure = 'Retail Finance'
               AND finance_structure_basis <> 'an amount was financed')
        """,
    )
    assert wrong == 0, "finance_structure_basis contradicts finance_structure"


def test_all_three_finance_structures_are_present(loaded_cursor: Any) -> None:
    """Each renders differently. A structure with no deal is a rendering rule never run."""
    loaded_cursor.execute(f"SELECT DISTINCT finance_structure FROM {JACKET_VIEW} ORDER BY 1")
    structures = [row[0] for row in loaded_cursor.fetchall()]
    assert structures == ["Cash", "Lease", "Retail Finance"], (
        f"expected all three finance structures in the profile, found {structures}"
    )


def test_a_cash_deal_financed_nothing(loaded_cursor: Any) -> None:
    """The label must be true of the row, not merely assigned to it."""
    wrong = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {JACKET_VIEW} "
        "WHERE finance_structure = 'Cash' AND amount_financed <> 0",
    )
    assert wrong == 0


# ======================================================================================
# Absence, flags and supporting fact
# ======================================================================================


def test_has_trade_agrees_with_the_trade_figures(loaded_cursor: Any) -> None:
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE has_trade <> (trade_allowance > 0 OR trade_acv > 0)
        """,
    )
    assert wrong == 0

    for expected in (True, False):
        found = _scalar(
            loaded_cursor,
            f"SELECT count(*) FROM {JACKET_VIEW} WHERE has_trade = %s",
            (expected,),
        )
        assert found > 0, (
            f"no deal with has_trade = {expected}; one of the two trade renderings is untestable"
        )


def test_the_delivery_check_agrees_with_the_two_dates(loaded_cursor: Any) -> None:
    """The page shows this as a check, so the column must be the comparison it claims."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE delivery_on_or_after_sale <> (delivery_date >= sale_date)
        """,
    )
    assert wrong == 0


def test_the_inventory_snapshot_count_is_a_real_count(loaded_cursor: Any) -> None:
    """Never NULL, never negative, and populated for at least some units.

    A column that is zero on every row would make the sale-to-inventory check a
    permanent note, which is indistinguishable from a check that does not work.
    """
    bad = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {JACKET_VIEW} "
        "WHERE inventory_snapshot_count IS NULL OR inventory_snapshot_count < 0",
    )
    assert bad == 0

    with_snapshots = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE inventory_snapshot_count > 0"
    )
    assert with_snapshots > 0, "no sold unit ever appeared in an inventory snapshot"


def test_a_walk_in_deal_carries_no_lead_paper_trail(loaded_cursor: Any) -> None:
    """A walk-in deal must carry absent lead columns rather than zeroed ones."""
    wrong = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE NOT is_lead_attributed
          AND (lead_id IS NOT NULL
               OR lead_created_date IS NOT NULL
               OR lead_source_code IS NOT NULL
               OR first_response_seconds IS NOT NULL)
        """,
    )
    assert wrong == 0, "an unattributed deal published lead attributes"

    walk_ins = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE NOT is_lead_attributed"
    )
    attributed = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE is_lead_attributed"
    )
    assert walk_ins > 0 and attributed > 0, (
        "the profile must contain both walk-in and lead-attributed deals for the two "
        "timeline renderings to be exercised"
    )


def test_an_unattributed_role_is_null_rather_than_a_placeholder_code(
    loaded_cursor: Any,
) -> None:
    """Four roles, and an empty string would render as a code that does not exist."""
    for column in (
        "salesperson_code",
        "desk_manager_code",
        "finance_manager_code",
        "bdc_employee_code",
    ):
        blanks = _scalar(loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE {column} = ''")
        assert blanks == 0, f"{column} carries an empty string; absence must be NULL"

    unattributed = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE bdc_employee_code IS NULL"
    )
    assert unattributed > 0, "every deal has a BDC employee; the Unattributed state is untestable"


# ======================================================================================
# Privacy
# ======================================================================================


def test_the_jacket_exposes_no_prohibited_field(loaded_cursor: Any) -> None:
    columns = _columns(loaded_cursor, JACKET_VIEW)
    leaked = sorted(columns & set(PROHIBITED_JACKET_COLUMNS))
    assert leaked == [], f"vw_deal_jacket exposes prohibited column(s): {leaked}"


def test_the_jacket_does_not_expose_the_surrogate_sale_key(loaded_cursor: Any) -> None:
    """The route parameter is the business code. A surrogate would leak load order."""
    assert "sale_key" not in _columns(loaded_cursor, JACKET_VIEW)


#: The only ``*_name`` columns the jacket is permitted to publish. Both name a THING --
#: a model line and a lead-source category -- and neither names a person.
PERMITTED_NAME_COLUMNS = {"model_name", "lead_source_name"}


def test_the_only_name_columns_are_the_two_that_name_a_thing(loaded_cursor: Any) -> None:
    """An allowlist, so a new ``*_name`` column has to be argued for rather than merged."""
    name_columns = {
        column for column in _columns(loaded_cursor, JACKET_VIEW) if column.endswith("_name")
    }
    unexpected = sorted(name_columns - PERMITTED_NAME_COLUMNS)
    assert unexpected == [], (
        f"vw_deal_jacket publishes unexpected name column(s): {unexpected}. Only "
        f"{sorted(PERMITTED_NAME_COLUMNS)} are permitted, and both name a thing rather "
        "than a person."
    )


def test_every_person_on_the_deal_is_a_synthetic_code(loaded_cursor: Any) -> None:
    """Employees appear as identifiers and roles. No name exists anywhere in ARPI.

    Asserted on VALUES rather than on column names alone: a name reaching the page
    through a differently-named column is precisely the failure a name scan cannot see.
    Every populated staff code must match the generator's ``EMP-`` shape.
    """
    for column in (
        "salesperson_code",
        "desk_manager_code",
        "finance_manager_code",
        "bdc_employee_code",
    ):
        off_shape = _scalar(
            loaded_cursor,
            f"SELECT count(*) FROM {JACKET_VIEW} "
            f"WHERE {column} IS NOT NULL AND {column} !~ '^EMP-[0-9]+$'",
        )
        assert off_shape == 0, (
            f"{off_shape} value(s) of {column} are not synthetic EMP- identifiers; a human "
            "name may have reached a public lane"
        )

    populated = _scalar(
        loaded_cursor, f"SELECT count(*) FROM {JACKET_VIEW} WHERE salesperson_code IS NOT NULL"
    )
    assert populated > 0, "no staff code is populated; the assertion above ran over nothing"


def test_the_odometer_is_banded_and_never_exact(loaded_cursor: Any) -> None:
    """PRIVACY_AND_ETHICS.md: the reading is a band. A number would be an exact reading."""
    numeric = _scalar(
        loaded_cursor,
        f"SELECT count(*) FROM {JACKET_VIEW} WHERE odometer_band ~ '^[0-9]+$'",
    )
    assert numeric == 0, "odometer_band holds a bare number; it must be a band label"

    assert "odometer" not in {
        column for column in _columns(loaded_cursor, JACKET_VIEW) if column != "odometer_band"
    }


def test_the_vin_is_the_synthetic_one(loaded_cursor: Any) -> None:
    """ADR-0005: the identifier is deliberately not a structurally valid real VIN.

    The policy is 17 characters, the literal prefix ``ARPI``, and the VIN alphabet
    (which excludes I, O and Q). ``ARP`` is not a real World Manufacturer Identifier
    and the ninth character is not an ISO 3779 check digit, so a value shaped like
    this cannot collide with a real vehicle. The Deal Jacket renders it, so the
    property is asserted where it is rendered as well as where it is generated.
    """
    columns = _columns(loaded_cursor, JACKET_VIEW)
    assert "synthetic_vin" in columns
    assert "vin" not in columns, "a bare `vin` column would read as a real vehicle identifier"

    off_policy = _scalar(
        loaded_cursor,
        f"""
        SELECT count(*) FROM {JACKET_VIEW}
        WHERE synthetic_vin !~ '^ARPI[ABCDEFGHJKLMNPRSTUVWXYZ0123456789]{{13}}$'
        """,
    )
    assert off_policy == 0, (
        f"{off_policy} synthetic_vin value(s) are not 17 ARPI-prefixed characters from the "
        "VIN alphabet; ADR-0005 fixes that shape precisely so the value cannot be mistaken "
        "for a real vehicle identifier"
    )
