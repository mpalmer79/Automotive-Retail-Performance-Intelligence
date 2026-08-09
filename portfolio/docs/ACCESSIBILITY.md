# ARPI portfolio accessibility

**Target: WCAG 2.2 Level AA.** Automated checks pass on every route at two
viewports. Manual keyboard, zoom and reduced-motion review is recorded below.

This document records what was tested, what was found, and what was fixed — not a
statement of intent. Where a conformance claim depends on judgement rather than a
measurement, that is said plainly.

---

> **Experience redesign, version 2.** This document describes the site as it
> stands after the redesign recorded in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md`.

**Three defects the redesign introduced were caught by the checks in this
document before they shipped**, which is the argument for having them:

- the Operating View's field labels were `h4` directly under the section's `h2`,
  skipping `h3`. Caught by the heading-hierarchy sweep on `/`.
- `/governance` was the one platform route not rendering the platform
  sub-navigation. Caught by a new browser test, not by looking at it.
- the 44px target-size check named the previous hero's calls to action, so it had
  been passing against controls that no longer existed. Repointed.

**Two accessibility improvements over the previous build:**

- The six analytical domains were expandable cards carrying an `aria-label` that
  did not contain their visible text, failing WCAG 2.5.3 Label in Name for a
  voice-control user. They are now a real tab set whose accessible name is the
  visible label, with a roving tabindex, arrow keys, `Home`, `End` and wrap at
  both ends.
- The signature visual renders two compositions, portrait below `sm` and
  landscape above. Both are `aria-hidden` and the accessible equivalent is a
  single visually-hidden paragraph outside them, so a viewport change cannot
  change what a screen reader is told and the description is never announced
  twice.

## 1. What is verified automatically

`tests/e2e/accessibility.spec.ts` runs `axe-core` via `@axe-core/playwright`
against a **production build** in Chromium, on all ten routes, at 375px and
1440px, tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.

Result: **0 violations.** Every violation found during development is listed in
section 6 with what caused it.

A production build rather than the dev server: dev-mode React adds
development-only DOM attributes, the bundle differs, and an accessibility result
from a dev build does not describe what a visitor receives.

Beyond axe, the same suite asserts what axe cannot:

| Assertion                                                                | Why axe cannot do it                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Exactly one `h1` per route, no skipped heading level                     | axe checks order within a page region, not the document outline the site intends          |
| Every interactive element's bounding box is ≥ 24×24 CSS px               | axe's target-size rule needs a real box; this measures every element rather than sampling |
| Every status badge has a non-empty accessible name                       | axe cannot know that a colour is carrying meaning                                         |
| No horizontal page scroll at 320px or 200% zoom                          | measured as _actual scrollability_, see section 4                                         |
| Landmark set is `banner`, `navigation`, `main`, `contentinfo`, once each | axe checks uniqueness, not that the intended set is present                               |
| Skip link is the first focusable element and moves focus to `<main>`     | requires driving focus                                                                    |
| Reduced-motion and full-motion renderings contain the same text          | requires two contexts, see `reduced-motion.spec.ts`                                       |

---

## 2. Structure

Every route has the same landmark skeleton:

```
a[href="#main-content"]      the skip link — first focusable element in the DOM
header[role=banner]
  nav[aria-label="Primary"]
main#main-content[tabindex=-1]
  nav[aria-label="Breadcrumb"]   (every route except the home page)
  h1                              exactly one
footer[role=contentinfo]
  nav[aria-label="This site"]
