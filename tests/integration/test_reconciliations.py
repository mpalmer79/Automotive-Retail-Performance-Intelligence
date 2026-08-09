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


#: The run these reconciliations belong to.
#:
#: Names the PIPELINE rather than taking ``max(pipeline_run_id)``. The newest run is only
#: the pipeline's run while nothing else writes one, and that stopped being true when the
#: sanitized listing lane started recording an audit run per import. A test that means
#: "the run the fixture made" should say so; the alternative is a test that breaks when an
#: unrelated feature writes to a table it never reads.
PIPELINE_RUN_SQL = """
    SELECT max(pipeline_run_id)
    FROM audit.pipeline_run
    WHERE pipeline_name = 'phase0_foundation'
"""


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
    run_id = _scalar(loaded_cursor, PIPELINE_RUN_SQL)
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
    run_id = _scalar(loaded_cursor, PIPELINE_RUN_SQL)
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


def test_criticality_is_waived_for_exactly_two_rules() -> None:
    """Criticality is a deliberate, narrow exception, not a convenience.

    ``RECON-FUNNEL-CHAIN`` multiplies two lead-grain rates by two appointment-grain rates,
    so its product is an approximation that cannot be made an identity.
    ``RECON-ACC-GL-SUBLEDGER`` joins it for a different reason: ``DASH.8`` deliberately
    plants controlled variances so the reconciliation surface can be seen working in both
    its states, and failing a run because such a variance exists would make the exception
    surface unusable. Both are still falsifiable -- see the two tests at the end of this
    module -- and both still record their verdict on every run.
    """
    assert {"RECON-FUNNEL-CHAIN", "RECON-ACC-GL-SUBLEDGER"} == NON_CRITICAL_RECONCILIATION_IDS
    assert len(CRITICAL_SQL_RECONCILIATION_IDS) == len(SQL_RECONCILIATION_IDS) - 2


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
              -- DASH.6: and no F&I contract, so this corruption still tests the count rule
              -- and nothing else. A deal that carried products would fail on the foreign
              -- key instead, which proves the constraint rather than the reconciliation --
              -- and the generator produces plenty of deals carrying none.
              AND NOT EXISTS (SELECT 1 FROM warehouse.fact_finance_product_sale AS ps
                              WHERE ps.sale_key = s.sale_key)
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
        # DASH.8: a third fact now references dim_vehicle. Deleting a unit is the
        # corruption these rules need, so the accounting schedule's reference has to
        # be released too -- otherwise the case would test the new foreign key rather
        # than the reconciliation it was written for.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT fk_fact_inventory_accounting_vehicle",
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
    # ----------------------------------------------------------------------------------
    # Targets and pace (DASH.5)
    # ----------------------------------------------------------------------------------
    # A target is a DENOMINATOR. Losing one does not make a number look empty -- it makes
    # every attainment percentage on the console LARGER, and larger reads as good news.
    # These three are the seeded defects that prove the guard is alive.
    "RECON-FACT-SALES-TARGET-WAREHOUSE": (
        "DELETE FROM warehouse.fact_sales_target WHERE sales_target_key = "
        "(SELECT min(sales_target_key) FROM warehouse.fact_sales_target)",
    ),
    "RECON-TGT-GRAIN": (
        # The grain is enforced by uq_fact_sales_target_grain, so a duplicate cannot be
        # inserted while the constraint is on the table. Dropping it first is the point:
        # the reconciliation exists to prove the constraint is STILL THERE rather than to
        # trust that it is, and this is the only way to seed the defect it guards against.
        "ALTER TABLE warehouse.fact_sales_target DROP CONSTRAINT uq_fact_sales_target_grain",
        """
        INSERT INTO warehouse.fact_sales_target (
            sales_target_key, target_month_date_key, dealership_key, target_scope_type,
            target_scope_id, department_name, employee_key, kpi_id, target_value,
            stretch_target_value, source_system)
        SELECT (SELECT max(x.sales_target_key) FROM warehouse.fact_sales_target AS x) + 1,
               t.target_month_date_key, t.dealership_key, t.target_scope_type,
               t.target_scope_id, t.department_name, t.employee_key, t.kpi_id,
               t.target_value, t.stretch_target_value, t.source_system
        FROM warehouse.fact_sales_target AS t
        WHERE t.sales_target_key =
              (SELECT min(y.sales_target_key) FROM warehouse.fact_sales_target AS y)
        """,
    ),
    # ----------------------------------------------------------------------------------
    # The F&I domain (DASH.6)
    # ----------------------------------------------------------------------------------
    "RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE": (
        # ONE CONTRACT REMOVED, chosen from the ones carrying no adjustment so the delete
        # tests the count rule rather than the foreign key. A contract lost between
        # staging and the warehouse reduces a deal's EXPLAINED back-end gross without
        # reducing the stored back-end gross.
        """
        DELETE FROM warehouse.fact_finance_product_sale
        WHERE product_sale_key = (
            SELECT min(ps.product_sale_key) FROM warehouse.fact_finance_product_sale AS ps
            WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_finance_product_adjustment AS a
                              WHERE a.product_sale_key = ps.product_sale_key))
        """,
    ),
    "RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE": (
        # ONE EVENT THE STAGING VIEW NEVER PRODUCED, inserted straight into the warehouse.
        # Planted as an INSERT rather than a DELETE because the fixture's short window
        # legitimately produces very few adjustments, and a corruption that depends on a
        # particular row existing is a corruption that silently stops testing anything.
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-CHAINBRK', ps.product_sale_key, ps.sale_key, ps.sale_date_key,
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 1.00, 'Early Payoff', 99, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """,
    ),
    "RECON-FI-001": (
        # ONE CENT ON ONE DEAL -- the increment's second named seeded defect. The identity
        # is exact, so a single cent must fail it. total_gross moves with back_end_gross so
        # ck_fact_vehicle_sale_total_gross_identity stays satisfied and the corruption
        # tests RECON-FI-001 rather than that CHECK.
        """
        UPDATE warehouse.fact_vehicle_sale
        SET back_end_gross = back_end_gross + 0.01,
            total_gross    = total_gross + 0.01
        WHERE sale_key = (SELECT min(ps.sale_key) FROM warehouse.fact_finance_product_sale AS ps)
        """,
    ),
    "RECON-FI-DEAL-LEVEL": (
        "UPDATE warehouse.fact_vehicle_sale "
        "SET back_end_gross = back_end_gross + 0.01, total_gross = total_gross + 0.01 "
        "WHERE sale_key = (SELECT min(ps.sale_key) "
        "FROM warehouse.fact_finance_product_sale AS ps)",
    ),
    "RECON-FI-TOTAL-GROSS": (
        # The pre-existing identity, which DASH.6 must not have disturbed. Seeded by
        # dropping the CHECK first: the rule exists to prove the constraint is STILL on
        # the table, and that is the only way to plant the defect it guards against.
        "ALTER TABLE warehouse.fact_vehicle_sale "
        "DROP CONSTRAINT ck_fact_vehicle_sale_total_gross_identity",
        "UPDATE warehouse.fact_vehicle_sale SET total_gross = total_gross + 0.01 "
        "WHERE sale_key = (SELECT min(sale_key) FROM warehouse.fact_vehicle_sale)",
    ),
    "RECON-FI-PRODUCT-IDENTITY": (
        # PRICE MINUS COST, OFF BY ONE CENT -- the increment's first named seeded defect.
        # The CHECK is dropped first for the same reason as above.
        "ALTER TABLE warehouse.fact_finance_product_sale "
        "DROP CONSTRAINT ck_fact_finance_product_sale_gross_identity",
        "UPDATE warehouse.fact_finance_product_sale "
        "SET product_retail_price = product_retail_price + 0.01 "
        "WHERE product_sale_key = (SELECT min(product_sale_key) "
        "FROM warehouse.fact_finance_product_sale)",
    ),
    "RECON-FI-PRODUCT-GRAIN": (
        # A SECOND CONTRACT FOR THE SAME PRODUCT ON THE SAME DEAL. Impossible while the
        # grain constraint is on the table, which is exactly what the rule proves.
        "ALTER TABLE warehouse.fact_finance_product_sale "
        "DROP CONSTRAINT uq_fact_finance_product_sale_grain",
        """
        INSERT INTO warehouse.fact_finance_product_sale (
            product_sale_key, product_sale_id, sale_key, sale_date_key, dealership_key,
            finance_manager_key, finance_product_key, lender_key, finance_structure,
            eligibility_rule_id, line_ordinal, product_sale_count, product_retail_price,
            product_dealer_cost, original_product_gross, contract_term_months, source_system)
        SELECT (SELECT max(x.product_sale_key) FROM warehouse.fact_finance_product_sale AS x) + 1,
               ps.product_sale_id || '-D', ps.sale_key, ps.sale_date_key, ps.dealership_key,
               ps.finance_manager_key, ps.finance_product_key, ps.lender_key,
               ps.finance_structure, ps.eligibility_rule_id, ps.line_ordinal + 1,
               ps.product_sale_count, ps.product_retail_price, ps.product_dealer_cost,
               ps.original_product_gross, ps.contract_term_months, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """,
    ),
    "RECON-FI-ADJUSTMENT-GRAIN": (
        # TWO EVENTS SHARING ONE adjustment_id. Impossible while the grain constraint is
        # on the table, which is exactly what the rule proves. Both rows are inserted so
        # the corruption does not depend on the fixture already containing an event.
        "ALTER TABLE warehouse.fact_finance_product_adjustment "
        "DROP CONSTRAINT uq_fact_finance_product_adjustment_adjustment_id",
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-DUPGRAIN', ps.product_sale_key, ps.sale_key, ps.sale_date_key,
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 1.00, 'Early Payoff', 97, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """,
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-DUPGRAIN', ps.product_sale_key, ps.sale_key, ps.sale_date_key,
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 1.00, 'Early Payoff', 98, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (SELECT min(y.product_sale_key)
                                     FROM warehouse.fact_finance_product_sale AS y)
        """,
    ),
    "RECON-FI-RESERVE-STRUCTURE": (
        # RESERVE ON A CASH DEAL: the one thing this domain must never do. The CHECK is
        # dropped first because it makes the row unstorable, which is the intended
        # protection -- the reconciliation proves the CHECK is still there.
        "ALTER TABLE warehouse.fact_vehicle_sale "
        "DROP CONSTRAINT ck_fact_vehicle_sale_reserve_requires_financing",
        """
        UPDATE warehouse.fact_vehicle_sale
        SET finance_reserve_gross = 100.00
        WHERE sale_key = (
            SELECT min(s.sale_key) FROM warehouse.fact_vehicle_sale AS s
            WHERE s.is_retail AND s.amount_financed = 0 AND s.sale_type <> 'Lease')
        """,
    ),
    "RECON-FI-ELIGIBILITY": (
        # GAP ON A CASH DEAL -- the increment's third named seeded defect. Repointing one
        # contract at a GAP product on a cash deal puts a numerator outside its own
        # denominator, which is what would make a penetration figure exceed 100%.
        """
        UPDATE warehouse.fact_finance_product_sale
        SET finance_product_key = (SELECT p.finance_product_key
                                   FROM warehouse.dim_finance_product AS p
                                   WHERE p.product_category = 'GAP'
                                   ORDER BY p.finance_product_key LIMIT 1),
            eligibility_rule_id = 'ELIG-GAP'
        WHERE product_sale_key = (
            SELECT min(ps.product_sale_key)
            FROM warehouse.fact_finance_product_sale AS ps
            WHERE ps.finance_structure = 'Cash')
        """,
    ),
    "RECON-FI-ADJUSTMENT-CAP": (
        # A CHARGEBACK EXCEEDING THE ORIGINAL PRODUCT GROSS -- the increment's fifth named
        # seeded defect. Inserted rather than mutated, so the case does not depend on the
        # fixture's short window happening to have produced an adjustment. Taking back
        # more than was ever produced is a figure the model says is impossible.
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-OVERCAP', ps.product_sale_key, ps.sale_key, ps.sale_date_key,
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', ps.original_product_gross + 1000.00, 'Early Payoff', 96,
               ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        WHERE ps.product_sale_key = (
            SELECT min(y.product_sale_key) FROM warehouse.fact_finance_product_sale AS y
            WHERE NOT EXISTS (SELECT 1 FROM warehouse.fact_finance_product_adjustment AS a
                              WHERE a.product_sale_key = y.product_sale_key))
        """,
    ),
    "RECON-FI-ADJUSTMENT-SEQUENCE": (
        # AN ADJUSTMENT DATED BEFORE ITS OWN CONTRACT -- the increment's seventh named
        # seeded defect. Cancelling a contract before it was written is an impossible
        # sequence, and no CHECK can see it because it spans two tables.
        """
        INSERT INTO warehouse.fact_finance_product_adjustment (
            adjustment_key, adjustment_id, product_sale_key, sale_key, adjustment_date_key,
            dealership_key, finance_manager_key, finance_product_key, adjustment_type,
            adjustment_amount, adjustment_reason_category, sequence_ordinal, source_system)
        SELECT (SELECT coalesce(max(x.adjustment_key), 0) + 1
                FROM warehouse.fact_finance_product_adjustment AS x),
               'FPA-PRESALE', ps.product_sale_key, ps.sale_key,
               (SELECT min(d.date_key) FROM warehouse.dim_date AS d),
               ps.dealership_key, ps.finance_manager_key, ps.finance_product_key,
               'Chargeback', 1.00, 'Early Payoff', 95, ps.source_system
        FROM warehouse.fact_finance_product_sale AS ps
        -- The LAST contract written, so the calendar's first day is strictly before its
        -- sale date. Picking the first contract would place the event ON its sale date on
        -- a fixture whose window opens with a delivery, and 'not before' would hold.
        WHERE ps.product_sale_key = (
            SELECT y.product_sale_key FROM warehouse.fact_finance_product_sale AS y
            ORDER BY y.sale_date_key DESC, y.product_sale_key DESC LIMIT 1)
        """,
    ),
    "RECON-TGT-DEPT-SPLIT": (
        # ONE TARGET, CHANGED BY 1.00. The Sales and Finance department gross plans are a
        # partition of the store's total-gross plan, mirroring total = front + back on the
        # sale fact. A single cent of drift breaks the identity, and a department view and
        # a store view would then disagree about the same month with neither obviously
        # wrong. One dollar is used rather than one cent so the failure is unambiguous
        # against the 0.01 currency tolerance the rule carries.
        "UPDATE warehouse.fact_sales_target SET target_value = target_value + 1.00 "
        "WHERE sales_target_key = (SELECT min(sales_target_key) "
        "FROM warehouse.fact_sales_target WHERE department_name = 'Sales')",
    ),
    # ----------------------------------------------------------------------------------
    # The inventory accounting and GL control domain (DASH.8)
    # ----------------------------------------------------------------------------------
    # Several of these DROP A CONSTRAINT before corrupting the row, which is deliberate:
    # the rule they test exists precisely to catch a database whose constraints are no
    # longer intact, and a corruption the CHECK refuses would test the CHECK instead.
    "RECON-FACT-INVENTORY-ACCOUNTING-WAREHOUSE": (
        # ONE SCHEDULE LINE LOST BETWEEN STAGING AND THE WAREHOUSE. Its carrying amount
        # disappears from the subledger balance and manufactures a GL variance that
        # describes nothing.
        "DELETE FROM warehouse.fact_inventory_accounting_snapshot "
        "WHERE inventory_accounting_key = "
        "(SELECT min(inventory_accounting_key) FROM warehouse.fact_inventory_accounting_snapshot)",
    ),
    "RECON-FACT-GL-CONTROL-BALANCE-WAREHOUSE": (
        # ONE CONTROL BALANCE LOST. The reconciliation would report it as a missing GL
        # side -- a different finding from a variance -- and this names which layer lost it.
        "DELETE FROM warehouse.fact_gl_control_balance WHERE gl_control_balance_key = "
        "(SELECT min(gl_control_balance_key) FROM warehouse.fact_gl_control_balance)",
    ),
    "RECON-ACC-BOOK-IDENTITY": (
        # ONE CENT ON ONE LINE, with the CHECK removed first. The identity is exact and
        # per line, so a single cent on a single unit must fail it -- and dropping the
        # constraint is what makes this a test of the RECONCILIATION rather than of the
        # constraint that normally makes the row unloadable.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT ck_fact_inventory_accounting_book_value_identity",
        "UPDATE warehouse.fact_inventory_accounting_snapshot "
        "SET current_book_value = current_book_value + 0.01 "
        "WHERE inventory_accounting_key = "
        "(SELECT min(inventory_accounting_key) FROM warehouse.fact_inventory_accounting_snapshot)",
    ),
    "RECON-ACC-BOOK-COMPONENTS": (
        # A NEGATIVE WRITE-DOWN, which is a write-UP this model does not represent -- with
        # the carrying value moved to match so the book-value IDENTITY still closes. That
        # is the whole point of this rule being separate: the identity closes just as
        # neatly with a nonsense component inside it.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT ck_fact_inventory_accounting_write_down_nonnegative",
        "UPDATE warehouse.fact_inventory_accounting_snapshot "
        "SET write_down_amount = -100.00, current_book_value = current_book_value "
        "                                                    + write_down_amount + 100.00 "
        "WHERE inventory_accounting_key = "
        "(SELECT min(inventory_accounting_key) FROM warehouse.fact_inventory_accounting_snapshot)",
    ),
    "RECON-ACC-PACK-EXCLUDED": (
        # PACK MOVED OUT OF THE FRONT-GROSS IDENTITY on one deal. This is the corruption
        # that stands in for an accounting increment quietly capitalizing pack: KPI-GRS-001
        # would change and nothing else in DASH.8 would notice.
        "ALTER TABLE warehouse.fact_vehicle_sale "
        "DROP CONSTRAINT ck_fact_vehicle_sale_front_end_gross_identity",
        "UPDATE warehouse.fact_vehicle_sale SET pack_amount = pack_amount + 100.00 "
        "WHERE sale_key = (SELECT min(sale_key) FROM warehouse.fact_vehicle_sale)",
    ),
    "RECON-ACC-FLOORPLAN-EXCLUDED": (
        # EVERY FLOORPLAN BALANCE ZEROED. The book identity still holds afterwards, which
        # is exactly the point: an identity that closes proves nothing about floorplan
        # exclusion if there is no floorplan principal left to exclude.
        "UPDATE warehouse.fact_inventory_accounting_snapshot SET floorplan_principal = 0.00 "
        "WHERE floorplan_principal > 0",
    ),
    "RECON-ACC-POPULATION": (
        # ONE UNIT REMOVED FROM THE OPERATIONAL INVENTORY on an accounting date, leaving a
        # schedule line the control account is asked to support for a unit that is not on
        # the floor.
        """
        DELETE FROM warehouse.fact_vehicle_inventory_snapshot AS i
        WHERE i.inventory_snapshot_key = (
            SELECT min(x.inventory_snapshot_key)
            FROM warehouse.fact_vehicle_inventory_snapshot AS x
            JOIN warehouse.fact_inventory_accounting_snapshot AS f
              ON f.accounting_date_key = x.snapshot_date_key
             AND f.dealership_key = x.dealership_key
             AND f.vehicle_key = x.vehicle_key)
        """,
    ),
    "RECON-ACC-CATEGORY-TOTALS": (
        # ONE LINE MISROUTED to a different control account. The grand total is unchanged
        # -- both account totals are wrong in offsetting directions -- so a rule that
        # checked only the sum would pass. This is why the rule checks the MAPPING too.
        """
        UPDATE warehouse.fact_inventory_accounting_snapshot AS f
        SET gl_account_key = (
            SELECT min(a.gl_account_key) FROM warehouse.dim_gl_account AS a
            WHERE a.gl_account_key <> f.gl_account_key)
        WHERE f.inventory_accounting_key = (
            SELECT min(x.inventory_accounting_key)
            FROM warehouse.fact_inventory_accounting_snapshot AS x)
        """,
    ),
    "RECON-ACC-GRAIN": (
        # A SECOND SCHEDULE LINE FOR ONE UNIT ON ONE DATE, with the grain constraint
        # dropped first. The unit's carrying amount would be counted twice in the control
        # balance and would manufacture a variance that is not there.
        "ALTER TABLE warehouse.fact_inventory_accounting_snapshot "
        "DROP CONSTRAINT uq_fact_inventory_accounting_snapshot_grain",
        """
        INSERT INTO warehouse.fact_inventory_accounting_snapshot
        SELECT (SELECT max(x.inventory_accounting_key) + 1
                FROM warehouse.fact_inventory_accounting_snapshot AS x),
               f.accounting_date_key, f.dealership_key, f.vehicle_key, f.gl_account_key,
               f.control_account_category, f.acquisition_cost, f.capitalized_transportation,
               f.capitalized_reconditioning, f.capitalized_accessories,
               f.other_capitalized_costs, f.write_down_amount, f.current_book_value,
               f.floorplan_principal, f.days_in_stock, f.source_system
        FROM warehouse.fact_inventory_accounting_snapshot AS f
        WHERE f.inventory_accounting_key = (
            SELECT min(y.inventory_accounting_key)
            FROM warehouse.fact_inventory_accounting_snapshot AS y)
        """,
    ),
    "RECON-GLB-GRAIN": (
        # A SECOND CONTROL BALANCE AT ONE POSITION, which would double the control side.
        "ALTER TABLE warehouse.fact_gl_control_balance "
        "DROP CONSTRAINT uq_fact_gl_control_balance_grain",
        """
        INSERT INTO warehouse.fact_gl_control_balance
        SELECT (SELECT max(x.gl_control_balance_key) + 1
                FROM warehouse.fact_gl_control_balance AS x),
               b.balance_date_key, b.dealership_key, b.gl_account_key, b.net_balance,
               b.source_system
        FROM warehouse.fact_gl_control_balance AS b
        WHERE b.gl_control_balance_key = (
            SELECT min(y.gl_control_balance_key) FROM warehouse.fact_gl_control_balance AS y)
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
    # ----------------------------------------------------------------------------------
    # Targets and pace (DASH.5)
    # ----------------------------------------------------------------------------------
    # Each of these compares the target reporting view against the warehouse objects it
    # projects. Both sides read the same rows, so no data change can separate them: the
    # regression they guard against is a change to the view's own expression, and that is
    # what is seeded here.
    "RECON-TGT-UNITS": (
        "vw_target_attainment",
        "FROM assembled a;",
        "FROM assembled a WHERE NOT (a.target_scope_type::text = 'Store'::text "
        "AND a.target_kpi_id::text = 'KPI-SLS-001'::text "
        "AND a.target_month = (SELECT min(x.target_month) FROM assembled x));",
    ),
    "RECON-TGT-GROSS": (
        "vw_target_attainment",
        "FROM assembled a;",
        "FROM assembled a WHERE NOT (a.target_scope_type::text = 'Store'::text "
        "AND a.target_kpi_id::text = 'KPI-GRS-003'::text "
        "AND a.target_month = (SELECT min(x.target_month) FROM assembled x));",
    ),
    "RECON-TGT-STORE-TOTALS": (
        "vw_target_attainment",
        "FROM assembled a;",
        "FROM assembled a WHERE NOT (a.target_scope_type::text = 'Store'::text "
        "AND a.dealership_key = (SELECT min(x.dealership_key) FROM assembled x));",
    ),
    "RECON-TGT-MONTH-TOTALS": (
        "vw_target_attainment",
        "FROM assembled a;",
        "FROM assembled a WHERE NOT (a.target_scope_type::text = 'Store'::text "
        "AND a.target_month = (SELECT max(x.target_month) FROM assembled x));",
    ),
    "RECON-REPORT-TARGET-ROWS": (
        # A FAN-OUT, which is the failure this rule exists for: the view joins four
        # aggregates and a LEFT JOIN to the plan, and a duplicated join key would double
        # both the target and the actual -- invisible in a percentage, and fatal in a
        # total.
        "vw_target_attainment",
        "FROM assembled a;",
        "FROM assembled a CROSS JOIN (VALUES (1), (2)) AS dup(n);",
    ),
    "RECON-TGT-ACTUAL-UNITS": (
        # The attainment numerator must BE KPI-SLS-001, not a second count that resembles
        # it. One unit removed per row is enough to prove the rule reads the governed
        # actual rather than whatever the view happens to publish.
        "vw_target_attainment",
        "    actual_mtd_value,\n    actual_mtd_value AS attainment_numerator,",
        "    actual_mtd_value - 1::numeric AS actual_mtd_value,"
        "\n    actual_mtd_value AS attainment_numerator,",
    ),
    # ----------------------------------------------------------------------------------
    # The F&I domain (DASH.6)
    # ----------------------------------------------------------------------------------
    # These compare an F&I reporting view against the warehouse it projects, or check a
    # view for fan-out. Both sides read the same rows, so no data change can separate
    # them: the regression they guard against is a change to the view's own expression.
    "RECON-FI-STORE-TOTALS": (
        # ONE STORE DROPPED FROM THE VIEW. Compared per store rather than in total, so
        # two offsetting stores cannot hide each other -- and this proves it.
        "vw_fi_summary",
        "FROM deal_totals t",
        "FROM (SELECT * FROM deal_totals WHERE dealership_key <> "
        "(SELECT min(x.dealership_key) FROM deal_totals x)) t",
    ),
    "RECON-FI-PERIOD-TOTALS": (
        # ONE DAY OF CONTRACT GROSS DROPPED, which moves exactly one month. A month lost
        # by the reporting frame would otherwise render as a month in which the F&I
        # office wrote nothing.
        "vw_fi_summary",
        "LEFT JOIN contract_totals c ON c.dealership_key = t.dealership_key",
        "LEFT JOIN (SELECT * FROM contract_totals WHERE sale_date_key <> "
        "(SELECT min(x.sale_date_key) FROM contract_totals x)) c "
        "ON c.dealership_key = t.dealership_key",
    ),
    "RECON-FI-NET-GROSS": (
        # ONE CENT ON THE AS-OF SIDE. The rule reconciles net product gross on its OWN
        # basis, and a cent of drift between the warehouse derivation and the view is
        # exactly what it exists to catch.
        "vw_fi_summary",
        "COALESCE(c.original_product_gross, 0.00) - "
        "COALESCE(adj.cumulative_adjustment_amount, 0.00) AS net_product_gross_as_of,",
        "COALESCE(c.original_product_gross, 0.00) - "
        "COALESCE(adj.cumulative_adjustment_amount, 0.00) - 0.01 AS net_product_gross_as_of,",
    ),
    "RECON-REPORT-FI-DETAIL-ROWS": (
        # A FAN-OUT. Doubling every row would double every product gross figure computed
        # from the view, and nothing else in the platform would notice.
        "vw_deal_product_detail",
        "CROSS JOIN governed_as_of g;",
        "CROSS JOIN governed_as_of g CROSS JOIN (VALUES (1), (2)) AS dup(n);",
    ),
    "RECON-REPORT-FI-SUMMARY-ROWS": (
        # A fan-out here would double the store's retail units AND its finance reserve,
        # which is invisible in a PVR because both sides move together.
        "vw_fi_summary",
        "CROSS JOIN governed_as_of g;",
        "CROSS JOIN governed_as_of g CROSS JOIN (VALUES (1), (2)) AS dup(n);",
    ),
    "RECON-REPORT-FI-PENETRATION-ROWS": (
        # A fan-out inflates the eligible denominator, which makes every penetration
        # figure SMALLER -- the direction that looks like a finding rather than a defect.
        "vw_fi_product_penetration",
        "CROSS JOIN governed_as_of g;",
        "CROSS JOIN governed_as_of g CROSS JOIN (VALUES (1), (2)) AS dup(n);",
    ),
    "RECON-REPORT-FI-ADJUSTMENT-ROWS": (
        "vw_fi_adjustment_summary",
        "AND cg.adjustment_type::text = t.adjustment_type::text;",
        "AND cg.adjustment_type::text = t.adjustment_type::text "
        "CROSS JOIN (VALUES (1), (2)) AS dup(n);",
    ),
    "RECON-TGT-ACTUAL-GROSS": (
        "vw_target_attainment",
        "    actual_mtd_value,\n    actual_mtd_value AS attainment_numerator,",
        "    actual_mtd_value - 0.01::numeric AS actual_mtd_value,"
        "\n    actual_mtd_value AS attainment_numerator,",
    ),
    # DASH.8. Both accounting reporting views are at a declared grain, and both rules
    # compare a row count to that grain, so a fan-out is the corruption that tests them.
    "RECON-REPORT-ACCOUNTING-ROWS": (
        "vw_inventory_accounting",
        "FROM warehouse.fact_inventory_accounting_snapshot f",
        "FROM warehouse.fact_inventory_accounting_snapshot f\n"
        "  CROSS JOIN (VALUES (1), (2)) AS dup(n)",
    ),
    "RECON-REPORT-GL-RECON-ROWS": (
        "vw_inventory_gl_reconciliation",
        "FROM compared x",
        "FROM compared x\n  CROSS JOIN (VALUES (1), (2)) AS dup(n)",
    ),
    # DASH.9. Both rules guard `reporting.vw_inventory_units`, and both are corrupted
    # through the view rather than through data: the view reads the same fact rows as the
    # thing it is compared against, so no data change can separate the two sides. What
    # they defend against is an edit to the VIEW'S OWN expression, which is what is seeded.
    "RECON-INV-UNIT-RATIO": (
        # The exact regression this rule exists for. `vw_inventory_units` repeats the
        # price_to_market_ratio expression instead of selecting it -- it reads the fact
        # directly for its window functions -- so the two copies can silently diverge.
        # Rounding to 2 places instead of 4 is the smallest plausible version of that edit:
        # it is the kind of change that looks like tidying, produces a number on every row,
        # and would put a different ratio on the unit table than on every other surface.
        "vw_inventory_units",
        "ELSE round(i.current_asking_price / NULLIF(i.market_price_estimate, 0::numeric), 4)",
        "ELSE round(i.current_asking_price / NULLIF(i.market_price_estimate, 0::numeric), 2)",
    ),
    "RECON-INV-UNIT-GRAIN": (
        # A fan-out, which is the failure the grain rule exists for: it would double every
        # unit count and every investment total the inventory route publishes, while each
        # individual row still looked entirely correct.
        "vw_inventory_units",
        "FROM reportable i",
        "FROM reportable i\n  CROSS JOIN (VALUES (1), (2)) AS dup(n)",
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


def test_the_gl_subledger_rule_is_informational_but_still_falsifiable(
    loaded_cursor: Any,
) -> None:
    """The second non-critical rule still has to be able to report a breach.

    ``RECON-ACC-GL-SUBLEDGER`` is not an equality: it passes when every comparison row is
    WELL FORMED, because ``DASH.8`` deliberately plants controlled variances and a rule
    that failed a run because one exists would make the exception surface unusable.

    A rule that can only ever pass is decoration, so this proves the one thing it does
    assert. Making the state say ``Reconciled`` on a row whose variance is not zero
    decouples the state from the arithmetic behind it -- which is exactly how a missing
    balance would come to be reported as a zeroed account -- and must flip it to failed.
    """
    assert _status(loaded_cursor, "RECON-ACC-GL-SUBLEDGER") == "passed"

    _corrupt_view(
        loaded_cursor,
        "vw_inventory_gl_reconciliation",
        "WHEN x.gl_balance = x.subledger_balance THEN 'Reconciled'::text",
        "WHEN true THEN 'Reconciled'::text",
    )

    assert _status(loaded_cursor, "RECON-ACC-GL-SUBLEDGER") == "failed", (
        "the comparison state was decoupled from the variance behind it and the rule "
        "still passes, so it is not proving anything"
    )


def test_a_controlled_variance_alone_never_fails_the_rule(loaded_cursor: Any) -> None:
    """The other direction, which matters just as much.

    The dataset carries planted variances on purpose. If their mere existence failed this
    rule, every pipeline run would report a failure and the exception surface would be
    unreadable.
    """
    variances = _scalar(
        loaded_cursor,
        "SELECT count(*) FROM reporting.vw_inventory_gl_reconciliation "
        "WHERE comparison_state = 'Variance'",
    )
    assert variances > 0, "no variance is planted, so this test proves nothing"
    assert _status(loaded_cursor, "RECON-ACC-GL-SUBLEDGER") == "passed"
