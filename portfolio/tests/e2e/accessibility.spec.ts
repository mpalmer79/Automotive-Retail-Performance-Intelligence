import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered } from './helpers'
import {
  ALL_TESTED_ROUTES,
  DRILL_THROUGH_ROUTES,
  PRIMARY_ROUTES,
  VIEWPORTS,
} from './routes'

/**
 * Accessibility tests.
 *
 * Two layers, because automated checking and manual checking catch different
 * things and neither substitutes for the other:
 *
 *   1. axe-core across every route, at the WCAG 2.0/2.1/2.2 A and AA rule sets.
 *      Zero critical or serious violations is the bar. axe covers roughly a third
 *      to a half of WCAG failures - it is a floor, not a certificate.
 *   2. Explicit assertions for the things axe cannot judge: heading hierarchy,
 *      skip-link behaviour, focus visibility, focus handling on route change,
 *      keyboard operation of the diagrams, target size, and reflow.
 *
 * Documented in portfolio/docs/ACCESSIBILITY.md.
 */

/** Settle the page: fonts loaded, reveals fired, no in-flight animation. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    const step = window.innerHeight * 0.6
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

test.describe('axe-core', () => {
  /*
   * Triple the default timeout for this sweep, and only for this sweep.
   *
   * axe-core's cost scales with the size of the accessibility tree, and the three
   * store routes render their store's complete inventory table: up to 318 rows of
   * ten cells, which is several thousand extra nodes for the scan to walk. Timed
   * in isolation those routes take 11 to 17 seconds; under the suite's two
   * parallel workers, on a loaded machine, they intermittently crossed the 45
   * second default and failed as a timeout rather than as a violation.
   *
   * The alternative - paginating the store tables so the DOM stays small - would
   * be shrinking the thing under test to fit the test. The tables are complete on
   * purpose, and a complete table is what a reviewer should be able to audit.
   */
  test.slow()

  for (const route of [...ALL_TESTED_ROUTES, ...DRILL_THROUGH_ROUTES]) {
    test(`${route} has no critical or serious violation`, async ({ page }) => {
      await page.goto(route)
      await settle(page)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      )

      // Report the offending selector, not just the count. A failure message of
      // "expected 2 to be 0" makes a maintainer re-run the tool by hand.
      const detail = blocking
        .map(
          (violation) =>
            `${violation.id} (${String(violation.impact)}): ${violation.help}\n` +
            violation.nodes
              .slice(0, 3)
              .map((node) => `    ${node.target.join(' ')}`)
              .join('\n')
        )
        .join('\n')

      expect(blocking, `${route}\n${detail}`).toEqual([])
    })
  }

  test('the KPI catalogue is still clean with a filter and a search applied', async ({
    page,
  }) => {
    await page.goto('/kpis')
    await page.getByRole('button', { name: /^Inventory/ }).click()
    await page.getByLabel(/search by identifier/i).fill('aged')
    await page.waitForTimeout(300)
    // Open a KPI's detail panel, which is markup axe has not yet seen.
    await page.getByRole('button', { expanded: false }).first().click()
    await page.waitForTimeout(300)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )
    expect(blocking.map((v) => v.id)).toEqual([])
  })

  test('the mobile navigation drawer is clean while open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/architecture')
    await page.getByRole('button', { name: /open navigation menu/i }).click()
    await expect(page.locator('#mobile-navigation')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )
    expect(blocking.map((v) => v.id)).toEqual([])
  })
})

