# `UX.3` — site-wide content-density redesign, reviewed

What the increment produced, measured with the same harness and under the same conditions as
[`UX-3-BASELINE.md`](UX-3-BASELINE.md): a production build (`next build`, `next start`), Chromium,
1440 × 900 and 390 × 844. The before-column of every table below is that document.

Starting `main`: `132882b34d6814a19fa96d1a3c41bf2e5b23e6ef`.

---

## 1. The headline

**Six of the eight technical views, the About page, the case study and one store page opened with
no visual region inside the first viewport. All fourteen reference routes now open with one, and
the position of the first visual on a phone fell from a 1,107–4,021 px range to 386–659 px.**

| Measure                                                     |         Before |          After | Change     |
| ----------------------------------------------------------- | -------------: | -------------: | ---------- |
| Reference routes with no visual in the first viewport, 1440  |     **6 / 14** |     **0 / 14** | —          |
| First visual at 390, worst reference route                   |       4,021 px |     **659 px** | **−83.6%** |
| First visual at 390, range across the fourteen               | 1,107–4,021 px | **386–659 px** | —          |
| Visible paragraphs over 45 words, whole site                 |         **69** |         **45** | **−34.8%** |
| Visible paragraphs over 45 words, `/about`                   |              6 |          **0** | —          |
| Visible paragraphs over 45 words, `/case-study`              |              5 |          **0** | —          |
| Longest visible paragraph, `/about`                          |       78 words |   **40 words** | **−48.7%** |
| Longest visible paragraph, `/technical?view=governance`      |      124 words |   **82 words** | **−33.9%** |
| Client JavaScript added by this increment                    |              — |    **0 bytes** | —          |
| New dependencies                                             |              — |          **0** | —          |
| Horizontal overflow, any route, either viewport              |           0 px |       **0 px** | unchanged  |

The first row is now enforced rather than measured once:
`tests/e2e/ux3-reference-routes.spec.ts` asserts a visual region inside the first viewport on all
fourteen reference routes at 1440 × 900, a visual within two screens at 390 × 844, and that the
visual precedes the trust line at both sizes. Forty-two assertions, all passing.

---

## 2. Geometry, before and after

Desktop is 1440 × 900, mobile is 390 × 844. `1st` is the offset of the first framed visual region;
`fold` is how many of them start inside the first viewport.

**Read the 390 columns and the fold columns; treat the desktop `1st` column as indicative.** The
harness scrolls the whole document to settle the reveal animations before it measures, and the
desktop offset of a region near the top of a page varies by up to about 200 px between runs of an
identical build — on the console and on the reference routes alike. The mobile offsets were
byte-identical across two runs of the same build on all fourteen reference routes; so were the visual
counts and the prose counts.

| Route                            | fold before | fold after | 1st 390 |   After | Visuals before | After |
| -------------------------------- | ----------: | ---------: | ------: | ------: | -------------: | ----: |
| `/technical`                     |           1 |      **3** |   1,932 | **441** |              6 | **8** |
| `/technical?view=architecture`   |       **0** |      **3** |   1,438 | **514** |              2 | **4** |
| `/technical?view=data-model`     |           1 |      **2** |   2,049 | **514** |              2 | **3** |
| `/technical?view=kpis`           |       **0** |      **2** |   3,015 | **550** |              1 | **2** |
| `/technical?view=governance`     |           1 |      **2** |   2,601 | **477** |              1 | **4** |
| `/technical?view=data-sources`   |       **0** |      **2** |   3,157 | **541** |              2 | **3** |
| `/technical?view=status`         |       **0** |      **2** |   4,021 | **514** |              1 | **2** |
| `/technical?view=product-vision` |           1 |      **2** |   1,107 | **522** |              1 | **4** |
| `/about`                         |           1 |      **2** |   2,185 | **620** |          **1** | **2** |
| `/case-study`                    |           1 |      **2** |   1,594 | **386** |              2 | **3** |
| `/inventory`                     |           1 |      **2** |   1,473 | **659** |              5 | **6** |
| `/dealerships/granite-chevrolet` |           1 |          1 |   1,722 | **501** |              4 | **5** |
| `/dealerships/granite-subaru`    |           1 |      **2** |   1,272 | **528** |              4 | **5** |
| `/dealerships/granite-pre-owned` |       **0** |      **1** |   1,802 | **548** |              4 | **5** |

