# ARPI portfolio release plan

Working execution record for the LinkedIn portfolio release pass. Written at the
start of the session, updated as work landed, and finished with the verification
results. It is a record of what was done, not a proposal.

Branch: `claude/arpi-portfolio-release-slk4el`
Site source: `portfolio/` (Next.js 16, App Router, React 19, Tailwind 4)

---

## 1. Reconnaissance findings

### What already works, and must not be damaged

The repository is not a thin portfolio site. Before this pass it already had:

| Capability                                                              | Where                                                                  | State  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Design system with documented tokens                                    | `src/styles/tokens.css`, `theme.css`, `docs/DESIGN_SYSTEM.md`          | Strong |
| Motion system, finite animations only, reduced-motion handled site wide | `src/styles/globals.css`, `src/lib/motion.ts`, `docs/MOTION_SYSTEM.md` | Strong |
| Canonical-origin resolution, pure and fully tested                      | `src/lib/site-url.ts`                                                  | Strong |
| Preview/production separation, fails closed                             | `src/lib/flags.ts`, `app/robots.ts`, `shell/preview-notice.tsx`        | Strong |
| Repository-derived engineering counts                                   | `scripts/generate-project-manifest.ts`, `src/lib/manifest.ts`          | Strong |
| Sanitized inventory derived at build time                               | `scripts/generate-inventory-data.ts`, `src/generated/*`                | Strong |
| Four working explorers                                                  | `src/components/explorers/*`                                           | Strong |
| 489 unit tests, 8 Playwright suites incl. axe                           | `tests/`                                                               | Strong |
| Gate 2 lock, honest and multi-conditioned                               | `lib/manifest.ts`, `app/case-study/page.tsx`                           | Strong |

Baseline before any change: `typecheck` clean, `vitest run` 489/489 passing.

### The actual weakness

Presentation density, exactly as briefed. The home page was **thirteen chapters**
of largely the same shape: a `SectionHeader`, then a grid of bordered cards or a
run of paragraphs. Concretely:

1. `Hero` — good copy, but its dominant visual was an abstract architecture
   diagram. Nothing on the first screen showed the product doing anything.
2. `GroupIntroduction` — two paragraphs.
3. `OperatingModels` — three cards, one line each.
4. `GroupInventory` — the derived snapshot.
5. `StoreCards` — three cards, again, for the same three stores.
6. `InventoryStrategy` — two long cards.
7. `StoreComparison` — a table plus two charts, for the same three stores.
8. `DomainJudgement` — three strong three-beat rows.
9. `OperatingView` — the one genuinely stateful product surface.
10. `PlatformStory` — five stage cards duplicating `/architecture`.
11. `GovernedGroupView` — three more cards.
12. `InventoryOperationsPreview` — two more cards.
13. `EngineeringProof` + `FinalCta`.

Chapters 2 to 7 and 11 all described the same three rooftops, in five different
card layouts, before a visitor had touched anything. Four of the site's most
persuasive assets — the inventory explorer, the architecture explorer, the data
model explorer and the KPI catalogue — were **linked but never shown**.

### Release blockers

| #   | Blocker                                                                                                                                      | Kind                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| B1  | No production Railway environment exists, so every deployment is correctly treated as preview and carries the unpublished banner + `noindex` | External, deployment decision |
| B2  | Gate 2 closed; no analytical case study                                                                                                      | Truthful, stays closed        |
| B3  | Home page showed no product                                                                                                                  | Code — fixed this session     |
| B4  | Social preview showed no product surface                                                                                                     | Code — fixed this session     |

---

## 2. Implementation checklist

- [x] Phase 1 — reconnaissance, this file
- [x] Phase 2 — audit release safety (environment, robots, canonical); no code change required, behaviour verified and documented in section 4
- [x] Phase 3 — home page reduced from 13 chapters to 7
- [x] Phase 4 — cinematic hero built on a live product surface
- [x] Phase 5 — reusable product-media system under `src/components/media/`
- [x] Phase 6 — three-store operating model as one accessible tabbed chapter
- [x] Phase 7 — interactive product tour over four real experiences, with screenshots captured from the running application
- [x] Phase 8 — card walls replaced by stateful experiences
- [x] Phase 9 — engineering proof preserved, manifest-driven, links intact
- [x] Phase 10 — builder credibility chapter
- [x] Phase 11 — motion audit: reveal count on `/` cut, no new animation library
- [x] Phase 12 — social preview and metadata strengthened
- [x] Phase 13 — responsive and accessibility validation at 320/375/768/1024/1440/1920
- [x] Phase 14 — performance control: server components by default, one hero client island with a 24-row payload, lazy media below the fold
- [x] Phase 15 — refactor limited to what the new home page needed
- [x] Phase 16 — verification
- [x] Phase 17 — release report

