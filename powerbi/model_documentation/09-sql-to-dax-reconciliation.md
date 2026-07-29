# SQL-to-DAX Reconciliation — Method

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

How the numbers the model produces will be compared against the numbers the database produces, and what a
comparison has to cover before it counts as evidence.

**No reconciliation has been performed.** No Microsoft semantic-model engine has ever loaded this model, so
the DAX side of every comparison below is currently empty. The SQL side exists —
`powerbi/validation/sql_baseline.json` holds the expected value of every reconciled measure across
twenty-one filter contexts — and it was generated before any model was refreshed, which is the ordering that
makes it an expectation rather than a transcription. See
[08-desktop-validation.md](08-desktop-validation.md); both engines are **PENDING**.

**The DAX side may come from either accepted engine.** `P2.1-09` accepts a **Power BI Desktop** run or a
**Microsoft Fabric Service** run, of equal standing, per
[ADR-0008](../../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md). This method is
engine-independent by construction: the queries, the baseline, the contexts, the identities and the
tolerances are the same either way, and only §2.2 differs between them.

---

## 1. Why this exists at all

For twenty-one of the twenty-nine MVP KPIs, the SQL side and the DAX side read **different objects**.
[KPI_CATALOG.md](../../KPI_CATALOG.md) names a governed aggregate view as each KPI's SQL owner —
`vw_sales_summary`, `vw_gross_summary`, `vw_inventory_health`, `vw_lead_funnel` and the rest — while the
model binds to the row-grain fact underneath it, because a ratio or an order statistic recomputes under a
filter context there and cannot in an aggregate. See
[04-reporting-view-to-kpi-map.md §1](04-reporting-view-to-kpi-map.md).

Two independent computations of one governed definition is a good design and a standing risk. Nothing in the
construction forces them to agree: a rounding decision, a NULL handling difference, a filter applied on one
side and not the other, or a semi-additive rule implemented once correctly and once plausibly will all
produce two defensible numbers where there should be one.

**Gate 2 condition 2 is "SQL and Power BI totals reconcile"** ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)),
and it is currently **not met**. This is the method that will meet it.

For the remaining eight KPIs — the five read from `vw_inventory_turn`, `vw_days_supply` and
`vw_marketing_performance`, plus the three whose measure sums the same column the view sums — both sides read
the same numbers and agreement is close to structural. **Those eight are the weakest tests in the set**, and
that weakness must be stated when they pass rather than allowed to inflate the overall result.

---

## 2. The method

Three steps, in order, with the ordering as important as the steps.

### 2.1 Generate the SQL baseline first

`scripts/generate_sql_baseline.py` connects to a **freshly built `development`-profile database** as
`arpi_reporter`, evaluates every reconciled measure across every filter context in §3, and writes
`powerbi/validation/sql_baseline.json`.

Alongside it, `powerbi/validation/sql_baseline_metadata.json` records the **provenance**: the profile, the
generation seed, the database snapshot identity, the pipeline run, and the generation timestamp. **A baseline
with no provenance is a number with no argument behind it** — an unlabelled expected value that cannot be
distinguished from a value copied out of a report.

The baseline is generated **before** the model is refreshed, and committed before the DAX side is produced.
That ordering is the control: an expected value recorded after seeing the actual value is not an expectation,
it is a transcription.

### 2.2 Evaluate the same measures in the model

`powerbi/validation/validation_queries.dax` holds the DAX queries that produce the model's side of the
comparison. Each query returns one measure across one filter context, in the same shape the baseline records,
so the comparison is a join rather than an interpretation.

**One file, both engines.** A second copy of the queries, written for the other path, would be a second
answer waiting to happen — it is the one a reviewer reads while the other is the one that ran, and nothing
executable could test that the two still agree.

| Engine | How the queries are executed |
|---|---|
| **Power BI Desktop** | A human runs them in Desktop or DAX Studio against the refreshed model. |
| **Microsoft Fabric Service** | The same file is submitted through the **Power BI Execute Queries REST API** against the semantic model deployed to the workspace, and the JSON results are read back. |