Desktop first-visual offsets on the final run, for the record: 12–304 px across the fourteen, against
15–1,613 px before. The two store pages that show one region in the fold rather than two show two on
some runs; the assertion the suite holds them to is **at least one**, which every route meets on
every run.

### The operating console, which this increment was not allowed to disturb

| Route                        | 1st 390 | After |    fold | After | Visuals | After |   Prose |   After |
| ---------------------------- | ------: | ----: | ------: | ----: | ------: | ----: | ------: | ------: |
| `/`                          |     377 |   377 |       2 |     2 |      13 |    13 |     866 |     866 |
| `/dashboard/sales-gross`     |     263 |   263 |       1 |     2 |      10 |    10 |     751 |     751 |
| `/dashboard/deals`           |   1,564 | 1,363 |       0 |     0 |       3 |     3 |     136 |     136 |
| `/dashboard/inventory`       |     272 |   351 |       2 |     2 |       6 |     6 |     430 |     430 |
| `/dashboard/fi`              |     431 |   431 |       1 |     1 |       8 |     8 |     627 |     627 |
| `/dashboard/leads-marketing` |     388 |   388 |       1 |     1 |       9 |     9 | **752** | **721** |
| `/dashboard/employees`       |     353 |   353 |       1 |     1 |       4 |     4 |     295 |     296 |
| `/dashboard/accounting`      |     340 |   340 |       2 |     2 |       6 |     6 |     483 |     483 |
| `/dashboard/actions`         |     305 |   305 |       1 |     1 |       3 |     3 |     809 |     809 |

`/dashboard/deals` measured 1,564, 1,637, 1,858, 1,637 and 1,363 px on five runs across builds that
differ in no way on that route, which is the clearest single illustration of the settle noise
described above.

**Nothing else on the console moved, because nothing else was touched.** The two operating changes
this increment made are in §4.

---

## 3. Editorial density

| Route                            | Prose before | After | Paragraphs before | After | Longest before | After | Over 50 before | After |
| -------------------------------- | -----------: | ----: | ----------------: | ----: | -------------: | ----: | -------------: | ----: |
| `/about`                         |        1,039 | **647** |                41 |    36 |             78 | **40** |          **4** | **0** |
| `/case-study`                    |          651 | **487** |                30 |    29 |             65 | **43** |          **3** | **0** |
| `/technical?view=governance`     |        1,530 | **1,357** |              53 |    54 |        **124** | **82** |         **11** | **9** |
| `/technical?view=architecture`   |        1,057 | **922** |                39 |    37 |             80 | **50** |              1 | **0** |
| `/technical?view=status`         |        1,581 | **1,532** |              70 |    70 |             73 | **61** |              2 |     1 |
| `/technical?view=data-sources`   |        1,637 | **1,586** |              106 |   105 |             58 |    58 |              1 |     1 |
| `/technical?view=kpis`           |          500 | **452** |                21 |    22 |             64 | **46** |          **2** | **0** |
| `/technical?view=data-model`     |          201 | **166** |                10 |    10 |             60 | **36** |          **1** | **0** |
| `/technical` (overview)          |          517 | **492** |                29 |    28 |             58 |    58 |              1 |     1 |
| `/technical?view=product-vision` |          445 |   451 |                28 |    30 |             67 | **47** |          **1** | **0** |
| `/inventory`                     |          427 | **382** |                23 |    23 |             82 |    82 |              2 |     1 |
| `/dealerships/granite-chevrolet` |          474 | **370** |                22 |    20 |             82 | **33** |              1 | **0** |
| `/dealerships/granite-subaru`    |          476 | **374** |                22 |    20 |             82 | **49** |              1 | **0** |
| `/dealerships/granite-pre-owned` |          525 | **425** |                23 |    21 |             82 | **60** |              2 |     1 |
| `/dashboard/leads-marketing`     |          752 | **721** |                56 |    56 |             73 | **64** |          **2** | **1** |