```

`<main>` carries `tabIndex={-1}` so the skip link can move focus into it
programmatically without adding it to the tab order.

Two navigation landmarks exist, and both are named — `Primary` and `This site` —
because two unnamed `nav` elements are indistinguishable in a screen reader's
landmark list.

Headings: `<Heading>` takes `level` and `size` as separate props, so the document
outline is a decision independent of visual weight. Section headings are `h2`;
card and panel headings inside a section are `h3`.

---

## 3. Keyboard model

Everything is reachable and operable from a keyboard. Nothing is a
pointer-only affordance.

### The explorers

Both the architecture explorer and the data-model explorer are **single-select
listboxes**, which is what a "pick one of these" diagram actually is.

| Key               | Action                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `Tab`             | enters the graph, landing on the selected node                            |
| Arrow keys        | move the selection between nodes in layout order                          |
| `Home` / `End`    | first and last node                                                       |
| `Enter` / `Space` | no-op — arrow movement already selects, so there is no hidden second step |
| `Escape`          | clears the selection                                                      |

Fourteen individually-focusable nodes would mean fourteen tab stops before the
detail panel, which would make the diagram _worse_ for a keyboard user than for a
mouse user — the opposite of the intent.

The detail panel is an `aria-live` region, so a keyboard user arrowing through the
graph **hears** the selected node's detail rather than only seeing it.

**A defect worth recording.** An earlier revision marked the whole SVG
`aria-hidden="true"` and put the listbox inside it. The roles and names were all
present and completely inert: a keyboard-operable control that assistive
technology could not see. The SVG is no longer hidden — its decorative layers (the
grid, the layer bands, the edges, the drawn labels) each carry `aria-hidden`
individually, while the listbox and its options are exposed with a name per node.

Below each diagram, every node is _also_ rendered as a plain definition list with
its dependencies, status and source paths. That list is always in the DOM and is
the complete reading of the page. The graph is an operable summary of it, never the
only route to the content.

### The mobile navigation drawer

Focus trap, scroll lock and `Escape` to close, from three hooks in
`src/lib/hooks.ts`. Focus returns to the trigger on close. The trigger's
`aria-expanded` and `aria-controls` point at the drawer.

The drawer's close-on-navigation is derived (`openedOnRoute === pathname`) rather
than driven by an effect that sets state, so there is no render in which the drawer
is open on the new route.

### The KPI catalogue

Search input, filter chips and result list are all ordinary focusable controls in
reading order. The result count is announced through an `aria-live="polite"`
region, so filtering tells a screen-reader user what happened rather than silently
changing the list beneath them.

---

### The console

`/dashboard` adds three patterns, all of them variations on ones the site already
had rather than new machinery.

**The filter bar is a real form.** Five native `<select>`s, each with a visible
`<label>` and each carrying the parameter's own name. There is no combobox, no
listbox and no custom menu, so the on-screen keyboard, the operating-system picker
and every assistive technology behave the way the reader already expects. Changing a
control navigates; the submit button stays visible with scripting on because a
control that disappears when a script loads is a control a reader cannot rely on,
and because some browsers do not fire `change` on a keyboard selection until blur.

**The active-filter summary is links, not buttons.** Removing a filter is
navigation, so each chip is an `<a>` to the same view without that parameter, with a
visually-hidden "Remove this filter" completing its accessible name. That is also
what makes the summary work with scripting off.

**The scoreboard has two presentations and exposes one.** Ten columns of figures do
not fit a phone, and the inventory table already taught this repository what happens
when a wide table is left to scroll inside its own container. Below 1280px the
scoreboard is a stack of store cards carrying every column; at and above it, the
semantic table. Each is `hidden` at the other's widths, which is `display: none` and
therefore removes the inactive one from the accessibility tree - assistive technology
is never offered both readings of the same row, and `dashboard.spec.ts` asserts
exactly one is present at 390px and at 1440px.

Two smaller rules the console inherits and had to honour explicitly:

- **The wide table's scroll container takes focus.** `role="region"`, an accessible
  name from the caption, and `tabIndex={0}`, because a region that scrolls but cannot
  receive focus is unreachable by keyboard when its contents are text rather than
  controls. axe reports it as a serious WCAG 2.1.1 violation, and it did, on three
  store pages, before the inventory table grew this pair.
- **No state is carried by colour alone.** A trust check renders a glyph that differs
  per verdict _and_ the verdict word; an unresolved metric renders words rather than a
  dash; a chip the route cannot apply says "not applied here" in text. The bars in the
  age distribution and the funnel are `aria-hidden` decoration beside a real table,
  which is also the data-table alternative the chart rules require.

## 4. Reflow, zoom and small viewports

WCAG 2.2 SC 1.4.10 requires content to reflow to a 320px-equivalent width without
loss of information or two-dimensional scrolling.

Tested at **320, 375, 768, 1024, 1280, 1440 and 1920 px**, and at **200% and 400%
browser zoom**. The page never scrolls sideways at any of them.

The two diagrams scroll horizontally **inside their own containers**. That is
permitted — a diagram is data requiring two-dimensional layout — and each is
`overflow-x: auto` with a keyboard-reachable scroll region, with the full content
also available as a definition list below it.

### The listing table, and why "it scrolls in its container" was not good enough

The inventory listings used the same answer as the diagrams: a table inside an
`overflow-x: auto` region. The page never scrolled sideways, every automated
overflow check passed, and a test asserted the behaviour as correct.

It was still a reflow failure, and measuring it is what showed that. The table's
natural content width is **1,028px**, and the region it sits in is as narrow as
the page container makes it:

| Viewport | Scroll region | Columns outside it                                                                |
| -------- | ------------- | --------------------------------------------------------------------------------- |
| 320px    | 254px         | Year, Make, Model, Trim, Mileage, **Advertised price**, Stock reference, Snapshot |
| 375px    | 309px         | Make, Model, Trim, Mileage, **Advertised price**, Stock reference, Snapshot       |
| 768px    | 668px         | **Advertised price**, Stock reference, Snapshot                                   |
| 1024px   | 891px         | Stock reference, Snapshot                                                         |

SC 1.4.10 is about loss of information, not about the presence of a scrollbar. A
horizontal scroll region is a reasonable answer when a reader can see there is
more to the right; it is not one when the price of a car is 500px past the edge
of a phone screen and nothing indicates that the column exists.

So below **1280px** the listings are stacked result cards, and at 1280px and
above they are the semantic table with **no column outside its container at any
tested width**. 1280 rather than a medium breakpoint because at 1024 the table
still clipped two columns.

The cards are not a reduced view. Every field the table carries is on every card
— dealership where applicable, condition, model year, make, model, trim, mileage,
advertised price, stock reference and snapshot date — and a store page renders
one card per listing, which is asserted against the generated count so a
truncated set fails the suite.

Their semantics are `<article>` named by its own vehicle line through
`aria-labelledby`, and a `<dl>` of the remaining fields. Not a grid of `<div>`s:
each value is a labelled property of one listing, and a screen-reader user is
told the term before the value. The heading level is deliberately not asserted —
the component renders at three different depths, and a fixed level would skip one.

The two presentations are `display: none` at each other's widths, so exactly one
is in the accessibility tree and no listing is ever announced twice.

Both are capped at the same height and scroll inside their own focusable, named
region. The cards shipped uncapped first, and the store page that produced was
**105,036px tall at a 320px viewport** — about a hundred and thirty screens,
because the independent store's snapshot is 318 records and a card is taller than
a row. With the cap it is 9,094px.

That defect was found by a **timeout**, not by an assertion: the reflow sweep
scrolls each route end to end, and 105,000px is 219 scroll steps, which pushed
two tests past their 45-second budget. Worth recording, because a timing-out test
is easy to read as a slow machine and dismiss.

### How overflow is measured, and why the obvious way is wrong

The first version of the check was `scrollWidth - clientWidth`. It produced false
positives for two separate and legitimate reasons: a visually-hidden 1px box with
`white-space: nowrap` has a wide scroll extent that Chromium propagates up through
every `overflow: visible` ancestor, and a legitimate `overflow-x: auto` region
reports its full content width.

What actually matters for 1.4.10 is whether content ends up **unreachable**. So the
check measures the two things that mean that:

1. whether the viewport can genuinely be scrolled sideways
   (`window.scrollTo(99999, 0)`, then read `window.scrollX`), and
2. whether a visible, in-flow element extends past the viewport's right edge
   _without_ sitting inside a scroll container that would let the reader reach it.

That distinction is the difference between an automated check that is trusted and
one that is muted.

### Three real reflow defects found this way

| Defect                                              | Cause                                                                                                                                    | Fix                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Page 503px wide at a 320px viewport                 | `overflow-wrap: break-word` does not reduce an element's min-content width, so a 68-character repository path still forced the container | `overflow-wrap: anywhere` on `body`                  |
| A chip forced the page wider even with `break-all`  | `inline-flex` min-content is the sum of its items' min-content; an item does not break to satisfy its container                          | `flex-wrap` + `min-w-0`; `CodeLabel` became `inline` |
| Pages measured 523px at 375px while looking correct | Tailwind's `sr-only` sets `white-space: nowrap` on a 1px box; every source link announces a full repository path                         | `@utility sr-only` redefined without `nowrap`        |

The third made `document.scrollWidth` unreliable site-wide, which is why it is
called out in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) section 6.2 as well.

---

## 5. Colour and contrast

Every text colour is pinned to a measurement, not chosen by eye.
`tests/unit/tokens.test.ts` computes the WCAG relative-luminance ratio for each
text token against both the darkest and the lightest surface text sits on, and
requires ≥ 4.5:1 for all of them — including the five status colours.

| Token                 | On `obsidian-950` | Role                   |
| --------------------- | ----------------- | ---------------------- |
| `clarity #f2f6fc`     | 17.9:1            | headings, emphasis     |
| `steel-200 #b3bfd4`   | 9.6:1             | body copy              |
| `steel-300 #8b99b3`   | 6.3:1             | muted text             |
| `steel-400 #7887a8`   | 5.6:1             | faint text — the floor |
| `cyan-300 #5fdcee`    | 11.4:1            | accent, links          |
| `amber-300 #f7c96a`   | 11.7:1            | pending, blocked       |
| `violet-300 #ad9cf6`  | 7.1:1             | semantic model         |
| `emerald-300 #63d79b` | 9.9:1             | verified               |
| `rose-300 #f2909c`    | 7.4:1             | failed                 |

