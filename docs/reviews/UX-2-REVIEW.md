# `UX.2` — the operating application, as a program

The closeout review for the whole of `UX.2`: `UX.2A`, `UX.2B`, `UX.2B.1`, `UX.2C` and `UX.2D`. Not a
concatenation of five pull-request bodies — each increment has its own baseline and its own review,
linked below, and this document is the before-and-after a reader who has read none of them needs.

| Increment | Subject                                                       | Evidence                                                                                                     |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `UX.2A`   | Executive Command Center                                       | [baseline](UX-2-BASELINE.md) · [review](UX-2A-REVIEW.md)                                                       |
| `UX.2B`   | Sales & Gross, Deal Explorer, Deal Jacket, Inventory, F&I      | [baseline](UX-2B-BASELINE.md) · [review](UX-2B-REVIEW.md)                                                      |
| `UX.2B.1` | Presentation refinements found by the parallel audit           | [refinement](UX-2B-1-REFINEMENT.md)                                                                            |
| `UX.2C`   | Leads & Marketing, Employees, Accounting, Management Actions   | [baseline](UX-2C-BASELINE.md) · [review](UX-2C-REVIEW.md)                                                      |
| `UX.2D`   | Interaction, consistency and closeout                          | [baseline](UX-2D-BASELINE.md) · [review](UX-2D-REVIEW.md)                                                      |

---

## A. Product

### What `UX.2` set out to change

`UX.1` had already made ARPI an application rather than a portfolio: a route group with an operating
rail, a URL filter grammar, one control band and nine working routes. What it had not changed was
what those routes were made of. **Every operating surface was a document.** A manager opened a page
of headings, ledes, definition lists and paragraphs, and read their way to the answer. The
Executive surface put its first framed figure 1,389 px down a 900 px screen. Nine of the ten
operating routes contained no data visualization of any kind.

`UX.2`'s thesis was that a dealership management system is a set of instruments, and that an
instrument is a figure whose geometry moves when the business does. Not decoration — every visual
had to be derived from the same governed export as the number beside it, had to change shape when a
filter changed, and had to carry its exact values as text for a reader who cannot measure a bar.

### What ARPI feels like now

A general manager opens `/` on a laptop and sees, without scrolling: the analytical scope in
business words, eight KPI cards, a six-month trend, a store comparison and a pace-against-target
figure. They pick December and one store from a compact control band; every figure and every visual
re-shapes; the scope line says "Granite Subaru · December 2025 · vs November 2025". They click into
Inventory and the store comes with them. They open a unit and the lot comes with them. They open
Management Actions, drill into a Sales prompt, land on the supporting route with the scope intact,
and get back with the browser's own back button.

On a phone the same manager meets the route name, the scope, the active filters and then data. The
controls are one tap away rather than two thirds of a screen.

Nothing on any of those screens requires JavaScript.

---

## How to read the figures below

**Each increment measured itself with its own scratch harness, and the four harnesses do not all
agree to the pixel.** `UX.2A`, `UX.2B` and `UX.2C` ran against `next start -p 3111`; `UX.2D` ran
against `-p 3311` with a collector that counts a paragraph inside `<main>` rather than anywhere in
the document. The document-height figures agree across all four — `UX.2B.1` recorded Inventory at
2,325 px and `UX.2D`'s baseline measured 2,325 px on the same commit — and the prose counts do not
always, by up to about 70 words on the longest routes.

So the tables below **quote each increment's own review for its own before-and-after**, attributed,
and add a `UX.2D` column only where `UX.2D` measured both ends itself. Nothing is chained across
harnesses.

## B. Executive

From [`UX-2A-REVIEW.md`](UX-2A-REVIEW.md) §1, except the last two rows:

| Measure                                          | Before `UX.2A` | After `UX.2A` |
| ------------------------------------------------ | -------------: | ------------: |
| Document height, 1440 × 900                      |          8,161 |         4,955 |
| Document height, 390 × 844                       |         15,426 |         9,026 |
| First framed figure, desktop                     |          1,389 |       **768** |
| First framed figure, 390                         |          3,681 |     **1,987** |
| Data-driven visual regions in the first viewport  |              0 |         **3** |
| Visible prose, `proseRepo`                       |            945 |       **569** |

From `UX.2D`'s own harness, on the merge of `UX.2C` and on this branch:

| Measure                    | Before `UX.2D` | After `UX.2D` |
| -------------------------- | -------------: | ------------: |
| Control band, 390          |            548 |       **222** |
| First visual region, 390   |            624 |       **298** |
| Document height, 390       |          9,066 |     **8,739** |
| Control band, 1440         |            230 |       **200** |

---

## C. Revenue and vehicles

From [`UX-2B-REVIEW.md`](UX-2B-REVIEW.md) §1–§3 and
[`UX-2B-1-REFINEMENT.md`](UX-2B-1-REFINEMENT.md) §200:

| Route                           | Height desktop, before | After `UX.2B` | After `UX.2B.1` | First framed figure | Visual regions |
| ------------------------------- | ---------------------: | ------------: | --------------: | ------------------: | -------------: |
| `/dashboard/sales-gross`        |                  7,228 |     **3,260** |               — |   2,752 → **767 px** |      0 → **8** |
| `/dashboard/deals`              |                  3,063 |     **2,561** |               — |  none, deliberately |          0 → 0 |
| `/dashboard/deals/SLE-00000646` |                  5,806 |     **4,015** |               — |       — → **523 px** |      0 → **3** |
| `/dashboard/inventory`          |                 11,543 |        11,828 |   **2,325** −80% |       — → **871 px** |      0 → **4** |
| `/dashboard/fi`                 |                  6,614 |     **3,455** |               — |       — → **802 px** |      0 → **5** |

Visible prose fell 37.5% on Sales & Gross, 39.0% on the Deal Jacket and 40.3% on F&I. It ROSE on
Inventory and the Deal Explorer, and both increments recorded that rather than smoothing it: what
was added is a caveat and a population summary the routes did not previously carry.

**Inventory is the one route in the program whose height was fixed by the increment after the one
that broke it.** `UX.2B` added four visualizations above a 250-row table and left the route at
11,828 px; `UX.2B.1` put the table behind a disclosure and it measures 2,325 px. That sequence is
why `UX.2B.1` exists.

From `UX.2D`'s own harness:

| Route                           | Control band, 390 | After | First visual, 390 | After |
| ------------------------------- | ----------------: | ----: | ----------------: | ----: |
| `/dashboard/sales-gross`        |               565 | **222** |               641 | **298** |
| `/dashboard/deals`              |               631 | **201** |                 — |     — |
| `/dashboard/deals/SLE-00000646` |               322 |   322 |               398 |   398 |
| `/dashboard/inventory`          |               921 | **439** |               997 | **515** |
| `/dashboard/fi`                 |               753 | **392** |               829 | **468** |

---

## D. Demand, people and controls

From [`UX-2C-REVIEW.md`](UX-2C-REVIEW.md) §A:

| Route                        | Height desktop | After     | Height 390 | After      | Framed figures in first viewport | `proseRepo` |
| ---------------------------- | -------------: | --------: | ---------: | ---------: | -------------------------------: | ----------: |
| `/dashboard/leads-marketing` |          8,821 | **3,998** |     11,896 |  **7,187** |                         1 → **3** | 1,102 → **555** |
| `/dashboard/employees`       |          5,386 | **4,169** |      9,417 |  **6,311** |                         0 → **2** |   303 → **258** |
| `/dashboard/accounting`      |          3,290 | **2,408** |      5,032 |  **4,228** |                         0 → **2** |   422 → 434 |
| `/dashboard/actions`         |     **16,741** | **7,405** |     22,401 |     17,243 |                         0 → **1** |   922 → **803** |

**`/dashboard/actions` was a 16,741 px document — eighteen desktop screens with no figure on any of
them.** Its mobile height is still the tallest in the console at 17,243 px, and that is 62 review
prompts each carrying its own evidence, threshold and limitation: the content a manager came for,
not explanation to compact further.

Employees and Accounting were already concise and were never asked to shrink. What changed on them
is that `DASH.11`'s fairness context and the reconciliation's signed variance became visual rather
than paragraphs; Accounting's prose rose by twelve words, for two figures that need a caveat a
reader would misread them without, and `UX.2C`'s review says so in its own §A.

From `UX.2D`'s own harness:

| Route                        | Control band, 390 |   After | First visual, 390 | After |
| ---------------------------- | ----------------: | ------: | ----------------: | ----: |
| `/dashboard/leads-marketing` |               721 | **328** |               797 | **404** |
| `/dashboard/employees`       |               711 | **293** |               787 | **369** |
| `/dashboard/accounting`      |               718 | **282** |               794 | **358** |
| `/dashboard/actions`         |               245 |     245 |               321 |   321 |

