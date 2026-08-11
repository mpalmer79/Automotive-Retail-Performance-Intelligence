# Dashboard Program — ARPI Dealer Operations Command Center

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-08-06
**Governing decision:** [ADR-0013 — Governed Web Operating Console](../architecture-decisions/ADR-0013-governed-web-operating-console.md)
**Conventions:** [README.md](README.md) · **Parent documents:** [ARCHITECTURE.md](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) · [PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md)

> **No item in this program carries an hour, day, week, or sprint estimate.** Complexity is `Small`,
> `Medium`, or `Large` only ([README.md §3.3](README.md)).

> **Nothing described here exists yet.** This is a planning document. No dashboard route, no export
> pipeline, no new warehouse entity, and no new generator has been implemented. Statuses use the
> repository's four values — Implemented, Planned, Deferred, Out of scope — literally.

---

## 1. Program purpose

Deliver the **ARPI Dealer Operations Command Center**: a governed, interactive, public operating
console over the synthetic Granite Auto Group, under the portfolio site's `/dashboard` route family.
It renders SQL-validated, versioned exports of the governed KPIs — with drill-through to a sanitized
Deal Jacket, an inventory-to-GL reconciliation surface, a deterministic management-action queue, and a
lineage disclosure on every number — so a dealership operator or technical reviewer can *operate* the
numbers this repository can already prove, rather than only read their definitions.

The finished product must be recognizable to a dealer principal, GM, GSM, used-car manager, F&I
director, BDC manager, controller, and dealership technology reviewer as a dealership operating
console. It must not resemble a generic SaaS analytics template, a dealership ad site, a shopping app,
a Power BI clone, or a fake DMS/CRM/accounting system, and every number must be traceable, reconcilable,
and explainable.

## 2. Business problem

Dealership performance conversations fail in predictable ways: numbers without definitions, gross that
does not reconcile to the schedule, penetration without a denominator, pace without a selling-day
clock, and "best employee" rankings with no sample discipline. ARPI's warehouse already solves the
definition and reconciliation problems in SQL; the analytical presentation is Power BI, which no public
reviewer can operate without a licence. The program closes that gap with a public console that keeps
every governance property — one KPI definition, exact identities, visible eligibility, honest
limitations — while adding the interaction a real operator expects: filter, compare, drill, trace.

## 3. Product boundaries

Two presentation products, one calculation authority, per ADR-0013:

| Product | Owns | Never does |
|---|---|---|
| **Power BI** (canonical) | Semantic model, governed DAX, real-engine validation, formal report pages, Gate 2 evidence, SQL-to-DAX reconciliation | — |
| **Web operating console** | Interactive public demonstration over versioned `reporting`-schema exports | Redefine a KPI, query any non-`reporting` schema, hold a credential, validate Power BI, close Gate 2, present itself as a production DMS/CRM/accounting/F&I system |
| **PostgreSQL `reporting` views** | Every reusable SQL calculation, all KPI arithmetic | — |

The console's fifteen admission conditions are binding and enumerated in ADR-0013. Gate 2 remains
CLOSED and unaffected.

## 4. Current-state assessment

Verified during the program audit (2026-08-06, commit `3c8295b`):

- **Warehouse:** 8 conformed dimensions + `dim_observed_vehicle`; 5 MVP facts + the listing fact; every
  grain constraint-enforced. `fact_vehicle_sale` is one row per finalized transaction with 30 columns,
  and the gross identities are CHECK constraints
  (`ck_fact_vehicle_sale_front_end_gross_identity`, `ck_fact_vehicle_sale_total_gross_identity`).
- **Reporting:** 34 views (28 MVP + 6 listing-lane); `arpi_reporter` can read exactly these and nothing
  else. All 29 MVP KPIs computable and verified against independent warehouse derivations; 58
  reconciliations recorded per run, only tolerances 0 and 0.01 exist.
- **Deferred entities (10 at program start, 9 today):** `dim_finance_product`, `dim_lender`,
  `dim_sale_type`, `dim_inventory_source`, `dim_geography`, `fact_lead_activity`,
  `fact_inventory_price_history`, `fact_finance_product_sale`, `fact_service_visit`. None has SQL,
  generation, loading, validation, reporting, or tests today; none may be described as anything but
  Deferred until all of those exist. **`fact_sales_target` was the tenth and is now Implemented** — see
  §9.8 — which is exactly the transition this program was written to schedule.
- **Power BI:** TMDL semantic model (26 tables, 42 relationships, 49 measures) statically validated by
  9,452 assertions; **no engine has ever loaded it**; both ADR-0008 paths PENDING; the report is a PBIR
  shell with zero pages; Gate 1 OPEN, Gate 2 CLOSED.
- **Portfolio:** Next.js 16 / React 19 / Tailwind 4, fourteen statically prerendered routes, standalone
  output on Railway with the repository root as build context. Closed token palette (build-error
  enforced), WCAG 2.2 AA with 0 axe violations at 375/1440 across the swept routes, six-item primary
  nav with a hard cap of seven, no charting library, `TrustLine` synthetic disclosure on every route.
  Generated data flows through deterministic `--check`-mode TypeScript generators
  (`generate-project-manifest.ts`, `generate-inventory-data.ts`) wired into `prebuild`, CI, and the
  Dockerfile. **No KPI value appears anywhere on the site today** (ADR-0009 C5) — the property
  ADR-0013 scopes.
- **Observed documentation drift (not fixed by this program, recorded for honesty):** stale
  `COMMENT ON TABLE` on `fact_vehicle_sale` ("Currently EMPTY"); `STM-008`/`STM-009` header blocks
  still read Planned/0.9 against an Implemented index; `DATA_DICTIONARY.md §14` names
  (`trade_actual_cash_value`, `cash_down_payment`, `finance_amount`) drift from the binding DDL names
  (`trade_acv`, `cash_down`, `amount_financed`); assorted stale counts in portfolio docs. Where this
  program cites columns, **the DDL names are used.**