Two defects worth recording:

**`steel-400` was `#64748f`**, which measured 4.26:1 on the canvas and 3.68:1 on
`surface-raised`. axe flagged it on all nine routes. Raised to `#7887a8`.

**Text opacity was used and has been removed entirely.** An `opacity-70` on
already-faint text produced a measured 3.13:1 — and opacity is invisible to a
contrast checker that reads token values, so it would have passed the unit test and
failed the browser. Faintness is now a colour token or it is nothing.

**Colour is never the only carrier.** Each status colour is paired with an icon and
a text label in `<StatusBadge>` (SC 1.4.1). The badge also writes a `data-status`
attribute, so tests assert the semantic state rather than the pixel colour. Both
explorers use shape and position, not only hue, to distinguish built from pending
from planned paths, and both carry a text legend.

---

## 6. Focus and target size

**Focus indicator** — `2px solid var(--arpi-colour-focus)` at `outline-offset: 2px`
on every focusable element (SC 2.4.7, 2.4.11). Drawn with `outline` rather than
`box-shadow`, so it survives a clipped ancestor.
`:focus:not(:focus-visible)` suppresses it for pointer interaction only. Focus is
never animated: a focus ring that fades in is a focus ring that is briefly absent.

**Target size** — SC 2.5.8 requires 24×24 CSS px. `SourceLink` failed at **17.8px**
and, once padded, failed again at **23.6px** because the padding was asymmetric and
the box rounded down. It now carries `min-h-6 py-0.5`. The test measures every
interactive element's real bounding box, which is what caught the second failure —
a class-list assertion would have passed it.

