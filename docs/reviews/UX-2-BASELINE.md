# `UX.2` — measured baseline

The state of the Executive Command Center **before** `UX.2A`, measured against `main` at
`db094164012fe555489d65ac289c71ebd901b91c` — the merge of `DASH.12` (PR #59) — from a production
build (`next build`, `next start -p 3111`), Chromium, viewport 1440 × 900 for desktop figures and
390 × 844 for mobile.

Recorded rather than described, for the reason [`UX-1-BASELINE.md`](UX-1-BASELINE.md) gives: the
increment's claims are comparative, and a comparison against a remembered baseline is not a
measurement. The after-figures are in [`UX-2A-REVIEW.md`](UX-2A-REVIEW.md).

The measurement harness was scratch and was removed before merge, per the standing instruction not
to commit scratch tooling. It loaded the route in Chromium at each viewport and read the numbers
below off the rendered document.

---

## 1. Three prose counts, because three definitions are in circulation

`UX.1` reported "2,523 visible prose words" on this surface. Re-running its collector semantics on
today's `main` gives **3,002**, and the growth is real: `DASH.12` added the management-attention
region. But that collector counts every `<p>` inside `<main>` with a non-zero box, and a Tailwind
`.sr-only` paragraph is a 1 × 1 px box — so it counts the accessible chart summaries a sighted
reader never meets. Nearly two thirds of its total is text that is, by construction, invisible.

Three counts are therefore recorded, and `UX.2A`'s reduction target is held against the two that
describe the eye path:

| Definition | Desktop words | Desktop paragraphs | Mobile words |
|---|---:|---:|---:|
| **`proseRepo`** — the repository's own definition, from `dashboard.spec.ts`: a rendered paragraph of eight words or more, outside `.sr-only` and outside a closed `<details>`. Shorter paragraphs are labels, units and values. | **945** | 43 | 945 |
| **`proseEye`** — every rendered paragraph outside `.sr-only` and outside a closed `<details>`, at any length. | **1,130** | 106 | 1,125 |
| `proseUx1` — `UX.1`'s collector: every `<p>` with a non-zero box, including `.sr-only`. Recorded for continuity with `UX-1-REVIEW.md` §1 and not used as a target. | 3,002 | 169 | 3,025 |

**`UX.2A` holds its ≥35% reduction against `proseRepo` and `proseEye`.** The ceilings that follow
from today's figures are **614** and **734** respectively. `proseUx1` is expected to *rise*, because
`UX.2A` adds visualizations and every visualization adds an accessible summary that
[`ACCESSIBILITY.md`](../../portfolio/docs/ACCESSIBILITY.md) forbids deleting; a target held against
it would be a target to delete accessible text.

## 2. Geometry, before

| Measure | 1440 × 900 | 390 × 844 |
|---|---:|---:|
| First framed figure (`<figure>` or `svg[role="img"]`), px from top | **1,389** | 3,681 |
| Framed figures on the route | 8 | 8 |
| Framed figures whose top is inside the first viewport | **0** | **0** |
| Data-driven visual regions inside the first viewport | **0** | **0** |
| Prose words inside the first viewport (`proseEye`) | 98 | 38 |
| Document height | 8,161 | 15,426 |

**The number that drives `UX.2A` is the pair of zeros.** At 1440 × 900 a general manager opening `/`
sees a control band, a notice stack, a filter form and seven KPI cards — and not one framed
visualization, not one comparison, not one shape. The first is 1,389 px down, which is one and a half
screens. The document below it is 8,161 px — nine screens — and on a phone it is 15,426 px.

Under the filter `?store=GSA-001&period=2025-11` the figures barely move: first figure 1,401 px,
height 7,823 px, `proseRepo` 970. The layout does not respond to what is being asked of it.

## 3. Composition, before

| Element | Count |
|---|---:|
| `<h2>` regions | 5 |
| Visible `<h3>` headings | 32 |
| `<details>` elements | 37 |
| Visible `<summary>` lines reading "How is this calculated?" | 20 |
| Visible `<table>` elements | 6 |
| KPI cards in the primary rail | 7 |
| Metric cards on the route (rail 7 + inventory 8 + response 4 + gross 1 + plan 2) | 22 |
| Client islands | 1 (`FilterBar`) |
| Client JavaScript owned by the route's visualizations | 0 bytes |

Twenty identical `How is this calculated?` summary lines is the shape of the problem in one row: the
methodology is correctly available and is repeated twenty times in the eye path.

The five regions are the `UX.1` rhythm — `CONTROL`, `PERFORMANCE`, `PLAN & STOCK`, `DEMAND`,
`INTEGRITY`, with `DASH.12`'s attention region making a sixth band inside the fourth. Each is a
full-width horizontal band stacked on the one before it, so on desktop the page is a single column
of wide rows: an article with figures in it rather than a workspace.

## 4. Route cost, before

Compressed transfer, cold load, route cost alone (`npm run bundle`, production server).

| Route | HTML | JS | CSS | Fonts | Total |
|---|---:|---:|---:|---:|---:|
| `/` | 135.6 kB | 171.2 kB | 15.6 kB | 114.3 kB | **437.9 kB** |
| `/?store=GSA-001&period=2025-11&condition=Used` | 123.5 kB | 171.2 kB | 15.6 kB | 114.3 kB | 425.9 kB |

The 171.2 kB of script is the framework and the shell. The route's own visualizations contribute
**zero bytes**: every chart on this page is a server component drawing HTML and CSS, which is the
property `DASH.3-02` established and `UX.2A` is required to preserve or to justify changing.

## 5. What the first viewport actually contains, before

At 1440 × 900, top to bottom: the operating rail; `Executive`; the scope line
(`Granite Auto Group, all three stores · December 2025 · vs November 2025`); the synthetic-demo
disclosure summary; the filter form (five controls and an Apply button); the region eyebrow
`Group performance`; the `h2` `Result, shape and store contribution`; a 34-word colour-legend lede;
and the top edge of the first three KPI cards.

No comparison. No trend. No plan. No stock position. No funnel. No attention. The reader has been
told what they are about to look at and has not yet been shown any of it.

---

Power BI real-engine validation remains externally pending; this document does not alter that state.
