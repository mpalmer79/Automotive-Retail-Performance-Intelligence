# `DASH.7` staff-level review — F&I performance dashboard and expanded Deal Jacket

**Status:** written after implementation, against the code and the measurements.
**Increment:** `DASH.7-01`, `DASH.7-02`, `DASH.7-03`.
**Parents:** [DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) ·
[DATA_CONTRACT.md](../dashboard/DATA_CONTRACT.md) ·
[DEAL_JACKET_SPEC.md](../dashboard/DEAL_JACKET_SPEC.md) ·
[PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md)

Every answer below names its implementation and its test. Where an answer is qualified,
the qualification is stated first and is not softened. Three answers are qualified, and
four record a defect this increment found and fixed rather than a property it merely
maintained.

---

## A. Export and data boundary

**A1. `/dashboard/fi` reads only governed exported F&I data. Yes.**
The route imports `fi-data.ts` and `fi-chunks.ts`, and those are the only modules on its
graph that touch the generated tree. Nothing on the route reads a file at runtime, opens a
connection, or calls an API.
*Implementation:* `portfolio/src/app/dashboard/fi/page.tsx` → `buildFi(filters)` →
`fiSummaryRows()`, `fiAdjustmentRows()`, `penetrationChunkFile()`.
*Test:* `dashboard-boundaries.test.ts` asserts the generated tree has exactly eight
declared importers and names them; a ninth fails the build.

**A2. The four datasets use the documented physical grains. Yes.**
`fi-summary` store × sale date × finance manager; `fi-product-penetration` the same plus
product category; `fi-adjustment-summary` store × **adjustment date** × manager × category
× adjustment type; `deal-product-detail` one row per product contract.
*Implementation:* `_FI_SUMMARY`, `_FI_PRODUCT_PENETRATION`, `_FI_ADJUSTMENT_SUMMARY`,
`_DEAL_PRODUCT_DETAIL` in `src/arpi/dashboard/contract.py`.
*Test:* `test_export_dashboard_dataset.py::TestSeededFiExportDefects` seeds a repeated
business key into `fi-summary`, `fi-product-penetration` and `deal-product-detail` and
requires each to be refused; `test_fi_reporting_views.py` asserts the declared grain
against the view's own `COMMENT`.

**A3. `/dashboard` does not import deal-product detail. Yes.**
`deal-product-detail` enters the graph only through `fi-chunks.ts`, which the Executive
Overview does not import. `chunks.ts` and `data.ts` are unchanged by this increment.
*Test:* `dashboard-boundaries.test.ts`, asserted in both directions.

**A4. `/dashboard/deals` remains a compact deal index. Yes.**
Unchanged by this increment. It reads `deal-chunks.ts` (221,386 B) and imports neither
`jacket-chunks.ts` (568,225 B) nor `fi-chunks.ts`.
*Test:* `dashboard-boundaries.test.ts` asserts `jacket-chunks` has exactly one importer and
that neither deal route mentions it.

**A5. The Deal Jacket resolves only the product detail it needs. Yes.**
`deal-product-detail` partitions on store × **sale** month — the same key `deal-jacket`
uses — so opening one jacket resolves one partition, and it is the partition the route has
already opened for that deal. A contract's own adjustment dates are never the partition key.
*Implementation:* `productDetailChunkFile()` in `fi-chunks.ts`.
*Test:* `dashboard-executive.test.tsx` compares every partition table against the manifest
chunk index in both directions.

**A6. No runtime database or API path was introduced. Yes.**
No route handler, no `fetch`, no `process.cwd()` read. Every dataset is a static import
resolved by the output tracer as a graph edge.
*Test:* `dashboard-boundaries.test.ts`; and the whole Playwright suite runs against a
production build with no database present.

**A7 (qualified). Was any reporting view changed? Yes — one, and it was a defect fix.**
`vw_deal_jacket` gained thirteen columns and one corrected one. The four F&I views were
promoted unchanged. *Qualification:* the increment's own plan said "promote"; extending the
jacket view was not anticipated, and it is recorded as a divergence in
`DATA_CONTRACT.md` §14 and `DEAL_JACKET_SPEC.md` §21.3. The reason is that the F&I
itemization and the back-gross panel cannot be assembled from a view that publishes only a
back-gross total, and reconstructing the split in TypeScript is the second calculation
engine ADR-0013 condition 2 forbids.
*Test:* `test_no_exported_fi_column_is_undeclared_by_the_view` asserts each F&I dataset is a
strict SUBSET of its view, checked against `source_column` so the deliberate
`finance_manager_id` → `finance_manager_code` rename is not mistaken for an invention.

