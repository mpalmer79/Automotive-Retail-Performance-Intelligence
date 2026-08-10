# ARPI experience redesign, version 2

The record of the redesign that turned the ARPI website from a documentation
portal into a product experience. Baseline audit, decisions, three adversarial
review passes, and the outcome.

Nothing in this document may be used to justify a claim the repository cannot
prove. The redesign changed presentation. It changed no project status, no gate
verdict and no count.

---

## 0. Superseded in its product priority by `UX.1`, and not in its evidence

**`UX.1` supersedes this document's PRODUCT PRIORITY. It does not supersede its
measurements, its findings, or the reasoning behind them, and nothing below has
been rewritten to look as though `UX.1` existed at the time.**

What changed between the two, and why this document went stale where it did:

- **This redesign was correct for a site with two working surfaces.** When it was
  written the operating console was `/dashboard` and one page. A landing page
  introducing the product, a four-route product tour and a seven-item header were
  the right architecture for a project whose product was mostly still a promise.
- **By the end of `DASH.11` there were nine operating surfaces**, reading
  twenty-eight governed reporting views. The site in front of them still opened on
  an introduction and still offered "Inventory" and "Governance" as equal
  top-level choices. The product-tour architecture was describing an application
  that had become larger than the description.
- **`UX.1` inverted the hierarchy.** `/` is the Executive Command Center;
  `/dashboard` is a permanent redirect to it; six documentation routes became one
  technical destination; the console's sections became an application rail; and
  the marketing home's sections were rehomed rather than deleted — the store story
  and the product tour are `/technical?view=overview`, the author positioning is
  `/about`.

What survived unchanged, because it was right: the token bridge, the two-family
type pairing, the canvas-on-field composition, the single trust line per reference
route, the disclosure-over-deletion rule, and the finding that a project stating
its trust position seven times reads as an apology. `UX.1` applied that last
finding to the operating half of the site, which this redesign had not reached.

The `UX.1` decision is
[ADR-0015](../../docs/architecture-decisions/ADR-0015-product-first-operating-experience.md);
its measured before-and-after is
[`UX-1-BASELINE.md`](../../docs/reviews/UX-1-BASELINE.md) and
[`UX-1-REVIEW.md`](../../docs/reviews/UX-1-REVIEW.md).

Where a section below describes a route that has moved, the route is named as it
was. `/kpis` meant what `/technical?view=kpis` means now; `/dashboard` meant what
`/` means now. Rewriting those references would make a record of what was
measured into a claim about what is.

---

## 1. Baseline

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Live URL        | `https://arpi.up.railway.app`                                      |
| `main` at audit | `04a7984f8fdb321f9ce2560577266fe21df9c86a`                         |
| Manifest commit | `ba3818e645b6e7b830cf046227e1b9f2e4bac6fc`                         |
| Framework       | Next.js 16.2.12, App Router, all routes statically prerendered     |
| Styling         | Tailwind v4 with a closed token bridge, three local variable fonts |
| Animation       | `motion` 12.43 on three routes, CSS reveal everywhere else         |
| Deployment      | Railway, Docker from the repository root, health check `/status`   |

### 1.1 How the baseline was measured

The live deployment could not be reached from the environment this audit ran in:
this session's egress policy answers `403` to `CONNECT arpi.up.railway.app:443`,
recorded in the proxy's own failure log. Every measurement below was therefore
taken against a **production build of the audited commit served locally**
(`next build` then `next start`), which is the same artefact Railway serves. The
consequences for live verification are recorded in section 8.

- Screenshots: `npm run review:screenshots`, ten routes at seven viewports plus
  reduced-motion and 200 percent zoom variants. Output goes to
  `portfolio/review-screenshots/`, which is gitignored. Nothing binary was
  committed.
- Bundles: `npm run bundle`, cold-load transfer sizes measured over the wire.
- Lighthouse 13.4.1, desktop preset, against the local production server.
- axe-core through `tests/e2e/accessibility.spec.ts`.

### 1.2 Route inventory

Nine public routes plus an internal lab.

| Route           | Purpose as built                       | In primary nav           |
| --------------- | -------------------------------------- | ------------------------ |
| `/`             | Nine sections of narrative             | Yes                      |
| `/architecture` | Interactive pipeline explorer          | Yes                      |
| `/data-model`   | Entity and relationship explorer       | Yes                      |
| `/kpis`         | Filterable KPI catalogue               | Yes                      |
| `/governance`   | Trust framework and gates              | Yes                      |
| `/status`       | Lifecycle, increments, gates, evidence | Yes                      |
| `/about`        | Author narrative                       | Yes                      |
| `/case-study`   | Locked by Gate 2                       | No, but a header control |
| `/ui-lab`       | Internal design-system reference       | No, `noindex`            |
| `/not-found`    | 404                                    | n/a                      |

### 1.3 Navigation inventory

Seven primary destinations, plus a bordered amber "Case Study LOCKED" control,
plus a GitHub icon. Nine interactive targets in a 64px header. The single most
visually prominent element in the header is a link to the one page that has no
content.

### 1.4 Homepage section inventory

Nine sections, eight of them wrapped in `<Section bordered>` with identical
`py-section` rhythm and an identical hairline rule between each.

1. Hero
2. Credibility strip, seven animated counts
3. Business problem, six cards
4. Pipeline scrollytelling, eight stages
5. Analytical domains, six expandable cards
6. Evidence ledger, ten timeline records
7. Lifecycle summary, eight phase cards
8. Author perspective, three cards
9. Final call to action

Card count on one page: 6 + 6 + 8 + 3 = 23 bordered panels, plus 10 ledger rows
and 7 count blocks.

### 1.5 Component inventory

- Shell: `SiteHeader` (client), `SiteFooter`, `PreviewNotice`
- UI: `Button`/`LinkButton`/`IconButton`, `Badge`/`StatusBadge`/`KpiChip`,
  `Card`, `InteractiveCard` (client), `Container`/`Section`/`Stack`/`Cluster`/
  `Grid`/`Prose`, `Heading`/`Text`/`Eyebrow`/`CodeLabel`/`GrainLabel`,
  `EmptyState`/`LockedState`/`SkipLink`/`Breadcrumbs`, `PageHeader`,
  `DataCard`/`SourceLink`/`EvidenceItem`/`DefinitionList`
- Sections: nine homepage sections plus `TrustFramework` and `CaseStudyPreview`
- Explorers: `ArchitectureExplorer`, `DataModelExplorer`, `KpiCatalogue`, all client
- Motion: `Reveal`/`RevealGroup`/`RevealItem` (client, CSS), `MotionBoundary`/
  `AnimatedCount` (client), `PipelineHero` (client, `motion`)

Client components: 9. Routes loading the `motion` library: 3 (`/`,
`/architecture`, `/data-model`).

### 1.6 Design token inventory

`src/styles/tokens.css`: 6 colour ramps and 33 semantic colour tokens, 3 font
families, 11 type steps, 4 line heights, 5 tracking steps, 16 space steps plus 2
section steps, 8 radii, 5 shadows, 7 motion durations, 4 easings, 9 z-index
steps, 6 layout widths. Bridged into Tailwind by `theme.css` with
`--color-*: initial` so the palette is closed.

