# ARPI portfolio website

The public-facing website for **Automotive Retail Performance Intelligence** (ARPI).

This is a documentation site. It explains an analytics platform; it is not one. It
holds no database connection, no API route, no authentication, no user state and no
analytics runtime. Every number it displays is generated at build time from files in
this repository, and the site cannot display a number the repository cannot prove.

Its scope boundary is recorded in
[ADR-0009](../docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md),
which permits this website, prohibits the public analytical case study until Gate 2
opens, leaves the Power BI work untouched, and permanently prohibits building a second
analytics application here.

---

## 1. The one thing to understand first

**The site does not author claims. It renders evidence.**

Every count, status, gate verdict and validation result on the site comes from one
generated file — `src/generated/project-manifest.json` — which is built by
[`scripts/generate-project-manifest.ts`](scripts/generate-project-manifest.ts) by
reading the repository's own evidence: the TMDL semantic model, the validation JSON
under `powerbi/validation/`, `KPI_CATALOG.md`, the SQL tree, and the readiness
documents under `docs/requirements/`.

The generator refuses to emit a manifest whose statuses contradict their evidence. The
assertion it exists to enforce, quoted from the generator itself:

> Lifecycle Phase 5 is emitted as complete while both real-engine validation paths are
> pending. This is the single claim this project must never make.

`npm run manifest:check` regenerates the manifest and fails if it differs from the
committed one. It runs in `prebuild`, so a stale manifest cannot be built, and it runs
as its own CI step, so a change to an evidence file that would make the site say
something different fails the pipeline rather than shipping.

The full contract is in [docs/CONTENT_MODEL.md](docs/CONTENT_MODEL.md).

---

## 2. What is true today

These come from the committed manifest, not from prose:

|                                          |                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Gate 1 — Power BI development may begin  | **OPEN** (2026-07-29)                                                    |
| Gate 2 — the public case study may begin | **CLOSED**, 0 of 3 conditions met                                        |
| Real-engine semantic-model validation    | **Pending external** on both accepted paths                              |
| Lifecycle Phase 5 (semantic model)       | **In progress** — built and statically validated, never engine-validated |
| Power BI report pages                    | **0**                                                                    |
| Public case study                        | **Locked** — 5 blocking reasons                                          |

Both real-engine paths accepted by
[ADR-0008](../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) —
Power BI Desktop and Microsoft Fabric Service — are pending. The site says so on every route that touches the semantic model,
and no route claims otherwise.

---

## 3. Quick start

```bash
cd portfolio
npm ci
npm run dev            # generates the manifest, then starts on :3000
```

Node 20.11 or newer. No environment variable is required for local development.

Before opening a pull request:

```bash
npm run verify         # format, lint, types, manifest, unit tests, production build
npm run test:e2e       # accessibility, navigation, content integrity, design system
```

Both are what CI runs, in the same order, so a green local run predicts a green CI run.

---

## 4. Commands

| Command                           | What it does                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                     | Regenerate the manifest, then start the dev server                          |
| `npm run build`                   | Production build; `prebuild` runs `manifest:check` first                    |
| `npm run start`                   | Serve the production build                                                  |
| `npm run manifest`                | Regenerate `src/generated/project-manifest.json` from evidence              |
| `npm run manifest:check`          | Fail if the committed manifest is stale or self-contradictory               |
| `npm run lint`                    | ESLint (flat config, `eslint-config-next`)                                  |
| `npm run typecheck`               | `tsc --noEmit`                                                              |
| `npm run format` / `format:check` | Prettier                                                                    |
| `npm run test`                    | Vitest — unit, component and content-integrity suites                       |
| `npm run test:e2e`                | Playwright — Chromium by default                                            |
| `npm run test:e2e:a11y`           | The axe-core sweep alone                                                    |
| `npm run verify`                  | Everything in the `quality` CI job                                          |
| `npm run assets`                  | Re-render the raster favicon and social-preview PNGs from their SVG sources |
| `npm run review:screenshots`      | Capture the adversarial visual-review set (needs a running server)          |
| `npm run bundle`                  | Per-route transferred-bytes report (needs a running server)                 |