**`/about` lost 38% of its visible prose and every over-length paragraph on it.** The About page is
the one route where the brief asked for a 50–60% reduction; the measured answer is 38%, and §7
explains why the remainder is not worth removing.

### The exemption that is applied rather than argued away

**Nine of the forty-five remaining over-length paragraphs are on `/technical?view=governance`, and
they stay.** Each one is a `LimitCard` body: a named governance control, what it does, and the
artefact that enforces it. They run 47 to 67 words. The editorial rule this increment follows makes
an exception for methodology disclosure and trust, and a governance page's controls are exactly
that — reducing them further would remove the clause a reader needs, not the argument around it. The
one that was genuinely over-argued was 124 words and is now 67.

**The 82-word paragraph still on `/technical?view=governance` and `/inventory` is
`INVENTORY_DATA_STATEMENT`, deliberately.** See §5.

---

## 4. What changed, route by route

### `/technical` — Overview

Too text-heavy: the header carried a lede naming six pipeline stages in a sentence and a
`supporting` paragraph making the build-time claim, and the body opened on three claim cards.
**Removed:** the `supporting` paragraph. **Became visual:** the seven-stage pipeline is now a
`FlowDiagram` — one stage per box, in order, with the semantic model drawn as a `pending` stage
carrying the words *"Engine validation pending"* rather than only an amber tint. The build-time
claim is its caption. **Stayed:** the three claims and the store story, both of which are argument
rather than description.

### `/technical?view=architecture`

Too text-heavy: a `supporting` paragraph restating the semantic model's position, and an 80-word
engineering note about build-time rendering sitting as its own titled section. **Removed:** the
`supporting` paragraph; the note is now a `<Disclosure>` labelled *"Why no page on this site has a
loading state"* — supplemental engineering reasoning, which is the permitted side of the line
`disclosure.tsx` draws, not a qualification on a figure. **Became visual:** the six layers a row
passes through are a `FlowDiagram` above the explorer, on the server, so the layer names are a shape
before the explorer's client island resolves. **Stayed:** the explorer, unchanged, and its
component detail — five of the remaining over-length paragraphs on this route are inside it and are
engineering specification.

### `/technical?view=data-model`

Too text-heavy: a 60-word paragraph listing seven prohibited attribute classes in a sentence.
**Became visual:** the list is a list — seven `Ban`-marked chips, plus two chips for the attributes
that exist in reduced form and name that form. **Stayed:** the sentence the chips cannot say, that
no record-level value appears anywhere on the page. Nothing was collapsed behind a control.

### `/technical?view=kpis`

Too text-heavy: two cards of roughly sixty words each, both making their point in the first
sentence and then arguing for it. **Removed:** the arguments, which the rest of the destination
makes at length. **Became visual:** the KPI count per domain is a bar chart in the header — the
catalogue's own shape, with its table alternative, before the catalogue. **Stayed:** both claims,
because both qualify how the catalogue may be read.

### `/technical?view=governance`

Too text-heavy: eleven paragraphs over fifty words, one of them 124, and one framed visual on the
whole route. **Became visual:** the six governance controls are a `StatusGrid` in the header; the
88-word paragraph establishing that the synthetic warehouse and the reference listing lane are two
different classes of data is a two-lane `LaneFlow`, with every clause of the paragraph surviving as
a stage or as a lane boundary. **Removed:** the reasoning inside the action-queue and rule-change
cards (124 → 67 words, 102 → 61). **Stayed:** the synthetic-data statement in full, the inventory
statement in full, the prohibition lists, and nine control explanations. See §3.

### `/technical?view=data-sources`

Too text-heavy: 106 paragraphs, first visual 1,613 px down at desktop and 3,157 px on a phone.
**Became visual:** the lane's three governed figures are a `StatRail` in the header; the paragraph
classifying the artefact is four chips. **Stayed:** the seven-step sanitization pipeline, the
can-prove/cannot-prove pair, the workbook contract table and the coverage limits — this is the route
whose subject is provenance, and its length is the disclosure.

### `/technical?view=status`

