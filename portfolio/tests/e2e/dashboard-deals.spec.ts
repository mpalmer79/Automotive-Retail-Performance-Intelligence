/**
 * `/dashboard/deals`, end to end (`DASH.3-04`).
 *
 * `dashboard-deals.test.tsx` proves determinism over the whole population. This suite
 * proves what only a browser can: that sorting and paging are real links that work
 * without JavaScript, that browser history is the undo stack, that exactly one
 * responsive representation is in the accessibility tree, and that no row links to
 * the Deal Jacket route that `DASH.4` has not delivered.
 */
import { expect, test } from '@playwright/test'

import { gotoRendered, mainText, mainTextContent } from './helpers'
import { DASHBOARD_VIEWPORTS } from './routes'

const ROUTE = '/dashboard/deals'

test.describe('the route exists and states its scope', () => {
  test('answers 200 and renders its heading', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveText(
      /Every finalized transaction, and what each one made/
    )
  })

  test('states how many deals are in scope and which page is shown', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Showing 1 to 25 of \d+ deals, page 1 of \d+\./)
  })

  test('marks itself current in the console navigation', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const current = page.locator('[aria-current="page"]')
    await expect(current.filter({ hasText: /Deal Explorer/i }).first()).toBeVisible()
  })
})

test.describe('the index shows the deal, not the customer', () => {
  test('renders the operating columns', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    for (const heading of [
      'Deal',
      'Sale date',
      'Store',
      'Unit',
      'Vehicle',
      'Sale type',
      'Sale price',
      'Front gross',
      'Back gross',
      'Total gross',
      'Lead source',
    ]) {
      expect(text, `${heading} column missing`).toContain(heading)
    }
  })

  test('declares no customer column, and carries no contact-shaped value', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    /*
     * A substring scan is the wrong instrument here, and both ways round. The lane
     * legitimately contains the word "customer": one of the synthetic lead sources is
     * "Customer Referral", and one is "Repeat Customer Outreach" -- marketing channels,
     * not people. Flagging those would teach a future reader that this check is noisy.
     *
     * So the assertion is structural instead, in two parts that between them are
     * stronger than the scan was: no COLUMN names a customer attribute, and no CELL
     * holds a value shaped like a contact detail.
     */
    const headers = await page
      .locator('main table thead th')
      .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').toLowerCase()))
    expect(headers.length).toBeGreaterThan(8)
    for (const forbidden of [
      'customer',
      'name',
      'email',
      'phone',
      'address',
      'credit',
      'birth',
      'licence',
      'license',
    ]) {
      expect(
        headers.some((header) => header.includes(forbidden)),
        `the deal index declares a "${forbidden}" column`
      ).toBe(false)
    }

    const body = (await page.locator('main table tbody').textContent()) ?? ''
    // An email address, a telephone number, and a US-style postal address line.
    expect(body, 'an email-shaped value reached the deal index').not.toMatch(
      /[\w.]+@[\w.]+\.[a-z]{2,}/i
    )
    expect(body, 'a phone-shaped value reached the deal index').not.toMatch(
      /\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/
    )
    expect(body, 'a street address reached the deal index').not.toMatch(
      /\d+\s+\w+\s+(street|st|road|rd|avenue|ave|drive|dr|lane|ln)\b/i
    )
  })

  test('renders a negative front gross with its sign and a word', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?sort=front_end_gross&dir=asc`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/-\$[\d,]+/)
    expect(text).toContain('loss')
  })

  test('shows a walk-in deal as walk-in rather than as missing data', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Walk-in or unattributed/i)
  })

  test('labels a non-retail transaction rather than hiding it', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?scope=wholesale&period=2025-07-01..2025-12-31`)
    const text = await mainTextContent(page)
    expect(text).toContain('Wholesale')
    expect(text).toMatch(/not retail/i)
  })
})

test.describe('sorting is links, and works without JavaScript', () => {
  test('marks the sorted column with aria-sort', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?sort=total_gross&dir=desc`)
    const sorted = page.locator('th[aria-sort="descending"]')
    expect(await sorted.count()).toBeGreaterThanOrEqual(1)
  })

  test('every sortable header is an anchor carrying a real sort state', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const hrefs = await page
      .locator('thead a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThanOrEqual(6)
    for (const href of hrefs) {
      expect(href).toContain('/dashboard/deals')
      /*
       * `sort=` OR `dir=`. The default sort column omits `sort=` from its own link
       * because the serializer drops defaults -- that is the canonical-URL rule
       * working, not a missing parameter, and the link still expresses a state.
       */
      expect(/[?&](sort|dir)=/.test(href), `no sort state in ${href}`).toBe(true)
    }
  })

  test('clicking a sort header changes the order and the URL', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const before = await mainText(page)
    await page.locator('thead a', { hasText: 'Total gross' }).first().click()
    await page.waitForURL(/sort=total_gross/)
    expect(await mainText(page)).not.toBe(before)
  })

  test('returns to page one when the sort changes', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?page=3`)
    await page.locator('thead a', { hasText: 'Total gross' }).first().click()
    await page.waitForURL(/sort=total_gross/)
    expect(page.url()).not.toContain('page=3')
  })
})

