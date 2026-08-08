# KPI Catalog — Automotive Retail Performance Intelligence (ARPI)

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-07-28
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [DATA_GENERATION.md](DATA_GENERATION.md) · [LIMITATIONS.md](LIMITATIONS.md) · [docs/requirements/PHASE_1_BACKLOG.md](docs/requirements/PHASE_1_BACKLOG.md)

---

## 1. Purpose

This is the single governed definition of every metric ARPI will publish. It exists so that a number shown
on a Power BI card, a number returned by a SQL query, and a number quoted in a findings memo mean exactly
the same thing, and so that a reader can see the arithmetic rather than trust it.

---

## 2. Governance statement

> **No KPI may exist only as an unexplained dashboard measure.**
> — [ARCHITECTURE.md §18.3](ARCHITECTURE.md)

Every KPI in ARPI must document all of the following before it may appear in any report, and every entry in
section 6 onward carries all of them:

business definition · formula · numerator · denominator · grain · time context · inclusion rules ·
exclusion rules · null behaviour · source tables · DAX or SQL ownership · known limitations

Three further rules are binding for this catalogue:

1. **Every ratio states both sides.** A ratio KPI without an explicit numerator *and* an explicit
   denominator is not a KPI, it is a rumour. Additive measures state `n/a — additive measure` in the
   denominator field so the omission is visibly deliberate.
2. **No invented benchmarks.** This catalogue contains **no industry benchmark values**. ARPI has no access
   to real dealership performance data, so it cannot state what "good" looks like. Where a numeric
   threshold appears — the 60-day aged-inventory threshold, the 30-day days-supply trailing window — it is
   labelled a **project default** with its source cited, and it is a parameter of the calculation, not a
   performance standard. See [LIMITATIONS.md](LIMITATIONS.md).
3. **Averages and medians are documented as a pair.** Where a distribution is skewed, the median is the
   headline figure and the mean is retained for reconciliation and for detecting skew. Neither is published
   without the other. See section 5.

---

## 3. Implementation status — read this first

> ## ALL 29 MVP KPIs ARE COMPUTABLE
>
> **Every metric in this catalogue can now be computed from the `reporting` schema, and every one is
> covered by a test that checks it against an independent derivation from `warehouse`.**
>
> All eight MVP dimensions and all five MVP facts are built, constrained and populated. The reporting layer
> exposes twenty-eight views: one per dimension, one per fact at the fact's own grain, and thirteen governed
> analytical views that own the SQL side of the KPIs below. `tests/integration/test_kpi_verification.py`
> asserts, for each KPI, that it resolves to an existing view, that the reporting figure equals the same
> figure derived independently from the warehouse, and that every ratio returns NULL rather than zero or
> infinity on an empty denominator.
>
> **The Power BI side: written, never evaluated.** Gate 1 is OPEN — the verdict is recorded in
> [`docs/requirements/GATE_1_READINESS.md`](docs/requirements/GATE_1_READINESS.md) — and the semantic model
> has since been built as source-controlled TMDL under
> [`powerbi/ARPI_Performance_Intelligence/`](powerbi/ARPI_Performance_Intelligence/): 26 tables, 42
> single-direction relationships, a marked date table, and 49 DAX measures. The *Future DAX ownership* field
> on each KPI below therefore now names a measure group that exists.
>
> **What that does not mean is that any of it has been run.** No Microsoft semantic-model engine has loaded,
> refreshed or evaluated the model. The 49 measures are validated *statically* — parsed from TMDL and checked
> against `powerbi/model_documentation/` by `scripts/check_powerbi_model.py` on every push — which is a check
> that the DAX is well-formed and correctly wired, not a check that it returns the right number. Both
> real-engine validation paths accepted by
> [ADR-0008](docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) are pending, so Lifecycle
> Phase 5 remains in progress and the SQL figures below are the only ones this repository can currently
> prove.
>
> **Still not built:** no report page, no visual, no bookmark, no dashboard, and no finding. The report
> project is a PBIR shell. Gate 2 is CLOSED.
>
> **Nothing in this repository has produced a dealership finding**, and every figure it can produce
> describes a fictional group built from synthetic data.

### 3.1 Status legend

| Status | Meaning |
|---|---|
| **Implemented** | Computable from `reporting` in this repository today, and covered by tests. **All 29 MVP KPIs hold this status.** The SQL side is built; the DAX side follows Gate 1. |
| **Planned** | Committed scope with a named phase. Fully specified here; not yet built. |
| **Deferred** | In the target architecture but outside the current roadmap; unlocked by a later release stage. |
| **Out of scope** | Deliberately excluded. Adding it requires an architecture decision record. |

### 3.2 KPI identifier scheme

| Prefix | Domain | Range in use |
|---|---|---|
| `KPI-SLS-###` | Sales volume | `KPI-SLS-001` … `KPI-SLS-003` |
| `KPI-GRS-###` | Gross profit | `KPI-GRS-001` … `KPI-GRS-006` |
| `KPI-INV-###` | Inventory | `KPI-INV-001` … `KPI-INV-009` |
| `KPI-FUN-###` | Lead funnel | `KPI-FUN-001` … `KPI-FUN-008` |
| `KPI-MKT-###` | Marketing | `KPI-MKT-001` … `KPI-MKT-003` |

Identifiers are permanent. A retired KPI keeps its ID and is marked `Out of scope`; the number is never
reused. A KPI whose *definition* changes materially gets a new ID, so that a historical finding citing
`KPI-INV-006` always refers to the same arithmetic.

### 3.3 "Blocks Power BI Gate 1?"

[ARCHITECTURE.md §28](ARCHITECTURE.md) Gate 1: *no Power BI development begins until fact grains are
approved, dimensions are documented, and KPI formulas are documented.*

In the index below, **Blocks Power BI Gate 1? = Yes** means: this KPI is required by one of the five MVP
report pages ([ARCHITECTURE.md §30](ARCHITECTURE.md) — Executive Overview, Sales and Gross, Inventory
Health, Lead Funnel, Employee Performance), so its formula must be documented and its source fact grain
approved before Power BI work may start. **No** means the KPI serves a post-MVP page and does not hold the
gate.

---

## 4. KPI index