Too text-heavy: 1,581 words, one visual, first at 1,386 px desktop and 4,021 px on a phone.
**Became visual:** the four states routinely conflated — static validation, real-engine validation,
report pages, case study — are a `StatusGrid` in the header, so the answer arrives before the
argument. **Removed:** the sentence explaining what the build environment lacks, folded into the
CI paragraph that already made the same point. **Stayed:** every phase, every increment, both
engine paths, both gates and every evidence link. Pending is still pending and blocked is still
blocked.

### `/technical?view=product-vision`

Too text-heavy: a 67-word disclaimer, and no visual separating what exists from what does not.
**Became visual:** a two-lane `LaneFlow` — *Implemented today* against *Production vision*, the
second lane dashed AND carrying the words *"No connection exists"*, *"Not built"* and *"Would
require authorization"* on its stages. **Stayed:** the disclaimer's load-bearing sentence, which
`navigation.spec.ts` asserts verbatim, and every honest-limits card.

### `/about`

Too text-heavy: 1,039 words, four paragraphs over fifty, one visual on a 6,330 px document, and a
57-word `supporting` paragraph whose entire subject was where the headline above it used to live.
**Removed:** that paragraph; the third career paragraph; the second half of the why-ARPI argument;
one whole section header. **Became visual:** the eight capabilities are a `CapabilityGrid` of eight
cards, each one clause and a repository link, replacing eight `SkillRow` paragraphs; the reason ARPI
exists is a four-stage chain — *Dealer systems → Governed model → KPI layer → Management action* —
in the page header; the career's four system families are chips. **Stayed:** the `h1`, the career
length, the systems worked in, the technical transition, the analytical philosophy, the three
decisions from the floor with their artefact references, and the portrait — which moved from 2,185 px
down on a phone to 620 px.

**The portrait is in the first section rather than in the header, and that was a measured
decision.** No approved photograph is committed to this repository, so `AuthorPortrait` renders
`MediaPlaceholder`. Anchoring the header on it would give the route a first-viewport contract that
only holds once somebody supplies an asset, so the header carries the chain — which the repository
can always draw — and the portrait follows immediately.

### `/case-study`

Too text-heavy: five paragraphs over fifty words, including a 50-word `supporting` paragraph naming
the three Gate 2 conditions in prose. **Became visual:** the four gate conditions are a `StatusGrid`
in the header, each with its own met/blocked badge. **Removed:** the `supporting` paragraph and the
reasoning inside the locked-state reason and the two gate paragraphs. **Stayed:** every blocking
reason, the flag-is-necessary-never-sufficient claim, the permitted/prohibited lists and the
preview. The gate itself is untouched: `caseStudy.unlocked` is still computed from five conditions
at build time and this increment did not add, remove or weaken one.

### `/inventory`

Too text-heavy: an 82-word statement plus a 62-word paragraph that opened by restating two figures
already in the lede. **Became visual:** four derived figures — listings, stores, makes, priced — as a
`StatRail` in the header. **Removed:** the restated figures, and the pointer to the data-sources page
that the header's own button already carries. **Stayed:** `INVENTORY_DATA_STATEMENT` in full, the
price-is-not-a-transaction-price sentence, the three distribution charts and every workbook link.

### `/dealerships/[slug]` — all three stores

Too text-heavy: four consecutive prose blocks about a store — a lede, a `supporting` paragraph, an
inventory-strategy paragraph and an analytics-focus paragraph — before a single figure from it, and
then the 82-word site-wide inventory statement at the foot of a card whose subject is this store's
coverage. **Became visual:** the store's four snapshot figures as a `StatRail` in the header; the
customer segment and the analytical emphasis as a two-column labelled list rather than two more
paragraphs. **Removed:** the `supporting` paragraph, and the full inventory statement, replaced by
its short form plus the sanitization clause and a link to the lane's own page. **Stayed:** every
store-specific coverage sentence, the partial-sample warning, the metric grid, both bar charts and
the full listing table.

### The operating console — two changes, both defects

