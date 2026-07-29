"""Every reconciliation is recorded on every run, passes on clean data, and can fail.

The third clause is the one that matters. A reconciliation that has never been observed
failing is not evidence -- it might be comparing a value with itself, or reading the same
rows twice. So each critical rule here is given a deliberately corrupted fixture and
must report ``failed``.

Two kinds of corruption are used, because ARPI's reconciliations are of two kinds:

* **Population comparisons** -- two independently derived counts or totals. These are
  broken by corrupting DATA: deleting a fact row, breaking a gross identity, orphaning a
  dimension key.
* **Layer invariants** -- an identity or a NULL rule that a reporting view guarantees by
  construction. No data change can break one, because both sides read the same rows
  through the same expression. Those are broken by corrupting the VIEW: the definition is
  read back with ``pg_get_viewdef``, one expression is substituted, and the view is
  replaced. That is exactly the regression the rule exists to catch.

Every corruption runs inside the test's transaction and is rolled back, so the loaded
database is untouched for the next test. DDL is transactional in PostgreSQL, which is
what makes dropping a check constraint safe here.
"""

from __future__ import annotations

from typing import Any

import pytest

from arpi.constants import (
    ALLOWED_RECONCILIATION_TOLERANCES,
    CRITICAL_SQL_RECONCILIATION_IDS,
    NON_CRITICAL_RECONCILIATION_IDS,
    SQL_RECONCILIATION_IDS,
)

pytestmark = pytest.mark.integration


def _scalar(cursor: Any, statement: str, parameters: tuple[Any, ...] | None = None) -> Any:
    cursor.execute(statement, parameters)
    row = cursor.fetchone()
    return None if row is None else row[0]


def _status(cursor: Any, reconciliation_id: str) -> str | None:
    value = _scalar(
        cursor,
        "SELECT status FROM audit.vw_recon_all WHERE reconciliation_id = %s",
        (reconciliation_id,),
    )
    return None if value is None else str(value)


def _corrupt_view(cursor: Any, view_name: str, old: str, new: str) -> None:
    """Replace one expression inside a reporting view, in this transaction only.

    The definition is read back from the catalogue rather than restated here, so the
    corruption stays a one-line substitution and cannot drift from the real view.
    """
    definition = _scalar(
        cursor, "SELECT pg_get_viewdef(%s::regclass, true)", (f"reporting.{view_name}",)
    )
    assert old in definition, (
        f"the corruption target {old!r} is not present in reporting.{view_name}; the view "
        "changed and this test's substitution needs updating"
    )
    cursor.execute(
        f"CREATE OR REPLACE VIEW reporting.{view_name} AS {definition.replace(old, new, 1)}"
    )


# --------------------------------------------------------------------------------------
# The clean-data contract
# --------------------------------------------------------------------------------------


def test_the_view_publishes_exactly_the_declared_reconciliations(loaded_cursor: Any) -> None:
    loaded_cursor.execute("SELECT reconciliation_id FROM audit.vw_recon_all ORDER BY 1")
    published = [row[0] for row in loaded_cursor.fetchall()]
    assert sorted(published) == sorted(SQL_RECONCILIATION_IDS)
    assert len(published) == len(set(published)), "a reconciliation identifier is duplicated"


def test_every_reconciliation_passes_on_clean_data(loaded_cursor: Any) -> None:
    loaded_cursor.execute(
        "SELECT reconciliation_id, description FROM audit.vw_recon_all WHERE status <> 'passed'"
    )
    failures = loaded_cursor.fetchall()
    assert failures == [], f"reconciliations failing on clean data: {failures}"


def test_no_reconciliation_carries_an_unexplained_tolerance(loaded_cursor: Any) -> None:
    """Only 0 and the documented 0.01 currency tolerance are permitted."""
    loaded_cursor.execute(
        "SELECT DISTINCT reconciliation_id, tolerance::text FROM audit.vw_recon_all ORDER BY 1"
    )
    for reconciliation_id, tolerance in loaded_cursor.fetchall():
        assert tolerance in ALLOWED_RECONCILIATION_TOLERANCES, (
            f"{reconciliation_id} carries tolerance {tolerance}, which is neither exact (0) "
            "nor validation.numeric_absolute_tolerance (0.01)"
        )