### Every violation found during development

| Route(s)                       | axe rule            | Cause                                           | Fix                                                |
| ------------------------------ | ------------------- | ----------------------------------------------- | -------------------------------------------------- |
| all 9                          | `color-contrast`    | `steel-400` at 4.26:1                           | token raised to `#7887a8`                          |
| `/`, `/governance`             | `color-contrast`    | `opacity-70` on faint text → 3.13:1             | text opacity removed site-wide                     |
| `/architecture`, `/data-model` | `heading-order`     | explorer panel used `h3` under the page `h1`    | panel headings to level 2                          |
| `/architecture`, `/data-model` | `aria-hidden-focus` | interactive listbox inside an `aria-hidden` SVG | SVG exposed, decorative layers hidden individually |
| all 9                          | `target-size`       | `SourceLink` at 17.8px, then 23.6px             | `min-h-6 py-0.5`                                   |

---

## 7. Browser coverage, and why Chromium alone by default

Chromium is the default and only Playwright project. Firefox and WebKit are
configured and run when `ARPI_E2E_ALL_BROWSERS=true`.

The reasoning, recorded rather than assumed: running three engines on every push
triples the slowest job in the pipeline. What that buys, for **this** site, is
narrow. There is no vendor-prefixed CSS, no browser-specific JavaScript, no polyfill,
no canvas, no media element, and no layout technique newer than subgrid-free CSS
grid and flexbox. The realistic cross-engine risks are `overflow-wrap: anywhere`
min-content behaviour, `text-wrap: balance`, `clip-path` in the visually-hidden
recipe, and `100dvh` — all four widely supported, and all four with graceful
degradation.

Against that: axe-core's own rule outcomes are engine-independent for everything
this site uses, and the two engine-specific behaviours that _would_ matter — the
scroll-extent propagation described in section 4, and `backdrop-filter` creating a
containing block — are both Chromium behaviours already covered.

So the trade is explicit: **Chromium on every push, all three on demand.** If the
site ever gains an engine-sensitive technique, this decision should be revisited
rather than inherited.