| KPI ID | Name | Domain | Unit | Grain | Status | Blocks Power BI Gate 1? |
|---|---|---|---|---|---|---|
| `KPI-SLS-001` | Retail units sold | Sales | Count (integer) | Store × day, aggregable to any period | **Implemented** | **Yes** |
| `KPI-SLS-002` | New units sold | Sales | Count (integer) | Store × day | **Implemented** | **Yes** |
| `KPI-SLS-003` | Used units sold | Sales | Count (integer) | Store × day | **Implemented** | **Yes** |
| `KPI-GRS-001` | Front-end gross | Gross | Currency (USD) | Store × day | **Implemented** | **Yes** |
| `KPI-GRS-002` | Back-end gross | Gross | Currency (USD) | Store × day | **Implemented** | **Yes** |
| `KPI-GRS-003` | Total gross | Gross | Currency (USD) | Store × day | **Implemented** | **Yes** |
| `KPI-GRS-004` | Front gross per retail unit | Gross | Currency per unit (USD) | Store × period | **Implemented** | **Yes** |
| `KPI-GRS-005` | Back gross per retail unit | Gross | Currency per unit (USD) | Store × period | **Implemented** | **Yes** |
| `KPI-GRS-006` | Total gross per retail unit | Gross | Currency per unit (USD) | Store × period | **Implemented** | **Yes** |
| `KPI-INV-001` | Active inventory count | Inventory | Count (integer) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-002` | Inventory investment | Inventory | Currency (USD) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-003` | Average inventory age | Inventory | Days (1 decimal) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-004` | Median inventory age | Inventory | Days (integer) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-005` | Aged inventory count | Inventory | Count (integer) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-006` | Aged inventory percentage | Inventory | Percentage (1 decimal) | Store × snapshot date | **Implemented** | **Yes** |
| `KPI-INV-007` | Days to sale | Inventory | Days | Sale transaction, aggregable | **Implemented** | **Yes** |
| `KPI-INV-008` | Inventory turn | Inventory | Turns per year (2 decimals) | Store × period | **Implemented** | **Yes** |
| `KPI-INV-009` | Dealer days supply | Inventory | Days (integer) | Store × as-of date | **Implemented** | **Yes** |
| `KPI-FUN-001` | Leads received | Funnel | Count (integer) | Store × day | **Implemented** | **Yes** |
| `KPI-FUN-002` | Contact rate | Funnel | Percentage (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-003` | Appointment-set rate | Funnel | Percentage (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-004` | Show rate | Funnel | Percentage (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-005` | Show-to-sale conversion | Funnel | Percentage (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-006` | Lead-to-sale conversion | Funnel | Percentage (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-007` | Average response time | Funnel | Minutes (1 decimal) | Store × period | **Implemented** | **Yes** |
| `KPI-FUN-008` | Median response time | Funnel | Minutes (integer) | Store × period | **Implemented** | **Yes** |
| `KPI-MKT-001` | Marketing cost per lead | Marketing | Currency per lead (USD) | Store × campaign × month | **Implemented** | No |
| `KPI-MKT-002` | Marketing cost per sale | Marketing | Currency per sale (USD) | Store × campaign × month | **Implemented** | No |
| `KPI-MKT-003` | Gross return on advertising spend | Marketing | Ratio (2 decimals) | Store × campaign × month | **Implemented** | No |

**29 KPIs specified. All 29 Implemented — computable from `reporting` and verified against an independent derivation from `warehouse`. Deferred KPIs are listed separately in section 35.**

**This index is the MVP register, and `DASH.5` did not change it.** Two further governed families live in
their own sections and are deliberately counted apart, because this figure is what the Power BI semantic
model was measured against and neither family is a DAX measure: 24 Inventory Listings KPIs
(`KPI-LST-001..024`, §38) and 10 Targets and pace KPIs (`KPI-TGT-001..010`, §39). The accurate statement is
**29 MVP KPIs + 24 Inventory Listings KPIs + 10 implemented Target and pace KPIs**, never "63 MVP KPIs".

---

## 5. Average and median governance

`docs/research.md` §4.4 (*Metric Governance Note*) requires that turn and days-supply calculations document
the time period used, the inventory included, the sales included, retail versus wholesale treatment, new
versus used treatment, whether sold units enter denominator logic, and whether rolling averages are used.
Every inventory KPI below answers all seven questions explicitly.

`docs/research.md` §4.3 and §4.4 both require **average age and median age**, and **average days to sale and
median days to sale**. §4.5 likewise requires **average response time and median response time**. That is a
deliberate pairing, not redundancy, and this catalogue treats it as a governance rule:

| Metric pair | Headline figure | Why both exist |
|---|---|---|
| Inventory age (`KPI-INV-003` mean, `KPI-INV-004` median) | **Median** | Inventory age is right-skewed: most units sell within a few weeks while a small tail sits for months. A handful of 200-day units drags the mean upward and makes a fundamentally healthy lot look sick — or, worse, makes management chase an average that no individual unit resembles. The median describes the typical unit. The mean is retained because it is the only figure that reconciles additively (`SUM(days_in_stock) / COUNT(*)`), and because **the gap between mean and median is itself the diagnostic**: a mean far above the median is direct evidence of an aged tail, which is exactly what `KPI-INV-005` and `KPI-INV-006` then quantify. |
| Response time (`KPI-FUN-007` mean, `KPI-FUN-008` median) | **Median** | Response time is severely right-skewed: most responses happen in minutes, a few happen days later or never. The mean is dominated by the tail and can move dramatically because of one lead. The median describes the experience of the typical customer. The mean is retained to expose the tail and to reconcile to total response seconds. |
| Days to sale (`KPI-INV-007`) | **Median** | Same skew as inventory age. `KPI-INV-007` publishes both statistics from one definition. |

**Rule.** Wherever a mean and a median of the same quantity are both available, a report page must show the
median as the headline value and must make the mean available (card, tooltip, or adjacent column). Showing
only the mean of a skewed distribution is a reporting defect in this project, not a stylistic choice.

---

# Domain: Sales

---

## 6. `KPI-SLS-001` — Retail units sold

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-SLS-001` |
| **Display name** | Retail units sold |
| **Business purpose** | The primary volume measure of the business, and the denominator of every per-unit gross measure. Answers "how many cars did we deliver?" |
| **Business owner persona** | General sales manager (`docs/research.md` §8.2) |
| **Definition (plain English)** | The count of finalized retail and lease deliveries in the period. Wholesale disposals and dealer trades are not retail units and are never counted here. |
| **Formula** | `SUM(unit_count) WHERE is_retail = true` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true`, restricted to the selected period and filter context. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Computed at store × day; fully additive across store, day, employee, vehicle, model, and lead source, so it aggregates to any period without restatement. |
| **Date basis** | `warehouse.fact_vehicle_sale.sale_date_key` → `warehouse.dim_date`. The sale date, not the delivery date. Delivery-date reporting is available separately via `delivery_date_key` and must be labelled as such. |
| **Filters** | `is_retail = true`. Store, employee, vehicle, model, and lead-source filters apply from the surrounding context. |
| **Exclusions** | Canceled deals (never loaded as finalized sales); wholesale transactions; dealer trades. Per [ARCHITECTURE.md §18.2](ARCHITECTURE.md), wholesale may be included only when specifically selected, and then must be labelled a different measure. |
| **Null / zero-denominator behaviour** | No denominator. An empty filter context returns `0`, never `BLANK()`, because "no cars sold" is a meaningful business answer and must be visible on a trend line. |
| **Unit and formatting** | Integer count. Thousands separator. No decimals. |
| **SQL ownership** | `reporting.vw_sales_summary` (Implemented), aggregating `reporting.vw_vehicle_sales`. A semantic model should bind to the row-grain fact view instead, because a ratio recomputes correctly there under any filter context. |
| **Future DAX ownership** | Sales measures group ([ARCHITECTURE.md §19.3](ARCHITECTURE.md)). Also surfaced on Executive measures. |
| **Reconciliation rule** | `RECON-UNITS-001` — retail units by month in SQL must equal Power BI totals exactly (tolerance 0). |
| **Interpretation caution** | Volume alone must never be used to rank employees or stores. `docs/research.md` §4.6 is explicit: a high-volume employee may show weak gross retention, poor follow-up, heavy discounting, or simply favourable lead routing. Always pair this measure with `KPI-GRS-006` and funnel context. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 7. `KPI-SLS-002` — New units sold

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-SLS-002` |
| **Display name** | New units sold |
| **Business purpose** | Isolates new-vehicle volume, which behaves differently from used: different supply constraint, different gross structure, different incentive exposure. Required for the new-versus-used comparison in `docs/research.md` §4.8. |
| **Business owner persona** | New-car manager |
| **Definition (plain English)** | The count of finalized retail and lease deliveries of new vehicles in the period. |
| **Formula** | `SUM(unit_count) WHERE is_retail = true AND the vehicle's condition is New` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true` and the joined `warehouse.dim_vehicle.condition_type = 'New'`. **Corrected 2026-07-29:** this field previously read `sale_type = 'New Retail'`, which contradicted the plain-English definition and the exclusion list on this same row — both say leases of NEW units are counted here and only leases of USED units are excluded. `sale_type` alone cannot express that, because `Lease` is a retail sale type that is neither `'New Retail'` nor `'Used Retail'`, so every lease fell outside both halves of `RECON-UNITS-001`. The split is taken from the vehicle's condition, which is what makes the identity hold to the unit. Exposed as `reporting.vw_vehicle_sales.new_unit_count`. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true`, vehicle `condition_type = 'New'`. |
| **Exclusions** | Used and certified retail; leases of used units; wholesale; dealer trades; canceled deals. **Certified pre-owned units are used units** and are counted in `KPI-SLS-003`, never here. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. Structurally `0` for `GSA-003`, which is an independent used store with no franchise — that zero is correct, not missing data. |
| **Unit and formatting** | Integer count. Thousands separator. |
| **SQL ownership** | `reporting.vw_sales_summary` (Implemented). |
| **Future DAX ownership** | Sales measures group. |
| **Reconciliation rule** | `RECON-UNITS-001` — `KPI-SLS-002 + KPI-SLS-003` must equal `KPI-SLS-001` for every filter context. If the identity fails, a sale type is unmapped. |
| **Interpretation caution** | New-vehicle gross is affected by manufacturer incentives, which [ARCHITECTURE.md §18.2](ARCHITECTURE.md) **excludes from the initial model**. New-unit profitability in ARPI is therefore incomplete by design, and comparisons of new against used gross must say so. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_vehicle` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 8. `KPI-SLS-003` — Used units sold

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-SLS-003` |
| **Display name** | Used units sold |
| **Business purpose** | Isolates used-vehicle volume. Used is where acquisition skill, reconditioning discipline, and pricing judgement show up, and where gross variance is widest. |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The count of finalized retail and lease deliveries of used vehicles, **including manufacturer-certified pre-owned units**, in the period. |
| **Formula** | `SUM(unit_count) WHERE is_retail = true AND the vehicle's condition is Used or Certified` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true` and the joined `warehouse.dim_vehicle.condition_type IN ('Used', 'Certified')`. **Corrected 2026-07-29** for the same reason as `KPI-SLS-002`: leases of used units belong here, and a `sale_type` filter cannot reach them. Exposed as `reporting.vw_vehicle_sales.used_unit_count`. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true`, vehicle `condition_type IN ('Used', 'Certified')`. |
| **Exclusions** | New retail; wholesale; dealer trades; canceled deals. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. |
| **Unit and formatting** | Integer count. Thousands separator. |
| **SQL ownership** | `reporting.vw_sales_summary` (Implemented). |
| **Future DAX ownership** | Sales measures group. A separate certified-only measure may be added later; it must not silently change this definition. |
| **Reconciliation rule** | `RECON-UNITS-001` — see `KPI-SLS-002`. |
| **Interpretation caution** | Certified units are included here by definition. Any report that shows "used" and "certified" as separate categories must make clear whether the used figure is inclusive or exclusive of certified, because both conventions exist in the industry and mixing them silently double-counts or under-counts. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_vehicle` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

# Domain: Gross profit

> [ARCHITECTURE.md §18.2](ARCHITECTURE.md) and `docs/research.md` §4.2 both insist that front-end, back-end,
> and total gross **remain separate**. Combining them too early destroys the diagnosis: a store can hold
> total gross steady while front gross collapses and F&I compensates, and that is a materially different
> business situation from a store where both are stable.

---

## 9. `KPI-GRS-001` — Front-end gross

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-001` |
| **Display name** | Front-end gross |
| **Business purpose** | Profit earned on the vehicle itself. The measure most sensitive to pricing, discounting, acquisition cost, and reconditioning discipline. |
| **Business owner persona** | General sales manager |
| **Definition (plain English)** | Total vehicle profit on finalized retail deliveries: selling price less what the unit cost to acquire, recondition, and pack. |
| **Formula** | `SUM(final sale price − acquisition cost − reconditioning cost − pack amount)` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.front_end_gross)` over rows where `is_retail = true`, where each row's `front_end_gross = sale_price − acquisition_cost − reconditioning_cost − pack_amount`, computed once in SQL at load. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true` for the headline measure. A wholesale variant is a separate, separately named measure. |
| **Exclusions** | Canceled deals; back-end components (finance reserve, F&I products); **manufacturer incentives and accounting adjustments**, which [ARCHITECTURE.md §18.2](ARCHITECTURE.md) excludes from the initial model unless explicitly generated and documented. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. **Negative values are legitimate and must remain visible** — a negative-front deal is a real dealership outcome and is one of the required measures in `docs/research.md` §4.2. [ARCHITECTURE.md §19.6](ARCHITECTURE.md) requires negative values to stay interpretable. |
| **Unit and formatting** | Currency, USD, no decimals at summary level. Negative values shown with a minus sign and a distinguishing treatment that is **not colour alone** ([ARCHITECTURE.md §19.6](ARCHITECTURE.md)). |
| **SQL ownership** | Row-level arithmetic in `warehouse.fact_vehicle_sale` (SQL warehouse — [ARCHITECTURE.md §18.1](ARCHITECTURE.md) assigns row-level financial arithmetic to SQL). Aggregation in `reporting.vw_gross_summary` (Implemented); row-grain numerators in `reporting.vw_vehicle_sales`. |
| **Future DAX ownership** | Gross measures group. |
| **Reconciliation rule** | `RECON-GROSS-001` — for every row, `front_end_gross + back_end_gross = total_gross` within `validation.numeric_absolute_tolerance` (0.01). `RECON-GROSS-002` — monthly SQL totals equal Power BI totals. |
| **Interpretation caution** | Because incentives are excluded, new-vehicle front gross in ARPI is systematically understated relative to how a real store would report it. This is a **modelling boundary, not a finding**. Never state or imply that ARPI front gross reflects real-world new-car profitability. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 10. `KPI-GRS-002` — Back-end gross

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-002` |
| **Display name** | Back-end gross |
| **Business purpose** | Profit earned in the finance office. Shows whether total profitability is being carried by the vehicle or by F&I, which is a central management question. |
| **Business owner persona** | Finance director |
| **Definition (plain English)** | The sum of net finance reserve and net F&I product gross on finalized retail deliveries. |
| **Formula** | `SUM(net finance reserve + net F&I product gross)` for finalized transactions — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.back_end_gross)` over rows where `is_retail = true`. In the MVP this column is generated directly at deal level. Once `warehouse.fact_finance_product_sale` exists (Deferred), it becomes a derived total that must reconcile to product-level detail. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `sale_date_key` → `dim_date`. **Cancellations and chargebacks occur after the original sale** ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)), so a restated back-end figure for a past month is expected behaviour once the Deferred F&I fact exists. Until then, back-end gross is as-booked. |
| **Filters** | `is_retail = true`. |
| **Exclusions** | Canceled deals; front-end components; wholesale and dealer trades (which generate no F&I). |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. A cash deal with no products legitimately contributes `0`, not NULL. |
| **Unit and formatting** | Currency, USD, no decimals at summary level. |
| **SQL ownership** | `warehouse.fact_vehicle_sale` at row level; `reporting.vw_gross_summary` (Implemented) for aggregation. |
| **Future DAX ownership** | Gross measures group; also referenced by the F&I measures group when that domain is unlocked. |
| **Reconciliation rule** | `RECON-GROSS-001`. `RECON-FI-001` (Deferred) — once `fact_finance_product_sale` exists, the sum of net product gross plus finance reserve must equal this measure. |
| **Interpretation caution** | In the MVP, back-end gross is a **single generated number with no product-level detail behind it**. It cannot answer "which product drove this?", and any narrative about product mix is unsupported until the Deferred F&I fact is built. ARPI models no real lender behaviour, no rate sheets, and no credit decisions — see [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.fact_finance_product_sale` (Deferred, for full reconciliation), `warehouse.dim_date` (Implemented) |

---

## 11. `KPI-GRS-003` — Total gross

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-003` |
| **Display name** | Total gross |
| **Business purpose** | The headline profitability figure and the single most-quoted number in dealership management reporting. |
| **Business owner persona** | Dealer principal |
| **Definition (plain English)** | Front-end gross plus back-end gross on finalized retail deliveries. |
| **Formula** | `front-end gross + back-end gross` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.total_gross)` over rows where `is_retail = true`, where each row's `total_gross = front_end_gross + back_end_gross`, stored at load rather than recomputed at query time. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true` for the headline measure. |
| **Exclusions** | Canceled deals; wholesale and dealer trades unless explicitly selected and labelled. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. May be negative; must remain visible. |
| **Unit and formatting** | Currency, USD, no decimals at summary level. |
| **SQL ownership** | `warehouse.fact_vehicle_sale` at row level; `reporting.vw_gross_summary` (Implemented). |
| **Future DAX ownership** | Executive measures group and Gross measures group. |
| **Reconciliation rule** | `RECON-GROSS-001` — `total_gross = front_end_gross + back_end_gross` at row level, tolerance 0.01. `RECON-GROSS-002` — monthly SQL totals equal Power BI totals. Also a required business-rule test in [ARCHITECTURE.md §21.2](ARCHITECTURE.md). |
| **Interpretation caution** | Total gross conceals the trade-off between front and back. A flat total gross trend can hide a collapsing front offset by rising F&I — a materially different and usually less durable business. Always show `KPI-GRS-001` and `KPI-GRS-002` alongside it. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 12. `KPI-GRS-004` — Front gross per retail unit

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-004` |
| **Display name** | Front gross per retail unit |
| **Business purpose** | Normalizes vehicle profit for volume, so that a small store and a large store can be compared, and so that a change in profit can be attributed to *pricing* rather than to *volume*. |
| **Business owner persona** | General sales manager |
| **Definition (plain English)** | Average vehicle profit earned on each retail unit delivered in the period. |
| **Formula** | `total retail front-end gross / retail units sold` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.front_end_gross)` over rows where `is_retail = true`, in the filter context. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true`, in the **same** filter context. Per [ARCHITECTURE.md §18.2](ARCHITECTURE.md), **the denominator must exclude wholesale and dealer-trade transactions.** |
| **Grain** | Store × period. **Non-additive** — it is a ratio and must be recomputed at every level of aggregation, never summed or averaged from lower levels. |
| **Date basis** | `sale_date_key` → `dim_date`. Numerator and denominator must use the identical date basis and identical filter context; a mismatch is the classic way this measure silently goes wrong. |
| **Filters** | `is_retail = true` on both sides. |
| **Exclusions** | Wholesale and dealer trades on both sides; canceled deals; manufacturer incentives (excluded from the numerator by the front-gross definition). |
| **Null / zero-denominator behaviour** | **When the denominator is `0`, return `BLANK()` / NULL — never `0`.** Zero units sold means the metric is undefined, not that per-unit gross was nothing. Displaying `$0` in a month with no sales would be a false statement. Charts must show a gap, not a zero point. |
| **Unit and formatting** | Currency per unit, USD, no decimals. Displayed as e.g. `$1,842`. |
| **SQL ownership** | `reporting.vw_gross_summary` (Implemented) exposes numerator and denominator **as separate additive columns**, and `reporting.vw_vehicle_sales` exposes them at row level. The division is performed in DAX so that it recomputes correctly under any filter. |
| **Future DAX ownership** | Gross measures group. Implemented with `DIVIDE(numerator, denominator)` so the zero-denominator case returns `BLANK()` by default. |
| **Reconciliation rule** | `RECON-GROSS-002` — the numerator and the denominator must each reconcile independently to SQL monthly totals. Reconciling the ratio alone is insufficient: two compensating errors can produce a correct ratio. |
| **Interpretation caution** | A rising per-unit gross with falling volume is not automatically good; it often means the store stopped chasing marginal deals, which can be correct or can be lost market share. Pair with `KPI-SLS-001`. Never compare this figure to an external benchmark — ARPI has none. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 13. `KPI-GRS-005` — Back gross per retail unit

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-005` |
| **Display name** | Back gross per retail unit |
| **Business purpose** | The standard measure of finance-office productivity. Answers "how much are we earning in F&I on every car we deliver?" |
| **Business owner persona** | Finance director |
| **Definition (plain English)** | Average finance and insurance profit earned on each retail unit delivered in the period. |
| **Formula** | `total retail back-end gross / retail units sold` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.back_end_gross)` over rows where `is_retail = true`. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true`, same filter context. Wholesale and dealer trades are excluded from the denominator. |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true` on both sides. |
| **Exclusions** | Wholesale; dealer trades; canceled deals. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL. A cash deal with no F&I products contributes `0` to the numerator and `1` to the denominator — it is included, because excluding cash deals would overstate finance-office productivity. |
| **Unit and formatting** | Currency per unit, USD, no decimals. |
| **SQL ownership** | `reporting.vw_gross_summary` (Implemented), numerator and denominator as separate columns. |
| **Future DAX ownership** | Gross measures group; also exposed by the F&I measures group when unlocked. |
| **Reconciliation rule** | `RECON-GROSS-002`; and, once the Deferred F&I fact exists, `RECON-FI-001`. |
| **Interpretation caution** | The **denominator includes cash deals**, which cannot generate finance reserve. A store with an unusual cash mix will show a lower figure for reasons unrelated to finance-office skill. Any comparison across stores must control for deal-type mix. ARPI publishes no target or benchmark for this measure. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 14. `KPI-GRS-006` — Total gross per retail unit

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-GRS-006` |
| **Display name** | Total gross per retail unit |
| **Business purpose** | The single most useful summary of deal quality, and the correct companion to unit volume in any employee or store comparison. |
| **Business owner persona** | Dealer principal |
| **Definition (plain English)** | Average total profit — vehicle plus finance office — earned on each retail unit delivered in the period. |
| **Formula** | `total retail gross / retail units sold` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.total_gross)` over rows where `is_retail = true`. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true`, same filter context. **The denominator must exclude wholesale and dealer-trade transactions** ([ARCHITECTURE.md §18.2](ARCHITECTURE.md)). |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `sale_date_key` → `dim_date`. |
| **Filters** | `is_retail = true` on both sides. |
| **Exclusions** | Wholesale; dealer trades; canceled deals. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL. |
| **Unit and formatting** | Currency per unit, USD, no decimals. |
| **SQL ownership** | `reporting.vw_gross_summary` (Implemented). |
| **Future DAX ownership** | Executive measures group and Gross measures group. |
| **Reconciliation rule** | `RECON-GROSS-002`. Identity check: `KPI-GRS-006` must equal `KPI-GRS-004 + KPI-GRS-005` in every filter context, because all three share one denominator. A failure of that identity means the filter contexts have diverged. |
| **Interpretation caution** | This is the correct counterweight to volume in employee analysis, but it is **still not sufficient on its own**. [ARCHITECTURE.md §23](ARCHITECTURE.md) requires employee scorecards to carry contextual metrics — lead volume received, lead-source mix, store traffic, tenure, new-versus-used mix, inventory availability, manager involvement. Ranking on gross per unit alone penalizes whoever is handed the harder inventory. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_employee` (Planned, for employee context), `warehouse.dim_date` (Implemented) |

---

# Domain: Inventory

> Every inventory KPI answers the seven questions `docs/research.md` §4.4 requires: time period, inventory
> included, sales included, retail versus wholesale treatment, new versus used treatment, whether sold units
> enter denominator logic, and whether rolling averages are used.

---

## 15. `KPI-INV-001` — Active inventory count

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-001` |
| **Display name** | Active inventory count |
| **Business purpose** | How many units the group is carrying. The base of every inventory-health measure and the numerator of days supply. |
| **Business owner persona** | Used-car manager (and new-car manager for the new-vehicle slice) |
| **Definition (plain English)** | The number of vehicles physically in stock at a store on a given snapshot date. |
| **Formula** | `SUM(inventory_unit_count)` for the selected snapshot date |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` for rows whose `snapshot_date_key` equals the single selected as-of date. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × snapshot date. **Semi-additive:** additive across store, vehicle, and model, but **NOT additive across dates.** Summing this measure over a month yields unit-days, not units. Time aggregation must use last-value or average-of-daily-values, and the choice must be stated on the visual. |
| **Date basis** | `snapshot_date_key` → `dim_date`. A single as-of date, defaulting to the latest snapshot in the model. |
| **Filters** | Store, vehicle condition (new / used / certified), model, and vehicle source apply from context. |
| **Exclusions** | Units already sold, wholesaled, or transferred — snapshot generation stops after disposition ([ARCHITECTURE.md §12.2](ARCHITECTURE.md)), so they are absent by construction rather than filtered out. Units not yet acquired. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` when no units are in stock. Returns `BLANK()` if the selected date has **no snapshot rows at all**, which signals missing data rather than an empty lot — the two cases must be distinguishable, and the Data Quality page exists partly to make that visible. |
| **Unit and formatting** | Integer count. Thousands separator. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented), with row-level values in `reporting.vw_inventory_snapshots`. |
| **Future DAX ownership** | Inventory measures group. Must be written with explicit semi-additive handling (`LASTNONBLANKVALUE` or equivalent), never a naive `SUM` over a date range. |
| **Reconciliation rule** | `RECON-INV-001` — inventory count on selected dates must match snapshot records ([ARCHITECTURE.md §21.3](ARCHITECTURE.md)). Grain uniqueness on `(snapshot_date_key, dealership_key, vehicle_key)` is a prerequisite: a duplicate row inflates this measure directly. |
| **Interpretation caution** | Semi-additivity is the single most common way this measure is misreported. A month-level card showing a summed daily count is wrong by roughly a factor of 30 and looks plausible. Every visual using this measure must state its time-aggregation rule. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_vehicle` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 16. `KPI-INV-002` — Inventory investment

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-002` |
| **Display name** | Inventory investment |
| **Business purpose** | How much capital is tied up in stock. Converts an aging problem from a count into a dollar figure, which is what makes it a management priority. |
| **Business owner persona** | Dealer principal |
| **Definition (plain English)** | The total money invested in the vehicles in stock on a given date: acquisition cost plus reconditioning spend. |
| **Formula** | `SUM(acquisition_cost + reconditioning_cost)` for the selected snapshot date |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_investment)` for rows whose `snapshot_date_key` equals the selected as-of date, where `inventory_investment = acquisition_cost + reconditioning_cost`. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × snapshot date. **Semi-additive** — same rule as `KPI-INV-001`. |
| **Date basis** | `snapshot_date_key` → `dim_date`, single as-of date. |
| **Filters** | Store, vehicle condition, model, age bucket. |
| **Exclusions** | Disposed units; floor-plan interest, holding cost, and carrying cost — **none of which ARPI models**. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` when no units are in stock; `BLANK()` when the date has no snapshot rows. |
| **Unit and formatting** | Currency, USD, no decimals. Large values may be abbreviated (`$1.2M`) provided the tooltip shows the full figure. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented), with row-level values in `reporting.vw_inventory_snapshots`. |
| **Future DAX ownership** | Inventory measures group; Executive measures group for the aged-investment card. |
| **Reconciliation rule** | `RECON-INV-001`. |
| **Interpretation caution** | This is **cost invested, not market value and not floor-plan exposure**. ARPI models no floor-plan interest, no holding cost, and no carrying cost, so statements about "what aged inventory is costing us per day" are **not supportable from this data**. The honest statement is "this much capital is committed to units older than N days". |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 17. `KPI-INV-003` — Average inventory age

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-003` |
| **Display name** | Average inventory age |
| **Business purpose** | Mean days in stock across the active lot. Retained primarily for reconciliation and, in contrast with the median, as a direct indicator of an aged tail. **Not the headline age figure.** |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The arithmetic mean number of days that the vehicles currently in stock have been in stock. |
| **Formula** | `SUM(days_in_stock) / COUNT(active units)` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.days_in_stock)` for rows on the selected snapshot date, where `days_in_stock` = calendar days between acquisition date and snapshot date ([ARCHITECTURE.md §18.2](ARCHITECTURE.md), *Inventory age*). |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` for the **same** snapshot date and filter context — that is, `KPI-INV-001`. |
| **Grain** | Store × snapshot date. **Non-additive ratio; also semi-additive in its denominator.** Must be recomputed at every aggregation level and at every date. |
| **Date basis** | `snapshot_date_key` → `dim_date`, single as-of date. |
| **Filters** | Store, vehicle condition, model, vehicle source. |
| **Exclusions** | Disposed units. Both sides use the same population — mixing populations across numerator and denominator is the standard failure mode here. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL. An empty lot has no average age; it does not have an average age of zero. |
| **Unit and formatting** | Days, one decimal place. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented) exposes `SUM(days_in_stock)` and the unit count as separate additive columns. |
| **Future DAX ownership** | Inventory measures group, using `DIVIDE`. |
| **Reconciliation rule** | `RECON-INV-001`. `days_in_stock` must be non-negative for every row ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)) — a single negative value corrupts this measure invisibly. |
| **Interpretation caution** | **The mean is the wrong headline for this distribution.** Inventory age is right-skewed; a small number of very old units pulls the mean well above what any typical unit looks like. Use `KPI-INV-004` as the headline and read the mean-minus-median gap as evidence of an aged tail. See section 5. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 18. `KPI-INV-004` — Median inventory age

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-004` |
| **Display name** | Median inventory age |
| **Business purpose** | **The headline inventory-age figure.** Describes the typical unit on the lot without distortion from the aged tail. |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The middle value of days-in-stock across the vehicles currently in stock: half the lot is younger, half is older. |
| **Formula** | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stock)` over active units on the snapshot date |
| **Numerator (precise)** | `n/a — this is an order statistic, not a ratio.` The input population is `warehouse.fact_vehicle_inventory_snapshot.days_in_stock` for all rows on the selected snapshot date in the filter context. |
| **Denominator (precise)** | `n/a — order statistic` |
| **Grain** | Store × snapshot date. **Not additive and not decomposable** — the median of a group is not derivable from the medians of its subgroups. It must be recomputed from the underlying rows at every aggregation level. |
| **Date basis** | `snapshot_date_key` → `dim_date`, single as-of date. |
| **Filters** | Store, vehicle condition, model, vehicle source. |
| **Exclusions** | Disposed units. |
| **Null / zero-denominator behaviour** | Returns `BLANK()` / NULL when the population is empty. With an even population size, the linear-interpolated median (`PERCENTILE_CONT`) is used and rounded to the nearest whole day for display; the interpolation method is fixed so that SQL and DAX agree. |
| **Unit and formatting** | Days, integer. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented) publishes the median at store, snapshot date and condition group, and `reporting.vw_inventory_aging` publishes the distribution behind it. **Because the median cannot be recomputed in DAX from a pre-aggregated view, `reporting.vw_inventory_snapshots` exposes row-level `days_in_stock`.** That is the deliberate exception to the "aggregate in the view" pattern. |
| **Future DAX ownership** | Inventory measures group, using `MEDIAN` over the row-level column so that it recomputes under filter context. |
| **Reconciliation rule** | `RECON-INV-001`. Sanity relationship: for a right-skewed distribution `KPI-INV-004 <= KPI-INV-003` should normally hold; a persistent inversion is a signal to inspect the data, not a finding. |
| **Interpretation caution** | The median is deliberately insensitive to the aged tail — which is why it is the right *typical-unit* figure and the wrong *risk* figure. Read it together with `KPI-INV-005` and `KPI-INV-006`, which are the measures that quantify the tail. Neither figure may be compared to an industry standard, because ARPI has none. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 19. `KPI-INV-005` — Aged inventory count

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-005` |
| **Display name** | Aged inventory count |
| **Business purpose** | The number of units that have crossed the aging threshold. The actionable list: these are the units requiring a pricing or disposal decision. |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The count of vehicles in stock on the selected date whose days-in-stock exceeds the selected age threshold. |
| **Formula** | `SUM(inventory_unit_count) WHERE days_in_stock > age_threshold` |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` for rows on the selected snapshot date where `days_in_stock > @age_threshold`. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × snapshot date. Semi-additive across dates, exactly like `KPI-INV-001`. |
| **Date basis** | `snapshot_date_key` → `dim_date`, single as-of date. |
| **Filters** | `days_in_stock > @age_threshold`. **`@age_threshold` defaults to 60 days.** This is a **project default sourced from [ARCHITECTURE.md §18.2](ARCHITECTURE.md)** (*Aged inventory percentage — Default threshold: 60 days*). **It is not an industry benchmark and is not presented as one.** It is exposed as a report parameter so that a reviewer can change it and watch the answer move. |
| **Exclusions** | Disposed units. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` when no units exceed the threshold — which is a genuine and good business answer. |
| **Unit and formatting** | Integer count. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented) and `reporting.vw_inventory_snapshots`, which exposes row-level `days_in_stock` and the age bucket so the threshold stays adjustable. |
| **Future DAX ownership** | Inventory measures group; Executive measures group for the exception summary. |
| **Reconciliation rule** | `RECON-INV-001`. Consistency: `KPI-INV-005 <= KPI-INV-001` must always hold. |
| **Interpretation caution** | The threshold is a **convention, not a law**. Different operators use 30, 45, 60, or 90 days, and the right threshold varies by vehicle class and market. Any finding that depends on the threshold must state the threshold in the same sentence. `docs/research.md` §4.3 defines the standard age buckets ARPI uses for distribution reporting: 0–15, 16–30, 31–45, 46–60, 61–90, and over 90 days. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 20. `KPI-INV-006` — Aged inventory percentage

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-006` |
| **Display name** | Aged inventory percentage |
| **Business purpose** | Normalizes aged-unit exposure for lot size, so a 3-store group with very different inventory volumes can be compared on one scale. The standard inventory-health indicator on an executive page. |
| **Business owner persona** | General manager |
| **Definition (plain English)** | The share of the active lot that has been in stock longer than the selected age threshold. |
| **Formula** | `active inventory units above selected age threshold / total active inventory units` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` on the selected snapshot date where `days_in_stock > @age_threshold` — that is, `KPI-INV-005`. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` on the **same** snapshot date, in the **same** filter context, with **no age filter** — that is, `KPI-INV-001`. |
| **Grain** | Store × snapshot date. **Non-additive ratio.** Recompute at every level. |
| **Date basis** | `snapshot_date_key` → `dim_date`, single as-of date, identical on both sides. |
| **Filters** | Numerator filters `days_in_stock > @age_threshold`; **denominator must not.** All other filters apply identically to both. **`@age_threshold` defaults to 60 days — a project default from [ARCHITECTURE.md §18.2](ARCHITECTURE.md), not an industry benchmark.** |
| **Exclusions** | Disposed units, on both sides. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL — an empty lot has no aged percentage. Numerator `0` with a non-zero denominator correctly returns `0.0%`. |
| **Unit and formatting** | Percentage, one decimal place, e.g. `18.4%`. |
| **SQL ownership** | `reporting.vw_inventory_health` (Implemented), numerator and denominator as separate additive columns. |
| **Future DAX ownership** | Inventory measures group; Executive measures group. `DIVIDE` for safe division. |
| **Reconciliation rule** | `RECON-INV-001`. Both sides must reconcile independently. |
| **Interpretation caution** | This ratio can improve for a bad reason: **wholesaling aged units removes them from the numerator**, so the percentage falls while the group takes a loss. Always read it alongside `KPI-INV-002` and wholesale volume. And, again, ARPI has **no benchmark for what a healthy aged percentage is** — this measure supports comparison across stores, models, and time, not comparison against the industry. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 21. `KPI-INV-007` — Days to sale

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-007` |
| **Display name** | Days to sale |
| **Business purpose** | How long it actually took to sell the units that sold. The outcome measure that pairs with inventory age's in-flight measure. |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The number of calendar days between acquiring a vehicle and finalizing its sale. Published as **median (headline)** and **mean (companion)**. |
| **Formula** | Per unit: `finalized sale date − acquisition date` ([ARCHITECTURE.md §18.2](ARCHITECTURE.md)). Aggregate median: `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_inventory_at_sale)`. Aggregate mean: `SUM(days_in_inventory_at_sale) / SUM(unit_count)`. |
| **Numerator (precise)** | For the mean: `SUM(warehouse.fact_vehicle_sale.days_in_inventory_at_sale)` over rows where `is_retail = true`. For the median: `n/a — order statistic` over the same population. |
| **Denominator (precise)** | For the mean: `SUM(warehouse.fact_vehicle_sale.unit_count)` over rows where `is_retail = true`, same filter context. For the median: `n/a — order statistic`. |
| **Grain** | One value per sale transaction; aggregable to store × period as a median or mean. Neither aggregate is additive. |
| **Date basis** | `sale_date_key` → `dim_date`. Units are attributed to the period in which they **sold**, not the period in which they were acquired. A unit acquired in January and sold in April counts entirely in April. |
| **Filters** | `is_retail = true`. Store, vehicle condition, model, vehicle source apply from context. |
| **Exclusions** | **Wholesale disposals and dealer trades**, which are not retail sales and whose timing reflects a disposal decision rather than retail demand. Canceled deals. **Unsold units still in stock are excluded by construction** — this is survivorship bias and is called out below. |
| **Null / zero-denominator behaviour** | Both aggregates return `BLANK()` / NULL when no retail units sold in the context. `days_in_inventory_at_sale` is non-negative by rule; sale date cannot precede acquisition date ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). |
| **Unit and formatting** | Days. Median as integer; mean to one decimal. Both labelled explicitly — a chart titled only "days to sale" is not acceptable. |
| **SQL ownership** | `reporting.vw_sales_summary` (Implemented) for the mean components; `reporting.vw_days_to_sale` (Implemented) for the median, with the row-level population in `reporting.vw_vehicle_sales.retail_days_in_inventory`. |
| **Future DAX ownership** | Inventory measures group. |
| **Reconciliation rule** | `RECON-UNITS-001` — the unit denominator must match `KPI-SLS-001` in the same context. |
| **Interpretation caution** | **Survivorship bias is the dominant caution.** This measure describes only units that sold. A lot full of 300-day units that never sell can show an excellent days-to-sale figure, because those units never enter the population. Days to sale must always be read with `KPI-INV-004` (age of what is still there) and `KPI-INV-006`. `docs/research.md` §4.4 requires the retail-versus-wholesale and new-versus-used treatment to be documented: this measure is **retail only**, and new and used are reported separately because their distributions differ materially. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_vehicle` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 22. `KPI-INV-008` — Inventory turn

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-008` |
| **Display name** | Inventory turn |
| **Business purpose** | How many times the lot is sold and replaced in a year. The standard efficiency measure for working capital deployed in inventory. |
| **Business owner persona** | Dealer principal |
| **Definition (plain English)** | Annualized retail sales volume divided by the average number of retail units held in stock over the same period. |
| **Formula** | `annualized retail units sold / average active retail inventory` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` where `is_retail = true` over the selected period, **annualized as** `× (365 / number_of_calendar_days_in_the_selected_period)`. The annualization factor uses **calendar days, not selling days**, and the selected period's day count comes from `dim_date`. |
| **Denominator (precise)** | `AVG(daily active inventory count)` over the **same** period: `SUM(inventory_unit_count) / COUNT(DISTINCT snapshot_date_key)` from `warehouse.fact_vehicle_inventory_snapshot`, restricted to the same store and vehicle-condition filter context. **A daily average, not a beginning-plus-ending-divided-by-two approximation** — the daily snapshot exists precisely so this can be exact. |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | Numerator: `sale_date_key`. Denominator: `snapshot_date_key`. **Two different date columns over the same period window** — this is the subtlety that makes the measure easy to get wrong, and both must be driven by the same period selection. |
| **Filters** | `is_retail = true` on the numerator. New and used are reported separately by default, because their turn rates are not comparable. |
| **Exclusions** | **Wholesale and dealer trades are excluded from the numerator** — they dispose of inventory but are not retail turn. **Sold units are excluded from the denominator on and after their sale date**, because snapshots stop at disposition; the denominator is the average *active* lot, not average units touched. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL. A period with no snapshot rows returns `BLANK()`, not `0`. |
| **Unit and formatting** | Turns per year, two decimals, e.g. `8.42`. The annualization must be stated on the visual. |
| **SQL ownership** | `reporting.vw_inventory_turn` (Implemented), exposing annualized units and average daily inventory as separate columns. |
| **Future DAX ownership** | Inventory measures group. |
| **Reconciliation rule** | `RECON-UNITS-001` for the numerator; `RECON-INV-001` for the denominator. |
| **Interpretation caution** | `docs/research.md` §4.4 warns explicitly that **turn and days-supply calculations vary across vendors**, and requires the method to be documented. ARPI's method is stated in full above: calendar-day annualization, retail-only numerator, daily-average active denominator, new and used separated, sold units excluded from the denominator after disposition, no rolling average. **An ARPI turn figure is not comparable to a turn figure from any other system unless that system uses the same seven choices.** Turn is also unstable over short periods — annualizing a 7-day window produces a number, but not an informative one. Minimum recommended window: one calendar month. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale` (Implemented), `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 23. `KPI-INV-009` — Dealer days supply

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-INV-009` |
| **Display name** | Dealer days supply |
| **Business purpose** | How long the current lot would last at the recent selling pace. The operational counterpart to turn, and the measure most directly used to decide whether to buy more inventory. |
| **Business owner persona** | Used-car manager |
| **Definition (plain English)** | The number of days the current inventory would cover, given average daily retail sales over the recent trailing window. |
| **Formula** | `current active inventory / average daily retail sales over the selected trailing period` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_inventory_snapshot.inventory_unit_count)` on the **single as-of date** (the latest snapshot date in context) — that is, `KPI-INV-001`. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` where `is_retail = true` over the trailing `@trailing_days` **calendar** days ending on the as-of date, divided by `@trailing_days`. |
| **Grain** | Store × as-of date. **Non-additive ratio.** |
| **Date basis** | Numerator: `snapshot_date_key` = as-of date. Denominator: `sale_date_key` in `[as_of_date − @trailing_days + 1, as_of_date]`. |
| **Filters** | **`@trailing_days` defaults to 30.** This is a **project default sourced from [ARCHITECTURE.md §18.2](ARCHITECTURE.md)** (*Dealer days supply — Default trailing period: 30 days*), **not an industry benchmark.** It is exposed as a report parameter. New and used are reported separately. |
| **Exclusions** | Wholesale and dealer trades from the denominator; disposed units from the numerator. **Calendar days are used for the trailing window, not selling days** — the alternative is defensible but produces different numbers, so the choice is fixed here and stated on the visual. |
| **Null / zero-denominator behaviour** | **Zero sales in the trailing window returns `BLANK()` / NULL, never infinity and never a large sentinel number.** Days supply is genuinely undefined when the selling pace is zero, and rendering `∞` or `9999` on an executive card would be worse than rendering nothing. The visual must show "insufficient sales history" rather than a value. |
| **Unit and formatting** | Days, integer. The trailing window must be stated on the visual (e.g. "days supply, 30-day pace"). |
| **SQL ownership** | `reporting.vw_days_supply` (Implemented). |
| **Future DAX ownership** | Inventory measures group. |
| **Reconciliation rule** | `RECON-INV-001` for the numerator; `RECON-UNITS-001` for the denominator. |
| **Interpretation caution** | Days supply is **extremely sensitive to the trailing window** and to seasonality: a 30-day window ending in a slow month makes a normal lot look overstocked. `docs/research.md` §4.4's governance requirements apply in full — ARPI's stated choices are 30 calendar days, retail-only sales, active inventory at a single as-of date, new and used separated, no rolling average, sold units excluded from the numerator. **ARPI publishes no target days supply**, because it has no benchmark data. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_vehicle_inventory_snapshot` (Implemented), `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