test.describe('pagination', () => {
  test('moves forward and back through real links', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await page.locator('a[rel="next"]').click()
    await page.waitForURL(/page=2/)
    expect(await mainText(page)).toMatch(/Showing 26 to 50/)
    await page.locator('a[rel="prev"]').click()
    expect(await mainText(page)).toMatch(/Showing 1 to 25/)
  })

  test('preserves the filters, the search and the sort across a page change', async ({
    page,
  }) => {
    await gotoRendered(
      page,
      `${ROUTE}?period=2025-07-01..2025-12-31&store=GSA-001&q=Chevrolet&sort=total_gross&dir=desc`
    )
    await page.locator('a[rel="next"]').click()
    await page.waitForURL(/page=2/)
    const url = page.url()
    expect(url).toContain('store=GSA-001')
    expect(url).toContain('q=Chevrolet')
    expect(url).toContain('sort=total_gross')
  })

  test('browser back and forward are the undo stack', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const first = await mainText(page)
    await page.locator('a[rel="next"]').click()
    await page.waitForURL(/page=2/)
    await page.goBack()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(await mainText(page)).toBe(first)
  })

  test('clamps an out-of-range page and says so', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?page=9999`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/past the end of this result set/i)
  })
})

test.describe('search', () => {
  test('is a native GET form that survives without JavaScript', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const form = page.locator('form[method="get"]').first()
    await expect(form).toHaveAttribute('action', ROUTE)
    await expect(page.locator('#deal-search')).toBeVisible()
  })

  test('narrows the result set and states the new count', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?q=Subaru`)
    const text = await mainText(page)
    expect(text).toMatch(/Showing 1 to \d+ of \d+ deals/)
    expect(text).toContain('Subaru')
  })

  test('finds one deal by its exact id', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?q=SLE-00000646`)
    const text = await mainText(page)
    expect(text).toMatch(/Showing 1 to 1 of 1 deals/)
  })

  test('says so plainly when nothing matches', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?q=zzzznotathing`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/No finalized transaction matches this combination/i)
  })

  test('reports an unusable route parameter and keeps the page intact', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?sort=nonsense&page=0`)
    const text = await mainTextContent(page)
    expect(text).toMatch(/was not usable and was reset/i)
    expect(text).toMatch(/Showing 1 to 25/)
  })
})

test.describe('the drill-through goes somewhere real', () => {
  /*
   * Through `DASH.3` this block asserted the OPPOSITE: that no row linked to
   * `/dashboard/deals/[saleId]`, because the route did not exist and an anchor would
   * have been a link to a 404. `DASH.4` delivers the route, so the assertion is
   * re-aimed in the same diff that makes the destination real — every deal id is now
   * a link, and every one of them has to resolve.
   */
  test('links every deal id at its own jacket', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const hrefs = await page
      .locator('main tbody th a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(hrefs.length).toBe(25)
    for (const href of hrefs) {
      expect(href, `a row links somewhere other than a Deal Jacket: ${href}`).toMatch(
        /^\/dashboard\/deals\/SLE-\d{8}$/
      )
    }
  })

  test('the first row link resolves to that deal jacket', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const first = page.locator('main tbody th a').first()
    const saleId = ((await first.textContent()) ?? '').trim()
    await first.click()
    await page.waitForURL(`**/dashboard/deals/${saleId}`)
    await expect(page.locator('h1')).toContainText(saleId)
  })

  test('says what the drill-through leads to', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    expect(text).toMatch(/Deal Jacket/i)
    expect(text).toMatch(/explained to the cent/i)
  })
})

test.describe('responsive presentation', () => {
  test('shows the table at 1280px and the cards below it, never both', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, ROUTE)
    await expect(page.locator('main table').first()).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    /*
     * `hidden` removes an element from the accessibility tree as well as from the
     * page, which is what keeps a screen-reader user from meeting 25 deals twice.
     */
    await expect(page.locator('main table').first()).toBeHidden()
    await expect(page.locator('main ul li').first()).toBeVisible()
  })

  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`does not scroll horizontally at ${String(viewport.width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await gotoRendered(page, ROUTE)
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      expect(overflow).toBe(false)
    })
  }
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the index, the position and working navigation links', async ({
    page,
  }) => {
    await page.goto(ROUTE)
    const text = (await page.locator('main').textContent()) ?? ''
    expect(text).toMatch(/Showing 1 to 25 of \d+ deals/)
    expect(text).toContain('SLE-')
    const next = page.locator('a[rel="next"]')
    await expect(next).toHaveAttribute('href', /page=2/)
  })

  test('sorts through a plain link', async ({ page }) => {
    await page.goto(`${ROUTE}?sort=total_gross&dir=desc`)
    const text = (await page.locator('main').textContent()) ?? ''
    expect(text).toContain('Total gross')
    expect(text).toContain('SLE-')
  })
})