`ARPI_E2E_ALL_BROWSERS=true` adds Firefox and WebKit to the Playwright run. The reason
they are not on by default is in
[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) section 7.

---

## 5. Routes

Eight indexable routes, plus one that is not.

| Route           | What it is for                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `/`             | The argument: the business problem, the pipeline, the six domains, the evidence ledger               |
| `/architecture` | Interactive explorer of the pipeline, from seeded generation to the semantic model                   |
| `/data-model`   | The 8 conformed dimensions and 5 facts, with declared grains, keys, history policy and privacy class |
| `/kpis`         | All 29 governed KPIs and 5 deferred ones, searchable and filterable                                  |
| `/governance`   | Synthetic-only data, no PII by construction, lineage, reconciliation, scope gates                    |
| `/status`       | Every lifecycle phase, delivery increment, gate and engine path, from the manifest                   |
| `/about`        | The author, and why this project needs someone who has worked a dealership floor                     |
| `/case-study`   | The gated case study. Currently renders a locked state and its blocking reasons                      |
| `/ui-lab`       | Internal design-system reference. `noindex`, disallowed in `robots.txt`, not in navigation           |

Route metadata — titles, descriptions, indexability, sitemap priority — is declared once
in [`src/lib/site.ts`](src/lib/site.ts) and consumed by the navigation, the sitemap, the
breadcrumbs and the accessibility sweep, so none of the four can drift from the others.

---

## 6. Layout

```
portfolio/
├─ scripts/
│  ├─ generate-project-manifest.ts   the evidence backbone; see §1
│  ├─ report-bundle.ts               per-route transfer, measured in a real browser
│  ├─ capture-review-screenshots.ts  the visual-review matrix
│  ├─ render-raster-assets.ts        SVG → PNG for the favicon and social preview
│  └─ chromium.ts                    locate the installed Chromium
├─ src/
│  ├─ app/                    one directory per route, plus sitemap, robots, manifest
│  ├─ components/
│  │  ├─ brand/               monogram and wordmark
│  │  ├─ explorers/           architecture, data model, KPI catalogue
│  │  ├─ motion/              CSS reveal, motion boundary, animated count, pipeline hero
│  │  ├─ sections/            the composed page sections
│  │  ├─ shell/               header and footer
│  │  └─ ui/                  the primitives: layout, typography, button, badge, card, data
│  ├─ content/                hand-authored structured content (KPIs, entities, nodes)
│  ├─ fonts/                  three committed woff2 latin subsets
│  ├─ generated/              project-manifest.json — never edited by hand
│  ├─ lib/                    tokens-adjacent code: site, manifest, motion, metadata, hooks
│  ├─ styles/                 tokens.css → theme.css → globals.css
│  └─ types/                  the manifest and content type contracts
├─ tests/
│  ├─ unit/                   Vitest: tokens, site, motion, content integrity, components
│  └─ e2e/                    Playwright: a11y, navigation, content integrity, design system
├─ public/                    favicon, brand SVGs, social preview
└─ docs/                      the seven documents listed below
```

---

## 7. Documentation

| Document                                  | What it settles                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | The closed palette, the token contract, the type scale, the component inventory, and why Radix was removed                            |
| [MOTION_SYSTEM.md](docs/MOTION_SYSTEM.md) | Duration, easing, distance and stagger scales; the reduced-motion substitution table; why the reveal is CSS                           |
| [CONTENT_MODEL.md](docs/CONTENT_MODEL.md) | The manifest-as-single-source contract, and the five-condition case-study gate                                                        |
| [ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | The WCAG 2.2 AA position, the axe results, the keyboard model, the viewport matrix                                                    |
| [PERFORMANCE.md](docs/PERFORMANCE.md)     | Measured per-route transfer, the font budget, and the prefetch trade                                                                  |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)       | Railway configuration, why the staging deployment needs **no** variable typed by a person, unpublished-deployment behaviour, rollback |
| [VISUAL_REVIEW.md](docs/VISUAL_REVIEW.md) | The adversarial review record: what was asked, what was found, what was fixed                                                         |

---

## 8. Constraints this codebase holds itself to

Stated here because they are easier to keep than to restore.

**Data honesty**

