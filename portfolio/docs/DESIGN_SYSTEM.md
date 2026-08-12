# ARPI design system

The visual language of the ARPI portfolio website, and the rules that keep it one
language rather than nine.

Nothing here is aspiration. Every rule in this document is enforced by a token file, a
lint rule, a unit test or a browser assertion, and where it is enforced is named.

---

> **Experience redesign, version 2.** This document describes the system as it
> stands after the redesign recorded in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md`.
> That document holds the baseline it replaced, the severity-ranked findings, the
> decisions and their rejected alternatives, three adversarial review passes and
> the measured results. Where a rule below reads as unusually specific, the reason
> is almost always a finding recorded there.

## 1. The register

The site has one job: make a stranger believe that the numbers behind it are governed.
That belief is won or lost in the first two seconds, before a word is read, so the
surface has to look like an instrument rather than like marketing.

The reference point is **technical instrumentation** — an aircraft panel, a
laboratory readout, an engineering drawing. Hairline rules with alignment ticks,
monospaced identifiers, a single signal colour used sparingly, and generous space.
Precision, not excitement.

**The surface that carries it is a white canvas floating on a blue field.** A white
header opens the page, a full-page blue gradient carries the background, one dominant
white panel holds the content, and a white footer closes the field. This replaced an
obsidian near-black theme; the register did not change, the ground did. The full record
of that change, including the three candidate layouts and why one was chosen, is in
[EXPERIENCE_REDESIGN_V2.md](EXPERIENCE_REDESIGN_V2.md) part two.

What that rules out, explicitly:

| Not this                                                                 | Because                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Steering wheels, speedometers, tachometers, tyre tracks, checkered flags | Automotive _retail_ is a business of inventory turn and gross per unit. Racing iconography signals that the author confused the two.     |
| Sports-car photography                                                   | The subject is a dealership group's operating performance, not a vehicle.                                                                |
| Chrome text, aggressive racing type, fake carbon fibre                   | Dealership-advertising register. It reads as a vendor pitch.                                                                             |
| Excessive red and black                                                  | Same register, and it makes a status vocabulary impossible: if the page is already red, a failed state has nowhere to go.                |
| Neon-on-black, glow everywhere                                           | Reads as a crypto dashboard. Glow is used here for exactly one thing — the active signal path — so it has to be scarce to mean anything. |
| A field of glass cards                                                   | A grid of equally-weighted translucent panels is the absence of hierarchy, not a design.                                                 |

And what it rules out by omission: this site must not resemble a dealership homepage, a
vehicle-shopping site, a generic SaaS landing page, a copied component-library demo, a
student portfolio template, or a Power BI clone. It is a technical document with a
strong opinion about typography.

---

## 2. The token contract

**`src/styles/tokens.css` is the single source of truth for every visual constant.**

No file under `src/components` or `src/app` may introduce a raw hex value, a raw pixel
radius, a raw shadow, or a raw animation duration. If a value is needed and is not in
`tokens.css`, it belongs in `tokens.css` first.

Three files, in strict order:

```
tokens.css   →  the values, as --arpi-* custom properties
theme.css    →  maps --arpi-* onto Tailwind's namespaces via @theme
globals.css  →  @import the two above, then the base layer and the @utility set
```

`theme.css` introduces **no new constants**. Every right-hand side in it is a
`var(--arpi-*)` reference. That is what makes a utility class and a bare CSS declaration
resolve to the same value.

Naming: `--arpi-<group>-<role>[-<step>]`. The groups are `colour`, `text`, `space`,
`size`, `radius`, `border`, `shadow`, `blur`, `opacity`, `motion`, `z`, `layout`.

### 2.1 The palette is closed

```css
@theme {
  --color-*: initial;
  --font-*: initial;
  --text-*: initial;
  --radius-*: initial;
  --shadow-*: initial;
  --breakpoint-*: initial;
  /* … then only ARPI tokens */
}
```

Resetting Tailwind's default ramps to `initial` means an accidental `bg-slate-700` or
`text-red-500` **does not compile**. This is the cheapest possible enforcement of a
closed palette: it is a build error, not a review comment.

### 2.2 Two Tailwind v4 naming rules learned the hard way

Both of these were real defects, both shipped silently through type-checking, linting,
the production build and screenshot review, and both are now asserted by
`tests/unit/tokens.test.ts`.

**A layout token may not use a name Tailwind reserves as a static keyword.**

`--container-full` was the original name for the widest layout width. Tailwind treats
`full` as a static keyword meaning `100%`, so defining `--container-full: 96rem`
silently redefined `max-w-full` — every element relying on `max-w-full` widened to
96rem. The symptom was a 1536px-wide header on a 1280px viewport. The token is now
`--container-bleed`.

**Arbitrary _values_ and arbitrary _custom properties_ have different syntax.**

`z-[--arpi-z-header]` is the arbitrary-**value** form, and it compiles to the literal
`z-index: --arpi-z-header`, which is invalid, so the browser computes `z-index: auto`.
The correct form for a custom property is parentheses: `z-(--arpi-z-header)`. Twenty-nine
utilities across twelve files were affected, and every one of them had `z-index: auto` in
the browser. The stacking order happened to look right because the DOM order happened to
agree with the intended layer order.

The lesson generalised: **a Tailwind v4 arbitrary value that silently fails produces
valid CSS with a wrong value, and no tool in the ordinary pipeline sees it.**
`tests/e2e/design-system.spec.ts` therefore asserts _computed_ values in a real browser
for the z-index scale, the focus ring, the header backdrop and the token bridge. That
suite exists specifically to catch this class of defect.

---

## 3. Colour

### 3.1 Primitives

Ramps, never referenced directly by a component.

| Ramp    | Role                                | Steps                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Field   | the page background, nothing else   | `400 #3c96c4`, `500 #2e7bb2`, `600 #245c97`, `700 #1d4d84`, `800 #173b6e` |
| Canvas  | the white surfaces content sits on  | `pure #ffffff`, `soft #f7fafc`, `cool #edf3f7`, `wash #e3f2f8`            |
| Ink     | text on white                       | `900 #16202a`, `800 #232e38`, `600 #48565f`, `400 #5c6a74`                |
| Slate   | hairlines and the motif, never text | `400 #93a0a9`, `200 #d3dee6`, `100 #e6edf2`                               |
| Teal    | the signal colour                   | `700 #086076`, `600 #0a6c8b`, `500 #00688f`, `400 #0c92bc`, `100 #e3f2f8` |
| Link    | links, distinct from teal           | `600 #135f8a`                                                             |
| Inverse | text on the deep blues only         | `100 #ffffff`, `200 #e7f3f8`, `300 #c3dbe7`                               |
| Amber   | attention, pending, blocked         | `700 #8a5a06`, `100 #fbf0da`                                              |
| Violet  | semantic model and relationships    | `600 #5b45b8`, `100 #ece8fa`                                              |
| Emerald | verified pass states                | `600 #0f7a46`, `500 #17864d`, `100 #e2f4ea`, `50 #e9f7ef`                 |
| Rose    | genuine failure                     | `700 #8c1b30`, `600 #b3253c`, `100 #fbe6ea`                               |
| Orange  | a data-visualisation mark only      | `600 #a8480b`, `100 #fbeade`                                              |

Four ramps carry a `-50` step, and it exists for a different job from `-100`. A `-100`
wash tints a chip a reader looks at for a second; a `-50` tints a whole page region a
reader works **inside**. Each `-50` is its `-100` at three quarters strength over white,
**resolved to a literal** rather than written as an opacity at the call site — because
`bg-zone-plan/75` makes the real ground a composite of the token and whatever sits behind
it, and a contrast test measuring the token alone would then be measuring a colour the
browser never paints. The tier is not cosmetic: at `-100`, emerald-600 as text on the
violet region measures 4.49:1, just under the floor.

| `-50` step | Value     | Region                |
| ---------- | --------- | --------------------- |
| Teal       | `#eaf5fa` | group performance     |
| Emerald    | `#e9f7ef` | plan                  |
| Amber      | `#fcf4e3` | stock                 |
| Violet     | `#f1eefb` | demand and the funnel |

The text is not pure black. `#16202a` is very slightly blue so it reads as ink rather
than as a hard edge, which pure black produces against white at body sizes.