## 5. Target-state architecture

```
generation (Python, Decimal, seeded)
  └─ raw → staging → warehouse (new F&I / target / accounting entities join the existing star)
       └─ reporting views (all KPI arithmetic; new vw_* per §15)
            ├─ Power BI semantic model (canonical; future increments, TMDL change staling rules apply)
            └─ scripts/export_dashboard_dataset.py  (arpi_reporter, reporting-only, manifest, hashes)
                 └─ data/dashboard/  (committed, versioned, development-profile exports)
                      └─ portfolio/scripts/generate-dashboard-data.ts  (validate, transform, chunk, type)
                           └─ portfolio/src/generated/dashboard/  (page payloads + manifest)
                                └─ /dashboard routes (server components; client islands for filters)
```

Full contract: [`docs/dashboard/DATA_CONTRACT.md`](../dashboard/DATA_CONTRACT.md). Diagrams:
[`docs/dashboard/diagrams/`](../dashboard/diagrams/).

## 6. User personas

| Persona | Needs the console must serve |
|---|---|
| Dealer principal | Group performance, store comparison, total gross, pace, inventory investment, material risks, high-level action queue |
| General manager | Store operating performance, units and gross, department contribution, inventory risk, funnel conversion, manager accountability |
| General sales manager | Unit pace, front/back gross, PVR, new/used mix, salesperson performance, deal drill-through, lost-gross patterns |
| Used-car manager | Aging, book investment, price-to-market, lead activity, markdown history, days supply, turn, aged-unit actions, stock-level accounting position |
| F&I director | Back PVR, reserve, product gross and penetration with eligible denominators, mix, chargebacks, cancellations, manager comparison, deal-level product detail |
| BDC / internet manager | Leads, response time, contact/appointment/show/sold rates, source and employee drill-through |
| Controller | Subledger balance, GL control balance, variance, unreconciled units, unbalanced identities, posting-date differences, chargeback timing, exceptions |
| Technical reviewer | KPI definitions, grain, lineage, query ownership, dataset manifest, reconciliation status, validation evidence, honest limitations |

Persona-to-question traceability continues through
[`STAKEHOLDER_QUESTIONS.md`](STAKEHOLDER_QUESTIONS.md); the new questions each KPI family requires are
proposed in [`KPI_EXTENSION_PLAN.md §1.1`](../dashboard/KPI_EXTENSION_PLAN.md).

## 7. Route architecture

Ten dashboard routes under one new primary-navigation destination, **Dashboard** — the seventh item,
exactly at the existing `MAX_PRIMARY_NAV_ITEMS = 7` cap, with its own internal navigation (the public
header does not grow into an application menu):

| Route | Purpose |
|---|---|
| `/dashboard` | Executive overview: group health, store scoreboard, pace, gross-change bridge, top actions, trust panel |
| `/dashboard/sales-gross` | Units, mix, front/back/total gross, PVR, trends, decomposition, store and employee comparison |
| `/dashboard/deals` | Searchable, filterable finalized-deal index with Deal Jacket drill-through |
| `/dashboard/deals/[saleId]` | Sanitized Deal Jacket: vehicle, front gross, F&I, trade, attribution, checks, lineage |
| `/dashboard/inventory` | Active inventory, investment, aging, days supply, turn, price-to-market, unit actions, stock drill-through |
| `/dashboard/fi` | Reserve, product gross, penetration with eligible denominators, mix, adjustments, manager comparison |
| `/dashboard/leads-marketing` | Funnel, response time, source quality, campaign cost, gross return on ad spend, lost-stage analysis |
| `/dashboard/employees` | Role-aware performance views with minimum-sample discipline; no simplistic leaderboard |
| `/dashboard/accounting` | Subledger vs GL controls, variances, deal identities, exceptions |
| `/dashboard/actions` | Deterministic action queue with severity, evidence, owner role, drill-through |

**As-built at `DASH.2`.** One of the ten routes exists: `/dashboard`. It carries the executive
overview — context rail, global filter bar, seven governed KPI cards, the store scoreboard, a compact
sales-and-gross composition, the inventory risk summary, the lead funnel, and the trust panel. Pace,
the gross-change bridge and top actions are listed above and were **not** built at `DASH.2`: pace needed
`fact_sales_target` (`DASH.5`), a bridge needed the driver model and deal-grain view `DASH.3` builds,
and an action is a recommendation, which Gate 2 does not permit this console to publish. **`DASH.3`
built the bridge and `DASH.5` built pace**; the recommendation is still refused, and always will be
under the current gate. The nine
remaining routes are named on the page as text beside the increment that owns each, and are not
registered, not linked and not in the sitemap.

Details, navigation, breadcrumbs, URL filter contract, and state handling:
[`docs/dashboard/INFORMATION_ARCHITECTURE.md`](../dashboard/INFORMATION_ARCHITECTURE.md).

## 8. Data architecture

The console consumes only exported artifacts. Two governed stages:

1. **Root exporter** `scripts/export_dashboard_dataset.py` — connects as `arpi_reporter`, reads an
   explicit allowlist of `reporting` views, writes deterministic, byte-stable, manifest-carrying JSON
   under `data/dashboard/`, with query hashes, row counts, reconciliation totals, prohibited-column
   scan, and generate/check modes. It follows the repository's existing artifact pattern (Python
   produces committed artifacts; TypeScript consumes them at build time).