The token system is a genuine strength and is **kept**. The problem is not the
tokens, it is that the components draw from a narrow slice of them: one card
radius, one border colour, one section rhythm.

### 1.7 Motion inventory

| Motion                             | Where                          | Implementation             |
| ---------------------------------- | ------------------------------ | -------------------------- |
| Section reveal, fade and rise 16px | 6 routes, ~40 elements         | CSS + IntersectionObserver |
| Staggered group reveal, 55ms       | 5 groups                       | CSS transition delay       |
| Count-up                           | 7 numbers on `/`               | rAF                        |
| Hero path draw and node entrance   | `/`                            | `motion`                   |
| Stage width transition             | `/` scrollytelling             | `motion`                   |
| Node emphasis                      | `/architecture`, `/data-model` | `motion`                   |
| Hover lift 1px, pointer gradient   | interactive cards              | CSS + rAF                  |

Every single one is a _decoration_ except the hero path draw. Nothing in the
motion system explains the platform.

### 1.8 Measured page lengths

Full-page screenshot heights of the audited build.

| Route           | 1440px | screens @900 |  375px | screens @844 |
| --------------- | -----: | -----------: | -----: | -----------: |
| `/`             | 10,580 |     **11.8** | 19,710 |     **23.4** |
| `/architecture` | 10,631 |         11.8 | 17,588 |         20.8 |
| `/status`       | 10,461 |         11.6 | 17,343 |         20.5 |
| `/data-model`   |  7,823 |          8.7 | 15,631 |         18.5 |
| `/kpis`         |  7,223 |          8.0 | 12,850 |         15.2 |
| `/governance`   |  6,607 |          7.3 | 10,760 |         12.7 |
| `/case-study`   |  5,040 |          5.6 |  8,410 |         10.0 |
| `/about`        |  4,427 |          4.9 |  7,681 |          9.1 |

At 320px the homepage is 21,969px tall: **twenty-six phone screens**.

### 1.9 Bundle sizes, cold load, compressed

Route cost alone:

| Route           |    HTML |       JS |     CSS |    Fonts |    Total |
| --------------- | ------: | -------: | ------: | -------: | -------: |
| `/`             | 38.1 kB | 230.3 kB | 12.3 kB | 100.9 kB | 382.9 kB |
| `/data-model`   | 21.9 kB | 226.0 kB | 12.3 kB | 100.9 kB | 362.4 kB |
| `/architecture` | 23.9 kB | 215.1 kB | 12.3 kB | 100.9 kB | 353.5 kB |
| `/kpis`         | 14.9 kB | 186.5 kB | 12.3 kB | 100.9 kB | 315.9 kB |
| `/status`       | 35.0 kB | 166.1 kB | 12.3 kB | 100.9 kB | 315.5 kB |
| `/governance`   | 25.3 kB | 172.4 kB | 12.3 kB | 100.9 kB | 312.2 kB |
| `/case-study`   | 23.8 kB | 166.1 kB | 12.3 kB | 100.9 kB | 304.3 kB |
| `/about`        | 21.2 kB | 166.1 kB | 12.3 kB | 100.9 kB | 301.8 kB |

With navigation prefetch every route settles at 303.2 kB of JavaScript, because
the header prefetches all seven primary destinations.

### 1.10 Lighthouse, desktop preset, local production build of `/`

| Category       | Score |
| -------------- | ----: |
| Performance    |   100 |
| Accessibility  |   100 |
| Best practices |    96 |
| SEO            |   100 |

FCP 0.3s, LCP 0.7s, CLS 0, TBT 10ms, Speed Index 0.4s.

Performance is **not** a problem in the baseline and must not become one. The
two audits below 0.9 are real defects and are listed as findings.

### 1.11 Accessibility results

axe-core reports zero critical and zero serious violations across all nine
routes at desktop and mobile widths. Two defects Lighthouse found that axe did
not are listed as findings B-04 and B-05.

### 1.12 Strongest elements in the baseline

These are kept, and several are made more prominent.

1. **The manifest.** Every count on the site is generated from repository
   evidence and the build fails if it drifts. This is the most credible thing
   the project does and it is barely dramatised.
2. **The status vocabulary.** `StatusBadge` renders an icon and a word, never a
   colour alone. "Pending external validation" is never softened.
3. **The case-study gate.** Five conditions, four of them file-existence checks,
   so a build flag cannot unlock an empty page.
4. **The token system.** Closed palette, `--color-*: initial`, tested.
5. **The `sr-only` redefinition** and the `overflow-wrap: anywhere` rule, both
   of which fix real, subtle layout defects.
6. **The refusal to show a KPI value anywhere.** Correct, and rare.
7. **The CSS-first reveal**, which keeps the animation library off five routes.

### 1.13 Weakest elements in the baseline

1. The hero asks a visitor to read three separate risk disclosures before it
   offers them anything to do.
2. Michael Palmer's name does not appear above the fold on any route except
   `/about`. The differentiator the whole portfolio rests on is in section 8 of 9.
3. Every section looks the same.
4. The loudest control in the header points at the emptiest page on the site.
5. Nothing on the site is memorable as an image.

---

## 2. Findings

Severity is judged by effect on the visitor, not by effort to fix.

### Critical

**A-01 The first mobile screen contains no product, no action and no author,
only disclosure.** At 390x844 a visitor sees eyebrow, headline, a five-line
paragraph, then a bordered panel of two status badges and a four-line caveat.
The first call to action is roughly 1,050px down; the signature visual is
roughly 1,400px down. A recruiter on a phone leaves before reaching either.
_Evidence: `home-375.png`, first viewport._

**A-02 The strongest differentiator is invisible until section 8 of 9.** "More
than 25 years in automotive retail combined with the ability to build the
system" is the entire argument of the portfolio. On the homepage it appears
7,900px down at 1440px. Above the fold the site reads as an anonymous data
platform.

**A-03 The homepage is 11.8 desktop screens and 23.4 phone screens, with nine
sections of near-identical weight.** No compression, no contrast, no pacing.
Sections 2 through 9 share one container, one rhythm, one border treatment and
one reveal. A reader has no signal about which of the nine matters.

**A-04 Governance language dominates the emotional register.** Counted on the
homepage: seven separate synthetic-data or pending-validation disclosures
(hero badge, hero panel, hero rule, domain card footer, evidence ledger lede,
lifecycle lede, footer panel), plus the same statement again on every route
through `PageHeader`. Each one is individually correct. Together they make an
accomplished project read as an apology.

### High

**B-01 The header's most prominent element is a locked page.** "Case Study
LOCKED" is the only bordered, filled, amber control in a header of otherwise
plain text links. Visual weight is inverted against value.

**B-02 Seven primary destinations of equal weight is a documentation table of
contents, not navigation.** Architecture, Data Model and Governance are three
peers competing for the same click, and Governance is the least likely first
destination of the three.

**B-03 Seven equally weighted counts weaken all seven.** The credibility strip
gives `3 dealerships` the same visual weight as `49 DAX measures`. The four
figures that actually establish engineering depth (28 views, 29 KPIs, 42
relationships, 49 measures) are diluted by three that do not.

**B-04 A console error is thrown on every homepage render, eight times.**
`<rect> attribute width: Expected length, "undefined"` from the scrollytelling
diagram's `motion.rect`, which animates `width` as a style property while it is
also declared as an attribute. Lighthouse `errors-in-console` scores 0.
_Source: `src/components/sections/pipeline-scrollytelling.tsx:396`._

