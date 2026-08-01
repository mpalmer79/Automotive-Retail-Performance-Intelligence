# ARPI experience redesign, version 2

The record of the redesign that turned the ARPI website from a documentation
portal into a product experience. Baseline audit, decisions, three adversarial
review passes, and the outcome.

Nothing in this document may be used to justify a claim the repository cannot
prove. The redesign changed presentation. It changed no project status, no gate
verdict and no count.

---

## 1. Baseline

| | |
| --- | --- |
| Live URL | `https://arpi.up.railway.app` |
| `main` at audit | `04a7984f8fdb321f9ce2560577266fe21df9c86a` |
| Manifest commit | `ba3818e645b6e7b830cf046227e1b9f2e4bac6fc` |
| Framework | Next.js 16.2.12, App Router, all routes statically prerendered |
| Styling | Tailwind v4 with a closed token bridge, three local variable fonts |
| Animation | `motion` 12.43 on three routes, CSS reveal everywhere else |
| Deployment | Railway, Docker from the repository root, health check `/status` |

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

| Route | Purpose as built | In primary nav |
| --- | --- | --- |
| `/` | Nine sections of narrative | Yes |
| `/architecture` | Interactive pipeline explorer | Yes |
| `/data-model` | Entity and relationship explorer | Yes |
| `/kpis` | Filterable KPI catalogue | Yes |
| `/governance` | Trust framework and gates | Yes |
| `/status` | Lifecycle, increments, gates, evidence | Yes |
| `/about` | Author narrative | Yes |
| `/case-study` | Locked by Gate 2 | No, but a header control |
| `/ui-lab` | Internal design-system reference | No, `noindex` |
| `/not-found` | 404 | n/a |

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

| Motion | Where | Implementation |
| --- | --- | --- |
| Section reveal, fade and rise 16px | 6 routes, ~40 elements | CSS + IntersectionObserver |
| Staggered group reveal, 55ms | 5 groups | CSS transition delay |
| Count-up | 7 numbers on `/` | rAF |
| Hero path draw and node entrance | `/` | `motion` |
| Stage width transition | `/` scrollytelling | `motion` |
| Node emphasis | `/architecture`, `/data-model` | `motion` |
| Hover lift 1px, pointer gradient | interactive cards | CSS + rAF |

Every single one is a *decoration* except the hero path draw. Nothing in the
motion system explains the platform.

### 1.8 Measured page lengths

Full-page screenshot heights of the audited build.

| Route | 1440px | screens @900 | 375px | screens @844 |
| --- | ---: | ---: | ---: | ---: |
| `/` | 10,580 | **11.8** | 19,710 | **23.4** |
| `/architecture` | 10,631 | 11.8 | 17,588 | 20.8 |
| `/status` | 10,461 | 11.6 | 17,343 | 20.5 |
| `/data-model` | 7,823 | 8.7 | 15,631 | 18.5 |
| `/kpis` | 7,223 | 8.0 | 12,850 | 15.2 |
| `/governance` | 6,607 | 7.3 | 10,760 | 12.7 |
| `/case-study` | 5,040 | 5.6 | 8,410 | 10.0 |
| `/about` | 4,427 | 4.9 | 7,681 | 9.1 |

At 320px the homepage is 21,969px tall: **twenty-six phone screens**.

### 1.9 Bundle sizes, cold load, compressed

Route cost alone:

| Route | HTML | JS | CSS | Fonts | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 38.1 kB | 230.3 kB | 12.3 kB | 100.9 kB | 382.9 kB |
| `/data-model` | 21.9 kB | 226.0 kB | 12.3 kB | 100.9 kB | 362.4 kB |
| `/architecture` | 23.9 kB | 215.1 kB | 12.3 kB | 100.9 kB | 353.5 kB |
| `/kpis` | 14.9 kB | 186.5 kB | 12.3 kB | 100.9 kB | 315.9 kB |
| `/status` | 35.0 kB | 166.1 kB | 12.3 kB | 100.9 kB | 315.5 kB |
| `/governance` | 25.3 kB | 172.4 kB | 12.3 kB | 100.9 kB | 312.2 kB |
| `/case-study` | 23.8 kB | 166.1 kB | 12.3 kB | 100.9 kB | 304.3 kB |
| `/about` | 21.2 kB | 166.1 kB | 12.3 kB | 100.9 kB | 301.8 kB |

With navigation prefetch every route settles at 303.2 kB of JavaScript, because
the header prefetches all seven primary destinations.

### 1.10 Lighthouse, desktop preset, local production build of `/`

| Category | Score |
| --- | ---: |
| Performance | 100 |
| Accessibility | 100 |
| Best practices | 96 |
| SEO | 100 |

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
*Evidence: `home-375.png`, first viewport.*

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
*Source: `src/components/sections/pipeline-scrollytelling.tsx:396`.*

**B-05 Six interactive cards fail WCAG 2.5.3 Label in Name.** The domain cards
carry `aria-label="Sales analytical domain"` while displaying "3 GOVERNED KPIS
/ Sales / SQL complete / ...". Voice-control users cannot activate them by
reading what they see. Lighthouse `label-content-name-mismatch` scores 0.
*Source: `src/components/sections/domain-cards.tsx`.*

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

| # | Chapter | Section mode | Job |
| --- | --- | --- | --- |
| 1 | Hero | Cinematic | What this is, who built it, two ways in |
| 2 | The dealership problem and the person solving it | Editorial | Three question-to-decision chapters, and why Michael's answers differ |
| 3 | The ARPI Operating View | Product frame | The signature moment: six domains as a product surface |
| 4 | How the platform is built | Technical evidence | Five stages, generate to serve |
| 5 | The engineering proof | Editorial numerals | Four counts, each linked to the file that proves it |
| 6 | Where to go next | Closing | Two actions, and the honest state |

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

Recorded after the implementation reached a complete homepage and header.

## 5. Review pass 2: visual craft

## 6. Review pass 3: visitor comprehension

## 7. Results

## 8. Remaining limitations
