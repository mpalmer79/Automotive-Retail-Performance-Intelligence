# ARPI design system

The visual language of the ARPI portfolio website, and the rules that keep it one
language rather than nine.

Nothing here is aspiration. Every rule in this document is enforced by a token file, a
lint rule, a unit test or a browser assertion, and where it is enforced is named.

---

## 1. The register

The site has one job: make a stranger believe that the numbers behind it are governed.
That belief is won or lost in the first two seconds, before a word is read, so the
surface has to look like an instrument rather than like marketing.

The reference point is **technical instrumentation** — an aircraft panel, a
laboratory readout, an engineering drawing. Deep near-black grounds, hairline rules with
alignment ticks, monospaced identifiers, a single signal colour used sparingly, and
generous space. Precision, not excitement.

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

| Ramp     | Role                             | Steps                                                                     |
| -------- | -------------------------------- | ------------------------------------------------------------------------- |
| Obsidian | the page ground                  | `950 #05070b`, `900 #080b11`, `850 #0b0f16`                               |
| Graphite | elevated surfaces, borders       | `800 #10151e` … `500 #2f3a4d`                                             |
| Steel    | rules, muted text                | `500 #47556b`, `400 #7887a8`, `300 #8b99b3`, `200 #b3bfd4`, `100 #d6deea` |
| Clarity  | highest-contrast text            | `#f2f6fc`                                                                 |
| Cyan     | the signal colour                | `200 #9decf7` … `900 #06323d`                                             |
| Amber    | attention, pending, blocked      | `200 #fcdfa4` … `900 #3d2a05`                                             |
| Violet   | semantic model and relationships | `200 #cfc4fb` … `900 #241a4a`                                             |
| Emerald  | verified pass states             | `200 #a6ebc4` … `900 #06301e`                                             |
| Rose     | genuine failure                  | `200 #f8c0c6` … `900 #3d0d16`                                             |

The ground is not pure black and the text is not pure white. `#05070b` is very slightly
blue so it reads as instrument housing rather than as void, and `#f2f6fc` avoids the
halation pure white produces at display sizes on a near-black ground.

**`steel-400` is pinned to a measurement, not chosen by eye.** Its first value,
`#64748f`, measured 4.26:1 on the canvas and 3.68:1 on `surface-raised` — both below the
4.5:1 floor — and axe-core flagged it on all nine routes. `#7887a8` measures 5.60:1 on
the canvas and 4.84:1 on the lightest surface the site uses, so it passes everywhere text
can sit. Anything fainter is decorative only: `steel-500` appears in borders and in the
grid motif at 5.5% opacity, where the 3:1 non-text threshold applies.

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

| Family         | Author           | Source                                          |
| -------------- | ---------------- | ----------------------------------------------- |
| Inter          | Rasmus Andersson | https://github.com/rsms/inter                   |
| Space Grotesk  | Florian Karsten  | https://github.com/floriankarsten/space-grotesk |
| JetBrains Mono | JetBrains s.r.o. | https://github.com/JetBrains/JetBrainsMono      |

`next/font/local` emits a metric-matched fallback face, so the swap produces no layout
shift.

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

**Elevation on a dark ground is a lightening border plus a contained shadow, not a large
soft drop shadow.** A big soft shadow on near-black reads as a smudge. Each raised
surface also carries `--arpi-shadow-inset-top` — one pixel of light on the top edge —
which is how a physical instrument panel catches light.

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

**Status** — `Badge`, `StatusBadge`, `KpiChip`

**Surfaces** — `Card` (static), `InteractiveCard`

**Evidence** — `SourceLink`, `SourceList`, `DefinitionList`, `DataCard`, `EvidenceItem`,
`MetricCount`

**States** — `EmptyState`, `LockedState`, `SkipLink`, `Breadcrumbs`

**Motion** — `Reveal`, `RevealGroup`, `RevealItem` (CSS), `MotionBoundary`,
`AnimatedCount`

**Brand** — `Monogram`, `Wordmark`

**Explorers** — `ArchitectureExplorer`, `DataModelExplorer`, `KpiCatalogue`

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
| Contrast, target size, heading order, landmarks            | axe-core, all nine routes, two viewports                          |
| No horizontal overflow at 320px or 200% zoom               | `tests/e2e/accessibility.spec.ts` (real scrollability)            |
| Every primitive forwards ARIA props                        | `tests/unit/components.test.tsx`                                  |
