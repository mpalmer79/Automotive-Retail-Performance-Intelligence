/**
 * `UX.2D`: the shared control band, measured, and the context that survives a navigation.
 *
 * WHY THIS IS A SEPARATE FILE. `dashboard-filters.spec.ts` asks whether a filter FILTERS —
 * whether the figures change when the URL does. This one asks two different questions:
 * whether a manager on a phone can SEE a figure without scrolling past the controls, and
 * whether the scope they chose is still with them one navigation later. Both are geometry
 * and navigation rather than arithmetic, and both are the things `UX.2D` changed.
 *
 * The before-figures every ceiling below is calibrated against are in
 * `docs/reviews/UX-2D-BASELINE.md`, measured on the merge of `UX.2C`: the control band was
 * 548 px to 921 px at 390 × 844 — 65% to 109% of one phone screen — and no operating route
 * put a complete figure inside the first mobile screen.
 *
 * THE CEILINGS ARE CEILINGS, NOT PIXEL-PERFECT SNAPSHOTS. `UX.2D` §61 asks for headroom
 * broad enough that a route can grow a control and narrow enough that the band cannot
 * return to a 900 px stack. Each number below is stated with the measurement it was set
 * from and the room it leaves.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered, settle } from './helpers'

/** Every operating route that renders the shared control band. */
const FILTERED_ROUTES: readonly string[] = [
  '/',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/inventory',
  '/dashboard/fi',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
]

/** The first `<section>` of `<main>`: everything above the data canvas. */
async function bandHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const band = document.querySelector('main section')
    return band === null ? -1 : Math.round(band.getBoundingClientRect().height)
  })
}

async function documentOverflows(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
}

/* -------------------------------------------------------------------------- */
/* 1. The band, on a phone (`UX.2D` §6, §8, §18)                               */
/* -------------------------------------------------------------------------- */

test.describe('the control band leaves the phone screen to the data', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /*
   * 470 px, against a 844 px screen and against a measured baseline of 548-921.
   *
   * The tallest band after the change is Inventory at 439 px, which carries two visible
   * caveats and a disclosure the other routes do not have; the next is F&I at 392. The
   * ceiling leaves Inventory 31 px and every other route at least 78, which is room for a
   * chip row to wrap without the suite going red, and it is 451 px below where Inventory
   * was.
   */
  const PHONE_BAND_CEILING = 470

  for (const route of FILTERED_ROUTES) {
    test(`${route} opens in under ${String(PHONE_BAND_CEILING)} px`, async ({ page }) => {
      await gotoRendered(page, route)
      const height = await bandHeight(page)
      expect(height).toBeGreaterThan(0)
      expect(height).toBeLessThanOrEqual(PHONE_BAND_CEILING)
    })
  }

  test('the controls are collapsed, and their summary is the way in', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/inventory')
    const controls = page.locator('[data-operating-controls]')
    await expect(controls).toHaveCount(1)
    await expect(controls.locator('> summary')).toBeVisible()
    await expect(page.locator('#filter-period')).toBeHidden()
  })

  test('opening the summary reveals the same native form', async ({ page }) => {
    await gotoRendered(page, '/dashboard/inventory')
    await page.locator('[data-operating-controls] > summary').click()
    await expect(page.locator('#filter-period')).toBeVisible()
    await expect(page.locator('form[aria-label="Dashboard filters"]')).toBeVisible()
    // The disclosure's own state, which is what a screen reader announces.
    expect(
      await page.locator('[data-operating-controls]').evaluate((node) => {
        return (node as HTMLDetailsElement).open
      })
    ).toBe(true)
  })

  test('the keyboard reaches and toggles the summary', async ({ page }) => {
    await gotoRendered(page, '/dashboard/sales-gross')
    const summary = page.locator('[data-operating-controls] > summary')
    await summary.focus()
    await expect(summary).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#filter-period')).toBeVisible()
  })

  test('the first visual region starts inside the first screen', async ({ page }) => {
    // `UX.2D` §18: route identity, scope, then business state — not a filter form.
    for (const route of ['/', '/dashboard/sales-gross', '/dashboard/inventory']) {
      await gotoRendered(page, route)
      await settle(page)
      const top = await page.evaluate(() => {
        const first = document.querySelector('[data-visual-region]')
        return first === null
          ? -1
          : Math.round(first.getBoundingClientRect().top + window.scrollY)
      })
      expect(top, route).toBeGreaterThan(0)
      expect(top, route).toBeLessThan(844)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The band, on a desktop (`UX.2D` §7)                                      */
/* -------------------------------------------------------------------------- */

test.describe('the controls are simply the band on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('no disclosure is offered and every control is visible', async ({ page }) => {
    await gotoRendered(page, '/dashboard/inventory')
    await expect(page.locator('[data-operating-controls] > summary')).toBeHidden()
    await expect(page.locator('#filter-period')).toBeVisible()
    await expect(page.locator('#filter-store')).toBeVisible()
    await expect(page.locator('#filter-condition')).toBeVisible()
  })

  test('the band stays compact across every filtered route', async ({ page }) => {
    /*
     * 520 px. The measured range after the change is 200-486, against a baseline
     * range of 230-494 — the desktop band was already close to right and `UX.2D`
     * §7's job there was to stop it drifting rather than to shrink it.
     */
    for (const route of FILTERED_ROUTES) {
      await gotoRendered(page, route)
      expect(await bandHeight(page), route).toBeLessThanOrEqual(520)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Without JavaScript (`UX.2D` §8, §64, §98)                                */
/* -------------------------------------------------------------------------- */

test.describe('the control architecture needs no JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('a phone reader can open the controls and submit them', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/sales-gross')
    await page.locator('[data-operating-controls] > summary').click()
    await expect(page.locator('#filter-period')).toBeVisible()

    await page.selectOption('#filter-period', '2025-11')
    await page
      .locator('form[aria-label="Dashboard filters"] button[type="submit"]')
      .click()
    await page.waitForURL(/period=2025-11/)
    expect(new URL(page.url()).searchParams.get('period')).toBe('2025-11')
  })

  test('a desktop reader gets the controls with nothing to open', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/sales-gross')
    await expect(page.locator('#filter-period')).toBeVisible()
    await expect(page.locator('[data-operating-controls] > summary')).toBeHidden()
  })

  test('reset and chip removal are links, so they work too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/inventory?store=GSA-002&condition=Used')
    await page.locator('[data-filter-chip="condition"]').click()
    await page.waitForURL(/store=GSA-002/)
    expect(new URL(page.url()).searchParams.get('condition')).toBeNull()
    expect(new URL(page.url()).searchParams.get('store')).toBe('GSA-002')

    await page.locator('[data-filter-reset]').click()
    await page.waitForURL((url) => url.searchParams.toString() === '')
    expect(new URL(page.url()).search).toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* 4. One active-filter summary, on every route (`UX.2D` §2, §7)               */
/* -------------------------------------------------------------------------- */

test.describe('every route can undo a filter', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const route of FILTERED_ROUTES) {
    test(`${route} offers removal and reset`, async ({ page }) => {
      await gotoRendered(page, `${route}${route.includes('?') ? '&' : '?'}store=GSA-002`)
      await expect(page.locator('[data-filter-chip="store"]')).toBeVisible()
      await expect(page.locator('[data-filter-reset]')).toBeVisible()
    })
  }

  test('nothing is rendered when nothing is set, rather than a sentence saying so', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    await expect(page.locator('[data-active-filters]')).toHaveCount(0)
  })
})