2. **Portfolio transformer** `portfolio/scripts/generate-dashboard-data.ts` — validates schemas,
   transforms to page payloads, generates typed contracts, preaggregates summaries, chunks deal and
   inventory detail, fails on staleness, duplicates, or unresolved relationships, and reports sizes.
   **As-built:** it does not transform to page payloads or preaggregate summaries, and `DASH.2`
   confirmed that decision rather than reversing it. A page payload is a presentation decision owned
   by its route, and a precomputed KPI value in a generated file would be a second place that value is
   written. The console instead reads the exported datasets through one server-owned data module and
   aggregates them in one declared selector registry, whose every entry names the manifest
   reconciliation key it must reproduce exactly. `DATA_CONTRACT.md` §14 holds the full rationale.
   Wired as `dashboard`/`dashboard:check` scripts into `prebuild`, CI, and `Dockerfile.railway`
   exactly as the manifest and inventory generators are today, with `railway.json` watch patterns
   extended to the new inputs.

The committed default is the `development` profile (the same profile the SQL baseline uses); the
manifest records profile, seed, source commit, and pipeline-run identity. Everything else —
grains, columns, enumerations, currency handling, chunking, staleness, privacy classification —
is specified in [`DATA_CONTRACT.md`](../dashboard/DATA_CONTRACT.md).

## 9. Data-model expansion

Assessed against the audit; nothing below is Implemented until code, SQL, loading, validation,
reporting, documentation, and tests all exist. Source-to-target numbers `STM-016` onward are reserved
in the backlog items.

### 9.1 `warehouse.dim_finance_product` — promote (DASH.6) — **DONE**

One row per finance product definition: product id, name, category (governed ten-category list:
Vehicle Service Contract, GAP, Tire & Wheel, Prepaid Maintenance, Appearance Protection, Key
Replacement, Theft or Security Product, Paintless Dent Protection, Lease Wear Protection, Other
Aftermarket Product), provider, eligible deal types, eligible vehicle conditions,
cancellation-sensitive and chargeback-sensitive indicators, active dates, active indicator, source
system. "Extended warranty" is a user-facing alias for Vehicle Service Contract only. **Rows, not
columns:** no `warranty_gross` / `gap_gross` / `tire_wheel_gross` / `maintenance_gross` column may
exist anywhere in the model.

### 9.2 `warehouse.dim_finance_product_provider` — decide (DASH.6) — **DECIDED: NOT BUILT**

A provider dimension is justified only if it answers questions a `provider` attribute on
`dim_finance_product` cannot: provider-level chargeback concentration across categories, and
provider mix per store. The `DASH.6` design item makes the call; the default is a **conformed
attribute first**, promoted to a dimension only if the generator models per-provider behaviour
(distinct cancellation/chargeback profiles). Decorative complexity is explicitly rejected.

**The call, as made.** The generator does **not** model per-provider behaviour: cancellation and chargeback
sensitivity are properties of the **product**, so the provider mix *is* the product mix and both questions
above are answerable by joining through `finance_product_key`. `provider_name` is therefore an **attribute**
of `warehouse.dim_finance_product`, and `warehouse.dim_finance_product_provider` was **not built**.

Two consequences, recorded honestly: a provider rollup joins through the product rather than directly, and a
provider that administered zero products could not be represented. Neither costs anything at this scale, and
**promoting the provider later changes no fact** — none carries a provider key. **STM-021 is reserved and
Deferred** so that a future promotion arrives as STM-021 rather than as a renumbering. See
[DATA_DICTIONARY.md §42.6](../../DATA_DICTIONARY.md).

### 9.3 `warehouse.dim_lender` — promote (DASH.6) — **DONE**

Synthetic lenders only: lender id, fictional name, lender category (Captive, Bank, Credit Union,
Independent Finance Company), program tier (Prime, Near-prime, Subprime) as non-sensitive
classifications. **Prohibited:** credit scores, credit-report fields, adverse-action reasons, income,
any finance-application PII, and any real lender identity — per
[PRIVACY_AND_ETHICS.md §7](../../PRIVACY_AND_ETHICS.md). `fact_vehicle_sale.lender_key` (already
documented as a Deferred FK) becomes real, nullable for cash deals.

### 9.4 `warehouse.fact_finance_product_sale` — promote (DASH.6) — **DONE**

Grain: **one row per finance product sold on a finalized vehicle transaction.** Keys: sale date,
dealership, vehicle sale, finance manager, finance product, provider (if promoted), lender where
applicable. Measures: product sale count (1), `product_retail_price`, `product_dealer_cost`,
`original_product_gross`, `contract_term_months`, eligible indicator. Identity, exact `numeric`:
`original_product_gross = product_retail_price − product_dealer_cost`.

**As built**, with two departures. The grain is enforced as `uq_fact_finance_product_sale_grain
(sale_key, finance_product_key)` — one contract per product definition per deal — which still permits two
**different** products inside one category and is why every penetration measure counts **distinct deals**
rather than contract rows. And there is **no eligible indicator**: on a *sold* contract it could only ever
read `true`, so the governed `eligibility_rule_id` is stored instead and a penetration figure names its own
denominator. Eligibility is enforced by `DQ-FPS-011` and `RECON-FI-ELIGIBILITY` rather than by a flag.
There is **no provider key**, per §9.2, and **no customer reference of any kind**. Contract:
[DATA_DICTIONARY.md §44](../../DATA_DICTIONARY.md).

### 9.5 `warehouse.fact_finance_product_adjustment` — new (DASH.6) — **DONE**

Grain: **one row per product cancellation, chargeback, reinstatement, or approved adjustment event.**
Adjustment id, adjustment date, original product-sale key, dealership, finance-manager attribution,
product, adjustment type, adjustment amount, adjustment reason category, source system. The original
sale row is never overwritten; an August chargeback against a June contract lives in August.
Defines `net_product_gross_as_of = original_product_gross − cumulative adjustments through the as-of
date`, and the three documented bases (deal-date, as-of, adjustment-period).