**Every pairing here is measured, and four of the direction's starting values failed.**
`ink-muted` at `#6E7A83` measured 4.40:1 on white; `ink-faint` at `#87939B` measured
3.15:1 and is not usable for text at all; the accent at `#087FA4` measured 4.58:1 on
**pure** white and 4.37:1 on the soft canvas, so it passed on one surface and failed on
the next one down; and the field's top stop at `#4FA9D3` left the white canvas edge at
2.64:1 against it. Each is corrected, and `tests/unit/tokens.test.ts` asserts every text
token against **all eight** grounds — the four whites and the four region tints — rather
than against the lightest one, because a colour is not accessible on its own, only on a
ground. The region tints joined that list the moment the console started painting them,
which is the whole reason they are opaque.

**The slate ramp sits below 3:1 on white by design.** It draws hairlines, dividers and
the background motif, none of which is text and none of which identifies a control or its
state, so WCAG 1.4.11 does not apply to it. That distinction is only safe if enforced, so
a test asserts no `--color-ink-*` token binds to it.

**Text on blue is confined to `field-deep` and below.** White on the top gradient stop
measures 3.31:1 and the secondary inverse measures 2.92:1, so the bright end of the field
carries no text at any size.

### 3.2 Semantic tokens

Components reference only these, so a palette change is one edit in `tokens.css`.

```
canvas  canvas-raised  surface  surface-raised  surface-hover  surface-sunken
border  border-strong  border-subtle
text  text-secondary  text-muted  text-faint  text-inverse
accent  accent-strong  accent-muted  accent-wash
model  model-wash
verified  pending  blocked  failed  deferred   (each with a -wash pair)
focus
```

Mapped into Tailwind as `bg-canvas`, `text-ink-muted`, `border-line-subtle`,
`text-verified` and so on. The rename from `text-*` to `ink-*` and from `border-*` to
`line-*` is deliberate: `text-text-muted` and `border-border` are unreadable at a call
site.

### 3.2a The data-visualisation vocabulary

ARPI has one brand accent and it is still teal. This is a **different concept**: a
vocabulary for chart marks, where colour has to carry meaning the brand accent cannot. A
dashboard drawn entirely in one hue makes every figure look equally important, which is
the opposite of what an operating surface is for.

```
data-positive  data-negative  data-warning              (each with a -wash pair)
data-primary   data-secondary data-tertiary             categorical identity
data-neutral   data-muted     data-reference            non-evaluative marks
data-age-fresh data-age-early data-age-threshold
data-age-aged  data-age-critical                        the ordered age ramp
zone-performance  zone-plan  zone-inventory  zone-funnel  domain grounds
```

**The rule these tokens exist to enforce: a mark is coloured because its meaning is
defensible, never because a number went up.** `data-positive` and `data-negative` are for
values whose **sign** has meaning — a signed gross movement, a waterfall contribution, a
variance that crosses zero — and for comparison against a **governed reference** such as
an explicit target. They are not for "bigger is better": a higher aged-inventory
percentage and a higher gross are not the same direction, and this console publishes no
favourable direction for most of its measures.

What that looks like in practice:

| Surface                  | Encoding                                                   | Why                                                                              |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Waterfall steps          | positive / negative; anchors take `data-reference`         | a step **is** a signed contribution; a level is not a direction                  |
| Trend and micro-trend    | `data-primary`, with `data-negative` only below zero       | a month above zero is not thereby a good month                                   |
| Front vs F&I gross       | the categorical pair                                       | neither half of a deal is the good half                                          |
| Store comparison         | one hue per store, from the **business code**              | identity, not rank; a filtered-out store must not shift the others               |
| Inventory age            | the five-step ramp, turning at the exported aged threshold | ordered risk, on a project default the legend names                              |
| Target attainment        | `data-positive` at 100% and nowhere else                   | a target is a reference the **business** published, not one the console invented |
| GL vs subledger variance | `data-neutral` on **both** sides of zero                   | a variance is a finding to investigate, not a failure                            |
| Region grounds           | `zone-*`, which encode nothing                             | the stock area is amber whether the lot is clean or ageing badly                 |

**Two restraints are as deliberate as the additions.** There is no red for a below-target
pace bar — a store at 40% attainment on the twelfth selling day is not behind, which is
what the selling-day marker on the track exists to show — and no ramp approaching 100%,
because a ramp encodes thresholds nobody governed. And the accounting scale keeps the
neutral token on both signs permanently; `tests/unit/dashboard-visual-refinement.test.tsx`
asserts that rather than trusting the comment that says so.

**The age ramp's one recorded limitation.** Its five steps each clear 3:1 against every
ground, but adjacent steps are **not** 3:1 from each other. Holding five ordered hues
apart in luminance as well as hue would force the fresh end so light that it fails against
the white it sits on. The stack therefore separates its bands structurally instead: a gap
of page background between them, and an age range and a unit count printed beside every
band. Colour orders the bands; it never carries a value alone.

### 3.3 Colour is never the only carrier

Each of the five status colours is paired with an icon **and** a text label in
`<StatusBadge>`, which also writes a `data-status` attribute so tests can assert the
semantic state rather than the pixel colour. WCAG 2.2 SC 1.4.1 is satisfied by
construction, and `tests/e2e/accessibility.spec.ts` asserts every rendered status badge
carries a non-empty accessible label.

Amber does double duty for `pending` and `blocked`, distinguished by wash depth, icon and
label. Rose is present so the vocabulary is complete, not because anything is failing:
nothing in ARPI is currently in a failed state, and the site does not invent one.

---

## 4. Typography

Three families. Each has exactly one job.

| Family             | Job                        | Weights          | Preloaded |
| ------------------ | -------------------------- | ---------------- | --------- |
| **Inter**          | interface and body copy    | 400–700 variable | yes       |
| **Space Grotesk**  | wordmark, `h1`, `h2` only  | 500–700 variable | yes       |
| **JetBrains Mono** | technical identifiers only | 400–500 variable | no        |

Space Grotesk is confined to two heading levels on purpose. Its wider technical
letterforms carry the instrument register that Inter does not, and letting it past `h2`
would make it the page voice, which is a different and much noisier site.

JetBrains Mono is for KPI IDs, schema and table names, column names, declared fact
grains, SQL and DAX fragments, repository paths and validation hashes. Never for prose.
It is not preloaded because it appears below the fold on most routes and a third
preloaded face competes with the two that render the headline.

### 4.1 Loading and licensing

Loaded with `next/font/local` from woff2 files committed under `src/fonts/`. Not
`next/font/google`: that loader fetches font binaries from `fonts.gstatic.com` at **build
time**, which would make a production build depend on a third-party host being reachable
and let CI go red for a reason unrelated to the change under review. Committed files make
the build hermetic.

Each file is the **latin subset only** of the family's variable font. Byte sizes are in
[PERFORMANCE.md](PERFORMANCE.md) section 5.

All three are **SIL Open Font License 1.1**, which permits embedding, subsetting and
redistribution:

| Family         | Author             | Source                                      |
| -------------- | ------------------ | ------------------------------------------- |
| Inter          | Rasmus Andersson   | https://github.com/rsms/inter               |
| Source Serif 4 | Frank Griesshammer | https://github.com/adobe-fonts/source-serif |
| JetBrains Mono | JetBrains s.r.o.   | https://github.com/JetBrains/JetBrainsMono  |

`next/font/local` emits a metric-matched fallback face, so the swap produces no layout
shift.

**The display face is a serif, and it replaced a second sans.** Space Grotesk was removed
rather than kept alongside Source Serif 4: the visual direction permits one serif, one sans
and one mono, and a display sans beside a body sans is two sans families.

**The committed Source Serif 4 file is not the one Google serves.** The full latin subset
carries two axes, `wght` 200–900 and `opsz` 8–60, and weighs 122 kB — more than the other
two families together. It is instanced before being committed: `opsz` pinned at 32, the
display-oriented end of the axis, and `wght` clamped to the 400–700 the site uses. That is
36 kB.

