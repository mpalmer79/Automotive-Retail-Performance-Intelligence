# Deal Jacket Specification — `/dashboard/deals/[saleId]`

**Status:** **As-built for `DASH.4`.** Sections 1–19 are the planning contract; §20 records what
was built, every divergence from the plan and its reason, and the evidence for each. `DASH.7`
itemizes F&I, `DASH.O-1` would add multi-trade detail.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[DATA_CONTRACT.md](DATA_CONTRACT.md) · [KPI_EXTENSION_PLAN.md](KPI_EXTENSION_PLAN.md) ·
[PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md)

The Deal Jacket is the sanitized, explainable record of one finalized synthetic transaction. It must
read like a dealership deal recap — identity, vehicle, money, people, paper trail — while carrying
its own arithmetic verification and lineage. It is a record view, not a workflow: nothing on it can
be edited, assigned, approved, or submitted.

---

## 1. Route contract

- Path: `/dashboard/deals/[saleId]`; `saleId` is the business code `SLE-########` (`sale_id` from
  `warehouse.fact_vehicle_sale`), never the surrogate `sale_key`.
- Source: the deal's row in the `vw_deal_jacket` export chunk (contract §9). One deal's payload per
  page; no adjacent-deal data.
- Invalid or unknown id → 404 page with a link to `/dashboard/deals`.
- Rendering mode per the `DASH.4-01` measured decision (static generation vs server render); either
  way the page is complete HTML without JavaScript.

## 2. Persistent disclosure

The header region always carries: "Fictional transaction from the synthetic Granite Auto Group
dataset. Not a real sale, customer, or dealership record." — in the body, above the fold, in
addition to the route's standard `TrustLine`.

## 3. Header — deal identity

Synthetic deal id · sale date · delivery date · store (name + `GSA-00#`) · deal status (always
"Finalized" — canceled deals never reach the fact; the label says why in a disclosure) · sale type ·
finance structure (derived per program §9.7) · reconciliation state chip (§14).

## 4. Vehicle section

Synthetic stock number · masked synthetic VIN-style identifier (the `ARPI…` synthetic VIN, displayed
with its policy note per ADR-0005) · year / make / model / trim · condition · body style · odometer
band (banded, not exact) · inventory source · acquisition date · days in inventory at sale ·
original asking price · final asking price · MSRP where applicable ("Not applicable" on used units
without one).

## 5. Front-gross calculation

Rendered as a labeled arithmetic block, in this exact order, using the exported exact decimals:

```text
Sale price
− Acquisition cost
− Reconditioning cost
− Pack amount
= Front-end gross
```

Beneath it: discount from original asking price, discount from final asking price, discount from
MSRP where applicable, and the **formula verification state** — the page recomputes the identity
from the displayed components with exact-decimal arithmetic and shows "verified to the cent" or a
failure state (which the corrupted-fixture e2e test forces). Trade variance is **not** in this
formula; a note names the ARPI definition and links the KPI entry (`KPI-GRS-001`). Manufacturer
holdback, dealer cash, stair-step money, floorplan credits, and unposted adjustments are excluded by
model and the limitations drawer says so.

## 6. Trade section

When a trade exists: trade allowance · trade ACV · allowance-versus-ACV difference (labeled "trade
variance", shown separately from front gross) · payoff and equity ("Not modelled" until `DASH.O-1`
adds them — the row states that honestly) · trade vehicle and disposition when the optional trade
fact exists. When no trade exists: the section renders a single "Not applicable — no trade on this
deal" state, never zeros.

## 7. Finance structure

Structure (Cash / Retail Finance / Lease) · amount financed · cash down · synthetic lender, lender
category and lender program tier · finance reserve gross. **Built at `DASH.7`.** **No APR, term,
payment, buy/sell rate, or spread appears anywhere** — the boundary of
[PRIVACY_AND_ETHICS.md §7](../../PRIVACY_AND_ETHICS.md), restated in the drawer.

