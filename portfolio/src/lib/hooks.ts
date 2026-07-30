'use client'

/**
 * Client hooks shared across interactive components.
 *
 * Every one is deliberately small and dependency-free. None polls, none listens
 * to `scroll` without a passive flag, and none writes to the DOM outside an
 * effect.
 *
 * The two media-query hooks use `useSyncExternalStore` rather than
 * `useState` + `useEffect`. That is the correct primitive for reading a value
 * that lives outside React and changes on its own: it gives a server snapshot
 * explicitly, subscribes without an extra render, and cannot tear during a
 * concurrent render. The `useState`-plus-effect version this replaced also
 * triggered `react-hooks/set-state-in-effect`, which was right to complain - it
 * was a cascading render on every mount.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/* -------------------------------------------------------------------------- */
/* Media queries                                                              */
/* -------------------------------------------------------------------------- */

function subscribeToMediaQuery(query: string): (onChange: () => void) => () => void {
  return (onChange) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
}

/**
 * Whether the visitor has asked for reduced motion.
 *
 * The SERVER SNAPSHOT is `true`, and that is the important detail. The server
 * cannot know the preference, so it renders as though motion were reduced -
 * meaning the markup that reaches a visitor who asked for no animation never
 * contains a frame of one, even before hydration. The cost is that motion begins
 * one commit late for everyone else, which is imperceptible and is the right way
 * round for this trade to fall.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMediaQuery('(prefers-reduced-motion: reduce)'),
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true
  )
}

/**
 * Whether a media query currently matches.
 *
 * The server snapshot is `false`: a layout query has no safe default, and
 * assuming the query does not match means the server renders the base case, which
 * is the mobile-first one.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToMediaQuery(query)(onChange),
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

/* -------------------------------------------------------------------------- */
/* Scroll lock                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Lock the document scroll while a modal surface is open.
 *
 * Compensates for the scrollbar's width so that locking does not shift the page
 * sideways, and restores the previous values on unlock rather than assuming they
 * were the defaults.
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    const { body, documentElement } = document
    const previousOverflow = body.style.overflow
    const previousPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth

    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) body.style.paddingRight = `${String(scrollbarWidth)}px`

    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPaddingRight
    }
  }, [locked])
}

/* -------------------------------------------------------------------------- */
/* Viewport observation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether an element has entered the viewport, reported once.
 *
 * IntersectionObserver rather than a scroll handler, and the observer disconnects
 * the moment it fires, so nothing keeps running behind the page.
 *
 * The initial state is computed rather than set from inside the effect: in an
 * environment with no IntersectionObserver - an older browser, or a test runner -
 * the answer is "assume visible", and deciding that at initialisation avoids a
 * second render and shows the content immediately rather than never.
 */
export function useInView<T extends Element>(
  options?: IntersectionObserverInit
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      options ?? { rootMargin: '0px 0px -12% 0px' }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [options])

  return [ref, inView]
}

/* -------------------------------------------------------------------------- */
/* Keyboard and focus                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Call a handler when Escape is pressed, while `active`.
 *
 * Bound on `document` in the capture phase so it wins over a nested handler that
 * would otherwise swallow the key. The handler is kept in a ref updated inside an
 * effect - not during render, which would be a render-phase side effect - so that
 * a caller passing an inline arrow function does not re-bind the listener on every
 * render.
 */
export function useEscapeKey(active: boolean, handler: () => void): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handlerRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [active])
}

/**
 * Trap focus inside a container while `active`, and return focus to whatever had
 * it when the trap closed.
 *
 * Used by the mobile navigation drawer. Radix owns the trap for Dialog; this
 * exists because the drawer is a custom surface with different open and close
 * semantics, and re-implementing Radix's Dialog around it would be more code, not
 * less.
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean
): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      )

    // Move focus in, so the first Tab lands inside rather than behind the drawer.
    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active_ = document.activeElement

      if (event.shiftKey && (active_ === first || !container.contains(active_))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active_ === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [active])

  return containerRef
}

/* -------------------------------------------------------------------------- */
/* Pointer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pointer position within an element, normalised to 0..1, updated on a
 * requestAnimationFrame so a fast pointer cannot queue more work than the
 * compositor can drain. Returns null while the pointer is outside.
 *
 * Skipped entirely under reduced motion and on coarse pointers, so a touch device
 * never pays for a hover effect it cannot show.
 */
export function usePointerPosition<T extends HTMLElement>(
  enabled: boolean
): {
  ref: React.RefObject<T | null>
  position: { x: number; y: number } | null
} {
  const ref = useRef<T | null>(null)
  const frame = useRef<number | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const element = ref.current
    if (!element) return
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const rect = element.getBoundingClientRect()
      setPosition({
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      })
    })
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const onLeave = () => setPosition(null)

    element.addEventListener('pointermove', onPointerMove, { passive: true })
    element.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerleave', onLeave)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [enabled, onPointerMove])

  return { ref, position }
}