**B-05 Six interactive cards fail WCAG 2.5.3 Label in Name.** The domain cards
carry `aria-label="Sales analytical domain"` while displaying "3 GOVERNED KPIS
/ Sales / SQL complete / ...". Voice-control users cannot activate them by
reading what they see. Lighthouse `label-content-name-mismatch` scores 0.
_Source: `src/components/sections/domain-cards.tsx`._

**B-06 23 bordered panels on one page.** Four consecutive card-dominated
sections (business problem, domains, lifecycle, author). The repetition reads as
modular assembly, not design.

**B-07 The hero shows two status badges, a disclaimer panel, a second
disclaimer rule, two buttons, a diagram and a three-item legend.** Nine
competing elements before the reader has decided to care.

**B-08 The homepage ships 230 kB of JavaScript** for a page whose motion is a
path draw and a width transition. The animation library is loaded to move eight
rectangles.

### Medium

**C-01 `/architecture` is 20.8 phone screens** and presents every node at once
with no focus mode.

**C-02 Grain is described in prose on `/data-model` rather than being the first
thing the eye lands on.** `GrainLabel` exists and is under-used.

**C-03 `/kpis` filters do not persist usefully and the result set reads as an
undifferentiated card wall.**

**C-04 `/governance` reads as policy prose.** Long paragraphs, few anchors.

**C-05 `/status` gives "static validation" and "real-engine validation" panels
of similar visual weight** in the four-way distinction grid, which is the exact
conflation the page exists to prevent.

**C-06 `/about` is a two-column wall.** Five long narrative blocks against a
sticky sidebar; the sidebar is the more readable half.

**C-07 The `/case-study` locked page is good but ends without a strong onward
path** relative to its length.

**C-08 The social preview does not depict the product.** It is a wordmark and a
line of text.

**C-09 Navigation prefetch costs every visitor 303 kB of JavaScript** to make
seven navigations instant on an eight-page document site.

### Low

**D-01 `Eyebrow` renders a decorative rule before every label**, which at nine
sections becomes a visual tic.

**D-02 Monospace is used for section eyebrows, count labels, legends, captions
and footer metadata**, well beyond technical identifiers.

**D-03 The 1px hover lift is applied to every card**, so a six-card grid
appears to breathe.

**D-04 `/ui-lab` is indexed in the sitemap generation path** even though it is
`noindex`. Harmless, but noise.

**D-05 The `drift` and `pulse-signal` ambient keyframes exist** with no
narrative role.

---

## 3. Decisions

Recorded here so a later reader can see what was chosen and what was rejected.

### 3.1 Information architecture

**Primary navigation: Overview, Platform, KPIs, Status, About, plus GitHub.**
Five content destinations, down from seven.

**Platform is Option B**, not A or C. `Platform` links directly to
`/architecture`, and `/architecture`, `/data-model` and `/governance` each render
a shared `PlatformNav` sub-navigation that links the three together with
`aria-current`.

- Option A, a disclosure menu in the header, was rejected: it adds a focus trap,
  an escape handler and a hover ambiguity to solve a problem two links solve.
- Option C, a new `/platform` overview route, was rejected: it would be a page
  whose only content is links to two better pages, and the brief says not to
  create it unless it substantially improves comprehension. It does not.

**Governance leaves the primary navigation** and is reachable from the platform
sub-navigation, `/status`, the footer and contextual links. It is a trust
document, not a first destination.

**Case Study leaves the header entirely.** It appears in the footer, on
`/status`, and in the homepage closing section. It stays visible and stays
locked; it stops being the loudest thing on the site.

### 3.2 Homepage: six chapters

| #   | Chapter                                          | Section mode       | Job                                                                   |
| --- | ------------------------------------------------ | ------------------ | --------------------------------------------------------------------- |
| 1   | Hero                                             | Cinematic          | What this is, who built it, two ways in                               |
| 2   | The dealership problem and the person solving it | Editorial          | Three question-to-decision chapters, and why Michael's answers differ |
| 3   | The ARPI Operating View                          | Product frame      | The signature moment: six domains as a product surface                |
| 4   | How the platform is built                        | Technical evidence | Five stages, generate to serve                                        |
| 5   | The engineering proof                            | Editorial numerals | Four counts, each linked to the file that proves it                   |
| 6   | Where to go next                                 | Closing            | Two actions, and the honest state                                     |

Removed from the homepage: the seven-count credibility strip (reduced to four
and merged into chapter 5), the eight-stage scrollytelling diagram (compressed
into chapter 4), the ten-row evidence ledger (moved to `/status`, summarised in
chapter 5's drawer), the eight-card lifecycle grid (moved to `/status`, one line
in chapter 6).

### 3.3 Hero

Headline leads with the differentiator. Two calls to action, one trust line, no
disclaimer panel, no status badges, no legend above the fold. The signature
visual is part of the first screen on desktop and begins within the first screen
on a phone.

### 3.4 Motion

The homepage drops the animation library entirely. Its signature motion is a
CSS-driven signal traversal in the hero SVG, which needs no JavaScript, cannot
block content, and is neutralised by the existing site-wide reduced-motion
block. `motion` remains only on `/architecture` and `/data-model`, where node
emphasis genuinely tracks state.

### 3.5 What was deliberately not changed

- The manifest generator and every count it produces.
- The case-study gate and its five conditions.
- Gate verdicts, lifecycle phase statuses, increment statuses.
- The synthetic-data statement text.
- Security headers, the Railway build context, the health-check path.
- The colour ramps. Two ground tokens were added; no hue was introduced.

---

## 4. Review pass 1: structural

Run against a production build of the redesign at seven viewports, with the
overflow check in `scripts/capture-review-screenshots.ts` on.

### 4.1 Measured page lengths, before and after

| Route           | 1440px before |     after | change | 375px before |      after | change |
| --------------- | ------------: | --------: | -----: | -----------: | ---------: | -----: |
| `/`             |        10,580 | **7,109** |   -33% |       19,710 | **12,612** |   -36% |
| `/status`       |        10,461 |    10,295 |    -2% |       17,343 |     17,271 |    -0% |
| `/architecture` |        10,631 |    10,543 |    -1% |       17,588 |     17,635 |    +0% |
| `/data-model`   |         7,823 |     7,736 |    -1% |       15,631 |     15,679 |    +0% |
| `/kpis`         |         7,223 |     7,062 |    -2% |       12,850 |     12,784 |    -1% |
| `/governance`   |         6,607 |     6,464 |    -2% |       10,760 |     10,683 |    -1% |
| `/about`        |         4,427 | **4,267** |    -4% |        7,681 |      7,614 |    -1% |
| `/case-study`   |         5,040 |     4,877 |    -3% |        8,410 |      8,322 |    -1% |

The home page is 7.9 desktop screens where it was 11.8, and 14.9 phone screens
where it was 23.4. The technical routes barely moved, which is correct: their
length is their content, and the redesign changed how that content is banded
rather than how much of it there is.

`/architecture` and `/data-model` are 47px and 48px TALLER on a phone. That is
the platform sub-navigation, and it is the cost of the navigation change rather
than an oversight: two routes gained a control so that five header items could
replace seven. It is recorded because a redesign that reports only the numbers
that moved its way is not reporting.

