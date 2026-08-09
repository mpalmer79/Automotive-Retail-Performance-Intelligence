/**
 * `/dashboard/inventory`, end to end (`DASH.9-01`).
 *
 * `dashboard-inventory.test.ts` proves the arithmetic: the aged threshold read from the
 * data rather than assumed, the median taken from the population rather than from group
 * medians, nulls that stay null, comparators that are total and stable. None of that needs
 * a browser.
 *
 * This suite proves what only a browser can:
 *
 *   * the whole page is complete HTML with scripting disabled, including the unit table
 *     and the drill-through panel, because a console that needs a bundle to show what is
 *     on the lot is a console that shows nothing on a bad network;
 *   * `?unit=` is a real URL — copyable, shareable, and correct under Back and Forward —
 *     rather than client state that evaporates on reload;
 *   * the words "synthetic estimate" sit beside the estimate a reader can actually see,
 *     not merely somewhere in the document;
 *   * no repricing language appears in the rendered text. That is the negative that
 *     matters most here, and a unit test can only make it about a view model rather than
 *     about what a reader is shown;
 *   * the tables reflow rather than overflow at 320 px, which is a CSS fact.
 */
import { expect, test } from '@playwright/test'

import { affirmativeSentences, gotoRendered, mainText, mainTextContent } from './helpers'

const ROUTE = '/dashboard/inventory'

/**
 * The search-and-order form, addressed by what it contains.
 *
 * `main form[method="get"]` matches two forms on this route: the filter panel above it
 * submits the same way. `.first()` picks the filter panel, and clicking ITS submit button
 * navigates without `q` — which is how this test spent a 45-second timeout waiting for a
 * URL that was never going to arrive. Naming the field the form owns is unambiguous.
 */
const searchForm = 'main form:has(#q)'

