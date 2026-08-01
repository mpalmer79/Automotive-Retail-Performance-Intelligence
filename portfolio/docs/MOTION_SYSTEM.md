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
| `deliberate` | 900ms | the drawn pipeline, the counting number       |
| `ambient`    | 14s   | the one slow signal pulse in the hero         |

The scale stops at 900ms for anything a reader triggers. `ambient` is a separate class of
thing: it is not a response to an action, it is a slow background state, and it is used
twice on the entire site.

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

| Route           | What needs the library                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| `/`             | the hero's drawn SVG paths, and the scrollytelling diagram's width transitions |
| `/architecture` | the explorer's node emphasis, driven by a spring against a moving target       |
| `/data-model`   | the same                                                                       |

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

| #   | Animation                   | Implementation            | Duration           | Carries                                         |
| --- | --------------------------- | ------------------------- | ------------------ | ----------------------------------------------- |
| 1   | Section reveal              | CSS + observer            | slow               | reading order and section boundaries            |
| 2   | Group stagger               | CSS + one observer        | slow, 55ms offsets | that these items are peers in a sequence        |
| 3   | Hero pipeline draw          | Motion, SVG dash offset   | deliberate         | the direction of data flow                      |
| 4   | Ambient signal pulse        | CSS keyframes             | 14s                | that the pipeline is a live path, not a picture |
| 5   | Counting numbers            | rAF interpolation         | deliberate         | that the number was computed                    |
| 6   | Scrollytelling stage change | Motion, width and opacity | base               | which pipeline stage the prose is describing    |
| 7   | Explorer node selection     | Motion spring             | spring             | which node is selected, against a moving target |
| 8   | Explorer detail panel       | CSS, `panel` variant      | base               | that the panel is the selected node expanded    |
| 9   | Hover and press states      | CSS                       | fast / instant     | affordance                                      |
| 10  | Mobile drawer and scrim     | CSS transform and opacity | base               | where the drawer came from                      |
| 11  | Focus ring                  | none — instant            | 0                  | never animated; a delayed focus ring is a bug   |

Number 11 is a rule, not an omission. A focus indicator that fades in is a focus
indicator that is briefly absent.

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