Reduced motion, forced colours and scripting-disabled are all exercised in
Chromium, which is where the interesting failures were.

---

## 8. Motion and vestibular safety

Full detail in [MOTION_SYSTEM.md](MOTION_SYSTEM.md) section 9. The summary:

- `prefers-reduced-motion: reduce` collapses every CSS transition and animation to
  1ms site-wide, including any a future component forgets to guard, and removes the
  reveal's displacement entirely.
- Nothing on the site is scroll-hijacked. The scrollytelling section reads scroll
  position and never writes it.
- No parallax on text. No autoplay video. No background audio. No custom cursor.
- The two ambient animations are `opacity` on a single element each, and both stop
  under reduced motion.
- `tests/e2e/reduced-motion.spec.ts` loads every route at both preferences and
  asserts the rendered text is **identical**. A reduced-motion branch that drops
  information is a bug, not a simplification.

---

## 9. The site works without JavaScript

### The console's visualisations, specifically

The Executive Overview draws nine things. All nine are server components, so with scripting
disabled every one of them is in the served document — including the inline widths and
heights, which are attributes of the HTML rather than something a script applies after load.
`dashboard.spec.ts` asserts that directly, with scripting off, by counting the drawn elements
in `main`.

What a reader who cannot see the geometry gets instead, per visual:

| Visual                | Accessible equivalent                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| `ExecutiveMicroTrend` | a visually-hidden summary sentence and a list of every month and its value       |
| `TrendChart`          | summary sentence + `<table>` in a `<details>`, present whether or not it is open |
| `StoreComparisonBars` | value printed beside every bar, plus a store × value `<table>`                   |
| `InventoryAgeStack`   | a labelled legend with every count, plus the existing three-column bucket table  |
| `GrossComposition`    | a `<dl>` of every component and amount; the qualification behind a disclosure    |
| `ReconciliationScale` | every account named with its signed variance, plus a four-column `<table>`       |
| `PaceBar`             | one `sr-only` sentence carrying every figure the bar encodes                     |

The geometry is `aria-hidden` in every case, because everything it encodes is text in the same
region and a screen-reader user who was also read the bars would hear each figure twice.

Three rules the visualisations are held to beyond the table above. **No tooltip anywhere**: a
figure a reader has to hover to obtain is a figure a keyboard user and a phone user do not
have. **No colour-only meaning**: the reconciliation scale carries none at all, and direction
elsewhere is a glyph, a sign and a word. **No animation**: there is nothing for the
reduced-motion rule to suppress, which `reduced-motion.spec.ts` asserts by requiring the two
renderings to contain the same text.

Two visuals have a second composition rather than a reflowed one — the age stack rotates to
vertical below `sm` and the reconciliation scale becomes per-account rows below `md` — because
five segments across the 280px a 320px phone actually offers puts the smallest under eight
pixels, and a signed axis needs room either side of zero. Each pair is `display: none` at the
other's width, so exactly one is in the accessibility tree and no band is announced twice. That
is the same technique the store scoreboard uses for its table and card presentations, and the
reasoning is recorded in section 4.

### The console, specifically

`/dashboard` is the site's first route whose subject is figures, so "works without
JavaScript" needed to mean more than "renders something". The no-JavaScript block in
`dashboard.spec.ts` asserts, with scripting disabled, that the document contains: the
KPI values and their governed identifiers, the store scoreboard including its
`Not applicable` cell, the inventory summary and its age-distribution table, the
funnel stages, the trust state including the real Power BI verdict, the full synthetic
statement, and the methodology inside the closed `<details>` elements. It then submits
the filter form natively and asserts the filtered view rendered.

The methodology assertions read `textContent` rather than `innerText`, and the
distinction is the point: a closed `<details>` renders nothing, so `innerText` would
report the disclosures as absent. The claim being tested is that they are in the
document without scripting, not that they are expanded before a click.

Not a nice-to-have. A document that cannot be read when its bundle fails is not a
document.

With scripting disabled, every route renders complete, readable and navigable. The
primary navigation works, the breadcrumbs work, the skip link works, the
synthetic-data disclosure is present, and every revealed section is visible — the
root layout ships a `<noscript>` rule that forces `[data-arpi-reveal]` elements to
full opacity. What is lost is the ten animations and the explorers' interactivity,
and the explorers' full content is present as a definition list either way.

