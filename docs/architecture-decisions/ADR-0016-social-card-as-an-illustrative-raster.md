# ADR-0016 — The social card as an illustrative raster

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-14 |
| **Deciders** | Michael Palmer |
| **Supersedes** | Nothing. It reverses one specific rule established at the `DASH.13` closeout — that every figure printed on the social card is governed output — and leaves every other honesty rule in the project untouched. |
| **Superseded by** | — |
| **Related** | ADR-0012 (dealer-group public naming), ADR-0013 (governed web operating console), ADR-0015 (product-first operating experience) |

---

## Context

The site publishes one Open Graph card. It is the only surface a reader sees **before** the site
loads, and it is therefore the one place where a claim cannot be qualified by the page around it.

Three arrangements have existed.

**Before `DASH.13`,** the card carried no figures at all, and `media.test.ts` asserted that: no
currency amount, no percentage, no unit count. That rule was right for the card it was written
against, which drew an empty wireframe. Any figure in an empty wireframe would have been invented.

**At the `DASH.13` closeout,** the card was redrawn to carry four KPI values and a six-month trend.
The rule that made that honest was not "no numbers" but a stronger one: *every number is the
product's own output and can be recomputed.* It was mechanically enforced — `media.test.ts` read the
text out of `public/brand/social-preview.svg` and compared each figure against
`buildExecutiveOverview()` character for character. This closed a failure mode the old rule could
not see: a card with hand-typed figures passes "no invented values" on the day it is drawn and goes
silently stale the first time the synthetic dataset is regenerated.

That enforcement depended on one property of the asset: **it was an SVG, so its figures were text a
test could read.**

**Now,** a supplied raster has replaced it. `public/brand/social-preview.svg` was deleted and a
1731 × 909 PNG committed in its place, leaving `media.test.ts` reading a file that no longer exists
and the repository's CI red on `ENOENT`. The card is a designed marketing composition: an ARPI
wordmark and positioning block beside a stylised rendering of an executive dealership dashboard.

Two facts about it forced this record rather than a routine path change.

**It cannot be reconciled mechanically.** A raster has no text. The `DASH.13` rule is not
inconvenient to enforce here; it is unenforceable, and no amount of test engineering changes that.

**It would not pass if it could.** Measured against `buildExecutiveOverview()` on the current
dataset:

| Printed on the card | Governed value | Conflict |
|---|---|---|
| `ROSI® 92` | — | `ROSI` is not an ARPI KPI. It appears in no selector and no KPI catalogue. `92` is *Retail units*. |
| `Total Sales $3,499` | `$3,499` is *Total gross per retail unit* | The value is real; the label is wrong. |
| `Gross Profit $321,935` | `$321,935` is *Total gross* | Value correct, label approximate. |
| `Inventory Health 64%` | *Aged inventory* `40.4%` | Does not reconcile. `100 − 40.4 = 59.6`, not 64. |
| `20.5% Close Rate` | *Lead-to-sale conversion* `1.5%` | Does not reconcile. |
| `Leads 1,177 / Appointments 430 / Show Rate 90` | funnel counts differ | Internally inconsistent too: `90 / 1,177` is 7.6%, not the 20.9% printed. |
| `Units Sold 92` | `92` retail units | The one figure that agrees. |

The card also prints `3 High Pirority` — a spelling defect — and attaches `®` to a term this project
neither owns nor defines.

So the decision is not "how do we keep the test green". It is: **what is the strongest honest rule a
raster social card can be held to, and is the project willing to state plainly that the old rule no
longer applies?**

## Decision

1. **`public/brand/social-preview.png` is the sole canonical social card**, committed at exactly
   1200 × 630, at the path it is served from. `OG_IMAGE_PATH` is `/brand/social-preview.png` and both
   Open Graph and Twitter metadata reference it.
2. **The generation step is retired.** There is no SVG master and no render target. `npm run assets`
   renders the two favicon rasters and nothing else.
