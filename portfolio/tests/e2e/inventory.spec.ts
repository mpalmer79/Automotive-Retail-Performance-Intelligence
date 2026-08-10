import { expect, test } from '@playwright/test'

import dealerships from '../../src/generated/dealerships.json'
import records from '../../src/generated/inventory-records.json'
import summary from '../../src/generated/inventory-summary.json'
import { bodyText, gotoRendered, mainText, settle } from './helpers'
import { GROUP_NAV_ROUTES, GROUP_ROUTES, VIEWPORTS } from './routes'

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
/**
 * Every route that renders sanitized inventory data.
 *
 * `/` leads the list because the group overview IS the home page now. The old
 * `/dealerships` path is absent on purpose: it is a permanent redirect, and
 * `navigation.spec.ts` asserts it as one rather than sweeping it as a page.
 */
/*
 * Every route that renders a sanitized reference listing figure.
 *
 * `/` LEFT THE LIST AT `UX.1` and `/technical?view=overview` took its place: the
 * root is the operating console, which renders synthetic warehouse figures and
 * carries the demo statement rather than the reference-data provenance. The
 * provenance obligation travelled with the content, which is what this list is
 * for.
 */
const ALL_INVENTORY_PATHS = [
  '/technical?view=overview',
  ...DEALERSHIP_PATHS,
  '/inventory',
]

/** Digits only, so a comparison is not defeated by a thousands separator. */
function digitsOf(value: number): string {
  return String(value)
}

/* -------------------------------------------------------------------------- */
/* The home page introduces the group                                         */
/* -------------------------------------------------------------------------- */

/**
 * `UX.1` MOVED THE GROUP INTRODUCTION, NOT THE OBLIGATION.
 *
 * The store story, the group snapshot and the three store cards were the home
 * page; the home page is the operating console now and they are the technical
 * destination's overview. Every assertion below is unchanged apart from where it
 * looks, which is the point of rehoming content rather than deleting it.
 */
const GROUP_CONTEXT = '/technical?view=overview'

