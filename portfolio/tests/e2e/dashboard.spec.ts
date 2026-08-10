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

import {
  bodyText,
  gotoRendered,
  mainText,
  mainTextContent,
  openDetailRegions,
  settle,
} from './helpers'
import {
  OPERATING_NAV_ROUTES,
  DASHBOARD_ROUTES,
  DASHBOARD_VIEWPORTS,
  UNBUILT_DASHBOARD_ROUTES,
} from './routes'

/**
 * The Executive surface, at the root.
 *
 * `UX.1` made `/` the canonical entry experience and `/dashboard` a permanent 308
 * to it, query string preserved. `navigation.spec.ts` owns the redirect itself;
 * everything in this file is about the surface, so it addresses the surface.
 */
const ROUTE = '/'

/* -------------------------------------------------------------------------- */
/* The route and its shell                                                     */
/* -------------------------------------------------------------------------- */

test.describe('the console route exists and is reachable', () => {
  test('answers 200 and renders its heading', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    // A NAME, not a sentence. It read "How the group is performing, and which
    // store needs attention" — an article title on a working screen, above the
    // figures a manager came for. The rail says where the reader is.
    await expect(page.locator('h1')).toHaveText(/^Executive$/)
  })

  test('is the site root, so the product is the front door', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('is reachable from the reference header on another route', async ({ page }) => {
    await gotoRendered(page, '/technical?view=kpis')
    await page
      .getByRole('banner')
      .getByRole('link', { name: 'Executive', exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp('/$'))
    await expect(page.locator('h1')).toBeVisible()
  })

  test('renders the operating rail as a nav, not a tablist', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const nav = page.getByRole('navigation', { name: 'Operating' }).first()
    await expect(nav).toBeVisible()
    expect(await nav.getByRole('tablist').count()).toBe(0)
    for (const destination of OPERATING_NAV_ROUTES) {
      const link = nav.getByRole('link', { name: destination.label, exact: true })
      const href = await link.getAttribute('href')
      // The rail carries the reader's filter context, so a link to a destination
      // is its path plus whatever survives the journey. At the default state there
      // is nothing to carry and the href is the bare path.
      expect((href ?? '').split('?')[0], destination.label).toBe(destination.path)
    }
    await expect(
      nav.getByRole('link', { name: 'Executive', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('renders no breadcrumb, because the rail already says where the reader is', async ({
    page,
  }) => {
    /*
     * IT HAD ONE, AND `UX.1` REMOVED IT DELIBERATELY.
     *
     * The console opened with a breadcrumb reading "Overview / Command center", an
     * eyebrow reading "Dealer Operations Command Center", an `h1` reading "How the
     * group is performing, and which store needs attention", and a lede — four
     * statements of location inside 200 vertical pixels, above the figures. A
     * breadcrumb is a trail back up a hierarchy; the operating application is flat,
     * the rail marks the current destination, and there is nowhere to go up TO.
     *
     * The reference domain keeps its breadcrumbs, and `navigation.spec.ts` asserts
     * them on the store pages, where there genuinely is a parent.
     */
    await gotoRendered(page, ROUTE)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)
  })

  test('appears in the sitemap, and the retired console URL does not', async ({
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml')).text()
    // The root, which is what the console is now.
    expect(xml).toMatch(/<loc>[^<]*\/<\/loc>/)
    // `/dashboard` is a permanent redirect. A redirect in a sitemap is a crawl
    // instruction to fetch a URL that will not answer.
    expect(xml, '/dashboard is a redirect and must not be in the sitemap').not.toMatch(
      /<loc>[^<]*\/dashboard<\/loc>/
    )
    // The unbuilt console route must not be advertised.
    for (const unbuilt of UNBUILT_DASHBOARD_ROUTES) {
      expect(xml, `${unbuilt} is in the sitemap`).not.toContain(unbuilt)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Disclosure                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * WHAT MOVED, AND WHAT THESE TESTS NOW PROVE.
 *
 * The trust evidence and the synthetic statement are behind the "Data and methodology"
 * disclosure rather than occupying a page region. That is a presentation change and the
 * suite has to be able to tell it apart from a deletion, so each claim is now asserted
 * TWICE: once against the served HTML with the disclosure shut, which proves the words
 * are still in the document for a text search, a printer and a reader with no
 * JavaScript; and once against the rendered text with it open, which proves they are
 * reachable rather than merely present.
 *
 * The first half is the one that would catch a real regression. A disclosure that never
 * opened would still pass a `textContent` sweep, which is why the second half exists.
 */
const EVIDENCE_REGIONS = ['trust'] as const

test.describe('the console states what it is, in its own body', () => {
  test('carries the synthetic statement in full', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const served = await mainTextContent(page)
    expect(served).toContain('Every warehouse record in this project is synthetic')
    await openDetailRegions(page, EVIDENCE_REGIONS)
    const text = await mainText(page)
    expect(text).toContain('Every warehouse record in this project is synthetic')
    expect(text).toContain('Granite Auto Group and its three stores are fictional')
  })

  test('carries the compact demo statement without opening anything', async ({
    page,
  }) => {
    /*
     * THE TRUST LINE LEFT THE OPERATING ROUTES AT `UX.1`, AND WHAT REPLACED IT IS
     * SHORTER RATHER THAN QUIETER.
     *
     * `<TrustLine>` was five clauses on every route on the site, three of which —
     * "Exported SQL figures, not a Power BI result", "Real-engine validation
     * pending", "Deterministic synthetic data" — are engineering statements in the
     * eye path of a manager reading gross. They are all still on this page, in the
     * methodology disclosure, and the tests below open it and assert them.
     *
     * What a reader cannot avoid seeing is this: the group is fictional and the
     * figures are synthetic. That is the claim that would mislead if it were
     * missed; the validation status of a semantic model is not.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toContain('Granite Auto Group is fictional')
    expect(text).toContain('Operating figures are synthetic')
    // And the engineering clauses are NOT in the eye path.
    expect(text).not.toContain('Exported SQL figures, not a Power BI result')
  })

  test('states the real Power BI validation state, from the evidence files', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await openDetailRegions(page, EVIDENCE_REGIONS)
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
    // Asserted against the served HTML first: a collapsed disclosure must not be able
    // to make a pending gate look like a gate nobody mentioned.
    expect(await mainTextContent(page)).toContain('Gate 2 remains CLOSED')
    await openDetailRegions(page, EVIDENCE_REGIONS)
    const text = await mainText(page)
    expect(text).toContain('Gate 2 remains CLOSED')
    expect(text).toContain('may not be cited as Gate 2 evidence')
  })

  test('shows the export lane checks with a word beside each verdict', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    await openDetailRegions(page, EVIDENCE_REGIONS)
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
    expect(text).toContain('Whether the books agree')
    expect(text).toContain('Stock schedule against the general ledger')
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

  /*
   * THIS TEST USED TO ASSERT THE OPPOSITE.
   *
   * Through `DASH.8` it read "links to no accounting route, because none is built" and
   * swept every anchor in `main` for `/dashboard/accounting` or `/dashboard/inventory`,
   * because pointing at either would have been a 404. `DASH.9` built both, so the
   * negative became a false claim about the console and is replaced by the positive it
   * always implied: the summary drills through, and the destination is real.
   *
   * The route-integrity sweep that made the old assertion worth having is unchanged and
   * still runs: `UNBUILT_DASHBOARD_ROUTES` is asserted unreachable from every dashboard
   * route and asserted to 404 when fetched directly, in this file and in
   * `navigation.spec.ts`. What narrowed is the list of routes that do not exist, not the
   * strength of the check.
   */
  test('drills through to the accounting route, and the destination is real', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const link = page
      .locator('#accounting-integrity a[href="/dashboard/accounting"]')
      .first()
    await expect(link).toBeVisible()

    await link.click()
    await page.waitForURL('**/dashboard/accounting**')
    // The destination's `h1` is its NAME now, and the claim it used to make in a
    // sentence — this is an inventory control reconciliation, not a general ledger
    // — is the subtitle immediately under it, where a reader still meets it before
    // any figure.
    await expect(page.locator('h1')).toHaveText('Accounting')
    expect(await page.locator('main').innerText()).toContain(
      'Inventory control reconciliation. Not a general ledger.'
    )
  })

  test('drills through to the inventory route, and the destination is real', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const link = page.locator('main a[href="/dashboard/inventory"]').first()
    await expect(link).toBeVisible()

    await link.click()
    await page.waitForURL('**/dashboard/inventory**')
    await expect(page.locator('h1')).toHaveText('Inventory')
    expect(await page.locator('main').innerText()).toContain(
      'Stock held at one snapshot date'
    )
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
    const first = await drawnWidths(page, '#group-performance [style*="width"]')
    await gotoRendered(page, `${ROUTE}?store=GSA-002,GSA-003`)
    const second = await drawnWidths(page, '#group-performance [style*="width"]')
    expect(first.length).toBeGreaterThan(0)
    expect(first).not.toEqual(second)
  })

  test('three stores produce three different bar lengths', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const widths = await drawnWidths(page, '#group-performance [style*="width"]')
    expect(widths.length).toBeGreaterThanOrEqual(3)
    // Not all the same: the group view is the case a fixed-width bar would pass.
    expect(new Set(widths).size).toBeGreaterThan(1)
  })

  test('a single store draws a full-width bar and says why that is not a comparison', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-001`)
    const widths = await drawnWidths(page, '#group-performance [style*="width"]')
    expect(widths.every((width) => width === '100%')).toBe(true)
    expect(await mainText(page)).toContain('there is nothing to compare it against')
  })

  test('two periods produce a different trend shape', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?period=2025-12`)
    const december = await page.$$eval('#group-performance [style*="height"]', (nodes) =>
      nodes.map((node) => (node as HTMLElement).style.height)
    )
    await gotoRendered(page, `${ROUTE}?period=2025-09`)
    const september = await page.$$eval('#group-performance [style*="height"]', (nodes) =>
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
    const compared = await page.$$eval('#group-performance table tbody tr', (rows) =>
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
    await openDetailRegions(page, ['store-scoreboard'])
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
    expect(await mainTextContent(page)).toContain('Franchise New and Used')
    await openDetailRegions(page, ['store-scoreboard'])
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
    await openDetailRegions(page, ['store-scoreboard'])
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
    await openDetailRegions(page, ['store-scoreboard'])
    expect(await page.getByRole('table', { name: /store scoreboard/i }).count()).toBe(1)

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoRendered(page, ROUTE)
    await openDetailRegions(page, ['store-scoreboard'])
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
    // Stated ON the age stack now, beside the ramp that turns at it, rather than in a
    // paragraph above the KPI cards. The number and the words "project default" are the
    // claim; where they sit is presentation.
    expect(text).toContain('60-day')
    expect(text).toContain('project default')
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
    expect(await mainTextContent(page)).toContain('Management actions')
    await openDetailRegions(page, ['not-built'])
    const text = await mainText(page)
    expect(text).toContain('What is not built yet')
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
    await openDetailRegions(page, EVIDENCE_REGIONS)
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
    /*
     * THE SCOPE IS ONE LINE NOW, NOT A SIX-CELL INSTRUMENT PANEL.
     *
     * The console opened with a definition list — Selected period, Comparison,
     * Store scope, Data as of, Dataset, Provenance — six labelled facts above the
     * figures. Three of them are what a reader needs before reading a number and
     * three are provenance. `UX.1` put the first three on one line in business
     * words and the other three in the methodology disclosure, which the tests
     * above open and assert.
     */
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/all three stores|granite/i)
    expect(text).toMatch(/december 2025/i)
    expect(text).toMatch(/vs november 2025|prior period/i)
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

/* -------------------------------------------------------------------------- */
/* Density, and what collapsing a region must not cost                        */
/* -------------------------------------------------------------------------- */

test.describe('the console reads as an instrument rather than as a report', () => {
  /**
   * WHY A CEILING RATHER THAN AN EXACT COUNT. The measured figure at the time this was
   * written is 1,003 visible prose words, down from 1,744 -- a 42.5% reduction. Pinning
   * the exact number would fail on any honest copy edit, which is not a defect. The
   * ceiling is set at 1,300: comfortably above the current page, and far enough below
   * the 1,744 it replaced that the console cannot drift back into being a document
   * without this failing first.
   *
   * A "prose word" is a word inside a rendered paragraph of eight words or more.
   * Shorter paragraphs are labels, units and values -- the figures the page exists for
   * -- and counting those would penalise the console for carrying data.
   */
  const PROSE_CEILING = 1_300

  async function visibleProse(
    page: Page
  ): Promise<{ words: number; paragraphs: number }> {
    await settle(page)
    return page.evaluate(() => {
      const main = document.querySelector('main')
      if (main === null) return { words: 0, paragraphs: 0 }
      let words = 0
      let paragraphs = 0
      for (const element of main.querySelectorAll('p')) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (element.closest('.sr-only') !== null) continue
        const details = element.closest('details')
        if (details !== null && !details.open) continue
        const count = (element.innerText || '').trim().split(/\s+/).filter(Boolean).length
        if (count < 8) continue
        words += count
        paragraphs += 1
      }
      return { words, paragraphs }
    })
  }

  test('carries less prose than a documentation route would', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoRendered(page, ROUTE)
    const { words } = await visibleProse(page)
    expect(words, `visible prose words: ${String(words)}`).toBeLessThan(PROSE_CEILING)
  })

  test('groups the console into five regions rather than nine', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    // One `h2` per region. The count is the structure a reader navigating by heading
    // gets, which is the thing the consolidation was for.
    const regions = await page.locator('main h2').count()
    expect(regions).toBeLessThanOrEqual(5)
    expect(regions).toBeGreaterThanOrEqual(4)
  })

  test('opens on figures, with no region that only explains the page', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const headings = await page.locator('main h2').allInnerTexts()
    for (const heading of headings) {
      expect(heading.toLowerCase()).not.toContain('does not do yet')
    }
  })

  test('collapsing a region costs a click and nothing else', async ({ page }) => {
    /*
     * The claim the disclosures rest on. Every word of the scoreboard, the trust
     * evidence and the delivery backlog is in the served document while all three are
     * shut -- so a browser text search, a printer, an assistive technology reading the
     * document and a reader with no JavaScript all still have them.
     */
    await gotoRendered(page, ROUTE)
    const served = await mainTextContent(page)
    for (const claim of [
      'Franchise New and Used',
      'Every warehouse record in this project is synthetic',
      'Gate 2 remains CLOSED',
      // The one console section that is still unbuilt, and the increment that owns it.
      // This read `Employee performance` and `DASH.11` until that route shipped: an entry
      // leaves the planned list in the same commit its destination becomes reachable, so
      // this assertion moving is the mechanism working rather than a guard being relaxed.
      'Management actions',
      'DASH.12',
    ]) {
      expect(served, claim).toContain(claim)
    }
  })

  test('every collapsed region opens from the keyboard and reports its state', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    for (const id of ['store-scoreboard', 'trust', 'not-built']) {
      const summary = page.locator(`details#${id} > summary`)
      await expect(summary, id).toHaveCount(1)
      await summary.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator(`details#${id}`), id).toHaveAttribute('open', '')
    }
  })

  test('keeps the anchors the collapsed regions used to carry', async ({ page }) => {
    // Three of these were page regions. An anchor that stops resolving is a broken link
    // even when the content is still on the page.
    await gotoRendered(page, ROUTE)
    for (const id of [
      'group-performance',
      'targets',
      'composition',
      'store-scoreboard',
    ]) {
      await expect(page.locator(`#${id}`), id).toHaveCount(1)
    }
  })
})

test.describe('colour is a second reading and never the only one', () => {
  test('draws the age ramp as five distinct tokens, each with its count in text', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const stack = page.locator('figure', { hasText: 'Age distribution' }).first()
    const fills = await stack.evaluate((node) =>
      [...node.querySelectorAll('[class*="bg-data-age-"]')].map((mark) =>
        [...mark.classList].find((name) => name.startsWith('bg-data-age-'))
      )
    )
    expect(new Set(fills).size).toBeGreaterThanOrEqual(4)

    // And the same bands, as text, in the legend and again in the table.
    const text = await stack.innerText()
    for (const band of ['0-30', '31-60', '61-90', '91-120', 'Over 120']) {
      expect(text, band).toContain(band)
    }
  })

  test('paints the same neutral mark on both sides of the reconciliation zero', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const marks = await page.$$eval(
      '#accounting-integrity [class*="rounded-full"]',
      (nodes) =>
        nodes
          .map((node) => [...node.classList].filter((name) => name.startsWith('bg-')))
          .flat()
    )
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark, 'a variance is coloured by its sign').not.toMatch(
        /^bg-data-(positive|negative|warning)$/
      )
    }
  })

  test('renders the region tints as backgrounds that carry no state', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const grounds = await page.evaluate(() =>
      ['group-performance', 'targets', 'composition'].map((id) => {
        const region = document.getElementById(id)
        return region === null ? null : getComputedStyle(region).backgroundColor
      })
    )
    // Three distinct, opaque tints. Opaque matters: a translucent wash makes the real
    // ground a composite, and the contrast floor is measured against the token.
    expect(new Set(grounds).size).toBe(3)
    for (const ground of grounds) {
      expect(ground).not.toBeNull()
      expect(ground, 'a region tint is translucent').not.toMatch(
        /rgba\([^)]*,\s*0?\.\d+\)/
      )
    }
  })
})
