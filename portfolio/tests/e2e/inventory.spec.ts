import { expect, test } from '@playwright/test'

import dealerships from '../../src/generated/dealerships.json'
import records from '../../src/generated/inventory-records.json'
import summary from '../../src/generated/inventory-summary.json'
import { bodyText, gotoRendered, mainText, settle } from './helpers'
import { GROUP_ROUTES, VIEWPORTS } from './routes'

/**
 * The Granite Auto Group experience, in a browser.
 *
 * The unit suite proves the GENERATED DATA is honest and reconciles. This proves
 * that what it says reaches the screen: that the counts a visitor reads are the
 * generated ones, that a filtered view still adds up, that a listing the source
 * never priced renders as an absence rather than as a number, and that no VIN,
 * domain or source URL survived into the DOM.
 *
 * It also covers the two claims a reader has no other way to check: that the
 * group is stated as fictional on every one of these routes, and that publishing
 * an inventory summary has not quietly unlocked the analytical case study.
 */

const STORES = dealerships.dealerships
const DEALERSHIP_PATHS = STORES.map((store) => store.href)
const ALL_INVENTORY_PATHS = ['/dealerships', ...DEALERSHIP_PATHS, '/inventory']

/** Digits only, so a comparison is not defeated by a thousands separator. */
function digitsOf(value: number): string {
  return String(value)
}

/* -------------------------------------------------------------------------- */
/* The home page introduces the group                                         */
/* -------------------------------------------------------------------------- */

