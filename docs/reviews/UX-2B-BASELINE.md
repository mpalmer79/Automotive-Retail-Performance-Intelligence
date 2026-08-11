# `UX.2B` — measured baseline

The state of the five revenue and vehicle operating routes **before** `UX.2B`, measured against `main`
at `3463fd5cdee1343d8703aa71dc90f80ce2a4544f` — the merge of `UX.2A` (PR #60) — from a production
build (`next build`, `next start -p 3111`), Chromium, viewport 1440 × 900 for desktop figures and
390 × 844 for mobile.

Recorded rather than described, for the reason [`UX-1-BASELINE.md`](UX-1-BASELINE.md) and
[`UX-2-BASELINE.md`](UX-2-BASELINE.md) give: the increment's claims are comparative, and a comparison
against a remembered baseline is not a measurement. The after-figures are in
[`UX-2B-REVIEW.md`](UX-2B-REVIEW.md).

The measurement harness was scratch and was removed before merge, per the standing instruction not to
commit scratch tooling. It loaded each route in Chromium at each viewport and read the numbers below
off the rendered document. Its prose definitions are the ones `UX-2-BASELINE.md` §1 established:

* **`proseRepo`** — the repository's own definition, from `dashboard.spec.ts`: a rendered paragraph of
  eight words or more, outside `.sr-only` and outside a closed `<details>`. Shorter paragraphs are
  labels, units and values.
* **`proseEye`** — every rendered paragraph outside `.sr-only` and outside a closed `<details>`, at any
  length.

`proseUx1` is not recorded here. It counts `.sr-only` paragraphs, so on routes that currently have no
charts at all it measures nothing `UX.2B` is trying to change, and on routes that gain charts it is
expected to rise for a reason [`ACCESSIBILITY.md`](../../portfolio/docs/ACCESSIBILITY.md) forbids
treating as a regression.

---

## 1. The number that drives the increment

| Route | Framed figures on the route | Framed figures inside the first viewport | First framed figure, px from top |
|---|---:|---:|---:|
| `/dashboard/sales-gross` | 6 | **0** | 2,752 |
| `/dashboard/deals` | **0** | **0** | — |
| `/dashboard/deals/SLE-00000646` | **0** | **0** | — |
| `/dashboard/inventory` | **0** | **0** | — |
| `/dashboard/fi` | **0** | **0** | — |

**Four of the five routes contain no data visualization of any kind**, and the fifth puts its first one
three screens down. A general sales manager, a desk manager, a used-vehicle manager and a finance
director all currently open a page of headings, ledes and tables and read their way to the answer.

`data-visual-region` — the test hook `UX.2A` introduced so a first-viewport contract can be asserted by
measurement rather than by eye — is present on **zero** elements across all five routes.

## 2. Geometry, before

| Route | Viewport | Document height | Prose words in first viewport (`proseEye`) | Visible tables | `<details>` | `<h2>` | `<h3>` |
|---|---|---:|---:|---:|---:|---:|---:|
| `/dashboard/sales-gross` | 1440 × 900 | 7,228 | 104 | 3 of 9 | 18 | 7 | 11 |
| `/dashboard/sales-gross` | 390 × 844 | 11,439 | 38 | 3 of 9 | 18 | 7 | 11 |
| `/dashboard/deals` | 1440 × 900 | 3,063 | 93 | 1 of 1 | 1 | 1 | 0 |
| `/dashboard/deals` | 390 × 844 | 8,583 | 38 | 0 of 1 | 1 | 1 | 0 |
| `/dashboard/deals/SLE-00000646` | 1440 × 900 | 5,806 | 81 | 3 of 3 | 5 | 10 | 0 |
| `/dashboard/deals/SLE-00000646` | 390 × 844 | 9,944 | 34 | 2 of 3 | 5 | 10 | 0 |
| `/dashboard/inventory` | 1440 × 900 | **11,543** | 96 | 2 of 2 | 2 | 3 | 0 |
| `/dashboard/inventory` | 390 × 844 | 12,218 | 70 | 2 of 2 | 2 | 3 | 0 |
| `/dashboard/fi` | 1440 × 900 | 6,614 | **177** | 6 of 8 | 7 | 8 | 0 |
| `/dashboard/fi` | 390 × 844 | 9,016 | 89 | 6 of 8 | 7 | 8 | 0 |

Under a filter the figures barely move, which is the same finding `UX-2-BASELINE.md` §2 recorded for
the Executive: `/dashboard/sales-gross?store=GSA-001&period=2025-11` measures 7,269 px tall with its
first figure at 2,794 px, and `proseRepo` 887 against 891. The layout does not respond to what is
being asked of it.

`/dashboard/inventory?store=GSA-003` measures 4,778 px against the unfiltered 11,543 px — the whole of
that difference is the length of the unit table. The *summary* above it is four stat cells and a
four-column table either way.

## 3. Visible prose, before

| Route | `proseRepo` words | `proseRepo` paragraphs | `proseEye` words | `proseEye` paragraphs |
|---|---:|---:|---:|---:|
| `/dashboard/sales-gross` | **891** | 33 | **1,029** | 70 |
| `/dashboard/deals` | 128 | 5 | 136 | 7 |
| `/dashboard/deals/SLE-00000646` | **616** | 21 | **638** | 33 |
| `/dashboard/inventory` | 131 | 7 | 137 | 11 |
| `/dashboard/fi` | **700** | 20 | **767** | 44 |

Identical at both viewports on every route: nothing is dropped or added responsively, so the phone
reader meets the same word count in a column a third as wide.

**Where the ≥30% reduction target of `UX.2B` §12 and §48 applies.** Three routes are explanation-heavy
and carry it: Sales & Gross, the Deal Jacket and F&I. The ceilings that follow are

| Route | `proseRepo` ceiling | `proseEye` ceiling |
|---|---:|---:|
| `/dashboard/sales-gross` | 623 | 720 |
| `/dashboard/deals/SLE-00000646` | 431 | 446 |
| `/dashboard/fi` | 490 | 536 |

**Where it deliberately does not apply.** `/dashboard/deals` (128 words) and `/dashboard/inventory`
(131 words) are already data grids with a caveat line, and `UX.2B` §48 says outright not to enforce a
percentage on a route that is primarily a table. Removing 40 words from either would mean deleting a
caveat, and both routes carry ones that are load-bearing: the Deal Explorer's statement that a
wholesale disposal is shown and labelled as not retail, and Inventory's two-sentence statement that the
aged threshold is a project default and the market estimate is synthetic. Those stay. The measurement
below is recorded so the review can show they did not grow either.

## 4. Route cost, before

Compressed transfer, cold load, route cost alone, production server, Chromium.

| Route | HTML | JS | CSS | Fonts | Other | Total |
|---|---:|---:|---:|---:|---:|---:|
| `/dashboard/sales-gross` | 65.8 kB | 192.5 kB | 16.3 kB | 117.1 kB | 37.1 kB | **428.8 kB** |
| `/dashboard/sales-gross?store=GSA-001&period=2025-11` | 63.8 kB | 192.5 kB | 16.3 kB | 117.1 kB | 41.0 kB | 430.6 kB |
| `/dashboard/deals` | 57.8 kB | 192.5 kB | 16.3 kB | 117.1 kB | 35.3 kB | **418.9 kB** |
| `/dashboard/deals/SLE-00000646` | 46.5 kB | 189.7 kB | 16.3 kB | 117.1 kB | 35.8 kB | **405.4 kB** |
| `/dashboard/inventory` | 73.8 kB | 192.5 kB | 16.3 kB | 117.1 kB | 35.8 kB | **435.5 kB** |
| `/dashboard/inventory?store=GSA-003` | 42.7 kB | 192.5 kB | 16.3 kB | 117.1 kB | 40.6 kB | 409.2 kB |
| `/dashboard/fi` | 47.8 kB | 192.5 kB | 16.3 kB | 117.1 kB | 35.3 kB | **408.8 kB** |

The ~192 kB of script is the framework and the shell; the Deal Jacket's 189.7 kB is the same shell
without the filter island, which that route does not render. **The routes' own visualizations
contribute zero bytes**, because four of the five have no visualizations and the fifth draws its six
figures as server-rendered HTML and CSS. That is the property `DASH.3-02` established, `UX.2A`
preserved, and `UX.2B` §44 and §45 require to be preserved or measured and justified.

## 5. What the first viewport actually contains, before

At 1440 × 900, the complete list of headings, figures and tables whose top edge falls inside the first
900 px:

| Route | First viewport contains |
|---|---|
| `/dashboard/sales-gross` | `h1 Sales & Gross`; `h2 Volume and gross, with the rate that connects them`. Nothing else. |
| `/dashboard/deals` | `h1 Deal Explorer`; `h2 The transactions behind the aggregate`; the top edge of the deal table. |
| `/dashboard/deals/SLE-00000646` | `h1 SLE-00000646`; `h2 The unit that was sold`; `h2 What the vehicle made`. |
| `/dashboard/inventory` | `h1 Inventory`; `h2 The lot at this date`. Nothing else. |
| `/dashboard/fi` | `h1 F&I`; `h2 What the finance office produced`. Nothing else. |

Three of the five routes open with a heading, a control band and a section title, and show the reader
no figure at all before they scroll. On F&I the reader meets **177 words of prose** before the first
number.

## 6. What is already there and is not being rebuilt

`UX.2B` is a presentation increment, and the baseline records what the governed layer already
publishes so the review can be checked against it:

| Surface | Already published, at the grain a visual needs |
|---|---|
| Sales & Gross | Nine performance metrics with comparisons; a daily/weekly/monthly trend carrying units, front, back, total and total PVR per bucket; condition, store and sale-type mixes with units and gross; the deal-gross distribution with median and mean; the `vw_gross_change_bridge` decomposition; the target and selling-day pace context. |
| Deal Explorer | Deal-grain rows with sale price, front, back and total gross, condition, sale type, days in stock, store and lead source; server-side sort, search and paging; the filtered population's count. |
| Deal Jacket | The front-gross component ladder, trade variance held separately, finance reserve, per-contract product rows with original and net gross, the back-gross identity and eight recomputed integrity checks. |
| Inventory | Unit-grain rows at one snapshot carrying days in stock, age bucket, aged flag and threshold, original and current asking price, the synthetic market estimate, the price-to-market ratio, the change since the prior snapshot and inventory investment; and per-bucket unit counts, shares and investment. |
| F&I | Reserve, original product gross and back-end gross on the deal-date basis; retained gross as of the export date; structure counts and shares; per-category eligible deals, attached deals, contracts, penetration, prior penetration and economics; adjustment activity by type and category on the adjustment-date basis; per-manager rows with the governed minimum-sample floor. |

Every one of those is currently rendered as a number in a table or a definition list. **No warehouse
work is needed to draw any of the visuals `UX.2B` asks for**, and the increment's own §55 forbids doing
any that is not first proved necessary.

## 7. The persona audit (`UX.2B` §4)

Each route toured as the person who opens it, against the build measured above. "Visual gap" names
what the reader has to do arithmetic or eye-work for; "`UX.2B` response" is what this increment does
about it, and is the commitment the review is checked against.

### `/dashboard/sales-gross` — General Sales Manager

| | |
|---|---|
| **Primary question** | Did we hit our number, and if the gross moved, was it volume or was it rate? |
| **Current answer** | Nine metric tiles in a three-across grid, all at the same size, each with a comparison line and a `How is this calculated?` disclosure; then targets; then four equal quarter-width trend charts; then three mix tables; then the bridge, 5,900 px down. |
| **Current friction** | Units, total gross and GPRU are the three a GSM reads first and are the fourth, sixth and ninth tiles. Nine equal tiles say nine things matter equally. |
| **Visual gap** | Store contribution and the new/used split are tables of numbers; comparing three stores on three measures is nine cell-to-cell comparisons done by eye. |
| **Text burden** | 891 `proseRepo` words. Eleven `How is this calculated?` summary lines, nine of them in the metric grid. |
| **Drill-through gap** | One prose sentence at the very foot of a 7,228 px page links to the Deal Explorer, and it carries no filter state. |
| **`UX.2B` response** | Three-plus-six KPI rail; one large trend with a measure switch; new/used and store contribution as grouped comparisons; the bridge promoted into the second screen; a drill-through that carries period and store. |

### `/dashboard/deals` — Sales Manager / Desk Manager

| | |
|---|---|
| **Primary question** | Show me the deals behind that number — and which ones are unusual. |
| **Current answer** | A search form, five filter controls, a section header, then a ten-column table of 25 rows. |
| **Current friction** | The filtered population's size is a chip in the page header (`650 deals`) and nowhere near the table. What that population is *worth* is not stated at all. |
| **Visual gap** | None asked for: this route is an investigation surface and the table is correct. What is missing is the summary strip that tells a desk manager whether the filter they applied is the one they meant. |
| **Text burden** | 128 words. Already low, and the caveat in it (a wholesale disposal is shown and labelled not retail) is load-bearing. |
| **Drill-through gap** | Deal id → Deal Jacket works. Nothing else does. |
| **`UX.2B` response** | A compact control bar, a summary strip over the filtered population, a re-ranked table, a deliberate mobile pattern. No chart wall. |

### `/dashboard/deals/[saleId]` — Sales Manager reviewing a deal

| | |
|---|---|
| **Primary question** | What did this deal make, and where did it come from? |
| **Current answer** | An identity block, then a two-column layout: vehicle, staff and timeline on the left; front gross, trade, finance, products, back gross and total gross on the right; then eight integrity checks and a lineage disclosure. |
| **Current friction** | Sale price, front gross, back gross, total gross and days in stock are five numbers a reviewer wants at once, and they are in four different sections spread over 5,806 px. Ten `h2`s of equal weight. |
| **Visual gap** | The front-gross ladder is an exact and well-built calculation table that shows no shape: a reader cannot see that recon was the large deduction without reading four rows. |
| **Text burden** | 616 `proseRepo` words on one transaction. Six section ledes explaining the method precede the figures they qualify. |
| **Drill-through gap** | Back to the index only. |
| **`UX.2B` response** | An identity header carrying the five figures; the front ladder and the back composition as visuals beside their exact tables; trade kept visibly outside the front identity; verification subordinated to a disclosure without losing a single check. |

### `/dashboard/inventory` — Used Vehicle Manager

| | |
|---|---|
| **Primary question** | How much money is sitting on the lot, how old is it, and which units are the problem? |
| **Current answer** | Four stat cells, a four-column age table, then an 11,543 px unit table. |
| **Current friction** | The single densest domain in the project is rendered as two tables. Age, capital and price-to-market are all published at unit grain and none of them is drawn. |
| **Visual gap** | Total. Age distribution, capital by age, and the age × price-to-market relationship are all buildable from what is already exported and none exists. |
| **Text burden** | 131 words, and both caveat sentences in it are load-bearing. No reduction target. |
| **Drill-through gap** | Unit → the same route with `?unit=`, which renders a panel 3,000 px above where the reader clicked. |
| **`UX.2B` response** | A KPI rail; the age stack with its capital track; the age × price-to-market map if — and only if — every axis resolves at one grain and one snapshot; a price-movement visual; the unit table kept exact and made scannable. |

### `/dashboard/fi` — F&I Director

| | |
|---|---|
| **Primary question** | What is back PVR made of, and where is the attachment opportunity? |
| **Current answer** | Eight production figures, a composition definition list, a structure table, a penetration table, a category economics table, an adjustment table, a manager table, four methodology disclosures. |
| **Current friction** | 177 words of prose before the first number — the highest first-viewport prose count in the console. Six visible tables of equal visual weight. |
| **Visual gap** | Reserve against product, the structure mix and per-category penetration are three comparisons rendered as three tables. Penetration in particular is a set of proportions with different denominators, which is precisely what a bar with both sides printed is for. |
| **Text burden** | 700 `proseRepo` words. Eight section ledes, several of which restate a caveat the disclosures below already carry in full. |
| **Drill-through gap** | None out of the route at all. |
| **`UX.2B` response** | A three-plus-three KPI rail; reserve/product composition; structure mix; penetration as a bar per category with both sides of every ratio; adjustments as signed bars on their own basis; the three date bases made visible as labels rather than as a paragraph; manager rows unranked and the sample floor preserved. |

---

Power BI real-engine validation remains externally pending; this document does not alter that state.