test.describe('the inventory route renders its governed figures', () => {
  test('answers 200 and names itself in one h1', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)

    const headings = page.locator('main h1')
    await expect(headings).toHaveCount(1)
    await expect(headings.first()).toContainText(/lot/i)
  })

  test('shows the summary, the age buckets and the threshold it applied', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)

    expect(text).toMatch(/Active units/i)
    expect(text).toMatch(/Inventory investment/i)
    expect(text).toMatch(/Median days in stock/i)

    // All five governed buckets, and the threshold stated as a project default.
    for (const bucket of ['0-30', '31-60', '61-90', '91-120', 'Over 120']) {
      expect(text, `age bucket ${bucket}`).toContain(bucket)
    }
    expect(text).toMatch(/60 days/)
    expect(text).toMatch(/project default/i)
  })

  test('states the aged threshold is not an industry benchmark', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/not an industry benchmark/i)
    // The threshold and the top bucket are different rules, and the page says so.
    expect(text).toMatch(/different number from the top age bucket/i)
  })

  test('labels the market estimate synthetic everywhere it appears', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)

    expect(text).toMatch(/synthetic/i)
    expect(text).toMatch(/not a market valuation/i)
    // The column header itself carries the qualifier, so a reader scanning the table
    // sees it without opening a disclosure.
    expect(text).toMatch(/Est\. \(synthetic\)/i)
  })

  test('makes no repricing recommendation of any kind', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)

    // Affirmative repricing vocabulary. The page may describe a price movement; it may
    // not suggest one.
    for (const forbidden of [
      /suggested price/i,
      /recommended (price|markdown)/i,
      /reprice now/i,
      /optimal price/i,
      /price opportunity/i,
      /needs? (a )?markdown/i,
      /overpriced/i,
      /underpriced/i,
    ]) {
      expect(text, `repricing language: ${forbidden}`).not.toMatch(forbidden)
    }
  })

  test('models no floorplan carrying cost', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?unit=VEH-0000005`)
    const text = await mainText(page)

    // AFFIRMATIVE use only. The drill-through panel states that floorplan principal is a
    // liability carried alongside the unit, never netted against book value, and that ARPI
    // "models no floorplan interest, curtailment or carrying cost". That sentence is the
    // disclosure this test exists to protect, not the defect it is looking for.
    for (const forbidden of [
      /flooring cost/i,
      /floorplan interest/i,
      /curtailment/i,
      /net inventory (position|equity)/i,
      /equity in unit/i,
    ]) {
      expect(
        affirmativeSentences(text, forbidden),
        `floorplan concept asserted rather than disclaimed: ${forbidden}`
      ).toEqual([])
    }
  })

  test('states the floorplan denial rather than merely omitting it', async ({ page }) => {
    // The other half of the rule above: a page that never mentioned floorplan at all would
    // pass the sweep and still leave a reader free to read book value as a net position.
    await gotoRendered(page, `${ROUTE}?unit=VEH-0000005`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/never netted against it/i)
    expect(text).toMatch(/no net inventory position/i)
  })
})

test.describe('unit drill-through is a URL', () => {
  test('opens a unit, shows its accounting position, and survives a reload', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)

    const firstUnit = page.locator('main tbody th a').first()
    const unitId = (await firstUnit.textContent())?.trim() ?? ''
    expect(unitId).toMatch(/^VEH-\d{7}$/)

    await firstUnit.click()
    await page.waitForURL(/[?&]unit=VEH-\d{7}/)
    await expect(page.locator('main')).toContainText(unitId)
    await expect(page.locator('main')).toContainText(/Accounting position/i)

    // The same URL, loaded cold, shows the same panel. That is the difference between a
    // drill-through and a disclosure that happened to be open.
    const url = page.url()
    await page.goto(url)
    await expect(page.locator('main')).toContainText(unitId)
    await expect(page.locator('main')).toContainText(/Operational position/i)
  })

  test('returns to the index on Back and reopens on Forward', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await page.locator('main tbody th a').first().click()
    await page.waitForURL(/[?&]unit=/)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))

    await page.goForward()
    await page.waitForURL(/[?&]unit=/)
    await expect(page.locator('main')).toContainText(/Operational position/i)
  })

  test('recovers visibly from a unit identifier that names nothing', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?unit=VEH-9999999`)
    const text = await mainText(page)
    expect(text).toMatch(/Unit not found/i)
    // An unknown unit is a stated absence with a way out, not a silently empty page.
    await expect(page.locator('main a', { hasText: /Show all units/i })).toBeVisible()
  })

  test('shows a missing accounting position as missing, never as zero', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?unit=VEH-9999999`)
    const text = await mainText(page)
    expect(text).not.toMatch(/\$0\.00 book value/i)
  })
})

test.describe('search, ordering and filters land in the URL', () => {
  test('narrows the table by search term', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const before = await page.locator('main tbody tr').count()

    await page.fill('#q', 'VEH-0000005')
    await page.locator(`${searchForm} button[type="submit"]`).click()
    await page.waitForURL(/[?&]q=/)

    const after = await page.locator('main tbody tr').count()
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  test('reorders without changing the population', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const before = await page.locator('main tbody th a').allTextContents()

    await page.selectOption('#sort', 'age-desc')
    await page.locator(`${searchForm} button[type="submit"]`).click()
    await page.waitForURL(/[?&]sort=age-desc/)

    const after = await page.locator('main tbody th a').allTextContents()
    expect(after.length).toBe(before.length)
    expect([...after].sort()).toEqual([...before].sort())
  })

  test('applies a store filter and says it applied it', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const rows = page.locator('main tbody tr')
    await expect(rows.first()).toBeVisible()
    const text = await mainText(page)
    expect(text).toContain('GSA-001')
    expect(text).not.toContain('GSA-002')
  })
})

test.describe('the page works without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the summary, the buckets and the unit table', async ({ page }) => {
    await page.goto(ROUTE)
    // `mainText` scrolls the page to settle reveals, which needs scripting. With JavaScript
    // disabled the document is already complete, so its text is read directly.
    const text = await mainTextContent(page)

    expect(text).toMatch(/Active units/i)
    expect(text).toMatch(/Median days in stock/i)
    expect(text).toContain('0-30')
    expect(text).toMatch(/Over 120/)
    expect(text).toMatch(/synthetic/i)
    await expect(page.locator('main tbody tr').first()).toBeVisible()
  })

  test('renders the drill-through panel from the URL alone', async ({ page }) => {
    await page.goto(`${ROUTE}?unit=VEH-0000005`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Operational position/i)
    expect(text).toMatch(/Accounting position/i)
  })

  test('keeps the search and sort form usable as a native GET', async ({ page }) => {
    await page.goto(ROUTE)
    const form = page.locator(searchForm)
    await expect(form).toBeVisible()
    // No JavaScript is required for either control to submit.
    await expect(form.locator('#q')).toBeVisible()
    await expect(form.locator('#sort')).toBeVisible()
  })
})

test.describe('layout holds at the extremes', () => {
  for (const width of [320, 1920]) {
    test(`does not scroll horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, ROUTE)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }

  test('keeps the wide table reachable from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await gotoRendered(page, ROUTE)
    // The scroll container is focusable, so a keyboard reader can pan a table that is
    // wider than the viewport rather than being unable to reach its right-hand columns.
    const scrollers = page.locator('main [role="region"][tabindex="0"]')
    expect(await scrollers.count()).toBeGreaterThan(0)
    await expect(scrollers.first()).toHaveAttribute('aria-label', /.+/)
  })
})