test.describe('the home page introduces Granite Auto Group', () => {
  test('carries the section, by name', async ({ page }) => {
    await gotoRendered(page, '/')
    await expect(
      page.getByRole('heading', { name: 'Meet Granite Auto Group' })
    ).toBeVisible()
  })

  test('names all three stores and links each one', async ({ page }) => {
    await gotoRendered(page, '/')
    await settle(page)
    for (const store of STORES) {
      await expect(
        page.getByRole('link', { name: store.name, exact: true }).first(),
        `${store.name} is not linked from the home page`
      ).toBeVisible()
    }
  })

  test('shows each store type, location and inventory count', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await mainText(page)
    for (const store of STORES) {
      expect(text, `${store.id} type`).toContain(store.storeTypeLabel)
      expect(text, `${store.id} location`).toContain(`${store.city}, ${store.stateCode}`)
      expect(text, `${store.id} franchise status`).toMatch(
        store.isFranchise ? /Franchise/i : /Independent/i
      )
      expect(text, `${store.id} inventory count`).toContain(
        digitsOf(store.inventory.totalRecords)
      )
    }
  })

  test('shows the primary brands each store carries', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await mainText(page)
    for (const store of STORES) {
      const leadBrand = store.inventory.topMakes[0]?.make
      expect(leadBrand, `${store.id} has no make`).toBeDefined()
      expect(text, `${store.id} primary brand`).toContain(leadBrand as string)
    }
  })

  test('shows the group snapshot, derived not authored', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await mainText(page)
    expect(text).toMatch(/Group inventory snapshot/i)
    expect(text).toContain(digitsOf(summary.totalRecords))
    expect(text).toContain(digitsOf(summary.newRecords))
    expect(text).toContain(digitsOf(summary.preOwnedRecords))
    expect(text).toContain(digitsOf(summary.makeCount))
    expect(text).toMatch(/Median advertised price/i)
    expect(text).toMatch(/Snapshot date/i)
  })

  test('says the group is fictional in the same section', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await mainText(page)
    expect(text).toMatch(/fictional/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

test.describe('the group is reachable from the navigation', () => {
  test('offers Dealerships and Inventory in the header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, '/')
    const header = page.locator('header nav[aria-label="Primary"]')
    await expect(header.getByRole('link', { name: 'Dealerships' })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Inventory' })).toBeVisible()
  })

  test('marks Dealerships current on every store page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const path of DEALERSHIP_PATHS) {
      await gotoRendered(page, path)
      const current = page.locator(
        'header nav[aria-label="Primary"] a[aria-current="page"]'
      )
      await expect(current, path).toHaveText('Dealerships')
    }
  })

  test('renders the group sub-navigation on all five of its routes', async ({ page }) => {
    for (const route of GROUP_ROUTES) {
      await gotoRendered(page, route.path)
      const nav = page.locator('nav[aria-label="Granite Auto Group"]').first()
      await expect(nav, route.path).toBeVisible()
      for (const entry of GROUP_ROUTES) {
        // Not `exact`: the current item's accessible name carries a visually
        // hidden " (current page)" suffix, which is the point of it.
        await expect(
          nav.getByRole('link', { name: entry.label }),
          `${route.path} does not link ${entry.label}`
        ).toHaveCount(1)
      }
      await expect(nav.locator('a[aria-current="page"]'), route.path).toContainText(
        route.label
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Store detail pages                                                         */
/* -------------------------------------------------------------------------- */

for (const store of STORES) {
  test.describe(`${store.name}`, () => {
    test('renders, with the store as its heading', async ({ page }) => {
      const response = await page.goto(store.href)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(store.name)
    })

    test('states identity, type, brand and location', async ({ page }) => {
      await gotoRendered(page, store.href)
      const text = await mainText(page)
      expect(text).toContain(store.id)
      expect(text).toContain(store.storeTypeLabel)
      expect(text).toContain(`${store.city}, ${store.stateCode}`)
      if (store.franchiseBrand) {
        expect(text, 'franchise brand').toContain(store.franchiseBrand)
      } else {
        expect(text, 'independent status').toMatch(/No franchise brand|Independent/i)
      }
    })

    test('states the inventory count and the new versus pre-owned split', async ({
      page,
    }) => {
      await gotoRendered(page, store.href)
      const text = await mainText(page)
      expect(text).toContain(digitsOf(store.inventory.totalRecords))
      expect(text).toContain(digitsOf(store.inventory.newRecords))
      expect(text).toContain(digitsOf(store.inventory.preOwnedRecords))
    })

    test('states the model-year range and, where priced, the price range', async ({
      page,
    }) => {
      await gotoRendered(page, store.href)
      const text = await mainText(page)
      const years = store.inventory.modelYearRange
      expect(years, 'model-year range').not.toBeNull()
      expect(text).toContain(String(years?.min))
      expect(text).toContain(String(years?.max))
      if (store.inventory.medianPrice !== null) {
        expect(text).toMatch(/Median advertised price/i)
      }
    })

    test('lists top makes and top models', async ({ page }) => {
      await gotoRendered(page, store.href)
      const text = await mainText(page)
      expect(text).toMatch(/Top makes/i)
      expect(text).toMatch(/Top models/i)
      const topMake = store.inventory.topMakes[0]?.make
      expect(text).toContain(topMake as string)
    })

    test('renders the full inventory table, one row per listing', async ({ page }) => {
      await gotoRendered(page, store.href)
      const table = page.locator('table').filter({ hasText: 'Stock reference' }).first()
      await expect(table).toBeVisible()
      await expect(table.locator('tbody tr')).toHaveCount(store.inventory.totalRecords)
    })

    test('states its snapshot date and a data coverage statement', async ({ page }) => {
      await gotoRendered(page, store.href)
      const text = await mainText(page)
      expect(text).toContain(store.inventory.snapshotDate)
      expect(text).toMatch(/Data coverage for this store/i)
      if (store.inventory.coverageStatus !== null) {
        expect(text).toContain(store.inventory.coverageStatus)
      }
    })

    test('links back to the group view', async ({ page }) => {
      await gotoRendered(page, store.href)
      await expect(
        page.getByRole('link', { name: /Back to Granite Auto Group/i })
      ).toBeVisible()
    })
  })
}

test('the Chevrolet page leads on new Chevrolet inventory', async ({ page }) => {
  await gotoRendered(page, '/dealerships/granite-chevrolet')
  const text = await mainText(page)
  expect(text).toMatch(/Chevrolet/)
  expect(text).toMatch(/allocation/i)
})

test('the Subaru page leads on the narrow new line and the pre-owned bench', async ({
  page,
}) => {
  await gotoRendered(page, '/dealerships/granite-subaru')
  const text = await mainText(page)
  expect(text).toMatch(/Subaru/)
  expect(text).toMatch(/pre-owned/i)
})

test('the pre-owned page leads on multi-brand used inventory', async ({ page }) => {
  await gotoRendered(page, '/dealerships/granite-pre-owned')
  const text = await mainText(page)
  expect(text).toMatch(/multi-brand|no franchise/i)
  expect(text).toMatch(/pre-owned/i)
})

/* -------------------------------------------------------------------------- */
/* The explorer                                                               */
/* -------------------------------------------------------------------------- */

test.describe('the inventory explorer', () => {
  test('reports the generated record total', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    await expect(page.getByRole('status').first()).toContainText(
      `${summary.totalRecords.toLocaleString('en-US')} of ${summary.totalRecords.toLocaleString('en-US')} listings match`
    )
  })

  test('offers every required filter', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    for (const label of ['Dealership', 'Make', 'Model', 'Model year', 'Sort by']) {
      await expect(page.getByLabel(label, { exact: true }), label).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Pre-owned', exact: true })
    ).toBeVisible()
    await expect(page.getByLabel(/Minimum advertised price/i)).toBeVisible()
    await expect(page.getByLabel(/Maximum mileage/i)).toBeVisible()
  })

  test('offers all six sort orders', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    const options = await page
      .getByLabel('Sort by', { exact: true })
      .locator('option')
      .allInnerTexts()
    expect(options).toEqual([
      'Price, low to high',
      'Price, high to low',
      'Mileage, low to high',
      'Mileage, high to low',
      'Model year, newest first',
      'Model year, oldest first',
    ])
  })

  test('shows every required column', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    const headers = await page
      .locator('table')
      .filter({ hasText: 'Stock reference' })
      .first()
      .locator('thead th')
      .allInnerTexts()
    expect(headers).toEqual([
      'Dealership',
      'Condition',
      'Year',
      'Make',
      'Model',
      'Trim',
      'Mileage',
      'Advertised price',
      'Stock reference',
      'Snapshot',
    ])
  })

  test('reconciles a dealership filter to that store’s generated count', async ({
    page,
  }) => {
    for (const store of STORES) {
      await gotoRendered(page, `/inventory?dealership=${store.id}`)
      await expect(page.getByRole('status').first(), store.id).toContainText(
        `${store.inventory.totalRecords.toLocaleString('en-US')} of ${summary.totalRecords.toLocaleString('en-US')} listings match`
      )
    }
  })

  test('reconciles a condition filter to the generated split', async ({ page }) => {
    await gotoRendered(page, '/inventory?condition=new')
    await expect(page.getByRole('status').first()).toContainText(
      `${summary.newRecords.toLocaleString('en-US')} of ${summary.totalRecords.toLocaleString('en-US')} listings match`
    )
    await gotoRendered(page, '/inventory?condition=pre-owned')
    await expect(page.getByRole('status').first()).toContainText(
      `${summary.preOwnedRecords.toLocaleString('en-US')} of ${summary.totalRecords.toLocaleString('en-US')} listings match`
    )
  })

  test('reconciles a combined filter to the record set', async ({ page }) => {
    const make = summary.byMake[0]?.make as string
    const expected = records.filter(
      (record) => record.make === make && record.condition === 'pre-owned'
    ).length
    await gotoRendered(
      page,
      `/inventory?make=${encodeURIComponent(make)}&condition=pre-owned`
    )
    await expect(page.getByRole('status').first()).toContainText(
      `${expected.toLocaleString('en-US')} of ${summary.totalRecords.toLocaleString('en-US')} listings match`
    )
  })

  test('reports an empty selection rather than a broken table', async ({ page }) => {
    // A make that exists paired with a model year that store never had.
    await gotoRendered(page, '/inventory?make=Subaru&year=2001')
    const text = await bodyText(page)
    expect(text).toMatch(/No listing in the snapshot matches this selection/i)
  })

  test('paginates rather than rendering every row', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    const table = page.locator('table').filter({ hasText: 'Stock reference' }).first()
    const rows = await table.locator('tbody tr').count()
    expect(rows).toBeLessThan(summary.totalRecords)
    expect(rows).toBeGreaterThan(0)
    await expect(page.getByRole('navigation', { name: 'Inventory pages' })).toBeVisible()
  })

  test('advances a page and changes the rows', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    const table = page.locator('table').filter({ hasText: 'Stock reference' }).first()
    const first = await table.locator('tbody tr').first().innerText()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(table.locator('tbody tr').first()).not.toHaveText(first)
  })

  test('renders a missing price and a missing mileage safely', async ({ page }) => {
    // The store with the MOST unpriced listings, so the first page of its
    // results is guaranteed to contain one. Picking the first unpriced record in
    // the whole set instead lands on the Chevrolet store's two call-for-price
    // rows, which sit far past page one and made this pass for the wrong reason.
    const unpricedByStore = new Map<string, number>()
    for (const record of records) {
      if (record.price !== null) continue
      unpricedByStore.set(
        record.dealershipId,
        (unpricedByStore.get(record.dealershipId) ?? 0) + 1
      )
    }
    const worst = [...unpricedByStore.entries()].sort((a, b) => b[1] - a[1])[0]
    expect(worst, 'the fixture has no unpriced listing to check').toBeDefined()
    await gotoRendered(page, `/inventory?dealership=${worst?.[0] ?? ''}`)
    const text = await bodyText(page)
    // The source's own status, not a dash, not a zero, not an empty cell.
    expect(text).toContain('Not exposed')
    expect(text).not.toMatch(/\$\s?0\b/)
    expect(text).not.toMatch(/\bNaN\b/)
    expect(text).not.toMatch(/\bundefined\b/)
    expect(text).not.toMatch(/\bnull\b/)
  })

  test('sorts unpriced listings last, in both directions', async ({ page }) => {
    const table = page.locator('table').filter({ hasText: 'Stock reference' }).first()
    for (const sort of ['price-asc', 'price-desc']) {
      await gotoRendered(page, `/inventory?sort=${sort}`)
      const firstRow = await table.locator('tbody tr').first().innerText()
      expect(firstRow, `${sort} put an unpriced listing first`).not.toContain(
        'Not exposed'
      )
    }
  })

  test('keeps the filter selection in the URL', async ({ page }) => {
    await gotoRendered(page, '/inventory')
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page).toHaveURL(/condition=new/)
  })
})

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

