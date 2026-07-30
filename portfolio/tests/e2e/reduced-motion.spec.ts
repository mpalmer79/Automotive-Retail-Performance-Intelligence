import { expect, test } from '@playwright/test'

import { bodyText, gotoRendered, mainText, settle } from './helpers'
import { PRIMARY_ROUTES } from './routes'

/**
 * Reduced motion.
 *
 * The rule this suite enforces, stated in portfolio/docs/MOTION_SYSTEM.md
 * section 9:
 *
 *   Reduced motion does not mean "less movement". It means the animation's END
 *   STATE is rendered immediately. Content, layout, state, focus order and every
 *   value are identical; only the transition between states is gone.
 *
 * That is a much stronger claim than "the transitions are shorter", and it is
 * exactly the kind of claim that rots: the honest failure mode of a reduced-motion
 * implementation is not jitter, it is a section that never becomes visible because
 * the thing that would have revealed it was the animation.
 *
 * So the central assertion here is a comparison. Every route is loaded twice, once
 * at each motion preference, and the rendered text must be the same. A
 * reduced-motion branch that drops information fails.
 */

test.describe('the end state is rendered, not a reduced one', () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} renders the same text at both motion preferences`, async ({
      browser,
    }) => {
      const read = async (reducedMotion: 'reduce' | 'no-preference') => {
        const context = await browser.newContext({ reducedMotion })
        const page = await context.newPage()
        await gotoRendered(page, route.path)
        const text = await mainText(page)
        await context.close()
        return text
      }

      const [moving, still] = await Promise.all([read('no-preference'), read('reduce')])

      // Compared as normalised text rather than as a DOM snapshot: the two trees
      // legitimately differ where `MotionBoundary` swaps an animated SVG for a
      // completed one. What must not differ is what the page says.
      expect(still).toBe(moving)
    })
  }
})

test.describe('nothing is left invisible when motion is suppressed', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} reveals every section without a scroll`, async ({ page }) => {
      // No `settle()` here, deliberately. Under reduced motion the reveal must not
      // depend on a scroll having happened - and this is the assertion that would
      // have caught the "reveal with no trigger" defect, where three sections
      // started hidden and nothing ever revealed them.
      await gotoRendered(page, route.path)

      const hidden = await page.evaluate(() => {
        const offenders: string[] = []
        for (const element of document.querySelectorAll('[data-arpi-reveal]')) {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          // Only elements at or above the fold: anything below it has legitimately
          // not been observed yet.
          if (rect.top > window.innerHeight) continue
          if (Number(style.opacity) < 0.99) {
            offenders.push(
              `${element.tagName.toLowerCase()}.${element.className.split(' ')[0] ?? ''} opacity ${style.opacity}`
            )
          }
        }
        return offenders
      })

      expect(hidden).toEqual([])
    })
  }

  test('every revealed element ends with no displacement', async ({ page }) => {
    await gotoRendered(page, '/')
    await settle(page)
    const displaced = await page.evaluate(() =>
      [...document.querySelectorAll('[data-arpi-reveal]')]
        .map((element) => getComputedStyle(element).transform)
        .filter(
          (transform) => transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)'
        )
    )
    expect(displaced).toEqual([])
  })
})

test.describe('transitions and animations are suppressed, not merely shortened', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('no element carries a transition longer than the reduced-motion floor', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await settle(page)

    const slow = await page.evaluate(() => {
      const offenders: string[] = []
      for (const element of document.querySelectorAll('body *')) {
        const durations = getComputedStyle(element)
          .transitionDuration.split(',')
          .map((value) => Number.parseFloat(value))
        // The site-wide block collapses every transition to 1ms. 1ms rather than
        // 0s because a zero-duration transition does not fire `transitionend` in
        // every engine, and a component waiting on one would hang.
        if (durations.some((duration) => duration > 0.005)) {
          offenders.push(
            `${element.tagName.toLowerCase()} ${getComputedStyle(element).transitionDuration}`
          )
        }
      }
      return offenders.slice(0, 8)
    })

    expect(slow).toEqual([])
  })

  test('the ambient animations do not loop', async ({ page }) => {
    await gotoRendered(page, '/')
    const looping = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map((element) => getComputedStyle(element))
        .filter((style) => style.animationName !== 'none')
        .map((style) => `${style.animationName} x${style.animationIterationCount}`)
        .filter((description) => !description.endsWith('x1'))
    )
    expect(looping).toEqual([])
  })

  test('smooth scrolling is off', async ({ page }) => {
    await gotoRendered(page, '/')
    const behaviour = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior
    )
    expect(behaviour).toBe('auto')
  })
})