- Every dataset in ARPI is synthetic. Granite State Auto Group and its three stores are
  fictional. The disclosure appears on every primary route, and a Playwright test
  asserts it — so it cannot quietly become a footer-only statement.
- No route displays a customer-level detail, real or fictional.
- No illustrative number is presented as a dealership result.
- No analytical finding appears anywhere on the site. None has been drawn.

**Scope**

- No Power BI dashboard development happens in this directory.
- No second analytics application. No database, no API route, no ETL.
- The case study stays locked until all five gate conditions hold. The build flag is
  necessary and never sufficient.

**Technology**

- No global state library, no CMS, no authentication, no contact-form backend.
- No third-party tracker, advertising script, chatbot or AI feature. The site makes no
  network request to any origin other than the one serving it.
- One animation library, used on three routes. One icon library. No charting library —
  the diagrams are hand-authored SVG.
- The palette is closed: `@theme` resets Tailwind's default colour ramps to `initial`,
  so an accidental `bg-slate-700` does not compile.

**Secrets**

- The workflow that tests this directory has no `secrets.*` reference and runs to
  completion on a fork with zero secrets configured.
- **The Railway staging deployment requires no environment variable typed by a
  person.** The canonical origin comes from the platform's own
  `RAILWAY_PUBLIC_DOMAIN` through [`src/lib/site-url.ts`](src/lib/site-url.ts), and
  the case-study flag defaults to locked when absent.
  `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` is set to `false` automatically so the
  closed gate is visible rather than merely implied; `NEXT_PUBLIC_SITE_URL` is
  **deprecated** and retained only so an existing Vercel deployment keeps working.
  No secret may ever be placed in a `NEXT_PUBLIC_*` variable, and this site needs
  none at all — it has no database connection, no API key and no third-party
  service. The manifest generator scans its own output for secret patterns before
  writing it.

---

## 9. Continuous integration

[`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml), path-filtered to
`portfolio/**` and to the evidence files the manifest is generated from.

- **quality** — formatting, lint, types, manifest freshness, unit tests, production
  build, the repository secret scan, dependency audit
- **browser** — the accessibility, navigation, content-integrity and design-system
  suites against a production build in Chromium, plus the transfer-size report

Nothing in this workflow validates a semantic model. That boundary belongs to `ci.yml`
and to ADR-0008. What this workflow checks is that the website never _claims_ a
validation that has not happened, which is a different assertion made against the
evidence files rather than against an engine.

### Dependency overrides

`package.json` carries four `overrides`. Each exists to close a high-severity
advisory that no forward version of a direct dependency fixes, and each is a patch
or minor bump within the same major line rather than a fork or a pin backwards.

| Override                    | From                    | Advisory it closes                                                                                                                          |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss` → `8.5.25`        | `next` bundles `8.4.31` | XSS via unescaped `</style>` in stringify output; path traversal and arbitrary `.map` disclosure via attacker-controlled `sourceMappingURL` |
| `sharp` → `0.35.3`          | `next` pins `0.34.5`    | four inherited libvips CVEs                                                                                                                 |
| `brace-expansion` → `5.0.8` | ESLint's plugin tree    | ReDoS                                                                                                                                       |
| `minimatch` → `10.2.6`      | ESLint's plugin tree    | ReDoS                                                                                                                                       |

npm's own remedy for the first two is `next@9.3.3` — a six-year downgrade — and for
the last two `eslint@10`, which this project cannot take because `eslint-plugin-react`
does not support it yet. An override is the honest fix: it patches the vulnerable
package rather than pretending the advisory is acceptable.

Neither of the first two is reachable in this site as built — the CSS pipeline
processes only source-controlled stylesheets, and `sharp` is Next's image-optimisation
dependency which this site never invokes, having no `next/image` usage and no raster
pipeline. They are fixed anyway, because "not reachable today" is a property of the
current code rather than of the dependency, and the audit gate is not something to
argue with.

`npm audit` reports **0 vulnerabilities** at every severity, with and without
`--omit=dev`.

---

## 10. Licence

MIT, as the repository root. The three typefaces are SIL Open Font License 1.1;
attribution and the shipped subsets are recorded in
[`src/lib/fonts.ts`](src/lib/fonts.ts) and in
[DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) section 4.
