# `UX.2B` — the revenue and vehicle operating workspaces, reviewed

What the increment produced, measured the same way and with the same tooling as
[`UX-2-BASELINE.md`](UX-2-BASELINE.md) and [`UX-2A-REVIEW.md`](UX-2A-REVIEW.md): a production
build (`next build`, `next start -p 3111`), Chromium, 1440 × 900 for desktop figures and 390 × 844
for mobile. The before-column of every table below was measured on the same harness, against the
same build, immediately before the first line of this increment was written. The harness was scratch
and was removed before merge.

Starting `main`: `3463fd5` — the merge of `UX.2A` (PR #60).

---

## 1. The headline

**Four of the five routes contained zero framed visualizations.** Not "too few", and not "the wrong
ones" — zero. `/dashboard/deals`, `/dashboard/deals/[saleId]`, `/dashboard/inventory` and
`/dashboard/fi` each held every figure a manager needed and drew none of them. The fifth,
`/dashboard/sales-gross`, had six and put the first one 2,752 px down.

| Route | Framed figures, before | After | Inside the first viewport, after |
|---|---:|---:|---:|
| `/dashboard/sales-gross` | 6 | **8** | 4 |
| `/dashboard/deals` | 0 | 0 — deliberately, see §5 | — |
| `/dashboard/deals/[saleId]` | **0** | **2** | 2 |
| `/dashboard/inventory` | **0** | **3** | 2 |
| `/dashboard/fi` | **0** | **4** | 2 |

And the documents they sat in were long. `/dashboard/inventory` was 11,543 px — thirteen screens —
to show one snapshot date.

| Route | Document height, before | After | Change |
|---|---:|---:|---:|
| `/dashboard/inventory` | 11,543 | **2,214** | **−80.8%** |
| `/dashboard/fi` | 6,614 | **2,628** | **−60.3%** |
| `/dashboard/deals` | 3,063 | **1,289** | **−57.9%** |
| `/dashboard/sales-gross` | 7,228 | **3,159** | **−56.3%** |
| `/dashboard/deals/[saleId]` | 5,806 | **3,861** | **−33.5%** |

---

## 2. Route by route, measured

Both prose definitions are the ones `UX-2-BASELINE.md` §1 fixed. `proseRepo` is the repository's own
collector — a rendered paragraph of eight words or more, outside `.sr-only` and outside a closed
`<details>`. `proseEye` is every rendered paragraph outside those, at any length. `proseUx1` includes
`.sr-only` and is recorded for continuity, never as a target: it is expected to rise wherever a
visualization is added, because every visualization adds an accessible summary that
[`ACCESSIBILITY.md`](../../portfolio/docs/ACCESSIBILITY.md) forbids deleting.

### 2.1 `/dashboard/sales-gross`

| Measure | Before | After | Change |
|---|---:|---:|---|
| Document height, desktop | 7,228 | **3,159** | −56.3% |
| Document height, mobile | 11,439 | 6,821 | −40.4% |
| First framed figure, desktop | 2,752 | **689** | −75.0% |
| First framed figure, mobile | 4,677 | 1,634 | −65.1% |
| Framed figures | 6 | 8 | — |
| Framed figures inside the first viewport | **0** | **4** | — |
| Data-driven visual regions | 0 | 9 (**4** inside the first viewport) | — |
| Visible prose, `proseRepo` | 891 | **405** | **−54.5%** |
| Visible prose, `proseEye` | 1,029 | **548** | **−46.7%** |
| `proseUx1` | 1,361 | 1,192 | −12.4% |
| Route cost | 428.7 kB | 430.2 kB | +1.5 kB |
| Visible `summary` lines reading "How is this calculated?" | 9 | **0** | — |
| Client islands | 1 | 1 | unchanged |

### 2.2 `/dashboard/deals`

| Measure | Before | After | Change |
|---|---:|---:|---|
| Document height, desktop | 3,063 | **1,289** | −57.9% |
| Document height, mobile | 8,583 | 8,382 | −2.3% |
| Framed figures | 0 | 0 | unchanged, and deliberate — §5 |
| Default table columns | 14 | **10** | four more under `?detail=1` |
| Visible prose, `proseRepo` | 128 | 103 | −19.5% |
| Visible prose, `proseEye` | 136 | 116 | −14.7% |
| Route cost | 419.1 kB | 411.7 kB | −7.4 kB |

The prose fell by a fifth rather than by a third, and §11 is explicit that a route which is
already efficient should not have a percentage forced on it. At 128 words this was the
leanest surface in the console — a seventh of the Deal Jacket's and a seventh of Sales &
Gross's — and what was wrong with it was density, not verbosity.

The mobile height barely moved and that is correct: below 1280 px the route renders stacked cards
rather than the table, twenty-five of them, and no layout change to a table affects a page that is
not showing one. The card markup was not redesigned.

### 2.3 `/dashboard/deals/[saleId]`

| Measure | Before | After | Change |
|---|---:|---:|---|
| Document height, desktop | 5,806 | **3,861** | −33.5% |
| Document height, mobile | 9,944 | 7,855 | −21.0% |
| First framed figure | **none on the route** | 515 | — |
| Framed figures | **0** | **2** | — |
| Data-driven visual regions | 0 | 3 (**3** inside the first viewport) | — |
| Visible prose, `proseRepo` | 616 | **314** | **−49.0%** |
| Visible prose, `proseEye` | 638 | **332** | **−48.0%** |
| Route cost | 407.2 kB | 411.5 kB | +4.3 kB |

### 2.4 `/dashboard/inventory`

| Measure | Before | After | Change |
|---|---:|---:|---|
| Document height, desktop | **11,543** | **2,214** | **−80.8%** |
| Document height, mobile | 12,218 | **3,668** | **−70.0%** |
| First framed figure | **none on the route** | 810 | — |
| Framed figures | **0** | **3** | — |
| Data-driven visual regions | 0 | 4 (**3** inside the first viewport) | — |
| Visible prose, `proseRepo` | 131 | 314 | **+139.7%** |
| Visible prose, `proseEye` | 137 | 333 | **+143.1%** |
| Route cost | 435.1 kB | **496.3 kB** | **+61.2 kB** |

**Two of those numbers went the wrong way and both are stated rather than buried.**

*The prose rose because the baseline was not prose-efficient, it was prose-absent.* The route was
11,543 px of `<table>` and `<dl>`, and its 131 words were the four sentences in the control band.
Nothing that now appears is decoration: the synthetic-estimate caveat on the position map's axis,
the aged-threshold statement on the ramp legend, the coverage sentence naming which 234 of 250 units
the plot describes, and the "an observed change, not a repricing decision" note under the price
bands. Every one of them is a caveat whose removal would let a reader misread a figure, and §11
says not to remove a required caveat to hit a number. The route it belongs to lost four fifths of
its height.

*The route cost rose because §7 asked for a keyboard-reachable scatter and this one has 234
focusable marks.* Every unit on the plot is a real `<a>` with a drill-through `href` and an
accessible name carrying its exact figures, which is what "keyboard/focus inspection", "exact
textual point information" and "selected-unit drill-through" require when read as a reader would.
Two reductions were made and measured: the plot no longer renders its own copy of the unit table
(−34 kB) and each mark's accessible name was shortened to the identity and the three plotted values
(−3 kB, most of the repeated wording having already been squeezed out by compression). What remains
is the per-unit data itself — an identifier, a vehicle, three values and a URL, 234 times — which is
irreducible while every unit is focusable. `DASH.13-02` sets the payload budgets; this is recorded so that increment inherits a
figure rather than a surprise.

### 2.5 `/dashboard/fi`

| Measure | Before | After | Change |
|---|---:|---:|---|
| Document height, desktop | 6,614 | **2,628** | −60.3% |
| Document height, mobile | 9,016 | 4,736 | −47.5% |
| First framed figure | **none on the route** | 823 | — |
| Framed figures | **0** | **4** | — |
| Data-driven visual regions | 0 | 6 (**4** inside the first viewport) | — |
| Visible prose, `proseRepo` | 700 | **344** | **−50.9%** |
| Visible prose, `proseEye` | 767 | **376** | **−51.0%** |
| `proseUx1` | 1,362 | 1,482 | +8.8% |
| Route cost | 410.9 kB | 430.1 kB | +19.2 kB |

`proseUx1` rose by 120 words, which is the four new accessible chart summaries and their table
captions. That is the metric doing what `UX-2-BASELINE.md` predicted it would, and why it is not a
target.

---

## 3. New visuals

| Route | Visual | Primitive | What it draws, and from what |
|---|---|---|---|
| Sales & Gross | Switchable operating trend | `MetricSwitch` + `TrendChart` | Units, total gross and total GPRU over the period's own buckets. All three series are in the served HTML; the switch chooses which is displayed. |
| Sales & Gross | New-and-used composition | `GrossComposition` × 2 | Units and gross over the same two segments, each against its own governed total. The pairing is the finding. |
| Sales & Gross | Store contribution | `GroupedMeasureBars` | Units and total gross per store, each scaled to its own largest. Mark from the business code. |
| Sales & Gross | Gross-change waterfall, promoted | `BridgeChart` | Eight of twelve columns, one row below the rail. Same `buildBridge` output as before. |
| Sales & Gross | Front-and-back composition | `GrossComposition` | Replaces two large figures with a part-to-whole bar against the governed total. |
| Sales & Gross | Discount distribution | `DistributionStrip` | Per-deal discount from original asking, counted into bands, reconciled against the governed period total. |
| Deal Jacket | Front-gross waterfall | `BridgeChart` | `frontGross.lines` — sale price, acquisition, recon, pack, result — as anchors and falling steps. |
| Deal Jacket | Reserve-and-product composition | `GrossComposition` | Against the published back-end gross, so a failed reconciliation shows as a bar that does not fill. |
| Inventory | Age and capital | `InventoryAgeStack` | Two tracks over the five governed buckets: units, and the capital standing in them. |
| Inventory | **Position map** | `PositionMap` (new) | Days in stock against price to market, mark area = inventory investment, mark colour = the age ramp. |
| Inventory | Price movement | `DistributionStrip` | `asking_price_change` counted into six signed bands. |
| F&I | Reserve-and-product composition | `GrossComposition` | Against the published back-end gross. |
| F&I | Structure mix | `GrossComposition` | Cash, finance and lease deal counts against retail units. |
| F&I | Penetration by category | `GroupedMeasureBars` | Each category against its own eligible population, with `attached/eligible` printed on every row. |
| F&I | Category economics | `GroupedMeasureBars` | Original gross and gross per contract, each own-scaled. |
| F&I | Adjustment amount by posting month | `TrendChart` | Adjustment-period basis only. Falls back to a figure when the period holds one posting month. |

**Three new primitives**, in `components/dashboard/workspace-visuals.tsx`:

- `MetricSwitch` — **moved** from `exec-visuals.tsx`, under that file's own recorded rule that a
  primitive rendered by a second route moves out of it. Now rendered by two routes.
- `GroupedMeasureBars` — several measures across the same categories, each scaled to its own
  maximum, every row labelled.
- `PositionMap` — two unit-grain measures against each other with a third as mark area.

Measured client JavaScript owned by all three: **zero bytes**. They are server components and the
only interactive control among them is a radio group with no script behind it.

`StoreMeasureBars` and `FunnelChart` did **not** move. Both are still rendered by one route, and
`StoreMeasureBars` takes a whole `MetricResult` because the Executive's structural-absence rule
needs it — the revenue routes carry `Figure`, a different resolved shape.

---

## 4. New interactions

Every one is a link, a form or CSS. No route gained a client island; all five still have exactly one,
the filter bar, which receives option lists and no data.

| Interaction | Route | Mechanism | URL-addressable |
|---|---|---|---|
| Trend measure switch | Sales & Gross | Radio group + CSS, no JavaScript | No — §4.1 below |
| Detail-mode columns | Deal Explorer | `?detail=1`, an anchor | **Yes** |
| Unit selection from the plot | Inventory | `?unit=…`, an anchor per mark | **Yes** |
| Skip the unit markers | Inventory | In-page anchor, `sr-only` until focused | — |
| Calculation disclosure | Deal Jacket | `<details>` | No |
| Full-table disclosures | F&I | `<details>` | No |

**§4.1 Why the metric switch has no URL state, stated rather than assumed.**
`INFORMATION_ARCHITECTURE.md` §6 defines one filter grammar shared by every operating route, and
every parameter in it changes *which rows* a figure is computed from. The switch changes neither the
population nor the arithmetic — all three series are in the served HTML simultaneously — and a
fourteenth parameter that survived a navigation to `/dashboard/inventory`, where it means nothing,
would be a presentation preference wearing a console-wide filter's clothes. A reader sharing a link
shares all three panels.

Detail mode *is* in the URL, and the distinction is the same one: it is a page-local parameter read
from the raw record exactly as `q`, `sort` and `page` already are, not a fourteenth entry in the
grammar. It is shareable because a reviewer asking a colleague to look at the lead-source column
should be able to send them the lead-source column.

---

## 5. Data-grain decisions, and the visuals refused

**Built, because the current grain supports every dimension:**

- **The inventory position map.** Checked column by column before it was written. `days_in_stock`,
  `price_to_market_ratio` and `inventory_investment` are all published on the `inventory-units` row
  being plotted. Nothing is imputed, no fourth measure is derived, no score is formed, and the 16 of
  250 units with no synthetic estimate are **absent from the plot** rather than drawn at zero — with
  their count stated under it and on the rail as coverage.
- **The per-deal discount distribution.** `deal-explorer` publishes `original_asking_price` and
  `sale_price` at deal grain; `sales-gross-trend` publishes `discount_from_original_total` at
  store-day grain, and the second is the sum of the first. Subtracting one exported column from
  another on the same row is arithmetic the reporting view already owns, and counting the results
  into ranges is a selection. **The identity is verified and printed**, not assumed: the summed
  per-deal discounts are compared against the governed period total and the result is rendered in
  words. Under a condition filter the two describe different populations — the governed total carries
  no condition split — and the page says the identity is not checkable rather than printing a
  meaningless residual.
- **Adjustment amount by posting month.** `fi-adjustment-summary` carries `adjustment_date`.
  Grouping exported rows by an exported date column and summing an additive column is a selection.

**Refused:**

- **A per-unit price track over the six exported months** (§6D). The Inventory route decodes *one*
  month's partitions per request — a deliberate cost decision that took the route from eighteen
  decoded partitions to three. A multi-month line per unit would need five more partitions per store
  to draw one chart. What the current grain publishes is `asking_price_change`, one observation per
  unit against the prior month end, so §6D is answered with a **distribution** of those changes,
  which is the honest form for one observation.
- **A per-sale-type gross split** on Sales & Gross. The export publishes per-sale-type unit counts
  and no per-sale-type gross. Apportioning the retail total across sale types would invent a measure
  the reporting layer does not own. The module shows counts and says so.
- **Any chart on the Deal Explorer.** A chart over the twenty-five rows currently on screen would
  describe the page rather than the population; a chart over the whole population is what
  `/dashboard/sales-gross` is. §16 asks the route to feel like a transaction workspace, and what was
  wrong with it was density and hierarchy, not a missing picture.
- **A reserve-versus-product split on the Executive's gross module.** Unchanged from `UX.2A` and
  restated because `UX.2B` built that split twice elsewhere: those columns belong to `fi-summary`,
  which the Executive may not open, and they arrive on their own date bases.

**No new reporting view, no new export, no new dataset and no new grain was added.** Three additive
view-model changes were made and each is a selection or a division over rows already read:
`MixRow.unitsExact` (a count already present, as an exact value), `BucketProfile.investmentShare`
and `InventorySummary.meanAskingPrice`/`estimateCoverage`/`priceMovement`,
`FiView.adjustmentMonths`, `CalculationLine.signedAmount` and `BackGrossSection.exact`.

---

## 6. Three defects this increment found in existing code

Recorded because each was shipped, not hypothetical, and each was caught by looking at the rendered
page rather than at the diff.

1. **`BridgeChart` drew every anchor as a 0.5% sliver.** An anchor's `base` and `top` were the same
   number, so `Math.max(base, top) − Math.min(base, top)` was zero. The two totals a waterfall exists
   to connect were the two marks a reader could not see. Cosmetic while the chart was the last band
   of a 7,228 px document; not cosmetic once §3 made it the page's largest visual. **No arithmetic
   changed** — the levels, the axis extent and every printed amount are what they were; the fix
   decides which two coordinates the rectangle is drawn between.

2. **The position map's middle axis tick was the median, drawn at the centre of the scale.** Ticks
   lay out with `justify-between`, so a three-tick axis puts its middle label at the exact midpoint
   whether or not the value sits there. The December lot printed "46" halfway up an axis running 0
   to 334. That is a chart lying about its own scale — the one error a reader cannot detect by
   looking at the chart — and it is now two ticks, the extremes, with the rule written down on the
   prop.

3. **Viewport-width grids inside module-width panels.** The Deal Jacket's section components ask for
   four columns at the `lg` *viewport* width, and a three-of-twelve module on a 1440 px screen is
   about 300 px wide while still satisfying `lg`. Headings broke mid-word: `DELIVE RY DATE`,
   `STRUCTU RE`. `Module` is now a `@container` and the section grids ask how wide *their panel* is.

A fourth was found and fixed inside this increment's own new code: `GroupedMeasureBars` identified
rows by mark colour with the names in a legend, which works for three stores and fails for ten
product categories — the palette carries six distinct marks, so categories seven through ten shared
a fill and the seventh bar could not be identified at all. Every row now prints its label.

---

## 7. What the boundary tests caught, and why the fix was not to widen them

Three of them, and all three were right.

- **`subtractExact` in a component.** The front-gross waterfall needed a `−` line's amount as a
  signed movement, and the first version negated it in `deal-jacket-sections.tsx`.
  `dashboard-boundaries.test.ts` failed it. ADR-0013 puts every piece of exact arithmetic in a
  declared view model, and "it is only a negation" is how that boundary erodes.
  `CalculationLine.signedAmount` is now published by `deal-jacket.ts`, which already owns the
  calculation.
- **Two exact values divided in a component.** The age-and-capital track needed each bucket's share
  of total investment. `summarizeInventory` now publishes `investmentShare`, divided exactly. A share
  belongs to the view model even when only a bar consumes it — which is why
  `inventory-sections.tsx` is deliberately **absent** from the geometry allowlist.
- **`raw.` in a dashboard file.** A local variable named `raw` tripped the guard that scans the
  dashboard lane for warehouse schema prefixes. The guard is right to be blunt; the variable was
  renamed.

Two allowlists were extended and both entries are geometry: `workspace-visuals.tsx` converts exact
values to floats for a bar width, a coordinate and a mark radius, and the zone-token count rose from
four to five for `zone-fi`.

---

## 8. The role of colour (§10)

| Domain | Identity | Where |
|---|---|---|
| Sales & Gross, Deals, Deal Jacket | Teal — `zone-performance`, `data-primary` | Module wash, trend columns, first composition segment |
| Inventory | Amber — `zone-inventory`, plus the ordered age ramp | Module wash, age stack, position-map marks |
| F&I | Violet — `zone-fi` (new), `data-secondary` | Module wash, product-gross segment |

`zone-fi` is a **new token that resolves to the same value as `zone-funnel`**. No new colour is
introduced, so the contrast headroom `tokens.test.ts` already measures on violet-50 covers it; the
token exists so a page about the finance office does not have to write `bg-zone-funnel`, and so the
next person to change the lead funnel's tint does not silently change F&I with it. It is registered
in `tokens.test.ts` and measured in its own right.

Green and red appear in exactly three places, all of them signed contribution: the gross-change
bridge's steps, the front-gross waterfall's steps, and a negative bar in `GroupedMeasureBars`. The
bridge's and waterfall's anchors take the neutral reference fill, because a level is not a direction.
**No gross magnitude is coloured as a judgement about a store or an employee**, no penetration rate
is coloured good, and the age ramp is ordered risk with its threshold stated as an ARPI project
default in the legend.

---

## 9. Accessibility (§13)

- **axe: 0 violations, no suppressed rules**, on the full sweep in `accessibility.spec.ts`.
- Every chart carries an exact textual alternative. Where the position map would have rendered a
  second copy of a table already on the page, it renders a link to that table instead — and its 234
  marks are still individually focusable with their exact figures as accessible names, so nothing was
  removed but a duplicate.
- A skip link precedes the position map's marker list, because a lot of stock is a lot of tab stops.
- The metric switch is a `<fieldset>`/`<legend>` radio group: arrow keys select, `Tab` enters and
  leaves once, the platform announces the state, and an unselected panel is `display: none` and
  therefore out of the accessibility tree.
- Sorting, paging and detail mode are anchors; search and filters are GET forms. **Every core
  business figure on all five routes is in the served HTML with scripting disabled.**
- Selection is never colour alone — border, weight and ground all change.
- Reduced motion: nothing in the increment animates.

---

## 10. Verification

| Gate | Result |
|---|---|
| `uv run pytest -m "not integration" -q` | pass |
| `ruff check` / `ruff format --check` | pass |
| `scripts/check_naming.py`, `check_docs_links.py`, `check_secrets.py`, `check_powerbi_model.py` | pass |
| `scripts/simulate_semantic_model.py --check`, `check_simulation_labels.py` | pass |
| `scripts/check_project_capabilities.py`, `generate_project_capabilities.py --check` | pass |
| `npm run format:check`, `lint`, `typecheck` | pass |
| `manifest:check`, `inventory:check`, `dashboard:check` | pass |
| `npx vitest run` | 1,368 passed |
| `npm run build` | pass |
| `npx playwright test --project=chromium` | pass |

---

## 11. What is deliberately still open

`UX.2C` and `UX.2D` are Planned and no part of either was started: no route outside the five named in
§1 changed its layout. `DASH.13` is Planned and untouched.

Four shared components were edited and every change is additive or a fix: `GridRow` gained an
`align` option, `Module` gained `@container`, `TrendChart` gained axis labels and a `summaryMode`
pass-through, and `BridgeChart`'s anchor geometry was corrected. Those changes are visible on the
Executive Command Center and are improvements there for the same reasons they are here; that route's
own layout is untouched and `executive-workspace.spec.ts` passes unchanged.

The Inventory route's +60.4 kB is open in the sense that `DASH.13-02` will set a budget against it,
and this document is where that increment should start.

---

Power BI real-engine validation remains externally pending; this increment does not change that state.
