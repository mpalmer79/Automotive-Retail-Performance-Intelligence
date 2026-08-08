# KPI Extension Plan — ARPI Dealer Operations Command Center

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Status of this document:** Planning contract. Every KPI below is **Planned** or **Deferred**, with one
exception: **the ten `KPI-TGT` definitions in §3 are Implemented**, promoted by `DASH.5` into
[`KPI_CATALOG.md` §39](../../KPI_CATALOG.md), which is now their binding definition. §3 is kept as the
**as-built record of what this plan promised against what was built** — see §3.0. Everything else here is
still uncomputable. Promotion into [`KPI_CATALOG.md`](../../KPI_CATALOG.md) happens in the delivery
increment that implements the KPI's source fact, with every catalogue field filled and a stakeholder
question registered. This plan reserves the identifiers so they are permanent from first mention.
**Parent documents:** [KPI_CATALOG.md](../../KPI_CATALOG.md) ·
[DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[DATA_CONTRACT.md](DATA_CONTRACT.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)

---

## 1. Identifier reservations

[KPI_CATALOG.md §3.2](../../KPI_CATALOG.md) has five prefixes in use (`SLS`, `GRS`, `INV`, `FUN`,
`MKT`) plus the listing lane (`LST`). This plan reserves three new families:

| Prefix | Domain | Range reserved here | Source facts |
|---|---|---|---|
| `KPI-TGT-###` | Targets and pace | `KPI-TGT-001` … `KPI-TGT-010` | `warehouse.fact_sales_target`, `warehouse.fact_vehicle_sale`, `warehouse.dim_date` |
| `KPI-FNI-###` | F&I detail | `KPI-FNI-001` … `KPI-FNI-022` | `warehouse.fact_finance_product_sale`, `warehouse.fact_finance_product_adjustment`, `warehouse.fact_vehicle_sale` |
| `KPI-ACC-###` | Accounting integrity | `KPI-ACC-001` … `KPI-ACC-012` | `warehouse.fact_inventory_accounting_snapshot`, `warehouse.fact_gl_control_balance`, plus the deal facts |

Identifiers are permanent on assignment, per KPI_CATALOG.md §3.2: never renumbered, never reused. A
retired entry keeps its ID and is marked `Out of scope`.

Two prompt-level metrics deliberately do **not** get new IDs, because governed IDs already exist and the
catalogue's change-control rule (§37.2) forbids reissuing an unchanged definition:

- **Back-end gross** remains `KPI-GRS-002`. The F&I model adds a *reconciliation identity* beneath it,
  not a new meaning.
- **Back gross per retail unit ("Back PVR")** remains `KPI-GRS-005`.

Deal-quality diagnostics are **not KPIs**. They are registered in §6 with `DIAG-DEAL-###` identifiers,
rendered as diagnostics, and excluded from the KPI catalogue by design.

**No industry benchmark values appear anywhere in this plan.** Every numeric threshold is a
**project default**: a parameter of a calculation for a fictional dealer group, configured centrally and
labeled as such in every surface that uses it.

### 1.1 Stakeholder-question obligation

KPI_CATALOG.md §37.2 requires every KPI to trace to an approved question in
[`STAKEHOLDER_QUESTIONS.md`](../requirements/STAKEHOLDER_QUESTIONS.md) (currently `SQ-01`–`SQ-35`).
Existing anchors: `SQ-20`/`SQ-21` (finance director), `SQ-10`–`SQ-13` (used-car manager), `SQ-01`–`SQ-03`
(dealer principal). The following questions are **proposed** here and must be registered (as `SQ-36`
onward, numbers assigned at registration time) by the increment that promotes the KPIs they anchor:

| Proposed question | Persona | Anchors |
|---|---|---|
| ~~Are we on pace to reach this month's unit and gross targets at the current selling-day rate?~~ **Not registered as a new question.** `DASH.5` anchored the `KPI-TGT` family to the question already on the register: **SQ-31**, *"Are we hitting our operating targets, by store and by department?"*, whose Deferred blocker was this exact fact. Registering a second, narrower question would have left SQ-31 unanswered while the data to answer it existed. | Dealer principal / GM | `KPI-TGT-*` |
| Which F&I products, at what penetration of their eligible deals, are driving back-end gross, and what are cancellations and chargebacks taking back? | F&I director | `KPI-FNI-*` |
| Does the stock-level inventory schedule reconcile to the selected GL control accounts, and which units and deals fail their arithmetic identities? | Controller | `KPI-ACC-*` |
| Which deals show gross, attribution, or timing patterns that warrant review before period close? | GSM / Controller | `DIAG-DEAL-*` |

---

## 2. Shared definitions used below

- **Retail unit** — a `fact_vehicle_sale` row with `is_retail = true`
  (`sale_type IN ('New Retail','Used Retail','Certified Retail','Lease')`), exactly as
  `KPI-SLS-001`.
- **Selling day** — a `warehouse.dim_date` row with `is_selling_day = true`.
- **MTD** — month-to-date through the selected as-of date, on the stated date basis.
- **Eligibility rules `ELIG-*`** — defined once in `config/reference/fi_product_eligibility.yaml`
  (delivered with `DASH.6`), loaded by the generator, enforced by SQL validation, exported for display,
  and mirrored (never reimplemented) by DAX and TypeScript. See §4.1.
- **Date bases** — `sale date` (deal economics), `delivery date`, `adjustment date` (when a
  cancellation/chargeback posts), `snapshot date` (inventory accounting), `balance date` (GL controls).
  The console labels the basis on every KPI; the bridge between deal-date and as-of views is the
  adjustment fact. See [`DATA_CONTRACT.md §6`](DATA_CONTRACT.md).
- **Null behaviour** — every ratio returns NULL on an empty denominator, never zero and never a
  division error, matching the standing rule tested by `tests/integration/test_kpi_verification.py`.

---

## 3. `KPI-TGT` — Targets and pace

**Implemented by `DASH.5`.** The binding definitions are [KPI_CATALOG.md §39](../../KPI_CATALOG.md); the
fact contract is [DATA_DICTIONARY.md §41](../../DATA_DICTIONARY.md) and
[STM-016](../source-to-target/STM-016-fact-sales-target.md). **Where this plan and the catalogue disagree,
the catalogue is correct.** What follows is preserved as the planning record.

Source fact: `warehouse.fact_sales_target`. Grain as built: one row per dealership, target month, targeted
KPI, and target scope (scope type + scope id), carrying `target_value numeric(14,2)` and
`stretch_target_value numeric(14,2)`. Targets are synthetic internal operating goals for a fictional group,
never industry benchmarks ([LIMITATIONS.md](../../LIMITATIONS.md); KPI_CATALOG.md §39 standing
constraints).

Any projected month-end figure is labelled **"Selling-day pace projection"** in every surface. It is
arithmetic over the calendar, not a forecast, and is never described as AI or statistical prediction.

### 3.0 As-built: what changed between this plan and the implementation

A planning document that is quietly edited to match what shipped stops being evidence of anything. These
are the divergences, stated rather than smoothed over.

1. **The grain gained a scope key.** The plan said "dealership × optional employee-or-department scope ×
   KPI ID × calendar month". *Optional* cannot be enforced: PostgreSQL treats NULLs as distinct in a
   `UNIQUE` constraint, so a nullable scope column would have let the same store-month-KPI target be
   inserted without limit. As built, the grain is
   `(dealership_key, target_month_date_key, kpi_id, target_scope_type, target_scope_id)` with
   `target_scope_id` `NOT NULL` on every scope type. See DATA_DICTIONARY.md §41.3.
2. **The reporting view is not at store-month grain.** The plan's field tables describe each measure at
   *store × month*. `reporting.vw_target_attainment` publishes **one row per store, month, scope and
   targeted KPI**, because department attainment is part of SQ-31 and a store-month view could not carry
   it. Every measure in §3 is still computable; it is computed by filtering the scope rather than by
   reading a store-grain row. This is the single largest divergence and it is deliberate.
3. **The view publishes numerator and denominator, not the ratio alone.** `KPI-TGT-002`, `-004`, `-007`
   and `-009` are ratios, and a ratio cannot be re-aggregated. The view exports
   `attainment_numerator` / `attainment_denominator` and `pace_numerator` / `pace_denominator` so a group
   figure is `SUM(numerator) / SUM(denominator)` and never an average of store percentages.
4. **Employee scope is supported and deliberately unpopulated.** The plan reserved the scope; the fact
   enforces it with a `CHECK` and a foreign key; `DASH.5` writes no employee-scope row, because no
   registered stakeholder question requires one and `DASH.11` owns the employee-performance surface.
5. **Department scope is two departments, not all of them.** `Sales` owns front-end gross and `Finance`
   owns back-end gross, because those two partition total gross exactly and `fact_vehicle_sale` enforces
   the identity. BDC, Management and Service have **no numerator in the warehouse**, so a target for them
   would be a denominator with nothing to compare against. Recorded as a limitation on SQ-31 rather than
   hidden by rewording the question.
6. **Retail units are store-scope only.** A unit is delivered once; a Sales-department unit target would
   duplicate the store target and a Finance-department one would count the same car twice.
7. **`stretch_target_value` is generated, governed and not exported.** It exists on the fact, it is
   constrained (`>= target_value`), and no `DASH.5` surface displays it. The plan implied a console
   presence it does not have.
8. **`Future Power BI measure owner` is still future.** No TMDL was modified. The Target Measures group
   remains a documented gap in `powerbi/model_documentation/03-measure-groups.md`, and Gate 2 stays
   **CLOSED**.
9. **"As-of date" is the governed dataset as-of, not the wall clock.** The plan's field tables say
   "as-of date" without defining it. As built, it is the maximum date across the sale, snapshot and lead
   bases, clamped to the month end. `current_date` appears nowhere in the lane.

### `KPI-TGT-001` — Retail unit target

| Field | Value |
|---|---|
| Display name | Retail unit target |
| Business purpose | The month's committed retail-unit goal per store, the denominator of attainment and the reference line of pace. |
| Formula | `SUM(target_value)` where `kpi_id = 'KPI-SLS-001'` |
| Numerator | n/a — additive measure |
| Denominator | n/a — additive measure |
| Grain | Store × calendar month; employee/department scope rows aggregate only within their scope |
| Date basis | Target month |
| Inclusion rules | Store-scope rows for the selected stores and months |
| Exclusion rules | Employee- and department-scope rows are excluded from store totals (they are refinements, not addends) |
| Eligibility rules | None |
| Null behaviour | No target row for a store-month → NULL, displayed "No target set", never 0 |
| Source fact | `warehouse.fact_sales_target` |
| Reporting-view owner | `reporting.vw_target_attainment` (implemented by `DASH.5`; `sql/05_reporting/44_vw_target_attainment.sql`) |
| Future Power BI measure owner | Target Measures group (new measure table; one of the four groups `powerbi/model_documentation/03-measure-groups.md` records as documented gaps) |
| Web presentation | Reference line on unit trend; scoreboard column; pace bar denominator |
| Limitations | Fictional operating goal; no benchmark meaning |
| Project-default thresholds | None |
| Status | **Implemented** (`DASH.5`) |

### `KPI-TGT-002` — Retail unit target attainment

| Field | Value |
|---|---|
| Display name | Retail unit target attainment |
| Business purpose | Whether the store is delivering the units it committed to, as a ratio a GM can act on mid-month. |
| Formula | `KPI-SLS-001 (MTD) / KPI-TGT-001` |
| Numerator | Retail units sold, month-to-date, sale-date basis |
| Denominator | `KPI-TGT-001` for the same store and month |
| Grain | Store × month (aggregable to group with summed numerator and denominator) |
| Date basis | Sale date |
| Inclusion rules | As `KPI-SLS-001` |
| Exclusion rules | As `KPI-SLS-001`; months with no target row excluded from group ratios |
| Eligibility rules | None |
| Null behaviour | NULL when the target is NULL or zero |
| Source fact | `fact_vehicle_sale` + `fact_sales_target` |
| Reporting-view owner | `reporting.vw_target_attainment` |
| Future Power BI measure owner | Target Measures group |
| Web presentation | Pace bar with attained/target text; percentage with both sides visible |
| Limitations | Attainment against a fictional goal demonstrates the calculation, not performance |
| Project-default thresholds | None |
| Status | **Implemented** (`DASH.5`) |

### `KPI-TGT-003` — Total gross target

As `KPI-TGT-001` with `kpi_id = 'KPI-GRS-003'`; currency (USD, `numeric`, exact). All other fields
identical to `KPI-TGT-001`. Status **Implemented** (`DASH.5`).

### `KPI-TGT-004` — Total gross target attainment

As `KPI-TGT-002` with numerator `KPI-GRS-003` (MTD, sale-date basis) and denominator `KPI-TGT-003`.
Status **Implemented** (`DASH.5`).

### `KPI-TGT-005` — Selling days elapsed

| Field | Value |
|---|---|
| Display name | Selling days elapsed |
| Business purpose | The pace clock's numerator: how much of the month's selling capacity is used. |
| Formula | `COUNT(dim_date rows)` where `is_selling_day AND full_date <= as-of date AND month = selected month` |
| Numerator / Denominator | n/a — additive count |
| Grain | Month × as-of date (store-invariant; all three stores share the calendar) |
| Date basis | Calendar date |
| Inclusion / Exclusion | `is_selling_day` per the deterministic holiday rule (ADR-0002); no per-store calendars |
| Eligibility | None |
| Null behaviour | 0 is legitimate (month not started) |
| Source fact | `warehouse.dim_date` |
| Reporting-view owner | `reporting.vw_target_attainment` |
| Future Power BI measure owner | Target Measures group |
| Web presentation | "Day 14 of 26 selling days" text in the pace header |
| Limitations | Shared calendar is a simplification; real stores differ |
| Project-default thresholds | None |
| Status | **Implemented** (`DASH.5`) |

### `KPI-TGT-006` — Selling days remaining

`(selling days in month) − KPI-TGT-005`. All other fields as `KPI-TGT-005`. Status **Implemented** (`DASH.5`).

### `KPI-TGT-007` — Retail unit pace

| Field | Value |
|---|---|
| Display name | Retail unit pace |
| Business purpose | Units per selling day at the current run rate — the number a desk uses daily. |
| Formula | `KPI-SLS-001 (MTD) / KPI-TGT-005` |
| Numerator | Retail units MTD, sale-date basis |
| Denominator | Selling days elapsed |
| Grain | Store × month × as-of date |
| Date basis | Sale date over the calendar clock |
| Inclusion / Exclusion | As `KPI-SLS-001` |
| Eligibility | None |
| Null behaviour | NULL when selling days elapsed = 0 |
| Source fact | `fact_vehicle_sale` + `dim_date` |
| Reporting-view owner | `reporting.vw_target_attainment` |
| Future Power BI measure owner | Target Measures group |
| Web presentation | "X.X units per selling day" beside the pace bar |
| Limitations | A run rate, not a forecast; early-month values are volatile by construction |
| Project-default thresholds | None |
| Status | **Implemented** (`DASH.5`) |

### `KPI-TGT-008` — Total gross pace

As `KPI-TGT-007` with numerator `KPI-GRS-003` (MTD). Currency per selling day. Status **Implemented** (`DASH.5`).

### `KPI-TGT-009` — Projected month-end retail units

| Field | Value |
|---|---|
| Display name | Projected month-end retail units |
| Business purpose | Where the month lands if the current selling-day rate holds — the honest version of "are we going to make it". |
| Formula | `KPI-TGT-007 × selling days in month`, displayed to whole units with the exact ratio retained internally |
| Numerator / Denominator | Composition of `KPI-TGT-007`; documented so the projection is auditable |
| Grain | Store × month × as-of date |
| Date basis | Sale date over the calendar clock |
| Inclusion / Exclusion | As `KPI-TGT-007` |
| Eligibility | None |
| Null behaviour | NULL when pace is NULL |
| Source fact | `fact_vehicle_sale` + `dim_date` |
| Reporting-view owner | `reporting.vw_target_attainment` |
| Future Power BI measure owner | Target Measures group |
| Web presentation | Labelled **"Selling-day pace projection"**, always beside actual MTD and target, never alone |
| Limitations | Linear extrapolation; ignores within-month seasonality the generator deliberately encodes (weekend weighting), so late-month accuracy is structurally better than early-month. Never called a forecast. |
| Project-default thresholds | None |
| Status | **Implemented** (`DASH.5`) |

### `KPI-TGT-010` — Projected month-end total gross

As `KPI-TGT-009` over `KPI-TGT-008`. Currency. Status **Implemented** (`DASH.5`).

---

## 4. `KPI-FNI` — F&I detail

Source facts: `warehouse.fact_finance_product_sale` (one row per finance product sold on a finalized
vehicle transaction; identity `original_product_gross = product_retail_price − product_dealer_cost`,
exact `numeric`), `warehouse.fact_finance_product_adjustment` (one row per cancellation, chargeback,
reinstatement, or approved adjustment event), and `fact_vehicle_sale` extended with
`finance_reserve_gross`. All promoted by `DASH.6`. Governed categories per
[`DASHBOARD_PROGRAM.md §9`](../requirements/DASHBOARD_PROGRAM.md): Vehicle Service Contract, GAP,
Tire & Wheel, Prepaid Maintenance, Appearance Protection, Key Replacement, Theft or Security Product,
Paintless Dent Protection, Lease Wear Protection, Other Aftermarket Product. "Extended warranty" is a
permitted user-facing alias for Vehicle Service Contract, never a model category.

**The back-gross reconciliation identity** (reporting-view and test enforced, never a single-table CHECK):

```
back_end_gross = finance_reserve_gross
              + net product gross at the stated date basis
              + other_fi_income        (defined as exactly 0.00 unless modelled)
```

**Net product gross as of a date:**

```
net_product_gross_as_of = original_product_gross
                        − cumulative adjustments with adjustment_date <= as-of date
```

Three reads of the same facts, always labelled: **deal-date gross** (original, by sale date),
**as-of net gross** (original minus cumulative adjustments), **adjustment-period impact** (adjustments
by their own adjustment date).

### 4.1 Eligibility rules (governed, configured centrally)

`config/reference/fi_product_eligibility.yaml` — one rule per product category, versioned, loaded by
the generator, enforced by `DQ-FPS-*` validation, joined into `reporting.vw_fi_product_penetration`,
exported with the dataset, and displayed in every penetration disclosure. Initial rules:

| Rule ID | Category | Eligible denominator | Excluded |
|---|---|---|---|
| `ELIG-VSC` | Vehicle Service Contract | Finalized retail deals (`is_retail`) | Wholesale, Dealer Trade, vehicle categories the config declares ineligible |
| `ELIG-GAP` | GAP | Financed retail deals (`amount_financed IS NOT NULL AND amount_financed > 0`, excluding Lease unless the config's lease-GAP flag is true) | Cash deals, Wholesale, Dealer Trade, structures where GAP is not offered |
| `ELIG-TW` | Tire & Wheel | Finalized retail deals | Wholesale, Dealer Trade |
| `ELIG-PPM` | Prepaid Maintenance | Finalized retail deals | Wholesale, Dealer Trade |
| `ELIG-LWP` | Lease Wear Protection | Lease transactions (`sale_type = 'Lease'`) | All non-lease |
| `ELIG-OTH` | remaining categories | Finalized retail deals unless the config narrows | Wholesale, Dealer Trade |

Binding rules: every penetration KPI names its `ELIG-*` denominator; every product-sale row must
satisfy its rule or fail `DQ-FPS-*` validation; an empty eligible denominator returns NULL; React and
DAX consume the exported rule, never restate it.

### 4.2 As-built: what changed between this plan and the implementation

A planning document that is quietly edited to match what shipped stops being evidence of anything. These
are the divergences, stated rather than smoothed over. All twenty-two `KPI-FNI-*` definitions are
**Implemented**; every per-KPI *Status* line below still reads **Planned** and is superseded by this section
and by [KPI_CATALOG.md §40](../../KPI_CATALOG.md), which is the authority.

1. **`KPI-FNI-020`'s owning view changed, and this is the correction most worth reading.** The plan
   assigned it to `reporting.vw_fi_summary` "at category grain". **`vw_fi_summary` has no category grain and
   cannot acquire one**: it carries finance reserve and retail units, both properties of a *deal*, and adding
   a category would repeat them on every category row and multiply both for anything that summed the result.
   `KPI-FNI-020`'s owner as built is **`reporting.vw_fi_product_penetration`**, which is where the category
   grain lives and which deliberately carries **no reserve and no retail-unit column**. The correction is
   recorded on the view's own `COMMENT`, in `arpi.constants.FI_KPI_VIEW_OWNERSHIP`, and asserted by
   `tests/integration/test_fi_reporting_views.py`.

2. **The back-gross identity is on the DEAL-DATE basis, not "the stated date basis".** The plan's identity
   reads `back_end_gross = finance_reserve_gross + net product gross at the stated date basis +
   other_fi_income`. As built it is `finance_reserve_gross + SUM(original_product_gross)` — the **original**
   figure, not the net one. Using net gross would make the identity **fail every time a cancellation
   posted**, because `back_end_gross` is never rewritten. `RECON-FI-001` proves the deal-date identity per
   deal at tolerance `0`; `RECON-FI-NET-GROSS` reconciles the as-of side **separately, on its own basis**.

3. **`other_fi_income` is exactly `0.00` and is not a column anywhere.** The plan left it as a term. It is
   not a balancing plug and there is no residual bucket: the allocation reaches the cent by **largest
   remainder** across real product lines.

4. **The eligibility table in §4.1 was ambiguous and the configuration resolved it.** The plan said "one rule
   per product category" while the table itself grouped five categories under `ELIG-OTH` as a fallback. As
   built, `config/reference/fi_product_eligibility.yaml` makes the mapping **explicit**: `ELIG-OTH` names its
   five categories rather than being reached by a fallback hidden in code, and the loader **refuses a file
   that is not a partition** over the ten categories — not zero rules for a category, not two.

5. **Two of the plan's denominators narrowed, and one widened.** `ELIG-GAP` is **Retail Finance only** — the
   plan's "lease-GAP flag" was not implemented, because a flag with one setting is a decision written as a
   configuration option. `ELIG-PPM` narrows to **New and Certified** vehicles, which the plan did not
   specify and which is why a store with a heavier used mix has a structurally smaller Prepaid Maintenance
   denominator. `ELIG-VSC` and `ELIG-TW` cover **all three retail structures and all three conditions**.

6. **The plan's `is_retail` denominator became a three-value finance structure.** `is_retail` includes
   Lease, which is correct for a retail-unit count and wrong for a GAP denominator. The structure is derived
   by one authority in Python and one in SQL, proved equal over the whole input cross product.

7. **Penetration counts DISTINCT DEALS, not contract rows.** One deal may legitimately carry two *different*
   products in one category (a windscreen plan and a roadside plan are both `Other Aftermarket Product`),
   which is generated on purpose so that the rule is testable rather than an identity on this dataset.

8. **Views publish numerator, denominator and rule id; the ratio is left to the consumer.** As with
   `KPI-TGT`, a ratio cannot be re-aggregated. `penetration_numerator`, `penetration_denominator` and the
   governing `ELIG-*` id are on **every row**, so a group figure is `SUM(numerator) / SUM(denominator)` and
   never an average of store percentages.

9. **Three KPIs are mixed-basis period proxies and say so as data.** `KPI-FNI-014`, `-015` and `-018` divide
   an adjustment-period numerator by a sale-date denominator. They are **not contract-cohort loss rates**,
   because the contracts charged back in a month are mostly not the ones written in it. The disclosure is
   published in the row (`numerator_date_basis`, `rate_denominator_date_basis`, `rate_denominator_source`,
   `rate_basis_disclosure`) rather than left to a sentence somebody remembered.

10. **A minimum-sample floor governs every manager-grain read.** The plan did not specify one. As built it is
    `warehouse.fn_minimum_sample_floor()` — project default **10** eligible deals, sourced from
    `arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS` rather than hard-coded per view. **No leaderboard, ranking
    or best/worst label exists anywhere in the model**, and none may be built on these KPIs.

11. **`Future Power BI measure owner` is still future.** No TMDL was modified. The F&I Measures group remains
    a documented gap in `powerbi/model_documentation/03-measure-groups.md`, and Gate 2 stays **CLOSED**.

12. **No console surface was built by `DASH.6`; `DASH.7` builds it.** Every "Web presentation" line below
    describes a `DASH.7` surface, and `DASH.7` delivers them: `/dashboard/fi` renders the summary cards,
    the back-gross composition, the structure mix, the penetration table, the category economics, the
    adjustment analysis and the manager comparison, and the Deal Jacket renders the per-contract
    itemization. All four F&I views are now exported.
    `tests/integration/test_fi_reporting_views.py` is re-aimed rather than deleted: it asserted through
    `DASH.6` that **no** F&I view appeared in the export contract, and now asserts the exported set is
    **exactly those four**, in both directions, so a fifth F&I view exported without an increment still
    fails a test.

    Three things the surfaces do **not** do, restated here because a "Web presentation" line could be
    read as licence for them. No KPI below is rendered beside a benchmark, a target or a quality word;
    `KPI-FNI-021` and `KPI-FNI-022` are rendered in store-and-identifier order with the minimum-sample
    floor applied and **no rank of any kind**; and `KPI-FNI-014`, `KPI-FNI-015` and `KPI-FNI-018` are
    rendered with the words *period proxy, not a contract-cohort loss rate* attached to every value, on
    the page rather than only in this document.

### `KPI-FNI-001` — Finance reserve gross

| Field | Value |
|---|---|
| Display name | Finance reserve gross |
| Business purpose | The finance-office income earned on the financing itself, separated from product gross so back-end mix is explainable. |
| Formula | `SUM(finance_reserve_gross)` over finalized retail deals |
| Numerator / Denominator | n/a — additive measure |
| Grain | Deal (store × day aggregable) |
| Date basis | Sale date |
| Inclusion rules | Retail deals; reserve is 0.00 (not NULL) on financed deals that earned none |
| Exclusion rules | Cash deals carry no reserve by construction (generator rule); wholesale and dealer trades excluded |
| Eligibility rules | None (additive) |
| Null behaviour | Sum over empty set → NULL in ratio contexts, 0.00 display with explicit "no deals" state |
| Source fact | `fact_vehicle_sale.finance_reserve_gross` (new column, `DASH.6`) |
| Reporting-view owner | `reporting.vw_fi_summary` (planned) |
| Future Power BI measure owner | F&I Measures group (documented gap group in `03-measure-groups.md`) |
| Web presentation | KPI card and reserve-versus-product stacked bar on `/dashboard/fi` |
| Limitations | Reserve is a generated amount only. **No APR, buy rate, sell rate, or rate-spread mechanics are modelled**, per [PRIVACY_AND_ETHICS.md §7](../../PRIVACY_AND_ETHICS.md); reserve must never be presented as rate guidance. |
| Project-default thresholds | None |
| Status | **Planned** (`DASH.6`) |

### `KPI-FNI-002` — Finance reserve PVR

`KPI-FNI-001 / retail units sold` (`KPI-SLS-001` denominator, shared exactly). NULL on zero retail
units. Grain store × period. Date basis sale date. Owner `reporting.vw_fi_summary`; F&I Measures group.
Limitation: the denominator includes cash deals, which cannot generate reserve — a store's cash mix
moves this number for reasons unrelated to finance-office performance (the `SQ-20` caution, now
displayable beside the KPI). Status **Planned** (`DASH.6`).

### `KPI-FNI-003` — Original product gross

| Field | Value |
|---|---|
| Display name | Original product gross |
| Business purpose | Product gross as written at the deal, before any later cancellation or chargeback — the F&I office's production number. |
| Formula | `SUM(original_product_gross)` = `SUM(product_retail_price − product_dealer_cost)` |
| Numerator / Denominator | n/a — additive |
| Grain | Product-sale row (deal, store, manager, category, provider aggregable) |
| Date basis | Sale date of the parent deal |
| Inclusion rules | All product rows on finalized deals |
| Exclusion rules | None (eligibility violations are data-quality failures, not silent exclusions) |
| Eligibility rules | Rows must pass their `ELIG-*` rule to exist |
| Null behaviour | NULL over empty set in ratio contexts |
| Source fact | `warehouse.fact_finance_product_sale` |
| Reporting-view owner | `reporting.vw_deal_product_detail`, aggregated by `reporting.vw_fi_summary` |
| Future Power BI measure owner | F&I Measures group |
| Web presentation | F&I summary card; per-category and per-manager tables |
| Limitations | Deal-date basis only; overstates retained gross when adjustments follow |
| Project-default thresholds | None |
| Status | **Planned** (`DASH.6`) |

### `KPI-FNI-004` — Net product gross

`KPI-FNI-003 − SUM(adjustment_amount)` for adjustments with `adjustment_date <=` the as-of date
(cancellations and chargebacks positive-signed reductions; reinstatements signed additions, capped by
validation at the original gross). **As-of basis** — always displayed with its as-of date. Source:
`fact_finance_product_sale` + `fact_finance_product_adjustment`. Owner `reporting.vw_fi_summary`;
F&I Measures group. Limitation: not comparable to `KPI-FNI-003` without stating both bases. Status
**Planned** (`DASH.6`).

### `KPI-FNI-005` — Product gross PVR

`KPI-FNI-003 (or -004, basis labelled) / retail units sold`. Same denominator discipline as
`KPI-GRS-005`. NULL on zero retail units. Owner `reporting.vw_fi_summary`; F&I Measures group. Status
**Planned** (`DASH.6`).

### `KPI-FNI-006` — Products per retail unit

| Field | Value |
|---|---|
| Display name | Products per retail unit |
| Business purpose | Product-attachment depth per delivery (the deferred candidate in KPI_CATALOG.md §35, now assigned its permanent ID). |
| Formula | `COUNT(product-sale rows on eligible retail deals) / retail units sold` |
| Numerator | Product sale count (each row counts 1) |
| Denominator | `KPI-SLS-001` retail units in the period |
| Grain | Store × period; manager × period with minimum-sample rule |
| Date basis | Sale date |
| Inclusion / Exclusion | Product rows on retail deals; wholesale/dealer-trade rows cannot exist per eligibility |
| Eligibility rules | Rows pass `ELIG-*`; denominator is all retail units, not only product-carrying deals |
| Null behaviour | NULL on zero retail units |
| Source fact | `fact_finance_product_sale` + `fact_vehicle_sale` |
| Reporting-view owner | `reporting.vw_fi_summary` |
| Future Power BI measure owner | F&I Measures group |
| Web presentation | KPI card; manager comparison column |
| Limitations | Counts contracts, not gross; a high count of thin products can mask weak economics — read beside `KPI-FNI-011` |
| Project-default thresholds | Minimum-sample display rule per §7 |
| Status | **Planned** (`DASH.6`) |

### `KPI-FNI-007` — Vehicle Service Contract penetration

| Field | Value |
|---|---|
| Display name | Vehicle Service Contract penetration |
| Business purpose | Share of eligible deals that carried a VSC — the flagship attachment measure. |
| Formula | `eligible retail deals containing >= 1 VSC row / eligible retail deals (ELIG-VSC)` |
| Numerator | Distinct eligible deals with a VSC product row |
| Denominator | Deals satisfying `ELIG-VSC` in the period |
| Grain | Store × period; manager × period with minimum-sample rule |
| Date basis | Sale date |
| Inclusion rules | Deal counted once regardless of multiple VSC rows |
| Exclusion rules | Per `ELIG-VSC` |
| Eligibility rules | `ELIG-VSC` — named in every rendering, with both sides shown as counts |
| Null behaviour | NULL when the eligible denominator is empty |
| Source fact | `fact_finance_product_sale` + `fact_vehicle_sale` + `dim_finance_product` |
| Reporting-view owner | `reporting.vw_fi_product_penetration` |
| Future Power BI measure owner | F&I Measures group |
| Web presentation | Penetration table: contracts sold, eligible deals, penetration, prior period — all four always together |
| Limitations | Penetration says nothing about product economics or customer value; synthetic penetrations are configured distributions |
| Project-default thresholds | Minimum-sample display rule per §7 |
| Status | **Planned** (`DASH.6`) |

### `KPI-FNI-008` — GAP penetration

As `KPI-FNI-007` with category GAP and denominator `ELIG-GAP` (financed retail deals; cash excluded —
a GAP penetration over all retail deals is the misleading number this rule exists to prevent). Status
**Planned** (`DASH.6`).

### `KPI-FNI-009` — Tire & Wheel penetration

As `KPI-FNI-007` with category Tire & Wheel and denominator `ELIG-TW`. Status **Planned** (`DASH.6`).

### `KPI-FNI-010` — Prepaid Maintenance penetration

As `KPI-FNI-007` with category Prepaid Maintenance and denominator `ELIG-PPM`. Status **Planned** (`DASH.6`).

### `KPI-FNI-011` — Product gross per contract

`KPI-FNI-003 / product sale count`. NULL on zero contracts. Category-level and manager-level slices
carry the same definition. Owner `reporting.vw_fi_summary`. Status **Planned** (`DASH.6`).

### `KPI-FNI-012` — Chargeback amount

Additive `SUM(adjustment_amount)` where `adjustment_type = 'Chargeback'`. **Date basis: adjustment
date** — a chargeback belongs to the period it posts in, never restated into the original sale month.
Source `fact_finance_product_adjustment`. Owner `reporting.vw_fi_adjustment_summary`; F&I Measures
group. Status **Planned** (`DASH.6`).

### `KPI-FNI-013` — Chargeback count

`COUNT(*)` of chargeback adjustment rows, adjustment-date basis. Otherwise as `KPI-FNI-012`. Status
**Planned** (`DASH.6`).

### `KPI-FNI-014` — Chargeback rate by amount

| Field | Value |
|---|---|
| Formula | `chargeback amount in period / original product gross of contracts sold in the same period` |
| Numerator | `KPI-FNI-012`, adjustment-date basis |
| Denominator | `KPI-FNI-003`, sale-date basis |
| Date basis | **Mixed and disclosed**: the numerator's period is posting-time, the denominator's is selling-time. The rendering states this, because the alternative (cohort tracking) is a different KPI. |
| Null behaviour | NULL on zero denominator |
| Grain | Store × period; manager and category slices |
| Source fact | Both F&I facts |
| Reporting-view owner | `reporting.vw_fi_adjustment_summary` |
| Future Power BI measure owner | F&I Measures group |
| Web presentation | Adjustment analysis panel with the basis note inline |
| Limitations | A period-rate proxy, not a contract-cohort loss rate; synthetic chargeback timing is a configured distribution |
| Project-default thresholds | Action-rule thresholds per [`ACTION_ENGINE_SPEC.md`](ACTION_ENGINE_SPEC.md) |
| Status | **Planned** (`DASH.6`) |

### `KPI-FNI-015` — Chargeback rate by contract count

`chargeback count / contracts sold in the period`, same mixed-basis disclosure as `KPI-FNI-014`. Status
**Planned** (`DASH.6`).

### `KPI-FNI-016` — Cancellation amount

As `KPI-FNI-012` with `adjustment_type = 'Cancellation'`. Status **Planned** (`DASH.6`).

### `KPI-FNI-017` — Cancellation count

As `KPI-FNI-013` for cancellations. Status **Planned** (`DASH.6`).

### `KPI-FNI-018` — Cancellation rate

`cancellation count / contracts sold in period`, basis disclosure as `KPI-FNI-014`. Status **Planned**
(`DASH.6`).

### `KPI-FNI-019` — Deal structure mix

Share of finalized retail deals by finance structure (Cash / Retail Finance / Lease), each share =
`structure deals / all retail deals in period`, shares summing to 100% by construction. Depends on the
`DASH.6` finance-structure decision ([`DASHBOARD_PROGRAM.md §9.7`](../requirements/DASHBOARD_PROGRAM.md)):
derived from `sale_type` + `amount_financed` in the MVP mapping, promoted to a conformed attribute if
the ADR-gated structure change is approved. Owner `reporting.vw_fi_summary`. Status **Planned** (`DASH.6`).

### `KPI-FNI-020` — Product-category mix

Per category: contract count, retail revenue, dealer cost, original gross, adjustments, net gross,
gross per contract — each column additive or a documented ratio; mix share = category value / all-category
value, NULL-safe. Owner `reporting.vw_fi_summary` (category grain). Status **Planned** (`DASH.6`).

### `KPI-FNI-021` — F&I manager penetration

`KPI-FNI-007`-style penetration computed per finance manager over that manager's eligible deals, per
category. Manager attribution from `fact_finance_product_sale.finance_manager_key` (deal's finance
manager at sale). Subject to the minimum-sample rule (§7) — below the floor the value renders with an
explicit insufficient-sample state, and action rules do not fire on it. Owner
`reporting.vw_fi_product_penetration` (manager grain). Status **Planned** (`DASH.6`).

### `KPI-FNI-022` — F&I manager back PVR

`(finance_reserve_gross + net product gross) for the manager's deals / that manager's retail units`.
Same minimum-sample discipline. Owner `reporting.vw_fi_summary` (manager grain). Limitation: manager
comparisons inherit store mix, structure mix, and eligibility mix; the page must show eligible-deal
counts beside every manager figure. Status **Planned** (`DASH.6`).

---

## 5. `KPI-ACC` — Accounting integrity

Source facts: `warehouse.fact_inventory_accounting_snapshot` (one row per vehicle × dealership ×
accounting snapshot date while carried), `warehouse.fact_gl_control_balance` (one row per dealership ×
GL control account × balance date), `warehouse.dim_gl_account`. Promoted by `DASH.8`. Book-value
identity, enforced as a generator rule and SQL validation:

```
current_book_value = acquisition_cost + capitalized_transportation + capitalized_reconditioning
                   + capitalized_accessories + other_capitalized_costs − write_down_amount
```

Pack stays out of book value; floorplan principal is a liability position, never added to inventory
value; carrying cost is not capitalized. The subledger is a focused stock-level schedule, not a general
ledger, and every page that shows it says so.

### `KPI-ACC-001` — Inventory subledger balance

Additive `SUM(current_book_value)` over active-inventory snapshot rows at the selected snapshot date.
Grain: store × snapshot date × control-account category. Date basis: snapshot date (semi-additive —
last value per period, never summed across dates; same treatment as `KPI-INV-002`). NULL when no
snapshot exists for the date. Owner `reporting.vw_inventory_accounting`. Future owner: Accounting
Measures group (new measure table). Status **Planned** (`DASH.8`).

### `KPI-ACC-002` — GL inventory control balance

`SUM(net_balance)` over selected control accounts at the balance date, from
`fact_gl_control_balance` joined to `dim_gl_account` (categories: New Vehicle Inventory, Used Vehicle
Inventory, Certified Vehicle Inventory, Wholesale Inventory; Floorplan Liability only if the
`DASH.8` scope decision includes it, and then always displayed as a liability, never netted into
inventory). Semi-additive, balance-date basis. Owner `reporting.vw_inventory_gl_reconciliation`.
Status **Planned** (`DASH.8`).

### `KPI-ACC-003` — Inventory reconciliation variance

| Field | Value |
|---|---|
| Formula | `KPI-ACC-002 − KPI-ACC-001` at matched store, account category, and date |
| Numerator / Denominator | n/a — signed difference |
| Grain | Store × account category × date; group rollup is the sum of signed variances |
| Date basis | Snapshot date = balance date (rows only comparable at matched dates; unmatched dates are an exception, not a zero) |
| Null behaviour | NULL when either side is missing (and `KPI-ACC-004`/`KPI-ACC-010` count the misses) |
| Source fact | Both `DASH.8` facts |
| Reporting-view owner | `reporting.vw_inventory_gl_reconciliation` |
| Future Power BI measure owner | Accounting Measures group |
| Web presentation | Signed currency with directional wording ("GL exceeds subledger by …"); executive trust panel summarises worst store |
| Limitations | **A nonzero variance is an exception to investigate, not proof of error.** Controlled test scenarios deliberately contain explicit variances so the surface can be seen working. |
| Project-default thresholds | Action severity bands in `ACTION_ENGINE_SPEC.md` |
| Status | **Planned** (`DASH.8`) |

### `KPI-ACC-004` — Unreconciled stock count

Count of stock-level exceptions at the as-of date: active unit without an accounting snapshot row, or
snapshot row without an active unit, or duplicate stock-account assignment. Additive count over the
exception view. Owner `reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-005` — Unbalanced front-gross identity count

Count of `fact_vehicle_sale` rows failing
`front_end_gross = sale_price − acquisition_cost − reconditioning_cost − pack_amount` beyond the 0.01
tolerance. Expected 0 — the DDL constraint `ck_fact_vehicle_sale_front_end_gross_identity` makes a
nonzero count evidence of an ingestion defect; the KPI exists so the console proves it rather than
assumes it. Sale-date basis. Owner `reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-006` — Unbalanced back-gross reconciliation count

Count of deals where
`back_end_gross ≠ finance_reserve_gross + net product gross (deal-date basis) + other_fi_income`
beyond tolerance. This is the deal-level `RECON-FI-001` made visible (KPI_CATALOG.md §36 lists that
reconciliation as Deferred pending the F&I facts). Depends on `DASH.6`; surfaced by `DASH.8`/`DASH.9`.
Owner `reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-007` — Unbalanced total-gross identity count

Count of rows failing `total_gross = front_end_gross + back_end_gross` (mirror of `RECON-GROSS-001`
at console grain). Expected 0 by constraint. Owner `reporting.vw_accounting_exceptions`. Status
**Planned** (`DASH.8`).

### `KPI-ACC-008` — Orphaned F&I product count

Count of `fact_finance_product_sale` rows whose `sale_id` resolves to no finalized deal. Expected 0 by
FK; counted, not assumed. Owner `reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-009` — Product adjustment without original contract count

Count of `fact_finance_product_adjustment` rows with no resolvable original product-sale key. Owner
`reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-010` — Missing inventory book record count

Count of active inventory units (per `fact_vehicle_inventory_snapshot`) with no accounting snapshot
row at the matched date. Owner `reporting.vw_accounting_exceptions`. Status **Planned** (`DASH.8`).

### `KPI-ACC-011` — Posting-date lag

Median calendar days between an economic event date and its accounting record date (product sale date →
adjustment posting date; acquisition date → first accounting snapshot). Median headline with mean
retained, per KPI_CATALOG.md §5. NULL when no pairs exist. Owner `reporting.vw_accounting_exceptions`.
Limitation: synthetic lags are configured distributions demonstrating the calculation. Status
**Planned** (`DASH.8`).

### `KPI-ACC-012` — Data-quality exception count

Count of failed validation results for the current pipeline run, from the existing
`reporting.vw_data_quality_summary` / `vw_reconciliation_status` surface, scoped to the accounting and
deal families. Additive count; run-date basis. This KPI reuses implemented plumbing — its novelty is
placement, not calculation. Owner: existing operational views. Status **Planned** (`DASH.8` for the
console surface).

---

## 6. `DIAG-DEAL` — Deal-quality diagnostics (not KPIs)

Diagnostics are review prompts with formulas; they carry no benchmark meaning, are excluded from the
KPI catalogue, and feed the Deal Explorer's filters and the Management Action Center's evidence. Every
threshold is a project default in `config/dashboard/action_rules.yaml`.

| ID | Diagnostic | Formula sketch | Source |
|---|---|---|---|
| `DIAG-DEAL-001` | Negative front-gross deal count | `front_end_gross < 0` on retail deals | `fact_vehicle_sale` |
| `DIAG-DEAL-002` | Negative total-gross deal count | `total_gross < 0` | `fact_vehicle_sale` |
| `DIAG-DEAL-003` | Zero back-gross retail deal count | `back_end_gross = 0` on retail deals | `fact_vehicle_sale` |
| `DIAG-DEAL-004` | High-discount deal count | `discount_from_original_asking / original_asking_price` above project default | `fact_vehicle_sale` |
| `DIAG-DEAL-005` | Unusual trade-variance deal count | `ABS(trade_allowance − trade_acv)` above project default, trade present | `fact_vehicle_sale` |
| `DIAG-DEAL-006` | Reserve-without-lender deal count | `finance_reserve_gross > 0 AND lender_key IS NULL` | `DASH.6` columns |
| `DIAG-DEAL-007` | Product-gross-without-finance-manager count | product rows exist, `finance_manager_key IS NULL`, where the synthetic staffing policy requires one | `DASH.6` facts |
| `DIAG-DEAL-008` | Retail sale without customer surrogate | `is_retail AND customer_key IS NULL` (expected 0 by constraint `ck_fact_vehicle_sale_retail_requires_customer`; counted, not assumed) | `fact_vehicle_sale` |
| `DIAG-DEAL-009` | Sale/delivery timing exception count | `delivery_date_key < sale_date_key` or lag above project default | `fact_vehicle_sale` |
| `DIAG-DEAL-010` | Adjustment-exceeding-original count | cumulative adjustments > original product gross | `DASH.6` facts |

---

## 7. Minimum-sample rule (shared)

Employee- and manager-level ratios render only when the denominator meets the project-default minimum
eligible count (initial default: 10 eligible deals or leads in the selected period, configured in the
export, single source). Below the floor: the value is replaced by an explicit "insufficient sample
(n = X)" state, comparisons exclude the row from ranking, and action rules do not fire. This implements
[PRIVACY_AND_ETHICS.md §5](../../PRIVACY_AND_ETHICS.md) employee-fairness commitments.

---

## 8. Promotion protocol

For each family, the owning increment (`DASH.5`, `DASH.6`, `DASH.8`) must, in the same change:

1. Promote the source entities Deferred → Planned → Implemented through Gate 4 with grain constraints.
2. Move the KPI entries into `KPI_CATALOG.md` with every catalogue field, keeping the IDs reserved here.
3. Register the anchoring stakeholder questions.
4. Add the reconciliation register entries (including promoting `RECON-FI-001` from Deferred).
5. Add `DQ-*` checks under newly reserved prefixes (proposed: `FPD` finance product dim, `LND` lender,
   `FPS` product sale, `FPA` product adjustment, `TGT` sales target, `IAS` inventory accounting
   snapshot, `GLA` GL account, `GLB` GL balance — confirmed against
   `src/arpi/validation/registry.py::RESERVED_CHECK_PREFIXES` at implementation).
6. Update `powerbi/model_documentation/` future-ownership notes without touching TMDL until the
   Power BI increment is deliberately taken (see [`DASHBOARD_PROGRAM.md §17`](../requirements/DASHBOARD_PROGRAM.md)).

**`DASH.5` has completed this protocol for the `KPI-TGT` family.** For the record, against each step:
(1) `warehouse.fact_sales_target` went Deferred → Implemented in one increment, through Gate 4, with the
grain enforced by `uq_fact_sales_target_grain`; (2) the ten definitions are in
[`KPI_CATALOG.md` §39](../../KPI_CATALOG.md) with every field filled and the IDs unchanged; (3) **SQ-31**
is registered and Implemented; (4) ten `RECON-TGT-*` / `RECON-FACT-SALES-TARGET-*` entries exist and three
are exercised by seeded corruptions; (5) `TGT` is reserved in
`src/arpi/validation/registry.py::RESERVED_CHECK_PREFIXES` and carries fourteen checks; (6) the Power BI
gap is recorded in the model documentation, **no TMDL file was modified, no Power BI evidence was
re-stated, and Gate 2 remains CLOSED**.