### 4.2 Findings

**S-01 Resolved: the first mobile screen.** At 390x844 the headline, the
supporting paragraph, both calls to action and the trust line now all sit above
the fold. Asserted by a browser test rather than by a screenshot, so it cannot
regress silently.

**S-02 Resolved: section differentiation.** Six chapters across four grounds,
alternating. No two adjacent sections on the home page share a ground.

**S-03 Resolved: card repetition.** Bordered panels on the home page: 23 before,
9 after, and no more than two consecutive card-dominated sections.

**S-04 Found and fixed during the pass: horizontal overflow.** The hero's first
mobile treatment let the landscape diagram bleed off the right edge, producing
85px of real horizontal scroll at 375px and 140px at 320px. Rebuilt as two
compositions with one accessible description outside both.

**S-05 Found and fixed: the source labels.** The landscape composition's inbound
curves were drawn straight through the six source labels. The sources are chips
now and the curves start at their right edge.

**S-06 Found and fixed: hero proportions.** The headline first sat inside a
five-column block beside the visual, which at 1440px gave a ten-word sentence a
460px measure: six lines of 76px type filling the left half. The headline now
spans the container and sets in two lines, and the visual has a seven-column
column worth having.

## 5. Review pass 2: visual craft

**C-01 Resolved: the signature visual is legible.** The first version used an
880-unit viewBox in a 760px column, putting every label at roughly 8px. Rebuilt
at 760 units so the scale sits near 1 and a 12-unit label renders at close to
12px.

**C-02 Resolved: the trust line reads as a line.** Three sentences separated by
word spaces wrapped into what looked like a list of fragments, four ragged rows
deep at 375px. Separators now lead their clause and do not wrap away from it, so
a line never ends on a lone dot.

**C-03 Resolved: eyebrow discipline.** The decorative rule is opt-in and belongs
to the two components that open a major block. An eyebrow inside a panel or a
card is a plain label.

**C-04 Resolved: the product frame reads as software.** One radius
(`--arpi-radius-frame`), one outer shadow and one chrome bar, none of which
appear anywhere else on the site.

**C-05 Accepted, not fixed: source-link path wrapping.** A long repository path
under a proof numeral can break mid-token, because `overflow-wrap: anywhere` is
what stops a 68-character identifier setting the page's minimum width. The
alternative is horizontal overflow at 320px. The break is untidy; the overflow
would be a WCAG 1.4.10 failure. Keeping the break is the right trade and is
recorded here rather than left to be rediscovered.

**C-06 Accepted: the wide section header at three items.** Heading, lede and
action across one row is tight on the platform story at 1280px. It holds, and
the alternative stacks the action under a full-width lede, which reads as a
second call to action rather than as a section control.

## 6. Review pass 3: visitor comprehension

Read as each of the eight visitors named in the brief, against the twenty
questions.

| #   | Question                                          | Verdict                                                                                         |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Can a visitor explain ARPI after five seconds?    | Yes. Headline names the domain and the differentiator; the eyebrow names the field.             |
| 2   | Is the dealership experience visible immediately? | Yes, in the h1, and asserted above the fold by test.                                            |
| 3   | Does it feel like a real product?                 | The Operating View is the moment that carries this.                                             |
| 4   | Does it feel honest?                              | Yes, and more so: one trust line per route reads as a statement, where seven read as anxiety.   |
| 5   | Does it feel unfinished?                          | No. The unfinished parts are stated as boundaries, at the end.                                  |
| 6   | Does status dominate?                             | No. Status is one nav item and one closing panel.                                               |
| 7   | Is the signature visual memorable?                | Yes. It is the only composition of its kind on the site.                                        |
| 8   | Too many cards?                                   | 9 on the home page, from 23.                                                                    |
| 9   | Too many borders?                                 | Grounds carry section boundaries; borders are reserved for data, controls, evidence and status. |
| 10  | Is the page too long?                             | 7.9 desktop screens for six chapters.                                                           |
| 11  | Any redundant section?                            | No. Two were deleted for duplicating `/status`.                                                 |
| 12  | Does mobile feel designed?                        | Yes. The portrait signature composition is the clearest evidence.                               |
| 13  | Does any motion distract?                         | No loop remains. Every animation runs a finite number of times.                                 |
| 14  | Is technical depth easy to reach?                 | Platform, then a sub-navigation linking all three.                                              |
| 15  | Does the home page earn continued scrolling?      | The hero ends on an action into the product surface.                                            |
| 16  | Does the final CTA have a purpose?                | Two concrete destinations, plus the locked case study.                                          |
| 17  | Would a hiring manager see the differentiator?    | It is the headline.                                                                             |
| 18  | Would an engineer trust the evidence?             | Every count links to the file that generates it.                                                |
| 19  | Does anything resemble a template?                | The product frame and the signature visual are both original to this project.                   |
| 20  | Does anything imply a completed case study?       | No. Asserted by the gate tests and the content-integrity suite.                                 |

**Keyboard-only visitor.** The Operating View is a real tab set with a roving
tabindex, arrow keys, Home and End, and wrap at both ends. The drawer traps
focus, returns it, and closes on Escape and on a scrim click.

**Reduced-motion visitor.** Every animation collapses to 1ms. The travelling
signal is removed rather than frozen, because a dash that does not travel is a
stray mark on a diagram; the paths it travels stay drawn, so the composition
still reads. Asserted by `tests/e2e/reduced-motion.spec.ts`, which compares the
rendered text of every route at both motion preferences word for word.

## 7. Results

### 7.1 Lighthouse, desktop preset, local production build

| Route           | Performance | Accessibility | Best practices | SEO |  LCP | CLS |
| --------------- | ----------: | ------------: | -------------: | --: | ---: | --: |
| `/`             |         100 |           100 |        **100** | 100 | 0.7s |   0 |
| `/architecture` |         100 |           100 |            100 | 100 | 0.7s |   0 |
| `/kpis`         |         100 |           100 |            100 | 100 | 0.7s |   0 |
| `/status`       |         100 |           100 |            100 | 100 | 0.6s |   0 |
| `/about`        |         100 |           100 |            100 | 100 | 0.6s |   0 |

Best practices on `/` was 96 at baseline. The four points were the console error
from the scrollytelling diagram's animated `width` (B-04); it now scores 100
with zero console errors and zero label-name mismatches.

### 7.2 Bundles, cold load, compressed

| Route           | JS before |     JS after |       change | HTML before |   after |
| --------------- | --------: | -----------: | -----------: | ----------: | ------: |
| `/`             |  230.3 kB | **187.6 kB** | **-42.7 kB** |     38.1 kB | 28.5 kB |
| `/data-model`   |  226.0 kB |     226.8 kB |      +0.8 kB |     21.9 kB | 22.2 kB |
| `/architecture` |  215.1 kB |     215.0 kB |      -0.1 kB |     23.9 kB | 24.2 kB |
| `/status`       |  166.1 kB |     160.8 kB |      -5.3 kB |     35.0 kB | 35.5 kB |
| `/about`        |  166.1 kB |     160.8 kB |      -5.3 kB |     21.2 kB | 21.4 kB |