To regenerate it, fetch the latin `src` URL from the Google Fonts CSS API for
`Source+Serif+4:opsz,wght@8..60,400..700`, then:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("SourceSerif4-latin.woff2")
font.flavor = None
instantiateVariableFont(font, {"opsz": 32, "wght": (400, 700)}, inplace=True)
font.flavor = "woff2"
font.save("src/fonts/SourceSerif4-Variable-latin.woff2")
```

This is recorded so the file can be reproduced rather than being an artefact nobody can
rebuild.

### 4.2 Scale

Fluid between the 375px and 1440px viewports; every step clamps, so an ultrawide display
does not produce a headline spanning the screen.

| Token        | Value         | Use                             |
| ------------ | ------------- | ------------------------------- |
| `2xs`        | 11px          | alignment marks, axis labels    |
| `xs`         | 12px          | eyebrows, code labels, metadata |
| `sm`         | 13px          | dense table text                |
| `base`       | 15px          | UI default                      |
| `body`       | 17px          | reading copy                    |
| `lg` → `5xl` | clamped fluid | headings                        |

Two separate sizes for "small text" exist because a table cell and a caption have
different jobs: 13px is dense-but-scannable, 12px is metadata that should recede.

`--arpi-text-5xl` is `clamp(2.5rem, 4.2vw + 1.35rem, 4.25rem)`. The `vw` coefficient is
low enough that the hero headline does not double in size between a laptop and a 1920px
display.

Line height runs `tight 1.05` (display) → `relaxed 1.62` (prose). Tracking runs
`tighter -0.03em` (large display) → `eyebrow 0.16em`. Large type needs negative tracking
to avoid looking loose; uppercase eyebrows need heavy positive tracking to be legible at
12px.

### 4.3 `<Heading>` separates level from size

```tsx
<Heading level={2} size="xl">
  …
