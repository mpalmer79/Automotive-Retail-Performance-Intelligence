# `UX.2B.1` — what a second implementation of `UX.2B` was worth

`UX.2B` was implemented twice, independently, from the same base commit `3463fd5`. One of the
two merged as [PR #61](https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence/pull/61)
and is the canonical increment. The other, PR #62, was opened against the same base an hour
later and therefore conflicts across nearly every file `UX.2B` touched.

This document is the audit of the second one. It exists because the honest answer to "which
implementation wins" is neither — `UX.2B` is one completed product increment and it is merged
— but the losing branch is still evidence, and throwing away evidence without reading it is
not a decision, it is an omission.

**PR #62 itself was not merged, and is now closed as superseded.** One change did reach `main`
from its branch by another route: PR #63 was opened from that branch carrying only the
`BridgeChart` anchor fix, and merged as `112e3ea` while this audit was in review. That is
recorded in §4 rather than glossed, because this document would otherwise claim credit for a
fix that landed independently.

What follows is a comparison, a set of decisions with reasons, and the measurements behind
them.

---

## 1. What was compared

| | PR #61 (canonical) | PR #62 |
|---|---|---|
| Merge commit | `4593efd` | not merged (one commit from its branch reached `main` via #63) |
| Head | `44f3a3a` | `705c409` |
| Base | `3463fd5` | `3463fd5` |
| Diff | +7,204 / −1,885 over 46 files | +5,371 / −1,448 over 28 files |
| New test files | 2 (39 unit, 28 e2e) | **0** — existing specs edited only |
| Documentation updated | backlog, program, IA, test strategy, design system, accessibility, performance, baseline, review | review only |

Both were measured on **one harness**, against production builds, at 1440 × 900. The harness
is scratch and is not committed. Every height below reproduces both PR bodies exactly, which
is the evidence that the two sessions measured the same way and that the differences are
real rather than methodological.

| Route | Baseline | PR #61 | PR #62 |
|---|---:|---:|---:|
| `/dashboard/sales-gross` | 7,228 | 3,260 | 3,159 |
| `/dashboard/deals` | 3,063 | 2,561 | 1,289 |
| `/dashboard/deals/[saleId]` | 5,806 | 4,015 | 3,861 |
| `/dashboard/inventory` | 11,543 | 11,828 | 2,214 |
| `/dashboard/fi` | 6,614 | 3,455 | 2,628 |

---

## 2. The three height gaps, explained rather than inferred

### Inventory: 11,828 → 2,214 px is one `<details>`

The gap is **not** pagination, a narrowed population, dropped columns or a different
measurement. Probing the rendered DOM of both builds:

| | PR #61 | PR #62 |
|---|---|---|
| Unit table rows in the DOM | 250 | 250 |
| Unit table laid-out height | **9,550 px**, `inDetails: no` | 13,832 px, `inDetails: details[CLOSED]` |
| Route bytes | 452,409 | **472,976** |

11,828 − 9,550 ≈ 2,278. The whole difference is the unit table moving inside a collapsed
disclosure. The tell is that PR #62's page is 9,614 px shorter **and 20 kB heavier**: the rows
never left the document, they simply stopped being laid out.

The governed capability survives that move, and it was checked rather than assumed:
`globals.css` has opened every `<details>` for print since `UX.1` (`details::details-content`),
so the rows still print; they remain in the served markup with scripting disabled; and the
summary states the count. What a closed `<details>` does cost is the accessibility tree — its
contents are not exposed until it is opened. That is the same trade every chart's data table
on this console already makes.

**Decision: PORT.** Measured result on canonical main below.

### Deals: 2,561 → 1,289 px is a capped scroll pane

PR #62 wraps the deal table in `max-h-[70vh] overflow-auto` with a `sticky top-0` header. At a
900 px viewport the 1,535 px table scrolls inside a ~630 px pane. Together with having no
summary strip at all, that is the entire 1,272 px.

**Decision: KEEP #61**, for two reasons that are not preference:

1. A nested vertical scroll pane traps page scrolling, and it caps the table at 70 % of the
   viewport however tall the screen is.
2. PR #62's pane carries **no `tabIndex` and no `role="region"`** — the exact WCAG 2.1.1 gap
   PR #62 itself fixed in `TableDisclosure`. Its row links keep the content tabbable, but
   arrow-key scrolling of that pane is unreachable.

The sticky header is the good half of the idea and was considered separately. It is **not
portable as-is**: main's table already sits inside `overflow-x-auto`, and a sticky `thead`
positions against its nearest scrolling ancestor, so it would need the height cap to do
anything. Rejected with the cap, and recorded here rather than silently dropped.

### F&I: 3,455 → 2,628 px is more tables behind disclosures

PR #62 has *more* tables than #61 (11 against 8) and is still shorter, because it discloses
almost all of them — including the category-economics matrix, which `UX.2B` §60 deliberately
kept as a first-class visible table.

**Decision: KEEP #61.** This is a genuine product disagreement, not a defect, and §60 already
decided it. A matrix a Finance Director reads column-by-column is not a chart's data
alternative.

---

## 3. The inventory scatter: two accessibility models

| | PR #61 | PR #62 |
|---|---|---|
| Marks in the tab order | none — `aria-hidden` inside one focusable `role="img"` | **234 focusable links** |
| Focus stops on the route | 268 | **505** |
| Skip mechanism | not needed | `sr-only` skip link before the marks |
| Exact values | the route's own unit table | each mark's `aria-label`, plus the table |
| Drill-through from a mark | no | yes, per unit |
| Route bytes | 452,409 | 472,976 |

PR #62's model is genuinely better on two axes — discoverability and direct drill-through —
and worse on three: screen-reader verbosity (234 full descriptions in reading order), touch
target size at phone widths, and payload.

**Decision: KEEP #61.** Not because one is obviously right, but because swapping a visual's
entire interaction model is not a refinement, the regressions are real and unmeasured at
mobile, and a skip link mitigates 234 tab stops without removing them. A roving-tabindex
hybrid was considered and rejected as inventing complexity no evidence yet demands.

This is recorded as a genuinely open question rather than a closed one.

---

## 4. Four defects in shared primitives, all present on canonical main

PR #61 never touched `visuals.tsx`; it is byte-identical to `3463fd5` on main. These were
therefore carried unchanged into the merged increment, and each was confirmed on main before
being fixed.

| # | Defect | Confirmed on main | Fixed |
|---|---|---|---|
| 1 | `BridgeChart` drew both anchors from `base` to `top` — the same number — so each rendered as the 0.5 % minimum sliver | yes, `visuals.tsx:466` and by screenshot: the opening and closing totals were hairlines | **on `main` already** — see below |
| 2 | `BridgeChart` labels used `truncate`, rendering the closing anchor as "Front-end …" in a five-of-twelve module | yes, `visuals.tsx:499` | yes |
| 3 | `TrendChart` drew no axis labels, so a reader could not tell whether a trend covered a fortnight or six months | yes — `axisLabels` on main belongs to `ExecutiveMicroTrend`, added by `UX.2A`; `TrendChart` had none | yes |
| 4 | `Module` was not a container, so section grids asked the **viewport** width; a 3-of-12 module is ~300 px while still satisfying `lg` | yes — `AMOUNT FINANCED` rendered as "$21,358." above "02" on the Deal Jacket | yes |

### Defect 1 reached `main` by another route

While this refinement was in review, **PR #63 was opened from PR #62's own branch carrying just the
anchor fix, and merged** as `112e3ea`. Its change is the same expression this branch had already
written — `bar.kind === 'anchor' ? lowest : Math.min(base, top)` and its counterpart — so merging
`main` here produced a **comment-only conflict**, resolved in favour of `main`'s wording, which is
the better of the two: it names why `tops` returns `base` unchanged for an anchor, and it notes that
`UX.2B` added a second waterfall to the Deal Jacket, so the defect misread on two routes rather than
one.

`#63` also brought its own assertions in `dashboard-visuals.test.tsx`: each anchor above the 0.5 %
floor, the closing anchor taller than the opening one, both steps shorter than either. Two of the
tests this branch had written restated exactly those, so they were removed rather than left as a
second suite pinning one property. What remains here is what `#63` does not cover — the **inversion**
(the property a chart ignoring its input would fail) and the **label**, which is a separate defect
`#63` did not touch.

The outcome is unchanged: the fix is on `main` once, tested twice from different angles, and this
branch no longer claims to be the thing that fixed it.

A fifth item PR #62 reported — exact arithmetic leaking into presentation components — is
**already prevented on main**. `dashboard-boundaries.test.ts` allows arithmetic in
`lib/dashboard/decimal.ts` and `lib/dashboard/selectors.ts` only, and asserts no component
performs it. Nothing to port.

`TableDisclosure`'s scroll container also had no keyboard access. On main that was **latent** —
no disclosed table is wide enough to scroll — but it becomes load-bearing the moment the
72rem unit table moves inside one, so it is fixed as part of that change rather than after it.

### Mid-word breaks, measured

Text broken mid-word, counted by comparing each element's longest word against its rendered
box, `sr-only` excluded:

| Route | main | after |
|---|---:|---:|
| `/dashboard/deals/[saleId]` | **14** | **2** |
| `/dashboard/sales-gross` | 0 | 0 |
| `/dashboard/deals` | 28 | 28 |
| `/dashboard/inventory` | 1 | 1 |
| `/dashboard/fi` | 1 | 1 |

All three money values on the jacket — `$21,358.02`, `$6,202.38`, `$1,555.87` — are fixed,
along with the lender and employee identifiers. The two that remain are table headers
(`Adjustments`, `Status`), each about 7 px short of its column, and both predate this work.
The 28 on the Deal Explorer are the deal-id column and predate it too; neither is money and
neither is in scope here.

---

## 5. Measured result on canonical main

Production builds, one harness, 1440 × 900.

| Route | Height before | Height after | Figures | Route bytes before | after |
|---|---:|---:|---:|---:|---:|
| `/dashboard/inventory` | 11,828 | **2,325 (−80.3 %)** | 3 → 3 | 452,409 | 455,222 |
| `/dashboard/deals/[saleId]` | 4,015 | 3,881 | 2 → 2 | 385,943 | 386,280 |
| `/dashboard/sales-gross` | 3,260 | 3,260 | 8 → 8 | 403,532 | 404,312 |
| `/dashboard/deals` | 2,561 | 2,561 | 0 → 0 | 401,266 | 402,357 |
| `/dashboard/fi` | 3,455 | 3,455 | 3 → 3 | 392,402 | 392,640 |

Inventory loses 9,503 px and gains 2.8 kB — the disclosure's own chrome. All 250 unit rows are
still in the DOM, the position map still resolves one focus stop rather than 234, and client
JavaScript on all five routes is still **zero bytes**.

The four route-byte increases are between 0.2 kB and 1.1 kB and are the same thing in each
case: `role`, `tabIndex` and `aria-label` on every disclosure's scroll region, plus two axis
labels per trend.

---

## 6. What was refused, and why

| Considered | Decision | Reason |
|---|---|---|
| The 234-link scatter | refused | swaps an interaction model; regresses screen-reader verbosity, touch targets and payload |
| `max-h-[70vh]` on the deal table | refused | nested scroll trap, caps content by viewport, and #62's own pane is keyboard-unreachable |
| Sticky `thead` on the deal table | refused | inert without the height cap, because the table already sits in a scroll container |
| Disclosing the F&I category matrix | refused | `UX.2B` §60 keeps a read-across matrix first-class |
| Dropping the Deal Explorer summary strip | refused | it is the reason that route was touched: it states what the filter selected and what it is worth |
| PR #62's `zone-fi` / `zone-deal` tokens | refused | main's `zone-finance` already resolves this; two names for one decision |

---

## 7. Tests

`tests/unit/ux2b1-refinement.test.tsx` adds 11 tests, one per fix, asserting the property that
made each defect a defect rather than the class name that happens to encode the current fix.
Six of them were verified to **fail** against the unfixed code by re-seeding the two `visuals.tsx`
defects exactly as main carries them.

Six existing e2e tests in `dashboard-inventory.spec.ts` were changed, and all six for the same
reason: the unit table is now a disclosure, which is an intentional product-contract change,
so a role-based locator cannot see its rows until it is opened. An `openUnits` helper opens it.

Two of those tests were made **stronger**, not merely adjusted:

- the no-JavaScript test now asserts a real unit identifier is in the served markup **while the
  disclosure is still closed**, which is the claim that distinguishes collapsing from removing,
  and then opens the native `<details>` with scripting off;
- the synthetic-estimate test now asserts both caveats are in the page with nothing opened,
  proving the disclosure did not take the caveat with it, before checking the column header.

No test was deleted and no assertion was weakened.

---

Power BI real-engine validation remains externally pending; `UX.2B.1` does not modify the
semantic model.
