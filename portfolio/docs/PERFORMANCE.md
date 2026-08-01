# ARPI portfolio performance

Measured figures, the trades behind them, and the budgets they are held to.

Every number here comes from `npm run bundle`, which loads each route in Chromium
against a production build and sums the compressed transfer of every request the
route makes. Nothing here is estimated.

---

> **Experience redesign, version 2.** This document describes the system as it
> stands after the redesign recorded in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md`.
> That document holds the baseline it replaced, the severity-ranked findings, the
> decisions and their rejected alternatives, three adversarial review passes and
> the measured results. Where a rule below reads as unusually specific, the reason
> is almost always a finding recorded there.

**Measured after the redesign**, against a production build served locally,
because this environment cannot reach the deployment (see section 10):

| Route           | JS before |     JS after |       change |
| --------------- | --------: | -----------: | -----------: |
| `/`             |  230.3 kB | **187.6 kB** | **-42.7 kB** |
| `/status`       |  166.1 kB |     160.8 kB |      -5.3 kB |
| `/about`        |  166.1 kB |     160.8 kB |      -5.3 kB |
| `/architecture` |  215.1 kB |     215.0 kB |      -0.1 kB |
| `/data-model`   |  226.0 kB |     226.8 kB |      +0.8 kB |

Lighthouse, desktop preset, five routes: 100 / 100 / 100 / 100 on every one.
Best practices on `/` was 96 before; the four points were the console error
described in MOTION_SYSTEM.md.

## 1. How the measurement works, and two ways it was wrong first

`scripts/report-bundle.ts` drives a real browser. It did not start that way, and
both earlier versions are worth recording because both produced confident,
plausible, wrong numbers.

**Version 1 read `.next/app-build-manifest.json`** — the per-route chunk map. Next
16 builds with Turbopack, which does not emit that file. The script reported
nothing.

**Version 2 summed every `.js` file under `.next/static`.** That figure is
meaningless in a specific and instructive way: it counts every route's chunks
together, so no visitor ever pays it, and **it goes up when code splitting
improves**. It reported a 38 kB _regression_ for the change that removed the
animation library from five routes.

**Version 3 loads each route in Chromium and sums compressed transfer.** That is
the figure a visitor pays, it is directly comparable between runs, and it improves
when code splitting improves.

The general lesson, which this repository has now learned three times over — with
overflow, with the Phase 5 status, and here: **measure the thing the reader
experiences, not the artefact that is easy to count.**

The report is informational and exits zero even over budget. The budgets below are
reviewed by a person; a hard CI threshold would be raised the first time it was
inconvenient rather than investigated.

---

## 2. Two figures, because neither alone is honest

The report prints two tables.

**Route cost alone** blocks App Router prefetches, so it shows what the route
itself costs. This is the number a change to that route moves.

**What a visitor pays** allows them. The primary navigation links to all seven
routes and Next prefetches a `<Link>` whose target is in the viewport, so landing
on any page pulls the whole site's client bundle.

Reporting only the second is how version 2 hid a real improvement. Reporting only
the first would understate what a first-time visitor actually downloads.

---

## 3. Measured, cold load, compressed

### Route cost alone

| Route           | HTML    | JS       | CSS     | Fonts    | Total        |
| --------------- | ------- | -------- | ------- | -------- | ------------ |
| `/`             | 38.8 kB | 229.6 kB | 12.3 kB | 100.9 kB | **382.9 kB** |
| `/data-model`   | 22.4 kB | 225.4 kB | 12.3 kB | 100.9 kB | **362.3 kB** |
| `/architecture` | 24.5 kB | 214.3 kB | 12.3 kB | 100.9 kB | **353.4 kB** |
| `/kpis`         | 15.6 kB | 185.9 kB | 12.3 kB | 100.9 kB | **316.0 kB** |
| `/status`       | 35.3 kB | 165.4 kB | 12.3 kB | 100.9 kB | **315.2 kB** |
| `/governance`   | 25.9 kB | 171.7 kB | 12.3 kB | 100.9 kB | **312.2 kB** |
| `/case-study`   | 24.5 kB | 165.4 kB | 12.3 kB | 100.9 kB | **304.3 kB** |
| `/about`        | 22.2 kB | 165.4 kB | 12.3 kB | 100.9 kB | **302.1 kB** |

### What a visitor pays, navigation prefetch included

**302.5 kB of JavaScript on every route.** Heaviest as paid: `/` at 546.0 kB.
Lightest: `/kpis` at 522.9 kB.

Three things are visible in the first table and worth naming:

**The three routes with the animation library are the three heaviest by JS.**
`/`, `/data-model` and `/architecture` carry 214–230 kB; the other five carry
165–186 kB. That gap of roughly 50–65 kB _is_ the library, and it is the whole
justification for confining it. See section 4.

**`/status` has the largest HTML after the home page** at 35.3 kB, and no
interactivity at all. That is the manifest rendered as prose — eight phases, four
increments, two gates, two engine paths, every one with its status reason and exit
criteria. It is the right shape: heavy in the document, nothing in the bundle.

**CSS is 12.3 kB on every route**, identical, because the whole design system is
one stylesheet built from a closed token set. There is no per-route CSS to split.

---

## 4. The motion budget, measured

The site's most common animation — fade and rise sixteen pixels once on entering
the viewport — appears on six of the eight routes. It was implemented with the
animation library, which meant that library shipped to all six to move an element
sixteen pixels.

It is now two CSS declarations and a class toggle.

|                                       | Before  | After        |
| ------------------------------------- | ------- | ------------ |
| Client JS on the lightest route       | ~295 kB | **165.4 kB** |
| Routes carrying the animation library | 6 of 8  | **3 of 8**   |
| Routes carrying it that don't need it | 5       | **0**        |

A smaller related change with the same character: `AnimatedCount` used the
library's `useInView` hook, which pulled the entire library into the **home page**
for a visibility check that is nine lines of standard `IntersectionObserver`. The
home page is the one route where every kilobyte is paid before a visitor has
decided to stay.

The library now loads only where a JavaScript animator is genuinely required — the
hero's drawn SVG paths, the scrollytelling diagram's width transitions, and the two
explorers' spring-driven node emphasis against a moving target.
`tests/unit/motion.test.ts` asserts the import list, so the next reveal added to
the site cannot quietly re-import it.

---

## 5. Fonts

**100.9 kB across three faces**, latin subsets of the variable fonts:

| File                                 | Bytes  | Preloaded |
| ------------------------------------ | ------ | --------- |
| `Inter-Variable-latin.woff2`         | 48,256 | yes       |
| `JetBrainsMono-Variable-latin.woff2` | 31,432 | **no**    |
| `SpaceGrotesk-Variable-latin.woff2`  | 22,288 | yes       |

Three decisions here.

**Variable fonts, one file each.** Inter at 400–700 as three static weights would
be roughly 1.6× this and would need three requests.

**Latin subset only.** The site is English; the full Inter file is over 300 kB.

**JetBrains Mono is not preloaded.** It appears below the fold on most routes, and
a third preloaded face competes for bandwidth with the two that render the
headline. It arrives with `display: swap` against a metric-matched fallback.

`next/font/local` emits a metric-matched fallback face for each family, so the swap
produces **no layout shift** — the reason `adjustFontFallback` is set rather than
left off.

Loaded from committed files rather than `next/font/google` so the build is
hermetic: the Google loader fetches binaries from `fonts.gstatic.com` at build
time, which would let CI go red for a reason unrelated to the change under review.

---

## 6. The prefetch trade, stated explicitly

A visitor pays about **302 kB of JavaScript once**, and every subsequent navigation
is instant.

That is a deliberate choice, not an oversight. For an eight-page document site
where a reader who engages will visit four or five routes, front-loading the
navigation is the better trade: the alternative is a 40–60 kB fetch on every click,
which on a slow connection is a visible pause each time.

It could be reduced with `prefetch={false}` on the primary navigation. It has not
been, because the measured cost is a one-time 300 kB on a site whose _documents_ are
15–39 kB, and the benefit is that the whole site reads like one continuous
document. If the site ever grows past a dozen routes, this should be revisited.

---

## 7. Assets

Every graphic on the site is SVG authored in this repository. No photography, no
icon sprite sheet, no raster in the page.

| Asset                      | Bytes  | Where                                                       |
| -------------------------- | ------ | ----------------------------------------------------------- |
| `favicon.svg`              | 794    | tab icon                                                    |
| `brand/monogram.svg`       | 887    | header, footer                                              |
| `brand/wordmark.svg`       | 1,392  | brand contexts                                              |
| `brand/social-preview.svg` | 7,618  | source for the share card                                   |
| `favicon-32.png`           | 927    | legacy tab icon                                             |
| `apple-touch-icon.png`     | 5,029  | iOS home screen                                             |
| `social-preview.png`       | 78,175 | Open Graph / Twitter card — **never requested by the site** |

The 78 kB social preview is fetched by a crawler generating a share card, never by
a visitor loading a page. It is the largest file in `public/` and costs a reader
nothing.

The two diagrams and the pipeline hero are inline SVG generated from data at build
time — no request, and no icon library import for the shapes.

`next.config.ts` has no image-loader configuration, because there is no raster
pipeline to configure.

---

## 8. Rendering

All fourteen routes are **statically prerendered** (`○ Static` in the build
output). No server-side rendering at request time, no incremental regeneration, no
revalidation window, no request-time data fetch. Every value on every page is
baked in at build time from the committed manifest.

Consequences worth stating:

- Time to first byte is a static file read.
- There is no cold start, because there is no function.
- The site cannot show a number the manifest did not contain, which is the
  content-integrity property described in
  [CONTENT_MODEL.md](CONTENT_MODEL.md) — and it is a _performance_ property too:
  nothing on any page waits on anything.

**There is no root `loading.tsx`**, and that is deliberate. It made every route a
Suspense boundary, which meant Next emitted a skeleton in the document with the
real content in a `<div hidden>` for a script to swap in. On a static site that
bought a few milliseconds of client-navigation polish and cost the document its
ability to render at all without JavaScript. See
[ACCESSIBILITY.md](ACCESSIBILITY.md) section 9.

Animation properties are `opacity` and `transform` only, so no animation on the
site triggers layout. `will-change` is scoped to the duration of a reveal and
dropped afterwards rather than left on six sections' worth of elements.

---

## 9. Budgets

Reviewed by a person, not enforced by a threshold.

| Metric                                | Budget   | Current                        |
| ------------------------------------- | -------- | ------------------------------ |
| Route JS, alone, compressed           | ≤ 240 kB | 165–230 kB ✅                  |
| Route JS, prefetch included           | ≤ 320 kB | 302.5 kB ✅                    |
| CSS, all routes                       | ≤ 20 kB  | 12.3 kB ✅                     |
| Fonts, total                          | ≤ 120 kB | 100.9 kB ✅                    |
| Route total, alone                    | ≤ 400 kB | 302–383 kB ✅                  |
| Routes carrying the animation library | ≤ 3      | 3 ✅ (asserted in a unit test) |
| Raster bytes a visitor requests       | 0        | 0 ✅                           |
| Third-party requests                  | 0        | 0 ✅ (asserted in an e2e test) |

The JS budgets are the ones with real headroom pressure. If a route approaches
240 kB alone, the question to ask is which library arrived and whether the three
routes that legitimately need the animator have grown to four.

---

## 10. What has not been measured

Stated rather than implied.

- **No Lighthouse or Core Web Vitals field data.** The site has not been deployed
  to a public URL, so there is no CrUX data and no lab run against real network
  conditions. LCP, CLS and INP are unmeasured. The structural properties that
  drive them are in place — static HTML, metric-matched font fallbacks, no
  layout-triggering animation, no request-time data — but _in place_ is not
  _measured_, and this document does not claim otherwise.
- **No throttled-network profile.** All figures are local, uncontended.
- **No cache-hit figures.** Every table is a cold first load, which is the
  pessimistic case and the right one to budget against, but it means the repeat-visit
  cost is unquantified.

Once a preview deployment exists, a Lighthouse run against it is the first thing to
add here.