---

## B. Date bases and adjustments

**B1. Deal-date back gross stays distinct from as-of retained gross. Yes.**
`back_end_gross_deal_date` and `net_product_gross_as_of` are separate exported columns, and
the page renders both with their basis labels. The deal-date figure is never rewritten.
*Implementation:* `FiProduction` carries both; `backGrossIdentityHolds` uses the deal-date
figure only.
*Test:* `dashboard-fi.test.tsx` asserts `netProductGrossAsOf < originalProductGross` on the
committed profile — so the two are demonstrably different numbers, not the same number
labelled twice.

**B2. A future adjustment cannot enter an earlier as-of calculation. Yes.**
`net_product_gross_as_of` is computed in SQL against the export's own as-of date, not
against a clock. The console never recomputes it.
*Implementation:* `reporting.vw_fi_summary`, `reporting.vw_deal_product_detail`.
*Test:* `test_fi_reporting_views.py` asserts the as-of arithmetic; the page's as-of date is
asserted equal to `dashboardManifest.asOfDate` rather than to `new Date()`.

**B3. An August chargeback stays an August adjustment-period event. Yes.**
`fi-adjustment-summary` carries `adjustment_date` and deliberately does **not** carry
`sale_date`, so the parent sale's date is not available to restate it by.
*Test:* `dashboard-fi.test.tsx` asserts `sale_date` is absent from every adjustment row, and
that selecting two different months yields different adjustment totals.

**B4. The original June deal is not retroactively restated. Yes.**
Nothing writes back to `fi-summary`, and the deal-date columns are read as exported.
*Test:* the back-gross identity holds on the whole window using deal-date components only;
substituting the retained figure would break it on every adjusted population, which is
stated in the module's own comment as the reason not to.

**B5. Stored `back_end_gross` is never reconciled using net product gross. Yes.**
`backGrossIdentityHolds` sums `financeReserveGross + originalProductGross` and nothing else.
*Test:* `dashboard-fi.test.tsx` asserts the identity holds AND that the retained figure is
strictly smaller, so a future edit substituting one for the other fails on both.

**B6. Are the three bases ever blended? No, and the datasets enforce it.**
They are three datasets, not three column groups, and the F&I module never joins them.
*Test:* `TestFiContract::test_the_adjustment_dataset_is_on_its_own_date_basis` and
`test_the_production_datasets_are_not_on_the_adjustment_basis`.

---

## C. Penetration and eligibility

**C1. The GAP denominator is financed eligible deals. Yes — 388, not 558.**
*Test:* `dashboard-fi.test.tsx` pins `gap_penetration` at `200 / 388` as literals and
reconciles it against the manifest.

**C2. The Lease Wear denominator is eligible lease deals. Yes — 54.**
*Test:* `dashboard-fi.test.tsx` asserts Lease Wear's eligible population is strictly smaller
than total retail units.

**C3. The numerator counts distinct attached deals, not contracts. Yes.**
Visible in the committed data rather than asserted in the abstract: Other Aftermarket
Product carries 53 attached deals against 60 contracts.
*Test:* `dashboard-fi.test.tsx` requires at least one category to have more contracts than
attached deals — so if the data ever stopped exercising the rule, the test says so rather
than passing vacuously — and asserts `attached ≤ contracts` and `attached ≤ eligible` on
every category.

**C4. A filter scopes numerator and denominator together. Yes, by construction.**
Both sides are exported per store × month × manager × category, so any filter selects rows
and both sides move with them.
*Test:* `dashboard-fi.test.tsx` sums each store's numerator and denominator separately and
requires them to equal the group's, per category.

**C5. Prior-period penetration is recomputed from prior components. Yes.**
`buildCategories` accumulates the comparison rows independently and divides once.
*Test:* the point-change test recomputes `current − prior` from the two published values.

**C6. Percentage-point differences are converted exactly once. Yes — after a defect.**
*This was wrong and is fixed.* The selector pre-multiplied a proportion difference by 100
and `formatPointsDifference` multiplied again, so a 3.5-point move rendered as
`+350.9 percentage points`. Every unit test passed while it was wrong: both penetration
figures were correct and only their difference was absurd.
*Implementation:* `penetrationChange` now returns the proportion difference and the shared
formatter owns the one conversion; the field was renamed from `changeInPoints` so the type
no longer invites the mistake.
*Test:* `dashboard-fi.test.tsx` pins `formatPointsDifference({units: 35000n, scale: 6})` at
exactly `'+3.5 percentage points'`, and computes the wrong answer deliberately to show the
two are visibly different.

