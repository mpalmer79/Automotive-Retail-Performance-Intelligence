# ARPI — product gap analysis

What ARPI can answer today, what `UX.1` fixed, what needs presentation-grain work, what needs data
the model does not contain, and what is explicitly out of scope.

Produced by touring the running application as six dealership roles against `main` at
`f5a1eac`, before any `UX.1` code was written. Every "cannot answer" below was verified against the
repository rather than assumed.

Every gap is classified as one of:

| Class | Meaning | Disposition |
|---|---|---|
| **A** | Presentation gap — the data and the route exist, the UX does not expose it well | Fixed in `UX.1` |
| **B** | Information architecture gap — the capability exists, users cannot find it naturally | Fixed in `UX.1` |
| **C** | Cross-domain presentation gap — governed datasets can answer it, they are not shown together | Fixed in `UX.1` if joinable without new business logic |
| **D** | Reporting-grain gap — needs a new presentation-grain reporting view | Documented, not built |
| **E** | Data-domain gap — the model does not contain the data | Documented, not built, not fabricated |

---

## 1. The persona audit

### General Manager

| Question | Route | Answerable? | Effort before `UX.1` | Problem | Class | `UX.1` |
|---|---|---|---|---|---|---|
| How are we doing this month? | `/dashboard` | Yes | 2 clicks + 2,194 px of scroll | Behind a marketing home page, then behind heading, badges and a filter grammar disclosure | A, B | `/` is the console; first visual at 393 px |
| Which store is materially different? | `/dashboard` | Yes | Scroll past KPI rail | Store comparison bars existed and were below the fold | A | Same region as the KPI rail, in one eyeline |
| Are we on pace? | `/dashboard` | Yes | Third region | Pace bar with governed selling-day calendar; correct and buried | A | Plan-and-stock region tightened |
| Where is gross changing? | `/dashboard/sales-gross` | Yes | 3 clicks, 3,412 px | The gross bridge — ARPI's strongest analytical asset — sat below a 93-paragraph preamble | A | Prose cut; band carries name + scope + filters only |
| Where is aged inventory concentrated? | `/dashboard`, `/dashboard/inventory` | Yes | 2–3 clicks | Two destinations named Inventory, one of them listings | B | Rail Inventory means the operating surface; listings relabelled |
| What is happening in the lead funnel? | `/dashboard/leads-marketing` | Yes | 3 clicks | 2,248 words of prose on the route | A | Reduced; methodology behind disclosure |
| Do the books reconcile? | `/dashboard/accounting` | Yes | 3 clicks | Reachable; not visible from the executive surface | A | Integrity region on `/`, drill-through preserved |
| Did the filters I set survive the journey? | all | **No** | — | Every route rebuilt its own filter state | **B** | Rail carries compatible filters; drops inapplicable ones |

### General Sales Manager

| Question | Answerable? | Class | Note |
|---|---|---|---|
| Why did front gross move? | Yes | A | The documented gross bridge, now foregrounded |
| How are new and used contributing? | Yes | A | Condition split is a governed export column |
| Which transactions sit behind the aggregate? | Yes | A | Deal Explorer → Deal Jacket |
| What is the discounting distribution? | Yes | A | Discount-against-asking distribution strip |
| What inventory mix accompanied the result? | Partly | **D** | Stock mix and delivered mix are different grains at different dates. A joint view needs a presentation-grain reporting view; see §3 |

### Used Vehicle Manager

| Question | Answerable? | Class | Note |
|---|---|---|---|
| How much capital is tied up? | Yes | A | Inventory investment, by age band |
| Where are the oldest units? | Yes | A | Five governed age buckets; unit table |
| Where is price-to-market concentrated? | Yes | A | **Against a synthetic estimate.** Not a valuation, and the page says so |
| Which units require investigation? | Yes | A | Age + price position + drill-through. **No repricing recommendation** — that would be `DASH.12` territory and is not published |
| How has asking price moved? | Yes | A | Snapshot-derived movement between consecutive month ends |
| What did reconditioning cost, and how long did it take? | **No** | **E** | Recon is a cost component on the deal, not a workflow with dates. No recon-time domain exists |

### F&I Director

| Question | Answerable? | Class |
|---|---|---|
| What is back PVR? | Yes | A |
| What portion is reserve versus product? | Yes | A |
| What is the finance structure mix? | Yes | A |
| Which categories have eligible opportunity? | Yes | A — penetration on each category's own eligible denominator |
| What adjustments are affecting retained economics? | Yes | A — cancellations and chargebacks on their own posting dates |
| What did each lender actually buy, at what participation? | **No** | **E** | `dim_lender` exists; lender program terms and buy rates do not |

### BDC / Marketing Director