The home page's saving is the animation library leaving it. The 5.3 kB off the
server-rendered routes is the shared chunk shrinking for the same reason.

### 7.3 Tests

| Suite                                                  | Result     |
| ------------------------------------------------------ | ---------- |
| Unit and component (vitest)                            | 375 passed |
| Browser, accessibility, content integrity (Playwright) | 211 passed |
| Baseline for comparison                                | 189 passed |

Twenty-two tests added. Five rewritten against the components that replaced the
ones they described; none deleted for being inconvenient.

### 7.4 Defects found by this work

| ID   | Defect                                                 | Found by                               |
| ---- | ------------------------------------------------------ | -------------------------------------- |
| B-04 | Console error, 8x per home-page render                 | Lighthouse baseline audit              |
| B-05 | Six cards failing WCAG 2.5.3 Label in Name             | Lighthouse baseline audit              |
| S-04 | 85px horizontal scroll at 375px                        | Overflow check during capture          |
| S-05 | Inbound curves drawn through source labels             | Visual review pass 1                   |
| S-06 | Six-line headline in a half-width column               | Visual review pass 1                   |
| R-01 | `/governance` missing the platform sub-navigation      | New navigation browser test            |
| R-02 | h2 to h4 heading skip in the Operating View            | Existing heading sweep, on new markup  |
| R-03 | Target-size check naming controls that no longer exist | Existing check, after the hero changed |

## 8. Remaining limitations

These are real and are not worked around.

**The live deployment was never reached.** This session's egress policy answers
`403` to `CONNECT arpi.up.railway.app:443`, recorded in the proxy's own failure
log. Every measurement in this document was taken against a production build of
the same commit served locally, which is the artefact Railway builds from the
same Dockerfile. The following remain unverified against the deployment and need
someone who can reach the host:

- Lighthouse against the live origin
- the remote Playwright suite (`playwright.remote.config.ts`)
- canonical metadata, `robots.txt` and `sitemap.xml` as served
- security headers as served
- the `/status` health check after deploy

Nothing about the change makes any of these likely to differ: the canonical
origin is resolved from `RAILWAY_PUBLIC_DOMAIN` by a pure function with full
test coverage, the security headers are set in `next.config.ts` and unchanged,
and the health-check path is unchanged.

**The social preview still depicts the wordmark rather than the product**
(finding C-08). The signature visual now exists to be drawn from; regenerating
`public/social-preview.svg` and its raster is a separate change.

**Navigation prefetch still costs every visitor the shared bundle** (finding
C-09). Unchanged by this work, and a deliberate trade recorded in
`portfolio/docs/PERFORMANCE.md`.

**`/architecture` is still 17,635px at 375px** (finding C-01). Its explorer was
not rewritten: it is accessible, keyboard-operable and covered by tests, and
rewriting it was a larger change than this redesign could carry safely. The
route summary and the platform sub-navigation improve its first screen; the
staged-disclosure work remains open.

---

# Part two: the floating-canvas visual direction

Sections 1 to 8 record the structural redesign, which shipped in #14 and #15.
That work decided what the site says, how many chapters it has, and what each
route is for. Everything in it is retained.

This part records a change to how it looks. The engineering, accessibility,
governance, testing and release requirements are unchanged, and none of the
truth controls moved.

## 9. Layout selection

### 9.1 What was built

Three complete compositions, all carrying identical content and identical truth
controls, differing only in composition, hierarchy and how much of the blue
field stays visible. They were built as `/proto/a`, `/proto/b` and `/proto/c`,
excluded from the sitemap, disallowed in `robots.txt` and marked
`noindex, nofollow`, and all three were deleted once the decision was made.

|       | Direction                    | Structure                                                                              |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------- |
| **A** | Floating Intelligence Canvas | One connected white canvas holding all six chapters                                    |
| **B** | Split Operating Gateway      | Editorial panel and product panel, vertically offset, then a wide panel                |
| **C** | Layered Data Pavilion        | Hero canvas, two smaller floating modules overlapping its lower edge, then a wide body |

### 9.2 What was measured

Every candidate was measured at eight viewports for three things that cannot be
judged from a screenshot: where the primary call to action lands, how long the
page is, and whether anything scrolls sideways.

**Primary call to action, distance from the top of the document (px):**

| Viewport   |   A |   B |   C |
| ---------- | --: | --: | --: |
| 1440 x 900 | 543 | 653 | 543 |
| 1280 x 800 | 534 | 632 | 534 |
| 1024 x 768 | 566 | 681 | 566 |
| 768 x 1024 | 450 | 418 | 450 |
| 430 x 932  | 516 | 500 | 516 |
| 390 x 844  | 579 | 563 | 579 |
| 375 x 812  | 607 | 591 | 607 |
| 320 x 700  | 670 | 674 | 670 |

All three put it inside the first screen at every viewport, and none scrolled
horizontally anywhere. That is the floor, not a differentiator: it is what the
direction requires, and a candidate failing it would have been discarded rather
than scored.

**Total page height (px):**

| Viewport   |          A |      B |          C |
| ---------- | ---------: | -----: | ---------: |
| 1440 x 900 |  **7,183** |  7,311 |     10,202 |
| 1280 x 800 |  **7,118** |  7,247 |     10,515 |
| 1024 x 768 |  **7,757** |  7,871 | **15,371** |
| 768 x 1024 |  **8,973** |  9,023 |      9,010 |
| 390 x 844  | **12,764** | 12,806 |     12,788 |
| 320 x 700  | **14,284** | 14,346 |     14,308 |

The 1024px column is the one that decided C. Its floating modules take effect at
the `lg` breakpoint, and a chapter written for a full-width canvas reflowed into
a five-column module makes the page **twice as long** as the same content in one
canvas. Two visible consequences at that width: the engineering-proof numeral,
which is the largest type on the site, wrapped and clipped; and the
domain-judgement section header set "The problem, and the difference" in four
stacked lines.

### 9.3 Scoring

1 to 10, higher is better.

| Criterion                   |       A |       B |       C |
| --------------------------- | ------: | ------: | ------: |
| Five-second comprehension   |       9 |       7 |       8 |
| Visual confidence           |       9 |       8 |       7 |
| Mobile usability            |       9 |       8 |       8 |
| Hero clarity                |       9 |       6 |       9 |
| Product visibility          |       8 |       6 |       8 |
| Michael's differentiation   |       9 |       8 |       7 |
| Technical credibility       |       9 |       8 |       7 |
| Content density             |       8 |       7 |       6 |
| Section hierarchy           |       9 |       8 |       6 |
| Navigation simplicity       |       9 |       9 |       9 |
| Accessibility               |       9 |       9 |       8 |
| Performance                 |       9 |       9 |       7 |
| Originality                 |       7 |       9 |       8 |
| Portfolio impact            |       8 |       9 |       7 |
| Resemblance without copying |       9 |       7 |       7 |
| **Total**                   | **130** | **118** | **112** |

### 9.4 Why A won

**B is the more striking screenshot and the worse page.** It scores highest on
originality and ties highest on portfolio impact, and if the decision were made
from one 1440px image it would win. Splitting the hero into two panels takes the
headline's measure from roughly 1,150px to roughly 520px, and a ten-word
sentence that sets in two balanced lines across the canvas sets in **five** in a
half-width panel. That is the same failure recorded in the hero's own source
comment from the previous pass, reintroduced by the composition. Its product
panel is also the smaller half of the split, so the signature visual - the one
element that shows this is a product rather than an essay - renders at roughly
60% of the size it gets in A, and its labels stop being readable at 1024px.

