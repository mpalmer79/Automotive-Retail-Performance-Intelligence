# Power BI Model Documentation — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Last reviewed:** 2026-07-29
**Parent documents:** [ARCHITECTURE.md](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md)

---

<!-- ARPI:CAPABILITIES:BEGIN semantic-model -->
| Artefact | Count | What it means |
|---|---:|---|
| PBIP project files | 2 | The project and its semantic-model definition exist in source control. |
| TMDL files | 30 | The model is stored as readable text, not a binary. |
| Semantic tables | 26 | Imported reporting views plus measure-only tables. |
| Relationships | 42 | Declared in TMDL and statically checked. |
| DAX measures | 49 | Written and statically checked. **Never evaluated by an engine.** |
| Report pages | 0 | The report is a PBIR shell. A dashboard does not exist. |

**Source exists; runtime is unproven.** Every figure above is read from the repository, and every one of them describes *source*. Static parsing is not execution.

| Real-engine path | Declared | Evidence |
|---|---|---|
| Power BI Desktop | pending | `validated_at` is null |
| Microsoft Fabric | pending | `validated_at` is null |

An engine has run: **No**. `ADR-0008-real-engine-validation-paths` accepts either path and requires one of them before Lifecycle Phase 5 can complete. (This block is generated into documents at several depths, so it names the record rather than linking to it: one relative link cannot resolve from all of them.)
<!-- ARPI:CAPABILITIES:END semantic-model -->

## 1. What this directory is, and what it is not

This directory is both the **specification** for the ARPI semantic model and the **as-built record** of it.
Those were the same thing on the day the specification was written and they are not the same thing now: the
model exists, and where the build could not follow the specification the difference is recorded here rather
than smoothed over.

**The model itself lives at [`powerbi/ARPI_Performance_Intelligence/`](../ARPI_Performance_Intelligence/).**
It is a PBIP project with the semantic model stored as TMDL — one text file per table, plus
`model.tmdl`, `database.tmdl`, `expressions.tmdl` and `relationships.tmdl`. The storage decision and its
consequences are [ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md); the
delivery increment that built it is `P2.1` in
[PHASE_2_BACKLOG.md](../../docs/requirements/PHASE_2_BACKLOG.md).

What exists, in one paragraph. Twenty-six tables: twenty imported from the PostgreSQL `reporting` schema and
six measure tables. Forty-two relationships, thirty-two active and ten inactive, every one of them
many-to-one and single-direction. Forty-nine measures: twenty-nine governed MVP KPI measures and twenty
supporting measures. `vw_calendar` is the marked date table. Storage mode is Import throughout.

Three things this directory does **not** claim, each of which is load-bearing:

* **No report page and no visual exists.** The `.Report` folder is a PBIR shell — a `.platform` file and a
  `definition.pbir` pointing at the semantic model, with no page, no visual, no bookmark and no theme.
  Report content is delivery increment `P2.2` and has not started.
* **Power BI Desktop has never opened this model.** It was authored on Ubuntu 24.04, where Desktop does not
  run. Desktop open, refresh and save validation is a manual gate whose status is **PENDING**. See
  [08-desktop-validation.md](08-desktop-validation.md). No document in this directory says the model is
  validated, because nothing has validated it.
* **No measure has been evaluated.** Every claim made here about a measure is a claim about its text, not
  about a number it returned.

Everything described here is derived from objects that exist. Every imported table is a view in the
`reporting` schema today, asserted by `tests/integration/test_reporting_layer_completeness.py`; every KPI is
asserted computable by `tests/integration/test_kpi_verification.py`; and every table, column, relationship
and measure named in these documents is in the committed TMDL.

---

## 2. Index

