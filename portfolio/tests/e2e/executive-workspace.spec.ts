/**
 * `UX.2A`: the first-viewport contract, the responsive flow, and the switch.
 *
 * WHY THIS IS A SEPARATE FILE FROM `dashboard.spec.ts`. That suite asks whether the
 * figures on the screen are the exported figures — a question about correctness. This one
 * asks whether a general manager can SEE them, which is a question about geometry, and it
 * is measured rather than judged: element offsets against a stated viewport, at the widths
 * the increment names.
 *
 * The before-figures every assertion here is calibrated against are in
 * `docs/reviews/UX-2-BASELINE.md`, measured on the merge of `DASH.12`: at 1440 × 900 the
 * route put its first framed figure 1,389 px down and its first viewport contained ZERO
 * data-driven visual regions.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoRendered, mainTextContent, settle } from './helpers'

const ROUTE = '/'

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
    const figures = [...document.querySelectorAll('main figure, main svg[role="img"]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width !== 0 || rect.height !== 0
      })
      .map((node) => Math.round(node.getBoundingClientRect().top + window.scrollY))
    return figures.length === 0 ? null : Math.min(...figures)
  })
}

/* -------------------------------------------------------------------------- */
/* The first viewport                                                          */
/* -------------------------------------------------------------------------- */

test.describe('the first viewport is a workspace, not an introduction', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('carries the controls, the KPI rail and at least three data regions', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)

    // A. the controls.
    const filters = page.getByRole('form', { name: 'Dashboard filters' })
    await expect(filters).toBeVisible()
    expect(
      await filters.evaluate((node) => node.getBoundingClientRect().bottom)
    ).toBeLessThan(900)

    // B. the KPI rail, whole.
    const cards = page.locator('[data-kpi-card]')
    await expect(cards).toHaveCount(8)
    const railBottom = await page
      .locator('[data-visual-region="kpi-rail"]')
      .evaluate((node) => node.getBoundingClientRect().bottom)
    expect(railBottom).toBeLessThan(900)

    // C. at least three data-driven visual regions BESIDE the rail.
    const regions = await foldRegions(page)
    expect(regions).toContain('kpi-rail')
    const dataRegions = regions.filter((name) => name !== 'kpi-rail')
    expect(
      dataRegions,
      `data regions inside the first viewport: ${dataRegions.join(', ')}`
    ).toHaveLength(3)
    expect(dataRegions).toEqual(['trend', 'store-comparison', 'pace'])
  })

  test('begins its first framed figure inside the first viewport', async ({ page }) => {
    /*
     * The baseline was 1,389 px — one and a half screens down. The ceiling here is 900:
     * the figure must START on the first screen. It is not pinned to the measured value,
     * because pinning a pixel fails on any honest copy edit; it is pinned to the claim.
     */
    await gotoRendered(page, ROUTE)
    const offset = await firstFigureOffset(page)
    expect(offset, 'no framed figure on the route').not.toBeNull()
    expect(offset, `first figure at ${String(offset)} px`).toBeLessThan(900)
  })

  test('holds the contract under a filter, not only on the default view', async ({
    page,
  }) => {
    // A layout that only meets its contract on the default query is a layout that meets
    // it by coincidence.
    for (const query of [
      '?store=GSA-001&period=2025-11',
      '?condition=Used',
      '?period=2025-09&compare=none',
    ]) {
      await gotoRendered(page, `${ROUTE}${query}`)
      const regions = await foldRegions(page)
      expect(
        regions.filter((name) => name !== 'kpi-rail').length,
        query
      ).toBeGreaterThanOrEqual(3)
      const offset = await firstFigureOffset(page)
      expect(offset, query).toBeLessThan(900)
    }
  })

  test('fits the whole workspace in materially fewer screens than it did', async ({
    page,
  }) => {
    /*
     * The baseline document was 8,161 px — nine screens. The ceiling is six, which is
     * comfortably above the measured height and far enough below the baseline that the
     * route cannot drift back into being a document without this failing first.
     */
    await gotoRendered(page, ROUTE)
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(height, `document height ${String(height)} px`).toBeLessThan(900 * 6)
  })
})

