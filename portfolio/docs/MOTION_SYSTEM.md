# ARPI motion system

Motion on this site has one purpose: to make structure legible. A pipeline that draws
itself in flow order teaches the flow order. A count that resolves signals that the
number was computed rather than typed. A panel that opens in place says _this is the same
object, expanded_.

Motion that does none of those things is removed, not tuned.

---

> **Experience redesign, version 2.** This document describes the system as it
> stands after the redesign recorded in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md`.
> That document holds the baseline it replaced, the severity-ranked findings, the
> decisions and their rejected alternatives, three adversarial review passes and
> the measured results. Where a rule below reads as unusually specific, the reason
> is almost always a finding recorded there.

**The home page no longer loads the animation library.** Both of its former
entries are gone: the hero's drawn diagram is now a server component whose motion
is CSS on SVG attributes, and the scrollytelling walkthrough was replaced by a
five-stage section with no JavaScript animation. That removed 42.7 kB of route
JavaScript from the site's most-visited page, and it removed the defect the
scrollytelling diagram carried - it animated `width` on an element that also
declared `width` as an attribute, throwing `Expected length, "undefined"` eight
times per render.

**Two ambient animations were deleted.** `pulse-signal` and `drift` both looped
indefinitely, neither was referenced by any component, and neither had a
narrative role. Every animation on the site now runs a finite number of times.

**The signature motion.** One signal travels from the source systems, through the
governed layers, to the analytical domains, once, and stops. Under reduced motion
it is removed rather than frozen: a dash that does not travel is a stray mark on
a diagram, and the paths it travels stay drawn, so the composition still reads.

## 1. The four rules

**1. Motion must carry information.** If the animation could be deleted and the reader
would learn exactly the same thing, delete it.

**2. Motion must never gate content.** Nothing on this site waits for an animation to
finish before becoming readable, and nothing becomes unreadable if the animation never
runs. The `<noscript>` fallback in section 8 exists because that rule was broken once.

**3. Reduced motion renders the end state.** Not less motion — no motion, with the
information intact. The substitution table is section 9.

**4. Every animated value comes from the token scale.** A duration or easing invented at a
call site is a defect, and `tests/unit/motion.test.ts` asserts that the CSS scale in
`tokens.css` and the JavaScript scale in `src/lib/motion.ts` agree value for value.

What is banned outright: scroll hijacking, a custom cursor, parallax on text, autoplay
video, background audio, and anything that moves without being asked to for longer than
the ambient duration.

---

## 2. Scales

### Duration

| Token        | Value | For                                           |
| ------------ | ----- | --------------------------------------------- |
| `instant`    | 80ms  | press feedback                                |
| `fast`       | 140ms | hover, colour change                          |
| `base`       | 220ms | panel open, tab change, small position change |
| `slow`       | 380ms | section reveal                                |
| `slower`     | 620ms | large-surface transition                      |
| `deliberate` | 900ms | the drawn pipeline                            |
| `signal`     | 2.6s  | one dash travelling a path, once              |
| `ambient`    | 14s   | nothing, currently                            |

The scale stops at 900ms for anything a reader triggers. `signal` is longer because it is
not a response to an action: it is a path being traced once, on arrival.

`ambient` is **declared and unused**, and that is deliberate rather than an oversight. It
was the duration of a looping pulse on the hero diagram, and the loop was deleted because
an animation with no end and no meaning is a repaint that never stops. The token stays so
the constraint it encodes - "if something ever is genuinely ambient, this is how slow it
has to be" - is recorded rather than re-derived, and `tests/unit/tokens.test.ts` keeps the
CSS and JavaScript scales agreeing about it either way.

### Easing

| Token      | Curve                            | For                                                                |
| ---------- | -------------------------------- | ------------------------------------------------------------------ |
| `standard` | `cubic-bezier(0.32, 0.72, 0, 1)` | the default — fast start, long settle, reads as weight without lag |
| `out`      | `cubic-bezier(0.16, 1, 0.3, 1)`  | entrances; almost all travel happens in the first third            |
| `in`       | `cubic-bezier(0.55, 0, 1, 0.45)` | exits, where the element should commit to leaving                  |
| `linear`   | —                                | the ambient pulse only, where any curve reads as a heartbeat       |

No `ease-in-out` on anything a reader triggers. A symmetric curve on an entrance makes the
element look like it is deciding.

### Distance

`xs 4px`, `sm 8px`, `md 16px`, `lg 28px`.

Kept small deliberately. A long travel reads as a slideshow, not as a document. The
section reveal uses `md`; an item inside an already-revealing group uses `sm`, because the
surrounding rhythm is already carrying the eye.

### Stagger

**55ms** per sibling. Long enough to read as a sequence, short enough that the last of six
cards is not still arriving a third of a second after the first — which is the point at
which a stagger stops guiding the eye and starts making the reader wait.

### Springs

Two, used for three things.

`SPRING` — `stiffness 320, damping 34, mass 0.8` — pointer-following and the architecture
explorer's selection ring. A spring rather than a duration because **the target moves
while the animation runs**, and a duration-based tween restarts on every change.

`SPRING_SOFT` — `stiffness 180, damping 26, mass 1` — larger surfaces, where the stiff one
reads as a snap.

---

## 3. The motion budget, and where the library ships

The site's most common motion is the section reveal: fade and rise sixteen pixels, once,
on entering the viewport. It appears on **six of the eight routes**.

It was originally implemented with the animation library. That meant the library — roughly
70 kB gzipped — shipped to all six routes **to move an element sixteen pixels**.

It is now two CSS declarations and a class toggle driven by one `IntersectionObserver`.
The animation library loads on **three routes only**, for the three animations that
genuinely need a JavaScript animator:

| Route           | What needs the library                                                   |
| --------------- | ------------------------------------------------------------------------ |
| `/architecture` | the explorer's node emphasis, driven by a spring against a moving target |
| `/data-model`   | the same                                                                 |

**`/` is no longer on this list.** Both of its entries were removed: the hero's diagram
became a server component whose motion is CSS on SVG attributes, and the scrollytelling
walkthrough was deleted outright. The home page has since grown three tab sets, a lineage
rail and a live inventory surface, and none of them re-imported it - every one of those
animations is a CSS keyframe from the token scale.
`tests/unit/motion.test.ts` asserts the list above is exactly two files, so the next reveal
added to this site cannot quietly put it back.

That is what a motion budget is for: spending the weight where the movement carries
meaning, and not where it is decoration. Measured before and after figures are in
[PERFORMANCE.md](PERFORMANCE.md) section 4.

A related, smaller decision: `AnimatedCount` uses a plain `IntersectionObserver` rather
than the library's `useInView` hook. Importing that hook pulled the whole library into the
home page's bundle for a visibility check that is nine lines of standard DOM API — and the
home page is the one route where every kilobyte is paid before a visitor has decided to
stay.

`src/lib/motion.ts` documents this in place, so the next person to add a reveal finds the
reasoning before they add the import:

> The section reveal is NOT here. […] Keeping it out of the animation library is what lets
> that library ship only to the three routes whose motion genuinely needs it.

---

## 4. The reveal, in CSS

```css
@utility reveal-hidden {
  opacity: 0;
  transform: translate3d(0, 16px, 0);
}
@utility reveal-hidden-child {
  opacity: 0;
  transform: translate3d(0, 8px, 0);
}
@utility reveal-shown {
  opacity: 1;
  transform: none;
}
@utility reveal-transition {
  transition:
    opacity var(--arpi-motion-slow) var(--arpi-ease-out),
    transform var(--arpi-motion-slow) var(--arpi-ease-out);
  will-change: opacity, transform;
}
```

Only `opacity` and `transform` are animated, so every reveal on the page runs on the
compositor and never triggers layout.

`will-change` is set on the transition utility and dropped by `reveal-shown`. A permanent
`will-change` on six sections' worth of elements costs memory for no gain once they have
arrived.

`rootMargin: '0px 0px -12% 0px'` shrinks the trigger band from the bottom by 12% of the
viewport, so the reveal starts slightly before the element's top edge reaches the fold and
has finished by the time the reader's eye arrives. The observer disconnects the moment it
fires, so nothing keeps running behind the page.

`RevealGroup` puts all its children on **one** observer and sets the per-index delay
through a CSS custom property the child rule multiplies. One observer rather than one per
child is what makes the stagger a sequence rather than a function of scroll speed. The
index is passed explicitly rather than inferred, because inferring it would require
cloning children, and that breaks any child that is itself a component.

---

## 5. Named transitions

| Name     | Duration   | Easing   | Where                                |
| -------- | ---------- | -------- | ------------------------------------ |
| `hover`  | fast       | standard | every interactive surface            |
| `press`  | instant    | standard | buttons                              |
| `reveal` | slow       | out      | the section reveal                   |
| `panel`  | base       | standard | explorer detail panels, filter trays |
| `draw`   | deliberate | out      | the hero and pipeline SVG paths      |
| `route`  | base       | out      | route-level transitions              |

---

## 6. The inventory

Every animation on the site. If it is not here, it does not exist.

| #   | Animation               | Implementation                   | Duration              | Carries                                          |
| --- | ----------------------- | -------------------------------- | --------------------- | ------------------------------------------------ |
| 1   | Section reveal          | CSS + observer                   | slow                  | reading order and section boundaries             |
| 2   | Group stagger           | CSS + one observer               | slow, 55ms offsets    | that these items are peers in a sequence         |
| 3   | Signature signal run    | CSS keyframes, SVG dash offset   | signal, once          | the direction of data flow, source to governed   |
| 4   | Signature layer wake    | CSS keyframes, staggered         | slow, once            | a layer arriving as the signal reaches it        |
| 5   | Lineage rail wake       | CSS keyframes, staggered         | slow, 90ms offsets    | the path the hero's rows actually took           |
| 6   | Tab panel wake          | CSS keyframes, replayed by `key` | slow, once per change | that the selection changed what is on the screen |
| 7   | Explorer node selection | Motion spring                    | spring                | which node is selected, against a moving target  |
| 8   | Explorer detail panel   | CSS, `panel` variant             | base                  | that the panel is the selected node expanded     |
| 9   | Hover and press states  | CSS                              | fast / instant        | affordance                                       |
| 10  | Mobile drawer and scrim | CSS transform and opacity        | base                  | where the drawer came from                       |
| 11  | Focus ring              | none — instant                   | 0                     | never animated; a delayed focus ring is a bug    |
| 12  | Architecture arrival    | Motion `pathLength`, band order  | deliberate, once      | the direction of travel: generate → present      |
| 13  | Architecture flow wave  | Motion `pathLength`, hop order   | deliberate, per hop   | upstream resolving in, downstream leaving out    |

Number 11 is a rule, not an omission. A focus indicator that fades in is a focus
indicator that is briefly absent.

### Numbers 12 and 13, and why a highlight was not enough

Selecting a node in the architecture explorer used to animate one property:
opacity, to dim the nodes that were not on the path. That is a highlight, and a
highlight answers "which of these are related to this one".

It does not answer what the diagram is actually claiming. The layout is
left-to-right because the direction is the information — data is generated, then
persisted, then modelled, then presented — and a node's upstream is not the same
kind of thing as its downstream. Dimming says both are "related".

So two finite animations carry direction:

**12. Arrival.** Once, on mount, the built edges draw in band order: generate,
persist, model, present. It states the direction of travel one time and stops. It
never loops, it never replays when a selection is cleared, and it never gates the
controls — a node is selectable from the first frame, which is asserted.

**13. Selection.** The edges on the selected node's path redraw as a wave.
Upstream edges resolve **inward**, farthest hop first, so the flow arrives at the
node. Downstream edges leave **outward**, nearest first, so it departs. Every edge
draws along its own direction of travel, so "toward" and "away" are properties of
the drawing rather than a convention the reader has to be taught.

The hop ordering comes from `flowDistances` in `src/content/architecture.ts`,
which is breadth-first. Depth-first would record the length of whichever route it
happened to walk, and the graph has more than one route between some pairs —
`validation` reaches `reporting` through `csv` and through `audit` — so the wave
would draw in an order the data does not flow in.

**Planned edges never draw.** `pathLength` is implemented with the same two dash
properties that make an edge dashed, so the two cannot coexist; and animating
flow through a stage that has not been built would be the diagram asserting
something untrue for the sake of a transition. They render dashed and static.

What is deliberately absent: particles, arrows that travel continuously, any
loop, and any animation of all sixteen edges at once.

### What is not on this list, and used to be

Three animations were removed and have not come back. They are recorded here
because "it does not exist" is a claim a reader should be able to check against
the reason:

- **Ambient signal pulse**, a 14-second loop on the hero diagram. An animation
  with no end and no meaning is a repaint that never stops.
- **Counting numbers**, seven rAF interpolations on the home page. At the size
  the engineering proof now sets its four figures, the motion drew the eye to the
  movement rather than to the size, and it delayed the one thing the section is
  for.
- **Scrollytelling stage change**, eight `motion` width transitions. It
  duplicated `/architecture` and animated `width` on an element that also
  declared `width` as an attribute, which threw a console error eight times per
  render.

### Number 6, and the rule it is testing

The home page carries three tab sets: the hero's store switcher, the store
chapter, and the product tour. Each replays `wake` on its panel when the
selection changes, because the panel is the ANSWER to a control the reader just
operated, and an answer that appears with no transition reads as a page that
jumped rather than as a surface that responded.

It is `key` on the panel that replays it, and that attribute is doing two jobs.
The second one is the important one: `key` forces a remount rather than a
reconcile, which is what makes a screen reader announce the panel the reader just
chose instead of staying silent on a mutated one. The motion is a side effect of
an accessibility decision, not the reason for it.

---

## 7. Scroll behaviour

`scroll-behavior: smooth` is set **only** inside
`@media (prefers-reduced-motion: no-preference)`, so it is opt-in by user preference and
never forced.

`html { scroll-padding-top: calc(var(--arpi-size-header) + var(--arpi-space-6)) }` stops
anchor navigation landing a heading underneath the sticky header.

The scrollytelling section on the home page is **not** scroll-hijacked. The page scrolls
at the browser's speed; a sticky diagram observes which prose block is in view and changes
its own state. Scroll position is read, never written. A reader can flick past the whole
section at any speed and nothing fights them.

One consequence for tests: smooth scrolling broke the Playwright scroll-walks, which
issued a series of scrolls and measured after each. The tests now pass
`behavior: 'instant'` explicitly rather than the site disabling a feature real visitors
benefit from.

---

## 8. Motion must survive its own JavaScript failing

Two defects with the same symptom — content silently invisible — were found in the first
review pass. Both are worth stating as general traps.

**A reveal with no trigger.** An earlier revision gave `Reveal` a `child` mode that
omitted the viewport trigger and relied on variant propagation from a `RevealGroup`
parent. Used outside a group — which three sections did — the element had a hidden initial
state and nothing that would ever reveal it. The content never appeared at all.

Every `Reveal` now **always** carries its own observer. `child` selects a shorter travel
distance and nothing else. The prop cannot change how the reveal is triggered, because
that is the axis that failed.

**No JavaScript at all.** The hidden class ships in the server-rendered markup, so
`opacity: 0` is in the HTML. If the bundle fails to load — a blocked CDN, a JavaScript
error, a text-mode reader — every revealed section stays blank. Every revealed element
therefore carries `data-arpi-reveal`, and the root layout ships:

```html
<noscript>
  <style>
    [data-arpi-reveal] {
      opacity: 1 !important;
      transform: none !important;
    }
  </style>