</Heading>
```

Document outline and visual weight are different decisions, and conflating them is how
sites end up with an `h4` used because it looked right. Keeping them separate is what let
the explorer panels be fixed when review found an `h1 → h3` skip: the size stayed, the
level changed.

### 4.4 Prose measure

`--arpi-layout-prose: 68ch`. A 12-column grid does not by itself stop a paragraph
reaching 140 characters on a 2560px display, so the `<Prose>` component caps measure
independently of the grid.

---

## 4a. Section grounds

The redesign's central structural change, and the reason `Section` no longer
takes a `bordered` prop.

Every section on the previous build carried the same hairline top rule. Nine of
them on the home page, and every section on six other routes. A rule repeated
that many times separates nothing: the page reads as one list of equal blocks,
which was finding A-03.

A ground is a shift in the surface a section sits on. It costs no ink, it
survives greyscale, it works at 200 percent zoom, and the eye reads it as
"somewhere else" rather than as "next item".

| Ground      | Token                    | Job                                                      |
| ----------- | ------------------------ | -------------------------------------------------------- |
| `cinematic` | `--color-canvas-deep`    | The hero and the closing section. Two per page at most.  |
| `canvas`    | default                  | Editorial narrative, reading copy.                       |
| `panel`     | `--color-canvas-raised`  | The surround for a product frame or interactive surface. |
| `evidence`  | `--color-surface-sunken` | Technical and evidence bands. Recessed instrumentation.  |

Rules:

- A page is expected to move between grounds, not to stay on one.
- No two adjacent sections share a ground.
- `divider` is reserved for a boundary between two sections on the SAME ground,
  where there is no surface change for the eye to read. Using it between two
  different grounds double-marks the boundary.

`--arpi-radius-frame` (1.75rem) belongs to exactly one component, the Operating
View's product frame, and appears nowhere else. One radius that is used once is
what makes a surface read as a piece of software inside the page rather than as
another card.

## 5. Space, layout and elevation

A 4px base scale, with a deliberate jump above `4rem` so that section rhythm is visibly
distinct from component rhythm. Section spacing is fluid —
`clamp(3.5rem, 7vw, 7.5rem)` — because a mobile viewport padded like a desktop wastes
half the screen.

Layout widths: `prose 68ch`, `narrow 44rem`, `content 72rem`, `wide 84rem`,
`bleed 96rem`, with `gutter: clamp(1.25rem, 4vw, 3rem)`.

Breakpoints — declared in `tokens.css` as documentation and mirrored in `theme.css` for
Tailwind, because a custom property cannot be used in a media query.
`tests/unit/tokens.test.ts` asserts the two lists agree.

```
xs 375   sm 640   md 768   lg 1024   xl 1280   2xl 1536   3xl 1920
```

The site is also explicitly designed and tested at **320px**, which is below `xs` and is
handled by the base unprefixed styles.

**Elevation is a restrained shadow, and the master canvas has its own.** This is the
inverse of the dark theme's problem: on near-black a large soft shadow read as a smudge,
so elevation was carried by a lightening border. On a blue field a shadow reads correctly
again, so `--arpi-shadow-canvas` is a real three-layer shadow — but a restrained one, and
it is used by the floating panel and by nothing else. `--arpi-shadow-inset-top` is now
`none`: a one-pixel top highlight is a dark-theme device and reads as a seam on white.

**Blur is used in exactly two places**: the sticky header and the mobile drawer scrim.
Anywhere else is a design defect. One consequence is load-bearing and was found in
review: `backdrop-filter` makes an element the containing block for
`position: fixed` descendants, so the drawer and scrim had to move out of `<header>` into
a sibling fragment or they were positioned relative to the header instead of the
viewport.

**Z-index is a closed set** — `base 0`, `raised 10`, `sticky 20`, `header 40`,
`scrim 50`, `drawer 60`, `popover 70`, `dialog 80`, `skiplink 90`. A component may not
invent a layer.

---

## 6. Component inventory

Deliberately small. Every primitive here is used by at least two call sites; anything
that was not got deleted.

**Layout** — `Container`, `Section`, `Stack`, `Cluster`, `Grid`, `Prose`

**Typography** — `Heading`, `Text`, `Eyebrow`, `CodeLabel`, `GrainLabel`

**Controls** — `Button`, `LinkButton`, `IconButton` (all from one `buttonClass`)

**Form controls**: `Field`, `ControlLabel`, `ControlHint`, `SelectControl`,
`TextControl` (all from one control box; section 6.3)

**Status** — `Badge`, `StatusBadge`, `KpiChip`

**Surfaces** — `Card` (static), `InteractiveCard`

**Evidence** — `SourceLink`, `SourceList`, `DefinitionList`, `DataCard`, `EvidenceItem`,
`MetricCount`

**States** — `EmptyState`, `LockedState`, `SkipLink`, `Breadcrumbs`

**Motion** — `Reveal`, `RevealGroup`, `RevealItem` (CSS), `MotionBoundary`,
`AnimatedCount`

**Brand** — `Monogram`, `Wordmark`

**Explorers** — `ArchitectureExplorer`, `DataModelExplorer`, `KpiCatalogue`

**Visualisation** — `BarChart`, `StackedMixBar` (inventory); `TrendChart`, `BridgeChart`,
`DistributionStrip` (console, `DASH.3`)

### 6.0a The visualisation primitives, and why there is no chart library

`DASH.3-02` required the chart decision to be made from evidence. A library was compared
against extending the two hand-built inventory primitives, and lost on four measurements and
one principle.

**Bundle.** The console ships about 1.6 kB of route-owned client JavaScript, because one
component is a client island. The smallest of the candidate libraries is two orders of
magnitude larger than that before a chart is drawn, and it is a cost that never comes back off.

**Server rendering.** Each of them needs a measured container to lay out, so the useful
configurations are client components. The console's guarantee is that every figure is in the
HTML; a chart that paints after hydration breaks it for the no-JavaScript reader the e2e suite
tests.

**Accessibility.** They render to canvas, or to SVG whose values live in `<path>` coordinates.
Either way the numbers leave the DOM, where a screen reader and a browser text search can both
currently find them.

**Maintenance.** A chart library is a second design system — its own spacing, type scale and
colour API. Reconciling it with these tokens costs more than the drawing does.

Measured delta for the three primitives that shipped instead: **zero bytes of client
JavaScript.** They are server components.

The shape every one of them follows: a `<figure>` with a heading and a one-sentence summary,
bars that are `aria-hidden` decoration, every encoded value printed as text beside its label,
and a real `<table>` inside a `<details>` — present in the document, and therefore in reading
order and in a text search, whether or not it is opened. Direction is a glyph and a sign, never
colour alone. A null renders as a gap with a stated reason, never as a zero-height bar.

Two primitives the backlog reserved were **not** built at `DASH.3`. A pace/bullet bar encodes a
target, and `DASH.5` owns targets; a funnel already exists on the Executive Overview as its own
component. An abstraction built for a page that does not exist is a guess about that page.

`DASH.5` subsequently built the pace bar (`components/dashboard/pace-bar.tsx`), with the target
data it encodes. The funnel primitive is still not built, and for the same reason: one call site.

### 6.0b The five primitives the Executive Overview's visual overhaul added

The chart-library decision above was re-tested against the harder case and did not change. Five
more primitives arrive in `components/dashboard/visuals.tsx`, and their measured client-JavaScript
delta is again **zero bytes** — they are server components.

| Primitive             | What it encodes                                        | Alternate composition       |
| --------------------- | ------------------------------------------------------ | --------------------------- |
| `ExecutiveMicroTrend` | a KPI card's own shape over the trailing months        | height only; never removed  |
| `StoreComparisonBars` | one governed measure across the stores in scope        | none needed                 |
| `InventoryAgeStack`   | the age distribution as one part-to-whole bar          | vertical below `sm`         |
| `GrossComposition`    | two components of a governed total                     | none needed                 |
| `ReconciliationScale` | signed GL-versus-subledger variance around a zero rule | per-account rows below `md` |

Four rules bind these beyond the shape §6.0a describes, each one a defect the overhaul had to avoid
rather than a preference:

**A primitive takes an `Exact` or a `MetricResult`, never a `number`.** A component given a number
cannot tell a measured zero from "Not applicable", and would draw a zero-length bar for a store that
is not in the business being measured — which re-creates geometrically the exact defect the
structural-absence rule removes from the scoreboard. `StoreComparisonBars` therefore takes the whole
result and renders four of its five states as words with no track at all.

**A part-to-whole bar receives its denominator; it never sums the parts.** A component may not
perform exact arithmetic (`dashboard-boundaries.test.ts`), and a denominator assembled from the
segments could disagree with the total the KPI row prints. `GrossComposition` takes the governed
total and withholds the whole bar when it is absent, zero, or when any segment is negative — a
signed amount is not a slice of a hundred percent, and a stack drawn over one is a picture of
something that did not happen.

**A distribution divides by the population, not by its own largest band.** The age bars this
replaced divided each bucket by the biggest bucket, which made the mode full-width at every scope
and produced an identical picture whether the lot was evenly spread or entirely aged.

**Where a variance is not a failure, nothing is coloured.** `ReconciliationScale` uses no colour at
all: the sign is carried by the side of the zero rule, by the printed amount, and by a sentence from
the governed helper. The export's own exception text says both sides are valid data, so a red marker
would publish a judgement the console is not authorized to make.

The geometry itself is one shared helper — `columnGeometry` — used by `TrendChart` and
`ExecutiveMicroTrend`, because two copies of a baseline calculation eventually disagree about where
zero sits, and that is the one thing about a column chart a reader cannot check by looking.

**And the view models these consume have one builder each.** `ReconciliationScale` was written in
parallel with `DASH.9`'s final increment, and for a short time two functions resolved the same
comparison date, applied the same store filter and totalled the same signed variance — one feeding
`DASH.9`'s four-card summary, one feeding this scale. The merge deleted the second rather than
shipping both: `buildAccountingSignal()` is the only one, and the scale reads its output. A
primitive that needs a richer input than an existing view model provides is a reason to widen that
view model, never a reason to write a second one beside it. Two builders agree on the day they are
written and nothing keeps them agreeing.

### 6.0c `UX.2A`: the library question re-asked, and the three primitives that answered it

`UX.2A` §19 required the chart decision to be **re-made rather than inherited**, on the grounds that
this is the first increment large enough to justify a library. It was re-made in full, against four
current options, and the outcome did not change. The reason is narrower than "we already decided", so
it is worth recording as its own comparison:

| Option                             | Accessibility                                                        | Responsive                                           | Keyboard / focus                              | Bundle                          | SSR                                                    | Interaction                        | Testability                               | Maintenance                                                       |
| ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------------------ | ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| **Custom HTML/CSS marks** (chosen) | values stay in the DOM as text; every chart carries a real `<table>` | container queries and two compositions per primitive | native controls only; nothing to re-implement | **0 bytes**                     | complete; every figure is in the served HTML           | CSS `:checked`, `<details>`, links | `textContent` assertions and DOM geometry | ours, in the token vocabulary                                     |
| **Recharts**                       | SVG whose values live in `<path>` coordinates                        | needs a measured container                           | custom, per component                         | ~95 kB min+gzip before a chart  | needs a client component for the useful configurations | rich                               | requires a rendered client tree           | a second design system to reconcile                               |
| **Visx**                           | primitives only; the accessible layer is still ours to write         | scales are ours to drive                             | ours                                          | ~15–40 kB depending on packages | possible for pure scales                               | ours                               | as ours                                   | it would supply scales and axes the three forms below do not need |
| **Chart.js**                       | renders to `<canvas>`; the numbers leave the DOM entirely            | resize observer                                      | none native                                   | ~70 kB                          | no — canvas paints after hydration                     | rich                               | pixel assertions                          | a second design system                                            |
| **Observable Plot**                | SVG, values in geometry                                              | ours                                                 | ours                                          | ~120 kB with d3 deps            | possible, awkward                                      | limited                            | as ours                                   | a second vocabulary                                               |

**The bundle column is an order of magnitude, not a measurement.** Nothing in it was installed and
weighed — installing four libraries to weigh them, in an increment that concluded against all four,
is the expensive way to reach the same answer. Those are published sizes, and they are used only to
establish the SCALE of the trade against the console's current zero, which is the only comparison
they have to support. An increment that reaches the condition stated below should measure rather than
reuse them.

Two of the criteria decide it, and the bundle is not one of them. **Server rendering**: this route's
contract is that every figure is in the served HTML, and three of the four cannot honour it without a
client component. **Accessibility**:
three of the four move the numbers out of the DOM, where a screen reader and a browser text search can
currently both find them. Visx survives both — and would have supplied scales and axes the three forms
`UX.2A` needed do not have. A share, a length and a nesting are one division each.

**A library is not ruled out forever.** The condition is stated so a future increment can check it
rather than re-litigate: the first primitive this console needs that requires a continuous scale, an
axis with computed ticks, or a layout algorithm (force, treemap, sankey) is the point at which
hand-building stops being cheaper than reconciling. None of the eleven primitives shipped to date is
in that class.

Three primitives arrive in `components/dashboard/exec-visuals.tsx`. Measured client-JavaScript delta:
**zero bytes**.

| Primitive          | What it encodes                                               | Alternate composition                       |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| `MetricSwitch`     | which of several server-rendered panels is displayed          | none needed; every panel is in the document |
| `StoreMeasureBars` | several governed measures across the stores in scope, grouped | none needed; rows stack                     |
| `FunnelChart`      | five governed stages as a nesting, with their governed rates  | none needed; rows stack                     |

Three rules bind them beyond §6.0a:

**A grouped comparison scales each measure to its own maximum, and says so.** Units, dollars and
dollars per unit share no axis; a common scale would draw retail units as a hairline beside total
gross. The consequence — that no cross-group length comparison is available — is stated in the
caption rather than left for a reader to discover.

**A store's mark colour comes from its business code, never from its row position.** `storeMarkClass`
already enforced this for `StoreComparisonBars` and `StoreMeasureBars` reuses it unchanged: a store
filtered out of scope must not shift the colour of every store after it, or a reader who learned that
the independent pre-owned centre is the violet one is reading a different store's figure one filter
change later.

**A presentation switch may change what is displayed and never what is computed.** `MetricSwitch` is
a radio group and CSS. All of its panels are server-rendered from the same governed selectors, an
unselected panel is `display: none` and therefore out of the accessibility tree, and the control works
with scripting disabled because nothing in it was ever script. It carries no URL state, deliberately:
`INFORMATION_ARCHITECTURE.md` §6 defines one filter grammar in which every parameter changes which
rows a figure is computed from, and a presentation preference that survived a navigation to a route
where it means nothing would be wearing that grammar's clothes.

`InventoryAgeStack` also gained a second track in `UX.2A` — the capital standing in each age band,
drawn over the same five governed bands as the unit counts. It required no export change:
`inventory-aging` publishes `investment_in_bucket` at the same grain as `units_in_bucket`. The track
is drawn only when **every** band in the stack carries a capital figure, because a partial capital
bar beside a complete unit bar invites exactly the comparison it cannot support.

### 6.0d The command-center grid (`UX.2A`)

`UX.1` left `/` as five full-width horizontal bands, each opening with an eyebrow, an `h2` and usually
a paragraph. That is the rhythm of an article: it reads top to bottom, one subject at a time. A
dashboard reads outward from a focal point, and its unit is a **module** — a titled panel holding one
question, sitting beside three others on the same screen.

- **Twelve columns**, because the content needs 7/5, 6/3/3, 5/4/3 and 4/4/4 splits and twelve is the
  smallest number that carries all of them without a fraction. Six at `md` (a tablet reads two modules
  across), one below it.
- **A module is a `<section>` with a real `<h2>`**, so a screen-reader user navigating by heading gets
  the same structure a sighted reader gets from the panel boundary. The visually-hidden pane headings
  this replaced gave a keyboard user a list of names with no relationship to the visible layout.
- **A `zone-*` wash moved from the band to the module**, because the module is now the unit the eye
  lands on. A wash still encodes nothing: the stock module is amber whether the lot is clean or ageing
  badly, and no `zone-*` token is a `data-*` token.
- **`data-visual-region`** marks the modules whose body is data-driven geometry. It is a test hook and
  carries no styling: it is what lets the first-viewport contract be asserted by measurement rather
  than by eye.
- **A module note is the one sentence a reader would misread the module without**, and most modules
  pass none. A note describing what a module contains is describing what its title and its labels
  already say, and six of those on one screen is what made this route read as a document.

### 6.0e `UX.2B`: the library question asked a third time, against a scatter

`UX.2B` §44 required the decision to be re-made once more, and named the case that makes it a real
question rather than a formality: **an inventory scatter of days in stock against price to market**,
one mark per unit, sized by capital and coloured by age band. A share, a length and a nesting are one
division each; a scatter is the first form on this console that needs two continuous positions at
once, and §6.0c named exactly that class as the point at which hand-building stops being cheaper.

It was measured against the criterion §6.0c wrote down, and it does not reach it:

| The condition §6.0c set                         | What the scatter actually needs                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a **continuous scale**                          | two linear min–max normalisations, one per axis. Four lines. No log, no time, no band, no nice-number rounding.                                                                                                                                                                                             |
| an **axis with computed ticks**                 | none. The axes carry a DIRECTION (`Older ↑`, `Higher price to market →`) and one reference rule at parity with the estimate, which is a defined point rather than a tick. Quadrant and threshold labelling is forbidden by §29, so a tick generator would be building something the increment may not draw. |
| a **layout algorithm** (force, treemap, sankey) | none. A mark's position is its two values; nothing is packed, nested or routed.                                                                                                                                                                                                                             |

So the scatter is positioned marks in a relatively-positioned box, and the outcome is unchanged for
the third time. The measured client-JavaScript delta across all five `UX.2B` routes is **zero bytes**.

**The condition stands, unchanged, for `UX.2D`.** The first primitive that genuinely needs a computed
tick scale, a time axis or a layout algorithm is the point at which this is re-opened — and an
increment that reaches it should measure the four options rather than reuse §6.0c's published sizes.

##### §6.0f — asked a fourth time at `UX.2C`, and not close

The hardest form `UX.2C` produced is the source comparison on `/dashboard/leads-marketing`: nineteen
lead sources against four measures, which is precisely the shape a charting library's grouped-bar or
small-multiples API exists for. Measured against the same condition:

| The condition §6.0c set         | What the source matrix actually needs                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| a **continuous scale**          | three columns whose values are already fractions of one, and two scaled to their own column maximum. One division per cell. |
| an **axis with computed ticks** | none. Every value is printed beside its own bar and the columns carry names, not ticks.                                     |
| a **layout algorithm**          | none. It is a CSS grid: one row per identity, one column per measure.                                                       |

`MeasureMatrix` is 120 lines of grid and one width function. The outcome is unchanged for the fourth
time, and the measured client-JavaScript delta across all four `UX.2C` routes is **zero bytes**.

#### The `UX.2C` primitives

One primitive MOVED and one ARRIVED. `FunnelChart` left `exec-visuals.tsx` for
`workspace-visuals.tsx`, which that file's own docstring required once a second route drew it, and the
emptied file was deleted rather than kept for a name that no longer described anything; its stage row
now wraps rather than truncating `Appointment set` to `Appoi…` in a three-of-twelve module.
`MeasureMatrix` is new and lives in `leads-workspace.tsx` rather than in the shared set, because it
has two call sites on one route and this repository's rule is that an abstraction over one call site
is a guess about the second.

#### The `UX.2B` primitives

Two primitives MOVED rather than arrived. `components/dashboard/exec-visuals.tsx` said in its own
docstring that its three forms would move if a second route ever rendered them; four now do, so
`MetricSwitch` and the grouped comparison are in `components/dashboard/workspace-visuals.tsx` under a
stated membership rule — _rendered by two or more operating routes, and needed by the workspace layout
rather than by one page's subject_. `FunnelChart` is still rendered by one route and stayed.
`exec-grid.tsx` became `workspace-grid.tsx` in the same pass, for the same reason: five more routes
lay out with it, and a file named after one of them was a false statement.

| Primitive              | Where                     | What it encodes                                                                              | Alternate composition                                      |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GroupedMeasureBars`   | `workspace-visuals.tsx`   | several governed measures across a set of identities, each measure scaled to its own maximum | a real `<table>` behind a disclosure                       |
| `StoreMeasureBars`     | `workspace-visuals.tsx`   | the store-scoped call of the above, supplying `storeMarkClass`                               | as above                                                   |
| `FrontEconomicsLadder` | `deal-headline.tsx`       | one deal's sale price and the three costs taken out of it, each as a share of the price      | the exact `<dl>` in the verification disclosure beside it  |
| `BackEndComposition`   | `deal-headline.tsx`       | one deal's finance reserve against its original product gross                                | the exact reconciliation table in its own disclosure       |
| `AgePriceMap`          | `inventory-workspace.tsx` | days in stock against price to market, sized by investment, coloured by exported age band    | the route's own unit table, linked                         |
| `StructureComposition` | `fi-workspace.tsx`        | retail deliveries by finance structure, as one part-to-whole bar                             | a real `<table>` behind a disclosure, with the denominator |
| `PenetrationBars`      | `fi-workspace.tsx`        | attached distinct deals over eligible deals, per category, against full eligibility          | a real `<table>` behind a disclosure                       |
| `AdjustmentBars`       | `fi-workspace.tsx`        | signed adjustment amounts by event type, on the adjustment-period basis                      | the exact event table in its own disclosure                |