The database refreshed must be the **same database the baseline came from**, identified by the provenance in
§2.1. A baseline generated against one seed and a model refreshed against another will disagree for reasons
that have nothing to do with the model, and the disagreement will look exactly like a defect. On the Fabric
path this is a live risk rather than a theoretical one, because the cloud instance it refreshes from is a
different database from the local one the baseline was generated against, and only the recorded profile,
seed and row counts establish that they hold the same data.

#### 2.2.1 `includeNulls` must be set on the Execute Queries request

**The Execute Queries REST API omits null-valued cells from its response unless `includeNulls` is set.** It
must be set.

This is not a serialisation detail, it is the difference between two answers this document spends §3.1 and
identity 5 of §4 distinguishing. The **zero-denominator** context and the **organic-marketing** contexts
exist precisely to prove that a ratio returns `BLANK()` rather than `0` or an error — a store-month with no
retail sales, and a lead source with no spend. A serializer that drops nulls turns the correct answer,
`BLANK()`, into a **missing key**, and a comparison that reads a missing key as "no value recorded" cannot
tell a correct blank apart from a query that never ran.

The failure is silent and it fails in the wrong direction: the contexts specifically designed to catch a
`$0` cost per lead for an organic source are the same contexts whose correct results would vanish from the
response. The Fabric path therefore sets `includeNulls`, and the comparison treats an **absent key as a
failure to observe**, never as an observed blank.

### 2.3 Compare, and record

Every comparison is recorded against a schema with `additionalProperties: false` — in
`powerbi/validation/desktop_validation_results.json` against
`powerbi/validation/validation_results.schema.json` for the Desktop path, or in
`powerbi/validation/fabric_validation_results.json` against
`powerbi/validation/fabric_validation_results.schema.json` for the Fabric path. **Row counts reconcile at
tolerance zero.** Numeric measures reconcile within the configured
`validation.numeric_absolute_tolerance`, which exists for floating-point representation and for nothing
else.

The recorded result carries the **model-source hash** and the **engine** that produced it. Both matter: the
hash says which model was tested, and the engine says which tabular implementation agreed with the baseline.
A result that named neither would be a number with no argument behind it, which is the objection §2.1 raises
against an unprovenanced baseline, applied to the other side of the comparison.

A tolerance is not a licence. A difference inside the tolerance that is systematic — the same sign, on the
same measure, across many contexts — is a finding regardless of its size, because a rounding difference is
random and a modelling difference is not.

---

## 3. The filter contexts that must be tested

**A measure can have a correct grand total and still be wrong under filter context.** This is the single most
important sentence in this document.

An unfiltered total is one number. It can be correct while the measure is broken in every way that matters: a
missing relationship gives the same total everywhere and the right total once; a semi-additive measure summed
across dates can still total correctly at the last date; a ratio computed as an average of ratios agrees with
a ratio of sums at the top level and diverges on every subgroup. **Grand totals alone are not accepted as
evidence**, and a reconciliation that tests only totals has tested the least informative case available.

Nine context classes must be covered for every reconciled measure.

| # | Context | What it catches |
|---:|---|---|
| 1 | **Unfiltered** | The baseline case. Necessary, and on its own nearly worthless. |
| 2 | **Each dealership, separately** | A missing or misdirected store relationship. This is the one that catches the disconnected analytical tables — before the eight relationships in [02-relationship-plan.md §3.6](02-relationship-plan.md), `KPI-INV-008`, `KPI-INV-009` and `KPI-MKT-001`…`003` would have returned the identical whole-database figure for all three stores while totalling correctly. |
| 3 | **Each month, separately** | Date-basis errors, and semi-additivity. A monthly breakdown that sums to the correct annual total is exactly what a wrongly-summed stock measure produces at the last date. |
| 4 | **New vs used** (`condition_group`) | The snowflake path through `vw_vehicle` → `vw_vehicle_model`, and the new/used split identity of §4. |
| 5 | **A single employee** | The role-playing relationships. A measure that silently activates the desk-manager relationship instead of the salesperson one is invisible at the total and obvious here. |
| 6 | **A single lead source** | Marketing attribution, and the `is_cost_attributable` boundary. |
| 7 | **A single vehicle model** | The snowflake, from the far side. `vw_vehicle_model` reaches the facts only through `vw_vehicle`. |
| 8 | **A zero-denominator context** | The blank-versus-zero rule of §4. Deliberately chosen: a store-month with no retail sales, and a lead source with no spend. |
| 9 | **A context using an inactive date relationship** | `KPI-FUN-005` on the show-date basis, via `USERELATIONSHIP`. The only measure in the model that activates an inactive relationship, and the only place `USERELATIONSHIP` can be observed working or not. |