# Domain: Lead funnel

> Funnel rates form a chain. Each rate's denominator is the previous stage's numerator, so the stages
> multiply cleanly: `contact rate × appointment-set rate × show rate × show-to-sale conversion` should
> approximate `lead-to-sale conversion`. Where it does not, leads have entered or left the funnel by a path
> the model does not capture — which is itself worth knowing.

---

## 24. `KPI-FUN-001` — Leads received

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-001` |
| **Display name** | Leads received |
| **Business purpose** | Top-of-funnel volume. The denominator of contact rate and lead-to-sale conversion, and the basis of marketing cost per lead. |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | The count of valid, non-duplicate CRM leads created in the period. |
| **Formula** | `SUM(lead_count) WHERE is_duplicate = false` |
| **Numerator (precise)** | `SUM(warehouse.fact_lead.lead_count)` over rows where `is_duplicate = false`. |
| **Denominator (precise)** | `n/a — additive measure` |
| **Grain** | Store × day; fully additive. |
| **Date basis** | `lead_created_date_key` → `dim_date`. Leads count in the period they were **created**, regardless of when or whether they later converted. |
| **Filters** | `is_duplicate = false`. Lead source, campaign, store, assigned employee apply from context. |
| **Exclusions** | **Duplicate leads** (`is_duplicate = true`). This is the single most important exclusion in the funnel: duplicates inflate volume and depress every conversion rate simultaneously, making a source look both busy and bad. A separate duplicate-lead-rate measure is available and must be used to report duplicates, rather than folding them into volume. |
| **Null / zero-denominator behaviour** | No denominator. Returns `0` in an empty context. |
| **Unit and formatting** | Integer count. Thousands separator. |
| **SQL ownership** | `reporting.vw_lead_funnel` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group. |
| **Reconciliation rule** | `RECON-LEAD-001` — lead totals by source must match source-level staging counts after documented exclusions ([ARCHITECTURE.md §21.3](ARCHITECTURE.md)). The reconciliation must show the excluded duplicate count explicitly so the difference is explained, not merely tolerated. |
| **Interpretation caution** | Vendor-reported lead counts (`fact_marketing_spend.vendor_reported_leads`) **will not match this measure**, and are not expected to: vendors count differently and typically count duplicates. That discrepancy is an analytical finding to report, not a data-quality defect to hide. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.dim_lead_source` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 25. `KPI-FUN-002` — Contact rate

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-002` |
| **Display name** | Contact rate |
| **Business purpose** | The first funnel stage, and the one most directly under BDC control. A weak contact rate makes every downstream rate irrelevant. |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | The share of valid leads with which the store established two-way contact. |
| **Formula** | `unique contacted leads / valid nonduplicate leads` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_contacted = true` and `is_duplicate = false`. |
| **Denominator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_duplicate = false` — that is, `KPI-FUN-001`, in the same filter context. |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `lead_created_date_key` → `dim_date` on both sides. **Both sides are anchored to lead creation, not to contact date** — otherwise leads created near the end of a period would be counted in the denominator before they have had a fair chance to be contacted. |
| **Filters** | `is_duplicate = false` on both sides. |
| **Exclusions** | Duplicate leads, on both sides. |
| **Null / zero-denominator behaviour** | Zero denominator returns `BLANK()` / NULL. Zero contacted with a non-zero denominator correctly returns `0.0%`. |
| **Unit and formatting** | Percentage, one decimal place. |
| **SQL ownership** | `reporting.vw_lead_funnel` (Implemented), numerator and denominator as separate additive columns. |
| **Future DAX ownership** | Lead-funnel measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Consistency: numerator `<=` denominator always. |
| **Interpretation caution** | **Right-censoring.** Leads created in the last few days of a period may not yet have been contacted, which depresses the rate for the current period. A period-to-date comparison against a complete prior period is misleading unless the same maturity window is applied to both. `docs/research.md` §4.5 also notes that sources differ in lead quality, so contact rate is not comparable across sources without controlling for source. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.dim_lead_source` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 26. `KPI-FUN-003` — Appointment-set rate

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-003` |
| **Display name** | Appointment-set rate |
| **Business purpose** | Measures whether contact is being converted into a scheduled visit — the step that most strongly predicts a sale. |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | Of the leads the store actually reached, the share for which an appointment was booked. |
| **Formula** | `unique leads with an appointment set / unique contacted leads` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_appointment_set = true` and `is_duplicate = false`. |
| **Denominator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_contacted = true` and `is_duplicate = false` — the numerator of `KPI-FUN-002`, in the same filter context. **The denominator is contacted leads, not all leads.** |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `lead_created_date_key` → `dim_date` on both sides. |
| **Filters** | `is_duplicate = false` on both sides; `is_contacted = true` on the denominator. |
| **Exclusions** | Duplicates; **uncontacted leads are excluded from the denominator by design**, because an appointment cannot be set with someone who was never reached. A store with a very poor contact rate can therefore show a healthy appointment-set rate — that is correct behaviour and is exactly why the two rates are reported side by side. |
| **Null / zero-denominator behaviour** | Zero contacted leads returns `BLANK()` / NULL. |
| **Unit and formatting** | Percentage, one decimal place. |
| **SQL ownership** | `reporting.vw_lead_funnel` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Consistency: `is_appointment_set = true` implies `is_contacted = true`, so the numerator can never exceed the denominator. |
| **Interpretation caution** | Because the denominator is conditional on contact, this rate **cannot be read without `KPI-FUN-002` next to it**. Reporting it alone allows a store that reaches 20% of its leads to look better than a store that reaches 70%. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 27. `KPI-FUN-004` — Show rate

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-004` |
| **Display name** | Show rate |
| **Business purpose** | Whether booked appointments actually turn into people in the showroom. Distinguishes appointment-setting activity from appointment-setting quality. |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | The share of appointments eligible to show at which the customer actually arrived. |
| **Formula** | `appointments that showed / scheduled appointments eligible to show` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_appointment.appointment_count)` where `is_shown = true`. |
| **Denominator (precise)** | `SUM(warehouse.fact_appointment.appointment_count)` where `is_cancelled_in_advance = false` **and** the scheduled date is on or before the period end (the appointment has had its chance to occur). Because the date basis IS `scheduled_date_key`, restricting the period handles the second condition automatically. Exposed as `reporting.vw_appointments.eligible_appointment_count`. |
| **Grain** | Store × period. **Non-additive ratio.** Note the grain shift: this measure is computed over **appointments**, not leads — one lead can produce several appointments. |
| **Date basis** | `scheduled_date_key` → `dim_date` on both sides. **Not the created date** — an appointment scheduled for next month is not eligible to show this month and must not sit in this month's denominator. |
| **Filters** | `is_cancelled_in_advance = false` on the denominator. |
| **Exclusions** | **Appointments cancelled before the scheduled date (`is_cancelled_in_advance = true`) are excluded from the denominator.** [ARCHITECTURE.md §18.2](ARCHITECTURE.md) permits this "if documented" — this is that documentation, and the rationale is that an appointment the customer cancelled in advance never had the opportunity to show, so counting it as a no-show conflates two different failures. **A separate cancellation-rate measure is required alongside this one so the excluded population stays visible.** Appointments scheduled after the period end are also excluded from the denominator. |
| **Null / zero-denominator behaviour** | Zero eligible appointments returns `BLANK()` / NULL. |
| **Unit and formatting** | Percentage, one decimal place. |
| **SQL ownership** | `reporting.vw_appointment_funnel` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Consistency: show date cannot precede appointment creation ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)); `is_shown = true` implies `is_cancelled_in_advance = false`. |
| **Interpretation caution** | **The cancellation exclusion is the manipulable part of this measure.** A store that aggressively marks no-shows as advance cancellations will report a flattering show rate. The cancellation rate must therefore be published on the same visual. This is a modelled behaviour in ARPI's synthetic data and a real risk in production CRM data. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_appointment` (Implemented), `warehouse.fact_lead` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 28. `KPI-FUN-005` — Show-to-sale conversion

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-005` |
| **Display name** | Show-to-sale conversion |
| **Business purpose** | The closing rate on customers who physically arrived. Isolates showroom and salesperson performance from BDC and marketing performance. |
| **Business owner persona** | General sales manager |
| **Definition (plain English)** | Of the appointments where the customer showed up, the share that resulted in a finalized retail sale. |
| **Formula** | `shown appointments linked to a finalized retail sale / shown appointments` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_appointment.appointment_count)` where `is_shown = true` **and** `is_sold = true` **and** `sale_key` resolves to a finalized retail sale. Exposed as `reporting.vw_appointments.shown_and_sold_appointment_count`. |
| **Denominator (precise)** | `SUM(warehouse.fact_appointment.appointment_count)` where `is_shown = true`, in the same filter context. |
| **Grain** | Store × period. **Non-additive ratio**, computed over appointments. |
| **Date basis** | `show_date_key` → `dim_date` on both sides. Attribution is to the date of the visit, not the date of the sale, so that the visit and its outcome sit in the same period. |
| **Filters** | `is_shown = true` on both sides. |
| **Exclusions** | Appointments that did not show; appointments linked to wholesale disposals (not retail sales); canceled deals. |
| **Null / zero-denominator behaviour** | Zero shown appointments returns `BLANK()` / NULL. |
| **Unit and formatting** | Percentage, one decimal place. |
| **SQL ownership** | `reporting.vw_appointment_funnel` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group; Executive measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Business rule: **sold appointments must link to a finalized vehicle sale** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)) — an `is_sold = true` row with an unresolvable `sale_key` is a critical failure, not a rounding issue. |
| **Interpretation caution** | **Lag.** A customer who visits on the last day of a month and buys three days later is a sale in the next period but a show in this one. Under this measure's date basis the sale is still attributed to the visit date, so late-period conversion will appear to improve as the data matures. Period-to-date figures must be labelled as incomplete. Also note that walk-in traffic without an appointment is **not** in this measure at all. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_appointment` (Implemented), `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 29. `KPI-FUN-006` — Lead-to-sale conversion

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-006` |
| **Display name** | Lead-to-sale conversion |
| **Business purpose** | The end-to-end funnel result. The measure that determines whether a lead source is worth paying for. |
| **Business owner persona** | Internet or BDC director; marketing manager |
| **Definition (plain English)** | The share of valid leads that ultimately resulted in a finalized retail sale. |
| **Formula** | `unique leads linked to a finalized retail sale / valid nonduplicate leads` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_sold = true`, `is_duplicate = false`, and `sale_key` resolves to a finalized retail sale. Exposed as `reporting.vw_leads.sold_lead_count`. |
| **Denominator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_duplicate = false` — that is, `KPI-FUN-001`, in the same filter context. |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `lead_created_date_key` → `dim_date` **on both sides**. A lead created in March that sells in May counts in **March** — the lead's cohort, not the sale's period. This is a deliberate choice: it is the only basis on which a source's conversion is meaningful, and it is the reason recent periods appear to convert poorly. |
| **Filters** | `is_duplicate = false` on both sides. Lead source, campaign, store, employee from context. |
| **Exclusions** | Duplicate leads; leads linked only to wholesale transactions; canceled deals. |
| **Null / zero-denominator behaviour** | Zero valid leads returns `BLANK()` / NULL. |
| **Unit and formatting** | Percentage, one decimal place. |
| **SQL ownership** | `reporting.vw_lead_funnel` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group; Executive measures group; Marketing measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Chain check: `KPI-FUN-002 × KPI-FUN-003 × KPI-FUN-004 × KPI-FUN-005` should approximate this measure. A large gap means leads are converting by a path the funnel does not model (walk-ins later matched to a lead, for example), and must be explained rather than ignored. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_lead_source` (Implemented), `warehouse.dim_date` (Implemented) |
| **Interpretation caution** | **Cohort maturity dominates this measure.** Because leads are attributed to their creation date, the most recent months will always look worst — those leads have not finished converting. Comparing an immature month to a mature one is the single most common misreading of this metric, and any trend visual must either restrict to matured cohorts or label the immature tail. Attribution is also **single-source, first-touch** in ARPI: a customer who arrived through three channels is credited to one. Multi-touch attribution is **out of scope**. |