</noscript>
```

A document must survive its own JavaScript failing. This one does: with scripting off,
every route renders complete, readable and navigable, minus the ten animations and the
two explorers' interactivity — and the explorers' underlying content is present as
structured markup either way.

---

## 9. Reduced motion

`prefers-reduced-motion: reduce` is honoured at two levels.

### The CSS floor

A site-wide block, deliberately blunt:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
  [data-arpi-draw] {
    stroke-dashoffset: 0 !important;
    stroke-dasharray: none !important;
  }
}
```

It catches every CSS transition and animation, **including any a future component forgets
to guard**. That is the point of making it blunt. A companion rule removes the reveal's
`transform` entirely, so the element appears in place rather than sliding one millisecond.

`[data-arpi-draw]` earns its `!important` twice over now. Motion implements
`pathLength` by writing `stroke-dasharray` and `stroke-dashoffset` as **inline**
styles, and an inline style loses to `!important`. So an architecture edge caught
mid-draw by a preference change — a reader toggling the system setting with the
page open — is forced to its completed state rather than stranded part-way along
a path, which would read as a broken diagram rather than a still one.

### A trap in testing this, found in this release

The reduced-motion suite emulates the preference two ways: `browser.newContext({
reducedMotion })` for the direct comparisons, and `test.use({ contextOptions: {
reducedMotion: 'reduce' } })` for whole describe blocks.

