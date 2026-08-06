# ARPI final release audit

**Branch:** `claude/arpi-final-release-hardening`
**Baseline commit:** `90bf876` — `main` plus the seven-chapter home page rebuild
**Date:** 6 August 2026

## 0. What this document is

A supplied audit was treated as a set of **hypotheses**, not as current truth. This
repository has already been through a substantial redesign, and an audit written against
an earlier build will describe defects that no longer exist and miss ones that do.

Every claim below was checked against four sources in this order, and the earliest one to
give a definite answer wins:

1. the current source on this branch,
2. the **rendered production build** (`npm run build` then `npx next start`), measured in
   Chromium at eight viewport widths,
3. the committed generated artefacts (`src/generated/`), and
4. the existing test suites.

Where the rendered build and the audit disagreed, the rendered build won. No
implementation decision below rests on an approximate word count quoted from the audit.

### A note on the baseline

`origin/main` is at `6e252e4`. This branch is cut from `90bf876`, which is `main` plus the
merge of pull request #35 (*Rebuild the home page as a product experience*). That pull
request is **closed and unmerged** on GitHub, but its work is what the release brief
describes as the current state — the seven chapters, the live hero surface, the product
tour, the store story and the real route captures exist only there.

Branching from `origin/main` would therefore have discarded everything this release is
supposed to harden. The base is stated here rather than assumed, and the pull request this
branch opens contains both bodies of work.

---

## 1. Verification matrix

| # | Audit claim | Current source evidence | Rendered result | Status | Required action |
|---|---|---|---|---|---|
| 1 | Home page is text-heavy with too many chapters | `src/app/page.tsx` composes exactly 7 sections | 7 `section[id]`: `hero`, `stores`, `tour`, `operating-view`, `proof`, `builder`, `review` | **Rejected** | none — do not expand or re-cut |
| 2 | Home page carries excessive default-visible prose | measured, not estimated | **2,601 visible words** in `<main>`; **1,931** of them in `<p>`/`<li>` prose | **Confirmed (partial)** | reduce visible prose; see §3 |
| 3 | Product-tour images are stock or mock-ups | `scripts/capture-product-media.ts` drives Chromium over `/inventory`, `/architecture`, `/data-model`, `/kpis` | four WebP files, 55–64 kB, one per route | **Rejected** | preserve and regenerate from the current build |
| 4 | No chart components exist | `src/components/visuals/inventory-charts.tsx` — server-rendered bar and stacked-mix charts, no charting dependency | five charts render across `/` and `/inventory` | **Rejected** | preserve; do not introduce Recharts or visx |
| 5 | Charts have no accessible table alternative | same file, lines 142 and 297 — each chart wraps a real `<table>` in `<details>` | `Read … as a table` present twice on `/`, three times on `/inventory` | **Rejected** | preserve |
| 6 | The hero is not product-first | `src/components/sections/hero.tsx` opens with `ProductShowcase` over real sanitized listings, with `LineageRail` beneath | store switcher filters live figures and rows above the fold | **Rejected** | preserve |
| 7 | **The inventory table clips content at narrow widths** | `inventory-table.tsx` used `min-w-[52rem]` inside `overflow-auto` | **320px: 8 of 10 columns outside the container, including Advertised price. 375/390px: 7. 768px: 3, price among them. 1024px: 2** | **Confirmed** | **implement — highest priority** |
| 8 | Page-level horizontal overflow exists | `overflow-x: clip` on body; `sr-only` redefined without `nowrap` | `scrollWidth - clientWidth` = **0** at all of 320/375/390/768/1024/1280/1440/1920 | **Rejected** | preserve; keep asserting |
| 9 | The architecture explorer only changes opacity | `architecture-explorer.tsx` animates `motion.g` on `opacity` alone; edges use a CSS opacity transition | selecting a node dims unrelated nodes; no direction, no flow | **Confirmed** | implement purposeful motion |
| 10 | The architecture explorer lacks keyboard access or reduced-motion handling | single-select listbox, roving selection, `usePrefersReducedMotion` already wired | arrow keys, Home/End, Escape all work; transitions collapse to `duration: 0` | **Rejected** | preserve the interaction model |
| 11 | The portrait is a placeholder | `builder.tsx` rendered `MediaPlaceholder`; no image file in `public/` | designed 4:5 slot, no photograph | **External** | scaffold a production-ready contract; do not fabricate an image |
| 12 | The social card is stale or overclaims | `public/brand/social-preview.svg` → `public/social-preview.png`, 1200×630 | names the product, the stack, "built by Michael Palmer", "Granite Auto Group is fictional"; **no KPI value of any kind** | **Rejected** | verify only; regenerate only if the source SVG changes |
| 13 | Railway environment behaviour is unsafe | `src/lib/flags.ts` — `resolveIsPreview` fails **closed**: anything that is not `production` is a preview | staging keeps `noindex` and the unpublished notice; nothing hard-codes `production` | **Rejected** | preserve; verify externally, see §5 |
| 14 | Gate 2 or the case study has drifted open | `src/generated/project-manifest.json` | `caseStudy.unlocked: false`, `gate2Open: false`, five blocking reasons recorded | **Rejected** | preserve; keep asserting |
| 15 | The semantic model is presented as validated | manifest `semanticModel.realEngineStatus: "pending-external"` | the explorer resolves that node to "Built, real-engine validation pending" | **Rejected** | preserve |
| 16 | The live deployment corresponds to current `main` | not inspectable from this environment | — | **External** | see §5 |