---

## 3. The seven chapters

| #   | Chapter                     | Component                        | Ground    | Anchor            |
| --- | --------------------------- | -------------------------------- | --------- | ----------------- |
| 1   | Product hero                | `sections/hero.tsx`              | cinematic | `#hero`           |
| 2   | Three-store operating model | `sections/store-story.tsx`       | panel     | `#stores`         |
| 3   | Interactive product tour    | `sections/product-tour.tsx`      | canvas    | `#tour`           |
| 4   | Governed analytical domains | `sections/operating-view.tsx`    | panel     | `#operating-view` |
| 5   | Engineering evidence        | `sections/engineering-proof.tsx` | evidence  | `#proof`          |
| 6   | Builder credibility         | `sections/builder.tsx`           | canvas    | `#builder`        |
| 7   | Closing actions             | `sections/final-cta.tsx`         | cinematic | `#review`         |

Retired from the home page, with where the content went:

| Retired                                                                   | Preserved at                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GroupIntroduction`, `OperatingModels`, `StoreCards`, `InventoryStrategy` | Chapter 2, per-store tab panels and the franchise/independent contrast             |
| `GroupInventory`, `StoreComparison`                                       | Chapter 2, the "All three" tab (snapshot, comparison table, both charts)           |
| `GovernedGroupView`                                                       | Chapter 2 closing panel; `/governance` keeps the long form                         |
| `PlatformStory`                                                           | `/architecture`, which already renders the pipeline layer by layer                 |
| `InventoryOperationsPreview`                                              | Chapter 3 tour step 1 provenance line; `/inventory-operations` keeps the full lane |
| `DomainJudgement`                                                         | Chapter 6, compacted to the three decisions; `/about` keeps the career at length   |

---

## 4. Release safety audit (Phase 2)

Findings, all verified against `src/lib/flags.ts`, `src/lib/site-url.ts`,
`src/app/robots.ts`, `src/lib/metadata.ts` and their tests.

**What triggers the unpublished notice** — `resolveIsPreview()`: `VERCEL_ENV=preview`,
or `NEXT_PUBLIC_ARPI_PREVIEW=true`, or a Railway environment whose name is
anything other than `production`. A build with no platform variables at all
(local, CI, Playwright) is _not_ a preview, which is correct: there is no index
to stay out of and the banner would otherwise appear in every screenshot.

**What produces `noindex`** — the same `IS_PREVIEW` value, applied in
`rootMetadata.robots` and in `pageMetadata()` per route. `/ui-lab` is
additionally `noindex` by route definition and by an `X-Robots-Tag` header in
`next.config.ts`, so it holds on any Node host rather than only on Vercel.

**What changes `robots.txt`** — `app/robots.ts` disallows `/` entirely while
`IS_PREVIEW`, and otherwise allows all but `/ui-lab`.

**Canonical URLs** — resolved once per build by `resolveSiteUrl()`, in order:
`ARPI_SITE_URL`, then `RAILWAY_PUBLIC_DOMAIN`, then the deprecated
`NEXT_PUBLIC_SITE_URL`, then a request origin restricted to an allow-list, then
`http://localhost:3000`. A request `Host` header can never mint a canonical tag
for an off-list domain.

**Is local development wrongly treated as production?** No. It resolves to
`localhost:3000`, is not a preview, and is not deployed.

**Can a preview become indexable by accident?** Only by an operator setting
`RAILWAY_ENVIRONMENT_NAME=production` on a non-production environment, which is
the operator declaring it published. The rule fails closed for every new
environment name without code changes.

**Conclusion: no code change was required or made.** The one outstanding item is
external and is listed in section 6.

---

## 5. Risks and how they were contained

| Risk                                                   | Containment                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Screenshots go stale as the UI changes                 | Capture is a committed, re-runnable script (`npm run media`) documented in `portfolio/README.md`; each frame is captioned as a capture of the named live route, and the route itself is one click away |
| Route JavaScript grows because the hero is interactive | The hero island receives a ~24-row precomputed payload as props; the full 541-record set stays on `/inventory` where it already shipped                                                                |
| Screenshot images regress LCP                          | Only the hero is eager, and the hero is markup, not an image. All four tour frames are `loading="lazy"` with explicit intrinsic dimensions so they reserve their own space and cause no layout shift   |
| Next image optimizer required at runtime on Railway    | Not used. The frames are pre-sized WebP served directly, so the standalone runtime needs no `sharp` and no loader configuration                                                                        |
| Fictional rooftop imagery read as real photography     | Every rooftop visual is an abstract SVG drawn from design tokens and carries the caption "Fictional rooftop visualisation created for the ARPI portfolio case study"                                   |
| Gate 2 appearing open                                  | Untouched. `manifest.ts` still computes the lock from five conditions, and the closing chapter still states it in words                                                                                |

