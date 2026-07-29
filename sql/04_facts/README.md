# `sql/04_facts/` — the five MVP fact tables

**Status: Implemented. All five are built, constrained, and loaded on every pipeline run.**

The five fact tables below exist in the warehouse: created, typed, constrained, commented,
covered by tests, and **populated**. Each declared grain is enforced by a `UNIQUE` or
`PRIMARY KEY` constraint over exactly the grain columns, and
`tests/integration/test_gate1_readiness.py` asserts both that the constraint exists and
that the loaded data satisfies it — which is what "approved" means for Gate 1 condition 1.

Row counts are from the `development` profile (2025-07-01 … 2025-12-31, three stores,
seed 20250701).

| File | Table | Declared grain | Type | Rows |
|---|---|---|---|---:|
| `00_fact_vehicle_sale.sql` | `warehouse.fact_vehicle_sale` | One row per finalized vehicle transaction | Transaction | 650 |
| `01_fact_vehicle_inventory_snapshot.sql` | `warehouse.fact_vehicle_inventory_snapshot` | One row per vehicle per store per snapshot date, while in stock | Periodic snapshot | 45,754 |
| `02_fact_lead.sql` | `warehouse.fact_lead` | One row per unique CRM lead | Accumulating snapshot | 6,000 |
| `03_fact_appointment.sql` | `warehouse.fact_appointment` | One row per scheduled appointment | Accumulating snapshot | 2,111 |
| `04_fact_marketing_spend.sql` | `warehouse.fact_marketing_spend` | One row per store per campaign per calendar month | Periodic snapshot | 212 |

Each table has a matching `NN_<name>_load.sql` script, which the loader runs after every
dimension merge. A fact resolves its surrogate keys by joining the dimensions, so running
a fact load before the dimensions are merged would resolve nothing.

---

## Reconciliation is what makes the loads trustworthy

Their ingestion specs carry no warehouse target — the specs describe the source entity,
and the fact is loaded by SQL rather than by a Python merge — so the loader could not
reconcile staging against the warehouse for any of these five. Until that gap was closed,
**a fact load that silently dropped rows on an unresolved surrogate key would have looked
exactly like a correct one.**

`audit.vw_recon_ingestion` closes it: each fact's distinct staged business keys are
compared against the rows the warehouse actually holds, exactly, with no tolerance, on
every run. `audit.vw_recon_reporting` then extends the chain upward, comparing each
reporting view against the fact it projects. Every one of those rules has been observed
**failing** against a deliberately corrupted fixture in
`tests/integration/test_reconciliations.py`; a reconciliation that has never been seen to
fail is not evidence.

---

## Why the DDL landed before the data

Kept as a record of the reasoning, because the risk it managed is still real.

Phase 0's version of this file argued the opposite case — that an empty fact table lets a
Power BI model bind to something that has never held a row and produce "dashboards full
of confident zeros". What changed was that the grain, the columns, the types and the
arithmetic identities became **fixed** by the Phase 1 cross-agent contract, with several
generators being built against them concurrently. Publishing the constrained DDL first
meant:

- every generator author writes against a table that will reject a violation, instead of
  against a prose description of one;
- the arithmetic identities (`front_end_gross`, `total_gross`, `inventory_investment`)
  are enforced by the database from the first row ever inserted, not retrofitted after a
  loading bug has already produced a plausible-looking wrong number;
- the dimensional model is reviewable as a whole, foreign keys included.

The confident-zeros risk was managed by refusing to build a reporting view over an empty
table. That constraint has now been satisfied rather than lifted: every reporting view
over these facts was created in the same change that first had data behind it, and
`tests/integration/test_reporting_layer_completeness.py` asserts each one returns rows.

## What had to be true before rows arrived, and now is

1. **The conformed dimensions load cleanly and pass their `DQ-*` checks.** All eight do;
   the six Phase 1 dimensions are loaded by `sql/03_dimensions/12_*` through `17_*`.
2. **The generator exists, is deterministic, and its output passes the privacy tripwire.**
   Fourteen generators, one per entity in `GENERATION_ORDER`, with the determinism digest
   recorded on every run as `DQ-GEN-002`.
3. **`docs/source-to-target/` carries the mapping.** All fourteen `STM-*` documents are
   written, and `tests/integration/test_gate1_readiness.py` asserts one exists per entity.
4. **The load script lands in the same change as the data**, together with its `DQ-*`
   checks and any index a real query needs. `10_fact_vehicle_sale_load.sql` onward follow
   the same `NN_<name>_load.sql` convention the dimension merges use.

## Rules every file here already follows

- One declared grain per table, stated in `COMMENT ON TABLE`, and enforced by a `UNIQUE`
  constraint wherever the grain is a composite: `uq_fact_vehicle_inventory_snapshot_grain`
  and `uq_fact_marketing_spend_grain` are grain constraints, not tuning indexes.
- Integer surrogate foreign keys to the conformed dimensions, with real `FOREIGN KEY`
  constraints and `ON DELETE RESTRICT` — not merely documented relationships.
- Every `date_key` resolves to `warehouse.dim_date`. A fact row for a date the calendar
  does not contain is a failed load, not a silent orphan.
- Measures are `numeric(12,2)`. Never `float`.
- Additive, semi-additive and non-additive measures are labelled as such in the column
  comments, because a semi-additive measure summed across time is the most common way a
  dashboard lies. `fact_vehicle_inventory_snapshot` is where this matters most: summing
  `inventory_investment` across thirty days reports thirty times the money the group
  actually has on the ground.
- Derived measures that are stored are also constrained, so they cannot disagree with
  their inputs.
- No customer or employee personal data, ever. See `PRIVACY_AND_ETHICS.md`.
- New indexes go in `sql/06_indexes/` only when a query that exists needs them, and
  `sql/06_indexes/01_phase1_indexes.sql` records which ones were deliberately *not*
  created and what already serves that access path.
