'use client'

/**
 * MotionBoundary and AnimatedCount.
 *
 * The two pieces of motion that genuinely need JavaScript. The section reveal -
 * the site's most common animation - lives in `reveal.tsx` and is pure CSS, so the
 * animation library ships only to the three routes whose motion needs it.
 *
 * The substitution rule, stated once here and documented fully in
 * portfolio/docs/MOTION_SYSTEM.md section 9:
 *
 *   Reduced motion does not mean "less movement". It means the animation's END
 *   STATE is rendered immediately. Content, layout, state, focus order and every
 *   value are identical; only the transition between states is gone.
 *
 * TWO FAILURE MODES THIS MODULE IS BUILT TO PREVENT
 * ------------------------------------------------
 * Both were found in the first adversarial review pass, and both had the same
 * symptom: content silently invisible.
 *
 *   1. A reveal with no trigger. An earlier revision gave `Reveal` a `child`
 *      mode that omitted `whileInView` and relied on variant propagation from a
 *      `RevealGroup` parent. Used outside a group - which three sections did -
 *      the element had `initial="hidden"` and nothing that would ever animate it
 *      away, so the content never appeared at all. `Reveal` now ALWAYS carries
 *      its own viewport trigger. `child` selects a shorter travel distance and
 *      nothing else.
 *
 *   2. No JavaScript. Motion serialises `initial` into the server-rendered
 *      markup, so `opacity: 0` ships in the HTML. If the bundle fails to load,
 *      every revealed section stays blank. Every element here therefore carries
 *      `data-arpi-reveal`, and the root layout ships a `<noscript>` rule that
 *      forces those elements visible. A document must survive its own
 *      JavaScript failing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { usePrefersReducedMotion } from '@/lib/hooks'
import { DURATION } from '@/lib/motion'
import { cx, formatCount } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* MotionBoundary                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Render one of two trees depending on the visitor's motion preference.
 *
 * For the cases CSS cannot express: an SVG whose reveal is a stroke dash offset
 * has to be rendered *complete* rather than *unanimated*, and a counter has to
 * show its final value rather than its start value. `still` is that end state.
 *
 * Both branches must be equivalent in content. A `still` branch that drops
 * information is a reduced-motion bug, and `tests/e2e/reduced-motion.spec.ts`
 * asserts the two render the same text.
 */
export function MotionBoundary({
  children,
  still,
}: {
  /** The animated tree. */
  children: ReactNode
  /**
   * The end state, rendered when the visitor prefers reduced motion. Omit it
   * only when the animated tree is already correct at rest.
   */
  still?: ReactNode
}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  if (prefersReducedMotion && still !== undefined) return <>{still}</>
  return <>{children}</>
}

/* -------------------------------------------------------------------------- */
/* AnimatedCount                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A number that counts up once when it first enters view.
 *
 * Three properties matter and are easy to get wrong:
 *
 *   1. It counts ONCE. A number that re-counts on every scroll is noise.
 *   2. It uses tabular figures (`numeric` utility), so the digits do not reflow
 *      while the value changes. Without that, a five-digit count visibly jitters
 *      the whole card for the duration of the animation.
 *   3. Under reduced motion it renders the FINAL value immediately, never the
 *      start value and never a blank. The value is content; the counting is not.
 *
 * The interpolation is driven by requestAnimationFrame rather than by a Motion
 * value, because the output is text rather than a style property and Motion's
 * animation pipeline has nothing to contribute.
 */
export function AnimatedCount({
  value,
  className,
  durationSeconds = DURATION.deliberate,
}: {
  value: number
  className?: string
  durationSeconds?: number
}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const ref = useRef<HTMLSpanElement | null>(null)
  const [displayed, setDisplayed] = useState(0)
  // A plain IntersectionObserver rather than the animation library's `useInView`.
  // Importing that hook pulled the whole library into the home page's bundle for a
  // visibility check that is nine lines of standard DOM API - and the home page is
  // the one route where every kilobyte is paid before a visitor has decided to
  // stay.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (prefersReducedMotion || !inView) return
    let frame = 0
    let start: number | null = null

    const step = (timestamp: number) => {
      start ??= timestamp
      const elapsed = (timestamp - start) / 1000
      const progress = Math.min(elapsed / durationSeconds, 1)
      // Cubic ease-out. The number arrives quickly and settles, which reads as a
      // value resolving rather than as a slot machine.
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(value * eased))
      if (progress < 1) frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [inView, prefersReducedMotion, value, durationSeconds])

  // The rendered value: the real one under reduced motion or before the
  // animation starts, the interpolated one while it runs. It is never blank, so
  // the number is present in the DOM for a screen reader and for a crawler from
  // the first paint.
  const shown = prefersReducedMotion || !inView ? value : displayed

  return (
    <span ref={ref} className={cx('numeric', className)}>
      {formatCount(shown)}
    </span>
  )
}