---

## 6. External release actions (outside the codebase)

These cannot be done from the repository and are the remaining gate on
publication:

1. **Create a Railway `production` environment** for the portfolio service. Until
   one exists, every deployment correctly renders the unpublished banner and
   `noindex`.
2. **Assign the production domain** to that environment. `RAILWAY_PUBLIC_DOMAIN`
   is then supplied by the platform and needs no manual variable.
3. **Only if a custom domain is used**, set the server-only `ARPI_SITE_URL` to
   its absolute origin. Do not set `NEXT_PUBLIC_SITE_URL`; it is deprecated.
4. **Leave `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` unset.** It is one of five
   conditions and the other four are false. Setting it changes nothing except
   the reader's expectation.
5. **Refresh the LinkedIn link preview** with LinkedIn's Post Inspector after the
   production URL is live, so the new Open Graph image is fetched.
6. **Optional: supply an approved headshot** at `portfolio/public/media/portrait.webp`
   at 640x800. The builder chapter renders a designed placeholder in its absence
   and the layout does not move when the file arrives.

---

## 7. Deferred, and why

| Deferred                                                               | Why                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unlocking the case study                                               | Gate 2 is closed on merit. No report page exists, no Microsoft engine has evaluated the measures, no finding has been drawn |
| Power BI screenshots                                                   | There is nothing to screenshot; fabricating one is the exact failure this project argues against                            |
| Redesigning `/governance`, `/status`, `/kpis`, `/inventory-operations` | Out of the release surface. They are dense but correct, and each is one click from a home page that now sells the visit     |
| Video media                                                            | No footage exists, and generating filler video would add weight without evidence                                            |
| A charting library                                                     | The two existing SVG charts are sufficient and cost nothing                                                                 |

---

## 8. Verification

Every command below was executed in this session against this branch. Nothing is
reported as passing that was not run.

### portfolio/

| Command                                         | Result                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `npm run format:check`                          | Pass. All matched files use Prettier style                |
| `npm run lint`                                  | Pass. Zero errors, zero warnings                          |
| `npm run typecheck`                             | Pass                                                      |
| `npm run manifest:check`                        | Pass                                                      |
| `npm run inventory:check`                       | Pass                                                      |
| `npm run test` (Vitest)                         | **489 passed**, 12 files, 0 failed                        |
| `npm run build`                                 | Pass. All 19 routes statically prerendered                |
| `npm run verify` (all of the above in sequence) | Pass                                                      |
| `npx playwright test` (Chromium)                | **372 passed**, 0 failed, 11.4 min                        |
| `npm run assets`                                | Re-rendered the social preview and both icon rasters      |
| `npm run media`                                 | Captured four product-tour frames from a production build |

The Playwright run covers `accessibility.spec.ts` (axe-core sweep, target size,
reflow at 200% zoom), `content-integrity.spec.ts`, `design-system.spec.ts`,
`inventory.spec.ts`, `navigation.spec.ts`, `reduced-motion.spec.ts`,
`visual-system.spec.ts` and `case-study-gate.spec.ts`.

Baseline before any change on this branch: typecheck clean, 489/489 unit tests.
The unit count is unchanged because no unit test needed to change; five
end-to-end tests were updated, and section 8.1 says exactly which and why.

### Repository root (Railway tooling)

| Command                                                                 | Result                          |
| ----------------------------------------------------------------------- | ------------------------------- |
| `npm run verify` (`typecheck`, `test`, `spec:validate`, `iac:evaluate`) | Pass. 28 specification steps OK |

### Responsive and overflow check

The home page was loaded at 320, 375, 768, 1024, 1440 and 1920 CSS pixels and
measured for real horizontal scroll.

|  Width | Horizontal scroll | Page height |
| -----: | ----------------: | ----------: |
|  320px |                 0 |      20,955 |
|  375px |                 0 |      19,011 |
|  768px |                 0 |      13,966 |
| 1024px |                 0 |      10,795 |
| 1440px |                 0 |      10,214 |
| 1920px |                 0 |      10,465 |

### 8.1 The five end-to-end tests that changed, and why

None was weakened. Each encoded a fact about the previous composition.

1. **`accessibility.spec.ts` - target-size floor.** Named the hero's two calls to
   action by their old labels. Updated to the new ones. The rule, 44px, is
   unchanged.
