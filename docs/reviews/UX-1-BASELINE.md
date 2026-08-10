# `UX.1` — measured baseline

The state of the product experience **before** `UX.1`, measured against `main` at
`f5a1eac61ef1e358473151bd32ad4418e818c22c` from a production build (`next build`, `next start`),
Chromium, viewport 1440 × 900 for desktop figures and 390 × 844 for mobile.

Recorded here rather than described, because the increment's claims are comparative and a comparison
against a remembered baseline is not a measurement. The after-figures are in
[`UX-1-REVIEW.md`](UX-1-REVIEW.md).

The measurement tooling was scratch: a Playwright script that loaded each route, counted visible
`<p>` text inside `<main>`, counted `<figure>` and `svg[role="img"]` elements, and read the scroll
offset of the first of them. It was removed before merge, per the increment's own instruction not to
commit scratch tooling; the results it produced are these tables. Two caveats worth stating so the
numbers are read correctly:

- **"Visible prose" excludes** table cells, chart labels, navigation, filter labels and any text
  inside a collapsed `<details>` — a paragraph in a closed disclosure has a zero-height box and is
  not counted. It is the prose a reader actually meets.
- **"Visualizations" undercounts.** The collector looked for `<figure>` and `svg[role="img"]`, and
  most ARPI primitives are HTML/CSS marks rather than SVG. The counts below are therefore a *lower
  bound* and are comparable to each other, not absolute. The `firstY` column is the load-bearing one
  and is not affected: the first `<figure>` is the first framed visual either way.

---

## 1. Density, before

