# `sql/04_facts/` — five fact tables, and not one fact row

**Status: DDL Implemented (Phase 1.2). Data Planned.**

Read that heading literally, because the distinction is the whole point of this file.
The five fact tables below **exist** in the warehouse: they are created, typed,
constrained, commented and covered by tests. **No fact row has ever been loaded into any
of them, and no measure has ever been computed from one.** Nothing in this repository
should be read as claiming otherwise, and
`tests/integration/test_schema_objects.py::test_fact_tables_are_empty` asserts it on
every run rather than leaving it to this paragraph.

| File | Table | Declared grain | Type | Rows |
|---|---|---|---|---:|
| `00_fact_vehicle_sale.sql` | `warehouse.fact_vehicle_sale` | One row per finalized vehicle transaction | Transaction | 0 |
| `01_fact_vehicle_inventory_snapshot.sql` | `warehouse.fact_vehicle_inventory_snapshot` | One row per vehicle per store per snapshot date, while in stock | Periodic snapshot | 0 |
| `02_fact_lead.sql` | `warehouse.fact_lead` | One row per unique CRM lead | Accumulating snapshot | 0 |
| `03_fact_appointment.sql` | `warehouse.fact_appointment` | One row per scheduled appointment | Accumulating snapshot | 0 |
| `04_fact_marketing_spend.sql` | `warehouse.fact_marketing_spend` | One row per store per campaign per calendar month | Periodic snapshot | 0 |

---

## Why the DDL landed before the data

Phase 0's version of this file argued the opposite case — that an empty fact table lets a
Power BI model bind to something that has never held a row and produce "dashboards full
of confident zeros". That risk is real and has not gone away. What changed is that the
grain, the columns, the types and the arithmetic identities are now **fixed** by the
Phase 1 cross-agent contract, and several agents are building generators against them
concurrently. Publishing the constrained DDL now means:

- every generator author writes against a table that will reject a violation, instead of
  against a prose description of one;
- the arithmetic identities (`front_end_gross`, `total_gross`, `inventory_investment`)
  are enforced by the database from the first row ever inserted, not retrofitted after a
  loading bug has already produced a plausible-looking wrong number;
- the dimensional model is reviewable as a whole, foreign keys included.

The confident-zeros risk is instead managed where it actually bites: no reporting view
selects from any of these tables, `sql/05_reporting/00_reporting_scope.sql` still records
the sales and inventory views as absent, and the emptiness is asserted by a test.

## What has to be true before rows arrive

1. The conformed dimensions load cleanly and pass their `DQ-*` checks. `dim_date` and
   `dim_dealership` do today; the six Phase 1 dimensions are loaded by
   `sql/03_dimensions/12_*` through `17_*`.
2. The generator for the business process exists, is deterministic, and its output passes
   the privacy tripwire.
3. `docs/source-to-target/` carries the mapping. `STM-008` and `STM-009` are written;
   `STM-011`, `STM-012` and `STM-014` are Agent H's.
4. The load script — `10_fact_vehicle_sale_load.sql` onward, following the same
   `NN_<name>_load.sql` convention the dimension merges use — lands in the same change as
   the data, together with its `DQ-*` checks and any index a real query needs.

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