test.describe('every chart has a readable alternative', () => {
  test('the inventory page offers a table for each of its three charts', async ({
    page,
  }) => {
    await gotoRendered(page, '/inventory')
    const summaries = page.getByText(/Read .* as a table/i)
    await expect(summaries).toHaveCount(3)
    // Opening one reveals a real table with a header row.
    await summaries.first().click()
    await expect(page.locator('details[open] table').first()).toBeVisible()
  })

  test('the group page offers a table for both of its charts', async ({ page }) => {
    await gotoRendered(page, '/dealerships')
    await expect(page.getByText(/Read .* as a table/i)).toHaveCount(2)
  })

  test('a chart never carries a figure that is nowhere else', async ({ page }) => {
    await gotoRendered(page, '/dealerships')
    const text = await mainText(page)
    // The per-store totals the chart draws are also printed beside each bar and
    // again in the store comparison table.
    for (const entry of summary.byDealership) {
      expect(text, entry.dealershipId).toContain(digitsOf(entry.total))
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Trust                                                                      */
/* -------------------------------------------------------------------------- */

test.describe('the trust model survives the new pages', () => {
  for (const path of ALL_INVENTORY_PATHS) {
    test(`${path} states the group is fictional and the data sanitized`, async ({
      page,
    }) => {
      await gotoRendered(page, path)
      const text = await mainText(page)
      expect(text, 'fictional').toMatch(/fictional/i)
      expect(text, 'sanitized').toMatch(/sanitized/i)
      expect(text, 'listings not sales').toMatch(
        /listing|not a sale|not a dealer management system/i
      )
    })
  }

  test('no inventory route claims a completed analytical finding', async ({ page }) => {
    for (const path of ALL_INVENTORY_PATHS) {
      await gotoRendered(page, path)
      const text = await bodyText(page)
      for (const forbidden of [
        /\bwe (?:found|recommend|conclude)\b/i,
        /\bkey finding/i,
      ]) {
        expect(text, `${path} matches ${String(forbidden)}`).not.toMatch(forbidden)
      }
    }
  })

  test('the case study is still locked after all this', async ({ page }) => {
    // Adding a dealership section must not unlock Gate 2. A descriptive inventory
    // summary is evidence about a reference dataset, not an analytical result.
    await gotoRendered(page, '/case-study')
    expect(await bodyText(page)).toMatch(/Gate 2 CLOSED/i)
  })

  test('the dealerships page says an inventory summary is not a finding', async ({
    page,
  }) => {
    await gotoRendered(page, '/dealerships')
    const text = await mainText(page)
    expect(text).toMatch(/descriptive evidence/i)
    expect(text).toMatch(/not an analytical finding/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

test.describe('no retired name appears in public copy', () => {
  const RETIRED = ['Game Auto Group', 'Granite State Auto Group', 'Granite Used Auto']

  for (const path of ['/', ...ALL_INVENTORY_PATHS]) {
    test(`${path} uses none of them`, async ({ page }) => {
      await gotoRendered(page, path)
      const text = await bodyText(page)
      for (const retired of RETIRED) {
        expect(text, `${path} contains "${retired}"`).not.toContain(retired)
      }
      expect(text, `${path} does not name the group`).toContain('Granite Auto Group')
    })
  }

  test('uses no em dash in the new public copy', async ({ page }) => {
    for (const path of ALL_INVENTORY_PATHS) {
      await gotoRendered(page, path)
      const text = await mainText(page)
      expect(text, `${path} contains an em dash`).not.toContain('—')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Sanitization, in the DOM                                                   */
/* -------------------------------------------------------------------------- */

test.describe('nothing unsanitized reaches the rendered page', () => {
  for (const path of ALL_INVENTORY_PATHS) {
    test(`${path} exposes no VIN, domain, email, phone number or source URL`, async ({
      page,
    }) => {
      await gotoRendered(page, path)
      const text = await mainText(page)

      expect(text, 'a VIN-shaped identifier').not.toMatch(
        /\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b/
      )
      expect(text, 'an email address').not.toMatch(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
      )
      // Anchored on both sides so a model-year axis ("2026 199 2027 2") and a
      // stock reference ("GSA001-20260802-0140") are not read as phone numbers.
      // The unanchored form matched both, which is a test that fails on correct
      // pages and therefore gets deleted.
      expect(text, 'a telephone number').not.toMatch(
        /(?<![\d,.-])(?:\+?1[ .-])?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d,.-])/
      )
      expect(text, 'a dealership domain').not.toMatch(
        /\b[a-z0-9-]+\.(?:com|net|dealer|auto)\b/i
      )

      // And no link out to anything but the repository, which is the only
      // external destination these pages are allowed to have.
      const external = await page.$$eval('main a[href^="http"]', (nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? '')
      )
      for (const href of external) {
        expect(href, `${path} links to ${href}`).toMatch(/^https:\/\/github\.com\//)
      }
    })
  }
})

/* -------------------------------------------------------------------------- */
/* Responsiveness                                                             */
/* -------------------------------------------------------------------------- */

test.describe('the inventory pages work at every breakpoint', () => {
  for (const viewport of VIEWPORTS) {
    test(`/inventory does not scroll the page sideways at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await gotoRendered(page, '/inventory')
      await settle(page)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(
        overflow,
        `${viewport.name} overflows by ${String(overflow)}px`
      ).toBeLessThanOrEqual(1)
    })

    test(`a store page does not scroll the page sideways at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await gotoRendered(page, '/dealerships/granite-subaru')
      await settle(page)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(
        overflow,
        `${viewport.name} overflows by ${String(overflow)}px`
      ).toBeLessThanOrEqual(1)
    })
  }

  test('the wide table scrolls inside its own container, not the page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRendered(page, '/inventory')
    const scroller = page
      .locator('div')
      .filter({ has: page.locator('table:has-text("Stock reference")') })
      .last()
    await expect(scroller).toHaveCSS('overflow-x', /auto|scroll/)
  })
})