| Route | Prose words | Paragraphs | Visuals | First visual (px) | Desktop height (px) | Mobile height (px) | Fold prose 1440 | Fold prose 390 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` (marketing home) | 651 | 32 | 5 | 365 | 5,906 | 9,063 | 88 | 65 |
| `/dashboard` | 2,636 | 144 | 8 | **2,194** | 7,947 | 15,479 | 32 | 32 |
| `/dashboard/sales-gross` | 1,331 | 93 | 6 | 3,412 | 7,631 | 12,770 | 67 | 67 |
| `/dashboard/deals` | 196 | 12 | 0 | — | 3,328 | 9,915 | 51 | 51 |
| `/dashboard/deals/SLE-00000646` | 909 | 40 | 0 | — | 6,142 | 10,690 | 76 | 59 |
| `/dashboard/inventory` | 336 | 18 | 0 | — | 12,358 | 13,534 | 77 | 58 |
| `/dashboard/fi` | 1,345 | 60 | 0 | — | 7,320 | 10,332 | 60 | 60 |
| `/dashboard/leads-marketing` | 2,248 | 76 | 7 | 1,659 | 9,324 | 13,445 | 82 | 63 |
| `/dashboard/employees` | 1,038 | 31 | 0 | — | 6,189 | 10,853 | 84 | 65 |
| `/dashboard/accounting` | 665 | 30 | 0 | — | 4,088 | 6,400 | 81 | 62 |
| `/inventory` | 342 | 16 | 3 | 1,758 | 3,722 | 5,937 | 95 | 76 |
| `/architecture` | 1,000 | 35 | 0 | — | 10,405 | 16,779 | 98 | 86 |
| `/data-model` | 199 | 7 | 0 | — | 7,190 | 14,317 | 104 | 92 |
| `/kpis` | 369 | 15 | 0 | — | 2,576 | 4,150 | 209 | 70 |
| `/governance` | 1,269 | 47 | 0 | — | 6,607 | 10,650 | 139 | 54 |
| `/status` | 1,537 | 66 | 0 | — | 9,703 | 16,004 | 80 | 59 |
| `/about` | 966 | 37 | 0 | — | 5,439 | 9,365 | 131 | 119 |
| `/technical` | — | — | — | — | — | — | — | — (404) |

**Operating total: 10,704 visible prose words across 504 paragraphs on nine routes.**

**The number that drove the increment is 2,194.** On the flagship operating surface, at 1440 × 900,
the first framed visualization began two and a half screens down. Above it: a breadcrumb, an eyebrow
reading "Dealer Operations Command Center", an `h1` reading "How the group is performing, and which
store needs attention", a lede, three provenance badges (dataset version, export as-of date,
real-engine validation state), a trust line, a context rail carrying the contract fingerprint, and a
filter grammar disclosure.

The desktop console was 7,947 px — 8.8 screens — and the mobile console was 15,479 px.

## 2. Implementation vocabulary in rendered operating copy, before

Counted from served HTML with tags stripped, on each operating route. This scan did not distinguish
visible text from text inside a collapsed disclosure, so it over-counts relative to the guard `UX.1`
added; it is included because it is what identified the problem.

| Route | Terms found |
|---|---|
| `/dashboard` | PostgreSQL ×4, DAX ×3, semantic model ×5, dataset version ×2, reporting view ×20, SQL ×9, Power BI ×9, warehouse ×34, export ×83, schema ×3, ADR- ×5, KPI- ×142 |
| `/dashboard/sales-gross` | semantic model ×1, reporting view ×1, SQL ×3, Power BI ×1, export ×9, KPI- ×40 |
| `/dashboard/deals` | semantic model ×1, SQL ×1, Power BI ×1, export ×4 |
| `/dashboard/deals/[saleId]` | contract fingerprint ×1, semantic model ×1, dataset version ×2, reporting view ×1, SQL ×1, Power BI ×1, warehouse ×6, RECON- ×1 |
| `/dashboard/inventory` | semantic model ×1, SQL ×1, Power BI ×1, export ×3 |
| `/dashboard/fi` | semantic model ×1, SQL ×1, Power BI ×1, warehouse ×1, KPI- ×12 |
| `/dashboard/leads-marketing` | semantic model ×1, SQL ×2, Power BI ×1, warehouse ×1, KPI- ×16 |
| `/dashboard/employees` | semantic model ×1, SQL ×1, Power BI ×1, export ×5 |
| `/dashboard/accounting` | semantic model ×1, SQL ×1, Power BI ×1, export ×4 |

The constant floor of `semantic model ×1, SQL ×1, Power BI ×1` on all nine routes came from one
component: `<TrustLine>`, rendered by `<PageHeader>` on every route including every operating one.

## 3. Route cost, before

Compressed transfer per route, measured by loading each in Chromium and summing request sizes
(`npm run bundle`). Columns: HTML, script, stylesheet, font, total.

| Route | HTML | Script | CSS | Fonts | Total |
|---|---:|---:|---:|---:|---:|
| `/dashboard` | 134.5 kB | 317.9 kB | 15.5 kB | 114.3 kB | **680.6 kB** |
| `/dashboard?store=GSA-001&period=2025-11&condition=Used` | 121.9 kB | 317.9 kB | 15.5 kB | 114.3 kB | 671.2 kB |
| `/dashboard/inventory?unit=VEH-0000005` | 76.6 kB | 317.9 kB | 15.5 kB | 114.3 kB | 623.4 kB |
| `/dashboard/inventory` | 74.5 kB | 317.9 kB | 15.5 kB | 114.3 kB | 620.3 kB |
| `/dashboard/sales-gross` | 66.7 kB | 317.9 kB | 15.5 kB | 114.3 kB | 612.7 kB |
| `/dashboard/leads-marketing` | 65.1 kB | 317.9 kB | 15.5 kB | 114.3 kB | 610.9 kB |
| `/dashboard/deals` | 58.6 kB | 317.9 kB | 15.5 kB | 114.3 kB | 604.4 kB |
| `/governance` | 29.9 kB | 328.0 kB | 15.5 kB | 114.3 kB | 601.3 kB |
| `/architecture` | 27.2 kB | 328.0 kB | 15.5 kB | 114.3 kB | 598.6 kB |
| `/dashboard/fi` | 48.7 kB | 317.9 kB | 15.5 kB | 114.3 kB | 596.4 kB |
| `/data-model` | 24.6 kB | 328.0 kB | 15.5 kB | 114.3 kB | 596.0 kB |
| `/dashboard/employees` | 46.5 kB | 317.9 kB | 15.5 kB | 114.3 kB | 592.3 kB |
| `/dashboard/deals/SLE-00000646` | 47.0 kB | 315.7 kB | 15.5 kB | 114.3 kB | 591.1 kB |
| `/dashboard/accounting` | 33.4 kB | 317.9 kB | 15.5 kB | 114.3 kB | 582.8 kB |
| `/status` | 38.0 kB | 314.5 kB | 15.5 kB | 114.3 kB | 572.9 kB |
| `/` | 34.3 kB | 314.5 kB | 15.5 kB | 114.3 kB | 569.2 kB |
| `/case-study` | 26.4 kB | 314.5 kB | 15.5 kB | 114.3 kB | 562.1 kB |
| `/about` | 26.9 kB | 314.5 kB | 15.5 kB | 114.3 kB | 561.8 kB |
| `/kpis` | 20.9 kB | 314.5 kB | 15.5 kB | 114.3 kB | 555.8 kB |

Heaviest: `/dashboard` at 680.6 kB. Lightest: `/kpis` at 555.8 kB.

The script figure is dominated by the shared framework bundle plus the header prefetching all seven
navigation destinations; the per-route differences are 0–13 kB.

## 4. Information architecture, before

**Header navigation (7 items, at the declared ceiling of 7):**
Overview · Dashboard · Inventory · Platform · KPIs · Status · About

**Console sub-navigation (8 items), rendered inside `/dashboard*` page headers:**
Command center · Sales and gross · Deal Explorer · F&I · Inventory · Leads and marketing ·
Employees · Accounting

**Routes: 22** (21 + the internal UI lab).

Four structural problems, each verified in the running application:

1. **The front door was a brochure.** `/` was a hero, a store story, a four-route product tour and a
   closing call to action, 5,906 px tall. The working application was one click behind it.
2. **The navigation offered two kinds of thing as one kind.** A dealership manager choosing a
   destination was offered "Inventory" and "Governance" with equal weight.
3. **Two destinations were called Inventory.** `/inventory` was sanitized public listing reference
   data (ADR-0011). `/dashboard/inventory` was the synthetic operating stock position. Nothing in
   either label distinguished them before opening one.
4. **Filters did not survive a navigation.** Every console route rendered its own filter form and
   every link between two routes was a bare pathname. A general manager who selected December and
   the Manchester store on the Executive surface rebuilt that selection on every subsequent route.

## 5. Persona tour findings

Recorded in full, question by question, in [`../product/PRODUCT_GAPS.md`](../product/PRODUCT_GAPS.md)
§1. The summary: **every operating question the six personas asked was answerable**, and the problems
were where the answer was, how long it took to reach, and how much implementation language stood in
front of it. The exceptions — the questions the model genuinely cannot answer — are the CFO's, and
they are stated in full in that document's §4.

---

Power BI real-engine validation remains externally pending; this document does not alter that state.
