/**
 * `UX.2B`: the five revenue and vehicle routes are workspaces, measured rather than judged.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE PER-ROUTE SUITES. `dashboard-sales-gross.spec.ts`,
 * `dashboard-deals.spec.ts`, `dashboard-inventory.spec.ts` and `dashboard-fi.spec.ts` ask
 * whether the figures on the screen are the exported figures — a question about correctness.
 * This one asks whether the manager who opened the route can SEE them, which is a question
 * about geometry, and every assertion below is an element offset against a stated viewport at
 * a width the increment names.
 *
 * The before-figures every assertion is calibrated against are in
 * `docs/reviews/UX-2B-BASELINE.md`, measured on the merge of `UX.2A`: four of the five routes
 * contained NO framed figure at all, and the fifth put its first one 2,752 px down.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered, mainTextContent, settle } from './helpers'

/** The visual regions whose top edge falls inside the first viewport. */
async function foldRegions(page: Page): Promise<readonly string[]> {
  await settle(page)
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-visual-region]')]
      .filter(
        (node) => node.getBoundingClientRect().top + window.scrollY < window.innerHeight
      )
      .map((node) => node.getAttribute('data-visual-region') ?? '')
  )
}

/** The offset of the first framed figure, or `null` when there is none. */
async function firstFigureOffset(page: Page): Promise<number | null> {
  await settle(page)
  return page.evaluate(() => {
    const offsets = [...document.querySelectorAll('main figure, main svg[role="img"]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width !== 0 || rect.height !== 0
      })
      .map((node) => Math.round(node.getBoundingClientRect().top + window.scrollY))
    return offsets.length === 0 ? null : Math.min(...offsets)
  })
}

/* -------------------------------------------------------------------------- */
/* The first-viewport contracts (`UX.2B` §49)                                  */
/* -------------------------------------------------------------------------- */

test.describe('the first viewport carries data, not an introduction', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Sales & Gross shows the rail, the trend and both comparisons', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/sales-gross')
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    const data = regions.filter((name) => name !== 'kpi-rail')
    expect(data, `data regions inside the first viewport: ${data.join(', ')}`).toEqual([
      'trend',
      'store-comparison',
      'condition-split',
    ])
  })

  test('Sales & Gross begins its first framed figure inside the first viewport', async ({
    page,
  }) => {
    // The baseline was 2,752 px — three screens down. The ceiling is the viewport height:
    // the figure must START on the first screen. Pinned to the claim, never to a pixel.
    await gotoRendered(page, '/dashboard/sales-gross')
    const offset = await firstFigureOffset(page)
    expect(offset, 'no framed figure on the route').not.toBeNull()
    expect(offset, `first figure at ${String(offset)} px`).toBeLessThan(900)
  })

  test('Sales & Gross holds the contract under a filter, not only on the default', async ({
    page,
  }) => {
    // A layout that only meets its contract on the default query meets it by coincidence.
    for (const query of [
      '?store=GSA-001&period=2025-11',
      '?condition=Used',
      '?period=2025-09&compare=none',
    ]) {
      await gotoRendered(page, `/dashboard/sales-gross${query}`)
      const data = (await foldRegions(page)).filter((name) => name !== 'kpi-rail')
      expect(
        data.length,
        `${query} put ${String(data.length)} data regions in the first viewport`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  test('the Deal Explorer shows the filters, the population and real rows', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/deals')

    const filters = page.getByRole('form', { name: 'Dashboard filters' })
    await expect(filters).toBeVisible()

    const summaryBottom = await page
      .locator('[data-deal-summary="total-gross"]')
      .evaluate((node) => node.getBoundingClientRect().bottom + window.scrollY)
    expect(summaryBottom, 'the population summary is below the fold').toBeLessThan(900)

    const rowsInView = await page.evaluate(
      () =>
        [...document.querySelectorAll('main table tbody tr')].filter(
          (node) =>
            node.getBoundingClientRect().height > 0 &&
            node.getBoundingClientRect().top + window.scrollY < window.innerHeight
        ).length
    )
    expect(rowsInView, 'no transaction row is inside the first viewport').toBeGreaterThan(
      0
    )
  })

  test('the Deal Jacket shows the deal identity and both economics', async ({ page }) => {
    await gotoRendered(page, '/dashboard/deals/SLE-00000646')

    // The five figures, all of them, above the fold.
    const figures = await page.evaluate(() =>
      [...document.querySelectorAll('[data-deal-figure]')]
        .filter(
          (node) =>
            node.getBoundingClientRect().bottom + window.scrollY < window.innerHeight
        )
        .map((node) => node.getAttribute('data-deal-figure') ?? '')
    )
    expect(figures).toEqual([
      'sale-price',
      'total-gross',
      'front-gross',
      'back-gross',
      'days-in-stock',
    ])

    const regions = await foldRegions(page)
    expect(regions).toContain('deal-headline')
    expect(regions).toContain('front-economics')
  })

  test('Inventory shows the position rail and the age and capital stack', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/inventory')
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    expect(regions).toContain('age-stack')
    const offset = await firstFigureOffset(page)
    expect(offset, 'no framed figure on the route').not.toBeNull()
    expect(offset, `first figure at ${String(offset)} px`).toBeLessThan(900)
  })

  test('F&I shows the rail and the gross and structure visuals', async ({ page }) => {
    await gotoRendered(page, '/dashboard/fi')
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    expect(regions).toContain('back-composition')
    expect(regions).toContain('structure-mix')
  })
})

