/**
 * The motion system's programmatic half.
 *
 * The token values live in `src/styles/tokens.css` under `--arpi-motion-*` and
 * `--arpi-ease-*`. This module mirrors them for JavaScript-driven animation so
 * that a spring in a React component and a transition in a stylesheet cannot
 * disagree. `tests/unit/motion.test.ts` asserts the two lists match.
 *
 * Rationale for every value, and the reduced-motion substitution table, are in
 * portfolio/docs/MOTION_SYSTEM.md.
 */
import type { Transition, Variants } from 'motion/react'

/* -------------------------------------------------------------------------- */
/* Scales                                                                      */
/* -------------------------------------------------------------------------- */

/** Duration scale, in seconds (Motion's unit). Mirrors --arpi-motion-*. */
export const DURATION = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.38,
  slower: 0.62,
  deliberate: 0.9,
} as const

/** Easing scale as cubic-bezier control points. Mirrors --arpi-ease-*. */
export const EASE = {
  /** The default. Fast start, long settle - reads as weight without lag. */
  standard: [0.32, 0.72, 0, 1],
  /** For entrances. Almost all of the travel happens in the first third. */
  out: [0.16, 1, 0.3, 1],
  /** For exits, where the element should commit to leaving. */
  in: [0.55, 0, 1, 0.45],
} as const satisfies Record<string, [number, number, number, number]>

/** Distance scale, in pixels. Mirrors --arpi-motion-distance-*. */
export const DISTANCE = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 28,
} as const

/** Delay between siblings in a revealed group, in seconds. */
export const STAGGER = 0.055

/**
 * The one spring on the site, used for pointer-following and for the
 * architecture explorer's selection ring. A spring is used rather than a
 * duration because the target moves while the animation runs, and a duration
 * would restart on every change.
 */
export const SPRING: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.8,
}

/** A softer spring for larger surfaces, where the stiff one reads as a snap. */
export const SPRING_SOFT: Transition = {
  type: 'spring',
  stiffness: 180,
  damping: 26,
  mass: 1,
}

/* -------------------------------------------------------------------------- */
/* Named transitions                                                           */
/* -------------------------------------------------------------------------- */

export const transitions = {
  hover: { duration: DURATION.fast, ease: EASE.standard },
  press: { duration: DURATION.instant, ease: EASE.standard },
  reveal: { duration: DURATION.slow, ease: EASE.out },
  panel: { duration: DURATION.base, ease: EASE.standard },
  draw: { duration: DURATION.deliberate, ease: EASE.out },
  route: { duration: DURATION.base, ease: EASE.out },
} as const satisfies Record<string, Transition>

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The section reveal is NOT here.
 *
 * It is the site's most common motion, it appears on six of the eight routes, and
 * it is implemented in CSS - see `src/components/motion/reveal.tsx` and the
 * `reveal-*` utilities in `src/styles/globals.css`. Keeping it out of the
 * animation library is what lets that library ship only to the three routes whose
 * motion genuinely needs it.
 *
 * What remains in this module is the token scale, shared by both the CSS and the
 * JavaScript motion so the two cannot disagree, plus the variants used by the
 * pieces that do need a JavaScript animator: the hero's drawn paths, the
 * scrollytelling diagram, and the explorers' node emphasis.
 */

/** A panel that opens in place - a filter tray, an entity detail. */
export const panel: Variants = {
  hidden: { opacity: 0, y: DISTANCE.xs },
  visible: { opacity: 1, y: 0, transition: transitions.panel },
  reduced: { opacity: 1, y: 0, transition: { duration: 0 } },
}

/**
 * The viewport trigger used by any JavaScript-driven reveal.
 *
 * `once: true` is load-bearing, not an optimisation: it is what stops motion
 * restarting on a small scroll. The `-12%` bottom margin means the reveal fires
 * slightly before the element's top edge reaches the fold, so the movement has
 * finished by the time the reader's eye arrives. The CSS reveal uses the same
 * margin, for the same reason.
 */
export const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' } as const

/**
 * Pick the variant to animate to. Under reduced motion every component targets
 * `reduced`, which every variant defines as the animation's end state with zero
 * duration - so content and state are identical, and only the movement is gone.
 */
export function target(prefersReducedMotion: boolean): 'visible' | 'reduced' {
  return prefersReducedMotion ? 'reduced' : 'visible'
}