---

## 30. `KPI-FUN-007` — Average response time

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-007` |
| **Display name** | Average response time |
| **Business purpose** | Mean time to first response. Retained as the companion to the median and for total-response-seconds reconciliation. **Not the headline responsiveness figure.** |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | The arithmetic mean number of minutes between a lead arriving and the store's first outbound response. |
| **Formula** | `SUM(first_response_seconds) / COUNT(leads with a response) / 60` |
| **Numerator (precise)** | `SUM(warehouse.fact_lead.first_response_seconds)` over rows where `first_response_seconds IS NOT NULL` and `is_duplicate = false`, divided by 60 for display in minutes. |
| **Denominator (precise)** | `COUNT(warehouse.fact_lead.lead_key)` where `first_response_seconds IS NOT NULL` and `is_duplicate = false`, in the same filter context. **Leads that were never responded to are excluded from the denominator** — see the caution. |
| **Grain** | Store × period. **Non-additive ratio.** |
| **Date basis** | `lead_created_date_key` → `dim_date`. |
| **Filters** | `is_duplicate = false`; `first_response_seconds IS NOT NULL`. |
| **Exclusions** | Duplicates; **leads never responded to**, which have `first_response_seconds IS NULL`. NULL here means "no response ever", which is analytically different from a zero or a very large response time. |
| **Null / zero-denominator behaviour** | Zero responded leads returns `BLANK()` / NULL. Note that `first_response_seconds = 0` (an instant auto-response) is a valid value and is included; only NULL is excluded. |
| **Unit and formatting** | Minutes, one decimal place. Values over 24 hours should be shown in hours with the unit stated. |
| **SQL ownership** | `reporting.vw_lead_response` (Implemented). |
| **Future DAX ownership** | Lead-funnel measures group. |
| **Reconciliation rule** | `RECON-LEAD-001`. Business rule: **first response cannot occur before lead creation** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)) — `first_response_seconds` is non-negative. |
| **Interpretation caution** | **Two compounding distortions.** First, the distribution is severely right-skewed: one lead answered after four days can move the mean for an entire store-month. Second, **excluding never-responded leads means the worst outcomes are invisible in this measure** — a store that ignores half its leads can report an excellent average response time. Both `KPI-FUN-008` and a separate "leads without follow-up" count (`docs/research.md` §4.5) must be shown alongside. Use the median as the headline. See section 5. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

## 31. `KPI-FUN-008` — Median response time

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FUN-008` |
| **Display name** | Median response time |
| **Business purpose** | **The headline responsiveness figure.** Describes what the typical customer actually experiences, undistorted by the tail. |
| **Business owner persona** | Internet or BDC director |
| **Definition (plain English)** | The middle value of first-response times: half of responded leads were answered faster, half slower. |
| **Formula** | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY first_response_seconds) / 60` |
| **Numerator (precise)** | `n/a — order statistic.` The input population is `warehouse.fact_lead.first_response_seconds` for rows where the value is not NULL and `is_duplicate = false`. |
| **Denominator (precise)** | `n/a — order statistic` |
| **Grain** | Store × period. **Not additive and not decomposable** — must be recomputed from row-level values at every aggregation level. |
| **Date basis** | `lead_created_date_key` → `dim_date`. |
| **Filters** | `is_duplicate = false`; `first_response_seconds IS NOT NULL`. |
| **Exclusions** | Duplicates; leads never responded to. |
| **Null / zero-denominator behaviour** | Returns `BLANK()` / NULL when the population is empty. Even-sized populations use linear-interpolated `PERCENTILE_CONT`, fixed so SQL and DAX agree. |
| **Unit and formatting** | Minutes, integer. |
| **SQL ownership** | `reporting.vw_lead_response` (Implemented). As with `KPI-INV-004`, the median cannot be recomputed from a pre-aggregated view, so **row-level `first_response_seconds` is exposed on `reporting.vw_leads`.** |
| **Future DAX ownership** | Lead-funnel measures group, using `MEDIAN`. |
| **Reconciliation rule** | `RECON-LEAD-001`. Sanity relationship: `KPI-FUN-008 <= KPI-FUN-007` should normally hold for this right-skewed distribution. |
| **Interpretation caution** | The median shares the never-responded exclusion with `KPI-FUN-007` and is therefore **equally blind to ignored leads**. It must be published with the count of leads without follow-up. `docs/research.md` §4.5 lists response-time band as a recommended dimension: a **banded distribution** (under 5 minutes, 5–15, 15–60, over 60) is more actionable than either single statistic and should be the primary visual, with the median as the summary card. ARPI states **no target response time** — it has no benchmark data. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_lead` (Implemented), `warehouse.dim_date` (Implemented), `warehouse.dim_dealership` (Implemented) |

---

# Domain: Marketing

---

