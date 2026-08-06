# ARPI portfolio visual review

An adversarial review of the built site, conducted against a production build in a
real browser, at seven viewports, at two motion preferences, and with scripting
disabled.

The purpose was not to confirm that the site looked finished. It was to find the
reasons it was not.

**Twenty defects were found. All twenty are fixed, and nine of them are now
asserted by a test** so the same class of failure cannot return silently. The full
list is in section 3.

---

> **Superseded in part.** This document records the review of the build that the
> experience redesign replaced. The equivalent for the current site is
> `portfolio/docs/EXPERIENCE_REDESIGN_V2.md` sections 4 to 6, which carry three
> further adversarial passes. The METHOD below is unchanged and is still the one
> used: same script, same viewports, same overflow check, and still no committed
> screenshot baselines, for the reason given in section 1.
>
> The method earned its keep again: the overflow check caught 85px of real
> horizontal scroll at 375px in the redesigned hero, before it reached a commit.

## 1. Method

Captured by `npm run review:screenshots` against `next build && next start`.

| Dimension          | Coverage                                                      |
| ------------------ | ------------------------------------------------------------- |
| Routes             | all 9, plus `/not-found`                                      |
| Viewports          | 320, 375, 768, 1024, 1280, 1440, 1920                         |
| Zoom               | 200% at 1280                                                  |
| Motion             | full and `prefers-reduced-motion: reduce`                     |
| Scripting          | enabled, and disabled                                         |
| Interaction states | node selected in both explorers, drawer open, filters applied |

91 screenshots. They go to a gitignored directory and are attached to the pull
request as review evidence rather than committed.

### Why there are no committed visual baselines

A deliberate decision, not an omission.

A baseline set nobody re-approves becomes a rubber stamp: the second time a
legitimate change turns twelve screenshots red, the reviewer updates all twelve
without looking, and from then on the suite asserts only that the site has not
changed _accidentally_ — which is a much weaker property than it appears. And a
large binary set in the repository is a cost paid on every clone, forever, for a
project whose whole point is that its artefacts are text.

What replaces it is stricter in the ways that matter: `tests/e2e/design-system.spec.ts`
asserts _computed values_ in a real browser, which catches the things a pixel diff
would show and also the things it would not — a `z-index` that resolved to `auto`
painted in exactly the right place.

---

## 2. The fifteen questions

Each was asked of every route, at every viewport, and answered by looking rather
than by asserting.

### 1. Does this look like it was designed, or assembled?

**Designed.** The evidence is negative: nothing on the site is a default. There is
no default border radius, no default shadow, no default type scale, and no default
colour — Tailwind's ramps are reset to `initial`, so an accidental `bg-slate-700`
does not compile. The rules carry alignment ticks, the elevation is a lightening
border plus a one-pixel top highlight rather than a soft drop shadow, and the grid
motif is a masked dot matrix rather than a background image.

The one place it _did_ look assembled was the domain card grid, which was six
equally-weighted cards in two rows — an arrangement that communicates "six things"
and nothing else. The primary fact in each card is now given its own weight, so the
grid has a reading order.

### 2. Would a hiring manager screenshot this?

The home page hero, the architecture explorer with a node selected, and the
`/status` page. Those three are the ones that carry a claim a reader can check.

### 3. Does the typography have a point of view?

Yes, and it is narrow on purpose: Space Grotesk confined to the wordmark, `h1` and
`h2`; Inter for everything read as prose; JetBrains Mono for identifiers only and
never for prose. Three families with one job each is a position. The negative
tracking on large display sizes and the 0.16em on 12px uppercase eyebrows are the
two places where the type would look wrong at default tracking.

### 4. Is there a clear focal point on every screen?

Yes, after one fix. Six of the eight routes were fine. The `/governance` page
opened with three cards of equal weight and no entry point, so a reader's eye had
nowhere to land; the synthetic-data statement is now the page's opening claim,
which is both the correct focal point and the most important sentence on the route.