### 3.0 The twenty-one contexts in the committed baseline

`powerbi/validation/sql_baseline.json` implements the nine classes as twenty-one concrete contexts:

| Class | Contexts in the baseline |
|---|---|
| 1. Unfiltered | `unfiltered` |
| 2. Each dealership | `store-GSA-001`, `store-GSA-002`, `store-GSA-003` |
| 3. Each month | `month-2025-07` … `month-2025-12` (six) |
| 4. New vs used | `condition-New`, `condition-Used` |
| 5. An employee | `employee-EMP-00003` |
| 6. A lead source | `lead-source-LDS-001` |
| 7. A vehicle model | `vehicle-model-VMD-00104` |
| 8. A zero denominator | `zero-denominator` |
| 9. An inactive date relationship | `inactive-relationship-show-date` |
| 10. Combinations | `store-and-month`, `store-and-condition`, `month-and-condition`, `store-month-and-condition` |

**Class 10 is the one that earns its place.** Every other context varies a single axis, and single-axis
agreement is weak evidence: a filter that reaches a table by the wrong route very often agrees with each
axis on its own and diverges only where two of them intersect. The four combination contexts are also the
only place the eight relationships added for the imported analytical views are genuinely tested, because a
store filter and a month filter have to land on `vw_inventory_turn`, `vw_days_supply` and
`vw_marketing_performance` at the same time. `store-month-and-condition` applies three filters at once on the
used-only store: a measure that resolves a filter path by luck rather than by design fails there or nowhere.

The combination contexts also exercise the asymmetry deliberately. A condition-group filter comes from
`vw_vehicle` and therefore reaches the sale and inventory-snapshot facts but **not** `vw_inventory_turn` or
`vw_days_supply`, which carry a `condition_group` column of their own and no relationship to `vw_vehicle`.
`store-and-condition` is the context where a baseline that applied every filter to every table would disagree
with a correct model — and the baseline models the propagation rather than assuming it.

### 3.1 Contexts that require special handling

* **Marketing measures at day grain.** Every spend row's date key is a month start, so a day filter selects
  no spend at all. The correct DAX answer is `BLANK()`, and the correct SQL answer is the same. A test that
  omits this case will not notice a model that returns `$0`.
* **Inventory measures across a month.** The expected value is the **closing position**, not the sum and not
  the mean. The baseline must compute it the same way, or the reconciliation tests the baseline's
  interpretation rather than the model's.
* **`Dealer Days Supply` on a zero-selling-pace day.** The expected value is `BLANK()`, not the previous
  day's figure. This is what distinguishes `LASTNONBLANK` from `LASTNONBLANKVALUE` in
  [03-measure-groups.md §5.1](03-measure-groups.md), and the only context in which the distinction is
  observable.
* **The eleven data-quality measures.** They are disconnected from the calendar and the store dimension, so
  contexts 2, 3, 4, 5, 6 and 7 must return the **unfiltered** value. That is the correct behaviour, not a
  defect, and the reconciliation must expect it. A data-quality measure that *did* respond to a store filter
  would be the finding.

---

## 4. The identities that must hold

An identity is stronger evidence than a matched value, because it must hold in **every** context rather than
in the contexts someone thought to test. Each of these is checked in all nine context classes.