## 32. `KPI-MKT-001` — Marketing cost per lead

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-MKT-001` |
| **Display name** | Marketing cost per lead |
| **Business purpose** | What the store pays to generate one opportunity. The first-order efficiency measure for a paid channel. |
| **Business owner persona** | Marketing manager |
| **Definition (plain English)** | Marketing spend divided by the number of valid leads attributed to that source or campaign in the same month. |
| **Formula** | `marketing spend / valid leads attributed to the source or campaign` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_marketing_spend.spend_amount)` for the selected store, campaign, and month. |
| **Denominator (precise)** | `COUNT(DISTINCT warehouse.fact_lead.lead_key)` where `is_duplicate = false` and the lead is attributed to the same `campaign_key` (or `lead_source_key`), with `lead_created_date_key` falling in the **same calendar month** as the spend row. |
| **Grain** | Store × campaign × **month**. **Non-additive ratio.** |
| **Date basis** | Spend: `month_date_key` → `dim_date` (first day of month). Leads: `lead_created_date_key` → `dim_date`, aggregated to the same month. |
| **Filters** | `is_duplicate = false` on the denominator. Paid sources only (`dim_lead_source.is_paid = true`). |
| **Exclusions** | Duplicate leads; **organic and internal sources**, for which the measure is undefined rather than zero — a walk-in has no marketing cost per lead. |
| **Null / zero-denominator behaviour** | **Zero leads with non-zero spend returns `BLANK()` / NULL, not infinity.** A channel that spent money and produced nothing is a real and important finding, but the correct way to report it is spend with zero leads, not an infinite cost per lead. The visual must surface that case explicitly. Zero spend with leads present returns `0`, which is correct for an organic tail on a paid campaign. |
| **Unit and formatting** | Currency per lead, USD, two decimals. |
| **SQL ownership** | `reporting.vw_marketing_performance` (Implemented), exposing spend and attributed lead count as separate additive columns. |
| **Future DAX ownership** | Marketing measures group. |
| **Reconciliation rule** | `RECON-LEAD-001` for the denominator. Spend must be non-negative ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). |
| **Interpretation caution** | **Grain mismatch is the central caution.** Spend is monthly; leads are daily. **This measure must never be computed at day grain** — dividing a monthly spend figure by one day's leads produces a number that is meaningless and looks fine. Month is the finest valid grain. In addition, attribution is single-source and first-touch, campaigns can generate leads outside their target segment ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)), and cost per lead says nothing about lead quality — see `KPI-MKT-002` and `KPI-MKT-003`. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_marketing_spend` (Implemented), `warehouse.fact_lead` (Implemented), `warehouse.dim_marketing_campaign` (Implemented), `warehouse.dim_lead_source` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 33. `KPI-MKT-002` — Marketing cost per sale

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-MKT-002` |
| **Display name** | Marketing cost per sale |
| **Business purpose** | What the store pays to generate one delivered car. Corrects for lead quality, which cost per lead ignores entirely. |
| **Business owner persona** | Marketing manager |
| **Definition (plain English)** | Marketing spend divided by the number of finalized retail sales attributed to that source or campaign. |
| **Formula** | `marketing spend / finalized retail sales attributed to the source or campaign` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_marketing_spend.spend_amount)` for the selected store, campaign, and month. |
| **Denominator (precise)** | `SUM(warehouse.fact_vehicle_sale.unit_count)` where `is_retail = true` and the sale's originating lead is attributed to the same `campaign_key` (or `lead_source_key`), with the **originating lead's creation month** equal to the spend month. |
| **Grain** | Store × campaign × **month**. **Non-additive ratio.** |
| **Date basis** | Spend: `month_date_key`. Sales: attributed via the originating lead's `lead_created_date_key`, **not the sale date.** Anchoring to the lead's creation month is what keeps spend and outcome in the same cohort; anchoring to the sale date would credit this month's spend with last quarter's leads. |
| **Filters** | `is_retail = true` on the denominator; paid sources only. |
| **Exclusions** | Wholesale and dealer trades; canceled deals; organic and internal sources. |
| **Null / zero-denominator behaviour** | **Zero attributed sales with non-zero spend returns `BLANK()` / NULL, not infinity.** Report it as "spend with no attributed sales", which is the actionable statement. |
| **Unit and formatting** | Currency per sale, USD, no decimals. |
| **SQL ownership** | `reporting.vw_marketing_performance` (Implemented). |
| **Future DAX ownership** | Marketing measures group. |
| **Reconciliation rule** | `RECON-UNITS-001` for the denominator; `RECON-LEAD-001` for the attribution chain. |
| **Interpretation caution** | **Cohort immaturity is severe here.** Leads created this month have not finished converting, so the current month's cost per sale will always look terrible and will improve for weeks afterwards. Trend visuals must restrict to matured cohorts or label the tail. Attribution remains **single-source, first-touch**; multi-touch attribution is out of scope. The same monthly grain floor as `KPI-MKT-001` applies. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_marketing_spend` (Implemented), `warehouse.fact_lead` (Implemented), `warehouse.fact_vehicle_sale` (Implemented), `warehouse.dim_marketing_campaign` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 34. `KPI-MKT-003` — Gross return on advertising spend

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-MKT-003` |
| **Display name** | Gross return on advertising spend |
| **Business purpose** | Whether a channel makes money after the cost of the cars it sells. The only marketing return measure ARPI treats as primary. |
| **Business owner persona** | Marketing manager; dealer principal |
| **Definition (plain English)** | Total gross profit attributed to a source or campaign, divided by the marketing spend on it. A value of 1.0 means the channel returned exactly its cost in gross profit. |
| **Formula** | `attributed total gross / marketing spend` — [ARCHITECTURE.md §18.2](ARCHITECTURE.md) |
| **Numerator (precise)** | `SUM(warehouse.fact_vehicle_sale.total_gross)` where `is_retail = true` and the sale's originating lead is attributed to the campaign or source, with the originating lead's creation month equal to the spend month. |
| **Denominator (precise)** | `SUM(warehouse.fact_marketing_spend.spend_amount)` for the same store, campaign, and month. |
| **Grain** | Store × campaign × **month**. **Non-additive ratio.** |
| **Date basis** | Both sides anchored to the spend month; sales attributed via the originating lead's creation month. |
| **Filters** | `is_retail = true` on the numerator; paid sources only. |
| **Exclusions** | Wholesale and dealer trades; canceled deals; organic and internal sources. |
| **Null / zero-denominator behaviour** | **Zero spend returns `BLANK()` / NULL, never infinity.** Gross with zero spend is not an infinite return; it is an organic result and belongs in a different measure. |
| **Unit and formatting** | Ratio, two decimals, e.g. `3.42`. May be shown as a multiple (`3.4×`). **Not formatted as a percentage**, to avoid confusion with margin. |
| **SQL ownership** | `reporting.vw_marketing_performance` (Implemented). |
| **Future DAX ownership** | Marketing measures group; Executive measures group. |
| **Reconciliation rule** | `RECON-GROSS-002` for the numerator. |
| **Interpretation caution** | [ARCHITECTURE.md §18.2](ARCHITECTURE.md) is explicit: **revenue return must not be presented as the primary profitability measure**, and `docs/research.md` §4.10 explains why — dealership revenue includes the cost of the vehicle, so revenue-based ROAS is inflated by roughly an order of magnitude and is close to meaningless. ARPI therefore publishes **gross**-based return as primary. Beyond that: this measure does not net out any cost other than vehicle cost — no personnel, facility, or floor-plan cost is modelled — so it is a **contribution measure, not a profit measure**. It is also subject to the same first-touch attribution limit and cohort immaturity as `KPI-MKT-002`, and no target value is published because ARPI has no benchmark. |
| **Implementation status** | **Implemented** |
| **Depends on (entities)** | `warehouse.fact_marketing_spend` (Implemented), `warehouse.fact_vehicle_sale` (Implemented), `warehouse.fact_lead` (Implemented), `warehouse.dim_marketing_campaign` (Implemented), `warehouse.dim_date` (Implemented) |

---

## 35. Deferred KPIs

These metrics are part of the target architecture but sit outside the current roadmap. They are listed with
grain and unlock phase only; full specifications will be written when the underlying facts are approved
under Gate 4 ([ARCHITECTURE.md §28](ARCHITECTURE.md)).

| Candidate KPI | Grain | Depends on | Unlock stage | Status |
|---|---|---|---|---|
| F&I product penetration — `eligible retail transactions containing the product / eligible retail transactions` | Store × product × period | `warehouse.fact_finance_product_sale`, `warehouse.dim_finance_product` | Strong portfolio release — F&I product analysis ([ARCHITECTURE.md §31](ARCHITECTURE.md)) | **Deferred** |
| Products per retail unit — `total eligible products sold / eligible retail units` | Store × period | `warehouse.fact_finance_product_sale` | Strong portfolio release — F&I product analysis | **Deferred** |
| Repeat-customer rate — `customers with a prior completed purchase / customers with a completed purchase in the period` | Store × period | `warehouse.dim_customer`, `warehouse.fact_vehicle_sale` with full history | Strong portfolio release — customer retention | **Deferred** |
| Service-to-sales conversion — `replacement-opportunity service customers linked to a finalized retail sale / qualified replacement-opportunity service customers` | Store × period | `warehouse.fact_service_visit` | Strong portfolio release — service-to-sales opportunities | **Deferred** |

One standing constraint applies when these are eventually specified:

- **Service-to-sales opportunity logic must be presented as decision support, not as a guarantee of
  customer purchase intent** (`docs/research.md` §4.13).

**Target attainment has left this table.** It was listed here as Deferred, blocked by
`warehouse.fact_sales_target`. `DASH.5` promoted that fact through Gate 4 and the family is now specified
in full in §39 as `KPI-TGT-001` … `KPI-TGT-010`. Its standing constraint travelled with it and is stated
at the top of that section: **target values are fictional operating goals for a fictional group, never
industry benchmarks** ([LIMITATIONS.md](LIMITATIONS.md)).

**Reserved future families.** The dashboard program
([ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md)) reserved three
KPI families. `KPI-TGT-001..010` (targets and pace) **is no longer reserved: it is Implemented and
specified in §39**. The remaining two — `KPI-FNI-001..022` (F&I detail) and
`KPI-ACC-001..012` (accounting integrity) — are still reserved and are specified field-by-field in
[`docs/dashboard/KPI_EXTENSION_PLAN.md`](docs/dashboard/KPI_EXTENSION_PLAN.md). They enter this
catalogue only when their source facts are promoted through Gate 4 by the owning
[`DASHBOARD_BACKLOG.md`](docs/requirements/DASHBOARD_BACKLOG.md) increment, with every field in the
template and a registered stakeholder question. The reserved identifiers are permanent from first
mention. Back-end gross and back gross per retail unit deliberately keep their existing IDs
(`KPI-GRS-002`, `KPI-GRS-005`).

---

## 36. Reconciliation register

Reconciliation is how ARPI proves its numbers rather than asserting them. Six of the entries below are the
required reconciliations from [ARCHITECTURE.md §21.3](ARCHITECTURE.md). The two `RECON-DIM-*-ROWCOUNT`
entries are **a Phase 0 addition beyond §21.3** — §21.3 does not list a row-count reconciliation; Phase 0
adds one per foundation dimension so the implemented slice has something it can actually prove. Results are
recorded in `audit.reconciliation_result` ([DATA_DICTIONARY.md §22](DATA_DICTIONARY.md)).

| Reconciliation ID | Description | Left source | Right source | Tolerance | Status |
|---|---|---|---|---|---|
| `RECON-DIM-<D>-ROWCOUNT` | Generated dimension row count equals the warehouse row count after the merge. One per dimension. | `generator:<dimension>` | `warehouse.<dimension>` | 0 (exact) | **Implemented** |
| `RECON-INGEST-<E>-CHAIN` | Every raw row of the newest batch is accounted for: `raw = staging accepted + rejected + deduplicated`. One per ingested entity. | `raw.<table>` | `staging.<view>` + rejected + deduplicated | 0 (exact) | **Implemented** |
| `RECON-INGEST-<D>-WAREHOUSE` | Every business key staging accepted reached the warehouse dimension. One per dimension. | `staging.<view>` | `warehouse.<dimension>` | 0 (exact) | **Implemented** |
| `RECON-FACT-VEHICLE-SALE-WAREHOUSE` | Every `sale_id` staging accepted reached `fact_vehicle_sale` | `staging.stg_sale_event` | `warehouse.fact_vehicle_sale` | 0 (exact) | **Implemented** |
| `RECON-FACT-INVENTORY-SNAPSHOT-WAREHOUSE` | Every staged snapshot grain key reached the fact | `staging.stg_inventory_snapshot` | `warehouse.fact_vehicle_inventory_snapshot` | 0 (exact) | **Implemented** |
| `RECON-FACT-LEAD-WAREHOUSE` | Every `lead_id` staging accepted reached `fact_lead` | `staging.stg_lead` | `warehouse.fact_lead` | 0 (exact) | **Implemented** |
| `RECON-FACT-APPOINTMENT-WAREHOUSE` | Every `appointment_id` staging accepted reached `fact_appointment` | `staging.stg_appointment` | `warehouse.fact_appointment` | 0 (exact) | **Implemented** |
| `RECON-FACT-MARKETING-SPEND-WAREHOUSE` | Every staged spend grain key reached the fact | `staging.stg_marketing_spend` | `warehouse.fact_marketing_spend` | 0 (exact) | **Implemented** |
| `RECON-INV-CONTINUITY` | Every vehicle-store pair has an unbroken run of daily snapshots | `warehouse.fact_vehicle_inventory_snapshot` (pairs with a gap) | zero gaps required | 0 (exact) | **Implemented** |
| `RECON-GROSS-001` | `total_gross = front_end_gross + back_end_gross` on **every row**, to the cent | `warehouse.fact_vehicle_sale` (conforming rows) | `warehouse.fact_vehicle_sale` (all rows) | 0 (exact) on the count; `validation.numeric_absolute_tolerance` = 0.01 per row | **Implemented** |
| `RECON-GROSS-001-FRONT` | `front_end_gross = sale_price − acquisition − reconditioning − pack` on every row | `warehouse.fact_vehicle_sale` (conforming rows) | `warehouse.fact_vehicle_sale` (all rows) | 0 (exact) on the count; 0.01 per row | **Implemented** |
| `RECON-GROSS-002` | Reporting total gross equals warehouse retail total gross | `reporting.vw_gross_summary` | `warehouse.fact_vehicle_sale` | 0.01 absolute | **Implemented** (SQL side; the Power BI side follows Gate 1) |
| `RECON-UNITS-001` | `KPI-SLS-002 + KPI-SLS-003 = KPI-SLS-001` on **every store-day row** | `reporting.vw_sales_summary` (conforming rows) | `reporting.vw_sales_summary` (all rows) | 0 (exact) | **Implemented** (SQL side; the Power BI side follows Gate 1) |
| `RECON-REPORT-SALES` | Reporting retail units equal warehouse retail units | `reporting.vw_sales_summary` | `warehouse.fact_vehicle_sale` | 0 (exact) | **Implemented** |
| `RECON-INV-001` | Inventory counts in the reporting layer match the snapshot records, and the health and aging views agree with each other | `reporting.vw_inventory_health` | `warehouse.fact_vehicle_inventory_snapshot` | 0 (exact) | **Implemented** |
| `RECON-LEAD-001` | `leads received + duplicates excluded = staged leads`, stated as an addition so a lost lead and an extra duplicate cannot cancel | `reporting.vw_lead_funnel` | `staging.stg_lead` | 0 (exact) | **Implemented** |
| `RECON-LEAD-DUPLICATES` | The duplicate exclusion survives the whole ingestion path | `reporting.vw_lead_funnel` | `staging.stg_lead` | 0 (exact) | **Implemented** |
| `RECON-FUNNEL-BOUNDS` | Funnel populations nest correctly on every store-source-day row | `reporting.vw_lead_funnel` (conforming rows) | `reporting.vw_lead_funnel` (all rows) | 0 (exact) | **Implemented** |
| `RECON-FUNNEL-SOLD-PATH` | The lead fact and the appointment fact agree on which leads showed | `warehouse.fact_lead` | `warehouse.fact_appointment` | 0 (exact) | **Implemented** |
| `RECON-FUNNEL-CHAIN` | The four-rate chain product approximates modelled-path conversion across the lead-to-appointment grain shift | `reporting.vw_lead_funnel` × `reporting.vw_appointment_funnel` | `reporting.vw_lead_funnel` | 0.01 absolute | **Implemented** — *informational, not critical*; see the note below |
| `RECON-MKT-SPEND` | Reporting spend equals warehouse spend | `reporting.vw_marketing_performance` | `warehouse.fact_marketing_spend` | 0.01 absolute | **Implemented** |
| `RECON-MKT-LEADS` | Attributed leads equal valid warehouse leads | `reporting.vw_marketing_performance` | `warehouse.fact_lead` | 0 (exact) | **Implemented** |
| `RECON-MKT-SALES` | Attributed retail units equal the units reachable through a non-duplicate lead | `reporting.vw_marketing_performance` | `warehouse.fact_lead` ⋈ `warehouse.fact_vehicle_sale` | 0 (exact) | **Implemented** |
| `RECON-MKT-GROSS` | Attributed gross equals the gross of those same sales | `reporting.vw_marketing_performance` | `warehouse.fact_lead` ⋈ `warehouse.fact_vehicle_sale` | 0.01 absolute | **Implemented** |
| `RECON-MKT-COST-RULE` | No organic or internal source carries a cost measure | `reporting.vw_marketing_performance` (violations) | zero violations required | 0 (exact) | **Implemented** |
| `RECON-REPORT-SALES-ROWS` | `vw_vehicle_sales` preserves the fact grain and total gross | `reporting.vw_vehicle_sales` | `warehouse.fact_vehicle_sale` | 0 (exact) | **Implemented** |
| `RECON-REPORT-INVENTORY-ROWS` | `vw_inventory_snapshots` preserves the fact grain | `reporting.vw_inventory_snapshots` | `warehouse.fact_vehicle_inventory_snapshot` | 0 (exact) | **Implemented** |
| `RECON-REPORT-LEADS-ROWS` | `vw_leads` preserves the fact grain and the two funnel views agree on the valid population | `reporting.vw_leads` | `warehouse.fact_lead` | 0 (exact) | **Implemented** |
| `RECON-REPORT-APPOINTMENTS-ROWS` | `vw_appointments` preserves the fact grain and the funnel view accounts for every appointment | `reporting.vw_appointments` | `warehouse.fact_appointment` | 0 (exact) | **Implemented** |
| `RECON-REPORT-SPEND-ROWS` | `vw_marketing_spend` preserves the fact grain | `reporting.vw_marketing_spend` | `warehouse.fact_marketing_spend` | 0 (exact) | **Implemented** |
| `RECON-REPORT-DAYS-TO-SALE` | The days-to-sale population is exactly the retail units sold | `reporting.vw_days_to_sale` | `warehouse.fact_vehicle_sale` | 0 (exact) | **Implemented** |
| `RECON-FI-001` | **Every cent of a deal's back-end gross is explained**: `finance_reserve_gross + SUM(original_product_gross)` equals `back_end_gross`, **per deal** | `warehouse.fact_vehicle_sale.back_end_gross` | `warehouse.fact_vehicle_sale.finance_reserve_gross` + `warehouse.fact_finance_product_sale.original_product_gross` | 0 (exact) | **Implemented** — promoted by DASH.6; see the note below |
| `RECON-FI-DEAL-LEVEL` | The same identity as a group total | `warehouse.fact_vehicle_sale` | `warehouse.fact_finance_product_sale` | 0.01 absolute | **Implemented** |
| `RECON-FI-TOTAL-GROSS` | The pre-existing `total = front + back` identity still holds after the decomposition | `warehouse.fact_vehicle_sale` | `warehouse.fact_vehicle_sale` | 0.01 absolute | **Implemented** |
| `RECON-FI-PRODUCT-IDENTITY` | `original_product_gross = product_retail_price − product_dealer_cost` on every contract | `warehouse.fact_finance_product_sale` (conforming rows) | `warehouse.fact_finance_product_sale` (all rows) | 0 (exact) | **Implemented** |
| `RECON-FI-PRODUCT-GRAIN` | No deal carries the same product definition twice | `warehouse.fact_finance_product_sale` row count | distinct `(sale_key, finance_product_key)` | 0 (exact) | **Implemented** |
| `RECON-FI-STORE-TOTALS` | Store totals agree between the sale fact and the contract fact | `warehouse.fact_vehicle_sale` | `warehouse.fact_finance_product_sale` | 0.01 absolute | **Implemented** |
| `RECON-FI-PERIOD-TOTALS` | Period totals agree between the same two | `warehouse.fact_vehicle_sale` | `warehouse.fact_finance_product_sale` | 0.01 absolute | **Implemented** |
| `RECON-FI-RESERVE-STRUCTURE` | No Cash deal carries finance reserve or a lender | `warehouse.fact_vehicle_sale` (violations) | zero violations required | 0 (exact) | **Implemented** |
| `RECON-FI-ELIGIBILITY` | Every contract's category is eligible under the rule the catalogue stamps | `warehouse.fact_finance_product_sale` | `warehouse.fn_product_category_is_eligible` | 0 (exact) | **Implemented** |
| `RECON-FI-ADJUSTMENT-GRAIN` | Row count equals distinct `adjustment_id` — the grain is the **event** | `warehouse.fact_finance_product_adjustment` row count | distinct `adjustment_id` | 0 (exact) | **Implemented** |
| `RECON-FI-ADJUSTMENT-CAP` | Cumulative net reduction stays inside `[0, original_product_gross]` on every contract | `warehouse.fact_finance_product_adjustment` | `warehouse.fact_finance_product_sale` | 0 (exact) | **Implemented** |
| `RECON-FI-ADJUSTMENT-SEQUENCE` | No event predates its own contract, and no contract carries a reinstatement with nothing to reinstate | `warehouse.fact_finance_product_adjustment` (violations) | zero violations required | 0 (exact) | **Implemented** |
| `RECON-FI-NET-GROSS` | As-of net product gross agrees between an independent warehouse derivation and the reporting view — reconciled on its **own** basis, never against deal-date back gross | `warehouse` net as of the governed date | `reporting.vw_fi_summary.net_product_gross_as_of` | 0.01 absolute | **Implemented** |
| `RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE` | Every `product_sale_id` staging accepted reached the fact | `staging.stg_finance_product_sale` | `warehouse.fact_finance_product_sale` | 0 (exact) | **Implemented** |
| `RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE` | Every `adjustment_id` staging accepted reached the fact | `staging.stg_finance_product_adjustment` | `warehouse.fact_finance_product_adjustment` | 0 (exact) | **Implemented** |
| `RECON-REPORT-FI-DETAIL-ROWS` | `vw_deal_product_detail` preserves the contract fact's grain | `reporting.vw_deal_product_detail` | `warehouse.fact_finance_product_sale` | 0 (exact) | **Implemented** |
| `RECON-REPORT-FI-SUMMARY-ROWS` | `vw_fi_summary` totals equal the warehouse's, unmultiplied | `reporting.vw_fi_summary` | `warehouse` | 0.01 absolute | **Implemented** |
| `RECON-REPORT-FI-PENETRATION-ROWS` | `vw_fi_product_penetration` neither invents nor loses a category row | `reporting.vw_fi_product_penetration` | `warehouse` | 0 (exact) | **Implemented** |
| `RECON-REPORT-FI-ADJUSTMENT-ROWS` | `vw_fi_adjustment_summary` neither invents nor loses a row | `reporting.vw_fi_adjustment_summary` | `warehouse` | 0 (exact) | **Implemented** |
| `RECON-EXCEL-001` | Excel summary totals match approved SQL reporting views | `excel/ARPI_Operating_Report.xlsx` (not yet created) | `reporting.*` views | 0.01 absolute | Planned (post-MVP) |

**Ninety-six reconciliation results are recorded on every `development` database run**: the Python loader
contributes the raw-to-staging chain for every entity plus staging-to-warehouse and generated-row-count for
every dimension, and `audit.vw_recon_all` contributes the rest, which the loader evaluates and persists
through `audit.fn_record_all_reconciliations`. DASH.6 added eighteen `RECON-FI-*` / `RECON-REPORT-FI-*` /
`RECON-FACT-FINANCE-*` rules and the loader-side chain entries for the four new F&I entities. Results land in `audit.reconciliation_result` and are
readable without any privilege on `audit` through `reporting.vw_reconciliation_status`.

> **Only two tolerance values exist anywhere in ARPI.** `0` means exact and covers every count and identity
> comparison. `0.01` is `validation.numeric_absolute_tolerance`, applied where two currency figures are
> compared to the cent or where a rate crosses a documented grain shift. A third value would be an
> unexplained tolerance, which is a hole in the evidence rather than a setting;
> `tests/integration/test_reconciliations.py` asserts no other value appears.

> **Every critical reconciliation has been observed failing.**
> `tests/integration/test_reconciliations.py` gives each one a deliberately corrupted fixture — a deleted
> fact row, a broken gross identity, an orphaned dimension key, a missing snapshot date, a substituted view
> expression — and asserts it reports `failed`. A reconciliation that has never been seen to fail is not
> evidence; it might be comparing a value with itself.

> **Note on `RECON-FUNNEL-CHAIN`, the one informational rule.** The funnel chain multiplies two lead-grain
> rates by two appointment-grain rates, and one lead can produce several appointments, so the product is an
> approximation that cannot be made an identity. It is compared against **modelled-path conversion** —
> leads that were contacted, set an appointment, showed and sold — rather than against total lead-to-sale
> conversion, which isolates the grain shift as the only source of difference; the leads that convert
> without ever showing are measured exactly by `RECON-FUNNEL-SOLD-PATH` instead. A breach means leads are
> converting by a path the funnel does not model, which is a finding to explain rather than a defect.
> `reporting.vw_reconciliation_status.is_critical` marks it, and it is the only rule so marked.

> **Note on `RECON-FI-001`, promoted by DASH.6.** [ARCHITECTURE.md §21.3](ARCHITECTURE.md) lists this as a
> required reconciliation. It was Deferred for as long as its dependency
> `warehouse.fact_finance_product_sale` was, and it is now **Implemented** and evaluated on every database
> run ([DATA_DICTIONARY.md §44.1](DATA_DICTIONARY.md)).
>
> Three things about it are deliberate. **It is exact, not tolerant** — tolerance `0`, per deal, not on a
> group total. A rule that reconciled only the grand total would pass while individual deals were wrong in
> offsetting directions. **It reconciles the deal-date basis only.** A later cancellation is *supposed* to
> make produced and retained gross differ, so blending the as-of side into this rule would turn an ordinary
> chargeback into a permanent failing check; `RECON-FI-NET-GROSS` reconciles the as-of side separately, on
> its own basis. **It proves an explanation, not a definition change** — `back_end_gross` and `KPI-GRS-002`
> mean exactly what they meant before DASH.6, and `other_fi_income` is exactly `0.00` with no balancing
> plug.
>
> **The whole F&I family is exercised by seeded corruptions** in `tests/integration/test_reconciliations.py`
> — including a product-gross reduction that leaves the stored back-end gross untouched, an ineligible
> contract, an over-cap adjustment, a reinstatement with nothing to reinstate, and a substituted view
> expression — so each rule has been observed reporting `failed`.

---

## 37. Change control

### 37.1 Corrections made on 2026-07-29

Two fields in this catalogue described something the rest of the same entry contradicted, and two named
columns that do not exist under those names. They are corrected in place rather than reissued under new
identifiers, because **none of the four changes alters what the KPI means** — each brings a field into line
with the definition, exclusions and reconciliation rule already stated on the same row. Reissuing an
identifier is reserved for a genuine change of meaning.

| KPI | Field | Was | Is | Why it was not a new identifier |
|---|---|---|---|---|
| `KPI-SLS-002` | Formula, numerator, filters | `sale_type = 'New Retail'` | The vehicle's `condition_type = 'New'` | The same entry's definition counts "retail **and lease** deliveries of new vehicles" and its exclusions remove only "leases of **used** units". `sale_type` cannot express that: `Lease` is a retail sale type that is neither `'New Retail'` nor `'Used Retail'`, so every lease fell outside both halves of `RECON-UNITS-001` and the identity could not hold. The corrected field is what the entry always meant. |
| `KPI-SLS-003` | Formula, numerator, filters | `sale_type IN ('Used Retail', 'Certified Retail')` | The vehicle's `condition_type IN ('Used', 'Certified')` | As above, for the other half of the identity. |
| `KPI-FUN-004` | Denominator, filters, reconciliation | `is_canceled_before_scheduled` | `is_cancelled_in_advance` | The column has never existed under the first spelling. `warehouse.fact_appointment` declares `is_cancelled_in_advance`, with identical semantics. |
| `KPI-FUN-005`, `KPI-FUN-006` | Numerator, reconciliation | `vehicle_sale_key` | `sale_key` | Same: `warehouse.fact_lead` and `warehouse.fact_appointment` both declare `sale_key`. |

The first two changed a **computed result** — 202 new and 356 used units on the `development` profile,
against 153 and 351 under the old field — so they are recorded here rather than made silently.
`RECON-UNITS-001` now holds on every store-day row, which it could not have done before.

### 37.2 Standing rules


- Adding a KPI requires a new permanent ID and every field in the template above.
- Changing a KPI's **numerator, denominator, exclusions, or date basis** materially changes what the number
  means; issue a **new ID** rather than editing in place, so historical findings remain traceable.
- Retiring a KPI: set status to `Out of scope`, keep the entry, never reuse the ID.
- Every KPI must trace to at least one approved stakeholder question in
  [`docs/requirements/STAKEHOLDER_QUESTIONS.md`](docs/requirements/STAKEHOLDER_QUESTIONS.md), which is the
  governed form of the primary questions in `docs/research.md` §4. A KPI with no business question behind it
  fails Gate 4 ([ARCHITECTURE.md §28](ARCHITECTURE.md)), and
  `tests/integration/test_stakeholder_question_traceability.py` is what makes that checkable rather than
  asserted.
- **No benchmark, target, or "good" value may be added to this catalogue** unless ARPI acquires a
  documented, licensed, citable source for it — and then it must be cited inline.

---

## 38. Inventory Listings domain — sanitized public reference lane

This domain is governed by [ADR-0011](docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md) and is **separate from the 29 MVP KPIs above**. Everything here is computed over `warehouse.fact_vehicle_listing_snapshot`, whose source is a de-identified public inventory listing snapshot rather than ARPI's synthetic generators.

### 38.1 What this domain is, and what it is not

> **The source is a public LISTING snapshot, not a DMS.** A row proves that a vehicle listing was visible at a moment in time. It does not prove the vehicle was physically present, that the dealership owned it, what it cost, or what it sold for.

Six statements bind every KPI below, and each is enforced rather than merely written down:

1. Advertised price is **not** transaction price.
2. Advertised price is **not** acquisition cost or inventory investment.
3. A listing that disappears was **removed from listing**, which is not *sold*.
4. Days observed online is **not** days in stock.
5. A listing does **not** prove physical presence or ownership.
6. A public reference snapshot does **not** establish current business performance.

### 38.2 What this domain deliberately does not define

There is **no** sold-units KPI, no inventory turn, no days in stock, no front, back or total gross, no inventory investment, no acquisition or reconditioning cost, no carrying cost, no return on investment and no marketing attribution. Each needs data a public listing snapshot does not carry. `arpi.constants.PROHIBITED_LISTING_MEASURES` records the list and `tests/unit/test_inventory_kpis.py` fails the build if one appears in this section.

### 38.3 Shared fields

| Field | Value for every KPI in this domain |
|---|---|
| **Status** | Implemented — computable from the `reporting` schema once a workbook is imported. |
| **Owner** | Michael Palmer (dealer principal and general manager personas). |
| **Source lane** | Sanitized public reference data (ADR-0011). Not synthetic, not confidential DMS data. |
| **Underlying fact** | `warehouse.fact_vehicle_listing_snapshot`, grain: one observed vehicle listing per dealership per `captured_at`. |
| **Future DAX ownership** | **None yet, deliberately.** The current Power BI semantic model is awaiting real-engine validation; adding measures before that validation would change what is being validated. Recorded as a backlog item in `docs/requirements/PHASE_2_BACKLOG.md`. |
| **Reconciliation** | `RECON-LISTING-*` in `audit.vw_recon_inventory_listing`, evaluated and recorded at import time. |

### 38.4.1 `KPI-LST-001` — Observed listing units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-001` |
| **Display name** | Observed listing units |
| **Business question** | How many vehicles were advertised at this store on this capture date? |
| **Grain** | Store x capture date |
| **Formula** | `SUM(inventory_unit_count)` |
| **Date basis** | Capture date (captured_at). The date the listing was SEEN. |
| **Null behaviour** | No rows for a store and date means no capture, not zero inventory. Returns NULL, never 0. |
| **Filter behaviour** | Filters on store, capture date, condition, make, model and trim. A filter across several capture dates does not aggregate: pick one. |
| **Additivity** | SEMI-ADDITIVE. Additive across vehicle, store, make and model; NEVER across capture dates. |
| **Interpretation caution** | Not units in stock and not units owned. A listing does not prove the vehicle was on the ground. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.2 `KPI-LST-002` — New listing units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-002` |
| **Display name** | New listing units |
| **Business question** | How much of the advertised inventory is new? |
| **Grain** | Store x capture date |
| **Formula** | `SUM(inventory_unit_count) WHERE condition_type = 'New'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists; 0 is a real answer when a capture found no new units. |
| **Filter behaviour** | As KPI-LST-001. Condition comes from the listing, not from a title record. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | Condition is as ADVERTISED. A unit advertised New that is in fact a demo or a loaner is counted as the listing described it. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.3 `KPI-LST-003` — Used listing units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-003` |
| **Display name** | Used listing units |
| **Business question** | How much of the advertised inventory is used? |
| **Grain** | Store x capture date |
| **Formula** | `SUM(inventory_unit_count) WHERE condition_type = 'Used'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists; 0 is a real answer. |
| **Filter behaviour** | As KPI-LST-002. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | Certified pre-owned is not separated: the source carries a two-value condition and inventing a third would be fabrication. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.4 `KPI-LST-004` — Vehicles with listed price

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-004` |
| **Display name** | Vehicles with listed price |
| **Business question** | How many advertised vehicles showed a price? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE pricing_status = 'Listed'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists. |
| **Filter behaviour** | As KPI-LST-001. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | Numerator of KPI-LST-006. A vehicle showing a price is not thereby correctly priced. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.5 `KPI-LST-005` — Call-for-price units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-005` |
| **Display name** | Call-for-price units |
| **Business question** | How many advertised vehicles showed no price? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE pricing_status = 'Call for price'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists. |
| **Filter behaviour** | As KPI-LST-001. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | Call-for-price is a legitimate merchandising choice for pre-order, fleet, chassis-cab and in-transit units. A count is a prompt to look, not a defect. **This is not every unpriced listing** — see `KPI-LST-023` and `KPI-LST-024`. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.6 `KPI-LST-006` — Pricing completeness percentage

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-006` |
| **Display name** | Pricing completeness percentage |
| **Business question** | What share of advertised vehicles shows a price? |
| **Grain** | Store x capture date; also published at store x capture x condition x make x model |
| **Formula** | `listed_price_units / observed_listing_units` |
| **Date basis** | Capture date. Both sides from the same capture. |
| **Null behaviour** | Zero denominator returns NULL, never 0 and never infinity. |
| **Filter behaviour** | Both sides published as columns, so the ratio is recomputed from sums at any grain rather than averaged. |
| **Additivity** | NON-ADDITIVE ratio. Never average it across groups of different sizes. |
| **Interpretation caution** | A low percentage means the PUBLIC LISTING showed no price. It does not mean the store has no price, that the vehicle is unpriced in the DMS, or that anything is wrong. |
| **Source view** | `reporting.vw_vehicle_listing_price_completeness` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.7 `KPI-LST-007` — Total advertised listing value

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-007` |
| **Display name** | Total advertised listing value |
| **Business question** | What is the sum of the prices advertised at this store on this capture date? |
| **Grain** | Store x capture date |
| **Formula** | `SUM(advertised_price)` |
| **Date basis** | Capture date. |
| **Null behaviour** | Call-for-price units contribute nothing. KPI-LST-005 sits beside this figure so the exclusion is visible. |
| **Filter behaviour** | As KPI-LST-001. |
| **Additivity** | SEMI-ADDITIVE. Summing across capture dates reports the same money once per capture. |
| **Interpretation caution** | NOT inventory investment, NOT acquisition cost, NOT asset value, NOT floor-plan exposure, NOT gross, and NOT money the store has. It is the sum of advertised numbers at one moment. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.8 `KPI-LST-008` — Average advertised price

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-008` |
| **Display name** | Average advertised price |
| **Business question** | What is the typical advertised price at this store on this capture date? |
| **Grain** | Store x capture date |
| **Formula** | `total_advertised_value / listed_price_units` |
| **Date basis** | Capture date. |
| **Null behaviour** | Zero denominator returns NULL. Call-for-price units are excluded from BOTH sides. |
| **Filter behaviour** | Dividing by observed_listing_units instead would treat a call-for-price vehicle as costing zero. |
| **Additivity** | NON-ADDITIVE ratio. |
| **Interpretation caution** | A mean over a right-skewed mix of compacts and heavy-duty trucks says little on its own; read it with KPI-LST-010 and KPI-LST-011. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.9 `KPI-LST-009` — Average advertised price by model

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-009` |
| **Display name** | Average advertised price by model |
| **Business question** | What is the typical advertised price for this model? |
| **Grain** | Store x capture date x condition x make x model x trim |
| **Formula** | `AVG(advertised_price) over priced listings in the group` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when every listing in the group was call-for-price. |
| **Filter behaviour** | Excludes call-for-price units from numerator and denominator alike. |
| **Additivity** | NON-ADDITIVE ratio. |
| **Interpretation caution** | A group of one vehicle produces an average equal to that vehicle. Read it with observed_listing_units. |
| **Source view** | `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.10 `KPI-LST-010` — Minimum advertised price

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-010` |
| **Display name** | Minimum advertised price |
| **Business question** | What is the lowest price advertised in this group? |
| **Grain** | Store x capture date x condition x make x model x trim |
| **Formula** | `MIN(advertised_price)` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when every listing in the group was call-for-price. |
| **Filter behaviour** | Priced listings only. |
| **Additivity** | NON-ADDITIVE order statistic. Cannot be recomputed from an aggregate at another grain. |
| **Interpretation caution** | An advertised floor, not a transaction floor and not a cost floor. |
| **Source view** | `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.11 `KPI-LST-011` — Maximum advertised price

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-011` |
| **Display name** | Maximum advertised price |
| **Business question** | What is the highest price advertised in this group? |
| **Grain** | Store x capture date x condition x make x model x trim |
| **Formula** | `MAX(advertised_price)` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when every listing in the group was call-for-price. |
| **Filter behaviour** | Priced listings only. |
| **Additivity** | NON-ADDITIVE order statistic. |
| **Interpretation caution** | An advertised ceiling, not a transaction ceiling. |
| **Source view** | `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.12 `KPI-LST-012` — Model mix percentage

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-012` |
| **Display name** | Model mix percentage |
| **Business question** | What share of the advertised inventory is this model? |
| **Grain** | Store x capture date x condition x make x model |
| **Formula** | `observed_listing_units / snapshot_listing_units` |
| **Date basis** | Capture date. Both sides from the same capture. |
| **Null behaviour** | Zero denominator returns NULL. |
| **Filter behaviour** | The denominator is every listing the store showed on that capture date, published as a column so it cannot be guessed at. |
| **Additivity** | NON-ADDITIVE ratio. |
| **Interpretation caution** | Mix is what was ADVERTISED, which is not necessarily what was stocked, ordered or sold. |
| **Source view** | `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.13 `KPI-LST-013` — Trim mix percentage

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-013` |
| **Display name** | Trim mix percentage |
| **Business question** | Within this model, what share is this trim? |
| **Grain** | Store x capture date x condition x make x model x trim |
| **Formula** | `observed_listing_units / model_listing_units` |
| **Date basis** | Capture date. |
| **Null behaviour** | Zero denominator returns NULL. Listings carrying no trim group under a NULL trim rather than being dropped. |
| **Filter behaviour** | The denominator is every listing of the same condition, make and model across all trims, published as a column. |
| **Additivity** | NON-ADDITIVE ratio. |
| **Interpretation caution** | Trim is free text as advertised and is not normalised against a manufacturer catalogue. |
| **Source view** | `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.14 `KPI-LST-014` — New listings since prior snapshot

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-014` |
| **Display name** | New listings since prior snapshot |
| **Business question** | What appeared since the last capture? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE change_type = 'New Listing'` |
| **Date basis** | Capture date, compared against the store's immediately preceding capture. |
| **Null behaviour** | On a store's FIRST capture every vehicle is labelled New Listing and has_prior_snapshot is false. Read that flag first. |
| **Filter behaviour** | Requires two captures to mean anything. |
| **Additivity** | SEMI-ADDITIVE across the compared pair only. |
| **Interpretation caution** | NEWLY OBSERVED, not newly acquired and not a new vehicle. A unit appearing for the first time may have been on the lot for months before observation began. |
| **Source view** | `reporting.vw_vehicle_listing_change` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.15 `KPI-LST-015` — Removed listings since prior snapshot

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-015` |
| **Display name** | Removed listings since prior snapshot |
| **Business question** | What disappeared since the last capture? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE change_type = 'Removed From Listing'` |
| **Date basis** | Capture date, compared against the immediately preceding capture. |
| **Null behaviour** | Zero on a store's first capture, where there is nothing to have disappeared from. |
| **Filter behaviour** | Requires two captures. |
| **Additivity** | SEMI-ADDITIVE across the compared pair only. |
| **Interpretation caution** | REMOVED FROM LISTING IS NOT SOLD. A listing can disappear because the vehicle sold, was traded, was wholesaled, was suppressed by the feed, or because of an error, and this data cannot tell them apart. There is no sold label anywhere in this lane and there must never be one. |
| **Source view** | `reporting.vw_vehicle_listing_change` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.16 `KPI-LST-016` — Price reductions since prior snapshot

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-016` |
| **Display name** | Price reductions since prior snapshot |
| **Business question** | How many advertised prices came down? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE change_type = 'Price Reduction'` |
| **Date basis** | Capture date, compared against the immediately preceding capture. |
| **Null behaviour** | A vehicle moving to or from call-for-price produces no price change rather than a change of the full price. |
| **Filter behaviour** | Requires two captures. Read with days_between_snapshots: eleven reductions means something different over one day than over one quarter. |
| **Additivity** | SEMI-ADDITIVE across the compared pair only. |
| **Interpretation caution** | A reduction is a merchandising action, not a margin outcome. This lane holds no cost, so it cannot say what a reduction did to gross. |
| **Source view** | `reporting.vw_vehicle_listing_change` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.17 `KPI-LST-017` — Price increases since prior snapshot

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-017` |
| **Display name** | Price increases since prior snapshot |
| **Business question** | How many advertised prices went up? |
| **Grain** | Store x capture date |
| **Formula** | `COUNT(*) WHERE change_type = 'Price Increase'` |
| **Date basis** | Capture date, compared against the immediately preceding capture. |
| **Null behaviour** | As KPI-LST-016. |
| **Filter behaviour** | Requires two captures. |
| **Additivity** | SEMI-ADDITIVE across the compared pair only. |
| **Interpretation caution** | An increase can be a correction of an earlier error, an added accessory package, or a genuine reprice. The source cannot distinguish them. |
| **Source view** | `reporting.vw_vehicle_listing_change` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.18 `KPI-LST-018` — Average price change

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-018` |
| **Display name** | Average price change |
| **Business question** | When advertised prices moved, by how much did they move? |
| **Grain** | Store x capture date |
| **Formula** | `AVG(price_change) over vehicles present in both captures with a price in both` |
| **Date basis** | Capture date, compared against the immediately preceding capture. |
| **Null behaviour** | NULL when no vehicle had a price on both sides. Negative means a reduction. |
| **Filter behaviour** | Excludes new and removed listings, and excludes any vehicle that was call-for-price on either side. |
| **Additivity** | NON-ADDITIVE. |
| **Interpretation caution** | A mean over few movements is dominated by the largest one. Read it with KPI-LST-016 and KPI-LST-017. |
| **Source view** | `reporting.vw_vehicle_listing_change` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.19 `KPI-LST-019` — First observed date

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-019` |
| **Display name** | First observed date |
| **Business question** | When did we first see this vehicle advertised? |
| **Grain** | Store x observed vehicle |
| **Formula** | `MIN(captured_at)` |
| **Date basis** | Capture date. |
| **Null behaviour** | Never NULL for a vehicle that has any observation. |
| **Filter behaviour** | Bounded below by when observation began. |
| **Additivity** | NON-ADDITIVE. |
| **Interpretation caution** | NOT an acquisition date and NOT the date the vehicle arrived. It is the first time anybody looked and saw it. |
| **Source view** | `reporting.vw_vehicle_listing_observation_span` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.20 `KPI-LST-020` — Last observed date

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-020` |
| **Display name** | Last observed date |
| **Business question** | When did we last see this vehicle advertised? |
| **Grain** | Store x observed vehicle |
| **Formula** | `MAX(captured_at)` |
| **Date basis** | Capture date. |
| **Null behaviour** | Never NULL for a vehicle that has any observation. |
| **Filter behaviour** | Equal to the store's newest capture for a vehicle still listed. |
| **Additivity** | NON-ADDITIVE. |
| **Interpretation caution** | NOT a sale date and NOT a disposition date. |
| **Source view** | `reporting.vw_vehicle_listing_observation_span` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.21 `KPI-LST-021` — Days observed online

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-021` |
| **Display name** | Days observed online |
| **Business question** | How long has this vehicle been visible in the listing? |
| **Grain** | Store x observed vehicle |
| **Formula** | `last_observed_at - first_observed_at, in days` |
| **Date basis** | Capture date. |
| **Null behaviour** | Zero means the vehicle was seen in exactly one capture. That is 'seen once', not 'listed for no time'. |
| **Filter behaviour** | Must be read with snapshot_count and observation_gap_days: a 30-day span from two captures is not the evidence a 30-day span from thirty captures is. |
| **Additivity** | NON-ADDITIVE. |
| **Interpretation caution** | THIS IS NOT DAYS IN STOCK. Days in stock runs from acquisition, is recorded by the DMS, and lives on warehouse.fact_vehicle_inventory_snapshot. This lane cannot produce it, because it does not know when the store bought the vehicle. The measure is also bounded below by the capture cadence and above by when observation started. |
| **Source view** | `reporting.vw_vehicle_listing_observation_span` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.22 `KPI-LST-022` — Snapshot freshness

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-022` |
| **Display name** | Snapshot freshness |
| **Business question** | How old is the position this report describes? |
| **Grain** | Store x capture date |
| **Formula** | `store's newest captured_at - this row's captured_at, in days` |
| **Date basis** | Capture date. |
| **Null behaviour** | Zero on the store's newest capture. |
| **Filter behaviour** | Published on every summary row so a stale capture cannot be read as a current one. |
| **Additivity** | NON-ADDITIVE. |
| **Interpretation caution** | This is snapshot age. It is not days in stock, not days on lot, and not vehicle age. |
| **Source view** | `reporting.vw_vehicle_listing_summary` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.23 `KPI-LST-023` — Price-not-exposed units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-023` |
| **Display name** | Price-not-exposed units |
| **Business question** | How many advertised vehicles came from a source that published no price field at all? |
| **Grain** | Store x capture date; also published at store x capture x condition x make x model |
| **Formula** | `COUNT(*) WHERE pricing_status = 'Price not exposed'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists. |
| **Filter behaviour** | As KPI-LST-001. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | **This is not `KPI-LST-005` and the two must never be added into one bucket without saying so.** Call-for-price means the listing *displayed* a call-for-price treatment: a merchandising choice was made and shown. Price-not-exposed means the listing surface carried no price field, and evidences no choice by anyone. Reporting this as call-for-price would attribute a decision to a dealership on no evidence. It is equally **not** a data-quality defect: the sanitizer received no price because none was published. |
| **Source view** | `reporting.vw_vehicle_listing_summary`, `reporting.vw_vehicle_listing_price_completeness`, `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |

