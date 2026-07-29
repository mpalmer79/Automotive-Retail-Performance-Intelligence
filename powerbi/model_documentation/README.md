# Power BI Model Documentation — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Last reviewed:** 2026-07-29
**Parent documents:** [ARCHITECTURE.md](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md)

---

## 1. What this directory is, and what it is not

> **No Power BI development has started.** There is no `.pbix`, no `.pbip`, no `.tmdl`, and no `.bim` file
> anywhere in this repository, and `tests/integration/test_gate1_readiness.py` fails the build if one
> appears. Gate 1 ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)) gates Power BI *development*; this
> directory holds the *specification* that Gate 1 produces, which is what makes the gate reviewable rather
> than a promise.

These documents describe the semantic model that **will** be built once Gate 1 opens: which reporting views
become tables, how they relate, which direction each relationship filters, which columns are hidden, which
table is marked as the date table, how the role-playing dates are handled, and which measure group each KPI
belongs to.

Everything here is derived from objects that exist and are tested. Every table named is a view in the
`reporting` schema today; every relationship named is asserted to resolve by
`tests/integration/test_reporting_layer_completeness.py`; every KPI named is asserted to be computable by
`tests/integration/test_kpi_verification.py`. Nothing in this directory describes an object that has not
been built.

---

## 2. Index

| Document | Purpose |
|---|---|
| [01-table-inventory.md](01-table-inventory.md) | Every table the model imports, its grain, its row count, its role, and whether it is visible to a report author. |
| [02-relationship-plan.md](02-relationship-plan.md) | The star schema: every relationship, its cardinality, its filter direction, whether it is active, and the role-playing date handling. Also the marked date table and the hidden-key recommendations. |
| [03-measure-groups.md](03-measure-groups.md) | Every KPI mapped to its measure group, with the additive columns each measure reads and the DAX shape it must use. |
| [04-reporting-view-to-kpi-map.md](04-reporting-view-to-kpi-map.md) | The two-way map between reporting views and KPI identifiers, plus the views that own no KPI and why they exist. |

---

## 3. The design rules everything here follows

1. **Import mode, single star schema.** One fact table per MVP fact, one dimension table per MVP dimension,
   no snowflaking beyond `vw_vehicle` → `vw_vehicle_model`.
2. **One-directional relationships only.** Every relationship filters from the dimension to the fact. No
   bidirectional filter is used anywhere, and `tests/integration/test_reporting_layer_completeness.py`
   asserts every dimension key is unique so that no relationship is forced into many-to-many.
3. **The reporting layer is the only source.** The model connects as `arpi_reporter`, which holds no
   privilege on `raw`, `staging`, `warehouse` or `audit`. That is enforced by the database, not by
   convention, and is asserted as the role itself in
   `tests/integration/test_reporter_role_end_to_end.py`.
4. **Ratios are computed in DAX, never imported.** Every reporting view publishes a ratio's numerator and
   denominator as separate additive columns. A ratio column exists on some analytical views for SQL and
   Excel consumers and is valid at that view's grain only; the semantic model must not import it as a
   measure.
5. **Zero denominators produce `BLANK()`.** `DIVIDE(numerator, denominator)` everywhere, so an undefined
   measure renders as a gap rather than as a zero. Displaying `$0` gross per unit in a month with no sales
   would be a false statement.
6. **Semi-additive measures are handled explicitly.** Inventory count and inventory investment are additive
   across store, model and vehicle but **not across dates**. Every measure over them uses
   `LASTNONBLANKVALUE` or an explicit average of daily values, and every visual states its time-aggregation
   rule.
7. **Medians are recomputed from row level.** `MEDIAN` over the row-level column, never a pre-aggregated
   value, because the median of a group is not derivable from the medians of its subgroups.
8. **Surrogate keys are hidden.** A key is for a relationship, not for a report author. Every `*_key` column
   is hidden; every table carries a business-readable label column that is not hidden.

---

## 4. What is deliberately absent

| Absent | Why |
|---|---|
| Any `.pbix`, `.pbip`, `.tmdl` or `.bim` file | Gate 1 has to open first. Building the model before the gate is evaluated makes the gate meaningless. |
| DAX measure definitions as executable code | `powerbi/measures/` is empty on purpose. [03-measure-groups.md](03-measure-groups.md) specifies each measure's numerator, denominator and shape; writing the DAX is development work and waits for the gate. |
| Row-level security roles | ARPI models one dealer group with three stores and no user population. RLS would be an unused control described as if it protected something. |
| Aggregation tables and composite models | No measured performance problem exists at these volumes. [ARCHITECTURE.md §19.1](../../ARCHITECTURE.md) fixes Import mode; anything beyond it needs a measurement first. |
| Report page layouts | Page content is Lifecycle Phase 6 work, blocked by the same gate. The intended pages are named in [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) and traced per question in [`docs/requirements/STAKEHOLDER_QUESTIONS.md`](../../docs/requirements/STAKEHOLDER_QUESTIONS.md). |