### 9.6 Finance reserve — extend `fact_vehicle_sale` (DASH.6) — **DONE**

New deal-grain measure `finance_reserve_gross numeric(12,2)`. Reconciliation, cross-table and
therefore **never a single-table CHECK constraint**:
`back_end_gross = finance_reserve_gross + net product gross at the required date basis +
approved_other_fi_income`, with `other_fi_income` defined as exactly `0.00` unless a future ADR models
it. Enforced by reporting reconciliation views, integration tests, audit reconciliation records
(promoting `RECON-FI-001` from Deferred), and the console's validation status. Reserve is an amount
only — no APR/term/payment/rate mechanics, keeping the PRIVACY_AND_ETHICS.md §7 boundary.

**As built.** `finance_reserve_gross` and a nullable `lender_key` were added by migration
`0003_add_fi_domain_objects.sql`; the source entity went from 29 columns to 31. **`back_end_gross` was not
made a derived sum.** It keeps the draw it always had, and the decomposition *explains* it — a diff of the
committed `sale_event.csv` reports two added columns and **zero changed values**, so DASH.2–DASH.5 keep the
numbers they were reviewed against. `other_fi_income` is exactly `0.00` and **is not a column anywhere**;
the allocation reaches the cent by largest remainder across real product lines rather than parking a residue
in a plug. `RECON-FI-001` is exact (**tolerance `0`**) and **per deal**, not on a group total, and reconciles
the **deal-date** basis only — `RECON-FI-NET-GROSS` reconciles the as-of side separately, because a later
cancellation is supposed to make the two differ.

### 9.7 Deal structure (DASH.6 design decision) — **DECIDED**

`sale_type` currently mixes disposition and structure. The MVP mapping derives structure
deterministically: `Lease` → Lease; `Wholesale`/`Dealer Trade` → non-retail; retail rows with
`amount_financed > 0` → Retail Finance, else Cash. `DASH.6` evaluates promoting a conformed
finance-structure attribute (values Cash, Retail Finance, Lease, Wholesale, Dealer Trade); changing
`sale_type` itself requires a separate ADR and migration plan and is **not** assumed.

**The call, as made. `sale_type` was not changed and `dim_sale_type` was not created.** The structure is
**derived**, by exactly one authority on each side: `arpi.generation.fi_eligibility.finance_structure_for`
in Python and `warehouse.fn_finance_structure` (`IMMUTABLE`) in SQL, proved equal **over the whole input
cross product** by `tests/integration/test_fi_reporting_views.py`.

The stored vocabulary is the **three retail structures only** — `Cash`, `Retail Finance`, `Lease` — because
a Wholesale or Dealer Trade disposal has no consumer, so no product and no consumer lender can attach to it
and it is not part of the structure mix. An unknown `sale_type` **raises** rather than defaulting to `Cash`:
a silent default would put products on a disposal and move it into three eligibility denominators.
`warehouse.dim_sale_type` remains **Deferred**. See
[DATA_DICTIONARY.md §44.2](../../DATA_DICTIONARY.md).

**`DASH.7` found the reason this decision was worth making, in the one place that had not honoured
it.** `reporting.vw_deal_jacket` derived the structure with its own inline `CASE` rather than calling
`warehouse.fn_finance_structure`, and that `CASE` had no branch for a transaction with no consumer —
so **92 wholesale and dealer-trade disposals were labelled `Cash`**, claiming that nothing was
financed on a transaction where there was nobody to finance anything. The view now calls the governed
function, publishes `finance_structure_basis` naming the branch it took, and publishes
`is_retail_structure` so no consumer re-enumerates the set. The exported vocabulary on the Deal Jacket
is therefore **five values**: the three retail structures plus `Wholesale` and `Dealer Trade`, which
exist there precisely so that a disposal cannot be mistaken for a cash sale. The stored generation
vocabulary is unchanged, and nothing else in the project derived the structure locally — checked, not
assumed.

### 9.8 `warehouse.fact_sales_target` — promote (DASH.5) — **DONE**

Grain **as built**: one row per dealership, target month, targeted KPI, and target scope (scope type +
scope id), enforced by `uq_fact_sales_target_grain` over five `NOT NULL` columns. The program's phrasing
was "optional employee-or-department scope"; *optional* cannot be enforced, because PostgreSQL treats
NULLs as distinct in a `UNIQUE` constraint, so the scope carries its own non-null identity instead
([DATA_DICTIONARY.md §41.3](../../DATA_DICTIONARY.md)).

Measures: `target_value`, `stretch_target_value`. Synthetic internal operating goals, never industry
benchmarks; **never hardcoded in React or DAX** — and a source-scanning test asserts the React half.
Supports attainment, selling-day pace, and pace projection per
[`KPI_EXTENSION_PLAN.md §3`](../dashboard/KPI_EXTENSION_PLAN.md).

`kpi_id` names the **metric being targeted** (`KPI-SLS-001`, `KPI-GRS-001`, `KPI-GRS-002`,
`KPI-GRS-003`), never a `KPI-TGT-*` identifier. Scope rules, the department partition of total gross, and
the no-outcome-leakage rule are in [STM-016](../source-to-target/STM-016-fact-sales-target.md).

### 9.9 `warehouse.fact_inventory_accounting_snapshot` — new (DASH.8)

Grain: **one row per vehicle × dealership × accounting snapshot date while carried in inventory.**
Measures: acquisition cost, capitalized transportation, capitalized reconditioning, capitalized
accessories, other capitalized costs, write-down amount, current book value, floorplan principal,
days in inventory. Identity:
`current_book_value = acquisition_cost + capitalized_transportation + capitalized_reconditioning +
capitalized_accessories + other_capitalized_costs − write_down_amount`.
Rules: pack stays out of book value; floorplan principal is a liability position and is never added
to book value; carrying cost is not capitalized (not modelled without an explicit policy); this is a
focused stock-level schedule, not a complete accounting system, and says so on-screen.