| Document | Purpose |
|---|---|
| [01-table-inventory.md](01-table-inventory.md) | Every table the model imports, its grain, its row count, its role, the TMDL file that defines it, and where its descriptions come from. |
| [02-relationship-plan.md](02-relationship-plan.md) | The as-built relationship register: all forty-two relationships by TMDL name, with cardinality, direction, active state and blank-row behaviour. The marked date table, the role-playing dates, and why no bidirectional filter exists. |
| [03-measure-groups.md](03-measure-groups.md) | All forty-nine measures by group, with KPI identifier, display folder, format string, source table, date basis and the DAX shape actually used. The Executive curation register and the four Deferred groups. |
| [04-reporting-view-to-kpi-map.md](04-reporting-view-to-kpi-map.md) | The two-way map between reporting views and KPI identifiers, extended with the model measure that now owns each KPI's DAX side. |
| [05-column-visibility.md](05-column-visibility.md) | The hidden/visible policy as implemented, column class by column class, and what `summarizeBy: none` plus `discourageImplicitMeasures` mean for a report author. |
| [06-format-strings.md](06-format-strings.md) | The format string on every measure, grouped by kind, with the rule each follows and two deliberate notes. |
| [07-power-query-parameters.md](07-power-query-parameters.md) | The two parameters, the M shape every partition uses, and where the credential boundary actually sits. |
| [08-desktop-validation.md](08-desktop-validation.md) | What Desktop validation is, why CI cannot perform it, the five states CI distinguishes, the freshness mechanism, and the current status — **PENDING**. |
| [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md) | The method for comparing SQL baselines against measures evaluated in the model: the filter contexts that must be tested and the identities that must hold. |

---

## 3. The design rules everything here follows

1. **Import mode, single star schema.** One fact table per MVP fact, one dimension table per MVP dimension,
   no snowflaking beyond `vw_vehicle` → `vw_vehicle_model`. Implemented: storage mode is Import on all
   twenty imported tables, and the six measure tables are single-row calculated tables.
2. **One-directional relationships only.** Every relationship filters from the dimension to the fact. No
   bidirectional filter is used anywhere, and `tests/integration/test_reporting_layer_completeness.py`
   asserts every dimension key is unique so that no relationship is forced into many-to-many.
   *Refined by the implementation:* many-to-one and single-direction are the TMDL defaults, so no
   relationship in `relationships.tmdl` states a cardinality or a filter direction at all. Any relationship
   that ever needs to state one is, by that fact alone, a departure from this rule.
3. **The reporting layer is the only source.** The model connects as `arpi_reporter`, which holds no
   privilege on `raw`, `staging`, `warehouse` or `audit`. That is enforced by the database, not by
   convention, and is asserted as the role itself in
   `tests/integration/test_reporter_role_end_to_end.py`. Every partition in the model names an object in
   `reporting`; see [07-power-query-parameters.md](07-power-query-parameters.md).
4. **Ratios are computed in DAX, never imported.** Every reporting view publishes a ratio's numerator and
   denominator as separate additive columns. *Refined by the implementation:* the materialised ratio columns
   that do exist on the three imported analytical views — `inventory_turn`, `days_supply`, `cost_per_lead`,
   `cost_per_sale`, `gross_return_on_ad_spend` — are imported but **hidden**, so the SQL and Excel consumers
   keep their governed answer and no report author can put two versions of one number on one visual.
5. **Zero denominators produce `BLANK()`.** `DIVIDE(numerator, denominator)` everywhere. *Refined by the
   implementation:* three marketing measures need more than `DIVIDE`, because their numerator can be blank
   rather than zero — `DIVIDE` would coerce a missing spend row to `0` and report a free lead. Those three
   test `ISBLANK` on spend before dividing. See [03-measure-groups.md](03-measure-groups.md) §6.
6. **Semi-additive measures are handled explicitly.** *Refined by the implementation:* every semi-additive
   measure is anchored on the last date in the filter context over `vw_calendar[calendar_date]` — seven with
   `LASTNONBLANKVALUE`, and Dealer Days Supply with `LASTNONBLANK` over `COUNTROWS`, because its ratio is
   legitimately blank on a zero-selling-pace day and must not be back-filled from an earlier one. The
   "explicit average of daily values" alternative the specification allowed is not used anywhere. Eight
   measures carry the `ARPI_TimeAggregation = SemiAdditiveLastDate` annotation; see
   [03-measure-groups.md §5.1](03-measure-groups.md).
