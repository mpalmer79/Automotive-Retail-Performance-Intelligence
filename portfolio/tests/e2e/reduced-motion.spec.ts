import { expect, test, type Browser } from '@playwright/test'

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

  /**
   * WHAT THIS ASSERTS NOW, AND WHY IT CHANGED.
   *
   * The old form scanned every `.numeric` element for a "0" and required none.
   * Two problems with that, and the second one is why it had to be rewritten:
   *
   *   1. `.numeric` is the typographic class every figure on the site wears, not
   *      a marker for a counter. The store comparison table legitimately shows 0
   *      new vehicles for the independent store, and the rule failed on correct
   *      output the moment that table arrived.
   *   2. `<AnimatedCount>` is not rendered anywhere on the site any more - the
   *      credibility strip that used it was removed in the six-chapter redesign.
   *      So the check had quietly become vacuous: it was scanning figures that
   *      never animate and could not have been withheld.
   *
   * The property that actually matters is provable without knowing which figures
   * animate: the numbers a reduced-motion visitor reads are the SAME numbers
   * everyone else reads. That is asserted directly, by rendering the page under
   * both preferences and comparing. If a counter is ever reintroduced and holds
   * its value back under reduced motion, the two lists diverge and this fails.
   */
  test('renders the same figures under reduced motion as without it', async ({
    page,
    browser,
  }) => {
    await gotoRendered(page, '/')
    const reduced = await page.evaluate(() =>
      [...document.querySelectorAll('.numeric')].map(
        (element) => element.textContent?.trim() ?? ''
      )
    )
    expect(reduced.length, 'no figures were found on the page at all').toBeGreaterThan(5)
    expect(reduced, 'a figure rendered empty under reduced motion').not.toContain('')

    const context = await browser.newContext({ reducedMotion: 'no-preference' })
    try {
      const full = await context.newPage()
      await gotoRendered(full, '/')
      // Settle first: a counter that is mid-animation would differ for a reason
      // that is not a defect.
      await settle(full)
      const animated = await full.evaluate(() =>
        [...document.querySelectorAll('.numeric')].map(
          (element) => element.textContent?.trim() ?? ''
        )
      )
      expect(reduced).toEqual(animated)
    } finally {
      await context.close()
    }
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

  test('the reference navigation still works without scripting', async ({ page }) => {
    await page.goto('/technical')
    await page
      .getByRole('navigation', { name: 'Technical views' })
      .getByRole('link', { name: 'KPI catalogue' })
      .click()
    await expect(page.locator('h1')).toContainText('Every governed metric')
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
    const response = await request.get('/technical?view=status')
    const html = await response.text()
    await gotoRendered(page, '/technical?view=status')
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

/* -------------------------------------------------------------------------- */
/* The architecture explorer's flow motion                                     */
/* -------------------------------------------------------------------------- */

/**
 * The diagram gained two finite animations in this release: a one-time arrival
 * sequence that draws the built edges in band order, and a selection wave that
 * resolves the upstream path inward and the downstream path outward.
 *
 * Both are decoration in the strict sense - they add no information a static
 * render withholds - and this suite is what holds them to that. The load-bearing
 * assertion is the same one the rest of this file makes: the SEMANTIC state must
 * not depend on the motion preference. What a node is called, which nodes are on
 * its path, what the detail panel says and which option is selected are all
 * properties of the graph, and a reader who asked for no animation is entitled to
 * every one of them.
 */
test.describe('the architecture explorer communicates flow without depending on it', () => {
  /** Select a node and read back everything that is supposed to be semantic. */
  async function selectAndRead(
    browser: Browser,
    reducedMotion: 'reduce' | 'no-preference'
  ) {
    const context = await browser.newContext({ reducedMotion })
    const page = await context.newPage()
    await gotoRendered(page, '/technical?view=architecture')

    const option = page.getByRole('option', { name: /warehouse schema/i }).first()
    await option.click()

    const state = await page.evaluate(() => {
      const options = [...document.querySelectorAll('[role="option"]')]
      return {
        names: options.map((node) => node.getAttribute('aria-label') ?? ''),
        selected: options
          .filter((node) => node.getAttribute('aria-selected') === 'true')
          .map((node) => node.getAttribute('aria-label') ?? ''),
        panel: (
          document.querySelector('[aria-live="polite"]') as HTMLElement | null
        )?.innerText
          .replace(/\s+/g, ' ')
          .trim(),
      }
    })

    await context.close()
    return state
  }

  test('reports the same selection, names and detail at both motion preferences', async ({
    browser,
  }) => {
    const [moving, still] = await Promise.all([
      selectAndRead(browser, 'no-preference'),
      selectAndRead(browser, 'reduce'),
    ])

    expect(still.names).toEqual(moving.names)
    expect(still.selected).toEqual(moving.selected)
    expect(still.selected).toHaveLength(1)
    expect(still.panel).toBe(moving.panel)
    expect(still.panel, 'the detail panel rendered nothing').toBeTruthy()
  })

  test.describe('with motion suppressed', () => {
    // `contextOptions`, which is the form the rest of this file uses and the
    // form that actually emulates the preference here. The bare `reducedMotion`
    // fixture did not take effect in a nested describe under this
    // configuration, and the symptom was the worst kind: the tests ran with
    // motion ENABLED and still passed the assertions that did not depend on it,
    // so the suite looked like it was covering reduced motion and was not.
    test.use({ contextOptions: { reducedMotion: 'reduce' } })

    test('draws no edge, so nothing is left part-way along a path', async ({ page }) => {
      await gotoRendered(page, '/technical?view=architecture')
      await page
        .getByRole('option', { name: /warehouse schema/i })
        .first()
        .click()
      await page.waitForTimeout(400)

      // `pathLength` is implemented as a dash offset. A non-zero offset under
      // reduced motion is an edge frozen half-drawn, which is the exact failure
      // this rule exists to prevent - the reader would see a broken diagram
      // rather than a still one.
      const stranded = await page.evaluate(() =>
        [...document.querySelectorAll('#architecture-explorer svg path')]
          .map((node) => {
            const style = getComputedStyle(node)
            return {
              offset: style.strokeDashoffset,
              array: style.strokeDasharray,
            }
          })
          .filter((entry) => {
            const offset = Number.parseFloat(entry.offset)
            return Number.isFinite(offset) && Math.abs(offset) > 0.01
          })
      )
      expect(stranded, 'an edge is frozen part-drawn').toEqual([])
    })

    test('does not scale the selected node', async ({ page }) => {
      await gotoRendered(page, '/technical?view=architecture')
      const option = page.getByRole('option', { name: /warehouse schema/i }).first()
      await option.click()
      await page.waitForTimeout(400)

      const transform = await option.evaluate((node) => getComputedStyle(node).transform)
      // `none` or the identity matrix. Anything else is a scale that a reader
      // who asked for no movement did not ask for.
      expect(
        transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)',
        `selected node transform was ${transform}`
      ).toBe(true)
    })
  })

  test('lets a node be selected immediately, without waiting for the arrival sequence', async ({
    page,
  }) => {
    // The sequence runs once on arrival and must never gate the controls. The
    // click happens as soon as the option exists, which is well inside the
    // sequence's own duration.
    await gotoRendered(page, '/technical?view=architecture')
    const option = page.getByRole('option', { name: /warehouse schema/i }).first()
    await option.click()
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[aria-live="polite"]')).toContainText(/warehouse/i)
  })

  test('does not replay the arrival sequence when a selection is cleared', async ({
    page,
  }) => {
    await gotoRendered(page, '/technical?view=architecture')
    await page
      .getByRole('option', { name: /warehouse schema/i })
      .first()
      .click()
    await page.getByRole('button', { name: /reset selection/i }).click()

    // Immediately after the reset every built edge must already be whole. If the
    // intro replayed, the edges would be at zero length at this instant.
    const drawn = await page.evaluate(() =>
      [...document.querySelectorAll('#architecture-explorer svg path[data-arpi-draw]')]
        .map((node) => Number.parseFloat(getComputedStyle(node).strokeDashoffset))
        .filter((offset) => Number.isFinite(offset) && Math.abs(offset) > 0.01)
    )
    expect(drawn, 'clearing the selection replayed the arrival sequence').toEqual([])
  })
})

test.describe('the operating rail survives its own JavaScript failing', () => {
  /*
   * A SEPARATE CONTEXT, AND THE VIEWPORT IS THE REASON.
   *
   * Below the `lg` breakpoint the rail is not rendered at all — the navigation
   * there is a drawer, and a drawer needs the script this suite has switched off.
   * The desktop rail is the surface under test, so the context declares a desktop
   * viewport rather than resizing a page that was created at the suite default.
   *
   * What this proves: the rail is a client island — it reads the query string to
   * carry the reader's filter context — and its LINKS are still server-rendered
   * anchors that navigate on their own.
   */
  test.use({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })

  test('navigates between operating routes with no script at all', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .getByRole('link', { name: 'Accounting', exact: true })
      .click()
    await expect(page.locator('h1')).toHaveText('Accounting')
  })

  test('carries the filter context in its hrefs on the server', async ({ page }) => {
    await page.goto('/?period=2025-11&store=GSA-002')
    const href = await page
      .getByRole('navigation', { name: 'Operating' })
      .first()
      .getByRole('link', { name: 'Sales & Gross', exact: true })
      .getAttribute('href')
    expect(href).toContain('period=2025-11')
    expect(href).toContain('store=GSA-002')
  })
})