test.describe('document structure', () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.path} has exactly one h1, and it names the page`, async ({ page }) => {
      await page.goto(route.path)
      const h1s = page.locator('h1')
      await expect(h1s).toHaveCount(1)
      await expect(h1s.first()).toContainText(route.heading)
    })

    test(`${route.path} skips no heading level`, async ({ page }) => {
      await page.goto(route.path)
      await settle(page)
      const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
        elements.map((element) => Number(element.tagName.slice(1)))
      )
      expect(levels.length).toBeGreaterThan(2)
      expect(levels[0]).toBe(1)
      for (let index = 1; index < levels.length; index += 1) {
        const jump = levels[index]! - levels[index - 1]!
        expect(
          jump,
          `heading level jumped from h${String(levels[index - 1])} to h${String(levels[index])} on ${route.path}`
        ).toBeLessThanOrEqual(1)
      }
    })

    test(`${route.path} has the required landmarks`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.getByRole('banner')).toHaveCount(1)
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(page.getByRole('contentinfo')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    })
  }
})

test.describe('keyboard operation', () => {
  test('the skip link is the first focusable element and moves focus to main', async ({
    page,
  }) => {
    await page.goto('/status')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: /skip to main content/i })
    await expect(skip).toBeFocused()
    // Visible on focus - it is useless if it stays hidden.
    await expect(skip).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('every focused element has a visible focus indicator', async ({ page }) => {
    await page.goto('/')
    // Walk the first twenty tab stops and require a non-none outline on each.
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('Tab')
      const indicator = await page.evaluate(() => {
        const active = document.activeElement
        if (!active || active === document.body) return null
        const style = getComputedStyle(active)
        return {
          tag: active.tagName.toLowerCase(),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        }
      })
      if (!indicator) continue
      expect(
        indicator.outlineStyle !== 'none' && parseFloat(indicator.outlineWidth) > 0,
        `<${indicator.tag}> at tab stop ${String(index)} has no visible focus outline`
      ).toBe(true)
    }
  })

  test('the mobile drawer traps focus, closes on Escape, and restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/kpis')
    const trigger = page.getByRole('button', { name: /open navigation menu/i })
    await trigger.click()

    const drawer = page.locator('#mobile-navigation')
    await expect(drawer).toBeVisible()

    // Focus moves into the drawer rather than staying behind it.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document
              .querySelector('#mobile-navigation')
              ?.contains(document.activeElement) ?? false
        )
      )
      .toBe(true)

    // Tabbing repeatedly never escapes the drawer.
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        () =>
          document
            .querySelector('#mobile-navigation')
            ?.contains(document.activeElement) ?? false
      )
      expect(inside, `focus escaped the drawer after ${String(index + 1)} tabs`).toBe(
        true
      )
    }

    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    // Focus returns to the control that opened it.
    await expect(trigger).toBeFocused()
  })

  test('the body scroll is locked while the drawer is open and released after', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/status')
    const overflowBefore = await page.evaluate(
      () => getComputedStyle(document.body).overflowY
    )
    await page.getByRole('button', { name: /open navigation menu/i }).click()
    await expect(page.locator('#mobile-navigation')).toBeVisible()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await page.keyboard.press('Escape')
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)
    expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe(
      overflowBefore
    )
  })

  test('the architecture graph is operable by keyboard alone', async ({ page }) => {
    await page.goto('/architecture')
    const listbox = page.getByRole('listbox', { name: 'Architecture components' })
    await listbox.focus()
    await expect(listbox).toBeFocused()

    await page.keyboard.press('ArrowRight')
    const selected = page.getByRole('option', { selected: true })
    await expect(selected).toHaveCount(1)

    // Arrowing changes the selection, and the detail panel follows.
    const firstName = await selected.getAttribute('aria-label')
    await page.keyboard.press('ArrowRight')
    const secondName = await page
      .getByRole('option', { selected: true })
      .getAttribute('aria-label')
    expect(secondName).not.toBe(firstName)

    // Escape clears it.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option', { selected: true })).toHaveCount(0)
  })

  test('the data-model graph is operable by keyboard alone', async ({ page }) => {
    await page.goto('/data-model')
    const listbox = page.getByRole('listbox', { name: 'Warehouse entities' })
    await listbox.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { selected: true })).toHaveCount(1)
    await page.keyboard.press('End')
    await expect(page.getByRole('option', { selected: true })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option', { selected: true })).toHaveCount(0)
  })

  test('focus is not lost on a route change', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Status' })
      .click()
    await expect(page).toHaveURL(/\/status$/)
    // Focus must be on a real element, not nowhere.
    const activeTag = await page.evaluate(() =>
      document.activeElement?.tagName.toLowerCase()
    )
    expect(activeTag).toBeTruthy()
    expect(activeTag).not.toBe('body')
  })
})

test.describe('reflow and target size', () => {
  for (const viewport of VIEWPORTS) {
    test(`no horizontal scrolling at ${viewport.name}px`, async ({ page }) => {
      /*
       * This is the longest-running test in the suite and the timeout is raised
       * deliberately rather than left to fail intermittently.
       *
       * It walks EVERY primary route at one viewport, and each route is settled with a
       * full scroll of the document -- 70 ms per step plus a 400 ms rest -- because a
       * reveal that has not fired has no bounding box to measure. The cost is therefore
       * routes x page height, and it grew when `DASH.7` added `/dashboard/fi`, which is
       * one of the longest pages in the console: at 320 px it settles in roughly forty
       * steps on its own. Under the project's 45 s default the narrow viewports finished
       * with seconds to spare, which is not a margin -- it is a test that will fail on a
       * loaded machine and pass on a rerun, and a test that passes only on rerun is worse
       * than no test.
       *
       * Budgeted from the route count so the next increment does not have to rediscover
       * this: 12 s of headroom plus 6 s per route.
       */
      test.setTimeout(12_000 + PRIMARY_ROUTES.length * 6_000)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      for (const route of PRIMARY_ROUTES) {
        await page.goto(route.path)
        await settle(page)

        const overflow = await page.evaluate(() => {
          window.scrollTo(99_999, 0)
          const scrolled = Math.round(window.scrollX)
          window.scrollTo(0, 0)
          if (scrolled > 0)
            return { kind: 'scroll', amount: scrolled, selector: 'document' }

          const limit = document.documentElement.clientWidth
          for (const element of document.querySelectorAll('body *')) {
            const style = getComputedStyle(element)
            if (style.position === 'fixed' || style.position === 'absolute') continue
            const box = element.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) continue
            if (box.right <= limit + 1) continue

            // Decoration is not content, and WCAG 1.4.10 is about content.
            //
            // The blue field's motif is an SVG using `preserveAspectRatio=
            // "xMidYMid slice"` inside a fixed, clipped container. `slice` means
            // that at any aspect ratio other than the viewBox's own, the drawing
            // scales to COVER and its edges fall outside the viewport - which is
            // what "cover" means, and is the same behaviour as a CSS
            // `background-size: cover` image. Such a shape has a bounding box
            // past the viewport edge while being invisible, unreachable, and
            // incapable of widening the page.
            //
            // `aria-hidden` is the right predicate rather than "is it an SVG" or
            // "is it inside a clipping ancestor". The first would exempt the two
            // explorer diagrams, which ARE content. The second would exempt any
            // genuinely truncated element, which is the defect this check exists
            // to find. An author who marks a subtree `aria-hidden` has declared
            // it carries no information, and that declaration is already
            // load-bearing for screen-reader users.
            if (element.closest('[aria-hidden="true"]')) continue

            // Content inside a scroll container is reachable, which is what
            // WCAG 1.4.10 is about.
            let ancestor = element.parentElement
            let reachable = false
            while (ancestor && ancestor !== document.body) {
              const ancestorStyle = getComputedStyle(ancestor)
              if (
                ancestorStyle.overflowX === 'auto' ||
                ancestorStyle.overflowX === 'scroll'
              ) {
                reachable = true
                break
              }
              ancestor = ancestor.parentElement
            }
            if (reachable) continue
            return {
              kind: 'clipped',
              amount: Math.round(box.right - limit),
              selector: `${element.tagName.toLowerCase()}.${(element.className || '').toString().split(' ')[0] ?? ''}`,
            }
          }
          return null
        })

        expect(
          overflow,
          `${route.path} at ${String(viewport.width)}px: ${JSON.stringify(overflow)}`
        ).toBeNull()
      }
    })
  }

  test('no horizontal scrolling at 200% zoom', async ({ page }) => {
    // 200% zoom presents to CSS as half the layout width.
    await page.setViewportSize({ width: 640, height: 512 })
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route.path)
      await settle(page)
      const scrolled = await page.evaluate(() => {
        window.scrollTo(99_999, 0)
        const x = Math.round(window.scrollX)
        window.scrollTo(0, 0)
        return x
      })
      expect(scrolled, `${route.path} scrolls sideways at 200% zoom`).toBe(0)
    }
  })

  test('primary controls meet the 44px target-size floor', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    // The hero's two calls to action and the navigation trigger are the controls
    // a visitor must be able to hit on a phone.
    const controls: { role: 'link' | 'button'; name: RegExp }[] = [
      { role: 'link', name: /open the inventory explorer/i },
      { role: 'link', name: /see how it is built/i },
      { role: 'button', name: /open navigation menu/i },
    ]
    for (const control of controls) {
      const locator = page.getByRole(control.role, { name: control.name }).first()
      const box = await locator.boundingBox()
      expect(box, `no box for ${String(control.name)}`).not.toBeNull()
      expect(
        box!.height,
        `${String(control.name)} is ${String(box!.height)}px tall`
      ).toBeGreaterThanOrEqual(43)
      expect(
        box!.width,
        `${String(control.name)} is ${String(box!.width)}px wide`
      ).toBeGreaterThanOrEqual(43)
    }
  })
})