> **As built (`DASH.8`), where it differs from the plan above.** The grain gained the **store**:
> one row per vehicle × dealership × accounting date, enforced over three NOT NULL columns. The
> calendar is **month-end only**, a subset of the daily inventory calendar, which is what makes
> matched-date comparability structural. There is **no `acquisition_date_key`** — roughly 28% of units
> enter stock before the governed calendar opens, so keying that date would have rejected 360
> legitimate schedule lines, and `days_in_stock` already carries the interval `KPI-ACC-011` needs.
> Everything else holds: the identity is a database CHECK, pack is absent, and floorplan principal is
> a separate never-netted column. See
> [STM-022](../source-to-target/STM-022-fact-inventory-accounting-snapshot.md).

### 9.10 `warehouse.dim_gl_account` + `warehouse.fact_gl_control_balance` — new (DASH.8)

Small conformed account dimension over selected synthetic control accounts (New / Used / Certified /
Wholesale Vehicle Inventory; Floorplan Liability only if the DASH.8 scope decision includes it).
Balance fact grain: **one row per dealership × GL control account × accounting balance date**, with
debit, credit, and net balance. Console reconciliation:
`reconciliation_variance = gl_control_balance − inventory_subledger_balance`, where a nonzero
variance is an exception to investigate, never automatically an error. Controlled test scenarios
plant explicit variances so the surface is demonstrably alive.

> **As built (`DASH.8`), where it differs from the plan above.** Three decisions were taken and
> recorded rather than left implicit.
>
> **Three categories, not four.** `Wholesale Vehicle Inventory` was rejected: nothing observable at a
> month-end distinguishes a unit held for wholesale, and only the eventual disposal would — which is
> the future-outcome leakage §9.9 forbids. [STM-023 §6](../source-to-target/STM-023-dim-gl-account.md).
>
> **Floorplan Liability is absent.** `KPI-ACC-001` is an inventory ASSET measure, and putting a
> liability into the same reconciliation invites a "net inventory" figure that means nothing. No
> registered question requires liability reconciliation. `account_type` still permits `Liability`, so
> adding one later needs no domain migration. [STM-023 §5](../source-to-target/STM-023-dim-gl-account.md).
>
> **One signed balance, not debit/credit/net.** The governed question is answered by one signed
> figure, and `dim_gl_account.normal_balance` makes the sign unambiguous. Manufacturing debit and
> credit columns to look accounting-like would be inventing a general ledger a column at a time — and
> `DQ-GLB-002` holds the column contract to exactly the declared list so neither can be added even
> empty. [STM-024 §1.1](../source-to-target/STM-024-fact-gl-control-balance.md).
>
> The reconciliation itself is as planned, with one addition the plan did not state: a **missing side
> is NULL, never zero**, and `comparison_state` names which of the four states a row is in rather than
> leaving it to be inferred from a NULL.

### 9.11 `warehouse.fact_trade_in` — optional, later (DASH.O-1)

One row per trade-in vehicle attached to a finalized retail transaction (supports multi-trade deals):
allowance, ACV, payoff, equity, over/under-allowance, disposition, subsequent inventory vehicle key.
**Not a blocker for the initial Deal Jacket**, which uses the existing `trade_allowance` / `trade_acv`
deal columns. The current columns do not move out of `fact_vehicle_sale` until a migration and
compatibility plan is documented.

### 9.12 Explicitly not promoted by this program

`dim_sale_type`, `dim_inventory_source`, `dim_geography`, `fact_lead_activity`, `fact_service_visit`
stay **Deferred**. `fact_inventory_price_history` also stays Deferred: markdown activity and price
history on the inventory page derive from the existing daily snapshot fact
(`markdown_count_to_date`, day-over-day `current_asking_price` deltas), which the data contract
documents; promoting the event-grain price fact is a recorded optional enhancement (`DASH.O-2`).

## 10. KPI expansion

Three reserved families — `KPI-TGT-001..010`, `KPI-FNI-001..022`, `KPI-ACC-001..012` — plus the
`DIAG-DEAL-001..010` diagnostics register, fully specified field-by-field in
[`KPI_EXTENSION_PLAN.md`](../dashboard/KPI_EXTENSION_PLAN.md). Back-end gross and back PVR remain
`KPI-GRS-002`/`KPI-GRS-005`. Eligibility rules are configured once
(`config/reference/fi_product_eligibility.yaml`) and consumed everywhere. No industry benchmark
appears anywhere; every threshold is a labeled project default.

## 11. Dashboard export strategy

Summarized in §8; contract in [`DATA_CONTRACT.md`](../dashboard/DATA_CONTRACT.md). Non-negotiables:
browser never connects to PostgreSQL; exporter is `arpi_reporter` over an allowlist; deterministic
byte-stable output; manifest carries version, hashes, row counts, reconciliation totals, privacy-scan
status, and staleness signals; page bundles never receive full deal or inventory detail; the Deal
Jacket route loads only its deal's chunk.

## 12. Deal Jacket (summary)

One route per finalized deal, `/dashboard/deals/[saleId]`, presenting the sanitized transaction:
identity header with persistent synthetic disclosure; vehicle section; the exact front-gross
calculation as ARPI defines it (`sale_price − acquisition_cost − reconditioning_cost − pack_amount`,
with trade variance shown separately, never folded into front gross); trade section with
"Not applicable" semantics; finance structure without rate mechanics; itemized F&I products with
original and net gross — **`DASH.6` delivered the data and `DASH.7` presents it**, one row per product
contract with its own status, plus a back-gross reconciliation panel that recomputes
`finance reserve + original product gross = back-end gross` from the figures on the page;
total-gross identity; role-based staff attribution using
synthetic identifiers; lead-and-appointment timeline without any message content; accounting checks;
and a KPI/lineage drawer. Full specification:
[`DEAL_JACKET_SPEC.md`](../dashboard/DEAL_JACKET_SPEC.md).