test.describe('the group context introduces Granite Auto Group', () => {
  test('leads with the group, not with the author', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
    // The `h1` names the destination; the group is introduced by its own section
    // heading below it. `UX.1` retired the hero whose headline used to be the
    // page's proposition, and the proposition it carried — three stores, one
    // governed layer — is the section this test asserts.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How ARPI works')
    await expect(
      page.getByRole('heading', { name: 'One group, three businesses' })
    ).toBeVisible()
  })

  test('names the group and each store in the group context', async ({ page }) => {
    // Not "above the fold": the group context is a section of the technical
    // destination now rather than the first screen of a landing page, and
    // requiring it in the first 900 px would be requiring the destination to open
    // with it. What the rule protects is that the group and all three stores are
    // named on the page a reader is sent to for them.
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, GROUP_CONTEXT)
    const text = await mainText(page)
    expect(text).toContain('Granite Auto Group')
    for (const store of STORES) {
      expect(text, `${store.id} is not named in the group context`).toContain(store.name)
    }
  })

  test('names all three stores and links each one', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
    await settle(page)
    for (const store of STORES) {
      await expect(
        page.getByRole('link', { name: store.name, exact: true }).first(),
        `${store.name} is not linked from the home page`
      ).toBeVisible()
    }
  })

  test('shows each store type, location and inventory count', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
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
    await gotoRendered(page, GROUP_CONTEXT)
    const text = await mainText(page)
    for (const store of STORES) {
      const leadBrand = store.inventory.topMakes[0]?.make
      expect(leadBrand, `${store.id} has no make`).toBeDefined()
      expect(text, `${store.id} primary brand`).toContain(leadBrand as string)
    }
  })

  test('shows the group snapshot, derived not authored', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
    const text = await mainText(page)
    // The GROUP totals for new and pre-owned were the retired hero's, which
    // carried a working inventory surface above the store story. The snapshot
    // itself, its record count, its date and the per-store split all survived the
    // move — asserted here at the grain the page actually prints them.
    expect(text).toMatch(/Group inventory snapshot/i)
    expect(text).toContain(digitsOf(summary.totalRecords))
    expect(text).toMatch(/Median advertised price/i)
    expect(text).toMatch(/Snapshot date/i)
    for (const entry of summary.byDealership) {
      expect(text, entry.dealershipId).toContain(digitsOf(entry.total))
    }
  })

  test('says the group is fictional in the same section', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
    const text = await mainText(page)
    expect(text).toMatch(/fictional/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

test.describe('the group is reachable from the navigation', () => {
  test('offers Executive and Technical in the reference header, and no duplicate', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, GROUP_CONTEXT)
    const header = page.locator('header nav[aria-label="Primary"]')
    await expect(header.getByRole('link', { name: 'Executive' })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Technical' })).toBeVisible()

    // There is no "Dealerships" item and no "Inventory" one: the group is reached
    // from the technical overview and the listing explorer is "Reference
    // listings", under Data sources. Two destinations called Inventory is exactly
    // what `UX.1` removed.
    await expect(header.getByRole('link', { name: 'Dealerships' })).toHaveCount(0)
    await expect(header.getByRole('link', { name: 'Inventory' })).toHaveCount(0)
    const hrefs = await header
      .locator('a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''))
    expect(new Set(hrefs).size, 'two header links share an href').toBe(hrefs.length)
  })

  test('reaches every store page from the group sub-navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const path of DEALERSHIP_PATHS) {
      await gotoRendered(page, path)
      const nav = page.locator('nav[aria-label="Granite Auto Group"]').first()
      await expect(nav, path).toBeVisible()
      await expect(nav.locator('a[aria-current="page"]'), path).toHaveCount(1)
    }
  })

  test('renders the group sub-navigation on every route that carries it', async ({
    page,
  }) => {
    for (const route of GROUP_NAV_ROUTES) {
      await gotoRendered(page, route.path)
      const nav = page.locator('nav[aria-label="Granite Auto Group"]').first()
      await expect(nav, route.path).toBeVisible()
      for (const entry of GROUP_ROUTES) {
        // Every ITEM, on every route that renders the rail - including "The
        // group", which points at the home page.
        //
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

  test('the group context offers a table for both of its charts', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
    await expect(page.getByText(/Read .* as a table/i)).toHaveCount(2)
  })

  test('a chart never carries a figure that is nowhere else', async ({ page }) => {
    await gotoRendered(page, GROUP_CONTEXT)
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

  test('the site says an inventory summary is not a finding', async ({ page }) => {
    // This was asserted on `/`, which carried the paragraph in the store chapter
    // while `/governance` and `/inventory` published the same boundary in full.
    // The home page's word-count pass deleted the third copy rather than moving
    // it, so the assertion moved to both routes that always owned it. The claim
    // the test protects is unchanged, and it is now checked where the sentence
    // actually lives.
    //
    // What `/` still carries is the one-line form, in the hero's trust line:
    // "Listings, not sales results", asserted in content-integrity.spec.ts.
    for (const path of ['/governance', '/inventory']) {
      await gotoRendered(page, path)
      const text = await mainText(page)
      expect(text, `${path} does not call it descriptive evidence`).toMatch(
        /descriptive evidence/i
      )
      expect(text, `${path} does not rule out an analytical finding`).toMatch(
        /not an analytical finding/i
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

test.describe('no retired name appears in public copy', () => {
  const RETIRED = ['Game Auto Group', 'Granite State Auto Group', 'Granite Used Auto']

  for (const path of ALL_INVENTORY_PATHS) {
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

  /*
   * WHY THE 375px TABLE TEST IS GONE
   * --------------------------------
   * It asserted that at 375px the listing table scrolls inside its own container
   * rather than scrolling the page. That was true and it was the wrong thing to
   * be satisfied with: the container at 320px is 254px wide, the table's natural
   * width is about 1,030px, and eight of the ten columns - INCLUDING THE
   * ADVERTISED PRICE - were therefore outside it with no affordance saying so.
   * The test passed on a page where a reader could not see what a car cost.
   *
   * There is no table at 375px any more, so the assertion has nothing to bind
   * to. What replaces it is stronger: that the cards ARE the presentation below
   * 1280px, that they carry every field the table carries, and that the table is
   * still the presentation above it. The scroll container still exists on the
   * table and is still keyboard-reachable; `accessibility.spec.ts` covers that.
   */
  test('the desktop table renders no column outside its container', async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/inventory')
      const clipped = await page.evaluate(() => {
        const table = [...document.querySelectorAll('table')].find((node) =>
          node.innerText.includes('Stock reference')
        )
        if (!table) return ['no table']
        const region = table.closest('[role="region"]')?.getBoundingClientRect()
        if (!region) return ['no scroll region']
        return [...table.querySelectorAll('th[scope="col"]')]
          .filter((th) => {
            const box = th.getBoundingClientRect()
            return box.left < region.left - 1 || box.right > region.right + 1
          })
          .map((th) => (th as HTMLElement).innerText.trim())
      })
      expect(clipped, `columns outside the container at ${String(width)}px`).toEqual([])
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The narrow-width listing presentation                                      */
/* -------------------------------------------------------------------------- */

/**
 * Widths at which the listings must be cards.
 *
 * 1024 is in the list on purpose. The table needs about 1,030px of content width
 * and the page container gives it 891px there, so a table at 1024 clipped its
 * last two columns - which is why the breakpoint is 1280 and not `md`.
 */
const CARD_WIDTHS = [320, 375, 390, 768, 1024] as const

/** Widths at which the listings must be the semantic table. */
const TABLE_WIDTHS = [1280, 1440, 1920] as const

/** Every field the sanitized record type carries, as the card labels it. */
const CARD_FIELDS = [
  'Condition',
  'Trim',
  'Mileage',
  'Stock reference',
  'Snapshot',
] as const

test.describe('listings are readable at every width', () => {
  for (const width of CARD_WIDTHS) {
    test(`/inventory presents listings as cards at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/inventory')

      const card = page.locator('article[aria-labelledby^="listing-"]').first()
      await expect(card).toBeVisible()

      // The table is `display: none` here, so it is out of the accessibility
      // tree as well as off the screen. Both presentations exposed at once would
      // read every listing twice.
      await expect(
        page.locator('table').filter({ hasText: 'Stock reference' })
      ).toBeHidden()

      // The defect this whole change exists for: the price has to be readable
      // without moving anything sideways, and it has to be the second thing in
      // the card rather than the ninth.
      const text = await card.innerText()
      expect(text).toMatch(/Advertised price/i)
      expect(text).toMatch(/\$[\d,]+|Not exposed/)

      // And nothing was dropped to make the card shorter.
      const terms = await card.locator('dt').allInnerTexts()
      const normalised = terms.map((term) => term.trim().toLowerCase())
      for (const field of CARD_FIELDS) {
        expect(normalised, `${field} missing at ${String(width)}px`).toContain(
          field.toLowerCase()
        )
      }
      // The explorer spans all three stores, so it labels the store too.
      expect(normalised).toContain('dealership')
    })

    test(`a store page presents listings as cards at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/dealerships/granite-subaru')
      const card = page.locator('article[aria-labelledby^="listing-"]').first()
      await expect(card).toBeVisible()
      const terms = (await card.locator('dt').allInnerTexts()).map((term) =>
        term.trim().toLowerCase()
      )
      for (const field of CARD_FIELDS) {
        expect(terms, `${field} missing at ${String(width)}px`).toContain(
          field.toLowerCase()
        )
      }
      // One store, so no dealership term: the column the table drops for the
      // same reason.
      expect(terms).not.toContain('dealership')
    })
  }

  for (const width of TABLE_WIDTHS) {
    test(`/inventory presents listings as a table at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoRendered(page, '/inventory')
      await expect(
        page.locator('table').filter({ hasText: 'Stock reference' }).first()
      ).toBeVisible()
      // And the cards are the ones removed from the tree this time. `.first()`
      // because the locator matches every card on the page, and a visibility
      // assertion against twenty-five elements is a strict-mode violation
      // rather than an assertion about any of them.
      await expect(
        page.locator('article[aria-labelledby^="listing-"]').first()
      ).toBeHidden()
    })
  }

  test('a store page renders one card per listing, not a truncated set', async ({
    page,
  }) => {
    const store = STORES.find((entry) => entry.id === 'GSA-002')
    expect(store, 'the Subaru store is in the generated set').toBeDefined()
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRendered(page, store?.href ?? '/dealerships/granite-subaru')
    await expect(page.locator('article[aria-labelledby^="listing-"]')).toHaveCount(
      store?.inventory.totalRecords ?? 0
    )
  })

  test('a card states a missing price as an absence, not as a number', async ({
    page,
  }) => {
    // The independent store is the one whose source priced fewer than a tenth of
    // its listings, which is the case the card has to render honestly.
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRendered(page, '/dealerships/granite-pre-owned')
    const text = await page
      .locator('article[aria-labelledby^="listing-"]')
      .first()
      .innerText()
    // `\s+`, not a literal space: the "Advertised price" term is an `sr-only`
    // span, which is `position: absolute`, so `innerText` treats it as a block
    // and puts a newline between the term and the value.
    expect(text).toMatch(/Advertised price\s+(\$[\d,]+|Not exposed)/i)
    expect(text, 'a missing price never renders as zero').not.toMatch(/\$0(\D|$)/)
  })

  test('filters, sorting and pagination stay usable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await gotoRendered(page, '/inventory')

    // Sorting.
    await page.selectOption('#inventory-sort', 'price-asc')
    // Filtering, through the control that is a chip rather than a select.
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // Pagination still announces its own position.
    await expect(page.getByRole('navigation', { name: 'Inventory pages' })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText(/Page 2 of/)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(
      overflow,
      'interacting at 320px introduced sideways scroll'
    ).toBeLessThanOrEqual(1)
  })
})