/* -------------------------------------------------------------------------- */
/* Mobile priority (`UX.2B` §50)                                               */
/* -------------------------------------------------------------------------- */

test.describe('the phone meets business state before methodology', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Sales & Gross opens with units, gross and GPRU', async ({ page }) => {
    await gotoRendered(page, '/dashboard/sales-gross')
    const lead = await page.evaluate(() =>
      [...document.querySelectorAll('[data-kpi-rank="lead"]')].map((node) =>
        node.getAttribute('data-kpi-card')
      )
    )
    expect(lead).toEqual(['retail-units', 'total-gross', 'total-pvr'])
    const railTop = await page
      .locator('[data-visual-region="kpi-rail"]')
      .evaluate((node) => node.getBoundingClientRect().top + window.scrollY)
    expect(railTop, `the rail begins at ${String(railTop)} px`).toBeLessThan(844)
  })

  test('the Deal Jacket opens with the deal identity and its economics', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/deals/SLE-00000646')
    const headlineTop = await page
      .locator('[data-visual-region="deal-headline"]')
      .evaluate((node) => node.getBoundingClientRect().top + window.scrollY)
    expect(headlineTop).toBeLessThan(844)
  })

  test('F&I opens with back PVR, reserve PVR and product PVR', async ({ page }) => {
    await gotoRendered(page, '/dashboard/fi')
    const figures = await page.evaluate(() =>
      [...document.querySelectorAll('[data-fi-figure]')]
        .slice(0, 3)
        .map((node) => node.getAttribute('data-fi-figure'))
    )
    expect(figures).toEqual(['back-pvr', 'reserve-pvr', 'product-pvr'])
  })

  test('no route puts a methodology disclosure above its first figure', async ({
    page,
  }) => {
    /*
     * `UX.2B` §50: do not show methodology before business state. The control band's
     * provenance disclosure is a summary line rather than a body of prose — what this
     * asserts is that the route's OWN methodology region, where it has one, is below every
     * figure on the page.
     */
    for (const route of ['/dashboard/sales-gross', '/dashboard/fi']) {
      await gotoRendered(page, route)
      const offsets = await page.evaluate(() => {
        const top = (selector: string): number | null => {
          const node = document.querySelector(selector)
          return node === null
            ? null
            : Math.round(node.getBoundingClientRect().top + window.scrollY)
        }
        return { methodology: top('#methodology'), rail: top('[data-visual-region]') }
      })
      if (offsets.methodology === null || offsets.rail === null) continue
      expect(
        offsets.rail,
        `${route} puts methodology above its first region`
      ).toBeLessThan(offsets.methodology)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The responsive matrix (`UX.2B` §61)                                         */
/* -------------------------------------------------------------------------- */

const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440, 1920] as const

const ROUTES = [
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/deals/SLE-00000646',
  '/dashboard/inventory',
  '/dashboard/fi',
] as const

test.describe('no transformed route overflows its viewport at any width', () => {
  for (const route of ROUTES) {
    test(`${route} fits every width in the matrix`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await gotoRendered(page, route)
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        /*
         * One pixel of tolerance, for the reason every responsive suite in this repository
         * carries it: a fractional layout width rounds up in the scroll metric and reports
         * an overflow the eye cannot see. Anything a reader would actually have to scroll
         * sideways for is far larger than this.
         */
        expect(
          overflow,
          `${route} overflows by ${String(overflow)} px at ${String(width)}`
        ).toBeLessThanOrEqual(1)
      }
    })
  }
})