| Question | Answerable? | Class |
|---|---|---|
| How many valid leads arrived? | Yes | A |
| How many were contacted, set, shown, sold? | Yes | A — cohort funnel on the lead-created basis |
| What is response time? | Yes | A — distribution with never-responded leads preserved beside it |
| Which sources have different economics? | Yes | A — spend against attributed outcomes |
| Which source is *best*? | **Refused** | — | A subjective source quality score is not a governed measure and `UX.1` did not invent one |
| What did an individual agent's activity look like? | Yes | A — `/dashboard/employees`, BDC role, under the sample floor and with no ranking |

### Controller / CFO

| Question | Answerable? | Class |
|---|---|---|
| What is inventory book value? | Yes | A |
| Does the GL control agree with the subledger? | Yes | A — signed variance, four comparison states |
| Where are missing-side positions? | Yes | A — preserved as missing, never as zero |
| What inventory capital is tied up? | Yes | A |
| What gross is being produced? | Yes | A |
| What F&I income is retained? | Yes | A — after adjustments, on the adjustment's own posting date |
| **Everything below this line** | **No** | **E** | See §4 |

---

## 2. Already supported, poorly surfaced — fixed by `UX.1`

- The executive console was two clicks and a marketing page from the front door. → `/` renders it.
- The first data visualization was 2,194 px down. → 393 px.
- Nine operating surfaces were reachable only from a sub-navigation inside one header item. → An
  eight-destination application rail.
- Filters did not survive a navigation. → They do, and inapplicable ones are dropped deliberately.
- Six documentation routes competed with the console for the same click. → One technical destination.
- Two destinations were called Inventory. → The rail's Inventory is the operating surface; the
  sanitized listings are "Reference listings" under Technical → Data sources.
- Provenance badges, a contract fingerprint and a semantic-model status opened every operating
  screen. → One persistent demo statement, with the full evidence one click away in a methodology
  disclosure on every route.

## 3. Requires presentation-grain work — documented, not built

Four visualizations were designed, could not be built honestly from a published grain, and were
therefore **refused**. Each is recorded here rather than approximated.

**Inventory mix against delivered mix.** Stock is a position at a snapshot date; deliveries are a
period total. Drawing them as one shape implies a relationship between two different grains at two
different dates. A presentation-grain view reconciling stock-at-period-start against
deliveries-in-period would be defensible; it is new reporting work with its own reconciliation
obligation and does not belong in a productization increment.

**Days in stock against front gross on the same mark.** The deal grain carries days-in-stock and
front gross, so a scatter is *computable*. It was refused for a different reason: with no control for
condition, model year, acquisition channel or trade involvement, the picture invites a causal reading
the data cannot support, and `UX.1` may not publish an implied causal claim.

**Lead economics as one cross-domain view** — volume, conversion, attributed gross and spend on one
row per source. Volume, conversion and spend are available at source grain. Attributed gross is not:
attribution resolves through the lead linked to a deal, and a deal with no linked lead is walk-in
business. Summing gross by source would silently exclude that population from the numerator while a
reader assumed it was total gross. Needs an explicit unattributed row published *beside* the
attributed ones, which is a reporting-grain decision.

**A single store operating pulse row** — units, GPRU, inventory age, lead conversion, back PVR and
accounting position per store. Every component exists and every one is on a different grain and date
basis: gross over a period, age at a snapshot, conversion on a lead-created cohort, and a control
balance at a comparison date. A row that presents them as one reading needs a view that states which
date each column is on, and a composite of them would be a store score — which this project does not
publish.

## 4. Requires data the model does not contain — CFO gap, stated in full

**What ARPI currently is:** a strong operating and inventory-control analytics platform.

**What ARPI is not yet:** a general ledger, a financial statement system, a dealership accounting
suite, or a month-end close platform.

Verified absent from the warehouse:

| CFO question | Status |
|---|---|
| Dealership operating profit | **Not modelled.** No expense domain exists |
| Departmental statement (new, used, F&I, service, parts) | **Not modelled.** Two of the five departments have no fact at all |
| Controllable expense | **Not modelled** |
| Cash position | **Not modelled** |
| Receivables ageing | **Not modelled** |
| Contracts in transit | **Not modelled.** Funding status is not carried on a deal |
| Floorplan interest expense | **Not modelled.** Units carry no floorplan curtailment or interest |
| Factory receivables | **Not modelled** |
| Trial balance | **Not modelled.** Selected control accounts exist; a chart of accounts does not |
| Journal activity | **Not modelled.** Balances are positions; no entries exist behind them |
| Month-end close status | **Not modelled** |
| EBITDA | **Not derivable.** Requires every row above |

The accounting surface is explicit in the product about being an inventory control reconciliation
rather than a general ledger, and the route's own subtitle says so. **No figure anywhere on this site
may be read as dealership profitability.**

