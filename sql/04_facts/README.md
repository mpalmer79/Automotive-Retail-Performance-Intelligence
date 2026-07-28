# `sql/04_facts/` — no fact tables yet

**Status: Planned (Phase 1.2).** This directory is intentionally empty apart from
`.gitkeep` and this file.

ARPI Phase 0 delivers the foundation only: the two conformed dimensions
(`warehouse.dim_date`, `warehouse.dim_dealership`), the raw and staging layers
that feed them, the audit layer, the reporting views over what exists, the role
model, and the tests around all of it. **No fact table has been created, no fact
row has ever been loaded, and no measure has ever been computed.** Nothing in this
repository should be read as claiming otherwise.

This file exists so that the empty directory carries a contract rather than
nothing: it states what will land here, at what grain, and what has to be true
before it can.

---

## Why the directory is empty rather than pre-populated

A fact table is defined by its grain and by the dimensions it conforms to. Both
require the dimensions to exist and be trusted first. Creating an empty
`warehouse.fact_vehicle_sale` today would:

- let a Power BI model bind to a table that has never held a row, producing
  dashboards full of confident zeros;
- freeze a grain decision before the data-generation rules that determine it have
  been written;
- make `sql/05_reporting/` look as though sales reporting exists.

So the tables arrive in the same change that generates and loads their data, with
their indexes, their data-quality checks and their reporting views.

## Prerequisites before anything is added here

1. `warehouse.dim_date` and `warehouse.dim_dealership` load cleanly and pass every
   `DQ-DATE-*` and `DQ-DLR-*` check. (Phase 0 — Implemented.)
2. The remaining conformed dimensions land in `sql/03_dimensions/`:
   `dim_vehicle`, `dim_employee` (SCD Type 2), `dim_lead_source`,
   `dim_finance_product`, `dim_campaign`, `dim_deal_type`.
3. `DATA_GENERATION.md` defines the generator rules for the corresponding business
   process, including its controlled data-quality defects.
4. `docs/source-to-target/` carries a mapping for the entity.

## Planned fact tables and their declared grains

Grains and columns are governed by `ARCHITECTURE.md` section 12; this table is the
index, not the specification. Every one of these is **Planned**, not implemented.

| Planned file | Table | Declared grain | Type |
|---|---|---|---|
| `00_fact_vehicle_sale.sql` | `warehouse.fact_vehicle_sale` | One row per sold vehicle deal | Transaction |
| `01_fact_vehicle_inventory_snapshot.sql` | `warehouse.fact_vehicle_inventory_snapshot` | One row per vehicle per store per snapshot date | Periodic snapshot |
| `02_fact_inventory_price_history.sql` | `warehouse.fact_inventory_price_history` | One row per vehicle per price-change event | Transaction |
| `03_fact_lead.sql` | `warehouse.fact_lead` | One row per lead | Accumulating snapshot |
| `04_fact_lead_activity.sql` | `warehouse.fact_lead_activity` | One row per activity on a lead | Transaction |
| `05_fact_appointment.sql` | `warehouse.fact_appointment` | One row per appointment | Accumulating snapshot |
| `06_fact_marketing_spend.sql` | `warehouse.fact_marketing_spend` | One row per campaign per store per day | Periodic snapshot |
| `07_fact_finance_product_sale.sql` | `warehouse.fact_finance_product_sale` | One row per F&I product sold on a deal | Transaction |
| `08_fact_service_visit.sql` | `warehouse.fact_service_visit` | One row per service repair order | Transaction |
| `09_fact_sales_target.sql` | `warehouse.fact_sales_target` | One row per store per month per target metric | Periodic snapshot |

Merge scripts follow the same convention as the dimensions: numbers below `10` for
DDL, numbers from `10` upward for the `*_merge.sql` files that the Python loader
executes at runtime.

## Rules that will apply to every file added here

- One declared grain per table, stated in `COMMENT ON TABLE`, and a data-quality
  check that proves the grain is unique.
- Integer surrogate foreign keys to the conformed dimensions, with real
  `FOREIGN KEY` constraints — not merely documented relationships.
- `date_key` resolves to `warehouse.dim_date`; a fact row for a date the calendar
  does not contain is a failed load, not a silent orphan.
- Measures are `numeric`. Never `float`.
- Additive, semi-additive and non-additive measures are labelled as such in the
  column comments, because a semi-additive measure summed across time is the most
  common way a dashboard lies.
- No customer personal data, ever. See `PRIVACY_AND_ETHICS.md`.
- New indexes go in `sql/06_indexes/` only when a query that exists needs them.
- The matching reporting view and data-quality checks land in the same change; see
  `sql/05_reporting/00_reporting_scope.sql` for the reporting views that are
  waiting on these tables.
