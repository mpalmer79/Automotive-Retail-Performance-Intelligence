# `UX.2D` — measured baseline

The state of the operating application **before** `UX.2D`, measured against `main` at
`9c109b677725c629d6e041521a40e4c2334679c5` — the merge of `UX.2C` (PR #65) — from a production
build (`next build`, `next start -p 3311`), Chromium, at the eight widths the console's responsive
suite already uses and with 390 × 844 and 1440 × 900 as the two reported viewports.

Recorded rather than described, for the reason [`UX-1-BASELINE.md`](UX-1-BASELINE.md),
[`UX-2-BASELINE.md`](UX-2-BASELINE.md), [`UX-2B-BASELINE.md`](UX-2B-BASELINE.md) and
[`UX-2C-BASELINE.md`](UX-2C-BASELINE.md) give: the increment's claims are comparative, and a
comparison against a remembered baseline is not a measurement. The after-figures are in
[`UX-2D-REVIEW.md`](UX-2D-REVIEW.md).

The measurement harness was scratch and was removed before merge, per the standing instruction not
to commit scratch tooling. It loaded each route in Chromium at each viewport, scrolled the document
to fire every reveal, returned to the top and read the numbers below off the rendered document.

## Definitions

Unchanged from `UX-2-BASELINE.md` §1 where they carry over, with three that are new to this
increment because `UX.2D` is about the control surface rather than about the content.

- **`proseRepo`** — the repository's own definition, from `dashboard.spec.ts`: a rendered
  paragraph of eight words or more, outside `.sr-only` and outside a closed `<details>`.
- **`proseEye`** — every rendered paragraph outside `.sr-only` and outside a closed `<details>`,
  at any length.
- **Band height** — the height of the first `<section>` of `<main>`: everything the operating
  shell puts above the data canvas. Title, subtitle, scope line, methodology summary, notices,
  active-filter chips, the filter form and any control form the route owns. **This is the number
  `UX.2D` §6 is aimed at.**
- **Form height** — the shared `<form aria-label="Dashboard filters">` alone, inside the band.
- **First visual** — the top edge of the first `[data-visual-region]`, the hook `UX.2A`
  introduced, in pixels from the top of the document.
- **Route cost** — total bytes received, uncompressed, cold load, production server. `UX-2B`
  and `UX-2C` reported compressed transfer; this harness reports raw bytes, which is a
  different convention and is stated here rather than silently compared against theirs. The
  before/after comparison in the review uses this harness at both ends.

---

## 1. The number that drives the increment

Band height at 390 × 844, against a screen that is 844 px tall:

| Route                        | Band, 390 | Share of one phone screen | First visual, 390 |
| ---------------------------- | --------: | ------------------------: | ----------------: |
| `/dashboard/actions`         |       245 |                       29% |               321 |
| `/dashboard/deals/[saleId]`  |       322 |                       38% |               398 |
| `/`                          |       548 |                       65% |               624 |
| `/dashboard/sales-gross`     |       565 |                       67% |               641 |
| `/dashboard/deals`           |       631 |                       75% |                 — |
| `/dashboard/employees`       |       711 |                       84% |               787 |
| `/dashboard/accounting`      |       718 |                       85% |               794 |
| `/dashboard/leads-marketing` |       721 |                       85% |               797 |
| `/dashboard/fi`              |       753 |                       89% |               829 |
| `/dashboard/inventory`       |   **921** |                  **109%** |           **997** |

**On seven of the ten operating routes the controls consume two thirds or more of a phone screen
before the reader sees a figure, and on Inventory the control band alone is taller than the
screen.** `UX.2B` measured that band at approximately 985 px and fixed the two controls Inventory
owns; the figure is 921 px after `UX.2C`, so the route-level fix moved it 64 px and the shared
band is the remaining 900.

**The two routes that do well are the two that carry no shared filter form.** `/dashboard/actions`
filters through facet links inside its workspace and the Deal Jacket filters nothing at all. That
is the finding stated as plainly as it can be: the control band, not the content, is what a phone
reader scrolls past.

**No operating route puts a complete `[data-visual-region]` inside the first mobile screen.** At
1440 × 900 eight of ten do.

## 2. Geometry, before

| Route                        | Band 390 | Band 1440 | Form 390 | Form 1440 | Height 390 | Height 1440 | 1st visual 390 | 1st visual 1440 | Visuals | `proseRepo` | `<details>` | Tables | Tab stops 1440 |
| ---------------------------- | -------: | --------: | -------: | --------: | ---------: | ----------: | -------------: | --------------: | ------: | ----------: | ----------: | -----: | -------------: |
| `/`                          |      548 |       230 |      298 |        93 |      9,066 |       4,955 |            624 |             246 |      10 |         601 |          22 |      0 |             60 |
| `/dashboard/sales-gross`     |      565 |       254 |      387 |       147 |      7,139 |       3,260 |            641 |             270 |       8 |         634 |          13 |      0 |             38 |
| `/dashboard/deals`           |      631 |       355 |      369 |       165 |      9,326 |       2,561 |              — |               — |       0 |         147 |           2 |      1 |             58 |
| `/dashboard/deals/[saleId]`  |      322 |       267 |        — |         — |      8,250 |       3,881 |            398 |             283 |       3 |         376 |           6 |      1 |             24 |
| `/dashboard/inventory`       |  **921** |       494 |      351 |       147 |      3,892 |       2,325 |        **997** |             510 |       4 |         306 |           5 |      0 |             30 |
| `/dashboard/fi`              |      753 |       369 |      422 |       182 |      5,999 |       3,455 |            829 |             385 |       5 |         418 |          11 |      3 |             42 |
| `/dashboard/leads-marketing` |      721 |       373 |      437 |       197 |      7,187 |       3,998 |            797 |             389 |       8 |         546 |          15 |      0 |             36 |
| `/dashboard/employees`       |      711 |       431 |      458 |       271 |      6,311 |       4,169 |            787 |             447 |       3 |         249 |           2 |      0 |             38 |
| `/dashboard/accounting`      |      718 |       428 |      476 |       236 |      4,228 |       2,408 |            794 |             444 |       3 |         425 |           3 |      1 |             28 |
| `/dashboard/actions`         |      245 |       234 |        — |         — |     17,243 |       7,405 |            321 |             250 |       2 |         794 |          52 |      0 |            129 |
| `/technical`                 |      663 |       502 |        — |         — |     10,088 |       6,123 |              — |               — |       0 |         414 |           4 |      1 |             77 |
| `/about`                     |    1,091 |       691 |        — |         — |     11,483 |       6,302 |              — |               — |       0 |         914 |           0 |      0 |             53 |

**The desktop band ranges from 230 px to 494 px across eight routes carrying the same four
controls.** That spread is not a domain difference. It is the shared filter form (93 px to 271 px,
also on the same four controls) plus whatever each route decided to stack underneath it.

**No horizontal page overflow at any of the eight widths on any route.** That contract, from
`UX.1`, still holds and is the one part of the responsive matrix this baseline found clean.

## 3. Route cost, before

Total bytes, uncompressed, cold load, production server, 1440 × 900.

| Route                        |     HTML |         JS |    CSS |      Total |
| ---------------------------- | -------: | ---------: | -----: | ---------: |
| `/`                          | 615.3 kB |   631.0 kB | 87.5kB | 1,563.3 kB |
| `/dashboard/sales-gross`     | 337.9 kB |   631.0 kB | 87.5kB | 1,291.2 kB |
| `/dashboard/deals`           | 326.7 kB |   631.0 kB | 87.5kB | 1,274.7 kB |
| `/dashboard/deals/[saleId]`  | 218.0 kB |   624.6 kB | 87.5kB | 1,159.5 kB |
| `/dashboard/inventory`       | 781.8 kB |   631.0 kB | 87.5kB | 1,734.8 kB |
| `/dashboard/fi`              | 253.5 kB |   631.0 kB | 87.5kB | 1,206.8 kB |
| `/dashboard/leads-marketing` | 442.1 kB |   631.0 kB | 87.5kB | 1,395.1 kB |
| `/dashboard/employees`       | 248.0 kB |   631.0 kB | 87.5kB | 1,196.0 kB |
| `/dashboard/accounting`      | 158.0 kB |   631.0 kB | 87.5kB | 1,106.3 kB |
| `/dashboard/actions`         | 663.1 kB |   624.6 kB | 87.5kB | 1,626.7 kB |
| `/technical`                 | 239.9 kB | 1,078.6 kB | 87.5kB | 3,737.4 kB |
| `/about`                     | 200.4 kB |   753.1 kB | 87.5kB | 1,391.9 kB |

The three largest payload drivers, in order: `/technical` (1,078.6 kB of JavaScript — the
site's motion and diagram modules, on the one route that draws them), `/dashboard/inventory`
(781.8 kB of HTML — the 250-unit disclosure) and `/dashboard/actions` (663.1 kB of HTML — 62
review prompts with their evidence). None of them is the control band.

---

## 4. The friction register

Built by touring the application as each of the seven personas `UX.2D` §4 names, starting at `/`
each time and navigating only through the product. Severity is `UX.2D` §5's scale.

### P1 — materially damages the operating workflow

| #     | Route                                                                        | Problem                                                                                                                                                                                                                                                                   | Owner                        |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| P1-1  | Inventory, Leads, Employees, Accounting, Actions                             | The analytical scope line prints the warehouse key. `?store=GSA-002` renders as `GSA-002 · December 2025` on five of nine routes and as `Granite Subaru · December 2025` on the other four. `UX.2D` §9 forbids exposing an internal code where a business label exists.       | shared scope vocabulary      |
| P1-2  | eight routes                                                                 | No way to remove one filter and no way to reset. The Executive surface rendered removable chips and a reset link; the other eight rendered the same information as inert text. Clearing a filter required setting each select back to its default.                            | shared active-filter summary |
| P1-3  | all filtered routes                                                          | The control band consumes 65–109% of a phone screen. See §1.                                                                                                                                                                                                               | shared control band          |
| P1-4  | Executive → Inventory, → Accounting (×2), → Actions                          | Bare pathnames. From `/?period=2025-11&store=GSA-002` all four links landed on the unfiltered destination, on the surface whose whole purpose is to be where a manager starts. All three destinations declare `store` applied.                                                | `operatingHref`              |
| P1-5  | Inventory unit table                                                          | All 250 unit links were `?unit=VEH-…` and nothing else, so opening a unit from a filtered lot discarded the store, condition and period.                                                                                                                                    | `operatingHref`              |
| P1-6  | Employees role and employee links, Deal Explorer sort and pager links         | Self-navigation carried parameters the route declares `not-applicable`. `compare=prior-year` propagated through every role link on Employees and every sort header on Deals — both declare `compare` not-applicable and show no comparison anywhere.                          | `operatingHref`              |

### P2 — visible inconsistency or unnecessary friction

| #    | Route                    | Problem                                                                                                                                                                                          | Owner                      |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| P2-1 | F&I                      | Scope reads `the group` — lowercase, mid-sentence grammar under a title, against `All three stores` elsewhere.                                                                                     | shared scope vocabulary    |
| P2-2 | all routes               | Desktop band spread 230–494 px on the same four controls.                                                                                                                                          | shared control band        |
| P2-3 | Executive, Sales, F&I    | Every KPI identifier linked to `/kpis#…`, the catalogue's pre-`UX.1` address, which is a permanent redirect to `/technical?view=kpis`. Built by hand in three modules.                              | `kpiCatalogueHref`         |
| P2-4 | F&I, Leads               | Zero outbound drill-through of any kind. `/dashboard/employees` has linked into F&I since `DASH.11`; the pair was one-way, and `UX.2D` §77 step 7 asks a director to reach a desk's people context. | F&I manager table          |
| P2-5 | Executive                | "Active filters — None. Showing the group over the latest full month, against the prior month." restated the scope line four elements above it, verbatim in meaning.                                | shared active-filter summary |
| P2-6 | Executive, Sales         | Two routes filled the band through `notices`/`filters` props; six filled it through `children`. Same band, two assembly conventions.                                                                | `OperatingPageHeader`      |

### What the tour found CLEAN, and which is therefore not in the diff

Recorded because a consistency pass that only lists defects reads as though nothing was already
right.

- **Store colour is already identity, never rank.** `storeMarkClass` derives the mark from the
  business code rather than from the row's position, is documented at length, and is the single
  path every store visual uses. A store filtered out of scope does not shift another store's hue.
- **No horizontal overflow** at any of the eight widths, on any route.
- **Active navigation** already resolves the Deal Jacket to Deals rather than to a tenth
  top-level destination, through `routeFilterSupport`'s prefix rule.
- **The rail's own links** already carry compatible context through `operatingHref`; it was the
  in-content drill-throughs that did not.
- **The route-support matrix** is complete, per-route and honest, including its `partial`
  declarations. Every defect above is a link or a label that failed to consult it — not a gap in
  it.

---

Power BI real-engine validation remains externally pending; this baseline does not change that
state.
