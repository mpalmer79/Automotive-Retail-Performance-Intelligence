# `UX.2B` — Revenue and Vehicle Operations, reviewed

What the increment produced, measured the same way, on the same harness, at the same two viewports as
[`UX-2B-BASELINE.md`](UX-2B-BASELINE.md). Every figure below was read off a production build
(`next build`, `next start -p 3111`) in Chromium at 1440 × 900 and 390 × 844. The harness was scratch
and was removed before merge, per the standing instruction not to commit scratch tooling.

The `proseRepo` / `proseEye` definitions are the ones `UX-2-BASELINE.md` §1 established and the
baseline restates.

---

## 1. The number that drove the increment, after

| Route | Framed figures | Inside first viewport | First framed figure | Data-driven visual regions inside first viewport |
|---|---:|---:|---:|---|
| `/dashboard/sales-gross` | 6 → **8** | **0 → 5** | 2,752 px → **767 px** | 0 → **3** plus the rail |
| `/dashboard/deals` | 0 → 0 | 0 → 0 | — | none, deliberately — see §4 |
| `/dashboard/deals/SLE-00000646` | 0 → **2** | **0 → 2** | — → **523 px** | 0 → **2** plus the identity header |
| `/dashboard/inventory` | 0 → **3** | **0 → 2** | — → **871 px** | 0 → **2** plus the rail |
| `/dashboard/fi` | 0 → **3** | 0 → 1 | — → **802 px** | 0 → **2** plus the rail |

Before: four of the five routes contained no data visualization of any kind. After: every one of the
five opens with a ranked figure rail, and four carry at least two data-driven visual regions inside a
1440 × 900 first viewport. The fifth — the Deal Explorer — carries its filters, its population summary
and two transaction rows inside the same 900 px, which is the contract `UX.2B` §49 sets for it.

`data-visual-region` went from **0** elements across the five routes to **20**.

## 2. Geometry, before and after

| Route | Viewport | Height before | Height after | Change |
|---|---|---:|---:|---:|
| `/dashboard/sales-gross` | 1440 × 900 | 7,228 px | **3,260 px** | −54.9% |
| `/dashboard/sales-gross` | 390 × 844 | 11,439 px | **7,100 px** | −37.9% |
| `/dashboard/deals` | 1440 × 900 | 3,063 px | **2,561 px** | −16.4% |
| `/dashboard/deals` | 390 × 844 | 8,583 px | 9,326 px | +8.7% |
| `/dashboard/deals/SLE-00000646` | 1440 × 900 | 5,806 px | **4,015 px** | −30.8% |
| `/dashboard/deals/SLE-00000646` | 390 × 844 | 9,944 px | **8,250 px** | −17.0% |
| `/dashboard/inventory` | 1440 × 900 | 11,543 px | 11,828 px | +2.5% |
| `/dashboard/inventory` | 390 × 844 | 12,218 px | 13,379 px | +9.5% |
| `/dashboard/fi` | 1440 × 900 | 6,614 px | **3,455 px** | −47.8% |
| `/dashboard/fi` | 390 × 844 | 9,016 px | **5,999 px** | −33.5% |

**Two routes got taller and both are recorded rather than smoothed.** The Deal Explorer's phone view
grew by the height of the population summary that was the whole point of touching it; Inventory grew
by 285 px on the desktop, which is four visualizations for the price of a quarter of a screen, and it
is 11,828 px because the unit table below them is 250 rows and always was — `?store=GSA-003` measures
5,063 px against a baseline of 4,778 px, which is the same +285 px on a route a third as long.

## 3. Visible prose, before and after