/* -------------------------------------------------------------------------- */
/* Responsive                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('the workspace reflows into a priority flow', () => {
  test('reads two modules across on a tablet and one on a phone', async ({ page }) => {
    const columnsAt = async (width: number) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, ROUTE)
      return page.evaluate(() => {
        const lefts = [...document.querySelectorAll('[data-visual-region]')].map((node) =>
          Math.round(node.getBoundingClientRect().left)
        )
        return new Set(lefts).size
      })
    }
    expect(await columnsAt(1440)).toBeGreaterThanOrEqual(3)
    expect(await columnsAt(768)).toBeGreaterThanOrEqual(2)
    expect(await columnsAt(390)).toBe(1)
  })

  test('puts context, the KPI rail and the primary trend in the first screens', async ({
    page,
  }) => {
    /*
     * `UX.2A` §21: at 390 px the reader should reach the context, the primary KPIs and the
     * primary trend within approximately the first two screens. Measured: the rail begins
     * on the first screen and the trend module's heading is just past the second.
     */
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    await settle(page)
    const tops = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[data-visual-region]')].map((node) => [
          node.getAttribute('data-visual-region') ?? '',
          Math.round(node.getBoundingClientRect().top + window.scrollY),
        ])
      )
    )
    expect(tops['kpi-rail']).toBeLessThan(844)
    expect(tops['trend']).toBeLessThan(844 * 2.5)
  })

  test('scrolls no module horizontally at any tested width', async ({ page }) => {
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, ROUTE)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, `${String(width)} px`).toBeLessThanOrEqual(1)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The metric switch                                                           */
/* -------------------------------------------------------------------------- */

test.describe('the trend metric switch', () => {
  test('shows one series and keeps the other two in the document', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const group = page.getByRole('group', { name: 'Trend measure' })
    await expect(group.getByRole('radio')).toHaveCount(3)
    // One chart visible, three in the served document.
    const trend = page.locator('[data-visual-region="trend"]')
    await expect(trend.locator('figure')).toHaveCount(3)
    await expect(trend.locator('figure:visible')).toHaveCount(1)
    expect(await trend.evaluate((node) => node.textContent ?? '')).toContain(
      'Total gross per retail unit'
    )
  })

  test('changes the drawn series from the keyboard alone', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const trend = page.locator('[data-visual-region="trend"]')
    const before = await trend
      .locator('figure:visible')
      .evaluate((node) => node.textContent ?? '')

    await page.getByRole('radio', { name: 'Retail units' }).focus()
    await page.keyboard.press('ArrowRight')

    const after = await trend
      .locator('figure:visible')
      .evaluate((node) => node.textContent ?? '')
    expect(after).not.toBe(before)
    await expect(page.getByRole('radio', { name: 'Total gross' })).toBeChecked()
    await expect(trend.locator('figure:visible')).toHaveCount(1)
  })

  test('draws a visible focus indicator on the control that has focus', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const radio = page.getByRole('radio', { name: 'Total GPRU' })
    await radio.focus()
    const outline = await page.evaluate(() => {
      const input = document.activeElement
      if (input === null) return null
      const label = document.querySelector(`label[for="${input.id}"]`)
      return label === null ? null : getComputedStyle(label).outlineWidth
    })
    expect(outline).not.toBeNull()
    expect(parseFloat(outline ?? '0')).toBeGreaterThan(0)
  })

  test('ships no client JavaScript for the switch', async ({ page }) => {
    /*
     * The claim is structural rather than a byte count: the control is a radio group and
     * CSS, so the route's only client island stays the filter bar. A switch implemented in
     * script would have to hydrate something, and the assertion below is that the trend
     * module contains no element React marked for hydration.
     */
    await gotoRendered(page, ROUTE)
    const scripted = await page
      .locator('[data-visual-region="trend"]')
      .evaluate(
        (node) => node.querySelectorAll('[data-reactroot], [data-hydrate]').length
      )
    expect(scripted).toBe(0)
  })
})

test.describe('without JavaScript, the switch is still a switch', () => {
  test.use({ javaScriptEnabled: false })

  test('serves all three series and a working radio group', async ({ page }) => {
    await page.goto(ROUTE)
    const text = await mainTextContent(page)
    for (const measure of [
      'Retail units',
      'Total gross',
      'Total gross per retail unit',
    ]) {
      expect(text, measure).toContain(measure)
    }
    const radios = page.getByRole('group', { name: 'Trend measure' }).getByRole('radio')
    await expect(radios).toHaveCount(3)
    await expect(radios.first()).toBeChecked()

    // Selecting a different measure changes what is drawn, with no script running.
    const trend = page.locator('[data-visual-region="trend"]')
    const before = await trend
      .locator('figure:visible')
      .evaluate((node) => node.textContent ?? '')
    // The label, not the chart heading of the same name.
    await page.locator('label[for="exec-trend-gpru"]').click()
    const after = await trend
      .locator('figure:visible')
      .evaluate((node) => node.textContent ?? '')
    expect(after).not.toBe(before)
  })
})
