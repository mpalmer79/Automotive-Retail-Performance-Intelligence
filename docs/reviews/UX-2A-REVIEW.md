# `UX.2A` — Executive Command Center, reviewed

What the increment produced, measured the same way and with the same tooling as
[`UX-2-BASELINE.md`](UX-2-BASELINE.md): a production build (`next build`, `next start -p 3111`),
Chromium, 1440 × 900 for desktop figures and 390 × 844 for mobile. The before-column of every table
below is that document, and the harness that produced both was scratch and was removed before merge.

Starting `main`: `db094164012fe555489d65ac289c71ebd901b91c` — the merge of `DASH.12` (PR #59).

---

## 1. The headline

**At 1440 × 900 a general manager now opens `/` and sees the business context, the whole KPI rail and
three data-driven visual regions without scrolling.** Before the increment they saw none of the three
and the first framed figure was 1,389 px down.

| Measure | Before | After | Change |
|---|---:|---:|---|
| Data-driven visual regions inside the first viewport (excluding the KPI rail) | **0** | **3** — trend, stores, pace | — |
| Framed figures whose top is inside the first viewport | 0 | 2 | — |
| First framed figure, px from top | 1,389 | **768** | −44.7% |
| KPI cards in the rail, all inside the first viewport | 7 (none) | 8 (all 8) | — |
| Document height, desktop | 8,161 | **4,955** | −39.3% |
| Document height, mobile | 15,426 | **9,026** | −41.5% |
| First framed figure, mobile | 3,681 | **1,987** | −46.0% |
| Visible prose, `proseRepo` | 945 | **569** | **−39.8%** |
| Visible prose, `proseEye` | 1,130 | **704** | **−37.7%** |
| `proseUx1` (includes `.sr-only`; recorded for continuity, not a target) | 3,002 | 2,698 | −10.1% |
| Route cost, `/` | 437.9 kB | **425.5 kB** | −12.4 kB |
| Client islands on the route | 1 | 1 | unchanged |
| Client JavaScript owned by the route's visualizations | 0 bytes | **0 bytes** | unchanged |

Both prose targets clear `UX.2A` §16's floor of 35%. Neither reaches the 40% preference on
`proseEye`, and the reason is worth stating rather than rounding: what remains is largely caveats the
increment may not delete — the cohort basis of the funnel, the semi-additive snapshot rule, the
synthetic-target disclosure, the planted-variance scenario note, the aged-threshold project default,
the no-league-table statement — plus twelve comparison lines ("+13 units higher than November 2025")
which the collector counts as prose and which are data. §16 says not to remove a required caveat, and
none was removed.

## 2. The first-viewport contract, item by item (§4)

| Required | Delivered | Asserted by |
|---|---|---|
| A. Compact application/filter controls | Control band 246 px, down from 316. The filter form is one row of six cells including its submit; three hints whose effect was no narrower than their label were removed, two that genuinely qualify a partial parameter stayed. | `executive-workspace.spec.ts` — the form's bottom edge is inside 900 px |
| B. Primary KPI rail | Eight governed figures in two ranks, whole rail inside the first viewport | same file — `[data-kpi-card]` count is 8 and the rail's bottom edge is inside 900 px |
| C. At least three meaningful data-driven visual regions | Operating trend, store comparison, plan and pace | same file — `data-visual-region` tops measured against the viewport, and asserted again under three different filter states so the contract cannot be met by coincidence |
| First major chart at roughly 600–750 px | 768 px | same file, ceiling 900 |

## 3. Composition, before and after

| Element | Before | After |
|---|---:|---:|
| `<h2>` regions / modules | 5 bands | 11 modules |
| Visible `<h3>` headings | 32 | 18 |
| `<details>` elements | 37 | 22 |
| Visible summary lines reading "How is this calculated?" | 20 | **0** |
| Visible `<table>` elements | 6 | 9 |
| Metric cards on the route | 22 | 12 |

The twenty identical methodology summary lines are the single clearest before-and-after in the
increment. They are now one disclosure on the rail carrying all eight catalogue entries, and one on
the stock module carrying its four. Nothing was summarised and nothing was dropped: every field
`KPI_CATALOG.md` owns still renders, from `kpis.json`, through the same component, and
`dashboard-executive.test.tsx` asserts the eight entries by heading.

Visible tables went **up**, from six to nine, which is the right direction: the age stack, the funnel
and the grouped store comparison each gained a `TableDisclosure` carrying every value they draw.

## 4. Module by module, against the brief

**§5 Executive grid.** Twelve columns, six at `md`, one below. Five rows: rail; trend + stores +
pace; inventory + funnel + gross; change drivers + attention; accounting + detail. The row the brief
sketched was followed where measurement agreed with it and departed from where it did not — pace was
moved up into row two, because the first-viewport contract needs three data regions there and pace is
the third question a general manager asks after "what is the shape" and "whose is it".

**§6 KPI rail.** Eight, not nine. Primary: retail units, total gross, total GPRU. Secondary: front
PVR, back PVR, lead-to-sale, inventory investment, aged inventory percentage. Front PVR joined back
PVR because back PVR alone cannot distinguish a finance office performing from a front end collapsing
underneath it. Median inventory age left for the stock module: at group scope it is an order
statistic above its published grain and renders "Not derivable at this scope", which is correct and a
poor use of the most prominent card on the console. Accounting variance is deliberately not a card —
§15 requires the accounting reading to stay neutral, and a signed variance in a rank of performance
figures acquires a favourable direction by position alone.

**§7 Primary operating trend.** Large, and switchable between retail units, total gross and total
GPRU. The switch is a radio group and CSS: all three series are server-rendered in the document, the
control chooses which is displayed, and it works with scripting disabled. It cannot recalculate
anything because there is no code in it. No URL state, and the reasoning is recorded on `MetricSwitch`
rather than assumed: it changes neither the population nor the arithmetic, all three answers are
already on screen, and a fourteenth filter parameter that survived a navigation to a route where it
means nothing would be wearing the console-wide grammar's clothes. The selected measure is named in
the chart's accessible title, its own axis, its value scale and its exact textual fallback.

**§8 Store comparison.** One grouped comparison across units, total gross and GPRU, with one legend
and a stable identity colour per store derived from the business code, never from row position. Each
measure is scaled to its own maximum and the caption says so, because units, dollars and dollars per
unit share no axis. No score, no rank, no composite. A structural absence draws no track at all.

**§9 Plan and pace.** The existing `PaceBar` bullet geometry, one column so both markers are legible
in a three-of-twelve module, with actual, target, attainment, pace and the selling-day projection.
100% remains the only coloured boundary; no zones were invented. The projection is labelled
"Selling-day pace projection" everywhere and the e2e suite still asserts that "forecast" appears
nowhere.

**§10 Inventory exposure.** The age stack now draws **two tracks over the same five governed bands** —
units, then the capital standing in them. It needed no export change and no new grain:
`inventory-aging` publishes `investment_in_bucket` beside `units_in_bucket`. The capital track is
drawn only when every band carries a figure, because a partial capital bar beside a complete unit bar
invites exactly the comparison it cannot support. No repricing recommendation.

**§11 Lead funnel.** A nesting rather than a table: five governed stages, each a subset of the one
above, with its count, its share of leads received (labelled as arithmetic on two exported columns,
not a KPI) and its governed rate with catalogue identifier. Show rate is still absent from the
"Showed" stage, for the DASH.10 reason. Unanswered leads stay visible. No benchmark.

**§12 Gross composition.** Front against back, and new against used, each drawn against its own
governed total. No reserve/product split, and the reason is recorded on the component: those columns
belong to `fi-summary`, which this route may not open, and they arrive on their own date bases —
drawing all four as one stack would put two date semantics inside one bar.

**§13 Management attention.** A count by severity and by domain, both computed by `buildActionQueue`
— the same function `/dashboard/actions` calls, over the same rows — followed by the first four
prompts of the same total order. Both are scoped to the reader's store filter, so the module agrees
with the rest of the screen. Every chip is a link into the queue. No done, no assign, no snooze, no
due date, no owner person; `owner_role` remains a review role.

**§14 Change drivers.** Promoted from a definition list to a waterfall using the existing
`BridgeChart`: volume, front PVR, back PVR, the grouped remainder, and total change as a closing
anchor. One authority — `vw_gross_change_bridge` through `buildBridge` and `buildChangeDrivers` — and
no second formula. Signed contributions use the semantic pair; the closing anchor takes the neutral
reference fill, because a level is not a direction. The vocabulary is attribution, never cause, and a
test asserts it.

**§15 Accounting.** Four facts — comparable positions, reconciled, signed variance with its direction
in words, one-sided count — then the neutral scale. No sign is called good or bad; every marker is
`data-neutral` on both sides of zero, and `dashboard.spec.ts` still asserts that.

## 5. Interactivity and what stayed on the server (§18)

The only interactive additions are a presentation switch and disclosures. No KPI is recalculated, no
denominator re-chosen, no gross arithmetic rebuilt, no accounting computed and no action rule
evaluated in a browser: the route's single client island is still the filter bar, which receives five
option lists and no data. Measured client-JavaScript delta for `UX.2A`'s three new primitives: **zero
bytes**.

## 6. Chart library (§19)

Re-evaluated rather than inherited, against Recharts, Visx, Chart.js and Observable Plot, on
accessibility, responsive layout, keyboard and focus, bundle, SSR, interaction, testability and
maintenance. The comparison table is in
[`DESIGN_SYSTEM.md`](../../portfolio/docs/DESIGN_SYSTEM.md) §6.0c. Outcome: no library, on two
criteria — three of the four cannot render on the server without a measured container, and three of
the four move the values out of the DOM. The condition under which a future increment *should* reach
for one is stated there so it can be checked rather than re-argued.

## 7. Accessibility (§22)

- **axe: 0 violations, no suppressed rules**, on the full sweep in `accessibility.spec.ts`.
- Exact values, textual chart alternatives and valid `<dl>` structures preserved; the definition-list
  suite passes unchanged.
- The metric switch is a `<fieldset>`/`<legend>` radio group: arrow keys select, `Tab` enters and
  leaves once, the platform announces the state, and an unselected panel is `display: none` and
  therefore out of the accessibility tree — a screen-reader user reads one chart, not three.
- Focus is visible on the control that has it: the inputs are `sr-only` and the ring is drawn on the
  label through `peer-focus-visible`. Asserted by measurement, not by eye.
- Selection is never colour alone — border, weight and ground all change.
- Reduced motion: nothing in the increment animates.
- 200% zoom and the 320–1920 width matrix: no horizontal overflow at any tested width.

## 8. Performance (§23)

Route cost fell 12.4 kB despite the page rendering two extra trend series, a capital track, three
extra tables and a grouped comparison. HTML fell 12.7 kB because the twenty repeated methodology
disclosures became two; CSS rose 0.3 kB for the switch's peer variants; script is byte-identical. The
full table is in [`PERFORMANCE.md`](../../portfolio/docs/PERFORMANCE.md) §9.12. No dependency was
added.

## 9. What this increment did not change, stated plainly

No KPI definition, no numerator, no denominator, no date basis, no structural-absence rule, no
accounting semantic, no bridge arithmetic, no action rule, no threshold, no export, no dataset, no
reporting view, no warehouse entity and no file under `powerbi/`. Every figure comes from the same
governed selector it came from before, through `buildExecutiveOverview()`, evaluated on the server.
The three view-model changes are additive and each is a selection over rows already read: a third
compared measure, a third trend series, and the capital already published beside each age bucket.

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
| `npx playwright test --project=chromium` | 842 passed |

## 11. What is deliberately still open

`UX.2B`, `UX.2C` and `UX.2D` are Planned and no part of them was started: no other operating route's
layout changed. Three shared components were touched and the change to each is compaction rather than
redesign — the control band's vertical rhythm, the filter bar's row and hint policy, and the pace
section's single-column stacking. Those changes are visible on the eight other operating routes and
are improvements there for the same reason they are here; the routes' own layouts are untouched and
their suites pass unchanged.

---

Power BI real-engine validation remains externally pending; this increment does not change that state.
