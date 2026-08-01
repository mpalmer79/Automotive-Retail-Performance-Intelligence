'use client'

/**
 * Reveal and RevealGroup — the site's section entrance, in CSS.
 *
 * WHY THESE ARE NOT BUILT ON THE ANIMATION LIBRARY
 * -----------------------------------------------
 * This is the most common motion on the site: fade and rise sixteen pixels, once,
 * when an element first crosses into view. It appears on six of the eight routes.
 * Implementing it with the animation library meant that library shipped to all
 * six - roughly 70 kB gzipped - to move an element sixteen pixels.
 *
 * Two CSS declarations and a class toggle do the same thing. The library now loads
 * only on the three routes whose motion genuinely needs it: the hero's drawn SVG
 * paths, the scrollytelling diagram's width transitions, and the two explorers'
 * node emphasis. That is what a motion budget is for - spending the weight where
 * the movement carries meaning, and not where it is decoration.
 *
 * Measured: 295 kB gzipped of client JavaScript before this change, and the
 * figure after it is recorded in portfolio/docs/PERFORMANCE.md section 4.
 *
 * TWO FAILURE MODES THIS IS BUILT TO PREVENT
 * -----------------------------------------
 * Both were found in the first adversarial review pass, and both had the same
 * symptom: content silently invisible.
 *
 *   1. A reveal with no trigger. An earlier revision had a `child` mode that
 *      omitted the viewport trigger and relied on variant propagation from a
 *      group parent. Used outside a group - which three sections did - the element
 *      started hidden and nothing ever revealed it. Every `Reveal` here carries
 *      its own observer. `child` selects a shorter travel distance and nothing
 *      else.
 *
 *   2. No JavaScript. The hidden class ships in the server-rendered markup, so if
 *      the bundle fails to load every revealed section stays blank. Every element
 *      carries `data-arpi-reveal`, and the root layout ships a `<noscript>` rule
 *      that forces those elements visible. A document must survive its own
 *      JavaScript failing.
 *
 *   3. A hydration mismatch on every revealed element. Both components used to
 *      initialise their state with
 *      `useState(() => typeof IntersectionObserver === 'undefined')`, as a
 *      fallback for an environment without the observer. That expression is
 *      TRUE on the server and FALSE in the browser, so the server rendered
 *      `reveal-shown` and the client's first render produced `reveal-hidden` -
 *      seventeen mismatches on the home page alone. React kept the server's
 *      markup, which meant the class the observer later toggled was not the
 *      class on the element. It was invisible in every screenshot and every
 *      test, and the page looked correct.
 *
 *      The fallback is deleted rather than moved into the effect. It was
 *      unreachable: `IntersectionObserver` has shipped in every browser since
 *      2019, and this site already requires `overflow: clip`, `text-wrap:
 *      balance` and `:focus-visible`, all of which are newer. The test runner
 *      does not need it either - `tests/setup.ts` stubs the observer with an
 *      immediate-firing implementation. The real degradation case is JavaScript
 *      not running at all, and that is point 2's job.
 *
 * REDUCED MOTION
 * --------------
 * Handled entirely in CSS. The site-wide `prefers-reduced-motion` block collapses
 * the transition to 1ms and a companion rule removes the transform, so the element
 * appears in place with no displacement. Nothing about the content or the state
 * differs.
 */
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

import { cx } from '@/lib/utils'

/**
 * Reveal an element once, when it first enters the viewport.
 *
 * One IntersectionObserver per element, disconnected the moment it fires, so
 * nothing keeps running behind the page. `rootMargin` shrinks the trigger band
 * from the bottom by 12% of the viewport, so the reveal starts slightly before the
 * element's top edge reaches the fold and has finished by the time the reader's eye
 * arrives.
 */
export function Reveal({
  children,
  className,
  as: Tag = 'div',
  child = false,
  delayMs,
}: {
  children: ReactNode
  className?: string
  as?: ElementType
  /**
   * Shorter travel (8px rather than 16px), for an item in a list or grid where the
   * surrounding rhythm already carries the eye. Does NOT change how the reveal is
   * triggered.
   */
  child?: boolean
  /** Delay before this element's reveal. Use sparingly. */
  delayMs?: number
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      data-arpi-reveal=""
      className={cx(
        'reveal-transition',
        shown ? 'reveal-shown' : child ? 'reveal-hidden-child' : 'reveal-hidden',
        className
      )}
      style={
        delayMs !== undefined && !shown
          ? { transitionDelay: `${String(delayMs)}ms` }
          : undefined
      }
    >
      {children}
    </Tag>
  )
}

/**
 * A group whose children reveal in reading order.
 *
 * The stagger is 55ms per child, applied as a transition delay. Long enough to
 * read as a sequence, short enough that the last of six cards is not still
 * arriving a third of a second after the first - which is the point at which a
 * stagger stops guiding the eye and starts making the reader wait.
 *
 * Children reveal together on one observer rather than each on their own, so the
 * sequence is a sequence rather than a function of scroll speed.
 */
export function RevealGroup({
  children,
  className,
  as: Tag = 'div',
  staggerMs = 55,
}: {
  children: ReactNode
  className?: string
  as?: ElementType
  staggerMs?: number
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      data-arpi-reveal-group=""
      // The delay is set per child through a CSS custom property and an
      // `nth-child` rule would be brittle across differing child counts, so the
      // stagger is expressed as a variable the child rule multiplies.
      style={{ ['--arpi-stagger-step' as string]: `${String(staggerMs)}ms` }}
      className={cx(shown && 'is-revealed', className)}
    >
      {children}
    </Tag>
  )
}

/**
 * A child of a `RevealGroup`. Reveals when the group does, offset by its index.
 *
 * The index is passed explicitly rather than inferred, because inferring it would
 * mean cloning children and that breaks any child that is itself a component.
 */
export function RevealItem({
  children,
  className,
  index,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  index: number
  as?: ElementType
}) {
  return (
    <Tag
      data-arpi-reveal=""
      className={cx('reveal-transition reveal-item', className)}
      style={{
        transitionDelay: `calc(var(--arpi-stagger-step, 55ms) * ${String(index)})`,
      }}
    >
      {children}
    </Tag>
  )
}
