/**
 * The floating-canvas visual system, asserted in a real browser.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM design-system.spec.ts
 * ----------------------------------------------------------
 * That file asserts the token bridge: that a `var(--arpi-*)` reference resolves
 * to a real computed value rather than to an unresolved name. This one asserts
 * the three structural facts the visual direction rests on - a white header, a
 * blue geometric field, and a white canvas floating on it - and the properties
 * that keep the field from getting in the way.
 *
 * Every assertion here is something that was, at some point during this change,
 * wrong in a way that no unit test could see: the header was translucent over a
 * gradient, the field's SVG registered as horizontal overflow at seven
 * viewports, and `<body>` still carried a background that covered the field.
 *
 * Recorded in portfolio/docs/EXPERIENCE_REDESIGN_V2.md part two.
 */
import { expect, test } from '@playwright/test'

/**
 * The route these suites measure the SHELL on.
 *
 * It was `/`, which wore the site header and footer until `UX.1` made it the
 * operating console — a different shell with a rail instead of a masthead and no
 * footer at all. The design-system and visual-system contracts are about the
 * reference domain's chrome, so they measure it where it is rendered. The
 * operating shell has its own assertions in `dashboard.spec.ts` and
 * `navigation.spec.ts`.
 */
const SHELL_ROUTE = '/technical'

import { PRIMARY_ROUTES } from './routes'

/** Parse `rgb()` / `rgba()` into channels plus alpha. */
function parseColour(value: string): { r: number; g: number; b: number; a: number } {
  const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(',').map(Number) ?? []
  const [r = 0, g = 0, b = 0, a = 1] = parts
  return { r, g, b, a }
}

test.describe('the shell is white and the field is blue', () => {
  test('the header is opaque white on every primary route', async ({ page }) => {
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const header = await page.$eval('header', (el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, filter: style.backdropFilter }
      })

      const { r, g, b, a } = parseColour(header.background)
      expect(a, `${route.path}: the header is translucent`).toBe(1)
      expect(
        Math.min(r, g, b),
        `${route.path}: the header is not white (${header.background})`
      ).toBeGreaterThan(248)
      expect(header.filter, `${route.path}: the header has a backdrop blur`).toBe('none')
    }
  })

  test('the footer is white and closes the field', async ({ page }) => {
    await page.goto(SHELL_ROUTE)
    const { r, g, b, a } = parseColour(
      await page.$eval('footer', (el) => getComputedStyle(el).backgroundColor)
    )
    expect(a).toBe(1)
    expect(Math.min(r, g, b)).toBeGreaterThan(248)
  })

  test('the blue field is a gradient on the root element, not on the body', async ({
    page,
  }) => {
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const { root, body } = await page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).backgroundImage,
        body: getComputedStyle(document.body).backgroundColor,
      }))

      // The field must be a real gradient, not a flat fill.
      expect(root, `${route.path}: the field is not a gradient`).toContain(
        'linear-gradient'
      )
      expect(root, `${route.path}: an unresolved token reached the field`).not.toContain(
        '--arpi'
      )

      // A background on <body> would paint over the field. This is not
      // hypothetical: <body> carried the canvas colour until the inversion, and
      // leaving it would have hidden the entire design.
      expect(
        parseColour(body).a,
        `${route.path}: <body> has a background and covers the field`
      ).toBe(0)
    }
  })

  test('the field is visible down both sides of the canvas at every route', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)

      // Sample the page one third of the way down, just inside each edge. Both
      // samples must be blue, which is what "floating" means: if the canvas ran
      // edge to edge, or the field were painted over, these would be white.
      const edges = await page.evaluate(() => {
        const y = Math.round(window.innerHeight / 3)
        const at = (x: number) => {
          const el = document.elementFromPoint(x, y)
          if (!el) return null
          // Walk up to the first element that actually paints a background.
          let node: Element | null = el
          while (node) {
            const bg = getComputedStyle(node).backgroundColor
            if (!bg.startsWith('rgba(0, 0, 0, 0)')) return bg
            node = node.parentElement
          }
          return null
        }
        return { left: at(4), right: at(window.innerWidth - 4) }
      })

      for (const [side, colour] of Object.entries(edges)) {
        // `null` is the correct and expected answer: nothing between the edge
        // and <html> paints, so the field's own gradient shows through. A
        // painted colour there must be blue, never white.
        if (colour === null) continue
        const { r, b } = parseColour(colour)
        expect(
          b,
          `${route.path}: the ${side} edge paints ${colour}, which is not the field`
        ).toBeGreaterThan(r)
      }
    }
  })

  test('every route renders exactly one master canvas, with a real radius', async ({
    page,
  }) => {
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      const panels = page.locator('main .canvas-panel')
      await expect(panels, `${route.path} has no canvas`).toHaveCount(1)

      const radius = await panels.evaluate((el) =>
        Number.parseFloat(getComputedStyle(el).borderTopLeftRadius)
      )
      // The direction asks for 20-30px on a desktop. The token is fluid, so this
      // asserts the band rather than a single value.
      expect(
        radius,
        `${route.path}: canvas radius is ${String(radius)}px`
      ).toBeGreaterThan(15)
      expect(radius).toBeLessThan(32)
    }
  })
})