def test_every_reconciliation_is_recorded_against_the_run(loaded_cursor: Any) -> None:
    """The loader persists every SQL reconciliation on every database run.

    A declarative view produces a verdict and writes nothing. This asserts the verdicts
    became recorded evidence, which is the difference between a check that exists and a
    check that ran.
    """
    run_id = _scalar(loaded_cursor, "SELECT max(pipeline_run_id) FROM audit.pipeline_run")
    assert run_id is not None, "the loaded fixture recorded no pipeline run"

    loaded_cursor.execute(
        "SELECT reconciliation_id FROM audit.reconciliation_result WHERE pipeline_run_id = %s",
        (run_id,),
    )
    recorded = {row[0] for row in loaded_cursor.fetchall()}
    missing = set(SQL_RECONCILIATION_IDS) - recorded
    assert not missing, f"reconciliations never recorded against the run: {sorted(missing)}"


def test_recording_is_idempotent_within_a_run(loaded_cursor: Any) -> None:
    """A rerun restates the verdicts rather than accumulating a second set."""
    run_id = _scalar(loaded_cursor, "SELECT max(pipeline_run_id) FROM audit.pipeline_run")
    before = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM audit.reconciliation_result WHERE pipeline_run_id = %s",
        (run_id,),
    )
    loaded_cursor.execute("SELECT audit.fn_record_all_reconciliations(%s)", (run_id,))
    loaded_cursor.execute("SELECT audit.fn_record_all_reconciliations(%s)", (run_id,))
    after = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM audit.reconciliation_result WHERE pipeline_run_id = %s",
        (run_id,),
    )
    assert after == before


def test_the_reporting_view_exposes_every_recorded_reconciliation(loaded_cursor: Any) -> None:
    """Reconciliation status reaches a reader through `reporting`, not through `audit`."""
    audit_rows = _scalar(loaded_cursor, "SELECT count(*) FROM audit.reconciliation_result")
    reporting_rows = _scalar(
        loaded_cursor, "SELECT count(*) FROM reporting.vw_reconciliation_status"
    )
    assert reporting_rows == audit_rows

    loaded_cursor.execute(
        "SELECT DISTINCT reconciliation_id FROM reporting.vw_reconciliation_status "
        "WHERE NOT is_critical"
    )
    non_critical = {row[0] for row in loaded_cursor.fetchall()}
    assert non_critical <= NON_CRITICAL_RECONCILIATION_IDS


def test_only_the_funnel_chain_is_non_critical() -> None:
    """Criticality is a deliberate, narrow exception, not a convenience."""
    assert {"RECON-FUNNEL-CHAIN"} == NON_CRITICAL_RECONCILIATION_IDS
    assert len(CRITICAL_SQL_RECONCILIATION_IDS) == len(SQL_RECONCILIATION_IDS) - 1


# --------------------------------------------------------------------------------------
# Deliberate corruption: each critical reconciliation must be able to fail
# --------------------------------------------------------------------------------------