/* -------------------------------------------------------------------------- */
/* 5. The scope line speaks business, not warehouse (`UX.2D` §9)               */
/* -------------------------------------------------------------------------- */

test.describe('the analytical scope names the store', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const route of [...FILTERED_ROUTES, '/dashboard/actions']) {
    test(`${route} names Granite Subaru rather than GSA-002`, async ({ page }) => {
      await gotoRendered(page, `${route}?store=GSA-002`)
      const scope = await page
        .locator('main section')
        .first()
        .evaluate((node) => node.textContent ?? '')
      expect(scope).toContain('Granite Subaru')
    })
  }
})

/* -------------------------------------------------------------------------- */
/* 6. Context survives the journey (`UX.2D` §10, §12, §62)                     */
/* -------------------------------------------------------------------------- */

test.describe('the scope travels with the reader', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Executive to Inventory keeps the store', async ({ page }) => {
    await gotoRendered(page, '/?period=2025-12&store=GSA-002')
    await page.getByRole('link', { name: /Open the units behind these figures/i }).click()
    await page.waitForURL(/\/dashboard\/inventory/)
    expect(new URL(page.url()).searchParams.get('store')).toBe('GSA-002')
  })

  test('Executive to Accounting keeps the store', async ({ page }) => {
    await gotoRendered(page, '/?period=2025-12&store=GSA-002')
    await page
      .getByRole('link', { name: /Open accounting integrity, account by account/i })
      .click()
    await page.waitForURL(/\/dashboard\/accounting/)
    expect(new URL(page.url()).searchParams.get('store')).toBe('GSA-002')
  })

  test('Inventory keeps the lot when a unit is opened', async ({ page }) => {
    await gotoRendered(page, '/dashboard/inventory?store=GSA-002&condition=Used')
    const unit = page.locator('a[href*="unit=VEH-"]').first()
    await unit.scrollIntoViewIfNeeded()
    const href = await unit.getAttribute('href')
    expect(href).toContain('store=GSA-002')
    expect(href).toContain('condition=Used')
  })

  /*
   * THE ONE CLASS OF LINK THIS SWEEP EXCLUDES, AND WHY IT IS NOT AN EXCEPTION.
   *
   * A chip's removal link and the reset link are not navigations that CARRY context;
   * they are edits to the current URL, and their contract is "remove exactly this
   * parameter and leave the rest". A removal link that also normalized the URL to the
   * route's supported set would quietly delete a second parameter the reader can see
   * on screen, labelled "not applied here", with its own chip and its own × — and the
   * chip for a `not-applicable` parameter exists precisely so a reader can remove it
   * deliberately. Predictable beats tidy. Asserted directly below.
   */
  const CARRYING_LINKS = ':not([data-filter-chip]):not([data-filter-reset])'

  test('Employees carries no parameter it declares it cannot act on', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/employees?period=2025-11&compare=prior-year')
    const hrefs = await page
      .locator(`main a[href^="/dashboard/employees"]${CARRYING_LINKS}`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href, href).not.toContain('compare')
    }
  })

  test('the Deal Explorer carries no comparison through its own sorting', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/deals?period=2025-11&compare=prior-year')
    const hrefs = await page
      .locator(`main a[href*="/dashboard/deals?"]${CARRYING_LINKS}`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href, href).not.toContain('compare')
    }
  })

  test('a chip removes exactly its own parameter and leaves the rest', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/deals?period=2025-11&compare=prior-year')
    // `compare` is declared not-applicable on this route, is shown as such, and is
    // still the reader's to remove — so removing `period` must not remove it too.
    const periodChip = await page
      .locator('[data-filter-chip="period"]')
      .getAttribute('href')
    expect(periodChip).toContain('compare=prior-year')
    expect(periodChip).not.toContain('period=')

    await page.locator('[data-filter-chip="compare"]').click()
    await page.waitForURL((url) => !url.searchParams.has('compare'))
    expect(new URL(page.url()).searchParams.get('period')).toBe('2025-11')
  })

  test('F&I reaches a finance desk, and the desk keeps the scope', async ({ page }) => {
    await gotoRendered(page, '/dashboard/fi?period=2025-12&store=GSA-002')
    const link = page.locator('main a[href*="/dashboard/employees"]').first()
    await link.scrollIntoViewIfNeeded()
    const href = await link.getAttribute('href')
    expect(href).toContain('employee=EMP-')
    expect(href).toContain('store=GSA-002')
    expect(href).toContain('role=finance')
    expect(href).not.toContain('compare')
  })

  test('a KPI identifier links to the catalogue rather than to a redirect', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/fi')
    const hrefs = await page
      .locator('main a[href*="kpis"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href, href).not.toMatch(/^\/kpis/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 7. Back, forward and a pasted URL (`UX.2D` §12)                             */
/* -------------------------------------------------------------------------- */

test.describe('the URL is the whole of the state', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('back returns the previous scope and forward returns the next', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/sales-gross')
    await page.selectOption('#filter-store', 'GSA-002')
    await page.waitForURL(/store=GSA-002/)
    await page.selectOption('#filter-period', '2025-11')
    await page.waitForURL(/period=2025-11/)

    await page.goBack()
    await page.waitForURL((url) => !url.searchParams.has('period'))
    expect(new URL(page.url()).searchParams.get('store')).toBe('GSA-002')

    await page.goForward()
    await page.waitForURL(/period=2025-11/)
    expect(new URL(page.url()).searchParams.get('period')).toBe('2025-11')
    expect(new URL(page.url()).searchParams.get('store')).toBe('GSA-002')
  })

  test('a copied URL reproduces the view in a fresh context', async ({
    page,
    context,
  }) => {
    await gotoRendered(page, '/dashboard/sales-gross?period=2025-11&store=GSA-002')
    const scope = await page.locator('main section').first().innerText()

    const pasted = await context.newPage()
    await pasted.goto('/dashboard/sales-gross?period=2025-11&store=GSA-002')
    await pasted.locator('h1').first().waitFor({ state: 'visible' })
    expect(await pasted.locator('main section').first().innerText()).toBe(scope)
    await pasted.close()
  })
})

