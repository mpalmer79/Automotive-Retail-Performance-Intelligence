# `UX.2C` — measured baseline

The state of the four demand, people and control routes **before** `UX.2C`, measured against `main`
at `93a302dc62c87482af4400e1ed09c762bebc886e` — the merge of `UX.2B.1` (PR #64) — from a production
build (`next build`, `next start -p 3111`), Chromium, viewport 1440 × 900 for desktop figures and
390 × 844 for mobile.

Recorded rather than described, for the reason [`UX-1-BASELINE.md`](UX-1-BASELINE.md),
[`UX-2-BASELINE.md`](UX-2-BASELINE.md) and [`UX-2B-BASELINE.md`](UX-2B-BASELINE.md) give: the
increment's claims are comparative, and a comparison against a remembered baseline is not a
measurement. The after-figures are in [`UX-2C-REVIEW.md`](UX-2C-REVIEW.md).

The measurement harness was scratch and was removed before merge, per the standing instruction not to
commit scratch tooling. It loaded each route in Chromium at each viewport and read the numbers below
off the rendered document. Its prose definitions are the ones `UX-2-BASELINE.md` §1 established and
`UX-2B-BASELINE.md` reused unchanged:

* **`proseRepo`** — the repository's own definition, from `dashboard.spec.ts`: a rendered paragraph of
  eight words or more, outside `.sr-only` and outside a closed `<details>`. Shorter paragraphs are
  labels, units and values.
* **`proseEye`** — every rendered paragraph outside `.sr-only` and outside a closed `<details>`, at any
  length.

Route cost is compressed transfer read from Resource Timing, cold load, production server — the same
convention `UX-2B-BASELINE.md` §4 recorded.

---

## 1. The number that drives the increment

| Route | Framed figures on the route | Framed figures inside the first viewport | First framed figure, px from top |
|---|---:|---:|---:|
| `/dashboard/leads-marketing` | 7 | 1 | 639 |
| `/dashboard/employees` | **0** | **0** | — |
| `/dashboard/accounting` | **0** | **0** | — |
| `/dashboard/actions` | **0** | **0** | — |

**Three of the four routes contain no data visualization of any kind.** This is the same finding
`UX-2B-BASELINE.md` §1 recorded for four of its five routes, and it is worse here in one respect: the
one route that *does* draw figures — Leads & Marketing — draws seven of them and still puts only one
inside the first screen, because each is a full-width band in a 8,821 px document.

A BDC director, a general sales manager, an F&I director, a controller and a general manager all
currently open a page of headings, ledes and paragraphs and read their way to the answer.

`data-visual-region` — the test hook `UX.2A` introduced so a first-viewport contract can be asserted
by measurement rather than by eye — is present on **zero** elements across all four routes.

## 2. Geometry, before

| Route | Viewport | Document height | Prose words in first viewport (`proseEye`) | Visible tables | `<details>` | `<h2>` | `<h3>` |
|---|---|---:|---:|---:|---:|---:|---:|
| `/dashboard/leads-marketing` | 1440 × 900 | 8,821 | **213** | 1 | 15 | 9 | 0 |
| `/dashboard/leads-marketing` | 390 × 844 | 11,896 | 107 | 1 | 15 | 9 | 0 |
| `/dashboard/employees` | 1440 × 900 | 5,386 | **164** | 0 | 2 | 4 | 0 |
| `/dashboard/employees` | 390 × 844 | 9,417 | 48 | 0 | 2 | 4 | 0 |
| `/dashboard/accounting` | 1440 × 900 | 3,290 | 134 | 1 | 2 | 4 | 0 |
| `/dashboard/accounting` | 390 × 844 | 5,032 | 54 | 1 | 2 | 4 | 0 |
| `/dashboard/actions` | 1440 × 900 | **16,741** | 117 | 0 | **51** | 2 | **48** |
| `/dashboard/actions` | 390 × 844 | **22,401** | 96 | 0 | **51** | 2 | **48** |

**213 words inside the first desktop screen of Leads & Marketing, and not one complete figure.** That
is the single measurement `UX.2C` §5 is aimed at: the reader's first screen is a page of text with the
top of a bar chart entering at 639 px.

**`/dashboard/actions` is a 16,741 px document — eighteen and a half desktop screens.** It is the
tallest operating route in the console, taller than the pre-`UX.2B` Inventory page (11,543 px) that
`UX.2B` treated as its outlier. A general manager arriving to ask "what needs review this morning"
scrolls past forty-eight `<h3>`s and fifty-one disclosures to see the whole queue, and never
encounters a single figure.

Under a filter the shape barely improves where it matters. `/dashboard/actions?severity=high` measures
7,874 px — still nearly nine screens, still zero figures. `/dashboard/leads-marketing?store=GSA-001&period=2025-11`
measures 8,702 px against 8,821 with its first figure at 579 px against 639: the layout does not
respond to what is being asked of it, which is the same finding `UX-2-BASELINE.md` §2 recorded for the
Executive.

`/dashboard/employees?role=finance` measures 3,255 px against the salesperson view's 5,386 — the whole
of that difference is the number of people in the family, not a change of presentation. The role
switch changes the rows; it does not change the dashboard.

## 3. Visible prose, before

| Route | `proseRepo` words | `proseRepo` paragraphs | `proseEye` words | `proseEye` paragraphs |
|---|---:|---:|---:|---:|
| `/dashboard/leads-marketing` | **1,102** | 53 | **1,143** | 64 |
| `/dashboard/employees` | 303 | 10 | 317 | 18 |
| `/dashboard/accounting` | 422 | 14 | 453 | 26 |
| `/dashboard/actions` | **922** | 54 | **1,567** | **207** |

Identical at both viewports on every route: nothing is dropped or added responsively, so the phone
reader meets the same word count in a column a third as wide.

**`/dashboard/leads-marketing` at 1,102 `proseRepo` words is the most explanation-heavy operating
route in the console** — more than the pre-`UX.2B` Sales & Gross (891) and F&I (700). That is where
`UX.2C` §16's ≥35% target applies, and the ceiling it sets is

| Route | `proseRepo` ceiling (−35%) | `proseEye` ceiling (−35%) |
|---|---:|---:|
| `/dashboard/leads-marketing` | 716 | 743 |

`/dashboard/actions` is the odd shape in this table: 922 `proseRepo` words against 1,567 `proseEye`
words across **207 paragraphs**. The gap is 153 short paragraphs — the per-action evidence lines,
threshold lines, owner lines and limitation lines, repeated once per review prompt. That is not
explanation to delete; it is evidence to compact. `UX.2C` §39 asks for rule-engine explanation to move
out of the primary flow, and the reduction target that applies there is on the *repeated* mechanics,
not on the evidence a manager needs. The target taken is ≥25% of `proseRepo`, with `proseEye`
recorded rather than driven, because compacting 62 review prompts into a scannable card necessarily
keeps their evidence.

`/dashboard/employees` (303 words) and `/dashboard/accounting` (422 words) are already comparatively
concise, and `UX.2C` §53 says outright not to chase a percentage on a route that is already so.
Employees additionally carries `DASH.11` fairness context that §26 forbids removing to shorten the
page — the instruction there is to make that context *visual*, not to delete it. Both are measured
below so the review can show they did not grow either.

## 4. Route cost, before

Compressed transfer, cold load, route cost alone, production server, Chromium.

| Route | HTML | JS | CSS | Fonts | Other | Total |
|---|---:|---:|---:|---:|---:|---:|
| `/dashboard/leads-marketing` | 63.6 kB | 189.3 kB | 48.0 kB | 84.9 kB | 48.7 kB | **434.6 kB** |
| `/dashboard/employees` | 44.8 kB | 189.3 kB | 48.0 kB | 84.9 kB | 48.8 kB | **415.7 kB** |
| `/dashboard/accounting` | 31.6 kB | 189.3 kB | 48.0 kB | 84.9 kB | 48.7 kB | **402.6 kB** |
| `/dashboard/actions` | **114.9 kB** | 186.9 kB | 48.0 kB | 84.9 kB | 91.0 kB | **525.6 kB** |

The ~189 kB of script is the framework and the shell; the Actions route's 186.9 kB is the same shell
without the filter island, which that route does not render. **The routes' own visualizations
contribute zero bytes of client JavaScript**, because three of the four have no visualizations and the
fourth draws its seven figures as server-rendered HTML and CSS. That is the property `DASH.3-02`
established, `UX.2A` and `UX.2B` preserved, and `UX.2C` §42 and §43 require to be preserved or
measured and justified.

`/dashboard/actions` at 114.9 kB of HTML is nearly twice the next route's markup, and its 91.0 kB of
"other" is the prefetch of the sixty-two drill-through destinations. Fifty-one `<details>` elements
and sixty-two review prompts, each carrying its evidence, thresholds, limitation and drill-through, is
most of the markup.

---

## 5. The product test (`UX.2C` §4)

Toured as the people `UX.2C` §4 names, on the routes as they stand at `93a302d`.

### `/dashboard/leads-marketing` — BDC Director / Marketing Director

1. **What question does the manager arrive with?** How much demand arrived, how much of it we
   touched, and where it stopped. In a marketing week: what the spend bought.
2. **What is the first thing they currently see?** The page title, the store/period context line, the
   filter bar, and then an eyebrow reading `Funnel` above an `h2` reading `The lead-created cohort`
   above a lede. The first bar of the first figure is 639 px down; the whole funnel is not on screen.
3. **Is that the right thing?** The funnel is the right subject. Reaching it through an eyebrow, a
   heading and a two-line lede is not — the module's own title says what it holds.
4. **What currently requires too much reading?** 1,102 words, of which 15 disclosures at the foot of
   the page carry the correct methodology and eleven visible paragraphs restate parts of it inline.
   The cohort funnel section alone carries a caption, a per-stage rate line, a duplicate-exclusion
   paragraph and a table disclosure before the reader reaches response time.
5. **Which existing data deserves geometry?** All of it already has some, and none of it is
   compact: five funnel stages, three appointment outcomes, four response bands, five stage-loss
   counts, six sources × four measures, and the marketing table's ten columns. What is missing is a
   KPI rail — there is no headline figure anywhere on the route — and a source comparison that is a
   picture rather than a volume bar with three rates written under it in a sentence.
6. **Which details belong in a table?** The per-source measures and the per-campaign marketing rows.
   Both are already tables and both should stay tables.
7. **Which explanations belong behind methodology?** The mechanics: why the median is recomputed
   rather than blended, why spend is not prorated, why revenue-based return is not shown, what the
   vendor gap is and is not. Eleven of the fifteen existing disclosures are already correctly placed;
   the inline restatements of them are not.
8. **What drill-through already exists?** None from this route. The filter bar carries source and
   campaign; nothing links onward.
9. **Which visualization ideas cannot be supported by current grain?** A single five-stage shrinking
   funnel — the last two stages are appointment-grain on two different date bases, and drawing them
   as continuations of the lead cohort would assert a denominator continuity that does not exist. A
   source scatter of conversion against spend — `buildSourceComparison` and `buildMarketingSummary`
   read different datasets at different grains (lead-creation daily vs. whole calendar months), and
   the source rows carry no spend at all.
10. **What should be visible in the first desktop viewport?** Demand volume and the two governed
    conversion rates; the lead-grain progression; response behaviour.

### `/dashboard/employees` — General Sales Manager / F&I Director / BDC Manager

1. **What question does the manager arrive with?** What activity was credited to each person, and
   what context changes how I read it.
2. **What is the first thing they currently see?** Title, context line, the role navigation, the
   filter bar, then an eyebrow reading the family name above `What this surface measures` above a
   two-sentence lede.
3. **Is that the right thing?** The role nav is right and is the strongest thing on the page. The
   heading-and-lede that follows is the page explaining its own premise before showing a number.
4. **What currently requires too much reading?** Less than the other three routes — 303 words. The
   problem here is not volume, it is *form*: the fairness context that `DASH.11` correctly requires
   is delivered as sentences ("Ordered by store, then role, then employee code. That order is
   fixed…") and as a twelve-paragraph methodology disclosure, when the reader needs to *see* tenure,
   mix, sample and store beside the figure.
5. **Which existing data deserves geometry?** Every employee row already carries a volume, two to
   four comparative measures each with its own sample verdict, a mix (condition or structure), and
   four to six context pairs. None of it is drawn. The mix in particular is a share of a whole
   rendered as text.
6. **Which details belong in a table?** The per-person measures, when a manager wants exact values
   across the family.
7. **Which explanations belong behind methodology?** The arithmetic: ratio-of-sums, SCD2 attribution,
   why cash deals are inside the finance denominators. Not the sample state, the tenure band or the
   mix — those are per-row context.
8. **What drill-through already exists?** Employee selection by code (URL-addressable), and from a
   selected employee to `/dashboard/fi` (Finance), `/dashboard/leads-marketing` (BDC) or
   `/dashboard/sales-gross` (selling families).
9. **Which visualization ideas cannot be supported by current grain?** Anything ordered by a measure
   — forbidden by `DASH.11` and by `UX.2C` §18 and §25, not by the data. A per-person trend: the
   employee datasets are period aggregates, not time series. A store-vs-person normalisation: the
   store inventory context is deliberately not on any employee row.
10. **What should be visible in the first desktop viewport?** The role, the family's totals and floor
    verdict, and the first people with their volume, leading measure, sample and mix drawn.

### `/dashboard/accounting` — Controller / CFO

1. **What question does the manager arrive with?** Does the schedule agree with the control account,
   and if not, where.
2. **What is the first thing they currently see?** Title, the subtitle "Inventory control
   reconciliation. Not a general ledger.", the filter bar, a disclosure, then an eyebrow reading
   `Reconciliation` above `The position` above a lede, then four stat cells.
3. **Is that the right thing?** The four figures are the right four. They arrive as the fourth thing
   on the page rather than the first, and they are four equal cells — the subledger balance, the GL
   balance and the signed variance are not peers of "positions not comparable".
4. **What currently requires too much reading?** 422 words, most of it correct and load-bearing. The
   `Period ownership` region at the foot is four definition pairs and a paragraph explaining which
   date owns which row — genuinely useful to a controller, and it is 130 words of the total sitting
   below everything.
5. **Which existing data deserves geometry?** The comparison itself. Two balances and their signed
   difference is the most naturally drawable thing on any of these four routes and is currently three
   numbers in three boxes. The four comparison states are a distribution of positions and are
   currently a count and a sentence.
6. **Which details belong in a table?** The per-store, per-control-account positions, and the
   exceptions. Both are already tables/lists and both stay.
7. **Which explanations belong behind methodology?** The period-ownership matrix, the
   controlled-scenario note, the "both sides from one synthetic model" statement. The
   not-a-general-ledger limitation stays visible.
8. **What drill-through already exists?** Per-exception drill-through to the inventory position,
   where the exception type has one.
9. **Which visualization ideas cannot be supported by current grain?** A variance trend — the page
   resolves exactly one comparison date and `summarize` refuses to pool across dates. A GL account
   hierarchy — three selected control accounts is not a chart of accounts. Anything from a P&L, cash
   flow, trial balance or floorplan interest: none exists in the export.
10. **What should be visible in the first desktop viewport?** Subledger, GL, signed variance, the
    comparison-state population, and the beginning of the position table.

### `/dashboard/actions` — General Manager

1. **What question does the manager arrive with?** What needs review this morning, and how much of
   it there is.
2. **What is the first thing they currently see?** Title, subtitle, a disclosure, then an eyebrow
   reading `Review queue` above `What meets a review rule right now` above a two-sentence lede about
   ordering, then the summary.
3. **Is that the right thing?** The queue size is the right first figure. It arrives as text inside a
   summary block after 55 words of preamble, and the queue's *shape* — which domains, which
   severities, which stores — is available only as facet counts in a control bar.
4. **What currently requires too much reading?** 1,567 `proseEye` words across 207 paragraphs, and a
   16,741 px document. Each of the sixty-two review prompts renders its title, its owner role, its
   recommended review, its limitation, its date basis, its evidence rows, its thresholds and its
   drill-through as stacked paragraphs. Read once that is thorough; read sixty-two times it is
   rule-engine documentation.
5. **Which existing data deserves geometry?** The queue's own distribution — by severity, by domain,
   by store, by review role — which is already computed as facet counts over the whole queue and
   drawn nowhere. And the change-driver bridge, which is the authoritative `DASH.3` decomposition and
   currently renders below nine screens of queue.
6. **Which details belong in a table?** Nothing here is a table today. The queue is a list of
   evidence-bearing cards and should stay one; it is the *card* that needs compacting.
7. **Which explanations belong behind methodology?** Rule identifiers, ruleset hash, the
   file-is-an-input-to-the-data explanation, the facet-count derivation, the drill-through
   verification. Not the observed value, the threshold, or why the prompt exists.
8. **What drill-through already exists?** One per action, verified against the route registry at
   export time.
9. **Which visualization ideas cannot be supported by current grain?** A queue trend — the queue is
   stateless and rebuilt per dataset version, so no history exists to draw. Anything implying
   workflow state (aging, time-to-close, assignment): §35 forbids it and no such field exists.
10. **What should be visible in the first desktop viewport?** The queue size, its severity and domain
    shape, and the first review prompt.

---

## 6. What this baseline commits the increment to

| Route | Height, desktop | First figure | `proseRepo` | Target |
|---|---:|---:|---:|---|
| `/dashboard/leads-marketing` | 8,821 | 639 px | 1,102 | ≥35% prose reduction; funnel + response inside the first screen |
| `/dashboard/employees` | 5,386 | — | 303 | Geometry where there is none; fairness context made visual, not shorter |
| `/dashboard/accounting` | 3,290 | — | 422 | Geometry where there is none; balances first |
| `/dashboard/actions` | 16,741 | — | 922 | ≥25% `proseRepo` reduction; queue shape drawn; height cut hard |

Power BI real-engine validation remains externally pending; this baseline measures rendered pages and
does not change that state.