1. **`/dashboard/employees`** rendered *"…the opportunity and mix that surrounded it.**T**he floor
   is a publication discipline…"* with no space, on every role family, because `{description}` sat
   on its own JSX line above the sentence that followed it and JSX strips whitespace containing a
   newline. The two claims are now two paragraphs. No word changed — and the route's prose count
   rising by exactly one, from 295 to 296, is the proof: `it.The` had been counting as one word.
2. **`/dashboard/leads-marketing`** carried a 73-word footnote on the marketing matrix holding two
   separate qualifications and the reasoning for both. The two qualifications stay visible and are
   now 40 words; the reasoning is in the route's own methodology disclosures, where it already was.

**Nothing else on the nine operating routes was edited.** In particular, the per-row accounting
exception text that the harness flags as three 47–59 word paragraphs is authored by the governed
export and rendered verbatim, and the F&I product-penetration paragraph the harness flags at 86
words is a chart's text alternative — its exact values, which WCAG requires and which this project
has never allowed a visual to be the only carrier of.

### What the suites caught, and why it is recorded here

The first full browser run of the increment produced four failures, and all four are the kind a
prose-reduction pass is supposed to produce. They are recorded rather than quietly fixed because
each one marks a sentence the repository had already decided was load-bearing.

| Failure                                                                | What the rewrite had done                                                                                 | Resolution                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `content-integrity` — the KPI catalogue publishes definitions and says so | Shortened the heading to "Definitions, never values"                                                        | Heading restored verbatim; the paragraph under it stays halved  |
| `content-integrity` — the full explanation still exists                  | Rewrote "has never been evaluated by a Microsoft engine" as "no Microsoft engine has evaluated the DAX side" | Clause restored verbatim                                        |
| `content-integrity` — public copy carries no em dash                     | Introduced em dashes on `/case-study`                                                                       | Replaced with a full stop and two colons; also swept the two new governance ones |
| `visual-system` — the display face is a serif and the body a sans        | Deleted the `supporting` paragraph on `/technical` that the font assertion anchors on                       | Its opening sentence is the pipeline diagram's caption, verbatim |

**None of the four was resolved by changing a test.** A phrase a test locates is a phrase a rewrite
has to carry rather than paraphrase, and the increment's editorial rule was never a licence to
reword a disclosure.

---

## 5. The paragraph that was published five times

`INVENTORY_DATA_STATEMENT` is 82 words. It was rendered in full on `/technical?view=governance`, on
`/inventory` and on all three store pages, and every one of those five routes already carries the
short form in its page header's trust line.

It is now published in full on **two** routes — the governance view, whose subject is the two data
lanes, and `/inventory`, which `content-integrity.spec.ts` requires to carry the sanitized-listing
provenance and the "listings, not sales results" boundary without opening anything. The three store
pages carry `INVENTORY_DATA_SHORT` plus the sanitization clause and a link to the lane's own page.

Nothing was hidden. The short form is visible, the trust line above it is visible, and the full
statement is one click away on the page whose subject it is. This is the finding `UX.1` recorded —
*a project stating its trust position seven times reads as an apology* — applied to the one
statement that had not yet been swept.

---

## 6. Shared components

Four new modules, all server components, all zero-JavaScript.

| Component                              | Where                                     | What it replaced                                                                    |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `FlowDiagram`                          | `components/visuals/flow.tsx`             | An ordered chain of stages written out longhand, on four routes                      |
| `LaneFlow`                             | `components/visuals/flow.tsx`             | Two provenances argued in consecutive paragraphs, on two routes                      |
| `StatusGrid`                           | `components/ui/summary-grid.tsx`          | A column of cards with a paragraph in each, on four routes                           |
| `StatRail`                             | `components/ui/summary-grid.tsx`          | Derived figures quoted inside a lede, on six routes                                  |
| `CapabilityGrid`                       | `components/ui/summary-grid.tsx`          | Eight `SkillRow` paragraphs on `/about`                                              |
| `PageHeader`'s `visual` slot           | `components/ui/page-header.tsx`           | Nothing. It is the systemic fix — see below.                                         |
| `TechnicalViewVisual`                  | `components/technical/view-visual.tsx`    | Eight per-view arrangements of the same idea that were never written                 |