### 38.4.24 `KPI-LST-024` — Unpriced listing units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-LST-024` |
| **Display name** | Unpriced listing units |
| **Business question** | How many advertised vehicles contributed nothing to total advertised value? |
| **Grain** | Store x capture date; also published at store x capture x condition x make x model |
| **Formula** | `COUNT(*) WHERE pricing_status <> 'Listed'` |
| **Date basis** | Capture date. |
| **Null behaviour** | NULL when no capture exists. |
| **Filter behaviour** | As KPI-LST-001. |
| **Additivity** | SEMI-ADDITIVE. |
| **Interpretation caution** | Defined as the **complement of listed**, not as the sum of the named unpriced statuses, so that `KPI-LST-004 + KPI-LST-024 = KPI-LST-001` holds however many pricing statuses exist. A future status cannot silently fall outside every bucket. Use this when the question is "how many vehicles are missing from the price statistics"; use `KPI-LST-005` and `KPI-LST-023` when the question is *why*. |
| **Source view** | `reporting.vw_vehicle_listing_summary`, `reporting.vw_vehicle_listing_price_completeness`, `reporting.vw_vehicle_listing_model_mix` |
| **Status** | Implemented |
| **Owner** | Michael Palmer |


---

## 39. Targets and pace domain — the operating plan

This domain is governed by [ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md),
delivered by increment `DASH.5`, and is **separate from the 29 MVP KPIs above** in exactly the way §38's
listing domain is. Everything here is computed by `reporting.vw_target_attainment` over
`warehouse.fact_sales_target`, `warehouse.fact_vehicle_sale` and `warehouse.dim_date`. The identifiers were
reserved from first mention in
[`docs/dashboard/KPI_EXTENSION_PLAN.md §3`](docs/dashboard/KPI_EXTENSION_PLAN.md) and are permanent.

### 39.1 The standing constraint, before any definition

> **Every target in ARPI is a synthetic internal operating goal for the fictional Granite Auto Group.**
> It is not an industry benchmark, not a manufacturer objective, not a market standard and not any real
> dealership's plan. No surface may describe a target — or an attainment against one — as good, average,
> standard or recommended, and no reader may treat a figure here as evidence about real-world performance.

> **A projected month-end figure is a *selling-day pace projection*.** That exact phrase is used wherever
> one is presented. It is linear arithmetic over the governed selling-day calendar: pace × selling days in
> the month. It is **not** a forecast, a prediction, AI, machine learning, a probability or a benchmark, and
> it deliberately ignores within-month trading shape — the generator weights Saturdays heavily and Sundays
> almost to nothing — so an early-month projection is structurally more volatile than a late-month one.
> Once every selling day of a month has elapsed the projection **equals the final actual**, and the console
> says so rather than presenting a completed month as forward-looking.

### 39.2 Shared fields

| Field | Value for every KPI in this domain |
|---|---|
| **Status** | **Implemented** (`DASH.5`) — computable from the `reporting` schema, and independently re-derived from `warehouse` by `tests/integration/test_kpi_verification.py`. |
| **Business owner persona** | Dealer principal, general manager, general sales manager. |
| **Stakeholder question** | [`SQ-31`](docs/requirements/STAKEHOLDER_QUESTIONS.md) — *Are we hitting our operating targets, by store and by department?* All ten anchor to it. |
| **Source fact** | `warehouse.fact_sales_target` (the plan), `warehouse.fact_vehicle_sale` (the actual), `warehouse.dim_date` (the selling-day calendar). |
| **Reporting-view owner** | `reporting.vw_target_attainment`. |
| **Future Power BI measure owner** | **None yet, deliberately.** The plan names a *Target Measures* group ([`powerbi/model_documentation/03-measure-groups.md`](powerbi/model_documentation/03-measure-groups.md)) as the future owner; that is ownership planning, not implementation. The current semantic model is awaiting real-engine validation, and adding measures before that validation would change what is being validated. **No TMDL was written for this domain, no relationship to `fact_sales_target` exists, and no DAX has ever computed one of these ten.** |
| **Reconciliation** | `RECON-TGT-*` and `RECON-FACT-SALES-TARGET-WAREHOUSE` in `audit.vw_recon_target`, unioned into `audit.vw_recon_all` and recorded on every pipeline run. |
| **Date basis** | Sale date for every actual; target month for every plan; calendar date for the selling-day clock. |
| **As-of rule** | The dataset's own as-of date — the last day any measured thing happened — constrained to the row's month. **No wall-clock read exists anywhere in the chain.** |
| **Project-default thresholds** | None. This domain defines no threshold, no rating, no grade and no favourable direction. |

### 39.3 The scope rule, which every total here depends on

`warehouse.fact_sales_target` carries three scope types. **A store total reads `Store`-scope rows only.**
`Department` rows carry the two components that partition total gross exactly — the Sales department owns
front-end gross (`KPI-GRS-001`) and the Finance department owns back-end gross (`KPI-GRS-002`), because the
sale fact enforces `total_gross = front_end_gross + back_end_gross` — so adding a department row to its
store row counts the same gross twice. `Employee` scope is physically supported and deliberately
unpopulated by `DASH.5`. **Retail units are store-scope only**: a unit is delivered once, and attributing
it to both Sales and Finance would count the same car twice.

**`fact_sales_target.kpi_id` names the metric being TARGETED, never the target KPI.** A plan row for the
month's retail units carries `KPI-SLS-001`; `KPI-TGT-001` is the measure computed *from* such rows.

### 39.4 `KPI-TGT-001` — Retail unit target

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-TGT-001` |
| **Display name** | Retail unit target |
| **Business purpose** | The month's committed retail-unit goal per store: the denominator of attainment and the reference line of pace. |
| **Definition (plain English)** | The number of retail deliveries the store committed to make in the calendar month. |
| **Formula** | `SUM(target_value)` where `target_scope_type = 'Store'` and `kpi_id = 'KPI-SLS-001'` |
| **Numerator (precise)** | n/a — additive measure |
| **Denominator (precise)** | n/a — additive measure |
| **Grain** | Store × calendar month. Additive across stores and months **within** this scope and metric. |
| **Date basis** | Target month. |
| **Filters** | Store-scope rows for the selected stores and months. |
| **Exclusions** | Department- and employee-scope rows, which are refinements rather than addends. |
| **Eligibility rules** | None. |
| **Null / zero-denominator behaviour** | No denominator. **No target row for a store-month → NULL, displayed "No target set", never `0`.** A missing planning record and a goal of zero are different statements and are both representable. |
| **Unit and formatting** | Whole units, carried in `numeric(14,2)` as e.g. `57.00`. Thousands separator, no decimals on display. |
| **SQL ownership** | `reporting.vw_target_attainment.target_value`. |
| **Future DAX ownership** | Target Measures group (planned; no measure exists — see §39.2). |
| **Reconciliation rule** | `RECON-TGT-UNITS` (warehouse against reporting, exact) and the export total `retail_unit_target`, which declares the row subset it covers. |
| **Web presentation** | The target beside the actual on the Executive Overview and Sales & Gross target cards, and the pace bar's denominator. |
| **Interpretation caution** | A fictional operating goal. Attainment against it demonstrates the calculation, not performance. |
| **Implementation status** | **Implemented** (`DASH.5`) |
| **Depends on (entities)** | `warehouse.fact_sales_target`, `warehouse.dim_dealership`, `warehouse.dim_date` |

### 39.5 `KPI-TGT-002` — Retail unit target attainment

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-TGT-002` |
| **Display name** | Retail unit target attainment |
| **Business purpose** | Whether the store is delivering the units it committed to, as a ratio a GM can act on mid-month. |
| **Definition (plain English)** | Retail units delivered month to date, divided by the month's unit target. |
| **Formula** | `KPI-SLS-001 (MTD) / KPI-TGT-001` |
| **Numerator (precise)** | `SUM(reporting.vw_target_attainment.attainment_numerator)` over `target_scope_type = 'Store'` and `target_kpi_id = 'KPI-SLS-001'` — retail units month to date on the sale-date basis, restricted to the rows that carry a usable denominator. |
| **Denominator (precise)** | `SUM(reporting.vw_target_attainment.attainment_denominator)` over the **same rows**. The denominator is `NULL` when the target is absent **or** zero, so a zero-target store cannot contribute a division by zero. |
| **Grain** | Store × month; aggregable to any store set and any set of whole months **by summing both components**. |
| **Date basis** | Sale date for the numerator, target month for the denominator. |
| **Filters** | As `KPI-SLS-001`. |
| **Exclusions** | As `KPI-SLS-001`. **A store with no target contributes to neither side**; its units are still shown in the actual, and the console names the store rather than hiding the exclusion. |
| **Eligibility rules** | None. |
| **Null / zero-denominator behaviour** | **NULL when the target is NULL or zero — never `0`.** A store with no plan has no attainment; it does not have an attainment of nothing. |
| **Unit and formatting** | Percentage, one decimal. |
| **SQL ownership** | `reporting.vw_target_attainment` publishes `attainment_numerator` and `attainment_denominator` as separate additive columns, and `target_attainment_ratio` for a single row. **The export publishes only the two components**, so an average of store percentages cannot be formed from the exported data at all. |
| **Future DAX ownership** | Target Measures group (planned; no measure exists). |
| **Reconciliation rule** | The export total `retail_unit_target_attainment`, published as numerator and denominator with no quotient. |
| **Web presentation** | The percentage beside the pace bar, with both sides visible. |
| **Interpretation caution** | **A group attainment is `SUM(numerator) / SUM(denominator)`, never the average of store attainments** — those are different numbers, and the average is wrong whenever the stores differ in size. `tests/integration/test_kpi_verification.py` and `portfolio/tests/unit/dashboard-targets.test.ts` each plant the average and assert it differs. Attainment against a fictional goal demonstrates the calculation, not performance. |
| **Implementation status** | **Implemented** (`DASH.5`) |
| **Depends on (entities)** | `warehouse.fact_sales_target`, `warehouse.fact_vehicle_sale`, `warehouse.dim_date` |