Five rules bind them beyond §6.0a and §6.0c:

**A ladder is not a waterfall, and the difference is the question.** A waterfall's steps float between
two anchors and are read as contributions to a CHANGE — which is what the gross-change bridge is, and
the right form there. The deal's front gross is not a change: it is one price with three costs taken
out of it, so every deduction is a slice of the same starting amount and the ladder draws it against
the full track. Using a waterfall would have implied a period-over-period movement that does not exist.

**A proportion is drawn against its ceiling, never against the largest observation.** Every penetration
bar runs from zero to full eligibility. Scaling the set to its own maximum makes the best-attached
category a full bar whatever it actually reached, which is the single most misleading thing a
proportion chart can do, and the geometry suite fails if any bar reaches 100% in the fixture.

**A mark's AREA carries the amount, not its diameter.** Mapping a value to the diameter draws a unit
worth four times another one sixteen times as large. `AgePriceMap` maps investment to area and takes
the square root for the diameter, with a floor so the smallest unit on the lot is still a visible mark.

**A missing value is excluded from a plot and counted, never plotted at zero.** A unit the estimator
declined to price has no price-to-market ratio, so it has no horizontal position. Placing it at the
left edge of an axis it is not on would be the same false statement a zero-length bar makes.

**Colour by sign is permitted where the sign IS the accounting.** `AdjustmentBars` colours an amount
that reduced retained gross differently from one that restored it, under the same rule the bridge
colours its steps: that is a fact about the ledger rather than a judgement about the business. The
direction is also a word — _reduces retained gross_, _restores retained gross_ — because an arrow
alone was not enough: a reinstatement carries a negative amount and an upward direction, and `↑ -$297`
reads as a contradiction until the word is there.