## 13. Management Action Center (summary)

A deterministic rule engine — no AI, no model, no write-back — configured in
`config/dashboard/action_rules.yaml`, evaluated at export time, producing actions with rule id,
severity, store, entity, evidence fields, owner role, explanation from templates, and a drill-through
target. Language is limited to review verbs; no action is ever "assigned", "completed", or
"resolved". Full specification: [`ACTION_ENGINE_SPEC.md`](../dashboard/ACTION_ENGINE_SPEC.md).

## 14. Security and privacy

- Exporter identity: `arpi_reporter`; `reporting` schema only; no credential in any output or log.
- Frontend source never references `raw`, `staging`, `warehouse`, or `audit` (tested).
- Frontend contracts use exported business fields, not database surrogate keys, except the
  opaque deal identifier used for routing (the `sale_id` business code, not `sale_key`).
- The prohibited-column tripwire (`arpi.validation.privacy`) runs against every export header; the
  console adds no exception to [PRIVACY_AND_ETHICS.md §3](../../PRIVACY_AND_ETHICS.md).
- No customer names, addresses, contact detail, birth dates, licence/SSN/payment/bank/credit data,
  free-form notes, or communication content exist in any export; employees appear as synthetic IDs
  and roles per the employee-fairness rules (§5) and the minimum-sample rule.
- Synthetic disclosure renders in the body of every dashboard route (`TrustLine` extension), and the
  existing `SYNTHETIC_DATA_STATEMENT` remains canonical.

## 15. Reporting-view plan

Candidate views (all **candidates**, approved individually by their owning increment, each documented
with grain, purpose, sources, filters, date basis, additivity, null behaviour, export eligibility,
KPI ownership, `arpi_reporter` access, required indexes, and reconciliation tests before creation —
and never one giant mixed-grain denormalization):

| View | Grain | Increment |
|---|---|---|
| `reporting.vw_executive_dashboard` | store × day (KPI summary slice) | DASH.1 (from existing views) or DASH.5+ |
| `reporting.vw_store_scoreboard` | store × period metrics | DASH.1 (existing KPIs), extended later |
| `reporting.vw_sales_gross_trend` | store × day | DASH.3 (may reuse `vw_sales_summary` + `vw_gross_summary`) |
| `reporting.vw_gross_change_bridge` | store × period pair × component | DASH.3 |
| `reporting.vw_deal_explorer` | one row per finalized deal (projection of `vw_vehicle_sales`) | DASH.3 |
| `reporting.vw_deal_jacket` | one row per deal, presentation-complete | DASH.4 |
| `reporting.vw_deal_product_detail` | **Implemented.** One row per product contract, carrying deal-date gross and as-of net gross | DASH.6 |
| `reporting.vw_fi_summary` | **Implemented.** As built: store × sale date × finance manager — **and deliberately no category.** It carries finance reserve and retail units, both properties of a *deal*; adding a category would repeat and multiply them on every category row | DASH.6 |
| `reporting.vw_fi_product_penetration` | **Implemented.** As built: store × sale date × finance manager × governed category — **and deliberately no reserve and no retail-unit column**, which is the other half of the same rule. Rows are built from the **deals**, not the contracts, so a category with an eligible population and no sales produces a zero-numerator row rather than vanishing | DASH.6 |
| `reporting.vw_fi_adjustment_summary` | **Implemented.** As built: store × **adjustment date** × finance manager × category × adjustment type — the only F&I view on the adjustment-date basis, which is why it is a separate view rather than more columns on an existing one | DASH.6 |
| `reporting.vw_inventory_accounting` | vehicle × store × accounting date | DASH.8 |
| `reporting.vw_inventory_gl_reconciliation` | store × account × date | DASH.8 |
| `reporting.vw_accounting_exceptions` | one row per exception | DASH.8 |
| `reporting.vw_employee_performance` | **Implemented.** As built: store × calendar date × role family × employee **VERSION** — daily rather than the planned "period", because the filter grammar accepts arbitrary ranges, month-to-date and last-30-days and a monthly view can answer none of the three; and keyed on the SCD Type 2 version the fact points at, so a transfer or a promotion cannot move history to a new store or relabel it with a new title. Its sale columns are named per credit relationship (`sold_`, `desked_`, `financed_`) because one delivery is credited to three people | DASH.11 |
| `reporting.vw_employee_lead_source_response` | **Implemented, and not in the plan.** The assigned-lead population beneath the employee grain, by lead source and by distinct first-response value. It exists because lead-source mix (SQ-08) and a true median (SQ-28) are both grained BENEATH the employee row: carrying the source on that row would repeat the employee-day's units and gross on every source row, and a median is not decomposable at all. Carries no unit, gross or appointment measure, so reading the two views together cannot fan one out | DASH.11 |
| ~~`reporting.vw_management_action`~~ | **Not built, and deliberately.** The plan expected a reporting view emitting one row per generated action. `DASH.12` built the queue as a DERIVED export artifact instead: `management-actions.json` is produced by evaluating `config/dashboard/action_rules.yaml` against the datasets the export already publishes, so it reads no view and needs none. Two properties follow that a view could not have given. The engine sees exactly what a reader of the published export sees, so every action is recomputable by hand from files in the repository; and the offline `--check` can re-derive the whole queue with no database, which is what makes a rule-file edit stale the export. A view would also have put review POLICY into SQL, where the rest of the project keeps business calculation — the rule file owns thresholds, SQL owns figures, and `DASH.12` added no view at all | DASH.12 |
| `reporting.vw_target_attainment` | **Implemented.** As built: store × target month × target scope × targeted KPI — one grain wider than planned, because department attainment is half of SQ-31 and a store-grain view could not carry it | DASH.5 |