test.describe('exactly one representation of a row reaches the accessibility tree', () => {
  test('the Deal Explorer never renders its table and its cards together', async ({
    page,
  }) => {
    for (const width of [390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/dashboard/deals')
      const counts = await page.evaluate(() => {
        const visible = (node: Element): boolean => {
          const rect = node.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        return {
          rows: [...document.querySelectorAll('main table tbody tr')].filter(visible)
            .length,
          cards: [...document.querySelectorAll('main ul > li')].filter(visible).length,
        }
      })
      expect(
        counts.rows === 0 || counts.cards === 0,
        `${String(width)}px renders ${String(counts.rows)} rows and ${String(counts.cards)} cards`
      ).toBe(true)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Without JavaScript (`UX.2B` §52)                                            */
/* -------------------------------------------------------------------------- */

test.describe('the core business content survives with scripting disabled', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } })

  test('Sales & Gross keeps its rail, its trend, its comparisons and its bridge', async ({
    page,
  }) => {
    await page.goto('/dashboard/sales-gross')
    const text = await mainTextContent(page)
    for (const fragment of [
      'Retail units',
      'Total gross',
      'Total PVR',
      'Store contribution',
      'New and used',
      'What the bridge attributes the change to',
    ]) {
      expect(text, `"${fragment}" is missing without JavaScript`).toContain(fragment)
    }
    // The measure switch is a radio group and CSS: all three panels are in the document.
    await expect(page.locator('input[name="sales-trend"]')).toHaveCount(3)
  })

  test('the Deal Explorer keeps its summary and its table', async ({ page }) => {
    await page.goto('/dashboard/deals')
    await expect(page.locator('[data-deal-summary]')).not.toHaveCount(0)
    await expect(page.locator('main table')).not.toHaveCount(0)
  })

  test('the Deal Jacket keeps its identity figures and both economics', async ({
    page,
  }) => {
    await page.goto('/dashboard/deals/SLE-00000646')
    await expect(page.locator('[data-deal-figure]')).toHaveCount(5)
    const text = await mainTextContent(page)
    expect(text).toContain('Where the front gross came from')
    expect(text).toContain('What the finance office made')
  })

  test('Inventory keeps its rail, its age bands and its unit table', async ({ page }) => {
    await page.goto('/dashboard/inventory')
    await expect(page.locator('[data-inventory-figure]')).toHaveCount(6)
    const text = await mainTextContent(page)
    expect(text).toContain('Units and investment by age band')
    expect(text).toContain('Days in stock against price to market')
  })

  test('F&I keeps its rail, its structure mix and its penetration', async ({ page }) => {
    await page.goto('/dashboard/fi')
    await expect(page.locator('[data-fi-figure]')).toHaveCount(6)
    const text = await mainTextContent(page)
    expect(text).toContain('How the deliveries were funded')
    expect(text).toContain('What was sold, against what could have been')
    // Every eligible denominator, in the document, without a script.
    expect(text).toContain('ELIG-GAP')
  })
})

/* -------------------------------------------------------------------------- */
/* Drill-through and filter continuity (`UX.2B` §46, §47)                      */
/* -------------------------------------------------------------------------- */

test.describe('a drill-through carries the context and resolves', () => {
  test('Sales & Gross to the Deal Explorer keeps period and store', async ({ page }) => {
    await gotoRendered(page, '/dashboard/sales-gross?store=GSA-001&period=2025-11')
    const href = await page
      .getByRole('link', { name: /Deal Explorer/i })
      .first()
      .getAttribute('href')
    expect(href).toContain('period=2025-11')
    expect(href).toContain('store=GSA-001')
    // And the destination renders rather than 404s or resets.
    await gotoRendered(page, href ?? '/dashboard/deals')
    await expect(page.locator('h1')).toContainText('Deal Explorer')
    expect(await mainTextContent(page)).toContain('Granite Chevrolet')
  })

  test('the Deal Explorer back to Sales & Gross drops what that route cannot apply', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/deals?store=GSA-002&period=2025-10&q=SLE')
    const href = await page
      .getByRole('link', { name: /Sales & Gross for this scope/i })
      .getAttribute('href')
    expect(href).toContain('store=GSA-002')
    expect(href).toContain('period=2025-10')
    // The search term is the Deal Explorer's own parameter and means nothing on an
    // aggregate surface. `UX.2B` §46 forbids appending a parameter the destination ignores.
    expect(href).not.toContain('q=')
    await gotoRendered(page, href ?? '/dashboard/sales-gross')
    await expect(page.locator('h1')).toContainText('Sales & Gross')
  })

  test('a deal id opens its jacket from the table and from a card', async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/dashboard/deals')
      const href = await page
        .getByRole('link', { name: /^SLE-\d+$/ })
        .first()
        .getAttribute('href')
      expect(href, `no deal link at ${String(width)}px`).toMatch(
        /\/dashboard\/deals\/SLE-/
      )
      await gotoRendered(page, href ?? '/dashboard/deals')
      await expect(page.locator('[data-deal-figure="total-gross"]')).toBeVisible()
    }
  })

  test('the inventory map points at a table that is on the page', async ({ page }) => {
    await gotoRendered(page, '/dashboard/inventory')
    const href = await page
      .getByRole('link', { name: /the unit table below/i })
      .getAttribute('href')
    expect(href).toBe('#units')
    await expect(page.locator('#units')).toBeVisible()
  })
})

/* -------------------------------------------------------------------------- */
/* Keyboard reach (`UX.2B` §30, §51)                                           */
/* -------------------------------------------------------------------------- */

test.describe('every new visual is reachable without a pointer', () => {
  test('the trend measure switch moves with the keyboard', async ({ page }) => {
    await gotoRendered(page, '/dashboard/sales-gross')
    const radios = page.locator('input[name="sales-trend"]')
    await expect(radios).toHaveCount(3)
    await radios.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(radios.nth(1)).toBeChecked()
    await page.keyboard.press('ArrowRight')
    await expect(radios.nth(2)).toBeChecked()
  })

  test('the age and price map is focusable and carries its summary as text', async ({
    page,
  }) => {
    await gotoRendered(page, '/dashboard/inventory')
    const map = page.locator('[data-inventory-map="age-price"]')
    await expect(map).toHaveAttribute('role', 'img')
    const label = await map.getAttribute('aria-label')
    expect(label ?? '').toContain(
      'units plotted by days in stock against price to market'
    )
    await map.focus()
    await expect(map).toBeFocused()
  })
})