**As built the structure is five values, not three,** and the correction is the reason. `DASH.4`'s
view derived the structure inline and had no branch for a transaction with no consumer, so every
wholesale and dealer-trade disposal was labelled `Cash` — 92 rows in the committed data, each
claiming that nothing was financed on a transaction where there was nobody to finance anything. The
view now calls `warehouse.fn_finance_structure`, the governed derivation `DASH.6` built for exactly
this reason, and publishes `finance_structure_basis` naming the branch taken and `is_retail_structure`
so no consumer re-enumerates the set.

**An absent lender states WHICH absence it is.** Three are distinguishable and the jacket
distinguishes them: a disposal has no consumer, a cash deal financed nothing, and a financed deal
with no lender recorded is a fourth and different thing. "Not applicable" with no reason is a
sentence a reader cannot check.

## 8. F&I product section (`DASH.7`)

One row per product: category · product name · provider · eligibility rule satisfied (`ELIG-*`) ·
retail price · dealer cost · original gross · cancellation amount · chargeback amount · current net
gross · contract status (Active / Cancelled / Charged back / Reinstated). Totals beneath: finance
reserve gross · original product gross · net product gross · back-end gross · **back-gross
reconciliation state**. **The identity as built is on the DEAL-DATE basis** —
`back_end_gross = finance_reserve_gross + SUM(original_product_gross) + other_fi_income (exactly 0.00)` —
**not net product gross**, which would make the check fail every time a cancellation posted, since
`back_end_gross` is never rewritten. `RECON-FI-001` verifies it per deal to the cent.

**`DASH.6` built the data and deliberately built none of this section; `DASH.7` builds it.** The
warehouse holds one row per product contract and one row per adjustment event, and
`reporting.vw_deal_product_detail` publishes them. `DASH.7` promotes that view into the export as
`deal-product-detail`, partitioned by store × SALE month — the same key `deal-jacket` uses, so opening
one jacket resolves one product partition and it is the partition the route already opened for that
deal. A contract's own adjustment dates are a different question and are never the partition key.

**Contract status as built is three values, not four.** `Active` / `Adjusted` / `Cancelled`, derived
deterministically from the contract's own event history and never from a clock. "Charged back" and
"Reinstated" are EVENT types, not contract states: a contract that has been charged back and partly
reinstated is in neither state, and the events themselves are shown with their own dates. `Cancelled`
is claimed only when nothing at all remains, because a partial cancellation is a reduction and calling
it cancelled would overstate what happened.

## 9. Total deal gross

```text
Front-end gross
+ Back-end gross
= Total gross
```

With exact verification against the exported `total_gross` (`KPI-GRS-003` lineage).

## 10. Staff attribution

Salesperson · desk manager · finance manager · BDC employee where linked — each as synthetic id +
role + store, linking to the employee page's filtered view. **No names.** Synthetic IDs are the
approved presentation; absent roles render "Not applicable" (e.g. wholesale) or "Unattributed" where
the synthetic policy allows absence.

## 11. Lead and appointment timeline