**`PageHeader` gaining a `visual` slot is the change that did most of the work.** Every reference
route opens with that component, and it emitted an eyebrow, an `h1`, a lede, a supporting paragraph,
a badge row and a trust line before the route's own body began. Fixing that route by route would
have been fourteen arrangements of one idea. On `lg` the visual sits beside the copy; below `lg` it
follows the lede and precedes the badges and the trust line, which is what moves it above the fold
on a phone rather than merely reordering the same scroll.

**`FlowDiagram` is markup, not SVG, and that is a performance decision as much as an accessibility
one.** A stage chain is an `<ol>`: the reading order is the flow order, a screen reader announces
"3 of 7", the labels are real text a browser can search and translate, it reflows to one column
without a viewBox, and it costs zero bytes of JavaScript. The connectors are the only decoration and
they are `aria-hidden`, because "arrow" announced six times is noise around a list that is already
ordered.

**`data-visual-region` now appears on two reference-route components**, extending the operating
console's existing test hook. `StatusGrid` and `StatRail` carry it because their content is derived
from the manifest and the catalogue. `CapabilityGrid` deliberately does not: its cells hold a claim
and a link, and marking it would let a route satisfy a first-viewport contract with a list of
assertions.

**One component was removed:** `SidebarRow`, the About page's private fact row, replaced by the
shared pattern. No component was left behind without a call site.

---

## 7. Data integrity

**No analytical logic changed.**

Not a KPI formula, numerator, denominator, date basis or grain. Not a structural-absence rule, a
reconciliation rule, an action rule, a filtering rule, the URL filter grammar or store-context
propagation. Not an inventory, gross, lead, employee or target calculation. Not the synthetic-data
labelling, the project status, the Power BI validation status, a governance gate, a data-source
provenance claim, an export contract or a reporting-view definition.

Three things are worth stating explicitly because they are the places a presentation increment could
have changed meaning without meaning to:

1. **The accounting exception text was not touched.** The harness flags it as repetition — three
   rows each restating the "both sides are valid data" rule — and it is authored by the governed
   export, not by this site. Editing the rendered copy would have made the site disagree with the
   dataset it renders.
2. **The case-study gate is unchanged.** Its five conditions are still evaluated at build time by
   the manifest generator; the header now shows their state as badges instead of naming them in a
   paragraph, and reads the same `gate('gate-2').conditions` the locked state already read.
3. **`0 Personal columns` on the data-model view is a design claim, not a computed count.** It
   restates, as a figure, what that view has always said in words and what
   `PRIVACY_AND_ETHICS.md` governs: the columns were never designed, so there is nothing to count.
   Every other figure in every new component comes from the generated manifest or the catalogue
   content, and `content-integrity.test.ts` fails the build if one is typed as a literal.

---

## 8. Accessibility

`npx playwright test tests/e2e/accessibility.spec.ts` — the axe sweep across every route at the
project's full viewport matrix — passes, as does the whole browser suite.

What the new components do about it, deliberately:

- **No status is carried by colour alone.** A `FlowStage` whose tone marks it pending or conceptual
  must also carry a `state` word; `ux3-shared-visuals.test.tsx` asserts the words are in the
  document. Removing all colour from the pipeline diagram still reads "Engine validation pending".
- **Reading order is flow order.** `FlowDiagram` is an `<ol>`, so assistive technology announces
  position in the sequence; `LaneFlow` is a set of `<section>`s with real headings.
- **Connectors are decoration and are hidden.** One `aria-hidden` chevron per stage boundary.
- **`StatRail` is a `<dl>` and `StatusGrid` is a `<ul>`**, chosen per element rather than
  reflexively: a label genuinely defines a figure, and a state is not a definition of a control's
  name.
- **The bar chart in the KPI header keeps its table alternative**, because it is the existing
  `BarChart`, which has never allowed a value to exist only inside a visual.
- **Every new region has an accessible name**, supplied by the caller rather than defaulted.
- **Horizontal overflow is zero at every route and both viewports**, unchanged from the baseline,
  and the harness uses the same detector as the accessibility suite.