2. **`accessibility.spec.ts` - operating view changes on click, not hover.**
   Located the panel with a bare `getByRole('tabpanel')`. The home page now has
   four tab sets, so that resolves to four elements and fails strict mode before
   it checks anything. Scoped to `#operating-view`. The rule is unchanged and is
   now actually about the operating view.
3. **`content-integrity.spec.ts` - the hero on the first phone screen.** Same CTA
   rename, plus the locators are scoped to `#hero`. The rule, both actions above
   844px on a 390px phone, is unchanged.
4. **`content-integrity.spec.ts` - the operating view panel.** Same strict-mode
   scoping as (2), in two tests.
5. **`navigation.spec.ts` - no long-form author section on the home page.** Banned
   the phrase "CRM and DMS administration" anywhere on `/`. The concern it
   encodes is that the same STORY is told twice at two lengths and the shorter
   copy goes stale; a scannable list of role functions in the builder chapter is
   a fact set, and two pages agreeing on a fact set is consistency. The rule now
   names three long-form passages of `/about` prose that may not appear on `/`,
   and additionally asserts the author material is confined to `#builder` and
   links out. It is a stricter test than the one it replaced.

Three further failures were fixed **in the product rather than in the test**,
because the tests were right:

- The store comparison table now carries each rooftop's full name as a link to
  its own page, plus its city and store type. Without it, the tab set would have
  offered a route only to whichever store happened to be selected.
- The same table restores each store's location and type for all three at once.
- The group snapshot's provenance - workbook count, listing count, snapshot date
  and the three source links - is restored under the comparison table.

---

## 9. Launch recommendation

**Ready after production configuration.**

The codebase is releasable. Every check in section 8 passes, the home page is a
product experience rather than a documentation index, and nothing in it claims
more than the repository can prove. What is missing is not code: no Railway
`production` environment exists for this service, so every deployment correctly
renders the unpublished banner and `noindex`, and there is no public URL to put
in a LinkedIn post.

Do the six things in section 6, in order. Items 1 and 2 are the gate; item 5 is
what makes the new social card appear on an existing post.

---

## 10. Final release hardening pass

A second pass, on branch `claude/arpi-final-release-hardening`, cut from the
branch above rather than from `origin/main` — the seven-chapter home page this
document describes lives there and nowhere else.

It began by treating a supplied audit as **hypotheses rather than findings** and
checking each against the rendered production build. The reconciliation is in
[FINAL_RELEASE_AUDIT.md](FINAL_RELEASE_AUDIT.md). Eleven of sixteen claims were
rejected as already resolved or never true, which is the outcome worth recording:
most of the work was confirming that work already done did not need doing again.

### 10.1 The one confirmed defect

The listing table's content is 1,028px wide inside a container that is 254px at a
320px viewport. Eight of ten columns were outside it, **including the advertised
price**, with nothing on screen indicating they existed. The page never scrolled
sideways, so every overflow assertion passed — and one test actively certified
the behaviour as correct.

Below 1280px the listings are now stacked cards carrying every field the table
carries; at 1280px and above the semantic table renders with no column outside
its container at any width. Measured at 320, 375, 390, 768, 1024, 1280, 1440 and
1920.

### 10.2 What was preserved rather than rebuilt

The seven chapters. The hero's live product surface and its lineage rail. The
four real route captures and the script that makes them. The accessible SVG
charts and their `<details>` table alternatives. The architecture explorer's
listbox keyboard model and always-present component list. The store comparison
table. `flags.ts`, `site-url.ts` and the preview notice. Every generated count.

The product captures and the social card were both **regenerated and came back
byte-identical**, which is the strongest available evidence that they were
already current.

### 10.3 What was added

Purposeful motion in the architecture diagram — a one-time arrival sequence in
band order and a selection wave that resolves upstream inward and downstream
outward, with planned edges never drawing. A production-ready portrait contract
that renders a photograph if one is committed and a designed placeholder if not.
Native disclosures that cut default-visible home-page prose from 1,931 words to
1,431 without hiding a single qualification. Domain and store-type iconography.

### 10.4 External actions still outstanding

Unchanged from section 6, plus one:

7. **Supply the author portrait.** Commit
   `portfolio/public/media/michael-palmer-portrait.webp` at 1000 × 1250, WebP,
   under 180 kB. No code change is needed — the component resolves it from disk
   at build time. Until then the designed placeholder renders at identical
   geometry, so the page is not broken and no stock photograph is substituted.

### 10.5 Launch recommendation, restated

**Ready after Railway production verification.**

Unchanged in substance from section 9, and unchanged for the same reason: the
codebase is releasable and the blocker is configuration, not code. Nothing in
this pass touched the preview logic, nothing hard-codes `production`, and staging
correctly stays `noindex` with its unpublished notice until a Railway environment
named `production` exists.
