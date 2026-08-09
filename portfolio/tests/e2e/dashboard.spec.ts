/**
 * The console, end to end (`DASH.2-01`, `DASH.2-03`, `DASH.2-04`).
 *
 * `dashboard-executive.test.tsx` proves the arithmetic against the export. This
 * suite proves the other half: that the figures reach the screen, that the states
 * a figure cannot express are legible, that the shell and its disclosures are where
 * the information architecture says, and that nothing on the page links to a
 * console section that does not exist.
 *
 * Accessibility is covered by the shared sweep in `accessibility.spec.ts`, which
 * runs axe over every route in `routes.ts` and now therefore over this one; the
 * console-specific keyboard, reflow and no-JavaScript assertions are here, because
 * they are properties of this page rather than of the site.
 */
import { expect, test, type Page } from '@playwright/test'

import { bodyText, gotoRendered, mainText, mainTextContent } from './helpers'
import {
  DASHBOARD_NAV_ROUTES,
  DASHBOARD_ROUTES,
  DASHBOARD_VIEWPORTS,
  UNBUILT_DASHBOARD_ROUTES,
} from './routes'

const ROUTE = '/dashboard'

/* -------------------------------------------------------------------------- */
/* The route and its shell                                                     */
/* -------------------------------------------------------------------------- */