---

## E. Shared experience

### Filters

`UX.1` built the URL grammar and one filter form. `UX.2D` finished the control architecture:

- **One band on nine routes**, three tiers — scope, active filters, controls.
- **A native `<details>` on a phone and no disclosure at all on a desktop**, the responsive part done
  in CSS with `::details-content` and an `@supports` guard, so nothing about it needs JavaScript.
- **201–439 px on a phone**, from 548–921 px.
- **Removal and reset on every route**, from one route in nine.
- **One scope vocabulary**: five routes had been printing `GSA-002` where a business name existed.

### Navigation

The rail carried compatible context from `UX.1`. `UX.2D` closed the gap the rail did not cover:
every in-content drill-through now goes through `operatingHref`, which consults the destination's
own support matrix rather than copying the current query string. The Deal Jacket resolves to Deals
rather than presenting itself as a tenth destination.

### Methodology

`UX.1` moved provenance into a disclosure. `UX.2A`–`UX.2C` cut visible prose on every transformed
route — 945 → 569 on the Executive, 891 → 555 on Sales, 1,102 → 555 on Leads. `UX.2D` removed the
two remaining duplicates and kept every caveat: an aged threshold that is a project default, a
market estimate that is not a valuation, a variance whose sign is not a judgement, a sample floor
that withholds rather than ranks.

### Mobile

Every operating route's first business state is now inside the first two phone screens, and eight
of them inside the first screen.

### Accessibility

Axe clean across twelve routes and eight technical view states, with no suppression, at every point
in the program. Keyboard, 200% zoom, reduced motion, print and no-JavaScript verified per increment.
The definition-list guard from PR #55 is intact.

### Visual system

Twelve visual primitives, all server-rendered, none from a chart library. Store colour is identity
derived from the business code and cannot drift with a filter. Domain tints and value colours come
from different token tiers, so a tint cannot be read as a value. Green and red are for a sign, a
governed target or a declared severity — never for "bigger is better".

---

## F. Performance

Client JavaScript owned by the operating visualizations is **zero bytes**, at every increment. No
chart library was added; the question was asked and answered four times, and `UX.2D` did not reopen
it because no unresolved visualization requirement appeared — which is the condition §66 sets.

HTML rose where data moved into server-rendered geometry, and that trade was made deliberately: a
figure that is in the served markup is a figure a reader without JavaScript, a printer and a
screen reader all get. The `UX.2D` deltas are +1.5 to +3.8 kB of HTML on eight routes for the
control disclosure and its links, with JavaScript identical to the byte.

The largest route is `/technical` (motion and diagram modules). The largest HTML route is
`/dashboard/inventory` (its 250-unit disclosure). Neither is the control band.

---

## G. Data integrity

**No KPI, warehouse fact, dimension, reporting view or export dataset was added, removed or
redefined by any increment of `UX.2`.** `scripts/generate-dashboard-data.ts --check` reports the
generated tree byte-identical at the head of `UX.2D`. No Power BI artefact was touched. Every figure
on every rebuilt route is the same governed value from the same versioned export it was before, and
the per-increment reviews record the two places where a figure's *presentation* changed and why.

---

## H. Product gaps

Recorded rather than solved, because solving them means new data and `UX.2` added none:

1. **Leads & Marketing has no defensible outbound drill-through.** A link from a funnel figure to a
   deal index would assert a lead-to-deal attribution the export does not publish at that grain.
2. **`/dashboard/actions` accepts no period.** It is a queue at the export's as-of date.
3. **`/dashboard/inventory` accepts `period` only as `partial`**, because a snapshot route resolves a
   period to the last snapshot inside it.
4. **The Deal Jacket has no next/previous within the filtered deal set.**
5. **Marketing cost is `N/A` at most scopes**, which the route states rather than hides.

---

## I. Release readiness

`UX.2` is Implemented. `DASH.13` remains Planned and is not begun.

What `DASH.13` inherits is a product whose surfaces have stopped moving: every route measured before
and after, payload figures from a stable base, an accessibility sweep that has been clean throughout,
and a control architecture with its own regression ceilings. `UX-2D-REVIEW.md` §6 is the itemized
handoff.

---

Power BI real-engine validation remains externally pending; no increment of `UX.2` modified the
semantic model, and `UX.2` does not alter that state.