## 16. Accessibility, performance, testing

- **Accessibility:** WCAG 2.2 AA, the portfolio's existing standard — axe clean on every dashboard
  route at 375/1440, keyboard-complete interactions, data-table alternatives for every chart, single
  accessible representation across responsive variants, reduced-motion end states, no color-only
  meaning, 44px targets, 320px reflow, 200% zoom.
- **Performance:** measure before budgeting. `DASH.2` records baselines with the existing
  `report-bundle.ts` (extended to the dashboard routes); budgets are then set from measurements and
  reviewed like the current PERFORMANCE.md §9 set. Server components by default; no full deal or
  inventory detail in initial bundles; every new dependency measured; no unmeasured performance claim.
- **Testing:** the full multi-layer strategy — Python, SQL integration, export, TypeScript, React,
  end-to-end, and cross-layer reconciliation — is specified in
  [`TEST_STRATEGY.md`](../dashboard/TEST_STRATEGY.md).

## 17. Power BI alignment

Every new KPI and fact names its future Power BI owner (Target / F&I / Accounting measure groups —
the documented gap groups plus one new). This program does **not** modify TMDL. When a future
increment does: the semantic-model source hash changes; existing real-engine evidence (currently
PENDING on both paths) becomes STALE under the ADR-0008 freshness rules; renewed accepted-path
validation is required; and static parsing never counts as validation. No document produced by this
program may state that Power BI is validated, and the console's trust panel renders the live
pending/stale/passed state from the same evidence files CI already checks.

## 18. Delivery increments

Fourteen increments `DASH.0` – `DASH.13`, two experience increments `UX.1` and `UX.2`, plus recorded
optional items, each with purpose, dependencies, complexity, acceptance criteria, tests, documentation updates,
non-goals, and completion evidence, in [`DASHBOARD_BACKLOG.md`](DASHBOARD_BACKLOG.md). Sequencing is
binding: an increment does not start until its data contract is resolved and its dependencies are
Done, and every increment leaves the repository green.

### 18.1 The two experience increments sit inside the delivery sequence

The delivery sequence is:

```
DASH.11  →  UX.1  →  DASH.12  →  UX.2  →  DASH.13
```

**No `DASH` identifier was renumbered, by either of them.** `DASH.11` is still employee performance,
`DASH.12` is still the Management Action Center and change drivers, `DASH.13` is still hardening and
release. `UX.1` and `UX.2` carry their own identifiers because they are a different kind of increment:
neither adds a warehouse entity, a reporting view, an export dataset or a KPI, and numbering either of
them `DASH.11.5` would have implied they belong to the data program.

**Why `DASH.12` depends on completed `UX.1`, and this is a real dependency rather than a preference.**
`DASH.12` is about management ATTENTION: a deterministic action queue, its severity ordering, its
placement relative to the figures it points at, its navigation weight, and the executive block that
surfaces the top of it. Every one of those is a decision about the operating experience, and before
`UX.1` there was no operating experience to make them inside — there was a marketing home page in
front of a console reached through one item in a seven-item documentation header, on routes whose
filters did not survive a navigation.

Building an action queue into that information architecture would have meant deciding where Actions
sits in a navigation that `UX.1` was about to replace, how an action's drill-through carries filter
context through a mechanism that did not yet exist, and how an action's evidence disclosure relates to
a methodology pattern that had not been established. The work would have been done twice.

`UX.1` therefore delivers the substrate `DASH.12` needs: the operating shell, the rail, cross-route
filter continuity, the methodology disclosure pattern, and the copy boundary that keeps a management
action written in dealership language. What it deliberately does NOT deliver is any part of `DASH.12`
itself — no action rule, no action dataset, no `/dashboard/actions` route and no navigation item for
one. `PLANNED_DASHBOARD_SECTIONS` names it as text in the rail, and `site.test.ts` fails if that text
ever becomes a link before the route exists.

### 18.2 `UX.2` sits between `DASH.12` and `DASH.13`

`UX.1` fixed the product ARCHITECTURE — where things live, what the shell is, whether a filter
survives a navigation. `DASH.12` completed the operating CAPABILITY. Neither addressed the VISUAL
product, and the measurement in [`UX-2-BASELINE.md`](../reviews/UX-2-BASELINE.md) is what makes that a
finding rather than an opinion: at 1440 × 900 the flagship operating surface opened with **zero**
data-driven visual regions in the first viewport and put its first framed figure 1,389 px down an
8,161 px document. Every number a general manager needed was present, correctly defined and correctly
qualified, and none of it was visible without scrolling.

`UX.2` is delivered in four sub-increments — `UX.2A` Executive Command Center, `UX.2B` Revenue and
Vehicle Operations, `UX.2C` Demand, People and Controls, `UX.2D` Interaction, consistency and closeout
— so that each merges green rather than as one change across nine routes.

[`UX-2B-BASELINE.md`](../reviews/UX-2B-BASELINE.md) found the same shape on the five revenue and
vehicle routes, and worse: **four of the five contained no framed figure at all**, and the fifth put
its first one 2,752 px down. `/dashboard/inventory` — the densest domain in the project, publishing
unit-grain age, capital, asking price, a synthetic market estimate and the ratio between them at one
snapshot — was two tables and an 11,543 px document.