### 6.1 Why there is no headless component library

`radix-ui` was a dependency, and `ui/overlays.tsx` wrapped it as `Tooltip`, `Popover`,
`Tabs`, `Accordion` and `Dialog`.

**Not one of the five was used by any route.** The site's interaction surface turned out
to be: a mobile navigation drawer, two diagram explorers with a listbox each, and a
filter set. The drawer needs a focus trap, a scroll lock and Escape handling, which are
three hooks in `src/lib/hooks.ts` totalling under sixty lines. The explorers needed
something Radix does not offer — a listbox whose options are also nodes in an SVG
diagram, which meant hand-authoring the ARIA relationships either way.

So the file was deleted and the dependency removed. A dependency carried for components
nobody imports is worse than no dependency: it invites the next contributor to reach for
a `Dialog` where the page needs a route.

### 6.2 Four component-level defects worth recording

Found in review; each one is a general trap.

**`inline-flex` defeats `break-all`.** A flex container's min-content width is the sum of
its items' min-content widths, and an item does not break to satisfy the container. A
long repository path inside an `inline-flex` chip forced the page wider than the viewport
even with `break-all` on the text. Fixed with `flex-wrap` plus `min-w-0`, and
`CodeLabel` became `inline` rather than `inline-flex`.

**`overflow-wrap: break-word` does not reduce min-content width.** It lets a long word
break only after layout has already reserved room for it. `anywhere` reduces min-content
too, which is the property that actually stops the overflow, and it still breaks only
when a word genuinely cannot fit. The site sets `overflow-wrap: anywhere` on `body`. The
symptom: the Gate 2 evidence text set a 503px floor on a 320px viewport.

**Tailwind's `sr-only` sets `white-space: nowrap` on a 1px box**, giving it a very wide
scroll extent that Chromium propagates up through every `overflow: visible` ancestor.
Every source link on this site announces a full repository path to a screen reader, so
several pages measured 523px wide at a 375px viewport while being visually correct — and
`document.scrollWidth` therefore lies, which makes every automated overflow check
unusable. `globals.css` redefines `@utility sr-only` without `nowrap` and with
`clip-path` rather than the deprecated `clip`. Everything else is the standard
visually-hidden recipe.

Two earlier attempts failed instructively: a `@layer base` override lost the cascade to
Tailwind's own utility layer, and an unlayered rule made Tailwind skip emitting its
definition in a way that depended on declaration order. `@utility` _replaces_ the
built-in, which is why the whole declaration set is restated there.

**A wrapper that does not spread `...rest` swallows ARIA.** `Card` dropped an
`aria-live` passed by a caller, silently. Every primitive now spreads its remaining
props.

### 6.3 The control vocabulary

Every colour, radius and duration on this site is measured and enforced, and then the
two surfaces a visitor actually touches, the inventory explorer and the KPI catalogue,
handed their appearance to the browser. A native select draws its own chevron, its own
padding and its own text metrics from the operating system, so the explorers rendered in
a vocabulary the rest of the site does not use. That is the largest single reason those
pages read as an internal admin tool rather than as an instrument.

`src/components/ui/control.tsx` is the answer, and it is one shared box rather than one
styled element per call site.

**The box.** `min-h-touch`, `appearance-none`, `rounded-md`, `border-line` on
`bg-canvas`, `hover:border-line-strong`, `focus:border-accent-muted`, and a
`transition-[border-color,box-shadow]` at `--arpi-motion-fast`. A select, a number input
and a search field are therefore the same object at the same height.

**The radius is one step below the panel that contains it.** Controls are `radius-md`
where the filter rails around them are `radius-lg`, so a control never reads as a card.
The rails themselves moved from `rounded-xl border-line` on a half-opacity ground to
`rounded-lg border-line-subtle` on a solid `surface-sunken`: filters and results were two
bordered boxes of the same value stacked on each other, so the page had no peak.

**The label is monospaced, uppercase, `text-xs`, `tracking-wide`.** Not `tracking-eyebrow`
(0.16em pushes "Model year" onto a second line at 375px with four labels to a row) and not
`text-2xs` (that step is reserved for alignment marks and axis labels, and uppercase
monospace already costs legibility). The change is the face, not the scale.

**A control carrying a value is marked twice.** A 2px inset rule down its leading edge
(`shadow-[inset_2px_0_0_0_var(--color-accent)]` plus `border-accent-muted`) and a small
square beside its label. Two marks rather than one, because colour is never the only
carrier of state here, and a 2px rule survives 200% zoom where a small square is easy to
miss. A select sitting on its "all" value is filtering nothing and is not marked; the sort
select has no "all" value, so it is never marked, because a mark that is always lit
reports nothing.

**Semantics are the caller's and are never traded for appearance.** A `<select>` stays a
`<select>` and its chevron is `pointer-events-none`, so the whole box remains the native
hit area and the native listbox still opens, which on a phone is the operating system
picker. There is no custom listbox. Search stays `type="search"`, the range bounds stay
`type="number"`, and every control keeps the 44px floor.

**The rule: no component styles a form control directly.** Anything that needs a labelled
input composes `Field`, `ControlLabel`, `ControlHint`, `SelectControl` and `TextControl`.
None of them declares a focus ring, because `globals.css` already gives every focusable
element the same `outline` and a second one draws two.

---

## 7. Focus, targets and interaction

One focus ring for everything: `2px solid var(--arpi-colour-focus)` at `outline-offset:
2px`. Drawn with `outline`, not `box-shadow`, so it survives a clipped ancestor.
`:focus:not(:focus-visible)` suppresses it for pointer interaction only; a keyboard
always sees it.

WCAG 2.2 SC 2.5.8 sets a 24×24px floor for pointer targets. `SourceLink` failed it at
17.8px and, once padded, failed again at 23.6px because the padding was asymmetric. It
now carries `min-h-6 py-0.5`. `tests/e2e/accessibility.spec.ts` measures every
interactive element's bounding box rather than trusting the class list.

Text opacity is not used anywhere. An `opacity-70` on already-faint text produced a
3.13:1 measured ratio, and opacity is invisible to a contrast checker reading token
values. Faintness is a colour token or it is nothing.

---

## 8. Brand assets

All authored in this repository. No manufacturer logo, no dealership logo, no
copyrighted vehicle photography, no certification badge, no borrowed mark.

**Monogram** — a 3×3 lattice of nodes with an "A" traced through it as a signal path. It
reads as a data structure at 512px and as a mark at 16px, which is the only real test.

**Wordmark** — `ARPI` in Space Grotesk with the lattice as a leading glyph.

Shipped as `public/favicon.svg`, `public/brand/monogram.svg`,
`public/brand/wordmark.svg`, `public/brand/social-preview.svg`, plus three rasters
rendered from those SVGs by `npm run assets`: `favicon-32.png`,
`apple-touch-icon.png`, and `social-preview.png` at 1200×630.

The social preview carries the project name, the one-line description and the synthetic-
data disclosure. A share card that omitted the disclosure would be the one surface where
the site implied real dealership data.

---

## 9. What is enforced where

| Rule                                                       | Enforced by                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| No colour outside the palette                              | `@theme` reset — a build error                                    |
| Token bridge resolves to real values                       | `tests/e2e/design-system.spec.ts` (computed values, real browser) |
| No layout token shadows a Tailwind keyword                 | `tests/unit/tokens.test.ts`                                       |
| Breakpoints agree between `tokens.css` and `theme.css`     | `tests/unit/tokens.test.ts`                                       |
| Motion scales agree between CSS and JS                     | `tests/unit/motion.test.ts`                                       |
| Route metadata cannot drift from nav, sitemap, breadcrumbs | `tests/unit/site.test.ts`                                         |
| Status is never colour-only                                | `tests/e2e/accessibility.spec.ts`                                 |
| Contrast, target size, heading order, landmarks            | axe-core, all ten routes, two viewports                           |
| No horizontal overflow at 320px or 200% zoom               | `tests/e2e/accessibility.spec.ts` (real scrollability)            |
| Every primitive forwards ARIA props                        | `tests/unit/components.test.tsx`                                  |