7. **Medians are recomputed from row level.** `MEDIAN` over the row-level column, never a pre-aggregated
   value, because the median of a group is not derivable from the medians of its subgroups. Three measures
   are medians: Median Inventory Age, Days to Sale (Median) and Median Response Time.
8. **Keys are hidden; so is anything a measure owns.** *Refined by the implementation:* the rule is wider
   than surrogate keys. Every `*_key` column is hidden, every pre-filtered numerator column is hidden, every
   materialised ratio on an imported analytical view is hidden, and every sort-order helper column is
   hidden. Every table keeps a business-readable label column visible, and `source_system` is visible on
   every table that carries it. `summarizeBy: none` is set on every column in the model and
   `discourageImplicitMeasures` is set on the model itself, so a numeric column dragged onto a visual
   produces no number at all. The complete policy is
   [05-column-visibility.md](05-column-visibility.md).

---

## 4. What is deliberately absent

The model exists, so this section no longer lists it. What follows is what is still absent and why.

| Absent | Why |
|---|---|
| Report pages, visuals, bookmarks and themes | The `.Report` folder is a PBIR shell by design. Report content is delivery increment `P2.2`, and it is gated on the Desktop validation in `P2.1-09`, which is **PENDING**. Authoring pages over a model that has never been opened would put page defects and model defects into the same change. |
| A refreshed model, or any evaluated number | Power BI Desktop does not run in the environment that built this model. See [08-desktop-validation.md](08-desktop-validation.md). |
| Row-level security roles | ARPI models one dealer group with three stores and no user population. RLS would be an unused control described as if it protected something. |
| Aggregation tables and composite models | No measured performance problem exists at these volumes. [ARCHITECTURE.md §19.1](../../ARCHITECTURE.md) fixes Import mode; anything beyond it needs a measurement first. |
| Calculation groups | The one place a calculation group would help — aligning the two date bases behind `KPI-INV-008` — is already solved in SQL by `vw_inventory_turn`. |
| Any `.pbix`, `.pbit` or `.bim` file | [ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md). A binary is unreviewable, cannot be authored in this environment, and would be a second source of truth beside the TMDL. A distribution `.pbix` is deferred to `P2.4`, not refused. |
| Power BI Service or Fabric deployment | No workspace, deployment pipeline, dataflow or scheduled refresh. The database is local; a Service deployment needs either the hosting [ARCHITECTURE.md §26.1](../../ARCHITECTURE.md) defers or an on-premises gateway, and changing the deployment model requires its own ADR. |
| Target-attainment measures | **The fact is no longer the blocker.** `DASH.5` implemented `warehouse.fact_sales_target` and `reporting.vw_target_attainment`, and the ten `KPI-TGT-*` KPIs are computed in SQL and rendered on the web console. What is absent here is the **semantic-model binding**: no TMDL table, no relationship, no measure, and no evidence. `DASH.5` changed no TMDL file and no Power BI evidence; adding the binding later requires renewed Microsoft-engine validation. See [03-measure-groups.md §8](03-measure-groups.md). |
| Measure tables for the four unbuilt groups | F&I, Customer Retention, Service to Sales and Target Attainment exist in [03-measure-groups.md §9](03-measure-groups.md) and nowhere else: no table, no empty table, no placeholder measure, no hidden stub. **Two** are blocked by Deferred facts (Customer Retention, Service to Sales); **F&I and Target Attainment are blocked only by the absent semantic-model binding** — both domains are built in SQL and verified, and neither has a TMDL table, relationship or measure. |
| A `.dax` text mirror of the measures | [`powerbi/measures/`](../measures/) holds a README and no DAX. The mirror [ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md) and `P2.1-05` originally called for was reasoned against a `.pbix`, which hides its measures; TMDL does not. A mirror would be a second copy of forty-nine measures with nothing able to test that it still matched. The TMDL is the single source of the DAX. |