**C fails on a breakpoint rather than on taste.** The overlap reads well at
1440px. At 1024px it produces a 15,371px page, clipped display type and a
four-line section header. A layout whose worst viewport is the most common
laptop width is not a complete system.

**A is the direction the brief actually describes**: content contained primarily
inside one connected white canvas, with subtle internal divisions instead of
many separate cards. It is the shortest page at every viewport, it gives the
headline and the product visual each a column worth having, and it has no
breakpoint at which it degrades.

A's weakest score is originality, at 7, and that is accepted rather than
disputed: it is the closest structural reading of the reference, which is what
it was asked to be. The distinctiveness is carried by the background motif, the
serif display face and the product frame rather than by the panel arrangement.

### 9.5 What was not run on all three

The comparison ran on composition metrics and desktop and mobile screenshots.
Reduced motion, 200% zoom, axe and Lighthouse were **not** run against the two
losing candidates. All four are pass/fail conditions rather than
differentiators, all four are properties of the shared visual system rather than
of the arrangement, and all four are verified against the shipped design in
section 11. Running them three times would have measured the same system three
times.

## 10. The visual system

### 10.1 The blue field

A four-stop vertical gradient declared on `<html>`, not `<body>`, so it covers
the viewport when a document is shorter than one screen and when the page is
rubber-band scrolled past either end. `<body>` is transparent as a consequence,
which is why both build-staleness guards now probe the root element.

`background-attachment: fixed` is deliberately not used: on iOS it forces the
gradient into a separate composited layer repainted on every scroll frame, which
is one of the few ways a pure-CSS background can cost real performance.

The top stop is the only value that was tuned rather than taken from the brief.
At the suggested `#4FA9D3` the white canvas edge measured **2.64:1** against it,
which made the core visual idea of the design - a white panel clearly separated
from the field it floats on - the weakest boundary on the page. `#3C96C4`
measures 3.31:1 and still reads as a bright sky.

### 10.2 The geometric motif

One authored inline SVG, roughly 3 kB of markup, no request and no script. It
draws warehouse table outlines with a header bar and rows, hexagonal model
nodes, dashed relationship paths, column ticks and a pipeline trace that passes
behind the canvas. Two densities: the marginal detail group is hidden below the
`md` breakpoint, because at 375px the margins a desktop composition fills are
where the canvas already sits.

**It does not move.** The direction permits small geometry drift and it is not
taken. The element is `position: fixed`, so it is on screen on every route for
the whole visit; an animation there is not a moment, it is a permanent repaint
on every page the site has, which is the continuous CPU cost the same direction
rules out. There is therefore no reduced-motion variant, because there is no
motion to reduce.

### 10.3 Colour

Four of the brief's starting values failed WCAG 2.2 AA, and every one of them
failed in a way a screenshot does not show.

| Token       | Suggested |                      Measured | Shipped           |         Now |
| ----------- | --------- | ----------------------------: | ----------------- | ----------: |
| `ink-muted` | `#6E7A83` |               4.40:1 on white | `#5C6A74`         |      5.57:1 |
| `ink-faint` | `#87939B` |               3.15:1 on white | not used for text |         n/a |
| accent      | `#087FA4` | 4.58:1 pure / **4.37:1 soft** | `#0A6C8B`         | 5.95 / 5.67 |
| field top   | `#4FA9D3` |         2.64:1 vs canvas edge | `#3C96C4`         |      3.31:1 |

The accent is the one worth naming. It **passed on pure white and failed on the
next surface down**, which is why every text token is now asserted against all
four white grounds rather than against the lightest one. A colour is not
accessible on its own, only on a ground.

The slate ramp sits below 3:1 on white by design: it draws hairlines and the
motif, neither of which is text and neither of which identifies a control or its
state, so WCAG 1.4.11 does not apply. That distinction is only safe if enforced,
so a test asserts no `--color-ink-*` token binds to it.

Text on blue is confined to `field-deep` and below. White on the top gradient
stop measures 3.31:1 and the brief's secondary inverse measures 2.92:1, so the
bright end of the field carries no text at any size.

### 10.4 Typography

Two families plus the retained monospace. Source Serif 4 replaces Space Grotesk
as the display face: the direction permits one serif, one sans and one mono, and
a display sans beside a body sans is two sans families.

The committed file is not the one Google serves. The full latin subset carries
`wght` 200-900 and `opsz` 8-60 and weighs 122 kB, which is more than the other
two families together. Instanced with `opsz` pinned at 32 and `wght` clamped to
400-700 it is **36 kB**. Total shipped font weight moves from 101,976 to 115,688
bytes.

| File                                 |  Bytes | Preloaded |
| ------------------------------------ | -----: | --------- |
| `Inter-Variable-latin.woff2`         | 48,256 | yes       |
| `SourceSerif4-Variable-latin.woff2`  | 36,000 | yes       |
| `JetBrainsMono-Variable-latin.woff2` | 31,432 | no        |

### 10.5 The shell

**Header.** Solid white, 60px on a phone and 68px from `md` up, with a hairline
bottom border. The backdrop blur is removed: translucency over a blue field
makes the white header pale blue and scroll-dependent, which the direction rules
out as glassmorphism. The drawer scrim is now the deepest field blue rather than
the canvas, because on a light theme a white scrim is the same value as the
content it is meant to push back.

**Canvas.** One utility, `canvas-panel`, used by every route. `overflow: clip`
rather than `hidden`, because `hidden` establishes a scroll container and would
break the KPI catalogue's sticky filter row. The inset from the viewport edge is
a token, so the field is visible down both sides by the same amount on every
route: 12px at 320px, 40px on a desktop.

**Footer.** White and full-bleed. It and the header are the only two regions
that span the viewport edge to edge, and the footer is what closes the field.

**No inverted section tone.** A deep-blue closing panel was built and removed:
the page already ends the way the brief describes, with the canvas stopping at
its rounded corners, the field showing through the gap below it and the white
footer closing the field. A blue band inside the canvas put three surface
changes into the last 800px and made a field-coloured panel compete with the
field itself. The colour is still measured and recorded, so a future inverted
panel has a ground already known to work.

## 11. Quality

### 11.1 Tests

| Suite                                                  |         Result |
| ------------------------------------------------------ | -------------: |
| Unit and component (vitest)                            | **384 passed** |
| Browser, accessibility, content integrity (Playwright) | **212 passed** |

Four tests changed, and none was deleted for being inconvenient.

**The token contrast block** named the obsidian ramp, which no longer exists. It
now asserts every ink, accent, link and status colour against all four white
grounds, every inverse against the two blues that may carry text, and the canvas
edge against all four gradient stops. Two new tests enforce that the decorative
slate ramp is never bound to a text token.

**The reflow check** measured the field's decorative SVG. A
`preserveAspectRatio="slice"` drawing extends past the viewport at any aspect
ratio but its own, exactly as a `background-size: cover` image does. It now
skips `aria-hidden` subtrees - narrower than skipping SVGs, which would exempt
the two explorer diagrams, and narrower than skipping clipped containers, which
would exempt genuinely truncated content.