When a lead links to the deal: lead created (timestamp) → first response (elapsed time, or "never
responded") → contacted → appointment set → appointment date → showed → test drive → write-up →
sale → delivery, each with its date where modelled. Flags come from `fact_lead` /
`fact_appointment`; stages the data cannot distinguish render as unavailable rather than invented.
**No message content, notes, emails, phone numbers, or free-form text** — none exists in the model,
and the drawer says that this is by design. Unlinked deals state "No linked lead — walk-in or
unattributed."

## 12. Accounting checks

A checklist rendered from data, each with pass/exception state: front-gross identity ·
back-gross reconciliation (`DASH.7`) · total-gross identity · product eligibility (`DASH.7`) ·
product-adjustment validity (`DASH.7`) · sale-to-inventory relationship (unit existed and was
active) · sale/delivery date validity · source lineage (chunk hash matches manifest).

## 13. KPI and lineage drawer

A `Disclosure` listing: the KPI ids this deal feeds (`KPI-SLS-001`, `KPI-GRS-001..006`, days-to-sale,
funnel KPIs where linked, FNI/ACC after their increments) with plain-English definitions and
formulas; the source reporting view (`reporting.vw_deal_jacket`) and fact grain; the date basis; the
export dataset name, version, and file hash; and known limitations (synthetic data, excluded gross
components, banded odometer).

## 14. Reconciliation state chip

Header chip summarizing §12: "All checks passed" or "N checks need review", using the existing
status-badge vocabulary (verified/pending/blocked tones, icon + word, never color alone).

## 15. Empty and not-applicable states

Every section defines its absent state above; the global rule: **"Not applicable" for
structurally-absent, "Not modelled" for out-of-scope, "No data" for missing-but-expected** (the last
is also an accounting-check exception). Zeros are real zeros only.

## 16. Responsive presentation

Desktop (≥1024px): two-column operating layout — money columns (front gross, F&I, totals) right,
identity/vehicle/people/timeline left. Mobile: single column preserving the §5→§9 calculation order;
wide tables become the established stacked-card pattern with exactly one representation in the
accessibility tree; monetary alignment kept readable (tabular numerals via the `numeric` utility);
all controls ≥44px; heading hierarchy unchanged across breakpoints; no horizontal page overflow at
320px.

## 17. Print behavior

A print stylesheet delivers a paper deal recap: synthetic disclosure (first), deal identity, vehicle,
front-gross block, F&I table, total gross, reconciliation checklist, data as-of date and dataset
version. Not printed: site header/footer, dashboard navigation, filter bar, interactive controls,
drawers (their content prints expanded via the existing `arpi-disclosure` print-open rule where it
is content, and is dropped where it is navigation).

## 18. Accessibility requirements

Axe-clean at 375/1440; keyboard-complete; every check state carries icon + text; the calculation
blocks are semantic (`<dl>` or table, not positioned divs); the timeline is an ordered list; section
landmarks via headings; print view retains reading order.

## 19. Test cases (minimum, from the development-profile fixtures)

| Case | Must assert |
|---|---|
| Standard financed retail deal with trade | Every section populated; identities verified |
| No-trade deal | §6 renders Not applicable, no zeros |
| Trade with allowance ≠ ACV | Variance shown separately; front gross unchanged |
| Negative front-gross deal | Negative rendered signed and unhidden (§19.6 architecture rule) |
| Cash deal | No reserve, structure Cash, lender Not applicable |
| Lease | Structure Lease; lease-eligible products only (`DASH.7`) |
| Wholesale / dealer trade | Retail-only sections Not applicable; no customer required |
| Used unit without MSRP | MSRP Not applicable; MSRP discount absent |
| Deal without linked lead | §11 unlinked state |
| Multiple products incl. a cancelled and a charged-back contract (`DASH.7`) | Net gross arithmetic; statuses; back-gross reconciliation |
| Invalid `saleId` | 404 with return link |
| Corrupted fixture (broken identity) | Verification failure state renders; page does not hide it |
| Print mode | §17 include/exclude list |

---

## 20. As-built (`DASH.4`)

Written after implementation, against the code and the measurements rather than against the plan.
Sections 1–19 above are unchanged: what the increment did differently is recorded here, so a reader
can see both the intent and the outcome.

### 20.1 What was built

| Piece | Where |
|---|---|
| Reporting view | [`sql/05_reporting/43_vw_deal_jacket.sql`](../../sql/05_reporting/43_vw_deal_jacket.sql) — one row per finalized transaction, seven joins, no fan-out |
| Export contract | `_DEAL_JACKET` in [`src/arpi/dashboard/contract.py`](../../src/arpi/dashboard/contract.py) — 65 columns, chunked by store × sale month |
| Partition module | [`portfolio/src/lib/dashboard/jacket-chunks.ts`](../../portfolio/src/lib/dashboard/jacket-chunks.ts) — 18 static imports, read by one route |
| View model | [`portfolio/src/lib/dashboard/deal-jacket.ts`](../../portfolio/src/lib/dashboard/deal-jacket.ts) — lookup, both recomputations, the absence vocabulary, the checklist |
| Sections | [`portfolio/src/components/dashboard/deal-jacket-sections.tsx`](../../portfolio/src/components/dashboard/deal-jacket-sections.tsx) |
| Route | [`portfolio/src/app/(operating)/dashboard/deals/[saleId]/page.tsx`](../../portfolio/src/app/%28operating%29/dashboard/deals/%5BsaleId%5D/page.tsx) |
| View tests | [`tests/integration/test_deal_jacket_reporting_view.py`](../../tests/integration/test_deal_jacket_reporting_view.py) — 34 assertions including two seeded defects |
| Page tests | [`portfolio/tests/unit/dashboard-deal-jacket.test.tsx`](../../portfolio/tests/unit/dashboard-deal-jacket.test.tsx) — 43, including the corrupted-fixture block |
| Browser tests | [`portfolio/tests/e2e/dashboard-deal-jacket.spec.ts`](../../portfolio/tests/e2e/dashboard-deal-jacket.spec.ts) — 31, including the paper recap |

### 20.2 The `DASH.4-01` rendering decision, measured

Full static generation would prerender 650 documents at roughly 190 kB of uncompressed HTML each —
on the order of **120 MB** carried in `.next` and into the deployment image, growing with every
increment that grows the deal population. Server rendering from the statically imported partitions
costs **443,448 bytes** of data, resolved by the output tracer as graph edges, with no file read at
runtime and no database.

Server rendering was chosen. Neither option introduces an API or a runtime database, so both satisfy
ADR-0013; the measurement is what decides. The page is complete HTML without JavaScript either way,
which is the property the choice was not allowed to cost. See `DATA_CONTRACT.md` §9 and
`portfolio/docs/PERFORMANCE.md` §9.4.

### 20.3 Divergences from sections 1–19, and why

| Planned | Built | Why |
|---|---|---|
| §4 "synthetic stock number" | **Vehicle code, not captioned as a stock number** | `dim_vehicle` records no stock number. The model contains none, so publishing `vehicle_code` under that caption would be inventing a DMS field. The column is labelled as the unit identifier and the limitation is stated on the page. |
| §4 "acquisition date" | **Days in inventory at sale** | `dim_vehicle` records no acquisition date either. `fact_vehicle_sale.days_in_inventory_at_sale` is the modelled fact, it answers the same question a reader asks, and it is what `KPI-INV-007` is built from. |
| §12 back-gross reconciliation, product eligibility, product-adjustment validity | **Absent, not shown as passing** | All three now have data behind them — `DASH.6` built the F&I model, and `RECON-FI-001`, `RECON-FI-ELIGIBILITY` and `RECON-FI-ADJUSTMENT-CAP` verify exactly these three properties in the warehouse. **Surfacing them on the jacket is `DASH.7`'s work and was deliberately not done here.** A check that cannot fail is not a check, and a green row for one is worse than no row: it asserts that something was verified when nothing was. The checklist says why they are absent. |
| §12 "chunk hash matches manifest" for source lineage | **Dataset version, contract fingerprint and as-of date** | The generated tree carries no per-chunk hash the runtime can read; the contract SHA-256 and dataset version are what the manifest publishes, and they identify the export the figures came from just as specifically. |
| §13 "the source reporting view" as page copy | **Resolved from the manifest at build time** | The console names no database object in its own source — `dashboard-boundaries.test.ts` fails the build over one — because a view name in dashboard code is how somebody starts writing a query. The name is looked up in the list of views the exporter published, so the lineage states what was actually read and cannot drift. |
| §14 "reconciliation state chip" | **Built, wording "All checks passed" / "N checks need review"** | As specified. It reports §12's outcome, and the corrupted-fixture tests prove the second wording is reachable. |
| §17 print: "not printed … dashboard navigation" | **Built, and it needed three attributes that did not exist** | `data-arpi-print="omit"` now marks the site header, the site footer and the console navigation. The first attempt put it on the `<Section>` primitive, which takes a declared prop list and silently dropped it; the paper recap printed its navigation until the Playwright print assertion caught it. `dashboard-boundaries.test.ts` now fails the build if the attribute is placed on a component that would swallow it. |
| §19 "multiple products incl. a cancelled contract" | **Now testable; still not tested here** | `DASH.6` built `warehouse.fact_finance_product_sale` and `warehouse.fact_finance_product_adjustment`, and the development profile contains deals matching this case. The row remains a `DASH.7` obligation, because the thing it tests is a **jacket surface** that does not exist. |

### 20.4 Evidence

- **Both identities hold on all 650 deals**, asserted twice and differently: in SQL, over the view
  (`test_the_front_gross_identity_holds_on_every_deal`, `test_the_total_gross_identity_holds_on_every_deal`),
  and in the console, which recomputes them from the components it displays rather than reading a
  flag. The export deliberately publishes no verification flag, so the second check cannot degenerate
  into reading the first one's answer.
- **The identity assertions can fail.** Four seeded defects prove it: a one-cent mutation of the
  front gross and of the total gross, applied in SQL inside a rolled-back transaction, and the same
  two applied to a corrupted partition table that the console then renders. The console tests assert
  the failure surfaces in words, that the checklist raises it for review, and that the figures are
  still shown as exported rather than a broken deal being hidden.
- **Trade variance is outside the front-gross formula**, asserted three ways: the view test folds it
  in and requires the identity to break; the unit test pins the five calculation lines by name; the
  browser test reads the sentence that says so.
- **No fan-out across seven joins.** 650 view rows against 650 fact rows, plus direct assertions that
  at most one lead and at most one appointment link to a sale — the only two joins that could widen
  the grain.
- **Privacy.** No prohibited column name, no `*_name` column but the two that name a thing, every
  staff code matching the synthetic `EMP-` shape, every synthetic VIN matching the ADR-0005 shape,
  and a value-level scan over every string in all 650 jackets for anything shaped like an email,
  telephone number, SSN, payment card or street address.

---

## 21. As-built (`DASH.7`)

`DASH.4` built the jacket and left three of its own checks absent, because the data behind them had
no surface. `DASH.7` builds the surface. Section 20 is unchanged: what this increment did is recorded
here beside it.

### 21.1 What was added

| Piece | Where |
|---|---|
| Reporting view | [`sql/05_reporting/43_vw_deal_jacket.sql`](../../sql/05_reporting/43_vw_deal_jacket.sql) — **13 columns added, one corrected**; the product rollup pre-aggregated to one row per `sale_key` so the join cannot fan out |
| Second view promoted | `reporting.vw_deal_product_detail` → the `deal-product-detail` dataset, 1,012 rows, 18 partitions, 363 kB generated |
| Export contract | `_DEAL_JACKET` in [`src/arpi/dashboard/contract.py`](../../src/arpi/dashboard/contract.py) — **65 → 79 columns**; `_DEAL_PRODUCT_DETAIL` added |
| Partition module | [`portfolio/src/lib/dashboard/fi-chunks.ts`](../../portfolio/src/lib/dashboard/fi-chunks.ts) — the product partitions, on the same store × sale-month key |
| View model | `buildProducts`, `buildBackGross` and an expanded `FinanceSection` in [`portfolio/src/lib/dashboard/deal-jacket.ts`](../../portfolio/src/lib/dashboard/deal-jacket.ts) |
| Sections | `ProductSectionBlock` and `BackGrossSectionBlock` in [`portfolio/src/components/dashboard/deal-jacket-sections.tsx`](../../portfolio/src/components/dashboard/deal-jacket-sections.tsx) |
| Page tests | [`portfolio/tests/unit/dashboard-deal-jacket.test.tsx`](../../portfolio/tests/unit/dashboard-deal-jacket.test.tsx) — 43 → 59 |

### 21.2 The three absent checks are now real, and each can fail

`DASH.4` wrote that "a check that cannot fail is not a check, and a green row for one is worse than
no row". The checklist is therefore **five checks → eight**, in this order:

| Check | What it recomputes | How it can fail |
|---|---|---|
| `back-gross-reconciliation` | `finance_reserve_gross + Σ original_product_gross + other_fi_income` against the deal row's own `back_end_gross`, from the DISPLAYED components | A residual is stated with its sign and the figures are shown as exported rather than adjusted to agree |
| `product-eligibility` | Every contract names a governed `ELIG-*` rule and sits on a retail structure | A product on a wholesale disposal, or a contract with no rule, raises the check |
| `product-adjustment-validity` | Every contract's net gross recomputes from original less cumulative adjustments, and sits inside `[0, original]` | A net above its original or below zero raises the check |

All three recompute from the page's own components. None reads a stored flag, and the export
publishes none to read: `deal-jacket` deliberately carries no column containing `verified` or
`reconcil`, which `tests/unit/test_export_dashboard_dataset.py` asserts.

### 21.3 Divergences from sections 1–19, and why

| Planned | Built | Why |
|---|---|---|
| §8 four contract statuses (Active / Cancelled / Charged back / Reinstated) | **Three: Active / Adjusted / Cancelled** | "Charged back" and "Reinstated" are EVENT types, not contract states. A contract charged back and partly reinstated is in neither, and forcing it into one would be a claim the event history contradicts. `Cancelled` is claimed only when nothing remains: a partial cancellation is a reduction, and calling it cancelled overstates it. |
| §8 "cancellation amount · chargeback amount" as separate columns | **One `adjustmentTotal` plus an event count** | Splitting the columns per event type on a per-contract row would publish six mostly-empty columns to show one number. The event types are analysed on `/dashboard/fi`, at the grain where the distinction is the point. |
| §7 lender "Not applicable for cash" | **Three distinguishable absences, each with its reason** | "Not applicable" is a category, not an explanation. A disposal has no consumer; a cash deal financed nothing; a financed deal with no lender recorded is a third thing. A reader who sees one phrase for all three cannot tell which applies. |
| §20.3 "§19 multiple products incl. a cancelled contract — still not tested" | **Tested, over the whole population** | The obligation is discharged: every contract's status, net arithmetic and `[0, original]` bound are asserted on all 650 deals rather than on one fixture. |
| `DASH.4` limitation "back-end gross is aggregate" | **Removed, because it became false** | The jacket itemizes it. What replaces it is the statement the itemization makes necessary: the total is on the deal-date basis and is never rewritten when a cancellation posts later. |
| `DASH.4` limitation "no lender … exists anywhere in ARPI" | **Removed, because it became false** | A limitation that is no longer true is worse than no limitation: it tells a reader the page is hiding something it is in fact showing. Replaced by what remains true — the lender is a fictional finance source recorded as an assignment only, and no credit application, decision, tier, stipulation or adverse-action record exists in ARPI. |

### 21.4 Evidence

- **The back-gross identity holds on all 650 deals**, recomputed on the page from the displayed
  currency strings rather than from an unformatted value — an arithmetic check reading the raw figure
  could pass while the page rendered something else.
- **The itemization sums to the deal row's own rollup on all 650 deals.** The lines come from
  `deal-product-detail` and the rollup from `deal-jacket`: two datasets, two partitions, one grain
  apart, and nothing in the module derives either from the other.
- **No product exists on a transaction with no consumer.** Asserted over the population, which is
  what makes the corrected `finance_structure` load-bearing rather than cosmetic.
- **Every net gross sits inside `[0, original]`,** and every `Cancelled` contract has a net of
  exactly zero.
- **The reconciliation can fail.** The panel is driven with a deliberately broken section and the
  test requires "does not reconcile", the residual, and the sentence saying the figures are shown
  unchanged rather than adjusted to agree.