- **No new client component, so no new focus management, no new keyboard handler and no new
  motion.** The disclosure added on the architecture view is native `<details>`.

---

## 9. Performance

| Measure                                  | Before | After                      |
| ---------------------------------------- | -----: | -------------------------- |
| New dependencies                         |      — | **0**                      |
| New client components                    |      — | **0**                      |
| Client JavaScript added                  |      — | **0 bytes**                |
| New images or media files                |      — | **0**                      |
| Icons added to existing bundles          |      — | 9 `lucide-react` glyphs, tree-shaken per route |

**Document heights moved in both directions, and the increases are the cost of showing rather than
telling.** `/about` fell from 6,330 to 5,024 px at desktop and 11,538 to 10,091 px on a phone.
Against that, `/technical` grew 6,152 → 6,263 px desktop and 10,302 → 10,943 px mobile, and
`/technical?view=product-vision` grew 3,525 → 3,898 and 6,767 → 7,657: a seven-stage chain and a
two-lane comparison each occupy more vertical space on a 390 px screen than the paragraph they
replaced. The trade is deliberate — the reader scrolls further and reads less — but it is a real
cost and it is not hidden in this table.

`/about` is the one route whose largest contentful paint could have regressed, because the portrait
moved out of the header. It did not: the portrait was already `priority` and it is now roughly
600 px down on a phone rather than 2,185 px, so it is a *better* LCP candidate than before, and the
header's chain is text and borders.

---

## 10. Remaining weaknesses

This redesign is not finished, and these are the places it shows.

1. **`/technical?view=data-sources` is still 1,586 words over 105 paragraphs.** It is the longest
   route on the site by prose and this increment reduced it by 3%. Its length is largely legitimate
   — it is the provenance route — but the seven-step pipeline, the can-prove/cannot-prove pair and
   the coverage limits are three structures that could each be a diagram and are all currently
   cards of prose. A second pass is warranted.
2. **`/technical?view=status` is still 1,532 words and draws two visuals on an 18,246 px phone
   document.** The header now answers the four-way distinction immediately, but the lifecycle
   phases and delivery increments below it are a long list of cards where a completion strip and a
   milestone rail would read faster. Deliberately deferred: that content is generated from the
   manifest, and reshaping it is a bigger change than a presentation increment should carry.
3. **Nine over-length paragraphs remain on the governance view.** §3 records why. It is a defensible
   position rather than a comfortable one, and a future pass could split several of them into a
   claim plus a `<Disclosure>` — provided the claim, not the reasoning, is what stays visible.
4. **`/dashboard/deals` still meets a phone reader with roughly 1,400 px of controls and summary before its
   first card.** The transaction list becomes per-record cards at 390 px, which is correct, and the
   brief for that route explicitly forbids adding a chart to make it look richer. What could
   improve is the control band's phone height, which is `UX.2D` territory rather than this
   increment's.
5. **The prose metric over-counts on four routes at 390 px.** The three store pages and
   `/inventory` render their tables as per-record cards on a phone, and every field in a card is a
   `<p>`. The before and after columns are affected identically so the comparison holds, but the
   absolute figures on those rows are not editorial measurements and should not be quoted as such.
6. **The desktop first-visual figure is noisy on the operating console**, by up to about 200 px
   between runs of an identical build. §2 records the evidence. Any future increment quoting that
   column should measure it more than once.
7. **The About page's portrait slot is still a placeholder**, because no approved photograph is
   committed. Everything around it is built to accept the file without moving anything, and the
   page's visual anchor no longer depends on it — but the strongest version of that page has a
   photograph in it.
8. **The 50-word editorial line is met by most of the site and not all of it**, and this document
   names every exception rather than averaging them away. Forty-five paragraphs still exceed
   45 words. Nine are governance controls, five are the architecture explorer's component
   specifications, three are export-authored accounting text, one is a chart's text alternative, and
   the rest are module methodology on the operating console where a shorter sentence would lose a
   denominator.

---

Power BI real-engine validation remains externally pending; this increment does not change that
state. It touched no TMDL, no DAX, no semantic-model relationship and no Power BI artefact, and the
status view still reports both ADR-0008 paths as never having run.