**The hero locator** was `main > section:first-of-type`, which the canvas
wrappers broke. It broke _silently_: the neighbouring "no status badges in the
hero" assertion passed by finding no elements at all. Both tests now use `#hero`
and assert it exists first.

**The header blur assertion is inverted, not removed.** Absence of a backdrop
filter is now the thing under test, because translucency is what a future change
would plausibly add back.

### 11.2 Defects found

| #    | Found by          | Defect                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-01 | browser console   | Hydration mismatch on **every** revealed element. `useState(() => typeof IntersectionObserver === 'undefined')` is true on the server and false on the client, so the server rendered `reveal-shown` and the client `reveal-hidden` - seventeen mismatches on the home page. Pre-existing, not introduced here. |
| V-02 | contrast script   | Four palette values below the AA floor, before any of them reached a page                                                                                                                                                                                                                                       |
| V-03 | Playwright        | The field motif read as horizontal overflow at seven viewports                                                                                                                                                                                                                                                  |
| V-04 | screenshot script | The same defect as V-03, in a second copy of the same detector that had drifted from the first                                                                                                                                                                                                                  |
| V-05 | bundle script     | Both staleness guards probed `<body>`, which the field made transparent                                                                                                                                                                                                                                         |
| V-06 | 1024px screenshot | Direction C clipped display type and quadrupled its own page length                                                                                                                                                                                                                                             |

V-01 is the one worth the space. It was invisible in every screenshot and every
test, the page looked correct, and the only symptom was that the class the
observer toggled was not the class on the element.

### 11.3 Lighthouse

Local production build, desktop preset, all eight routes.

| Route           | Perf | A11y | Best practices | SEO |  LCP | CLS |
| --------------- | ---: | ---: | -------------: | --: | ---: | --: |
| `/`             |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/architecture` |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/data-model`   |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/kpis`         |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/governance`   |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/status`       |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/about`        |  100 |  100 |            100 | 100 | 0.7s |   0 |
| `/case-study`   |  100 |  100 |            100 | 100 | 0.6s |   0 |

### 11.4 Accessibility

axe-core reports zero critical and zero serious violations across all nine
routes at desktop and mobile widths. No horizontal overflow at any of the seven
viewports, at 200% zoom, or under reduced motion.

### 11.5 Bundle

JavaScript is unchanged: the field is CSS and one inline SVG, and both new shell
components are server components.

| Route           |       JS |     CSS |    Fonts |    Total |
| --------------- | -------: | ------: | -------: | -------: |
| `/`             | 187.6 kB | 12.7 kB | 114.3 kB | 348.5 kB |
| `/architecture` | 215.0 kB | 12.7 kB | 114.3 kB | 369.0 kB |
| `/about`        | 160.8 kB | 12.7 kB | 114.3 kB | 312.0 kB |

## 12. Remaining limitations

**Live production verification is still blocked.** This session's egress policy
does not permit reaching `arpi.up.railway.app`, so every figure above is from a
production build of this commit served locally - the artefact Railway builds
from the same Dockerfile. Unverified against the deployment: Lighthouse on the
live origin, the remote Playwright suite, canonical metadata, `robots.txt`,
`sitemap.xml`, security headers as served, and the `/status` health check after
deploy.

**The social preview still depicts the wordmark** (finding C-08), and it is now
also the wrong palette: it was authored for the obsidian theme. Regenerating it
is a separate change. **Superseded by section 13.5.**

**`/architecture` is still the longest route on a phone** (finding C-01). The
canvas does not change that; its explorer was not rewritten.

**No visual-regression baselines are committed.** Unchanged decision, recorded
in `portfolio/docs/VISUAL_REVIEW.md`: the review set is captured to a gitignored
directory and attached to the pull request, because a baseline set nobody
re-approves becomes a rubber stamp.

---

## 13. The release pass: from documentation site to product

Everything above brought the site from nine repetitive sections to a coherent
document with a design system, a motion budget and a tested accessibility floor.
This section records the pass that came after it, whose problem was different and
whose finding fits in one sentence.

### 13.1 The finding

**Four working experiences were linked from the home page and none of them was
ever shown.** The inventory explorer, the architecture explorer, the data model
explorer and the KPI catalogue are the strongest artefacts in this repository. A
visitor arriving from LinkedIn met thirteen chapters of prose about software they
had to take on trust, and the first screen's dominant visual was an abstract
diagram of a pipeline rather than a piece of running software.

The secondary finding was density. Six of the thirteen chapters described the
same three rooftops in five different card layouts:

| Chapter | What it was         | What it was about                       |
| ------- | ------------------- | --------------------------------------- |
| 2       | `GroupIntroduction` | the three rooftops                      |
| 3       | `OperatingModels`   | the three rooftops, as three cards      |
| 4       | `GroupInventory`    | the three rooftops, as a snapshot       |
| 5       | `StoreCards`        | the three rooftops, as three more cards |
| 6       | `InventoryStrategy` | the three rooftops, as two long cards   |
| 7       | `StoreComparison`   | the three rooftops, as a table          |

A reader scrolled roughly four thousand pixels and met Granite Chevrolet five
times before there was anything to touch.

### 13.2 The decision: seven chapters, and state instead of repetition

| #   | Chapter                     | Component                        | Anchor            |
| --- | --------------------------- | -------------------------------- | ----------------- |
| 1   | Product hero                | `sections/hero.tsx`              | `#hero`           |
| 2   | Three-store operating model | `sections/store-story.tsx`       | `#stores`         |
| 3   | Interactive product tour    | `sections/product-tour.tsx`      | `#tour`           |
| 4   | Governed analytical domains | `sections/operating-view.tsx`    | `#operating-view` |
| 5   | Engineering evidence        | `sections/engineering-proof.tsx` | `#proof`          |
| 6   | Builder credibility         | `sections/builder.tsx`           | `#builder`        |
| 7   | Closing actions             | `sections/final-cta.tsx`         | `#review`         |

Chapters 2 to 7 of the old composition became one tab set plus one comparison
table. The tab set is the argument the section is making: these are three
different businesses, and reading them as three instances of one business is the
mistake the governed model exists to prevent. The table stayed a table, because
simultaneous comparison across eight columns is the one job a table does better
than a selection.

`PlatformStory` left the home page entirely: `/architecture` already renders the
same pipeline layer by layer, and a five-card summary of a page one click away is
the duplication this document exists to remove. `DomainJudgement` became chapter
six, compacted from nine editorial columns to three rows.

### 13.3 The hero is now a working product surface

`ProductShowcase` is a live client island over the real sanitized snapshot.
Selecting a store filters it, five derived figures change, four listings change,
and the link into the explorer changes with them. `LineageRail` states in four
nodes where those rows came from, so the demonstration and its provenance are on
the same screen.

Two costs were controlled rather than accepted:

- **Bundle.** The island receives a preformatted payload of roughly two dozen
  rows as props from `lib/product-preview`, which runs on the server. Importing
  `lib/inventory` into the island would have put all 541 records into the home
  page's JavaScript to display four rows.
- **Truth.** The surface shows counts, ranges and medians of advertised price,
  all derived, and an observation sentence about the SHAPE of a listing snapshot.
  It shows no sales figure, no gross figure, no turn rate and no trend, because a
  listing snapshot cannot support one.