test.describe('no hover-only or tooltip-only information', () => {
  test('every filter chip is a real button with a pressed state', async ({ page }) => {
    await page.goto('/kpis')
    // The catalogue sits behind a Suspense boundary, so its controls do not
    // exist on the first paint. Wait for the search field before counting.
    await expect(page.getByLabel(/search by identifier/i)).toBeVisible()
    const chips = page.locator('fieldset button[aria-pressed]')
    // Five domain filters and three status filters.
    await expect(chips).toHaveCount(8)
  })

  test('the operating view changes domain on click, not on hover', async ({ page }) => {
    // Replaces the same check against the six expandable domain cards this
    // section used to carry. The cards are gone; the rail that replaced them has
    // the identical obligation.
    //
    // Loaded from `/kpis` rather than `/`. The rail moved there with the page's
    // word-count pass, because six domains with one definition each is reference
    // material and the catalogue is the page whose subject it is. The obligation
    // travelled with it unchanged.
    await gotoRendered(page, '/kpis')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    const inventory = tablist.getByRole('tab', { name: /inventory/i })
    await inventory.scrollIntoViewIfNeeded()

    // Hovering must not select it. A hover-only selector is unreachable on
    // touch and invisible to a keyboard.
    await inventory.hover()
    await page.waitForTimeout(250)
    await expect(inventory).toHaveAttribute('aria-selected', 'false')

    // Clicking must.
    //
    // The panel is located THROUGH `#operating-view` rather than by role alone.
    // The home page now carries four tab sets - the hero's store switcher, the
    // store chapter, the product tour and this rail - so a bare
    // `getByRole('tabpanel')` resolves to four elements and fails strict mode
    // before it ever checks the text. Scoping the locator is what keeps this
    // assertion about the operating view specifically.
    await inventory.click()
    await expect(inventory).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#operating-view').getByRole('tabpanel')).toContainText(
      /lot turning|financially risky/i
    )
  })

  test('the operating view is fully operable from the keyboard', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    const tablist = page.getByRole('tablist', { name: /analytical domain/i })
    // Roving tabindex: exactly one tab is in the tab order at a time, which is
    // what stops a six-item rail costing a keyboard user six tab stops.
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)

    await tablist.locator('[role="tab"][tabindex="0"]').focus()
    await page.keyboard.press('End')
    await expect(tablist.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
    // And the selection wraps rather than dead-ending at the last item.
    await page.keyboard.press('ArrowRight')
    await expect(tablist.getByRole('tab').first()).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