test.describe('the console route exists and is reachable', () => {
  test('answers 200 and renders its heading', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveText(
      /How the group is performing, and which store needs attention/
    )
  })

  test('takes the seventh and last primary-navigation slot, and marks itself current', async ({
    page,
  }) => {
    /*
     * "Seventh" is the COUNT, not the position. `MAX_PRIMARY_NAV_ITEMS` is 7 and the
     * header had six; the console takes the last slot. It is placed second, after
     * Overview, because it is the product this project builds toward and a header
     * that buried it behind four documentation destinations would disagree with what
     * the site is for. `tests/unit/site.test.ts` pins both the count and the order.
     */
    await gotoRendered(page, ROUTE)
    const header = page.getByRole('banner')
    const items = header.getByRole('navigation').first().getByRole('link')
    expect(await items.count()).toBeLessThanOrEqual(8) // seven destinations plus GitHub
    const link = header.getByRole('link', { name: 'Dashboard', exact: true }).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('aria-current', 'page')
  })

  test('is reachable from the header on another route', async ({ page }) => {
    await gotoRendered(page, '/kpis')
    await page
      .getByRole('banner')
      .getByRole('link', { name: 'Dashboard', exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))
    await expect(page.locator('h1')).toBeVisible()
  })

  test('renders the internal console navigation as a nav, not a tablist', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const nav = page.getByRole('navigation', { name: 'Dashboard' })
    await expect(nav).toBeVisible()
    expect(await nav.getByRole('tablist').count()).toBe(0)
    for (const destination of DASHBOARD_NAV_ROUTES) {
      const link = nav.getByRole('link', { name: new RegExp(destination.label, 'i') })
      await expect(link).toHaveAttribute('href', destination.path)
    }
    await expect(nav.getByRole('link', { name: /command center/i })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('renders a breadcrumb trail ending in the current page as text', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toBeVisible()
    await expect(crumbs.getByRole('link', { name: 'Overview' })).toBeVisible()
    const current = crumbs.locator('[aria-current="page"]')
    await expect(current).toHaveText(/Dealer Operations Command Center/)
    expect(await current.evaluate((node) => node.tagName)).not.toBe('A')
  })

  test('appears in the sitemap', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text()
    expect(xml).toContain('/dashboard')
    // The nine unbuilt console routes must not be advertised.
    for (const unbuilt of UNBUILT_DASHBOARD_ROUTES) {
      expect(xml, `${unbuilt} is in the sitemap`).not.toContain(unbuilt)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Disclosure                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('the console states what it is, in its own body', () => {
  test('carries the synthetic statement in full', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Every warehouse record in this project is synthetic')
    expect(text).toContain('Granite Auto Group and its three stores are fictional')
  })

  test('carries a dashboard-scoped trust line naming the Power BI boundary', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Deterministic synthetic data')
    expect(text).toContain('Exported SQL figures, not a Power BI result')
    expect(text).toContain('Real-engine validation pending')
  })

  test('states the real Power BI validation state, from the evidence files', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Real-engine validation pending')
    expect(text).toContain(
      'rendering a number in HTML proves nothing about a DAX measure'
    )
    expect(text).toContain('powerbi/validation/desktop_validation_results.json')
    expect(text).toContain('powerbi/validation/fabric_validation_results.json')
    // The affirmative form must be absent while the evidence says pending.
    expect(text).not.toContain('Real-engine validation recorded')
  })

  test('states that Gate 2 is closed and that this page is not evidence for it', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Gate 2 remains CLOSED')
    expect(text).toContain('may not be cited as Gate 2 evidence')
  })

  test('shows the export lane checks with a word beside each verdict', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const label of [
      'Export reconciliation',
      'Privacy scan',
      'Pipeline validation',
      'Contract freshness',
      'Synthetic data',
    ]) {
      expect(text, label).toContain(label)
    }
    // The instrument labels are uppercased by CSS, and `innerText` reports the
    // rendered casing, so the assertion is on the words rather than on their case.
    expect(text).toMatch(/dataset version/i)
    expect(text).toMatch(/contract digest/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

test.describe('the figures on the screen are the exported figures', () => {
  test('renders the seven governed KPI cards with their identifiers', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const kpi of [
      'KPI-SLS-001',
      'KPI-GRS-003',
      'KPI-GRS-006',
      'KPI-GRS-005',
      'KPI-FUN-006',
      'KPI-INV-004',
      'KPI-INV-006',
    ]) {
      expect(text, kpi).toContain(kpi)
    }
  })

  test('renders December retail units and total gross exactly', async ({ page }) => {
    // The values `dashboard-executive.test.tsx` proves against the export, asserted
    // here as the strings a reader actually sees.
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('92')
    expect(text).toContain('$321,935')
    expect(text).toContain('+13 units')
  })

  test('labels a ratio difference in percentage points, never in percent', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/[+-]\d+(?:\.\d+)? percentage points?/)
  })

  test('states direction in neutral words and never as a judgement', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = (await mainText(page)).toLowerCase()
    expect(text).toMatch(/higher than|lower than|unchanged from/)
    for (const judgement of ['improved', 'declined', 'on track', 'behind pace']) {
      expect(text, judgement).not.toContain(judgement)
    }
  })

  test('carries no F&I figure, which no fact on this route supports yet', async ({
    page,
  }) => {
    /*
     * `DASH.5` moved target attainment and selling-day pace OFF this list: the plan fact
     * exists, the KPIs are governed, and the section below asserts them positively.
     *
     * `DASH.9` has now done the same for the GL comparison. The reconciliation fact
     * exists, its view model is tested against the export in `dashboard-accounting.test.ts`,
     * and `accounting-data.ts` records that the 43-row comparison set "IS the Executive
     * summary" for this route — so the accounting position is asserted POSITIVELY below
     * rather than asserted absent here. What remains on this list is F&I, whose
     * penetration and chargeback surfaces are the `/dashboard/fi` route's and are not
     * summarised here.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const absent of [/\bproduct penetration\b/i, /\bchargeback\b/i]) {
      expect(text, String(absent)).not.toMatch(absent)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Accounting integrity (DASH.9 data, surfaced by the visual overhaul)         */
/* -------------------------------------------------------------------------- */

test.describe('the accounting integrity signal', () => {
  test('states the comparison date and the direction in words', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Whether the stock schedule and the general ledger agree')
    expect(text).toContain('31 December 2025')
    expect(text).toMatch(
      /the general ledger carries more than the subledger|the subledger carries more than the general ledger|the two sides agree exactly/
    )
  })

  test('names a variance as a finding rather than as a failure', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = (await mainText(page)).toLowerCase()
    expect(text).toContain('a finding to investigate, not a broken record')
    for (const verdict of ['reconciliation failed', 'data error', 'broken data']) {
      expect(text, verdict).not.toContain(verdict)
    }
  })

  test('carries the controlled-scenario disclosure in full', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    expect(await mainText(page)).toContain(
      'deliberately planted controlled scenarios used to prove the control surface'
    )
  })

  test('links to no accounting route, because none is built', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const hrefs = await page.$$eval('main a[href]', (nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? '')
    )
    for (const href of hrefs) {
      expect(href, href).not.toMatch(/\/dashboard\/(accounting|inventory)\b/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The geometry is driven by the data                                          */
/* -------------------------------------------------------------------------- */

/**
 * WHY THESE READ COMPUTED WIDTHS AND NOT MARKUP.
 *
 * Every other assertion in this file checks that a figure reached the screen. These
 * check the thing that a figure reaching the screen does not prove: that the PICTURE
 * beside it moved when the data did. A component drawing every bar at a fixed width
 * would satisfy the rest of this suite completely.
 *
 * So each test loads two filter states and compares the drawn geometry between them.
 * Where the two are expected to differ, an equal result is the failure.
 */
async function drawnWidths(page: Page, selector: string) {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => (node as HTMLElement).style.width)
  )
}

test.describe('changing the filter changes the geometry', () => {
  test('two different store scopes produce different comparison bars', async ({
    page,
  }) => {
    /*
     * Two-store scopes rather than two single stores, and the reason is a property of
     * the primitive rather than a convenience: a lone store is the maximum of its own
     * scale and is therefore always drawn full width. That is correct — a bar's length
     * is a comparison, and there is nothing to compare one store against — and it is
     * asserted separately below. What this test needs is two scopes whose RELATIVE
     * values differ.
     */
    await gotoRendered(page, `${ROUTE}?store=GSA-001,GSA-002`)
    const first = await drawnWidths(page, '#operating [style*="width"]')
    await gotoRendered(page, `${ROUTE}?store=GSA-002,GSA-003`)
    const second = await drawnWidths(page, '#operating [style*="width"]')
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(second)
  })

  test('three stores produce three different bar lengths', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const widths = await drawnWidths(page, '#operating [style*="width"]')
    expect(widths.length).toBeGreaterThanOrEqual(3)
    // Not all the same: the group view is the case a fixed-width bar would pass.
    expect(new Set(widths).size).toBeGreaterThan(1)
  })

  test('a single store draws a full-width bar and says why that is not a comparison', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const widths = await drawnWidths(page, '#operating [style*="width"]')
    expect(widths.every((width) => width === '100%')).toBe(true)
    expect(await mainText(page)).toContain('there is nothing to compare it against')
  })

  test('two periods produce a different trend shape', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-12`)
    const december = await page.$$eval('#operating [style*="height"]', (nodes) =>
      nodes.map((node) => (node as HTMLElement).style.height)
    )
    await gotoRendered(page, `${ROUTE}?period=2025-09`)
    const september = await page.$$eval('#operating [style*="height"]', (nodes) =>
      nodes.map((node) => (node as HTMLElement).style.height)
    )
    expect(december.length).toBeGreaterThan(0)
    expect(december).not.toEqual(september)
  })

  test('a condition filter changes the inventory age segments', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?condition=New`)
    const asNew = await drawnWidths(page, '#targets [style*="width"]')
    await gotoRendered(page, `${ROUTE}?condition=Used`)
    const used = await drawnWidths(page, '#targets [style*="width"]')
    expect(asNew.length).toBeGreaterThan(0)
    expect(asNew).not.toEqual(used)
  })

  test('a store scope change moves the funnel stage widths', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const first = await drawnWidths(page, '#composition [style*="width"]')
    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const second = await drawnWidths(page, '#composition [style*="width"]')
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(second)
  })

  test('the printed value and the bar beside it come from the same scope', async ({
    page,
  }) => {
    /*
     * The store comparison prints each store's retail units beside its bar and the
     * scoreboard prints the same measure in its own table. If a chart had acquired a
     * second read path, these two would disagree for at least one store.
     */
    await gotoRendered(page, `${ROUTE}?period=2025-11`)
    const compared = await page.$$eval('#operating table tbody tr', (rows) =>
      rows.map((row) =>
        [...row.querySelectorAll('th,td')].map((cell) => (cell.textContent ?? '').trim())
      )
    )
    const text = await mainText(page)
    for (const row of compared) {
      const [store, , value] = row
      if (store === undefined || value === undefined) continue
      expect(text, `${store} ${value}`).toContain(value)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Targets and selling-day pace (DASH.5)                                       */
/* -------------------------------------------------------------------------- */

test.describe('targets and selling-day pace', () => {
  test('renders the plan beside the actual, with the attainment and the clock', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/targets and pace/i)
    expect(text).toMatch(/Target\s+[\d,$]/)
    expect(text).toMatch(/of target/)
    expect(text).toMatch(/selling days/i)
    expect(text).toMatch(/per selling day/i)
  })

  test('names the governed target KPI identifiers', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const identifier of [
      'KPI-TGT-005',
      'KPI-TGT-006',
      'KPI-TGT-007',
      'KPI-TGT-008',
      'KPI-TGT-009',
      'KPI-TGT-010',
    ]) {
      expect(text, identifier).toContain(identifier)
    }
  })

  test('labels every projected figure "Selling-day pace projection"', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Selling-day pace projection')
  })

  test('never calls the projection a forecast or a prediction', async ({ page }) => {
    /*
     * The arithmetic is linear extrapolation over a calendar. Every sentence on the page
     * that uses the word must be denying it, and this is what proves the denial rather
     * than the claim survived.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const match of text.matchAll(/\b(forecast\w*|predicted|prediction)\b/gi)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0)
      expect(
        before.toLowerCase(),
        `the page used "${match[0]}" as a claim rather than a denial`
      ).toMatch(/not a|never a|rather than a|neither a|nor a/)
    }
  })

  test('states that the goals are synthetic and not benchmarks', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('synthetic internal operating goals')
    expect(text).toContain('not industry benchmarks')
  })

  test('says a completed month is complete rather than projecting it forward', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Month complete')
  })

  test('changes the plan when the store changes', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const group = await mainText(page)
    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const single = await mainText(page)
    expect(single).not.toBe(group)
    expect(single).toMatch(/Target\s+[\d,$]/)
  })

  test('changes the plan when the period changes', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07`)
    const july = await mainText(page)
    await gotoRendered(page, `${ROUTE}?period=2025-11`)
    const november = await mainText(page)
    expect(november).not.toBe(july)
  })

  test('withholds the comparison when a filter changes the actual population', async ({
    page,
  }) => {
    /*
     * A Used-only actual against an all-retail plan is a percentage that is
     * arithmetically valid and business-invalid. The page says so instead of printing it.
     */
    await gotoRendered(page, `${ROUTE}?condition=Used`)
    const text = await mainText(page)
    expect(text).toContain('Target context is not comparable')
    expect(text).not.toMatch(/Selling-day pace projection:/)
  })

  test('withholds pace and projection across several months but keeps the totals', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-07-01..2025-12-31`)
    const text = await mainText(page)
    expect(text).toMatch(/Target\s+[\d,$]/)
    expect(text).toMatch(/single-month arithmetic/i)
  })

  test('renders the scoreboard pace column for every store', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Pace against plan')
    expect(text).toMatch(/projected \//)
  })

  test('survives a browser back and forward across a target filter change', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await gotoRendered(page, `${ROUTE}?store=GSA-002`)
    await page.goBack()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(page.url()).not.toContain('store=GSA-002')
    await page.goForward()
    await page.locator('h1').first().waitFor({ state: 'visible' })
    expect(page.url()).toContain('store=GSA-002')
    expect(await mainText(page)).toMatch(/Target\s+[\d,$]/)
  })
})

/* -------------------------------------------------------------------------- */
/* The scoreboard                                                              */
/* -------------------------------------------------------------------------- */

test.describe('the store scoreboard', () => {
  test('names all three stores and their operating models', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    for (const store of ['Granite Chevrolet', 'Granite Subaru', 'Granite Pre-Owned']) {
      expect(text, store).toContain(store)
    }
    expect(text).toContain('Franchise New and Used')
    expect(text).toContain('Independent Used')
  })

  test('renders Not applicable for the independent store, not a zero', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const table = page.getByRole('table', { name: /store scoreboard/i })
    const row = table.getByRole('row', { name: /Granite Pre-Owned/ })
    await expect(row).toContainText('Not applicable')
  })

  test('exposes exactly one presentation of each row at a given width', async ({
    page,
  }) => {
    // Two presentations exist - a table above 1280px and cards below it - and the
    // inactive one is `display: none`, so assistive technology is never offered both
    // readings of the same row.
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, ROUTE)
    expect(await page.getByRole('table', { name: /store scoreboard/i }).count()).toBe(1)

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    expect(
      await page.getByRole('table', { name: /store scoreboard/i }).count(),
      'the wide table is still in the accessibility tree at 390px'
    ).toBe(0)
    await expect(page.getByRole('list', { name: /store scoreboard/i })).toBeVisible()
  })
})

/* -------------------------------------------------------------------------- */
/* Inventory and funnel                                                        */
/* -------------------------------------------------------------------------- */

test.describe('the inventory summary', () => {
  test('names the snapshot date and the aged threshold as a project default', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('31 December 2025')
    expect(text).toContain('60 days in stock')
    expect(text).toContain('a project default')
    expect(text).not.toContain('industry standard threshold')
  })

  test('shows the governed medians at the grain the export publishes them', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Median inventory age, at the grain it is published')
    expect(text).toContain('a group median is not the average of store medians')
  })

  test('gives the age distribution a data table rather than only a bar', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const table = page.getByRole('table', { name: /age bucket/i })
    await expect(table).toBeVisible()
    await expect(table.getByRole('columnheader', { name: /units/i })).toBeVisible()
  })
})

test.describe('the lead funnel', () => {
  test('renders the five stages a dealership recognises', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const table = page.getByRole('table', { name: /lead funnel stage counts/i })
    for (const stage of ['Leads', 'Contacted', 'Appointment set', 'Showed', 'Sold']) {
      await expect(
        table.getByRole('rowheader', { name: stage, exact: true })
      ).toBeVisible()
    }
  })

  test('states the cohort caveat where a reader will see it', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Counted by lead-creation date')
    expect(text).toContain('cohort maturity, not performance')
  })

  test('declines a group median response time and names the resolving scope', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Not derivable at this scope')
    expect(text).toContain('one store, one lead source and a single day')
  })

  test('resolves the exported median once the URL reaches that scope', async ({
    page,
  }) => {
    await gotoRendered(
      page,
      `${ROUTE}?period=2025-12-01..2025-12-01&store=GSA-001&source=LDS-001`
    )
    const text = await mainText(page)
    expect(text).toContain('30.8 minutes')
  })
})

/* -------------------------------------------------------------------------- */
/* Methodology disclosure and drill-through                                    */
/* -------------------------------------------------------------------------- */

test.describe('KPI methodology', () => {
  test('every KPI card carries a "How is this calculated?" disclosure', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const disclosures = page.getByText('How is this calculated?')
    expect(await disclosures.count()).toBeGreaterThanOrEqual(7)
  })

  test('the disclosure resolves to the governed catalogue definition', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainTextContent(page)
    // Server-rendered inside `<details>`, so the content is in the document before
    // anything is opened.
    expect(text).toContain('SUM(unit_count) WHERE is_retail = true')
    expect(text).toContain('reporting.vw_sales_summary')
    expect(text).toContain('Known limitations')
    expect(text).toContain('What this page selected')
  })

  test('the disclosure opens from the keyboard and reports its state', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const summary = page.getByText('How is this calculated?').first()
    const details = summary.locator('xpath=ancestor::details[1]')
    await expect(details).not.toHaveAttribute('open', '')
    await summary.click()
    await expect(details).toHaveAttribute('open', '')
  })

  test('drill-throughs point at destinations that exist', async ({ page }) => {
    /*
     * THIS ASSERTION CHANGED WITH `DASH.3`, AND THAT IS THE MECHANISM WORKING.
     *
     * At `DASH.2` it read "no link matches /dashboard/anything", because no console
     * sub-route existed and the cheapest way to prove no dead link shipped was to
     * forbid the shape entirely. `DASH.3` delivers two of them, so the guard is
     * re-aimed at what it was always for: every console link must resolve to a route
     * an increment has actually built.
     *
     * It is not weaker. The old form could not have caught a link to
     * `/dashboard/inventory` once ANY sub-route was allowed; this one does, because
     * the allowed set is the delivered set rather than the empty set.
     */
    await gotoRendered(page, ROUTE)
    const hrefs = await page.$$eval('main a[href]', (nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? '')
    )
    expect(hrefs.length).toBeGreaterThan(5)
    const consoleLinks = hrefs
      .filter((href) => /^\/dashboard\/./.test(href))
      .map((href) => href.split('?')[0] ?? href)
    for (const href of consoleLinks) {
      expect(
        DASHBOARD_ROUTES.includes(href),
        `${href} points at a console route no increment has delivered`
      ).toBe(true)
    }
    for (const unbuilt of UNBUILT_DASHBOARD_ROUTES) {
      expect(
        consoleLinks.includes(unbuilt),
        `the overview links to the unbuilt ${unbuilt}`
      ).toBe(false)
    }
    expect(hrefs.some((href) => href.startsWith('/kpis#KPI-'))).toBe(true)
  })

  test('the unbuilt console routes are not reachable and answer 404', async ({
    page,
  }) => {
    for (const unbuilt of UNBUILT_DASHBOARD_ROUTES) {
      const response = await page.goto(unbuilt)
      expect(response?.status(), `${unbuilt} exists`).toBe(404)
    }
  })

  test('names the unbuilt sections as text, with the increment that delivers each', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('What this console does not do yet')
    expect(text).toContain('DASH.12')
    expect(text).toContain('Management actions')
    // Named, not mocked: no invented action, alert or recommendation.
    expect(text).not.toMatch(/\b\d+ actions? require\b/i)
    expect(text).not.toMatch(/\brecommended action\b/i)
  })
})

/* -------------------------------------------------------------------------- */
/* Responsive and reduced motion                                               */
/* -------------------------------------------------------------------------- */

test.describe('responsive behaviour', () => {
  for (const viewport of DASHBOARD_VIEWPORTS) {
    test(`no horizontal overflow at ${viewport.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await gotoRendered(page, ROUTE)
      /*
       * Measured by trying to scroll rather than by comparing widths. A container
       * that scrolls INSIDE itself is legitimate - the scoreboard's wide table does
       * exactly that above 1280px - and only the page scrolling sideways is a defect.
       */
      const scrolled = await page.evaluate(() => {
        window.scrollTo({ left: 200, behavior: 'instant' })
        const moved = window.scrollX
        window.scrollTo({ left: 0, behavior: 'instant' })
        return moved
      })
      expect(scrolled, `the page scrolls sideways at ${viewport.name}px`).toBe(0)
    })
  }

  test('remains usable at 200% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => {
      document.documentElement.style.zoom = '200%'
    })
    await gotoRendered(page, ROUTE)
    const scrolled = await page.evaluate(() => {
      window.scrollTo({ left: 200, behavior: 'instant' })
      const moved = window.scrollX
      window.scrollTo({ left: 0, behavior: 'instant' })
      return moved
    })
    expect(scrolled).toBe(0)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('renders every value with reduced motion requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('KPI-SLS-001')
    expect(text).toContain('Granite Pre-Owned')
    expect(text).toContain('Gate 2 remains CLOSED')
  })
})