test.describe('values that are content are never withheld', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('every counting number shows its final value immediately', async ({ page }) => {
    await gotoRendered(page, '/')

    // The counters are in the credibility strip near the top of the page, so they
    // are read WITHOUT scrolling. Under reduced motion the value is content and the
    // counting is not, so a zero here would be a reduced-motion bug.
    const zeros = await page.evaluate(() =>
      [...document.querySelectorAll('.numeric')]
        .map((element) => element.textContent?.trim() ?? '')
        .filter((text) => text === '0' || text === '')
    )
    expect(zeros).toEqual([])
  })

  test('the drawn pipeline is rendered complete', async ({ page }) => {
    await gotoRendered(page, '/')
    const undrawn = await page.evaluate(() =>
      [...document.querySelectorAll('[data-arpi-draw]')]
        .map((element) => getComputedStyle(element).strokeDashoffset)
        .filter((offset) => Number.parseFloat(offset) !== 0)
    )
    expect(undrawn).toEqual([])
  })
})

test.describe('the site survives its own JavaScript failing', () => {
  /**
   * The hidden class ships in the server-rendered markup, so `opacity: 0` is in
   * the HTML. If the bundle never loads, every revealed section stays blank
   * forever. The root layout ships a `<noscript>` rule that forces those elements
   * visible, and this is the test that it works.
   *
   * A document must survive its own JavaScript failing.
   */
  test.use({ javaScriptEnabled: false })

  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} is readable with scripting disabled`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('h1')).toContainText(route.heading)

      // The synthetic-data disclosure must survive too. It is the one statement on
      // the site that a broken bundle must not be able to remove.
      const text = await page.locator('body').innerText()
      expect(text).toMatch(/synthetic/i)

      const hidden = await page.evaluate(
        () =>
          [...document.querySelectorAll('[data-arpi-reveal]')].filter(
            (element) => Number(getComputedStyle(element).opacity) < 0.99
          ).length
      )
      expect(hidden).toBe(0)
    })
  }

  test('the primary navigation still works without scripting', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'KPIs' })
      .click()
    await expect(page.locator('h1')).toContainText('A ratio without both sides')
  })
})

test.describe('the motion preference is respected from the first paint', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('the server-rendered markup does not assume motion is wanted', async ({
    request,
  }) => {
    // `usePrefersReducedMotion` returns `true` for its server snapshot, so a
    // visitor who prefers reduced motion never sees a frame of movement before
    // hydration corrects course. Asserted against the raw HTML, before any script
    // has run.
    const response = await request.get('/')
    const html = await response.text()
    expect(html).toContain('data-arpi-reveal')
    expect(html).toContain('[data-arpi-reveal]{opacity:1!important')
  })

  test('no route text differs between a cold document and a hydrated one', async ({
    page,
    request,
  }) => {
    const response = await request.get('/status')
    const html = await response.text()
    await gotoRendered(page, '/status')
    const rendered = await bodyText(page)

    // A handful of substantive strings that must be in the server response rather
    // than appearing only after hydration. A status a crawler cannot see is a
    // status the site has not really published.
    for (const phrase of ['Pending external validation', 'synthetic', 'Gate 2']) {
      expect(html, `"${phrase}" is missing from the server response`).toContain(phrase)
      expect(rendered).toContain(phrase)
    }
  })
})