**Why `DASH.13` depends on a completed `UX.2`.** `DASH.13-01` sweeps a full route × viewport matrix and
`DASH.13-02` sets payload budgets from measurements. Both produce artefacts whose whole value is that
they describe the shipped product; running them against surfaces `UX.2C`–`UX.2D` are still rebuilding
would produce a sweep and a set of budgets that expire on the next merge, and a budget nobody trusts is
a budget that gets raised rather than investigated.

## 19. Dependencies

- `DASH.1` depends on the implemented reporting layer (done) and on nothing Deferred.
- `DASH.2`–`DASH.4` depend only on existing facts — the console reaches production shape on real,
  already-validated data before any new domain lands.
- `DASH.5` (targets), `DASH.6`/`DASH.7` (F&I), `DASH.8`/`DASH.9` (accounting) each promote their own
  entities through Gate 4 and carry their own generator, SQL, validation, and reconciliation work.
- `DASH.10` (leads and marketing) promotes NO entity and needs no Gate 4 work: it reads the lead,
  appointment, marketing-spend and sale facts that already exist. It does add three reporting views,
  which is a different thing and is the reason the distinction is worth stating -- each RE-GRAINS an
  existing fact so a console question can be asked at the grain it is actually asked at, and none adds
  a fact, a dimension or a KPI identifier. The MVP baselines are unchanged.
- `UX.1` depends on `DASH.11` — it productizes the nine operating surfaces, so it starts once the last
  of them exists. It promotes no entity, adds no reporting view and adds no export dataset.
- `DASH.12` depends on every surface it links into AND on completed `UX.1`, for the reason in §18.1.
- `UX.2` depends on completed `UX.1` and completed `DASH.12`: it is a visual rebuild of surfaces that
  must first exist and be correct. It promotes no entity, adds no reporting view and adds no export
  dataset. `UX.2A` and `UX.2B` are Implemented; `UX.2C` and `UX.2D` are Planned.
- `DASH.13` depends on a completed `UX.2` as well as on every `DASH` increment, for the reason in
  §18.2, and closes the program.
- External: none. No new paid service, no live AI, no third-party data. A charting library is not
  assumed; visualization needs are met by extending the existing hand-built SVG/DOM primitives unless
  a measured evaluation concludes otherwise. `DASH.3-02` made that evaluation and `UX.2A` re-made it
  against Recharts, Visx, Chart.js and Observable Plot rather than inheriting it; `UX.2B` re-made it a
  third time against its own hardest case, a unit-grain scatter with a keyboard-reachable point set.
  All three concluded against a library, and all three recorded why in
  [`DESIGN_SYSTEM.md`](../../portfolio/docs/DESIGN_SYSTEM.md) §6.0.
- **Gate 2 real-engine validation is an external manual dependency and does not block `DASH.9`–`DASH.13`.**
  [ADR-0014](../architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md) records the
  reclassification and defines the one case that would block: an increment that cannot be completed without a
  number only a Microsoft semantic-model engine can produce. No remaining increment is in that case — the
  console reads versioned `reporting`-schema exports, not the semantic model. The status itself is unchanged
  and stays **PENDING** on both paths, reported from the evidence files rather than from prose, and the
  release audit in `DASH.13` still reads it.

## 20. Risks

| Risk | Mitigation |
|---|---|
| Console read as real dealership results | Structural disclosure (ADR-0013 §12 condition), TrustLine on every route, fictional store names, no findings |
| KPI drift between SQL, exports, web, and future DAX | Single formula ownership in views; cross-layer reconciliation tests; export manifest hashes |
| Scope sprawl into a fake DMS | Non-goals (§22), no write-back, no operational state, PR discipline per backlog |
| Repository size growth from committed exports | Development-profile default, chunk budgets, measured sizes in the export manifest, documented limits |
| Build-time growth (per-deal pages) | `DASH.4` decides static-vs-server rendering from measured build duration; budget recorded before choice |
| New facts destabilize the green pipeline | Each promotion lands generator + SQL + validation + reconciliation together; increment-level green rule |
| Employee analytics misread as ranking | Minimum-sample rule, role-scoped views, no composite score, PRIVACY_AND_ETHICS §5 tests |
| Accounting surface read as a real GL | Explicit focused-schedule labeling; variance framed as exception-to-investigate |

## 21. Release criteria

The program is releasable when every non-optional increment's acceptance criteria are met, the full
validation suite is green (Python, SQL integration, export checks, portfolio unit/e2e including axe,
capability and naming and secret checks), the measured performance baselines and budgets are
documented, the live deployment renders the console with correct trust states, and no claim anywhere
exceeds the evidence — with Gate 2 still honestly reported in whatever state it is actually in. Reading that
state is one of the five situations in which ADR-0014 requires it to be stated; a release audit that omitted
it would be the omission that record exists to prevent.

## 22. Status rules

The four repository statuses apply to every artifact of this program, literally. An increment in
progress is `Planned`. Nothing is `Implemented` until code, SQL, loading, validation, reporting,
documentation, and tests exist together. The console's own trust panel must render Power BI and
Gate 2 status from evidence files, never from prose.

## 23. Explicit non-goals

The program must not become: a production DMS; a production CRM; a desking tool; a lender-integration
platform; a credit-application system; a customer payment calculator; a menu-selling system; a
contract-generation system; a general-ledger posting system; a full chart of accounts; payroll;
accounts payable; fixed-assets accounting; a dealership ecommerce site; a vehicle retail site; a
customer-data platform; a real-time streaming system; a mobile application; a multi-tenant SaaS
platform; a chatbot; a machine-learning project added for presentation value; a replacement for
Power BI; a source of real dealership benchmarks; or a repository of real customer or employee data.

Also excluded: fake real-time refresh, fake notifications, fake saved/assigned/completed actions,
fake collaboration, fake write-back, fake production workflow status, and any control that appears to
change dealership data while only changing browser state.