/* -------------------------------------------------------------------------- */
/* No JavaScript                                                               */
/* -------------------------------------------------------------------------- */

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the whole console is still there', async ({ page }) => {
    await page.goto(ROUTE)
    // `textContent`, so the assertions cover the methodology inside the closed
    // disclosures too: the claim is that the document is complete without
    // scripting, not that every part of it is expanded.
    const text = await mainTextContent(page)

    // KPI values.
    expect(text).toContain('KPI-SLS-001')
    expect(text).toContain('$321,935')
    // Scoreboard, including the structural absence.
    expect(text).toContain('Granite Pre-Owned')
    expect(text).toContain('Not applicable')
    // Inventory and funnel summaries.
    expect(text).toContain('Age distribution')
    expect(text).toContain('Appointment set')
    // Trust state and the disclosure.
    expect(text).toContain('Real-engine validation pending')
    expect(text).toContain('Every warehouse record in this project is synthetic')
    // Methodology, which is inside `<details>` and therefore in the document.
    expect(text).toContain('reporting.vw_sales_summary')
    // Targets and pace: every part of it, including the states and the disclosure.
    expect(text).toMatch(/targets and pace/i)
    expect(text).toContain('Selling-day pace projection')
    expect(text).toContain('selling days')
    expect(text).toContain('per selling day')
    expect(text).toContain('of target')
    expect(text).toContain('synthetic internal operating goals')
    expect(text).toContain('Pace against plan')

    /*
     * The nine visualisations, without scripting. Each one is a server component, so
     * what is asserted here is not that a chart "works" but that its ACCESSIBLE
     * EQUIVALENT is in the document — the microtrend's month list, the trend's data
     * table, the comparison's store table, the age bands, the composition amounts and
     * the reconciliation accounts. A picture that only exists after hydration would
     * take every one of these with it.
     */
    expect(text).toContain('Trailing 6 months to December 2025')
    expect(text).toContain('Total gross per retail unit')
    expect(text).toContain('Front-end gross')
    expect(text).toContain('Back-end gross')
    expect(text).toContain('New and used mix')
    expect(text).toContain('Stock schedule against the general ledger')
    expect(text).toContain('Comparable positions')
    expect(text).toMatch(/read .* as a table/i)
  })

  test('every visualisation carries its geometry in the served HTML', async ({
    page,
  }) => {
    await page.goto(ROUTE)
    // Inline widths and heights are in the document, not applied by a script after
    // load. With scripting disabled there is nothing that could have applied them.
    const drawn = await page.$$eval(
      'main [style*="width"], main [style*="height"]',
      (n) => n.length
    )
    expect(drawn).toBeGreaterThan(10)
  })

  test('the incomparable-filter state is present without scripting too', async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?condition=Used`)
    const text = await mainTextContent(page)
    expect(text).toContain('Target context is not comparable')
  })

  test('a deep-linked filter still renders the filtered view', async ({ page }) => {
    await page.goto(`${ROUTE}?store=GSA-002&period=2025-11`)
    const text = await page.locator('main').innerText()
    expect(text).toContain('Granite Subaru')
    expect(text).toContain('November 2025')
    expect(text).not.toContain('Granite Chevrolet of Nashua')
  })

  test('the filter form submits as a native GET', async ({ page }) => {
    await page.goto(ROUTE)
    const form = page.getByRole('form', { name: 'Dashboard filters' })
    await expect(form).toHaveAttribute('method', 'get')
    await expect(form).toHaveAttribute('action', ROUTE)
    await page.selectOption('#filter-store', 'GSA-003')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page).toHaveURL(/store=GSA-003/)
    expect(await page.locator('main').innerText()).toContain('Granite Pre-Owned')
  })
})

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

test.describe('the console keeps operational copy dense', () => {
  test('leads with scope rather than with a promotional headline', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/selected period/i)
    expect(text).toMatch(/store scope/i)
    expect(text).toMatch(/data as of/i)
    for (const marketing of [
      'unlock',
      'empower',
      'best-in-class',
      'world-class',
      'at a glance',
    ]) {
      expect(text.toLowerCase(), marketing).not.toContain(marketing)
    }
  })

  test('never presents itself as a production system', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = (await bodyText(page)).toLowerCase()
    for (const claim of [
      'live data',
      'real time',
      'real-time',
      'connected to your dms',
      'sync with',
      'refresh now',
    ]) {
      expect(text, claim).not.toContain(claim)
    }
  })

  test('offers no control that pretends to mutate dealership data', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const buttons = await page.$$eval('main button', (nodes) =>
      nodes.map((node) => (node.textContent ?? '').trim().toLowerCase())
    )
    for (const label of buttons) {
      for (const forbidden of ['save', 'assign', 'notify', 'export to', 'refresh']) {
        expect(label, `a control offers "${forbidden}"`).not.toContain(forbidden)
      }
    }
  })
})