A block written as `test.use({ reducedMotion: 'reduce' })` — the bare fixture
rather than `contextOptions` — **does not take effect** in a nested describe under
this configuration. The failure mode is the expensive one: the tests run with
motion fully enabled and still pass every assertion that does not depend on it,
so the suite reports coverage of reduced motion that it does not have. Use
`contextOptions`.

`1ms` rather than `0s` because a zero-duration transition does not fire a
`transitionend` event in every engine, and a component waiting on one would hang.

### The JavaScript layer

CSS cannot express _"show the end state instead"_. For those cases,
`usePrefersReducedMotion()` and `<MotionBoundary still={…}>` render a different tree.

`usePrefersReducedMotion` is built on `useSyncExternalStore`, which subscribes to the
media query without a state-setting effect, and its **server snapshot returns `true`**.
The first paint therefore assumes reduced motion, and a visitor who prefers reduced motion
never sees a frame of movement before hydration corrects course.

### The substitution table

| Animation          | Reduced-motion presentation         | Information lost                                |
| ------------------ | ----------------------------------- | ----------------------------------------------- |
| Section reveal     | appears in place, no displacement   | none                                            |
| Group stagger      | all items appear together           | the sequence — which was decoration             |
| Hero pipeline draw | path rendered complete              | none; the completed path _is_ the diagram       |
| Ambient pulse      | static at full opacity              | none                                            |
| Counting numbers   | final value rendered immediately    | none; the value is content, the counting is not |
| Scrollytelling     | stage changes instantly             | none; the stage state is what matters           |
| Node selection     | ring appears at the target position | none                                            |
| Detail panel       | opens with no transition            | none                                            |
| Hover / press      | instant colour change               | none                                            |
| Drawer             | opens with no slide                 | the spatial origin — minor                      |
| Focus ring         | unchanged; never animated           | none                                            |

Nothing in the "information lost" column is content. Every row that would lose content
has a `MotionBoundary` `still` branch instead, and `tests/e2e/reduced-motion.spec.ts`
asserts the two branches render the same text — a `still` branch that drops information is
a reduced-motion bug, not a simplification.

The full review set is captured at both settings:
`review-screenshots/*-reduced-motion.png` for every route at every viewport, so the
reduced-motion presentation is reviewed rather than assumed.

---

## 10. Performance properties

- Only `opacity` and `transform` are animated. No animation on this site triggers layout.
- Every `IntersectionObserver` disconnects on first fire.
- `will-change` is scoped to the duration of the reveal and dropped afterwards.
- The two ambient animations are the only things running when the page is idle, and both
  are `opacity` on a single element.
- No animation loop runs off-screen: the counting number does not start until its element
  is in view, and it runs once.
