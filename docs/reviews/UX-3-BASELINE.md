# `UX.3` — measured baseline

The state of every public route and route state **before** `UX.3`, measured against `main` at
`132882b34d6814a19fa96d1a3c41bf2e5b23e6ef` from a production build (`next build`,
`next start`), Chromium, 1440 × 900 for the desktop figures and 390 × 844 for the mobile ones.

Recorded rather than described, for the reason [`UX-1-BASELINE.md`](UX-1-BASELINE.md) gives and
every baseline since has repeated: the increment's claims are comparative, and a comparison
against a remembered baseline is not a measurement. The after-figures are in
[`UX-3-REVIEW.md`](UX-3-REVIEW.md).

---

## 0. The harness is committed this time, and that is a deliberate departure

Every UX increment before this one measured itself with a scratch harness and removed it before
merge. [`UX-2-REVIEW.md`](UX-2-REVIEW.md) then recorded what that cost:

> **Each increment measured itself with its own scratch harness, and the four harnesses do not
> all agree to the pixel.** […] the prose counts do not always, by up to about 70 words on the
> longest routes.

So `UX.3` keeps its harness in the repository as
[`portfolio/scripts/measure-ux.ts`](../../portfolio/scripts/measure-ux.ts) and
[`portfolio/scripts/dump-long-prose.ts`](../../portfolio/scripts/dump-long-prose.ts). Neither runs
in continuous integration and neither is a test; they are review instruments, and the argument for
committing them is precisely the finding above — a measurement nobody can re-run is a measurement
the next increment has to take on trust.

### What the harness counts

* **`proseWords`** — words inside a rendered `<p>` that is visible, is not inside an
  `aria-hidden` subtree, and **is not inside a collapsed `<details>`**. A KPI value, a table cell,
  a chip and an axis label are text and none of them is what this increment reduces; counting them
  would score a dense dashboard as more verbose than an essay.
* **`paragraphs`, `longest`, `>50w`** — the same population, by count, by longest, and by how many
  exceed the fifty-word editorial line.
* **`first visual` / `visuals in fold` / `visuals`** — a framed visual region at least 120 px wide
  and 60 px tall: `<svg>`, `<img>`, `<figure>`, `<table>`, or an element carrying the operating
  console's own `[data-visual-region]` hook. Nested matches collapse to the outermost, so one chart
  built from forty marks counts once. The 120 × 60 floor is what excludes the icon set.
* **`overflow`** — horizontal overflow in the WCAG 1.4.10 sense, using the same detector as
  `tests/e2e/accessibility.spec.ts`.

### Two measurement caveats, stated because they change how a row reads

1. **The collapsed-`<details>` rule was wrong in the first run of this harness and is right here.**
   Chromium hides a closed disclosure's body with `content-visibility` on the details slot rather
   than with `display: none`, and it keeps reporting a non-zero box for the descendants. A detector
   that checks only `display`, `visibility` and box size therefore counts every methodology
   disclosure on the operating console as visible prose. Both tables below use the corrected rule.
   The practical effect is large: `/dashboard/leads-marketing` scores 752 words under the corrected
   rule and 1,826 under the broken one.
2. **At 390 px the three store routes and `/inventory` report inflated `proseWords`.** Their
   inventory tables become per-record cards on a phone, and each field in a card is a `<p>`. Those
   paragraphs are data, not prose. The before and after columns are affected identically, so the
   comparison holds, but the absolute figure for those four rows is not an editorial measurement.

---

## 1. The number that drives the increment

**Six of the eight technical views, the About page, the case study and one store page contained no
framed visual region inside the first viewport at 1440 × 900.** On a phone the position of the first
one ranged from 1,272 px to 4,021 px.

| Route                            | Visuals on the route | In the first viewport, 1440 | First visual, 1440 | First visual, 390 |
| -------------------------------- | -------------------: | --------------------------: | -----------------: | ----------------: |
| `/technical?view=status`         |                    1 |                       **0** |              1,386 |         **4,021** |
| `/technical?view=data-sources`   |                    2 |                       **0** |              1,613 |         **3,157** |
| `/technical?view=kpis`           |                    1 |                       **0** |                944 |         **3,015** |
| `/technical?view=governance`     |                    1 |                           1 |                609 |             2,601 |
| `/technical?view=architecture`   |                    2 |                       **0** |                950 |             1,438 |
| `/technical?view=data-model`     |                    2 |                           1 |                595 |             2,049 |
| `/technical` (overview)          |                    6 |                           1 |                592 |             1,932 |
| `/technical?view=product-vision` |                    1 |                           1 |                 15 |             1,107 |
| `/about`                         |                **1** |                           1 |                680 |             2,185 |
| `/case-study`                    |                    2 |                           1 |                509 |             1,594 |
| `/inventory`                     |                    5 |                           1 |                120 |             1,473 |
| `/dealerships/granite-pre-owned` |                    4 |                       **0** |                913 |             1,802 |
| `/dealerships/granite-subaru`    |                    4 |                           1 |                639 |             1,272 |
| `/dealerships/granite-chevrolet` |                    4 |                           1 |                143 |             1,722 |