#: SQL that breaks something a population-comparison reconciliation measures.
#:
#: Each entry maps a reconciliation identifier to the statements that corrupt the
#: fixture. Everything runs inside the test transaction and is rolled back.
DATA_CORRUPTIONS: dict[str, tuple[str, ...]] = {
    "RECON-FACT-VEHICLE-SALE-WAREHOUSE": (
        """
        DELETE FROM warehouse.fact_vehicle_sale
        WHERE sale_key = (
            SELECT s.sale_key FROM warehouse.fact_vehicle_sale AS s
            WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_lead AS l WHERE l.sale_key = s.sale_key)
              AND NOT EXISTS (SELECT 1 FROM warehouse.fact_appointment AS a
                              WHERE a.sale_key = s.sale_key)
            ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-FACT-INVENTORY-SNAPSHOT-WAREHOUSE": (
        # The LAST snapshot of one vehicle: removing it changes the count without
        # opening a gap, so this corruption tests the count rule and nothing else.
        """
        DELETE FROM warehouse.fact_vehicle_inventory_snapshot
        WHERE inventory_snapshot_key = (
            SELECT i.inventory_snapshot_key
            FROM warehouse.fact_vehicle_inventory_snapshot AS i
            WHERE i.snapshot_date_key = (
                SELECT max(j.snapshot_date_key)
                FROM warehouse.fact_vehicle_inventory_snapshot AS j
                WHERE j.vehicle_key = i.vehicle_key AND j.dealership_key = i.dealership_key)
            ORDER BY i.inventory_snapshot_key LIMIT 1)
        """,
    ),
    "RECON-FACT-LEAD-WAREHOUSE": (
        """
        DELETE FROM warehouse.fact_lead
        WHERE lead_key = (
            SELECT l.lead_key FROM warehouse.fact_lead AS l
            WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_appointment AS a
                              WHERE a.lead_key = l.lead_key)
            ORDER BY l.lead_key LIMIT 1)
        """,
    ),
    "RECON-FACT-APPOINTMENT-WAREHOUSE": (
        "DELETE FROM warehouse.fact_appointment "
        "WHERE appointment_key = (SELECT min(appointment_key) FROM warehouse.fact_appointment)",
    ),
    "RECON-FACT-MARKETING-SPEND-WAREHOUSE": (
        "DELETE FROM warehouse.fact_marketing_spend WHERE marketing_spend_key = "
        "(SELECT min(marketing_spend_key) FROM warehouse.fact_marketing_spend)",
    ),
    "RECON-INV-CONTINUITY": (
        # A MIDDLE snapshot date, which opens a gap in one vehicle's run.
        """
        DELETE FROM warehouse.fact_vehicle_inventory_snapshot
        WHERE inventory_snapshot_key = (
            SELECT i.inventory_snapshot_key
            FROM warehouse.fact_vehicle_inventory_snapshot AS i
            JOIN (
                SELECT vehicle_key, dealership_key,
                       min(snapshot_date_key) AS first_key, max(snapshot_date_key) AS last_key
                FROM warehouse.fact_vehicle_inventory_snapshot
                GROUP BY vehicle_key, dealership_key
                HAVING count(*) >= 3
            ) AS span
                   ON  span.vehicle_key    = i.vehicle_key
                   AND span.dealership_key = i.dealership_key
            WHERE i.snapshot_date_key > span.first_key AND i.snapshot_date_key < span.last_key
            ORDER BY i.inventory_snapshot_key LIMIT 1)
        """,
    ),
    "RECON-GROSS-001": (
        "ALTER TABLE warehouse.fact_vehicle_sale "
        "DROP CONSTRAINT ck_fact_vehicle_sale_total_gross_identity",
        "UPDATE warehouse.fact_vehicle_sale SET total_gross = total_gross + 100 "
        "WHERE sale_key = (SELECT min(sale_key) FROM warehouse.fact_vehicle_sale)",
    ),
    "RECON-GROSS-001-FRONT": (
        "ALTER TABLE warehouse.fact_vehicle_sale "
        "DROP CONSTRAINT ck_fact_vehicle_sale_front_end_gross_identity",
        "UPDATE warehouse.fact_vehicle_sale SET sale_price = sale_price + 500 "
        "WHERE sale_key = (SELECT min(sale_key) FROM warehouse.fact_vehicle_sale)",
    ),
    "RECON-GROSS-002": (
        # Orphan the vehicle of one retail sale. reporting.vw_vehicle_sales joins
        # dim_vehicle, so the sale vanishes from the reporting layer while the fact
        # still holds it -- which is precisely the divergence this rule exists for.
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT s.vehicle_key FROM warehouse.fact_vehicle_sale AS s
            WHERE s.is_retail ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-REPORT-SALES": (
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT s.vehicle_key FROM warehouse.fact_vehicle_sale AS s
            WHERE s.is_retail ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-REPORT-SALES-ROWS": (
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT s.vehicle_key FROM warehouse.fact_vehicle_sale AS s ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-REPORT-INVENTORY-ROWS": (
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT i.vehicle_key FROM warehouse.fact_vehicle_inventory_snapshot AS i
            ORDER BY i.inventory_snapshot_key LIMIT 1)
        """,
    ),
    "RECON-INV-001": (
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT i.vehicle_key FROM warehouse.fact_vehicle_inventory_snapshot AS i
            ORDER BY i.inventory_snapshot_key LIMIT 1)
        """,
    ),
    "RECON-REPORT-DAYS-TO-SALE": (
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_vehicle",
        "ALTER TABLE warehouse.fact_vehicle_inventory_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_snapshot_vehicle",
        """
        DELETE FROM warehouse.dim_vehicle
        WHERE vehicle_key = (
            SELECT s.vehicle_key FROM warehouse.fact_vehicle_sale AS s
            WHERE s.is_retail ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-UNITS-001": (
        # A dimension attribute goes missing: the new/used split is taken from
        # condition_type, so a NULL there leaves a retail unit in neither half.
        "ALTER TABLE warehouse.dim_vehicle ALTER COLUMN condition_type DROP NOT NULL",
        "ALTER TABLE warehouse.dim_vehicle DROP CONSTRAINT ck_dim_vehicle_condition_type_domain",
        "ALTER TABLE warehouse.dim_vehicle DROP CONSTRAINT ck_dim_vehicle_new_condition_rule",
        """
        UPDATE warehouse.dim_vehicle SET condition_type = NULL
        WHERE vehicle_key = (
            SELECT s.vehicle_key FROM warehouse.fact_vehicle_sale AS s
            WHERE s.is_retail ORDER BY s.sale_key LIMIT 1)
        """,
    ),
    "RECON-LEAD-001": (
        """
        DELETE FROM warehouse.fact_lead
        WHERE lead_key = (
            SELECT l.lead_key FROM warehouse.fact_lead AS l
            WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_appointment AS a
                              WHERE a.lead_key = l.lead_key)
            ORDER BY l.lead_key LIMIT 1)
        """,
    ),
    "RECON-LEAD-DUPLICATES": (
        "UPDATE warehouse.fact_lead SET is_duplicate = false, original_lead_id = NULL "
        "WHERE lead_key = (SELECT min(lead_key) FROM warehouse.fact_lead WHERE is_duplicate)",
    ),
    "RECON-FUNNEL-BOUNDS": (
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT ck_fact_lead_appointment_requires_contact",
        "UPDATE warehouse.fact_lead SET is_contacted = false "
        "WHERE lead_key = (SELECT min(lead_key) FROM warehouse.fact_lead "
        "WHERE is_appointment_set AND NOT is_duplicate)",
    ),
    "RECON-FUNNEL-SOLD-PATH": (
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT ck_fact_lead_shown_requires_appointment",
        "UPDATE warehouse.fact_lead SET is_appointment_shown = true "
        "WHERE lead_key = (SELECT min(lead_key) FROM warehouse.fact_lead "
        "WHERE NOT is_appointment_shown AND NOT is_duplicate)",
    ),
    "RECON-MKT-SPEND": (
        # Orphaning a lead source removes it from vw_lead_source, and
        # vw_marketing_performance inner-joins that view. The spend and the attributed
        # outcomes of the source vanish from the reporting layer while the warehouse still
        # holds them -- which is the exact divergence a full outer join can hide.
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT fk_fact_lead_lead_source",
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_lead_source",
        "ALTER TABLE warehouse.fact_marketing_spend "
        "DROP CONSTRAINT fk_fact_marketing_spend_lead_source",
        """
    DELETE FROM warehouse.dim_lead_source
    WHERE lead_source_key = (
        SELECT m.lead_source_key FROM warehouse.fact_marketing_spend AS m
        WHERE EXISTS (SELECT 1 FROM warehouse.fact_lead AS l
                      WHERE l.lead_source_key = m.lead_source_key AND NOT l.is_duplicate)
        ORDER BY m.lead_source_key LIMIT 1)
            """,
    ),
    "RECON-MKT-LEADS": (
        # Orphaning a lead source removes it from vw_lead_source, and
        # vw_marketing_performance inner-joins that view. The spend and the attributed
        # outcomes of the source vanish from the reporting layer while the warehouse still
        # holds them -- which is the exact divergence a full outer join can hide.
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT fk_fact_lead_lead_source",
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_lead_source",
        "ALTER TABLE warehouse.fact_marketing_spend "
        "DROP CONSTRAINT fk_fact_marketing_spend_lead_source",
        """
    DELETE FROM warehouse.dim_lead_source
    WHERE lead_source_key = (
        SELECT m.lead_source_key FROM warehouse.fact_marketing_spend AS m
        WHERE EXISTS (SELECT 1 FROM warehouse.fact_lead AS l
                      WHERE l.lead_source_key = m.lead_source_key AND NOT l.is_duplicate)
        ORDER BY m.lead_source_key LIMIT 1)
            """,
    ),
    "RECON-MKT-SALES": (
        # Orphaning a lead source removes it from vw_lead_source, and
        # vw_marketing_performance inner-joins that view. The spend and the attributed
        # outcomes of the source vanish from the reporting layer while the warehouse still
        # holds them -- which is the exact divergence a full outer join can hide.
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT fk_fact_lead_lead_source",
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_lead_source",
        "ALTER TABLE warehouse.fact_marketing_spend "
        "DROP CONSTRAINT fk_fact_marketing_spend_lead_source",
        """
    DELETE FROM warehouse.dim_lead_source
    WHERE lead_source_key = (
        SELECT m.lead_source_key FROM warehouse.fact_marketing_spend AS m
        WHERE EXISTS (SELECT 1 FROM warehouse.fact_lead AS l
                      WHERE l.lead_source_key = m.lead_source_key AND NOT l.is_duplicate)
        ORDER BY m.lead_source_key LIMIT 1)
            """,
    ),
    "RECON-MKT-GROSS": (
        # Orphaning a lead source removes it from vw_lead_source, and
        # vw_marketing_performance inner-joins that view. The spend and the attributed
        # outcomes of the source vanish from the reporting layer while the warehouse still
        # holds them -- which is the exact divergence a full outer join can hide.
        "ALTER TABLE warehouse.fact_lead DROP CONSTRAINT fk_fact_lead_lead_source",
        "ALTER TABLE warehouse.fact_vehicle_sale DROP CONSTRAINT fk_fact_vehicle_sale_lead_source",
        "ALTER TABLE warehouse.fact_marketing_spend "
        "DROP CONSTRAINT fk_fact_marketing_spend_lead_source",
        """
    DELETE FROM warehouse.dim_lead_source
    WHERE lead_source_key = (
        SELECT m.lead_source_key FROM warehouse.fact_marketing_spend AS m
        WHERE EXISTS (SELECT 1 FROM warehouse.fact_lead AS l
                      WHERE l.lead_source_key = m.lead_source_key AND NOT l.is_duplicate)
        ORDER BY m.lead_source_key LIMIT 1)
            """,
    ),
}