| # | Identity | Why it holds by construction | What a failure means |
|---:|---|---|---|
| 1 | `New Units Sold + Used Units Sold = Retail Units Sold` | All three sum pre-filtered numerator columns on the same rows of `vw_vehicle_sales`. The split comes from the vehicle's condition, so a lease falls on one side rather than neither. | A filter is being applied to one and not the others, or the condition split has a third state. Also reconciled per store-day in SQL by `RECON-UNITS-001`. |
| 2 | `Front-End Gross + Back-End Gross = Total Gross` | Three additive sums of columns that satisfy the identity at row level. Reconciled to the cent by `RECON-GROSS-001`. | A currency rounding difference between the two sides, or a row-level column that does not satisfy it. |
| 3 | `Total Gross per Retail Unit = Front Gross per Retail Unit + Back Gross per Retail Unit` | All three divide by the same measure, so the identity survives division. | **The filter contexts have come apart.** This is the cheapest available signal that something is wrong with filter propagation, and it costs nothing to check. |
| 4 | `Total Gross per Retail Unit × Retail Units Sold = Total Gross` | The definition of the ratio. | A denominator evaluated in a different context from its numerator. |
| 5 | Every ratio is `BLANK()`, never `0` and never an error, on a zero denominator | `DIVIDE` in twenty-one places; `ISBLANK` guards on the three marketing measures where the numerator can be blank rather than the denominator zero. | A `$0` cost per lead for an organic source, which is the specific false statement the `ISBLANK` guard exists to prevent. See [03-measure-groups.md §7.1](03-measure-groups.md). |
| 6 | Semi-additive inventory measures are **not** summed across dates | Seven wrapped in `LASTNONBLANKVALUE`, one in `LASTNONBLANK` over `COUNTROWS`. | A month total roughly thirty times the true figure — the most plausible-looking wrong number this model can produce. Test by comparing a month's value against the last day in that month, which must be equal. |
| 7 | `Shown Appointments ≤ Eligible Appointments` and every funnel count is bounded by the stage above it | The reporting layer's governed counts, reconciled by `RECON-FUNNEL-BOUNDS`. | A grain shift being crossed by accident, or a date basis mixed between numerator and denominator. |
| 8 | `Show Rate` and `Show-to-Sale Conversion` for the same month **may legitimately differ** in denominator | Different date bases: scheduled versus show. | An *equality* here is the finding — it means `USERELATIONSHIP` is not taking effect. |
| 9 | `Leads Received + Duplicate Leads` equals total lead rows | The duplicate exclusion is a governed column, not a hidden filter. | A filter has replaced the column somewhere. |
| 10 | Every table's loaded row count equals the SQL count, exactly | Import mode with no Power Query transformation; the query folds to `SELECT *`. | Tolerance is **zero** here. A single row difference is a defect, not noise. |

### 4.1 Identity 6 in detail, because it is the one most likely to fail quietly

Semi-additivity is the most commonly misimplemented thing in this model, and its failure mode is uniquely
bad: a plain `SUM` over `vw_inventory_snapshots` for October returns roughly thirty-one times the true
inventory, which is a large, confident, wrong number that a reader unfamiliar with dealership volumes cannot
recognise as absurd.

The test is direct. For each store and each month:

* `Active Inventory Count` filtered to the month **must equal** `Active Inventory Count` filtered to the last
  day of that month that has a snapshot row.
* It must **not** equal the sum of the daily values.
* The same holds for `Inventory Investment`, `Aged Inventory Count`, `Aged Inventory Investment`,
  `Average Inventory Age`, `Aged Inventory Percentage` and `Median Inventory Age`.

`Dealer Days Supply` is tested the same way with one addition: on a day whose trailing window contains no
retail sale, the expected value is `BLANK()` and **not** the value from the most recent day that had one.

---

## 5. What a passing reconciliation does and does not establish

**Establishes:** that for the profile, seed and date recorded, the model's measures agree with the governed
SQL definitions across the tested contexts, and that the identities hold there.

**Does not establish:**

* **That the definitions are right.** Both sides implement `KPI_CATALOG.md`. If the catalogue's definition of
  a KPI is wrong, both sides are wrong together and agree perfectly. Reconciliation tests consistency, not
  correctness.
