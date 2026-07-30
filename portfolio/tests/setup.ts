import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Test environment setup.
 *
 * jsdom is missing three browser APIs that this site's client components use.
 * Each stub below is deliberately minimal and deliberately honest about its
 * limits.
 */

afterEach(() => {
  cleanup()
})

/**
 * `matchMedia`. Defaults every query to NOT matching, which means
 * `usePrefersReducedMotion()` resolves to false in tests - full motion. Tests
 * that need the reduced-motion branch set it explicitly via `mockMatchMedia`.
 */
function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

mockMatchMedia(false)

/**
 * `IntersectionObserver`. The stub reports every observed element as
 * intersecting immediately.
 *
 * That is the right default here BECAUSE jsdom has no layout: every element has
 * a zero-size box, so a faithful observer would report nothing as visible and
 * every scroll-triggered reveal would test as permanently hidden. Reporting
 * everything visible tests the post-reveal state, which is the state the content
 * assertions care about. Whether a reveal actually fires on scroll is verified in
 * Playwright, against a browser that has layout.
 */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = ''
  readonly thresholds: readonly number[] = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
          target,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: 0,
        } as IntersectionObserverEntry,
      ],
      this
    )
  }

  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver)

/** `requestAnimationFrame`, for the animated counter. */
if (typeof window.requestAnimationFrame === 'undefined') {
  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0) as unknown as number
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
}

export { mockMatchMedia }