Other data-domain gaps, for completeness:

- **Service and parts.** `fact_service_visit` is declared and Deferred. Fixed operations is roughly
  half of a franchise dealership's gross and none of it is modelled. The employee surface gives
  Service Advisor no role family for exactly this reason: a family of zeroes reads as poor
  performance rather than as absent data.
- **Payroll and compensation.** Absent by design. The employee dimension's exported allowlist
  contains no compensation field, and no pay plan exists.
- **Real market valuation.** The price-to-market ratio uses a synthetic estimate generated for this
  dataset.
- **Reconditioning workflow.** Recon is a cost, not a process with dates.
- **Lender program terms.** Lenders exist; their buy rates and participation terms do not.
- **Live DMS / CRM / F&I / accounting integration.** None exists. See
  [`PRODUCT_VISION.md`](PRODUCT_VISION.md) §4.

## 5. Explicitly out of scope

- **A recommendation engine.** `DASH.12` owns deterministic management actions. `UX.1` published no
  "action required", no recommended action, no repricing instruction and no coaching output.
- **An employee leaderboard, in any form.** The `DASH.11` fairness contract is structural: no
  comparator argument, no composite score, no performance sorting, no rate below its sample floor.
  A prettier leaderboard is still a leaderboard, and `UX.1` added none.
- **A store score.** Three stores with three operating models are compared on governed columns and
  never ranked.
- **A source quality score.** Sources have different economics; ARPI publishes the economics, not a
  verdict.
- **Artificial intelligence of any kind.** No model, no inference, no prediction.

## 6. Roadmap disposition after `DASH.13`

Ordered by the size of the gap between what a dealer group needs and what the model holds:

1. **General ledger and financial statements** — the largest gap, and the one that turns ARPI from an
   operating platform into a management platform.
2. **Service and parts** — roughly half of a franchise dealership's gross.
3. **Presentation-grain cross-domain views** — the four refused visualizations in §3, each with its
   own reconciliation.
4. **Real market data** — turning a synthetic price position into a real one.
5. **Authorized source integration** — the vision in `PRODUCT_VISION.md` §4.

---

Power BI real-engine validation remains externally pending; this document does not alter that state.

---

## `DASH.12` — gaps the action-rule audit found

Auditing thirty proposed management-action rules against the governed export produced four data-domain
gaps. Each was found by trying to enable a rule and discovering the evidence was not there; each is
recorded here rather than approximated, and the rule identifier is retained and switched off.

| Gap | Class | Rules blocked | What is missing, and what was NOT done |
|---|---|---|---|
| **Unit-level lead activity** | **E** | `ACT-INV-002` | ARPI models leads at store, source and campaign grain. `deal-jacket` carries lead attribution only for units that already SOLD, and `inventory-units` carries no lead column at all. Inferring a unit's shopper interest from store-level lead volume would fabricate a relationship the warehouse does not hold. |
| **Unit-level appointment activity** | **E** | `ACT-INV-004` | The same shape. No fact links an appointment to a specific vehicle in stock. |
| **A real journal posting timestamp** | **E** | `ACT-ACC-005` | `inventory-accounting.posting_lag_days` looks like the measure and is not: its own column comment states it is `accounting_date − acquisition_date`, which is `days_in_stock` under another name, and that ARPI holds no posting timestamp. A posting-lag rule would require inventing the second date. |
| **Period-level F&I and lead aggregates** | **D** | `ACT-FNI-003`, `ACT-FNI-007`, `ACT-LED-002`, `ACT-LED-003`, `ACT-LED-005` | The published F&I grain is per store per manager per SALE DATE, and the published lead grain is per store per source per DAY. Every F&I row reports `meets_minimum_sample = false`, and `valid_leads` never exceeds seven against a governed floor of ten. A rate or comparison rule at those grains could never fire without breaching the sample discipline, and no governed period-level aggregate exists. This is the one gap a reporting view could close. |

**Two grain findings that are not gaps.** `ACT-INV-005` asks for a book-versus-GL variance on a unit;
the variance is a property of the control ACCOUNT and dividing it across the units inside would
manufacture a per-unit figure the accounting model does not hold — `ACT-ACC-001` surfaces the same
evidence where it is measured. `ACT-INV-007` asks for model concentration, which no governed dataset
publishes and which the engine may not compute, since it performs no aggregation of its own.

**Seven identifiers are not gaps at all.** `ACT-INV-006`, `ACT-SLS-006`, `ACT-FNI-001`, `ACT-FNI-002`,
`ACT-FNI-004`, `ACT-FNI-005` and `ACT-ACC-004` describe conditions that cannot survive into a valid
export, because a constraint, a data-quality check or a reconciliation fails the pipeline first.
Surfacing a pipeline integrity failure as an ordinary management review item would misrepresent it.