**C7. No product category maps to multiple eligibility rules. Yes.**
`eligibility_rule_id` is a column on the penetration row, and the ten governed categories
map onto five rules with each category resolving to exactly one.
*Test:* `test_fi_reporting_views.py` asserts the mapping is a function; the console renders
the rule id on every row so a reader can check it.

**C8. A category with no eligible deals renders an honest absence, not 0%. Yes.**
`FiRatio.value` is `null` when the denominator is zero, and `emptyReason` is
`'no-eligible-deals'`; the page renders "No eligible deals".
*Test:* `dashboard-fi.test.tsx` drives the narrowest available slice and asserts the null
state; a separate test asserts that an empty selection empties **both** sides rather than
only the numerator, because a numerator that emptied against a group denominator would
publish a confident 0%.

---

## D. Finance-manager and sample semantics

**D1. Manager penetration uses that manager's own eligible deals. Yes.**
The penetration dataset is grained by manager, so the eligible denominator is per manager
and is never the store's.
*Test:* `dashboard-fi.test.tsx` scopes to one manager and asserts the production totals
equal that manager's row.

**D2. A below-minimum-sample ratio cannot render. Yes.**
`meetsMinimumSample` is false below the exported floor and the component renders
"Insufficient sample (n = X)" with the counts and no ratio.
*Test:* `dashboard-fi.test.tsx` asserts `isPublishable` is false and the denominator is
below the floor on every such row; the browser suite asserts the rendered wording.

**D3. Manager rows are not ranked. Yes.**
Ordered by store, then synthetic code, unstaffed last.
*Test:* three, at three layers. The contract test forbids a rank-like column name and a
sort key matching a performance measure; the unit test recomputes the neutral order and
requires the rendered order to equal it; the browser test sweeps the rendered page for
"top performer", "ranked", "#1", "winner" and six more.

**D4. Synthetic employee identifiers only. Yes.**
`finance_manager_code` is `EMP-#####`, nullable, and no name column exists on any F&I
dataset.
*Test:* `TestFiContract::test_the_manager_identifier_is_a_synthetic_code_and_nullable`.

**D5. No causal "the manager drove performance" language. Yes.**
*Test:* `dashboard-fi.test.tsx` sweeps every string in the view model for "because of",
"caused by", "driven by", "due to the", "as a result of". The page states the opposite
explicitly: a manager's figures inherit the store's vehicle, structure and eligibility mix,
so a difference between two rows is not a difference in skill.

**D6. The URL uses one canonical parameter. Yes — `employee=`.**
*Qualification:* `INFORMATION_ARCHITECTURE.md` §3 carried a stale example reading
`manager=EMP-#####`. The as-built has always been `employee=`; the document was wrong and
is corrected in this increment, with the reason recorded: the console has one filter
grammar and one parameter for a person.
*Test:* `dashboard-fi.test.tsx` asserts `FI_SUPPORT.employee.support === 'applied'` and
scopes by `employee`.

**D7. `null` manager means what? Nobody was on the F&I desk.**
A real population of real deliveries, never "manager unknown". Rendered as "No finance
manager credited", ordered last.
*Test:* the contract test requires the column to be nullable; the unit test asserts the
label does not contain "unknown".

---

## E. Deal Jacket F&I

**E1. Lender and lender classification render correctly. Yes.**
Code, name, category and program tier, all fictional, with the tier labelled as classifying
the lender's program rather than the customer.
*Test:* `dashboard-deal-jacket.test.tsx` finds a financed deal with a lender and asserts all
four; the browser suite reads them off the rendered page.

**E2. A cash deal shows no lender and a $0.00 reserve. Yes, and it says which absence.**
Three absences are distinguishable — a disposal has no consumer, a cash deal financed
nothing, a financed deal may have no lender recorded — and the jacket states which applies.
`$0.00` is a governed zero: a cash deal genuinely earns no reserve.
*Test:* `dashboard-deal-jacket.test.tsx` asserts the cash case and the wholesale case
produce different absence statements.

**E3. One row per contract. Yes.**
*Test:* the itemization sums to the deal row's own rollup on all 650 deals — two datasets,
one grain apart, neither derived from the other.

**E4. Original product gross is distinct from net. Yes.**
Separate columns, separately labelled, with the as-of date on the retained one.
*Test:* every contract's net is recomputed from original less cumulative adjustments and
required to sit inside `[0, original]`.