| Route | `proseRepo` before | after | change | ceiling | `proseEye` before | after | change | ceiling |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/dashboard/sales-gross` | 891 | **557** | **−37.5%** | 623 ✅ | 1,029 | **687** | **−33.2%** | 720 ✅ |
| `/dashboard/deals/SLE-00000646` | 616 | **376** | **−39.0%** | 431 ✅ | 638 | **393** | **−38.4%** | 446 ✅ |
| `/dashboard/fi` | 700 | **418** | **−40.3%** | 490 ✅ | 767 | **525** | **−31.6%** | 536 ✅ |
| `/dashboard/deals` | 128 | 147 | +14.8% | none | 136 | 153 | +12.5% | none |
| `/dashboard/inventory` | 131 | 300 | +129.0% | none | 137 | 312 | +127.7% | none |

**The three routes with a target cleared it on both definitions.** The reduction came from one place
and it is worth naming, because it is the same finding on all three: a section lede explaining the
METHOD, above the figures it qualified, when the section body already stated the same caveat in full.
Nine `How is this calculated?` summary lines became one rail disclosure carrying all nine catalogue
entries. Seven module notes on the Deal Jacket and two on F&I were removed because the section
underneath already said the same thing — the trade block already states that variance is outside the
front identity, the staff block already states that no name exists anywhere in ARPI, the manager table
already states that the rows are ordered by store and never by a metric.

**The two routes without a target rose, and that is a real cost.** `UX.2B` §48 exempts a data-grid
route from the percentage, and neither of these lost a caveat — but neither is the increase free:

- **Inventory, +169 words.** Four visualizations arrived on a route that had none, and a chart's
  caption is what stops its encoding being guessed at. The added words are: six rail-cell notes
  (*"Acquisition plus reconditioning. Not the accounting book value"*, *"ARPI project default, not a
  benchmark"*), the rail's semi-additive scope line, three chart captions naming what each axis and
  each length is, the count of units the map cannot place, and the sentence separating markdown since
  listing from repricing since the prior month end. Every one of them qualifies a figure that did not
  exist before this increment. Nothing that was there was made longer.
- **The Deal Explorer, +19 words.** One module note stating that the money figures are over retail
  rows only and that a front-loss deal is counted rather than suppressed. That is the caveat the
  summary strip needs, and the strip is the reason the route was touched.

Both routes keep every caveat the baseline recorded as load-bearing: the synthetic market estimate,
the aged threshold as a project default, and the wholesale-is-not-retail statement.

## 4. Route by route

### `/dashboard/sales-gross` — the general sales manager

Nine equal metric tiles became a **three-plus-six rail**: retail units, total gross and total GPRU at
display size; new units, used units, front gross, back gross, front PVR and back PVR beneath them.
Four quarter-width trend charts became **one large trend with a measure switch** over the same three
measures the rail leads with — 32 December columns across a full module instead of across 300 px. New
against used and store against store became **grouped comparisons** on volume, money and rate, each
measure scaled to its own maximum with the consequence stated in the caption.

**The gross-change bridge moved from the foot of the page to the second screen.** It was last because
it is the most interpretive thing on the surface and a reader who has already seen units, rate and mix
reads it as a summary rather than as a verdict. That reasoning was right and is preserved — it is
still below all three — but "below" had come to mean 5,900 px down, which is not a position in a
reading order so much as an omission.

**The bridge reconciles exactly, and the page says so from a recomputation rather than a stored flag:**
*"the exported component numerators sum exactly to the comparison unit count multiplied by the period
change, with no division on either side of the identity."*

### `/dashboard/deals` — the desk manager

**No chart, and that is a decision rather than an omission.** §13 forbids replacing exact transaction
inspection with pictures and §48 forbids enforcing a prose reduction on a data grid. What was missing
was what §15 names: the filtered population's size was a chip in the page header and its value was not
stated anywhere, so a reader who narrowed to one store and one month met 25 rows out of 650 with no
way to tell whether the filter was the one they meant.

A **summary strip** now carries deals, retail units and total gross above the table, with front gross,
back gross and the front-loss count beside them — all summed over the same rows the table pages
through, and over retail rows only, which the strip says. The table's three attribution columns moved
into a disclosure so the ten money-and-identity columns a desk reviews come first, and the mobile
card's deal id became the link the table's already was.

Measured: the summary sits at 478 px and the first transaction row at 799 px, with two rows inside the
first viewport.

### `/dashboard/deals/[saleId]` — the deal-review record

Sale price, total gross, front gross, back gross and days in stock were in four different sections
spread down 5,806 px behind ten `h2`s of equal weight. They are now **one identity header**, and each
of the two grosses has a visual: the front-gross identity as a **deduction ladder** against the sale
price, the back-end gross as **reserve against original product gross**.

**A ladder, not a waterfall, and the difference is the question being asked.** A waterfall's steps
float between two anchors and are read as contributions to a CHANGE — which is what the gross-change
bridge is. A deal's front gross is not a change: it is one price with three costs taken out of it, and
a ladder draws exactly that.

**Trade variance is not in the ladder and cannot be**, because the component only draws the lines it is
given and trade is not one of them. **The back composition uses the deal-date original product gross,
never the retained figure**, and the view model records above those fields why. Verification moved
behind a *"Verify this calculation"* disclosure — and a verification that FAILS renders visibly, above
it, with both amounts, because a defect behind a summary is not a defect anybody reads.

### `/dashboard/inventory` — the used-vehicle manager

Four stat cells and two tables became a **four-plus-two position rail**, the five governed age bands
drawn as **units and capital over the same bands**, the **age × price-to-market map**, and **price
movement by band**. The unit table stayed a table, gained an investment column, and had its minimum
width raised because ten columns at the old width wrapped every row to two lines.

**The map was built because every channel resolves at one grain and one snapshot.** Price-to-market
ratio, days in stock, inventory investment and the exported age band all come off the same unit row at
the same resolved date. Nothing is joined, nothing is summed across dates, and a unit the estimator
declined to price is excluded and counted rather than plotted at zero — 16 of 250 on the unfiltered
route, stated under the plot.

**No quadrant is named and no price is suggested.** The axes carry a direction (`Older ↑`,
`Higher price to market →`) and one reference rule at parity with the synthetic estimate, which is a
defined point rather than a judgement. The words *overpriced*, *underpriced*, *reprice*, *opportunity*,
*good* and *bad* appear nowhere on the route, and a unit test asserts it.

### `/dashboard/fi` — the finance director

**177 words of prose before the first number** — the highest first-viewport prose count in the console
— above eight production figures at one weight and six tables at one weight. Back PVR, reserve PVR and
product PVR are now a **rail**; reserve against product, the structure mix and per-category penetration
are **lengths**; adjustments are **signed bars around the direction the ledger actually went**.

**Every penetration bar runs from zero to full eligibility**, never to the largest category. Scaling a
proportion set to its own maximum makes the best-attached category a full bar whatever it reached,
which is the single most misleading thing a proportion chart can do; a unit test fails if any bar in
the fixture reaches 100%. Both sides of every ratio — `37 of 92` — and the `ELIG-*` rule behind each
denominator are printed beside each bar, which is stronger than the two table columns it replaced,
and those columns are still in the figure's own table disclosure.

**The three date bases are three labelled chips and a basis line on every rail card**, instead of a
paragraph. Managers stay unranked, in store and identifier order, and below the governed floor the
row reads *"Insufficient sample (n = 9)"* with the counts shown and no ratio.

## 5. Visuals considered but not built (`UX.2B` §56)

| Visual | Why it was refused |
|---|---|
| **Book value as the map's bubble measure** | `UX.2B` §29 names `current_book_value` first. It lives in `inventory-accounting`, a partition set this route opens for ONE unit at a time when the detail panel is open. Sizing 250 marks from it would pull 360 kB of per-unit book values into a route that does not otherwise need them, to plot a measure `inventory_investment` already answers from a column in hand at the same grain and the same snapshot. The grains would have aligned — both are month-end — so this is a payload refusal rather than a correctness one, and it is recorded as such. |
| **A second copy of the map's data as a table disclosure** | Measured at **+68 kB of HTML** on the unfiltered route: the same 250 units printed twice. The route's own unit table already carries every channel the plot draws, as exact text, plus the units the plot cannot place — so the plot links to it instead. This is the only figure in the console without its own table disclosure, and the reason is written on the component. |
| **A price-movement time series** | The export publishes an original asking price, a current asking price and a change against the prior month end. It publishes no price history. Drawing a line through two points would assert observations the model never made, which §31 forbids outright. The visual is original against current against the difference, by age band. |
| **A per-sale-type gross comparison** | The export publishes a unit count per sale type and no gross. Apportioning the retail total across sale types would invent a measure the reporting layer does not own. Sale type stays a two-column table in a disclosure. |
| **A third certified bar in the condition split** | Certified is a condition TYPE inside the Used group, and the gross export splits New and Used only. §8 forbids a third certified unit KPI; the certified retail unit count stays in the sale-type detail, labelled as already inside the retail count. |
| **A revenue-against-inventory relationship** | Nothing in the governed layer supports it at one grain, and drawing gross against stock position would imply a causal relationship §10 and §29 both forbid. Not attempted. |
| **A finance-manager performance chart** | §41 forbids ranking managers and forbids a performance sort. A bar chart of four managers on back PVR IS a ranking whatever its caption says, because length is ordinal. The manager comparison stays a table in store and identifier order. |
| **A category penetration pie per product** | §38 forbids it by name, and a pie of one proportion against its own complement is a bar that takes four times the space. |

## 6. Architecture and data-model impact

| | Expected | Actual |
|---|---|---|
| New warehouse facts | 0 | **0** |
| New dimensions | 0 | **0** |
| New reporting views | 0 | **0** |
| New export datasets | 0 | **0** |
| KPI identifiers added, removed or redefined | 0 | **0** |
| Files changed under `powerbi/` | 0 | **0** |
| Chart libraries added | 0 | **0** |
| Client JavaScript owned by the five routes | 0 bytes | **0 bytes** |

**Three view-model additions, and none of them is a measure.**

1. `MixRow` gained a per-segment gross per retail unit. That is `KPI-GRS-006` — the identity the rail
   already publishes for the whole scope, and the store scoreboard on `/` has published per store
   since `DASH.2` — evaluated over a narrower row set, as SUM(numerator) ÷ SUM(denominator) from the
   two additive columns the row already sums. A zero denominator yields `null` and renders as words.
2. `DealsView` gained front and back gross over the retail rows of the filtered population, which is
   the same arithmetic it already did for total gross, over the same rows, for two more columns.
3. `BucketProfile` gained an investment share, an original/current asking-price pair, the difference
   between them and a repricing count — all sums and one division over columns the unit rows already
   carry, at one snapshot.

**The chart-library question was asked a third time and answered a third time.** §44 names the scatter
as the first serious candidate, and §6.0c of `DESIGN_SYSTEM.md` had written down the condition under
which a library becomes cheaper: a continuous scale, an axis with computed ticks, or a layout
algorithm. The scatter needs two linear min–max normalisations (four lines), no ticks — the axes carry
a direction and one reference rule, and quadrant labelling is forbidden — and no layout algorithm. The
comparison is recorded in §6.0e. Nothing was installed.

**Two files moved and one was renamed**, because `exec-visuals.tsx` said in its own docstring that its
forms would move if a second route rendered them and four now do. `MetricSwitch` and the grouped
comparison are in `workspace-visuals.tsx` under a stated membership rule; `exec-grid.tsx` became
`workspace-grid.tsx`. No prop, no span, no zone and no markup moved with either.

## 7. Performance

Compressed transfer, cold load, route cost alone, production server, Chromium.

| Route | Total before | Total after | HTML before | HTML after | Script |
|---|---:|---:|---:|---:|---:|
| `/dashboard/sales-gross` | 428.8 kB | **426.3 kB** | 65.8 kB | 65.1 kB | 192.5 kB, unchanged |
| `/dashboard/deals` | 418.9 kB | 424.2 kB | 57.8 kB | 62.8 kB | 192.5 kB, unchanged |
| `/dashboard/deals/SLE-00000646` | 405.4 kB | 408.9 kB | 46.5 kB | 49.7 kB | 189.7 kB, unchanged |
| `/dashboard/inventory` | 435.5 kB | **477.0 kB** | 73.8 kB | **114.0 kB** | 192.5 kB, unchanged |
| `/dashboard/inventory?store=GSA-003` | 409.2 kB | 432.7 kB | 42.7 kB | 62.2 kB | 192.5 kB, unchanged |
| `/dashboard/fi` | 408.8 kB | 417.2 kB | 47.8 kB | 54.0 kB | 192.5 kB, unchanged |

**Script is byte-identical on every route.** Eight visuals, a scatter plot, a measure switch, two
economics figures and five rails, for **zero bytes** of client JavaScript. The switch is a radio group
and CSS; sorting is anchors; paging is anchors; every filter is a native GET form. The one client
island on the four filtered routes is still the filter bar, and the Deal Jacket still has none.

**Inventory costs 41.5 kB more HTML and the number is not smoothed.** Roughly 30 kB is the map — 234
absolutely-positioned marks with inline coordinates and sizes — and roughly 10 kB is the investment
column the unit table gained so the map could point at it instead of printing its own copy. The
alternative measured 68 kB worse. Sales & Gross is the only route that got LIGHTER, for the reason
`UX.2A` recorded on the Executive: nine repeated catalogue disclosures became one.

**No budget is set from these numbers.** `DASH.13-02` sets the budgets, from measurements taken once
`UX.2` is complete; fixing one here while `UX.2C` and `UX.2D` are still rebuilding the routes around
these would produce a budget that expires on the next merge.

## 8. Quality

| | Result |
|---|---|
| Python, `pytest -m "not integration"` | **3,667 passed**, 1,229 deselected |
| Python coverage | **88.94%** against an 85% floor |
| PostgreSQL integration suite | **Not run, and not claimed.** `UX.2B` changed no SQL, no reporting view, no export dataset and no generator. Running it would produce evidence for work that did not happen. |
| Vitest | **1,407 passed** across 34 files — 39 of them new in `ux2b-revenue-workspaces.test.tsx` |
| Playwright, Chromium, full suite | **870 passed**, 0 failed — 28 of them new in `ux2b-workspaces.spec.ts` |
| axe | 0 violations, no suppressed rules, across the five transformed routes |
| No-JavaScript | Every rail figure, both jacket economics, the age bands, the unit table, the structure mix and every `ELIG-*` denominator present with scripting disabled |
| Responsive matrix | No horizontal overflow at 320, 375, 390, 768, 1024, 1280, 1440 or 1920 on any of the five routes |
| Reduced motion | Nothing in the increment animates |

**Seven existing assertions were edited across five suites and every one is recorded**, in
`TEST_STRATEGY.md` under *What did not change*. Three kinds: a locator that now resolves to two tables
and was scoped to the one it always meant; content that moved into a disclosure, where the assertion
was split into a visible half and a `textContent` half; and copy that changed with the layout, where
the assertion follows the claim rather than the words. None was weakened — the Deal Explorer's
contact-shaped-value scan went the other way and now reads every table on the route, because a
disclosure is exactly where a contact detail would leak unnoticed.

## 9. The staff-level review questions (`UX.2B` §67)

**Sales**

1. *Are Units/Gross/GPRU visually primary?* Yes — three lead cards at display size, six qualifying
   cards beneath, asserted by `data-kpi-rank`.
2. *Is gross change visible without methodology reading?* Yes — the bridge is in row 3 at 1440 × 900,
   with every amount printed and a plain-language attribution sentence above it.
3. *Does the bridge exactly reconcile?* Yes, and the page recomputes it rather than reading a flag.
4. *Is new/used composition clear?* Yes — three measures, one comparison, certified inside Used.
5. *Is store contribution clear?* Yes — the same three measures, marks keyed on the business code.
6. *Is any store ranked subjectively?* No. Business-code order, no composite, and the module says so.
7. *Are distributions meaningful?* One distribution, over deal-level total gross, with median and mean
   together and the negative-front count stated.

**Deals**

8. *Is the filtered population obvious?* Yes — six figures above the table, at 478 px.
9. *Are core transaction economics visible?* Yes — sale price, front, back, total and days, in the
   first ten columns.
10. *Is the table usable at desktop?* Yes; ten columns, sortable on six of them, no horizontal scroll
    at 1280 and above.
11. *Is mobile usable?* Yes — the deliberate card pattern, with the deal id now a link.
12. *Is drill-through obvious?* Yes, both directions, and both are fetched by a test.
13. *Is customer data absent?* Yes, and the scan that proves it now covers both tables.

**Deal Jacket**

14–19. *Is deal identity / sale price / front gross / back gross / total gross / days-in-stock
    prominent?* All six in one header at the top of the route, asserted present above the fold by
    `data-deal-figure`.
20. *Does front-gross decomposition remain exact?* Yes — the same five lines, the same recomputation,
    now with a length beside each.
21. *Is trade variance separate?* Yes; it is not a line of the ladder and a test asserts it.
22. *Does back-gross reconciliation use original product gross?* Yes; the exact fields are named in the
    view model with the reason.
23. *Are adjustments separate?* Yes, under the bar, with their own as-of date.
24. *Is verification subordinate to the transaction?* Yes — behind a disclosure, except a FAILURE.

**Inventory**

25–28. *Is active-unit count / inventory investment / age distribution / capital by age clear?* Yes;
    the first two are rail cards, the last two are the two tracks of one stack over one set of bands.
29. *Was scatter built?* Yes.
30. *Do all axes share one valid grain and snapshot?* Yes — one unit row at one resolved date, for all
    four channels. A test asserts the plotted rows span exactly one snapshot date.
31. *Is synthetic market estimate labelled correctly?* Yes, everywhere, and a test forbids the six
    words that would imply a licensed valuation.
32. *Is no repricing recommendation present?* Correct — none, and a test forbids the vocabulary.
33. *Is the unit table still exact and usable?* Yes, with one more column and a wider minimum.

**F&I**

34–36. *Is Back PVR primary? Is reserve/product composition visible? Is structure mix visible?* Yes,
    yes and yes — all three inside the first viewport at 1440 × 900.
37–38. *Is penetration based on eligible deals, using distinct attached deals?* Yes; both sides are
    printed beside every bar and the numerator is asserted to be the attached-deal count.
39. *Are date bases distinguishable?* Yes — a three-chip key and a basis line on every rail card.
40. *Are adjustments visually understandable?* Yes — signed bars, with the direction as a word as well
    as a colour.
41–42. *Are finance managers unranked? Is minimum sample preserved?* Yes and yes.

**Product**

43. *Did visible prose decrease?* On the three routes with a target, by 37.5%, 39.0% and 40.3%. On the
    two data-grid routes it rose, and §3 says by how much and why.
44. *Are first visuals higher?* From "none on the route" to 523–871 px on four of the five.
45. *Does every visual move with data?* Asserted, per visual, in two or three states.
46. *Is there any clip art?* No.
47. *Is there any decorative chart?* No — the geometry suite fails a fixed one.
48. *Is any KPI redefined?* No.
49. *Was any warehouse domain added?* No.
50–51. *Was a chart library added, and was the case documented?* No, and the comparison is in
    `DESIGN_SYSTEM.md` §6.0e whether or not one was added.
52. *Does no-JS preserve core business content?* Yes, asserted per route.
53. *Is axe clean?* Yes, no suppressed rules.
54. *Is mobile usable?* Yes, with one measured limitation — see §10.
55. *Is performance measured?* Yes, §7, before and after, per route.
56. *Does `UX.2A` remain intact?* Yes — `/` renders the same modules from the same selectors; the two
    primitives it shares moved file and kept their props, and `ux2a-command-center.test.tsx` passes
    unchanged apart from the import path.
57–59. *Is `UX.2C` / `UX.2D` / `DASH.13` untouched?* Yes. `/dashboard/leads-marketing`,
    `/dashboard/employees` and `/dashboard/accounting` have no diff.

## 10. What this increment did not fix, measured

**The shared control band is tall on a phone, and it is not `UX.2B`'s to compact.** At 390 × 844 the
band's bottom edge sits at 625 px on Sales & Gross, 813 px on F&I and 985 px on Inventory — so on the
last two the first visual region begins below the fold. The band is one component across nine routes
and its filter form is the one client island in the console; forking it on five routes would be the
opposite of the consistency `UX.2D` exists to close. Two route-scoped compactions were made and
measured: the Deal Explorer's summary strip is three across at every width rather than stacked, and
Inventory's search-and-sort form is two across below `sm`. Neither is enough on its own, and the
number is recorded here so `UX.2D` can be held to it.

**The Deal Explorer's phone view is longer than it was.** 9,326 px against 8,583 px, which is the
summary strip. A reader on a phone now scrolls past six figures to reach the first transaction card.
That trade was made deliberately — the strip is why the route was touched — and it is the one place in
the increment where a mobile reader is worse off than before.

---

Power BI real-engine validation remains externally pending; `UX.2B` does not modify the semantic model.
