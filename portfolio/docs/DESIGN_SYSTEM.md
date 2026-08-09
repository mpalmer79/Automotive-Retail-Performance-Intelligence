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
| Emerald | verified pass states                | `600 #0f7a46`, `100 #e2f4ea`                                              |
| Rose    | genuine failure                     | `600 #b3253c`, `100 #fbe6ea`                                              |

The text is not pure black. `#16202a` is very slightly blue so it reads as ink rather
than as a hard edge, which pure black produces against white at body sizes.

**Every pairing here is measured, and four of the direction's starting values failed.**
`ink-muted` at `#6E7A83` measured 4.40:1 on white; `ink-faint` at `#87939B` measured
3.15:1 and is not usable for text at all; the accent at `#087FA4` measured 4.58:1 on
**pure** white and 4.37:1 on the soft canvas, so it passed on one surface and failed on
the next one down; and the field's top stop at `#4FA9D3` left the white canvas edge at
2.64:1 against it. Each is corrected, and `tests/unit/tokens.test.ts` asserts every text
token against **all four** white grounds rather than against the lightest one — because a
colour is not accessible on its own, only on a ground.

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