**E5. All adjustment types affecting net gross are represented. Yes.**
Cancellation, Chargeback, Reinstatement and Approved Adjustment, all four on
`/dashboard/fi`. *Qualification:* the jacket shows each contract's **cumulative**
adjustment and event count rather than itemizing the events, and the plan's per-type
columns were not built. Splitting per type on a per-contract row would publish six mostly
empty columns to show one number; the event types are analysed on `/dashboard/fi`, at the
grain where the distinction is the point. Recorded in `DEAL_JACKET_SPEC.md` §21.3.

**E6. A product net gross can visibly fail by one cent. Yes.**
*Test:* `TestSeededFiExportDefects::test_product_detail_a_one_cent_gross_mutation_is_caught`
mutates `original_product_gross` by `0.01`, restamps the hash, and requires the production
`check_export` to refuse it.

**E7. Back-gross reconciliation can visibly fail. Yes.**
*Test:* `dashboard-deal-jacket.test.tsx` drives `BackGrossSectionBlock` with a deliberately
broken section and requires "does not reconcile", the residual, and the sentence saying the
figures are shown unchanged rather than adjusted to agree.

**E8. The eligibility check can actually fail. Yes.**
It is computed from the contracts on the deal — a contract with no governed rule, or one on
a non-retail structure, raises it. It is not a stored flag: the export publishes none, and
`TestFiContract` asserts `deal-jacket` carries no column containing "verified" or
"reconcil".

**E9. The adjustment-validity check can actually fail. Yes.**
It recomputes each net from its own components and bounds it in `[0, original]`.
*Test:* the seeded corruption of `original_product_gross` breaks exactly this identity.

**E10. Failed checks stay visible and do not hide the figures. Yes.**
*Test:* the `DASH.4` corrupted-fixture block, still passing, asserts the figures are still
rendered as exported when a check fails.

**E11. Print carries the itemization and the reconciliation. Yes.**
Both new sections are inside the printed region; `data-arpi-print="omit"` marks the site
header, footer and console navigation only.
*Test:* the existing paper-recap assertion in `dashboard-deal-jacket.spec.ts` reads the
printed text.

**E12. 320px preserves the financial explanation. Yes.**
The product table becomes cards below `md`, and the reconciliation panel is a two-column
key-value list at every width.
*Test:* no horizontal page scroll from 320px to 1920px on both routes.

**E13 (defect). Was anything wrong on the jacket? Yes — 92 rows.**
`vw_deal_jacket` derived `finance_structure` with an inline `CASE` that had no branch for a
transaction with no consumer, so every wholesale and dealer-trade disposal was labelled
`Cash`. The view now calls `warehouse.fn_finance_structure`, publishes
`finance_structure_basis` naming the branch taken, and publishes `is_retail_structure`.
*Test:* `test_the_finance_structure_is_exactly_the_governed_derivation` compares against the
governed function and writes no mapping of its own — the previous version duplicated the
view's mapping and so agreed with it perfectly while both were wrong.
`test_no_disposal_is_labelled_cash` pins the defect directly and asserts the disposal
population is non-trivial so the check is not vacuous.

---

## F. Privacy and lending boundary

**F1–F9. No APR, monthly payment, buy rate, sell rate, rate spread, credit score, customer
income, credit decision, or PII. Yes, all nine.**
This is a property of the warehouse before it is a property of the boundary: none of them is
modelled, so none can be exported.
*Test:* `TestFiContract::test_no_consumer_credit_column_is_declared_anywhere` sweeps fifteen
tokens over **every** dataset in the contract, not only the F&I ones;
`dashboard-fi.test.tsx` sweeps the built view model on whole camelCase words; the browser
suite sweeps the rendered page for affirmative uses of each; and the exporter's own
prohibited-name tripwire scans every exported header.

**F10. All lender names are fictional. Yes.**
Ten invented institutions, `DQ-LND-002` closes the set, and `tests/unit/test_fi_privacy.py`
asserts no committed name collides with a real institution a reader would recognise.
*Governance:* `lender_name` is the one human-readable vendor name that crosses into the
public lane. The allowlist decision is recorded in `PRIVACY_AND_ETHICS.md` §7.0 with what it
is allowed to say and what it still may not.

**F11. No recommendation or menu-selling behaviour exists. Yes.**
No product is suggested, no price recommended, no customer targeted, no lender advised. The
model records what was **sold**, never what was offered and declined, so no closing rate is
computable from it at all.
*Test:* the browser suite sweeps for affirmative recommendation language and separately
asserts the four denials are present — because a page that simply never mentioned
benchmarks would pass the negative and still leave 40.7% looking judged against something.