## `DASH.10`: what it added to the shared surface, and what it deliberately did not

**No new reusable primitive.** The leads and marketing route draws four kinds of bar — funnel
stage, response band, lost stage, source volume — and every one of them is a governed ratio
rendered as a width. That is the same geometry `visuals.tsx` already holds primitives for, and
the temptation was to extract a fifth. It was not taken, because the four differ in the thing
that matters: **what each width divides by**. The funnel divides by the cohort, the bands divide
by responded leads, the stage partition divides by the cohort again, and the source bars divide
by the largest source in scope. A shared `<Bar>` would have made those four denominators a
prop, and a denominator passed as a prop is a denominator nobody checks.

So the route composes the two primitives whose semantics genuinely are shared — `ChartFrame`
(figure, figcaption, summary sentence) and `TableDisclosure` (the tabular equivalent) — and
keeps a local `Track` that takes an already-computed width string. Shared geometry is good;
shared false semantics are not.

**One shared component changed: `FilterBar` gained an optional `campaigns` prop.** It is
optional, unlike the four lists above it, and the asymmetry is the point. Only
`/dashboard/leads-marketing` carries datasets grained on campaign; every other console route
declares `campaign` as `not-applicable`, and rendering a control that cannot change a figure is
how a filter bar starts lying about what it reaches. A route that passes nothing gets no
control rather than an inert one. The compressed island size did not move.

**One shared component gained a link: `LeadFunnel` now takes `filters`** so the Executive
drill-through arrives scoped to what the reader was looking at. That is the whole of `DASH.10`'s
change to the Executive Overview, which `PR #52` had just redesigned.

## Employee role marks (`DASH.11`)

Four stable categorical marks from the existing `data-*` palette, one per employee role family:

| Role family     | Token               |
| --------------- | ------------------- |
| Salesperson     | `bg-data-primary`   |
| Desk Management | `bg-data-secondary` |
| Finance         | `bg-data-tertiary`  |
| BDC             | `bg-data-neutral`   |

**IDENTITY, NEVER EVALUATION**, and the distinction is the whole reason to write them down. The
mark tells a reader which operating surface they are on. It does not order the families, it does not
say one is better than another, and it moves with the family rather than with a figure. The families
are not comparable with each other at all — different opportunities, different governed denominators
— so a palette that implied a sequence would be making a claim the data cannot support.

**Derived from the family, not from the row's position**, for the same reason `storeMarkClass` is
derived from the business code: a family filtered out of view would otherwise shift the colour of
every family after it.

**No `data-positive` or `data-negative` appears on the employee route.** ARPI publishes no employee
benchmark, so there is no threshold for a colour to encode, and a green or red employee figure would
be a judgement the model does not support. `dashboard-employees.test.ts` asserts the component
contains neither token and no bare `green`/`red`/`emerald`/`rose` utility.

**One attention state is permitted**, and only for `insufficient sample`: `text-data-warning`. It is a
PUBLICATION state — the project declining to print a ratio over a denominator this small — and not a
verdict about a person. It always appears with the words "Insufficient sample" and the count that
caused it, so the colour is never the only carrier of the meaning.

## The operating shell (`UX.1`)

`UX.1` split the site into two information domains with different chrome, and the
design system gained one token and two components for it. Nothing was retired from
the system itself: the token bridge, the grounds, the type pairing and the
component inventory above are unchanged, and the operating shell is composed from
them.

### The rail token

| Token              | Value              | Where                                                          |
| ------------------ | ------------------ | -------------------------------------------------------------- |
| `--arpi-size-rail` | `14.5rem` (232 px) | `tokens.css`, bridged as `--spacing-rail`, used as `lg:w-rail` |

232 px is the width at which the widest of the eight destination labels — "Leads &
Marketing" — fits on one line at the base type size, measured rather than chosen.
Below the `lg` breakpoint the token is unused: the rail is not rendered there at
all, and the navigation is a drawer.

### Two shells, and the rule for deciding which a route wears

| Domain    | Chrome                                                                                                                  | Routes                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Operating | `components/shell/operating-rail.tsx` — left rail at `lg`, compact app bar and drawer below it. No masthead, no footer. | `/` and the seven `/dashboard/*` surfaces                                  |
| Reference | `components/shell/site-header.tsx` + `site-footer.tsx` — masthead of three items, full footer index                     | `/technical`, `/about`, `/inventory`, the three store pages, `/case-study` |

Declared by route group — `app/(operating)/layout.tsx` and `app/(site)/layout.tsx`
— rather than by a prop, so a route cannot accidentally wear both or neither.

### The control band

`components/dashboard/operating-page-header.tsx` is the operating equivalent of
`<PageHeader>`, and it is deliberately smaller:

| `<PageHeader>` (reference)           | `<OperatingPageHeader>` (operating)                          |
| ------------------------------------ | ------------------------------------------------------------ |
| Breadcrumb                           | — the application is flat and the rail marks the destination |
| Eyebrow                              | —                                                            |
| Sentence-length `h1`                 | The route's NAME: "Executive", "Inventory"                   |
| Lede + optional supporting paragraph | One line of analytical scope in business words               |
| Status badges                        | Inside the methodology disclosure                            |
| `<TrustLine>`                        | The compact demo statement, in the disclosure's own summary  |
| —                                    | The route's filter controls                                  |

**The rule the split encodes: a caveat is visible, a mechanism is disclosed.** A
project-default threshold, a cohort basis, a denominator that is not the obvious
one and a statement that a figure is not a valuation all stay on the page. How an
order statistic is computed, at which grain the export publishes it and which
version produced it move into `components/dashboard/methodology.tsx`, which is a
`<details>` for the same reasons every chart's data table is one.

### Colour

Unchanged. `UX.1` added no colour token, no domain palette and no new semantic
use. The `zone-*` washes introduced by the executive visual pass still encode a
business area and never a state; the categorical store marks are still derived
from the business code rather than from row position; and green and red still mark
only the three governed cases — which side of zero a value falls, whether an
explicit target was met, and how old a unit is.

---

## The Action Center (`DASH.12`)

**No new primitive.** The queue is built from `Card`, `Badge`, `Disclosure`, `Cluster`, `Stack`
and `Text` exactly as they were. An action card is a composition, not a component the system
needed to grow.

**Severity borrows tone, not meaning.** `failed`, `pending` and `neutral` carry the visual
weight of the three levels. They are borrowed for weight alone: a high-severity action is not
a failure, and the WORD beside the colour is what carries the meaning. Never colour alone.

**A facet is a link that looks like a chip.** Selected state is `aria-current` plus the accent
wash; unselected is the line border on surface. It is a navigation, and it is styled to look
like one a reader can bookmark rather than like a toggle that holds session state.

**It must not read as a task manager.** No checkbox, no status pill, no assignee avatar, no due
date, no progress bar. Those are the vocabulary of a system that remembers what you did, and
this one cannot. The queue is analytical evidence with a drill-through, and the visual language
says so.

**Evidence is formatted, never converted.** An exact value crosses the boundary as a string and
is parsed into the console's own exact representation before rendering at a sane precision. A
bridge effect published as `-14067.506129032258` is the exact quotient; twelve decimal places of
a dollar figure is noise, and the underlying value is unchanged.

### 6.0f `UX.2B.1`: a module is the layout reference for its own contents

`Module` carries `@container`, and the section grids inside it ask `@sm:` / `@xl:` rather than
`sm:` / `lg:`.

The defect that forced it is worth stating plainly, because it is the kind that survives review.
The section components were written when each was a full-width band, so their fact grids ask for
four columns at the `lg` **viewport** width. A three-of-twelve module on a 1440 px screen is
about 300 px wide **and still satisfies `lg`** — the media query is asking about the window, and
the window is wide. The result on the Deal Jacket was four ~70 px columns, and a money value
broken across lines: `AMOUNT FINANCED` rendered as "$21,358." above "02".