#: Reconciliations that no data change can break, and the view substitution that does.
#:
#: These are layer invariants: both sides read the same rows through one expression, so
#: the only way they can diverge is a change to that expression -- which is the
#: regression the rule guards against.
VIEW_CORRUPTIONS: dict[str, tuple[str, str, str]] = {
    "RECON-MKT-COST-RULE": (
        "vw_marketing_performance",
        "ls.is_paid AS is_cost_attributable",
        "false AS is_cost_attributable",
    ),
    "RECON-REPORT-LEADS-ROWS": (
        "vw_leads",
        "FROM warehouse.fact_lead l",
        "FROM warehouse.fact_lead l "
        "WHERE l.lead_key <> (SELECT min(x.lead_key) FROM warehouse.fact_lead x)",
    ),
    "RECON-REPORT-APPOINTMENTS-ROWS": (
        "vw_appointments",
        "FROM warehouse.fact_appointment a",
        "FROM warehouse.fact_appointment a "
        "WHERE a.appointment_key <> "
        "(SELECT min(x.appointment_key) FROM warehouse.fact_appointment x)",
    ),
    "RECON-REPORT-SPEND-ROWS": (
        "vw_marketing_spend",
        "FROM warehouse.fact_marketing_spend m",
        "FROM warehouse.fact_marketing_spend m "
        "WHERE m.marketing_spend_key <> "
        "(SELECT min(x.marketing_spend_key) FROM warehouse.fact_marketing_spend x)",
    ),
}