* **That untested contexts are correct.** Nine context classes is a substantial sample and it is a sample.
* **That another profile reconciles.** A result against `development` says nothing about `portfolio`. The
  `profile` field in the result exists so this cannot be forgotten.
* **That the other engine agrees.** A reconciliation is evidence about the engine that produced it. Desktop
  and the Fabric Service are different implementations, and either one passing closes `P2.1-09` on its own
  merits rather than by standing in for the other. If both are ever run against the same baseline, a
  disagreement between them is itself a finding — and one neither can produce alone.
* **That the model is fast, or usable, or that a visual built on it is honest.** Those are different
  questions with different evidence.
* **Anything about the eight structurally-agreeing KPIs of §1** beyond that the plumbing works. Where both
  sides read the same column of the same view, agreement was never in doubt.

---

## 6. Artefacts

Referenced as backticked paths rather than links. What does not exist is a run that used any of them.

| Artefact | Role |
|---|---|
| `powerbi/validation/sql_baseline.json` | The expected value of every reconciled measure, across the twenty-one contexts of §3.0, generated from the database. |
| `powerbi/validation/sql_baseline_metadata.json` | The baseline's provenance: `development` profile, seed `20250701`, the git commit, the reporting date range 2025-07-01 to 2025-12-31, the row count per view, and 58 reconciliations with 0 failing. It deliberately records **no host, user name or password** — it describes the data it was taken from, not the machine it was taken on. |
| `powerbi/validation/validation_queries.dax` | The DAX queries that produce the other side. Run by hand in Power BI Desktop, or submitted through the Power BI Execute Queries REST API on the Fabric path. One file, both engines. |
| `powerbi/validation/validation_results.schema.json` | The shape of a recorded **Desktop** result, so a hand-recorded one cannot omit a field. See [08-desktop-validation.md §6](08-desktop-validation.md). |
| `powerbi/validation/desktop_validation_results.json` | Where the Desktop comparison is recorded, in `sql_to_dax_differences`, `row_counts`, `passed_checks` and `failed_checks`. Currently a placeholder recording `pending`. |
| `powerbi/validation/fabric_validation_results.schema.json` | The shape of a recorded **Fabric** result. The same obligations, with the engine identification changed and the same prohibition on recording a tenant, workspace, endpoint or credential. |
| `powerbi/validation/fabric_validation_results.json` | Where the Fabric comparison is recorded. Also a placeholder recording `pending`. |
| `powerbi/validation/model_expectations.json` | The structural facts the static checker asserts. Not part of this reconciliation, listed so the directory's contents are not surprising. |
| `scripts/generate_sql_baseline.py` | Generates the baseline. |
| `scripts/validate_powerbi_model.ps1` | The Windows-side script for the Desktop path. Not invoked by CI. |
| `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` | The Desktop procedure. |
| `docs/powerbi/FABRIC_SERVICE_HANDOFF.md` | The Fabric procedure, including the Execute Queries request shape and the `includeNulls` requirement of §2.2.1. |

**`reconciliation` is not a validation category** in ADR-0004's vocabulary, and this comparison does not
introduce one. It reports through the existing framework, the same rule the SQL-side reconciliations follow.

---

## 7. Current status

| | |
|---|---|
| SQL baseline generated | **Yes** — `powerbi/validation/sql_baseline.json`, twenty-one contexts, `development` profile |
| Model refreshed — Power BI Desktop | **No** — Desktop has never opened this model |
| Model refreshed — Microsoft Fabric Service | **No** — nothing has been deployed to a workspace |
| Measures evaluated | **No** — none of the forty-nine has returned a value on either engine |
| Comparison performed | **No** — `sql_to_dax_differences` is empty because nothing has been compared, not because nothing differed |
| Identities checked | **No** |
| Gate 2 condition 2, "SQL and Power BI totals reconcile" | **Not met** |

The fourth row is the one most easily misread. An empty `sql_to_dax_differences` array in a **passed** result
would mean every measure agreed. In the current **pending** result it means the comparison has not been run.
The `overall_result` field is what distinguishes them, and it is the field to read first.

Nothing in this directory claims otherwise.