### 39.6 `KPI-TGT-003` — Total gross target

As `KPI-TGT-001` with `kpi_id = 'KPI-GRS-003'`. **Unit and formatting:** currency, USD, exact `numeric(14,2)`,
no decimals at summary level. **Reconciliation rule:** `RECON-TGT-GROSS` (0.01 currency tolerance) and the
export total `total_gross_target`. Every other field is identical, including the "No target set" null rule.
Status **Implemented** (`DASH.5`).

The two **department** gross plans sum to this figure exactly, per store-month: the Sales department's
front-end target (`KPI-GRS-001` rows) plus the Finance department's back-end target (`KPI-GRS-002` rows).
`DQ-TGT-012` and `RECON-TGT-DEPT-SPLIT` assert the identity to the cent. They are a partition of this
target, **not an addition to it**.

### 39.7 `KPI-TGT-004` — Total gross target attainment

As `KPI-TGT-002` with numerator `KPI-GRS-003` (MTD, sale-date basis) and denominator `KPI-TGT-003`.
**Unit:** percentage, one decimal. **Reconciliation rule:** the export total
`total_gross_target_attainment`, published as numerator and denominator with no quotient. Every other
field is identical, including the group-aggregation rule and the NULL behaviour. Status **Implemented**
(`DASH.5`).

### 39.8 `KPI-TGT-005` — Selling days elapsed

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-TGT-005` |
| **Display name** | Selling days elapsed |
| **Business purpose** | The pace clock's denominator: how much of the month's selling capacity has been used. |
| **Definition (plain English)** | The number of governed selling days in the month up to and including the dataset's as-of date. |
| **Formula** | `COUNT(dim_date rows) WHERE is_selling_day AND full_date <= as-of date AND month = the target month` |
| **Numerator / Denominator** | n/a — additive count |
| **Grain** | Month × as-of date. **Store-invariant**: all three stores share one calendar. |
| **Date basis** | Calendar date. |
| **Filters** | `warehouse.dim_date.is_selling_day`, per the deterministic closure-holiday rule of [ADR-0002](docs/architecture-decisions/ADR-0002-phase-0-technology-baseline.md). **`dim_date` is the only selling-day authority in ARPI**; no consumer re-derives weekends or holidays, and no JavaScript or DAX calendar exists. |
| **Exclusions** | Closure holidays. |
| **Eligibility rules** | None. |
| **Null / zero-denominator behaviour** | **`0` is legitimate and means the month has not started.** It is never converted to NULL, and it is what makes pace and projection NULL rather than a division error. |
| **Unit and formatting** | Whole days. Rendered as "Day 14 of 26 selling days". |
| **SQL ownership** | `reporting.vw_target_attainment.selling_days_elapsed`. |
| **Future DAX ownership** | Target Measures group (planned; no measure exists). |
| **Reconciliation rule** | Verified against an independent `dim_date` count in `tests/integration/test_kpi_verification.py`. |
| **Web presentation** | The selling-day header above the target cards, and the marker on the pace bar's track. |
| **Interpretation caution** | The shared calendar is a documented simplification: real stores keep different hours, and a real group would carry a selling-day calendar per store. On the committed `development` profile the as-of date is the last day of the window, so every month is complete and this figure equals the month's total. |
| **Implementation status** | **Implemented** (`DASH.5`) |
| **Depends on (entities)** | `warehouse.dim_date` |

### 39.9 `KPI-TGT-006` — Selling days remaining

`(selling days in the month) − KPI-TGT-005`. **Never negative**; `0` on a completed month, which is the
honest statement that nothing is left to sell rather than a missing value. All other fields as
`KPI-TGT-005`. Status **Implemented** (`DASH.5`).

### 39.10 `KPI-TGT-007` — Retail unit pace

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-TGT-007` |
| **Display name** | Retail unit pace |
| **Business purpose** | Units per selling day at the current run rate — the number a desk uses daily. |
| **Definition (plain English)** | Retail units delivered month to date, divided by the governed selling days that have elapsed. |
| **Formula** | `KPI-SLS-001 (MTD) / KPI-TGT-005` |
| **Numerator (precise)** | `SUM(reporting.vw_target_attainment.pace_numerator)` — retail units MTD, sale-date basis. Additive across stores. |
| **Denominator (precise)** | `reporting.vw_target_attainment.pace_denominator` — selling days elapsed. **Store-invariant, and therefore NOT summed across stores**: a group pace is total units over the same elapsed days, not over three times as many days. |
| **Grain** | Store × month × as-of date. **NON-ADDITIVE**; recompute from summed components at every level. |
| **Date basis** | Sale date over the calendar clock. |
| **Filters / Exclusions** | As `KPI-SLS-001`. |
| **Eligibility rules** | None. |
| **Null / zero-denominator behaviour** | **NULL when selling days elapsed = 0.** A run rate over zero days is undefined, not zero, and the console renders "Pace not available before the first selling day". |
| **Unit and formatting** | Units per selling day, two decimals. |
| **SQL ownership** | `reporting.vw_target_attainment.pace_per_selling_day`, with its two components published separately. |
| **Future DAX ownership** | Target Measures group (planned; no measure exists). |
| **Reconciliation rule** | Independently re-derived in `tests/integration/test_kpi_verification.py` from the sale fact and `dim_date`. |
| **Web presentation** | "1.33 units per selling day" beside the pace bar. |
| **Interpretation caution** | **A run rate, never a forecast.** Early-month values are volatile by construction, because the generator weights trading heavily towards Saturdays. The average of several days' paces is not this figure, and neither is the average of several stores' paces. |
| **Implementation status** | **Implemented** (`DASH.5`) |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale`, `warehouse.dim_date` |

### 39.11 `KPI-TGT-008` — Total gross pace

As `KPI-TGT-007` with numerator `KPI-GRS-003` (MTD). **Unit:** currency per selling day, USD, two decimals.
Exact `numeric` throughout; no float touches it at any layer. All other fields identical, including the
NULL rule at zero elapsed selling days. Status **Implemented** (`DASH.5`).

### 39.12 `KPI-TGT-009` — Projected month-end retail units

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-TGT-009` |
| **Display name** | Projected month-end retail units |
| **Business purpose** | Where the month lands if the current selling-day rate holds — the honest version of "are we going to make it". |
| **Definition (plain English)** | The current units-per-selling-day rate, multiplied by the month's total selling days. |
| **Formula** | `KPI-TGT-007 × (selling days in the month)`, evaluated as **one division** from published components: `projection_numerator / projection_denominator`, where the numerator is `actual MTD × selling days in month` and the denominator is selling days elapsed. |
| **Numerator (precise)** | `SUM(reporting.vw_target_attainment.projection_numerator)`. Additive across stores within one month. |
| **Denominator (precise)** | `reporting.vw_target_attainment.projection_denominator` — selling days elapsed, store-invariant. |
| **Grain** | Store × month × as-of date. **NON-ADDITIVE.** |
| **Date basis** | Sale date over the calendar clock. |
| **Filters / Exclusions** | As `KPI-TGT-007`. |
| **Eligibility rules** | None. |
| **Null / zero-denominator behaviour** | **NULL whenever the pace is NULL**, which is before the first selling day. Never `0`, never `Infinity`, never `NaN`. |
| **Unit and formatting** | Whole units on display; **the exact ratio is retained internally** and only the final rendered figure is rounded, half away from zero. That rounding happens in exactly one place, so no reconciliation is computed from a rounded value. |
| **SQL ownership** | `reporting.vw_target_attainment.projected_month_end_value`, composed from the two published components so the value is not a rounded pace multiplied by a day count. |
| **Future DAX ownership** | Target Measures group (planned; no measure exists). |
| **Reconciliation rule** | Independently re-derived in `tests/integration/test_kpi_verification.py`. |
| **Web presentation** | Labelled **"Selling-day pace projection"**, always beside the actual MTD and the target, never alone. |
| **Interpretation caution** | **Linear extrapolation over the calendar, and nothing more.** It is not a forecast, a prediction, AI, machine learning, a probability or a benchmark, and it must never be captioned as one. It ignores within-month seasonality that the data genuinely contains, so it is structurally less reliable early in a month. **Once every selling day has elapsed it equals the final actual**, and the surface says so rather than presenting a finished month as forward-looking. |
| **Implementation status** | **Implemented** (`DASH.5`) |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale`, `warehouse.dim_date` |

### 39.13 `KPI-TGT-010` — Projected month-end total gross

As `KPI-TGT-009` over `KPI-TGT-008`. **Unit:** currency, USD, exact internally and rendered without decimals
at summary level. Every other field identical, including the mandatory **"Selling-day pace projection"**
label and the prohibition on the words *forecast*, *forecasted gross*, *expected gross*, *predicted gross*
and *AI projection*. Status **Implemented** (`DASH.5`).

### 39.14 What this domain deliberately does not define

There is **no** favourable direction, no ahead/behind score, no performance grade, no A/B/C rating and no
target health score. ARPI has no governed semantic for whether an attainment figure is good, and inventing
one would publish a judgement rather than a figure. The one comparison the console states is arithmetic —
"Selling-day pace projection is 6 units above target" — and never evaluative.

There is also **no target-editing surface**: no edit, save, approve, assign, lock or submit. `DASH.5` is
read-only analytics over governed generated plan data, and the console is not a planning-entry application.

---

## 40. F&I domain — what is beneath back-end gross

This domain is governed by [ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md),
delivered by increment `DASH.6`, and is **separate from the 29 MVP KPIs above** in exactly the way §38's
listing domain and §39's target domain are. Everything here is computed over
`warehouse.fact_finance_product_sale`, `warehouse.fact_finance_product_adjustment` and
`warehouse.fact_vehicle_sale` (extended with `finance_reserve_gross` and `lender_key`). The identifiers
were reserved from first mention in
[`docs/dashboard/KPI_EXTENSION_PLAN.md §4`](docs/dashboard/KPI_EXTENSION_PLAN.md) and are permanent.

**`KPI-GRS-002` (back-end gross) and `KPI-GRS-005` (back gross per retail unit) are NOT reissued here.**
Their definitions are unchanged. What `DASH.6` added is a *reconciliation identity beneath* them, proved
per deal and to the cent by `RECON-FI-001`:

```
back_end_gross = finance_reserve_gross
               + SUM(original_product_gross) on that finalized deal
               + other_fi_income                (exactly 0.00; not a column anywhere)
```

Reissuing an unchanged definition under a new identifier is forbidden by §37.2, and explaining a measure
is not redefining it.

### 40.1 The standing constraints, before any definition

> **Every product, every administrator and every lender in ARPI is invented.** No real F&I product,
> program, administrator, underwriter, vendor, bank, captive finance arm, credit union or finance company
> is named anywhere, and none may be added. Every price, cost, penetration, cancellation and chargeback
> figure is a **configured synthetic distribution**. None is an industry benchmark, a market observation
> or a real dealership's result.

> **There is no "good" penetration rate and no "bad" one.** This domain publishes no favourable direction,
> no benchmark, no grade and no target. It describes synthetic outcomes; it does not recommend what a store
> should sell, what it should charge, how to increase acceptance, which customer should be offered what, or
> what any penetration "should" be.

> **ARPI is not a lending model and this domain does not make it one.** There is no APR, buy rate, sell
> rate, rate spread, money factor, payment, loan term, approval status, decline, stipulation,
> adverse-action reason, credit score, credit file, income or debt-to-income figure — not as a column, not
> as a generation parameter, and not as a derived value. `finance_reserve_gross` is an **amount only** and
> must never be presented as rate guidance. `dim_lender.program_tier` classifies the **fictional lender's
> program** and is never a customer's credit tier: no ARPI entity carries a customer credit attribute, so
> there is nothing for one to be derived from.

> **Eligibility is not sales propensity.** An `ELIG-*` rule answers *could this product have been written
> on this deal?* and never *should this customer buy it?*. Its only inputs are the transaction's derived
> finance structure and the vehicle's condition. **No customer attribute of any kind participates** in
> eligibility, in pricing, in lender assignment, in reserve or in attachment probability — no demographic,
> no protected characteristic, no credit datum, no income, no age and no geography.

> **`contract_term_months` is the term of the PRODUCT CONTRACT.** It is how long the coverage lasts. It is
> not a finance loan term; ARPI models none. The two must never be conflated.

### 40.2 The three date bases, which every KPI here names

| Basis | What it means | Which KPIs |
|---|---|---|
| **Deal date** | What the F&I office **produced**, attributed to the day the deal was struck. Never rewritten by a later event. | `KPI-FNI-001`, `-002`, `-003`, `-005`, `-006`, `-007`…`-011`, `-019`, `-020` |
| **As-of** | What the store **retained** as at a stated as-of date: original gross minus cumulative adjustments with `adjustment_date <= as_of_date`. | `KPI-FNI-004`, `-022` |
| **Adjustment period** | Adjustment events grouped by **their own** business date. An August chargeback on a June contract belongs to August. | `KPI-FNI-012`, `-013`, `-016`, `-017` |
| **Mixed, and disclosed** | An adjustment-period numerator over a sale-date denominator. A **period proxy**, never a cohort loss rate. | `KPI-FNI-014`, `-015`, `-018` |

**The as-of date is the dataset's own** — the last day any measured thing happened, the same definition
`reporting.vw_target_attainment` and the dashboard export manifest carry. **No wall-clock read exists
anywhere in the chain.**

### 40.3 The eligibility rules, and why the denominator is the whole argument

`config/reference/fi_product_eligibility.yaml` is the **single authority**. Python evaluates it through
`arpi.generation.fi_eligibility`, SQL through `warehouse.fn_product_category_is_eligible` (which *reads*
the configuration as stamped onto `warehouse.dim_finance_product` rather than restating it), and
`tests/integration/test_fi_eligibility_parity.py` proves the two agree over the whole input cross product.
**Every one of the ten governed categories resolves to exactly one rule — not zero, and not two.**

| Rule | Categories | Eligible denominator |
|---|---|---|
| `ELIG-VSC` | Vehicle Service Contract | Finalized retail deals, any structure, any vehicle condition |
| `ELIG-GAP` | GAP | **Financed retail deals only.** Cash and Lease excluded |
| `ELIG-TW` | Tire & Wheel | Finalized retail deals, any structure, any condition |
| `ELIG-PPM` | Prepaid Maintenance | **New and Certified only.** Used excluded |
| `ELIG-LWP` | Lease Wear Protection | **Lease transactions only** |
| `ELIG-OTH` | Appearance Protection, Key Replacement, Theft or Security Product, Paintless Dent Protection, Other Aftermarket Product | Finalized retail deals, any structure, any condition |

Wholesale and Dealer Trade are absent from every rule and cannot be added: a disposal has no consumer.

**Two denominator rules are binding and are the reason this section exists.** *(1)* Every penetration KPI
names its `ELIG-*` rule and publishes both sides as counts. GAP penetration over **all** retail deals is a
smaller number than GAP penetration over **financed** retail deals, both look plausible, and only the
second means anything — a cash buyer has no loan for GAP to cover.
`tests/integration/test_kpi_verification.py` computes both and asserts they differ, so the rule is proved
rather than asserted. *(2)* Penetration counts **distinct deals**, never contract rows: one deal may carry
two different products of one category, so a contract-row penetration can exceed 100%.

### 40.4 Shared fields

| Field | Value for every KPI in this domain |
|---|---|
| **Status** | **Implemented** (`DASH.6`) — computable from the `reporting` schema, and independently re-derived from `warehouse` by `tests/integration/test_kpi_verification.py`. |
| **Business owner persona** | Finance director; general sales manager. |
| **Stakeholder question** | [`SQ-21`](docs/requirements/STAKEHOLDER_QUESTIONS.md) — *Which finance products have weak or inconsistent penetration, and what do cancellations cost us?* All twenty-two anchor to it. `SQ-20` is deepened by the same increment and keeps `KPI-GRS-002` and `KPI-GRS-005`. |
| **Source facts** | `warehouse.fact_finance_product_sale`, `warehouse.fact_finance_product_adjustment`, `warehouse.fact_vehicle_sale`, `warehouse.dim_finance_product`, `warehouse.dim_lender`. |
| **Future Power BI measure owner** | **None yet, deliberately.** The plan names an *F&I Measures* group ([`powerbi/model_documentation/03-measure-groups.md`](powerbi/model_documentation/03-measure-groups.md)) as the future owner; that is ownership planning, not implementation. **No TMDL was written for this domain, no relationship to either F&I fact exists, and no DAX has ever computed one of these twenty-two.** |
| **Reconciliation** | `RECON-FI-*` in `audit.vw_recon_fi`, headed by `RECON-FI-001`, unioned into `audit.vw_recon_all` and recorded on every pipeline run. |
| **Web presentation** | **None in `DASH.6`.** No browser dataset is exported and no console route reads these views: `DASH.7` owns the F&I surface and the itemized Deal Jacket. |
| **Project-default thresholds** | Only the shared minimum-sample floor (§40.5). No rating, no grade, no favourable direction. |
| **Null / zero-denominator behaviour** | Every ratio returns **NULL** on an empty denominator — never zero, never infinity, never a division error. |

### 40.5 The minimum-sample rule

An employee- or manager-level **ratio** is published with its components at every denominator and is
**marked** as not meeting the floor below `warehouse.fn_minimum_sample_floor()` — a **project default for a
fictional group**, currently **10 eligible deals**, and never a statistical significance threshold, an
industry convention or a legal standard. `arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS` is the Python side
of the same number and the integration suite asserts the two agree.

**The reporting layer publishes the flag and never blanks the value.** Suppression is a rendering decision,
and a NULL below the floor would be indistinguishable from a manager who genuinely had no eligible deals.
Below the floor a consumer renders an explicit *insufficient sample (n = X)* state, excludes the row from
ranking, and fires no action rule on it.

**No manager is ranked, scored or labelled anywhere in this domain.** Manager differences inherit store
mix, finance-structure mix, product-eligibility mix and assignment mix, and none of these figures is a
measure of an individual's skill. The words *best*, *worst*, *top*, *bottom* and *underperformer* appear
nowhere in the model, and `DASH.7` and `DASH.11` must carry that context onto any surface that shows them.

### 40.6 `KPI-FNI-001` — Finance reserve gross

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-001` |
| **Display name** | Finance reserve gross |
| **Business purpose** | The finance-office income earned on the financing itself, separated from product gross so back-end mix is explainable rather than a single opaque total. |
| **Definition (plain English)** | What the store earned for arranging the financing, across the selected finalized retail deals. |
| **Formula** | `SUM(finance_reserve_gross)` over finalized retail deals |
| **Numerator (precise)** | n/a — additive measure |
| **Denominator (precise)** | n/a — additive measure |
| **Grain** | Deal; aggregable to store × sale date × finance manager. |
| **Date basis** | Sale date. |
| **Filters** | `is_retail = true`. |
| **Exclusions** | Wholesale and Dealer Trade produce no F&I income at all. |
| **Eligibility rules** | None — additive measure. |
| **Null / zero-denominator behaviour** | No denominator. **`0.00` is a modelled outcome, never a missing value**: a Cash deal and a Lease carry `0.00` by rule, and a Retail Finance deal that earned none also carries `0.00`. The column is `NOT NULL` precisely so those cannot be confused with "not modelled". |
| **Unit and formatting** | Currency, USD, exact `numeric(12,2)`. |
| **SQL ownership** | `reporting.vw_fi_summary.finance_reserve_gross`. |
| **Future DAX ownership** | F&I Measures group (planned; no measure exists — see §40.4). |
| **Reconciliation rule** | `RECON-FI-001`, `RECON-FI-DEAL-LEVEL` and `RECON-FI-RESERVE-STRUCTURE`. |
| **Web presentation** | None in `DASH.6`. |
| **Interpretation caution** | **An amount only.** No APR, buy rate, sell rate, rate spread or money factor is modelled anywhere in ARPI, and this figure must never be presented as rate guidance or as evidence about how a rate was set. |
| **Implementation status** | **Implemented** (`DASH.6`) |
| **Depends on (entities)** | `warehouse.fact_vehicle_sale`, `warehouse.dim_dealership`, `warehouse.dim_employee`, `warehouse.dim_date` |