def test_every_critical_reconciliation_has_a_corruption_case() -> None:
    """No critical rule may go untested, and none may be quietly dropped from the list."""
    covered = set(DATA_CORRUPTIONS) | set(VIEW_CORRUPTIONS)
    missing = set(CRITICAL_SQL_RECONCILIATION_IDS) - covered
    assert not missing, f"critical reconciliations with no corruption case: {sorted(missing)}"
    stray = covered - set(SQL_RECONCILIATION_IDS)
    assert not stray, f"corruption cases for unknown reconciliations: {sorted(stray)}"


@pytest.mark.parametrize("reconciliation_id", sorted(DATA_CORRUPTIONS))
def test_a_corrupted_fixture_fails_the_reconciliation(
    loaded_cursor: Any, reconciliation_id: str
) -> None:
    assert _status(loaded_cursor, reconciliation_id) == "passed"

    for statement in DATA_CORRUPTIONS[reconciliation_id]:
        loaded_cursor.execute(statement)
        assert loaded_cursor.rowcount != 0, (
            f"the corruption for {reconciliation_id} changed nothing; the fixture does not "
            "contain the row this case needs"
        )

    assert _status(loaded_cursor, reconciliation_id) == "failed", (
        f"{reconciliation_id} still passes after its fixture was deliberately corrupted, "
        "so it is not proving anything"
    )