3. **The `DASH.13` figure-reconciliation rule no longer applies to the social card.** It is recorded
   here as withdrawn rather than deleted quietly. The figures on the card are **illustrative** and are
   not the product's governed output.
4. **The honesty rules that a raster still admits move onto the card's alternative text**, which is
   the only text it has and the copy a screen-reader user actually receives. The alt text:
   - must state that the rendering is illustrative and not governed output;
   - may **not** quote any currency amount, percentage or unit count, because an unreconciled figure
     read aloud is indistinguishable from a real one;
   - may claim no business result;
   - stays under the ADR-0012 fairness freeze — it names no store and no employee.
5. **The reconciliation rule is unchanged everywhere else.** It was never a rule about images. Every
   figure rendered by the operating console still comes from a governed selector, and
   `dashboard-executive.test.ts` still reconciles the console against the export character for
   character. Nothing in this record touches a KPI definition, a denominator, a selector, a
   business calculation or the console.

## Alternatives considered

**Restore the SVG master and keep reconciliation.** The strongest option on honesty grounds and the
only one that preserves a mechanically checkable rule. Rejected because the supplied raster is the
approved asset and re-creating a deleted master to satisfy a test would be the tail wagging the dog —
and because the new card's composition is not expressible as the old hand-authored SVG without
redrawing it.

**Keep the previous `DASH.13` card as canonical.** It is honest, verified, 1200 × 630 and already
committed. Rejected as a deliberate product call: the new card is the approved brand asset. Recorded
here because it remains the fallback if the figures on the current card are judged too costly.

**Correct the figures on the raster so they reconcile.** The best outcome and still available — it
would let a future record restore a form of the rule by declaring the drawn values in a manifest and
reconciling *that* against the selectors. Not taken now because it requires re-exporting the asset,
which is a design change rather than an engineering one.

**Delete the reconciliation test and say nothing.** Rejected outright. It would leave the repository
asserting, through a `DASH.13` comment block that no longer ran, that its social card is governed
output. That is the precise failure this project exists to argue against.

## Consequences

**Positive.** One social asset at one path, with no generation step, no master that can drift from
its output, and no browser download in CI to rebuild it. The card is 189 kB against a 300 kB budget.
The `ENOENT` that made CI red is gone at its cause rather than papered over. The alt text is now
explicit that the rendering is illustrative, which is a statement the old dark card never had to make
and which reaches the reader least able to judge the image for themselves.

**Negative, and this is the real cost.** The project has lost a mechanically enforced honesty
guarantee on its most public surface. A reader who finds the card and reads `Total Sales $3,499` is
being shown a figure that is wrong under its label, and the repository can no longer catch that
automatically. The alt-text rules are a materially weaker substitute: they constrain what the card
*says about itself*, not what it *draws*. Anyone changing the card in future should understand that
the only remaining check on its figures is human review.

**Negative, and independent of the figures: the synthetic-data disclosure is gone from the image.**
The retired card printed "Synthetic data" and "Granite Auto Group is fictional" on its face.
The supplied raster prints neither, while still drawing dealership KPI tiles. `DESIGN_SYSTEM.md` §8
had already named this exact failure — "a share card that omitted the disclosure would be the one
surface where the site implied real dealership data" — and the current card does not meet it. The
disclosure now survives only in the card's alternative text, which reaches a screen-reader user and
not a person looking at a share preview. `media.test.ts` pins that last copy so it cannot be edited
away as well. **Restoring the disclosure to the image is the single highest-value correction to the
asset**, ahead of the figures.

**Also negative.** The card ships with a spelling defect (`Pirority`) and a `®` on an undefined term.
Both are visible to every reader who sees a share preview, and neither is caught by any test. They
are recorded here so that the next person to touch the asset fixes them rather than rediscovering
them.

**Reversible.** Restoring the stronger rule needs a corrected asset and a declared figure manifest,
not a revert. The path, the pipeline and the tests established here all survive that change.