**A real defect this uncovered.** The site had a root `app/loading.tsx`. That puts
every route behind a Suspense boundary, and Next then emits the _fallback_ in the
document with the real content in a `<div hidden>` for a script to swap in. With
scripting disabled the swap never happened, so **every route served a loading
skeleton and nothing else** — a completely blank site, in a browser that had simply
failed to run one file. The file was removed; on a fully static site a route-level
skeleton buys a few milliseconds of client-side navigation polish and costs the
document its ability to be read at all. `tests/e2e/reduced-motion.spec.ts` asserts
against a regression on every route.

---

## 10. Manual review

Automated checks cannot answer these, so they were reviewed by hand at 375px,
1024px and 1440px, in Chromium, with and without reduced motion.

| Question                                                           | Finding                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Does tab order follow reading order on every route?                | Yes. Verified route by route.                                                                          |
| Is focus ever lost or trapped unintentionally?                     | No. The drawer is the only trap and it is intentional; focus returns to the trigger.                   |
| Is every icon either labelled or `aria-hidden`?                    | Yes. Decorative icons are hidden; the four icon-only buttons carry `aria-label`.                       |
| Does the page make sense read top to bottom with no styling?       | Yes, checked with CSS disabled. The manifest-derived content is prose and lists, not layout.           |
| Is any information conveyed only by position?                      | No. The diagrams' left-to-right meaning is stated in text and repeated in each node's dependency list. |
| Does anything flash or move more than three times per second?      | No. Nothing on the site flashes.                                                                       |
| Are error and empty states reachable and legible?                  | Yes. `/not-found` and the error boundary were reviewed at all seven viewports.                         |
| Does the locked case-study page explain itself to a screen reader? | Yes. The blocking reasons are an ordinary list, not a visual treatment.                                |

---

## 11. Known limits

Stated rather than omitted.

- **No screen-reader testing on a real assistive technology.** The accessibility
  tree, names, roles and live regions are asserted programmatically, and the
  keyboard model was reviewed by hand. NVDA, JAWS and VoiceOver were not run. That
  is a genuine gap: the accessibility tree being correct is necessary but not
  sufficient for a good screen-reader experience.
- **`prefers-contrast: more` is not specially handled.** The palette already
  exceeds AA everywhere, and a forced-colours override would need testing on a real
  high-contrast configuration to be worth shipping.
- **No `lang` switching.** The site is English only, declared once on `<html>`.
- **AAA is not claimed.** Body copy exceeds 7:1 in practice, but the faintest text
  token is at 5.6:1, and several status washes would need rework to claim AAA
  honestly.

## The leads and marketing route (`DASH.10`)

Seven data visuals, and none of them is an image, a canvas or an SVG a screen reader has to
interpret. Each is a `<figure>` carrying:

- a `<figcaption>` with the section heading, the caption that qualifies it, and a **summary
  sentence containing the exact values** — "Median first response 27.5 minutes across 4,924
  responded leads, with 614 leads carrying no recorded response";
- the values again as text beside every bar, so the number is never only a length;
- a real `<table>` in a `<details>` for the multi-category visuals, with a `<caption>` naming
  its columns.

The bar tracks are `aria-hidden="true"`. That is deliberate rather than lazy: the track is a
`<div>` whose width is a CSS percentage, it carries no text, and the figure it represents is
already in the accessible tree twice — beside the bar and in the disclosure table. Exposing the
track would add a node that reads as nothing.

**No colour carries meaning anywhere on this route.** There is no benchmark in this project for
response time, contact rate, show rate, cost per lead, cost per sale or gross return, so nothing
is green or red and no state is distinguished by hue alone. Every absence is a WORD — "Not
applicable", "No data", "Not published at this grain", "Spend with no attributed leads" — and
the four are distinguishable in text, which is the same requirement stated for a sighted reader.

**The wide marketing table scrolls inside its own container.** Ten columns cannot reflow into
320 px, so the table sits in an `overflow-x: auto` region rather than pushing the page sideways.
`dashboard-leads-marketing.spec.ts` asserts the container scrolls and that the document does
not, at all eight widths from 320 px to 1920 px.

**With scripting disabled the page is identical, not degraded.** The route adds no client
JavaScript; the bars are drawn server-side and the filter form is a native GET submission.
Fifteen fragments spanning every block are asserted present with `javaScriptEnabled: false`.

The route is in `ALL_TESTED_ROUTES`, so the existing axe sweep covers it at every viewport with
the same zero-critical, zero-serious bar as every other route.