### 5. Does the motion feel purposeful?

Yes for nine of the eleven animations. The two that did not were removed: a hover
lift on static cards, which said "clickable" about something that was not, and a
stagger on the evidence ledger, which turned a scannable list into a queue.

The scrollytelling section is the one to be suspicious of, and it survives the test
that matters: it reads scroll position and never writes it, so a reader can flick
past the whole section at any speed and nothing fights them.

### 6. Would this pass a design review at a good studio?

The three things a reviewer would push back on, and the answers:

- _"Why is the case-study page empty?"_ — it is not empty; it is the most
  substantive page on the site about what has not been done. That is a deliberate
  position.
- _"Two diagrams is a lot."_ — they answer different questions (how data moves,
  what shape it has) and share no component.
- _"The status page is very long."_ — it is, and it is the page a technical reader
  will spend the most time on. Length there is the feature.

### 7. Is the information hierarchy obvious?

Yes at three levels: page (header, then argument, then evidence), section (eyebrow,
heading, lede, content), and card (label, value, sources). Two heading-level
defects were found and fixed; see section 3.

### 8. Does anything look like a template?

The one thing that did was the original credibility strip — seven numbers in a row
across the full width, which is the standard SaaS "logos and metrics" band. It now
carries each figure's source link inline, which is the opposite move: the band is
the least template-like element on the page precisely because every number in it is
checkable.

### 9. Is the colour used deliberately?

Yes. The signal colour appears on the active path, the primary action and the
current state, and nowhere else. Amber means pending or blocked and is never
decorative. Emerald means verified and is never "on brand". Rose is present so the
vocabulary is complete and appears nowhere, because nothing in this project is
failed. Two contrast defects were found and fixed; see section 3.

### 10. Does it work at 320px?

Yes, after three fixes — all three of which were real horizontal overflow, and one
of which was a false positive that took longer to diagnose than the two real ones.
Details in section 3 and in [ACCESSIBILITY.md](ACCESSIBILITY.md) section 4.

### 11. Does it work at 1920px?

Yes. `--container-bleed: 96rem` caps the widest layout and `--arpi-layout-prose:
68ch` caps measure independently of the grid, so no paragraph reaches 140 characters
on a wide display. The fluid type scale clamps, so the hero headline is 68px rather
than 96px.

This is where the `--container-full` defect surfaced: the header rendered 1536px
wide inside a 1280px viewport.

### 12. Is every state designed, or only the happy path?

Designed: `/not-found`, the error boundary, the KPI catalogue's empty result, the
case-study locked state, the drawer, and the reduced-motion presentation of all
eleven animations. The KPI empty state names the filters that produced it and
offers to clear them, rather than saying "no results".

### 13. Would a reader trust the numbers?

This is the question the site exists to answer, and the mechanism is structural:
every count renders its own source links, and clicking one lands on the file in the
repository. The `detail` strings do the harder work — `daxMeasures` reads _"Written
and statically validated. Never evaluated by an engine."_ The caveat travels with
the number, in the same component, from the same file.

### 14. Does anything overclaim?

One thing did. An early home-page section header read "A validated semantic model",
which is true only for the static sense of _validated_ and false in the sense a
reader would take. It now reads that the model is built and statically validated,
with real-engine validation pending on both accepted paths — which is longer, less
satisfying, and correct.

Two other near-misses were caught by tests rather than by eye: the architecture
explorer resolved the semantic model's status from the manifest correctly but the
report-pages node had a hardcoded status, and the KPI page's "All 29 computable from
SQL" badge needed its companion "DAX never evaluated" badge to not read as a
completeness claim.

### 15. Is it obvious a human designed this?

The hand-placed diagram coordinates, the confinement of the display face to two
heading levels, the decision that Rose exists but is unused, and the choice to make
the locked case-study page substantive rather than apologetic. None of those is what
a generator produces.

---

## 3. Defects found and fixed

### Layout and overflow