/* -------------------------------------------------------------------------- */
/* 8. The responsive matrix, with the controls open (`UX.2D` §99)              */
/* -------------------------------------------------------------------------- */

test.describe('nothing overflows sideways, open or closed', () => {
  const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440, 1920] as const

  for (const width of WIDTHS) {
    test(`${String(width)} px keeps the page inside itself`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/', '/dashboard/inventory', '/dashboard/employees']) {
        await gotoRendered(page, route)
        expect(await documentOverflows(page), `${route} closed`).toBe(false)
        const summary = page.locator('[data-operating-controls] > summary')
        if (await summary.isVisible()) {
          await summary.click()
          expect(await documentOverflows(page), `${route} open`).toBe(false)
        }
      }
    })
  }

  test('the controls survive 200% zoom', async ({ page }) => {
    // 200% zoom at 1280 presents as a 640 px layout viewport, which is below the
    // breakpoint: the disclosure is the phone one, and it must still be usable.
    await page.setViewportSize({ width: 640, height: 512 })
    await gotoRendered(page, '/dashboard/inventory')
    expect(await documentOverflows(page)).toBe(false)
    const summary = page.locator('[data-operating-controls] > summary')
    await expect(summary).toBeVisible()
    const box = await summary.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
    await summary.click()
    await expect(page.locator('#filter-period')).toBeVisible()
    expect(await documentOverflows(page)).toBe(false)
  })

  test('the summary meets the minimum touch target on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await gotoRendered(page, '/dashboard/accounting')
    const box = await page.locator('[data-operating-controls] > summary').boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})