A container query asks how wide **this panel** is, which is the only question a module's contents
can usefully ask. Measured across the five operating routes, mid-word breaks on the Deal Jacket
fell from 14 to 2; the two that remain are table headers about 7 px short of their columns and
predate the change.

`GridRow` gained `align`. `stretch` remains the default and is usually right — modules answering
sibling questions read as one band when their panels line up. `start` exists for the case where
the difference is not 40 px: a five-bar waterfall beside a module with its own disclosures is a
350 px panel next to a 750 px one, and stretching draws 400 px of empty bordered box under the
waterfall. An empty panel is not neutral; a reader looks into it for the thing that is missing.

**No chart library was added.** The question was not reopened: nothing in this increment
introduces a continuous scale, a computed axis or a layout algorithm, which are the three
conditions §6.0c records. Two static end labels under a column field are not an axis.

---

## The operating control band (`UX.2D`)

### The three tiers, and the line between them

Every operating route's opening `<section>` is one component,
`components/dashboard/operating-controls.tsx`, rendered by `OperatingPageHeader`:

| Tier                  | Always visible | Contents                                                                                |
| --------------------- | -------------- | --------------------------------------------------------------------------------------- |
| Scope                 | yes            | the route name, an optional subtitle, and the analytical scope in business words        |
| Active-filter summary | yes            | one removable chip per set parameter, and a reset — absent entirely when nothing is set |
| Controls              | on desktop     | the filter form and any control form the route owns                                     |

**What stays outside the third tier is the design decision, not what goes in.** Anything a reader
must SEE to interpret a figure stays visible: the export-staleness banner, the reconciliation
banner, the reset and period notices, the Inventory aged-threshold and market-estimate caveats, the
F&I synthetic-lender statement. So does anything that is navigation rather than filtering — the
Employees role switch, because four role families are four views of the route and a reader on a
phone must be able to see which one they are on without opening anything.

### The responsive mechanism

The controls sit in a native `<details data-operating-controls>`. `globals.css` carries two rules:

```css
@supports selector(::details-content) {
  @media (width >= 48rem) {
    [data-operating-controls] > summary {
      display: none;
    }
    [data-operating-controls]::details-content {
      content-visibility: visible;
      block-size: auto;
    }
  }
}
```

`::details-content` is the only way CSS can reveal a closed disclosure — `open` is an attribute and
a stylesheet cannot set one — and this file already uses the same technique to open every disclosure
for print. **The consequence is that the responsive behaviour needs no JavaScript, no viewport
measurement and no client island**: a phone gets a real disclosure that toggles natively and
announces its own state, and a desktop gets the controls with no disclosure at all.

**The `@supports` guard is load-bearing.** Without it, an engine lacking the pseudo-element would
apply `display: none` to the summary and still hide the content, and the controls would be
unreachable. Guarded, the fallback on such an engine is the phone behaviour at every width.

### Measured

At 390 × 844 the band was 548–921 px before `UX.2D` and is 201–439 px after. At 1440 × 900 it was
230–494 px and is 200–486 px — the desktop band was already close to right, and the job there was to
stop it drifting. `tests/e2e/ux2d-controls.spec.ts` holds a 470 px ceiling at 390 and a 520 px
ceiling at 1440, both stated with the headroom they leave.

### The analytical-scope vocabulary

`lib/dashboard/scope.ts`. `storeScopeLabel` maps selected store identifiers onto the labels the
store dimension publishes: `All three stores` for the whole group, the store's short name for one,
a comma list for two. **A warehouse key is never a scope label.** Five routes were printing
`GSA-002` and four spelled the group four different ways before this module existed.

**No chart library was added.** The question was not reopened: `UX.2D` introduced no visual
primitive at all, and §6.0c's three conditions — a continuous scale, a computed axis, a layout
algorithm — are the only grounds for reopening it.

---

## `UX.2D.1`: the declaration is the control surface

`UX.2D` rebuilt the control band and asserted it thoroughly. A second pass over the same surface
found five defects its measurements were not shaped to see, because **none of them is a
measurement** — each is correct-looking markup. Recorded in
[`UX-2D-1-CONTROL-TRUTH.md`](../../docs/reviews/UX-2D-1-CONTROL-TRUTH.md); two of them change a rule
in this document.

### A control exists only where the route declares the parameter applies

`filters.ts` declares, per route, what each of the thirteen URL parameters can honestly do there.
That declaration drives three things and must drive all three, or they disagree:

| Reads the declaration | To decide                                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| `<FilterBar>`         | whether to render a control at all                                         |
| `ActiveFilterSummary` | how to label a parameter carrying a value, and whether to state its reason |
| `navigation.ts`       | whether to carry the parameter across a link                               |

Before `UX.2D.1` only the second and third read it. Seven of the nine operating routes therefore
offered at least one control the route itself declares inert, and `/dashboard/employees` offered a
control it declares `partial` with an empty option list.

The doctrine was not new — the `campaigns` prop has said since `DASH.10` that _"a route that passes
nothing gets no control rather than an inert one"_ — it had simply been applied to one parameter.
`support` is a required prop now, and the rule is: render a control when the declaration says the
parameter means something here **and** an option list exists for it.

**A hint beginning "Not applied" under a control a reader can operate is the signature of the
defect, and no such hint may exist.** The reason it used to carry lives in the support matrix and is
rendered by the active-filter summary when the parameter actually arrives in the URL — which is the
only moment a reader needs it, and the moment a hint under a permanently-empty select could never
reach, because a filter carried in by the rail does not touch the destination's form.

### A figure is one token

`body` sets `overflow-wrap: anywhere`, and that is correct: this site puts 68-character
schema-qualified identifiers inside prose, and only `anywhere` reduces min-content width enough to
stop one forcing a 320 px viewport sideways. It is wrong for money, because `anywhere` breaks a word
at any character once the line is full.

`UX.2B.1` saw the symptom on the Deal Jacket (`$21,358.` above `02`) and treated it with container
queries, which fixed that panel's width without fixing the rule. 35 money values across five routes
were still breaking after `UX.2D`: in a 66 px price cell `$38,127` renders as `$38,12` above a lone
`7` — not clipped, not ellipsised, silently rewritten into a different, smaller-looking number.

The `numeric` utility sets `overflow-wrap: normal` and `word-break: normal`, under which UAX #14
treats a currency prefix, its digits and its group separators as one unbreakable run. It cannot
reintroduce page overflow: these are short tokens in table cells, and every wide table already sits
in a keyboard-reachable `overflow-x: auto` region.

### One methodology vocabulary, and one verb

`components/dashboard/methodology.tsx` — created by `UX.1` to be the console's one methodology
interaction — had **zero rendered usages**, ever. All 32 sites use `components/ui/disclosure.tsx`,
which already _was_ the one pattern; the dead module is removed rather than adopted.

Statement form throughout, and **measured** rather than _calculated_:

| Was                                             | Is                                             |
| ----------------------------------------------- | ---------------------------------------------- |
| `How is this calculated?`                       | `How this is measured`                         |
| `How every figure on this rail is calculated`   | `How every figure on this rail is measured`    |
| `How {metric} against plan is calculated`       | `How {metric} against plan is measured`        |
| `What can I put in the URL?`                    | `What the URL accepts`                         |
| `Which reporting views produced these figures?` | `Which reporting views produced these figures` |
| `What are the known limits of this data?`       | `The known limits of this data`                |

The distinction between "this metric" and "every figure on this rail" is kept: it is a real
difference in what opening the disclosure gives you.

### Two rules for anything the view renders from a list

Both of the remaining defects are the same mistake in different files, and the rule is worth stating
once.

**A view that describes data must read that data.** The rail printed `Not built yet · Actions ·
DASH.12` above a live `Actions` link for four increments. `PLANNED_DASHBOARD_SECTIONS` had been
correctly emptied by `DASH.12` and `site.test.ts` guards it against outliving the work it describes —
but the block was a hard-coded copy of the list's last entry, so the guard protected a value nothing
displayed.

**A `<select>` whose value can be the empty string must offer the empty string.** Absent `period`
means "the latest full month the dataset holds"; a `<select>` with no `''` option falls back to
rendering its first, so seven of eight routes opened reading `July 2025` above a page reporting
December. The default entry is rendered by `FilterBar` itself now, so no route can forget it and none
can render it twice.