test.describe('the field motif stays out of the way', () => {
  test('is decorative: hidden from assistive technology and unclickable', async ({
    page,
  }) => {
    await page.goto(SHELL_ROUTE)

    const motif = page.locator('svg[role="presentation"]').first()
    await expect(motif).toHaveCount(1)

    const container = page.locator('[aria-hidden="true"]').filter({ has: motif })
    await expect(container).toHaveCount(1)

    // It must carry no accessible name of any kind. A <title> inside an SVG is
    // announced even when the element is decorative.
    await expect(motif.locator('title')).toHaveCount(0)
    await expect(motif.locator('desc')).toHaveCount(0)

    // It spans the viewport, so if it intercepted pointer events it would make
    // the entire page unclickable.
    const events = await container.evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(events, 'the field motif intercepts clicks').toBe('none')
  })

  test('is fixed and behind the content, so it can produce no layout shift', async ({
    page,
  }) => {
    await page.goto(SHELL_ROUTE)
    const style = await page
      .locator('[aria-hidden="true"]')
      .filter({ has: page.locator('svg[role="presentation"]') })
      .evaluate((el) => {
        const computed = getComputedStyle(el)
        return { position: computed.position, zIndex: computed.zIndex }
      })

    expect(style.position).toBe('fixed')
    expect(Number(style.zIndex)).toBeLessThan(0)
  })

  test('does not animate, at either motion preference', async ({ browser }) => {
    /**
     * The motif is deliberately static rather than merely reduced-motion safe.
     *
     * It is `position: fixed`, so it is on screen on every route for the whole
     * visit. An animation there is not a moment, it is a permanent repaint on
     * every page the site has. This asserts the absence at BOTH preferences,
     * because a background that animates only for users who have not asked for
     * less motion is still a background that never stops moving.
     */
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const context = await browser.newContext({ reducedMotion })
      const page = await context.newPage()
      await page.goto(SHELL_ROUTE)

      const animated = await page.evaluate(() => {
        const container = document.querySelector(
          '[aria-hidden="true"]:has(svg[role="presentation"])'
        )
        if (!container) return ['the field motif was not found']
        const offenders: string[] = []
        for (const element of [container, ...container.querySelectorAll('*')]) {
          const style = getComputedStyle(element)
          if (style.animationName !== 'none') offenders.push(style.animationName)
          if (element.getAnimations().length > 0) offenders.push('web animation')
        }
        return offenders
      })

      expect(animated, `the field motif animates at ${reducedMotion}`).toEqual([])
      await context.close()
    }
  })
})

test.describe('typography is bundled, never fetched', () => {
  test('makes no font request to a third-party host', async ({ page }) => {
    /**
     * `content-integrity.spec.ts` already asserts that the site makes no
     * third-party request at all. This narrows it to the one that a typography
     * change is most likely to reintroduce: swapping `next/font/local` for
     * `next/font/google` produces a build-time fetch AND, for a stylesheet
     * added by hand, a runtime one. The failure is silent on a machine with the
     * font cached.
     */
    const foreign: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        foreign.push(request.url())
      }
    })

    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path, { waitUntil: 'networkidle' })
    }

    expect(foreign, 'the site fetched something from a third-party host').toEqual([])
  })

  test('serves all three faces from this origin, and preloads two', async ({ page }) => {
    const fonts: string[] = []
    page.on('response', (response) => {
      if (response.url().includes('.woff2')) fonts.push(response.url())
    })

    await page.goto(SHELL_ROUTE, { waitUntil: 'networkidle' })

    // Preloaded faces are requested on the first paint: the sans and the serif
    // display. The monospace is deliberately not preloaded.
    expect(fonts.length, 'no font was served from this origin').toBeGreaterThan(0)
    for (const url of fonts) {
      expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
    }

    const preloads = await page.$$eval('link[rel="preload"][as="font"]', (links) =>
      links.map((link) => link.getAttribute('href') ?? '')
    )
    expect(preloads.length, 'expected exactly two preloaded faces').toBe(2)
  })

  test('sets the display face to a serif and the body to a sans', async ({ page }) => {
    /**
     * Asserted through the generic at the end of each fallback chain, not
     * through a family name. `next/font/local` derives the CSS family name from
     * the EXPORT IDENTIFIER - the display face computes to `sourceSerif`, never
     * to "Source Serif 4" - so a test naming the font would break on a rename
     * that changed nothing a visitor sees, and would still pass if someone
     * pointed that same export at a sans file.
     *
     * What matters is that the two are different families and that the display
     * face resolves to a serif. That is the substance of the two-family pairing
     * the direction asks for.
     */
    await page.goto(SHELL_ROUTE)

    const headline = await page.$eval('h1', (el) => getComputedStyle(el).fontFamily)
    // The hero's supporting copy, by its text. NOT `page.$eval('p', ...)`: the
    // first paragraph in the document is the eyebrow, which is deliberately
    // monospace, so the generic selector was testing the wrong of the three
    // families and reported the mono chain as a failure to be sans.
    //
    // Anchored on a phrase from the product hero. It used to anchor on "More than
    // 25 years of automotive retail experience", which was the hero's first line
    // until the home page stopped being about the author.
    // The technical destination's own lede, by its text. NOT `page.$eval('p',
    // ...)`: the first paragraph in the document is the eyebrow, which is
    // deliberately monospace, so the generic selector was testing the wrong of the
    // three faces. The sentence this used to locate belonged to the retired home
    // page's store story and is a section of `?view=overview` now.
    const body = await page
      .getByText('Nothing here queries a database at request time', { exact: false })
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)

    expect(headline, 'the headline and body share a family').not.toBe(body)
    expect(headline, 'the hero headline does not fall back to a serif').toContain('serif')
    expect(headline, 'the hero headline falls back to a sans').not.toContain('sans-serif')
    expect(body, 'body copy does not fall back to a sans').toContain('sans-serif')

    // A bundled face is first in each chain, so neither starts with a generic.
    expect(headline.startsWith('ui-'), 'no bundled serif is loaded').toBe(false)
    expect(body.startsWith('ui-'), 'no bundled sans is loaded').toBe(false)

    // An unresolved token would mean the family never applied at all.
    for (const chain of [headline, body]) expect(chain).not.toContain('--font')
  })
})