---

## 2. The confirmed defect, measured

The inventory table's natural content width is **1,028px**. It was rendered inside a
page-container scroll region and the region is narrower than that at every width below
about 1,200px:

| Viewport | Scroll region | Columns outside it |
|---|---|---|
| 320px | 254px | Year, Make, Model, Trim, Mileage, **Advertised price**, Stock reference, Snapshot |
| 375px | 309px | Make, Model, Trim, Mileage, **Advertised price**, Stock reference, Snapshot |
| 390px | 324px | Make, Model, Trim, Mileage, **Advertised price**, Stock reference, Snapshot |
| 768px | 668px | **Advertised price**, Stock reference, Snapshot |
| 1024px | 891px | Stock reference, Snapshot |
| 1440px | 1,214px | none |

The page never scrolled sideways, which is why every existing overflow assertion passed.
The failure was not overflow; it was that **the price of a car was 500px past the edge of
a phone screen with nothing on screen saying so**, and one test actively certified that
state as correct.

### What was done

Two presentations, one set of formatting rules, in
`src/components/dealerships/inventory-table.tsx`:

- **Below 1280px** — stacked result cards. `<article>` named by its own vehicle line,
  `<dl>`/`<dt>`/`<dd>` for every remaining field. Order is
  year-make-model → advertised price → condition → trim → mileage → store → stock
  reference → snapshot. **No field is dropped**; hierarchy changes, content does not.
- **1280px and above** — the full semantic table, unchanged, still inside its focusable
  named scroll region.

1280px rather than `md`: at 1024px the table still clipped two columns, so a `md`
breakpoint would have moved the defect rather than fixed it.

Both presentations format through one `presentRecord` helper, so there is no second source
of truth about what a null price says. They are `display: none` at each other's widths, so
assistive technology is never offered both readings of one listing.

### Measured after

| Viewport | Presentation | Fields readable | Columns clipped | Page overflow |
|---|---|---|---|---|
| 320 / 375 / 390 px | cards | all 10 | — | 0px |
| 768 / 1024 px | cards | all 10 | — | 0px |
| 1280 / 1440 / 1920 px | table | all 10 | **none** | 0px |

---

## 3. Visible prose

Measured from the rendered build at 1440px, counting text in `<p>` and `<li>` elements
that have layout boxes — so text inside a closed `<details>` is excluded, as is anything
`display: none`.

| | Words in `<main>` | Prose words |
|---|---|---|
| Baseline (`90bf876`) | 2,601 | 1,931 |
| After this branch | *recorded in §6* | *recorded in §6* |

The reduction target applies to **default-visible reasoning**, not to disclosure. Nothing
in the following list may be moved behind a control, because each qualifies the artefact
standing next to it:

- the fictional-entity notice for Granite Auto Group,
- the sanitized-public-reference-data statement,
- Gate 2 status and the case-study lock,
- the "listings are not sales, gross or turn" boundary,
- every `SourceLink` provenance path.

---

## 4. Deliberately preserved

Listed so a reviewer can see what was *not* rebuilt, and why:

- the seven-chapter composition and its section grounds,
- `ProductShowcase`, `LineageRail` and `ApplicationFrame` in the hero,
- `capture-product-media.ts` and its four real route captures,
- `inventory-charts.tsx` and its `<details>` table alternatives,
- the architecture explorer's listbox keyboard model and noninteractive fallback,
- the store comparison table — charts show shape, the table gives exact comparison,
- `flags.ts`, `site-url.ts` and the preview notice,
- the generated evidence manifest and every derived count.

---

## 5. External actions

These cannot be completed from a coding environment and are **not** claimed as done.

| Action | Who | Why it cannot be done here |
|---|---|---|
| Supply the approved portrait | Michael Palmer | No photograph exists in the repository. The contract is scaffolded; see `src/components/media/author-portrait.tsx`. |
| Confirm the Railway environment is named `production` | Michael Palmer | `resolveIsPreview` reads `RAILWAY_ENVIRONMENT_NAME` at run time. Any other name keeps the site `noindex` — correctly, but silently. |
| Confirm the production URL and canonical origin | Michael Palmer | Resolved from `RAILWAY_PUBLIC_DOMAIN` at run time. |
| Verify the live deployment matches this branch | Michael Palmer | The deployment is not reachable from here. |
| Run the documented deployment-evidence workflow | Michael Palmer | `scripts/record_deployment_evidence.py` must observe a real deployment. Evidence was **not** edited by hand. |
| Refresh the LinkedIn preview cache | Michael Palmer | Requires an authenticated LinkedIn session. |

---

## 6. Post-implementation record

*Completed at the end of the release; see the final section of this document.*