`GovernedSignal` was not deleted. It is the composition the social card is drawn
from and remains the site's signature abstract.

### 13.4 The product tour, and the rule its media follows

Four steps, each with a dominant frame, one paragraph, one technical decision and
one way in. Every frame is a **straight capture of the route named on it**, taken
from a production build by `scripts/capture-product-media.ts` and committed to
`public/media/`. Nothing is composed, retouched, annotated or drawn.

The rule is absolute and it is the same rule as everywhere else in this project:
a mocked-up dashboard is indistinguishable to a reader from a real one, so the
site does not publish one. If it is in a frame, it is on the route, and the route
is one click away.

### 13.5 The social preview, regenerated

Finding C-08 is closed. `public/brand/social-preview.svg` now carries a wireframe
of the inventory application beside the four-layer pipeline diagram, plus the
synthetic-data panel and "Built by Michael Palmer". The interface panel contains
**no value of any kind**: its cells are neutral bars, which is the only honest way
to show an interface at 1200x630 without inventing the data inside it.

The home page's meta description changed with it. It used to open "Granite Auto
Group runs three dealerships..." - true on a page that declares the group
fictional six times, and misleading in a preview card read on its own. The word
"fictional" is now in the first clause, because a disclosure that only holds
inside its own page is not a disclosure.

### 13.6 What did not change

Every gate, every disclosure and every derived count. Gate 2 is closed, the case
study is locked, the semantic model is still reported as never evaluated by an
engine, and the four headline figures are still generated from the files that
prove them. The preview-versus-production rules in `lib/flags.ts` and
`lib/site-url.ts` were audited and left untouched; the audit is in
`TODAY_RELEASE_PLAN.md` section 4.

---

> **Later pass, not an edit to this record.** The two explorers' form controls,
> filter rails and inventory row banding were restyled after this document was
> written, so where it describes them it describes the build it reviewed rather
> than the current one. The vocabulary that replaced them is
> `src/components/ui/control.tsx`, documented in `DESIGN_SYSTEM.md` section 6.3.

---

## 14. The word-count pass: seven chapters to four

The next entry in this record, not a correction of it. Section 13 took the home
page from thirteen chapters to seven and put the working software on the first
screen. It did not count the words.

### 14.1 The measurement

Taken from the prerendered `/` of a production build, counting the visible text
of every `<p>` inside `<main>`, excluding `.sr-only`, `<figcaption>` and table
cells:

| Section                                 |    Before |   After |
| --------------------------------------- | --------: | ------: |
| Hero                                    |       104 |      92 |
| StoreStory, "One group, three business" |       375 |     170 |
| ProductTour                             |       111 |      67 |
| OperatingView                           |       156 |       0 |
| EngineeringProof                        |       125 |      20 |
| Builder                                 |       174 |       0 |
| FinalCta / closing                      |        83 |      75 |
| **Total**                               | **1,132** | **424** |
| Paragraphs                              |        61 |      30 |
| Top-level sections                      |         7 |       4 |

Counting the same paragraphs including the ones inside collapsed disclosures, the
page went from 1,652 words to 621, so the reduction is a reduction in text rather
than in what is on screen.

A product landing page runs 300 to 500 words. This one was roughly four times
that: an essay with four working experiences buried inside it.

### 14.2 Where each section went

**Nothing was softened and no disclosure was weakened.** Every sentence removed
from `/` either already existed on the route whose subject it is or moved there.

| Section          | Outcome                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Hero             | kept, trimmed. The supporting paragraph lost a clause and the author clause lost its technology list, which `/about` maps to files. |
| StoreStory       | kept: the tabs, the comparison table and both charts. The prose around them went from 375 words to 170.                             |
| ProductTour      | kept. The lede lost its second sentence and the section lost its closing paragraph, both of which repeated the first sentence.      |
| OperatingView    | **moved to `/kpis`**, above the catalogue it points into. Six domains with one definition each is reference material.               |
| EngineeringProof | **folded into the closing section** as a strip. Four numerals and the evidence drawer stay; 214 words of justification do not.      |
| Builder          | **moved to `/about`**. The three floor decisions are chapter four there; the rest was a second, shorter telling of that same page.  |
| FinalCta         | kept, trimmed, and it now opens with the proof numerals so the page ends on evidence and an action rather than on a paragraph.      |

The three disclaimers left `/` entirely:

- the 82-word sanitized-reference-data statement and the 55-word "descriptive
  evidence" boundary were **already published in full on `/governance`**, and the
  second is on `/inventory` as well, so the home page's copies were deleted
  rather than moved. Shipping the same sentence twice was the defect.
- the 72-word note on there being no request and no loading state **moved to
  `/architecture`**, where it sits beside the pipeline it describes. It is an
  engineering note about the platform, not a decision about the inventory
  surface.
- the 50-word paragraph on what an independent store's acquisition model implies
  was deleted from `/`, because `/dealerships/granite-pre-owned` already carries
  that store's positioning and its inventory strategy in its own words.
- the 47-word paragraph introducing Granite Auto Group as fictional was deleted
  from the store chapter. The fictional-group disclosure is one line in
  `TrustLine` in the hero and it is `/governance` at length.

`TrustLine` is unchanged. It is one line, it is on every route, its validation
clause is derived from the manifest, and it is the right amount of disclosure for
a page a stranger lands on.

### 14.3 The two new tests

A budget in a document is a suggestion. These are in
`tests/e2e/content-integrity.spec.ts`, in the same shape as the assertions
already there:

- **`renders at most 450 words of visible prose`** sums the visible text of every
  `<p>` in `<main>`, excluding `.sr-only`, `<figcaption>` and table cells, and
  fails with the actual count, the overage and the three longest paragraphs, so
  the next person to exceed it is told by how much and where.
- **`renders at most 4 top-level sections`** fails with the ids it found.

The distinction they encode is the one that made the palette on this site
trustworthy and the word count not: `tokens.test.ts` fails on a colour nobody
measured, and until now nothing failed on a page nobody counted.

### 14.4 The assertions that moved

No assertion was deleted to make a suite green. Every one whose content left `/`
was re-pointed at the route that now carries it:

| Assertion                                                          | From | To                                              |
| ------------------------------------------------------------------ | ---- | ----------------------------------------------- |
| four operating-view tests (tabs, panel change, no value, chrome)   | `/`  | `/kpis`                                         |
| two operating-view accessibility tests (click not hover, keyboard) | `/`  | `/kpis`                                         |
| "no engine has evaluated these measures"                           | `/`  | `/kpis`, as its own test                        |
| the "not a performance result" boundary is not behind a disclosure | `/`  | `/governance` and `/inventory`                  |
| the three floor decisions and their artefacts                      | `/`  | `/about`                                        |
| "the home page keeps its seven chapters"                           | `/`  | rewritten as four, plus `#proof` still present  |
| "the home page carries no long-form author section"                | `/`  | kept on `/`, now asserting `#builder` is absent |

### 14.5 What did not change

Every gate, every verdict, every count, every data contract and every route. Gate
2 is closed, the case study is locked, the semantic model is still reported as
never evaluated by an engine, and the four headline figures are still generated
from the files that prove them.