**F12. Does a lender on the jacket imply a credit decision? No, and the page says so.**
The jacket's limitations state that the lender is a fictional finance source recorded as an
assignment only, with no credit application, decision, tier, stipulation or adverse-action
record anywhere in ARPI.
*Test:* `dashboard-deal-jacket.test.tsx` asserts the sentence is present and that the
`DASH.4` sentence it replaced — "no lender exists anywhere in ARPI", which became false — is
gone.

---

## G. Accessibility and performance

**G1. `/dashboard/fi` is axe-clean. Yes**, after a fix.
*This was wrong and is fixed.* Five horizontally-scrolling table containers were
unreachable by keyboard (axe `scrollable-region-focusable`, serious), so a keyboard-only
reader could see the first columns of a table and never the rest. Each is now focusable and
named as a region.
*Evidence:* axe-core sweep, 21 routes, zero critical or serious violations.

**G2. The Deal Jacket remains axe-clean. Yes** — same fix, same evidence.

**G3. No-JS content is complete. Yes.**
All eight sections render as complete HTML with scripting disabled, and the methodology is
inside the document rather than behind a click.
*Test:* `dashboard-fi.spec.ts` runs a `javaScriptEnabled: false` block section by section,
and asserts a query-string filter still scopes the page.

**G4. Scrollable containers are keyboard reachable. Yes** — see G1.

**G5. Route-owned client JavaScript is zero. Yes.**
164.2 kB on `/dashboard/fi`, the same figure every other console route reports. One client
island still — the filter bar — and `DASH.7` added none.
*Test:* `dashboard-boundaries.test.ts` asserts a single `'use client'` component in the
dashboard directory.

**G6. No chart library was introduced. Yes.**
None was needed and none would have been permitted: the smallest considered is two orders of
magnitude larger than the console's entire route-owned payload.

**G7. Performance is measured, not estimated. Yes.**
`portfolio/docs/PERFORMANCE.md` §9.6 records the route measurements, the data-lane byte
counts and the chunking decision they produced. The filtered measurement is the useful one:
narrowing to one category costs **4.8 kB less**, which is the cheapest available evidence
that the filter reaches the server rather than hiding rows in the browser.

---

## H. Power BI and governance

**H1. No `DASH.8` work exists. Yes.**
No `fact_inventory_accounting_snapshot`, no `dim_gl_account`, no
`fact_gl_control_balance`, no GL reconciliation, no accounting route, no `DASH.8` SQL, KPI
promotion or export dataset.

**H2. No TMDL file changed. Yes.** `git diff` touches no file under `powerbi/`.

**H3. Gate 2 remains CLOSED. Yes.** The semantic model binds none of the four F&I views and
none of the twenty-two `KPI-FNI-*` definitions.

**H4. Desktop real-engine validation remains PENDING. Yes.**

**H5. Fabric real-engine validation remains PENDING. Yes.**

**H6. Historical MVP baselines are unchanged. Yes.**
29 MVP KPIs, 28 MVP reporting views, 5 MVP facts, 8 MVP dimensions. The dashboard-program
lane is counted separately, which is what `DASHBOARD_LANE_SQL_FILES` exists to keep true.

**H7. Did the increment reverse a `DASH.6` governance decision? One, deliberately.**
`test_fi_reporting_views.py` asserted through `DASH.6` that **no** F&I view appeared in the
export contract. `DASH.7` owns the presentation surface, so that assertion is re-aimed
rather than deleted: it now asserts the exported set is **exactly** those four, in both
directions, so a fifth F&I view exported without an increment still fails a test.

---

## What this review found that the implementation had not

Four items, recorded because a review that finds nothing has not been performed.

1. **`deal-product-detail` carried no reconciliation total.** A one-cent mutation of
   `original_product_gross` on the largest deal-grain F&I dataset passed `--check` without a
   database. Three of the four datasets had a total re-derived from their committed bytes
   and the fourth did not. Two totals now close it, chosen to reconcile the itemization
   against the `fi-summary` rollup across two grains. A paired assertion requires every F&I
   dataset to carry at least one total.

2. **The finance-structure integration test duplicated the mapping it was checking**, so it
   agreed perfectly with a view that was wrong in the same way. It now calls the governed
   function.

3. **The percentage-point conversion was applied twice**, and no unit test could see it
   because both inputs were correct. Found by the browser suite reading the rendered text.

4. **Two Deal Jacket limitations had become false.** "Back-end gross is aggregate" and "no
   lender exists anywhere in ARPI" were true at `DASH.4` and are not now. A limitation that
   is no longer true is worse than no limitation: it tells a reader the page is hiding
   something it is in fact showing.