@pytest.mark.parametrize("reconciliation_id", sorted(VIEW_CORRUPTIONS))
def test_a_corrupted_view_fails_the_reconciliation(
    loaded_cursor: Any, reconciliation_id: str
) -> None:
    assert _status(loaded_cursor, reconciliation_id) == "passed"

    view_name, old, new = VIEW_CORRUPTIONS[reconciliation_id]
    _corrupt_view(loaded_cursor, view_name, old, new)

    assert _status(loaded_cursor, reconciliation_id) == "failed", (
        f"{reconciliation_id} still passes after reporting.{view_name} was deliberately "
        "changed, so it is not proving anything"
    )


def test_the_funnel_chain_is_informational_but_still_falsifiable(loaded_cursor: Any) -> None:
    """The one non-critical rule still has to be able to report a breach.

    A rule that can only ever pass is decoration. Widening the gap between the funnel
    chain and modelled-path conversion past the tolerance must flip it to failed, even
    though a breach is a finding to explain rather than a defect.
    """
    assert _status(loaded_cursor, "RECON-FUNNEL-CHAIN") == "passed"

    loaded_cursor.execute(
        "ALTER TABLE warehouse.fact_appointment "
        "DROP CONSTRAINT ck_fact_appointment_shown_excludes_cancellation"
    )
    loaded_cursor.execute(
        "UPDATE warehouse.fact_appointment SET is_cancelled_in_advance = true WHERE NOT is_shown"
    )
    assert loaded_cursor.rowcount > 0

    assert _status(loaded_cursor, "RECON-FUNNEL-CHAIN") == "failed"