| #   | Defect                                                     | Cause                                                                                        | Now asserted by                   |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Header 1536px wide on a 1280px viewport                    | `--container-full` overrode Tailwind's `max-w-full` keyword                                  | `tests/unit/tokens.test.ts`       |
| 2   | Page 503px wide at a 320px viewport                        | `overflow-wrap: break-word` does not reduce min-content width                                | `tests/unit/tokens.test.ts`       |
| 3   | A chip forced the page wider despite `break-all`           | `inline-flex` min-content is the sum of its items'; an item does not break for its container | `tests/e2e/accessibility.spec.ts` |
| 4   | Pages measured 523px at 375px while looking correct        | Tailwind's `sr-only` sets `white-space: nowrap` on a 1px box                                 | `tests/unit/tokens.test.ts`       |
| 5   | Two diagram nodes clipped and overlapping their neighbours | node boxes at x=960 with width 96 in a 1000-wide viewBox                                     | `tests/unit/architecture.test.ts` |
| 6   | Layer bands grouped roughly half the nodes they labelled   | band x ranges predated the node coordinates                                                  | `tests/unit/architecture.test.ts` |

Defect 4 is the one worth dwelling on: it was initially misread as a real layout
failure, and the fix for a real failure would have been wrong. It also made
`document.scrollWidth` unusable site-wide, which is why the overflow check now
measures actual scrollability instead.

### Silently-broken Tailwind v4 syntax

| #   | Defect                                          | Cause                                                                                  | Now asserted by                                                |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 7   | 29 utilities across 12 files had no effect      | `z-[--arpi-z-header]` is an arbitrary _value_; the custom-property form is `z-(--var)` | `tests/unit/tokens.test.ts`, `tests/e2e/design-system.spec.ts` |
| 8   | The header's background declaration was dropped | an opacity modifier on a `var()` colour (`bg-canvas/(--var)`) does not compile         | `tests/e2e/design-system.spec.ts`                              |

Defect 7's most visible symptom: every `z-index` on the site resolved to `auto`, and
the mobile navigation drawer rendered _below_ the page content — a broken layout
that looked completely fine in a screenshot, because the drawer still painted where
it was supposed to and only became unclickable.

This is the class of defect that motivated `tests/e2e/design-system.spec.ts`: a
Tailwind v4 arbitrary value that silently fails produces _valid CSS with a wrong
value_, and no type checker, linter, build or pixel diff sees it.

### Content that could disappear

| #   | Defect                                                                    | Cause                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Three sections never became visible                                       | a `Reveal` `child` mode that omitted its viewport trigger and relied on variant propagation from a parent it did not always have                                          |
| 10  | Every route served a loading skeleton and nothing else with scripting off | a root `loading.tsx` made every route a Suspense boundary, so Next emitted the fallback in the document with the real content in a `<div hidden>` for a script to swap in |
| 11  | Revealed sections stayed blank if the bundle failed                       | `opacity: 0` ships in the server-rendered markup                                                                                                                          |
| 12  | `Card` silently dropped an `aria-live` a caller passed                    | the wrapper did not spread `...rest`                                                                                                                                      |

Defects 9, 10 and 11 have the same shape and are the most dangerous kind of bug this
site could have: **content that is present in the DOM, correct, and invisible.**
Nothing about the page looks broken. All three are now asserted by
`tests/e2e/reduced-motion.spec.ts`, which loads every route with scripting disabled
and checks that every `h1` is visible, that no revealed element is below full
opacity, and that the synthetic-data statement survives.

### Accessibility

| #   | Defect                                                                                      | Rule  |
| --- | ------------------------------------------------------------------------------------------- | ----- |
| 13  | `steel-400` at 4.26:1, flagged on all nine routes                                           | 1.4.3 |
| 14  | `opacity-70` on faint text → 3.13:1                                                         | 1.4.3 |
| 15  | Heading skip `h1 → h3` in both explorer panels                                              | 1.3.1 |
| 16  | Interactive listbox inside an `aria-hidden` SVG                                             | 4.1.2 |
| 17  | `SourceLink` at 17.8px, then 23.6px after asymmetric padding                                | 2.5.8 |
| 18  | `backdrop-filter` on the header made it the containing block for the fixed drawer and scrim | —     |