**The About page draws one visual on a 6,330 px document, and it is the author's portrait, 680 px
down.** That is the whole visual content of the page whose job is to make a stranger believe a
person is credible within a few seconds.

**The operating console is not in this table, because it does not have the problem.** Every
operating route already meets the reader with geometry: `/dashboard/accounting` at 7 px,
`/dashboard/sales-gross` at 76 px, `/dashboard/leads-marketing` at 69 px with five regions inside
the first screen. That is the outcome of `UX.2A` through `UX.2D`, and this increment's job on those
routes is to not undo it.

---

## 2. Editorial density

**Eleven paragraphs on the governance view exceed fifty words, and the longest is 124.**

| Route                            | Prose words | Paragraphs | Longest |    Over 50 words |
| -------------------------------- | ----------: | ---------: | ------: | ---------------: |
| `/technical?view=data-sources`   |       1,637 |        106 |      58 |                1 |
| `/technical?view=status`         |       1,581 |         70 |      73 |                2 |
| `/technical?view=governance`     |       1,530 |         53 | **124** |           **11** |
| `/technical?view=architecture`   |       1,057 |         39 |      80 |                1 |
| `/about`                         |       1,039 |         41 |      78 |                4 |
| `/`                              |         866 |         77 |      60 |                1 |
| `/dashboard/actions`             |         809 |         58 |      52 |                1 |
| `/dashboard/leads-marketing`     |         752 |         56 |      73 |                2 |
| `/dashboard/sales-gross`         |         751 |         65 |      54 |                1 |
| `/case-study`                    |         651 |         30 |      65 |                3 |
| `/dashboard/fi`                  |         627 |         41 |      86 |                4 |
| `/technical?view=kpis`           |         500 |         21 |      64 |                2 |
| `/technical?view=product-vision` |         445 |         28 |      67 |                1 |
| `/inventory`                     |         427 |         23 |      82 |                2 |

**Twenty-eight of the sixty-nine over-length paragraphs on the site are on the eight technical
views, and twelve of those are on governance alone.** The operating routes contribute nineteen, and
most of those are either a chart's text alternative — a figure's exact values written out, which is
an accessibility requirement rather than prose — or an exception description that the governed
export itself authored and this site renders verbatim.

### The one paragraph that appeared four times

`INVENTORY_DATA_STATEMENT` is 82 words. Before `UX.3` it was rendered in full on
`/technical?view=governance`, on `/inventory`, and on all three store pages — five appearances of
one paragraph, three of them on routes whose subject is something else, and all five on routes whose
page header already carries the short form of the same statement in its trust line.

---

## 3. Document heights, for completeness

| Route                            | Height, 1440 | Height, 390 |
| -------------------------------- | -----------: | ----------: |
| `/`                              |        5,399 |       8,968 |
| `/dashboard/sales-gross`         |        3,266 |       6,606 |
| `/dashboard/deals`               |        2,566 |       8,857 |
| `/dashboard/inventory`           |        2,256 |       3,295 |
| `/dashboard/fi`                  |        3,393 |       5,557 |
| `/dashboard/leads-marketing`     |        3,931 |       6,617 |
| `/dashboard/employees`           |        4,015 |       5,845 |
| `/dashboard/accounting`          |        2,281 |       3,797 |
| `/dashboard/actions`             |        7,417 |      17,227 |
| `/technical`                     |        6,152 |      10,302 |
| `/technical?view=architecture`   |       11,263 |      18,961 |
| `/technical?view=data-model`     |        7,917 |      16,174 |
| `/technical?view=kpis`           |        8,540 |      15,606 |
| `/technical?view=governance`     |        8,015 |      13,577 |
| `/technical?view=data-sources`   |       12,350 |      19,181 |
| `/technical?view=status`         |       10,548 |      18,179 |
| `/technical?view=product-vision` |        3,525 |       6,767 |
| `/about`                         |        6,330 |      11,538 |
| `/case-study`                    |        5,181 |       9,007 |
| `/inventory`                     |        5,712 |      17,019 |
| `/dealerships/granite-chevrolet` |        5,150 |       8,271 |
| `/dealerships/granite-subaru`    |        5,150 |       8,355 |
| `/dealerships/granite-pre-owned` |        5,280 |       8,616 |

Horizontal overflow was **zero on every route at both viewports**, before and after. There was no
problem to fix there and none was introduced.

---

## 4. What the baseline says the increment is

Not a redesign of the operating console. That work is done, it is measured in
[`UX-2A`](UX-2A-REVIEW.md) through [`UX-2D`](UX-2D-REVIEW.md), and the numbers above say it holds.

The increment is the **reference half of the site**: eight technical view states, the author page,
the case study, the listing explorer and three store pages, all of which still open on prose and
argue at length for things a structure could show. Plus one editorial sweep across the whole site
for a paragraph repeated on routes it does not belong to.

---

Power BI real-engine validation remains externally pending; this document does not change that
state and its `/technical?view=status` figures describe the page rather than the gate.