### 40.7 `KPI-FNI-002` — Finance reserve PVR

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-002` |
| **Display name** | Finance reserve per retail unit |
| **Business purpose** | Reserve normalised by delivery volume, so two stores of different size are comparable on the same basis. |
| **Formula** | `KPI-FNI-001 / KPI-SLS-001` |
| **Numerator (precise)** | `SUM(finance_reserve_gross)` over finalized retail deals |
| **Denominator (precise)** | `SUM(unit_count)` over finalized retail deals — **exactly `KPI-SLS-001`**, shared rather than recomputed |
| **Grain** | Store × period; manager × period subject to §40.5. |
| **Date basis** | Sale date. |
| **Filters / Exclusions** | As `KPI-FNI-001`. |
| **Null / zero-denominator behaviour** | **NULL on zero retail units**, never `$0`. A store with no deliveries did not earn zero reserve per unit; the figure is undefined. |
| **Unit and formatting** | Currency per unit, USD. |
| **SQL ownership** | `reporting.vw_fi_summary` — the components `finance_reserve_gross` and `retail_units`, published separately so a group figure is `SUM(numerator) / SUM(denominator)` and never the average of store figures. |
| **Reconciliation rule** | `RECON-FI-001`; the denominator is reconciled by `RECON-UNITS-001`. |
| **Interpretation caution** | **The denominator includes cash deals, which cannot generate reserve by rule.** A store with an unusual cash mix shows a lower figure for reasons unrelated to finance-office skill — the `SQ-20` caution, now checkable rather than merely stated: `reporting.vw_fi_summary` publishes `cash_deal_count` beside `retail_units`. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.8 `KPI-FNI-003` — Original product gross

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-003` |
| **Display name** | Original product gross |
| **Business purpose** | Product gross **as written at the deal**, before any later cancellation or chargeback — the F&I office's production number. |
| **Formula** | `SUM(original_product_gross)` = `SUM(product_retail_price − product_dealer_cost)` |
| **Numerator / Denominator** | n/a — additive measure |
| **Grain** | Product contract; aggregable to deal, store, sale date, manager, category and provider. |
| **Date basis** | **Sale date of the parent deal.** |
| **Filters** | All contracts on finalized deals. |
| **Exclusions** | None. An ineligible contract is a **critical data-quality failure**, never a silent exclusion. |
| **Eligibility rules** | Every row satisfied its category's `ELIG-*` rule in order to exist. |
| **Null / zero-denominator behaviour** | No denominator; `0.00` over an empty set in a display context, NULL in a ratio context. |
| **Unit and formatting** | Currency, USD, exact `numeric(12,2)`. |
| **SQL ownership** | `reporting.vw_fi_summary.original_product_gross`, itemised by `reporting.vw_deal_product_detail`. |
| **Reconciliation rule** | `RECON-FI-PRODUCT-IDENTITY`, `RECON-FI-001`, `RECON-FI-STORE-TOTALS`, `RECON-FI-PERIOD-TOTALS`. |
| **Interpretation caution** | **Deal-date basis only. It overstates RETAINED gross wherever adjustments followed** — that is what `KPI-FNI-004` is for, and the two are not comparable unless both bases are stated. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.9 `KPI-FNI-004` — Net product gross (as-of)

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-004` |
| **Display name** | Net product gross |
| **Business purpose** | What the store **retained** from product sales as at a stated date, against what it produced. |
| **Formula** | `KPI-FNI-003 − SUM(adjustment_amount WHERE adjustment_date <= as_of_date)` |
| **Numerator / Denominator** | n/a — additive within the as-of basis |
| **Grain** | Product contract; aggregable as `KPI-FNI-003`. |
| **Date basis** | **As-of.** Adjustments after `as_of_date` are excluded by design. |
| **Sign convention** | A **positive** `adjustment_amount` reduces retained gross; a **negative** one restores it. Cancellation and Chargeback are constrained positive, Reinstatement negative, Approved Adjustment signed. |
| **Null / zero behaviour** | `0.00` cumulative adjustment rather than NULL when nothing was taken back: "nothing was taken back" is a statement. |
| **SQL ownership** | `reporting.vw_fi_summary.net_product_gross_as_of`; per contract in `reporting.vw_deal_product_detail`. |
| **Reconciliation rule** | `RECON-FI-NET-GROSS`, `RECON-FI-ADJUSTMENT-CAP`. |
| **Interpretation caution** | **Always displayed with its as-of date, and never compared to `KPI-FNI-003` without stating both bases.** Cumulative net reductions are capped at the original gross, so this figure never goes negative and never exceeds the original. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.10 `KPI-FNI-005` — Product gross PVR

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-005` |
| **Display name** | Product gross per retail unit |
| **Formula** | `KPI-FNI-003 / KPI-SLS-001` on the deal-date basis, **or** `KPI-FNI-004 / KPI-SLS-001` on the as-of basis |
| **Numerator (precise)** | `original_product_gross` **or** `net_product_gross_as_of` — **the basis is part of the measure and must be labelled** |
| **Denominator (precise)** | `SUM(unit_count)` over finalized retail deals — exactly `KPI-SLS-001` |
| **Null behaviour** | **NULL on zero retail units.** |
| **SQL ownership** | `reporting.vw_fi_summary` — components only. |
| **Interpretation caution** | **An unlabelled "Product PVR" is prohibited.** The two numerators differ by every adjustment posted, and a reader cannot tell which was used. Same denominator discipline as `KPI-GRS-005`, including the cash-mix caveat. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.11 `KPI-FNI-006` — Products per retail unit

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-006` |
| **Display name** | Products per retail unit |
| **Business purpose** | Product-attachment depth per delivery. The Deferred candidate in §35, now holding its permanent identifier. |
| **Formula** | `SUM(product_sale_count) / SUM(unit_count)` over finalized retail deals |
| **Numerator (precise)** | `product_sale_count`, which is `1` on every contract row — a **column**, not a `count(*)`, so a join fan-out cannot inflate it |
| **Denominator (precise)** | **All retail units in scope — not only the deals that carried a product.** |
| **Grain** | Store × period; manager × period subject to §40.5. |
| **Date basis** | Sale date. |
| **Null behaviour** | **NULL on zero retail units.** |
| **SQL ownership** | `reporting.vw_fi_summary` — `contract_count` over `retail_units`. `deals_with_a_product` is published beside them **so a reader can see how many deliveries carried nothing, and so that nobody divides by it**. |
| **Reconciliation rule** | `RECON-FI-STORE-TOTALS`; the denominator by `RECON-UNITS-001`. |
| **Interpretation caution** | **Counts contracts, not gross.** A high count of thin products can mask weak economics; read beside `KPI-FNI-011`. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.12 `KPI-FNI-007` — Vehicle Service Contract penetration

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-007` |
| **Display name** | Vehicle Service Contract penetration |
| **Business purpose** | The share of eligible deals that carried a VSC — the flagship attachment measure. |
| **Formula** | `distinct eligible deals containing >= 1 VSC contract / eligible deals (ELIG-VSC)` |
| **Numerator (precise)** | `count(DISTINCT sale_key)` over contracts whose product category is Vehicle Service Contract. **A deal with two VSC contracts counts once.** |
| **Denominator (precise)** | `count(DISTINCT sale_key)` over finalized retail deals satisfying `ELIG-VSC` |
| **Grain** | Store × sale date × manager × category; aggregable by summing both components. |
| **Date basis** | Sale date. |
| **Eligibility rules** | `ELIG-VSC`, **named in every rendering, with both sides shown as counts.** |
| **Null behaviour** | **NULL when the eligible denominator is empty.** |
| **Unit and formatting** | Percentage, one decimal. **The exact components are retained; only the rendered figure is rounded.** |
| **SQL ownership** | `reporting.vw_fi_product_penetration` — `penetration_numerator` and `penetration_denominator`. |
| **Reconciliation rule** | `RECON-FI-ELIGIBILITY`, `RECON-REPORT-FI-PENETRATION-ROWS`. |
| **Interpretation caution** | **Penetration says nothing about product economics or customer value.** Synthetic penetrations are configured distributions and there is no benchmark to compare them to. A group figure is `SUM(numerator) / SUM(denominator)` and **never** the average of store or manager percentages. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.13 `KPI-FNI-008` — GAP penetration

As `KPI-FNI-007` with category **GAP** and denominator **`ELIG-GAP`: financed retail deals only.** Cash is
excluded because a cash buyer owes nothing for GAP to cover, and Lease is excluded by configuration.
**A GAP penetration computed over all retail deals is the misleading number this rule exists to prevent**,
and `tests/integration/test_kpi_verification.py` computes both and asserts they differ. Status
**Implemented** (`DASH.6`).

### 40.14 `KPI-FNI-009` — Tire & Wheel penetration

As `KPI-FNI-007` with category **Tire & Wheel** and denominator `ELIG-TW`. Status **Implemented** (`DASH.6`).

### 40.15 `KPI-FNI-010` — Prepaid Maintenance penetration

As `KPI-FNI-007` with category **Prepaid Maintenance** and denominator **`ELIG-PPM`: New and Certified
deals only.** A store with a heavier used mix has a structurally smaller denominator, which the published
`eligible_deal_count` makes visible rather than leaving to be inferred. Status **Implemented** (`DASH.6`).

### 40.16 `KPI-FNI-011` — Product gross per contract

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-011` |
| **Display name** | Product gross per contract |
| **Formula** | `KPI-FNI-003 / SUM(product_sale_count)` |
| **Numerator (precise)** | `original_product_gross` (deal-date basis) |
| **Denominator (precise)** | `contract_count` — **contracts, not deals.** |
| **Null behaviour** | **NULL on zero contracts.** |
| **SQL ownership** | `reporting.vw_fi_summary` overall; `reporting.vw_fi_product_penetration` for the category slice. Both carry the same definition. |
| **Interpretation caution** | Read beside `KPI-FNI-006`: depth and value move independently, and a store can raise one while lowering the other. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.17 `KPI-FNI-012` — Chargeback amount

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-012` |
| **Display name** | Chargeback amount |
| **Formula** | `SUM(adjustment_amount)` where `adjustment_type = 'Chargeback'` |
| **Grain** | Store × adjustment date × manager × category × type. |
| **Date basis** | **Adjustment date.** A chargeback belongs to the period it posts in and is **never restated into the original sale month**; the contract's own gross is unchanged. |
| **Null behaviour** | No denominator; `0.00` over an empty period. |
| **SQL ownership** | `reporting.vw_fi_adjustment_summary.adjustment_amount`, filtered on the type. |
| **Reconciliation rule** | `RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE`, `RECON-REPORT-FI-ADJUSTMENT-ROWS`. |
| **Interpretation caution** | **Timing and volume are a configured synthetic distribution, never an observed loss rate.** The reporting window truncates the lag distribution, so the most recent months carry structurally fewer chargebacks — comparing an early month to a late one reads that truncation, not the business. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.18 `KPI-FNI-013` — Chargeback count

`COUNT(*)` of chargeback adjustment rows on the **adjustment-date** basis. Every other field as
`KPI-FNI-012`. Status **Implemented** (`DASH.6`).

### 40.19 `KPI-FNI-014` — Chargeback rate by amount

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-014` |
| **Display name** | Chargeback rate by amount |
| **Formula** | `chargeback amount posted in the period / original product gross of contracts SOLD in the period` |
| **Numerator (precise)** | `KPI-FNI-012` — **adjustment-date basis** |
| **Denominator (precise)** | `KPI-FNI-003` — **sale-date basis** |
| **Date basis** | **MIXED, AND DISCLOSED.** The numerator's period is posting time; the denominator's is selling time. `reporting.vw_fi_adjustment_summary` publishes `numerator_date_basis`, `rate_denominator_date_basis`, `rate_denominator_source` and `rate_basis_disclosure` **as data**, so a consumer renders the disclosure from the row rather than from a sentence somebody remembered to write. |
| **Null behaviour** | **NULL on zero denominator.** |
| **SQL ownership** | Numerator `reporting.vw_fi_adjustment_summary`; denominator `reporting.vw_fi_summary`. The denominator is deliberately **not** copied onto the adjustment view: a sale-date figure on an adjustment-date row is exactly the silent blend this design avoids. Both views share a compatible store/date/manager/category shape, so a consumer aligns them by key. |
| **Interpretation caution** | **A PERIOD PROXY, NOT A CONTRACT-COHORT LOSS RATE.** The contracts charged back in a month are mostly not the contracts written in it. A cohort loss rate is a different measure and ARPI does not compute one. Any surface showing this figure must state the mixed basis. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.20 `KPI-FNI-015` — Chargeback rate by contract count

`chargeback count / contracts sold in the period`. **The same mixed-basis disclosure discipline as
`KPI-FNI-014` applies in full**, including the prohibition on presenting it as a cohort loss rate. NULL on
zero denominator. Status **Implemented** (`DASH.6`).

### 40.21 `KPI-FNI-016` — Cancellation amount

As `KPI-FNI-012` with `adjustment_type = 'Cancellation'`. Adjustment-date basis. Status **Implemented**
(`DASH.6`).

### 40.22 `KPI-FNI-017` — Cancellation count

As `KPI-FNI-013` for cancellations. Adjustment-date basis. Status **Implemented** (`DASH.6`).

### 40.23 `KPI-FNI-018` — Cancellation rate

`cancellation count / contracts sold in the period`, with **the same mixed-basis disclosure as
`KPI-FNI-014`**. NULL on zero denominator. Status **Implemented** (`DASH.6`).

### 40.24 `KPI-FNI-019` — Deal structure mix

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-019` |
| **Display name** | Deal structure mix |
| **Business purpose** | The share of finalized retail deals by how they were funded, which is the context every reserve and GAP figure has to be read against. |
| **Formula** | For each structure: `structure deal count / all retail deals in period` |
| **Numerator (precise)** | `cash_deal_count`, `retail_finance_deal_count` or `lease_deal_count` |
| **Denominator (precise)** | `retail_units` |
| **Derivation** | The structure is **derived**, not stored: `warehouse.fn_finance_structure(sale_type, amount_financed)` — Lease when the sale type is; Retail Finance when a retail purchase financed something; Cash otherwise. `sale_type` itself is unchanged and `warehouse.dim_sale_type` remains Deferred. `arpi.generation.fi_eligibility.finance_structure_for` is the Python side, and the two are proved equal over the whole input cross product. |
| **Null behaviour** | **NULL on zero retail units.** |
| **SQL ownership** | `reporting.vw_fi_summary` — the three counts and `retail_units`, as components. |
| **Interpretation caution** | **The three shares sum to 100% of retail deals by construction**, subject only to display rounding: the three counts sum exactly to `retail_units`. **Wholesale and Dealer Trade are not components** — they are not retail. **Never add percentages and never average them**; a group share is `SUM(numerator) / SUM(denominator)`. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.25 `KPI-FNI-020` — Product-category mix

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-020` |
| **Display name** | Product-category mix |
| **Business purpose** | Where product gross actually comes from, by category, with the components a reader needs to see whether a category is thin, expensive or heavily adjusted. |
| **Components (each additive at the view's grain)** | `contract_count`, `product_retail_price`, `product_dealer_cost`, `original_product_gross`, `cumulative_adjustment_amount`, `net_product_gross_as_of`; gross per contract is `original_product_gross / contract_count` |
| **Mix share** | `category value / all-category value` **at the same grain and on the same basis** |
| **Grain** | Store × sale date × manager × **category**. |
| **Date basis** | Sale date, including the adjustment columns, which are attributed to the **contract's** sale date. |
| **Null behaviour** | NULL on a zero all-category denominator; `0` components rather than NULL where a category was eligible and nothing was sold. |
| **SQL ownership** | **`reporting.vw_fi_product_penetration`.** |
| **As-built owner correction** | [`KPI_EXTENSION_PLAN.md §4`](docs/dashboard/KPI_EXTENSION_PLAN.md) assigned this to `reporting.vw_fi_summary` "(category grain)". **That view has no category grain and cannot acquire one**: it carries finance reserve and retail units, both properties of a *deal*, and adding a category would repeat them on every category row and multiply both for anything that summed the result. The category-grain owner as built is therefore `reporting.vw_fi_product_penetration`, which deliberately carries **no** reserve and **no** retail-unit column. Correct governance beats preserving a planning assignment. |
| **Interpretation caution** | **Never add percentages and never average category percentages.** A category with no sales and an eligible population is a row with a zero numerator — a finding, not an absence. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.26 `KPI-FNI-021` — F&I manager penetration

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-021` |
| **Display name** | F&I manager penetration |
| **Formula** | `KPI-FNI-007`-style penetration computed **per finance manager over that manager's own eligible deals**, per category |
| **Numerator (precise)** | That manager's distinct eligible deals carrying at least one contract of the category |
| **Denominator (precise)** | **That manager's eligible deals — never the store's.** Using the store's denominator would divide one person's numerator by everybody's population and make every manager look weak. `tests/integration/test_kpi_verification.py` computes both and asserts they differ. |
| **Attribution** | `fact_finance_product_sale.finance_manager_key`: the manager credited on the **deal**. A deal written with nobody on the F&I desk forms its own group and is never dropped. |
| **Grain** | Store × sale date × manager × category. |
| **Minimum sample** | §40.5 applies. Below the floor the row is marked, never blanked, and is excluded from ranking. |
| **SQL ownership** | `reporting.vw_fi_product_penetration`. |
| **Interpretation caution** | **Manager comparisons inherit store mix, finance-structure mix, product-eligibility mix and assignment mix.** A manager who happens to be scheduled on cash-heavy days has a structurally different GAP denominator. **No manager is ranked or labelled by the model**, and the eligible-deal count must appear beside every figure. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.27 `KPI-FNI-022` — F&I manager back PVR

| Field | Definition |
|---|---|
| **KPI ID** | `KPI-FNI-022` |
| **Display name** | F&I manager back gross per retail unit |
| **Formula** | `(finance_reserve_gross + net_product_gross_as_of) for the manager's deals / that manager's retail units` |
| **Numerator (precise)** | `net_fi_gross_as_of` — **as-of basis**, so it is what the store retained rather than what was produced |
| **Denominator (precise)** | `retail_units` for **that manager's own deals**, not the store's |
| **Grain** | Manager × period, within a store. |
| **Date basis** | Deal date for the denominator and the reserve; as-of for the net product gross. **Both are labelled on the row.** |
| **Null behaviour** | **NULL on zero retail units.** |
| **Minimum sample** | §40.5 applies. |
| **SQL ownership** | `reporting.vw_fi_summary` — components only. |
| **Interpretation caution** | **This is not `KPI-GRS-005`.** Back PVR in §14 is the stored deal-date `back_end_gross` per retail unit; this is the **as-of retained** figure per retail unit, and the two differ by every adjustment posted. Presenting either without its basis is the error. The same mix caveats as `KPI-FNI-021` apply, and eligible-deal context must be shown beside it. |
| **Implementation status** | **Implemented** (`DASH.6`) |

### 40.28 What this domain deliberately does not define

There is **no** favourable direction, no benchmark, no target penetration, no product recommendation, no
customer segmentation, no menu-selling simulation, no lender recommendation, no rate optimisation and no
"good" or "bad" grade of any kind. There is no cohort loss rate — `KPI-FNI-014`, `-015` and `-018` are
period proxies and say so. There is no `other_fi_income` measure, because the value is exactly `0.00` and
is not a column: a zero that is never anything else is where a balancing plug would hide.

There is also **no F&I operating surface** in `DASH.6`. No `/dashboard/fi` route exists, no browser dataset
is exported from any of these views, and the Deal Jacket is not itemized. `DASH.7` owns all of that, and
this increment deliberately stops at the data model so that increment is a presentation problem rather
than a data problem.