Defect 16 is instructive: the roles, names and keyboard handling were all correct
and completely inert, because the whole subtree was hidden from assistive
technology. Defect 17 is the reason the target-size check measures real bounding
boxes rather than reading class names — the first fix passed a class-list assertion
and still failed at 23.6px.

### Motion and measurement

| #   | Defect                                                              | Fix                                                                                                    |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 19  | The animation library shipped to six routes to move an element 16px | reveal reimplemented in CSS; library confined to three routes, asserted in `tests/unit/motion.test.ts` |
| 20  | The bundle report was wrong twice, in opposite directions           | now drives Chromium and sums real compressed transfer; see [PERFORMANCE.md](PERFORMANCE.md) section 1  |

Defect 20's second version summed every `.js` file under `.next/static`, a figure
that **goes up when code splitting improves** — it reported a 38 kB regression for
the change that fixed defect 19.

---

### One false positive, and the guard it produced

Worth recording because it cost real time and because the failure mode is generic.

A review run reported horizontal overflow on eleven route/viewport pairs — 445px at
375px on the home page, 206px on three other routes, and more. Every figure was
wrong. `next start` reads the build manifest once, at boot; the build had been
replaced under a still-running server, so its content-hashed chunk names no longer
existed and it was serving a document whose stylesheet 404'd. The site was being
measured with **21 bytes of CSS**.

An unstyled page is still a page. It loads, it screenshots, it measures, and every
number it produces is plausible. It took a DOM probe — finding a `SourceLink` whose
computed `display` was `inline` despite an `inline-flex` class — to establish that
the layout was fine and the server was stale.

Both `capture-review-screenshots.ts` and `report-bundle.ts` now refuse to run
against an unstyled page, asserting that the body's computed background is the
canvas token's `rgb(5, 7, 11)`. No default stylesheet produces that colour, so the
check cannot pass by accident.

The lesson belongs with the other three in section 4: **a measurement tool needs to
verify it is measuring the right thing**, because a confident wrong number costs
more than no number.

---

## 4. The pattern in all twenty

Three of the twenty were visible in a screenshot. The other seventeen were not.

That is the finding, and it is why this review is documented as a method rather than
as a checklist. The defects that survive a careful visual pass are the ones where
the rendering is _plausible_: a `z-index` of `auto` that happens to paint correctly,
a phantom 200px of scroll extent from a 1px box, a page that renders complete unless
one file fails to load, a bundle metric that moves the wrong way.

So each of the three checks this project relies on was rebuilt around the same
principle — **measure what the reader experiences, not the artefact that is easy to
count:**

| Question                | Naive measure               | What is measured instead                               |
| ----------------------- | --------------------------- | ------------------------------------------------------ |
| Does the page overflow? | `scrollWidth - clientWidth` | whether the viewport can actually be scrolled sideways |
| How big is the bundle?  | sum of files on disk        | compressed transfer for one route in a real browser    |
| Is Phase 5 complete?    | what the prose says         | the status badge the manifest renders                  |

---

## 5. Re-running the review

```bash
npm run build
npx next start -p 3111 &
ARPI_REVIEW_BASE_URL=http://localhost:3111 npm run review:screenshots
ARPI_REVIEW_BASE_URL=http://localhost:3111 npm run bundle
```

Then work the fifteen questions again. The screenshots are the input to that
judgement, not a substitute for it — which is the same reason there are no committed
baselines.

---

> **Later pass, not an edit to this record.** The "filters applied" states captured
> above predate the shared control vocabulary in `src/components/ui/control.tsx`, so
> a fresh capture of the two explorers will not match what this review saw. See
> `DESIGN_SYSTEM.md` section 6.3.
